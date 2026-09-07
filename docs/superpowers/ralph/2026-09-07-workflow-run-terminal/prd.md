# Interactive Workflow Run Terminal Ralph PRD

Source plan: `docs/superpowers/plans/2026-09-07-workflow-run-terminal.md`
Derived slug: `2026-09-07-workflow-run-terminal`

## Overview

Archon provides an execution environment for complex AI agent workflows, operating both directly on the host machine and inside managed Docker isolation containers. When workflows pause for human input, fail, or complete, operators frequently need to inspect intermediate filesystem state, debug build failures, verify git worktree changes, or run exploratory commands in the exact environment where the workflow ran.

This feature adds a real, interactive terminal (`Terminal` tab) to the legacy DAG workflow run page immediately after `Source Control`. The terminal attaches directly to the server-resolved run checkout on the host or inside the live managed container, authenticated through Archon's existing web authentication flow, with bounded replay, backpressure management, active tab takeover, and automatic cleanup after two minutes of disconnection.

Authoritative source: `docs/superpowers/plans/2026-09-07-workflow-run-terminal.md:1-260`.

## Problem

Operators currently have no direct shell access to workflow run environments from the Archon Web UI:
1. When a workflow run fails or behaves unexpectedly, developers must manually identify the host checkout directory or container ID and open an out-of-band terminal on the server host (`docs/superpowers/plans/2026-09-07-workflow-run-terminal.md:6-16`).
2. Ad-hoc terminal access risks exposing host credentials, database connection strings, auth secrets, and API tokens if subprocess environments inherit the Archon server process environment (`docs/superpowers/plans/2026-09-07-workflow-run-terminal.md:35-37, 58-59`).
3. Naive WebSocket streaming risks memory exhaustion or process leaks when clients disconnect unexpectedly, background tabs fall behind on consumption, or multiple tabs compete for the same session (`docs/superpowers/plans/2026-09-07-workflow-run-terminal.md:8-10, 41, 102-106, 207-224`).
4. Client-supplied paths or container IDs would introduce severe security vulnerabilities (arbitrary command execution or path traversal); target resolution must be derived strictly from trusted database rows (`docs/superpowers/plans/2026-09-07-workflow-run-terminal.md:28-30, 142, 155-165`).

## Solution

Implement an authenticated Bun WebSocket terminal endpoint and xterm.js Web UI tab:
1. **Server Endpoint & Transport**: Wrap Bun's server fetch handler to intercept `GET /api/workflows/runs/:runId/terminal` upgrades before Hono. Authenticate using Better Auth session, `ARCHON_WEB_AUTH_HEADER`, or solo fallback. Verify strict same-origin headers (`docs/superpowers/plans/2026-09-07-workflow-run-terminal.md:32-34, 146-154, 1194-1470`).
2. **Strict Subprocess Isolation**: Strip all server secrets. Provide host shells with an explicit minimal environment allowlist, and Docker with a connectivity-only allowlist. Pass only fixed terminal settings (`TERM=xterm-256color`, `COLORTERM=truecolor`) into containers (`docs/superpowers/plans/2026-09-07-workflow-run-terminal.md:35-37, 58-61, 383-515`).
3. **Server-Owned Target Resolution**: Resolve execution targets solely from `workflow_runs.working_path` and `isolation_envs` database records. Never accept paths or container handles from client messages or URLs. Proactively verify container status and shell availability (`/bin/bash` vs `/bin/sh`), and return locked unavailable states without falling back to the host (`docs/superpowers/plans/2026-09-07-workflow-run-terminal.md:28-30, 62-63, 155-186, 517-768`).
4. **PTY Lifecycle & Session Management**: Spawn child processes using Bun's inline `terminal` option for proper controlling PTY and POSIX signal (Ctrl-C) support. Manage in-memory sessions keyed by `${userId}:${runId}`. Handle single-tab takeover (closing previous socket with code 4001), 256 KiB bounded output replay buffer, 120-second disconnect grace period with opaque 64-hex resume tokens, 1 MiB backpressure ceiling, and idempotent process kill on disconnect/expiry/exit/shutdown (`docs/superpowers/plans/2026-09-07-workflow-run-terminal.md:39-41, 66-69, 102-115, 207-224, 898-1192`).
5. **Web Client & Legacy UI**: Add `@xterm/xterm` 5.5.0 and `@xterm/addon-fit` 0.10.0 to `packages/web`. Implement a reconnecting client managing binary output frames, bounded UTF-8 chunked input frames, FitAddon resize synchronization, and visible status overlays (`Connecting…`, `Connected`, `Reconnecting…`, `Terminal closed.`, `Terminal opened in another tab.`, unavailable reasons). Insert the `Terminal` tab immediately after `Source Control` in `dag-run-tabs.tsx` on the legacy run detail view (`docs/superpowers/plans/2026-09-07-workflow-run-terminal.md:77-91, 1472-1876`).

