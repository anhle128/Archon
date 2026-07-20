import { describe, test, expect, spyOn, mock } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// RED-PHASE SCAFFOLD (MIXED) — Story 3.3b "Provide Archon Start And Status
// CLI JSON", Task 4's "companion contract test (mirroring
// provider-binding-contract.test.ts's pattern)". This file is its own
// isolated `bun test` invocation in packages/cli/package.json specifically
// because it declares its OWN `mock.module()` set for the same modules
// workflow.test.ts mocks — running it inside that file's invocation would
// risk `mock.module()` pollution (project rule: "When adding tests that mock
// the same module differently, place them in a separate test invocation").
//
// CONTRACT-039/040 need no application mocks at all (pure fixture/source
// scans, like provider-binding-contract.test.ts). CONTRACT-036/037 invoke
// the real `workflowRunCommand`/`workflowGetCommand` against mocked
// dependencies to inspect the ACTUAL emitted JSON — this deliberately avoids
// a vacuous pass: today's output is human text / the legacy `{ok:false}`
// shape, not an envelope, so asserting `schemaVersion` genuinely fails.

const CONTRACTS_ROOT = join(
  import.meta.dir,
  '../../../../_bmad-output/planning-artifacts/contracts/workflow-commander'
);
const VALIDATOR = join(CONTRACTS_ROOT, 'validate_contracts.py');
const COMMANDS_DIR = join(CONTRACTS_ROOT, 'examples/providers/archon/commands');

// ---------------------------------------------------------------------------
// Mock scaffolding — mirrors workflow.test.ts's top-of-file mocks. Declared
// independently here (this file's own isolated bun test invocation) rather
// than imported, so this file has no coupling to workflow.test.ts's mock
// lifecycle.
// ---------------------------------------------------------------------------
const mockLogger = {
  fatal: mock(() => undefined),
  error: mock(() => undefined),
  warn: mock(() => undefined),
  info: mock(() => undefined),
  debug: mock(() => undefined),
  trace: mock(() => undefined),
  child: mock(() => mockLogger),
};

mock.module('@archon/paths', () => ({
  captureApprovalResolved: () => undefined,
  createLogger: mock(() => mockLogger),
  getArchonHome: mock(() => '/home/test/.archon'),
  BUNDLED_IS_BINARY: false,
}));

const actualFs = await import('node:fs');
mock.module('node:fs', () => ({
  ...actualFs,
  existsSync: mock(() => true),
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
  createWorkflowStore: mock(() => ({ createWorkflowEvent: mock(() => Promise.resolve()) })),
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
    subscribeForConversation: mock(() => mock(() => undefined)),
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
  execFileAsync: mock(() => Promise.resolve({ stdout: '.git\n', stderr: '' })),
}));
mock.module('@archon/core/db/conversations', () => ({
  getOrCreateConversation: mock(() => Promise.resolve({ id: 'conv-contract' })),
  getConversationById: mock(() => Promise.resolve(null)),
  updateConversation: mock(() => Promise.resolve()),
}));
mock.module('@archon/core/db/codebases', () => ({
  findCodebaseByDefaultCwd: mock(() => Promise.resolve(null)),
  getCodebase: mock(() =>
    Promise.resolve({
      id: 'cb-default',
      name: 'test/repo',
      repository_url: null,
      default_cwd: '/tmp/repo',
      commands: {},
    })
  ),
}));
mock.module('@archon/core/db/isolation-environments', () => ({
  findActiveByWorkflow: mock(() => Promise.resolve(null)),
  create: mock(() => Promise.resolve({ id: 'iso-contract' })),
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
  resolveApprovalGate: mock(() => Promise.resolve({ resolved: true })),
  resolveAndCancelApprovalGate: mock(() => Promise.resolve({ resolved: true })),
  findWorkflowRunsByIdPrefix: mock(() => Promise.resolve([])),
  listWorkflowRuns: mock(() => Promise.resolve([])),
}));
mock.module('@archon/core/db/workflow-events', () => ({
  listWorkflowEvents: mock(() => Promise.resolve([])),
  createWorkflowEvent: mock(() => Promise.resolve()),
}));

const mockChildProcessSpawn = mock(() => ({
  pid: 99999,
  on: mock(() => undefined),
  unref: mock(() => undefined),
}));
mock.module('node:child_process', () => ({
  spawn: mockChildProcessSpawn,
}));

import { makeTestWorkflowWithSource } from '@archon/workflows/test-utils';
import { workflowRunCommand, workflowGetCommand } from './workflow';

// Forbidden per Story 3.3a's closed-schema convention (RC-16, security/
// compatibility): Hermes-internal / actor-identity keys must never appear in
// an emitted envelope. Same list used by provider-binding.test.ts's
// "security / compatibility (no forbidden fields)" check, plus the
// text-diagnostic keys this story's Dev Notes call out (NFR-14: no raw
// message/stdout/stderr/displayText in details).
const FORBIDDEN_KEYS = /^(actor|secret|profile|agent_name|agent|agent_provider)$/i;
const FORBIDDEN_TEXT_KEYS = /^(message|stdout|stderr|displaytext)$/i;

function scanForForbiddenKeys(value: unknown, path: string[] = []): string[] {
  const hits: string[] = [];
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
      if (FORBIDDEN_KEYS.test(key) || FORBIDDEN_TEXT_KEYS.test(key)) {
        hits.push([...path, key].join('.'));
      }
      hits.push(...scanForForbiddenKeys(v, [...path, key]));
    }
  } else if (Array.isArray(value)) {
    value.forEach((v, i) => hits.push(...scanForForbiddenKeys(v, [...path, String(i)])));
  }
  return hits;
}

