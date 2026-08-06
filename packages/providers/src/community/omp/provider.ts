import { createLogger } from '@archon/paths';

import type {
  IAgentProvider,
  MessageChunk,
  ProviderCapabilities,
  SendQueryOptions,
  SystemPromptInput,
} from '../../types';
import { augmentPromptForJsonSchema } from '../../shared/structured-output';
import { OMP_CAPABILITIES } from './capabilities';
import { resolveOmpBinaryPath } from './binary-resolver';
import { parseOmpConfig, type OmpProviderDefaults } from './config';
import { OmpEventParser } from './event-parser';

const MAX_CAPTURE_CHARS = 1_000_000;
const TERMINATION_GRACE_MS = 5_000;

let cachedLog: ReturnType<typeof createLogger> | undefined;
function getLog(): ReturnType<typeof createLogger> {
  cachedLog ??= createLogger('provider.omp');
  return cachedLog;
}

export interface OmpProcess {
  stdout: ReadableStream<Uint8Array> | null;
  stderr: ReadableStream<Uint8Array> | null;
  exited: Promise<number>;
  kill: (signal?: NodeJS.Signals) => void;
}

export interface OmpSpawnOptions {
  cwd: string;
  env: Record<string, string>;
}

export type OmpSpawner = (command: string[], options: OmpSpawnOptions) => OmpProcess;

interface BuildOmpArgsInput {
  prompt: string;
  cwd: string;
  config: OmpProviderDefaults;
  requestOptions?: SendQueryOptions;
  resumeSessionId?: string;
}

interface BuildOmpArgsResult {
  args: string[];
  model?: string;
  thinking?: string;
}

function defaultSpawner(command: string[], options: OmpSpawnOptions): OmpProcess {
  const proc = Bun.spawn(command, {
    cwd: options.cwd,
    env: options.env,
    stdin: 'ignore',
    stdout: 'pipe',
    stderr: 'pipe',
  });
  return {
    stdout: proc.stdout,
    stderr: proc.stderr,
    exited: proc.exited,
    kill: (signal?: NodeJS.Signals): void => {
      proc.kill(signal);
    },
  };
}

function buildProviderEnv(requestEnv?: Record<string, string>): Record<string, string> {
  const baseEnv = Object.fromEntries(
    Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined)
  );
  return { ...baseEnv, ...(requestEnv ?? {}) };
}

function buildSpawnCommand(binaryPath: string, args: string[]): string[] {
  if (process.platform === 'win32' && /\.(?:cmd|bat)$/i.test(binaryPath)) {
    return ['cmd.exe', '/d', '/s', '/c', binaryPath, ...args];
  }
  return [binaryPath, ...args];
}

function resolveSystemPrompt(
  input: SystemPromptInput | undefined
): { flag: '--system-prompt' | '--append-system-prompt'; value: string } | undefined {
  if (typeof input === 'string') {
    return input.length > 0 ? { flag: '--system-prompt', value: input } : undefined;
  }
  if (Array.isArray(input)) {
    const value = input.filter(part => part.length > 0).join('\n\n');
    return value.length > 0 ? { flag: '--system-prompt', value } : undefined;
  }
  if (input?.type === 'preset' && typeof input.append === 'string' && input.append.length > 0) {
    return { flag: '--append-system-prompt', value: input.append };
  }
  return undefined;
}

function resolveThinking(
  requestOptions: SendQueryOptions | undefined,
  config: OmpProviderDefaults
): string | undefined {
  const rawThinking = requestOptions?.nodeConfig?.thinking;
  if (typeof rawThinking === 'string') {
    if (rawThinking.length === 0) throw new Error('OMP thinking must be a non-empty string.');
    return rawThinking;
  }
  const rawEffort = requestOptions?.nodeConfig?.effort;
  if (typeof rawEffort === 'string') {
    if (rawEffort.length === 0) throw new Error('OMP effort must be a non-empty string.');
    return rawEffort;
  }
  return config.modelReasoningEffort;
}

