import { afterEach, beforeEach, expect, mock, test } from 'bun:test';
import { mkdtemp, realpath, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { OpenAPIHono } from '@hono/zod-openapi';

import type { ConversationLockManager } from '@archon/core';
import type {
  ChangedFilesResult,
  FileAtBytesResult,
  FileAtRequest,
  FileAtResult,
  FileAtSource,
  FileDiffRequest,
  FileDiffResult,
  GitLogResult,
} from '@archon/git';
import type { WorkflowRun } from '@archon/workflows/schemas/workflow-run';

import type { WebAdapter } from '../adapters/web';
import { mockAllWorkflowModules } from '../test/workflow-mock-factories';
import { validationErrorHook } from './openapi-defaults';

const REVISION = 'a'.repeat(64);

const mockGetWorkflowRun = mock(async (_id: string): Promise<WorkflowRun | null> => null);
const mockGetConversationById = mock(
  async (_id: string): Promise<{ isolation_env_id: string | null } | null> => null
);
const mockGetById = mock(async (_id: string): Promise<{ provider: string } | null> => null);
const mockChangedFiles = mock(
  async (_workingPath: string): Promise<ChangedFilesResult> => ({
    files: [],
    revision: REVISION,
  })
);
const mockLog = mock(
  async (_workingPath: string): Promise<GitLogResult> => ({
    commits: [],
    revision: REVISION,
    truncated: false,
  })
);
const mockIsGitWorkTree = mock(async (_workingPath: string): Promise<boolean> => true);
const TEXT_BYTES = Uint8Array.from([0x68, 0x69, 0x0a]);
const TEXT_HASH = 'a'.repeat(64);

function readyFileAt(overrides: Partial<FileAtBytesResult> = {}): FileAtBytesResult {
  return {
    delivery: 'bytes',
    path: 'x.ts',
    bytes: TEXT_BYTES,
    binary: false,
    contentHash: TEXT_HASH,
    byteLength: TEXT_BYTES.byteLength,
    truncated: false,
    cursor: '',
    presentation: 'text',
    mediaType: '',
    ...overrides,
  };
}

const mockFileAt = mock(
  async (
    _workingPath: string,
    _path: string,
    _source: FileAtSource,
    _request?: FileAtRequest
  ): Promise<FileAtResult> => readyFileAt()
);
const mockFileDiff = mock(
  async (
    _workingPath: string,
    _path: string,
    _request?: FileDiffRequest
  ): Promise<FileDiffResult> => ({
    path: 'x.ts',
    status: 'M',
    scope: 'now',
    ref: 'live',
    hunks: [],
    cursor: '',
    truncated: false,
    binary: false,
    fileFallback: false,
  })
);

const mockLogger = {
  fatal: mock((_object?: unknown, _message?: string): void => undefined),
  error: mock((_object?: unknown, _message?: string): void => undefined),
  warn: mock((_object?: unknown, _message?: string): void => undefined),
  info: mock((_object?: unknown, _message?: string): void => undefined),
  debug: mock((_object?: unknown, _message?: string): void => undefined),
  trace: mock((_object?: unknown, _message?: string): void => undefined),
  child: mock(function (this: unknown): unknown {
    return this;
  }),
  bindings: mock((): Record<string, string> => ({ module: 'test' })),
  isLevelEnabled: mock((_level: string): boolean => true),
  level: 'info',
};

mock.module('@archon/core/db/workflows', () => ({
  getWorkflowRun: mockGetWorkflowRun,
}));
mock.module('@archon/core/db/conversations', () => ({
  getConversationById: mockGetConversationById,
}));
mock.module('@archon/core/db/isolation-environments', () => ({
  getById: mockGetById,
}));
mock.module('@archon/git', () => ({
  fileAt: mockFileAt,
  fileDiff: mockFileDiff,
  changedFiles: mockChangedFiles,
  isGitWorkTree: mockIsGitWorkTree,
  log: mockLog,
}));
mock.module('@archon/paths', () => ({
  createLogger: (): typeof mockLogger => mockLogger,
}));
mockAllWorkflowModules();

import { registerApiRoutes } from './api';

let checkoutDir = '';

function runRow(overrides: Partial<WorkflowRun> = {}): WorkflowRun {
  return {
    id: 'run-1',
    workflow_name: 'test',
    conversation_id: 'conv-1',
    parent_conversation_id: null,
    codebase_id: null,
    status: 'running',
    user_message: 'test',
    metadata: {},
    started_at: new Date('2026-09-06T00:00:00.000Z'),
    completed_at: null,
    last_activity_at: null,
    working_path: checkoutDir,
    user_id: null,
    parent_run_id: null,
    output_root: null,
    ...overrides,
  };
}

function makeApp(): OpenAPIHono {
  const app = new OpenAPIHono({ defaultHook: validationErrorHook });
  const webAdapter = {
    setConversationDbId: mock((_platformId: string, _dbId: string): void => undefined),
    emitSSE: mock(async (): Promise<void> => undefined),
    emitLockEvent: mock(async (): Promise<void> => undefined),
  } as unknown as WebAdapter;
  const lockManager = {
    acquireLock: mock(async (_id: string, callback: () => Promise<void>) => {
      await callback();
      return { status: 'started' as const };
    }),
    getStats: mock(() => ({ active: 0, queued: 0 })),
  } as unknown as ConversationLockManager;
  registerApiRoutes(app, webAdapter, lockManager);
  return app;
}

function namedError(name: string, code?: string): Error {
  const error = new Error('internal');
  error.name = name;
  if (code !== undefined) Object.assign(error, { code });
  return error;
}

function gitDiffLogCalls(): Array<{ payload: Record<string, unknown>; event: string }> {
  return [...mockLogger.info.mock.calls, ...mockLogger.error.mock.calls]
    .filter(
      (call): call is [Record<string, unknown>, string] =>
        typeof call[1] === 'string' && String(call[1]).startsWith('git.diff_')
    )
    .map(([payload, event]) => ({ payload, event }));
}

function expectDiffLogPair(
  terminal: 'git.diff_completed' | 'git.diff_failed',
  runId = 'run-1'
): Record<string, unknown> {
  const events = gitDiffLogCalls();
  expect(events.map(entry => entry.event)).toEqual(['git.diff_started', terminal]);
  expect(events[0]?.payload).toEqual({ runId });
  const payload = events[1]?.payload ?? {};
  if (terminal === 'git.diff_failed') {
    expect(Object.keys(payload).sort()).toEqual(['errorType', 'runId']);
    expect(payload.runId).toBe(runId);
    expect(typeof payload.errorType).toBe('string');
  } else {
    expect(payload.runId).toBe(runId);
    for (const key of Object.keys(payload)) {
      expect(['binary', 'emptyReason', 'runId', 'truncated']).toContain(key);
    }
  }
  return payload;
}

function gitFileLogCalls(): Array<{ payload: Record<string, unknown>; event: string }> {
  return [...mockLogger.info.mock.calls, ...mockLogger.error.mock.calls]
    .filter(
      (call): call is [Record<string, unknown>, string] =>
        typeof call[1] === 'string' && String(call[1]).startsWith('git.file_')
    )
    .map(([payload, event]) => ({ payload, event }));
}

function expectFileLogPair(
  terminal: 'git.file_completed' | 'git.file_failed',
  runId = 'run-1'
): Record<string, unknown> {
  const events = gitFileLogCalls();
  expect(events.map(entry => entry.event)).toEqual(['git.file_started', terminal]);
  expect(events[0]?.payload).toEqual({ runId });
  const payload = events[1]?.payload ?? {};
  if (terminal === 'git.file_failed') {
    expect(Object.keys(payload).sort()).toEqual(['errorType', 'runId']);
    expect(payload.runId).toBe(runId);
    expect(typeof payload.errorType).toBe('string');
  } else {
    expect(payload.runId).toBe(runId);
    for (const key of Object.keys(payload)) {
      expect(['binary', 'emptyReason', 'runId']).toContain(key);
    }
  }
  return payload;
}

function gitLogCalls(): Array<{ payload: Record<string, unknown>; event: string }> {
  return [...mockLogger.info.mock.calls, ...mockLogger.error.mock.calls]
    .filter(
      (call): call is [Record<string, unknown>, string] =>
        typeof call[1] === 'string' && String(call[1]).startsWith('git.log_')
    )
    .map(([payload, event]) => ({ payload, event }));
}

function expectGitLogPair(
  terminal: 'git.log_completed' | 'git.log_failed',
  terminalPayload: Record<string, unknown>,
  runId = 'run-1'
): void {
  const events = gitLogCalls();
  expect(events).toEqual([
    { payload: { runId }, event: 'git.log_started' },
    { payload: terminalPayload, event: terminal },
  ]);
}

beforeEach(async () => {
  checkoutDir = await mkdtemp(join(tmpdir(), 'archon-git-route-'));
  mockGetWorkflowRun.mockReset();
  mockGetConversationById.mockReset();
  mockGetById.mockReset();
  mockChangedFiles.mockReset();
  mockIsGitWorkTree.mockReset();
  mockLog.mockReset();
  mockFileAt.mockReset();
  mockFileDiff.mockReset();
  mockGetWorkflowRun.mockImplementation(async (): Promise<WorkflowRun> => runRow());
  mockGetConversationById.mockImplementation(
    async (): Promise<{ isolation_env_id: null }> => ({ isolation_env_id: null })
  );
  mockGetById.mockImplementation(async (): Promise<null> => null);
  mockChangedFiles.mockImplementation(
    async (): Promise<ChangedFilesResult> => ({ files: [], revision: REVISION })
  );
  mockIsGitWorkTree.mockImplementation(async (): Promise<boolean> => true);
  mockLog.mockImplementation(
    async (): Promise<GitLogResult> => ({ commits: [], revision: REVISION, truncated: false })
  );
  mockFileAt.mockImplementation(async (): Promise<FileAtResult> => readyFileAt());
  mockFileDiff.mockImplementation(
    async (): Promise<FileDiffResult> => ({
      path: 'x.ts',
      status: 'M',
      scope: 'now',
      ref: 'live',
      hunks: [],
      cursor: '',
      truncated: false,
      binary: false,
      fileFallback: false,
    })
  );
  mockLogger.fatal.mockClear();
  mockLogger.error.mockClear();
  mockLogger.warn.mockClear();
  mockLogger.info.mockClear();
  mockLogger.debug.mockClear();
  mockLogger.trace.mockClear();
});

afterEach(async () => {
  await rm(checkoutDir, { recursive: true, force: true });
});

test('returns 404 for a missing run', async () => {
  mockGetWorkflowRun.mockResolvedValueOnce(null);
  const response = await makeApp().request('/api/workflows/runs/missing/git/changes');
  expect(response.status).toBe(404);
  expect(await response.json()).toEqual({ error: 'Workflow run not found' });
});

test('returns container CAP-6 before any git probe', async () => {
  mockGetConversationById.mockResolvedValueOnce({ isolation_env_id: 'env-1' });
  mockGetById.mockResolvedValueOnce({ provider: 'container' });

  const response = await makeApp().request('/api/workflows/runs/run-1/git/changes');

  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({
    emptyReason: 'container',
    files: [],
    revision: '',
  });
  expect(mockIsGitWorkTree).not.toHaveBeenCalled();
  expect(mockChangedFiles).not.toHaveBeenCalled();
});

test('returns no_checkout for a null working_path', async () => {
  mockGetWorkflowRun.mockResolvedValueOnce({ ...runRow(), working_path: null });

  const response = await makeApp().request('/api/workflows/runs/run-1/git/changes');

  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({
    emptyReason: 'no_checkout',
    files: [],
    revision: '',
  });
});

test('uses the canonical database checkout and ignores a hostile working_path query', async () => {
  const canonical = await realpath(checkoutDir);
  mockChangedFiles.mockResolvedValueOnce({
    files: [{ path: 'src/a.ts', status: 'M' }],
    revision: REVISION,
  });

  const response = await makeApp().request(
    '/api/workflows/runs/run-1/git/changes?working_path=%2e%2e%2fetc'
  );

  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({
    files: [{ path: 'src/a.ts', status: 'M' }],
    revision: REVISION,
  });
  expect(mockChangedFiles).toHaveBeenCalledWith(canonical);
  expect(mockLogger.info.mock.calls).toContainEqual([
    { runId: 'run-1', fileCount: 1 },
    'git.changes_completed',
  ]);
});

test('returns a ready clean-worktree envelope rather than CAP-6', async () => {
  mockChangedFiles.mockResolvedValueOnce({ files: [], revision: REVISION });

  const response = await makeApp().request('/api/workflows/runs/run-1/git/changes');

  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ files: [], revision: REVISION });
});

