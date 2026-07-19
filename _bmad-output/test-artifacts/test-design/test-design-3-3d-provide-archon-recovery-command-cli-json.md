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
lastSaved: '2026-07-19'
mode: 'epic-level'
epic: '3'
story: '3.3d'
status: 'draft'
inputDocuments:
  - '_bmad-output/implementation-artifacts/3-3d-provide-archon-recovery-command-cli-json.md'
  - '_bmad-output/project-context.md'
  - '_bmad/tea/config.yaml'
  - '_bmad-output/planning-artifacts/prd.md'
  - '_bmad-output/planning-artifacts/architecture.md'
  - '_bmad-output/planning-artifacts/epics.md'
  - '_bmad-output/planning-artifacts/contracts/workflow-commander/schemas/workflow-command-envelope.schema.json'
  - '_bmad-output/planning-artifacts/contracts/workflow-commander/examples/providers/archon/commands/resume-success.json'
  - '_bmad-output/planning-artifacts/contracts/workflow-commander/examples/providers/archon/commands/retry-success.json'
  - '_bmad-output/planning-artifacts/contracts/workflow-commander/examples/providers/archon/commands/cancel-success.json'
  - '_bmad-output/planning-artifacts/contracts/workflow-commander/examples/providers/archon/commands/error-malformed-request.json'
  - '_bmad-output/planning-artifacts/contracts/workflow-commander/examples/providers/archon/commands/error-unexpected-state.json'
  - '_bmad-output/planning-artifacts/contracts/workflow-commander/examples/providers/archon/commands/error-timeout.json'
  - '_bmad-output/planning-artifacts/contracts/workflow-commander/examples/providers/archon/commands/error-unexpected-exit.json'
  - '_bmad-output/implementation-artifacts/3-3a-define-shared-workflow-provider-command-envelope.md'
  - '_bmad-output/implementation-artifacts/3-3b-provide-archon-start-and-status-cli-json.md'
  - '_bmad-output/implementation-artifacts/3-3c-provide-archon-provider-decision-command-cli-json.md'
  - '_bmad-output/implementation-artifacts/epic-3-partial-retro-2026-07-16.md'
  - '_bmad-output/implementation-artifacts/deferred-work.md'
  - 'packages/cli/src/commands/workflow.ts'
  - 'packages/cli/src/cli.ts'
  - 'packages/cli/src/commands/workflow-provider-command-envelope.ts'
  - 'packages/cli/src/commands/workflow.test.ts'
  - 'packages/cli/src/commands/workflow-json.e2e.test.ts'
  - 'packages/cli/src/commands/workflow-command-contract.test.ts'
  - 'packages/cli/src/commands/workflow-provider-command-envelope.test.ts'
  - 'packages/core/src/operations/workflow-operations.ts'
  - 'packages/core/src/operations/workflow-retry.ts'
  - 'packages/workflows/src/schemas/workflow-run.ts'
  - 'packages/cli/package.json'
  - '.agents/skills/bmad-testarch-test-design/resources/knowledge/risk-governance.md'
  - '.agents/skills/bmad-testarch-test-design/resources/knowledge/probability-impact.md'
  - '.agents/skills/bmad-testarch-test-design/resources/knowledge/test-levels-framework.md'
  - '.agents/skills/bmad-testarch-test-design/resources/knowledge/test-priorities-matrix.md'
  - '.agents/skills/bmad-testarch-test-design/resources/knowledge/nfr-criteria.md'
  - '.agents/skills/bmad-testarch-test-design/resources/knowledge/contract-testing.md'
  - '.agents/skills/bmad-testarch-test-design/resources/knowledge/error-handling.md'
---

# Test Design: Epic 3 - Story 3.3d Provide Archon Recovery Command CLI JSON

**Date:** 2026-07-19
**Author:** kevin
**Status:** Draft

## Executive Summary

**Scope:** Epic-level test design for Story 3.3d, covering `archon workflow resume --json`, `archon workflow retry [--node] --json`, and `archon workflow cancel --json` as machine-readable recovery command surfaces for external controllers.

This plan contains 85 atomic scenarios: 61 P0, 19 P1, and 5 P2.
Every acceptance criterion, high-risk item, and known reviewer concern maps to a scenario or an explicit waiver.

**Risk summary:**

- 22 risks identified.
- 19 high-priority risks with score >= 6.
- Critical categories: BUS/controller contract, DATA state transition integrity, TECH classifier and dispatch compatibility, SEC output redaction, OPS cross-process stdout and concurrency boundaries.

**Effort summary:**

- P0 scenarios and command harness changes: ~52-88 hours.
- P1 classifier, dependency, regression, and CI coverage: ~24-42 hours.
- P2 documentation and explicit waivers: ~6-12 hours.
- Total: ~82-142 hours, approximately 2.5-4.5 calendar weeks for one implementer depending on fixture reuse and whether node-retry preparation mocks need splitting.

## Not in Scope

| Item                                          | Reasoning                                                                                                                          | Mitigation                                                                                             |
| --------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Legacy `workflow abandon` envelope conversion | Story 3.3a states `workflow.cancel` is the Workflow Commander command and legacy `abandon` must not be serialized as that command. | New `workflowCancelCommand` is covered; legacy behavior stays under regression tests and waiver W-009. |
| Legacy `workflow retry-node` JSON conversion  | `retry-node` streams execution output and rejects `--json`; provider command is the new `workflow retry`.                          | New `workflowRetryCommand` is covered; legacy behavior stays under regression tests and waiver W-010.  |
| HTTP or Web UI recovery controls              | PRD FR-8 explicitly defines a CLI JSON producer surface and no state-changing HTTP control path for Workflow Commander v1.         | Waiver W-008; route tests are not added.                                                               |
| Workflow event outbox ordering and redelivery | Story 3.5 owns event delivery state, retry state, and outbox behavior.                                                             | Waiver W-003; this plan covers command response ordering and duplicate action races only.              |
| Pact broker publishing                        | Contracts are in-repo JSON schema examples, not a multi-service Pact broker lane.                                                  | Use `validate_contracts.py` and `workflow-command-contract.test.ts`.                                   |
| Latency/load SLOs for local recovery commands | No accepted performance threshold exists for local CLI recovery acknowledgements.                                                  | Waiver W-006; add performance gates only after an SLO is accepted.                                     |

## Risk Assessment

Probability and Impact use 1-3.
Score = Probability x Impact.
Score >= 6 requires mitigation.
Priority is promoted to P0/P1 whenever failure can break core behavior, security, data integrity, compatibility, or a cross-process contract.

