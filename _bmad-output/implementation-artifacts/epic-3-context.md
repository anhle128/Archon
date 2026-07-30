# Epic 3 Context: Workflow Provider Control and Event Delivery

<!-- Generated from planning artifacts. Regenerate with compile-epic-context if planning docs change. -->

## Goal

Epic 3 makes Archon the first workflow provider for the Hermes Agent Workflow Commander: external controllers (starting with Hermes) bind projects/codebases to Archon, drive workflow runs entirely through parseable CLI JSON, receive signed typed workflow events through a non-blocking outbox without ever blocking workflow execution, and query event delivery health. This is a producer-only, headless slice with no Archon Web UI and none of the Hermes-owned concerns (Project Binding, materialization, gates, reconciliation, diagnostics, user interaction). Every story is gated by a local JSON-schema contract package that must validate before implementation can start or be considered complete.

## Stories

- Story 3.1: Implement Archon Workflow Provider Binding Lifecycle
- Story 3.3a: Define Shared Workflow Provider Command Envelope
- Story 3.3b: Provide Archon Start And Status CLI JSON
- Story 3.3c: Provide Archon Provider Decision Command CLI JSON (approve/reject)
- Story 3.3d: Provide Archon Recovery Command CLI JSON (resume/retry/cancel)
- Story 3.5: Produce Signed Typed Archon Workflow Events From Outbox
- Story 3.7: Expose Archon Workflow Event Delivery Health

## Requirements & Constraints

- Every provider-facing surface uses generic `provider`/`name` controller identity — never Hermes-specific fields like `profile`, `agent`, `agent_name`, `agent_provider`.
- No story adds Archon Web UI, workflow builder screens, or a state-changing HTTP control path; CLI JSON is the only control surface for Workflow Commander v1.
- A story is not implementation-ready, and must not be completed, unless `python3 _bmad-output/planning-artifacts/contracts/workflow-commander/validate_contracts.py` passes and the fields it needs exist in the validated local contract package — never invent contract fields ahead of the schema.
- Event delivery failure must never block or roll back workflow execution; every event/delivery story must prove this.
- Any story persisting provider-binding, outbox, or delivery-status data must include the migration location plus SQLite and PostgreSQL adapter behavior, with focused tests for both backends when SQL semantics differ.
- Every CLI JSON producer story must exercise success and failure examples drawn from the local contract package.
- Story 3.1 and 3.5 are umbrella IDs whose named task gates are independently accepted implementation slices, never one undifferentiated patch; a later task's failure must not invalidate an already-accepted earlier task.

## Technical Decisions

**Shared command envelope (3.3a, consumed by 3.1/3.3b/3.3c/3.3d):** every result carries `schemaVersion`, `success`, `correlationId`, `workflowRunRef` (when applicable), `bindingRef` (when applicable), and a result payload; failures carry `code`, a diagnostic `category`, boolean `retryable`, and structured `details` — never raw stack traces or prose. Canonical `command` values (`workflow.start/status/approve/reject/resume/retry/cancel`, `binding.create/update/status/rotate/disable`) must match the fixed CLI syntax exactly. Archon only envelopes errors it catches before responding; the external consumer classifies its own empty/uncatchable-exit observation as `UNEXPECTED_EXIT`, malformed/schema-invalid output as `SCHEMA_MISMATCH`, and its own enforced timeout as `TIMEOUT` — Archon adds no supervisor for its own process.

**Recovery semantics (3.3d):** `workflow.resume` is validate-only — confirms resumability, returns the unchanged current state, `executed: false`; never dispatches execution or mutates the run. `workflow.retry` (whole-run or `--node`) returns success immediately after spawning a **detached** worker (`dispatched: true`, `detached: true`); the parent never waits for claim/validation/execution, and the worker exposes outcomes only via status/events/logs. `workflow.cancel` returns success immediately once the durable compare-and-swap to `cancelled` wins (`terminal: true`); it never reports pre-transition state or waits for quiescence/cleanup. Parent error mapping: `MALFORMED_REQUEST` (exit 64), `UNEXPECTED_STATE` (exit 78, missing/ineligible run or lost CAS), `COMMAND_TIMEOUT` (exit 69, retryable), `INTERNAL_ERROR` (exit 70). New `workflow retry`/`workflow cancel` spellings are JSON-only; legacy `retry-node`/`abandon` stay unchanged for non-JSON callers.

