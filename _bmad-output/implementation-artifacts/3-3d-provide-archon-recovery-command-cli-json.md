# Story 3.3d: Provide Archon Recovery Command CLI JSON

Status: ready-for-dev

<!-- A story may become ready-for-dev only after solution-readiness and proof-readiness validation pass. -->

## Story

As a workflow operator,
I want provider `archon` to expose resume, retry, and cancel through parseable CLI JSON,
so that external controllers can route recovery actions consistently.

## Acceptance Criteria

1. **Given** a workflow run is in a resumable state
   **When** Archon executes `workflow.resume`
   **Then** it returns the shared success envelope with the resumed workflow run reference and resulting run state
   **And** a non-resumable state returns an unexpected-state failure envelope without mutating the run.

2. **Given** a workflow run can be retried from its failed work
   **When** Archon executes `workflow.retry` without `--node`
   **Then** it returns the shared success envelope for whole-run recovery
   **And** completed work is preserved or skipped according to the existing workflow retry contract.

3. **Given** a failed workflow node is eligible for targeted retry
   **When** Archon executes `workflow.retry --node <node-id>`
   **Then** it returns the shared success envelope identifying the requested node and workflow run
   **And** an unknown or ineligible node returns a machine-readable failure without starting recovery.

4. **Given** a workflow run is active and cancellable
   **When** Archon executes `workflow.cancel`
   **Then** it returns the shared success envelope with the resulting run state
   **And** it does not report or serialize the operation as legacy `abandon`.

5. **Given** any recovery command receives malformed input, times out, exits unexpectedly, produces schema-invalid JSON, or targets an invalid run state
   **When** Archon returns the failure
   **Then** the response uses the shared failure envelope with code, category, retryability, and structured details
   **And** no unsupported state transition is applied.

## Tasks / Subtasks

- [ ] Slice 1: Convert `workflowResumeCommand` JSON path to emit the `workflow.resume` envelope (AC: 1, 5)
  - [ ] In `packages/cli/src/commands/workflow.ts`, replace the existing `workflowResumeCommand` JSON branch (`workflow.ts:2909-2931`) — currently emitting `{ ok: true, runId, action: 'resume', executed: false, status, workflowName, workingPath }` — with a fail-closed envelope path using `buildSuccessEnvelope`/`buildErrorEnvelope`.
  - [ ] Change function signature from `(runId: string, json?: boolean, cwd?: string): Promise<void>` to `(runId: string, json?: boolean, correlationId?: string, cwd?: string): Promise<number>`. The `correlationId` parameter inserts after `json` and before `cwd` (additive — preserves existing call sites that omit both).
  - [ ] Wrap the entire `if (json)` block in a fail-closed try/catch: every thrown `Error` inside the JSON path must be caught and converted into a `buildErrorEnvelope(...)` call via `console.log(safeStringify(...))`, never reaching the caller's plain-text catch. Resolve `correlationId` and `issuedAt` **inside** the try/catch so resolution failures are also caught (RF-09 pattern from 3-3b).
  - [ ] On success: after `resumeWorkflowOp(resolvedId)` returns the validated run (confirms resumable), re-fetch the persisted run via `workflowDb.getWorkflowRun(resolvedId)` to read authoritative `status` and `metadata`, then build a `workflow.resume` success envelope with `workflowRunRef` (via `buildWorkflowRunRef`), and `result` containing `{ operation: 'resume', previousState: <pre-resume-status>, state: <post-resume-state>, resumed: true }` plus `terminal` from `mapWorkflowRunToContractState`. Note: `resumeWorkflowOp` validates but does NOT mutate the run status (it returns the run as-is for the caller to decide on execution). The envelope reports the current `status` (still `failed`/`paused`) with `resumed: true` as the intent signal — the consumer (Hermes) drives the actual execution separately. If the run row cannot be loaded post-validation, emit `INTERNAL_ERROR`/`implementation_defect`/70.
  - [ ] On error: classify via `classifyRunError` and emit a `workflow.resume` error envelope. Specific classification additions needed in Slice 5: `'Cannot resume run with status'` → `UNEXPECTED_STATE`/`unexpected_state`/78.
  - [ ] Replace the `printJsonWriteError` call (`workflow.ts:2929`) with the envelope path.
  - [ ] Guarantee JSON mode writes exactly one JSON line to stdout and no human text. The resume JSON path does NOT execute the workflow inline (documented design since the function was written — `workflow.ts:2904-2908`), so no adapter stdout suppression is needed.
  - [ ] When `json` is falsy, preserve ALL existing behavior byte-for-byte: same blocking re-execution flow, same `console.log` messages, same thrown errors.
  - [ ] Return `0` on success, `classified.exitCode` on error in JSON mode. Non-JSON path retains void semantics (throws on error, caller handles).
  - [ ] Add positive and failing-path proof for this slice (see Executable Proof Design).

- [ ] Slice 2: Create new `workflowCancelCommand` with `workflow.cancel` envelope (AC: 4, 5)
  - [ ] Create a NEW exported function `workflowCancelCommand(runId: string, json?: boolean, correlationId?: string, cwd?: string): Promise<number>` in `packages/cli/src/commands/workflow.ts`. This is a **new function**, NOT a modification of `workflowAbandonCommand`.
  - [ ] The function calls `abandonWorkflow(resolvedId)` from `packages/core/src/operations/workflow-operations.ts` (same underlying operation) but emits the `workflow.cancel` envelope — never `abandon` in any field.
  - [ ] JSON path: fail-closed try/catch identical to Slice 1. On success: re-fetch the persisted run after `abandonWorkflow`, build a `workflow.cancel` success envelope with `workflowRunRef`, and `result` containing `{ operation: 'cancel', previousState: <pre-cancel-status>, state: 'cancelled', terminal: true }`. If the run row cannot be loaded post-cancel, emit `INTERNAL_ERROR`/`implementation_defect`/70.
  - [ ] On error: classify via `classifyRunError`. Specific classification additions needed in Slice 5: `'Cannot abandon run with status'` → `UNEXPECTED_STATE`/`unexpected_state`/78.
  - [ ] Non-JSON path: emit the same human text as `workflowAbandonCommand`'s non-JSON path (`Cancelled workflow run: <id>\nWorkflow: <name>`), but say "Cancelled" not "Abandoned". This is NOT the legacy `abandon` command — it's a new surface.
  - [ ] The legacy `workflowAbandonCommand` is left **completely untouched**. It retains its `{ ok: true/false }` legacy shape, `printJsonWriteError`, and `void` return. It is NOT converted to the envelope in this story (the Workflow Commander contract explicitly requires `workflow.cancel` to be distinct from legacy `abandon`).
  - [ ] Guarantee no envelope output contains the string `abandon` anywhere.
  - [ ] Add positive and failing-path proof for this slice.

- [ ] Slice 3: Create new `workflowRetryCommand` with `workflow.retry` envelope (AC: 2, 3, 5)
  - [ ] Create a NEW exported function `workflowRetryCommand(runId: string, nodeId: string | undefined, json?: boolean, correlationId?: string, cwd?: string): Promise<number>` in `packages/cli/src/commands/workflow.ts`. This is a **new function**, NOT a modification of `workflowRetryNodeCommand`.
  - [ ] The function is a **non-blocking validation ack** (like approve/reject JSON): it validates the retry is possible and reports the outcome, but does NOT execute the retry inline (execution would stream to stdout, corrupting the JSON contract). The consumer drives the actual execution separately (or uses the blocking `retry-node` command for human use).
  - [ ] Without `--node` (whole-run retry): validate the run is in `RETRYABLE_WORKFLOW_STATUSES` (`failed`/`cancelled`) by calling `resumeWorkflowOp(resolvedId)` (which checks `RESUMABLE_WORKFLOW_STATUSES` = `failed`/`paused`) — **wait**: whole-run retry is semantically different from resume. Resume requires `failed`/`paused`; retry allows `failed`/`cancelled`. The correct validation is: fetch the run, check `RETRYABLE_WORKFLOW_STATUSES.includes(run.status)`, and if not, throw. Do NOT call `resumeWorkflowOp` here — call `workflowDb.getWorkflowRun(resolvedId)` directly and validate the status. On success, emit the `workflow.retry` success envelope with `result: { operation: 'retry', mode: 'whole-run', state: run.status, retryable: true }`. The envelope does NOT include `previousAttempt`/`currentAttempt` because at the ack phase no new run has been created yet (that happens during execution). The fixture's `previousAttempt`/`currentAttempt` is a BMAD-specific concept — Archon's retry creates a new run linked to the previous via resume semantics; the ack reports readiness, not execution state.
  - [ ] With `--node <node-id>` (targeted node retry): validate the node exists and the run is retryable by reusing `prepareWorkflowNodeRetry`'s validation portion. Load the workflow definition via `loadWorkflowForRetryCommand(resolvedId, cwd)`, then call `prepareWorkflowNodeRetry({ runId: resolvedId, nodeId, workflow, requesterSurface: 'cli', requesterUserId: 'provider-command', authorizationBasis: 'workflow.retry' })`. On success, emit the `workflow.retry` success envelope with `result: { operation: 'retry', mode: 'node', nodeId, state: 'running', retryEpoch: prepared.retryEpoch }` and `workflowRunRef` pointing to the **new pre-created run** (`prepared.preCreatedRun`). On `WorkflowRetryError`, classify by `.code` (see Slice 5) and emit an error envelope.
  - [ ] **Critical design decision**: `workflow.retry --node` with JSON IS a mutating operation (unlike resume/cancel which are pure validation acks). `prepareWorkflowNodeRetry` performs the CAS claim, creates the new run, records audit events, and resets the git state. This is required because the AC says "returns the shared success envelope identifying the requested node and workflow run" — the "workflow run" is the newly created retry run, which only exists after `prepareWorkflowNodeRetry`. The actual DAG execution still does NOT happen inline — it must be driven separately (matching how the web UI handles node retry: prepare → execute as a background task). If this mutating-ack design is unacceptable, escalate before coding.
  - [ ] The legacy `workflowRetryNodeCommand` is left **completely untouched**. It retains its `--json` rejection (`'does not support --json in v1'`), streaming execution, and `void` return.
  - [ ] Add positive and failing-path proof for both whole-run and node-targeted paths.

