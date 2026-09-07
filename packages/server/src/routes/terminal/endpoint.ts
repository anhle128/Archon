import { resolveBashPath } from '@archon/git';
import { createLogger } from '@archon/paths';
import * as isolationEnvDb from '@archon/core/db/isolation-environments';
import * as userDb from '@archon/core/db/users';
import * as workflowDb from '@archon/core/db/workflows';

import { getAuth, isApiGateEnabled } from '../../auth';
import { inspectContainer, resolveContainerShell } from './docker';
import { TerminalOriginError, assertTerminalOrigin } from './origin';
import {
  DEFAULT_COLS,
  DEFAULT_ROWS,
  MAX_CLIENT_FRAME_BYTES,
  SOLO_TERMINAL_USER_ID,
  TERMINAL_PATH_RE,
  isResumeToken,
  parseClientControlMessage,
  serializeServerControlMessage,
  unavailableMessage,
} from './protocol';
import { spawnTerminalPty } from './pty';
import {
  createTerminalSessionManager,
  type TerminalSessionManager,
  type TerminalSocket,
} from './session-manager';
import {
  canonicalDirectory,
  resolveTerminalTarget,
  type TerminalRunRow,
  type TerminalTarget,
} from './target';

export interface TerminalSocketData {
  runId: string;
  userId: string;
  resumeToken: string | null;
}

export interface TerminalUpgradeServer {
  upgrade(request: Request, options: { data: TerminalSocketData }): boolean;
}

export interface TerminalAuthPort {
  api: {
    getSession(input: { headers: Headers }): Promise<{
      user?: { id: string; name?: string | null; email?: string | null };
    } | null>;
  };
}

export interface TerminalEndpointDeps {
  env: NodeJS.ProcessEnv;
  getAuth(): TerminalAuthPort | null;
  isApiGateEnabled(): boolean;
  findOrCreateUser(
    platform: 'web',
    platformUserId: string,
    displayName?: string
  ): Promise<{ id: string }>;
  getWorkflowRun(runId: string): Promise<TerminalRunRow | null>;
  resolveTerminalTarget(run: TerminalRunRow): Promise<TerminalTarget>;
  spawnTerminalPty: typeof spawnTerminalPty;
  manager: TerminalSessionManager;
  logAuthFailure(error: unknown, stage: 'session' | 'header'): void;
  logOpenFailure(error: unknown, runId: string, userId: string): void;
}

export interface TerminalEndpoint {
  matches(pathname: string): boolean;
  handleUpgrade(request: Request, server: TerminalUpgradeServer): Promise<Response | undefined>;
  websocket: Bun.WebSocketHandler<TerminalSocketData>;
  destroyAll(): void;
}

class TerminalHttpError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'TerminalHttpError';
    this.status = status;
  }
}

function errorTypeName(error: unknown): string {
  return error instanceof Error ? error.constructor.name : 'UnknownError';
}

function terminalErrorResponse(error: unknown): Response {
  const status =
    error instanceof TerminalHttpError || error instanceof TerminalOriginError ? error.status : 500;
  const message =
    error instanceof TerminalHttpError || error instanceof TerminalOriginError
      ? error.message
      : 'Internal server error';
  return Response.json({ error: message }, { status });
}

const defaultLog = createLogger('terminal.endpoint');

function logAuthFailure(error: unknown, stage: 'session' | 'header'): void {
  defaultLog.warn({ errorType: errorTypeName(error), stage }, 'terminal.auth_failed');
}

function logOpenFailure(error: unknown, runId: string, userId: string): void {
  defaultLog.error({ errorType: errorTypeName(error), runId, userId }, 'terminal.open_failed');
}

function createDefaultDeps(): TerminalEndpointDeps {
  return {
    env: process.env,
    getAuth(): TerminalAuthPort | null {
      return getAuth();
    },
    isApiGateEnabled(): boolean {
      return isApiGateEnabled();
    },
    findOrCreateUser(
      platform: 'web',
      platformUserId: string,
      displayName?: string
    ): Promise<{ id: string }> {
      return userDb.findOrCreateUserByPlatformIdentity(platform, platformUserId, displayName);
    },
    async getWorkflowRun(runId: string): Promise<TerminalRunRow | null> {
      const run = await workflowDb.getWorkflowRun(runId);
      if (!run) return null;
      return { working_path: run.working_path, metadata: run.metadata };
    },
    resolveTerminalTarget(run: TerminalRunRow): Promise<TerminalTarget> {
      return resolveTerminalTarget(run, {
        getIsolationEnvById: async id => {
          const environment = await isolationEnvDb.getById(id);
          if (!environment) return null;
          return {
            provider: environment.provider,
            status: environment.status,
            metadata: environment.metadata,
          };
        },
        canonicalDirectory,
        inspectContainer,
        resolveContainerShell,
        resolveHostShell: resolveBashPath,
      });
    },
    spawnTerminalPty,
    manager: createTerminalSessionManager(),
    logAuthFailure,
    logOpenFailure,
  };
}

