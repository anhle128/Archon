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
  - '_bmad-output/implementation-artifacts/a4-2-route-quality-loop-and-error-paths.md'
  - '_bmad-output/implementation-artifacts/sprint-status.yaml'
  - '_bmad-output/implementation-artifacts/a4-1-aggregate-quality-gate-summary.md'
  - '_bmad-output/implementation-artifacts/a3-3-join-tr-as-final-gate.md'
  - '_bmad-output/project-context.md'
  - '_bmad/tea/config.yaml'
  - '_bmad-output/planning-artifacts/architecture.md'
  - '_bmad-output/planning-artifacts/epics.md'
  - '_bmad-output/planning-artifacts/prd.md'
  - '_bmad-output/test-artifacts/test-design/test-design-a4-1-aggregate-quality-gate-summary.md'
  - '_bmad-output/test-artifacts/atdd-checklist-a4-1-aggregate-quality-gate-summary.md'
  - '.archon/workflows/defaults/bmad-dev-story-with-tea-fix-loop-v2.yml'
  - 'packages/workflows/package.json'
  - 'packages/workflows/src/defaults/v2-quality-summary-contract.test.ts'
  - 'packages/workflows/src/defaults/v2-quality-summary-dag.test.ts'
  - 'packages/workflows/src/defaults/v2-tr-join-contract.test.ts'
  - 'packages/workflows/src/schemas/route-loop.ts'
  - 'packages/workflows/src/schemas/dag-node.ts'
  - 'packages/workflows/src/loader.ts'
  - 'packages/workflows/src/route-loop-state.ts'
  - 'packages/workflows/src/dag-executor.ts'
  - '.agents/skills/bmad-testarch-test-design/resources/tea-index.csv'
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

Reason: The provided input is a story-level implementation artifact with explicit acceptance criteria, tasks, dev notes, known reviewer concerns, and validation expectations.

File-based detection also supports Epic-level mode because `_bmad-output/implementation-artifacts/sprint-status.yaml` exists.

Prerequisites: Available.

Primary requirements source: `_bmad-output/implementation-artifacts/a4-2-route-quality-loop-and-error-paths.md`.

Architecture context: Available through the story dev notes, `_bmad-output/project-context.md`, and referenced planning artifacts.

## Step 2: Load Context & Knowledge Base

Configuration loaded from `_bmad/tea/config.yaml`.

`tea_use_playwright_utils` is enabled.

`tea_use_pactjs_utils` is disabled.

`tea_pact_mcp` is `none`.

`tea_browser_automation` is `auto`.

`test_stack_type` is `auto`.

Detected project stack: fullstack Bun and TypeScript monorepo.

Detected story execution surface: backend workflow DAG YAML plus `@archon/workflows` Bun tests.

Browser exploration: skipped because the story has no browser target URL and no UI acceptance path.

The closest end-user path for this story is a real `executeDagWorkflow` fixture with real bash nodes and mocked provider nodes.

Existing test patterns loaded: co-located Bun structural contract tests with `parseWorkflow`, isolated Bun DAG executor tests for files using `mock.module()`, source-versus-bundle assertions, and v1 baseline preservation checks.

Current checkout evidence: `.archon/workflows/defaults/bmad-dev-story-with-tea-fix-loop-v2.yml` still contains `code-review-gate`, lacks `quality-gate-summary`, lacks `verify-quality-summary`, and has `create-pull-request` depending on `tea-tr`.

This confirms the story's Task 0 warning remains a P0 prerequisite for implementation and test execution.

Loaded TEA knowledge fragments cover risk scoring, probability and impact thresholds, test-level selection, priority mapping, NFR planning, route/contract integrity, Playwright CLI context, and API/backend utility patterns.

## Step 3: Testability & Risk Assessment

Scope: Epic-level risk assessment for one bounded `quality-route-loop` after `quality-gate-summary`.

Risk score uses probability 1-3 multiplied by impact 1-3.

Priority mapping follows the loaded TEA guidance, with score 9 as P0, score 6-8 as P1, score 4-5 as P2, and score 1-3 as P3 unless core behavior, compatibility, data integrity, or cross-process contracts require promotion.

### Testability Assessment

Controllability is strong because existing `@archon/workflows` tests already parse workflow YAML from disk, compare generated bundles, and drive `executeDagWorkflow` with real bash nodes and mocked provider nodes.

