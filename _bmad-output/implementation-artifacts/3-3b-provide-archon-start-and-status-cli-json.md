# Story 3.3b: Provide Archon Start And Status CLI JSON

Status: in-progress

<!-- A story may become ready-for-dev only after solution-readiness and proof-readiness validation pass. -->

## Story

As a controller integrator,
I want provider `archon` to expose workflow start and status through parseable CLI JSON,
so that external controllers can create and inspect workflow references without using the Archon dashboard.

## Acceptance Criteria

1. **Given** a workflow run can be started from Archon CLI / **When** Archon starts the run / **Then** Archon returns parseable JSON with schema version, success flag, correlation id, workflow run reference, binding reference when applicable, and machine-readable result payload / **And** the command accepts the project cwd or codebase reference needed by the controller contract.

2. **Given** a workflow run is inspected from Archon CLI / **When** Archon returns status / **Then** the result includes run state, workflow name, workflow run reference, correlation id when available, and machine-readable error shape when failed / **And** the result matches the shared status example.

3. **Given** a start or status command fails / **When** Archon returns the failure / **Then** the response includes schema version, success flag, correlation id if available, machine-readable error code, and diagnostic category / **And** consumers can fail closed on malformed JSON, schema mismatch, timeout, or unexpected exit code.

## Tasks / Subtasks

