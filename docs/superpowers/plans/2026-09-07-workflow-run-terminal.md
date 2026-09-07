# Interactive Workflow Run Terminal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.
> Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `Terminal` tab immediately after `Source Control` on the legacy DAG workflow run page that opens or resumes a real PTY in the server-resolved run checkout or managed container.

**Architecture:** The legacy React page mounts xterm.js and connects to a same-origin Bun WebSocket endpoint.
The server authenticates the upgrade, resolves every path and container handle from database rows, owns one in-memory PTY per resolved web user and run, and retains a disconnected PTY for two minutes.
The session manager owns replay, backpressure, takeover, expiry, process-exit, explicit-close, and shutdown cleanup so no lifecycle path can orphan a PTY.

**Tech Stack:** Bun 1.3.5 or newer in the 1.x line, TypeScript, Bun WebSockets, inline `Bun.spawn({ terminal: terminalOptions })` PTYs, Hono for the existing REST application, React 19, `@xterm/xterm` 5.5.0, `@xterm/addon-fit` 0.10.0, and Bun tests.

**Spec:** GitHub issue [#130](https://github.com/anhle128/Archon/issues/130) is the approved requirements record for this plan.
The issue cites `docs/superpowers/specs/2026-09-07-workflow-run-terminal-design.md` at commit `de85f9d6`, but that commit and file are unavailable in this checkout and from the GitHub repository.
Use the issue body, included and excluded scope, security considerations, and definition of done as the canonical approved brainstorm input.

## Global Constraints

- Limit the UI change to `/legacy/workflows/runs/:runId`; do not modify `packages/web/src/experiments/console/`.
- Do not attach to an existing workflow node process.
- Do not add a filesystem sandbox or prevent a host shell from changing directories.
- Do not add shared terminals, named terminals, or multiple PTYs for one user and run.
- Do not persist terminal input, output, command history, session rows, or audit events.
- Do not add database schema changes.
- Do not support VM or remote isolation providers beyond returning a clear unavailable state.
- Do not import `@archon/isolation` into `@archon/server`; use structural row types at the server boundary.
- Resolve every host target from `workflow_runs.working_path` and every container handle from `workflow_runs.metadata.isolation_env_id` plus the referenced isolation row.
- Never read `working_path`, `cwd`, `isolation_env_id`, `containerId`, or `containerName` from the URL, query string, or WebSocket messages.
- A missing, destroyed, or stopped container must never fall back to a host shell.
- Permit terminals for every workflow status while the resolved checkout or live container exists.
- Resolve identity in the same order as the existing API gate: Better Auth session, then the trusted `ARCHON_WEB_AUTH_HEADER` header, then the solo identity only when the API gate is disabled.
- Allow every resolved web user; do not add run-owner or role authorization.
- Reject missing, malformed, and disallowed `Origin` headers before attempting a WebSocket upgrade.
- Give host shells an explicit environment allowlist and never copy Archon, database, adapter, Better Auth, or provider secrets.
- Give the local Docker CLI a separate explicit environment allowlist and pass only fixed `TERM` and `COLORTERM` values into the container.
- Use argv arrays for Docker calls and subprocesses; never interpolate a shell command string.
- Use `resolveBashPath()` from `@archon/git` for host shells.
- Spawn with inline Bun terminal options, not a pre-created `Bun.Terminal`, because the inline path gives the child a controlling terminal and preserves Ctrl-C behavior on Bun 1.3.x.
- Set the root Bun engine floor to `^1.3.5`, the first project-compatible line that exposes the terminal API represented by the existing `bun-types` floor.
- Treat Bun WebSocket `send()` results correctly: `-1` means Bun queued the frame and applied backpressure, `0` means the frame was dropped because the connection is unavailable, and a positive value is the number of bytes sent.
- Pino events may contain `runId`, `userId`, `targetKind`, and error type, but never commands, input, output, resume tokens, environment values, checkout paths, or container handles.
- The terminal WebSocket is not an OpenAPI route and must not use `registerOpenApiRoute`.
- Do not regenerate `packages/web/src/lib/api.generated.d.ts`; this feature adds no REST schema.
- Avoid `mock.module()` in the new terminal tests by injecting database, auth, clock, timer, socket, and spawn dependencies.
- Add one `bun test src/routes/terminal/` leg to the server package test script; the web package already discovers all tests under `src/components/`.
- Run component tests with `NODE_ENV=development`.
- Follow RED, verified RED, minimal GREEN, verified GREEN, and refactor order for every behavior change.
- Run command blocks from the repository root and use a subshell for package-local commands.
- Keep every full Markdown sentence on one physical line.

---

## File Structure

- Create `packages/server/src/routes/terminal/origin.ts` for same-origin validation.
- Create `packages/server/src/routes/terminal/origin.test.ts` for configured-origin, same-host, missing, and malformed-origin behavior.
- Create `packages/server/src/routes/terminal/env.ts` for separate host-shell and Docker-client environment allowlists.
- Create `packages/server/src/routes/terminal/env.test.ts` for allowlisted passthrough, forced terminal values, Docker connectivity variables, and secret stripping.
- Create `packages/server/src/routes/terminal/docker.ts` for Docker presence checks, shell selection, and exact `docker exec` argv.
- Create `packages/server/src/routes/terminal/docker.test.ts` for running, stopped, missing, infrastructure-error, shell, and argv behavior.
- Create `packages/server/src/routes/terminal/target.ts` for database-row-only host, folder, container, VM, and remote target resolution.
- Create `packages/server/src/routes/terminal/target.test.ts` for canonical directory checks, stable container-name selection, and every no-fallback case.
- Create `packages/server/src/routes/terminal/protocol.ts` for bounded client control parsing and server control serialization.
- Create `packages/server/src/routes/terminal/protocol.test.ts` for malformed input, extra untrusted fields, byte limits, integer resize bounds, and token validation.
- Create `packages/server/src/routes/terminal/pty.ts` for inline Bun PTY spawn, write, resize, exit, and idempotent kill.
- Create `packages/server/src/routes/terminal/pty.test.ts` for spawn specifications and one real POSIX host PTY including Ctrl-C.
- Create `packages/server/src/routes/terminal/session-manager.ts` for the per-user/run map, resume, active-socket takeover, replay, backpressure, and all cleanup paths.
- Create `packages/server/src/routes/terminal/session-manager.test.ts` for takeover, reconnect, invalid token, replay bounds, correct `send()` handling, overflow, explicit close, expiry, exit, and shutdown.
- Create `packages/server/src/routes/terminal/endpoint.ts` for auth, upgrade, WebSocket callbacks, target resolution, and protocol dispatch.
- Create `packages/server/src/routes/terminal/endpoint.test.ts` for auth precedence, solo fallback, origin rejection, missing run, upgrade data, input dispatch, and unavailable targets.
- Create `packages/server/src/routes/terminal/index.ts` as the narrow terminal endpoint barrel and fetch-wrapper export.
- Create `packages/server/src/routes/terminal/server-fetch.test.ts` to prove that the exact terminal path reaches the upgrade handler before Hono and unrelated paths still reach `app.fetch`.
- Modify `packages/server/src/index.ts` to install the wrapped fetch handler, `websocket` callbacks, and terminal shutdown cleanup.
- Modify `packages/server/package.json` to add one isolated terminal-directory test leg.
- Modify root `package.json` to raise `engines.bun` from `^1.3.0` to `^1.3.5`.
- Modify `packages/web/package.json` to add exact xterm dependencies.
- Modify `bun.lock` through `bun add --exact`.
- Modify `packages/web/vite.config.ts` to proxy WebSocket upgrades under `/api` in development.
- Create `packages/web/src/components/workflows/terminal/protocol.ts` for browser-side server-message parsing and UTF-8-safe bounded input chunks.
- Create `packages/web/src/components/workflows/terminal/protocol.test.ts` for control parsing, untrusted payload rejection, and multi-byte input chunking.
- Create `packages/web/src/components/workflows/terminal/client.ts` for same-origin URL construction, resume-token storage, socket lifecycle, reconnect backoff, input, resize, and explicit close.
- Create `packages/web/src/components/workflows/terminal/client.test.ts` with fake sockets, storage, clock, and timers.
- Create `packages/web/src/components/workflows/terminal/xterm-session.ts` for xterm, FitAddon, ResizeObserver, and terminal-client wiring.
- Create `packages/web/src/components/workflows/terminal/xterm-session.test.ts` with injected terminal, addon, observer, and client factories.
- Create `packages/web/src/components/workflows/terminal/terminal-status.tsx` for connecting, connected, reconnecting, unavailable, exited, closed, and error copy.
- Create `packages/web/src/components/workflows/terminal/terminal-status.test.tsx` for all visible states.
- Create `packages/web/src/components/workflows/terminal/terminal-tab.tsx` for the terminal region and explicit `Close terminal` action.
- Create `packages/web/src/components/workflows/terminal/terminal-tab.test.tsx` for accessible region, status, and close action rendering.
- Modify `packages/web/src/components/workflows/source-control/dag-run-tabs.tsx` and its test to insert `Terminal` immediately after `Source Control`.
- Modify `packages/web/src/components/workflows/WorkflowExecution.tsx` and its test to render `TerminalTab` only for the DAG terminal view.
- Modify `packages/docs-web/src/content/docs/adapters/web.md` for the legacy run-page workflow and reconnect behavior.
- Modify `packages/docs-web/src/content/docs/reference/api.md` for the non-OpenAPI WebSocket protocol.
- Modify `packages/docs-web/src/content/docs/reference/security.md` for shell authority, identity, origin, environment, logging, and persistence boundaries.

---

## Locked Contracts

```ts
export const TERMINAL_PATH_RE = /^\/api\/workflows\/runs\/([^/]+)\/terminal$/;
export const RECONNECT_MS = 120_000;
export const REPLAY_MAX_BYTES = 256 * 1024;
export const INPUT_MAX_BYTES = 64 * 1024;
export const PENDING_MAX_BYTES = 1024 * 1024;
export const MAX_CLIENT_FRAME_BYTES = INPUT_MAX_BYTES * 6 + 1024;
export const MIN_COLS = 1;
export const MAX_COLS = 500;
export const MIN_ROWS = 1;
export const MAX_ROWS = 200;
export const DEFAULT_COLS = 80;
export const DEFAULT_ROWS = 24;
export const SOLO_TERMINAL_USER_ID = 'solo';
export const REPLACED_SOCKET_CLOSE_CODE = 4001;

export type TerminalUnavailableReason =
  | 'no_checkout'
  | 'container_missing'
  | 'container_stopped'
  | 'unsupported_provider';

export type TerminalTarget =
  | { kind: 'host'; cwd: string; shell: string }
  | { kind: 'container'; cwd: string; handle: string; shell: '/bin/bash' | '/bin/sh' }
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
```

The WebSocket URL is `GET /api/workflows/runs/{runId}/terminal` with an optional server-issued `resume` query parameter.
Client and server control frames are UTF-8 JSON text, and PTY output frames are binary `Uint8Array` values.
The server rejects binary client frames because xterm input is encoded through the bounded JSON `input` message.
The parser ignores extra keys and returns only the locked fields, so a forged path or container field can never cross the protocol boundary.
The transport frame cap allows the worst-case six-byte JSON escape expansion of a valid 64 KiB input value plus a small control envelope while remaining below 400 KiB.
The server accepts resume tokens only when they match `/^[0-9a-f]{64}$/`; malformed tokens are treated as absent and are never logged.

When `WEB_UI_ORIGIN` contains a concrete HTTP or HTTPS origin, the request origin must have the same normalized `.origin` value.
When `WEB_UI_ORIGIN` is unset or `*`, the origin hostname must equal the request `Host` hostname, while ports may differ for the Vite proxy.
Missing, malformed, opaque, and non-HTTP origins return HTTP 403 with `{ "error": "Forbidden origin" }`.

Identity resolution always tries a Better Auth session first and the trusted web identity header second.
When either identity resolves, the terminal key uses the canonical `remote_agent_users.id` even when `ARCHON_WEB_AUTH_REQUIRED=false`.
When neither identity resolves and `isApiGateEnabled()` is true, the upgrade returns HTTP 401 with `{ "error": "Authentication required" }`.
When neither identity resolves and the API gate is false, the terminal key uses `solo`.

The target resolver requires a non-empty `run.working_path` for host and container targets.
If `run.metadata.isolation_env_id` is present, the resolver loads exactly that isolation row before choosing a provider path.
Provider `container` resolves only when the row is active, has `metadata.containerName` or `metadata.containerId`, and Docker reports the handle running.
The stable `containerName` wins over `containerId` because container resume may recreate the container under the same name while the stored ID becomes stale.
Provider `worktree` continues through host directory resolution.
Providers `vm`, `remote`, and unrecognized provider values return `unsupported_provider`.
An explicit `metadata.isolation === 'container'` without a usable environment ID returns `container_missing`.
Any missing or destroyed row for a container-marked run returns `container_missing` without probing the host path.
A missing isolation row on a run that is not container-marked continues through server-owned host directory resolution because isolated worktree child runs also stamp `isolation_env_id`.
Host resolution calls `realpath(run.working_path)` and then requires `stat(canonicalPath).isDirectory()`; it does not require a Git repository.

The container command is built exactly as follows, with no client values and no copied host environment values after `-e`.

```ts
[
  'exec',
  '-i',
  '-t',
  '-e',
  'TERM=xterm-256color',
  '-e',
  'COLORTERM=truecolor',
  '-w',
  cwd,
  handle,
  shell,
]
```

The container shell is `/bin/bash` when `docker exec <handle> test -x /bin/bash` succeeds and `/bin/sh` only when that executable check exits non-zero while a follow-up inspect still proves the container is running.
Docker inspect errors classified as `No such object` or `No such container` map to `missing`; all other Docker errors are rethrown and surface as a generic terminal-open failure.

The host spawn is equivalent to the following call and must use the inline `terminal` object.

```ts
Bun.spawn([shell, '-l'], {
  cwd,
  env: buildHostTerminalEnv(process.env),
  terminal: {
    cols,
    rows,
    name: 'xterm-256color',
    data(_terminal, bytes) {
      onData(bytes);
    },
  },
});
```

The local Docker CLI spawn uses `buildDockerClientEnv(process.env)` and the same inline terminal options.
`buildDockerClientEnv` may retain only the host basics plus `DOCKER_HOST`, `DOCKER_CONTEXT`, `DOCKER_CONFIG`, `DOCKER_TLS_VERIFY`, and `DOCKER_CERT_PATH`.

The session map key is `${userId}:${runId}` and the resume token is `randomBytes(32).toString('hex')`.
An active second socket for the same key takes over the existing PTY without requiring a token, receives the replay buffer, and closes the old socket with code 4001.
The old socket's later close callback does nothing because it no longer owns the session.
A disconnected socket may reattach only with the matching token before the two-minute deadline.
A missing or invalid token for a disconnected session destroys the old PTY and permits a fresh session.
The replay buffer retains at most the newest 256 KiB and is replayed as binary frames before the next `ready` control frame.
Explicit `close`, PTY exit, replay or backpressure overflow, two-minute expiry, and server shutdown all remove the map entry and idempotently kill and close the PTY.

The first `ws.send(output)` returning `-1` is already queued by Bun and is not duplicated in the application's pending queue.
While a socket is backpressured, later PTY chunks enter the application queue in order.
The application queue plus `ws.getBufferedAmount()` may not exceed 1 MiB.
`drain` flushes in order until the queue is empty or another send returns `-1`.
A send result of `0` detaches the socket and starts the reconnect timer; the replay buffer preserves the dropped output for a valid reconnect.
Before destroying an overflowing session, the manager attempts to send `{ type: 'error', message: 'Terminal output overflowed.' }` and closes the socket with code 1011.
Takeover and disconnect clear the old application pending queue and backpressure flag because the bounded replay suffix becomes the authoritative reconnect snapshot.
Reconnect sends one concatenated replay frame and sends `ready` immediately after it only when the replay send is accepted without backpressure.
When replay returns `-1`, the manager marks `ready` pending and sends it from `drain` after all output queued during replay has been accepted, preserving replay-output-ready order without duplicating Bun's queue.

The browser stores only the resume token in `sessionStorage` under `archon.terminal.resume.${runId}`.
It removes the token after explicit close, unavailable, error, or process exit and retains it across tab unmount or an unexpected socket close.
The client retries unexpected disconnects with capped backoff until the server's two-minute reconnect deadline.
Close code 4001 stops reconnect in the replaced tab so two tabs cannot repeatedly steal the PTY from each other.

Unavailable copy is locked as follows.

- `no_checkout`: `This run's checkout isn't available — it may not be ready yet, or it may have been cleaned up.`
- `container_missing` and `container_stopped`: `This run's container isn't available — it may have been stopped or cleaned up.`
- `unsupported_provider`: `This run uses an isolation provider the terminal cannot open.`

The remaining visible state copy is `Connecting…`, `Connected`, `Reconnecting…`, `Terminal closed.`, `Terminal opened in another tab.`, and the fixed public server error message.
An exit with a numeric code renders `Terminal exited with code {code}.`, an exit with only a signal renders `Terminal exited after {signal}.`, and an exit with neither renders `Terminal exited.`.

Lifecycle logging is limited to `terminal.session_started`, `terminal.session_reconnected`, `terminal.session_completed`, `terminal.session_failed`, `terminal.session_expired`, and `terminal.pty_exited` with the safe metadata listed in Global Constraints.

---

## Open Questions

### OQ-1 — Unavailable design file

The issue names a design file and commit that cannot be recovered locally or from `origin`.
**Safe provisional default:** treat the complete issue body as the approved brainstorm and do not block implementation on the missing file.

### OQ-2 — Framing and numeric bounds

The issue requires validation, bounded replay, and backpressure but does not choose framing or byte and resize limits.
**Safe provisional default:** use the framing and conservative constants in Locked Contracts and keep them private implementation constants rather than configuration surface.

### OQ-3 — Takeover and token transport

The issue specifies one terminal per user and run plus reconnect but does not define a second active tab or browser token storage.
**Safe provisional default:** let a second active socket take over, require the opaque query token only for disconnected reattachment, and keep that token in per-tab `sessionStorage` only.

---

### Task 1: Same-origin boundary

**Files:**
- Create: `packages/server/src/routes/terminal/origin.ts`
- Test: `packages/server/src/routes/terminal/origin.test.ts`

**Interfaces:**
- Consumes: `Request` headers plus `NodeJS.ProcessEnv`.
- Produces: `TerminalOriginError` and `assertTerminalOrigin(request: Request, env?: NodeJS.ProcessEnv): void`.

- [ ] **Step 1: Write the failing origin tests**

```ts
import { describe, expect, test } from 'bun:test';

import { TerminalOriginError, assertTerminalOrigin } from './origin';

function request(origin: string | null, host = 'localhost:3090'): Request {
  const headers = new Headers({ Host: host });
  if (origin !== null) headers.set('Origin', origin);
  return new Request('http://localhost:3090/api/workflows/runs/run-1/terminal', { headers });
}

describe('assertTerminalOrigin', () => {
  test('rejects missing, malformed, opaque, and cross-host origins', () => {
    for (const origin of [null, 'not a url', 'null', 'file:///tmp/index.html', 'https://evil.test']) {
      expect(() => assertTerminalOrigin(request(origin), {})).toThrow(TerminalOriginError);
    }
  });

  test('allows the Vite origin when only the port differs', () => {
    expect(() => assertTerminalOrigin(request('http://localhost:5173'), {})).not.toThrow();
  });

  test('normalizes a concrete WEB_UI_ORIGIN and rejects every other origin', () => {
    const env = { WEB_UI_ORIGIN: 'https://archon.example/' };
    expect(() =>
      assertTerminalOrigin(request('https://archon.example', 'archon.example'), env)
    ).not.toThrow();
    expect(() =>
      assertTerminalOrigin(request('http://archon.example', 'archon.example'), env)
    ).toThrow(TerminalOriginError);
  });

  test('treats WEB_UI_ORIGIN=* as same-host rather than allow-all', () => {
    expect(() =>
      assertTerminalOrigin(request('http://localhost:5173'), { WEB_UI_ORIGIN: '*' })
    ).not.toThrow();
    expect(() =>
      assertTerminalOrigin(request('http://other.test:5173'), { WEB_UI_ORIGIN: '*' })
    ).toThrow(TerminalOriginError);
  });
});
```

- [ ] **Step 2: Run the test and verify RED**

Run: `(cd packages/server && bun test src/routes/terminal/origin.test.ts)`.
Expected: FAIL because `./origin` does not exist.

- [ ] **Step 3: Implement normalized HTTP-origin comparison**

```ts
export class TerminalOriginError extends Error {
  readonly status = 403;

  constructor() {
    super('Forbidden origin');
    this.name = 'TerminalOriginError';
  }
}

function httpOrigin(value: string): URL | null {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed : null;
  } catch {
    return null;
  }
}

function hostName(value: string): string | null {
  try {
    return new URL(`http://${value}`).hostname;
  } catch {
    return null;
  }
}