Controllability is blocked until the a3.3 and a4.1 prerequisites are present or deliberately folded into this story.

Observability is strong for structural assertions because node ids, `depends_on`, route targets, route-loop schemas, and bash bodies are visible in the YAML.

Observability must be added for exhaustion because `review-loop-error` currently only prints text from the old code-review loop path and does not write the requested machine-readable error artifact.

Reliability is strong when `mock.module()` DAG tests run as their own Bun invocation.

Reliability is weak if route-loop exhaustion, ERROR separation, stale summary contracts, or negative rerun behavior are only asserted by prose.

### Reviewer Concern Disposition

| Concern ID | Known concern treated as evidence                                                                                                  | Disposition              | Probability | Impact | Score | Priority | Rationale                                                                                                               |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------- | ------------------------ | ----------- | ------ | ----- | -------- | ----------------------------------------------------------------------------------------------------------------------- |
| C-001      | a3.3 and a4.1 baseline may be absent in this worktree.                                                                             | Risk R-001               | 3           | 3      | 9     | P0       | The route loop cannot be wired safely without `quality-gate-summary` and resolved TR contracts.                         |
| C-002      | Existing `code-review-gate` route loop must be removed.                                                                            | Risk R-002               | 3           | 3      | 9     | P0       | Two loops can create overlapping re-entry paths and split routing authority.                                            |
| C-003      | `gate-planner` must depend on `verify-story-identity`, not `code-review-gate`.                                                     | Risk R-002               | 2           | 3      | 6     | P1       | A stale dependency preserves the old loop authority.                                                                    |
| C-004      | `verify-quality-summary` is required because route-loop conditions cannot field-read bash JSON without `output_format.properties`. | Risk R-003               | 3           | 3      | 9     | P0       | A direct `$quality-gate-summary.output.gate` condition fails loader validation or bypasses the proven reader pattern.   |
| C-005      | The reader must parse whole summary output with `bun -e` and `JSON.parse`.                                                         | Risk R-004               | 3           | 3      | 9     | P0       | Substring parsing accepts malformed or misleading route contracts.                                                      |
| C-006      | The reader must validate `contract_version`, `workflow`, `node`, `story_ref`, and `gate`.                                          | Risk R-004               | 3           | 3      | 9     | P0       | Stale or wrong-producer contracts can route the wrong story.                                                            |
| C-007      | The reader must print only bare `PASS` or `FAIL` after validation.                                                                 | Risk R-005               | 2           | 3      | 6     | P1       | Extra stdout makes the route-loop comparison false or ambiguous.                                                        |
| C-008      | Summary `ERROR` must fail closed and never route to `dev-story`.                                                                   | Risk R-006               | 3           | 3      | 9     | P0       | Tooling or contract failure must not be treated as fixable quality work.                                                |
| C-009      | `quality-route-loop` must have exactly one `depends_on` equal to `from`.                                                           | Risk R-007               | 2           | 3      | 6     | P1       | Loader validation rejects invalid route-loop structure.                                                                 |
| C-010      | `quality-route-loop` must not declare `when`, `trigger_rule`, or `retry`.                                                          | Risk R-007               | 2           | 3      | 6     | P1       | Schema super-refinement rejects these fields on route-loop nodes.                                                       |
| C-011      | The route-loop condition must use bare `verify-quality-summary` output.                                                            | Risk R-008               | 2           | 3      | 6     | P1       | Wrong condition grammar can invert or block the PASS path.                                                              |
| C-012      | `FAIL` must reroute to `dev-story` and rerun the full dev-to-summary path with the same `story_ref`.                               | Risk R-009               | 2           | 3      | 6     | P1       | A partial rerun or identity drift breaks the core quality loop.                                                         |
| C-013      | `PASS` must route forward to the current tail seam.                                                                                | Risk R-010               | 2           | 3      | 6     | P1       | A bad positive route can skip PR handoff or target a nonexistent future node.                                           |
| C-014      | Exhaustion must route to `review-loop-error` after the budget is exceeded.                                                         | Risk R-011               | 3           | 3      | 9     | P0       | Off-by-one or wrong target can loop forever or create a PR after exhausted rework.                                      |
| C-015      | The 3-versus-20 loop budget ambiguity is unresolved.                                                                               | Risk R-012               | 2           | 2      | 4     | P1       | Wrong budget changes core loop behavior; priority is promoted from P2 to P1 because it affects fail-closed routing.     |
| C-016      | `review-loop-error` must record open findings, decision log, and round or iteration count.                                         | Risk R-013               | 2           | 3      | 6     | P1       | Without evidence, exhausted loops are not diagnosable or auditable.                                                     |
| C-017      | `review-loop-error` must exit non-zero and emit no route-facing gate or status.                                                    | Risk R-014               | 2           | 3      | 6     | P1       | A terminal error node must not be routable or appear successful.                                                        |
| C-018      | `create-pull-request` and `review-loop-error` must depend on `quality-route-loop`.                                                 | Risk R-015               | 2           | 3      | 6     | P1       | Tail nodes can bypass the route decision if dependencies are stale.                                                     |
| C-019      | Source workflow, generated bundle, and v1 baseline must remain consistent.                                                         | Risk R-016               | 2           | 3      | 6     | P1       | Drift breaks installed defaults or rollback compatibility.                                                              |
| C-020      | Contract and DAG tests must prove all four route outcomes.                                                                         | Risk R-017               | 3           | 3      | 9     | P0       | The riskiest behaviors are runtime route transitions, not just YAML shape.                                              |
| C-021      | The DAG test using `mock.module()` must run in its own Bun invocation.                                                             | Risk R-018               | 2           | 3      | 6     | P1       | Bun mock pollution causes order-dependent and misleading results.                                                       |
| C-022      | No forbidden plan, story, epic, or review-finding identifiers may enter tests.                                                     | Risk R-019               | 1           | 2      | 2     | P3       | This is project hygiene and maintainability, not route behavior.                                                        |
| C-023      | The old CR short-circuit removal increases AI cost.                                                                                | Explicit non-risk NR-001 | 2           | 1      | 2     | P3       | The architecture explicitly chooses one summary loop; compute cost is a tradeoff, not a quality-route correctness risk. |
| C-024      | `decision-needed-check` is not yet present, so PASS targets `create-pull-request` for this story.                                  | Explicit non-risk NR-002 | 1           | 2      | 2     | P3       | The story documents this as the a5.1 seam; targeting a nonexistent node would be the actual risk.                       |
| C-025      | Runtime engine changes are out of scope.                                                                                           | Risk R-020               | 1           | 3      | 3     | P3       | Touching executor or loader code would expand rollback risk unnecessarily.                                              |
| C-026      | Cancellation behavior is not changed by this YAML and bash-reader story.                                                           | Waiver W-002             | 1           | 2      | 2     | P3       | Existing lifecycle semantics are not modified; reopen if cancellation or node lifecycle code changes.                   |
| C-027      | Permission and auth behavior are not in scope.                                                                                     | Waiver W-003             | 1           | 3      | 3     | P3       | No credentials, adapters, protected routes, or user permissions should change.                                          |
| C-028      | Duplicate runs and stale route-loop counters could leak behavior across executions if metadata handling regresses.                 | Risk R-021               | 2           | 3      | 6     | P1       | Route-loop state is persisted in run metadata and must be isolated per run.                                             |

