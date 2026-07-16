/**
 * RED-PHASE SCAFFOLD — Story 3.3b "Provide Archon Start And Status CLI JSON"
 *
 * Test design: _bmad-output/implementation-artifacts/
 *   3-3b-provide-archon-start-and-status-cli-json.md
 *
 * This file exercises the `workflowRunCommand` and `workflowGetCommand`
 * functions when `--json` is passed, verifying they produce shared-envelope
 * JSON matching the checked-in contract fixtures.
 *
 * All tests are `test()` because:
 *   - The production code does not yet emit shared-envelope JSON in the
 *     foreground `workflow run --json` path (it only suppresses logs).
 *   - The `workflowGetCommand` still emits the legacy `{ ok, runId, error }`
 *     shape, not the shared envelope.
 *   - No `classifyWorkflowError` helper exists yet.
 *   - `WorkflowRunOptions.correlationId` field does not exist yet.
 *
 * Activate each test by removing `.skip` once the corresponding slice from
 * the story's task list is implemented:
 *   Slice 1 → 3.3B-START-* success tests
 *   Slice 2 → 3.3B-START-ERR-* error tests
 *   Slice 3 → 3.3B-STATUS-* success tests
 *   Slice 4 → 3.3B-STATUS-ERR-* error tests
 *   Slice 5 → 3.3B-CONTRACT-* conformance tests
 *   Slice 6 → Wire test isolation + validate
 *
 * IMPORTANT: This file uses mock.module() and MUST run in its own
 * `bun test` invocation, separate from workflow.test.ts and all other
 * CLI test files, to avoid mock.module() pollution.
 */
import { describe, test, expect, beforeEach, afterEach, spyOn, mock } from 'bun:test';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { WorkflowEmitterEvent } from '@archon/workflows/event-emitter';

// ---------------------------------------------------------------------------
// Contract fixture paths
// ---------------------------------------------------------------------------
const CONTRACTS_ROOT = join(
  import.meta.dir,
  '../../../../_bmad-output/planning-artifacts/contracts/workflow-commander'
);
const COMMANDS_DIR = join(CONTRACTS_ROOT, 'examples/providers/archon/commands');
const SCHEMA_PATH = join(CONTRACTS_ROOT, 'schemas/workflow-command-envelope.schema.json');

function loadFixture(name: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(COMMANDS_DIR, name), 'utf8')) as Record<string, unknown>;
}

// Dynamic fields excluded from fixture diffs (vary per invocation)
const DYNAMIC_FIELDS = ['correlationId', 'issuedAt', 'durationMs'];

function stripDynamicFields(obj: Record<string, unknown>): Record<string, unknown> {
  const copy: Record<string, unknown> = { ...obj };
  for (const key of DYNAMIC_FIELDS) delete copy[key];
  for (const [key, value] of Object.entries(copy)) {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      copy[key] = stripDynamicFields(value as Record<string, unknown>);
    }
  }
  return copy;
}

// Forbidden keys that must never appear in any envelope
const FORBIDDEN_KEYS =
  /^(displayText|humanText|message|prose|stderr|stdout|actor|secret|profile|agent_name|agent|agent_provider)$/i;

function assertNoForbiddenKeys(obj: unknown): void {
  if (obj && typeof obj === 'object') {
    for (const [key, val] of Object.entries(obj as Record<string, unknown>)) {
      if (FORBIDDEN_KEYS.test(key)) {
        throw new Error(`Forbidden key found in envelope: ${key}`);
      }
      assertNoForbiddenKeys(val);
    }
  }
}

// ---------------------------------------------------------------------------
// Module mocks — identical module-level shape as workflow.test.ts but in a
// separate process (this file runs in its own `bun test` invocation).
// ---------------------------------------------------------------------------
const mockLogger = {
  fatal: mock(() => undefined),
  error: mock(() => undefined),
  warn: mock(() => undefined),
  info: mock(() => undefined),
  debug: mock(() => undefined),
  trace: mock(() => undefined),
  child: mock(function (this: unknown) {
    return mockLogger;
  }),
};

mock.module('@archon/paths', () => ({
  captureApprovalResolved: () => undefined,
  createLogger: mock(() => mockLogger),
  getArchonHome: mock(() => '/home/test/.archon'),
  BUNDLED_IS_BINARY: false,
}));

mock.module('@archon/isolation', () => ({
  configureIsolation: mock(() => undefined),
  getIsolationProvider: mock(() => ({
    create: mock(() =>
      Promise.resolve({
        provider: 'worktree',
        id: '/test/path',
        workingPath: '/test/path',
        branchName: 'test-branch',
        status: 'active',
        createdAt: new Date(),
        metadata: { adopted: false },
      })
    ),
    healthCheck: mock(() => Promise.resolve(true)),
  })),
}));

mock.module('@archon/core', () => ({
  registerRepository: mock(() =>
    Promise.resolve({
      codebaseId: 'cb-auto',
      name: 'test/repo',
      repositoryUrl: null,
      defaultCwd: '/test/path',
      commandCount: 0,
      alreadyExisted: false,
    })
  ),
  loadConfig: mock(() => Promise.resolve({ defaults: {} })),
  generateAndSetTitle: mock(() => Promise.resolve()),
  loadRepoConfig: mock(() => Promise.resolve(null)),
  createWorkflowStore: mock(() => ({
    createWorkflowEvent: mock(() => Promise.resolve()),
  })),
}));

mock.module('@archon/workflows/workflow-discovery', () => ({
  discoverWorkflowsWithConfig: mock(() => Promise.resolve({ workflows: [], errors: [] })),
}));

mock.module('@archon/workflows/executor', () => ({
  executeWorkflow: mock(() => Promise.resolve({ success: true, workflowRunId: 'test-run-id' })),
  hydrateResumableRun: mock(() => Promise.resolve(null)),
}));

mock.module('@archon/workflows/event-emitter', () => ({
  getWorkflowEventEmitter: mock(() => ({
    subscribeForConversation: mock(
      (_convId: string, _handler: (event: WorkflowEmitterEvent) => void) => {
        return mock(() => undefined);
      }
    ),
  })),
}));

mock.module('@archon/git', () => ({
  findRepoRoot: mock(() => Promise.resolve(null)),
  getRemoteUrl: mock(() => Promise.resolve(null)),
  checkout: mock(() => Promise.resolve()),
  toRepoPath: mock((path: string) => path),
  toWorktreePath: mock((path: string) => path),
  toBranchName: mock((branch: string) => branch),
  getDefaultBranch: mock(() => Promise.resolve('dev')),
  isAncestorOf: mock(() => Promise.resolve(true)),
}));

mock.module('@archon/core/db/conversations', () => ({
  getOrCreateConversation: mock(() =>
    Promise.resolve({
      id: 'conv-123',
      platform_type: 'cli',
      platform_conversation_id: 'cli-123',
    })
  ),
  getConversationById: mock(() => Promise.resolve(null)),
  updateConversation: mock(() => Promise.resolve()),
}));

mock.module('@archon/core/db/codebases', () => ({
  findCodebaseByDefaultCwd: mock(() => Promise.resolve(null)),
  getCodebase: mock(() => Promise.resolve(null)),
}));

