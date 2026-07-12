---
title: Archon Epics Handoff - Hermes Agent Workflow Commander
status: handoff
created: '2026-07-11'
updated: '2026-07-12'
storyOwnershipNote: >
  Story numbering is kept identical to the parent workspace Epic 3 story ids so cross-project references stay stable.
  This file contains only Archon-owned implementation stories.
---

# Archon Epics: Hermes Agent Workflow Commander

## Overview

This file contains the seven Archon-owned Workflow Commander implementation stories.
All seven stories belong to the provider producer side.
They exclude Hermes-owned Project Binding, BMAD mount, cwd enforcement from Hermes, BMAD invocation from Hermes, materialization, Project Work Items, Phase Tasks, HILT Gates, workflow event ingress, Story Status History, reconciliation, diagnostics, and Hermes user interaction.

All stories below depend on local contract readiness before implementation can start or be considered complete.
The local contract package is `contracts/workflow-commander/`.
It contains the current local schemas, examples, fixtures, and validator for the Workflow Commander handoff.
Producer stories may use those contracts only after the canonical validator passes as checked in:

```bash
python3 _bmad-output/planning-artifacts/contracts/workflow-commander/validate_contracts.py
```

If the validator fails, a required schema or example is missing, or a story needs a field that is not present in the validated package, that story is not implementation-ready and producer code must not invent the missing contract.

Run downstream implementation from the active Archon repository root, the directory that contains this `_bmad-output/planning-artifacts/` handoff and the root `package.json`.
Do not replace that with a user-local absolute path.
The recommended downstream validation command is `bun run validate`.

## Epic 3: Workflow Provider Control and Event Delivery

**Epic Goal:** External controllers can bind projects or codebases to Archon, control workflow runs through validated CLI JSON, receive signed workflow events without blocking execution, and inspect delivery health.

**User Value:** Workflow operators and controller integrators can automate Archon safely without depending on Archon Web, human-readable CLI parsing, Hermes-specific provider fields, or direct mutation of consumer-owned state.

**Completion Signal:** Stories 3.1, 3.3a, 3.3b, 3.3c, 3.3d, 3.5, and 3.7 satisfy their contract gates; the canonical local validator passes; event delivery failure never blocks workflow execution; and all CLI success and failure results remain machine-consumable.

**Independence:** This Archon producer slice depends only on the validated local contract package and explicitly named parent contract prerequisites.
It does not depend on Hermes event ingress, reconciliation, Project Work Items, Phase Tasks, gates, diagnostics, user interaction, or Archon Web UI.

## Story-Level Implementation Boundaries

Every story that persists provider binding, workflow outbox, or delivery status data must include the database migration or schema-change location, the SQLite and PostgreSQL adapter work, and focused tests for both database backends when SQL semantics differ.
Every CLI JSON producer story must include success and failure examples from the local contract package in its tests.
Every workflow event or delivery-status story must prove that event delivery failure does not block workflow execution.
Story 3.1 and Story 3.5 remain stable umbrella story IDs because cross-project references depend on them.
Their named implementation checkpoints are independently accepted implementation tasks, not an invitation to deliver the entire subsystem as one undifferentiated patch.
Each task must define its own code scope, focused tests, completion evidence, and rollback boundary before implementation begins.
A later task may depend on an accepted earlier task, but failure in a later task must not invalidate or require reverting an already accepted earlier task unless a documented contract incompatibility requires it.
The task lists must preserve the slices named in each story and must not combine provider binding lifecycle work with workflow command execution, event outbox delivery, Hermes event ingress, reconciliation, diagnostics, or UI behavior.
These boundaries sharpen implementation scope only; they do not add Hermes-owned Project Binding, materialization, Phase Task, gate, reconciliation, diagnostics, or UI work to Archon.
No story in this handoff should add or depend on Archon Web screens, workflow builder UI, wireframes, mockups, or new in-product UI.
Implementation agents must ignore older Route Loop Routing UX artifacts, Archon Web workflow builder mockups, June 26 UX shards, and UI-only prototypes unless a later approved Archon planning artifact explicitly reactivates them.

## Provider Command Syntax Baseline

Provider command identifiers are fixed by `contracts/workflow-commander/schemas/workflow-command-envelope.schema.json`.
The implementation syntax baseline is:

| Contract Command   | Provider CLI Syntax Baseline                                                                                              |
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

Story 3.3a must add tests that prove each syntax emits the matching canonical command identifier.
If implementation needs to revise a syntax entry because of an existing Archon CLI conflict, update this table, the architecture table, and the local command examples before producer code merges.

## Archon-Owned Stories

### Story 3.1: Implement Archon Workflow Provider Binding Lifecycle

As a workflow integration administrator,
I want Archon to manage provider-neutral reverse event bindings with provider and name identity,
So that external controllers can receive workflow events without Hermes-specific Archon commands or model names.

**Requirements Covered:** FR-7.

**Implementation Scope:** Archon-owned reverse workflow event binding persistence, lifecycle commands, status JSON, and diagnostics for provider `archon`.
Lifecycle command scope explicitly includes `binding.create`, `binding.update`, `binding.status`, `binding.rotate`, and `binding.disable`.
`binding.create` must not silently update an existing binding, and Workflow Commander v1 does not expose a binding remove command.
Keep this story limited to four implementation slices: storage/migration, lifecycle CLI commands, status/diagnostics JSON, and schema/example validation tests.
Do not include workflow command execution, workflow events, event delivery, or Hermes Project Binding behavior in this story.
Implementation task gates are:

1. Binding storage and create/status task: add the persisted binding shape, migration location, SQLite and PostgreSQL adapter behavior, create behavior, status behavior, and focused backend tests.
2. Binding update task: add explicit update behavior, prove create never silently upserts, and cover stale or conflicting transitions.
3. Binding rotate/disable task: add rotation and disable behavior without exposing secrets or deleting audit history.
4. Binding diagnostics and contract task: prove malformed-input failures, all required binding states, command envelopes, and checked-in binding examples.

Each task is accepted separately and must have its own focused validation evidence and rollback boundary.

Depends on: parent Story 1.3a.
Contract needed: Workflow Provider Binding schema, generic `provider` and `name` vocabulary, explicit create and update operations, event route field, binding status result, and malformed JSON failure envelope.
Blocking behavior: This story must not move to implementation-ready or be completed unless the provider binding schemas and examples exist locally and `python3 _bmad-output/planning-artifacts/contracts/workflow-commander/validate_contracts.py` passes.
Integration validation: Archon validates create, update, rotate, disable, status, stale, disabled, rotated, missing, and conflicting binding examples without introducing Hermes-specific provider fields or a remove operation.

**Hermes consumer impact:** `hermes-agent` Story 3.2 is blocked until this producer surface exists.

**Acceptance Criteria:**

**Given** Archon stores a Workflow Provider Binding
**When** the binding is created or updated
**Then** Archon persists the controller by project or codebase reference plus generic `provider` and `name`
**And** the record includes the workflow event route or target reference required for event delivery.

**Given** an external controller needs to change an existing Workflow Provider Binding
**When** it invokes `archon provider-binding update --provider archon --name <name> --project-ref <project-ref> --route <event-route> --json`
**Then** Archon returns a `binding.update` command envelope with the updated binding reference and machine-readable result
**And** create remains a distinct command that fails closed instead of silently upserting when update is required.

**Given** a Workflow Provider Binding is inspected
**When** Archon returns status JSON
**Then** the response can represent missing, valid, stale, disabled, rotated, and conflicting states
**And** the response uses the shared status result shape.

**Given** a Workflow Provider Binding needs rotation or disabling
**When** Archon performs the lifecycle action
**Then** Archon returns parseable CLI JSON with correlation id, actor when available, timestamp, resulting binding state, and machine-readable error shape when failed
**And** Archon does not expose Hermes-specific command names or fields.

**Given** a provider binding command receives malformed input or cannot produce valid JSON
**When** the command fails
**Then** Archon returns a machine-readable failure envelope
**And** downstream consumers can fail closed without inspecting human-readable text.

---

### Story 3.3a: Define Shared Workflow Provider Command Envelope

As a controller integrator,
I want workflow provider commands to share one versioned result envelope,
So that external controllers can fail closed and validate command output consistently.

**Requirements Covered:** FR-8.

**Implementation Scope:** Provider-neutral command result envelope, schema version, success flag, correlation id, workflow run reference, binding reference when applicable, machine-readable result payload, machine-readable error shape, timeout classification, and schema mismatch classification.