### Risk Register

| Risk ID | Category | Risk                                                                                                          | Probability | Impact | Score | Priority | Owner                | Mitigation                                                                                                        |
| ------- | -------- | ------------------------------------------------------------------------------------------------------------- | ----------- | ------ | ----- | -------- | -------------------- | ----------------------------------------------------------------------------------------------------------------- |
| R-001   | TECH     | The route-loop story starts from a checkout missing the a3.3 and a4.1 prerequisites.                          | 3           | 3      | 9     | P0       | Workflow implementer | Add a prerequisite structural test and block implementation until the baseline is merged or folded in explicitly. |
| R-002   | TECH     | Two routing authorities remain, with both old CR routing and new summary routing able to affect `dev-story`.  | 3           | 3      | 9     | P0       | Workflow implementer | Assert exactly one `route_loop` node and no `code-review-gate` references.                                        |
| R-003   | COMPAT   | The loop reads a field directly from a bash JSON node instead of using a verified reader node.                | 3           | 3      | 9     | P0       | Workflow implementer | Add `verify-quality-summary` and assert the condition references only its bare output.                            |
| R-004   | DATA     | The reader accepts malformed, stale, wrong-workflow, wrong-node, wrong-story, or invalid-gate summary output. | 3           | 3      | 9     | P0       | Workflow implementer | Validate envelope and identity with `JSON.parse` before any stdout route value.                                   |
| R-005   | DATA     | The reader emits extra text or newline-wrapped content that breaks the route-loop condition.                  | 2           | 3      | 6     | P1       | Workflow implementer | Assert exact stdout value `PASS` or `FAIL` from real bash execution.                                              |
| R-006   | DATA     | A summary or role `ERROR` is treated as a routable `FAIL` and returns to `dev-story`.                         | 3           | 3      | 9     | P0       | Workflow implementer | DAG fixture must prove summary failure prevents reader and route-loop evaluation.                                 |
| R-007   | COMPAT   | `quality-route-loop` violates schema or loader structure rules.                                               | 2           | 3      | 6     | P1       | Workflow implementer | Structural test must assert exact route-loop node shape and `parseWorkflow` success.                              |
| R-008   | TECH     | Route-loop condition is malformed or inverted.                                                                | 2           | 3      | 6     | P1       | Workflow implementer | Structural and DAG tests must prove PASS goes positive and FAIL goes negative.                                    |
| R-009   | TECH     | The FAIL back-edge does not rerun the whole dev-to-summary path or loses the stable `story_ref`.              | 2           | 3      | 6     | P1       | Workflow implementer | DAG fixture must assert provider call counts and same story identity across rounds.                               |
| R-010   | TECH     | PASS routes to a nonexistent future node or bypasses the current tail.                                        | 2           | 3      | 6     | P1       | Workflow implementer | Assert positive target is `create-pull-request` for this story and document a5.1 retargeting as follow-up.        |
| R-011   | TECH     | Exhaustion is off by one, loops forever, routes negative again, or reaches PR.                                | 3           | 3      | 9     | P0       | Workflow implementer | DAG fixture must drive max-plus-one FAIL decisions and assert `review-loop-error` only.                           |
| R-012   | BUS      | The loop budget ambiguity leads to the wrong quality-loop tolerance.                                          | 2           | 2      | 4     | P1       | Workflow maintainer  | Preserve 20 per story unless owner decides otherwise; assert the chosen value.                                    |
| R-013   | OPS      | Exhaustion evidence lacks findings pointer, decision log pointer, or round/iteration count.                   | 2           | 3      | 6     | P1       | Workflow implementer | Structural and DAG tests must assert stdout and best-effort JSON artifact content.                                |
| R-014   | TECH     | The exhausted target succeeds or emits a routable contract.                                                   | 2           | 3      | 6     | P1       | Workflow implementer | Assert `review-loop-error` exits non-zero and does not emit route-facing `gate` or `status`.                      |
| R-015   | TECH     | Tail nodes keep stale dependencies and bypass `quality-route-loop`.                                           | 2           | 3      | 6     | P1       | Workflow implementer | Structural test must assert exact dependencies for `create-pull-request` and `review-loop-error`.                 |
| R-016   | OPS      | Source workflow, generated bundle, package test script, or v1 baseline drift.                                 | 2           | 3      | 6     | P1       | Workflow implementer | Contract tests and `bun run check:bundled` must prove parity and rollback safety.                                 |
| R-017   | TECH     | Required route outcomes are only implied by structural tests.                                                 | 3           | 3      | 9     | P0       | Test architect       | Add isolated DAG scenarios for PASS, FAIL-then-PASS, ERROR, and exhaustion.                                       |
| R-018   | OPS      | `mock.module()` pollution makes workflow tests flaky or false-green.                                          | 2           | 3      | 6     | P1       | Test architect       | Assert package script runs the DAG test as a standalone segment.                                                  |
| R-019   | TECH     | Tests violate project naming and identifier hygiene rules.                                                    | 1           | 2      | 2     | P3       | Workflow implementer | Add a self-scan guard for forbidden identifiers and kebab-case runtime ids.                                       |
| R-020   | TECH     | Implementation touches executor, loader, core, server, or unrelated runtime code.                             | 1           | 3      | 3     | P3       | Workflow maintainer  | File-scope review must keep the change to YAML, generated bundle, tests, and package script.                      |
| R-021   | DATA     | Route-loop counters, route activations, or artifacts leak across duplicate or concurrent runs.                | 2           | 3      | 6     | P1       | Workflow implementer | Run two isolated DAG fixtures with distinct metadata and artifact dirs.                                           |

