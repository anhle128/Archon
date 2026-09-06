process.env.NODE_ENV = 'development';

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { renderToStaticMarkup } from 'react-dom/server';
import type { Root } from 'react-dom/client';

import type { GateChrome } from './select-room-data';
import { GateRoom } from './GateRoom';

const react = await import('react');
const reactDomClient = await import('react-dom/client');

const act = react.act;
const createElement = react.createElement;
const createRoot = reactDomClient.createRoot;

function chrome(overrides: Partial<GateChrome> = {}): GateChrome {
  return {
    gateType: 'approval',
    message: 'Ship?',
    document: null,
    decision: null,
    canDecide: false,
    showInactiveNotice: false,
    reviewUrl: null,
    ...overrides,
  };
}

function visibleText(markup: string): string {
  return markup
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#x27;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function renderStatic(overrides: Partial<GateChrome> = {}): string {
  return renderToStaticMarkup(
    <GateRoom
      nodeId="review"
      chrome={chrome(overrides)}
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

describe('GateRoom static markup', () => {
  test('renders a declared approval message in one labelled room', () => {
    const markup = renderStatic();
    expect(markup).toContain('aria-label="review room"');
    expect(visibleText(markup)).toContain('Ship?');
    expect(visibleText(markup)).not.toContain('AskHuman');
    expect(visibleText(markup)).not.toContain('awaiting');
    expect(visibleText(markup)).not.toContain('waiting-on-you');
  });

  test('renders a Plannotator document and a safe Open Plannotator link', () => {
    const markup = renderStatic({
      gateType: 'plannotator_gate',
      message: 'Review the plan',
      document: '## Spec',
      reviewUrl: 'https://plannotator.example/reviews/run-1',
    });
    expect(visibleText(markup)).toContain('Review the plan');
    expect(visibleText(markup)).toContain('## Spec');
    expect(markup).toContain('href="https://plannotator.example/reviews/run-1"');
    expect(markup).toContain('target="_blank"');
    expect(markup).toContain('rel="noopener noreferrer"');
    expect(markup).toContain('Open Plannotator');
  });

  test('omits Approve and Reject when canDecide is false', () => {
    const markup = renderStatic({ canDecide: false });
    expect(markup).not.toContain('<button');
  });

  test('renders the inactive pause warning only when requested', () => {
    const inactive = renderStatic({ showInactiveNotice: true });
    const active = renderStatic({ showInactiveNotice: false, canDecide: false });
    expect(visibleText(inactive)).toContain('Gate is not the active pause');
    expect(inactive).toContain('bg-warning/5');
    expect(visibleText(active)).not.toContain('Gate is not the active pause');
  });

  test('renders an approved decision banner without decision buttons', () => {
    const markup = renderStatic({ decision: 'approved', canDecide: false });
    expect(visibleText(markup)).toContain('Approved');
    expect(markup).not.toContain('<button');
  });

  test('renders a rejected decision banner', () => {
    const markup = renderStatic({ decision: 'rejected', canDecide: false });
    expect(visibleText(markup)).toContain('Rejected');
    expect(markup).not.toContain('<button');
  });
});

describe('GateRoom actions', () => {
  let win: Window;
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
    restoreGlobals();
  });

  async function renderGate(args: {
    chrome: GateChrome;
    onApprove: () => Promise<void>;
    onReject?: (reason?: string) => Promise<void>;
  }): Promise<void> {
    await act(async () => {
      root.render(
        createElement(GateRoom, {
          nodeId: 'review',
          chrome: args.chrome,
          onApprove: args.onApprove,
          onReject: args.onReject ?? (async (): Promise<void> => undefined),
        })
      );
    });
    await flush();
  }

  function findButton(label: string): HTMLButtonElement {
    const button = Array.from(host.querySelectorAll('button')).find(candidate =>
      (candidate.textContent ?? '').includes(label)
    );
    if (!(button instanceof HTMLButtonElement)) throw new Error('missing button: ' + label);
    return button;
  }

  async function clickButton(label: string): Promise<void> {
    await act(async () => {
      findButton(label).click();
    });
  }

  async function flushUntil(label: string, predicate: () => boolean): Promise<void> {
    for (let attempt = 0; attempt < 25; attempt++) {
      await flush();
      if (predicate()) return;
    }
    throw new Error(label + ': ' + (host.textContent ?? ''));
  }

  test('renders Approve and Reject only when canDecide is true', async () => {
    await renderGate({
      chrome: chrome({ canDecide: true }),
      onApprove: async (): Promise<void> => undefined,
    });
    expect(host.textContent).toContain('Waiting for approval');
    expect(findButton('Approve')).toBeInstanceOf(HTMLButtonElement);
    expect(findButton('Reject')).toBeInstanceOf(HTMLButtonElement);
  });

  test('invokes onApprove from the Approve button', async () => {
    let calls = 0;
    await renderGate({
      chrome: chrome({ canDecide: true }),
      onApprove: async (): Promise<void> => {
        calls += 1;
      },
    });
    await clickButton('Approve');
    await flushUntil('approve invoked', () => calls === 1);
    expect(calls).toBe(1);
  });

  test('surfaces an approval failure and re-enables the actions', async () => {
    let calls = 0;
    const onApprove = async (): Promise<void> => {
      calls++;
      throw new Error('approval failed');
    };
    await renderGate({
      chrome: {
        gateType: 'approval',
        message: 'Ship?',
        document: null,
        decision: null,
        canDecide: true,
        showInactiveNotice: false,
        reviewUrl: null,
      },
      onApprove,
    });
    await clickButton('Approve');
    await flushUntil('action error', () => (host.textContent ?? '').includes('approval failed'));
    expect(calls).toBe(1);
    expect(findButton('Approve').disabled).toBe(false);
    const alert = host.querySelector('[role="alert"]');
    expect(alert?.textContent).toBe('approval failed');
  });

  test('disables actions while an approval is pending', async () => {
    let resolveApprove!: () => void;
    const pending = new Promise<void>(resolve => {
      resolveApprove = resolve;
    });
    await renderGate({
      chrome: chrome({ canDecide: true }),
      onApprove: async (): Promise<void> => pending,
    });
    await act(async () => {
      findButton('Approve').click();
    });
    await flushUntil('pending', () => findButton('Approve').disabled);
    expect(findButton('Approve').disabled).toBe(true);
    expect(findButton('Reject').disabled).toBe(true);
    await act(async () => {
      resolveApprove();
    });
    await flushUntil('idle', () => !findButton('Approve').disabled);
    expect(findButton('Approve').disabled).toBe(false);
  });
});
