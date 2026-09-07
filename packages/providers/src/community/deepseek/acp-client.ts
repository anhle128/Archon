import { spawn, type ChildProcess } from 'node:child_process';
import { Readable, Writable } from 'node:stream';

import {
  client,
  methods,
  ndJsonStream,
  PROTOCOL_VERSION,
  type AgentApp,
  type ClientContext,
  type InitializeResponse,
  type McpServer,
  type PromptResponse,
  type Stream,
} from '@agentclientprotocol/sdk';

import {
  augmentPromptForJsonSchema,
  tryParseStructuredOutput,
} from '../../shared/structured-output';
import type { MessageChunk } from '../../types';
import { AsyncQueue } from './async-queue';
import { createDeepseekEventState, mapDeepseekSessionUpdate } from './event-bridge';
import {
  collectDeepseekSecretValues,
  DeepseekProviderError,
  redactDeepseekSecrets,
} from './errors';
import { answerDeepseekPermissionRequest } from './permission';

const STDERR_CAP = 4096;
const DEFAULT_TERMINATE_GRACE_MS = 2000;

export interface DeepseekAcpTurnInput {
  cwd: string;
  prompt: string;
  resumeSessionId?: string;
  model?: string;
  providerRoute: string;
  effort?: 'off' | 'low' | 'high' | 'max';
  mcpServers: McpServer[];
  outputSchema?: Record<string, unknown>;
  abortSignal?: AbortSignal;
}

export interface DeepseekProcessInput extends DeepseekAcpTurnInput {
  nodeBin: string;
  dshEntrypoint: string;
  profile: 'acp';
  env: Record<string, string>;
  /**
   * Extra secret values to redact from error output, supplied by the caller that
   * knows more than this module can derive from `env` alone — notably MCP header
   * and env values, which never appear in the child environment. Unioned with the
   * env-derived set so a direct caller still gets env redaction for free.
   */
  secretValues?: readonly string[];
}

export interface DeepseekProcessDependencies {
  spawn?: typeof spawn;
  terminateGraceMs?: number;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

function asDeepseekError(
  error: unknown,
  subtype: 'deepseek_protocol_error' | 'deepseek_resume_failed'
): DeepseekProviderError {
  if (error instanceof DeepseekProviderError) return error;
  return new DeepseekProviderError(subtype, errorMessage(error), { cause: error });
}

function isHttpMcpServer(server: McpServer): boolean {
  return 'type' in server && server.type === 'http';
}

function requireAgentCapabilities(init: InitializeResponse, mcpServers: McpServer[]): void {
  if (init.protocolVersion !== PROTOCOL_VERSION) {
    throw new DeepseekProviderError(
      'deepseek_protocol_error',
      `ACP protocol version mismatch: expected ${String(PROTOCOL_VERSION)}, got ${String(init.protocolVersion)}.`
    );
  }
  const sessionCaps = init.agentCapabilities?.sessionCapabilities;
  if (sessionCaps?.resume == null || sessionCaps.close == null) {
    throw new DeepseekProviderError(
      'deepseek_protocol_error',
      'DeepSeek ACP agent must advertise session resume and close capabilities.'
    );
  }
  if (mcpServers.some(isHttpMcpServer) && init.agentCapabilities?.mcpCapabilities?.http !== true) {
    throw new DeepseekProviderError(
      'deepseek_protocol_error',
      'DeepSeek ACP agent must advertise HTTP MCP support when HTTP MCP servers are declared.'
    );
  }
}

function abortedResult(sessionId: string): Extract<MessageChunk, { type: 'result' }> {
  return {
    type: 'result',
    sessionId,
    stopReason: 'aborted',
    isError: true,
    errorSubtype: 'deepseek_aborted',
  };
}

function successResult(
  sessionId: string,
  stopReason: string,
  structuredOutput: unknown
): Extract<MessageChunk, { type: 'result' }> {
  if (structuredOutput === undefined) {
    return { type: 'result', sessionId, stopReason };
  }
  return { type: 'result', sessionId, stopReason, structuredOutput };
}

function waitMs(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve: () => void) => {
    setTimeout(resolve, ms);
  });
}

