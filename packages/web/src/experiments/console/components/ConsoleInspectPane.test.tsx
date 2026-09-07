process.env.NODE_ENV = 'development';

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import type { ReactElement, RefObject } from 'react';
import type { Root } from 'react-dom/client';

import { foldNodeRuns, toRunEvent } from '../primitives/event';
import type { Message } from '../primitives/message';
import type { Run } from '../primitives/run';
import type {
  PendingInteraction,
  WorkflowEvent,
  WorkflowNodeMessage,
  WorkflowNodeMessagesResponse,
  WorkflowNodeState,
} from '../skills/runs';
import type { DagNode } from '../skills/workflows';
import { invalidate } from '../store/cache';
import { installHappyDom, restoreHappyDom } from '../test/install-happy-dom';
import type { ConsoleInspectPaneProps } from './ConsoleInspectPane';
import { buildConsoleLogEntries } from './inspect/build-console-log-entries';
import { buildLogRows } from './inspect/build-log-rows';

const react = await import('react');
const reactDomClient = await import('react-dom/client');
const inspectPane = await import('./ConsoleInspectPane');

const act = react.act;
const createElement = react.createElement;
const useState = react.useState;
const createRoot = reactDomClient.createRoot;

const CREATED_AT = '2026-06-05T10:00:00.000Z';
const PROJECT_CWD = '/repo path';
const WORKFLOW_NAME = 'inspect-pane';

type ArtifactsForbidden = 'artifacts' extends ConsoleInspectPaneProps['view'] ? true : false;
const artifactsAreForbidden: ArtifactsForbidden = false;

function nodeState(
  overrides: Pick<WorkflowNodeState, 'nodeId' | 'name' | 'status'>
): WorkflowNodeState {
  return { retryEpoch: 0, ...overrides };
}

function workflowEvent(overrides: {
  id: string;
  event_type: string;
  step_name: string;
  created_at?: string;
  data?: Record<string, unknown>;
}): WorkflowEvent {
  return {
    id: overrides.id,
    workflow_run_id: 'run-1',
    event_type: overrides.event_type,
    step_index: null,
    step_name: overrides.step_name,
    data: overrides.data ?? {},
    created_at: overrides.created_at ?? CREATED_AT,
  };
}

function assistantMessage(id: string, content: string, timestamp: string): Message {
  return {
    id,
    role: 'assistant',
    content,
    timestamp,
    toolCalls: [],
    error: null,
    category: null,
    dispatch: null,
    workflowResult: null,
  };
}

function run(overrides: Partial<Run> = {}): Run {
  return {
    id: 'run-1',
    projectId: 'proj-1',
    projectName: 'demo',
    costUsd: null,
    conversationId: null,
    conversationPlatformId: null,
    workerPlatformId: null,
    workflow: WORKFLOW_NAME,
    origin: 'cli',
    status: 'running',
    startedAt: CREATED_AT,
    finishedAt: null,
    workingPath: null,
    userMessage: 'inspect',
    envOverlay: null,
    ...overrides,
  };
}

const DEFINITION_NODES: DagNode[] = [
  { id: 'plan', prompt: 'Plan the work.' },
  { id: 'loop', loop: { max_iterations: 2, fresh_context: false } },
];

const NODE_STATES: WorkflowNodeState[] = [
  nodeState({ nodeId: 'plan', name: 'Plan', status: 'completed' }),
  nodeState({ nodeId: 'loop', name: 'Loop', status: 'running' }),
];

const RAW_EVENTS: WorkflowEvent[] = [
  workflowEvent({
    id: 'plan-start',
    event_type: 'node_started',
    step_name: 'plan',
    created_at: '2026-06-05T10:00:01Z',
    data: { name: 'Plan' },
  }),
  workflowEvent({
    id: 'plan-done',
    event_type: 'node_completed',
    step_name: 'plan',
    created_at: '2026-06-05T10:00:02Z',
    data: { name: 'Plan', duration_ms: 1000, num_turns: 2, stop_reason: 'end_turn' },
  }),
  workflowEvent({
    id: 'loop-start',
    event_type: 'node_started',
    step_name: 'loop',
    created_at: '2026-06-05T10:00:03Z',
    data: { name: 'Loop' },
  }),
  workflowEvent({
    id: 'loop-i1-start',
    event_type: 'loop_iteration_started',
    step_name: 'loop',
    created_at: '2026-06-05T10:00:03Z',
    data: { iteration: 1 },
  }),
  workflowEvent({
    id: 'loop-i1-done',
    event_type: 'loop_iteration_completed',
    step_name: 'loop',
    created_at: '2026-06-05T10:00:03.500Z',
    data: { iteration: 1, duration: 2000 },
  }),
  workflowEvent({
    id: 'loop-i2-start',
    event_type: 'loop_iteration_started',
    step_name: 'loop',
    created_at: '2026-06-05T10:00:09Z',
    data: { iteration: 2 },
  }),
];