mock.module('@archon/core/db/isolation-environments', () => ({
  findActiveByWorkflow: mock(() => Promise.resolve(null)),
  create: mock(() => Promise.resolve({ id: 'iso-123' })),
}));

mock.module('@archon/core/db/messages', () => ({
  addMessage: mock(() => Promise.resolve()),
}));

mock.module('@archon/core/db/workflows', () => ({
  getActiveWorkflowRun: mock(() => Promise.resolve(null)),
  failWorkflowRun: mock(() => Promise.resolve()),
  cancelWorkflowRun: mock(() => Promise.resolve()),
  findResumableRun: mock(() => Promise.resolve(null)),
  resumeWorkflowRun: mock(() => Promise.resolve(null)),
  getWorkflowRun: mock(() => Promise.resolve(null)),
  updateWorkflowRun: mock(() => Promise.resolve()),
  listWorkflowRuns: mock(() => Promise.resolve([])),
  listDashboardRuns: mock(() =>
    Promise.resolve({
      runs: [],
      total: 0,
      counts: {
        all: 0,
        running: 0,
        completed: 0,
        failed: 0,
        cancelled: 0,
        pending: 0,
        paused: 0,
      },
    })
  ),
  deleteOldWorkflowRuns: mock(() => Promise.resolve({ count: 0 })),
}));

mock.module('@archon/core/db/workflow-events', () => ({
  listWorkflowEvents: mock(() => Promise.resolve([])),
  createWorkflowEvent: mock(() => Promise.resolve()),
}));

mock.module('@archon/core/db/workflow-node-sessions', () => ({
  deleteWorkflowNodeSessions: mock(() => Promise.resolve({ deleted: 0 })),
  getWorkflowNodeSession: mock(() => Promise.resolve(null)),
  upsertWorkflowNodeSession: mock(() => Promise.resolve()),
}));

mock.module('@archon/core/db/users', () => ({
  findOrCreateUserByPlatformIdentity: mock(() =>
    Promise.resolve({ id: 'user-cli-1', role: 'admin' })
  ),
}));

mock.module('@archon/core/operations/workflow-operations', () => ({
  approveWorkflow: mock(() => Promise.resolve({ ok: true })),
  rejectWorkflow: mock(() => Promise.resolve({ ok: true })),
  resumeWorkflow: mock(() => Promise.resolve({ ok: true })),
  abandonWorkflow: mock(() => Promise.resolve({ ok: true })),
  getWorkflowStatus: mock(() => Promise.resolve(null)),
  resetWorkflowNodeSessions: mock(() => Promise.resolve({ deleted: 0 })),
}));

mock.module('@archon/workflows/router', () => ({
  resolveWorkflowName: mock(() => null),
}));

mock.module('@archon/core/workflows/store-adapter', () => ({
  createWorkflowDeps: mock(() => ({})),
}));

mock.module('../adapters/cli-adapter', () => ({
  CLIAdapter: mock(() => ({
    setConversationDbId: mock(() => {}),
    sendMessage: mock(() => Promise.resolve()),
  })),
}));

mock.module('./auth', () => ({
  resolveCliUserId: mock(() => null),
}));

// ---------------------------------------------------------------------------
// Static imports — must appear AFTER mock.module() calls above so that
// bun:test's hoisted mock.module intercepts all transitive dependencies.
// This matches the pattern used in workflow.test.ts.
// ---------------------------------------------------------------------------
import { makeTestWorkflowWithSource } from '@archon/workflows/test-utils';
import { resolveWorkflowName } from '@archon/workflows/router';
import { workflowRunCommand, workflowGetCommand } from './workflow';

// ---------------------------------------------------------------------------
// Reusable test data
// ---------------------------------------------------------------------------
const TEST_WORKFLOW = makeTestWorkflowWithSource({ name: 'implement', description: 'Implement' });

(resolveWorkflowName as ReturnType<typeof mock>).mockReturnValue(TEST_WORKFLOW.workflow);

const RUNNING_RUN = {
  id: 'run-001',
  workflow_name: 'implement',
  conversation_id: 'conv-123',
  parent_conversation_id: null,
  codebase_id: 'cb-auto',
  status: 'running' as const,
  user_message: 'Add auth',
  metadata: {},
  started_at: new Date('2026-07-15T10:00:00Z'),
  completed_at: null,
  last_activity_at: null,
  working_path: '/test/path',
  user_id: null,
};

const COMPLETED_RUN = {
  ...RUNNING_RUN,
  id: 'run-002',
  status: 'completed' as const,
  completed_at: new Date('2026-07-15T10:05:00Z'),
};

const FAILED_RUN = {
  ...RUNNING_RUN,
  id: 'run-003',
  status: 'failed' as const,
  metadata: { error: 'Node build-step failed' },
};

const PAUSED_RUN = {
  ...RUNNING_RUN,
  id: 'run-004',
  status: 'paused' as const,
  metadata: {
    approval: {
      nodeId: 'review-gate',
      message: 'Please review the implementation',
      type: 'approval' as const,
    },
  },
};

const CANCELLED_RUN = {
  ...RUNNING_RUN,
  id: 'run-005',
  status: 'cancelled' as const,
};

const PENDING_RUN = {
  ...RUNNING_RUN,
  id: 'run-006',
  status: 'pending' as const,
};

// ==========================================================================
// SLICE 1: Foreground `workflow run --json` produces start success envelope
// ==========================================================================

