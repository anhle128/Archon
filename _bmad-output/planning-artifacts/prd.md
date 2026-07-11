---
title: Archon Planning Handoff - Hermes Agent Workflow Commander
status: handoff
created: '2026-07-11'
updated: '2026-07-11'
source: local materialized Archon slice of the headless Workflow Commander plan
---

# PRD: Archon Slice For Hermes Agent Workflow Commander

## Purpose

Hermes Agent Workflow Commander makes Hermes Agent the human-facing, headless command surface for BMAD planning, Archon workflow execution, GitHub PR state, and local project work.
Archon is the first workflow provider that Hermes controls.
This file defines only the requirements Archon must satisfy as that provider.
All implementation-critical product context for Archon is local to this file and the companion local `architecture.md`, `epics.md`, and `contracts/workflow-commander/README.md`.

## Product Boundary

Workflow Commander v1 is headless.
The user controls workflow work through Hermes commands, agent interactions, structured results, durable pending-gate queries, and existing notification transports when available.
Archon remains a provider implementation and does not become the user-facing command center.

## Scope Owned By Archon

Archon owns the provider `archon` implementation of Workflow Provider Binding, CLI JSON producer contracts, workflow run state, retry behavior, resume behavior, cancel behavior, workflow event production, non-blocking event outbox, delivery status, and signed workflow event production.
Archon must keep controller identity generic through `provider` and `name`.
Archon must avoid Hermes-specific provider fields such as `profile`, `agent_name`, `agent`, or `agent_provider` except when documenting forbidden terms.

## Scope Not Owned By Archon

Archon does not own Project Binding, BMAD mount, cwd enforcement from Hermes, BMAD invocation from Hermes, materialization, Project Work Items, Phase Tasks, HILT Gates, workflow event ingress, Story Status History, reconciliation, diagnostics, or Hermes user interaction.
Those responsibilities belong to `hermes-agent`.
Archon producer stories may identify Hermes consumer stories that are blocked by Archon output, but Archon must not implement the Hermes consumer side.

## Functional Requirements Owned By Archon

### FR-7: Register Generic Workflow Provider Bindings

Archon can create, update, inspect, rotate, disable, and diagnose provider-side Workflow Provider Binding records for a project or codebase using generic `provider` and `name` vocabulary.

**Consequences:**

- Archon persists a reverse binding from project or codebase execution context to controller `provider`, controller `name`, and workflow event route.
- Archon exposes binding status as parseable CLI JSON.
- Archon can represent missing, valid, stale, disabled, rotated, and conflicting binding states.
- Archon returns machine-readable errors for malformed input or invalid lifecycle transitions.
- Archon does not expose Hermes-specific command names or model fields.

### FR-8: Expose Provider Workflow Control Through CLI JSON

Archon exposes start, status, approve, reject, resume, retry, and cancel for workflow runs through CLI JSON.
This is the producer side of the provider adapter that a controller such as Hermes consumes.

**Consequences:**

- Archon returns parseable JSON for every state-changing control result.
- Every result includes schema version, success flag, correlation id, workflow run reference when applicable, binding reference when applicable, machine-readable result payload, and machine-readable error shape when failed.
- Archon classifies timeout, schema mismatch, malformed request, unexpected state, and unexpected exit behavior in a machine-readable way.
- Archon does not expose a state-changing HTTP control path for Workflow Commander v1.

### FR-9: Produce Signed Typed Workflow Events

Archon emits signed typed workflow events for workflow completion, workflow failure, approval requested, delivery failed, and artifact events through a non-blocking outbox.

**Consequences:**

- Archon writes eligible events to durable outbox state before delivery.
- Archon workflow execution continues even when event delivery fails later.
- Every event includes schema version, event id, event type, occurred timestamp, provider binding reference, workflow run reference, project or codebase reference, signature metadata, and idempotency key.
- Archon uses stable event id and idempotency key values so consumers can classify duplicate-safe delivery.
- Archon produces events that can be validated by shared event-envelope and rejection fixtures.

### FR-10: Surface Provider Event Delivery And Outbox Health

Archon reports workflow event delivery and outbox health as structured status.

**Consequences:**

- Archon persists delivery status, retry status, last attempt time when available, last error category, terminal failure state, and affected workflow run reference.
- Archon reports healthy, delayed, retrying, failed, duplicated, terminal failure, and waiting-for-reconciliation states when known.
- Archon exposes delivery status through CLI JSON.
- Archon does not block workflow execution solely because event notification failed.

## Non-Functional Requirements Relevant To Archon

- **NFR-1:** Workflow events accelerate delivery but are not the only source of truth.
- **NFR-5:** Archon events must be signed and schema-versioned so consumers can reject invalid events.
- **NFR-6:** Event secrets and signature metadata must support profile-scoped validation by the consumer.
- **NFR-9:** Archon persists workflow commands, workflow events, and delivery state with enough detail for audit.
- **NFR-14:** Archon error and delivery-health responses expose diagnostic categories and machine-readable detail rather than raw stack traces.
- **NFR-15:** Archon stays within provider ownership boundaries and does not reach into Hermes-owned concerns.
- **NFR-16:** Provider integration surfaces remain generic provider surfaces.
- **NFR-17:** The local handoff is complete enough for isolated Archon implementation agents.

## Local Contract Readiness

The local contract package placeholder is `contracts/workflow-commander/README.md`.
It lists required schema and fixture families for Workflow Provider Binding, workflow command envelopes, workflow event envelopes, delivery status, Archon provider command examples, Archon provider event examples, and callback rejection examples.
The placeholder itself does not satisfy readiness.
Archon producer stories remain blocked until the needed JSON schemas and examples exist locally or are regenerated into this handoff package.

## Cross-Project Dependency Record Shape

Archon stories that depend on another subproject or shared contract work use this record shape:

```text
Depends on: <subproject or parent> Story <id or title>
Contract needed: <API/event/file/interface/schema>
Blocking behavior: <what must exist before this story can be completed>
Integration validation: <how both sides will be proven compatible>
```

The dependency must name a concrete contract family or interface.
Acceptable examples include workflow command envelope, workflow event envelope, Workflow Provider Binding schema, delivery status schema, event route, binding status result, signature metadata, idempotency key, and rejection fixture.

## Implementation Root And Validation

The correct Archon implementation root is `/Users/dale/Desktop/workspace/OceanLabs/workflow-engine/Archon`.
The recommended downstream validation command is `bun run validate`.
This planning story does not require running that command because it changes only local planning handoff files.

## Non-Goals

- Archon does not implement Hermes Project Binding or Hermes Project Work Item storage.
- Archon does not implement Hermes materialization, phase tasks, HILT Gates, Story Status History, reconciliation, diagnostics, or user interaction.
- Archon does not add Hermes-specific provider vocabulary.
- Archon does not add a state-changing HTTP control path for Workflow Commander v1.
- Archon does not mark producer stories ready while required local schemas and fixtures are only placeholders.
