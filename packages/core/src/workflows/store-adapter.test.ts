import { describe, test, expect, mock, beforeEach } from 'bun:test';
import type { IWorkflowStore } from '@archon/workflows/store';

// Mock DB modules before importing store-adapter
const mockCreateWorkflowRun = mock(() => Promise.resolve({ id: 'run-1' }));
const mockGetWorkflowRun = mock(() => Promise.resolve(null));
const mockGetActiveWorkflowRunByPath = mock(() => Promise.resolve(null));
const mockFailOrphanedRuns = mock(() => Promise.resolve({ count: 0 }));
const mockFindResumableRun = mock(() => Promise.resolve(null));
const mockResumeWorkflowRun = mock(() => Promise.resolve({ id: 'run-1' }));
const mockUpdateWorkflowRun = mock(() => Promise.resolve());
const mockUpdateWorkflowActivity = mock(() => Promise.resolve());
const mockGetWorkflowRunStatus = mock(() => Promise.resolve('running'));
const mockCompleteWorkflowRun = mock(() => Promise.resolve());
const mockFailWorkflowRun = mock(() => Promise.resolve());
const mockCancelWorkflowRun = mock(() => Promise.resolve());
const mockPauseWorkflowRun = mock(() => Promise.resolve());
const mockPersistRouteDecisionTransition = mock(() => Promise.resolve({ id: 'run-1' }));

mock.module('../db/workflows', () => ({
  createWorkflowRun: mockCreateWorkflowRun,
  getWorkflowRun: mockGetWorkflowRun,
  getActiveWorkflowRunByPath: mockGetActiveWorkflowRunByPath,
  failOrphanedRuns: mockFailOrphanedRuns,
  findResumableRun: mockFindResumableRun,
  resumeWorkflowRun: mockResumeWorkflowRun,
  updateWorkflowRun: mockUpdateWorkflowRun,
  updateWorkflowActivity: mockUpdateWorkflowActivity,
  getWorkflowRunStatus: mockGetWorkflowRunStatus,
  completeWorkflowRun: mockCompleteWorkflowRun,
  failWorkflowRun: mockFailWorkflowRun,
  cancelWorkflowRun: mockCancelWorkflowRun,
  pauseWorkflowRun: mockPauseWorkflowRun,
  persistRouteDecisionTransition: mockPersistRouteDecisionTransition,
  claimWriteback: mock(() => Promise.resolve({ claimed: true })),
  releaseWritebackClaim: mock(() => Promise.resolve()),
}));

const mockCreateWorkflowEvent = mock(() => Promise.resolve());
const mockGetCompletedDagNodeOutputs = mock(() => Promise.resolve(new Map<string, string>()));
mock.module('../db/workflow-events', () => ({
  createWorkflowEvent: mockCreateWorkflowEvent,
  getCompletedDagNodeOutputs: mockGetCompletedDagNodeOutputs,
}));

const mockEnqueueExternalWorkflowEvent = mock(() => Promise.resolve());
mock.module('../db/workflow-event-outbox', () => ({
  enqueueExternalWorkflowEvent: mockEnqueueExternalWorkflowEvent,
}));
const mockResolveEventRoute = mock(() =>
  Promise.resolve({
    routable: false,
    codebase: null,
    binding: null,
    reason: 'missing-codebase',
  })
);
mock.module('../events/binding-router', () => ({
  resolveEventRoute: mockResolveEventRoute,
}));

const mockUpsertWorkflowNodeCheckpoint = mock(() => Promise.resolve({ workflow_run_id: 'run-1' }));
const mockGetLatestWorkflowNodeCheckpoint = mock(() => Promise.resolve(null));
mock.module('../db/workflow-checkpoints', () => ({
  upsertWorkflowNodeCheckpoint: mockUpsertWorkflowNodeCheckpoint,
  getLatestWorkflowNodeCheckpoint: mockGetLatestWorkflowNodeCheckpoint,
}));

const mockGetCodebase = mock(() => Promise.resolve(null));
mock.module('../db/codebases', () => ({
  getCodebase: mockGetCodebase,
}));

