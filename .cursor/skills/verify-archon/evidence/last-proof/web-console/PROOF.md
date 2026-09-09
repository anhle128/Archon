# Generator proof — web-console

Captured on 2026-09-09 against this checkout, using the local bun target (not Mini). Solo SQLite, no Better Auth.

## Invoke

```bash
PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 bun install --cwd .cursor/skills/verify-archon/harness
# once per machine, for video (screenshots still pass without it):
(cd .cursor/skills/verify-archon/harness && bunx playwright install ffmpeg)

.cursor/skills/verify-archon/bin/verify-archon prove web-console
```

Step-wise: `launch --with-web` → `doctor --json` → Playwright `drive web-console` → `cleanup` (API + Vite + browser; evidence kept).

## What was proved on screen

Feature: **web-console** at `http://127.0.0.1:15173` (Vite, `PORT=13090` proxy) in system Chrome, viewport 1440×900.

1. Launch API on 13090 + Vite on 15173. Isolated `ARCHON_HOME`, empty `DATABASE_URL`.
2. `GET /api/health` → `status: "ok"`. `GET /api/auth/status` → `enabled: false` (SessionGate passthrough, no login).
3. Browser opened `/console`. Visible:
   - `nav[aria-label="Projects"]` with exact text `Archon` and `console`
   - Rail buttons **All projects** and **Add project**
   - `h1` **All projects**; copy “Every run, across every project.” and “Pick a project on the left to start a run.”
   - Default Running filter empty state: **Nothing running right now.**
4. Clicked filter chip `/^All \d+$/` → **No runs yet.**
5. Clicked link **Settings** → URL `/console/settings`, `h1` **Settings** (Model Tiers / Aliases / Defaults).

HTTP-only was not treated as a pass.

## Artifacts here

| File                   | Proof                                       |
| ---------------------- | ------------------------------------------- |
| `console-runs.png`     | `/console` Running empty state              |
| `console-runs-all.png` | `/console` after All filter                 |
| `console-settings.png` | `/console/settings` heading + panels        |
| `ui-assertions.json`   | Seven DOM assertions, `ok: true`            |
| `video/*.webm`         | Short Playwright recording of the same path |
| `summary.json`         | Feature id and ok                           |

Full session dumps stay in `../../runs/<run-id>/` (gitignored).

## Not claimed

- Mini / Tailscale
- Better Auth / OAuth login
- A real workflow run from the console
- `prove discover-workflows` (separate last-proof directory; re-proved after this loop)
