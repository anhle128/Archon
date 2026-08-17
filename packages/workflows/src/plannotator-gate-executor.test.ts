import { describe, expect, test, beforeEach, afterEach, afterAll, mock } from 'bun:test';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  writeFileSync,
  rmSync,
  symlinkSync,
} from 'node:fs';
import { basename, join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  buildReworkPrompt,
  executePlannotatorGateNode,
  resolveGateDocumentPath,
  preflightPlannotatorBinary,
  resolvePlannotatorGateId,
} from './plannotator-gate-executor';
import type { ApprovalContext, NodeOutput, PlannotatorGateNode, WorkflowRun } from './schemas';
import type { IWorkflowPlatform, WorkflowConfig, WorkflowDeps } from './deps';
import type { IWorkflowStore, WorkflowEventData } from './store';
import type { SendQueryOptions } from '@archon/providers/types';
import { clearRegistry, registerBuiltinProviders } from '@archon/providers';
import { projectLatestEffectiveNodeStates } from './retry-state';
import {
  cleanupPortableTestExecutables,
  writePortableBunExecutable,
  writePortableShellExecutable,
} from './plannotator-test-utils';

const fakeRootEnv = 'ARCHON_TEST_PLANNOTATOR_ROOT';
const originalFakeRoot = process.env[fakeRootEnv];
let windowsFakeBinDir: string | undefined;
let windowsFakeBin: string | undefined;

afterAll(() => {
  if (originalFakeRoot === undefined) delete process.env[fakeRootEnv];
  else process.env[fakeRootEnv] = originalFakeRoot;
  if (windowsFakeBinDir) rmSync(windowsFakeBinDir, { recursive: true, force: true });
  cleanupPortableTestExecutables('executor');
});

function makeRun(approval: Record<string, unknown>): WorkflowRun {
  return {
    id: 'run-1',
    workflow_name: 'wf',
    conversation_id: 'conv-1',
    parent_conversation_id: null,
    codebase_id: null,
    status: 'running',
    user_message: 'go',
    metadata: { approval },
    started_at: new Date(),
    completed_at: null,
    last_activity_at: new Date(),
    working_path: '/tmp',
    user_id: null,
    parent_run_id: null,
    output_root: null,
  };
}

type StoredEvent = Pick<WorkflowEventData, 'workflow_run_id' | 'event_type' | 'step_name' | 'data'>;

class IntegrationGateStore {
  readonly events: StoredEvent[] = [];
  readonly resumeApprovedGate = mock<IWorkflowStore['resumeApprovedGate']>(async (id, expected) => {
    const approval = this.run.metadata.approval as ApprovalContext | undefined;
    if (
      id !== this.run.id ||
      this.run.status !== 'paused' ||
      approval?.resolved !== 'approved' ||
      approval.nodeId !== expected.nodeId ||
      approval.gateId !== expected.gateId
    ) {
      return { resumed: false };
    }
    this.run.status = 'running';
    return { resumed: true };
  });

  constructor(readonly run: WorkflowRun) {}

  getWorkflowRun: IWorkflowStore['getWorkflowRun'] = id =>
    Promise.resolve(id === this.run.id ? structuredClone(this.run) : null);

  getWorkflowRunStatus: IWorkflowStore['getWorkflowRunStatus'] = id =>
    Promise.resolve(id === this.run.id ? this.run.status : null);

  createWorkflowEvent: IWorkflowStore['createWorkflowEvent'] = data => {
    this.events.push(data);
    return Promise.resolve();
  };

  readonly pauseWorkflowRun = mock<IWorkflowStore['pauseWorkflowRun']>((id, approval) => {
    if (id === this.run.id) {
      this.run.status = 'paused';
      this.run.metadata = { ...this.run.metadata, approval: { ...approval, resolved: null } };
    }
    return Promise.resolve();
  });

  transitionPlannotatorGate: IWorkflowStore['transitionPlannotatorGate'] = async input => {
    const approval = this.run.metadata.approval as ApprovalContext | undefined;
    if (this.run.status !== 'paused') return { outcome: 'stopped', status: this.run.status };
    if (
      input.runId !== this.run.id ||
      approval?.type !== 'plannotator_gate' ||
      approval.nodeId !== input.nodeId ||
      approval.gateId !== input.expectedGateId
    ) {
      return { outcome: 'superseded' };
    }
    if (approval.resolved != null) return { outcome: 'resolved', resolved: approval.resolved };
    const next: ApprovalContext = {
      ...approval,
      gateId: input.nextGateId ?? input.expectedGateId,
      document: input.document,
      phase: input.phase,
      reviewUrl: input.reviewUrl ?? null,
    };
    this.run.metadata = { ...this.run.metadata, approval: next };
    return { outcome: 'updated', approval: next };
  };

  resolveApprovalGate: IWorkflowStore['resolveApprovalGate'] = async (
    id,
    expected,
    metadata,
    events
  ) => {
    const approval = this.run.metadata.approval as ApprovalContext | undefined;
    if (
      id !== this.run.id ||
      this.run.status !== 'paused' ||
      approval?.resolved != null ||
      approval?.nodeId !== expected.nodeId ||
      approval.gateId !== expected.gateId
    ) {
      return { resolved: false };
    }
    this.run.metadata = { ...this.run.metadata, ...metadata };
    this.events.push(...events.map(event => ({ workflow_run_id: id, ...event })));
    return { resolved: true };
  };

  getDagResumeSnapshot: IWorkflowStore['getDagResumeSnapshot'] = () =>
    Promise.resolve({
      completedNodeOutputs: new Map(
        this.events
          .filter(event => event.event_type === 'node_completed' && event.step_name !== undefined)
          .map(event => [event.step_name ?? '', String(event.data?.node_output ?? '')])
      ),
      tokens: { input: 0, output: 0 },
    });

  asStore(): IWorkflowStore {
    return this as unknown as IWorkflowStore;
  }
}

interface FakePlannotator {
  bin: string;
  controlDir: string;
  invocationLog: string;
}