mock.module('@archon/providers', () => ({
  getAgentProvider: mock(() => ({})),
  getRegisteredProviders: mock(() => []),
  // Vendor → env-var map consumed by credentials/delivery (#1955). A realistic
  // subset of the generated map (incl. HF_TOKEN, the upstream var).
  PI_PROVIDER_ENV_VARS: {
    anthropic: 'ANTHROPIC_API_KEY',
    openai: 'OPENAI_API_KEY',
    'github-copilot': 'COPILOT_GITHUB_TOKEN',
    openrouter: 'OPENROUTER_API_KEY',
    google: 'GEMINI_API_KEY',
    groq: 'GROQ_API_KEY',
    huggingface: 'HF_TOKEN',
    'google-vertex': 'GOOGLE_CLOUD_API_KEY',
  },
  PI_AMBIENT_VENDORS: ['amazon-bedrock', 'google-vertex'],
}));

mock.module('../config/config-loader', () => ({
  loadConfig: mock(() => Promise.resolve({ assistant: 'claude' })),
}));

// Per-user provider credentials mocks
const mockIsPerUserProviderKeysEnabled = mock(() => false);
mock.module('../credentials/config', () => ({
  isPerUserProviderKeysEnabled: mockIsPerUserProviderKeysEnabled,
}));

const mockListDecryptedUserProviderCredentials = mock(async () => []);
mock.module('../db/user-provider-key-store', () => ({
  listDecryptedUserProviderCredentials: mockListDecryptedUserProviderCredentials,
  saveUserProviderKey: mock(() => Promise.resolve()),
  getUserProviderKeyRecord: mock(() => Promise.resolve(null)),
  listUserProviderKeys: mock(() => Promise.resolve([])),
  deleteUserProviderKey: mock(() => Promise.resolve()),
  getDecryptedProviderCredential: mock(() => Promise.resolve(null)),
}));

// github-auth mocks (required by store-adapter imports)
mock.module('../github-auth/config', () => ({
  isPerUserGitHubEnabled: mock(() => false),
}));
mock.module('../db/user-github-token-store', () => ({
  getDecryptedAccessToken: mock(() => Promise.resolve(undefined)),
}));
mock.module('../db/env-vars', () => ({
  getCodebaseEnvVars: mock(() => Promise.resolve({})),
}));
mock.module('../db/workflow-node-sessions', () => ({
  getWorkflowNodeSession: mock(() => Promise.resolve(null)),
  setWorkflowNodeSession: mock(() => Promise.resolve()),
  deleteWorkflowNodeSessions: mock(() => Promise.resolve()),
}));

const { createWorkflowStore, createWorkflowDeps } = await import('./store-adapter');

function workflowRunRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'run-1',
    workflow_name: 'bmad-dev-story',
    codebase_id: 'cb-1',
    ...overrides,
  };
}

function codebaseRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'cb-1',
    name: 'workflow-engine',
    default_cwd: '/workspace/workflow-engine',
    default_branch: 'dev',
    ...overrides,
  };
}

function bindingRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'binding-1',
    provider: 'archon',
    name: 'workflow-engine-primary',
    codebase_id: 'cb-1',
    event_route: 'https://hermes.example/events',
    signing_secret: 'test-secret',
    state: 'active',
    ...overrides,
  };
}

