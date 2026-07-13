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
lastSaved: '2026-07-13'
inputDocuments:
  - '_bmad-output/implementation-artifacts/3-1-implement-archon-workflow-provider-binding-lifecycle.md'
  - '_bmad-output/project-context.md'
  - '_bmad/tea/config.yaml'
  - '_bmad-output/planning-artifacts/prd.md'
  - '_bmad-output/planning-artifacts/architecture.md'
  - '_bmad-output/planning-artifacts/epics.md'
  - '_bmad-output/planning-artifacts/implementation-readiness-report-2026-07-12.md'
  - '_bmad-output/planning-artifacts/contracts/workflow-commander/README.md'
  - '_bmad-output/planning-artifacts/contracts/workflow-commander/schemas/workflow-command-envelope.schema.json'
  - '_bmad-output/planning-artifacts/contracts/workflow-commander/schemas/workflow-provider-binding.schema.json'
  - '_bmad-output/planning-artifacts/contracts/workflow-commander/examples/providers/archon/commands/binding-*.json'
  - '_bmad-output/planning-artifacts/contracts/workflow-commander/examples/providers/archon/commands/error-malformed-request.json'
  - '_bmad-output/planning-artifacts/contracts/workflow-commander/examples/providers/archon/bindings/status-*.json'
  - 'packages/core/package.json'
  - 'packages/cli/package.json'
  - 'packages/core/src/db/user-provider-key-store.test.ts'
  - 'packages/core/src/db/adapters/sqlite.test.ts'
  - 'packages/core/src/db/adapters/postgres.test.ts'
  - 'packages/core/src/db/bundled-schema.test.ts'
  - 'packages/cli/src/cli.ts'
  - 'packages/cli/src/cli.test.ts'
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
outputDocument: '_bmad-output/test-artifacts/test-design-epic-3.md'
---

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
