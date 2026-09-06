import { afterEach, describe, expect, test } from 'bun:test';
import { installHappyDom, restoreHappyDom } from './install-happy-dom';

describe('installHappyDom', () => {
  afterEach(() => {
    restoreHappyDom();
  });

  test('installs a document that createRoot can use after readonly globals exist', () => {
    const priorEvent = Object.getOwnPropertyDescriptor(globalThis, 'Event');
    Object.defineProperty(globalThis, 'Event', {
      configurable: true,
      enumerable: true,
      writable: false,
      value: priorEvent && 'value' in priorEvent ? priorEvent.value : undefined,
    });

    expect(() => {
      Object.assign(globalThis as object, { Event: class ReadonlyProbe {} });
    }).toThrow(/readonly property/i);

    const win = installHappyDom();
    expect(globalThis.document).toBe(win.document);
    expect(globalThis.Event).toBe(win.Event);
    expect(win.document.createElement('div').nodeName).toBe('DIV');
    win.close();
    restoreHappyDom();
    if (priorEvent === undefined) {
      Reflect.deleteProperty(globalThis, 'Event');
    } else {
      Object.defineProperty(globalThis, 'Event', priorEvent);
    }
  });

  test('a second install in the same process does not throw', () => {
    const first = installHappyDom();
    const second = installHappyDom();
    expect(globalThis.document).toBe(second.document);
    expect(second).not.toBe(first);
    second.close();
    restoreHappyDom();
    first.close();
  });
});
