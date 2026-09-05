# route_loop self-heal workflow — plan

Keystone: assemble the two skills + the e2e vehicle into one Archon workflow that, for a
ready PR, verifies the feature end-to-end and self-heals missing third-party test coverage.

## Settled decisions (user, 2026-09-05)

1. **run-e2e** = run the Playwright specs authored by `web-automation-test-pr` (Lane B).
2. **negative route** = trigger an **Agent that RESOLVES the missing items**, then loop back to Lane A.
   Not comment-only: the resolve agent has tools (bash) to run providers / capture real output and
   write the missing contract test — the same work done by hand for the 7 provider anchors.
3. **input** = a PR request (PR number / ref) → `$ARGUMENTS`.
4. **Lane A requirements** = BOTH the handed-in list from `web-automation-test-pr` AND derived from the PR diff.

## DAG (nodes)

```
plan-tests   (skills: web-automation-test-pr)  → scenarios + mocked_externals; writes e2e/ui/<f>.spec.ts
   ↓
verify       (skills: verify-thirdparties-e2e-test-pr; output_format {allTicked, unticked})
   ↓                                    ↑ re-entered after resolve (loop-back)
gate         (route_loop, condition "$verify.output.allTicked == true", depends_on [verify])
   ├─ positive  → run-e2e   (bash: cd e2e && npm run test:ui)          → exit
   ├─ negative  → resolve   (agent: fix unticked → write/capture contract tests) → loops back to verify
   └─ exhausted → comment-pr (bash: gh pr comment with the unticked gaps)         → exit
```

## Node specs

- **plan-tests**: `provider: claude`, `skills: [web-automation-test-pr]`, prompt gets `$ARGUMENTS` (PR).
  `output_format` = the requirements contract (mocked_externals → thirdparty requirements).
- **verify**: `provider: claude`, `skills: [verify-thirdparties-e2e-test-pr]`, reads plan-tests output +
  PR diff; `output_format: { allTicked: boolean, unticked: array }`. MUST NOT use `when:` (route_loop
  condition producer). `trigger_rule: one_success`, `depends_on: [plan-tests, resolve]` so it runs on the
  first pass AND after each resolve loop-back.
- **gate**: `route_loop`, `depends_on: [verify]`, condition on `$verify.output.allTicked`, `max_iterations: 3`.
- **resolve**: agent node (Claude, tools) — reads `$verify.output.unticked`, resolves each (run provider /
  capture real output / write contract test). No `depends_on` (route target). Upstream of `verify` via the
  loop-back wiring.
- **run-e2e**: `bash:` — `cd e2e && npm run test:ui` (needs deps + browser installed on the runner).
- **comment-pr**: `bash:` — `gh pr comment "$ARGUMENTS" --body-file "$ARTIFACTS_DIR/gaps.md"` (precedent: harness-validate-feature-pr `post-report`).

## Open risks / to confirm before/while building

- **route_loop loop-back wiring**: memory pattern (`verify` gets `trigger_rule: one_success` + dep on the
  negative target `resolve`) vs the speckit example (producer depends only on its normal predecessor).
  CONFIRM against `loader.ts` route_loop rules before finalizing; mirror a proven example.
- **running Playwright inside a workflow node**: the runner needs `e2e/` deps + chromium installed, and a
  built `packages/web/dist`; likely a first-run setup step or a precondition.
- **`requires: [github]`** + `gh` auth for the PR read + comment.
- **skills on a Claude node**: confirm `web-automation-test-pr` / `verify-thirdparties-e2e-test-pr` resolve
  as node skills (they live at `.claude/skills/<name>/`).
- Validate with `interactive`/`worktree` semantics for a PR-triggered run.

## Build order

1. Confirm route_loop wiring from loader source.
2. Write the workflow YAML (`.archon/workflows/<pack>/pr-e2e-verify.yaml`).
3. `POST /api/workflows/validate` (or discovery) to confirm it loads (catches wiring errors at load time).
4. Dry-run the loop mechanics with a stub (fake provider) before wiring the real skills.
