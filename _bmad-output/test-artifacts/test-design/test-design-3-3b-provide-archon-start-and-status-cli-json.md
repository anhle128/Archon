---
workflowStatus: 'completed'
totalSteps: 5
stepsCompleted:
  - 'step-01-detect-mode'
  - 'step-02-load-context'
  - 'step-03-risk-and-testability'
  - 'step-04-coverage-plan'
  - 'step-05-generate-output'
lastStep: 'step-05-generate-output'
nextStep: ''
lastSaved: '2026-07-16'
mode: 'epic-level'
epic: '3'
story: '3.3b'
status: 'draft'
inputDocuments:
  - '_bmad-output/implementation-artifacts/3-3b-provide-archon-start-and-status-cli-json.md'
  - '_bmad-output/project-context.md'
  - '_bmad/tea/config.yaml'
  - '_bmad-output/implementation-artifacts/sprint-status.yaml'
  - '_bmad-output/planning-artifacts/prd.md'
  - '_bmad-output/planning-artifacts/architecture.md'
  - '_bmad-output/planning-artifacts/epics.md'
  - '_bmad-output/planning-artifacts/contracts/workflow-commander/README.md'
  - '_bmad-output/planning-artifacts/contracts/workflow-commander/schemas/workflow-command-envelope.schema.json'
  - '_bmad-output/planning-artifacts/contracts/workflow-commander/examples/providers/archon/commands/start-success.json'
  - '_bmad-output/planning-artifacts/contracts/workflow-commander/examples/providers/archon/commands/status-success.json'
  - '_bmad-output/planning-artifacts/contracts/workflow-commander/examples/providers/archon/commands/error-*.json'
  - '_bmad-output/test-artifacts/test-design/test-design-3-3a-define-shared-workflow-provider-command-envelope.md'
  - 'packages/cli/package.json'
  - 'packages/cli/src/cli.ts'
  - 'packages/cli/src/commands/workflow.ts'
  - 'packages/cli/src/commands/workflow.test.ts'
  - 'packages/cli/src/commands/workflow-provider-command-envelope.ts'
  - 'packages/cli/src/commands/provider-binding*.test.ts'
  - 'packages/workflows/src/schemas/workflow-run.ts'
---

# Test Design: Epic 3 - Story 3.3b Provide Archon Start And Status CLI JSON

**Date:** 2026-07-16  
**Author:** kevin  
**Status:** Draft

## Executive Summary

**Scope:** Epic-level test design for Story 3.3b.
This story converts `archon workflow run <name> [message] --json` foreground mode and `archon workflow get <run-id> --json` into Workflow Commander shared-envelope JSON for external controllers.

**Risk summary:**

- Total risks identified: 22
- High-priority risks, score >= 6: 21
- P0 acceptance blockers: foreground start JSON purity, status envelope replacement, exact fixture conformance, fail-closed failures, CLI argv prevalidation, error classification, and forbidden field/secret leakage.
- Critical categories: BUS, OPS, TECH, SEC, DATA

**Coverage summary:**

- P0 scenarios: 22, estimated ~24-40 hours.
- P1 scenarios: 30, estimated ~28-52 hours.
- P2/P3 scenarios: none required for this story.
- Total estimated effort: ~52-92 hours, roughly 1.5-2.5 engineering weeks depending on subprocess harness and binding lookup complexity.

## Not in Scope

| Item                                             | Reasoning                                                             | Mitigation                                                             |
| ------------------------------------------------ | --------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| Approve/reject command envelope conversion       | Story 3.3c owns decision commands.                                    | W-3.3B-001 and scope guard STATIC-047.                                 |
| Resume/retry/cancel command envelope conversion  | Story 3.3d owns recovery commands.                                    | W-3.3B-001 and scope guard STATIC-047.                                 |
| State-changing HTTP control route                | PRD FR-8 forbids HTTP control for Workflow Commander v1.              | STATIC-047 verifies no server route is added.                          |
| Browser, Web UI, API route, or component testing | This story is headless CLI output only.                               | CLI subprocess and command-unit tests cover the executable surface.    |
| DB schema or migration changes                   | The story maps existing workflow run records and does not add tables. | File-scope review and rollback notes.                                  |
| Hard process-level timeout/signal guarantee      | No accepted foreground timeout/cancellation contract exists.          | Timeout rejection is tested; OS signal/hard cancel remains W-3.3B-002. |
| Application-level auth/permission policy         | Local CLI runs under OS-process trust.                                | W-3.3B-003; re-review on remote or multi-user exposure.                |

## Risk Assessment

