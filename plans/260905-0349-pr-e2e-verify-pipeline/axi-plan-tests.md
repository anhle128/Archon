# plan-tests AXI authoring (steps A+B)

- **Date:** 2026-09-07
- **Scope:** A+B only. Playwright `run-e2e` stays the durable gate.
- **Out of scope:** step C (hard CI required-check wiring), step D / closed PR #124
  (stock `archon-validate-pr-e2e-*` / validate-ui / replicate-issue / Docker
  agent-browser → AXI).

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

## Evidence to expect

| Phase      | What                                        | Where                                                      |
| ---------- | ------------------------------------------- | ---------------------------------------------------------- |
| plan-tests | AXI screenshots + structured `artifacts[]`  | `$ARTIFACTS_DIR/plan-tests/` (run evidence, not committed) |
| plan-tests | Crystallized specs                          | `e2e/ui/*.spec.ts` (commit-evidence may push these)        |
| run-e2e    | Playwright `npm run test:ui`                | `$ARTIFACTS_DIR/e2e-status.txt`, `e2e-result.log`          |
| report-pr  | Verdict + optional AXI screenshot path list | GitHub PR comment                                          |

Session isolation: `CHROME_DEVTOOLS_AXI_SESSION=$WORKFLOW_ID`. Cleanup is
`chrome-devtools-axi stop` + recorded PIDs — never `pkill chrome` / `pkill node`.