describe('3.3B-START-001 — foreground workflow run --json emits workflow.start success envelope [P0, AC#1]', () => {
  let consoleSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    consoleSpy = spyOn(console, 'log').mockImplementation(() => {});
  });
  afterEach(() => {
    consoleSpy.mockRestore();
  });

  test('successful foreground run emits a workflow.start envelope with correct structure', async () => {
    // SKIP REASON: workflowRunCommand foreground path does not yet build/emit
    // a shared-envelope JSON for workflow.start. Currently it only suppresses
    // human logs when json=true but emits no JSON output.
    // ACTIVATE: once Slice 1 adds envelope emission after executeWorkflow returns.
    const { discoverWorkflowsWithConfig } = await import('@archon/workflows/workflow-discovery');
    const { executeWorkflow } = await import('@archon/workflows/executor');

    (discoverWorkflowsWithConfig as ReturnType<typeof mock>).mockResolvedValueOnce({
      workflows: [TEST_WORKFLOW],
      errors: [],
    });
    (executeWorkflow as ReturnType<typeof mock>).mockResolvedValueOnce({
      success: true,
      workflowRunId: 'run-start-001',
    });

    await workflowRunCommand('/test/path', 'implement', 'Add auth', {
      json: true,
      noWorktree: true,
    });

    expect(consoleSpy).toHaveBeenCalledTimes(1);
    const envelope = JSON.parse(consoleSpy.mock.calls[0][0] as string) as Record<string, unknown>;

    // Structural envelope fields
    expect(envelope.schemaVersion).toBe('workflow-command-envelope.v1');
    expect(envelope.intendedProducer).toBe('Archon');
    expect(envelope.intendedConsumer).toBe('Hermes');
    expect(envelope.owningSubproject).toBe('archon');
    expect(envelope.provider).toBe('archon');
    expect(envelope.command).toBe('workflow.start');
    expect(envelope.success).toBe(true);
    expect(typeof envelope.correlationId).toBe('string');
    expect(typeof envelope.issuedAt).toBe('string');

    // workflowRunRef required for workflow.* commands
    const ref = envelope.workflowRunRef as Record<string, unknown>;
    expect(ref).toBeDefined();
    expect(ref.provider).toBe('archon');
    expect(ref.runId).toBe('run-start-001');
    expect(typeof ref.workflowName).toBe('string');

    // Result payload matches start-success fixture shape
    const result = envelope.result as Record<string, unknown>;
    expect(result.operation).toBe('start');
    expect(result.state).toBe('running');
    expect(result.phase).toBe('implementation');
    expect(result.accepted).toBe(true);

    // No error key in success envelope
    expect(envelope).not.toHaveProperty('error');
    // No forbidden keys
    assertNoForbiddenKeys(envelope);
  });

  test('successful foreground run with supplied correlation-id echoes it in the envelope', async () => {
    // SKIP REASON: WorkflowRunOptions does not yet have a correlationId field,
    // and cli.ts does not thread --correlation-id into workflow run.
    // ACTIVATE: once Slice 1 adds correlationId to WorkflowRunOptions and
    // plumbs --correlation-id from cli.ts.
    const { discoverWorkflowsWithConfig } = await import('@archon/workflows/workflow-discovery');
    const { executeWorkflow } = await import('@archon/workflows/executor');

    (discoverWorkflowsWithConfig as ReturnType<typeof mock>).mockResolvedValueOnce({
      workflows: [TEST_WORKFLOW],
      errors: [],
    });
    (executeWorkflow as ReturnType<typeof mock>).mockResolvedValueOnce({
      success: true,
      workflowRunId: 'run-corr-001',
    });

    await workflowRunCommand('/test/path', 'implement', 'Add auth', {
      json: true,
      noWorktree: true,
      correlationId: 'corr_fixed_value',
    } as Record<string, unknown>);

    const envelope = JSON.parse(consoleSpy.mock.calls[0][0] as string) as Record<string, unknown>;
    expect(envelope.correlationId).toBe('corr_fixed_value');
  });

  test('no human-text console output in foreground json mode', async () => {
    // SKIP REASON: foreground path doesn't emit envelope yet; once it does,
    // this test asserts that stdout has exactly one JSON line and nothing else.
    // ACTIVATE: once Slice 1 suppresses all human console.log and emits envelope.
    const { discoverWorkflowsWithConfig } = await import('@archon/workflows/workflow-discovery');
    const { executeWorkflow } = await import('@archon/workflows/executor');

    (discoverWorkflowsWithConfig as ReturnType<typeof mock>).mockResolvedValueOnce({
      workflows: [TEST_WORKFLOW],
      errors: [],
    });
    (executeWorkflow as ReturnType<typeof mock>).mockResolvedValueOnce({
      success: true,
      workflowRunId: 'run-quiet-001',
    });

    await workflowRunCommand('/test/path', 'implement', 'Add auth', {
      json: true,
      noWorktree: true,
    });

    // Exactly one console.log call containing valid JSON
    expect(consoleSpy).toHaveBeenCalledTimes(1);
    expect(() => JSON.parse(consoleSpy.mock.calls[0][0] as string)).not.toThrow();
  });
});

describe('3.3B-START-002 — paused foreground workflow run --json emits waiting-for-approval [P0, AC#1]', () => {
  let consoleSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    consoleSpy = spyOn(console, 'log').mockImplementation(() => {});
  });
  afterEach(() => {
    consoleSpy.mockRestore();
  });

  test('paused run emits success envelope with state waiting-for-approval', async () => {
    // SKIP REASON: foreground path doesn't build envelope for paused result.
    // ACTIVATE: once Slice 1 handles paused case in envelope construction.
    const { discoverWorkflowsWithConfig } = await import('@archon/workflows/workflow-discovery');
    const { executeWorkflow } = await import('@archon/workflows/executor');

    (discoverWorkflowsWithConfig as ReturnType<typeof mock>).mockResolvedValueOnce({
      workflows: [TEST_WORKFLOW],
      errors: [],
    });
    (executeWorkflow as ReturnType<typeof mock>).mockResolvedValueOnce({
      success: true,
      paused: true,
      workflowRunId: 'run-paused-001',
    });

    await workflowRunCommand('/test/path', 'implement', 'Add auth', {
      json: true,
      noWorktree: true,
    });

    expect(consoleSpy).toHaveBeenCalledTimes(1);
    const envelope = JSON.parse(consoleSpy.mock.calls[0][0] as string) as Record<string, unknown>;

    expect(envelope.success).toBe(true);
    expect(envelope.command).toBe('workflow.start');

    const result = envelope.result as Record<string, unknown>;
    expect(result.state).toBe('waiting-for-approval');
    expect(result.terminal).toBe(false);
    expect(result.actionRequired).toBe(true);

    // No error in success envelope
    expect(envelope).not.toHaveProperty('error');
    assertNoForbiddenKeys(envelope);
  });
});

describe('3.3B-START-003 — projectBindingRef population [P1, AC#1]', () => {
  let consoleSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    consoleSpy = spyOn(console, 'log').mockImplementation(() => {});
  });
  afterEach(() => {
    consoleSpy.mockRestore();
  });

  test('projectBindingRef is omitted when no binding exists (valid per schema)', async () => {
    // SKIP REASON: foreground path doesn't build envelope yet.
    // ACTIVATE: once Slice 1 handles the no-binding case.
    const { discoverWorkflowsWithConfig } = await import('@archon/workflows/workflow-discovery');
    const { executeWorkflow } = await import('@archon/workflows/executor');

    (discoverWorkflowsWithConfig as ReturnType<typeof mock>).mockResolvedValueOnce({
      workflows: [TEST_WORKFLOW],
      errors: [],
    });
    (executeWorkflow as ReturnType<typeof mock>).mockResolvedValueOnce({
      success: true,
      workflowRunId: 'run-nobind-001',
    });

    await workflowRunCommand('/test/path', 'implement', 'Add auth', {
      json: true,
      noWorktree: true,
    });

    const envelope = JSON.parse(consoleSpy.mock.calls[0][0] as string) as Record<string, unknown>;
    const result = envelope.result as Record<string, unknown>;
    expect(result).not.toHaveProperty('projectBindingRef');
  });
});

// ==========================================================================
// SLICE 2: Foreground `workflow run --json` produces start error envelopes
// ==========================================================================

