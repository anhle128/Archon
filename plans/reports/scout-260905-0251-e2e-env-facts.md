# E2E Test Environment Scout Report

## 1. Local Bring-up

**Root scripts** (`package.json:11-13`):

- `bun run dev` — starts server + web together with hot reload (recommended)
- `bun run dev:server` — server only, port 3090
- `bun run dev:web` — web only, Vite port 5173

**Server** (`packages/server/package.json:3`):

- `bun run dev` → `bun --watch src/index.ts` (hot reload on port 3090)
- `bun run start` → production serve

**Web** (`packages/web/package.json:2-3`):

- `bun run dev` → `vite` dev server (port 5173)
- `bun run build` → tsc + vite prod build

**Web in production**: Server serves static build at `packages/web/build/` (not from Vite). Single `bun run build:web` builds web, server auto-serves.

**Docker**: `docker-compose.yml:1-50` — SQLite default (zero config), optional `--profile with-db` adds PostgreSQL container, optional `--profile cloud` adds Caddy reverse proxy. Port `3000` by default (Dockerfile exposes it).

**Minimal env vars** (`.env.example`):

- `CLAUDE_USE_GLOBAL_AUTH=true` (recommended; default)
- Optional `DATABASE_URL` for PostgreSQL
- Optional `WEBHOOK_SECRET`, platform bot tokens
- No auth vars required for base startup

## 2. Database

**Default**: SQLite at `~/.archon/archon.db` (auto-created, zero setup required).

**`ARCHON_HOME` override**: Sets the base directory; default `~/.archon`. Docker ignores this (always `/.archon/` inside container).

**Schema application**: Auto-applied at connection time via idempotent `migrations/000_combined.sql` (SQLite) or embedded schema (PostgreSQL). Single-transaction advisory-lock apply on first connect — both adapters update on every connection, so old Archon binaries on PATH never break a newer schema. **Additive-only rule enforced**: only ADD tables/columns/indexes; never rename/retype/drop.

**Seed/fixtures**: None built-in. Tests use mock.module() or in-memory SQLite (`databases/test`).

**Clean DB for E2E**: Delete `~/.archon/archon.db` or use `ARCHON_HOME=/tmp/e2e-test bun run ...` to isolate.

## 3. Web Auth

**Default**: No login required. `GET /api/health` always reachable.

**Opt-in** (PostgreSQL + `BETTER_AUTH_SECRET`):

- Enables Better Auth email/password login at `/api/auth/*`
- Sets `ARCHON_WEB_AUTH_REQUIRED=true` by default (401 on unauthenticated `/api/*` except `/api/auth/*` and `/api/health*`)
- Can disable with `ARCHON_WEB_AUTH_REQUIRED=false` (login UI only, not enforced)
- Default signup: **disabled** unless `ARCHON_AUTH_OPEN_SIGNUP=true` or `ARCHON_AUTH_ALLOWED_EMAILS` whitelist set

**For fresh E2E run on solo install**: No auth step needed (SQLite, no `BETTER_AUTH_SECRET`).

## 4. Existing Browser/E2E Testing

**Playwright**: Not currently in codebase (grep finds none in package.json, not installed).