Probability and Impact use 1 low, 2 medium, 3 high.
Score is Probability x Impact.
Scores 6-8 require mitigation; score 9 blocks acceptance until mitigated or formally waived.
Priority is promoted to P0/P1 when failure can break core behavior, security, data integrity, compatibility, or a cross-process controller contract.

### High-Priority Risks

| Risk ID    | Category | Description                                                                                                           |   P |   I | Score | Pri | Mitigation / verification                                       | Owner / timeline                                     |
| ---------- | -------- | --------------------------------------------------------------------------------------------------------------------- | --: | --: | ----: | --- | --------------------------------------------------------------- | ---------------------------------------------------- |
| 3.3B-R-001 | BUS/OPS  | Foreground `workflow run --json` emits no `workflow.start` envelope or leaks human progress text to stdout.           |   3 |   3 |     9 | P0  | UNIT-001/002, CLI-040, CONTRACT-041/042.                        | CLI implementer / Slice 1                            |
| 3.3B-R-002 | BUS/OPS  | `workflow get --json` keeps legacy raw run or `{ ok:false }` instead of `workflow.status`.                            |   3 |   3 |     9 | P0  | UNIT-020/026/027/028, CLI-039, CONTRACT-041/042.                | CLI implementer / Slices 3-4                         |
| 3.3B-R-003 | TECH/BUS | Envelopes drift from schema or fixtures through wrong refs, command ids, or result fields.                            |   3 |   3 |     9 | P0  | CONTRACT-041/042/043 and fixture diffs.                         | CLI implementer + contract reviewer / Slices 1-5     |
| 3.3B-R-004 | BUS/OPS  | Exceptions before or during foreground execution throw unstructured errors in JSON mode.                              |   3 |   3 |     9 | P0  | UNIT-009 through UNIT-017.                                      | CLI implementer / Slice 2                            |
| 3.3B-R-005 | BUS/OPS  | `cli.ts` prevalidation returns usage prose before envelope-producing command logic.                                   |   3 |   3 |     9 | P0  | CLI-035 through CLI-038.                                        | CLI implementer / Slices 2 and 5                     |
| 3.3B-R-006 | BUS/OPS  | Timeout, malformed, schema mismatch, unexpected state, and unexpected exit classifications are wrong or incomplete.   |   2 |   3 |     6 | P0  | UNIT-016/027/028 and CONTRACT-043.                              | CLI implementer / Slices 2 and 4                     |
| 3.3B-R-007 | BUS/OPS  | Correlation ID is not plumbed, blank handling is wrong, or generated IDs are invalid.                                 |   2 |   3 |     6 | P1  | UNIT-018/019/033.                                               | CLI implementer / Slices 1 and 3                     |
| 3.3B-R-008 | BUS/DATA | `workflowRunRef` is missing, stale, or built from wrong workflow/project data.                                        |   2 |   3 |     6 | P1  | UNIT-001/020/030 and CONTRACT-042.                              | CLI implementer / Slices 1 and 3                     |
| 3.3B-R-009 | BUS/DATA | Optional `projectBindingRef` lookup is ambiguous, wrong, or fails after run acceptance.                               |   2 |   3 |     6 | P1  | UNIT-004/005/006.                                               | CLI + provider-binding owners / Slice 1              |
| 3.3B-R-010 | BUS/TECH | Paused runs are not mapped to `waiting-for-approval`, `actionRequired`, and `gateRef`, or malformed metadata crashes. |   2 |   3 |     6 | P1  | UNIT-008/021/024.                                               | CLI implementer / Slices 1 and 3                     |
| 3.3B-R-011 | BUS/TECH | Status mapping, `terminal`, `actionRequired`, or phase is wrong across workflow states.                               |   2 |   3 |     6 | P1  | UNIT-022/023/025.                                               | CLI implementer / Slice 3                            |
| 3.3B-R-012 | BUS/OPS  | Start acknowledgement uses completed/status semantics instead of contract start acknowledgement.                      |   2 |   3 |     6 | P1  | UNIT-007 and CONTRACT-042.                                      | CLI implementer / Slice 1                            |
| 3.3B-R-013 | BUS/OPS  | `--detach --json` existing ack shape regresses.                                                                       |   2 |   3 |     6 | P1  | UNIT-034.                                                       | CLI implementer / Slice 5                            |
| 3.3B-R-014 | SEC/BUS  | Envelopes include forbidden prose/stdout/stderr keys or leak secrets/raw output.                                      |   2 |   3 |     6 | P0  | CONTRACT-044 and CLI-040.                                       | Security reviewer + CLI implementer / Slices 2 and 5 |
| 3.3B-R-015 | TECH/BUS | Contract fixtures are edited or production code imports planning artifacts to fit runtime.                            |   2 |   3 |     6 | P1  | CONTRACT-045 and STATIC-046.                                    | Contract reviewer / Slice 5                          |
| 3.3B-R-016 | TECH/OPS | Bun `mock.module()` pollution makes tests order-dependent.                                                            |   3 |   2 |     6 | P1  | STATIC-048 and package-script evidence.                         | Test implementer / Slice 6                           |
| 3.3B-R-017 | DATA/BUS | Status reads during transition or with stale/malformed metadata produce impossible composite envelopes.               |   2 |   3 |     6 | P1  | UNIT-024/030/031/032.                                           | CLI + workflow-store owners / Slice 3                |
| 3.3B-R-018 | OPS/BUS  | Hung command, signal, or cancellation leaves no terminal parseable envelope.                                          |   2 |   3 |     6 | P1  | UNIT-016/027 and OPS-052; W-3.3B-002 for OS signal/hard cancel. | CLI architecture owner / before remote supervision   |
| 3.3B-R-019 | BUS/TECH | `--verbose --json` status or event-fetch failure corrupts the envelope.                                               |   2 |   3 |     6 | P1  | UNIT-029.                                                       | CLI implementer / Slice 3                            |
| 3.3B-R-021 | TECH/BUS | Scope creep converts approve/reject/recovery/HTTP routes in this story.                                               |   2 |   3 |     6 | P1  | STATIC-047.                                                     | Story owner + reviewer / every slice                 |
| 3.3B-R-022 | OPS/BUS  | Serialization fails if `safeStringify` is bypassed for circular, BigInt, or function-valued details.                  |   2 |   3 |     6 | P1  | UNIT-017.                                                       | CLI implementer / Slices 2 and 4                     |

