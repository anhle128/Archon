# aion live agent interaction — sections 5, 6 + transfer analysis

Repos read (both indexed in gitnexus):

- `agentic-os-aionui` — Electron/React desktop client, `/Users/dale/Desktop/workspace/OceanLabs/agentic-os-plan/AionUi`, HEAD `8c671bb` (2026-08-24)
- `agentic-os-aioncore` — Rust backend, `/Users/dale/Desktop/workspace/OceanLabs/agentic-os-plan/AionCore`, workspace v0.1.71

Sections 1–4 were delivered in earlier messages. This file carries the cut sentence, sections 5 and 6, and the two transfer lists.

---

## (a) The cut sentence — what `list_stale_runtime_messages` sweeps

Full SQL, `crates/aionui-db/src/repository/sqlite_conversation.rs:1205-1212`:

```sql
SELECT c.user_id, m.* FROM messages m
INNER JOIN conversations c ON c.id = m.conversation_id
WHERE m.position = 'left'
  AND m.status IN ('work', 'pending')
  AND m.type IN ('text', 'thinking', 'tool_call', 'tool_group')
ORDER BY m.created_at ASC
```

It sweeps **assistant-side rows only** (`position = 'left'`) that are still `work`/`pending` and of those four types. `recover_stale_runtime_state_on_startup` (`crates/aionui-conversation/src/startup_recovery.rs:24`) then closes each to `status = "finish"`, hiding empty placeholders and settling tool rows via `settle_tool_row_content`.

**A mid-turn user row is `position = 'right'`, so it never matches the WHERE clause and is never swept.** Confirmed by the comment at `crates/aionui-conversation/src/service.rs:3563-3564`: "the stale-runtime startup cleanup only touches `position='left'` rows — a pending USER (right) row is never swept." The row survives a crash as a durable `pending` message whose badge still reads "not yet consumed" — honest, not lossy, but it never self-heals server-side. The only healing is the client's turn-boundary DB re-pull (`packages/desktop/src/renderer/pages/conversation/Messages/hooks.ts:1045-1060`), whose comment names the exact case: "a row left orphaned by a server restart".

---

## 5. Scope — session, never step

**A steer targets a conversation/turn. There is no notion of addressing a step anywhere in aion.** The two backends differ in _where_ the targeting lives:

**Codex — real wire-level turn targeting.** `turn/steer{threadId, expectedTurnId, input, clientUserMessageId}` (`crates/aionui-session/src/backend/codex_conn.rs:4043-4090`). `expectedTurnId` is read from `self.active_turn_id` and is described as "the optimistic `expectedTurnId` is the gated-steering wire" — optimistic concurrency, retried once against a refreshed id. With no active turn, dispatch returns `Transport("no active turn to steer")` _before writing any frame_, using "the same message as codex's own wire rejection so the caller classifies both uniformly".

**Claude — nothing.** The steer is an unaddressed stdin frame (`crates/aionui-session/src/backend/claude_conn.rs:3269-3298`). The only identifier that travels is `client_msg_id`, stamped as the user frame's `uuid` purely for **correlation** (which message got consumed), never for targeting. Which turn it lands in is decided entirely by the CLI's own kernel queue.

**Targeting is therefore enforced server-side, above the backend.** The service reads `active_turn_id` and passes `turn_id: Some(active_turn_id)` into `SendMessageData` (`service.rs:3720-3726`); `crates/aionui-conversation/src/runtime_state.rs:656` has a test named `a_midturn_send_does_not_mint_a_phantom_turn_id`.

**Nothing here addresses a step.** The nearest analogue is `aionui-team`, whose unit of address is a `slot_id` — a whole peer agent session, not a step in a graph: `ipcBridge.team.interruptAgent.invoke({team_id, slot_id, input, files, reason: 'leader_intervention', queued_policy: 'retain'})` (`packages/desktop/src/renderer/pages/team/components/TeamChatView.tsx:198-213`).

**For our per-node sessions there is no precedent — we would be inventing the node-addressing layer.** The one transferable idea is the _shape_ of `expectedTurnId`: an optimistic id the steer carries so a stale steer is rejected rather than misdelivered. That maps cleanly onto node id + retry epoch.

---

## 6. UI shape

**Composer while busy — always mounted, always enabled; only send semantics change.** `allowSendWhileLoading` is passed unconditionally (`packages/desktop/src/renderer/pages/conversation/platforms/acp/AcpSendBox.tsx:912`). Mid-turn-capable agent: Enter sends straight through, busy or not. Non-capable: `sendDisabled={!supportsMidturnDelivery && isBusy}` (`:823`) with tooltip "The current agent is still working and cannot receive another message yet. Add it to Draft box instead", and `onSendHandler` (`:444-452`) hard-blocks with a toast and returns `false` rather than silently enqueuing — the comment at `:441-443` records that implicit-enqueue was deliberately removed.

