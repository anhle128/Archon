import { describe, test, expect, mock, beforeEach } from 'bun:test';
import { OpenAPIHono } from '@hono/zod-openapi';
import type { ConversationLockManager } from '@archon/core';
import type { WebAdapter } from '../adapters/web';
import { validationErrorHook } from './openapi-defaults';
import {
  makeDiscoverWorkflowsMock,
  makeLoaderMock,
  makeCommandValidationMock,
} from '../test/workflow-mock-factories';

// ---------------------------------------------------------------------------
// Mock setup — must be before dynamic imports
// ---------------------------------------------------------------------------

function emptyMetrics() {
  return {
    tokensInput: null as number | null,
    tokensOutput: null as number | null,
    tokensReasoning: null as number | null,
    tokensCacheRead: null as number | null,
    tokensCacheWrite: null as number | null,
    requests: null as number | null,
    reportedUsd: null as number | null,
    estimatedUsd: null as number | null,
    recordCount: 0,
    missingTokensInput: 0,
    missingTokensOutput: 0,
    missingTokensReasoning: 0,
    missingTokensCacheRead: 0,
    missingTokensCacheWrite: 0,
    missingRequests: 0,
    rowsMissingUsd: 0,
  };
}

function sampleReport(overrides: Record<string, unknown> = {}) {
  return {
    scope: {
      from: '2026-09-01T00:00:00.000Z',
      to: '2026-10-01T00:00:00.000Z',
      includesChildRollup: false as const,
    },
    groupBy: 'provider' as const,
    totals: {
      ...emptyMetrics(),
      tokensInput: 10,
      tokensOutput: 5,
      reportedUsd: 0.25,
      recordCount: 2,
      missingTokensReasoning: 2,
      missingTokensCacheRead: 1,
      missingTokensCacheWrite: 2,
      missingRequests: 1,
    },
    groups: [
      {
        dimensions: { provider: 'anthropic' },
        metrics: {
          ...emptyMetrics(),
          tokensInput: 10,
          tokensOutput: 5,
          reportedUsd: 0.25,
          recordCount: 2,
        },
      },
    ],
    coverage: {
      usageEventCount: 2,
      ledgeredEventCount: 2,
      unledgeredEventCount: 0,
      hasRecordedUsage: true,
      historicalBackfill: false as const,
      filterScope: 'date-project-run-node' as const,
    },
    ...overrides,
  };
}

class MockUsageReportQueryError extends Error {
  readonly code: 'validation' | 'overflow' | 'unsafe_aggregate' | 'query_failed';
  constructor(
    code: 'validation' | 'overflow' | 'unsafe_aggregate' | 'query_failed',
    message: string
  ) {
    super(message);
    this.name = 'UsageReportQueryError';
    this.code = code;
  }
}

const mockQueryUsageReport = mock(async (_opts: Record<string, unknown> = {}) => sampleReport());

mock.module('@archon/core/db/usage-report', () => ({
  queryUsageReport: mockQueryUsageReport,
  UsageReportQueryError: MockUsageReportQueryError,
}));

mock.module('@archon/core', () => ({
  handleMessage: mock(async () => {}),
  getDatabaseType: () => 'sqlite',
  getSchemaVersion: mock(async () => ({
    createdAppVersion: null,
    appVersion: '0.9.0',
    createdAt: null,
    appliedAt: null,
  })),
  loadConfig: mock(async () => ({})),
  cloneRepository: mock(async () => ({ codebaseId: 'x', alreadyExisted: false })),
  registerRepository: mock(async () => ({ codebaseId: 'x', alreadyExisted: false })),
  ConversationNotFoundError: class ConversationNotFoundError extends Error {
    constructor(id: string) {
      super(`Conversation not found: ${id}`);
      this.name = 'ConversationNotFoundError';
    }
  },
  getArchonWorkspacesPath: () => '/tmp/.archon/workspaces',
  toSafeConfig: (config: unknown) => config,
  generateAndSetTitle: mock(async () => {}),
  resolveTitleRequest: mock(async () => ({ provider: 'claude', options: {} })),
  createLogger: () => ({
    fatal: mock(() => undefined),
    error: mock(() => undefined),
    warn: mock(() => undefined),
    info: mock(() => undefined),
    debug: mock(() => undefined),
    trace: mock(() => undefined),
    child: mock(function (this: unknown) {
      return this;
    }),
    bindings: mock(() => ({ module: 'test' })),
    isLevelEnabled: mock(() => true),
    level: 'info',
  }),
}));

