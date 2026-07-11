# Workflow Commander Shared Contract Package

Status: planned local contract package.
This folder is the Archon-local planning path for Workflow Commander schemas and examples used by Archon producer stories.
This README is a placeholder and does not satisfy downstream contract-readiness gates.

## Required Schemas

- `schemas/workflow-command-envelope.schema.json`
- `schemas/workflow-event-envelope.schema.json`
- `schemas/workflow-provider-binding.schema.json`
- `schemas/workflow-delivery-status.schema.json`

## Required Archon Provider Binding Examples

- `examples/providers/archon/bindings/create-success.json`
- `examples/providers/archon/bindings/rotate-success.json`
- `examples/providers/archon/bindings/disable-success.json`
- `examples/providers/archon/bindings/status-valid.json`
- `examples/providers/archon/bindings/status-stale.json`
- `examples/providers/archon/bindings/status-conflicting.json`
- `examples/providers/archon/bindings/error-malformed-request.json`

## Required Archon Provider Command Examples

- `examples/providers/archon/commands/start-success.json`
- `examples/providers/archon/commands/status-success.json`
- `examples/providers/archon/commands/approve-success.json`
- `examples/providers/archon/commands/reject-success.json`
- `examples/providers/archon/commands/resume-success.json`
- `examples/providers/archon/commands/retry-success.json`
- `examples/providers/archon/commands/cancel-success.json`
- `examples/providers/archon/commands/error-timeout.json`
- `examples/providers/archon/commands/error-schema-mismatch.json`
- `examples/providers/archon/commands/error-malformed-request.json`
- `examples/providers/archon/commands/error-unexpected-state.json`

## Required Archon Provider Event Examples

- `examples/providers/archon/events/workflow-completed.json`
- `examples/providers/archon/events/workflow-failed.json`
- `examples/providers/archon/events/approval-requested.json`
- `examples/providers/archon/events/delivery-failed.json`
- `examples/providers/archon/events/artifact-event.json`

## Required Delivery Status Examples

- `examples/providers/archon/delivery/healthy.json`
- `examples/providers/archon/delivery/delayed.json`
- `examples/providers/archon/delivery/retrying.json`
- `examples/providers/archon/delivery/failed.json`
- `examples/providers/archon/delivery/duplicated.json`
- `examples/providers/archon/delivery/terminal-failure.json`
- `examples/providers/archon/delivery/waiting-for-reconciliation.json`

## Required Rejection Examples For Producer Compatibility

- `examples/callback-rejections/bad-signature.json`
- `examples/callback-rejections/stale-timestamp.json`
- `examples/callback-rejections/duplicate-event-id.json`
- `examples/callback-rejections/wrong-binding.json`
- `examples/callback-rejections/unknown-project.json`
- `examples/callback-rejections/schema-mismatch.json`
- `examples/callback-rejections/wrong-profile-secret.json`

## Readiness Rule

Archon producer stories that emit provider command, workflow event, provider binding, or delivery-health payloads must validate against the relevant local schemas and examples.
Until those schemas and JSON examples exist in this package, the affected Archon producer stories remain blocked.

## Implementation Root And Validation

The correct Archon implementation root is `/Users/dale/Desktop/workspace/OceanLabs/workflow-engine/Archon`.
The recommended downstream validation command is `bun run validate`.