- [ ] Slice 4: Wire `--correlation-id`, dispatch cases, and pre-handler envelope paths in `cli.ts` (AC: 5)
  - [ ] Extend `getWorkflowCommandEnvelopeCommand` (`cli.ts:121-131`) to map: `subcommand === 'resume'` → `'workflow.resume'`, `subcommand === 'cancel'` → `'workflow.cancel'`, `subcommand === 'retry'` → `'workflow.retry'`.
  - [ ] Extend the `WorkflowCommandEnvelopeCommand` type alias (`cli.ts:116-119`) to include `| 'workflow.resume' | 'workflow.retry' | 'workflow.cancel'`.
  - [ ] Modify the existing `case 'resume'` dispatch (`cli.ts:881-888`): when `workflowProviderJsonRequested && envelopeCommand`, emit `MALFORMED_REQUEST` for missing run-id, thread `values['correlation-id']` as `correlationId`, and `return await workflowResumeCommand(...)`. When NOT in JSON mode, preserve the current behavior exactly.
  - [ ] Add a NEW `case 'cancel'` dispatch: validate run-id presence (emit `MALFORMED_REQUEST` envelope if missing under JSON mode, `console.error('Usage: ...')` otherwise), thread `correlationId`, call `return await workflowCancelCommand(...)`.
  - [ ] Add a NEW `case 'retry'` dispatch: parse `--node <node-id>` from `values['node']` (add `node: { type: 'string' }` to `parseArgs` options), validate run-id presence, thread `correlationId`, call `return await workflowRetryCommand(runId, nodeId, jsonFlag, correlationId, effectiveCwd)`.
  - [ ] `parseArgs` option addition: add `'node': { type: 'string' }` to the workflow options list so `--node <id>` is consumed as a named flag (not positional text).
  - [ ] Verify the existing pre-dispatch guards in `cli.ts` now cover `workflow resume/cancel/retry --json`: the `workflowProviderJsonRequested` check uses `envelopeCommand !== undefined`, which will now be truthy for these three. All existing guards (log silencing, blank correlation-id, invalid JSON flag, directory-not-found, not-a-git-repo) apply automatically.
  - [ ] Update usage/help text to document the new commands: `workflow cancel <run-id> [--json]`, `workflow retry <run-id> [--node <node-id>] [--json]`.
  - [ ] Add proof for pre-handler failure paths.

