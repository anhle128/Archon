process.env.NODE_ENV = 'development';

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { renderToStaticMarkup } from 'react-dom/server';
import type { Root } from 'react-dom/client';

import type { DagNode, WorkflowEventResponse, WorkflowNodeMessagesResponse } from '@/lib/api';
import type { WorkflowRunStatus } from '@/lib/types';

import type { LogRow } from './build-log-rows';
import { LegacyNodeRoom } from './LegacyNodeRoom';

const react = await import('react');
const reactQuery = await import('@tanstack/react-query');
const reactDomClient = await import('react-dom/client');

const act = react.act;
const createElement = react.createElement;
const notifyManager = reactQuery.notifyManager;
const createRoot = reactDomClient.createRoot;

const CREATED_AT = '2026-09-06T00:00:00.000Z';

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

function row(overrides: Partial<LogRow> & Pick<LogRow, 'id' | 'nodeId' | 'label'>): LogRow {
  return {
    status: 'completed',
    order: 0,
    sourceIndex: 0,
    selection: { kind: 'node' },
    ...overrides,
  };
}

const SETUP_ROW: LogRow = row({
  id: 'start-setup',
  nodeId: 'setup',
  label: 'Setup',
});

const COMMAND_ROW: LogRow = row({
  id: 'start-command',
  nodeId: 'command',
  label: 'Command node',
  status: 'running',
});

const SHELL_ROW: LogRow = row({
  id: 'start-shell',
  nodeId: 'shell',
  label: 'Shell',
});

const GATE_ROW: LogRow = row({
  id: 'start-review',
  nodeId: 'review',
  label: 'Review',
  status: 'running',
});

const PLANNOTATOR_ROW: LogRow = row({
  id: 'start-gate',
  nodeId: 'gate',
  label: 'Gate',
  status: 'running',
});

const CHILD_ROW: LogRow = row({
  id: 'child-start-new',
  nodeId: 'child',
  label: 'Child',
});

const ROUTE_ROW: LogRow = row({
  id: 'route-2',
  nodeId: 'router',
  label: 'Router #2',
  selection: { kind: 'route_iteration', executionSeq: 2 },
});

const GROUP_ROW: LogRow = row({
  id: 'group-start',
  nodeId: 'group',
  label: 'Group ×2',
  status: 'failed',
  selection: { kind: 'loop_iteration', iteration: 2 },
});

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

function visibleText(markup: string): string {
  return markup
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#x27;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function createLoadMessages(): {
  requests: [string, string][];
  loadMessages: (runId: string, nodeId: string) => Promise<WorkflowNodeMessagesResponse>;
} {
  const requests: [string, string][] = [];
  const loadMessages = async (
    runId: string,
    nodeId: string
  ): Promise<WorkflowNodeMessagesResponse> => {
    requests.push([runId, nodeId]);
    return {
      messages: [
        {
          id: 'm1',
          seq: 1,
          kind: 'text',
          payload: { text: 'agent-text' },
          created_at: CREATED_AT,
        },
      ],
    };
  };
  return { requests, loadMessages };
}

function renderStatic(args: {
  row: LogRow | null;
  loadMessages: (runId: string, nodeId: string) => Promise<WorkflowNodeMessagesResponse>;
  definitionNodes?: readonly DagNode[];
  definitionPending?: boolean;
  events?: readonly WorkflowEventResponse[];
  runStatus?: WorkflowRunStatus;
  approval?: unknown;
}): string {
  return renderToStaticMarkup(
    <LegacyNodeRoom
      runId="run-1"
      row={args.row}
      isLive={false}
      loadMessages={args.loadMessages}
      definitionNodes={args.definitionNodes ?? []}
      definitionPending={args.definitionPending ?? false}
      events={args.events ?? []}
      runStatus={args.runStatus ?? 'completed'}
      approval={args.approval ?? null}
      onApprove={async (): Promise<void> => undefined}
      onReject={async (): Promise<void> => undefined}
    />
  );
}

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

