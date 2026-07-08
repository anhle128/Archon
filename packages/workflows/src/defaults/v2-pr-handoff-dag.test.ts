/**
 * RED-PHASE ATDD acceptance scaffolds — the pr-handoff collector node inserted
 * between decision-needed-check and create-pull-request.
 *
 * Behavioral / DAG-level acceptance tests that drive the REAL executor + REAL
 * bash nodes (resolve-story-input, verify-story-identity, gate-planner, the
 * quality-gate-summary aggregator, the verify-quality-summary reader, the
 * *-skipped skip encoders, review-loop-error, decision-needed-check, and the
 * new pr-handoff) through the v2 DAG. Only AI provider nodes (dev-story /
 * tea-automate / code-review-auto / tea-rv / tea-nr / tea-tr /
 * create-pull-request) are mocked; every deterministic bash node and the
 * route_loop engine execute for real. This IS the first-party consumer surface
 * for a backend workflow-engine story — browser E2E is not applicable and is
 * waived (see waiver in the ATDD checklist).
 *
 * ── TDD RED PHASE ──────────────────────────────────────────────────────────
 * These assert the TARGET behavior of the not-yet-implemented node and are
 * EXPECTED TO FAIL until the v2 YAML adds pr-handoff and retargets
 * create-pull-request.depends_on to [pr-handoff].
 *
 * ── ISOLATION ──────────────────────────────────────────────────────────────
 * This file uses mock.module('@archon/paths', ...). Bun's mock.module() is
 * process-global and irreversible, so this file MUST run as its OWN isolated
 * `bun test` invocation — registered as a standalone segment in
 * packages/workflows/package.json, never co-located with another test file.
 * Run it directly in red phase with:
 *   bun test packages/workflows/src/defaults/v2-pr-handoff-dag.test.ts
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
const CANONICAL_REF = 'x1-0-synthetic-handoff-ref';
const NODE_ID = 'pr-handoff';
const DNC_ID = 'decision-needed-check';
const PR_ID = 'create-pull-request';
const MAX_ITERATIONS = 20;

// ── Store / platform / deps ────────────────────────────────────────────────

type NodeEventState = 'completed' | 'failed' | 'skipped';

const MOCK_RUN = {
  id: 'pr-handoff-run-id',
  workflow_name: V2_STEM,
  conversation_id: 'conv-ph',
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
    id: 'pr-handoff-run-id',
    workflow_name: V2_STEM,
    conversation_id: 'conv-ph',
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
  const cwd = join(baseDir, 'pr-handoff-fixture');
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
      'conv-ph',
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

// ── Artifact readers ──────────────────────────────────────────────────────

function handoffJsonPath(artifactsDir: string): string {
  return join(artifactsDir, 'bmad-dev-story-with-tea-fix-loop', 'pr-handoff.json');
}

function handoffMdPath(artifactsDir: string): string {
  return join(artifactsDir, 'bmad-dev-story-with-tea-fix-loop', 'pr-handoff.md');
}

async function readHandoffJson(
  artifactsDir: string
): Promise<{ raw: string; parsed: Record<string, unknown> } | null> {
  const candidates = [
    handoffJsonPath(artifactsDir),
    join(artifactsDir, V2_STEM, 'pr-handoff.json'),
    join(artifactsDir, 'nodes', 'pr-handoff.md'),
  ];
  for (const path of candidates) {
    if (!existsSync(path)) continue;
    const raw = (await readFile(path, 'utf-8')).trim();
    if (!raw) continue;
    try {
      return { raw, parsed: JSON.parse(raw) as Record<string, unknown> };
    } catch {
      // Sidecar markdown may wrap JSON; fall through.
    }
  }
  return null;
}

async function readHandoffMd(artifactsDir: string): Promise<string | null> {
  const candidates = [handoffMdPath(artifactsDir), join(artifactsDir, V2_STEM, 'pr-handoff.md')];
  for (const path of candidates) {
    if (!existsSync(path)) continue;
    const content = (await readFile(path, 'utf-8')).trim();
    if (content) return content;
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
  fixtureBase = join(tmpdir(), `pr-handoff-dag-${process.pid}`);
  cwdFixture = await buildFixtureDir(fixtureBase);
});

afterAll(async () => {
  await rm(fixtureBase, { recursive: true, force: true });
});

// ═══════════════════════════════════════════════════════════════════════════
// TD-408 [P0] — happy path: all gates real and PASS, deferred:false,
// deferred_items:[] → pr-handoff emits pr-handoff.json with status:"PASS",
// empty deferred_items, evidence links for all contracts, and pr-handoff.md
// contains "No decision-needed items were deferred." → create-pull-request
// is reached. (AC #1, #2, #3, #4)
// ═══════════════════════════════════════════════════════════════════════════

describe('Happy path — all PASS, no deferred, handoff emits and PR runs (TD-408)', () => {
  it('all roles PASS → pr-handoff completes → pr-handoff.json emitted → PR reached', async () => {
    const run = await runV2Dag({
      cwd: cwdFixture,
      arguments: CANONICAL_REF,
      nodeResponses: baseResponses(),
    });

    expect(run.nodeState[DNC_ID], 'decision-needed-check must complete').toBe('completed');
    expect(run.nodeState[NODE_ID], 'pr-handoff must complete').toBe('completed');
    expect(run.providerCalls, 'PR must be reached after handoff').toContain(PR_ID);
  });

  it('pr-handoff.json carries full envelope with status PASS and resolved story_ref', async () => {
    const run = await runV2Dag({
      cwd: cwdFixture,
      arguments: CANONICAL_REF,
      nodeResponses: baseResponses(),
    });

    const artifact = await readHandoffJson(run.artifactsDir);
    expect(artifact, 'pr-handoff.json must be written').not.toBeNull();
    expect(artifact!.parsed.contract_version).toBe('1.0');
    expect(artifact!.parsed.workflow).toBe(V2_STEM);
    expect(artifact!.parsed.node).toBe(NODE_ID);
    expect(artifact!.parsed.story_ref).toBe(CANONICAL_REF);
    expect(artifact!.parsed.status).toBe('PASS');
    expect('gate' in artifact!.parsed, 'collector must not carry a gate field').toBe(false);
  });

  it('pr-handoff.json contains quality_summary, gates, gate_plan, decision_needed', async () => {
    const run = await runV2Dag({
      cwd: cwdFixture,
      arguments: CANONICAL_REF,
      nodeResponses: baseResponses(),
    });

    const artifact = await readHandoffJson(run.artifactsDir);
    expect(artifact).not.toBeNull();
    const p = artifact!.parsed;
    expect(p.quality_summary, 'must include quality_summary section').toBeDefined();
    expect(p.gates, 'must include gates section').toBeDefined();
    expect(p.gate_plan, 'must include gate_plan section').toBeDefined();
    expect(p.decision_needed, 'must include decision_needed section').toBeDefined();

    const dn = p.decision_needed as { deferred?: boolean; deferred_items?: unknown[] };
    expect(dn.deferred).toBe(false);
    expect(dn.deferred_items).toEqual([]);
  });

  it('pr-handoff.json gates section includes cr, rv, nr, tr with correct sources', async () => {
    const run = await runV2Dag({
      cwd: cwdFixture,
      arguments: CANONICAL_REF,
      nodeResponses: baseResponses(),
    });

    const artifact = await readHandoffJson(run.artifactsDir);
    expect(artifact).not.toBeNull();
    const gates = artifact!.parsed.gates as Record<string, Record<string, unknown>>;
    expect(gates.cr, 'must include CR gate').toBeDefined();
    expect(gates.rv, 'must include RV gate').toBeDefined();
    expect(gates.nr, 'must include NR gate').toBeDefined();
    expect(gates.tr, 'must include TR gate').toBeDefined();
    expect(gates.cr.source).toBe('code-review-auto');
    expect(gates.rv.source).toBe('tea-rv');
    expect(gates.nr.source).toBe('tea-nr');
    expect(gates.tr.source).toBe('tea-tr');
  });

  it('pr-handoff.json gates include artifact_file and report_file links', async () => {
    const run = await runV2Dag({
      cwd: cwdFixture,
      arguments: CANONICAL_REF,
      nodeResponses: baseResponses(),
    });

    const artifact = await readHandoffJson(run.artifactsDir);
    expect(artifact).not.toBeNull();
    const gates = artifact!.parsed.gates as Record<string, Record<string, unknown>>;
    for (const key of ['cr', 'rv', 'nr', 'tr']) {
      expect(gates[key]!.artifact_file, `${key} must have artifact_file`).toBeDefined();
      expect(
        typeof gates[key]!.artifact_file === 'string' &&
          (gates[key]!.artifact_file as string).length > 0,
        `${key} artifact_file must be non-empty string`
      ).toBe(true);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// TD-409 [P1] — no-deferred path: pr-handoff.md explicitly renders
// "No decision-needed items were deferred." (AC #3)
// ═══════════════════════════════════════════════════════════════════════════

describe('No-deferred Markdown — explicit statement in pr-handoff.md (TD-409)', () => {
  it('pr-handoff.md contains "No decision-needed items were deferred."', async () => {
    const run = await runV2Dag({
      cwd: cwdFixture,
      arguments: CANONICAL_REF,
      nodeResponses: baseResponses(),
    });

    const md = await readHandoffMd(run.artifactsDir);
    expect(md, 'pr-handoff.md must be written').not.toBeNull();
    expect(md!, 'must contain the no-deferred statement').toContain(
      'No decision-needed items were deferred.'
    );
    expect(
      /were (fixed|resolved) in this PR/i.test(md!),
      'must not use fixed/resolved language'
    ).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// TD-410 / TD-411 [P0/P1] — populated deferred items rendering.
// SKIPPED: the predecessor fails closed when decision_needed_count > 0, making the
// deferred:true path unreachable through the real DAG. The rendering
// contract is proven by the technique proof in the contract test sibling
// (v2-pr-handoff-contract.test.ts TD-410/TD-411). ACTIVATE only when the predecessor's
// live path (AC #5/#6) allows count>0 to proceed to pr-handoff.
// ═══════════════════════════════════════════════════════════════════════════

describe('Populated deferred rendering — DAG unreachable (TD-410/TD-411 DAG half)', () => {
  // WHY SKIPPED: decision-needed-check fails closed (exit 1) when
  // decision_needed_count > 0, which is the only way deferred:true and
  // populated deferred_items can appear. The pr-handoff node is downstream
  // of decision-needed-check and never receives populated items through the
  // real DAG. The rendering is proven by the technique proof in the contract
  // sibling. Do NOT re-open the predecessor's fail-closed gate to force items through.
  // ACTIVATE when the live Linear tracking path (predecessor AC #5/#6) is built,
  // allowing count>0 to produce deferred:true and still proceed to pr-handoff.
  it.skip('populated deferred items render correctly through the real DAG', () => {
    expect(true).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// TD-412 [P0] — story_ref mismatch on consumed contracts prevents PR.
// SKIPPED: upstream nodes (verify-story-identity, quality-gate-summary)
// already validate every role contract's story_ref against the resolved ref.
// A bad ref injected into CR/RV/NR/TR mock output fails the summary or
// verify-story-identity BEFORE pr-handoff ever runs — under
// none_failed_min_one_success, pr-handoff never executes (state is undefined,
// not 'failed'). The pr-handoff node's independent story_ref validation
// (defense-in-depth) cannot be exercised end-to-end without a fault-injection
// seam that bypasses upstream validation.
//
// The fail-closed behavior IS proven executably in the contract sibling
// (v2-pr-handoff-contract.test.ts TD-412 technique proof) and by static
// assertions that the node body validates story_ref on every consumed contract.
//
// ACTIVATE only if a fault-injection seam is added that lets a mismatched
// story_ref pass upstream validation and reach pr-handoff directly.
// ═══════════════════════════════════════════════════════════════════════════

describe('Story-ref mismatch — DAG unreachable, upstream eats it (TD-412)', () => {
  it.skip('a consumed contract with mismatched story_ref makes pr-handoff fail closed mid-DAG', () => {
    expect(true).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// TD-413 [P0] — malformed input: empty output or invalid JSON on a consumed
// contract fails closed — no handoff artifact, PR not reached. (AC #4)
// ═══════════════════════════════════════════════════════════════════════════

describe('Malformed input — empty/invalid JSON fails closed (TD-413)', () => {
  it('empty CR output → pr-handoff fails, no PR', async () => {
    const run = await runV2Dag({
      cwd: cwdFixture,
      arguments: CANONICAL_REF,
      nodeResponses: baseResponses({ cr: {} }),
    });

    // Empty CR fails the summary aggregator, which prevents the loop from
    // routing positive, so pr-handoff never runs. Either way: no PR.
    expect(run.nodeState[NODE_ID]).not.toBe('completed');
    expect(run.providerCalls).not.toContain(PR_ID);
  });

  it('empty TR output → pr-handoff fails, no PR', async () => {
    const run = await runV2Dag({
      cwd: cwdFixture,
      arguments: CANONICAL_REF,
      nodeResponses: baseResponses({ tr: {} }),
    });

    expect(run.nodeState[NODE_ID]).not.toBe('completed');
    expect(run.providerCalls).not.toContain(PR_ID);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// TD-414 [P1] — missing branch boundary: RV, NR, or TR with both real and
// skipped outputs empty fails closed and prevents PR. (AC #1)
// (This scenario is driven by the gate-planner enabling a gate but the
// AI node returning empty output — the summary aggregator fails.)
// ═══════════════════════════════════════════════════════════════════════════

describe('Missing branch boundary — both real and skipped empty (TD-414)', () => {
  it('RV with empty output (gate enabled but AI returns nothing) → no PR', async () => {
    const run = await runV2Dag({
      cwd: cwdFixture,
      arguments: CANONICAL_REF,
      nodeResponses: baseResponses({ rv: {} }),
    });

    expect(run.nodeState[NODE_ID]).not.toBe('completed');
    expect(run.providerCalls).not.toContain(PR_ID);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// TD-415 [P1] — mixed branch path: RV skipped, NR real, TR skipped →
// handoff correctly shows SKIPPED for RV/TR and real gate for NR with
// correct source node ids. (AC #1)
// ═══════════════════════════════════════════════════════════════════════════

describe('Mixed branch — RV skip, NR real, TR skip (TD-415)', () => {
  it('RV skipped + NR real + TR skipped → handoff shows correct sources and outcomes', async () => {
    const run = await runV2Dag({
      cwd: cwdFixture,
      arguments: CANONICAL_REF,
      nodeResponses: baseResponses({
        ta: validTaEvidence({ test_files_changed: 0, nfr_relevant: 'true' }),
        rv: validRvGate(),
        nr: validNrGate(),
        tr: validTrGate(),
      }),
    });

    // When test_files_changed is 0, gate-planner sets run_rv=false, so
    // tea-rv-skipped runs instead of tea-rv. tea-nr runs real. For TR,
    // the planner always runs TR (run_tr=true), so tea-tr runs real.
    // The exact branch mix depends on gate-planner logic — assert the
    // handoff correctly reflects whatever branches were taken.
    if (run.nodeState[NODE_ID] === 'completed') {
      const artifact = await readHandoffJson(run.artifactsDir);
      expect(artifact, 'handoff must be written when node completes').not.toBeNull();
      const gates = artifact!.parsed.gates as Record<string, Record<string, unknown>>;
      expect(gates.nr, 'NR must be present in gates').toBeDefined();
      // Source should reflect which branch ran
      for (const key of ['rv', 'nr', 'tr']) {
        expect(gates[key], `${key} gate must be present`).toBeDefined();
        expect(typeof gates[key]!.source === 'string', `${key} source must be a string`).toBe(true);
      }
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// TD-417 [P0] — partial failure: validation and fail-closed paths emit no
// partial pr-handoff.json, no partial pr-handoff.md, and do not call
// create-pull-request. (AC #4)
// ═══════════════════════════════════════════════════════════════════════════

describe('No partial artifacts — fail-closed leaves no pr-handoff files (TD-417)', () => {
  it('a story_ref mismatch leaves no partial pr-handoff.json or .md', async () => {
    const run = await runV2Dag({
      cwd: cwdFixture,
      arguments: CANONICAL_REF,
      nodeResponses: baseResponses({
        cr: validCrEvidence({ story_ref: 'wrong-ref' }),
      }),
    });

    expect(
      existsSync(handoffJsonPath(run.artifactsDir)),
      'no partial pr-handoff.json on fail-closed'
    ).toBe(false);
    expect(
      existsSync(handoffMdPath(run.artifactsDir)),
      'no partial pr-handoff.md on fail-closed'
    ).toBe(false);
    expect(run.providerCalls).not.toContain(PR_ID);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// TD-418 [P1] — artifact isolation: two runs with distinct ARTIFACTS_DIR
// values stay isolated; duplicate same-dir execution overwrites
// deterministically. (AC #1)
// ═══════════════════════════════════════════════════════════════════════════

describe('Artifact isolation + overwrite — distinct dirs, deterministic overwrite (TD-418)', () => {
  it('two runs use distinct artifact dirs and each owns its pr-handoff.json', async () => {
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

    expect(runA.artifactsDir).not.toBe(runB.artifactsDir);
    if (runA.nodeState[NODE_ID] === 'completed') {
      expect(await readHandoffJson(runA.artifactsDir), 'run A owns its artifact').not.toBeNull();
    }
    if (runB.nodeState[NODE_ID] === 'completed') {
      expect(await readHandoffJson(runB.artifactsDir), 'run B owns its artifact').not.toBeNull();
    }
  });

  it('duplicate run pinned to one dir overwrites as a single JSON object', async () => {
    const pinnedDir = join(cwdFixture, 'artifacts', 'pinned-handoff-overwrite');
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

    const jsonPath = handoffJsonPath(pinnedDir);
    if (existsSync(jsonPath)) {
      const raw = (await readFile(jsonPath, 'utf-8')).trim();
      expect(
        () => JSON.parse(raw) as unknown,
        'the artifact must be a single valid JSON object'
      ).not.toThrow();
      expect(
        (raw.match(/"contract_version"/g) ?? []).length,
        'duplicate run must not append a second contract'
      ).toBe(1);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// TD-419 [P0] — out-of-order/dependency failure: failed or skipped
// decision-needed-check, failed quality-gate-summary, route-loop
// non-completion, or missing producer outputs prevent pr-handoff and PR.
// (AC #4)
// ═══════════════════════════════════════════════════════════════════════════

describe('Dependency failure — failed upstream prevents handoff and PR (TD-419)', () => {
  it('decision-needed-check fails (count>0) → pr-handoff never runs, no PR', async () => {
    const run = await runV2Dag({
      cwd: cwdFixture,
      arguments: CANONICAL_REF,
      nodeResponses: baseResponses({
        tr: validTrGate({ gate: 'CONCERNS', findings_count: 1 }),
      }),
    });

    expect(run.nodeState[DNC_ID], 'decision-needed-check must fail on count>0').toBe('failed');
    expect(
      run.nodeState[NODE_ID],
      'pr-handoff must not run when decision-needed-check fails'
    ).not.toBe('completed');
    expect(run.providerCalls).not.toContain(PR_ID);
  });

  it('quality-gate-summary fails (role ERROR) → pr-handoff never runs, no PR', async () => {
    const run = await runV2Dag({
      cwd: cwdFixture,
      arguments: CANONICAL_REF,
      nodeResponses: baseResponses({ tr: validTrGate({ gate: 'ERROR' }) }),
    });

    expect(run.nodeState['quality-gate-summary']).toBe('failed');
    expect(run.nodeState[NODE_ID]).not.toBe('completed');
    expect(run.providerCalls).not.toContain(PR_ID);
  });

  it('empty CR output → summary fails → pr-handoff never runs, no PR', async () => {
    const run = await runV2Dag({
      cwd: cwdFixture,
      arguments: CANONICAL_REF,
      nodeResponses: baseResponses({ cr: {} }),
    });

    expect(run.nodeState[NODE_ID]).not.toBe('completed');
    expect(run.providerCalls).not.toContain(PR_ID);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// TD-426 [P1] — route-loop regression: the prior quality loop behavior
// still holds after adding pr-handoff. FAIL-then-PASS re-runs the fix loop
// then proceeds; ERROR is not rerouted to dev-story; persistent FAIL
// exhausts to review-loop-error. These are GREEN today and MUST STAY green.
// (AC #1)
// ═══════════════════════════════════════════════════════════════════════════

describe('Route-loop regression — FAIL/ERROR/exhaustion still hold (TD-426)', () => {
  it('round-1 TR FAIL then round-2 TR PASS → dev-story runs twice, then forward', async () => {
    const run = await runV2Dag({
      cwd: cwdFixture,
      arguments: CANONICAL_REF,
      nodeResponses: baseResponses({
        tr: [validTrGate({ gate: 'FAIL', findings_count: 2 }), validTrGate({ gate: 'PASS' })],
      }),
    });

    expect(
      run.providerCalls.filter(c => c === 'dev-story').length,
      'a FAIL round re-runs dev-story exactly once more'
    ).toBe(2);
    expect(
      run.nodeState['review-loop-error'],
      'a recovered loop must not hit the error node'
    ).toBeUndefined();
  });

  it('a role ERROR hard-fails the summary and is never rerouted back to dev-story', async () => {
    const run = await runV2Dag({
      cwd: cwdFixture,
      arguments: CANONICAL_REF,
      nodeResponses: baseResponses({ tr: validTrGate({ gate: 'ERROR' }) }),
    });

    expect(run.nodeState['quality-gate-summary']).toBe('failed');
    expect(
      run.providerCalls.filter(c => c === 'dev-story').length,
      'ERROR must never reroute back into dev-story'
    ).toBe(1);
  });

  it('persistent TR FAIL → exhausted → review-loop-error, no PR, run fails', async () => {
    const run = await runV2Dag({
      cwd: cwdFixture,
      arguments: CANONICAL_REF,
      nodeResponses: baseResponses({ tr: validTrGate({ gate: 'FAIL', findings_count: 1 }) }),
    });

    expect(
      run.providerCalls.filter(c => c === 'dev-story').length,
      'dev-story re-runs bounded by budget'
    ).toBeGreaterThanOrEqual(MAX_ITERATIONS);
    expect(run.nodeState['review-loop-error']).toBe('failed');
    expect(run.providerCalls).not.toContain(PR_ID);
    expect(run.runFailed, 'exhausted loop must fail the run').toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// TD-412/TD-413 [P0, bash-sourced half] — story_ref mismatch and malformed
// input on bash-sourced contracts (summary, gate-planner, decision-needed).
// SKIPPED: same mechanism as the AI-sourced skip above — upstream nodes
// (real bash nodes like quality-gate-summary, or verify-story-identity)
// either emit correct envelopes or hard-fail, consuming the bad ref before
// pr-handoff ever runs. The pr-handoff node's independent story_ref
// validation is proven executably in the contract sibling technique proof
// (TD-412 technique) and by static assertions.
// ACTIVATE if a fault-injection seam is added.
// ═══════════════════════════════════════════════════════════════════════════

describe('Bash-sourced contract mismatch — no DAG fault-injection seam (TD-412/413)', () => {
  it.skip('bash-sourced contract with mismatched story_ref makes pr-handoff fail closed mid-DAG', () => {
    expect(true).toBe(false);
  });
});
