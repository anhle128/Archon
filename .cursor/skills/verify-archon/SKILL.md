---
name: verify-archon
description: >-
  Use when proving Archon user-facing behavior on this checkout (CLI workflows,
  the local bun server HTTP API, or the web console) instead of treating CI
  green or a compile as proof. Reach for it after a product change, before
  claiming a workflow, server, or console path works, or when an agent needs
  to launch/doctor/drive/cleanup an isolated Archon instance.
---

# Verify Archon

Drive this Archon fork (`anhle128/Archon`) the way a user does. CI green and `tsc` are not proof. A CLI/HTTP proof is a real command or `/api/*` request against a live instance, plus the resulting state. A **web-console** proof is a real browser session against `/console`: visible DOM assertions plus screenshots (and video when the harness records it). HTTP-only is not a passing UI claim.

Primary surfaces: **Archon CLI** (`bun run cli`) and the **server HTTP API** (`bun run dev:server`). The web console (`bun run dev:web`, `/console`) is secondary. Oceanlabs production Mini (PM2 + PostgreSQL over Tailscale) is an optional remote target — never the default, and never started or stopped from here.

Read [features/README.md](features/README.md) before driving. The map is the source of which paths exist; driving one convenient entry point is incomplete when the map lists others.

## Launch

Default target is a **local bun server** in this checkout. It must work offline on a cloud VM with no Mini, no Tailscale, and no AI credentials.

### Preconditions

- Repository root. `git remote -v` includes `anhle128/Archon`.
- Bun `^1.3.5` (`bun --version`). If missing: `curl -fsSL https://bun.sh/install | bash`.
- `bun install` has been run at the repo root (`node_modules` present).
- No `.env` is required. Solo SQLite is the verification database.

### Isolated instance (required for local)

Do not use the operator's `~/.archon` or Mini's Postgres. The helper sets:

| Variable                    | Verification value                 | Why                                 |
| --------------------------- | ---------------------------------- | ----------------------------------- |
| `ARCHON_HOME`               | `/tmp/archon-verify/<run-id>/home` | Isolated SQLite + config            |
| `PORT`                      | `13090` (override with `--port`)   | Avoid Mini/laptop `3090`            |
| `HOST`                      | `127.0.0.1`                        | Loopback only                       |
| `DATABASE_URL`              | empty                              | SQLite at `$ARCHON_HOME/archon.db`  |
| `ARCHON_TELEMETRY_DISABLED` | `1`                                | No PostHog                          |
| Platform bot tokens         | unset in the child env             | Do not start Slack/Telegram/Discord |

Two local instances can run side by side if they use different `PORT` and `ARCHON_HOME`. Do not double-drive a shared `~/.archon` or port 3090.

### Start

Preferred:

```bash
.cursor/skills/verify-archon/bin/verify-archon launch
# UI proofs also start Vite (API 13090 + web 15173):
.cursor/skills/verify-archon/bin/verify-archon launch --with-web
```

Manual equivalent (repo root):

```bash
export ARCHON_HOME=/tmp/archon-verify/manual/home
export PORT=13090
export HOST=127.0.0.1
export DATABASE_URL=
export ARCHON_TELEMETRY_DISABLED=1
mkdir -p "$ARCHON_HOME"
# bun --filter runs @archon/server from packages/server
bun run dev:server
```

Ready when logs include `server_listening` and `server_ready`, **and** this succeeds:

```bash
curl -sS "http://127.0.0.1:${PORT}/api/health"
```

Body must have `"status":"ok"`. `archon serve` from source exits: it is compiled-binaries only. Use `bun run dev:server`.

Optional web UI for CLI/HTTP proofs is unused. For **web-console**, the helper starts Vite on **15173** (not laptop 5173) with `PORT` equal to the API port so `packages/web/vite.config.ts` proxies `/api` to the isolated server:

```bash
PORT=13090 bun run dev --host 127.0.0.1 --port 15173 --strictPort
# cwd: packages/web  (do not insert `--` before Vite flags; bun steals --port)
```

