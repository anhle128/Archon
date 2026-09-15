import { spawn, type ChildProcess } from 'node:child_process';
import { Readable, Writable } from 'node:stream';

import {
  client,
  methods,
  ndJsonStream,
  PROTOCOL_VERSION,
  type AgentApp,
  type ClientCapabilities,
  type ClientContext,
  type CreateElicitationRequest,
  type InitializeResponse,
  type PromptResponse,
  type SendRequestOptions,
  type SessionConfigOption,
  type SessionModeState,
  type Stream,
} from '@agentclientprotocol/sdk';

import {
  augmentPromptForJsonSchema,
  tryParseStructuredOutput,
} from '../../shared/structured-output';
import type {
  AskHumanControlError,
  MessageChunk,
  NativeTool,
  ResumeInteraction,
} from '../../types';
import { AsyncQueue } from './async-queue';
import { buildDevinAskResumePrompt, elicitationToAskHumanQuestions } from './elicitation';
import { createDevinEventState, mapDevinSessionUpdate } from './event-bridge';
import {
  classifyDevinAcpError,
  collectDevinSecretValues,
  DevinProviderError,
  isAskHumanControlError,
  isRedactableSecretValue,
  redactDevinSecrets,
} from './errors';
import { devinPromptUsageToBreakdown } from './usage';

const STDERR_CAP = 4096;
const DEFAULT_TERMINATE_GRACE_MS = 2000;
const DEFAULT_SETUP_TIMEOUT_MS = 60_000;
/** Post-cancel window for a compliant agent to flush trailing updates and settle the prompt before a hung one is released. */
const CANCEL_DRAIN_GRACE_MS = 500;
/** Devin's ACP session mode that auto-approves its own tool calls — the ACP-side meaning of `yolo`. */
const DEVIN_SESSION_MODE = 'bypass';

export interface DevinAcpTurnInput {
  cwd: string;
  prompt: string;
  resumeSessionId?: string;
  model?: string;
  outputSchema?: Record<string, unknown>;
  abortSignal?: AbortSignal;
  /** Archon's AskHuman tool for this turn; its presence advertises elicitation. */
  askHuman?: NativeTool;
  /** Answers for a re-entry turn; requires `resumeSessionId`. */
  resumeInteractions?: readonly ResumeInteraction[];
}

export interface DevinProcessInput extends DevinAcpTurnInput {
  binaryPath: string;
  spawnArgs: string[];
  env: Record<string, string>;
  /** Extra values to redact from stderr excerpts beyond the env-derived set. */
  secretValues?: readonly string[];
}

export interface DevinProcessDependencies {
  spawn?: typeof spawn;
  terminateGraceMs?: number;
}

type ResultChunk = Extract<MessageChunk, { type: 'result' }>;

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

function requireAgentCapabilities(init: InitializeResponse): void {
  if (init.protocolVersion !== PROTOCOL_VERSION) {
    throw new DevinProviderError(
      'devin_protocol_error',
      `ACP protocol version mismatch: expected ${String(PROTOCOL_VERSION)}, got ${String(init.protocolVersion)}.`
    );
  }
  if (init.agentCapabilities?.loadSession !== true) {
    throw new DevinProviderError(
      'devin_protocol_error',
      'Devin ACP agent must advertise loadSession; session resume and AskHuman re-entry depend on it.'
    );
  }
}

/**
 * The ACP SDK 1.4.0 ClientCapabilities type predates the elicitation field,
 * but the Devin agent reads it. Pinned with one assertion so the rest of the
 * file stays typed.
 */
function clientCapabilitiesFor(askHuman: NativeTool | undefined): ClientCapabilities {
  if (askHuman === undefined) return {};
  return { elicitation: { form: {} } } as unknown as ClientCapabilities;
}

/**
 * Devin's form elicitation uses `oneOf: [{ const }]` without the SDK schema's
 * required option `title`. A passthrough parser accepts the live payload so
 * AskHuman can still pause; `elicitationToAskHumanQuestions` enforces shape.
 */
function parseElicitationParams(params: unknown): CreateElicitationRequest {
  return params as CreateElicitationRequest;
}

