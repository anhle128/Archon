---
workflowStatus: 'completed'
totalSteps: 5
stepsCompleted:
  [
    'step-01-detect-mode',
    'step-02-load-context',
    'step-03-risk-and-testability',
    'step-04-coverage-plan',
    'step-05-generate-output',
  ]
lastStep: 'step-05-generate-output'
nextStep: ''
lastSaved: '2026-07-08'
inputDocuments:
  - '_bmad-output/implementation-artifacts/a4-1-aggregate-quality-gate-summary.md'
  - '_bmad-output/project-context.md'
  - '_bmad/tea/config.yaml'
  - '_bmad-output/planning-artifacts/architecture.md'
  - '_bmad-output/planning-artifacts/epics.md'
  - '_bmad-output/implementation-artifacts/a3-3-join-tr-as-final-gate.md'
  - '_bmad-output/test-artifacts/test-design/test-design-a3-3-join-tr-as-final-gate.md'
  - '.archon/workflows/defaults/bmad-dev-story-with-tea-fix-loop-v2.yml'
  - 'packages/workflows/package.json'
  - 'packages/workflows/src/defaults/v2-gate-planner-contract.test.ts'
  - 'packages/workflows/src/defaults/v2-gate-planner-dag.test.ts'
  - 'packages/workflows/src/defaults/v2-tr-join-contract.test.ts'
  - 'packages/workflows/src/defaults/v2-tr-join-dag.test.ts'
  - 'packages/workflows/src/schemas/dag-node.ts'
  - 'packages/workflows/src/dag-executor.ts'
  - '.agents/skills/bmad-testarch-test-design/resources/knowledge/risk-governance.md'
  - '.agents/skills/bmad-testarch-test-design/resources/knowledge/probability-impact.md'
  - '.agents/skills/bmad-testarch-test-design/resources/knowledge/test-levels-framework.md'
  - '.agents/skills/bmad-testarch-test-design/resources/knowledge/test-priorities-matrix.md'
  - '.agents/skills/bmad-testarch-test-design/resources/knowledge/nfr-criteria.md'
  - '.agents/skills/bmad-testarch-test-design/resources/knowledge/contract-testing.md'
  - '.agents/skills/bmad-testarch-test-design/resources/knowledge/playwright-cli.md'
  - '.agents/skills/bmad-testarch-test-design/resources/knowledge/overview.md'
  - '.agents/skills/bmad-testarch-test-design/resources/knowledge/api-request.md'
  - '.agents/skills/bmad-testarch-test-design/resources/knowledge/auth-session.md'
  - '.agents/skills/bmad-testarch-test-design/resources/knowledge/recurse.md'
---

# Test Design Progress

## Step 1: Detect Mode & Prerequisites

Mode: Epic-level test design.

Reason: The provided input is a story-level implementation artifact with acceptance criteria, task scope, dev notes, architecture facts, known reviewer concerns, and validation commands.

Prerequisites: Available.

Primary requirements source: `_bmad-output/implementation-artifacts/a4-1-aggregate-quality-gate-summary.md`.

Architecture context: Available through the story dev notes and `_bmad-output/project-context.md`.

## Step 2: Load Context & Knowledge Base

Configuration loaded from `_bmad/tea/config.yaml`.

`tea_use_playwright_utils` is enabled.

`tea_use_pactjs_utils` is disabled.

`tea_pact_mcp` is `none`.

`tea_browser_automation` is `auto`.

`test_stack_type` is `auto`.

Detected stack: fullstack TypeScript monorepo, with this story scoped to backend/workflow DAG YAML and Bun tests under `@archon/workflows`.

Browser exploration: skipped because the story has no browser target URL and no UI acceptance path.

Existing test pattern: co-located Bun structural contract tests for YAML/schema/bundle assertions and isolated Bun DAG executor tests for files using `mock.module()`.

Loaded implementation context includes the current v2 YAML, the a3.3 predecessor artifact, the prior a3.3 test design, workflow package test registration, trigger-rule schema facts, and real executor join semantics.

Known coverage gaps loaded from the story: missing a3.3 baseline in this worktree, unresolved TR skip wiring, four-role summary aggregation, whole-output branch selection, deterministic JSON parsing, fail-closed source contract validation, role `ERROR` separation, summary artifact persistence, v1 baseline preservation, bundled-default parity, and isolated DAG test registration.

