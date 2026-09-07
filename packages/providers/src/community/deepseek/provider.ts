import type {
  IAgentProvider,
  MessageChunk,
  ProviderCapabilities,
  SendQueryOptions,
} from '../../types';
import { loadMcpConfig } from '../../mcp/config';
import { resumedOutcome, withResumedOutcome } from '../../shared/resumed';
import type { DeepseekProcessInput } from './acp-client';
import { DEEPSEEK_CAPABILITIES } from './capabilities';
import {
  DEFAULT_DEEPSEEK_PERMISSION_MODE,
  DEFAULT_DEEPSEEK_PROFILE,
  DEFAULT_DEEPSEEK_PROVIDER_ROUTE,
  parseDeepseekConfig,
  resolveDeepseekEffort,
} from './config';
import { buildDeepseekChildEnv } from './env';
import { DeepseekProviderError, toDeepseekErrorResult } from './errors';
import { buildDeepseekMcpServers } from './mcp';
import { resolveBundledDshEntrypoint, resolveDeepseekNodeBinary } from './node-resolver';

export type DeepseekTurnRunner = (input: DeepseekProcessInput) => AsyncGenerator<MessageChunk>;

export interface DeepseekProviderDependencies {
  runTurn?: DeepseekTurnRunner;
  resolveNodeBinary?: typeof resolveDeepseekNodeBinary;
  resolveDshEntrypoint?: typeof resolveBundledDshEntrypoint;
}

function uniqueNames(names: string[]): string[] {
  return [...new Set(names)];
}

function mergeQueryEnv(
  requestEnv: Record<string, string> | undefined
): Record<string, string | undefined> {
  return { ...process.env, ...requestEnv };
}

/**
 * DeepSeek Harness community provider. Preflight and error-as-result live here;
 * ACP SDK values load only when `sendQuery()` dynamically imports `./acp-client`.
 */
export class DeepseekProvider implements IAgentProvider {
  constructor(private readonly dependencies: DeepseekProviderDependencies = {}) {}

  getType(): string {
    return 'deepseek';
  }

  getCapabilities(): ProviderCapabilities {
    return DEEPSEEK_CAPABILITIES;
  }

  async *sendQuery(
    prompt: string,
    cwd: string,
    resumeSessionId?: string,
    requestOptions?: SendQueryOptions
  ): AsyncGenerator<MessageChunk> {
    if (requestOptions?.abortSignal?.aborted === true) {
      yield toDeepseekErrorResult(
        new DeepseekProviderError('deepseek_aborted', 'DeepSeek turn aborted before start.'),
        []
      );
      return;
    }

    const secrets: string[] = [];
    try {
      const config = parseDeepseekConfig(requestOptions?.assistantConfig ?? {});
      const childEnv = buildDeepseekChildEnv({
        ambient: process.env,
        request: requestOptions?.env,
        baseUrl: config.baseUrl,
        permissionMode: config.permissionMode ?? DEFAULT_DEEPSEEK_PERMISSION_MODE,
      });
      secrets.push(childEnv.DEEPSEEK_API_KEY);

      const resolveNodeBinary = this.dependencies.resolveNodeBinary ?? resolveDeepseekNodeBinary;
      const resolveDshEntrypoint =
        this.dependencies.resolveDshEntrypoint ?? resolveBundledDshEntrypoint;
      const nodeBin = resolveNodeBinary(config.nodeBin, childEnv);
      const dshEntrypoint = resolveDshEntrypoint();

      const warnings: string[] = [];
      let mcpServers = buildDeepseekMcpServers({}, childEnv);
      const mcpPath = requestOptions?.nodeConfig?.mcp;
      if (typeof mcpPath === 'string' && mcpPath.length > 0) {
        const loaded = await loadMcpConfig(mcpPath, cwd, mergeQueryEnv(requestOptions?.env));
        const missingVars = uniqueNames(loaded.missingVars);
        if (missingVars.length > 0) {
          warnings.push(
            `DeepSeek MCP config references undefined env vars: ${missingVars.join(', ')}. Servers using them may fail at runtime.`
          );
        }
        mcpServers = buildDeepseekMcpServers(loaded.servers, childEnv);
      }

      const model = requestOptions?.model ?? config.model;
      const effort = resolveDeepseekEffort(requestOptions?.nodeConfig?.effort ?? config.effort);
      const outputSchema = requestOptions?.outputFormat?.schema;
      const runTurn =
        this.dependencies.runTurn ?? (await import('./acp-client')).runDeepseekAcpTurn;

      for (const warning of warnings) {
        yield { type: 'system', content: warning };
      }

      const input: DeepseekProcessInput = {
        cwd,
        prompt,
        resumeSessionId,
        model,
        providerRoute: config.providerRoute ?? DEFAULT_DEEPSEEK_PROVIDER_ROUTE,
        effort,
        mcpServers,
        outputSchema,
        abortSignal: requestOptions?.abortSignal,
        nodeBin,
        dshEntrypoint,
        profile: config.profile ?? DEFAULT_DEEPSEEK_PROFILE,
        env: childEnv,
      };

      yield* withResumedOutcome(runTurn(input), resumedOutcome(resumeSessionId, true));
    } catch (error: unknown) {
      yield toDeepseekErrorResult(error, secrets);
    }
  }
}