### Lower-Priority Risk

| Risk ID    | Category | Description                                                                 |   P |   I | Score | Pri | Action                                                                       |
| ---------- | -------- | --------------------------------------------------------------------------- | --: | --: | ----: | --- | ---------------------------------------------------------------------------- |
| 3.3B-R-020 | BUS/OPS  | Replacing legacy `workflow get --json` breaks an undiscovered CLI consumer. |   1 |   3 |     3 | P1  | Current search found docs/tests only; STATIC-049 requires recheck before PR. |

## Reviewer-Evidence Disposition

Every known reviewer concern is evidence, not optional advice.

| Concern                                                                                                       | Disposition                                                 |   P |   I | Score | Scenario or waiver                           |
| ------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- | --: | --: | ----: | -------------------------------------------- |
| RC-01 Foreground `workflow run --json` currently has no shared-envelope output.                               | Risk.                                                       |   3 |   3 |     9 | R-001; UNIT-001                              |
| RC-02 Foreground JSON path still prints human text.                                                           | Risk.                                                       |   3 |   3 |     9 | R-001/R-014; UNIT-002                        |
| RC-03 `workflow get --json` emits legacy raw run or `{ ok:false }`.                                           | Risk.                                                       |   3 |   3 |     9 | R-002; UNIT-020/026                          |
| RC-04 `cli.ts` does not pass `--correlation-id` into workflow run/get.                                        | Risk.                                                       |   2 |   3 |     6 | R-007; UNIT-018/019                          |
| RC-05 Workflow-not-found and flag-validation failures must be `MALFORMED_REQUEST`.                            | Risk.                                                       |   3 |   3 |     9 | R-004/R-005/R-006; UNIT-009/010, CLI-035/037 |
| RC-06 Timeout errors must classify as `COMMAND_TIMEOUT`/`timeout`/retryable.                                  | Risk.                                                       |   2 |   3 |     6 | R-006/R-018; UNIT-016/027                    |
| RC-07 DB query failure for status must classify timeout versus internal error.                                | Risk.                                                       |   2 |   3 |     6 | R-006; UNIT-027/028                          |
| RC-08 `executeWorkflow` returning `success:false` must emit `WORKFLOW_FAILED`, not throw.                     | Risk.                                                       |   3 |   3 |     9 | R-004/R-006; UNIT-014                        |
| RC-09 Contract fixtures must not be edited; runtime must conform.                                             | Risk.                                                       |   2 |   3 |     6 | R-003/R-015; CONTRACT-042/045                |
| RC-10 Shared builders from 3.3a must be used directly.                                                        | Risk.                                                       |   2 |   3 |     6 | R-003/R-022; STATIC-046, UNIT-017            |
| RC-11 Error fixtures cover malformed, schema mismatch, timeout, unexpected exit, unexpected state.            | Risk.                                                       |   2 |   3 |     6 | R-006; CONTRACT-043                          |
| RC-12 Start success fixture includes `operation`, `state`, `phase`, `accepted`, optional `projectBindingRef`. | Risk.                                                       |   2 |   3 |     6 | R-009/R-012; UNIT-004/005/007                |
| RC-13 Status success fixture includes `terminal`, `actionRequired`, and `gateRef`.                            | Risk.                                                       |   2 |   3 |     6 | R-010/R-011; UNIT-021/022                    |
| RC-14 `WorkflowRunStatus` must map all current enum values.                                                   | Risk.                                                       |   2 |   3 |     6 | R-011; UNIT-022                              |
| RC-15 `gateRef` comes only from valid approval metadata.                                                      | Risk.                                                       |   2 |   3 |     6 | R-010/R-017; UNIT-021/024                    |
| RC-16 `--detach --json` must preserve existing ack shape.                                                     | Risk.                                                       |   2 |   3 |     6 | R-013; UNIT-034                              |
| RC-17 Forbidden keys must be absent.                                                                          | Security/compatibility risk.                                |   2 |   3 |     6 | R-014; CONTRACT-044                          |
| RC-18 Existing package test isolation must be preserved.                                                      | Test reliability risk.                                      |   3 |   2 |     6 | R-016; STATIC-048                            |
| RC-19 Legacy `workflow get --json` consumer search is required.                                               | Compatibility risk, lower probability after current search. |   1 |   3 |     3 | R-020; STATIC-049                            |
| RC-20 Approve/reject/recovery envelopes are deferred.                                                         | Explicit non-risk if scope stays clean.                     |   1 |   2 |     2 | W-3.3B-001; STATIC-047                       |
| RC-21 State-changing HTTP control path is forbidden for v1.                                                   | Explicit non-risk if no server route is added.              |   1 |   3 |     3 | STATIC-047                                   |
| RC-22 Runtime cancellation/signal behavior is not specified beyond timeout classification.                    | Operational waiver plus timeout tests.                      |   2 |   3 |     6 | W-3.3B-002; OPS-052                          |
| RC-23 Local CLI has no application auth requirement.                                                          | Explicit non-risk under OS-process trust.                   |   1 |   3 |     3 | W-3.3B-003; SEC-051                          |

