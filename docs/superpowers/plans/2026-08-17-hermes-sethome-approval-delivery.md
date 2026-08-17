# Hermes `/sethome` Approval Delivery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.
> Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make an Archon approval webhook return `202 Accepted` and deliver its deterministic message to every current Hermes `/sethome` destination.

**Architecture:** Keep Archon independent of messaging platforms.
Add the existing Hermes `all` routing intent to the `deliver_only` webhook path, run only that fan-out in the adapter's existing background-task set, and reuse `_deliver_cross_platform()` for each home.
Keep explicit-platform webhook delivery synchronous and unchanged.

**Tech Stack:** Python, asyncio, aiohttp, pytest, the Hermes generic webhook adapter, the existing Hermes CLI, and GitNexus.

## Global Constraints

- Follow the Hermes repository `AGENTS.md` before changing Hermes code.
- Start the implementation from a clean `origin/main` worktree.
- Preserve the existing dirty `archon-approval-webhook` worktree and its unrelated commits and local LSP test changes.
- Keep root-level camelCase `eventType` support for `workflow-event-envelope.v1`.
- Use `deliver_only: true` with `deliver: all` and no `deliver_extra.chat_id` for the Archon subscription.
- Resolve all home destinations at delivery time from Hermes configuration.
- Preserve the `thread_id` or topic stored by `/sethome`.
- Return `202 Accepted` after the background task is scheduled.
- Treat adapter send results as Hermes-internal outcomes.
- Do not add a queue, delivery ledger integration, retry loop, callback, dependency, or Archon platform field.
- Keep existing explicit-platform `deliver_only` responses at `200` on success and `502` on delivery failure.
- Use `scripts/run_tests.sh` for every Hermes Python test command.
- Run GitNexus impact analysis before editing each affected symbol.
- Run GitNexus change detection before each Hermes commit.
- Do not add an agent name as a commit co-author.

---

## File Map

### Hermes repository

- Modify `gateway/platforms/webhook.py` to accept camelCase Archon event names, schedule `deliver: all`, fan out to configured homes, and preserve a home thread or topic.
- Modify `tests/gateway/test_webhook_deliver_only.py` to replace the fixed-channel Archon case with behavior tests for all-home asynchronous delivery.
- Verify `tests/gateway/test_webhook_integration.py` to protect the existing explicit-platform delivery path.
- Change runtime state only through `hermes webhook subscribe`; do not edit `webhook_subscriptions.json` directly.

### Archon repository

- Do not change Archon production code.
- Use `docs/superpowers/specs/2026-08-17-hermes-sethome-approval-notification-delivery-design.md` as the accepted contract.
- Keep `docs/superpowers/plans/2026-08-15-hermes-archon-approval-notifications.md` marked as superseded for Hermes destination routing.

---

### Task 1: Implement asynchronous all-home webhook delivery

**Files:**

- Modify: `gateway/platforms/webhook.py:584-871`
- Modify: `gateway/platforms/webhook.py:1256-1413`
- Test: `tests/gateway/test_webhook_deliver_only.py:1-280`
- Verify: `tests/gateway/test_webhook_integration.py`

**Interfaces:**

- Consumes: `GatewayRunner.config.platforms`, `PlatformConfig.home_channel`, `HomeChannel.chat_id`, `HomeChannel.thread_id`, `WebhookAdapter._background_tasks`, and `WebhookAdapter._deliver_cross_platform(platform_name: str, content: str, delivery: dict) -> SendResult`.
- Produces: `WebhookAdapter._deliver_all_home_channels(content: str) -> None` and a `202` JSON acknowledgment for `deliver_only` routes whose target is `all`.
- Preserves: The synchronous return contract for every explicit platform and `github_comment` target.

- [ ] **Step 1: Create a clean Hermes worktree without touching the existing dirty worktree**

Run from the Hermes repository root:

```bash
git fetch origin main
git worktree add .worktrees/webhook-sethome-approval -b feat/webhook-sethome-approval origin/main
cd .worktrees/webhook-sethome-approval
git status --short --branch
```

Expected: the new branch is based on `origin/main`, and the new worktree is clean.
Do not reset, clean, stash, or modify `.worktrees/archon-approval-webhook`.

- [ ] **Step 2: Refresh GitNexus and confirm the blast radius before editing**

Run from the new Hermes worktree:

```bash
gitnexus status
gitnexus analyze
gitnexus impact _handle_webhook --repo hermes-agent --file gateway/platforms/webhook.py --kind Method --direction upstream --depth 3 --include-tests
gitnexus impact _direct_deliver --repo hermes-agent --file gateway/platforms/webhook.py --kind Method --direction upstream --depth 3 --include-tests
gitnexus impact _deliver_cross_platform --repo hermes-agent --file gateway/platforms/webhook.py --kind Method --direction upstream --depth 3 --include-tests
```

Expected: the index matches the new worktree commit.
The current measured risk is LOW: `_direct_deliver` has two direct callers, and `_deliver_cross_platform` has two direct callers and six affected symbols in total.
If the refreshed result reports HIGH or CRITICAL risk, stop and report it before editing.

- [ ] **Step 3: Replace the fixed-channel test setup with reusable home-channel fixtures**

In `tests/gateway/test_webhook_deliver_only.py`, import `HomeChannel` and add these helpers below `_wire_mock_target()`:

```python
from gateway.config import HomeChannel, Platform, PlatformConfig


async def _drain_background_tasks(adapter: WebhookAdapter) -> None:
    while adapter._background_tasks:
        await asyncio.gather(*tuple(adapter._background_tasks))


def _wire_mock_homes(
    adapter: WebhookAdapter,
    homes: dict[Platform, HomeChannel],
    results: dict[Platform, SendResult] | None = None,
) -> dict[Platform, AsyncMock]:
    configured_results = results or {}
    targets: dict[Platform, AsyncMock] = {}
    runner = MagicMock()
    runner.adapters = {}
    runner.config.platforms = {}

    for platform, home in homes.items():
        target = AsyncMock()
        target.send = AsyncMock(
            return_value=configured_results.get(
                platform,
                SendResult(success=True),
            )
        )
        targets[platform] = target
        runner.adapters[platform] = target
        runner.config.platforms[platform] = PlatformConfig(
            enabled=True,
            home_channel=home,
        )

    runner.config.get_home_channel.side_effect = lambda platform: (
        runner.config.platforms[platform].home_channel
        if platform in runner.config.platforms
        else None
    )
    adapter.gateway_runner = runner
    return targets
```

Keep the existing `_wire_mock_target()` helper because explicit-platform regression tests still use it.

- [ ] **Step 4: Write the failing Archon fan-out test**

Replace `test_archon_approval_goes_to_fixed_channel_without_agent` with this test:

```python
@pytest.mark.asyncio
async def test_archon_approval_fans_out_to_home_channels_without_agent(
    self, monkeypatch
):
    routes = {
        "archon-approval": {
            "secret": _INSECURE_NO_AUTH,
            "events": ["workflow.approval.requested"],
            "deliver": "all",
            "deliver_only": True,
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
    targets = _wire_mock_homes(
        adapter,
        {
            Platform.TELEGRAM: HomeChannel(
                platform=Platform.TELEGRAM,
                chat_id="telegram-home",
                name="Telegram Ops",
                thread_id="topic-7",
            ),
            Platform.SLACK: HomeChannel(
                platform=Platform.SLACK,
                chat_id="slack-home",
                name="Slack Ops",
            ),
        },
    )
    handle_message = AsyncMock()
    monkeypatch.setattr(adapter, "handle_message", handle_message)
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
    expected = (
        "⏸ Approval required\n\n"
        "Project: archon\n"
        "Workflow: archon-speckit-feature\n"
        "Run: run-1\n"
        "Gate: clarify-gate (plannotator_gate)\n\n"
        "User request:\nAdd the requested workflow capability.\n\n"
        "Review:\nhttps://archon-host.example.ts.net:19432"
    )

    app = _create_app(adapter)
    async with TestClient(TestServer(app)) as cli:
        response = await cli.post(
            "/webhooks/archon-approval",
            json=payload,
            headers={"X-Request-ID": "archon-event-2"},
        )
        assert response.status == 202
        assert await response.json() == {
            "status": "accepted",
            "route": "archon-approval",
            "target": "all",
            "delivery_id": "archon-event-2",
        }
        await _drain_background_tasks(adapter)

    handle_message.assert_not_awaited()
    targets[Platform.TELEGRAM].send.assert_awaited_once_with(
        "telegram-home",
        expected,
        metadata={"thread_id": "topic-7"},
    )
    targets[Platform.SLACK].send.assert_awaited_once_with(
        "slack-home",
        expected,
        metadata=None,
    )
```

This test also proves that the Archon camelCase `eventType` passes the event filter.

- [ ] **Step 5: Add failing tests for acknowledgment timing and independent failures**