describe('createWorkflowStore', () => {
  beforeEach(() => {
    mockCreateWorkflowEvent.mockReset();
    mockCreateWorkflowEvent.mockImplementation(() => Promise.resolve());
    mockGetWorkflowRun.mockReset();
    mockGetWorkflowRun.mockImplementation(() => Promise.resolve(null));
    mockEnqueueExternalWorkflowEvent.mockReset();
    mockEnqueueExternalWorkflowEvent.mockImplementation(() => Promise.resolve());
    mockResolveEventRoute.mockReset();
    mockResolveEventRoute.mockImplementation(() =>
      Promise.resolve({
        routable: false,
        codebase: null,
        binding: null,
        reason: 'missing-codebase',
      })
    );
  });

  test('returns object with all IWorkflowStore methods', () => {
    const store = createWorkflowStore();
    const requiredMethods: (keyof IWorkflowStore)[] = [
      'createWorkflowRun',
      'getWorkflowRun',
      'getActiveWorkflowRunByPath',
      'failOrphanedRuns',
      'findResumableRun',
      'resumeWorkflowRun',
      'updateWorkflowRun',
      'updateWorkflowActivity',
      'getWorkflowRunStatus',
      'completeWorkflowRun',
      'failWorkflowRun',
      'pauseWorkflowRun',
      'claimWriteback',
      'releaseWritebackClaim',
      'cancelWorkflowRun',
      'persistRouteDecisionTransition',
      'createWorkflowEvent',
      'enqueueExternalWorkflowEvent',
      'getCompletedDagNodeOutputs',
      'upsertWorkflowNodeCheckpoint',
      'getLatestWorkflowNodeCheckpoint',
      'getCodebase',
      'getCodebaseEnvVars',
    ];
    for (const method of requiredMethods) {
      expect(typeof store[method]).toBe('function');
    }
  });

  test('delegates getWorkflowRunStatus to DB and returns typed status', async () => {
    mockGetWorkflowRunStatus.mockResolvedValueOnce('completed');
    const store = createWorkflowStore();
    const result = await store.getWorkflowRunStatus('run-123');
    expect(result).toBe('completed');
    expect(mockGetWorkflowRunStatus).toHaveBeenCalledWith('run-123');
  });

  test('delegates getWorkflowRunStatus returns null for missing run', async () => {
    mockGetWorkflowRunStatus.mockResolvedValueOnce(null);
    const store = createWorkflowStore();
    const result = await store.getWorkflowRunStatus('nonexistent');
    expect(result).toBeNull();
  });

  test('delegates route decision persistence to DB', async () => {
    const input: Parameters<IWorkflowStore['persistRouteDecisionTransition']>[0] = {
      workflow_run_id: 'run-123',
      expected_execution_seq: 0,
      metadata: { executionSeq: 1 },
      event: {
        step_name: 'router',
        data: { outcome: 'positive' },
      },
    };
    const store = createWorkflowStore();
    await store.persistRouteDecisionTransition(input);
    expect(mockPersistRouteDecisionTransition).toHaveBeenCalledWith(input);
  });

  test('createWorkflowEvent catches and logs unexpected throws', async () => {
    mockCreateWorkflowEvent.mockRejectedValueOnce(new Error('DB connection lost'));
    const store = createWorkflowStore();
    // Should not throw — the wrapper guarantees the non-throwing contract
    await expect(
      store.createWorkflowEvent({
        workflow_run_id: 'run-1',
        event_type: 'step_started',
        step_index: 0,
        step_name: 'test-step',
      })
    ).resolves.toBeUndefined();
  });

  test('enqueueExternalWorkflowEvent catches unexpected throws', async () => {
    mockGetWorkflowRun.mockRejectedValueOnce(new Error('DB connection lost'));
    const store = createWorkflowStore();
    await expect(
      store.enqueueExternalWorkflowEvent({
        workflow_run_id: 'run-1',
        event_type: 'workflow.run.started',
        occurred_at: new Date().toISOString(),
        payload: { state: 'running' },
      })
    ).resolves.toBeUndefined();
  });

  test('enqueueExternalWorkflowEvent persists a routable envelope with a queued delivery time', async () => {
    mockGetWorkflowRun.mockResolvedValueOnce(workflowRunRow());
    mockResolveEventRoute.mockResolvedValueOnce({
      routable: true,
      codebase: codebaseRow(),
      binding: bindingRow(),
      route: 'https://hermes.example/events',
      secret: 'test-secret',
    });
    const store = createWorkflowStore();

    await store.enqueueExternalWorkflowEvent({
      workflow_run_id: 'run-1',
      event_type: 'workflow.run.completed',
      occurred_at: '2026-07-25T00:00:00.000Z',
      payload: {
        state: 'completed',
        result: { outcome: 'accepted', completedAt: '2026-07-25T00:00:00.000Z' },
      },
    });

    expect(mockResolveEventRoute).toHaveBeenCalledWith('cb-1');
    expect(mockEnqueueExternalWorkflowEvent).toHaveBeenCalledTimes(1);
    const [insert] = mockEnqueueExternalWorkflowEvent.mock.calls[0] as [Record<string, unknown>];
    expect(insert).toMatchObject({
      event_type: 'workflow.run.completed',
      workflow_run_id: 'run-1',
      codebase_id: 'cb-1',
      binding_id: 'binding-1',
      event_route: 'https://hermes.example/events',
      status: 'pending',
      next_attempt_at: '2026-07-25T00:00:00.000Z',
    });
    const body = JSON.parse(insert.event_body as string) as Record<string, unknown>;
    expect(Object.keys(body)).toHaveLength(10);
    expect(body).toMatchObject({
      schemaVersion: 'workflow-event-envelope.v1',
      provider: 'archon',
      eventType: 'workflow.run.completed',
      occurredAt: '2026-07-25T00:00:00.000Z',
      idempotencyKey: insert.idempotency_key,
    });
    expect(body).not.toHaveProperty('signature');
    expect(body).not.toHaveProperty('delivery');
  });

  test('enqueueExternalWorkflowEvent does not persist invalid typed event payloads', async () => {
    mockGetWorkflowRun.mockResolvedValueOnce(workflowRunRow());
    mockResolveEventRoute.mockResolvedValueOnce({
      routable: true,
      codebase: codebaseRow(),
      binding: bindingRow(),
      route: 'https://hermes.example/events',
      secret: 'test-secret',
    });
    const store = createWorkflowStore();

    await expect(
      store.enqueueExternalWorkflowEvent({
        workflow_run_id: 'run-1',
        event_type: 'workflow.run.completed',
        occurred_at: '2026-07-25T00:00:00.000Z',
        payload: { state: 'completed' },
      })
    ).resolves.toBeUndefined();

    expect(mockEnqueueExternalWorkflowEvent).not.toHaveBeenCalled();
  });

  test('enqueueExternalWorkflowEvent records not-routable events without scheduling delivery', async () => {
    mockGetWorkflowRun.mockResolvedValueOnce(workflowRunRow());
    mockResolveEventRoute.mockResolvedValueOnce({
      routable: false,
      codebase: codebaseRow(),
      binding: bindingRow({ signing_secret: null }),
      reason: 'missing-secret',
    });
    const store = createWorkflowStore();

    await store.enqueueExternalWorkflowEvent({
      workflow_run_id: 'run-1',
      event_type: 'workflow.run.started',
      occurred_at: '2026-07-25T00:00:00.000Z',
      payload: { state: 'running', startedAt: '2026-07-25T00:00:00.000Z' },
    });

    const [insert] = mockEnqueueExternalWorkflowEvent.mock.calls[0] as [Record<string, unknown>];
    expect(insert).toMatchObject({
      event_type: 'workflow.run.started',
      workflow_run_id: 'run-1',
      codebase_id: 'cb-1',
      binding_id: 'binding-1',
      status: 'not-routable',
      not_routable_reason: 'missing-secret',
    });
    expect(insert).not.toHaveProperty('event_route');
    expect(insert).not.toHaveProperty('next_attempt_at');
  });

  test('createWorkflowEvent mirrors supported internal lifecycle events to the external outbox', async () => {
    mockGetWorkflowRun.mockResolvedValueOnce(workflowRunRow());
    mockResolveEventRoute.mockResolvedValueOnce({
      routable: true,
      codebase: codebaseRow(),
      binding: bindingRow(),
      route: 'https://hermes.example/events',
      secret: 'test-secret',
    });
    const store = createWorkflowStore();

    await store.createWorkflowEvent({
      workflow_run_id: 'run-1',
      event_type: 'workflow_started',
      step_index: 0,
      step_name: 'workflow',
    });

    expect(mockCreateWorkflowEvent).toHaveBeenCalledWith({
      workflow_run_id: 'run-1',
      event_type: 'workflow_started',
      step_index: 0,
      step_name: 'workflow',
    });
    expect(mockEnqueueExternalWorkflowEvent).toHaveBeenCalledTimes(1);
    const [insert] = mockEnqueueExternalWorkflowEvent.mock.calls[0] as [Record<string, unknown>];
    const body = JSON.parse(insert.event_body as string) as Record<string, unknown>;
    expect(insert.event_type).toBe('workflow.run.started');
    expect(body).toMatchObject({
      eventType: 'workflow.run.started',
      payload: {
        state: 'running',
      },
    });
  });

  test('delegates getCompletedDagNodeOutputs to DB', async () => {
    const expected = new Map([['step1', 'output text']]);
    mockGetCompletedDagNodeOutputs.mockResolvedValueOnce(expected);
    const store = createWorkflowStore();
    const result = await store.getCompletedDagNodeOutputs('run-123');
    expect(result).toBe(expected);
    expect(mockGetCompletedDagNodeOutputs).toHaveBeenCalledWith('run-123');
  });

  test('delegates workflow node checkpoint upsert to DB', async () => {
    const expected = {
      workflow_run_id: 'run-1',
      node_id: 'build',
      retry_epoch: 0,
      checkpoint_ref: 'refs/archon/checkpoints/run-1/0/build',
      commit_sha: 'abc',
      created_commit: false,
      fallback_from_node_id: null,
      created_at: new Date(),
    };
    mockUpsertWorkflowNodeCheckpoint.mockResolvedValueOnce(expected);
    const store = createWorkflowStore();
    const result = await store.upsertWorkflowNodeCheckpoint?.({
      workflow_run_id: 'run-1',
      node_id: 'build',
      retry_epoch: 0,
      checkpoint_ref: 'refs/archon/checkpoints/run-1/0/build',
      commit_sha: 'abc',
      created_commit: false,
      fallback_from_node_id: null,
    });
    expect(result).toBe(expected);
  });

  test('delegates cancelWorkflowRun to DB', async () => {
    mockCancelWorkflowRun.mockResolvedValueOnce(undefined);
    const store = createWorkflowStore();
    await store.cancelWorkflowRun('run-123');
    expect(mockCancelWorkflowRun).toHaveBeenCalledWith('run-123');
  });

  test('delegates getCodebase to DB', async () => {
    mockGetCodebase.mockResolvedValueOnce({
      id: 'cb-1',
      name: 'owner/repo',
      repository_url: 'https://github.com/owner/repo',
      default_cwd: '/workspace/repo',
    });
    const store = createWorkflowStore();
    const result = await store.getCodebase('cb-1');
    expect(result).toEqual({
      id: 'cb-1',
      name: 'owner/repo',
      repository_url: 'https://github.com/owner/repo',
      default_cwd: '/workspace/repo',
    });
  });
});