Depends on: parent Story 1.3a and Archon Story 3.1.
Contract needed: Workflow command success envelope, workflow command error envelope, timeout representation, schema mismatch representation, workflow run reference, binding reference, and correlation id.
Blocking behavior: Command-family producer stories must not start producer code or be completed until the validated local contracts define the shared envelope, the provider command syntax baseline is covered by tests, and the implementation returns parseable JSON for success and failure.
Integration validation: Archon validates success, failure, timeout, malformed request, schema mismatch, and unexpected-state examples without introducing Hermes-specific command names.

**Acceptance Criteria:**

**Given** any workflow control command returns a success result
**When** Archon serializes the response
**Then** the result includes schema version, success flag, correlation id, workflow run reference when applicable, binding reference when applicable, and machine-readable result payload.

**Given** any workflow control command returns a failure result
**When** Archon serializes the response
**Then** the result includes schema version, success flag, correlation id if available, machine-readable error code, diagnostic category, boolean retryability, and machine-readable details.

**Given** a Workflow Commander provider command is implemented
**When** its CLI syntax is exercised with `--json`
**Then** the returned envelope uses the canonical `command` value listed in the provider command syntax baseline
**And** tests fail if the CLI syntax and command identifier drift apart.

**Given** an external controller consumes a workflow control result
**When** malformed JSON, schema mismatch, timeout, unexpected exit code, or unexpected state occurs
**Then** the shared envelope lets the controller fail closed without relying on human-readable output.

---

### Story 3.3b: Provide Archon Start And Status CLI JSON

As a controller integrator,
I want provider `archon` to expose workflow start and status through parseable CLI JSON,
So that external controllers can create and inspect workflow references without using the Archon dashboard.

**Requirements Covered:** FR-8.

**Implementation Scope:** Provider `archon` workflow start and status commands using the shared envelope from Story 3.3a.

Depends on: parent Story 1.3a, Archon Story 3.1, and Archon Story 3.3a.
Contract needed: Workflow command start, status, timeout, success, and error envelope schemas.
Blocking behavior: This story must not move to implementation-ready or be completed unless start and status commands use the validated shared envelope and match local examples.
Integration validation: Archon validates start and status examples for success, failure, timeout, malformed request, and unexpected state without introducing Hermes-specific command names.

**Hermes consumer impact:** `hermes-agent` Story 3.4a is blocked until this producer surface exists.

**Acceptance Criteria:**

**Given** a workflow run can be started from Archon CLI
**When** Archon starts the run
**Then** Archon returns parseable JSON with schema version, success flag, correlation id, workflow run reference, binding reference when applicable, and machine-readable result payload
**And** the command accepts the project cwd or codebase reference needed by the controller contract.

**Given** a workflow run is inspected from Archon CLI
**When** Archon returns status
**Then** the result includes run state, workflow name, workflow run reference, correlation id when available, and machine-readable error shape when failed
**And** the result matches the shared status example.

**Given** a start or status command fails
**When** Archon returns the failure
**Then** the response includes schema version, success flag, correlation id if available, machine-readable error code, and diagnostic category
**And** consumers can fail closed on malformed JSON, schema mismatch, timeout, or unexpected exit code.

---

### Story 3.3c: Provide Archon Provider Decision Command CLI JSON

As a workflow operator,
I want provider `archon` to expose approve and reject through parseable CLI JSON,
So that human gate decisions can be sent through external controllers without relying on human-readable output.

**Requirements Covered:** FR-8 and NFR-14.

**Implementation Scope:** Provider `archon` approve and reject commands using the shared envelope from Story 3.3a.

Depends on: parent Story 1.3a, Archon Story 3.1, Archon Story 3.3a, and Archon Story 3.3b.
Contract needed: Workflow command approve, reject, timeout, success, and error envelope schemas.
Blocking behavior: This story must not move to implementation-ready or be completed unless approve and reject commands use the validated shared envelope and keep command results distinct from human gate decisions.
Integration validation: Archon validates approve and reject examples for success, failure, timeout, malformed request, and unexpected state without introducing Hermes-specific command names.

**Hermes consumer impact:** `hermes-agent` Story 3.4b sends these commands, while Hermes Epic 4 owns authoritative human decision records.