**Agent-browser**: External tool (`npm install -g agent-browser`). Already in Docker image. Windows has a [known bug](https://github.com/vercel-labs/agent-browser/issues/56); use WSL.

**Skills**:

- **playwright-cli** (`.claude/skills/playwright-cli/SKILL.md`): Automates browser interactions (navigate, click, type, snapshot, screenshots). Commands: `playwright-cli open`, `goto`, `click e15`, `type`, `press`, `snapshot`, etc.
- **validate-ui** (`.claude/skills/validate-ui/SKILL.md:19-23`): Comprehensive E2E validation of Archon Web UI. Kills old processes, starts Archon, runs agent-browser tests, produces bug/UX report. Focuses on workflow management, agent orchestration, UI visibility.
- **agent-browser** (`.claude/skills/agent-browser/SKILL.md:7-45`): Core browser automation (external Vercel Labs tool). Workflow: navigate → snapshot (interactive elements with refs) → click/fill by ref → close.
- **replicate-issue** (`.claude/skills/replicate-issue/SKILL.md:20-50`): Reproduce GitHub issue against live Archon. Checks out main, pulls latest, starts Archon, reads issue, systematically tests symptoms using agent-browser.

## 5. CI Workflows

**.github/workflows/**:

- `test.yml` — Runs on push/PR to main/dev; unit/integration tests + linting
- `e2e-smoke.yml` — Deterministic (always) + container (gated on container-code changes) + AI tiers (opt-in via `run_ai_tiers=true` or `RUN_AI_SMOKE=true`)
- `docs-build.yml` — Builds docs site
- `release.yml` — Release automation
- `publish.yml` — Publishes artifacts
- `marketplace-*.yml` — Marketplace operations
- `deploy-docs.yml` — Deploys docs

**PR trigger**: `test.yml` runs on all PRs to main/dev. Smoke tests run on push to main/dev only (deterministic tier always, AI tiers opt-in).

**Existing app startup**: `e2e-smoke.yml:73-94` starts Archon via `bun run cli workflow run <name>` (CLI-driven, no web server), not a browser test.

## 6. Archon Workflows (`.archon/workflows/`)

**E2E test workflows** (non-AI):

- `e2e-deterministic` — bash/script nodes only, no AI, asserts join semantics/until_bash termination
- `e2e-joins` — composition primitives (join semantics)
- `e2e-fanout-alldone` — fan-out with `all_done` join
- `e2e-fanout-allsuccess` — fan-out with `all_success` join (negative test, expected failure)
- `e2e-container-smoke` — container isolation + approval gates + write-back

**PR review / QA workflows**:

- `archon-comprehensive-pr-review`, `archon-smart-pr-review` — PR review automation
- `archon-issue-review-full` — issue analysis
- `archon-validate-pr` — PR validation
- `maintainer-review-pr` — maintainer PR workflow

**Approval/interactive gates** present in: `e2e-container-smoke.yaml` (approval gate at write-back), `maintainer-review-pr` (approval workflow).

**Bash/script node examples**: `e2e-deterministic` (bash assertions), `e2e-container-smoke` (bash + container operations).

**Output-format / structured output examples**: Grepped for `output_format`, found in several E2E and smoke workflows.

**Relevant docs**: No single YAML reference (authoring guide at `packages/docs-web/src/content/docs/...`; CLAUDE.md line 213+ covers node types, approval gates, `until_bash`, `$ARTIFACTS_DIR`).

## 7. PR-in-flight Feature (spec-1-1-see-this-runs-uncommitted-changed-files.md)

**Feature**: Read-only "Source Control" tab on workflow run screen showing uncommitted changes.

**Acceptance criteria** (lines 84-97):

- **Readable checkout with changes** → list shows each file with M/A/D status badge (renamed file: two rows D old + A new; copied: A; unmerged: M)
- **Readable, clean checkout** → list is empty (not Empty-state panel)
- **Container-backed run** → Empty state, no Reload CTA
- **No readable checkout** → Empty state with Reload CTA
- **Row selection** → visual state only, no diff fetch
- **Keyboard accessibility** → rows reachable/activatable via keyboard

**Files modified**:

- `packages/server/src/routes/api.ts` — new `GET /api/runs/{runId}/changes` route
- `packages/server/src/routes/schemas/workflow.schemas.ts` — new `changedFileSchema`/`runChangesResponseSchema`
- `packages/web/src/components/workflows/SourceControlTab.tsx` (new) — master-detail UI
- `packages/web/src/hooks/useRunChanges.ts` (new) — query hook
- `packages/web/src/components/workflows/WorkflowExecution.tsx` — add tab + view state
- `packages/git/src/status.ts` — fix rename/copy/unmerged classification

**Tech**: Resizable two-pane layout, react-query with `staleTime: Infinity`, manual Reload only.

## 8. Domain Docs

No `CONTEXT.md` or `CONTEXT-MAP.md` at repo root. No `docs/adr/` directory.

## 9. GitHub CLI

`gh auth status` → authenticated as `anhle128` (repo: anhle128/Archon).
`gh api repos/anhle128/Archon --jq '.has_issues'` → `true` (issues enabled).

---

Status: DONE
Summary: Archon has existing E2E smoke tests via CLI workflows, optional agent-browser/playwright skills, and a fresh PR adding a read-only Source Control tab to the run UI. No browser-automation E2E pipeline yet exists; the foundation (docker-compose, app bring-up, skills) is in place.

Unresolved questions: none