export function createTerminalEndpoint(
  overrides: Partial<TerminalEndpointDeps> = {}
): TerminalEndpoint {
  const deps: TerminalEndpointDeps = { ...createDefaultDeps(), ...overrides };
  const manager = deps.manager;

  async function resolveTerminalUserId(request: Request): Promise<string> {
    const auth = deps.getAuth();
    if (auth) {
      try {
        const session = await auth.api.getSession({ headers: request.headers });
        if (session?.user) {
          const user = await deps.findOrCreateUser(
            'web',
            session.user.id,
            session.user.name ?? session.user.email ?? undefined
          );
          return user.id;
        }
      } catch (error) {
        deps.logAuthFailure(error, 'session');
      }
    }
    const headerName = deps.env.ARCHON_WEB_AUTH_HEADER || 'X-Archon-User';
    const headerValue = request.headers.get(headerName)?.trim();
    if (headerValue) {
      try {
        return (await deps.findOrCreateUser('web', headerValue, headerValue)).id;
      } catch (error) {
        deps.logAuthFailure(error, 'header');
      }
    }
    if (deps.isApiGateEnabled()) throw new TerminalHttpError(401, 'Authentication required');
    return SOLO_TERMINAL_USER_ID;
  }

  async function handleUpgrade(
    request: Request,
    server: TerminalUpgradeServer
  ): Promise<Response | undefined> {
    try {
      assertTerminalOrigin(request, deps.env);
      if (
        request.method !== 'GET' ||
        request.headers.get('Upgrade')?.toLowerCase() !== 'websocket'
      ) {
        throw new TerminalHttpError(426, 'WebSocket upgrade required');
      }
      const url = new URL(request.url);
      const match = TERMINAL_PATH_RE.exec(url.pathname);
      if (!match) throw new TerminalHttpError(404, 'Not found');
      let runId: string;
      try {
        runId = decodeURIComponent(match[1]);
      } catch {
        throw new TerminalHttpError(400, 'Invalid run ID');
      }
      const userId = await resolveTerminalUserId(request);
      if (!(await deps.getWorkflowRun(runId))) {
        throw new TerminalHttpError(404, 'Workflow run not found');
      }
      const requestedToken = url.searchParams.get('resume');
      const resumeToken = isResumeToken(requestedToken) ? requestedToken : null;
      if (!server.upgrade(request, { data: { runId, userId, resumeToken } })) {
        throw new TerminalHttpError(500, 'WebSocket upgrade failed');
      }
      return undefined;
    } catch (error) {
      return terminalErrorResponse(error);
    }
  }

  const websocket: Bun.WebSocketHandler<TerminalSocketData> = {
    data: {} as TerminalSocketData,
    maxPayloadLength: MAX_CLIENT_FRAME_BYTES,
    idleTimeout: 255,
    async open(ws) {
      const { runId, userId, resumeToken } = ws.data;
      const socket: TerminalSocket = ws;
      if (manager.attachExisting({ runId, userId, resumeToken, socket })) return;
      try {
        const run = await deps.getWorkflowRun(runId);
        if (!run) throw new Error('Workflow run disappeared before terminal open');
        const target = await deps.resolveTerminalTarget(run);
        if (target.kind === 'unavailable') {
          ws.send(
            serializeServerControlMessage({
              type: 'unavailable',
              reason: target.reason,
              message: unavailableMessage(target.reason),
            })
          );
          ws.close(1000, 'Terminal unavailable');
          return;
        }
        manager.create({
          runId,
          userId,
          targetKind: target.kind,
          socket,
          spawn: onData =>
            deps.spawnTerminalPty({
              target,
              cols: DEFAULT_COLS,
              rows: DEFAULT_ROWS,
              onData,
            }),
        });
      } catch (error) {
        deps.logOpenFailure(error, runId, userId);
        ws.send(
          serializeServerControlMessage({
            type: 'error',
            message: 'Could not open the terminal.',
          })
        );
        ws.close(1011, 'Terminal open failed');
      }
    },
    message(ws, frame) {
      const socket: TerminalSocket = ws;
      if (typeof frame !== 'string') {
        manager.closeSession(socket);
        return;
      }
      const message = parseClientControlMessage(frame);
      if ('error' in message) {
        manager.closeSession(socket);
        return;
      }
      if (message.type === 'input') manager.input(socket, message.data);
      if (message.type === 'resize') manager.resize(socket, message.cols, message.rows);
      if (message.type === 'close') manager.closeSession(socket);
    },
    close(ws) {
      manager.disconnect(ws);
    },
    drain(ws) {
      manager.drain(ws);
    },
  };

  return {
    matches(pathname: string): boolean {
      return TERMINAL_PATH_RE.test(pathname);
    },
    handleUpgrade,
    websocket,
    destroyAll(): void {
      manager.destroyAll();
    },
  };
}