describe('3.3B-CONTRACT-036 [P0] forbidden-key scan on parsed emitted envelopes (R-008, R-016)', () => {
  test('a workflow.start success envelope parses as a real envelope and contains no forbidden key', async () => {
    const { discoverWorkflowsWithConfig } = await import('@archon/workflows/workflow-discovery');
    (discoverWorkflowsWithConfig as ReturnType<typeof mock>).mockResolvedValueOnce({
      workflows: [makeTestWorkflowWithSource({ name: 'assist', description: 'Help' })],
      errors: [],
    });
    const workflowDb = await import('@archon/core/db/workflows');
    (workflowDb.getWorkflowRun as ReturnType<typeof mock>).mockResolvedValueOnce({
      id: 'test-run-id',
      workflow_name: 'assist',
      status: 'completed',
      codebase_id: null,
      working_path: '/test/path',
      started_at: new Date(),
      metadata: {},
    });

    const consoleSpy = spyOn(console, 'log').mockImplementation(() => {});
    try {
      await workflowRunCommand('/test/path', 'assist', 'hello', { json: true, noWorktree: true });
      const raw = String((consoleSpy.mock.calls[0] as unknown[] | undefined)?.[0]);
      const envelope = JSON.parse(raw) as Record<string, unknown>;
      expect(envelope.success).toBe(true);
      expect(envelope.schemaVersion).toBe('workflow-command-envelope.v1');
      expect(scanForForbiddenKeys(envelope)).toEqual([]);
    } finally {
      consoleSpy.mockRestore();
    }
  });

  test('a workflow.status not-found envelope parses as a real envelope and contains no forbidden key', async () => {
    const consoleSpy = spyOn(console, 'log').mockImplementation(() => {});
    try {
      await workflowGetCommand('does-not-exist', true);
      const raw = String((consoleSpy.mock.calls[0] as unknown[] | undefined)?.[0]);
      const envelope = JSON.parse(raw) as Record<string, unknown>;
      expect(envelope.success).toBe(false);
      expect(envelope.schemaVersion).toBe('workflow-command-envelope.v1');
      expect(scanForForbiddenKeys(envelope)).toEqual([]);
    } finally {
      consoleSpy.mockRestore();
    }
  });

  test('a verbose workflow.status success envelope sanitizes forbidden keys from event data (RF-21)', async () => {
    const workflowDb = await import('@archon/core/db/workflows');
    (workflowDb.getWorkflowRun as ReturnType<typeof mock>).mockResolvedValueOnce({
      id: 'test-run-verbose',
      workflow_name: 'assist',
      status: 'completed',
      codebase_id: null,
      working_path: '/test/path',
      started_at: new Date(),
      metadata: {},
    });
    const workflowEventsDb = await import('@archon/core/db/workflow-events');
    (workflowEventsDb.listWorkflowEvents as ReturnType<typeof mock>).mockResolvedValueOnce([
      {
        id: 'evt-1',
        workflow_run_id: 'test-run-verbose',
        conversation_id: 'conv-1',
        event_type: 'step_started',
        data: { message: 'should be stripped', stdout: 'also stripped', nodeId: 'step-1' },
        created_at: new Date(),
      },
      {
        id: 'evt-2',
        workflow_run_id: 'test-run-verbose',
        conversation_id: 'conv-1',
        event_type: 'step_completed',
        data: { nested: { agent: 'should-be-stripped', displayText: 'also stripped' }, ok: true },
        created_at: new Date(),
      },
      {
        id: 'evt-3',
        workflow_run_id: 'test-run-verbose',
        conversation_id: 'conv-1',
        event_type: 'step_completed',
        data: {
          nestedArray: [
            [{ message: 'strip from nested array', keep: true }],
            { stderr: 'strip from array object', nested: [{ stdout: 'strip deeply', ok: true }] },
          ],
        },
        created_at: new Date(),
      },
    ]);

    const consoleSpy = spyOn(console, 'log').mockImplementation(() => {});
    try {
      await workflowGetCommand('test-run-verbose', true, true);
      const raw = String((consoleSpy.mock.calls[0] as unknown[] | undefined)?.[0]);
      const envelope = JSON.parse(raw) as Record<string, unknown>;
      expect(envelope.success).toBe(true);
      expect(envelope.schemaVersion).toBe('workflow-command-envelope.v1');
      expect(scanForForbiddenKeys(envelope)).toEqual([]);
      const result = envelope.result as Record<string, unknown>;
      expect(Array.isArray(result.events)).toBe(true);
      const events = result.events as Array<Record<string, unknown>>;
      expect(events).toHaveLength(3);
      expect(JSON.stringify(events[2])).toContain('"keep":true');
      expect(JSON.stringify(events[2])).not.toContain('strip from nested array');
      expect(JSON.stringify(events[2])).not.toContain('strip from array object');
      expect(JSON.stringify(events[2])).not.toContain('strip deeply');
    } finally {
      consoleSpy.mockRestore();
    }
  });
});