| ID    | Category  | Risk and evidence                                                                                                                                                                    |   P |   I | Score | Pri | Mitigation / verification                                                                                                   | Owner / timeline                                  | Residual risk                                                                                   |
| ----- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --: | --: | ----: | --- | --------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| R-001 | BUS/TECH  | `workflow.resume --json` stays on legacy `{ ok: true }` shape or emits schema-invalid envelope. Evidence: current JSON branch uses `JSON.stringify({ ok: true, action: 'resume' })`. |   3 |   3 |     9 | P0  | Resume success/error unit tests and contract validation.                                                                    | CLI implementer / Slice 1                         | `result` is schema-flexible, so semantic assertions must supplement schema checks.              |
| R-002 | BUS/TECH  | `workflow.cancel` is missing or serializes as legacy `abandon`, breaking provider command compatibility.                                                                             |   3 |   3 |     9 | P0  | New command unit/E2E tests plus forbidden `abandon` substring scan.                                                         | CLI implementer / Slice 2                         | Legacy `abandon` remains a separate command and can confuse manual users.                       |
| R-003 | BUS/OPS   | `workflow.retry` reuses streaming `retry-node` or executes inline, corrupting stdout and controller parsing.                                                                         |   3 |   3 |     9 | P0  | New retry command tests assert validation/preparation ack and no DAG execution stream.                                      | CLI implementer / Slice 3                         | Node-targeted retry preparation is intentionally mutating before execution.                     |
| R-004 | BUS/TECH  | JSON mode errors escape to plain-text catch instead of a shared failure envelope.                                                                                                    |   3 |   3 |     9 | P0  | Fail-closed unit tests for operation, readback, resolver, timeout, non-Error, and classifier throws.                        | CLI implementer / Slices 1-5                      | Process crash before handler entry can still bypass envelope output.                            |
| R-005 | BUS/OPS   | JSON mode emits multiple stdout lines, human text, stderr diagnostics, or Pino logs.                                                                                                 |   3 |   3 |     9 | P0  | Unit console spies and real subprocess tests assert exactly one stdout line and empty stderr.                               | CLI dispatcher owner / Slices 1-4                 | Fatal runtime loader errors before log silencing remain outside command code.                   |
| R-006 | BUS/TECH  | Pre-handler malformed argv bypasses envelope generation for resume/cancel/retry.                                                                                                     |   3 |   3 |     9 | P0  | E2E subprocess cases for missing run ID, blank correlation ID, `--json=true`, bad cwd, non-git cwd, and malformed `--node`. | CLI dispatcher owner / Slice 4                    | `parseArgs` value consumption remains partly constrained by the Node parser.                    |
| R-007 | DATA/BUS  | Invalid run states mutate or report success for resume/cancel/retry.                                                                                                                 |   2 |   3 |     6 | P0  | Status-matrix tests prove invalid states emit `UNEXPECTED_STATE` and no unsupported mutation.                               | CLI/core owner / Slices 1-3                       | Mutation assertions depend on mocked operation boundaries except DB CAS tests.                  |
| R-008 | DATA/TECH | Whole-run retry semantics are implemented via resume validation, excluding `cancelled` or misrepresenting completed work preservation.                                               |   2 |   3 |     6 | P0  | Whole-run retry tests validate `failed` and `cancelled`, reject `running` and `paused`, and assert no inline execution.     | CLI implementer / Slice 3                         | Actual retry execution remains consumer-driven after ack.                                       |
| R-009 | DATA/TECH | Node retry ack fails to create/report the pre-created run or starts DAG execution inline.                                                                                            |   2 |   3 |     6 | P0  | `prepareWorkflowNodeRetry` success tests assert new `workflowRunRef`, `retryEpoch`, `nodeId`, and no execution stream.      | CLI/core owner / Slice 3                          | Preparation commits state before envelope emission; retries can see CAS miss after lost stdout. |
| R-010 | TECH/BUS  | `WorkflowRetryError` classification uses substring order instead of typed code, causing wrong error codes.                                                                           |   2 |   3 |     6 | P1  | `instanceof WorkflowRetryError` matrix tests before generic not-found matching.                                             | CLI implementer / Slice 5                         | Cross-realm `instanceof` failure is unlikely in this in-process CLI test setup.                 |
| R-011 | DATA/BUS  | Cancel CAS race reports success when `cancelWorkflowRun` was a no-op and persisted status is not `cancelled`.                                                                        |   2 |   3 |     6 | P0  | Post-cancel readback test where final status is `completed` emits `UNEXPECTED_STATE`, not success.                          | CLI/core owner / Slice 2                          | Real cross-process timing is approximated unless a heavier DB race test is accepted.            |
| R-012 | DATA/OPS  | `prepareWorkflowNodeRetry` partial failure leaves original run claimed, metadata corrupted, or retry run half-created.                                                               |   2 |   3 |     6 | P1  | Core operation tests cover rollback via `restoreFailedAfterRetrySetupError`; CLI maps typed errors.                         | Core owner / Slice 3 and regression               | Some filesystem failures are mocked rather than exercised against real git refs.                |
| R-013 | DATA/BUS  | Post-validation or post-mutation readback failure creates ambiguous controller retry behavior.                                                                                       |   2 |   3 |     6 | P1  | Resume/cancel readback failure tests emit `INTERNAL_ERROR`/70 and avoid success.                                            | CLI implementer / Slices 1-2                      | Cancel may have committed; controller retry will see already-cancelled unexpected state.        |
| R-014 | SEC/BUS   | Envelopes leak raw operation errors, stack traces, stdout/stderr, user content, paths, or forbidden actor/profile fields.                                                            |   2 |   3 |     6 | P0  | Recursive forbidden-key tests and `error.details` assertions across success/error envelopes.                                | CLI + security reviewer / Contract tests          | Logs may contain redacted internal context; stdout is the release contract.                     |
| R-015 | BUS/TECH  | `correlationId` or `issuedAt` is not threaded, is blank, or resolves outside fail-closed try/catch.                                                                                  |   2 |   3 |     6 | P1  | Unit and E2E echo tests; injected resolver failure converts to envelope.                                                    | CLI dispatcher owner / Slices 1-4                 | Generated UUID content is shape-checked, not deterministic.                                     |
| R-016 | BUS/TECH  | Fixture deltas are "fixed" by fabricating BMAD/Hermes execution-phase fields like `previousAttempt`, `currentAttempt`, or `state: running`.                                          |   2 |   2 |     4 | P1  | Contract and semantic tests assert Archon ack-phase fields; waiver W-002 documents fixture delta.                           | Contract owner / Slice 6                          | Future consumer may request richer generic attempt metadata.                                    |
| R-017 | BUS/TECH  | Non-JSON resume, legacy abandon, retry-node, or prior start/status/approve/reject JSON behavior regresses.                                                                           |   2 |   3 |     6 | P1  | Existing regression tests plus focused non-JSON tests and shared builder tests.                                             | CLI implementer / Slice 6                         | Existing tests may not assert exact byte-for-byte human output.                                 |
| R-018 | OPS/TECH  | Bun `mock.module()` pollution produces false green/red results after adding mocks for retry preparation.                                                                             |   3 |   2 |     6 | P1  | Keep tests inside existing package-isolated invocations; split if new mock conflicts appear.                                | Test owner / Slice 6                              | Package script may need one more isolated invocation if retry mocks collide.                    |
| R-019 | TECH/OPS  | Dependency failures from workflow discovery, codebase lookup, checkpoint fetch, git reset, or path-in-use are misclassified.                                                         |   2 |   3 |     6 | P1  | Unit tests for every `WorkflowRetryError` code and dependency error branch.                                                 | CLI/core owner / Slices 3,5                       | Real filesystem/git failures are partly simulated.                                              |
| R-020 | OPS/BUS   | Timeout, unexpected exit, or schema-invalid JSON is not represented with retryability and execution metadata.                                                                        |   2 |   3 |     6 | P1  | Timeout injection, contract validator, and malformed-envelope guard tests.                                                  | CLI implementer / Slices 1-6                      | Schema-invalid JSON from `safeStringify` failure is hard to induce without monkey-patching.     |
| R-021 | SEC/OPS   | Permission/auth expectations are overbuilt into local CLI or credentials appear in envelopes.                                                                                        |   1 |   3 |     3 | P2  | Waiver W-004; forbidden-key and secret scans cover output.                                                                  | Product/security owner / before remote auth scope | Remote multi-user invocations may need an accepted auth story.                                  |
| R-022 | PERF/OPS  | Recovery commands become slow enough to hurt controller UX, but no latency threshold exists.                                                                                         |   1 |   2 |     2 | P3  | Waiver W-006; measure only if SLO is accepted.                                                                              | Product owner / future                            | Slow dependency lookup may still be noticed by users.                                           |

## Reviewer-Evidence Disposition

Known reviewer and retro-gate concerns are treated as evidence.
Each concern is either a risk with scenarios or an explicit non-risk/waiver.

