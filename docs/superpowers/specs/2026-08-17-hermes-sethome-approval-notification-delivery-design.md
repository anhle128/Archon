# Hermes `/sethome` Approval Notification Delivery — Design Spec

**Date:** 2026-08-17

**Status:** Approved

**Supersedes:** The fixed-platform and fixed-channel Hermes delivery design in `2026-08-15-archon-hermes-approval-gate-notification-design.md`.

## Summary

Archon sends a signed `workflow.approval.requested` callback to Hermes without selecting a messaging platform or channel.
Hermes accepts the callback and delivers the rendered notification to every configured home channel.
The operator controls these destinations through the existing `/sethome` mechanism.
The webhook returns `202 Accepted` after it schedules internal delivery and does not report the final platform delivery result to Archon.

## Goals

- Reuse Hermes home-channel configuration and cross-platform delivery behavior.
- Send each approval notification to every configured home channel.
- Keep Archon independent of Slack, Telegram, Discord, and platform channel identifiers.
- Keep direct approval notifications deterministic and free of LLM calls.
- Keep the implementation small and preserve unrelated webhook behavior.

## Non-Goals

- Do not add a durable webhook delivery queue or extend the final-response delivery ledger.
- Do not add new retry behavior.
- Do not route approval notifications back to the conversation that started the workflow.
- Do not select one preferred home channel when several home channels exist.
- Do not change existing direct-delivery behavior for webhook routes that select an explicit platform.

## Existing Hermes Behavior

`/sethome` stores one home channel for each configured platform.
Several platform homes can exist at the same time.
Hermes already resolves a platform without an explicit `chat_id` to that platform's home channel.
Hermes already uses the delivery target `all` for cron fan-out to all configured home channels.
The generic webhook adapter already provides HMAC verification, event filtering, idempotency, template rendering, background-task tracking, and cross-platform delivery.

The final-response delivery ledger does not cover `deliver_only` webhook notifications.
This design does not extend it.
Delivery is best-effort after Hermes accepts the request.

## Subscription Contract

The Archon approval subscription uses this routing configuration:

```yaml
events:
  - workflow.approval.requested
deliver_only: true
deliver: all
```

The subscription does not contain `deliver_extra.chat_id` or another fixed destination.
Hermes resolves `all` when it processes the notification, so later `/sethome` changes apply without changing the subscription.

The existing deterministic message template remains unchanged:

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

## Request Flow

1. Archon sends the signed approval event to the Hermes webhook route.
2. Hermes verifies the signature, applies rate limits, checks the event filter, and rejects duplicate delivery identifiers with the existing logic.
3. Hermes renders the message template.
4. Hermes creates a tracked background task for `deliver: all`.
5. Hermes returns `202 Accepted` to Archon without waiting for any messaging platform.
6. The background task reads the current configured platform homes.
7. The task calls the existing cross-platform delivery path once for each platform that has a home channel.
8. Each platform delivery succeeds or fails independently.

Archon treats the HTTP response as confirmation that Hermes accepted the notification.
Archon does not receive or store the final Slack, Telegram, Discord, or other platform result.

## Hermes Implementation Boundary

The webhook adapter recognizes `deliver: all` before it parses a normal platform name.
It selects configured platforms that have a home channel and delegates each send to the existing `_deliver_cross_platform()` method without an explicit `chat_id`.
That method continues to own adapter lookup and home-channel resolution.

The webhook adapter tracks the delivery coroutine in its existing `_background_tasks` set.
It catches and logs task failures so they do not become unhandled asynchronous exceptions.
The existing synchronous behavior remains unchanged for `deliver_only` routes that name one explicit target.

The root-level camelCase `eventType` extraction remains required because Archon uses that field in `workflow-event-envelope.v1`.

## Failure Behavior

Hermes returns `202 Accepted` after it schedules the `all` delivery task.
It does not change the HTTP response after an adapter failure.

If no home channel exists, the task logs a warning and finishes.
If one platform send fails, the task logs the failure and continues with the remaining home channels.
Hermes does not add a retry, persistent receipt, or restart recovery mechanism for this path.

The existing webhook idempotency cache prevents a duplicate request with the same delivery identifier from scheduling another task while that cache entry exists.
The cache remains process-local and keeps its current expiry behavior.

## Test Design

- A signed Archon payload with root-level `eventType` passes the configured event filter.
- A `deliver: all` route renders the notification and does not call the agent handler.
- A `deliver: all` route returns `202 Accepted` before platform delivery completes.
- Two configured home channels each receive the rendered notification.
- One failed platform delivery does not prevent another configured home from receiving the notification.
- A route with no configured home channel still returns `202 Accepted` and performs no send.
- Existing explicit-platform `deliver_only` tests retain their current synchronous behavior.

## Configuration and Documentation Changes

The deployed Archon approval subscription changes from a fixed platform and `chat_id` to `deliver: all`.
The fixed-channel Hermes test for Archon notifications is replaced with home-channel fan-out coverage.
Older setup instructions must stop asking for a Slack channel or a delivery chat ID.
They must instruct the operator to run `/sethome` in each destination that should receive approval notifications.

## Rollback

Changing the subscription from `deliver: all` back to an explicit platform restores the previous routing without an Archon change.
Reverting the Hermes `all` webhook handling removes fan-out while leaving the existing explicit-platform direct-delivery path intact.
