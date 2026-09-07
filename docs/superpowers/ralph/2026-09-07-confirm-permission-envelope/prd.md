# Confirm a Permission by Envelope Only Ralph PRD

Source plan: `docs/superpowers/plans/2026-09-07-confirm-permission-envelope.md`
Derived slug: `2026-09-07-confirm-permission-envelope`

## Overview

Story 6.7 of the Workflow Run View HITL epic implements the confirmation contract for pending Permission interactions. When an AI node creates a pending `kind: permission` interaction (supported in `remote_agent_pending_interactions` since Story 6.2), the authenticated run starter can confirm that interaction exactly once via `POST /api/workflows/runs/{runId}/permissions/{callId}/confirm` with an exact `{ intent: string }` payload, where `callId` maps directly to the persisted `tool_use_id`.

In a single atomic database transaction, Archon locks the run and interaction rows, validates that the interaction is of `kind: 'permission'` and currently `pending` while the run is `paused`, updates the interaction status to `answered` with the opaque submitted intent, and—if no pending interactions remain for that run—executes the shared compare-and-swap (CAS) to resume the workflow run from `paused` to `running`. The transaction also records an `interaction_resolved` audit event containing only identifiers.

The feature enforces strict starter-only authorization, redaction of sensitive intent strings from logs and events, first-write CAS semantics (subsequent confirmation attempts return `409 Conflict`), and an authenticated OpenAPI route. Story 6.7 deliberately does not implement live Permission activation, provider resume injection, auto-dispatch, or UI cards.

