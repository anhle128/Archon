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
inputDocuments:
  - '_bmad-output/implementation-artifacts/3-3b-provide-archon-start-and-status-cli-json.md'
  - '_bmad-output/project-context.md'
  - '_bmad/tea/config.yaml'
  - '_bmad-output/planning-artifacts/prd.md'
  - '_bmad-output/planning-artifacts/architecture.md'
  - '_bmad-output/planning-artifacts/epics.md'
  - '_bmad-output/planning-artifacts/contracts/workflow-commander/README.md'
  - '_bmad-output/planning-artifacts/contracts/workflow-commander/schemas/workflow-command-envelope.schema.json'
  - '_bmad-output/planning-artifacts/contracts/workflow-commander/examples/providers/archon/commands/start-success.json'
  - '_bmad-output/planning-artifacts/contracts/workflow-commander/examples/providers/archon/commands/status-success.json'
  - '_bmad-output/planning-artifacts/contracts/workflow-commander/examples/providers/archon/commands/error-*.json'
  - '_bmad-output/planning-artifacts/contracts/workflow-commander/validate_contracts.py'
  - '_bmad-output/test-artifacts/test-design/test-design-3-3a-define-shared-workflow-provider-command-envelope.md'
  - '_bmad-output/test-artifacts/atdd-checklist-3-3a-define-shared-workflow-provider-command-envelope.md'
  - 'packages/cli/package.json'
  - 'packages/cli/src/cli.ts'
  - 'packages/cli/src/adapters/cli-adapter.ts'
  - 'packages/cli/src/adapters/cli-adapter.test.ts'
  - 'packages/cli/src/commands/workflow.ts'
  - 'packages/cli/src/commands/workflow.test.ts'
  - 'packages/cli/src/commands/workflow-provider-command-envelope.ts'
  - 'packages/cli/src/commands/workflow-provider-command-envelope.test.ts'
  - 'packages/cli/src/commands/provider-binding.ts'
  - 'packages/cli/src/commands/provider-binding-contract.test.ts'
  - 'packages/cli/src/commands/provider-binding.e2e.test.ts'
  - '.agents/skills/bmad-testarch-test-design/resources/tea-index.csv'
  - '.agents/skills/bmad-testarch-test-design/resources/knowledge/risk-governance.md'
  - '.agents/skills/bmad-testarch-test-design/resources/knowledge/probability-impact.md'
  - '.agents/skills/bmad-testarch-test-design/resources/knowledge/test-levels-framework.md'
  - '.agents/skills/bmad-testarch-test-design/resources/knowledge/test-priorities-matrix.md'
  - '.agents/skills/bmad-testarch-test-design/resources/knowledge/nfr-criteria.md'
  - '.agents/skills/bmad-testarch-test-design/resources/knowledge/contract-testing.md'
  - '.agents/skills/bmad-testarch-test-design/resources/knowledge/overview.md'
  - '.agents/skills/bmad-testarch-test-design/resources/knowledge/api-request.md'
  - '.agents/skills/bmad-testarch-test-design/resources/knowledge/auth-session.md'
  - '.agents/skills/bmad-testarch-test-design/resources/knowledge/recurse.md'
  - '.agents/skills/bmad-testarch-test-design/resources/knowledge/playwright-cli.md'
outputDocument: '_bmad-output/test-artifacts/test-design/test-design-3-3b-provide-archon-start-and-status-cli-json.md'
---

# Test Design Progress: 3.3b Provide Archon Start And Status CLI JSON

## Step 1: Detect Mode

Mode selected: Epic-Level.

Reason: the supplied implementation artifact is a story-level handoff with explicit acceptance criteria, implementation tasks, scope boundaries, dev notes, and testing requirements for one focused CLI contract story.

Prerequisite result: PASS - `_bmad-output/implementation-artifacts/3-3b-provide-archon-start-and-status-cli-json.md` exists and provides the required story requirements and acceptance criteria; architecture and contract context will be loaded in Step 2.

## Step 2: Load Context

Configuration loaded: Playwright utils enabled; Pact.js utils disabled; Pact MCP disabled; browser automation `auto`; test stack `auto`; risk threshold `p1`; test artifacts rooted at `_bmad-output/test-artifacts`.

Detected project stack: fullstack Bun + strict TypeScript monorepo. Story-local executable scope is headless CLI JSON over existing workflow commands; there is no HTTP route, Web UI, browser journey, or database migration in scope.

Loaded requirements and architecture: Story 3.3b, PRD FR-8, Epic 3.3b, Architecture AD-2/3/6/7/8/9, Provider Command Syntax Baseline, Workflow Commander contract README, command-envelope schema, start/status/error fixtures, and prior Story 3.3a test design/ATDD handoff.

Canonical contract validation: PASS - `validate_contracts.py` validated 7 schemas, 17 command examples, 13 binding examples, 7 delivery examples, 6 generic event examples, 7 provider event examples, 9 callback rejection examples, and 6 materialization examples.

Testable requirements extracted: foreground `workflow run --json` emits one `workflow.start` envelope; `workflow get --json` emits one `workflow.status` envelope; both success and failure paths carry schema version, correlation id, machine-readable result/error, classified exit code, redacted execution metadata, and no human/progress text on stdout.

Integration points: CLI argv parsing and dispatch, workflow discovery, conversation/message persistence, codebase lookup/auto-registration, isolation/worktree creation, `executeWorkflow`, persisted workflow-run readback, workflow event lookup for verbose status, `CLIAdapter.sendMessage()`, shared envelope builder, and package-isolated Bun tests.

Existing test patterns: `workflow.test.ts` uses `mock.module()` and runs in its own package invocation; `workflowGetCommand` currently asserts legacy raw JSON; detach tests assert `--detach --json` legacy ack and must remain unchanged; `provider-binding-contract.test.ts` runs the canonical validator; `provider-binding.e2e.test.ts` demonstrates real subprocess JSON-purity checks.

Known coverage gaps for this story: no current state-mapping helper tests, no foreground `workflow run --json` envelope tests, no `workflow get --json` envelope/exit-code tests, no CLI-dispatch tests for missing positionals/bad flags under `--json`, and no workflow-command-specific forbidden-key contract test.

Browser exploration: not applicable. `playwright-cli` is unavailable, the story has no browser/UI target, and repository searches found no `page.goto`/`page.locator` usage. The API-only Playwright knowledge profile was loaded for workflow compliance; the selected execution pattern remains Bun unit/contract/subprocess tests.

## Step 3: Risk And Testability

Risk scale: Probability and Impact use 1 low, 2 medium, 3 high; score is P x I. Scores 6-8 require mitigation and score 9 blocks release until mitigated or formally waived. Priority is promoted to P0/P1 when failure can break core workflow behavior, security, data integrity, compatibility, or cross-process controller contracts.

### Risk Register

| ID         | Category   | Risk                                                                                                                                                                                 |   P |   I | Score | Priority | Mitigation and evidence                                                                                                                                                | Owner / timeline                                                      |
| ---------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --: | --: | ----: | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| 3.3B-R-001 | TECH / BUS | `workflow.start` or `workflow.status` output drifts from the closed command-envelope schema, including missing `workflowRunRef` on success or result/error exclusivity violations.   |   3 |   3 |     9 | P0       | Exact envelope tests, parsed JSON Schema fixture regression, canonical validator, and forbidden top-level key checks.                                                  | CLI implementer + contract reviewer / Tasks 1-4                       |
| 3.3B-R-002 | BUS / OPS  | Foreground `workflow run --json` writes human/progress/assistant text, multiple JSON documents, or malformed stdout before/after the envelope.                                       |   3 |   3 |     9 | P0       | Raw stdout capture, exactly-one-line assertions, CLIAdapter silent-mode tests, and negative assertions for known human strings.                                        | CLI implementer / Task 1 and Task 4                                   |
| 3.3B-R-003 | BUS / OPS  | CLI dispatch prevalidation handles missing positionals or bad flag combinations before JSON mode reaches the command handler, producing usage text instead of `MALFORMED_REQUEST`.   |   3 |   3 |     9 | P0       | Subprocess/dispatch tests for missing workflow name, missing run id, `--branch + --no-worktree`, `--from + --no-worktree`, and `--resume + --branch`.                  | CLI implementer / Task 1-2                                            |
| 3.3B-R-004 | BUS / OPS  | Early foreground start failures escape to `cli.ts` plain-text catch instead of the fail-closed envelope boundary.                                                                    |   3 |   3 |     9 | P0       | Fault-inject unknown workflow, YAML load error, DB/codebase lookup failure, worktree failure, conversation update failure, and executeWorkflow throw.                  | CLI implementer / Task 1                                              |
| 3.3B-R-005 | BUS / DATA | `workflow get --json` keeps emitting legacy `{ ok:false }` or raw `WorkflowRun` rows and leaks DB error text.                                                                        |   3 |   3 |     9 | P0       | Replace with `workflow.status` envelopes; assert exit codes 0/70/78, no raw `err.message` in `details`, and verbose events under `result.events`.                      | CLI implementer / Task 2                                              |
| 3.3B-R-006 | BUS / DATA | Contract-facing state mapping is wrong, especially paused approval gates versus interactive-loop pauses or malformed approval metadata.                                              |   3 |   3 |     9 | P0       | Direct mapping-helper unit tests for all six statuses plus paused approval, paused interactive loop, absent/malformed approval, and terminal boolean.                  | CLI implementer + workflow owner / Task 3                             |
| 3.3B-R-007 | DATA / BUS | Success envelopes use stale or inferred run data instead of reloading the persisted `WorkflowRun`, producing wrong status, workflow name, approval metadata, or projectRef.          |   2 |   3 |     6 | P1       | Fetch persisted run after successful execution; fault-inject missing/failed read as `INTERNAL_ERROR`; verify optional `projectRef` behavior.                           | CLI implementer / Task 1                                              |
| 3.3B-R-008 | BUS / SEC  | Failed execution includes raw `result.error`, stderr/stdout, or other prose diagnostics in envelope details.                                                                         |   2 |   3 |     6 | P0       | Assert structured details only, recursive forbidden text-key scan, redacted execution metadata, and logger-only raw diagnostic handling.                               | CLI implementer + security reviewer / Task 1 and Task 4               |
| 3.3B-R-009 | BUS / OPS  | Error code/category/retryable/exit-code classification is unstable across malformed input, unknown workflow, DB failure, worktree failure, timeout, and unexpected workflow failure. |   2 |   3 |     6 | P1       | Table-driven classification tests mirroring provider-binding conventions: 64, 69, 70, 78 and `provider_contract`/`timeout`/`implementation_defect`/`unexpected_state`. | CLI implementer / Task 1-2                                            |
| 3.3B-R-010 | BUS        | `--correlation-id` is not threaded through `workflow run/get`, is regenerated inconsistently, or blanks are mishandled.                                                              |   2 |   3 |     6 | P1       | Fixed correlation id tests at command and dispatcher levels; blank id fallback tests via shared helper behavior.                                                       | CLI implementer / Task 1-2                                            |
| 3.3B-R-011 | TECH / BUS | Non-JSON workflow behavior or the existing `--detach --json` ack changes while adding foreground envelopes.                                                                          |   2 |   3 |     6 | P1       | Regression tests for existing human messages, detach tests unchanged, file-scope review that detach branch remains legacy and out of scope.                            | CLI implementer + reviewer / every task                               |
| 3.3B-R-012 | DATA / UX  | Silencing `CLIAdapter` for JSON mode also suppresses DB message persistence, breaking Web UI history/result cards.                                                                   |   2 |   3 |     6 | P1       | Adapter unit test for `silent: true`: no stdout, `addMessage` still called with workflow metadata.                                                                     | CLI implementer / Task 1                                              |
| 3.3B-R-013 | OPS / DATA | Verbose status events are omitted, placed at the wrong level, returned after dependency failure as false success, or become order/shape incompatible.                                |   2 |   3 |     6 | P1       | `workflow get --json --verbose` tests for `result.events`, fallback behavior when event lookup fails, and preservation of existing event summary data.                 | CLI implementer / Task 2                                              |
| 3.3B-R-014 | BUS / TECH | Fixture deltas for `phase` and `projectBindingRef` are hidden by weak tests or papered over with fake values.                                                                        |   2 |   3 |     6 | P1       | Assert the story-owned fields, document the intentional delta in completion notes, and waive byte-for-byte parity for out-of-scope Hermes concepts.                    | Story owner + contract reviewer / Task 4                              |
| 3.3B-R-015 | BUS / OPS  | Blocking `workflow run --json` semantics return terminal/paused state after execution, while consumers may expect an asynchronous running reference like `start-success.json`.       |   2 |   3 |     6 | P1       | Explicit waiver/follow-up trigger; tests assert the implemented blocking contract so the mismatch is visible rather than accidental.                                   | Product + architecture owners / before production consumer dependency |
| 3.3B-R-016 | SEC / BUS  | Forbidden `actor`, `profile`, `agent_name`, `agent`, `agent_provider`, `message`, `stdout`, `stderr`, or display-text keys appear in emitted envelopes.                              |   2 |   3 |     6 | P0       | Parsed-envelope recursive forbidden-key tests and contract helper payload tests; avoid broad regex over all `workflow.ts`.                                             | Security reviewer + CLI implementer / Task 4                          |
| 3.3B-R-017 | TECH / OPS | `mock.module()` pollution or misplaced new test files make the suite order-dependent or incompatible with package-isolated CI.                                                       |   3 |   2 |     6 | P1       | Keep `workflow.test.ts` in its existing isolated invocation; add non-mocking contract tests only to existing non-mocking batch or isolate if mocks differ.             | Test implementer / Task 4                                             |
| 3.3B-R-018 | OPS        | Timeout and cancellation behavior for a long-running foreground command remains ambiguous; process-level kills can bypass the envelope entirely.                                     |   2 |   3 |     6 | P1       | Cover timeout-message classification and command-level rejected promises; waive OS-level kill/abort guarantee until a runtime timeout/abort contract exists.           | CLI architecture owner / follow-up policy story                       |
| 3.3B-R-019 | DATA / OPS | Concurrent or duplicate JSON starts with shared cwd/conversation/branch produce conflicting worktrees, mixed message persistence, or non-deterministic run refs.                     |   2 |   3 |     6 | P1       | Regression coverage for explicit branch reuse/failure behavior and shared conversation id; rely on existing worktree/git guardrails, no autonomous lifecycle mutation. | CLI + isolation owners / Task 4                                       |
| 3.3B-R-020 | OPS / TECH | Partial landing across `cli.ts`, `workflow.ts`, adapter, and tests leaves JSON command families inconsistent or hard to roll back.                                                   |   2 |   3 |     6 | P1       | Small scoped patch, no contract edits, no shared builder behavior changes, focused checks before full `bun run validate`, rollback by reverting touched files.         | Story owner / every task                                              |

### Reviewer-Evidence Disposition