describe('3.3B-START-ERR-001 — failed workflow emits WORKFLOW_FAILED error envelope [P0, AC#3]', () => {
  let consoleSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    consoleSpy = spyOn(console, 'log').mockImplementation(() => {});
  });
  afterEach(() => {
    consoleSpy.mockRestore();
  });

  test('executeWorkflow returning success:false emits error envelope with WORKFLOW_FAILED', async () => {
    // SKIP REASON: foreground path throws on failure rather than emitting
    // an error envelope in JSON mode.
    // ACTIVATE: once Slice 2 wraps foreground path in withFailClosed-style
    // try/catch and emits buildErrorEnvelope.
    const { discoverWorkflowsWithConfig } = await import('@archon/workflows/workflow-discovery');
    const { executeWorkflow } = await import('@archon/workflows/executor');

    (discoverWorkflowsWithConfig as ReturnType<typeof mock>).mockResolvedValueOnce({
      workflows: [TEST_WORKFLOW],
      errors: [],
    });
    (executeWorkflow as ReturnType<typeof mock>).mockResolvedValueOnce({
      success: false,
      workflowRunId: 'run-fail-001',
      error: 'Node build-step failed',
    });

    await workflowRunCommand('/test/path', 'implement', 'Add auth', {
      json: true,
      noWorktree: true,
    });

    expect(consoleSpy).toHaveBeenCalledTimes(1);
    const envelope = JSON.parse(consoleSpy.mock.calls[0][0] as string) as Record<string, unknown>;

    expect(envelope.success).toBe(false);
    expect(envelope.command).toBe('workflow.start');

    const error = envelope.error as Record<string, unknown>;
    expect(error.code).toBe('WORKFLOW_FAILED');
    expect(error.category).toBe('implementation_defect');
    expect(error.retryable).toBe(true);
    expect(typeof error.details).toBe('object');

    const details = error.details as Record<string, unknown>;
    expect(details.workflowRunId).toBe('run-fail-001');
    expect(typeof details.error).toBe('string');

    // Execution metadata present
    const execution = envelope.execution as Record<string, unknown>;
    expect(typeof execution.durationMs).toBe('number');
    expect(execution.stdoutRedacted).toBe(true);
    expect(execution.stderrRedacted).toBe(true);

    // No result in error envelope
    expect(envelope).not.toHaveProperty('result');
    assertNoForbiddenKeys(envelope);
  });
});

describe('3.3B-START-ERR-002 — workflow not found emits MALFORMED_REQUEST error envelope [P0, AC#3]', () => {
  let consoleSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    consoleSpy = spyOn(console, 'log').mockImplementation(() => {});
  });
  afterEach(() => {
    consoleSpy.mockRestore();
  });

  test('non-existent workflow name emits error envelope with MALFORMED_REQUEST', async () => {
    // SKIP REASON: workflowRunCommand throws an Error for not-found workflows
    // instead of emitting an error envelope in JSON mode.
    // ACTIVATE: once Slice 2 catches not-found and emits MALFORMED_REQUEST.
    const { discoverWorkflowsWithConfig } = await import('@archon/workflows/workflow-discovery');

    (resolveWorkflowName as ReturnType<typeof mock>).mockReturnValueOnce(null);
    (discoverWorkflowsWithConfig as ReturnType<typeof mock>).mockResolvedValueOnce({
      workflows: [TEST_WORKFLOW],
      errors: [],
    });

    await workflowRunCommand('/test/path', 'nonexistent-workflow', 'do stuff', {
      json: true,
      noWorktree: true,
    });

    expect(consoleSpy).toHaveBeenCalledTimes(1);
    const envelope = JSON.parse(consoleSpy.mock.calls[0][0] as string) as Record<string, unknown>;

    expect(envelope.success).toBe(false);
    expect(envelope.command).toBe('workflow.start');

    const error = envelope.error as Record<string, unknown>;
    expect(error.code).toBe('MALFORMED_REQUEST');
    expect(error.category).toBe('provider_contract');
    expect(error.retryable).toBe(false);
  });
});

describe('3.3B-START-ERR-003 — flag validation failure emits MALFORMED_REQUEST [P0, AC#3]', () => {
  let consoleSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    consoleSpy = spyOn(console, 'log').mockImplementation(() => {});
  });
  afterEach(() => {
    consoleSpy.mockRestore();
  });

  test('mutually exclusive flags emit MALFORMED_REQUEST with fieldErrors', async () => {
    // SKIP REASON: workflowRunCommand throws plain Error for flag validation
    // instead of emitting an error envelope.
    // ACTIVATE: once Slice 2 catches flag validation errors in JSON mode.
    const { discoverWorkflowsWithConfig } = await import('@archon/workflows/workflow-discovery');

    (discoverWorkflowsWithConfig as ReturnType<typeof mock>).mockResolvedValueOnce({
      workflows: [TEST_WORKFLOW],
      errors: [],
    });

    await workflowRunCommand('/test/path', 'implement', 'Add auth', {
      json: true,
      branchName: 'my-branch',
      noWorktree: true,
    });

    expect(consoleSpy).toHaveBeenCalledTimes(1);
    const envelope = JSON.parse(consoleSpy.mock.calls[0][0] as string) as Record<string, unknown>;

    expect(envelope.success).toBe(false);
    const error = envelope.error as Record<string, unknown>;
    expect(error.code).toBe('MALFORMED_REQUEST');
    expect(error.category).toBe('provider_contract');
    expect(error.retryable).toBe(false);

    const details = error.details as Record<string, unknown>;
    expect(Array.isArray(details.fieldErrors)).toBe(true);
  });
});

describe('3.3B-START-ERR-004 — timeout error emits COMMAND_TIMEOUT envelope [P0, AC#3]', () => {
  let consoleSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    consoleSpy = spyOn(console, 'log').mockImplementation(() => {});
  });
  afterEach(() => {
    consoleSpy.mockRestore();
  });

  test('ETIMEDOUT from executeWorkflow produces COMMAND_TIMEOUT error envelope', async () => {
    // SKIP REASON: no classifyWorkflowError helper exists yet, and foreground
    // path doesn't catch/classify timeout errors.
    // ACTIVATE: once Slice 2 adds timeout classification and envelope emission.
    const { discoverWorkflowsWithConfig } = await import('@archon/workflows/workflow-discovery');
    const { executeWorkflow } = await import('@archon/workflows/executor');

    (discoverWorkflowsWithConfig as ReturnType<typeof mock>).mockResolvedValueOnce({
      workflows: [TEST_WORKFLOW],
      errors: [],
    });

    const timeoutError = new Error('statement timeout');
    timeoutError.name = 'ETIMEDOUT';
    (executeWorkflow as ReturnType<typeof mock>).mockRejectedValueOnce(timeoutError);

    await workflowRunCommand('/test/path', 'implement', 'Add auth', {
      json: true,
      noWorktree: true,
    });

    expect(consoleSpy).toHaveBeenCalledTimes(1);
    const envelope = JSON.parse(consoleSpy.mock.calls[0][0] as string) as Record<string, unknown>;

    expect(envelope.success).toBe(false);
    const error = envelope.error as Record<string, unknown>;
    expect(error.code).toBe('COMMAND_TIMEOUT');
    expect(error.category).toBe('timeout');
    expect(error.retryable).toBe(true);

    const execution = envelope.execution as Record<string, unknown>;
    expect(execution.timedOut).toBe(true);
  });
});

