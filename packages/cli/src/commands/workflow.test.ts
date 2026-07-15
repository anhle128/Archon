/**
 * Tests for workflow commands
 */
import { describe, it, expect, beforeEach, afterEach, spyOn, mock } from 'bun:test';
import type { WorkflowEmitterEvent } from '@archon/workflows/event-emitter';
import { makeTestWorkflowWithSource } from '@archon/workflows/test-utils';
import {
  workflowListCommand,
  workflowRunCommand,
  workflowStatusCommand,
  workflowGetCommand,
  workflowRunsCommand,
  workflowResumeCommand,
  workflowAbandonCommand,
  workflowApproveCommand,
  workflowRejectCommand,
  workflowCleanupCommand,
  workflowResetSessionsCommand,
  buildDetachedRunCmd,
} from './workflow';

const mockLogger = {
  fatal: mock(() => undefined),
  error: mock(() => undefined),
  warn: mock(() => undefined),
  info: mock(() => undefined),
  debug: mock(() => undefined),
  trace: mock(() => undefined),
  child: mock(() => mockLogger),
};

// Mock @archon/paths (createLogger moved here from @archon/core)
mock.module('@archon/paths', () => ({
  captureApprovalResolved: () => undefined,
  createLogger: mock(() => mockLogger),
  getArchonHome: mock(() => '/home/test/.archon'),
  BUNDLED_IS_BINARY: false,
}));

// Mock @archon/isolation (getIsolationProvider moved here from @archon/core)
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

// Mock the @archon/core modules
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

// Capture the subscription handler so tests can trigger events
let capturedSubscribeHandler: ((event: WorkflowEmitterEvent) => void) | null = null;
const mockUnsubscribe = mock(() => undefined);