describe('createWorkflowDeps', () => {
  test('returns WorkflowDeps with store, getAgentProvider, and loadConfig', () => {
    const deps = createWorkflowDeps();
    expect(deps.store).toBeDefined();
    expect(typeof deps.getAgentProvider).toBe('function');
    expect(typeof deps.loadConfig).toBe('function');
  });

  test('store from createWorkflowDeps has all IWorkflowStore methods', () => {
    const deps = createWorkflowDeps();
    expect(typeof deps.store.createWorkflowRun).toBe('function');
    expect(typeof deps.store.getWorkflowRun).toBe('function');
    expect(typeof deps.store.createWorkflowEvent).toBe('function');
    expect(typeof deps.store.enqueueExternalWorkflowEvent).toBe('function');
    expect(typeof deps.store.getCodebase).toBe('function');
  });

  describe('provider credential fields', () => {
    beforeEach(() => {
      mockListDecryptedUserProviderCredentials.mockReset();
      mockListDecryptedUserProviderCredentials.mockImplementation(async () => []);
      mockIsPerUserProviderKeysEnabled.mockReset();
      mockIsPerUserProviderKeysEnabled.mockImplementation(() => false);
    });

    test('exposes isPerUserProviderKeysEnabled and getUserProviderEnv', () => {
      const deps = createWorkflowDeps();
      expect(typeof deps.isPerUserProviderKeysEnabled).toBe('function');
      expect(typeof deps.getUserProviderEnv).toBe('function');
    });

    test('getUserProviderEnv returns { env: {}, files: [] } when list query throws', async () => {
      mockListDecryptedUserProviderCredentials.mockRejectedValueOnce(new Error('db gone'));
      const deps = createWorkflowDeps();
      const result = await deps.getUserProviderEnv?.('u-1', '/tmp/art');
      expect(result).toEqual({ env: {}, files: [] });
    });

    // Regression guard for #2035: enabling the credential vault (auto-key on by
    // default) must be ADDITIVE. An unconnected user yields an empty env bag, so
    // their ambient ANTHROPIC_API_KEY / OPENAI_API_KEY pass through untouched —
    // there is no scrub on the AI-provider path (unlike the GitHub org-token path).
    // A future change that scrubbed ambient provider keys would fail this.
    test('getUserProviderEnv is additive: unconnected user gets empty env (no ambient scrub)', async () => {
      mockListDecryptedUserProviderCredentials.mockResolvedValueOnce([]);
      const deps = createWorkflowDeps();
      const result = await deps.getUserProviderEnv?.('u-unconnected', '/tmp/art');
      expect(result).toEqual({ env: {}, files: [] });
    });

    test('getUserProviderEnv aggregates env from multiple providers', async () => {
      mockListDecryptedUserProviderCredentials.mockResolvedValueOnce([
        { provider: 'openrouter', cred: { kind: 'api_key', apiKey: 'or-k' } },
        { provider: 'google', cred: { kind: 'api_key', apiKey: 'g-k' } },
      ]);
      const deps = createWorkflowDeps();
      const result = await deps.getUserProviderEnv?.('u-1', '/tmp/art');
      expect(result?.env).toMatchObject({ OPENROUTER_API_KEY: 'or-k', GEMINI_API_KEY: 'g-k' });
    });
  });
});