## Step 3: Testability & Risk Assessment

Scope: Epic-level risk assessment for the story that evolves `quality-gate-summary` into the four-role route-facing quality contract aggregator.

Risk scoring uses probability 1-3 multiplied by impact 1-3.

Priority mapping follows the loaded TEA guidance, with score 9 as P0, score 6-8 as P1, score 4-5 as P2, and score 1-3 as P3 unless a core-behavior concern requires promotion.

### Testability Assessment

Controllability is strong because `@archon/workflows` already has real DAG executor harnesses that mock provider nodes while running bash nodes for real.

Controllability is conditional on resolving the a3.3 baseline gap because this worktree currently lacks the TR skip sibling and precursor summary barrier that this story builds on.

Observability is strong when `quality-gate-summary` emits exact JSON to stdout and best-effort writes `quality-gate-summary.json` under the existing run directory.

Observability is weak if validation failure paths emit partial JSON before exiting, because downstream tooling could capture a stale route decision.

Reliability is strong when structural tests stay co-located and `mock.module()` DAG tests run in their own Bun invocation.

Reliability becomes weak if the five required DAG fixtures are treated as implied coverage rather than explicit executable paths.

### Reviewer Concern Disposition

| Concern ID | Known reviewer concern treated as evidence                                                                                                     | Disposition              | Probability | Impact | Score | Priority | Rationale                                                                                                                   |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------ | ----------- | ------ | ----- | -------- | --------------------------------------------------------------------------------------------------------------------------- |
| C-001      | The a3.3 baseline is not present in this worktree.                                                                                             | Risk R-001               | 3           | 3      | 9     | P0       | Without one resolved TR role contract, the four-role summary cannot execute correctly.                                      |
| C-002      | The summary must read JSON contracts and node outputs only, never markdown or prose.                                                           | Risk R-002               | 3           | 3      | 9     | P0       | Parsing prose breaks the cross-process contract and can route on non-authoritative text.                                    |
| C-003      | Optional roles must be selected with whole-output references, not field-level reads on skipped branches.                                       | Risk R-003               | 3           | 3      | 9     | P0       | This is a known producer-not-run failure mode from the predecessor review.                                                  |
| C-004      | The summary must use `bun -e` plus `JSON.parse`, not `grep` or `case` substring matching.                                                      | Risk R-004               | 3           | 3      | 9     | P0       | This is a known predecessor defect that lets invalid or misleading JSON pass.                                               |
| C-005      | Bash assignments for substituted outputs must stay unquoted because executor substitution is already shell-quoted.                             | Risk R-005               | 2           | 2      | 4     | P2       | Incorrect assignment style can corrupt complex values but is less likely than the known parser failures.                    |
| C-006      | Any role `FAIL` must produce summary `gate:"FAIL"` and blocked role evidence.                                                                  | Risk R-006               | 2           | 3      | 6     | P1       | A missed blocking role breaks core release-gate behavior.                                                                   |
| C-007      | `CONCERNS`-only must still produce summary `PASS` while preserving `decision_needed_count > 0`.                                                | Risk R-007               | 2           | 3      | 6     | P1       | Misclassifying deferred judgment as failure blocks the workflow and loses the later decision contract.                      |
| C-008      | All `PASS` or `SKIPPED` roles with no `CONCERNS` must produce `decision_needed_count == 0`.                                                    | Risk R-008               | 2           | 3      | 6     | P1       | Wrong count values corrupt the future route loop contract.                                                                  |
| C-009      | Missing, empty, mismatched, or role `ERROR` contracts must fail closed with non-zero exit and no `PASS` or `FAIL` routing decision.            | Risk R-009               | 3           | 3      | 9     | P0       | Silent pass or fix-loop routing on tooling errors breaks data integrity and route safety.                                   |
| C-010      | Every source contract must validate `story_ref`, `contract_version`, `workflow`, and expected producer `node`.                                 | Risk R-010               | 3           | 3      | 9     | P0       | Identity mismatch is explicitly an `ERROR`, not recoverable quality work.                                                   |
| C-011      | Role gate `ERROR` must remain separate from `FAIL`.                                                                                            | Risk R-011               | 2           | 3      | 6     | P1       | Treating tooling failure as fixable quality failure can route to the wrong loop in the next story.                          |
| C-012      | All validation must finish before summary JSON is written to stdout.                                                                           | Risk R-012               | 2           | 3      | 6     | P1       | Partial stdout can become a stale route decision.                                                                           |
| C-013      | The emitted summary envelope must include required routing fields and per-role gate echoes.                                                    | Risk R-013               | 2           | 3      | 6     | P1       | Later route-loop consumers need a complete contract without re-reading upstream gates.                                      |
| C-014      | The summary must persist `quality-gate-summary.json` in the run artifact directory.                                                            | Risk R-014               | 2           | 2      | 4     | P2       | Missing artifact persistence hurts auditability but stdout still carries the primary node output.                           |
| C-015      | `quality-gate-summary` must depend on CR, resolved RV, resolved NR, resolved TR, and `resolve-story-input` with fail-closed trigger semantics. | Risk R-015               | 3           | 3      | 9     | P0       | Wrong join semantics can omit required evidence or mask dependency failures.                                                |
| C-016      | `create-pull-request` must consume `quality-gate-summary`, and this story must not add `quality-route-loop`.                                   | Risk R-016               | 2           | 3      | 6     | P1       | Premature or wrong tail wiring changes story boundaries and core route behavior.                                            |
| C-017      | Edited v2 source, generated bundle, and the untouched v1 baseline must stay consistent.                                                        | Risk R-017               | 2           | 3      | 6     | P1       | Drift breaks installed defaults or rollback compatibility.                                                                  |
| C-018      | Contract tests must assert the new summary structure and predecessor safety invariants.                                                        | Risk R-018               | 3           | 3      | 9     | P0       | Missing structural coverage allows contract-breaking YAML to ship.                                                          |
| C-019      | DAG tests must explicitly prove all five required fixtures, including missing and mismatched contracts.                                        | Risk R-019               | 3           | 3      | 9     | P0       | The most dangerous edge cases are fail-closed runtime paths and cannot be left implied.                                     |
| C-020      | The new DAG test uses `mock.module()` and must run as its own isolated Bun invocation.                                                         | Risk R-020               | 2           | 3      | 6     | P1       | Bun module mock pollution creates flaky or misleading results.                                                              |
| C-021      | The predecessor found that schema-valid TR `FAIL` or `ERROR` could still allow PR handoff if only completion was checked.                      | Risk R-006               | 2           | 3      | 6     | P1       | The summary must aggregate parsed gates, not node completion alone.                                                         |
| C-022      | The predecessor found that `run_tr=false` with a failed real RV or NR branch could still let the tail run.                                     | Risk R-015               | 3           | 3      | 9     | P0       | This is a known partial-failure route bug and requires fail-closed join coverage.                                           |
| C-023      | `decision_needed_count` is derived as the count of resolved role contracts with gate `CONCERNS`.                                               | Explicit non-risk NR-001 | 1           | 2      | 2     | P3       | The story explicitly documents this role-count derivation because no upstream contract exposes per-finding decision counts. |
| C-024      | Runtime engine, core/server code, migrations, routes, and new packages are out of scope.                                                       | Risk R-021               | 1           | 3      | 3     | P3       | Scope drift increases rollback blast radius even though the expected implementation is YAML plus tests.                     |
| C-025      | New tests and generated code must avoid forbidden plan or finding identifiers and use kebab-case runtime ids.                                  | Risk R-022               | 1           | 2      | 2     | P3       | This is a maintainability and project-convention risk, not a release-gate behavior risk.                                    |

