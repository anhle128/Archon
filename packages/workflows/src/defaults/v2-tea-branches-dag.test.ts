/**
 * RED-PHASE ATDD acceptance scaffolds — RV/NR conditional sibling branches.
 *
 * Behavioral / DAG-level acceptance tests that drive the REAL executor + REAL
 * `gate-planner` bash node through the v2 DAG. Only AI provider nodes
 * (dev-story / tea-automate / code-review-auto / tea-rv / tea-nr / tea-tr /
 * create-pull-request) are mocked; bash nodes — including gate-planner AND the
 * new `tea-rv-skipped` / `tea-nr-skipped` skip-contract encoders — execute for
 * real. A mocked gate-planner would be a fake test (TD-010).
 *
 * ── TDD RED PHASE ──────────────────────────────────────────────────────────
 * These tests assert the TARGET behavior of the not-yet-implemented wiring and
 * are EXPECTED TO FAIL until the following production edits land in
 * `.archon/workflows/defaults/bmad-dev-story-with-tea-fix-loop-v2.yml`:
 *   1. `tea-rv`  gets `when: "$gate-planner.output.run_rv == true"` + output_format.
 *   2. `tea-rv-skipped` bash node added: `when: "... run_rv == false"`,
 *      emits a `gate:"SKIPPED"` contract.
 *   3. `tea-nr`  decoupled from tea-rv (`depends_on: [gate-planner]`) +
 *      `when: "... run_nr == true"` + output_format.
 *   4. `tea-nr-skipped` bash node added: `when: "... run_nr == false"`.
 *   5. `tea-tr` rewired to `depends_on: [tea-rv, tea-rv-skipped, tea-nr,
 *      tea-nr-skipped]` with `trigger_rule: none_failed_min_one_success`.
 *
 * ── ISOLATION (TD-013) ─────────────────────────────────────────────
 * This file uses mock.module('@archon/paths', ...). Bun's mock.module() is
 * process-global and irreversible, so this file MUST run as its OWN isolated
 * `bun test` invocation. It is intentionally NOT yet registered in
 * packages/workflows/package.json — registering it (its own invocation, never
 * co-located) is the GREEN-phase step. Run it in red phase with:
 *   bun test packages/workflows/src/defaults/v2-tea-branches-dag.test.ts
 */

import { describe, it, expect, mock, beforeAll, afterAll } from 'bun:test';
import { mkdir, writeFile, rm, readFile } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

// ── @archon/paths mock ─────────────────────────────────────────────────────
import * as realPaths from '@archon/paths';

const mockLogFn = mock(() => {});
const mockLogger = {
  info: mockLogFn,
  warn: mockLogFn,
  error: mockLogFn,
  debug: mockLogFn,
  trace: mockLogFn,
  fatal: mockLogFn,
  child: mock(() => mockLogger),
};
const mockCaptureWorkflowCompleted = mock(() => {});

mock.module('@archon/paths', () => ({
  ...realPaths,
  createLogger: mock(() => mockLogger),
  captureWorkflowCompleted: mockCaptureWorkflowCompleted,
}));

// ── Provider registry ──────────────────────────────────────────────────────
import { registerBuiltinProviders, clearRegistry } from '@archon/providers';
clearRegistry();
registerBuiltinProviders();

// ── Imports (after mocks) ──────────────────────────────────────────────────
import { executeDagWorkflow } from '../dag-executor';
import { parseWorkflow } from '../loader';
import type { WorkflowRun } from '../schemas';
import type { WorkflowDeps, IWorkflowPlatform, WorkflowConfig } from '../deps';
import type { IWorkflowStore } from '../store';
import type { SendQueryOptions } from '@archon/providers/types';

const V2_FILE = join(
  import.meta.dir,
  '../../../../.archon/workflows/defaults/bmad-dev-story-with-tea-fix-loop-v2.yml'
);

const V2_STEM = 'bmad-dev-story-with-tea-fix-loop-v2';
const CANONICAL_REF = 'a1-2-preserve-story-input-resolution';

// ── Store / platform / deps ────────────────────────────────────────────────