Linked issue: [#92](https://github.com/anhle128/Archon/issues/92).

## Problem

Story 6.2 introduced `kind: permission` in `remote_agent_pending_interactions`, and Story 6.3 delivered the answer-and-resume lifecycle for `AskHuman`. However, pending Permission interactions currently have no resolution path:
1. There is no route or operation for the run starter to confirm a pending Permission interaction.
2. The existing `resolvePendingInteraction` helper is Ask-specific and rejects Permission rows with `kind_not_ask`.
3. Permission requests require an exact `{ intent: string }` body where `intent` is opaque text, rejecting extra or Ask-only fields, empty strings, and whitespace-only strings while preserving any valid non-whitespace string without trimming.
4. Confirming a Permission interaction must be atomic with run resumption when it is the last pending interaction for a paused run, without drifting from the query-scoped `'paused-ask'` resume primitive.
5. Intent strings, envelope data, and answer payloads must never be leaked into structured logs, persisted audit events, live SSE signals, HTTP errors, or OpenAPI schemas.
6. Only the original run starter (`workflow_runs.user_id`) may confirm a Permission interaction; administrative roles cannot override this ownership, and missing authentication must return `401` before body parsing.
7. Permission interactions are dormant in Story 6.7: they must not trigger auto-dispatch or provider resume injection.

## Solution

1. **Contracts (`packages/workflows/src/schemas/pending-interaction.ts`)**: Define strict Zod schemas `permissionConfirmBodySchema` and `confirmPendingPermissionInputSchema` using `@hono/zod-openapi` and `z.infer`. The request body strictly requires `{ intent: string }` with non-blank refinement (`value.trim().length > 0`) while preserving submitted whitespace, and forbids additional keys.
2. **Atomic Persistence (`packages/core/src/db/workflow-pending-interactions.ts`)**: Implement `confirmPendingPermission(input)` using `db.withTransaction()`. Lock the run and pending interaction rows (`FOR UPDATE` on PostgreSQL). Verify the run is `paused` and the interaction is `kind === 'permission'`. CAS update the row to `answered`, check remaining pending interactions, resume the run via `resumeWorkflowRunInTransaction(..., 'paused-ask')` if remaining count is zero, and insert an `interaction_resolved` audit event containing only `{ node_id, tool_use_id, kind: 'permission', resumed }`.
3. **Operations & Authorization (`packages/core/src/operations/workflow-operations.ts`)**: Implement `confirmPermission(input)`. Verify requester authentication (`PermissionAuthenticationRequiredError`), enforce starter ownership (`run.user_id === actorUserId`, throwing `PermissionForbiddenError`), delegate to `confirmPendingPermission`, log `workflow.permission_resolved` with identifiers only, and emit `interaction_resolved` on the workflow event emitter after commit. Update test doubles across `packages/core`, `packages/server`, and `packages/cli`.
4. **OpenAPI Route (`packages/server/src/routes`)**: Register `POST /api/workflows/runs/{runId}/permissions/{callId}/confirm` with pre-validation authentication middleware, strict body schema decoration via `permissionConfirmRequestSchema`, and typed error mapping (`200`, `400`, `401`, `403`, `404`, `409`, `500`). Do not call `tryAutoResumeAfterGate` or dispatch to the orchestrator.
5. **Types, Validation, and Tracker Closure**: Regenerate `packages/web/src/lib/api.generated.d.ts` from a supervised worktree server. Verify repository invariants and non-goals (no provider changes, no UI cards, no migrations). Pass `bun run validate`. Clean the conflict-registry text in `sprint-status.yaml` and mark Story 6.7 as `done`.

## Goals and Success Metrics

| Goal | Success Metric | Evidence Source |
| --- | --- | --- |
| Exact Request Contract | Accept `{ intent: string }` where `trim().length > 0`; reject empty/whitespace/extra keys; preserve string verbatim | Unit tests in `packages/workflows/src/schemas/pending-interaction.test.ts` (`docs/superpowers/plans/2026-09-07-confirm-permission-envelope.md:180-270`) |
| Atomic First-Write CAS | First confirm transitions row and resumes run if last pending; second write returns 409 and preserves first answer; rollback on failure | Database tests in `packages/core/src/db/workflow-pending-interactions.test.ts` (`docs/superpowers/plans/2026-09-07-confirm-permission-envelope.md:271-570`) |
| Starter-Only Authorization | Only `workflow_runs.user_id` can confirm; missing auth is 401; non-starter (including admin) is 403; unowned run is 403 | Operation tests in `packages/core/src/operations/workflow-operations.test.ts` (`docs/superpowers/plans/2026-09-07-confirm-permission-envelope.md:571-869`) |
| Zero Payload Leakage | Submitted intent, envelope, and answer never appear in logs, events, SSE signals, or HTTP error responses | Assertions in persistence, operation, and route test suites (`docs/superpowers/plans/2026-09-07-confirm-permission-envelope.md:28-29,37,133-142`) |
| Clean HTTP Status Mapping | Valid write returns 200; invalid body/kind 400; unauth 401; forbidden 403; not found 404; conflict/not-paused 409; safe error 500 | Route tests in `packages/server/src/routes/api.workflow-runs.test.ts` (`docs/superpowers/plans/2026-09-07-confirm-permission-envelope.md:870-1319`) |
| Non-Goal Invariants Maintained | No provider changes, no UI cards, no migrations, no auto-dispatch, no permission resume injection | Verification commands and `bun run validate` (`docs/superpowers/plans/2026-09-07-confirm-permission-envelope.md:1320-1490`) |

## Non-Goals

- No live Permission producer or card creation in this story (`docs/superpowers/plans/2026-09-07-confirm-permission-envelope.md:46`).
- No UI components or console experiment changes (`docs/superpowers/plans/2026-09-07-confirm-permission-envelope.md:45`).
- No provider resume injection or provider changes (`docs/superpowers/plans/2026-09-07-confirm-permission-envelope.md:35-36,45`).
- No orchestrator auto-dispatch on permission confirmation (`docs/superpowers/plans/2026-09-07-confirm-permission-envelope.md:35,1310-1315`).
- No database migrations (`docs/superpowers/plans/2026-09-07-confirm-permission-envelope.md:42`).
- No additions to `IWorkflowStore` or `store-adapter.ts` (`docs/superpowers/plans/2026-09-07-confirm-permission-envelope.md:43-44`).
- No CLI commands, chat commands, or `manage_run` commands for permission confirmation (`docs/superpowers/plans/2026-09-07-confirm-permission-envelope.md:46`).
- No `awaiting` run status or timeout/default intent (`docs/superpowers/plans/2026-09-07-confirm-permission-envelope.md:38-39`).

## Technical Context

- `packages/workflows/src/schemas/pending-interaction.ts:52-86`: Add `permissionConfirmBodySchema`, `PermissionConfirmBody`, `confirmPendingPermissionInputSchema`, and `ConfirmPendingPermissionInput` (`docs/superpowers/plans/2026-09-07-confirm-permission-envelope.md:99-123,178-270`).
- `packages/workflows/src/schemas/pending-interaction.test.ts:1-165`: Prove exact schema parsing, whitespace preservation, and rejection of blank/extra keys (`docs/superpowers/plans/2026-09-07-confirm-permission-envelope.md:190-264`).
- `packages/core/src/db/workflow-pending-interactions.ts:8-439`: Add `confirmPendingPermission(input)` and `'kind_not_permission'` validation code (`docs/superpowers/plans/2026-09-07-confirm-permission-envelope.md:364-444`).
- `packages/core/src/db/workflow-pending-interactions.test.ts:11-868`: Test atomic CAS, first-write win, rollback on trigger/resume fail, sibling interaction handling, and kind mismatch on real SQLite (`docs/superpowers/plans/2026-09-07-confirm-permission-envelope.md:283-363`).
- `packages/core/src/db/workflow-resume-transition.ts:87-141`: Shared `'paused-ask'` query-scoped resume transition (`docs/superpowers/plans/2026-09-07-confirm-permission-envelope.md:61,280`).
- `packages/core/src/operations/workflow-operations.ts:1-340`: Implement `confirmPermission(input)` and export `PermissionRunNotFoundError`, `PermissionAuthenticationRequiredError`, and `PermissionForbiddenError` (`docs/superpowers/plans/2026-09-07-confirm-permission-envelope.md:676-745`).
- `packages/core/src/operations/workflow-operations.test.ts:1-1464`: Test starter-only auth, unauth 401, unowned 403, missing run 404, sanitized lookup logging, and event emission after commit (`docs/superpowers/plans/2026-09-07-confirm-permission-envelope.md:586-674`).
- `packages/server/src/routes/schemas/workflow.schemas.ts:13-20,307-308`: Export `permissionConfirmRequestSchema = permissionConfirmBodySchema.openapi('PermissionConfirmBody')` (`docs/superpowers/plans/2026-09-07-confirm-permission-envelope.md:1044-1052`).
- `packages/server/src/routes/api.ts:417-459,1457-1488,4861-4923`: Declare and register `POST /api/workflows/runs/{runId}/permissions/{callId}/confirm` with pre-validation auth and error mapping (`docs/superpowers/plans/2026-09-07-confirm-permission-envelope.md:1053-1135`).
- `packages/server/src/routes/api.workflow-runs.test.ts`: Test HTTP status codes (200, 400, 401, 403, 404, 409, 500), OpenAPI publication, and safe logging (`docs/superpowers/plans/2026-09-07-confirm-permission-envelope.md:885-1035`).
- `packages/cli/src/commands/workflow.test.ts` & `workflow-command-contract.test.ts`: Add `confirmPendingPermission` to existing mock factories (`docs/superpowers/plans/2026-09-07-confirm-permission-envelope.md:747-790`).
- `packages/web/src/lib/api.generated.d.ts`: Regenerate from live OpenAPI schema on an isolated port (`docs/superpowers/plans/2026-09-07-confirm-permission-envelope.md:1350-1410`).
- `_bmad-output/implementation-artifacts/workflow-run-view-hitl/sprint-status.yaml`: Remove conflict-registry report text and mark `6-7-confirm-a-permission-by-envelope-only` done (`docs/superpowers/plans/2026-09-07-confirm-permission-envelope.md:1430-1480`).

## Story Overview

| Priority | Story ID | Title | Depends On | Plan Anchors |
| --- | --- | --- | --- | --- |
| 1 | US-001 | Define Permission confirm contract and schemas | - | Task 1: 178-270 |
| 2 | US-002 | Implement atomic Permission confirmation CAS and safe event logging | US-001 | Task 2: 271-570 |
| 3 | US-003 | Authorize Permission confirmation operations and update DB mocks | US-001, US-002 | Task 3: 571-869 |
| 4 | US-004 | Register authenticated OpenAPI route for Permission confirmation | US-001, US-003 | Task 4: 870-1319 |
| 5 | US-005 | Regenerate API types, validate repository, and complete Story 6.7 | US-001, US-002, US-003, US-004 | Task 5: 1320-1526 |
