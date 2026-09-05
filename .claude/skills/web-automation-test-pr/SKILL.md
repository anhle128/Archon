---
name: web-automation-test-pr
description: >-
  Use to write end-to-end frontend test scenarios for a Pull Request by FIRST
  framing the full end-to-end user story (the whole journey a user takes through
  the real running app that exercises the changed feature), THEN deriving the
  edge cases. It drives the REAL app (frontend + backend + the app's own
  database) so the feature's write/record path runs for real and reads its own
  data from the real database; it mocks ONLY external third-party services the
  app calls out to. Each scenario states the user actions, the external(s) to
  mock + their response, and the expected result on screen. Crystallizes each
  into a durable Playwright `.spec.ts`, and emits the mocked externals as
  requirements for verify-thirdparties-e2e-test-pr. Triggers: "web automation
  test PR", "e2e test PR", "user story test", "browser test PR".
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

## Step 4 — Execute + crystallize

Drive the real app following the scenario, mocking only the external(s); assert the UI. Crystallize into `e2e/ui/<feature>.spec.ts` (`trace:'on-first-retry'`, `screenshot:'only-on-failure'`, `[P0]/[P1]/[P2]` name tags). Run headless once to confirm green.

## Output

```json
{
  "pr": <n>,
  "user_story": "who does what -> produces what data -> sees what",
  "scenarios": [
    { "id": "S1", "prio": "P0", "kind": "happy-path | edge-case",
      "ui_steps": ["..."],
      "mock_external": [ { "service": "...", "response": { } } ],
      "app_effect": "the real record/insert/query this triggers",
      "expect_ui": ["..."] }
  ],
  "mocked_externals": [ "..." ],
  "spec_file": "e2e/ui/<feature>.spec.ts"
}
```

## Notes / constraints

- Feature- and project-agnostic — read the repo under test to learn its stack, flows, and API/response shapes.
- Don't guess: read source for the real flow, the response shapes, and how each variant records data.
- Running the real write path without hitting a real external often needs a test double/fake for that external, injected at the app's provider/dependency seam. If the app has no such seam, that is net-new work — surface it, don't fake the data some other way.
