import { join } from 'node:path';

import { createLogger } from '@archon/paths';

import type {
  IAgentProvider,
  MessageChunk,
  ProviderCapabilities,
  SendQueryOptions,
  TokenUsage,
  UsageBreakdown,
} from '../../types';

import { getOrderedAgents } from './agent-config';
import { OPENCODE_CAPABILITIES } from './capabilities';
import { parseModelRef, parseOpencodeConfig } from './config';
import { classifyOpencodeError, enrichOpencodeError, OpencodeUsageBearingError } from './errors';
import { materializeAgents } from './agent-fs';
import { streamMultiAgentOpencodeSession } from './multi-agent';
import {
  acquireEmbeddedRuntime,
  disposeInstanceForDirectory,
  releaseEmbeddedRuntime,
  type OpencodeClientLike,
} from './runtime';
import { resolveSessionId, streamOpencodeSession } from './session';
import { withResumedOutcome, resumedOutcome } from '../../shared/resumed';
import { mergeUsageBreakdowns, sumTokenUsages } from './tokens';

export { parseModelRef } from './config';
export { resetEmbeddedRuntime } from './runtime';

const MAX_RETRIES = 3;
const RETRY_BASE_DELAY_MS = 2000;

let cachedLog: ReturnType<typeof createLogger> | undefined;