## Goals and Success Metrics

| Goal | Success metric | Evidence source |
| --- | --- | --- |
| Direct Run Terminal Access | Operators can open a real PTY in the run's host checkout or managed container from the legacy DAG run page | Legacy UI and client tests (`docs/superpowers/plans/2026-09-07-workflow-run-terminal.md:1738-1876`) and manual walkthrough (`1920-1946`) |
| Strict Security Boundaries | Host/Docker environments contain no Archon secrets; cross-origin requests are rejected; target paths/handles are strictly server-resolved from database records | Server origin, env, target, and protocol tests (`docs/superpowers/plans/2026-09-07-workflow-run-terminal.md:262-896`) |
| Robust Lifecycle & Clean Teardown | PTYs are never orphaned: 2-minute disconnect expiry, active-tab takeover, Ctrl-C signal propagation, backpressure bounds, and server shutdown all kill subprocesses idempotently | PTY and session manager tests (`docs/superpowers/plans/2026-09-07-workflow-run-terminal.md:898-1192`) |
| High-Fidelity Terminal Experience | Full interactive PTY with 256-color support, window resizing (FitAddon), multi-byte UTF-8 input, and 256 KiB replay on reconnect | Browser protocol, client, and xterm adapter tests (`docs/superpowers/plans/2026-09-07-workflow-run-terminal.md:1472-1736`) |
| Safe Integration & Parity | All unit and integration tests pass; Web build and TypeScript type-check pass; repository validation gate passes | Focused validation and `bun run validate` (`docs/superpowers/plans/2026-09-07-workflow-run-terminal.md:1908-1956`) |

## Non-Goals

- Modifying the experimental Command Center (`packages/web/src/experiments/console/`) (`docs/superpowers/plans/2026-09-07-workflow-run-terminal.md:20`).
- Attaching to an in-flight workflow node execution process (`docs/superpowers/plans/2026-09-07-workflow-run-terminal.md:21`).
- Implementing a filesystem sandbox or restricting host shell `cd` operations (`docs/superpowers/plans/2026-09-07-workflow-run-terminal.md:22`).
- Shared, collaborative, or multiple concurrent named terminals for one user and run (`docs/superpowers/plans/2026-09-07-workflow-run-terminal.md:23`).
- Persisting terminal input, output, command history, or audit events to disk or database (`docs/superpowers/plans/2026-09-07-workflow-run-terminal.md:24`).
- Adding database schema changes or migrations (`docs/superpowers/plans/2026-09-07-workflow-run-terminal.md:25`).
- Supporting VM or remote isolation providers beyond returning `unsupported_provider` (`docs/superpowers/plans/2026-09-07-workflow-run-terminal.md:26`).
- Adding terminal WebSocket endpoints to OpenAPI schema or regenerating `api.generated.d.ts` (`docs/superpowers/plans/2026-09-07-workflow-run-terminal.md:43-44`).

## Technical Context