describe('3.3B-START-ERR-005 — unhandled exception emits INTERNAL_ERROR envelope [P1, AC#3]', () => {
  let consoleSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    consoleSpy = spyOn(console, 'log').mockImplementation(() => {});
  });
  afterEach(() => {
    consoleSpy.mockRestore();
  });

  test('unexpected throw in foreground path emits INTERNAL_ERROR, never unstructured stderr', async () => {
    // SKIP REASON: foreground path propagates exceptions as plain throws.
    // ACTIVATE: once Slice 2 wraps the entire foreground path in withFailClosed.
    const { discoverWorkflowsWithConfig } = await import('@archon/workflows/workflow-discovery');
    const { executeWorkflow } = await import('@archon/workflows/executor');

    (discoverWorkflowsWithConfig as ReturnType<typeof mock>).mockResolvedValueOnce({
      workflows: [TEST_WORKFLOW],
      errors: [],
    });
    (executeWorkflow as ReturnType<typeof mock>).mockRejectedValueOnce(
      new Error('unexpected internal failure')
    );

    await workflowRunCommand('/test/path', 'implement', 'Add auth', {
      json: true,
      noWorktree: true,
    });

    expect(consoleSpy).toHaveBeenCalledTimes(1);
    const envelope = JSON.parse(consoleSpy.mock.calls[0][0] as string) as Record<string, unknown>;

    expect(envelope.success).toBe(false);
    const error = envelope.error as Record<string, unknown>;
    expect(error.code).toBe('INTERNAL_ERROR');
    expect(typeof error.category).toBe('string');
    assertNoForbiddenKeys(envelope);
  });
});

// ==========================================================================
// SLICE 3: `workflow get --json` produces status success envelope
// ==========================================================================

describe('3.3B-STATUS-001 — workflow get --json emits workflow.status success envelope for running run [P0, AC#2]', () => {
  let consoleSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    consoleSpy = spyOn(console, 'log').mockImplementation(() => {});
  });
  afterEach(() => {
    consoleSpy.mockRestore();
  });

  test('running run emits workflow.status envelope with terminal:false', async () => {
    // SKIP REASON: workflowGetCommand --json currently emits the raw
    // WorkflowRun row, not the shared envelope.
    // ACTIVATE: once Slice 3 replaces legacy shape with shared envelope.
    const workflowDb = await import('@archon/core/db/workflows');
    (workflowDb.getWorkflowRun as ReturnType<typeof mock>).mockResolvedValueOnce(RUNNING_RUN);

    await workflowGetCommand('run-001', true);

    expect(consoleSpy).toHaveBeenCalledTimes(1);
    const envelope = JSON.parse(consoleSpy.mock.calls[0][0] as string) as Record<string, unknown>;

    expect(envelope.schemaVersion).toBe('workflow-command-envelope.v1');
    expect(envelope.command).toBe('workflow.status');
    expect(envelope.success).toBe(true);

    const ref = envelope.workflowRunRef as Record<string, unknown>;
    expect(ref.provider).toBe('archon');
    expect(ref.runId).toBe('run-001');
    expect(ref.workflowName).toBe('implement');

    const result = envelope.result as Record<string, unknown>;
    expect(result.operation).toBe('status');
    expect(result.state).toBe('running');
    expect(result.terminal).toBe(false);
    expect(result.actionRequired).toBe(false);

    expect(envelope).not.toHaveProperty('error');
    assertNoForbiddenKeys(envelope);
  });
});

describe('3.3B-STATUS-002 — status enum mapping covers all WorkflowRunStatus values [P0, AC#2]', () => {
  let consoleSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    consoleSpy = spyOn(console, 'log').mockImplementation(() => {});
  });
  afterEach(() => {
    consoleSpy.mockRestore();
  });

  const STATUS_MAP: Array<{
    dbStatus: string;
    expectedState: string;
    expectedTerminal: boolean;
  }> = [
    { dbStatus: 'running', expectedState: 'running', expectedTerminal: false },
    { dbStatus: 'completed', expectedState: 'completed', expectedTerminal: true },
    { dbStatus: 'failed', expectedState: 'failed', expectedTerminal: true },
    { dbStatus: 'cancelled', expectedState: 'cancelled', expectedTerminal: true },
    { dbStatus: 'paused', expectedState: 'waiting-for-approval', expectedTerminal: false },
    { dbStatus: 'pending', expectedState: 'pending', expectedTerminal: false },
  ];

  for (const { dbStatus, expectedState, expectedTerminal } of STATUS_MAP) {
    test(`status '${dbStatus}' maps to state '${expectedState}' with terminal=${String(expectedTerminal)}`, async () => {
      // SKIP REASON: workflowGetCommand --json emits raw run, not envelope.
      // ACTIVATE: once Slice 3 implements status-to-state mapping.
      const workflowDb = await import('@archon/core/db/workflows');
      (workflowDb.getWorkflowRun as ReturnType<typeof mock>).mockResolvedValueOnce({
        ...RUNNING_RUN,
        status: dbStatus,
        metadata:
          dbStatus === 'paused' ? { approval: { nodeId: 'gate-1', message: 'Review' } } : {},
      });

      await workflowGetCommand(`run-${dbStatus}`, true);

      const envelope = JSON.parse(consoleSpy.mock.calls[0][0] as string) as Record<string, unknown>;
      const result = envelope.result as Record<string, unknown>;
      expect(result.state).toBe(expectedState);
      expect(result.terminal).toBe(expectedTerminal);

      consoleSpy.mockClear();
    });
  }
});

describe('3.3B-STATUS-003 — paused run with approval context includes gateRef [P0, AC#2]', () => {
  let consoleSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    consoleSpy = spyOn(console, 'log').mockImplementation(() => {});
  });
  afterEach(() => {
    consoleSpy.mockRestore();
  });

  test('paused run emits gateRef derived from metadata.approval', async () => {
    // SKIP REASON: workflowGetCommand --json emits raw run, not envelope.
    // ACTIVATE: once Slice 3 derives gateRef from isApprovalContext.
    const workflowDb = await import('@archon/core/db/workflows');
    (workflowDb.getWorkflowRun as ReturnType<typeof mock>).mockResolvedValueOnce(PAUSED_RUN);

    await workflowGetCommand('run-004', true);

    const envelope = JSON.parse(consoleSpy.mock.calls[0][0] as string) as Record<string, unknown>;
    const result = envelope.result as Record<string, unknown>;

    expect(result.state).toBe('waiting-for-approval');
    expect(result.actionRequired).toBe(true);
    expect(result.terminal).toBe(false);

    const gateRef = result.gateRef as Record<string, unknown>;
    expect(gateRef).toBeDefined();
    expect(typeof gateRef.gateId).toBe('string');
    expect(gateRef.kind).toBe('human-decision');
  });
});

describe('3.3B-STATUS-004 — completed run has terminal:true, no actionRequired [P1, AC#2]', () => {
  let consoleSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    consoleSpy = spyOn(console, 'log').mockImplementation(() => {});
  });
  afterEach(() => {
    consoleSpy.mockRestore();
  });

  test('completed run emits terminal:true and actionRequired:false', async () => {
    // SKIP REASON: workflowGetCommand --json emits raw run, not envelope.
    // ACTIVATE: once Slice 3 derives terminal from TERMINAL_WORKFLOW_STATUSES.
    const workflowDb = await import('@archon/core/db/workflows');
    (workflowDb.getWorkflowRun as ReturnType<typeof mock>).mockResolvedValueOnce(COMPLETED_RUN);

    await workflowGetCommand('run-002', true);

    const envelope = JSON.parse(consoleSpy.mock.calls[0][0] as string) as Record<string, unknown>;
    const result = envelope.result as Record<string, unknown>;

    expect(result.terminal).toBe(true);
    expect(result.actionRequired).toBe(false);
    expect(result).not.toHaveProperty('gateRef');
  });
});

