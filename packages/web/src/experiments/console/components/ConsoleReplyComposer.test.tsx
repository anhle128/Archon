process.env.NODE_ENV = 'development';

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import type { Root } from 'react-dom/client';

import { installHappyDom, restoreHappyDom } from '../test/install-happy-dom';
import type { ReplyDestinationState } from './ConsoleReplyComposer';

const react = await import('react');
const reactDomClient = await import('react-dom/client');
const composerModule = await import('./ConsoleReplyComposer');

const act = react.act;
const createElement = react.createElement;
const createRoot = reactDomClient.createRoot;
const replyComposer = composerModule.ConsoleReplyComposer;

describe('ConsoleReplyComposer', () => {
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

  async function flush(): Promise<void> {
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
  }

  async function renderComposer(
    state: ReplyDestinationState,
    onSend: (message: string) => Promise<void> = async (): Promise<void> => undefined
  ): Promise<void> {
    await act(async () => {
      root.render(createElement(replyComposer, { state, onSend }));
    });
    await flush();
  }

  function field(): HTMLTextAreaElement {
    const el = host.querySelector('textarea');
    if (el === null) throw new Error('missing textarea');
    return el as unknown as HTMLTextAreaElement;
  }

  function sendButton(): HTMLButtonElement {
    const buttons = [...host.querySelectorAll('button')];
    const match = buttons.find(button => (button.textContent ?? '').includes('Send'));
    if (match === undefined) throw new Error('missing Send');
    return match as unknown as HTMLButtonElement;
  }

  function reactOnChange(
    node: Element
  ): ((event: { target: { value: string } }) => void) | undefined {
    const fiberKey = Object.keys(node).find(key => key.startsWith('__reactProps$'));
    if (fiberKey === undefined) return undefined;
    return (
      node as unknown as Record<
        string,
        { onChange?: (event: { target: { value: string } }) => void }
      >
    )[fiberKey]?.onChange;
  }

  function setDraft(value: string): void {
    const onChange = reactOnChange(field());
    if (onChange === undefined) throw new Error('missing onChange');
    onChange({ target: { value } });
  }

  test('loading disables the field and says Loading parent conversation…', async () => {
    await renderComposer({ kind: 'loading' });
    expect(host.textContent).toContain('Loading parent conversation…');
    expect(field().disabled).toBe(true);
    expect(sendButton().disabled).toBe(true);
  });

  test('missing says replies need a parent web conversation', async () => {
    await renderComposer({ kind: 'missing' });
    expect(host.textContent).toContain(
      'Replies need a parent web conversation. This run has none.'
    );
    expect(sendButton().disabled).toBe(true);
  });

  test('error says the parent conversation could not be verified', async () => {
    await renderComposer({ kind: 'error' });
    expect(host.textContent).toContain('Unable to verify the parent conversation.');
    expect(sendButton().disabled).toBe(true);
  });

  test('non_web says replies are only for a parent web conversation', async () => {
    await renderComposer({ kind: 'non_web' });
    expect(host.textContent).toContain(
      'Replies are available only for runs with a parent web conversation.'
    );
    expect(sendButton().disabled).toBe(true);
  });

  test('ready enables Send, trims the message, calls onSend once, and clears after fulfillment', async () => {
    let resolveSend: (() => void) | undefined;
    const sent: string[] = [];
    const pending = new Promise<void>(resolve => {
      resolveSend = resolve;
    });
    await renderComposer({ kind: 'ready', parentPlatformId: 'web-parent-1' }, async message => {
      sent.push(message);
      await pending;
    });

    await act(async () => {
      setDraft('  hello world  ');
    });
    await flush();
    expect(sendButton().disabled).toBe(false);

    await act(async () => {
      sendButton().click();
    });
    await flush();
    expect(sent).toEqual(['hello world']);
    expect(field().value).toBe('  hello world  ');

    await act(async () => {
      resolveSend?.();
      await pending;
    });
    await flush();
    expect(sent).toEqual(['hello world']);
    expect(field().value).toBe('');
  });

  test('a rejected send keeps the draft and displays the error', async () => {
    await renderComposer({ kind: 'ready', parentPlatformId: 'web-parent-1' }, async () => {
      throw new Error('delivery failed');
    });
    await act(async () => {
      setDraft('keep me');
    });
    await flush();
    await act(async () => {
      sendButton().click();
    });
    await flush();
    expect(field().value).toBe('keep me');
    expect(host.textContent).toContain('delivery failed');
  });

  test('clears a draft when the verified destination changes', async () => {
    await renderComposer({ kind: 'ready', parentPlatformId: 'web-parent-1' });
    await act(async () => {
      setDraft('draft for parent one');
    });
    await flush();
    await renderComposer({ kind: 'ready', parentPlatformId: 'web-parent-2' });
    expect(field().value).toBe('');
  });

  test('an old send completion cannot erase a newer destination draft', async () => {
    let resolveSend: (() => void) | undefined;
    const pending = new Promise<void>(resolve => {
      resolveSend = resolve;
    });
    const onSend = async (): Promise<void> => pending;
    await renderComposer({ kind: 'ready', parentPlatformId: 'web-parent-1' }, onSend);
    await act(async () => {
      setDraft('parent one message');
    });
    await flush();
    await act(async () => {
      sendButton().click();
    });
    await flush();

    await renderComposer({ kind: 'ready', parentPlatformId: 'web-parent-2' }, onSend);
    await act(async () => {
      setDraft('parent two draft');
    });
    await flush();
    await act(async () => {
      resolveSend?.();
      await pending;
    });
    await flush();
    expect(field().value).toBe('parent two draft');
  });
});