Add these tests to `TestDeliverOnlyBypassesAgent`:

```python
@pytest.mark.asyncio
async def test_all_returns_202_before_home_delivery_finishes(self):
    routes = {
        "r": {
            "secret": _INSECURE_NO_AUTH,
            "deliver": "all",
            "deliver_only": True,
            "prompt": "approval pending",
        }
    }
    adapter = _make_adapter(routes)
    targets = _wire_mock_homes(
        adapter,
        {
            Platform.TELEGRAM: HomeChannel(
                platform=Platform.TELEGRAM,
                chat_id="telegram-home",
                name="Telegram Ops",
            )
        },
    )
    started = asyncio.Event()
    release = asyncio.Event()

    async def _blocked_send(chat_id, content, metadata=None):
        started.set()
        await release.wait()
        return SendResult(success=True)

    targets[Platform.TELEGRAM].send.side_effect = _blocked_send

    app = _create_app(adapter)
    async with TestClient(TestServer(app)) as cli:
        response = await cli.post(
            "/webhooks/r",
            json={},
            headers={"X-Request-ID": "delivery-blocked"},
        )
        assert response.status == 202
        await asyncio.wait_for(started.wait(), timeout=1)
        assert adapter._background_tasks
        release.set()
        await _drain_background_tasks(adapter)


@pytest.mark.asyncio
async def test_all_continues_after_one_home_rejects_delivery(self, caplog):
    routes = {
        "r": {
            "secret": _INSECURE_NO_AUTH,
            "deliver": "all",
            "deliver_only": True,
            "prompt": "approval pending",
        }
    }
    adapter = _make_adapter(routes)
    targets = _wire_mock_homes(
        adapter,
        {
            Platform.TELEGRAM: HomeChannel(
                platform=Platform.TELEGRAM,
                chat_id="telegram-home",
                name="Telegram Ops",
            ),
            Platform.SLACK: HomeChannel(
                platform=Platform.SLACK,
                chat_id="slack-home",
                name="Slack Ops",
            ),
        },
        {
            Platform.TELEGRAM: SendResult(
                success=False,
                error="telegram unavailable",
            )
        },
    )

    app = _create_app(adapter)
    async with TestClient(TestServer(app)) as cli:
        response = await cli.post(
            "/webhooks/r",
            json={},
            headers={"X-Request-ID": "delivery-partial"},
        )
        assert response.status == 202
        await _drain_background_tasks(adapter)

    targets[Platform.TELEGRAM].send.assert_awaited_once()
    targets[Platform.SLACK].send.assert_awaited_once()
    assert "telegram unavailable" in caplog.text


@pytest.mark.asyncio
async def test_all_accepts_when_no_home_channel_exists(self, caplog):
    routes = {
        "r": {
            "secret": _INSECURE_NO_AUTH,
            "deliver": "all",
            "deliver_only": True,
            "prompt": "approval pending",
        }
    }
    adapter = _make_adapter(routes)
    runner = MagicMock()
    runner.adapters = {}
    runner.config.platforms = {}
    adapter.gateway_runner = runner

    app = _create_app(adapter)
    async with TestClient(TestServer(app)) as cli:
        response = await cli.post(
            "/webhooks/r",
            json={},
            headers={"X-Request-ID": "delivery-no-home"},
        )
        assert response.status == 202
        await _drain_background_tasks(adapter)

    assert "no configured home channels" in caplog.text
```

- [ ] **Step 6: Run the new tests and confirm the current implementation fails**

Run:

```bash
scripts/run_tests.sh tests/gateway/test_webhook_deliver_only.py -k "archon_approval_fans_out or all_returns_202 or all_continues or all_accepts"
```

Expected: FAIL because `all` is currently parsed as an unknown platform and direct delivery waits for a result instead of returning `202`.

- [ ] **Step 7: Implement the minimal asynchronous `all` branch**

In `WebhookAdapter._handle_webhook()`, add this branch after the existing direct-delivery log call and before the synchronous `try` block:

```python
if delivery["deliver"] == "all":
    task = asyncio.create_task(
        self._deliver_all_home_channels(prompt)
    )
    self._background_tasks.add(task)
    task.add_done_callback(self._background_tasks.discard)
    return web.json_response(
        {
            "status": "accepted",
            "route": route_name,
            "target": "all",
            "delivery_id": delivery_id,
        },
        status=202,
    )
```

Do not move the existing synchronous explicit-target code.

- [ ] **Step 8: Add the all-home fan-out helper**