### NFR Planning

| NFR             | Scope                                                                                                                                    | Planned evidence                                                                                           | Risk link                         |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- | --------------------------------- |
| Reliability     | FAIL, PASS, ERROR, exhaustion, partial failure, dependency failure, duplicate run isolation, and fail-closed behavior.                   | Isolated real executor DAG tests.                                                                          | R-006, R-009, R-011, R-017, R-021 |
| Maintainability | Single routing authority, scoped file changes, stable package test isolation, generated bundle parity, and no forbidden identifiers.     | Structural contract tests, package script assertions, `bun run check:bundled`, and review file-scope gate. | R-002, R-016, R-018, R-019, R-020 |
| Compatibility   | V2 workflow parses under schema and DAG validation, route-loop loader constraints are respected, and v1 remains byte-for-byte unchanged. | `parseWorkflow`, source-versus-bundle assertions, and v1 baseline guard.                                   | R-003, R-007, R-016               |
| Data integrity  | Route-facing JSON accepts only the expected envelope and same `story_ref`; invalid or stale contracts do not route.                      | Bash-reader unit proof plus DAG ERROR and stale-data fixtures.                                             | R-004, R-005, R-006, R-021        |
| Security        | No auth, credential, token, webhook, or permission behavior is in scope.                                                                 | Waiver W-003 with reopen trigger.                                                                          | W-003                             |
| Performance     | No service runtime or user-facing latency threshold is specified.                                                                        | Timeout checks on bash nodes and budget assertion only.                                                    | R-012                             |
| Scalability     | No scaling threshold is specified for this YAML-only story.                                                                              | No dedicated scalability test; reopen if executor scheduling or shared state changes.                      | W-004                             |
| Compliance      | No compliance threshold is specified.                                                                                                    | Auditability covered through review-loop artifact and traceability output.                                 | R-013                             |