mock.module('@archon/workflows/event-emitter', () => ({
  getWorkflowEventEmitter: mock(() => ({
    subscribeForConversation: mock(
      (_convId: string, handler: (event: WorkflowEmitterEvent) => void) => {
        capturedSubscribeHandler = handler;
        return mockUnsubscribe;
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
    Promise.resolve({ id: 'conv-123', platform_type: 'cli', platform_conversation_id: 'cli-123' })
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
      counts: { all: 0, running: 0, completed: 0, failed: 0, cancelled: 0, pending: 0, paused: 0 },
    })
  ),
  deleteOldWorkflowRuns: mock(() => Promise.resolve({ count: 0 })),
}));

mock.module('@archon/core/db/workflow-events', () => ({
  listWorkflowEvents: mock(() => Promise.resolve([])),
  createWorkflowEvent: mock(() => Promise.resolve()),
}));

// Reset-sessions runs the real resetWorkflowNodeSessions operation over this mocked
// DB layer (same pattern as the other workflow commands in this file). Safe from
// mock.module pollution: workflow.test.ts is its own isolated `bun test` invocation.
const mockDeleteNodeSessions = mock(() => Promise.resolve({ deleted: 0 }));
mock.module('@archon/core/db/workflow-node-sessions', () => ({
  deleteWorkflowNodeSessions: mockDeleteNodeSessions,
  getWorkflowNodeSession: mock(() => Promise.resolve(null)),
  upsertWorkflowNodeSession: mock(() => Promise.resolve()),
}));

describe('workflowListCommand', () => {
  let consoleSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    consoleSpy = spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  it('should display message when no workflows found', async () => {
    const { discoverWorkflowsWithConfig } = await import('@archon/workflows/workflow-discovery');
    (discoverWorkflowsWithConfig as ReturnType<typeof mock>).mockResolvedValueOnce({
      workflows: [],
      errors: [],
    });

    await workflowListCommand('/test/path');

    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Discovering workflows'));
    expect(consoleSpy).toHaveBeenCalledWith('\nNo workflows found.');
  });

  it('should list workflows with names and descriptions', async () => {
    const { discoverWorkflowsWithConfig } = await import('@archon/workflows/workflow-discovery');
    (discoverWorkflowsWithConfig as ReturnType<typeof mock>).mockResolvedValueOnce({
      workflows: [
        makeTestWorkflowWithSource({ name: 'assist', description: 'General assistance workflow' }),
        makeTestWorkflowWithSource({
          name: 'plan',
          description: 'Create implementation plan',
          provider: 'claude',
        }),
      ],
      errors: [],
    });

    await workflowListCommand('/test/path');

    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Found 2 workflow(s)'));
    expect(consoleSpy).toHaveBeenCalledWith('  assist');
    expect(consoleSpy).toHaveBeenCalledWith('    General assistance workflow');
    expect(consoleSpy).toHaveBeenCalledWith('  plan');
    expect(consoleSpy).toHaveBeenCalledWith('    Create implementation plan');
    expect(consoleSpy).toHaveBeenCalledWith('    Provider: claude');
  });

  it('should output JSON when json flag is true', async () => {
    const { discoverWorkflowsWithConfig } = await import('@archon/workflows/workflow-discovery');
    (discoverWorkflowsWithConfig as ReturnType<typeof mock>).mockResolvedValueOnce({
      workflows: [
        makeTestWorkflowWithSource({ name: 'assist', description: 'General assistance workflow' }),
        makeTestWorkflowWithSource({
          name: 'plan',
          description: 'Create implementation plan',
          provider: 'claude',
        }),
      ],
      errors: [],
    });

    await workflowListCommand('/test/path', true);

    expect(consoleSpy).toHaveBeenCalledTimes(1);
    const output = consoleSpy.mock.calls[0][0] as string;
    const parsed = JSON.parse(output) as { workflows: unknown[]; errors: unknown[] };
    expect(parsed.workflows).toHaveLength(2);
    expect(parsed.errors).toHaveLength(0);
    expect(parsed.workflows[0]).toEqual({
      name: 'assist',
      description: 'General assistance workflow',
    });
    expect(parsed.workflows[1]).toEqual({
      name: 'plan',
      description: 'Create implementation plan',
      provider: 'claude',
    });
  });

  it('should include errors in JSON output', async () => {
    const { discoverWorkflowsWithConfig } = await import('@archon/workflows/workflow-discovery');
    (discoverWorkflowsWithConfig as ReturnType<typeof mock>).mockResolvedValueOnce({
      workflows: [],
      errors: [{ filename: 'bad.yaml', error: 'Invalid YAML', errorType: 'parse_error' }],
    });

    await workflowListCommand('/test/path', true);

    const output = consoleSpy.mock.calls[0][0] as string;
    const parsed = JSON.parse(output) as {
      workflows: unknown[];
      errors: Array<{ filename: string; error: string; errorType: string }>;
    };
    expect(parsed.workflows).toHaveLength(0);
    expect(parsed.errors).toHaveLength(1);
    expect(parsed.errors[0]).toEqual({
      filename: 'bad.yaml',
      error: 'Invalid YAML',
      errorType: 'parse_error',
    });
  });

  it('should not print header text in JSON mode', async () => {
    const { discoverWorkflowsWithConfig } = await import('@archon/workflows/workflow-discovery');
    (discoverWorkflowsWithConfig as ReturnType<typeof mock>).mockResolvedValueOnce({
      workflows: [],
      errors: [],
    });

    await workflowListCommand('/test/path', true);

    // Only one console.log call (the JSON), no "Discovering workflows" text
    expect(consoleSpy).toHaveBeenCalledTimes(1);
    const output = consoleSpy.mock.calls[0][0] as string;
    expect(output).not.toContain('Discovering workflows');
    // Output must be valid JSON
    expect(() => JSON.parse(output)).not.toThrow();
  });

  it('should include modelReasoningEffort and webSearchMode in JSON output when present', async () => {
    const { discoverWorkflowsWithConfig } = await import('@archon/workflows/workflow-discovery');
    (discoverWorkflowsWithConfig as ReturnType<typeof mock>).mockResolvedValueOnce({
      workflows: [
        makeTestWorkflowWithSource({
          name: 'plan',
          description: 'Planning workflow',
          provider: 'codex',
          model: 'gpt-5.3-codex',
          modelReasoningEffort: 'high',
          webSearchMode: 'live',
        }),
      ],
      errors: [],
    });

    await workflowListCommand('/test/path', true);

    const output = consoleSpy.mock.calls[0][0] as string;
    const parsed = JSON.parse(output) as {
      workflows: Array<Record<string, string>>;
      errors: unknown[];
    };
    expect(parsed.workflows[0]).toEqual({
      name: 'plan',
      description: 'Planning workflow',
      provider: 'codex',
      model: 'gpt-5.3-codex',
      modelReasoningEffort: 'high',
      webSearchMode: 'live',
    });
  });

  it('should produce text output when json flag is false', async () => {
    const { discoverWorkflowsWithConfig } = await import('@archon/workflows/workflow-discovery');
    (discoverWorkflowsWithConfig as ReturnType<typeof mock>).mockResolvedValueOnce({
      workflows: [
        makeTestWorkflowWithSource({ name: 'assist', description: 'General assistance' }),
      ],
      errors: [],
    });

    await workflowListCommand('/test/path', false);

    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Discovering workflows'));
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Found 1 workflow(s)'));
  });

  it('calls discoverWorkflowsWithConfig with (cwd, loadConfig) — home scope is internal', async () => {
    const { discoverWorkflowsWithConfig } = await import('@archon/workflows/workflow-discovery');
    (discoverWorkflowsWithConfig as ReturnType<typeof mock>).mockResolvedValueOnce({
      workflows: [],
      errors: [],
    });

    await workflowListCommand('/test/path');

    // After the globalSearchPath refactor, discovery reads ~/.archon/workflows/
    // on every call with no option — every caller inherits home-scope for free.
    expect(discoverWorkflowsWithConfig).toHaveBeenCalledWith('/test/path', expect.any(Function));
  });

  it('should throw error when discoverWorkflows fails', async () => {
    const { discoverWorkflowsWithConfig } = await import('@archon/workflows/workflow-discovery');
    (discoverWorkflowsWithConfig as ReturnType<typeof mock>).mockRejectedValueOnce(
      new Error('Permission denied')
    );

    await expect(workflowListCommand('/test/path')).rejects.toThrow(
      'Error loading workflows: Permission denied'
    );
  });
});

describe('workflowRunCommand', () => {
  let consoleSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    consoleSpy = spyOn(console, 'log').mockImplementation(() => {});
    mockLogger.warn.mockClear();
    mockLogger.error.mockClear();
    mockLogger.info.mockClear();
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  it('should throw error when no workflows found', async () => {
    const { discoverWorkflowsWithConfig } = await import('@archon/workflows/workflow-discovery');
    (discoverWorkflowsWithConfig as ReturnType<typeof mock>).mockResolvedValueOnce({
      workflows: [],
      errors: [],
    });

    await expect(workflowRunCommand('/test/path', 'assist', 'hello')).rejects.toThrow(
      'No workflows found in .archon/workflows/'
    );
  });

  it('logs effective discovery root and source breakdown for every run', async () => {
    const { discoverWorkflowsWithConfig } = await import('@archon/workflows/workflow-discovery');
    (discoverWorkflowsWithConfig as ReturnType<typeof mock>).mockResolvedValueOnce({
      workflows: [
        makeTestWorkflowWithSource({ name: 'assist' }, 'bundled'),
        makeTestWorkflowWithSource({ name: 'home-helper' }, 'global'),
        makeTestWorkflowWithSource({ name: 'project-flow' }, 'project'),
      ],
      errors: [],
    });

    await workflowRunCommand('/repo/root', 'assist', 'hello', { noWorktree: true });

    expect(consoleSpy).toHaveBeenCalledWith(
      'Discovery: root=/repo/root workflows=3 bundled=1 global=1 project=1'
    );
  });

  it('uses discoveryCwd in the discovery diagnostic when supplied', async () => {
    const { discoverWorkflowsWithConfig } = await import('@archon/workflows/workflow-discovery');
    (discoverWorkflowsWithConfig as ReturnType<typeof mock>).mockResolvedValueOnce({
      workflows: [makeTestWorkflowWithSource({ name: 'assist' }, 'project')],
      errors: [],
    });

    await workflowRunCommand('/tmp/worktree', 'assist', 'hello', {
      noWorktree: true,
      discoveryCwd: '/repo/source',
    });

    expect(discoverWorkflowsWithConfig).toHaveBeenCalledWith('/repo/source', expect.any(Function));
    expect(consoleSpy).toHaveBeenCalledWith(
      'Discovery: root=/repo/source workflows=1 bundled=0 global=0 project=1'
    );
  });

  it('does not print discovery diagnostic in json mode', async () => {
    const { discoverWorkflowsWithConfig } = await import('@archon/workflows/workflow-discovery');
    (discoverWorkflowsWithConfig as ReturnType<typeof mock>).mockResolvedValueOnce({
      workflows: [makeTestWorkflowWithSource({ name: 'assist' }, 'project')],
      errors: [],
    });

    try {
      await workflowRunCommand('/repo/root', 'assist', 'hello', {
        json: true,
        noWorktree: true,
      });
    } catch {
      // Downstream failure is acceptable; this test only verifies diagnostic suppression.
    }

    expect(consoleSpy).not.toHaveBeenCalledWith(expect.stringContaining('Discovery: root='));
  });

  it('does not print discovery diagnostic in quiet mode', async () => {
    const { discoverWorkflowsWithConfig } = await import('@archon/workflows/workflow-discovery');
    (discoverWorkflowsWithConfig as ReturnType<typeof mock>).mockResolvedValueOnce({
      workflows: [makeTestWorkflowWithSource({ name: 'assist' }, 'project')],
      errors: [],
    });

    try {
      await workflowRunCommand('/repo/root', 'assist', 'hello', {
        quiet: true,
        noWorktree: true,
      });
    } catch {
      // Downstream failure is acceptable; this test only verifies diagnostic suppression.
    }

    expect(consoleSpy).not.toHaveBeenCalledWith(expect.stringContaining('Discovery: root='));
  });

  it('should throw error when workflow not found', async () => {
    const { discoverWorkflowsWithConfig } = await import('@archon/workflows/workflow-discovery');
    (discoverWorkflowsWithConfig as ReturnType<typeof mock>).mockResolvedValueOnce({
      workflows: [
        makeTestWorkflowWithSource({ name: 'assist', description: 'Help' }),
        makeTestWorkflowWithSource({ name: 'plan', description: 'Plan' }),
      ],
      errors: [],
    });

    await expect(workflowRunCommand('/test/path', 'nonexistent', 'hello')).rejects.toThrow(
      "Workflow 'nonexistent' not found"
    );
  });

  it('should include available workflows in error when workflow not found', async () => {
    const { discoverWorkflowsWithConfig } = await import('@archon/workflows/workflow-discovery');
    (discoverWorkflowsWithConfig as ReturnType<typeof mock>).mockResolvedValueOnce({
      workflows: [
        makeTestWorkflowWithSource({ name: 'assist', description: 'Help' }),
        makeTestWorkflowWithSource({ name: 'plan', description: 'Plan' }),
      ],
      errors: [],
    });

    try {
      await workflowRunCommand('/test/path', 'nonexistent', 'hello');
    } catch (error) {
      const err = error as Error;
      expect(err.message).toContain('Available workflows:');
      expect(err.message).toContain('- assist');
      expect(err.message).toContain('- plan');
    }
  });

  it('should resolve workflow by suffix match', async () => {
    const { discoverWorkflowsWithConfig } = await import('@archon/workflows/workflow-discovery');
    const conversationDb = await import('@archon/core/db/conversations');
    const codebaseDb = await import('@archon/core/db/codebases');

    (discoverWorkflowsWithConfig as ReturnType<typeof mock>).mockResolvedValueOnce({
      workflows: [
        makeTestWorkflowWithSource({ name: 'archon-assist', description: 'Help' }),
        makeTestWorkflowWithSource({ name: 'archon-plan', description: 'Plan' }),
      ],
      errors: [],
    });
    (conversationDb.getOrCreateConversation as ReturnType<typeof mock>).mockResolvedValueOnce({
      id: 'conv-1',
      platform: 'cli',
      platform_conversation_id: 'cli-123',
      title: null,
      is_active: true,
      codebase_id: null,
    });
    (codebaseDb.findCodebaseByDefaultCwd as ReturnType<typeof mock>).mockResolvedValueOnce({
      id: 'cb-1',
      name: 'test-repo',
      default_cwd: '/test/path',
    });

    // Should resolve successfully — "assist" suffix-matches "archon-assist"
    await workflowRunCommand('/test/path', 'assist', 'hello');

    // Verify suffix matching tier was used
    expect(mockLogger.info).toHaveBeenCalledWith(
      expect.objectContaining({ requested: 'assist', matched: 'archon-assist' }),
      'workflow.resolve_suffix_match'
    );
  });

  it('should resolve workflow by substring match', async () => {
    const { discoverWorkflowsWithConfig } = await import('@archon/workflows/workflow-discovery');

    (discoverWorkflowsWithConfig as ReturnType<typeof mock>).mockResolvedValueOnce({
      workflows: [
        makeTestWorkflowWithSource({ name: 'archon-smart-pr-review', description: 'Smart review' }),
        makeTestWorkflowWithSource({ name: 'archon-assist', description: 'Help' }),
      ],
      errors: [],
    });

    // "smart" substring-matches only "archon-smart-pr-review"
    // Will fail downstream at executeWorkflow mock, but must NOT throw "not found"
    const error = await workflowRunCommand('/test/path', 'smart', 'hello').catch(
      (e: unknown) => e as Error
    );
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).not.toContain('not found');
    expect((error as Error).message).not.toContain('Did you mean');
  });

  it('should prefer case-insensitive exact match over suffix match', async () => {
    const { discoverWorkflowsWithConfig } = await import('@archon/workflows/workflow-discovery');
    const conversationDb = await import('@archon/core/db/conversations');
    const codebaseDb = await import('@archon/core/db/codebases');

    (discoverWorkflowsWithConfig as ReturnType<typeof mock>).mockResolvedValueOnce({
      workflows: [
        makeTestWorkflowWithSource({ name: 'assist', description: 'Help' }),
        makeTestWorkflowWithSource({ name: 'archon-assist', description: 'Long' }),
      ],
      errors: [],
    });
    (conversationDb.getOrCreateConversation as ReturnType<typeof mock>).mockResolvedValueOnce({
      id: 'conv-1',
      platform: 'cli',
      platform_conversation_id: 'cli-123',
      title: null,
      is_active: true,
      codebase_id: null,
    });
    (codebaseDb.findCodebaseByDefaultCwd as ReturnType<typeof mock>).mockResolvedValueOnce({
      id: 'cb-1',
      name: 'test-repo',
      default_cwd: '/test/path',
    });

    // "ASSIST" case-insensitive matches "assist" at tier 2, should not reach suffix tier
    await workflowRunCommand('/test/path', 'ASSIST', 'hello');

    // Verify case-insensitive match was used, not suffix match
    expect(mockLogger.info).toHaveBeenCalledWith(
      expect.objectContaining({ requested: 'ASSIST', matched: 'assist' }),
      'workflow.resolve_case_insensitive_match'
    );
    expect(mockLogger.info).not.toHaveBeenCalledWith(
      expect.anything(),
      'workflow.resolve_suffix_match'
    );
  });

  it('should throw ambiguous error for multiple suffix matches', async () => {
    const { discoverWorkflowsWithConfig } = await import('@archon/workflows/workflow-discovery');
    (discoverWorkflowsWithConfig as ReturnType<typeof mock>).mockResolvedValueOnce({
      workflows: [
        makeTestWorkflowWithSource({ name: 'archon-review', description: 'Review' }),
        makeTestWorkflowWithSource({ name: 'custom-review', description: 'Custom review' }),
      ],
      errors: [],
    });

    await expect(workflowRunCommand('/test/path', 'review', 'hello')).rejects.toThrow(
      "Ambiguous workflow 'review'. Did you mean:"
    );
  });

  it('should throw ambiguous error for multiple substring matches', async () => {
    const { discoverWorkflowsWithConfig } = await import('@archon/workflows/workflow-discovery');
    (discoverWorkflowsWithConfig as ReturnType<typeof mock>).mockResolvedValueOnce({
      workflows: [
        makeTestWorkflowWithSource({
          name: 'archon-comprehensive-pr-review',
          description: 'Full review',
        }),
        makeTestWorkflowWithSource({ name: 'archon-smart-pr-review', description: 'Smart review' }),
      ],
      errors: [],
    });

    await expect(workflowRunCommand('/test/path', 'pr-review', 'hello')).rejects.toThrow(
      "Ambiguous workflow 'pr-review'. Did you mean:"
    );
  });

  it('should prefer exact match over suffix match', async () => {
    const { discoverWorkflowsWithConfig } = await import('@archon/workflows/workflow-discovery');
    const conversationDb = await import('@archon/core/db/conversations');
    const codebaseDb = await import('@archon/core/db/codebases');

    (discoverWorkflowsWithConfig as ReturnType<typeof mock>).mockResolvedValueOnce({
      workflows: [
        makeTestWorkflowWithSource({ name: 'assist', description: 'Short name' }),
        makeTestWorkflowWithSource({ name: 'archon-assist', description: 'Long name' }),
      ],
      errors: [],
    });
    (conversationDb.getOrCreateConversation as ReturnType<typeof mock>).mockResolvedValueOnce({
      id: 'conv-1',
      platform: 'cli',
      platform_conversation_id: 'cli-123',
      title: null,
      is_active: true,
      codebase_id: null,
    });
    (codebaseDb.findCodebaseByDefaultCwd as ReturnType<typeof mock>).mockResolvedValueOnce({
      id: 'cb-1',
      name: 'test-repo',
      default_cwd: '/test/path',
    });

    // "assist" exact-matches "assist", should NOT go to suffix matching
    await workflowRunCommand('/test/path', 'assist', 'hello');

    // Should not have logged suffix/substring match — exact match takes priority
    expect(mockLogger.info).not.toHaveBeenCalledWith(
      expect.objectContaining({ requested: 'assist' }),
      'workflow_run_suffix_match'
    );
  });

  it('should throw error when database access fails', async () => {
    const { discoverWorkflowsWithConfig } = await import('@archon/workflows/workflow-discovery');
    const conversationDb = await import('@archon/core/db/conversations');

    (discoverWorkflowsWithConfig as ReturnType<typeof mock>).mockResolvedValueOnce({
      workflows: [makeTestWorkflowWithSource({ name: 'assist', description: 'Help' })],
      errors: [],
    });
    (conversationDb.getOrCreateConversation as ReturnType<typeof mock>).mockRejectedValueOnce(
      new Error('Connection refused')
    );

    await expect(workflowRunCommand('/test/path', 'assist', 'hello')).rejects.toThrow(
      'Failed to access database: Connection refused'
    );
  });

  it('should throw when codebase lookup fails (isolation is default)', async () => {
    const { discoverWorkflowsWithConfig } = await import('@archon/workflows/workflow-discovery');
    const conversationDb = await import('@archon/core/db/conversations');
    const codebaseDb = await import('@archon/core/db/codebases');

    (discoverWorkflowsWithConfig as ReturnType<typeof mock>).mockResolvedValueOnce({
      workflows: [makeTestWorkflowWithSource({ name: 'assist', description: 'Help' })],
      errors: [],
    });
    (conversationDb.getOrCreateConversation as ReturnType<typeof mock>).mockResolvedValueOnce({
      id: 'conv-123',
    });
    (codebaseDb.findCodebaseByDefaultCwd as ReturnType<typeof mock>).mockRejectedValueOnce(
      new Error('ECONNREFUSED')
    );

    await expect(workflowRunCommand('/test/path', 'assist', 'hello')).rejects.toThrow(
      'Cannot create worktree: database lookup failed'
    );
  });

  it('should continue when codebase lookup fails with --no-worktree', async () => {
    const { discoverWorkflowsWithConfig } = await import('@archon/workflows/workflow-discovery');
    const { executeWorkflow } = await import('@archon/workflows/executor');
    const conversationDb = await import('@archon/core/db/conversations');
    const codebaseDb = await import('@archon/core/db/codebases');

    (discoverWorkflowsWithConfig as ReturnType<typeof mock>).mockResolvedValueOnce({
      workflows: [makeTestWorkflowWithSource({ name: 'assist', description: 'Help' })],
      errors: [],
    });
    (conversationDb.getOrCreateConversation as ReturnType<typeof mock>).mockResolvedValueOnce({
      id: 'conv-123',
    });
    (codebaseDb.findCodebaseByDefaultCwd as ReturnType<typeof mock>).mockRejectedValueOnce(
      new Error('ECONNREFUSED')
    );
    (conversationDb.updateConversation as ReturnType<typeof mock>).mockResolvedValueOnce(undefined);
    (executeWorkflow as ReturnType<typeof mock>).mockResolvedValueOnce({
      success: true,
      workflowRunId: 'run-123',
    });

    // With --no-worktree, DB failure is non-fatal — user explicitly opted out of isolation
    await workflowRunCommand('/test/path', 'assist', 'hello', { noWorktree: true });

    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ cwd: '/test/path' }),
      'cli.codebase_lookup_failed'
    );
  });

  it('should throw error when workflow execution fails', async () => {
    const { discoverWorkflowsWithConfig } = await import('@archon/workflows/workflow-discovery');
    const { executeWorkflow } = await import('@archon/workflows/executor');
    const conversationDb = await import('@archon/core/db/conversations');
    const codebaseDb = await import('@archon/core/db/codebases');

    (discoverWorkflowsWithConfig as ReturnType<typeof mock>).mockResolvedValueOnce({
      workflows: [makeTestWorkflowWithSource({ name: 'assist', description: 'Help' })],
      errors: [],
    });
    (conversationDb.getOrCreateConversation as ReturnType<typeof mock>).mockResolvedValueOnce({
      id: 'conv-123',
    });
    (codebaseDb.findCodebaseByDefaultCwd as ReturnType<typeof mock>).mockResolvedValueOnce(null);
    (conversationDb.updateConversation as ReturnType<typeof mock>).mockResolvedValueOnce(undefined);
    (executeWorkflow as ReturnType<typeof mock>).mockResolvedValueOnce({
      success: false,
      error: 'Step failed: assist',
    });

    // Use --no-worktree since no codebase is available (isolation would error)
    await expect(
      workflowRunCommand('/test/path', 'assist', 'hello', { noWorktree: true })
    ).rejects.toThrow('Workflow failed: Step failed: assist');
  });

  it('should call generateAndSetTitle with workflow name and user message', async () => {
    const { discoverWorkflowsWithConfig } = await import('@archon/workflows/workflow-discovery');
    const { executeWorkflow } = await import('@archon/workflows/executor');
    const conversationDb = await import('@archon/core/db/conversations');
    const codebaseDb = await import('@archon/core/db/codebases');
    const core = await import('@archon/core');

    (discoverWorkflowsWithConfig as ReturnType<typeof mock>).mockResolvedValueOnce({
      workflows: [makeTestWorkflowWithSource({ name: 'assist', description: 'Help' })],
      errors: [],
    });
    (conversationDb.getOrCreateConversation as ReturnType<typeof mock>).mockResolvedValueOnce({
      id: 'conv-123',
      ai_assistant_type: 'claude',
    });
    // Return a codebase so isolation can proceed (default behavior requires isolation)
    (codebaseDb.findCodebaseByDefaultCwd as ReturnType<typeof mock>).mockResolvedValueOnce({
      id: 'cb-123',
      default_cwd: '/test/path',
    });
    (conversationDb.updateConversation as ReturnType<typeof mock>).mockResolvedValueOnce(undefined);
    (executeWorkflow as ReturnType<typeof mock>).mockResolvedValueOnce({
      success: true,
      workflowRunId: 'run-123',
    });
    (core.generateAndSetTitle as ReturnType<typeof mock>).mockClear();

    await workflowRunCommand('/test/path', 'assist', 'hello world');

    expect(core.generateAndSetTitle).toHaveBeenCalledWith(
      'conv-123',
      'hello world',
      'claude',
      '/test/path',
      'assist',
      {}
    );
  });

  it('uses the workflow provider for title generation', async () => {
    const { discoverWorkflowsWithConfig } = await import('@archon/workflows/workflow-discovery');
    const { executeWorkflow } = await import('@archon/workflows/executor');
    const conversationDb = await import('@archon/core/db/conversations');
    const codebaseDb = await import('@archon/core/db/codebases');
    const core = await import('@archon/core');

    (discoverWorkflowsWithConfig as ReturnType<typeof mock>).mockResolvedValueOnce({
      workflows: [
        makeTestWorkflowWithSource({
          name: 'figma-mcp-smoke',
          description: 'Smoke test Figma MCP',
          provider: 'codex',
        }),
      ],
      errors: [],
    });
    (conversationDb.getOrCreateConversation as ReturnType<typeof mock>).mockResolvedValueOnce({
      id: 'conv-123',
      ai_assistant_type: 'claude',
    });
    (core.loadConfig as ReturnType<typeof mock>).mockResolvedValueOnce({
      assistant: 'claude',
      assistants: { codex: { model: 'gpt-5.4' } },
      defaults: {},
    });
    (codebaseDb.findCodebaseByDefaultCwd as ReturnType<typeof mock>).mockResolvedValueOnce(null);
    (conversationDb.updateConversation as ReturnType<typeof mock>).mockResolvedValueOnce(undefined);
    (executeWorkflow as ReturnType<typeof mock>).mockResolvedValueOnce({
      success: true,
      workflowRunId: 'run-123',
    });
    (core.generateAndSetTitle as ReturnType<typeof mock>).mockClear();

    await workflowRunCommand('/test/path', 'figma-mcp-smoke', 'check figma', { noWorktree: true });

    expect(core.generateAndSetTitle).toHaveBeenCalledWith(
      'conv-123',
      'check figma',
      'codex',
      '/test/path',
      'figma-mcp-smoke',
      { model: 'gpt-5.4' }
    );
  });

  it('passes fromBranch into isolation task request', async () => {
    const { discoverWorkflowsWithConfig } = await import('@archon/workflows/workflow-discovery');
    const { executeWorkflow } = await import('@archon/workflows/executor');
    const conversationDb = await import('@archon/core/db/conversations');
    const codebaseDb = await import('@archon/core/db/codebases');
    const isolation = await import('@archon/isolation');

    (discoverWorkflowsWithConfig as ReturnType<typeof mock>).mockResolvedValueOnce({
      workflows: [makeTestWorkflowWithSource({ name: 'assist', description: 'Help' })],
      errors: [],
    });
    (conversationDb.getOrCreateConversation as ReturnType<typeof mock>).mockResolvedValueOnce({
      id: 'conv-123',
    });
    (codebaseDb.findCodebaseByDefaultCwd as ReturnType<typeof mock>).mockResolvedValueOnce({
      id: 'cb-123',
      default_cwd: '/test/path',
    });
    (conversationDb.updateConversation as ReturnType<typeof mock>).mockResolvedValueOnce(undefined);
    (executeWorkflow as ReturnType<typeof mock>).mockResolvedValueOnce({
      success: true,
      workflowRunId: 'run-123',
    });

    await workflowRunCommand('/test/path', 'assist', 'hello', {
      branchName: 'test-adapters',
      fromBranch: 'feature/extract-adapters',
    });

    const getIsolationProviderMock = isolation.getIsolationProvider as ReturnType<typeof mock>;
    const provider = getIsolationProviderMock.mock.results.at(-1)?.value as
      | { create: ReturnType<typeof mock> }
      | undefined;

    expect(provider?.create).toHaveBeenCalledWith(
      expect.objectContaining({
        workflowType: 'task',
        identifier: 'test-adapters',
        fromBranch: 'feature/extract-adapters',
      })
    );
  });

  it('throws when --branch is used with --no-worktree', async () => {
    const { discoverWorkflowsWithConfig } = await import('@archon/workflows/workflow-discovery');

    (discoverWorkflowsWithConfig as ReturnType<typeof mock>).mockResolvedValueOnce({
      workflows: [makeTestWorkflowWithSource({ name: 'assist', description: 'Help' })],
      errors: [],
    });

    // Validation throws before codebase lookup — no need to mock findCodebaseByDefaultCwd
    await expect(
      workflowRunCommand('/test/path', 'assist', 'hello', {
        branchName: 'test-branch',
        noWorktree: true,
      })
    ).rejects.toThrow('--branch and --no-worktree are mutually exclusive');
  });

  it('throws when --from is used with --no-worktree', async () => {
    const { discoverWorkflowsWithConfig } = await import('@archon/workflows/workflow-discovery');

    (discoverWorkflowsWithConfig as ReturnType<typeof mock>).mockResolvedValueOnce({
      workflows: [makeTestWorkflowWithSource({ name: 'assist', description: 'Help' })],
      errors: [],
    });

    // Validation throws before codebase lookup — no need to mock findCodebaseByDefaultCwd
    await expect(
      workflowRunCommand('/test/path', 'assist', 'hello', {
        fromBranch: 'dev',
        noWorktree: true,
      })
    ).rejects.toThrow('--from/--from-branch has no effect with --no-worktree');
  });

  it('creates worktree with auto-generated branch when no --branch given', async () => {
    const { discoverWorkflowsWithConfig } = await import('@archon/workflows/workflow-discovery');
    const { executeWorkflow } = await import('@archon/workflows/executor');
    const conversationDb = await import('@archon/core/db/conversations');
    const codebaseDb = await import('@archon/core/db/codebases');
    const isolation = await import('@archon/isolation');
    const isolationDb = await import('@archon/core/db/isolation-environments');

    // Snapshot call counts before this test (process-global mocks)
    const findActiveCallsBefore = (isolationDb.findActiveByWorkflow as ReturnType<typeof mock>).mock
      .calls.length;

    (discoverWorkflowsWithConfig as ReturnType<typeof mock>).mockResolvedValueOnce({
      workflows: [makeTestWorkflowWithSource({ name: 'assist', description: 'Help' })],
      errors: [],
    });
    (conversationDb.getOrCreateConversation as ReturnType<typeof mock>).mockResolvedValueOnce({
      id: 'conv-123',
    });
    (codebaseDb.findCodebaseByDefaultCwd as ReturnType<typeof mock>).mockResolvedValueOnce({
      id: 'cb-123',
      default_cwd: '/test/path',
    });
    (conversationDb.updateConversation as ReturnType<typeof mock>).mockResolvedValueOnce(undefined);
    (executeWorkflow as ReturnType<typeof mock>).mockResolvedValueOnce({
      success: true,
      workflowRunId: 'run-123',
    });

    // No branchName, no noWorktree — should auto-isolate
    await workflowRunCommand('/test/path', 'assist', 'hello', {});

    const getIsolationProviderMock = isolation.getIsolationProvider as ReturnType<typeof mock>;
    const provider = getIsolationProviderMock.mock.results.at(-1)?.value as
      | { create: ReturnType<typeof mock> }
      | undefined;

    // provider.create should have been called with an auto-generated identifier
    expect(provider?.create).toHaveBeenCalled();
    const lastCreateCall = provider?.create.mock.calls.at(-1)?.[0] as {
      identifier: string;
      workflowType: string;
    };
    expect(lastCreateCall.workflowType).toBe('task');
    expect(lastCreateCall.identifier).toMatch(/^assist-\d+$/);

    // findActiveByWorkflow should NOT have been called during this test (no explicit --branch)
    const findActiveCallsAfter = (isolationDb.findActiveByWorkflow as ReturnType<typeof mock>).mock
      .calls.length;
    expect(findActiveCallsAfter).toBe(findActiveCallsBefore);
  });

  it('skips isolation when --no-worktree flag is set', async () => {
    const { discoverWorkflowsWithConfig } = await import('@archon/workflows/workflow-discovery');
    const { executeWorkflow } = await import('@archon/workflows/executor');
    const conversationDb = await import('@archon/core/db/conversations');
    const codebaseDb = await import('@archon/core/db/codebases');
    const isolation = await import('@archon/isolation');

    // Snapshot provider.create call count before this test
    const getIsolationProviderMock = isolation.getIsolationProvider as ReturnType<typeof mock>;
    const providerBefore = getIsolationProviderMock.mock.results.at(-1)?.value as
      | { create: ReturnType<typeof mock> }
      | undefined;
    const createCallsBefore = providerBefore?.create.mock.calls.length ?? 0;

    (discoverWorkflowsWithConfig as ReturnType<typeof mock>).mockResolvedValueOnce({
      workflows: [makeTestWorkflowWithSource({ name: 'assist', description: 'Help' })],
      errors: [],
    });
    (conversationDb.getOrCreateConversation as ReturnType<typeof mock>).mockResolvedValueOnce({
      id: 'conv-123',
    });
    (codebaseDb.findCodebaseByDefaultCwd as ReturnType<typeof mock>).mockResolvedValueOnce({
      id: 'cb-123',
      default_cwd: '/test/path',
    });
    (conversationDb.updateConversation as ReturnType<typeof mock>).mockResolvedValueOnce(undefined);
    (executeWorkflow as ReturnType<typeof mock>).mockResolvedValueOnce({
      success: true,
      workflowRunId: 'run-123',
    });

    await workflowRunCommand('/test/path', 'assist', 'hello', { noWorktree: true });

    // provider.create should NOT have been called during this test
    const providerAfter = getIsolationProviderMock.mock.results.at(-1)?.value as
      | { create: ReturnType<typeof mock> }
      | undefined;
    const createCallsAfter = providerAfter?.create.mock.calls.length ?? 0;
    expect(createCallsAfter).toBe(createCallsBefore);
  });

  // -------------------------------------------------------------------------
  // Stale workspace source-symlink → truthful CLI error
  // -------------------------------------------------------------------------

  it('surfaces auto-registration failures instead of claiming the repo is invalid', async () => {
    const { discoverWorkflowsWithConfig } = await import('@archon/workflows/workflow-discovery');
    const { registerRepository } = await import('@archon/core');
    const conversationDb = await import('@archon/core/db/conversations');
    const codebaseDb = await import('@archon/core/db/codebases');
    const gitModule = await import('@archon/git');

    (discoverWorkflowsWithConfig as ReturnType<typeof mock>).mockResolvedValueOnce({
      workflows: [makeTestWorkflowWithSource({ name: 'assist', description: 'Help' })],
      errors: [],
    });
    (conversationDb.getOrCreateConversation as ReturnType<typeof mock>).mockResolvedValueOnce({
      id: 'conv-123',
    });
    (codebaseDb.findCodebaseByDefaultCwd as ReturnType<typeof mock>).mockResolvedValueOnce(null);
    (gitModule.findRepoRoot as ReturnType<typeof mock>).mockResolvedValueOnce('/test/path');
    (registerRepository as ReturnType<typeof mock>).mockRejectedValueOnce(
      new Error(
        'Source symlink at /home/test/.archon/workspaces/acme/widget/source already points to ' +
          '/home/test/.archon/workspaces/widget, expected /test/path'
      )
    );

    const error = await workflowRunCommand('/test/path', 'assist', 'hello', {}).catch(
      err => err as Error
    );

    expect(error).toBeInstanceOf(Error);
    expect(error.message).toContain('Cannot create worktree: repository registration failed.');
    expect(error.message).toContain(
      'Remove the stale workspace entry at /home/test/.archon/workspaces/acme/widget and retry'
    );
    expect(error.message).not.toContain('not in a git repository');
  });

  it('surfaces auto-registration failures on --resume instead of claiming the repo is invalid', async () => {
    const { discoverWorkflowsWithConfig } = await import('@archon/workflows/workflow-discovery');
    const { registerRepository } = await import('@archon/core');
    const conversationDb = await import('@archon/core/db/conversations');
    const codebaseDb = await import('@archon/core/db/codebases');
    const gitModule = await import('@archon/git');

    (discoverWorkflowsWithConfig as ReturnType<typeof mock>).mockResolvedValueOnce({
      workflows: [makeTestWorkflowWithSource({ name: 'assist', description: 'Help' })],
      errors: [],
    });
    (conversationDb.getOrCreateConversation as ReturnType<typeof mock>).mockResolvedValueOnce({
      id: 'conv-123',
    });
    (codebaseDb.findCodebaseByDefaultCwd as ReturnType<typeof mock>).mockResolvedValueOnce(null);
    (gitModule.findRepoRoot as ReturnType<typeof mock>).mockResolvedValueOnce('/test/path');
    (registerRepository as ReturnType<typeof mock>).mockRejectedValueOnce(
      new Error(
        'Source symlink at /home/test/.archon/workspaces/acme/widget/source already points to ' +
          '/home/test/.archon/workspaces/widget, expected /test/path'
      )
    );

    const error = await workflowRunCommand('/test/path', 'assist', 'hello', {
      resume: true,
    }).catch(err => err as Error);

    expect(error).toBeInstanceOf(Error);
    expect(error.message).toContain('Cannot resume: repository registration failed.');
    expect(error.message).toContain(
      'Remove the stale workspace entry at /home/test/.archon/workspaces/acme/widget and retry'
    );
    expect(error.message).not.toContain('Not in a git repository');
  });

  it('falls back to generic workspace hint when registration error has an unrecognized shape', async () => {
    const { discoverWorkflowsWithConfig } = await import('@archon/workflows/workflow-discovery');
    const { registerRepository } = await import('@archon/core');
    const conversationDb = await import('@archon/core/db/conversations');
    const codebaseDb = await import('@archon/core/db/codebases');
    const gitModule = await import('@archon/git');

    (discoverWorkflowsWithConfig as ReturnType<typeof mock>).mockResolvedValueOnce({
      workflows: [makeTestWorkflowWithSource({ name: 'assist', description: 'Help' })],
      errors: [],
    });
    (conversationDb.getOrCreateConversation as ReturnType<typeof mock>).mockResolvedValueOnce({
      id: 'conv-123',
    });
    (codebaseDb.findCodebaseByDefaultCwd as ReturnType<typeof mock>).mockResolvedValueOnce(null);
    (gitModule.findRepoRoot as ReturnType<typeof mock>).mockResolvedValueOnce('/test/path');
    (registerRepository as ReturnType<typeof mock>).mockRejectedValueOnce(
      new Error("EACCES: permission denied, mkdir '/home/test/.archon/workspaces/acme'")
    );

    const error = await workflowRunCommand('/test/path', 'assist', 'hello', {}).catch(
      err => err as Error
    );

    expect(error).toBeInstanceOf(Error);
    expect(error.message).toContain('Cannot create worktree: repository registration failed.');
    expect(error.message).toContain('EACCES: permission denied');
    // Path-separator-agnostic check: on Windows path.join normalizes to `\`,
    // on POSIX to `/`. Assert the hint prefix + the final segment separately.
    expect(error.message).toContain('Check your Archon workspace registration under');
    expect(error.message).toMatch(/workspaces\b/);
    expect(error.message).not.toContain('Remove the stale workspace entry');
  });

  // -------------------------------------------------------------------------
  // Workflow-level `worktree.enabled` policy
  // -------------------------------------------------------------------------

  it('skips isolation when workflow YAML pins worktree.enabled: false', async () => {
    const { discoverWorkflowsWithConfig } = await import('@archon/workflows/workflow-discovery');
    const { executeWorkflow } = await import('@archon/workflows/executor');
    const conversationDb = await import('@archon/core/db/conversations');
    const codebaseDb = await import('@archon/core/db/codebases');
    const isolation = await import('@archon/isolation');

    const getIsolationProviderMock = isolation.getIsolationProvider as ReturnType<typeof mock>;
    const providerBefore = getIsolationProviderMock.mock.results.at(-1)?.value as
      | { create: ReturnType<typeof mock> }
      | undefined;
    const createCallsBefore = providerBefore?.create.mock.calls.length ?? 0;

    (discoverWorkflowsWithConfig as ReturnType<typeof mock>).mockResolvedValueOnce({
      workflows: [
        makeTestWorkflowWithSource({
          name: 'triage',
          description: 'Read-only triage',
          worktree: { enabled: false },
        }),
      ],
      errors: [],
    });
    (conversationDb.getOrCreateConversation as ReturnType<typeof mock>).mockResolvedValueOnce({
      id: 'conv-123',
    });
    (codebaseDb.findCodebaseByDefaultCwd as ReturnType<typeof mock>).mockResolvedValueOnce({
      id: 'cb-123',
      default_cwd: '/test/path',
    });
    (conversationDb.updateConversation as ReturnType<typeof mock>).mockResolvedValueOnce(undefined);
    (executeWorkflow as ReturnType<typeof mock>).mockResolvedValueOnce({
      success: true,
      workflowRunId: 'run-123',
    });

    // No flags — policy alone should disable isolation
    await workflowRunCommand('/test/path', 'triage', 'go', {});

    const providerAfter = getIsolationProviderMock.mock.results.at(-1)?.value as
      | { create: ReturnType<typeof mock> }
      | undefined;
    const createCallsAfter = providerAfter?.create.mock.calls.length ?? 0;
    expect(createCallsAfter).toBe(createCallsBefore);
  });

  it('throws when workflow pins worktree.enabled: false but caller passes --branch', async () => {
    const { discoverWorkflowsWithConfig } = await import('@archon/workflows/workflow-discovery');

    (discoverWorkflowsWithConfig as ReturnType<typeof mock>).mockResolvedValueOnce({
      workflows: [
        makeTestWorkflowWithSource({
          name: 'triage',
          description: 'Read-only triage',
          worktree: { enabled: false },
        }),
      ],
      errors: [],
    });

    await expect(
      workflowRunCommand('/test/path', 'triage', 'go', { branchName: 'feat-x' })
    ).rejects.toThrow(/worktree\.enabled: false/);
  });

  it('throws when workflow pins worktree.enabled: false but caller passes --from', async () => {
    const { discoverWorkflowsWithConfig } = await import('@archon/workflows/workflow-discovery');

    (discoverWorkflowsWithConfig as ReturnType<typeof mock>).mockResolvedValueOnce({
      workflows: [
        makeTestWorkflowWithSource({
          name: 'triage',
          description: 'Read-only triage',
          worktree: { enabled: false },
        }),
      ],
      errors: [],
    });

    await expect(
      workflowRunCommand('/test/path', 'triage', 'go', { fromBranch: 'dev' })
    ).rejects.toThrow(/worktree\.enabled: false/);
  });

  it('accepts worktree.enabled: false + --no-worktree as redundant (no error)', async () => {
    const { discoverWorkflowsWithConfig } = await import('@archon/workflows/workflow-discovery');
    const { executeWorkflow } = await import('@archon/workflows/executor');
    const conversationDb = await import('@archon/core/db/conversations');
    const codebaseDb = await import('@archon/core/db/codebases');

    (discoverWorkflowsWithConfig as ReturnType<typeof mock>).mockResolvedValueOnce({
      workflows: [
        makeTestWorkflowWithSource({
          name: 'triage',
          description: 'Read-only triage',
          worktree: { enabled: false },
        }),
      ],
      errors: [],
    });
    (conversationDb.getOrCreateConversation as ReturnType<typeof mock>).mockResolvedValueOnce({
      id: 'conv-123',
    });
    (codebaseDb.findCodebaseByDefaultCwd as ReturnType<typeof mock>).mockResolvedValueOnce({
      id: 'cb-123',
      default_cwd: '/test/path',
    });
    (conversationDb.updateConversation as ReturnType<typeof mock>).mockResolvedValueOnce(undefined);
    (executeWorkflow as ReturnType<typeof mock>).mockResolvedValueOnce({
      success: true,
      workflowRunId: 'run-123',
    });

    // Should not throw — redundant, not contradictory
    await workflowRunCommand('/test/path', 'triage', 'go', { noWorktree: true });
  });

  it('throws when workflow pins worktree.enabled: true but caller passes --no-worktree', async () => {
    const { discoverWorkflowsWithConfig } = await import('@archon/workflows/workflow-discovery');

    (discoverWorkflowsWithConfig as ReturnType<typeof mock>).mockResolvedValueOnce({
      workflows: [
        makeTestWorkflowWithSource({
          name: 'build',
          description: 'Requires a worktree',
          worktree: { enabled: true },
        }),
      ],
      errors: [],
    });

    await expect(
      workflowRunCommand('/test/path', 'build', 'go', { noWorktree: true })
    ).rejects.toThrow(/worktree\.enabled: true/);
  });

  it('throws when isolation cannot be created due to missing codebase', async () => {
    const { discoverWorkflowsWithConfig } = await import('@archon/workflows/workflow-discovery');
    const conversationDb = await import('@archon/core/db/conversations');
    const codebaseDb = await import('@archon/core/db/codebases');
    const gitModule = await import('@archon/git');

    (discoverWorkflowsWithConfig as ReturnType<typeof mock>).mockResolvedValueOnce({
      workflows: [makeTestWorkflowWithSource({ name: 'assist', description: 'Help' })],
      errors: [],
    });
    (conversationDb.getOrCreateConversation as ReturnType<typeof mock>).mockResolvedValueOnce({
      id: 'conv-123',
    });
    // No codebase found
    (codebaseDb.findCodebaseByDefaultCwd as ReturnType<typeof mock>).mockResolvedValueOnce(null);
    // Not in a git repo
    (gitModule.findRepoRoot as ReturnType<typeof mock>).mockResolvedValueOnce(null);

    await expect(workflowRunCommand('/test/path', 'assist', 'hello', {})).rejects.toThrow(
      'Cannot create worktree: not in a git repository'
    );
  });

  it('emits warning when reused worktree has mismatched base branch', async () => {
    const { discoverWorkflowsWithConfig } = await import('@archon/workflows/workflow-discovery');
    const { executeWorkflow } = await import('@archon/workflows/executor');
    const conversationDb = await import('@archon/core/db/conversations');
    const codebaseDb = await import('@archon/core/db/codebases');
    const isolationDb = await import('@archon/core/db/isolation-environments');
    const gitModule = await import('@archon/git');

    (discoverWorkflowsWithConfig as ReturnType<typeof mock>).mockResolvedValueOnce({
      workflows: [makeTestWorkflowWithSource({ name: 'assist', description: 'Help' })],
      errors: [],
    });
    (conversationDb.getOrCreateConversation as ReturnType<typeof mock>).mockResolvedValueOnce({
      id: 'conv-123',
    });
    (codebaseDb.findCodebaseByDefaultCwd as ReturnType<typeof mock>).mockResolvedValueOnce({
      id: 'cb-123',
      default_cwd: '/test/path',
    });
    (isolationDb.findActiveByWorkflow as ReturnType<typeof mock>).mockResolvedValueOnce({
      id: 'env-1',
      working_path: '/worktrees/feat',
      branch_name: 'feature-old',
      workflow_type: 'task',
      workflow_id: 'my-feature',
    });
    (gitModule.isAncestorOf as ReturnType<typeof mock>).mockResolvedValueOnce(false);
    (conversationDb.updateConversation as ReturnType<typeof mock>).mockResolvedValueOnce(undefined);
    (executeWorkflow as ReturnType<typeof mock>).mockResolvedValueOnce({
      success: true,
      workflowRunId: 'run-123',
    });

    const consoleWarnSpy = spyOn(console, 'warn').mockImplementation(() => {});
    try {
      await workflowRunCommand('/test/path', 'assist', 'hello', { branchName: 'my-feature' });
      expect(consoleWarnSpy).toHaveBeenCalledWith(expect.stringContaining("not based on 'dev'"));
    } finally {
      consoleWarnSpy.mockRestore();
    }
  });

  it('does not emit base branch warning when reused worktree is valid', async () => {
    const { discoverWorkflowsWithConfig } = await import('@archon/workflows/workflow-discovery');
    const { executeWorkflow } = await import('@archon/workflows/executor');
    const conversationDb = await import('@archon/core/db/conversations');
    const codebaseDb = await import('@archon/core/db/codebases');
    const isolationDb = await import('@archon/core/db/isolation-environments');

    (discoverWorkflowsWithConfig as ReturnType<typeof mock>).mockResolvedValueOnce({
      workflows: [makeTestWorkflowWithSource({ name: 'assist', description: 'Help' })],
      errors: [],
    });
    (conversationDb.getOrCreateConversation as ReturnType<typeof mock>).mockResolvedValueOnce({
      id: 'conv-123',
    });
    (codebaseDb.findCodebaseByDefaultCwd as ReturnType<typeof mock>).mockResolvedValueOnce({
      id: 'cb-123',
      default_cwd: '/test/path',
    });
    (isolationDb.findActiveByWorkflow as ReturnType<typeof mock>).mockResolvedValueOnce({
      id: 'env-1',
      working_path: '/worktrees/feat',
      branch_name: 'feature-valid',
      workflow_type: 'task',
      workflow_id: 'my-feature',
    });
    // isAncestorOf returns true by default — no warning expected
    (conversationDb.updateConversation as ReturnType<typeof mock>).mockResolvedValueOnce(undefined);
    (executeWorkflow as ReturnType<typeof mock>).mockResolvedValueOnce({
      success: true,
      workflowRunId: 'run-123',
    });

    const consoleWarnSpy = spyOn(console, 'warn').mockImplementation(() => {});
    try {
      await workflowRunCommand('/test/path', 'assist', 'hello', { branchName: 'my-feature' });
      const baseBranchWarnCalls = consoleWarnSpy.mock.calls.filter(
        (args: unknown[]) => typeof args[0] === 'string' && args[0].includes('not based on')
      );
      expect(baseBranchWarnCalls).toHaveLength(0);
    } finally {
      consoleWarnSpy.mockRestore();
    }
  });

  it('sends dispatch message before executeWorkflow with correct metadata', async () => {
    const { discoverWorkflowsWithConfig } = await import('@archon/workflows/workflow-discovery');
    const { executeWorkflow } = await import('@archon/workflows/executor');
    const conversationDb = await import('@archon/core/db/conversations');
    const codebaseDb = await import('@archon/core/db/codebases');
    const messagesDb = await import('@archon/core/db/messages');

    (discoverWorkflowsWithConfig as ReturnType<typeof mock>).mockResolvedValueOnce({
      workflows: [makeTestWorkflowWithSource({ name: 'assist', description: 'Help' })],
      errors: [],
    });
    (conversationDb.getOrCreateConversation as ReturnType<typeof mock>).mockResolvedValueOnce({
      id: 'conv-123',
    });
    (codebaseDb.findCodebaseByDefaultCwd as ReturnType<typeof mock>).mockResolvedValueOnce(null);
    (conversationDb.updateConversation as ReturnType<typeof mock>).mockResolvedValueOnce(undefined);

    // Track call order for assistant messages only (user message is added first via addMessage directly)
    const callOrder: string[] = [];
    (messagesDb.addMessage as ReturnType<typeof mock>).mockImplementation(
      async (_dbId: unknown, role: unknown, content: unknown) => {
        if (role === 'assistant') {
          callOrder.push(`addMessage:${String(content)}`);
        }
      }
    );
    (executeWorkflow as ReturnType<typeof mock>).mockImplementation(async () => {
      callOrder.push('executeWorkflow');
      return { success: true, workflowRunId: 'run-1' };
    });

    await workflowRunCommand('/test/path', 'assist', 'hello', { noWorktree: true });

    // Dispatch assistant message fires before executeWorkflow
    expect(callOrder[0]).toContain('Dispatching workflow');
    expect(callOrder[1]).toBe('executeWorkflow');

    // Correct metadata shape
    expect(messagesDb.addMessage).toHaveBeenCalledWith(
      expect.any(String),
      'assistant',
      'Dispatching workflow: **assist**',
      expect.objectContaining({
        category: 'workflow_dispatch_status',
        workflowDispatch: expect.objectContaining({
          workflowName: 'assist',
          workerConversationId: expect.stringMatching(/^cli-/),
        }),
      })
    );
  });

  it('sends result card when executeWorkflow returns a summary', async () => {
    const { discoverWorkflowsWithConfig } = await import('@archon/workflows/workflow-discovery');
    const { executeWorkflow } = await import('@archon/workflows/executor');
    const conversationDb = await import('@archon/core/db/conversations');
    const codebaseDb = await import('@archon/core/db/codebases');
    const messagesDb = await import('@archon/core/db/messages');

    (discoverWorkflowsWithConfig as ReturnType<typeof mock>).mockResolvedValueOnce({
      workflows: [makeTestWorkflowWithSource({ name: 'assist', description: 'Help' })],
      errors: [],
    });
    (conversationDb.getOrCreateConversation as ReturnType<typeof mock>).mockResolvedValueOnce({
      id: 'conv-123',
    });
    (codebaseDb.findCodebaseByDefaultCwd as ReturnType<typeof mock>).mockResolvedValueOnce(null);
    (conversationDb.updateConversation as ReturnType<typeof mock>).mockResolvedValueOnce(undefined);
    (executeWorkflow as ReturnType<typeof mock>).mockResolvedValueOnce({
      success: true,
      workflowRunId: 'run-42',
      summary: 'All steps completed. Branch pushed.',
    });
    (messagesDb.addMessage as ReturnType<typeof mock>).mockClear();

    await workflowRunCommand('/test/path', 'assist', 'hello', { noWorktree: true });

    expect(messagesDb.addMessage).toHaveBeenCalledWith(
      expect.any(String),
      'assistant',
      'All steps completed. Branch pushed.',
      expect.objectContaining({
        category: 'workflow_result',
        workflowResult: { workflowName: 'assist', runId: 'run-42' },
      })
    );
  });

  it('does not send result card when executeWorkflow has no summary', async () => {
    const { discoverWorkflowsWithConfig } = await import('@archon/workflows/workflow-discovery');
    const { executeWorkflow } = await import('@archon/workflows/executor');
    const conversationDb = await import('@archon/core/db/conversations');
    const codebaseDb = await import('@archon/core/db/codebases');
    const messagesDb = await import('@archon/core/db/messages');

    (discoverWorkflowsWithConfig as ReturnType<typeof mock>).mockResolvedValueOnce({
      workflows: [makeTestWorkflowWithSource({ name: 'assist', description: 'Help' })],
      errors: [],
    });
    (conversationDb.getOrCreateConversation as ReturnType<typeof mock>).mockResolvedValueOnce({
      id: 'conv-123',
    });
    (codebaseDb.findCodebaseByDefaultCwd as ReturnType<typeof mock>).mockResolvedValueOnce(null);
    (conversationDb.updateConversation as ReturnType<typeof mock>).mockResolvedValueOnce(undefined);
    (executeWorkflow as ReturnType<typeof mock>).mockResolvedValueOnce({
      success: true,
      workflowRunId: 'run-1',
      // no summary field
    });
    (messagesDb.addMessage as ReturnType<typeof mock>).mockClear();

    await workflowRunCommand('/test/path', 'assist', 'hello', { noWorktree: true });

    // Only dispatch addMessage call, no result card
    const resultCalls = (messagesDb.addMessage as ReturnType<typeof mock>).mock.calls.filter(
      (args: unknown[]) => {
        const meta = args[3] as Record<string, unknown> | undefined;
        return meta?.category === 'workflow_result';
      }
    );
    expect(resultCalls).toHaveLength(0);
  });

  it('does not throw and logs warn when result message DB persist fails', async () => {
    const { discoverWorkflowsWithConfig } = await import('@archon/workflows/workflow-discovery');
    const { executeWorkflow } = await import('@archon/workflows/executor');
    const conversationDb = await import('@archon/core/db/conversations');
    const codebaseDb = await import('@archon/core/db/codebases');
    const messagesDb = await import('@archon/core/db/messages');

    (discoverWorkflowsWithConfig as ReturnType<typeof mock>).mockResolvedValueOnce({
      workflows: [makeTestWorkflowWithSource({ name: 'assist', description: 'Help' })],
      errors: [],
    });
    (conversationDb.getOrCreateConversation as ReturnType<typeof mock>).mockResolvedValueOnce({
      id: 'conv-123',
    });
    (codebaseDb.findCodebaseByDefaultCwd as ReturnType<typeof mock>).mockResolvedValueOnce(null);
    (conversationDb.updateConversation as ReturnType<typeof mock>).mockResolvedValueOnce(undefined);
    (executeWorkflow as ReturnType<typeof mock>).mockResolvedValueOnce({
      success: true,
      workflowRunId: 'run-1',
      summary: 'Done.',
    });
    // addMessage is called three times: user message persist, dispatch, result
    // CLIAdapter internally catches DB errors — it logs 'cli_message_persist_failed' and does not throw.
    // Verify workflowRunCommand does not throw even when the result DB write fails.
    (messagesDb.addMessage as ReturnType<typeof mock>)
      .mockResolvedValueOnce(undefined) // user message persist succeeds
      .mockResolvedValueOnce(undefined) // dispatch succeeds
      .mockRejectedValueOnce(new Error('DB gone')); // result fails (caught inside CLIAdapter)

    // Should not throw — the CLIAdapter swallows the DB error and logs a warn
    await expect(
      workflowRunCommand('/test/path', 'assist', 'hello', { noWorktree: true })
    ).resolves.toBeUndefined();

    // CLIAdapter logs 'cli_message_persist_failed' when addMessage throws internally
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ err: expect.any(Error) }),
      'cli_message_persist_failed'
    );
  });

  it('does not throw and continues to executeWorkflow when dispatch sendMessage fails', async () => {
    const { discoverWorkflowsWithConfig } = await import('@archon/workflows/workflow-discovery');
    const { executeWorkflow } = await import('@archon/workflows/executor');
    const conversationDb = await import('@archon/core/db/conversations');
    const codebaseDb = await import('@archon/core/db/codebases');
    const messagesDb = await import('@archon/core/db/messages');

    (discoverWorkflowsWithConfig as ReturnType<typeof mock>).mockResolvedValueOnce({
      workflows: [makeTestWorkflowWithSource({ name: 'assist', description: 'Help' })],
      errors: [],
    });
    (conversationDb.getOrCreateConversation as ReturnType<typeof mock>).mockResolvedValueOnce({
      id: 'conv-123',
    });
    (codebaseDb.findCodebaseByDefaultCwd as ReturnType<typeof mock>).mockResolvedValueOnce(null);
    (conversationDb.updateConversation as ReturnType<typeof mock>).mockResolvedValueOnce(undefined);
    (executeWorkflow as ReturnType<typeof mock>).mockClear();
    (executeWorkflow as ReturnType<typeof mock>).mockResolvedValueOnce({
      success: true,
      workflowRunId: 'run-1',
    });
    // First addMessage (user message persist) succeeds, second (dispatch) fails
    (messagesDb.addMessage as ReturnType<typeof mock>)
      .mockResolvedValueOnce(undefined) // user message persist succeeds
      .mockRejectedValueOnce(new Error('DB gone')); // dispatch fails (caught inside CLIAdapter)

    // Should not throw — dispatch failure must not block workflow execution
    await expect(
      workflowRunCommand('/test/path', 'assist', 'hello', { noWorktree: true })
    ).resolves.toBeUndefined();

    // executeWorkflow was still called despite dispatch failure
    expect(executeWorkflow).toHaveBeenCalledTimes(1);
  });

  it('does not send result card when workflow is paused even with summary', async () => {
    const { discoverWorkflowsWithConfig } = await import('@archon/workflows/workflow-discovery');
    const { executeWorkflow } = await import('@archon/workflows/executor');
    const conversationDb = await import('@archon/core/db/conversations');
    const codebaseDb = await import('@archon/core/db/codebases');
    const messagesDb = await import('@archon/core/db/messages');

    (discoverWorkflowsWithConfig as ReturnType<typeof mock>).mockResolvedValueOnce({
      workflows: [makeTestWorkflowWithSource({ name: 'assist', description: 'Help' })],
      errors: [],
    });
    (conversationDb.getOrCreateConversation as ReturnType<typeof mock>).mockResolvedValueOnce({
      id: 'conv-123',
    });
    (codebaseDb.findCodebaseByDefaultCwd as ReturnType<typeof mock>).mockResolvedValueOnce(null);
    (conversationDb.updateConversation as ReturnType<typeof mock>).mockResolvedValueOnce(undefined);
    (executeWorkflow as ReturnType<typeof mock>).mockResolvedValueOnce({
      success: true,
      workflowRunId: 'run-paused',
      paused: true,
      summary: 'Steps completed so far.',
    });
    (messagesDb.addMessage as ReturnType<typeof mock>).mockClear();

    const consoleSpy = spyOn(console, 'log').mockImplementation(() => {});
    try {
      await workflowRunCommand('/test/path', 'assist', 'hello', { noWorktree: true });

      // Paused guard fires before summary check — no result card despite having a summary
      const resultCalls = (messagesDb.addMessage as ReturnType<typeof mock>).mock.calls.filter(
        (args: unknown[]) => {
          const meta = args[3] as Record<string, unknown> | undefined;
          return meta?.category === 'workflow_result';
        }
      );
      expect(resultCalls).toHaveLength(0);

      // Confirm paused message was printed
      expect(consoleSpy).toHaveBeenCalledWith('\nWorkflow paused — waiting for approval.');
    } finally {
      consoleSpy.mockRestore();
    }
  });
});

