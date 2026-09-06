process.env.NODE_ENV = 'development';

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';

import type { WorkflowNodeMessageResponse, WorkflowNodeMessagesResponse } from '@/lib/api';

import type { LogRow } from './build-log-rows';
import type { Root } from 'react-dom/client';

const react = await import('react');
const reactQuery = await import('@tanstack/react-query');
const reactDomClient = await import('react-dom/client');
const nodeTranscriptPane = await import('./NodeTranscriptPane');

const act = react.act;
const createElement = react.createElement;
const notifyManager = reactQuery.notifyManager;
const createRoot = reactDomClient.createRoot;
const transcriptRefetchInterval = nodeTranscriptPane.transcriptRefetchInterval;

const CREATED_AT = '2026-09-06T00:00:00.000Z';

const FIXTURE: readonly WorkflowNodeMessageResponse[] = [
  { id: 'm1', seq: 1, kind: 'status', payload: { state: 'started' }, created_at: CREATED_AT },
  {
    id: 'm2',
    seq: 2,
    kind: 'status',
    payload: { state: 'iteration_started', detail: '1' },
    created_at: CREATED_AT,
  },
  { id: 'm3', seq: 3, kind: 'text', payload: { text: 'first' }, created_at: CREATED_AT },
  {
    id: 'm4',
    seq: 4,
    kind: 'status',
    payload: { state: 'iteration_completed', detail: '1' },
    created_at: CREATED_AT,
  },
  {
    id: 'm5',
    seq: 5,
    kind: 'status',
    payload: { state: 'iteration_started', detail: '2' },
    created_at: CREATED_AT,
  },
  {
    id: 'm6',
    seq: 6,
    kind: 'tool',
    payload: { name: 'Read', id: 'tool-1', input: { path: 'a.ts' } },
    created_at: CREATED_AT,
  },
  {
    id: 'm7',
    seq: 7,
    kind: 'status',
    payload: { state: 'iteration_failed', detail: '2' },
    created_at: CREATED_AT,
  },
  { id: 'm8', seq: 8, kind: 'status', payload: { state: 'failed' }, created_at: CREATED_AT },
];

const REVIEW_ROW: LogRow = {
  id: 'start-review',
  nodeId: 'review',
  label: 'Review',
  status: 'running',
  order: 0,
  sourceIndex: 0,
  selection: { kind: 'node' },
};

const ITERATION_TWO_ROW: LogRow = {
  id: 'loop-review-2',
  nodeId: 'review',
  label: 'Review \u00d72',
  status: 'failed',
  order: 1,
  sourceIndex: 0,
  selection: { kind: 'loop_iteration', iteration: 2 },
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

describe('transcriptRefetchInterval', () => {
  test('returns 1000 while live and false otherwise', () => {
    expect(transcriptRefetchInterval(true)).toBe(1000);
    expect(transcriptRefetchInterval(false)).toBe(false);
  });
});

describe('NodeTranscriptPane', () => {
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

  function renderPane(args: {
    row: LogRow | null;
    isLive?: boolean;
    loadMessages: (runId: string, nodeId: string) => Promise<WorkflowNodeMessagesResponse>;
  }): void {
    root.render(
      createElement(
        reactQuery.QueryClientProvider,
        { client: queryClient },
        createElement(nodeTranscriptPane.NodeTranscriptPane, {
          runId: 'run-1',
          row: args.row,
          isLive: args.isLive ?? false,
          loadMessages: args.loadMessages,
        })
      )
    );
  }

  test('fetches the selected node transcript once', async () => {
    const pending = deferred<WorkflowNodeMessagesResponse>();
    const calls: [string, string][] = [];
    const loadMessages = (runId: string, nodeId: string): Promise<WorkflowNodeMessagesResponse> => {
      calls.push([runId, nodeId]);
      return pending.promise;
    };

    await act(async () => {
      renderPane({ row: REVIEW_ROW, loadMessages });
    });
    await flush();
    expect(host.textContent).toContain('Loading node transcript');

    await act(async () => {
      pending.resolve({ messages: [...FIXTURE] });
    });
    await flushUntil(host, 'first fetch', () => (host.textContent ?? '').includes('first'));

    expect(calls).toEqual([['run-1', 'review']]);
    expect(host.querySelectorAll('[role="region"]')).toHaveLength(1);
    expect(host.querySelector('[aria-label="review room"]')).not.toBeNull();
  });

  test('re-slices the same-node cache when the selected iteration changes', async () => {
    const pending = deferred<WorkflowNodeMessagesResponse>();
    const calls: [string, string][] = [];
    const loadMessages = (runId: string, nodeId: string): Promise<WorkflowNodeMessagesResponse> => {
      calls.push([runId, nodeId]);
      return pending.promise;
    };

    await act(async () => {
      renderPane({ row: REVIEW_ROW, loadMessages });
    });
    await act(async () => {
      pending.resolve({ messages: [...FIXTURE] });
    });
    await flushUntil(host, 'cached fetch', () => (host.textContent ?? '').includes('first'));
    expect(calls).toEqual([['run-1', 'review']]);

    await act(async () => {
      renderPane({ row: ITERATION_TWO_ROW, loadMessages });
    });
    await flush();

    expect(calls).toEqual([['run-1', 'review']]);
    expect(host.querySelectorAll('[role="region"]')).toHaveLength(1);
    expect(host.textContent).toContain('Read');
    expect(host.textContent).toContain('iteration_started');
    expect(host.textContent).toContain('iteration_failed');
    expect(host.textContent).not.toContain('first');
  });

  test('recovers from a deterministic error through Retry', async () => {
    let shouldFail = true;
    const calls: [string, string][] = [];
    const loadMessages = async (
      runId: string,
      nodeId: string
    ): Promise<WorkflowNodeMessagesResponse> => {
      calls.push([runId, nodeId]);
      if (shouldFail) {
        throw new Error('boom');
      }
      return { messages: [...FIXTURE] };
    };

    await act(async () => {
      renderPane({ row: REVIEW_ROW, loadMessages });
    });
    await flushUntil(host, 'error state', () =>
      (host.textContent ?? '').includes('Failed to load node transcript')
    );
    expect(host.textContent).toContain('Retry');
    expect(calls).toEqual([['run-1', 'review']]);

    shouldFail = false;
    const buttons = Array.from(host.querySelectorAll('button'));
    const retry = buttons.find(button => (button.textContent ?? '').includes('Retry'));
    if (retry === undefined) {
      throw new Error('missing Retry button');
    }

    await act(async () => {
      retry.click();
    });
    await flushUntil(host, 'retry recovery', () => (host.textContent ?? '').includes('first'));

    expect(calls).toEqual([
      ['run-1', 'review'],
      ['run-1', 'review'],
    ]);
    expect(host.querySelector('[aria-label="review room"]')).not.toBeNull();
  });
});
