# Story 3.3d Partial Retrospective - Recovery Command Review Convergence

Status: partial retrospective

Date: 2026-07-20

Scope: Story `3-3d-provide-archon-recovery-command-cli-json` only.

Epic 3 remains in progress, Story 3.3d remains in review, and this document does not mark `epic-3-retrospective` as done.

## Participants

- kevin (Project Lead)
- Amelia (Developer and facilitator)
- Winston (System Architect)
- Murat (Test Architect)
- Alice (Product Owner perspective)

## Executive Summary

Story 3.3d accumulated 49 patch findings across nine review-gate commits after the initial implementation.
The findings are not best understood as 49 independent defects.
They form repeated chains around a small number of unresolved invariants: JSON parser and preflight closure, exact-run retry ownership, persisted recovery context, cancellation CAS compatibility, and executable proof.

The prior Epic 3 partial retrospective correctly identified insufficient story depth as a systemic risk.
Story 3.3d nevertheless shows that additional detail alone is not enough.
The missing controls were decision-to-plan traceability, invariant-level closure, explicit Patch/Defer/Dismiss ownership, and hermetic focused proof.

The story must not be treated as ready for `done` solely because all 49 finding checkboxes are checked or because the full E2E file passes.
On 2026-07-20, the full E2E file passed 74 tests, while selecting the four latest 3.3d proofs produced 0 passes and 4 failures because the database schema depended on earlier tests.

## Story Review

### What Went Well

- The technical-decision artifact is unusually explicit about process boundaries, exact run identity, cancel CAS semantics, error categories, and executable proof.
- The implementation added real subprocess E2E coverage rather than relying only on handler-level unit tests.
- Review repeatedly found concrete correctness and compatibility risks before the story was marked done.
- The contract validator, shared envelope fixtures, strict TypeScript checks, and package-level validation provide useful baseline safeguards.
- The team preserved a complete finding trail, making the review loop diagnosable instead of opaque.

### Finding Distribution

| Invariant cluster                           | Finding IDs                                                   | Count |
| ------------------------------------------- | ------------------------------------------------------------- | ----: |
| CLI parsing and fail-closed preflight       | F1, F3, F10, F15, F16, F18, F19, F24, F31, F40, F41, F44, F45 |    13 |
| Retry worker and exact-run identity         | F4, F6, F7, F11, F12, F13, F20, F25                           |     8 |
| Recovery-context validation                 | F5, F21, F29, F33, F37, F39, F46                              |     7 |
| Cancel CAS and legacy abandon compatibility | F2, F22, F26, F28, F32, F36, F43, F49                         |     8 |
| Executable proof completeness               | F8, F9, F14, F23, F27, F30, F34, F38, F42, F47, F48           |    11 |
| TEA or specification drift                  | F17, F35                                                      |     2 |

This distribution shows that later findings repeatedly revisited the same boundaries rather than discovering unrelated feature areas.

## What Failed