// ---------------------------------------------------------------------------
// RED-PHASE SCAFFOLD (EXECUTABLE) — Story 3.3b "Provide Archon Start And
// Status CLI JSON", Task 1 (`workflow.start` envelope conversion of
// foreground `workflow run --json`).
//
// `workflowRunCommand` already exists and is fully callable today — the
// boundary is present — so every test below is a genuine executable red
// test (not `it.skip()`): it calls the real exported function with the
// same mock scaffolding the rest of this file already uses, and asserts the
// NEW `workflow.start` envelope shape from
// `_bmad-output/planning-artifacts/contracts/workflow-commander/examples/providers/archon/commands/start-success.json`.
// Today `workflowRunCommand` prints human text ("Running workflow: ...",
// "Working directory: ...", "\nWorkflow completed successfully.") and never
// builds an envelope, so these fail for real, not vacuously.
//
// `correlationId` is not yet a field on `WorkflowRunOptions` (Task 1 adds
// it) — tests that need it use a local structural-superset type instead of
// `@ts-expect-error`, so no suppression comment needs to be removed later.
// ---------------------------------------------------------------------------
type WorkflowRunOptionsWithCorrelation = Parameters<typeof workflowRunCommand>[3] & {
  correlationId?: string;
};

describe('workflowRunCommand — JSON envelope (Story 3.3b)', () => {
  let consoleSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    consoleSpy = spyOn(console, 'log').mockImplementation(() => {});
    mockLogger.warn.mockClear();
    mockLogger.error.mockClear();
  });

  afterEach(async () => {
    consoleSpy.mockRestore();
    // `workflowDb.getWorkflowRun` is not called anywhere in `workflowRunCommand`
    // today (Task 1 adds that call) — every `.mockResolvedValueOnce()` /
    // `.mockRejectedValueOnce()` queued in this block's tests is therefore left
    // unconsumed by current production code and would otherwise leak into
    // later describe blocks (`workflowGetCommand`, `workflowResumeCommand`,
    // etc.) that share this same top-of-file mock. Reset it back to the
    // file's baseline default after every test in this block so this
    // red-phase scaffold cannot pollute unrelated, already-passing tests.
    const workflowDb = await import('@archon/core/db/workflows');
    const getWorkflowRunMock = workflowDb.getWorkflowRun as ReturnType<typeof mock>;
    getWorkflowRunMock.mockReset();
    getWorkflowRunMock.mockImplementation(() => Promise.resolve(null));
  });

  /** Common wiring shared by most scenarios below: one workflow, no codebase, no worktree. */
  async function primeCommonMocks(): Promise<void> {
    const { discoverWorkflowsWithConfig } = await import('@archon/workflows/workflow-discovery');
    const conversationDb = await import('@archon/core/db/conversations');
    const codebaseDb = await import('@archon/core/db/codebases');
    (discoverWorkflowsWithConfig as ReturnType<typeof mock>).mockResolvedValueOnce({
      workflows: [makeTestWorkflowWithSource({ name: 'assist', description: 'Help' })],
      errors: [],
    });
    (conversationDb.getOrCreateConversation as ReturnType<typeof mock>).mockResolvedValueOnce({
      id: 'conv-123',
    });
    (codebaseDb.findCodebaseByDefaultCwd as ReturnType<typeof mock>).mockResolvedValueOnce(null);
    (conversationDb.updateConversation as ReturnType<typeof mock>).mockResolvedValueOnce(undefined);
  }

  function lastStdoutJson(): Record<string, unknown> {
    const lastCall = consoleSpy.mock.calls.at(-1) as unknown[] | undefined;
    return JSON.parse(String(lastCall?.[0])) as Record<string, unknown>;
  }

  // 3.3B-UNIT-001 [P0] R-001,R-007 — one `workflow.start` success document for
  // a completed run, matching start-success.json's envelope shape.
  it('3.3B-UNIT-001: emits one workflow.start success envelope for a completed run', async () => {
    await primeCommonMocks();
    const { executeWorkflow } = await import('@archon/workflows/executor');
    const workflowDb = await import('@archon/core/db/workflows');
    (executeWorkflow as ReturnType<typeof mock>).mockResolvedValueOnce({
      success: true,
      workflowRunId: 'run-1-completed',
    });
    (workflowDb.getWorkflowRun as ReturnType<typeof mock>).mockResolvedValueOnce({
      id: 'run-1-completed',
      workflow_name: 'assist',
      status: 'completed',
      codebase_id: null,
      working_path: '/test/path',
      started_at: new Date(),
      metadata: {},
    });

    await workflowRunCommand('/test/path', 'assist', 'hello', { json: true, noWorktree: true });

    // Genuinely red today: current code prints multiple human lines, not one envelope.
    expect(consoleSpy).toHaveBeenCalledTimes(1);
    const envelope = lastStdoutJson();
    expect(envelope.schemaVersion).toBe('workflow-command-envelope.v1');
    expect(envelope.command).toBe('workflow.start');
    expect(envelope.success).toBe(true);
    expect(envelope.workflowRunRef).toMatchObject({
      provider: 'archon',
      runId: 'run-1-completed',
      workflowName: 'assist',
    });
    expect(envelope.result).toMatchObject({
      operation: 'start',
      state: 'completed',
      terminal: true,
      accepted: true,
    });
  });

  // 3.3B-UNIT-008 [P1] R-007,RC-20 — workflowRunRef.projectRef is
  // "project:<codebase_id>" only when a codebase actually resolved; omitted
  // (not null/empty) otherwise.
  describe('3.3B-UNIT-008: workflowRunRef.projectRef derivation', () => {
    it('omits projectRef when no codebase resolved', async () => {
      await primeCommonMocks();
      const { executeWorkflow } = await import('@archon/workflows/executor');
      const workflowDb = await import('@archon/core/db/workflows');
      (executeWorkflow as ReturnType<typeof mock>).mockResolvedValueOnce({
        success: true,
        workflowRunId: 'run-noproj',
      });
      (workflowDb.getWorkflowRun as ReturnType<typeof mock>).mockResolvedValueOnce({
        id: 'run-noproj',
        workflow_name: 'assist',
        status: 'completed',
        codebase_id: null,
        working_path: '/test/path',
        started_at: new Date(),
        metadata: {},
      });

      await workflowRunCommand('/test/path', 'assist', 'hello', { json: true, noWorktree: true });

      const envelope = lastStdoutJson();
      const ref = envelope.workflowRunRef as Record<string, unknown>;
      expect('projectRef' in ref).toBe(false);
    });

    it('sets projectRef to "project:<codebase_id>" when a codebase resolved', async () => {
      const { discoverWorkflowsWithConfig } = await import('@archon/workflows/workflow-discovery');
      const conversationDb = await import('@archon/core/db/conversations');
      const codebaseDb = await import('@archon/core/db/codebases');
      const { executeWorkflow } = await import('@archon/workflows/executor');
      const workflowDb = await import('@archon/core/db/workflows');

      (discoverWorkflowsWithConfig as ReturnType<typeof mock>).mockResolvedValueOnce({
        workflows: [makeTestWorkflowWithSource({ name: 'assist', description: 'Help' })],
        errors: [],
      });
      (conversationDb.getOrCreateConversation as ReturnType<typeof mock>).mockResolvedValueOnce({
        id: 'conv-123',
      });
      (codebaseDb.findCodebaseByDefaultCwd as ReturnType<typeof mock>).mockResolvedValueOnce({
        id: 'cb-proj',
        name: 'test-repo',
        default_cwd: '/test/path',
      });
      (conversationDb.updateConversation as ReturnType<typeof mock>).mockResolvedValueOnce(
        undefined
      );
      (executeWorkflow as ReturnType<typeof mock>).mockResolvedValueOnce({
        success: true,
        workflowRunId: 'run-proj',
      });
      (workflowDb.getWorkflowRun as ReturnType<typeof mock>).mockResolvedValueOnce({
        id: 'run-proj',
        workflow_name: 'assist',
        status: 'completed',
        codebase_id: 'cb-proj',
        working_path: '/test/path',
        started_at: new Date(),
        metadata: {},
      });

      await workflowRunCommand('/test/path', 'assist', 'hello', { json: true, noWorktree: true });

      const envelope = lastStdoutJson();
      const ref = envelope.workflowRunRef as Record<string, unknown>;
      expect(ref.projectRef).toBe('project:cb-proj');
    });
  });

  // 3.3B-UNIT-009 [P0] R-008 — a failed execution that DOES carry a
  // workflowRunId emits WORKFLOW_EXECUTION_FAILED/unexpected_state/retryable
  // true/exitCode 78, with only structured details — never the raw
  // `result.error` diagnostic string (NFR-14).
  it('3.3B-UNIT-009: failed execution with a run id emits a structured, non-leaking error envelope', async () => {
    await primeCommonMocks();
    const { executeWorkflow } = await import('@archon/workflows/executor');
    (executeWorkflow as ReturnType<typeof mock>).mockResolvedValueOnce({
      success: false,
      workflowRunId: 'run-failed-9',
      error: 'raw diagnostic: connection reset while calling provider',
    });

    await workflowRunCommand('/test/path', 'assist', 'hello', { json: true, noWorktree: true });

    const envelope = lastStdoutJson();
    expect(envelope.success).toBe(false);
    const error = envelope.error as Record<string, unknown>;
    expect(error.code).toBe('WORKFLOW_EXECUTION_FAILED');
    expect(error.category).toBe('unexpected_state');
    expect(error.retryable).toBe(true);
    const details = error.details as Record<string, unknown>;
    expect(details.runId).toBe('run-failed-9');
    expect(JSON.stringify(details)).not.toContain('connection reset');
    const execution = envelope.execution as Record<string, unknown>;
    expect(execution.exitCode).toBe(78);
  });

  // 3.3B-UNIT-010 [P0] R-008 — a failed execution WITHOUT a workflowRunId
  // (early executor failure) emits INTERNAL_ERROR/implementation_defect with
  // requestAccepted:false, exitCode 70.
  it('3.3B-UNIT-010: failed execution without a run id emits INTERNAL_ERROR/requestAccepted:false', async () => {
    await primeCommonMocks();
    const { executeWorkflow } = await import('@archon/workflows/executor');
    (executeWorkflow as ReturnType<typeof mock>).mockResolvedValueOnce({
      success: false,
      error: 'early failure before any run row existed',
    });

    await workflowRunCommand('/test/path', 'assist', 'hello', { json: true, noWorktree: true });

    const envelope = lastStdoutJson();
    expect(envelope.success).toBe(false);
    const error = envelope.error as Record<string, unknown>;
    expect(error.code).toBe('INTERNAL_ERROR');
    expect(error.category).toBe('implementation_defect');
    expect(error.details).toMatchObject({ requestAccepted: false });
    const execution = envelope.execution as Record<string, unknown>;
    expect(execution.exitCode).toBe(70);
  });

  // 3.3B-UNIT-011 [P1] R-007 — when execution succeeds but the mandatory
  // persisted-run reload fails, the command emits a structured internal
  // error carrying the runId, not a stale/inferred success envelope.
  it('3.3B-UNIT-011: persisted-run reload failure after success becomes a structured internal error', async () => {
    await primeCommonMocks();
    const { executeWorkflow } = await import('@archon/workflows/executor');
    const workflowDb = await import('@archon/core/db/workflows');
    (executeWorkflow as ReturnType<typeof mock>).mockResolvedValueOnce({
      success: true,
      workflowRunId: 'run-reload-fail',
    });
    (workflowDb.getWorkflowRun as ReturnType<typeof mock>).mockRejectedValueOnce(
      new Error('DB unavailable')
    );

    await workflowRunCommand('/test/path', 'assist', 'hello', { json: true, noWorktree: true });

    const envelope = lastStdoutJson();
    expect(envelope.success).toBe(false);
    const error = envelope.error as Record<string, unknown>;
    expect(error.code).toBe('INTERNAL_ERROR');
    expect(error.category).toBe('implementation_defect');
    const details = error.details as Record<string, unknown>;
    expect(details.runId).toBe('run-reload-fail');
    const execution = envelope.execution as Record<string, unknown>;
    expect(execution.exitCode).toBe(70);
  });

  // 3.3B-UNIT-012 [P0] R-004,R-009 — an early throw (unknown workflow name)
  // must be caught by the fail-closed boundary and converted to a
  // WORKFLOW_NOT_FOUND envelope, never escape as a rejected promise, when
  // --json is set.
  it('3.3B-UNIT-012: unknown workflow name under --json fails closed instead of rejecting', async () => {
    const { discoverWorkflowsWithConfig } = await import('@archon/workflows/workflow-discovery');
    (discoverWorkflowsWithConfig as ReturnType<typeof mock>).mockResolvedValueOnce({
      workflows: [makeTestWorkflowWithSource({ name: 'assist', description: 'Help' })],
      errors: [],
    });

    // Today this rejects — the assertion below documents the required new
    // behavior (never throw when options.json is true) and is genuinely red.
    await expect(
      workflowRunCommand('/test/path', 'does-not-exist', 'hello', {
        json: true,
        noWorktree: true,
      })
    ).resolves.toBeUndefined();

    const envelope = lastStdoutJson();
    expect(envelope.success).toBe(false);
    const error = envelope.error as Record<string, unknown>;
    expect(error.code).toBe('WORKFLOW_NOT_FOUND');
    expect(error.category).toBe('unexpected_state');
    const execution = envelope.execution as Record<string, unknown>;
    expect(execution.exitCode).toBe(78);
  });

  // 3.3B-UNIT-013 [P1] R-015, W-3.3B-003 — the foreground command remains
  // genuinely blocking: the envelope is only written to stdout AFTER
  // executeWorkflow resolves, and the reported state is never a live
  // "running" snapshot (the fixture's state:"running" depicts a
  // non-blocking model this story deliberately does not implement).
  it('3.3B-UNIT-013: envelope is written only after executeWorkflow resolves (no fake async "running")', async () => {
    await primeCommonMocks();
    const { executeWorkflow } = await import('@archon/workflows/executor');
    const workflowDb = await import('@archon/core/db/workflows');

    let resolveExec: (value: { success: true; workflowRunId: string }) => void = () => {};
    (executeWorkflow as ReturnType<typeof mock>).mockImplementationOnce(
      () =>
        new Promise(resolve => {
          resolveExec = resolve;
        })
    );
    (workflowDb.getWorkflowRun as ReturnType<typeof mock>).mockResolvedValueOnce({
      id: 'run-blocking',
      workflow_name: 'assist',
      status: 'completed',
      codebase_id: null,
      working_path: '/test/path',
      started_at: new Date(),
      metadata: {},
    });

    const runPromise = workflowRunCommand('/test/path', 'assist', 'hello', {
      json: true,
      noWorktree: true,
    });

    try {
      // Give pending microtasks a chance to run — no envelope should exist yet.
      await Promise.resolve();
      await Promise.resolve();
      expect(consoleSpy).not.toHaveBeenCalled();
    } finally {
      // Always unblock executeWorkflow so runPromise settles, even if the
      // assertion above fails — otherwise a dangling pending promise leaks
      // past this test.
      resolveExec({ success: true, workflowRunId: 'run-blocking' });
    }
    await runPromise;

    expect(consoleSpy).toHaveBeenCalledTimes(1);
    const envelope = lastStdoutJson();
    expect(envelope.result).toMatchObject({ state: 'completed' });
    expect((envelope.result as Record<string, unknown>).state).not.toBe('running');
  });

  // 3.3B-UNIT-015 [P0] R-002 — exactly one stdout line for the foreground
  // JSON path, and none of the current human/progress strings leak through.
  it('3.3B-UNIT-015: JSON mode start writes exactly one stdout line with no human text', async () => {
    await primeCommonMocks();
    const { executeWorkflow } = await import('@archon/workflows/executor');
    const workflowDb = await import('@archon/core/db/workflows');
    (executeWorkflow as ReturnType<typeof mock>).mockResolvedValueOnce({
      success: true,
      workflowRunId: 'run-purity',
    });
    (workflowDb.getWorkflowRun as ReturnType<typeof mock>).mockResolvedValueOnce({
      id: 'run-purity',
      workflow_name: 'assist',
      status: 'completed',
      codebase_id: null,
      working_path: '/test/path',
      started_at: new Date(),
      metadata: {},
    });

    await workflowRunCommand('/test/path', 'assist', 'hello', { json: true, noWorktree: true });

    expect(consoleSpy).toHaveBeenCalledTimes(1);
    const raw = String((consoleSpy.mock.calls[0] as unknown[])[0]);
    expect(raw).not.toContain('Running workflow:');
    expect(raw).not.toContain('Working directory:');
    expect(raw).not.toContain('Dispatching workflow');
    expect(raw).not.toContain('Workflow completed successfully');
    expect(() => JSON.parse(raw)).not.toThrow();
  });

  // 3.3B-UNIT-016 [P0] R-002,R-006 — a paused-for-approval start still
  // yields exactly one envelope, with actionRequired/gateRef populated
  // (not the human "\nWorkflow paused — waiting for approval." line).
  it('3.3B-UNIT-016: paused-for-approval start emits one envelope with gateRef', async () => {
    await primeCommonMocks();
    const { executeWorkflow } = await import('@archon/workflows/executor');
    const workflowDb = await import('@archon/core/db/workflows');
    (executeWorkflow as ReturnType<typeof mock>).mockResolvedValueOnce({
      success: true,
      workflowRunId: 'run-gate',
      paused: true,
    });
    (workflowDb.getWorkflowRun as ReturnType<typeof mock>).mockResolvedValueOnce({
      id: 'run-gate',
      workflow_name: 'assist',
      status: 'paused',
      codebase_id: null,
      working_path: '/test/path',
      started_at: new Date(),
      metadata: { approval: { nodeId: 'review', message: 'Please review the plan' } },
    });

    await workflowRunCommand('/test/path', 'assist', 'hello', { json: true, noWorktree: true });

    expect(consoleSpy).toHaveBeenCalledTimes(1);
    const envelope = lastStdoutJson();
    expect(envelope.success).toBe(true);
    const result = envelope.result as Record<string, unknown>;
    expect(result.state).toBe('waiting-for-approval');
    expect(result.terminal).toBe(false);
    expect(result.actionRequired).toBe(true);
    expect(result.gateRef).toMatchObject({ gateId: 'review', kind: 'human-decision' });
  });

  // 3.3B-UNIT-018 [P1] R-010 — a supplied --correlation-id is echoed
  // verbatim in both success and error envelopes.
  describe('3.3B-UNIT-018: correlation id threading', () => {
    it('echoes a supplied correlationId on a success envelope', async () => {
      await primeCommonMocks();
      const { executeWorkflow } = await import('@archon/workflows/executor');
      const workflowDb = await import('@archon/core/db/workflows');
      (executeWorkflow as ReturnType<typeof mock>).mockResolvedValueOnce({
        success: true,
        workflowRunId: 'run-corr-ok',
      });
      (workflowDb.getWorkflowRun as ReturnType<typeof mock>).mockResolvedValueOnce({
        id: 'run-corr-ok',
        workflow_name: 'assist',
        status: 'completed',
        codebase_id: null,
        working_path: '/test/path',
        started_at: new Date(),
        metadata: {},
      });

      const opts: WorkflowRunOptionsWithCorrelation = {
        json: true,
        noWorktree: true,
        correlationId: 'corr-story-3-3b-success',
      };
      await workflowRunCommand('/test/path', 'assist', 'hello', opts);

      const envelope = lastStdoutJson();
      expect(envelope.correlationId).toBe('corr-story-3-3b-success');
    });

    it('echoes a supplied correlationId on an error envelope', async () => {
      const { discoverWorkflowsWithConfig } = await import('@archon/workflows/workflow-discovery');
      (discoverWorkflowsWithConfig as ReturnType<typeof mock>).mockResolvedValueOnce({
        workflows: [makeTestWorkflowWithSource({ name: 'assist', description: 'Help' })],
        errors: [],
      });

      const opts: WorkflowRunOptionsWithCorrelation = {
        json: true,
        noWorktree: true,
        correlationId: 'corr-story-3-3b-error',
      };
      await workflowRunCommand('/test/path', 'unknown-workflow', 'hello', opts);

      const envelope = lastStdoutJson();
      expect(envelope.correlationId).toBe('corr-story-3-3b-error');
    });
  });

  // 3.3B-UNIT-027 [P1] R-012 — a message-persistence failure during JSON
  // mode is logged, not surfaced, and does not corrupt the one-line stdout
  // contract.
  it('3.3B-UNIT-027: adapter persistence failure during JSON mode does not corrupt stdout', async () => {
    await primeCommonMocks();
    const { executeWorkflow } = await import('@archon/workflows/executor');
    const workflowDb = await import('@archon/core/db/workflows');
    const messagesDb = await import('@archon/core/db/messages');
    (messagesDb.addMessage as ReturnType<typeof mock>).mockRejectedValueOnce(
      new Error('persist failed')
    );
    (executeWorkflow as ReturnType<typeof mock>).mockResolvedValueOnce({
      success: true,
      workflowRunId: 'run-persist-fail',
    });
    (workflowDb.getWorkflowRun as ReturnType<typeof mock>).mockResolvedValueOnce({
      id: 'run-persist-fail',
      workflow_name: 'assist',
      status: 'completed',
      codebase_id: null,
      working_path: '/test/path',
      started_at: new Date(),
      metadata: {},
    });

    await workflowRunCommand('/test/path', 'assist', 'hello', { json: true, noWorktree: true });

    expect(consoleSpy).toHaveBeenCalledTimes(1);
    expect(() => lastStdoutJson()).not.toThrow();
  });

  // 3.3B-UNIT-028 [P1] R-019 — two sequential JSON starts never mix
  // correlation ids or workflowRunRefs across calls.
  it('3.3B-UNIT-028: two sequential JSON starts keep distinct correlation ids and run refs', async () => {
    const { discoverWorkflowsWithConfig } = await import('@archon/workflows/workflow-discovery');
    const conversationDb = await import('@archon/core/db/conversations');
    const codebaseDb = await import('@archon/core/db/codebases');
    const { executeWorkflow } = await import('@archon/workflows/executor');
    const workflowDb = await import('@archon/core/db/workflows');

    (discoverWorkflowsWithConfig as ReturnType<typeof mock>).mockResolvedValue({
      workflows: [makeTestWorkflowWithSource({ name: 'assist', description: 'Help' })],
      errors: [],
    });
    (conversationDb.getOrCreateConversation as ReturnType<typeof mock>).mockResolvedValue({
      id: 'conv-123',
    });
    (codebaseDb.findCodebaseByDefaultCwd as ReturnType<typeof mock>).mockResolvedValue(null);
    (conversationDb.updateConversation as ReturnType<typeof mock>).mockResolvedValue(undefined);

    (executeWorkflow as ReturnType<typeof mock>).mockResolvedValueOnce({
      success: true,
      workflowRunId: 'run-A',
    });
    (workflowDb.getWorkflowRun as ReturnType<typeof mock>).mockResolvedValueOnce({
      id: 'run-A',
      workflow_name: 'assist',
      status: 'completed',
      codebase_id: null,
      working_path: '/test/path',
      started_at: new Date(),
      metadata: {},
    });
    const optsA: WorkflowRunOptionsWithCorrelation = {
      json: true,
      noWorktree: true,
      correlationId: 'corr-A',
    };
    await workflowRunCommand('/test/path', 'assist', 'hello', optsA);
    const envelopeA = lastStdoutJson();

    (executeWorkflow as ReturnType<typeof mock>).mockResolvedValueOnce({
      success: true,
      workflowRunId: 'run-B',
    });
    (workflowDb.getWorkflowRun as ReturnType<typeof mock>).mockResolvedValueOnce({
      id: 'run-B',
      workflow_name: 'assist',
      status: 'completed',
      codebase_id: null,
      working_path: '/test/path',
      started_at: new Date(),
      metadata: {},
    });
    const optsB: WorkflowRunOptionsWithCorrelation = {
      json: true,
      noWorktree: true,
      correlationId: 'corr-B',
    };
    await workflowRunCommand('/test/path', 'assist', 'hello', optsB);
    const envelopeB = lastStdoutJson();

    expect(envelopeA.correlationId).toBe('corr-A');
    expect(envelopeB.correlationId).toBe('corr-B');
    expect((envelopeA.workflowRunRef as Record<string, unknown>).runId).toBe('run-A');
    expect((envelopeB.workflowRunRef as Record<string, unknown>).runId).toBe('run-B');
  });
});

