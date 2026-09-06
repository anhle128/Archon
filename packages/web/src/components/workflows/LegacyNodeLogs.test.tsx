process.env.NODE_ENV = 'development';

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';

import type { WorkflowEventResponse, WorkflowNodeMessagesResponse } from '@/lib/api';
import type { Root } from 'react-dom/client';

const react = await import('react');
const reactQuery = await import('@tanstack/react-query');
const reactDomClient = await import('react-dom/client');
const legacyNodeLogs = await import('./LegacyNodeLogs');

const act = react.act;
const createElement = react.createElement;
const notifyManager = reactQuery.notifyManager;
const createRoot = reactDomClient.createRoot;

const CREATED_AT = '2026-09-06T00:00:00.000Z';

const REVIEW_STATE = {
  nodeId: 'review',
  name: 'Review',
  status: 'running' as const,
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

describe('LegacyNodeLogs', () => {
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

  function renderLogs(args: {
    runId: string;
    nodeStates: readonly (typeof REVIEW_STATE)[];
    events: readonly WorkflowEventResponse[];
    loadMessages: (runId: string, nodeId: string) => Promise<WorkflowNodeMessagesResponse>;
    onSelectNode: (nodeId: string | null) => void;
  }): void {
    root.render(
      createElement(
        reactQuery.QueryClientProvider,
        { client: queryClient },
        createElement(legacyNodeLogs.LegacyNodeLogs, {
          runId: args.runId,
          nodeStates: args.nodeStates,
          events: args.events,
          isLive: false,
          loadMessages: args.loadMessages,
          onSelectNode: args.onSelectNode,
        })
      )
    );
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

    const buttons = Array.from(host.querySelectorAll('button'));
    const review = buttons.find(button => (button.textContent ?? '').includes('Review'));
    if (review === undefined) {
      throw new Error('missing Review row');
    }

    await act(async () => {
      review.click();
    });
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

    await act(async () => {
      renderLogs({
        runId: 'run-2',
        nodeStates: [],
        events: [],
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
  });
});
