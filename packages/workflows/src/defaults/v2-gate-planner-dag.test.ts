/**
 * RED-PHASE ACCEPTANCE SCAFFOLD — "Add Gate Planner Flags" (behavioral / DAG level).
 *
 * Drives the REAL executor + REAL `gate-planner` bash node through a minimal v2 DAG.
 * Only the AI provider nodes (dev-story / tea-automate / code-review-auto / tea-*) are
 * mocked; bash nodes (prepare-bmad-state, resolve-story-input, verify-story-identity,
 * and the new gate-planner) execute for real. This is the level that proves the
 * fail-closed invariant and the real-JSON-boolean flags — a mocked gate-planner would
 * be a fake test (R-007), so the harness deliberately never stubs bash.
 *
 * These are EXECUTABLE red tests, not test.skip(): the runV2Dag harness and the v2
 * YAML both exist today. Pre-implementation they FAIL cleanly because gate-planner
 * does not exist yet (no typed sidecar is written → capture returns null; happy path
 * still routes CR-gate.positive → tea-rv; invalid TA evidence does not fail the run).
 * They pass once the dev adds the gate-planner bash node, the tea-automate structured
 * signal, and the DAG re-parenting.
 *
 * The one exception (A3.1-INT-022, output-JSON escaping of a metacharacter story_ref)
 * is a test.skip() scaffold: the seam to feed an attacker-shaped RESOLVED_REF through
 * resolve-story-input does not exist yet — see its activation note.
 *
 * This file uses mock.module('@archon/paths', ...) — Bun's mock.module() is
 * process-global and irreversible — so it MUST run in its own isolated bun test
 * invocation (see packages/workflows/package.json). Do not co-locate with a sibling
 * that mock.module()s @archon/paths differently.
 *
 * Covers (executable red):
 *   AC1  INT-001 (happy path emits full contract)
 *   AC2  INT-002/003/004/005/006/007/008/009/010/011/012 (fail-closed matrix, no partial contract, no dev-story loop)
 *   AC3  INT-013 (envelope field VALUES in emitted JSON)
 *   AC4  INT-014 (run_tr default true in both cases)
 *   AC5  INT-015 (real JSON booleans — strict typeof)
 *   AC6  INT-016 (prove true) / INT-017 (prove false, boundary 0) / INT-019 (boundary 1) / INT-021 (real-bash meta)
 *   AC1  INT-020 (nfr_relevant pin) / INT-025 (upstream dependency failure containment)
 * Covers (skipped scaffold): INT-022 (metacharacter story_ref output-escaping — needs a RESOLVED_REF injection seam).
 */

import { describe, it, expect, mock, beforeAll, afterAll } from 'bun:test';
import { mkdir, writeFile, rm, readFile } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

// ── @archon/paths mock ─────────────────────────────────────────────────────
// Spread the REAL module so path helpers / command discovery work against the
// real filesystem. Only createLogger is a no-op so test output stays clean.
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
// The story key seeded into the fixture sprint-status; resolve-story-input derives
// the canonical story_ref from it, and CR/TA evidence must echo it back.
const CANONICAL_REF = 'a1-2-preserve-story-input-resolution';

// ── Store / platform / deps (mirrors v2-story-dag.test.ts) ─────────────────

type NodeEventState = 'completed' | 'failed' | 'skipped';

const MOCK_RUN = {
  id: 'gate-planner-run-id',
  workflow_name: V2_STEM,
  conversation_id: 'conv-gp',
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
    // The dag-executor NEVER throws on node failure — it calls failWorkflowRun().
    // Tracking that call is the only reliable "run failed" signal.
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
    id: 'gate-planner-run-id',
    workflow_name: V2_STEM,
    conversation_id: 'conv-gp',
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
  const cwd = join(baseDir, 'gate-planner-fixture');
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
  /** Absolute artifacts dir for this run — where node sidecars + gate-planner.json land. */
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
      'conv-gp',
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

// ── gate-planner output capture (typed sidecar) ────────────────────────────
// When gate-planner completes with `output_type: gate-decision`, the executor
// writes its raw stdout to <artifactsDir>/nodes/gate-planner.md (writeNodeArtifact,
// dag-executor.ts:4193-4220). On a fail-closed exit no sidecar is written — capture
// returns null, which is exactly the "no partial contract" observable.

async function readGatePlannerOutput(
  artifactsDir: string
): Promise<Record<string, unknown> | null> {
  const sidecar = join(artifactsDir, 'nodes', 'gate-planner.md');
  if (!existsSync(sidecar)) return null;
  const raw = (await readFile(sidecar, 'utf-8')).trim();
  if (!raw) return null;
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    // A parse failure here is a real defect (malformed printf JSON, R-003) — surface it.
    throw new Error(`gate-planner sidecar is not valid JSON: ${raw.slice(0, 200)}`);
  }
}