## Waivers

| Waiver                                                           | Reason                                                                                                                                 | Owner                  | Residual risk                                                                  | Follow-up trigger                                                                                    |
| ---------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | ---------------------- | ------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------- |
| W-3.3B-001 Deferred decision/recovery envelopes                  | Stories 3.3c and 3.3d own approve/reject/resume/retry/cancel conversion.                                                               | Epic 3 owner           | Those commands keep legacy JSON until their stories run.                       | Start Story 3.3c or 3.3d, or any controller needs those commands before then.                        |
| W-3.3B-002 Process-level cancellation and hard timeout guarantee | Story requires timeout classification, but no accepted CLI process timeout/cancellation contract exists for foreground `workflow run`. | CLI architecture owner | A killed or indefinitely hung process may not emit a terminal envelope.        | Remote supervision, controller SLA, or explicit timeout flag becomes accepted.                       |
| W-3.3B-003 Application auth/permission policy                    | Current surface is local CLI under OS-process trust and no HTTP control route is allowed.                                              | Security reviewer      | Local users with shell access can invoke commands according to OS permissions. | Remote/multi-user invocation, server route, or role-scoped Workflow Commander control is introduced. |

## NFR Planning

This section plans validation evidence.
Final PASS, CONCERNS, or FAIL decisions belong to `nfr-assess` after implementation evidence exists.