/**
 * Raw stderr plus the facts needed to bound it safely. `truncated` records that
 * accumulation stopped at the cap, which is the only case where a secret can be
 * split across the boundary and leave an unredactable fragment behind.
 */
interface StderrEvidence {
  readonly text: string;
  readonly truncated: boolean;
  readonly secrets: readonly string[];
}

/**
 * Length of the longest secret prefix a redacted tail still ends with.
 *
 * Truncation can cut a secret in half. The surviving head is not a whole
 * secret, so redaction cannot match it and it would be emitted verbatim. This
 * runs AFTER full-match redaction on purpose: measuring against the raw text
 * lets one secret's prefix match across the boundary of another, and trimming
 * that many characters would cut into an already-complete secret and expose its
 * own head. Complete matches are removed first, then the leftover fragment is
 * measured and dropped, so only the artifact disappears.
 */
function trailingSecretFragmentLength(redacted: string, secrets: readonly string[]): number {
  let longest = 0;
  for (const secret of secrets) {
    const maxPrefix = Math.min(secret.length - 1, redacted.length);
    for (let length = maxPrefix; length > longest; length--) {
      if (redacted.endsWith(secret.slice(0, length))) {
        longest = length;
        break;
      }
    }
  }
  return longest;
}

function toSpawnFailed(error: unknown, stderr: StderrEvidence): DeepseekProviderError {
  const base = redactDeepseekSecrets(errorMessage(error), stderr.secrets);
  const excerpt = redactedStderrExcerpt(stderr);
  const message = excerpt.length > 0 ? `${base}\n${excerpt}` : base;
  return new DeepseekProviderError('deepseek_spawn_failed', message, { cause: error });
}

function toAcpFailed(error: unknown, stderr: StderrEvidence): DeepseekProviderError {
  return withStderr(
    new DeepseekProviderError(
      'deepseek_acp_error',
      redactDeepseekSecrets(errorMessage(error), stderr.secrets),
      { cause: error }
    ),
    stderr
  );
}

function redactedStderrExcerpt(stderr: StderrEvidence): string {
  const { text, secrets } = stderr;
  // Order is load-bearing: redact complete matches first, then drop the trailing
  // fragment truncation left behind, then cap. See `trailingSecretFragmentLength`.
  const redacted = redactDeepseekSecrets(text, secrets);
  const fragment = stderr.truncated ? trailingSecretFragmentLength(redacted, secrets) : 0;
  const safe = fragment > 0 ? redacted.slice(0, redacted.length - fragment) : redacted;
  return safe.slice(0, STDERR_CAP);
}

function withStderr(error: DeepseekProviderError, stderr: StderrEvidence): DeepseekProviderError {
  if (stderr.text.length === 0) return error;
  return new DeepseekProviderError(
    error.subtype,
    `${error.message}\n${redactedStderrExcerpt(stderr)}`,
    {
      cause: error,
    }
  );
}

function childHasExited(child: ChildProcess): boolean {
  return child.exitCode !== null || child.signalCode !== null;
}

async function reapChild(child: ChildProcess, terminateGraceMs: number): Promise<void> {
  if (childHasExited(child)) return;

  const exited = new Promise<void>((resolve: () => void) => {
    child.once('exit', () => {
      resolve();
    });
  });
  if (childHasExited(child)) return;

  child.kill('SIGTERM');
  if (childHasExited(child)) {
    await exited;
    return;
  }

  await Promise.race([exited, waitMs(terminateGraceMs)]);
  if (!childHasExited(child)) {
    child.kill('SIGKILL');
  }
  await exited;
}

/**
 * Drive one ACP turn against an in-process agent or an stdio stream.
 */