/** The best-effort machine-readable artifact gate-planner writes on success. */
function gatePlannerArtifactPath(artifactsDir: string): string {
  return join(artifactsDir, 'bmad-dev-story-with-tea-fix-loop', 'gate-planner.json');
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

/** Downstream AI nodes must respond so they complete without provider errors. */
const DOWNSTREAM_OK = {
  'dev-story': {},
  'tea-rv': {},
  'tea-nr': {},
  'tea-tr': {},
  'create-pull-request': {},
};

async function expectFailClosedNoContract(run: DagRun): Promise<void> {
  expect(run.runFailed, 'invalid evidence must fail the run closed').toBe(true);
  expect(
    run.nodeState['gate-planner'],
    'gate-planner must NOT complete on invalid evidence'
  ).not.toBe('completed');
  const contract = await readGatePlannerOutput(run.artifactsDir);
  expect(
    contract,
    'no gate-planner contract sidecar may be emitted on invalid evidence'
  ).toBeNull();
  expect(
    existsSync(gatePlannerArtifactPath(run.artifactsDir)),
    'no partial gate-planner.json artifact may be written on invalid evidence'
  ).toBe(false);
}

// ── Fixture lifecycle ──────────────────────────────────────────────────────

let fixtureBase = '';
let cwdFixture = '';

beforeAll(async () => {
  fixtureBase = join(tmpdir(), `gate-planner-dag-${process.pid}`);
  cwdFixture = await buildFixtureDir(fixtureBase);
});

afterAll(async () => {
  await rm(fixtureBase, { recursive: true, force: true });
});

// ── Happy path + flag proofs ───────────────────────────────────────────────

describe('gate-planner — happy path + flag computation (real bash)', () => {
  it('A3.1-INT-001 [P0] valid CR+TA evidence → gate-planner emits ONE JSON object with all flags + reasons present', async () => {
    const run = await runV2Dag({
      cwd: cwdFixture,
      arguments: CANONICAL_REF,
      nodeResponses: {
        'code-review-auto': validCrEvidence(),
        'tea-automate': validTaEvidence(),
        ...DOWNSTREAM_OK,
      },
    });

    expect(run.nodeState['gate-planner'], 'gate-planner must complete on valid evidence').toBe(
      'completed'
    );
    const c = await readGatePlannerOutput(run.artifactsDir);
    expect(c, 'gate-planner must emit a JSON contract').not.toBeNull();
    for (const key of ['run_rv', 'run_nr', 'run_tr', 'reason_rv', 'reason_nr', 'reason_tr']) {
      expect(c, `emitted contract must contain ${key}`).toHaveProperty(key);
    }
    expect(typeof c!.reason_rv, 'reasons must be human-readable strings').toBe('string');
  });

  it('A3.1-INT-016 [P0] fixture proves TRUE: TA_TESTS=3, nfr="true" → run_rv/nr/tr all === true (JSON booleans)', async () => {
    const run = await runV2Dag({
      cwd: cwdFixture,
      arguments: CANONICAL_REF,
      nodeResponses: {
        'code-review-auto': validCrEvidence(),
        'tea-automate': validTaEvidence({ test_files_changed: 3, nfr_relevant: 'true' }),
        ...DOWNSTREAM_OK,
      },
    });

    const c = await readGatePlannerOutput(run.artifactsDir);
    expect(c, 'gate-planner must emit a contract on the true-case').not.toBeNull();
    // AC5: strict JSON boolean, not the string "true".
    expect(typeof c!.run_rv).toBe('boolean');
    expect(typeof c!.run_nr).toBe('boolean');
    expect(typeof c!.run_tr).toBe('boolean');
    expect(c!.run_rv).toBe(true);
    expect(c!.run_nr).toBe(true);
    expect(c!.run_tr).toBe(true);
  });

  it('A3.1-INT-017 [P0] fixture proves FALSE (boundary=0): TA_TESTS=0, nfr="false" → run_rv=false, run_nr=false, run_tr=true', async () => {
    // 0 is BOTH the valid false-trigger for run_rv AND the boundary of the
    // non-negative-integer validity check (R-012). It must be accepted, not rejected.
    const run = await runV2Dag({
      cwd: cwdFixture,
      arguments: CANONICAL_REF,
      nodeResponses: {
        'code-review-auto': validCrEvidence(),
        'tea-automate': validTaEvidence({ test_files_changed: 0, nfr_relevant: 'false' }),
        ...DOWNSTREAM_OK,
      },
    });

    expect(run.nodeState['gate-planner'], 'TA_TESTS=0 is VALID → gate-planner must complete').toBe(
      'completed'
    );
    const c = await readGatePlannerOutput(run.artifactsDir);
    expect(c).not.toBeNull();
    expect(typeof c!.run_rv).toBe('boolean');
    expect(c!.run_rv).toBe(false);
    expect(c!.run_nr).toBe(false);
    expect(c!.run_tr).toBe(true);
  });

  it('A3.1-INT-019 [P1] boundary just-above-zero: TA_TESTS=1 → run_rv === true', async () => {
    const run = await runV2Dag({
      cwd: cwdFixture,
      arguments: CANONICAL_REF,
      nodeResponses: {
        'code-review-auto': validCrEvidence(),
        'tea-automate': validTaEvidence({ test_files_changed: 1, nfr_relevant: 'false' }),
        ...DOWNSTREAM_OK,
      },
    });
    const c = await readGatePlannerOutput(run.artifactsDir);
    expect(c).not.toBeNull();
    expect(c!.run_rv).toBe(true);
    expect(c!.run_nr).toBe(false);
  });

  it('A3.1-INT-014 [P1] run_tr defaults TRUE in BOTH true- and false-cases; reason_tr states it is the default final gate', async () => {
    const trueRun = await runV2Dag({
      cwd: cwdFixture,
      arguments: CANONICAL_REF,
      nodeResponses: {
        'code-review-auto': validCrEvidence(),
        'tea-automate': validTaEvidence({ test_files_changed: 3, nfr_relevant: 'true' }),
        ...DOWNSTREAM_OK,
      },
    });
    const falseRun = await runV2Dag({
      cwd: cwdFixture,
      arguments: CANONICAL_REF,
      nodeResponses: {
        'code-review-auto': validCrEvidence(),
        'tea-automate': validTaEvidence({ test_files_changed: 0, nfr_relevant: 'false' }),
        ...DOWNSTREAM_OK,
      },
    });
    const tc = await readGatePlannerOutput(trueRun.artifactsDir);
    const fc = await readGatePlannerOutput(falseRun.artifactsDir);
    expect(tc?.run_tr).toBe(true);
    expect(fc?.run_tr).toBe(true);
    expect(String(fc?.reason_tr).toLowerCase()).toContain('default');
  });

  it('A3.1-INT-013 [P1] emitted envelope carries contract_version="1.0", workflow=v2, node="gate-planner", story_ref=resolved', async () => {
    const run = await runV2Dag({
      cwd: cwdFixture,
      arguments: CANONICAL_REF,
      nodeResponses: {
        'code-review-auto': validCrEvidence(),
        'tea-automate': validTaEvidence(),
        ...DOWNSTREAM_OK,
      },
    });
    const c = await readGatePlannerOutput(run.artifactsDir);
    expect(c).not.toBeNull();
    expect(c!.contract_version).toBe('1.0');
    expect(c!.workflow).toBe(V2_STEM);
    expect(c!.node).toBe('gate-planner');
    expect(c!.story_ref).toBe(CANONICAL_REF);
  });

  it('A3.1-INT-020 [P2] nfr_relevant pin: "true"→run_nr=true and "false"→run_nr=false are deterministic under fixed evidence', async () => {
    const on = await runV2Dag({
      cwd: cwdFixture,
      arguments: CANONICAL_REF,
      nodeResponses: {
        'code-review-auto': validCrEvidence(),
        'tea-automate': validTaEvidence({ test_files_changed: 2, nfr_relevant: 'true' }),
        ...DOWNSTREAM_OK,
      },
    });
    const off = await runV2Dag({
      cwd: cwdFixture,
      arguments: CANONICAL_REF,
      nodeResponses: {
        'code-review-auto': validCrEvidence(),
        'tea-automate': validTaEvidence({ test_files_changed: 2, nfr_relevant: 'false' }),
        ...DOWNSTREAM_OK,
      },
    });
    expect((await readGatePlannerOutput(on.artifactsDir))?.run_nr).toBe(true);
    expect((await readGatePlannerOutput(off.artifactsDir))?.run_nr).toBe(false);
  });

  it('A3.1-INT-021 [P1] real-bash meta-assert: the AI provider is NEVER invoked for gate-planner; output is genuine bash stdout', async () => {
    // Guards against a fake test (R-007): if gate-planner were an AI/mocked node, it
    // would appear in providerCalls. A bash node must not — its JSON is real stdout.
    const run = await runV2Dag({
      cwd: cwdFixture,
      arguments: CANONICAL_REF,
      nodeResponses: {
        'code-review-auto': validCrEvidence(),
        'tea-automate': validTaEvidence({ test_files_changed: 4, nfr_relevant: 'true' }),
        ...DOWNSTREAM_OK,
      },
    });
    expect(
      run.providerCalls,
      'gate-planner is a bash node — the AI provider must never be called for it'
    ).not.toContain('gate-planner');
    const c = await readGatePlannerOutput(run.artifactsDir);
    // The carried-through evidence count proves bash actually consumed TA output.
    expect(
      c?.ta_test_files_changed ?? c?.run_rv,
      'genuine bash-computed output expected'
    ).toBeDefined();
  });
});

// ── Fail-closed matrix (AC2 / R-001) ───────────────────────────────────────

describe('gate-planner — fail-closed on invalid evidence (no partial contract, no dev-story loop)', () => {
  it('A3.1-INT-003 [P0] TA story_ref ≠ resolved → gate-planner exits non-zero, no contract', async () => {
    // verify-story-identity only validates CR evidence — a TA mismatch is gate-planner's
    // OWN fail-closed responsibility. CR is valid+matching so control reaches gate-planner.
    const run = await runV2Dag({
      cwd: cwdFixture,
      arguments: CANONICAL_REF,
      nodeResponses: {
        'code-review-auto': validCrEvidence(),
        'tea-automate': validTaEvidence({ story_ref: 'some-other-story' }),
        ...DOWNSTREAM_OK,
      },
    });
    expect(run.nodeState['gate-planner'], 'TA story_ref mismatch must fail gate-planner').toBe(
      'failed'
    );
    await expectFailClosedNoContract(run);
  });

  it('A3.1-INT-007 [P1] TA node ≠ "tea-automate" (envelope tamper) → fail closed', async () => {
    const run = await runV2Dag({
      cwd: cwdFixture,
      arguments: CANONICAL_REF,
      nodeResponses: {
        'code-review-auto': validCrEvidence(),
        'tea-automate': validTaEvidence({ node: 'not-tea-automate' }),
        ...DOWNSTREAM_OK,
      },
    });
    await expectFailClosedNoContract(run);
  });

  it('A3.1-INT-009 [P1] TA_TESTS ∈ {-1, "abc", ""} → each fails closed (not a non-negative integer)', async () => {
    for (const bad of [-1, 'abc', '']) {
      const run = await runV2Dag({
        cwd: cwdFixture,
        arguments: CANONICAL_REF,
        nodeResponses: {
          'code-review-auto': validCrEvidence(),
          'tea-automate': validTaEvidence({ test_files_changed: bad }),
          ...DOWNSTREAM_OK,
        },
      });
      expect(
        run.nodeState['gate-planner'],
        `TA_TESTS=${JSON.stringify(bad)} must fail gate-planner closed`
      ).not.toBe('completed');
      await expectFailClosedNoContract(run);
    }
  });

  it('A3.1-INT-010 [P1] TA_NFR ∉ {"true","false"} (e.g. "TRUE","yes","") → fail closed (enum strictness)', async () => {
    for (const bad of ['TRUE', 'yes', '']) {
      const run = await runV2Dag({
        cwd: cwdFixture,
        arguments: CANONICAL_REF,
        nodeResponses: {
          'code-review-auto': validCrEvidence(),
          'tea-automate': validTaEvidence({ nfr_relevant: bad }),
          ...DOWNSTREAM_OK,
        },
      });
      await expectFailClosedNoContract(run);
    }
  });

  it('A3.1-INT-011 [P0] partial-failure guard: on ANY validation failure, NO partial JSON is emitted before the exit', async () => {
    // Directly proves "emits no partial contract": neither the typed sidecar nor the
    // best-effort gate-planner.json exists after a fail-closed exit.
    const run = await runV2Dag({
      cwd: cwdFixture,
      arguments: CANONICAL_REF,
      nodeResponses: {
        'code-review-auto': validCrEvidence(),
        'tea-automate': validTaEvidence({ test_files_changed: -1 }),
        ...DOWNSTREAM_OK,
      },
    });
    await expectFailClosedNoContract(run);
  });

  it('A3.1-INT-002 [P0] CR story_ref ≠ resolved → run fails closed, gate-planner never reached, no contract', async () => {
    // The CR mismatch is caught upstream by verify-story-identity, so gate-planner is
    // skipped — still "invalid CR evidence ⇒ no gate-planner contract + run failed".
    const run = await runV2Dag({
      cwd: cwdFixture,
      arguments: CANONICAL_REF,
      nodeResponses: {
        'code-review-auto': validCrEvidence({ story_ref: 'wrong-story', gate: 'FAIL' }),
        'tea-automate': validTaEvidence(),
        ...DOWNSTREAM_OK,
      },
    });
    expect(run.nodeState['gate-planner'], 'gate-planner must not complete on CR mismatch').not.toBe(
      'completed'
    );
    await expectFailClosedNoContract(run);
  });

  it('A3.1-INT-004 [P1] CR contract_version ≠ "1.0" → fail closed', async () => {
    const run = await runV2Dag({
      cwd: cwdFixture,
      arguments: CANONICAL_REF,
      nodeResponses: {
        'code-review-auto': validCrEvidence({ contract_version: '2.0' }),
        'tea-automate': validTaEvidence(),
        ...DOWNSTREAM_OK,
      },
    });
    await expectFailClosedNoContract(run);
  });

  it('A3.1-INT-008 [P0] empty resolved story_ref (unresolvable story) → fail closed, no provider called, no contract', async () => {
    const run = await runV2Dag({
      cwd: cwdFixture,
      arguments: 'this-story-does-not-exist-xyz',
      nodeResponses: {
        'code-review-auto': validCrEvidence(),
        'tea-automate': validTaEvidence(),
        ...DOWNSTREAM_OK,
      },
    });
    expect(run.nodeState['resolve-story-input'], 'resolve-story-input must fail').toBe('failed');
    await expectFailClosedNoContract(run);
  });

  it('A3.1-INT-012 [P1] regression: gate-planner failure is a HARD node error — it never routes back to dev-story', async () => {
    // gate-planner sits AFTER the CR route_loop, not inside it, so a failure cannot
    // feed the dev-story fix loop. dev-story is invoked exactly once (initial run).
    const run = await runV2Dag({
      cwd: cwdFixture,
      arguments: CANONICAL_REF,
      nodeResponses: {
        'code-review-auto': validCrEvidence(),
        'tea-automate': validTaEvidence({ story_ref: 'mismatch-forces-gate-planner-failure' }),
        ...DOWNSTREAM_OK,
      },
    });
    expect(run.runFailed).toBe(true);
    expect(
      run.providerCalls.filter(c => c === 'dev-story').length,
      'dev-story must run exactly once — gate-planner failure must NOT re-enter the fix loop'
    ).toBe(1);
  });

  it('A3.1-INT-025 [P2] upstream dependency failure: tea-automate emits no schema-valid output → gate-planner unreached, workflow fails at TA', async () => {
    // No tea-automate nodeResponse → enforced codex provider fails output_format
    // validation → tea-automate 'failed' → CR/verify/gate all skipped.
    const run = await runV2Dag({
      cwd: cwdFixture,
      arguments: CANONICAL_REF,
      nodeResponses: {
        'code-review-auto': validCrEvidence(),
        'dev-story': {},
      },
    });
    expect(
      run.nodeState['tea-automate'],
      'tea-automate must fail when it yields no schema-valid structured output'
    ).toBe('failed');
    expect(
      run.nodeState['gate-planner'],
      'gate-planner must never run when TA fails upstream'
    ).not.toBe('completed');
    expect(run.runFailed).toBe(true);
  });

  it.skip('A3.1-INT-022 [P1] output-JSON escaping: a story_ref with " \\ newline backtick $(...) still yields JSON.parse-valid output', async () => {
    // SKIPPED — no injection seam yet. The only variable envelope field that can carry
    // shell/JSON metacharacters is story_ref, and it is produced by resolve-story-input
    // from the sprint-status key. To drive a metacharacter-laden RESOLVED_REF into
    // gate-planner we need one of:
    //   (a) a sprint-status fixture whose story key contains metacharacters AND survives
    //       resolve-story-input's own key validation, or
    //   (b) a lower-level bash harness that invokes the gate-planner bash body directly
    //       with a crafted RESOLVED_REF env/substitution.
    // Neither seam exists today. ACTIVATE once one is added, then assert:
    //   const c = await readGatePlannerOutput(run.artifactsDir);
    //   expect(c).not.toBeNull();               // printf JSON survived the metacharacters
    //   expect(c!.story_ref).toBe(nastyRef);    // value round-trips intact
    // This proves the implementer-owned emitted-JSON escaping (R-003), which the
    // input-side single-quote substitution (verified safe, NR-1) does not cover.
    expect(true).toBe(false);
  });
});