### Risk Register

| Risk ID | Category | Risk                                                                                                            | Probability | Impact | Score | Priority | Owner                | Mitigation                                                                                                       |
| ------- | -------- | --------------------------------------------------------------------------------------------------------------- | ----------- | ------ | ----- | -------- | -------------------- | ---------------------------------------------------------------------------------------------------------------- |
| R-001   | TECH     | The story proceeds from an a3.2 YAML baseline and never creates the required TR resolved contract path.         | 3           | 3      | 9     | P0       | Workflow implementer | Verify a3.3 baseline or explicitly fold its TR join and skip wiring into this story.                             |
| R-002   | DATA     | The summary reads markdown or prose instead of route-facing JSON contracts.                                     | 3           | 3      | 9     | P0       | Workflow implementer | Structural test forbids markdown/prose reads and asserts node output contract selection.                         |
| R-003   | TECH     | Field-level output reads on skipped optional branches throw `producer-not-run`.                                 | 3           | 3      | 9     | P0       | Workflow implementer | Structural tests require whole-output reads and forbid `$tea-*.output.gate` on skip-capable branches.            |
| R-004   | DATA     | Substring matching accepts malformed JSON or false-positive text as a gate decision.                            | 3           | 3      | 9     | P0       | Workflow implementer | Require `JSON.parse` and add malformed, formatted, and substring false-positive tests.                           |
| R-005   | DATA     | Incorrect shell quoting corrupts substituted JSON values.                                                       | 2           | 2      | 4     | P2       | Workflow implementer | Contract test asserts the established unquoted assignment pattern for selected outputs.                          |
| R-006   | TECH     | Blocking role gates are not reflected as summary `FAIL`.                                                        | 2           | 3      | 6     | P1       | Workflow implementer | DAG fixtures prove each role `FAIL` path and blocked role accounting.                                            |
| R-007   | BUS      | Decision-needed-only results are incorrectly treated as blocking failures.                                      | 2           | 3      | 6     | P1       | Workflow maintainer  | DAG fixture proves `CONCERNS` without `FAIL` yields `PASS` and preserved count.                                  |
| R-008   | DATA     | `decision_needed_count` is wrong for all-pass or skipped-only paths.                                            | 2           | 3      | 6     | P1       | Workflow implementer | Boundary fixtures assert zero and non-zero count cases.                                                          |
| R-009   | DATA     | Missing, empty, invalid, mismatched, or role `ERROR` contracts emit a route decision instead of failing closed. | 3           | 3      | 9     | P0       | Workflow implementer | Negative DAG fixtures assert failed node state and no summary output.                                            |
| R-010   | DATA     | Stale or wrong-story contracts are accepted.                                                                    | 3           | 3      | 9     | P0       | Workflow implementer | Validate every source contract against resolved story identity and expected envelope fields.                     |
| R-011   | TECH     | Role `ERROR` is routed as fixable quality `FAIL`.                                                               | 2           | 3      | 6     | P1       | Workflow implementer | Test hard node failure for `ERROR` and assert no `PASS` or `FAIL` stdout contract.                               |
| R-012   | DATA     | Partial summary JSON is emitted before validation completes.                                                    | 2           | 3      | 6     | P1       | Workflow implementer | Tests assert empty summary artifact and no stdout contract on failure.                                           |
| R-013   | DATA     | The summary contract omits fields future routing needs.                                                         | 2           | 3      | 6     | P1       | Workflow implementer | Structural and DAG tests assert envelope, round, counts, and per-role gate echoes.                               |
| R-014   | OPS      | `quality-gate-summary.json` is not persisted for audit and later consumers.                                     | 2           | 2      | 4     | P2       | Workflow implementer | Structural test asserts artifact path and DAG test reads persisted contract.                                     |
| R-015   | TECH     | Join dependencies or trigger rules allow omitted evidence or masked upstream failure.                           | 3           | 3      | 9     | P0       | Workflow implementer | Structural and partial-failure DAG tests cover full dependency list and `none_failed_min_one_success`.           |
| R-016   | TECH     | Tail wiring bypasses summary or adds the route loop early.                                                      | 2           | 3      | 6     | P1       | Workflow implementer | Structural tests assert `create-pull-request` depends only on summary and no `quality-route-loop` node is added. |
| R-017   | OPS      | Source workflow, generated bundle, or v1 baseline drift.                                                        | 2           | 3      | 6     | P1       | Workflow implementer | Bundle parity and v1 byte-for-byte tests plus `bun run check:bundled`.                                           |
| R-018   | TECH     | Contract tests do not protect the route-facing contract.                                                        | 3           | 3      | 9     | P0       | Test architect       | Add `v2-quality-summary-contract.test.ts` with structural assertions and bundle parity.                          |
| R-019   | TECH     | DAG tests omit high-risk negative and edge paths.                                                               | 3           | 3      | 9     | P0       | Test architect       | Add `v2-quality-summary-dag.test.ts` with all required fixtures and failure assertions.                          |
| R-020   | OPS      | `mock.module()` pollution causes order-dependent workflow tests.                                                | 2           | 3      | 6     | P1       | Test architect       | Register the DAG test as its own package script invocation.                                                      |
| R-021   | TECH     | Implementation touches out-of-scope runtime packages.                                                           | 1           | 3      | 3     | P3       | Workflow implementer | Scope guard in tests and review checklist.                                                                       |
| R-022   | TECH     | Runtime ids or test artifacts violate project naming rules.                                                     | 1           | 2      | 2     | P3       | Workflow implementer | Structural convention checks.                                                                                    |