test('returns an opaque 500 and logs no path-bearing error message', async () => {
  mockChangedFiles.mockRejectedValueOnce(new Error(`boom at ${checkoutDir}/secret`));

  const response = await makeApp().request('/api/workflows/runs/run-1/git/changes');
  const body = await response.json();

  expect(response.status).toBe(500);
  expect(body).toEqual({ error: 'Could not read git changes' });
  expect(JSON.stringify(body)).not.toContain(checkoutDir);
  expect(JSON.stringify(mockLogger.error.mock.calls)).not.toContain(checkoutDir);
  expect(mockLogger.error.mock.calls.at(-1)?.[1]).toBe('git.changes_failed');
});

test('returns CAP-6 when the checkout vanishes during changedFiles', async () => {
  mockChangedFiles.mockImplementationOnce(async () => {
    await rm(checkoutDir, { recursive: true, force: true });
    throw new Error(`boom at ${checkoutDir}/secret`);
  });

  const response = await makeApp().request('/api/workflows/runs/run-1/git/changes');

  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({
    emptyReason: 'no_checkout',
    files: [],
    revision: '',
  });
  expect(mockLogger.info.mock.calls).toContainEqual([
    { runId: 'run-1', emptyReason: 'no_checkout' },
    'git.changes_completed',
  ]);
});