export function assertTerminalOrigin(
  request: Request,
  env: NodeJS.ProcessEnv = process.env
): void {
  const origin = httpOrigin(request.headers.get('Origin')?.trim() ?? '');
  if (!origin || origin.origin === 'null') throw new TerminalOriginError();
  const configured = env.WEB_UI_ORIGIN?.trim();
  if (configured && configured !== '*') {
    const allowed = httpOrigin(configured);
    if (!allowed || allowed.origin !== origin.origin) throw new TerminalOriginError();
    return;
  }
  if (hostName(request.headers.get('Host') ?? '') !== origin.hostname) {
    throw new TerminalOriginError();
  }
}
```

- [ ] **Step 4: Run the test and verify GREEN**

Run: `(cd packages/server && bun test src/routes/terminal/origin.test.ts)`.
Expected: PASS.

- [ ] **Step 5: Commit the boundary**

```bash
git add packages/server/src/routes/terminal/origin.ts packages/server/src/routes/terminal/origin.test.ts
git commit -m "feat(server): validate workflow terminal websocket origins"
```

---

### Task 2: Explicit subprocess environments

**Files:**
- Create: `packages/server/src/routes/terminal/env.ts`
- Test: `packages/server/src/routes/terminal/env.test.ts`

**Interfaces:**
- Consumes: `NodeJS.ProcessEnv`.
- Produces: `buildHostTerminalEnv(source: NodeJS.ProcessEnv): Record<string, string>` and `buildDockerClientEnv(source: NodeJS.ProcessEnv): Record<string, string>`.

- [ ] **Step 1: Write the failing allowlist tests**

```ts
import { describe, expect, test } from 'bun:test';