`bun run dev:web` is the same Vite app on 5173. Verification must set `PORT=<api>` or the proxy still targets 3090. Ready when `GET http://127.0.0.1:15173/console` is the SPA shell (`<title>Archon</title>`, `#root`). `packages/web/dist` is absent until `bun run build:web`; the API server then logs `web_dist_not_found` and still serves `/api/*` — that is **not** a UI proof.

### Mini (optional remote)

Only when the user asked and the host answers:

```bash
export ARCHON_VERIFY_TARGET=mini
export ARCHON_VERIFY_BASE_URL='http://<tailscale-host>:3090'
.cursor/skills/verify-archon/bin/verify-archon doctor
```

Do not run `deploy-pm2.sh`, `pm2 restart`, or `docker compose` against Mini. A failed Tailscale curl is a skip, not a product bug in this checkout.

### Teardown

```bash
.cursor/skills/verify-archon/bin/verify-archon cleanup
```

See Cleanup. Launch records the PID; cleanup kills that PID (and the recorded listener PID), not `bun` by name.

## Doctor

One read-only check: is **this** instance worth driving?

```bash
.cursor/skills/verify-archon/bin/verify-archon doctor --json
```

Local target must all be true:

1. State file exists and `baseUrl` is `http://127.0.0.1:<port>`.
2. The recorded server PID is alive.
3. `lsof` shows that PID (or its recorded child) owns `HOST:PORT`.
4. `GET /api/health` returns 200 and `status === "ok"`.
5. `ARCHON_HOME` is the isolated directory from launch, not `~/.archon`.
6. If launch recorded `webUrl` ( `--with-web` ): Vite is listening on that port and `GET <webUrl>/console` is the Archon SPA shell. API-only launches skip this so `prove discover-workflows` stays Vite-free.

Also run and **record** (do not require green AI binaries):

```bash
.cursor/skills/verify-archon/bin/verify-archon cli -- doctor
```

`archon doctor` exit 0 means every check passed or skipped. Exit 1 means a critical check failed. On an offline cloud VM, Claude/Codex/Grok/gh often fail. That is expected. Instance doctor still passes when HTTP health and isolation hold. Fail instance doctor if database, workspace writable, or bundled defaults fail, or if `/api/health` is down.

Auth: solo SQLite has no Better Auth. `GET /api/auth/status` should show `enabled: false`. `/api/health` is always public.

Run doctor before the first drive, after any failed drive, and on a fresh session.

## Drive

Harness: `verify-archon` wrapping the real Archon CLI and HTTP API. CLI/HTTP features stay curl/CLI. **web-console** must open Playwright (system Chrome, `channel: 'chrome'`) against the Vite origin — see [harness/README.md](harness/README.md). Never click by coordinates.

```bash
.cursor/skills/verify-archon/bin/verify-archon drive discover-workflows
.cursor/skills/verify-archon/bin/verify-archon drive web-console   # requires launch --with-web
```

Stable handles (use these, not coordinates):

| Surface          | Handle                                                                             |
| ---------------- | ---------------------------------------------------------------------------------- |
| CLI              | `bun run cli -- <args>` via `verify-archon cli -- <args>` so `ARCHON_HOME` matches |
| Health           | `GET /api/health`                                                                  |
| Workflow catalog | `GET /api/workflows` (no `cwd` until the path is a registered codebase)            |
| Register project | `POST /api/codebases` body `{"path":"<repo-root>"}`                                |
| Project catalog  | `GET /api/workflows?cwd=<repo-root>`                                               |
| Runs             | `GET /api/workflows/runs` and `bun run cli -- workflow runs --json`                |
| Console routes   | `/console` (RunsPage), `/console/settings` (SettingsPage)                          |
| Console rail     | `nav[aria-label="Projects"]`; buttons `All projects`, `Add project`                |
| Console filters  | chip accessible name `/^All \d+$/` (not the rail "All projects" button)            |

CLI rules from this repo:

- Workflow commands need a git repo, a registered folder project, or `--folder`. This checkout is a git repo; subdirectories resolve to the repo root.
- Prefer `--json` on `list`, `status`, `runs`, `get`, `approve`, `reject`, `abandon`, `resume`, `validate`.
- `workflow run --json` is clean JSON only with `--detach` or `--dry-run`.
- `approve` / `reject` / `resume --json` record the decision and do not auto-continue.

HTTP rules:

- `GET /api/workflows?cwd=` returns 400 unless `cwd` matches a registered codebase `default_cwd`.
- Without `cwd` and with no codebases, discovery returns bundled + home-scoped workflows only — not `.archon/workflows/test-workflows/`.
- Server cwd under `bun --filter` is `packages/server`. Never assume it is the repo root.

Pick a feature file under [features/](features/) and follow its `Driving it with verify-archon` section literally.

## Evidence

Root: `.cursor/skills/verify-archon/evidence/runs/<run-id>/` (named in `verify-archon evidence --json`). Cleanup must not delete this tree.

Proof standards:

- Exercise the real user path (CLI command or `/api/*` the console/CLI uses). Do not write run rows through test-only helpers.
- Capture the action and the resulting state (command + list after, POST + GET after).
- Verify side effects: SQLite row (`/api/codebases`), run id (`workflow runs`), files under `$ARCHON_HOME`.
- Mocks only at a production boundary (Mini unreachable, missing Claude binary). Name the skip.
- `--dry-run` on `workflow run` does not create a run and does not call a provider. Confirm by reading `workflow runs` before and after. `--exec-code` **does** execute bash/script nodes.

Minimum artifacts per drive: `summary.json`, the command transcript, HTTP/CLI JSON, exit codes.

When the claim is **UI** (`web-console`): screenshots are **required**. HTTP 200 on `/console` or `/api/*` is not enough. The Playwright harness writes `console-runs.png`, `console-runs-all.png`, `console-settings.png`, `ui-assertions.json`, and a short `video/*.webm` when Chrome records it. Viewport must be ≥1024px wide (`1440×900` in the harness) because `ProjectRail` is `hidden lg:block`.

## Cleanup

```bash
.cursor/skills/verify-archon/bin/verify-archon cleanup
.cursor/skills/verify-archon/bin/verify-archon cleanup --dry-run   # print, do not kill
```

Cleanup may:

- `SIGTERM` the PID recorded at launch (then the recorded listener PID if it is still the owner of `HOST:PORT`).
- `SIGTERM` the recorded Vite spawn/listener PIDs when `--with-web` was used.
- Remove the isolated `ARCHON_HOME` scratch directory.
- Remove the state file.

Cleanup must not:

- Delete `evidence/runs/<run-id>/` or `evidence/last-proof/`.
- `pkill bun`, `killall`, or match by process name.
- Touch Mini PM2, Docker volumes, or `~/.archon`.
- Run `git clean -fd`.

After cleanup, confirm evidence still exists at the path printed by launch/doctor.

## Helpers

Executable: `.cursor/skills/verify-archon/bin/verify-archon`

```text
verify-archon launch [--port N] [--home DIR] [--with-web] [--json] [--dry-run]
verify-archon doctor [--json]
verify-archon drive <feature> [--json]
verify-archon prove [feature] [--json]          # launch → doctor → drive → cleanup
verify-archon cli -- <archon-args>              # bun run cli with verify env
verify-archon http [METHOD] <path> [--body JSON]
verify-archon evidence [--json]
verify-archon cleanup [--dry-run] [--json] [--keep-home]
verify-archon status [--json]
verify-archon features
```

`prove web-console` implies `--with-web` (API + Vite + Playwright). `prove discover-workflows` stays API-only.

`--json` prints one JSON object on stdout (logs on stderr). `--dry-run` on `launch`/`cleanup` prints the planned action and does not start or kill anything.

Features the helper can drive: `diagnose-install`, `discover-workflows`, `run-deterministic-workflow`, `inspect-run`, `web-console`.

Upkeep: `/maintain-verification-skill` when the product changes and this map may be stale.
