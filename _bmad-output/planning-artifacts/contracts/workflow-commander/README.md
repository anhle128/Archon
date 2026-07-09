# Workflow Commander Shared Contract Package

Status: planned contract package.
This folder is the required local Archon planning path for shared Hermes Agent Workflow Commander schemas and examples.
Producer implementation stories must not be marked ready until the specific schemas and example fixtures they depend on exist here or are regenerated into this local handoff package.

## Required Schemas

- `schemas/workflow-command-envelope.schema.json`
- `schemas/workflow-event-envelope.schema.json`
- `schemas/workflow-provider-binding.schema.json`
- `schemas/workflow-delivery-status.schema.json`

## Required Archon Provider Command Examples

- `examples/providers/archon/commands/start-success.json`
- `examples/providers/archon/commands/status-success.json`
- `examples/providers/archon/commands/approve-success.json`
- `examples/providers/archon/commands/reject-success.json`
- `examples/providers/archon/commands/resume-success.json`
- `examples/providers/archon/commands/retry-success.json`
- `examples/providers/archon/commands/cancel-success.json`
- `examples/providers/archon/commands/error-malformed-request.json`

## Required Archon Provider Event Examples

- `examples/providers/archon/events/workflow-completed.json`
- `examples/providers/archon/events/workflow-failed.json`
- `examples/providers/archon/events/approval-requested.json`
- `examples/providers/archon/events/delivery-failed.json`
- `examples/providers/archon/events/artifact-event.json`

## Readiness Rule

Archon producer stories that emit provider command, workflow event, provider binding, or delivery-health payloads must validate against the relevant fixtures.
This README is only a placeholder and does not satisfy story readiness.