| Concern                                                                                                     | Disposition                                                  |   P |   I | Score | Scenario or waiver                                         |
| ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ | --: | --: | ----: | ---------------------------------------------------------- |
| RC-01 Resume JSON legacy shape must become `workflow.resume` envelope.                                      | Risk R-001.                                                  |   3 |   3 |     9 | 3.3D-UNIT-001, 3.3D-UNIT-002, 3.3D-CONTRACT-001            |
| RC-02 Resume JSON must remain a non-blocking ack and not execute workflow inline.                           | Risk R-003/R-005.                                            |   3 |   3 |     9 | 3.3D-UNIT-008, 3.3D-E2E-019                                |
| RC-03 Resume non-resumable states must be `UNEXPECTED_STATE` and no mutation.                               | Risk R-007.                                                  |   2 |   3 |     6 | 3.3D-UNIT-003, 3.3D-UNIT-004                               |
| RC-04 Resume post-validation readback can fail.                                                             | Risk R-013.                                                  |   2 |   3 |     6 | 3.3D-UNIT-006                                              |
| RC-05 Cancel must be a new command, not legacy `abandon`.                                                   | Risk R-002.                                                  |   3 |   3 |     9 | 3.3D-UNIT-009, 3.3D-CONTRACT-004, W-009                    |
| RC-06 Cancel envelope must never contain `abandon`.                                                         | Risk R-002/R-014.                                            |   3 |   3 |     9 | 3.3D-UNIT-016, 3.3D-CONTRACT-004                           |
| RC-07 Cancel terminal states must fail without unsupported transition.                                      | Risk R-007.                                                  |   2 |   3 |     6 | 3.3D-UNIT-012, 3.3D-UNIT-013                               |
| RC-08 Cancel CAS race must not report success if persisted state is not `cancelled`.                        | Risk R-011.                                                  |   2 |   3 |     6 | 3.3D-UNIT-017                                              |
| RC-09 Retry must be a new command, not `retry-node`.                                                        | Risk R-003.                                                  |   3 |   3 |     9 | 3.3D-UNIT-018, 3.3D-UNIT-061, W-010                        |
| RC-10 Whole-run retry must check `RETRYABLE_WORKFLOW_STATUSES`, not call resume validation.                 | Risk R-008.                                                  |   2 |   3 |     6 | 3.3D-UNIT-018, 3.3D-UNIT-019, 3.3D-UNIT-020, 3.3D-UNIT-021 |
| RC-11 Whole-run retry is an ack and must not fabricate attempt counters.                                    | Risk R-016.                                                  |   2 |   2 |     4 | 3.3D-CONTRACT-006, W-002                                   |
| RC-12 Node retry is a mutating ack using `prepareWorkflowNodeRetry`.                                        | Risk R-009/R-012.                                            |   2 |   3 |     6 | 3.3D-UNIT-022, 3.3D-INT-001                                |
| RC-13 Node retry success must identify requested node and new workflow run.                                 | Risk R-009.                                                  |   2 |   3 |     6 | 3.3D-UNIT-022, 3.3D-CONTRACT-003                           |
| RC-14 Unknown or ineligible node must fail machine-readably without starting recovery.                      | Risk R-007/R-010.                                            |   2 |   3 |     6 | 3.3D-UNIT-024, 3.3D-UNIT-025, 3.3D-UNIT-026                |
| RC-15 `WorkflowRetryError` must classify by code before substring matching.                                 | Risk R-010.                                                  |   2 |   3 |     6 | 3.3D-UNIT-035, 3.3D-UNIT-036                               |
| RC-16 All retry error codes must map to stable code/category/retryability/exit code.                        | Risk R-010/R-019.                                            |   2 |   3 |     6 | 3.3D-UNIT-027 through 3.3D-UNIT-034                        |
| RC-17 `Cannot resume run with status` and `Cannot abandon run with status` need narrow classifier patterns. | Risk R-010.                                                  |   2 |   3 |     6 | 3.3D-UNIT-037 through 3.3D-UNIT-040                        |
| RC-18 `Cannot resume` alone and `Cannot abandon` alone must not overmatch.                                  | Risk R-010.                                                  |   2 |   3 |     6 | 3.3D-UNIT-039, 3.3D-UNIT-040                               |
| RC-19 `correlationId` and `issuedAt` resolution must happen inside try/catch.                               | Risk R-015.                                                  |   2 |   3 |     6 | 3.3D-UNIT-041, 3.3D-UNIT-042                               |
| RC-20 Missing run ID for resume/cancel/retry currently prints usage text.                                   | Risk R-006.                                                  |   3 |   3 |     9 | 3.3D-E2E-001, 3.3D-E2E-002, 3.3D-E2E-003                   |
| RC-21 Blank `--correlation-id` must emit `MALFORMED_REQUEST`.                                               | Risk R-006/R-015.                                            |   3 |   3 |     9 | 3.3D-E2E-004, 3.3D-E2E-005, 3.3D-E2E-006                   |
| RC-22 `--json=true` must emit `MALFORMED_REQUEST`.                                                          | Risk R-006.                                                  |   3 |   3 |     9 | 3.3D-E2E-007, 3.3D-E2E-008, 3.3D-E2E-009                   |
| RC-23 Missing cwd and non-git cwd guards must cover all three recovery commands.                            | Risk R-006.                                                  |   3 |   3 |     9 | 3.3D-E2E-010 through 3.3D-E2E-015                          |
| RC-24 `--node --json` can consume `--json` as a node value.                                                 | Risk R-006.                                                  |   3 |   3 |     9 | 3.3D-E2E-016, 3.3D-UNIT-043                                |
| RC-25 Empty `--node ""` should be explicit and deterministic.                                               | Risk R-006/R-008.                                            |   2 |   3 |     6 | 3.3D-UNIT-044                                              |
| RC-26 JSON mode must write exactly one JSON line and no human text.                                         | Risk R-005.                                                  |   3 |   3 |     9 | 3.3D-UNIT-045, 3.3D-E2E-019                                |
| RC-27 Pino/log output can corrupt stdout.                                                                   | Risk R-005.                                                  |   3 |   3 |     9 | 3.3D-E2E-019                                               |
| RC-28 Raw errors must not leak in `details`.                                                                | Risk R-014.                                                  |   2 |   3 |     6 | 3.3D-UNIT-046, 3.3D-CONTRACT-005                           |
| RC-29 Forbidden keys must not appear in envelopes.                                                          | Risk R-014.                                                  |   2 |   3 |     6 | 3.3D-CONTRACT-005                                          |
| RC-30 Short-id ambiguity should be malformed request, not internal error.                                   | Risk R-006/R-010.                                            |   2 |   3 |     6 | 3.3D-UNIT-047                                              |
| RC-31 Run-not-found must be `WORKFLOW_RUN_NOT_FOUND`.                                                       | Risk R-010.                                                  |   2 |   3 |     6 | 3.3D-UNIT-005, 3.3D-UNIT-014, 3.3D-UNIT-033                |
| RC-32 Timeout must be `COMMAND_TIMEOUT` and retryable.                                                      | Risk R-020.                                                  |   2 |   3 |     6 | 3.3D-UNIT-007, 3.3D-UNIT-048                               |
| RC-33 Unexpected exit/schema-invalid output must be fail-closed.                                            | Risk R-004/R-020.                                            |   2 |   3 |     6 | 3.3D-CONTRACT-007, 3.3D-CI-001                             |
| RC-34 Duplicate cancels/resumes/retries must not both report success.                                       | Risk R-007/R-011.                                            |   2 |   3 |     6 | 3.3D-UNIT-017, 3.3D-UNIT-028, 3.3D-INT-002                 |
| RC-35 Cancel plus resume race must resolve to one successful transition and one unexpected state.           | Risk R-007/R-011.                                            |   2 |   3 |     6 | 3.3D-INT-002                                               |
| RC-36 Node retry plus concurrent retry must classify CAS miss as retryable.                                 | Risk R-010/R-012.                                            |   2 |   3 |     6 | 3.3D-UNIT-028, 3.3D-INT-001                                |
| RC-37 `prepareWorkflowNodeRetry` partial failure must roll back original run state.                         | Risk R-012.                                                  |   2 |   3 |     6 | 3.3D-INT-001, 3.3D-UNIT-030, 3.3D-UNIT-031                 |
| RC-38 Workflow discovery/codebase lookup failures must not leak raw diagnostic text.                        | Risk R-014/R-019.                                            |   2 |   3 |     6 | 3.3D-UNIT-049, 3.3D-UNIT-046                               |
| RC-39 Contract fixture deltas for resume/retry must be documented, not fabricated.                          | Risk R-016.                                                  |   2 |   2 |     4 | 3.3D-CONTRACT-006, W-002                                   |
| RC-40 `printJsonWriteError` should be retained while legacy abandon uses it.                                | Explicit non-risk with scope rationale.                      |   1 |   2 |     2 | W-011                                                      |
| RC-41 Non-JSON resume behavior must stay byte-for-byte compatible.                                          | Risk R-017.                                                  |   2 |   3 |     6 | 3.3D-UNIT-059                                              |
| RC-42 Legacy abandon behavior must stay unchanged.                                                          | Risk R-017.                                                  |   2 |   3 |     6 | 3.3D-UNIT-060, W-009                                       |
| RC-43 Legacy retry-node behavior must stay unchanged.                                                       | Risk R-017.                                                  |   2 |   3 |     6 | 3.3D-UNIT-061, W-010                                       |
| RC-44 Start/status/approve/reject JSON must not regress.                                                    | Risk R-017.                                                  |   2 |   3 |     6 | 3.3D-CI-002, 3.3D-CI-003                                   |
| RC-45 Test additions must respect Bun mock isolation.                                                       | Risk R-018.                                                  |   3 |   2 |     6 | 3.3D-CI-004                                                |
| RC-46 No state-changing HTTP route is planned.                                                              | Explicit non-risk for this CLI-only story.                   |   1 |   2 |     2 | W-008                                                      |
| RC-47 Event outbox and out-of-order event delivery are not consumed by these commands.                      | Explicit non-risk for command response contract.             |   1 |   3 |     3 | W-003                                                      |
| RC-48 Permission/auth is local CLI trust boundary for this story.                                           | Explicit non-risk with security output coverage.             |   1 |   3 |     3 | W-004, 3.3D-CONTRACT-005                                   |
| RC-49 External process cancellation is outside command response semantics.                                  | Explicit non-risk; workflow cancellation itself is in scope. |   1 |   2 |     2 | W-005                                                      |
| RC-50 Performance threshold is unknown.                                                                     | Low risk with missing NFR threshold.                         |   1 |   2 |     2 | W-006                                                      |