### NFR Planning Assessment

Security is not directly in scope because the story does not touch auth, permissions, credentials, adapters, or protected API routes.

Security residual risk is low unless implementation expands provider permissions, logs contract contents containing sensitive values, or modifies credential delivery.

Performance is not directly in scope because the story changes one bash workflow node and tests, not a runtime hot path.

Performance residual risk is low, with `timeout: 60000` serving as the relevant bounded execution guard.

Reliability is in scope through fail-closed joins, skipped-node selection, hard failure on invalid contracts, timeout coverage, and isolated test execution.

Maintainability is in scope through bounded YAML-only implementation, targeted tests, bundle regeneration, v1 rollback safety, and no speculative route-loop work.

Compatibility is in scope because generated bundled defaults must match source and v1 must remain untouched.

Data integrity is in scope through story identity validation, contract envelope validation, JSON parsing, role gate vocabulary, and count fields.

Compliance has no explicit threshold in the loaded artifacts.

Scalability has no explicit threshold in the loaded artifacts.

### Highest Mitigation Priorities

First priority: prove fail-closed contract validation for missing, empty, malformed, mismatched, stale, and role `ERROR` inputs.

Second priority: prove all route decisions come from parsed JSON contracts selected by whole-output branch resolution.

Third priority: prove all high-risk aggregation outcomes with isolated DAG fixtures, including PASS, FAIL, CONCERNS-only PASS, missing contract ERROR, and story mismatch ERROR.