type NodeEventState = 'completed' | 'failed' | 'skipped';

const MOCK_RUN = {
  id: 'tea-branches-run-id',
  workflow_name: V2_STEM,
  conversation_id: 'conv-tb',
  parent_conversation_id: null,
  codebase_id: null,
  status: 'running' as const,
  user_message: 'test',
  metadata: {},
  started_at: new Date(),
  completed_at: null,
  last_activity_at: null,
  working_path: null,
};

function createTrackedStore(
  nodeState: Record<string, NodeEventState>,
  runFailedRef: { value: boolean }
): IWorkflowStore {
  return {
    createWorkflowRun: mock(() => Promise.resolve({ ...MOCK_RUN })),
    getWorkflowRun: mock(() => Promise.resolve(null)),
    getActiveWorkflowRunByPath: mock(() => Promise.resolve(null)),
    failOrphanedRuns: mock(() => Promise.resolve({ count: 0 })),
    findResumableRun: mock(() => Promise.resolve(null)),
    resumeWorkflowRun: mock(() => Promise.resolve({ ...MOCK_RUN })),
    updateWorkflowRun: mock(() => Promise.resolve()),
    persistRouteDecisionTransition: mock(input =>
      Promise.resolve({ ...MOCK_RUN, id: input.workflow_run_id, metadata: input.metadata })
    ),
    updateWorkflowActivity: mock(() => Promise.resolve()),
    getWorkflowRunStatus: mock(() => Promise.resolve('running' as const)),
    completeWorkflowRun: mock(() => Promise.resolve()),
    failWorkflowRun: mock(() => {
      runFailedRef.value = true;
      return Promise.resolve();
    }),
    pauseWorkflowRun: mock(() => Promise.resolve()),
    cancelWorkflowRun: mock(() => Promise.resolve()),
    createWorkflowEvent: (data: {
      workflow_run_id: string;
      event_type: string;
      step_name?: string;
      data?: Record<string, unknown>;
    }) => {
      const { event_type, step_name } = data;
      if (step_name) {
        if (event_type === 'node_completed') nodeState[step_name] = 'completed';
        else if (event_type === 'node_failed') nodeState[step_name] = 'failed';
        else if (event_type === 'node_skipped') nodeState[step_name] = 'skipped';
      }
      return Promise.resolve();
    },
    getCompletedDagNodeOutputs: mock(() => Promise.resolve(new Map<string, string>())),
    getCodebase: mock(() => Promise.resolve(null)),
    getCodebaseEnvVars: mock(() => Promise.resolve({})),
    getWorkflowNodeSession: mock(() => Promise.resolve(null)),
    upsertWorkflowNodeSession: mock(() => Promise.resolve()),
    deleteWorkflowNodeSessions: mock(() => Promise.resolve({ deleted: 0 })),
  };
}

function createMockPlatform(): IWorkflowPlatform {
  return {
    sendMessage: mock(() => Promise.resolve()),
    getStreamingMode: mock(() => 'batch' as const),
    getPlatformType: mock(() => 'test'),
    sendStructuredEvent: mock(() => Promise.resolve()),
  };
}

function makeWorkflowRun(cwd: string, userMessage: string): WorkflowRun {
  return {
    id: 'tea-branches-run-id',
    workflow_name: V2_STEM,
    conversation_id: 'conv-tb',
    parent_conversation_id: null,
    codebase_id: null,
    status: 'running',
    user_message: userMessage,
    metadata: {},
    started_at: new Date(),
    completed_at: null,
    last_activity_at: null,
    working_path: cwd,
  };
}

const minimalConfig: WorkflowConfig = {
  assistant: 'claude',
  prRemote: 'origin',
  assistants: { claude: {}, codex: {} },
  commands: {},
  defaults: { loadDefaultCommands: false, loadDefaultWorkflows: false },
};

