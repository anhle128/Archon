# plan-tests AXI authoring (steps A+B) + CI auto-trigger (C)

- **Date:** 2026-09-07
- **Scope:** A+B (AXI + screenshots) plus C (auto-run `pr-e2e-verify` on UI PRs).
  Playwright `run-e2e` stays the durable regression gate inside the DAG.
- **Out of scope:** step D / closed PR #124 (stock `archon-validate-pr-e2e-*` /
  validate-ui / replicate-issue / Docker agent-browser → AXI). Closed PR #126 /
  `e2e-ui.yml` is intentionally not used — one gate, not a second Playwright GHA.

## Locked decisions

1. `e2e/` + `cd e2e && npm run test:ui` is the regression gate. Do not convert
   `run-e2e` to AXI.
2. `chrome-devtools-axi` replaces live agent-browser **only** on the
   authoring/drive path inside `plan-tests` / `web-automation-test-pr`
   (Mode B: live once → crystallize `.spec.ts`).
3. UI/UX PRs must produce reviewer-visible screenshot `artifacts[]` under
   `$ARTIFACTS_DIR/plan-tests/`. Missing evidence = fail / do not claim
   plan-tests done.

## How to run

```bash
archon workflow run pr-e2e-verify <pr-number-or-url>
# from source:
bun run cli workflow run pr-e2e-verify <pr-number-or-url>
```

CI auto-invokes that command on non-draft PRs into `dev` that touch UI paths.
Check name: **`PR E2E Verify`**. See `e2e/README.md`.

## Evidence to expect

| Phase      | What                                        | Where                                                      |
| ---------- | ------------------------------------------- | ---------------------------------------------------------- |
| plan-tests | AXI screenshots + structured `artifacts[]`  | `$ARTIFACTS_DIR/plan-tests/` (run evidence, not committed) |
| plan-tests | Crystallized specs                          | `e2e/ui/*.spec.ts` (commit-evidence may push these)        |
| run-e2e    | Playwright `npm run test:ui`                | `$ARTIFACTS_DIR/e2e-status.txt`, `e2e-result.log`          |
| report-pr  | Verdict + optional AXI screenshot path list | GitHub PR comment                                          |

Session isolation: `CHROME_DEVTOOLS_AXI_SESSION=$WORKFLOW_ID`. Cleanup is
`chrome-devtools-axi stop` + recorded PIDs — never `pkill chrome` / `pkill node`.
