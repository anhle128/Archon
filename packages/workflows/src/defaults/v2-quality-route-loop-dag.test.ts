/**
 * RED-PHASE ATDD acceptance scaffolds — the single bounded quality route loop
 * sourced from the summary reader.
 *
 * Behavioral / DAG-level acceptance tests that drive the REAL executor + REAL
 * bash nodes (resolve-story-input, verify-story-identity, gate-planner, the
 * quality-gate-summary aggregator, the verify-quality-summary reader, the
 * *-skipped skip encoders, and review-loop-error) through the v2 DAG. Only AI
 * provider nodes (dev-story / tea-automate / code-review-auto / tea-rv / tea-nr /
 * tea-tr / create-pull-request) are mocked; every deterministic bash node and
 * the route_loop engine execute for real. This IS the first-party consumer
 * surface for a backend workflow-engine story (browser E2E is not applicable and
 * is waived — see the ATDD checklist).
 *
 * ── TDD RED PHASE ──────────────────────────────────────────────────────────
 * These assert the TARGET behavior of the not-yet-implemented consolidation and
 * are EXPECTED TO FAIL until the v2 YAML: adds verify-quality-summary + a single
 * quality-route-loop (from the reader, FAIL->dev-story, PASS->create-pull-request,
 * exhausted->review-loop-error), removes code-review-gate, and keeps ERROR
 * fail-closed (a summary ERROR hard-fails the summary node, so the reader never
 * runs and the loop cannot evaluate — it never reroutes to dev-story).
 *
 * ── ISOLATION ──────────────────────────────────────────────────────────────
 * This file uses mock.module('@archon/paths', ...). Bun's mock.module() is
 * process-global and irreversible, so this file MUST run as its OWN isolated
 * `bun test` invocation — registered as a standalone segment in
 * packages/workflows/package.json, never co-located with another test file.
 * Run it directly in red phase with:
 *   bun test packages/workflows/src/defaults/v2-quality-route-loop-dag.test.ts
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
const CANONICAL_REF = 'x1-0-synthetic-quality-ref';

// The real route_loop budget in the v2 YAML. Exhaustion happens on the
// (budget + 1)-th FAIL evaluation. Kept in sync with the contract test's
// TD-233 assertion — update both if the maintainer changes the story decision.
const MAX_ITERATIONS = 20;

// ── Store / platform / deps ────────────────────────────────────────────────

type NodeEventState = 'completed' | 'failed' | 'skipped';

const MOCK_RUN = {
  id: 'quality-route-loop-run-id',
  workflow_name: V2_STEM,
  conversation_id: 'conv-qrl',
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
  nodeCompletions: Record<string, number>,
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
        if (event_type === 'node_completed') {
          nodeState[step_name] = 'completed';
          nodeCompletions[step_name] = (nodeCompletions[step_name] ?? 0) + 1;
        } else if (event_type === 'node_failed') nodeState[step_name] = 'failed';
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
    id: 'quality-route-loop-run-id',
    workflow_name: V2_STEM,
    conversation_id: 'conv-qrl',
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

// A per-node response may be a single object (returned every call) OR an array
// consumed one entry per invocation (round). The array form is a deterministic
// per-round driver — it lets a FAIL round be followed by a PASS round without
// mutating shared state. The last array entry repeats once exhausted.
type NodeResponse = Record<string, unknown> | Array<Record<string, unknown>>;

function createMockDepsWithResponses(
  store: IWorkflowStore,
  nodeResponses: Record<string, NodeResponse>,
  providerCalls: string[]
): WorkflowDeps {
  const callCounts: Record<string, number> = {};

  const resolveResponse = (nodeId: string): Record<string, unknown> => {
    const spec = nodeResponses[nodeId];
    if (spec === undefined) return {};
    if (Array.isArray(spec)) {
      const idx = callCounts[nodeId] ?? 0;
      callCounts[nodeId] = idx + 1;
      return spec[Math.min(idx, spec.length - 1)] ?? {};
    }
    return spec;
  };

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
      const resp = nodeId ? resolveResponse(nodeId) : {};
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
  const cwd = join(baseDir, 'quality-route-loop-fixture');
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
  nodeCompletions: Record<string, number>;
  providerCalls: string[];
  runFailed: boolean;
  artifactsDir: string;
}

let dagRunCounter = 0;

async function runV2Dag(opts: {
  cwd: string;
  arguments?: string;
  nodeResponses?: Record<string, NodeResponse>;
}): Promise<DagRun> {
  const yamlText = await readFile(V2_FILE, 'utf-8');
  const parseResult = parseWorkflow(yamlText, 'test');
  if (!parseResult.workflow)
    throw new Error(`Failed to parse v2 workflow: ${parseResult.error?.error}`);
  const workflow = parseResult.workflow;

  const nodeState: Record<string, NodeEventState> = {};
  const nodeCompletions: Record<string, number> = {};
  const providerCalls: string[] = [];
  const runFailedRef = { value: false };

  const store = createTrackedStore(nodeState, nodeCompletions, runFailedRef);
  const deps = createMockDepsWithResponses(store, opts.nodeResponses ?? {}, providerCalls);
  const platform = createMockPlatform();
  const workflowRun = makeWorkflowRun(opts.cwd, opts.arguments ?? '');
  dagRunCounter++;
  const artifactsDir = join(opts.cwd, 'artifacts', `run-${dagRunCounter}`);

  try {
    await executeDagWorkflow(
      deps,
      platform,
      'conv-qrl',
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

  return {
    nodeState,
    nodeCompletions,
    providerCalls,
    runFailed: runFailedRef.value,
    artifactsDir,
  };
}

// ── Artifact readers ───────────────────────────────────────────────────────
// review-loop-error is a terminal fail-closed node (no output_type / route
// contract); the story mandates it best-effort writes $RUN_DIR/review-loop-error.json.
// Read whichever candidate resolves so the assertion is robust to the exact
// RUN_DIR layout the GREEN implementation lands on.

async function readReviewLoopError(artifactsDir: string): Promise<{ raw: string } | null> {
  const candidates = [
    join(artifactsDir, 'review-loop-error.json'),
    join(artifactsDir, V2_STEM, 'review-loop-error.json'),
    join(artifactsDir, 'bmad-dev-story-with-tea-fix-loop', 'review-loop-error.json'),
    join(artifactsDir, 'nodes', 'review-loop-error.md'),
  ];
  for (const path of candidates) {
    if (!existsSync(path)) continue;
    const raw = (await readFile(path, 'utf-8')).trim();
    if (raw) return { raw };
  }
  return null;
}

// ── Evidence builders ──────────────────────────────────────────────────────
// CR carries `round` and must pass review (PASS/CONCERNS) to clear
// verify-story-identity and reach the summary. RV/NR/TR each run real when
// gate-planner enables them (test_files_changed>0, nfr_relevant=="true",
// run_tr always). Any role gate FAIL makes the summary emit gate:"FAIL", which
// the reader turns into a bare FAIL that routes the loop negative -> dev-story.

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

function roleGate(node: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    contract_version: '1.0',
    workflow: V2_STEM,
    node,
    gate: 'PASS',
    story_ref: CANONICAL_REF,
    findings_count: 0,
    report_file: `${node}-report.md`,
    ...overrides,
  };
}

const validRvGate = (o: Record<string, unknown> = {}): Record<string, unknown> =>
  roleGate('tea-rv', o);
const validNrGate = (o: Record<string, unknown> = {}): Record<string, unknown> =>
  roleGate('tea-nr', o);
const validTrGate = (o: Record<string, unknown> = {}): Record<string, unknown> =>
  roleGate('tea-tr', o);

// Build a full per-node response map. Any entry may be an array (per-round).
function baseResponses(
  overrides: {
    cr?: NodeResponse;
    ta?: NodeResponse;
    rv?: NodeResponse;
    nr?: NodeResponse;
    tr?: NodeResponse;
  } = {}
): Record<string, NodeResponse> {
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
  fixtureBase = join(tmpdir(), `quality-route-loop-dag-${process.pid}`);
  cwdFixture = await buildFixtureDir(fixtureBase);
});

afterAll(async () => {
  await rm(fixtureBase, { recursive: true, force: true });
});

// ═══════════════════════════════════════════════════════════════════════════
// TD-220 [P1] — first-round PASS: the reader emits PASS, the loop routes positive
// to create-pull-request, dev-story is NOT rerun, review-loop-error does NOT run
// (AC #2)
// ═══════════════════════════════════════════════════════════════════════════

describe('Happy path — first-round PASS routes forward to the PR tail (TD-220)', () => {
  it('all roles PASS → reader PASS → create-pull-request reached, dev-story ran once, no error node', async () => {
    const run = await runV2Dag({
      cwd: cwdFixture,
      arguments: CANONICAL_REF,
      nodeResponses: baseResponses(),
    });

    expect(run.nodeState['quality-gate-summary'], 'summary completes on a clean run').toBe(
      'completed'
    );
    expect(run.nodeState['verify-quality-summary'], 'the reader completes and emits PASS').toBe(
      'completed'
    );
    expect(run.providerCalls, 'a PASS gate routes the loop forward to the PR tail').toContain(
      'create-pull-request'
    );
    expect(
      run.providerCalls.filter(c => c === 'dev-story').length,
      'a first-round PASS must not re-run dev-story'
    ).toBe(1);
    expect(
      run.nodeState['review-loop-error'],
      'the error node must not run on a PASS'
    ).toBeUndefined();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// TD-221 [P1] — first-round FAIL then second-round PASS: the negative back-edge
// re-runs the full dev-to-summary path, dev-story runs twice, the same story_ref
// flows both rounds, then the run reaches create-pull-request (AC #1)
// ═══════════════════════════════════════════════════════════════════════════

describe('Negative-then-recovery — FAIL reruns the fix loop, then PASS proceeds (TD-221)', () => {
  it('round-1 TR FAIL then round-2 TR PASS → dev-story runs twice, same story_ref, then PR reached', async () => {
    const run = await runV2Dag({
      cwd: cwdFixture,
      arguments: CANONICAL_REF,
      nodeResponses: baseResponses({
        // Per-round driver: round 1 TR fails (summary FAIL -> reader FAIL ->
        // negative -> dev-story), round 2 TR passes (summary PASS -> positive -> PR).
        tr: [validTrGate({ gate: 'FAIL', findings_count: 2 }), validTrGate({ gate: 'PASS' })],
      }),
    });

    expect(
      run.providerCalls.filter(c => c === 'dev-story').length,
      'a FAIL round must re-run the full dev-story fix loop exactly once more'
    ).toBe(2);
    // resolve-story-input is off the back-edge path, so its cached story_ref is
    // reused unchanged across both rounds (AC #1: same story_ref every round).
    expect(
      run.nodeState['resolve-story-input'],
      'the resolved story input is reused, not re-run'
    ).toBe('completed');
    expect(
      run.nodeCompletions['resolve-story-input'],
      'resolve-story-input resolves once and stays cached across rounds'
    ).toBe(1);
    expect(run.providerCalls, 'the recovered PASS round proceeds forward to the PR tail').toContain(
      'create-pull-request'
    );
    expect(
      run.nodeState['review-loop-error'],
      'a recovered loop must not hit the error node'
    ).toBeUndefined();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// TD-222 [P0] — budget exhaustion: persistent FAIL past max_iterations routes to
// review-loop-error on the (budget+1)-th FAIL, never reaches create-pull-request,
// and terminates non-zero (fail closed, no PR) (AC #3)
// ═══════════════════════════════════════════════════════════════════════════

describe('Exhaustion — persistent FAIL routes to review-loop-error, fails closed (TD-222)', () => {
  it('TR FAIL on every round → exhausted route runs review-loop-error, no PR, run fails', async () => {
    // Drives (MAX_ITERATIONS + 1) FAIL evaluations against the real budget: each
    // FAIL round re-runs the full dev-to-summary path, so this is intentionally
    // the heaviest fixture. It is the single authoritative exhaustion proof.
    const run = await runV2Dag({
      cwd: cwdFixture,
      arguments: CANONICAL_REF,
      nodeResponses: baseResponses({ tr: validTrGate({ gate: 'FAIL', findings_count: 1 }) }),
    });

    expect(
      run.providerCalls.filter(c => c === 'dev-story').length,
      'dev-story re-runs once per FAIL round, bounded by the budget'
    ).toBeGreaterThanOrEqual(MAX_ITERATIONS);
    expect(
      run.nodeState['review-loop-error'],
      'exhausting the budget must route to the terminal error node'
    ).toBe('failed');
    expect(run.providerCalls, 'exhaustion must never reach the PR tail').not.toContain(
      'create-pull-request'
    );
    expect(run.runFailed, 'an exhausted quality loop must terminate the run non-zero').toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// TD-223 [P0] — exhaustion evidence: review-loop-error records the open-findings
// pointer, the decision-log pointer, and a round/iteration count, and best-effort
// writes review-loop-error.json (AC #3)
// ═══════════════════════════════════════════════════════════════════════════

describe('Exhaustion evidence — review-loop-error records findings + round count (TD-223)', () => {
  it('the exhausted run leaves a review-loop-error artifact naming open findings, the decision log, and the round count', async () => {
    const run = await runV2Dag({
      cwd: cwdFixture,
      arguments: CANONICAL_REF,
      nodeResponses: baseResponses({ tr: validTrGate({ gate: 'FAIL', findings_count: 1 }) }),
    });

    expect(run.nodeState['review-loop-error'], 'the error node must run on exhaustion').toBe(
      'failed'
    );
    const evidence = await readReviewLoopError(run.artifactsDir);
    expect(evidence, 'exhaustion must persist a review-loop-error artifact').not.toBeNull();
    const raw = evidence!.raw;
    expect(raw, 'the artifact must point at the open findings file').toContain('open-findings.md');
    expect(raw, 'the artifact must point at the decision log').toContain('decision-log');
    const parsed = JSON.parse(raw) as { round?: unknown };
    const roundNum = Number(parsed.round);
    expect(
      Number.isInteger(roundNum) && roundNum > 0,
      `the artifact must record a positive integer round (got: ${JSON.stringify(parsed.round)})`
    ).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// TD-224 [P0] — ERROR is kept strictly separate from a routable FAIL: a role
// ERROR / identity mismatch hard-fails quality-gate-summary, so
// verify-quality-summary never runs, the route loop cannot evaluate, dev-story is
// NOT re-run, and create-pull-request is NOT reached (AC #4)
// ═══════════════════════════════════════════════════════════════════════════

describe('ERROR fail-closed — a summary ERROR never reroutes to dev-story (TD-224)', () => {
  it('role gate ERROR → summary hard-fails, reader never runs, no reroute to dev-story, no PR', async () => {
    const run = await runV2Dag({
      cwd: cwdFixture,
      arguments: CANONICAL_REF,
      nodeResponses: baseResponses({ tr: validTrGate({ gate: 'ERROR' }) }),
    });

    expect(
      run.nodeState['quality-gate-summary'],
      'a role ERROR must hard-fail the summary node (ERROR != routable FAIL)'
    ).toBe('failed');
    expect(
      run.nodeState['verify-quality-summary'],
      'the reader must not run when its summary source failed'
    ).not.toBe('completed');
    expect(
      run.providerCalls.filter(c => c === 'dev-story').length,
      'an ERROR must never reroute back into the dev-story fix loop'
    ).toBe(1);
    expect(run.providerCalls, 'an ERROR must never reach the PR tail').not.toContain(
      'create-pull-request'
    );
    expect(
      run.nodeState['review-loop-error'],
      'an ERROR is not an exhaustion — no error-node route'
    ).toBeUndefined();
  });

  it('identity mismatch (stale story_ref on a role) is an ERROR: summary fails, no reroute, no PR', async () => {
    const run = await runV2Dag({
      cwd: cwdFixture,
      arguments: CANONICAL_REF,
      nodeResponses: baseResponses({ nr: validNrGate({ story_ref: 'stale-story-ref' }) }),
    });

    expect(run.nodeState['quality-gate-summary'], 'story_ref mismatch hard-fails the summary').toBe(
      'failed'
    );
    expect(
      run.nodeState['verify-quality-summary'],
      'the reader never runs on a failed summary'
    ).not.toBe('completed');
    expect(
      run.providerCalls.filter(c => c === 'dev-story').length,
      'identity ERROR must not reroute to dev-story'
    ).toBe(1);
    expect(run.providerCalls).not.toContain('create-pull-request');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// TD-227 [P1] — dependency / partial upstream failure: a missing required source
// contract prevents the summary and reader from completing, so the route loop
// cannot evaluate and never reroutes to dev-story (AC #4)
// ═══════════════════════════════════════════════════════════════════════════

describe('Partial failure — a missing upstream contract blocks routing entirely (TD-227)', () => {
  it('empty CR output → CR fails schema, summary + reader never complete, no reroute, no PR', async () => {
    const run = await runV2Dag({
      cwd: cwdFixture,
      arguments: CANONICAL_REF,
      nodeResponses: baseResponses({ cr: {} }),
    });

    expect(run.nodeState['code-review-auto'], 'an empty CR output must fail schema').toBe('failed');
    expect(
      run.nodeState['quality-gate-summary'],
      'a failed required source must prevent the summary from completing'
    ).not.toBe('completed');
    expect(
      run.nodeState['verify-quality-summary'],
      'the reader cannot run without a completed summary'
    ).not.toBe('completed');
    expect(
      run.providerCalls.filter(c => c === 'dev-story').length,
      'an upstream failure must not reroute to dev-story'
    ).toBe(1);
    expect(run.providerCalls, 'no PR when the summary never completes').not.toContain(
      'create-pull-request'
    );
  });

  it('a failed real role branch (skip sibling condition-skipped) also blocks routing', async () => {
    const run = await runV2Dag({
      cwd: cwdFixture,
      arguments: CANONICAL_REF,
      // nfr_relevant:"true" → run_nr=true → real NR runs; empty output fails it.
      nodeResponses: baseResponses({ nr: {} }),
    });

    expect(run.nodeState['tea-nr'], 'the real NR branch with no valid output must fail').toBe(
      'failed'
    );
    expect(run.nodeState['tea-nr-skipped'], 'the NR skip sibling stays condition-skipped').toBe(
      'skipped'
    );
    expect(
      run.nodeState['quality-gate-summary'],
      'the trigger rule must block the summary when a real branch failed'
    ).not.toBe('completed');
    expect(run.providerCalls).not.toContain('create-pull-request');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// TD-229 [P1] — run isolation: two route-loop runs with distinct artifact dirs do
// not share loop counters, route activations, or exhausted artifacts (AC #1)
// ═══════════════════════════════════════════════════════════════════════════

describe('Isolation — independent runs do not share loop state or artifacts (TD-229)', () => {
  it('a PASS run and an exhausted run keep independent outcomes and distinct artifact dirs', async () => {
    const passRun = await runV2Dag({
      cwd: cwdFixture,
      arguments: CANONICAL_REF,
      nodeResponses: baseResponses(),
    });
    const exhaustedRun = await runV2Dag({
      cwd: cwdFixture,
      arguments: CANONICAL_REF,
      nodeResponses: baseResponses({ tr: validTrGate({ gate: 'FAIL', findings_count: 1 }) }),
    });

    expect(passRun.artifactsDir, 'each run must use a distinct artifacts dir').not.toBe(
      exhaustedRun.artifactsDir
    );
    // The PASS run's clean outcome must not leak into the exhausted run and vice versa.
    expect(passRun.providerCalls, 'the PASS run reaches the PR tail').toContain(
      'create-pull-request'
    );
    expect(
      passRun.nodeState['review-loop-error'],
      'the PASS run never hits the error node'
    ).toBeUndefined();
    expect(exhaustedRun.providerCalls, 'the exhausted run never reaches the PR tail').not.toContain(
      'create-pull-request'
    );
    expect(
      exhaustedRun.nodeState['review-loop-error'],
      'the exhausted run hits its own error node'
    ).toBe('failed');
    // Independent exhausted artifacts: the exhausted run has its own error file;
    // the PASS run has none.
    expect(
      await readReviewLoopError(exhaustedRun.artifactsDir),
      'exhausted run owns its error artifact'
    ).not.toBeNull();
    expect(
      await readReviewLoopError(passRun.artifactsDir),
      'the PASS run must not carry an exhausted-loop artifact'
    ).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// TD-207 [P0] — reader rejection of a malformed/invalid summary DRIVEN MID-DAG.
// Skipped scaffold: no fault-injection seam. The executable half (the reader's
// own JSON.parse + envelope/identity validation) is proven in the contract
// sibling (TD-207 technique proofs). (AC #4)
// ═══════════════════════════════════════════════════════════════════════════

describe('Reader mid-DAG rejection — malformed summary injected upstream (TD-207)', () => {
  // WHY SKIPPED: the only upstream source of verify-quality-summary is the real
  // quality-gate-summary bash node, which itself emits a well-formed envelope or
  // hard-fails (exit 1). There is no seam through this harness to make the summary
  // COMPLETE while emitting a malformed / wrong-identity / invalid-gate envelope,
  // so the reader's independent (defense-in-depth) rejection of such an envelope
  // cannot be exercised end-to-end. The reader's rejection logic is proven
  // executably against every bad-envelope variant in the contract sibling
  // (v2-quality-route-loop-contract.test.ts, TD-207 runReaderValidation cases).
  // ACTIVATE this scaffold only if a fault-injection seam is added — e.g. a stub
  // summary node able to complete-with-arbitrary-stdout — at which point assert:
  // reader fails, verify-quality-summary != 'completed', the loop never evaluates,
  // dev-story is not rerun, and create-pull-request is not reached.
  it.skip('a malformed summary that still completes makes the reader fail closed (no route decision)', () => {
    expect(true).toBe(false);
  });
});