function createMockDepsWithResponses(
  store: IWorkflowStore,
  nodeResponses: Record<string, Record<string, unknown>>,
  providerCalls: string[]
): WorkflowDeps {
  const getAgentProvider = mock(() => {
    const sendQuery = mock(function* (
      _prompt: string,
      _cwd: string,
      _resumeSessionId: string | undefined,
      options?: SendQueryOptions
    ) {
      const nodeId = (options?.nodeConfig as Record<string, unknown> | undefined)?.nodeId as
        | string
        | undefined;
      if (nodeId) providerCalls.push(nodeId);
      const resp = nodeId && nodeResponses[nodeId] ? nodeResponses[nodeId] : {};
      yield { type: 'assistant', content: JSON.stringify(resp) };
      yield {
        type: 'result',
        sessionId: `session-${nodeId ?? 'unknown'}`,
        structuredOutput: Object.keys(resp).length ? resp : undefined,
      };
    });
    return {
      sendQuery,
      getType: () => 'codex',
      getCapabilities: () => ({
        sessionResume: false,
        mcp: false,
        hooks: false,
        skills: false,
        agents: false,
        toolRestrictions: false,
        structuredOutput: 'enforced' as const,
        envInjection: false,
        costControl: false,
        effortControl: false,
        thinkingControl: false,
        fallbackModel: false,
        sandbox: false,
        nativeTools: false,
      }),
    };
  });

  return {
    store,
    getAgentProvider,
    loadConfig: mock(() => Promise.resolve(minimalConfig)),
  };
}

// ── Fixture directory ──────────────────────────────────────────────────────

async function buildFixtureDir(baseDir: string): Promise<string> {
  const cwd = join(baseDir, 'tea-branches-fixture');
  await mkdir(cwd, { recursive: true });

  const skills = [
    'bmad-dev-story',
    'bmad-code-review-auto',
    'bmad-testarch-automate',
    'bmad-testarch-test-review',
    'bmad-testarch-nfr',
    'bmad-testarch-trace',
  ];
  for (const skill of skills) {
    await mkdir(join(cwd, '.agents/skills', skill), { recursive: true });
    await writeFile(join(cwd, '.agents/skills', skill, 'SKILL.md'), `# ${skill}`);
  }

  await mkdir(join(cwd, '_bmad/bmm'), { recursive: true });
  await writeFile(join(cwd, '_bmad/bmm/config.yaml'), 'project_name: test');

  await mkdir(join(cwd, '_bmad-output/implementation-artifacts'), { recursive: true });
  await writeFile(
    join(cwd, '_bmad-output/implementation-artifacts/sprint-status.yaml'),
    [
      'project: test',
      'development_status:',
      `  ${CANONICAL_REF}:`,
      '    status: ready-for-dev',
      '    last_updated: 2026-07-07',
    ].join('\n')
  );

  await mkdir(join(cwd, '.archon/commands'), { recursive: true });
  for (const cmd of ['bmad-code-review', 'bmad-code-review-auto', 'archon-create-pr']) {
    await writeFile(join(cwd, '.archon/commands', `${cmd}.md`), `# ${cmd}`);
  }

  return cwd;
}

// ── runV2Dag harness ───────────────────────────────────────────────────────

interface DagRun {
  nodeState: Record<string, NodeEventState>;
  providerCalls: string[];
  runFailed: boolean;
  artifactsDir: string;
}

let dagRunCounter = 0;

async function runV2Dag(opts: {
  cwd: string;
  arguments?: string;
  nodeResponses?: Record<string, Record<string, unknown>>;
}): Promise<DagRun> {
  const yamlText = await readFile(V2_FILE, 'utf-8');
  const parseResult = parseWorkflow(yamlText, 'test');
  if (!parseResult.workflow)
    throw new Error(`Failed to parse v2 workflow: ${parseResult.error?.error}`);
  const workflow = parseResult.workflow;

  const nodeState: Record<string, NodeEventState> = {};
  const providerCalls: string[] = [];
  const runFailedRef = { value: false };

  const store = createTrackedStore(nodeState, runFailedRef);
  const deps = createMockDepsWithResponses(store, opts.nodeResponses ?? {}, providerCalls);
  const platform = createMockPlatform();
  const workflowRun = makeWorkflowRun(opts.cwd, opts.arguments ?? '');
  dagRunCounter++;
  const artifactsDir = join(opts.cwd, 'artifacts', `run-${dagRunCounter}`);

  try {
    await executeDagWorkflow(
      deps,
      platform,
      'conv-tb',
      opts.cwd,
      {
        name: workflow.name,
        nodes: workflow.nodes as Parameters<typeof executeDagWorkflow>[4]['nodes'],
        model: workflow.model,
        provider: workflow.provider,
        persist_sessions: false,
      },
      workflowRun,
      workflow.provider ?? 'codex',
      workflow.model,
      artifactsDir,
      join(opts.cwd, 'logs'),
      'main',
      join(opts.cwd, 'docs'),
      minimalConfig
    );
  } catch {
    runFailedRef.value = true;
  }

  return { nodeState, providerCalls, runFailed: runFailedRef.value, artifactsDir };
}

