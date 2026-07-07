/**
 * Behavioral / DAG-level acceptance tests for the gate-planner node.
 *
 * Drives the REAL executor + REAL `gate-planner` bash node through a minimal v2 DAG.
 * Only the AI provider nodes (dev-story / tea-automate / code-review-auto / tea-*) are
 * mocked; bash nodes (prepare-bmad-state, resolve-story-input, verify-story-identity,
 * and the new gate-planner) execute for real. This proves the fail-closed invariant
 * and the real-JSON-boolean flags — a mocked gate-planner would be a fake test.
 *
 * This file uses mock.module('@archon/paths', ...) — Bun's mock.module() is
 * process-global and irreversible — so it MUST run in its own isolated bun test
 * invocation (see packages/workflows/package.json).
 */

import { describe, it, expect, mock, beforeAll, afterAll } from 'bun:test';
import { mkdir, writeFile, rm, readFile } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

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

// ── gate-planner output capture ────────────────────────────────────────────

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
    throw new Error(`gate-planner sidecar is not valid JSON: ${raw.slice(0, 200)}`);
  }
}

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
  it('valid CR+TA evidence produces a JSON contract with all flags and reasons', async () => {
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

  it('fixture proves TRUE: test_files_changed=3, nfr=true yields all flags true as JSON booleans', async () => {
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
    expect(typeof c!.run_rv).toBe('boolean');
    expect(typeof c!.run_nr).toBe('boolean');
    expect(typeof c!.run_tr).toBe('boolean');
    expect(c!.run_rv).toBe(true);
    expect(c!.run_nr).toBe(true);
    expect(c!.run_tr).toBe(true);
  });

  it('fixture proves FALSE (boundary=0): test_files_changed=0, nfr=false yields run_rv=false, run_nr=false, run_tr=true', async () => {
    const run = await runV2Dag({
      cwd: cwdFixture,
      arguments: CANONICAL_REF,
      nodeResponses: {
        'code-review-auto': validCrEvidence(),
        'tea-automate': validTaEvidence({ test_files_changed: 0, nfr_relevant: 'false' }),
        ...DOWNSTREAM_OK,
      },
    });

    expect(run.nodeState['gate-planner'], 'TA_TESTS=0 is valid, gate-planner must complete').toBe(
      'completed'
    );
    const c = await readGatePlannerOutput(run.artifactsDir);
    expect(c).not.toBeNull();
    expect(typeof c!.run_rv).toBe('boolean');
    expect(c!.run_rv).toBe(false);
    expect(c!.run_nr).toBe(false);
    expect(c!.run_tr).toBe(true);
  });

  it('boundary just above zero: test_files_changed=1 yields run_rv=true', async () => {
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

  it('run_tr defaults true in both true- and false-cases; reason_tr states it is the default final gate', async () => {
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

  it('emitted envelope carries contract_version=1.0, workflow=v2, node=gate-planner, story_ref=resolved', async () => {
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

  it('nfr_relevant pin: true yields run_nr=true and false yields run_nr=false deterministically', async () => {
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

  it('real-bash meta-assert: AI provider is never invoked for gate-planner', async () => {
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
    expect(
      c?.ta_test_files_changed ?? c?.run_rv,
      'genuine bash-computed output expected'
    ).toBeDefined();
  });
});

// ── Fail-closed matrix ─────────────────────────────────────────────────────

describe('gate-planner — fail-closed on invalid evidence', () => {
  it('TA story_ref mismatch yields fail-closed with no contract', async () => {
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

  it('TA node mismatch (envelope tamper) yields fail-closed', async () => {
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

  it('TA test_files_changed with invalid values (-1, "abc", "") each fail closed', async () => {
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

  it('TA nfr_relevant with invalid values ("TRUE", "yes", "") each fail closed', async () => {
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

  it('TA contract_version mismatch yields fail-closed', async () => {
    const run = await runV2Dag({
      cwd: cwdFixture,
      arguments: CANONICAL_REF,
      nodeResponses: {
        'code-review-auto': validCrEvidence(),
        'tea-automate': validTaEvidence({ contract_version: '2.0' }),
        ...DOWNSTREAM_OK,
      },
    });
    await expectFailClosedNoContract(run);
  });

  it('TA workflow mismatch yields fail-closed', async () => {
    const run = await runV2Dag({
      cwd: cwdFixture,
      arguments: CANONICAL_REF,
      nodeResponses: {
        'code-review-auto': validCrEvidence(),
        'tea-automate': validTaEvidence({ workflow: 'some-other-workflow' }),
        ...DOWNSTREAM_OK,
      },
    });
    await expectFailClosedNoContract(run);
  });

  it('CR findings_count with invalid values (-1, "abc", "") each fail closed', async () => {
    for (const bad of [-1, 'abc', '']) {
      const run = await runV2Dag({
        cwd: cwdFixture,
        arguments: CANONICAL_REF,
        nodeResponses: {
          'code-review-auto': validCrEvidence({ findings_count: bad }),
          'tea-automate': validTaEvidence(),
          ...DOWNSTREAM_OK,
        },
      });
      expect(
        run.nodeState['gate-planner'],
        `CR_FINDINGS=${JSON.stringify(bad)} must fail gate-planner closed`
      ).not.toBe('completed');
      await expectFailClosedNoContract(run);
    }
  });

  it('oversized digit-only counts exceed safe integer range and fail closed', async () => {
    const oversized = 100000000000000000000;
    const taOversized = await runV2Dag({
      cwd: cwdFixture,
      arguments: CANONICAL_REF,
      nodeResponses: {
        'code-review-auto': validCrEvidence(),
        'tea-automate': validTaEvidence({ test_files_changed: oversized }),
        ...DOWNSTREAM_OK,
      },
    });
    expect(
      taOversized.nodeState['gate-planner'],
      'oversized TA_TESTS must fail gate-planner closed'
    ).not.toBe('completed');
    await expectFailClosedNoContract(taOversized);

    const crOversized = await runV2Dag({
      cwd: cwdFixture,
      arguments: CANONICAL_REF,
      nodeResponses: {
        'code-review-auto': validCrEvidence({ findings_count: oversized }),
        'tea-automate': validTaEvidence(),
        ...DOWNSTREAM_OK,
      },
    });
    expect(
      crOversized.nodeState['gate-planner'],
      'oversized CR_FINDINGS must fail gate-planner closed'
    ).not.toBe('completed');
    await expectFailClosedNoContract(crOversized);
  });

  it('partial-failure guard: no partial JSON is emitted before the exit on any validation failure', async () => {
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

  it('CR story_ref mismatch causes run to fail closed before gate-planner is reached', async () => {
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

  it('CR contract_version mismatch yields fail-closed', async () => {
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

  it('empty resolved story_ref (unresolvable story) yields fail-closed', async () => {
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

  it('gate-planner failure never routes back to dev-story (hard node error, not a loop)', async () => {
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

  it('upstream dependency failure: tea-automate emits no schema-valid output, gate-planner unreached', async () => {
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
});

// ── JSON-escaping proof (direct bash execution) ────────────────────────────

describe('gate-planner — JSON serialization of dynamic string fields', () => {
  it('bun JSON.stringify produces valid JSON when story_ref contains backslash, double-quote, newline, carriage return, and tab', async () => {
    const nastyRef = 'a1-2-test\\with"quotes\nand\rcarriage\ttab';
    const bashScript = `
      set -e
      RESOLVED_REF="$1"
      RUN_RV=true; RUN_NR=false; RUN_TR=true
      REASON_RV="test reason"
      REASON_NR="test reason"
      REASON_TR="Traceability review is the default final release gate."
      CR_FINDINGS=0; TA_TESTS=3
      CONTRACT=$(
        GP_STORY_REF="$RESOLVED_REF" \\
        GP_RUN_RV="$RUN_RV" \\
        GP_RUN_NR="$RUN_NR" \\
        GP_RUN_TR="$RUN_TR" \\
        GP_REASON_RV="$REASON_RV" \\
        GP_REASON_NR="$REASON_NR" \\
        GP_REASON_TR="$REASON_TR" \\
        GP_CR_FINDINGS="$CR_FINDINGS" \\
        GP_TA_TESTS="$TA_TESTS" \\
        bun -e 'process.stdout.write(JSON.stringify({contract_version:"1.0",workflow:"bmad-dev-story-with-tea-fix-loop-v2",node:"gate-planner",story_ref:process.env.GP_STORY_REF,run_rv:process.env.GP_RUN_RV==="true",run_nr:process.env.GP_RUN_NR==="true",run_tr:process.env.GP_RUN_TR==="true",reason_rv:process.env.GP_REASON_RV,reason_nr:process.env.GP_REASON_NR,reason_tr:process.env.GP_REASON_TR,cr_findings_count:Number(process.env.GP_CR_FINDINGS),ta_test_files_changed:Number(process.env.GP_TA_TESTS)}))'
      )
      printf '%s' "$CONTRACT"
    `;

    const { stdout } = await execFileAsync('bash', ['-c', bashScript, '_', nastyRef]);
    const parsed = JSON.parse(stdout) as Record<string, unknown>;
    expect(parsed.story_ref).toBe(nastyRef);
    expect(parsed.run_rv).toBe(true);
    expect(parsed.run_nr).toBe(false);
    expect(parsed.run_tr).toBe(true);
    expect(typeof parsed.run_rv).toBe('boolean');
    expect(typeof parsed.run_nr).toBe('boolean');
    expect(typeof parsed.run_tr).toBe('boolean');
    expect(parsed.contract_version).toBe('1.0');
    expect(parsed.cr_findings_count).toBe(0);
    expect(parsed.ta_test_files_changed).toBe(3);
  });
});