import { buildDockerClientEnv, buildHostTerminalEnv } from './env';

const source = {
  HOME: '/Users/operator',
  USER: 'operator',
  PATH: '/usr/local/bin:/usr/bin:/bin',
  LANG: 'en_US.UTF-8',
  DOCKER_HOST: 'unix:///tmp/docker.sock',
  DATABASE_URL: 'postgres://secret',
  TOKEN_ENCRYPTION_KEY: 'secret',
  BETTER_AUTH_SECRET: 'secret',
  SLACK_BOT_TOKEN: 'secret',
  ANTHROPIC_API_KEY: 'secret',
  SSH_AUTH_SOCK: '/tmp/agent.sock',
  UNRELATED_SECRET: 'secret',
};

describe('terminal environments', () => {
  test('host shell receives basics and fixed terminal values only', () => {
    expect(buildHostTerminalEnv(source)).toEqual({
      HOME: '/Users/operator',
      USER: 'operator',
      PATH: '/usr/local/bin:/usr/bin:/bin',
      LANG: 'en_US.UTF-8',
      TERM: 'xterm-256color',
      COLORTERM: 'truecolor',
    });
  });

  test('Docker client additionally receives only Docker connection settings', () => {
    expect(buildDockerClientEnv(source)).toEqual({
      HOME: '/Users/operator',
      USER: 'operator',
      PATH: '/usr/local/bin:/usr/bin:/bin',
      LANG: 'en_US.UTF-8',
      TERM: 'xterm-256color',
      COLORTERM: 'truecolor',
      DOCKER_HOST: 'unix:///tmp/docker.sock',
    });
  });
});
```

- [ ] **Step 2: Run the test and verify RED**

Run: `(cd packages/server && bun test src/routes/terminal/env.test.ts)`.
Expected: FAIL because `./env` does not exist.

- [ ] **Step 3: Implement the two explicit allowlists**

Define `HOST_ENV_KEYS` as `HOME`, `USER`, `LOGNAME`, `SHELL`, `PATH`, `LANG`, `LC_ALL`, `LC_CTYPE`, `LC_MESSAGES`, `TZ`, `TMPDIR`, `USERPROFILE`, `HOMEDRIVE`, `HOMEPATH`, `PATHEXT`, `SYSTEMROOT`, and `COMSPEC`.
Define `DOCKER_ENV_KEYS` as the host keys plus `DOCKER_HOST`, `DOCKER_CONTEXT`, `DOCKER_CONFIG`, `DOCKER_TLS_VERIFY`, and `DOCKER_CERT_PATH`.
Copy only non-empty string values from the selected list and then overwrite `TERM` and `COLORTERM` with the locked constants.
Do not include `SSH_AUTH_SOCK`; forwarding it would delegate an authentication capability rather than a harmless shell setting.

```ts
const HOST_ENV_KEYS = [
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
  'USERPROFILE',
  'HOMEDRIVE',
  'HOMEPATH',
  'PATHEXT',
  'SYSTEMROOT',
  'COMSPEC',
] as const;

const DOCKER_ENV_KEYS = [
  ...HOST_ENV_KEYS,
  'DOCKER_HOST',
  'DOCKER_CONTEXT',
  'DOCKER_CONFIG',
  'DOCKER_TLS_VERIFY',
  'DOCKER_CERT_PATH',
] as const;

function copyAllowed(source: NodeJS.ProcessEnv, keys: readonly string[]): Record<string, string> {
  const result: Record<string, string> = {};
  for (const key of keys) {
    const value = source[key];
    if (typeof value === 'string' && value.length > 0) result[key] = value;
  }
  result.TERM = 'xterm-256color';
  result.COLORTERM = 'truecolor';
  return result;
}

export function buildHostTerminalEnv(source: NodeJS.ProcessEnv): Record<string, string> {
  return copyAllowed(source, HOST_ENV_KEYS);
}

export function buildDockerClientEnv(source: NodeJS.ProcessEnv): Record<string, string> {
  return copyAllowed(source, DOCKER_ENV_KEYS);
}
```

- [ ] **Step 4: Run the test and verify GREEN**

Run: `(cd packages/server && bun test src/routes/terminal/env.test.ts)`.
Expected: PASS with no secret values in failure output.

- [ ] **Step 5: Commit the environment boundary**

```bash
git add packages/server/src/routes/terminal/env.ts packages/server/src/routes/terminal/env.test.ts
git commit -m "feat(server): isolate workflow terminal subprocess environments"
```

---

### Task 3: Docker and database target resolution

**Files:**
- Create: `packages/server/src/routes/terminal/docker.ts`
- Create: `packages/server/src/routes/terminal/docker.test.ts`
- Create: `packages/server/src/routes/terminal/target.ts`
- Create: `packages/server/src/routes/terminal/target.test.ts`

**Interfaces:**
- Consumes: structural workflow and isolation rows, `execFileAsync`, `resolveBashPath`, `realpath`, and `stat` through injected ports.
- Produces: `inspectContainer`, `resolveContainerShell`, `buildDockerExecArgs`, and `resolveTerminalTarget`.

```ts
export interface TerminalRunRow {
  working_path: string | null;
  metadata: Record<string, unknown>;
}

export interface TerminalIsolationRow {
  provider: string;
  status: string;
  metadata: Record<string, unknown>;
}

export interface ResolveTerminalTargetDeps {
  getIsolationEnvById(id: string): Promise<TerminalIsolationRow | null>;
  canonicalDirectory(path: string): Promise<string | null>;
  inspectContainer(handle: string): Promise<'running' | 'stopped' | 'missing'>;
  resolveContainerShell(handle: string): Promise<'/bin/bash' | '/bin/sh'>;
  resolveHostShell(): string;
}

export async function resolveTerminalTarget(
  run: TerminalRunRow,
  deps: ResolveTerminalTargetDeps
): Promise<TerminalTarget>;
```

- [ ] **Step 1: Write failing Docker helper tests**

Test literal argv including fixed terminal values, stable input order, `inspect -f '{{.State.Running}}'`, missing-object classification, rethrow of a daemon error, and `/bin/bash` to `/bin/sh` selection only after a successful follow-up inspect.

```ts
expect(buildDockerExecArgs('/workspace/app', 'archon-run-1', '/bin/bash')).toEqual([
  'exec',
  '-i',
  '-t',
  '-e',
  'TERM=xterm-256color',
  '-e',
  'COLORTERM=truecolor',
  '-w',
  '/workspace/app',
  'archon-run-1',
  '/bin/bash',
]);
```

- [ ] **Step 2: Run the Docker tests and verify RED**

Run: `(cd packages/server && bun test src/routes/terminal/docker.test.ts)`.
Expected: FAIL because `./docker` does not exist.

- [ ] **Step 3: Implement Docker helpers with a five-second timeout**

Use `execFileAsync('docker', args, { timeout: 5_000 })` by default.
Classify only case-insensitive `no such object` and `no such container` text as missing.
Return stopped only when inspect stdout trims to `false`; throw on every other unexpected result or error.
Use the same stable handle for inspect, executable probing, and the final exec argv.

```ts
export type DockerRunner = (
  command: string,
  args: string[],
  options: { timeout: number }
) => Promise<{ stdout: string; stderr: string }>;

const runDocker: DockerRunner = (command, args, options) =>
  execFileAsync(command, args, options);

export function buildDockerExecArgs(
  cwd: string,
  handle: string,
  shell: '/bin/bash' | '/bin/sh'
): string[] {
  return [
    'exec',
    '-i',
    '-t',
    '-e',
    'TERM=xterm-256color',
    '-e',
    'COLORTERM=truecolor',
    '-w',
    cwd,
    handle,
    shell,
  ];
}

