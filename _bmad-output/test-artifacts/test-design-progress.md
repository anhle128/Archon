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
  - '_bmad-output/implementation-artifacts/a3-3-join-tr-as-final-gate.md'
  - '_bmad-output/project-context.md'
  - '_bmad/tea/config.yaml'
  - '_bmad-output/planning-artifacts/architecture.md'
  - '_bmad-output/planning-artifacts/epics.md'
  - '.archon/workflows/defaults/bmad-dev-story-with-tea-fix-loop-v2.yml'
  - 'packages/workflows/src/defaults/v2-tea-branches-contract.test.ts'
  - 'packages/workflows/src/defaults/v2-tea-branches-dag.test.ts'
  - 'packages/workflows/package.json'
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

Reason: The provided input is a story-level implementation artifact with acceptance criteria, task scope, dev notes, architecture facts, known predecessor test assertions, and validation commands.

Prerequisites: Available.

Primary requirements source: `_bmad-output/implementation-artifacts/a3-3-join-tr-as-final-gate.md`.

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

Existing test pattern: co-located Bun contract tests for YAML/schema/static assertions and an isolated Bun DAG executor test for `mock.module()` behavior.

Known coverage gaps loaded from the story: TR gating, TR skip contract, TR contract envelope, tail rewiring, fail-closed behavior, bundle parity, v1 baseline safety, and predecessor assertions that currently encode the pre-story state.

## Step 3: Testability & Risk Assessment

Scope: Epic-level risk assessment for the TR final-gate story.

Risk scoring uses probability 1-3 multiplied by impact 1-3.

Priority mapping follows the loaded TEA guidance, with score 9 as P0, score 6-8 as P1 unless a stronger core-behavior reason applies, and compatibility or cross-process contract breakage promoted to P0 or P1.

### Testability Assessment

Controllability is strong because the workflow package already has a real DAG executor harness that mocks AI provider nodes while running bash nodes such as `gate-planner` for real.

Observability is strong for node state because the DAG harness records completed, failed, and skipped node events.

Observability is incomplete unless the new TR skip node emits both typed sidecar output and the best-effort `tea-tr-skipped.gate.json` artifact.

Reliability is strong when tests stay inside the existing Bun isolation pattern, especially because `v2-tea-branches-dag.test.ts` already runs in its own package-script segment.

Reliability becomes weak if a new `mock.module()` DAG file is co-located with other workflow tests.

The `run_tr=false` branch is controllable only at the condition-evaluator level because the real `gate-planner` currently emits `run_tr=true`.

That limitation is not a waiver.

It requires explicit structural and condition-evaluator coverage rather than a fake behavioral test.

### NFR Planning Assessment

Security: no auth, permission, token, or credential path changes are in scope.

Security residual risk is low unless the implementation expands provider permissions or logs dynamic contract values unexpectedly.

Performance: no runtime hot path or load-bearing API is changed.

Performance thresholds are not applicable for this story.

Reliability: in scope through fail-closed joins, skipped-branch resolution, timeout behavior, and deterministic `when:` evaluation.

Maintainability: in scope through predecessor test updates, v1 baseline preservation, package test isolation, and generated bundle parity.

Compatibility: in scope because bundled defaults must match source workflow YAML and the v1 baseline must remain unchanged.

Cross-process contract behavior: in scope because downstream nodes consume JSON gate contracts across provider and bash-node boundaries.

Data integrity: in scope for `story_ref`, gate vocabulary, required contract fields, and JSON escaping.

### Reviewer Concern Disposition