**Queued-undelivered item — the Draft box panel**, `packages/desktop/src/renderer/components/chat/CommandQueuePanel.tsx`, rendered directly above the composer and `return null` when empty (`:446`), so it materializes only when something waits. Header: draft-box glyph, title, count pill, mode toggle, "More" dropdown with a confirm-guarded Clear. Each row: one ellipsized preview line, optional file-count chip, three hover-revealed icon buttons — **Send now** (accent `SendOne`), **Edit** (pulls text + files back into the composer), **Remove** (danger). dnd-kit reorder clamped to the vertical axis and to the panel's own bounding rect (`createRestrictToQueueContainerModifier`, `:43`), `min(36vh, 320px)` scroll cap. A separate **"Save to Draft box"** button sits on the composer (`onAddToDraft={handleAddToQueue}`), keyed **only** to a non-empty draft, never to busy state — `AionrsSendBox.tsx:433-438` says tying it to that "racy, async signal made the entry appear/disappear unpredictably".

**Auto/manual toggle — a pill that doubles as the help affordance** (`CommandQueuePanel.tsx:505-526`), so there is no separate "?" button. Reads "Auto send" (primary-tinted) or "Manual send" (neutral fill); hover shows three lines: "Messages you send while the AI is replying wait here" / "**Auto send**: sent automatically one by one after each reply finishes" / "**Manual send**: kept here without sending; use Send now on each."

**Delivery indication — a status flip on the message row, not in the queue.** Once `deliver_midturn` succeeds the item has already left the Draft box and exists as an ordinary right-side bubble carrying `status: 'pending'`. `ipcBridge.conversation.statusChanged.on(...)` (`Messages/hooks.ts:1029-1037`) flips it. The comment is the clearest statement of intent in the feature:

> Flips a mid-turn-delivered user message's badge from "unread" to consumed once the agent actually picks it up (claude `command_lifecycle` Started; codex synthetic receipt). Correlates by `msg_id` — the same server-assigned id `message.userCreated` used to add the row — never by text/time.

So the user sees three states: **in the Draft box** (not sent) → **bubble with an "unread" badge** (delivered to the process, not yet consumed by the model) → **normal bubble** (consumed). Backed by the turn-boundary DB re-pull described in (a).

---

## What we could copy

1. **Stop → promote-to-front → drain-on-gate** (`AcpSendBox.tsx:771-775`). Highest value, because it needs no mid-turn capability at all — it is our existing pause/resume with a queue in front. The hard-won detail: after stopping, do **not** call execute directly; wait for the runtime gate to report ready, or you hit the 409 race the comment names.
2. **Persist-before-deliver with a server-assigned correlation id and a 2-state receipt.** Insert the row, deliver, flip on the echoed id. Crash-safe; gives an honest queued/delivered/consumed UI for free.
3. **Reuse existing status enum values** rather than widening a CHECK constraint (`service.rs:3559-3568`) — directly relevant to our additive-only schema rule.
4. **One capability bit, documented as the only thing UI may gate on** (`packages/desktop/src/common/adapter/ipcBridge.ts:1975-1977`), backed by a static per-backend table (`crates/aionui-session/src/capability.rs:270`) with a test locking it against the real capability constructors (`:288`), defaulting `false` for unknown backends. Maps onto our `capabilities.ts` + `generate:capability-matrix`.
5. **`expectedTurnId` as optimistic concurrency on the steer** — reject a stale steer rather than misdeliver it. For us: node id + retry epoch.
6. **Remove-before-execute to close the double-pick race**, with restore-and-prioritize on failure so a failed send never drops the user's text (`useConversationCommandQueue.ts:888-958`).
7. **Turn-boundary reconciliation backstop** that re-reads DB truth whenever any row still shows `pending` (`Messages/hooks.ts:1045-1060`). Cheap insurance against a missed event.
8. **Auto vs Manual queue mode**, and keying "add to draft" to draft non-emptiness rather than busy state.

---

## What does not transfer — and the SDK-parity verdict

**Verified baseline:** Archon today calls `query({ prompt: queryPrompt, options })` with a plain **string** — `packages/providers/src/claude/provider.ts:1537` types the param `prompt: string`, used at `:1689`. Adopting streaming input is a real provider change, not a flag.

aion makes **two** stdin writes. They are not equally reproducible.

### Write 1 — the steer. SDK analogue: `prompt: AsyncIterable<SDKUserMessage>`. Close, not faithful.