export function buildOmpArgs(input: BuildOmpArgsInput): BuildOmpArgsResult {
  if (input.resumeSessionId && input.requestOptions?.persistSession === false) {
    throw new Error('OMP cannot resume a session when persistSession is false.');
  }

  const args = ['--mode', 'json', '--cwd', input.cwd, '--yolo', '--no-title'];
  if (input.config.enableExtensions !== true) args.push('--no-extensions');

  const model = input.requestOptions?.model ?? input.config.model;
  if (model) args.push('--model', model);

  const thinking = resolveThinking(input.requestOptions, input.config);
  if (thinking) args.push('--thinking', thinking);

  const systemPrompt = resolveSystemPrompt(
    input.requestOptions?.systemPrompt ?? input.requestOptions?.nodeConfig?.systemPrompt
  );
  if (systemPrompt) args.push(systemPrompt.flag, systemPrompt.value);

  const skills = input.requestOptions?.nodeConfig?.skills;
  if (skills && skills.length > 0) args.push('--skills', skills.join(','));

  if (input.requestOptions?.persistSession === false) args.push('--no-session');
  else if (input.resumeSessionId) {
    args.push(input.requestOptions?.forkSession === true ? '--fork' : '--resume');
    args.push(input.resumeSessionId);
  }

  args.push('--', input.prompt);
  return { args, model, thinking };
}

async function readStream(stream: ReadableStream<Uint8Array> | null): Promise<string> {
  if (!stream) return '';
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let output = '';
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      if (output.length < MAX_CAPTURE_CHARS) {
        output += decoder
          .decode(next.value, { stream: true })
          .slice(0, MAX_CAPTURE_CHARS - output.length);
      }
    }
    if (output.length < MAX_CAPTURE_CHARS) {
      output += decoder.decode().slice(0, MAX_CAPTURE_CHARS - output.length);
    }
    return output;
  } finally {
    reader.releaseLock();
  }
}

async function* streamLines(stream: ReadableStream<Uint8Array> | null): AsyncGenerator<string> {
  if (!stream) return;
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      buffer += decoder.decode(next.value, { stream: true });
      let newlineIndex = buffer.indexOf('\n');
      while (newlineIndex >= 0) {
        const line = buffer.slice(0, newlineIndex).replace(/\r$/, '');
        buffer = buffer.slice(newlineIndex + 1);
        yield line;
        newlineIndex = buffer.indexOf('\n');
      }
    }
    buffer += decoder.decode();
    if (buffer.length > 0) yield buffer.replace(/\r$/, '');
  } finally {
    reader.releaseLock();
  }
}

function scheduleKill(proc: OmpProcess): ReturnType<typeof setTimeout> {
  proc.kill('SIGTERM');
  const timer = setTimeout(() => {
    proc.kill('SIGKILL');
  }, TERMINATION_GRACE_MS);
  if (typeof timer === 'object' && 'unref' in timer && typeof timer.unref === 'function') {
    timer.unref();
  }
  return timer;
}

function buildExitErrorMessage(exitCode: number, stderr: string): string {
  const detail = stderr.trim().slice(0, 1000);
  const lower = detail.toLowerCase();
  if (
    lower.includes('credential') ||
    lower.includes('authenticated model') ||
    lower.includes('/login')
  ) {
    return (
      'OMP CLI is not ready for headless use. Run `omp setup` or start `omp` and complete ' +
      '`/login`, then retry.' +
      (detail ? ` OMP said: ${detail}` : '')
    );
  }
  return detail
    ? `OMP CLI exited with code ${String(exitCode)}: ${detail}`
    : `OMP CLI exited with code ${String(exitCode)}.`;
}

export class OmpProvider implements IAgentProvider {
  private readonly spawn: OmpSpawner;

  constructor(options?: { spawn?: OmpSpawner }) {
    this.spawn = options?.spawn ?? defaultSpawner;
  }

  getType(): string {
    return 'omp';
  }

