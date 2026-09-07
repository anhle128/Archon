import { describe, expect, test } from 'bun:test';

import type { RunTerminalClient, TerminalClientState } from './client';
import {
  mountXtermSession,
  type FitAddonLike,
  type XtermSessionFactories,
  type XtermTerminalLike,
} from './xterm-session';

interface FakeTerminal extends XtermTerminalLike {
  options: { theme: { background: string; foreground: string; cursor: string } };
  opened: HTMLElement | null;
  addons: FitAddonLike[];
  writes: Uint8Array[];
  dataListener: ((data: string) => void) | null;
  resizeListener: ((size: { cols: number; rows: number }) => void) | null;
  dataDisposed: boolean;
  resizeDisposed: boolean;
  disposed: boolean;
}

interface FakeClient extends RunTerminalClient {
  inputs: string[];
  resizes: Array<{ cols: number; rows: number }>;
  closeCount: number;
  disconnectCount: number;
  onOutput: (bytes: Uint8Array) => void;
  onState: (state: TerminalClientState) => void;
}

function createHarness(): {
  host: HTMLElement;
  terminal: FakeTerminal;
  fitAddon: FitAddonLike & { fitCount: number };
  client: FakeClient;
  observer: { observed: Element | null; disconnected: boolean; notify(): void };
  frames: Array<() => void>;
  states: TerminalClientState[];
  session: ReturnType<typeof mountXtermSession>;
  flushFrames(): void;
} {
  const host = { tagName: 'DIV' } as HTMLElement;
  const fitAddon = {
    fitCount: 0,
    fit(): void {
      this.fitCount += 1;
    },
  };
  const terminal: FakeTerminal = {
    options: { theme: { background: '', foreground: '', cursor: '' } },
    opened: null,
    addons: [],
    writes: [],
    dataListener: null,
    resizeListener: null,
    dataDisposed: false,
    resizeDisposed: false,
    disposed: false,
    loadAddon(addon: FitAddonLike): void {
      this.addons.push(addon);
    },
    open(element: HTMLElement): void {
      this.opened = element;
    },
    write(data: Uint8Array): void {
      this.writes.push(data);
    },
    onData(listener: (data: string) => void): { dispose(): void } {
      this.dataListener = listener;
      return {
        dispose: (): void => {
          this.dataDisposed = true;
        },
      };
    },
    onResize(listener: (size: { cols: number; rows: number }) => void): { dispose(): void } {
      this.resizeListener = listener;
      return {
        dispose: (): void => {
          this.resizeDisposed = true;
        },
      };
    },
    dispose(): void {
      this.disposed = true;
    },
  };
  const client: FakeClient = {
    inputs: [],
    resizes: [],
    closeCount: 0,
    disconnectCount: 0,
    onOutput: (): void => undefined,
    onState: (): void => undefined,
    sendInput(data: string): void {
      this.inputs.push(data);
    },
    resize(cols: number, rows: number): void {
      this.resizes.push({ cols, rows });
    },
    closeSession(): void {
      this.closeCount += 1;
    },
    disconnect(): void {
      this.disconnectCount += 1;
    },
  };
  const observer = {
    observed: null as Element | null,
    disconnected: false,
    callback: (): void => undefined,
    notify(): void {
      this.callback();
    },
  };
  const frames: Array<() => void> = [];
  const states: TerminalClientState[] = [];
  const factories: XtermSessionFactories = {
    getComputedStyle: (): { getPropertyValue(name: string): string } => ({
      getPropertyValue(name: string): string {
        if (name === '--surface-inset') return ' #111111 ';
        if (name === '--text-primary') return ' #eeeeee ';
        if (name === '--primary') return ' #00ff88 ';
        return '';
      },
    }),
    createTerminal: (options: FakeTerminal['options']): XtermTerminalLike => {
      terminal.options = options;
      return terminal;
    },
    createFitAddon: (): FitAddonLike => fitAddon,
    createClient: (input: {
      runId: string;
      onOutput: (bytes: Uint8Array) => void;
      onState: (state: TerminalClientState) => void;
    }): RunTerminalClient => {
      client.onOutput = input.onOutput;
      client.onState = input.onState;
      return client;
    },
    createResizeObserver: (callback: () => void): ResizeObserver => {
      observer.callback = callback;
      return {
        observe(element: Element): void {
          observer.observed = element;
        },
        disconnect(): void {
          observer.disconnected = true;
        },
        unobserve(): void {
          return;
        },
      } as ResizeObserver;
    },
    requestFrame: (callback: () => void): void => {
      frames.push(callback);
    },
  };
  const session = mountXtermSession({
    host,
    runId: 'run-1',
    onState: (state: TerminalClientState): void => {
      states.push(state);
    },
    factories,
  });
  return {
    host,
    terminal,
    fitAddon,
    client,
    observer,
    frames,
    states,
    session,
    flushFrames(): void {
      const pending = frames.splice(0, frames.length);
      for (const frame of pending) frame();
    },
  };
}

describe('mountXtermSession', () => {
  test('applies CSS theme variables, opens the host, loads FitAddon, and fits after mount', () => {
    const harness = createHarness();
    expect(harness.terminal.options.theme).toEqual({
      background: '#111111',
      foreground: '#eeeeee',
      cursor: '#00ff88',
    });
    expect(harness.terminal.opened).toBe(harness.host);
    expect(harness.terminal.addons).toEqual([harness.fitAddon]);
    expect(harness.observer.observed).toBe(harness.host);
    expect(harness.fitAddon.fitCount).toBe(0);
    harness.flushFrames();
    expect(harness.fitAddon.fitCount).toBe(1);
  });

  test('wires xterm input, resize, server output, and observer refit', () => {
    const harness = createHarness();
    harness.terminal.dataListener?.('ls\n');
    expect(harness.client.inputs).toEqual(['ls\n']);
    harness.terminal.resizeListener?.({ cols: 120, rows: 40 });
    expect(harness.client.resizes).toEqual([{ cols: 120, rows: 40 }]);
    const bytes = new Uint8Array([1, 2, 3]);
    harness.client.onOutput(bytes);
    expect(harness.terminal.writes).toEqual([bytes]);
    harness.client.onState({ kind: 'connected' });
    expect(harness.states).toEqual([{ kind: 'connected' }]);
    harness.flushFrames();
    harness.observer.notify();
    expect(harness.fitAddon.fitCount).toBe(1);
    harness.flushFrames();
    expect(harness.fitAddon.fitCount).toBe(2);
  });

  test('closeSession reaches the client and dispose tears down once', () => {
    const harness = createHarness();
    harness.session.closeSession();
    expect(harness.client.closeCount).toBe(1);
    harness.session.dispose();
    expect(harness.observer.disconnected).toBe(true);
    expect(harness.terminal.dataDisposed).toBe(true);
    expect(harness.terminal.resizeDisposed).toBe(true);
    expect(harness.client.disconnectCount).toBe(1);
    expect(harness.terminal.disposed).toBe(true);
    harness.session.dispose();
    expect(harness.client.disconnectCount).toBe(1);
    expect(harness.terminal.disposed).toBe(true);
    harness.flushFrames();
    harness.observer.notify();
    expect(harness.fitAddon.fitCount).toBe(0);
  });
});