describe('3.3B-STATUS-005 — correlation-id plumbed to workflow get [P1, AC#2]', () => {
  let consoleSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    consoleSpy = spyOn(console, 'log').mockImplementation(() => {});
  });
  afterEach(() => {
    consoleSpy.mockRestore();
  });

  test('supplied correlation-id appears in status envelope', async () => {
    // SKIP REASON: workflowGetCommand does not accept correlationId parameter.
    // ACTIVATE: once Slice 3 adds correlationId param and cli.ts plumbing.
    const workflowDb = await import('@archon/core/db/workflows');
    (workflowDb.getWorkflowRun as ReturnType<typeof mock>).mockResolvedValueOnce(RUNNING_RUN);

    await workflowGetCommand('run-001', true, false, 'corr_test_status');

    const envelope = JSON.parse(consoleSpy.mock.calls[0][0] as string) as Record<string, unknown>;
    expect(envelope.correlationId).toBe('corr_test_status');
  });
});

// ==========================================================================
// SLICE 4: `workflow get --json` produces status error envelopes
// ==========================================================================

describe('3.3B-STATUS-ERR-001 — not-found run emits NOT_FOUND error envelope [P0, AC#3]', () => {
  let consoleSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    consoleSpy = spyOn(console, 'log').mockImplementation(() => {});
  });
  afterEach(() => {
    consoleSpy.mockRestore();
  });

  test('non-existent run ID emits NOT_FOUND envelope instead of legacy {ok:false}', async () => {
    // SKIP REASON: workflowGetCommand --json emits legacy { ok: false, runId,
    // error: 'not_found' } instead of a shared error envelope.
    // ACTIVATE: once Slice 4 replaces legacy shape with shared error envelope.
    const workflowDb = await import('@archon/core/db/workflows');
    (workflowDb.getWorkflowRun as ReturnType<typeof mock>).mockResolvedValueOnce(null);

    const code = await workflowGetCommand('nonexistent-run', true);

    expect(code).toBe(1);
    expect(consoleSpy).toHaveBeenCalledTimes(1);
    const envelope = JSON.parse(consoleSpy.mock.calls[0][0] as string) as Record<string, unknown>;

    expect(envelope.success).toBe(false);
    expect(envelope.command).toBe('workflow.status');

    const error = envelope.error as Record<string, unknown>;
    expect(error.code).toBe('NOT_FOUND');
    expect(error.category).toBe('unexpected_state');
    expect(error.retryable).toBe(false);

    expect(envelope).not.toHaveProperty('result');
    assertNoForbiddenKeys(envelope);
  });
});

describe('3.3B-STATUS-ERR-002 — DB error emits INTERNAL_ERROR envelope [P0, AC#3]', () => {
  let consoleSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    consoleSpy = spyOn(console, 'log').mockImplementation(() => {});
  });
  afterEach(() => {
    consoleSpy.mockRestore();
  });

  test('DB query failure emits INTERNAL_ERROR envelope with execution metadata', async () => {
    // SKIP REASON: workflowGetCommand --json emits legacy { ok: false } shape
    // for DB errors.
    // ACTIVATE: once Slice 4 classifies DB errors into shared error envelopes.
    const workflowDb = await import('@archon/core/db/workflows');
    (workflowDb.getWorkflowRun as ReturnType<typeof mock>).mockRejectedValueOnce(
      new Error('connection refused')
    );

    const code = await workflowGetCommand('run-db-err', true);

    expect(code).toBe(1);
    const envelope = JSON.parse(consoleSpy.mock.calls[0][0] as string) as Record<string, unknown>;

    expect(envelope.success).toBe(false);
    expect(envelope.command).toBe('workflow.status');

    const error = envelope.error as Record<string, unknown>;
    expect(error.code).toBe('INTERNAL_ERROR');
    expect(typeof error.category).toBe('string');

    const execution = envelope.execution as Record<string, unknown>;
    expect(typeof execution.durationMs).toBe('number');
    expect(execution.stdoutRedacted).toBe(true);
    expect(execution.stderrRedacted).toBe(true);

    assertNoForbiddenKeys(envelope);
  });
});

describe('3.3B-STATUS-ERR-003 — DB timeout emits COMMAND_TIMEOUT envelope [P1, AC#3]', () => {
  let consoleSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    consoleSpy = spyOn(console, 'log').mockImplementation(() => {});
  });
  afterEach(() => {
    consoleSpy.mockRestore();
  });

  test('DB statement timeout emits COMMAND_TIMEOUT envelope', async () => {
    // SKIP REASON: no timeout classification exists for workflowGetCommand.
    // ACTIVATE: once Slice 4 classifies timeout errors.
    const workflowDb = await import('@archon/core/db/workflows');
    const timeoutError = new Error('statement timeout');
    (workflowDb.getWorkflowRun as ReturnType<typeof mock>).mockRejectedValueOnce(timeoutError);

    const code = await workflowGetCommand('run-timeout', true);

    expect(code).toBe(1);
    const envelope = JSON.parse(consoleSpy.mock.calls[0][0] as string) as Record<string, unknown>;

    expect(envelope.success).toBe(false);
    const error = envelope.error as Record<string, unknown>;
    expect(error.code).toBe('COMMAND_TIMEOUT');
    expect(error.category).toBe('timeout');
    expect(error.retryable).toBe(true);

    const execution = envelope.execution as Record<string, unknown>;
    expect(execution.timedOut).toBe(true);
  });
});

// ==========================================================================
// SLICE 5: Contract fixture conformance tests
// ==========================================================================

describe('3.3B-CONTRACT-001 — start success envelope matches fixture field-by-field [P0, AC#1]', () => {
  let consoleSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    consoleSpy = spyOn(console, 'log').mockImplementation(() => {});
  });
  afterEach(() => {
    consoleSpy.mockRestore();
  });

  test('runtime-produced start envelope matches start-success.json fixture (dynamic fields excluded)', async () => {
    // SKIP REASON: foreground path doesn't produce shared envelope yet.
    // ACTIVATE: once Slices 1+5 are complete.
    const { discoverWorkflowsWithConfig } = await import('@archon/workflows/workflow-discovery');
    const { executeWorkflow } = await import('@archon/workflows/executor');

    (discoverWorkflowsWithConfig as ReturnType<typeof mock>).mockResolvedValueOnce({
      workflows: [TEST_WORKFLOW],
      errors: [],
    });
    (executeWorkflow as ReturnType<typeof mock>).mockResolvedValueOnce({
      success: true,
      workflowRunId: 'archon-run-story-1-3a-001',
    });

    await workflowRunCommand('/test/path', 'implement', 'Add auth', {
      json: true,
      noWorktree: true,
    });

    const fixture = loadFixture('start-success.json');
    const envelope = JSON.parse(consoleSpy.mock.calls[0][0] as string) as Record<string, unknown>;

    const strippedFixture = stripDynamicFields(fixture);
    const strippedEnvelope = stripDynamicFields(envelope);

    // Static structural fields must match exactly
    expect(strippedEnvelope.schemaVersion).toEqual(strippedFixture.schemaVersion);
    expect(strippedEnvelope.intendedProducer).toEqual(strippedFixture.intendedProducer);
    expect(strippedEnvelope.intendedConsumer).toEqual(strippedFixture.intendedConsumer);
    expect(strippedEnvelope.owningSubproject).toEqual(strippedFixture.owningSubproject);
    expect(strippedEnvelope.provider).toEqual(strippedFixture.provider);
    expect(strippedEnvelope.command).toEqual(strippedFixture.command);
    expect(strippedEnvelope.success).toEqual(strippedFixture.success);

    // Result shape fields match
    const fixtureResult = strippedFixture.result as Record<string, unknown>;
    const envelopeResult = strippedEnvelope.result as Record<string, unknown>;
    expect(envelopeResult.operation).toBe(fixtureResult.operation);
    expect(envelopeResult.state).toBe(fixtureResult.state);
    expect(envelopeResult.phase).toBe(fixtureResult.phase);
    expect(envelopeResult.accepted).toBe(fixtureResult.accepted);
  });
});

