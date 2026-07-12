---
title: Archon Architecture Handoff - Hermes Agent Workflow Commander
status: handoff
created: '2026-07-11'
updated: '2026-07-11'
source: local materialized Archon architecture slice
---

# Architecture: Archon Slice For Hermes Agent Workflow Commander

## Scope

This file contains the Archon-owned architecture guidance for Workflow Commander v1.
It covers Archon as the first workflow provider implementation.
It does not assign Hermes-owned user orchestration, Project Binding, materialization, gates, reconciliation, or diagnostics to Archon.

## Design Paradigm

The system uses bounded contexts plus ports and adapters plus outbox and reconciliation.
Hermes is the human-facing command center and reconciliation owner.
BMAD owns planning and story artifacts.
Workflow providers own workflow execution primitives, workflow run state, retry behavior, approval pauses, event production, and delivery.
Archon is the first workflow provider.

## Archon Ownership Rules

- Archon owns Workflow Provider Binding records keyed by project or codebase execution context plus generic controller `provider` and `name`.
- Archon owns CLI JSON producer surfaces for workflow start, status, approve, reject, resume, retry, and cancel.
- Archon owns workflow run state, retry state, resume behavior, cancel behavior, workflow event production, non-blocking event outbox, delivery status, and signed event production.
- Archon exposes parseable JSON for state-changing control results consumed by external controllers.
- Archon delivers state notifications through signed typed workflow events, not by mutating consumer state directly.
- Archon keeps workflow execution independent from event delivery success.

## Architecture Decisions Relevant To Archon

### AD-2 - Split Project Binding And Workflow Provider Binding Ownership

Hermes owns forward Project Binding data such as profile, cwd, GitHub context, BMAD mount, operational status, and user interaction.
Archon owns the reverse Workflow Provider Binding from project or codebase execution context to generic controller provider, name, and workflow event route.

### AD-3 - Control Workflow Providers Through Adapters And Signed Typed Events

Hermes controls provider `archon` through CLI commands.
Archon CLI command results must include the information needed by a strict adapter: cwd when applicable, stdout, stderr, exit code, timeout, correlation id, and parsed JSON result.
Archon reports workflow state changes through signed typed events delivered from an outbox.

### AD-6 - Split Implementation Ownership By Subproject

Archon owns the provider producer side.
Hermes owns the consumer side, event ingress, project work, gates, status history, reconciliation, diagnostics, and user interaction.
Implementation must preserve this boundary even when both sides reference the same shared contracts.

### AD-7 - Version Every Cross-Subproject Machine Contract

Workflow command envelopes, workflow event envelopes, Workflow Provider Binding records, and delivery status records are JSON, schema-versioned, and compatibility-tested from shared examples before dependent producer or consumer work is complete.
Archon-specific fixtures live under the provider-specific Archon fixture namespace inside the local contract package.

### AD-8 - Ratify The Brownfield Stack And Avoid New Runtime Infrastructure

Archon stays on the existing Bun and TypeScript workspace.
No new runtime, shared database, queue service, or external infrastructure is required for Workflow Commander v1.

### AD-9 - Build Contract-First, Then Split Implementation By Subproject

Archon producer work must not invent field names ahead of the shared contract examples.
Provider binding, command-envelope, event-envelope, delivery-status, signature metadata, idempotency, and rejection fixtures are prerequisites for dependent implementation stories.

### AD-10 - Materialize Isolated Subproject Planning Handoffs Before Implementation

Archon implementation agents use local `prd.md`, `architecture.md`, `epics.md`, and contract-package documentation in this folder.
Implementation-critical context is local to the Archon handoff.

## Consistency Conventions

| Concern                 | Archon Convention                                                                                                                                                                                    |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Controller naming       | Use generic `provider` and `name` vocabulary.                                                                                                                                                        |
| Control direction       | External controllers invoke Archon through CLI JSON only for state-changing Workflow Commander control.                                                                                              |
| Event direction         | Archon reports workflow changes through signed typed events from a non-blocking outbox.                                                                                                              |
| Data format             | Cross-subproject contracts use JSON with explicit schema versions and shared examples.                                                                                                               |
| Command envelope        | Command results include schema version, success flag, correlation id, workflow run reference when applicable, binding reference when applicable, result payload, and error shape.                    |
| Workflow event envelope | Events include schema version, event id, event type, occurred timestamp, provider binding reference, workflow run reference, project or codebase reference, signature metadata, and idempotency key. |
| Delivery status         | Delivery health is stored independently of workflow execution success.                                                                                                                               |

## Stack

| Name              | Version  |
| ----------------- | -------- |
| Archon workspace  | 0.5.0    |
| Bun runtime       | ^1.3.0   |
| TypeScript        | ^5.3.0   |
| Hono              | ^4.12.16 |
| Zod               | ^4.4.3   |
| Hono Zod OpenAPI  | ^1.4.0   |
| @archon/workflows | 0.5.0    |
| @archon/cli       | 0.5.0    |
| @archon/server    | 0.5.0    |
| @archon/core      | 0.4.1    |

## Source Tree Seed

```text
packages/cli/src/commands/
  provider-binding.ts
  workflow.ts
packages/core/src/db/
  provider-bindings.ts
  workflow-event-outbox.ts
packages/workflows/src/
  store.ts
  event-emitter.ts
packages/server/src/
  workflow-events/
```

These are expected implementation areas for later Archon producer stories.
This planning story does not create application code, migrations, tests, or implementation artifacts in those locations.

## Deferred Details

| Deferred Decision                                                         | Owner                                | Gate Before Implementation                                                                                                                  |
| ------------------------------------------------------------------------- | ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Exact provider command names and argument syntax                          | Archon provider owner                | Shared command examples and schema tests exist before producer code merges.                                                                 |
| Exact provider command JSON result schemas                                | Archon with consumer review          | Shared success and error examples pass compatibility tests in both subprojects.                                                             |
| Exact workflow event signature algorithm, replay window, and header names | Archon with consumer security review | Signed, expired, duplicate, wrong-binding, and invalid-schema examples exist.                                                               |
| Exact delivery retry policy                                               | Archon provider owner                | Delivery status fixtures cover healthy, delayed, retrying, failed, terminal failure, duplicate-safe, and waiting-for-reconciliation states. |

## Local Contract Readiness

The local contract package placeholder is `contracts/workflow-commander/README.md`.
It does not satisfy producer story readiness by itself.
Later producer work must create or receive local JSON schemas and examples before moving dependent stories to implementation-ready or writing producer code against placeholder field names.

## Implementation Root And Validation

The correct Archon implementation root is `/Users/dale/Desktop/workspace/OceanLabs/workflow-engine/archon`.
The recommended downstream validation command is `bun run validate`.
