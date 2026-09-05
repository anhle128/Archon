import { afterEach, beforeEach, describe, expect, spyOn, test, type Mock } from 'bun:test';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Window } from 'happy-dom';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import type { GitChangesResponse } from '@/lib/api';

import { SourceControlTab } from '../components/workflows/source-control/source-control-tab';

const REVISION_A = 'a'.repeat(64);
const REVISION_B = 'b'.repeat(64);

function installHappyDom(): Window {
  const win = new Window({ url: 'https://localhost/' });
  const globals: Record<string, unknown> = {
    window: win,
    document: win.document,
    self: win,
    HTMLElement: win.HTMLElement,
    HTMLButtonElement: win.HTMLButtonElement,
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
    Event: win.Event,
    MouseEvent: win.MouseEvent,
    KeyboardEvent: win.KeyboardEvent,
    IS_REACT_ACT_ENVIRONMENT: true,
  };
  Object.assign(globalThis as object, globals);
  return win;
}

function mockFetchResponses(responses: readonly GitChangesResponse[]): Mock<typeof fetch> {
  let index = 0;
  return spyOn(globalThis, 'fetch').mockImplementation((async (): Promise<Response> => {
    const payload = responses[index];
    if (!payload) throw new Error(`Unexpected fetch number ${String(index + 1)}`);
    index += 1;
    return new Response(JSON.stringify(payload), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as unknown as typeof fetch);
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
  win = installHappyDom();
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
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy).toHaveBeenCalledWith('/api/workflows/runs/run%2Fone/git/changes');

    await act(async () => {
      await new Promise<void>(resolve => {
        setTimeout(resolve, 0);
      });
    });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
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
    expect(fetchSpy).toHaveBeenCalledTimes(2);
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
    expect(listbox.getAttribute('aria-activedescendant')).toBe('sc-file-0');

    await act(async () => {
      listbox.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    });

    expect(listbox.getAttribute('aria-activedescendant')).toBe('sc-file-1');
    expect(host.querySelector('#sc-file-1')?.getAttribute('aria-selected')).toBe('true');
  });
});