| Concern                                                                                                                     | Evidence disposition                                                                                              |   P |   I | Score | Scenario or waiver                          |
| --------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- | --: | --: | ----: | ------------------------------------------- |
| RC-01: Shared builder from 3.3a exists and should not be modified.                                                          | Risk if runtime changes alter baseline builder behavior.                                                          |   2 |   3 |     6 | 3.3B-CONTRACT-037; R-016                    |
| RC-02: Contract package is source of truth and must not be edited.                                                          | Risk if fixtures/schema are rewritten to match implementation.                                                    |   2 |   3 |     6 | 3.3B-CONTRACT-038; R-001                    |
| RC-03: Top-level envelope fields are fixed and schema is closed.                                                            | Critical compatibility risk.                                                                                      |   3 |   3 |     9 | 3.3B-UNIT-001/020/030; R-001                |
| RC-04: Failure envelopes omit `workflowRunRef` by default even when a run id may be known.                                  | Risk if failure shape violates established convention.                                                            |   2 |   3 |     6 | 3.3B-UNIT-011/018/026; R-001/R-008          |
| RC-05: Foreground `workflow run --json` must emit exactly one envelope and no human/progress/assistant stdout.              | Critical controller parse risk.                                                                                   |   3 |   3 |     9 | 3.3B-UNIT-015; 3.3B-CLI-031; R-002          |
| RC-06: `quiet` is not sufficient; adapter stdout must be silenced while persistence remains.                                | Data and stdout-purity risk.                                                                                      |   2 |   3 |     6 | 3.3B-UNIT-014/015; R-012                    |
| RC-07: `--detach --json` ack is outside scope and must remain unchanged.                                                    | Regression risk; not part of provider-command surface.                                                            |   2 |   3 |     6 | 3.3B-REG-041; W-3.3B-001                    |
| RC-08: Non-JSON behavior must remain byte-for-byte compatible.                                                              | Regression risk for existing CLI users.                                                                           |   2 |   3 |     6 | 3.3B-REG-040; R-011                         |
| RC-09: CLI prevalidation must not short-circuit JSON malformed requests.                                                    | Critical fail-closed risk.                                                                                        |   3 |   3 |     9 | 3.3B-CLI-032/033; R-003                     |
| RC-10: Missing `workflow run` name and missing `workflow get` run id need JSON envelopes under `--json`.                    | Critical fail-closed risk.                                                                                        |   3 |   3 |     9 | 3.3B-CLI-032/033; R-003                     |
| RC-11: `workflow get --json` must stop emitting raw rows and legacy `{ok:false}`.                                           | Critical compatibility risk.                                                                                      |   3 |   3 |     9 | 3.3B-UNIT-020-026; R-005                    |
| RC-12: DB errors and execution failures must not leak raw diagnostic strings into `details`.                                | Security/contract risk.                                                                                           |   2 |   3 |     6 | 3.3B-UNIT-009/023; 3.3B-CONTRACT-035; R-008 |
| RC-13: `executeWorkflow` failures may omit `workflowRunId`.                                                                 | Partial-failure risk; cannot assume run ref.                                                                      |   2 |   3 |     6 | 3.3B-UNIT-011/012; R-008                    |
| RC-14: Persisted run must be fetched after successful execution.                                                            | Stale-data risk.                                                                                                  |   2 |   3 |     6 | 3.3B-UNIT-007/008/010; R-007                |
| RC-15: Persisted run fetch failure after accepted execution must return `INTERNAL_ERROR` with structured details.           | Partial-failure risk.                                                                                             |   2 |   3 |     6 | 3.3B-UNIT-010; R-007                        |
| RC-16: State mapping must distinguish approval gate, interactive loop, malformed approval, and all terminal statuses.       | Critical status compatibility risk.                                                                               |   3 |   3 |     9 | 3.3B-UNIT-002-006/021; R-006                |
| RC-17: `phase` and `projectBindingRef` fixture fields are out of scope; do not invent fake values.                          | Risk if tests either fake unsupported data or ignore the delta.                                                   |   2 |   3 |     6 | 3.3B-CONTRACT-036; W-3.3B-002; R-014        |
| RC-18: Blocking start behavior may not satisfy an async-start consumer expectation.                                         | Product/contract ambiguity risk, not implementation permission to expand scope.                                   |   2 |   3 |     6 | 3.3B-UNIT-007/013; W-3.3B-003; R-015        |
| RC-19: `--correlation-id` is registered globally but not wired into run/get today.                                          | Metadata traceability risk.                                                                                       |   2 |   3 |     6 | 3.3B-UNIT-016/024; 3.3B-CLI-034; R-010      |
| RC-20: `projectRef` is optional when no codebase resolves and must be `project:<codebase_id>` when present.                 | Identity compatibility risk.                                                                                      |   2 |   3 |     6 | 3.3B-UNIT-008/022; R-007                    |
| RC-21: `bindingRef`/`projectBindingRef` is not generally applicable to generic Archon workflow runs.                        | Explicit non-risk under current story scope; top-level `bindingRef` remains omitted unless a real binding exists. |   1 |   3 |     3 | W-3.3B-004                                  |
| RC-22: Verbose status events move under `result.events` only when verbose.                                                  | Regression/shape risk.                                                                                            |   2 |   3 |     6 | 3.3B-UNIT-025; R-013                        |
| RC-23: Contract test should inspect parsed emitted envelopes or narrow payload helpers, not raw-regex all of `workflow.ts`. | Risk of brittle/weak security tests.                                                                              |   2 |   3 |     6 | 3.3B-CONTRACT-035; R-016                    |
| RC-24: Test isolation must respect existing `workflow.test.ts` mock pollution boundary.                                     | Test reliability risk.                                                                                            |   3 |   2 |     6 | 3.3B-CI-042; R-017                          |
| RC-25: HTTP/Web UI/workflow event/delivery/Hermes behavior are excluded.                                                    | Explicit non-risk if scope stays clean.                                                                           |   1 |   2 |     2 | W-3.3B-005                                  |
| RC-26: Runtime timeout/cancellation policy is not fully defined by this story.                                              | Operational risk requiring waiver for OS-level abort guarantees.                                                  |   2 |   3 |     6 | 3.3B-UNIT-017/029; W-3.3B-006; R-018        |
| RC-27: Canonical validator must pass unchanged before sign-off.                                                             | Risk if local contracts drift.                                                                                    |   2 |   3 |     6 | 3.3B-CONTRACT-038; R-001                    |

### NFR Planning

| NFR                         | In scope / threshold                                                                                                                                                    | Planned evidence                                                                                           |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Security                    | In scope. No raw stdout/stderr/message diagnostics in machine-readable details; no forbidden Hermes/actor/profile/agent keys; execution metadata redacts stdout/stderr. | Parsed-envelope recursive scan, fault-injected failure tests, canonical validator.                         |
| Reliability                 | In scope. Every JSON path returns one parseable envelope with stable exit code; dependency and partial failures fail closed.                                            | Command unit tests, subprocess tests, DB/event/workflow fault injection.                                   |
| Data integrity              | In scope. Status reflects persisted workflow run state; JSON wrapping must not corrupt conversation/message persistence or mutate detach behavior.                      | Persisted-run readback tests, CLIAdapter persistence tests, detach regression tests.                       |
| Cross-process compatibility | In scope. Envelopes use `workflow-command-envelope.v1`, canonical command ids, stable error categories, correct refs, and narrow fixture deltas.                        | Schema/fixture comparisons, forbidden-key tests, `validate_contracts.py`.                                  |
| Maintainability             | In scope. Strict TypeScript, no contract-package edits, no production planning-artifact imports, existing mock isolation preserved.                                     | `bun --filter @archon/cli type-check`, package-script review, import/dependency scans, `bun run validate`. |
| Performance / scalability   | UNKNOWN. No latency/load threshold exists; foreground `workflow run` intentionally blocks until terminal or paused.                                                     | W-3.3B-003 and W-3.3B-006; no invented SLO.                                                                |
| Permission / authorization  | No new remote surface or app-level role policy; command inherits local OS-process trust.                                                                                | W-3.3B-007; scope review that no server/web control path is added.                                         |
| Compliance                  | No regulatory requirement stated. Contract traceability is project-specific quality evidence, not a compliance claim.                                                   | Traceability tables and validator output.                                                                  |

### Highest-Priority Findings

P0 blockers are R-001 through R-006, R-008, and R-016: envelope schema conformance, stdout purity, CLI fail-closed dispatch, foreground start error containment, `workflow get --json` conversion, state mapping, raw diagnostic suppression, and forbidden-key leakage.

No high-risk item is considered covered by a happy path. Every score >= 6 item requires a P0/P1 scenario in Step 4 or an explicit waiver.

## Step 4: Coverage Plan And Execution Strategy

### Test-Level Allocation

- Unit / command unit: `packages/cli/src/commands/workflow.test.ts` for state mapping, command return codes, command envelopes, dependency failures, and mocked workflow execution outcomes.
- Adapter unit: `packages/cli/src/adapters/cli-adapter.test.ts` for JSON-mode stdout silence with DB persistence preserved.
- Contract/static: existing `workflow-provider-command-envelope.test.ts` and a workflow-command contract test for schema fixture conformance, forbidden keys, no contract edits, and no production planning-artifact imports.
- CLI subprocess integration: a narrow `Bun.spawn` harness, following `provider-binding.e2e.test.ts`, for argv dispatch, missing positionals, bad flag combinations, exact stdout/stderr, and process exit code.
- CI gates: focused Bun tests, contract validator, `bun --filter @archon/cli type-check`, and `bun run validate`.

No browser, component, API-route, Pact, k6, or Web E2E layer applies. Duplicate coverage is allowed only when one test proves command internals and another proves the process/argv boundary.

### Atomic Scenario Catalog

| ID                | Pri | Level           | Atomic scenario                                                                                                                                                                                                                                    | Trace                                |
| ----------------- | --- | --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------ |
| 3.3B-UNIT-001     | P0  | Command unit    | `workflowRunCommand(..., { json:true })` emits a `workflow.start` success envelope for a completed persisted run: schema version, command, correlation id, workflowRunRef, `result.operation=start`, `accepted=true`, `terminal=true`, no `error`. | AC1, R-001, R-007, RC-03             |
| 3.3B-UNIT-002     | P0  | Unit            | State mapper maps `pending` to `{ state:'pending', terminal:false }`.                                                                                                                                                                              | AC1, AC2, R-006, RC-16               |
| 3.3B-UNIT-003     | P0  | Unit            | State mapper maps `running` to `{ state:'running', terminal:false }`.                                                                                                                                                                              | AC1, AC2, R-006, RC-16               |
| 3.3B-UNIT-004     | P0  | Unit            | State mapper maps paused approval context to `waiting-for-approval`, `actionRequired:true`, and `gateRef:{ gateId: nodeId, kind:'human-decision' }`.                                                                                               | AC1, AC2, R-006, RC-16               |
| 3.3B-UNIT-005     | P0  | Unit            | State mapper maps paused `interactive_loop` approval context to `paused` with no human-decision gateRef.                                                                                                                                           | AC1, AC2, R-006, RC-16               |
| 3.3B-UNIT-006     | P0  | Unit            | State mapper maps paused absent or malformed approval context to `paused` with no actionRequired.                                                                                                                                                  | AC1, AC2, R-006, RC-16               |
| 3.3B-UNIT-007     | P0  | Unit            | State mapper maps `completed`, `failed`, and `cancelled` to terminal states without inventing `phase`.                                                                                                                                             | AC1, AC2, R-006, R-014, RC-16, RC-17 |
| 3.3B-UNIT-008     | P1  | Command unit    | `workflowRunRef.projectRef` is `project:<codebase_id>` when a persisted run has `codebase_id`, and is omitted when absent.                                                                                                                         | AC1, R-007, RC-20                    |
| 3.3B-UNIT-009     | P0  | Command unit    | Foreground start failed execution with `workflowRunId` emits `WORKFLOW_EXECUTION_FAILED`/`unexpected_state`/retryable true/details `{ runId }`, no workflowRunRef, and no raw `result.error`.                                                      | AC3, R-008, RC-04, RC-12, RC-13      |
| 3.3B-UNIT-010     | P0  | Command unit    | Foreground start failed execution without `workflowRunId` emits `INTERNAL_ERROR`/`implementation_defect`/retryable true/details `{ requestAccepted:false }`, no raw `result.error`.                                                                | AC3, R-008, RC-13                    |
| 3.3B-UNIT-011     | P1  | Command unit    | Accepted execution whose persisted run cannot be reloaded emits `INTERNAL_ERROR` with details `{ runId }` and exit 70.                                                                                                                             | AC1, AC3, R-007, RC-14, RC-15        |
| 3.3B-UNIT-012     | P0  | Command unit    | Early unknown workflow/load error under `--json` is caught by fail-closed boundary and emits `WORKFLOW_NOT_FOUND` or a classified implementation envelope, never plain text.                                                                       | AC3, R-004, R-009, RC-09             |
| 3.3B-UNIT-013     | P1  | Command unit    | Blocking start semantics are explicit: success envelope reports the persisted terminal/paused state after `executeWorkflow` resolves, not a fake async `running` state.                                                                            | AC1, R-015, RC-18, W-3.3B-003        |
| 3.3B-UNIT-014     | P1  | Adapter unit    | `new CLIAdapter({ silent:true })` suppresses `console.log` but still persists assistant message content and workflow metadata.                                                                                                                     | AC1, R-002, R-012, RC-06             |
| 3.3B-UNIT-015     | P0  | Command unit    | Foreground start JSON writes exactly one stdout line and excludes `Running workflow:`, `Working directory:`, dispatch text, result-card text, approval text, and raw assistant messages.                                                           | AC1, AC3, R-002, RC-05               |
| 3.3B-UNIT-016     | P0  | Command unit    | Paused approval start JSON emits `actionRequired`/`gateRef` and still writes exactly one stdout envelope.                                                                                                                                          | AC1, R-002, R-006, RC-05, RC-16      |
| 3.3B-UNIT-017     | P1  | Unit            | Error classification table covers malformed flags, unknown workflow, DB/codebase/worktree failure, timeout-message/ETIMEDOUT, and generic internal error with exit 64/69/70/78.                                                                    | AC3, R-009, RC-09, RC-26             |
| 3.3B-UNIT-018     | P1  | Command unit    | `workflow run --json --correlation-id supplied` echoes the supplied id in every success and error envelope.                                                                                                                                        | AC1, AC3, R-010, RC-19               |
| 3.3B-UNIT-019     | P0  | Command unit    | `workflowGetCommand('missing', true, false, corr)` emits `workflow.status` `WORKFLOW_RUN_NOT_FOUND` with exit 78 and no raw row.                                                                                                                   | AC2, AC3, R-005, RC-11               |
| 3.3B-UNIT-020     | P0  | Command unit    | DB lookup failure in `workflowGetCommand --json` emits classified error envelope, logs raw error, and does not include `err.message` in details.                                                                                                   | AC2, AC3, R-005, R-008, RC-12        |
| 3.3B-UNIT-021     | P0  | Command unit    | `workflowGetCommand --json` success for completed run emits `workflow.status` envelope with workflowRunRef, operation `status`, state `completed`, terminal true.                                                                                  | AC2, R-001, R-005                    |
| 3.3B-UNIT-022     | P0  | Command unit    | `workflowGetCommand --json` success for paused approval emits state `waiting-for-approval`, `actionRequired`, and `gateRef`.                                                                                                                       | AC2, R-005, R-006, RC-16             |
| 3.3B-UNIT-023     | P1  | Command unit    | `workflowGetCommand --json` success for failed run emits state `failed`, terminal true, and does not leak `metadata.error` as a command failure.                                                                                                   | AC2, R-005, R-008                    |
| 3.3B-UNIT-024     | P1  | Command unit    | `workflowGetCommand --json --correlation-id supplied` echoes the supplied id in success, not-found, and DB-error envelopes.                                                                                                                        | AC2, AC3, R-010, RC-19               |
| 3.3B-UNIT-025     | P1  | Command unit    | Verbose status places node events only under `result.events`; non-verbose omits events; event lookup failure does not create false success data.                                                                                                   | AC2, R-013, RC-22                    |
| 3.3B-UNIT-026     | P1  | Command unit    | Status verbose preserves fetched event order without interpreting out-of-order workflow events or mutating run state.                                                                                                                              | AC2, R-013, W-3.3B-008               |
| 3.3B-UNIT-027     | P1  | Command unit    | Message persistence failure from silent adapter is logged and does not corrupt stdout or prevent final JSON envelope emission.                                                                                                                     | AC1, R-012, partial failure          |
| 3.3B-UNIT-028     | P1  | Command unit    | Duplicate/concurrent starts with the same explicit branch or conversation id preserve distinct correlation ids and do not mix stdout envelopes.                                                                                                    | AC1, R-019, concurrency/race         |
| 3.3B-UNIT-029     | P1  | Command unit    | Timeout-like errors classify as `COMMAND_TIMEOUT`/`timeout`/retryable true and set execution timeout semantics consistently.                                                                                                                       | AC3, R-009, R-018                    |
| 3.3B-UNIT-030     | P1  | Unit            | `cancelled` workflow status maps to terminal `cancelled`; OS-level SIGINT/SIGTERM envelope guarantee remains waived.                                                                                                                               | AC2, R-006, R-018, W-3.3B-006        |
| 3.3B-CLI-031      | P0  | CLI subprocess  | `archon workflow run --json` with missing workflow name emits one `MALFORMED_REQUEST` envelope, exit 64, no stderr/prose.                                                                                                                          | AC3, R-003, RC-10                    |
| 3.3B-CLI-032      | P0  | CLI subprocess  | `workflow run <name> --json --branch x --no-worktree` and sibling bad flag combinations emit one `MALFORMED_REQUEST` envelope, not `console.error`.                                                                                                | AC3, R-003, RC-09                    |
| 3.3B-CLI-033      | P0  | CLI subprocess  | `archon workflow get --json` with missing run id emits one `workflow.status` `MALFORMED_REQUEST` envelope, exit 64.                                                                                                                                | AC3, R-003, RC-10                    |
| 3.3B-CLI-034      | P1  | CLI subprocess  | `--correlation-id` supplied through actual argv reaches `workflow run` and `workflow get` envelopes.                                                                                                                                               | AC1, AC2, R-010, RC-19               |
| 3.3B-CLI-035      | P0  | CLI subprocess  | `workflow run definitely-missing --json` from a git repo emits one classified JSON envelope and propagates the command's numeric exit code.                                                                                                        | AC3, R-003, R-004, R-009             |
| 3.3B-CONTRACT-036 | P0  | Contract/static | Parsed emitted start/status envelopes recursively contain no forbidden keys or command-forbidden text keys such as `actor`, `profile`, `agent`, `message`, `stdout`, `stderr`, `displayText`.                                                      | AC1, AC2, AC3, R-008, R-016, RC-23   |
| 3.3B-CONTRACT-037 | P1  | Contract/static | Story-owned fixture conformance asserts operation/state/terminal/accepted/actionRequired/gateRef fields and documents the intentional `phase`/`projectBindingRef` delta.                                                                           | AC1, AC2, R-014, RC-17, W-3.3B-002   |
| 3.3B-CONTRACT-038 | P1  | Contract/static | Shared envelope module regression tests keep passing; Story 3.3b does not alter `workflow-provider-command-envelope.ts` behavior.                                                                                                                  | R-016, RC-01                         |
| 3.3B-CONTRACT-039 | P0  | Contract/static | Canonical `validate_contracts.py` passes unchanged before sign-off.                                                                                                                                                                                | AC1, AC2, AC3, R-001, RC-02, RC-27   |
| 3.3B-CONTRACT-040 | P1  | Contract/static | Contract package has no uncommitted changes and production CLI code does not import `_bmad-output` fixtures/schemas at runtime.                                                                                                                    | R-016, R-020, RC-02                  |
| 3.3B-REG-041      | P1  | Regression      | Existing non-JSON `workflow run/get` human output, throw behavior, and usage text remain unchanged.                                                                                                                                                | R-011, RC-08                         |
| 3.3B-REG-042      | P1  | Regression      | Existing `workflowRunCommand --detach --json` ack remains `{ ok:true, action:'run', detached:true, ... }` and does not require workflowRunRef.                                                                                                     | R-011, RC-07, W-3.3B-001             |
| 3.3B-REG-043      | P1  | Regression      | Provider-binding and shared-envelope tests still pass; `binding.*` command behavior is not affected.                                                                                                                                               | R-016, RC-01                         |
| 3.3B-CI-044       | P1  | CI/static       | `packages/cli/package.json` keeps `workflow.test.ts` isolated; any new mocking file gets its own invocation.                                                                                                                                       | R-017, RC-24                         |
| 3.3B-CI-045       | P1  | CI              | Focused checks run: contract validator, `workflow.test.ts`, `workflow-provider-command-envelope.test.ts`, adapter test if changed, and `bun --filter @archon/cli type-check`.                                                                      | AC1, AC2, AC3, R-017, R-020          |
| 3.3B-CI-046       | P1  | CI              | `bun run validate` passes before review.                                                                                                                                                                                                           | AC1, AC2, AC3, R-020                 |
| 3.3B-CI-047       | P1  | Static/review   | File-scope review confirms no server/web/core DB/migration/workflow-event/delivery-health/Hermes implementation was added.                                                                                                                         | R-020, RC-25, W-3.3B-005             |