| Concern ID | Reviewer concern treated as evidence                                                                                                               | Disposition              | Probability | Impact | Score | Priority | Rationale                                                                                                                     |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------ | ----------- | ------ | ----- | -------- | ----------------------------------------------------------------------------------------------------------------------------- |
| C-001      | `tea-tr` must gain `when: "$gate-planner.output.run_tr == true"` despite predecessor tests asserting no `when:`.                                   | Risk R-001               | 3           | 3      | 9     | P0       | Missing the gate breaks core TR branch selection and can run the final gate when it should resolve through the skip branch.   |
| C-002      | `tea-tr-skipped` must exist with inverse `when: "$gate-planner.output.run_tr == false"`.                                                           | Risk R-002               | 3           | 3      | 9     | P0       | Without the sibling, the false path has no resolved TR-role contract and downstream behavior breaks.                          |
| C-003      | `tea-tr-skipped` must depend on `gate-planner` directly, not the RV or NR branches.                                                                | Risk R-003               | 2           | 3      | 6     | P1       | Wrong dependency shape can block or stale the skip branch and violates the architecture edge from `gate-planner` to `TRSkip`. |
| C-004      | The `run_tr=false` path must be proven structurally because the real `gate-planner` hardcodes `run_tr=true`.                                       | Risk R-004               | 3           | 3      | 9     | P0       | Behavioral tests alone cannot exercise the false path, so coverage is incomplete unless a condition-evaluator proof exists.   |
| C-005      | The test must not modify or mock `gate-planner` to fabricate `run_tr=false`.                                                                       | Risk R-005               | 2           | 3      | 6     | P1       | A fake false path would reverse the accepted gate-planner contract and produce misleading green tests.                        |
| C-006      | Real `tea-tr` must declare output_format fields and exclude `SKIPPED` from the real-branch gate enum.                                              | Risk R-006               | 3           | 3      | 9     | P0       | Missing schema enforcement allows malformed gate contracts and corrupts downstream cross-process contract behavior.           |
| C-007      | Real `tea-tr` must add a prompt_suffix that pins `$resolve-story-input.output.story_ref`.                                                          | Risk R-007               | 2           | 3      | 6     | P1       | Missing story identity can route evidence for the wrong story and is treated by architecture as `ERROR`.                      |
| C-008      | `tea-tr-skipped` must serialize JSON with `bun -e JSON.stringify`, not interpolated `echo`.                                                        | Risk R-008               | 2           | 3      | 6     | P1       | Quotes, backslashes, newlines, carriage returns, or tabs in dynamic reasons can corrupt JSON and hide the skip contract.      |
| C-009      | `tea-tr-skipped` must write a best-effort artifact and declare `timeout: 60000` plus `output_type: trace-skipped`.                                 | Risk R-009               | 2           | 2      | 4     | P1       | Missing observability can break artifact consumers and triage even if the node stdout succeeds.                               |
| C-010      | `create-pull-request` must depend on both `tea-tr` and `tea-tr-skipped` with `none_failed_min_one_success`.                                        | Risk R-010               | 3           | 3      | 9     | P0       | Tail reachability and fail-closed behavior are both core workflow behavior.                                                   |
| C-011      | `tea-tr` must keep the four-way RV/NR join and `none_failed_min_one_success`.                                                                      | Risk R-011               | 2           | 3      | 6     | P1       | A missing branch dependency can skip required evidence, while `all_done` can mask real failures.                              |
| C-012      | A real RV or NR failure must prevent `tea-tr` and the tail from completing.                                                                        | Risk R-012               | 3           | 3      | 9     | P0       | This is fail-closed release-gate behavior and must not be implied.                                                            |
| C-013      | Predecessor contract tests that assert the old TR state must be inverted, not deleted.                                                             | Risk R-013               | 3           | 2      | 6     | P1       | Leaving old assertions blocks implementation, while deleting them loses regression protection.                                |
| C-014      | The additive-count assertion must include `tea-tr-skipped` as a third new node id.                                                                 | Risk R-014               | 2           | 2      | 4     | P2       | This is a rollback and scope guard rather than a runtime behavior gate.                                                       |
| C-015      | The v1 baseline workflow must remain untouched.                                                                                                    | Risk R-015               | 2           | 3      | 6     | P1       | V1 compatibility and rollback safety are explicit release constraints.                                                        |
| C-016      | Bundled defaults must be regenerated from source and checked for parity.                                                                           | Risk R-016               | 2           | 3      | 6     | P1       | Source and embedded defaults drifting causes compatibility failures for installed defaults.                                   |
| C-017      | Any new `mock.module()` DAG file must run in its own Bun invocation.                                                                               | Risk R-017               | 2           | 3      | 6     | P1       | Bun module mocks are process-global and can pollute unrelated tests.                                                          |
| C-018      | `route_loop`, `gate-planner`, v1 workflow, and core/server runtime code are out of scope.                                                          | Risk R-018               | 2           | 2      | 4     | P2       | Scope creep can invalidate completed decisions and increase rollback blast radius.                                            |
| C-019      | `when`, `trigger_rule`, multi-dependency joins, `output_format`, `prompt_suffix`, and bash `output_type` are already supported by schema/executor. | Explicit non-risk NR-001 | 1           | 1      | 1     | P3       | Loaded source shows the primitives are supported, so only their story-specific usage needs coverage.                          |
| C-020      | Node ids and output types must stay kebab-case and test artifacts must avoid forbidden plan identifiers.                                           | Risk R-019               | 1           | 2      | 2     | P3       | This is a maintainability and convention risk, not a core behavior risk.                                                      |