describe('workflowStatusCommand', () => {
  let consoleSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    consoleSpy = spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  it('should print message when no active runs', async () => {
    const workflowDb = await import('@archon/core/db/workflows');
    (workflowDb.listWorkflowRuns as ReturnType<typeof mock>).mockResolvedValueOnce([]);

    await workflowStatusCommand();

    expect(consoleSpy).toHaveBeenCalledWith('No active workflows.');
  });

  it('should list active runs with ID, name, path, status, and age', async () => {
    const workflowDb = await import('@archon/core/db/workflows');
    (workflowDb.listWorkflowRuns as ReturnType<typeof mock>).mockResolvedValueOnce([
      {
        id: 'run-abc',
        workflow_name: 'implement',
        working_path: '/path/to/worktree',
        status: 'running',
        started_at: new Date(Date.now() - 5 * 60 * 1000), // 5 minutes ago
      },
    ]);

    await workflowStatusCommand();

    const calls = consoleSpy.mock.calls.map((c: unknown[]) => String(c[0]));
    expect(calls.some(c => c.includes('run-abc'))).toBe(true);
    expect(calls.some(c => c.includes('implement'))).toBe(true);
    expect(calls.some(c => c.includes('/path/to/worktree'))).toBe(true);
    expect(calls.some(c => c.includes('running'))).toBe(true);
  });

  it('should output JSON when json=true', async () => {
    const workflowDb = await import('@archon/core/db/workflows');
    (workflowDb.listWorkflowRuns as ReturnType<typeof mock>).mockResolvedValueOnce([]);

    await workflowStatusCommand(true);

    expect(consoleSpy).toHaveBeenCalledWith(JSON.stringify({ runs: [] }, null, 2));
  });

  it('should show node summaries in verbose mode', async () => {
    const workflowDb = await import('@archon/core/db/workflows');
    const workflowEventsDb = await import('@archon/core/db/workflow-events');

    (workflowDb.listWorkflowRuns as ReturnType<typeof mock>).mockResolvedValueOnce([
      {
        id: 'run-verbose',
        workflow_name: 'implement',
        working_path: '/path/to/worktree',
        status: 'running',
        started_at: new Date(Date.now() - 30 * 1000),
      },
    ]);

    const startTime = new Date(Date.now() - 25 * 1000).toISOString();
    const endTime = new Date(Date.now() - 15 * 1000).toISOString();
    (workflowEventsDb.listWorkflowEvents as ReturnType<typeof mock>).mockResolvedValueOnce([
      {
        id: 'e1',
        workflow_run_id: 'run-verbose',
        event_type: 'node_started',
        step_name: 'plan',
        step_index: null,
        data: {},
        created_at: startTime,
      },
      {
        id: 'e2',
        workflow_run_id: 'run-verbose',
        event_type: 'node_completed',
        step_name: 'plan',
        step_index: null,
        data: { node_output: 'Plan output here' },
        created_at: endTime,
      },
    ]);

    await workflowStatusCommand(false, true);

    const calls = consoleSpy.mock.calls.map((c: unknown[]) => String(c[0]));
    expect(calls.some(c => c.includes('Nodes:'))).toBe(true);
    expect(calls.some(c => c.includes('✓') && c.includes('plan'))).toBe(true);
    expect(calls.some(c => c.includes('Plan output here'))).toBe(true);
  });

  it('should show error message for failed node in verbose mode', async () => {
    const workflowDb = await import('@archon/core/db/workflows');
    const workflowEventsDb = await import('@archon/core/db/workflow-events');

    (workflowDb.listWorkflowRuns as ReturnType<typeof mock>).mockResolvedValueOnce([
      {
        id: 'run-failed',
        workflow_name: 'implement',
        working_path: '/path/to/worktree',
        status: 'running',
        started_at: new Date(Date.now() - 30 * 1000),
      },
    ]);

    const startTime = new Date(Date.now() - 20 * 1000).toISOString();
    const endTime = new Date(Date.now() - 10 * 1000).toISOString();
    (workflowEventsDb.listWorkflowEvents as ReturnType<typeof mock>).mockResolvedValueOnce([
      {
        id: 'e3',
        workflow_run_id: 'run-failed',
        event_type: 'node_started',
        step_name: 'implement',
        step_index: null,
        data: {},
        created_at: startTime,
      },
      {
        id: 'e4',
        workflow_run_id: 'run-failed',
        event_type: 'node_failed',
        step_name: 'implement',
        step_index: null,
        data: { error: 'Compilation failed' },
        created_at: endTime,
      },
    ]);

    await workflowStatusCommand(false, true);

    const calls = consoleSpy.mock.calls.map((c: unknown[]) => String(c[0]));
    expect(calls.some(c => c.includes('✗') && c.includes('implement'))).toBe(true);
    expect(calls.some(c => c.includes('Compilation failed'))).toBe(true);
  });

  it('should not show nodes section when no events in verbose mode', async () => {
    const workflowDb = await import('@archon/core/db/workflows');
    const workflowEventsDb = await import('@archon/core/db/workflow-events');

    (workflowDb.listWorkflowRuns as ReturnType<typeof mock>).mockResolvedValueOnce([
      {
        id: 'run-empty',
        workflow_name: 'implement',
        working_path: '/path/to/worktree',
        status: 'running',
        started_at: new Date(Date.now() - 5 * 1000),
      },
    ]);
    (workflowEventsDb.listWorkflowEvents as ReturnType<typeof mock>).mockResolvedValueOnce([]);

    await workflowStatusCommand(false, true);

    const calls = consoleSpy.mock.calls.map((c: unknown[]) => String(c[0]));
    expect(calls.some(c => c.includes('Nodes:'))).toBe(false);
  });

  it('should include events in JSON verbose output', async () => {
    const workflowDb = await import('@archon/core/db/workflows');
    const workflowEventsDb = await import('@archon/core/db/workflow-events');

    (workflowDb.listWorkflowRuns as ReturnType<typeof mock>).mockResolvedValueOnce([
      {
        id: 'run-json',
        workflow_name: 'implement',
        working_path: '/path/to/worktree',
        status: 'running',
        started_at: new Date(),
      },
    ]);
    const fakeEvent = {
      id: 'ev1',
      workflow_run_id: 'run-json',
      event_type: 'node_started',
      step_name: 'plan',
      step_index: null,
      data: {},
      created_at: new Date().toISOString(),
    };
    (workflowEventsDb.listWorkflowEvents as ReturnType<typeof mock>).mockResolvedValueOnce([
      fakeEvent,
    ]);

    await workflowStatusCommand(true, true);

    const jsonOutput = consoleSpy.mock.calls[0]?.[0] as string;
    const parsed = JSON.parse(jsonOutput) as { runs: Array<{ events: unknown[] }> };
    expect(parsed.runs[0].events).toHaveLength(1);
  });
});