Highest risks: missing prerequisite baseline, duplicate route-loop authority, invalid reader contract handling, ERROR accidentally entering the fix loop, exhaustion off-by-one behavior, and insufficient DAG coverage.

## Step 4: Coverage Plan & Execution Strategy

Coverage uses structural Bun contract tests for YAML, schema, bundle, and package-script guarantees.

Coverage uses isolated Bun DAG executor tests for runtime routing, back-edge reruns, fail-closed ERROR paths, exhaustion, and artifact evidence.

Manual review gates are limited to file-scope and out-of-scope verification where automation would be brittle or fake.

### P0 Scenarios

| Test ID | Level                   | Scenario                                                                                                                                                                                                                           | Risk Link    | AC Link  |
| ------- | ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------ | -------- |
| TD-200  | Bun structural contract | Prerequisite baseline exists or is deliberately folded: resolved TR path, `quality-gate-summary`, and a4.1 summary contract are present before route-loop assertions execute.                                                      | R-001        | AC5, AC6 |
| TD-201  | Bun structural contract | Exactly one `route_loop` node exists and it is `quality-route-loop`; `code-review-gate` is absent and no node references it.                                                                                                       | R-002        | AC5      |
| TD-203  | Bun structural contract | `verify-quality-summary` exists as a deterministic bash node depending on `quality-gate-summary` and `resolve-story-input`, with bounded timeout and `output_type: quality-summary-verified`.                                      | R-003        | AC4, AC5 |
| TD-204  | Bun structural contract | `verify-quality-summary` reads `$quality-gate-summary.output` whole-output, uses `bun -e` plus `JSON.parse`, validates envelope and identity, and does not use field-level `$quality-gate-summary.output.gate`, `grep`, or `case`. | R-004        | AC4      |
| TD-207  | Isolated DAG executor   | Invalid `contract_version`, `workflow`, `node`, `story_ref`, malformed JSON, empty summary, or invalid gate causes `verify-quality-summary` to fail with no `PASS` or `FAIL` stdout.                                               | R-004, R-005 | AC4      |
| TD-224  | Isolated DAG executor   | `quality-gate-summary` hard-fails for an ERROR-source case, so `verify-quality-summary` does not complete, `quality-route-loop` cannot evaluate, `dev-story` is not rerun, and `create-pull-request` is not reached.               | R-006, R-017 | AC4      |
| TD-222  | Isolated DAG executor   | Persistent `FAIL` through the configured budget routes to `review-loop-error` on the max-plus-one decision, never reaches `create-pull-request`, and terminates non-zero.                                                          | R-011, R-017 | AC3      |
| TD-223  | Isolated DAG executor   | Exhaustion evidence includes open findings pointer, decision-log pointer, round or iteration count, and best-effort `review-loop-error.json`.                                                                                      | R-013        | AC3      |
| TD-235  | Isolated DAG executor   | `review-loop-error` exits non-zero and emits no route-facing `gate` or `status` contract.                                                                                                                                          | R-014        | AC3      |