function dockerErrorText(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

export async function inspectContainer(
  handle: string,
  runner: DockerRunner = runDocker
): Promise<'running' | 'stopped' | 'missing'> {
  try {
    const result = await runner(
      'docker',
      ['inspect', '-f', '{{.State.Running}}', handle],
      { timeout: 5_000 }
    );
    const state = result.stdout.trim();
    if (state === 'true') return 'running';
    if (state === 'false') return 'stopped';
    throw new Error(`Unexpected Docker running state: ${state}`);
  } catch (error) {
    if (/no such (object|container)/i.test(dockerErrorText(error))) return 'missing';
    throw error;
  }
}

export async function resolveContainerShell(
  handle: string,
  runner: DockerRunner = runDocker
): Promise<'/bin/bash' | '/bin/sh'> {
  try {
    await runner('docker', ['exec', handle, 'test', '-x', '/bin/bash'], { timeout: 5_000 });
    return '/bin/bash';
  } catch (error) {
    if ((await inspectContainer(handle, runner)) !== 'running') throw error;
    return '/bin/sh';
  }
}
```

- [ ] **Step 4: Run the Docker tests and verify GREEN**

Run: `(cd packages/server && bun test src/routes/terminal/docker.test.ts)`.
Expected: PASS.

- [ ] **Step 5: Write failing target-resolution tests**

Cover these literal outcomes in `target.test.ts`.

- A host worktree and a non-Git folder both return the canonical real path and `resolveBashPath()` result.
- A missing, non-directory, or null `working_path` returns `no_checkout`.
- A container row prefers `containerName` over a deliberately stale `containerId`.
- A running container returns `run.working_path`, the chosen stable handle, and the probed shell.
- A stopped container returns `container_stopped`.
- A destroyed or missing container row, missing handle, or explicit container marker without an environment ID returns `container_missing` and never calls `canonicalDirectory`.
- VM and remote rows return `unsupported_provider`.
- A worktree isolation row continues through host directory resolution.
- A missing isolation row on a non-container-marked worktree run continues through host directory resolution.
- An unrecognized provider returns `unsupported_provider` without probing the host path.
- A forged `containerId` placed on the run metadata is never inspected.

- [ ] **Step 6: Run the target tests and verify RED**

Run: `(cd packages/server && bun test src/routes/terminal/target.test.ts)`.
Expected: FAIL because `./target` does not exist.

- [ ] **Step 7: Implement target resolution in the locked order**

Read `working_path` first and return `no_checkout` when it is absent.
Read only `metadata.isolation` and the string `metadata.isolation_env_id` from the run metadata.
When an environment ID exists, load its row and branch on its provider before considering the host filesystem.
Use `containerName` before `containerId`, and do not use the isolation row's `working_path` as a fallback for the run path.
Implement `canonicalDirectory` with `realpath` followed by `stat(canonicalPath).isDirectory()`, returning null for filesystem errors.

```ts
function nonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

export async function canonicalDirectory(path: string): Promise<string | null> {
  try {
    const canonicalPath = await realpath(path);
    return (await stat(canonicalPath)).isDirectory() ? canonicalPath : null;
  } catch {
    return null;
  }
}

export async function resolveTerminalTarget(
  run: TerminalRunRow,
  deps: ResolveTerminalTargetDeps
): Promise<TerminalTarget> {
  const cwd = nonEmptyString(run.working_path);
  if (!cwd) return { kind: 'unavailable', reason: 'no_checkout' };
  const envId = nonEmptyString(run.metadata.isolation_env_id);
  if (envId) {
    const environment = await deps.getIsolationEnvById(envId);
    if (!environment && run.metadata.isolation === 'container') {
      return { kind: 'unavailable', reason: 'container_missing' };
    }
    if (
      environment &&
      environment.provider !== 'container' &&
      environment.provider !== 'worktree'
    ) {
      return { kind: 'unavailable', reason: 'unsupported_provider' };
    }
    if (environment?.provider === 'container') {
      if (environment.status !== 'active') {
        return { kind: 'unavailable', reason: 'container_missing' };
      }
      const handle =
        nonEmptyString(environment.metadata.containerName) ??
        nonEmptyString(environment.metadata.containerId);
      if (!handle) return { kind: 'unavailable', reason: 'container_missing' };
      const presence = await deps.inspectContainer(handle);
      if (presence !== 'running') {
        return {
          kind: 'unavailable',
          reason: presence === 'stopped' ? 'container_stopped' : 'container_missing',
        };
      }
      return {
        kind: 'container',
        cwd,
        handle,
        shell: await deps.resolveContainerShell(handle),
      };
    }
  }
  if (run.metadata.isolation === 'container') {
    return { kind: 'unavailable', reason: 'container_missing' };
  }
  const canonicalPath = await deps.canonicalDirectory(cwd);
  return canonicalPath
    ? { kind: 'host', cwd: canonicalPath, shell: deps.resolveHostShell() }
    : { kind: 'unavailable', reason: 'no_checkout' };
}
```

- [ ] **Step 8: Run both suites and verify GREEN**

Run: `(cd packages/server && bun test src/routes/terminal/docker.test.ts src/routes/terminal/target.test.ts)`.
Expected: PASS.

- [ ] **Step 9: Commit target resolution**

```bash
git add packages/server/src/routes/terminal/docker.ts packages/server/src/routes/terminal/docker.test.ts packages/server/src/routes/terminal/target.ts packages/server/src/routes/terminal/target.test.ts
git commit -m "feat(server): resolve workflow terminal host and container targets"
```

---

### Task 4: Bounded WebSocket protocol

**Files:**
- Create: `packages/server/src/routes/terminal/protocol.ts`
- Test: `packages/server/src/routes/terminal/protocol.test.ts`

**Interfaces:**
- Consumes: a raw text frame and typed server control values.
- Produces: constants from Locked Contracts, `parseClientControlMessage`, `serializeServerControlMessage`, `isResumeToken`, and `unavailableMessage`.

- [ ] **Step 1: Write failing parser tests**

```ts
expect(parseClientControlMessage('{"type":"input","data":"pwd\\n"}')).toEqual({
  type: 'input',
  data: 'pwd\n',
});
expect(
  parseClientControlMessage(
    '{"type":"input","data":"x","cwd":"/etc","containerId":"forged"}'
  )
).toEqual({ type: 'input', data: 'x' });
expect(parseClientControlMessage('{"type":"resize","cols":120,"rows":40}')).toEqual({
  type: 'resize',
  cols: 120,
  rows: 40,
});
expect(parseClientControlMessage('{"type":"close"}')).toEqual({ type: 'close' });
expect(parseClientControlMessage('{')).toEqual({ error: 'invalid_message' });
expect(parseClientControlMessage('{"type":"resize","cols":80.5,"rows":24}')).toEqual({
  error: 'invalid_resize',
});
expect(isResumeToken('a'.repeat(64))).toBe(true);
expect(isResumeToken('A'.repeat(64))).toBe(false);
```

Add a UTF-8 byte test using `Buffer.byteLength`, not JavaScript string length, cover all four resize bounds, and assert `MAX_CLIENT_FRAME_BYTES` accommodates `JSON.stringify` of 64 KiB of null characters.

- [ ] **Step 2: Run the test and verify RED**

Run: `(cd packages/server && bun test src/routes/terminal/protocol.test.ts)`.
Expected: FAIL because `./protocol` does not exist.

- [ ] **Step 3: Implement strict discriminant parsing**

Parse JSON inside try/catch, require a non-null object, switch only on `type`, validate only the locked fields, and construct a fresh result object so extra keys are discarded.
Use `Buffer.byteLength(data, 'utf8') <= INPUT_MAX_BYTES` for input and `Number.isInteger` plus the locked ranges for resize.
Return the locked unavailable copy from a total `switch` over `TerminalUnavailableReason`.

```ts
export type ClientMessageParseResult = ClientControlMessage | { error: string };

export function isResumeToken(value: string | null | undefined): value is string {
  return typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
}

export function parseClientControlMessage(raw: string): ClientMessageParseResult {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return { error: 'invalid_message' };
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return { error: 'invalid_message' };
  }
  const record = value as Record<string, unknown>;
  if (record.type === 'input') {
    if (
      typeof record.data !== 'string' ||
      Buffer.byteLength(record.data, 'utf8') > INPUT_MAX_BYTES
    ) {
      return { error: 'invalid_input' };
    }
    return { type: 'input', data: record.data };
  }
  if (record.type === 'resize') {
    const cols = record.cols;
    const rows = record.rows;
    if (
      typeof cols !== 'number' ||
      typeof rows !== 'number' ||
      !Number.isInteger(cols) ||
      !Number.isInteger(rows) ||
      cols < MIN_COLS ||
      cols > MAX_COLS ||
      rows < MIN_ROWS ||
      rows > MAX_ROWS
    ) {
      return { error: 'invalid_resize' };
    }
    return { type: 'resize', cols, rows };
  }
  if (record.type === 'close') return { type: 'close' };
  return { error: 'invalid_message' };
}

export function serializeServerControlMessage(message: ServerControlMessage): string {
  return JSON.stringify(message);
}

export function unavailableMessage(reason: TerminalUnavailableReason): string {
  switch (reason) {
    case 'no_checkout':
      return "This run's checkout isn't available — it may not be ready yet, or it may have been cleaned up.";
    case 'container_missing':
    case 'container_stopped':
      return "This run's container isn't available — it may have been stopped or cleaned up.";
    case 'unsupported_provider':
      return 'This run uses an isolation provider the terminal cannot open.';
  }
}
```

- [ ] **Step 4: Run the test and verify GREEN**

Run: `(cd packages/server && bun test src/routes/terminal/protocol.test.ts)`.
Expected: PASS.

- [ ] **Step 5: Commit the protocol**

```bash
git add packages/server/src/routes/terminal/protocol.ts packages/server/src/routes/terminal/protocol.test.ts
git commit -m "feat(server): validate workflow terminal websocket frames"
```

---

### Task 5: Bun PTY adapter and runtime floor

**Files:**
- Create: `packages/server/src/routes/terminal/pty.ts`
- Test: `packages/server/src/routes/terminal/pty.test.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes: `TerminalTarget`, the environment builders, Docker argv, dimensions, and an output callback.
- Produces: `buildTerminalSpawnSpec` and `spawnTerminalPty`.

```ts
export interface SpawnedTerminal {
  write(data: string): void;
  resize(cols: number, rows: number): void;
  kill(): void;
  exited: Promise<{ code: number | null; signal: string | null }>;
}

export interface TerminalSpawnSpec {
  command: string[];
  cwd?: string;
  env: Record<string, string>;
}

export function buildTerminalSpawnSpec(
  target: Extract<TerminalTarget, { kind: 'host' | 'container' }>,
  sourceEnv: NodeJS.ProcessEnv
): TerminalSpawnSpec;

export function spawnTerminalPty(input: {
  target: Extract<TerminalTarget, { kind: 'host' | 'container' }>;
  cols: number;
  rows: number;
  onData(chunk: Uint8Array): void;
  sourceEnv?: NodeJS.ProcessEnv;
  spawn?: typeof Bun.spawn;
}): SpawnedTerminal;
```

- [ ] **Step 1: Write failing spawn-spec and fake-process tests**

Assert the exact host command, canonical host cwd, host allowlist, Docker command, absence of a Docker cwd, and Docker-client allowlist.
Inject a fake spawn result and prove `write`, `resize`, and repeated `kill` calls reach the terminal and process at most once.
Resolve the fake `exited` promise and assert the wrapper reports both exit code and signal.