### Risk Register

| Risk ID | Category | Risk                                                                                        | Evidence                                                                                                     | Probability | Impact | Score | Priority | Mitigation owner     | Mitigation                                                                                                |
| ------- | -------- | ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ | ----------- | ------ | ----- | -------- | -------------------- | --------------------------------------------------------------------------------------------------------- |
| R-001   | TECH     | `tea-tr` runs without the `run_tr` guard.                                                   | C-001 and current YAML lines 701-710 show no `when:` on `tea-tr`.                                            | 3           | 3      | 9     | P0       | Workflow implementer | Structural contract assertion for the exact `when:` string and parseWorkflow validation.                  |
| R-002   | TECH     | `run_tr=false` has no resolved TR-role sibling.                                             | C-002 and architecture list `tea-tr-skipped` as workflow-owned.                                              | 3           | 3      | 9     | P0       | Workflow implementer | Add `tea-tr-skipped` and assert inverse condition, bash type, timeout, output_type, and SKIPPED contract. |
| R-003   | TECH     | `tea-tr-skipped` is wired behind RV/NR and can be blocked by unrelated branches.            | C-003 and architecture mermaid place `TRSkip` directly after `gate-planner`.                                 | 2           | 3      | 6     | P1       | Workflow implementer | Assert `depends_on: [gate-planner]` and absence of RV/NR dependencies.                                    |
| R-004   | TECH     | False-path coverage is fake or absent because real `gate-planner` only emits `run_tr=true`. | C-004 and story notes call out the hardcoded true behavior.                                                  | 3           | 3      | 9     | P0       | Test architect       | Add condition-evaluator proof for `run_tr` true and false.                                                |
| R-005   | TECH     | Tests mutate or mock `gate-planner` to force false behavior.                                | C-005 and project notes warn that a mocked gate-planner is a fake test.                                      | 2           | 3      | 6     | P1       | Test architect       | Keep behavioral DAG tests on real bash gate-planner and cover false path structurally.                    |
| R-006   | DATA     | Real `tea-tr` emits or accepts malformed gate contracts.                                    | C-006 and contract envelope require version, workflow, node, gate, story_ref, counts, and evidence pointers. | 3           | 3      | 9     | P0       | Workflow implementer | Assert output_format required fields and gate enum excludes `SKIPPED`.                                    |
| R-007   | DATA     | TR evidence can be attributed to the wrong story.                                           | C-007 and architecture story identity rule treat mismatch as `ERROR`.                                        | 2           | 3      | 6     | P1       | Workflow implementer | Assert prompt_suffix pins `$resolve-story-input.output.story_ref` and skip contract copies it.            |
| R-008   | DATA     | Skip contract JSON is invalid for malformed dynamic reason text.                            | C-008 and prior skip-node tests already protect RV/NR with encoder proof.                                    | 2           | 3      | 6     | P1       | Workflow implementer | Assert `JSON.stringify`, reject naive echo, and prove special characters round-trip.                      |
| R-009   | OPS      | Skip output is hard to locate or hangs longer than expected.                                | C-009 and sibling skip patterns set timeout and typed output.                                                | 2           | 2      | 4     | P1       | Workflow implementer | Assert `timeout: 60000`, `output_type: trace-skipped`, and artifact path string.                          |
| R-010   | TECH     | PR tail is unreachable or reaches after the wrong TR branch.                                | C-010 and current YAML line 736 depends only on `tea-tr`.                                                    | 3           | 3      | 9     | P0       | Workflow implementer | Assert `create-pull-request` depends on both TR branches with `none_failed_min_one_success`.              |
| R-011   | TECH     | TR join drops one RV/NR branch or uses unsafe `all_done`.                                   | C-011 and AC1/AC4 require resolved contracts and fail-closed semantics.                                      | 2           | 3      | 6     | P1       | Workflow implementer | Keep existing four-way dependency assertions and trigger-rule assertion.                                  |
| R-012   | TECH     | Real RV/NR branch failure is masked and the tail runs.                                      | C-012 and executor `none_failed_min_one_success` semantics make this the critical gate behavior.             | 3           | 3      | 9     | P0       | Test architect       | Extend DAG failure proofs for real RV and NR failure with `tea-tr` and PR unreachable.                    |
| R-013   | TECH     | Tests still encode predecessor behavior or lose targeted regression checks.                 | C-013 and current contract lines 298-313 assert pre-story state.                                             | 3           | 2      | 6     | P1       | Test architect       | Invert TD-010 assertions and keep fail-closed assertions.                                                 |
| R-014   | OPS      | Additive scope guard undercounts new nodes.                                                 | C-014 and current TD-016 expects only RV/NR skip nodes.                                                      | 2           | 2      | 4     | P2       | Test architect       | Extend additive assertion to include `tea-tr-skipped`.                                                    |
| R-015   | TECH     | V1 baseline changes and rollback compatibility is lost.                                     | C-015 and architecture decision says v2 is additive.                                                         | 2           | 3      | 6     | P1       | Workflow implementer | Assert v1 has no TR skip node and keeps existing v1 wiring.                                               |
| R-016   | OPS      | Generated bundled defaults drift from YAML source.                                          | C-016 and project rules forbid hand-editing generated bundle.                                                | 2           | 3      | 6     | P1       | Workflow implementer | Run `bun run generate:bundled`, assert bundled source parity, and run `bun run check:bundled`.            |
| R-017   | OPS      | Bun `mock.module()` pollution causes flaky or misleading workflow tests.                    | C-017 and package script isolates the existing DAG file.                                                     | 2           | 3      | 6     | P1       | Test architect       | Avoid a new mock file or register it as a standalone package-script segment.                              |
| R-018   | TECH     | Implementation changes out-of-scope runtime or planner behavior.                            | C-018 and story explicitly says not to touch gate-planner, v1, core, or server.                              | 2           | 2      | 4     | P2       | Workflow implementer | Use file-scope guard and code review checklist.                                                           |
| R-019   | TECH     | Naming or forbidden identifier conventions regress.                                         | C-020 and project context set naming/test artifact constraints.                                              | 1           | 2      | 2     | P3       | Test architect       | Keep kebab-case assertion and forbidden identifier scan.                                                  |

