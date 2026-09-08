process.env.NODE_ENV = 'development';

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import type { Root } from 'react-dom/client';

import { installHappyDom, restoreHappyDom } from '../test/install-happy-dom';

const react = await import('react');
const reactDomClient = await import('react-dom/client');
const consoleResizable = await import('./console-resizable');

const act = react.act;
const createElement = react.createElement;
const createRoot = reactDomClient.createRoot;

describe('console-resizable', () => {
  let win: ReturnType<typeof installHappyDom>;
  let host: Element;
  let root: Root;

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
    win.close();
    restoreHappyDom();
  });

  // Production defect: a numeric defaultSize on ConsolePanel must fail type-check;
  // omitting ConsolePanelSeparator must fail this DOM assertion (no role=separator).
  test('renders percent-sized panels with a separator', async () => {
    await act(async () => {
      root.render(
        createElement(
          consoleResizable.ConsolePanelGroup,
          { orientation: 'horizontal', style: { height: 200, width: 400 } },
          createElement(
            consoleResizable.ConsolePanel,
            { id: 'view', defaultSize: '60%', minSize: '30%' },
            'view'
          ),
          createElement(consoleResizable.ConsolePanelSeparator, { id: 'split' }),
          createElement(
            consoleResizable.ConsolePanel,
            { id: 'room', defaultSize: '40%', minSize: '24%', maxSize: '60%' },
            'room'
          )
        )
      );
    });

    expect(host.querySelectorAll('[data-panel]').length).toBe(2);
    expect(host.querySelector('[role="separator"]')).not.toBeNull();
  });
});
