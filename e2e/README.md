# E2E UI tests

Playwright specs in `e2e/ui/`. Run locally:

```bash
cd e2e
npm ci
npx playwright install chromium
npm run test:ui
```

The suite is a standalone npm package (not a bun workspace member) so root
`bun --filter '*'` scripts never download browsers.

## Merge gate (single signal)

The UI merge-gate on PRs into `dev` is the GitHub check **`PR E2E Verify`**
(`.github/workflows/pr-e2e-verify.yml`). On every non-draft PR that touches UI
paths it runs:

```bash
bun run cli workflow run pr-e2e-verify <pr-url-or-number>
```

That Archon DAG (`pr-e2e-verify`) AXI-drives the PR head (`plan-tests`), gates
third-party contract coverage (`verify` / `resolve`), then runs this Playwright
suite (`run-e2e` → `npm run test:ui`).

**This replaces closed PR #126 / `e2e-ui.yml`.** Do not add a second
Playwright-only Actions workflow. Kevin rejected that as redundant: one gate,
`pr-e2e-verify`, auto on UI-path PRs.

### Path filter

The job always runs so a required check never stays pending. It skip-succeeds
when none of these change (and on drafts until `ready_for_review`):

- `packages/web/**` — product UI
- `e2e/**` — this suite
- `.github/workflows/pr-e2e-verify.yml` — the gate itself
- `.archon/workflows/pr-e2e-verify.yaml` — the DAG
- `.claude/skills/web-automation-test-pr/**`, `chrome-devtools-axi/**`,
  `verify-thirdparties-e2e-test-pr/**`

Not included: `packages/docs-web/**` (Astro docs site; `docs-build.yml`).

### Require the check later

1. GitHub → Settings → Rules → Rulesets (or Branch protection).
2. Target `dev`.
3. Require status checks to pass; add exactly **`PR E2E Verify`**.
4. Do not add `e2e-ui` / `UI Playwright e2e` — that workflow was never merged.

Do not rename the job `name:` after pinning.

### Required Actions secrets

Happy path (every UI PR):

| Secret | Used by |
| --- | --- |
| `ANTHROPIC_API_KEY` | `plan-tests` (`provider: claude`) |
| `OPENAI_API_KEY` | `verify` (`provider: codex`; also set as `CODEX_API_KEY`) |
| `GITHUB_TOKEN` | supplied by Actions (`gh` + evidence push) |

Self-heal path (only if `verify` finds gaps):

| Secret | Used by |
| --- | --- |
| `XAI_API_KEY` | `resolve` (`provider: grok`) — optional; warned if missing |

The job fail-fasts with a clear error when Anthropic or OpenAI is unset. It
does not silently skip. `e2e-smoke.yml` already documents that unfunded keys
fail at the provider; this gate is the same — configure funded keys or the
check stays red.

### Runner notes

Ships on `ubuntu-latest` (same class as `marketplace-auto-review.yml`), with
`xvfb-run` so `chrome-devtools-axi` has a `DISPLAY`. The DAG keeps
`worktree.enabled: true` (no `--no-worktree`).

If AXI cannot launch Chrome on GitHub-hosted runners, the job fails closed
(plan-tests / missing screenshots) — not a green no-op. Then point
`runs-on` at a self-hosted runner (or Archon Mini) that has a working Chrome
and the secrets above.
