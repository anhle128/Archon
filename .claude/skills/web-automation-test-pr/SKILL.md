---
name: web-automation-test-pr
description: >-
  Use to write end-to-end frontend test scenarios for a Pull Request by FIRST
  framing the full end-to-end user story (the whole journey a user takes through
  the real running app that exercises the changed feature), THEN deriving the
  edge cases. It drives the REAL app with chrome-devtools-axi (frontend +
  backend + the app's own database) so the feature's write/record path runs for
  real and reads its own data from the real database; it mocks ONLY external
  third-party services the app calls out to. Each scenario states the user
  actions, the external(s) to mock + their response, and the expected result on
  screen. Crystallizes each into a durable Playwright `.spec.ts`, emits
  reviewer-visible screenshot artifacts for UI/UX PRs, and lists mocked
  externals as requirements for verify-thirdparties-e2e-test-pr. Triggers:
  "web automation test PR", "e2e test PR", "user story test", "browser test PR".
---

# web-automation-test-pr

Project-agnostic: the PR (in whatever repo) is the only input. Read the repo under test to learn its stack, flows, and API shapes. This skill contains nothing specific to any one project.

## Responsibility — user story FIRST, then edge cases

For one PR, write E2E test scenarios in this order:

1. **Frame the full end-to-end USER STORY** — the complete real journey a user takes that exercises the changed feature, start to finish, through the running app. A whole flow, never a slice.
2. **Derive the EDGE CASES** from that story — every branch, variant, mode, and failure it can take.
3. Turn the happy-path story **and each edge case** into a concrete scenario.

## What is REAL vs MOCKED (critical)

- **REAL — the whole application stack:** frontend, backend, and the app's own database. The feature's WRITE/record path must run for real (the user's actions genuinely create/record data that gets persisted), and reads come back from the real database through the real API. **Never mock the app's own API, and never shortcut-seed its database when the user story would produce that data itself.** Reading alone is not enough — the story must make the data.
- **MOCKED — only EXTERNAL third-party services** the app calls out to (e.g. AI providers, payment gateways, email/SMS senders, external REST APIs), so the run is deterministic and free. Each mocked external becomes a requirement for `verify-thirdparties-e2e-test-pr`: the external must have a backend contract/e2e test anchoring its real response shape, or the mock is false confidence.

## Step 1 — Frame the user story (end to end)

Write the happy path as: who, does what, through which screens/actions, producing what data, ending in what they see. Trace it through the REAL flow:
`user action → app processing (incl. the external call you will mock) → app writes/records to its DB → app reads it back → UI shows the result.`
Read the source to get the flow right — do not guess how the feature records or serves its data.

## Step 2 — Derive edge cases

From the story, enumerate the branches that actually change behavior. Common axes to consider:

- **Every variant the feature supports** — each option, mode, or backend it can use. Test them; don't test one and assume the rest.
- **External response variants that change behavior** — response shapes the app handles down different code paths (e.g. one form of result vs another that triggers different processing), missing/partial fields, zero, very large values.
- **Special or secondary passes** the feature can take within one flow.
- **Missing / partial / fallback data**, error responses, empty vs zero, and pure client-side validation (no request fired).

## Step 3 — Write each scenario

Per scenario, state four things:
- **User actions (UI)** — open / select / type / click.
- **External(s) to mock + the exact response** (or error).
- **What the app does for real** — the record/insert/query the story triggers.
- **Expected result on screen.**

## Step 4 — Execute + crystallize (AXI drive, then Playwright)

**Live drive is chrome-devtools-axi. The durable gate is Playwright.** Do not skip the live drive and invent a spec from source alone. Do not replace `e2e/` Playwright (`npm run test:ui`) with AXI.

Follow the `chrome-devtools-axi` skill for CLI, session isolation, `STALE_REF`, and cleanup.

1. **Boot the real app** from this checkout (PR head). Use an isolated `ARCHON_HOME` (or the repo's equivalent) and poll readiness (e.g. `GET /api/health`). Record PIDs you start. Prefer the isolation pattern in `e2e/lib/playwright/archon-runtime.ts` when this is Archon — AXI still drives the browser; Playwright does not.
2. **Drive with AXI** (`npx -y chrome-devtools-axi`, `CHROME_DEVTOOLS_AXI_SESSION=$WORKFLOW_ID`):
   `open` → `snapshot` → `click`/`fill` → **`screenshot`**.
3. **Read every screenshot file** and judge the visible UX **before** writing asserts. A snapshot tree is not enough for UI/UX work.
4. **Crystallize** into `e2e/ui/<feature>.spec.ts` (`trace:'on-first-retry'`, `screenshot:'only-on-failure'`, `[P0]/[P1]/[P2]` name tags).
5. Run the crystallized spec headless once (`cd e2e && npm run test:ui` scoped to the new file if possible) to confirm green.
6. **Cleanup:** `npx -y chrome-devtools-axi stop` with the same session env; kill only recorded app PIDs. Never `pkill chrome` / `pkill node`.

### Screenshot evidence contract

Write authoring screenshots under `$ARTIFACTS_DIR/plan-tests/` (run evidence). Do **not** commit them unless they already belong in git; Playwright specs under `e2e/ui/` are the durable regression proof. `e2e/ui/reports/` is gitignored — do not treat it as the reviewer evidence dir.

**UI/UX PRs require at least one screenshot artifact.** Treat the PR as UI/UX when changed files include frontend/web/CSS/layout or user-visible copy (pages, components, styles, i18n strings rendered on screen). Then `artifacts` MUST contain ≥1 `{ "kind": "screenshot", ... }` whose `path` is a real file you Read.

If capture fails after **two** limited retries (re-snapshot / re-open / re-screenshot): **fail this node**. Do not emit a successful structured output, do not claim plan-tests done, and do not silently skip. Explain why capture was impossible.

Non-UI PRs (API/engine/docs-only, no visible surface) may emit `artifacts: []` only when you state that no UI was exercised.

## Output

```json
{
  "pr": "<n>",
  "user_story": "who does what -> produces what data -> sees what",
  "scenarios": [
    { "id": "S1", "prio": "P0", "kind": "happy-path | edge-case",
      "ui_steps": ["..."],
      "mock_external": [ { "service": "...", "response": { } } ],
      "app_effect": "the real record/insert/query this triggers",
      "expect_ui": ["..."] }
  ],
  "mocked_externals": [ "..." ],
  "spec_file": "e2e/ui/<feature>.spec.ts",
  "ui_touched": true,
  "artifacts": [
    { "kind": "screenshot", "path": "$ARTIFACTS_DIR/plan-tests/happy-path.png", "purpose": "Cost page after a real recorded run" }
  ]
}
```

`artifacts[].kind` is `"screenshot"` or `"other"`. `path` must exist on disk for screenshots. `purpose` is one line a reviewer can read.

## Notes / constraints

- Feature- and project-agnostic — read the repo under test to learn its stack, flows, and API/response shapes.
- Don't guess: read source for the real flow, the response shapes, and how each variant records data.
- Running the real write path without hitting a real external often needs a test double/fake for that external, injected at the app's provider/dependency seam. If the app has no such seam, that is net-new work — surface it, don't fake the data some other way.
- Write ONLY new test files (specs, helpers, fixtures) under `e2e/`. Do not modify workflow YAML, provider/model settings, or unrelated config.
- `STALE_REF`: re-snapshot and retry; do not invent refs (see `chrome-devtools-axi`).