**Acceptance Criteria:**

**Given** a workflow run accepts an approval or rejection
**When** Archon performs the action
**Then** Archon returns parseable JSON for the action result
**And** the result can be consumed without relying on human-readable output.

**Given** an approve or reject command fails
**When** Archon returns the failure
**Then** the response uses the shared workflow command envelope
**And** consumers can fail closed on malformed JSON, schema mismatch, timeout, unexpected state, or unexpected exit code.

---

### Story 3.3d: Provide Archon Recovery Command CLI JSON

As a workflow operator,
I want provider `archon` to expose resume, retry, and cancel through parseable CLI JSON,
So that external controllers can route recovery actions consistently.

**Requirements Covered:** FR-8.

**Implementation Scope:** Provider `archon` resume, retry, and cancel commands using the shared envelope from Story 3.3a.

Depends on: parent Story 1.3a, Archon Story 3.1, Archon Story 3.3a, and Archon Story 3.3b.
Contract needed: Workflow command resume, retry, cancel, timeout, success, and error envelope schemas.
Blocking behavior: This story must not move to implementation-ready or be completed unless resume, retry, and cancel commands use the validated shared envelope and represent unexpected state machine outcomes.
Integration validation: Archon validates resume, retry, cancel, timeout, and unexpected-state examples without introducing Hermes-specific command names.

**Hermes consumer impact:** `hermes-agent` Story 3.4c consumes this producer surface.

**Acceptance Criteria:**

**Given** a workflow run is in a resumable state
**When** Archon executes `workflow.resume`
**Then** it returns the shared success envelope with the resumed workflow run reference and resulting run state
**And** a non-resumable state returns an unexpected-state failure envelope without mutating the run.

**Given** a workflow run can be retried from its failed work
**When** Archon executes `workflow.retry` without `--node`
**Then** it returns the shared success envelope for whole-run recovery
**And** completed work is preserved or skipped according to the existing workflow retry contract.

**Given** a failed workflow node is eligible for targeted retry
**When** Archon executes `workflow.retry --node <node-id>`
**Then** it returns the shared success envelope identifying the requested node and workflow run
**And** an unknown or ineligible node returns a machine-readable failure without starting recovery.

**Given** a workflow run is active and cancellable
**When** Archon executes `workflow.cancel`
**Then** it returns the shared success envelope with the resulting run state
**And** it does not report or serialize the operation as legacy `abandon`.

**Given** any recovery command receives malformed input, times out, exits unexpectedly, produces schema-invalid JSON, or targets an invalid run state
**When** Archon returns the failure
**Then** the response uses the shared failure envelope with code, category, retryability, and structured details
**And** no unsupported state transition is applied.

---

### Story 3.5: Produce Signed Typed Archon Workflow Events From Outbox

As a workflow operator,
I want provider `archon` to emit workflow events through a signed typed event outbox,
So that workflow execution remains independent while Hermes receives compatible event notifications.

**Requirements Covered:** FR-9.

**Implementation Scope:** Provider `archon` event producer, outbox, signature metadata, and delivery attempts.
Keep this story limited to five implementation slices: event-envelope construction, outbox persistence, binding-state routing checks, delivery-attempt status recording, and duplicate-safe idempotency tests.
Do not include Hermes event ingress, reconciliation, Project Work Item mutation, Phase Task mutation, gate mutation, or user-facing diagnostics in this story.
Implementation task gates are:

1. Event-envelope task: construct, sign, and validate event payloads against local examples and rejection fixtures without adding delivery behavior.
2. Durable enqueue task: add outbox storage, migrations, SQLite and PostgreSQL behavior, and enqueue-before-delivery tests.
3. Binding-aware routing task: resolve the provider binding and record not-routable state for missing, stale, disabled, or conflicting bindings without blocking workflow execution.
4. Delivery-state writer task: own all delivery-attempt writes, retry state, last-attempt time, last-error category, terminal failure state, and affected references.
5. Retry and idempotency task: implement retry policy and prove stable event ID and idempotency-key behavior across duplicate-safe redelivery.

Each task is accepted separately and must have focused tests, completion evidence, and a rollback boundary.
Story 3.5 is the sole owner of delivery-state writes and related migrations.