Add this method before `_direct_deliver()` in `gateway/platforms/webhook.py`:

```python
async def _deliver_all_home_channels(self, content: str) -> None:
    """Deliver content to every configured home channel."""
    runner = self.gateway_runner
    if runner is None:
        logger.warning(
            "[webhook] all-home delivery skipped: no gateway runner"
        )
        return

    home_platforms = []
    for platform, platform_config in runner.config.platforms.items():
        home = platform_config.home_channel
        if home is not None and home.chat_id:
            home_platforms.append(platform)

    if not home_platforms:
        logger.warning(
            "[webhook] all-home delivery skipped: "
            "no configured home channels"
        )
        return

    for platform in home_platforms:
        try:
            result = await self._deliver_cross_platform(
                platform.value,
                content,
                {"deliver_extra": {}},
            )
        except Exception as exc:
            logger.warning(
                "[webhook] all-home delivery raised platform=%s: %s",
                platform.value,
                exc,
            )
            continue

        if not result.success:
            logger.warning(
                "[webhook] all-home delivery failed platform=%s error=%s",
                platform.value,
                result.error or "unknown delivery error",
            )
```

Keep the loop sequential because the existing Hermes delivery router also delivers sequentially, and background execution already removes HTTP latency.

- [ ] **Step 9: Preserve the home thread in the shared cross-platform path**

In `_deliver_cross_platform()`, keep the resolved `home` and use its thread only when `deliver_extra` does not provide one:

```python
extra = delivery.get("deliver_extra", {})
chat_id = extra.get("chat_id", "")
home = None
if not chat_id:
    home = self.gateway_runner.config.get_home_channel(target_platform)
    if home:
        chat_id = home.chat_id
    else:
        return SendResult(
            success=False,
            error=f"No chat_id or home channel for {platform_name}",
        )

metadata = None
thread_id = (
    extra.get("message_thread_id")
    or extra.get("thread_id")
    or (home.thread_id if home else None)
)
if thread_id:
    metadata = {"thread_id": thread_id}
```

An explicit `deliver_extra` thread remains higher precedence than the home thread.

- [ ] **Step 10: Keep camelCase Archon event extraction**

In `_handle_webhook()`, keep this order in the event type expression:

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

This line is required when the clean branch starts from `origin/main`.

- [ ] **Step 11: Run the focused regression suite**

Run:

```bash
scripts/run_tests.sh \
  tests/gateway/test_webhook_deliver_only.py \
  tests/gateway/test_webhook_adapter.py \
  tests/gateway/test_webhook_integration.py
```

Expected: PASS with no flaky retry report.
The explicit Telegram test must still return `200`, and its rejected-send test must still return `502`.

- [ ] **Step 12: Inspect the change graph and commit the Hermes implementation**

Run:

```bash
git diff --check
gitnexus detect-changes --scope unstaged --repo hermes-agent
git status --short
```

Expected: only `gateway/platforms/webhook.py` and `tests/gateway/test_webhook_deliver_only.py` are changed.
Expected GitNexus risk: LOW, limited to webhook receipt and delivery paths.

Commit:

```bash
git add gateway/platforms/webhook.py tests/gateway/test_webhook_deliver_only.py
git commit -m "feat(webhook): fan out notifications to home channels"
```

### Task 2: Validate Hermes and open the focused pull request

**Files:**

- Verify only: all Hermes source and tests from Task 1.
- External change: push `feat/webhook-sethome-approval` and open one pull request against Hermes `main`.

**Interfaces:**

- Consumes: The clean Task 1 commit.
- Produces: Full-suite evidence and a Hermes PR that contains no unrelated commits.

- [ ] **Step 1: Read the contribution rules and check for a duplicate PR**

Run from `.worktrees/webhook-sethome-approval`:

```bash
sed -n '1,320p' CONTRIBUTING.md
gh pr list \
  --repo anhle128/hermes-agent \
  --state open \
  --search "webhook home channel"
```

Expected: the contribution rules are understood, and no open PR already implements `deliver: all` for webhook home channels.

- [ ] **Step 2: Run the full Hermes test suite**

Run from `.worktrees/webhook-sethome-approval`:

```bash
scripts/run_tests.sh
```

Expected: PASS with no flaky retry report.
If a failure also reproduces on `origin/main`, fix it in a separate branch and PR so this PR remains focused.

- [ ] **Step 3: Compare the final branch with `main`**

Run:

```bash
gitnexus detect-changes --scope compare --base-ref main --repo hermes-agent
git diff --check origin/main...HEAD
git log --oneline origin/main..HEAD
git status --short --branch
```

Expected: one feature commit, two changed files, LOW impact, and a clean worktree.

- [ ] **Step 4: Push the clean feature branch**

Run:

```bash
git push --set-upstream origin feat/webhook-sethome-approval
```

Expected: the remote branch contains only the focused feature commit.

- [ ] **Step 5: Create the Hermes pull request with the repository template filled**

Run:

```bash
gh pr create \
  --base main \
  --head feat/webhook-sethome-approval \
  --title "feat(webhook): fan out notifications to home channels" \
  --body $'## What does this PR do?\n\nAdds the existing `all` routing intent to `deliver_only` webhook routes. Hermes returns `202 Accepted`, then sends the rendered notification to every current `/sethome` destination without an agent call. Explicit-platform direct delivery keeps its existing synchronous HTTP contract.\n\n## Related Issue\n\nN/A — this is the Hermes side of the Archon approval notification integration.\n\n## Type of Change\n\n- [ ] 🐛 Bug fix (non-breaking change that fixes an issue)\n- [x] ✨ New feature (non-breaking change that adds functionality)\n- [ ] 🔒 Security fix\n- [ ] 📝 Documentation update\n- [ ] ✅ Tests (adding or improving test coverage)\n- [ ] ♻️ Refactor (no behavior change)\n- [ ] 🎯 New skill (bundled or hub)\n\n## Changes Made\n\n- Added asynchronous `deliver: all` handling in `gateway/platforms/webhook.py`.\n- Reused configured home channels and the existing cross-platform sender.\n- Preserved `/sethome` thread and topic metadata.\n- Replaced the fixed-channel Archon test with all-home behavior coverage.\n\n## How to Test\n\n1. Run `scripts/run_tests.sh tests/gateway/test_webhook_deliver_only.py tests/gateway/test_webhook_adapter.py tests/gateway/test_webhook_integration.py`.\n2. Run `scripts/run_tests.sh`.\n3. Configure two platform homes with `/sethome`, post a signed `deliver: all` webhook, and confirm both homes receive the rendered message while HTTP returns 202.\n\n## Checklist\n\n### Code\n\n- [x] I have read the Contributing Guide.\n- [x] My commit messages follow Conventional Commits.\n- [x] I searched for existing PRs to make sure this is not a duplicate.\n- [x] My PR contains only changes related to this feature.\n- [x] I ran the repository test wrapper and all tests pass.\n- [x] I added tests for my changes.\n- [x] I tested on macOS.\n\n### Documentation & Housekeeping\n\n- [x] Relevant webhook docstrings and tests describe the behavior.\n- [x] `cli-config.yaml.example` is not applicable because no config key changed.\n- [x] `CONTRIBUTING.md` and `AGENTS.md` are not applicable because no workflow changed.\n- [x] Cross-platform impact is covered through adapter mocks and the shared delivery path.\n- [x] Tool descriptions and schemas are not applicable.\n\n## Screenshots / Logs\n\nFocused webhook tests and the full Hermes suite pass. No UI changed.'
```

Expected: a PR against `main` with only the two Task 1 files.

### Task 3: Migrate the live subscription and verify the bridge

**Files:**

- Runtime state only: the active Hermes profile's `webhook_subscriptions.json`, changed through the Hermes CLI.
- Verify only: the existing Archon provider binding and approval producer.

**Interfaces:**

- Consumes: A Hermes runtime that contains Task 1, `ARCHON_PROVIDER_BINDING_HMAC_KEY`, the existing `archon-approval` route URL, and at least one `/sethome` destination.
- Produces: One approval-only subscription with `deliver: all`, no fixed `chat_id`, and best-effort internal delivery to every configured home.

- [ ] **Step 1: Configure each desired Hermes destination through `/sethome`**

In every chat, channel, thread, or topic that must receive approval notifications, send:

```text
/sethome
```

Expected: Hermes replies that the current location is now the home channel.
Run this once on each platform that must receive the same approval notification.

- [ ] **Step 2: Confirm the shared secret and route without printing the secret**

Run:

```bash
test -n "${ARCHON_PROVIDER_BINDING_HMAC_KEY:-}"
test -n "${HERMES_ARCHON_WEBHOOK_URL:-}"
```

Expected: both commands exit with code 0.

- [ ] **Step 3: Replace the fixed-channel subscription through the Hermes CLI**

