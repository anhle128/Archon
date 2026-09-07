# Interactive Workflow Run Terminal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.
> Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `Terminal` tab immediately after `Source Control` on the legacy DAG workflow run page that opens a real PTY in the server-resolved run location.

**Architecture:** The browser renders xterm.js and talks to Archon over a Bun WebSocket.
The server never trusts a working path, isolation environment ID, or container ID from the client.
Host shells spawn through `Bun.spawn({ terminal })` at canonical `run.working_path` with an explicit environment allowlist.
Container shells spawn `docker exec -it -w <working_path> <containerId>` against the live container resolved from `run.metadata.isolation_env_id`.
One in-memory PTY is kept per web user and run, with a two-minute reconnect window, a bounded output replay buffer, and explicit cleanup on close, expiry, process exit, and server shutdown.

**Tech Stack:** Bun 1.3 `Bun.serve` WebSocket plus `Bun.Terminal`, Hono for the rest of `/api/*`, JSON control frames parsed in-process, React 19, `@xterm/xterm` 5.5.0, `@xterm/addon-fit` 0.10.0, and Bun tests.

**Spec:** GitHub issue [#130](https://github.com/anhle128/Archon/issues/130) is the approved requirements record for this plan.
The issue cites `docs/superpowers/specs/2026-09-07-workflow-run-terminal-design.md` at commit `de85f9d6`, but that commit and file are not in this checkout or on `origin`.
Treat the issue body, user flow, included/excluded scope, security considerations, and definition of done as canonical.

**Issue:** [#130](https://github.com/anhle128/Archon/issues/130).

---

## Global Constraints

- Surface is `/legacy/workflows/runs/:id` only.
- Do not import or modify anything under `packages/web/src/experiments/console/`.
- Do not attach to an existing workflow node process.
- Do not sandbox `cd` or confine the host shell to `working_path`.
- Do not add shared terminals, named terminals, or multiple PTYs per user per run.
- Do not persist terminal input, output, or command history across process restart.
- Do not write command-level workflow audit records for terminal keystrokes.
- Do not support VM or remote isolation providers in this change.
- Do not add database columns or tables.
- `@archon/server` must not import `@archon/isolation`.
- Resolve host targets only from canonical `workflow_runs.working_path`.
- Resolve container targets only from `run.metadata.isolation_env_id` plus that isolation row's stored `containerId` / `containerName`.
- Never accept `working_path`, `isolation_env_id`, `containerId`, or `cwd` from the browser, query string, or WebSocket payload.
- A missing or destroyed container must fail clearly and must not fall back to the host checkout.
- Terminals are allowed for any run status while the checkout directory or live container still exists.
- Auth reuses the existing web identity gate: Better Auth session first, then `ARCHON_WEB_AUTH_HEADER` (default `X-Archon-User`).
- All authenticated users may open terminals.
- When web auth is disabled, preserve today's solo model: any client that can reach Archon may use the endpoint.
- The WebSocket must reject a missing or disallowed `Origin`.
- Host child env is an explicit allowlist and must not inherit database credentials, adapter tokens, Better Auth secrets, or provider credentials.
- Pino events stay `{domain}.{action}_{state}`, pair `_started` with `_completed` or `_failed`, and never log input, commands, output, resume tokens, environment values, or checkout paths.
- User copy is terse and must not introduce `Error:`, `unsupported`, or a warning glyph.
- WebSocket is not an OpenAPI route; do not force it through `registerOpenApiRoute`.
- JSON web types for unrelated REST routes stay generated; this feature does not add a REST body schema that requires `generate:types`.
- Do not add `@archon/isolation` as a server dependency.
- Docker argv is always an array; never `exec`, never a shell string.
- Host shell binary comes from `resolveBashPath()` in `@archon/git`.
- New server tests that `mock.module()` must run in their own `bun test` invocation in `packages/server/package.json`.
- Do not run `bun test` from the repository root without a path.
- Component and mounted web tests must set `NODE_ENV=development`.
- Every behavior change follows RED, verified RED, minimal GREEN, verified GREEN, and only then refactoring.
- Run command blocks from the repository root, and use a subshell for commands that must execute inside a package.
- Every full Markdown sentence in this plan stays on one physical line.

---

## File Structure

- Create `packages/server/src/routes/terminal/origin.ts` for same-origin checking.
- Create `packages/server/src/routes/terminal/origin.test.ts` for origin allow and deny cases.
- Create `packages/server/src/routes/terminal/env.ts` for the host PTY environment allowlist and deny filter.
- Create `packages/server/src/routes/terminal/env.test.ts` for secret stripping and allowlisted passthrough.
- Create `packages/server/src/routes/terminal/target.ts` for server-side host vs container resolution.
- Create `packages/server/src/routes/terminal/target.test.ts` for host, folder, container, missing, and no-fallback cases.
- Create `packages/server/src/routes/terminal/docker.ts` for `docker inspect` presence and `docker exec` argv.
- Create `packages/server/src/routes/terminal/docker.test.ts` for inspect outcomes and exact argv.
- Create `packages/server/src/routes/terminal/protocol.ts` for client/server message parse and serialize.
- Create `packages/server/src/routes/terminal/protocol.test.ts` for size, type, and resize bounds.
- Create `packages/server/src/routes/terminal/session.ts` for the in-memory per-user per-run registry, replay buffer, backpressure queue, and two-minute expiry.
- Create `packages/server/src/routes/terminal/session.test.ts` for attach, take-over, replay, expiry, and backpressure.
- Create `packages/server/src/routes/terminal/pty.ts` for spawning and killing `Bun.Terminal` host and container processes.
- Create `packages/server/src/routes/terminal/pty.test.ts` for a real host bash PTY in a temp directory.
- Create `packages/server/src/routes/terminal/upgrade.ts` for fetch upgrade, auth, origin, and websocket handlers.
- Create `packages/server/src/routes/terminal/upgrade.test.ts` as an isolated Bun.serve integration test.
- Create `packages/server/src/routes/terminal/index.ts` exporting `isTerminalUpgradeRequest`, `handleTerminalUpgrade`, `terminalWebsocket`, and `destroyAllTerminalSessions`.
- Modify `packages/server/src/index.ts` to intercept terminal upgrades before `app.fetch`, attach `websocket: terminalWebsocket`, and destroy sessions during shutdown.
- Modify `packages/server/package.json` to add isolated `bun test` invocations for the new terminal files.
- Modify `packages/web/vite.config.ts` to set `server.proxy['/api'].ws = true`.
- Modify `packages/web/package.json` to add `@xterm/xterm@5.5.0` and `@xterm/addon-fit@0.10.0`, and to run `src/components/workflows/terminal/` tests.
- Create `packages/web/src/components/workflows/terminal/protocol.ts` mirroring the server control-message types.
- Create `packages/web/src/components/workflows/terminal/protocol.test.ts`.
- Create `packages/web/src/components/workflows/terminal/terminal-status.tsx` for unavailable / connecting / reconnecting / exited / error copy.
- Create `packages/web/src/components/workflows/terminal/terminal-status.test.tsx`.
- Create `packages/web/src/components/workflows/terminal/use-run-terminal.ts` for WebSocket lifecycle, resume token, and FitAddon resize.
- Create `packages/web/src/components/workflows/terminal/use-run-terminal.test.ts`.
- Create `packages/web/src/components/workflows/terminal/terminal-tab.tsx`.
- Create `packages/web/src/components/workflows/terminal/terminal-tab.test.tsx`.
- Modify `packages/web/src/components/workflows/source-control/dag-run-tabs.tsx` to add `terminal` immediately after `source-control`.
- Modify `packages/web/src/components/workflows/source-control/dag-run-tabs.test.tsx`.
- Modify `packages/web/src/components/workflows/WorkflowExecution.tsx` to render `TerminalTab` for the new view.
- Modify `packages/web/src/components/workflows/WorkflowExecution.test.tsx` for `resolveWorkflowExecutionBody`.
- Modify `packages/docs-web/src/content/docs/adapters/web.md` for the run-page Terminal tab.
- Modify `packages/docs-web/src/content/docs/reference/api.md` for the WebSocket endpoint.
- Modify `packages/docs-web/src/content/docs/reference/security.md` for the interactive shell threat model and env allowlist.
- Do not modify `packages/web/src/components/workflows/WorkflowExecution.tsx` beyond tab wiring and body rendering.
- Do not regenerate `packages/web/src/lib/api.generated.d.ts` unless an unrelated OpenAPI change sneaks in; this feature has no new REST schema.

---

## Locked Contracts

```ts
export const TERMINAL_PATH_RE = /^\/api\/workflows\/runs\/([^/]+)\/terminal$/;
export const RECONNECT_MS = 120_000;
export const REPLAY_MAX_BYTES = 256 * 1024;
export const INPUT_MAX_BYTES = 64 * 1024;
export const PENDING_MAX_BYTES = 1024 * 1024;
export const MIN_COLS = 1;
export const MAX_COLS = 500;
export const MIN_ROWS = 1;
export const MAX_ROWS = 200;
export const DEFAULT_COLS = 80;
export const DEFAULT_ROWS = 24;
export const SOLO_TERMINAL_USER_ID = 'solo';

export const HOST_ENV_ALLOWLIST = [
  'HOME',
  'USER',
  'LOGNAME',
  'SHELL',
  'PATH',
  'LANG',
  'LC_ALL',
  'LC_CTYPE',
  'LC_MESSAGES',
  'TZ',
  'TMPDIR',
  'SSH_AUTH_SOCK',
  'COLORTERM',
  'TERM_PROGRAM',
  'USERPROFILE',
  'HOMEDRIVE',
  'HOMEPATH',
  'PATHEXT',
  'SYSTEMROOT',
  'COMSPEC',
] as const;

export const HOST_ENV_DENY_EXACT = [
  'DATABASE_URL',
  'TOKEN_ENCRYPTION_KEY',
  'BETTER_AUTH_SECRET',
  'BETTER_AUTH_URL',
  'WEBHOOK_SECRET',
  'GITEA_WEBHOOK_SECRET',
  'GITHUB_TOKEN',
  'GH_TOKEN',
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_OAUTH_TOKEN',
  'CLAUDE_CODE_OAUTH_TOKEN',
  'OPENAI_API_KEY',
  'OPENAI_API_KEY_OLD',
] as const;

export const HOST_ENV_DENY_PREFIXES = [
  'ARCHON_',
  'SLACK_',
  'TELEGRAM_',
  'DISCORD_',
  'GITHUB_',
  'GITEA_',
  'GITLAB_',
  'ANTHROPIC_',
  'OPENAI_',
  'CLAUDE_',
  'CODEX_',
  'BETTER_AUTH_',
] as const;

export type TerminalTargetKind = 'host' | 'container';

export type TerminalUnavailableReason =
  | 'no_checkout'
  | 'container_missing'
  | 'container_stopped'
  | 'unsupported_provider';

export type TerminalTarget =
  | { kind: 'host'; cwd: string; shell: string }
  | { kind: 'container'; cwd: string; containerId: string }
  | { kind: 'unavailable'; reason: TerminalUnavailableReason };

export type ClientControlMessage =
  | { type: 'input'; data: string }
  | { type: 'resize'; cols: number; rows: number }
  | { type: 'close' };

export type ServerControlMessage =
  | { type: 'ready'; resumeToken: string; cols: number; rows: number }
  | { type: 'exit'; code: number | null; signal: string | null }
  | { type: 'unavailable'; reason: TerminalUnavailableReason; message: string }
  | { type: 'error'; message: string };

export function isTerminalUpgradeRequest(urlPath: string): boolean;
export function handleTerminalUpgrade(
  req: Request,
  server: { upgrade: (req: Request, options: { data: TerminalSocketData }) => boolean }
): Promise<Response>;
export const terminalWebsocket: {
  open(ws: ServerWebSocket<TerminalSocketData>): void | Promise<void>;
  message(ws: ServerWebSocket<TerminalSocketData>, message: string | ArrayBuffer | Uint8Array): void;
  close(ws: ServerWebSocket<TerminalSocketData>): void;
  drain(ws: ServerWebSocket<TerminalSocketData>): void;
};
export function destroyAllTerminalSessions(): void;
```

Transport:

- URL is `GET /api/workflows/runs/{runId}/terminal`.
- Optional query `resume` is the server-issued opaque resume token.
- Client control frames are UTF-8 JSON text.
- Client input bytes may also arrive as a binary frame and are written to the PTY as-is when `byteLength <= INPUT_MAX_BYTES`.
- Server control frames are UTF-8 JSON text.
- Server PTY output frames are raw binary (`Uint8Array`).
- Unknown JSON keys other than the locked fields are ignored.
- `working_path`, `cwd`, `isolation_env_id`, and `containerId` in any client payload are ignored and never used for resolution.

Auth and origin:

- Origin check runs before upgrade.
- If `WEB_UI_ORIGIN` is set and is not `*`, `Origin` must equal that value.
- If `WEB_UI_ORIGIN` is unset or `*`, `Origin` hostname must equal the request `Host` hostname (ports may differ so Vite dev on `:5173` can reach `:3090` through the proxy).
- Missing `Origin` is HTTP 403 `{ error: "Forbidden origin" }`.
- Disallowed `Origin` is HTTP 403 `{ error: "Forbidden origin" }`.
- When `isApiGateEnabled()` is true, a request with no Better Auth session and no trusted header is HTTP 401 `{ error: "Authentication required" }` and is not upgraded.
- When the gate is off, the session key user id is `solo`.
- When the gate is on, the session key user id is the canonical `remote_agent_users.id`.
- All authenticated users are allowed; there is no per-run owner ACL.

Target resolution:

- Load the run with `workflowDb.getWorkflowRun(runId)`.
- Missing run is HTTP 404 `{ error: "Workflow run not found" }` and is not upgraded.
- If `run.metadata.isolation === 'container'` and `run.metadata.isolation_env_id` is a string, resolve as container and never inspect the host path as a fallback.
- Container resolution loads `isolationEnvDb.getById(envId)`.
- Missing env row, `status === 'destroyed'`, or missing `containerId`/`containerName` is `{ kind: 'unavailable', reason: 'container_missing' }`.
- `docker inspect -f '{{.State.Running}}' <handle>` false is `{ kind: 'unavailable', reason: 'container_stopped' }`.
- Inspect "no such object" is `{ kind: 'unavailable', reason: 'container_missing' }`.
- Env `provider` of `vm` or `remote` is `{ kind: 'unavailable', reason: 'unsupported_provider' }`.
- Host resolution requires `run.working_path` to exist as a directory after `realpath`.
- Host folder projects are allowed; do not require a git worktree.
- Host missing/non-directory path is `{ kind: 'unavailable', reason: 'no_checkout' }`.

Docker argv when the container is running is exactly:

```ts
['exec', '-i', '-t', '-w', cwd, containerId, shell]
```

`shell` is `/bin/bash` when `docker exec <containerId> test -x /bin/bash` exits 0, otherwise `/bin/sh`.
Do not pass host env via `-e`.

Host spawn:

```ts
Bun.spawn([shell, '-l'], {
  cwd,
  env: buildHostTerminalEnv(process.env),
  terminal: {
    cols,
    rows,
    name: 'xterm-256color',
    data(term, data) { /* binary to ws */ },
  },
});
```

`buildHostTerminalEnv` copies only allowlisted keys, drops deny-exact and deny-prefix keys, and forces `TERM=xterm-256color` plus `COLORTERM=truecolor`.

Session:

- Map key is `${userId}:${runId}`.
- One live PTY per key.
- A second socket for the same key takes over: the old socket receives close, the PTY stays.
- `close` control message destroys the PTY immediately and does not keep the two-minute window.
- Socket close without `close` starts a `RECONNECT_MS` timer.
- A matching `resume` token within the window reattaches and replays the ring buffer as binary frames before `{ type: 'ready' }` is sent again.
- Process exit destroys the session immediately, sends `{ type: 'exit' }`, and does not keep the reconnect window.
- `destroyAllTerminalSessions()` kills every PTY and is called from server shutdown before adapters stop.
- Resume tokens are 32 random bytes hex-encoded via `crypto.randomBytes`.
- Invalid resume tokens are ignored; a new session is created for that user+run (destroying any leftover PTY for that key).

Backpressure:

- `ws.send(bytes)` returning `0` enqueues onto a pending buffer.
- `drain` flushes pending in order.
- If pending exceeds `PENDING_MAX_BYTES`, destroy the session and send `{ type: 'error', message: 'Terminal output overflowed' }` if the socket is still open.

Unavailable copy:

- `no_checkout`: `This run's checkout isn't available — it may not be ready yet, or it may have been cleaned up.`
- `container_missing` and `container_stopped`: `This run's container isn't available — it may have been stopped or cleaned up.`
- `unsupported_provider`: `This run uses an isolation provider the terminal cannot open.`

Web UI:

- Tab label is `Terminal`.
- Tab order is Graph, Logs, optional Chat, Source Control, Terminal.
- Body kind `terminal` renders `TerminalTab`.
- Connect on tab mount using same-origin `ws:` / `wss:` against `window.location.host`.
- Store only the resume token in `sessionStorage` at key `archon.terminal.resume.${runId}`.
- Do not store output or input.
- xterm theme reads `--surface-inset`, `--text-primary`, and `--primary` from computed styles.
- Import `@xterm/xterm/css/xterm.css` from `terminal-tab.tsx`.

Logging:

- `terminal.session_started` with `{ runId, userId, targetKind }`.
- `terminal.session_reconnected` with `{ runId, userId }`.
- `terminal.session_completed` with `{ runId, userId }`.
- `terminal.session_failed` with `{ runId, userId, errorType }`.
- `terminal.session_expired` with `{ runId, userId }`.
- `terminal.pty_exited` with `{ runId, userId }`.

---

## Required Implementation Order

Execute Tasks 1 through 10 in numeric order.
Do not start Task 7 before Tasks 1 through 6 are green.
Do not start Task 8 before Task 7 is green.
Do not start Task 9 before Task 8 is green.
Task 10 is docs plus the full validation gate.

---

## Open Questions

### OQ-1 — Missing design-spec commit

Issue #130 names `docs/superpowers/specs/2026-09-07-workflow-run-terminal-design.md` at `de85f9d6`, which is not in this repository.
**Safe provisional default:** treat the issue body as the approved brainstorm and do not block on recovering that file.

### OQ-2 — Solo identity when web auth is disabled

The issue keys sessions by web user, but solo installs have no user.
**Safe provisional default:** use `SOLO_TERMINAL_USER_ID = 'solo'` so the single operator shares one PTY per run, matching the current open solo access model.

### OQ-3 — Output framing

The issue does not specify JSON-vs-binary frames.
**Safe provisional default:** binary frames for PTY output and UTF-8 JSON text for control messages.

### OQ-4 — Second browser tab for the same user and run

The issue forbids multiple named terminals but does not say what a second tab does.
**Safe provisional default:** the new socket takes over the existing PTY; the previous socket closes.

### OQ-5 — Resume token storage in the browser

The issue forbids persisting input and output, not the reconnect token.
**Safe provisional default:** store only the resume token in `sessionStorage` so leaving the tab and returning within two minutes reconnects.

---

### Task 1: Same-origin checker

**Files:**
- Create: `packages/server/src/routes/terminal/origin.ts`
- Test: `packages/server/src/routes/terminal/origin.test.ts`

**Interfaces:**
- Consumes: `Request` headers `Origin` and `Host`, plus `process.env.WEB_UI_ORIGIN`.
- Produces: `export function assertTerminalOrigin(req: Request, env?: NodeJS.ProcessEnv): void` throwing `TerminalOriginError` with `status = 403`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, test } from 'bun:test';

import { TerminalOriginError, assertTerminalOrigin } from './origin';

function req(origin: string | null, host: string): Request {
  const headers = new Headers();
  if (origin) headers.set('Origin', origin);
  headers.set('Host', host);
  return new Request('http://example.invalid/api/workflows/runs/run-1/terminal', {
    headers,
  });
}

describe('assertTerminalOrigin', () => {
  test('rejects a missing Origin', () => {
    expect(() => assertTerminalOrigin(req(null, 'localhost:3090'), {})).toThrow(TerminalOriginError);
  });

  test('rejects a different hostname when WEB_UI_ORIGIN is unset', () => {
    expect(() =>
      assertTerminalOrigin(req('http://evil.example', 'localhost:3090'), {})
    ).toThrow(TerminalOriginError);
  });

  test('allows the Vite dev origin when hostnames match and ports differ', () => {
    expect(() =>
      assertTerminalOrigin(req('http://localhost:5173', 'localhost:3090'), {})
    ).not.toThrow();
  });

  test('requires exact WEB_UI_ORIGIN when it is a concrete origin', () => {
    const env = { WEB_UI_ORIGIN: 'https://archon.example' };
    expect(() =>
      assertTerminalOrigin(req('https://archon.example', 'archon.example'), env)
    ).not.toThrow();
    expect(() =>
      assertTerminalOrigin(req('http://localhost:5173', 'archon.example'), env)
    ).toThrow(TerminalOriginError);
  });

  test('treats WEB_UI_ORIGIN=* as hostname matching', () => {
    expect(() =>
      assertTerminalOrigin(req('http://localhost:5173', 'localhost:3090'), {
        WEB_UI_ORIGIN: '*',
      })
    ).not.toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `(cd packages/server && bun test src/routes/terminal/origin.test.ts)`
Expected: FAIL because `./origin` is not defined.

- [ ] **Step 3: Write minimal implementation**

```ts
export class TerminalOriginError extends Error {
  readonly status = 403;
  constructor() {
    super('Forbidden origin');
    this.name = 'TerminalOriginError';
  }
}

function hostnameOf(value: string): string | null {
  try {
    if (value.includes('://')) return new URL(value).hostname;
    return new URL(`http://${value}`).hostname;
  } catch {
    return null;
  }
}

export function assertTerminalOrigin(
  req: Request,
  env: NodeJS.ProcessEnv = process.env
): void {
  const origin = req.headers.get('Origin')?.trim() ?? '';
  if (!origin) throw new TerminalOriginError();
  const configured = env.WEB_UI_ORIGIN?.trim();
  if (configured && configured !== '*') {
    if (origin !== configured) throw new TerminalOriginError();
    return;
  }
  const originHost = hostnameOf(origin);
  const requestHost = hostnameOf(req.headers.get('Host') ?? '');
  if (!originHost || !requestHost || originHost !== requestHost) {
    throw new TerminalOriginError();
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `(cd packages/server && bun test src/routes/terminal/origin.test.ts)`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/routes/terminal/origin.ts packages/server/src/routes/terminal/origin.test.ts
git commit -m "feat(server): reject terminal websocket origins that are not same-host"
```

---

### Task 2: Host PTY environment allowlist

**Files:**
- Create: `packages/server/src/routes/terminal/env.ts`
- Test: `packages/server/src/routes/terminal/env.test.ts`

**Interfaces:**
- Consumes: `NodeJS.ProcessEnv`.
- Produces: `export function buildHostTerminalEnv(source: NodeJS.ProcessEnv): Record<string, string>`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, test } from 'bun:test';

import { buildHostTerminalEnv } from './env';

describe('buildHostTerminalEnv', () => {
  test('copies PATH and HOME and forces TERM', () => {
    const env = buildHostTerminalEnv({
      PATH: '/usr/bin',
      HOME: '/Users/op',
      USER: 'op',
    });
    expect(env.PATH).toBe('/usr/bin');
    expect(env.HOME).toBe('/Users/op');
    expect(env.TERM).toBe('xterm-256color');
    expect(env.COLORTERM).toBe('truecolor');
  });

  test('drops database, auth, adapter, and provider secrets even if allowlisted later', () => {
    const env = buildHostTerminalEnv({
      PATH: '/usr/bin',
      DATABASE_URL: 'postgres://secret',
      TOKEN_ENCRYPTION_KEY: 'k',
      BETTER_AUTH_SECRET: 's',
      SLACK_BOT_TOKEN: 'xoxb',
      TELEGRAM_BOT_TOKEN: '123:abc',
      ANTHROPIC_API_KEY: 'sk',
      CLAUDE_CODE_OAUTH_TOKEN: 'oat',
      ARCHON_HOME: '/tmp',
      GITHUB_TOKEN: 'ghp',
    });
    expect(env.DATABASE_URL).toBeUndefined();
    expect(env.TOKEN_ENCRYPTION_KEY).toBeUndefined();
    expect(env.BETTER_AUTH_SECRET).toBeUndefined();
    expect(env.SLACK_BOT_TOKEN).toBeUndefined();
    expect(env.TELEGRAM_BOT_TOKEN).toBeUndefined();
    expect(env.ANTHROPIC_API_KEY).toBeUndefined();
    expect(env.CLAUDE_CODE_OAUTH_TOKEN).toBeUndefined();
    expect(env.ARCHON_HOME).toBeUndefined();
    expect(env.GITHUB_TOKEN).toBeUndefined();
    expect(Object.keys(env).sort()).toEqual(['COLORTERM', 'PATH', 'TERM']);
  });

  test('does not spread process.env', () => {
    const env = buildHostTerminalEnv({
      PATH: '/bin',
      UNRELATED_SECRET: 'nope',
    });
    expect(env.UNRELATED_SECRET).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `(cd packages/server && bun test src/routes/terminal/env.test.ts)`
Expected: FAIL because `./env` is not defined.

- [ ] **Step 3: Write minimal implementation**

Implement `HOST_ENV_ALLOWLIST`, `HOST_ENV_DENY_EXACT`, `HOST_ENV_DENY_PREFIXES`, and `buildHostTerminalEnv` exactly as in Locked Contracts.
Skip empty or undefined source values.
Apply deny filters after the allowlist copy.
Always set `TERM` and `COLORTERM` last so they cannot be taken from the source.

- [ ] **Step 4: Run test to verify it passes**

Run: `(cd packages/server && bun test src/routes/terminal/env.test.ts)`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/routes/terminal/env.ts packages/server/src/routes/terminal/env.test.ts
git commit -m "feat(server): allowlist host terminal environment and drop secrets"
```

---

### Task 3: Terminal target resolver

**Files:**
- Create: `packages/server/src/routes/terminal/target.ts`
- Test: `packages/server/src/routes/terminal/target.test.ts`

**Interfaces:**
- Consumes: a run row `{ working_path, metadata }`, isolation env loader, directory probe, realpath, docker presence probe, and `resolveBashPath`.
- Produces: `export async function resolveTerminalTarget(input: ResolveTerminalTargetInput): Promise<TerminalTarget>`.

```ts
export interface ResolveTerminalTargetInput {
  run: {
    working_path: string | null;
    metadata: Record<string, unknown> | null;
  } | null;
  getIsolationEnvById: (
    id: string
  ) => Promise<{
    provider: string;
    status: string;
    working_path: string;
    metadata: Record<string, unknown>;
  } | null>;
  pathExists: (path: string) => Promise<boolean>;
  realpathFn: (path: string) => Promise<string>;
  inspectContainer: (handle: string) => Promise<'running' | 'stopped' | 'missing'>;
  resolveShell: () => string;
}
```

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, test } from 'bun:test';

import { resolveTerminalTarget, type ResolveTerminalTargetInput } from './target';

function input(overrides: Partial<ResolveTerminalTargetInput> = {}): ResolveTerminalTargetInput {
  return {
    run: { working_path: '/checkout', metadata: {} },
    getIsolationEnvById: async () => null,
    pathExists: async () => true,
    realpathFn: async path => path,
    inspectContainer: async () => 'missing',
    resolveShell: () => '/bin/bash',
    ...overrides,
  };
}

describe('resolveTerminalTarget', () => {
  test('returns host for a live directory including non-git folder projects', async () => {
    const result = await resolveTerminalTarget(
      input({
        realpathFn: async () => '/canonical/folder',
      })
    );
    expect(result).toEqual({
      kind: 'host',
      cwd: '/canonical/folder',
      shell: '/bin/bash',
    });
  });

  test('returns no_checkout when working_path is missing', async () => {
    const result = await resolveTerminalTarget(
      input({ run: { working_path: null, metadata: {} } })
    );
    expect(result).toEqual({ kind: 'unavailable', reason: 'no_checkout' });
  });

  test('resolves a running container from run.metadata.isolation_env_id and never probes the host', async () => {
    let pathProbe = 0;
    const result = await resolveTerminalTarget(
      input({
        run: {
          working_path: '/workspace/ops',
          metadata: { isolation: 'container', isolation_env_id: 'env-1' },
        },
        getIsolationEnvById: async () => ({
          provider: 'container',
          status: 'active',
          working_path: '/workspace/ops',
          metadata: { containerId: 'cid-live', containerName: 'archon-env-1' },
        }),
        pathExists: async () => {
          pathProbe += 1;
          return true;
        },
        inspectContainer: async () => 'running',
      })
    );
    expect(result).toEqual({
      kind: 'container',
      cwd: '/workspace/ops',
      containerId: 'cid-live',
    });
    expect(pathProbe).toBe(0);
  });

  test('does not fall back to the host when the container is gone', async () => {
    const result = await resolveTerminalTarget(
      input({
        run: {
          working_path: '/workspace/ops',
          metadata: { isolation: 'container', isolation_env_id: 'env-1' },
        },
        getIsolationEnvById: async () => ({
          provider: 'container',
          status: 'active',
          working_path: '/workspace/ops',
          metadata: { containerName: 'archon-env-1' },
        }),
        inspectContainer: async () => 'missing',
        pathExists: async () => true,
      })
    );
    expect(result).toEqual({ kind: 'unavailable', reason: 'container_missing' });
  });

  test('returns container_stopped when inspect says not running', async () => {
    const result = await resolveTerminalTarget(
      input({
        run: {
          working_path: '/workspace/ops',
          metadata: { isolation: 'container', isolation_env_id: 'env-1' },
        },
        getIsolationEnvById: async () => ({
          provider: 'container',
          status: 'active',
          working_path: '/workspace/ops',
          metadata: { containerId: 'cid' },
        }),
        inspectContainer: async () => 'stopped',
      })
    );
    expect(result).toEqual({ kind: 'unavailable', reason: 'container_stopped' });
  });

  test('returns unsupported_provider for vm and remote', async () => {
    const result = await resolveTerminalTarget(
      input({
        run: {
          working_path: '/vm',
          metadata: { isolation_env_id: 'env-vm' },
        },
        getIsolationEnvById: async () => ({
          provider: 'vm',
          status: 'active',
          working_path: '/vm',
          metadata: {},
        }),
      })
    );
    expect(result).toEqual({ kind: 'unavailable', reason: 'unsupported_provider' });
  });

  test('ignores a client-supplied looking metadata.containerId on the run row', async () => {
    const result = await resolveTerminalTarget(
      input({
        run: {
          working_path: '/workspace/ops',
          metadata: {
            isolation: 'container',
            isolation_env_id: 'env-1',
            containerId: 'forged',
          },
        },
        getIsolationEnvById: async () => ({
          provider: 'container',
          status: 'active',
          working_path: '/workspace/ops',
          metadata: { containerId: 'cid-real' },
        }),
        inspectContainer: async handle => {
          expect(handle).toBe('cid-real');
          return 'running';
        },
      })
    );
    expect(result).toEqual({
      kind: 'container',
      cwd: '/workspace/ops',
      containerId: 'cid-real',
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `(cd packages/server && bun test src/routes/terminal/target.test.ts)`
Expected: FAIL because `./target` is not defined.

- [ ] **Step 3: Write minimal implementation**

If `run` is null, return `{ kind: 'unavailable', reason: 'no_checkout' }` from this helper; the upgrade handler maps a missing DB run to HTTP 404 before calling it.
If `metadata.isolation === 'container'` or `typeof metadata.isolation_env_id === 'string'` together with `isolation === 'container'`, take the container branch only when `isolation === 'container'`.
Use `run.working_path` as the container `-w` cwd when present, otherwise the env row `working_path`.
Container handle is `metadata.containerId` if a non-empty string, else `metadata.containerName`.
Destroyed env rows map to `container_missing`.
Host branch realpaths `working_path` and requires `pathExists`.

- [ ] **Step 4: Run test to verify it passes**

Run: `(cd packages/server && bun test src/routes/terminal/target.test.ts)`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/routes/terminal/target.ts packages/server/src/routes/terminal/target.test.ts
git commit -m "feat(server): resolve terminal targets from run working_path and isolation_env_id"
```

---

### Task 4: Docker inspect and exec argv

**Files:**
- Create: `packages/server/src/routes/terminal/docker.ts`
- Test: `packages/server/src/routes/terminal/docker.test.ts`

**Interfaces:**
- Consumes: an injected `execFile(cmd, args) => Promise<{ stdout: string; stderr: string }>` defaulting to `execFileAsync` from `@archon/git`.
- Produces: `inspectContainerPresence(handle: string): Promise<'running' | 'stopped' | 'missing'>`, `buildDockerExecArgs(cwd: string, containerId: string, shell: string): string[]`, and `resolveContainerShell(containerId: string): Promise<string>`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, test } from 'bun:test';

import {
  buildDockerExecArgs,
  inspectContainerPresence,
  resolveContainerShell,
} from './docker';

describe('buildDockerExecArgs', () => {
  test('uses docker exec -i -t -w without host env flags', () => {
    expect(buildDockerExecArgs('/workspace/ops', 'cid', '/bin/bash')).toEqual([
      'exec',
      '-i',
      '-t',
      '-w',
      '/workspace/ops',
      'cid',
      '/bin/bash',
    ]);
  });
});

describe('inspectContainerPresence', () => {
  test('maps true, false, and no-such-object', async () => {
    expect(
      await inspectContainerPresence('cid', async () => ({ stdout: 'true\n', stderr: '' }))
    ).toBe('running');
    expect(
      await inspectContainerPresence('cid', async () => ({ stdout: 'false\n', stderr: '' }))
    ).toBe('stopped');
    expect(
      await inspectContainerPresence('cid', async () => {
        throw new Error('Error: No such object: cid');
      })
    ).toBe('missing');
  });
});

describe('resolveContainerShell', () => {
  test('uses /bin/bash when test -x succeeds and /bin/sh otherwise', async () => {
    expect(
      await resolveContainerShell('cid', async (_cmd, args) => {
        if (args.includes('/bin/bash')) return { stdout: '', stderr: '' };
        throw new Error('unreachable');
      })
    ).toBe('/bin/bash');
    expect(
      await resolveContainerShell('cid', async () => {
        throw new Error('exec: exit 1');
      })
    ).toBe('/bin/sh');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `(cd packages/server && bun test src/routes/terminal/docker.test.ts)`
Expected: FAIL because `./docker` is not defined.

- [ ] **Step 3: Write minimal implementation**

`inspect` argv is exactly `['inspect', '-f', '{{.State.Running}}', handle]`.
`test -x` argv is exactly `['exec', containerId, 'test', '-x', '/bin/bash']`.
Catch inspect errors whose message includes `No such object` as `missing`; rethrow other errors.

- [ ] **Step 4: Run test to verify it passes**

Run: `(cd packages/server && bun test src/routes/terminal/docker.test.ts)`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/routes/terminal/docker.ts packages/server/src/routes/terminal/docker.test.ts
git commit -m "feat(server): build docker exec terminal argv without host env"
```

---

### Task 5: WebSocket control protocol

**Files:**
- Create: `packages/server/src/routes/terminal/protocol.ts`
- Test: `packages/server/src/routes/terminal/protocol.test.ts`

**Interfaces:**
- Consumes: raw text frames.
- Produces: `parseClientControlMessage(raw: string): ClientControlMessage | { error: string }`, `serializeServerControlMessage(msg: ServerControlMessage): string`, plus the constants from Locked Contracts.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, test } from 'bun:test';

import {
  INPUT_MAX_BYTES,
  parseClientControlMessage,
  serializeServerControlMessage,
} from './protocol';

describe('parseClientControlMessage', () => {
  test('accepts input, resize, and close', () => {
    expect(parseClientControlMessage('{"type":"input","data":"ls\\n"}')).toEqual({
      type: 'input',
      data: 'ls\n',
    });
    expect(parseClientControlMessage('{"type":"resize","cols":120,"rows":40}')).toEqual({
      type: 'resize',
      cols: 120,
      rows: 40,
    });
    expect(parseClientControlMessage('{"type":"close"}')).toEqual({ type: 'close' });
  });

  test('ignores client working_path and containerId fields', () => {
    const parsed = parseClientControlMessage(
      '{"type":"input","data":"x","working_path":"/etc","containerId":"forged"}'
    );
    expect(parsed).toEqual({ type: 'input', data: 'x' });
  });

  test('rejects oversized input and invalid resize', () => {
    const huge = 'a'.repeat(INPUT_MAX_BYTES + 1);
    expect(parseClientControlMessage(JSON.stringify({ type: 'input', data: huge }))).toEqual({
      error: 'invalid_input',
    });
    expect(parseClientControlMessage('{"type":"resize","cols":0,"rows":24}')).toEqual({
      error: 'invalid_resize',
    });
    expect(parseClientControlMessage('{"type":"resize","cols":80,"rows":201}')).toEqual({
      error: 'invalid_resize',
    });
  });

  test('rejects unknown types and malformed JSON', () => {
    expect(parseClientControlMessage('{')).toEqual({ error: 'invalid_message' });
    expect(parseClientControlMessage('{"type":"cwd","path":"/"}')).toEqual({
      error: 'invalid_message',
    });
  });
});

describe('serializeServerControlMessage', () => {
  test('round-trips ready, exit, unavailable, and error', () => {
    const ready = { type: 'ready' as const, resumeToken: 'ab', cols: 80, rows: 24 };
    expect(JSON.parse(serializeServerControlMessage(ready))).toEqual(ready);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `(cd packages/server && bun test src/routes/terminal/protocol.test.ts)`
Expected: FAIL because `./protocol` is not defined.

- [ ] **Step 3: Write minimal implementation**

Use `JSON.parse` inside try/catch.
Validate `input.data` is a string whose `Buffer.byteLength(data, 'utf8') <= INPUT_MAX_BYTES`.
Validate resize with `Number.isInteger` and the locked min/max.
Do not read extra keys.

- [ ] **Step 4: Run test to verify it passes**

Run: `(cd packages/server && bun test src/routes/terminal/protocol.test.ts)`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/routes/terminal/protocol.ts packages/server/src/routes/terminal/protocol.test.ts
git commit -m "feat(server): parse terminal websocket control messages with input bounds"
```

---

### Task 6: In-memory session registry

**Files:**
- Create: `packages/server/src/routes/terminal/session.ts`
- Test: `packages/server/src/routes/terminal/session.test.ts`

**Interfaces:**
- Consumes: protocol constants, a clock `now(): number`, and a `schedule(ms, fn)` / `cancel(id)` timer port so tests do not wait two minutes.
- Produces:

```ts
export interface TerminalSession {
  key: string;
  runId: string;
  userId: string;
  resumeToken: string;
  cols: number;
  rows: number;
  socket: unknown | null;
  pending: Uint8Array[];
  pendingBytes: number;
  replay: Uint8Array[];
  replayBytes: number;
  expireAt: number | null;
}

export function sessionKey(userId: string, runId: string): string;
export function createTerminalRegistry(opts?: {
  now?: () => number;
  schedule?: (ms: number, fn: () => void) => unknown;
  cancel?: (id: unknown) => void;
}): {
  get(key: string): TerminalSession | undefined;
  attach(input: {
    runId: string;
    userId: string;
    socket: unknown;
    resumeToken?: string;
  }): { session: TerminalSession; replay: Uint8Array[]; created: boolean };
  markDisconnected(key: string, socket: unknown): void;
  destroy(key: string): TerminalSession | undefined;
  appendOutput(session: TerminalSession, chunk: Uint8Array): 'ok' | 'overflow';
  enqueuePending(session: TerminalSession, chunk: Uint8Array): 'ok' | 'overflow';
  takePending(session: TerminalSession): Uint8Array[];
  destroyAll(): TerminalSession[];
};
```

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, test } from 'bun:test';

import { PENDING_MAX_BYTES, RECONNECT_MS, createTerminalRegistry, sessionKey } from './session';

describe('terminal registry', () => {
  test('creates one session per user and run and takes over the socket', () => {
    const reg = createTerminalRegistry({ now: () => 0 });
    const first = {};
    const second = {};
    const a = reg.attach({ runId: 'run-1', userId: 'user-a', socket: first });
    expect(a.created).toBe(true);
    const b = reg.attach({
      runId: 'run-1',
      userId: 'user-a',
      socket: second,
      resumeToken: a.session.resumeToken,
    });
    expect(b.created).toBe(false);
    expect(b.session.socket).toBe(second);
    expect(reg.get(sessionKey('user-a', 'run-1'))?.socket).toBe(second);
  });

  test('keeps a disconnected session for two minutes then expires it', () => {
    const timers: Array<{ ms: number; fn: () => void }> = [];
    const reg = createTerminalRegistry({
      now: () => 1_000,
      schedule: (ms, fn) => {
        timers.push({ ms, fn });
        return timers.length;
      },
      cancel: () => undefined,
    });
    const socket = {};
    const { session } = reg.attach({ runId: 'run-1', userId: 'solo', socket });
    reg.markDisconnected(sessionKey('solo', 'run-1'), socket);
    expect(timers[0]?.ms).toBe(RECONNECT_MS);
    expect(reg.get(sessionKey('solo', 'run-1'))).toBeDefined();
    timers[0]?.fn();
    expect(reg.get(sessionKey('solo', 'run-1'))).toBeUndefined();
  });

  test('replays bounded output on resume and drops overflow pending', () => {
    const reg = createTerminalRegistry({ now: () => 0 });
    const socket = {};
    const { session } = reg.attach({ runId: 'run-1', userId: 'solo', socket });
    expect(reg.appendOutput(session, new Uint8Array([1, 2, 3]))).toBe('ok');
    reg.markDisconnected(sessionKey('solo', 'run-1'), socket);
    const resumed = reg.attach({
      runId: 'run-1',
      userId: 'solo',
      socket: {},
      resumeToken: session.resumeToken,
    });
    expect(Buffer.concat(resumed.replay).equals(Buffer.from([1, 2, 3]))).toBe(true);
    const big = new Uint8Array(PENDING_MAX_BYTES + 1);
    expect(reg.enqueuePending(session, big)).toBe('overflow');
  });

  test('invalid resume token creates a new session for that key', () => {
    const reg = createTerminalRegistry({ now: () => 0 });
    const first = reg.attach({ runId: 'run-1', userId: 'solo', socket: {} });
    const second = reg.attach({
      runId: 'run-1',
      userId: 'solo',
      socket: {},
      resumeToken: 'deadbeef',
    });
    expect(second.created).toBe(true);
    expect(second.session.resumeToken).not.toBe(first.session.resumeToken);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `(cd packages/server && bun test src/routes/terminal/session.test.ts)`
Expected: FAIL because `./session` is not defined.

- [ ] **Step 3: Write minimal implementation**

Keep replay as a list of chunks and drop from the front while `replayBytes > REPLAY_MAX_BYTES`.
Generate resume tokens with `randomBytes(32).toString('hex')`.
`destroyAll` returns the destroyed sessions so the caller can kill PTYs.

- [ ] **Step 4: Run test to verify it passes**

Run: `(cd packages/server && bun test src/routes/terminal/session.test.ts)`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/routes/terminal/session.ts packages/server/src/routes/terminal/session.test.ts
git commit -m "feat(server): keep one in-memory terminal session per user and run"
```

---

### Task 7: Bun.Terminal PTY spawn and cleanup

**Files:**
- Create: `packages/server/src/routes/terminal/pty.ts`
- Test: `packages/server/src/routes/terminal/pty.test.ts`

**Interfaces:**
- Consumes: `TerminalTarget` host or container, `buildHostTerminalEnv`, `buildDockerExecArgs`, `resolveBashPath`.
- Produces:

```ts
export interface SpawnedTerminal {
  write(data: string | Uint8Array): void;
  resize(cols: number, rows: number): void;
  kill(): void;
  exited: Promise<{ code: number | null; signal: string | null }>;
}

export function spawnTerminalPty(input: {
  target: Extract<TerminalTarget, { kind: 'host' } | { kind: 'container' }>;
  cols: number;
  rows: number;
  onData: (chunk: Uint8Array) => void;
}): SpawnedTerminal;
```

- [ ] **Step 1: Write the failing test**

```ts
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, test } from 'bun:test';
import { resolveBashPath } from '@archon/git';

import { spawnTerminalPty } from './pty';

describe('spawnTerminalPty host', () => {
  test('runs bash in the given cwd and echoes a marker', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'archon-pty-'));
    try {
      await writeFile(join(cwd, 'marker.txt'), 'ok', 'utf8');
      const chunks: Uint8Array[] = [];
      const pty = spawnTerminalPty({
        target: { kind: 'host', cwd, shell: resolveBashPath() },
        cols: 80,
        rows: 24,
        onData: chunk => {
          chunks.push(chunk);
        },
      });
      pty.write('cat marker.txt\nexit\n');
      const result = await pty.exited;
      const text = Buffer.concat(chunks).toString('utf8');
      expect(text).toContain('ok');
      expect(result.code === 0 || result.code === null || result.signal === null).toBe(true);
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `(cd packages/server && bun test src/routes/terminal/pty.test.ts)`
Expected: FAIL because `./pty` is not defined.

- [ ] **Step 3: Write minimal implementation**

For host, `Bun.spawn([shell, '-l'], { cwd, env: buildHostTerminalEnv(process.env), terminal: { cols, rows, name: 'xterm-256color', data(_t, data) { onData(data instanceof Uint8Array ? data : Buffer.from(data)); } } })`.
For container, `Bun.spawn(['docker', ...buildDockerExecArgs(cwd, containerId, '/bin/bash')], { terminal: { ... } })` with no custom `env` so the docker CLI does not receive Archon secrets as the child environment beyond what the allowlist would keep if you must pass env; prefer `env: buildHostTerminalEnv(process.env)` for the docker CLI process too so tokens are not in `ps`.
`write` calls `proc.terminal.write`.
`resize` calls `proc.terminal.resize`.
`kill` calls `proc.kill('SIGTERM')` then `proc.terminal.close()`.
`exited` is `proc.exited.then(code => ({ code, signal: proc.signalCode }))`.

- [ ] **Step 4: Run test to verify it passes**

Run: `(cd packages/server && bun test src/routes/terminal/pty.test.ts)`
Expected: PASS and print `ok` from the temp file.

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/routes/terminal/pty.ts packages/server/src/routes/terminal/pty.test.ts
git commit -m "feat(server): spawn Bun.Terminal host shells for run terminals"
```

---

### Task 8: WebSocket upgrade, auth, and Bun.serve wiring

**Files:**
- Create: `packages/server/src/routes/terminal/upgrade.ts`
- Create: `packages/server/src/routes/terminal/index.ts`
- Test: `packages/server/src/routes/terminal/upgrade.test.ts`
- Modify: `packages/server/src/index.ts`
- Modify: `packages/server/package.json`
- Modify: `packages/web/vite.config.ts`

**Interfaces:**
- Consumes: Tasks 1–7, `getAuth` from `packages/server/src/auth`, `findOrCreateUserByPlatformIdentity` from `@archon/core`, `isApiGateEnabled` from `packages/server/src/auth/config.ts`, `workflowDb.getWorkflowRun`, `isolationEnvDb.getById`.
- Produces: `isTerminalUpgradeRequest`, `handleTerminalUpgrade`, `terminalWebsocket`, `destroyAllTerminalSessions`.

Socket data:

```ts
export interface TerminalSocketData {
  runId: string;
  userId: string;
  resumeToken: string | null;
}
```

- [ ] **Step 1: Write the failing upgrade test**

```ts
import { describe, expect, mock, test } from 'bun:test';

mock.module('@archon/core/db/workflows', () => ({
  getWorkflowRun: async (id: string) =>
    id === 'run-1'
      ? { id: 'run-1', working_path: '/tmp', metadata: {}, conversation_id: 'c' }
      : null,
}));
mock.module('@archon/core/db/isolation-environments', () => ({
  getById: async () => null,
}));

import { handleTerminalUpgrade, isTerminalUpgradeRequest } from './upgrade';

describe('handleTerminalUpgrade', () => {
  test('matches the terminal path', () => {
    expect(isTerminalUpgradeRequest('/api/workflows/runs/run-1/terminal')).toBe(true);
    expect(isTerminalUpgradeRequest('/api/workflows/runs/run-1/git/changes')).toBe(false);
  });

  test('returns 403 without Origin', async () => {
    const res = await handleTerminalUpgrade(
      new Request('http://localhost:3090/api/workflows/runs/run-1/terminal', {
        headers: { Host: 'localhost:3090' },
      }),
      { upgrade: () => false }
    );
    expect(res.status).toBe(403);
  });

  test('returns 401 when the API gate is on and no identity is present', async () => {
    const prev = process.env.ARCHON_WEB_AUTH_REQUIRED;
    const db = process.env.DATABASE_URL;
    const secret = process.env.BETTER_AUTH_SECRET;
    process.env.DATABASE_URL = 'postgres://x';
    process.env.BETTER_AUTH_SECRET = 'x'.repeat(32);
    delete process.env.ARCHON_WEB_AUTH_REQUIRED;
    try {
      const res = await handleTerminalUpgrade(
        new Request('http://localhost:3090/api/workflows/runs/run-1/terminal', {
          headers: { Host: 'localhost:3090', Origin: 'http://localhost:3090' },
        }),
        { upgrade: () => false }
      );
      expect(res.status).toBe(401);
    } finally {
      if (prev === undefined) delete process.env.ARCHON_WEB_AUTH_REQUIRED;
      else process.env.ARCHON_WEB_AUTH_REQUIRED = prev;
      if (db === undefined) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = db;
      if (secret === undefined) delete process.env.BETTER_AUTH_SECRET;
      else process.env.BETTER_AUTH_SECRET = secret;
    }
  });

  test('returns 404 for an unknown run after origin succeeds when the gate is off', async () => {
    const res = await handleTerminalUpgrade(
      new Request('http://localhost:3090/api/workflows/runs/missing/terminal', {
        headers: { Host: 'localhost:3090', Origin: 'http://localhost:3090' },
      }),
      { upgrade: () => false }
    );
    expect(res.status).toBe(404);
  });
});
```

Keep this file in its own `bun test` invocation because of `mock.module`.

- [ ] **Step 2: Run test to verify it fails**

Run: `(cd packages/server && bun test src/routes/terminal/upgrade.test.ts)`
Expected: FAIL because `./upgrade` is not defined.

- [ ] **Step 3: Write upgrade.ts and index.ts**

`handleTerminalUpgrade` order: origin, auth, parse `runId`, load run, then `server.upgrade(req, { data: { runId, userId, resumeToken } })`.
On successful upgrade return a dummy `undefined as unknown as Response` only if Bun requires it; Bun's `upgrade` returning true means the fetch handler should return `undefined`.
Type the fetch return as `Response | undefined`.
`terminalWebsocket.open` resolves the target with real `fs.stat` / `realpath` / docker inspect, spawns a PTY or sends `unavailable`, and sends `ready`.
`message` parses control JSON or writes binary input.
`close` without a prior `close` message calls `markDisconnected`.
`drain` flushes pending bytes.
Do not log frame payloads.

Wire `packages/server/src/index.ts` as:

```ts
import {
  destroyAllTerminalSessions,
  handleTerminalUpgrade,
  isTerminalUpgradeRequest,
  terminalWebsocket,
} from './routes/terminal';

const server = Bun.serve({
  async fetch(req, bunServer) {
    const path = new URL(req.url).pathname;
    if (isTerminalUpgradeRequest(path)) {
      return handleTerminalUpgrade(req, bunServer);
    }
    return app.fetch(req);
  },
  websocket: terminalWebsocket,
  hostname,
  port,
  idleTimeout: 255,
});
```

Call `destroyAllTerminalSessions()` at the start of `shutdown` before `stopCleanupScheduler()`.

Set Vite proxy:

```ts
'/api': {
  target: `http://localhost:${apiPort}`,
  changeOrigin: true,
  ws: true,
},
```

Insert isolated tests into `packages/server/package.json` immediately after `bun test src/routes/git/checkout-gate.test.ts`:

```text
bun test src/routes/terminal/origin.test.ts && bun test src/routes/terminal/env.test.ts && bun test src/routes/terminal/target.test.ts && bun test src/routes/terminal/docker.test.ts && bun test src/routes/terminal/protocol.test.ts && bun test src/routes/terminal/session.test.ts && bun test src/routes/terminal/pty.test.ts && bun test src/routes/terminal/upgrade.test.ts &&
```

- [ ] **Step 4: Run tests to verify they pass**

Run:

```bash
(cd packages/server && bun test src/routes/terminal/origin.test.ts && bun test src/routes/terminal/env.test.ts && bun test src/routes/terminal/target.test.ts && bun test src/routes/terminal/docker.test.ts && bun test src/routes/terminal/protocol.test.ts && bun test src/routes/terminal/session.test.ts && bun test src/routes/terminal/pty.test.ts && bun test src/routes/terminal/upgrade.test.ts)
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/routes/terminal packages/server/src/index.ts packages/server/package.json packages/web/vite.config.ts
git commit -m "feat(server): serve authenticated run terminals over Bun WebSocket"
```

---

### Task 9: Legacy run-page Terminal tab

**Files:**
- Modify: `packages/web/package.json`
- Create: `packages/web/src/components/workflows/terminal/protocol.ts`
- Create: `packages/web/src/components/workflows/terminal/protocol.test.ts`
- Create: `packages/web/src/components/workflows/terminal/terminal-status.tsx`
- Create: `packages/web/src/components/workflows/terminal/terminal-status.test.tsx`
- Create: `packages/web/src/components/workflows/terminal/use-run-terminal.ts`
- Create: `packages/web/src/components/workflows/terminal/use-run-terminal.test.ts`
- Create: `packages/web/src/components/workflows/terminal/terminal-tab.tsx`
- Create: `packages/web/src/components/workflows/terminal/terminal-tab.test.tsx`
- Modify: `packages/web/src/components/workflows/source-control/dag-run-tabs.tsx`
- Modify: `packages/web/src/components/workflows/source-control/dag-run-tabs.test.tsx`
- Modify: `packages/web/src/components/workflows/WorkflowExecution.tsx`
- Modify: `packages/web/src/components/workflows/WorkflowExecution.test.tsx`

**Interfaces:**
- Consumes: Task 5/8 control protocol and same-origin WebSocket URL.
- Produces: `WorkflowRunView` includes `'terminal'`; `resolveWorkflowExecutionBody` returns `'terminal'` for that view; `TerminalTab` mounts xterm.

- [ ] **Step 1: Add xterm dependencies and failing tab tests**

Run:

```bash
(cd packages/web && bun add @xterm/xterm@5.5.0 @xterm/addon-fit@0.10.0)
```

Append to the web `test` script before the experiments console invocation:

```text
NODE_ENV=development bun test src/components/workflows/terminal/ &&
```

`dag-run-tabs.test.tsx` additions:

```ts
test('renders Terminal immediately after Source Control', () => {
  const html = render('parent-1');
  expect(html.indexOf('Source Control')).toBeLessThan(html.indexOf('Terminal'));
});
```

`WorkflowExecution.test.tsx` view list becomes `['graph', 'logs', 'chat', 'source-control', 'terminal']` and expected body maps `terminal: 'terminal'`.

`terminal-status.test.tsx` uses `renderToStaticMarkup` and asserts the locked copy strings for each reason plus `Connecting to the run terminal`, `Reconnecting`, `The shell exited`, and `Could not open the terminal`.

`protocol.test.ts` mirrors server parse bounds for input/resize so the client rejects locally before send.

`use-run-terminal.test.ts` fakes `WebSocket` with a class that records `sent`, implements `onopen` / `onmessage`, and asserts:

- URL is `ws://localhost:5173/api/workflows/runs/run-1/terminal` when `window.location` is `http://localhost:5173/legacy/workflows/runs/run-1`.
- A stored sessionStorage token is sent as `?resume=`.
- `ready` writes the new token to `sessionStorage`.
- `input` JSON is sent on `onData`.
- Binary messages are written to the terminal adapter.
- Socket close without `exit` enters `reconnecting` and reconnects once.

`terminal-tab.test.tsx` renders static markup for the status overlay and a `role="region"` labelled `Terminal`.

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
(cd packages/web && NODE_ENV=development bun test src/components/workflows/source-control/dag-run-tabs.test.tsx src/components/workflows/WorkflowExecution.test.tsx src/components/workflows/terminal/)
```

Expected: FAIL on missing `'terminal'` view and missing module files.

- [ ] **Step 3: Write minimal implementation**

Extend `WorkflowRunView` with `'terminal'` and add `<TabsTrigger value="terminal">Terminal</TabsTrigger>` immediately after Source Control.
`resolveWorkflowExecutionBody` returns `'terminal'` when `activeView === 'terminal'`.
`renderBody` returns `<TerminalTab key={runId} runId={runId} />`.
`TerminalTab` creates an xterm instance in `useEffect`, loads `FitAddon`, calls `useRunTerminal`, and shows `TerminalStatus` when status is not `connected`.
`useRunTerminal` constructs:

```ts
const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
const resume = sessionStorage.getItem(`archon.terminal.resume.${runId}`);
const url = `${protocol}//${window.location.host}/api/workflows/runs/${encodeURIComponent(runId)}/terminal${resume ? `?resume=${encodeURIComponent(resume)}` : ''}`;
```

Do not use `SSE_BASE_URL` (that bypasses the Vite proxy and would drop first-party cookies).
On unmount, close the socket without sending `{ type: 'close' }` so the two-minute window remains.
Provide a visible "Close session" only if you add no extra chrome; leaving the page is enough.
FitAddon `onResize` sends `{ type: 'resize', cols, rows }`.
Read theme tokens from `getComputedStyle(document.documentElement)`.

- [ ] **Step 4: Run tests to verify they pass**

Run:

```bash
(cd packages/web && NODE_ENV=development bun test src/components/workflows/source-control/dag-run-tabs.test.tsx src/components/workflows/WorkflowExecution.test.tsx src/components/workflows/terminal/)
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/web/package.json packages/web/src/components/workflows/terminal packages/web/src/components/workflows/source-control/dag-run-tabs.tsx packages/web/src/components/workflows/source-control/dag-run-tabs.test.tsx packages/web/src/components/workflows/WorkflowExecution.tsx packages/web/src/components/workflows/WorkflowExecution.test.tsx
git commit -m "feat(web): add Terminal tab after Source Control on legacy run page"
```

---

### Task 10: Docs, walkthrough notes, and validation

**Files:**
- Modify: `packages/docs-web/src/content/docs/adapters/web.md`
- Modify: `packages/docs-web/src/content/docs/reference/api.md`
- Modify: `packages/docs-web/src/content/docs/reference/security.md`

**Interfaces:**
- Consumes: the locked WebSocket URL, auth rules, env allowlist, and UI copy from earlier tasks.
- Produces: operator-facing documentation that matches the implementation.

- [ ] **Step 1: Update Web UI docs**

In `adapters/web.md` under **Execution Detail Page**, add that DAG runs show Graph, Logs, optional Chat, Source Control, and Terminal.
State that Terminal opens a shell in the run's worktree, folder, or managed container.
State that the shell has the OS permissions of the Archon service account and is not a filesystem sandbox.
State that leaving the tab keeps the shell for two minutes for reconnect, and that output is not saved.

- [ ] **Step 2: Update API docs**

After the Runs section in `reference/api.md`, add:

```md
### Run terminal

`GET /api/workflows/runs/{runId}/terminal` is a WebSocket upgrade, not a JSON REST method.

The browser must send a same-origin `Origin`.
When web auth is enabled, the existing `/api/*` identity rules apply (Better Auth session or `X-Archon-User`).
The server resolves the shell from `working_path` or `metadata.isolation_env_id` and ignores any client-supplied path or container id.

Control messages are JSON text: `input`, `resize`, `close` from the client; `ready`, `exit`, `unavailable`, `error` from the server.
PTY output is sent as binary frames.
A `resume` query parameter reconnects a disconnected session for up to two minutes.
```

- [ ] **Step 3: Update security docs**

Add an **Interactive run terminal** section to `reference/security.md` after **Subprocess env isolation**.
State that the feature exposes an interactive shell as the Archon service user.
State that host children receive only the allowlisted environment and never `DATABASE_URL`, `TOKEN_ENCRYPTION_KEY`, `BETTER_AUTH_SECRET`, adapter tokens, or provider credentials.
State that logs record session lifecycle ids only.
State that all authenticated web users can open a terminal by product decision.

- [ ] **Step 4: Run focused suites then validate**

```bash
(cd packages/server && bun test src/routes/terminal/origin.test.ts && bun test src/routes/terminal/env.test.ts && bun test src/routes/terminal/target.test.ts && bun test src/routes/terminal/docker.test.ts && bun test src/routes/terminal/protocol.test.ts && bun test src/routes/terminal/session.test.ts && bun test src/routes/terminal/pty.test.ts && bun test src/routes/terminal/upgrade.test.ts)
(cd packages/web && NODE_ENV=development bun test src/components/workflows/source-control/dag-run-tabs.test.tsx src/components/workflows/WorkflowExecution.test.tsx src/components/workflows/terminal/)
git diff --check
bun run validate
```

Expected: every command exits 0.

Manual host walkthrough (operator, not CI):

1. Start `bun run dev`.
2. Open a DAG run on `/legacy/workflows/runs/:id`.
3. Confirm `Terminal` sits immediately after `Source Control`.
4. Open the tab and see a prompt in the run worktree or folder.
5. Type `pwd` and confirm it matches the run checkout.
6. Type `Ctrl-C` against `sleep 30` and confirm the prompt returns.
7. Reload the tab within two minutes and confirm the session resumes.
8. Confirm the browser network panel does not send `working_path`.

Manual container walkthrough (operator, not CI):

1. Open a folder-project run with `metadata.isolation === 'container'`.
2. Confirm the shell is inside the container (`cat /etc/os-release` or `hostname`).
3. Stop the container and reopen Terminal; confirm the unavailable copy, not a host shell.

- [ ] **Step 5: Commit**

```bash
git add packages/docs-web/src/content/docs/adapters/web.md packages/docs-web/src/content/docs/reference/api.md packages/docs-web/src/content/docs/reference/security.md
git commit -m "docs: document the workflow run terminal websocket and security model"
```

---

## Acceptance Criteria

- The legacy DAG run page shows `Terminal` immediately after `Source Control`.
- Opening the tab creates a real PTY at the server-resolved execution location.
- Host worktree, in-place folder, and managed container runs work.
- The browser never supplies or overrides the working path, isolation environment ID, or container ID.
- All web users can use the feature, subject to the existing installation auth gate.
- A disconnected per-user run session can reconnect for up to two minutes.
- Missing or destroyed targets fail clearly without falling back from container to host.
- Input, resize, origin, auth, resume token, output buffer, and backpressure boundaries are validated by tests in Tasks 1–8.
- Every PTY is cleaned up on explicit close, expiry, process exit, and server shutdown.
- Server secrets, terminal commands, and terminal output do not enter logs or persistent storage.
- Focused server, WebSocket, PTY, container-command, and web component tests pass.
- User-facing terminal and API documentation is updated.
- `bun run validate` passes.

---

## Validation Commands

```bash
(cd packages/server && bun test src/routes/terminal/origin.test.ts && bun test src/routes/terminal/env.test.ts && bun test src/routes/terminal/target.test.ts && bun test src/routes/terminal/docker.test.ts && bun test src/routes/terminal/protocol.test.ts && bun test src/routes/terminal/session.test.ts && bun test src/routes/terminal/pty.test.ts && bun test src/routes/terminal/upgrade.test.ts)
(cd packages/web && NODE_ENV=development bun test src/components/workflows/source-control/dag-run-tabs.test.tsx src/components/workflows/WorkflowExecution.test.tsx src/components/workflows/terminal/)
git diff --check
bun run validate
```