function createFakePlannotator(root: string): FakePlannotator {
  const controlDir = join(root, 'controls');
  const invocationLog = join(root, 'invocations.jsonl');
  mkdirSync(controlDir, { recursive: true });
  process.env[fakeRootEnv] = root;
  const source = `
import { appendFileSync, existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';

const args = Bun.argv.slice(2);
if (args[0] === 'annotate' && args.includes('--help')) {
  console.log('annotate --gate --json --persist-session --result-file <path>');
  process.exit(0);
}
const resultIndex = args.indexOf('--result-file');
if (args[0] !== 'annotate' || resultIndex < 0 || !args[resultIndex + 1]) process.exit(64);
const resultFile = args[resultIndex + 1];
const fixtureRoot = process.env.${fakeRootEnv};
if (!fixtureRoot) process.exit(65);
const controlDir = join(fixtureRoot, 'controls');
const invocationLog = join(fixtureRoot, 'invocations.jsonl');
const key = basename(resultFile);
const started = join(controlDir, key + '.started');
const control = join(controlDir, key + '.control.json');
const readyFile = process.env.PLANNOTATOR_READY_FILE;
if (!readyFile) process.exit(65);
writeFileSync(
  readyFile,
  JSON.stringify({ url: 'http://mac-mini.example.ts.net:19432', isRemote: true, port: 19432 }) + '\\n'
);
appendFileSync(invocationLog, JSON.stringify({ args, document: args[1], resultFile }) + '\\n');
writeFileSync(started, 'started\\n');
while (!existsSync(control)) {
  if (!existsSync(controlDir)) process.exit(66);
  await Bun.sleep(5);
}
const decision = JSON.parse(readFileSync(control, 'utf8'));
if (decision.stdout) console.log(decision.stdout);
if (decision.stderr) console.error(decision.stderr);
if (decision.payload !== undefined) {
  const temporary = resultFile + '.' + process.pid + '.tmp';
  writeFileSync(temporary, JSON.stringify(decision.payload) + '\\n');
  renameSync(temporary, resultFile);
}
process.exit(decision.exitCode ?? 0);
`;
  let bin: string;
  if (process.platform === 'win32') {
    windowsFakeBinDir ??= mkdtempSync(join(tmpdir(), 'archon-plannotator-fixture-'));
    windowsFakeBin ??= writePortableBunExecutable(windowsFakeBinDir, 'plannotator', source);
    bin = windowsFakeBin;
  } else {
    bin = writePortableBunExecutable(root, 'plannotator', source);
  }
  return { bin, controlDir, invocationLog };
}

function gateAttemptKey(gateId: string, attempt: number): string {
  return `gate-${encodeURIComponent(gateId)}-attempt-${String(attempt)}.json`;
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve: (value: T) => void;
  const promise = new Promise<T>(completion => {
    resolve = completion;
  });
  return { promise, resolve };
}

function releaseDecision(
  fake: FakePlannotator,
  gateId: string,
  attempt: number,
  payload: Record<string, unknown>
): void {
  writeFileSync(
    join(fake.controlDir, `${gateAttemptKey(gateId, attempt)}.control.json`),
    JSON.stringify({ payload, stdout: 'fake stdout', stderr: 'fake stderr', exitCode: 0 })
  );
}

async function waitForInvocations(fake: FakePlannotator, count: number): Promise<unknown[][]> {
  for (let attempt = 0; attempt < 600; attempt++) {
    if (existsSync(fake.invocationLog)) {
      const invocations = readFileSync(fake.invocationLog, 'utf8')
        .trim()
        .split('\n')
        .filter(Boolean)
        .map(line => JSON.parse(line) as { args: unknown[] });
      if (invocations.length >= count) return invocations.map(invocation => invocation.args);
    }
    await Bun.sleep(5);
  }
  throw new Error(`Timed out waiting for ${String(count)} fake Plannotator invocation(s)`);
}

function observeWhileWaiting<T>(promise: Promise<T>): Promise<T> {
  void promise.catch(() => undefined);
  return promise;
}

function integrationArgs(
  run: WorkflowRun,
  store: IntegrationGateStore,
  node: PlannotatorGateNode,
  cwd: string,
  artifactsDir: string,
  getAgentProvider: WorkflowDeps['getAgentProvider']
): Parameters<typeof executePlannotatorGateNode>[0] {
  const config: WorkflowConfig = {
    assistant: 'claude',
    prRemote: 'origin',
    assistants: { claude: {} },
    commands: {},
    defaults: { loadDefaultCommands: false, loadDefaultWorkflows: false },
  };
  const platform: IWorkflowPlatform = {
    sendMessage: mock(() => Promise.resolve()),
    getStreamingMode: mock(() => 'batch' as const),
    getPlatformType: mock(() => 'test'),
  };
  return {
    node,
    stepName: node.id,
    retryEpoch: 0,
    workflowRun: run,
    deps: {
      store: store.asStore(),
      getAgentProvider,
      loadConfig: mock(() => Promise.resolve(config)),
    },
    platform,
    conversationId: 'conv-1',
    cwd,
    artifactsDir,
    nodeOutputs: new Map(),
    config,
    workflowProvider: 'claude',
    workflowModel: undefined,
    stateDir: join(cwd, 'state'),
    baseBranch: 'main',
    docsDir: 'docs/',
    prRemote: 'origin',
    execContext: { kind: 'host' },
  };
}