| NFR                               | Requirement / threshold                                                                                                                                                 | Risk link                  | Planned validation                                                              | Evidence needed                                                    |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------- | ------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| Security                          | No forbidden prose/stdout/stderr fields; no secret/signing material; failure execution metadata redacts stdout/stderr.                                                  | R-014                      | CONTRACT-044, CLI-040, SEC-051                                                  | Bun test output, scan output, file-scope diff                      |
| Reliability                       | Start/status JSON paths never throw unstructured errors for known failure classes; malformed metadata fails closed.                                                     | R-004, R-006, R-017, R-022 | UNIT-009 through UNIT-017, UNIT-024, UNIT-026 through UNIT-031                  | Focused command test output and fault-injection logs               |
| Compatibility                     | Every emitted start/status/error JSON parses as one `workflow-command-envelope.v1`, matches fixtures except documented dynamic fields, and preserves `--detach --json`. | R-001, R-002, R-003, R-013 | UNIT-001/020/021, CLI-035 through CLI-040, CONTRACT-041 through CONTRACT-045    | Fixture diffs, schema validation, subprocess stdout/stderr capture |
| Data integrity/reference accuracy | Status/start refs describe one persisted workflow run snapshot and do not invent project or binding identity.                                                           | R-008, R-009, R-017        | UNIT-004 through UNIT-006, UNIT-022 through UNIT-025, UNIT-030 through UNIT-033 | Mocked row snapshots and mapping assertions                        |
| Maintainability                   | Strict TypeScript, no production planning-artifact imports, package-isolated tests, full validation gate.                                                               | R-015, R-016               | STATIC-046 through STATIC-050                                                   | Type-check, package script review, import scan, `bun run validate` |
| Performance/timeout               | UNKNOWN: no foreground command runtime timeout SLO exists. Timeout errors must be classifiable when surfaced.                                                           | R-018                      | UNIT-016, UNIT-027, OPS-052                                                     | Timeout tests and W-3.3B-002                                       |
| Permission/auth                   | Local OS-process trust; no application role policy in this story.                                                                                                       | RC-23                      | SEC-051                                                                         | Scope review and W-3.3B-003                                        |
| Compliance                        | No regulatory requirement stated. Contract traceability is the project-specific gate.                                                                                   | R-003, R-015               | CONTRACT-041 through CONTRACT-045                                               | Contract validator and traceability matrix                         |

**Unknown thresholds:** foreground command hard timeout, cancellation/signal envelope guarantee, and status phase source are not fully specified.
They are covered by R-018/W-3.3B-002 and UNIT-025 rather than guessed.

## Entry Criteria

- [ ] Story 3.3b requirements and checked-in Workflow Commander contract fixtures are available.
- [ ] Story 3.3a shared envelope builders and tests are passing.
- [ ] The chosen `projectBindingRef` lookup rule is accepted or explicitly waived for absent/ambiguous bindings.
- [ ] Test file isolation is planned before adding new `mock.module()` use.
- [ ] The old `workflow get --json` consumer search is re-run before PR.

## Exit Criteria

- [ ] All P0 scenarios pass.
- [ ] All P1 scenarios pass or have an approved waiver with owner, residual risk, and follow-up trigger.
- [ ] Every AC, score-6+ risk, and reviewer concern has scenario-or-waiver traceability.
- [ ] Start/status success envelopes and error envelopes match contract fixtures except documented dynamic fields.
- [ ] `--detach --json` existing ack shape is preserved.
- [ ] No contract fixture is edited to make runtime pass.
- [ ] `bun run validate` passes before PR.

## Test Coverage Plan

P0/P1/P2/P3 indicate risk priority, not execution timing.
Execution timing is in the Execution Strategy section.
Cross-level overlap is intentional only for P0 parse-safety behavior that can fail before command handlers run.

### P0 Critical

| Test ID           | Requirement                                                                             | Test Level      | Risk Link           | Notes                     |
| ----------------- | --------------------------------------------------------------------------------------- | --------------- | ------------------- | ------------------------- |
| 3.3B-UNIT-001     | Foreground run success emits `workflow.start` matching start fixture.                   | Unit/command    | R-001, R-003        | Happy path, fixture diff. |
| 3.3B-UNIT-002     | Foreground JSON stdout has no human text.                                               | Unit/command    | R-001, R-014        | Parse-safety.             |
| 3.3B-UNIT-009     | Workflow-not-found emits `MALFORMED_REQUEST`.                                           | Unit/command    | R-004, R-006        | Negative path.            |
| 3.3B-UNIT-010     | Flag conflict emits `MALFORMED_REQUEST`.                                                | Unit/command    | R-005               | Boundary/malformed flags. |
| 3.3B-UNIT-014     | `executeWorkflow success:false` emits `WORKFLOW_FAILED`.                                | Unit/command    | R-004, R-006        | Failure result path.      |
| 3.3B-UNIT-015     | `executeWorkflow` throw emits structured failure.                                       | Unit/command    | R-004, R-006        | Dependency failure.       |
| 3.3B-UNIT-016     | Start timeout maps to `COMMAND_TIMEOUT`.                                                | Unit/command    | R-006, R-018        | Timeout.                  |
| 3.3B-UNIT-020     | Running status emits `workflow.status` success envelope.                                | Unit/command    | R-002, R-003        | Status happy path.        |
| 3.3B-UNIT-021     | Paused status matches status fixture with gateRef.                                      | Unit/command    | R-010, R-011        | Approval pause.           |
| 3.3B-UNIT-026     | Status not found emits `NOT_FOUND`.                                                     | Unit/command    | R-002, R-006        | Negative path.            |
| 3.3B-UNIT-027     | Status DB timeout maps to `COMMAND_TIMEOUT`.                                            | Unit/command    | R-006               | Timeout.                  |
| 3.3B-CLI-035      | Missing workflow name emits one start error envelope.                                   | CLI subprocess  | R-005               | Dispatcher boundary.      |
| 3.3B-CLI-036      | Missing string flag value does not swallow `--json`.                                    | CLI subprocess  | R-005               | Malformed input.          |
| 3.3B-CLI-037      | Mutually exclusive flags via argv emit one envelope.                                    | CLI subprocess  | R-005               | Dispatcher boundary.      |
| 3.3B-CLI-038      | Missing status run ID emits one status error envelope.                                  | CLI subprocess  | R-005               | Dispatcher boundary.      |
| 3.3B-CLI-039      | Missing status run stdout is exactly one JSON document and exit code nonzero.           | CLI subprocess  | R-002, R-014        | Parse-safety.             |
| 3.3B-CLI-040      | Representative start/status JSON has pure stdout and no contract-relevant stderr prose. | CLI subprocess  | R-001, R-002, R-014 | Raw process proof.        |
| 3.3B-CONTRACT-041 | Produced start/status envelopes validate against JSON schema.                           | Contract        | R-003               | Schema gate.              |
| 3.3B-CONTRACT-042 | Produced start/status envelopes match success fixtures.                                 | Contract        | R-003               | Fixture equality.         |
| 3.3B-CONTRACT-043 | Produced failure envelopes match five error fixture classes.                            | Contract        | R-006               | Fail-closed classes.      |
| 3.3B-CONTRACT-044 | Forbidden/prose/stdout/stderr/secret keys are absent recursively.                       | Contract/static | R-014               | Security/compatibility.   |