| Failure ID | Classification   | Guardrail                    | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                                 | Impact                                                                                                       |
| ---------- | ---------------- | ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `3D-RC-01` | Root cause       | `SPG-01`                     | TD-007 requires typed parent error causes and rejects English-message sniffing, while the story task directed implementation to add classifier patterns and `classifyRunError()` still uses `msg.includes(...)`. TD-N03 says CLI-only, while the patch surface expanded into core, server, and generated web types. TD-002 assigns later retry validation to the worker, while story tasks also required parent retryability validation. | Code review evaluated an implementation plan that already weakened or contradicted its governing decisions.  |
| `3D-RC-02` | Root cause       | `SPG-02`                     | F40 led to F44, F41 led to F45, F39 led to F46, F42 led to F47, F30 led to F48, and F43 led to F49.                                                                                                                                                                                                                                                                                                                                      | Fixes closed examples but not the full invariant, producing patch-of-patch review rounds.                    |
| `3D-RC-03` | Root cause       | `SPG-07`                     | All recorded candidates were accepted as Patch findings; no Defer or Dismiss ownership gate was visible in the story.                                                                                                                                                                                                                                                                                                                    | Out-of-scope or planning-level issues became implementation work inside the same story.                      |
| `3D-RC-04` | Root cause       | `SPG-04`, `SPG-05`           | Retry proof observed a worker log instead of worker claim and exact outcome, resume proof did not cover every declared no-mutation observable, and the E2E seed helpers relied on earlier tests to initialize the database schema.                                                                                                                                                                                                       | Broad validation could pass without deterministic proof of the required runtime behavior.                    |
| `3D-S-01`  | Symptom          | `SPG-02`                     | The story accumulated 49 findings and nine review-gate commits after the implementation commit.                                                                                                                                                                                                                                                                                                                                          | Review cost grew while confidence did not converge at the same rate.                                         |
| `3D-S-02`  | Symptom          | `SPG-03`                     | The committed story diff spans 15 files with 3,958 insertions and 242 deletions, including core database operations and server routes despite the CLI-only decision.                                                                                                                                                                                                                                                                     | Blast radius and rollback complexity increased beyond the approved story boundary.                           |
| `3D-S-03`  | Symptom          | `SPG-06`                     | Completion notes repeatedly stated that every finding and `bun run validate` passed, while later rounds reopened the same invariant families.                                                                                                                                                                                                                                                                                            | Checklist state became a weaker signal than executable evidence.                                             |
| `3D-S-04`  | Symptom          | `SPG-05`, `SPG-06`           | The full `workflow-json.e2e.test.ts` run passed 74/74, but the focused selection for 3.3D-CLI-039, 042, 043, and 044 failed 0/4 with `no such table: remote_agent_conversations`.                                                                                                                                                                                                                                                        | Test order masked missing fixture initialization and made focused review evidence unreliable.                |
| `3D-RO-01` | Review overreach | `SPG-03`, `SPG-07`, `SPG-08` | The cancel finding chain expanded through legacy abandon behavior, HTTP 409 responses, OpenAPI declarations, and generated web types. The compatibility risk was legitimate, but TD-N03 did not authorize implementing the entire cross-package fix in this story.                                                                                                                                                                       | The correct response should have been Revert, Defer, or amend the technical decision before expanding scope. |
| `3D-RO-02` | Review overreach | `SPG-02`, `SPG-07`           | Each patch round reopened the whole changed surface without first freezing scope and closing known invariant clusters.                                                                                                                                                                                                                                                                                                                   | Review generated adjacent findings faster than the process retired their root causes.                        |

## Root-Cause Analysis

### Decision detail was present but not enforced as a coverage gate

The technical-decision artifact was not missing.
The failure occurred when decisions were translated into story tasks without a one-to-one coverage check.
This allowed a story plan to instruct string-based classification despite TD-007, parent validation despite worker ownership, and cross-package changes despite the CLI-only boundary.

### Findings were managed as a queue instead of invariant clusters

The review process tracked each new example as another numbered patch.
It did not require the owner to restate the invariant, enumerate adjacent cases, and prove the whole boundary before closing the cluster.
That explains why the last six findings were direct descendants of earlier findings rather than new feature concerns.

### Review ownership was implicit

A finding can be technically valid and still not belong to the active story.
Without an explicit Patch, Defer, or Dismiss decision, compatibility findings in core, server, and web were automatically absorbed into the CLI story.
This turned review into uncontrolled scope expansion.

### The proof suite validated sequence, not isolation

The E2E file's earlier tests initialized the schema as a side effect.
Later recovery tests passed only when executed after that setup.
The full-file pass therefore proved one test order, while focused execution exposed that the tests were not self-contained.

## Previous Retrospective Follow-Through

The previous partial retrospective is `_bmad-output/implementation-artifacts/epic-3-partial-retro-2026-07-16.md`.

| Previous commitment                                    | Assessment                | Evidence                                                                                                                   |
| ------------------------------------------------------ | ------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Deepen create-story output                             | In progress, insufficient | Story 3.3d contains detailed slices and a proof sketch, but decision contradictions were not caught before implementation. |
| Revise remaining Epic 3 stories before implementation  | In progress               | Story 3.3d was revised, but revision did not produce a decision-to-task traceability gate.                                 |
| Add a review-risk checklist with explicit evidence     | In progress, insufficient | The story contains extensive proof tasks, but checklist completion was not bound to standalone executable evidence.        |
| Escalate unresolved contract or policy decisions       | Not effectively applied   | The decision artifact says no unresolved decisions, yet the story plan conflicts with TD-N03, TD-002, and TD-007.          |
| Keep code review focused on implementation correctness | Not achieved              | Review had to resolve planning contradictions and expanded into legacy API and generated-web ownership.                    |

## Significant Discoveries

1. Story depth is necessary but not sufficient.
   The process needs a machine-checkable or reviewer-checkable decision-to-plan coverage table.
2. A green broad suite is not proof-readiness when focused cases cannot initialize their own prerequisites.
3. A valid compatibility concern does not automatically belong to the current story.
   Ownership triage must happen before a patch is authorized.
4. Review convergence should be measured by closed invariants, not by the number of checked finding IDs.

These discoveries affect the remaining Epic 3 stories, especially 3.5 and 3.7, because both have strict ownership boundaries and generated contract surfaces.

## Action Items