mock.module('@archon/paths', () => ({
  createLogger: () => ({
    fatal: mock(() => undefined),
    error: mock(() => undefined),
    warn: mock(() => undefined),
    info: mock(() => undefined),
    debug: mock(() => undefined),
    trace: mock(() => undefined),
    child: mock(function (this: unknown) {
      return this;
    }),
    bindings: mock(() => ({ module: 'test' })),
    isLevelEnabled: mock(() => true),
    level: 'info',
  }),
  getWorkflowFolderSearchPaths: mock(() => ['.archon/workflows']),
  getCommandFolderSearchPaths: mock(() => ['.archon/commands']),
  getDefaultCommandsPath: mock(() => '/tmp/.archon-test-nonexistent/commands/defaults'),
  getDefaultWorkflowsPath: mock(() => '/tmp/.archon-test-nonexistent/workflows/defaults'),
  getArchonWorkspacesPath: () => '/tmp/.archon/workspaces',
  getHomeCommandsPath: mock(() => '/tmp/.archon/commands'),
  getHomeWorkflowsPath: mock(() => '/tmp/.archon/workflows'),
  isDocker: mock(() => false),
  isWSL: mock(() => false),
  getWSLDistroName: mock(() => undefined),
  checkForUpdate: mock(async () => ({ updateAvailable: false })),
  captureApprovalResolved: mock(() => undefined),
  resolveProjectStorageKey: mock(() => ({ kind: 'cwd', cwd: '/tmp' })),
  getRunArtifactsDirForKey: mock(() => '/tmp/artifacts'),
  getRunArtifactsDirForRoot: mock(() => '/tmp/artifacts'),
  isInsideArchonHome: mock(() => true),
  getArchonHome: mock(() => '/tmp/.archon'),
}));

mock.module('@archon/workflows/workflow-discovery', makeDiscoverWorkflowsMock);
mock.module('@archon/workflows/loader', makeLoaderMock);
mock.module('@archon/workflows/command-validation', makeCommandValidationMock);
mock.module('@archon/workflows/defaults', () => ({
  BUNDLED_WORKFLOWS: {},
  BUNDLED_COMMANDS: {},
  isBinaryBuild: mock(() => false),
}));

mock.module('@archon/git', () => ({
  removeWorktree: mock(async () => {}),
  toRepoPath: (p: string) => p,
  toWorktreePath: (p: string) => p,
  findRepoRoot: mock(async () => null),
}));

mock.module('@archon/core/db/conversations', () => ({
  findConversationByPlatformId: mock(async () => null),
  listConversations: mock(async () => []),
  getOrCreateConversation: mock(async () => ({
    id: 'internal-uuid-123',
    platform_conversation_id: 'web-test-abc',
    title: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    platform_type: 'web',
  })),
  softDeleteConversation: mock(async () => {}),
  updateConversationTitle: mock(async () => {}),
  getConversationById: mock(async () => null),
}));

mock.module('@archon/core/db/codebases', () => ({
  listCodebases: mock(async () => [{ default_cwd: '/tmp/project' }]),
  getCodebase: mock(async () => null),
  deleteCodebase: mock(async () => {}),
}));

mock.module('@archon/core/db/isolation-environments', () => ({
  listByCodebase: mock(async () => []),
  updateStatus: mock(async () => {}),
}));

mock.module('@archon/core/db/workflows', () => ({
  listWorkflowRuns: mock(async () => []),
  listDashboardRuns: mock(async () => ({
    runs: [],
    total: 0,
    counts: { all: 0, running: 0, completed: 0, failed: 0, cancelled: 0, pending: 0 },
  })),
  getWorkflowRun: mock(async () => null),
  cancelWorkflowRun: mock(async () => {}),
  getWorkflowRunByWorkerPlatformId: mock(async () => null),
  getRunningWorkflows: mock(async () => []),
}));