describe('LegacyNodeRoom static rooms', () => {
  test('renders bash stdout without invoking the transcript boundary', () => {
    let requests = 0;
    const loadMessages = async (): Promise<WorkflowNodeMessagesResponse> => {
      requests++;
      return { messages: [] };
    };
    const events = [
      workflowEvent({ id: 'start-setup', step_name: 'setup', event_type: 'node_started' }),
      workflowEvent({
        id: 'done-setup',
        step_name: 'setup',
        event_type: 'node_completed',
        data: { type: 'bash', node_output: 'ready' },
      }),
    ];
    const markup = renderToStaticMarkup(
      <LegacyNodeRoom
        runId="run-1"
        row={SETUP_ROW}
        isLive={false}
        loadMessages={loadMessages}
        definitionNodes={[{ id: 'setup', bash: 'echo ready' }]}
        definitionPending={false}
        events={events}
        runStatus="completed"
        approval={null}
        onApprove={async (): Promise<void> => undefined}
        onReject={async (): Promise<void> => undefined}
      />
    );
    expect(markup).toContain('ready');
    expect(markup).toContain('Bash');
    expect(markup).toContain('completed');
    expect(markup.match(/role="region"/g)?.length).toBe(1);
    expect(markup).toContain('aria-label="setup room"');
    expect(requests).toBe(0);
  });

  test('renders Select a node with no header, region, or message request', () => {
    const { requests, loadMessages } = createLoadMessages();
    const markup = renderStatic({ row: null, loadMessages });
    expect(visibleText(markup)).toBe('Select a node');
    expect(markup).not.toContain('role="region"');
    expect(markup).not.toContain('<h2');
    expect(requests).toHaveLength(0);
  });

  test('renders script stdout from an event fallback without a definition', () => {
    const { requests, loadMessages } = createLoadMessages();
    const markup = renderStatic({
      row: SHELL_ROW,
      loadMessages,
      events: [
        workflowEvent({
          id: 'start-shell',
          step_name: 'shell',
          event_type: 'node_started',
          data: { type: 'script' },
        }),
        workflowEvent({
          id: 'done-shell',
          step_name: 'shell',
          event_type: 'node_completed',
          data: { type: 'script', node_output: 'script-out' },
        }),
      ],
    });
    expect(markup).toContain('script-out');
    expect(markup).toContain('Script');
    expect(markup.match(/role="region"/g)?.length).toBe(1);
    expect(markup).toContain('aria-label="shell room"');
    expect(requests).toHaveLength(0);
  });

  test('renders an approval message without a transcript request', () => {
    const { requests, loadMessages } = createLoadMessages();
    const markup = renderStatic({
      row: GATE_ROW,
      loadMessages,
      definitionNodes: [{ id: 'review', approval: { message: 'Ship?' } }],
      runStatus: 'running',
    });
    expect(markup).toContain('Ship?');
    expect(markup).toContain('Approval');
    expect(markup.match(/role="region"/g)?.length).toBe(1);
    expect(markup).toContain('aria-label="review room"');
    expect(requests).toHaveLength(0);
  });

  test('renders Open Plannotator from metadata fallback without a definition', () => {
    const { requests, loadMessages } = createLoadMessages();
    const markup = renderStatic({
      row: PLANNOTATOR_ROW,
      loadMessages,
      runStatus: 'paused',
      approval: {
        nodeId: 'gate',
        message: 'Review the plan',
        type: 'plannotator_gate',
        reviewUrl: 'https://plannotator.example/r/1',
      },
    });
    expect(markup).toContain('Open Plannotator');
    expect(markup).toContain('Plannotator gate');
    expect(markup).toContain('https://plannotator.example/r/1');
    expect(markup.match(/role="region"/g)?.length).toBe(1);
    expect(markup).toContain('aria-label="gate room"');
    expect(requests).toHaveLength(0);
  });

  test('renders the selected-attempt child link without a transcript request', () => {
    const { requests, loadMessages } = createLoadMessages();
    const markup = renderStatic({
      row: CHILD_ROW,
      loadMessages,
      definitionNodes: [{ id: 'child', workflow: 'child-wf' }],
      events: [
        workflowEvent({
          id: 'child-start-old',
          step_name: 'child',
          event_type: 'node_started',
        }),
        workflowEvent({
          id: 'child-done-old',
          step_name: 'child',
          event_type: 'node_completed',
          data: { type: 'workflow', child_run_id: 'child-old' },
        }),
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
    });
    expect(markup).toContain('Open child run');
    expect(markup).toContain('href="/legacy/workflows/runs/child-1"');
    expect(markup).not.toContain('child-old');
    expect(markup).toContain('Workflow');
    expect(markup.match(/role="region"/g)?.length).toBe(1);
    expect(markup).toContain('aria-label="child room"');
    expect(requests).toHaveLength(0);
  });

  test('renders the matching route execution rather than a later different sequence', () => {
    const { requests, loadMessages } = createLoadMessages();
    const markup = renderStatic({
      row: ROUTE_ROW,
      loadMessages,
      definitionNodes: [ROUTER_NODE],
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
    });
    const text = visibleText(markup);
    expect(text).toContain('Route loop');
    expect(text).toContain('positive');
    expect(text).toContain('done');
    expect(text).not.toContain('exhausted');
    expect(text).not.toContain('stop');
    expect(markup.match(/role="region"/g)?.length).toBe(1);
    expect(markup).toContain('aria-label="router room"');
    expect(requests).toHaveLength(0);
  });

  test('renders authored loop-group topology and the selected iteration', () => {
    const { requests, loadMessages } = createLoadMessages();
    const markup = renderStatic({
      row: GROUP_ROW,
      loadMessages,
      definitionNodes: [GROUP_NODE],
      runStatus: 'failed',
      events: [
        workflowEvent({
          id: 'group-start',
          step_name: 'group.body',
          event_type: 'node_started',
          data: { iteration: 1 },
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
    });
    const text = visibleText(markup);
    expect(text).toContain('Loop group');
    expect(text).toContain('Body nodes');
    expect(text).toContain('Start');
    expect(text).toContain('After body');
    expect(text).toContain('×1 completed');
    expect(text).toContain('×2 failed');
    expect(markup.match(/<details[^>]*open/g)?.length).toBe(1);
    const openBlock = /<details[^>]*open[\s\S]*?<\/details>/.exec(markup);
    expect(openBlock?.[0]).toContain('×2 failed');
    expect(markup.match(/role="region"/g)?.length).toBe(1);
    expect(markup).toContain('aria-label="group room"');
    expect(requests).toHaveLength(0);
  });

  test('renders awaiting header with warning tokens and waiting on you', () => {
    const { requests, loadMessages } = createLoadMessages();
    const bashDef: readonly DagNode[] = [{ id: 'setup', bash: 'echo ready' }];
    const bashEvents = [
      workflowEvent({ id: 'start-setup', step_name: 'setup', event_type: 'node_started' }),
    ];

    const awaitingMarkup = renderStatic({
      row: row({
        id: 'start-setup',
        nodeId: 'setup',
        label: 'Setup',
        status: 'awaiting',
      }),
      loadMessages,
      definitionNodes: bashDef,
      events: bashEvents,
    });
    expect(awaitingMarkup).toContain('waiting on you');
    expect(awaitingMarkup).toContain('text-warning');
    expect(awaitingMarkup).not.toContain('>awaiting<');

    const runningMarkup = renderStatic({
      row: row({
        id: 'start-setup',
        nodeId: 'setup',
        label: 'Setup',
        status: 'running',
      }),
      loadMessages,
      definitionNodes: bashDef,
      events: bashEvents,
    });
    expect(runningMarkup).toContain('running');
    expect(runningMarkup).toContain('text-accent');
    expect(runningMarkup).not.toContain('waiting on you');

    const failedMarkup = renderStatic({
      row: row({
        id: 'start-setup',
        nodeId: 'setup',
        label: 'Setup',
        status: 'failed',
      }),
      loadMessages,
      definitionNodes: bashDef,
      events: bashEvents,
    });
    expect(failedMarkup).toContain('failed');
    expect(failedMarkup).toContain('text-error');
    expect(failedMarkup).not.toContain('waiting on you');
    expect(requests).toHaveLength(0);
  });
});

describe('LegacyNodeRoom dispatcher', () => {
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

  function renderRoom(args: {
    row: LogRow | null;
    loadMessages: (runId: string, nodeId: string) => Promise<WorkflowNodeMessagesResponse>;
    definitionNodes?: readonly DagNode[];
    definitionPending?: boolean;
    events?: readonly WorkflowEventResponse[];
    runStatus?: WorkflowRunStatus;
  }): void {
    root.render(
      createElement(
        reactQuery.QueryClientProvider,
        { client: queryClient },
        createElement(LegacyNodeRoom, {
          runId: 'run-1',
          row: args.row,
          isLive: false,
          loadMessages: args.loadMessages,
          definitionNodes: args.definitionNodes ?? [],
          definitionPending: args.definitionPending ?? false,
          events: args.events ?? [],
          runStatus: args.runStatus ?? 'running',
          approval: null,
          onApprove: async (): Promise<void> => undefined,
          onReject: async (): Promise<void> => undefined,
        })
      )
    );
  }

  const bashEvents: readonly WorkflowEventResponse[] = [
    workflowEvent({ id: 'start-setup', step_name: 'setup', event_type: 'node_started' }),
    workflowEvent({
      id: 'done-setup',
      step_name: 'setup',
      event_type: 'node_completed',
      data: { type: 'bash', node_output: 'ready' },
    }),
  ];

  test('mounts NodeTranscriptPane for a command row and requests messages once', async () => {
    const { requests, loadMessages } = createLoadMessages();
    await act(async () => {
      renderRoom({
        row: COMMAND_ROW,
        loadMessages,
        definitionNodes: [{ id: 'command', command: 'review' }],
      });
    });
    await flushUntil(
      host,
      'command transcript',
      () => requests.length === 1 && (host.textContent ?? '').includes('agent-text')
    );
    expect(requests).toEqual([['run-1', 'command']]);
    expect(host.textContent).toContain('Command');
    expect(host.textContent).toContain('running');
    expect(host.querySelectorAll('[role="region"]')).toHaveLength(1);
    expect(host.querySelector('[aria-label="command room"]')).not.toBeNull();
  });

  test('requests messages only after rerendering from bash to command', async () => {
    const { requests, loadMessages } = createLoadMessages();
    await act(async () => {
      renderRoom({
        row: SETUP_ROW,
        loadMessages,
        definitionNodes: [
          { id: 'setup', bash: 'echo ready' },
          { id: 'command', command: 'review' },
        ],
        events: bashEvents,
        runStatus: 'completed',
      });
    });
    await flush();
    expect(host.textContent).toContain('ready');
    expect(host.textContent).toContain('Bash');
    expect(requests).toHaveLength(0);

    await act(async () => {
      renderRoom({
        row: COMMAND_ROW,
        loadMessages,
        definitionNodes: [
          { id: 'setup', bash: 'echo ready' },
          { id: 'command', command: 'review' },
        ],
        events: bashEvents,
      });
    });
    await flushUntil(host, 'command after bash', () => requests.length === 1);
    expect(requests).toEqual([['run-1', 'command']]);
    expect(host.querySelector('[aria-label="command room"]')).not.toBeNull();
  });

  test('keeps one labelled room and does not refetch when leaving command for bash', async () => {
    const { requests, loadMessages } = createLoadMessages();
    await act(async () => {
      renderRoom({
        row: COMMAND_ROW,
        loadMessages,
        definitionNodes: [
          { id: 'setup', bash: 'echo ready' },
          { id: 'command', command: 'review' },
        ],
        events: bashEvents,
      });
    });
    await flushUntil(host, 'initial command', () => requests.length === 1);

    await act(async () => {
      renderRoom({
        row: SETUP_ROW,
        loadMessages,
        definitionNodes: [
          { id: 'setup', bash: 'echo ready' },
          { id: 'command', command: 'review' },
        ],
        events: bashEvents,
        runStatus: 'completed',
      });
    });
    await flush();
    expect(requests).toEqual([['run-1', 'command']]);
    expect(host.querySelectorAll('[role="region"]')).toHaveLength(1);
    expect(host.querySelector('[aria-label="setup room"]')).not.toBeNull();
    expect(host.textContent).toContain('ready');
  });

  test('shows Loading node room while the definition is pending, then mounts the command transcript', async () => {
    const { requests, loadMessages } = createLoadMessages();
    await act(async () => {
      renderRoom({
        row: COMMAND_ROW,
        loadMessages,
        definitionPending: true,
      });
    });
    await flush();
    expect(host.textContent).toContain('Loading');
    expect(host.textContent).toContain('Loading node room');
    expect(host.querySelectorAll('[role="region"]')).toHaveLength(1);
    expect(host.querySelector('[aria-label="command room"]')).not.toBeNull();
    expect(requests).toHaveLength(0);

    await act(async () => {
      renderRoom({
        row: COMMAND_ROW,
        loadMessages,
        definitionNodes: [{ id: 'command', command: 'review' }],
        definitionPending: false,
      });
    });
    await flushUntil(host, 'command after loading', () => requests.length === 1);
    expect(requests).toEqual([['run-1', 'command']]);
    expect(host.textContent).toContain('agent-text');
  });
});
