process.env.NODE_ENV = 'development';

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import type { Root } from 'react-dom/client';

import type { ExecutionHeaderModel } from '@/lib/execution-room-model';
import { installHappyDom, restoreHappyDom } from '../../test/install-happy-dom';

const react = await import('react');
const reactDomClient = await import('react-dom/client');

const act = react.act;
const createElement = react.createElement;
const createRoot = reactDomClient.createRoot;

const ITERATION_TWO: ExecutionHeaderModel = {
  nodeId: 'review',
  nodeLabel: 'Review',
  executionLabel: 'Iteration 2',
  status: 'running',
  startedOffsetMs: 1500,
  durationMs: 2400,
  provider: 'openai',
  model: 'gpt-5',
  unknownScope: false,
};

describe('ConsoleRoomHeader', () => {
  let win: ReturnType<typeof installHappyDom>;
  let host: Element;
  let root: Root;
  let consoleRoomHeader: typeof import('./ConsoleRoomHeader');

  beforeEach(async () => {
    win = installHappyDom();
    const el = win.document.createElement('div');
    win.document.body.appendChild(el);
    host = el as unknown as Element;
    root = createRoot(host);
    consoleRoomHeader = await import('./ConsoleRoomHeader');
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
    });
    win.close();
    restoreHappyDom();
  });

  test('renders iteration header fields and reports select plus close', async () => {
    const selected: string[] = [];
    const closes: number[] = [];

    await act(async () => {
      root.render(
        createElement(consoleRoomHeader.ConsoleRoomHeader, {
          model: ITERATION_TWO,
          options: [
            { rowId: 'iter-1', label: 'Iteration 1' },
            { rowId: 'iter-2', label: 'Iteration 2' },
          ],
          selectedRowId: 'iter-2',
          onSelectRow: (rowId: string): void => {
            selected.push(rowId);
          },
          onClose: (): void => {
            closes.push(1);
          },
        })
      );
    });

    const text = host.textContent ?? '';
    expect(text).toContain('Review');
    expect(text).toContain('Iteration 2');
    expect(text).toContain('running');
    expect(text).toContain('+1.5s');
    expect(text).toContain('2.4s');
    expect(text).toContain('openai');
    expect(text).toContain('gpt-5');
    expect(text).not.toContain('—');
    expect(host.querySelector('header')).not.toBeNull();
    expect(host.querySelector('header')?.className).toContain('sticky');

    const select = host.querySelector('select[aria-label="Execution"]');
    if (select === null) {
      throw new Error('missing execution select');
    }
    const executionSelect = select as unknown as HTMLSelectElement;
    expect(executionSelect.value).toBe('iter-2');

    await act(async () => {
      executionSelect.value = 'iter-1';
      executionSelect.dispatchEvent(new win.Event('change', { bubbles: true }) as unknown as Event);
    });
    expect(selected).toEqual(['iter-1']);

    const close = Array.from(host.querySelectorAll('button')).find(button =>
      (button.textContent ?? '').includes('Close')
    );
    if (close === undefined) {
      throw new Error('missing Close button');
    }
    await act(async () => {
      close.click();
    });
    expect(closes).toEqual([1]);
  });

  test('omits provider, model, start, and duration when those fields are null', async () => {
    await act(async () => {
      root.render(
        createElement(consoleRoomHeader.ConsoleRoomHeader, {
          model: {
            ...ITERATION_TWO,
            status: 'completed',
            startedOffsetMs: null,
            durationMs: null,
            provider: null,
            model: null,
          },
          options: [{ rowId: 'iter-2', label: 'Iteration 2' }],
          selectedRowId: 'iter-2',
          onSelectRow: (): void => undefined,
          onClose: (): void => undefined,
        })
      );
    });

    const text = host.textContent ?? '';
    expect(text).toContain('Review');
    expect(text).toContain('Iteration 2');
    expect(text).toContain('completed');
    expect(text).not.toContain('+');
    expect(text).not.toContain('openai');
    expect(text).not.toContain('gpt-5');
    expect(text).not.toContain('1.5s');
    expect(text).not.toContain('2.4s');
  });

  test('single mode uses Back as the close label', async () => {
    const closes: number[] = [];
    await act(async () => {
      root.render(
        createElement(consoleRoomHeader.ConsoleRoomHeader, {
          model: ITERATION_TWO,
          options: [{ rowId: 'iter-2', label: 'Iteration 2' }],
          selectedRowId: 'iter-2',
          onSelectRow: (): void => undefined,
          onClose: (): void => {
            closes.push(1);
          },
          closeLabel: 'Back',
        })
      );
    });

    const back = Array.from(host.querySelectorAll('button')).find(button =>
      (button.textContent ?? '').includes('Back')
    );
    if (back === undefined) {
      throw new Error('missing Back button');
    }
    expect(host.textContent).not.toContain('Close');
    await act(async () => {
      back.click();
    });
    expect(closes).toEqual([1]);
  });
});