What holds: both hand a user-role frame to a live CLI process, and in both cases **the CLI's own kernel queue — not the caller — decides when it is consumed**. aion's own comment (`claude_conn.rs:3259-3262`) says the next `tool_result` boundary folds it into the current turn, but a **pure-text turn opens a follow-up turn after its `result`**. So even with full stdin ownership aion does **not** get guaranteed mid-turn delivery. We would not be giving up a guarantee by using the SDK, because aion never had one. That materially lowers the cost of the SDK route.

What breaks — **the `uuid` stamp + `--replay-user-messages` echo**. aion's entire delivery-confirmation story depends on stamping its own `uuid` on the outgoing frame (`claude_conn.rs:3267-3268`) and matching claude's replayed echo (`sniff_replay_prompt_ack`, `:1798-1808`) to emit `PromptAccepted`. That is precisely what flips the "unread" → "consumed" badge in §6. It requires (a) authoring the frame and (b) running the CLI with `--replay-user-messages`. The SDK spawns the CLI itself and owns both the envelope and the flags. **If the SDK neither lets us set a message id nor surfaces that echo, the delivered-vs-consumed distinction — the nicest thing in aion's UX — is not reproducible.** This is the single design element that genuinely depends on raw stdin, and the first thing to verify.

### Write 2 — the interrupt. SDK analogue: `query.interrupt()`. Faithful, by aion's own admission.

`interrupt_turn()` writes `control_request{subtype:"interrupt"}` (`claude_conn.rs:1356-1371`), and the comment at `:3200` explicitly claims **"SDK parity: `query.interrupt()`, probe-verified 2.1.168 ends the turn ~immediately"**. aion is asserting the SDK call is equivalent to their own write. Their reason for writing it manually is that they own a long-lived process the SDK would otherwise own — not that the SDK lacks the capability.

Better still, **we already model the aftermath**: `is_interrupt` on PostToolUse yields `toolOutcome: 'interrupted'` (`packages/providers/src/claude/provider.ts:953-959`, locked by a test at `provider.test.ts:2095`). Section 3's transcript question is largely solved for us already.

### Other things that do not transfer

- **Distinguishing claude-minted frames from ours.** The `[Request interrupted]` ghost and tool_result filtering work because aion reads the raw wire and compares uuids (`claude_conn.rs:1803`, `:2739`). Through the SDK we see a typed stream — possibly cleaner, possibly missing the ghost. Unknown.
- **In-band control multiplexing on the same stdin**: `drain_pending_controls` ordering a queued `set_model` before the next prompt (`:1376`), `control_cancel_request` permission retraction (`:5089`), the suspend/`ensure_awake` wake before a steer (`:3276`), the microsecond stdin frame-write lock (`:3288`). None of these are ours to write.
- **`Admission::NoTurn` / `turn_gen` suppression** — aion's own turn FSM. The principle transfers (a steer must not open a phantom turn boundary); the mechanism does not.
- **Codex is a bigger gap than Claude.** `turn/steer` is app-server JSON-RPC aion speaks directly, with a `pending_steers` map, a bounded ack wait (`steer_ack_timeout_ms`), and a one-shot retry on a stale `expectedTurnId` (`codex_conn.rs:4043-4090`). Whether `@openai/codex-sdk` exposes steer at all is unverified — assume not.
- **Pi** has no counterpart anywhere in aion.
- **Per-node scope** — see §5; no precedent exists to copy.

---

## Recommendation

**Build item 1 (stop → promote → drain) first.** Capability-independent, works on all three of our providers today, matches our existing pause/resume machinery, and delivers exactly the UX described (type while busy → queue → Send now). Treat true mid-turn injection as a later, Claude-only enhancement behind a capability bit, and only after the `uuid`-echo question is settled — without that echo the feature ships without its confirmation signal, which is most of its perceived value.

---

## Unresolved questions

1. **Does `@anthropic-ai/claude-agent-sdk` streaming-input mode let the caller set a message id and surface a consumption echo?** Decides whether the delivered-vs-consumed badge is reproducible. I could not inspect SDK types — `node_modules` is blocked by the `scout-block` hook (`/Users/dale/.claude/.ckignore`). A docs check or an unhooked session settles it fast.
2. **Does `@openai/codex-sdk` expose `turn/steer`?** Unverified; assume no.
3. **Claude steer delivery point is CLI-version-dependent**, documented only in an aion comment citing "design spec §6.1/§6甲.2, live 2.1.226" — a spec present in neither repo. Pure-text turns get a _follow-up_ turn, not mid-turn folding. UX copy must not promise "immediate".
4. **`queued_policy: 'retain'`** on team interrupt implies other policies exist (drop?); server-side handler not traced.
5. **Pi mid-turn behavior** — no aion precedent; needs independent investigation for three-provider parity.