describe('3.3B-CONTRACT-037 [P1] fixture conformance with the documented field delta (R-014, W-3.3B-002)', () => {
  test('start-success.json fixture keeps its illustrative phase/projectBindingRef fields (fixture itself is untouched)', () => {
    const fixture = JSON.parse(
      readFileSync(join(COMMANDS_DIR, 'start-success.json'), 'utf8')
    ) as Record<string, unknown>;
    const result = fixture.result as Record<string, unknown>;
    // This documents the CONTRACT fixture is unmodified (Dev Notes: never
    // edit contract fixtures) — it is not a claim that runtime output must
    // reproduce `phase`/`projectBindingRef` (W-3.3B-002 explicitly waives
    // that byte-for-byte parity).
    expect(typeof result.phase).toBe('string');
    expect(typeof result.projectBindingRef).toBe('object');
  });

  test('a real workflow.start success envelope intentionally omits phase and projectBindingRef (no fake values)', async () => {
    const { discoverWorkflowsWithConfig } = await import('@archon/workflows/workflow-discovery');
    (discoverWorkflowsWithConfig as ReturnType<typeof mock>).mockResolvedValueOnce({
      workflows: [makeTestWorkflowWithSource({ name: 'assist', description: 'Help' })],
      errors: [],
    });
    const workflowDb = await import('@archon/core/db/workflows');
    (workflowDb.getWorkflowRun as ReturnType<typeof mock>).mockResolvedValueOnce({
      id: 'test-run-id',
      workflow_name: 'assist',
      status: 'completed',
      codebase_id: null,
      working_path: '/test/path',
      started_at: new Date(),
      metadata: {},
    });

    const consoleSpy = spyOn(console, 'log').mockImplementation(() => {});
    try {
      await workflowRunCommand('/test/path', 'assist', 'hello', { json: true, noWorktree: true });
      const raw = String((consoleSpy.mock.calls[0] as unknown[] | undefined)?.[0]);
      // Genuinely red today: JSON.parse throws on today's human-text stdout.
      const envelope = JSON.parse(raw) as Record<string, unknown>;
      const result = (envelope.result ?? {}) as Record<string, unknown>;
      expect('phase' in result).toBe(false);
      expect('projectBindingRef' in result).toBe(false);
    } finally {
      consoleSpy.mockRestore();
    }
  });
});

describe('3.3B-CONTRACT-038 [P1] workflow.ts consumes the shared envelope module rather than reimplementing it (R-016)', () => {
  // Mirrors 3.3A-UNIT-031's pattern in provider-binding-contract.test.ts:
  // this is a source-scan regression lock, not a missing-module scaffold.
  // Today `workflow.ts` does not build envelopes at all, so this currently
  // passes vacuously — it becomes a real lock once Task 1/2 land and must
  // keep passing (no local reimplementation of buildSuccessEnvelope etc.).
  test('workflow.ts does not locally redefine buildSuccessEnvelope/buildErrorEnvelope/safeStringify/resolveCorrelationId/resolveIssuedAt', () => {
    const content = readFileSync(join(import.meta.dir, './workflow.ts'), 'utf8');
    const localHelperDeclarations = [
      'function buildSuccessEnvelope(',
      'function buildErrorEnvelope(',
      'function safeStringify(',
      'function resolveCorrelationId(',
      'function resolveIssuedAt(',
    ];
    for (const declaration of localHelperDeclarations) {
      expect(content).not.toContain(declaration);
    }
  });

  test('the shared envelope module workflow-provider-command-envelope.ts is unmodified by this story (regression gate)', async () => {
    const proc = Bun.spawn(
      ['bun', 'test', 'src/commands/workflow-provider-command-envelope.test.ts'],
      {
        cwd: join(import.meta.dir, '..', '..'),
        stdout: 'pipe',
        stderr: 'pipe',
      }
    );
    const [stdout, exitCode] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);
    expect(exitCode).toBe(0);
    expect(stdout).not.toContain('(fail)');
  });
});

describe('3.3B-CONTRACT-039 [P0] canonical validator passes unchanged (R-001, RC-27)', () => {
  test('validate_contracts.py passes and no contract file was edited by this story', async () => {
    const proc = Bun.spawn(['python3', VALIDATOR], { stdout: 'pipe', stderr: 'pipe' });
    const [stdout, exitCode] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain('contract validation passed');
  });
});

describe('3.3B-CONTRACT-040 [P1] no contract edits / no runtime _bmad-output import (R-016, R-020)', () => {
  test('workflow.ts does not import from `_bmad-output` at runtime', () => {
    const content = readFileSync(join(import.meta.dir, './workflow.ts'), 'utf8');
    expect(content).not.toContain('_bmad-output');
  });

  test('cli.ts does not import from `_bmad-output` at runtime', () => {
    const content = readFileSync(join(import.meta.dir, '..', 'cli.ts'), 'utf8');
    expect(content).not.toContain('_bmad-output');
  });
});

// ---------------------------------------------------------------------------
// RED-PHASE SCAFFOLD — Story 3.3c "Provide Archon Provider Decision Command
// CLI JSON". Contract tests for approve/reject envelope forbidden-key scans
// and fixture delta documentation.
//
// These extend the existing 3.3b contract test pattern: invoke the real
// command functions against mocked deps, parse the emitted JSON, and verify
// contract compliance. Skipped because the envelope conversion does not exist
// yet — today's output is the legacy `{ok:true/false}` shape without
// `schemaVersion`.
//
// ACTIVATION: remove `.skip` once workflowApproveCommand/workflowRejectCommand
// JSON branches emit buildSuccessEnvelope/buildErrorEnvelope envelopes.
// ---------------------------------------------------------------------------

import { workflowApproveCommand, workflowRejectCommand } from './workflow';