- [ ] **Step 2: Run the unit tests and verify RED**

Run: `(cd packages/server && bun test src/routes/terminal/pty.test.ts)`.
Expected: FAIL because `./pty` does not exist.

- [ ] **Step 3: Implement spawn with inline terminal options**

Call `Bun.spawn(spec.command, { cwd: spec.cwd, env: spec.env, terminal: { cols, rows, name: 'xterm-256color', data(_terminal, chunk) { input.onData(chunk); } } })`.
Fail fast if `proc.terminal` is absent.
Make `kill()` idempotent, call `proc.kill('SIGTERM')` before `proc.terminal.close()`, and normalize `signalCode` to null.
Do not construct `new Bun.Terminal()`.

```ts
export function buildTerminalSpawnSpec(
  target: Extract<TerminalTarget, { kind: 'host' | 'container' }>,
  sourceEnv: NodeJS.ProcessEnv
): TerminalSpawnSpec {
  if (target.kind === 'host') {
    return {
      command: [target.shell, '-l'],
      cwd: target.cwd,
      env: buildHostTerminalEnv(sourceEnv),
    };
  }
  return {
    command: ['docker', ...buildDockerExecArgs(target.cwd, target.handle, target.shell)],
    env: buildDockerClientEnv(sourceEnv),
  };
}

export function spawnTerminalPty(input: {
  target: Extract<TerminalTarget, { kind: 'host' | 'container' }>;
  cols: number;
  rows: number;
  onData(chunk: Uint8Array): void;
  sourceEnv?: NodeJS.ProcessEnv;
  spawn?: typeof Bun.spawn;
}): SpawnedTerminal {
  const spec = buildTerminalSpawnSpec(input.target, input.sourceEnv ?? process.env);
  const spawn = input.spawn ?? Bun.spawn;
  const subprocess = spawn(spec.command, {
    ...(spec.cwd ? { cwd: spec.cwd } : {}),
    env: spec.env,
    terminal: {
      cols: input.cols,
      rows: input.rows,
      name: 'xterm-256color',
      data(_terminal, chunk) {
        input.onData(chunk);
      },
    },
  });
  const terminal = subprocess.terminal;
  if (!terminal) {
    subprocess.kill('SIGTERM');
    throw new Error('Bun did not create the requested terminal');
  }
  let killed = false;
  return {
    write(data) {
      terminal.write(data);
    },
    resize(cols, rows) {
      terminal.resize(cols, rows);
    },
    kill() {
      if (killed) return;
      killed = true;
      subprocess.kill('SIGTERM');
      terminal.close();
    },
    exited: subprocess.exited.then(code => ({
      code,
      signal: subprocess.signalCode ?? null,
    })),
  };
}
```

- [ ] **Step 4: Add one real POSIX Ctrl-C test**

Skip this one test on Windows while keeping the spawn-spec unit tests cross-platform.
Create a temporary directory, start the production host PTY there, write `echo READY; sleep 30`, wait until `READY` is observed, write `\x03`, then write `echo INTERRUPTED; exit`.
Assert `INTERRUPTED` appears within two seconds, assert the process exits, and kill the PTY in `finally` so a failed assertion cannot leak a child.
This test specifically catches replacing inline terminal options with a pre-created `Bun.Terminal`, which loses the controlling-terminal behavior on affected Bun 1.3.x builds.

- [ ] **Step 5: Raise the Bun engine floor**

Change root `package.json` from `"bun": "^1.3.0"` to `"bun": "^1.3.5"`.
Do not add a source-text assertion for this metadata-only change.

- [ ] **Step 6: Run the PTY suite and verify GREEN**

Run: `(cd packages/server && bun test src/routes/terminal/pty.test.ts)`.
Expected: PASS, with the POSIX integration case completing before its two-second guard.

- [ ] **Step 7: Commit the PTY adapter and floor**

```bash
git add package.json packages/server/src/routes/terminal/pty.ts packages/server/src/routes/terminal/pty.test.ts
git commit -m "feat(server): spawn interactive Bun terminals for workflow runs"
```

---

### Task 6: Session ownership, replay, backpressure, and cleanup

**Files:**
- Create: `packages/server/src/routes/terminal/session-manager.ts`
- Test: `packages/server/src/routes/terminal/session-manager.test.ts`

**Interfaces:**
- Consumes: `SpawnedTerminal`, protocol serializers, socket send results, random bytes, clock, timers, and a lifecycle logger.
- Produces: one `TerminalSessionManager` used by every WebSocket callback.

```ts
export interface TerminalSocket {
  send(data: string | Uint8Array): number;
  close(code?: number, reason?: string): void;
  getBufferedAmount(): number;
}

export interface TerminalSessionManager {
  attachExisting(input: {
    runId: string;
    userId: string;
    resumeToken: string | null;
    socket: TerminalSocket;
  }): boolean;
  create(input: {
    runId: string;
    userId: string;
    targetKind: 'host' | 'container';
    socket: TerminalSocket;
    spawn(onData: (chunk: Uint8Array) => void): SpawnedTerminal;
  }): void;
  input(socket: TerminalSocket, data: string): void;
  resize(socket: TerminalSocket, cols: number, rows: number): void;
  closeSession(socket: TerminalSocket): void;
  disconnect(socket: TerminalSocket): void;
  drain(socket: TerminalSocket): void;
  destroyAll(): void;
}
```

- [ ] **Step 1: Write failing lifecycle tests with fake PTYs and sockets**

Name the production break each test catches and cover the following independent behaviors.

- The first create call issues a 64-character lowercase hex token and sends `ready`.
- A second active socket takes over without spawning again, gets replay then `ready`, and closes the old socket with code 4001.
- The old socket close callback cannot detach the replacement socket.
- A disconnected session accepts only its matching token before expiry.
- An invalid or absent disconnected token kills the old PTY and returns false so the endpoint creates a new one.
- Replay retains only the newest 256 KiB and never persists outside memory.
- The frame that returns `-1` is not duplicated, later frames queue, and `drain` flushes them in order.
- A `0` send detaches rather than queues the dropped frame.
- Takeover while backpressured clears the stale pending queue, replays each retained byte once, and delays `ready` until `drain` when the replay send returns `-1`.
- Pending bytes plus `getBufferedAmount()` above 1 MiB kill the PTY and remove the session.
- Explicit close, two-minute expiry, process exit, and `destroyAll()` each kill exactly once and remove the entry.
- Process exit sends the exact `exit` message before closing the socket.
- Logger calls contain no emitted bytes, token, path, command, environment, or container handle.

- [ ] **Step 2: Run the test and verify RED**

Run: `(cd packages/server && bun test src/routes/terminal/session-manager.test.ts)`.
Expected: FAIL because `./session-manager` does not exist.

- [ ] **Step 3: Implement a manager that owns every lifecycle path**

Keep PTY references inside the private session map; do not return bare sessions to the endpoint.
Use a copied `Uint8Array` for replay and pending entries so Bun-owned buffers cannot mutate after callbacks return.
When `spawn` emits synchronously before `create` stores the session, collect those chunks in a local early-output list and feed them through the same replay/send path after insertion.
Use a constant-time token comparison for two valid 64-character hex tokens.
Centralize removal in one idempotent `destroy(key, reason)` helper that clears the timer, removes the map entry before killing, closes the PTY, and emits only allowed lifecycle metadata.
Use socket identity checks in every callback so events from replaced sockets cannot mutate the current session.
Implement replay-before-ready for attach and reconnect.
Follow the locked `send()` semantics and count both Bun-buffered and application-buffered bytes before accepting another queued chunk.

Use this private state shape so the PTY and timer cannot outlive the map entry that owns them.

```ts
interface TerminalSession {
  key: string;
  runId: string;
  userId: string;
  targetKind: 'host' | 'container';
  resumeToken: string;
  cols: number;
  rows: number;
  socket: TerminalSocket | null;
  pty: SpawnedTerminal;
  replay: Uint8Array[];
  replayBytes: number;
  pending: Uint8Array[];
  pendingBytes: number;
  backpressured: boolean;
  readyPending: boolean;
  disconnectTimer: unknown | null;
}

function sendOutput(session: TerminalSession, chunk: Uint8Array): void {
  appendBoundedReplay(session, chunk);
  const socket = session.socket;
  if (!socket) return;
  if (session.backpressured) {
    enqueuePendingOrDestroy(session, chunk);
    return;
  }
  if (socket.getBufferedAmount() + session.pendingBytes + chunk.byteLength > PENDING_MAX_BYTES) {
    overflowAndDestroy(session);
    return;
  }
  const result = socket.send(chunk);
  if (result === -1) session.backpressured = true;
  if (result === 0) disconnect(socket);
}

function destroy(key: string, reason: DestroyReason): void {
  const session = sessions.get(key);
  if (!session) return;
  sessions.delete(key);
  if (session.disconnectTimer !== null) cancel(session.disconnectTimer);
  session.disconnectTimer = null;
  session.pty.kill();
  closeOwnedSocket(session, reason);
  logLifecycle(session, reason);
}
```

Define `appendBoundedReplay`, `enqueuePendingOrDestroy`, `overflowAndDestroy`, `disconnect`, `closeOwnedSocket`, and `logLifecycle` as private closures inside `createTerminalSessionManager`, so the block above uses the factory's `sessions`, `cancel`, and logger values rather than globals.
`appendBoundedReplay` must retain a suffix of a single oversized chunk and otherwise remove or trim oldest bytes until `replayBytes <= REPLAY_MAX_BYTES`.
`drain` must shift a pending chunk only after `send()` returns `-1` or a positive result because both outcomes mean Bun accepted that chunk.
On attach, clear `pending`, `pendingBytes`, `backpressured`, and `readyPending`, concatenate the replay suffix into at most one binary frame, and close a replaced socket only after the replacement owns the session.
If the replay send returns `-1`, set `readyPending`; otherwise send `ready` immediately, and apply the same `-1` and `0` rules to that control send.

- [ ] **Step 4: Run the test and verify GREEN**

Run: `(cd packages/server && bun test src/routes/terminal/session-manager.test.ts)`.
Expected: PASS without real timers or subprocesses.

- [ ] **Step 5: Commit session ownership**

```bash
git add packages/server/src/routes/terminal/session-manager.ts packages/server/src/routes/terminal/session-manager.test.ts
git commit -m "feat(server): manage reconnectable workflow terminal sessions"
```

---

### Task 7: Authenticated endpoint and Bun server wiring