### P1 Scenarios

| Test ID | Level                                                  | Scenario                                                                                                                                                                                                                           | Risk Link           | AC Link            |
| ------- | ------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------- | ------------------ |
| TD-202  | Bun structural contract                                | `gate-planner.depends_on` is exactly the retained identity barrier and not the removed route loop; no stale route target references remain.                                                                                        | R-002               | AC5                |
| TD-205  | Bun structural contract plus real bash technique proof | Valid summary JSON produces exact stdout `PASS` or exact stdout `FAIL`, with no extra prose.                                                                                                                                       | R-005               | AC1, AC2           |
| TD-208  | Bun structural contract                                | `quality-route-loop` has `depends_on: [verify-quality-summary]`, `from: verify-quality-summary`, condition `"$verify-quality-summary.output == 'PASS'"`, max budget value, and the exact positive, negative, and exhausted routes. | R-007, R-008, R-012 | AC1, AC2, AC3, AC5 |
| TD-209  | Bun structural contract                                | `quality-route-loop` has no `when`, `trigger_rule`, or `retry`, and `parseWorkflow` validates the edited DAG.                                                                                                                      | R-007               | AC5                |
| TD-210  | Bun structural contract and command                    | Source v2 workflow and `BUNDLED_WORKFLOWS` match after generation, `bun run check:bundled` passes, and the v1 baseline is byte-for-byte unchanged.                                                                                 | R-016               | AC5, AC6           |
| TD-211  | Bun structural contract                                | `v2-quality-route-loop-contract.test.ts` is registered in a non-mock batch, and `v2-quality-route-loop-dag.test.ts` runs as its own Bun invocation.                                                                                | R-018               | AC6                |
| TD-218  | Bun structural contract                                | `create-pull-request.depends_on` and `review-loop-error.depends_on` are both `[quality-route-loop]`.                                                                                                                               | R-015               | AC2, AC3           |
| TD-220  | Isolated DAG executor                                  | First-round `PASS` produces reader output `PASS`, routes positive to `create-pull-request`, does not rerun `dev-story`, and does not run `review-loop-error`.                                                                      | R-008, R-010, R-017 | AC2                |
| TD-221  | Isolated DAG executor                                  | First-round `FAIL` then second-round `PASS` reruns the full dev-to-summary path, calls `dev-story` twice, keeps the same `story_ref`, and then reaches `create-pull-request`.                                                      | R-009, R-017        | AC1                |
| TD-227  | Isolated DAG executor                                  | Dependency or partial upstream failure prevents summary or reader completion, prevents route-loop evaluation, and never reroutes to `dev-story`.                                                                                   | R-006, R-017        | AC4                |
| TD-229  | Isolated DAG executor                                  | Two separate route-loop runs with distinct metadata and artifact dirs do not share loop counters, route activations, or exhausted artifacts.                                                                                       | R-021               | AC1, AC3           |
| TD-230  | Bun structural contract                                | `verify-quality-summary` and `review-loop-error` declare bounded timeouts and no unbounded external runtime beyond local `bun -e` JSON parsing.                                                                                    | R-013               | AC3, AC4           |
| TD-233  | Bun structural contract                                | The chosen `max_iterations` value is asserted and documented as 20 unless the owner changes the story decision before implementation.                                                                                              | R-012               | AC3                |
| TD-234  | Bun structural contract                                | The PASS route targets `create-pull-request` in this story and does not target nonexistent `decision-needed-check`; the a5.1 retargeting seam is documented.                                                                       | R-010               | AC2                |

### P2 And P3 Scenarios

| Test ID | Priority | Level                   | Scenario                                                                                                                         | Risk Link |
| ------- | -------- | ----------------------- | -------------------------------------------------------------------------------------------------------------------------------- | --------- |
| TD-212  | P3       | Bun structural contract | New runtime ids and output types are kebab-case, and new tests avoid forbidden plan, story, epic, or review-finding identifiers. | R-019     |
| TD-232  | P3       | Review checklist        | File scope is limited to v2 YAML, generated bundled defaults, the two route-loop tests, and `packages/workflows/package.json`.   | R-020     |