describe('3.3C-CONTRACT-001 [P0] forbidden-key scan on approve/reject envelopes (AC #2)', () => {
  test('a workflow.approve success envelope contains no forbidden key', async () => {
    // ACTIVATION: workflowApproveCommand JSON branch emits shared envelope
    const workflowDb = await import('@archon/core/db/workflows');
    (workflowDb.getWorkflowRun as ReturnType<typeof mock>).mockResolvedValueOnce({
      id: 'run-contract-ap',
      workflow_name: 'assist',
      status: 'paused',
      working_path: '/tmp/wt',
      codebase_id: null,
      user_message: 'go',
      metadata: { approval: { type: 'approval', nodeId: 'gate', message: 'ok?' } },
    });
    (workflowDb.getWorkflowRun as ReturnType<typeof mock>).mockResolvedValueOnce({
      id: 'run-contract-ap',
      workflow_name: 'assist',
      status: 'paused',
      codebase_id: null,
      working_path: '/tmp/wt',
      metadata: { approval: { type: 'approval', nodeId: 'gate', resolved: 'approved' } },
    });

    const consoleSpy = spyOn(console, 'log').mockImplementation(() => {});
    try {
      await workflowApproveCommand('run-contract-ap', 'lgtm', true);
      const raw = String((consoleSpy.mock.calls[0] as unknown[] | undefined)?.[0]);
      const envelope = JSON.parse(raw) as Record<string, unknown>;
      expect(envelope.success).toBe(true);
      expect(envelope.schemaVersion).toBe('workflow-command-envelope.v1');
      expect(scanForForbiddenKeys(envelope)).toEqual([]);
    } finally {
      consoleSpy.mockRestore();
    }
  });

  test('a workflow.approve error envelope contains no forbidden key', async () => {
    // ACTIVATION: workflowApproveCommand JSON error path emits buildErrorEnvelope
    const workflowDb = await import('@archon/core/db/workflows');
    (workflowDb.getWorkflowRun as ReturnType<typeof mock>).mockResolvedValueOnce(null);

    const consoleSpy = spyOn(console, 'log').mockImplementation(() => {});
    try {
      await workflowApproveCommand('nonexistent', undefined, true);
      const raw = String((consoleSpy.mock.calls[0] as unknown[] | undefined)?.[0]);
      const envelope = JSON.parse(raw) as Record<string, unknown>;
      expect(envelope.success).toBe(false);
      expect(envelope.schemaVersion).toBe('workflow-command-envelope.v1');
      expect(scanForForbiddenKeys(envelope)).toEqual([]);
    } finally {
      consoleSpy.mockRestore();
    }
  });

  test('a workflow.reject success envelope contains no forbidden key', async () => {
    // ACTIVATION: workflowRejectCommand JSON branch emits shared envelope
    const workflowDb = await import('@archon/core/db/workflows');
    (workflowDb.getWorkflowRun as ReturnType<typeof mock>).mockResolvedValueOnce({
      id: 'run-contract-rj',
      workflow_name: 'assist',
      status: 'paused',
      working_path: '/tmp/wt',
      codebase_id: null,
      user_message: 'go',
      metadata: { approval: { type: 'approval', nodeId: 'gate', message: 'ok?' } },
    });
    (workflowDb.getWorkflowRun as ReturnType<typeof mock>).mockResolvedValueOnce({
      id: 'run-contract-rj',
      workflow_name: 'assist',
      status: 'cancelled',
      codebase_id: null,
      working_path: '/tmp/wt',
      metadata: {},
    });

    const consoleSpy = spyOn(console, 'log').mockImplementation(() => {});
    try {
      await workflowRejectCommand('run-contract-rj', 'nope', true);
      const raw = String((consoleSpy.mock.calls[0] as unknown[] | undefined)?.[0]);
      const envelope = JSON.parse(raw) as Record<string, unknown>;
      expect(envelope.success).toBe(true);
      expect(envelope.schemaVersion).toBe('workflow-command-envelope.v1');
      expect(scanForForbiddenKeys(envelope)).toEqual([]);
    } finally {
      consoleSpy.mockRestore();
    }
  });

  test('a workflow.reject error envelope contains no forbidden key', async () => {
    // ACTIVATION: workflowRejectCommand JSON error path emits buildErrorEnvelope
    const workflowDb = await import('@archon/core/db/workflows');
    (workflowDb.getWorkflowRun as ReturnType<typeof mock>).mockResolvedValueOnce(null);

    const consoleSpy = spyOn(console, 'log').mockImplementation(() => {});
    try {
      await workflowRejectCommand('nonexistent-rj', 'nope', true);
      const raw = String((consoleSpy.mock.calls[0] as unknown[] | undefined)?.[0]);
      const envelope = JSON.parse(raw) as Record<string, unknown>;
      expect(envelope.success).toBe(false);
      expect(envelope.schemaVersion).toBe('workflow-command-envelope.v1');
      expect(scanForForbiddenKeys(envelope)).toEqual([]);
    } finally {
      consoleSpy.mockRestore();
    }
  });
});