### Highest-Risk Summary

P0 risks are R-001, R-002, R-004, R-006, R-010, and R-012.

These can break core workflow behavior, data integrity, compatibility, or cross-process contract behavior.

P1 risks are R-003, R-005, R-007, R-008, R-009, R-011, R-013, R-015, R-016, and R-017.

These require explicit scenarios and cannot be treated as implied coverage.

## Step 4: Coverage Plan & Execution Strategy

### Test Levels Used

Bun structural contract tests live in `packages/workflows/src/defaults/v2-tea-branches-contract.test.ts`.

Bun unit-level condition and trigger-rule proofs can live in the same contract test file when they do not use `mock.module()`.

Bun isolated DAG executor tests live in `packages/workflows/src/defaults/v2-tea-branches-dag.test.ts`.

Generated-default parity is validated through structural tests plus `bun run check:bundled`.

Browser E2E is not applicable because this story changes workflow DAG YAML and package tests, not a UI journey.

### Atomic Scenario Matrix

| Scenario ID | Priority | Level                               | Scenario                                                                                                                                                               | ACs           | Risks               | Reviewer concerns   | Evidence location                      |
| ----------- | -------- | ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------- | ------------------- | ------------------- | -------------------------------------- |
| TD-020      | P0       | Bun structural contract             | Assert `tea-tr.when` equals `$gate-planner.output.run_tr == true`.                                                                                                     | AC1, AC3      | R-001               | C-001               | `v2-tea-branches-contract.test.ts`     |
| TD-021      | P0       | Bun structural contract             | Assert `tea-tr.output_format` requires the full gate envelope and gate enum is exactly PASS, FAIL, CONCERNS, ERROR.                                                    | AC1, AC3      | R-006               | C-006               | `v2-tea-branches-contract.test.ts`     |
| TD-022      | P1       | Bun structural contract             | Assert `tea-tr.prompt_suffix` pins `$resolve-story-input.output.story_ref`.                                                                                            | AC1           | R-007               | C-007               | `v2-tea-branches-contract.test.ts`     |
| TD-023      | P0       | Bun structural contract             | Assert `tea-tr-skipped` exists as a bash node with inverse `when`, direct `depends_on: [gate-planner]`, and no prompt or command body.                                 | AC2, AC3      | R-002, R-003        | C-002, C-003        | `v2-tea-branches-contract.test.ts`     |
| TD-024      | P1       | Bun structural contract             | Assert `tea-tr-skipped` emits `gate:"SKIPPED"` with contract_version, workflow, node, story_ref, findings_count, and reason fields.                                    | AC2           | R-002, R-007        | C-002, C-007        | `v2-tea-branches-contract.test.ts`     |
| TD-025      | P1       | Bun unit proof                      | Prove the skip-contract encoder round-trips backslash, quote, newline, carriage return, and tab in story_ref or reason.                                                | AC2           | R-008               | C-008               | `v2-tea-branches-contract.test.ts`     |
| TD-026      | P1       | Bun structural contract             | Assert `tea-tr-skipped` has `timeout: 60000`, `output_type: trace-skipped`, and writes `tea-tr-skipped.gate.json` under the run artifact directory.                    | AC2           | R-009               | C-009               | `v2-tea-branches-contract.test.ts`     |
| TD-027      | P0       | Bun structural contract             | Assert `create-pull-request.depends_on` equals `['tea-tr', 'tea-tr-skipped']` and its trigger_rule is `none_failed_min_one_success`.                                   | AC2, AC4      | R-010               | C-010               | `v2-tea-branches-contract.test.ts`     |
| TD-028      | P1       | Bun structural contract             | Assert `parseWorkflow` passes for the edited v2 YAML with `when`, trigger_rule, output_format, and dependency usage.                                                   | AC3           | R-011               | C-011, C-019        | `v2-tea-branches-contract.test.ts`     |
| TD-029      | P0       | Bun unit proof                      | Prove `run_tr=true` makes real TR condition true and skip TR condition false, and `run_tr=false` does the inverse.                                                     | AC1, AC2      | R-004, R-005        | C-004, C-005        | `v2-tea-branches-contract.test.ts`     |
| TD-030      | P0       | Isolated Bun DAG executor           | Run the real gate-planner happy path and assert `tea-tr` completes, `tea-tr-skipped` is skipped, and `create-pull-request` is reached.                                 | AC1           | R-001, R-005, R-010 | C-001, C-005, C-010 | `v2-tea-branches-dag.test.ts`          |
| TD-031      | P0       | Isolated Bun DAG executor           | Force a schema-invalid real RV output and assert `tea-rv` fails, `tea-tr` does not complete, and PR is unreachable.                                                    | AC4           | R-012               | C-012               | `v2-tea-branches-dag.test.ts`          |
| TD-032      | P0       | Isolated Bun DAG executor           | Force a schema-invalid real NR output and assert `tea-nr` fails, `tea-tr` does not complete, and PR is unreachable.                                                    | AC4           | R-012               | C-012               | `v2-tea-branches-dag.test.ts`          |
| TD-033      | P1       | Isolated Bun DAG executor           | Force a schema-invalid real TR output and assert `tea-tr` fails and PR is unreachable.                                                                                 | AC1, AC4      | R-006, R-010        | C-006, C-010        | `v2-tea-branches-dag.test.ts`          |
| TD-034      | P0       | Bun unit trigger-rule proof         | Prove PR join semantics run when one TR-role branch completed and the sibling skipped, and skip when both TR-role branches are skipped or any completed branch failed. | AC2, AC4      | R-010, R-012        | C-010, C-012        | `v2-tea-branches-contract.test.ts`     |
| TD-035      | P1       | Bun structural contract             | Keep the existing four-way RV/NR dependency assertion for `tea-tr` and keep `none_failed_min_one_success`.                                                             | AC1, AC4      | R-011               | C-011               | `v2-tea-branches-contract.test.ts`     |
| TD-036      | P1       | Bun structural contract plus script | Assert bundled v2 content contains `tea-tr-skipped` and exactly matches the on-disk YAML, then run `bun run check:bundled`.                                            | AC5           | R-016               | C-016               | Contract test and validation command   |
| TD-037      | P1       | Bun structural contract             | Assert v1 baseline has no `tea-tr-skipped` and v2 additive scope includes the third new skip node.                                                                     | AC5           | R-014, R-015        | C-014, C-015        | `v2-tea-branches-contract.test.ts`     |
| TD-038      | P1       | Bun structural contract             | Invert predecessor TD-010 assertions so old pre-story expectations cannot survive.                                                                                     | AC1, AC2, AC5 | R-013               | C-013               | `v2-tea-branches-contract.test.ts`     |
| TD-039      | P1       | Bun structural contract             | Assert any DAG test file that uses `mock.module()` is registered as its own `bun test` segment.                                                                        | AC5           | R-017               | C-017               | `v2-tea-branches-contract.test.ts`     |
| TD-040      | P2       | Bun structural contract             | Assert `route_loop`, `gate-planner`, v1 workflow, core, and server behavior remain out of scope.                                                                       | AC5           | R-018               | C-018               | Existing TD-011 plus file-scope review |
| TD-041      | P3       | Bun structural contract             | Assert new node ids and output_type labels are kebab-case and forbidden plan identifiers are absent from generated tests.                                              | AC5           | R-019               | C-020               | Existing naming convention test        |

