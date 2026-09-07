## Problem and outcome

The existing `pr-e2e-verify` workflow can report passing tests without proving that the UI matches its approved plan and mockup.
Its repair path covers missing third-party test anchors, but does not repair failed UI checks.
This draft adds the workflow needed to repair and verify the full HITL interface through Archon.

- **Outcome:** Failed tests or visual review lead to a concrete diagnosis, a Claude Sonnet 5 repair, and another verification pass.
- **Invariant:** Publication requires complete source coverage, unchanged acceptance tests, current evidence, and the exact tested candidate.
- **Current scope:** Workflow, gate helper, regression tests, CI integration, and operating instructions.
  The actual local workflow run and all product UI repairs remain pending.

Closes #144

## Review guidance

- Start with `.archon/workflows/pr-e2e-verify.yaml`, then `.archon/scripts/ui-verification.ts` for source locks, evidence checks, and publication.
- Review `scripts/ui-verification.test.ts` and the workflow loader/executor tests for rejection cases, route order, and failed exhaustion after five repairs.
- A separate test maintenance commit corrects stale native Ralph expectations from the incoming `develop` update.
  The first loop uses Codex with `gpt-5.6-terra` and `xhigh`; the final OMP/Sonnet loop is unchanged.
  No workflow definition or generated file changes for that correction.
- Review `.github/workflows/pr-e2e-verify.yml`, `.github/workflows/test.yml`, and `docs/ui-verification-workflow.md` for dispatch and CI behavior.
- Use the complete plan and pinned mockup sources linked in #144 to assess UI acceptance after the local run.
  Initial failure evidence is tied to `981c7b39f`.
  The branch now includes `develop` at `e5b07433167a97e222a9e794e49a73fcba4294ce`, including its Terminal feature; the approved HITL plan and mockup bytes are unchanged.
- The remaining review risks are actual browser execution, complete visual coverage, and hosted runner setup.
  A passing bootstrap check does not establish UI alignment.

## Solution

The workflow requires explicit `pr` and `issue` URL inputs, saves the full issue and pinned source documents, and locks the source bytes before test authoring.
A fresh independent audit checks the complete requirement-to-test mapping before the acceptance tests, helpers, fixtures, configuration, and gate are frozen.

Each candidate receives a fresh web build, standalone UI checks, repository validation, and independent browser/image review.
The reviewer repeats real third-party contract coverage for the current candidate.
Missing evidence, changed locks, failed commands, stale candidates, and unresolved criteria reject acceptance.

The existing route-loop engine sends failures through diagnosis and then the repair node configured with `provider: claude` and `model: claude-sonnet-5`.
`route_loop.max_iterations: 5` is the only repair counter.
Exhaustion retains the findings and returns an error.
Publication creates only the verified direct child of the captured PR head and rejects concurrent branch changes.
The workflow does not merge the PR.

The CI integration adapts the existing `PR E2E Verify` caller to named issue/PR inputs and the new lifecycle and evidence records, and extends checks to `develop`.
Automatic runs use the trusted base workflow; a base without the new input contract fails before provider execution.
The bootstrap therefore requires local workflow evidence until the updated workflow is available on the base branch.

## Validation

- Before integration, `bun run validate` completed with exit code 0: 10,463 passing tests and zero failures.
- The fast-forward to `e5b074331` completed without conflicts.
  Hash checks confirmed that existing task edits and user files were preserved, and the approved HITL source paths had no changes.
- After CI integration and the stale test correction, `bun run validate` completed with exit code 0: 10,580 passing tests, zero failures, 30 skipped tests, and 18 todos.
  The root script suite passed all 108 tests.
- **Pending:** Run local Archon with this PR and #144, record the run ID and repair-node model, prove the original failures, repair both UI surfaces, and complete all matched-state visual and responsive checks.
- **Pending:** Record the final tested tree, published commit, standalone UI results, independent review, and PR checks.
- **Hosted limitation:** Repository Actions secrets are currently absent.
  The hosted agent job needs user-supplied `ANTHROPIC_API_KEY` and `OPENAI_API_KEY`; the local run uses existing local authentication.
  The trusted-base bootstrap limitation also prevents a hosted acceptance claim for this draft.