function currentModel(options: SessionConfigOption[] | null | undefined): string | undefined {
  const model = options?.find(option => option.id === 'model');
  if (model?.type !== 'select') return undefined;
  return typeof model.currentValue === 'string' ? model.currentValue : undefined;
}

function setupTimeoutMs(): number {
  const raw = process.env.DEVIN_ACP_SETUP_TIMEOUT_MS;
  const parsed = raw === undefined ? Number.NaN : Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_SETUP_TIMEOUT_MS;
}

/**
 * Bound a setup request that depends on Devin's network (remote config, session
 * store). The SDK gets a cancellation signal and a local race guarantees a clear
 * provider error even if the SDK never settles the cancelled request.
 */
async function withSetupTimeout<T>(
  label: string,
  run: (options: SendRequestOptions) => Promise<T>
): Promise<T> {
  const ms = setupTimeoutMs();
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
  }, ms);
  const timedOut = new Promise<never>((_resolve: unknown, reject: (error: Error) => void) => {
    controller.signal.addEventListener(
      'abort',
      () => {
        reject(
          new DevinProviderError(
            'devin_protocol_error',
            `Devin ACP ${label} did not answer within ${String(ms)} ms; Devin may be waiting on its remote config fetch. Retry the turn.`
          )
        );
      },
      { once: true }
    );
  });
  try {
    return await Promise.race([run({ cancellationSignal: controller.signal }), timedOut]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * The CLI permission flag does not reach ACP sessions, which start in Devin's
 * `accept-edits` mode. Enforce the approved posture over ACP and refuse to run
 * in a stricter mode silently when bypass is withheld by policy.
 */
async function ensureBypassMode(
  ctx: ClientContext,
  sessionId: string,
  modes: SessionModeState | null | undefined
): Promise<void> {
  if (modes?.currentModeId === DEVIN_SESSION_MODE) return;
  const available = modes?.availableModes.map(mode => mode.id) ?? [];
  if (!available.includes(DEVIN_SESSION_MODE)) {
    throw new DevinProviderError(
      'devin_protocol_error',
      `Devin session mode "${DEVIN_SESSION_MODE}" is unavailable (available: ${available.join(', ') || 'none'}); an organization policy may restrict it.`
    );
  }
  try {
    await withSetupTimeout('session/set_mode', options =>
      ctx.request(methods.agent.session.setMode, { sessionId, modeId: DEVIN_SESSION_MODE }, options)
    );
  } catch (error) {
    throw classifyDevinAcpError(error, 'devin_protocol_error');
  }
}

function abortedResult(sessionId: string): ResultChunk {
  return {
    type: 'result',
    sessionId,
    stopReason: 'aborted',
    isError: true,
    errorSubtype: 'devin_aborted',
  };
}

function successResult(
  sessionId: string,
  response: PromptResponse | undefined,
  structuredOutput: unknown,
  model: string | undefined
): ResultChunk {
  const usageBreakdown = devinPromptUsageToBreakdown(response?.usage, model);
  return {
    type: 'result',
    sessionId,
    stopReason: response?.stopReason ?? 'end_turn',
    ...(structuredOutput !== undefined ? { structuredOutput } : {}),
    ...(model !== undefined ? { resolvedModel: { id: model } } : {}),
    ...(usageBreakdown !== undefined ? { usageBreakdown } : {}),
  };
}

function waitMs(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve: () => void) => {
    setTimeout(resolve, ms);
  });
}

/**
 * Drive one ACP turn against an in-process agent or an stdio stream.
 *
 * Three signals end a turn early and each cancels the ACP session before the
 * prompt returns: the caller's abort signal, a permission request (yolo means
 * Devin should not ask; if it does, Archon refuses and stops), and an AskHuman
 * pause raised by the elicitation handler. AskHuman control errors are
 * rethrown unchanged so the executor can park the node.
 */
