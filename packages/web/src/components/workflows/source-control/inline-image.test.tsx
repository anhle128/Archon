process.env.NODE_ENV = 'development';

import { afterEach, beforeEach, expect, mock, test } from 'bun:test';
import { Window } from 'happy-dom';
import type { Root } from 'react-dom/client';

const react = await import('react');
const reactDomClient = await import('react-dom/client');
const inlineImage = await import('./inline-image');

const act = react.act;
const createRoot = reactDomClient.createRoot;
const inlineImageComponent = inlineImage.InlineImage;

let win: Window;
let host: Element;
let root: Root | null;
const createObjectURL = mock((_blob: Blob): string => 'blob:first');
const revokeObjectURL = mock((_url: string): void => undefined);

beforeEach(() => {
  win = new Window({ url: 'https://localhost/' });
  Object.assign(globalThis as object, {
    window: win,
    document: win.document,
    HTMLElement: win.HTMLElement,
    Element: win.Element,
    Node: win.Node,
    Blob: win.Blob,
    URL: win.URL,
    IS_REACT_ACT_ENVIRONMENT: true,
  });
  createObjectURL.mockReset();
  createObjectURL.mockReturnValueOnce('blob:first').mockReturnValueOnce('blob:second');
  revokeObjectURL.mockReset();
  Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: createObjectURL });
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: revokeObjectURL });
  const element = win.document.createElement('div');
  win.document.body.append(element);
  host = element as unknown as Element;
  root = createRoot(host);
});

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  win.close();
});

test('replaces and revokes object URLs when bytes change and on unmount', async () => {
  const mountedRoot = root;
  if (!mountedRoot) throw new Error('Missing React root');
  await act(async () => {
    mountedRoot.render(
      react.createElement(inlineImageComponent, {
        bytes: Uint8Array.from([1]),
        mediaType: 'image/png',
      })
    );
  });
  expect(host.querySelector('img')?.getAttribute('src')).toBe('blob:first');
  await act(async () => {
    mountedRoot.render(
      react.createElement(inlineImageComponent, {
        bytes: Uint8Array.from([2]),
        mediaType: 'image/png',
      })
    );
  });
  expect(revokeObjectURL).toHaveBeenCalledWith('blob:first');
  expect(host.querySelector('img')?.getAttribute('src')).toBe('blob:second');
  await act(async (): Promise<void> => {
    mountedRoot.unmount();
  });
  root = null;
  expect(revokeObjectURL).toHaveBeenCalledWith('blob:second');
});