- [ ] Slice 5: Extend `classifyRunError` for recovery-specific error patterns (AC: 5)
  - [ ] Add patterns to `classifyRunError` (`workflow.ts:262-328`) for recovery-specific errors:
    - `'Cannot resume run with status'` → `UNEXPECTED_STATE`/`unexpected_state`/`retryable: false`/78.
    - `'Cannot abandon run with status'` → `UNEXPECTED_STATE`/`unexpected_state`/`retryable: false`/78.
    - `'Cannot retry workflow run'` (from `WorkflowRetryError` with code `run_not_retryable`) → `UNEXPECTED_STATE`/`unexpected_state`/`retryable: false`/78.
  - [ ] Add **`WorkflowRetryError`-specific classification** by checking `err instanceof WorkflowRetryError` BEFORE substring matching. Map `WorkflowRetryError.code` directly:
    - `'run_not_found'` → `WORKFLOW_RUN_NOT_FOUND`/`unexpected_state`/`retryable: false`/78.
    - `'run_not_retryable'` → `UNEXPECTED_STATE`/`unexpected_state`/`retryable: false`/78.
    - `'node_not_found'` → `NODE_NOT_FOUND`/`unexpected_state`/`retryable: false`/78.
    - `'node_not_failed'` → `UNEXPECTED_STATE`/`unexpected_state`/`retryable: false`/78.
    - `'node_not_retryable'` → `NODE_NOT_RETRYABLE`/`unexpected_state`/`retryable: false`/78.
    - `'cas_miss'` → `UNEXPECTED_STATE`/`unexpected_state`/`retryable: true`/78 (CAS miss is transient — concurrent retry won the race; consumer can retry).
    - `'path_in_use'` → `UNEXPECTED_STATE`/`unexpected_state`/`retryable: false`/78.
    - `'checkpoint_unavailable'` → `UNEXPECTED_STATE`/`implementation_defect`/`retryable: false`/70 (missing checkpoint is a system problem, not a user error).
    - `'git_reset_failed'` → `INTERNAL_ERROR`/`implementation_defect`/`retryable: false`/70.
    - `'dispatch_failed'` → `INTERNAL_ERROR`/`implementation_defect`/`retryable: false`/70.
  - [ ] The `WorkflowRetryError` check must come BEFORE the generic `msg.includes('Workflow run not found')` pattern to avoid substring collision (the retry error's message also contains "Workflow run not found").
  - [ ] Add substring patterns for resume/cancel to the existing UNEXPECTED_STATE block: `msg.includes('Cannot resume run with status') || msg.includes('Cannot abandon run with status')`.
  - [ ] Delete `printJsonWriteError` (`workflow.ts:2575-2584`) — after Slices 1 and 2, its only remaining callers were `workflowResumeCommand` (replaced in Slice 1) and `workflowAbandonCommand` (untouched, but legacy `abandon` is **not** a provider command). Check: `workflowAbandonCommand` still uses `printJsonWriteError`. **Decision**: retain `printJsonWriteError` — `workflowAbandonCommand` is legacy, untouched, and still calls it. Deletion deferred until legacy `abandon` is deprecated or removed.
  - [ ] Add unit tests for each new classifier pattern, including negative tests proving `'Cannot resume'` alone (without `'run with status'`) does not match, and that generic `WorkflowRetryError` codes don't fall through to wrong categories.

- [ ] Slice 6: Contract and regression tests (AC: 1, 2, 3, 4, 5)
  - [ ] Update `packages/cli/src/commands/workflow.test.ts` to add tests for `workflowResumeCommand` JSON mode:
    - Resume success (from `failed`): assert `command: 'workflow.resume'`, `success: true`, `result.operation: 'resume'`, `result.previousState: 'failed'`, `result.state: 'failed'`, `result.resumed: true`, `workflowRunRef` present.
    - Resume success (from `paused`): assert same shape with `previousState: 'paused'`, `state: 'paused'`.
    - Resume failure — not resumable (completed): assert `command: 'workflow.resume'`, `success: false`, `error.code: 'UNEXPECTED_STATE'`, `error.category: 'unexpected_state'`, `error.retryable: false`, `execution.exitCode: 78`.
    - Resume failure — not resumable (cancelled): same UNEXPECTED_STATE.
    - Resume failure — run not found: assert `WORKFLOW_RUN_NOT_FOUND`/78.
    - Resume failure — DB error on post-validation fetch: assert `INTERNAL_ERROR`/`implementation_defect`/70.
    - Resume failure — timeout: assert `COMMAND_TIMEOUT`/`timeout`/`retryable: true`/69.
  - [ ] Update tests for `workflowCancelCommand` JSON mode:
    - Cancel success (from `running`): assert `command: 'workflow.cancel'`, `result.operation: 'cancel'`, `result.previousState: 'running'`, `result.state: 'cancelled'`, `result.terminal: true`.
    - Cancel success (from `paused`): assert same with `previousState: 'paused'`.
    - Cancel success (from `failed`): assert same with `previousState: 'failed'`.
    - Cancel failure — already terminal (completed): assert `UNEXPECTED_STATE`/78.
    - Cancel failure — already terminal (cancelled): assert `UNEXPECTED_STATE`/78.
    - Cancel failure — run not found: assert `WORKFLOW_RUN_NOT_FOUND`/78.
    - Cancel failure — DB error on post-cancel fetch: assert `INTERNAL_ERROR`/70.
  - [ ] Update tests for `workflowRetryCommand` JSON mode:
    - Retry success — whole-run (from `failed`): assert `command: 'workflow.retry'`, `result.operation: 'retry'`, `result.mode: 'whole-run'`, `result.state: 'failed'`, `result.retryable: true`.
    - Retry success — whole-run (from `cancelled`): same with `state: 'cancelled'`.
    - Retry success — node (from `failed`): assert `result.mode: 'node'`, `result.nodeId: '<id>'`, `result.retryEpoch` present, `workflowRunRef.runId` is the new pre-created run.
    - Retry failure — whole-run not retryable (running): assert `UNEXPECTED_STATE`/78.
    - Retry failure — whole-run not retryable (paused): assert `UNEXPECTED_STATE`/78.
    - Retry failure — node not found (`WorkflowRetryError('node_not_found')`): assert `error.code: 'NODE_NOT_FOUND'`/78.
    - Retry failure — node not retryable (`WorkflowRetryError('node_not_retryable')`): assert `NODE_NOT_RETRYABLE`/78.
    - Retry failure — run not retryable (`WorkflowRetryError('run_not_retryable')`): assert `UNEXPECTED_STATE`/78.
    - Retry failure — CAS miss: assert `UNEXPECTED_STATE`/`retryable: true`/78.
    - Retry failure — path in use: assert `UNEXPECTED_STATE`/`retryable: false`/78.
    - Retry failure — checkpoint unavailable: assert `UNEXPECTED_STATE`/`implementation_defect`/70.
    - Retry failure — git reset failed: assert `INTERNAL_ERROR`/70.
    - Retry failure — run not found: assert `WORKFLOW_RUN_NOT_FOUND`/78.
  - [ ] Add or update E2E subprocess tests (`packages/cli/src/commands/workflow-json.e2e.test.ts`) proving:
    - `workflow resume --json` with missing run ID emits `MALFORMED_REQUEST` envelope.
    - `workflow cancel --json` with missing run ID emits `MALFORMED_REQUEST` envelope.
    - `workflow retry --json` with missing run ID emits `MALFORMED_REQUEST` envelope.
    - `workflow resume/cancel/retry --json --correlation-id <id>` echoes the correlation ID in envelopes.
    - `workflow resume/cancel/retry --json` without `--correlation-id` emits blank-correlation-id `MALFORMED_REQUEST` (inherits from existing `cli.ts` pre-dispatch guard).
    - `workflow resume/cancel/retry --json=true` (assigned non-boolean) emits `MALFORMED_REQUEST`.
    - `workflow resume/cancel --json --cwd /nonexistent` emits `MALFORMED_REQUEST` with `fieldErrors[{path:'/cwd',code:'directory_not_found'}]`.
    - `workflow resume/cancel --json` from non-git directory emits `MALFORMED_REQUEST` with `fieldErrors[{path:'/cwd',code:'not_a_git_repository'}]`.
  - [ ] Add contract tests (in `workflow-command-contract.test.ts`) asserting:
    - Emitted resume/cancel/retry envelopes contain no forbidden keys (`actor`, `profile`, `agent_name`, `agent`, `agent_provider`, `message`, `stdout`, `stderr`, `displayText`).
    - Emitted envelopes validate against `workflow-command-envelope.schema.json` via the existing `test-helpers/validate_runtime_envelope.py` pattern.
  - [ ] Document intentional fixture field-set delta: the `retry-success.json` fixture contains `previousAttempt` and `currentAttempt` which are BMAD-specific execution-phase concepts. This story's `workflow.retry` envelope reports validation/ack-phase state (`mode`, `retryable`, `nodeId`, `retryEpoch`) — not execution outcome. The `result` object is `"additionalProperties": true` in the schema, so differing fields require no contract change. Similarly, `resume-success.json` shows `state: 'running'` implying immediate execution; this story's resume reports the current DB state (still `failed`/`paused`) with `resumed: true` — the consumer drives execution.
  - [ ] Confirm `packages/cli/package.json`'s test script placement: verify existing isolated invocations cover the modified/new test files.

- [ ] Slice 7: Validate focused and full gates (AC: 1, 2, 3, 4, 5)
  - [ ] Run `python3 _bmad-output/planning-artifacts/contracts/workflow-commander/validate_contracts.py`.
  - [ ] Run `bun test packages/cli/src/commands/workflow.test.ts`.
  - [ ] Run `bun test packages/cli/src/commands/workflow-provider-command-envelope.test.ts` (regression — must not modify the shared envelope module).
  - [ ] Run `bun test packages/cli/src/commands/workflow-command-contract.test.ts`.
  - [ ] Run `bun --filter @archon/cli type-check`.
  - [ ] Run `bun run validate` before moving to review.

## Dev Notes

### Feature and System Context

- Outcome: `archon workflow resume <run-id> --json`, `archon workflow cancel <run-id> --json`, and `archon workflow retry <run-id> [--node <node-id>] --json` emit machine-readable JSON envelopes instead of the legacy `{ ok: true/false }` shape (resume/abandon) or outright rejection (retry-node), enabling external controllers (Hermes) to parse recovery results without scraping human output.
- Architectural role: This is the fourth and final workflow command family converted to the shared envelope (after `workflow.start`/`workflow.status` in 3-3b and `workflow.approve`/`workflow.reject` in 3-3c). It completes the Workflow Commander CLI JSON producer surface for Archon.
- Upstream authorities: `resumeWorkflow` and `abandonWorkflow` in `packages/core/src/operations/workflow-operations.ts` are the business logic for resume and cancel. `prepareWorkflowNodeRetry` in `packages/core/src/operations/workflow-retry.ts` is the business logic for targeted node retry. They throw on invalid state; callers format the response.
- Downstream consumers: Hermes Story 3.4c consumes these commands.
- User-visible or system-visible behavior: Three new/converted `--json` CLI outputs. Non-JSON resume and abandon output unchanged. A wholly new `cancel` subcommand is added (distinct from legacy `abandon`). A wholly new `retry` subcommand is added (distinct from streaming `retry-node`).

### Canonical Artifact Reconciliation

| Source | Relevant claim | Current code or prior-story decision | Resolution |
| --- | --- | --- | --- |
| [Source: epics.md#Story 3.3d] | Resume, retry, and cancel must use the validated shared envelope | Current resume JSON uses `{ ok: true }` legacy shape; retry-node rejects `--json`; cancel doesn't exist | Convert resume to envelope; create new `cancel` and `retry` commands |
| [Source: epics.md#Provider Command Syntax Baseline] | `workflow.cancel` = `archon workflow cancel <run-id> --json` | No `cancel` subcommand exists; `abandon` is the legacy equivalent | Create new `cancel` subcommand using same `abandonWorkflow` op but envelope-branded |
| [Source: epics.md#Provider Command Syntax Baseline] | `workflow.retry` = `archon workflow retry <run-id> [--node <node-id>] --json` | No `retry` subcommand exists; `retry-node` streams and rejects `--json` | Create new `retry` subcommand — non-blocking ack with optional node targeting |
| [Source: 3-3a story:57] | `workflow.cancel` must not treat legacy `workflow abandon` as the Workflow Commander command | `workflowAbandonCommand` exists with legacy shape | New `workflowCancelCommand` function; legacy untouched |
| [Source: 3-3a story:58] | `workflow.retry` must not reuse the existing streaming-only `workflow retry-node` surface | `workflowRetryNodeCommand` rejects `--json` and streams | New `workflowRetryCommand` function; legacy untouched |
| [Source: architecture.md#Provider Command Syntax Baseline] | `workflow.resume` = `archon workflow resume <run-id> --json` | Existing `workflowResumeCommand` has a JSON path but emits legacy shape | Convert the JSON path to envelope; non-JSON unchanged |
| [Source: prd.md#FR-8] | Every result includes schema version, success flag, correlation id, workflow run reference | Legacy resume JSON omits all of these; retry/cancel don't exist | Convert resume; create retry/cancel with all required fields |
| [Source: resume-success.json fixture] | `result.state: 'running'` implies execution happened | Resume JSON is a non-blocking ack — run stays `failed`/`paused` | Document fixture delta: Archon reports current DB state + `resumed: true`; consumer drives execution |
| [Source: retry-success.json fixture] | `result.previousAttempt: 1, currentAttempt: 2` implies execution happened | Retry JSON is a non-blocking ack (whole-run) or prepare-only (node) | Document fixture delta: Archon reports readiness/preparation, not execution outcome |
| [Source: cancel-success.json fixture] | `result.previousState: 'running', state: 'cancelled', terminal: true` | `abandonWorkflow` performs the CAS cancel | Matches — emit `previousState` from pre-cancel status, `state: 'cancelled'`, `terminal: true` |
| [Source: 3-3c story#Explicit Boundary] | `printJsonWriteError` deletion deferred to 3-3d | `printJsonWriteError` still used by `workflowAbandonCommand` | Retain — legacy `abandon` is untouched and still calls it |
| [Source: 3-3c story#Explicit Boundary] | `workflowAbandonCommand` envelope conversion deferred to 3-3d | Legacy `abandon` emits `{ ok: true/false }` | `abandon` is NOT a Workflow Commander command. New `cancel` is. Legacy `abandon` stays untouched. |
| [Source: 3-3c story#Explicit Boundary] | `workflowResumeCommand` envelope conversion deferred to 3-3d | Legacy resume JSON emits `{ ok: true }` | Convert in this story (Slice 1) |
| [Source: deferred-work.md] | Canonical examples encode BMAD-specific semantics | resume/retry fixtures have BMAD-specific execution-phase fields | Document the fixture delta; do not fabricate BMAD-specific fields |

### Solution Surface Map

| Surface | Owner or authority | Current state | Required change | Consumers | Proof |
| --- | --- | --- | --- | --- | --- |
| `workflowResumeCommand` JSON branch | `workflow.ts:2909-2931` | Emits `{ ok: true, runId, action:'resume', executed:false, status, workflowName, workingPath }` | Replace with `buildSuccessEnvelope`/`buildErrorEnvelope` in fail-closed try/catch | Hermes 3.4c, CLI JSON consumers | Unit tests for success/error shapes |
| `workflowCancelCommand` (NEW) | New function in `workflow.ts` | Does not exist | Create with envelope-emitting JSON path + human-text non-JSON path | Hermes 3.4c, CLI JSON consumers | Unit tests for success/error/terminal shapes |
| `workflowRetryCommand` (NEW) | New function in `workflow.ts` | Does not exist | Create with whole-run validation + node-targeted `prepareWorkflowNodeRetry` paths | Hermes 3.4c, CLI JSON consumers | Unit tests for both modes + all WorkflowRetryError codes |
| `workflowAbandonCommand` | `workflow.ts:2981-3016` | Legacy `{ ok: true }` shape with `printJsonWriteError` | **NO CHANGE** — legacy command, not a Workflow Commander surface | Legacy CLI users | Existing tests pass unchanged |
| `workflowRetryNodeCommand` | `workflow.ts:2733-2822` | Rejects `--json`, streams execution output | **NO CHANGE** — streaming human command, not a provider command | Human CLI users | Existing tests pass unchanged |
| `printJsonWriteError` | `workflow.ts:2575-2584` | Used by `workflowResumeCommand` and `workflowAbandonCommand` | Retain — `workflowAbandonCommand` (untouched) still uses it | Internal helper | No unused-function warning |
| `getWorkflowCommandEnvelopeCommand` | `cli.ts:121-131` | Maps run/get/approve/reject | Add resume/cancel/retry | Pre-dispatch JSON guards | E2E tests for pre-handler envelopes |
| `WorkflowCommandEnvelopeCommand` type | `cli.ts:116-119` | 4 variants | Add 3 variants: resume, retry, cancel | Type system | Type-check gate |
| `cli.ts` resume dispatch | `cli.ts:881-888` | `await workflowResumeCommand(...)` (void, no correlationId, no exit code) | Guard missing-run-id as envelope, thread correlationId, `return await` | CLI → command function | E2E tests |
| `cli.ts` cancel dispatch (NEW) | Does not exist | N/A | New `case 'cancel'` with same pattern as approve/reject | CLI → command function | E2E tests |
| `cli.ts` retry dispatch (NEW) | Does not exist | N/A | New `case 'retry'` parsing `--node` flag, threading correlationId | CLI → command function | E2E tests |
| `classifyRunError` | `workflow.ts:262-328` | Covers workflow-not-found, run-not-found, decision-specific, malformed, timeout | Add recovery-specific patterns + WorkflowRetryError instanceof check | Resume/cancel/retry error envelopes | Unit tests per new pattern |

### Invariant and Ownership Map

| Invariant | Source of truth | Enforcement owner | Created or transformed at | Persisted or transmitted at | Consumed by | Proof |
| --- | --- | --- | --- | --- | --- | --- |
| Every `--json` resume/cancel/retry emits exactly one envelope to stdout | This story's design | Fail-closed boundary per function | JSON branch entry point | stdout (single `console.log`) | External controllers (Hermes) | Unit test asserting single stdout line; E2E subprocess test |
| No human text on stdout in JSON mode | This story's design | Fail-closed boundary; no inline execution in JSON mode | JSON branch (no workflow execution, no adapter instantiation) | stdout | External controllers | Unit test + E2E test asserting no stray text |
| Error envelopes contain `code`, `category`, `retryable`, `exitCode` | `workflow-command-envelope.schema.json` | `buildErrorEnvelope` from 3-3a | `classifyRunError` / `WorkflowRetryError` → `buildErrorEnvelope` | stdout | External controllers | Unit test per error type; contract test |
| `workflowRunRef` present on success envelopes | Shared envelope convention from 3-3a | `buildSuccessEnvelope` validates | Post-operation run fetch | stdout | External controllers | Unit test for success shape |
| `workflow.cancel` envelope never contains `abandon` | AC #4 explicit requirement | `workflowCancelCommand` implementation | Envelope construction | stdout | External controllers | Contract test scanning emitted envelopes for forbidden `abandon` |
| Non-JSON resume/abandon paths unchanged | Scope constraint | No code changes outside `if (json)` blocks | N/A | N/A | CLI human users | Existing tests pass unchanged |
| JSON resume does NOT execute workflow inline | Existing design (workflow.ts:2904-2908) | `if (json) { ... return; }` before re-execution code | Already implemented | stdout ack only | External controllers | Test asserts no `workflowRunCommand` call in JSON mode |
| `correlationId` echoed in every envelope | FR-8 | `resolveCorrelationId` from shared envelope module | CLI `--correlation-id` flag | stdout envelope | External controllers | E2E test asserting correlation-id round-trip |
| `WorkflowRetryError.code` drives classification (not substring) | This story's design | `classifyRunError` instanceof check BEFORE substring matching | Error throw in `prepareWorkflowNodeRetry` | Error envelope | External controllers | Unit tests for each typed code |
| No unsupported state transition applied on error | AC #5 explicit requirement | Operations layer CAS semantics + validation-before-mutation | `resumeWorkflowOp` validates without mutating; `abandonWorkflow` uses CAS; `prepareWorkflowNodeRetry` claims atomically | Error envelope confirms `mutationApplied: false` | External controllers | Tests confirm no state change on error paths |

### Lifecycle and State Analysis

| State or phase | Entry condition | Valid transition | Exit condition | Failure or interruption behavior | Recovery or cleanup behavior |
| --- | --- | --- | --- | --- | --- |
| Run is `failed`, resume requested | `RESUMABLE_WORKFLOW_STATUSES.includes(status)` | `resumeWorkflowOp` validates → envelope ack | Envelope emitted with `resumed: true` | `resumeWorkflowOp` throws if not in `failed`/`paused` | Throw → `classifyRunError` → error envelope, no mutation |
| Run is `paused`, resume requested | Same as above | Same | Same | Same | Same |
| Run is `running`/`paused`/`failed`, cancel requested | Status not in `completed`/`cancelled` | `abandonWorkflow` CAS → status `cancelled` | Envelope emitted with `state: 'cancelled', terminal: true` | `abandonWorkflow` throws if already terminal | Throw → error envelope; container reclaim happens inside `abandonWorkflow` on success only |
| Run is `failed`/`cancelled`, whole-run retry requested | `RETRYABLE_WORKFLOW_STATUSES.includes(status)` | Validate only (no mutation) → envelope ack | Envelope emitted with `retryable: true` | Status not in `failed`/`cancelled` → throw | Throw → error envelope, no mutation |
| Run is `failed`/`cancelled`, node retry requested | `RETRYABLE_WORKFLOW_STATUSES.includes(status)` AND node exists AND node eligible | `prepareWorkflowNodeRetry` CAS → new run created, git reset | Envelope emitted with new run ref and `retryEpoch` | `WorkflowRetryError` thrown at any validation or CAS step | `restoreFailedAfterRetrySetupError` reverts run to `failed` if setup fails mid-CAS |
| CLI JSON mode entry | `json` parameter truthy | Resolve correlation-id and issuedAt inside try/catch, call operation, build envelope | Exactly one `console.log(safeStringify(...))` | Any throw → error envelope | Fail-closed boundary catches all |
| Post-cancel run fetch | `abandonWorkflow` CAS succeeded | Fetch persisted run for envelope state mapping | Run row loaded | DB error → `INTERNAL_ERROR` envelope; cancel was still applied | Log error, emit envelope with exitCode 70 |

### Failure, Concurrency, Security, and Compatibility Analysis

- Typed failures:
  - `resumeWorkflowOp` throws: `'Cannot resume run with status '<status>'. Only failed or paused runs can be resumed.'` when status ∉ {failed, paused}.
  - `abandonWorkflow` throws: `'Cannot abandon run with status '<status>'. Only running, paused, or failed runs can be abandoned.'` when status ∈ {completed, cancelled}.
  - `prepareWorkflowNodeRetry` throws typed `WorkflowRetryError` with code: `run_not_found | run_not_retryable | node_not_found | node_not_failed | node_not_retryable | cas_miss | path_in_use | checkpoint_unavailable | git_reset_failed | dispatch_failed`.
  - `resolveRunIdArg` throws: `'Workflow run not found: <id>'` or `'Run id ... matches more than one run'`.
  - `loadWorkflowForRetryCommand` throws: workflow-not-found (regex pattern already in classifier), codebase lookup errors.

- Concurrency and race conditions:
  - Two concurrent cancels: `cancelWorkflowRun` is `UPDATE ... WHERE status NOT IN (completed, cancelled)` — CAS semantics. First wins (`cancelled: true`), second gets `cancelled: false` (but `abandonWorkflow` checks status BEFORE the CAS, so the second caller's `getRunOrThrow` would return the now-cancelled run → throw `'Cannot abandon run with status cancelled'` → `UNEXPECTED_STATE` envelope). Correct.
  - Cancel + resume race: if cancel wins the CAS first, the subsequent resume's `resumeWorkflowOp` sees `cancelled` status → throws. Correct.
  - Two concurrent `workflow.retry --node`: `prepareWorkflowNodeRetry` uses `claimRetryRun` CAS. Second caller gets `cas_miss` → `UNEXPECTED_STATE`/`retryable: true` envelope. Correct.
  - Node retry + concurrent resume: `claimRetryRun` attempts to transition a failed/cancelled run; if resume already moved it to running, the claim fails → `cas_miss`. Correct.

- Transaction, atomicity, and partial-write boundaries:
  - `abandonWorkflow`: `cancelWorkflowRun` is an atomic CAS. Container reclaim is best-effort post-CAS. If envelope emission fails (process crash between CAS and `console.log`), the cancel was persisted — consumer times out and retries → gets `UNEXPECTED_STATE` (already cancelled). Correct fail-closed.
  - `prepareWorkflowNodeRetry`: CAS claim + run creation + audit events in composed transactions. If any setup step fails, `restoreFailedAfterRetrySetupError` reverts the run to `failed`. If envelope emission fails after preparation completed, the new run exists — consumer retries → gets `cas_miss` (the claim is held). The consumer should treat this as success pending execution.

- Security and trust boundaries:
  - No secrets in envelopes. `result` fields contain only operation metadata (state, mode, nodeId, epoch).
  - Raw error messages from operations layer are NOT leaked into `details`. Log via `getLog().error(...)`. Envelope `details` gets only `{ runId }` (and optionally `{ nodeId }` for node retry errors).

- Compatibility and migration boundaries:
  - `workflow resume --json` output changes from `{ ok: true }` to envelope shape. Breaking change to the legacy format — intentional and documented. The only intended consumer is Hermes.
  - Legacy `workflow abandon` output is **unchanged** — no break.
  - `workflow cancel` and `workflow retry` are wholly new subcommands — no compatibility concern.
  - `workflow retry-node` behavior unchanged — rejects `--json`, streams as before.

- Diagnostics and evidence preservation:
  - Every error envelope emits machine-readable `code`/`category`/`retryable`. Raw error messages logged server-side only.
  - `WorkflowRetryError.code` provides high-fidelity classification without substring guessing.

### Solution Design and Decision Record

- Selected approach: (1) Convert `workflowResumeCommand` JSON branch to fail-closed envelope using the same pattern as 3-3c's approve/reject. (2) Create a NEW `workflowCancelCommand` function that calls `abandonWorkflow` but emits the `workflow.cancel` envelope — never touching legacy `workflowAbandonCommand`. (3) Create a NEW `workflowRetryCommand` function that validates whole-run retryability (without execution) or calls `prepareWorkflowNodeRetry` for node targeting (mutating ack). (4) Extend `cli.ts` dispatch with three new/modified cases and widen the envelope command type.
- Why this approach preserves simplicity, robustness, scalability, and long-term maintainability: Each recovery command gets its own function mirroring the established 3-3c pattern. No existing commands are retrofitted (3-3a's explicit constraint). The typed `WorkflowRetryError` code is classified via instanceof before substring matching — structured error routing instead of fragile string guessing. The non-blocking ack design matches the pattern established for approve/reject (JSON doesn't execute; consumer drives execution separately).
- Rejected alternative: Retrofitting `workflowAbandonCommand` as `workflow.cancel` (renaming the command). Rejected because 3-3a explicitly states "do not treat legacy `workflow abandon` as the Workflow Commander command" and existing scripts may depend on `abandon`'s output format.
- Rejected alternative: Making `workflow.retry --node` a pure validation ack (no mutation, like resume). Rejected because the AC says "returns the shared success envelope identifying the requested node and workflow run" — the "workflow run" reference is the newly created retry run, which only exists after `prepareWorkflowNodeRetry` performs its CAS. A validation-only ack cannot provide a new `runId`.
- Rejected alternative: Making `workflow.retry` (whole-run, no `--node`) execute inline. Rejected because execution streams output to stdout, corrupting the JSON contract. Matches the established "JSON = ack, not execution" pattern.
- Rejected alternative: Fabricating `previousAttempt`/`currentAttempt` fields to match the BMAD fixture byte-for-byte. Rejected because these are execution-phase concepts. The ack phase reports readiness/preparation state. `result` is `"additionalProperties": true` — differing fields need no schema change.

### Implementation Slices

| Slice | Owned behavior or invariant | Files or modules | Positive proof | Failing-path proof | Integration impact |
| --- | --- | --- | --- | --- | --- |
| 1 — Resume envelope | Resume JSON emits shared envelope | `workflow.ts` (`workflowResumeCommand`) | Success envelope shape tests (failed, paused) | Error envelope for not-resumable, not-found, DB-error, timeout | None — JSON path doesn't execute |
| 2 — Cancel command | New `cancel` subcommand with envelope | `workflow.ts` (`workflowCancelCommand`) | Success envelope shape tests (running, paused, failed) | Error envelope for already-terminal, not-found, DB-error | None — new function, no existing callers |
| 3 — Retry command | New `retry` subcommand with whole-run + node modes | `workflow.ts` (`workflowRetryCommand`) | Success tests for both modes | Error envelope for every WorkflowRetryError code | Node retry is mutating (CAS claim + new run) |
| 4 — CLI wiring | Pre-dispatch guards apply to resume/cancel/retry | `cli.ts` | E2E: correlation-id echoed, pre-dispatch guards fire | E2E: missing run-id, blank correlation-id, invalid JSON flag | Pre-dispatch guards now cover 7 commands |
| 5 — Classifier extension | Recovery errors classified correctly | `workflow.ts` (`classifyRunError`) | Unit tests for each new pattern/code | Negative tests for non-matching strings | Shared classifier — regression check required |
| 6 — Contract tests | No forbidden keys, schema-valid, no `abandon` | `workflow-command-contract.test.ts` | Contract validation passing | Fixture delta documented | Contract compliance |
| 7 — Validation | All gates pass | N/A | `bun run validate` | N/A | CI green |

### Executable Proof Design

| Acceptance Criterion | Proof command or test | Positive assertion | Failing-path assertion | Required state or side effect | Prohibited side effect | Evidence |
| --- | --- | --- | --- | --- | --- | --- |
| AC #1 — Resume success (failed) | `bun test workflow.test.ts` — `workflowResumeCommand --json success (failed)` | `command: 'workflow.resume'`, `success: true`, `result.operation: 'resume'`, `result.previousState: 'failed'`, `result.resumed: true`, `workflowRunRef.runId` matches | N/A | Mock: `resumeWorkflowOp` returns run with `status:'failed'`; `getWorkflowRun` returns same | No workflow execution; no adapter stdout | stdout = single JSON line |
| AC #1 — Resume success (paused) | `bun test workflow.test.ts` — `workflowResumeCommand --json success (paused)` | Same shape with `previousState: 'paused'` | N/A | Mock: run with `status:'paused'` | Same | stdout = single JSON line |
| AC #1 — Resume error (not resumable) | `bun test workflow.test.ts` — `workflowResumeCommand --json error (completed)` | N/A | `command: 'workflow.resume'`, `success: false`, `error.code: 'UNEXPECTED_STATE'`, `error.category: 'unexpected_state'`, `error.retryable: false`, `execution.exitCode: 78` | Mock: `resumeWorkflowOp` throws `'Cannot resume run with status "completed"'` | No state mutation; no raw error in details | stdout = single JSON line |
| AC #1 — Resume error (run not found) | `bun test workflow.test.ts` | N/A | `error.code: 'WORKFLOW_RUN_NOT_FOUND'`, `execution.exitCode: 78` | Mock: `resolveRunIdArg` throws `'Workflow run not found: abc123'` | No state mutation | stdout = single JSON line |
| AC #2 — Retry success (whole-run) | `bun test workflow.test.ts` — `workflowRetryCommand --json success (whole-run)` | `command: 'workflow.retry'`, `success: true`, `result.operation: 'retry'`, `result.mode: 'whole-run'`, `result.retryable: true` | N/A | Mock: `getWorkflowRun` returns run with `status:'failed'` | No execution; no mutation | stdout = single JSON line |
| AC #2 — Retry error (not retryable) | `bun test workflow.test.ts` | N/A | `error.code: 'UNEXPECTED_STATE'`, `execution.exitCode: 78` | Run status `'running'` ∉ RETRYABLE_WORKFLOW_STATUSES | No mutation | stdout = single JSON line |
| AC #3 — Retry success (node) | `bun test workflow.test.ts` — `workflowRetryCommand --json success (node)` | `result.mode: 'node'`, `result.nodeId: '<id>'`, `result.retryEpoch` present, `workflowRunRef.runId` = prepared.preCreatedRun.id | N/A | Mock: `prepareWorkflowNodeRetry` returns `WorkflowNodeRetryPreparedResult` | No DAG execution | stdout = single JSON line |
| AC #3 — Retry error (node not found) | `bun test workflow.test.ts` | N/A | `error.code: 'NODE_NOT_FOUND'`, `execution.exitCode: 78` | Mock: `prepareWorkflowNodeRetry` throws `WorkflowRetryError('node_not_found', ...)` | No CAS claim; no state mutation | stdout = single JSON line |
| AC #3 — Retry error (node not retryable) | `bun test workflow.test.ts` | N/A | `error.code: 'NODE_NOT_RETRYABLE'`, `execution.exitCode: 78` | Mock: `WorkflowRetryError('node_not_retryable', ...)` | Same | stdout = single JSON line |
| AC #4 — Cancel success (running) | `bun test workflow.test.ts` — `workflowCancelCommand --json success (running)` | `command: 'workflow.cancel'`, `success: true`, `result.operation: 'cancel'`, `result.previousState: 'running'`, `result.state: 'cancelled'`, `result.terminal: true` | N/A | Mock: `abandonWorkflow` returns run; re-fetch returns cancelled run | Container reclaim happens inside `abandonWorkflow` (opaque) | stdout = single JSON line; no `abandon` substring anywhere |
| AC #4 — Cancel error (already cancelled) | `bun test workflow.test.ts` | N/A | `error.code: 'UNEXPECTED_STATE'`, `execution.exitCode: 78` | Mock: `abandonWorkflow` throws `'Cannot abandon run with status "cancelled"'` | No state mutation | stdout = single JSON line |
| AC #5 — Missing run-id (resume) | `workflow-json.e2e.test.ts` subprocess | N/A | `command: 'workflow.resume'`, `error.code: 'MALFORMED_REQUEST'`, `execution.exitCode: 64` | No positional arg after `resume` | No plain-text usage string | stdout = single JSON line |
| AC #5 — Missing run-id (cancel) | `workflow-json.e2e.test.ts` subprocess | N/A | `command: 'workflow.cancel'`, `error.code: 'MALFORMED_REQUEST'`, `execution.exitCode: 64` | Same | Same | stdout = single JSON line |
| AC #5 — Missing run-id (retry) | `workflow-json.e2e.test.ts` subprocess | N/A | `command: 'workflow.retry'`, `error.code: 'MALFORMED_REQUEST'`, `execution.exitCode: 64` | Same | Same | stdout = single JSON line |
| AC #5 — Blank correlation-id | `workflow-json.e2e.test.ts` subprocess | N/A | `error.code: 'MALFORMED_REQUEST'`, `details.fieldErrors[0].path: '/correlationId'` | `--json --correlation-id ""` | No plain-text error | Inherited from existing cli.ts guard |
| AC #5 — Invalid JSON flag | `workflow-json.e2e.test.ts` subprocess | N/A | `error.code: 'MALFORMED_REQUEST'`, `details.fieldErrors[0].path: '/json'` | `--json=true` | Same | Inherited from existing cli.ts guard |
| AC #5 — Timeout | `bun test workflow.test.ts` | N/A | `error.code: 'COMMAND_TIMEOUT'`, `error.category: 'timeout'`, `error.retryable: true`, `execution.exitCode: 69` | DB call throws with `code: 'ETIMEDOUT'` | Same | stdout = single JSON line |
| AC #4 — No `abandon` in envelope | `workflow-command-contract.test.ts` | Scanned envelope JSON (stringified) does not contain `abandon` | N/A | Emit cancel success/error envelopes, search for `abandon` | N/A | Contract test |
| Regression — Non-JSON unchanged | Existing `workflowResumeCommand`/`workflowAbandonCommand` non-JSON tests pass | Existing tests passing | N/A | This story does not modify non-JSON paths | N/A | Test suite |
| Regression — Start/status/approve/reject JSON unchanged | Existing 3-3b/3-3c tests pass | Existing tests passing | N/A | Classifier changes must not overmatch | N/A | Test suite |

### Explicit Boundary and Deferral Record

| Excluded behavior or deferred concern | Owner or future story | Reason | Current invariant remains complete because |
| --- | --- | --- | --- |
| `workflowAbandonCommand` envelope conversion | Not planned — legacy command | `abandon` is NOT a Workflow Commander surface per 3-3a | New `workflowCancelCommand` is the provider surface; legacy untouched |
| `workflowRetryNodeCommand` envelope conversion | Not planned — streaming human command | `retry-node` streams execution and rejects `--json` by design | New `workflowRetryCommand` is the provider surface; legacy untouched |
| `printJsonWriteError` deletion | Not this story | `workflowAbandonCommand` still uses it | Helper still works for its remaining caller |
| `workflow.retry` whole-run execution triggering | Consumer responsibility (Hermes 3.4c) | Execution streams to stdout; JSON = ack only | Envelope reports readiness; consumer drives execution |
| `workflow.retry --node` actual DAG execution | Consumer responsibility | Same pattern as approve not auto-resuming | Envelope reports preparation; consumer drives execution |
| `previousAttempt`/`currentAttempt` fixture fields | Contract discussion | BMAD-specific execution-phase concepts | `result` is `"additionalProperties": true` — omitting is schema-valid |
| `resume-success.json` `state: 'running'` fixture | Contract discussion | Archon resume is a non-blocking ack, not execution | Documented fixture delta; consumer expects `resumed: true` + drives execution |
| `--detach` path for retry/cancel | Not applicable | These are non-blocking acks — nothing to detach | Envelope is the complete response |
| HTTP route for resume/retry/cancel | Not planned in v1 | PRD FR-8 forbids state-changing HTTP control for Workflow Commander v1 | CLI-only surface |
| Workflow event outbox integration | Story 3-5 | Separate concern — event delivery, not command response | Recovery command envelopes are independent of event delivery |

### Pre-Handler Failure Boundaries (Retro Gate Requirement)

Every path that can bypass JSON envelope generation before reaching the recovery command functions:

1. **`parseArgs` failure** (e.g., `--correlation-id` without a value): Already handled by `cli.ts:450-471` — the `rawWorkflowProviderOptions.jsonRequested` check falls through to `emitWorkflowCommandMalformedEnvelope`. This story's `getWorkflowCommandEnvelopeCommand` expansion makes this fire for resume/cancel/retry.

2. **Blank `--correlation-id`** (e.g., `--correlation-id ""`): Already handled by `cli.ts:540-549`. Now covers resume/cancel/retry via `workflowProviderJsonRequested`.

3. **Invalid JSON flag** (e.g., `--json=true`): Already handled by `cli.ts:550-559`. Now covers resume/cancel/retry.

4. **Directory does not exist** (e.g., `--cwd /nonexistent`): Already handled by `cli.ts:582-596`. Now covers resume/cancel/retry.

5. **Not a git repository**: Already handled by `cli.ts:658-676`. Now covers resume/cancel/retry.

6. **Missing run ID** (e.g., `archon workflow resume --json`): Currently `cli.ts:883-885` emits `console.error('Usage: ...')` + `return 1`. **Must be changed** for JSON mode: emit `MALFORMED_REQUEST` envelope when `workflowProviderJsonRequested && envelopeCommand`. Keep plain-text for non-JSON. Same for new `cancel` and `retry` commands.

7. **Bare `--correlation-id` consuming `--json`**: Already handled by `scanRawWorkflowProviderOptions` which detects `correlationIdMissingValue: true`.

8. **`--node` without a value** (retry only): `parseArgs` with `type: 'string'` consumes the next positional. If `--node --json`, the `--json` is consumed as the node value. `scanRawWorkflowProviderOptions` doesn't detect this. **Mitigation**: If the resulting `nodeId` starts with `--`, treat it as a parse artifact and emit `MALFORMED_REQUEST` with appropriate field error. Alternatively, validate `nodeId` doesn't match a flag pattern in the command function.

### Stdout/Stderr Sources That Can Corrupt Machine-Readable Output (Retro Gate Requirement)

1. **`console.log` in resume JSON branch** (`workflow.ts:2913-2927`): The legacy `JSON.stringify` call. **Replaced** by `console.log(safeStringify(envelope))`.

2. **`printJsonWriteError` in resume catch** (`workflow.ts:2929`): The legacy error emitter. **Replaced** by `console.log(safeStringify(errorEnvelope))`.

3. **New `workflowCancelCommand` and `workflowRetryCommand`**: Written from scratch with fail-closed envelope pattern — no legacy stdout sources exist.

4. **No `CLIAdapter` stdout in JSON mode**: The resume JSON path returns early BEFORE the re-execution code that creates a `CLIAdapter`. Cancel and retry do not execute workflows at all. No adapter is instantiated.

5. **Pino logger**: `setLogLevel('silent')` applied by `cli.ts:531` when `workflowProviderJsonRequested` is true (which now includes resume/cancel/retry). No Pino output reaches stdout.

6. **`console.error` for missing run-id**: Must be guarded — emit envelope in JSON mode.

7. **`loadWorkflowForRetryCommand` internal logging**: This helper may log via Pino during workflow discovery. Pino is already silenced (point 5). No concern.

### DB and Persistence Edge Cases (Retro Gate Requirement)

1. **Post-validation run fetch fails (resume)**: After `resumeWorkflowOp` validates (no mutation), the code re-fetches for the envelope. If `getWorkflowRun` throws, no state was changed — emit `INTERNAL_ERROR`. Consumer retries and the operation works normally.

2. **Post-cancel run fetch fails**: After `abandonWorkflow` CAS succeeds, the code re-fetches. If `getWorkflowRun` throws, the cancel WAS applied but no envelope is produced — emit `INTERNAL_ERROR`. Consumer retries → `UNEXPECTED_STATE` (already cancelled). Correct fail-closed.

3. **`prepareWorkflowNodeRetry` partial failure**: If the retry preparation fails mid-CAS (after claiming but before creating the run), `restoreFailedAfterRetrySetupError` reverts the run to `failed`. The error is caught → `WorkflowRetryError` → classified → error envelope. Correct.

4. **Concurrent cancel+resume race**: If cancel wins the `cancelWorkflowRun` CAS, a concurrent `resumeWorkflowOp` (which validates BEFORE mutation) would have already returned the pre-cancel run or would re-check and find `cancelled` → throw. If the concurrent call already passed validation but hasn't executed yet, that's the consumer's execution surface — not the ack command's concern.

5. **Short-id ambiguity**: `resolveRunIdArg` throws `'matches more than one run'` → already classified as `MALFORMED_REQUEST` by existing pattern. Correct.

6. **`cancelWorkflowRun` CAS returns `cancelled: false`**: This means a concurrent operation (resume, completion) already moved the run out of the cancellable state. `abandonWorkflow` currently does NOT check this — it proceeds with container reclaim only when `cancelled: true`, and returns the (pre-CAS) run object regardless. The post-cancel re-fetch will show the actual final state. If the re-fetch shows `completed` instead of `cancelled`, the envelope would report `state: 'completed'` — but this is misleading (we reported success when our cancel was actually a no-op). **Mitigation**: Check `cancelled` return value from `cancelWorkflowRun` (indirectly via `abandonWorkflow`'s return). Currently `abandonWorkflow` returns the run fetched BEFORE the CAS (from `getRunOrThrow`). The re-fetch after `abandonWorkflow` will show the actual state. If it's NOT `cancelled`, something else won — emit `UNEXPECTED_STATE` instead of success. Add this check in the cancel command function: `if (persistedRun.status !== 'cancelled') throw new Error('...')`.

### Error Classifier Positive and Negative Cases (Retro Gate Requirement)

New patterns to add to `classifyRunError`:

| Pattern | Match condition | Classification | Positive test case | Negative test case |
| --- | --- | --- | --- | --- |
| WorkflowRetryError — run_not_found | `err instanceof WorkflowRetryError && err.code === 'run_not_found'` | `WORKFLOW_RUN_NOT_FOUND`/`unexpected_state`/78 | `new WorkflowRetryError('run_not_found', 'Workflow run not found: abc')` → WORKFLOW_RUN_NOT_FOUND | `new Error('Workflow run not found: abc')` → should hit the existing generic `msg.includes('Workflow run not found')` pattern, NOT this branch (instanceof fails) |
| WorkflowRetryError — run_not_retryable | `err instanceof WorkflowRetryError && err.code === 'run_not_retryable'` | `UNEXPECTED_STATE`/`unexpected_state`/78 | `new WorkflowRetryError('run_not_retryable', '...')` → UNEXPECTED_STATE | N/A |
| WorkflowRetryError — node_not_found | `err instanceof WorkflowRetryError && err.code === 'node_not_found'` | `NODE_NOT_FOUND`/`unexpected_state`/78 | `new WorkflowRetryError('node_not_found', '...')` → NODE_NOT_FOUND | `new Error('node not found in graph')` → should NOT match (instanceof fails; falls to INTERNAL_ERROR) |
| WorkflowRetryError — node_not_retryable | `err instanceof WorkflowRetryError && err.code === 'node_not_retryable'` | `NODE_NOT_RETRYABLE`/`unexpected_state`/78 | `new WorkflowRetryError('node_not_retryable', '...')` → NODE_NOT_RETRYABLE | N/A |
| WorkflowRetryError — cas_miss | `err instanceof WorkflowRetryError && err.code === 'cas_miss'` | `UNEXPECTED_STATE`/`unexpected_state`/retryable:**true**/78 | `new WorkflowRetryError('cas_miss', '...')` → retryable: true | N/A |
| WorkflowRetryError — path_in_use | `err instanceof WorkflowRetryError && err.code === 'path_in_use'` | `UNEXPECTED_STATE`/`unexpected_state`/78 | `new WorkflowRetryError('path_in_use', '...')` → UNEXPECTED_STATE | N/A |
| WorkflowRetryError — checkpoint_unavailable | `err instanceof WorkflowRetryError && err.code === 'checkpoint_unavailable'` | `UNEXPECTED_STATE`/`implementation_defect`/70 | `new WorkflowRetryError('checkpoint_unavailable', '...')` → implementation_defect/70 | N/A |
| WorkflowRetryError — git_reset_failed | `err instanceof WorkflowRetryError && err.code === 'git_reset_failed'` | `INTERNAL_ERROR`/`implementation_defect`/70 | `new WorkflowRetryError('git_reset_failed', '...')` → INTERNAL_ERROR/70 | N/A |
| WorkflowRetryError — dispatch_failed | `err instanceof WorkflowRetryError && err.code === 'dispatch_failed'` | `INTERNAL_ERROR`/`implementation_defect`/70 | `new WorkflowRetryError('dispatch_failed', '...')` → INTERNAL_ERROR/70 | N/A |
| Cannot resume (wrong status) | `msg.includes('Cannot resume run with status')` | `UNEXPECTED_STATE`/`unexpected_state`/78 | `'Cannot resume run with status "completed"'` → UNEXPECTED_STATE | `'Cannot resume workflow'` (no "run with status") → should NOT match |
| Cannot abandon (wrong status) | `msg.includes('Cannot abandon run with status')` | `UNEXPECTED_STATE`/`unexpected_state`/78 | `'Cannot abandon run with status "completed"'` → UNEXPECTED_STATE | `'Cannot abandon'` alone → should NOT match |

**Ordering in `classifyRunError`**: The `WorkflowRetryError instanceof` check MUST come FIRST (before any substring matching), since retry error messages can contain substrings like "Workflow run not found" that would trigger the generic patterns. After the instanceof block, the new `'Cannot resume'`/`'Cannot abandon'` substring patterns go into the existing UNEXPECTED_STATE block (alongside `'Cannot approve'`/`'Cannot reject'`).

### Raw CLI Flag Parsing Risks (Retro Gate Requirement)

1. **`--correlation-id` value consumption**: Same risk as 3-3c (inherited from 3-3b). If user runs `archon workflow resume --correlation-id <run-id>`, the run-id is consumed as the correlation-id value. Not fixed in this story — hits the "missing run-id" handler.

2. **`--json=true`**: Handled by existing `invalidJsonFlag`/`rawWorkflowProviderOptions.jsonAssigned` guards.

3. **`--node` without value (retry)**: If user runs `archon workflow retry <run-id> --node --json`, `parseArgs` with `type: 'string'` consumes `--json` as the node value. `scanRawWorkflowProviderOptions` won't detect this because `--json` is NOT next to `--node` in the raw scan (the scan only checks for `--correlation-id` missing values). **Mitigation**: In `workflowRetryCommand`, if `nodeId` starts with `--`, treat as missing/malformed and emit `MALFORMED_REQUEST` with field error `{ path: '/node', code: 'invalid_value' }`.

4. **`--node` with empty string**: `archon workflow retry <run-id> --node ""` → `nodeId === ''`. In `workflowRetryCommand`, treat empty string as whole-run retry (no node targeting).

5. **`--` separator**: Everything after `--` is a positional in `parseArgs`. `archon workflow retry <run-id> -- --node foo` → `--node foo` is positional text, not a flag. This is acceptable — user gets the "whole-run" path.

### Required Negative Tests (Retro Gate Requirement)

1. Resume JSON with run not resumable (completed) → `UNEXPECTED_STATE` envelope, not plain text.
2. Resume JSON with run not resumable (cancelled) → `UNEXPECTED_STATE` envelope.
3. Resume JSON with run not found → `WORKFLOW_RUN_NOT_FOUND` envelope.
4. Resume JSON with DB error on post-validation fetch → `INTERNAL_ERROR` envelope.
5. Resume JSON timeout → `COMMAND_TIMEOUT` envelope.
6. Cancel JSON with run already terminal (completed) → `UNEXPECTED_STATE` envelope.
7. Cancel JSON with run already terminal (cancelled) → `UNEXPECTED_STATE` envelope.
8. Cancel JSON with run not found → `WORKFLOW_RUN_NOT_FOUND` envelope.
9. Cancel JSON with DB error on post-cancel fetch → `INTERNAL_ERROR` envelope.
10. Retry JSON whole-run with not-retryable run (running) → `UNEXPECTED_STATE` envelope.
11. Retry JSON whole-run with not-retryable run (paused) → `UNEXPECTED_STATE` envelope.
12. Retry JSON node with node not found → `NODE_NOT_FOUND` envelope.
13. Retry JSON node with node not retryable → `NODE_NOT_RETRYABLE` envelope.
14. Retry JSON node with CAS miss → `UNEXPECTED_STATE`/`retryable: true` envelope.
15. Retry JSON node with path in use → `UNEXPECTED_STATE` envelope.
16. Retry JSON node with checkpoint unavailable → implementation_defect/70.
17. Retry JSON node with git reset failed → `INTERNAL_ERROR`/70.
18. Missing run-id with `--json` (resume/cancel/retry) → `MALFORMED_REQUEST` envelope.
19. Blank `--correlation-id` with `--json` → `MALFORMED_REQUEST` (inherited).
20. `--json=true` (non-boolean) → `MALFORMED_REQUEST` (inherited).
21. Non-JSON resume behavior unchanged → existing tests pass without modification.
22. Non-JSON abandon behavior unchanged → existing tests pass without modification.
23. Non-JSON retry-node behavior unchanged → existing tests pass without modification.
24. `workflowRunCommand` (start) JSON tests unchanged → no regression from classifier changes.
25. `workflowGetCommand` (status) JSON tests unchanged → no regression.
26. `workflowApproveCommand`/`workflowRejectCommand` JSON tests unchanged → no regression.
27. Cancel JSON envelope contains no `abandon` substring anywhere.
28. `--node` flag with value starting with `--` → `MALFORMED_REQUEST` envelope.

### Policy Decisions Ratified Before Code Starts (Retro Gate Requirement)

1. **JSON resume does NOT execute workflow inline**: Established in the existing implementation (workflow.ts:2904-2908). This story preserves it. Rationale: execution streams output to stdout, corrupting the JSON envelope contract. Consumer drives execution separately.

2. **`workflow.cancel` is a NEW subcommand, not a retrofit of `abandon`**: Required by 3-3a story (line 57) and the epics Provider Command Syntax Baseline. `abandonWorkflow` is the shared operation layer; `cancel` is the provider-facing name.

3. **`workflow.retry` is a NEW subcommand, not a retrofit of `retry-node`**: Required by 3-3a story (line 58). `retry-node` streams and rejects `--json` by design; the new `retry` is a non-blocking ack.

4. **`workflow.retry --node` IS mutating (not a pure validation ack)**: `prepareWorkflowNodeRetry` creates a new run, performs CAS, resets git. This is required because the AC specifies "returns... identifying the requested node and workflow run" — the run reference is the new pre-created run. Without mutation, there is no new `runId` to report.

5. **`workflow.retry` whole-run (no `--node`) is NOT mutating**: It validates retryability only. No new run is created at the ack phase. Consumer drives actual execution via `workflow resume` or direct execution.

6. **`previousAttempt`/`currentAttempt` fixture fields omitted**: BMAD-specific execution-phase concepts. Archon's ack reports readiness/preparation state, not execution outcome.

7. **`resume-success.json` `state: 'running'` fixture mismatch accepted**: Archon resume ack reports current DB state (`failed`/`paused`) with `resumed: true`. The fixture's `state: 'running'` implies immediate execution which Archon's JSON path explicitly avoids.

8. **`printJsonWriteError` retained**: `workflowAbandonCommand` (legacy, untouched) still uses it.

9. **Post-cancel CAS-race detection**: If re-fetched run is NOT `cancelled` after `abandonWorkflow` returns, another operation won the race — emit `UNEXPECTED_STATE` instead of a misleading success envelope.

### Project Structure Notes

- All primary changes in `packages/cli/src/commands/workflow.ts` and `packages/cli/src/cli.ts` — same files modified by Stories 3-3b and 3-3c.
- No new source files expected (new functions added to existing `workflow.ts`).
- Test additions in existing `workflow.test.ts`, `workflow-command-contract.test.ts`, and `workflow-json.e2e.test.ts`.
- Import addition: `WorkflowRetryError` from `@archon/core/operations/workflow-retry` (or re-export through `@archon/core` index) for `instanceof` classification. Verify this import doesn't violate package boundaries — `@archon/cli` already depends on `@archon/core`.
- No `packages/core` business logic changes (operations layer untouched).
- No `migrations` changes.
- No `packages/server` route changes.
- No `packages/web` UI changes.
- No changes to `workflow-provider-command-envelope.ts` (shared builder from 3-3a).
- No edits to contract fixtures/schemas.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 3.3d: Provide Archon Recovery Command CLI JSON]
- [Source: _bmad-output/planning-artifacts/epics.md#Provider Command Syntax Baseline]
- [Source: _bmad-output/planning-artifacts/architecture.md#Provider Command Syntax Baseline]
- [Source: _bmad-output/planning-artifacts/prd.md#FR-8: Expose Provider Workflow Control Through CLI JSON]
- [Source: _bmad-output/planning-artifacts/prd.md#NFR-14]
- [Source: _bmad-output/planning-artifacts/contracts/workflow-commander/schemas/workflow-command-envelope.schema.json]
- [Source: _bmad-output/planning-artifacts/contracts/workflow-commander/examples/providers/archon/commands/resume-success.json]
- [Source: _bmad-output/planning-artifacts/contracts/workflow-commander/examples/providers/archon/commands/retry-success.json]
- [Source: _bmad-output/planning-artifacts/contracts/workflow-commander/examples/providers/archon/commands/cancel-success.json]
- [Source: _bmad-output/planning-artifacts/contracts/workflow-commander/examples/providers/archon/commands/error-unexpected-state.json]
- [Source: _bmad-output/planning-artifacts/contracts/workflow-commander/examples/providers/archon/commands/error-unexpected-exit.json]
- [Source: _bmad-output/implementation-artifacts/3-3a-define-shared-workflow-provider-command-envelope.md (lines 57-58, 163-167)]
- [Source: _bmad-output/implementation-artifacts/3-3b-provide-archon-start-and-status-cli-json.md]
- [Source: _bmad-output/implementation-artifacts/3-3c-provide-archon-provider-decision-command-cli-json.md]
- [Source: _bmad-output/implementation-artifacts/epic-3-partial-retro-2026-07-16.md]
- [Source: _bmad-output/implementation-artifacts/deferred-work.md]
- [Source: packages/cli/src/commands/workflow-provider-command-envelope.ts]
- [Source: packages/cli/src/commands/workflow.ts — workflowResumeCommand (line 2899)]
- [Source: packages/cli/src/commands/workflow.ts — workflowAbandonCommand (line 2981)]
- [Source: packages/cli/src/commands/workflow.ts — workflowRetryNodeCommand (line 2733)]
- [Source: packages/cli/src/commands/workflow.ts — printJsonWriteError (line 2580)]
- [Source: packages/cli/src/commands/workflow.ts — mapWorkflowRunToContractState (line 225)]
- [Source: packages/cli/src/commands/workflow.ts — classifyRunError (line 262)]
- [Source: packages/cli/src/commands/workflow.ts — buildWorkflowRunRef (line 330)]
- [Source: packages/cli/src/cli.ts — getWorkflowCommandEnvelopeCommand (line 121)]
- [Source: packages/cli/src/cli.ts — WorkflowCommandEnvelopeCommand type (line 116)]
- [Source: packages/cli/src/cli.ts — resume dispatch (line 881)]
- [Source: packages/cli/src/cli.ts — retry-node dispatch (line 891)]
- [Source: packages/cli/src/cli.ts — abandon dispatch (line 908)]
- [Source: packages/core/src/operations/workflow-operations.ts — resumeWorkflow (line 104)]
- [Source: packages/core/src/operations/workflow-operations.ts — abandonWorkflow (line 122)]
- [Source: packages/core/src/operations/workflow-retry.ts — prepareWorkflowNodeRetry (line 146)]
- [Source: packages/core/src/operations/workflow-retry.ts — WorkflowRetryError (line 67)]
- [Source: packages/core/src/operations/workflow-retry.ts — WorkflowRetryErrorCode (line 29)]
- [Source: packages/workflows/src/schemas/workflow-run.ts — RESUMABLE_WORKFLOW_STATUSES (line 29)]
- [Source: packages/workflows/src/schemas/workflow-run.ts — RETRYABLE_WORKFLOW_STATUSES (line 35)]
- [Source: packages/workflows/src/schemas/workflow-run.ts — TERMINAL_WORKFLOW_STATUSES (line 22)]
- [Source: packages/cli/package.json]

## Failure Analysis & Proof Readiness

### Failure Mode Risk Scan

- F1 Contract invariants not enforced: ADDRESSED — Acceptance criteria map 1:1 to unit tests asserting envelope `command`, `success`, `result.operation`, `error.code`/`category`/`retryable`, and `workflowRunRef` presence. Contract tests scan for forbidden keys and validate against the JSON schema. `cancel` envelopes additionally scanned for `abandon` substring.
- F2 Split source of truth: N/A — The shared envelope builder (`workflow-provider-command-envelope.ts`) is the single source for envelope construction. This story calls it, does not duplicate it. `WorkflowRetryError.code` is the typed source for retry classification — `classifyRunError` dispatches via instanceof, not substring.
- F3 Fail-open ingress validation: ADDRESSED — Every JSON-mode error path is wrapped in a fail-closed try/catch that emits an error envelope. Pre-handler failures (parseArgs, missing run-id, blank correlation-id, invalid JSON flag, cwd/git validation, `--node` with flag-like value) are caught by the expanded `getWorkflowCommandEnvelopeCommand` → `emitWorkflowCommandMalformedEnvelope` pipeline.
- F4 Incomplete drift/coverage gates: ADDRESSED — `bun run validate` must pass before moving to review; includes type-check, lint, tests, bundled checks.
- F5 Mandated commands not running real gates: ADDRESSED — Proof commands run `bun test` against real test files and `python3 validate_contracts.py` against the contract schema.
- F6 Bypassable dependency-direction checks: ADDRESSED — Import of `WorkflowRetryError` from `@archon/core` is verified to be within the existing `@archon/cli` → `@archon/core` dependency direction. No new package dependencies.
- F7 Cleanup without preserved-behavior regression tests: ADDRESSED — Non-JSON resume/abandon/retry-node paths are preserved untouched. Existing tests for all four previously-converted commands (start/status/approve/reject) must keep passing. Dedicated regression items in Required Negative Tests (items 21-26).
- F8 Review findings recorded without ownership triage: N/A — No prior review findings for this story. Previous stories' findings (RF-01 through RF-18 from 3-3c) are incorporated as established patterns in this story's design.

### AC Proof Matrix

| Acceptance Criterion | Proof Command/Test | Failing-Path Evidence | Ownership Boundary | Deferral Decision |
| --- | --- | --- | --- | --- |
| AC #1 — Resume success (failed + paused) | `bun test workflow.test.ts` — resume success tests | N/A (positive) | `workflowResumeCommand` JSON branch | N/A |
| AC #1 — Resume error (not resumable) | `bun test workflow.test.ts` — resume error tests | Each test asserts UNEXPECTED_STATE/WORKFLOW_RUN_NOT_FOUND/INTERNAL_ERROR/COMMAND_TIMEOUT, no raw error text | `workflowResumeCommand` fail-closed catch + `classifyRunError` | N/A |
| AC #2 — Retry success (whole-run) | `bun test workflow.test.ts` — retry whole-run success | N/A (positive) | `workflowRetryCommand` validation path | N/A |
| AC #2 — Retry error (not retryable) | `bun test workflow.test.ts` — retry whole-run error | UNEXPECTED_STATE assertion | `workflowRetryCommand` status check | N/A |
| AC #3 — Retry success (node) | `bun test workflow.test.ts` — retry node success | N/A (positive) | `workflowRetryCommand` + `prepareWorkflowNodeRetry` | N/A |
| AC #3 — Retry error (node not found/not retryable) | `bun test workflow.test.ts` — retry node errors | NODE_NOT_FOUND/NODE_NOT_RETRYABLE/CAS_MISS/etc assertions per WorkflowRetryError code | `classifyRunError` instanceof path | N/A |
| AC #4 — Cancel success | `bun test workflow.test.ts` — cancel success (running/paused/failed) | N/A (positive) | `workflowCancelCommand` JSON branch | N/A |
| AC #4 — Cancel error (already terminal) | `bun test workflow.test.ts` — cancel error | UNEXPECTED_STATE assertion; no `abandon` in envelope | `workflowCancelCommand` + `classifyRunError` | N/A |
| AC #4 — No legacy `abandon` serialization | `workflow-command-contract.test.ts` — `abandon` substring scan | Envelope JSON does not contain `abandon` | Contract test | N/A |
| AC #5 — Pre-handler failures emit envelopes | `workflow-json.e2e.test.ts` — missing run-id, blank correlation-id, invalid JSON flag, cwd errors | MALFORMED_REQUEST envelope, no plain-text, correct exitCode | cli.ts pre-dispatch guards + `getWorkflowCommandEnvelopeCommand` expansion | N/A |
| AC #5 — Consumers can fail closed | `workflow-command-contract.test.ts` — no forbidden keys, schema validation | Contract test structure + schema compliance | Shared contract test infrastructure | Fixture deltas for `previousAttempt`/`currentAttempt`/`state:'running'` documented |
| Regression — Non-JSON unchanged | Existing resume/abandon/retry-node non-JSON tests pass | Tests passing proves no regression | This story does not modify non-JSON paths | N/A |
| Regression — Start/status/approve/reject JSON unchanged | Existing 3-3b/3-3c tests pass | Tests passing proves classifier changes don't break prior commands | `classifyRunError` instanceof path is strictly additive; substring changes are in existing UNEXPECTED_STATE block | N/A |

## Dev Agent Record

### Agent Model Used

{{agent_model_name_version}}

### Debug Log References

### Completion Notes List

### File List
