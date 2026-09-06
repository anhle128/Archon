process.env.NODE_ENV = 'development';

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';

import type {
  AskAnswerBody,
  PendingInteraction,
  WorkflowNodeMessageResponse,
  WorkflowNodeMessagesResponse,
  WorkflowNodeStateResponse,
} from '@/lib/api';
import type { WorkflowRunStatus } from '@/lib/types';

import type { LogRow } from './build-log-rows';
import type { Root } from 'react-dom/client';

const react = await import('react');
const reactQuery = await import('@tanstack/react-query');
const reactDomClient = await import('react-dom/client');

const act = react.act;
const createElement = react.createElement;
const notifyManager = reactQuery.notifyManager;
const createRoot = reactDomClient.createRoot;

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

let nodeTranscriptPaneModulePromise: Promise<typeof import('./NodeTranscriptPane')> | null = null;

async function loadNodeTranscriptPaneModule(): Promise<typeof import('./NodeTranscriptPane')> {
  if (nodeTranscriptPaneModulePromise === null) {
    let tempWin: Window | null = null;
    if (typeof globalThis.document === 'undefined') {
      tempWin = installHappyDom();
    }
    nodeTranscriptPaneModulePromise = import('./NodeTranscriptPane');
    const module = await nodeTranscriptPaneModulePromise;
    if (tempWin !== null) {
      // Radix keeps import-time DOM references; restore globals but keep the window alive.
      restoreGlobals();
    }
    return module;
  }
  return nodeTranscriptPaneModulePromise;
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
  test('polls node messages for non-terminal run statuses', async () => {
    const { transcriptRefetchInterval } = await loadNodeTranscriptPaneModule();
    expect(transcriptRefetchInterval('pending')).toBe(1000);
    expect(transcriptRefetchInterval('running')).toBe(1000);
    expect(transcriptRefetchInterval('paused')).toBe(1000);
    expect(transcriptRefetchInterval('completed')).toBe(false);
    expect(transcriptRefetchInterval('failed')).toBe(false);
    expect(transcriptRefetchInterval('cancelled')).toBe(false);
  });
});

