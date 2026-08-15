# Archon to Hermes Approval Gate Notification — Design Spec

**Date:** 2026-08-15

**Status:** Approved for implementation planning

## Summary

Archon will send a signed callback to Hermes only when a workflow reaches a human approval gate.
Hermes will render a fixed message and deliver it to one configured project channel without calling an LLM.
The message will identify the project, workflow, run, gate, user request, and direct review URL.
The design reuses the Archon event outbox and the Hermes generic webhook adapter.
It does not add a new bridge service.

## Current System

Archon already has a typed `workflow.approval.requested` event, a durable event outbox, provider bindings, HMAC V2 signing, delivery attempts, and retry dispatch in `archon serve`.
Archon currently emits external workflow start, completion, failure, and approval events through the same binding.
The provider binding does not currently have an event allowlist.

Hermes already has a generic webhook adapter that validates the same HMAC V2 format that Archon sends.
Hermes can render nested payload fields into a message template and send the result to Telegram, Slack, Discord, or another configured platform through `deliver_only` mode.
Hermes stores a fixed `deliver_chat_id` on each webhook subscription.
Hermes currently reads event names from `event_type` or `type`, but Archon sends the root field as `eventType`.

The latest Archon Plannotator implementation receives a live URL through `PLANNOTATOR_READY_FILE`.
It validates the URL and stores it as `metadata.approval.reviewUrl` when the gate enters `waiting_decision`.
The Archon dashboard already uses this value for its **Open Plannotator** action.
The Plannotator gate does not currently create an `approval_requested` workflow event.

## Goals

- Archon sends an external callback only for human approval gates on the Hermes binding.
- One Archon project maps to one fixed Hermes destination channel.
- The notification is deterministic and does not use an LLM.
- The notification contains the original user message that triggered the workflow.
- The notification contains a direct review URL.
- A Plannotator notification opens the current live Plannotator session.
- A standard gate notification opens the Archon run detail page.
- Existing outbox, signing, routing, and platform delivery code remains the transport path.

## Non-Goals

- The bridge will not send workflow start, progress, completion, or failure notifications to Hermes.
- The bridge will not route a notification to the user or conversation that started the workflow.
- The bridge will not call a Hermes agent or use an LLM to summarize the gate.
- The bridge will not add a dedicated Hermes workflow-event consumer.
- The bridge will not implement Project Work materialization, gate reconciliation, or workflow control from Hermes.
- The happy-path implementation will not add durable webhook receipts or new retry behavior.
- The design assumes that the Archon web server and Plannotator review hosts are reachable through the operator's Tailscale network.

## Architecture Boundaries

### Archon

Archon owns gate readiness, workflow identity, the original user request, and review URL selection.
The workflow engine emits an internal `approval_requested` event only after the gate state is durable.
The core store adapter enriches the external event with data from the workflow run.
The provider binding decides which external event types can enter the outbox.
The existing dispatcher signs and sends the event.
Archon does not contain Hermes platform or channel logic.

### Hermes

Hermes owns the destination platform, destination channel, and notification template.
The existing generic webhook adapter verifies the request and performs direct delivery.
Hermes does not fetch workflow data from Archon.
Hermes does not infer or construct Archon review URLs.

### Plannotator

Plannotator remains the live review surface for `plannotator_gate`.
No further Plannotator change is required for this bridge.
Archon uses the live URL that Plannotator already publishes.

## Gate Selection

The bridge sends notifications for these human gate types:

- `approval`
- `interactive_loop`
- `writeback`
- `plannotator_gate`

The bridge does not notify for `child_workflow`.
That state records that a parent waits for a child run, and it does not request a separate human decision on the parent.
The real human gate in the child run produces its own notification.

For standard approvals and interactive loops, the current pre-pause `approval_requested` write moves to after a successful pause.
For a writeback gate, Archon creates `approval_requested` after the writeback pause is durable.
For a Plannotator gate, Archon creates `approval_requested` after the transition to `waiting_decision` stores the live `reviewUrl`.
Each new Plannotator review cycle can therefore publish its current URL.

## Provider Binding Event Allowlist

The workflow provider binding gains an additive `event_types` field.
The field stores a JSON array of external workflow event names.
An empty array keeps the current behavior and allows every supported external event type.
This default preserves all existing bindings.

The provider-binding CLI gains an `--event-types` option for create and update operations.
The Hermes binding is configured with only this value:

```text
workflow.approval.requested
```

Archon continues to write all internal workflow events to its audit log.
After route resolution, the store adapter compares the external event type with the binding allowlist.
A disallowed event does not enter the outbox and does not cause an HTTP callback.

The binding schema change is additive in both SQLite and PostgreSQL.
The new column has a non-null default so older Archon writers remain compatible.

## Review URL Selection

`ARCHON_PUBLIC_URL` defines the HTTP or HTTPS origin that users open through Tailscale.
The value is normalized without a trailing slash.

For `plannotator_gate`, the external event uses the live `metadata.approval.reviewUrl` value.
Archon emits this event only after that URL exists.

For every other human gate, Archon builds this URL:

```text
${ARCHON_PUBLIC_URL}/console/p/${projectRef}/r/${runId}
```

The route opens the existing console run detail page, which contains the approval controls and gate context.

## Event Contract