### Edge-Case Coverage Checklist

Happy path is covered by TD-030.

Negative path is covered by TD-031, TD-032, TD-033, and TD-034.

Boundary cases are covered by TD-029 for boolean branch boundaries and by existing RV/NR boundary tests that continue to prove mixed real/skip branch combinations.

Malformed input is covered by TD-025 and TD-033.

Stale data is covered by TD-022, TD-024, and TD-026 because story_ref and artifact paths must be deterministic.

Duplicate actions are covered by TD-029 because exactly one TR branch condition can pass per flag value.

Out-of-order events are covered by TD-023 and TD-027 because `tea-tr-skipped` resolves from `gate-planner` while PR waits on both TR-role siblings.

Partial failure is covered by TD-031, TD-032, TD-033, and TD-034.

Dependency failure is covered by TD-031 and TD-032.

Timeout is covered structurally by TD-026.

Rollback is covered by TD-037 and TD-040.

Regression is covered by TD-036, TD-037, TD-038, TD-039, TD-040, and TD-041.

Concurrency and race risk is covered by TD-039 because Bun mock isolation is the concurrency-sensitive test concern for this story.

Cancellation is waived for this story because the executor cancellation lifecycle is unchanged.

Cancellation waiver owner: workflow maintainer.

Cancellation residual risk: a pre-existing cancellation bug would not be detected by this story-specific suite.

