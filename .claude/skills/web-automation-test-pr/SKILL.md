---
name: web-automation-test-pr
description: >-
  Use to plan and perform web (browser) end-to-end automation testing for a
  Pull Request's user-facing changes. From a PR it decides WHAT to test and
  WHAT to mock/seed, drives the running app in a browser (Playwright) to verify
  each behavior, and crystallizes the verification into a durable Playwright
  `.spec.ts`. This is the "Lane B" (internal system) side. It also emits the
  list of third-party dependencies it mocked — each of which needs a real
  third-party e2e test, which `verify-thirdparties-e2e-test-pr` then gates on.
  Triggers: "web automation test PR", "e2e test this PR", "verify PR in browser",
  "lane B test", "browser test PR".
---

# web-automation-test-pr

## Responsibility (single)

Produce and run the **Lane B** web-automation E2E verification for one PR:
1. From the PR diff, decide **what user-facing behavior to test** and **what to mock/seed** (hermetic).
2. Bring up the app, seed deterministic fixture state, and **drive a browser to verify** each behavior.
3. **Crystallize** the passing verification into a committed Playwright `.spec.ts` (Mode B — record once, replay free forever).
4. Emit the **third-party mock boundary**: the list of external dependencies you mocked, each becoming a third-party e2e requirement for `verify-thirdparties-e2e-test-pr` to check.

Out of scope: authoring or judging third-party contract tests themselves (that is `verify-thirdparties-e2e-test-pr` + the implement agent). Do NOT call real AI/provider/paid APIs from Lane B.

## Inputs

- A PR reference (number or branch). Read it with `gh pr diff <n>` / `gh pr view <n>`.
- The running Archon repo at the current working directory.

## Core principle — hermetic, contract-anchored

Lane B never calls a real third-party (no real AI keys, no paid API). Every external dependency is **mocked/seeded with fixed data**. A mock is only trustworthy because a matching real third-party e2e test anchors it — so for each dependency you mock, record it as a third-party e2e requirement (handed off to `verify-thirdparties-e2e-test-pr`). Mock everything with no anchor = false confidence.

## Steps

1. **Read the PR.** `gh pr diff <n>` and `gh pr view <n>`. Identify the user-facing surfaces changed (routes, pages, API endpoints, UI components). Do NOT guess — read the changed source files.
2. **Produce the plan** — two lists plus a mock/seed plan:
   - **Test scenarios** — concrete browser-driven checks that prove each user-facing behavior (e.g. "Cost page shows the seeded usage total for run X").
   - **Third-party e2e requirements** — for every external dependency this PR touches that you will mock, the contract/e2e test that MUST exist to anchor that mock (assert the real dependency's response shape). This list is the input to `verify-thirdparties-e2e-test-pr`.
   - **Mock/seed plan** — how to hermetically create the fixture state. Default tier = **seed the DB** (a fresh temp DB, real server aggregation + real UI). A runtime fake-provider does NOT exist in Archon today (`WorkflowDeps.getAgentProvider` is the seam but no fake is registered) — treat fake-provider seeding as net-new work, not a default.
3. **Bring up the app** (isolated, prod-like, one origin):
   ```bash
   export ARCHON_HOME=/tmp/archon-e2e-$$
   mkdir -p "$ARCHON_HOME"
   bun run build:web
   PORT=<free-port> bun run start &
   # wait for readiness (bypasses auth gate):
   until curl -sf "http://localhost:<free-port>/api/health" >/dev/null; do sleep 0.5; done
   ```
4. **Seed fixture state** via REST API (not the UI): `POST /api/codebases`, `POST /api/workflows/{name}/run`, etc. For usage/cost-style features, seed the rows the read path serves. Keep every value fixed/deterministic.
5. **Drive the browser to verify.** Use Playwright (Playwright MCP for the live exploration). Prefer `getByTestId` / `getByRole` selectors. Verify every scenario from step 2.
6. **Crystallize** into a durable spec under `e2e/ui/<feature>.spec.ts`, following the `e2e/` conventions (worker-scoped boot fixture, `trace:'on-first-retry'`, `screenshot:'only-on-failure'`, `[P0]/[P1]/[P2]` name tags, hermetic route-mocks/seed). Run it once headless to confirm it is green.
7. **Tear down** always (even on failure): stop the server you started (by its recorded PID), remove the temp `ARCHON_HOME`.

## Output

A structured summary:
```
{
  "pr": <n>,
  "test_scenarios": [ ... ],            // what Lane B verifies in the browser
  "thirdparty_e2e_requirements": [ ... ],// mocked deps → each needs a real third-party e2e test
  "mock_seed_plan": "seed-db | fake-provider(net-new) | browser-mock(avoid)",
  "spec_file": "e2e/ui/<feature>.spec.ts",
  "result": "pass | fail",
  "failures": [ ... ]
}
```

## Notes / constraints

- Skill file lives at `.claude/skills/web-automation-test-pr/` so both a Claude Code Skill-tool session and an Archon workflow node (`skills: [web-automation-test-pr]`) resolve it (Claude provider searches `<cwd>/.claude/skills/`).
- Feature-agnostic: the PR is an input; never hard-code a specific feature.
- Manual-first: this skill is runnable by hand now; later it becomes the Lane-B execution node of the PR-verification workflow.
- If a step can't be proven, report it — do not fabricate a passing spec.