1. Reconcile Story 3.3d against every technical decision using a decision-to-task-to-proof matrix.
   Owner: Winston (System Architect) and Amelia (Developer).
   Completion gate: before another Story 3.3d code-review gate.
   Success criteria: TD-N03, TD-N04, TD-002, TD-003, TD-004, TD-005, TD-007, and TD-009 each map to a consistent implementation task, proof, and owning package, with no contradiction left unresolved.
   Linked failures: `SPG-01`, `SPG-03`, `3D-RC-01`.

2. Make the recovery E2E fixture hermetic.
   Owner: Murat (Test Architect).
   Completion gate: before focused E2E evidence is accepted.
   Success criteria: the seed path explicitly initializes the SQLite schema, and 3.3D-CLI-039, 042, 043, and 044 pass both independently and in the full file.
   Linked failures: `SPG-05`, `SPG-06`, `3D-RC-04`, `3D-S-04`.

3. Replace finding-by-finding closure with invariant-cluster closure for Story 3.3d.
   Owner: Amelia (Developer).
   Completion gate: before checking any additional review finding as resolved.
   Success criteria: each of the six finding clusters has a written invariant, allowed scope, positive proof, negative proof, boundary proof, and evidence reference.
   Linked failures: `SPG-02`, `SPG-04`, `3D-RC-02`, `3D-S-01`.

4. Resolve the CLI-only scope conflict before retaining core, server, or web changes.
   Owner: Winston (System Architect).
   Completion gate: before Story 3.3d can leave review.
   Success criteria: either amend TD-N03 and the story scope with explicit ownership and generated-type regeneration, or revert and defer the cancel/abandon API compatibility chain to its owning story.
   Linked failures: `SPG-03`, `SPG-07`, `SPG-08`, `3D-RO-01`.

5. Require Patch, Defer, or Dismiss ownership for every review candidate.
   Owner: Amelia (Developer and review facilitator).
   Completion gate: every remaining Story 3.3d review round and every later Epic 3 review.
   Success criteria: no candidate enters the implementation queue without an outcome, rationale, owner, and affected decision or acceptance criterion.
   Linked failures: `SPG-07`, `3D-RC-03`, `3D-RO-02`.

6. Close the actual runtime observables for resume and retry.
   Owner: Murat (Test Architect) and Amelia (Developer).
   Completion gate: before Story 3.3d is marked done.
   Success criteria: resume proves every declared no-mutation observable, and retry proves exact run and node identity, worker claim, one-winner execution, and a later status, event, or terminal outcome rather than only parent output or log existence.
   Linked failures: `SPG-04`, `SPG-06`, `3D-RC-04`.

7. Apply the new Story Proof Guardrails to Stories 3.5 and 3.7 before implementation readiness.
   Owner: Winston (System Architect), Amelia (Developer), and Murat (Test Architect).
   Completion gate: before either story moves into implementation.
   Success criteria: each story includes decision coverage, package-scope ownership, invariant clusters, hermetic focused proof, and generated-artifact source-of-truth checks from `brain/StoryProofGuardrails.md`.
   Linked failures: all actions are directly related to `SPG-01` through `SPG-08`.

## Readiness Assessment

| Area                          | Assessment     | Required resolution                                                                     |
| ----------------------------- | -------------- | --------------------------------------------------------------------------------------- |
| Acceptance-contract alignment | Blocked        | Reconcile the story plan with TD-N03, TD-002, and TD-007.                               |
| Focused test determinism      | Blocked        | Initialize schema explicitly and pass focused recovery tests standalone.                |
| Retry runtime proof           | Blocked        | Prove worker claim, exact identity, one-winner behavior, and later outcome.             |
| Resume no-mutation proof      | Partial        | Cover every observable declared by the story rather than only selected database fields. |
| Scope and rollback boundary   | Blocked        | Decide whether core, server, and web changes belong to this story.                      |
| Epic closure                  | Not applicable | Epic 3 remains in progress and this is only a story-level partial retrospective.        |

## Preparation for Remaining Epic 3 Stories

- Add a decision-to-task-to-proof matrix before implementation begins.
- Define the allowed package and generated-contract surface explicitly.
- Require each focused proof to pass without relying on another test's setup.
- Review by invariant cluster and assign Patch, Defer, or Dismiss before code changes.
- Keep generated artifacts downstream of their source schema and canonical regeneration command.

## Commitments and Next Steps

1. Treat the current 49 checked findings as historical records, not sufficient closure evidence.
2. Resolve the four Story 3.3d readiness blockers above before another broad review pass.
3. Track the seven action items in sprint status without marking the Epic 3 retrospective complete.
4. Revisit this partial retrospective when Story 3.3d reaches deterministic proof readiness.