mock.module('@archon/core/db/workflow-events', () => ({
  listWorkflowEvents: mock(async () => []),
}));

mock.module('@archon/core/db/messages', () => ({
  addMessage: mock(async () => ({
    id: 'msg-1',
    conversation_id: 'conv-1',
    role: 'user',
    content: 'hi',
    metadata: '{}',
    created_at: new Date().toISOString(),
  })),
  listMessages: mock(async () => []),
}));

mock.module('@archon/core/utils/commands', () => ({
  findMarkdownFilesRecursive: mock(async () => []),
}));

import { registerApiRoutes } from './api';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeApp(): OpenAPIHono {
  const app = new OpenAPIHono({ defaultHook: validationErrorHook });
  const mockWebAdapter = {
    setConversationDbId: mock((_platformId: string, _dbId: string) => {}),
    emitSSE: mock(async () => {}),
    emitLockEvent: mock(async () => {}),
  } as unknown as WebAdapter;
  const mockLockManager = {
    acquireLock: mock(async (_id: string, fn: () => Promise<void>) => {
      await fn();
      return { status: 'started' };
    }),
    getStats: mock(() => ({
      active: 0,
      queuedTotal: 0,
      queuedByConversation: [],
      maxConcurrent: 10,
      activeConversationIds: [],
    })),
  } as unknown as ConversationLockManager;
  registerApiRoutes(app, mockWebAdapter, mockLockManager);
  return app;
}

beforeEach(() => {
  mockQueryUsageReport.mockReset();
  mockQueryUsageReport.mockImplementation(async () => sampleReport());
});

// ---------------------------------------------------------------------------
// Tests: GET /api/usage
// ---------------------------------------------------------------------------

