import { afterEach, beforeEach, describe, expect, mock, spyOn, test, type Mock } from 'bun:test';
import {
  focusManager,
  onlineManager,
  QueryClient,
  QueryClientProvider,
} from '@tanstack/react-query';
import { Window } from 'happy-dom';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import type {
  GitChangedFile,
  GitChangesResponse,
  GitLogCommit,
  GitLogResponse,
  GitReadyDiffResponse,
} from '@/lib/api';

import { SourceControlPanel } from '../components/workflows/source-control/source-control-panel';
import { SourceControlTab } from '../components/workflows/source-control/source-control-tab';

const REVISION_A = 'a'.repeat(64);
const REVISION_B = 'b'.repeat(64);
const HASH_A = 'c'.repeat(64);
const HASH_B = 'd'.repeat(64);

const EMPTY_GIT_LOG: GitLogResponse = {
  commits: [],
  revision: REVISION_A,
  truncated: false,
};

const HISTORY_COMMIT: GitLogCommit = {
  oid: '1'.repeat(40),
  parents: [],
  authorName: 'Ada',
  authorDate: '2026-09-06T18:09:18Z',
  subject: 'initial history subject',
};

const FIRST_DIFF_PAGE: GitReadyDiffResponse = {
  path: 'large.ts',
  status: 'M',
  scope: 'now',
  ref: 'live',
  cursor: 'version-one',
  truncated: true,
  binary: false,
  fileFallback: false,
  hunks: [
    {
      header: '@@ -1 +1 @@',
      oldStart: 1,
      oldLines: 1,
      newStart: 1,
      newLines: 1,
      changes: [{ type: 'insert', content: 'first', newLine: 1 }],
    },
  ],
};

const SECOND_DIFF_PAGE: GitReadyDiffResponse = {
  ...FIRST_DIFF_PAGE,
  cursor: '',
  truncated: false,
  hunks: [
    {
      header: '@@ -10 +10 @@',
      oldStart: 10,
      oldLines: 1,
      newStart: 10,
      newLines: 1,
      changes: [{ type: 'insert', content: 'second', newLine: 10 }],
    },
  ],
};

let stackedViewport = false;
let createObjectUrlMock: Mock<(blob: Blob) => string>;
let revokeObjectUrlMock: Mock<(url: string) => void>;

function installHappyDom(): Window {
  const win = new Window({ url: 'https://localhost/' });
  const matchMedia = (query: string): MediaQueryList =>
    ({
      get matches(): boolean {
        return query.includes('max-width: 899px') ? stackedViewport : false;
      },
      media: query,
      onchange: null,
      addEventListener(): void {
        return undefined;
      },
      removeEventListener(): void {
        return undefined;
      },
      addListener(): void {
        return undefined;
      },
      removeListener(): void {
        return undefined;
      },
      dispatchEvent(): boolean {
        return true;
      },
    }) as MediaQueryList;
  win.matchMedia = matchMedia as unknown as typeof win.matchMedia;
  class ResizeObserverStub {
    observe(): void {
      return undefined;
    }
    unobserve(): void {
      return undefined;
    }
    disconnect(): void {
      return undefined;
    }
  }
  const globals: Record<string, unknown> = {
    window: win,
    document: win.document,
    self: win,
    HTMLElement: win.HTMLElement,
    HTMLButtonElement: win.HTMLButtonElement,
    HTMLAnchorElement: win.HTMLAnchorElement,
    Element: win.Element,
    Node: win.Node,
    Text: win.Text,
    DocumentFragment: win.DocumentFragment,
    navigator: win.navigator,
    location: win.location,
    getComputedStyle: win.getComputedStyle.bind(win),
    requestAnimationFrame: win.requestAnimationFrame.bind(win),
    cancelAnimationFrame: win.cancelAnimationFrame.bind(win),
    MutationObserver: win.MutationObserver,
    ResizeObserver: win.ResizeObserver ?? ResizeObserverStub,
    matchMedia,
    Event: win.Event,
    MouseEvent: win.MouseEvent,
    KeyboardEvent: win.KeyboardEvent,
    IS_REACT_ACT_ENVIRONMENT: true,
    URL: win.URL,
    Blob: win.Blob,
  };
  Object.assign(globalThis as object, globals);
  return win;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function presentedFileResponse(
  body: BodyInit | null,
  hash: string,
  headers: Record<string, string>
): Response {
  return new Response(body, {
    status: 200,
    headers: {
      ETag: '"' + hash + '"',
      'X-Archon-Git-Truncated': 'false',
      'X-Archon-Git-Cursor': '',
      'X-Archon-Git-Byte-Length': '1',
      'X-Archon-Git-Media-Type': '',
      ...headers,
    },
  });
}

function mockFetchResponses(responses: readonly GitChangesResponse[]): Mock<typeof fetch> {
  let changesIndex = 0;
  return spyOn(globalThis, 'fetch').mockImplementation((async (
    input: RequestInfo | URL
  ): Promise<Response> => {
    const url = requestUrl(input);
    if (url.includes('/git/log')) return jsonResponse(EMPTY_GIT_LOG);
    if (!url.includes('/git/changes')) throw new Error(`Unexpected fetch: ${url}`);
    const payload = responses[changesIndex];
    if (!payload) throw new Error(`Unexpected changes fetch ${String(changesIndex + 1)}`);
    changesIndex += 1;
    return jsonResponse(payload);
  }) as typeof fetch);
}

function textFileResponse(text: string, hash: string): Response {
  return new Response(text, {
    status: 200,
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      ETag: `"${hash}"`,
    },
  });
}

function binaryFileResponse(bytes: Uint8Array, hash: string): Response {
  return new Response(bytes as unknown as BodyInit, {
    status: 200,
    headers: {
      'Content-Type': 'application/octet-stream',
      'Content-Disposition': 'attachment; filename="blob.bin"',
      ETag: `"${hash}"`,
    },
  });
}

function readyDiff(path: string, before: string, after: string): GitReadyDiffResponse {
  return {
    path,
    status: 'M',
    scope: 'now',
    ref: 'live',
    cursor: '',
    truncated: false,
    binary: false,
    fileFallback: false,
    hunks: [
      {
        header: '@@ -1,1 +1,1 @@',
        oldStart: 1,
        oldLines: 1,
        newStart: 1,
        newLines: 1,
        changes: [
          { type: 'delete', content: before, oldLine: 1 },
          { type: 'insert', content: after, newLine: 1 },
        ],
      },
    ],
  };
}

function binaryDiff(path: string): GitReadyDiffResponse {
  return {
    path,
    status: 'M',
    scope: 'now',
    ref: 'live',
    cursor: '',
    truncated: false,
    binary: true,
    fileFallback: true,
    hunks: [],
  };
}