  getCapabilities(): ProviderCapabilities {
    return OMP_CAPABILITIES;
  }

  async *sendQuery(
    prompt: string,
    cwd: string,
    resumeSessionId?: string,
    requestOptions?: SendQueryOptions
  ): AsyncGenerator<MessageChunk> {
    if (requestOptions?.abortSignal?.aborted) throw new Error('Query aborted');

    const config = parseOmpConfig(requestOptions?.assistantConfig ?? {});
    const env = buildProviderEnv(requestOptions?.env);
    const binaryPath = await resolveOmpBinaryPath(config.ompBinaryPath, env);
    const outputFormat = requestOptions?.outputFormat;
    const wantsStructured = outputFormat?.type === 'json_schema';
    const effectivePrompt = wantsStructured
      ? augmentPromptForJsonSchema(prompt, outputFormat.schema)
      : prompt;
    const { args, model, thinking } = buildOmpArgs({
      prompt: effectivePrompt,
      cwd,
      config,
      requestOptions,
      resumeSessionId,
    });

    const rawThinking = requestOptions?.nodeConfig?.thinking;
    if (rawThinking !== null && typeof rawThinking === 'object') {
      yield {
        type: 'system',
        content:
          '⚠️ Warning: OMP ignored object-form `thinking`; use a string `thinking` or provider-owned `effort` value.',
      };
    }

    const command = buildSpawnCommand(binaryPath, args);
    getLog().info(
      {
        cwd,
        model,
        thinking,
        resumed: resumeSessionId !== undefined,
        forked: requestOptions?.forkSession === true,
      },
      'omp.query_started'
    );

    const parser = new OmpEventParser(wantsStructured);
    const proc = this.spawn(command, { cwd, env });
    const stderrPromise = readStream(proc.stderr);
    const abortSignal = requestOptions?.abortSignal;
    let processExited = false;
    let killTimer: ReturnType<typeof setTimeout> | undefined;
    let protocolError: Error | undefined;
    const onAbort = (): void => {
      killTimer ??= scheduleKill(proc);
    };

    if (abortSignal) {
      if (abortSignal.aborted) onAbort();
      else abortSignal.addEventListener('abort', onAbort, { once: true });
    }

    try {
      for await (const line of streamLines(proc.stdout)) {
        if (line.trim().length === 0) continue;
        try {
          for (const chunk of parser.consumeLine(line)) yield chunk;
        } catch (error: unknown) {
          protocolError = error instanceof Error ? error : new Error(String(error));
          killTimer ??= scheduleKill(proc);
          break;
        }
      }

      const exitCode = await proc.exited;
      processExited = true;
      const stderr = await stderrPromise;
      if (abortSignal?.aborted) throw new Error('Query aborted');

      if (protocolError) {
        const message = protocolError.message;
        yield { type: 'system', content: message };
        yield {
          type: 'result',
          ...(parser.getSessionId() ? { sessionId: parser.getSessionId() } : {}),
          isError: true,
          errorSubtype: 'omp_protocol_error',
          errors: [message],
          ...(resumeSessionId !== undefined ? { resumed: false } : {}),
        };
        return;
      }

      if (exitCode !== 0) {
        const message = buildExitErrorMessage(exitCode, stderr);
        yield { type: 'system', content: message };
        yield {
          type: 'result',
          ...(parser.getSessionId() ? { sessionId: parser.getSessionId() } : {}),
          isError: true,
          errorSubtype: 'omp_exit_nonzero',
          errors: [message],
          ...(resumeSessionId !== undefined ? { resumed: false } : {}),
        };
        return;
      }

      yield parser.buildResult(resumeSessionId === undefined ? undefined : true);
      getLog().info({ sessionId: parser.getSessionId() }, 'omp.query_completed');
    } finally {
      if (abortSignal) abortSignal.removeEventListener('abort', onAbort);
      if (killTimer && processExited) clearTimeout(killTimer);
      if (!processExited && !killTimer) scheduleKill(proc);
    }
  }
}