### Acceptance Criteria Trace

| AC                                                                                            | Scenario Coverage                                              | Status  |
| --------------------------------------------------------------------------------------------- | -------------------------------------------------------------- | ------- |
| AC1 `FAIL` routes to `dev-story` and keeps the same `story_ref`.                              | TD-204, TD-205, TD-208, TD-209, TD-221, TD-229                 | Covered |
| AC2 `PASS` routes forward to the current tail seam.                                           | TD-205, TD-208, TD-218, TD-220, TD-234                         | Covered |
| AC3 Exhaustion routes to `review-loop-error`, records evidence, and exits non-zero.           | TD-208, TD-222, TD-223, TD-233, TD-235                         | Covered |
| AC4 `ERROR` fails closed and never reaches `dev-story`.                                       | TD-203, TD-204, TD-207, TD-224, TD-227                         | Covered |
| AC5 Edited v2 parses with one loop, old loop removed, gate-planner rewired, and v1 unchanged. | TD-200, TD-201, TD-202, TD-208, TD-209, TD-210, TD-218, TD-232 | Covered |
| AC6 Bundle parity and all four route outcomes are proven.                                     | TD-210, TD-211, TD-220, TD-221, TD-222, TD-224                 | Covered |

### High-Risk Trace

| Risk  | Status  | Scenario Or Waiver                     |
| ----- | ------- | -------------------------------------- |
| R-001 | Covered | TD-200                                 |
| R-002 | Covered | TD-201, TD-202                         |
| R-003 | Covered | TD-203, TD-204                         |
| R-004 | Covered | TD-204, TD-207                         |
| R-005 | Covered | TD-205, TD-207                         |
| R-006 | Covered | TD-224, TD-227                         |
| R-007 | Covered | TD-208, TD-209                         |
| R-008 | Covered | TD-208, TD-220, TD-221                 |
| R-009 | Covered | TD-221                                 |
| R-010 | Covered | TD-220, TD-234                         |
| R-011 | Covered | TD-222                                 |
| R-012 | Covered | TD-233                                 |
| R-013 | Covered | TD-223, TD-230                         |
| R-014 | Covered | TD-235                                 |
| R-015 | Covered | TD-218                                 |
| R-016 | Covered | TD-210                                 |
| R-017 | Covered | TD-220, TD-221, TD-222, TD-224, TD-227 |
| R-018 | Covered | TD-211                                 |
| R-021 | Covered | TD-229                                 |

### Reviewer Concern Trace

| Concern | Scenario, non-risk, or waiver                                                                                                |
| ------- | ---------------------------------------------------------------------------------------------------------------------------- |
| C-001   | TD-200                                                                                                                       |
| C-002   | TD-201                                                                                                                       |
| C-003   | TD-202                                                                                                                       |
| C-004   | TD-203, TD-204                                                                                                               |
| C-005   | TD-204, TD-207                                                                                                               |
| C-006   | TD-204, TD-207                                                                                                               |
| C-007   | TD-205, TD-207                                                                                                               |
| C-008   | TD-224, TD-227                                                                                                               |
| C-009   | TD-208, TD-209                                                                                                               |
| C-010   | TD-209                                                                                                                       |
| C-011   | TD-208, TD-220, TD-221                                                                                                       |
| C-012   | TD-221                                                                                                                       |
| C-013   | TD-220, TD-234                                                                                                               |
| C-014   | TD-222                                                                                                                       |
| C-015   | TD-233                                                                                                                       |
| C-016   | TD-223                                                                                                                       |
| C-017   | TD-235                                                                                                                       |
| C-018   | TD-218                                                                                                                       |
| C-019   | TD-210                                                                                                                       |
| C-020   | TD-220, TD-221, TD-222, TD-224                                                                                               |
| C-021   | TD-211                                                                                                                       |
| C-022   | TD-212                                                                                                                       |
| C-023   | Explicit non-risk NR-001 plus TD-201, because one-loop consolidation is the accepted architecture.                           |
| C-024   | Explicit non-risk NR-002 plus TD-234, because `decision-needed-check` is a future seam and not a valid target in this story. |
| C-025   | TD-232                                                                                                                       |
| C-026   | Waiver W-002                                                                                                                 |
| C-027   | Waiver W-003                                                                                                                 |
| C-028   | TD-229                                                                                                                       |