### Waivers

| ID         | Reason                                                                                                                                                                                       | Owner                         | Residual risk                                                                                       | Follow-up trigger                                                                                           |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------- | --------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| W-3.3B-001 | `--detach --json` is explicitly outside this story's provider-command surface because the parent has no real run id when it emits the ack.                                                   | CLI owner + product owner     | Existing detach JSON remains legacy and not a `workflow.start` envelope.                            | A future story explicitly makes detach/async start envelope-shaped.                                         |
| W-3.3B-002 | Strict byte-for-byte parity with `start-success.json`/`status-success.json` fields `phase` and `projectBindingRef` is out of scope; those are Hermes/BMAD phase or Project Binding concepts. | Contract owner                | Fixtures illustrate fields runtime 3.3b will not emit, so consumers must not require them yet.      | Contract makes those fields required or Archon accepts ownership of phase/project binding semantics.        |
| W-3.3B-003 | True non-blocking start semantics are out of scope; foreground `workflow run` remains blocking until terminal or paused.                                                                     | Product + architecture owners | Hermes may expect an immediate `running` reference and need a later async-start story.              | Hermes consumer requires immediate start acknowledgement or production latency makes blocking unacceptable. |
| W-3.3B-004 | Top-level `bindingRef`/`projectBindingRef` is not applicable to generic Archon workflow start/status unless a real provider binding is involved.                                             | Product + contract owners     | Start/status envelopes may omit binding references despite AC wording "when applicable".            | Workflow command implementation becomes binding-aware or a contract change requires binding refs.           |
| W-3.3B-005 | HTTP routes, Web UI, workflow events, delivery health, Hermes ingestion, reconciliation, and project-work mutation are excluded by PRD/architecture scope.                                   | Architecture owner            | No full producer-consumer runtime integration is proven here.                                       | Accepted story activates one of those surfaces.                                                             |
| W-3.3B-006 | OS-level kill/abort guarantee is not defined; this story only classifies timeout-like errors inside command execution.                                                                       | CLI architecture owner        | A process killed externally may not emit a final envelope.                                          | Runtime timeout/abort-signal contract or service-runner supervision is accepted.                            |
| W-3.3B-007 | No application-level auth/permission layer applies to local CLI commands under current OS-process trust.                                                                                     | Security owner                | Any local user with CLI/database access can invoke these commands under existing trust assumptions. | Remote, multi-user, service-account, or role-scoped control surface is introduced.                          |
| W-3.3B-008 | Out-of-order workflow event ingestion is not applicable; this story only optionally projects already stored status events for `workflow get --verbose`.                                      | Workflow event owner          | Event ordering/idempotency defects are not detected here.                                           | Story 3.5/3.7 or Hermes callback ingress implements event delivery/receipt behavior.                        |
| W-3.3B-009 | No performance/load threshold exists for local CLI envelope construction or foreground workflow duration.                                                                                    | Product/operations owner      | Slow workflow starts have no numeric SLO beyond normal command/test feedback.                       | Latency SLO, remote exposure, or performance incident is accepted.                                          |

### Mandatory Traceability

| Item                           | Scenario or waiver coverage                                                                                                        |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------- |
| AC1 start JSON                 | 3.3B-UNIT-001, 008, 011, 013-018, 027-028, 3.3B-CLI-034, 3.3B-CONTRACT-036-037, W-3.3B-002, W-3.3B-003, W-3.3B-004                 |
| AC2 status JSON                | 3.3B-UNIT-002-007, 019-026, 030, 3.3B-CLI-033-034, 3.3B-CONTRACT-036-037, W-3.3B-002                                               |
| AC3 failure JSON               | 3.3B-UNIT-009-012, 017, 019-020, 029, 3.3B-CLI-031-035, 3.3B-CONTRACT-036, 039                                                     |
| High-risk R-001                | 3.3B-UNIT-001, 019, 021-022, 3.3B-CONTRACT-036, 039                                                                                |
| High-risk R-002                | 3.3B-UNIT-014-016, 027, 3.3B-CLI-031-035                                                                                           |
| High-risk R-003                | 3.3B-CLI-031-033                                                                                                                   |
| High-risk R-004                | 3.3B-UNIT-012, 3.3B-CLI-035                                                                                                        |
| High-risk R-005                | 3.3B-UNIT-019-025                                                                                                                  |
| High-risk R-006                | 3.3B-UNIT-002-007, 016, 022, 030                                                                                                   |
| High-risk R-007                | 3.3B-UNIT-008, 011                                                                                                                 |
| High-risk R-008                | 3.3B-UNIT-009-010, 020, 023, 3.3B-CONTRACT-036                                                                                     |
| High-risk R-009                | 3.3B-UNIT-017, 029, 3.3B-CLI-032, 035                                                                                              |
| High-risk R-010                | 3.3B-UNIT-018, 024, 3.3B-CLI-034                                                                                                   |
| High-risk R-011                | 3.3B-REG-041-042                                                                                                                   |
| High-risk R-012                | 3.3B-UNIT-014, 027                                                                                                                 |
| High-risk R-013                | 3.3B-UNIT-025-026                                                                                                                  |
| High-risk R-014                | 3.3B-UNIT-007, 013, 3.3B-CONTRACT-037, W-3.3B-002                                                                                  |
| High-risk R-015                | 3.3B-UNIT-013, W-3.3B-003                                                                                                          |
| High-risk R-016                | 3.3B-CONTRACT-036, 038, 040, 3.3B-REG-043                                                                                          |
| High-risk R-017                | 3.3B-CI-044-046                                                                                                                    |
| High-risk R-018                | 3.3B-UNIT-029-030, W-3.3B-006                                                                                                      |
| High-risk R-019                | 3.3B-UNIT-028                                                                                                                      |
| High-risk R-020                | 3.3B-CONTRACT-040, 3.3B-CI-045-047                                                                                                 |
| Reviewer concerns RC-01..RC-27 | Covered by the Scenario or Waiver column in Step 3's reviewer-evidence table; every listed scenario ID or waiver is defined above. |

### NFR Evidence Plan

| NFR                     | Planned validation                                                                                                                | Evidence artifact                                                                      |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| Security                | Recursive parsed-envelope forbidden-key scan; raw diagnostic suppression tests; redacted execution metadata assertions.           | `workflow-command-contract.test.ts` output and focused `workflow.test.ts` output.      |
| Reliability             | Fail-closed command/error tests, dependency failure tests, timeout classification, stdout exactness, subprocess exit code checks. | `bun test packages/cli/src/commands/workflow.test.ts` plus CLI subprocess test output. |
| Data integrity          | Persisted run readback, projectRef derivation/omission, silent adapter persistence, detach/non-JSON regression.                   | Command and adapter unit test output.                                                  |
| Compatibility           | Schema/fixture validation, canonical validator, command id and error category checks, field-delta documentation.                  | Contract test output and validator output.                                             |
| Maintainability         | Type-check, no contract edits, no runtime planning imports, package test isolation.                                               | `bun --filter @archon/cli type-check`, `bun run validate`, package-script review.      |
| Permission/auth         | Scope review only; no app auth is defined.                                                                                        | W-3.3B-007 and file-scope review evidence.                                             |
| Performance/scalability | No numeric SLO.                                                                                                                   | W-3.3B-003 and W-3.3B-009; no load test required.                                      |

### Execution Strategy

- PR gate: all P0/P1 Bun unit, adapter, contract, and narrow subprocess tests; contract validator; `bun --filter @archon/cli type-check`.
- Pre-review gate: `bun run validate`.
- Nightly/weekly: none required for this story because there is no browser, API service, load, or external-network test surface.

### Estimates

- P0 coverage: ~18-30 hours.
- P1 coverage: ~20-34 hours.
- Waiver/process evidence: ~3-6 hours.
- Total: ~41-70 hours, roughly 5-9 engineering days including implementation feedback loops.

### Quality Gates

- P0 pass rate: 100%.
- P1 pass rate: >=95%, with any remaining P1 explicitly waived using owner/residual risk/follow-up trigger.
- All score >=6 risks must have passing scenario evidence or a waiver.
- No contract fixtures/schemas edited to fit runtime.
- JSON-mode stdout purity tests must pass before review.
- Full NFR PASS/CONCERNS/FAIL is deferred to `nfr-assess` after implementation evidence exists.

## Step 5: Generate Output

Final output written:

- `_bmad-output/test-artifacts/test-design/test-design-3-3b-provide-archon-start-and-status-cli-json.md`

Validation applied against `.agents/skills/bmad-testarch-test-design/checklist.md`:

- Epic-level prerequisites satisfied: story, PRD/epic, architecture, and contract artifacts loaded.
- Risk assessment includes probability, impact, score, priority, mitigation, owner, and timeline.
- NFR planning marks unknown thresholds as UNKNOWN and maps in-scope categories to planned evidence.
- Coverage plan maps acceptance criteria, high-risk items, and reviewer concerns to scenarios or waivers.
- Execution strategy uses the required PR / Nightly / Weekly model.
- Resource estimates use ranges, not false precision.
- Output contains no unresolved template placeholders.

# Test Design Progress: a5.2 Generate PR Handoff With Evidence Links

## Step 1: Detect Mode

Mode selected: Epic-Level.

Reason: the input is a story handoff with acceptance criteria, implementation tasks, reviewer concerns, and prior-story dependencies.

## Step 2: Load Context

Loaded story, prior story intelligence, PRD, architecture, epics, project context, workflow YAML, package test configuration, existing a5-1 test patterns, and TEA knowledge fragments for risk governance, probability-impact scoring, test levels, priorities, NFR planning, and API/backend testing patterns.

Detected stack: fullstack TypeScript monorepo, with this story scoped to workflow YAML, deterministic bash contract behavior, generated defaults, and Bun workflow tests.

## Step 3: Risk And Testability

Completed risk assessment with every known reviewer concern treated as evidence.

Every concern is converted into a risk, explicit non-risk, or waiver.

P0/P1 priority is promoted where a failure can break core behavior, security, data integrity, compatibility, or cross-process contract behavior.

## Step 4: Coverage Plan

Completed atomic scenario coverage for all acceptance criteria, high-risk items, and reviewer concerns.

Coverage includes happy path, negative path, boundary cases, malformed input, stale data, duplicate actions, out-of-order events, partial failure, dependency failure, timeout, cancellation, concurrency/race, rollback, permission/auth, and regression cases where applicable.

## Step 5: Generate Output

Final output written:

- `_bmad-output/test-artifacts/test-design/test-design-a5-2-generate-pr-handoff-with-evidence-links.md`

Validation checklist applied manually against the workflow requirements.

Open waivers are recorded in the output document with reason, owner, residual risk, and follow-up trigger.

---

# Test Design Progress: 3.1 Implement Archon Workflow Provider-Binding Lifecycle

## Step 1: Detect Mode

Mode selected: Epic-Level.

Reason: the supplied implementation-artifact story is an explicit story-level input and contains acceptance criteria suitable for one focused test plan.

Prerequisite result: PASS — `_bmad-output/implementation-artifacts/3-1-implement-archon-workflow-provider-binding-lifecycle.md` exists and provides the required story requirements and acceptance criteria; architecture context will be loaded when available in Step 2.

## Step 2: Load Context

Configuration loaded: Playwright utils enabled; Pact.js utils disabled; Pact MCP disabled; browser automation `auto`; stack detection `auto`; test artifacts rooted at `_bmad-output/test-artifacts`.

Detected project stack: full-stack Bun + strict TypeScript monorepo. Story-local scope is headless CLI plus core persistence only; it has no HTTP, web UI, browser, or Playwright surface.

Loaded requirements and architecture: Story 3.1, FR-7, Epic 3 boundaries, Architecture AD-2/3/6/7/8/9/11, provider CLI syntax baseline, implementation-readiness evidence, project context, command-envelope and provider-binding schemas, command/status fixtures, and the canonical validator.

Canonical contract validation: PASS — 7 schemas, 17 command examples, 13 binding examples, 7 delivery examples, 6 generic event examples, 7 provider event examples, 9 callback rejection examples, and 6 materialization examples validated without parent-workspace traversal.

Testable requirements extracted: provider/name/project/route persistence; distinct create versus update semantics; six representable status outcomes; rotate and disable lifecycle behavior; parseable success/failure envelopes; correlation/timestamp metadata; generic vocabulary; malformed-input fail-closed behavior; and preservation of audit history.

Integration points: CLI argument parsing and dispatch; registered-codebase resolution; core DB module; SQLite schema/upgrade behavior; PostgreSQL combined schema and bundled-schema generation; workflow-command-envelope fixtures; external-controller JSON parsing; and package-isolated Bun test execution.

Existing test patterns: mocked `pool.query` DB-module tests; SQLite adapter tests with temporary real databases; mocked PostgreSQL adapter/schema initialization tests; fixture-driven CLI stdout assertions; generated bundled-schema checks; and separate package test invocations to contain process-global `mock.module()` pollution.

Known coverage gaps: provider-binding implementation, migration, schema, CLI surface, and focused tests do not yet exist. No prior system-level `test-design-architecture.md` or `test-design-qa.md` artifact exists for this handoff. The readiness report contains no extra review findings; the story's Known Contract Gaps and scope decisions are the authoritative reviewer evidence for Step 3.

Browser exploration: explicitly not applicable because the story has no browser/UI target, `playwright-cli` is unavailable, and repository tests contain no `page.goto`/`page.locator` usage. The API-only Playwright knowledge profile was loaded for workflow compliance, but the project’s existing Bun test stack remains the selected execution pattern.

## Step 3: Risk and Testability

Risk scale: Probability and Impact use 1 (low), 2 (medium), 3 (high); score is P × I. Scores 6–8 require mitigation and score 9 is blocking. Test priority is promoted to P0/P1 whenever failure can break core behavior, security, data integrity, compatibility, or the external controller contract.

### Risk Register