- **Path & Timing Constants**:
  - `TERMINAL_PATH_RE`: `/^\/api\/workflows\/runs\/([^/]+)\/terminal$/` (`docs/superpowers/plans/2026-09-07-workflow-run-terminal.md:101`)
  - `RECONNECT_MS`: 120,000 (2 minutes) (`docs/superpowers/plans/2026-09-07-workflow-run-terminal.md:102`)
  - `REPLAY_MAX_BYTES`: 256 * 1024 (256 KiB) (`docs/superpowers/plans/2026-09-07-workflow-run-terminal.md:103`)
  - `INPUT_MAX_BYTES`: 64 * 1024 (64 KiB) (`docs/superpowers/plans/2026-09-07-workflow-run-terminal.md:104`)
  - `PENDING_MAX_BYTES`: 1024 * 1024 (1 MiB) (`docs/superpowers/plans/2026-09-07-workflow-run-terminal.md:105`)
  - `MAX_CLIENT_FRAME_BYTES`: `INPUT_MAX_BYTES * 6 + 1024` (394,240 bytes) (`docs/superpowers/plans/2026-09-07-workflow-run-terminal.md:106`)
  - Dimensions: `MIN_COLS = 1`, `MAX_COLS = 500`, `MIN_ROWS = 1`, `MAX_ROWS = 200`, `DEFAULT_COLS = 80`, `DEFAULT_ROWS = 24` (`docs/superpowers/plans/2026-09-07-workflow-run-terminal.md:107-112`)
  - Close Codes: `REPLACED_SOCKET_CLOSE_CODE = 4001` (`docs/superpowers/plans/2026-09-07-workflow-run-terminal.md:114`)
  - Solo Identity: `SOLO_TERMINAL_USER_ID = 'solo'` (`docs/superpowers/plans/2026-09-07-workflow-run-terminal.md:113`)
- **Same-Origin Validation**:
  - `packages/server/src/routes/terminal/origin.ts`: Validates request `Origin` header against `WEB_UI_ORIGIN` if configured (matching normalized `.origin`), or against request `Host` hostname if `WEB_UI_ORIGIN` is unset or `*`. Rejects missing, malformed, opaque, and mismatched origins with `TerminalOriginError` (HTTP 403) (`docs/superpowers/plans/2026-09-07-workflow-run-terminal.md:146-149, 262-381`).
- **Subprocess Environment Isolation**:
  - `packages/server/src/routes/terminal/env.ts`: Exports `buildHostTerminalEnv` and `buildDockerClientEnv`. Allowlist excludes all Archon, database, adapter, Better Auth, and SSH agent secrets. Forces `TERM=xterm-256color` and `COLORTERM=truecolor` (`docs/superpowers/plans/2026-09-07-workflow-run-terminal.md:187-206, 383-515`).
- **Docker & Target Resolution**:
  - `packages/server/src/routes/terminal/docker.ts`: Probes container via `docker inspect -f '{{.State.Running}}'` with a 5-second timeout, checks shell via `docker exec <handle> test -x /bin/bash`, and generates literal `docker exec -i -t -e TERM=xterm-256color -e COLORTERM=truecolor -w <cwd> <handle> <shell>` argv (`docs/superpowers/plans/2026-09-07-workflow-run-terminal.md:166-186, 517-640`).
  - `packages/server/src/routes/terminal/target.ts`: Resolves targets strictly from database records. Checks `run.working_path` directory via canonical `realpath` and `stat.isDirectory()`. Checks `run.metadata.isolation_env_id` to detect container or worktree provider. Rejects missing/stopped containers and unsupported providers with locked reasons (`no_checkout`, `container_missing`, `container_stopped`, `unsupported_provider`) (`docs/superpowers/plans/2026-09-07-workflow-run-terminal.md:155-165, 642-768`).
- **Protocol Framing & Serialization**:
  - `packages/server/src/routes/terminal/protocol.ts`: Text JSON client frames (`input`, `resize`, `close`), text JSON server frames (`ready`, `exit`, `unavailable`, `error`), and binary PTY output (`Uint8Array`). Validates 64-hex resume tokens (`/^[0-9a-f]{64}$/`). Ignores untrusted extra payload keys (`docs/superpowers/plans/2026-09-07-workflow-run-terminal.md:127-145, 770-896`).
- **Inline Bun PTY Spawn**:
  - `packages/server/src/routes/terminal/pty.ts`: Spawns inline via `Bun.spawn(spec.command, { cwd, env, terminal: { cols, rows, name: 'xterm-256color', data(_terminal, bytes) { onData(bytes); } } })`. Never uses pre-created `Bun.Terminal()`. Ensures Ctrl-C POSIX signal handling. Raises root `engines.bun` to `^1.3.5` (`docs/superpowers/plans/2026-09-07-workflow-run-terminal.md:38-40, 187-202, 898-1047`).