describe('resolveGateDocumentPath', () => {
  let dir: string;
  let cwd: string;
  let artifactsDir: string;
  let outsideDir: string;

  beforeEach(() => {
    dir = join(
      tmpdir(),
      `plannotator-gate-exec-${Date.now()}-${Math.random().toString(36).slice(2)}`
    );
    cwd = join(dir, 'cwd');
    artifactsDir = join(dir, 'artifacts');
    outsideDir = join(dir, 'outside');
    mkdirSync(cwd, { recursive: true });
    mkdirSync(artifactsDir, { recursive: true });
    mkdirSync(outsideDir, { recursive: true });
  });

  afterEach(() => {
    chmodSync(dir, 0o700);
    rmSync(dir, { recursive: true, force: true });
  });

  test('resolves $node.output path ref to a readable HTML file under cwd', () => {
    const html = join(cwd, 'doc.html');
    writeFileSync(html, '<html></html>');
    const outputs = new Map<string, NodeOutput>([
      ['explain', { state: 'completed', output: html }],
    ]);
    expect(resolveGateDocumentPath('$explain.output', outputs, cwd, artifactsDir)).toBe(
      realpathSync(html)
    );
  });

  test('throws when file missing', () => {
    const outputs = new Map<string, NodeOutput>([
      ['explain', { state: 'completed', output: join(cwd, 'nope.html') }],
    ]);
    expect(() => resolveGateDocumentPath('$explain.output', outputs, cwd, artifactsDir)).toThrow();
  });

  test('resolves a relative readable HTML file against cwd', () => {
    writeFileSync(join(cwd, 'rel.html'), '<html></html>');
    const outputs = new Map<string, NodeOutput>();
    expect(resolveGateDocumentPath('rel.html', outputs, cwd, artifactsDir)).toBe(
      realpathSync(join(cwd, 'rel.html'))
    );
  });

  test('allows a readable HTML file under artifactsDir', () => {
    const html = join(artifactsDir, 'plan.htm');
    writeFileSync(html, '<html></html>');
    expect(resolveGateDocumentPath(html, new Map(), cwd, artifactsDir)).toBe(realpathSync(html));
  });

  test('rejects a directory named with an HTML extension', () => {
    const directory = join(cwd, 'directory.html');
    mkdirSync(directory);
    expect(() => resolveGateDocumentPath(directory, new Map(), cwd, artifactsDir)).toThrow(/file/i);
  });

  test.skipIf(process.platform === 'win32')('rejects an unreadable HTML file', () => {
    const html = join(cwd, 'unreadable.html');
    writeFileSync(html, '<html></html>');
    chmodSync(html, 0o000);
    expect(() => resolveGateDocumentPath(html, new Map(), cwd, artifactsDir)).toThrow(/readable/i);
    chmodSync(html, 0o600);
  });

  test('allows a readable Markdown file under cwd', () => {
    const markdown = join(cwd, 'plan.md');
    writeFileSync(markdown, '# Plan');
    expect(resolveGateDocumentPath(markdown, new Map(), cwd, artifactsDir)).toBe(
      realpathSync(markdown)
    );
  });

  test('rejects an unsupported document type', () => {
    const text = join(cwd, 'plan.txt');
    writeFileSync(text, 'Plan');
    expect(() => resolveGateDocumentPath(text, new Map(), cwd, artifactsDir)).toThrow(
      /HTML or Markdown/i
    );
  });

  test('rejects a relative path escaping cwd and both allowed roots', () => {
    const html = join(outsideDir, 'escaped.html');
    writeFileSync(html, '<html></html>');
    expect(() =>
      resolveGateDocumentPath('../outside/escaped.html', new Map(), cwd, artifactsDir)
    ).toThrow(/outside/i);
  });

  test('rejects an absolute path outside both allowed roots', () => {
    const html = join(outsideDir, 'absolute.html');
    writeFileSync(html, '<html></html>');
    expect(() => resolveGateDocumentPath(html, new Map(), cwd, artifactsDir)).toThrow(/outside/i);
  });

  test('rejects a symlink under cwd whose real target escapes both roots', () => {
    const target = join(outsideDir, 'target.html');
    writeFileSync(target, '<html></html>');
    if (process.platform === 'win32') {
      const link = join(cwd, 'outside-link');
      symlinkSync(outsideDir, link, 'junction');
      expect(() =>
        resolveGateDocumentPath(join(link, 'target.html'), new Map(), cwd, artifactsDir)
      ).toThrow(/outside/i);
    } else {
      const link = join(cwd, 'linked.html');
      symlinkSync(target, link);
      expect(() => resolveGateDocumentPath(link, new Map(), cwd, artifactsDir)).toThrow(/outside/i);
    }
  });
});

describe('buildReworkPrompt', () => {
  test('preserves placeholder text inside inserted reviewer annotations', () => {
    const annotations = 'Keep $REVIEW_DOCUMENT and $REVIEW_ANNOTATIONS literal.';
    expect(
      buildReworkPrompt(
        'Document: $REVIEW_DOCUMENT\nAnnotations: $REVIEW_ANNOTATIONS',
        '/tmp/plan.html',
        annotations
      )
    ).toBe(`Document: /tmp/plan.html\nAnnotations: ${annotations}`);
  });

  test('preserves placeholder text inside the document path', () => {
    const documentPath = '/tmp/$REVIEW_ANNOTATIONS/plan.html';
    expect(
      buildReworkPrompt(
        'Document: $REVIEW_DOCUMENT\nAnnotations: $REVIEW_ANNOTATIONS',
        documentPath,
        'Fix the heading.'
      )
    ).toBe(`Document: ${documentPath}\nAnnotations: Fix the heading.`);
  });
});