The existing envelope remains `workflow-event-envelope.v1`.
The event type remains `workflow.approval.requested`.
The workflow name, run ID, and project references remain in the envelope.
The approval payload adds the gate-specific notification fields.

```json
{
  "schemaVersion": "workflow-event-envelope.v1",
  "provider": "archon",
  "eventId": "evt_example",
  "eventType": "workflow.approval.requested",
  "occurredAt": "2026-08-15T08:00:00.000Z",
  "bindingRef": {
    "provider": "archon",
    "name": "workflow-engine-primary",
    "bindingId": "wpb_example",
    "projectRef": "project-codebase-id"
  },
  "workflowRunRef": {
    "provider": "archon",
    "runId": "workflow-run-id",
    "workflowName": "archon-speckit-feature",
    "projectRef": "project-codebase-id"
  },
  "projectRef": {
    "id": "project-codebase-id",
    "codebaseRef": "archon",
    "repositoryPath": "/workspace/archon",
    "defaultBranch": "dev"
  },
  "idempotencyKey": "archon:workflow-engine-primary:evt_example",
  "payload": {
    "state": "waiting-for-approval",
    "approval": {
      "requestId": "approval:workflow-run-id:clarify-gate",
      "requestedAction": "approve-or-reject",
      "phase": "clarify-gate",
      "gateType": "plannotator_gate",
      "nodeId": "clarify-gate",
      "message": "Review the generated clarification document.",
      "userPrompt": "Add the requested workflow capability.",
      "reviewUrl": "https://archon-host.example.ts.net:19432"
    }
  }
}
```

`userPrompt` comes from `workflow_run.user_message`.
It is the user's workflow trigger message, not a system prompt and not a workflow node prompt.
The complete value is sent because this deployment expects short trigger messages.

## Hermes Subscription

Hermes fixes event extraction so the generic webhook adapter recognizes root-level `eventType` in addition to the existing formats.
The subscription also declares `workflow.approval.requested` as its accepted event.
This check protects the destination even though the Archon binding already filters outbound events.

The subscription uses the same secret as `ARCHON_PROVIDER_BINDING_HMAC_KEY` for the matching Archon binding.
The Archon binding route points to the Hermes webhook subscription URL.
The subscription selects the platform and fixed project channel with `deliver` and `deliver_chat_id`.
The subscription enables `deliver_only`.

Hermes renders this fixed message:

```text
⏸ Approval required

Project: {projectRef.codebaseRef}
Workflow: {workflowRunRef.workflowName}
Run: {workflowRunRef.runId}
Gate: {payload.approval.nodeId} ({payload.approval.gateType})

User request:
{payload.approval.userPrompt}

Review:
{payload.approval.reviewUrl}
```

The raw URL stays visible so each supported chat platform can make it clickable without a platform-specific message format.

## Happy-Path Sequence

1. A workflow reaches a human approval gate.
2. Archon stores the paused gate state.
3. A Plannotator gate waits until the live review URL is stored.
4. Archon writes one internal `approval_requested` event with gate data.
5. The core store adapter reads the workflow run and adds the original user message and selected review URL.
6. The provider binding allowlist accepts only `workflow.approval.requested`.
7. Archon writes the signed event body to the existing outbox.
8. `archon serve` dispatches the event to the matching Hermes webhook route.
9. Hermes verifies HMAC V2 and recognizes `eventType`.
10. Hermes renders the fixed notification template.
11. Hermes sends the message to the configured project channel.
12. The user selects the review URL and opens the correct review surface.

## Happy-Path Tests

### Archon

- An approval node pauses the run before it creates the external approval event.
- An interactive loop pause creates the same external approval event shape.
- A writeback pause creates the same external approval event shape.
- A Plannotator gate creates no approval event while it is opening.
- A Plannotator gate creates an approval event after `waiting_decision` stores the live review URL.
- The external payload contains the workflow trigger message from `user_message`.
- A normal gate uses the configured Archon run detail URL.
- A Plannotator gate uses the live Plannotator URL.
- A Hermes binding with the approval-only allowlist does not put start, completion, or failure events into the outbox.
- SQLite and PostgreSQL binding schemas expose the same new column.

### Hermes

- A signed Archon envelope with root-level `eventType` passes the event filter.
- The nested template fields render the expected notification text.
- `deliver_only` sends the text to the configured fixed channel without invoking the agent handler.

### Local Integration

- Start the Hermes gateway with one approval-only subscription and a fixed test channel.
- Start `archon serve` with the matching provider binding and HMAC secret.
- Run a small workflow that reaches a standard approval gate and verify the Archon run detail link.
- Run a small workflow that reaches a Plannotator gate and verify the live Plannotator link through Tailscale.
- Verify that workflow start and completion do not produce Hermes HTTP callbacks for this binding.

## Deferred Work

Delivery failure handling, retry corrections, durable idempotency across Hermes restarts, typed Hermes workflow ingress, and Project Work reconciliation are deferred.
They can be designed separately after the happy-path bridge works end to end.

## Implementation Constraint

The implementation must reuse the existing outbox, dispatcher, HMAC signer, generic webhook adapter, template renderer, and platform delivery path.
It must not create a new bridge daemon, a Hermes-specific Archon adapter, or an LLM notification path.
