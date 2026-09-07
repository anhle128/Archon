import { FitAddon } from '@xterm/addon-fit';
import { Terminal } from '@xterm/xterm';

import {
  createRunTerminalClient,
  type RunTerminalClient,
  type TerminalClientState,
} from './client';

export interface MountedXtermSession {
  closeSession(): void;
  dispose(): void;
}

export interface FitAddonLike {
  fit(): void;
}

export interface XtermTerminalLike {
  loadAddon(addon: FitAddonLike): void;
  open(element: HTMLElement): void;
  write(data: Uint8Array): void;
  onData(listener: (data: string) => void): { dispose(): void };
  onResize(listener: (size: { cols: number; rows: number }) => void): { dispose(): void };
  dispose(): void;
}

export interface XtermSessionFactories {
  getComputedStyle(element: Element): { getPropertyValue(name: string): string };
  createTerminal(options: {
    theme: { background: string; foreground: string; cursor: string };
  }): XtermTerminalLike;
  createFitAddon(): FitAddonLike;
  createClient(input: {
    runId: string;
    onOutput: (bytes: Uint8Array) => void;
    onState: (state: TerminalClientState) => void;
  }): RunTerminalClient;
  createResizeObserver(callback: () => void): {
    observe(element: Element): void;
    disconnect(): void;
  };
  requestFrame(callback: () => void): void;
}

export interface MountXtermSessionInput {
  host: HTMLElement;
  runId: string;
  onState: (state: TerminalClientState) => void;
  factories?: Partial<XtermSessionFactories>;
}

function defaultFactories(): XtermSessionFactories {
  return {
    getComputedStyle(element: Element): { getPropertyValue(name: string): string } {
      return globalThis.getComputedStyle(element);
    },
    createTerminal(options: {
      theme: { background: string; foreground: string; cursor: string };
    }): XtermTerminalLike {
      return new Terminal({ theme: options.theme }) as unknown as XtermTerminalLike;
    },
    createFitAddon(): FitAddonLike {
      return new FitAddon();
    },
    createClient: createRunTerminalClient,
    createResizeObserver(callback: () => void): {
      observe(element: Element): void;
      disconnect(): void;
    } {
      return new ResizeObserver(callback);
    },
    requestFrame(callback: () => void): void {
      requestAnimationFrame(callback);
    },
  };
}

export function mountXtermSession(input: MountXtermSessionInput): MountedXtermSession {
  const factories: XtermSessionFactories = { ...defaultFactories(), ...input.factories };
  const root = globalThis.document?.documentElement ?? input.host;
  const styles = factories.getComputedStyle(root);
  const terminal = factories.createTerminal({
    theme: {
      background: styles.getPropertyValue('--surface-inset').trim(),
      foreground: styles.getPropertyValue('--text-primary').trim(),
      cursor: styles.getPropertyValue('--primary').trim(),
    },
  });
  const fitAddon = factories.createFitAddon();
  terminal.loadAddon(fitAddon);
  terminal.open(input.host);
  const client = factories.createClient({
    runId: input.runId,
    onOutput: (bytes: Uint8Array): void => {
      terminal.write(bytes);
    },
    onState: input.onState,
  });
  const inputSubscription = terminal.onData((data: string): void => {
    client.sendInput(data);
  });
  const resizeSubscription = terminal.onResize((size: { cols: number; rows: number }): void => {
    client.resize(size.cols, size.rows);
  });
  let disposed = false;
  const fit = (): void => {
    if (disposed) return;
    fitAddon.fit();
  };
  const observer = factories.createResizeObserver((): void => {
    factories.requestFrame(fit);
  });
  observer.observe(input.host);
  factories.requestFrame(fit);
  return {
    closeSession: (): void => {
      client.closeSession();
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      observer.disconnect();
      inputSubscription.dispose();
      resizeSubscription.dispose();
      client.disconnect();
      terminal.dispose();
    },
  };
}