const EMPTY_COUNTS = {
  all: 0,
  running: 0,
  completed: 0,
  failed: 0,
  cancelled: 0,
  pending: 0,
  paused: 0,
};

describe('workflowGetCommand', () => {
  let consoleSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    consoleSpy = spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  // Human (non-JSON) not-found path is explicitly UNCHANGED by Story 3.3b
  // (Task 2: "Keep the exit code 1 for the human (non-JSON) not-found path
  // unchanged") — left as-is, still green.
  it('prints not-found (human) and exits non-zero for a missing run', async () => {
    const workflowDb = await import('@archon/core/db/workflows');
    (workflowDb.getWorkflowRun as ReturnType<typeof mock>).mockResolvedValueOnce(null);

    const code = await workflowGetCommand('nope');

    expect(consoleSpy).toHaveBeenCalledWith('Workflow run not found: nope');
    // Exit 1 so `get <id> && ...` and CI checks react to a missing run.
    expect(code).toBe(1);
  });

  // Human (non-JSON) detail path is also unchanged — left as-is, still green.
  it('prints run detail (human) including the error from metadata', async () => {
    const workflowDb = await import('@archon/core/db/workflows');
    (workflowDb.getWorkflowRun as ReturnType<typeof mock>).mockResolvedValueOnce({
      id: 'run-xyz',
      workflow_name: 'implement',
      status: 'failed',
      working_path: '/tmp/wt',
      started_at: new Date(),
      metadata: { error: 'Step failed: build' },
    });

    await workflowGetCommand('run-xyz');

    expect(consoleSpy).toHaveBeenCalledWith('  ID:     run-xyz');
    expect(consoleSpy).toHaveBeenCalledWith('  Name:   implement');
    expect(consoleSpy).toHaveBeenCalledWith('  Status: failed');
    expect(consoleSpy).toHaveBeenCalledWith('  Error:  Step failed: build');
  });

  // ---------------------------------------------------------------------
  // RED-PHASE SCAFFOLD (EXECUTABLE) — Story 3.3b Task 2: `workflow get --json`
  // must stop emitting the legacy `{ok:false}` / raw-row shape and instead
  // emit `workflow.status` envelopes (RC-11). `workflowGetCommand` already
  // exists and is fully callable, so these are genuine executable red tests
  // against the CURRENTLY WRONG (legacy) output — not `it.skip()`.
  // ---------------------------------------------------------------------

  // 3.3B-UNIT-019 [P0] R-005 — not-found now emits a `workflow.status` error
  // envelope (code WORKFLOW_RUN_NOT_FOUND, category unexpected_state,
  // non-retryable) and the exit code becomes 78 (was 1) under --json.
  it('3.3B-UNIT-019: emits a workflow.status WORKFLOW_RUN_NOT_FOUND envelope and exits 78 for a missing run', async () => {
    const workflowDb = await import('@archon/core/db/workflows');
    (workflowDb.getWorkflowRun as ReturnType<typeof mock>).mockResolvedValueOnce(null);

    const code = await workflowGetCommand('nope', true);

    expect(consoleSpy).toHaveBeenCalledTimes(1);
    const envelope = JSON.parse(consoleSpy.mock.calls[0][0] as string) as Record<string, unknown>;
    expect(envelope.schemaVersion).toBe('workflow-command-envelope.v1');
    expect(envelope.command).toBe('workflow.status');
    expect(envelope.success).toBe(false);
    const error = envelope.error as Record<string, unknown>;
    expect(error.code).toBe('WORKFLOW_RUN_NOT_FOUND');
    expect(error.category).toBe('unexpected_state');
    expect(error.retryable).toBe(false);
    expect(error.details).toMatchObject({ runId: 'nope' });
    expect(code).toBe(78);
  });

  // 3.3B-UNIT-020 [P0] R-005,R-008 — a DB lookup failure never leaks the raw
  // driver error text (e.g. "connection refused") into envelope details; it
  // is logged only, and the envelope reports INTERNAL_ERROR, exit 70.
  it('3.3B-UNIT-020: DB lookup failure emits INTERNAL_ERROR without leaking the raw message, exits 70', async () => {
    const workflowDb = await import('@archon/core/db/workflows');
    (workflowDb.getWorkflowRun as ReturnType<typeof mock>).mockRejectedValueOnce(
      new Error('connection refused')
    );

    const code = await workflowGetCommand('run-x', true);

    const envelope = JSON.parse(consoleSpy.mock.calls[0][0] as string) as Record<string, unknown>;
    expect(envelope.success).toBe(false);
    const error = envelope.error as Record<string, unknown>;
    expect(error.code).toBe('INTERNAL_ERROR');
    expect(error.category).toBe('implementation_defect');
    expect(JSON.stringify(error.details)).not.toContain('connection refused');
    expect(code).toBe(70);
  });

  // 3.3B-UNIT-021 [P0] R-001,R-005 — a completed run now emits a
  // `workflow.status` success envelope (not the raw WorkflowRun row),
  // terminal:true, exit 0.
  it('3.3B-UNIT-021: emits a workflow.status success envelope for a completed run', async () => {
    const workflowDb = await import('@archon/core/db/workflows');
    (workflowDb.getWorkflowRun as ReturnType<typeof mock>).mockResolvedValueOnce({
      id: 'run-json',
      workflow_name: 'implement',
      status: 'completed',
      codebase_id: null,
      working_path: '/tmp/wt',
      started_at: new Date(),
      metadata: {},
    });

    const code = await workflowGetCommand('run-json', true);

    expect(consoleSpy).toHaveBeenCalledTimes(1);
    const envelope = JSON.parse(consoleSpy.mock.calls[0][0] as string) as Record<string, unknown>;
    expect(envelope.command).toBe('workflow.status');
    expect(envelope.success).toBe(true);
    expect(envelope.workflowRunRef).toMatchObject({
      provider: 'archon',
      runId: 'run-json',
      workflowName: 'implement',
    });
    expect(envelope.result).toMatchObject({
      operation: 'status',
      state: 'completed',
      terminal: true,
    });
    expect(code).toBe(0);
  });

  // 3.3B-UNIT-022 [P0] R-005,R-006 — a run paused on an approval gate maps to
  // state "waiting-for-approval" with actionRequired/gateRef, matching
  // status-success.json's illustrative shape (minus phase/W-3.3B-002).
  it('3.3B-UNIT-022: paused-for-approval run maps to waiting-for-approval with a gateRef', async () => {
    const workflowDb = await import('@archon/core/db/workflows');
    (workflowDb.getWorkflowRun as ReturnType<typeof mock>).mockResolvedValueOnce({
      id: 'run-gate',
      workflow_name: 'implement',
      status: 'paused',
      codebase_id: 'cb-1',
      working_path: '/tmp/wt',
      started_at: new Date(),
      metadata: { approval: { nodeId: 'review-gate', message: 'Please review' } },
    });

    const code = await workflowGetCommand('run-gate', true);

    const envelope = JSON.parse(consoleSpy.mock.calls[0][0] as string) as Record<string, unknown>;
    const result = envelope.result as Record<string, unknown>;
    expect(result.state).toBe('waiting-for-approval');
    expect(result.terminal).toBe(false);
    expect(result.actionRequired).toBe(true);
    expect(result.gateRef).toMatchObject({ gateId: 'review-gate', kind: 'human-decision' });
    expect((envelope.workflowRunRef as Record<string, unknown>).projectRef).toBe('project:cb-1');
    expect(code).toBe(0);
  });

  // 3.3B-UNIT-023 [P1] R-005,R-008 — a failed run's envelope reports
  // state:"failed" without leaking `metadata.error`'s raw prose into the
  // success-envelope result (the envelope stays success:true for `status`
  // reads of a failed run — this command reports state, it does not itself
  // fail because the underlying run failed).
  it('3.3B-UNIT-023: failed run status reports state:"failed" without leaking raw metadata prose', async () => {
    const workflowDb = await import('@archon/core/db/workflows');
    (workflowDb.getWorkflowRun as ReturnType<typeof mock>).mockResolvedValueOnce({
      id: 'run-failed',
      workflow_name: 'implement',
      status: 'failed',
      codebase_id: null,
      working_path: '/tmp/wt',
      started_at: new Date(),
      metadata: { error: 'raw diagnostic: step 4 threw ECONNRESET at provider boundary' },
    });

    const code = await workflowGetCommand('run-failed', true);

    const envelope = JSON.parse(consoleSpy.mock.calls[0][0] as string) as Record<string, unknown>;
    expect(envelope.success).toBe(true);
    const result = envelope.result as Record<string, unknown>;
    expect(result.state).toBe('failed');
    expect(result.terminal).toBe(true);
    expect(JSON.stringify(result)).not.toContain('ECONNRESET');
    expect(code).toBe(0);
  });

  // 3.3B-UNIT-024 [P1] R-010 — a supplied correlationId (new 4th param) is
  // echoed on success, not-found, and DB-error envelopes alike.
  describe('3.3B-UNIT-024: correlation id threading', () => {
    it('echoes correlationId on a not-found envelope', async () => {
      const workflowDb = await import('@archon/core/db/workflows');
      (workflowDb.getWorkflowRun as ReturnType<typeof mock>).mockResolvedValueOnce(null);

      // 4th positional param `correlationId` does not exist yet (Task 2 adds
      // it additively) — cast through unknown to call the future signature
      // without a `@ts-expect-error` that would need manual removal later.
      const call = workflowGetCommand as unknown as (
        runId: string,
        json?: boolean,
        verbose?: boolean,
        correlationId?: string
      ) => Promise<number>;
      await call('nope', true, false, 'corr-get-not-found');

      const envelope = JSON.parse(consoleSpy.mock.calls[0][0] as string) as Record<string, unknown>;
      expect(envelope.correlationId).toBe('corr-get-not-found');
    });

    it('echoes correlationId on a success envelope', async () => {
      const workflowDb = await import('@archon/core/db/workflows');
      (workflowDb.getWorkflowRun as ReturnType<typeof mock>).mockResolvedValueOnce({
        id: 'run-corr',
        workflow_name: 'implement',
        status: 'completed',
        codebase_id: null,
        working_path: '/tmp/wt',
        started_at: new Date(),
        metadata: {},
      });

      const call = workflowGetCommand as unknown as (
        runId: string,
        json?: boolean,
        verbose?: boolean,
        correlationId?: string
      ) => Promise<number>;
      await call('run-corr', true, false, 'corr-get-success');

      const envelope = JSON.parse(consoleSpy.mock.calls[0][0] as string) as Record<string, unknown>;
      expect(envelope.correlationId).toBe('corr-get-success');
    });
  });

  // 3.3B-UNIT-025 [P1] R-013 — verbose events relocate from top-level
  // `events` to `result.events`, and are omitted entirely (no empty array,
  // no key) when `--verbose` is not set.
  describe('3.3B-UNIT-025: verbose events live under result.events only', () => {
    it('places events under result.events when --verbose is set', async () => {
      const workflowDb = await import('@archon/core/db/workflows');
      const eventsDb = await import('@archon/core/db/workflow-events');
      (workflowDb.getWorkflowRun as ReturnType<typeof mock>).mockResolvedValueOnce({
        id: 'run-v',
        workflow_name: 'implement',
        status: 'running',
        codebase_id: null,
        working_path: '/tmp/wt',
        started_at: new Date(),
        metadata: {},
      });
      (eventsDb.listWorkflowEvents as ReturnType<typeof mock>).mockResolvedValueOnce([
        {
          event_type: 'node_started',
          step_name: 'plan',
          created_at: new Date().toISOString(),
          data: {},
        },
      ]);

      await workflowGetCommand('run-v', true, true);

      const envelope = JSON.parse(consoleSpy.mock.calls[0][0] as string) as Record<string, unknown>;
      expect('events' in envelope).toBe(false);
      const result = envelope.result as Record<string, unknown>;
      expect(Array.isArray(result.events)).toBe(true);
      expect(result.events).toHaveLength(1);
    });

    it('omits result.events entirely when --verbose is not set', async () => {
      const workflowDb = await import('@archon/core/db/workflows');
      (workflowDb.getWorkflowRun as ReturnType<typeof mock>).mockResolvedValueOnce({
        id: 'run-nonverbose',
        workflow_name: 'implement',
        status: 'running',
        codebase_id: null,
        working_path: '/tmp/wt',
        started_at: new Date(),
        metadata: {},
      });

      await workflowGetCommand('run-nonverbose', true, false);

      const envelope = JSON.parse(consoleSpy.mock.calls[0][0] as string) as Record<string, unknown>;
      const result = envelope.result as Record<string, unknown>;
      expect('events' in result).toBe(false);
    });
  });

  // 3.3B-UNIT-026 [P1] R-013 — verbose event projection is a pass-through:
  // the command does not reorder, dedupe, or reinterpret event ordering —
  // it forwards exactly what `listWorkflowEvents` returned, in that order.
  it('3.3B-UNIT-026: verbose result.events preserves listWorkflowEvents order verbatim (no reinterpretation)', async () => {
    const workflowDb = await import('@archon/core/db/workflows');
    const eventsDb = await import('@archon/core/db/workflow-events');
    (workflowDb.getWorkflowRun as ReturnType<typeof mock>).mockResolvedValueOnce({
      id: 'run-order',
      workflow_name: 'implement',
      status: 'running',
      codebase_id: null,
      working_path: '/tmp/wt',
      started_at: new Date(),
      metadata: {},
    });
    const orderedEvents = [
      {
        event_type: 'node_completed',
        step_name: 'b',
        created_at: '2026-01-01T00:00:02.000Z',
        data: {},
      },
      {
        event_type: 'node_started',
        step_name: 'a',
        created_at: '2026-01-01T00:00:01.000Z',
        data: {},
      },
    ];
    (eventsDb.listWorkflowEvents as ReturnType<typeof mock>).mockResolvedValueOnce(orderedEvents);

    await workflowGetCommand('run-order', true, true);

    const envelope = JSON.parse(consoleSpy.mock.calls[0][0] as string) as Record<string, unknown>;
    const result = envelope.result as Record<string, unknown>;
    expect(result.events).toEqual(orderedEvents);
  });
});

// ---------------------------------------------------------------------------
// RED-PHASE SCAFFOLD (SKIPPED) — Story 3.3b Task 3 (state-mapping helper)
// and the `classifyRunError` helper referenced by Task 1's Dev Notes.
//
// Unlike every other Story 3.3b block in this file, these ARE `it.skip()`
// per this skill's red-phase rule ("Use it.skip() only when the target
// module, route, harness, or dependency seam does not exist yet"): Task 3
// is explicit new design work with "no prior art" and no established export
// name — there is nothing to import yet, not even under a guessable name.
// A static `import { mapWorkflowRunToContractState } from './workflow'`
// would throw a module-linking SyntaxError and crash every other test in
// this file (verified empirically), and a dynamic `import()` probe against
// a not-yet-decided name would just be a coin flip on the implementer's
// eventual naming, not a meaningful contract check. Skipping documents the
// exact expected table (Dev Notes "State Mapping") so the implementer can
// delete `.skip` and wire up the real import once Task 3 lands, rather than
// leaving a guessed, possibly-wrong red assertion in place.
//
// To activate: implement + export the mapping/classification helper(s) from
// `./workflow`, replace the `it.skip(...)` calls below with `it(...)`,
// and import the real function(s) at the top of each block.
// ---------------------------------------------------------------------------
describe('workflow.ts run-state → contract-state mapping helper (Story 3.3b Task 3 — not yet implemented)', () => {
  // 3.3B-UNIT-002 [P0] R-006
  it.skip('3.3B-UNIT-002: status="pending" maps to { state: "pending", terminal: false }', () => {
    // Expected once implemented: mapFn({ status: 'pending', metadata: {} })
    //   → { state: 'pending', terminal: false }
  });

  // 3.3B-UNIT-003 [P0] R-006
  it.skip('3.3B-UNIT-003: status="running" maps to { state: "running", terminal: false } (never a fake terminal)', () => {
    // Expected: mapFn({ status: 'running', metadata: {} })
    //   → { state: 'running', terminal: false }
  });

  // 3.3B-UNIT-004 [P0] R-006
  it.skip('3.3B-UNIT-004: paused + approval context (type !== "interactive_loop") maps to waiting-for-approval with actionRequired/gateRef', () => {
    // Expected: mapFn({ status: 'paused', metadata: { approval: { nodeId: 'n1', message: 'm' } } })
    //   → { state: 'waiting-for-approval', terminal: false, actionRequired: true,
    //       gateRef: { gateId: 'n1', kind: 'human-decision' } }
  });

  // 3.3B-UNIT-005 [P0] R-006
  it.skip('3.3B-UNIT-005: paused + interactive-loop context maps to "paused" with NO human-decision gate', () => {
    // Expected: mapFn({ status: 'paused', metadata: { approval: { nodeId: 'n1', message: 'm', type: 'interactive_loop' } } })
    //   → { state: 'paused', terminal: false } (no actionRequired, no gateRef)
  });

  // 3.3B-UNIT-006 [P0] R-006
  it.skip('3.3B-UNIT-006: paused + absent/malformed approval metadata conservatively maps to "paused"', () => {
    // Expected: mapFn({ status: 'paused', metadata: {} })
    //   → { state: 'paused', terminal: false }
    // Expected: mapFn({ status: 'paused', metadata: { approval: { nodeId: 'n1' } } }) // missing `message` — isApprovalContext() rejects it
    //   → { state: 'paused', terminal: false }
  });

  // 3.3B-UNIT-007 [P0] R-006,R-014
  it.skip('3.3B-UNIT-007: completed/failed/cancelled all map terminal:true and never invent a "phase" field (W-3.3B-002)', () => {
    // Expected: mapFn({ status: 'completed', metadata: {} }) → { state: 'completed', terminal: true }
    // Expected: mapFn({ status: 'failed', metadata: {} })    → { state: 'failed', terminal: true }
    // Expected: mapFn({ status: 'cancelled', metadata: {} }) → { state: 'cancelled', terminal: true }
    // None of the three results may contain a `phase` key.
  });

  // 3.3B-UNIT-030 [P1] R-006,R-018
  it.skip('3.3B-UNIT-030: cancelled maps to terminal:true (OS-level kill guarantee is waived, W-3.3B-006)', () => {
    // Expected: mapFn({ status: 'cancelled', metadata: {} }) → { state: 'cancelled', terminal: true }
    // This only locks the STATE MAPPING for an already-recorded cancellation —
    // it does not assert anything about whether an externally-killed process
    // reliably reaches this code path at all (waived, see W-3.3B-006).
  });
});