describe('GET /api/usage', () => {
  test('returns the core usage report shape', async () => {
    const app = makeApp();
    const response = await app.request('/api/usage');
    expect(response.status).toBe(200);

    const body = (await response.json()) as {
      groupBy: string;
      scope: { includesChildRollup: boolean };
      totals: { reportedUsd: number | null; estimatedUsd: number | null; recordCount: number };
      coverage: {
        hasRecordedUsage: boolean;
        historicalBackfill: boolean;
        filterScope: string;
      };
    };
    expect(body.groupBy).toBe('provider');
    expect(body.scope.includesChildRollup).toBe(false);
    expect(body.totals.reportedUsd).toBe(0.25);
    expect(body.totals.estimatedUsd).toBeNull();
    expect(body.coverage.hasRecordedUsage).toBe(true);
    expect(body.coverage.historicalBackfill).toBe(false);
    expect(body.coverage.filterScope).toBe('date-project-run-node');
    expect('effectiveUsd' in body.totals).toBe(false);
  });

  test('forwards filters, dates, kind, and groupBy to the core query', async () => {
    const app = makeApp();
    const qs = new URLSearchParams({
      from: '2026-09-01T00:00:00.000Z',
      to: '2026-09-02T00:00:00.000Z',
      codebaseId: 'cb-1',
      agentProvider: 'claude',
      provider: 'anthropic',
      model: 'sonnet',
      kind: 'unclassified',
      runId: 'run-1',
      nodeId: 'plan',
      groupBy: 'node',
    });
    const response = await app.request(`/api/usage?${qs.toString()}`);
    expect(response.status).toBe(200);

    const [[callArgs]] = mockQueryUsageReport.mock.calls as [[{ [k: string]: unknown }]][];
    expect(callArgs).toEqual({
      from: '2026-09-01T00:00:00.000Z',
      to: '2026-09-02T00:00:00.000Z',
      codebaseId: 'cb-1',
      agentProvider: 'claude',
      provider: 'anthropic',
      model: 'sonnet',
      kind: 'unclassified',
      runId: 'run-1',
      nodeId: 'plan',
      groupBy: 'node',
    });
  });

  test('maps validation errors to 400', async () => {
    mockQueryUsageReport.mockImplementationOnce(async () => {
      throw new MockUsageReportQueryError(
        'validation',
        'from and to must both be present or both absent'
      );
    });

    const app = makeApp();
    const response = await app.request('/api/usage?from=2026-09-01T00:00:00.000Z');
    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: string };
    expect(body.error).toContain('from and to must both be present');
  });

  test('maps group overflow to 400', async () => {
    mockQueryUsageReport.mockImplementationOnce(async () => {
      throw new MockUsageReportQueryError(
        'overflow',
        'Too many groups (over 500); narrow filters or change groupBy'
      );
    });

    const app = makeApp();
    const response = await app.request('/api/usage?groupBy=run');
    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: string };
    expect(body.error).toContain('Too many groups');
  });

  test('maps query_failed to 500', async () => {
    mockQueryUsageReport.mockImplementationOnce(async () => {
      throw new MockUsageReportQueryError('query_failed', 'database offline');
    });

    const app = makeApp();
    const response = await app.request('/api/usage');
    expect(response.status).toBe(500);
    const body = (await response.json()) as { error: string };
    expect(body.error).toContain('database offline');
  });

  test('rejects invalid groupBy via OpenAPI validation', async () => {
    const app = makeApp();
    const response = await app.request('/api/usage?groupBy=not-a-mode');
    expect(response.status).toBe(400);
    expect(mockQueryUsageReport).not.toHaveBeenCalled();
  });

  test('rejects invalid kind via OpenAPI validation', async () => {
    const app = makeApp();
    const response = await app.request('/api/usage?kind=primary');
    expect(response.status).toBe(400);
    expect(mockQueryUsageReport).not.toHaveBeenCalled();
  });

  test('rejects date-only, zone-less, locale, invalid-offset, and calendar-rollover instants via OpenAPI', async () => {
    const app = makeApp();
    const invalid = [
      '2026-09-01',
      '09/01/2026',
      '2026-09-01T00:00:00',
      '2026-09-01T00:00:00+0000',
      '2026-02-29T00:00:00.000Z',
      '2026-02-30T00:00:00.000Z',
    ];
    for (const bad of invalid) {
      mockQueryUsageReport.mockClear();
      const qs = new URLSearchParams({
        from: bad,
        to: '2026-09-02T00:00:00.000Z',
      });
      const response = await app.request(`/api/usage?${qs.toString()}`);
      expect(response.status).toBe(400);
      expect(mockQueryUsageReport).not.toHaveBeenCalled();
    }
  });

  test('accepts Z and explicit-offset RFC 3339 instants', async () => {
    const app = makeApp();
    const pairs: Array<[string, string]> = [
      ['2026-09-01T00:00:00Z', '2026-09-02T00:00:00Z'],
      ['2026-09-01T00:00:00.000Z', '2026-09-02T00:00:00.000Z'],
      ['2026-09-01T00:00:00+00:00', '2026-09-02T00:00:00+00:00'],
      ['2026-09-01T05:30:00.000+05:30', '2026-09-01T06:30:00.000+05:30'],
      ['2028-02-29T00:00:00.000Z', '2028-03-01T00:00:00.000Z'],
    ];
    for (const [from, to] of pairs) {
      mockQueryUsageReport.mockClear();
      const qs = new URLSearchParams({ from, to });
      const response = await app.request(`/api/usage?${qs.toString()}`);
      expect(response.status).toBe(200);
      const [[callArgs]] = mockQueryUsageReport.mock.calls as [[{ [k: string]: unknown }]][];
      expect(callArgs).toEqual({ from, to });
    }
  });

  test('OpenAPI documents GET /api/usage with UsageReport response', async () => {
    const app = makeApp();
    const document = app.getOpenAPIDocument({
      openapi: '3.0.0',
      info: { title: 'test', version: '0' },
    });
    const pathItem = document.paths['/api/usage'];
    expect(pathItem?.get).toBeDefined();
    const schema = pathItem?.get?.responses?.['200']?.content?.['application/json']?.schema;
    expect(schema).toBeDefined();
    // Named component or inline object both ok — must not be missing.
    const ref = (schema as { $ref?: string } | undefined)?.$ref;
    if (ref) {
      expect(ref).toContain('UsageReport');
    } else {
      expect((schema as { type?: string }).type).toBe('object');
    }
  });
});