test('returns a ready Now hunk response from the canonical checkout', async () => {
  const canonical = await realpath(checkoutDir);
  mockFileDiff.mockResolvedValueOnce({
    path: 'src/a.ts',
    status: 'M',
    scope: 'now',
    ref: 'live',
    hunks: [
      {
        oldStart: 0,
        oldLines: 0,
        newStart: 1,
        newLines: 1,
        header: '@@ -0,0 +1 @@',
        changes: [{ type: 'insert', content: 'x', newLine: 1 }],
      },
    ],
    cursor: '',
    truncated: false,
    binary: false,
    fileFallback: false,
  });
  const response = await makeApp().request(
    '/api/workflows/runs/run-1/git/diff?path=src%2Fa.ts&cursor=opaque-token&working_path=%2Fetc'
  );
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({
    path: 'src/a.ts',
    status: 'M',
    scope: 'now',
    ref: 'live',
    cursor: '',
    truncated: false,
    binary: false,
  });
  expect(mockFileDiff).toHaveBeenCalledWith(
    canonical,
    'src/a.ts',
    expect.objectContaining({ cursor: 'opaque-token' })
  );
  expect(expectDiffLogPair('git.diff_completed')).toEqual({
    runId: 'run-1',
    binary: false,
    truncated: false,
  });
});

test('returns OpenAPI 400 when path is missing before the handler', async () => {
  const response = await makeApp().request('/api/workflows/runs/run-1/git/diff');
  const body = (await response.json()) as { error: string };
  expect(response.status).toBe(400);
  expect(body.error).toContain('path');
  expect(mockFileDiff).not.toHaveBeenCalled();
  expect(gitDiffLogCalls()).toEqual([]);
});

test('rejects a decoded traversal path before git', async () => {
  const response = await makeApp().request('/api/workflows/runs/run-1/git/diff?path=..%2Fx');
  expect(response.status).toBe(400);
  expect(await response.json()).toEqual({ error: 'Invalid file path' });
  expect(mockFileDiff).not.toHaveBeenCalled();
  expect(mockGetWorkflowRun).not.toHaveBeenCalled();
  expect(expectDiffLogPair('git.diff_failed').errorType).toBe('invalid_path');
});

test('rejects a decoded backslash traversal path before git', async () => {
  const response = await makeApp().request('/api/workflows/runs/run-1/git/diff?path=a%5C..%5Cx');
  expect(response.status).toBe(400);
  expect(await response.json()).toEqual({ error: 'Invalid file path' });
  expect(mockFileDiff).not.toHaveBeenCalled();
  expect(mockGetWorkflowRun).not.toHaveBeenCalled();
  expect(expectDiffLogPair('git.diff_failed').errorType).toBe('invalid_path');
});

test('rejects a decoded POSIX absolute path before git', async () => {
  const response = await makeApp().request(
    '/api/workflows/runs/run-1/git/diff?path=%2Fetc%2Fpasswd'
  );
  expect(response.status).toBe(400);
  expect(await response.json()).toEqual({ error: 'Invalid file path' });
  expect(mockFileDiff).not.toHaveBeenCalled();
  expect(mockGetWorkflowRun).not.toHaveBeenCalled();
  expect(expectDiffLogPair('git.diff_failed').errorType).toBe('invalid_path');
});

test('rejects a decoded Windows absolute path before git', async () => {
  const response = await makeApp().request(
    '/api/workflows/runs/run-1/git/diff?path=C:%5CWindows%5Cx.ts'
  );
  expect(response.status).toBe(400);
  expect(await response.json()).toEqual({ error: 'Invalid file path' });
  expect(mockFileDiff).not.toHaveBeenCalled();
  expect(mockGetWorkflowRun).not.toHaveBeenCalled();
  expect(expectDiffLogPair('git.diff_failed').errorType).toBe('invalid_path');
});

