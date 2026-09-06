process.env.NODE_ENV = 'development';

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';

import type {
  DagNode,
  WorkflowEventResponse,
  WorkflowNodeMessagesResponse,
  WorkflowNodeStateResponse,
} from '@/lib/api';
import type { WorkflowRunStatus } from '@/lib/types';
import type { Root } from 'react-dom/client';

const react = await import('react');
const reactQuery = await import('@tanstack/react-query');
const reactDomClient = await import('react-dom/client');
const legacyGraphLogsPane = await import('./LegacyGraphLogsPane');

const act = react.act;
const createElement = react.createElement;
const notifyManager = reactQuery.notifyManager;
const createRoot = reactDomClient.createRoot;

const CREATED_AT = '2026-09-06T00:00:00.000Z';

const REVIEW_STATE: WorkflowNodeStateResponse = {
  nodeId: 'review',
  name: 'Review',
  status: 'running',
  retryEpoch: 0,
};

const REVIEW_STARTED: WorkflowEventResponse = {
  id: 'start-review',
  workflow_run_id: 'run-1',
  event_type: 'node_started',
  step_index: null,
  step_name: 'review',
  data: {},
  created_at: CREATED_AT,
};

const GROUP_NODE: DagNode = {
  id: 'group',
  loop_group: {
    max_iterations: 2,
    fresh_context: false,
    nodes: [
      { id: 'body', prompt: 'Work' },
      { id: 'check', prompt: 'Check', depends_on: ['body'] },
    ],
  },
};

const ROUTER_NODE: DagNode = {
  id: 'router',
  route_loop: {
    condition: '$review.output',
    max_iterations: 3,
    routes: { positive: 'done', negative: 'fix', exhausted: 'stop' },
  },
};

const INSTALLED_GLOBAL_KEYS = [
  'window',
  'document',
  'self',
  'HTMLElement',
  'Element',
  'Node',
  'Text',
  'DocumentFragment',
  'SVGElement',
  'HTMLInputElement',
  'HTMLButtonElement',
  'HTMLSelectElement',
  'HTMLTextAreaElement',
  'HTMLFormElement',
  'HTMLIFrameElement',
  'navigator',
  'location',
  'localStorage',
  'sessionStorage',
  'getComputedStyle',
  'requestAnimationFrame',
  'cancelAnimationFrame',
  'MutationObserver',
  'Event',
  'CustomEvent',
  'KeyboardEvent',
  'MouseEvent',
  'FocusEvent',
  'InputEvent',
  'IS_REACT_ACT_ENVIRONMENT',
] as const;

const previousGlobals = new Map<string, PropertyDescriptor | undefined>();

function snapshotGlobals(): void {
  previousGlobals.clear();
  for (const key of INSTALLED_GLOBAL_KEYS) {
    previousGlobals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
  }
}

function restoreGlobals(): void {
  for (const key of INSTALLED_GLOBAL_KEYS) {
    const descriptor = previousGlobals.get(key);
    if (descriptor === undefined) {
      Reflect.deleteProperty(globalThis, key);
    } else {
      Object.defineProperty(globalThis, key, descriptor);
    }
  }
  previousGlobals.clear();
}

function installHappyDom(): Window {
  snapshotGlobals();
  const win = new Window({ url: 'https://localhost/' });
  const bag: Record<string, unknown> = {
    window: win,
    document: win.document,
    self: win,
    HTMLElement: win.HTMLElement,
    Element: win.Element,
    Node: win.Node,
    Text: win.Text,
    DocumentFragment: win.DocumentFragment,
    SVGElement: win.SVGElement,
    HTMLInputElement: win.HTMLInputElement,
    HTMLButtonElement: win.HTMLButtonElement,
    HTMLSelectElement: win.HTMLSelectElement,
    HTMLTextAreaElement: win.HTMLTextAreaElement,
    HTMLFormElement: win.HTMLFormElement,
    HTMLIFrameElement: win.HTMLIFrameElement,
    navigator: win.navigator,
    location: win.location,
    localStorage: win.localStorage,
    sessionStorage: win.sessionStorage,
    getComputedStyle: win.getComputedStyle.bind(win),
    requestAnimationFrame: (cb: FrameRequestCallback): number => {
      const handle = win.requestAnimationFrame(cb as unknown as (time: number) => void);
      return Number(handle);
    },
    cancelAnimationFrame: win.cancelAnimationFrame.bind(win),
    MutationObserver: win.MutationObserver,
    Event: win.Event,
    CustomEvent: win.CustomEvent,
    KeyboardEvent: win.KeyboardEvent,
    MouseEvent: win.MouseEvent,
    FocusEvent: win.FocusEvent,
    InputEvent: win.InputEvent,
    IS_REACT_ACT_ENVIRONMENT: true,
  };
  Object.assign(globalThis as object, bag);
  return win;
}

async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

async function flushUntil(host: Element, label: string, predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 25; attempt++) {
    await flush();
    if (predicate()) return;
  }
  throw new Error(`${label}: ${host.textContent ?? ''}`);
}

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
} {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(innerResolve => {
    resolve = innerResolve;
  });
  return { promise, resolve };
}

function workflowEvent(overrides: Partial<WorkflowEventResponse>): WorkflowEventResponse {
  return {
    id: 'event-1',
    workflow_run_id: 'run-1',
    event_type: 'node_started',
    step_index: null,
    step_name: null,
    data: {},
    created_at: CREATED_AT,
    ...overrides,
  };
}