## NFR Planning

**Purpose:** Plan NFR validation for Story 3.3d.
This is not a final NFR evidence audit.

| NFR category    | Requirement / threshold                                                                                                                       | Risk link                         | Planned validation                                                                    | Evidence needed                                                                                               |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------- | ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Security        | No raw stack traces, secrets, stdout, stderr, actor/profile fields, or user content in command envelopes.                                     | R-014, R-021                      | Recursive forbidden-key scan and error-details assertions on success/error envelopes. | `workflow-command-contract.test.ts` output and focused unit tests.                                            |
| Reliability     | JSON mode emits exactly one parseable stdout line for every success/failure path and does not execute streaming workflow code inline.         | R-003, R-004, R-005               | Unit console spies plus real subprocess E2E tests.                                    | `workflow.test.ts` and `workflow-json.e2e.test.ts` results.                                                   |
| Data integrity  | Invalid states do not mutate runs; cancel and node retry CAS races are represented honestly.                                                  | R-007, R-009, R-011, R-012        | Status-matrix unit tests, CAS-result simulations, and core operation rollback tests.  | CLI unit results plus `packages/core/src/operations/workflow-retry.test.ts` and DB CAS tests where practical. |
| Compatibility   | Envelope schema version and command identifiers match `workflow-command-envelope.schema.json`; legacy non-provider commands remain unchanged. | R-001, R-002, R-003, R-016, R-017 | Contract validator, emitted-envelope schema checks, prior-command regression tests.   | `validate_contracts.py`, `workflow-command-contract.test.ts`, `workflow-provider-command-envelope.test.ts`.   |
| Maintainability | Tests run under package-isolated Bun invocations and preserve strict TypeScript/lint expectations.                                            | R-018                             | Verify package script placement and run focused type check before full validate.      | `packages/cli/package.json`, `bun --filter @archon/cli type-check`, `bun run validate`.                       |
| Performance     | Local CLI recovery command latency threshold is UNKNOWN.                                                                                      | R-022                             | No automated perf gate until SLO exists.                                              | Waiver W-006.                                                                                                 |

**Unknown thresholds:** command latency, maximum retry preparation duration, maximum subprocess timeout, and acceptable cross-process race coverage depth are UNKNOWN.
They are either covered by functional fail-closed tests or recorded as waivers below.

## Entry Criteria

- Story 3.3d acceptance criteria remain unchanged and implementation scope is CLI JSON only.
- Shared envelope builder from Story 3.3a is available and unchanged except through approved regression.
- Existing 3.3b and 3.3c command tests are green or failures are understood before adding 3.3d assertions.
- Test data factories or mock run records can represent `failed`, `paused`, `running`, `completed`, and `cancelled`.
- Retry preparation can be mocked without polluting unrelated test invocations, or the package script is split.

## Exit Criteria

- All P0 scenarios pass.
- P1 pass rate >= 95%, with explicit waivers for any remaining failure.
- No open high-priority risks without mitigation or accepted waiver.
- Every recovery command success and failure envelope validates against the shared schema where schema validation is applicable.
- JSON subprocess tests prove exactly one stdout line and no stderr for malformed pre-handler recovery-command paths.
- `bun --filter @archon/cli type-check` and the focused CLI test invocations pass before `bun run validate`.
- Full NFR evidence decisions are deferred to `nfr-assess` after implementation evidence exists.

## Test Coverage Plan

Priority is risk/criticality, not execution timing.
Execution timing is defined separately below.

### P0 Scenarios