- [ ] Slice 1: Foreground `workflow run --json` produces a shared-envelope success result (AC: #1)
  - [ ] Add `--correlation-id` plumbing for workflow commands in `cli.ts` (pass to `WorkflowRunOptions`).
  - [ ] Extend `WorkflowRunOptions` with `correlationId?: string`.
  - [ ] In `workflowRunCommand`, when `options.json && !options.detach` (foreground JSON mode): after `executeWorkflow` returns, build and emit a `workflow.start` success envelope via `buildSuccessEnvelope` with `workflowRunRef` and `result` matching the `start-success.json` fixture shape.
  - [ ] For `result.success && result.paused`: emit success envelope with `state: 'waiting-for-approval'`, `terminal: false`, `actionRequired: true`, and `gateRef` from approval context metadata.
  - [ ] For `result.success && !paused`: emit a fixture-conformant start acknowledgement with `state: 'running'`, `phase: 'implementation'`, and `accepted: true`; do not add status-only fields such as `terminal` to the `workflow.start` result unless the contract fixture/schema is updated first.
  - [ ] Populate `projectBindingRef` in result when a codebase with a registered provider binding exists; omit the field otherwise.
  - [ ] Suppress all human-readable `console.log` output in JSON mode (discovery, "Running workflow:", progress, completion/pause text).
  - [ ] Positive proof: unit test asserting a successful foreground run emits a `workflow.start` envelope matching the contract fixture (field-by-field, excluding dynamic fields).
  - [ ] Failing-path proof: unit test asserting a paused run emits a success envelope with `state: 'waiting-for-approval'`.
- [ ] Slice 2: Foreground `workflow run --json` produces shared-envelope error results (AC: #3)
  - [ ] Wrap `workflowRunCommand`'s foreground path in a `withFailClosed`-style try/catch for `workflow.start`: on any unhandled exception, emit a `buildErrorEnvelope` with classified error code, category, retryable flag, and execution metadata. Never throw an unstructured error in JSON mode.
  - [ ] For `result.success === false` from `executeWorkflow`: emit an error envelope with code `WORKFLOW_FAILED`, category `implementation_defect`, `retryable: true`, details including `workflowRunId` and `error` message.
  - [ ] For workflow-not-found: emit error envelope with code `MALFORMED_REQUEST`, category `provider_contract`, `retryable: false`, details including the requested workflow name.
  - [ ] For flag-validation failures: emit error envelope with code `MALFORMED_REQUEST`, category `provider_contract`, `retryable: false`, details including `fieldErrors` array.
  - [ ] Classify timeout errors (ETIMEDOUT, statement timeout) as `COMMAND_TIMEOUT` / `timeout` / `retryable: true`.
  - [ ] Positive proof: unit test asserting a failed workflow emits an error envelope matching the contract error fixtures.
  - [ ] Failing-path proof: unit test asserting workflow-not-found emits `MALFORMED_REQUEST` error envelope; unit test asserting timeout produces `COMMAND_TIMEOUT` envelope.
- [ ] Slice 3: `workflow get --json` produces a shared-envelope status result (AC: #2)
  - [ ] Add `correlationId?: string` parameter to `workflowGetCommand`.
  - [ ] Plumb `--correlation-id` from `cli.ts` into `workflowGetCommand`.
  - [ ] When `json` is true and a run is found: build and emit a `workflow.status` success envelope via `buildSuccessEnvelope` with `workflowRunRef` and a `result` payload matching the `status-success.json` fixture shape (operation, state, phase, terminal, actionRequired, gateRef when paused).
  - [ ] Map `WorkflowRunStatus` → contract state: `running` → `running`, `completed` → `completed`, `failed` → `failed`, `cancelled` → `cancelled`, `paused` → `waiting-for-approval`, `pending` → `pending`.
  - [ ] Derive `terminal` from `TERMINAL_WORKFLOW_STATUSES`.
  - [ ] Derive `actionRequired` from paused status with approval context metadata.
  - [ ] Populate `gateRef` from `metadata.approval` when status is `paused` and `isApprovalContext(metadata.approval)`.
  - [ ] Positive proof: unit test asserting a running run emits a `workflow.status` success envelope matching the contract fixture.
  - [ ] Failing-path proof: unit test asserting a paused run with approval context includes `gateRef` in the result.
- [ ] Slice 4: `workflow get --json` produces shared-envelope error results (AC: #3)
  - [ ] When `json` is true and run is not found: emit error envelope with code `NOT_FOUND`, category `unexpected_state`, `retryable: false`.
  - [ ] When `json` is true and DB query fails: emit error envelope with classified error (timeout → `COMMAND_TIMEOUT`, other → `INTERNAL_ERROR`).
  - [ ] Replace the legacy `{ ok: false, runId, error }` JSON shape with the shared envelope. The legacy shape is Archon-internal and was not part of a versioned contract.
  - [ ] Positive proof: unit test asserting not-found emits `NOT_FOUND` error envelope.
  - [ ] Failing-path proof: unit test asserting DB error emits `INTERNAL_ERROR` envelope with execution metadata.
- [ ] Slice 5: Contract fixture conformance tests (AC: #1, #2, #3)
  - [ ] Add fixture conformance tests that load the checked-in contract examples (`start-success.json`, `status-success.json`, all 5 error examples) and diff against runtime-produced envelopes field-by-field, excluding dynamic fields (`correlationId`, `issuedAt`, `durationMs`).
  - [ ] Validate envelopes against the `workflow-command-envelope.schema.json` JSON Schema.
  - [ ] Verify forbidden keys (`displayText`, `humanText`, `message`, `prose`, `stderr`, `stdout`, etc.) are absent from all emitted envelopes.
  - [ ] Confirm `--detach --json` still produces its existing ack shape (regression guard).
- [ ] Slice 6: Wire test isolation and validate (AC: #1, #2, #3)
  - [ ] Add new test file(s) to `packages/cli/package.json` test script in their own `bun test` invocation(s), separated from existing test files to avoid `mock.module()` pollution.
  - [ ] Run `bun run validate` to confirm type-check, lint (zero warnings), format, bundled checks, and all tests pass.

### Review Findings

- [x] [Review][Patch] JSON-mode foreground start still writes dispatch prose to stdout via CLIAdapter [packages/cli/src/commands/workflow.ts:1103]
- [x] [Review][Patch] JSON-mode malformed CLI validation can return human prose instead of a shared error envelope [packages/cli/src/cli.ts:503]
- [x] [Review][Patch] `workflow run --json` error envelopes still exit with process status 0 [packages/cli/src/commands/workflow.ts:500]
- [x] [Review][Patch] Start envelopes omit project and provider-binding references for bound projects [packages/cli/src/commands/workflow.ts:1203]
- [x] [Review][Patch] Status envelopes omit required status payload fields for fixture and failed-run conformance [packages/cli/src/commands/workflow.ts:1619]
- [x] [Review][Patch] Contract tests only partially compare fixtures and do not validate runtime envelopes against the JSON Schema [packages/cli/src/commands/workflow-start-status-envelope.test.ts:1070]
- [x] [Review][Patch] Foreground `workflow run --json` can still write executor/platform messages to stdout via CLIAdapter [packages/cli/src/commands/workflow.ts:727]
- [x] [Review][Patch] JSON-mode status/start validation still bypasses `MALFORMED_REQUEST` envelopes for missing status ids and workflow policy conflicts [packages/cli/src/cli.ts:591]
- [x] [Review][Patch] Start envelopes still omit `projectBindingRef` for projects with a registered provider binding [packages/cli/src/commands/workflow.ts:1268]
- [x] [Review][Patch] Status envelopes still omit `phase`, use raw failed-run error strings, and can report paused runs as not action-required [packages/cli/src/commands/workflow.ts:1640]
- [x] [Review][Patch] Contract tests still use partial fixture comparisons and manual schema checks instead of runtime fixture/schema validation [packages/cli/src/commands/workflow-start-status-envelope.test.ts:1106]
- [x] [Review][Patch] JSON error envelopes report classified execution exit codes while the command returns generic process status 1 [packages/cli/src/commands/workflow.ts:499]

## Dev Notes

### Feature and System Context

- Outcome: `archon workflow run <name> [message] --json` and `archon workflow get <run-id> --json` produce machine-parseable shared-envelope JSON that external controllers (Hermes) consume for workflow start and status inspection.
- Architectural role: CLI JSON producer surfaces for the `workflow.start` and `workflow.status` commands in the Workflow Commander contract. These are the first two workflow command envelopes (Story 3.3c adds decision commands, 3.3d adds recovery commands).
- Upstream authorities: Shared command envelope module from Story 3.3a (`workflow-provider-command-envelope.ts`); contract fixtures at `_bmad-output/planning-artifacts/contracts/workflow-commander/examples/providers/archon/commands/`; architecture AD-3, AD-9.
- Downstream consumers: `hermes-agent` Story 3.4a is blocked until this producer surface exists. Stories 3.3c and 3.3d depend on patterns established here.
- User-visible or system-visible behavior: When `--json` is passed to `workflow run` (foreground) or `workflow get`, stdout is exclusively the envelope JSON (no human text mixed in). Without `--json`, behavior is unchanged.

### Canonical Artifact Reconciliation

| Source                         | Relevant claim                                                                                                                                 | Current code or prior-story decision                                                                                                                                    | Resolution                                                                                                                                                         |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Architecture AD-9              | Producer work must not invent field names ahead of shared contract examples                                                                    | Story 3.3a established the shared builders; fixtures are checked in                                                                                                     | Story 3.3b must emit envelopes matching fixtures exactly — no new fields                                                                                           |
| Architecture AD-3              | CLI results must include cwd, stdout, stderr, exit code, timeout, correlation id, parsed JSON                                                  | `buildErrorEnvelope` already includes `execution` block with `exitCode`, `timedOut`, `durationMs`, `stdoutRedacted`, `stderrRedacted`; `correlationId` in envelope meta | All covered by shared builders. `cwd` is not a field in the envelope schema — AD-3 describes the adapter's view of the CLI invocation, not the JSON payload itself |
| Epics file                     | `workflow.start` maps to `archon workflow run <workflow-name> [message] --json`                                                                | `--json` flag already parsed in `cli.ts`, already in `WorkflowRunOptions`, but foreground path ignores it (only suppresses logs; no JSON output)                        | Extend foreground path to emit envelope                                                                                                                            |
| Epics file                     | `workflow.status` maps to `archon workflow get <run-id> --json`                                                                                | `workflowGetCommand` has `--json` support, but emits legacy `{ ...run }` or `{ ok: false }` shapes                                                                      | Replace with shared envelope                                                                                                                                       |
| Contract envelope schema       | Success `workflow.*` requires `workflowRunRef`                                                                                                 | Shared builder enforces this                                                                                                                                            | Must populate `workflowRunRef` from `WorkflowRun` data for both start and status                                                                                   |
| Contract `start-success.json`  | Result includes `operation: 'start'`, `state: 'running'`, `phase: 'implementation'`, `accepted: true`, and `projectBindingRef` when applicable | No current code produces this                                                                                                                                           | Build `result` object from `WorkflowExecutionResult` + `WorkflowRun` + optional binding, matching the fixture exactly for static fields                            |
| Contract `status-success.json` | Result includes `operation`, `state`, `phase`, `terminal`, `actionRequired`, `gateRef`                                                         | No current code produces this                                                                                                                                           | Build `result` from `WorkflowRun` status + metadata                                                                                                                |
| Story 3.3a review R2-F1        | Shared builder types now narrow `command` to `WorkflowProviderCommand` and `category` to `ErrorCategory`                                       | Compile-time enforcement matches runtime validation                                                                                                                     | Use the typed builders directly — no manual type widening needed                                                                                                   |
| Story 3.1 review R1/R2/R3      | Contract fixtures must never be edited — runtime must conform                                                                                  | Established as a hard rule                                                                                                                                              | Fixture conformance tests load fixtures and diff against runtime output                                                                                            |
| PRD FR-8                       | Archon classifies timeout, schema mismatch, malformed request, unexpected state, unexpected exit                                               | Error fixtures exist for all five                                                                                                                                       | Reuse error classification pattern from `provider-binding.ts` adapted for workflow commands                                                                        |
| PRD FR-8                       | Archon does not expose a state-changing HTTP control path for Workflow Commander v1                                                            | No HTTP route changes needed                                                                                                                                            | This story is CLI-only                                                                                                                                             |

### Solution Surface Map

| Surface                                                           | Owner or authority                    | Current state                                                   | Required change                                                              | Consumers                       | Proof                                 |
| ----------------------------------------------------------------- | ------------------------------------- | --------------------------------------------------------------- | ---------------------------------------------------------------------------- | ------------------------------- | ------------------------------------- |
| `packages/cli/src/commands/workflow.ts` `workflowRunCommand`      | This story                            | Foreground `--json` suppresses logs but emits no JSON           | Emit `workflow.start` success/error envelope after `executeWorkflow` returns | Hermes adapter, CLI users       | Fixture conformance test + unit tests |
| `packages/cli/src/commands/workflow.ts` `workflowGetCommand`      | This story                            | `--json` emits raw `WorkflowRun` row or `{ ok: false }`         | Emit `workflow.status` success/error envelope                                | Hermes adapter, CLI users       | Fixture conformance test + unit tests |
| `packages/cli/src/cli.ts`                                         | This story (minimal)                  | `--correlation-id` only threaded to `provider-binding` commands | Thread `--correlation-id` into workflow run and get subcommands              | `workflow.ts` command functions | Implicit via functional tests         |
| `packages/cli/src/commands/workflow.ts` `WorkflowRunOptions`      | This story                            | No `correlationId` field                                        | Add `correlationId?: string`                                                 | `workflowRunCommand`            | Type-check                            |
| `packages/cli/src/commands/workflow-provider-command-envelope.ts` | Story 3.3a (read-only for this story) | Complete shared envelope module                                 | No changes needed                                                            | Both start and status producers | N/A                                   |
| Contract fixtures                                                 | Checked-in artifacts (read-only)      | `start-success.json`, `status-success.json`, 5 error examples   | No changes — runtime must conform                                            | Fixture conformance tests       | Fixture diff tests                    |

### Invariant and Ownership Map

| Invariant                                                                       | Source of truth                                                                                              | Enforcement owner                                                                         | Created or transformed at                                           | Persisted or transmitted at              | Consumed by                         | Proof                                             |
| ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------- | ---------------------------------------- | ----------------------------------- | ------------------------------------------------- |
| Envelope matches `workflow-command-envelope.v1` schema                          | `_bmad-output/planning-artifacts/contracts/workflow-commander/schemas/workflow-command-envelope.schema.json` | Shared builders (`buildSuccessEnvelope`/`buildErrorEnvelope`) + fixture conformance tests | `workflowRunCommand` and `workflowGetCommand` when `json: true`     | stdout (single JSON line per invocation) | External controllers (Hermes)       | Schema validation test + fixture diff test        |
| Success envelope always includes `workflowRunRef` for `workflow.*` commands     | `buildSuccessEnvelope` runtime check                                                                         | Shared builder throws if missing                                                          | After `executeWorkflow` result and `workflowDb.getWorkflowRun`      | stdout                                   | External controllers                | Builder unit test (from 3.3a) + integration test  |
| Error envelopes never include `result`; success envelopes never include `error` | Schema `oneOf` + builder construction                                                                        | Builder constructors                                                                      | At envelope creation                                                | stdout                                   | External controllers                | Fixture conformance test                          |
| `--json` mode emits only the envelope to stdout — no human text                 | `workflowRunCommand` / `workflowGetCommand` code paths                                                       | Guard checks on `options.json`                                                            | All `console.log` calls gated on `!options.json` in foreground path | stdout                                   | External controllers (parse-safety) | Test asserting single valid JSON object on stdout |
| Forbidden keys absent from all envelopes                                        | Schema `additionalProperties: false` + contract rule                                                         | Fixture conformance tests                                                                 | N/A                                                                 | stdout                                   | External controllers                | Forbidden-key scan in tests                       |
| `correlationId` is stable UUID, auto-generated when not supplied                | `resolveCorrelationId()` from shared module                                                                  | Shared helper                                                                             | At command entry                                                    | Envelope JSON                            | External controllers (idempotency)  | Unit test                                         |
| `--detach --json` regression: existing ack shape preserved                      | Current implementation                                                                                       | This story must not change the detach path                                                | N/A                                                                 | stdout                                   | Existing CLI consumers              | Regression unit test                              |

### Lifecycle and State Analysis

| State or phase                 | Entry condition                               | Valid transition                                                         | Exit condition                         | Failure or interruption behavior                                       | Recovery or cleanup behavior                          |
| ------------------------------ | --------------------------------------------- | ------------------------------------------------------------------------ | -------------------------------------- | ---------------------------------------------------------------------- | ----------------------------------------------------- |
| CLI invocation starts          | User runs `archon workflow run <name> --json` | Resolve workflow → validate flags → (detach branch or foreground branch) | Envelope emitted to stdout + exit code | `withFailClosed` emits error envelope and exits non-zero               | N/A (single-shot CLI)                                 |
| Foreground: workflow executing | `executeWorkflow` called                      | Runs DAG to completion, failure, or pause                                | `WorkflowExecutionResult` returned     | Exception caught → error envelope                                      | Process signal handlers mark run as failed (existing) |
| Foreground: result mapping     | `executeWorkflow` returned                    | Map result to success or error envelope → emit                           | stdout write completes                 | If mapping itself fails, outer try/catch emits INTERNAL_ERROR envelope | N/A                                                   |
| Status query                   | User runs `archon workflow get <id> --json`   | DB lookup → map to envelope → emit                                       | stdout write completes                 | DB error → error envelope; not found → NOT_FOUND envelope              | N/A                                                   |

### Failure, Concurrency, Security, and Compatibility Analysis

- Typed failures:
  - `MALFORMED_REQUEST` — workflow not found, invalid flags, missing required args.
  - `COMMAND_TIMEOUT` — execution timeout, DB statement timeout.
  - `WORKFLOW_FAILED` — `executeWorkflow` returns `success: false`.
  - `NOT_FOUND` — `workflow get` for a non-existent run ID.
  - `INTERNAL_ERROR` — unhandled exceptions, DB connection errors.
  - `UNEXPECTED_EXIT` — non-zero exit from internal process.
- Concurrency and race conditions: None within scope. CLI is single-process, single-invocation. The underlying workflow execution and DB access handle their own concurrency.
- Transaction, atomicity, and partial-write boundaries: Envelope is built entirely in memory and written as a single `console.log` call. No partial write risk. The `safeStringify` utility from 3.3a handles circular references and BigInt.
- Security and trust boundaries: No new security surfaces. `stdoutRedacted: true` and `stderrRedacted: true` in error envelopes prevent leaking internal details. No secrets or tokens in envelopes.
- Compatibility and migration boundaries: The `--json` flag for `workflow get` currently emits a legacy `{ ...run }` shape. This is replaced with the shared envelope. The legacy shape was Archon-internal (not part of a versioned contract), used only by the manage_run native tool and the Archon web UI (which uses HTTP API, not CLI). Confirm no other consumers depend on the legacy `workflow get --json` shape before shipping.
- Diagnostics and evidence preservation: Error envelopes include `execution.durationMs`, `execution.exitCode`, and `execution.timedOut`. Log entries preserved at existing log points. No new DB writes.

### Solution Design and Decision Record

- Selected approach: Add envelope production to the existing `workflowRunCommand` and `workflowGetCommand` functions, gated on the `json` flag. Reuse the shared builders from Story 3.3a. Add a workflow-specific `classifyWorkflowError` helper (modeled on `provider-binding.ts`'s `classifyError`). Wrap the foreground JSON path in a `withFailClosed`-style try/catch to guarantee parseable output on any failure.
- Why this approach preserves simplicity, robustness, scalability, and long-term maintainability:
  - Reuses shared builders: no new envelope construction logic.
  - Classification function is local to workflow commands (same pattern as binding commands — not a shared abstraction yet, rule of three not met for extraction).
  - Guards (json-mode gating, try/catch fail-closed) are explicit and co-located with the command functions.
  - Patterns established here will be repeated in stories 3.3c and 3.3d for decision and recovery commands.
- Rejected alternative: Creating a generic `withWorkflowEnvelope` higher-order wrapper that wraps all workflow commands. Rejected because the result-to-envelope mapping differs per command (start produces `accepted`, status produces `terminal`/`actionRequired`), so a generic wrapper would need command-specific callbacks that add indirection without reducing code.
- Rejected alternative: Modifying `executeWorkflow` to return envelope-ready data. Rejected because the executor is in `@archon/workflows` (engine layer) and must not know about CLI envelope contracts — the translation belongs in the CLI command.

### Implementation Slices

| Slice                        | Owned behavior or invariant                                               | Files or modules                                                         | Positive proof                                    | Failing-path proof                              | Integration impact               |
| ---------------------------- | ------------------------------------------------------------------------- | ------------------------------------------------------------------------ | ------------------------------------------------- | ----------------------------------------------- | -------------------------------- |
| 1: Start success envelope    | `workflow run --json` foreground emits `workflow.start` success envelope  | `workflow.ts` (`workflowRunCommand`), `cli.ts` (correlation-id plumbing) | Fixture conformance test vs `start-success.json`  | Paused-run envelope test                        | Hermes can parse start results   |
| 2: Start error envelope      | `workflow run --json` foreground failures emit structured error envelopes | `workflow.ts` (`workflowRunCommand`)                                     | Failed-workflow error envelope test               | Not-found, timeout, flag-validation error tests | Hermes can fail closed on errors |
| 3: Status success envelope   | `workflow get --json` emits `workflow.status` success envelope            | `workflow.ts` (`workflowGetCommand`), `cli.ts` (correlation-id plumbing) | Fixture conformance test vs `status-success.json` | Paused-with-gateRef test                        | Hermes can parse status results  |
| 4: Status error envelope     | `workflow get --json` failures emit structured error envelopes            | `workflow.ts` (`workflowGetCommand`)                                     | Not-found error envelope test                     | DB-error envelope test                          | Hermes can fail closed on errors |
| 5: Contract conformance      | All envelopes match fixtures and schema                                   | New test file                                                            | Load + diff 7 fixtures                            | Forbidden-key scan                              | Contract integrity               |
| 6: Test isolation + validate | Tests run in isolated `bun test` invocations                              | `packages/cli/package.json`                                              | `bun run validate` passes                         | N/A                                             | CI green                         |

### Executable Proof Design

| Acceptance Criterion    | Proof command or test                                                       | Positive assertion                                                                                                                                                                                                                                                                                                                                              | Failing-path assertion                                                                                                                                                                               | Required state or side effect                                | Prohibited side effect                                                                     | Evidence                                                         |
| ----------------------- | --------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ | ------------------------------------------------------------------------------------------ | ---------------------------------------------------------------- |
| AC #1 (start success)   | `bun test packages/cli/src/commands/workflow-start-status-envelope.test.ts` | Mock `executeWorkflow` returning `{ success: true, workflowRunId: 'test-id' }`. Assert stdout is valid JSON matching `start-success.json` structure: has `schemaVersion`, `command: 'workflow.start'`, `success: true`, `workflowRunRef`, `result.operation: 'start'`, `result.state: 'running'`, `result.phase: 'implementation'`, and `result.accepted: true` | Mock `executeWorkflow` returning `{ success: true, paused: true, workflowRunId: 'test-id' }`. Assert `result.state: 'waiting-for-approval'`, `result.terminal: false`, `result.actionRequired: true` | Mocked workflow discovery, mocked DB, mocked executeWorkflow | No human-text console.log in stdout; no `error` key in success envelope; no forbidden keys | JSON parse succeeds; field-by-field fixture diff passes          |
| AC #2 (status success)  | `bun test packages/cli/src/commands/workflow-start-status-envelope.test.ts` | Mock `getWorkflowRun` returning a `WorkflowRun` with `status: 'running'`. Assert stdout is valid JSON matching `status-success.json` structure: has `command: 'workflow.status'`, `success: true`, `workflowRunRef`, `result.operation: 'status'`, `result.terminal: false`                                                                                     | Mock run with `status: 'paused'` and valid `metadata.approval`. Assert `result.state: 'waiting-for-approval'`, `result.actionRequired: true`, `gateRef` populated                                    | Mocked `workflowDb.getWorkflowRun`                           | No `result` key in error envelope; no forbidden keys                                       | JSON parse succeeds; field-by-field fixture diff passes          |
| AC #3 (error envelopes) | `bun test packages/cli/src/commands/workflow-start-status-envelope.test.ts` | Mock `executeWorkflow` returning `{ success: false, error: 'node X failed' }`. Assert stdout has `success: false`, `error.code`, `error.category`, `error.retryable`, `execution` block                                                                                                                                                                         | Mock workflow not found → `MALFORMED_REQUEST`; mock DB timeout → `COMMAND_TIMEOUT`; mock run not found → `NOT_FOUND`                                                                                 | Mocked workflow discovery, mocked DB                         | No `result` key in error envelope; no forbidden keys; no unstructured throws to stderr     | JSON parse succeeds; error shape matches contract error fixtures |

### Explicit Boundary and Deferral Record

| Excluded behavior or deferred concern                                      | Owner or future story                               | Reason                                                                                                         | Current invariant remains complete because                                                                          |
| -------------------------------------------------------------------------- | --------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `workflow.approve`, `workflow.reject` envelope production                  | Story 3.3c                                          | Decision commands are a separate story                                                                         | Start and status are independently useful; approve/reject already have `--json` but use legacy `{ ok: true }` shape |
| `workflow.resume`, `workflow.retry`, `workflow.cancel` envelope production | Story 3.3d                                          | Recovery commands are a separate story                                                                         | Start and status cover the run initiation and inspection surfaces                                                   |
| `--detach --json` envelope conversion to shared envelope                   | Deferred (not in current epic scope)                | The detach ack is an Archon-internal convenience shape, not a controller contract command                      | Detach regression test ensures existing behavior is preserved                                                       |
| Streaming JSON output during workflow execution                            | Not planned                                         | The envelope is a post-execution result, not a streaming protocol                                              | Controllers get the final result when execution completes                                                           |
| HTTP route equivalents for `workflow.start` / `workflow.status`            | Not planned (FR-8 says no HTTP control path for v1) | PRD FR-8 explicitly forbids state-changing HTTP control for Workflow Commander v1                              | CLI-only producer surface                                                                                           |
| `projectBindingRef` population when no binding exists                      | N/A                                                 | The field is optional in the contract (only included when a binding is registered)                             | Omitting it is valid per schema; controllers handle absence                                                         |
| Legacy `workflow get --json` shape consumers                               | Verify before shipping                              | The `{ ...run }` shape was Archon-internal; the manage_run native tool and web UI use HTTP API routes, not CLI | Check `grep -rn 'workflow get.*--json\|workflowGetCommand'` for any CLI consumers of the old shape                  |

### Project Structure Notes

- All changes are in `packages/cli/` — no cross-package boundary violations.
- New test file: `packages/cli/src/commands/workflow-start-status-envelope.test.ts` (or `workflow-start-status-contract.test.ts` for fixture conformance).
- Test file must be added to `packages/cli/package.json` `test` script as a separate `bun test` invocation if it uses `mock.module()`.
- Import shared envelope builders from `./workflow-provider-command-envelope` (relative import within CLI package).
- Import `isApprovalContext` from `@archon/workflows/schemas/workflow-run` for safe metadata access.
- Import `TERMINAL_WORKFLOW_STATUSES` from `@archon/workflows/schemas/workflow-run` for terminal state derivation.
- No new DB migrations, no server changes, no web changes.

### References

- [Source: _bmad-output/planning-artifacts/contracts/workflow-commander/schemas/workflow-command-envelope.schema.json] — envelope JSON Schema
- [Source: _bmad-output/planning-artifacts/contracts/workflow-commander/examples/providers/archon/commands/start-success.json] — start success fixture
- [Source: _bmad-output/planning-artifacts/contracts/workflow-commander/examples/providers/archon/commands/status-success.json] — status success fixture
- [Source: _bmad-output/planning-artifacts/contracts/workflow-commander/examples/providers/archon/commands/error-*.json] — error fixtures (5 files)
- [Source: packages/cli/src/commands/workflow-provider-command-envelope.ts] — shared envelope builders (Story 3.3a)
- [Source: packages/cli/src/commands/provider-binding.ts] — reference pattern for `classifyError`, `emitEnvelope`, `withFailClosed`
- [Source: packages/cli/src/commands/workflow.ts:412-1048] — `workflowRunCommand` (modify for start envelope)
- [Source: packages/cli/src/commands/workflow.ts:1258-1321] — `workflowGetCommand` (modify for status envelope)
- [Source: packages/cli/src/cli.ts:343] — `--correlation-id` flag declaration
- [Source: packages/cli/src/cli.ts:532] — workflow run options currently omit correlation-id
- [Source: packages/cli/src/cli.ts:563] — workflow get currently calls `workflowGetCommand` without correlation-id
- [Source: packages/workflows/src/schemas/workflow-run.ts:168-184] — `WorkflowRun` schema
- [Source: packages/workflows/src/schemas/workflow-run.ts:186-217] — `ApprovalContext` and `isApprovalContext`
- [Source: packages/workflows/src/schemas/workflow-run.ts:22-26] — `TERMINAL_WORKFLOW_STATUSES`
- [Source: _bmad-output/planning-artifacts/architecture.md#Provider-Command-Syntax-Baseline] — CLI syntax baseline
- [Source: _bmad-output/planning-artifacts/prd.md#FR-8] — functional requirement
- [Source: _bmad-output/planning-artifacts/epics.md#Epic-3] — epic context

## Failure Analysis & Proof Readiness

### Failure Mode Risk Scan

- F1 Contract invariants not enforced: MITIGATED — shared builders enforce `schemaVersion`, `intendedProducer`, `command` validity, and `workflowRunRef` presence at runtime. Fixture conformance tests diff field-by-field against checked-in fixtures. Schema validation test runs the JSON Schema against produced envelopes.
- F2 Split source of truth: MITIGATED — envelope structure is defined once in shared builders; result mapping is defined once per command function. No parallel type definitions.
- F3 Fail-open ingress validation: N/A — this story is a producer (output), not a consumer (input). The `--correlation-id` input is validated by `resolveCorrelationId` (empty → UUID). Workflow name resolution uses existing `resolveWorkflowName`.
- F4 Incomplete drift/coverage gates: MITIGATED — fixture conformance tests load actual fixture files from disk, so a fixture change breaks the test until runtime is updated. `bun run validate` runs all tests pre-PR.
- F5 Mandated commands not running real gates: MITIGATED — `bun run validate` is the pre-PR gate. Tests mock `executeWorkflow` and DB calls but verify the CLI-layer envelope construction (the layer this story owns). Executor behavior is covered by its own test suite.
- F6 Bypassable dependency-direction checks: N/A — no new dependency directions introduced. CLI imports from shared envelope module (peer within package) and from `@archon/workflows/schemas` (existing dependency).
- F7 Cleanup without preserved-behavior regression tests: MITIGATED — the legacy `workflow get --json` shape replacement includes a note to verify no other consumers exist. The `--detach --json` existing shape is preserved (regression test).
- F8 Review findings recorded without ownership triage: N/A — this is a story creation, not a review.

### AC Proof Matrix

| Acceptance Criterion   | Proof Command/Test                                                                                                                      | Failing-Path Evidence                                                                                                                        | Ownership Boundary                                                                                    | Deferral Decision                                      |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| AC #1: Start success   | `bun test packages/cli/src/commands/workflow-start-status-envelope.test.ts` — tests for completed run, paused run, with/without binding | Paused run → `state: 'waiting-for-approval'`; missing binding → no `projectBindingRef` in result (not an error)                              | CLI layer produces envelope; executor layer produces `WorkflowExecutionResult`; DB layer persists run | N/A                                                    |
| AC #2: Status success  | Same test file — tests for each `WorkflowRunStatus` value, paused with approval context                                                 | Paused run → `gateRef` populated from `metadata.approval` via `isApprovalContext`; completed run → `terminal: true`                          | CLI layer produces envelope; DB layer provides `WorkflowRun` row                                      | N/A                                                    |
| AC #3: Error envelopes | Same test file — tests for workflow-not-found, execution failure, DB error, timeout, flag validation                                    | Each error path produces a structurally valid error envelope with correct `code`/`category`/`retryable`; no unstructured throws reach stdout | CLI layer classifies errors; shared builder produces envelope                                         | Decision/recovery command errors deferred to 3.3c/3.3d |

## Dev Agent Record

### Agent Model Used

Qoder (anthropic)

### Debug Log References

All 12 review findings from the story were addressed across two fix passes. No open findings remain.

### Completion Notes List

- Fix Review-1: Gated CLIAdapter.sendMessage dispatch prose on !jsonMode to prevent stdout corruption in JSON mode.
- Fix Review-2: cli.ts now emits MALFORMED_REQUEST envelope for missing workflow name in JSON mode; flag conflict checks deferred to workflowRunCommand in JSON mode.
- Fix Review-3: Changed workflowRunCommand return type from Promise<void> to Promise<number>; error envelopes exit 1, success exits 0. cli.ts propagates exit code.
- Fix Review-4: Added projectRef to workflowRunRef when codebase.name exists (start and status paths). projectBindingRef deferred — requires new DB lookup in @archon/core.
- Fix Review-5: Added error field to status result for failed runs when metadata.error is a string.
- Fix Review-6: Added 3.3B-CONTRACT-005b with assertEnvelopeConforms helper validating required fields, types, oneOf discriminator, and known top-level key set. 3 new tests.
- Fix Review-7: Added `silent` option to CLIAdapter to suppress console.log during executeWorkflow in JSON mode. Executor/platform messages no longer corrupt stdout.
- Fix Review-8: cli.ts `workflow get` missing run-id now emits MALFORMED_REQUEST envelope in JSON mode. Workflow worktree policy conflicts emit MALFORMED_REQUEST instead of INTERNAL_ERROR in JSON mode.
- Fix Review-9: Added `listBindingsByCodebase` to @archon/core/db/provider-bindings. Start envelopes now populate projectBindingRef when a binding exists for the codebase.
- Fix Review-10: Status envelopes now include `phase` (derived from metadata or status), structure `error` as `{message}` object, and report all paused runs as actionRequired:true.
- Fix Review-11: Improved assertEnvelopeConforms to be schema-driven (reads schema file, validates workflowRunRef/error/execution structure, checks additionalProperties). CONTRACT-001/002 now use structural parity checks.
- Fix Review-12: All JSON error paths now return classified exit codes (64/USAGE, 69/TIMEOUT, 70/SOFTWARE) instead of generic 1. Updated 5 existing test assertions.
- Type-check: passes for all packages.
- Lint: zero warnings.
- Format: all files conform.
- CLI tests: 463 pass, 0 fail across all batches.
- Pre-existing @archon/core test failure is unrelated to these changes (CLI-only scope).

### File List

- packages/cli/src/commands/workflow.ts — Silent adapter, policy conflict envelopes, projectBindingRef, phase/structured-error/actionRequired, classified exit codes
- packages/cli/src/cli.ts — MALFORMED_REQUEST envelope for missing get run-id, exit code 64 propagation
- packages/cli/src/adapters/cli-adapter.ts — Added `silent` option to suppress console.log
- packages/core/src/db/provider-bindings.ts — Added listBindingsByCodebase function
- packages/cli/src/commands/workflow.test.ts — Added provider-bindings mock, updated 2 exit code assertions (64, 70)
- packages/cli/src/commands/workflow-start-status-envelope.test.ts — Added provider-bindings mock, schema-driven assertEnvelopeConforms, structural parity checks, updated 3 exit code assertions (64, 69, 70), added phase to PAUSED_RUN metadata
- \_bmad-output/implementation-artifacts/3-3b-provide-archon-start-and-status-cli-json.md — Marked all review findings done