export async function* driveDevinAcpTurn(
  target: Stream | AgentApp,
  input: DevinAcpTurnInput
): AsyncGenerator<MessageChunk> {
  if (
    input.resumeInteractions !== undefined &&
    input.resumeInteractions.length > 0 &&
    input.resumeSessionId === undefined
  ) {
    throw new DevinProviderError(
      'devin_protocol_error',
      'AskHuman re-entry requires the stored Devin session id.'
    );
  }

  const queue = new AsyncQueue<MessageChunk>();
  const state = createDevinEventState();
  let activeSessionId: string | undefined;
  let sessionLive = false;
  let clientCtx: ClientContext | undefined;
  let transcript = '';
  let aborted = input.abortSignal?.aborted === true;
  let controlError: AskHumanControlError | undefined;
  let terminalError: DevinProviderError | undefined;
  let cancelSent: Promise<void> | undefined;
  let resolveLocalCancellation!: () => void;
  const localCancellation = new Promise<void>((resolve: () => void) => {
    resolveLocalCancellation = resolve;
  });

  const requestCancel = (): void => {
    if (clientCtx === undefined || activeSessionId === undefined || cancelSent !== undefined)
      return;
    resolveLocalCancellation();
    cancelSent = clientCtx.notify(methods.agent.session.cancel, { sessionId: activeSessionId });
  };

  const app = client({ name: 'archon-devin' })
    .onRequest(methods.client.session.requestPermission, ({ params }) => {
      const title = params.toolCall.title ?? params.toolCall.toolCallId;
      terminalError ??= new DevinProviderError(
        'devin_permission_blocked',
        `Devin asked for permission to run "${title}" despite yolo mode; Archon refused and stopped the turn. Adjust Devin's organization rules or the prompt.`
      );
      requestCancel();
      return { outcome: { outcome: 'cancelled' } };
    })
    .onRequest(methods.client.elicitation.create, parseElicitationParams, async ({ params }) => {
      await handleElicitation(params);
      return { action: 'cancel' };
    })
    .onNotification(methods.client.session.update, ({ params }) => {
      if (params.sessionId !== activeSessionId) return;
      for (const chunk of mapDevinSessionUpdate(params.update, state)) {
        if (chunk.type === 'assistant') transcript += chunk.content;
        queue.push(chunk);
      }
    });

  async function handleElicitation(params: CreateElicitationRequest): Promise<void> {
    if (input.askHuman === undefined) {
      terminalError ??= new DevinProviderError(
        'devin_protocol_error',
        'Devin sent an elicitation request but no AskHuman tool was supplied for this turn.'
      );
      requestCancel();
      return;
    }
    const toolUseId = state.pendingAskToolCallIds.shift() ?? `devin-ask-${Date.now().toString(36)}`;
    try {
      const questions = elicitationToAskHumanQuestions(params);
      const returned = await input.askHuman.handler(
        { questions },
        { toolUseId, sessionId: activeSessionId }
      );
      terminalError ??= new DevinProviderError(
        'devin_protocol_error',
        `AskHuman handler returned instead of pausing (${returned.length} chars); the turn cannot continue safely.`
      );
    } catch (error) {
      if (isAskHumanControlError(error)) {
        controlError ??= error;
      } else {
        terminalError ??= new DevinProviderError(
          'devin_protocol_error',
          `AskHuman handler failed: ${errorMessage(error)}`,
          { cause: error }
        );
      }
    }
    requestCancel();
  }

  // The SDK overloads connectWith(Stream) and connectWith(AgentApp); one cast covers both.
  const targetForConnect = target as Stream & AgentApp;

  const connected: Promise<void> = app
    .connectWith(targetForConnect, async (ctx: ClientContext) => {
      clientCtx = ctx;
      try {
        const init = await withSetupTimeout('initialize', options =>
          ctx.request(
            methods.agent.initialize,
            {
              protocolVersion: PROTOCOL_VERSION,
              clientCapabilities: clientCapabilitiesFor(input.askHuman),
            },
            options
          )
        );
        requireAgentCapabilities(init);

        let configOptions: SessionConfigOption[] | null | undefined;
        let modes: SessionModeState | null | undefined;
        if (input.resumeSessionId !== undefined) {
          const resumeSessionId = input.resumeSessionId;
          activeSessionId = resumeSessionId;
          state.replaying = true;
          try {
            const loaded = await withSetupTimeout('session/load', options =>
              ctx.request(
                methods.agent.session.load,
                { sessionId: resumeSessionId, cwd: input.cwd, mcpServers: [] },
                options
              )
            );
            configOptions = loaded?.configOptions;
            modes = loaded?.modes;
          } catch (error) {
            throw classifyDevinAcpError(error, 'devin_session_load_failed');
          } finally {
            state.replaying = false;
          }
        } else {
          let created;
          try {
            created = await withSetupTimeout('session/new', options =>
              ctx.request(methods.agent.session.new, { cwd: input.cwd, mcpServers: [] }, options)
            );
          } catch (error) {
            throw classifyDevinAcpError(error, 'devin_acp_error');
          }
          activeSessionId = created.sessionId;
          configOptions = created.configOptions;
          modes = created.modes;
        }
        const sessionId = activeSessionId;
        sessionLive = true;

        await ensureBypassMode(ctx, sessionId, modes);

        let model = currentModel(configOptions);
        const requestedModel = input.model;
        if (requestedModel !== undefined) {
          try {
            const applied = await withSetupTimeout('session/set_config_option', options =>
              ctx.request(
                methods.agent.session.setConfigOption,
                { sessionId, configId: 'model', value: requestedModel },
                options
              )
            );
            model = currentModel(applied.configOptions) ?? requestedModel;
          } catch (error) {
            throw classifyDevinAcpError(error, 'devin_unsupported_model');
          }
        }

        const onAbort = (): void => {
          aborted = true;
          requestCancel();
        };
        if (input.abortSignal?.aborted === true) aborted = true;
        if (aborted) requestCancel();
        else input.abortSignal?.addEventListener('abort', onAbort);

        let promptResponse: PromptResponse | undefined;
        try {
          if (!aborted) {
            const outbound =
              input.resumeInteractions !== undefined && input.resumeInteractions.length > 0
                ? buildDevinAskResumePrompt(input.resumeInteractions)
                : input.outputSchema !== undefined
                  ? augmentPromptForJsonSchema(input.prompt, input.outputSchema)
                  : input.prompt;
            try {
              promptResponse = await Promise.race([
                ctx.request(methods.agent.session.prompt, {
                  sessionId,
                  prompt: [{ type: 'text', text: outbound }],
                }),
                localCancellation.then(async () => {
                  await waitMs(CANCEL_DRAIN_GRACE_MS);
                  return undefined;
                }),
              ]);
            } catch (error) {
              if (!aborted && controlError === undefined && terminalError === undefined)
                throw error;
            }
          }
        } finally {
          input.abortSignal?.removeEventListener('abort', onAbort);
          if (cancelSent !== undefined) {
            try {
              await cancelSent;
            } catch {
              // The connection may already be closing; nothing else to release.
            }
          }
          sessionLive = false;
        }

        if (controlError !== undefined) throw controlError;
        if (terminalError !== undefined) throw terminalError;
        if (aborted) {
          queue.push(abortedResult(sessionId));
          return;
        }
        const structured =
          input.outputSchema !== undefined ? tryParseStructuredOutput(transcript) : undefined;
        queue.push(successResult(sessionId, promptResponse, structured, model));
      } catch (error) {
        throw classifyDevinAcpError(error, 'devin_protocol_error');
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
    if (sessionLive) requestCancel();
    await connected;
  }
}

interface StderrEvidence {
  readonly text: string;
  readonly truncated: boolean;
  readonly secrets: readonly string[];
}

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

/** Truncation can split a secret; drop any trailing prefix of one, repeatedly. */
function stripTrailingSecretFragments(redacted: string, secrets: readonly string[]): string {
  let safe = redacted;
  while (safe.length > 0) {
    const fragment = trailingSecretFragmentLength(safe, secrets);
    if (fragment === 0) break;
    safe = safe.slice(0, safe.length - fragment);
  }
  return safe;
}

function redactedStderrExcerpt(stderr: StderrEvidence): string {
  const redacted = redactDevinSecrets(stderr.text, stderr.secrets);
  const safe = stderr.truncated ? stripTrailingSecretFragments(redacted, stderr.secrets) : redacted;
  return safe.slice(0, STDERR_CAP);
}

function withStderr(error: DevinProviderError, stderr: StderrEvidence): DevinProviderError {
  const excerpt = redactedStderrExcerpt(stderr);
  if (excerpt.length === 0) return error;
  return new DevinProviderError(error.subtype, `${error.message}\n${excerpt}`, { cause: error });
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
  if (!childHasExited(child)) child.kill('SIGKILL');
  await exited;
}

/**
 * Spawn the Devin CLI and drive one ACP turn over stdio. The child is always
 * reaped when the turn ends, aborts, pauses, or fails.
 */
export async function* runDevinAcpTurn(
  input: DevinProcessInput,
  dependencies?: DevinProcessDependencies
): AsyncGenerator<MessageChunk> {
  const spawnFn = dependencies?.spawn ?? spawn;
  const terminateGraceMs = dependencies?.terminateGraceMs ?? DEFAULT_TERMINATE_GRACE_MS;
  const secrets = [
    ...new Set([
      ...collectDevinSecretValues(input.env),
      ...(input.secretValues ?? []).filter(isRedactableSecretValue),
    ]),
  ];
  const stderrBufferCap =
    STDERR_CAP + Math.max(0, ...secrets.map((secret: string) => secret.length));

  let child: ChildProcess;
  try {
    child = spawnFn(input.binaryPath, input.spawnArgs, {
      cwd: input.cwd,
      env: input.env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
  } catch (error) {
    throw new DevinProviderError(
      'devin_spawn_failed',
      redactDevinSecrets(errorMessage(error), secrets),
      {
        cause: error,
      }
    );
  }

  let stderrText = '';
  let stderrTruncated = false;
  child.stderr?.on('data', (chunk: Buffer | string) => {
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

  let finished = false;
  let resolveDeath: ((error: DevinProviderError) => void) | undefined;
  const death = new Promise<DevinProviderError>((resolve: (error: DevinProviderError) => void) => {
    resolveDeath = resolve;
  });
  child.once('error', (error: Error) => {
    if (!finished)
      resolveDeath?.(new DevinProviderError('devin_spawn_failed', error.message, { cause: error }));
  });
  child.once('exit', (code: number | null, signal: NodeJS.Signals | null) => {
    if (!finished) {
      resolveDeath?.(
        new DevinProviderError(
          'devin_child_exited',
          `Devin CLI exited before the ACP turn completed (code=${String(code)}, signal=${String(signal)}).`
        )
      );
    }
  });

  if (child.stdin === null || child.stdout === null) {
    finished = true;
    await reapChild(child, terminateGraceMs);
    throw new DevinProviderError('devin_spawn_failed', 'Devin CLI process is missing stdio pipes.');
  }

  const stream = ndJsonStream(
    Writable.toWeb(child.stdin) as unknown as WritableStream<Uint8Array>,
    Readable.toWeb(child.stdout) as unknown as ReadableStream<Uint8Array>
  );
  const gen = driveDevinAcpTurn(stream, input);

  try {
    while (true) {
      const winner = await Promise.race([
        gen
          .next()
          .then((result: IteratorResult<MessageChunk>) => ({ kind: 'chunk' as const, result })),
        death.then((error: DevinProviderError) => ({ kind: 'death' as const, error })),
      ]);
      if (winner.kind === 'death') throw winner.error;
      if (winner.result.done) break;
      yield winner.result.value;
    }
    finished = true;
  } catch (error) {
    finished = true;
    if (isAskHumanControlError(error)) throw error;
    const stderr: StderrEvidence = { text: stderrText, truncated: stderrTruncated, secrets };
    if (error instanceof DevinProviderError) throw withStderr(error, stderr);
    throw withStderr(
      new DevinProviderError('devin_acp_error', redactDevinSecrets(errorMessage(error), secrets), {
        cause: error,
      }),
      stderr
    );
  } finally {
    finished = true;
    try {
      await gen.return(undefined);
    } catch {
      // The turn already failed or completed.
    }
    await reapChild(child, terminateGraceMs);
  }
}