describe('workflow.ts classifyRunError helper (Story 3.3b Task 1 — not yet implemented)', () => {
  // 3.3B-UNIT-017 [P1] R-009,R-018 — table-driven classification for the
  // four documented exit codes, mirroring provider-binding.ts's
  // classifyError shape ({ code, category, retryable, exitCode }).
  it.skip('3.3B-UNIT-017: classifies bad-flags/unknown-workflow/internal/timeout into the documented {code,category,retryable,exitCode} table', () => {
    // Expected table (Dev Notes "Existing Code State To Preserve" + Task 1):
    //   bad flags / mutually-exclusive flag combo → { code: 'MALFORMED_REQUEST', category: 'provider_contract', retryable: false, exitCode: 64 }
    //   unknown workflow name                     → { code: 'WORKFLOW_NOT_FOUND', category: 'unexpected_state', retryable: false, exitCode: 78 }
    //   DB / codebase / worktree failure          → { code: 'INTERNAL_ERROR', category: 'implementation_defect', retryable: false, exitCode: 70 }
    //   timeout-message-pattern error              → { code: 'COMMAND_TIMEOUT', category: 'timeout', retryable: true, exitCode: 69 }
  });

  // 3.3B-UNIT-029 [P1] R-009,R-018 — a timeout-shaped error (matching
  // provider-binding.ts:136-138's pattern: `err.code === 'ETIMEDOUT'` or a
  // message containing "timeout"/"statement timeout") classifies as
  // COMMAND_TIMEOUT, not a generic INTERNAL_ERROR.
  it.skip('3.3B-UNIT-029: a timeout-shaped error classifies as COMMAND_TIMEOUT (not INTERNAL_ERROR)', () => {
    // Expected: classifyRunError(Object.assign(new Error('statement timeout'), { code: 'ETIMEDOUT' }))
    //   → { code: 'COMMAND_TIMEOUT', category: 'timeout', retryable: true, exitCode: 69 }
  });
});

describe('workflowRunsCommand', () => {
  let consoleSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    consoleSpy = spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  it('scopes to the cwd-resolved codebase id', async () => {
    const workflowDb = await import('@archon/core/db/workflows');
    const codebaseDb = await import('@archon/core/db/codebases');
    (codebaseDb.findCodebaseByDefaultCwd as ReturnType<typeof mock>).mockResolvedValueOnce({
      id: 'cb-proj',
      name: 'owner/repo',
      default_cwd: '/test/path',
    });
    const listSpy = workflowDb.listDashboardRuns as ReturnType<typeof mock>;
    listSpy.mockClear();
    listSpy.mockResolvedValueOnce({ runs: [], total: 0, counts: EMPTY_COUNTS });

    await workflowRunsCommand('/test/path', {});

    expect(listSpy).toHaveBeenCalledWith(
      expect.objectContaining({ codebaseId: 'cb-proj', limit: 20 })
    );
  });

  it('prints the unregistered-cwd note and lists globally when no codebase resolves', async () => {
    const workflowDb = await import('@archon/core/db/workflows');
    const codebaseDb = await import('@archon/core/db/codebases');
    (codebaseDb.findCodebaseByDefaultCwd as ReturnType<typeof mock>).mockResolvedValueOnce(null);
    (workflowDb.listDashboardRuns as ReturnType<typeof mock>).mockResolvedValueOnce({
      runs: [],
      total: 0,
      counts: EMPTY_COUNTS,
    });

    await workflowRunsCommand('/unregistered', {});

    expect(consoleSpy).toHaveBeenCalledWith('(not a registered project — showing all runs)');
  });

  it('emits the full dashboard result as JSON', async () => {
    const workflowDb = await import('@archon/core/db/workflows');
    const codebaseDb = await import('@archon/core/db/codebases');
    (codebaseDb.findCodebaseByDefaultCwd as ReturnType<typeof mock>).mockResolvedValueOnce(null);
    (workflowDb.listDashboardRuns as ReturnType<typeof mock>).mockResolvedValueOnce({
      runs: [
        {
          id: 'r1',
          workflow_name: 'assist',
          status: 'completed',
          current_step_name: null,
          total_steps: null,
          started_at: new Date(),
        },
      ],
      total: 1,
      counts: { ...EMPTY_COUNTS, all: 1, completed: 1 },
    });

    await workflowRunsCommand('/test/path', { json: true });

    expect(consoleSpy).toHaveBeenCalledTimes(1);
    const parsed = JSON.parse(consoleSpy.mock.calls[0][0] as string) as {
      runs: unknown[];
      total: number;
      scopeFallback: boolean;
    };
    expect(parsed.total).toBe(1);
    expect(parsed.runs).toHaveLength(1);
    // codebase did not resolve → result is a global fallback, flagged for agents
    expect(parsed.scopeFallback).toBe(true);
  });

  it('marks scopeFallback false in --json when the project scope resolves', async () => {
    const workflowDb = await import('@archon/core/db/workflows');
    const codebaseDb = await import('@archon/core/db/codebases');
    (codebaseDb.findCodebaseByDefaultCwd as ReturnType<typeof mock>).mockResolvedValueOnce({
      id: 'cb-proj',
      name: 'owner/repo',
      default_cwd: '/test/path',
    });
    (workflowDb.listDashboardRuns as ReturnType<typeof mock>).mockResolvedValueOnce({
      runs: [],
      total: 0,
      counts: EMPTY_COUNTS,
    });

    await workflowRunsCommand('/test/path', { json: true });

    const parsed = JSON.parse(consoleSpy.mock.calls[0][0] as string) as { scopeFallback: boolean };
    expect(parsed.scopeFallback).toBe(false);
  });

  it('passes --all (no codebase scope) plus --status/--limit through to listDashboardRuns', async () => {
    const workflowDb = await import('@archon/core/db/workflows');
    const codebaseDb = await import('@archon/core/db/codebases');
    const findSpy = codebaseDb.findCodebaseByDefaultCwd as ReturnType<typeof mock>;
    findSpy.mockClear();
    const listSpy = workflowDb.listDashboardRuns as ReturnType<typeof mock>;
    listSpy.mockClear();
    listSpy.mockResolvedValueOnce({ runs: [], total: 0, counts: EMPTY_COUNTS });

    await workflowRunsCommand('/test/path', { all: true, status: 'running', limit: 5 });

    // --all skips the codebase lookup entirely
    expect(findSpy).not.toHaveBeenCalled();
    const arg = listSpy.mock.calls[0][0] as { codebaseId?: string; status?: string; limit: number };
    expect(arg.codebaseId).toBeUndefined();
    expect(arg.status).toBe('running');
    expect(arg.limit).toBe(5);
  });

  it('throws on an invalid --status', async () => {
    await expect(workflowRunsCommand('/test/path', { status: 'bogus' })).rejects.toThrow(
      /Invalid --status 'bogus'/
    );
  });

  it('emits {ok:false} JSON (never throws) on an invalid --status in --json mode', async () => {
    await workflowRunsCommand('/test/path', { status: 'bogus', json: true });

    const parsed = JSON.parse(consoleSpy.mock.calls[0][0] as string) as {
      ok: boolean;
      error: string;
    };
    expect(parsed.ok).toBe(false);
    expect(parsed.error).toContain("Invalid --status 'bogus'");
  });
});

describe('write command --json output', () => {
  let consoleSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    consoleSpy = spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  it('abandon --json emits a structured cancelled result', async () => {
    const workflowDb = await import('@archon/core/db/workflows');
    (workflowDb.getWorkflowRun as ReturnType<typeof mock>).mockResolvedValueOnce({
      id: 'run-ab',
      workflow_name: 'implement',
      status: 'running',
    });
    (workflowDb.cancelWorkflowRun as ReturnType<typeof mock>).mockResolvedValueOnce({
      cancelled: true,
    });

    await workflowAbandonCommand('run-ab', true);

    expect(consoleSpy).toHaveBeenCalledTimes(1);
    expect(JSON.parse(consoleSpy.mock.calls[0][0] as string)).toEqual({
      ok: true,
      runId: 'run-ab',
      action: 'abandon',
      status: 'cancelled',
      workflowName: 'implement',
    });
  });

  it('abandon --json emits {ok:false} on a not-found run (never throws)', async () => {
    const workflowDb = await import('@archon/core/db/workflows');
    (workflowDb.getWorkflowRun as ReturnType<typeof mock>).mockResolvedValueOnce(null);

    await workflowAbandonCommand('missing', true);

    const parsed = JSON.parse(consoleSpy.mock.calls[0][0] as string) as {
      ok: boolean;
      error: string;
    };
    expect(parsed.ok).toBe(false);
    expect(parsed.error).toContain('Workflow run not found');
  });

  it('approve --json records the decision and does NOT auto-resume', async () => {
    const workflowDb = await import('@archon/core/db/workflows');
    const discovery = await import('@archon/workflows/workflow-discovery');
    (workflowDb.getWorkflowRun as ReturnType<typeof mock>).mockResolvedValueOnce({
      id: 'run-ap',
      workflow_name: 'implement',
      status: 'paused',
      working_path: '/tmp/wt',
      codebase_id: 'cb',
      conversation_id: 'conv',
      user_message: 'go',
      metadata: { approval: { nodeId: 'gate', message: 'ok?' } },
    });
    const discoverSpy = discovery.discoverWorkflowsWithConfig as ReturnType<typeof mock>;
    discoverSpy.mockClear();

    await workflowApproveCommand('run-ap', 'lgtm', true);

    const parsed = JSON.parse(consoleSpy.mock.calls[0][0] as string) as Record<string, unknown>;
    expect(parsed).toMatchObject({
      ok: true,
      runId: 'run-ap',
      action: 'approve',
      type: 'approval_gate',
      resumable: true,
    });
    // No inline resume → workflowRunCommand (whose first step is discovery) never ran
    expect(discoverSpy).not.toHaveBeenCalled();
  });

  it('reject --json reports cancelled + resumable correctly without auto-resume', async () => {
    const workflowDb = await import('@archon/core/db/workflows');
    const discovery = await import('@archon/workflows/workflow-discovery');
    (workflowDb.getWorkflowRun as ReturnType<typeof mock>).mockResolvedValueOnce({
      id: 'run-rj',
      workflow_name: 'implement',
      status: 'paused',
      working_path: '/tmp/wt',
      codebase_id: 'cb',
      conversation_id: 'conv',
      user_message: 'go',
      metadata: { approval: { nodeId: 'gate', message: 'ok?' } },
    });
    (workflowDb.cancelWorkflowRun as ReturnType<typeof mock>).mockResolvedValueOnce({
      cancelled: true,
    });
    const discoverSpy = discovery.discoverWorkflowsWithConfig as ReturnType<typeof mock>;
    discoverSpy.mockClear();

    await workflowRejectCommand('run-rj', 'nope', true);

    const parsed = JSON.parse(consoleSpy.mock.calls[0][0] as string) as Record<string, unknown>;
    // No onRejectPrompt in approval metadata → run is cancelled, not resumable
    expect(parsed).toMatchObject({
      ok: true,
      runId: 'run-rj',
      action: 'reject',
      cancelled: true,
      resumable: false,
    });
    expect(discoverSpy).not.toHaveBeenCalled();
  });

  it('resume --json validates resumability without executing (executed:false)', async () => {
    const workflowDb = await import('@archon/core/db/workflows');
    const discovery = await import('@archon/workflows/workflow-discovery');
    (workflowDb.getWorkflowRun as ReturnType<typeof mock>).mockResolvedValueOnce({
      id: 'run-rs',
      workflow_name: 'implement',
      status: 'failed',
      working_path: '/tmp/wt',
    });
    const discoverSpy = discovery.discoverWorkflowsWithConfig as ReturnType<typeof mock>;
    discoverSpy.mockClear();

    await workflowResumeCommand('run-rs', true);

    const parsed = JSON.parse(consoleSpy.mock.calls[0][0] as string) as Record<string, unknown>;
    expect(parsed).toMatchObject({
      ok: true,
      runId: 'run-rs',
      action: 'resume',
      executed: false,
      status: 'failed',
    });
    expect(discoverSpy).not.toHaveBeenCalled();
  });
});