describe('NodeTranscriptPane', () => {
  let win: Window;
  let host: Element;
  let root: Root;
  let queryClient: InstanceType<typeof reactQuery.QueryClient>;
  let nodeTranscriptPane: typeof import('./NodeTranscriptPane');

  beforeEach(async () => {
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
    nodeTranscriptPane = await loadNodeTranscriptPaneModule();
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
    runStatus?: WorkflowRunStatus;
    loadMessages: (runId: string, nodeId: string) => Promise<WorkflowNodeMessagesResponse>;
    pendingInteractions?: readonly PendingInteraction[];
    viewerIsStarter?: boolean;
    starterDisplayName?: string | null;
    actionStates?: Record<string, { phase: 'sending' } | undefined>;
    nodeState?: WorkflowNodeStateResponse;
    onSubmitAsk?: (requestId: string, body: AskAnswerBody) => Promise<void>;
  }): void {
    root.render(
      createElement(
        reactQuery.QueryClientProvider,
        { client: queryClient },
        createElement(nodeTranscriptPane.NodeTranscriptPane, {
          runId: 'run-1',
          row: args.row,
          runStatus: args.runStatus ?? 'completed',
          loadMessages: args.loadMessages,
          pendingInteractions: args.pendingInteractions ?? [],
          viewerIsStarter: args.viewerIsStarter ?? true,
          starterDisplayName:
            args.starterDisplayName === undefined ? 'Avery' : args.starterDisplayName,
          actionStates: args.actionStates ?? {},
          nodeState: args.nodeState,
          onSubmitAsk: args.onSubmitAsk ?? (async (): Promise<void> => undefined),
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

  function pendingAsk(overrides: Partial<PendingInteraction> = {}): PendingInteraction {
    return {
      id: 'ask-1',
      workflow_run_id: 'run-1',
      node_id: 'review',
      tool_use_id: 'tool-ask',
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
      provider_session_id: 'sess-1',
      created_at: CREATED_AT,
      resolved_at: null,
      resolved_by: null,
      ...overrides,
    };
  }

  function reactProps(node: Element): {
    onChange?: (event: { target: { value: string; checked: boolean } }) => void;
    onSubmit?: (event: { preventDefault: () => void }) => void;
  } | null {
    const key = Object.keys(node).find(candidate => candidate.startsWith('__reactProps$'));
    if (key === undefined) {
      return null;
    }
    const props = (node as unknown as Record<string, unknown>)[key];
    if (props === null || typeof props !== 'object') {
      return null;
    }
    return props as {
      onChange?: (event: { target: { value: string; checked: boolean } }) => void;
      onSubmit?: (event: { preventDefault: () => void }) => void;
    };
  }

  const ASK_TOOL: WorkflowNodeMessageResponse = {
    id: 'm-ask-tool',
    seq: 8,
    kind: 'tool',
    payload: { name: 'AskHuman', id: 'tool-ask', input: { questions: [] } },
    created_at: CREATED_AT,
  };

  test('places an anchored Ask card after the matching tool chip and submits the request id', async () => {
    const submitted: [string, AskAnswerBody][] = [];
    await act(async () => {
      renderPane({
        row: REVIEW_ROW,
        loadMessages: async (): Promise<WorkflowNodeMessagesResponse> => ({
          messages: [...FIXTURE, ASK_TOOL],
        }),
        pendingInteractions: [pendingAsk()],
        onSubmitAsk: async (requestId, body): Promise<void> => {
          submitted.push([requestId, body]);
        },
      });
    });
    await flushUntil(host, 'anchored ask', () => (host.textContent ?? '').includes('Ship it?'));
    const text = host.textContent ?? '';
    expect(text.indexOf('AskHuman')).toBeGreaterThan(-1);
    expect(text.indexOf('AskHuman')).toBeLessThan(text.indexOf('Ship it?'));
    const ship = host.querySelector('input[type="radio"][value="Ship"]');
    if (!(ship instanceof win.HTMLInputElement)) {
      throw new Error('missing Ship control');
    }
    await act(async () => {
      const onChange = reactProps(ship)?.onChange;
      if (onChange === undefined) {
        throw new Error('missing radio onChange');
      }
      onChange({ target: { value: 'Ship', checked: true } });
    });
    await flush();
    const form = host.querySelector('form[aria-label="question from agent, 1 questions"]');
    if (form === null) {
      throw new Error('missing Ask form');
    }
    await act(async () => {
      form.dispatchEvent(
        new win.Event('submit', { bubbles: true, cancelable: true }) as unknown as Event
      );
    });
    await flush();
    expect(submitted).toEqual([['tool-ask', { answers: [{ questionId: 'q1', value: 'Ship' }] }]]);
  });

  test('keeps unanchored current Asks at the end and hides other-slice and status-row cards', async () => {
    const loopMessages: WorkflowNodeMessageResponse[] = [
      { id: 's1', seq: 1, kind: 'status', payload: { state: 'started' }, created_at: CREATED_AT },
      {
        id: 'i1s',
        seq: 2,
        kind: 'status',
        payload: { state: 'iteration_started', detail: '1' },
        created_at: CREATED_AT,
      },
      {
        id: 't1',
        seq: 3,
        kind: 'tool',
        payload: { name: 'Write', id: 'tool-iter-1', input: {} },
        created_at: CREATED_AT,
      },
      {
        id: 'i1c',
        seq: 4,
        kind: 'status',
        payload: { state: 'iteration_completed', detail: '1' },
        created_at: CREATED_AT,
      },
      {
        id: 'i2s',
        seq: 5,
        kind: 'status',
        payload: { state: 'iteration_started', detail: '2' },
        created_at: CREATED_AT,
      },
      {
        id: 't2',
        seq: 6,
        kind: 'tool',
        payload: { name: 'Read', id: 'tool-1', input: { path: 'a.ts' } },
        created_at: CREATED_AT,
      },
      {
        id: 'i2c',
        seq: 7,
        kind: 'status',
        payload: { state: 'iteration_failed', detail: '2' },
        created_at: CREATED_AT,
      },
      { id: 'tail', seq: 8, kind: 'text', payload: { text: 'after-loop' }, created_at: CREATED_AT },
    ];
    const otherSliceAsk = pendingAsk({
      id: 'ask-iter-1',
      tool_use_id: 'tool-iter-1',
    });
    const unanchored = pendingAsk({
      id: 'ask-open',
      tool_use_id: 'tool-missing',
    });
    await act(async () => {
      renderPane({
        row: ITERATION_TWO_ROW,
        loadMessages: async (): Promise<WorkflowNodeMessagesResponse> => ({
          messages: loopMessages,
        }),
        pendingInteractions: [otherSliceAsk, unanchored],
      });
    });
    await flushUntil(host, 'iteration two', () => (host.textContent ?? '').includes('Read'));
    expect(host.textContent).toContain('Read');
    expect(host.querySelector('form[aria-label="question from agent, 1 questions"]')).toBeNull();
    expect(host.textContent).not.toContain('Ship it?');
    expect(host.textContent).not.toContain('Ship it?');

    queryClient.clear();
    await act(async () => {
      renderPane({
        row: REVIEW_ROW,
        loadMessages: async (): Promise<WorkflowNodeMessagesResponse> => ({
          messages: loopMessages,
        }),
        pendingInteractions: [unanchored],
      });
    });
    await flushUntil(host, 'unanchored ask', () => (host.textContent ?? '').includes('Ship it?'));
    const text = host.textContent ?? '';
    expect(text.lastIndexOf('Ship it?')).toBeGreaterThan(text.indexOf('Read'));

    queryClient.clear();
    await act(async () => {
      renderPane({
        row: REVIEW_ROW,
        loadMessages: async (): Promise<WorkflowNodeMessagesResponse> => ({
          messages: [
            ...FIXTURE,
            {
              id: 'm-awaiting',
              seq: 8,
              kind: 'status',
              payload: { state: 'awaiting', detail: 'waiting' },
              created_at: CREATED_AT,
            },
          ],
        }),
        pendingInteractions: [],
      });
    });
    await flushUntil(host, 'status awaiting', () => (host.textContent ?? '').includes('awaiting'));
    expect(host.querySelector('form[aria-label="question from agent, 1 questions"]')).toBeNull();
    expect(host.textContent).not.toContain('Ship it?');
  });

  test('still renders every node Ask after Retry when the transcript query fails', async () => {
    await act(async () => {
      renderPane({
        row: REVIEW_ROW,
        loadMessages: async (): Promise<WorkflowNodeMessagesResponse> => {
          throw new Error('boom');
        },
        pendingInteractions: [pendingAsk(), pendingAsk({ id: 'ask-2', tool_use_id: 'tool-b' })],
      });
    });
    await flushUntil(
      host,
      'error asks',
      () =>
        (host.textContent ?? '').includes('Failed to load node transcript') &&
        (host.textContent ?? '').includes('Ship it?')
    );
    expect(host.textContent).toContain('Retry');
    expect(
      host.querySelectorAll('form[aria-label="question from agent, 1 questions"]')
    ).toHaveLength(2);
  });

  test('keeps two pending Asks independent and focuses only the first actionable card', async () => {
    await act(async () => {
      renderPane({
        row: REVIEW_ROW,
        loadMessages: async (): Promise<WorkflowNodeMessagesResponse> => ({
          messages: [
            ASK_TOOL,
            {
              id: 'm-ask-tool-2',
              seq: 9,
              kind: 'tool',
              payload: { name: 'AskHuman', id: 'tool-b', input: {} },
              created_at: CREATED_AT,
            },
          ],
        }),
        pendingInteractions: [pendingAsk(), pendingAsk({ id: 'ask-2', tool_use_id: 'tool-b' })],
      });
    });
    await flushUntil(
      host,
      'two asks',
      () =>
        host.querySelectorAll('form[aria-label="question from agent, 1 questions"]').length === 2
    );
    expect(
      host.querySelectorAll('form[aria-label="question from agent, 1 questions"]')
    ).toHaveLength(2);
    expect((host.ownerDocument ?? document).activeElement?.id).toBe('ask-1:q1:Ship');
  });

  test('renders Invalid Ask payload for a malformed envelope with no mutation actions', async () => {
    await act(async () => {
      renderPane({
        row: REVIEW_ROW,
        loadMessages: async (): Promise<WorkflowNodeMessagesResponse> => ({
          messages: [ASK_TOOL],
        }),
        pendingInteractions: [pendingAsk({ envelope: { questions: [] } })],
      });
    });
    await flushUntil(host, 'invalid ask', () =>
      (host.textContent ?? '').includes('Invalid Ask payload')
    );
    expect(host.querySelector('form[aria-label="question from agent, 1 questions"]')).toBeNull();
    expect(host.textContent).not.toContain('Submit');
    expect(host.textContent).not.toContain('Decline');
  });

  test('names Avery and disables choices for a non-starter card', async () => {
    await act(async () => {
      renderPane({
        row: REVIEW_ROW,
        viewerIsStarter: false,
        starterDisplayName: 'Avery',
        loadMessages: async (): Promise<WorkflowNodeMessagesResponse> => ({
          messages: [ASK_TOOL],
        }),
        pendingInteractions: [pendingAsk()],
      });
    });
    await flushUntil(host, 'named readonly', () =>
      (host.textContent ?? '').includes('Waiting for Avery to answer')
    );
    expect(host.querySelector('fieldset[disabled]')).not.toBeNull();
    expect(host.textContent).toContain('Waiting for Avery to answer');
    expect(host.textContent).not.toContain('Submit');
    expect(host.textContent).not.toContain('Decline');
  });
});