const LOG_ENTRIES = buildConsoleLogEntries({
  rows: buildLogRows(NODE_STATES, RAW_EVENTS),
  rawEvents: RAW_EVENTS,
  nodeRuns: foldNodeRuns(RAW_EVENTS.map(toRunEvent)),
  runStartedAt: CREATED_AT,
});

const PLAN_TEXT = 'plan-transcript';
const PLAN_MESSAGES: WorkflowNodeMessage[] = [
  {
    id: 'm1',
    seq: 1,
    kind: 'text',
    payload: { text: PLAN_TEXT },
    created_at: CREATED_AT,
  },
];

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function requireHtmlElement(value: Element | null, label: string): HTMLElement {
  if (!(value instanceof HTMLElement)) {
    throw new Error(label);
  }
  return value;
}

function requireButton(value: Element | null, label: string): HTMLButtonElement {
  if (!(value instanceof HTMLButtonElement)) {
    throw new Error(label);
  }
  return value;
}

function PaneHarness({
  initialView,
  paneProps,
}: {
  initialView: ConsoleInspectPaneProps['view'];
  paneProps: Omit<ConsoleInspectPaneProps, 'view'>;
}): ReactElement {
  const [view, setView] = useState<ConsoleInspectPaneProps['view']>(initialView);
  return createElement(
    'div',
    null,
    createElement(
      'button',
      {
        type: 'button',
        'aria-label': 'Toggle inspect view',
        onClick: (): void => {
          setView((current: ConsoleInspectPaneProps['view']) =>
            current === 'log' ? 'graph' : 'log'
          );
        },
      },
      'toggle-view'
    ),
    createElement(inspectPane.ConsoleInspectPane, { ...paneProps, view })
  );
}