| ID    | Category    | Risk                                                                                                                                                                                   |   P |   I | Score | Priority | Mitigation and evidence                                                                                                                                                                   | Owner / timeline                                                            |
| ----- | ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --: | --: | ----: | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| R-001 | TECH / BUS  | The two contract families, their result keys, and their `projectRef` shapes are conflated; permissive nested schemas can let semantically incompatible output pass.                    |   3 |   3 |     9 | P0       | Exact structural comparison against `commands/binding-*.json`, direct schema validation, and negative checks for binding-family-only fields.                                              | CLI implementer + contract reviewer / before Tasks 1 and 4 complete         |
| R-002 | BUS / OPS   | `--json` emits logs, prose, multiple lines, malformed JSON, or a non-contract error, preventing external controllers from failing closed.                                              |   3 |   3 |     9 | P0       | Capture raw stdout/stderr and exit code for every verb and failure class; assert exactly one parseable envelope and redacted execution metadata.                                          | CLI implementer / before every lifecycle task gate                          |
| R-003 | DATA / BUS  | Create and update collapse into upsert behavior, or concurrent duplicate actions violate uniqueness and mutate the wrong row.                                                          |   3 |   3 |     9 | P0       | DB SQL-shape tests, real SQLite uniqueness tests, missing/existing transition tests, and deterministic concurrent create/update races.                                                    | Core DB implementer / Tasks 1–2                                             |
| R-004 | DATA / BUS  | Ambiguous `--project-ref` normalization resolves the wrong codebase, auto-registers unknown data, conflicts with fixture string form, or loses `event_route`.                          |   3 |   3 |     9 | P0       | Define the accepted identifier form, reject unknown/ambiguous references before mutation, assert stored codebase/route and emitted plain-string reference, and test mismatch diagnostics. | Architecture owner + CLI implementer / clarify before Task 1 implementation |
| R-005 | BUS         | Status cannot safely represent all six required outcomes, especially `stale` whose detection trigger is undefined, leading to false readiness or speculative reconciliation.           |   2 |   3 |     6 | P1       | Cover missing/active-valid/disabled/rotated/conflicting projections; prove `stale` is representable; explicitly waive active stale detection until a version protocol exists.             | Contract owner + core implementer / Task 4 and follow-up on protocol change |
| R-006 | DATA        | SQLite-required UPDATE-then-SELECT allows a concurrent action to change the row between statements, producing an envelope that does not describe the caller's mutation.                |   2 |   3 |     6 | P1       | Add deterministic race tests for rotate/update/disable; use transaction/CAS/version predicates if evidence shows interleaving; assert monotonic version increments.                       | Core DB implementer / Tasks 2–3                                             |
| R-007 | TECH / DATA | PostgreSQL combined schema, bundled schema, and SQLite `createSchema()` drift, so one backend boots without the table/constraint or upgrades incorrectly.                              |   2 |   3 |     6 | P1       | Schema-marker/generated check, PostgreSQL schema-init assertion, real SQLite fresh/upgrade tests, and full `bun run validate`.                                                            | Core DB implementer / Task 1 and pre-PR                                     |
| R-008 | SEC         | Rotation is misread as secret rotation, causing raw secret/signature material or speculative secret columns to be stored or emitted.                                                   |   2 |   3 |     6 | P0       | Version-counter-only implementation tests plus recursive negative assertions over DB params, JSON, stdout, and stderr; canonical validator remains mandatory.                             | Security reviewer + core implementer / Task 3                               |
| R-009 | DATA / OPS  | Disable deletes audit history, is ambiguously non-idempotent, or a duplicate disable changes unrelated state.                                                                          |   2 |   3 |     6 | P1       | Specify idempotent-safe semantics, test first and duplicate disable, assert row retained and no remove command exists.                                                                    | Product/architecture owner + core implementer / before Task 3 acceptance    |
| R-010 | BUS / SEC   | Hermes-specific keys or an unsupported top-level `actor` are emitted, violating `additionalProperties: false`; omitting actor without recording the gap also loses audit expectations. |   2 |   3 |     6 | P1       | Assert forbidden keys absent recursively, top-level schema exactness, and actor omission; record the contract gap and follow-up trigger.                                                  | Contract owner + CLI implementer / Task 4                                   |
| R-011 | DATA / OPS  | DB lookup/write/read dependency failures or follow-up-select failures produce false success or partially applied state without a machine-readable failure.                             |   2 |   3 |     6 | P1       | Fault-inject each dependency call, assert no success envelope after failure, distinguish pre-mutation from post-mutation uncertainty, and preserve fail-closed JSON.                      | Core + CLI implementers / each task gate                                    |
| R-012 | DATA / BUS  | Empty, whitespace, very long, Unicode, separator-heavy, or normalization-equivalent provider/name values create invalid or colliding derived binding IDs.                              |   2 |   3 |     6 | P1       | Establish validation/canonicalization rules before persistence; table-driven boundary tests and collision tests; no silent normalization.                                                 | Contract/architecture owner / clarify before Task 1                         |
| R-013 | OPS / DATA  | A task or migration partially lands and cannot roll back independently, invalidating earlier accepted slices or leaving one backend unusable.                                          |   2 |   3 |     6 | P1       | Per-task rollback notes; verify old code tolerates additive table; test failed initialization transaction behavior and re-run convergence.                                                | Story owner / every task acceptance                                         |
| R-014 | TECH        | Bun process-global `mock.module()` pollution causes order-dependent tests, false positives, or broad root-test failures.                                                               |   3 |   2 |     6 | P1       | Isolate new mocked files in package scripts, run the focused invocation repeatedly and within `bun run test`, never use root `bun test` as evidence.                                      | Test implementer / when adding tests                                        |
| R-015 | BUS         | Correlation IDs or timestamps are missing, blank, invalid, unstable across one envelope, or incorrectly normalized away in fixture comparisons.                                        |   2 |   3 |     6 | P1       | Inject fixed values in unit tests, validate generated UUID/ISO values in integration tests, and exclude only explicitly dynamic fields from fixture equality.                             | CLI implementer / Tasks 1–4                                                 |
| R-016 | OPS / BUS   | A hung/cancelled DB operation has no binding-command timeout/cancellation contract and may leave a controller without a terminal parseable result.                                     |   2 |   3 |     6 | P1       | Fault-inject rejected and never-resolving dependencies at the handler boundary; document timeout/cancellation ownership and waive runtime guarantees until the CLI defines them.          | CLI architecture owner / clarify before production exposure                 |

### Reviewer-Evidence Disposition

| Concern                                                                                                                          | Evidence disposition                                                                                                                        |   P |   I | Score | Linked item                                           |
| -------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | --: | --: | ----: | ----------------------------------------------------- |
| RC-01: AC4 actor is absent from both closed top-level schemas.                                                                   | Risk: adding it breaks compatibility; omission requires documented follow-up.                                                               |   2 |   3 |     6 | R-010                                                 |
| RC-02: `stale` has no detection trigger or expected-version input.                                                               | Risk: false stale/valid classification; active detection requires waiver.                                                                   |   2 |   3 |     6 | R-005                                                 |
| RC-03: rotate is only a version bump and raw secrets are forbidden.                                                              | Security risk if implemented as secret material rotation.                                                                                   |   2 |   3 |     6 | R-008                                                 |
| RC-04: route has no fixed fixture key although the CLI requires it.                                                              | Risk: route can be dropped or named inconsistently across DB/JSON.                                                                          |   2 |   3 |     6 | R-004                                                 |
| RC-05: command and binding fixture families are not interchangeable.                                                             | Critical compatibility risk.                                                                                                                |   3 |   3 |     9 | R-001                                                 |
| RC-06: command fixtures require `bindingVersion` and string `bindingRef.projectRef`; binding fixtures use different keys/shapes. | Critical compatibility risk despite permissive nested schema.                                                                               |   3 |   3 |     9 | R-001                                                 |
| RC-07: application conformance to `bindings/*.json` is explicitly out of scope.                                                  | Explicit non-risk: no application caller exists; duplicating a schema violates YAGNI. Contract-package validation remains evidence.         |   1 |   1 |     1 | NR-01 / waiver required                               |
| RC-08: project-ref-as-codebase-id is a recommendation, while fixtures show namespaced strings.                                   | Critical identity/compatibility ambiguity.                                                                                                  |   3 |   3 |     9 | R-004                                                 |
| RC-09: create must never upsert; update missing must never create.                                                               | Critical data integrity risk.                                                                                                               |   3 |   3 |     9 | R-003                                                 |
| RC-10: SQLite forbids UPDATE/DELETE RETURNING, requiring a follow-up SELECT.                                                     | Concurrency and stale-observation risk.                                                                                                     |   2 |   3 |     6 | R-006                                                 |
| RC-11: duplicate disable behavior must be decided; disable must not delete and no remove operation exists.                       | Data/audit risk.                                                                                                                            |   2 |   3 |     6 | R-009                                                 |
| RC-12: `--json` stdout must be exactly the payload with no Pino or prose.                                                        | Critical controller-contract risk.                                                                                                          |   3 |   3 |     9 | R-002                                                 |
| RC-13: local envelope construction is allowed until Story 3.3a supplies a shared builder.                                        | Explicit non-risk: small local helper has a current caller and a defined refactor trigger.                                                  |   1 |   2 |     2 | NR-02 / regression trigger Story 3.3a                 |
| RC-14: the checked-in contract package is immutable and validator-gated.                                                         | Risk if fixtures/schemas are hand-edited to fit runtime output.                                                                             |   2 |   3 |     6 | R-001, R-007                                          |
| RC-15: PostgreSQL SQL and SQLite schema must both change; generated schema must be refreshed.                                    | Cross-backend compatibility risk.                                                                                                           |   2 |   3 |     6 | R-007                                                 |
| RC-16: mocked tests must respect package isolation because `mock.module()` is irreversible.                                      | Test reliability risk.                                                                                                                      |   3 |   2 |     6 | R-014                                                 |
| RC-17: HTTP, Web UI, workflow execution/events, and Hermes behavior are excluded.                                                | Explicit non-risk: accepted product/architecture boundary; adding them would broaden the attack surface and rollback scope.                 |   1 |   2 |     2 | NR-03 / scope waiver                                  |
| RC-18: correlation ID generation has no existing Archon convention.                                                              | Contract metadata risk.                                                                                                                     |   2 |   3 |     6 | R-015                                                 |
| RC-19: external binding ID may be derived rather than stored.                                                                    | Risk only if derivation is lossy/colliding; otherwise a YAGNI-aligned non-risk.                                                             |   2 |   3 |     6 | R-012                                                 |
| RC-20: global `UNIQUE(provider, name)` is mandated by the story proposal.                                                        | Explicit non-risk if controller identity is global; test the invariant and reopen only if multi-project same-name bindings become accepted. |   1 |   3 |     3 | NR-04 / follow-up trigger new cardinality requirement |
| RC-21: no application auth/permission requirement exists for this local CLI.                                                     | Explicit non-risk under the current OS-process trust boundary; requires waiver and security re-review if exposed remotely or multi-user.    |   1 |   3 |     3 | NR-05 / waiver required                               |
| RC-22: binding timeout and cancellation behavior is unspecified.                                                                 | Operational/controller risk, not permission to invent a lifecycle transition.                                                               |   2 |   3 |     6 | R-016                                                 |
| RC-23: each implementation slice needs independent evidence and rollback.                                                        | Operational/data risk if delivery becomes one inseparable patch.                                                                            |   2 |   3 |     6 | R-013                                                 |
| RC-24: dependency and follow-up-read failures can occur around mutations.                                                        | Partial-failure/false-success risk.                                                                                                         |   2 |   3 |     6 | R-011                                                 |

### NFR Planning

| NFR                         | In scope / threshold                                                                                                                                                                    | Planned evidence                                                                                                                 |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Security                    | In scope. Zero raw secret/signature material in persistence or output; no forbidden Hermes keys; failure execution metadata marks stdout/stderr redacted.                               | Recursive negative assertions, contract validator, fixture/schema conformance, DB-parameter inspection.                          |
| Reliability                 | In scope. Failed preconditions and dependencies must never emit success; duplicate/racing lifecycle actions preserve unique identity and monotonic versioning; disable retains the row. | DB fault injection, real SQLite integration, deterministic concurrency tests, CLI failure-envelope tests.                        |
| Data integrity              | In scope. One `(provider,name)` binding; create is insert-only; update is update-only; route/codebase linkage is preserved; both backends converge.                                     | SQL-shape assertions, SQLite constraints, PostgreSQL schema-init checks, generated-schema check.                                 |
| Cross-process compatibility | In scope. Every JSON result parses as exactly one `workflow-command-envelope.v1` document and matches checked-in command fixtures except explicitly dynamic fields.                     | Raw stdout capture, JSON Schema validation, exact fixture comparison, forbidden-field checks.                                    |
| Auditability                | In scope. Timestamp/correlation always present; disable does not delete history. Actor threshold is UNKNOWN because the contract forbids a top-level actor.                             | Lifecycle persistence tests, metadata format checks, actor waiver and contract follow-up.                                        |
| Maintainability             | In scope. Strict TypeScript, zero lint warnings, generated artifacts synchronized, package-isolated tests deterministic.                                                                | Focused Bun tests, repeated test runs, `bun run validate`.                                                                       |
| Performance / scalability   | No throughput or latency target is defined; single-developer local CLI scope makes load testing non-applicable for this story. DB command timeout remains UNKNOWN.                      | No invented load threshold; R-016 waiver/clarification and regression trigger if remote or concurrent service exposure is added. |
| Permission / authorization  | No new remote surface or role policy is defined; commands inherit the local OS process trust boundary.                                                                                  | NR-05 waiver; negative architecture check that no HTTP route is added; security re-review trigger on remote/multi-user exposure. |
| Compliance                  | No regulatory requirement is stated. Contract and audit compatibility are treated as project-specific quality gates, not regulatory claims.                                             | Canonical validator and traceability artifact.                                                                                   |

### Highest-Priority Findings

P0 blockers for implementation acceptance are R-001, R-002, R-003, R-004, and R-008. They cover exact cross-process JSON compatibility, fail-closed output, non-upsert data semantics under duplication/race, project/route identity, and zero secret exposure.

All other score-6 risks require explicit P1 scenarios or a complete waiver. No high-risk item may be considered covered by an implied happy path.

## Step 4: Coverage Plan and Execution Strategy

### Test-Level Allocation

- **Unit (Bun):** row schemas, DB SQL/branch logic with mocked `pool.query`, envelope construction, validation, and fault injection.
- **DB integration (Bun):** temporary real SQLite databases for DDL, uniqueness, upgrade, repeat-init, and deterministic races; mocked PostgreSQL adapter initialization for combined-schema transaction behavior.
- **CLI integration/E2E (Bun):** command handler plus a narrow subprocess harness for actual argv dispatch, exit code, stdout/stderr, and log-silence behavior.
- **Contract regression:** checked-in JSON fixtures, JSON Schema, and `validate_contracts.py`.
- **CI/static:** bundled schema generation, forbidden secret/scope checks, package-isolated test invocation, and `bun run validate`.

No API, component, browser, or Web E2E layer applies. Cross-level overlap is limited to P0 contract/data paths where each level proves a different property.

### Atomic Scenario Catalog