| Test ID           | Requirement / risk | Level          | Atomic scenario                                                                                                                                                                                                                              | Owner        | Notes                                               |
| ----------------- | ------------------ | -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------ | --------------------------------------------------- |
| 3.3D-UNIT-001     | AC1, R-001         | Unit           | `workflowResumeCommand --json` succeeds from `failed` and emits `workflow.resume`, `success: true`, `workflowRunRef`, `result.operation: 'resume'`, `previousState: 'failed'`, current `state: 'failed'`, `resumed: true`, `terminal: true`. | Dev          | Ack reports current DB state, not inline execution. |
| 3.3D-UNIT-002     | AC1, R-001         | Unit           | Resume succeeds from `paused` and emits same shape with `previousState: 'paused'`, current `state: 'paused'`, `resumed: true`, `terminal: false`.                                                                                            | Dev          | Happy path boundary.                                |
| 3.3D-UNIT-003     | AC1/5, R-007       | Unit           | Resume from `completed` emits `UNEXPECTED_STATE`/`unexpected_state`/78 and does not call execution.                                                                                                                                          | Dev          | Invalid terminal state.                             |
| 3.3D-UNIT-004     | AC1/5, R-007       | Unit           | Resume from `cancelled` emits `UNEXPECTED_STATE`/78 and no mutation.                                                                                                                                                                         | Dev          | Invalid terminal state.                             |
| 3.3D-UNIT-005     | AC1/5, R-010       | Unit           | Resume run not found emits `WORKFLOW_RUN_NOT_FOUND`/`unexpected_state`/78.                                                                                                                                                                   | Dev          | Boundary ID lookup.                                 |
| 3.3D-UNIT-006     | AC1/5, R-013       | Unit           | Resume validation succeeds but post-validation `getWorkflowRun` throws or returns null; output is `INTERNAL_ERROR`/`implementation_defect`/70.                                                                                               | Dev          | Partial readback failure.                           |
| 3.3D-UNIT-007     | AC5, R-020         | Unit           | Resume DB timeout emits `COMMAND_TIMEOUT`/`timeout`/`retryable: true`/69.                                                                                                                                                                    | Dev          | Timeout path.                                       |
| 3.3D-UNIT-008     | AC1, R-003/R-005   | Unit           | Resume JSON branch does not call `workflowRunCommand`, `executeWorkflow`, or instantiate `CLIAdapter`; stdout spy sees one line.                                                                                                             | Dev          | Prevents stream corruption.                         |
| 3.3D-UNIT-009     | AC4, R-002         | Unit           | `workflowCancelCommand --json` succeeds from `running`, emits `workflow.cancel`, `result.operation: 'cancel'`, `previousState: 'running'`, `state: 'cancelled'`, `terminal: true`.                                                           | Dev          | New command surface.                                |
| 3.3D-UNIT-010     | AC4, R-002         | Unit           | Cancel succeeds from `paused` with `previousState: 'paused'` and terminal cancelled state.                                                                                                                                                   | Dev          | Active paused boundary.                             |
| 3.3D-UNIT-011     | AC4, R-002         | Unit           | Cancel succeeds from `failed` with `previousState: 'failed'` and terminal cancelled state.                                                                                                                                                   | Dev          | Failed-run cancellation.                            |
| 3.3D-UNIT-012     | AC4/5, R-007       | Unit           | Cancel from `completed` emits `UNEXPECTED_STATE`/78.                                                                                                                                                                                         | Dev          | Terminal state.                                     |
| 3.3D-UNIT-013     | AC4/5, R-007       | Unit           | Cancel from already `cancelled` emits `UNEXPECTED_STATE`/78.                                                                                                                                                                                 | Dev          | Duplicate action.                                   |
| 3.3D-UNIT-014     | AC4/5, R-010       | Unit           | Cancel run not found emits `WORKFLOW_RUN_NOT_FOUND`/78.                                                                                                                                                                                      | Dev          | Boundary ID lookup.                                 |
| 3.3D-UNIT-015     | AC4/5, R-013       | Unit           | Cancel CAS succeeds but post-cancel readback throws or returns null; output is `INTERNAL_ERROR`/70, not success.                                                                                                                             | Dev          | Partial failure after mutation.                     |
| 3.3D-UNIT-016     | AC4, R-002/R-014   | Unit           | Every cancel success/error envelope stringifies without the substring `abandon`.                                                                                                                                                             | Dev/Security | Compatibility and forbidden vocabulary.             |
| 3.3D-UNIT-017     | AC4/5, R-011       | Unit           | Cancel operation returns but persisted status is `completed` or `running`; command emits `UNEXPECTED_STATE`, not success.                                                                                                                    | Dev          | CAS race/no-op boundary.                            |
| 3.3D-UNIT-018     | AC2, R-008         | Unit           | `workflowRetryCommand --json` whole-run succeeds from `failed`, emits `workflow.retry`, `mode: 'whole-run'`, `state: 'failed'`, `retryable: true`, no mutation.                                                                              | Dev          | Happy path.                                         |
| 3.3D-UNIT-019     | AC2, R-008         | Unit           | Whole-run retry succeeds from `cancelled` with `state: 'cancelled'`, `retryable: true`.                                                                                                                                                      | Dev          | Status boundary distinct from resume.               |
| 3.3D-UNIT-020     | AC2/5, R-008       | Unit           | Whole-run retry from `running` emits `UNEXPECTED_STATE`/78 and no mutation.                                                                                                                                                                  | Dev          | Invalid active state.                               |
| 3.3D-UNIT-021     | AC2/5, R-008       | Unit           | Whole-run retry from `paused` emits `UNEXPECTED_STATE`/78 and no mutation.                                                                                                                                                                   | Dev          | Explicitly not resume semantics.                    |
| 3.3D-UNIT-022     | AC3, R-009         | Unit           | Node retry succeeds from failed run, calls `prepareWorkflowNodeRetry`, emits new pre-created run in `workflowRunRef`, `mode: 'node'`, requested `nodeId`, `retryEpoch`, `state: 'running'`, and no DAG execution.                            | Dev          | Mutating ack happy path.                            |
| 3.3D-UNIT-023     | AC3, R-009         | Unit           | Node retry succeeds for cancelled run whose target node latest state was `running` and reports new pre-created run.                                                                                                                          | Dev/Core     | Cancelled interrupted-node boundary.                |
| 3.3D-UNIT-024     | AC3/5, R-010       | Unit           | `WorkflowRetryError('node_not_found')` emits `NODE_NOT_FOUND`/`unexpected_state`/78.                                                                                                                                                         | Dev          | Unknown node.                                       |
| 3.3D-UNIT-025     | AC3/5, R-010       | Unit           | `WorkflowRetryError('node_not_failed')` emits `UNEXPECTED_STATE`/78 and no recovery start.                                                                                                                                                   | Dev          | Ineligible node status.                             |
| 3.3D-UNIT-026     | AC3/5, R-010       | Unit           | `WorkflowRetryError('node_not_retryable')` emits `NODE_NOT_RETRYABLE`/78.                                                                                                                                                                    | Dev          | Route-loop/non-retryable target.                    |
| 3.3D-UNIT-027     | AC3/5, R-010       | Unit           | `WorkflowRetryError('run_not_retryable')` emits `UNEXPECTED_STATE`/78.                                                                                                                                                                       | Dev          | Typed run state.                                    |
| 3.3D-UNIT-028     | AC3/5, R-010/R-012 | Unit           | `WorkflowRetryError('cas_miss')` emits `UNEXPECTED_STATE`/`retryable: true`/78.                                                                                                                                                              | Dev/Core     | Concurrent retry loser.                             |
| 3.3D-UNIT-029     | AC3/5, R-010/R-019 | Unit           | `WorkflowRetryError('path_in_use')` emits `UNEXPECTED_STATE`/`retryable: false`/78.                                                                                                                                                          | Dev/Core     | Dependency/concurrency failure.                     |
| 3.3D-UNIT-030     | AC3/5, R-010/R-019 | Unit           | `WorkflowRetryError('checkpoint_unavailable')` emits `UNEXPECTED_STATE`/`implementation_defect`/70.                                                                                                                                          | Dev/Core     | Partial/dependency failure.                         |
| 3.3D-UNIT-031     | AC3/5, R-010/R-019 | Unit           | `WorkflowRetryError('git_reset_failed')` emits `INTERNAL_ERROR`/`implementation_defect`/70.                                                                                                                                                  | Dev/Core     | Git reset dependency failure.                       |
| 3.3D-UNIT-032     | AC3/5, R-010/R-019 | Unit           | `WorkflowRetryError('dispatch_failed')` emits `INTERNAL_ERROR`/70.                                                                                                                                                                           | Dev/Core     | Internal dependency failure.                        |
| 3.3D-UNIT-033     | AC3/5, R-010       | Unit           | `WorkflowRetryError('run_not_found')` emits `WORKFLOW_RUN_NOT_FOUND`/78.                                                                                                                                                                     | Dev          | Typed lookup failure.                               |
| 3.3D-UNIT-034     | AC5, R-006         | Unit           | `workflowRetryCommand` rejects node IDs that start with `--` as `MALFORMED_REQUEST` with `/node` field error.                                                                                                                                | Dev          | Malformed input.                                    |
| 3.3D-UNIT-041     | AC5, R-015         | Unit           | Supplied correlation ID is echoed by resume, cancel, and retry success/error envelopes.                                                                                                                                                      | Dev          | Direct command calls.                               |
| 3.3D-UNIT-042     | AC5, R-015         | Unit           | Failure resolving correlation ID or issued timestamp inside JSON path emits one error envelope.                                                                                                                                              | Dev          | RF-09 regression.                                   |
| 3.3D-UNIT-045     | AC5, R-005         | Unit           | Resume/cancel/retry JSON branches each call `console.log` exactly once and never call `console.error`.                                                                                                                                       | Dev          | Cross-process parser guarantee.                     |
| 3.3D-UNIT-046     | AC5, R-014         | Unit           | All recovery error envelopes include only safe machine-readable details and omit raw error message/stack.                                                                                                                                    | Dev/Security | NFR-14.                                             |
| 3.3D-E2E-001      | AC5, R-006         | E2E subprocess | `archon workflow resume --json` without run ID emits one `workflow.resume` `MALFORMED_REQUEST` envelope, exit 64, empty stderr.                                                                                                              | Dev          | Pre-handler failure.                                |
| 3.3D-E2E-002      | AC5, R-006         | E2E subprocess | `archon workflow cancel --json` without run ID emits one `workflow.cancel` `MALFORMED_REQUEST` envelope, exit 64, empty stderr.                                                                                                              | Dev          | Pre-handler failure.                                |
| 3.3D-E2E-003      | AC5, R-006         | E2E subprocess | `archon workflow retry --json` without run ID emits one `workflow.retry` `MALFORMED_REQUEST` envelope, exit 64, empty stderr.                                                                                                                | Dev          | Pre-handler failure.                                |
| 3.3D-E2E-004      | AC5, R-006/R-015   | E2E subprocess | Resume with `--json --correlation-id=` emits `MALFORMED_REQUEST` with `/correlationId` field error.                                                                                                                                          | Dev          | Malformed input.                                    |
| 3.3D-E2E-005      | AC5, R-006/R-015   | E2E subprocess | Cancel with `--json --correlation-id=` emits `MALFORMED_REQUEST` with `/correlationId` field error.                                                                                                                                          | Dev          | Malformed input.                                    |
| 3.3D-E2E-006      | AC5, R-006/R-015   | E2E subprocess | Retry with `--json --correlation-id=` emits `MALFORMED_REQUEST` with `/correlationId` field error.                                                                                                                                           | Dev          | Malformed input.                                    |
| 3.3D-E2E-007      | AC5, R-006         | E2E subprocess | Resume with `--json=true` emits `MALFORMED_REQUEST` with `/json` field error.                                                                                                                                                                | Dev          | Malformed input.                                    |
| 3.3D-E2E-008      | AC5, R-006         | E2E subprocess | Cancel with `--json=true` emits `MALFORMED_REQUEST` with `/json` field error.                                                                                                                                                                | Dev          | Malformed input.                                    |
| 3.3D-E2E-009      | AC5, R-006         | E2E subprocess | Retry with `--json=true` emits `MALFORMED_REQUEST` with `/json` field error.                                                                                                                                                                 | Dev          | Malformed input.                                    |
| 3.3D-E2E-010      | AC5, R-006         | E2E subprocess | Resume with `--json --cwd /nonexistent` emits `MALFORMED_REQUEST` `/cwd=directory_not_found`.                                                                                                                                                | Dev          | Dependency/pre-handler failure.                     |
| 3.3D-E2E-011      | AC5, R-006         | E2E subprocess | Cancel with `--json --cwd /nonexistent` emits `MALFORMED_REQUEST` `/cwd=directory_not_found`.                                                                                                                                                | Dev          | Dependency/pre-handler failure.                     |
| 3.3D-E2E-012      | AC5, R-006         | E2E subprocess | Retry with `--json --cwd /nonexistent` emits `MALFORMED_REQUEST` `/cwd=directory_not_found`.                                                                                                                                                 | Dev          | Dependency/pre-handler failure.                     |
| 3.3D-E2E-013      | AC5, R-006         | E2E subprocess | Resume from non-git cwd emits `MALFORMED_REQUEST` `/cwd=not_a_git_repository`.                                                                                                                                                               | Dev          | Environment guard.                                  |
| 3.3D-E2E-014      | AC5, R-006         | E2E subprocess | Cancel from non-git cwd emits `MALFORMED_REQUEST` `/cwd=not_a_git_repository`.                                                                                                                                                               | Dev          | Environment guard.                                  |
| 3.3D-E2E-015      | AC5, R-006         | E2E subprocess | Retry from non-git cwd emits `MALFORMED_REQUEST` `/cwd=not_a_git_repository`.                                                                                                                                                                | Dev          | Environment guard.                                  |
| 3.3D-E2E-016      | AC5, R-006         | E2E subprocess | `archon workflow retry <run-id> --node --json` emits `MALFORMED_REQUEST` for `/node`, not a node retry request for `"--json"`.                                                                                                               | Dev          | Malformed input boundary.                           |
| 3.3D-E2E-019      | AC5, R-005         | E2E subprocess | Resume/cancel/retry malformed and not-found paths emit exactly one parseable stdout line, no stderr, no Pino or usage prose.                                                                                                                 | Dev          | Log contamination regression.                       |
| 3.3D-CONTRACT-001 | AC1, R-001         | Contract       | Emitted resume success envelope validates against `workflow-command-envelope.schema.json`.                                                                                                                                                   | Dev          | Schema compliance.                                  |
| 3.3D-CONTRACT-002 | AC4, R-002         | Contract       | Emitted cancel success envelope validates against schema.                                                                                                                                                                                    | Dev          | Schema compliance.                                  |
| 3.3D-CONTRACT-003 | AC2/3, R-003/R-009 | Contract       | Emitted retry success envelopes for whole-run and node modes validate against schema.                                                                                                                                                        | Dev          | Schema compliance.                                  |
| 3.3D-CONTRACT-004 | AC4, R-002/R-014   | Contract       | Recursive scan proves cancel envelopes contain no `abandon`, `actor`, `profile`, `agent_name`, `agent`, `agent_provider`, `message`, `stdout`, `stderr`, `displayText`, or `secret`.                                                         | Dev/Security | Compatibility and redaction.                        |
| 3.3D-CONTRACT-005 | AC5, R-014         | Contract       | Recursive forbidden-key and raw diagnostic scan across all recovery success/error envelopes.                                                                                                                                                 | Dev/Security | NFR-14.                                             |
| 3.3D-CONTRACT-007 | AC5, R-020         | Contract       | Recovery malformed, timeout, unexpected-state, and unexpected-exit example/error envelopes validate against schema and preserve `execution.exitCode`, `timedOut`, and redaction fields.                                                      | Dev          | Schema-invalid/unexpected-exit guard.               |