test('rejects a decoded NUL path before git', async () => {
  const response = await makeApp().request('/api/workflows/runs/run-1/git/diff?path=src%00a.ts');
  expect(response.status).toBe(400);
  expect(await response.json()).toEqual({ error: 'Invalid file path' });
  expect(mockFileDiff).not.toHaveBeenCalled();
  expect(mockGetWorkflowRun).not.toHaveBeenCalled();
  expect(expectDiffLogPair('git.diff_failed').errorType).toBe('invalid_path');
});

test('forwards a colon path to fileDiff unchanged', async () => {
  const canonical = await realpath(checkoutDir);
  const response = await makeApp().request('/api/workflows/runs/run-1/git/diff?path=%3Acolon.ts');
  expect(response.status).toBe(200);
  expect(mockFileDiff).toHaveBeenCalledWith(
    canonical,
    ':colon.ts',
    expect.objectContaining({ cursor: '' })
  );
  expectDiffLogPair('git.diff_completed');
});

test('forwards a leading-dash path to fileDiff unchanged', async () => {
  const canonical = await realpath(checkoutDir);
  const response = await makeApp().request('/api/workflows/runs/run-1/git/diff?path=-dash.ts');
  expect(response.status).toBe(200);
  expect(mockFileDiff).toHaveBeenCalledWith(
    canonical,
    '-dash.ts',
    expect.objectContaining({ cursor: '' })
  );
  expectDiffLogPair('git.diff_completed');
});

test('forwards a glob path to fileDiff unchanged', async () => {
  const canonical = await realpath(checkoutDir);
  const response = await makeApp().request('/api/workflows/runs/run-1/git/diff?path=src%2F%2A.ts');
  expect(response.status).toBe(200);
  expect(mockFileDiff).toHaveBeenCalledWith(
    canonical,
    'src/*.ts',
    expect.objectContaining({ cursor: '' })
  );
  expectDiffLogPair('git.diff_completed');
});

test('returns 404 for a missing run on the diff route', async () => {
  mockGetWorkflowRun.mockResolvedValueOnce(null);
  const response = await makeApp().request('/api/workflows/runs/missing/git/diff?path=src%2Fa.ts');
  expect(response.status).toBe(404);
  expect(await response.json()).toEqual({ error: 'Workflow run not found' });
  expect(mockFileDiff).not.toHaveBeenCalled();
  expect(expectDiffLogPair('git.diff_failed', 'missing').errorType).toBe('run_not_found');
});

test('returns container CAP-6 on the diff route without calling fileDiff', async () => {
  mockGetConversationById.mockResolvedValueOnce({ isolation_env_id: 'env-1' });
  mockGetById.mockResolvedValueOnce({ provider: 'container' });

  const response = await makeApp().request('/api/workflows/runs/run-1/git/diff?path=src%2Fa.ts');

  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ emptyReason: 'container' });
  expect(mockFileDiff).not.toHaveBeenCalled();
  expect(expectDiffLogPair('git.diff_completed')).toEqual({
    runId: 'run-1',
    emptyReason: 'container',
  });
});

test('returns no_checkout on the diff route without calling fileDiff', async () => {
  mockGetWorkflowRun.mockResolvedValueOnce({ ...runRow(), working_path: null });

  const response = await makeApp().request('/api/workflows/runs/run-1/git/diff?path=src%2Fa.ts');

  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ emptyReason: 'no_checkout' });
  expect(mockFileDiff).not.toHaveBeenCalled();
  expect(expectDiffLogPair('git.diff_completed')).toEqual({
    runId: 'run-1',
    emptyReason: 'no_checkout',
  });
});

test('returns CAP-6 when the checkout vanishes during fileDiff', async () => {
  mockFileDiff.mockImplementationOnce(async () => {
    await rm(checkoutDir, { recursive: true, force: true });
    throw new Error(`boom at ${checkoutDir}/secret`);
  });

  const response = await makeApp().request('/api/workflows/runs/run-1/git/diff?path=src%2Fa.ts');

  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ emptyReason: 'no_checkout' });
  expect(expectDiffLogPair('git.diff_completed')).toEqual({
    runId: 'run-1',
    emptyReason: 'no_checkout',
  });
});

test('maps a named GitFileError not_found to the file 404 body', async () => {
  mockFileDiff.mockRejectedValueOnce(namedError('GitFileError', 'not_found'));

  const response = await makeApp().request('/api/workflows/runs/run-1/git/diff?path=src%2Fa.ts');

  expect(response.status).toBe(404);
  expect(await response.json()).toEqual({ error: 'File not found' });
  expect(expectDiffLogPair('git.diff_failed').errorType).toBe('file_not_found');
});

test('maps a named GitPathError to the invalid-path 400 body', async () => {
  mockFileDiff.mockRejectedValueOnce(namedError('GitPathError', 'escape'));

  const response = await makeApp().request('/api/workflows/runs/run-1/git/diff?path=src%2Fa.ts');

  expect(response.status).toBe(400);
  expect(await response.json()).toEqual({ error: 'Invalid file path' });
  expect(expectDiffLogPair('git.diff_failed').errorType).toBe('invalid_path');
});

test('returns an opaque 500 for a path-bearing diff error', async () => {
  mockFileDiff.mockRejectedValueOnce(new Error(`boom at ${checkoutDir}/secret src/leaked.ts`));

  const response = await makeApp().request('/api/workflows/runs/run-1/git/diff?path=src%2Fa.ts');
  const body = await response.json();
  const serializedLogs = JSON.stringify([mockLogger.info.mock.calls, mockLogger.error.mock.calls]);

  expect(response.status).toBe(500);
  expect(body).toEqual({ error: 'Could not read git diff' });
  expect(JSON.stringify(body)).not.toContain(checkoutDir);
  expect(JSON.stringify(body)).not.toContain('src/leaked.ts');
  expect(serializedLogs).not.toContain(checkoutDir);
  expect(serializedLogs).not.toContain('src/leaked.ts');
  expect(expectDiffLogPair('git.diff_failed').errorType).toBe('git_read_failed');
});