| ID               | Pri | Level               | Atomic scenario                                                                                                                                    | Trace                        |
| ---------------- | --- | ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------- |
| 3.1-UNIT-001     | P1  | Unit                | Row schema accepts the exact snake_case DB row and rejects missing/wrong-typed columns.                                                            | AC1, R-007                   |
| 3.1-UNIT-002     | P0  | Unit                | Create binds registered codebase + provider + name + opaque event route using `ON CONFLICT DO NOTHING`, never `DO UPDATE`.                         | AC1, AC2, R-003, R-004       |
| 3.1-UNIT-003     | P0  | Unit                | Create with an existing `(provider,name)` returns `BINDING_ALREADY_EXISTS` and applies no mutation.                                                | AC2, R-003                   |
| 3.1-UNIT-004     | P0  | Unit                | Update on an existing binding changes only the intended codebase/route metadata and emits the updated row.                                         | AC1, AC2, R-003, R-004       |
| 3.1-UNIT-005     | P0  | Unit                | Update on a missing binding returns `BINDING_NOT_FOUND` and executes no INSERT.                                                                    | AC2, R-003                   |
| 3.1-UNIT-006     | P0  | Unit                | A registered codebase ID resolves to the stored codebase and emitted plain-string `bindingRef.projectRef` under the ratified normalization rule.   | AC1, R-004                   |
| 3.1-UNIT-007     | P0  | Unit                | Unknown/ambiguous project reference fails `MALFORMED_REQUEST` before binding mutation and never auto-registers a codebase.                         | AC1, AC5, R-004              |
| 3.1-UNIT-008     | P0  | Unit                | Create then update round-trips an event route byte-for-byte under the chosen opaque-route rules.                                                   | AC1, R-004                   |
| 3.1-UNIT-009     | P1  | Unit                | Rotate performs UPDATE without RETURNING, increments one version, sets `rotated`, then selects the resulting row.                                  | AC4, R-006, R-008            |
| 3.1-UNIT-010     | P1  | Unit                | Rotate before create returns `BINDING_NOT_FOUND` and does not create a row.                                                                        | AC4, R-009                   |
| 3.1-UNIT-011     | P1  | Unit                | Disable updates state to `disabled` without DELETE and returns the resulting row.                                                                  | AC4, R-009                   |
| 3.1-UNIT-012     | P1  | Unit                | Disable before create returns `BINDING_NOT_FOUND` and does not create a row.                                                                       | AC4, R-009                   |
| 3.1-UNIT-013     | P1  | Unit                | Status for no row returns `missing` with the shared result shape.                                                                                  | AC3, R-005                   |
| 3.1-UNIT-014     | P1  | Unit                | Status for an active row returns state `active`, health `valid`, and ready semantics.                                                              | AC3, R-005                   |
| 3.1-UNIT-015     | P1  | Unit                | Status for a disabled row returns disabled/not-ready semantics.                                                                                    | AC3, R-005                   |
| 3.1-UNIT-016     | P1  | Unit                | Status for a rotated row returns rotated/ready and active-version semantics.                                                                       | AC3, R-005                   |
| 3.1-UNIT-017     | P1  | Unit                | Status with supplied project reference resolving to another codebase returns `conflicting` and `/repositoryPath` `path-mismatch`.                  | AC3, R-004, R-005            |
| 3.1-UNIT-018     | P1  | Unit                | Status types/builders can represent `stale` with observed/expected versions without wiring speculative detection.                                  | AC3, R-005, W-001            |
| 3.1-UNIT-019     | P1  | Unit                | Unknown/corrupt persisted state fails closed with a machine error instead of being projected as valid.                                             | AC3, AC5, R-005, R-011       |
| 3.1-UNIT-020     | P0  | Unit                | Create with both provider and name absent matches the checked-in malformed-request field errors.                                                   | AC5, R-002                   |
| 3.1-UNIT-021     | P1  | Unit                | Missing provider alone on a non-create verb returns a provider-required error for that verb.                                                       | AC5, R-002                   |
| 3.1-UNIT-022     | P1  | Unit                | Missing name alone on a non-create verb returns a name-required error for that verb.                                                               | AC5, R-002                   |
| 3.1-UNIT-023     | P1  | Unit                | Create without project-ref fails before lookup/write.                                                                                              | AC1, AC5, R-004              |
| 3.1-UNIT-024     | P1  | Unit                | Create without route fails before lookup/write.                                                                                                    | AC1, AC5, R-004              |
| 3.1-UNIT-025     | P1  | Unit                | Update without project-ref fails before lookup/write.                                                                                              | AC2, AC5, R-004              |
| 3.1-UNIT-026     | P1  | Unit                | Update without route fails before lookup/write.                                                                                                    | AC2, AC5, R-004              |
| 3.1-UNIT-027     | P1  | Unit                | Empty/whitespace provider is rejected or preserved according to an explicitly ratified rule; no silent trim aliases another binding.               | AC5, R-012                   |
| 3.1-UNIT-028     | P1  | Unit                | Empty/whitespace name is rejected or preserved according to an explicitly ratified rule; no silent trim aliases another binding.                   | AC5, R-012                   |
| 3.1-UNIT-029     | P1  | Unit                | Empty/whitespace route is rejected as malformed before mutation.                                                                                   | AC1, AC5, R-004, R-012       |
| 3.1-UNIT-030     | P1  | Unit                | Unicode and separator-heavy provider/name values either round-trip exactly or fail with a documented validation code.                              | AC1, AC5, R-012              |
| 3.1-UNIT-031     | P1  | Unit                | Candidate normalization collisions (for example `a-b` versus `a_b`) cannot produce the same live binding ID unless input validation rejects one.   | AC1, R-012                   |
| 3.1-UNIT-032     | P1  | Unit                | Caller-supplied correlation ID is preserved exactly within one envelope.                                                                           | AC4, R-015                   |
| 3.1-UNIT-033     | P1  | Unit                | Omitted correlation ID produces a nonblank UUID and issued/checked timestamps are valid ISO date-time values.                                      | AC4, R-015                   |
| 3.1-UNIT-034     | P0  | Unit                | Recursive output inspection finds no raw secret/signature material, top-level actor, or Hermes-specific forbidden field.                           | AC4, R-008, R-010            |
| 3.1-UNIT-035     | P1  | Unit                | Codebase lookup rejection produces one failure envelope and no binding write.                                                                      | AC5, R-011                   |
| 3.1-UNIT-036     | P1  | Unit                | Binding INSERT/UPDATE rejection produces one failure envelope and no false success.                                                                | AC5, R-011                   |
| 3.1-UNIT-037     | P1  | Unit                | Mutation succeeds but follow-up SELECT rejects: no stale success is emitted and mutation uncertainty is machine-readable.                          | AC5, R-006, R-011            |
| 3.1-UNIT-038     | P1  | Unit                | Injected dependency timeout maps to a parseable timeout/failure envelope without prose parsing.                                                    | AC5, R-016                   |
| 3.1-UNIT-039     | P1  | Unit                | Unexpected/non-serializable dependency error data is sanitized so envelope serialization still succeeds.                                           | AC5, R-002, R-011            |
| 3.1-UNIT-040     | P1  | Unit                | Unsupported/remove subcommand fails closed; no binding remove behavior is exposed.                                                                 | AC4, R-009                   |
| 3.1-INT-001      | P0  | DB integration      | Fresh SQLite startup creates the table with FK, defaults, and unique `(provider,name)` constraint.                                                 | AC1, R-003, R-007            |
| 3.1-INT-002      | P1  | DB integration      | Existing pre-story SQLite database upgrades by adding the new table without losing existing rows.                                                  | AC1, R-007, R-013            |
| 3.1-INT-003      | P1  | DB integration      | Repeated SQLite initialization is idempotent and preserves binding rows.                                                                           | R-007, R-013                 |
| 3.1-INT-004      | P1  | DB integration      | PostgreSQL combined-schema initialization contains the same table/FK/unique/default semantics and executes inside the existing schema transaction. | AC1, R-007                   |
| 3.1-INT-005      | P0  | DB integration      | Two concurrent creates for the same identity yield one row, one success, and one already-exists failure.                                           | AC2, R-003                   |
| 3.1-INT-006      | P0  | DB integration      | Concurrent create/update on a missing identity yields only legal outcomes and never an upsert-created duplicate or lost identity.                  | AC2, R-003, R-006            |
| 3.1-INT-007      | P0  | DB integration      | Create → update → create proves update never creates a second row and later create still fails existing.                                           | AC2, R-003                   |
| 3.1-INT-008      | P1  | DB integration      | Two concurrent rotates produce monotonic increments with no lost update and each envelope matches its committed transition.                        | AC4, R-006                   |
| 3.1-INT-009      | P1  | DB integration      | Rotate racing disable yields one serializable final row and no envelope describing a state/version that was never committed.                       | AC4, R-006, R-009            |
| 3.1-INT-010      | P1  | DB integration      | Duplicate disable follows the documented idempotent-safe rule and retains exactly one disabled row.                                                | AC4, R-009                   |
| 3.1-INT-011      | P1  | DB integration      | Schema initialization failure rolls back where transactional and a subsequent startup converges cleanly.                                           | R-007, R-013                 |
| 3.1-CLI-001      | P0  | CLI contract        | Create success output matches `binding-create-success.json` except only correlation/timestamp dynamic values.                                      | AC1, R-001, R-002            |
| 3.1-CLI-002      | P0  | CLI contract        | Update success output matches `binding-update-success.json`.                                                                                       | AC2, R-001, R-002            |
| 3.1-CLI-003      | P0  | CLI contract        | Status success output matches `binding-status-success.json`.                                                                                       | AC3, R-001, R-002            |
| 3.1-CLI-004      | P0  | CLI contract        | Rotate success output matches `binding-rotate-success.json`.                                                                                       | AC4, R-001, R-002, R-008     |
| 3.1-CLI-005      | P0  | CLI contract        | Disable success output matches `binding-disable-success.json`.                                                                                     | AC4, R-001, R-002, R-009     |
| 3.1-CLI-006      | P0  | CLI contract        | Malformed create output matches `error-malformed-request.json`, including nonzero exit and redaction flags.                                        | AC5, R-001, R-002            |
| 3.1-CLI-007      | P0  | CLI E2E             | Actual argv dispatch for each of the five verbs emits exactly one JSON document on stdout with no log/prose prefix; success exit is zero.          | AC1–AC4, R-002               |
| 3.1-CLI-008      | P0  | CLI E2E             | Actual malformed invocation emits exactly one failure JSON document, no unstructured stdout, and a nonzero exit.                                   | AC5, R-002                   |
| 3.1-CLI-009      | P1  | CLI integration     | New flags parse before/after the command and are passed as strings without becoming positionals.                                                   | AC1, AC2, R-004              |
| 3.1-CONTRACT-001 | P0  | Contract regression | Every live binding command envelope validates against `workflow-command-envelope.schema.json` with no extra top-level properties.                  | AC2–AC5, R-001, R-010        |
| 3.1-CONTRACT-002 | P1  | Contract regression | All checked-in binding status fixtures still validate, without adding application conformance to the binding-domain family.                        | AC3, R-005, W-002            |
| 3.1-CONTRACT-003 | P0  | Contract regression | Canonical `validate_contracts.py` passes unchanged and contract files have no story edits.                                                         | AC1–AC5, R-001, R-007, R-008 |
| 3.1-CONTRACT-004 | P1  | Contract regression | Fixture comparison excludes only documented dynamic paths; changing any static key/value fails the test.                                           | R-001, R-015                 |
| 3.1-CI-001       | P1  | CI/static           | Bundled PostgreSQL schema is regenerated and contains the provider-binding table marker.                                                           | R-007                        |
| 3.1-CI-002       | P0  | CI/static           | Migration/schema/source scan proves no secret/signing-material column or value was introduced.                                                     | R-008                        |
| 3.1-CI-003       | P1  | CI/static           | New mocked test files run in isolated package batches and pass three consecutive focused runs plus `bun run test`.                                 | R-014                        |
| 3.1-CI-004       | P1  | CI/static           | `bun run validate` passes all generated checks, type-check, zero-warning lint, formatting, and package-isolated tests.                             | R-007, R-013, R-014          |
| 3.1-CI-005       | P1  | CI/review           | Change-scope review finds no server/web/Hermes/event-delivery code and each task records its rollback boundary.                                    | R-013, W-006                 |

### Explicit Waivers

| Waiver                                               | Reason                                                                                                                                                                       | Owner                             | Residual risk                                                                       | Follow-up trigger                                                                                            |
| ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------- | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| W-001 Active stale detection                         | No expected-version input or detection protocol exists; reconciliation is Hermes-owned. Representation is tested by 3.1-UNIT-018.                                            | Workflow Commander contract owner | A truly stale binding may remain reported as its persisted state.                   | Add expected-version/version-comparison semantics or assign staleness detection to Archon.                   |
| W-002 Application validation of `bindings/*.json`    | No application producer/consumer uses `workflow-provider-binding.v1`; a second runtime schema is speculative. Contract fixtures remain covered by 3.1-CONTRACT-002/003.      | Archon architecture owner         | Future runtime code could diverge from the domain fixture family.                   | First accepted Archon caller that reads or emits `workflow-provider-binding.v1`.                             |
| W-003 Top-level actor                                | Closed schemas do not define actor. 3.1-UNIT-034 and 3.1-CONTRACT-001 prove omission rather than incompatibility.                                                            | Workflow Commander contract owner | Binding mutations lack contract-level actor attribution.                            | Schema revision adds actor or an approved nested actor field.                                                |
| W-004 Enforced timeout/cancellation of hung DB calls | No binding CLI timeout/cancel contract or threshold exists. 3.1-UNIT-038 covers an injected timeout error, not enforcement against a never-settling promise.                 | CLI architecture owner            | A stuck DB operation can hang the controller and leave mutation outcome ambiguous.  | Remote controller SLO, explicit timeout flag/default, abort signal, or cancellation contract is accepted.    |
| W-005 Application auth/permission scenarios          | The feature is a local CLI under OS-process permissions with no remote endpoint or role requirement.                                                                         | Security owner                    | Any local user/process with Archon DB access can invoke lifecycle mutations.        | Multi-user deployment, remote execution surface, service account policy, or role requirement is introduced.  |
| W-006 HTTP/UI/Hermes/event-delivery coverage         | These surfaces are explicitly excluded by PRD/architecture and adding them would violate scope.                                                                              | Product + architecture owners     | None for the accepted CLI-only slice; downstream integration remains untested here. | Approved story activates one of those surfaces.                                                              |
| W-007 Shared command-envelope helper                 | Story 3.3a owns the shared builder; local construction is intentionally allowed now. Exact fixture tests contain drift.                                                      | Story 3.3a owner                  | Temporary duplication may drift during later command work.                          | Story 3.3a implementation begins.                                                                            |
| W-008 Maximum input lengths                          | Contract schemas define minimum length but no maximum for provider/name/route. Empty, whitespace, Unicode, and collision behavior are covered; no arbitrary max is invented. | Contract owner                    | Extremely long values may affect DB/storage/CLI behavior.                           | Contract adds maxLength, database index limit is established, or an incident reveals abuse/performance risk. |
| W-009 Update/rotate after disabled                   | The lifecycle transition matrix beyond missing and duplicate-disable cases is unspecified.                                                                                   | Product + architecture owners     | Controllers may observe inconsistent behavior for disabled bindings.                | Must be resolved before Task 3 acceptance or when a fixture defines the transition.                          |
| W-010 Load/performance benchmark                     | No latency/throughput target exists and this is a local single-developer CLI.                                                                                                | Product/operations owner          | Performance regressions lack a numeric gate.                                        | Remote/concurrent service exposure or a command-latency SLO is accepted.                                     |

### Acceptance-Criteria Traceability

| AC  | Atomic coverage / waiver                                                                                    |
| --- | ----------------------------------------------------------------------------------------------------------- |
| AC1 | 3.1-UNIT-001/002/004/006–008/023/024/029; 3.1-INT-001/002/004; 3.1-CLI-001/007                              |
| AC2 | 3.1-UNIT-002–005/025/026; 3.1-INT-005–007; 3.1-CLI-002/007                                                  |
| AC3 | 3.1-UNIT-013–019; 3.1-CLI-003; 3.1-CONTRACT-002; W-001 for active stale detection only                      |
| AC4 | 3.1-UNIT-009–012/032–034/040; 3.1-INT-008–010; 3.1-CLI-004/005/007; 3.1-CONTRACT-001; W-003 and W-009       |
| AC5 | 3.1-UNIT-019–031/035–039; 3.1-CLI-006/008; 3.1-CONTRACT-001/003; W-004 for never-settling cancellation only |

### High-Risk Traceability

| Risk  | P0/P1 scenario coverage / waiver                            |
| ----- | ----------------------------------------------------------- |
| R-001 | 3.1-CLI-001–006; 3.1-CONTRACT-001–004                       |
| R-002 | 3.1-UNIT-020–022/039; 3.1-CLI-001–008; 3.1-CONTRACT-001     |
| R-003 | 3.1-UNIT-002–005; 3.1-INT-001/005–007                       |
| R-004 | 3.1-UNIT-002/004/006–008/017/023–031; 3.1-CLI-009           |
| R-005 | 3.1-UNIT-013–019; 3.1-CONTRACT-002; W-001                   |
| R-006 | 3.1-UNIT-009/037; 3.1-INT-006/008/009                       |
| R-007 | 3.1-UNIT-001; 3.1-INT-001–004/011; 3.1-CI-001/004           |
| R-008 | 3.1-UNIT-009/034; 3.1-CLI-004; 3.1-CONTRACT-003; 3.1-CI-002 |
| R-009 | 3.1-UNIT-010–012/040; 3.1-INT-009/010; W-009                |
| R-010 | 3.1-UNIT-034; 3.1-CONTRACT-001; W-003                       |
| R-011 | 3.1-UNIT-019/035–039                                        |
| R-012 | 3.1-UNIT-027–031; W-008                                     |
| R-013 | 3.1-INT-002/003/011; 3.1-CI-004/005                         |
| R-014 | 3.1-CI-003/004                                              |
| R-015 | 3.1-UNIT-032/033; 3.1-CONTRACT-004                          |
| R-016 | 3.1-UNIT-038; W-004                                         |

### Reviewer-Concern Traceability

