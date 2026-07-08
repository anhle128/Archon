/**
 * RED-PHASE ATDD acceptance scaffolds — TR joined as the final release gate.
 *
 * Behavioral / DAG-level acceptance tests that drive the REAL executor + REAL
 * `gate-planner` bash node through the v2 DAG. Only AI provider nodes
 * (dev-story / tea-automate / code-review-auto / tea-rv / tea-nr / tea-tr /
 * create-pull-request) are mocked; bash nodes — including gate-planner AND the
 * new `tea-tr-skipped` skip-contract encoder — execute for real. A mocked
 * gate-planner would be a fake test (TD-029 keeps the false path structural).
 *
 * ── TDD RED PHASE ──────────────────────────────────────────────────────────
 * These tests assert the TARGET behavior of the not-yet-implemented wiring and
 * are EXPECTED TO FAIL until the following production edits land in
 * `.archon/workflows/defaults/bmad-dev-story-with-tea-fix-loop-v2.yml`:
 *   1. `tea-tr` gets `when: "$gate-planner.output.run_tr == true"`,
 *      an output_format gate envelope, and a story_ref prompt_suffix.
 *   2. `tea-tr-skipped` bash node added (`when: "... run_tr == false"`,
 *      depends_on: [gate-planner]) emitting a gate:"SKIPPED" contract.
 *   3. `create-pull-request` rewired to depends_on: [tea-tr, tea-tr-skipped]
 *      with trigger_rule: none_failed_min_one_success.
 *
 * ── ISOLATION (TD-039) ─────────────────────────────────────────────
 * This file uses mock.module('@archon/paths', ...). Bun's mock.module() is
 * process-global and irreversible, so this file MUST run as its OWN isolated
 * `bun test` invocation. It is intentionally NOT yet registered in
 * packages/workflows/package.json — registering it (its own invocation, never
 * co-located) is the GREEN-phase step. Run it in red phase with:
 *   bun test packages/workflows/src/defaults/v2-tr-join-dag.test.ts
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
  id: 'tr-join-run-id',
  workflow_name: V2_STEM,
  conversation_id: 'conv-tr',
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
    id: 'tr-join-run-id',
    workflow_name: V2_STEM,
    conversation_id: 'conv-tr',
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
  const cwd = join(baseDir, 'tr-join-fixture');
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
      'conv-tr',
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
// tea-tr-skipped declares output_type, so the executor writes a typed sidecar
// at nodes/<id>.md; the bash body also best-effort writes
// $RUN_DIR/<id>.gate.json. Read whichever resolved (AC #2 / TD-024).

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

// Real RV/NR gate contracts (predecessor output_format). Gate vocab excludes SKIPPED.
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

// Real TR gate the joined final gate must emit once tea-tr gains output_format.
// SKIPPED is intentionally NOT a legal tea-tr gate value (only tea-tr-skipped).
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
// reachability can be asserted. tea-tr now needs a schema-valid gate.
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
  fixtureBase = join(tmpdir(), `tr-join-dag-${process.pid}`);
  cwdFixture = await buildFixtureDir(fixtureBase);
});

afterAll(async () => {
  await rm(fixtureBase, { recursive: true, force: true });
});

// ═══════════════════════════════════════════════════════════════════════════
// TD-030 [P0] — real gate-planner happy path (run_tr=true) completes tea-tr,
// skips tea-tr-skipped, and reaches the PR tail (AC #1, #4)
// ═══════════════════════════════════════════════════════════════════════════

describe('TR join — happy path completes real TR, skips TR-skip, reaches PR (TD-030)', () => {
  it('run_tr=true → tea-tr completed, tea-tr-skipped skipped, create-pull-request reached', async () => {
    const run = await runV2Dag({
      cwd: cwdFixture,
      arguments: CANONICAL_REF,
      nodeResponses: {
        'code-review-auto': validCrEvidence(),
        'tea-automate': validTaEvidence({ test_files_changed: 3, nfr_relevant: 'true' }),
        ...happyDownstream(),
      },
    });

    // Real TR runs; the skip sibling is condition-skipped by run_tr==false.
    expect(run.nodeState['tea-tr'], 'run_tr=true → tea-tr must complete').toBe('completed');
    expect(run.nodeState['tea-tr-skipped'], 'run_tr=true → tea-tr-skipped must be skipped').toBe(
      'skipped'
    );
    // XOR discipline — exactly one TR-role branch completes.
    expect(
      (run.nodeState['tea-tr'] === 'completed') !==
        (run.nodeState['tea-tr-skipped'] === 'completed'),
      'exactly one TR-role branch may complete'
    ).toBe(true);
    // Tail reachability through the resolved TR branch (AC #2 downstream successor).
    expect(
      run.providerCalls,
      'create-pull-request must be reached from a resolved TR gate'
    ).toContain('create-pull-request');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// TD-034 [P1] — PR trigger-rule proof: one completed TR sibling + the other
// skipped satisfies none_failed_min_one_success (AC #4)
// ═══════════════════════════════════════════════════════════════════════════

describe('PR trigger-rule — one completed TR sibling + one skipped runs the tail (TD-034)', () => {
  it('exactly one TR sibling completes while the other is skipped, and PR still runs', async () => {
    const run = await runV2Dag({
      cwd: cwdFixture,
      arguments: CANONICAL_REF,
      nodeResponses: {
        'code-review-auto': validCrEvidence(),
        'tea-automate': validTaEvidence({ test_files_changed: 3, nfr_relevant: 'true' }),
        ...happyDownstream(),
      },
    });

    const trStates = [run.nodeState['tea-tr'], run.nodeState['tea-tr-skipped']];
    const completed = trStates.filter(s => s === 'completed').length;
    const skipped = trStates.filter(s => s === 'skipped').length;
    expect(completed, 'exactly one TR-role sibling may complete').toBe(1);
    expect(skipped, 'the other TR-role sibling must be skipped, not failed').toBe(1);
    expect(
      run.providerCalls,
      'none_failed_min_one_success: one completed + one skipped runs the tail'
    ).toContain('create-pull-request');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// TD-031 [P0] — real RV branch FAILURE fails closed before tea-tr + PR (AC #4)
// ═══════════════════════════════════════════════════════════════════════════

describe('TR join — real RV failure fails closed (TD-031)', () => {
  it('a schema-invalid RV real output fails tea-rv; tea-tr and PR must NOT run', async () => {
    const run = await runV2Dag({
      cwd: cwdFixture,
      arguments: CANONICAL_REF,
      nodeResponses: {
        'code-review-auto': validCrEvidence(),
        'tea-automate': validTaEvidence({ test_files_changed: 3, nfr_relevant: 'true' }),
        'dev-story': {},
        // Empty structured output → tea-rv (output_format) fails schema validation.
        'tea-rv': {},
        'tea-nr': validNrGate(),
        'tea-tr': validTrGate(),
        'create-pull-request': {},
      },
    });

    expect(run.nodeState['tea-rv'], 'RV real with no schema-valid output must fail').toBe('failed');
    expect(
      run.nodeState['tea-tr'],
      'none_failed_min_one_success must NOT run tea-tr when a real branch failed'
    ).not.toBe('completed');
    expect(
      run.providerCalls,
      'create-pull-request must be unreachable after a failed real branch'
    ).not.toContain('create-pull-request');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// TD-032 [P0] — real NR branch FAILURE fails closed before tea-tr + PR (AC #4)
// ═══════════════════════════════════════════════════════════════════════════

describe('TR join — real NR failure fails closed (TD-032)', () => {
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
        'tea-tr': validTrGate(),
        'create-pull-request': {},
      },
    });

    expect(run.nodeState['tea-nr'], 'NR real with no schema-valid output must fail').toBe('failed');
    expect(
      run.nodeState['tea-tr'],
      'tea-tr must fail closed when the real NR branch failed'
    ).not.toBe('completed');
    expect(run.providerCalls).not.toContain('create-pull-request');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// TD-033 [P1] — invalid REAL tea-tr output fails the final gate and blocks PR
// (AC #4)
// ═══════════════════════════════════════════════════════════════════════════

describe('Final gate — invalid real tea-tr output blocks the PR tail (TD-033)', () => {
  it('empty tea-tr output fails schema (once output_format lands); PR must NOT run', async () => {
    const run = await runV2Dag({
      cwd: cwdFixture,
      arguments: CANONICAL_REF,
      nodeResponses: {
        'code-review-auto': validCrEvidence(),
        'tea-automate': validTaEvidence({ test_files_changed: 3, nfr_relevant: 'true' }),
        'dev-story': {},
        'tea-rv': validRvGate(),
        'tea-nr': validNrGate(),
        // Empty output → once tea-tr declares output_format, the final gate fails
        // schema validation and the PR tail must fail closed on it.
        'tea-tr': {},
        'create-pull-request': {},
      },
    });

    expect(
      run.nodeState['tea-tr'],
      'tea-tr with no schema-valid gate output must fail (not silently pass)'
    ).toBe('failed');
    expect(
      run.providerCalls,
      'create-pull-request must be unreachable after the final gate failed'
    ).not.toContain('create-pull-request');
  });

  it('a real tea-tr gate emitting SKIPPED violates its enum and must fail', async () => {
    const run = await runV2Dag({
      cwd: cwdFixture,
      arguments: CANONICAL_REF,
      nodeResponses: {
        'code-review-auto': validCrEvidence(),
        'tea-automate': validTaEvidence({ test_files_changed: 3, nfr_relevant: 'true' }),
        ...happyDownstream(),
        // A real TR gate emitting SKIPPED violates the gate enum → must fail.
        'tea-tr': validTrGate({ gate: 'SKIPPED' }),
      },
    });
    expect(
      run.nodeState['tea-tr'],
      'real tea-tr emitting SKIPPED must fail schema (SKIPPED belongs to tea-tr-skipped only)'
    ).toBe('failed');
    expect(run.providerCalls).not.toContain('create-pull-request');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// TD-024 [P1] behavioral note — the false path (tea-tr-skipped emits a parsed
// SKIPPED contract) cannot be driven behaviorally without faking gate-planner,
// which TD-029 forbids: the real gate-planner hardcodes run_tr=true. The false
// path CONTRACT is proven structurally (contract file TD-024) and by the
// condition-evaluator (TD-029). Here we only assert the happy-path invariant:
// tea-tr-skipped is skipped and writes no contract when run_tr is true.
// ═══════════════════════════════════════════════════════════════════════════

describe('TR skip contract — false path documented, not faked (TD-024 behavioral note)', () => {
  it('happy path never emits a tea-tr-skipped contract because run_tr is true', async () => {
    const run = await runV2Dag({
      cwd: cwdFixture,
      arguments: CANONICAL_REF,
      nodeResponses: {
        'code-review-auto': validCrEvidence(),
        'tea-automate': validTaEvidence({ test_files_changed: 3, nfr_relevant: 'true' }),
        ...happyDownstream(),
      },
    });
    expect(run.nodeState['tea-tr-skipped'], 'run_tr=true → tea-tr-skipped is skipped').toBe(
      'skipped'
    );
    const contract = await readSkipContract(run.artifactsDir, 'tea-tr-skipped');
    expect(contract, 'a skipped node writes no gate contract on the happy path').toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// TD-043 [P0] — schema-valid tea-tr gate:"FAIL" completes tea-tr and the
// quality-gate-summary aggregator emits a FAIL summary (the aggregator evolves the
// precursor barrier: FAIL is a valid routing decision, not a hard error).
// Routing on the FAIL summary is a later story.
// ═══════════════════════════════════════════════════════════════════════════

describe('TR gate FAIL — schema-valid, aggregator emits FAIL summary (TD-043)', () => {
  it('tea-tr gate:"FAIL" completes tea-tr (schema passes) and quality-gate-summary completes with FAIL summary', async () => {
    const run = await runV2Dag({
      cwd: cwdFixture,
      arguments: CANONICAL_REF,
      nodeResponses: {
        'code-review-auto': validCrEvidence(),
        'tea-automate': validTaEvidence({ test_files_changed: 3, nfr_relevant: 'true' }),
        ...happyDownstream(),
        'tea-tr': validTrGate({ gate: 'FAIL' }),
      },
    });

    expect(
      run.nodeState['tea-tr'],
      'schema-valid FAIL gate must complete tea-tr (output_format passes)'
    ).toBe('completed');
    expect(
      run.nodeState['quality-gate-summary'],
      'FAIL is a valid routing decision — aggregator completes (exit 0), not hard-fails'
    ).toBe('completed');
    expect(
      run.providerCalls,
      'FAIL summary routes negative to dev-story (loop iterates), PR is NOT reached'
    ).not.toContain('create-pull-request');
    expect(
      run.providerCalls.filter(c => c === 'dev-story').length,
      'FAIL causes the quality loop to re-enter dev-story'
    ).toBeGreaterThan(1);
  });

  it('tea-tr gate:"ERROR" completes tea-tr but quality-gate-summary blocks PR', async () => {
    const run = await runV2Dag({
      cwd: cwdFixture,
      arguments: CANONICAL_REF,
      nodeResponses: {
        'code-review-auto': validCrEvidence(),
        'tea-automate': validTaEvidence({ test_files_changed: 3, nfr_relevant: 'true' }),
        ...happyDownstream(),
        'tea-tr': validTrGate({ gate: 'ERROR' }),
      },
    });

    expect(run.nodeState['tea-tr']).toBe('completed');
    expect(run.nodeState['quality-gate-summary']).toBe('failed');
    expect(run.providerCalls).not.toContain('create-pull-request');
  });

  it('tea-tr gate:"CONCERNS" is non-blocking at summary level but fails decision-needed-check closed (blocks PR)', async () => {
    const run = await runV2Dag({
      cwd: cwdFixture,
      arguments: CANONICAL_REF,
      nodeResponses: {
        'code-review-auto': validCrEvidence(),
        'tea-automate': validTaEvidence({ test_files_changed: 3, nfr_relevant: 'true' }),
        ...happyDownstream(),
        'tea-tr': validTrGate({ gate: 'CONCERNS' }),
      },
    });

    expect(run.nodeState['tea-tr']).toBe('completed');
    expect(
      run.nodeState['quality-gate-summary'],
      'CONCERNS is non-blocking at the summary level (matches RV/NR policy)'
    ).toBe('completed');
    expect(
      run.nodeState['decision-needed-check'],
      'CONCERNS raises decision_needed_count to 1, failing the decision node closed'
    ).toBe('failed');
    expect(
      run.providerCalls,
      'decision-needed-check fail-closed blocks PR when CONCERNS items exist'
    ).not.toContain('create-pull-request');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// TD-044 [P0] — envelope validation: mismatched story_ref blocks PR
// ═══════════════════════════════════════════════════════════════════════════

describe('TR envelope — mismatched story_ref blocks PR (TD-044)', () => {
  it('tea-tr with story_ref not matching resolved input fails the barrier', async () => {
    const run = await runV2Dag({
      cwd: cwdFixture,
      arguments: CANONICAL_REF,
      nodeResponses: {
        'code-review-auto': validCrEvidence(),
        'tea-automate': validTaEvidence({ test_files_changed: 3, nfr_relevant: 'true' }),
        ...happyDownstream(),
        'tea-tr': validTrGate({ story_ref: 'stale-story-ref' }),
      },
    });

    expect(run.nodeState['tea-tr']).toBe('completed');
    expect(
      run.nodeState['quality-gate-summary'],
      'quality-gate-summary must block on story_ref mismatch'
    ).toBe('failed');
    expect(run.providerCalls).not.toContain('create-pull-request');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// TD-045 [P0] — envelope validation: mismatched node identity blocks PR
// ═══════════════════════════════════════════════════════════════════════════

describe('TR envelope — mismatched node identity blocks PR (TD-045)', () => {
  it('tea-tr with node:"tea-rv" (wrong self-identification) fails the barrier', async () => {
    const run = await runV2Dag({
      cwd: cwdFixture,
      arguments: CANONICAL_REF,
      nodeResponses: {
        'code-review-auto': validCrEvidence(),
        'tea-automate': validTaEvidence({ test_files_changed: 3, nfr_relevant: 'true' }),
        ...happyDownstream(),
        'tea-tr': validTrGate({ node: 'tea-rv' }),
      },
    });

    expect(run.nodeState['tea-tr']).toBe('completed');
    expect(
      run.nodeState['quality-gate-summary'],
      'quality-gate-summary must block on node identity mismatch'
    ).toBe('failed');
    expect(run.providerCalls).not.toContain('create-pull-request');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// TD-046 [P0] — envelope validation: negative findings_count blocks PR
// ═══════════════════════════════════════════════════════════════════════════

describe('TR envelope — negative findings_count blocks PR (TD-046)', () => {
  it('tea-tr with findings_count:-1 fails the barrier', async () => {
    const run = await runV2Dag({
      cwd: cwdFixture,
      arguments: CANONICAL_REF,
      nodeResponses: {
        'code-review-auto': validCrEvidence(),
        'tea-automate': validTaEvidence({ test_files_changed: 3, nfr_relevant: 'true' }),
        ...happyDownstream(),
        'tea-tr': validTrGate({ findings_count: -1 }),
      },
    });

    expect(run.nodeState['tea-tr']).toBe('completed');
    expect(
      run.nodeState['quality-gate-summary'],
      'quality-gate-summary must block on negative findings_count'
    ).toBe('failed');
    expect(run.providerCalls).not.toContain('create-pull-request');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// TD-047 [P0] — substring false-positive proof: an unrelated field
// containing a gate-looking substring must NOT block when the actual gate
// is PASS
// ═══════════════════════════════════════════════════════════════════════════

describe('TR gate — substring false positive does not block (TD-047)', () => {
  it('tea-tr with report_file containing "gate":"FAIL" substring passes the barrier when actual gate is PASS', async () => {
    const run = await runV2Dag({
      cwd: cwdFixture,
      arguments: CANONICAL_REF,
      nodeResponses: {
        'code-review-auto': validCrEvidence(),
        'tea-automate': validTaEvidence({ test_files_changed: 3, nfr_relevant: 'true' }),
        ...happyDownstream(),
        'tea-tr': validTrGate({ report_file: 'report-"gate":"FAIL"-leftover.md' }),
      },
    });

    expect(run.nodeState['tea-tr']).toBe('completed');
    expect(
      run.nodeState['quality-gate-summary'],
      'JSON.parse must read the actual gate field, not match substrings in other fields'
    ).toBe('completed');
    expect(
      run.providerCalls,
      'create-pull-request must be reached when actual gate is PASS regardless of substring noise'
    ).toContain('create-pull-request');
  });
});