Fourth priority: preserve source/bundle/v1 compatibility and Bun mock isolation so the test suite remains deterministic.

## Step 4: Coverage Plan & Execution Strategy

P0, P1, P2, and P3 are scenario priorities, not execution order labels.

The primary test levels for this story are Bun structural contract tests, Bun isolated DAG executor tests, Bun unit or technique proofs, and validation commands.

Browser E2E coverage is not selected because there is no browser-visible workflow for this story.

### Coverage Matrix

| Test ID | Priority | Test level                                | Scenario                                                                                                                                                                                                                                                                          | Primary risks              | Acceptance criteria |
| ------- | -------- | ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------- | ------------------- |
| TD-100  | P0       | Bun structural contract                   | `quality-gate-summary` exists as a deterministic bash node, has `depends_on` for CR, resolved RV, resolved NR, resolved TR, and `resolve-story-input`, uses `trigger_rule: none_failed_min_one_success`, uses `timeout: 60000`, and declares `output_type: quality-gate-summary`. | R-001, R-015, R-018        | AC1, AC6            |
| TD-101  | P0       | Bun structural contract                   | The summary reads `$code-review-auto.output`, `$tea-rv.output`, `$tea-rv-skipped.output`, `$tea-nr.output`, `$tea-nr-skipped.output`, `$tea-tr.output`, and `$tea-tr-skipped.output`, and it never reads `$tea-*.output.gate` on skip-capable branches.                           | R-002, R-003               | AC1, AC5            |
| TD-102  | P0       | Bun structural contract                   | The summary uses `bun -e` plus `JSON.parse()` for selected source contracts and does not use `grep`, `case`, or raw substring matching on JSON text.                                                                                                                              | R-004, R-018               | AC1, AC5            |
| TD-103  | P1       | Bun structural contract plus isolated DAG | The summary emits exact JSON to stdout and best-effort persists `quality-gate-summary.json` under `$ARTIFACTS_DIR/bmad-dev-story-with-tea-fix-loop/`.                                                                                                                             | R-013, R-014               | AC1                 |
| TD-104  | P1       | Bun structural contract                   | The summary contract envelope includes `contract_version`, `workflow`, `node`, `story_ref`, `gate`, `round`, `blocking_count`, `decision_needed_count`, `findings_total`, `cr_gate`, `rv_gate`, `nr_gate`, and `tr_gate`.                                                         | R-013                      | AC1, AC3, AC4       |
| TD-105  | P1       | Bun unit proof                            | Special characters in selected JSON string fields survive the parse and re-encode pattern without corrupting the summary JSON.                                                                                                                                                    | R-004, R-005               | AC1, AC5            |
| TD-110  | P1       | Isolated DAG executor                     | CR `gate:"FAIL"` produces summary `gate:"FAIL"`, `blocking_count >= 1`, `cr_gate:"FAIL"`, and a blocked role echo.                                                                                                                                                                | R-006                      | AC2                 |
| TD-111  | P1       | Isolated DAG executor                     | RV real `gate:"FAIL"` produces summary `gate:"FAIL"` and preserves the RV block while other roles remain non-blocking.                                                                                                                                                            | R-006                      | AC2                 |
| TD-112  | P1       | Isolated DAG executor                     | NR real `gate:"FAIL"` produces summary `gate:"FAIL"` and preserves the NR block while other roles remain non-blocking.                                                                                                                                                            | R-006                      | AC2                 |
| TD-113  | P1       | Isolated DAG executor                     | TR real `gate:"FAIL"` produces summary `gate:"FAIL"` and preserves the TR block while other roles remain non-blocking.                                                                                                                                                            | R-006                      | AC2                 |
| TD-114  | P1       | Isolated DAG executor                     | Multiple role `FAIL` values produce `blocking_count` equal to the number of failed roles and per-role gate echoes for each failed role.                                                                                                                                           | R-006, R-013               | AC2                 |
| TD-120  | P1       | Isolated DAG executor                     | A single resolved role with `gate:"CONCERNS"` and no `FAIL` or `ERROR` produces summary `gate:"PASS"` and `decision_needed_count == 1`.                                                                                                                                           | R-007                      | AC3                 |
| TD-121  | P1       | Isolated DAG executor                     | Multiple resolved roles with `gate:"CONCERNS"` and no `FAIL` or `ERROR` produce summary `gate:"PASS"` and `decision_needed_count` equal to the number of concern roles.                                                                                                           | R-007, R-008               | AC3                 |
| TD-130  | P0       | Isolated DAG executor                     | All four roles `PASS` produces summary `gate:"PASS"`, `decision_needed_count == 0`, `blocking_count == 0`, and correct `findings_total`.                                                                                                                                          | R-008, R-019               | AC4                 |
| TD-131  | P1       | Isolated DAG executor                     | Optional RV, NR, or TR skipped contracts are selected as resolved role contracts and produce summary `gate:"PASS"` with `SKIPPED` echoes and zero decision-needed count when no role has `CONCERNS`.                                                                              | R-003, R-008               | AC4                 |
| TD-140  | P0       | Isolated DAG executor                     | Missing or empty CR output fails the summary node with no stdout summary and no persisted summary file.                                                                                                                                                                           | R-009, R-012, R-019        | AC5                 |
| TD-141  | P0       | Isolated DAG executor                     | An optional role with both real and skipped outputs empty fails the summary node with no stdout summary and no persisted summary file.                                                                                                                                            | R-003, R-009, R-012        | AC5                 |
| TD-142  | P0       | Isolated DAG executor                     | Any source contract with mismatched `story_ref` fails closed before summary emission.                                                                                                                                                                                             | R-009, R-010, R-012        | AC5                 |
| TD-143  | P0       | Isolated DAG executor                     | Any source contract with mismatched `contract_version` fails closed before summary emission.                                                                                                                                                                                      | R-009, R-010, R-012        | AC5                 |
| TD-144  | P0       | Isolated DAG executor                     | Any source contract with mismatched `workflow` fails closed before summary emission.                                                                                                                                                                                              | R-009, R-010, R-012        | AC5                 |
| TD-145  | P0       | Isolated DAG executor                     | Any source contract with mismatched producer `node` fails closed before summary emission.                                                                                                                                                                                         | R-009, R-010, R-012        | AC5                 |
| TD-146  | P0       | Isolated DAG executor                     | Any resolved role contract with `gate:"ERROR"` hard-fails the node and emits no `PASS` or `FAIL` route decision.                                                                                                                                                                  | R-009, R-011, R-012        | AC5                 |
| TD-147  | P0       | Isolated DAG executor                     | Malformed selected JSON fails closed and emits no summary contract.                                                                                                                                                                                                               | R-004, R-009, R-012        | AC5                 |
| TD-148  | P1       | Isolated DAG executor                     | Invalid numeric fields such as negative or non-numeric `findings_count` or missing CR `round` fail closed before summary emission.                                                                                                                                                | R-009, R-013               | AC5                 |
| TD-149  | P1       | Isolated DAG executor                     | Failure paths leave stdout and `quality-gate-summary.json` empty or absent, proving validation happens before emission.                                                                                                                                                           | R-012                      | AC5                 |
| TD-150  | P1       | Bun unit proof plus isolated DAG          | Boundary counts are correct for zero findings, mixed findings, maximum four decision-needed roles, and multiple blocking roles.                                                                                                                                                   | R-006, R-007, R-008, R-013 | AC2, AC3, AC4       |
| TD-151  | P1       | Bun technique proof                       | Formatted JSON, escaped quotes, newlines, tabs, and substring false positives such as `"not_a_gate":"FAIL"` cannot influence aggregation outside parsed fields.                                                                                                                   | R-004, R-005               | AC1, AC5            |
| TD-152  | P2       | Bun unit proof                            | Re-running the summary encoder with identical inputs is deterministic and overwrites the artifact content rather than appending duplicate JSON.                                                                                                                                   | R-014                      | AC1                 |
| TD-153  | P1       | Bun unit proof                            | Trigger-rule matrix proves summary runs only when no dependency failed and at least one dependency completed, and skips safely for pending or missing upstream states.                                                                                                            | R-015                      | AC5, AC6            |
| TD-154  | P0       | Isolated DAG executor                     | A failed real RV, NR, or TR branch prevents summary and PR handoff even if the corresponding skip sibling exists.                                                                                                                                                                 | R-015, R-019               | AC5, AC6            |
| TD-155  | P2       | Bun structural contract                   | `quality-gate-summary` declares `timeout: 60000` and no unbounded external command.                                                                                                                                                                                               | R-014                      | AC1                 |
| TD-156  | P1       | Isolated DAG executor                     | Two separate DAG runs with distinct `ARTIFACTS_DIR` values do not share or overwrite each other's summary artifact.                                                                                                                                                               | R-014, R-020               | AC1                 |
| TD-160  | P1       | Bun structural contract plus command      | Edited v2 YAML passes `parseWorkflow`, source and `BUNDLED_WORKFLOWS` match, `bun run check:bundled` passes, and the v1 baseline remains byte-for-byte unchanged.                                                                                                                 | R-017                      | AC6                 |
| TD-161  | P1       | Bun structural contract                   | `create-pull-request` depends only on `quality-gate-summary`, and no `quality-route-loop`, `decision-needed-check`, or `review-loop-error` expansion is added by this story.                                                                                                      | R-016                      | AC6                 |
| TD-162  | P1       | Bun structural contract                   | `v2-quality-summary-contract.test.ts` is registered in the non-mock workflow-defaults batch and `v2-quality-summary-dag.test.ts` is registered as its own Bun invocation.                                                                                                         | R-018, R-020               | AC6                 |
| TD-163  | P0       | Bun structural contract                   | The a3.3 baseline or folded prerequisite wiring is present before summary assertions: `tea-tr` has the `run_tr == true` guard and gate output format, `tea-tr-skipped` exists, and predecessor TR join assertions remain active.                                                  | R-001, R-015, R-018        | AC1, AC6            |
| TD-164  | P3       | Bun structural contract                   | New runtime ids and output types remain kebab-case and generated test artifacts avoid forbidden plan or review-finding identifiers.                                                                                                                                               | R-022                      | AC6                 |
| TD-165  | P3       | Review checklist                          | File scope is limited to v2 YAML, generated bundled defaults, workflow default tests, and package test script.                                                                                                                                                                    | R-021                      | AC6                 |