| Reviewer concern                                | Scenario or waiver                           |
| ----------------------------------------------- | -------------------------------------------- |
| RC-01 actor gap                                 | 3.1-UNIT-034, 3.1-CONTRACT-001, W-003        |
| RC-02 stale trigger gap                         | 3.1-UNIT-018, 3.1-CONTRACT-002, W-001        |
| RC-03 rotation is version-only                  | 3.1-UNIT-009/034, 3.1-INT-008, 3.1-CI-002    |
| RC-04 route key ambiguity                       | 3.1-UNIT-002/004/008/024/026/029             |
| RC-05/06 contract-family and key/shape mismatch | 3.1-CLI-001–006, 3.1-CONTRACT-001/004        |
| RC-07 binding-family app scope                  | 3.1-CONTRACT-002/003, W-002                  |
| RC-08 project-ref recommendation ambiguity      | 3.1-UNIT-006/007/017, 3.1-CLI-009            |
| RC-09 no-upsert lifecycle                       | 3.1-UNIT-002–005, 3.1-INT-005–007            |
| RC-10 SQLite update-then-select                 | 3.1-UNIT-009/037, 3.1-INT-008/009            |
| RC-11 disable/idempotency/no remove             | 3.1-UNIT-011/012/040, 3.1-INT-009/010, W-009 |
| RC-12 stdout purity                             | 3.1-CLI-007/008                              |
| RC-13 temporary local helper                    | 3.1-CLI-001–006, W-007                       |
| RC-14 immutable contract gate                   | 3.1-CONTRACT-003/004, 3.1-CI-004             |
| RC-15 dual backend/generated schema             | 3.1-INT-001–004/011, 3.1-CI-001/004          |
| RC-16 Bun mock isolation                        | 3.1-CI-003/004                               |
| RC-17 excluded HTTP/UI/Hermes scope             | 3.1-UNIT-040, 3.1-CI-005, W-006              |
| RC-18 new correlation convention                | 3.1-UNIT-032/033, 3.1-CONTRACT-004           |
| RC-19 derived binding ID                        | 3.1-UNIT-030/031                             |
| RC-20 global unique identity                    | 3.1-INT-001/005                              |
| RC-21 local permission boundary                 | W-005                                        |
| RC-22 timeout/cancellation unspecified          | 3.1-UNIT-038, W-004                          |
| RC-23 independent rollback                      | 3.1-INT-002/003/011, 3.1-CI-005              |
| RC-24 partial/dependency failure                | 3.1-UNIT-035–039                             |

### Requested Edge-Class Audit

| Edge class                  | Explicit disposition                                                                                                       |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Happy path                  | 3.1-UNIT-002/004/009/011/014–017; 3.1-CLI-001–005                                                                          |
| Negative path               | 3.1-UNIT-003/005/010/012/019/040                                                                                           |
| Boundary cases              | 3.1-UNIT-027–031; W-008 for undefined maximum length                                                                       |
| Malformed input/JSON        | 3.1-UNIT-020–029/039; 3.1-CLI-006/008                                                                                      |
| Stale data                  | 3.1-UNIT-018/019; W-001                                                                                                    |
| Duplicate actions           | 3.1-INT-005/007/010                                                                                                        |
| Out-of-order events/actions | No event stream exists; update/rotate/disable-before-create are 3.1-UNIT-005/010/012. Disabled-state follow-ons use W-009. |
| Partial failure             | 3.1-UNIT-037/039; 3.1-INT-011                                                                                              |
| Dependency failure          | 3.1-UNIT-035/036/038                                                                                                       |
| Timeout                     | 3.1-UNIT-038; enforcement gap W-004                                                                                        |
| Cancellation                | No cancel surface; W-004                                                                                                   |
| Concurrency/race            | 3.1-INT-005/006/008/009                                                                                                    |
| Rollback                    | 3.1-INT-002/003/011; 3.1-CI-005                                                                                            |
| Permission/auth             | Local trust boundary W-005                                                                                                 |
| Regression                  | 3.1-CONTRACT-003/004; 3.1-CI-001/003/004/005                                                                               |

### NFR Evidence Plan

| NFR                        | Scenarios                          | Evidence artifact for later assessment                                   |
| -------------------------- | ---------------------------------- | ------------------------------------------------------------------------ |
| Security                   | UNIT-034, CONTRACT-001/003, CI-002 | Bun test results, validator output, secret/forbidden-key scan            |
| Reliability/data integrity | UNIT-002–019/035–038, INT-001–011  | Focused Bun reports and deterministic race/upgrade logs                  |
| Compatibility              | CLI-001–009, CONTRACT-001–004      | Raw captured stdout/exit results, fixture diffs, schema-validator output |
| Auditability               | UNIT-011/032/033, INT-010, W-003   | Metadata assertions, row-retention result, actor waiver                  |
| Maintainability            | CI-001/003/004/005                 | `bun run validate` log and package-script diff                           |
| Performance/scalability    | W-004, W-010                       | No final assessment until a threshold exists                             |
| Permission/auth            | W-005                              | Security waiver and re-review trigger                                    |

### Execution Strategy

- **Per task/PR:** Run all relevant P0/P1 focused files, the contract validator, generated-schema check, and then `bun run validate`. All deterministic functional scenarios belong in PR because the existing full suite is the official gate.
- **Nightly:** Burn in 3.1-INT-005/006/008/009 and CI-003 for 20–50 iterations if CI provides a scheduled lane; failures are treated as race defects, not quarantined flakes.
- **Weekly:** No separate performance/browser suite. Add live PostgreSQL smoke only if the project establishes a reusable container-backed DB test lane; do not add new runtime infrastructure solely for this story.

### Resource Estimate

| Priority                                                   | Estimate                                                         |
| ---------------------------------------------------------- | ---------------------------------------------------------------- |
| P0 scenarios and harness                                   | ~28–44 hours                                                     |
| P1 scenarios, races, backend upgrades, and fault injection | ~32–52 hours                                                     |
| P2 exploratory/burn-in support                             | ~4–8 hours                                                       |
| P3                                                         | ~0–4 hours                                                       |
| Total                                                      | ~64–108 hours, roughly 8–14 engineering days for one implementer |

### Quality Gates

- P0 pass rate: 100%; no skips or retries masking failure.
- P1 pass rate: 100% for this deterministic controller/data contract, stricter than the generic 95% floor.
- Acceptance-criterion, high-risk, and reviewer-concern disposition coverage: 100% scenario-or-waiver traceability.
- All score-6+ risks have implemented P0/P1 scenarios; waivers include owner, residual risk, and trigger.
- Canonical contract validator and exact fixture comparisons pass with no contract-package edits.
- SQLite, PostgreSQL combined schema, and bundled schema stay synchronized.
- Requirements/risk coverage target: 100%. If code coverage is reported, changed lifecycle modules should meet at least 80% line coverage; code coverage is supporting evidence, not a substitute for scenario traceability.
- Every in-scope NFR has an identified evidence source; final NFR PASS/CONCERNS/FAIL is deferred to `nfr-assess` after implementation.
- `bun run validate` passes in full.
- Clarification gates before acceptance: ratify project-ref normalization, input canonicalization, duplicate-disable result, and disabled-state transition behavior. W-004/W-005/W-008/W-010 may remain only with named-owner acceptance.

## Step 5: Generate Output

Execution mode: epic-level single-worker output under the workflow's single-artifact default.

Final output written: `_bmad-output/test-artifacts/test-design-epic-3.md`.

Validation completed:

- 69 unique atomic scenarios: 24 P0 and 45 P1.
- All five acceptance criteria map to scenarios or an explicit waiver for the undefined remainder.
- All 16 score-6+ risks map to P0/P1 scenarios; waivers identify owner, residual risk, and trigger.
- All 24 reviewer concerns are classified as risks or explicit non-risks and map to scenarios or waivers.
- Happy, negative, boundary, malformed, stale, duplicate, out-of-order, partial-failure, dependency-failure, timeout, cancellation, concurrency/race, rollback, permission/auth, and regression classes are explicitly disposed.
- Markdown formatting and `git diff --check` pass.
- Canonical Workflow Commander contract validation passes unchanged.
- No browser session was opened and no temporary exploration artifact was created.

---

# Test Design Progress: 3.3a Define Shared Workflow Provider Command Envelope

## Step 1: Detect Mode

Mode selected: Epic-Level.

Reason: the input is a story-level implementation artifact with explicit acceptance criteria, tasks, dev notes, predecessor intelligence, and reviewer-remediation context.
The target path was described as not yet written, but `_bmad-output/implementation-artifacts/3-3a-define-shared-workflow-provider-command-envelope.md` exists in the current worktree and is treated as the current source of truth for this run.

Prerequisite result: PASS.
The story provides acceptance criteria and implementation scope.
Architecture, PRD, epic, contract, predecessor-story, and implementation-readiness artifacts are available for Step 2 context loading.

## Step 2: Load Context

Configuration loaded: Playwright utils enabled; Pact.js utils disabled; Pact MCP disabled; browser automation `auto`; stack detection `auto`; test artifacts rooted at `_bmad-output/test-artifacts`.

Detected project stack: full-stack Bun + strict TypeScript monorepo.
Story-local scope is headless CLI/contract code under `@archon/cli`; no HTTP route, web UI, browser, server route, core DB schema, workflow engine runtime conversion, or Hermes-owned consumer behavior is in scope.

Loaded requirements and architecture: Story 3.3a, FR-8, Epic 3 boundaries, Architecture AD-3/7/8/9, provider command syntax baseline, implementation-readiness evidence, sprint-change remediation for `error.retryable`, project context, command-envelope schema, all 17 Archon command fixtures, Story 3.1 predecessor test design, and current CLI/provider-binding implementation and tests.

Canonical contract validation: PASS.
The validator reports 7 schemas, 17 command examples, 13 binding examples, 7 delivery examples, 6 generic event examples, 7 provider event examples, 9 callback rejection examples, 6 materialization examples, and isolated local package validation without parent workspace traversal.

Testable requirements extracted: shared success and failure builders; exact command enum union; exact diagnostic category union; mandatory `error.retryable`; result/error exclusivity; success reference requirements by command family; failure refs omitted by default; reusable safe stringify, correlation id, and timestamp helpers; provider-binding refactor without output-shape drift; provider CLI syntax baseline coverage for all command enum values; `workflow.cancel`/`workflow.retry` syntax protection; forbidden-field/secret scans; process-isolated Bun test placement; and preservation of Story 3.1 exact fixture regressions.

Integration points: CLI parser and `--json` log-silence behavior; `provider-binding.ts` local helper extraction; new `workflow-provider-command-envelope.ts`; provider-binding unit/contract/E2E tests; `packages/cli/package.json` test batching; checked-in command fixtures; and the canonical Python contract validator.

Existing test patterns: Bun unit tests with process-global `mock.module()` isolation; fixture equality with narrow dynamic-field exclusion; recursive forbidden-key/secret scans; subprocess CLI E2E harness using `Bun.spawn`; package scripts that split mocked tests into separate processes; and contract regression tests that import JSON files directly from `_bmad-output`.

Known coverage gaps: no shared envelope helper exists yet; provider-binding still owns local envelope construction; no dedicated `workflow-provider-command-envelope.test.ts` exists; provider command syntax baseline is not yet executable against a shared constant; workflow command runtime outputs intentionally remain legacy JSON until later stories; no application JSON Schema runtime dependency should be added to `@archon/cli`.

Browser exploration: not applicable.
The approved surface is CLI JSON only, repository scan found no relevant browser target for this story, and no target URL exists.
Playwright CLI and API/headless fragments were loaded for workflow compliance, but the selected project test levels remain Bun unit, Bun CLI integration/E2E, contract regression, and CI/static checks.

## Step 3: Risk and Testability

Risk scale: Probability and Impact use 1 low, 2 medium, 3 high; score is P x I.
Scores 6-8 require mitigation and score 9 is blocking unless explicitly waived.
Priority is promoted to P0/P1 whenever a failure can break core behavior, security, data integrity, compatibility, or cross-process contract behavior.

### Risk Register

| ID         | Category    | Risk                                                                                                                                                      |   P |   I | Score | Priority | Mitigation and evidence                                                                                                        | Owner / timeline                                    |
| ---------- | ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | --: | --: | ----: | -------- | ------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------- |
| 3.3A-R-001 | TECH / BUS  | The helper command union drifts from `workflow-command-envelope.schema.json`, so producers emit unknown or missing command identifiers.                   |   3 |   3 |     9 | P0       | Schema-enum exactness test, baseline table coverage for all 12 values, canonical validator, no duplicated untested arrays.     | CLI implementer + contract reviewer / Task 3        |
| 3.3A-R-002 | TECH / BUS  | Success/failure builders violate closed top-level schema, result/error exclusivity, or command-family reference requirements.                             |   3 |   3 |     9 | P0       | Builder unit tests for success/failure shape, no extra top-level keys, workflow/binding refs, and schema fixture equality.     | CLI implementer / Tasks 1 and 3                     |
| 3.3A-R-003 | BUS / OPS   | Failure envelopes omit `error.retryable`, use open diagnostic categories, or lose stable code/details, preventing controllers from retrying safely.       |   3 |   3 |     9 | P0       | Mandatory boolean input type, negative compile/runtime tests, all five checked-in failure examples covered.                    | CLI implementer + contract owner / Task 1           |
| 3.3A-R-004 | BUS / DATA  | Refactoring provider-binding to the shared helper changes Story 3.1 output, fixture equality, binding refs, error details, or exit behavior.              |   3 |   3 |     9 | P0       | Re-run exact provider-binding fixture tests, E2E malformed/unsupported subprocess tests, narrow dynamic-field exclusions.      | Story 3.3a owner / Task 2                           |
| 3.3A-R-005 | OPS / BUS   | Fail-closed controller outcomes for malformed JSON, schema mismatch, timeout, unexpected exit, and unexpected state are not buildable or fixture-aligned. |   2 |   3 |     6 | P0       | Representative failure-builder tests for all failure examples, execution redaction assertions, no prose/stdout parsing.        | CLI implementer / Tasks 1 and 3                     |
| 3.3A-R-006 | BUS / TECH  | Provider CLI syntax and canonical command id drift, especially `workflow.cancel` vs legacy `abandon` and `workflow.retry` vs streaming `retry-node`.      |   3 |   3 |     9 | P0       | Syntax baseline tests for every command, explicit negative assertions for `abandon` and `retry-node`, future story gate.       | CLI implementer + architecture reviewer / Task 3    |
| 3.3A-R-007 | TECH        | Generic helper absorbs binding-specific or workflow-specific classification policy and couples unrelated command families.                                |   2 |   3 |     6 | P1       | Keep classification outside helper unless command-generic; tests prove provider-binding classification remains local.          | CLI implementer / Tasks 1 and 2                     |
| 3.3A-R-008 | TECH / OPS  | Production CLI imports `_bmad-output` planning artifacts or adds a JSON Schema runtime dependency to validate envelopes.                                  |   2 |   3 |     6 | P1       | Production imports test, dependency/package diff review, constants in source tested against contract schema only in tests.     | CLI implementer + reviewer / Task 1                 |
| 3.3A-R-009 | BUS / OPS   | `--json` output becomes multiple lines, logs/prose leak, or non-serializable values break JSON serialization.                                             |   3 |   3 |     9 | P0       | Raw stdout/stderr subprocess tests, safeStringify circular/bigint/function tests, global log-silence regression.               | CLI implementer / Tasks 1-4                         |
| 3.3A-R-010 | TECH / OPS  | New tests using `mock.module()` are batched with incompatible files, causing process-global pollution and order-dependent results.                        |   3 |   2 |     6 | P1       | Put mocked tests in isolated package script invocation; non-mocking helper tests may share contract batch; repeat focused run. | Test implementer / Task 3                           |
| 3.3A-R-011 | TECH / OPS  | Scope creep converts workflow runtime JSON, core DB, server routes, web UI, workflow engine, or bundled contract artifacts in this story.                 |   2 |   3 |     6 | P1       | Static file-scope review, regression that workflow command outputs remain out of scope, no contract-package edits.             | Story owner + reviewer / every task gate            |
| 3.3A-R-012 | SEC / BUS   | Shared helper emits forbidden `actor`, `profile`, `agent*`, raw secret, signing material, stdout, or stderr content.                                      |   2 |   3 |     6 | P0       | Recursive forbidden-key scan, secret/signing-material scan including new helper, execution redacted-flag assertions.           | Security reviewer + CLI implementer / Tasks 1 and 3 |
| 3.3A-R-013 | BUS / OPS   | Correlation id or issued-at timestamp generation/preservation changes, becomes blank, non-ISO, or unstable in one envelope.                               |   2 |   3 |     6 | P1       | Inject fixed metadata in builder tests; generated UUID/date-time tests; preserve supplied correlation id semantics.            | CLI implementer / Task 1                            |
| 3.3A-R-014 | TECH / BUS  | Future command stories depend on an incomplete helper, because baseline tests cover examples but not helper command/ref constraints for all commands.     |   3 |   3 |     9 | P0       | Representative success builders for every command family and fixture-driven command list, even before runtime conversions.     | CLI implementer + future story owners / Task 3      |
| 3.3A-R-015 | TECH / BUS  | Dynamic-field exclusions widen during fixture comparison and hide static drift in provider-binding or command fixtures.                                   |   2 |   3 |     6 | P1       | Contract test locks documented dynamic paths; fixture comparisons strip only correlation/time/duration fields.                 | Test implementer / Task 4                           |
| 3.3A-R-016 | TECH / DATA | Builder input types allow blank provider/name/ref/command fields, producing schema-minLength violations or ambiguous refs.                                |   2 |   3 |     6 | P1       | Runtime guard or typed non-empty normalization tests for builder-required fields; malformed input remains command-local.       | CLI implementer / Task 1                            |
| 3.3A-R-017 | PERF / OPS  | No runtime latency, cancellation, or command-timeout SLO exists for the helper itself; timeout is only a representable failure envelope.                  |   1 |   2 |     2 | P3       | Waive runtime timeout guarantees for this story; cover timeout envelope construction only.                                     | CLI architecture owner / follow-up on accepted SLO  |

