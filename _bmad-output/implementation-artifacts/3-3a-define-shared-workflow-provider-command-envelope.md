# Story 3.3a: Define Shared Workflow Provider Command Envelope

Status: in-progress

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a controller integrator,
I want workflow provider commands to share one versioned result envelope,
so that external controllers can fail closed and validate command output consistently.

## Acceptance Criteria

1. **Given** any workflow control command returns a success result
   **When** Archon serializes the response
   **Then** the result includes schema version, success flag, correlation id, workflow run reference when applicable, binding reference when applicable, and machine-readable result payload.

2. **Given** any workflow control command returns a failure result
   **When** Archon serializes the response
   **Then** the result includes schema version, success flag, correlation id if available, machine-readable error code, diagnostic category, boolean retryability, and machine-readable details.

3. **Given** a Workflow Commander provider command is implemented
   **When** its CLI syntax is exercised with `--json`
   **Then** the returned envelope uses the canonical `command` value listed in the provider command syntax baseline
   **And** tests fail if the CLI syntax and command identifier drift apart.

4. **Given** an external controller consumes a workflow control result
   **When** malformed JSON, schema mismatch, timeout, unexpected exit code, or unexpected state occurs
   **Then** the shared envelope lets the controller fail closed without relying on human-readable output.

## Tasks / Subtasks

- [ ] Task 1 - Add the shared CLI command-envelope module (AC: 1, 2, 4)
  - [ ] Add `packages/cli/src/commands/workflow-provider-command-envelope.ts`.
  - [ ] Define a `WorkflowProviderCommand` union covering exactly the schema enum values: `workflow.start`, `workflow.status`, `workflow.approve`, `workflow.reject`, `workflow.resume`, `workflow.retry`, `workflow.cancel`, `binding.create`, `binding.update`, `binding.status`, `binding.rotate`, and `binding.disable`.
  - [ ] Define closed error-category types matching the contract enum: `configuration`, `external_delay`, `implementation_defect`, `provider_contract`, `security_rejection`, `timeout`, and `unexpected_state`.
  - [ ] Provide success and failure envelope builders that always emit `workflow-command-envelope.v1`, `intendedProducer: "Archon"`, `intendedConsumer: "Hermes"`, `owningSubproject: "archon"`, `provider`, `command`, `correlationId`, `issuedAt`, and `success`.
  - [ ] Make `error.retryable` mandatory in failure-builder input; never allow a failure envelope without a boolean retryability value.
  - [ ] Enforce result/error exclusivity in the builder API: success envelopes include `result` and omit `error`; failure envelopes include `error` and omit `result`.
  - [ ] Enforce reference requirements in the builder API: success `workflow.*` commands require `workflowRunRef`; success `binding.*` commands require `bindingRef`; failure envelopes omit refs by default unless a later story has a contract-backed reason.
  - [ ] Move reusable `safeStringify`, correlation-id generation, and issued-at timestamp helpers out of `provider-binding.ts` into this shared module.
  - [ ] Keep command-specific error classification outside the shared module unless the classification is truly provider-command generic; binding lifecycle codes stay in `provider-binding.ts`.

- [ ] Task 2 - Refactor provider-binding commands to consume the shared envelope module (AC: 1, 2, 3, 4)
  - [ ] Update `packages/cli/src/commands/provider-binding.ts` to import the shared envelope builders and metadata helpers.
  - [ ] Remove the duplicated local `buildSuccessEnvelope`, `buildErrorEnvelope`, `safeStringify`, `resolveCorrelationId`, and `resolveIssuedAt` implementations from `provider-binding.ts`.
  - [ ] Preserve all existing provider-binding runtime behavior and output shapes for `create`, `update`, `status`, `rotate`, `disable`, and unsupported-subcommand failure.
  - [ ] Keep binding-specific validation, project-ref resolution, `buildBindingRef`, `BINDING_STATUS_STATES`, and lifecycle error classification local to `provider-binding.ts`.
  - [ ] Do not touch provider-binding DB modules, migrations, SQLite schema, PostgreSQL schema, or bundled schema for this story.
  - [ ] Do not add raw secret, signature material, `actor`, `profile`, `agent_name`, `agent`, or `agent_provider` fields to any envelope.

