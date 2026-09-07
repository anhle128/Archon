# Archon UI e2e (Playwright)

Standalone npm package for the committed Playwright UI suite. It is **not** a
Bun workspace member, so monorepo `bun --filter '*'` scripts never download
browsers or run Playwright. The tracked `package-lock.json` is the one
intentional npm lockfile in the repo (needed for `npm ci` in CI).

Each worker boots an isolated Archon instance (`lib/playwright/archon-runtime.ts`:
own `ARCHON_HOME`, SQLite, port, env-gated fake AI provider) and serves the
pre-built web bundle from `packages/web/dist`.

## Local

From the repo root:

```bash
bun install --frozen-lockfile
bun run build:web
cd e2e
npm ci
npx playwright install chromium
npm run test:ui
```

`test:ui:p0` / `test:ui:p1` / `test:ui:p2` filter by the `[P0]` / `[P1]` / `[P2]`
name tags.

## CI (gate C1)

`.github/workflows/e2e-ui.yml` runs `npm run test:ui` on PRs and pushes to
`dev` when UI paths change. The GitHub check name is **`UI Playwright e2e`**
(stable — required-check candidates must not rename it).

Path filter: `packages/web/**`, `e2e/**`, `.github/workflows/e2e-ui.yml`.
Non-UI PRs still get a green check (skip-success) so a required status check
does not stay pending.

This workflow does **not** invoke `archon workflow run pr-e2e-verify` (C2) and
does not replace `archon-validate-pr` (D).
