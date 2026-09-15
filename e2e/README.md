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

## Run against a product checkout

Build the target checkout with `bun run build:web`, then run the durable suite
from this directory. Fixtures remain owned by this suite; the CLI, server, and
built web app come from `ARCHON_E2E_REPO_ROOT` when supplied.

```bash
ARCHON_E2E_REPO_ROOT=/absolute/path/to/product-checkout \
ARCHON_E2E_PORT_BASE=13600 ARCHON_PW_CHANNEL=chrome \
npx playwright test --grep '\[V:hitl\.console-ask-submit\]'
```

`ARCHON_E2E_PORT_BASE` defaults to 3400; each worker adds its worker index.
Occupied ports are rejected without stopping their owner. `ARCHON_PW_CHANNEL`
is optional and can select an installed Chrome when bundled Chromium is absent.
Every worker uses an isolated temporary home and SQLite database, and cleans up
its owned processes and temporary directory on success or failure.

Stable `[V:<scenario-id>]` tags coexist with the `[P0]`/`[P1]` priority tags.
List resolved titles with `npx playwright test --list --reporter=json`, including
the parameterized Console and Legacy scenarios.

The unowned Ask scenarios create real CLI runs with `ARCHON_USER_ID`, `USER`,
and `USERNAME` empty, and assert null ownership before clicking a card. They do
not seed answers. Unsupported setup is a failure carrying the Playwright
annotation `{ "type": "verification-setup", "description": "unsupported" }`, never
a pass: older fake providers may reject the long-history fixture, and the owned
authorization contract requires authenticated server mode rather than this
suite's solo SQLite runtime. The 401/403 assertions remain in that scenario.

Set `ARCHON_E2E_PROOF=1` to retain screenshots for passing tests as well as failures.
It also enables known-regression scenarios that intentionally target historical
defective revisions. The normal HITL suite skips those cases; `verify-archon`
sets proof mode and treats their behavioral failures as product FAIL evidence.

## Merge gate (single signal)

The UI merge-gate on PRs into `develop` is the GitHub check **`PR E2E Verify`**
(`.github/workflows/pr-e2e-verify.yml`). On every non-draft PR that touches UI
paths it runs:

```bash
bun run cli workflow run pr-e2e-verify <pr-url-or-number>
```

That Archon DAG (`pr-e2e-verify`) AXI-drives the PR head (`plan-tests`), gates
third-party contract coverage (`verify` / `resolve`), commits and pushes any
new durable test evidence, then re-snapshots that exact PR head. A structured
behavior proposal is normalized against the catalog and executed by the same
`verify-archon` runner used manually. The gate reads `result.json`; missing,
skipped, flaky, unsupported, stale, or behaviorally failed scenarios block it.

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
- `.archon/scripts/verify-feature-gate.ts` — deterministic normalization and aggregation
- `.agents/skills/select-verify-archon-targets/**` — selector contract
- `.agents/skills/verify-archon/**` — catalog and shared runner
- `.claude/skills/web-automation-test-pr/**`, `chrome-devtools-axi/**`,
  `verify-thirdparties-e2e-test-pr/**`

Not included: `packages/docs-web/**` (Astro docs site; `docs-build.yml`).

### Require the check later

1. GitHub → Settings → Rules → Rulesets (or Branch protection).
2. Target `develop`.
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
