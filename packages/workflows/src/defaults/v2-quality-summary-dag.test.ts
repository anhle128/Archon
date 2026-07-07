/**
 * RED-PHASE ATDD acceptance scaffolds — `quality-gate-summary` as the four-role
 * route-facing aggregator.
 *
 * Behavioral / DAG-level acceptance tests that drive the REAL executor + REAL
 * bash nodes (resolve-story-input, verify-story-identity, gate-planner, and the
 * *-skipped skip encoders) through the v2 DAG. Only AI provider nodes
 * (dev-story / tea-automate / code-review-auto / tea-rv / tea-nr / tea-tr /
 * create-pull-request) are mocked; the aggregator bash and every deterministic
 * gate node execute for real. A mocked gate-planner would be a fake test — the
 * real gate-planner's flag policy (run_rv when test_files_changed>0, run_nr when
 * nfr_relevant=="true", run_tr always) is what lets these fixtures choose which
 * RV/NR/TR branch resolves.
 *
 * ── TDD RED PHASE ──────────────────────────────────────────────────────────
 * These assert the TARGET behavior of the not-yet-implemented aggregator and are
 * EXPECTED TO FAIL until the v2 YAML evolves `quality-gate-summary` into the
 * eight-source aggregator (CR + the six RV/NR/TR branches + resolve-story-input)
 * that validates identity fail-closed and emits quality-gate-summary.json with a
 * PASS|FAIL routing gate plus a preserved decision_needed_count. Routing on that
 * contract (FAIL->dev-story, PASS->PR) is a LATER story — this story only emits
 * the contract, so on a role FAIL the aggregator COMPLETES (exit 0, gate:"FAIL")
 * rather than blocking the PR. Only ERROR / missing / identity-mismatch source
 * contracts hard-fail the node (exit 1, no contract).
 *
 * ── ISOLATION ──────────────────────────────────────────────────────────────
 * This file uses mock.module('@archon/paths', ...). Bun's mock.module() is
 * process-global and irreversible, so this file MUST run as its OWN isolated
 * `bun test` invocation — it is registered as a standalone segment in
 * packages/workflows/package.json, never co-located with another test file.
 * Run it directly in red phase with:
 *   bun test packages/workflows/src/defaults/v2-quality-summary-dag.test.ts
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
  id: 'quality-summary-run-id',
  workflow_name: V2_STEM,
  conversation_id: 'conv-qs',
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
    id: 'quality-summary-run-id',
    workflow_name: V2_STEM,
    conversation_id: 'conv-qs',
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
  const cwd = join(baseDir, 'quality-summary-fixture');
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
      'conv-qs',
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

// ── Summary-contract capture ───────────────────────────────────────────────
// quality-gate-summary declares output_type, so the executor writes a typed
// sidecar at nodes/<id>.md; the bash body also best-effort writes
// $RUN_DIR/quality-gate-summary.json. Read whichever resolved.

async function readSummaryContract(artifactsDir: string): Promise<Record<string, unknown> | null> {
  const candidates = [
    join(artifactsDir, 'nodes', 'quality-gate-summary.md'),
    join(artifactsDir, 'bmad-dev-story-with-tea-fix-loop', 'quality-gate-summary.json'),
  ];
  for (const path of candidates) {
    if (!existsSync(path)) continue;
    const raw = (await readFile(path, 'utf-8')).trim();
    if (!raw) continue;
    try {
      return JSON.parse(raw) as Record<string, unknown>;
    } catch {
      throw new Error(`quality-gate-summary contract is not valid JSON: ${raw.slice(0, 200)}`);
    }
  }
  return null;
}

// ── Evidence builders ──────────────────────────────────────────────────────

// CR is the only role carrying `round` — the summary sources its round from it.
// CR gate must be PASS/CONCERNS to clear verify-story-identity + code-review-gate
// and reach the aggregator (FAIL loops back to dev-story, ERROR hard-fails).
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

// gate-planner reads test_files_changed (drives run_rv) and nfr_relevant
// (drives run_nr). Defaults run BOTH RV and NR real.
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

// Build a full nodeResponses map for a run where CR passes review and RV/NR/TR
// each run real (test_files_changed>0, nfr_relevant=="true", run_tr always).
function baseResponses(
  overrides: {
    cr?: Record<string, unknown>;
    ta?: Record<string, unknown>;
    rv?: Record<string, unknown>;
    nr?: Record<string, unknown>;
    tr?: Record<string, unknown>;
  } = {}
): Record<string, Record<string, unknown>> {
  return {
    'code-review-auto': overrides.cr ?? validCrEvidence(),
    'tea-automate':
      overrides.ta ?? validTaEvidence({ test_files_changed: 3, nfr_relevant: 'true' }),
    'dev-story': {},
    'tea-rv': overrides.rv ?? validRvGate(),
    'tea-nr': overrides.nr ?? validNrGate(),
    'tea-tr': overrides.tr ?? validTrGate(),
    'create-pull-request': {},
  };
}

// ── Fixture lifecycle ──────────────────────────────────────────────────────

let fixtureBase = '';
let cwdFixture = '';

beforeAll(async () => {
  fixtureBase = join(tmpdir(), `quality-summary-dag-${process.pid}`);
  cwdFixture = await buildFixtureDir(fixtureBase);
});

afterAll(async () => {
  await rm(fixtureBase, { recursive: true, force: true });
});

// ═══════════════════════════════════════════════════════════════════════════
// TD-130 [P0] — all four roles PASS → summary PASS, zero blocking, zero
// decision-needed, zero findings, PR reached (AC #1, #4)
// ═══════════════════════════════════════════════════════════════════════════

describe('Happy path — all four roles PASS yields a clean PASS summary (TD-130)', () => {
  it('all real PASS → gate PASS, blocking_count 0, decision_needed_count 0, findings_total 0', async () => {
    const run = await runV2Dag({
      cwd: cwdFixture,
      arguments: CANONICAL_REF,
      nodeResponses: baseResponses(),
    });

    expect(
      run.nodeState['quality-gate-summary'],
      'aggregator must complete on the happy path'
    ).toBe('completed');
    const c = await readSummaryContract(run.artifactsDir);
    expect(c, 'aggregator must emit quality-gate-summary.json').not.toBeNull();
    expect(c!.gate, 'all PASS → PASS').toBe('PASS');
    expect(c!.blocking_count, 'no blocking roles').toBe(0);
    expect(c!.decision_needed_count, 'no decision-needed roles').toBe(0);
    expect(c!.findings_total, 'zero findings across roles').toBe(0);
    expect(c!.round, 'round sourced from the CR contract').toBe(1);
    expect(c!.story_ref, 'story_ref is the resolved canonical key').toBe(CANONICAL_REF);
    expect([c!.cr_gate, c!.rv_gate, c!.nr_gate, c!.tr_gate], 'all per-role echoes PASS').toEqual([
      'PASS',
      'PASS',
      'PASS',
      'PASS',
    ]);
    expect(run.providerCalls, 'PR tail reached on a PASS summary').toContain('create-pull-request');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// TD-131 [P1] — resolved skipped roles echo SKIPPED without inflating the
// decision-needed count (AC #1, #4)
// ═══════════════════════════════════════════════════════════════════════════

describe('Skip path — skipped roles echo SKIPPED, not counted (TD-131)', () => {
  it('RV+NR skipped (no test files, no NFR) → rv_gate/nr_gate SKIPPED, decision_needed_count 0', async () => {
    const run = await runV2Dag({
      cwd: cwdFixture,
      arguments: CANONICAL_REF,
      nodeResponses: baseResponses({
        // test_files_changed:0 → run_rv=false; nfr_relevant:"false" → run_nr=false.
        ta: validTaEvidence({ test_files_changed: 0, nfr_relevant: 'false' }),
      }),
    });

    // The skip siblings resolve; the real RV/NR nodes are condition-skipped.
    expect(run.nodeState['tea-rv-skipped'], 'RV skip sibling must resolve').toBe('completed');
    expect(run.nodeState['tea-nr-skipped'], 'NR skip sibling must resolve').toBe('completed');
    expect(run.nodeState['tea-rv'], 'real RV must be skipped').toBe('skipped');
    expect(run.nodeState['tea-nr'], 'real NR must be skipped').toBe('skipped');

    const c = await readSummaryContract(run.artifactsDir);
    expect(c, 'aggregator must still emit a summary').not.toBeNull();
    expect(c!.rv_gate, 'skipped RV echoes SKIPPED').toBe('SKIPPED');
    expect(c!.nr_gate, 'skipped NR echoes SKIPPED').toBe('SKIPPED');
    expect(c!.tr_gate, 'TR still runs real').toBe('PASS');
    expect(c!.decision_needed_count, 'SKIPPED roles are not decision-needed').toBe(0);
    expect(c!.gate, 'skipped-plus-pass roles yield PASS').toBe('PASS');
    expect(run.providerCalls, 'PR reached on a PASS summary with skipped roles').toContain(
      'create-pull-request'
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// TD-111 [P1] — real RV FAIL → summary FAIL, blocking recorded, PR NOT asserted
// (routing on the contract is a later story) (AC #2)
// ═══════════════════════════════════════════════════════════════════════════

describe('Blocking RV — real RV gate FAIL produces a FAIL summary (TD-111)', () => {
  it('RV gate FAIL → summary completes with gate FAIL, blocking_count>=1, rv_gate FAIL', async () => {
    const run = await runV2Dag({
      cwd: cwdFixture,
      arguments: CANONICAL_REF,
      nodeResponses: baseResponses({ rv: validRvGate({ gate: 'FAIL', findings_count: 2 }) }),
    });

    // A schema-valid FAIL gate COMPLETES the role node (output_format passes);
    // the aggregator records it as blocking but does not hard-fail (exit 0).
    expect(run.nodeState['tea-rv'], 'schema-valid FAIL completes the RV node').toBe('completed');
    expect(run.nodeState['quality-gate-summary'], 'FAIL is a valid routing decision (exit 0)').toBe(
      'completed'
    );
    const c = await readSummaryContract(run.artifactsDir);
    expect(c!.gate, 'any role FAIL → summary FAIL').toBe('FAIL');
    expect(
      c!.blocking_count as number,
      'at least one blocking role recorded'
    ).toBeGreaterThanOrEqual(1);
    expect(c!.rv_gate, 'RV block preserved in the per-role echo').toBe('FAIL');
    // PR reachability on a FAIL summary is intentionally NOT asserted here —
    // FAIL->dev-story routing is a later story; a4.1 only emits the contract.
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// TD-112 [P1] — real NR FAIL → summary FAIL (AC #2)
// ═══════════════════════════════════════════════════════════════════════════

describe('Blocking NR — real NR gate FAIL produces a FAIL summary (TD-112)', () => {
  it('NR gate FAIL → summary FAIL, nr_gate FAIL', async () => {
    const run = await runV2Dag({
      cwd: cwdFixture,
      arguments: CANONICAL_REF,
      nodeResponses: baseResponses({ nr: validNrGate({ gate: 'FAIL', findings_count: 1 }) }),
    });

    expect(run.nodeState['tea-nr']).toBe('completed');
    expect(run.nodeState['quality-gate-summary']).toBe('completed');
    const c = await readSummaryContract(run.artifactsDir);
    expect(c!.gate).toBe('FAIL');
    expect(c!.nr_gate).toBe('FAIL');
    expect(c!.blocking_count as number).toBeGreaterThanOrEqual(1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// TD-113 [P1] — real TR FAIL → summary FAIL (AC #2)
// ═══════════════════════════════════════════════════════════════════════════

describe('Blocking TR — real TR gate FAIL produces a FAIL summary (TD-113)', () => {
  it('TR gate FAIL → summary FAIL, tr_gate FAIL', async () => {
    const run = await runV2Dag({
      cwd: cwdFixture,
      arguments: CANONICAL_REF,
      nodeResponses: baseResponses({ tr: validTrGate({ gate: 'FAIL', findings_count: 3 }) }),
    });

    expect(run.nodeState['tea-tr']).toBe('completed');
    expect(run.nodeState['quality-gate-summary']).toBe('completed');
    const c = await readSummaryContract(run.artifactsDir);
    expect(c!.gate).toBe('FAIL');
    expect(c!.tr_gate).toBe('FAIL');
    expect(c!.blocking_count as number).toBeGreaterThanOrEqual(1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// TD-114 [P1] — multiple role FAIL → blocking_count reflects every blocker,
// findings_total sums (AC #2)
// ═══════════════════════════════════════════════════════════════════════════

describe('Multi-blocker — several role FAILs sum into blocking_count (TD-114)', () => {
  it('RV+NR+TR all FAIL → gate FAIL, blocking_count 3, findings_total summed', async () => {
    const run = await runV2Dag({
      cwd: cwdFixture,
      arguments: CANONICAL_REF,
      nodeResponses: baseResponses({
        rv: validRvGate({ gate: 'FAIL', findings_count: 2 }),
        nr: validNrGate({ gate: 'FAIL', findings_count: 1 }),
        tr: validTrGate({ gate: 'FAIL', findings_count: 4 }),
      }),
    });

    const c = await readSummaryContract(run.artifactsDir);
    expect(c!.gate).toBe('FAIL');
    expect(c!.blocking_count, 'three blocking roles').toBe(3);
    expect(c!.findings_total, 'findings summed across resolved roles (2+1+4, CR 0)').toBe(7);
    expect([c!.rv_gate, c!.nr_gate, c!.tr_gate]).toEqual(['FAIL', 'FAIL', 'FAIL']);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// TD-110 [P1] — CR FAIL is intercepted upstream and never reaches the aggregator
// (documented, not faked). Skipped scaffold. (AC #2)
// ═══════════════════════════════════════════════════════════════════════════

describe('Blocking CR — intercepted by the review loop, not the aggregator (TD-110)', () => {
  // WHY SKIPPED: a CR gate:"FAIL" is routed to the dev-story fix loop by
  // code-review-gate (negative route), and a CR gate:"ERROR" hard-fails at
  // verify-story-identity. Neither ever reaches quality-gate-summary, so a
  // "cr_gate:FAIL → summary FAIL" path cannot be driven through the real DAG
  // without faking the review loop. The aggregator's cr_gate-FAIL blocking
  // policy is proven at the arithmetic level in the contract test (TD-150,
  // "multiple FAIL roles"). ACTIVATE this scaffold only if the workflow is ever
  // rewired so a non-PASS CR reaches the aggregator directly.
  it.skip('cr_gate FAIL → summary FAIL (unreachable: CR FAIL loops back to dev-story)', () => {
    expect(true).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// TD-120 [P1] — one role CONCERNS, no FAIL/ERROR → PASS + decision_needed_count 1
// (AC #3)
// ═══════════════════════════════════════════════════════════════════════════

describe('Decision-needed — one CONCERNS role yields PASS with a preserved count (TD-120)', () => {
  it('TR gate CONCERNS (others PASS) → gate PASS, decision_needed_count 1, tr_gate CONCERNS', async () => {
    const run = await runV2Dag({
      cwd: cwdFixture,
      arguments: CANONICAL_REF,
      nodeResponses: baseResponses({ tr: validTrGate({ gate: 'CONCERNS', findings_count: 2 }) }),
    });

    expect(
      run.nodeState['quality-gate-summary'],
      'CONCERNS is non-blocking → summary completes'
    ).toBe('completed');
    const c = await readSummaryContract(run.artifactsDir);
    expect(c!.gate, 'CONCERNS-only → PASS').toBe('PASS');
    expect(c!.decision_needed_count, 'the single CONCERNS role is preserved as a count').toBe(1);
    expect(c!.blocking_count, 'CONCERNS does not block').toBe(0);
    expect(c!.tr_gate, 'the CONCERNS role echo is preserved').toBe('CONCERNS');
    expect(run.providerCalls, 'PR reached on a PASS-with-concerns summary').toContain(
      'create-pull-request'
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// TD-121 [P1] — multiple CONCERNS roles → PASS, count all concerned roles
// (AC #3)
// ═══════════════════════════════════════════════════════════════════════════

describe('Decision-needed boundary — every CONCERNS role is counted (TD-121)', () => {
  it('RV+NR+TR all CONCERNS → gate PASS, decision_needed_count 3', async () => {
    const run = await runV2Dag({
      cwd: cwdFixture,
      arguments: CANONICAL_REF,
      nodeResponses: baseResponses({
        rv: validRvGate({ gate: 'CONCERNS', findings_count: 1 }),
        nr: validNrGate({ gate: 'CONCERNS', findings_count: 1 }),
        tr: validTrGate({ gate: 'CONCERNS', findings_count: 1 }),
      }),
    });

    const c = await readSummaryContract(run.artifactsDir);
    expect(c!.gate).toBe('PASS');
    expect(c!.decision_needed_count, 'all three CONCERNS roles counted').toBe(3);
    expect(c!.blocking_count).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// TD-140 [P0] — missing/empty required CR contract fails closed: no summary, no
// route decision, PR unreachable (AC #5)
// ═══════════════════════════════════════════════════════════════════════════

describe('Fail-closed — missing required CR contract blocks everything (TD-140)', () => {
  it('empty CR output → CR fails schema, aggregator never emits, PR unreachable', async () => {
    const run = await runV2Dag({
      cwd: cwdFixture,
      arguments: CANONICAL_REF,
      nodeResponses: baseResponses({ cr: {} }),
    });

    expect(run.nodeState['code-review-auto'], 'empty CR output must fail schema').toBe('failed');
    expect(
      run.nodeState['quality-gate-summary'],
      'a failed required source must prevent the aggregator from completing'
    ).not.toBe('completed');
    expect(await readSummaryContract(run.artifactsDir), 'no summary on a missing CR').toBeNull();
    expect(run.providerCalls, 'PR unreachable when CR is missing').not.toContain(
      'create-pull-request'
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// TD-141 [P0] — resolved optional role with an empty real output (skip sibling
// condition-skipped) fails closed — no route decision (AC #5)
// ═══════════════════════════════════════════════════════════════════════════

describe('Fail-closed — resolved-optional role with no valid output (TD-141)', () => {
  it('RV runs real but emits empty output → tea-rv fails, aggregator never emits, PR unreachable', async () => {
    const run = await runV2Dag({
      cwd: cwdFixture,
      arguments: CANONICAL_REF,
      // test_files_changed>0 → run_rv=true → real RV runs; empty output fails schema.
      nodeResponses: baseResponses({ rv: {} }),
    });

    expect(run.nodeState['tea-rv'], 'real RV with no schema-valid output must fail').toBe('failed');
    expect(run.nodeState['tea-rv-skipped'], 'the skip sibling stays condition-skipped').toBe(
      'skipped'
    );
    expect(
      run.nodeState['quality-gate-summary'],
      'a resolved-optional role with neither a real success nor a skip must block the aggregator'
    ).not.toBe('completed');
    expect(await readSummaryContract(run.artifactsDir)).toBeNull();
    expect(run.providerCalls).not.toContain('create-pull-request');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// TD-142 [P0] — mismatched story_ref on a source contract fails closed before
// emission (AC #5)
// ═══════════════════════════════════════════════════════════════════════════

describe('Fail-closed — mismatched story_ref (TD-142)', () => {
  it('TR gate with a stale story_ref → aggregator hard-fails, no summary, PR unreachable', async () => {
    const run = await runV2Dag({
      cwd: cwdFixture,
      arguments: CANONICAL_REF,
      nodeResponses: baseResponses({ tr: validTrGate({ story_ref: 'stale-story-ref' }) }),
    });

    expect(run.nodeState['tea-tr'], 'schema-valid but wrong-identity TR still completes').toBe(
      'completed'
    );
    expect(
      run.nodeState['quality-gate-summary'],
      'story_ref mismatch is an identity ERROR — the aggregator must hard-fail'
    ).toBe('failed');
    expect(
      await readSummaryContract(run.artifactsDir),
      'no summary on identity mismatch'
    ).toBeNull();
    expect(run.providerCalls).not.toContain('create-pull-request');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// TD-143 [P0] — mismatched contract_version fails closed (AC #5)
// ═══════════════════════════════════════════════════════════════════════════

describe('Fail-closed — mismatched contract_version (TD-143)', () => {
  it('NR contract_version 0.9 → aggregator hard-fails, no summary', async () => {
    const run = await runV2Dag({
      cwd: cwdFixture,
      arguments: CANONICAL_REF,
      nodeResponses: baseResponses({ nr: validNrGate({ contract_version: '0.9' }) }),
    });

    expect(run.nodeState['tea-nr']).toBe('completed');
    expect(run.nodeState['quality-gate-summary']).toBe('failed');
    expect(await readSummaryContract(run.artifactsDir)).toBeNull();
    expect(run.providerCalls).not.toContain('create-pull-request');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// TD-144 [P0] — mismatched workflow fails closed (AC #5)
// ═══════════════════════════════════════════════════════════════════════════

describe('Fail-closed — mismatched workflow identity (TD-144)', () => {
  it('RV workflow set to another workflow → aggregator hard-fails, no summary', async () => {
    const run = await runV2Dag({
      cwd: cwdFixture,
      arguments: CANONICAL_REF,
      nodeResponses: baseResponses({ rv: validRvGate({ workflow: 'some-other-workflow' }) }),
    });

    expect(run.nodeState['tea-rv']).toBe('completed');
    expect(run.nodeState['quality-gate-summary']).toBe('failed');
    expect(await readSummaryContract(run.artifactsDir)).toBeNull();
    expect(run.providerCalls).not.toContain('create-pull-request');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// TD-145 [P0] — mismatched producer node identity fails closed (AC #5)
// ═══════════════════════════════════════════════════════════════════════════

describe('Fail-closed — wrong producer node identity (TD-145)', () => {
  it('NR contract self-identifying node:"tea-rv" → aggregator hard-fails, no summary', async () => {
    const run = await runV2Dag({
      cwd: cwdFixture,
      arguments: CANONICAL_REF,
      nodeResponses: baseResponses({ nr: validNrGate({ node: 'tea-rv' }) }),
    });

    expect(run.nodeState['tea-nr']).toBe('completed');
    expect(run.nodeState['quality-gate-summary']).toBe('failed');
    expect(await readSummaryContract(run.artifactsDir)).toBeNull();
    expect(run.providerCalls).not.toContain('create-pull-request');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// TD-146 [P0] — a role gate:"ERROR" hard-fails the aggregator (ERROR != FAIL);
// no PASS/FAIL route decision emitted (AC #5)
// ═══════════════════════════════════════════════════════════════════════════

describe('Fail-closed — role ERROR is a hard failure, not a routable FAIL (TD-146)', () => {
  it('TR gate ERROR → aggregator hard-fails (exit 1), emits NO summary contract', async () => {
    const run = await runV2Dag({
      cwd: cwdFixture,
      arguments: CANONICAL_REF,
      nodeResponses: baseResponses({ tr: validTrGate({ gate: 'ERROR' }) }),
    });

    expect(run.nodeState['tea-tr'], 'schema-valid ERROR gate completes the TR node').toBe(
      'completed'
    );
    expect(
      run.nodeState['quality-gate-summary'],
      'a role ERROR must hard-fail the aggregator, distinct from a routable FAIL'
    ).toBe('failed');
    expect(
      await readSummaryContract(run.artifactsDir),
      'no PASS/FAIL route decision may be emitted on a role ERROR'
    ).toBeNull();
    expect(run.providerCalls).not.toContain('create-pull-request');
  });

  it('contrast: TR gate FAIL emits a summary while TR gate ERROR does not', async () => {
    const failRun = await runV2Dag({
      cwd: cwdFixture,
      arguments: CANONICAL_REF,
      nodeResponses: baseResponses({ tr: validTrGate({ gate: 'FAIL' }) }),
    });
    const errRun = await runV2Dag({
      cwd: cwdFixture,
      arguments: CANONICAL_REF,
      nodeResponses: baseResponses({ tr: validTrGate({ gate: 'ERROR' }) }),
    });
    expect((await readSummaryContract(failRun.artifactsDir))?.gate, 'FAIL is routable').toBe(
      'FAIL'
    );
    expect(await readSummaryContract(errRun.artifactsDir), 'ERROR is not routable').toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// TD-147 [P0] — malformed selected JSON fails closed. The behavioral injection
// seam does not exist in this harness (schema-validated provider nodes and the
// bash skip encoders both always emit valid JSON). Skipped scaffold; the
// malformed-JSON hardening is proven executably by the encoder technique proofs
// in the contract test (TD-105 special chars, TD-151 substring immunity).
// ═══════════════════════════════════════════════════════════════════════════

describe('Fail-closed — malformed selected JSON (TD-147)', () => {
  // WHY SKIPPED: every source that feeds the aggregator emits well-formed JSON
  // (AI nodes via structuredOutput; skip siblings via bun JSON.stringify), so a
  // genuinely malformed contract cannot be injected mid-DAG through this harness.
  // ACTIVATE when a fault-injection seam exists (e.g. a source node able to emit
  // raw non-JSON stdout that the aggregator must reject with a non-zero exit).
  it.skip('a malformed source contract makes the aggregator fail closed with no summary', () => {
    expect(true).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// TD-148 [P1] — invalid numeric field (negative findings_count) fails closed
// (AC #5)
// ═══════════════════════════════════════════════════════════════════════════

describe('Fail-closed — invalid numeric contract field (TD-148)', () => {
  it('TR findings_count:-1 → aggregator hard-fails, no summary', async () => {
    const run = await runV2Dag({
      cwd: cwdFixture,
      arguments: CANONICAL_REF,
      nodeResponses: baseResponses({ tr: validTrGate({ findings_count: -1 }) }),
    });

    expect(run.nodeState['tea-tr'], 'source schema tolerates -1; identity gate rejects it').toBe(
      'completed'
    );
    expect(run.nodeState['quality-gate-summary']).toBe('failed');
    expect(await readSummaryContract(run.artifactsDir)).toBeNull();
    expect(run.providerCalls).not.toContain('create-pull-request');
  });

  it('missing CR round is caught upstream at the CR source node (no summary)', async () => {
    // A CR contract without `round` fails code-review-auto's own output_format,
    // so the review path never reaches the aggregator — fail-closed at source.
    const run = await runV2Dag({
      cwd: cwdFixture,
      arguments: CANONICAL_REF,
      nodeResponses: baseResponses({ cr: validCrEvidence({ round: undefined }) }),
    });
    expect(run.nodeState['quality-gate-summary']).not.toBe('completed');
    expect(await readSummaryContract(run.artifactsDir)).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// TD-170 [P1] — invalid CR round (negative or fractional) fails closed at the
// aggregator before any summary is emitted (AC #5)
// ═══════════════════════════════════════════════════════════════════════════

describe('Fail-closed — invalid CR round (TD-170)', () => {
  it('CR round:-1 → aggregator hard-fails, no summary, PR unreachable', async () => {
    const run = await runV2Dag({
      cwd: cwdFixture,
      arguments: CANONICAL_REF,
      nodeResponses: baseResponses({ cr: validCrEvidence({ round: -1 }) }),
    });

    expect(run.nodeState['code-review-auto'], 'source schema tolerates -1').toBe('completed');
    expect(
      run.nodeState['quality-gate-summary'],
      'aggregator must reject a negative CR round'
    ).toBe('failed');
    expect(await readSummaryContract(run.artifactsDir), 'no summary on negative round').toBeNull();
    expect(run.providerCalls, 'PR unreachable on invalid round').not.toContain(
      'create-pull-request'
    );
  });

  it('CR round:1.5 → aggregator hard-fails, no summary, PR unreachable', async () => {
    const run = await runV2Dag({
      cwd: cwdFixture,
      arguments: CANONICAL_REF,
      nodeResponses: baseResponses({ cr: validCrEvidence({ round: 1.5 }) }),
    });

    expect(run.nodeState['code-review-auto'], 'source schema tolerates 1.5').toBe('completed');
    expect(
      run.nodeState['quality-gate-summary'],
      'aggregator must reject a fractional CR round'
    ).toBe('failed');
    expect(
      await readSummaryContract(run.artifactsDir),
      'no summary on fractional round'
    ).toBeNull();
    expect(run.providerCalls, 'PR unreachable on invalid round').not.toContain(
      'create-pull-request'
    );
  });

  it('CR round:0 → aggregator hard-fails, no summary', async () => {
    const run = await runV2Dag({
      cwd: cwdFixture,
      arguments: CANONICAL_REF,
      nodeResponses: baseResponses({ cr: validCrEvidence({ round: 0 }) }),
    });

    expect(run.nodeState['quality-gate-summary']).toBe('failed');
    expect(await readSummaryContract(run.artifactsDir)).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// TD-180 [P0] — a real role output that self-identifies as its skipped
// sibling fails closed (producer-source identity mismatch) (AC #5)
// ═══════════════════════════════════════════════════════════════════════════

describe('Fail-closed — real output self-identifies as skipped sibling (TD-180)', () => {
  it('real RV output with node:"tea-rv-skipped" → aggregator hard-fails, no summary', async () => {
    const run = await runV2Dag({
      cwd: cwdFixture,
      arguments: CANONICAL_REF,
      nodeResponses: baseResponses({ rv: validRvGate({ node: 'tea-rv-skipped' }) }),
    });

    expect(run.nodeState['tea-rv'], 'schema-valid mismatch still completes the source node').toBe(
      'completed'
    );
    expect(
      run.nodeState['quality-gate-summary'],
      'source-tracking identity check must reject the mismatch'
    ).toBe('failed');
    expect(
      await readSummaryContract(run.artifactsDir),
      'no summary on producer-source mismatch'
    ).toBeNull();
    expect(run.providerCalls).not.toContain('create-pull-request');
  });

  it('real NR output with node:"tea-nr-skipped" → aggregator hard-fails, no summary', async () => {
    const run = await runV2Dag({
      cwd: cwdFixture,
      arguments: CANONICAL_REF,
      nodeResponses: baseResponses({ nr: validNrGate({ node: 'tea-nr-skipped' }) }),
    });

    expect(run.nodeState['tea-nr']).toBe('completed');
    expect(run.nodeState['quality-gate-summary']).toBe('failed');
    expect(await readSummaryContract(run.artifactsDir)).toBeNull();
    expect(run.providerCalls).not.toContain('create-pull-request');
  });

  it('real TR output with node:"tea-tr-skipped" → aggregator hard-fails, no summary', async () => {
    const run = await runV2Dag({
      cwd: cwdFixture,
      arguments: CANONICAL_REF,
      nodeResponses: baseResponses({ tr: validTrGate({ node: 'tea-tr-skipped' }) }),
    });

    expect(run.nodeState['tea-tr']).toBe('completed');
    expect(run.nodeState['quality-gate-summary']).toBe('failed');
    expect(await readSummaryContract(run.artifactsDir)).toBeNull();
    expect(run.providerCalls).not.toContain('create-pull-request');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// TD-149 [P1] — failure paths leave stdout + quality-gate-summary.json absent
// (no partial route decision) (AC #5)
// ═══════════════════════════════════════════════════════════════════════════

describe('No partial output — failure paths persist no summary (TD-149)', () => {
  it('a story_ref-mismatch failure writes no summary artifact', async () => {
    const run = await runV2Dag({
      cwd: cwdFixture,
      arguments: CANONICAL_REF,
      nodeResponses: baseResponses({ nr: validNrGate({ story_ref: 'wrong-ref' }) }),
    });
    expect(run.nodeState['quality-gate-summary']).toBe('failed');
    expect(
      await readSummaryContract(run.artifactsDir),
      'a fail-closed path must leave no partial contract behind'
    ).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// TD-150 [P1] — mixed-role boundary: one FAIL + one CONCERNS + rest PASS derives
// blocking_count, decision_needed_count, and findings_total together (AC #2, #3)
// ═══════════════════════════════════════════════════════════════════════════

describe('Mixed boundary — blocking + decision-needed + findings together (TD-150)', () => {
  it('RV FAIL + NR CONCERNS + TR PASS → gate FAIL, blocking 1, decision 1, findings summed', async () => {
    const run = await runV2Dag({
      cwd: cwdFixture,
      arguments: CANONICAL_REF,
      nodeResponses: baseResponses({
        rv: validRvGate({ gate: 'FAIL', findings_count: 3 }),
        nr: validNrGate({ gate: 'CONCERNS', findings_count: 2 }),
        tr: validTrGate({ gate: 'PASS', findings_count: 0 }),
      }),
    });

    const c = await readSummaryContract(run.artifactsDir);
    expect(c!.gate, 'any FAIL dominates → FAIL').toBe('FAIL');
    expect(c!.blocking_count, 'one blocking role').toBe(1);
    expect(c!.decision_needed_count, 'one decision-needed role').toBe(1);
    expect(c!.findings_total, 'findings summed across roles (3+2+0, CR 0)').toBe(5);
    expect(c!.rv_gate).toBe('FAIL');
    expect(c!.nr_gate).toBe('CONCERNS');
    expect(c!.tr_gate).toBe('PASS');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// TD-154 [P0] — a failed real branch prevents the summary AND the PR even when a
// skip sibling exists (trigger-rule fail-closed) (AC #5)
// ═══════════════════════════════════════════════════════════════════════════

describe('Trigger-rule fail-closed — failed real branch blocks summary + PR (TD-154)', () => {
  it('real NR fails while its skip sibling is condition-skipped → no summary, PR unreachable', async () => {
    const run = await runV2Dag({
      cwd: cwdFixture,
      arguments: CANONICAL_REF,
      // nfr_relevant:"true" → run_nr=true → real NR runs; empty output fails it.
      nodeResponses: baseResponses({ nr: {} }),
    });

    expect(run.nodeState['tea-nr'], 'real NR with no valid output must fail').toBe('failed');
    expect(run.nodeState['tea-nr-skipped'], 'the NR skip sibling stays condition-skipped').toBe(
      'skipped'
    );
    expect(
      run.nodeState['quality-gate-summary'],
      'none_failed_min_one_success must block the aggregator when a real branch failed'
    ).not.toBe('completed');
    expect(run.providerCalls, 'PR unreachable after a failed real branch').not.toContain(
      'create-pull-request'
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// TD-156 [P1] — two runs with distinct ARTIFACTS_DIR values keep independent
// summary artifacts (no cross-run share/overwrite) (AC #1)
// ═══════════════════════════════════════════════════════════════════════════

describe('Isolation — independent artifact dirs do not share summaries (TD-156)', () => {
  it('a PASS run and a FAIL run each persist their own distinct summary', async () => {
    const passRun = await runV2Dag({
      cwd: cwdFixture,
      arguments: CANONICAL_REF,
      nodeResponses: baseResponses(),
    });
    const failRun = await runV2Dag({
      cwd: cwdFixture,
      arguments: CANONICAL_REF,
      nodeResponses: baseResponses({ tr: validTrGate({ gate: 'FAIL' }) }),
    });

    expect(passRun.artifactsDir, 'each run uses a distinct artifacts dir').not.toBe(
      failRun.artifactsDir
    );
    const passContract = await readSummaryContract(passRun.artifactsDir);
    const failContract = await readSummaryContract(failRun.artifactsDir);
    expect(passContract!.gate, 'the PASS run keeps a PASS summary').toBe('PASS');
    expect(failContract!.gate, 'the FAIL run keeps its own FAIL summary').toBe('FAIL');
  });
});
