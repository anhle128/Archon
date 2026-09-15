# ak-implement: accept a GitHub issue as input; resolve + co-locate the plan

## Directive

`ak-implement`'s real input is often a GitHub issue URL (e.g. `.../issues/178`). It did NOT know where
the plan file was (resolve-plan treated $ARGUMENTS as a filesystem path → the URL failed). Issue #178's
body links the canonical plan `plans/<slug>/plan.md`. Make the workflow resolve the plan from the issue,
then co-locate the PRD with the plan.

## Checklist

- [x] Add AI node `resolve-plan-source`: detect a GitHub issue (URL or #N), resolve repo (URL owner/repo,
      else current origin), `gh issue view`, extract the canonical plan path its body links; pass a local
      path through unchanged. Output `{plan_path}`. (AI interprets; bash validates — per the repo's
      "Natural Language Is Not a Wire Format" rule.)
- [x] Rewrite `resolve-plan` to consume `$resolve-plan-source.output.plan_path`, with the normalization:
      canonical `<dir>/plan.md` → its DIRECTORY (avoids the `plans/ralph/plan` bug); directory → itself;
      other `.md` → sibling `<dirname(dirname)>/ralph/<name>/`. mkdir + emit JSON `{plan_path, prd_dir}`.
- [x] Update description + STEP comments for the issue input.
- [x] Rewrite regression tests (token-injected source path); add the `plan.md`→directory normalization
      test. 7 resolve-plan tests total.
- [x] Regenerate bundle; `check:bundled` up to date (67 commands, 38 workflows).
- [x] `workflow list` → errorCount:0; ak-implement (resolve-plan-source → resolve-plan) loads.

## Validation

- [x] `bun run validate` → exit 0.
- [x] `bundled-defaults.test.ts` → 39 pass (7 resolve-plan, incl. plan.md-normalization), against the
      shipped bundled bash.

## Files

- `.archon/workflows/defaults/ak-implement.yaml` — new `resolve-plan-source` AI node; `resolve-plan`
  consumes it + `plan.md`→dir normalization; description/comments updated.
- `.archon/workflows/defaults/archon-ralph-dag-project-aware.yaml` — project-aware loop;
  location-agnostic detect-input/validate-prd (from the prior step).
- `.archon/workflows/defaults/archon-ralph-dag.yaml` — untouched original.
- `packages/workflows/src/defaults/bundled-defaults.generated.ts` — regenerated.
- `packages/workflows/src/defaults/bundled-defaults.test.ts` — 7 resolve-plan regression tests.
- `ARCHON_RALPH_RUST_DAG_PLAN.md` — rewritten to final state.

---

# DeepSeek V4 Flash E2E smoke workflow

## Directive

Create a read-only Archon E2E smoke workflow for the `deepseek` provider using the corrected
`qwen-token-plan/deepseek-v4-flash` model reference. Validate the workflow and run it only after
the effective DSH model pair and credential availability are confirmed.

## Checklist

- [x] Inspect the DeepSeek provider contract, model routing, credentials, and adjacent smoke workflows.
- [x] Preserve the corrected literal model string `qwen-token-plan/deepseek-v4-flash`;
      provider-internal routing remains the DeepSeek provider's responsibility.
- [x] Rename and update the smoke workflow under `.archon/workflows/test-workflows/`.
- [x] Validate it with `bun run cli validate workflows e2e-deepseek-v4-flash-smoke`.
- [x] RED: update env/provider tests to require harness-managed credentials and provider-qualified model refs.
- [x] GREEN: remove the API-key-only preflight and translate the literal model ref into DSH's route/model pair.
- [x] Run focused DeepSeek tests, then the full validation suite.
- [x] Run the E2E in default worktree isolation through the authenticated DSH profile.
- [ ] Verify plain output, structured output, and assertion output after the Token Plan account gains model entitlement.

## Review

- Workflow preserves `provider: deepseek` and the corrected literal model string
  `qwen-token-plan/deepseek-v4-flash`.
- `bun run cli validate workflows e2e-deepseek-v4-flash-smoke` passed: 1 valid, 0 errors.
- RED run `d82ad4f42fbcd95bd94b193f5ac8984b` failed before DSH startup with
  `deepseek_missing_api_key`; focused RED tests reproduced both the auth preflight and model-routing defects.
- The provider now allows DSH-managed credentials and converts the literal reference to
  `["qwen-token-plan", "deepseek-v4-flash"]`; focused env/provider/ACP tests and `bun run validate` pass.
- Live run `5c6fd7964df23abbaae6201beb1b18a7` reached the Alibaba backend, proving the credential
  store and route are active, but failed with `403 AccessDenied.Unpurchased`; downstream nodes were skipped.
- No secret contents were read.
