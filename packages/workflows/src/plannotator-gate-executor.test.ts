import { describe, expect, test, beforeEach, afterEach, mock } from 'bun:test';
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
import { join } from 'node:path';
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
import { clearRegistry, registerBuiltinProviders } from '@archon/providers';

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
  const bin = join(root, 'plannotator');
  const invocationLog = join(root, 'invocations.jsonl');
  mkdirSync(controlDir, { recursive: true });
  writeFileSync(
    bin,
    `#!/usr/bin/env bun
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
const controlDir = ${JSON.stringify(controlDir)};
const invocationLog = ${JSON.stringify(invocationLog)};
const key = basename(resultFile);
const started = join(controlDir, key + '.started');
const terminated = join(controlDir, key + '.terminated');
const control = join(controlDir, key + '.control.json');
appendFileSync(invocationLog, JSON.stringify({ args, document: args[1], resultFile }) + '\\n');
writeFileSync(started, 'started\\n');
process.on('SIGTERM', () => {
  writeFileSync(terminated, 'terminated\\n');
  process.exit(143);
});
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
`
  );
  chmodSync(bin, 0o755);
  return { bin, controlDir, invocationLog };
}

function gateAttemptKey(gateId: string, attempt: number): string {
  return `gate-${encodeURIComponent(gateId)}-attempt-${String(attempt)}.json`;
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

  test('rejects an unreadable HTML file', () => {
    const html = join(cwd, 'unreadable.html');
    writeFileSync(html, '<html></html>');
    chmodSync(html, 0o000);
    expect(() => resolveGateDocumentPath(html, new Map(), cwd, artifactsDir)).toThrow(/readable/i);
    chmodSync(html, 0o600);
  });

  test('rejects a non-HTML file', () => {
    const markdown = join(cwd, 'plan.md');
    writeFileSync(markdown, '# Plan');
    expect(() => resolveGateDocumentPath(markdown, new Map(), cwd, artifactsDir)).toThrow(/html/i);
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
    const link = join(cwd, 'linked.html');
    writeFileSync(target, '<html></html>');
    symlinkSync(target, link);
    expect(() => resolveGateDocumentPath(link, new Map(), cwd, artifactsDir)).toThrow(/outside/i);
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
    const binary = join(dir, 'plannotator');
    writeFileSync(binary, `#!/bin/sh\n${body}\n`);
    chmodSync(binary, 0o700);
    return binary;
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

  test('approves through Bun.spawn, records completion once, and resumes once', async () => {
    const document = join(cwd, 'plan.html');
    writeFileSync(document, '<html><body>plan</body></html>');
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

    const execution = executePlannotatorGateNode(
      integrationArgs(run, store, node, cwd, artifactsDir, getAgentProvider)
    );
    const invocations = await waitForInvocations(fake, 1);
    expect(store.pauseWorkflowRun).toHaveBeenCalledTimes(1);
    expect(store.run.status).toBe('paused');
    expect(store.run.metadata.approval).toMatchObject({
      type: 'plannotator_gate',
      nodeId: 'review',
      gateId: 'gate-approve',
      resolved: null,
    });
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
    expect(store.resumeApprovedGate).toHaveBeenCalledTimes(1);
    expect(store.run.status).toBe('running');
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

    const execution = executePlannotatorGateNode(
      integrationArgs(run, store, node, cwd, artifactsDir, getAgentProvider)
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