### P1 Scenarios

| Test ID       | Requirement / risk | Level            | Atomic scenario                                                                                                                                                                             | Owner          | Notes                                                                                        |
| ------------- | ------------------ | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------- | -------------------------------------------------------------------------------------------- |
| 3.3D-UNIT-035 | AC5, R-010         | Unit             | Classifier handles `WorkflowRetryError('run_not_found', 'Workflow run not found: ...')` through the typed branch before generic substring matching.                                         | Dev            | Ordering proof.                                                                              |
| 3.3D-UNIT-036 | AC5, R-010         | Unit             | Generic `new Error('Workflow run not found: ...')` still maps to `WORKFLOW_RUN_NOT_FOUND`, proving typed branch does not swallow generic behavior.                                          | Dev            | Regression.                                                                                  |
| 3.3D-UNIT-037 | AC5, R-010         | Unit             | `Cannot resume run with status "completed"` maps to `UNEXPECTED_STATE`/78.                                                                                                                  | Dev            | Narrow positive classifier.                                                                  |
| 3.3D-UNIT-038 | AC5, R-010         | Unit             | `Cannot abandon run with status "completed"` maps to `UNEXPECTED_STATE`/78.                                                                                                                 | Dev            | Narrow positive classifier.                                                                  |
| 3.3D-UNIT-039 | AC5, R-010         | Unit             | `Cannot resume workflow` or `Cannot resume` alone does not match `UNEXPECTED_STATE`.                                                                                                        | Dev            | Overmatch guard.                                                                             |
| 3.3D-UNIT-040 | AC5, R-010         | Unit             | `Cannot abandon` alone does not match `UNEXPECTED_STATE`.                                                                                                                                   | Dev            | Overmatch guard.                                                                             |
| 3.3D-UNIT-043 | AC5, R-006         | Unit             | Direct `workflowRetryCommand` with `nodeId: '--json'` emits `MALFORMED_REQUEST` with safe details.                                                                                          | Dev            | Unit mirror of E2E.                                                                          |
| 3.3D-UNIT-044 | AC2, R-006/R-008   | Unit             | Direct `workflowRetryCommand` with empty `nodeId` treats the request as whole-run retry or emits a documented malformed request; behavior is explicit and tested.                           | Dev            | Boundary value.                                                                              |
| 3.3D-UNIT-047 | AC5, R-006/R-010   | Unit             | Short-id ambiguity from `resolveRunIdArg` emits `MALFORMED_REQUEST`/64.                                                                                                                     | Dev            | Boundary ID lookup.                                                                          |
| 3.3D-UNIT-048 | AC5, R-020         | Unit             | Timeout-like errors (`ETIMEDOUT`, statement timeout, or message timeout) classify as `COMMAND_TIMEOUT`/`retryable: true`/69 for recovery commands.                                          | Dev            | Timeout classifier.                                                                          |
| 3.3D-UNIT-049 | AC5, R-019         | Unit             | `loadWorkflowForRetryCommand` workflow-not-found or codebase lookup failure emits classified envelope without raw path-heavy diagnostic details.                                            | Dev            | Dependency failure.                                                                          |
| 3.3D-UNIT-050 | AC5, R-004         | Unit             | Non-Error throw inside each JSON branch still emits a valid failure envelope.                                                                                                               | Dev            | Fail-closed catch.                                                                           |
| 3.3D-INT-001  | AC3/5, R-012       | Integration/core | Existing `prepareWorkflowNodeRetry` rollback coverage proves setup failure writes audit failure and restores failed state.                                                                  | Core owner     | Use existing or focused core operation tests.                                                |
| 3.3D-INT-002  | AC4/5, R-011       | Integration/DB   | Cancel/resume or duplicate cancel CAS simulation proves only one transition succeeds and loser gets unexpected state.                                                                       | Core/CLI owner | Use DB CAS integration if practical; otherwise unit CAS-result simulation plus waiver W-007. |
| 3.3D-CI-001   | AC5, R-020         | CI/contract      | `python3 _bmad-output/planning-artifacts/contracts/workflow-commander/validate_contracts.py` passes without editing schema or fixtures.                                                     | Dev            | Contract package gate.                                                                       |
| 3.3D-CI-002   | R-017              | CI/unit          | Existing start/status JSON tests in `workflow.test.ts`, `workflow-json.e2e.test.ts`, and `workflow-command-contract.test.ts` pass.                                                          | Dev            | Regression from classifier/dispatch changes.                                                 |
| 3.3D-CI-003   | R-017              | CI/unit          | Existing approve/reject JSON tests pass after recovery classifier additions.                                                                                                                | Dev            | 3.3c regression.                                                                             |
| 3.3D-CI-004   | R-018              | CI/config        | `packages/cli/package.json` keeps `workflow.test.ts`, `workflow-json.e2e.test.ts`, `workflow-command-contract.test.ts`, and envelope tests in isolated Bun invocations or is split further. | Dev/Test       | Mock pollution guard.                                                                        |
| 3.3D-CI-005   | R-017/R-018        | CI/rollback      | `bun --filter @archon/cli type-check`, focused CLI tests, then `bun run validate` pass; no generated contracts or unrelated packages are hand-edited.                                       | Dev            | Rollback/release gate.                                                                       |