- [ ] Task 3 - Add command syntax and command-id baseline tests (AC: 3, 4)
  - [ ] Add `packages/cli/src/commands/workflow-provider-command-envelope.test.ts`.
  - [ ] Load `_bmad-output/planning-artifacts/contracts/workflow-commander/schemas/workflow-command-envelope.schema.json` and assert the helper's command list exactly matches the schema enum.
  - [ ] Add a provider CLI syntax baseline table in the test or helper and assert it covers all command enum values with the exact syntax from `architecture.md` and `epics.md`.
  - [ ] Assert `workflow.cancel` maps to `archon workflow cancel <run-id> --json`; do not treat legacy `workflow abandon` as the Workflow Commander command.
  - [ ] Assert `workflow.retry` maps to `archon workflow retry <run-id> [--node <node-id>] --json`; do not reuse the existing streaming-only `workflow retry-node` surface as the provider command.
  - [ ] For currently implemented binding commands, keep actual runtime fixture assertions in `provider-binding.test.ts`.
  - [ ] For workflow commands owned by later stories 3.3b through 3.3d, prove the shared baseline and fixtures are covered now, then let later stories add actual runtime command-output tests as they convert each command family.
  - [ ] Add tests that build representative success and failure envelopes with the helper and assert static top-level fields, result/error exclusivity, `error.retryable`, and reference requirements.
  - [ ] Update the contract/secret scan to include the new shared envelope module.
  - [ ] Wire the new test file into `packages/cli/package.json` in a process-isolated way if it uses `mock.module()`; if it imports no mocked modules, it may share the non-mocking contract-test invocation.

- [ ] Task 4 - Preserve Story 3.1 fixture conformance during the refactor (AC: 1, 2, 4)
  - [ ] Keep `packages/cli/src/commands/provider-binding.test.ts` exact fixture comparisons passing for `binding-create-success.json`, `binding-update-success.json`, `binding-status-success.json`, `binding-rotate-success.json`, `binding-disable-success.json`, and `error-malformed-request.json`.
  - [ ] Keep dynamic-field exclusions narrow and documented: `correlationId`, `issuedAt`, `observedAt`, `requestedAt`, `checkedAt`, and `durationMs`.
  - [ ] Do not widen fixture exclusions to hide static drift.
  - [ ] Keep `provider-binding-contract.test.ts` running the canonical Python validator.
  - [ ] Keep `provider-binding.e2e.test.ts` behavior unchanged except for import or helper adjustments required by the refactor.

- [ ] Task 5 - Validate focused and full gates (AC: 1, 2, 3, 4)
  - [ ] Run `python3 _bmad-output/planning-artifacts/contracts/workflow-commander/validate_contracts.py`.
  - [ ] Run focused CLI tests that cover the new helper and existing provider-binding output.
  - [ ] Run `bun --filter @archon/cli type-check`.
  - [ ] Run `bun run validate` before moving the story to review.

### Review Findings

- [ ] [Review][Patch] R1-F1 Shared envelope builder API still accepts open command/category strings [packages/cli/src/commands/workflow-provider-command-envelope.ts:51]
- [ ] [Review][Patch] R1-F2 Provider-binding fail-closed path still bypasses shared metadata helpers [packages/cli/src/commands/provider-binding.ts:178]

## Dev Notes

### Scope Boundary

This story defines and installs the shared CLI command-envelope helper for Workflow Commander provider output.
It also refactors the already-implemented provider-binding CLI commands to use that helper without changing their externally observed JSON.

This story does not implement `workflow.start`, `workflow.status`, `workflow.approve`, `workflow.reject`, `workflow.resume`, `workflow.retry`, or `workflow.cancel` runtime behavior.
Stories 3.3b, 3.3c, and 3.3d own those command-family conversions.

This story does not add HTTP routes, server APIs, web UI, workflow event outbox behavior, delivery health, Hermes materialization, Hermes event ingress, Project Work Items, Phase Tasks, gates, reconciliation, or user-facing diagnostics.
Workflow Commander v1 is headless from Archon's side.

### Contract Source Of Truth

The authoritative local contract package is `_bmad-output/planning-artifacts/contracts/workflow-commander/`.
The canonical validator passed at story creation time:

```bash
python3 _bmad-output/planning-artifacts/contracts/workflow-commander/validate_contracts.py
```

Observed result:

```text
Workflow Commander 1.3a/1.3b/1.3c contract validation passed
Validated 7 schemas
Validated 17 command examples
Validated 13 binding examples
Validated 7 delivery examples
Validated 6 generic event examples
Validated 7 provider event examples
Validated 9 callback rejection examples
Validated 6 materialization examples
Validated isolated local package without parent workspace traversal
```

Do not edit schemas or fixtures to make runtime code pass.
Runtime code and tests must conform to the checked-in contract package.
If implementation needs a field that is absent from `workflow-command-envelope.schema.json`, stop and raise a contract change; do not invent runtime-only fields.

### Command Envelope Shape

`workflow-command-envelope.schema.json` is closed at the top level.
Allowed top-level fields are `schemaVersion`, `intendedProducer`, `intendedConsumer`, `owningSubproject`, `provider`, `command`, `correlationId`, `issuedAt`, `success`, `workflowRunRef`, `bindingRef`, `result`, `error`, and `execution`.

Success envelopes must include `result` and must not include `error`.
Failure envelopes must include `error` and must not include `result`.

Successful workflow commands require `workflowRunRef`.
Successful binding commands require `bindingRef`.
Failure examples omit both refs today; keep that default unless a later accepted contract requires otherwise.

The failure `error` object requires `code`, `category`, `retryable`, and `details`.
The readiness remediation specifically called out `error.retryable`; do not omit it in any builder, fixture test, or error path.

The `execution` object is appropriate for CLI failure envelopes and includes `exitCode`, `timedOut`, optional `durationMs`, `stdoutRedacted`, and `stderrRedacted`.
Existing success fixtures omit `execution`; do not add it to success envelopes.

### Provider CLI Syntax Baseline

The canonical command values are the enum values in `_bmad-output/planning-artifacts/contracts/workflow-commander/schemas/workflow-command-envelope.schema.json`.
The provider CLI syntax baseline is:

| Contract Command   | Provider CLI Syntax                                                                                                       |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------- |
| `workflow.start`   | `archon workflow run <workflow-name> [message] --json`                                                                    |
| `workflow.status`  | `archon workflow get <run-id> --json`                                                                                     |
| `workflow.approve` | `archon workflow approve <run-id> [comment] --json`                                                                       |
| `workflow.reject`  | `archon workflow reject <run-id> [reason] --json`                                                                         |
| `workflow.resume`  | `archon workflow resume <run-id> --json`                                                                                  |
| `workflow.retry`   | `archon workflow retry <run-id> [--node <node-id>] --json`                                                                |
| `workflow.cancel`  | `archon workflow cancel <run-id> --json`                                                                                  |
| `binding.create`   | `archon provider-binding create --provider archon --name <name> --project-ref <project-ref> --route <event-route> --json` |
| `binding.update`   | `archon provider-binding update --provider archon --name <name> --project-ref <project-ref> --route <event-route> --json` |
| `binding.status`   | `archon provider-binding status --provider archon --name <name> [--project-ref <project-ref>] --json`                     |
| `binding.rotate`   | `archon provider-binding rotate --provider archon --name <name> --json`                                                   |
| `binding.disable`  | `archon provider-binding disable --provider archon --name <name> --json`                                                  |

`workflow.cancel` is a Workflow Commander command name.
The existing `workflow abandon` command is legacy Archon CLI vocabulary and must not be serialized as `workflow.cancel`.

`workflow.retry` is a future JSON-compatible provider command.
The existing `workflow retry-node` command streams workflow output and rejects `--json`; do not retrofit it as the provider command in this story.

### Existing Code State To Preserve

`packages/cli/src/commands/provider-binding.ts` currently contains local envelope helpers, binding lifecycle command handlers, binding-specific validation, project-ref resolution, and lifecycle error classification.
This story should extract only reusable envelope construction and metadata helpers from that file.
Do not move DB calls, binding state handling, or project-ref lookup into the shared envelope module.

`packages/cli/src/cli.ts` already registers `provider-binding`, adds provider-binding flags to `parseArgs`, keeps `provider-binding` in `noGitCommands`, silences logs under `--json`, and normalizes missing provider-binding string flag values to empty strings before parsing.
This story is not expected to change `cli.ts`.
If a tiny import or dispatch adjustment becomes necessary, preserve those existing behaviors.