### NFR Coverage And Evidence

| NFR             | Scenario coverage                             | Evidence source                                                                    | Notes                                                                                                 |
| --------------- | --------------------------------------------- | ---------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Reliability     | TD-140 through TD-154 and TD-156.             | Isolated DAG test output from `v2-quality-summary-dag.test.ts`.                    | Covers fail-closed behavior, malformed input, stale data, dependency failure, and artifact isolation. |
| Maintainability | TD-100 through TD-104, TD-160 through TD-165. | Bun contract test output, package script assertion, and validation command output. | Covers bounded scope, parseability, bundle parity, mock isolation, and naming conventions.            |
| Compatibility   | TD-160 and TD-163.                            | Contract test output plus `bun run check:bundled`.                                 | Covers source/bundle parity, v1 rollback safety, and prerequisite wiring.                             |
| Data integrity  | TD-101 through TD-151.                        | Contract and DAG test outputs.                                                     | Covers identity, envelope, parsed gate vocabulary, counts, and no partial route decision on error.    |
| Security        | Waived.                                       | None for this story.                                                               | No auth, permission, credential, or secret delivery path changes are in scope.                        |
| Performance     | Waived except TD-155.                         | Contract test output.                                                              | No runtime hot path exists; timeout is the relevant guard.                                            |