// ── Skip-contract capture ──────────────────────────────────────────────────
// A `-skipped` node declares output_type, so the executor writes a typed
// sidecar at nodes/<id>.md; the bash body also best-effort writes
// $RUN_DIR/<id>.gate.json. Read whichever resolved (AC #2 / TD-002 / TD-008).

async function readSkipContract(
  artifactsDir: string,
  nodeId: string
): Promise<Record<string, unknown> | null> {
  const candidates = [
    join(artifactsDir, 'nodes', `${nodeId}.md`),
    join(artifactsDir, 'bmad-dev-story-with-tea-fix-loop', `${nodeId}.gate.json`),
  ];
  for (const path of candidates) {
    if (!existsSync(path)) continue;
    const raw = (await readFile(path, 'utf-8')).trim();
    if (!raw) continue;
    try {
      return JSON.parse(raw) as Record<string, unknown>;
    } catch {
      throw new Error(`${nodeId} skip contract is not valid JSON: ${raw.slice(0, 200)}`);
    }
  }
  return null;
}

// ── Evidence builders ──────────────────────────────────────────────────────

function validCrEvidence(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    contract_version: '1.0',
    workflow: V2_STEM,
    node: 'code-review-auto',
    gate: 'PASS',
    round: 1,
    findings_count: 0,
    open_findings_file: 'findings/open-findings.md',
    decision_log_file: 'decision-log.md',
    code_review_report: 'No findings.',
    story_ref: CANONICAL_REF,
    ...overrides,
  };
}

function validTaEvidence(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    contract_version: '1.0',
    workflow: V2_STEM,
    node: 'tea-automate',
    story_ref: CANONICAL_REF,
    test_files_changed: 3,
    nfr_relevant: 'true',
    automation_report: 'automation-report.md',
    ...overrides,
  };
}

// Real RV/NR gate contract the -real branches must emit once output_format is
// added. Gate vocab intentionally excludes SKIPPED (only skip nodes emit it —
// / TD-007).
function validRvGate(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    contract_version: '1.0',
    workflow: V2_STEM,
    node: 'tea-rv',
    gate: 'PASS',
    story_ref: CANONICAL_REF,
    findings_count: 0,
    report_file: 'tea-rv-report.md',
    ...overrides,
  };
}

function validNrGate(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    contract_version: '1.0',
    workflow: V2_STEM,
    node: 'tea-nr',
    gate: 'PASS',
    story_ref: CANONICAL_REF,
    findings_count: 0,
    report_file: 'tea-nr-report.md',
    ...overrides,
  };
}

function validTrGate(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    contract_version: '1.0',
    workflow: V2_STEM,
    node: 'tea-tr',
    gate: 'PASS',
    story_ref: CANONICAL_REF,
    findings_count: 0,
    report_file: 'tea-tr-report.md',
    ...overrides,
  };
}

// Downstream AI nodes that must complete on the happy path so tail
// reachability can be asserted.
function happyDownstream(): Record<string, Record<string, unknown>> {
  return {
    'dev-story': {},
    'tea-rv': validRvGate(),
    'tea-nr': validNrGate(),
    'tea-tr': validTrGate(),
    'create-pull-request': {},
  };
}