### Edge-Case Coverage

| Edge Category       | Coverage Or Waiver                            |
| ------------------- | --------------------------------------------- |
| Happy path          | TD-220                                        |
| Negative path       | TD-221, TD-222, TD-224, TD-227                |
| Boundary cases      | TD-207, TD-222, TD-233                        |
| Malformed input     | TD-207                                        |
| Stale data          | TD-207                                        |
| Duplicate actions   | TD-229                                        |
| Out-of-order events | TD-224, TD-227                                |
| Partial failure     | TD-227                                        |
| Dependency failure  | TD-227                                        |
| Timeout             | TD-230                                        |
| Cancellation        | W-002                                         |
| Concurrency or race | TD-211, TD-229                                |
| Rollback            | TD-210, TD-232                                |
| Permission or auth  | W-003                                         |
| Regression          | TD-200 through TD-212, TD-218, TD-232, TD-234 |

### Waivers

| Waiver ID | Subject                       | Reason                                                                                                           | Owner                      | Residual Risk                                                                        | Follow-Up Trigger                                                                                                                   |
| --------- | ----------------------------- | ---------------------------------------------------------------------------------------------------------------- | -------------------------- | ------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------- |
| W-002     | Cancellation behavior.        | Executor cancellation, pause, and lifecycle ownership are unchanged by this YAML and bash-reader story.          | Workflow maintainer        | Cancellation during route-loop rerun or error-artifact write is not newly exercised. | Reopen if the implementation touches executor cancellation, node lifecycle mutation, checkpoint reset, or artifact write ownership. |
| W-003     | Permission and auth behavior. | No auth, credential, adapter, provider credential delivery, webhook, or protected server route code is in scope. | Security or platform owner | A stray implementation change could introduce untested auth behavior.                | Reopen if the diff touches credentials, adapters, server auth routes, provider credential delivery, or permission checks.           |
| W-004     | Browser UI E2E.               | This is a backend workflow DAG change with no browser-visible workflow acceptance path.                          | Test architect             | A future web console visualization of the route loop is not exercised here.          | Reopen if a web or console surface renders route-loop state, review-loop-error artifacts, or quality summary decisions.             |
| W-005     | Load and performance testing. | No service runtime hot path, API endpoint, or user-facing latency threshold changes.                             | Workflow maintainer        | The reader bash could still hang if timeout is omitted.                              | TD-230 must pass, and performance coverage reopens if implementation adds long-running runtime work or shared scheduler changes.    |

### Execution Strategy

PR validation should run the focused contract test, the isolated DAG test, `bun run check:bundled`, and then `bun run validate`.

Nightly validation should run the normal package-isolated `bun run test` suite and report mock-isolation regressions.

Weekly validation is not required because there is no load, browser, or chaos suite for this YAML-only story.

### Resource Estimate

P0 coverage estimate: about 10 to 16 engineering hours.

P1 coverage estimate: about 8 to 14 engineering hours.

P2 and P3 coverage estimate: about 2 to 4 engineering hours.

Total estimate: about 20 to 34 engineering hours, with the higher end applying if the a3.3 and a4.1 baseline must be folded into this worktree first.

### Quality Gates

P0 scenario pass rate must be 100%.

P1 scenario pass rate must be at least 95%, and any exception requires an owner-approved waiver.

All score 6 or higher risks must have scenario coverage or an approved waiver before release.

Every acceptance criterion must trace to atomic scenarios before coverage is marked complete.

No P0 or P1 edge case may be counted as covered by implication.

`bun run check:bundled` must pass after regeneration.

`bun run validate` must pass before PR handoff.

Full NFR PASS, CONCERNS, or FAIL assessment is deferred to `nfr-assess` after implementation evidence exists.

## Step 5: Generate Output

Execution mode resolved to sequential.

Epic-level output written to `_bmad-output/test-artifacts/test-design/test-design-a4-2-route-quality-loop-and-error-paths.md`.

The output includes risk assessment, NFR planning, coverage matrix, acceptance-criterion trace, P0/P1 risk trace, reviewer concern trace, edge-case coverage, execution strategy, estimates, quality gates, waivers, and assumptions.

Checklist validation completed by inspection against `.agents/skills/bmad-testarch-test-design/checklist.md`.

No browser CLI sessions were opened, so there were no sessions to close.

Temporary and final artifacts were kept under `_bmad-output/test-artifacts/`.
