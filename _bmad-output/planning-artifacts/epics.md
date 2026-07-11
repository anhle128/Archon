---
title: Archon Epics Handoff - Hermes Agent Workflow Commander
status: handoff
created: '2026-07-11'
updated: '2026-07-11'
storyOwnershipNote: >
  Story numbering is kept identical to the parent workspace Epic 3 story ids so cross-project references stay stable.
  This file contains only Archon-owned implementation stories.
---

# Archon Epics: Hermes Agent Workflow Commander

## Overview

This file contains the seven Archon-owned Workflow Commander implementation stories.
All seven stories belong to the provider producer side.
They exclude Hermes-owned Project Binding, BMAD mount, cwd enforcement from Hermes, BMAD invocation from Hermes, materialization, Project Work Items, Phase Tasks, HILT Gates, workflow event ingress, Story Status History, reconciliation, diagnostics, and Hermes user interaction.

All stories below depend on local contract readiness before implementation can be considered complete.
The local contract package placeholder is `contracts/workflow-commander/README.md`.
The placeholder documents required schema and fixture families, but it does not satisfy readiness gates.

The correct downstream implementation root is `/Users/dale/Desktop/workspace/OceanLabs/workflow-engine/Archon`.
The recommended downstream validation command is `bun run validate`.

## Archon-Owned Stories

### Story 3.1: Implement Archon Workflow Provider Binding Lifecycle

As an implementation coordinator,
I want Archon to manage provider-neutral reverse event bindings with provider and name identity,
So that external controllers can receive workflow events without Hermes-specific Archon commands or model names.

**Requirements Covered:** FR-7.

**Implementation Scope:** Archon-owned reverse workflow event binding persistence, lifecycle commands, status JSON, and diagnostics for provider `archon`.

Depends on: parent Story 1.3a.
Contract needed: Workflow Provider Binding schema, generic `provider` and `name` vocabulary, event route field, binding status result, and malformed JSON failure envelope.
Blocking behavior: This story cannot be completed until the required provider binding schemas and examples exist locally.
Integration validation: Archon validates create, rotate, disable, status, stale, disabled, rotated, missing, and conflicting binding examples without introducing Hermes-specific provider fields.

**Hermes consumer impact:** `hermes-agent` Story 3.2 is blocked until this producer surface exists.

**Acceptance Criteria:**

**Given** Archon stores a Workflow Provider Binding
**When** the binding is created or updated
**Then** Archon persists the controller by project or codebase reference plus generic `provider` and `name`
**And** the record includes the workflow event route or target reference required for event delivery.

**Given** a Workflow Provider Binding is inspected
**When** Archon returns status JSON
**Then** the response can represent missing, valid, stale, disabled, rotated, and conflicting states
**And** the response uses the shared status result shape.

**Given** a Workflow Provider Binding needs rotation, removal, or disabling
**When** Archon performs the lifecycle action
**Then** Archon returns parseable CLI JSON with correlation id, actor when available, timestamp, resulting binding state, and machine-readable error shape when failed
**And** Archon does not expose Hermes-specific command names or fields.

**Given** a provider binding command receives malformed input or cannot produce valid JSON
**When** the command fails
**Then** Archon returns a machine-readable failure envelope
**And** downstream consumers can fail closed without inspecting human-readable text.

---

### Story 3.3a: Define Shared Workflow Provider Command Envelope

As an implementation coordinator,
I want workflow provider commands to share one versioned result envelope,
So that external controllers can fail closed and validate command output consistently.

**Requirements Covered:** FR-8.

**Implementation Scope:** Provider-neutral command result envelope, schema version, success flag, correlation id, workflow run reference, binding reference when applicable, machine-readable result payload, machine-readable error shape, timeout classification, and schema mismatch classification.

Depends on: parent Story 1.3a and Archon Story 3.1.
Contract needed: Workflow command success envelope, workflow command error envelope, timeout representation, schema mismatch representation, workflow run reference, binding reference, and correlation id.
Blocking behavior: Command-family producer stories cannot be completed until they use the shared envelope and return parseable JSON for success and failure.
Integration validation: Archon validates success, failure, timeout, malformed request, schema mismatch, and unexpected-state examples without introducing Hermes-specific command names.

**Acceptance Criteria:**

**Given** any workflow control command returns a success result
**When** Archon serializes the response
**Then** the result includes schema version, success flag, correlation id, workflow run reference when applicable, binding reference when applicable, and machine-readable result payload.

**Given** any workflow control command returns a failure result
**When** Archon serializes the response
**Then** the result includes schema version, success flag, correlation id if available, machine-readable error code, diagnostic category, and machine-readable details.

**Given** an external controller consumes a workflow control result
**When** malformed JSON, schema mismatch, timeout, unexpected exit code, or unexpected state occurs
**Then** the shared envelope lets the controller fail closed without relying on human-readable output.

---

### Story 3.3b: Provide Archon Start And Status CLI JSON

As an implementation coordinator,
I want provider `archon` to expose workflow start and status through parseable CLI JSON,
So that external controllers can create and inspect workflow references without using the Archon dashboard.

**Requirements Covered:** FR-8.

**Implementation Scope:** Provider `archon` workflow start and status commands using the shared envelope from Story 3.3a.