**Files:**
- Create: `packages/server/src/routes/terminal/endpoint.ts`
- Create: `packages/server/src/routes/terminal/endpoint.test.ts`
- Create: `packages/server/src/routes/terminal/index.ts`
- Create: `packages/server/src/routes/terminal/server-fetch.test.ts`
- Modify: `packages/server/src/index.ts`
- Modify: `packages/server/package.json`

**Interfaces:**
- Consumes: Tasks 1 through 6, `getAuth`, `isApiGateEnabled`, `findOrCreateUserByPlatformIdentity`, workflow and isolation DB readers, and Bun's server upgrade API.
- Produces: `createTerminalEndpoint` and `createFetchWithTerminal`.

```ts
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
  handleUpgrade(
    request: Request,
    server: TerminalUpgradeServer
  ): Promise<Response | undefined>;
  websocket: Bun.WebSocketHandler<TerminalSocketData>;
  destroyAll(): void;
}
```

- [ ] **Step 1: Write failing endpoint tests with injected dependencies**

Test origin before auth, Better Auth session before header, header fallback, canonical user creation, anonymous 401 with the gate on, and anonymous `solo` with the gate off.
Test that a resolved identity remains per-user when the gate is off.
Test non-GET and missing upgrade headers return 426, a missing run returns 404, a failed Bun upgrade returns 500, and a successful upgrade returns undefined.
Capture `server.upgrade` data and assert it contains only `runId`, `userId`, and a validated or null resume token.
Pass hostile `cwd`, `working_path`, `isolation_env_id`, and `containerId` query parameters and assert none enters upgrade data or target dependencies.
Test `open` attaches an existing session before resolving a target, sends the locked unavailable result for a missing target, and otherwise spawns exactly one PTY.
Test text `input`, `resize`, and `close` dispatch, invalid text destruction, binary-frame destruction, `close` identity guarding, and `drain` forwarding.

- [ ] **Step 2: Run the endpoint test and verify RED**

Run: `(cd packages/server && bun test src/routes/terminal/endpoint.test.ts)`.
Expected: FAIL because `./endpoint` does not exist.

- [ ] **Step 3: Implement auth and upgrade in an injected endpoint factory**

Resolve identity from the raw `Request` with the locked precedence and error behavior.
Decode the run ID from the one regex capture and return HTTP 400 if percent decoding fails.
Load the run before calling `server.upgrade` so an unknown run is a deterministic 404.
Read only the `resume` query key and normalize invalid tokens to null.
Set `websocket.data = {} as TerminalSocketData`, `maxPayloadLength = MAX_CLIENT_FRAME_BYTES`, and `idleTimeout = 255`.
In `open`, attempt `manager.attachExisting` first, then reload the run, resolve the server-owned target, and call `manager.create` with `spawnTerminalPty`.
Catch target and spawn failures, log only the error type plus run and user IDs, send `{ type: 'error', message: 'Could not open the terminal.' }`, and close without a reconnect loop.
Never log `request.url` because it can contain the resume token.

Keep the raw-request auth behavior and the upgrade branch explicit inside the factory.

```ts
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
    if (request.method !== 'GET' || request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
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
```

Make `TerminalHttpError`, `terminalErrorResponse`, `logAuthFailure`, and the default dependency object private to `endpoint.ts`.
`terminalErrorResponse` returns JSON with only the public message and never reflects request data or internal error text.
The default logging functions reduce `error` to its constructor name and log only `errorType`, `stage`, `runId`, and `userId` as applicable.
The default dependencies import `getAuth`, `isApiGateEnabled`, `userDb.findOrCreateUserByPlatformIdentity`, `workflowDb.getWorkflowRun`, and `isolationEnvDb.getById` from their existing direct modules.
The WebSocket callback object must use only `ws.data` as request context and delegate lifecycle state to the manager.

```ts
const websocket: Bun.WebSocketHandler<TerminalSocketData> = {
  data: {} as TerminalSocketData,
  maxPayloadLength: MAX_CLIENT_FRAME_BYTES,
  idleTimeout: 255,
  async open(ws) {
    const { runId, userId, resumeToken } = ws.data;
    if (manager.attachExisting({ runId, userId, resumeToken, socket: ws })) return;
    try {
      const run = await deps.getWorkflowRun(runId);
      if (!run) throw new Error('Workflow run disappeared before terminal open');
      const target = await deps.resolveTerminalTarget(run);
      if (target.kind === 'unavailable') {
        ws.send(serializeServerControlMessage({
          type: 'unavailable',
          reason: target.reason,
          message: unavailableMessage(target.reason),
        }));
        ws.close(1000, 'Terminal unavailable');
        return;
      }
      manager.create({
        runId,
        userId,
        targetKind: target.kind,
        socket: ws,
        spawn: onData => deps.spawnTerminalPty({ target, cols: 80, rows: 24, onData }),
      });
    } catch (error) {
      deps.logOpenFailure(error, runId, userId);
      ws.send(serializeServerControlMessage({ type: 'error', message: 'Could not open the terminal.' }));
      ws.close(1011, 'Terminal open failed');
    }
  },
  message(ws, frame) {
    if (typeof frame !== 'string') return manager.closeSession(ws);
    const message = parseClientControlMessage(frame);
    if ('error' in message) return manager.closeSession(ws);
    if (message.type === 'input') manager.input(ws, message.data);
    if (message.type === 'resize') manager.resize(ws, message.cols, message.rows);
    if (message.type === 'close') manager.closeSession(ws);
  },
  close(ws) {
    manager.disconnect(ws);
  },
  drain(ws) {
    manager.drain(ws);
  },
};
```

Client code must wait for `ready` before forwarding keyboard input or resize messages, so asynchronous target resolution cannot race a user frame ahead of session creation.

- [ ] **Step 4: Run the endpoint test and verify GREEN**

Run: `(cd packages/server && bun test src/routes/terminal/endpoint.test.ts)`.
Expected: PASS.

- [ ] **Step 5: Write the failing fetch-wrapper test**

Prove that only the exact terminal pathname calls `handleUpgrade` and that every unrelated API, webhook, static, and SPA path calls the injected Hono fetch function unchanged.

- [ ] **Step 6: Run the fetch-wrapper test and verify RED**

Run: `(cd packages/server && bun test src/routes/terminal/server-fetch.test.ts)`.
Expected: FAIL because the barrel and wrapper do not exist.

- [ ] **Step 7: Add the barrel, wrapper, server options, shutdown, and package test leg**

Export the endpoint factory and a wrapper that preserves Bun's `undefined` success result for an accepted upgrade and never passes a matched terminal request into Hono.

```ts
export function createFetchWithTerminal(
  appFetch: (request: Request) => Response | Promise<Response>,
  endpoint: TerminalEndpoint
): (request: Request, server: TerminalUpgradeServer) => Promise<Response | undefined> {
  return async (request, server) => {
    const pathname = new URL(request.url).pathname;
    if (endpoint.matches(pathname)) return endpoint.handleUpgrade(request, server);
    return appFetch(request);
  };
}
```

Use this server shape in `packages/server/src/index.ts`.

```ts
const terminalEndpoint = createTerminalEndpoint();
const server = Bun.serve({
  fetch: createFetchWithTerminal(
    (request: Request): Response | Promise<Response> => app.fetch(request),
    terminalEndpoint
  ),
  websocket: terminalEndpoint.websocket,
  hostname,
  port,
  idleTimeout: 255,
});
```

Call `terminalEndpoint.destroyAll()` at the beginning of `shutdown`, before `stopCleanupScheduler()` and adapter shutdown.
Insert `bun test src/routes/terminal/` as one `&&`-separated leg in `packages/server/package.json` immediately after the existing checkout-gate test.
Do not add `mock.module()` to any terminal test.

- [ ] **Step 8: Run every server terminal test and verify GREEN**

Run: `(cd packages/server && bun test src/routes/terminal/)`.
Expected: PASS.

- [ ] **Step 9: Commit the endpoint**

```bash
git add packages/server/src/routes/terminal packages/server/src/index.ts packages/server/package.json
git commit -m "feat(server): serve authenticated workflow terminal websockets"
```

---

### Task 8: Browser protocol, reconnect client, and xterm adapter

**Files:**
- Modify: `packages/web/package.json`
- Modify: `packages/web/vite.config.ts`
- Modify: `bun.lock`
- Create: `packages/web/src/components/workflows/terminal/protocol.ts`
- Create: `packages/web/src/components/workflows/terminal/protocol.test.ts`
- Create: `packages/web/src/components/workflows/terminal/client.ts`
- Create: `packages/web/src/components/workflows/terminal/client.test.ts`
- Create: `packages/web/src/components/workflows/terminal/xterm-session.ts`
- Create: `packages/web/src/components/workflows/terminal/xterm-session.test.ts`

**Interfaces:**
- Consumes: the locked protocol, browser location and storage, `WebSocket`, xterm, FitAddon, and ResizeObserver.
- Produces: `createRunTerminalClient` and `mountXtermSession` for the React component.

```ts
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

export interface MountedXtermSession {
  closeSession(): void;
  dispose(): void;
}
```

- [ ] **Step 1: Install exact xterm dependencies and enable the Vite WebSocket proxy**

Run: `(cd packages/web && bun add --exact @xterm/xterm@5.5.0 @xterm/addon-fit@0.10.0)`.
Confirm that only `packages/web/package.json` and `bun.lock` change.
Add `ws: true` to the existing `/api` proxy object in `packages/web/vite.config.ts` and keep `changeOrigin: true`.
Do not modify the web test script because `NODE_ENV=development bun test src/components/` already discovers the new directory.

- [ ] **Step 2: Write failing browser protocol tests**

Mirror the server control union without importing a server package.
Test every server message variant and reject malformed JSON, unknown types, wrong field types, and a non-hex ready token.
Test `chunkTerminalInput` with ASCII and a multi-byte string whose encoded size crosses 64 KiB, asserting each literal chunk is valid UTF-8 and within the byte limit and that concatenating chunks reproduces the original text.

- [ ] **Step 3: Run the protocol test and verify RED**

Run: `(cd packages/web && bun test src/components/workflows/terminal/protocol.test.ts)`.
Expected: FAIL because the browser protocol module does not exist.

- [ ] **Step 4: Implement browser parsing and UTF-8-safe input chunking**

Build fresh discriminated objects exactly as the server parser does.
Split oversized input on JavaScript code-point boundaries while counting each code point with `TextEncoder`, never by slicing encoded bytes in the middle of a character.

