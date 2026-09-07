---
title: UI verification and repair workflow
status: in-progress
branch: codex/ui-verify-fix-loop
created: 2026-09-08
---

# Outcome

Extend `pr-e2e-verify` so a PR can pass only after its UI meets the approved plan and mockup.
Run the workflow locally against this checkout, use Claude Sonnet 5 to repair the HITL run views, and deliver a PR to `anhle128/Archon` on `develop`.
The source checkout starts at `981c7b39f`.
The branch was then fast-forwarded to `e5b074331` to retain the current `develop` Terminal feature and automatic PR gate.
The original HITL plan and mockup bytes are unchanged, and the initial bug evidence remains tied to `981c7b39f`.
The complete task is tracked in [issue #144](https://github.com/anhle128/Archon/issues/144).
The local copy of its source context is [issue-context.md](issue-context.md).

# Authority

The accepted scope is [the HITL alignment plan](../260907-1454-workflow-run-hitl-mockup-alignment/plan.md), its five phases, and its [visual contract](../260907-1454-workflow-run-hitl-mockup-alignment/reports/visual-contract.md).
The canonical design is `_bmad-output/specs/spec-workflow-run-view-hitl/ux-mockup/`, with `ux-design.md` for responsive and accessibility cases absent from the mockup.
The old completion checkboxes are claims to test, not evidence of correctness.
Do not change those source requirements or mockups to make the product pass.
Keep existing workflow, API, database, authorization, history, Source Control, Artifacts, usage, and lifecycle features.

# Evidence and cause

The Console opens a room on a plain URL because its selection helper falls back to awaiting, running, or first nodes.
Its room remains mounted after Close because the render condition does not depend on selection.
The room has fixed width classes and no resize separator.
The Console stream still uses bordered message cards instead of the approved execution sections and compact Markdown.
The existing visual E2E captures screenshots but does not compare the rendered result or assert room lifecycle, resize, or overflow.
Its mockup-capture exception also passes the test.
The current `pr-e2e-verify` repairs only missing external-service test coverage; a failed UI test reaches a report node without a UI repair loop.

# Delivery phases

| Phase                                     | State       | Required evidence                                                                                           |
| ----------------------------------------- | ----------- | ----------------------------------------------------------------------------------------------------------- |
| 1. Build and review the workflow contract | Done        | Source-backed criteria; immutable plan, mockup, and critical tests; validated loop routing                  |
| 2. Create the bootstrap PR                | In progress | Focused checks and `bun run validate`; new branch and draft PR targeting `develop`                          |
| 3. Run local Archon repair                | Pending     | Real run ID; failing browser checks; Sonnet 5 repair nodes; repeated independent review                     |
| 4. Prove complete UI alignment            | Pending     | Every criterion checked on both surfaces; matched-state desktop comparisons; usable 390px and 768px layouts |
| 5. Finish delivery and prevention         | Pending     | Automatic PR UI regression check; complete validation; final PR evidence; no owned orphan processes         |

# Workflow design

Reuse `pr-e2e-verify` and its isolated PR-head checkout.
Require explicit PR and issue inputs and retain the entire issue body as run context.
Separate contract/test authoring, deterministic execution, independent visual review, and implementation.
Use Claude `claude-sonnet-5` for UI implementation with no silent model fallback.
Use a fresh review session so implementation claims are not the acceptance decision.
The author must map every plan requirement to a test or a matched screenshot comparison before repairs start.
Lock issue and source authority before test authoring.
After authoring, lock the criterion manifest, critical tests, E2E helpers, fixtures, runtime setup, commands, configuration, reference assets, and deterministic gate code.
Each loop records a candidate tree, test exit codes, screenshots, and per-criterion review results.
The deterministic gate rejects missing evidence, changed authority, changed locked tests, a changed candidate, failed commands, and unresolved criteria.
Failed checks return to the repair node with the exact findings.
An explicit diagnosis node records each failed criterion, expected and actual behavior, evidence, cause, proposed fix, and regression check before repair.
Configure `route_loop.max_iterations: 5` as the sole loop limit; scripts must not duplicate its counter or control flow.
Repeat third-party verification for every changed candidate, including newly introduced external surfaces.
Exhaustion retains findings and exits nonzero; a successful exhausted target would otherwise complete the engine run.
Publish only the tree that passed, and reject a PR head that changed during the run.
Extend the existing CI workflow to `develop`; keep its HITL job and add real acceptance assertions through workflow authoring.
Update the existing `PR E2E Verify` caller to pass the full PR URL and one linked issue URL.
Automatic runs use the trusted base workflow; a base without the new input contract fails before provider execution.
The bootstrap PR uses the reviewed local workflow run as evidence until the infrastructure update is manually merged.
Manual dispatch can use an explicitly selected reviewed revision and issue URL.

# Acceptance

- [ ] A failing UI test and a failed visual comparison both enter the repair path.
- [ ] Missing images, missing criteria, source changes, test weakening, stale evidence, and command failures cannot pass the gate.
- [ ] The original third-party coverage gate remains part of acceptance.
- [ ] Plain run URLs have no room; a node click or valid deep-link opens the correct room; Close restores width.
- [ ] Room width starts at 460px, supports pointer and keyboard resizing, and clamps to the available space and 320–720px desktop range.
- [ ] Both surfaces implement the full visual contract, including complete scoped agent/tool content and all node room types.
- [ ] Desktop state comparisons use 1440×1000 and 1280×900; responsive checks use 390×844 and 768×1024.
- [ ] Narrow layouts do not overflow the document, clip required actions, or make Ask unusable.
- [ ] Durable tests fail on the original UI and pass after workflow repairs.
- [ ] Local Archon run, independent browser review, full validation, and PR checks prove the final published tree.
- [ ] UI regression verification runs automatically for subsequent UI PR changes.

# Review and rollback

The design uses the existing route-loop engine and existing E2E runtime; it adds no workflow language fields or UI framework.
An independent plan review confirmed this design with the safeguards incorporated above.
Contract locks prevent a repair node from changing the target to fit its implementation.
Visual judgment remains an evidence-backed reviewer decision; a screenshot file alone is not acceptance.
Keep the workflow and UI repairs in separate commits so either can be reverted without database changes.
Keep user-owned `WATCHDOG.yml` outside all commits.

# Current coordination

- Workflow author owns `.archon/workflows/pr-e2e-verify.yaml`, its helper, focused tests, and workflow usage docs.
- CI author owns `.github/workflows/test.yml`, parsed workflow routing tests, and final validation.
- The parsed graph tests prove an immediate pass without repair and five repairs followed by failed exhaustion.
- Pre-integration `bun run validate` passed with 10,463 passing tests and zero failures.
- Integration retained all current task edits and user files without a conflict.
- Integrated `bun run validate` passed with 10,580 passing tests and zero failures after two stale Ralph test contracts were aligned with the incoming provider change.
- The existing automatic CI caller now uses the named issue/PR contract and exact-run publication evidence.
- Root reviewed owned process cleanup, complete test titles, and guarded publication of the verified direct child.
- Delivery agent prepares the bootstrap draft PR; actual workflow execution and UI acceptance remain pending.
- Provider selection is configured in workflow nodes; no separate Sonnet CLI probe is required.
- Root owns issue context, coordination, source traceability, and final acceptance.
- All product UI repairs must run through the Archon workflow with Sonnet 5.

# Open questions

None.
The user confirmed `anhle128/Archon → develop` and Claude Sonnet 5 for UI repair.