describe('preflightPlannotatorBinary', () => {
  const original = process.env.PLANNOTATOR_BIN;
  const dirs: string[] = [];

  afterEach(() => {
    if (original === undefined) delete process.env.PLANNOTATOR_BIN;
    else process.env.PLANNOTATOR_BIN = original;
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  function fakeBinary(body: string): string {
    const dir = mkdtempSync(join(tmpdir(), 'plannotator-preflight-'));
    dirs.push(dir);
    return writePortableShellExecutable(dir, 'plannotator', body, 'executor');
  }

  test('throws a clear error when binary is missing', async () => {
    const prev = process.env.PLANNOTATOR_BIN;
    process.env.PLANNOTATOR_BIN = '/nonexistent/plannotator-binary-xyz';
    try {
      await expect(preflightPlannotatorBinary()).rejects.toThrow(/binary not found/);
    } finally {
      if (prev === undefined) delete process.env.PLANNOTATOR_BIN;
      else process.env.PLANNOTATOR_BIN = prev;
    }
  });

  test('rejects a present binary whose help omits --persist-session', async () => {
    process.env.PLANNOTATOR_BIN = fakeBinary(
      `printf '%s\\n' 'Usage: annotate --gate --json --result-file <path>'`
    );

    await expect(preflightPlannotatorBinary()).rejects.toThrow(/--persist-session/);
  });

  test('rejects a present binary whose help omits --result-file', async () => {
    process.env.PLANNOTATOR_BIN = fakeBinary(
      `printf '%s\\n' 'Usage: annotate --gate --json --persist-session'`
    );

    await expect(preflightPlannotatorBinary()).rejects.toThrow(/--result-file/);
  });

  test('reports bounded stderr when annotate --help exits non-zero', async () => {
    process.env.PLANNOTATOR_BIN = fakeBinary(`printf '%s\\n' 'broken install' >&2\nexit 7`);

    await expect(preflightPlannotatorBinary()).rejects.toThrow(/exit.*7.*broken install/i);
  });

  test('accepts capabilities printed across stdout and stderr', async () => {
    process.env.PLANNOTATOR_BIN = fakeBinary(
      `printf '%s\\n' '--persist-session'\nprintf '%s\\n' '--result-file <path>' >&2`
    );

    await expect(preflightPlannotatorBinary()).resolves.toBe(process.env.PLANNOTATOR_BIN);
  });
});

describe('executePlannotatorGateNode production spawn path', () => {
  const originalBin = process.env.PLANNOTATOR_BIN;
  let root: string;
  let cwd: string;
  let artifactsDir: string;
  let fake: FakePlannotator;

  beforeEach(() => {
    clearRegistry();
    registerBuiltinProviders();
    root = mkdtempSync(join(tmpdir(), 'plannotator-executor-integration-'));
    cwd = join(root, 'cwd');
    artifactsDir = join(root, 'artifacts');
    mkdirSync(cwd);
    mkdirSync(artifactsDir);
    fake = createFakePlannotator(root);
    process.env.PLANNOTATOR_BIN = fake.bin;
  });

  afterEach(() => {
    if (originalBin === undefined) delete process.env.PLANNOTATOR_BIN;
    else process.env.PLANNOTATOR_BIN = originalBin;
    rmSync(root, { recursive: true, force: true });
  });

  test('approves a nested gate with scoped ready identity, one completion, and one resume', async () => {
    const document = join(cwd, 'plan.md');
    writeFileSync(document, '# Plan');
    const run = makeRun({
      type: 'plannotator_gate',
      nodeId: 'review',
      gateId: 'gate-approve',
      phase: 'opening',
      resolved: null,
    });
    const store = new IntegrationGateStore(run);
    const getAgentProvider = mock(() => {
      throw new Error('rework provider must not run on approval');
    }) as WorkflowDeps['getAgentProvider'];
    const node: PlannotatorGateNode = {
      id: 'review',
      plannotator_gate: {
        document,
        capture_response: true,
        rework: { prompt: 'Revise $REVIEW_DOCUMENT using $REVIEW_ANNOTATIONS' },
      },
    };

    const args = integrationArgs(run, store, node, cwd, artifactsDir, getAgentProvider);
    args.stepName = 'review-loop.review';
    const execution = observeWhileWaiting(executePlannotatorGateNode(args));
    const invocations = await waitForInvocations(fake, 1);
    for (let attempt = 0; attempt < 600; attempt++) {
      const approval = store.run.metadata.approval as ApprovalContext;
      if (approval.reviewUrl) break;
      await Bun.sleep(5);
    }
    expect(store.pauseWorkflowRun).toHaveBeenCalledTimes(1);
    expect(store.run.status).toBe('paused');
    expect(store.run.metadata.approval).toMatchObject({
      type: 'plannotator_gate',
      nodeId: 'review',
      gateId: 'gate-approve',
      phase: 'waiting_decision',
      reviewUrl: 'http://mac-mini.example.ts.net:19432',
      resolved: null,
    });
    expect(store.events.filter(event => event.event_type === 'approval_requested')).toEqual([
      {
        workflow_run_id: 'run-1',
        event_type: 'approval_requested',
        step_name: 'review-loop.review',
        data: {
          gateType: 'plannotator_gate',
          nodeId: 'review',
          message: expect.any(String),
          reviewUrl: 'http://mac-mini.example.ts.net:19432',
        },
      },
    ]);
    releaseDecision(fake, 'gate-approve', 1, {
      decision: 'approved',
      feedback: 'Ship it',
    });

    await expect(execution).resolves.toEqual({ state: 'completed', output: 'Ship it' });
    expect(invocations[0]).toEqual([
      'annotate',
      realpathSync(document),
      '--gate',
      '--json',
      '--persist-session',
      '--result-file',
      join(artifactsDir, 'plannotator-gates', 'gate-gate-approve-attempt-1.json'),
    ]);
    expect(store.events.filter(event => event.event_type === 'node_completed')).toHaveLength(1);
    expect(store.events.filter(event => event.event_type === 'approval_received')).toEqual([
      expect.objectContaining({
        step_name: 'review',
        data: { decision: 'approved', comment: 'Ship it' },
      }),
    ]);
    expect(store.run.metadata.approval).toMatchObject({ resolved: 'approved' });
    expect(store.resumeApprovedGate).toHaveBeenCalledTimes(1);
    expect(store.run.status).toBe('running');
  }, 15_000);

  test('uses the final assistant response after prepare tool calls as the document path', async () => {
    const document = join(cwd, 'prepared.md');
    const run = makeRun({});
    const store = new IntegrationGateStore(run);
    const sendQuery = mock(async function* (prompt: string) {
      expect(prompt).toBe('Create the review for run-1 and upstream-value');
      writeFileSync(document, '# Prepared review');
      yield {
        type: 'assistant' as const,
        content: 'I found the requested delta and will now write the explainer.',
      };
      yield { type: 'tool' as const, toolName: 'Write', toolInput: { file_path: document } };
      yield {
        type: 'tool_result' as const,
        toolName: 'Write',
        toolOutput: 'File written.',
        toolOutcome: 'success' as const,
      };
      const splitAt = Math.floor(document.length / 2);
      yield { type: 'assistant' as const, content: ` ${document.slice(0, splitAt)}` };
      yield { type: 'assistant' as const, content: `${document.slice(splitAt)} \n` };
    });
    const getAgentProvider = mock(
      () =>
        ({
          sendQuery,
          getType: () => 'claude',
          getCapabilities: () => ({}),
        }) as ReturnType<WorkflowDeps['getAgentProvider']>
    );
    const node: PlannotatorGateNode = {
      id: 'review',
      plannotator_gate: {
        prepare: { prompt: 'Create the review for $WORKFLOW_ID and $upstream.output' },
        rework: { prompt: 'Revise $REVIEW_DOCUMENT using $REVIEW_ANNOTATIONS' },
      },
    };
    const args = integrationArgs(run, store, node, cwd, artifactsDir, getAgentProvider);
    args.nodeOutputs.set('upstream', { state: 'completed', output: 'upstream-value' });

    const execution = observeWhileWaiting(executePlannotatorGateNode(args));
    const invocations = await waitForInvocations(fake, 1);
    expect(sendQuery).toHaveBeenCalledTimes(1);
    expect(invocations[0]?.[1]).toBe(realpathSync(document));
    expect(store.pauseWorkflowRun).toHaveBeenCalledTimes(1);

    const approval = store.run.metadata.approval as ApprovalContext;
    releaseDecision(fake, approval.gateId ?? '', 1, { decision: 'approved', feedback: 'Ship it' });
    await expect(execution).resolves.toEqual({ state: 'completed', output: '' });
  });

  test('preflights Plannotator before invoking prepare', async () => {
    const previous = process.env.PLANNOTATOR_BIN;
    process.env.PLANNOTATOR_BIN = '/nonexistent/plannotator-before-prepare';
    const run = makeRun({});
    const store = new IntegrationGateStore(run);
    const sendQuery = mock(async function* () {
      yield { type: 'assistant' as const, content: join(cwd, 'prepared.html') };
    });
    const getAgentProvider = mock(
      () =>
        ({ sendQuery, getType: () => 'claude', getCapabilities: () => ({}) }) as ReturnType<
          WorkflowDeps['getAgentProvider']
        >
    );
    const node: PlannotatorGateNode = {
      id: 'review',
      plannotator_gate: {
        prepare: { prompt: 'Create a review.' },
        rework: { prompt: 'Revise $REVIEW_DOCUMENT using $REVIEW_ANNOTATIONS' },
      },
    };

    try {
      const args = integrationArgs(run, store, node, cwd, artifactsDir, getAgentProvider);
      args.stepName = 'review-loop.review';
      args.retryEpoch = 2;
      args.iteration = 3;

      await expect(executePlannotatorGateNode(args)).resolves.toMatchObject({ state: 'failed' });
      expect(sendQuery).not.toHaveBeenCalled();
      expect(store.pauseWorkflowRun).not.toHaveBeenCalled();
      expect(
        store.events.map(event => ({
          event_type: event.event_type,
          step_name: event.step_name,
          data: event.data,
        }))
      ).toEqual([
        {
          event_type: 'node_failed',
          step_name: 'review-loop.review',
          data: {
            error: expect.stringMatching(/binary not found/i),
            retry_epoch: 2,
            iteration: 3,
          },
        },
      ]);
      expect(
        projectLatestEffectiveNodeStates(store.events).get('review-loop.review')
      ).toMatchObject({
        state: 'failed',
        retry_epoch: 2,
      });
    } finally {
      if (previous === undefined) delete process.env.PLANNOTATOR_BIN;
      else process.env.PLANNOTATOR_BIN = previous;
    }
  });

  test('fails a prepare provider error without pausing or spawning', async () => {
    const run = makeRun({});
    const store = new IntegrationGateStore(run);
    const sendQuery = mock(async function* () {
      throw new Error('prepare provider failed');
    });
    const getAgentProvider = mock(
      () =>
        ({ sendQuery, getType: () => 'claude', getCapabilities: () => ({}) }) as ReturnType<
          WorkflowDeps['getAgentProvider']
        >
    );
    const node: PlannotatorGateNode = {
      id: 'review',
      plannotator_gate: {
        prepare: { prompt: 'Create a review.' },
        rework: { prompt: 'Revise $REVIEW_DOCUMENT using $REVIEW_ANNOTATIONS' },
      },
    };

    await expect(
      executePlannotatorGateNode(
        integrationArgs(run, store, node, cwd, artifactsDir, getAgentProvider)
      )
    ).resolves.toMatchObject({ state: 'failed', error: 'prepare provider failed' });
    expect(store.pauseWorkflowRun).not.toHaveBeenCalled();
    expect(existsSync(fake.invocationLog)).toBe(false);
  });

  test('fails prepare output without pausing or spawning for an unsupported file type', async () => {
    const document = join(cwd, 'prepared.txt');
    writeFileSync(document, 'unsupported');
    const run = makeRun({});
    const store = new IntegrationGateStore(run);
    const sendQuery = mock(async function* () {
      yield { type: 'assistant' as const, content: document };
    });
    const getAgentProvider = mock(
      () =>
        ({ sendQuery, getType: () => 'claude', getCapabilities: () => ({}) }) as ReturnType<
          WorkflowDeps['getAgentProvider']
        >
    );
    const node: PlannotatorGateNode = {
      id: 'review',
      plannotator_gate: {
        prepare: { prompt: 'Create a review.' },
        rework: { prompt: 'Revise $REVIEW_DOCUMENT using $REVIEW_ANNOTATIONS' },
      },
    };

    await expect(
      executePlannotatorGateNode(
        integrationArgs(run, store, node, cwd, artifactsDir, getAgentProvider)
      )
    ).resolves.toMatchObject({
      state: 'failed',
      error: expect.stringMatching(/HTML or Markdown/i),
    });
    expect(store.pauseWorkflowRun).not.toHaveBeenCalled();
    expect(existsSync(fake.invocationLog)).toBe(false);
  });

  test('reuses a matching unresolved approval document without preparing again', async () => {
    const document = join(cwd, 'persisted.html');
    writeFileSync(document, '<html><body>persisted</body></html>');
    const run = makeRun({
      type: 'plannotator_gate',
      nodeId: 'review',
      gateId: 'gate-persisted',
      document,
      phase: 'idle',
      resolved: null,
    });
    const store = new IntegrationGateStore(run);
    const getAgentProvider = mock(() => {
      throw new Error('prepare must not run for persisted gate document');
    }) as WorkflowDeps['getAgentProvider'];
    const node: PlannotatorGateNode = {
      id: 'review',
      plannotator_gate: {
        prepare: { prompt: 'Create a replacement review.' },
        rework: { prompt: 'Revise $REVIEW_DOCUMENT using $REVIEW_ANNOTATIONS' },
      },
    };

    const execution = observeWhileWaiting(
      executePlannotatorGateNode(
        integrationArgs(run, store, node, cwd, artifactsDir, getAgentProvider)
      )
    );
    const invocations = await waitForInvocations(fake, 1);
    expect(invocations[0]?.[1]).toBe(realpathSync(document));
    expect(getAgentProvider).not.toHaveBeenCalled();
    const resultFileName = basename(String(invocations[0]?.[6]));
    writeFileSync(
      join(fake.controlDir, `${resultFileName}.control.json`),
      JSON.stringify({ payload: { decision: 'approved', feedback: 'Approved' }, exitCode: 0 })
    );
    await expect(execution).resolves.toEqual({ state: 'completed', output: '' });
  });

  test('aborts an idle embedded prepare call', async () => {
    const run = makeRun({});
    const store = new IntegrationGateStore(run);
    let receivedSignal: AbortSignal | undefined;
    const sendQuery = mock(async function* (
      _prompt: string,
      _cwd: string,
      _resume: string | undefined,
      options: SendQueryOptions | undefined
    ) {
      receivedSignal = options?.abortSignal;
      await Bun.sleep(50);
      if (receivedSignal?.aborted) return;
      yield { type: 'assistant' as const, content: join(cwd, 'late.html') };
    });
    const getAgentProvider = mock(
      () =>
        ({ sendQuery, getType: () => 'claude', getCapabilities: () => ({}) }) as ReturnType<
          WorkflowDeps['getAgentProvider']
        >
    );
    const node: PlannotatorGateNode = {
      id: 'review',
      idle_timeout: 5,
      plannotator_gate: {
        prepare: { prompt: 'Create a review.' },
        rework: { prompt: 'Revise $REVIEW_DOCUMENT using $REVIEW_ANNOTATIONS' },
      },
    };

    await expect(
      executePlannotatorGateNode(
        integrationArgs(run, store, node, cwd, artifactsDir, getAgentProvider)
      )
    ).resolves.toMatchObject({ state: 'failed', error: expect.stringMatching(/timed out/i) });
    expect(receivedSignal?.aborted).toBe(true);
    expect(store.pauseWorkflowRun).not.toHaveBeenCalled();
  });

  test('uses a phase provider assistant model and standard options without session reuse', async () => {
    const document = join(cwd, 'prepared.html');
    const run = makeRun({});
    const store = new IntegrationGateStore(run);
    let receivedResumeSessionId: string | undefined;
    let receivedOptions: SendQueryOptions | undefined;
    const sendQuery = mock(async function* (
      _prompt: string,
      _cwd: string,
      resumeSessionId: string | undefined,
      options: SendQueryOptions | undefined
    ) {
      receivedResumeSessionId = resumeSessionId;
      receivedOptions = options;
      writeFileSync(document, '<html><body>prepared</body></html>');
      yield { type: 'assistant' as const, content: document };
    });
    const getAgentProvider = mock(
      () =>
        ({ sendQuery, getType: () => 'codex', getCapabilities: () => ({}) }) as ReturnType<
          WorkflowDeps['getAgentProvider']
        >
    );
    const node: PlannotatorGateNode = {
      id: 'review',
      plannotator_gate: {
        prepare: {
          prompt: 'Create a review.',
          provider: 'codex',
          effort: 'medium',
          allowed_tools: ['Read'],
          denied_tools: ['Write'],
        },
        rework: { prompt: 'Revise $REVIEW_DOCUMENT using $REVIEW_ANNOTATIONS' },
      },
    };
    const args = integrationArgs(run, store, node, cwd, artifactsDir, getAgentProvider);
    args.workflowModel = 'claude-workflow-model';
    args.config.assistants.codex = { model: 'codex-assistant-model' };
    args.config.envVars = { GATE_TOKEN: 'test-token' };

    const execution = observeWhileWaiting(executePlannotatorGateNode(args));
    await waitForInvocations(fake, 1);
    expect(getAgentProvider).toHaveBeenCalledWith('codex');
    expect(receivedResumeSessionId).toBeUndefined();
    expect(receivedOptions).toMatchObject({
      model: 'codex-assistant-model',
      nodeConfig: {
        nodeId: 'review:prepare',
        effort: 'medium',
        allowed_tools: ['Read'],
        denied_tools: ['Write'],
      },
      assistantConfig: { model: 'codex-assistant-model' },
      env: { GATE_TOKEN: 'test-token' },
    });
    expect(receivedOptions?.abortSignal).toBeInstanceOf(AbortSignal);

    const approval = store.run.metadata.approval as ApprovalContext;
    releaseDecision(fake, approval.gateId ?? '', 1, { decision: 'approved' });
    await expect(execution).resolves.toEqual({ state: 'completed', output: '' });
  });

  test('resolves phase alias and tier models to their configured providers', async () => {
    const document = join(cwd, 'prepared.html');
    const revisedDocument = join(cwd, 'revised.html');
    const run = makeRun({});
    const store = new IntegrationGateStore(run);
    const calls: Array<{ provider: string; model: string | undefined }> = [];
    const getAgentProvider = mock((provider: string) => ({
      sendQuery: mock(async function* (
        _prompt: string,
        _cwd: string,
        _resumeSessionId: string | undefined,
        options: SendQueryOptions | undefined
      ) {
        calls.push({ provider, model: options?.model });
        const output = calls.length === 1 ? document : revisedDocument;
        writeFileSync(output, '<html><body>review</body></html>');
        yield { type: 'assistant' as const, content: output };
      }),
      getType: () => provider,
      getCapabilities: () => ({}),
    })) as WorkflowDeps['getAgentProvider'];
    const node: PlannotatorGateNode = {
      id: 'review',
      plannotator_gate: {
        prepare: { prompt: 'Create a review.', model: '@prepare' },
        rework: { prompt: 'Revise $REVIEW_DOCUMENT using $REVIEW_ANNOTATIONS', model: 'large' },
      },
    };
    const args = integrationArgs(run, store, node, cwd, artifactsDir, getAgentProvider);
    args.aiProfile = {
      defaultProvider: 'claude',
      aliases: {
        '@prepare': { provider: 'codex', model: 'codex-alias-model' },
        large: { provider: 'claude', model: 'claude-tier-model' },
      },
    };

    const execution = observeWhileWaiting(executePlannotatorGateNode(args));
    const firstInvocations = await waitForInvocations(fake, 1);
    const approval = store.run.metadata.approval as ApprovalContext;
    releaseDecision(fake, approval.gateId ?? '', 1, {
      decision: 'annotated',
      feedback: 'Revise it',
    });
    const invocations = await waitForInvocations(fake, 2);
    releaseDecision(fake, approval.gateId ?? '', 2, { decision: 'approved' });
    await expect(execution).resolves.toEqual({ state: 'completed', output: '' });

    expect(firstInvocations[0]?.[1]).toBe(realpathSync(document));
    expect(invocations[1]?.[1]).toBe(realpathSync(revisedDocument));
    expect(calls).toEqual([
      { provider: 'codex', model: 'codex-alias-model' },
      { provider: 'claude', model: 'claude-tier-model' },
    ]);
  });

  test('passes the execution context through a fresh container prepare call', async () => {
    const document = join(cwd, 'prepared.html');
    const run = makeRun({});
    const store = new IntegrationGateStore(run);
    let receivedOptions: SendQueryOptions | undefined;
    const sendQuery = mock(async function* (
      _prompt: string,
      _cwd: string,
      _resumeSessionId: string | undefined,
      options: SendQueryOptions | undefined
    ) {
      receivedOptions = options;
      writeFileSync(document, '<html><body>prepared</body></html>');
      yield { type: 'assistant' as const, content: document };
    });
    const getAgentProvider = mock(
      () =>
        ({ sendQuery, getType: () => 'claude', getCapabilities: () => ({}) }) as ReturnType<
          WorkflowDeps['getAgentProvider']
        >
    );
    const node: PlannotatorGateNode = {
      id: 'review',
      plannotator_gate: {
        prepare: { prompt: 'Create a review.' },
        rework: { prompt: 'Revise $REVIEW_DOCUMENT using $REVIEW_ANNOTATIONS' },
      },
    };
    const args = integrationArgs(run, store, node, cwd, artifactsDir, getAgentProvider);
    args.execContext = { kind: 'container', containerId: 'gate-container' };

    const execution = observeWhileWaiting(executePlannotatorGateNode(args));
    await waitForInvocations(fake, 1);
    expect(receivedOptions?.execContext).toEqual({
      kind: 'container',
      containerId: 'gate-container',
    });
    const approval = store.run.metadata.approval as ApprovalContext;
    releaseDecision(fake, approval.gateId ?? '', 1, { decision: 'approved' });
    await expect(execution).resolves.toEqual({ state: 'completed', output: '' });
  });

  test('does not start prepare when the initial workflow status is cancelled', async () => {
    const run = makeRun({});
    const store = new IntegrationGateStore(run);
    store.getWorkflowRunStatus = mock(() => Promise.resolve('cancelled'));
    const sendQuery = mock(async function* () {
      throw new Error('cancelled prepare must not dispatch a provider call');
    });
    const getAgentProvider = mock(
      () =>
        ({ sendQuery, getType: () => 'claude', getCapabilities: () => ({}) }) as ReturnType<
          WorkflowDeps['getAgentProvider']
        >
    );
    const node: PlannotatorGateNode = {
      id: 'review',
      plannotator_gate: {
        prepare: { prompt: 'Create a review.' },
        rework: { prompt: 'Revise $REVIEW_DOCUMENT using $REVIEW_ANNOTATIONS' },
      },
    };

    await expect(
      executePlannotatorGateNode(
        integrationArgs(run, store, node, cwd, artifactsDir, getAgentProvider)
      )
    ).resolves.toMatchObject({ state: 'failed', error: expect.stringMatching(/cancelled/i) });
    expect(sendQuery).not.toHaveBeenCalled();
    expect(getAgentProvider).not.toHaveBeenCalled();
    expect(store.pauseWorkflowRun).not.toHaveBeenCalled();
  });

  test('waits for a delayed cancelled initial status before starting prepare', async () => {
    const document = join(cwd, 'prepared-race.html');
    const run = makeRun({});
    const store = new IntegrationGateStore(run);
    const statusRequested = deferred<void>();
    const initialStatus = deferred<string | null>();
    store.getWorkflowRunStatus = mock(() => {
      statusRequested.resolve();
      return initialStatus.promise;
    });
    let providerOutputConsumed = false;
    const sendQuery = mock(async function* () {
      providerOutputConsumed = true;
      writeFileSync(document, '<html><body>must not be accepted</body></html>');
      yield { type: 'assistant' as const, content: document };
    });
    const getAgentProvider = mock(
      () =>
        ({ sendQuery, getType: () => 'claude', getCapabilities: () => ({}) }) as ReturnType<
          WorkflowDeps['getAgentProvider']
        >
    );
    const node: PlannotatorGateNode = {
      id: 'review',
      plannotator_gate: {
        prepare: { prompt: 'Create a review.' },
        rework: { prompt: 'Revise $REVIEW_DOCUMENT using $REVIEW_ANNOTATIONS' },
      },
    };

    const execution = observeWhileWaiting(
      executePlannotatorGateNode(
        integrationArgs(run, store, node, cwd, artifactsDir, getAgentProvider)
      )
    );
    await statusRequested.promise;
    expect(sendQuery).not.toHaveBeenCalled();
    expect(providerOutputConsumed).toBe(false);
    expect(getAgentProvider).not.toHaveBeenCalled();

    initialStatus.resolve('cancelled');
    await expect(execution).resolves.toMatchObject({
      state: 'failed',
      error: expect.stringMatching(/cancelled/i),
    });
    expect(sendQuery).not.toHaveBeenCalled();
    expect(getAgentProvider).not.toHaveBeenCalled();
    expect(store.pauseWorkflowRun).not.toHaveBeenCalled();
    expect(existsSync(fake.invocationLog)).toBe(false);
  });

  test('does not start cancelled rework or open another annotate session', async () => {
    const document = join(cwd, 'plan.html');
    writeFileSync(document, '<html><body>plan</body></html>');
    const run = makeRun({
      type: 'plannotator_gate',
      nodeId: 'review',
      gateId: 'gate-cancel-rework',
      phase: 'opening',
      resolved: null,
    });
    const store = new IntegrationGateStore(run);
    const sendQuery = mock(async function* () {
      throw new Error('cancelled rework must not dispatch a provider call');
    });
    const getAgentProvider = mock(
      () =>
        ({ sendQuery, getType: () => 'claude', getCapabilities: () => ({}) }) as ReturnType<
          WorkflowDeps['getAgentProvider']
        >
    );
    const node: PlannotatorGateNode = {
      id: 'review',
      plannotator_gate: {
        document,
        rework: { prompt: 'Revise $REVIEW_DOCUMENT using $REVIEW_ANNOTATIONS' },
      },
    };
    const execution = observeWhileWaiting(
      executePlannotatorGateNode(
        integrationArgs(run, store, node, cwd, artifactsDir, getAgentProvider)
      )
    );
    await waitForInvocations(fake, 1);
    store.getWorkflowRunStatus = mock(() => Promise.resolve('cancelled'));
    releaseDecision(fake, 'gate-cancel-rework', 1, {
      decision: 'annotated',
      feedback: 'Revise it',
    });

    await expect(execution).resolves.toMatchObject({
      state: 'failed',
      error: expect.stringMatching(/cancelled/i),
    });
    expect(sendQuery).not.toHaveBeenCalled();
    expect(getAgentProvider).not.toHaveBeenCalled();
    expect(existsSync(fake.invocationLog)).toBe(true);
    expect(readFileSync(fake.invocationLog, 'utf8').trim().split('\n')).toHaveLength(1);
  });

  test('reworks an annotated document once, then approves the replacement', async () => {
    const document = join(cwd, 'plan.html');
    const revisedDocument = join(cwd, 'plan-v2.html');
    writeFileSync(document, '<html><body>plan</body></html>');
    const run = makeRun({
      type: 'plannotator_gate',
      nodeId: 'review',
      gateId: 'gate-rework',
      phase: 'opening',
      resolved: null,
    });
    const store = new IntegrationGateStore(run);
    const sendQuery = mock(async function* (prompt: string) {
      expect(prompt).toBe(`Revise ${realpathSync(document)} using Clarify the heading`);
      writeFileSync(revisedDocument, '<html><body>revised</body></html>');
      yield { type: 'assistant' as const, content: revisedDocument };
    });
    const getAgentProvider = mock(
      () =>
        ({
          sendQuery,
          getType: () => 'claude',
          getCapabilities: () => ({}),
        }) as ReturnType<WorkflowDeps['getAgentProvider']>
    );
    const node: PlannotatorGateNode = {
      id: 'review',
      plannotator_gate: {
        document,
        capture_response: true,
        rework: { prompt: 'Revise $REVIEW_DOCUMENT using $REVIEW_ANNOTATIONS' },
      },
    };

    const execution = observeWhileWaiting(
      executePlannotatorGateNode(
        integrationArgs(run, store, node, cwd, artifactsDir, getAgentProvider)
      )
    );
    await waitForInvocations(fake, 1);
    releaseDecision(fake, 'gate-rework', 1, {
      decision: 'annotated',
      feedback: 'Clarify the heading',
    });
    const invocations = await waitForInvocations(fake, 2);
    releaseDecision(fake, 'gate-rework', 2, {
      decision: 'approved',
      feedback: 'Ready',
    });

    await expect(execution).resolves.toEqual({ state: 'completed', output: 'Ready' });
    expect(sendQuery).toHaveBeenCalledTimes(1);
    expect(invocations.map(args => args[1])).toEqual([
      realpathSync(document),
      realpathSync(revisedDocument),
    ]);
    expect(store.events.filter(event => event.event_type === 'node_completed')).toHaveLength(1);
    expect(store.resumeApprovedGate).toHaveBeenCalledTimes(1);
  });
});

describe('resolvePlannotatorGateId', () => {
  test('reuses an unresolved opening token for the same node', () => {
    const run = makeRun({
      type: 'plannotator_gate',
      nodeId: 'gate',
      gateId: 'gate-b',
      phase: 'opening',
      resolved: null,
    });

    expect(resolvePlannotatorGateId(run, 'gate')).toBe('gate-b');
  });

  test('creates a fresh token for a different or non-opening gate', () => {
    const run = makeRun({
      type: 'plannotator_gate',
      nodeId: 'other',
      gateId: 'gate-a',
      phase: 'waiting_decision',
      resolved: null,
    });

    expect(resolvePlannotatorGateId(run, 'gate')).not.toBe('gate-a');
  });
});
