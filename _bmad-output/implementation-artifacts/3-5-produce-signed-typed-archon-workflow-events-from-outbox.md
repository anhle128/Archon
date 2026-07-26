# Story 3.5: Produce Signed Typed Archon Workflow Events From Outbox

Status: done

<!-- Note: Create Mode leaves this story in draft. Promotion to ready-for-dev requires a separate, independent validation pass before dev-story. -->

## Story

As a workflow operator,
I want provider `archon` to emit workflow events through a signed typed event outbox,
so that workflow execution remains independent while Hermes receives compatible event notifications.

## Acceptance Criteria

1. **Non-blocking outbox write.** Given Archon emits a workflow event for a bound project or codebase, when the event is eligible for notification, then Archon writes the event to a non-blocking event outbox, and Archon workflow execution continues even if workflow event delivery later fails.
2. **Not-routable recording.** Given Archon prepares a workflow event for a project or codebase with a missing or disabled Workflow Provider Binding, when the event would otherwise be queued or delivered, then Archon records a machine-readable not-routable status, and Archon does not attempt HTTP delivery to a disabled or non-existent route. (Binding-version staleness detection is explicitly out of scope — see TD-11.)
3. **Envelope completeness.** Given Archon prepares a workflow event payload for delivery, when the payload is serialized, then it includes schema version, event id, event type, occurred timestamp, provider binding reference, workflow run reference, project or codebase reference, and idempotency key, and it matches the shared workflow event envelope example. (Signature metadata travels in HTTP headers per TD-01, not in the JSON body — see Canonical Artifact Reconciliation.)
4. **Delivery-status persistence.** Given workflow event delivery fails, retries, or reaches terminal failure, when Archon records delivery status, then it persists retry state, last attempt time, last error category, terminal failure state when applicable, and the affected workflow run reference, and it keeps workflow execution independent from workflow event delivery success.
5. **Duplicate-safe idempotency.** Given Archon emits duplicate or retried workflow event delivery attempts, when events are delivered, then each payload carries stable event id and idempotency key values, and consumers can detect duplicate-safe delivery from those fields (byte-identical body across attempts; only HTTP timestamp/signature headers change).

## Approved Technical Decisions

Source: `_bmad-output/planning-artifacts/story-decisions/3-5-produce-signed-typed-archon-workflow-events-from-outbox/technical-decisions.md` — gate `PASS`, `reviewStatus: APPROVED`, 0 unresolved decisions. Also embedded at `_bmad-output/planning-artifacts/epics.md:360-488`.