describe('workflowRunCommand — detach', () => {
  let consoleSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    consoleSpy = spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  it('spawns a detached child (minus --detach, plus --branch/--conversation-id) and does NOT await executeWorkflow', async () => {
    const { discoverWorkflowsWithConfig } = await import('@archon/workflows/workflow-discovery');
    const { executeWorkflow } = await import('@archon/workflows/executor');
    const paths = await import('@archon/paths');
    (discoverWorkflowsWithConfig as ReturnType<typeof mock>).mockResolvedValueOnce({
      workflows: [makeTestWorkflowWithSource({ name: 'assist', description: 'Help' })],
      errors: [],
    });
    // Force the log-file path to fall back to 'ignore' so the test writes no files
    (paths.getArchonHome as ReturnType<typeof mock>).mockImplementationOnce(() => {
      throw new Error('no home in test');
    });

    const execBefore = (executeWorkflow as ReturnType<typeof mock>).mock.calls.length;
    const spawnSpy = spyOn(Bun, 'spawn').mockReturnValue({
      unref: mock(() => undefined),
    } as unknown as ReturnType<typeof Bun.spawn>);
    const savedArgv = process.argv;
    process.argv = ['bun', '/abs/cli.ts', 'workflow', 'run', 'assist', 'hello', '--detach'];

    // Capture call data BEFORE mockRestore() — restoring a spy clears its recorded calls.
    let spawnCallCount = 0;
    let spawnCmd: string[] = [];
    let spawnOptions: { cwd: string; cmd: string[] } | undefined;
    try {
      await workflowRunCommand('/test/path', 'assist', 'hello', { detach: true });
      spawnCallCount = spawnSpy.mock.calls.length;
      spawnOptions = spawnSpy.mock.calls[0]?.[0] as { cwd: string; cmd: string[] } | undefined;
      spawnCmd = (spawnOptions?.cmd ?? []).slice();
    } finally {
      process.argv = savedArgv;
      spawnSpy.mockRestore();
    }

    expect(spawnCallCount).toBe(1);
    expect(spawnCmd).not.toContain('--detach');
    expect(spawnCmd).toContain('--branch');
    expect(spawnCmd).toContain('--conversation-id');
    expect(spawnCmd).toContain('--cwd');
    const cwdIdx = spawnCmd.indexOf('--cwd');
    expect(spawnCmd[cwdIdx + 1]).toBe('/test/path');
    expect(spawnOptions?.cwd).toBe('/test/path');
    // Generated branch is `assist-<timestamp>`
    const branchIdx = spawnCmd.indexOf('--branch');
    expect(spawnCmd[branchIdx + 1]).toMatch(/^assist-\d+$/);
    // executeWorkflow must NOT run in the detaching parent
    const execAfter = (executeWorkflow as ReturnType<typeof mock>).mock.calls.length;
    expect(execAfter).toBe(execBefore);
    expect(consoleSpy).toHaveBeenCalledWith("Started 'assist' in the background.");
  });

  it('--detach --json emits a structured ack', async () => {
    const { discoverWorkflowsWithConfig } = await import('@archon/workflows/workflow-discovery');
    const paths = await import('@archon/paths');
    (discoverWorkflowsWithConfig as ReturnType<typeof mock>).mockResolvedValueOnce({
      workflows: [makeTestWorkflowWithSource({ name: 'assist', description: 'Help' })],
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
      'assist',
      'hello',
      '--detach',
      '--json',
    ];

    try {
      await workflowRunCommand('/test/path', 'assist', 'hello', { detach: true, json: true });
    } finally {
      process.argv = savedArgv;
      spawnSpy.mockRestore();
    }

    const parsed = JSON.parse(consoleSpy.mock.calls[0][0] as string) as Record<string, unknown>;
    expect(parsed).toMatchObject({ ok: true, action: 'run', detached: true, workflow: 'assist' });
    expect(typeof parsed.conversationId).toBe('string');
  });
});

describe('buildDetachedRunCmd', () => {
  // BUNDLED_IS_BINARY is a module-level const (mocked false), so the binary
  // branch is unreachable through spawnDetachedWorkflowRun — exercise both
  // branches directly via the pure builder.

  it('dev mode: keeps [execPath, entryScript], slices argv(2), drops --detach/--json', () => {
    const cmd = buildDetachedRunCmd(
      false,
      '/path/to/bun',
      ['/path/to/bun', '/abs/cli.ts', 'workflow', 'run', 'assist', 'hello', '--detach', '--json'],
      '/abs/cwd',
      ['--branch', 'assist-123', '--conversation-id', 'cli-1']
    );

    expect(cmd[0]).toBe('/path/to/bun');
    expect(cmd[1]).toBe('/abs/cli.ts');
    expect(cmd).not.toContain('--detach');
    expect(cmd).not.toContain('--json');
    expect(cmd).toContain('assist');
    // --cwd pinned absolute, then extra flags
    const cwdIdx = cmd.indexOf('--cwd');
    expect(cmd[cwdIdx + 1]).toBe('/abs/cwd');
    expect(cmd).toContain('--branch');
    expect(cmd).toContain('--conversation-id');
  });

  it('binary mode: uses [execPath] only (no duplicated entry arg), slices argv(1)', () => {
    const cmd = buildDetachedRunCmd(
      true,
      '/usr/local/bin/archon',
      ['/usr/local/bin/archon', 'workflow', 'run', 'assist', 'hello', '--detach', '--json'],
      '/abs/cwd',
      ['--branch', 'assist-123']
    );

    expect(cmd[0]).toBe('/usr/local/bin/archon');
    // The binary path must appear exactly once — never duplicated as argv[1].
    expect(cmd.filter(arg => arg === '/usr/local/bin/archon')).toHaveLength(1);
    expect(cmd[1]).toBe('workflow');
    expect(cmd).not.toContain('--detach');
    expect(cmd).not.toContain('--json');
    const cwdIdx = cmd.indexOf('--cwd');
    expect(cmd[cwdIdx + 1]).toBe('/abs/cwd');
    expect(cmd.slice(cwdIdx + 2)).toEqual(['--branch', 'assist-123']);
  });
});

describe('workflowResumeCommand', () => {
  let consoleSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    consoleSpy = spyOn(console, 'log').mockImplementation(() => {});
    mockLogger.error.mockClear();
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  it('should throw when run not found', async () => {
    const workflowDb = await import('@archon/core/db/workflows');
    (workflowDb.getWorkflowRun as ReturnType<typeof mock>).mockResolvedValueOnce(null);

    await expect(workflowResumeCommand('missing-id')).rejects.toThrow(
      'Workflow run not found: missing-id'
    );
  });

  it('should throw when run is not resumable', async () => {
    const workflowDb = await import('@archon/core/db/workflows');
    (workflowDb.getWorkflowRun as ReturnType<typeof mock>).mockResolvedValueOnce({
      id: 'run-1',
      workflow_name: 'test',
      status: 'completed',
    });

    await expect(workflowResumeCommand('run-1')).rejects.toThrow(
      "Cannot resume run with status 'completed'"
    );
  });

  it('should print resume info and delegate to workflowRunCommand', async () => {
    const workflowDb = await import('@archon/core/db/workflows');
    (workflowDb.getWorkflowRun as ReturnType<typeof mock>).mockResolvedValueOnce({
      id: 'run-1',
      workflow_name: 'implement',
      status: 'failed',
      user_message: 'add auth',
      working_path: '/tmp/test-worktree',
    });

    // workflowResumeCommand calls workflowRunCommand internally which needs many
    // mocks. The --resume execution flow is tested separately in workflowRunCommand tests.
    // Here we only verify the initial output by catching the downstream error.
    try {
      await workflowResumeCommand('run-1');
    } catch {
      // workflowRunCommand will fail due to missing mocks — that's fine
    }

    // Printed resume message before delegating to workflowRunCommand
    expect(consoleSpy).toHaveBeenCalledWith('Resuming workflow: implement');
    expect(consoleSpy).toHaveBeenCalledWith('Path: /tmp/test-worktree');
  });

  it('should throw when run has no working path', async () => {
    const workflowDb = await import('@archon/core/db/workflows');
    (workflowDb.getWorkflowRun as ReturnType<typeof mock>).mockResolvedValueOnce({
      id: 'run-no-path',
      workflow_name: 'implement',
      status: 'failed',
      working_path: null,
    });

    await expect(workflowResumeCommand('run-no-path')).rejects.toThrow(
      'has no working path recorded'
    );
  });

  it('should pass codebase_id from run record to workflowRunCommand', async () => {
    const workflowDb = await import('@archon/core/db/workflows');
    const codebaseDb = await import('@archon/core/db/codebases');
    const workflowDiscovery = await import('@archon/workflows/workflow-discovery');

    (workflowDb.getWorkflowRun as ReturnType<typeof mock>).mockResolvedValueOnce({
      id: 'run-1',
      workflow_name: 'implement',
      status: 'failed',
      user_message: 'add auth',
      working_path: '/tmp/test-worktree',
      codebase_id: 'cb-existing',
    });

    // Return a matching workflow so workflowRunCommand doesn't throw before codebase lookup
    (
      workflowDiscovery.discoverWorkflowsWithConfig as ReturnType<typeof mock>
    ).mockResolvedValueOnce({
      workflows: [makeTestWorkflowWithSource({ name: 'implement' })],
      errors: [],
    });

    // Simulate getCodebase returning the codebase found by ID
    (codebaseDb.getCodebase as ReturnType<typeof mock>).mockResolvedValueOnce({
      id: 'cb-existing',
      name: 'owner/repo',
      default_cwd: '/path/to/main-checkout', // different from working_path
    });

    try {
      await workflowResumeCommand('run-1');
    } catch {
      // workflowRunCommand may fail on other mocks — that's fine
    }

    // getCodebase SHOULD have been called with the stored codebase_id
    expect(codebaseDb.getCodebase).toHaveBeenCalledWith('cb-existing');
  });

  it('fails loudly when getCodebase throws during resume', async () => {
    const workflowDb = await import('@archon/core/db/workflows');
    const codebaseDb = await import('@archon/core/db/codebases');
    const workflowDiscovery = await import('@archon/workflows/workflow-discovery');

    (workflowDb.getWorkflowRun as ReturnType<typeof mock>).mockResolvedValueOnce({
      id: 'run-err',
      workflow_name: 'implement',
      status: 'failed',
      user_message: 'add auth',
      working_path: '/tmp/test-worktree',
      codebase_id: 'cb-bad',
    });

    // getCodebase throws — simulates DB hiccup
    (codebaseDb.getCodebase as ReturnType<typeof mock>).mockRejectedValueOnce(
      new Error('connection refused')
    );

    const discoverSpy = workflowDiscovery.discoverWorkflowsWithConfig as ReturnType<typeof mock>;
    discoverSpy.mockClear();

    await expect(workflowResumeCommand('run-err')).rejects.toThrow(
      "Failed to load codebase 'cb-bad' for workflow run 'run-err'"
    );

    expect(mockLogger.error).toHaveBeenCalledWith(
      expect.objectContaining({ codebaseId: 'cb-bad' }),
      'cli.workflow_resume_codebase_lookup_failed'
    );
    expect(discoverSpy).not.toHaveBeenCalledWith('/tmp/test-worktree', expect.any(Function));
  });

  it('fails loudly when codebase row is missing during resume', async () => {
    const workflowDb = await import('@archon/core/db/workflows');
    const codebaseDb = await import('@archon/core/db/codebases');
    const workflowDiscovery = await import('@archon/workflows/workflow-discovery');

    (workflowDb.getWorkflowRun as ReturnType<typeof mock>).mockResolvedValueOnce({
      id: 'run-missing-codebase',
      workflow_name: 'implement',
      status: 'failed',
      user_message: 'add auth',
      working_path: '/tmp/test-worktree',
      codebase_id: 'cb-missing',
    });
    (codebaseDb.getCodebase as ReturnType<typeof mock>).mockResolvedValueOnce(null);

    const discoverSpy = workflowDiscovery.discoverWorkflowsWithConfig as ReturnType<typeof mock>;
    discoverSpy.mockClear();

    await expect(workflowResumeCommand('run-missing-codebase')).rejects.toThrow(
      "references codebase 'cb-missing', but that codebase no longer exists"
    );
    expect(discoverSpy).not.toHaveBeenCalledWith('/tmp/test-worktree', expect.any(Function));
  });

  it('should discover workflows from codebase.default_cwd, not working_path', async () => {
    // Regression test for #1663: when working_path is a worktree or workspace
    // clone that lacks the user's local workflow YAML, discovery must fall back
    // to codebase.default_cwd so the file is still found.
    const workflowDb = await import('@archon/core/db/workflows');
    const codebaseDb = await import('@archon/core/db/codebases');
    const workflowDiscovery = await import('@archon/workflows/workflow-discovery');

    (workflowDb.getWorkflowRun as ReturnType<typeof mock>).mockResolvedValueOnce({
      id: 'run-1663',
      workflow_name: 'my-approval-workflow',
      status: 'failed',
      user_message: 'go',
      working_path: '/tmp/worktree-without-yaml',
      codebase_id: 'cb-with-yaml',
    });

    (codebaseDb.getCodebase as ReturnType<typeof mock>).mockResolvedValueOnce({
      id: 'cb-with-yaml',
      name: 'owner/repo',
      default_cwd: '/users/me/source-repo-with-yaml',
    });

    const discoverSpy = workflowDiscovery.discoverWorkflowsWithConfig as ReturnType<typeof mock>;
    discoverSpy.mockClear();
    discoverSpy.mockResolvedValueOnce({ workflows: [], errors: [] });

    try {
      await workflowResumeCommand('run-1663');
    } catch {
      // downstream failure is acceptable — we only need to assert the discovery cwd
    }

    // Discovery must use the codebase source path, NOT working_path
    expect(discoverSpy).toHaveBeenCalledWith(
      '/users/me/source-repo-with-yaml',
      expect.any(Function)
    );
  });

  it('should fall back to working_path for discovery when codebase_id is missing', async () => {
    const workflowDb = await import('@archon/core/db/workflows');
    const workflowDiscovery = await import('@archon/workflows/workflow-discovery');

    (workflowDb.getWorkflowRun as ReturnType<typeof mock>).mockResolvedValueOnce({
      id: 'run-no-codebase',
      workflow_name: 'legacy',
      status: 'failed',
      user_message: 'go',
      working_path: '/tmp/old-worktree',
      codebase_id: null,
    });

    const discoverSpy = workflowDiscovery.discoverWorkflowsWithConfig as ReturnType<typeof mock>;
    discoverSpy.mockClear();
    discoverSpy.mockResolvedValueOnce({ workflows: [], errors: [] });

    try {
      await workflowResumeCommand('run-no-codebase');
    } catch {
      // downstream failure is acceptable
    }

    // No codebase → falls back to working_path (preserves existing behavior)
    expect(discoverSpy).toHaveBeenCalledWith('/tmp/old-worktree', expect.any(Function));
  });
});

describe('workflowApproveCommand', () => {
  let consoleSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    consoleSpy = spyOn(console, 'log').mockImplementation(() => {});
    mockLogger.error.mockClear();
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  it('should throw when run not found', async () => {
    const workflowDb = await import('@archon/core/db/workflows');
    (workflowDb.getWorkflowRun as ReturnType<typeof mock>).mockResolvedValueOnce(null);

    await expect(workflowApproveCommand('missing-id')).rejects.toThrow(
      'Workflow run not found: missing-id'
    );
  });

  it('should pass codebase_id from run record to workflowRunCommand', async () => {
    const workflowDb = await import('@archon/core/db/workflows');
    const codebaseDb = await import('@archon/core/db/codebases');
    const workflowDiscovery = await import('@archon/workflows/workflow-discovery');
    const core = await import('@archon/core');

    (workflowDb.getWorkflowRun as ReturnType<typeof mock>).mockResolvedValueOnce({
      id: 'run-approve-1',
      workflow_name: 'implement',
      status: 'paused',
      user_message: 'add auth',
      working_path: '/tmp/test-worktree',
      codebase_id: 'cb-existing',
      metadata: { approval: { nodeId: 'review-node' } },
    });

    (core.createWorkflowStore as ReturnType<typeof mock>).mockReturnValueOnce({
      createWorkflowEvent: mock(() => Promise.resolve()),
    });

    (
      workflowDiscovery.discoverWorkflowsWithConfig as ReturnType<typeof mock>
    ).mockResolvedValueOnce({
      workflows: [makeTestWorkflowWithSource({ name: 'implement' })],
      errors: [],
    });

    (codebaseDb.getCodebase as ReturnType<typeof mock>).mockResolvedValueOnce({
      id: 'cb-existing',
      name: 'owner/repo',
      default_cwd: '/path/to/main-checkout',
    });

    try {
      await workflowApproveCommand('run-approve-1');
    } catch {
      // downstream failure is acceptable
    }

    expect(codebaseDb.getCodebase).toHaveBeenCalledWith('cb-existing');
  });

  it('fails loudly when codebase row is missing during approve auto-resume', async () => {
    const workflowDb = await import('@archon/core/db/workflows');
    const codebaseDb = await import('@archon/core/db/codebases');
    const workflowDiscovery = await import('@archon/workflows/workflow-discovery');
    const core = await import('@archon/core');

    (workflowDb.getWorkflowRun as ReturnType<typeof mock>).mockResolvedValueOnce({
      id: 'run-approve-missing-codebase',
      workflow_name: 'implement',
      status: 'paused',
      user_message: 'add auth',
      working_path: '/tmp/test-worktree',
      codebase_id: 'cb-missing',
      metadata: { approval: { type: 'approval', nodeId: 'review-node', message: 'Approve?' } },
    });
    (workflowDb.updateWorkflowRun as ReturnType<typeof mock>).mockResolvedValueOnce(undefined);
    (core.createWorkflowStore as ReturnType<typeof mock>).mockReturnValueOnce({
      createWorkflowEvent: mock(() => Promise.resolve()),
    });
    const getCodebaseMock = codebaseDb.getCodebase as ReturnType<typeof mock>;
    getCodebaseMock.mockReset();
    getCodebaseMock.mockResolvedValueOnce(null);

    const discoverSpy = workflowDiscovery.discoverWorkflowsWithConfig as ReturnType<typeof mock>;
    discoverSpy.mockClear();

    await expect(workflowApproveCommand('run-approve-missing-codebase')).rejects.toThrow(
      "Approved but failed to resume workflow 'implement': Workflow run 'run-approve-missing-codebase' references codebase 'cb-missing', but that codebase no longer exists"
    );
    expect(discoverSpy).not.toHaveBeenCalledWith('/tmp/test-worktree', expect.any(Function));
  });

  it('fails with recorded-approval recovery when getCodebase throws during approve auto-resume', async () => {
    const workflowDb = await import('@archon/core/db/workflows');
    const codebaseDb = await import('@archon/core/db/codebases');
    const workflowDiscovery = await import('@archon/workflows/workflow-discovery');
    const core = await import('@archon/core');

    (workflowDb.getWorkflowRun as ReturnType<typeof mock>).mockResolvedValueOnce({
      id: 'run-approve-codebase-error',
      workflow_name: 'implement',
      status: 'paused',
      user_message: 'add auth',
      working_path: '/tmp/test-worktree',
      codebase_id: 'cb-bad',
      metadata: { approval: { type: 'approval', nodeId: 'review-node', message: 'Approve?' } },
    });
    (workflowDb.updateWorkflowRun as ReturnType<typeof mock>).mockResolvedValueOnce(undefined);
    (core.createWorkflowStore as ReturnType<typeof mock>).mockReturnValueOnce({
      createWorkflowEvent: mock(() => Promise.resolve()),
    });
    const getCodebaseMock = codebaseDb.getCodebase as ReturnType<typeof mock>;
    getCodebaseMock.mockReset();
    getCodebaseMock.mockRejectedValueOnce(new Error('database offline'));

    const discoverSpy = workflowDiscovery.discoverWorkflowsWithConfig as ReturnType<typeof mock>;
    discoverSpy.mockClear();

    await expect(workflowApproveCommand('run-approve-codebase-error')).rejects.toThrow(
      "Approved but failed to resume workflow 'implement': Failed to load codebase 'cb-bad' for workflow run 'run-approve-codebase-error': database offline\n" +
        'Cannot safely discover workflows from the run worktree because project workflow files may be missing.\n' +
        'Fix the codebase lookup problem, then retry.\n' +
        "The approval was recorded. Run 'bun run cli workflow resume run-approve-codebase-error' to retry."
    );
    expect(mockLogger.error).toHaveBeenCalledWith(
      expect.objectContaining({ codebaseId: 'cb-bad' }),
      'cli.workflow_approve_codebase_lookup_failed'
    );
    expect(mockLogger.error).toHaveBeenCalledWith(
      expect.objectContaining({ runId: 'run-approve-codebase-error' }),
      'cli.workflow_approve_resume_failed'
    );
    expect(discoverSpy).not.toHaveBeenCalledWith('/tmp/test-worktree', expect.any(Function));
  });

  it('should pass original platform conversation ID through to workflowRunCommand', async () => {
    const workflowDb = await import('@archon/core/db/workflows');
    const codebaseDb = await import('@archon/core/db/codebases');
    const conversationsDb = await import('@archon/core/db/conversations');
    const workflowDiscovery = await import('@archon/workflows/workflow-discovery');
    const core = await import('@archon/core');

    (workflowDb.getWorkflowRun as ReturnType<typeof mock>).mockResolvedValueOnce({
      id: 'run-approve-conv',
      workflow_name: 'implement',
      status: 'paused',
      user_message: 'add auth',
      working_path: '/tmp/test-worktree',
      codebase_id: 'cb-existing',
      conversation_id: 'db-uuid-original',
      metadata: { approval: { nodeId: 'review-node', message: 'Approve?' } },
    });

    // Return a conversation with the original platform ID
    (conversationsDb.getConversationById as ReturnType<typeof mock>).mockResolvedValueOnce({
      id: 'db-uuid-original',
      platform_type: 'cli',
      platform_conversation_id: 'cli-original-123',
    });

    (
      workflowDiscovery.discoverWorkflowsWithConfig as ReturnType<typeof mock>
    ).mockResolvedValueOnce({
      workflows: [makeTestWorkflowWithSource({ name: 'implement' })],
      errors: [],
    });

    (codebaseDb.getCodebase as ReturnType<typeof mock>).mockResolvedValueOnce({
      id: 'cb-existing',
      name: 'owner/repo',
      default_cwd: '/path/to/main-checkout',
    });

    // Clear call history before our test so we can assert precisely
    (conversationsDb.getOrCreateConversation as ReturnType<typeof mock>).mockClear();

    try {
      await workflowApproveCommand('run-approve-conv');
    } catch {
      // downstream failure is acceptable — we only need to reach getOrCreateConversation
    }

    // Verify the original platform conversation ID was passed through
    expect(conversationsDb.getConversationById).toHaveBeenCalledWith('db-uuid-original');
    expect(conversationsDb.getOrCreateConversation).toHaveBeenCalledWith('cli', 'cli-original-123');
  });

  it('should discover workflows from codebase.default_cwd, not working_path', async () => {
    // Regression test for #1663: auto-resume after approve must look up the
    // workflow YAML in the source repo (codebase.default_cwd), not the
    // worktree/workspace working_path that may lack the file.
    const workflowDb = await import('@archon/core/db/workflows');
    const codebaseDb = await import('@archon/core/db/codebases');
    const workflowDiscovery = await import('@archon/workflows/workflow-discovery');
    const core = await import('@archon/core');

    (workflowDb.getWorkflowRun as ReturnType<typeof mock>).mockResolvedValueOnce({
      id: 'run-approve-1663',
      workflow_name: 'my-approval-workflow',
      status: 'paused',
      user_message: 'go',
      working_path: '/tmp/worktree-without-yaml',
      codebase_id: 'cb-with-yaml',
      metadata: { approval: { nodeId: 'gate', message: 'Approve?' } },
    });

    (core.createWorkflowStore as ReturnType<typeof mock>).mockReturnValueOnce({
      createWorkflowEvent: mock(() => Promise.resolve()),
    });

    (codebaseDb.getCodebase as ReturnType<typeof mock>).mockResolvedValueOnce({
      id: 'cb-with-yaml',
      name: 'owner/repo',
      default_cwd: '/users/me/source-repo-with-yaml',
    });

    const discoverSpy = workflowDiscovery.discoverWorkflowsWithConfig as ReturnType<typeof mock>;
    discoverSpy.mockClear();
    discoverSpy.mockResolvedValueOnce({ workflows: [], errors: [] });

    try {
      await workflowApproveCommand('run-approve-1663');
    } catch {
      // downstream failure is acceptable
    }

    expect(discoverSpy).toHaveBeenCalledWith(
      '/users/me/source-repo-with-yaml',
      expect.any(Function)
    );
  });
});

describe('workflowAbandonCommand', () => {
  let consoleSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    consoleSpy = spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  it('should throw when run not found', async () => {
    const workflowDb = await import('@archon/core/db/workflows');
    (workflowDb.getWorkflowRun as ReturnType<typeof mock>).mockResolvedValueOnce(null);

    await expect(workflowAbandonCommand('missing-id')).rejects.toThrow(
      'Workflow run not found: missing-id'
    );
  });

  it('should throw when run is not abandonable', async () => {
    const workflowDb = await import('@archon/core/db/workflows');
    (workflowDb.getWorkflowRun as ReturnType<typeof mock>).mockResolvedValueOnce({
      id: 'run-1',
      workflow_name: 'test',
      status: 'completed',
    });

    await expect(workflowAbandonCommand('run-1')).rejects.toThrow(
      "Cannot abandon run with status 'completed'"
    );
  });

  it('should abandon a running workflow', async () => {
    const workflowDb = await import('@archon/core/db/workflows');
    (workflowDb.getWorkflowRun as ReturnType<typeof mock>).mockResolvedValueOnce({
      id: 'run-1',
      workflow_name: 'implement',
      status: 'running',
    });
    (workflowDb.cancelWorkflowRun as ReturnType<typeof mock>).mockResolvedValueOnce(undefined);

    await workflowAbandonCommand('run-1');

    expect(workflowDb.cancelWorkflowRun).toHaveBeenCalledWith('run-1');
    expect(consoleSpy).toHaveBeenCalledWith('Abandoned workflow run: run-1');
  });
});

describe('workflowCleanupCommand', () => {
  let consoleSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    consoleSpy = spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  it('should print deletion count when runs are deleted', async () => {
    const workflowDb = await import('@archon/core/db/workflows');
    (workflowDb.deleteOldWorkflowRuns as ReturnType<typeof mock>).mockResolvedValueOnce({
      count: 5,
    });

    await workflowCleanupCommand(30);

    expect(consoleSpy).toHaveBeenCalledWith('Deleted 5 workflow run(s) older than 30 days.');
  });

  it('should print no-op message when count is 0', async () => {
    const workflowDb = await import('@archon/core/db/workflows');
    (workflowDb.deleteOldWorkflowRuns as ReturnType<typeof mock>).mockResolvedValueOnce({
      count: 0,
    });

    await workflowCleanupCommand(7);

    expect(consoleSpy).toHaveBeenCalledWith('No workflow runs older than 7 days to clean up.');
  });

  it('should throw when deleteOldWorkflowRuns fails', async () => {
    const workflowDb = await import('@archon/core/db/workflows');
    (workflowDb.deleteOldWorkflowRuns as ReturnType<typeof mock>).mockRejectedValueOnce(
      new Error('disk full')
    );

    await expect(workflowCleanupCommand(7)).rejects.toThrow(
      'Failed to clean up workflow runs: disk full'
    );
  });
});

describe('workflowRejectCommand', () => {
  let consoleSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    consoleSpy = spyOn(console, 'log').mockImplementation(() => {});
    mockLogger.error.mockClear();
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  it('should throw when run not found', async () => {
    const workflowDb = await import('@archon/core/db/workflows');
    (workflowDb.getWorkflowRun as ReturnType<typeof mock>).mockResolvedValueOnce(null);

    await expect(workflowRejectCommand('missing-id')).rejects.toThrow();
  });

  it('should throw when run is not paused', async () => {
    const workflowDb = await import('@archon/core/db/workflows');
    (workflowDb.getWorkflowRun as ReturnType<typeof mock>).mockResolvedValueOnce({
      id: 'run-1',
      workflow_name: 'my-wf',
      status: 'running',
      metadata: {},
    });

    await expect(workflowRejectCommand('run-1')).rejects.toThrow('Cannot reject run');
  });

  it('cancels immediately when no on_reject configured', async () => {
    const workflowDb = await import('@archon/core/db/workflows');
    const core = await import('@archon/core');

    (workflowDb.getWorkflowRun as ReturnType<typeof mock>).mockResolvedValueOnce({
      id: 'run-plain',
      workflow_name: 'plain-wf',
      status: 'paused',
      user_message: 'build it',
      working_path: '/repo',
      codebase_id: null,
      metadata: { approval: { type: 'approval', nodeId: 'gate', message: 'Approve?' } },
    });
    (core.createWorkflowStore as ReturnType<typeof mock>).mockReturnValueOnce({
      createWorkflowEvent: mock(() => Promise.resolve()),
    });

    await workflowRejectCommand('run-plain', 'not good');

    expect(workflowDb.cancelWorkflowRun).toHaveBeenCalledWith('run-plain');
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Rejected and cancelled'));
  });

  it('updates metadata and auto-resumes when on_reject configured and under limit', async () => {
    const workflowDb = await import('@archon/core/db/workflows');

    const runData = {
      id: 'run-on-reject',
      workflow_name: 'my-wf',
      status: 'paused',
      user_message: 'build it',
      working_path: '/repo',
      codebase_id: null,
      metadata: {
        approval: {
          type: 'approval',
          nodeId: 'gate',
          message: 'Approve?',
          onRejectPrompt: 'Fix: $REJECTION_REASON',
          onRejectMaxAttempts: 3,
        },
        rejection_count: 0,
      },
    };
    (workflowDb.getWorkflowRun as ReturnType<typeof mock>).mockResolvedValueOnce(runData);

    try {
      await workflowRejectCommand('run-on-reject', 'needs work');
    } catch {
      // downstream workflowRunCommand failure is acceptable in this unit test
    }

    expect(workflowDb.updateWorkflowRun).toHaveBeenCalledWith('run-on-reject', {
      status: 'failed',
      metadata: { rejection_reason: 'needs work', rejection_count: 1 },
    });
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Rejected workflow'));
  });

  it('should pass original platform conversation ID through on reject-resume', async () => {
    const workflowDb = await import('@archon/core/db/workflows');
    const conversationsDb = await import('@archon/core/db/conversations');
    const workflowDiscovery = await import('@archon/workflows/workflow-discovery');

    const runData = {
      id: 'run-reject-conv',
      workflow_name: 'my-wf',
      status: 'paused',
      user_message: 'build it',
      working_path: '/repo',
      codebase_id: null,
      conversation_id: 'db-uuid-reject',
      metadata: {
        approval: {
          type: 'approval',
          nodeId: 'gate',
          message: 'Approve?',
          onRejectPrompt: 'Fix: $REJECTION_REASON',
          onRejectMaxAttempts: 3,
        },
        rejection_count: 0,
      },
    };
    // rejectWorkflow reads the run twice internally (getRunOrThrow + updateWorkflowRun check)
    (workflowDb.getWorkflowRun as ReturnType<typeof mock>).mockResolvedValueOnce(runData);

    // Return a conversation with the original platform ID
    (conversationsDb.getConversationById as ReturnType<typeof mock>).mockResolvedValueOnce({
      id: 'db-uuid-reject',
      platform_type: 'cli',
      platform_conversation_id: 'cli-reject-456',
    });

    (
      workflowDiscovery.discoverWorkflowsWithConfig as ReturnType<typeof mock>
    ).mockResolvedValueOnce({
      workflows: [makeTestWorkflowWithSource({ name: 'my-wf' })],
      errors: [],
    });

    // Clear call history before our test so we can assert precisely
    (conversationsDb.getOrCreateConversation as ReturnType<typeof mock>).mockClear();

    try {
      await workflowRejectCommand('run-reject-conv', 'needs work');
    } catch {
      // downstream workflowRunCommand failure is acceptable — we only need to reach getOrCreateConversation
    }

    // Verify the original platform conversation ID was passed through
    expect(conversationsDb.getConversationById).toHaveBeenCalledWith('db-uuid-reject');
    expect(conversationsDb.getOrCreateConversation).toHaveBeenCalledWith('cli', 'cli-reject-456');
  });

  it('cancels when max attempts reached', async () => {
    const workflowDb = await import('@archon/core/db/workflows');
    const core = await import('@archon/core');

    (workflowDb.getWorkflowRun as ReturnType<typeof mock>).mockResolvedValueOnce({
      id: 'run-max',
      workflow_name: 'my-wf',
      status: 'paused',
      user_message: 'build it',
      working_path: '/repo',
      codebase_id: null,
      metadata: {
        approval: {
          type: 'approval',
          nodeId: 'gate',
          message: 'Approve?',
          onRejectPrompt: 'Fix: $REJECTION_REASON',
          onRejectMaxAttempts: 3,
        },
        rejection_count: 2,
      },
    });
    (core.createWorkflowStore as ReturnType<typeof mock>).mockReturnValueOnce({
      createWorkflowEvent: mock(() => Promise.resolve()),
    });

    await workflowRejectCommand('run-max', 'still bad');

    expect(workflowDb.cancelWorkflowRun).toHaveBeenCalledWith('run-max');
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('max attempts reached'));
  });

  it('throws when on_reject configured but working_path is null', async () => {
    const workflowDb = await import('@archon/core/db/workflows');

    const runData = {
      id: 'run-no-path',
      workflow_name: 'my-wf',
      status: 'paused',
      user_message: 'build it',
      working_path: null,
      codebase_id: null,
      metadata: {
        approval: {
          type: 'approval',
          nodeId: 'gate',
          message: 'Approve?',
          onRejectPrompt: 'Fix: $REJECTION_REASON',
          onRejectMaxAttempts: 3,
        },
        rejection_count: 0,
      },
    };
    (workflowDb.getWorkflowRun as ReturnType<typeof mock>).mockResolvedValueOnce(runData);
    (workflowDb.updateWorkflowRun as ReturnType<typeof mock>).mockResolvedValueOnce(undefined);

    await expect(workflowRejectCommand('run-no-path', 'bad')).rejects.toThrow('no working path');
  });

  it('should discover workflows from codebase.default_cwd on reject-resume, not working_path', async () => {
    // Regression for #1663: reject with on_reject configured re-invokes
    // workflowRunCommand. Discovery must use the source repo, not the worktree.
    const workflowDb = await import('@archon/core/db/workflows');
    const codebaseDb = await import('@archon/core/db/codebases');
    const workflowDiscovery = await import('@archon/workflows/workflow-discovery');

    const runData = {
      id: 'run-reject-1663',
      workflow_name: 'my-approval-workflow',
      status: 'paused',
      user_message: 'go',
      working_path: '/tmp/worktree-without-yaml',
      codebase_id: 'cb-with-yaml',
      metadata: {
        approval: {
          type: 'approval',
          nodeId: 'gate',
          message: 'Approve?',
          onRejectPrompt: 'Fix: $REJECTION_REASON',
          onRejectMaxAttempts: 3,
        },
        rejection_count: 0,
      },
    };
    (workflowDb.getWorkflowRun as ReturnType<typeof mock>).mockResolvedValueOnce(runData);
    (workflowDb.updateWorkflowRun as ReturnType<typeof mock>).mockResolvedValueOnce(undefined);

    (codebaseDb.getCodebase as ReturnType<typeof mock>).mockResolvedValueOnce({
      id: 'cb-with-yaml',
      name: 'owner/repo',
      default_cwd: '/users/me/source-repo-with-yaml',
    });

    const discoverSpy = workflowDiscovery.discoverWorkflowsWithConfig as ReturnType<typeof mock>;
    discoverSpy.mockClear();
    discoverSpy.mockResolvedValueOnce({ workflows: [], errors: [] });

    try {
      await workflowRejectCommand('run-reject-1663', 'needs work');
    } catch {
      // downstream failure is acceptable
    }

    // Discovery must use the codebase source path, NOT working_path
    expect(discoverSpy).toHaveBeenCalledWith(
      '/users/me/source-repo-with-yaml',
      expect.any(Function)
    );
  });

  it('fails loudly when getCodebase throws during reject auto-resume', async () => {
    const workflowDb = await import('@archon/core/db/workflows');
    const codebaseDb = await import('@archon/core/db/codebases');
    const workflowDiscovery = await import('@archon/workflows/workflow-discovery');

    const runData = {
      id: 'run-reject-codebase-error',
      workflow_name: 'my-approval-workflow',
      status: 'paused',
      user_message: 'go',
      working_path: '/tmp/worktree-without-yaml',
      codebase_id: 'cb-bad',
      metadata: {
        approval: {
          type: 'approval',
          nodeId: 'gate',
          message: 'Approve?',
          onRejectPrompt: 'Fix: $REJECTION_REASON',
          onRejectMaxAttempts: 3,
        },
        rejection_count: 0,
      },
    };
    (workflowDb.getWorkflowRun as ReturnType<typeof mock>).mockResolvedValueOnce(runData);
    (workflowDb.updateWorkflowRun as ReturnType<typeof mock>).mockResolvedValueOnce(undefined);
    const getCodebaseMock = codebaseDb.getCodebase as ReturnType<typeof mock>;
    getCodebaseMock.mockReset();
    getCodebaseMock.mockRejectedValueOnce(new Error('database offline'));

    const discoverSpy = workflowDiscovery.discoverWorkflowsWithConfig as ReturnType<typeof mock>;
    discoverSpy.mockClear();

    await expect(workflowRejectCommand('run-reject-codebase-error', 'needs work')).rejects.toThrow(
      "Rejected but failed to resume workflow 'my-approval-workflow': Failed to load codebase 'cb-bad' for workflow run 'run-reject-codebase-error'"
    );
    expect(mockLogger.error).toHaveBeenCalledWith(
      expect.objectContaining({ codebaseId: 'cb-bad' }),
      'cli.workflow_reject_codebase_lookup_failed'
    );
    expect(mockLogger.error).toHaveBeenCalledWith(
      expect.objectContaining({ runId: 'run-reject-codebase-error' }),
      'cli.workflow_reject_resume_failed'
    );
    expect(discoverSpy).not.toHaveBeenCalledWith(
      '/tmp/worktree-without-yaml',
      expect.any(Function)
    );
  });

  it('fails with recorded-rejection recovery when codebase row is missing during reject auto-resume', async () => {
    const workflowDb = await import('@archon/core/db/workflows');
    const codebaseDb = await import('@archon/core/db/codebases');
    const workflowDiscovery = await import('@archon/workflows/workflow-discovery');

    const runData = {
      id: 'run-reject-missing-codebase',
      workflow_name: 'my-approval-workflow',
      status: 'paused',
      user_message: 'go',
      working_path: '/tmp/worktree-without-yaml',
      codebase_id: 'cb-missing',
      metadata: {
        approval: {
          type: 'approval',
          nodeId: 'gate',
          message: 'Approve?',
          onRejectPrompt: 'Fix: $REJECTION_REASON',
          onRejectMaxAttempts: 3,
        },
        rejection_count: 0,
      },
    };
    (workflowDb.getWorkflowRun as ReturnType<typeof mock>).mockResolvedValueOnce(runData);
    (workflowDb.updateWorkflowRun as ReturnType<typeof mock>).mockResolvedValueOnce(undefined);
    const getCodebaseMock = codebaseDb.getCodebase as ReturnType<typeof mock>;
    getCodebaseMock.mockReset();
    getCodebaseMock.mockResolvedValueOnce(null);

    const discoverSpy = workflowDiscovery.discoverWorkflowsWithConfig as ReturnType<typeof mock>;
    discoverSpy.mockClear();

    await expect(
      workflowRejectCommand('run-reject-missing-codebase', 'needs work')
    ).rejects.toThrow(
      "Rejected but failed to resume workflow 'my-approval-workflow': Workflow run 'run-reject-missing-codebase' references codebase 'cb-missing', but that codebase no longer exists.\n" +
        'Cannot safely discover workflows from the run worktree because project workflow files may be missing.\n' +
        'Re-register the project or restore the codebase row, then retry.\n' +
        "The rejection was recorded. Run 'bun run cli workflow resume run-reject-missing-codebase' to retry."
    );
    expect(mockLogger.error).toHaveBeenCalledWith(
      expect.objectContaining({ runId: 'run-reject-missing-codebase' }),
      'cli.workflow_reject_resume_failed'
    );
    expect(discoverSpy).not.toHaveBeenCalledWith(
      '/tmp/worktree-without-yaml',
      expect.any(Function)
    );
  });

  it('should fall back to working_path for discovery on reject when codebase_id is missing', async () => {
    const workflowDb = await import('@archon/core/db/workflows');
    const workflowDiscovery = await import('@archon/workflows/workflow-discovery');

    const runData = {
      id: 'run-reject-no-codebase',
      workflow_name: 'legacy',
      status: 'paused',
      user_message: 'go',
      working_path: '/tmp/old-worktree',
      codebase_id: null,
      metadata: {
        approval: {
          type: 'approval',
          nodeId: 'gate',
          message: 'Approve?',
          onRejectPrompt: 'Fix: $REJECTION_REASON',
          onRejectMaxAttempts: 3,
        },
        rejection_count: 0,
      },
    };
    (workflowDb.getWorkflowRun as ReturnType<typeof mock>).mockResolvedValueOnce(runData);
    (workflowDb.updateWorkflowRun as ReturnType<typeof mock>).mockResolvedValueOnce(undefined);

    const discoverSpy = workflowDiscovery.discoverWorkflowsWithConfig as ReturnType<typeof mock>;
    discoverSpy.mockClear();
    discoverSpy.mockResolvedValueOnce({ workflows: [], errors: [] });

    try {
      await workflowRejectCommand('run-reject-no-codebase', 'bad');
    } catch {
      // downstream failure is acceptable
    }

    // No codebase → falls back to working_path (preserves existing behavior)
    expect(discoverSpy).toHaveBeenCalledWith('/tmp/old-worktree', expect.any(Function));
  });
});