describe('ConsoleInspectPane', () => {
  let win: ReturnType<typeof installHappyDom>;
  let host: Element;
  let root: Root;
  const logScrollRef: RefObject<HTMLDivElement | null> = { current: null };

  beforeEach(() => {
    win = installHappyDom();
    const el = win.document.createElement('div');
    win.document.body.appendChild(el);
    host = el as unknown as Element;
    root = createRoot(host);
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
    });
    invalidate('workflow-dag-nodes');
    invalidate('run-node-messages');
    invalidate('console-node-room:idle');
    win.close();
    restoreHappyDom();
  });

  async function flush(): Promise<void> {
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
  }

  async function flushUntil(label: string, predicate: () => boolean): Promise<void> {
    for (let attempt = 0; attempt < 25; attempt += 1) {
      await flush();
      if (predicate()) return;
    }
    throw new Error(`${label}: ${host.textContent ?? ''}`);
  }

  function defaultLoadDefinition(workflowName: string, cwd: string): Promise<DagNode[]> {
    expect(workflowName).toBe(WORKFLOW_NAME);
    expect(cwd).toBe(PROJECT_CWD);
    return Promise.resolve(DEFINITION_NODES);
  }

  function defaultLoadMessages(
    runId: string,
    nodeId: string
  ): Promise<WorkflowNodeMessagesResponse> {
    void runId;
    void nodeId;
    return Promise.resolve({ messages: [...PLAN_MESSAGES] });
  }

  function baseProps(
    overrides: Partial<ConsoleInspectPaneProps> = {}
  ): Omit<ConsoleInspectPaneProps, 'view'> & { view?: ConsoleInspectPaneProps['view'] } {
    return {
      view: 'log',
      run: run(),
      projectId: 'proj/1',
      projectCwd: PROJECT_CWD,
      messages: [assistantMessage('plan-prose', 'plan output', '2026-06-05T10:00:01.500Z')],
      events: RAW_EVENTS.map(toRunEvent),
      rawEvents: RAW_EVENTS,
      nodeStates: NODE_STATES,
      approval: null,
      logEntries: LOG_ENTRIES,
      usage: null,
      streamNodeFilter: 'all',
      selectedNodeId: 'plan',
      selectedLogRowId: 'plan-start',
      showToolCalls: false,
      showSystem: false,
      logHeader: 'Log header',
      logFooter: 'Log footer',
      logScrollRef,
      onSelectNode: (): void => undefined,
      onCloseRoom: (): void => undefined,
      loadDefinition: defaultLoadDefinition,
      loadMessages: defaultLoadMessages,
      pendingInteractions: [],
      viewerIsStarter: true,
      starterDisplayName: 'Avery',
      actionStates: {},
      onSubmitAsk: async (): Promise<void> => undefined,
      ...overrides,
    };
  }

  function renderPane(overrides: Partial<ConsoleInspectPaneProps> = {}): void {
    const props = baseProps(overrides);
    const view = props.view ?? 'log';
    root.render(createElement(inspectPane.ConsoleInspectPane, { ...props, view }));
  }

  test('switching log to graph keeps the same mounted room and does not reset the transcript loader', async () => {
    const calls: [string, string][] = [];
    const loadMessages = (runId: string, nodeId: string): Promise<WorkflowNodeMessagesResponse> => {
      calls.push([runId, nodeId]);
      return Promise.resolve({ messages: [...PLAN_MESSAGES] });
    };
    const pendingAsk: PendingInteraction = {
      id: 'ask-plan',
      workflow_run_id: 'run-1',
      node_id: 'plan',
      tool_use_id: 'tool-not-persisted',
      kind: 'ask',
      status: 'pending',
      envelope: {
        questions: [
          {
            id: 'q1',
            prompt: 'Ship it?',
            selection: 'single',
            options: ['Ship', 'Hold'],
            allowOther: false,
          },
        ],
      },
      answer: null,
      provider_session_id: 'session-1',
      created_at: CREATED_AT,
      resolved_at: null,
      resolved_by: null,
    };
    const props = baseProps({ loadMessages, pendingInteractions: [pendingAsk] });

    await act(async () => {
      root.render(
        createElement(PaneHarness, {
          initialView: 'log',
          paneProps: props,
        })
      );
    });
    await flushUntil('plan transcript', () => (host.textContent ?? '').includes(PLAN_TEXT));

    const roomBefore = host.querySelector('[aria-label="plan room"]');
    const formBefore = host.querySelector('form');
    expect(roomBefore).not.toBeNull();
    expect(formBefore).not.toBeNull();
    expect(calls).toEqual([['run-1', 'plan']]);
    expect(host.textContent).toContain('Log header');
    expect(host.textContent).toContain('plan output');
    expect(host.querySelector('[data-testid="console-run-graph-scroller"]')).toBeNull();

    await act(async () => {
      requireButton(
        host.querySelector('[aria-label="Toggle inspect view"]'),
        'toggle-view'
      ).click();
    });
    await flushUntil(
      'graph after toggle',
      () => host.querySelector('[data-testid="console-run-graph-scroller"]') !== null
    );
    const roomAfter = host.querySelector('[aria-label="plan room"]');
    expect(roomAfter).toBe(roomBefore);
    expect(host.querySelector('form')).toBe(formBefore);
    expect(calls).toEqual([['run-1', 'plan']]);
    expect(host.textContent).toContain(PLAN_TEXT);
    expect(host.textContent).not.toContain('Log header');
  });

  test('clicking a log divider or graph node invokes onSelectNode', async () => {
    const selected: { nodeId: string; rowId?: string }[] = [];
    await act(async () => {
      renderPane({
        view: 'log',
        onSelectNode: (nodeId: string, rowId?: string): void => {
          selected.push(rowId === undefined ? { nodeId } : { nodeId, rowId });
        },
      });
    });
    await flushUntil(
      'plan divider',
      () => host.querySelector('#node-transition-plan-start') !== null
    );

    const planRow = requireHtmlElement(
      host.querySelector('#node-transition-plan-start'),
      'plan row'
    );
    await act(async () => {
      requireButton(planRow.querySelector('button'), 'plan identity').click();
    });
    expect(selected).toEqual([{ nodeId: 'plan', rowId: 'plan-start' }]);

    await act(async () => {
      renderPane({
        view: 'graph',
        onSelectNode: (nodeId: string, rowId?: string): void => {
          selected.push(rowId === undefined ? { nodeId } : { nodeId, rowId });
        },
      });
    });
    await flushUntil('loop card', () => host.querySelector('[data-node-id="loop"]') !== null);

    await act(async () => {
      requireButton(host.querySelector('[data-node-id="loop"]'), 'loop card').click();
    });
    expect(selected).toEqual([{ nodeId: 'plan', rowId: 'plan-start' }, { nodeId: 'loop' }]);
  });

  test('log filter is independent of inspect selection and artifacts is not a pane view', async () => {
    expect(artifactsAreForbidden).toBe(false);

    await act(async () => {
      renderPane({
        view: 'log',
        streamNodeFilter: 'plan',
        selectedNodeId: 'loop',
        selectedLogRowId: null,
      });
    });
    await flushUntil('filtered log', () => (host.textContent ?? '').includes('Plan'));

    expect(host.querySelector('#node-transition-plan-start')).not.toBeNull();
    expect(host.querySelector('#node-transition-loop-i1-start')).toBeNull();
    expect(host.querySelector('#node-transition-loop-i2-start')).toBeNull();
    expect(host.querySelector('[aria-label="loop room"]')).not.toBeNull();
    expect(host.textContent).toContain('×2');
    expect(host.textContent).not.toContain('Artifacts');
  });

  test('selected row prefers the exact log row then the most recent row for the node', async () => {
    await act(async () => {
      renderPane({
        view: 'log',
        selectedNodeId: 'loop',
        selectedLogRowId: null,
      });
    });
    await flushUntil('latest loop row', () => (host.textContent ?? '').includes('×2'));
    expect(host.textContent).toContain('Loop ×2');

    await act(async () => {
      renderPane({
        view: 'log',
        selectedNodeId: 'loop',
        selectedLogRowId: 'loop-i1-start',
      });
    });
    await flushUntil('first loop row', () => (host.textContent ?? '').includes('×1'));
    expect(host.textContent).toContain('Loop ×1');
  });

  test('passes raw approval metadata to the room', async () => {
    const calls: [string, string][] = [];
    await act(async () => {
      renderPane({
        view: 'log',
        run: run({
          status: 'paused',
          approval: {
            nodeId: 'child',
            message: 'normalized approval message',
            completionSignaled: false,
          },
        }),
        selectedNodeId: 'child',
        selectedLogRowId: null,
        nodeStates: [
          ...NODE_STATES,
          nodeState({ nodeId: 'child', name: 'Child workflow', status: 'running' }),
        ],
        approval: {
          nodeId: 'child',
          message: 'Child workflow is paused',
          type: 'child_workflow',
          childRunId: 'child/run',
        },
        loadMessages: (runId: string, nodeId: string): Promise<WorkflowNodeMessagesResponse> => {
          calls.push([runId, nodeId]);
          return Promise.resolve({ messages: [] });
        },
      });
    });
    await flushUntil('child workflow room', () =>
      (host.textContent ?? '').includes('Child workflow is paused')
    );

    expect(host.textContent).toContain('Child run');
    expect(host.textContent).toContain('Open child run');
    expect(host.textContent).not.toContain('Approval required');
    expect(calls).toEqual([]);
  });

  test('definition loading and errors reach the graph while the room uses event fallback', async () => {
    const pending = deferred<DagNode[]>();
    const loadCalls: [string, string][] = [];
    const loadMessages = (runId: string, nodeId: string): Promise<WorkflowNodeMessagesResponse> => {
      loadCalls.push([runId, nodeId]);
      return Promise.resolve({ messages: [...PLAN_MESSAGES] });
    };

    await act(async () => {
      renderPane({
        view: 'graph',
        selectedNodeId: 'plan',
        loadDefinition: (): Promise<DagNode[]> => pending.promise,
        loadMessages,
      });
    });
    await flushUntil('definition pending', () =>
      (host.textContent ?? '').includes('Loading graph')
    );
    expect(host.textContent).toContain('Loading workflow definition');
    expect(loadCalls).toEqual([]);

    await act(async () => {
      pending.resolve(DEFINITION_NODES);
    });
    await flushUntil('definition ready', () => (host.textContent ?? '').includes(PLAN_TEXT));
    expect(host.querySelector('[data-node-id="plan"]')).not.toBeNull();
    expect(loadCalls).toEqual([['run-1', 'plan']]);

    const failed = deferred<DagNode[]>();
    await act(async () => {
      renderPane({
        view: 'graph',
        selectedNodeId: 'plan',
        projectCwd: '/other path',
        loadDefinition: (): Promise<DagNode[]> => failed.promise,
        loadMessages,
      });
    });
    await act(async () => {
      failed.reject(new Error('Workflow not found: missing'));
    });
    await flushUntil('definition error', () =>
      (host.textContent ?? '').includes('Could not load graph: Workflow not found: missing')
    );
    expect(host.querySelector('[data-testid="console-run-graph-canvas"]')).toBeNull();
    expect(host.textContent).toContain(PLAN_TEXT);
    expect(host.querySelector('[aria-label="plan room"]')).not.toBeNull();
  });

  test('split layout uses a persistent 380px room column', async () => {
    await act(async () => {
      renderPane({ view: 'log' });
    });
    await flushUntil(
      'layout',
      () => host.querySelector('[data-testid="console-inspect-pane"]') !== null
    );

    const split = requireHtmlElement(
      host.querySelector('[data-testid="console-inspect-pane"]'),
      'split'
    );
    expect(split.className).toContain('flex-col');
    expect(split.className).toContain('lg:flex-row');

    const room = requireHtmlElement(
      host.querySelector('[data-testid="console-inspect-room"]'),
      'room column'
    );
    expect(room.className).toContain('border-t');
    expect(room.className).toContain('lg:w-[460px]');
    expect(room.className).toContain('lg:border-l');
  });
});