function createDeferred<T>(): {
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

function mockGitRoutes(options: {
  onChanges: (
    call: number,
    init?: RequestInit
  ) => GitChangesResponse | Response | Promise<GitChangesResponse | Response>;
  onDiff?: (url: string, call: number, init?: RequestInit) => Response | Promise<Response>;
  onFile?: (url: string, call: number, init?: RequestInit) => Response | Promise<Response>;
  onLog?: (
    call: number,
    init?: RequestInit
  ) => GitLogResponse | Response | Promise<GitLogResponse | Response>;
}): Mock<typeof fetch> {
  let changesCall = 0;
  let diffCall = 0;
  let fileCall = 0;
  let logCall = 0;
  return spyOn(globalThis, 'fetch').mockImplementation((async (
    input: RequestInfo | URL,
    init?: RequestInit
  ): Promise<Response> => {
    const url = requestUrl(input);
    if (url.includes('/git/log')) {
      logCall += 1;
      const result = options.onLog ? await options.onLog(logCall, init) : EMPTY_GIT_LOG;
      return result instanceof Response ? result : jsonResponse(result);
    }
    if (url.includes('/git/changes')) {
      changesCall += 1;
      const result = await options.onChanges(changesCall, init);
      return result instanceof Response ? result : jsonResponse(result);
    }
    if (url.includes('/git/diff')) {
      diffCall += 1;
      if (!options.onDiff) throw new Error(`Unexpected diff fetch: ${url}`);
      return options.onDiff(url, diffCall, init);
    }
    if (url.includes('/git/file/')) {
      fileCall += 1;
      if (!options.onFile) throw new Error(`Unexpected file fetch: ${url}`);
      return options.onFile(url, fileCall, init);
    }
    throw new Error(`Unexpected fetch: ${url}`);
  }) as typeof fetch);
}

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

function calledUrls(spy: Mock<typeof fetch>): string[] {
  return spy.mock.calls.map(call => requestUrl(call[0] as RequestInfo | URL));
}

async function waitFor(predicate: () => boolean, description: string): Promise<void> {
  for (let turn = 0; turn < 20; turn += 1) {
    if (predicate()) return;
    await act(async () => {
      await new Promise<void>(resolve => {
        setTimeout(resolve, 0);
      });
    });
  }
  throw new Error(`Timed out waiting for ${description}`);
}

let win: Window;
let host: Element;
let root: Root;
let queryClient: QueryClient;
let fetchSpy: Mock<typeof fetch> | undefined;

function requireButton(text: string): HTMLButtonElement {
  const button = Array.from(host.querySelectorAll('button')).find(
    candidate => candidate.textContent === text
  );
  if (!(button instanceof HTMLButtonElement)) {
    throw new Error(`Missing button: ${text}`);
  }
  return button;
}

function requireListbox(): HTMLElement {
  const listbox = host.querySelector('[role="listbox"][aria-label="Uncommitted changes"]');
  if (!(listbox instanceof HTMLElement)) {
    throw new Error('Missing changed-files listbox');
  }
  return listbox;
}

async function clickOption(path: string): Promise<void> {
  const option = Array.from(host.querySelectorAll('[role="option"]')).find(candidate =>
    (candidate.textContent ?? '').includes(path)
  );
  if (!(option instanceof HTMLButtonElement)) {
    throw new Error(`Missing option: ${path}`);
  }
  await act(async () => {
    option.click();
  });
}

function groupFlexDirection(): string {
  const group = host.querySelector('[data-group]');
  if (!(group instanceof HTMLElement)) {
    throw new Error('Missing resizable group');
  }
  return group.style.flexDirection;
}

async function renderTab(runId: string): Promise<void> {
  await act(async () => {
    root.render(
      createElement(
        QueryClientProvider,
        { client: queryClient },
        createElement(SourceControlTab, { runId })
      )
    );
  });
}

beforeEach(() => {
  process.env.NODE_ENV = 'development';
  stackedViewport = false;
  win = installHappyDom();
  createObjectUrlMock = mock((_blob: Blob): string => 'blob:archon-image');
  revokeObjectUrlMock = mock((_url: string): void => undefined);
  Object.defineProperty(URL, 'createObjectURL', {
    configurable: true,
    value: createObjectUrlMock,
  });
  Object.defineProperty(URL, 'revokeObjectURL', {
    configurable: true,
    value: revokeObjectUrlMock,
  });
  const element = win.document.createElement('div');
  win.document.body.appendChild(element);
  host = element as unknown as Element;
  root = createRoot(host);
  queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
});

afterEach(async () => {
  await act(async () => {
    root.unmount();
  });
  delete (URL as unknown as { createObjectURL?: unknown }).createObjectURL;
  delete (URL as unknown as { revokeObjectURL?: unknown }).revokeObjectURL;
  queryClient.clear();
  fetchSpy?.mockRestore();
  fetchSpy = undefined;
  win.close();
});

describe('SourceControlTab', () => {
  test('fetches once on mount with encoded runId and renders the response', async () => {
    fetchSpy = mockFetchResponses([
      {
        files: [{ path: 'src/live.ts', status: 'M' }],
        revision: REVISION_A,
      },
    ]);

    await renderTab('run/one');
    await waitFor(() => host.textContent?.includes('src/live.ts'), 'the initial changed file');

    expect(host.textContent).toContain('src/live.ts');
    expect(host.textContent).toContain('M');
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(fetchSpy).toHaveBeenCalledWith('/api/workflows/runs/run%2Fone/git/changes', {
      signal: expect.any(AbortSignal),
    });
    expect(fetchSpy).toHaveBeenCalledWith('/api/workflows/runs/run%2Fone/git/log', {
      signal: expect.any(AbortSignal),
    });
    expect(calledUrls(fetchSpy).every(url => !url.includes('working_path'))).toBe(true);

    await act(async () => {
      await new Promise<void>(resolve => {
        setTimeout(resolve, 0);
      });
    });
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  test('keeps the displayed list until the divergent snapshot is accepted', async () => {
    fetchSpy = mockFetchResponses([
      {
        files: [{ path: 'old.ts', status: 'M' }],
        revision: REVISION_A,
      },
      {
        files: [{ path: 'new.ts', status: 'A' }],
        revision: REVISION_B,
      },
    ]);

    await renderTab('run-1');
    await waitFor(() => host.textContent?.includes('old.ts'), 'the initial snapshot');

    await act(async () => {
      requireButton('Reload').click();
    });
    await waitFor(
      () => host.textContent?.includes('Changed on disk — Reload'),
      'the divergence affordance'
    );

    expect(host.textContent).toContain('old.ts');
    expect(host.textContent).not.toContain('new.ts');

    await act(async () => {
      requireButton('Changed on disk — Reload').click();
    });
    await waitFor(() => host.textContent?.includes('new.ts'), 'the accepted snapshot');

    expect(host.textContent).not.toContain('old.ts');
    expect(fetchSpy).toHaveBeenCalledTimes(4);
  });

  test('updates aria-activedescendant when the focused list receives ArrowDown', async () => {
    fetchSpy = mockFetchResponses([
      {
        files: [
          { path: 'one.ts', status: 'M' },
          { path: 'two.ts', status: 'A' },
        ],
        revision: REVISION_A,
      },
    ]);

    await renderTab('run-1');
    await waitFor(
      () => host.querySelector('[role="listbox"]') !== null,
      'the changed-files listbox'
    );
    const listbox = host.querySelector('[role="listbox"]');
    if (!(listbox instanceof HTMLElement)) {
      throw new Error('Missing changed-files listbox');
    }
    expect(listbox.getAttribute('aria-activedescendant')).toBe('sc-changes-file-0');

    await act(async () => {
      listbox.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    });

    expect(listbox.getAttribute('aria-activedescendant')).toBe('sc-changes-file-1');
    expect(host.querySelector('#sc-changes-file-1')?.getAttribute('data-active')).toBe('true');
    expect(host.querySelector('#sc-changes-file-1')?.getAttribute('aria-selected')).toBe('false');
  });

  test('leaves retries and focus or reconnect refreshes to the Reload button', async () => {
    queryClient.clear();
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: 3, retryDelay: 0 } },
    });
    fetchSpy = spyOn(globalThis, 'fetch').mockImplementation((async (): Promise<Response> => {
      throw new Error('offline');
    }) as unknown as typeof fetch);

    await renderTab('run-1');
    await waitFor(
      () =>
        (host.textContent?.includes('Could not refresh changes.') ?? false) &&
        (host.textContent?.includes('Could not refresh history.') ?? false),
      'the in-region fetch failure'
    );

    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(host.textContent).toContain('Reload');

    focusManager.setFocused(false);
    focusManager.setFocused(true);
    onlineManager.setOnline(false);
    onlineManager.setOnline(true);
    await act(async () => {
      await new Promise<void>(resolve => {
        setTimeout(resolve, 0);
      });
    });

    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  test('opens the current file with Enter or Space and a second file on click', async () => {
    const opened: GitChangedFile[] = [];
    const files: readonly GitChangedFile[] = [
      { path: 'one.ts', status: 'M' },
      { path: 'two.ts', status: 'A' },
    ];

    await act(async () => {
      root.render(
        createElement(SourceControlPanel, {
          snapshot: { files: [...files], revision: REVISION_A },
          historySnapshot: EMPTY_GIT_LOG,
          loadState: 'idle',
          historyLoadState: 'idle',
          stale: false,
          onReload: (): void => undefined,
          onAcceptPending: (): void => undefined,
          onOpenFile: (file: GitChangedFile): void => {
            opened.push(file);
          },
        })
      );
    });

    const listbox = host.querySelector('[role="listbox"]');
    if (!(listbox instanceof HTMLElement)) {
      throw new Error('Missing changed-files listbox');
    }
    const firstRow = host.querySelector('#sc-changes-file-0');
    const secondRow = host.querySelector('#sc-changes-file-1');
    if (!(firstRow instanceof HTMLElement) || !(secondRow instanceof HTMLButtonElement)) {
      throw new Error('Missing changed-file options');
    }

    await act(async () => {
      firstRow.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    });
    await act(async () => {
      firstRow.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }));
    });
    await act(async () => {
      secondRow.click();
    });

    expect(opened).toEqual([files[0], files[0], files[1]]);
    expect(win.document.activeElement?.getAttribute('role')).toBe('listbox');
    expect(secondRow.getAttribute('data-active')).toBe('true');
  });

  test('virtualizes a 200-file list inside a 280-pixel listbox', async () => {
    Object.defineProperty(win.HTMLElement.prototype, 'offsetHeight', {
      configurable: true,
      get(this: { getAttribute: (name: string) => string | null }): number {
        return this.getAttribute('role') === 'listbox' ? 280 : 28;
      },
    });
    Object.defineProperty(win.HTMLElement.prototype, 'offsetWidth', {
      configurable: true,
      get(this: { getAttribute: (name: string) => string | null }): number {
        return this.getAttribute('role') === 'listbox' ? 400 : 320;
      },
    });

    const files: GitChangedFile[] = Array.from({ length: 200 }, (_, index) => ({
      path: `file-${String(index)}.ts`,
      status: 'M' as const,
    }));

    await act(async () => {
      root.render(
        createElement(SourceControlPanel, {
          snapshot: { files, revision: REVISION_A },
          historySnapshot: EMPTY_GIT_LOG,
          loadState: 'idle',
          historyLoadState: 'idle',
          stale: false,
          onReload: (): void => undefined,
          onAcceptPending: (): void => undefined,
        })
      );
    });

    await waitFor(() => {
      const count = host.querySelectorAll('[role="option"]').length;
      return count > 0 && count < 200;
    }, 'a virtualized subset of options');

    expect(host.textContent).toContain('file-0.ts');
    expect(host.textContent).not.toContain('file-199.ts');

    const listbox = host.querySelector('[role="listbox"]');
    if (!(listbox instanceof HTMLElement)) {
      throw new Error('Missing changed-files listbox');
    }

    let scrollTop = 0;
    Object.defineProperty(listbox, 'clientHeight', {
      configurable: true,
      get(): number {
        return 280;
      },
    });
    Object.defineProperty(listbox, 'scrollHeight', {
      configurable: true,
      get(): number {
        return 200 * 28;
      },
    });
    Object.defineProperty(listbox, 'scrollTop', {
      configurable: true,
      get(): number {
        return scrollTop;
      },
      set(value: number): void {
        scrollTop = value;
      },
    });
    listbox.scrollTo = ((arg?: ScrollToOptions | number, y?: number): void => {
      if (typeof arg === 'number') {
        listbox.scrollTop = y ?? 0;
      } else if (arg && typeof arg.top === 'number') {
        listbox.scrollTop = arg.top;
      }
      listbox.dispatchEvent(new Event('scroll'));
    }) as HTMLElement['scrollTo'];

    await act(async () => {
      listbox.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true }));
    });
    await waitFor(
      () => (host.textContent ?? '').includes('file-199.ts'),
      'the later virtualized path'
    );
    expect(host.querySelectorAll('[role="option"]').length).toBeLessThan(200);
  });

  test('Enter on M fetches only the encoded diff URL, keeps the list, and shows Before and After', async () => {
    fetchSpy = mockGitRoutes({
      onChanges: () => ({
        files: [{ path: 'src/a.ts', status: 'M' }],
        revision: REVISION_A,
      }),
      onDiff: () => jsonResponse(readyDiff('src/a.ts', 'old-line', 'new-line')),
    });

    await renderTab('run/one');
    await waitFor(() => host.querySelector('[role="listbox"]') !== null, 'the listbox');
    await act(async () => {
      requireListbox().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    });
    await waitFor(() => (host.textContent ?? '').includes('Before'), 'Before pane');

    expect(host.textContent).toContain('src/a.ts');
    expect(host.textContent).toContain('After');
    expect(host.querySelector('[aria-label="Before"]')).not.toBeNull();
    expect(host.querySelector('[aria-label="After"]')).not.toBeNull();
    expect(calledUrls(fetchSpy).filter(url => !url.includes('/git/log'))).toEqual([
      '/api/workflows/runs/run%2Fone/git/changes',
      '/api/workflows/runs/run%2Fone/git/diff?path=src%2Fa.ts',
    ]);
  });

  test('opening A fetches only worktree and opening D fetches only head', async () => {
    fetchSpy = mockGitRoutes({
      onChanges: () => ({
        files: [
          { path: 'added.ts', status: 'A' },
          { path: 'gone.ts', status: 'D' },
        ],
        revision: REVISION_A,
      }),
      onFile: url => {
        if (url.includes('added.ts') && url.includes('source=worktree')) {
          return textFileResponse('added-body', HASH_A);
        }
        if (url.includes('gone.ts') && url.includes('source=head')) {
          return textFileResponse('deleted-body', HASH_B);
        }
        throw new Error(`Unexpected file URL ${url}`);
      },
    });

    await renderTab('run-1');
    await waitFor(() => host.textContent?.includes('added.ts'), 'added file');
    await clickOption('added.ts');
    await waitFor(() => (host.textContent ?? '').includes('added-body'), 'added text');
    await clickOption('gone.ts');
    await waitFor(() => (host.textContent ?? '').includes('deleted-body'), 'deleted text');

    const urls = calledUrls(fetchSpy);
    expect(urls.filter(url => url.includes('/git/diff'))).toEqual([]);
    expect(urls.filter(url => url.includes('added.ts'))).toEqual([
      '/api/workflows/runs/run-1/git/file/added.ts?source=worktree',
    ]);
    expect(urls.filter(url => url.includes('gone.ts'))).toEqual([
      '/api/workflows/runs/run-1/git/file/gone.ts?source=head',
    ]);
  });

  test('never sends working_path on changes, diff, or file requests', async () => {
    fetchSpy = mockGitRoutes({
      onChanges: () => ({
        files: [{ path: 'src/a.ts', status: 'M' }],
        revision: REVISION_A,
      }),
      onDiff: () => jsonResponse(readyDiff('src/a.ts', 'old-line', 'new-line')),
    });

    await renderTab('run-1');
    await waitFor(() => host.textContent?.includes('src/a.ts'), 'list');
    await clickOption('src/a.ts');
    await waitFor(() => (host.textContent ?? '').includes('Before'), 'diff');

    expect(calledUrls(fetchSpy).every(url => !url.includes('working_path'))).toBe(true);
  });

  test('opening a second file aborts the first request and ignores a late first response', async () => {
    const firstDiff = createDeferred<Response>();
    const signals: AbortSignal[] = [];
    fetchSpy = mockGitRoutes({
      onChanges: () => ({
        files: [
          { path: 'one.ts', status: 'M' },
          { path: 'two.ts', status: 'M' },
        ],
        revision: REVISION_A,
      }),
      onDiff: (url, _call, init) => {
        if (init?.signal) signals.push(init.signal);
        if (url.includes('one.ts')) return firstDiff.promise;
        return jsonResponse(readyDiff('two.ts', 'two-old', 'two-new'));
      },
    });

    await renderTab('run-1');
    await waitFor(() => host.textContent?.includes('two.ts'), 'both files');
    await clickOption('one.ts');
    await clickOption('two.ts');
    await waitFor(() => (host.textContent ?? '').includes('two-new'), 'second diff');

    expect(signals[0]?.aborted).toBe(true);
    await act(async () => {
      firstDiff.resolve(jsonResponse(readyDiff('one.ts', 'one-old', 'one-new')));
    });
    await act(async () => {
      await new Promise<void>(resolve => {
        setTimeout(resolve, 0);
      });
    });

    expect(host.textContent).toContain('two.ts');
    expect(host.textContent).toContain('two-new');
    expect(host.textContent).not.toContain('one-new');
  });

  test('starting another reload aborts the earlier changes request', async () => {
    const pendingChanges = createDeferred<Response>();
    let pendingSignal: AbortSignal | undefined;
    fetchSpy = mockGitRoutes({
      onChanges: (call, init) => {
        if (call === 1) {
          return {
            files: [{ path: 'one.ts', status: 'M' }],
            revision: REVISION_A,
          };
        }
        if (call === 2) {
          pendingSignal = init?.signal ?? undefined;
          return pendingChanges.promise;
        }
        return {
          files: [{ path: 'two.ts', status: 'A' }],
          revision: REVISION_B,
        };
      },
    });

    await renderTab('run-1');
    await waitFor(() => host.textContent?.includes('one.ts'), 'initial list');
    await act(async () => {
      requireButton('Reload').click();
    });
    await waitFor(() => pendingSignal !== undefined, 'pending changes signal');
    await act(async () => {
      requireButton('Reload').click();
    });

    expect(pendingSignal?.aborted).toBe(true);
    await waitFor(
      () => (host.textContent ?? '').includes('Changed on disk — Reload'),
      'replacement candidate'
    );
  });

  test('Cancel aborts the request, removes the skeleton, clears selection, and focuses the list', async () => {
    const pendingDiff = createDeferred<Response>();
    let diffSignal: AbortSignal | undefined;
    fetchSpy = mockGitRoutes({
      onChanges: () => ({
        files: [{ path: 'src/a.ts', status: 'M' }],
        revision: REVISION_A,
      }),
      onDiff: (_url, _call, init) => {
        diffSignal = init?.signal ?? undefined;
        return pendingDiff.promise;
      },
    });

    await renderTab('run-1');
    await waitFor(() => host.textContent?.includes('src/a.ts'), 'list');
    await clickOption('src/a.ts');
    await waitFor(() => host.querySelector('.animate-pulse') !== null, 'loading skeleton');

    await act(async () => {
      requireButton('Cancel').click();
    });

    expect(diffSignal?.aborted).toBe(true);
    expect(host.querySelector('.animate-pulse')).toBeNull();
    expect(host.querySelector('[aria-label="Close"]')).toBeNull();
    expect(host.querySelector('[role="option"][aria-selected="true"]')).toBeNull();
    expect(host.textContent).toContain('src/a.ts');
    expect(win.document.activeElement?.getAttribute('role')).toBe('listbox');
  });

  test('Escape closes any viewer state and returns focus to the listbox', async () => {
    fetchSpy = mockGitRoutes({
      onChanges: () => ({
        files: [{ path: 'src/a.ts', status: 'M' }],
        revision: REVISION_A,
      }),
      onDiff: () => jsonResponse(readyDiff('src/a.ts', 'old-line', 'new-line')),
    });

    await renderTab('run-1');
    await waitFor(() => host.textContent?.includes('src/a.ts'), 'list');
    await clickOption('src/a.ts');
    await waitFor(() => (host.textContent ?? '').includes('Before'), 'diff');

    await act(async () => {
      requireListbox().dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })
      );
    });

    expect(host.querySelector('[aria-label="Before"]')).toBeNull();
    expect(host.querySelector('[aria-label="Close"]')).toBeNull();
    expect(win.document.activeElement?.getAttribute('role')).toBe('listbox');
  });

  test('a file 500 keeps the list and filename, shows quiet Reload, and retry replaces only the viewer', async () => {
    fetchSpy = mockGitRoutes({
      onChanges: () => ({
        files: [{ path: 'src/a.ts', status: 'M' }],
        revision: REVISION_A,
      }),
      onDiff: (_url, call) =>
        call === 1
          ? new Response('fail', { status: 500 })
          : jsonResponse(readyDiff('src/a.ts', 'old-line', 'new-line')),
    });

    await renderTab('run-1');
    await waitFor(() => host.textContent?.includes('src/a.ts'), 'list');
    await clickOption('src/a.ts');
    await waitFor(
      () => (host.textContent ?? '').includes('Could not open this file.'),
      'quiet error'
    );

    expect(host.textContent).toContain('src/a.ts');
    expect(host.textContent).not.toContain('Error:');
    const viewerReload = Array.from(host.querySelectorAll('button')).filter(
      button => button.textContent === 'Reload'
    );
    expect(viewerReload.length).toBeGreaterThan(1);

    await act(async () => {
      viewerReload[viewerReload.length - 1]?.click();
    });
    await waitFor(() => (host.textContent ?? '').includes('Before'), 'retried diff');

    expect(host.textContent).toContain('src/a.ts');
    expect(host.textContent).not.toContain('Could not refresh changes.');
    expect(calledUrls(fetchSpy).filter(url => url.includes('/git/changes'))).toHaveLength(1);
  });

  test('CAP-6 keeps the frozen list and follows container versus no-checkout Reload', async () => {
    fetchSpy = mockGitRoutes({
      onChanges: () => ({
        files: [
          { path: 'boxed.ts', status: 'M' },
          { path: 'missing.ts', status: 'A' },
        ],
        revision: REVISION_A,
      }),
      onDiff: () => jsonResponse({ emptyReason: 'container' }),
      onFile: () => jsonResponse({ emptyReason: 'no_checkout' }),
    });

    await renderTab('run-1');
    await waitFor(() => host.textContent?.includes('missing.ts'), 'both files');
    await clickOption('boxed.ts');
    await waitFor(
      () => (host.textContent ?? '').includes("This run's files aren't available on the host."),
      'container copy'
    );

    expect(host.textContent).toContain('boxed.ts');
    expect(host.textContent).toContain('missing.ts');
    const containerReloads = Array.from(host.querySelectorAll('button')).filter(
      button => button.textContent === 'Reload'
    );
    expect(containerReloads).toHaveLength(1);

    await clickOption('missing.ts');
    await waitFor(
      () => (host.textContent ?? '').includes("This run's checkout isn't available right now."),
      'no_checkout copy'
    );
    expect(host.textContent).toContain('boxed.ts');
    const checkoutReloads = Array.from(host.querySelectorAll('button')).filter(
      button => button.textContent === 'Reload'
    );
    expect(checkoutReloads.length).toBeGreaterThan(1);
  });

  test('a NUL M response probes worktree bytes and renders a Download link whose GET returns them', async () => {
    const bytes = new Uint8Array([0, 1, 2, 3]);
    fetchSpy = mockGitRoutes({
      onChanges: () => ({
        files: [{ path: 'blob.bin', status: 'M' }],
        revision: REVISION_A,
      }),
      onDiff: () => jsonResponse(binaryDiff('blob.bin')),
      onFile: url => {
        if (!url.includes('source=worktree')) throw new Error(`Unexpected file URL ${url}`);
        return binaryFileResponse(bytes, HASH_A);
      },
    });

    await renderTab('run-1');
    await waitFor(() => host.textContent?.includes('blob.bin'), 'list');
    await clickOption('blob.bin');
    await waitFor(
      () => (host.textContent ?? '').includes('This file is too large to open here.'),
      'binary copy'
    );

    expect(host.querySelector('[aria-label="Before"]')).toBeNull();
    expect(host.querySelector('pre')).toBeNull();
    const link = host.querySelector('a');
    expect(link?.textContent).toBe('Download');
    expect(link?.getAttribute('href')).toBe(
      '/api/workflows/runs/run-1/git/file/blob.bin?source=worktree&download=1'
    );

    const downloaded = await fetch(link?.getAttribute('href') ?? '');
    expect(new Uint8Array(await downloaded.arrayBuffer())).toEqual(bytes);
  });

  test('Reload re-fetches the list and selected file without mutating displayed snapshots', async () => {
    fetchSpy = mockGitRoutes({
      onChanges: call =>
        call === 1
          ? { files: [{ path: 'src/a.ts', status: 'M' }], revision: REVISION_A }
          : { files: [{ path: 'other.ts', status: 'A' }], revision: REVISION_B },
      onDiff: (_url, call) =>
        jsonResponse(
          call === 1
            ? readyDiff('src/a.ts', 'old-line', 'first-new')
            : readyDiff('src/a.ts', 'old-line', 'second-new')
        ),
    });

    await renderTab('run-1');
    await waitFor(() => host.textContent?.includes('src/a.ts'), 'list');
    await clickOption('src/a.ts');
    await waitFor(() => (host.textContent ?? '').includes('first-new'), 'first diff');

    await act(async () => {
      requireButton('Reload').click();
    });
    await waitFor(
      () => (host.textContent ?? '').includes('Changed on disk — Reload'),
      'stale affordance'
    );

    expect(host.textContent).toContain('src/a.ts');
    expect(host.textContent).toContain('first-new');
    expect(host.textContent).not.toContain('other.ts');
    expect(host.textContent).not.toContain('second-new');
  });

  test('a divergent list does not expose stale until the matching selected-file candidate finishes', async () => {
    const pendingDiff = createDeferred<Response>();
    fetchSpy = mockGitRoutes({
      onChanges: call =>
        call === 1
          ? { files: [{ path: 'src/a.ts', status: 'M' }], revision: REVISION_A }
          : { files: [{ path: 'src/a.ts', status: 'M' }], revision: REVISION_B },
      onDiff: (_url, call) =>
        call === 1
          ? jsonResponse(readyDiff('src/a.ts', 'old-line', 'first-new'))
          : pendingDiff.promise,
    });

    await renderTab('run-1');
    await waitFor(() => host.textContent?.includes('src/a.ts'), 'list');
    await clickOption('src/a.ts');
    await waitFor(() => (host.textContent ?? '').includes('first-new'), 'first diff');

    await act(async () => {
      requireButton('Reload').click();
    });
    await act(async () => {
      await new Promise<void>(resolve => {
        setTimeout(resolve, 0);
      });
    });

    expect(host.textContent).not.toContain('Changed on disk — Reload');
    expect(host.textContent).toContain('first-new');

    await act(async () => {
      pendingDiff.resolve(jsonResponse(readyDiff('src/a.ts', 'old-line', 'second-new')));
    });
    await waitFor(
      () => (host.textContent ?? '').includes('Changed on disk — Reload'),
      'stale after candidate'
    );
    expect(host.textContent).toContain('first-new');
    expect(host.textContent).not.toContain('second-new');
  });

  test('same list revision with changed selected content still shows Changed on disk — Reload', async () => {
    fetchSpy = mockGitRoutes({
      onChanges: () => ({
        files: [{ path: 'src/a.ts', status: 'M' }],
        revision: REVISION_A,
      }),
      onDiff: (_url, call) =>
        jsonResponse(
          call === 1
            ? readyDiff('src/a.ts', 'old-line', 'first-new')
            : readyDiff('src/a.ts', 'old-line', 'second-new')
        ),
    });

    await renderTab('run-1');
    await waitFor(() => host.textContent?.includes('src/a.ts'), 'list');
    await clickOption('src/a.ts');
    await waitFor(() => (host.textContent ?? '').includes('first-new'), 'first diff');

    await act(async () => {
      requireButton('Reload').click();
    });
    await waitFor(
      () => (host.textContent ?? '').includes('Changed on disk — Reload'),
      'content stale'
    );

    expect(host.textContent).toContain('first-new');
    expect(host.textContent).not.toContain('second-new');
  });

  test('accepting Changed on disk — Reload swaps both pending snapshots atomically', async () => {
    fetchSpy = mockGitRoutes({
      onChanges: call =>
        call === 1
          ? { files: [{ path: 'src/a.ts', status: 'M' }], revision: REVISION_A }
          : { files: [{ path: 'src/a.ts', status: 'M' }], revision: REVISION_B },
      onDiff: (_url, call) =>
        jsonResponse(
          call === 1
            ? readyDiff('src/a.ts', 'old-line', 'first-new')
            : readyDiff('src/a.ts', 'old-line', 'second-new')
        ),
    });

    await renderTab('run-1');
    await waitFor(() => host.textContent?.includes('src/a.ts'), 'list');
    await clickOption('src/a.ts');
    await waitFor(() => (host.textContent ?? '').includes('first-new'), 'first diff');

    await act(async () => {
      requireButton('Reload').click();
    });
    await waitFor(
      () => (host.textContent ?? '').includes('Changed on disk — Reload'),
      'stale affordance'
    );

    await act(async () => {
      requireButton('Changed on disk — Reload').click();
    });
    await waitFor(() => (host.textContent ?? '').includes('second-new'), 'accepted diff');

    expect(host.textContent).not.toContain('first-new');
    expect(host.textContent).not.toContain('Changed on disk — Reload');
  });

  test('accepting a pending list that dropped the selected path closes the viewer', async () => {
    fetchSpy = mockGitRoutes({
      onChanges: call =>
        call === 1
          ? { files: [{ path: 'old.ts', status: 'M' }], revision: REVISION_A }
          : { files: [{ path: 'new.ts', status: 'A' }], revision: REVISION_B },
      onDiff: () => jsonResponse(readyDiff('old.ts', 'old-line', 'old-new')),
    });

    await renderTab('run-1');
    await waitFor(() => host.textContent?.includes('old.ts'), 'list');
    await clickOption('old.ts');
    await waitFor(() => (host.textContent ?? '').includes('old-new'), 'diff');

    await act(async () => {
      requireButton('Reload').click();
    });
    await waitFor(
      () => (host.textContent ?? '').includes('Changed on disk — Reload'),
      'stale affordance'
    );

    await act(async () => {
      requireButton('Changed on disk — Reload').click();
    });
    await waitFor(() => (host.textContent ?? '').includes('new.ts'), 'accepted list');

    expect(host.querySelector('[aria-label="Before"]')).toBeNull();
    expect(host.querySelector('[aria-label="Close"]')).toBeNull();
    expect(host.textContent).toContain('Select a file to inspect');
  });

  test('accepting a pending list with a changed status updates the selected file and mode together', async () => {
    fetchSpy = mockGitRoutes({
      onChanges: call =>
        call === 1
          ? { files: [{ path: 'same.ts', status: 'A' }], revision: REVISION_A }
          : { files: [{ path: 'same.ts', status: 'M' }], revision: REVISION_B },
      onDiff: () => jsonResponse(readyDiff('same.ts', 'old-line', 'now-modified')),
      onFile: () => textFileResponse('added-body', HASH_A),
    });

    await renderTab('run-1');
    await waitFor(() => host.textContent?.includes('same.ts'), 'list');
    await clickOption('same.ts');
    await waitFor(() => (host.textContent ?? '').includes('added-body'), 'added text');

    await act(async () => {
      requireButton('Reload').click();
    });
    await waitFor(
      () => (host.textContent ?? '').includes('Changed on disk — Reload'),
      'stale affordance'
    );
    expect(host.textContent).toContain('added-body');
    expect(host.querySelector('[aria-label="Before"]')).toBeNull();

    await act(async () => {
      requireButton('Changed on disk — Reload').click();
    });
    await waitFor(() => (host.textContent ?? '').includes('now-modified'), 'modified diff');

    expect(host.textContent).not.toContain('added-body');
    expect(host.querySelector('[aria-label="Before"]')).not.toBeNull();
    expect(host.querySelector('[aria-label="After"]')).not.toBeNull();
  });

  test('accepting a same-hash binary status change updates the download source', async () => {
    fetchSpy = mockGitRoutes({
      onChanges: call =>
        call === 1
          ? { files: [{ path: 'same.bin', status: 'M' }], revision: REVISION_A }
          : { files: [{ path: 'same.bin', status: 'D' }], revision: REVISION_B },
      onDiff: () => jsonResponse(binaryDiff('same.bin')),
      onFile: url => {
        if (!url.includes('same.bin')) throw new Error(`Unexpected file URL ${url}`);
        return binaryFileResponse(new Uint8Array([0, 1, 2]), HASH_A);
      },
    });

    await renderTab('run-1');
    await waitFor(() => host.textContent?.includes('same.bin'), 'binary file');
    await clickOption('same.bin');
    await waitFor(
      () => (host.textContent ?? '').includes('This file is too large to open here.'),
      'binary viewer'
    );
    expect(host.querySelector('a')?.getAttribute('href')).toContain('source=worktree');

    await act(async () => {
      requireButton('Reload').click();
    });
    await waitFor(
      () => (host.textContent ?? '').includes('Changed on disk — Reload'),
      'status divergence'
    );
    await act(async () => {
      requireButton('Changed on disk — Reload').click();
    });

    expect(host.querySelector('[role="option"]')?.textContent).toContain('D');
    expect(host.querySelector('a')?.getAttribute('href')).toContain('source=head');
  });

  test('accepting a pending list after opening another file keeps its status-keyed viewer atomic', async () => {
    fetchSpy = mockGitRoutes({
      onChanges: call =>
        call === 1
          ? {
              files: [
                { path: 'first.ts', status: 'A' },
                { path: 'second.ts', status: 'M' },
              ],
              revision: REVISION_A,
            }
          : {
              files: [
                { path: 'first.ts', status: 'A' },
                { path: 'second.ts', status: 'D' },
              ],
              revision: REVISION_B,
            },
      onDiff: () => jsonResponse(readyDiff('second.ts', 'old-line', 'modified-line')),
      onFile: url => {
        if (url.includes('first.ts') && url.includes('source=worktree')) {
          return textFileResponse('first-body', HASH_A);
        }
        if (url.includes('second.ts') && url.includes('source=head')) {
          return textFileResponse('deleted-body', HASH_B);
        }
        throw new Error(`Unexpected file URL ${url}`);
      },
    });

    await renderTab('run-1');
    await waitFor(() => host.textContent?.includes('second.ts'), 'both files');
    await clickOption('first.ts');
    await waitFor(() => (host.textContent ?? '').includes('first-body'), 'first viewer');
    await act(async () => {
      requireButton('Reload').click();
    });
    await waitFor(
      () => (host.textContent ?? '').includes('Changed on disk — Reload'),
      'list divergence'
    );

    await clickOption('second.ts');
    await waitFor(
      () => (host.textContent ?? '').includes('modified-line'),
      'displayed status viewer'
    );
    const activeFetchSpy = fetchSpy;
    if (!activeFetchSpy) throw new Error('Missing fetch spy');
    await waitFor(
      () =>
        calledUrls(activeFetchSpy).some(
          url => url.includes('second.ts') && url.includes('source=head')
        ),
      'matching pending status viewer'
    );
    await waitFor(
      () => (host.textContent ?? '').includes('Changed on disk — Reload'),
      'atomic stale affordance'
    );
    await act(async () => {
      requireButton('Changed on disk — Reload').click();
    });
    await waitFor(
      () => (host.textContent ?? '').includes('deleted-body'),
      'accepted deleted viewer'
    );

    expect(host.querySelector('[aria-label="Before"]')).toBeNull();
    expect(host.querySelector('[role="option"][aria-selected="true"]')?.textContent).toContain('D');
  });

  test('a mocked viewport below 900 yields list-above-viewer and before-over-after', async () => {
    stackedViewport = true;
    fetchSpy = mockGitRoutes({
      onChanges: () => ({
        files: [{ path: 'src/a.ts', status: 'M' }],
        revision: REVISION_A,
      }),
      onDiff: () => jsonResponse(readyDiff('src/a.ts', 'old-line', 'new-line')),
    });

    await renderTab('run-1');
    await waitFor(() => host.textContent?.includes('src/a.ts'), 'list');
    await clickOption('src/a.ts');
    await waitFor(() => (host.textContent ?? '').includes('Before'), 'diff');

    expect(groupFlexDirection()).toBe('column');
    const panes = host.querySelector('[aria-label="Before"]')?.parentElement?.parentElement;
    expect(panes?.className).toContain('flex-col');
    expect(panes?.className).not.toContain('flex-row');
  });

  test('a 900-pixel viewport yields the horizontal list/viewer split', async () => {
    stackedViewport = false;
    fetchSpy = mockGitRoutes({
      onChanges: () => ({
        files: [{ path: 'src/a.ts', status: 'M' }],
        revision: REVISION_A,
      }),
      onDiff: () => jsonResponse(readyDiff('src/a.ts', 'old-line', 'new-line')),
    });

    await renderTab('run-1');
    await waitFor(() => host.textContent?.includes('src/a.ts'), 'list');
    await clickOption('src/a.ts');
    await waitFor(() => (host.textContent ?? '').includes('Before'), 'diff');

    expect(groupFlexDirection()).toBe('row');
    const panes = host.querySelector('[aria-label="Before"]')?.parentElement?.parentElement;
    expect(panes?.className).toContain('flex-row');
  });

  test('the resizable separator is keyboard focusable', async () => {
    fetchSpy = mockGitRoutes({
      onChanges: () => ({
        files: [{ path: 'src/a.ts', status: 'M' }],
        revision: REVISION_A,
      }),
    });

    await renderTab('run-1');
    await waitFor(() => host.textContent?.includes('src/a.ts'), 'list');

    const separator = host.querySelector('[role="separator"]');
    if (!(separator instanceof HTMLElement)) {
      throw new Error('Missing resizable separator');
    }
    expect(separator.tabIndex).toBe(0);
    await act(async () => {
      separator.focus();
    });
    expect(win.document.activeElement?.getAttribute('role')).toBe('separator');
  });

  test('Load more appends text with the opaque cursor and leaves the Changes list unchanged', async () => {
    fetchSpy = mockGitRoutes({
      onChanges: () => ({
        files: [{ path: 'big.txt', status: 'A' }],
        revision: REVISION_A,
      }),
      onFile: (_url, call) =>
        call === 1
          ? presentedFileResponse('first\n', HASH_A, {
              'Content-Type': 'text/plain; charset=utf-8',
              'X-Archon-Git-Truncated': 'true',
              'X-Archon-Git-Cursor': 'opaque+next',
              'X-Archon-Git-Byte-Length': '13',
              'X-Archon-Git-Presentation': 'text',
            })
          : presentedFileResponse('second\n', HASH_A, {
              'Content-Type': 'text/plain; charset=utf-8',
              'X-Archon-Git-Presentation': 'text',
              'X-Archon-Git-Byte-Length': '13',
            }),
    });
    await renderTab('run-1');
    await waitFor(() => host.textContent?.includes('big.txt'), 'file list');
    await clickOption('big.txt');
    await waitFor(() => host.textContent?.includes('Load more'), 'Load more');
    await act(async () => {
      requireButton('Load more').click();
    });
    await waitFor(() => host.textContent?.includes('second'), 'second page');
    expect(host.textContent).toContain('first');
    expect(host.querySelectorAll('[role="option"]')).toHaveLength(1);
    expect(calledUrls(fetchSpy).at(-1)).toContain('cursor=opaque%2Bnext');
  });

  test('Cancel during Load more aborts only the page and keeps painted text', async () => {
    const pending = createDeferred<Response>();
    let pageSignal: AbortSignal | undefined;
    fetchSpy = mockGitRoutes({
      onChanges: () => ({
        files: [{ path: 'big.txt', status: 'A' }],
        revision: REVISION_A,
      }),
      onFile: (_url, call, init) => {
        if (call === 1) {
          return presentedFileResponse('painted\n', HASH_A, {
            'Content-Type': 'text/plain; charset=utf-8',
            'X-Archon-Git-Truncated': 'true',
            'X-Archon-Git-Cursor': 'next',
            'X-Archon-Git-Byte-Length': '20',
            'X-Archon-Git-Presentation': 'text',
          });
        }
        pageSignal = init?.signal ?? undefined;
        return pending.promise;
      },
    });
    await renderTab('run-1');
    await waitFor(() => host.textContent?.includes('big.txt'), 'file list');
    await clickOption('big.txt');
    await waitFor(() => host.textContent?.includes('Load more'), 'Load more');
    await act(async () => {
      requireButton('Load more').click();
    });
    await waitFor(() => host.textContent?.includes('Cancel'), 'page Cancel');
    await act(async () => {
      requireButton('Cancel').click();
    });
    expect(pageSignal?.aborted).toBe(true);
    expect(host.textContent).toContain('painted');
    expect(host.querySelector('[aria-label="Close"]')).not.toBeNull();
    expect(host.textContent).not.toContain('Select a file to inspect');
  });

  test('an SVG M fallback renders through img and revokes its object URL on close', async () => {
    fetchSpy = mockGitRoutes({
      onChanges: () => ({
        files: [{ path: 'image.svg', status: 'M' }],
        revision: REVISION_A,
      }),
      onDiff: () =>
        jsonResponse({
          ...readyDiff('image.svg', 'old', 'new'),
          hunks: [],
          fileFallback: true,
        }),
      onFile: () =>
        presentedFileResponse(Buffer.from('<svg></svg>'), HASH_A, {
          'Content-Type': 'image/svg+xml',
          'X-Archon-Git-Presentation': 'image',
          'X-Archon-Git-Media-Type': 'image/svg+xml',
          'X-Archon-Git-Byte-Length': '11',
        }),
    });
    await renderTab('run-1');
    await waitFor(() => host.textContent?.includes('image.svg'), 'file list');
    await clickOption('image.svg');
    await waitFor(() => host.querySelector('img') !== null, 'inline image');
    expect(host.querySelector('img')?.getAttribute('src')).toBe('blob:archon-image');
    expect(host.querySelector('a')?.getAttribute('href')).toContain('download=1');
    await act(async () => {
      requireButton('Close').click();
    });
    expect(createObjectUrlMock).toHaveBeenCalledTimes(1);
    expect(revokeObjectUrlMock).toHaveBeenCalledWith('blob:archon-image');
  });

  test('selecting another image revokes the prior object URL before replacing it', async () => {
    let objectUrlIndex = 0;
    createObjectUrlMock.mockImplementation((_blob: Blob): string => {
      objectUrlIndex += 1;
      return 'blob:image-' + String(objectUrlIndex);
    });
    fetchSpy = mockGitRoutes({
      onChanges: () => ({
        files: [
          { path: 'one.png', status: 'A' },
          { path: 'two.png', status: 'A' },
        ],
        revision: REVISION_A,
      }),
      onFile: url =>
        presentedFileResponse(
          Uint8Array.from([0x89, 0x50]),
          url.includes('one.png') ? HASH_A : HASH_B,
          {
            'Content-Type': 'image/png',
            'X-Archon-Git-Presentation': 'image',
            'X-Archon-Git-Media-Type': 'image/png',
            'X-Archon-Git-Byte-Length': '2',
          }
        ),
    });
    await renderTab('run-1');
    await waitFor(() => host.textContent?.includes('two.png'), 'file list');
    await clickOption('one.png');
    await waitFor(
      () => host.querySelector('img')?.getAttribute('src') === 'blob:image-1',
      'first image'
    );
    await clickOption('two.png');
    await waitFor(
      () => host.querySelector('img')?.getAttribute('src') === 'blob:image-2',
      'second image'
    );
    expect(revokeObjectUrlMock).toHaveBeenCalledWith('blob:image-1');
  });

  test('a NUL M fallback renders hex and Download without diff or highlighting', async () => {
    fetchSpy = mockGitRoutes({
      onChanges: () => ({
        files: [{ path: 'blob.bin', status: 'M' }],
        revision: REVISION_A,
      }),
      onDiff: () => jsonResponse({ ...binaryDiff('blob.bin'), fileFallback: true }),
      onFile: () =>
        presentedFileResponse(Uint8Array.from([0, 0x41, 0xff]), HASH_A, {
          'Content-Type': 'application/octet-stream',
          'X-Archon-Git-Presentation': 'hex',
          'X-Archon-Git-Byte-Length': '3',
        }),
    });
    await renderTab('run-1');
    await waitFor(() => host.textContent?.includes('blob.bin'), 'file list');
    await clickOption('blob.bin');
    await waitFor(() => host.textContent?.includes('00000000'), 'hex');
    expect(host.querySelector('[aria-label="Before"]')).toBeNull();
    expect(host.querySelector('.hljs')).toBeNull();
    expect(host.querySelector('a')?.getAttribute('href')).toContain('download=1');
  });

  test('a binary-to-text M fallback renders the raw worktree text', async () => {
    fetchSpy = mockGitRoutes({
      onChanges: () => ({
        files: [{ path: 'became-text.txt', status: 'M' }],
        revision: REVISION_A,
      }),
      onDiff: () => jsonResponse({ ...binaryDiff('became-text.txt'), fileFallback: true }),
      onFile: () =>
        presentedFileResponse('plain text now\n', HASH_A, {
          'Content-Type': 'text/plain; charset=utf-8',
          'X-Archon-Git-Presentation': 'text',
          'X-Archon-Git-Byte-Length': '15',
        }),
    });
    await renderTab('run-1');
    await waitFor(() => host.textContent?.includes('became-text.txt'), 'file list');
    await clickOption('became-text.txt');
    await waitFor(() => host.textContent?.includes('plain text now'), 'text fallback');
    expect(host.querySelector('[aria-label="Before"]')).toBeNull();
    expect(host.querySelector('.hljs')).not.toBeNull();
    expect(calledUrls(fetchSpy).at(-1)).toContain('source=worktree');
  });

  test('download-only renders no pre body', async () => {
    fetchSpy = mockGitRoutes({
      onChanges: () => ({
        files: [{ path: 'huge.dat', status: 'A' }],
        revision: REVISION_A,
      }),
      onFile: () =>
        presentedFileResponse(null, HASH_A, {
          'Content-Type': 'application/octet-stream',
          'Content-Disposition': 'attachment; filename="download"',
          'X-Archon-Git-Presentation': 'download',
          'X-Archon-Git-Byte-Length': '52428801',
        }),
    });
    await renderTab('run-1');
    await waitFor(() => host.textContent?.includes('huge.dat'), 'file list');
    await clickOption('huge.dat');
    await waitFor(
      () => host.textContent?.includes('This file is too large to open here.'),
      'download-only'
    );
    expect(host.querySelector('pre')).toBeNull();
    expect(host.querySelector('a')?.getAttribute('href')).toContain('download=1');
  });

  test('appended diff hunks do not make an unchanged first page look stale', async () => {
    fetchSpy = mockGitRoutes({
      onChanges: () => ({
        files: [{ path: 'large.ts', status: 'M' }],
        revision: REVISION_A,
      }),
      onDiff: (_url, call) => jsonResponse(call === 2 ? SECOND_DIFF_PAGE : FIRST_DIFF_PAGE),
    });
    await renderTab('run-1');
    await waitFor(() => host.textContent?.includes('large.ts'), 'file list');
    await clickOption('large.ts');
    await waitFor(() => host.textContent?.includes('Load more'), 'Load more');
    await act(async () => {
      requireButton('Load more').click();
    });
    await waitFor(() => host.textContent?.includes('second'), 'second hunk page');
    await act(async () => {
      requireButton('Reload').click();
    });
    const activeFetchSpy = fetchSpy;
    if (!activeFetchSpy) throw new Error('Missing fetch spy');
    await waitFor(
      () => calledUrls(activeFetchSpy).filter(url => url.includes('/git/diff')).length === 3,
      'fresh first hunk page'
    );
    expect(host.textContent).toContain('second');
    expect(host.textContent).not.toContain('Changed on disk — Reload');
  });

  test('a stale text cursor keeps painted content and enters the existing Reload flow', async () => {
    fetchSpy = mockGitRoutes({
      onChanges: () => ({
        files: [{ path: 'large.txt', status: 'A' }],
        revision: REVISION_A,
      }),
      onFile: (_url, call) => {
        if (call === 1) {
          return presentedFileResponse('painted\n', HASH_A, {
            'Content-Type': 'text/plain; charset=utf-8',
            'X-Archon-Git-Truncated': 'true',
            'X-Archon-Git-Cursor': 'old-version',
            'X-Archon-Git-Byte-Length': '20',
            'X-Archon-Git-Presentation': 'text',
          });
        }
        if (call === 2) {
          return new Response(JSON.stringify({ error: 'File changed' }), {
            status: 409,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        return presentedFileResponse('fresh\n', HASH_B, {
          'Content-Type': 'text/plain; charset=utf-8',
          'X-Archon-Git-Truncated': 'true',
          'X-Archon-Git-Cursor': 'new-version',
          'X-Archon-Git-Byte-Length': '21',
          'X-Archon-Git-Presentation': 'text',
        });
      },
    });
    await renderTab('run-1');
    await waitFor(() => host.textContent?.includes('large.txt'), 'file list');
    await clickOption('large.txt');
    await waitFor(() => host.textContent?.includes('Load more'), 'Load more');
    await act(async () => {
      requireButton('Load more').click();
    });
    await waitFor(() => host.textContent?.includes('Changed on disk — Reload'), 'stale affordance');
    expect(host.textContent).toContain('painted');
    expect(host.textContent).not.toContain('fresh');
  });

  test('.env remains ordinary highlighted text', async () => {
    fetchSpy = mockGitRoutes({
      onChanges: () => ({
        files: [{ path: '.env', status: 'A' }],
        revision: REVISION_A,
      }),
      onFile: () =>
        presentedFileResponse('TOKEN=visible\n', HASH_A, {
          'Content-Type': 'text/plain; charset=utf-8',
          'X-Archon-Git-Presentation': 'text',
          'X-Archon-Git-Byte-Length': '14',
        }),
    });
    await renderTab('run-1');
    await waitFor(() => host.textContent?.includes('.env'), 'file list');
    await clickOption('.env');
    await waitFor(() => host.querySelector('.hljs') !== null, 'highlighted env');
    expect(host.textContent).toContain('TOKEN');
  });

  test('shows a region-empty History for a ready repository with zero commits', async () => {
    fetchSpy = mockGitRoutes({
      onChanges: () => ({ files: [], revision: REVISION_A }),
      onLog: () => EMPTY_GIT_LOG,
    });

    await renderTab('run-1');
    await waitFor(() => host.textContent?.includes('No commits yet'), 'empty History');

    expect(host.textContent).toContain('Changes');
    expect(host.textContent).toContain('History');
    expect(host.textContent).not.toContain('No worktree available');
  });

  test('treats container CAP-6 from either read as a whole-tab state', async () => {
    fetchSpy = mockGitRoutes({
      onChanges: () => ({ files: [], revision: REVISION_A }),
      onLog: () => ({
        emptyReason: 'container',
        commits: [],
        revision: '',
        truncated: false,
      }),
    });

    await renderTab('run-1');
    await waitFor(() => host.textContent?.includes('No files to show'), 'container CAP-6');

    expect(host.textContent).not.toContain('History');
    expect(
      Array.from(host.querySelectorAll('button')).some(button => button.textContent === 'Reload')
    ).toBe(false);
  });

  test('operates History from the keyboard without opening a diff or file in Story 2.1', async () => {
    const secondCommit = {
      ...HISTORY_COMMIT,
      oid: '2'.repeat(40),
      subject: 'second history subject',
    };
    fetchSpy = mockGitRoutes({
      onChanges: () => ({ files: [], revision: REVISION_A }),
      onLog: () => ({
        commits: [HISTORY_COMMIT, secondCommit],
        revision: REVISION_A,
        truncated: false,
      }),
    });

    await renderTab('run-1');
    await waitFor(() => host.textContent?.includes(HISTORY_COMMIT.subject), 'commit row');
    const history = host.querySelector('[role="listbox"][aria-label="Commit history"]');
    if (!(history instanceof HTMLElement)) throw new Error('Missing History listbox');
    expect(history.getAttribute('aria-activedescendant')).toBe('sc-history-commit-0');

    await act(async () => {
      history.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    });
    expect(history.getAttribute('aria-activedescendant')).toBe('sc-history-commit-1');
    expect(host.querySelector('#sc-history-commit-1')?.getAttribute('aria-selected')).toBe('true');

    await act(async () => {
      history.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    });

    expect(calledUrls(fetchSpy).filter(url => url.includes('/git/diff'))).toEqual([]);
    expect(calledUrls(fetchSpy).filter(url => url.includes('/git/file/'))).toEqual([]);
  });

  test('freezes a divergent History until the shared stale action is accepted', async () => {
    const changedCommit = {
      ...HISTORY_COMMIT,
      oid: '2'.repeat(40),
      subject: 'changed history subject',
    };
    fetchSpy = mockGitRoutes({
      onChanges: () => ({ files: [], revision: REVISION_A }),
      onLog: call =>
        call === 1
          ? { commits: [HISTORY_COMMIT], revision: REVISION_A, truncated: false }
          : { commits: [changedCommit], revision: REVISION_B, truncated: false },
    });

    await renderTab('run-1');
    await waitFor(() => host.textContent?.includes(HISTORY_COMMIT.subject), 'initial History');
    await act(async () => {
      requireButton('Reload').click();
    });
    await waitFor(
      () => host.textContent?.includes('Changed on disk — Reload'),
      'History divergence affordance'
    );

    expect(host.textContent).toContain(HISTORY_COMMIT.subject);
    expect(host.textContent).not.toContain(changedCommit.subject);

    await act(async () => {
      requireButton('Changed on disk — Reload').click();
    });
    await waitFor(() => host.textContent?.includes(changedCommit.subject), 'accepted History');

    expect(calledUrls(fetchSpy).filter(url => url.includes('/git/changes'))).toHaveLength(2);
    expect(calledUrls(fetchSpy).filter(url => url.includes('/git/log'))).toHaveLength(2);
  });

  test('a 3000-hunk response mounts only the virtual window', async () => {
    const response: GitReadyDiffResponse = {
      path: 'virtual.ts',
      status: 'M',
      scope: 'now',
      ref: 'live',
      cursor: '',
      truncated: false,
      binary: false,
      fileFallback: false,
      hunks: Array.from({ length: 3000 }, (_unused, index) => ({
        header: '@@ -0,0 +' + String(index + 1) + ' @@',
        oldStart: 0,
        oldLines: 0,
        newStart: index + 1,
        newLines: 1,
        changes: [{ type: 'insert' as const, content: 'line', newLine: index + 1 }],
      })),
    };
    fetchSpy = mockGitRoutes({
      onChanges: () => ({
        files: [{ path: 'virtual.ts', status: 'M' }],
        revision: REVISION_A,
      }),
      onDiff: () => jsonResponse(response),
    });
    await renderTab('run-1');
    await waitFor(() => host.textContent?.includes('virtual.ts'), 'file list');
    await clickOption('virtual.ts');
    await waitFor(() => host.querySelectorAll('.sc-virtual-hunk').length > 0, 'virtual hunks');
    expect(host.querySelectorAll('.sc-virtual-hunk').length).toBeLessThan(3000);
  });
});