Depends on: parent Story 1.3b, Archon Story 3.1, Archon Story 3.3a, and Archon Story 3.3b.
Contract needed: Workflow event envelope schema, workflow provider event route, binding reference, signature metadata, replay metadata, idempotency key, workflow delivery status shape, and rejection fixtures.
Blocking behavior: This story must not move to implementation-ready or be completed unless shared workflow event examples validate locally and the provider binding surface can supply an event route and binding reference.
Integration validation: Archon validates signed workflow event examples and rejection examples for bad signature, stale timestamp, duplicate event id, wrong binding, unknown project, schema mismatch, and wrong-profile-secret without introducing Hermes-specific Archon model names.

**Hermes consumer impact:** `hermes-agent` Stories 3.6a, 3.6b, and 3.6c consume these events.

**Acceptance Criteria:**

**Given** Archon emits a workflow event for a bound project or codebase
**When** the event is eligible for notification
**Then** Archon writes the event to a non-blocking event outbox
**And** Archon workflow execution continues even if workflow event delivery later fails.

**Given** Archon prepares a workflow event for a project or codebase with a missing, stale, or disabled Workflow Provider Binding
**When** the event would otherwise be queued or delivered
**Then** Archon records a machine-readable delivery-failed or not-routable status
**And** Archon does not deliver the event to a stale or disabled route.

**Given** Archon prepares a workflow event payload for delivery
**When** the payload is serialized
**Then** it includes schema version, event id, event type, occurred timestamp, provider binding reference, workflow run reference, project or codebase reference, signature metadata, and idempotency key
**And** it matches the shared workflow event envelope example.

**Given** workflow event delivery fails, retries, or reaches terminal failure
**When** Archon records delivery status
**Then** it persists retry state, last attempt time if available, last error category, terminal failure state when applicable, and affected workflow run reference
**And** it keeps workflow execution independent from workflow event delivery success.

**Given** Archon emits duplicate or retried workflow event delivery attempts
**When** events are delivered
**Then** each payload carries stable event id and idempotency key values
**And** consumers can detect duplicate-safe delivery from those fields.

---

### Story 3.7: Expose Archon Workflow Event Delivery Health

As a controller integrator,
I want provider `archon` to expose workflow event delivery and outbox health as parseable status,
So that external controllers can distinguish delayed, failed, duplicated, and terminal event delivery states.

**Requirements Covered:** FR-10.

**Implementation Scope:** Provider `archon` read-side delivery-health projection, retry and terminal-failure diagnostics, and CLI status output over delivery state written by Story 3.5.
Story 3.7 does not own delivery-attempt mutations or delivery-state migrations.

Depends on: parent Story 1.3a, parent Story 1.3b, Archon Story 3.1, and Archon Story 3.5.
Contract needed: Workflow delivery status schema, retry state, terminal failure category, duplicate-safe marker, reconciliation-needed marker, workflow run reference, and workflow event reference.
Blocking behavior: This story must not move to implementation-ready or be completed until Story 3.5 provides validated delivery-state writes and Story 3.7 can project that state into every checked-in delivery-status example without mutating delivery attempts.
Integration validation: Archon validates healthy, delayed, retrying, failed, duplicated, terminal failure, and reconciliation-pending examples without blocking workflow execution.

**Hermes consumer impact:** `hermes-agent` Story 3.8 displays this status.

**Acceptance Criteria:**

**Given** Archon workflow event delivery is delayed or retrying
**When** Archon reports delivery status through CLI JSON
**Then** the status includes retry state, last attempt time if available, next action if available, and whether user action is required
**And** the status links to the affected workflow event and workflow run reference.

**Given** Archon workflow event delivery reaches terminal failure
**When** Archon reports the failure
**Then** Archon exposes delivery status, last error category, affected event type, workflow run reference, and recovery option
**And** Archon does not block workflow execution solely because event notification failed.

**Given** Archon retries or redelivers a workflow event
**When** Archon reports outbox health
**Then** the status preserves event id and idempotency key
**And** consumers can classify duplicate delivery without mutating project work.

**Given** a delivery-health query is malformed, references an unknown workflow run or workflow event, or cannot produce schema-valid status JSON
**When** Archon returns the query result
**Then** it returns a machine-readable failure envelope with code, category, retryability, and structured details
**And** it does not mutate workflow execution or delivery-attempt state.
