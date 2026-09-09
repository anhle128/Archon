# Open the web console

Open the web console lets a user reach the default Archon UI at `/console`, inspect runs and settings, and fall back to the legacy pages under `/legacy`. This is a secondary surface; operators primarily drive CLI + server workflows. A passing proof is a **visible** console state, not an HTTP status code.

## Sub-features

- `console-root` redirects `/` to `/console`.
- `console-runs` shows the runs index at `/console` and `/console/p/:projectId`.
- `console-settings` opens `/console/settings`.
- `console-run-detail` opens `/console/p/:projectId/r/:runId`.
- `legacy-chat` remains at `/legacy/chat` for the deprecation window.
- `api-behind-ui` is the JSON the console actually loads (`/api/health`, `/api/auth/status`, `/api/workflows`, `/api/workflows/runs`, `/api/codebases`).

## How to get to it (user POV)

- Verification (this skill): `verify-archon launch --with-web` then open `http://127.0.0.1:15173/console`.
- Laptop/dev: `bun run dev` (server 3090 + Vite 5173) and open `http://127.0.0.1:5173/console`.
- Vite only: `PORT=<api-port> bun run dev:web` (default Vite 5173; proxies `/api` to `PORT` or 3090).
- On Mini, open the Tailscale origin (often port 3090) at `/console`.
- API-only `bun run dev:server` does **not** serve the SPA unless `packages/web/dist` exists. That is not a UI proof.

## Driving it with verify-archon

Preconditions:

- Isolated local target (not Mini). Solo SQLite: do not set `BETTER_AUTH_SECRET` or `DATABASE_URL`.
- `GET /api/auth/status` reports `{ "enabled": false }`. `SessionGate` then passthroughs after a brief loader — no login.
- Vite is running with `PORT` equal to the verification API port. `prove web-console` starts both.

End-to-end (preferred):

```bash
.agents/skills/verify-archon/bin/verify-archon prove web-console
```

That is `launch --with-web` → `doctor` → Playwright `drive web-console` → `cleanup` (keeps evidence; kills API + Vite + browser).

Step-wise:

```bash
.agents/skills/verify-archon/bin/verify-archon launch --with-web
.agents/skills/verify-archon/bin/verify-archon doctor --json
.agents/skills/verify-archon/bin/verify-archon drive web-console
.agents/skills/verify-archon/bin/verify-archon cleanup
```

Manual Vite equivalent if debugging the helper (repo root, API already on 13090):

```bash
cd packages/web
PORT=13090 bun run dev --host 127.0.0.1 --port 15173 --strictPort
# Do not insert `--` before Vite flags; bun steals `--port` and prints usage.
```

Manual Playwright equivalent (after `bun install` in `.agents/skills/verify-archon/harness`):

```bash
ARCHON_VERIFY_WEB_URL=http://127.0.0.1:15173 \
ARCHON_VERIFY_EVIDENCE_DIR=.agents/skills/verify-archon/evidence/runs/<id> \
bun --cwd .agents/skills/verify-archon/harness run drive-console
```

- **Auth posture.** `verify-archon http /api/auth/status`. Status `200`, `enabled` is `false`. If `enabled` is true, stop — this skill does not drive OAuth.
- **Health the UI reads.** `verify-archon http /api/health`. Status `200`, `status` is `"ok"`.
- **Open `/console` in the browser** (Playwright, viewport 1440×900 so `ProjectRail` is not `hidden lg:block`).
- **Rail.** `getByRole('navigation', { name: 'Projects' })` is visible. Inside it: exact text `Archon`, exact text `console`, `getByRole('button', { name: 'All projects' })`, `getByRole('button', { name: 'Add project' })`.
- **Runs index.** `getByRole('heading', { name: 'All projects', level: 1 })` is visible. Copy `Every run, across every project.` and `Pick a project on the left to start a run.` is visible. Default filter is Running → `Nothing running right now.` Screenshot: `console-runs.png`.
- **All filter.** Click `getByRole('button', { name: /^All \d+$/ })` (not the rail "All projects" button). `No runs yet.` is visible. Screenshot: `console-runs-all.png`.
- **Settings.** Click `getByRole('link', { name: 'Settings' })`. URL is `/console/settings`. `getByRole('heading', { name: 'Settings', level: 1 })` is visible. Screenshot: `console-settings.png`.
- **Proof.** Evidence contains those three PNGs, `ui-assertions.json` with `"ok": true`, and preferably `video/*.webm`. HTTP JSON for auth/health/workflows is supporting context only. **HTTP-only is not a pass.**

## Gotchas

- Vite proxies `/api` to `env.PORT ?? 3090`. A verification server on 13090 is invisible to Vite unless `PORT=13090` is set for the Vite process. `launch --with-web` does this.
- Verification Vite listens on **15173** (`ARCHON_VERIFY_WEB_PORT`) so it does not collide with a laptop `5173`.
- `archon serve` is binary-only. Source launches are `bun run dev` / `dev:server` / `dev:web`.
- Selectors come from `packages/web/src/experiments/console/` (`ProjectRail`, `RunsPage`, `FilterChips`, `SettingsPage`). Do not invent `data-testid`s or click coordinates.
- The All filter chip's accessible name is `All <count>` (e.g. `All 0`). A name of `All` also matches the rail "All projects" button — use `/^All \d+$/`.
- Better Auth (`BETTER_AUTH_SECRET` + Postgres) gates `/api/*` with 401 and redirects the SPA to `/login`. Local verification must not enable that.
- Mini over Tailscale may be unreachable from a cloud VM. Report the failed `curl` and skip; do not treat that as a product bug in this checkout.