export async function* driveDeepseekAcpTurn(
  target: Stream | AgentApp,
  input: DeepseekAcpTurnInput
): AsyncGenerator<MessageChunk> {
  const queue = new AsyncQueue<MessageChunk>();
  const eventState = createDeepseekEventState();
  let activeSessionId: string | undefined;
  let sessionLive = false;
  let clientCtx: ClientContext | undefined;
  let transcript = '';

  const app = client({ name: 'archon-deepseek' })
    .onRequest(methods.client.session.requestPermission, () => answerDeepseekPermissionRequest())
    .onNotification(methods.client.session.update, ({ params }) => {
      if (params.sessionId !== activeSessionId) return;
      for (const chunk of mapDeepseekSessionUpdate(params.update, eventState)) {
        if (chunk.type === 'assistant') transcript += chunk.content;
        queue.push(chunk);
      }
    });

  // SDK exposes connectWith(Stream) and connectWith(AgentApp) overloads; runtime dispatch accepts both validated members.
  const targetForConnect = target as Stream & AgentApp;

  const connected: Promise<void> = app
    .connectWith(targetForConnect, async (ctx: ClientContext) => {
      clientCtx = ctx;
      try {
        const init = await ctx.request(methods.agent.initialize, {
          protocolVersion: PROTOCOL_VERSION,
          clientCapabilities: {},
        });
        requireAgentCapabilities(init, input.mcpServers);

        if (input.resumeSessionId !== undefined) {
          try {
            await ctx.request(methods.agent.session.resume, {
              sessionId: input.resumeSessionId,
              cwd: input.cwd,
              mcpServers: input.mcpServers,
            });
          } catch (error) {
            throw asDeepseekError(error, 'deepseek_resume_failed');
          }
          activeSessionId = input.resumeSessionId;
        } else {
          const created = await ctx.request(methods.agent.session.new, {
            cwd: input.cwd,
            mcpServers: input.mcpServers,
          });
          activeSessionId = created.sessionId;
        }

        const sessionId = activeSessionId;
        sessionLive = true;

        let aborted = input.abortSignal?.aborted === true;
        let cancelSent: Promise<void> | undefined;
        const onAbort = (): void => {
          aborted = true;
          cancelSent = ctx.notify(methods.agent.session.cancel, { sessionId });
        };
        if (!aborted) {
          input.abortSignal?.addEventListener('abort', onAbort);
        }

        let promptResponse: PromptResponse | undefined;
        try {
          if (input.model !== undefined) {
            await ctx.request(methods.agent.session.setConfigOption, {
              sessionId,
              configId: 'model',
              value: JSON.stringify([input.providerRoute, input.model]),
            });
          }
          if (input.effort !== undefined) {
            await ctx.request(methods.agent.session.setConfigOption, {
              sessionId,
              configId: 'reasoning_effort',
              value: input.effort,
            });
          }

          if (!aborted) {
            const outbound =
              input.outputSchema !== undefined
                ? augmentPromptForJsonSchema(input.prompt, input.outputSchema)
                : input.prompt;
            try {
              promptResponse = await ctx.request(methods.agent.session.prompt, {
                sessionId,
                prompt: [{ type: 'text', text: outbound }],
              });
            } catch (error) {
              if (!aborted) throw error;
            }
          }
        } catch (error) {
          if (!aborted) throw error;
        } finally {
          input.abortSignal?.removeEventListener('abort', onAbort);
          if (cancelSent !== undefined) {
            try {
              await cancelSent;
            } catch {
              // Cancel notify failure must not hide session/close.
            }
          }
          await ctx.request(methods.agent.session.close, { sessionId });
          sessionLive = false;
        }

        if (aborted) {
          queue.push(abortedResult(sessionId));
          return;
        }
        const structured =
          input.outputSchema !== undefined ? tryParseStructuredOutput(transcript) : undefined;
        queue.push(successResult(sessionId, promptResponse?.stopReason ?? 'end_turn', structured));
      } catch (error) {
        throw asDeepseekError(error, 'deepseek_protocol_error');
      }
    })
    .then(
      () => {
        queue.close();
      },
      (error: unknown) => {
        queue.fail(error);
      }
    );

  try {
    for await (const chunk of queue) {
      yield chunk;
    }
  } finally {
    if (sessionLive && clientCtx !== undefined && activeSessionId !== undefined) {
      try {
        await clientCtx.notify(methods.agent.session.cancel, { sessionId: activeSessionId });
      } catch {
        // Connection may already be closing.
      }
    }
    await connected;
  }
}

/**
 * Spawn pinned DSH under Node and drive one ACP turn over stdio.
 */
