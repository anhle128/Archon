/**
 * RED-PHASE ATDD acceptance scaffolds — the fail-closed decision-needed-check
 * node inserted at the quality route loop's PASS seam.
 *
 * Behavioral / DAG-level acceptance tests that drive the REAL executor + REAL
 * bash nodes (resolve-story-input, verify-story-identity, gate-planner, the
 * quality-gate-summary aggregator, the verify-quality-summary reader, the
 * *-skipped skip encoders, review-loop-error, and the new decision-needed-check)
 * through the v2 DAG. Only AI provider nodes (dev-story / tea-automate /
 * code-review-auto / tea-rv / tea-nr / tea-tr / create-pull-request) are mocked;
 * every deterministic bash node and the route_loop engine execute for real. This
 * IS the first-party consumer surface for a backend workflow-engine story —
 * browser E2E is not applicable and is waived (see the ATDD checklist).
 *
 * The count>0 fail-closed path is driven end-to-end by making a role gate return
 * CONCERNS: the summary keeps gate:"PASS" (only FAIL blocks) while raising
 * decision_needed_count to the number of CONCERNS role gates, so the loop routes
 * positive into decision-needed-check, which then fails closed because no tracking
 * capability is available in this repository.
 *
 * ── TDD RED PHASE ──────────────────────────────────────────────────────────
 * These assert the TARGET behavior of the not-yet-implemented node and are
 * EXPECTED TO FAIL until the v2 YAML adds decision-needed-check and retargets
 * quality-route-loop.routes.positive to it (PASS -> decision-needed-check -> PR
 * when count==0; PASS -> decision-needed-check FAILS CLOSED -> no PR when
 * count>0). Regression blocks (the prior loop's FAIL-then-PASS, ERROR-not-
 * rerouted, and exhaustion behavior) are GREEN today and MUST STAY green — they
 * guard the blast radius during implementation.
 *
 * ── ISOLATION ──────────────────────────────────────────────────────────────
 * This file uses mock.module('@archon/paths', ...). Bun's mock.module() is
 * process-global and irreversible, so this file MUST run as its OWN isolated
 * `bun test` invocation — registered as a standalone segment in
 * packages/workflows/package.json, never co-located with another test file.
 * Run it directly in red phase with:
 *   bun test packages/workflows/src/defaults/v2-decision-needed-dag.test.ts
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
const CANONICAL_REF = 'x1-0-synthetic-decision-ref';
const NODE_ID = 'decision-needed-check';
const PR_ID = 'create-pull-request';

// The real route_loop budget in the v2 YAML. Kept in sync with the contract
// test — update both if the maintainer changes the loop decision.
const MAX_ITERATIONS = 20;

// ── Store / platform / deps ────────────────────────────────────────────────

type NodeEventState = 'completed' | 'failed' | 'skipped';

const MOCK_RUN = {
  id: 'decision-needed-run-id',
  workflow_name: V2_STEM,
  conversation_id: 'conv-dnc',
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
    id: 'decision-needed-run-id',
    workflow_name: V2_STEM,
    conversation_id: 'conv-dnc',
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
  const cwd = join(baseDir, 'decision-needed-fixture');
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
  // Pin an explicit artifacts dir to prove duplicate-run overwrite (TD-317);
  // omit for auto-incremented distinct dirs (default isolation).
  artifactsDir?: string;
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
  const artifactsDir = opts.artifactsDir ?? join(opts.cwd, 'artifacts', `run-${dagRunCounter}`);

  try {
    await executeDagWorkflow(
      deps,
      platform,
      'conv-dnc',
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

// ── Artifact reader ────────────────────────────────────────────────────────
// The node best-effort writes $ARTIFACTS_DIR/bmad-dev-story-with-tea-fix-loop/
// decision-needed.json (the sub-path drops the -v2 suffix to match the run
// state.json workflow value). The typed sidecar ($ARTIFACTS_DIR/nodes/
// decision-needed-check.md) is a secondary fallback.

function decisionNeededPath(artifactsDir: string): string {
  return join(artifactsDir, 'bmad-dev-story-with-tea-fix-loop', 'decision-needed.json');
}

async function readDecisionNeeded(
  artifactsDir: string
): Promise<{ raw: string; parsed: Record<string, unknown> } | null> {
  const candidates = [
    decisionNeededPath(artifactsDir),
    join(artifactsDir, V2_STEM, 'decision-needed.json'),
    join(artifactsDir, 'nodes', 'decision-needed-check.md'),
  ];
  for (const path of candidates) {
    if (!existsSync(path)) continue;
    const raw = (await readFile(path, 'utf-8')).trim();
    if (!raw) continue;
    try {
      return { raw, parsed: JSON.parse(raw) as Record<string, unknown> };
    } catch {
      // Sidecar markdown may wrap JSON; fall through to next candidate.
    }
  }
  return null;
}

// ── Evidence builders ──────────────────────────────────────────────────────
// CR carries `round` and must pass review (PASS/CONCERNS) to clear
// verify-story-identity and reach the summary. RV/NR/TR each run real when
// gate-planner enables them (test_files_changed>0, nfr_relevant=="true",
// run_tr always). A role gate returning CONCERNS keeps the summary gate:"PASS"
// (only FAIL blocks) while raising decision_needed_count — this is how the
// count>0 fail-closed path is driven end-to-end.

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
  fixtureBase = join(tmpdir(), `decision-needed-dag-${process.pid}`);
  cwdFixture = await buildFixtureDir(fixtureBase);
});

afterAll(async () => {
  await rm(fixtureBase, { recursive: true, force: true });
});

// ═══════════════════════════════════════════════════════════════════════════
// TD-305 [P1] — no-op success: all roles PASS → decision_needed_count == 0 → the
// decision-needed-check node completes, emits its PASS contract, and PR
// preparation runs. dev-story is not re-run, and the error node does not run.
// (AC #2)
// ═══════════════════════════════════════════════════════════════════════════

describe('No-op success — count==0 completes the node and PR runs (TD-305)', () => {
  it('all roles PASS → decision-needed-check completes → create-pull-request reached', async () => {
    const run = await runV2Dag({
      cwd: cwdFixture,
      arguments: CANONICAL_REF,
      nodeResponses: baseResponses(),
    });

    expect(run.nodeState['quality-gate-summary'], 'summary completes on a clean run').toBe(
      'completed'
    );
    expect(
      run.nodeState[NODE_ID],
      'the decision node must run and complete on a clean no-op PASS'
    ).toBe('completed');
    expect(run.providerCalls, 'a clean no-op decision must let PR preparation run').toContain(
      PR_ID
    );
    expect(
      run.providerCalls.filter(c => c === 'dev-story').length,
      'a first-round PASS must not re-run dev-story'
    ).toBe(1);
    expect(
      run.nodeState['review-loop-error'],
      'the error node must not run on a clean PASS'
    ).toBeUndefined();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// TD-324 [P1] — same-story identity on success: the persisted decision-needed.json
// carries status:"PASS" and story_ref exactly equal to the resolved canonical key,
// at the flat $ARTIFACTS_DIR/bmad-dev-story-with-tea-fix-loop/decision-needed.json
// path. (AC #2, #3)
// ═══════════════════════════════════════════════════════════════════════════

describe('Success artifact — decision-needed.json carries PASS + resolved story_ref (TD-324)', () => {
  it('the no-op run persists a decision-needed.json with status PASS and the resolved story_ref', async () => {
    const run = await runV2Dag({
      cwd: cwdFixture,
      arguments: CANONICAL_REF,
      nodeResponses: baseResponses(),
    });

    const artifact = await readDecisionNeeded(run.artifactsDir);
    expect(artifact, 'a clean no-op run must persist decision-needed.json').not.toBeNull();
    expect(artifact!.parsed.status, 'the persisted contract reports status PASS').toBe('PASS');
    expect(
      artifact!.parsed.story_ref,
      'the persisted contract carries the resolved canonical story_ref'
    ).toBe(CANONICAL_REF);
    expect(
      artifact!.parsed.decision_needed_count,
      'the echoed count is zero on the no-op path'
    ).toBe(0);
    expect('gate' in artifact!.parsed, 'the contract must not carry a gate field').toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// TD-309 [P0] — fail-closed when items exist: one CONCERNS role gate keeps the
// summary PASS but raises decision_needed_count to 1, so the loop routes positive
// into decision-needed-check, which fails closed. The node fails, PR preparation
// does NOT run, and the error node does not run (this is not exhaustion). The
// diagnostic text is proven in the contract sibling. (AC #4)
// ═══════════════════════════════════════════════════════════════════════════

describe('Fail-closed — count>0 blocks PR through node failure (TD-309)', () => {
  it('one CONCERNS role → count 1 → decision-needed-check FAILS → no PR, no error node', async () => {
    const run = await runV2Dag({
      cwd: cwdFixture,
      arguments: CANONICAL_REF,
      nodeResponses: baseResponses({ tr: validTrGate({ gate: 'CONCERNS', findings_count: 1 }) }),
    });

    expect(
      run.nodeState['quality-gate-summary'],
      'a CONCERNS role keeps the summary PASS (only FAIL blocks the summary)'
    ).toBe('completed');
    expect(
      run.nodeState[NODE_ID],
      'unresolved decision-needed items with no tracking capability must fail the node closed'
    ).toBe('failed');
    expect(
      run.providerCalls,
      'a fail-closed decision node must block PR preparation'
    ).not.toContain(PR_ID);
    expect(
      run.nodeState['review-loop-error'],
      'a fail-closed decision is not an exhaustion — the error node must not run'
    ).toBeUndefined();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// TD-308 [P0, integer subset] — the count 0 vs count>0 boundary driven end-to-end
// via CONCERNS gates. 0 passes forward; 2 (two CONCERNS role gates) fails closed.
// The malformed / negative / fractional / non-numeric subset is technique-only
// (the real summary only ever emits an integer concernsCount >= 0) — see the
// contract sibling TD-308. (AC #3, #4)
// ═══════════════════════════════════════════════════════════════════════════

describe('Count boundary end-to-end — 0 proceeds, positive integer blocks (TD-308)', () => {
  it('two CONCERNS role gates → count 2 → decision-needed-check fails closed, no PR', async () => {
    const run = await runV2Dag({
      cwd: cwdFixture,
      arguments: CANONICAL_REF,
      nodeResponses: baseResponses({
        nr: validNrGate({ gate: 'CONCERNS', findings_count: 1 }),
        tr: validTrGate({ gate: 'CONCERNS', findings_count: 1 }),
      }),
    });

    expect(
      run.nodeState['quality-gate-summary'],
      'two CONCERNS still leaves the summary PASS'
    ).toBe('completed');
    expect(run.nodeState[NODE_ID], 'count 2 must fail the decision node closed').toBe('failed');
    expect(run.providerCalls, 'count 2 must block PR preparation').not.toContain(PR_ID);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// TD-311 [P0] — no partial artifact on the fail-closed path: when count>0 the node
// exits non-zero BEFORE the best-effort file write, so no decision-needed.json is
// left behind and PR does not run. (AC #3, #4)
// ═══════════════════════════════════════════════════════════════════════════

describe('No partial artifact — fail-closed path leaves no decision-needed.json (TD-311)', () => {
  it('a count>0 fail-closed run writes no decision-needed.json and reaches no PR', async () => {
    const run = await runV2Dag({
      cwd: cwdFixture,
      arguments: CANONICAL_REF,
      nodeResponses: baseResponses({ tr: validTrGate({ gate: 'CONCERNS', findings_count: 2 }) }),
    });

    expect(run.nodeState[NODE_ID], 'the fail-closed node must fail').toBe('failed');
    expect(
      existsSync(decisionNeededPath(run.artifactsDir)),
      'no success artifact may be written on the fail-closed path'
    ).toBe(false);
    expect(run.providerCalls, 'no PR on the fail-closed path').not.toContain(PR_ID);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// TD-317 [P1] — artifact isolation + deterministic overwrite: two no-op runs with
// distinct ARTIFACTS_DIR values write independent artifacts; a duplicate no-op run
// pinned to ONE dir overwrites (not appends) so the file parses as exactly one
// JSON object. (AC #2)
// ═══════════════════════════════════════════════════════════════════════════

describe('Artifact isolation + overwrite — distinct dirs, single-object overwrite (TD-317)', () => {
  it('two no-op runs use distinct artifact dirs and each owns its decision-needed.json', async () => {
    const runA = await runV2Dag({
      cwd: cwdFixture,
      arguments: CANONICAL_REF,
      nodeResponses: baseResponses(),
    });
    const runB = await runV2Dag({
      cwd: cwdFixture,
      arguments: CANONICAL_REF,
      nodeResponses: baseResponses(),
    });

    expect(runA.artifactsDir, 'each run must use a distinct artifacts dir').not.toBe(
      runB.artifactsDir
    );
    expect(await readDecisionNeeded(runA.artifactsDir), 'run A owns its artifact').not.toBeNull();
    expect(await readDecisionNeeded(runB.artifactsDir), 'run B owns its artifact').not.toBeNull();
  });

  it('a duplicate no-op run pinned to one dir overwrites the artifact as a single JSON object', async () => {
    const pinnedDir = join(cwdFixture, 'artifacts', 'pinned-overwrite');
    await runV2Dag({
      cwd: cwdFixture,
      arguments: CANONICAL_REF,
      nodeResponses: baseResponses(),
      artifactsDir: pinnedDir,
    });
    await runV2Dag({
      cwd: cwdFixture,
      arguments: CANONICAL_REF,
      nodeResponses: baseResponses(),
      artifactsDir: pinnedDir,
    });

    const raw = (await readFile(decisionNeededPath(pinnedDir), 'utf-8')).trim();
    // A second no-op must overwrite, not append — so the file is exactly one object.
    expect(
      () => JSON.parse(raw) as unknown,
      'the artifact must be a single valid JSON object'
    ).not.toThrow();
    expect(
      (raw.match(/"contract_version"/g) ?? []).length,
      'a duplicate run must not append a second contract'
    ).toBe(1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// TD-318 [P1] — partial / out-of-order failure: when a required upstream contract
// fails, the summary never completes, so the loop cannot route positive and
// decision-needed-check never runs — and PR preparation never runs. Regression-
// grade guard: must hold now and after the node is inserted. (AC #4)
// ═══════════════════════════════════════════════════════════════════════════

describe('Partial failure — a failed upstream blocks the decision node and PR (TD-318)', () => {
  it('empty CR output → summary never completes → decision-needed-check never runs, no PR', async () => {
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
      run.nodeState[NODE_ID],
      'the decision node must not run without a positively-routed loop'
    ).not.toBe('completed');
    expect(run.providerCalls, 'no PR when the decision node never runs').not.toContain(PR_ID);
  });

  it('a role ERROR hard-fails the summary → decision-needed-check never runs, no PR', async () => {
    const run = await runV2Dag({
      cwd: cwdFixture,
      arguments: CANONICAL_REF,
      nodeResponses: baseResponses({ tr: validTrGate({ gate: 'ERROR' }) }),
    });

    expect(
      run.nodeState['quality-gate-summary'],
      'a role ERROR must hard-fail the summary node (ERROR != routable FAIL)'
    ).toBe('failed');
    expect(run.nodeState[NODE_ID], 'the decision node must not run on a failed summary').not.toBe(
      'completed'
    );
    expect(run.providerCalls, 'an ERROR must never reach the PR tail').not.toContain(PR_ID);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// TD-322 [P0] — regression: the prior quality-route-loop behavior still holds after
// the positive target is retargeted. FAIL-then-PASS re-runs the fix loop then
// proceeds; a role ERROR is not rerouted to dev-story; and persistent FAIL past the
// budget routes to review-loop-error and fails the run closed. These are GREEN
// today and MUST STAY green through implementation. (AC #1)
// ═══════════════════════════════════════════════════════════════════════════

describe('Route-loop regression — FAIL/ERROR/exhaustion still hold after retarget (TD-322)', () => {
  it('round-1 TR FAIL then round-2 TR PASS → dev-story runs twice, then the run proceeds forward', async () => {
    const run = await runV2Dag({
      cwd: cwdFixture,
      arguments: CANONICAL_REF,
      nodeResponses: baseResponses({
        tr: [validTrGate({ gate: 'FAIL', findings_count: 2 }), validTrGate({ gate: 'PASS' })],
      }),
    });

    expect(
      run.providerCalls.filter(c => c === 'dev-story').length,
      'a FAIL round must re-run the full dev-story fix loop exactly once more'
    ).toBe(2);
    expect(
      run.nodeCompletions['resolve-story-input'],
      'resolve-story-input resolves once and stays cached across rounds'
    ).toBe(1);
    expect(
      run.nodeState['review-loop-error'],
      'a recovered loop must not hit the error node'
    ).toBeUndefined();
  });

  it('a role ERROR hard-fails the summary and is never rerouted back into dev-story', async () => {
    const run = await runV2Dag({
      cwd: cwdFixture,
      arguments: CANONICAL_REF,
      nodeResponses: baseResponses({ tr: validTrGate({ gate: 'ERROR' }) }),
    });

    expect(run.nodeState['quality-gate-summary'], 'a role ERROR hard-fails the summary').toBe(
      'failed'
    );
    expect(
      run.providerCalls.filter(c => c === 'dev-story').length,
      'an ERROR must never reroute back into the dev-story fix loop'
    ).toBe(1);
  });

  it('persistent TR FAIL → exhausted route runs review-loop-error, no PR, run fails', async () => {
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
    expect(run.providerCalls, 'exhaustion must never reach the PR tail').not.toContain(PR_ID);
    expect(run.runFailed, 'an exhausted quality loop must terminate the run non-zero').toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// TD-306 / TD-307 [P0, mid-DAG half] — the decision-needed-check reader rejecting a
// malformed / wrong-identity summary DRIVEN MID-DAG. Skipped scaffold: no fault-
// injection seam. The executable half (the node's own JSON.parse + envelope /
// identity / count validation) is proven against every bad-summary variant in the
// contract sibling (v2-decision-needed-contract.test.ts, TD-306/TD-307/TD-308
// runDecisionCheck cases). (AC #3)
// ═══════════════════════════════════════════════════════════════════════════

describe('Reader mid-DAG rejection — malformed summary injected upstream (TD-306/TD-307)', () => {
  // WHY SKIPPED: the only upstream source of decision-needed-check is the real
  // quality-gate-summary bash node, which itself emits a well-formed envelope with
  // an integer decision_needed_count or hard-fails (exit 1). There is no seam
  // through this harness to make the summary COMPLETE while emitting a malformed /
  // wrong-identity / non-integer-count envelope, so the node's independent
  // (defense-in-depth) rejection of such an envelope cannot be exercised end-to-end.
  // That rejection is proven executably against every bad-envelope variant in the
  // contract sibling. ACTIVATE this scaffold only if a fault-injection seam is added
  // — e.g. a stub summary node able to complete-with-arbitrary-stdout — at which
  // point assert: decision-needed-check fails, its state != 'completed', no
  // decision-needed.json is written, and create-pull-request is not reached.
  it.skip('a malformed summary that still completes makes decision-needed-check fail closed mid-DAG', () => {
    expect(true).toBe(false);
  });
});
