/**
 * Diagnostic-only DeepSeek ACP live handshake spike.
 * Do not export from the providers package barrel. Do not call from tests or CI.
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { MessageChunk, SendQueryOptions } from '../../types';
import { DeepseekProvider } from './provider';

const FRESH_PROMPT = 'Reply with exactly pong.';
const RESUME_PROMPT = 'Reply with exactly pong again.';

type ResultChunk = Extract<MessageChunk, { type: 'result' }>;

function envValue(name: string): string | undefined {
  const value = process.env[name];
  if (value === undefined || value.length === 0) {
    return undefined;
  }
  return value;
}

async function collectResults(stream: AsyncGenerator<MessageChunk>): Promise<ResultChunk[]> {
  const results: ResultChunk[] = [];
  for await (const chunk of stream) {
    if (chunk.type === 'result') {
      results.push(chunk);
    }
  }
  return results;
}

function requireNonErrorResult(results: ResultChunk[]): ResultChunk {
  const result = results.find((chunk: ResultChunk) => chunk.isError !== true);
  if (result === undefined) {
    throw new Error('turn produced no non-error result');
  }
  return result;
}

async function runLiveSpike(): Promise<void> {
  const apiKey = envValue('DEEPSEEK_API_KEY');
  const baseUrl = envValue('DEEPSEEK_BASE_URL');
  const model = envValue('DEEPSEEK_LIVE_MODEL');
  if (apiKey === undefined || baseUrl === undefined || model === undefined) {
    console.error(
      'DeepSeek ACP live spike requires DEEPSEEK_API_KEY, DEEPSEEK_BASE_URL, and DEEPSEEK_LIVE_MODEL.'
    );
    process.exitCode = 1;
    return;
  }

  const cwd = await mkdtemp(join(tmpdir(), 'archon-deepseek-acp-spike-'));
  try {
    const provider = new DeepseekProvider();
    const options: SendQueryOptions = {
      model,
      env: {
        DEEPSEEK_API_KEY: apiKey,
        DEEPSEEK_BASE_URL: baseUrl,
      },
      assistantConfig: {
        baseUrl,
        model,
      },
    };

    const fresh = requireNonErrorResult(
      await collectResults(provider.sendQuery(FRESH_PROMPT, cwd, undefined, options))
    );
    if (fresh.sessionId === undefined || fresh.sessionId.length === 0) {
      throw new Error('fresh turn missing session id');
    }

    const resumed = requireNonErrorResult(
      await collectResults(provider.sendQuery(RESUME_PROMPT, cwd, fresh.sessionId, options))
    );
    if (resumed.resumed !== true) {
      throw new Error('resume turn did not report resumed: true');
    }

    console.log('DeepSeek ACP live spike passed');
  } catch {
    console.error('DeepSeek ACP live spike failed');
    process.exitCode = 1;
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
}

async function main(): Promise<void> {
  if (envValue('DEEPSEEK_LIVE_TEST') !== '1') {
    console.log('DeepSeek ACP live spike skipped (set DEEPSEEK_LIVE_TEST=1 to run).');
    return;
  }
  await runLiveSpike();
}

await main();
