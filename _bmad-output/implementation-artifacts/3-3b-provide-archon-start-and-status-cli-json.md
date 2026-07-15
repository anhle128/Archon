# Story 3.3b: Provide Archon Start And Status CLI JSON

Status: in-progress

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a controller integrator,
I want provider `archon` to expose workflow start and status through parseable CLI JSON,
so that external controllers can create and inspect workflow references without using the Archon dashboard.

## Acceptance Criteria

1. **Given** a workflow run can be started from Archon CLI
   **When** Archon starts the run
   **Then** Archon returns parseable JSON with schema version, success flag, correlation id, workflow run reference, binding reference when applicable, and machine-readable result payload
   **And** the command accepts the project cwd or codebase reference needed by the controller contract.

2. **Given** a workflow run is inspected from Archon CLI
   **When** Archon returns status
   **Then** the result includes run state, workflow name, workflow run reference, correlation id when available, and machine-readable error shape when failed
   **And** the result matches the shared status example.

3. **Given** a start or status command fails
   **When** Archon returns the failure
   **Then** the response includes schema version, success flag, correlation id if available, machine-readable error code, and diagnostic category
   **And** consumers can fail closed on malformed JSON, schema mismatch, timeout, or unexpected exit code.

## Tasks / Subtasks

- [ ] Task 1 - Convert `archon workflow run <name> [message] --json` to emit the `workflow.start` envelope (AC: 1, 3)
  - [ ] In `packages/cli/src/commands/workflow.ts`, change `workflowRunCommand`'s return type from `Promise<void>` to `Promise<number>` (mirrors `workflowGetCommand`'s existing `Promise<number>` pattern) so `--json` failures return a classified exit code instead of relying on `cli.ts`'s generic plain-text catch.
  - [ ] Update the `cli.ts` `workflow run` dispatch (`cli.ts:501-548`) to `return await workflowRunCommand(...)`, not `await ...; break`, so non-zero JSON envelope exit codes propagate to the process. Keep non-JSON success behavior returning `0`.
  - [ ] Thread `values['correlation-id'] as string | undefined` into the `workflowRunCommand` options object in `cli.ts`; `workflow run --json --correlation-id <id>` must echo the supplied id in every success and error envelope.
  - [ ] Move or conditionalize the `cli.ts` prevalidation for `workflow run` mutually exclusive flags (`cli.ts:508-530`) so `--json` invocations reach `workflowRunCommand` and are converted into `MALFORMED_REQUEST` envelopes. Preserve the current plain-text `console.error` validation for non-JSON invocations.
  - [ ] Handle `archon workflow run --json` with a missing workflow name as a `workflow.start` `MALFORMED_REQUEST` envelope with `exitCode: 64` instead of the current plain usage text. Keep the current usage text for non-JSON invocations.
  - [ ] Wrap the foreground body in a fail-closed boundary (a local helper analogous to `provider-binding.ts`'s `withFailClosed`, duplicated locally per the project's rule-of-three convention — do not force-extract a shared helper yet) so that **when `options.json` is true and `options.detach` is not true**, every thrown `Error` (bad flags, unknown workflow, DB/codebase lookup failure, worktree creation failure, `executeWorkflow` failure) is caught and converted into a `buildErrorEnvelope(...)` line via `console.log(safeStringify(...))`, returning the classified exit code — never let a foreground `--json` invocation reach `cli.ts`'s plain-text `catch` block.
  - [ ] When `options.json` is falsy, preserve ALL existing behavior byte-for-byte: same thrown `Error` messages, same human `console.log` lines, same execution flow. Do not touch the non-JSON path.
  - [ ] **Scope the envelope conversion to the foreground (non-`--detach`) path only.** Do NOT touch the existing `--detach` JSON ack (`workflow.ts:549-564`, `{ ok: true, action: 'run', detached: true, ... }`). Reason: at the moment the detach ack is emitted, the child process has not yet created the workflow-run DB row, so no real `runId` exists to satisfy `workflowRunRef`'s required `runId` field. The architecture.md Provider Command Syntax Baseline row for `workflow.start` lists `--cwd`, `--branch`, `--from`, `--no-worktree`, `--conversation-id` as accepted flags and does **not** mention `--detach` — treat this as confirmation that `--detach` is outside this story's provider-command surface. Leave `workflowRunCommand`'s `--detach` branch (including its own `if (options.json)` block) completely unchanged.
  - [ ] Guarantee foreground `workflow run --json` writes exactly one JSON envelope to stdout and no human/progress/assistant text on stdout. Guard the existing stdout writes at `workflow.ts:573-575` and `workflow.ts:716-718`, and prevent `CLIAdapter.sendMessage()` from printing dispatch, result-card, approval, or assistant messages to stdout during JSON mode while still preserving message persistence for Web UI history.
  - [ ] Add the smallest local adapter change needed for the stdout guarantee, preferably `CLIAdapterOptions.silent?: boolean` in `packages/cli/src/adapters/cli-adapter.ts` that skips only the `console.log(message)` side effect and keeps DB persistence unchanged. Use `new CLIAdapter({ silent: options.json === true })` for the foreground JSON path. Do not use `quiet` as a substitute: `quiet` controls progress-event rendering, not adapter stdout.
  - [ ] For the foreground path, after `executeWorkflow` resolves (`workflow.ts:996-1022`), branch on `options.json`:
    - Human mode (unchanged): keep the existing `console.log('\nWorkflow paused...')` / `console.log('\nWorkflow completed successfully.')` / `throw new Error('Workflow failed: ...')` behavior exactly as today.
    - JSON mode (new): build a `workflow.start` success envelope via `buildSuccessEnvelope` covering the completed, paused, AND failed outcomes (do not throw for a failed workflow when `options.json` is true — emit a failure envelope instead, matching the never-throw-under-json convention already used by `workflowGetCommand`).
  - [ ] For successful JSON outcomes (`result.success === true`), fetch the persisted run via `workflowDb.getWorkflowRun(result.workflowRunId)` before building the envelope and pass that row through the state-mapping helper. This is required to read `status`, `metadata.approval`, and the actual terminal state. If the run row cannot be loaded, log the DB error and emit an `INTERNAL_ERROR` envelope with `details: { runId: result.workflowRunId }`, `category: 'implementation_defect'`, and `exitCode: 70`.
  - [ ] Build `workflowRunRef` as `{ provider: 'archon', runId: persistedRun.id, workflowName: persistedRun.workflow_name, projectRef: persistedRun.codebase_id ? \`project:${persistedRun.codebase_id}\` : undefined }`(omit`projectRef`entirely when no codebase resolved — the schema's`projectRef` is optional). Do not re-query just for the id; re-query only because the success envelope needs the persisted run state and metadata.
  - [ ] Build `result` for the success envelope as `{ operation: 'start', state: <mapped-state>, terminal: <bool>, accepted: true }` plus, only when the run is paused on an approval gate, `actionRequired: true` and `gateRef: { gateId: metadata.approval.nodeId, kind: 'human-decision' }` (see Dev Notes "State Mapping" for the exact mapping table and the `phase`/`projectBindingRef` fixture-field scoping decision).
  - [ ] For a failed execution (`result.success === false`) under `--json`, do not assume `result.workflowRunId` exists. Some current `executeWorkflow` early-failure returns omit it (`executor.ts:593`, `688`, `811`), while later failed returns include it (`executor.ts:718-721`, `918-921`, `999`). If `workflowRunId` exists, emit `WORKFLOW_EXECUTION_FAILED`/`unexpected_state`/`retryable: true` with `details: { runId: result.workflowRunId }` and `exitCode: 78`; if it is absent, emit `INTERNAL_ERROR`/`implementation_defect`/`retryable: true` with `details: { requestAccepted: false }` and `exitCode: 70`. Do NOT include the raw `result.error` string in `details` (NFR-14: machine-readable detail, not raw diagnostic text) — log it via `getLog().error(...)` instead, same as existing behavior.
  - [ ] Add a local `classifyRunError(err: unknown)` mirroring `provider-binding.ts`'s `classifyError` shape (`{ code, category, retryable, exitCode }`) for the earlier-stage throw points (bad flags → `MALFORMED_REQUEST`/`provider_contract`/64; unknown workflow name → `WORKFLOW_NOT_FOUND`/`unexpected_state`/78; DB/codebase/worktree failures → `INTERNAL_ERROR`/`implementation_defect`/70, with a timeout-message-pattern branch → `COMMAND_TIMEOUT`/`timeout`/69, matching `provider-binding.ts:136-138`). Do not duplicate the exact `BINDING_*` codes — invent workflow-scoped codes.
  - [ ] Wire a `--correlation-id` flag through: add `correlationId?: string` to `WorkflowRunOptions` (`workflow.ts:74-103`), resolve it once via the existing `resolveCorrelationId`/`resolveIssuedAt` helpers from `workflow-provider-command-envelope.ts`, and pass it into every envelope built for this command.

- [ ] Task 2 - Convert `archon workflow get <run-id> --json` to emit the `workflow.status` envelope (AC: 2, 3)
  - [ ] In `packages/cli/src/commands/workflow.ts`, add an optional 4th parameter `correlationId?: string` to `workflowGetCommand` (`workflow.ts:1258-1261`) — additive, preserves existing 2-arg and 3-arg call sites.
  - [ ] Replace the DB-error JSON branch (`workflow.ts:1271-1274`, currently `{ ok: false, runId, error: err.message }`) with a `buildErrorEnvelope` call: classify via the same timeout-pattern check as Task 1's `classifyRunError` (or share it — same file, same command family), default `INTERNAL_ERROR`/`implementation_defect`/70. Do not leak `err.message` into `details`; log it via `getLog().error(...)` (already present) instead.
  - [ ] Replace the not-found JSON branch (`workflow.ts:1281-1282`, currently `{ ok: false, runId, error: 'not_found' }`) with a `buildErrorEnvelope` call: `code: 'WORKFLOW_RUN_NOT_FOUND'`, `category: 'unexpected_state'`, `retryable: false`, `exitCode: 78`, `details: { runId }`. Keep the exit code `1` for the human (non-JSON) not-found path unchanged.
  - [ ] Replace the success JSON branch (`workflow.ts:1299-1303`, currently the raw `WorkflowRun` row, optionally spread with `events`) with a `buildSuccessEnvelope` call. Build `workflowRunRef` the same way as Task 1 (`provider: 'archon', runId: run.id, workflowName: run.workflow_name, projectRef: run.codebase_id ? \`project:${run.codebase_id}\` : undefined`). Build `result`as`{ operation: 'status', state: <mapped-state>, terminal: <bool> }`plus`actionRequired`/`gateRef`when paused-for-approval (same mapping as Task 1), plus`events: events ?? []`**only** when`verbose`is true (preserves the existing verbose-events feature, relocated from top-level into`result.events`).
  - [ ] Return the envelope's matching numeric exit code from every branch (0 success, 78 not-found, 70 DB-error) instead of the current ad hoc `0`/`1`.
  - [ ] Update the `cli.ts` `workflow get` dispatch (`cli.ts:555-568`) to also pass `values['correlation-id'] as string | undefined` as the new 4th argument.
  - [ ] Handle `archon workflow get --json` with a missing run id as a `workflow.status` `MALFORMED_REQUEST` envelope with `exitCode: 64` instead of the current plain usage text. Keep the current usage text for non-JSON invocations.

- [ ] Task 3 - State mapping helper (AC: 1, 2)
  - [ ] Add a small shared function (co-located in `workflow.ts`, not the shared envelope module — this mapping is workflow-command-specific, not generic to all provider commands) that maps a `WorkflowRun` (`status` + `metadata`) to the contract-facing `{ state, terminal, actionRequired?, gateRef? }` shape. Use the exact mapping table in Dev Notes ("State Mapping"). Reuse `TERMINAL_WORKFLOW_STATUSES` (already imported indirectly via `@archon/workflows/schemas/workflow-run`) for the `terminal` boolean, and `isApprovalContext` (same module) to detect an approval-gate pause safely.
  - [ ] Unit-test the mapping function directly for all six `WorkflowRunStatus` values, plus the paused+approval-context and paused+interactive-loop-context sub-cases.

- [ ] Task 4 - Contract and regression tests (AC: 1, 2, 3)
  - [ ] Update `packages/cli/src/commands/workflow.test.ts`'s `describe('workflowGetCommand', ...)` (currently `workflow.ts` test lines ~1819-1942) to assert the new envelope shape for: not-found, DB-error, success (non-verbose), success (verbose, `events` now under `result.events`). Follow the same "exact fixture comparison with a narrow, documented dynamic-field exclusion list" pattern established in `provider-binding.test.ts` (dynamic fields here: `correlationId`, `issuedAt`, `runId`, `startedAt`/similar timestamps if added).
  - [ ] Add new tests for `workflowRunCommand`'s foreground `--json` path: success/completed, success/paused approval gate, success/paused interactive-loop, failed execution with a run id, failed execution without a run id, and at least one early-throw case (unknown workflow name) converted to an error envelope. Assert each JSON-mode test writes exactly one stdout line and that the line parses as the envelope; specifically assert it does not include `Running workflow:`, `Working directory:`, dispatch text, result-card text, or raw workflow messages. Do not remove or alter the existing `describe('workflowRunCommand — detach', ...)` tests (`workflow.ts` test lines ~2216-2314) — they must keep passing unchanged, proving `--detach` truly stayed out of scope.
  - [ ] Add or update CLI-dispatch tests/subprocess coverage proving `workflow run --json` returns the `workflowRunCommand` numeric exit code, passes `--correlation-id`, and does not short-circuit bad flag combinations or missing required positionals into plain-text `console.error` before a `MALFORMED_REQUEST` envelope can be emitted. Cover `workflow get --json` missing run id the same way.
  - [ ] Add a companion contract test (mirroring `provider-binding-contract.test.ts`'s pattern) that runs `python3 _bmad-output/planning-artifacts/contracts/workflow-commander/validate_contracts.py` and verifies emitted workflow command envelopes contain no forbidden keys (`actor`, `profile`, `agent_name`, `agent`, `agent_provider`) and no `COMMAND_FORBIDDEN_TEXT_KEYS` such as `message`/`stdout`/`stderr`/`displayText`. Do not raw-regex all of `workflow.ts` for words like `message`; that file legitimately handles user messages and approval messages outside emitted envelopes. Validate parsed emitted envelopes or the narrow helper payloads instead.
  - [ ] Reconcile against the checked-in fixtures `start-success.json` and `status-success.json`: these illustrate `phase` and `projectBindingRef` (start) / `phase` and `gateRef` (status) fields that do not generalize to non-BMAD Archon workflows (see Dev Notes). Do not invent a fake `phase` value to force a byte-for-byte match — write the fixture-conformance test to assert the fields this story's design table actually produces (`operation`, `state`, `terminal`, `accepted`/`actionRequired`/`gateRef` where applicable) and document the intentional field-set delta in the story's Completion Notes rather than silently passing a weakened test.
  - [ ] Confirm `packages/cli/package.json`'s `test` script placement: `workflow.test.ts` already runs in its own isolated `bun test` invocation (`... && bun test src/commands/workflow.test.ts && ...`) — no script change should be needed unless a new file is added, in which case follow the existing isolation-group rules (non-mocking files may share an invocation; anything using `mock.module()` differently from an existing grouped file needs its own).

- [ ] Task 5 - Validate focused and full gates (AC: 1, 2, 3)
  - [ ] Run `python3 _bmad-output/planning-artifacts/contracts/workflow-commander/validate_contracts.py`.
  - [ ] Run `bun test packages/cli/src/commands/workflow.test.ts`.
  - [ ] Run `bun test packages/cli/src/commands/workflow-provider-command-envelope.test.ts` (regression — this story must not modify the shared envelope module's behavior).
  - [ ] Run `bun --filter @archon/cli type-check`.
  - [ ] Run `bun run validate` before moving the story to review.

### Review Findings

- [x] [Review][Patch] `workflow run --resume --json` can corrupt stdout before the envelope [`packages/cli/src/commands/workflow.ts`:887]
- [x] [Review][Patch] Resume hydration failures can be misclassified as provider-contract malformed requests [`packages/cli/src/commands/workflow.ts`:180]
- [x] [Review][Patch] JSON start error envelopes re-resolve `issuedAt` instead of using the command-level timestamp [`packages/cli/src/commands/workflow.ts`:548]
- [x] [Review][Patch] Non-JSON `workflowRunCommand` behavior changed for missing workflow names [`packages/cli/src/commands/workflow.ts`:583]
- [x] [Review][Patch] Required command-level paused interactive-loop JSON test is missing [`packages/cli/src/commands/workflow.test.ts`:2001]
- [x] [Review][Patch] Fixture field-set delta is not documented in Completion Notes [`_bmad-output/implementation-artifacts/3-3b-provide-archon-start-and-status-cli-json.md`:229]
- [x] [Review][Patch] Contract tests named as start success checks can pass against an error envelope [`packages/cli/src/commands/workflow-command-contract.test.ts`:124]
- [x] [Review][Patch] Workflow JSON E2E subprocess tests use ambient Archon home and database state [`packages/cli/src/commands/workflow-json.e2e.test.ts`:30]
- [x] [Review][Patch] Missing `--correlation-id` value can escape the JSON fail-closed boundary [`packages/cli/src/commands/workflow.ts`:527]
- [x] [Review][Patch] Verbose status JSON can embed forbidden event text keys [`packages/cli/src/commands/workflow.ts`:1613]
- [x] [Review][Patch] Failed workflow status lacks a machine-readable failure shape [`packages/cli/src/commands/workflow.ts`:1604]
- [x] [Review][Patch] Foreground JSON start success bypasses workflow result-card persistence [`packages/cli/src/commands/workflow.ts`:1277]
- [x] [Review][Patch] JSON bad-flag requests can be misclassified as workflow lookup failures [`packages/cli/src/commands/workflow.ts`:605]
- [x] [Review][Patch] Non-JSON direct blank workflow-name behavior is still changed [`packages/cli/src/commands/workflow.ts`:583]
- [x] [Review][Patch] Generic `not found` classification can mislabel status DB failures [`packages/cli/src/commands/workflow.ts`:168]
- [x] [Review][Patch] JSON E2E tests set `DATABASE_URL=sqlite:...`, which selects Postgres [`packages/cli/src/commands/workflow-json.e2e.test.ts`:47]
- [x] [Review][Patch] Missing `--correlation-id` value still escapes or misclassifies JSON fail-closed handling [`packages/cli/src/commands/workflow.ts`:573]
- [x] [Review][Patch] JSON start result-card persistence uses DB conversation id instead of platform conversation id [`packages/cli/src/commands/workflow.ts`:1357]
- [x] [Review][Patch] Failed status envelope still lacks the required machine-readable failure shape [`packages/cli/src/commands/workflow.ts`:1707]
- [x] [Review][Patch] Status DB errors can still classify as workflow-domain not-found [`packages/cli/src/commands/workflow.ts`:1648]
- [x] [Review][Patch] Verbose status forbidden-key regression coverage is missing [`packages/cli/src/commands/workflow-command-contract.test.ts`:166]
- [x] [Review][Patch] JSON worktree-policy flag mismatches can be emitted as internal errors [`packages/cli/src/commands/workflow.ts`:737]
- [x] [Review][Patch] Missing `--correlation-id` value still escapes or misclassifies JSON fail-closed handling [`packages/cli/src/cli.ts`:550]
- [x] [Review][Patch] `workflow get --json` DB lookup timeouts are emitted as internal errors [`packages/cli/src/commands/workflow.ts`:1691]
- [x] [Review][Patch] Failed status envelopes still expose only an opaque failure flag [`packages/cli/src/commands/workflow.ts`:1757]
- [x] [Review][Patch] JSON result-card persistence has no regression test covering `workflow_result` DB persistence [`packages/cli/src/commands/workflow.test.ts`:2125]
- [x] [Review][Patch] JSON worktree-policy mismatch classification has no focused regression coverage [`packages/cli/src/commands/workflow.test.ts`:1182]
- [ ] [Review][Patch] Missing `--correlation-id` values still do not consistently fail closed as `MALFORMED_REQUEST` JSON envelopes [`packages/cli/src/cli.ts`:590]
- [ ] [Review][Patch] `workflow run/get --json` can still fail before the envelope handlers when cwd is not a git repository [`packages/cli/src/cli.ts`:471]
- [ ] [Review][Patch] `workflow run --json=true` bypasses the JSON fail-closed boundary and can print plain errors [`packages/cli/src/commands/workflow.ts`:572]
- [ ] [Review][Patch] The start-command error classifier can still report infrastructure "not found" errors as workflow-name lookup failures [`packages/cli/src/commands/workflow.ts`:172]
- [ ] [Review][Patch] Failed status envelopes still expose an opaque failure object rather than a machine-readable failure shape [`packages/cli/src/commands/workflow.ts`:1779]
- [ ] [Review][Patch] Verbose status event sanitization does not recurse into nested arrays, so forbidden text keys can still leak [`packages/cli/src/commands/workflow.ts`:244]

## Dev Notes

### Scope Boundary

This story converts the runtime JSON output of exactly two existing CLI commands:

- `archon workflow run <workflow-name> [message] --json` (foreground/synchronous path only) → `workflow.start`.
- `archon workflow get <run-id> --json` → `workflow.status`.

It does **not** touch: `--detach` ack output, `workflow status` (the active-runs list surface — different from `workflow get`), `workflow resume`/`approve`/`reject`/`abandon`/`retry-node`/`runs`/`cleanup`/`reset-sessions` (Stories 3.3c/3.3d own the decision/recovery command families), the workflow event outbox (Story 3.5), or delivery health (Story 3.7). It does not add HTTP routes, Web UI, or a state-changing HTTP control path (PRD FR-8 explicitly forbids one for Workflow Commander v1).

Story 3.3a already shipped the shared envelope builder module (`packages/cli/src/commands/workflow-provider-command-envelope.ts`) fully implemented and tested — `buildSuccessEnvelope`, `buildErrorEnvelope`, `safeStringify`, `resolveCorrelationId`, `resolveIssuedAt`. **Do not modify that module.** Its own test file (`workflow-provider-command-envelope.test.ts`, tests `3.3A-CONTRACT-036`/`037`) already proves the builder reproduces `start-success.json`/`status-success.json` byte-for-byte when fed the right `refs`/`result` arguments — this story's job is purely to compute the right `refs`/`result` from real `WorkflowRun`/`executeWorkflow` data and call the existing builder, the same way `provider-binding.ts` does for binding commands.

### Contract Source Of Truth

```bash
python3 _bmad-output/planning-artifacts/contracts/workflow-commander/validate_contracts.py
```

Do not edit schemas or fixtures to make runtime code pass. If a genuinely new top-level envelope field is needed, stop and raise a contract change — but note `result` is `"additionalProperties": true` in `workflow-command-envelope.schema.json`, so anything placed inside `result` needs no schema change; only new **top-level** envelope fields would.

### Command Envelope Shape (recap from Story 3.3a)

Top-level fields are fixed: `schemaVersion`, `intendedProducer`, `intendedConsumer`, `owningSubproject`, `provider`, `command`, `correlationId`, `issuedAt`, `success`, `workflowRunRef`, `bindingRef`, `result`, `error`, `execution`. Success envelopes require `result` and forbid `error`; failure envelopes require `error` and forbid `result`. Successful `workflow.*` commands require `workflowRunRef` (`provider`, `runId`, `workflowName`, optional `projectRef`). Failure envelopes omit `workflowRunRef` by default (established convention from Story 3.1/3.3a) — keep that default here too, even though a `runId` is often known on a failed-execution path.

### State Mapping (new design work for this story — no prior art)

Archon's real `WorkflowRunStatus` (`packages/workflows/src/schemas/workflow-run.ts:10-17`) is `'pending' | 'running' | 'completed' | 'failed' | 'cancelled' | 'paused'`. The contract's illustrative fixtures use `state: "running"` (start) and `state: "waiting-for-approval"` (status) — `"waiting-for-approval"` is **not** a literal Archon status; it is Hermes/BMAD-facing vocabulary for a `paused` run that is specifically gated on human approval (as opposed to an interactive-loop pause). Map as follows:

| Archon `run.status` | `metadata.approval` (via `isApprovalContext`)             | `result.state`         | `result.terminal` |
| ------------------- | --------------------------------------------------------- | ---------------------- | ----------------- |
| `pending`           | —                                                         | `pending`              | `false`           |
| `running`           | —                                                         | `running`              | `false`           |
| `paused`            | present, `type !== 'interactive_loop'` (or `type` absent) | `waiting-for-approval` | `false`           |
| `paused`            | present, `type === 'interactive_loop'`                    | `paused`               | `false`           |
| `paused`            | absent/malformed                                          | `paused`               | `false`           |
| `completed`         | —                                                         | `completed`            | `true`            |
| `failed`            | —                                                         | `failed`               | `true`            |
| `cancelled`         | —                                                         | `cancelled`            | `true`            |

`terminal` = `TERMINAL_WORKFLOW_STATUSES.includes(run.status)` (already exported from `workflow-run.ts`). When `result.state === 'waiting-for-approval'`, also set `actionRequired: true` and `gateRef: { gateId: metadata.approval.nodeId, kind: 'human-decision' }` (best-effort — `gateRef` is not schema-required, `result` is fully open).

**`phase` and `projectBindingRef` are explicitly out of scope.** They are BMAD-story-phase / Hermes Project-Binding concepts (`phase: "implementation"`, `phase: "done-verification"`) that epics.md explicitly excludes from Archon's ownership (epics.md line 17: "...exclude Hermes-owned Project Binding, ... Phase Tasks, HILT Gates..."). A generic Archon DAG workflow run has no equivalent generic "phase" concept. Do not invent one. If strict byte-for-byte fixture parity for these two illustrative fields is later required, that needs its own contract discussion — flag it, do not silently fabricate a `phase` string.

### Blocking Execution Model — Deliberate Design Choice (read before implementing)

Today, `workflowRunCommand`'s foreground path (no `--detach`) calls `await executeWorkflow(...)` and blocks until the run reaches a terminal state or a pause — this is unchanged, complex, load-bearing behavior (worktree creation, DB writes, SIGTERM/SIGINT handling, event subscription for stderr rendering, Web UI dispatch messages). **This story keeps that blocking model exactly as-is** and only adds envelope-shaped output around the existing synchronous result. It does **not** make `workflow run --json` return early with a `state: "running"` reference the way the `start-success.json` fixture illustrates (that fixture's `state: "running"` depicts a run still in progress at response time, i.e., a genuinely asynchronous "accept and return a reference" model).

Rationale for this choice: (1) building true async start semantics would require either pre-creating the run row before spawning a child (a real architecture change to the `--detach` machinery, which currently has the child do all DB work) or leaving a bare in-process fire-and-forget promise dangling when the CLI process exits — both are materially riskier than this story's stated scope; (2) none of the three ACs above explicitly mandate non-blocking behavior — AC1's "the command accepts the project cwd or codebase reference" is about accepted **input**, not response timing; (3) the existing `--detach` path already covers the "don't block" use case, just not yet in envelope shape (and is explicitly out of scope here — see Task 1).

**Flag this to the story owner before/while implementing:** the fixture's non-terminal `"state": "running"` example is a real signal that Hermes may expect `workflow.start` to be non-blocking in production. If so, that is meaningfully larger scope (a new async-start execution path) that should be an explicit follow-up story, not silently absorbed here. This story's envelope will, in practice, almost always report a terminal or paused state (never a genuinely in-flight `"running"` snapshot), because by construction the process only responds after `executeWorkflow` resolves.

### Existing Code State To Preserve

- `packages/cli/src/commands/workflow.ts:412-1048` — `workflowRunCommand`. Preserve flag-validation semantics (`workflow.ts:462-484`), auto-registration of unregistered repos (`workflow.ts:631-650` — deliberately more permissive than `provider-binding.ts`'s fail-closed stance; this story does not change that), worktree creation/reuse (`workflow.ts:652-834`), SIGTERM/SIGINT cleanup handlers (`workflow.ts:909-939`), and Web UI dispatch/result-card persistence (`workflow.ts:951-967`, `1024-1047`). JSON mode may add guards around stdout writes and final envelope branching; non-JSON output and flow must stay byte-for-byte compatible.
- `packages/cli/src/adapters/cli-adapter.ts:38-69` — `CLIAdapter.sendMessage` currently writes every platform message to stdout before persistence. Foreground JSON mode must silence that stdout side effect or it will corrupt the one-envelope stdout contract. Preserve DB persistence; only suppress printing.
- `packages/cli/src/commands/workflow.ts:1258-1321` — `workflowGetCommand`. `fetchVerboseEvents` (verbose node-event lookup) stays as-is; only its landing spot in the JSON output moves from top-level `events` to `result.events`.
- `packages/cli/src/cli.ts:501-568` — the `workflow run`/`workflow get` dispatch cases. `--correlation-id` is already a registered global `parseArgs` option (`cli.ts:343`, added for `provider-binding` in Story 3.1) but is **not currently read** in either case — this story adds that wiring for these two commands only (do not touch the `provider-binding` case).
- `packages/cli/src/commands/workflow-provider-command-envelope.ts` — the shared builder from Story 3.3a. No changes expected; its own test file already proves it reproduces the target fixtures when given correct inputs.
- `packages/cli/src/commands/provider-binding.ts` — the reference pattern for wiring the shared builder into a command (`withFailClosed`, `classifyError`, `emitEnvelope`/`safeStringify` usage, exit-code conventions 64/69/70/78). Read it before writing Tasks 1-2; do not import from it (duplicate the small pattern locally in `workflow.ts`, per the project's rule-of-three convention — this becomes the second occurrence, not yet a third).
- `packages/workflows/src/executor.ts:593,688,811,718-721,913,915,918-921,999` — `executeWorkflow` has success returns with `workflowRunId`, later failed returns with `workflowRunId`, and early failed returns without `workflowRunId`. Treat `workflowRunId` as optional on failed results. For success results, load the persisted `WorkflowRun` row before emitting JSON so the state-mapping helper can read `status` and `metadata.approval`.
- `packages/workflows/src/schemas/workflow-run.ts` — `WorkflowRun`, `WorkflowRunStatus`, `TERMINAL_WORKFLOW_STATUSES`, `RESUMABLE_WORKFLOW_STATUSES`, `ApprovalContext`, `isApprovalContext`. All already imported into `workflow.ts` except `isApprovalContext`, `TERMINAL_WORKFLOW_STATUSES`, and `ApprovalContext` (add these to the existing import block at `workflow.ts:31-35`).

### Previous Story Intelligence

Story 3.3a (`3-3a-define-shared-workflow-provider-command-envelope.md`) established:

- `binding.create`/`binding.update` stay distinct; not relevant here but the same "explicit operation, no upsert" discipline applies conceptually — `workflow.start` always creates or resumes a specific run, never silently no-ops.
- `actor` is not present in the closed command-envelope schema and must not be emitted.
- Command fixtures and binding-domain fixtures are separate families; don't conflate result keys.
- `bindingRef.projectRef` / (by direct analogy) `workflowRunRef.projectRef` is a plain string `"project:<codebase_id>"`, built by stripping any existing `project:` prefix before storage/comparison and re-adding it on emission (see `provider-binding.ts:74-77,147-165`'s `normalizeProjectRef`/`buildBindingRef` for the exact pattern — do not re-derive this differently).
- The separate test-design file for 3.3a (`_bmad-output/test-artifacts/test-design/test-design-3-3a-define-shared-workflow-provider-command-envelope.md`) contains waiver `W-3.3A-001`: _"Story 3.3a defines the shared helper and baseline only; runtime conversion of workflow command families belongs to Stories 3.3b-3.3d."_ This story (3.3b) is exactly what closes that waiver for `workflow.start`/`workflow.status`.

Deferred work from 3.1/3.3a not in scope here: ambient `DEFAULT_AI_ASSISTANT` leak in `packages/core/src/db/codebases.test.ts`; no disposable live PostgreSQL DDL/restart-convergence lane.

### Git Intelligence

Recent CLI-package history (most recent first): Story 3.3a's `workflow-provider-command-envelope.ts` + test file were added and wired into `packages/cli/package.json`'s isolation-group chain in the same invocation as `provider-binding-contract.test.ts` (no `mock.module()` conflict). A follow-up code-review commit narrowed `EnvelopeMeta.command`/`classifyError` return types from `string` to the closed `WorkflowProviderCommand`/`ErrorCategory` unions — follow that same discipline for any new local types this story introduces (e.g., a `classifyRunError` return type should use `ErrorCategory` from the shared module, not a bare `string`).

### Testing Requirements

Use `bun run test` or focused package/file invocations; never root `bun test`. `workflow.test.ts` already runs in its own isolated `bun test` invocation in `packages/cli/package.json` — no script change needed unless a genuinely new test file is added.

Recommended focused checks:

```bash
python3 _bmad-output/planning-artifacts/contracts/workflow-commander/validate_contracts.py
bun test packages/cli/src/commands/workflow.test.ts
bun test packages/cli/src/commands/workflow-provider-command-envelope.test.ts
bun --filter @archon/cli type-check
bun run validate
```

### Latest Technical Information

No external library upgrade or new framework needed. Bun/TypeScript/strict-ESM conventions from `_bmad-output/project-context.md` apply unchanged. `tsconfig.json`'s `resolveJsonModule: true` lets tests import fixture JSON directly; production code must not import `_bmad-output` planning artifacts at runtime.

## Project Structure Notes

Expected updates (no new command files needed — this is a conversion of existing command output, not new commands):

- `packages/cli/src/commands/workflow.ts` (`workflowRunCommand`, `workflowGetCommand`, new local state-mapping + error-classification helpers)
- `packages/cli/src/cli.ts` (`workflow run` and `workflow get` dispatch: thread `--correlation-id` through, propagate `workflowRunCommand`'s numeric return code, and keep JSON bad-flag failures envelope-shaped)
- `packages/cli/src/adapters/cli-adapter.ts` (add a silent stdout option, or an equivalent narrowly scoped mechanism, so foreground JSON mode can persist messages without printing them)
- `packages/cli/src/commands/workflow.test.ts` (updated/added tests per Task 4)
- `packages/cli/src/adapters/cli-adapter.test.ts` (if a `silent` option is added, cover "no stdout, persistence still happens")
- Possibly a new `packages/cli/src/commands/workflow-command-contract.test.ts` or an extension of the existing contract-scan pattern (Task 4) — if added, follow the existing test-isolation rules in `packages/cli/package.json`.

Unexpected for this story:

- No `packages/core` changes.
- No `migrations` changes.
- No `packages/server` routes.
- No `packages/web` UI.
- No changes to `--detach` output shape.
- No changes to `workflow-provider-command-envelope.ts` (the shared builder from 3.3a).
- No edits to `_bmad-output/planning-artifacts/contracts/workflow-commander/` fixtures/schemas.

## References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 3.3b: Provide Archon Start And Status CLI JSON]
- [Source: _bmad-output/planning-artifacts/epics.md#Provider Command Syntax Baseline]
- [Source: _bmad-output/planning-artifacts/architecture.md#Provider Command Syntax Baseline]
- [Source: _bmad-output/planning-artifacts/architecture.md#Consistency Conventions]
- [Source: _bmad-output/planning-artifacts/prd.md#FR-8: Expose Provider Workflow Control Through CLI JSON]
- [Source: _bmad-output/planning-artifacts/contracts/workflow-commander/schemas/workflow-command-envelope.schema.json]
- [Source: _bmad-output/planning-artifacts/contracts/workflow-commander/examples/providers/archon/commands/start-success.json]
- [Source: _bmad-output/planning-artifacts/contracts/workflow-commander/examples/providers/archon/commands/status-success.json]
- [Source: _bmad-output/planning-artifacts/contracts/workflow-commander/examples/providers/archon/commands/error-*.json]
- [Source: _bmad-output/planning-artifacts/contracts/workflow-commander/README.md#Command Envelope Rules]
- [Source: _bmad-output/test-artifacts/test-design/test-design-3-3a-define-shared-workflow-provider-command-envelope.md#Waivers, W-3.3A-001]
- [Source: _bmad-output/implementation-artifacts/3-3a-define-shared-workflow-provider-command-envelope.md#Dev Notes]
- [Source: packages/cli/src/commands/workflow-provider-command-envelope.ts]
- [Source: packages/cli/src/commands/provider-binding.ts]
- [Source: packages/cli/src/commands/workflow.ts]
- [Source: packages/cli/src/commands/workflow.test.ts]
- [Source: packages/cli/src/cli.ts]
- [Source: packages/workflows/src/executor.ts]
- [Source: packages/workflows/src/schemas/workflow-run.ts]
- [Source: packages/cli/package.json]
- [Source: _bmad-output/project-context.md]

## Dev Agent Record

### Agent Model Used

### Debug Log References

### Completion Notes List

- **Fixture field-set delta (W-3.3B-002):** The illustrative fixtures `start-success.json` and `status-success.json` contain `phase` and `projectBindingRef` (start) / `phase` and `gateRef` (status) fields that are BMAD/Hermes-owned concepts excluded from Archon's scope by epics.md line 17. This story's runtime envelopes intentionally omit `phase` and `projectBindingRef` — no fake values are fabricated. The `gateRef` field IS emitted when a run is paused on an approval gate (matching the status fixture's `gateRef` shape). Contract test `3.3B-CONTRACT-037` explicitly asserts this delta. The `result` object is `"additionalProperties": true` in the schema, so omitting these fields requires no contract change.
- **Fix pass 1 (RF-01 through RF-08):** All 8 review findings addressed in a single fix pass. RF-01: guarded resume console.log with `if (!options.json)`. RF-02: removed `'failed to load'` from MALFORMED_REQUEST pattern, added `'is required'`. RF-03: reused command-level `issuedAt` in error envelope catch block instead of re-resolving. RF-04: restored non-JSON error message to `'Workflow name is required'`. RF-05: added `3.3B-UNIT-016b` test for paused interactive-loop JSON mode. RF-06: documented fixture field-set delta in these Completion Notes. RF-07: added `expect(envelope.success)` assertions and `getWorkflowRun` mocks to CONTRACT-036/037. RF-08: added isolated `ARCHON_HOME`/`DATABASE_URL` to E2E subprocess tests.
- **Fix pass 2 (RF-09 through RF-16):** All 8 second-review findings addressed. RF-09: moved `resolveCorrelationId`/`resolveIssuedAt` inside JSON-mode try/catch. RF-10: added `sanitizeEventsForEnvelope`/`stripForbiddenKeys` to strip contract-forbidden keys from verbose event data. RF-11: added `failure: { hasError: true }` to failed-run status without leaking raw error text. RF-12: added result-card persistence (`adapter.sendMessage`) to JSON success path. RF-13: moved flag validation before workflow resolution for JSON mode only. RF-14: guarded empty-name throw with `if (options.json)` to preserve non-JSON behavior. RF-15: narrowed `classifyRunError` 'not found' pattern to require 'Workflow' context. RF-16: removed `DATABASE_URL` from E2E child env (was incorrectly selecting Postgres).
- **Fix pass 3 (RF-17 through RF-22):** All 6 third-review findings addressed. RF-17: restructured `workflowGetCommand` to wrap JSON path in fail-closed try/catch (mirrors `workflowRunCommand` pattern), extracting `workflowGetCommandInner` for shared JSON/human logic. RF-18: changed JSON-mode result-card persistence to use platform `conversationId` instead of DB `conversation.id`, matching the non-JSON path. RF-19: changed failed status check from `run.status === 'failed' && run.metadata.error` to `run.status === 'failed'` with `hasError: Boolean(run.metadata.error)`, ensuring all failed runs get the failure shape. RF-20: replaced `classifyRunError` in the status DB error catch block with a fixed `INTERNAL_ERROR`/`implementation_defect`/70 classification, since DB error messages can contain both 'not found' and 'workflow' and be misclassified. RF-21: added verbose status forbidden-key regression test (CONTRACT-036 third test) that verifies event data with forbidden keys is properly sanitized. RF-22: added `'worktree.enabled'` pattern to `classifyRunError`'s MALFORMED_REQUEST check, so worktree-policy flag mismatch errors are correctly classified as user errors.
- **Fix pass 4 (RF-23 through RF-27):** All 5 fourth-review findings addressed. RF-23: added JSON envelope emission in `cli.ts` parseArgs catch block when `--json` is detected in `process.argv`, so parse-time failures (e.g., missing `--correlation-id` value) emit `MALFORMED_REQUEST` envelopes instead of plain-text errors. RF-24: added timeout detection (ETIMEDOUT code or 'statement timeout'/'timeout' message patterns) before the fixed INTERNAL_ERROR classification in `workflowGetCommandInner`'s DB error catch block, so timeouts emit `COMMAND_TIMEOUT`/`retryable: true`/exitCode 69. RF-25: enriched failed status envelope's `failure` shape with `errorType` field (`'execution_error'` when metadata.error present, `'unknown'` otherwise), providing machine-readable categorization without leaking raw error text. RF-26: added regression test verifying JSON mode persists result cards via `adapter.sendMessage` with `category: 'workflow_result'` and correct metadata. RF-27: added regression test verifying JSON mode classifies worktree-policy mismatches as `MALFORMED_REQUEST`/`provider_contract`/exitCode 64 envelopes.

### File List

- `packages/cli/src/commands/workflow.ts` — main implementation: `workflowRunCommand`, `workflowGetCommand`, `mapWorkflowRunToContractState`, `classifyRunError`, `buildWorkflowRunRef`, `sanitizeEventsForEnvelope`, `stripForbiddenKeys`
- `packages/cli/src/commands/workflow.test.ts` — unit tests including `3.3B-UNIT-016b` for paused interactive-loop, RF-26 result-card persistence, RF-27 worktree-policy mismatch
- `packages/cli/src/commands/workflow-command-contract.test.ts` — contract tests for start/status envelope shape
- `packages/cli/src/commands/workflow-json.e2e.test.ts` — E2E subprocess tests with isolated ARCHON_HOME/DATABASE_URL
- `packages/cli/src/adapters/cli-adapter.ts` — CLIAdapter `silent` mode (no changes needed — already supported)
- `packages/cli/src/cli.ts` — parseArgs catch block emits JSON envelope when --json detected (RF-23)
- `packages/cli/src/commands/workflow-provider-command-envelope.ts` — shared envelope builder from Story 3.3a (unchanged)

### Fix Pass Record

| Finding | Description                                       | Fix                                                             | Files                               |
| ------- | ------------------------------------------------- | --------------------------------------------------------------- | ----------------------------------- |
| RF-01   | Resume console.log corrupts JSON stdout           | Added `if (!options.json)` guard                                | `workflow.ts`                       |
| RF-02   | `'failed to load'` misclassifies resume errors    | Replaced with `'is required'` pattern                           | `workflow.ts`                       |
| RF-03   | Error envelope re-resolves `issuedAt`             | Reused command-level `issuedAt` variable                        | `workflow.ts`                       |
| RF-04   | Non-JSON error message changed                    | Restored to `'Workflow name is required'`                       | `workflow.ts`                       |
| RF-05   | Missing paused interactive-loop test              | Added `3.3B-UNIT-016b`                                          | `workflow.test.ts`                  |
| RF-06   | Fixture delta not documented                      | Added Completion Notes entry                                    | story file                          |
| RF-07   | Contract tests pass against error envelope        | Added `success` assertions + `getWorkflowRun` mocks             | `workflow-command-contract.test.ts` |
| RF-08   | E2E tests use ambient state                       | Added isolated `ARCHON_HOME`/`DATABASE_URL`                     | `workflow-json.e2e.test.ts`         |
| RF-09   | `--correlation-id` escape from fail-closed        | Moved `resolveCorrelationId`/`resolveIssuedAt` inside try/catch | `workflow.ts`                       |
| RF-10   | Verbose events embed forbidden keys               | Added `sanitizeEventsForEnvelope` with recursive stripping      | `workflow.ts`                       |
| RF-11   | Failed status lacks failure shape                 | Added `failure: { hasError: true }` (no raw text)               | `workflow.ts`                       |
| RF-12   | JSON start bypasses result-card persistence       | Added `adapter.sendMessage` in JSON success path                | `workflow.ts`                       |
| RF-13   | Bad-flag misclassified as lookup failure          | Moved flag validation before resolution (JSON mode)             | `workflow.ts`                       |
| RF-14   | Non-JSON blank name behavior changed              | Guarded name check with `if (options.json)`                     | `workflow.ts`                       |
| RF-15   | Generic 'not found' mislabels DB failures         | Narrowed pattern to require 'Workflow' context                  | `workflow.ts`                       |
| RF-16   | E2E tests DATABASE_URL selects Postgres           | Removed DATABASE_URL from child env                             | `workflow-json.e2e.test.ts`         |
| RF-17   | `workflowGetCommand` JSON path not fail-closed    | Restructured to wrap JSON path in try/catch, extracted inner    | `workflow.ts`                       |
| RF-18   | Result-card uses DB id instead of platform id     | Changed `conversation.id` to `conversationId` in JSON path      | `workflow.ts`                       |
| RF-19   | Failed status lacks failure shape without error   | Changed to `run.status === 'failed'` with `hasError: Boolean()` | `workflow.ts`                       |
| RF-20   | Status DB errors misclassified as not-found       | Replaced `classifyRunError` with fixed INTERNAL_ERROR           | `workflow.ts`                       |
| RF-21   | Verbose status forbidden-key test missing         | Added third CONTRACT-036 test for verbose events                | `workflow-command-contract.test.ts` |
| RF-22   | Worktree-policy errors classified as internal     | Added `'worktree.enabled'` to MALFORMED_REQUEST patterns        | `workflow.ts`                       |
| RF-23   | parseArgs failures escape JSON fail-closed        | Added JSON envelope emission in parseArgs catch block           | `cli.ts`                            |
| RF-24   | DB timeouts emitted as INTERNAL_ERROR             | Added timeout detection before fixed classification             | `workflow.ts`                       |
| RF-25   | Failed status lacks machine-readable failure info | Enriched failure shape with errorType field                     | `workflow.ts`                       |
| RF-26   | JSON result-card persistence untested             | Added regression test for workflow_result persistence           | `workflow.test.ts`                  |
| RF-27   | JSON worktree-policy mismatch untested            | Added regression test for MALFORMED_REQUEST classification      | `workflow.test.ts`                  |