test('returns 400 for a missing source', async () => {
  const response = await makeApp().request('/api/workflows/runs/run-1/git/file/src%2Fa.ts');
  expect(response.status).toBe(400);
  expect(await response.json()).toEqual({ error: 'Invalid file source' });
  expect(mockFileAt).not.toHaveBeenCalled();
  expect(mockGetWorkflowRun).not.toHaveBeenCalled();
  expect(expectFileLogPair('git.file_failed').errorType).toBe('invalid_source');
});

test('returns 400 for an unknown source', async () => {
  const response = await makeApp().request(
    '/api/workflows/runs/run-1/git/file/src%2Fa.ts?source=index'
  );
  expect(response.status).toBe(400);
  expect(await response.json()).toEqual({ error: 'Invalid file source' });
  expect(mockFileAt).not.toHaveBeenCalled();
  expect(mockGetWorkflowRun).not.toHaveBeenCalled();
  expect(expectFileLogPair('git.file_failed').errorType).toBe('invalid_source');
});

test('forwards an encoded slash path to fileAt unchanged', async () => {
  const canonical = await realpath(checkoutDir);
  const response = await makeApp().request(
    '/api/workflows/runs/run-1/git/file/src%2Fa.ts?source=worktree'
  );
  expect(response.status).toBe(200);
  expect(mockFileAt).toHaveBeenCalledWith(
    canonical,
    'src/a.ts',
    { kind: 'worktree' },
    expect.objectContaining({ intent: 'view', cursor: '' })
  );
  expectFileLogPair('git.file_completed');
});

test('forwards a colon path to fileAt unchanged', async () => {
  const canonical = await realpath(checkoutDir);
  const response = await makeApp().request(
    '/api/workflows/runs/run-1/git/file/%3Acolon.ts?source=worktree'
  );
  expect(response.status).toBe(200);
  expect(mockFileAt).toHaveBeenCalledWith(
    canonical,
    ':colon.ts',
    { kind: 'worktree' },
    expect.objectContaining({ intent: 'view', cursor: '' })
  );
  expectFileLogPair('git.file_completed');
});

test('forwards a leading-dash path to fileAt unchanged', async () => {
  const canonical = await realpath(checkoutDir);
  const response = await makeApp().request(
    '/api/workflows/runs/run-1/git/file/-dash.ts?source=worktree'
  );
  expect(response.status).toBe(200);
  expect(mockFileAt).toHaveBeenCalledWith(
    canonical,
    '-dash.ts',
    { kind: 'worktree' },
    expect.objectContaining({ intent: 'view', cursor: '' })
  );
  expectFileLogPair('git.file_completed');
});

test('forwards a glob path to fileAt unchanged', async () => {
  const canonical = await realpath(checkoutDir);
  const response = await makeApp().request(
    '/api/workflows/runs/run-1/git/file/src%2F%2A.ts?source=worktree'
  );
  expect(response.status).toBe(200);
  expect(mockFileAt).toHaveBeenCalledWith(
    canonical,
    'src/*.ts',
    { kind: 'worktree' },
    expect.objectContaining({ intent: 'view', cursor: '' })
  );
  expectFileLogPair('git.file_completed');
});

test('forwards a space path to fileAt unchanged', async () => {
  const canonical = await realpath(checkoutDir);
  const response = await makeApp().request(
    '/api/workflows/runs/run-1/git/file/my%20file.ts?source=worktree'
  );
  expect(response.status).toBe(200);
  expect(mockFileAt).toHaveBeenCalledWith(
    canonical,
    'my file.ts',
    { kind: 'worktree' },
    expect.objectContaining({ intent: 'view', cursor: '' })
  );
  expectFileLogPair('git.file_completed');
});

test('forwards a newline path to fileAt unchanged', async () => {
  const canonical = await realpath(checkoutDir);
  const response = await makeApp().request(
    '/api/workflows/runs/run-1/git/file/foo%0Abar.ts?source=worktree'
  );
  expect(response.status).toBe(200);
  expect(mockFileAt).toHaveBeenCalledWith(
    canonical,
    'foo\nbar.ts',
    { kind: 'worktree' },
    expect.objectContaining({ intent: 'view', cursor: '' })
  );
  expectFileLogPair('git.file_completed');
});

test('rejects an encoded slash traversal path before git', async () => {
  const response = await makeApp().request(
    '/api/workflows/runs/run-1/git/file/..%2Fx?source=worktree'
  );
  expect(response.status).toBe(400);
  expect(await response.json()).toEqual({ error: 'Invalid file path' });
  expect(mockFileAt).not.toHaveBeenCalled();
  expect(mockGetWorkflowRun).not.toHaveBeenCalled();
  expect(expectFileLogPair('git.file_failed').errorType).toBe('invalid_path');
});

test('rejects an encoded backslash traversal path before git', async () => {
  const response = await makeApp().request(
    '/api/workflows/runs/run-1/git/file/a%5C..%5Cx?source=worktree'
  );
  expect(response.status).toBe(400);
  expect(await response.json()).toEqual({ error: 'Invalid file path' });
  expect(mockFileAt).not.toHaveBeenCalled();
  expect(mockGetWorkflowRun).not.toHaveBeenCalled();
  expect(expectFileLogPair('git.file_failed').errorType).toBe('invalid_path');
});

test('rejects an encoded POSIX absolute path before git', async () => {
  const response = await makeApp().request(
    '/api/workflows/runs/run-1/git/file/%2Fetc%2Fpasswd?source=worktree'
  );
  expect(response.status).toBe(400);
  expect(await response.json()).toEqual({ error: 'Invalid file path' });
  expect(mockFileAt).not.toHaveBeenCalled();
  expect(mockGetWorkflowRun).not.toHaveBeenCalled();
  expect(expectFileLogPair('git.file_failed').errorType).toBe('invalid_path');
});