### P1 High

| Test ID           | Requirement                                                       | Test Level           | Risk Link    | Notes                  |
| ----------------- | ----------------------------------------------------------------- | -------------------- | ------------ | ---------------------- |
| 3.3B-UNIT-003     | Non-json foreground run remains human-readable.                   | Unit/command         | Regression   | Compatibility.         |
| 3.3B-UNIT-004     | Binding-present start includes `projectBindingRef`.               | Unit/command         | R-009        | Optional binding.      |
| 3.3B-UNIT-005     | Binding-absent start omits `projectBindingRef`.                   | Unit/command         | R-009        | Optional binding.      |
| 3.3B-UNIT-006     | Binding lookup failure does not emit false binding ref.           | Unit/command         | R-009        | Partial failure.       |
| 3.3B-UNIT-007     | Non-paused start uses acknowledgement shape and omits `terminal`. | Unit/command         | R-012        | Fixture precision.     |
| 3.3B-UNIT-008     | Paused start emits waiting-for-approval result.                   | Unit/command         | R-010        | Approval pause.        |
| 3.3B-UNIT-011     | Workflow load error is structured.                                | Unit/command         | R-004        | Dependency failure.    |
| 3.3B-UNIT-012     | Conversation DB failure is structured.                            | Unit/command         | R-004        | Dependency failure.    |
| 3.3B-UNIT-013     | Codebase/isolation failure is structured.                         | Unit/command         | R-004        | Partial failure.       |
| 3.3B-UNIT-017     | Non-serializable details still emit one JSON envelope.            | Unit/command         | R-022        | Serialization.         |
| 3.3B-UNIT-018     | Supplied correlation ID is preserved.                             | Unit/command         | R-007        | Metadata.              |
| 3.3B-UNIT-019     | Blank/missing correlation ID generates UUID.                      | Unit/command         | R-007        | Boundary.              |
| 3.3B-UNIT-022     | All `WorkflowRunStatus` values map correctly.                     | Unit/command         | R-011        | Boundary table.        |
| 3.3B-UNIT-023     | Failed status includes machine-readable result error.             | Unit/command         | R-011        | Failed status.         |
| 3.3B-UNIT-024     | Malformed approval metadata cannot crash status.                  | Unit/command         | R-010, R-017 | Stale/malformed data.  |
| 3.3B-UNIT-025     | Missing/unknown phase source is defined or classified.            | Unit/command         | R-011        | Boundary.              |
| 3.3B-UNIT-028     | Status non-timeout DB failure emits internal error envelope.      | Unit/command         | R-006        | Dependency failure.    |
| 3.3B-UNIT-029     | `--verbose --json` cannot corrupt status envelope.                | Unit/command         | R-019        | Regression.            |
| 3.3B-UNIT-030     | Status transition read uses coherent row snapshot.                | Unit/command         | R-017        | Stale data/race.       |
| 3.3B-UNIT-031     | Out-of-order events do not corrupt phase/status result.           | Unit/command         | R-017        | Out-of-order events.   |
| 3.3B-UNIT-032     | Duplicate status queries are side-effect free.                    | Unit/command         | R-017        | Duplicate actions.     |
| 3.3B-UNIT-033     | Concurrent calls do not leak correlation IDs.                     | Unit/command         | R-007        | Concurrency/race.      |
| 3.3B-UNIT-034     | `--detach --json` existing ack shape is preserved.                | Unit/command         | R-013        | Regression.            |
| 3.3B-CONTRACT-045 | Contract validator passes and fixtures unchanged.                 | Contract/static      | R-015        | Source-of-truth guard. |
| 3.3B-STATIC-046   | Production CLI code does not import `_bmad-output`.               | Static               | R-015        | Boundary.              |
| 3.3B-STATIC-047   | No HTTP/web/decision/recovery scope creep.                        | Static               | R-021        | Scope.                 |
| 3.3B-STATIC-048   | New mocks isolated in package script.                             | Static               | R-016        | Test reliability.      |
| 3.3B-STATIC-049   | Legacy consumer search re-run and docs/tests updated.             | Static/regression    | R-020        | Compatibility.         |
| 3.3B-STATIC-050   | Rollback remains CLI-only, no DB/server rollback.                 | Static/rollback      | Rollback     | Operational.           |
| 3.3B-SEC-051      | Local CLI auth waiver remains valid; no remote control added.     | Static/security      | W-3.3B-003   | Permission/auth.       |
| 3.3B-OPS-052      | Timeout rejection covered; signal/hard cancel waiver recorded.    | Unit/waiver boundary | R-018        | Cancellation.          |