describe('3.3C-CONTRACT-002 [P1] fixture delta documentation (AC #1, W-3.3C-001)', () => {
  test('approve-success.json fixture has decision.gateId (BMAD-specific, intentionally omitted by Archon)', () => {
    const fixture = JSON.parse(
      readFileSync(join(COMMANDS_DIR, 'approve-success.json'), 'utf8')
    ) as Record<string, unknown>;
    const result = fixture.result as Record<string, unknown>;
    const decision = result.decision as Record<string, unknown>;
    // The fixture's gateId is a BMAD-specific concept. Archon's envelopes
    // intentionally omit it (result is "additionalProperties": true).
    expect(typeof decision.gateId).toBe('string');
  });

  test('reject-success.json fixture has nextPhase (BMAD-specific, intentionally omitted by Archon)', () => {
    const fixture = JSON.parse(
      readFileSync(join(COMMANDS_DIR, 'reject-success.json'), 'utf8')
    ) as Record<string, unknown>;
    const result = fixture.result as Record<string, unknown>;
    // The fixture's nextPhase is a BMAD-specific concept. Archon has no generic
    // "phase" concept and intentionally omits it.
    expect(typeof result.nextPhase).toBe('string');
  });

  test('a real workflow.approve success envelope intentionally omits decision.gateId and does not fabricate it', async () => {
    // ACTIVATION: workflowApproveCommand JSON branch emits shared envelope
    const workflowDb = await import('@archon/core/db/workflows');
    (workflowDb.getWorkflowRun as ReturnType<typeof mock>).mockResolvedValueOnce({
      id: 'run-delta-ap',
      workflow_name: 'assist',
      status: 'paused',
      working_path: '/tmp/wt',
      codebase_id: null,
      user_message: 'go',
      metadata: { approval: { type: 'approval', nodeId: 'gate', message: 'ok?' } },
    });
    (workflowDb.getWorkflowRun as ReturnType<typeof mock>).mockResolvedValueOnce({
      id: 'run-delta-ap',
      workflow_name: 'assist',
      status: 'paused',
      codebase_id: null,
      working_path: '/tmp/wt',
      metadata: { approval: { type: 'approval', nodeId: 'gate', resolved: 'approved' } },
    });

    const consoleSpy = spyOn(console, 'log').mockImplementation(() => {});
    try {
      await workflowApproveCommand('run-delta-ap', undefined, true);
      const raw = String((consoleSpy.mock.calls[0] as unknown[] | undefined)?.[0]);
      const envelope = JSON.parse(raw) as Record<string, unknown>;
      const result = (envelope.result ?? {}) as Record<string, unknown>;
      const decision = (result.decision ?? {}) as Record<string, unknown>;
      expect('gateId' in decision).toBe(false);
    } finally {
      consoleSpy.mockRestore();
    }
  });

  test('a real workflow.reject success envelope intentionally omits nextPhase and does not fabricate it', async () => {
    // ACTIVATION: workflowRejectCommand JSON branch emits shared envelope
    const workflowDb = await import('@archon/core/db/workflows');
    (workflowDb.getWorkflowRun as ReturnType<typeof mock>).mockResolvedValueOnce({
      id: 'run-delta-rj',
      workflow_name: 'assist',
      status: 'paused',
      working_path: '/tmp/wt',
      codebase_id: null,
      user_message: 'go',
      metadata: { approval: { type: 'approval', nodeId: 'gate', message: 'ok?' } },
    });
    (workflowDb.getWorkflowRun as ReturnType<typeof mock>).mockResolvedValueOnce({
      id: 'run-delta-rj',
      workflow_name: 'assist',
      status: 'cancelled',
      codebase_id: null,
      working_path: '/tmp/wt',
      metadata: {},
    });

    const consoleSpy = spyOn(console, 'log').mockImplementation(() => {});
    try {
      await workflowRejectCommand('run-delta-rj', 'nope', true);
      const raw = String((consoleSpy.mock.calls[0] as unknown[] | undefined)?.[0]);
      const envelope = JSON.parse(raw) as Record<string, unknown>;
      const result = (envelope.result ?? {}) as Record<string, unknown>;
      expect('nextPhase' in result).toBe(false);
    } finally {
      consoleSpy.mockRestore();
    }
  });
});

describe('3.3C-CONTRACT-003 [P1] canonical validator still passes (regression)', () => {
  test('validate_contracts.py passes and no contract file was edited by this story', async () => {
    const proc = Bun.spawn(['python3', VALIDATOR], { stdout: 'pipe', stderr: 'pipe' });
    const [stdout, exitCode] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain('contract validation passed');
  });
});

// ---------------------------------------------------------------------------
// RF6/RF8: Runtime schema validation — validates emitted envelopes against the
// ACTUAL workflow-command-envelope.schema.json by reading the file and driving
// validation from its required[], oneOf, allOf, and $defs constraints. This is
// distinct from the forbidden-key scan (CONTRACT-001) and the fixture validator
// (CONTRACT-003, which validates static fixtures, not runtime output).
// ---------------------------------------------------------------------------

const RUNTIME_VALIDATOR = join(import.meta.dir, 'test-helpers', 'validate_runtime_envelope.py');

async function validateRuntimeEnvelope(envelope: Record<string, unknown>): Promise<string[]> {
  const tmpFile = join(
    tmpdir(),
    `archon-envelope-${Date.now()}-${Math.random().toString(36).slice(2)}.json`
  );
  const { writeFileSync, unlinkSync } = await import('node:fs');
  writeFileSync(tmpFile, JSON.stringify(envelope));
  try {
    const proc = Bun.spawn(['python3', RUNTIME_VALIDATOR, tmpFile], {
      stdout: 'pipe',
      stderr: 'pipe',
    });
    const [stderr, exitCode] = await Promise.all([new Response(proc.stderr).text(), proc.exited]);
    if (exitCode === 0) return [];
    return stderr.trim().split('\n').filter(Boolean);
  } finally {
    unlinkSync(tmpFile);
  }
}