Run from the Hermes repository:

```bash
hermes webhook subscribe archon-approval \
  --events "workflow.approval.requested" \
  --prompt $'⏸ Approval required\n\nProject: {projectRef.codebaseRef}\nWorkflow: {workflowRunRef.workflowName}\nRun: {workflowRunRef.runId}\nGate: {payload.approval.nodeId} ({payload.approval.gateType})\n\nUser request:\n{payload.approval.userPrompt}\n\nReview:\n{payload.approval.reviewUrl}' \
  --deliver all \
  --deliver-only \
  --secret "${ARCHON_PROVIDER_BINDING_HMAC_KEY}"
```

Expected: Hermes reports `Updated webhook subscription: archon-approval`, `workflow.approval.requested`, `Deliver: all`, and direct-delivery mode.
The omitted `--deliver-chat-id` removes the old `deliver_extra.chat_id` when the CLI replaces the route.

- [ ] **Step 4: Inspect the subscription through the safe CLI output**

Run:

```bash
hermes webhook list
```

Expected: `archon-approval` shows `workflow.approval.requested` and `all (direct — no agent)`.
Do not print or commit the subscription file because it contains the HMAC secret.

- [ ] **Step 5: Send one signed webhook probe**

Run without printing `ARCHON_PROVIDER_BINDING_HMAC_KEY`:

```bash
HERMES_TEST_BODY='{"eventType":"workflow.approval.requested","projectRef":{"codebaseRef":"archon"},"workflowRunRef":{"workflowName":"archon-speckit-feature","runId":"sethome-smoke"},"payload":{"approval":{"nodeId":"clarify-gate","gateType":"plannotator_gate","userPrompt":"Verify Hermes home delivery.","reviewUrl":"https://archon-host.example.ts.net:19432"}}}'
HERMES_TEST_TIMESTAMP="$(date +%s)"
HERMES_TEST_SIGNATURE="$(printf '%s.%s' "${HERMES_TEST_TIMESTAMP}" "${HERMES_TEST_BODY}" | openssl dgst -sha256 -hmac "${ARCHON_PROVIDER_BINDING_HMAC_KEY}" -hex | sed 's/^.* //')"
curl --fail --silent --show-error \
  -H 'Content-Type: application/json' \
  -H 'X-Request-ID: sethome-smoke-1' \
  -H "X-Webhook-Timestamp: ${HERMES_TEST_TIMESTAMP}" \
  -H "X-Webhook-Signature-V2: ${HERMES_TEST_SIGNATURE}" \
  --data-raw "${HERMES_TEST_BODY}" \
  "${HERMES_ARCHON_WEBHOOK_URL}"
unset HERMES_TEST_BODY HERMES_TEST_TIMESTAMP HERMES_TEST_SIGNATURE
```

Expected HTTP body:

```json
{"status": "accepted", "route": "archon-approval", "target": "all", "delivery_id": "sethome-smoke-1"}
```

Verify that every configured home receives the same rendered message.
Verify that a home configured inside a thread or topic receives the message inside that thread or topic.

- [ ] **Step 6: Verify the existing Archon binding remains approval-only**

Run from the Archon repository:

```bash
bun run cli provider-binding status \
  --provider archon \
  --name workflow-engine-primary \
  --json
```

Expected: the binding state is `active`, and its health is `valid`.
The command does not expose the stored route or event allowlist.
Do not mutate the binding because this delivery change does not alter either value.

- [ ] **Step 7: Run one real Archon approval smoke test**

Run from the Archon repository:

```bash
bun run cli workflow run archon-speckit-feature \
  --branch smoke/hermes-sethome-notification \
  "Verify that approval notifications reach all Hermes home channels."
```

Expected: when the workflow reaches its first human gate, Archon records `workflow.approval.requested`, its outbox receives a successful `202` acknowledgment, and every current Hermes home receives one notification.
Open the review URL from one delivered message and confirm that it opens the active Archon or Plannotator review surface.

- [ ] **Step 8: Record final evidence and keep both repositories clean**

Run:

```bash
git -C /Users/dale/Desktop/workspace/OceanLabs/workflow-engine/hermes-agent/.worktrees/webhook-sethome-approval status --short --branch
git -C /Users/dale/Desktop/workspace/OceanLabs/workflow-engine/archon/worktrees/archon-hermes-approval-bridge status --short --branch
```

Expected: the Hermes worktree is clean and tracks its PR branch.
Expected: the Archon worktree contains only already-committed plan or PR work.