function getLog(): ReturnType<typeof createLogger> {
  if (!cachedLog) cachedLog = createLogger('provider.opencode');
  return cachedLog;
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export class OpencodeProvider implements IAgentProvider {
  private readonly retryBaseDelayMs: number;

  constructor(options?: { retryBaseDelayMs?: number }) {
    this.retryBaseDelayMs = options?.retryBaseDelayMs ?? RETRY_BASE_DELAY_MS;
  }

  async *sendQuery(
    prompt: string,
    cwd: string,
    resumeSessionId?: string,
    requestOptions?: SendQueryOptions
  ): AsyncGenerator<MessageChunk> {
    const assistantConfig = parseOpencodeConfig(requestOptions?.assistantConfig ?? {});
    const modelRef = requestOptions?.model ?? assistantConfig.model;
    const parsedModelOrNull = modelRef ? parseModelRef(modelRef) : undefined;

    if (modelRef && !parsedModelOrNull) {
      throw new Error(
        `Invalid OpenCode model ref: '${modelRef}'. Expected format '<provider>/<model>' (for example 'anthropic/claude-3-5-sonnet').`
      );
    }

    if (!parsedModelOrNull) {
      throw new Error(
        'OpenCode requires a model to be specified. ' +
          'Set model in assistants config (e.g., model: anthropic/claude-3-5-sonnet).'
      );
    }

    const parsedModel = parsedModelOrNull;

    const nodeAgents = requestOptions?.nodeConfig?.agents;
    const nodeId = requestOptions?.nodeConfig?.nodeId;
    const orderedAgents = getOrderedAgents(requestOptions?.nodeConfig);
    const hasAgentConfig = orderedAgents.length > 0;
    const isMultiAgent = orderedAgents.length > 1;
    const usingExternalBaseUrl = Boolean(assistantConfig.baseUrl);
    if (usingExternalBaseUrl) {
      throw new Error(
        'OpenCode external baseUrl mode is no longer supported. ' +
          'Archon now requires managed embedded OpenCode runtime for fully controlled agent lifecycle.'
      );
    }

    const sessionCwd =
      hasAgentConfig && nodeId && !usingExternalBaseUrl
        ? join(cwd, '.archon-opencode', nodeId)
        : cwd;

    let lastError: Error | undefined;
    let recoveredAgentNotFound = false;
    /** Cumulative observations across internal retry attempts for one sendQuery. */
    let accumulatedUsage: UsageBreakdown | undefined;
    let accumulatedTokens: TokenUsage | undefined;
    let accumulatedCost: number | undefined;

    for (let attempt = 0; attempt < MAX_RETRIES; attempt += 1) {
      if (requestOptions?.abortSignal?.aborted) {
        throw new Error('OpenCode query aborted');
      }

      const runtime = await (async (): Promise<{
        client: OpencodeClientLike;
        release: () => void;
      }> => {
        const embedded = await acquireEmbeddedRuntime(requestOptions?.abortSignal);
        return {
          client: embedded.client,
          release: (): void => {
            releaseEmbeddedRuntime(embedded);
          },
        };
      })();

      try {
        // When agents are defined, use a per-node session directory so each node
        // gets its own OpenCode InstanceState — preventing stale agent cache from
        // previous nodes in the same workflow run.
        // For multi-agent, materialize each agent in its own subdirectory.
        if (hasAgentConfig) {
          if (isMultiAgent) {
            // Materialize all agents in the shared sessionCwd so the single
            // event subscription catches events from every child session.
            await materializeAgents(sessionCwd, nodeAgents ?? {});
            await disposeInstanceForDirectory(runtime.client, sessionCwd);
          } else if (nodeAgents) {
            await materializeAgents(sessionCwd, nodeAgents);
            await disposeInstanceForDirectory(runtime.client, sessionCwd);
          }
        }

        if (isMultiAgent) {
          if (!nodeId) {
            throw new Error(
              'OpenCode multi-agent execution requires a nodeId in nodeConfig. ' +
                'Ensure the workflow node sets nodeConfig.nodeId.'
            );
          }
          // Multi-agent always starts fresh — it resolves its own per-node
          // sessions internally and cannot resume a single prior session. If a
          // resume was requested, report it as cold (false) so the executor
          // surfaces the lost continuity instead of silently starting fresh.
          yield* mergeAccumulatedIntoStream(
            withResumedOutcome(
              streamMultiAgentOpencodeSession(
                runtime.client,
                sessionCwd,
                nodeId,
                prompt,
                parsedModel,
                requestOptions
              ),
              resumedOutcome(resumeSessionId, false)
            ),
            {
              usage: accumulatedUsage,
              tokens: accumulatedTokens,
              cost: accumulatedCost,
            }
          );
          return;
        }

        const { sessionId, resumed } = await resolveSessionId(
          runtime.client,
          sessionCwd,
          resumeSessionId
        );
        if (resumeSessionId && !resumed) {
          yield {
            type: 'system',
            content: '⚠️ Could not resume OpenCode session. Starting fresh conversation.',
          };
        }

        yield* mergeAccumulatedIntoStream(
          withResumedOutcome(
            streamOpencodeSession(
              runtime.client,
              sessionCwd,
              sessionId,
              prompt,
              parsedModel,
              requestOptions
            ),
            resumedOutcome(resumeSessionId, resumed)
          ),
          {
            usage: accumulatedUsage,
            tokens: accumulatedTokens,
            cost: accumulatedCost,
          }
        );
        return;
      } catch (error) {
        if (error instanceof OpencodeUsageBearingError) {
          accumulatedUsage = mergeUsageBreakdowns(accumulatedUsage, error.usageBreakdown);
          accumulatedTokens = sumTokenUsages([accumulatedTokens, error.tokens]);
          if (error.cost !== undefined) {
            accumulatedCost = (accumulatedCost ?? 0) + error.cost;
          }
        }

        const errorClass = classifyOpencodeError(
          error,
          requestOptions?.abortSignal?.aborted === true
        );
        const enrichedError = enrichOpencodeError(error, errorClass);
        const shouldRetry =
          errorClass === 'rate_limit' ||
          errorClass === 'crash' ||
          (errorClass === 'agent_not_found' && hasAgentConfig && !recoveredAgentNotFound);

        getLog().error(
          {
            err: error,
            errorClass,
            attempt,
            maxRetries: MAX_RETRIES,
          },
          'opencode.query_failed'
        );

        if (!shouldRetry || attempt >= MAX_RETRIES - 1) {
          // Usage-bearing late failures yield a terminal isError result so the
          // executor can persist observations and then fail the node. No-usage
          // failures keep the existing throw path (no fabrication).
          if (accumulatedUsage) {
            yield {
              type: 'result',
              isError: true,
              errorSubtype: errorClass,
              errors: [enrichedError.message],
              usageBreakdown: accumulatedUsage,
              ...(accumulatedTokens ? { tokens: accumulatedTokens } : {}),
              ...(accumulatedCost !== undefined ? { cost: accumulatedCost } : {}),
              ...(error instanceof OpencodeUsageBearingError && error.sessionId
                ? { sessionId: error.sessionId }
                : {}),
            };
            return;
          }
          throw enrichedError;
        }

        if (errorClass === 'agent_not_found') {
          recoveredAgentNotFound = true;
          getLog().info({ attempt, sessionCwd }, 'opencode.retrying_after_agent_refresh');
        }

        const delayMs = this.retryBaseDelayMs * 2 ** attempt;
        getLog().info({ attempt, delayMs, errorClass }, 'opencode.retrying_query');
        await delay(delayMs);
        if (lastError) {
          enrichedError.cause = lastError;
        }
        lastError = enrichedError;
      } finally {
        runtime.release();
      }
    }

    throw lastError ?? new Error(`OpenCode query failed after ${MAX_RETRIES} retries`);
  }

  getType(): string {
    return 'opencode';
  }

  getCapabilities(): ProviderCapabilities {
    return OPENCODE_CAPABILITIES;
  }
}

async function* mergeAccumulatedIntoStream(
  stream: AsyncIterable<MessageChunk>,
  prior: {
    usage: UsageBreakdown | undefined;
    tokens: TokenUsage | undefined;
    cost: number | undefined;
  }
): AsyncGenerator<MessageChunk> {
  for await (const chunk of stream) {
    if (chunk.type !== 'result' || (!prior.usage && !prior.tokens && prior.cost === undefined)) {
      yield chunk;
      continue;
    }

    const usageBreakdown = mergeUsageBreakdowns(prior.usage, chunk.usageBreakdown);
    const tokens = sumTokenUsages([prior.tokens, chunk.tokens]);
    const cost =
      tokens?.cost !== undefined
        ? tokens.cost
        : prior.cost !== undefined || chunk.cost !== undefined
          ? (prior.cost ?? 0) + (chunk.cost ?? 0)
          : undefined;

    yield {
      ...chunk,
      ...(usageBreakdown ? { usageBreakdown } : {}),
      ...(tokens ? { tokens } : {}),
      ...(cost !== undefined ? { cost } : {}),
    };
  }
}