- **Session Manager & Reconnect**:
  - `packages/server/src/routes/terminal/session-manager.ts`: Per-user/run map keyed by `${userId}:${runId}`. Implements active-tab takeover (closes previous socket with code 4001), 256 KiB replay buffer, 120-second disconnect timer, send backpressure handling (`-1` queued, `0` disconnected, positive bytes sent), 1 MiB overflow protection, and idempotent kill (`docs/superpowers/plans/2026-09-07-workflow-run-terminal.md:207-224, 1049-1192`).
- **Server Endpoint & Upgrade**:
  - `packages/server/src/routes/terminal/endpoint.ts`: Handles GET upgrade on `TERMINAL_PATH_RE`, resolves identity (Better Auth -> header -> solo), attaches existing session or creates fresh PTY, and forwards WebSocket events (`docs/superpowers/plans/2026-09-07-workflow-run-terminal.md:150-154, 1194-1355`).
  - `packages/server/src/routes/terminal/index.ts` & `packages/server/src/index.ts`: Integrates `createFetchWithTerminal` wrapper to intercept upgrades before Hono and registers WebSocket callbacks and graceful shutdown teardown (`docs/superpowers/plans/2026-09-07-workflow-run-terminal.md:1357-1470`).
- **Browser Client & xterm Adapter**:
  - `packages/web/src/components/workflows/terminal/protocol.ts` & `client.ts`: WebSocket client handling connection, token storage in `sessionStorage` (`archon.terminal.resume.${runId}`), chunked UTF-8 input, resize caching, and capped reconnect backoff (`[250, 500, 1000, 2000, 5000]` ms) (`docs/superpowers/plans/2026-09-07-workflow-run-terminal.md:1472-1640`).
  - `packages/web/src/components/workflows/terminal/xterm-session.ts`: Manages `Terminal`, `FitAddon`, `ResizeObserver`, CSS theme variables (`--surface-inset`, `--text-primary`, `--primary`), and cleanup (`docs/superpowers/plans/2026-09-07-workflow-run-terminal.md:1642-1736`).
- **Legacy UI Components**:
  - `terminal-status.tsx`: Visible status copy and accessible alerts (`docs/superpowers/plans/2026-09-07-workflow-run-terminal.md:230-238, 1740-1790`).
  - `terminal-tab.tsx`: Accessible terminal region, toolbar with status and `Close terminal` button, xterm container host (`docs/superpowers/plans/2026-09-07-workflow-run-terminal.md:1792-1830`).
  - `dag-run-tabs.tsx` & `WorkflowExecution.tsx`: Places `Terminal` tab immediately after `Source Control` for DAG workflow runs (`docs/superpowers/plans/2026-09-07-workflow-run-terminal.md:1832-1876`).
- **Operator Documentation**:
  - Updates `packages/docs-web/src/content/docs/adapters/web.md`, `reference/api.md`, and `reference/security.md` with operational guidance and security model (`docs/superpowers/plans/2026-09-07-workflow-run-terminal.md:1878-1976`).

## Story Overview

| Priority | Story | Title | Depends on | Plan anchors |
| --- | --- | --- | --- | --- |
| 1 | US-001 | Validate workflow terminal WebSocket origins | - | 262-381 |
| 2 | US-002 | Isolate workflow terminal subprocess environments | - | 383-515 |
| 3 | US-003 | Resolve workflow terminal host and container targets | US-002 | 517-768 |
| 4 | US-004 | Validate workflow terminal WebSocket frames | - | 770-896 |
| 5 | US-005 | Spawn interactive Bun terminals for workflow runs | US-002, US-003 | 898-1047 |
| 6 | US-006 | Manage reconnectable workflow terminal sessions | US-004, US-005 | 1049-1192 |
| 7 | US-007 | Serve authenticated workflow terminal WebSockets | US-001, US-003, US-004, US-005, US-006 | 1194-1470 |
| 8 | US-008 | Connect xterm to reconnectable run terminal sockets | US-004 | 1472-1736 |
| 9 | US-009 | Add a Terminal tab to legacy workflow run details | US-008 | 1738-1876 |
| 10 | US-010 | Document workflow run terminal access and validate system | US-007, US-009 | 1878-1976 |

## Ralph Execution Notes

- Implement exactly one story per fresh-context Ralph iteration.
- Follow test-driven development (RED -> minimal GREEN -> refactor) for each story.
- Do not start a story until every dependency story in `dependsOn` has `passes: true`.
- Run commands from repository root or use subshells as prescribed in plan steps.