Cancellation follow-up trigger: add cancellation coverage when this story changes executor cancellation, run cancellation, or node lifecycle mutation behavior.

Permission and auth are waived for this story because no adapter authorization, provider credential, token, or permission boundary changes are in scope.

Permission and auth waiver owner: workflow maintainer.

Permission and auth residual risk: unexpected permission expansion would only arise from out-of-scope changes, which TD-040 is designed to flag.

Permission and auth follow-up trigger: add auth coverage if implementation touches provider permissions, credentials, adapters, or protected API routes.

### Acceptance Criteria Trace

| AC  | Required coverage status                                                                               | Scenarios                                              |
| --- | ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------ |
| AC1 | Covered with atomic structural, unit, and DAG happy-path scenarios.                                    | TD-020, TD-021, TD-022, TD-029, TD-030, TD-035         |
| AC2 | Covered with atomic skip-node, encoder, artifact, condition, and PR join scenarios.                    | TD-023, TD-024, TD-025, TD-026, TD-027, TD-029, TD-034 |
| AC3 | Covered by parseWorkflow validation and story-specific field assertions.                               | TD-020, TD-021, TD-023, TD-027, TD-028                 |
| AC4 | Covered by fail-closed trigger-rule and DAG failure scenarios.                                         | TD-027, TD-031, TD-032, TD-033, TD-034, TD-035         |
| AC5 | Covered by bundle parity, v1 baseline, predecessor regression, isolation, scope, and naming scenarios. | TD-036, TD-037, TD-038, TD-039, TD-040, TD-041         |

### P0 and P1 Risk Trace