### P2 Scenarios

| Test ID           | Requirement / risk | Level         | Atomic scenario                                                                                                                                                 | Owner          | Notes          |
| ----------------- | ------------------ | ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------- | -------------- |
| 3.3D-UNIT-059     | R-017              | Unit          | Non-JSON `workflowResumeCommand` still follows the blocking re-execution flow and preserves existing human text/error behavior.                                 | Dev            | Compatibility. |
| 3.3D-UNIT-060     | R-017              | Unit          | Legacy `workflowAbandonCommand --json` retains legacy `{ ok: true/false, action: 'abandon' }` behavior.                                                         | Dev            | Waiver W-009.  |
| 3.3D-UNIT-061     | R-017              | Unit          | Legacy `workflowRetryNodeCommand --json` still rejects JSON and non-JSON path streams retry execution as before.                                                | Dev            | Waiver W-010.  |
| 3.3D-CONTRACT-006 | R-016              | Contract/docs | Document fixture deltas: resume ack reports current state plus `resumed: true`; retry ack reports `mode`/`retryable`/`retryEpoch` rather than attempt counters. | Contract owner | Waiver W-002.  |
| 3.3D-CI-006       | R-022              | CI/docs       | Record UNKNOWN command latency threshold and avoid adding fake performance pass/fail gates.                                                                     | Product/Test   | Waiver W-006.  |

## Edge-Case Coverage Register

| Edge class requested | Coverage                                                                                                                                                         |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Happy path           | Resume failed/paused, cancel running/paused/failed, retry whole-run failed/cancelled, retry node success: 3.3D-UNIT-001, 002, 009, 010, 011, 018, 019, 022, 023. |
| Negative path        | Non-resumable, non-cancellable, non-retryable, unknown run/node: 3.3D-UNIT-003, 004, 005, 012, 013, 014, 020, 021, 024 through 027, 033.                         |
| Boundary cases       | `paused`, `failed`, `cancelled`, empty/flag-like node, short ID ambiguity: 3.3D-UNIT-002, 004, 010, 011, 019, 023, 034, 044, 047.                                |
| Malformed input      | Missing run ID, blank correlation ID, `--json=true`, cwd errors, malformed `--node`: 3.3D-E2E-001 through 016, 3.3D-UNIT-034, 043.                               |
| Stale data           | Run not found, post-readback null/error, codebase/workflow lookup failure: 3.3D-UNIT-005, 006, 014, 015, 033, 049.                                               |
| Duplicate actions    | Already cancelled, cancel CAS no-op, retry CAS miss: 3.3D-UNIT-013, 017, 028.                                                                                    |
| Out-of-order events  | Command response ordering/race covered by CAS tests; workflow event delivery ordering waived in W-003.                                                           |
| Partial failure      | Resume/cancel readback failures and retry preparation rollback: 3.3D-UNIT-006, 015, 030, 031, 032, 3.3D-INT-001.                                                 |
| Dependency failure   | DB timeout, workflow discovery, codebase lookup, path in use, checkpoint, git reset: 3.3D-UNIT-007, 029, 030, 031, 048, 049.                                     |
| Timeout              | 3.3D-UNIT-007, 048.                                                                                                                                              |
| Cancellation         | Workflow cancel behavior covered by 3.3D-UNIT-009 through 017; external process cancellation waived in W-005.                                                    |
| Concurrency/race     | Cancel CAS race, cancel/resume race, retry CAS miss: 3.3D-UNIT-017, 028, 3.3D-INT-002.                                                                           |
| Rollback             | Retry setup rollback and slice-level validation: 3.3D-INT-001, 3.3D-CI-005.                                                                                      |
| Permission/auth      | Local CLI trust boundary waived in W-004; output credential leakage covered by 3.3D-CONTRACT-005.                                                                |
| Regression           | Legacy non-JSON and prior JSON command families: 3.3D-UNIT-059 through 061, 3.3D-CI-002, 003, 005.                                                               |

## Execution Strategy

Use PR / Nightly / Weekly timing.
Priority remains separate from execution timing.

| Timing              | Scope                                                                                                                                                                        | Rationale                                                                                                                       |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| PR                  | Focused recovery-command unit tests, `workflow-json.e2e.test.ts` recovery cases, command contract tests, `validate_contracts.py`, and `bun --filter @archon/cli type-check`. | This is the external controller boundary; run all functional recovery-command tests in PR unless they exceed practical CI time. |
| Pre-merge / release | `bun run validate`.                                                                                                                                                          | Project-required gate; includes bundled checks, type-check, lint, format check, and package-isolated tests.                     |
| Nightly             | Repeat CLI JSON subprocess tests and any DB-backed race/rollback tests against SQLite and PostgreSQL when PostgreSQL CI is available.                                        | Race and persistence behavior deserve repeated evidence without slowing every local iteration.                                  |
| Weekly / on-demand  | Burn-in retry/cancel race tests if flaky behavior or production telemetry suggests timing sensitivity.                                                                       | Avoid speculative long-running perf/race suites until evidence justifies them.                                                  |

## Resource Estimates

| Priority | Count | Effort range  | Notes                                                                                                                   |
| -------- | ----: | ------------- | ----------------------------------------------------------------------------------------------------------------------- |
| P0       |    61 | ~52-88 hours  | New command unit tests, subprocess JSON purity, contract validation, state/error matrices.                              |
| P1       |    19 | ~24-42 hours  | Classifier specificity, dependency failure, core rollback/CAS coverage, regression gates.                               |
| P2       |     5 | ~6-12 hours   | Compatibility documentation, legacy behavior checks, explicit NFR waivers.                                              |
| Total    |    85 | ~82-142 hours | Approximately 2.5-4.5 calendar weeks for one implementer, less if existing 3.3c harness helpers can be reused directly. |

## Prerequisites

**Test data:**

- Mock workflow run records for all `WorkflowRunStatus` values.
- Mock approval/retry metadata for node retry and interrupted cancelled run states.
- Mock `WorkflowRetryError` instances for every typed code.
- Temporary git repositories for subprocess cwd/non-git/missing-cwd cases.

**Tooling:**

- Bun test runner with package-isolated invocations.
- Existing `workflow-command-envelope.schema.json` and `validate_contracts.py`.
- Existing console spy pattern in `workflow.test.ts`.
- Existing subprocess `runCli()` harness in `workflow-json.e2e.test.ts`.

**Environment:**

- SQLite default path isolated via `ARCHON_HOME` for subprocess tests.
- PostgreSQL optional for nightly DB race validation.
- No root `bun test`; use package scripts or single-file focused tests.

## Quality Gate Criteria

- P0 pass rate: 100%, no exceptions.
- P1 pass rate: >= 95%, with waiver required for any failure.
- P2 pass rate: >= 90% or explicitly accepted as documentation-only.
- High-risk mitigations: 100% complete or approved waivers before release.
- Critical path coverage target: >= 80% with 100% coverage for schema contract, fail-closed error envelope, and no raw-output leakage scenarios.
- Security/output scenarios: 100% pass for forbidden-key and raw diagnostic scan.
- Full NFR PASS/CONCERNS/FAIL status is deferred to `nfr-assess` after implementation evidence exists.

## Waiver Register