`packages/cli/src/commands/workflow.ts` still emits legacy JSON shapes such as `{ ok: true }` or raw run rows for existing workflow commands.
Do not convert those outputs in Story 3.3a.
Later stories own the actual start/status/decision/recovery runtime conversions and should use the helper created here.

`packages/cli/src/commands/provider-binding.test.ts` already mocks core DB modules and compares provider-binding outputs against checked-in command fixtures.
Keep it in its own Bun process because `mock.module()` pollution is process-global.

`packages/cli/src/commands/provider-binding-contract.test.ts` already runs the Python contract validator and scans implementation files for secret/signing-material patterns.
Extend its scan list or add a companion test so the new helper cannot introduce forbidden fields or secret material.

`packages/cli/package.json` currently runs provider-binding unit, E2E, and contract tests in separate invocations.
Respect that isolation when adding the new test file.

### Previous Story Intelligence

Story 3.1 completed the provider-binding lifecycle and intentionally left a local envelope builder in `provider-binding.ts` as temporary duplication.
The test-design waiver `W-007` states that Story 3.3a owns shared-envelope extraction and must rerun exact fixture tests during the refactor.

Story 3.1 established these decisions that still apply:

- `binding.create` and `binding.update` stay distinct; create is not an upsert.
- `binding.disable` is idempotent-safe and does not delete audit history.
- Disabled bindings reject `update` and `rotate`.
- Binding rotation is a version-counter operation, not secret rotation.
- `actor` is not present in the closed command-envelope schema and must not be emitted.
- `stale` is representable but has no active detection protocol in Archon v1.
- Command fixtures and binding-domain fixtures are separate families; do not conflate their result keys or `projectRef` shapes.
- `bindingRef.projectRef` in command envelopes is a string such as `project:<codebase_id>`.
- Runtime application code does not need to implement the `workflow-provider-binding.v1` fixture family unless a current caller is introduced.

Deferred work from Story 3.1 remains out of scope here:

- Ambient `DEFAULT_AI_ASSISTANT` can leak into existing `packages/core/src/db/codebases.test.ts` when that environment variable is set.
- There is no disposable live PostgreSQL DDL/restart-convergence lane.

### Git Intelligence

Recent commits show the current state is dominated by Story 3.1 provider-binding lifecycle implementation and hardening.
Commit `7cae8f1a` hardened provider binding lifecycle code and tests.
The most recent merge `f003245a` brought in the Story 3.1 implementation, test design, ATDD scaffolds, and sprint status updates.
Later `update` commits only touched bundled workflow defaults and do not change this story's command-envelope scope.

### Testing Requirements

Use Bun tests and the package scripts; do not run root `bun test`.
Use `bun run test` for the full suite or focused package/file invocations for local iteration.

Recommended focused checks:

```bash
python3 _bmad-output/planning-artifacts/contracts/workflow-commander/validate_contracts.py
bun test packages/cli/src/commands/workflow-provider-command-envelope.test.ts
bun test packages/cli/src/commands/provider-binding.test.ts
bun test packages/cli/src/commands/provider-binding-contract.test.ts
bun test packages/cli/src/commands/provider-binding.e2e.test.ts
bun --filter @archon/cli type-check
bun run validate
```

If the new helper test imports no mocked modules, it can run beside other non-mocking contract tests.
If it uses `mock.module()`, put it in its own `bun test` process in `packages/cli/package.json`.

Do not add a new JSON Schema runtime dependency in `@archon/cli` just to validate fixtures.
The contract package already has `validate_contracts.py`, and the repo already uses fixture equality and direct invariant tests for this surface.

### Latest Technical Information

No external library upgrade or new framework is required for this story.
Use the project-locked Bun, TypeScript, and strict ESM workspace conventions from `_bmad-output/project-context.md`.

`tsconfig.json` has `resolveJsonModule: true`, so tests may import or read JSON schemas and fixtures directly.
Production CLI code should not import `_bmad-output` planning artifacts at runtime; use typed constants in source and test them against the contract schema.