## Mandatory Traceability

### Acceptance Criteria

| AC                                                                                                                                                                                                                         | Covered by scenarios                                                                            | Waiver                                                       |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| AC1: Start returns parseable JSON with schema version, success flag, correlation id, workflow run reference, optional binding reference, result payload, and project cwd/codebase reference support.                       | UNIT-001 through UNIT-008, UNIT-018/019, CLI-040, CONTRACT-041/042                              | None                                                         |
| AC2: Status returns run state, workflow name, run reference, correlation id, machine-readable failed-state error shape, and shared status example conformance.                                                             | UNIT-020 through UNIT-033, CLI-039/040, CONTRACT-041/042                                        | None                                                         |
| AC3: Start/status failures return schema version, success flag, correlation id if available, machine-readable error code/category, and fail-closed handling for malformed JSON, schema mismatch, timeout, unexpected exit. | UNIT-009 through UNIT-017, UNIT-026 through UNIT-028, CLI-035 through CLI-039, CONTRACT-043/044 | W-3.3B-002 only for OS-signal/hard-cancel envelope guarantee |

### High-Risk Items

All score >= 6 risks map to scenarios:
R-001 to UNIT-001/002 and CLI-040; R-002 to UNIT-020/026/027/028 and CLI-039; R-003 to CONTRACT-041/042/043; R-004 to UNIT-009 through UNIT-017; R-005 to CLI-035 through CLI-038; R-006 to UNIT-016/027/028 and CONTRACT-043; R-007 to UNIT-018/019/033; R-008 to UNIT-001/020/030; R-009 to UNIT-004/005/006; R-010 to UNIT-008/021/024; R-011 to UNIT-022/023/025; R-012 to UNIT-007; R-013 to UNIT-034; R-014 to CONTRACT-044 and CLI-040; R-015 to CONTRACT-045 and STATIC-046; R-016 to STATIC-048; R-017 to UNIT-024/030/031/032; R-018 to UNIT-016/027/OPS-052 plus W-3.3B-002; R-019 to UNIT-029; R-021 to STATIC-047; R-022 to UNIT-017.

### Reviewer Concerns

RC-01 through RC-19 map directly in the reviewer-evidence table above.
RC-20 is waived by W-3.3B-001 and guarded by STATIC-047.
RC-21 is guarded by STATIC-047.
RC-22 is covered by timeout scenarios plus W-3.3B-002.
RC-23 is waived by W-3.3B-003 and guarded by SEC-051.

## Execution Strategy

Run everything in PRs if it stays under the normal package runtime.
This story's tests are CLI/unit/static and should not need a nightly lane.

- PR: new command-unit tests, contract/static tests, focused subprocess tests, `bun --filter @archon/cli test`, `bun --filter @archon/cli type-check`, and `python3 _bmad-output/planning-artifacts/contracts/workflow-commander/validate_contracts.py`.
- Pre-PR: `bun run validate`.
- Nightly/weekly: none unless a future process-level timeout/cancellation or remote supervision SLO adds long-running tests.