describe('workflowRunCommand — progress rendering', () => {
  let consoleSpy: ReturnType<typeof spyOn>;
  let stderrSpy: ReturnType<typeof spyOn>;

  function setupWorkflowMocks(): void {
    // These need to be set up for each test since workflowRunCommand has many dependencies
    const discoverMock = require('@archon/workflows/workflow-discovery')
      .discoverWorkflowsWithConfig as ReturnType<typeof mock>;
    discoverMock.mockResolvedValueOnce({
      workflows: [makeTestWorkflowWithSource({ name: 'plan', description: 'Plan work' })],
      errors: [],
    });

    const conversationDb = require('@archon/core/db/conversations');
    (conversationDb.getOrCreateConversation as ReturnType<typeof mock>).mockResolvedValueOnce({
      id: 'conv-1',
      platform: 'cli',
      platform_conversation_id: 'cli-123',
      title: null,
      is_active: true,
      codebase_id: null,
    });

    const codebaseDb = require('@archon/core/db/codebases');
    (codebaseDb.findCodebaseByDefaultCwd as ReturnType<typeof mock>).mockResolvedValueOnce({
      id: 'cb-1',
      name: 'test-repo',
      default_cwd: '/test/path',
    });
  }

  beforeEach(() => {
    consoleSpy = spyOn(console, 'log').mockImplementation(() => {});
    stderrSpy = spyOn(process.stderr, 'write').mockImplementation(() => true);
    capturedSubscribeHandler = null;
    mockUnsubscribe.mockClear();
    mockLogger.info.mockClear();
    mockLogger.warn.mockClear();
  });

  afterEach(() => {
    consoleSpy.mockRestore();
    stderrSpy.mockRestore();
  });

  it('should subscribe to emitter when not quiet', async () => {
    setupWorkflowMocks();

    await workflowRunCommand('/test/path', 'plan', 'hello', {});

    // capturedSubscribeHandler is set when subscribeForConversation is called
    expect(capturedSubscribeHandler).not.toBeNull();
    expect(mockUnsubscribe).toHaveBeenCalledTimes(1);
  });

  it('should not subscribe to emitter when quiet', async () => {
    setupWorkflowMocks();

    await workflowRunCommand('/test/path', 'plan', 'hello', { quiet: true });

    // quiet = true skips subscription entirely
    expect(capturedSubscribeHandler).toBeNull();
    expect(mockUnsubscribe).not.toHaveBeenCalled();
  });

  it('should call unsubscribe after executeWorkflow completes', async () => {
    setupWorkflowMocks();

    await workflowRunCommand('/test/path', 'plan', 'hello', {});

    expect(mockUnsubscribe).toHaveBeenCalledTimes(1);
  });

  it('should write node_started event to stderr', async () => {
    setupWorkflowMocks();

    const { executeWorkflow } = require('@archon/workflows/executor');
    (executeWorkflow as ReturnType<typeof mock>).mockImplementationOnce(async () => {
      if (capturedSubscribeHandler) {
        capturedSubscribeHandler({
          type: 'node_started',
          runId: 'run-1',
          nodeId: 'classify',
          nodeName: 'classify',
        });
      }
      return { success: true, workflowRunId: 'run-1' };
    });

    await workflowRunCommand('/test/path', 'plan', 'hello', {});

    expect(stderrSpy).toHaveBeenCalledWith('[classify] Started\n');
  });

  it('should write node_completed event with duration to stderr', async () => {
    setupWorkflowMocks();

    const { executeWorkflow } = require('@archon/workflows/executor');
    (executeWorkflow as ReturnType<typeof mock>).mockImplementationOnce(async () => {
      if (capturedSubscribeHandler) {
        capturedSubscribeHandler({
          type: 'node_completed',
          runId: 'run-1',
          nodeId: 'classify',
          nodeName: 'classify',
          duration: 12400,
        });
      }
      return { success: true, workflowRunId: 'run-1' };
    });

    await workflowRunCommand('/test/path', 'plan', 'hello', {});

    expect(stderrSpy).toHaveBeenCalledWith('[classify] Completed (12.4s)\n');
  });

  it('should write node_failed event to stderr', async () => {
    setupWorkflowMocks();

    const { executeWorkflow } = require('@archon/workflows/executor');
    (executeWorkflow as ReturnType<typeof mock>).mockImplementationOnce(async () => {
      if (capturedSubscribeHandler) {
        capturedSubscribeHandler({
          type: 'node_failed',
          runId: 'run-1',
          nodeId: 'classify',
          nodeName: 'classify',
          error: 'timeout exceeded',
        });
      }
      return { success: true, workflowRunId: 'run-1' };
    });

    await workflowRunCommand('/test/path', 'plan', 'hello', {});

    expect(stderrSpy).toHaveBeenCalledWith('[classify] Failed: timeout exceeded\n');
  });

  it('should write node_skipped event to stderr', async () => {
    setupWorkflowMocks();

    const { executeWorkflow } = require('@archon/workflows/executor');
    (executeWorkflow as ReturnType<typeof mock>).mockImplementationOnce(async () => {
      if (capturedSubscribeHandler) {
        capturedSubscribeHandler({
          type: 'node_skipped',
          runId: 'run-1',
          nodeId: 'deploy',
          nodeName: 'deploy',
          reason: 'when_condition',
        });
      }
      return { success: true, workflowRunId: 'run-1' };
    });

    await workflowRunCommand('/test/path', 'plan', 'hello', {});

    expect(stderrSpy).toHaveBeenCalledWith('[deploy] Skipped (when_condition)\n');
  });

  it('should write approval_pending event to stderr', async () => {
    setupWorkflowMocks();

    const { executeWorkflow } = require('@archon/workflows/executor');
    (executeWorkflow as ReturnType<typeof mock>).mockImplementationOnce(async () => {
      if (capturedSubscribeHandler) {
        capturedSubscribeHandler({
          type: 'approval_pending',
          runId: 'run-1',
          nodeId: 'review',
          message: 'Please review the changes',
        });
      }
      return { success: true, workflowRunId: 'run-1', paused: true };
    });

    await workflowRunCommand('/test/path', 'plan', 'hello', {});

    expect(stderrSpy).toHaveBeenCalledWith(
      '[review] Waiting for approval: Please review the changes\n'
    );
  });

  it('should not write tool_started without verbose', async () => {
    setupWorkflowMocks();

    const { executeWorkflow } = require('@archon/workflows/executor');
    (executeWorkflow as ReturnType<typeof mock>).mockImplementationOnce(async () => {
      if (capturedSubscribeHandler) {
        capturedSubscribeHandler({
          type: 'tool_started',
          runId: 'run-1',
          toolName: 'Bash',
          stepName: 'classify',
        });
      }
      return { success: true, workflowRunId: 'run-1' };
    });

    await workflowRunCommand('/test/path', 'plan', 'hello', {});

    expect(stderrSpy).not.toHaveBeenCalledWith(expect.stringContaining('tool: Bash'));
  });

  it('should write tool_started with verbose', async () => {
    setupWorkflowMocks();

    const { executeWorkflow } = require('@archon/workflows/executor');
    (executeWorkflow as ReturnType<typeof mock>).mockImplementationOnce(async () => {
      if (capturedSubscribeHandler) {
        capturedSubscribeHandler({
          type: 'tool_started',
          runId: 'run-1',
          toolName: 'Bash',
          stepName: 'classify',
        });
        capturedSubscribeHandler({
          type: 'tool_completed',
          runId: 'run-1',
          toolName: 'Bash',
          stepName: 'classify',
          durationMs: 42,
        });
      }
      return { success: true, workflowRunId: 'run-1' };
    });

    await workflowRunCommand('/test/path', 'plan', 'hello', { verbose: true });

    expect(stderrSpy).toHaveBeenCalledWith('[classify] tool: Bash (started)\n');
    expect(stderrSpy).toHaveBeenCalledWith('[classify] tool: Bash (42ms)\n');
  });

  it('should call unsubscribe even when executeWorkflow throws', async () => {
    setupWorkflowMocks();

    const { executeWorkflow } = require('@archon/workflows/executor');
    (executeWorkflow as ReturnType<typeof mock>).mockImplementationOnce(async () => {
      throw new Error('executor crashed');
    });

    await expect(workflowRunCommand('/test/path', 'plan', 'hello', {})).rejects.toThrow(
      'executor crashed'
    );

    expect(mockUnsubscribe).toHaveBeenCalledTimes(1);
  });

  it('should write node_completed with sub-second duration to stderr', async () => {
    setupWorkflowMocks();

    const { executeWorkflow } = require('@archon/workflows/executor');
    (executeWorkflow as ReturnType<typeof mock>).mockImplementationOnce(async () => {
      if (capturedSubscribeHandler) {
        capturedSubscribeHandler({
          type: 'node_completed',
          runId: 'run-1',
          nodeId: 'fast',
          nodeName: 'fast',
          duration: 500,
        });
      }
      return { success: true, workflowRunId: 'run-1' };
    });

    await workflowRunCommand('/test/path', 'plan', 'hello', {});

    expect(stderrSpy).toHaveBeenCalledWith('[fast] Completed (500ms)\n');
  });

  it('should write node_completed with minutes duration to stderr', async () => {
    setupWorkflowMocks();

    const { executeWorkflow } = require('@archon/workflows/executor');
    (executeWorkflow as ReturnType<typeof mock>).mockImplementationOnce(async () => {
      if (capturedSubscribeHandler) {
        capturedSubscribeHandler({
          type: 'node_completed',
          runId: 'run-1',
          nodeId: 'slow',
          nodeName: 'slow',
          duration: 90000,
        });
      }
      return { success: true, workflowRunId: 'run-1' };
    });

    await workflowRunCommand('/test/path', 'plan', 'hello', {});

    expect(stderrSpy).toHaveBeenCalledWith('[slow] Completed (1m30s)\n');
  });
});

// ---------------------------------------------------------------------------
// extractStaleWorkspaceEntry — parser edge cases
// ---------------------------------------------------------------------------

describe('extractStaleWorkspaceEntry', () => {
  it('extracts the workspace dir from a POSIX source-symlink error', async () => {
    const { extractStaleWorkspaceEntry } = await import('./workflow');
    expect(
      extractStaleWorkspaceEntry(
        'Source symlink at /home/user/.archon/workspaces/acme/widget/source already points to /other, expected /here'
      )
    ).toBe('/home/user/.archon/workspaces/acme/widget');
  });

  it('extracts the workspace dir from a Windows source-symlink error (backslash sep)', async () => {
    const { extractStaleWorkspaceEntry } = await import('./workflow');
    expect(
      extractStaleWorkspaceEntry(
        'Source symlink at C:\\Users\\me\\.archon\\workspaces\\acme\\widget\\source already points to D:\\x, expected D:\\y'
      )
    ).toBe('C:\\Users\\me\\.archon\\workspaces\\acme\\widget');
  });

  it('returns null when the prefix does not match (unrelated error)', async () => {
    const { extractStaleWorkspaceEntry } = await import('./workflow');
    expect(extractStaleWorkspaceEntry('ENOENT: no such file or directory')).toBeNull();
  });

  it('returns null when the prefix matches but the delimiter is missing', async () => {
    const { extractStaleWorkspaceEntry } = await import('./workflow');
    expect(
      extractStaleWorkspaceEntry('Source symlink at /some/path (truncated message)')
    ).toBeNull();
  });

  it('returns null when the source path has no path separator at all', async () => {
    const { extractStaleWorkspaceEntry } = await import('./workflow');
    expect(
      extractStaleWorkspaceEntry('Source symlink at bareword already points to /x, expected /y')
    ).toBeNull();
  });

  it('returns null on an empty input', async () => {
    const { extractStaleWorkspaceEntry } = await import('./workflow');
    expect(extractStaleWorkspaceEntry('')).toBeNull();
  });
});

describe('workflowResetSessionsCommand', () => {
  let consoleSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    consoleSpy = spyOn(console, 'log').mockImplementation(() => {});
    mockDeleteNodeSessions.mockClear();
    mockDeleteNodeSessions.mockResolvedValue({ deleted: 0 });
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  it('refuses a cross-scope reset without --scope and without --yes', async () => {
    await expect(workflowResetSessionsCommand('feature-dev', {})).rejects.toThrow(/Refusing/);
    expect(mockDeleteNodeSessions).not.toHaveBeenCalled();
  });

  it('proceeds across all scopes when --yes is given (no scope filter)', async () => {
    mockDeleteNodeSessions.mockResolvedValueOnce({ deleted: 4 });

    await workflowResetSessionsCommand('feature-dev', { yes: true });

    expect(mockDeleteNodeSessions).toHaveBeenCalledWith({
      workflow_name: 'feature-dev',
      scope_key: undefined,
      node_id: undefined,
    });
    const calls = consoleSpy.mock.calls.map((c: unknown[]) => String(c[0]));
    expect(calls.some(c => c.includes('4') && c.includes('across all scopes'))).toBe(true);
  });

  it('proceeds with --scope and no --yes, narrowing to that scope', async () => {
    mockDeleteNodeSessions.mockResolvedValueOnce({ deleted: 1 });

    await workflowResetSessionsCommand('feature-dev', { scope: 'conv-1', node: 'planner' });

    expect(mockDeleteNodeSessions).toHaveBeenCalledWith({
      workflow_name: 'feature-dev',
      scope_key: 'conv-1',
      node_id: 'planner',
    });
  });

  it('emits machine-readable JSON when --json is set', async () => {
    mockDeleteNodeSessions.mockResolvedValueOnce({ deleted: 2 });

    await workflowResetSessionsCommand('feature-dev', { scope: 'conv-1', json: true });

    expect(consoleSpy).toHaveBeenCalledWith(
      JSON.stringify({ workflow: 'feature-dev', deleted: 2, scope: 'conv-1', node: null })
    );
  });
});

describe('workflowRetryNodeCommand', () => {
  it.todo('parses workflow retry-node <run-id> <node-id> and streams retry execution', () => {});
  it.todo('prints human-readable retry scope, safety ref, and reset feedback', () => {});
  it.todo('emits machine-readable JSON without inline auto-resume when --json is set', () => {});
  it.todo('emits {ok:false} JSON when retry-node is rejected in --json mode', () => {});
  it.todo('accepts retry-node only when cwd matches the run codebase or worktree path', () => {});
  it.todo(
    'rejects retry-node when cwd does not match the run codebase or worktree contracts',
    () => {}
  );
});
