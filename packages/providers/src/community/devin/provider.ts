import type {
  IAgentProvider,
  MessageChunk,
  ProviderCapabilities,
  SendQueryOptions,
} from '../../types';
import { resumedOutcome, withResumedOutcome } from '../../shared/resumed';
import type { DevinProcessInput } from './acp-client';
import { assertDevinLoggedIn, resolveDevinBinary } from './binary-resolver';
import { DEVIN_CAPABILITIES } from './capabilities';
import { buildDevinSpawnArgs, parseDevinConfig } from './config';
import {
  collectDevinSecretValues,
  DevinProviderError,
  isAskHumanControlError,
  toDevinErrorResult,
} from './errors';

export type DevinTurnRunner = (input: DevinProcessInput) => AsyncGenerator<MessageChunk>;

export interface DevinProviderDependencies {
  runTurn?: DevinTurnRunner;
  resolveBinary?: typeof resolveDevinBinary;
  assertLoggedIn?: typeof assertDevinLoggedIn;
}

const ASK_HUMAN_TOOL_NAME = 'AskHuman';

function childEnv(request: Record<string, string> | undefined): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) env[key] = value;
  }
  if (request !== undefined) Object.assign(env, request);
  return env;
}

function parseConfigOrThrow(raw: Record<string, unknown>): ReturnType<typeof parseDevinConfig> {
  try {
    return parseDevinConfig(raw);
  } catch (error) {
    if (error instanceof DevinProviderError) throw error;
    throw new DevinProviderError(
      'devin_unsupported_config',
      error instanceof Error ? error.message : String(error),
      { cause: error }
    );
  }
}

/**
 * Devin CLI community provider. Preflight and error-as-result live here; ACP
 * SDK values load only when `sendQuery()` dynamically imports `./acp-client`.
 * AskHuman control errors are rethrown because the executor pauses on them.
 */
export class DevinProvider implements IAgentProvider {
  constructor(private readonly dependencies: DevinProviderDependencies = {}) {}

  getType(): string {
    return 'devin';
  }

  getCapabilities(): ProviderCapabilities {
    return DEVIN_CAPABILITIES;
  }

  async *sendQuery(
    prompt: string,
    cwd: string,
    resumeSessionId?: string,
    requestOptions?: SendQueryOptions
  ): AsyncGenerator<MessageChunk> {
    if (requestOptions?.abortSignal?.aborted === true) {
      yield toDevinErrorResult(
        new DevinProviderError('devin_aborted', 'Devin turn aborted before start.'),
        []
      );
      return;
    }

    let secrets: string[] = [];
    try {
      const config = parseConfigOrThrow(requestOptions?.assistantConfig ?? {});
      const resolveBinary = this.dependencies.resolveBinary ?? resolveDevinBinary;
      const assertLoggedIn = this.dependencies.assertLoggedIn ?? assertDevinLoggedIn;
      const binaryPath = resolveBinary(config.binaryPath, process.env);
      assertLoggedIn(process.env);

      const env = childEnv(requestOptions?.env);
      secrets = collectDevinSecretValues(env);
      const askHuman = requestOptions?.nativeTools?.find(tool => tool.name === ASK_HUMAN_TOOL_NAME);
      const runTurn = this.dependencies.runTurn ?? (await import('./acp-client')).runDevinAcpTurn;

      const input: DevinProcessInput = {
        cwd,
        prompt,
        binaryPath,
        spawnArgs: buildDevinSpawnArgs(config),
        env,
        secretValues: secrets,
        ...(resumeSessionId !== undefined ? { resumeSessionId } : {}),
        ...(requestOptions?.model !== undefined
          ? { model: requestOptions.model }
          : config.model !== undefined
            ? { model: config.model }
            : {}),
        ...(requestOptions?.outputFormat?.schema !== undefined
          ? { outputSchema: requestOptions.outputFormat.schema }
          : {}),
        ...(requestOptions?.abortSignal !== undefined
          ? { abortSignal: requestOptions.abortSignal }
          : {}),
        ...(askHuman !== undefined ? { askHuman } : {}),
        ...(requestOptions?.resumeInteractions !== undefined
          ? { resumeInteractions: requestOptions.resumeInteractions }
          : {}),
      };

      yield* withResumedOutcome(runTurn(input), resumedOutcome(resumeSessionId, true));
    } catch (error: unknown) {
      if (isAskHumanControlError(error)) throw error;
      yield toDevinErrorResult(error, secrets);
    }
  }
}