test('rejects an encoded Windows absolute path before git', async () => {
  const response = await makeApp().request(
    '/api/workflows/runs/run-1/git/file/C:%5CWindows%5Cx.ts?source=worktree'
  );
  expect(response.status).toBe(400);
  expect(await response.json()).toEqual({ error: 'Invalid file path' });
  expect(mockFileAt).not.toHaveBeenCalled();
  expect(mockGetWorkflowRun).not.toHaveBeenCalled();
  expect(expectFileLogPair('git.file_failed').errorType).toBe('invalid_path');
});

test('rejects an encoded NUL path before git', async () => {
  const response = await makeApp().request(
    '/api/workflows/runs/run-1/git/file/src%00a.ts?source=worktree'
  );
  expect(response.status).toBe(400);
  expect(await response.json()).toEqual({ error: 'Invalid file path' });
  expect(mockFileAt).not.toHaveBeenCalled();
  expect(mockGetWorkflowRun).not.toHaveBeenCalled();
  expect(expectFileLogPair('git.file_failed').errorType).toBe('invalid_path');
});

test('rejects direct Git metadata on the raw file route', async () => {
  const response = await makeApp().request(
    '/api/workflows/runs/run-1/git/file/.git%2Fconfig?source=worktree'
  );
  expect(response.status).toBe(400);
  expect(await response.json()).toEqual({ error: 'Invalid file path' });
  expect(mockFileAt).not.toHaveBeenCalled();
  expect(mockGetWorkflowRun).not.toHaveBeenCalled();
  expect(expectFileLogPair('git.file_failed').errorType).toBe('invalid_path');
});

test('rejects malformed percent encoding before git', async () => {
  const response = await makeApp().request(
    '/api/workflows/runs/run-1/git/file/src%ZZ.ts?source=worktree'
  );
  expect(response.status).toBe(400);
  expect(await response.json()).toEqual({ error: 'Invalid file path' });
  expect(mockFileAt).not.toHaveBeenCalled();
  expect(mockGetWorkflowRun).not.toHaveBeenCalled();
  expect(expectFileLogPair('git.file_failed').errorType).toBe('invalid_path');
});

test('maps source=worktree to a worktree fileAt read', async () => {
  const canonical = await realpath(checkoutDir);
  const response = await makeApp().request(
    '/api/workflows/runs/run-1/git/file/src%2Fa.ts?source=worktree'
  );
  expect(response.status).toBe(200);
  expect(mockFileAt).toHaveBeenCalledWith(
    canonical,
    'src/a.ts',
    { kind: 'worktree' },
    expect.objectContaining({ intent: 'view', cursor: '' })
  );
  expectFileLogPair('git.file_completed');
});

test('maps source=head to a HEAD tree fileAt read', async () => {
  const canonical = await realpath(checkoutDir);
  const response = await makeApp().request(
    '/api/workflows/runs/run-1/git/file/src%2Fa.ts?source=head'
  );
  expect(response.status).toBe(200);
  expect(mockFileAt).toHaveBeenCalledWith(
    canonical,
    'src/a.ts',
    {
      kind: 'tree',
      treeIsh: 'HEAD',
    },
    expect.objectContaining({ intent: 'view', cursor: '' })
  );
  expectFileLogPair('git.file_completed');
});

test('returns 404 for a missing run on the file route', async () => {
  mockGetWorkflowRun.mockResolvedValueOnce(null);
  const response = await makeApp().request(
    '/api/workflows/runs/missing/git/file/src%2Fa.ts?source=worktree'
  );
  expect(response.status).toBe(404);
  expect(await response.json()).toEqual({ error: 'Workflow run not found' });
  expect(mockFileAt).not.toHaveBeenCalled();
  expect(expectFileLogPair('git.file_failed', 'missing').errorType).toBe('run_not_found');
});

test('returns container CAP-6 on the file route without calling fileAt', async () => {
  mockGetConversationById.mockResolvedValueOnce({ isolation_env_id: 'env-1' });
  mockGetById.mockResolvedValueOnce({ provider: 'container' });

  const response = await makeApp().request(
    '/api/workflows/runs/run-1/git/file/src%2Fa.ts?source=worktree'
  );

  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ emptyReason: 'container' });
  expect(response.headers.get('ETag')).toBeNull();
  expect(mockFileAt).not.toHaveBeenCalled();
  expect(expectFileLogPair('git.file_completed')).toEqual({
    runId: 'run-1',
    emptyReason: 'container',
  });
});

test('returns no_checkout on the file route without calling fileAt', async () => {
  mockGetWorkflowRun.mockResolvedValueOnce({ ...runRow(), working_path: null });

  const response = await makeApp().request(
    '/api/workflows/runs/run-1/git/file/src%2Fa.ts?source=worktree'
  );

  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ emptyReason: 'no_checkout' });
  expect(response.headers.get('ETag')).toBeNull();
  expect(mockFileAt).not.toHaveBeenCalled();
  expect(expectFileLogPair('git.file_completed')).toEqual({
    runId: 'run-1',
    emptyReason: 'no_checkout',
  });
});

test('returns CAP-6 when the checkout vanishes during fileAt', async () => {
  mockFileAt.mockImplementationOnce(async () => {
    await rm(checkoutDir, { recursive: true, force: true });
    throw new Error(`boom at ${checkoutDir}/secret`);
  });

  const response = await makeApp().request(
    '/api/workflows/runs/run-1/git/file/src%2Fa.ts?source=worktree'
  );

  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ emptyReason: 'no_checkout' });
  expect(response.headers.get('ETag')).toBeNull();
  expect(expectFileLogPair('git.file_completed')).toEqual({
    runId: 'run-1',
    emptyReason: 'no_checkout',
  });
});

test('returns exact text bytes with the quoted content-hash ETag', async () => {
  const response = await makeApp().request(
    '/api/workflows/runs/run-1/git/file/src%2Fa.ts?source=worktree'
  );
  expect(response.status).toBe(200);
  expect(response.headers.get('Content-Type')).toBe('text/plain; charset=utf-8');
  expect(response.headers.get('ETag')).toBe(`"${TEXT_HASH}"`);
  expect(response.headers.get('Content-Disposition')).toBeNull();
  expect(Array.from(new Uint8Array(await response.arrayBuffer()))).toEqual([0x68, 0x69, 0x0a]);
  expect(expectFileLogPair('git.file_completed')).toEqual({
    runId: 'run-1',
    binary: false,
  });
});