Depends on: parent Story 1.3a, Archon Story 3.1, and Archon Story 3.3a.
Contract needed: Workflow command start, status, timeout, success, and error envelope schemas.
Blocking behavior: This story cannot be completed until start and status commands use the shared envelope and match local examples.
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

As an implementation coordinator,
I want provider `archon` to expose approve and reject through parseable CLI JSON,
So that human gate decisions can be sent through external controllers without relying on human-readable output.

**Requirements Covered:** FR-8 and FR-14.

**Implementation Scope:** Provider `archon` approve and reject commands using the shared envelope from Story 3.3a.

Depends on: parent Story 1.3a, Archon Story 3.1, Archon Story 3.3a, and Archon Story 3.3b.
Contract needed: Workflow command approve, reject, timeout, success, and error envelope schemas.
Blocking behavior: This story cannot be completed until approve and reject commands use the shared envelope and keep command results distinct from human gate decisions.
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

As an implementation coordinator,
I want provider `archon` to expose resume, retry, and cancel through parseable CLI JSON,
So that external controllers can route recovery actions consistently.

**Requirements Covered:** FR-8.

**Implementation Scope:** Provider `archon` resume, retry, and cancel commands using the shared envelope from Story 3.3a.

Depends on: parent Story 1.3a, Archon Story 3.1, Archon Story 3.3a, and Archon Story 3.3b.
Contract needed: Workflow command resume, retry, cancel, timeout, success, and error envelope schemas.
Blocking behavior: This story cannot be completed until resume, retry, and cancel commands use the shared envelope and represent unexpected state machine outcomes.
Integration validation: Archon validates resume, retry, cancel, timeout, and unexpected-state examples without introducing Hermes-specific command names.

**Hermes consumer impact:** `hermes-agent` Story 3.4c consumes this producer surface.

**Acceptance Criteria:**

**Given** a workflow run accepts resume, retry, or cancel
**When** Archon performs the action
**Then** Archon returns parseable JSON for the action result
**And** the result can be consumed without relying on human-readable output.

**Given** a resume, retry, or cancel command fails
**When** Archon returns the failure
**Then** the response uses the shared workflow command envelope
**And** consumers can fail closed on malformed JSON, schema mismatch, timeout, unexpected state, or unexpected exit code.

---

### Story 3.5: Produce Signed Typed Archon Workflow Events From Outbox

As a workflow operator,
I want provider `archon` to emit workflow events through a signed typed event outbox,
So that workflow execution remains independent while Hermes receives compatible event notifications.

**Requirements Covered:** FR-9.

**Implementation Scope:** Provider `archon` event producer, outbox, signature metadata, and delivery attempts.

Depends on: parent Story 1.3b, Archon Story 3.1, Archon Story 3.3a, and Archon Story 3.3b.
Contract needed: Workflow event envelope schema, workflow provider event route, binding reference, signature metadata, replay metadata, idempotency key, workflow delivery status shape, and rejection fixtures.
Blocking behavior: This story cannot be completed until shared workflow event examples exist locally and the provider binding surface can supply an event route and binding reference.
Integration validation: Archon validates signed workflow event examples and rejection examples for bad signature, stale timestamp, duplicate event id, wrong binding, unknown project, schema mismatch, and wrong-profile-secret without introducing Hermes-specific Archon model names.

**Hermes consumer impact:** `hermes-agent` Stories 3.6a, 3.6b, and 3.6c consume these events.

**Acceptance Criteria:**

**Given** Archon emits a workflow event for a bound project or codebase
**When** the event is eligible for notification
**Then** Archon writes the event to a non-blocking event outbox
**And** Archon workflow execution continues even if workflow event delivery later fails.

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

As an implementation coordinator,
I want provider `archon` to expose workflow event delivery and outbox health as parseable status,
So that external controllers can distinguish delayed, failed, duplicated, and terminal event delivery states.

**Requirements Covered:** FR-10.

**Implementation Scope:** Provider `archon` workflow event delivery status persistence, retry status, terminal failure diagnostics, and CLI status output.

Depends on: parent Story 1.3a, parent Story 1.3b, Archon Story 3.1, and Archon Story 3.5.
Contract needed: Workflow delivery status schema, retry state, terminal failure category, duplicate-safe marker, reconciliation-needed marker, workflow run reference, and workflow event reference.
Blocking behavior: This story cannot be completed until delivery status is persisted independently of workflow execution success.
Integration validation: Archon validates healthy, delayed, retrying, failed, duplicated, terminal failure, and waiting-for-reconciliation examples without blocking workflow execution.

**Hermes consumer impact:** `hermes-agent` Story 3.8 displays this status.

**Acceptance Criteria:**

**Given** Archon workflow event delivery is delayed or retrying
**When** Archon reports delivery status through CLI JSON
**Then** the status includes retry state, last attempt time if available, next action if available, and whether user action is required
**And** the status links to the affected workflow event and workflow run reference.

**Given** Archon workflow event delivery reaches terminal failure
**When** Archon records the failure
**Then** Archon exposes delivery status, last error category, affected event type, workflow run reference, and recovery option
**And** Archon does not block workflow execution solely because event notification failed.

**Given** Archon retries or redelivers a workflow event
**When** Archon reports outbox health
**Then** the status preserves event id and idempotency key
**And** consumers can classify duplicate delivery without mutating project work.
