# Open the web console

Open the web console lets a user reach the default Archon UI at `/console`, inspect runs and settings, and fall back to the legacy pages under `/legacy`. This is a secondary surface; Oceanlabs operators primarily drive CLI + server workflows.

## Sub-features

- `console-root` redirects `/` to `/console`.
- `console-runs` shows the runs index at `/console` and `/console/p/:projectId`.
- `console-run-detail` opens `/console/p/:projectId/r/:runId`.
- `legacy-chat` remains at `/legacy/chat` for the deprecation window.
- `api-behind-ui` is the JSON the console actually loads (`/api/health`, `/api/workflows`, `/api/workflows/runs`, `/api/codebases`).

## How to get to it (user POV)

- Run `bun run dev` (server 3090 + Vite 5173) and open `http://127.0.0.1:5173/console`.
- Run `bun run dev:server` alone and, if `packages/web/dist` exists, open `http://127.0.0.1:<port>/console`.
- On Mini, open the Tailscale origin (often port 3090) at `/console`.
- Use `bun run dev:web` when only the Vite app should start; it proxies `/api` to `PORT` (default 3090).

## Driving it with verify-archon

Preconditions:

- `verify-archon doctor` passed for the API.
- Solo SQLite: `GET /api/auth/status` reports auth disabled; `SessionGate` does not require login.
- HTML for `/console` exists only if `packages/web/dist` was built or Vite is running on 5173. API proof does not require that.

- **Auth posture.** Read the login gate. Run `verify-archon http /api/auth/status`. Status `200`. Local verification expects `enabled` false.
- **Health the UI reads.** Run `verify-archon http /api/health`. Status `200`, `status` is `"ok"`.
- **Catalog the UI reads.** Run `verify-archon http /api/workflows`. Status `200`.
- **Projects the UI reads.** Run `verify-archon http /api/codebases`. Status `200` (array, possibly empty).
- **Optional HTML.** If Vite is up, fetch `http://127.0.0.1:5173/console`. Status `200` and the document identifies the console. If only the API server is up and `web/dist` is missing, record `web_dist_not_found` and do not claim the UI rendered.
- **Proof.** Evidence contains `auth-status.http.json`, `health.http.json`, and `workflows.http.json`. Screenshots are required only when a UI interaction (not an API read) is the thing under test.

## Gotchas

- Vite proxies `/api` to `env.PORT ?? 3090`. A verification server on 13090 is invisible to `bun run dev:web` unless `PORT=13090` is set for Vite too.
- `archon serve` is binary-only. Source launches are `bun run dev` / `dev:server` / `dev:web`.
- Do not invent Playwright coverage. Prefer HTTP + CLI. Use a browser only when the bug is visual.
- Better Auth (`BETTER_AUTH_SECRET` + Postgres) gates `/api/*` with 401. Local verification must not enable that.
- Mini over Tailscale may be unreachable from a cloud VM. Report the failed `curl` and skip; do not treat that as a product bug in this checkout.