test('returns exact non-empty binary bytes as an attachment', async () => {
  mockFileAt.mockImplementationOnce(
    async (): Promise<FileAtResult> =>
      readyFileAt({
        path: 'x.bin',
        bytes: Uint8Array.from([0, 1, 2]),
        binary: true,
        contentHash: 'b'.repeat(64),
        byteLength: 3,
        presentation: 'download',
      })
  );
  const response = await makeApp().request(
    '/api/workflows/runs/run-1/git/file/x.bin?source=worktree&download=1'
  );
  expect(response.status).toBe(200);
  expect(response.headers.get('Content-Type')).toBe('application/octet-stream');
  expect(response.headers.get('Content-Disposition')).toBe('attachment; filename="download"');
  expect(response.headers.get('ETag')).toBe(`"${'b'.repeat(64)}"`);
  expect(Array.from(new Uint8Array(await response.arrayBuffer()))).toEqual([0, 1, 2]);
  expect(expectFileLogPair('git.file_completed')).toEqual({
    runId: 'run-1',
    binary: true,
  });
});

test('maps a named GitFileError not_found to the file 404 body on the file route', async () => {
  mockFileAt.mockRejectedValueOnce(namedError('GitFileError', 'not_found'));

  const response = await makeApp().request(
    '/api/workflows/runs/run-1/git/file/src%2Fa.ts?source=worktree'
  );

  expect(response.status).toBe(404);
  expect(await response.json()).toEqual({ error: 'File not found' });
  expect(expectFileLogPair('git.file_failed').errorType).toBe('file_not_found');
});

test('maps a named GitPathError to the invalid-path 400 body on the file route', async () => {
  mockFileAt.mockRejectedValueOnce(namedError('GitPathError', 'escape'));

  const response = await makeApp().request(
    '/api/workflows/runs/run-1/git/file/src%2Fa.ts?source=worktree'
  );

  expect(response.status).toBe(400);
  expect(await response.json()).toEqual({ error: 'Invalid file path' });
  expect(expectFileLogPair('git.file_failed').errorType).toBe('invalid_path');
});

test('returns an opaque 500 for a path-bearing file error', async () => {
  mockFileAt.mockRejectedValueOnce(new Error(`boom at ${checkoutDir}/secret src/leaked.ts`));

  const response = await makeApp().request(
    '/api/workflows/runs/run-1/git/file/src%2Fa.ts?source=worktree'
  );
  const body = await response.json();
  const serializedLogs = JSON.stringify([mockLogger.info.mock.calls, mockLogger.error.mock.calls]);

  expect(response.status).toBe(500);
  expect(body).toEqual({ error: 'Could not read git file' });
  expect(JSON.stringify(body)).not.toContain(checkoutDir);
  expect(JSON.stringify(body)).not.toContain('src/leaked.ts');
  expect(serializedLogs).not.toContain(checkoutDir);
  expect(serializedLogs).not.toContain('src/leaked.ts');
  expect(expectFileLogPair('git.file_failed').errorType).toBe('git_read_failed');
});

test('diff forwards cursor and request cancellation and returns fileFallback', async () => {
  mockFileDiff.mockResolvedValueOnce({
    path: 'image.svg',
    status: 'M',
    scope: 'now',
    ref: 'live',
    hunks: [],
    cursor: '',
    truncated: false,
    binary: false,
    fileFallback: true,
  });
  const response = await makeApp().request(
    '/api/workflows/runs/run-1/git/diff?path=image.svg&cursor=opaque'
  );
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ fileFallback: true });
  expect(mockFileDiff.mock.calls[0]?.[2]).toMatchObject({ cursor: 'opaque' });
  expect(mockFileDiff.mock.calls[0]?.[2]?.signal).toBeInstanceOf(AbortSignal);
});

test('diff maps invalid and stale cursors without logging cursor text', async () => {
  mockFileDiff.mockRejectedValueOnce(namedError('GitFileError', 'invalid_cursor'));
  let response = await makeApp().request(
    '/api/workflows/runs/run-1/git/diff?path=x.ts&cursor=secret-invalid'
  );
  expect(response.status).toBe(400);
  expect(await response.json()).toEqual({ error: 'Invalid file cursor' });
  expect(JSON.stringify(mockLogger.info.mock.calls)).not.toContain('secret-invalid');

  mockLogger.info.mockClear();
  mockLogger.error.mockClear();
  mockFileDiff.mockRejectedValueOnce(namedError('GitFileError', 'stale_cursor'));
  response = await makeApp().request(
    '/api/workflows/runs/run-1/git/diff?path=x.ts&cursor=secret-stale'
  );
  expect(response.status).toBe(409);
  expect(await response.json()).toEqual({ error: 'File changed' });
  expect(JSON.stringify(mockLogger.info.mock.calls)).not.toContain('secret-stale');
});

test('hex view returns bytes and all presentation headers without attachment', async () => {
  mockFileAt.mockResolvedValueOnce(
    readyFileAt({
      path: 'blob.bin',
      bytes: Uint8Array.from([0, 1, 2]),
      binary: true,
      byteLength: 99,
      presentation: 'hex',
    })
  );
  const response = await makeApp().request(
    '/api/workflows/runs/run-1/git/file/blob.bin?source=worktree'
  );
  expect(response.headers.get('Content-Type')).toBe('application/octet-stream');
  expect(response.headers.get('Content-Disposition')).toBeNull();
  expect(response.headers.get('X-Archon-Git-Presentation')).toBe('hex');
  expect(response.headers.get('X-Archon-Git-Byte-Length')).toBe('99');
  expect(new Uint8Array(await response.arrayBuffer())).toEqual(Uint8Array.from([0, 1, 2]));
  expect(mockFileAt.mock.calls.at(-1)?.[3]).toMatchObject({ intent: 'view', cursor: '' });
});