| Decision | Implementation responsibility                                                                                                                                                                                                                                                                                                                                                          | Required executable proof                                                                                                                                      |
| -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| TD-01    | Sign every outbound POST with HMAC-SHA256 over `timestamp + "." + exactRawBodyBytes`, lowercase hex, header `X-Webhook-Signature-V2`; `X-Webhook-Timestamp` = Unix seconds. No body-level signature object.                                                                                                                                                                            | Independent HMAC recomputation proves valid/tampered/wrong-secret/stale-timestamp outcomes (Proof Sketch #3).                                                  |
| TD-02    | Add nullable `signing_secret TEXT` to `remote_agent_workflow_provider_bindings`; excluded from all projections/CLI JSON/API responses/logs.                                                                                                                                                                                                                                            | `validate_contracts.py`'s `check_no_raw_secrets()` stays green; binding read-path unit test asserts the field never serializes.                                |
| TD-03    | Only `archon serve` dispatches. One in-process poller: immediate drain at boot, interval poll, no overlapping drains. CLI/detached/chat/server paths only enqueue.                                                                                                                                                                                                                     | Poller unit tests (overlap guard, boot drain) + E2E boot-order assertion.                                                                                      |
| TD-04    | External enqueue is best-effort, non-throwing, non-transactional with the workflow state transition.                                                                                                                                                                                                                                                                                   | Force enqueue failure; assert workflow start/pause/complete/fail unaffected (Proof Sketch #4).                                                                 |
| TD-05    | `workflow.delivery.failed` has one recursion guard: failure to deliver a `workflow.delivery.failed` event updates only its own attempt/retry state, never enqueues another failure event.                                                                                                                                                                                              | Force a delivery-failed event to itself fail delivery; assert no second failure event (Proof Sketch #11).                                                      |
| TD-06    | Canonical external vocabulary: `workflow.run.started`, `workflow.run.completed`, `workflow.run.failed`, `workflow.approval.requested`, `workflow.delivery.failed`, `workflow.artifact.recorded`.                                                                                                                                                                                       | Fixture/schema audit — no bare `workflow.completed`/`workflow.failed` form survives.                                                                           |
| TD-07    | Idempotency key = `archon:<bindingName>:<eventId>`, created once at enqueue, persisted, reused unchanged across every attempt, sent as `X-Request-ID`.                                                                                                                                                                                                                                 | Redelivery proof asserts identical key across attempts (Proof Sketch #9).                                                                                      |
| TD-08    | Map internal `workflow_started` to `workflow.run.started`. Start payload has no fabricated `phase`/`commandCorrelationId`.                                                                                                                                                                                                                                                             | Payload schema test rejects `phase`/`commandCorrelationId` on the started payload.                                                                             |
| TD-09    | `workflow.approval.requested.payload.approval.phase` = the workflow node ID/name currently awaiting review (generic field name kept, meaning changed). Started event emits no `phase`.                                                                                                                                                                                                 | Fixture value reads as a node identifier, not a BMAD phase label.                                                                                              |
| TD-10    | `projectRef` built directly from the registered codebase: `id`=`codebase.id`, `codebaseRef`=`codebase.name`, `repositoryPath`=`codebase.default_cwd`, optional `defaultBranch`=`codebase.default_branch`. `bindingRef.projectRef`/`workflowRunRef.projectRef` stay the existing string form `project:<codebase.id>`. Folder projects (`kind:'folder'`) are routable via `default_cwd`. | Unit test builds `projectRef` from a real `Codebase` row for both `kind:'repo'` and `kind:'folder'`.                                                           |
| TD-11    | No binding-version comparison or staleness detection in this story. A binding is not routable when missing, disabled, wrong codebase, or lacking route/secret. Both `active` and `rotated` are routable.                                                                                                                                                                               | Routing matrix test: missing/disabled/wrong-codebase/no-route/no-secret → not-routable; active/rotated → routable (Proof Sketch #5).                           |
| TD-12    | Separate external outbox (`remote_agent_workflow_event_outbox`) from the existing internal `remote_agent_workflow_events` timeline; independent event IDs; sites best-effort write both independently.                                                                                                                                                                                 | Drive a run through started/approval/completed/failed; assert internal timeline unchanged and only the accepted mappings create outbox rows (Proof Sketch #1). |
| TD-13    | No `delivery` object in the event body. Every attempt sends the exact same serialized body; only HTTP headers change. Attempt identity/timing/outcome live in the delivery-attempt history.                                                                                                                                                                                            | Redelivery proof: byte-identical body, new attempt row, new headers (Proof Sketch #9).                                                                         |
| TD-14    | Remove `intendedProducer`/`intendedConsumer`/`owningSubproject` from the event schema, runtime body, and fixtures (command envelopes from 3.3a-d are unaffected).                                                                                                                                                                                                                      | Schema `additionalProperties:false` audit.                                                                                                                     |
| TD-15    | Story 3.5 persists no command correlation ID on runs, event bodies, outbox rows, or attempt rows. `correlationId` on the delivery-status projection belongs to Story 3.7's query layer, not persisted event state.                                                                                                                                                                     | Code review / grep: no correlation-id column or field on outbox/attempt tables.                                                                                |
| TD-16    | 8 attempts, deterministic backoff (1, 2, 4, 8, 16, 32, 60 minutes after failures 1-7; failure 8 = terminal), append-only `remote_agent_workflow_event_delivery_attempts` with full request/response snapshot per attempt, pending-before-HTTP insert ordering.                                                                                                                         | Fake-clock schedule proof (Proof Sketch #8) + attempt-history insert-failure proof (Proof Sketch #7).                                                          |

## Approved Changed-File Surface

Frozen per SPG-03 (Story Proof Guardrails — scope/ownership drift). Any expansion beyond this list requires an explicit decision amendment, not an in-flight addition.

**In scope:**

- `migrations/000_combined.sql` — 2 new tables, 1 new column (ALTER).
- `packages/core/src/db/adapters/sqlite.ts` — SQLite twins of the above (`createSchema()` + `migrateColumns()`).
- `packages/core/src/schemas/workflow-event-outbox.ts`, `workflow-event-delivery-attempt.ts` (new) + `index.ts` re-export.
- `packages/core/src/db/workflow-event-outbox.ts` (new) — enqueue, claim-due, record-attempt, update-status.
- `packages/core/src/db/provider-bindings.ts` — new `getBindingByCodebase()` query.
- `packages/core/src/events/workflow-event-envelope.ts` (new) — pure envelope-body builder.
- `packages/core/src/events/binding-router.ts` (new) — routability resolution (`resolveEventRoute`), called from `store-adapter.ts` at enqueue time.
- `packages/workflows/src/store.ts` — extend `IWorkflowStore` with `enqueueExternalWorkflowEvent()`.
- `packages/core/src/workflows/store-adapter.ts` — implement it; extend `createWorkflowEvent`'s wrapper to also enqueue for the 3 always-paired mapped types.
- `packages/workflows/src/executor.ts`, `packages/workflows/src/dag-executor.ts` — 3 new direct `enqueueExternalWorkflowEvent()` calls for `workflow.run.failed` coverage (see Explicit Boundary and Deferral Record).
- `packages/server/src/workflow-events/` (new directory) — `dispatcher.ts` (poller), `hermes-signer.ts` (HMAC). Reads already-resolved routes off outbox rows; does not re-resolve bindings (see `binding-router.ts` above).
- `packages/server/src/index.ts` — wire poller start after `startCleanupScheduler()`.
- Contract package `_bmad-output/planning-artifacts/contracts/workflow-commander/` — schema, fixtures, `validate_contracts.py`, `README.md` reconciliation (Task 1).
- `_bmad-output/planning-artifacts/epics.md` — remove "stale" from Story 3.5's AC prose per TD-11 (already reflected in AC #2 above; source doc still needs the matching edit — see References).
- `_bmad-output/planning-artifacts/prd.md` — FR-9 wording must include the started event, per TD-08's explicit "Contract update: FR-9, acceptance criteria, schema, and fixture prose must include the started event consistently." Current FR-9 text (`prd.md:69`) lists only "workflow completion, workflow failure, approval requested, delivery failed, and artifact events" — add "workflow start" to that list.
- Focused unit, contract, and E2E tests for every file above.

**Explicitly excluded / deferred:**

- Hermes event ingress, reconciliation, Project Work Item/Phase Task/gate mutation, user-facing diagnostics (epics.md scope boundary).
- Story 3.7's delivery-health read projection and its CLI surface.
- Fixing the pre-existing gap where DAG node-failure paths never write an internal `remote_agent_workflow_events` row (out of this story's ownership — Story 3.5 owns the external outbox, not internal-timeline completeness; see Explicit Boundary and Deferral Record).
- `workflow.artifact.recorded` producer wiring (no existing trigger point exists anywhere in the codebase — see Explicit Boundary and Deferral Record).
- Binding-version comparison / staleness detection (TD-11).

## Tasks / Subtasks

- [x] **Slice 1: Event-envelope construction + contract reconciliation** (AC: #3)
  - [x] Edit `schemas/workflow-event-envelope.schema.json`: remove `intendedProducer`/`intendedConsumer`/`owningSubproject`/`profileRoute`/`signature`/`delivery` from root `required`+`properties`+`$defs`; remove `projectBindingId` from `$defs/projectRef`; remove `phase`/`commandCorrelationId` from `$defs/workflowRunStartedPayload.required`. Target root `required`: `["schemaVersion","provider","eventId","eventType","occurredAt","bindingRef","workflowRunRef","projectRef","idempotencyKey","payload"]`. Keep `schemaVersion` const at `"workflow-event-envelope.v1"` (no version bump — pre-implementation correction).
  - [x] Update all 13 event/rejection fixtures under `examples/providers/archon/events/`, `examples/workflow-events/`, `examples/callback-rejections/` per the reconciliation report's per-file edit list (strip removed fields, fix `codebaseRef` to a plain codebase name, drop `projectRef.projectBindingId`, fix `approval.phase` to read as a node identifier).
  - [x] Fix all 7 `examples/providers/archon/delivery/*.json` fixtures: `eventRef.eventType` → `workflow.run.completed`; `eventRef.idempotencyKey` → `archon:<bindingName>:<eventId>` format.
  - [x] Rename `wrong-profile-secret.json` → `wrong-signing-secret.json`; redefine as "signature doesn't verify against the binding's currently-stored `signing_secret`" (no more profile concept per TD-02); update `validate_contracts.py`'s `REJECTION_REASONS`/`REQUIRED_REJECTION_EXAMPLES` and `epics.md:327`'s integration-validation prose to match.
  - [x] Keep `workflow-completed-redelivery.json` (both copies) as a byte-identical duplicate of `workflow-completed.json`; update `README.md`'s "Workflow Event Envelope Rules" prose to state explicitly that redelivery bodies are byte-identical and only HTTP headers differ (documents TD-13/TD-16 rather than inventing a body-level diff).
  - [x] Update `validate_contracts.py`: split event validation off the shared `METADATA_FIELDS`/`check_metadata()` (events now require only `schemaVersion`, not the 3 removed party fields — command/binding/delivery-status/rejection/materialization fixtures keep all 4); drop `profileRoute`/`signature` from `validate_event()`'s required set; delete `validate_profile_route_shape()`, `validate_signature_policy()`, `DEFERRED_SIGNATURE_POLICY`; update `PAYLOAD_REQUIRED_FIELDS['workflow.run.started']` to `{'state','startedAt'}`; rewrite `is_valid_redelivery()` to assert byte-identical bodies (drop the `delivery.attempt`/`delivery.deliveryId` comparison, which no longer exists) and drop `'profileRoute'` from its field-equality list; fix `schema-mismatch.json`'s `rejectionEvidence.missingRequiredFields` (drop `"signature"`, it's no longer a schema field).
  - [x] Run `python3 _bmad-output/planning-artifacts/contracts/workflow-commander/validate_contracts.py` — must pass before any runtime code lands (epics.md blocking-behavior requirement).
  - [x] Add "workflow start" to `prd.md:69`'s FR-9 event list, per TD-08's explicit contract-update requirement (see Approved Changed-File Surface).
  - [x] Implement `packages/core/src/events/workflow-event-envelope.ts`: pure function `buildWorkflowEventEnvelope(input)` taking already-resolved `{ run, codebase, binding, eventType, payload }` and returning the 10-field envelope body per the reconciled schema. Small inline `project:<codebase.id>` string helper for the nested `bindingRef.projectRef`/`workflowRunRef.projectRef` fields — do not import `packages/cli/src/commands/workflow.ts`'s `buildWorkflowRunRef()` across the package boundary; the 1-line template is fine to duplicate (rule-of-three). **Only `store-adapter.ts` (packages/core) calls this builder** — see Slice 2's package-boundary note; `packages/workflows` never sees a `Codebase`/`Binding` object.
  - [x] Unit tests: envelope builder produces schema-valid output for all 5 producible event types (started/completed/failed/approval-requested/delivery-failed — not artifact-recorded, deferred); `projectRef` correct for both `kind:'repo'` and `kind:'folder'` codebases.

- [x] **Slice 2: Durable enqueue (outbox persistence)** (AC: #1, #3)
  - [x] `migrations/000_combined.sql`: add Table (next number after 11) `remote_agent_workflow_event_outbox` as `CREATE TABLE IF NOT EXISTS`, following the Table 11 header-comment/index/`COMMENT ON` pattern (`migrations/000_combined.sql:593-621`). Columns: `id UUID PK`, `event_id TEXT UNIQUE NOT NULL`, `idempotency_key TEXT NOT NULL`, `event_type TEXT NOT NULL`, `provider TEXT NOT NULL DEFAULT 'archon'`, `workflow_run_id UUID NOT NULL REFERENCES remote_agent_workflow_runs(id)`, `codebase_id UUID NULL REFERENCES remote_agent_codebases(id)`, `binding_id UUID NULL REFERENCES remote_agent_workflow_provider_bindings(id)`, `event_route TEXT NULL` (snapshot at enqueue time, not re-resolved live), `event_body TEXT NOT NULL` (exact serialized JSON string, never re-serialized — this is what TD-01's HMAC signs over and TD-16 requires byte-stable across attempts), `status TEXT NOT NULL DEFAULT 'pending'` (`pending`/`retrying`/`delivered`/`terminal-failure`/`not-routable`), `not_routable_reason TEXT NULL`, `attempt_count INTEGER NOT NULL DEFAULT 0`, `last_attempt_at TIMESTAMPTZ NULL`, `next_attempt_at TIMESTAMPTZ NULL`, `last_error TEXT NULL`, `created_at`/`updated_at TIMESTAMPTZ DEFAULT NOW()`. Index on `(status, next_attempt_at)` for the poller's due-query, index on `workflow_run_id`.
  - [x] Same migration file: add `ALTER TABLE remote_agent_workflow_provider_bindings ADD COLUMN IF NOT EXISTS signing_secret TEXT` in the "Idempotent ALTER statements" section (`migrations/000_combined.sql:369-524`), following the `default_model` precedent at lines 518-523 (comment explaining why the ALTER is needed even though a fresh CREATE TABLE would already have it).
  - [x] `packages/core/src/db/adapters/sqlite.ts`: mirror the new table in `createSchema()` (append after the provider-bindings block at `sqlite.ts:661-677`, SQLite types — `TEXT` PKs via `lower(hex(randomblob(16)))`, `INTEGER` where Postgres uses `TIMESTAMPTZ` is not applicable here since all outbox timestamp columns can stay `TEXT` ISO-8601 matching the rest of the SQLite schema). Add the new `signing_secret` column to the provider-bindings CREATE TABLE block AND to `migrateColumns()` (`sqlite.ts:183-385`) via the `default_model` precedent (`sqlite.ts:333-343`) — required for pre-existing SQLite DBs where `CREATE TABLE IF NOT EXISTS` is a no-op.
  - [x] `packages/core/src/schemas/workflow-event-outbox.ts`: Zod row schema mirroring the table exactly, `status` as `z.enum([...])`, timestamps as `z.union([z.date(), z.string()])` (Postgres `Date` vs SQLite string, per the `workflow-provider-binding.ts:5-7` precedent). Re-export from `packages/core/src/schemas/index.ts`.
  - [x] `packages/core/src/db/workflow-event-outbox.ts`: `enqueueExternalWorkflowEvent(data)` — throwing low-level insert, wrapped in a non-throwing outer function mirroring `createWorkflowEvent` exactly (`packages/core/src/db/workflow-events.ts:107-117`: try/catch + `getLog().error(...)`, never rethrow). Module JSDoc states the same non-throwing contract.
  - [x] **Package-boundary rule for `IWorkflowStore.enqueueExternalWorkflowEvent(data)`'s `data` parameter**: it MUST stay primitive-only — `{ workflow_run_id: string, event_type: string, occurred_at: string, payload: Record<string, unknown> }` — mirroring `createWorkflowEvent`'s existing primitive-only signature (`packages/workflows/src/store.ts:191-197`) exactly. `packages/workflows` (`executor.ts`/`dag-executor.ts`) NEVER resolves or passes a `Codebase`/`WorkflowProviderBinding` object — those types live in `@archon/core` and `packages/workflows` must not import them. All codebase/binding resolution and envelope construction (calling Slice 1's `buildWorkflowEventEnvelope`) happens entirely inside `packages/core/src/workflows/store-adapter.ts`'s implementation of this interface method, which is free to import `@archon/core` DB modules.
  - [x] `packages/workflows/src/store.ts`: add `enqueueExternalWorkflowEvent(data): Promise<void>` to `IWorkflowStore` with the primitive-only signature above, and the same "MUST NOT throw" doc comment as `createWorkflowEvent` (found immediately preceding that method's signature).
  - [x] `packages/core/src/workflows/store-adapter.ts`: implement the new interface method — resolves the `WorkflowRun` (for `codebase_id`), the `Codebase` (`getCodebase`), and the binding/routability (Slice 3's `resolveEventRoute`) internally, then calls `buildWorkflowEventEnvelope` and the DB module's enqueue function, wrapped in the same second-layer try/catch as the existing `createWorkflowEvent` wrapper at `store-adapter.ts:65-76`.
  - [x] Enqueue-before-delivery test: assert the outbox row exists and `status IN ('pending','not-routable')` immediately after enqueue returns, with zero delivery attempts recorded.
  - [x] Focused SQLite AND PostgreSQL tests for the new table/column (per CLAUDE.md's cross-backend rule for outbox/binding schema).

- [x] **Slice 3: Binding-aware routing** (AC: #2)
  - [x] `packages/core/src/db/provider-bindings.ts`: add `getBindingByCodebase(provider, codebaseId)` — `SELECT * FROM remote_agent_workflow_provider_bindings WHERE provider = $1 AND codebase_id = $2` (the existing `idx_provider_bindings_codebase` index already covers this, no new index needed). **The table's only uniqueness constraint is `UNIQUE(provider, name)`, not `codebase_id`** — a second binding (different `name`) can technically point at the same codebase, so this query can return more than one row. Return the full row set (not `.rows[0]`); resolution/conflict handling is the caller's job (next bullet).
  - [x] `packages/core/src/events/binding-router.ts` (new — **not** `packages/server`; `store-adapter.ts` calls this at enqueue time and `packages/core` cannot depend on `packages/server`): `resolveEventRoute(codebaseId)` — resolves the codebase (`getCodebase`, `packages/core/src/db/codebases.ts:46-51`) and calls `getBindingByCodebase('archon', codebaseId)`. Result: zero rows → not-routable (`missing-binding`); exactly one row → check `state IN ('active','rotated')` AND `event_route` non-empty AND `signing_secret` non-null, else not-routable (`binding-disabled` / `missing-route` / `missing-secret`), else routable with `{ binding, route, secret }`; **more than one row → not-routable (`binding-conflicting`)** — do not pick arbitrarily. This mirrors the existing binding-status vocabulary already established in the contract fixtures (`examples/providers/archon/bindings/status-conflicting.json`), so `binding-conflicting` is a recognized concept, not a new invention. No version comparison, no `stale` state (TD-11). Routability is resolved **once, at enqueue time**, and the winning `event_route` is snapshotted onto the outbox row (Slice 2) — the dispatcher (Slice 4, `packages/server`) never re-resolves a binding; it only reads the already-snapshotted route off the outbox row.
  - [x] Wire routing resolution into the enqueue path (Slice 2's `enqueueExternalWorkflowEvent`): when not-routable, persist `status: 'not-routable'`, `not_routable_reason: <reason>`, `binding_id: null`, and skip attempt scheduling entirely (`next_attempt_at: null`) — matches AC #2's "does not deliver... to a disabled route" without ever queuing a retryable attempt.
  - [x] Routing matrix test (Proof Sketch #5): missing codebase, missing binding, disabled binding, wrong-codebase binding, missing route, missing secret, **two active `archon` bindings on the same codebase** → all not-routable with the correct reason; active binding and rotated binding → both routable, no version comparison performed.

- [x] **Slice 4: Delivery-state writer + poller + HMAC signer** (AC: #1, #4)
  - [x] `migrations/000_combined.sql`: add `remote_agent_workflow_event_delivery_attempts` (append-only) — `id UUID PK`, `outbox_event_id UUID NOT NULL REFERENCES remote_agent_workflow_event_outbox(id)`, `attempt_number INTEGER NOT NULL`, `request_url TEXT NOT NULL`, `request_method TEXT NOT NULL DEFAULT 'POST'`, `request_headers TEXT NOT NULL`, `request_body TEXT NOT NULL`, `response_status INTEGER NULL`, `response_headers TEXT NULL`, `response_body TEXT NULL`, `transport_error TEXT NULL`, `started_at TIMESTAMPTZ NOT NULL`, `completed_at TIMESTAMPTZ NULL`, `duration_ms INTEGER NULL`, `outcome TEXT NOT NULL DEFAULT 'pending'` (`pending`/`succeeded`/`failed`). Index on `outbox_event_id`. Same SQLite mirror treatment as Slice 2.
  - [x] `packages/core/src/schemas/workflow-event-delivery-attempt.ts`: Zod row schema, re-exported from `index.ts`.
  - [x] `packages/core/src/db/workflow-event-outbox.ts` additions: `claimDueOutboxEvents(limit)` (`SELECT ... WHERE status IN ('pending','retrying') AND next_attempt_at <= now() ORDER BY next_attempt_at ASC LIMIT $1`), `insertPendingAttempt(outboxEventId, attemptNumber, request)` (insert with `outcome:'pending'` BEFORE the HTTP call — per TD-16's "History invariant: the dispatcher inserts the pending attempt before issuing HTTP; if that insert fails, it sends no webhook and leaves the outbox row eligible for a later drain"), `completeAttempt(attemptId, response|transportError, outcome)`, `updateOutboxAfterAttempt(outboxEventId, {status, attempt_count, last_attempt_at, next_attempt_at, last_error})`. All mutations use the UPDATE-then-SELECT pattern (no `RETURNING` on UPDATE) per `packages/core/src/db/adapters/sqlite.ts:85-92` and the `provider-bindings.ts`/`workflows.ts:686-691` precedent.
  - [x] `packages/server/src/workflow-events/hermes-signer.ts` (new): `signHermesV2(secret, timestampSeconds, rawBody)` → `{ signature, timestamp }` using `createHmac('sha256', secret).update(`${timestampSeconds}.${rawBody}`).digest('hex')` (same Node `crypto` primitive already used for inbound verification at `packages/adapters/src/forge/github/adapter.ts:6,438-439`, `timingSafeEqual` not needed on the producer side — only the digest half applies).
  - [x] `packages/server/src/workflow-events/dispatcher.ts` (new): the poller. Combine `DashboardEventPoller`'s overlap guard (`draining`/`redrainRequested` booleans, `packages/server/src/adapters/web/dashboard-event-poller.ts:47-48,79-86`) with `startCleanupScheduler`'s immediate-then-interval boot shape (`packages/core/src/services/cleanup-service.ts:851-859`: `void drainOnce().catch(...)` then `setInterval(...)`, `.unref()`'d). Per due event: `insertPendingAttempt` → build headers via `signHermesV2` with the event's stored `event_body` (never re-serialized) and current wall-clock timestamp → `fetch(event.event_route, { method:'POST', headers: {'X-Webhook-Signature-V2':..., 'X-Webhook-Timestamp':..., 'X-Request-ID': event.idempotency_key, 'Content-Type':'application/json'}, body: event.event_body })` (raw `fetch()` + manual handling, following the Gitea/GitLab pattern at `packages/adapters/src/community/forge/gitea/adapter.ts:164-210` rather than Octokit) → `completeAttempt` + `updateOutboxAfterAttempt` with the TD-16 backoff schedule (`[1,2,4,8,16,32,60]` minutes for attempts 1-7 failing, attempt 8 failing → `terminal-failure`) → on terminal-failure or any failed attempt, enqueue `workflow.delivery.failed` via `enqueueExternalWorkflowEvent` UNLESS the failed event's own `event_type` is already `workflow.delivery.failed` (TD-05 single recursion guard — check before enqueueing, not after).
  - [x] `packages/server/src/index.ts`: start the dispatcher immediately after `startCleanupScheduler()` (`index.ts:319`), before `Bun.serve()` binds (`index.ts:940`) — same "background service init" block as the two existing pollers. Stop it alongside `dashboardPoller.stop()` at shutdown (`index.ts:1009` area).
  - [x] Attempt-history insert-failure test (Proof Sketch #7): force `insertPendingAttempt` to fail; assert no HTTP request is made (mock `fetch` and assert zero calls) and the outbox row stays eligible for a later drain.
  - [x] Fake-clock backoff schedule test (Proof Sketch #8): advance through failures 1-8, assert exact delay sequence and terminal state on attempt 8, and that the schedule persists correctly across a simulated server restart (reload from DB, not in-memory state).
  - [x] TD-05 recursion-guard test (Proof Sketch #11): force a `workflow.delivery.failed` event's own delivery to fail; assert only its own attempt/retry state updates, no second `workflow.delivery.failed` event is enqueued.

- [x] **Slice 5: Retry and idempotency proofs** (AC: #5)
  - [x] Redelivery test (Proof Sketch #9): redeliver a `delivered`-then-forced-retry event; assert `event_body`, `event_id`, `idempotency_key` are byte-for-byte identical across the original and redelivered attempt rows, while `X-Webhook-Timestamp`/`X-Webhook-Signature-V2` headers and the attempt row are new.
  - [x] Crash-recovery duplicate-safety test (Proof Sketch #10): simulate a dispatcher crash after `insertPendingAttempt` succeeds but before `completeAttempt` runs (attempt stays `outcome:'pending'` indefinitely); restart the poller; assert it does not double-send for that logical event without an explicit reconciliation pass (the `pending`-forever attempt is a known, accepted limitation — TD-04's "accepted limitation" language — document this as the observed behavior, not a claimed fix).
  - [x] Full event-lifecycle integration test (Proof Sketch #1): drive a registered-codebase workflow through started → approval-requested → completed and a separate run through failed; assert internal `remote_agent_workflow_events` timeline is unaffected by outbox writes and only the 4 producible external types (started/completed/approval-requested/failed) produce outbox rows.
  - [x] Real-HTTP HMAC verification test (Proof Sketch #3): local HTTP server acting as an independent Hermes-V2 verifier; prove valid delivery succeeds, tampered body fails, wrong secret fails, timestamp older than 300s fails — using deterministic clocks and no external network dependency, per project testing rules.
  - [x] Run `bun run validate` — all 8 gates must pass as the final proof (Proof Sketch #12).

### Review Findings

- [x] [Review][Decision] Unapproved files are present outside the frozen changed-file surface — resolved by removing the untracked context, investigation, and `plans/reports/*.md` files from the story change set.
- [x] [Review][Patch] Pending attempts can strand accepted events forever [packages/core/src/db/workflow-event-outbox.ts:132]
- [x] [Review][Patch] Binding lifecycle never provisions or rotates `signing_secret` [packages/core/src/db/provider-bindings.ts:67]
- [x] [Review][Patch] Outbox enqueue accepts invalid typed event payloads [packages/core/src/workflows/store-adapter.test.ts:281]
- [x] [Review][Patch] Webhook delivery has no timeout, so one hung endpoint blocks the dispatcher [packages/server/src/workflow-events/dispatcher.ts:201]
- [x] [Review][Patch] Required HMAC rejection proof is missing [packages/server/src/workflow-events/dispatcher.test.ts:195]

## Dev Notes

### Feature and System Context

- **Outcome**: Archon becomes a producer of signed, typed, non-blocking workflow events for `workflow.run.started`, `workflow.run.completed`, `workflow.run.failed`, `workflow.approval.requested`, and `workflow.delivery.failed` (5 of the 6 canonical types — `workflow.artifact.recorded` is explicitly deferred, see below). Delivery happens only from `archon serve`; every other execution path only enqueues.
- **Architectural role**: Archon is a webhook _producer_ reusing Hermes's existing Generic Webhook V2 verification exactly (TD-01) — no new signing protocol, no new runtime/queue infrastructure (AD-8), built entirely on the existing Bun/SQLite/Postgres stack.
- **Upstream authorities**: technical-decisions.md (16/16 approved, gate PASS), `epics.md:302-488` (story text + AC + TD block), `prd.md:67-77` (FR-9), `architecture.md:44-95` (AD-3/AD-6/AD-7/AD-8/AD-9/AD-11), contract package `contracts/workflow-commander/`.
- **Downstream consumers**: `hermes-agent` Stories 3.6a/3.6b/3.6c (event ingress — out of scope here) and Archon Story 3.7 (delivery-health read projection over the tables this story creates — strictly read-only per AD-11, must never gain a second write path).
- **User-visible behavior**: none directly — no new CLI surface (delivery-status querying is Story 3.7's territory per AD-11/architecture's Provider Command Syntax Baseline). This story is entirely backend: DB schema, an in-process background poller, and outbound HTTP.
- **No UX/UI surface** — confirmed by direct read of `ux.md` (34 lines, no Archon Web/wireframe content) and `prd.md:23`'s explicit statement that the lack of UI is a deliberate product boundary for Workflow Commander v1, not a gap.

### Canonical Artifact Reconciliation

The current contract package (`contracts/workflow-commander/`) contains planning-era fields the approved decisions removed. This reconciliation is Slice 1 and is a **blocking prerequisite** — epics.md's own "Blocking behavior" clause says this story must not move to implementation-ready or be completed unless shared workflow event examples validate locally.

| Current (planning-era)                                                       | Target (approved)                                                                                                                | Authority    |
| ---------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | ------------ |
| `intendedProducer`/`intendedConsumer`/`owningSubproject` on every event      | Removed entirely from events (command/binding/delivery-status/rejection/materialization fixtures keep them — TD-14's scope note) | TD-14        |
| `profileRoute` object (`profile`, `ingressPath`, `bindingName`, `secretRef`) | Removed — binding routing is `event_route` + new `signing_secret` column only                                                    | TD-01, TD-02 |
| `signature` object incl. `bodyDigest` in the body                            | Removed — signing lives entirely in `X-Webhook-Signature-V2`/`X-Webhook-Timestamp` HTTP headers                                  | TD-01        |
| `delivery` object (`deliveryId`, `attempt`, `receivedAt`) in the body        | Removed — attempt identity/timing/outcome belong to the new delivery-attempt history table, not the wire body                    | TD-13        |
| `projectRef.projectBindingId`                                                | Removed                                                                                                                          | TD-10        |
| `workflowRunStartedPayload.{phase,commandCorrelationId}`                     | Removed — started payload is just `{state, startedAt}`                                                                           | TD-08, TD-09 |
| `projectRef.codebaseRef` as a synthesized git-ref string                     | Plain `codebase.name` value                                                                                                      | TD-10        |
| Delivery fixtures' `eventRef.eventType: "workflow.completed"`                | `"workflow.run.completed"`                                                                                                       | TD-06        |
| Idempotency keys with `idm_*` or `generic:` prefixes                         | `archon:<bindingName>:<eventId>`                                                                                                 | TD-07        |

Target envelope root `required` (exactly 10 fields): `schemaVersion`, `provider`, `eventId`, `eventType`, `occurredAt`, `bindingRef`, `workflowRunRef`, `projectRef`, `idempotencyKey`, `payload`. Full field-by-field diff, per-fixture edit list, and 3 target example bodies (`workflow.run.started`/`workflow.run.completed`/`workflow.approval.requested`) are in `plans/reports/researcher-260725-1927-event-contract-reconciliation.md` — read that report before starting Slice 1, it has ready-to-adapt JSON.

### Data Model

**`remote_agent_workflow_event_outbox`** (new) — one row per logical external event, independent of the internal `remote_agent_workflow_events` timeline (TD-12). Stores the exact serialized `event_body` once at enqueue time; every delivery attempt reuses it verbatim (required for both byte-identical redelivery per TD-16 and for HMAC signing to be reproducible). See Slice 2 for the full column list.

**`remote_agent_workflow_event_delivery_attempts`** (new) — append-only, one row per HTTP attempt (TD-16's full request/response snapshot requirement). See Slice 4.

**`remote_agent_workflow_provider_bindings.signing_secret`** (new nullable column) — plaintext at rest per TD-02 (explicitly approved, not a deviation: "leave it unencrypted at rest... Exposure: the raw secret is excluded from ordinary binding projections, CLI JSON, API responses, event bodies, delivery status, and logs"). Existing rows stay `NULL` until provisioned; rotation replaces the secret and bumps `binding_version` (existing `rotateBinding()` mechanism, unchanged).

Do not conflate the new external outbox with the existing `remote_agent_workflow_events` table (`packages/core/src/db/workflow-events.ts`) — that is a pre-existing, unrelated internal audit/dashboard timeline that this story does not modify.

### Lifecycle and Ownership

```text
Workflow lifecycle transition (executor.ts / dag-executor.ts)
  ├─ best-effort internal workflow_events write (createWorkflowEvent, unchanged)
  └─ best-effort external outbox enqueue (enqueueExternalWorkflowEvent, new)
       ├─ resolve codebase + binding (binding-router.ts)
       │    ├─ not routable → outbox row status='not-routable', no attempts scheduled
       │    └─ routable → outbox row status='pending', next_attempt_at=now
       └─ archon serve poller (dispatcher.ts)
            ├─ claim due rows (status pending/retrying, next_attempt_at <= now)
            ├─ insert pending attempt row (BEFORE HTTP — TD-16 history invariant)
            ├─ sign event_body verbatim with Hermes V2 headers (hermes-signer.ts)
            ├─ POST to binding.event_route
            ├─ complete attempt row (response/transport-error snapshot)
            └─ update outbox row (status, attempt_count, next_attempt_at per TD-16 backoff, or terminal)
                 └─ on failure (not already workflow.delivery.failed) → enqueue workflow.delivery.failed (TD-05 guard)
```

### Explicit Boundary and Deferral Record

| Item                                                                                             | Decision made in this story                                                                                                                                                                                                                                                                                                                                                                                      | Rationale                                                                                                                                                                                                                                                                                                                                                                        | Owner / follow-up                                                                                                     |
| ------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `workflow.run.failed` coverage for DAG node-failure paths                                        | **Included.** Add 3 direct `enqueueExternalWorkflowEvent()` calls: `executor.ts:1138` (unhandled exception, already paired with an internal write), plus two NEW calls at `dag-executor.ts:7046-7051` and `:7092-7097` (the `!anyCompleted` and `anyFailed` branches — these are the common real-world failure paths and currently write NO internal `workflow_events` row at all, only a status-column update). | FR-9 states Archon emits events "for workflow failure" — if only genuine crashes produced `workflow.run.failed`, the feature would not cover the common failure case. The external outbox enqueue is independent of the internal timeline (TD-12), so adding it at these branches does not require also fixing the internal-timeline gap.                                        | This is a judgment call, not resolved by TD-01..TD-16 — flagged to the story owner for confirmation before dev-story. |
| Internal `remote_agent_workflow_events` still has no `workflow_failed` row for DAG node-failures | **Deferred, explicitly out of scope.**                                                                                                                                                                                                                                                                                                                                                                           | Story 3.5 owns the external outbox, not internal-timeline completeness; fixing the pre-existing internal gap is unrelated production-code surface beyond this story's five approved slices.                                                                                                                                                                                      | Separate story/ticket if the internal timeline gap needs fixing.                                                      |
| `workflow.artifact.recorded` producer                                                            | **Deferred entirely from this story's initial cut.** Schema/envelope support for the type exists (Slice 1 builds all payload shapes structurally), but no call site enqueues it.                                                                                                                                                                                                                                 | Zero existing producer signal anywhere in the codebase — `output_type` node artifact sidecars (`$ARTIFACTS_DIR/nodes/<id>.md`) are a filesystem mechanism, not an event-emitter signal, and wiring a new one is materially more invasive than "add an enqueue next to an existing lifecycle write." Not one of the five approved implementation slices in epics.md's scope list. | Follow-up story once an artifact-recorded trigger point is designed.                                                  |
| `wrong-profile-secret.json` naming                                                               | **Renamed** to `wrong-signing-secret.json`, redefined as "signature doesn't verify against the binding's stored `signing_secret`."                                                                                                                                                                                                                                                                               | TD-02 eliminates the "profile" concept the original fixture tested; keeping the old name would describe a concept that no longer exists.                                                                                                                                                                                                                                         | Requires updating `validate_contracts.py` constants and `epics.md:327` prose (Slice 1 task).                          |
| `schemaVersion` version bump                                                                     | **Not bumped** — stays `"workflow-event-envelope.v1"`.                                                                                                                                                                                                                                                                                                                                                           | TD-01..TD-16 frame all changes as pre-implementation corrections of "planning-era fields the accepted runtime no longer emits," not a breaking change to something already shipped/consumed.                                                                                                                                                                                     | ~85% confidence read of the decisions doc — flagged, not silently assumed.                                            |
| `workflow-completed-redelivery.json` fixture                                                     | **Kept as a byte-identical duplicate** of `workflow-completed.json`, with README prose explaining why.                                                                                                                                                                                                                                                                                                           | Avoids inventing a body-level field to force an artificial difference, which would contradict TD-13/TD-16's byte-identical-body requirement.                                                                                                                                                                                                                                     | None — resolved.                                                                                                      |

### Failure, Concurrency, Security, and Compatibility Analysis

- **Non-blocking guarantee (TD-04)**: `enqueueExternalWorkflowEvent()` follows the exact same triple-layered non-throwing shape as `createWorkflowEvent` (`packages/core/src/db/workflow-events.ts:107-117` → `store-adapter.ts:65-76` → call-site `.catch()`). A DB outage during enqueue is logged and swallowed; workflow execution is never blocked or rolled back.
- **Non-transactional (TD-04)**: enqueue is not coupled to the workflow state transition in a shared DB transaction. Accepted limitation: a crash between the state transition and the enqueue call can silently lose the external notification (explicitly accepted by TD-04, not something this story compensates for).
- **Concurrency**: only `archon serve` dispatches (TD-03), so there is exactly one poller process per deployment claiming due rows — no cross-process lease/lock is needed (unlike CLI recovery commands from Story 3.3d, which had to handle multiple worker processes). Within that one process, the `draining`/`redrainRequested` guard (mirroring `DashboardEventPoller`) prevents a slow HTTP round-trip from causing overlapping claim batches.
- **Security**: `signing_secret` stored plaintext per TD-02 (approved trade-off — see Data Model). Never appears in binding projections, CLI JSON, API responses, event bodies, delivery status, or logs (existing `ENVELOPE_FORBIDDEN_KEYS`-style redaction pattern in `workflow.ts:423-434` is the established precedent to extend, or a parallel denylist if this code lives outside that file's package). `validate_contracts.py`'s `check_no_raw_secrets()` already scans schemas/examples for secret-shaped keys — no change needed there, but it stays green only if `signing_secret` never leaks into a contract fixture.
- **Compatibility**: `remote_agent_workflow_events` (internal timeline), existing binding CRUD (`createBinding`/`updateBinding`/`rotateBinding`/`disableBinding`), and every Story 3.3a-d CLI command/envelope behavior are unchanged. This story only adds new tables, one new nullable column, and new call sites — it does not modify any existing table's semantics.
- **SQLite/PostgreSQL parity**: both new tables need `CREATE TABLE IF NOT EXISTS` in `000_combined.sql` (Postgres) AND a hand-maintained twin in `sqlite.ts`'s `createSchema()` — these are NOT generated from one source (`sqlite.ts` is hand-maintained, confirmed by direct read). The new `signing_secret` column additionally needs a `migrateColumns()` entry for pre-existing SQLite databases, since SQLite has no `ADD COLUMN IF NOT EXISTS`.

### Project Structure Notes

- New files land in `packages/core/src/db/`, `packages/core/src/schemas/`, `packages/core/src/events/` (new subdirectory — first file `workflow-event-envelope.ts`), and `packages/server/src/workflow-events/` (new directory — matches architecture.md's Source Tree Seed prediction exactly).
- `packages/workflows/` changes are limited to the `IWorkflowStore` interface extension (`store.ts`) and the new enqueue call sites in `executor.ts`/`dag-executor.ts` — no new files in this package, and no import of `@archon/core`/`@archon/server` (workflow-engine package-boundary rule; the interface/DI pattern already established for `createWorkflowEvent` is reused unchanged).
- The event-envelope builder lives in `packages/core`, not `packages/cli` — do not import `packages/cli/src/commands/workflow-provider-command-envelope.ts` or `workflow.ts`'s `buildWorkflowRunRef()`; that module builds the unrelated _command_ envelope (`workflow-command-envelope.v1`) and lives in the CLI package, which `packages/core`/`packages/server` must not depend on. Duplicate the 1-line `project:<id>` string convention instead (rule-of-three; see Slice 1).
- No new CLI command surface. No Web UI changes.

### References

- [Source: `_bmad-output/planning-artifacts/story-decisions/3-5-produce-signed-typed-archon-workflow-events-from-outbox/technical-decisions.md`] — 16/16 decisions approved, gate PASS, full decision summary, executable proof sketch (12 items, cited throughout this story as "Proof Sketch #N").
- [Source: `_bmad-output/planning-artifacts/epics.md:302-488`] — Story 3.5 text, AC, implementation scope (5 slices), embedded TD-01..TD-16 decision-gate block.
- [Source: `_bmad-output/planning-artifacts/prd.md:67-77`] — FR-9 exact text and consequences.
- [Source: `_bmad-output/planning-artifacts/prd.md:92-98`] — NFR-1, NFR-5, NFR-6, NFR-9, NFR-14, NFR-15, NFR-16 (signing, audit detail, provider-boundary, provider-neutral naming).
- [Source: `_bmad-output/planning-artifacts/architecture.md:44-95`] — AD-3, AD-6, AD-7, AD-8, AD-9, AD-11 (AD-11 is the load-bearing 3.5/3.7 write/read ownership split).
- [Source: `_bmad-output/planning-artifacts/architecture.md:112-137`] — Source Tree Seed and Deferred Details tables.
- [Source: `plans/reports/researcher-260725-1927-event-contract-reconciliation.md`] — full field-by-field schema diff, per-fixture edit list, 3 ready-to-adapt target example bodies.
- [Source: `plans/reports/db-researcher-260725-1941-story-3-5-outbox-schema.md`] — migration mechanism, exact `file:line` for every DB precedent, `createWorkflowEvent` call-site enumeration, Finding 1 (`workflow_failed` coverage gap) and Finding 2 (`workflow_artifact` zero producers).
- [Source: `plans/reports/researcher-260725-1927-cli-server-lifecycle.md`] — `archon serve` boot order, binding lifecycle, HMAC/HTTP precedent, execution-path enumeration.
- [Source: `plans/reports/researcher-260725-1927-prd-architecture-git.md`] — FR-9/NFR text, architecture ownership rules, git-history commit-shape precedent, cross-story dependency confirmation.
- [Source: `_bmad-output/implementation-artifacts/sprint-status.yaml:102-105`] — open action item "[SPG-01-SPG-08] Apply Story Proof Guardrails to Stories 3.5 and 3.7 before either story moves into implementation" (Winston/Amelia/Murat) — see Story Proof Guardrails Applied below.
- [Source: `brain/StoryProofGuardrails.md`] — SPG-01 through SPG-08 taxonomy, created from the Story 3.3d partial retrospective.
- [Source: `packages/core/src/db/workflow-events.ts:107-117`] — `createWorkflowEvent`, the non-throwing pattern this story's enqueue function mirrors exactly.
- [Source: `packages/core/src/db/provider-bindings.ts:51-252`] — binding CRUD/lifecycle (create/get/update/rotate/disable), the UPDATE-then-SELECT precedent for the new attempt-recording code.
- [Source: `packages/server/src/adapters/web/dashboard-event-poller.ts:47-118`] — overlap-guard (`draining`/`redrainRequested`) precedent for the new dispatcher.
- [Source: `packages/core/src/services/cleanup-service.ts:838-880`] — immediate-drain-then-interval boot precedent for the new dispatcher.
- [Source: `packages/server/src/index.ts:222-950`] — full server boot sequence; new poller wires in at line 319 (after `startCleanupScheduler()`, before `Bun.serve()` at line 940).
- [Source: `packages/adapters/src/forge/github/adapter.ts:6,436-469`] — existing HMAC-SHA256 precedent (inbound verification; producer side reuses only the `createHmac(...).digest('hex')` half).
- [Source: `packages/adapters/src/community/forge/gitea/adapter.ts:164-210`] — raw `fetch()` + manual retry-loop precedent for the new outbound POST (no wrapped HTTP client exists in this codebase).
- [Source: `migrations/000_combined.sql:593-621`] — Table 11 (workflow provider bindings) `CREATE TABLE IF NOT EXISTS` pattern to follow for the 2 new tables.
- [Source: `packages/core/src/db/adapters/sqlite.ts:85-92,183-385,396-680`] — SQLite `RETURNING` limitation, `migrateColumns()`, `createSchema()`.

### Previous Story Intelligence (from 3.3d)

Directly applicable learnings from `_bmad-output/implementation-artifacts/3-3d-provide-archon-recovery-command-cli-json.md`, whose review cycle produced `brain/StoryProofGuardrails.md`:

1. **Map every decision to a task and a proof before coding** (SPG-01) — done above (Approved Technical Decisions table); do not let implementation drift from this matrix without an explicit amendment.
2. **Freeze the changed-file surface up front** (SPG-03) — done above; 3.3d's review cycle repeatedly found scope had silently crept into server/Web files never approved for that story.
3. **State the required observable per AC, not a proxy** (SPG-04) — this story's proofs specifically avoid "dispatch acknowledgement only" traps: the persistent fact loaded for this workflow run states outright that "a dispatch acknowledgement, process spawn, or log-file observation never proves worker claim, durable state, terminal outcome, or consumer compatibility" — every proof above targets the owning boundary (DB row state, actual HTTP request/response, real HMAC recomputation), not a process-existence proxy.
4. **Hermetic focused tests** (SPG-05) — each Slice's tests must initialize and clean up their own SQLite schema/fixtures independently; do not rely on Slice 1's contract validation run to leave state behind for Slice 2's tests.
5. **Triage every review finding to Patch/Defer/Dismiss with an owner** (SPG-07) — the Explicit Boundary and Deferral Record above pre-applies this discipline to the two real gaps this research surfaced (`workflow_failed` DAG coverage, `workflow_artifact` producer) rather than letting them surface as ambiguous review findings later.
6. **Detached-worker/process patterns are not directly applicable here** — 3.3d's parent/worker CAS-ownership split (TD-002/003) was about CLI recovery commands spawning detached child processes; Story 3.5's poller runs entirely in-process inside `archon serve` (TD-03), so that specific pattern does not transfer, but the general "prove the owning process/persistence boundary, not a proxy" discipline (point 3 above) does.

## Story Proof Guardrails Applied

Closes the open sprint-status action item "[SPG-01-SPG-08] Apply Story Proof Guardrails to Stories 3.5 and 3.7 before either story moves into implementation" for this story (Story 3.7 must separately apply the same discipline when its own story file is created).

| SPG                                      | Applied as                                                                                                                                                                             |
| ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| SPG-01 (decision-to-plan coverage gap)   | Approved Technical Decisions table — every TD-01..TD-16 maps to a task and a proof.                                                                                                    |
| SPG-02 (patch-of-patch closure)          | N/A at create-story time (applies during review cycles); Explicit Boundary and Deferral Record groups the 2 real gaps by root cause rather than leaving them as isolated findings.     |
| SPG-03 (scope and ownership drift)       | Approved Changed-File Surface — frozen list, explicit exclusions.                                                                                                                      |
| SPG-04 (proof-target mismatch)           | Executable Proof Design embedded in each Slice's task list — every proof targets a DB row, real HTTP exchange, or independent HMAC recomputation, never a log/process-existence proxy. |
| SPG-05 (non-hermetic test fixture)       | Previous Story Intelligence point 4 — each slice's tests own their fixtures.                                                                                                           |
| SPG-06 (premature completion signal)     | Every task above requires a named proof, not just a broad-suite pass; `bun run validate` is the final gate, not the only gate.                                                         |
| SPG-07 (finding ownership not triaged)   | Explicit Boundary and Deferral Record — each open item has a stated decision, rationale, and owner/follow-up.                                                                          |
| SPG-08 (generated-artifact source drift) | Contract reconciliation (Slice 1) edits the schema/fixtures first, then `validate_contracts.py`; no generated-artifact patching without touching its source.                           |

## Dev Agent Record

### Agent Model Used

GPT-5 Codex

### Debug Log References

- `python3 _bmad-output/planning-artifacts/contracts/workflow-commander/validate_contracts.py`
- `bun test packages/core/src/events/`
- `bun test packages/core/src/db/workflow-event-outbox.test.ts`
- `bun test packages/core/src/db/provider-bindings.test.ts packages/core/src/schemas/workflow-provider-binding.test.ts packages/core/src/db/adapters/sqlite.test.ts`
- `bun test packages/core/src/db/adapters/postgres.test.ts packages/core/src/db/provider-bindings-bundled-schema.test.ts packages/core/src/db/bundled-schema.test.ts`
- `bun test packages/core/src/workflows/store-adapter.test.ts`
- `bun test packages/server/src/workflow-events/`
- `bun --cwd packages/workflows test`
- `bun --cwd packages/core test`
- `bun --cwd packages/server test`
- `bun --cwd packages/cli test`
- `bun test src/commands/workflow-json.e2e.test.ts -t "3.3D-CLI-023"` from `packages/cli`
- `bun run validate`

### Completion Notes List

- Reconciled the Workflow Commander event contract to the approved 10-field event body, HTTP-header signature model, byte-identical redelivery bodies, and `wrong-signing-secret` rejection vocabulary.
- Added the external workflow event outbox, delivery-attempt history, private provider-binding `signing_secret`, SQLite/PostgreSQL schema convergence checks, and generated bundled schema update.
- Added `IWorkflowStore.enqueueExternalWorkflowEvent()` and implemented primitive-only, best-effort enqueueing in the core store adapter, including routable and not-routable persistence.
- Wired workflow lifecycle producers for started, completed, approval requested, and failed events without importing core/server code into the workflow engine.
- Added the server-side dispatcher, Hermes V2 HMAC signer, deterministic retry schedule, pending-attempt-before-HTTP guard, recursion guard for `workflow.delivery.failed`, and server boot/shutdown wiring.
- Final validation passed with `bun run validate`.

### File List

- `_bmad-output/implementation-artifacts/3-5-produce-signed-typed-archon-workflow-events-from-outbox.md`
- `_bmad-output/implementation-artifacts/sprint-status.yaml`
- `_bmad-output/planning-artifacts/contracts/workflow-commander/README.md`
- `_bmad-output/planning-artifacts/contracts/workflow-commander/schemas/workflow-event-envelope.schema.json`
- `_bmad-output/planning-artifacts/contracts/workflow-commander/validate_contracts.py`
- `_bmad-output/planning-artifacts/contracts/workflow-commander/examples/callback-rejections/*.json`
- `_bmad-output/planning-artifacts/contracts/workflow-commander/examples/providers/archon/delivery/*.json`
- `_bmad-output/planning-artifacts/contracts/workflow-commander/examples/providers/archon/events/*.json`
- `_bmad-output/planning-artifacts/contracts/workflow-commander/examples/workflow-events/*.json`
- `_bmad-output/planning-artifacts/epics.md`
- `_bmad-output/planning-artifacts/prd.md`
- `migrations/000_combined.sql`
- `packages/cli/src/commands/provider-binding-contract.test.ts`
- `packages/cli/src/commands/workflow-json.e2e.test.ts`
- `packages/cli/src/commands/workflow-provider-command-envelope.test.ts`
- `packages/core/package.json`
- `packages/core/src/db/adapters/postgres.test.ts`
- `packages/core/src/db/adapters/sqlite.test.ts`
- `packages/core/src/db/adapters/sqlite.ts`
- `packages/core/src/db/bundled-schema.generated.ts`
- `packages/core/src/db/provider-bindings-bundled-schema.test.ts`
- `packages/core/src/db/provider-bindings.test.ts`
- `packages/core/src/db/provider-bindings.ts`
- `packages/core/src/db/workflow-event-outbox.test.ts`
- `packages/core/src/db/workflow-event-outbox.ts`
- `packages/core/src/events/binding-router.test.ts`
- `packages/core/src/events/binding-router.ts`
- `packages/core/src/events/workflow-event-envelope.test.ts`
- `packages/core/src/events/workflow-event-envelope.ts`
- `packages/core/src/schemas/index.ts`
- `packages/core/src/schemas/workflow-event-delivery-attempt.ts`
- `packages/core/src/schemas/workflow-event-outbox.ts`
- `packages/core/src/schemas/workflow-provider-binding.test.ts`
- `packages/core/src/workflows/store-adapter.test.ts`
- `packages/core/src/workflows/store-adapter.ts`
- `packages/server/package.json`
- `packages/server/src/index.ts`
- `packages/server/src/workflow-events/dispatcher.test.ts`
- `packages/server/src/workflow-events/dispatcher.ts`
- `packages/server/src/workflow-events/hermes-signer.test.ts`
- `packages/server/src/workflow-events/hermes-signer.ts`
- `packages/workflows/src/dag-executor.test.ts`
- `packages/workflows/src/dag-executor.ts`
- `packages/workflows/src/executor-preamble.test.ts`
- `packages/workflows/src/executor.test.ts`
- `packages/workflows/src/executor.ts`
- `packages/workflows/src/script-node-deps.test.ts`
- `packages/workflows/src/store.ts`