### Reviewer-Evidence Disposition

| Concern                                                                                                | Disposition                                                                              |   P |   I | Score | Linked item            |
| ------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------- | --: | --: | ----: | ---------------------- |
| RC-01 Story 3.3a previously failed to trace contract-required `error.retryable`.                       | Risk: controller retry semantics break if omitted or optional.                           |   3 |   3 |     9 | 3.3A-R-003             |
| RC-02 Schema enum is the source of truth for all command ids.                                          | Critical compatibility risk if source constants drift.                                   |   3 |   3 |     9 | 3.3A-R-001             |
| RC-03 The command-envelope schema is closed at the top level.                                          | Critical compatibility/security risk if extra runtime-only fields are emitted.           |   3 |   3 |     9 | 3.3A-R-002, 3.3A-R-012 |
| RC-04 Success requires `result`, failure requires `error`, and refs are conditional by command family. | Critical compatibility risk.                                                             |   3 |   3 |     9 | 3.3A-R-002             |
| RC-05 Provider syntax baseline must cover all 12 command ids.                                          | Critical drift risk for external controllers.                                            |   3 |   3 |     9 | 3.3A-R-006, 3.3A-R-014 |
| RC-06 `workflow.cancel` is not legacy `workflow abandon`.                                              | Critical command-contract risk.                                                          |   3 |   3 |     9 | 3.3A-R-006             |
| RC-07 `workflow.retry` is not existing streaming-only `workflow retry-node`.                           | Critical command-contract risk.                                                          |   3 |   3 |     9 | 3.3A-R-006             |
| RC-08 Story 3.1 waiver W-007 said Story 3.3a owns shared-builder extraction.                           | Now a required regression obligation, not a non-risk.                                    |   3 |   3 |     9 | 3.3A-R-004             |
| RC-09 Provider-binding exact fixtures must continue to pass after refactor.                            | Critical compatibility regression risk.                                                  |   3 |   3 |     9 | 3.3A-R-004             |
| RC-10 `safeStringify`, correlation-id, and issued-at helpers move from local code.                     | Risk if behavior changes during extraction.                                              |   2 |   3 |     6 | 3.3A-R-009, 3.3A-R-013 |
| RC-11 Binding lifecycle classification should remain local to `provider-binding.ts`.                   | Risk of fat helper/coupled policy.                                                       |   2 |   3 |     6 | 3.3A-R-007             |
| RC-12 Story scope excludes DB, migrations, server, web, workflow engine, event outbox, and Hermes.     | Explicit non-risk only if no files in those surfaces change.                             |   2 |   3 |     6 | 3.3A-R-011             |
| RC-13 Contract package is immutable and validator-gated.                                               | Risk if schemas/fixtures are edited to fit runtime.                                      |   2 |   3 |     6 | 3.3A-R-001, 3.3A-R-008 |
| RC-14 Do not add a JSON Schema runtime dependency in `@archon/cli`.                                    | Maintainability/package-boundary risk.                                                   |   2 |   3 |     6 | 3.3A-R-008             |
| RC-15 `mock.module()` pollution requires package-test isolation.                                       | Test reliability risk.                                                                   |   3 |   2 |     6 | 3.3A-R-010             |
| RC-16 Forbidden fields include raw secrets/signatures and Hermes-specific actor/profile/agent keys.    | Security and compatibility risk.                                                         |   2 |   3 |     6 | 3.3A-R-012             |
| RC-17 Failure examples require execution metadata with redacted stdout/stderr flags.                   | Fail-closed compatibility risk.                                                          |   2 |   3 |     6 | 3.3A-R-005, 3.3A-R-009 |
| RC-18 Dynamic-field exclusions must stay narrow.                                                       | Regression-mask risk.                                                                    |   2 |   3 |     6 | 3.3A-R-015             |
| RC-19 Workflow runtime command outputs remain legacy until Stories 3.3b-3.3d.                          | Explicit non-risk for this story; converting them now is scope creep.                    |   1 |   3 |     3 | W-3.3A-001             |
| RC-20 Later stories must use the helper created here.                                                  | Risk if helper lacks representative workflow command coverage.                           |   3 |   3 |     9 | 3.3A-R-014             |
| RC-21 Browser, HTTP API, web UI, event delivery, and Hermes consumer behavior are excluded.            | Explicit non-risk under accepted headless CLI boundary.                                  |   1 |   2 |     2 | W-3.3A-002             |
| RC-22 Timeout/cancellation runtime behavior is not implemented by this helper.                         | Explicit waiver for runtime timeout guarantees; envelope representation remains covered. |   1 |   2 |     2 | 3.3A-R-017, W-3.3A-003 |
| RC-23 No application permission/auth policy exists for local CLI helper construction.                  | Explicit non-risk under current OS-process trust boundary.                               |   1 |   3 |     3 | W-3.3A-004             |

### NFR Planning

| NFR                         | In scope / threshold                                                                                                                                                     | Planned evidence                                                                                                                |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------- |
| Security                    | In scope. Zero raw secret/signature material; zero forbidden `actor`, `profile`, `agent`, `agent_name`, or `agent_provider` keys; failure execution output is redacted.  | Recursive envelope scan, source secret scan including new helper, fixture/schema validation, provider-binding regression tests. |
| Reliability                 | In scope. Builders never emit invalid success/failure combinations; non-serializable values still produce one JSON document; all fail-closed examples are representable. | Builder unit tests, safeStringify tests, failure-example tests, subprocess stdout/stderr purity checks.                         |
| Cross-process compatibility | In scope. Every envelope is `workflow-command-envelope.v1`, uses canonical command ids, obeys reference requirements, and remains fixture-compatible.                    | Schema enum exactness, syntax baseline tests, exact provider-binding fixture comparisons, canonical validator.                  |
| Data integrity              | Narrowly in scope through regression only. No DB state changes are owned, but provider-binding refactor must not change binding refs or lifecycle result payloads.       | Story 3.1 provider-binding unit/E2E/contract regression suite.                                                                  |
| Maintainability             | In scope. Strict TypeScript, no `any`, no production dependency on planning artifacts, no new JSON Schema runtime dependency, package-isolated tests.                    | Type-check, package script diff, production import scan, repeated focused Bun invocations, full `bun run validate`.             |
| Performance / scalability   | UNKNOWN. No latency, throughput, or cancellation threshold is defined for local CLI envelope construction.                                                               | Waiver W-3.3A-003; only timeout-envelope construction is validated.                                                             |
| Permission / authorization  | Current requirement is local CLI under OS-process trust; no remote or role-based policy is introduced.                                                                   | Waiver W-3.3A-004 and static scope review that no HTTP/server/web surface is added.                                             |
| Compliance                  | No regulatory requirement is stated. Contract traceability is project quality evidence, not a compliance claim.                                                          | Validator output and traceability matrix.                                                                                       |

### Highest-Priority Findings

P0 acceptance blockers are 3.3A-R-001 through 3.3A-R-006, 3.3A-R-009, 3.3A-R-012, and 3.3A-R-014.
They cover enum/source-of-truth drift, invalid envelope shape, missing retryability, provider-binding fixture regression, fail-closed failure semantics, syntax drift, pure JSON output, forbidden-field/secret leakage, and future command-family usability.

All high-risk items require explicit P0/P1 scenarios in Step 4.
No reviewer concern is treated as optional advice.

## Step 4: Coverage Plan and Execution Strategy

### Test-Level Allocation

- **Unit (Bun):** shared envelope builders, typed constants, metadata helpers, safe serialization, failure shape, and provider-binding command-unit regressions through existing mocked DB seams.
- **CLI integration / E2E (Bun subprocess):** actual `archon provider-binding ... --json` parsing, stdout/stderr purity, exit codes, malformed argv, unsupported subcommands, and no-git bypass behavior.
- **Contract/static regression:** checked-in command fixtures, command-envelope schema enum/category assertions, canonical Python validator, forbidden-field/secret scans, dependency/import checks, and package-script isolation.
- **CI validation:** focused CLI tests, `bun --filter @archon/cli type-check`, and final `bun run validate`.

No API route, browser E2E, component, server, web, workflow-engine runtime conversion, or Hermes consumer test level applies to this story.
Overlap is allowed only on P0 cross-process JSON contract paths, where each level proves a different property.

### Atomic Scenario Catalog

| ID                | Pri | Level               | Atomic scenario                                                                                                                                                                                              | Trace                        |
| ----------------- | --- | ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------- |
| 3.3A-UNIT-001     | P0  | Unit/contract       | The exported `WorkflowProviderCommand` values exactly equal the schema enum, with no missing, extra, reordered-by-hand, or duplicate command ids.                                                            | AC3, R-001, RC-02            |
| 3.3A-UNIT-002     | P0  | Unit/contract       | The exported diagnostic category values exactly equal the schema enum: `configuration`, `external_delay`, `implementation_defect`, `provider_contract`, `security_rejection`, `timeout`, `unexpected_state`. | AC2, R-003                   |
| 3.3A-UNIT-003     | P0  | Unit                | A workflow success envelope includes static metadata, `success: true`, `workflowRunRef`, and `result`, and omits `error`.                                                                                    | AC1, R-002                   |
| 3.3A-UNIT-004     | P0  | Unit                | A binding success envelope includes static metadata, `success: true`, `bindingRef`, and `result`, and omits `error`.                                                                                         | AC1, R-002                   |
| 3.3A-UNIT-005     | P0  | Unit                | Building a successful `workflow.*` envelope without `workflowRunRef` fails before serialization.                                                                                                             | AC1, R-002, R-016            |
| 3.3A-UNIT-006     | P0  | Unit                | Building a successful `binding.*` envelope without `bindingRef` fails before serialization.                                                                                                                  | AC1, R-002, R-016            |
| 3.3A-UNIT-007     | P0  | Unit                | A failure envelope requires a boolean `retryable` value and serializes `code`, `category`, `retryable`, and `details`.                                                                                       | AC2, R-003, RC-01            |
| 3.3A-UNIT-008     | P0  | Unit                | Failure envelopes omit `result`, omit refs by default, include `execution` when supplied, and remain closed-schema compatible.                                                                               | AC2, AC4, R-002, R-005       |
| 3.3A-UNIT-009     | P0  | Unit                | Attempts to build an envelope with both `result` and `error`, or neither, are rejected.                                                                                                                      | AC1, AC2, R-002              |
| 3.3A-UNIT-010     | P0  | Unit                | `safeStringify` emits one parseable JSON string for bigint, functions, and circular data.                                                                                                                    | AC4, R-009                   |
| 3.3A-UNIT-011     | P1  | Unit                | Supplied nonblank correlation id is preserved consistently within one envelope; blank/absent id generates a UUID.                                                                                            | AC1, AC2, R-013              |
| 3.3A-UNIT-012     | P1  | Unit                | `issuedAt` is generated as valid ISO date-time and remains stable for the built envelope.                                                                                                                    | AC1, AC2, R-013              |
| 3.3A-UNIT-013     | P1  | Unit                | Invalid command/category values cannot be passed through normal typed APIs; forced invalid casts fail a runtime guard before output.                                                                         | AC2, AC3, R-001, R-016       |
| 3.3A-UNIT-014     | P0  | Unit                | Failure helpers can build the five canonical failure classes: malformed request, schema mismatch, timeout, unexpected exit, and unexpected state.                                                            | AC2, AC4, R-003, R-005       |
| 3.3A-UNIT-015     | P1  | Unit                | Timeout and unexpected-exit envelopes carry correct `execution.exitCode`, `timedOut`, `durationMs`, `stdoutRedacted`, and `stderrRedacted`.                                                                  | AC4, R-005, R-009            |
| 3.3A-UNIT-016     | P0  | Unit/static         | Recursive scan of representative envelopes rejects forbidden `actor`, `profile`, `agent`, `agent_name`, `agent_provider`, `secret`, signing-key, stdout, and stderr material.                                | AC1-AC4, R-012, RC-16        |
| 3.3A-UNIT-017     | P1  | Static              | Production helper imports no `_bmad-output` planning artifacts, JSON schemas, fixtures, Python scripts, or test-only contract files.                                                                         | R-008, RC-13                 |
| 3.3A-UNIT-018     | P1  | Static              | `@archon/cli` gains no JSON Schema runtime dependency just to validate command envelopes.                                                                                                                    | R-008, RC-14                 |
| 3.3A-UNIT-019     | P1  | CI/static           | If `workflow-provider-command-envelope.test.ts` uses no `mock.module()`, it may share a non-mocking batch; if it mocks modules, it must run in its own Bun process.                                          | R-010, RC-15                 |
| 3.3A-UNIT-020     | P0  | Unit regression     | `providerBindingCreateCommand` still matches `binding-create-success.json` excluding only documented dynamic fields.                                                                                         | AC1, R-004                   |
| 3.3A-UNIT-021     | P0  | Unit regression     | `providerBindingUpdateCommand` still matches `binding-update-success.json`.                                                                                                                                  | AC1, R-004                   |
| 3.3A-UNIT-022     | P0  | Unit regression     | `providerBindingStatusCommand` still matches `binding-status-success.json` for active binding.                                                                                                               | AC1, R-004                   |
| 3.3A-UNIT-023     | P0  | Unit regression     | `providerBindingRotateCommand` still matches `binding-rotate-success.json`.                                                                                                                                  | AC1, R-004                   |
| 3.3A-UNIT-024     | P0  | Unit regression     | `providerBindingDisableCommand` still matches `binding-disable-success.json`.                                                                                                                                | AC1, R-004                   |
| 3.3A-UNIT-025     | P0  | Unit regression     | Malformed provider-binding create still matches `error-malformed-request.json` and includes `retryable: false`.                                                                                              | AC2, AC4, R-003, R-004       |
| 3.3A-UNIT-026     | P1  | Unit regression     | Unsupported provider-binding subcommand fails closed with `/command` unsupported field error and no mutation.                                                                                                | AC4, R-004, R-009            |
| 3.3A-UNIT-027     | P1  | Unit regression     | Binding-specific lifecycle classification, such as disabled update and concurrent modification, remains local and unchanged.                                                                                 | R-007, RC-11                 |
| 3.3A-UNIT-028     | P1  | Unit regression     | DB timeout-shaped errors still map to `category: "timeout"` and `execution.timedOut: true`.                                                                                                                  | AC4, R-005                   |
| 3.3A-UNIT-029     | P1  | Unit regression     | Non-serializable provider-binding errors still produce exactly one parseable failure envelope.                                                                                                               | AC4, R-009                   |
| 3.3A-UNIT-030     | P1  | Contract regression | Dynamic-field exclusion list remains narrow and documented; adding new excluded static fields fails the test.                                                                                                | R-015, RC-18                 |
| 3.3A-UNIT-031     | P1  | Static/refactor     | `provider-binding.ts` imports shared helpers and no longer defines duplicate local `buildSuccessEnvelope`, `buildErrorEnvelope`, `safeStringify`, `resolveCorrelationId`, or `resolveIssuedAt`.              | R-004, RC-08, RC-10          |
| 3.3A-UNIT-032     | P1  | Static/refactor     | Binding-specific validation, project-ref normalization, `buildBindingRef`, DB calls, status states, and lifecycle classification remain in `provider-binding.ts`.                                            | R-007, R-011                 |
| 3.3A-CONTRACT-033 | P0  | Contract            | Provider syntax baseline table covers all 12 schema enum values with exact syntax from architecture/epics.                                                                                                   | AC3, R-006, R-014, RC-05     |
| 3.3A-CONTRACT-034 | P0  | Contract            | `workflow.cancel` baseline is `archon workflow cancel <run-id> --json`; legacy `workflow abandon` is not accepted as Workflow Commander syntax.                                                              | AC3, R-006, RC-06            |
| 3.3A-CONTRACT-035 | P0  | Contract            | `workflow.retry` baseline is `archon workflow retry <run-id> [--node <node-id>] --json`; streaming `retry-node` is not accepted.                                                                             | AC3, R-006, RC-07            |
| 3.3A-CONTRACT-036 | P1  | Static              | Story 3.3a does not convert `packages/cli/src/commands/workflow.ts` runtime output; later stories own runtime conversions.                                                                                   | R-011, RC-19, W-3.3A-001     |
| 3.3A-CONTRACT-037 | P0  | Contract/unit       | Representative success envelopes for every command family prove future command stories can use the helper without adding command ids.                                                                        | AC1, AC3, R-014, RC-20       |
| 3.3A-CONTRACT-038 | P0  | Contract/unit       | `error-malformed-request.json` can be built by the shared failure helper and remains validator-compatible.                                                                                                   | AC2, AC4, R-005              |
| 3.3A-CONTRACT-039 | P0  | Contract/unit       | `error-schema-mismatch.json` can be built by the shared failure helper and remains validator-compatible.                                                                                                     | AC2, AC4, R-005              |
| 3.3A-CONTRACT-040 | P0  | Contract/unit       | `error-timeout.json` can be built by the shared failure helper with retryable timeout semantics.                                                                                                             | AC2, AC4, R-005, R-017       |
| 3.3A-CONTRACT-041 | P0  | Contract/unit       | `error-unexpected-exit.json` can be built by the shared failure helper with redacted execution metadata.                                                                                                     | AC2, AC4, R-005              |
| 3.3A-CONTRACT-042 | P0  | Contract/unit       | `error-unexpected-state.json` can be built by the shared failure helper with `mutationApplied: false`.                                                                                                       | AC2, AC4, R-005              |
| 3.3A-CLI-043      | P0  | CLI E2E             | `archon provider-binding create --json` with malformed args outside a git repo emits exactly one failure JSON document, no stderr, and exit 64.                                                              | AC4, R-004, R-009            |
| 3.3A-CLI-044      | P1  | CLI E2E             | Missing string flag value before `--json` does not swallow `--json`; output remains one failure envelope.                                                                                                    | AC4, R-009                   |
| 3.3A-CLI-045      | P1  | CLI E2E             | Unsupported provider-binding subcommand such as `remove` fails closed with nonzero exit and no human prose in stdout.                                                                                        | AC4, R-004, R-009            |
| 3.3A-CLI-046      | P0  | CLI E2E             | `--json` mode emits no Pino/log/prose lines to stdout or stderr for success, malformed input, and unsupported command paths.                                                                                 | AC4, R-009, RC-17            |
| 3.3A-CONTRACT-047 | P0  | Contract            | `validate_contracts.py` passes unchanged after implementation.                                                                                                                                               | AC1-AC4, R-001, R-004, R-008 |
| 3.3A-CONTRACT-048 | P1  | Static              | No files under `_bmad-output/planning-artifacts/contracts/workflow-commander/` are modified to make runtime output pass.                                                                                     | R-008, R-011, RC-13          |
| 3.3A-CI-049       | P0  | CI/static           | Source scan includes the new shared helper and provider-binding command file for raw secrets, signing material, and forbidden Hermes fields.                                                                 | R-012                        |
| 3.3A-CI-050       | P1  | CI/static           | `packages/cli/package.json` keeps `provider-binding.test.ts` isolated and wires the new helper test into an appropriate isolated or non-mocking batch.                                                       | R-010                        |
| 3.3A-CI-051       | P1  | CI/static           | `bun --filter @archon/cli type-check` passes with strict types and no `any` escape for the helper API.                                                                                                       | R-008, R-016                 |
| 3.3A-CI-052       | P1  | CI/static           | `bun run validate` passes before review.                                                                                                                                                                     | R-010, R-011, R-015          |
| 3.3A-CI-053       | P1  | Review/static       | Final file scope is limited to expected CLI helper, provider-binding refactor, provider-binding tests, helper tests, and package script wiring.                                                              | R-011, W-3.3A-002            |
| 3.3A-UNIT-054     | P1  | Unit regression     | Provider-binding stale status remains representable and untouched by the helper extraction.                                                                                                                  | R-004, stale-data edge       |
| 3.3A-UNIT-055     | P1  | Unit regression     | Duplicate provider-binding create still returns non-upsert failure semantics after refactor.                                                                                                                 | R-004, duplicate-action edge |
| 3.3A-UNIT-056     | P1  | Unit                | Parallel helper calls generate independent envelopes without shared mutable state or cross-call metadata leakage.                                                                                            | R-013, concurrency/race edge |
| 3.3A-CI-057       | P1  | Review/static       | Rollback review confirms the helper extraction can be reverted without DB/schema/contract-package rollback.                                                                                                  | R-011, rollback edge         |