```ts
const UNAVAILABLE_REASONS = new Set<TerminalUnavailableReason>([
  'no_checkout',
  'container_missing',
  'container_stopped',
  'unsupported_provider',
]);

export function parseServerControlMessage(raw: string): ServerControlMessage | null {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (
    record.type === 'ready' &&
    typeof record.resumeToken === 'string' &&
    isResumeToken(record.resumeToken) &&
    typeof record.cols === 'number' &&
    typeof record.rows === 'number' &&
    validTerminalSize(record.cols, record.rows)
  ) {
    return {
      type: 'ready',
      resumeToken: record.resumeToken,
      cols: record.cols,
      rows: record.rows,
    };
  }
  if (
    record.type === 'exit' &&
    (record.code === null || (typeof record.code === 'number' && Number.isInteger(record.code))) &&
    (record.signal === null || typeof record.signal === 'string')
  ) {
    return { type: 'exit', code: record.code, signal: record.signal };
  }
  if (
    record.type === 'unavailable' &&
    typeof record.reason === 'string' &&
    UNAVAILABLE_REASONS.has(record.reason as TerminalUnavailableReason) &&
    typeof record.message === 'string'
  ) {
    return {
      type: 'unavailable',
      reason: record.reason as TerminalUnavailableReason,
      message: record.message,
    };
  }
  if (record.type === 'error' && typeof record.message === 'string') {
    return { type: 'error', message: record.message };
  }
  return null;
}

export function chunkTerminalInput(data: string): string[] {
  const encoder = new TextEncoder();
  const chunks: string[] = [];
  let chunk = '';
  let chunkBytes = 0;
  for (const codePoint of data) {
    const codePointBytes = encoder.encode(codePoint).byteLength;
    if (chunk && chunkBytes + codePointBytes > INPUT_MAX_BYTES) {
      chunks.push(chunk);
      chunk = '';
      chunkBytes = 0;
    }
    chunk += codePoint;
    chunkBytes += codePointBytes;
  }
  if (chunk) chunks.push(chunk);
  return chunks;
}
```

- [ ] **Step 5: Write failing terminal-client tests**

Use fake socket, storage, clock, and timer ports to cover these behaviors.

- The URL uses `ws:` or `wss:`, `window.location.host`, an encoded run ID, and no backend port constant.
- A valid stored token is the only query parameter sent.
- The socket sets `binaryType = 'arraybuffer'`.
- `ready` stores the new token and enters connected.
- Binary output reaches `onOutput` before or after `ready`.
- Large and multi-byte input is sent as ordered bounded JSON frames.
- Resize sends only integer in-range dimensions.
- A valid resize before `ready` is cached and sent after `ready`, including after reconnect, so the PTY adopts xterm's fitted dimensions.
- An unexpected close enters reconnecting and retries with capped backoff until 120 seconds.
- Component `disconnect()` closes without a `{ type: 'close' }` frame and retains the token.
- `closeSession()` sends close, clears storage, disables reconnect, and enters closed.
- Unavailable, error, and exit clear storage and disable reconnect.
- Close code 4001 shows `Terminal opened in another tab.` and does not reconnect.

- [ ] **Step 6: Run the client test and verify RED**

Run: `(cd packages/web && bun test src/components/workflows/terminal/client.test.ts)`.
Expected: FAIL because `./client` does not exist.

- [ ] **Step 7: Implement the reconnecting client**

Use backoff delays `[250, 500, 1_000, 2_000, 5_000]` and cap subsequent attempts at five seconds until the 120-second deadline.
Set the deadline from the first unexpected close and reset it after a `ready` message.
Mark deliberate unmount, explicit close, terminal control result, and replacement close as non-reconnecting states.
Do not write any input or output to storage or logs.
Build the socket URL with the current page host and append only a previously validated token.

```ts
function terminalSocketUrl(location: LocationPort, runId: string, resumeToken: string | null): string {
  const url = new URL(`/api/workflows/runs/${encodeURIComponent(runId)}/terminal`, location.origin);
  url.protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  if (isResumeToken(resumeToken)) url.searchParams.set('resume', resumeToken);
  return url.toString();
}

function sendInput(data: string): void {
  if (state.kind !== 'connected' || socket?.readyState !== WebSocket.OPEN) return;
  for (const chunk of chunkTerminalInput(data)) {
    socket.send(JSON.stringify({ type: 'input', data: chunk }));
  }
}

function resize(cols: number, rows: number): void {
  if (!validTerminalSize(cols, rows)) return;
  latestSize = { cols, rows };
  if (state.kind === 'connected' && socket?.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify({ type: 'resize', cols, rows }));
  }
}
```

Treat `closeSession()` and `disconnect()` as different operations: the former sends the close control and clears the token, while the latter only closes the browser socket and leaves the token available for remount within the deadline.
Cancel the current reconnect timer before every state transition that disables reconnect.
When a validated `ready` control arrives, store the token, enter connected, and immediately send `latestSize` when one has been cached.

- [ ] **Step 8: Write failing xterm adapter tests**

Inject terminal, FitAddon, ResizeObserver, animation-frame, and client factories.
Assert theme values come from `--surface-inset`, `--text-primary`, and `--primary`; the terminal opens in the supplied element; FitAddon loads and fits; `onData` reaches client input; `onResize` reaches client resize; server bytes reach terminal write; observer changes refit; explicit close reaches the client; and dispose tears down observers, subscriptions, socket, and xterm exactly once.

- [ ] **Step 9: Run the xterm adapter test and verify RED**

Run: `(cd packages/web && bun test src/components/workflows/terminal/xterm-session.test.ts)`.
Expected: FAIL because `./xterm-session` does not exist.

- [ ] **Step 10: Implement `mountXtermSession`**

Instantiate `Terminal`, load `FitAddon`, open the supplied element, create the terminal client, and register xterm input and resize listeners.
Schedule the first fit after mount and refit through a `ResizeObserver` on the host element.
Return a small owner object whose `closeSession` delegates to the client and whose idempotent `dispose` performs all cleanup.

```ts
const styles = getComputedStyle(document.documentElement);
const terminal = factories.createTerminal({
  theme: {
    background: styles.getPropertyValue('--surface-inset').trim(),
    foreground: styles.getPropertyValue('--text-primary').trim(),
    cursor: styles.getPropertyValue('--primary').trim(),
  },
});
const fitAddon = factories.createFitAddon();
terminal.loadAddon(fitAddon);
terminal.open(host);
const client = factories.createClient({
  runId,
  onOutput: bytes => terminal.write(bytes),
  onState,
});
const inputSubscription = terminal.onData(data => client.sendInput(data));
const resizeSubscription = terminal.onResize(({ cols, rows }) => client.resize(cols, rows));
const observer = factories.createResizeObserver(() => factories.requestFrame(() => fitAddon.fit()));
observer.observe(host);
factories.requestFrame(() => fitAddon.fit());
let disposed = false;
return {
  closeSession: () => client.closeSession(),
  dispose() {
    if (disposed) return;
    disposed = true;
    observer.disconnect();
    inputSubscription.dispose();
    resizeSubscription.dispose();
    client.disconnect();
    terminal.dispose();
  },
};
```

- [ ] **Step 11: Run all browser-terminal infrastructure tests and verify GREEN**

Run: `(cd packages/web && NODE_ENV=development bun test src/components/workflows/terminal/protocol.test.ts src/components/workflows/terminal/client.test.ts src/components/workflows/terminal/xterm-session.test.ts)`.
Expected: PASS.

- [ ] **Step 12: Commit the browser infrastructure**

```bash
git add bun.lock packages/web/package.json packages/web/vite.config.ts packages/web/src/components/workflows/terminal/protocol.ts packages/web/src/components/workflows/terminal/protocol.test.ts packages/web/src/components/workflows/terminal/client.ts packages/web/src/components/workflows/terminal/client.test.ts packages/web/src/components/workflows/terminal/xterm-session.ts packages/web/src/components/workflows/terminal/xterm-session.test.ts
git commit -m "feat(web): connect xterm to reconnectable run terminal sockets"
```

---

### Task 9: Legacy DAG Terminal tab and visible states

**Files:**
- Create: `packages/web/src/components/workflows/terminal/terminal-status.tsx`
- Create: `packages/web/src/components/workflows/terminal/terminal-status.test.tsx`
- Create: `packages/web/src/components/workflows/terminal/terminal-tab.tsx`
- Create: `packages/web/src/components/workflows/terminal/terminal-tab.test.tsx`
- Modify: `packages/web/src/components/workflows/source-control/dag-run-tabs.tsx`
- Modify: `packages/web/src/components/workflows/source-control/dag-run-tabs.test.tsx`
- Modify: `packages/web/src/components/workflows/WorkflowExecution.tsx`
- Modify: `packages/web/src/components/workflows/WorkflowExecution.test.tsx`

**Interfaces:**
- Consumes: `mountXtermSession`, `TerminalClientState`, and the existing `WorkflowRunView` and `resolveWorkflowExecutionBody` seams.
- Produces: a terminal body for DAG runs and no terminal tab for sequential runs.

- [ ] **Step 1: Write failing status and terminal-tab tests**

Use static rendering for `TerminalStatus` and assert exact copy for connecting, connected, reconnecting, unavailable, exited, closed, generic error, and replaced-tab error states.
Render `TerminalTab` under the existing happy-dom setup and assert one `role="region"` with `aria-label="Run terminal"`, a mount host, and a visible `Close terminal` button.
Do not assert on xterm-generated DOM in these component tests; `xterm-session.test.ts` owns that integration boundary.

- [ ] **Step 2: Add failing tab-order and body-selection assertions**

Extend `WorkflowRunView` expectations to `['graph', 'logs', 'chat', 'source-control', 'terminal']`.
Assert the tab text order is Graph, Logs, optional Chat, Source Control, Terminal.
Extend `WorkflowExecutionBody` with `'terminal'` and assert DAG terminal maps to it while every non-DAG view still maps to `sequential`.

- [ ] **Step 3: Run the component tests and verify RED**

Run: `(cd packages/web && NODE_ENV=development bun test src/components/workflows/terminal/terminal-status.test.tsx src/components/workflows/terminal/terminal-tab.test.tsx src/components/workflows/source-control/dag-run-tabs.test.tsx src/components/workflows/WorkflowExecution.test.tsx)`.
Expected: FAIL because the terminal components and view member do not exist.

- [ ] **Step 4: Implement the visible terminal body**