describe('3.3B-CONTRACT-002 — status success envelope matches fixture field-by-field [P0, AC#2]', () => {
  let consoleSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    consoleSpy = spyOn(console, 'log').mockImplementation(() => {});
  });
  afterEach(() => {
    consoleSpy.mockRestore();
  });

  test('runtime-produced status envelope matches status-success.json fixture (dynamic fields excluded)', async () => {
    // SKIP REASON: workflowGetCommand --json emits raw run, not envelope.
    // ACTIVATE: once Slices 3+5 are complete.
    const workflowDb = await import('@archon/core/db/workflows');
    (workflowDb.getWorkflowRun as ReturnType<typeof mock>).mockResolvedValueOnce(PAUSED_RUN);

    await workflowGetCommand('run-004', true);

    const fixture = loadFixture('status-success.json');
    const envelope = JSON.parse(consoleSpy.mock.calls[0][0] as string) as Record<string, unknown>;

    const strippedFixture = stripDynamicFields(fixture);
    const strippedEnvelope = stripDynamicFields(envelope);

    expect(strippedEnvelope.schemaVersion).toEqual(strippedFixture.schemaVersion);
    expect(strippedEnvelope.command).toEqual(strippedFixture.command);
    expect(strippedEnvelope.success).toEqual(strippedFixture.success);

    const fixtureResult = strippedFixture.result as Record<string, unknown>;
    const envelopeResult = strippedEnvelope.result as Record<string, unknown>;
    expect(envelopeResult.operation).toBe(fixtureResult.operation);
    expect(envelopeResult.terminal).toBe(fixtureResult.terminal);
    expect(envelopeResult.actionRequired).toBe(fixtureResult.actionRequired);
  });
});

describe('3.3B-CONTRACT-003 — forbidden keys absent from all envelopes [P0, AC#1/2/3]', () => {
  let consoleSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    consoleSpy = spyOn(console, 'log').mockImplementation(() => {});
  });
  afterEach(() => {
    consoleSpy.mockRestore();
  });

  test('start success envelope contains no forbidden keys', async () => {
    // SKIP REASON: foreground path doesn't produce shared envelope yet.
    // ACTIVATE: once Slice 1 is implemented.
    const { discoverWorkflowsWithConfig } = await import('@archon/workflows/workflow-discovery');
    const { executeWorkflow } = await import('@archon/workflows/executor');

    (discoverWorkflowsWithConfig as ReturnType<typeof mock>).mockResolvedValueOnce({
      workflows: [TEST_WORKFLOW],
      errors: [],
    });
    (executeWorkflow as ReturnType<typeof mock>).mockResolvedValueOnce({
      success: true,
      workflowRunId: 'run-fk-001',
    });

    await workflowRunCommand('/test/path', 'implement', 'Add auth', {
      json: true,
      noWorktree: true,
    });

    const envelope = JSON.parse(consoleSpy.mock.calls[0][0] as string) as Record<string, unknown>;
    assertNoForbiddenKeys(envelope);
  });

  test('status success envelope contains no forbidden keys', async () => {
    // SKIP REASON: workflowGetCommand --json emits raw run, not envelope.
    // ACTIVATE: once Slice 3 is implemented.
    const workflowDb = await import('@archon/core/db/workflows');
    (workflowDb.getWorkflowRun as ReturnType<typeof mock>).mockResolvedValueOnce(RUNNING_RUN);

    await workflowGetCommand('run-001', true);

    const envelope = JSON.parse(consoleSpy.mock.calls[0][0] as string) as Record<string, unknown>;
    assertNoForbiddenKeys(envelope);
  });

  test('error envelope contains no forbidden keys', async () => {
    // SKIP REASON: workflowGetCommand --json emits legacy shape for errors.
    // ACTIVATE: once Slice 4 is implemented.
    const workflowDb = await import('@archon/core/db/workflows');
    (workflowDb.getWorkflowRun as ReturnType<typeof mock>).mockResolvedValueOnce(null);

    await workflowGetCommand('nonexistent', true);

    const envelope = JSON.parse(consoleSpy.mock.calls[0][0] as string) as Record<string, unknown>;
    assertNoForbiddenKeys(envelope);
  });
});

describe('3.3B-CONTRACT-004 — error fixtures are all producible by workflow commands [P0, AC#3]', () => {
  const ERROR_FIXTURES = [
    'error-malformed-request.json',
    'error-schema-mismatch.json',
    'error-timeout.json',
    'error-unexpected-exit.json',
    'error-unexpected-state.json',
  ];

  test('all 5 error fixture files exist on disk (regression guard)', () => {
    const present = new Set(readdirSync(COMMANDS_DIR));
    for (const name of ERROR_FIXTURES) {
      expect(present.has(name)).toBe(true);
    }
  });

  for (const fixture of ERROR_FIXTURES) {
    test(`${fixture} has valid error shape with code, category, retryable, details`, () => {
      const f = loadFixture(fixture) as {
        success: boolean;
        error: { code: string; category: string; retryable: boolean; details: unknown };
        execution: { exitCode: number | null; timedOut: boolean };
      };
      expect(f.success).toBe(false);
      expect(typeof f.error.code).toBe('string');
      expect(typeof f.error.category).toBe('string');
      expect(typeof f.error.retryable).toBe('boolean');
      expect(typeof f.error.details).toBe('object');
      expect(typeof f.execution).toBe('object');
    });
  }
});

// ==========================================================================
// REGRESSION: --detach --json still produces existing ack shape
// ==========================================================================