## Resource Estimates

| Priority | Count | Total effort | Notes                                                                                         |
| -------- | ----: | ------------ | --------------------------------------------------------------------------------------------- |
| P0       |    22 | ~24-40 hours | Fixture conformance, fail-closed command paths, subprocess parse-safety.                      |
| P1       |    30 | ~28-52 hours | Metadata, optional binding, stale/malformed state, static guards, rollback and waiver checks. |
| P2/P3    |     0 | ~0 hours     | No lower-priority coverage required.                                                          |
| Total    |    52 | ~52-92 hours | Includes harness setup and package-script isolation.                                          |

## Quality Gate Criteria

- P0 pass rate: 100%.
- P1 pass rate: 100% for this story unless an explicit owner-approved waiver is recorded.
- Every AC, score-6+ risk, and reviewer concern retains scenario-or-waiver traceability.
- No P0/P1 test is skipped, quarantined, or hidden behind retries.
- Contract fixtures and validator pass unchanged.
- `--json` stdout is exactly one parseable JSON document for in-scope start/status success and failure paths.
- NFR evidence is identified for each in-scope category; final NFR status is deferred to `nfr-assess`.
- `bun run validate` passes before PR.

## Assumptions and Dependencies

### Assumptions

1. Story 3.3a shared envelope builders remain the runtime construction API.
2. `workflow.start` foreground success is an acknowledgement envelope, not a terminal status report, even when `executeWorkflow` has already returned.
3. `workflow get --json` legacy raw shape is not a versioned external contract; current search found docs/tests only.
4. CLI stdout is the controller parse surface; stderr should still avoid contract-relevant prose in JSON subprocess tests.

### Dependencies

1. Accepted `projectBindingRef` lookup rule for registered bindings.
2. Accepted behavior for `--verbose --json` status.
3. Existing `WorkflowRunStatus`, `TERMINAL_WORKFLOW_STATUSES`, and `isApprovalContext` remain the workflow status authority.
4. Package test script must isolate any new mocked test file.

### Risks to Plan

- Risk: status `phase` source is not explicit in the `WorkflowRun` row.
  Impact: fixture mismatch or invented phase values.
  Contingency: define fallback/classification in UNIT-025 before implementation acceptance.

- Risk: hard process timeout/signal envelope is not defined.
  Impact: supervised controller may wait without a parseable terminal result.
  Contingency: W-3.3B-002 and future timeout/cancellation contract story.

## Interworking & Regression

| Component                               | Impact                                                            | Regression scope                                                       |
| --------------------------------------- | ----------------------------------------------------------------- | ---------------------------------------------------------------------- |
| `packages/cli/src/commands/workflow.ts` | Primary start/status producer changes.                            | New command-unit tests and existing workflow command tests.            |
| `packages/cli/src/cli.ts`               | Must pass `--correlation-id` and route JSON prevalidation safely. | CLI subprocess malformed-argv tests.                                   |
| `workflow-provider-command-envelope.ts` | Shared envelope builders reused.                                  | Existing 3.3a helper tests plus no duplicate manual builder logic.     |
| Workflow Commander contract package     | Source of truth for schema and fixtures.                          | `validate_contracts.py`, fixture diff tests, immutable fixture review. |
| Provider-binding tests                  | Pattern source and shared helper regression.                      | Existing provider-binding unit/contract/e2e tests must stay green.     |
| Docs/CLI reference                      | Old `workflow get --json` examples may need wording updates.      | STATIC-049 search and docs update if needed.                           |

## Follow-On Workflows

- Run `bmad-testarch-atdd` if failing P0 tests should be scaffolded before implementation.
- Run `bmad-testarch-nfr` after implementation evidence exists.
- Run `bmad-testarch-trace` after tests are implemented to produce final gate traceability.

## Appendix

### Knowledge References

- `risk-governance.md`
- `probability-impact.md`
- `test-levels-framework.md`
- `test-priorities-matrix.md`
- `nfr-criteria.md`
- `contract-testing.md`
- API-only Playwright Utils profile loaded for workflow compliance but not selected as project tooling.

### Related Documents

- Story: `_bmad-output/implementation-artifacts/3-3b-provide-archon-start-and-status-cli-json.md`
- PRD: `_bmad-output/planning-artifacts/prd.md`
- Architecture: `_bmad-output/planning-artifacts/architecture.md`
- Epics: `_bmad-output/planning-artifacts/epics.md`
- Contract package: `_bmad-output/planning-artifacts/contracts/workflow-commander/`