**Provider binding (3.1):** states are missing, valid, stale, disabled, rotated, conflicting. `binding.create` fails closed rather than silently upserting; `binding.update` is the only mutation path for an existing binding. There is no binding-remove command in v1 — use `binding.disable` to stop routing while preserving audit history. Rotation replaces the binding's signing secret and increments `binding_version`; raw secrets never appear in projections, CLI JSON, API responses, event bodies, or logs.

**Signed event outbox (3.5):** reuses Hermes Generic Webhook V2 exactly — HMAC-SHA256 over `timestamp + "." + exactRawBodyBytes`, sent as `X-Webhook-Signature-V2` + `X-Webhook-Timestamp` (Hermes owns the 300s replay window; no new signing scheme). `signing_secret` is a nullable plaintext column on the binding row (no encryption, no secret-ref table). Only the `archon serve` process runs the delivery poller (drains at boot, polls an interval, no overlapping drains); CLI/detached/chat/server paths only enqueue, best-effort and non-transactional — enqueue failure never rolls back the workflow transition (delivery is at-least-once). Canonical external event types are `workflow.run.started/completed/failed`, `workflow.approval.requested`, `workflow.delivery.failed`, `workflow.artifact.recorded`; internal snake_case timeline events map to these only at outbox-production time, and `workflow.delivery.failed` has one recursion guard (it never re-enqueues itself). The idempotency key is `archon:<bindingName>:<eventId>`, minted once at enqueue, unchanged across redelivery, sent as `X-Request-ID`. `projectRef` is built directly from the registered codebase (`id`, `name`, `default_cwd`, `default_branch`); folder projects with no `repository_url` are still routable via `default_cwd`. Archon never compares binding versions or detects staleness — routable means the binding is `active` or `rotated` with a route and secret present. External events live in a new `remote_agent_workflow_event_outbox` table with their own event IDs, separate from the existing internal `remote_agent_workflow_events` timeline; event bodies carry no `delivery` object, no `intendedProducer`/`intendedConsumer`/`owningSubproject` fields, and no persisted command-correlation ID (3.7 supplies/echoes a correlation ID at query time). Retry policy is 8 attempts total with fixed backoff of 1/2/4/8/16/32/60 minutes before `terminal-failure`; every HTTP attempt is recorded append-only (request/response snapshot) with the pending-attempt row inserted before the HTTP call is made.

**Delivery health (3.7):** a read-only projection over 3.5's persisted state — it never writes delivery attempts and never opens a second delivery-status write path. Canonical status values are `healthy`, `delayed`, `retrying`, `failed`, `duplicated`, `terminal-failure`, `reconciliation-pending`, and every response keeps `blockingWorkflowExecution: false`.

## Cross-Story Dependencies

- Story 3.1 depends on parent Story 1.3a and blocks Hermes Story 3.2.
- Story 3.3a depends on Story 3.1 and gates 3.3b/3.3c/3.3d (the shared envelope must exist first); it indirectly blocks Hermes Story 3.4a via 3.3b.
- Story 3.3b depends on 3.1 + 3.3a. Story 3.3c depends on 3.1 + 3.3a + 3.3b. Story 3.3d depends on 3.1 + 3.3a + 3.3b — each layers on the prior CLI JSON surface.
- Story 3.5 depends on parent Story 1.3b plus Stories 3.1, 3.3a, and 3.3b; it is the sole owner of delivery-state writes and migrations, and feeds Story 3.7.
- Story 3.7 depends on Story 3.1 and on Story 3.5's persisted delivery state (read-only; no new migrations of its own).
- Downstream `hermes-agent` stories (3.2, 3.4a/b/c, 3.6a-c, 3.8) consume these producer surfaces but are out of scope for Archon implementation.
