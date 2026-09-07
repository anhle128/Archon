import {
  RECONNECT_MS,
  REPLACED_SOCKET_CLOSE_CODE,
  chunkTerminalInput,
  isResumeToken,
  parseServerControlMessage,
  resumeStorageKey,
  validTerminalSize,
} from './protocol';

export type TerminalClientState =
  | { kind: 'connecting' }
  | { kind: 'connected' }
  | { kind: 'reconnecting' }
  | { kind: 'unavailable'; message: string }
  | { kind: 'exited'; code: number | null; signal: string | null }
  | { kind: 'closed' }
  | { kind: 'error'; message: string };

export interface RunTerminalClient {
  sendInput(data: string): void;
  resize(cols: number, rows: number): void;
  closeSession(): void;
  disconnect(): void;
}

export interface LocationPort {
  origin: string;
  protocol: string;
  host: string;
}

export interface StoragePort {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface TerminalBrowserSocket {
  binaryType: BinaryType;
  readyState: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  addEventListener(type: string, listener: (event: Event) => void): void;
}

export interface CreateRunTerminalClientInput {
  runId: string;
  onOutput: (bytes: Uint8Array) => void;
  onState: (state: TerminalClientState) => void;
  location?: LocationPort;
  storage?: StoragePort;
  createSocket?: (url: string) => TerminalBrowserSocket;
  now?: () => number;
  setTimeout?: (callback: () => void, ms: number) => unknown;
  clearTimeout?: (id: unknown) => void;
}

const SOCKET_OPEN = 1;
const BACKOFF_MS = [250, 500, 1_000, 2_000, 5_000];
const REPLACED_TAB_MESSAGE = 'Terminal opened in another tab.';
const CLOSE_FRAME = JSON.stringify({ type: 'close' });

function terminalSocketUrl(
  location: LocationPort,
  runId: string,
  resumeToken: string | null
): string {
  const url = new URL(`/api/workflows/runs/${encodeURIComponent(runId)}/terminal`, location.origin);
  url.protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  if (isResumeToken(resumeToken)) url.searchParams.set('resume', resumeToken);
  return url.toString();
}

function defaultLocation(): LocationPort {
  return window.location;
}

function defaultStorage(): StoragePort {
  return window.sessionStorage;
}

function defaultCreateSocket(url: string): TerminalBrowserSocket {
  return new WebSocket(url);
}

export function createRunTerminalClient(input: CreateRunTerminalClientInput): RunTerminalClient {
  const location = input.location ?? defaultLocation();
  const storage = input.storage ?? defaultStorage();
  const createSocket = input.createSocket ?? defaultCreateSocket;
  const now = input.now ?? Date.now;
  const schedule: (callback: () => void, ms: number) => unknown =
    input.setTimeout ?? ((callback: () => void, ms: number): unknown => setTimeout(callback, ms));
  const unschedule: (id: unknown) => void =
    input.clearTimeout ??
    ((id: unknown): void => {
      clearTimeout(id as ReturnType<typeof setTimeout>);
    });
  const storageKey = resumeStorageKey(input.runId);

  let state: TerminalClientState = { kind: 'connecting' };
  let socket: TerminalBrowserSocket | null = null;
  let allowReconnect = true;
  let reconnectTimer: unknown = null;
  let attempt = 0;
  let deadline: number | null = null;
  let latestSize: { cols: number; rows: number } | null = null;

  const setState = (next: TerminalClientState): void => {
    state = next;
    input.onState(next);
  };

  const cancelReconnectTimer = (): void => {
    if (reconnectTimer === null) return;
    unschedule(reconnectTimer);
    reconnectTimer = null;
  };

  const disableReconnect = (): void => {
    allowReconnect = false;
    cancelReconnectTimer();
  };

  const clearToken = (): void => {
    storage.removeItem(storageKey);
  };

  const sendCachedSize = (target: TerminalBrowserSocket): void => {
    if (!latestSize || target.readyState !== SOCKET_OPEN) return;
    target.send(JSON.stringify({ type: 'resize', cols: latestSize.cols, rows: latestSize.rows }));
  };

  const openCloseSocket = (resumeToken: string | null): void => {
    if (!isResumeToken(resumeToken)) return;
    try {
      const closer = createSocket(terminalSocketUrl(location, input.runId, resumeToken));
      closer.binaryType = 'arraybuffer';
      closer.addEventListener('open', (): void => {
        if (closer.readyState === SOCKET_OPEN) closer.send(CLOSE_FRAME);
        closer.close();
      });
      closer.addEventListener('error', (): void => {
        closer.close();
      });
    } catch {
      // The visible state is already closed; a failed best-effort close probe should not throw.
    }
  };

  const handleControl = (message: ReturnType<typeof parseServerControlMessage>): void => {
    if (!message) return;
    if (message.type === 'ready') {
      storage.setItem(storageKey, message.resumeToken);
      attempt = 0;
      deadline = null;
      setState({ kind: 'connected' });
      if (socket) sendCachedSize(socket);
      return;
    }
    disableReconnect();
    clearToken();
    if (message.type === 'unavailable') {
      setState({ kind: 'unavailable', message: message.message });
      return;
    }
    if (message.type === 'error') {
      setState({ kind: 'error', message: message.message });
      return;
    }
    setState({ kind: 'exited', code: message.code, signal: message.signal });
  };

  const handleMessage = (owner: TerminalBrowserSocket, event: Event): void => {
    if (socket !== owner) return;
    const data = (event as MessageEvent).data as unknown;
    if (data instanceof ArrayBuffer) {
      input.onOutput(new Uint8Array(data));
      return;
    }
    if (ArrayBuffer.isView(data)) {
      input.onOutput(new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
      return;
    }
    if (typeof data !== 'string') return;
    handleControl(parseServerControlMessage(data));
  };

  const scheduleReconnect = (): void => {
    if (!allowReconnect) return;
    if (deadline === null) deadline = now() + RECONNECT_MS;
    const remaining = deadline - now();
    if (remaining <= 0) {
      disableReconnect();
      setState({ kind: 'closed' });
      return;
    }
    setState({ kind: 'reconnecting' });
    const delay = Math.min(
      BACKOFF_MS[Math.min(attempt, BACKOFF_MS.length - 1)] ?? 5_000,
      remaining
    );
    attempt += 1;
    cancelReconnectTimer();
    reconnectTimer = schedule((): void => {
      reconnectTimer = null;
      if (!allowReconnect) return;
      if (deadline !== null && now() >= deadline) {
        disableReconnect();
        setState({ kind: 'closed' });
        return;
      }
      connect();
    }, delay);
  };

  const handleClose = (owner: TerminalBrowserSocket, event: Event): void => {
    if (socket !== owner) return;
    socket = null;
    if (!allowReconnect) return;
    const code = (event as CloseEvent).code;
    if (code === REPLACED_SOCKET_CLOSE_CODE) {
      disableReconnect();
      clearToken();
      setState({ kind: 'error', message: REPLACED_TAB_MESSAGE });
      return;
    }
    scheduleReconnect();
  };

  const connect = (): void => {
    const next = createSocket(
      terminalSocketUrl(location, input.runId, storage.getItem(storageKey))
    );
    next.binaryType = 'arraybuffer';
    socket = next;
    next.addEventListener('message', (event: Event): void => {
      handleMessage(next, event);
    });
    next.addEventListener('close', (event: Event): void => {
      handleClose(next, event);
    });
  };

  setState({ kind: 'connecting' });
  connect();

  return {
    sendInput(data: string): void {
      if (state.kind !== 'connected' || socket?.readyState !== SOCKET_OPEN) return;
      for (const chunk of chunkTerminalInput(data)) {
        socket.send(JSON.stringify({ type: 'input', data: chunk }));
      }
    },
    resize(cols: number, rows: number): void {
      if (!validTerminalSize(cols, rows)) return;
      latestSize = { cols, rows };
      if (state.kind === 'connected' && socket?.readyState === SOCKET_OPEN) {
        socket.send(JSON.stringify({ type: 'resize', cols, rows }));
      }
    },
    closeSession(): void {
      const resumeToken = storage.getItem(storageKey);
      const currentSocket = socket;
      disableReconnect();
      clearToken();
      socket = null;
      if (currentSocket?.readyState === SOCKET_OPEN) {
        currentSocket.send(CLOSE_FRAME);
        currentSocket.close();
      } else {
        currentSocket?.close();
        openCloseSocket(resumeToken);
      }
      setState({ kind: 'closed' });
    },
    disconnect(): void {
      disableReconnect();
      socket?.close();
      socket = null;
    },
  };
}
