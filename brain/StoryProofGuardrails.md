# Story Proof Guardrails

Status: active

## Purpose

This taxonomy captures recurring failure modes that cause a story to pass broad validation while remaining misaligned with its technical decisions or insufficiently proven at the required runtime boundary.
Retrospectives and review action items should cite these IDs so lessons remain reusable across stories.

## Failure-Mode Taxonomy

| ID       | Name                            | Default classification | Definition                                                                                                                                                                                          | Required guardrail                                                                                                                                                            |
| -------- | ------------------------------- | ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SPG-01` | Decision-to-plan coverage gap   | Root cause             | A normative technical decision is absent, weakened, or contradicted in the story tasks, implementation notes, or proof plan.                                                                        | Before implementation, map every technical decision to an implementation task, an executable proof, or an explicit non-code constraint. Resolve every conflict before coding. |
| `SPG-02` | Patch-of-patch closure          | Root cause             | A review patch fixes the reported example but does not close the underlying invariant, so a later review finds the adjacent case.                                                                   | Group findings by invariant. Close a group only when the implementation rule and its positive, negative, and boundary proofs are all present.                                 |
| `SPG-03` | Scope and ownership drift       | Root cause             | A story changes packages, contracts, or behavior outside its approved ownership boundary without amending the governing decision.                                                                   | Freeze the allowed package and contract surface before implementation. Any expansion requires an explicit decision amendment or a Defer outcome.                              |
| `SPG-04` | Proof-target mismatch           | Root cause             | A test observes a proxy such as process creation, log-file existence, or a parent acknowledgement when the requirement concerns worker claim, durable state, exact identity, or downstream outcome. | State the required observable for every acceptance criterion and prove that observable at the owning process or persistence boundary.                                         |
| `SPG-05` | Non-hermetic test fixture       | Root cause             | A focused test relies on another test to initialize schema, fixtures, mocks, environment, or process state.                                                                                         | Every focused test or test group must initialize and clean up its own prerequisites and pass when selected independently.                                                     |
| `SPG-06` | Premature completion signal     | Symptom                | Story checkboxes, completion notes, or validation claims are marked complete before the required focused evidence is deterministic and reviewable.                                                  | Require a proof reference for each completion claim and prohibit completion based only on a broad suite passing.                                                              |
| `SPG-07` | Finding ownership not triaged   | Root cause             | Every review candidate is treated as an in-story Patch even when it belongs to another story, package owner, or planning decision.                                                                  | Assign every candidate exactly one outcome: Patch, Defer, or Dismiss, with an owner and rationale before implementation begins.                                               |
| `SPG-08` | Generated-artifact source drift | Symptom                | A generated consumer artifact is patched or reviewed independently of its source schema or route contract.                                                                                          | Change the source of truth first, regenerate with the canonical command, and verify the generated diff.                                                                       |

## Review Closure Rules

1. Review against the technical decisions and acceptance invariants before reviewing individual lines.
2. Re-open an invariant cluster when a patch changes its ownership boundary or proof target.
3. Do not start another full adversarial pass while known root-cause clusters remain unresolved.
4. A broad validation pass is necessary but does not replace standalone focused proof.
5. A finding outside the approved story boundary must be Deferred or must trigger an explicit planning amendment before it becomes implementation work.

## Origin

This file was created from the Story 3.3d partial retrospective after repeated recovery-command review loops exposed decision drift, scope expansion, proxy proofs, and order-dependent E2E setup.