### Required Edge-Class Disposition

| Edge class          | Scenario or waiver                                                                                                                             |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Happy path          | 3.3A-UNIT-003/004/020-024/037                                                                                                                  |
| Negative path       | 3.3A-UNIT-007-009/025-029; 3.3A-CONTRACT-038-042                                                                                               |
| Boundary cases      | 3.3A-UNIT-005/006/011-013/016; 3.3A-CLI-044                                                                                                    |
| Malformed input     | 3.3A-UNIT-025; 3.3A-CONTRACT-038; 3.3A-CLI-043/044                                                                                             |
| Stale data          | 3.3A-UNIT-054 preserves Story 3.1 stale-status representability; active stale detection remains Story 3.1 waiver scope, not new 3.3a behavior. |
| Duplicate actions   | 3.3A-UNIT-055 preserves duplicate create/non-upsert behavior; helper itself has no mutation action.                                            |
| Out-of-order events | W-3.3A-005, because Story 3.3a has no event ingestion, event outbox, or callback ordering surface.                                             |
| Partial failure     | 3.3A-UNIT-028/029; 3.3A-CONTRACT-041/042                                                                                                       |
| Dependency failure  | 3.3A-UNIT-028/029; provider-binding dependency failures remain existing mocked DB seams.                                                       |
| Timeout             | 3.3A-CONTRACT-040 and 3.3A-UNIT-015 cover representation; W-3.3A-003 covers runtime timeout ownership.                                         |
| Cancellation        | W-3.3A-003 for runtime cancellation; 3.3A-CONTRACT-034 protects the future `workflow.cancel` syntax.                                           |
| Concurrency/race    | 3.3A-UNIT-056 for helper statelessness; DB concurrency is not changed by this story.                                                           |
| Rollback            | 3.3A-CI-057 and 3.3A-CONTRACT-048.                                                                                                             |
| Permission/auth     | W-3.3A-004.                                                                                                                                    |
| Regression          | 3.3A-UNIT-020-032; 3.3A-CLI-043-046; 3.3A-CONTRACT-047/048.                                                                                    |

### Acceptance Criteria Traceability

| AC                                                                                                                                 | Scenarios / waivers                                                                                                               |
| ---------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| AC1 success envelope includes schema version, success flag, correlation id, refs when applicable, and result payload               | 3.3A-UNIT-003-006/011/012/020-024/037                                                                                             |
| AC2 failure envelope includes schema version, success flag, correlation id if available, code, category, retryability, and details | 3.3A-UNIT-002/007-009/011/012/014/015/025; 3.3A-CONTRACT-038-042                                                                  |
| AC3 implemented provider command syntax with `--json` returns canonical command and tests fail on syntax/id drift                  | 3.3A-UNIT-001; 3.3A-CONTRACT-033-037; W-3.3A-001 for runtime conversions owned by later stories                                   |
| AC4 malformed JSON, schema mismatch, timeout, unexpected exit, and unexpected state allow fail-closed controller behavior          | 3.3A-UNIT-010/014-016/026-029; 3.3A-CONTRACT-038-042; 3.3A-CLI-043-046; W-3.3A-003 for actual runtime cancellation/timeout policy |

### High-Risk Traceability

| Risk       | Scenarios / waivers                                |
| ---------- | -------------------------------------------------- |
| 3.3A-R-001 | 3.3A-UNIT-001; 3.3A-CONTRACT-047                   |
| 3.3A-R-002 | 3.3A-UNIT-003-009                                  |
| 3.3A-R-003 | 3.3A-UNIT-002/007/014/025; 3.3A-CONTRACT-038-042   |
| 3.3A-R-004 | 3.3A-UNIT-020-032/054/055; 3.3A-CLI-043-045        |
| 3.3A-R-005 | 3.3A-UNIT-014/015; 3.3A-CONTRACT-038-042           |
| 3.3A-R-006 | 3.3A-CONTRACT-033-035                              |
| 3.3A-R-007 | 3.3A-UNIT-027/032                                  |
| 3.3A-R-008 | 3.3A-UNIT-017/018; 3.3A-CONTRACT-048               |
| 3.3A-R-009 | 3.3A-UNIT-010/029; 3.3A-CLI-043-046                |
| 3.3A-R-010 | 3.3A-UNIT-019; 3.3A-CI-050/052                     |
| 3.3A-R-011 | 3.3A-CONTRACT-036/048; 3.3A-CI-053/057; W-3.3A-002 |
| 3.3A-R-012 | 3.3A-UNIT-016; 3.3A-CI-049                         |
| 3.3A-R-013 | 3.3A-UNIT-011/012/056                              |
| 3.3A-R-014 | 3.3A-CONTRACT-033/037                              |
| 3.3A-R-015 | 3.3A-UNIT-030                                      |
| 3.3A-R-016 | 3.3A-UNIT-005/006/013                              |
| 3.3A-R-017 | 3.3A-CONTRACT-040; W-3.3A-003                      |

### Reviewer Concern Traceability

| Concern | Scenarios / waiver                                 |
| ------- | -------------------------------------------------- |
| RC-01   | 3.3A-UNIT-007/014/025; 3.3A-CONTRACT-038-042       |
| RC-02   | 3.3A-UNIT-001                                      |
| RC-03   | 3.3A-UNIT-003/004/008/016                          |
| RC-04   | 3.3A-UNIT-003-009                                  |
| RC-05   | 3.3A-CONTRACT-033/037                              |
| RC-06   | 3.3A-CONTRACT-034                                  |
| RC-07   | 3.3A-CONTRACT-035                                  |
| RC-08   | 3.3A-UNIT-020-032                                  |
| RC-09   | 3.3A-UNIT-020-025/030                              |
| RC-10   | 3.3A-UNIT-010-012/029/031                          |
| RC-11   | 3.3A-UNIT-027/032                                  |
| RC-12   | 3.3A-CI-053/057; W-3.3A-002                        |
| RC-13   | 3.3A-CONTRACT-047/048                              |
| RC-14   | 3.3A-UNIT-018                                      |
| RC-15   | 3.3A-UNIT-019; 3.3A-CI-050                         |
| RC-16   | 3.3A-UNIT-016; 3.3A-CI-049                         |
| RC-17   | 3.3A-UNIT-015; 3.3A-CONTRACT-040/041; 3.3A-CLI-046 |
| RC-18   | 3.3A-UNIT-030                                      |
| RC-19   | 3.3A-CONTRACT-036; W-3.3A-001                      |
| RC-20   | 3.3A-CONTRACT-033/037                              |
| RC-21   | W-3.3A-002                                         |
| RC-22   | 3.3A-CONTRACT-040; W-3.3A-003                      |
| RC-23   | W-3.3A-004                                         |

### Explicit Waivers

| ID         | Reason                                                                                                                                                                 | Owner                             | Residual risk                                                                                      | Follow-up trigger                                                             |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------- | -------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| W-3.3A-001 | Story 3.3a defines the shared helper and baseline only; runtime conversion of `workflow.start/status/approve/reject/resume/retry/cancel` belongs to Stories 3.3b-3.3d. | Product + Archon CLI owner        | Future workflow commands may remain legacy JSON until their producer stories land.                 | Story 3.3b, 3.3c, or 3.3d starts implementation.                              |
| W-3.3A-002 | Browser, HTTP API, server routes, web UI, event outbox, delivery health, and Hermes consumer behavior are explicitly outside this headless CLI story.                  | Product + architecture owners     | End-to-end consumer integration is not proven by this story.                                       | Approved story activates one of those surfaces.                               |
| W-3.3A-003 | The helper can represent timeout/cancel failure envelopes but does not define runtime timeout, abort-signal, or cancellation policy.                                   | CLI architecture owner            | A future runtime command may hang or cancel inconsistently until its command story defines policy. | Timeout SLO, abort-signal contract, or runtime command story is accepted.     |
| W-3.3A-004 | The current CLI helper runs under local OS-process trust and has no application-level auth/permission requirement.                                                     | Security owner                    | Local users with command access can invoke helper-backed commands according to existing CLI trust. | Remote, multi-user, service-account, or role policy is introduced.            |
| W-3.3A-005 | Out-of-order event handling is not applicable because Story 3.3a has no event ingestion, event ledger, outbox, or callback mutation surface.                           | Workflow event architecture owner | Event-order defects are not detected here.                                                         | Story 3.5, 3.7, or Hermes callback ingress activates event ordering behavior. |
| W-3.3A-006 | No performance/load threshold exists for local envelope construction.                                                                                                  | Product/operations owner          | Slow helper code has no numeric SLO gate beyond normal test/runtime feedback.                      | A latency SLO, remote exposure, or performance incident is accepted.          |

### NFR Evidence Plan

| NFR                       | Scenarios                                                              | Evidence artifact for later assessment                                      |
| ------------------------- | ---------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| Security                  | 3.3A-UNIT-016; 3.3A-CI-049                                             | Bun test output and recursive source/envelope scan results                  |
| Reliability               | 3.3A-UNIT-007-015/028/029/056; 3.3A-CONTRACT-038-042                   | Helper and provider-binding regression test output                          |
| Compatibility             | 3.3A-UNIT-001-009/020-025/030; 3.3A-CONTRACT-033-048; 3.3A-CLI-043-046 | Fixture diffs, validator output, raw stdout/stderr captures                 |
| Data integrity regression | 3.3A-UNIT-020-032/054/055                                              | Provider-binding fixture/regression test output                             |
| Maintainability           | 3.3A-UNIT-017-019; 3.3A-CI-050-053/057                                 | Type-check, package-script diff, import/dependency scan, `bun run validate` |
| Performance/scalability   | W-3.3A-006                                                             | No final assessment until threshold exists                                  |
| Permission/auth           | W-3.3A-004                                                             | Security waiver and re-review trigger                                       |

### Execution Strategy

- **PR:** Run all deterministic functional and contract tests: new helper tests, provider-binding unit/E2E/contract tests, `validate_contracts.py`, `bun --filter @archon/cli type-check`, and `bun run validate` before review.
- **Nightly:** If CI time becomes a concern, repeat subprocess JSON-purity and provider-binding regression tests for 20-50 iterations as burn-in; do not move deterministic P0/P1 tests out of PR unless measured runtime exceeds the existing project gate budget.
- **Weekly:** No performance, browser, chaos, or live-service suite is required for this story.

Philosophy: run everything deterministic in PR; defer only expensive, long-running, or infrastructure-dependent checks.

### Resource Estimate

| Priority               | Estimate                                                                     |
| ---------------------- | ---------------------------------------------------------------------------- |
| P0 scenarios           | ~18-30 hours                                                                 |
| P1 scenarios           | ~18-34 hours                                                                 |
| P2 scenarios           | ~0-4 hours                                                                   |
| P3 scenarios / waivers | ~1-3 hours                                                                   |
| Total                  | ~37-71 hours, roughly 5-9 engineering days for one implementer/reviewer loop |

### Quality Gates

- P0 pass rate: 100%, with no skips or quarantine on P0 scenarios.
- P1 pass rate: 100% for deterministic helper/contract/CLI regressions, stricter than the generic 95% floor.
- Acceptance-criterion, high-risk, and reviewer-concern disposition coverage: 100% scenario-or-waiver traceability.
- Canonical contract validator passes unchanged.
- Provider-binding exact fixture comparisons pass with only documented dynamic exclusions.
- No forbidden fields, raw secrets, raw signing material, stdout/stderr body leakage, or Hermes-specific keys in helper output.
- No production import of `_bmad-output`, fixtures, schemas, or validator scripts.
- No new JSON Schema runtime dependency in `@archon/cli`.
- Test batching respects `mock.module()` isolation.
- File scope stays inside Story 3.3a boundaries.
- `bun --filter @archon/cli type-check` and `bun run validate` pass.
- NFR evidence source is identified for every in-scope NFR; final NFR PASS/CONCERNS/FAIL is deferred to `nfr-assess`.

## Step 5: Generate Output

Execution mode: sequential.
Config requested `auto`; no explicit agent-team or subagent mode was requested for this run, and epic-level output is a single document.

Final output written:

- `_bmad-output/test-artifacts/test-design/test-design-3-3a-define-shared-workflow-provider-command-envelope.md`

Validation completed against the workflow checklist:

- 17 risks identified; 16 score >= 6 risks mapped to P0/P1 scenarios.
- 57 atomic scenarios generated: 31 P0 and 26 P1.
- All 4 acceptance criteria map to scenarios, with runtime workflow conversion and timeout/cancellation policy explicitly waived where out of scope.
- All 23 reviewer concerns map to scenarios or explicit waivers.
- Happy path, negative path, boundary cases, malformed input, stale data, duplicate actions, out-of-order events, partial failure, dependency failure, timeout, cancellation, concurrency/race, rollback, permission/auth, and regression cases are explicitly disposed.
- 6 waivers include reason, owner, residual risk, and follow-up trigger.
- Browser exploration was not opened, so there are no browser sessions to clean up.
