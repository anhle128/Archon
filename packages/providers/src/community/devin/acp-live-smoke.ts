/**
 * Live smoke for the Devin CLI provider. Diagnostic only — never imported by
 * production code or tests. Requires a logged-in `devin` on PATH and network
 * access; set DEVIN_LIVE_TEST=1 to run. Uses a throwaway git repository and
 * prompts that read nothing and write nothing.
 */
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  AskHumanAwaitingError,
  type MessageChunk,
  type NativeTool,
  type SendQueryOptions,
} from '../../types';
import { DevinProvider } from './provider';

type ResultChunk = Extract<MessageChunk, { type: 'result' }>;

const PONG_PROMPT = 'Reply with exactly the word PONG. Do not use any tools.';
const PONG_AGAIN_PROMPT = 'Reply with exactly the word PONG again. Do not use any tools.';
const ASK_PROMPT =
  'Before answering, you MUST ask me one clarifying question with your ask_user_question tool: ' +
  '"Which color do you prefer?" with options red and blue (single choice). After I answer, reply ' +
  'with exactly: CHOSEN=<my answer> and nothing else. Do not use any other tools.';

function step(name: string, ok: boolean, detail = ''): void {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) process.exitCode = 1;
}

async function collect(
  stream: AsyncGenerator<MessageChunk>
): Promise<{ chunks: MessageChunk[]; thrown?: unknown }> {
  const chunks: MessageChunk[] = [];
  try {
    for await (const chunk of stream) chunks.push(chunk);
  } catch (error) {
    return { chunks, thrown: error };
  }
  return { chunks };
}

function lastResult(chunks: MessageChunk[]): ResultChunk | undefined {
  return chunks.filter((chunk): chunk is ResultChunk => chunk.type === 'result').at(-1);
}

function transcript(chunks: MessageChunk[]): string {
  return chunks
    .map(chunk => (chunk.type === 'assistant' ? chunk.content : ''))
    .join('')
    .trim();
}

function hasPerTurnUsage(result: ResultChunk | undefined): boolean {
  const usage = result?.usageBreakdown?.[0];
  return (
    typeof usage?.inputTokens === 'number' &&
    typeof usage.outputTokens === 'number' &&
    usage.costUsd === undefined
  );
}

function isExpectedQuestion(value: unknown): boolean {
  if (!Array.isArray(value) || value.length !== 1) return false;
  const question = value[0];
  if (question === null || typeof question !== 'object' || Array.isArray(question)) return false;
  const row = question as Record<string, unknown>;
  return (
    row.prompt === 'Which color do you prefer?' &&
    row.selection === 'single' &&
    Array.isArray(row.options) &&
    row.options.length === 2 &&
    row.options[0] === 'red' &&
    row.options[1] === 'blue'
  );
}

async function main(): Promise<void> {
  if (process.env.DEVIN_LIVE_TEST !== '1') {
    console.log('Devin live smoke skipped (set DEVIN_LIVE_TEST=1 to run).');
    return;
  }
  const cwd = await mkdtemp(join(tmpdir(), 'archon-devin-smoke-'));
  execFileSync('git', ['init', '-q'], { cwd });
  const provider = new DevinProvider();
  const options: SendQueryOptions = process.env.DEVIN_LIVE_MODEL
    ? { model: process.env.DEVIN_LIVE_MODEL }
    : {};

  try {
    const fresh = await collect(provider.sendQuery(PONG_PROMPT, cwd, undefined, options));
    const freshResult = lastResult(fresh.chunks);
    const freshText = transcript(fresh.chunks);
    step('fresh turn returns PONG', freshText === 'PONG', freshText);
    step(
      'fresh turn reports a session id',
      typeof freshResult?.sessionId === 'string' && freshResult.sessionId.length > 0
    );
    step('fresh turn reports per-turn usage without cost', hasPerTurnUsage(freshResult));
    const sessionId = freshResult?.sessionId;
    if (sessionId === undefined) return;

    const resumed = await collect(provider.sendQuery(PONG_AGAIN_PROMPT, cwd, sessionId, options));
    const resumedResult = lastResult(resumed.chunks);
    const resumedText = transcript(resumed.chunks);
    step(
      'resumed turn loads the stored session',
      resumedResult?.resumed === true && resumedResult.sessionId === sessionId
    );
    step('resumed turn shows only new output', resumedText === 'PONG', resumedText);
    step('resumed turn reports per-turn usage without cost', hasPerTurnUsage(resumedResult));

    const envTurn = await collect(
      provider.sendQuery(
        'Run the shell command `printf %s "$ARCHON_SMOKE_MARKER"` exactly once with your exec tool and reply with exactly its output and nothing else.',
        cwd,
        undefined,
        { ...options, env: { ARCHON_SMOKE_MARKER: 'archon-env-ok' } }
      )
    );
    const envText = transcript(envTurn.chunks);
    step('injected env reaches the exec tool', envText === 'archon-env-ok', envText);

    const gone = await collect(
      provider.sendQuery(PONG_PROMPT, cwd, 'no-such-session-xyz', options)
    );
    step(
      'failed session load is terminal',
      lastResult(gone.chunks)?.errorSubtype === 'devin_session_load_failed'
    );

    const badModel = await collect(
      provider.sendQuery(PONG_PROMPT, cwd, undefined, {
        ...options,
        model: 'no-such-model-xyz',
      })
    );
    const badModelResult = lastResult(badModel.chunks);
    step(
      'unknown model fails loudly',
      badModelResult?.errorSubtype === 'devin_unsupported_model',
      badModelResult?.errors?.[0]?.slice(0, 80)
    );

    const seen: { toolUseId?: string; sessionId?: string; questions?: unknown }[] = [];
    const askTool: NativeTool = {
      name: 'AskHuman',
      description: 'smoke',
      inputSchema: { type: 'object' },
      handler: async (input, context) => {
        seen.push({
          toolUseId: context?.toolUseId,
          sessionId: context?.sessionId,
          questions: input.questions,
        });
        throw new AskHumanAwaitingError(context?.toolUseId ?? 'missing', 'smoke-node', 'smoke-run');
      },
    };
    const paused = await collect(
      provider.sendQuery(ASK_PROMPT, cwd, undefined, { ...options, nativeTools: [askTool] })
    );
    step('AskHuman pause throws the control error', paused.thrown instanceof AskHumanAwaitingError);
    step(
      'AskHuman handler received the tool-call id and session id',
      seen[0]?.toolUseId !== undefined && seen[0]?.sessionId !== undefined
    );
    step('AskHuman maps the single-select question', isExpectedQuestion(seen[0]?.questions));
    step('no result chunk after the pause', lastResult(paused.chunks) === undefined);
    const askSession = seen[0]?.sessionId;
    const askToolUseId = seen[0]?.toolUseId;
    if (askSession === undefined || askToolUseId === undefined) return;

    const reentered = await collect(
      provider.sendQuery(ASK_PROMPT, cwd, askSession, {
        ...options,
        nativeTools: [askTool],
        resumeInteractions: [
          {
            tool_use_id: askToolUseId,
            payload: [{ questionId: 'q0', value: 'blue' }],
            declined: false,
          },
        ],
      })
    );
    const reenteredText = transcript(reentered.chunks);
    step(
      're-entry answers without asking again',
      reenteredText === 'CHOSEN=blue' && seen.length === 1,
      reenteredText
    );
    step('re-entry reports resumed', lastResult(reentered.chunks)?.resumed === true);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
}

await main();