describe('3.3B-REGRESSION-001 — --detach --json ack shape is preserved [P0, AC#1]', () => {
  let consoleSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    consoleSpy = spyOn(console, 'log').mockImplementation(() => {});
  });
  afterEach(() => {
    consoleSpy.mockRestore();
  });

  test('--detach --json still emits {ok, action, detached, workflow, conversationId}', async () => {
    const { discoverWorkflowsWithConfig } = await import('@archon/workflows/workflow-discovery');
    const paths = await import('@archon/paths');
    (discoverWorkflowsWithConfig as ReturnType<typeof mock>).mockResolvedValueOnce({
      workflows: [TEST_WORKFLOW],
      errors: [],
    });
    (paths.getArchonHome as ReturnType<typeof mock>).mockImplementationOnce(() => {
      throw new Error('no home in test');
    });
    const spawnSpy = spyOn(Bun, 'spawn').mockReturnValue({
      unref: mock(() => undefined),
    } as unknown as ReturnType<typeof Bun.spawn>);
    const savedArgv = process.argv;
    process.argv = [
      'bun',
      '/abs/cli.ts',
      'workflow',
      'run',
      'implement',
      'hello',
      '--detach',
      '--json',
    ];

    try {
      await workflowRunCommand('/test/path', 'implement', 'hello', { detach: true, json: true });
    } finally {
      process.argv = savedArgv;
      spawnSpy.mockRestore();
    }

    const parsed = JSON.parse(consoleSpy.mock.calls[0][0] as string) as Record<string, unknown>;
    expect(parsed).toMatchObject({
      ok: true,
      action: 'run',
      detached: true,
      workflow: 'implement',
    });
    expect(typeof parsed.conversationId).toBe('string');
    // The detach ack must NOT use the shared envelope structure
    expect(parsed).not.toHaveProperty('schemaVersion');
    expect(parsed).not.toHaveProperty('intendedProducer');
  });
});

// ==========================================================================
// SLICE 5 (continued): Schema-level validation
// ==========================================================================

describe('3.3B-CONTRACT-005 — contract schema structural checks [P0, AC#1/2/3]', () => {
  test('workflow-command-envelope.schema.json exists and requires the expected top-level fields', () => {
    const schema = JSON.parse(readFileSync(SCHEMA_PATH, 'utf8')) as {
      required: string[];
      properties: Record<string, unknown>;
    };
    const required = new Set(schema.required);
    expect(required.has('schemaVersion')).toBe(true);
    expect(required.has('command')).toBe(true);
    expect(required.has('correlationId')).toBe(true);
    expect(required.has('issuedAt')).toBe(true);
    expect(required.has('success')).toBe(true);
  });

  test('schema command enum includes workflow.start and workflow.status', () => {
    const schema = JSON.parse(readFileSync(SCHEMA_PATH, 'utf8')) as {
      properties: { command: { enum: string[] } };
    };
    expect(schema.properties.command.enum).toContain('workflow.start');
    expect(schema.properties.command.enum).toContain('workflow.status');
  });
});

describe('3.3B-CONTRACT-006 — result/error exclusivity in fixture examples [P0, AC#1/2/3]', () => {
  test('success fixtures have result and no error; error fixtures have error and no result', () => {
    const successFixtures = ['start-success.json', 'status-success.json'];
    for (const name of successFixtures) {
      const f = loadFixture(name);
      expect(f.success).toBe(true);
      expect(f).toHaveProperty('result');
      expect(f).not.toHaveProperty('error');
      expect(f).not.toHaveProperty('execution');
    }

    const errorFixtures = [
      'error-malformed-request.json',
      'error-timeout.json',
      'error-unexpected-exit.json',
      'error-unexpected-state.json',
      'error-schema-mismatch.json',
    ];
    for (const name of errorFixtures) {
      const f = loadFixture(name);
      expect(f.success).toBe(false);
      expect(f).toHaveProperty('error');
      expect(f).toHaveProperty('execution');
      expect(f).not.toHaveProperty('result');
    }
  });
});

// ==========================================================================
// NO-SIDE-EFFECT: read-only status query
// ==========================================================================

describe('3.3B-NOSIDEEFFECT-001 — workflow get --json is a pure read [P1, AC#2]', () => {
  let consoleSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    consoleSpy = spyOn(console, 'log').mockImplementation(() => {});
  });
  afterEach(() => {
    consoleSpy.mockRestore();
  });

  test('workflow get --json does not call any mutating DB operations', async () => {
    // SKIP REASON: workflowGetCommand --json emits raw run, not envelope, so
    // testing would pass vacuously against the legacy shape rather than the
    // new envelope path.
    // ACTIVATE: once Slice 3 replaces legacy shape with shared envelope.
    const workflowDb = await import('@archon/core/db/workflows');
    (workflowDb.getWorkflowRun as ReturnType<typeof mock>).mockResolvedValueOnce(RUNNING_RUN);

    await workflowGetCommand('run-001', true);

    // Assert no write operations were called
    expect(workflowDb.failWorkflowRun as ReturnType<typeof mock>).not.toHaveBeenCalled();
    expect(workflowDb.cancelWorkflowRun as ReturnType<typeof mock>).not.toHaveBeenCalled();
    expect(workflowDb.updateWorkflowRun as ReturnType<typeof mock>).not.toHaveBeenCalled();
    expect(workflowDb.resumeWorkflowRun as ReturnType<typeof mock>).not.toHaveBeenCalled();
  });
});

// ==========================================================================
// CONCURRENCY / RACE: correlation ID independence
// ==========================================================================

describe('3.3B-CONCURRENCY-001 — auto-generated correlation IDs are unique per invocation [P1, AC#1]', () => {
  let consoleSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    consoleSpy = spyOn(console, 'log').mockImplementation(() => {});
  });
  afterEach(() => {
    consoleSpy.mockRestore();
  });

  test('two sequential foreground runs produce different correlationIds', async () => {
    // SKIP REASON: foreground path doesn't produce shared envelope yet.
    // ACTIVATE: once Slice 1 is implemented.
    const { discoverWorkflowsWithConfig } = await import('@archon/workflows/workflow-discovery');
    const { executeWorkflow } = await import('@archon/workflows/executor');

    // First invocation
    (discoverWorkflowsWithConfig as ReturnType<typeof mock>).mockResolvedValueOnce({
      workflows: [TEST_WORKFLOW],
      errors: [],
    });
    (executeWorkflow as ReturnType<typeof mock>).mockResolvedValueOnce({
      success: true,
      workflowRunId: 'run-a',
    });
    await workflowRunCommand('/test/path', 'implement', 'first', {
      json: true,
      noWorktree: true,
    });
    const env1 = JSON.parse(consoleSpy.mock.calls[0][0] as string) as Record<string, unknown>;

    consoleSpy.mockClear();

    // Second invocation
    (discoverWorkflowsWithConfig as ReturnType<typeof mock>).mockResolvedValueOnce({
      workflows: [TEST_WORKFLOW],
      errors: [],
    });
    (executeWorkflow as ReturnType<typeof mock>).mockResolvedValueOnce({
      success: true,
      workflowRunId: 'run-b',
    });
    await workflowRunCommand('/test/path', 'implement', 'second', {
      json: true,
      noWorktree: true,
    });
    const env2 = JSON.parse(consoleSpy.mock.calls[0][0] as string) as Record<string, unknown>;

    expect(env1.correlationId).not.toBe(env2.correlationId);
  });
});

// ==========================================================================
// CONTRACT FIXTURE INVENTORY GUARD
// ==========================================================================

describe('3.3B-FIXTURE-GUARD — all referenced fixtures exist on disk', () => {
  test('start-success.json and status-success.json fixture files exist', () => {
    const present = new Set(readdirSync(COMMANDS_DIR));
    expect(present.has('start-success.json')).toBe(true);
    expect(present.has('status-success.json')).toBe(true);
  });

  test('contract schema file exists', () => {
    expect(() => readFileSync(SCHEMA_PATH, 'utf8')).not.toThrow();
  });
});