The local `python3` is 3.9.6.
That is sufficient for `validate_contracts.py`, which supports Python 3.9+ and passed.
The BMAD customization resolver requires Python 3.11 because it imports `tomllib`, but that resolver is not part of this story's implementation or validation gate.

### ATDD Artifacts

- Checklist: `_bmad-output/test-artifacts/atdd-checklist-3-3a-define-shared-workflow-provider-command-envelope.md`
- API/contract tests: `packages/cli/src/commands/workflow-provider-command-envelope.test.ts` (new; 7 executable regression locks pass today, 42 module-dependent scaffolds are `test.skip()` pending Task 1)
- Contract/CI-static tests (extended): `packages/cli/src/commands/provider-binding-contract.test.ts` (3 pre-existing gates still pass; 3 new checks — secret scan extension, no-planning-import scan, duplicate-local-helper-removal — are genuinely red today)
- E2E / first-party consumer surface: already covered by the unmodified `packages/cli/src/commands/provider-binding.e2e.test.ts` from Story 3.1 (3 pass / 8 pre-existing skip); no new E2E surface is introduced by this story since the shared module has no direct CLI subcommand of its own.
- `packages/cli/package.json`'s `test` script was extended by one line to run the new envelope test file alongside `provider-binding-contract.test.ts` (both are non-mocking, so no new isolated invocation was needed).

## Project Structure Notes

Expected new file:

- `packages/cli/src/commands/workflow-provider-command-envelope.ts`

Expected new or updated tests:

- `packages/cli/src/commands/workflow-provider-command-envelope.test.ts`
- `packages/cli/src/commands/provider-binding.test.ts`
- `packages/cli/src/commands/provider-binding-contract.test.ts`
- `packages/cli/package.json`

Expected update:

- `packages/cli/src/commands/provider-binding.ts`

Unexpected for this story:

- No `packages/core` changes.
- No `migrations` changes.
- No `packages/server` routes.
- No `packages/web` UI.
- No `packages/workflows` engine changes.
- No edits to `_bmad-output/planning-artifacts/contracts/workflow-commander/` unless a deliberate contract-change process is started before runtime implementation.

## References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 3.3a: Define Shared Workflow Provider Command Envelope]
- [Source: _bmad-output/planning-artifacts/epics.md#Provider Command Syntax Baseline]
- [Source: _bmad-output/planning-artifacts/architecture.md#Consistency Conventions]
- [Source: _bmad-output/planning-artifacts/architecture.md#Provider Command Syntax Baseline]
- [Source: _bmad-output/planning-artifacts/prd.md#FR-8: Expose Provider Workflow Control Through CLI JSON]
- [Source: _bmad-output/planning-artifacts/ux.md#Archon UX Requirements]
- [Source: _bmad-output/planning-artifacts/contracts/workflow-commander/README.md#Command Envelope Rules]
- [Source: _bmad-output/planning-artifacts/contracts/workflow-commander/schemas/workflow-command-envelope.schema.json]
- [Source: _bmad-output/planning-artifacts/contracts/workflow-commander/examples/providers/archon/commands/*.json]
- [Source: _bmad-output/planning-artifacts/sprint-change-proposal-2026-07-12-implementation-readiness-remediation.md#4.4 Story 3.3a: Trace Retryability Explicitly]
- [Source: _bmad-output/test-artifacts/test-design-epic-3.md#Waivers and Residual Risks, W-007]
- [Source: _bmad-output/implementation-artifacts/3-1-implement-archon-workflow-provider-binding-lifecycle.md#Dev Agent Record]
- [Source: packages/cli/src/commands/provider-binding.ts]
- [Source: packages/cli/src/commands/provider-binding.test.ts]
- [Source: packages/cli/src/commands/provider-binding-contract.test.ts]
- [Source: packages/cli/src/cli.ts]
- [Source: packages/cli/src/commands/workflow.ts]
- [Source: packages/cli/package.json]
- [Source: tsconfig.json]
- [Source: _bmad-output/project-context.md]

## Dev Agent Record

### Agent Model Used

{{agent_model_name_version}}

### Debug Log References

### Completion Notes List

- Story context engine analysis completed.
- Contract validator passed before story creation.
- Story is ready for development as a code refactor plus contract-test slice.

### File List
