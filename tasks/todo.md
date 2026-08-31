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
