import { afterEach, beforeEach, expect, mock, test } from 'bun:test';
import { mkdtemp, realpath, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { OpenAPIHono } from '@hono/zod-openapi';

import type { ConversationLockManager } from '@archon/core';
import type { ChangedFilesResult } from '@archon/git';
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
const mockIsGitWorkTree = mock(async (_workingPath: string): Promise<boolean> => true);

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
  fileAt: mock(async () => ({
    path: 'x.ts',
    bytes: new Uint8Array(),
    binary: false,
    contentHash: '0'.repeat(64),
  })),
  fileDiff: mock(async () => ({
    path: 'x.ts',
    status: 'M' as const,
    scope: 'now' as const,
    ref: 'live' as const,
    hunks: [],
    cursor: '' as const,
    truncated: false as const,
    binary: false,
  })),
  changedFiles: mockChangedFiles,
  isGitWorkTree: mockIsGitWorkTree,
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

beforeEach(async () => {
  checkoutDir = await mkdtemp(join(tmpdir(), 'archon-git-route-'));
  mockGetWorkflowRun.mockReset();
  mockGetConversationById.mockReset();
  mockGetById.mockReset();
  mockChangedFiles.mockReset();
  mockIsGitWorkTree.mockReset();
  mockGetWorkflowRun.mockImplementation(async (): Promise<WorkflowRun> => runRow());
  mockGetConversationById.mockImplementation(
    async (): Promise<{ isolation_env_id: null }> => ({ isolation_env_id: null })
  );
  mockGetById.mockImplementation(async (): Promise<null> => null);
  mockChangedFiles.mockImplementation(
    async (): Promise<ChangedFilesResult> => ({ files: [], revision: REVISION })
  );
  mockIsGitWorkTree.mockImplementation(async (): Promise<boolean> => true);
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
