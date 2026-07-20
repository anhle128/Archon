# Story 3.3d: Provide Archon Recovery Command CLI JSON

Status: done

<!-- A story may become ready-for-dev only after solution-readiness and proof-readiness validation pass. -->

## Story

As a workflow operator,
I want provider `archon` to expose resume, retry, and cancel through parseable CLI JSON,
so that external controllers can route recovery actions consistently without relying on human-readable output.

## Acceptance Criteria

1. **Resume validates resumability**: `archon workflow resume <run-id> --json` returns the shared success envelope confirming `resumable: true`, reports the unchanged current state, records `executed: false`, and does not dispatch execution or mutate run state, timestamps, retry state, or workflow events. A non-resumable state returns an `UNEXPECTED_STATE` failure envelope without mutation.

2. **Whole-run retry dispatches detached worker**: `archon workflow retry <run-id> --json` returns the shared success envelope immediately after creating a detached exact-run worker process. The result contains `operation: retry`, `scope: run`, `dispatched: true`, `detached: true` without running state, resumed state, or attempt fields. The worker later owns claim and execution.

3. **Targeted retry dispatches detached worker**: `archon workflow retry <run-id> --node <node-id> --json` returns the shared success envelope immediately after creating a detached exact-run and exact-node worker process. The result contains `operation: retry`, `scope: node`, the requested `nodeId`, `dispatched: true`, `detached: true`. The worker later owns node validation, claim, checkpoint, reset, invalidation, and execution.

4. **Cancel acknowledges durable transition**: `archon workflow cancel <run-id> --json` returns the shared success envelope immediately after the durable CAS transition succeeds. The result contains only `operation: cancel`, `state: cancelled`, `terminal: true` without a pre-transition state. Process quiescence and cleanup are not prerequisites. A lost CAS race or ineligible state returns `UNEXPECTED_STATE`.

5. **Caught failures use shared failure envelope**: Malformed input, database failure, invalid state, process-spawn failure, or internal timeout return the shared failure envelope with code, category, retryability, and structured details. No unsupported state transition is applied.

6. **Consumer-classified failures are not Archon's responsibility**: Empty, malformed, or schema-invalid output, consumer-enforced timeout, or unexpected exit are classified by the subprocess consumer (Hermes Story 3.4c), not by Archon. Archon adds no supervisor.

## Tasks / Subtasks