| Waiver | Requirement / concern                                                         | Reason                                                                                                                            | Owner                  | Residual risk                                                                               | Follow-up trigger                                                                              |
| ------ | ----------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | ---------------------- | ------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| W-001  | `--correlation-id <run-id>` positional consumption by `parseArgs`.            | Existing parser behavior can consume the run ID as correlation ID; missing-run-ID envelope covers the resulting state.            | CLI owner              | A manual caller can pass the run ID in the wrong place and receive malformed request.       | Revisit if CLI parser is replaced or remote controller argv generation can produce this shape. |
| W-002  | Contract fixture deltas for resume/retry execution-phase fields.              | Fixtures show BMAD/Hermes examples; Archon JSON recovery commands are acknowledgements and must not fabricate execution outcomes. | Contract owner         | Future consumers may request attempt metadata or running state in a generic provider field. | Hermes 3.4c requires these fields or schema tightens `result`.                                 |
| W-003  | Out-of-order workflow event stream validation.                                | Recovery commands do not consume event streams; Story 3.5 owns event delivery and redelivery ordering.                            | Workflow event owner   | Event ordering defects could appear later outside command responses.                        | Story 3.5 implementation or event outbox review begins.                                        |
| W-004  | Permission/auth enforcement for local CLI invocation.                         | Local CLI inherits OS/process trust; this story does not add remote multi-user command auth.                                      | Product/security owner | Remote command execution may need stronger auth later.                                      | Multi-user remote execution scope is accepted.                                                 |
| W-005  | External process cancellation of the CLI command itself.                      | This story covers `workflow.cancel` as a workflow-run control, not supervisor-level process kill semantics.                       | CLI architecture owner | A killed process may leave a committed mutation without an emitted envelope.                | Workflow Commander accepts a provider-command supervisor timeout/cancel contract.              |
| W-006  | Performance/load threshold.                                                   | No accepted local command latency SLO exists.                                                                                     | Product owner          | Slow recovery acknowledgement could degrade controller UX.                                  | Telemetry or product requirement defines a maximum command latency.                            |
| W-007  | Full live cross-process race test for cancel/resume and duplicate node retry. | Real two-process race tests can be flaky and slow; CAS-result unit tests plus focused DB tests provide deterministic evidence.    | Test architect         | Scheduler-specific race behavior may differ from mocked CAS paths.                          | Production incident, flaky behavior, or accepted concurrency test harness.                     |
| W-008  | HTTP/Web UI recovery route tests.                                             | PRD FR-8 forbids state-changing HTTP control for Workflow Commander v1.                                                           | Product owner          | UI/API consumers remain unsupported for this control plane.                                 | A new story accepts HTTP/Web recovery controls.                                                |
| W-009  | Legacy `workflow abandon` conversion.                                         | `abandon` is not the Workflow Commander command; new `cancel` is the provider surface.                                            | CLI owner              | Legacy scripts continue using a different JSON shape.                                       | Legacy `abandon` deprecation or provider command vocabulary changes.                           |
| W-010  | Legacy `workflow retry-node` JSON conversion.                                 | `retry-node` streams execution and is not the provider command.                                                                   | CLI owner              | Manual users cannot request JSON from `retry-node`.                                         | Streaming retry-node is replaced or a separate execution-output channel exists.                |
| W-011  | `printJsonWriteError` deletion.                                               | Legacy `workflowAbandonCommand` still uses it and must remain untouched.                                                          | CLI owner              | Helper remains with legacy JSON shape for one caller.                                       | Legacy abandon is converted, deprecated, or removed.                                           |

## Mandatory Traceability

### Acceptance Criteria

| Acceptance criterion                                                                                                                   | Coverage                                                                                                                                        | Waiver                                       |
| -------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| AC1: Resume success envelope and non-resumable failure without mutation.                                                               | 3.3D-UNIT-001 through 008; 3.3D-CONTRACT-001; 3.3D-E2E-001, 004, 007, 010, 013, 019.                                                            | None                                         |
| AC2: Whole-run retry success envelope and existing retry contract preservation.                                                        | 3.3D-UNIT-018 through 021, 044; 3.3D-CONTRACT-003, 006; 3.3D-CI-005.                                                                            | W-002 for attempt fixture deltas             |
| AC3: Targeted node retry success and unknown/ineligible node failure without starting recovery.                                        | 3.3D-UNIT-022 through 034; 3.3D-INT-001; 3.3D-CONTRACT-003.                                                                                     | W-007 for full live cross-process race       |
| AC4: Cancel success envelope and no legacy `abandon` serialization.                                                                    | 3.3D-UNIT-009 through 017; 3.3D-CONTRACT-002, 004; 3.3D-E2E-002, 005, 008, 011, 014, 019.                                                       | W-009 for legacy abandon remaining unchanged |
| AC5: Malformed input, timeout, unexpected exit, schema-invalid JSON, invalid run state failure envelope and no unsupported transition. | 3.3D-UNIT-003 through 007, 012 through 015, 020, 021, 024 through 050; 3.3D-E2E-001 through 016, 019; 3.3D-CONTRACT-004, 005, 007; 3.3D-CI-001. | W-005 for external process cancellation      |

### High-Risk Items

| Risk  | Required coverage                                                             | Status                                     |
| ----- | ----------------------------------------------------------------------------- | ------------------------------------------ |
| R-001 | 3.3D-UNIT-001, 002, 003, 004, 005, 006, 007, 008; 3.3D-CONTRACT-001           | Scenario coverage                          |
| R-002 | 3.3D-UNIT-009 through 017; 3.3D-CONTRACT-002, 004; W-009                      | Scenario plus waiver for legacy command    |
| R-003 | 3.3D-UNIT-008, 018, 022, 061; 3.3D-E2E-019; W-010                             | Scenario plus waiver for legacy retry-node |
| R-004 | 3.3D-UNIT-006, 007, 015, 030, 031, 032, 041, 042, 046, 050; 3.3D-CONTRACT-007 | Scenario coverage                          |
| R-005 | 3.3D-UNIT-008, 045; 3.3D-E2E-019                                              | Scenario coverage                          |
| R-006 | 3.3D-UNIT-034, 043, 044, 047; 3.3D-E2E-001 through 016                        | Scenario coverage                          |
| R-007 | 3.3D-UNIT-003, 004, 012, 013, 017, 020, 021, 024, 025, 026, 027               | Scenario coverage                          |
| R-008 | 3.3D-UNIT-018 through 021, 044                                                | Scenario coverage                          |
| R-009 | 3.3D-UNIT-022, 023; 3.3D-CONTRACT-003                                         | Scenario coverage                          |
| R-010 | 3.3D-UNIT-024 through 040                                                     | Scenario coverage                          |
| R-011 | 3.3D-UNIT-017; 3.3D-INT-002; W-007                                            | Scenario plus race-depth waiver            |
| R-012 | 3.3D-UNIT-028, 030, 031, 032; 3.3D-INT-001; W-007                             | Scenario plus race-depth waiver            |
| R-013 | 3.3D-UNIT-006, 015                                                            | Scenario coverage                          |
| R-014 | 3.3D-UNIT-016, 046; 3.3D-CONTRACT-004, 005                                    | Scenario coverage                          |
| R-015 | 3.3D-UNIT-041, 042; 3.3D-E2E-004 through 006                                  | Scenario coverage                          |
| R-017 | 3.3D-UNIT-059 through 061; 3.3D-CI-002, 003, 005                              | Scenario coverage                          |
| R-018 | 3.3D-CI-004                                                                   | Scenario coverage                          |
| R-019 | 3.3D-UNIT-029, 030, 031, 032, 049                                             | Scenario coverage                          |
| R-020 | 3.3D-UNIT-007, 048; 3.3D-CONTRACT-007; 3.3D-CI-001                            | Scenario coverage                          |

### Reviewer Concerns

All reviewer concerns RC-01 through RC-50 are dispositioned in the Reviewer-Evidence Disposition table.
Rows with waivers point to W-001 through W-011 and include reason, owner, residual risk, and follow-up trigger.
Rows without waivers map to specific P0/P1/P2 scenario IDs.

## Checklist Validation Summary

| Checklist area             | Result | Evidence                                                                                                                                                                                                   |
| -------------------------- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Epic-level prerequisites   | PASS   | Story markdown with ACs exists; PRD, architecture, epics, contracts, previous stories, and project context loaded.                                                                                         |
| Existing coverage analyzed | PASS   | Real project patterns: `workflow.test.ts`, `workflow-json.e2e.test.ts`, `workflow-command-contract.test.ts`, `workflow-provider-command-envelope.test.ts`, core operation tests, package script isolation. |
| Risk assessment            | PASS   | 22 risks scored; all score >= 6 risks have P0/P1 scenarios.                                                                                                                                                |
| Reviewer concerns          | PASS   | RC-01 through RC-50 map to scenarios or waivers.                                                                                                                                                           |
| NFR planning               | PASS   | Security, reliability, data integrity, compatibility, maintainability, and performance threshold gaps documented.                                                                                          |
| Coverage design            | PASS   | 85 atomic scenarios across Unit, E2E subprocess, Contract, Integration/core, and CI gates.                                                                                                                 |
| Execution strategy         | PASS   | Simple PR / pre-merge / nightly / weekly model; priority separated from timing.                                                                                                                            |
| Resource estimates         | PASS   | Ranges only; no false precision.                                                                                                                                                                           |
| Quality gates              | PASS   | P0 100%, P1 >= 95%, high-risk mitigations required, NFR evidence planned.                                                                                                                                  |
| Waivers                    | PASS   | W-001 through W-011 include reason, owner, residual risk, and follow-up trigger.                                                                                                                           |