export async function* runDeepseekAcpTurn(
  input: DeepseekProcessInput,
  dependencies?: DeepseekProcessDependencies
): AsyncGenerator<MessageChunk> {
  const spawnFn = dependencies?.spawn ?? spawn;
  const terminateGraceMs = dependencies?.terminateGraceMs ?? DEFAULT_TERMINATE_GRACE_MS;
  const secrets = [
    ...new Set([...collectDeepseekSecretValues(input.env), ...(input.secretValues ?? [])]),
  ];
  // Headroom beyond the output cap: redaction replaces each secret with
  // `[REDACTED]`, so keeping extra raw bytes lets the redacted excerpt still
  // reach STDERR_CAP. A secret split by this cap leaves a fragment redaction
  // cannot match; `redactedStderrExcerpt` drops it after redacting.
  const stderrBufferCap =
    STDERR_CAP + Math.max(0, ...secrets.map((secret: string) => secret.length));

  let child: ChildProcess;
  try {
    child = spawnFn(input.nodeBin, [input.dshEntrypoint, '--profile', input.profile], {
      cwd: input.cwd,
      env: input.env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
  } catch (error) {
    throw toSpawnFailed(error, { text: '', truncated: false, secrets });
  }

  let stderrText = '';
  let stderrTruncated = false;
  if (child.stderr !== null) {
    child.stderr.on('data', (chunk: Buffer | string) => {
      if (stderrText.length >= stderrBufferCap) {
        stderrTruncated = true;
        return;
      }
      stderrText += typeof chunk === 'string' ? chunk : chunk.toString('utf8');
      if (stderrText.length > stderrBufferCap) {
        stderrText = stderrText.slice(0, stderrBufferCap);
        stderrTruncated = true;
      }
    });
  }

  let finished = false;
  let spawnError: Error | undefined;
  let rejectDeath: ((error: Error) => void) | undefined;
  const death = new Promise<Error>((resolve: (error: Error) => void) => {
    rejectDeath = resolve;
  });
  child.once('error', (error: Error) => {
    spawnError = error;
    if (!finished) rejectDeath?.(error);
  });
  child.once('exit', (code: number | null, signal: NodeJS.Signals | null) => {
    if (!finished) {
      rejectDeath?.(
        new Error(
          `DSH process exited before the ACP turn completed (code=${String(code)}, signal=${String(signal)}).`
        )
      );
    }
  });

  if (child.stdin === null || child.stdout === null) {
    finished = true;
    await reapChild(child, terminateGraceMs);
    throw new DeepseekProviderError('deepseek_spawn_failed', 'DSH process is missing stdio pipes.');
  }

  const stream = ndJsonStream(
    Writable.toWeb(child.stdin) as unknown as WritableStream<Uint8Array>,
    Readable.toWeb(child.stdout) as unknown as ReadableStream<Uint8Array>
  );
  const gen = driveDeepseekAcpTurn(stream, input);

  try {
    while (true) {
      const next = gen.next();
      const winner = await Promise.race([
        next.then((result: IteratorResult<MessageChunk>) => ({
          kind: 'chunk' as const,
          result,
        })),
        death.then((error: Error) => ({ kind: 'death' as const, error })),
      ]);
      if (winner.kind === 'death') {
        throw winner.error;
      }
      if (winner.result.done) break;
      yield winner.result.value;
    }
    finished = true;
  } catch (error) {
    finished = true;
    const stderr: StderrEvidence = { text: stderrText, truncated: stderrTruncated, secrets };
    if (spawnError !== undefined || error instanceof Error) {
      const early =
        spawnError !== undefined ||
        (error instanceof Error &&
          error.message.startsWith('DSH process exited before the ACP turn completed'));
      if (early) {
        throw toSpawnFailed(spawnError ?? error, stderr);
      }
    }
    if (error instanceof DeepseekProviderError) {
      throw withStderr(error, stderr);
    }
    throw toAcpFailed(error, stderr);
  } finally {
    finished = true;
    try {
      await gen.return(undefined);
    } catch {
      // Turn already failed or completed.
    }
    await reapChild(child, terminateGraceMs);
  }
}
