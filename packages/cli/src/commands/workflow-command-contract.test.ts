import { describe, test, expect, spyOn, mock } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

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
}));
mock.module('@archon/core/db/conversations', () => ({
  getOrCreateConversation: mock(() => Promise.resolve({ id: 'conv-contract' })),
  getConversationById: mock(() => Promise.resolve(null)),
  updateConversation: mock(() => Promise.resolve()),
}));
mock.module('@archon/core/db/codebases', () => ({
  findCodebaseByDefaultCwd: mock(() => Promise.resolve(null)),
  getCodebase: mock(() => Promise.resolve(null)),
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
  listWorkflowRuns: mock(() => Promise.resolve([])),
}));
mock.module('@archon/core/db/workflow-events', () => ({
  listWorkflowEvents: mock(() => Promise.resolve([])),
  createWorkflowEvent: mock(() => Promise.resolve()),
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