- [x] Slice 1: Wire recovery commands into envelope dispatcher (AC: #1, #2, #3, #4, #5)
  - [x] Extend `WorkflowCommandEnvelopeCommand` type union in `cli.ts:116-119` to include `'workflow.resume' | 'workflow.retry' | 'workflow.cancel'`.
  - [x] Add three cases to `getWorkflowCommandEnvelopeCommand()` in `cli.ts:121-131`: `resume` → `workflow.resume`, `retry` → `workflow.retry`, `cancel` → `workflow.cancel`.
  - [x] Wire `--json` pre-handler envelope paths (log silencing, blank correlation-id, invalid JSON flag, directory/git validation) for resume, retry, and cancel subcommands.
  - [x] Add `workflow retry` and `workflow cancel` subcommand dispatch cases in the CLI `switch` (currently only `retry-node` and `abandon` exist).
  - [x] Non-JSON `workflow retry` and `workflow cancel` emit clear usage guidance pointing to `retry-node` and `abandon` (TD-009: JSON-only scope).
  - [x] Add positive and failing-path proof: pre-handler envelope for missing args, blank correlation-id, `--json=value` rejection.

- [x] Slice 2: Convert `workflowResumeCommand` JSON branch to shared envelope (AC: #1, #5)
  - [x] Replace the legacy `{ ok, runId, action, executed, status }` JSON output with `buildSuccessEnvelope()` using `command: 'workflow.resume'`, `workflowRunRef`, and `result: { operation: 'resume', state: <contract-state>, validated: true, resumable: true, executed: false }`.
  - [x] Replace `printJsonWriteError()` with `classifyRunError()` → `buildErrorEnvelope()` for caught failures.
  - [x] Add recovery-specific classifier patterns: `Cannot resume run with status` → `UNEXPECTED_STATE`, exit 78.
  - [x] Preserve existing non-JSON resume behavior unchanged.
  - [x] Add `--correlation-id` support to resume dispatch.
  - [x] Add positive proof: paused run → validate-only success with `executed: false`; failed run → validate-only success.
  - [x] Add failing-path proof: completed run → `UNEXPECTED_STATE`; cancelled run → `UNEXPECTED_STATE`; running run → `UNEXPECTED_STATE`; missing run → `UNEXPECTED_STATE` (TD-007 recovery-command mapping).
  - [x] Assert no side effects: status, timestamps, events, retry epoch, checkout, executor calls remain unchanged after resume JSON.

- [x] Slice 3: Implement `workflow retry <run-id> --json` whole-run dispatch (AC: #2, #5)
  - [x] Add `workflowRetryCommand` handler (or extend existing function with a provider-command path) that: resolves run by ID/prefix, validates retryability, creates a detached worker process, returns immediately with the dispatch-only envelope.
  - [x] The detached worker re-invokes `archon workflow resume <run-id>` (the existing inline resume path) in a child process, NOT `retry-node`. It reuses the persisted run codebase and working path (TD-N06: no caller-cwd matching).
  - [x] Build the detached spawn using the existing detached-process pattern: `spawn()` with `detached: true`, log to `~/.archon/logs/`, `child.unref()`, check `child.pid !== undefined` for spawn success.
  - [x] Do not call `spawnDetachedWorkflowRun()` unchanged if it preserves the parent `workflow retry` argv; the worker argv must be explicit `archon workflow resume <run-id>` to avoid recursive retry dispatch.
  - [x] Return `buildSuccessEnvelope()` with `command: 'workflow.retry'`, `workflowRunRef`, `result: { operation: 'retry', scope: 'run', dispatched: true, detached: true }`.
  - [x] On spawn failure: return `INTERNAL_ERROR` envelope, exit 70.
  - [x] On run-not-found or non-retryable status: return `UNEXPECTED_STATE` envelope, exit 78.
  - [x] On malformed args: return `MALFORMED_REQUEST` envelope, exit 64.
  - [x] Add positive proof: failed run → dispatch success, then poll status for worker claim.
  - [x] Add failing-path proof: completed run → `UNEXPECTED_STATE`; running run → `UNEXPECTED_STATE`.

- [x] Slice 4: Implement `workflow retry <run-id> --node <node-id> --json` targeted dispatch (AC: #3, #5)
  - [x] Targeted retry dispatches a detached worker that runs `archon workflow retry-node <run-id> <node-id>` (the existing inline retry-node path).
  - [x] Do not call `spawnDetachedWorkflowRun()` unchanged if it preserves the parent `workflow retry --node` argv; the worker argv must be explicit `archon workflow retry-node <run-id> <node-id>` to avoid recursive retry dispatch.
  - [x] The parent does NOT validate the node or perform preparation — those are worker responsibilities (TD-003).
  - [x] Return `buildSuccessEnvelope()` with `command: 'workflow.retry'`, `workflowRunRef`, `result: { operation: 'retry', scope: 'node', nodeId: <requested-node-id>, dispatched: true, detached: true }`.
  - [x] On spawn failure: `INTERNAL_ERROR`, exit 70.
  - [x] On run-not-found: `UNEXPECTED_STATE`, exit 78 (parent validates run exists but not node).
  - [x] Worker failures (node validation, claim, checkpoint, reset, execution) are later outcomes, NOT retroactive command failures.
  - [x] Add positive proof: seed failed DAG with completed upstream + failed target, dispatch, assert targeted payload, poll for worker outcome.
  - [x] Add failing-path proof: unknown run → `UNEXPECTED_STATE`; spawn failure → `INTERNAL_ERROR`.

- [x] Slice 5: Implement `workflow cancel <run-id> --json` durable transition (AC: #4, #5)
  - [x] Add `workflowCancelCommand` handler that: resolves run by ID/prefix, calls `cancelWorkflowRun()` directly (NOT `abandonWorkflow()` — TD-004 rejects the high-level wrapper's response shape), and reports based on the CAS `cancelled` boolean.
  - [x] If `cancelled === true`: return `buildSuccessEnvelope()` with `command: 'workflow.cancel'`, `workflowRunRef`, `result: { operation: 'cancel', state: 'cancelled', terminal: true }`.
  - [x] If `cancelled === false` (CAS lost): return `UNEXPECTED_STATE` envelope — another transition already took the run terminal.
  - [x] Pre-check: run-not-found → `UNEXPECTED_STATE`; already `completed` or `cancelled` → `UNEXPECTED_STATE` (same pre-check as `abandonWorkflow`).
  - [x] Do NOT wait for worker quiescence, container cleanup, or cooperative cancellation.
  - [x] Do NOT report or serialize the operation as legacy `abandon`.
  - [x] Container reclaim is not part of the provider cancel command; after the CAS result is reported, worker quiescence and container cleanup remain asynchronous and are owned by cooperative executor checks plus the existing cleanup reaper.
  - [x] Add positive proof: paused run → cancel success with `terminal: true`; running run → cancel success; failed run → cancel success.
  - [x] Add failing-path proof: completed run → `UNEXPECTED_STATE`; cancelled run → `UNEXPECTED_STATE`; CAS race loser → `UNEXPECTED_STATE`.

- [x] Slice 6: Clean up legacy JSON helpers and add cross-command tests (AC: #1-#6)
  - [x] Delete `printJsonWriteError()` from `workflow.ts` after all callers (resume, abandon) are converted. If `abandon` still uses it for non-envelope legacy JSON, leave it and document.
  - [x] Run the canonical contract validator: `python3 _bmad-output/planning-artifacts/contracts/workflow-commander/validate_contracts.py`.
  - [x] Add contract conformance tests: parse runtime envelope output against the 4 canonical recovery fixtures (`resume-success.json`, `retry-success.json`, `retry-node-success.json`, `cancel-success.json`).
  - [x] Add E2E subprocess tests using real CLI subprocess boundary with isolated `ARCHON_HOME`, SQLite, temp git repo, no network.
  - [x] Run `bun run validate` — all eight gates must pass.

### Review Findings

- [x] [Review][Patch] R1-F1: Recovery commands return `WORKFLOW_RUN_NOT_FOUND` for missing runs instead of the required `UNEXPECTED_STATE`. [packages/cli/src/commands/workflow.ts:274]
- [x] [Review][Patch] R1-F2: `workflow cancel --json` can cancel `pending` runs even though only `running`, `paused`, and `failed` are eligible. [packages/cli/src/commands/workflow.ts:3225]
- [x] [Review][Patch] R1-F3: Blank targeted retry node IDs fall through to whole-run retry instead of returning `MALFORMED_REQUEST`. [packages/cli/src/commands/workflow.ts:3113]
- [x] [Review][Patch] R1-F4: Retry dispatch uses `Bun.spawn` instead of the existing detached `node:child_process.spawn` pattern required by the story. [packages/cli/src/commands/workflow.ts:3135]
- [x] [Review][Patch] R1-F5: Retry dispatch falls back to caller `cwd` or `process.cwd()` when the run has no persisted `working_path`. [packages/cli/src/commands/workflow.ts:3111]
- [x] [Review][Patch] R1-F6: Whole-run retry does not preserve exact run identity after spawning its worker. [packages/cli/src/commands/workflow.ts:3113]
- [x] [Review][Patch] R1-F7: Whole-run retry accepts cancelled runs even though the spawned worker uses the resume path, which cannot resume cancelled runs. [packages/cli/src/commands/workflow.ts:3105]
- [x] [Review][Patch] R1-F8: The required cancel CAS-race proof is skipped while the story marks that proof complete. [packages/cli/src/commands/workflow.test.ts:7719]
- [x] [Review][Patch] R1-F9: The runtime retry "success" contract test can pass on an error envelope and can start a real detached worker. [packages/cli/src/commands/workflow-command-contract.test.ts:1016]
- [x] [Review][Patch] R1-F10: Malformed targeted retry `--node` inputs can bypass the JSON envelope or return the wrong error category. [packages/cli/src/cli.ts:935]
- [x] [Review][Patch] R1-F11: Whole-run retry still does not guarantee that the detached worker resumes the exact requested run. [packages/cli/src/commands/workflow.ts:3137]
- [x] [Review][Patch] R1-F12: Detached retry attaches the spawn `error` listener after the pid failure check. [packages/cli/src/commands/workflow.ts:3159]
- [x] [Review][Patch] R1-F13: Retry tests mock `Bun.spawn` while the implementation uses `node:child_process.spawn`. [packages/cli/src/commands/workflow.test.ts:7816]
- [x] [Review][Patch] R1-F14: Required real-subprocess success and worker-boundary proofs are still missing. [packages/cli/src/commands/workflow-json.e2e.test.ts:712]
- [x] [Review][Patch] R1-F15: Provider JSON recovery commands can still emit update-notice text on stderr in bundled binaries. [packages/cli/src/cli.ts:1450]
- [x] [Review][Patch] R1-F16: Extra positional arguments after recovery run IDs are ignored instead of rejected as malformed input. [packages/cli/src/cli.ts:941]
- [x] [Review][Patch] R1-F17: The TEA test design still expects whole-run retry of cancelled runs even though that behavior was rejected. [_bmad-output/test-artifacts/test-design/test-design-3-3d-provide-archon-recovery-command-cli-json.md:182]

## Dev Notes

### Feature and System Context

- **Outcome**: Three recovery commands (`resume`, `retry`, `cancel`) emit machine-readable shared envelopes on `--json`, completing the Workflow Commander CLI JSON surface for Epic 3.
- **Architectural role**: Archon CLI producer — exposes existing recovery operations through the validated contract envelope so external controllers (Hermes, other integrators) can invoke and parse them without human-readable text.
- **Upstream authorities**: Technical decisions document (`_bmad-output/planning-artifacts/story-decisions/3-3d-provide-archon-recovery-command-cli-json/technical-decisions.md`) — all 13 decisions approved, gate PASS.
  Contract package (`_bmad-output/planning-artifacts/contracts/workflow-commander/`) — 18 command examples validated.
  Architecture command baseline table.
  PRD FR-8.
  Epic 3.3d acceptance criteria.
- **Downstream consumers**: Hermes Story 3.4c (consumer compatibility proof — downstream, not blocking).
- **User-visible or system-visible behavior**: `archon workflow resume/retry/cancel <run-id> --json` emit exactly one JSON line on stdout and a numeric exit code. No new HTTP routes, Web UI, or database migrations.

### Canonical Artifact Reconciliation

| Source                | Relevant claim                                                                                        | Current code or prior-story decision                                    | Resolution                                                   |
| --------------------- | ----------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- | ------------------------------------------------------------ |
| Architecture baseline | `workflow.resume` → `archon workflow resume <run-id> --json`                                          | Resume JSON exists but emits legacy `{ ok }` shape, not shared envelope | Convert to shared envelope (this story)                      |
| Architecture baseline | `workflow.retry` → `archon workflow retry <run-id> [--node <node-id>] --json`                         | No `workflow retry` subcommand exists; `retry-node` rejects `--json`    | Add new `retry` subcommand with JSON-only scope (TD-009)     |
| Architecture baseline | `workflow.cancel` → `archon workflow cancel <run-id> --json`                                          | No `workflow cancel` subcommand exists; `abandon` uses legacy `{ ok }`  | Add new `cancel` subcommand with JSON-only scope (TD-009)    |
| TD-N02                | Every JSON-mode success/failure emits exactly one shared envelope on stdout                           | Resume and abandon use `printJsonWriteError` for errors                 | Replace with `buildErrorEnvelope`                            |
| TD-002                | Whole-run retry returns dispatch-only result                                                          | No whole-run retry exists                                               | Implement as detached process spawn                          |
| TD-003                | Targeted retry returns dispatch-only result                                                           | `retry-node` executes inline and rejects `--json`                       | Implement as detached process spawn under new `retry --node` |
| TD-004                | Cancel uses direct CAS, omits `previousState`                                                         | `abandon` uses `abandonWorkflow()` which returns pre-cancel run         | Use `cancelWorkflowRun()` directly for CAS winner/loser      |
| TD-N05                | Legacy human commands remain unchanged                                                                | `retry-node` and `abandon` exist with current behavior                  | Preserved; new `retry`/`cancel` spellings are JSON-only      |
| TD-N06                | CLI retry reuses run-owned UI/core operation context                                                  | Web UI retry sends only runId+nodeId, no caller cwd                     | Worker derives paths from persisted run                      |
| TD-007                | Four error mappings: MALFORMED_REQUEST/64, UNEXPECTED_STATE/78, COMMAND_TIMEOUT/69, INTERNAL_ERROR/70 | `classifyRunError` exists with these codes                              | Extend with recovery-specific classifier patterns            |
| Epic 3 retro          | Story must specify pre-handler boundaries, stdout rules, classifier cases, negative tests             | Retro action item requires depth                                        | This story includes all required depth                       |

### Solution Surface Map

| Surface                                            | Owner or authority                                 | Current state                                                                                           | Required change                                                                                                            | Consumers                             | Proof                                                                  |
| -------------------------------------------------- | -------------------------------------------------- | ------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- | ------------------------------------- | ---------------------------------------------------------------------- |
| `cli.ts` dispatcher (type union + command map)     | Story 3.3a established, stories 3.3b/3.3c extended | `WorkflowCommandEnvelopeCommand` has 4 commands; `getWorkflowCommandEnvelopeCommand` maps 4 subcommands | Add `workflow.resume`, `workflow.retry`, `workflow.cancel` to type and map; add `retry`/`cancel` subcommand dispatch cases | All pre-handler envelope paths        | Unit: type exhaustiveness; E2E: pre-handler envelope for each command  |
| `workflow.ts` resume handler                       | Story 3.3b JSON pattern                            | Legacy `{ ok }` JSON, `printJsonWriteError` for errors                                                  | Replace with `buildSuccessEnvelope`/`buildErrorEnvelope`                                                                   | External controllers                  | Unit: envelope shape; E2E: subprocess stdout parse                     |
| `workflow.ts` retry handler (new)                  | This story                                         | Does not exist                                                                                          | New handler: resolve run, spawn detached worker, return dispatch envelope                                                  | External controllers, detached worker | Unit: envelope shape, spawn mock; E2E: subprocess stdout + poll status |
| `workflow.ts` cancel handler (new)                 | This story                                         | Does not exist                                                                                          | New handler: resolve run, CAS via `cancelWorkflowRun`, return result envelope                                              | External controllers                  | Unit: envelope shape, CAS mock; E2E: subprocess cancel + verify state  |
| `workflow.ts` error classifier                     | Stories 3.3b/3.3c                                  | 12+ patterns for start/status/approve/reject                                                            | Add recovery-specific: resume status check, cancel CAS loss                                                                | Recovery handlers                     | Unit: classifier positive/negative tests                               |
| `spawnDetachedWorkflowRun` / `buildDetachedRunCmd` | Existing `workflow run --detach`                   | Spawn detached `workflow run` child                                                                     | Reuse pattern for retry workers (whole-run + targeted)                                                                     | Retry dispatch                        | Unit: cmd builder; E2E: spawn + worker outcome poll                    |
| Non-JSON `retry`/`cancel` dispatch                 | This story                                         | Does not exist                                                                                          | Emit usage guidance pointing to `retry-node`/`abandon`                                                                     | Human operators                       | E2E: non-JSON invocation returns usage text                            |

### Invariant and Ownership Map

| Invariant                                            | Source of truth    | Enforcement owner        | Created or transformed at                                 | Persisted or transmitted at          | Consumed by                 | Proof                                                          |
| ---------------------------------------------------- | ------------------ | ------------------------ | --------------------------------------------------------- | ------------------------------------ | --------------------------- | -------------------------------------------------------------- |
| Exactly one JSON line on stdout per `--json` call    | TD-N02, Story 3.3a | CLI dispatcher + handler | Handler return                                            | stdout                               | External controllers        | E2E: parse stdout as single JSON line                          |
| Resume does not dispatch execution or mutate state   | TD-N01, AC #1      | Resume handler           | `resumeWorkflowOp()` validates only                       | N/A (no mutation)                    | Controllers, status queries | Unit: no side-effect calls; E2E: status unchanged after resume |
| Retry parent returns dispatch-only result            | TD-002/003         | Retry handler            | After `spawn()` succeeds                                  | stdout envelope                      | Controllers                 | Unit: result shape assertion; E2E: no worker fields in parent  |
| Cancel requires CAS winner                           | TD-004             | Cancel handler           | After `cancelWorkflowRun()` returns `{ cancelled: true }` | stdout envelope, DB row              | Controllers, status queries | Unit: CAS true → success, CAS false → UNEXPECTED_STATE         |
| Run identity preserved across recovery               | project-context.md | All handlers             | `buildWorkflowRunRef(run)`                                | `workflowRunRef` in envelope         | Hermes correlation          | Unit: runRef matches input run                                 |
| Worker-derived failures are not parent failures      | TD-005             | Process boundary         | After detached spawn completes                            | Worker logs, status, events          | Controllers poll status     | E2E: inject worker failure, assert parent success              |
| No caller-cwd matching for retry                     | TD-N06             | Retry worker             | Worker derives paths from persisted run                   | Worker process env                   | Core retry operation        | E2E: invoke retry from different cwd, assert success           |
| Error exit codes match envelope `execution.exitCode` | TD-007             | Error envelope builder   | `buildErrorEnvelope()`                                    | stdout envelope + `process.exitCode` | Controllers                 | E2E: process exit code matches envelope exitCode               |

### Lifecycle and State Analysis

| State or phase                    | Entry condition                                 | Valid transition                            | Exit condition                           | Failure or interruption behavior                                     | Recovery or cleanup behavior                                   |
| --------------------------------- | ----------------------------------------------- | ------------------------------------------- | ---------------------------------------- | -------------------------------------------------------------------- | -------------------------------------------------------------- |
| Resume JSON call                  | `--json` flag + `resume` subcommand             | Validate run → emit envelope                | Envelope on stdout, exit 0 or error exit | `classifyRunError` → error envelope                                  | N/A — stateless                                                |
| Retry JSON call (whole-run)       | `--json` flag + `retry` subcommand, no `--node` | Validate run → spawn worker → emit envelope | Dispatch envelope on stdout, exit 0      | Spawn failure → `INTERNAL_ERROR`; run-not-found → `UNEXPECTED_STATE` | Worker handles its own lifecycle                               |
| Retry JSON call (targeted)        | `--json` flag + `retry` subcommand + `--node`   | Validate run → spawn worker → emit envelope | Dispatch envelope on stdout, exit 0      | Spawn failure → `INTERNAL_ERROR`; run-not-found → `UNEXPECTED_STATE` | Worker handles its own lifecycle                               |
| Cancel JSON call                  | `--json` flag + `cancel` subcommand             | Look up run → CAS cancel → emit envelope    | Cancel envelope on stdout, exit 0        | CAS loss → `UNEXPECTED_STATE`; run-not-found → `UNEXPECTED_STATE`    | Cleanup remains asynchronous; reaper handles container reclaim |
| Detached retry worker (whole-run) | Spawned by parent after dispatch ack            | Claim run → resume → execute                | Terminal run status                      | Claim loss (another worker won) → fail gracefully, log               | Status/events expose outcome                                   |
| Detached retry worker (targeted)  | Spawned by parent after dispatch ack            | Claim run → prepare retry → execute         | Terminal run status or pause             | Node validation fail, claim loss → fail gracefully, log              | Status/events expose outcome                                   |

### Failure, Concurrency, Security, and Compatibility Analysis

- **Typed failures (TD-007 error mapping)**:
  - `MALFORMED_REQUEST` / `provider_contract` / non-retryable / exit 64: missing run-id, blank `--correlation-id`, `--json=value`, invalid flags.
  - `UNEXPECTED_STATE` / `unexpected_state` / non-retryable / exit 78: run not found, non-resumable status for resume, non-retryable status for retry, non-cancellable status for cancel, CAS race loser for cancel.
  - `COMMAND_TIMEOUT` / `timeout` / retryable / exit 69: internally caught database or operation timeout.
  - `INTERNAL_ERROR` / `implementation_defect` / non-retryable / exit 70: spawn failure, database failure, other unexpected errors.
- **Concurrency and race conditions**:
  - Two concurrent whole-run retry dispatches: both parents may succeed (dispatch ack), but only one worker wins the CAS claim. The other worker detects claim loss and exits gracefully. Parent responses are not retroactively changed.
  - Two concurrent cancel commands: only one CAS winner; loser gets `UNEXPECTED_STATE`. No duplicate transition.
  - Cancel during active execution: CAS wins immediately, worker detects cancellation cooperatively later.
- **Transaction, atomicity, and partial-write boundaries**:
  - Cancel CAS is atomic: `UPDATE ... WHERE status NOT IN ('completed', 'cancelled')` with `cancelled` boolean result.
  - Resume is read-only: no write transaction.
  - Retry dispatch creates a process; if spawn succeeds but worker later fails, the run remains in its current state until status query reveals the outcome.
- **Security and trust boundaries**:
  - No secrets in envelope details — redact error messages, paths, and internal state.
  - `stdoutRedacted: true`, `stderrRedacted: true` in all error execution blocks.
  - Worker inherits `process.env` — same trust as interactive CLI.
  - No new HTTP routes or network exposure.
- **Compatibility and migration boundaries**:
  - Legacy `workflow resume` (non-JSON) behavior unchanged.
  - Legacy `workflow retry-node` (streaming, non-JSON) behavior unchanged.
  - Legacy `workflow abandon` (human + simple JSON) behavior unchanged.
  - New `workflow retry` and `workflow cancel` spellings are JSON-only (TD-009); non-JSON invocation returns usage guidance.
  - `printJsonWriteError` can be deleted after resume is converted, unless `abandon` still uses it.
- **Diagnostics and evidence preservation**:
  - Worker stdout/stderr logged to `~/.archon/logs/detached-run-*.log`.
  - All errors logged via structured Pino events before envelope emission.
  - Envelope `correlationId` enables cross-system tracing.

### Solution Design and Decision Record

- **Selected approach**: Thin CLI adapter layer that (a) wires three subcommands into the existing envelope dispatcher, (b) converts resume JSON to shared envelope (validate-only, no execution), (c) adds retry as detached-process dispatch (both whole-run and targeted), (d) adds cancel as direct CAS with minimal result. No new HTTP routes, no new database tables, no new operations module functions.
- **Why this approach preserves simplicity, robustness, scalability, and long-term maintainability**: Reuses the established envelope infrastructure from 3.3a/3.3b/3.3c, the existing `spawnDetachedWorkflowRun` pattern, the existing `cancelWorkflowRun` CAS, and the existing retry operations. No new abstractions. The process boundary cleanly separates parent command (synchronous, one-line JSON) from worker execution (async, logged).
- **Rejected alternative**: Inline execution for retry JSON (as `retry-node` does for human mode) — rejected because streaming output corrupts the JSON contract.
- **Rejected alternative**: Reusing `abandonWorkflow()` for cancel — rejected because it returns the pre-cancel run (stale state risk) and its container reclaim is coupled to the high-level wrapper's response shape.
- **Rejected alternative**: Adding an Archon supervisor for uncatchable process exit — rejected because the consumer is responsible for classifying subprocess boundary failures.

### Implementation Slices

| Slice                   | Owned behavior or invariant                                                                            | Files or modules                        | Positive proof                                               | Failing-path proof                                                  | Integration impact                |
| ----------------------- | ------------------------------------------------------------------------------------------------------ | --------------------------------------- | ------------------------------------------------------------ | ------------------------------------------------------------------- | --------------------------------- |
| 1. Wire dispatcher      | Pre-handler envelope for resume/retry/cancel; new subcommand dispatch; JSON-only gate for retry/cancel | `cli.ts`                                | Pre-handler envelope for missing args, blank correlation-id  | Non-JSON `retry`/`cancel` → usage text                              | Enables Slices 2-5                |
| 2. Resume envelope      | Validate-only resume → shared envelope; no execution or mutation                                       | `workflow.ts` (resume handler)          | Paused run → success envelope; failed run → success envelope | Completed/cancelled/running → UNEXPECTED_STATE                      | Replaces legacy `{ ok }`          |
| 3. Whole-run retry      | Detached worker dispatch → dispatch-only envelope                                                      | `workflow.ts` (new retry handler)       | Failed run → dispatch success, poll for worker claim         | Completed run → UNEXPECTED_STATE; spawn fail → INTERNAL_ERROR       | New detached worker               |
| 4. Targeted retry       | Detached worker dispatch with `--node` → dispatch-only envelope                                        | `workflow.ts` (retry handler extension) | Failed DAG with failed target → dispatch success             | Unknown run → UNEXPECTED_STATE; spawn fail → INTERNAL_ERROR         | New detached worker               |
| 5. Cancel               | Direct CAS → minimal cancel envelope                                                                   | `workflow.ts` (new cancel handler)      | Paused/running/failed run → cancel success                   | Completed/cancelled → UNEXPECTED_STATE; CAS loss → UNEXPECTED_STATE | Replaces need for abandon in JSON |
| 6. Cleanup + validation | Delete `printJsonWriteError` if unused; contract + E2E tests; `bun run validate`                       | `workflow.ts`, test files               | All 4 recovery fixtures pass contract conformance            | Full `bun run validate` passes                                      | Final gate                        |

### Executable Proof Design

| Acceptance Criterion         | Proof command or test                                                                                       | Positive assertion                                                                                                     | Failing-path assertion                                                                  | Required state or side effect                            | Prohibited side effect                                                   | Evidence                                                                          |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- | -------------------------------------------------------- | ------------------------------------------------------------------------ | --------------------------------------------------------------------------------- |
| AC #1 (resume validate-only) | Unit: mock `resumeWorkflowOp`, assert envelope shape. E2E: `archon workflow resume <id> --json` subprocess  | `result.operation === 'resume'`, `result.executed === false`, `result.resumable === true`, `result.state === 'paused'` | Completed run → `error.code === 'UNEXPECTED_STATE'`, exit 78                            | Run remains in original state after call                 | No execution dispatch, no state mutation, no event creation              | Subprocess stdout parsed as single JSON line matching `resume-success.json` shape |
| AC #2 (whole-run retry)      | Unit: mock spawn, assert envelope. E2E: seed failed run, `archon workflow retry <id> --json`, poll status   | `result.operation === 'retry'`, `result.scope === 'run'`, `result.dispatched === true`, `result.detached === true`     | Completed run → UNEXPECTED_STATE; spawn fail → INTERNAL_ERROR                           | Detached worker process created; worker later claims run | No `state`, `resumed`, or `attempt` fields in parent result              | Subprocess stdout matches `retry-success.json`; status poll shows worker claim    |
| AC #3 (targeted retry)       | Unit: mock spawn, assert envelope. E2E: seed failed DAG, `archon workflow retry <id> --node <node> --json`  | `result.operation === 'retry'`, `result.scope === 'node'`, `result.nodeId === <node>`, `result.dispatched === true`    | Unknown run → UNEXPECTED_STATE; spawn fail → INTERNAL_ERROR                             | Detached worker process created                          | No worker-derived state, retry epoch, or safety refs in parent result    | Subprocess stdout matches `retry-node-success.json`                               |
| AC #4 (cancel durable)       | Unit: mock `cancelWorkflowRun`, assert envelope. E2E: seed paused run, `archon workflow cancel <id> --json` | `result.operation === 'cancel'`, `result.state === 'cancelled'`, `result.terminal === true`                            | Completed → UNEXPECTED_STATE; cancelled → UNEXPECTED_STATE; CAS loss → UNEXPECTED_STATE | DB row status changed to `cancelled`                     | No `previousState`, no worker wait, no cleanup prerequisite              | Subprocess stdout matches `cancel-success.json`; DB query confirms status         |
| AC #5 (error envelopes)      | Unit: classifier tests. E2E: subprocess with bad args                                                       | Malformed → exit 64; unexpected state → exit 78; timeout → exit 69; internal → exit 70                                 | Exit code matches `execution.exitCode` in envelope                                      | Error envelope on stdout                                 | No state mutation on error                                               | 4 error mapping paths tested per TD-007                                           |
| AC #6 (consumer boundary)    | Documentation + excluded from implementation                                                                | Archon emits no supervisor                                                                                             | No consumer classification code in Archon                                               | N/A                                                      | No UNEXPECTED_EXIT, SCHEMA_MISMATCH, or TIMEOUT classification in Archon | Grep confirms absence                                                             |

### Explicit Boundary and Deferral Record

| Excluded behavior or deferred concern                                                           | Owner or future story                       | Reason                                             | Current invariant remains complete because                          |
| ----------------------------------------------------------------------------------------------- | ------------------------------------------- | -------------------------------------------------- | ------------------------------------------------------------------- |
| Hermes consumer compatibility proof (UNEXPECTED_EXIT, SCHEMA_MISMATCH, TIMEOUT classifications) | Hermes Story 3.4c                           | Producer-first sequencing (TD-N07)                 | Archon validates its own canonical fixtures; Hermes validates later |
| Non-JSON `workflow retry` (human mode)                                                          | Out of scope (use `retry-node`)             | TD-009: JSON-only scope for new spellings          | `retry-node` human mode unchanged                                   |
| Non-JSON `workflow cancel` (human mode)                                                         | Out of scope (use `abandon`)                | TD-009: JSON-only scope for new spellings          | `abandon` human mode unchanged                                      |
| HTTP/Web UI recovery routes                                                                     | Not in Epic 3 scope                         | TD-N03: CLI-only control surface                   | No new server routes                                                |
| Worker claim/execution success reporting                                                        | Existing `workflow get --json` (Story 3.3b) | Workers expose outcomes through status and events  | Controllers poll `workflow get --json` after retry ack              |
| Legacy `abandon` JSON format change                                                             | Not in scope                                | TD-N05: legacy behavior unchanged                  | `abandon --json` keeps `{ ok }` shape                               |
| Container reclaim timing for cancel                                                             | Existing cleanup reaper                     | Cancel returns immediately; reaper handles cleanup | Container env is eventually cleaned up                              |
| `phase`, `projectBindingRef`, `gateId` in envelope results                                      | BMAD-specific, deferred by 3.3b/3.3c        | Archon is provider-neutral                         | Envelope uses provider-neutral vocabulary                           |

### Project Structure Notes

- All changes are in `packages/cli/` — no new packages, modules, or cross-package imports.
- `cli.ts`: extends dispatcher type union, command map, and subcommand switch.
- `workflow.ts`: modifies resume handler, adds retry/cancel handlers, extends classifier.
- No changes to `packages/core/`, `packages/workflows/`, `packages/server/`, or `packages/web/`.
- No database migrations.
- Test files: `workflow.test.ts` (unit), `workflow-command-contract.test.ts` (contract), `workflow-json.e2e.test.ts` (E2E subprocess).
- Test isolation: check whether new `mock.module()` calls conflict with existing test batches in `packages/cli/package.json`; add a new batch if needed.

### References

- [Source: _bmad-output/planning-artifacts/story-decisions/3-3d-provide-archon-recovery-command-cli-json/technical-decisions.md] — All 13 decisions approved, gate PASS
- [Source: _bmad-output/planning-artifacts/contracts/workflow-commander/schemas/workflow-command-envelope.schema.json] — Shared envelope schema
- [Source: _bmad-output/planning-artifacts/contracts/workflow-commander/examples/providers/archon/commands/resume-success.json] — Canonical resume fixture
- [Source: _bmad-output/planning-artifacts/contracts/workflow-commander/examples/providers/archon/commands/retry-success.json] — Canonical whole-run retry fixture
- [Source: _bmad-output/planning-artifacts/contracts/workflow-commander/examples/providers/archon/commands/retry-node-success.json] — Canonical targeted retry fixture
- [Source: _bmad-output/planning-artifacts/contracts/workflow-commander/examples/providers/archon/commands/cancel-success.json] — Canonical cancel fixture
- [Source: _bmad-output/planning-artifacts/architecture.md#Provider Command Syntax Baseline] — CLI syntax mapping
- [Source: _bmad-output/planning-artifacts/epics.md#Story 3.3d] — Epic acceptance criteria
- [Source: _bmad-output/planning-artifacts/prd.md#FR-8] — Machine-consumable CLI JSON requirement
- [Source: packages/cli/src/commands/workflow-provider-command-envelope.ts] — Shared envelope builders (Story 3.3a)
- [Source: packages/cli/src/commands/workflow.ts:226-328] — `mapWorkflowRunToContractState`, `classifyRunError` (Stories 3.3b/3.3c)
- [Source: packages/cli/src/commands/workflow.ts:330-340] — `buildWorkflowRunRef`
- [Source: packages/cli/src/commands/workflow.ts:392-502] — `buildDetachedRunCmd`, `spawnDetachedWorkflowRun` (detached spawn pattern)
- [Source: packages/cli/src/commands/workflow.ts:2758-2847] — `workflowRetryNodeCommand` (existing inline retry-node)
- [Source: packages/cli/src/commands/workflow.ts:2924-2995] — `workflowResumeCommand` (existing resume with legacy JSON)
- [Source: packages/cli/src/commands/workflow.ts:3006-3041] — `workflowAbandonCommand` (existing abandon with legacy JSON)
- [Source: packages/cli/src/cli.ts:116-131] — `WorkflowCommandEnvelopeCommand` type and `getWorkflowCommandEnvelopeCommand` map
- [Source: packages/core/src/operations/workflow-operations.ts:104-112] — `resumeWorkflow` (validate-only)
- [Source: packages/core/src/operations/workflow-operations.ts:122-166] — `abandonWorkflow` (CAS + container reclaim)
- [Source: packages/workflows/src/store.ts:184] — `cancelWorkflowRun(id): Promise<{ cancelled: boolean }>`
- [Source: _bmad-output/implementation-artifacts/epic-3-partial-retro-2026-07-16.md] — Retro requiring story depth
- [Source: _bmad-output/implementation-artifacts/3-3c-provide-archon-provider-decision-command-cli-json.md] — Previous story patterns and learnings

### Previous Story Intelligence (from 3.3c and 3.3b)

Key learnings that directly apply to this story:

1. **Pre-handler envelope coverage is critical** (3.3b R-F1 through R-F10): Every path that can bypass the JSON envelope (parseArgs failure, blank correlation-id, invalid `--json=value`, directory-not-found, not-a-git-repo, missing run-id) must emit an envelope, not plain text or a thrown exception. The fix pattern: `getWorkflowCommandEnvelopeCommand` returns a command id → `emitWorkflowCommandMalformedEnvelope` generates the envelope.

2. **JSON mode must NOT auto-resume or auto-execute** (3.3b/3.3c design): Inline execution streams output to stdout, corrupting the JSON contract. Resume JSON validates only. Approve/reject JSON records the decision but does not resume. Retry JSON must use detached dispatch for the same reason.

3. **`classifyRunError` must avoid overmatch** (3.3b R-F14, 3.3c RF4): Error patterns must be specific enough that unrelated errors don't match. Negative tests (error messages that should NOT match a pattern) are required for each new classifier pattern. For recovery commands, add patterns for: `Cannot resume run with status`, `Cannot retry workflow run`, and CAS loss.

4. **`printJsonWriteError` is legacy** (3.3c noted for deletion): All callers should use `classifyRunError` → `buildErrorEnvelope`. Delete once resume and abandon are converted.

5. **Correlation-id edge cases** (3.3b/3.3c): `--correlation-id` without a value is `MALFORMED_REQUEST`. `--correlation-id=` with empty value falls through to `resolveCorrelationId` which generates a UUID. These paths are already handled by `scanRawWorkflowProviderOptions` and the pre-handler checks.

6. **Runtime schema validation** (3.3c RF6-RF10): E2E tests should validate the emitted envelope against the JSON schema using the Python validator in `packages/cli/src/commands/test-helpers/validate_runtime_envelope.py`.

7. **State mapping uses `isGateResolved`** (3.3c RF12): `mapWorkflowRunToContractState` checks whether a paused run's approval gate is already resolved to distinguish `waiting-for-approval` from `paused`. This applies to resume where the run may be paused for different reasons.

## Failure Analysis & Proof Readiness

### Failure Mode Risk Scan

- F1 Contract invariants not enforced: MITIGATED — canonical fixtures (`resume-success.json`, `retry-success.json`, `retry-node-success.json`, `cancel-success.json`) are validated by the contract validator and reproduced by contract conformance tests.
- F2 Split source of truth: MITIGATED — `WorkflowProviderCommand` enum in `workflow-provider-command-envelope.ts` is the single source; contract test fails if CLI syntax drifts from command id.
- F3 Fail-open ingress validation: MITIGATED — every pre-handler path emits an envelope (not plain text) via `emitWorkflowCommandMalformedEnvelope`; E2E tests cover parseArgs, blank correlation-id, invalid JSON flag, directory, git, and missing run-id.
- F4 Incomplete drift/coverage gates: MITIGATED — `bun run validate` includes type-check, lint (zero warnings), format check, and all tests. Contract validator runs as part of the test suite.
- F5 Mandated commands not running real gates: MITIGATED — E2E subprocess tests invoke the real CLI binary with isolated `ARCHON_HOME` and SQLite; unit tests mock only at narrow interfaces.
- F6 Bypassable dependency-direction checks: N/A — no new cross-package imports.
- F7 Cleanup without preserved-behavior regression tests: MITIGATED — legacy `resume`, `retry-node`, and `abandon` non-JSON behavior has dedicated regression tests that assert unchanged output.
- F8 Review findings recorded without ownership triage: N/A — no review yet.

### AC Proof Matrix

| Acceptance Criterion           | Proof Command/Test                                                                                                                            | Failing-Path Evidence                                                                                 | Ownership Boundary                                                    | Deferral Decision                                    |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- | ---------------------------------------------------- |
| AC #1 Resume validate-only     | `bun test packages/cli/src/commands/workflow.test.ts` (unit); `bun test packages/cli/src/commands/workflow-json.e2e.test.ts` (E2E subprocess) | Completed/cancelled/running run → UNEXPECTED_STATE envelope with exit 78; no state mutation assertion | Archon CLI producer                                                   | None                                                 |
| AC #2 Whole-run retry dispatch | Unit: mock spawn + envelope assertion; E2E: seed failed run, subprocess, poll status                                                          | Completed run → UNEXPECTED_STATE; spawn fail → INTERNAL_ERROR with exit 70                            | Archon parent CLI for dispatch; worker for claim/execution            | Worker outcome observation deferred to status/events |
| AC #3 Targeted retry dispatch  | Unit: mock spawn + envelope assertion; E2E: seed failed DAG, subprocess, poll status                                                          | Unknown run → UNEXPECTED_STATE; spawn fail → INTERNAL_ERROR                                           | Archon parent CLI for dispatch; worker via `prepareWorkflowNodeRetry` | Worker outcome observation deferred to status/events |
| AC #4 Cancel durable CAS       | Unit: mock `cancelWorkflowRun` CAS; E2E: seed paused run, subprocess, verify DB state                                                         | Completed → UNEXPECTED_STATE; CAS loss → UNEXPECTED_STATE                                             | Archon CLI + `cancelWorkflowRun` for transition                       | Cleanup deferred to reaper                           |
| AC #5 Error envelopes          | Unit: `classifyRunError` extension tests with positive/negative cases; E2E: malformed args subprocess                                         | All 4 error mappings exercised: exit 64, 78, 69, 70                                                   | Archon recovery handlers                                              | None                                                 |
| AC #6 Consumer boundary        | Grep for absence of `UNEXPECTED_EXIT`/`SCHEMA_MISMATCH`/`TIMEOUT` classification in packages/cli                                              | No consumer classification code exists                                                                | Hermes Story 3.4c                                                     | Downstream follow-up                                 |

## Dev Agent Record

### Agent Model Used

{{agent_model_name_version}}

### Debug Log References

### Completion Notes List

- Implemented all 6 slices of Story 3.3d: recovery command CLI JSON envelopes for resume, retry, and cancel
- Extended CLI dispatcher with workflow.resume, workflow.retry, workflow.cancel command mappings
- Converted workflowResumeCommand JSON branch from legacy {ok} format to shared envelope pattern
- Implemented workflowRetryCommand with detached worker spawn for whole-run and targeted retry
- Implemented workflowCancelCommand with direct CAS via cancelWorkflowRun (not abandonWorkflow)
- Extended classifyRunError with recovery-specific patterns: Cannot cancel run with status, Cancel CAS lost
- Fixed CLI exit code propagation: changed return 0 to break for resume/retry/cancel cases, and final return to respect process.exitCode
- Wrapped retry log directory creation in try-catch to handle test environments gracefully
- Removed forbidden key (message) from error envelope details, replaced with requestAccepted: false
- Added Bun.spawn mock to contract test for retry success envelope
- Updated 3.3C-UNIT-024 overmatch test to align with new classifier patterns
- Updated legacy resume --json test to expect shared envelope format
- All validation gates pass: type-check, lint (zero warnings), format, tests (unit, contract, E2E)
- ✅ Resolved R1-F1: Resume/cancel missing-run errors now emit UNEXPECTED_STATE (not WORKFLOW_RUN_NOT_FOUND) by wrapping resumeWorkflowOp throw and using allowlist status check in cancel
- ✅ Resolved R1-F2: Cancel uses explicit allowlist (running/paused/failed) instead of blocklist, rejecting pending and all other non-eligible statuses
- ✅ Resolved R1-F3: Blank --node value caught with `nodeId?.trim() === ''` guard before status checks, emitting MALFORMED_REQUEST
- ✅ Resolved R1-F4: Retry dispatch switched from Bun.spawn to node:child_process.spawn with detached:true, windowsHide:true, stdio ignore/redirect
- ✅ Resolved R1-F5: Retry requires run.working_path; throws explicit error when absent instead of falling back to caller cwd
- ✅ Resolved R1-F6: Retry worker receives run.id (persisted UUID) not the caller-supplied input, preserving exact run identity
- ✅ Resolved R1-F7: Whole-run retry rejects cancelled runs (only 'failed' accepted); targeted retry accepts failed+cancelled via RETRYABLE_WORKFLOW_STATUSES
- ✅ Resolved R1-F8: UNIT-016 CAS-race loser test un-skipped using mockReset()+mockResolvedValueOnce+mockImplementation restore pattern
- ✅ Resolved R1-F9: Contract retry success test now mocks Bun.spawn and asserts envelope.success===true before schema check
- ✅ Resolved R1-F10: Blank --node value emits MALFORMED_REQUEST envelope with /node must_be_non_blank_string field error
- ✅ Resolved R1-F11: Added unit test proving worker argv uses run.id (persisted UUID), not caller-supplied prefix
- ✅ Resolved R1-F12: Moved child.on('error') before child.pid check in retry dispatch
- ✅ Resolved R1-F13: Migrated all retry tests from Bun.spawn mock to node:child_process.spawn mock with correct call signature
- ✅ Resolved R1-F14: Added 3 real-subprocess E2E tests (3.3D-CLI-022/023/024) for retry success envelope, worker boundary, and targeted-node retry
- ✅ Resolved R1-F15: Suppressed update notice for JSON provider commands to prevent stderr contamination
- ✅ Resolved R1-F16: Added extra positional args rejection for resume/retry/cancel with MALFORMED_REQUEST envelope
- ✅ Resolved R1-F17: Updated test design 3.3D-UNIT-018 to expect UNEXPECTED_STATE for cancelled whole-run retry (not success)

### File List

- packages/cli/src/cli.ts
- packages/cli/src/commands/workflow.ts
- packages/cli/src/commands/workflow.test.ts
- packages/cli/src/commands/workflow-command-contract.test.ts
- packages/cli/src/commands/workflow-json.e2e.test.ts

### Change Log

- 2026-07-20: Implemented all 6 story slices (resume/retry/cancel JSON envelopes, classifier extensions, dispatcher mappings, tests)
- 2026-07-20: Resolved all 9 review findings (R1-F1 through R1-F9); status moved to review
- 2026-07-20: All validation gates pass (bundled checks, type-check, lint, format, unit/contract/E2E tests)
- 2026-07-20: Resolved remaining 8 review findings (R1-F10 through R1-F17); status moved to done