describe('3.3C-CONTRACT-005 [P0] runtime envelope JSON Schema validation via contract validator (RF6, RF8, RF10)', () => {
  test('a runtime workflow.approve success envelope validates against the schema', async () => {
    const workflowDb = await import('@archon/core/db/workflows');
    (workflowDb.getWorkflowRun as ReturnType<typeof mock>).mockResolvedValueOnce({
      id: 'run-schema-ap',
      workflow_name: 'assist',
      status: 'paused',
      working_path: '/tmp/wt',
      codebase_id: null,
      user_message: 'go',
      metadata: { approval: { type: 'approval', nodeId: 'gate', message: 'ok?' } },
    });
    (workflowDb.getWorkflowRun as ReturnType<typeof mock>).mockResolvedValueOnce({
      id: 'run-schema-ap',
      workflow_name: 'assist',
      status: 'paused',
      codebase_id: null,
      working_path: '/tmp/wt',
      metadata: { approval: { type: 'approval', nodeId: 'gate', resolved: 'approved' } },
    });

    const consoleSpy = spyOn(console, 'log').mockImplementation(() => {});
    try {
      await workflowApproveCommand('run-schema-ap', 'lgtm', true);
      const raw = String((consoleSpy.mock.calls[0] as unknown[] | undefined)?.[0]);
      const envelope = JSON.parse(raw) as Record<string, unknown>;
      const errors = await validateRuntimeEnvelope(envelope);
      expect(errors).toEqual([]);
    } finally {
      consoleSpy.mockRestore();
    }
  });

  test('a runtime workflow.approve error envelope validates against the schema', async () => {
    const workflowDb = await import('@archon/core/db/workflows');
    (workflowDb.getWorkflowRun as ReturnType<typeof mock>).mockResolvedValueOnce(null);

    const consoleSpy = spyOn(console, 'log').mockImplementation(() => {});
    try {
      await workflowApproveCommand('nonexistent-schema', undefined, true);
      const raw = String((consoleSpy.mock.calls[0] as unknown[] | undefined)?.[0]);
      const envelope = JSON.parse(raw) as Record<string, unknown>;
      const errors = await validateRuntimeEnvelope(envelope);
      expect(errors).toEqual([]);
    } finally {
      consoleSpy.mockRestore();
    }
  });

  test('a runtime workflow.reject success envelope validates against the schema', async () => {
    const workflowDb = await import('@archon/core/db/workflows');
    (workflowDb.getWorkflowRun as ReturnType<typeof mock>).mockResolvedValueOnce({
      id: 'run-schema-rj',
      workflow_name: 'assist',
      status: 'paused',
      working_path: '/tmp/wt',
      codebase_id: null,
      user_message: 'go',
      metadata: { approval: { type: 'approval', nodeId: 'gate', message: 'ok?' } },
    });
    (workflowDb.getWorkflowRun as ReturnType<typeof mock>).mockResolvedValueOnce({
      id: 'run-schema-rj',
      workflow_name: 'assist',
      status: 'cancelled',
      codebase_id: null,
      working_path: '/tmp/wt',
      metadata: {},
    });

    const consoleSpy = spyOn(console, 'log').mockImplementation(() => {});
    try {
      await workflowRejectCommand('run-schema-rj', 'nope', true);
      const raw = String((consoleSpy.mock.calls[0] as unknown[] | undefined)?.[0]);
      const envelope = JSON.parse(raw) as Record<string, unknown>;
      const errors = await validateRuntimeEnvelope(envelope);
      expect(errors).toEqual([]);
    } finally {
      consoleSpy.mockRestore();
    }
  });

  test('a runtime workflow.reject error envelope validates against the schema', async () => {
    const workflowDb = await import('@archon/core/db/workflows');
    (workflowDb.getWorkflowRun as ReturnType<typeof mock>).mockResolvedValueOnce(null);

    const consoleSpy = spyOn(console, 'log').mockImplementation(() => {});
    try {
      await workflowRejectCommand('nonexistent-schema-rj', 'nope', true);
      const raw = String((consoleSpy.mock.calls[0] as unknown[] | undefined)?.[0]);
      const envelope = JSON.parse(raw) as Record<string, unknown>;
      const errors = await validateRuntimeEnvelope(envelope);
      expect(errors).toEqual([]);
    } finally {
      consoleSpy.mockRestore();
    }
  });
});

describe('3.3C-CONTRACT-004 [P1] shared envelope module unmodified (regression gate)', () => {
  test('the shared envelope module tests pass without modification', async () => {
    const proc = Bun.spawn(
      ['bun', 'test', 'src/commands/workflow-provider-command-envelope.test.ts'],
      {
        cwd: join(import.meta.dir, '..', '..'),
        stdout: 'pipe',
        stderr: 'pipe',
      }
    );
    const [stdout, exitCode] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);
    expect(exitCode).toBe(0);
    expect(stdout).not.toContain('(fail)');
  });
});

// ---------------------------------------------------------------------------
// RED-PHASE SCAFFOLD — Story 3.3d "Provide Archon Recovery Command CLI JSON".
// Contract tests for resume/retry/cancel envelope forbidden-key scans,
// fixture conformance, and runtime schema validation.
//
// Mirrors the existing 3.3b/3.3c contract test patterns: invoke the real
// command functions against mocked deps, parse the emitted JSON, and verify
// contract compliance.
//
// Resume tests are EXECUTABLE (the command exists but emits the legacy
// `{ok:true}` shape without `schemaVersion` — these fail genuinely).
// Retry/cancel tests use `test.skip()` because the command handlers don't
// exist yet.
//
// ACTIVATION: remove `.skip` once workflowRetryCommand/workflowCancelCommand
// exist and emit shared envelopes.
// ---------------------------------------------------------------------------

import { workflowResumeCommand } from './workflow';