| Risk ID | Status  | Scenarios or waiver            |
| ------- | ------- | ------------------------------ |
| R-001   | Covered | TD-020, TD-030                 |
| R-002   | Covered | TD-023, TD-024, TD-029         |
| R-003   | Covered | TD-023                         |
| R-004   | Covered | TD-029                         |
| R-005   | Covered | TD-029, TD-030                 |
| R-006   | Covered | TD-021, TD-033                 |
| R-007   | Covered | TD-022, TD-024                 |
| R-008   | Covered | TD-025                         |
| R-009   | Covered | TD-026                         |
| R-010   | Covered | TD-027, TD-030, TD-033, TD-034 |
| R-011   | Covered | TD-028, TD-035                 |
| R-012   | Covered | TD-031, TD-032, TD-034         |
| R-013   | Covered | TD-038                         |
| R-015   | Covered | TD-037                         |
| R-016   | Covered | TD-036                         |
| R-017   | Covered | TD-039                         |

### Reviewer Concern Trace

| Concern ID | Status                       | Scenarios or waiver    |
| ---------- | ---------------------------- | ---------------------- |
| C-001      | Covered                      | TD-020, TD-030         |
| C-002      | Covered                      | TD-023, TD-024, TD-029 |
| C-003      | Covered                      | TD-023                 |
| C-004      | Covered                      | TD-029                 |
| C-005      | Covered                      | TD-029, TD-030         |
| C-006      | Covered                      | TD-021, TD-033         |
| C-007      | Covered                      | TD-022, TD-024         |
| C-008      | Covered                      | TD-025                 |
| C-009      | Covered                      | TD-026                 |
| C-010      | Covered                      | TD-027, TD-030, TD-034 |
| C-011      | Covered                      | TD-028, TD-035         |
| C-012      | Covered                      | TD-031, TD-032, TD-034 |
| C-013      | Covered                      | TD-038                 |
| C-014      | Covered                      | TD-037                 |
| C-015      | Covered                      | TD-037                 |
| C-016      | Covered                      | TD-036                 |
| C-017      | Covered                      | TD-039                 |
| C-018      | Covered                      | TD-040                 |
| C-019      | Covered as explicit non-risk | TD-028                 |
| C-020      | Covered                      | TD-041                 |

### NFR Coverage and Evidence

Reliability evidence comes from TD-029, TD-030, TD-031, TD-032, TD-033, and TD-034.

Maintainability evidence comes from TD-036, TD-037, TD-038, TD-039, TD-040, TD-041, `bun run check:bundled`, and `bun run validate`.

Compatibility evidence comes from TD-036 and TD-037.

Data integrity evidence comes from TD-021, TD-022, TD-024, TD-025, and TD-033.

Cross-process contract evidence comes from TD-021, TD-024, TD-030, TD-031, TD-032, and TD-033.

Security and performance final NFR assessment is not applicable unless implementation scope changes.

### Execution Strategy

PR gate should run `bun test packages/workflows/src/defaults/v2-tea-branches-contract.test.ts`.

PR gate should run `bun test packages/workflows/src/defaults/v2-tea-branches-dag.test.ts`.

PR gate should run `bun run check:bundled`.

Final pre-PR gate should run `bun run validate`.

Nightly and weekly suites do not need new scenarios for this story because no long-running performance, browser, or external-service coverage is introduced.

### Resource Estimate

P0 scenarios: about 6 to 10 engineering hours.

P1 scenarios: about 5 to 8 engineering hours.

P2 and P3 scenarios: about 1 to 3 engineering hours.

Total test implementation and validation effort: about 12 to 21 engineering hours.

### Quality Gates

P0 pass rate must be 100 percent.

P1 pass rate must be at least 95 percent, with no open P1 failure accepted without owner-approved waiver.

All P0 and P1 reviewer-concern mappings must remain explicit in the test names or assertion messages.

`bun run check:bundled` must pass after bundle generation.

`bun run validate` must pass before PR handoff.

## Step 5: Generate Outputs & Validate

Mode used: Epic-level create mode.

Execution mode: Sequential.

Output file: `_bmad-output/test-artifacts/test-design/test-design-a3-3-join-tr-as-final-gate.md`.

Validation performed: checked for unresolved template placeholders, required trace sections, P0/P1 risk mappings, reviewer concern mappings, and expected artifact location.

Completion status: completed.