Import `@xterm/xterm/css/xterm.css` from `terminal-tab.tsx`.
Keep one `MountedXtermSession` in a ref, mount it from `useEffect` with the current `runId`, update React state through its `onState` callback, and dispose it on unmount.
Render the xterm host for every state so replay can paint before `ready`.
Overlay `TerminalStatus` whenever the state is not connected.
Render the connected `TerminalStatus` in the toolbar so every lifecycle state has visible copy without covering the live terminal.
Wire `Close terminal` to `sessionRef.current?.closeSession()` and disable it after closed, exited, unavailable, or error.
Use `flex-1 min-h-0 overflow-hidden bg-surface-inset` so xterm can measure the available run-body area.
Put `terminalStatusCopy` and `TerminalStatus` in `terminal-status.tsx`, and put `TerminalTab` in `terminal-tab.tsx` with the corresponding imports.

```tsx
function terminalStatusCopy(state: TerminalClientState): string {
  switch (state.kind) {
    case 'connecting':
      return 'Connecting…';
    case 'connected':
      return 'Connected';
    case 'reconnecting':
      return 'Reconnecting…';
    case 'unavailable':
    case 'error':
      return state.message;
    case 'closed':
      return 'Terminal closed.';
    case 'exited':
      if (state.code !== null) return `Terminal exited with code ${String(state.code)}.`;
      if (state.signal !== null) return `Terminal exited after ${state.signal}.`;
      return 'Terminal exited.';
  }
}

export function TerminalStatus({ state }: { state: TerminalClientState }): React.ReactElement {
  return (
    <p role="status" aria-live="polite" className="text-sm text-text-secondary">
      {terminalStatusCopy(state)}
    </p>
  );
}

export function TerminalTab({ runId }: { runId: string }): React.ReactElement {
  const hostRef = useRef<HTMLDivElement>(null);
  const sessionRef = useRef<MountedXtermSession | null>(null);
  const [state, setState] = useState<TerminalClientState>({ kind: 'connecting' });
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const session = mountXtermSession({ host, runId, onState: setState });
    sessionRef.current = session;
    return () => {
      sessionRef.current = null;
      session.dispose();
    };
  }, [runId]);
  const terminalEnded = ['closed', 'exited', 'unavailable', 'error'].includes(state.kind);
  return (
    <section role="region" aria-label="Run terminal" className="flex flex-1 min-h-0 flex-col">
      <div className="flex items-center justify-between">
        {state.kind === 'connected' ? <TerminalStatus state={state} /> : <span />}
        <Button disabled={terminalEnded} onClick={() => sessionRef.current?.closeSession()}>
          Close terminal
        </Button>
      </div>
      <div className="relative flex-1 min-h-0 overflow-hidden bg-surface-inset">
        <div ref={hostRef} className="h-full w-full" />
        {state.kind !== 'connected' && <TerminalStatus state={state} />}
      </div>
    </section>
  );
}
```

- [ ] **Step 5: Insert and render the new view**

Add `'terminal'` to `WorkflowRunView`.
Place `<TabsTrigger value="terminal">Terminal</TabsTrigger>` directly after the Source Control trigger.
Return `'terminal'` from `resolveWorkflowExecutionBody` only for DAG terminal view.
Render `<TerminalTab key={runId} runId={runId} />` in the matching body branch and make no other changes to the 960-line `WorkflowExecution.tsx` file.

```tsx
export type WorkflowRunView = 'graph' | 'logs' | 'chat' | 'source-control' | 'terminal';

<TabsTrigger value="source-control">Source Control</TabsTrigger>
<TabsTrigger value="terminal">Terminal</TabsTrigger>

if (!input.isDag) return 'sequential';
if (input.activeView === 'source-control') return 'source-control';
if (input.activeView === 'terminal') return 'terminal';
return 'graph-logs-pane';

{body === 'terminal' && <TerminalTab key={runId} runId={runId} />}
```

- [ ] **Step 6: Run the component tests and verify GREEN**

Run: `(cd packages/web && NODE_ENV=development bun test src/components/workflows/terminal/ src/components/workflows/source-control/dag-run-tabs.test.tsx src/components/workflows/WorkflowExecution.test.tsx)`.
Expected: PASS.

- [ ] **Step 7: Commit the legacy UI**

```bash
git add packages/web/src/components/workflows/terminal/terminal-status.tsx packages/web/src/components/workflows/terminal/terminal-status.test.tsx packages/web/src/components/workflows/terminal/terminal-tab.tsx packages/web/src/components/workflows/terminal/terminal-tab.test.tsx packages/web/src/components/workflows/source-control/dag-run-tabs.tsx packages/web/src/components/workflows/source-control/dag-run-tabs.test.tsx packages/web/src/components/workflows/WorkflowExecution.tsx packages/web/src/components/workflows/WorkflowExecution.test.tsx
git commit -m "feat(web): add a Terminal tab to legacy workflow run details"
```

---

### Task 10: Operator documentation and complete validation

**Files:**
- Modify: `packages/docs-web/src/content/docs/adapters/web.md`
- Modify: `packages/docs-web/src/content/docs/reference/api.md`
- Modify: `packages/docs-web/src/content/docs/reference/security.md`

**Interfaces:**
- Consumes: the final UI, protocol, identity, security, and lifecycle contracts.
- Produces: user and operator documentation that describes only shipped behavior.

- [ ] **Step 1: Update the legacy Web UI workflow documentation**

In `adapters/web.md` under `### Execution Detail Page`, list Graph, Logs, optional Chat, Source Control, and Terminal in order.
State that Terminal opens the run's host worktree, folder, or live managed container for any run status while that target exists.
State that leaving the tab retains the in-memory shell for two minutes, `Close terminal` destroys it immediately, and no terminal output is saved.
State that the host shell is not a filesystem sandbox and has the Archon service account's operating-system permissions.

- [ ] **Step 2: Document the WebSocket under workflow runs**

In `reference/api.md` after the existing run actions and before `## Commands`, add `#### Run Terminal WebSocket`.
Document the URL, same-origin requirement, existing API-gate identity behavior, solo fallback, server-only target resolution, JSON client and server control messages, binary output, 64 KiB input bound, integer resize bounds, opaque resume token, two-minute reconnect, active-tab takeover, and non-persistence.
State explicitly that this WebSocket is not represented in the OpenAPI document.

- [ ] **Step 3: Document the terminal threat model**

In `reference/security.md` under `## Secrets Handling` and before `### Target repo .env isolation`, add `### Interactive run terminal`.
State that every authenticated web user may open a shell by product decision and that an ungated solo install permits any client that can reach Archon.
State that the same-origin check mitigates cross-site browser initiation but does not replace deployment authentication.
State that host shells receive the explicit allowlist, Docker receives only its client connectivity allowlist, and only fixed terminal values cross `docker exec -e`.
State that the terminal can read everything available to the service account, input and output are not logged or persisted, and lifecycle logs exclude paths, handles, tokens, environment values, commands, and output.

- [ ] **Step 4: Run focused automated validation**

```bash
(cd packages/server && bun test src/routes/terminal/)
(cd packages/web && NODE_ENV=development bun test src/components/workflows/terminal/ src/components/workflows/source-control/dag-run-tabs.test.tsx src/components/workflows/WorkflowExecution.test.tsx)
bun run build:web
bun run type-check
git diff --check
```

Expected: every command exits 0 with no warnings.

- [ ] **Step 5: Run the host walkthrough**

Start `bun run dev`, open a legacy DAG run, and confirm Terminal is immediately after Source Control.
Run `pwd` and confirm it equals the run's persisted checkout or folder path.
Run `printf '\033[31mred\033[0m\n'`, resize the pane and inspect `stty size`, use an available full-screen terminal application such as `vi` or `top`, run `sleep 30`, and confirm Ctrl-C returns to the prompt promptly.
Reload within two minutes and confirm the same shell state resumes with bounded output replay.
Open a second tab and confirm it takes over once while the replaced tab stops reconnecting.
Click `Close terminal`, reopen the tab, and confirm a fresh shell starts.
Inspect WebSocket frames and confirm the browser never sends a path, isolation environment ID, or container handle.

- [ ] **Step 6: Run the container and unavailable walkthrough**

Open Terminal for a live managed-container run and confirm `pwd` is the run path inside that container.
Confirm color, cursor movement, resize, and Ctrl-C work in the container shell.
Stop the container and confirm Terminal shows the locked container-unavailable copy without opening a host shell.
Test a cleaned host checkout and confirm the checkout-unavailable copy.

- [ ] **Step 7: Run auth, logging, and shutdown checks**

With the API gate enabled, confirm an unauthenticated upgrade fails and an authenticated session succeeds.
With web auth disabled, confirm a reachable solo client succeeds.
Run a recognizable command and output marker, expire or explicitly close the session, and confirm neither marker, the resume token, environment values, checkout path, nor container handle appears in server logs or persistent tables.
Stop the server with a terminal open and confirm the child process exits.

- [ ] **Step 8: Run the repository validation gate**

Run: `bun run validate`.
Expected: PASS.

- [ ] **Step 9: Commit documentation**

```bash
git add packages/docs-web/src/content/docs/adapters/web.md packages/docs-web/src/content/docs/reference/api.md packages/docs-web/src/content/docs/reference/security.md
git commit -m "docs: document workflow run terminal access and security"
```

---

## Acceptance Criteria

- The legacy DAG run page shows `Terminal` immediately after `Source Control`, and the experimental Command Center remains untouched.
- Opening the tab creates a real PTY at a server-resolved host worktree, in-place folder, or live managed container.
- The browser cannot supply or override a working path, isolation environment ID, or container handle.
- Better Auth and trusted-header identities use canonical user IDs, anonymous gated upgrades fail, and ungated solo installs retain existing reachability behavior.
- One terminal exists per user and run, active-tab takeover is stable, and a disconnected session reconnects for at most two minutes with bounded replay.
- Missing, destroyed, stopped, VM, and remote targets fail clearly and never fall back from container to host.
- Input, resize, resume token, origin, auth, output replay, Bun and application backpressure, and payload sizes are bounded and tested.
- Keyboard input, Ctrl-C, color, cursor movement, terminal applications, and resize work through a real PTY.
- Explicit close, expiry, process exit, overflow, and server shutdown remove the session and kill the PTY exactly once.
- Host and Docker subprocess environments exclude Archon, database, adapter, Better Auth, provider, and SSH-agent credentials.
- Terminal input, output, commands, tokens, environment values, checkout paths, and container handles do not enter logs or persistent storage.
- Focused server, WebSocket, PTY, container, browser-client, xterm-adapter, and legacy component tests pass.
- The web production build, repository type check, `git diff --check`, manual host and container walkthroughs, and `bun run validate` pass.
- User-facing Web UI, API, and security documentation matches the shipped behavior.
