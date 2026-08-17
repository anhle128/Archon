# Hermes Archon Approval Notifications Implementation Plan

> **Superseded:** The fixed-platform and fixed-channel Hermes tasks in this plan are superseded by `2026-08-17-hermes-sethome-approval-delivery.md`.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the existing Hermes generic webhook route accept Archon event names and deliver the approved approval-gate message to one fixed project channel without an LLM.

**Architecture:** Keep Hermes product-neutral.
Add root-level camelCase `eventType` to the generic event-name extraction chain, then configure an existing `deliver_only` subscription with the approved template and fixed destination.
Reuse the existing HMAC V2 verifier, nested template renderer, hot-reloaded subscription store, and platform adapter delivery path.

**Tech Stack:** Python, aiohttp, pytest, the Hermes generic webhook adapter, and the existing Hermes CLI.

**Companion Plan:** Complete [the Archon producer plan](2026-08-15-archon-approval-gate-callbacks.md) before the live bridge validation.

## Global Constraints

- Use [the approved design](../specs/2026-08-15-archon-hermes-approval-gate-notification-design.md) as the source of truth.
- Apply source-code changes in `/Users/dale/Desktop/workspace/OceanLabs/workflow-engine/hermes-agent`.
- Read and follow the Hermes `AGENTS.md` before editing.
- Run GitNexus impact analysis for `WebhookAdapter._handle_webhook` before editing and report the blast radius.
- Run GitNexus change detection before the source-code commit.
- Keep the webhook adapter generic and do not add an Archon plugin or product-specific branch.
- Keep `X-GitHub-Event` and `X-GitLab-Event` at their current precedence.
- Accept root-level `eventType` before the existing `event_type` and `type` fallbacks.
- Use `deliver_only`; do not invoke `handle_message` or any LLM.
- Accept only `workflow.approval.requested` on the project subscription.
- Use one fixed platform and one fixed channel ID for the project subscription.
- Use the same HMAC secret that the matching Archon provider binding uses.
- Do not change webhook retry or idempotency behavior in this happy-path plan.

---

## File Map

- Modify `gateway/platforms/webhook.py` to read root-level camelCase `eventType`.
- Modify `tests/gateway/test_webhook_adapter.py` to prove that an HMAC V2 signed Archon envelope passes event filtering.
- Modify `tests/gateway/test_webhook_deliver_only.py` to prove exact fixed-channel delivery and agent bypass.
- Create no new source module, plugin, or dependency.
- Store the live subscription through `hermes webhook subscribe`; do not commit the HMAC secret or destination channel ID.

### Task 1: Accept Archon `eventType` in the Generic Webhook Adapter

**Files:**

- Modify: `gateway/platforms/webhook.py`
- Test: `tests/gateway/test_webhook_adapter.py`

**Interfaces:**

- Consumes: An existing `workflow-event-envelope.v1` JSON body whose root event field is `eventType`.
- Produces: The existing route event filter value with no Archon-specific code path.

- [ ] **Step 1: Run the required impact analysis**

From the Hermes repository, run:

```bash
gitnexus impact \
  --repo hermes-agent \
  --uid 'Method:gateway/platforms/webhook.py:WebhookAdapter._handle_webhook#1' \
  --include-tests \
  --depth 3
```

Record the direct callers, tests, and affected modules in the execution update before editing.

Expected: The blast radius stays inside the generic webhook HTTP path and its tests.

- [ ] **Step 2: Write a failing HMAC V2 event-filter test**

Add this test to `TestEventFilter` in `tests/gateway/test_webhook_adapter.py`.

```python
@pytest.mark.asyncio
async def test_event_filter_accepts_camel_case_event_type(self):
    secret = "archon-shared-secret"
    routes = {
        "archon-approval": {
            "secret": secret,
            "events": ["workflow.approval.requested"],
            "prompt": "Review {workflowRunRef.runId}",
        }
    }
    adapter = _make_adapter(routes=routes)
    adapter.handle_message = AsyncMock()
    body = json.dumps(
        {
            "schemaVersion": "workflow-event-envelope.v1",
            "eventType": "workflow.approval.requested",
            "workflowRunRef": {"runId": "run-1"},
        }
    ).encode()
    timestamp = str(int(time.time()))

    app = _create_app(adapter)
    async with TestClient(TestServer(app)) as cli:
        response = await cli.post(
            "/webhooks/archon-approval",
            data=body,
            headers={
                "Content-Type": "application/json",
                "X-Webhook-Signature-V2": _generic_v2_signature(
                    body, secret, timestamp
                ),
                "X-Webhook-Timestamp": timestamp,
                "X-Request-ID": "archon-event-1",
            },
        )

    assert response.status == 202
    adapter.handle_message.assert_awaited_once()
```

- [ ] **Step 3: Run the test and verify it fails**

Run:

```bash
uv run pytest tests/gateway/test_webhook_adapter.py::TestEventFilter::test_event_filter_accepts_camel_case_event_type -q
```

Expected: FAIL because the adapter resolves the event name to `unknown` and ignores the request.

- [ ] **Step 4: Add the camelCase fallback**

Add one line to the existing event extraction chain in `gateway/platforms/webhook.py`.

```python
event_type = (
    request.headers.get("X-GitHub-Event", "")
    or request.headers.get("X-GitLab-Event", "")
    or payload.get("eventType", "")
    or payload.get("event_type", "")
    or payload.get("type", "")
    or "unknown"
)
```

- [ ] **Step 5: Run the focused adapter test**

Run:

```bash
uv run pytest tests/gateway/test_webhook_adapter.py::TestEventFilter::test_event_filter_accepts_camel_case_event_type -q
```

Expected: PASS.

### Task 2: Prove Fixed-Channel Direct Delivery

**Files:**

- Test: `tests/gateway/test_webhook_deliver_only.py`

**Interfaces:**

- Consumes: The Archon approval envelope fields and the existing `deliver_only` route configuration.
- Produces: The exact approved notification text on the configured fixed channel without an agent call.

- [ ] **Step 1: Write the end-to-end adapter test**

Add this test to `TestDeliverOnlyBypassesAgent`.

```python
@pytest.mark.asyncio
async def test_archon_approval_goes_to_fixed_channel_without_agent(self):
    routes = {
        "archon-approval": {
            "secret": _INSECURE_NO_AUTH,
            "events": ["workflow.approval.requested"],
            "deliver": "telegram",
            "deliver_only": True,
            "deliver_extra": {"chat_id": "project-channel-42"},
            "prompt": (
                "⏸ Approval required\n\n"
                "Project: {projectRef.codebaseRef}\n"
                "Workflow: {workflowRunRef.workflowName}\n"
                "Run: {workflowRunRef.runId}\n"
                "Gate: {payload.approval.nodeId} "
                "({payload.approval.gateType})\n\n"
                "User request:\n{payload.approval.userPrompt}\n\n"
                "Review:\n{payload.approval.reviewUrl}"
            ),
        }
    }
    adapter = _make_adapter(routes)
    target = _wire_mock_target(adapter)
    adapter.handle_message = AsyncMock()
    payload = {
        "eventType": "workflow.approval.requested",
        "projectRef": {"codebaseRef": "archon"},
        "workflowRunRef": {
            "workflowName": "archon-speckit-feature",
            "runId": "run-1",
        },
        "payload": {
            "approval": {
                "nodeId": "clarify-gate",
                "gateType": "plannotator_gate",
                "userPrompt": "Add the requested workflow capability.",
                "reviewUrl": "https://archon-host.example.ts.net:19432",
            }
        },
    }

    app = _create_app(adapter)
    async with TestClient(TestServer(app)) as cli:
        response = await cli.post(
            "/webhooks/archon-approval",
            json=payload,
            headers={"X-Request-ID": "archon-event-2"},
        )

    assert response.status == 200
    adapter.handle_message.assert_not_awaited()
    target.send.assert_awaited_once_with(
        "project-channel-42",
        "⏸ Approval required\n\n"
        "Project: archon\n"
        "Workflow: archon-speckit-feature\n"
        "Run: run-1\n"
        "Gate: clarify-gate (plannotator_gate)\n\n"
        "User request:\nAdd the requested workflow capability.\n\n"
        "Review:\nhttps://archon-host.example.ts.net:19432",
        metadata=None,
    )
```

- [ ] **Step 2: Run both focused webhook files**

Run:

```bash
uv run pytest tests/gateway/test_webhook_adapter.py tests/gateway/test_webhook_deliver_only.py -q
```

Expected: PASS.

- [ ] **Step 3: Run GitNexus change detection**

From the Hermes repository, run:

```bash
gitnexus detect-changes --repo hermes-agent --scope unstaged
```

Confirm that it reports only the generic webhook extraction and its two test files.

- [ ] **Step 4: Commit the generic compatibility change**

```bash
git add gateway/platforms/webhook.py tests/gateway/test_webhook_adapter.py tests/gateway/test_webhook_deliver_only.py
git commit -m "fix(webhook): accept camel case event types"
```

### Task 3: Configure the Live Approval-Only Subscription

**Files:**

- Runtime state only: `~/.hermes/webhook_subscriptions.json` through the Hermes CLI.

**Interfaces:**

- Consumes: `HERMES_DELIVER_PLATFORM`, `HERMES_PROJECT_CHANNEL_ID`, and the shared `ARCHON_PROVIDER_BINDING_HMAC_KEY` value.
- Produces: `/webhooks/archon-approval` with one accepted event, one fixed channel, and direct delivery.

- [ ] **Step 1: Confirm the required operator values**

Run:

```bash
test -n "${HERMES_DELIVER_PLATFORM:-}"
test -n "${HERMES_PROJECT_CHANNEL_ID:-}"
test -n "${ARCHON_PROVIDER_BINDING_HMAC_KEY:-}"
```

Expected: all commands exit with code 0.
If any value is absent, stop before changing the live Hermes subscription and ask the operator for that value.

- [ ] **Step 2: Create or update the fixed subscription**

Run from the Hermes repository:

```bash
hermes webhook subscribe archon-approval \
  --events "workflow.approval.requested" \
  --prompt $'⏸ Approval required\n\nProject: {projectRef.codebaseRef}\nWorkflow: {workflowRunRef.workflowName}\nRun: {workflowRunRef.runId}\nGate: {payload.approval.nodeId} ({payload.approval.gateType})\n\nUser request:\n{payload.approval.userPrompt}\n\nReview:\n{payload.approval.reviewUrl}' \
  --deliver "${HERMES_DELIVER_PLATFORM}" \
  --deliver-chat-id "${HERMES_PROJECT_CHANNEL_ID}" \
  --deliver-only \
  --secret "${ARCHON_PROVIDER_BINDING_HMAC_KEY}"
```

Expected: Hermes reports the route URL, `workflow.approval.requested`, the fixed delivery platform, and direct-delivery mode.

- [ ] **Step 3: Inspect the subscription without exposing the secret**

Run:

```bash
hermes webhook list
```

Expected: `archon-approval` uses the correct event, delivery platform, and fixed channel.
Do not print or commit `~/.hermes/webhook_subscriptions.json`.

### Task 4: Validate Hermes and the Live Bridge

**Files:**

- Verify only: the source and runtime configuration from Tasks 1 through 3.

**Interfaces:**

- Consumes: The completed Archon producer plan, a running Hermes gateway, and a running `archon serve` process.
- Produces: Evidence that only gate callbacks reach the fixed channel and that both review-link types open through Tailscale.

- [ ] **Step 1: Run the Hermes regression suite**

Run from the Hermes repository:

```bash
scripts/run_tests.sh
```

Expected: PASS.

- [ ] **Step 2: Check the gateway health endpoint**

Run:

```bash
curl --fail --silent --show-error http://127.0.0.1:8644/health
```

Expected: a healthy Hermes gateway response.

- [ ] **Step 3: Connect the Archon binding**

Set `HERMES_ARCHON_WEBHOOK_URL` to the URL printed by `hermes webhook subscribe`.
Set `ARCHON_PROJECT_REF` to the Archon codebase ID.
Set `ARCHON_PUBLIC_URL` to the Tailscale-reachable Archon web origin.
Keep `ARCHON_PROVIDER_BINDING_HMAC_KEY` set to the shared secret from Task 3.
Confirm all values without printing them.

```bash
test -n "${HERMES_ARCHON_WEBHOOK_URL:-}"
test -n "${ARCHON_PROJECT_REF:-}"
test -n "${ARCHON_PUBLIC_URL:-}"
test -n "${ARCHON_PROVIDER_BINDING_HMAC_KEY:-}"
```

Run the status command from the Archon repository.

```bash
bun run cli provider-binding status \
  --provider archon \
  --name workflow-engine-primary \
  --json
```

If the status is `missing`, run:

```bash
bun run cli provider-binding create \
  --provider archon \
  --name workflow-engine-primary \
  --project-ref "${ARCHON_PROJECT_REF}" \
  --route "${HERMES_ARCHON_WEBHOOK_URL}" \
  --event-types workflow.approval.requested \
  --json
```

If the binding exists, run:

```bash
bun run cli provider-binding update \
  --provider archon \
  --name workflow-engine-primary \
  --project-ref "${ARCHON_PROJECT_REF}" \
  --route "${HERMES_ARCHON_WEBHOOK_URL}" \
  --event-types workflow.approval.requested \
  --json
```

Expected: the command reports success.
Do not paste the secret into source files, logs, or the plan.

- [ ] **Step 4: Run the standard approval smoke test**

Start a small Archon workflow that reaches an `approval` gate.
Verify that the fixed project channel receives one message with the complete workflow trigger request.
Open the review URL and verify that it opens the Archon run detail page through Tailscale.

- [ ] **Step 5: Run the Plannotator smoke test**

Start a small Archon workflow that reaches a `plannotator_gate`.
Verify that the fixed project channel receives one message after the gate enters `waiting_decision`.
Open the review URL and verify that it opens the live Plannotator page through Tailscale.

- [ ] **Step 6: Verify the approval-only boundary**

Complete one workflow and inspect the Hermes gateway access log.
Verify that Archon did not make HTTP requests for workflow start or completion events on this binding.

- [ ] **Step 7: Inspect the final Hermes worktree**

Run:

```bash
git status --short
git diff --check
```

Expected: no uncommitted source changes and no whitespace errors.