describe('3.3D-CONTRACT-001 [P0] forbidden-key scan on recovery envelopes (AC #1-#4)', () => {
  test('a workflow.resume success envelope parses as a real envelope and contains no forbidden key', async () => {
    const workflowDb = await import('@archon/core/db/workflows');
    (workflowDb.getWorkflowRun as ReturnType<typeof mock>).mockResolvedValueOnce({
      id: 'run-contract-rs',
      workflow_name: 'implement',
      status: 'failed',
      working_path: '/tmp/wt',
      codebase_id: null,
      metadata: {},
    });

    const consoleSpy = spyOn(console, 'log').mockImplementation(() => {});
    try {
      await workflowResumeCommand('run-contract-rs', true);
      const raw = String((consoleSpy.mock.calls[0] as unknown[] | undefined)?.[0]);
      const envelope = JSON.parse(raw) as Record<string, unknown>;
      expect(envelope.success).toBe(true);
      expect(envelope.schemaVersion).toBe('workflow-command-envelope.v1');
      expect(scanForForbiddenKeys(envelope)).toEqual([]);
    } finally {
      consoleSpy.mockRestore();
    }
  });

  test('a workflow.resume error envelope parses as a real envelope and contains no forbidden key', async () => {
    const workflowDb = await import('@archon/core/db/workflows');
    (workflowDb.getWorkflowRun as ReturnType<typeof mock>).mockResolvedValueOnce(null);

    const consoleSpy = spyOn(console, 'log').mockImplementation(() => {});
    try {
      await workflowResumeCommand('nonexistent-contract', true);
      const raw = String((consoleSpy.mock.calls[0] as unknown[] | undefined)?.[0]);
      const envelope = JSON.parse(raw) as Record<string, unknown>;
      expect(envelope.success).toBe(false);
      expect(envelope.schemaVersion).toBe('workflow-command-envelope.v1');
      expect(scanForForbiddenKeys(envelope)).toEqual([]);
    } finally {
      consoleSpy.mockRestore();
    }
  });

  test('a workflow.retry success envelope contains no forbidden key', async () => {
    const workflowDb = await import('@archon/core/db/workflows');
    (workflowDb.getWorkflowRun as ReturnType<typeof mock>).mockResolvedValueOnce({
      id: 'run-contract-rt',
      workflow_name: 'implement',
      status: 'failed',
      working_path: '/tmp/wt',
      codebase_id: null,
      metadata: {},
    });

    mockChildProcessSpawn.mockReturnValueOnce({
      pid: 99999,
      on: mock(() => undefined),
      unref: mock(() => undefined),
    } as unknown as ReturnType<typeof mockChildProcessSpawn>);

    const consoleSpy = spyOn(console, 'log').mockImplementation(() => {});
    try {
      const { workflowRetryCommand } = await import('./workflow');
      await workflowRetryCommand('run-contract-rt', undefined, true);
      const raw = String((consoleSpy.mock.calls[0] as unknown[] | undefined)?.[0]);
      const envelope = JSON.parse(raw) as Record<string, unknown>;
      expect(envelope.success).toBe(true);
      expect(envelope.schemaVersion).toBe('workflow-command-envelope.v1');
      expect(scanForForbiddenKeys(envelope)).toEqual([]);
    } finally {
      mockChildProcessSpawn.mockReset();
      consoleSpy.mockRestore();
    }
  });

  test('a workflow.cancel success envelope contains no forbidden key', async () => {
    const workflowDb = await import('@archon/core/db/workflows');
    (workflowDb.getWorkflowRun as ReturnType<typeof mock>).mockResolvedValueOnce({
      id: 'run-contract-cn',
      workflow_name: 'implement',
      status: 'paused',
      working_path: '/tmp/wt',
      codebase_id: null,
      metadata: {},
    });
    (workflowDb.cancelWorkflowRun as ReturnType<typeof mock>).mockResolvedValueOnce({
      cancelled: true,
    });

    const consoleSpy = spyOn(console, 'log').mockImplementation(() => {});
    try {
      const { workflowCancelCommand } = await import('./workflow');
      await workflowCancelCommand('run-contract-cn', true);
      const raw = String((consoleSpy.mock.calls[0] as unknown[] | undefined)?.[0]);
      const envelope = JSON.parse(raw) as Record<string, unknown>;
      expect(envelope.success).toBe(true);
      expect(envelope.schemaVersion).toBe('workflow-command-envelope.v1');
      expect(scanForForbiddenKeys(envelope)).toEqual([]);
    } finally {
      consoleSpy.mockRestore();
    }
  });
});

describe('3.3D-CONTRACT-002 [P1] fixture delta documentation (AC #1, #4)', () => {
  test('resume-success.json fixture has the canonical result shape', () => {
    const fixture = JSON.parse(
      readFileSync(join(COMMANDS_DIR, 'resume-success.json'), 'utf8')
    ) as Record<string, unknown>;
    const result = fixture.result as Record<string, unknown>;
    expect(result.operation).toBe('resume');
    expect(result.validated).toBe(true);
    expect(result.resumable).toBe(true);
    expect(result.executed).toBe(false);
  });

  test('retry-success.json fixture has the canonical whole-run dispatch shape', () => {
    const fixture = JSON.parse(
      readFileSync(join(COMMANDS_DIR, 'retry-success.json'), 'utf8')
    ) as Record<string, unknown>;
    const result = fixture.result as Record<string, unknown>;
    expect(result.operation).toBe('retry');
    expect(result.scope).toBe('run');
    expect(result.dispatched).toBe(true);
    expect(result.detached).toBe(true);
    expect(result).not.toHaveProperty('state');
    expect(result).not.toHaveProperty('nodeId');
  });

  test('retry-node-success.json fixture has the canonical targeted dispatch shape', () => {
    const fixture = JSON.parse(
      readFileSync(join(COMMANDS_DIR, 'retry-node-success.json'), 'utf8')
    ) as Record<string, unknown>;
    const result = fixture.result as Record<string, unknown>;
    expect(result.operation).toBe('retry');
    expect(result.scope).toBe('node');
    expect(typeof result.nodeId).toBe('string');
    expect(result.dispatched).toBe(true);
    expect(result.detached).toBe(true);
  });

  test('cancel-success.json fixture has the canonical cancel shape', () => {
    const fixture = JSON.parse(
      readFileSync(join(COMMANDS_DIR, 'cancel-success.json'), 'utf8')
    ) as Record<string, unknown>;
    const result = fixture.result as Record<string, unknown>;
    expect(result.operation).toBe('cancel');
    expect(result.state).toBe('cancelled');
    expect(result.terminal).toBe(true);
    expect(result).not.toHaveProperty('previousState');
  });

  test('a real workflow.resume success envelope intentionally omits phase and projectBindingRef', async () => {
    const workflowDb = await import('@archon/core/db/workflows');
    (workflowDb.getWorkflowRun as ReturnType<typeof mock>).mockResolvedValueOnce({
      id: 'run-delta-rs',
      workflow_name: 'implement',
      status: 'failed',
      working_path: '/tmp/wt',
      codebase_id: null,
      metadata: {},
    });

    const consoleSpy = spyOn(console, 'log').mockImplementation(() => {});
    try {
      await workflowResumeCommand('run-delta-rs', true);
      const raw = String((consoleSpy.mock.calls[0] as unknown[] | undefined)?.[0]);
      const envelope = JSON.parse(raw) as Record<string, unknown>;
      const result = (envelope.result ?? {}) as Record<string, unknown>;
      expect('phase' in result).toBe(false);
      expect('projectBindingRef' in result).toBe(false);
    } finally {
      consoleSpy.mockRestore();
    }
  });
});

