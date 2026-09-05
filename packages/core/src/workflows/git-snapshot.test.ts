import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMockLogger } from '../test/mocks/logger';
import type { GitSnapshotContext } from '@archon/workflows/deps';

const mockLogger = createMockLogger();
mock.module('@archon/paths', () => ({
  createLogger: mock(() => mockLogger),
}));

import { captureRunEndGitSnapshot } from './git-snapshot';

function context(overrides: Partial<GitSnapshotContext> = {}): GitSnapshotContext {
  return {
    runId: 'run-1',
    workingPath: null,
    outputRoot: null,
    status: 'completed',
    ...overrides,
  };
}

describe('captureRunEndGitSnapshot v1', () => {
  let outputRoot: string;
  let workingPaths: string[];

  function infoEventCalls(eventName: string): [Record<string, unknown>, string][] {
    const calls = mockLogger.info.mock.calls as unknown as [Record<string, unknown>, string][];
    return calls.filter(call => call[1] === eventName);
  }

  beforeEach(() => {
    mockLogger.info.mockClear();
    mockLogger.error.mockClear();
    mockLogger.warn.mockClear();
    outputRoot = mkdtempSync(join(tmpdir(), 'archon-git-snapshot-out-'));
    workingPaths = [];
  });

  afterEach(() => {
    for (const workingPath of workingPaths) {
      rmSync(workingPath, { recursive: true, force: true });
    }
    rmSync(outputRoot, { recursive: true, force: true });
  });

  function makeWorkingPath(): string {
    const workingPath = mkdtempSync(join(tmpdir(), 'archon-git-snapshot-wt-'));
    workingPaths.push(workingPath);
    return workingPath;
  }

  test('skips when workingPath is null', async () => {
    await captureRunEndGitSnapshot(context({ workingPath: null, outputRoot }));
    expect(readdirSync(outputRoot)).toEqual([]);
    const skip = infoEventCalls('git_snapshot.capture_skipped')[0];
    expect(skip?.[0]).toEqual({ workflowRunId: 'run-1', reason: 'missing_working_path' });
  });

  test('skips when workingPath is empty', async () => {
    await captureRunEndGitSnapshot(context({ workingPath: '', outputRoot }));
    expect(readdirSync(outputRoot)).toEqual([]);
    const skip = infoEventCalls('git_snapshot.capture_skipped')[0];
    expect(skip?.[0]).toEqual({ workflowRunId: 'run-1', reason: 'missing_working_path' });
  });

  test('skips when the checkout directory is gone', async () => {
    await captureRunEndGitSnapshot(
      context({ workingPath: join(outputRoot, 'no-such-checkout'), outputRoot })
    );
    expect(readdirSync(outputRoot)).toEqual([]);
    const skip = infoEventCalls('git_snapshot.capture_skipped')[0];
    expect(skip?.[0]).toEqual({ workflowRunId: 'run-1', reason: 'checkout_gone' });
  });

  test('preserves checkout and output-root contents when the checkout exists', async () => {
    const workingPath = makeWorkingPath();
    writeFileSync(join(workingPath, 'README.md'), 'hello');
    writeFileSync(join(outputRoot, 'keep.txt'), 'keep');
    await captureRunEndGitSnapshot(context({ workingPath, outputRoot }));
    expect(readdirSync(outputRoot)).toEqual(['keep.txt']);
    expect(readdirSync(workingPath)).toEqual(['README.md']);
    expect(readFileSync(join(outputRoot, 'keep.txt'), 'utf8')).toBe('keep');
    expect(readFileSync(join(workingPath, 'README.md'), 'utf8')).toBe('hello');
    const skip = infoEventCalls('git_snapshot.capture_skipped')[0];
    expect(skip?.[0]).toEqual({
      workflowRunId: 'run-1',
      status: 'completed',
      reason: 'v1_noop',
    });
  });

  test('remains a no-op across repeated terminal calls', async () => {
    const workingPath = makeWorkingPath();
    await captureRunEndGitSnapshot(context({ workingPath, outputRoot }));
    await captureRunEndGitSnapshot(context({ workingPath, outputRoot, status: 'failed' }));
    expect(readdirSync(outputRoot)).toEqual([]);
    const skips = infoEventCalls('git_snapshot.capture_skipped').filter(
      call => call[0].reason === 'v1_noop'
    );
    expect(skips).toHaveLength(2);
    expect(skips[0]?.[0]).toMatchObject({ status: 'completed' });
    expect(skips[1]?.[0]).toMatchObject({ status: 'failed' });
  });

  test('does not log workingPath or outputRoot', async () => {
    const workingPath = makeWorkingPath();
    await captureRunEndGitSnapshot(context({ workingPath, outputRoot }));
    const serialized = JSON.stringify([
      mockLogger.info.mock.calls,
      mockLogger.error.mock.calls,
      mockLogger.warn.mock.calls,
    ]);
    expect(serialized).not.toContain(workingPath);
    expect(serialized).not.toContain(outputRoot);
  });
});