test('download=1 returns a streamed attachment with full Content-Length', async () => {
  const stream = new ReadableStream<Uint8Array>({
    start(controller): void {
      controller.enqueue(Uint8Array.from([0, 1, 2]));
      controller.close();
    },
  });
  mockFileAt.mockResolvedValueOnce({
    delivery: 'stream',
    stream,
    path: 'blob.bin',
    binary: true,
    contentHash: TEXT_HASH,
    byteLength: 3,
    truncated: false,
    cursor: '',
    presentation: 'download',
    mediaType: '',
  });
  const response = await makeApp().request(
    '/api/workflows/runs/run-1/git/file/blob.bin?source=worktree&download=1'
  );
  expect(response.headers.get('Content-Disposition')).toBe('attachment; filename="download"');
  expect(response.headers.get('Content-Length')).toBe('3');
  expect(new Uint8Array(await response.arrayBuffer())).toEqual(Uint8Array.from([0, 1, 2]));
  expect(mockFileAt.mock.calls.at(-1)?.[3]).toMatchObject({ intent: 'download' });
});

test('file route maps stale cursor to 409 and keeps CAP-6 free of presentation headers', async () => {
  mockFileAt.mockRejectedValueOnce(namedError('GitFileError', 'stale_cursor'));
  const stale = await makeApp().request(
    '/api/workflows/runs/run-1/git/file/x.ts?source=worktree&cursor=opaque'
  );
  expect(stale.status).toBe(409);
  expect(await stale.json()).toEqual({ error: 'File changed' });

  mockGetWorkflowRun.mockResolvedValueOnce({ ...runRow(), working_path: null });
  const empty = await makeApp().request('/api/workflows/runs/run-1/git/file/x.ts?source=worktree');
  expect(empty.headers.get('X-Archon-Git-Presentation')).toBeNull();
  expect(empty.headers.get('ETag')).toBeNull();
});

test('git log returns 404 for a missing run', async () => {
  mockGetWorkflowRun.mockResolvedValueOnce(null);

  const response = await makeApp().request('/api/workflows/runs/missing/git/log');

  expect(response.status).toBe(404);
  expect(await response.json()).toEqual({ error: 'Workflow run not found' });
  expect(mockLog).not.toHaveBeenCalled();
  expectGitLogPair('git.log_failed', { runId: 'missing' }, 'missing');
});

test('git log returns container CAP-6 before any git probe', async () => {
  mockGetConversationById.mockResolvedValueOnce({ isolation_env_id: 'env-1' });
  mockGetById.mockResolvedValueOnce({ provider: 'container' });

  const response = await makeApp().request('/api/workflows/runs/run-1/git/log');

  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({
    emptyReason: 'container',
    commits: [],
    revision: '',
    truncated: false,
  });
  expect(mockIsGitWorkTree).not.toHaveBeenCalled();
  expect(mockLog).not.toHaveBeenCalled();
  expectGitLogPair('git.log_completed', { runId: 'run-1', emptyReason: 'container' });
});

test('git log returns no_checkout for a null working_path', async () => {
  mockGetWorkflowRun.mockResolvedValueOnce(runRow({ working_path: null }));

  const response = await makeApp().request('/api/workflows/runs/run-1/git/log');

  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({
    emptyReason: 'no_checkout',
    commits: [],
    revision: '',
    truncated: false,
  });
  expect(mockLog).not.toHaveBeenCalled();
  expectGitLogPair('git.log_completed', { runId: 'run-1', emptyReason: 'no_checkout' });
});

test('git log serializes HEAD commits from the canonical checkout and ignores query paths', async () => {
  const canonical = await realpath(checkoutDir);
  const commit = {
    oid: 'a'.repeat(64),
    parents: ['b'.repeat(64)],
    authorName: 'Ada',
    authorDate: '2026-09-06T18:09:18Z',
    subject: 'run work',
  };
  mockLog.mockResolvedValueOnce({ commits: [commit], revision: REVISION, truncated: false });

  const response = await makeApp().request(
    '/api/workflows/runs/run-1/git/log?working_path=%2Ftmp%2Fhostile'
  );

  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({
    commits: [commit],
    revision: REVISION,
    truncated: false,
  });
  expect(mockLog).toHaveBeenCalledWith(canonical);
  expectGitLogPair('git.log_completed', { runId: 'run-1', commitCount: 1 });
});

test('git log returns an empty ready history rather than CAP-6 for an unborn repository', async () => {
  mockLog.mockResolvedValueOnce({ commits: [], revision: REVISION, truncated: false });

  const response = await makeApp().request('/api/workflows/runs/run-1/git/log');

  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ commits: [], revision: REVISION, truncated: false });
  expectGitLogPair('git.log_completed', { runId: 'run-1', commitCount: 0 });
});

test('git log maps a post-gate git failure to an opaque 500 without logging paths', async () => {
  mockLog.mockRejectedValueOnce(new Error(`boom at ${checkoutDir}/secret`));

  const response = await makeApp().request('/api/workflows/runs/run-1/git/log');
  const body = await response.json();

  expect(response.status).toBe(500);
  expect(body).toEqual({ error: 'Could not read git history' });
  expect(JSON.stringify(body)).not.toContain(checkoutDir);
  expect(JSON.stringify(mockLogger.error.mock.calls)).not.toContain(checkoutDir);
  expectGitLogPair('git.log_failed', { runId: 'run-1', errorType: 'Error' });
});

test('git log returns CAP-6 when the checkout vanishes during the read', async () => {
  mockLog.mockImplementationOnce(async () => {
    await rm(checkoutDir, { recursive: true, force: true });
    throw new Error(`boom at ${checkoutDir}/secret`);
  });

  const response = await makeApp().request('/api/workflows/runs/run-1/git/log');

  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({
    emptyReason: 'no_checkout',
    commits: [],
    revision: '',
    truncated: false,
  });
  expectGitLogPair('git.log_completed', { runId: 'run-1', emptyReason: 'no_checkout' });
});