describe('3.3D-CONTRACT-003 [P0] canonical validator still passes (regression)', () => {
  test('validate_contracts.py passes and no contract file was edited by this story', async () => {
    const proc = Bun.spawn(['python3', VALIDATOR], { stdout: 'pipe', stderr: 'pipe' });
    const [stdout, exitCode] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain('contract validation passed');
  });
});

describe('3.3D-CONTRACT-004 [P1] shared envelope module unmodified (regression gate)', () => {
  test('the shared envelope module tests pass without modification by this story', async () => {
    const proc = Bun.spawn(
      ['bun', 'test', 'src/commands/workflow-provider-command-envelope.test.ts'],
      {
        cwd: join(import.meta.dir, '..', '..'),
        stdout: 'pipe',
        stderr: 'pipe',
      }
    );
    const [stdout, exitCode] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);
    expect(exitCode).toBe(0);
    expect(stdout).not.toContain('(fail)');
  });
});

describe('3.3D-CONTRACT-005 [P1] no runtime _bmad-output import (R-016, R-020)', () => {
  test('workflow.ts does not import from `_bmad-output` at runtime', () => {
    const content = readFileSync(join(import.meta.dir, './workflow.ts'), 'utf8');
    expect(content).not.toContain('_bmad-output');
  });
});

describe('3.3D-CONTRACT-006 [P0] runtime envelope JSON Schema validation via contract validator (AC #1-#4)', () => {
  test('a runtime workflow.resume success envelope validates against the schema', async () => {
    const workflowDb = await import('@archon/core/db/workflows');
    (workflowDb.getWorkflowRun as ReturnType<typeof mock>).mockResolvedValueOnce({
      id: 'run-schema-rs',
      workflow_name: 'implement',
      status: 'failed',
      working_path: '/tmp/wt',
      codebase_id: null,
      metadata: {},
    });

    const consoleSpy = spyOn(console, 'log').mockImplementation(() => {});
    try {
      await workflowResumeCommand('run-schema-rs', true);
      const raw = String((consoleSpy.mock.calls[0] as unknown[] | undefined)?.[0]);
      const envelope = JSON.parse(raw) as Record<string, unknown>;
      const errors = await validateRuntimeEnvelope(envelope);
      expect(errors).toEqual([]);
    } finally {
      consoleSpy.mockRestore();
    }
  });

  test('a runtime workflow.resume error envelope validates against the schema', async () => {
    const workflowDb = await import('@archon/core/db/workflows');
    (workflowDb.getWorkflowRun as ReturnType<typeof mock>).mockResolvedValueOnce(null);

    const consoleSpy = spyOn(console, 'log').mockImplementation(() => {});
    try {
      await workflowResumeCommand('nonexistent-schema-rs', true);
      const raw = String((consoleSpy.mock.calls[0] as unknown[] | undefined)?.[0]);
      const envelope = JSON.parse(raw) as Record<string, unknown>;
      const errors = await validateRuntimeEnvelope(envelope);
      expect(errors).toEqual([]);
    } finally {
      consoleSpy.mockRestore();
    }
  });

  test('a runtime workflow.retry success envelope validates against the schema', async () => {
    const workflowDb = await import('@archon/core/db/workflows');
    (workflowDb.getWorkflowRun as ReturnType<typeof mock>).mockResolvedValueOnce({
      id: 'run-schema-rt',
      workflow_name: 'implement',
      status: 'failed',
      working_path: '/tmp/wt',
      codebase_id: null,
      metadata: {},
    });

    mockChildProcessSpawn.mockReturnValueOnce({
      pid: 99999,
      on: mock(() => undefined),
      unref: mock(() => undefined),
    } as unknown as ReturnType<typeof mockChildProcessSpawn>);

    const consoleSpy = spyOn(console, 'log').mockImplementation(() => {});
    try {
      const { workflowRetryCommand } = await import('./workflow');
      await workflowRetryCommand('run-schema-rt', undefined, true);
      const raw = String((consoleSpy.mock.calls[0] as unknown[] | undefined)?.[0]);
      const envelope = JSON.parse(raw) as Record<string, unknown>;
      expect(envelope.success).toBe(true);
      const errors = await validateRuntimeEnvelope(envelope);
      expect(errors).toEqual([]);
    } finally {
      mockChildProcessSpawn.mockReset();
      consoleSpy.mockRestore();
    }
  });

  test('a runtime workflow.cancel success envelope validates against the schema', async () => {
    const workflowDb = await import('@archon/core/db/workflows');
    (workflowDb.getWorkflowRun as ReturnType<typeof mock>).mockResolvedValueOnce({
      id: 'run-schema-cn',
      workflow_name: 'implement',
      status: 'paused',
      working_path: '/tmp/wt',
      codebase_id: null,
      metadata: {},
    });
    (workflowDb.cancelWorkflowRun as ReturnType<typeof mock>).mockResolvedValueOnce({
      cancelled: true,
    });

    const consoleSpy = spyOn(console, 'log').mockImplementation(() => {});
    try {
      const { workflowCancelCommand } = await import('./workflow');
      await workflowCancelCommand('run-schema-cn', true);
      const raw = String((consoleSpy.mock.calls[0] as unknown[] | undefined)?.[0]);
      const envelope = JSON.parse(raw) as Record<string, unknown>;
      const errors = await validateRuntimeEnvelope(envelope);
      expect(errors).toEqual([]);
    } finally {
      consoleSpy.mockRestore();
    }
  });
});