### Execution Strategy

PR validation should run the focused contract test, the isolated DAG test, `bun run check:bundled`, and then `bun run validate`.

Nightly validation should run the normal package-isolated `bun run test` suite and report any mock-pollution regressions.

Weekly validation is not required for this story because there is no long-running performance, chaos, or browser suite.

### Resource Estimate

P0 coverage estimate: about 10 to 16 engineering hours.

P1 coverage estimate: about 8 to 14 engineering hours.

P2 coverage estimate: about 2 to 4 engineering hours.

P3 coverage estimate: about 1 to 2 engineering hours.

Total estimate: about 21 to 36 engineering hours.

### Quality Gates

P0 scenario pass rate must be 100%.

P1 scenario pass rate must be at least 95%, and any exception must have an owner-approved waiver.

All score 6-9 risks must have scenario coverage or a documented waiver before release.

All acceptance criteria must trace to atomic scenarios before coverage can be marked complete.

No P0 or P1 edge case may be counted as covered by implication.

`bun run check:bundled` must pass after regeneration.

`bun run validate` must pass before PR handoff.

Full NFR PASS, CONCERNS, or FAIL assessment is deferred to `nfr-assess` after implementation evidence exists.

### Waivers

| Waiver ID | Subject                                          | Reason                                                                                                                                                       | Owner                   | Residual risk                                                          | Follow-up trigger                                                                                                                        |
| --------- | ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------- | ---------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| W-001     | `decision_needed_count` per-finding granularity. | The story explicitly derives the count from resolved roles with `gate:"CONCERNS"` because source contracts do not expose per-finding decision-needed counts. | Workflow maintainer     | A later route-loop or Linear sync story may need finer-grained counts. | Reopen if downstream consumers require per-finding decision-needed totals.                                                               |
| W-002     | Cancellation coverage.                           | Executor cancellation and lifecycle ownership are unchanged by this YAML/bash-contract story.                                                                | Workflow maintainer     | Cancellation during a summary write is not newly exercised.            | Add coverage if implementation changes executor cancellation, node lifecycle mutation, or artifact write ownership.                      |
| W-003     | Permission and auth coverage.                    | No auth, credential, adapter, or protected route code is in scope.                                                                                           | Security/platform owner | A stray implementation change could introduce untested auth behavior.  | Reopen if the diff touches `@archon/core` credentials, adapters, server auth routes, provider credential delivery, or permission checks. |
| W-004     | Load and performance testing.                    | No runtime hot path, API endpoint, or user-facing latency path changes are in scope.                                                                         | Workflow maintainer     | The summary bash could still hang if timeout is omitted.               | TD-155 must pass, and perf testing reopens if implementation adds long-running runtime work.                                             |

## Step 5: Generate Output

Execution mode resolved to sequential.

Epic-level output written to `_bmad-output/test-artifacts/test-design/test-design-a4-1-aggregate-quality-gate-summary.md`.

The output includes risk assessment, NFR planning, coverage matrix, acceptance-criterion trace, P0/P1 risk trace, reviewer concern trace, edge-case coverage, execution strategy, estimates, quality gates, waivers, and assumptions.

Checklist validation completed by inspection against `.agents/skills/bmad-testarch-test-design/checklist.md`.

No browser CLI sessions were opened, so there were no sessions to close.

Temporary and final artifacts were kept under `_bmad-output/test-artifacts/`.