// ── Fixture lifecycle ──────────────────────────────────────────────────────

let fixtureBase = '';
let cwdFixture = '';

beforeAll(async () => {
  fixtureBase = join(tmpdir(), `tea-branches-dag-${process.pid}`);
  cwdFixture = await buildFixtureDir(fixtureBase);
});

afterAll(async () => {
  await rm(fixtureBase, { recursive: true, force: true });
});

// ═══════════════════════════════════════════════════════════════════════════
// TD-001 [P0] — run_rv=true & run_nr=true → real RV + real NR, tail reachable
// ═══════════════════════════════════════════════════════════════════════════

describe('RV/NR branches — both flags true resolve both real branches (TD-001)', () => {
  it('RV real completed XOR RV skipped; NR real completed XOR NR skipped; tea-tr + PR reached', async () => {
    const run = await runV2Dag({
      cwd: cwdFixture,
      arguments: CANONICAL_REF,
      nodeResponses: {
        'code-review-auto': validCrEvidence(),
        'tea-automate': validTaEvidence({ test_files_changed: 3, nfr_relevant: 'true' }),
        ...happyDownstream(),
      },
    });

    // RV pair: exactly one resolves (real completes, skip is skipped).
    expect(run.nodeState['tea-rv'], 'run_rv=true → tea-rv must complete').toBe('completed');
    expect(run.nodeState['tea-rv-skipped'], 'run_rv=true → tea-rv-skipped must be skipped').toBe(
      'skipped'
    );
    // NR pair: exactly one resolves.
    expect(run.nodeState['tea-nr'], 'run_nr=true → tea-nr must complete').toBe('completed');
    expect(run.nodeState['tea-nr-skipped'], 'run_nr=true → tea-nr-skipped must be skipped').toBe(
      'skipped'
    );
    // XOR discipline (AC #7).
    expect(
      (run.nodeState['tea-rv'] === 'completed') !==
        (run.nodeState['tea-rv-skipped'] === 'completed'),
      'exactly one RV branch may complete'
    ).toBe(true);
    expect(
      (run.nodeState['tea-nr'] === 'completed') !==
        (run.nodeState['tea-nr-skipped'] === 'completed'),
      'exactly one NR branch may complete'
    ).toBe(true);
    // Tail reachability (AC #4).
    expect(run.nodeState['tea-tr'], 'tea-tr must join the branches and complete').toBe('completed');
    expect(run.nodeState['tea-tr-skipped'], 'run_tr=true → tea-tr-skipped must be skipped').toBe(
      'skipped'
    );
    expect(run.providerCalls, 'create-pull-request must be reached').toContain(
      'create-pull-request'
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// TD-002 [P0] — run_rv=false & run_nr=false → skip contracts, tail reachable
// AC #2 (skip vs missing evidence)
// ═══════════════════════════════════════════════════════════════════════════

describe('RV/NR branches — both flags false resolve explicit SKIPPED contracts (TD-002)', () => {
  it('skip nodes complete, real nodes skipped, and each emits a parsed gate:SKIPPED contract', async () => {
    const run = await runV2Dag({
      cwd: cwdFixture,
      arguments: CANONICAL_REF,
      nodeResponses: {
        'code-review-auto': validCrEvidence(),
        'tea-automate': validTaEvidence({ test_files_changed: 0, nfr_relevant: 'false' }),
        ...happyDownstream(),
      },
    });

    expect(run.nodeState['tea-rv-skipped'], 'run_rv=false → tea-rv-skipped must complete').toBe(
      'completed'
    );
    expect(run.nodeState['tea-rv'], 'run_rv=false → tea-rv must be skipped').toBe('skipped');
    expect(run.nodeState['tea-nr-skipped'], 'run_nr=false → tea-nr-skipped must complete').toBe(
      'completed'
    );
    expect(run.nodeState['tea-nr'], 'run_nr=false → tea-nr must be skipped').toBe('skipped');

    // Explicit SKIPPED contract distinguishes "skipped branch" from "missing
    // evidence" (AC #2) and proves valid JSON serialization .
    const rvContract = await readSkipContract(run.artifactsDir, 'tea-rv-skipped');
    expect(rvContract, 'tea-rv-skipped must emit a machine-readable contract').not.toBeNull();
    expect(rvContract!.gate, 'skip contract gate must be SKIPPED').toBe('SKIPPED');
    expect(rvContract!.story_ref, 'skip contract must pin the resolved story_ref').toBe(
      CANONICAL_REF
    );
    expect(rvContract!.node).toBe('tea-rv-skipped');

    const nrContract = await readSkipContract(run.artifactsDir, 'tea-nr-skipped');
    expect(nrContract, 'tea-nr-skipped must emit a machine-readable contract').not.toBeNull();
    expect(nrContract!.gate).toBe('SKIPPED');
    expect(nrContract!.story_ref).toBe(CANONICAL_REF);
    expect(nrContract!.node).toBe('tea-nr-skipped');

    // Tail still reachable through two skipped siblings .
    expect(run.nodeState['tea-tr'], 'skips must not cascade-skip tea-tr').toBe('completed');
    expect(run.nodeState['tea-tr-skipped'], 'run_tr=true → tea-tr-skipped must be skipped').toBe(
      'skipped'
    );
    expect(run.providerCalls).toContain('create-pull-request');
  });

  it('skip contracts are emitted by real bash, never by the AI provider', async () => {
    const run = await runV2Dag({
      cwd: cwdFixture,
      arguments: CANONICAL_REF,
      nodeResponses: {
        'code-review-auto': validCrEvidence(),
        'tea-automate': validTaEvidence({ test_files_changed: 0, nfr_relevant: 'false' }),
        ...happyDownstream(),
      },
    });
    expect(run.providerCalls, 'tea-rv-skipped is a bash node — no AI call').not.toContain(
      'tea-rv-skipped'
    );
    expect(run.providerCalls, 'tea-nr-skipped is a bash node — no AI call').not.toContain(
      'tea-nr-skipped'
    );
    expect(run.providerCalls, 'tea-tr-skipped is a bash node — no AI call').not.toContain(
      'tea-tr-skipped'
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// TD-003 [P0] — boundary test_files_changed=1 & nfr=false → RV real, NR skipped
// ═══════════════════════════════════════════════════════════════════════════

describe('RV/NR branches — RV-real + NR-skipped boundary combination (TD-003)', () => {
  it('test_files_changed=1 runs real RV; nfr=false runs NR skip contract; tail reachable', async () => {
    const run = await runV2Dag({
      cwd: cwdFixture,
      arguments: CANONICAL_REF,
      nodeResponses: {
        'code-review-auto': validCrEvidence(),
        'tea-automate': validTaEvidence({ test_files_changed: 1, nfr_relevant: 'false' }),
        ...happyDownstream(),
      },
    });

    expect(run.nodeState['tea-rv'], 'test_files_changed=1 → RV real completes').toBe('completed');
    expect(run.nodeState['tea-rv-skipped']).toBe('skipped');
    expect(run.nodeState['tea-nr-skipped'], 'nfr=false → NR skip completes').toBe('completed');
    expect(run.nodeState['tea-nr']).toBe('skipped');

    const nrContract = await readSkipContract(run.artifactsDir, 'tea-nr-skipped');
    expect(nrContract?.gate).toBe('SKIPPED');

    expect(run.nodeState['tea-tr']).toBe('completed');
    expect(run.nodeState['tea-tr-skipped'], 'run_tr=true → tea-tr-skipped must be skipped').toBe(
      'skipped'
    );
    expect(run.providerCalls).toContain('create-pull-request');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// TD-004 [P0] — decoupling: test_files_changed=0 & nfr=true → RV skipped, NR real
// Proves NR is a SIBLING of RV, not a successor . ,
// ═══════════════════════════════════════════════════════════════════════════

describe('RV/NR branches — RV-skipped + NR-real proves NR decoupled from RV (TD-004)', () => {
  it('test_files_changed=0 skips RV; nfr=true runs real NR even though RV did not run', async () => {
    const run = await runV2Dag({
      cwd: cwdFixture,
      arguments: CANONICAL_REF,
      nodeResponses: {
        'code-review-auto': validCrEvidence(),
        'tea-automate': validTaEvidence({ test_files_changed: 0, nfr_relevant: 'true' }),
        ...happyDownstream(),
      },
    });

    // The core decoupling proof: NR runs while RV real did NOT. Under the old
    // `tea-nr depends_on: [tea-rv]` wiring this is impossible .
    expect(run.nodeState['tea-rv-skipped'], 'test_files_changed=0 → RV skip completes').toBe(
      'completed'
    );
    expect(run.nodeState['tea-rv'], 'RV real must not run').toBe('skipped');
    expect(run.nodeState['tea-nr'], 'nfr=true → NR real completes as a sibling').toBe('completed');
    expect(run.nodeState['tea-nr-skipped']).toBe('skipped');

    const rvContract = await readSkipContract(run.artifactsDir, 'tea-rv-skipped');
    expect(rvContract?.gate).toBe('SKIPPED');

    expect(run.nodeState['tea-tr']).toBe('completed');
    expect(run.nodeState['tea-tr-skipped'], 'run_tr=true → tea-tr-skipped must be skipped').toBe(
      'skipped'
    );
    expect(run.providerCalls).toContain('create-pull-request');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// TD-005 [P1] — real RV branch FAILURE fails closed before tea-tr + PR
// (fail-closed join, not all_done)
// ═══════════════════════════════════════════════════════════════════════════

describe('RV/NR branches — real RV failure fails closed (TD-005)', () => {
  it('a schema-invalid RV real output fails tea-rv; tea-tr and PR must NOT run', async () => {
    const run = await runV2Dag({
      cwd: cwdFixture,
      arguments: CANONICAL_REF,
      nodeResponses: {
        'code-review-auto': validCrEvidence(),
        'tea-automate': validTaEvidence({ test_files_changed: 3, nfr_relevant: 'true' }),
        'dev-story': {},
        // Empty structured output → once tea-rv declares output_format the node
        // fails schema validation. That failed real branch must fail the join closed.
        'tea-rv': {},
        'tea-nr': validNrGate(),
        'tea-tr': {},
        'create-pull-request': {},
      },
    });

    expect(run.nodeState['tea-rv'], 'RV real with no schema-valid output must fail').toBe('failed');
    expect(
      run.nodeState['tea-tr'],
      'none_failed_min_one_success must NOT run tea-tr when a real branch failed'
    ).not.toBe('completed');
    expect(
      run.nodeState['tea-tr-skipped'],
      'run_tr=true → tea-tr-skipped must be skipped even on failure path'
    ).toBe('skipped');
    expect(
      run.providerCalls,
      'create-pull-request must be unreachable after a failed real branch'
    ).not.toContain('create-pull-request');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// TD-006 [P1] — real NR branch FAILURE fails closed before tea-tr + PR
// ═══════════════════════════════════════════════════════════════════════════

describe('RV/NR branches — real NR failure fails closed (TD-006)', () => {
  it('a schema-invalid NR real output fails tea-nr; tea-tr and PR must NOT run', async () => {
    const run = await runV2Dag({
      cwd: cwdFixture,
      arguments: CANONICAL_REF,
      nodeResponses: {
        'code-review-auto': validCrEvidence(),
        'tea-automate': validTaEvidence({ test_files_changed: 3, nfr_relevant: 'true' }),
        'dev-story': {},
        'tea-rv': validRvGate(),
        'tea-nr': {},
        'tea-tr': {},
        'create-pull-request': {},
      },
    });

    expect(run.nodeState['tea-nr'], 'NR real with no schema-valid output must fail').toBe('failed');
    expect(
      run.nodeState['tea-tr'],
      'tea-tr must fail closed when the real NR branch failed'
    ).not.toBe('completed');
    expect(
      run.nodeState['tea-tr-skipped'],
      'run_tr=true → tea-tr-skipped must be skipped even on failure path'
    ).toBe('skipped');
    expect(run.providerCalls).not.toContain('create-pull-request');
  });
});