function expectNoAskHumanChrome(host: Element): void {
  const text = host.textContent ?? '';
  expect(text).not.toContain('AskHuman');
  expect(text).not.toContain('awaiting');
  expect(text).not.toContain('waiting-on-you');
}

describe('LegacyGraphLogsPane', () => {
  let win: Window;
  let host: Element;
  let root: Root;
  let queryClient: InstanceType<typeof reactQuery.QueryClient>;

  beforeEach(() => {
    notifyManager.setScheduler((cb: () => void): void => {
      cb();
    });
    notifyManager.setNotifyFunction((cb: () => void): void => {
      act(cb);
    });
    win = installHappyDom();
    const el = win.document.createElement('div');
    win.document.body.appendChild(el);
    el.style.width = '1200px';
    el.style.height = '800px';
    host = el as unknown as Element;
    root = createRoot(host);
    queryClient = new reactQuery.QueryClient({
      defaultOptions: {
        queries: { retry: false },
      },
    });
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
    });
    queryClient.clear();
    win.close();
    restoreGlobals();
    notifyManager.setScheduler((cb: () => void): void => {
      setTimeout(cb, 0);
    });
    notifyManager.setNotifyFunction((cb: () => void): void => {
      cb();
    });
  });

  function defaultRenderGraph(input: {
    selectedNodeId: string | null;
    onNodeClick: (nodeId: string) => void;
  }): React.ReactElement {
    return createElement(
      'div',
      { 'data-testid': 'injected-graph' },
      createElement(
        'button',
        {
          type: 'button',
          'data-testid': 'graph-setup',
          onClick: (): void => {
            input.onNodeClick('setup');
          },
        },
        'graph:setup'
      ),
      createElement(
        'button',
        {
          type: 'button',
          'data-testid': 'graph-review',
          onClick: (): void => {
            input.onNodeClick('review');
          },
        },
        'graph:review'
      ),
      createElement(
        'button',
        {
          type: 'button',
          'data-testid': 'graph-group',
          onClick: (): void => {
            input.onNodeClick('group');
          },
        },
        'graph:group'
      )
    );
  }

  function PaneHarness(props: {
    activeView?: 'graph' | 'logs';
    runId: string;
    nodeStates: readonly WorkflowNodeStateResponse[];
    events: readonly WorkflowEventResponse[];
    definitionNodes: readonly DagNode[];
    definitionPending: boolean;
    runStatus: WorkflowRunStatus;
    approval: unknown;
    loadMessages: (runId: string, nodeId: string) => Promise<WorkflowNodeMessagesResponse>;
    onSelectNode: (nodeId: string | null) => void;
    onApprove?: () => Promise<void>;
    onReject?: (reason?: string) => Promise<void>;
  }): React.ReactElement {
    const [selectedNodeId, setSelectedNodeId] = react.useState<string | null>(null);
    return createElement(legacyGraphLogsPane.LegacyGraphLogsPane, {
      activeView: props.activeView ?? 'logs',
      renderGraph: defaultRenderGraph,
      selectedNodeId,
      runId: props.runId,
      nodeStates: props.nodeStates,
      events: props.events,
      isLive: false,
      loadMessages: props.loadMessages,
      onSelectNode: (nodeId: string | null): void => {
        setSelectedNodeId(nodeId);
        props.onSelectNode(nodeId);
      },
      definitionNodes: props.definitionNodes,
      definitionPending: props.definitionPending,
      runStatus: props.runStatus,
      approval: props.approval,
      onApprove: props.onApprove ?? (async (): Promise<void> => undefined),
      onReject: props.onReject ?? (async (): Promise<void> => undefined),
    });
  }

  function renderLogs(args: {
    activeView?: 'graph' | 'logs';
    runId: string;
    nodeStates: readonly WorkflowNodeStateResponse[];
    events: readonly WorkflowEventResponse[];
    definitionNodes: readonly DagNode[];
    definitionPending: boolean;
    runStatus: WorkflowRunStatus;
    approval: unknown;
    loadMessages: (runId: string, nodeId: string) => Promise<WorkflowNodeMessagesResponse>;
    onSelectNode: (nodeId: string | null) => void;
    onApprove?: () => Promise<void>;
    onReject?: (reason?: string) => Promise<void>;
  }): void {
    root.render(
      createElement(
        reactQuery.QueryClientProvider,
        { client: queryClient },
        createElement(PaneHarness, args)
      )
    );
  }

  async function clickRow(label: string): Promise<HTMLElement> {
    const button = Array.from(host.querySelectorAll('button')).find(candidate =>
      (candidate.textContent ?? '').includes(label)
    );
    if (button === undefined) throw new Error(`missing ${label} row`);
    await act(async () => {
      button.click();
    });
    return button;
  }

  async function clickGraph(testId: string): Promise<void> {
    const button = host.querySelector(`[data-testid="${testId}"]`);
    if (button === null) throw new Error(`missing ${testId}`);
    await act(async () => {
      (button as HTMLElement).click();
    });
  }

  test('wires pre-selection copy, click-to-loader, and run-change reset', async () => {
    const pending = deferred<WorkflowNodeMessagesResponse>();
    const calls: [string, string][] = [];
    const selected: (string | null)[] = [];
    const loadMessages = (runId: string, nodeId: string): Promise<WorkflowNodeMessagesResponse> => {
      calls.push([runId, nodeId]);
      return pending.promise;
    };
    const onSelectNode = (nodeId: string | null): void => {
      selected.push(nodeId);
    };

    await act(async () => {
      renderLogs({
        runId: 'run-1',
        nodeStates: [REVIEW_STATE],
        events: [REVIEW_STARTED],
        definitionNodes: [{ id: 'review', command: 'review' }],
        definitionPending: false,
        runStatus: 'running',
        approval: null,
        loadMessages,
        onSelectNode,
      });
    });
    await flush();

    expect(host.textContent).toContain('Review');
    expect(host.textContent).toContain('Select a node');
    expect(selected).toEqual([]);
    expect(calls).toEqual([]);
    expect(host.querySelectorAll('[role="region"]')).toHaveLength(0);
    expectNoAskHumanChrome(host);

    await clickRow('Review');
    await flush();
    expect(selected).toEqual(['review']);

    await act(async () => {
      pending.resolve({
        messages: [
          {
            id: 'm1',
            seq: 1,
            kind: 'text',
            payload: { text: 'hello from review' },
            created_at: CREATED_AT,
          },
        ],
      });
    });
    await flushUntil(host, 'selected transcript', () =>
      (host.textContent ?? '').includes('hello from review')
    );

    expect(calls).toEqual([['run-1', 'review']]);
    expect(host.querySelectorAll('[role="region"]')).toHaveLength(1);
    expect(host.querySelector('[aria-label="review room"]')).not.toBeNull();
    expectNoAskHumanChrome(host);

    await act(async () => {
      renderLogs({
        runId: 'run-2',
        nodeStates: [],
        events: [],
        definitionNodes: [],
        definitionPending: false,
        runStatus: 'completed',
        approval: null,
        loadMessages,
        onSelectNode,
      });
    });
    await flushUntil(host, 'run-change reset', () =>
      (host.textContent ?? '').includes('Select a node')
    );

    expect(selected).toEqual(['review', null]);
    expect(host.querySelectorAll('[role="region"]')).toHaveLength(0);
    expect(host.textContent).toContain('Select a node');
    expect(host.textContent).not.toContain('hello from review');
    expectNoAskHumanChrome(host);
  });

  test('selecting bash renders captured stdout without requesting node messages', async () => {
    const calls: [string, string][] = [];
    const loadMessages = async (
      requestRunId: string,
      nodeId: string
    ): Promise<WorkflowNodeMessagesResponse> => {
      calls.push([requestRunId, nodeId]);
      return { messages: [] };
    };
    const events: WorkflowEventResponse[] = [
      {
        id: 'start-setup',
        workflow_run_id: 'run-1',
        event_type: 'node_started',
        step_index: null,
        step_name: 'setup',
        data: { type: 'bash' },
        created_at: CREATED_AT,
      },
      {
        id: 'done-setup',
        workflow_run_id: 'run-1',
        event_type: 'node_completed',
        step_index: null,
        step_name: 'setup',
        data: { type: 'bash', node_output: 'ready' },
        created_at: CREATED_AT,
      },
    ];
    await act(async () => {
      renderLogs({
        runId: 'run-1',
        nodeStates: [{ nodeId: 'setup', name: 'Setup', status: 'completed', retryEpoch: 0 }],
        events,
        definitionNodes: [{ id: 'setup', bash: 'echo ready' }],
        definitionPending: false,
        runStatus: 'completed',
        approval: null,
        loadMessages,
        onSelectNode: (): void => undefined,
        onApprove: async (): Promise<void> => undefined,
        onReject: async (): Promise<void> => undefined,
      });
    });
    const setup = Array.from(host.querySelectorAll('button')).find(button =>
      (button.textContent ?? '').includes('Setup')
    );
    if (setup === undefined) throw new Error('missing Setup row');
    await act(async () => {
      setup.click();
    });
    await flushUntil(host, 'bash stdout', () => (host.textContent ?? '').includes('ready'));
    expect(calls).toEqual([]);
    expect(host.querySelectorAll('[role="region"]')).toHaveLength(1);
    expect(host.querySelector('[aria-label="setup room"]')).not.toBeNull();
    expectNoAskHumanChrome(host);
  });

  test('clicking an approval row renders the authored message and active controls', async () => {
    const calls: [string, string][] = [];
    const loadMessages = async (
      requestRunId: string,
      nodeId: string
    ): Promise<WorkflowNodeMessagesResponse> => {
      calls.push([requestRunId, nodeId]);
      return { messages: [] };
    };
    await act(async () => {
      renderLogs({
        runId: 'run-1',
        nodeStates: [{ nodeId: 'review', name: 'Review', status: 'running', retryEpoch: 0 }],
        events: [REVIEW_STARTED],
        definitionNodes: [{ id: 'review', approval: { message: 'Ship?' } }],
        definitionPending: false,
        runStatus: 'paused',
        approval: { nodeId: 'review', message: 'Ship?', type: 'approval' },
        loadMessages,
        onSelectNode: (): void => undefined,
      });
    });
    await clickRow('Review');
    await flushUntil(host, 'approval message', () => (host.textContent ?? '').includes('Ship?'));
    const buttons = Array.from(host.querySelectorAll('button')).map(
      button => button.textContent ?? ''
    );
    expect(buttons.some(text => text === 'Approve')).toBe(true);
    expect(buttons.some(text => text.includes('Reject'))).toBe(true);
    expect(calls).toEqual([]);
    expect(host.querySelector('[aria-label="review room"]')).not.toBeNull();
    expectNoAskHumanChrome(host);
  });

  test('active approval pauses remain selectable without lifecycle node state', async () => {
    const calls: [string, string][] = [];
    const loadMessages = async (
      requestRunId: string,
      nodeId: string
    ): Promise<WorkflowNodeMessagesResponse> => {
      calls.push([requestRunId, nodeId]);
      return { messages: [] };
    };
    await act(async () => {
      renderLogs({
        runId: 'run-1',
        nodeStates: [],
        events: [],
        definitionNodes: [{ id: 'review', approval: { message: 'Ship?' } }],
        definitionPending: false,
        runStatus: 'paused',
        approval: { nodeId: 'review', message: 'Ship?', type: 'approval' },
        loadMessages,
        onSelectNode: (): void => undefined,
      });
    });
    await clickRow('review');
    await flushUntil(host, 'approval row from metadata', () =>
      (host.textContent ?? '').includes('Ship?')
    );

    const buttons = Array.from(host.querySelectorAll('button')).map(
      button => button.textContent ?? ''
    );
    expect(buttons.some(text => text === 'Approve')).toBe(true);
    expect(buttons.some(text => text.includes('Reject'))).toBe(true);
    expect(calls).toEqual([]);
    expect(host.querySelector('[aria-label="review room"]')).not.toBeNull();
    expectNoAskHumanChrome(host);
  });

  test('active Plannotator pauses remain selectable without lifecycle node state', async () => {
    const calls: [string, string][] = [];
    const loadMessages = async (
      requestRunId: string,
      nodeId: string
    ): Promise<WorkflowNodeMessagesResponse> => {
      calls.push([requestRunId, nodeId]);
      return { messages: [] };
    };
    await act(async () => {
      renderLogs({
        runId: 'run-1',
        nodeStates: [],
        events: [],
        definitionNodes: [
          { id: 'review', plannotator_gate: { document: 'plan.md', rework: { prompt: 'Fix' } } },
        ],
        definitionPending: false,
        runStatus: 'paused',
        approval: {
          nodeId: 'review',
          message: 'Review the plan',
          type: 'plannotator_gate',
          document: 'plan.md',
          reviewUrl: 'https://plannotator.example/run-1',
        },
        loadMessages,
        onSelectNode: (): void => undefined,
      });
    });
    await clickRow('review');
    await flushUntil(host, 'plannotator row from metadata', () =>
      (host.textContent ?? '').includes('Open Plannotator')
    );

    expect(host.querySelector('a[href="https://plannotator.example/run-1"]')).not.toBeNull();
    expect(calls).toEqual([]);
    expect(host.querySelector('[aria-label="review room"]')).not.toBeNull();
    expectNoAskHumanChrome(host);
  });

  test('active child workflow pauses remain selectable without lifecycle node state', async () => {
    const calls: [string, string][] = [];
    const loadMessages = async (
      requestRunId: string,
      nodeId: string
    ): Promise<WorkflowNodeMessagesResponse> => {
      calls.push([requestRunId, nodeId]);
      return { messages: [] };
    };
    await act(async () => {
      renderLogs({
        runId: 'run-1',
        nodeStates: [],
        events: [],
        definitionNodes: [{ id: 'child', workflow: 'review-child' }],
        definitionPending: false,
        runStatus: 'paused',
        approval: {
          nodeId: 'child',
          message: 'Sub-run is paused awaiting review',
          type: 'child_workflow',
          childRunId: 'child-run-1',
        },
        loadMessages,
        onSelectNode: (): void => undefined,
      });
    });
    await clickRow('child');
    await flushUntil(host, 'child workflow row from metadata', () =>
      (host.textContent ?? '').includes('Open child run')
    );

    expect(host.querySelector('a[href="/legacy/workflows/runs/child-run-1"]')).not.toBeNull();
    expect(calls).toEqual([]);
    expect(host.querySelector('[aria-label="child room"]')).not.toBeNull();
    expect(host.textContent).not.toContain('AskHuman');
    expect(host.textContent).not.toContain('waiting-on-you');
  });

  test('clicking a workflow row renders Open child run and does not call loadMessages', async () => {
    const calls: [string, string][] = [];
    const loadMessages = async (
      requestRunId: string,
      nodeId: string
    ): Promise<WorkflowNodeMessagesResponse> => {
      calls.push([requestRunId, nodeId]);
      return { messages: [] };
    };
    await act(async () => {
      renderLogs({
        runId: 'run-1',
        nodeStates: [{ nodeId: 'child', name: 'Child', status: 'completed', retryEpoch: 0 }],
        events: [
          workflowEvent({
            id: 'child-start-new',
            step_name: 'child',
            event_type: 'node_started',
          }),
          workflowEvent({
            id: 'child-done-new',
            step_name: 'child',
            event_type: 'node_completed',
            data: { type: 'workflow', child_run_id: 'child-1' },
          }),
        ],
        definitionNodes: [{ id: 'child', workflow: 'child-wf' }],
        definitionPending: false,
        runStatus: 'completed',
        approval: null,
        loadMessages,
        onSelectNode: (): void => undefined,
      });
    });
    await clickRow('Child');
    await flushUntil(host, 'child run link', () =>
      (host.textContent ?? '').includes('Open child run')
    );
    expect(host.querySelector('a[href="/legacy/workflows/runs/child-1"]')).not.toBeNull();
    expect(calls).toEqual([]);
    expect(host.querySelector('[aria-label="child room"]')).not.toBeNull();
    expectNoAskHumanChrome(host);
  });

  test('clicking route execution number 2 renders decision number 2', async () => {
    const calls: [string, string][] = [];
    const loadMessages = async (
      requestRunId: string,
      nodeId: string
    ): Promise<WorkflowNodeMessagesResponse> => {
      calls.push([requestRunId, nodeId]);
      return { messages: [] };
    };
    await act(async () => {
      renderLogs({
        runId: 'run-1',
        nodeStates: [{ nodeId: 'router', name: 'Router', status: 'completed', retryEpoch: 0 }],
        events: [
          workflowEvent({
            id: 'route-1',
            step_name: 'router',
            event_type: 'node_routed',
            data: {
              outcome: 'negative',
              to: 'fix',
              condition: '$review.output',
              condition_result: false,
              execution_seq: 1,
            },
          }),
          workflowEvent({
            id: 'route-2',
            step_name: 'router',
            event_type: 'node_routed',
            data: {
              outcome: 'positive',
              to: 'done',
              condition: '$review.output',
              condition_result: true,
              execution_seq: 2,
            },
          }),
          workflowEvent({
            id: 'route-3',
            step_name: 'router',
            event_type: 'node_routed',
            data: {
              outcome: 'exhausted',
              to: 'stop',
              condition: '$review.output',
              condition_result: false,
              execution_seq: 3,
            },
          }),
        ],
        definitionNodes: [ROUTER_NODE],
        definitionPending: false,
        runStatus: 'completed',
        approval: null,
        loadMessages,
        onSelectNode: (): void => undefined,
      });
    });
    await clickRow('Router #2');
    await flushUntil(host, 'route decision 2', () => (host.textContent ?? '').includes('positive'));
    expect(host.textContent).toContain('done');
    expect(host.textContent).not.toContain('exhausted');
    expect(host.textContent).not.toContain('stop');
    expect(calls).toEqual([]);
    expect(host.querySelector('[aria-label="router room"]')).not.toBeNull();
    expectNoAskHumanChrome(host);
  });

  test('clicking a loop-group iteration row renders Body nodes and opens that iteration', async () => {
    const calls: [string, string][] = [];
    const loadMessages = async (
      requestRunId: string,
      nodeId: string
    ): Promise<WorkflowNodeMessagesResponse> => {
      calls.push([requestRunId, nodeId]);
      return { messages: [] };
    };
    await act(async () => {
      renderLogs({
        runId: 'run-1',
        nodeStates: [{ nodeId: 'group', name: 'Group', status: 'failed', retryEpoch: 0 }],
        events: [
          workflowEvent({
            id: 'iter-1-start',
            step_name: 'group',
            event_type: 'loop_iteration_started',
            data: { iteration: 1 },
          }),
          workflowEvent({
            id: 'iter-1-done',
            step_name: 'group',
            event_type: 'loop_iteration_completed',
            data: { iteration: 1 },
          }),
          workflowEvent({
            id: 'iter-2-start',
            step_name: 'group',
            event_type: 'loop_iteration_started',
            data: { iteration: 2 },
          }),
          workflowEvent({
            id: 'iter-2-fail',
            step_name: 'group',
            event_type: 'loop_iteration_failed',
            data: { iteration: 2 },
          }),
          workflowEvent({
            id: 'body-1-done',
            step_name: 'group.body',
            event_type: 'node_completed',
            data: { iteration: 1 },
          }),
          workflowEvent({
            id: 'check-1-done',
            step_name: 'group.check',
            event_type: 'node_completed',
            data: { iteration: 1 },
          }),
          workflowEvent({
            id: 'body-2-done',
            step_name: 'group.body',
            event_type: 'node_completed',
            data: { iteration: 2 },
          }),
          workflowEvent({
            id: 'check-2-fail',
            step_name: 'group.check',
            event_type: 'node_failed',
            data: { iteration: 2, error: 'check failed' },
          }),
        ],
        definitionNodes: [GROUP_NODE],
        definitionPending: false,
        runStatus: 'failed',
        approval: null,
        loadMessages,
        onSelectNode: (): void => undefined,
      });
    });
    await clickRow('Group ×2');
    await flushUntil(host, 'loop group body', () =>
      (host.textContent ?? '').includes('Body nodes')
    );
    expect(host.textContent).toContain('Start');
    expect(host.textContent).toContain('After body');
    expect(host.textContent).toContain('×1 completed');
    expect(host.textContent).toContain('×2 failed');
    expect(host.querySelectorAll('details[open]')).toHaveLength(1);
    expect(host.querySelector('details[open]')?.textContent).toContain('×2 failed');
    expect(calls).toEqual([]);
    expect(host.querySelector('[aria-label="group room"]')).not.toBeNull();
    expectNoAskHumanChrome(host);
  });

  test('active loop-group iterations remain selectable before group terminal state exists', async () => {
    const calls: [string, string][] = [];
    const loadMessages = async (
      requestRunId: string,
      nodeId: string
    ): Promise<WorkflowNodeMessagesResponse> => {
      calls.push([requestRunId, nodeId]);
      return { messages: [] };
    };
    await act(async () => {
      renderLogs({
        runId: 'run-1',
        nodeStates: [],
        events: [
          workflowEvent({
            id: 'iter-1-start',
            step_name: 'group',
            event_type: 'loop_iteration_started',
            data: { iteration: 1 },
          }),
          workflowEvent({
            id: 'body-1-done',
            step_name: 'group.body',
            event_type: 'node_completed',
            data: { iteration: 1 },
          }),
        ],
        definitionNodes: [GROUP_NODE],
        definitionPending: false,
        runStatus: 'running',
        approval: null,
        loadMessages,
        onSelectNode: (): void => undefined,
      });
    });
    await clickRow('group ×1');
    await flushUntil(host, 'loop group row from iteration events', () =>
      (host.textContent ?? '').includes('Body nodes')
    );

    expect(host.textContent).toContain('×1 running');
    expect(calls).toEqual([]);
    expect(host.querySelector('[aria-label="group room"]')).not.toBeNull();
    expectNoAskHumanChrome(host);
  });

  test('clicking bash then command keeps one navigation, one room, and loads command once', async () => {
    const calls: [string, string][] = [];
    const loadMessages = async (
      requestRunId: string,
      nodeId: string
    ): Promise<WorkflowNodeMessagesResponse> => {
      calls.push([requestRunId, nodeId]);
      return {
        messages: [
          {
            id: 'm1',
            seq: 1,
            kind: 'text',
            payload: { text: 'hello from review' },
            created_at: CREATED_AT,
          },
        ],
      };
    };
    await act(async () => {
      renderLogs({
        runId: 'run-1',
        nodeStates: [
          { nodeId: 'setup', name: 'Setup', status: 'completed', retryEpoch: 0 },
          REVIEW_STATE,
        ],
        events: [
          workflowEvent({
            id: 'start-setup',
            step_name: 'setup',
            event_type: 'node_started',
            data: { type: 'bash' },
          }),
          workflowEvent({
            id: 'done-setup',
            step_name: 'setup',
            event_type: 'node_completed',
            data: { type: 'bash', node_output: 'ready' },
          }),
          REVIEW_STARTED,
        ],
        definitionNodes: [
          { id: 'setup', bash: 'echo ready' },
          { id: 'review', command: 'review' },
        ],
        definitionPending: false,
        runStatus: 'running',
        approval: null,
        loadMessages,
        onSelectNode: (): void => undefined,
      });
    });
    await clickRow('Setup');
    await flushUntil(host, 'bash first', () => (host.textContent ?? '').includes('ready'));
    expect(calls).toEqual([]);
    expect(host.querySelectorAll('[aria-label="Node runs"]')).toHaveLength(1);
    expect(host.querySelectorAll('[role="region"]')).toHaveLength(1);

    await clickRow('Review');
    await flushUntil(host, 'command after bash', () =>
      (host.textContent ?? '').includes('hello from review')
    );
    expect(calls).toEqual([['run-1', 'review']]);
    expect(host.querySelectorAll('[aria-label="Node runs"]')).toHaveLength(1);
    expect(host.querySelectorAll('[role="region"]')).toHaveLength(1);
    expect(host.querySelector('[aria-label="review room"]')).not.toBeNull();
    expectNoAskHumanChrome(host);
  });

  const SHARED_BASH_COMMAND = {
    nodeStates: [
      { nodeId: 'setup', name: 'Setup', status: 'completed' as const, retryEpoch: 0 },
      REVIEW_STATE,
    ],
    events: [
      workflowEvent({
        id: 'start-setup',
        step_name: 'setup',
        event_type: 'node_started',
        data: { type: 'bash' },
      }),
      workflowEvent({
        id: 'done-setup',
        step_name: 'setup',
        event_type: 'node_completed',
        data: { type: 'bash', node_output: 'ready' },
      }),
      REVIEW_STARTED,
    ],
    definitionNodes: [
      { id: 'setup', bash: 'echo ready' },
      { id: 'review', command: 'review' },
    ] as const,
  };

  const LOOP_EVENTS: WorkflowEventResponse[] = [
    workflowEvent({
      id: 'iter-1-start',
      step_name: 'group',
      event_type: 'loop_iteration_started',
      data: { iteration: 1 },
    }),
    workflowEvent({
      id: 'iter-1-done',
      step_name: 'group',
      event_type: 'loop_iteration_completed',
      data: { iteration: 1 },
    }),
    workflowEvent({
      id: 'iter-2-start',
      step_name: 'group',
      event_type: 'loop_iteration_started',
      data: { iteration: 2 },
    }),
    workflowEvent({
      id: 'iter-2-fail',
      step_name: 'group',
      event_type: 'loop_iteration_failed',
      data: { iteration: 2 },
    }),
    workflowEvent({
      id: 'body-1-done',
      step_name: 'group.body',
      event_type: 'node_completed',
      data: { iteration: 1 },
    }),
    workflowEvent({
      id: 'check-1-done',
      step_name: 'group.check',
      event_type: 'node_completed',
      data: { iteration: 1 },
    }),
    workflowEvent({
      id: 'body-2-done',
      step_name: 'group.body',
      event_type: 'node_completed',
      data: { iteration: 2 },
    }),
    workflowEvent({
      id: 'check-2-fail',
      step_name: 'group.check',
      event_type: 'node_failed',
      data: { iteration: 2, error: 'check failed' },
    }),
  ];

  test('graph mode renders the injected graph navigation and no Node runs list', async () => {
    await act(async () => {
      renderLogs({
        activeView: 'graph',
        runId: 'run-1',
        nodeStates: SHARED_BASH_COMMAND.nodeStates,
        events: SHARED_BASH_COMMAND.events,
        definitionNodes: SHARED_BASH_COMMAND.definitionNodes,
        definitionPending: false,
        runStatus: 'completed',
        approval: null,
        loadMessages: async (): Promise<WorkflowNodeMessagesResponse> => ({ messages: [] }),
        onSelectNode: (): void => undefined,
      });
    });
    await flush();
    expect(host.querySelector('[data-testid="injected-graph"]')).not.toBeNull();
    expect(host.querySelector('[aria-label="Node runs"]')).toBeNull();
    expectNoAskHumanChrome(host);
  });

  test('clicking an injected graph-node button opens the same bash room without loading messages', async () => {
    const calls: [string, string][] = [];
    const loadMessages = async (
      requestRunId: string,
      nodeId: string
    ): Promise<WorkflowNodeMessagesResponse> => {
      calls.push([requestRunId, nodeId]);
      return { messages: [] };
    };
    await act(async () => {
      renderLogs({
        activeView: 'graph',
        runId: 'run-1',
        nodeStates: SHARED_BASH_COMMAND.nodeStates,
        events: SHARED_BASH_COMMAND.events,
        definitionNodes: SHARED_BASH_COMMAND.definitionNodes,
        definitionPending: false,
        runStatus: 'completed',
        approval: null,
        loadMessages,
        onSelectNode: (): void => undefined,
      });
    });
    await clickGraph('graph-setup');
    await flushUntil(host, 'graph bash stdout', () => (host.textContent ?? '').includes('ready'));
    expect(calls).toEqual([]);
    expect(host.querySelector('[aria-label="setup room"]')).not.toBeNull();
    expectNoAskHumanChrome(host);
  });

  test('clicking an injected command node loads only that node messages', async () => {
    const calls: [string, string][] = [];
    const loadMessages = async (
      requestRunId: string,
      nodeId: string
    ): Promise<WorkflowNodeMessagesResponse> => {
      calls.push([requestRunId, nodeId]);
      return {
        messages: [
          {
            id: 'm1',
            seq: 1,
            kind: 'text',
            payload: { text: 'hello from review' },
            created_at: CREATED_AT,
          },
        ],
      };
    };
    await act(async () => {
      renderLogs({
        activeView: 'graph',
        runId: 'run-1',
        nodeStates: SHARED_BASH_COMMAND.nodeStates,
        events: SHARED_BASH_COMMAND.events,
        definitionNodes: SHARED_BASH_COMMAND.definitionNodes,
        definitionPending: false,
        runStatus: 'running',
        approval: null,
        loadMessages,
        onSelectNode: (): void => undefined,
      });
    });
    await clickGraph('graph-review');
    await flushUntil(host, 'graph command transcript', () =>
      (host.textContent ?? '').includes('hello from review')
    );
    expect(calls).toEqual([['run-1', 'review']]);
    expect(host.querySelector('[aria-label="review room"]')).not.toBeNull();
    expectNoAskHumanChrome(host);
  });

  test('switching from Graph to Logs preserves the room DOM node and does not refetch', async () => {
    const calls: [string, string][] = [];
    const loadMessages = async (
      requestRunId: string,
      nodeId: string
    ): Promise<WorkflowNodeMessagesResponse> => {
      calls.push([requestRunId, nodeId]);
      return {
        messages: [
          {
            id: 'm1',
            seq: 1,
            kind: 'text',
            payload: { text: 'hello from review' },
            created_at: CREATED_AT,
          },
        ],
      };
    };
    const paneArgs = {
      runId: 'run-1',
      nodeStates: SHARED_BASH_COMMAND.nodeStates,
      events: SHARED_BASH_COMMAND.events,
      definitionNodes: SHARED_BASH_COMMAND.definitionNodes,
      definitionPending: false,
      runStatus: 'running' as const,
      approval: null,
      loadMessages,
      onSelectNode: (): void => undefined,
    };
    await act(async () => {
      renderLogs({ ...paneArgs, activeView: 'graph' });
    });
    await clickGraph('graph-review');
    await flushUntil(host, 'graph command before switch', () =>
      (host.textContent ?? '').includes('hello from review')
    );
    const room = host.querySelector('[aria-label="review room"]');
    expect(room).not.toBeNull();
    expect(calls).toEqual([['run-1', 'review']]);

    await act(async () => {
      renderLogs({ ...paneArgs, activeView: 'logs' });
    });
    await flush();
    expect(host.querySelector('[aria-label="review room"]')).toBe(room);
    expect(calls).toEqual([['run-1', 'review']]);
    const selectedRow = Array.from(host.querySelectorAll('button')).find(button =>
      (button.textContent ?? '').includes('Review')
    );
    expect(selectedRow?.getAttribute('aria-current')).toBe('true');
    expectNoAskHumanChrome(host);
  });

  test('clicking a loop iteration row preserves that iteration selection', async () => {
    await act(async () => {
      renderLogs({
        activeView: 'logs',
        runId: 'run-1',
        nodeStates: [{ nodeId: 'group', name: 'Group', status: 'failed', retryEpoch: 0 }],
        events: LOOP_EVENTS,
        definitionNodes: [GROUP_NODE],
        definitionPending: false,
        runStatus: 'failed',
        approval: null,
        loadMessages: async (): Promise<WorkflowNodeMessagesResponse> => ({ messages: [] }),
        onSelectNode: (): void => undefined,
      });
    });
    await clickRow('Group ×1');
    await flushUntil(host, 'preserve iteration 1', () =>
      (host.textContent ?? '').includes('Body nodes')
    );
    expect(host.querySelector('details[open]')?.textContent).toContain('×1 completed');
    const first = Array.from(host.querySelectorAll('button')).find(button =>
      (button.textContent ?? '').includes('Group ×1')
    );
    expect(first?.getAttribute('aria-current')).toBe('true');
  });

  test('clicking the same loop node in Graph resolves the canonical last iteration row', async () => {
    const paneArgs = {
      runId: 'run-1',
      nodeStates: [{ nodeId: 'group', name: 'Group', status: 'failed' as const, retryEpoch: 0 }],
      events: LOOP_EVENTS,
      definitionNodes: [GROUP_NODE],
      definitionPending: false,
      runStatus: 'failed' as const,
      approval: null,
      loadMessages: async (): Promise<WorkflowNodeMessagesResponse> => ({ messages: [] }),
      onSelectNode: (): void => undefined,
    };
    await act(async () => {
      renderLogs({ ...paneArgs, activeView: 'logs' });
    });
    await clickRow('Group ×1');
    await flushUntil(host, 'iteration 1 before graph', () =>
      (host.querySelector('details[open]')?.textContent ?? '').includes('×1 completed')
    );

    await act(async () => {
      renderLogs({ ...paneArgs, activeView: 'graph' });
    });
    await clickGraph('graph-group');
    await flushUntil(host, 'canonical last iteration', () =>
      (host.querySelector('details[open]')?.textContent ?? '').includes('×2 failed')
    );
    expect(host.querySelector('details[open]')?.textContent).not.toContain('×1 completed');

    await act(async () => {
      renderLogs({ ...paneArgs, activeView: 'logs' });
    });
    await flush();
    const last = Array.from(host.querySelectorAll('button')).find(button =>
      (button.textContent ?? '').includes('Group ×2')
    );
    expect(last?.getAttribute('aria-current')).toBe('true');
    expectNoAskHumanChrome(host);
  });

  test('a run-id change from Graph clears selection and reports null once', async () => {
    const selected: (string | null)[] = [];
    await act(async () => {
      renderLogs({
        activeView: 'graph',
        runId: 'run-1',
        nodeStates: SHARED_BASH_COMMAND.nodeStates,
        events: SHARED_BASH_COMMAND.events,
        definitionNodes: SHARED_BASH_COMMAND.definitionNodes,
        definitionPending: false,
        runStatus: 'completed',
        approval: null,
        loadMessages: async (): Promise<WorkflowNodeMessagesResponse> => ({ messages: [] }),
        onSelectNode: (nodeId: string | null): void => {
          selected.push(nodeId);
        },
      });
    });
    await clickGraph('graph-setup');
    await flushUntil(host, 'graph setup selected', () =>
      (host.textContent ?? '').includes('ready')
    );
    expect(selected).toEqual(['setup']);

    await act(async () => {
      renderLogs({
        activeView: 'graph',
        runId: 'run-2',
        nodeStates: [],
        events: [],
        definitionNodes: [],
        definitionPending: false,
        runStatus: 'completed',
        approval: null,
        loadMessages: async (): Promise<WorkflowNodeMessagesResponse> => ({ messages: [] }),
        onSelectNode: (nodeId: string | null): void => {
          selected.push(nodeId);
        },
      });
    });
    await flushUntil(host, 'graph run-change reset', () =>
      (host.textContent ?? '').includes('Select a node')
    );
    expect(selected).toEqual(['setup', null]);
    expect(host.querySelectorAll('[role="region"]')).toHaveLength(0);
    expectNoAskHumanChrome(host);
  });

  test('neither Graph nor Logs contains AskHuman awaiting or waiting-on-you copy', async () => {
    const paneArgs = {
      runId: 'run-1',
      nodeStates: SHARED_BASH_COMMAND.nodeStates,
      events: SHARED_BASH_COMMAND.events,
      definitionNodes: SHARED_BASH_COMMAND.definitionNodes,
      definitionPending: false,
      runStatus: 'completed' as const,
      approval: null,
      loadMessages: async (): Promise<WorkflowNodeMessagesResponse> => ({ messages: [] }),
      onSelectNode: (): void => undefined,
    };
    await act(async () => {
      renderLogs({ ...paneArgs, activeView: 'graph' });
    });
    await flush();
    expectNoAskHumanChrome(host);
    await act(async () => {
      renderLogs({ ...paneArgs, activeView: 'logs' });
    });
    await flush();
    expectNoAskHumanChrome(host);
  });
});
