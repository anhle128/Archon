# DeepSeek mid-turn steering — can we send a message to a running turn?

Scope: `deepseek` only (`packages/providers/src/community/deepseek/`). Read-only research.

**Headline.** Mid-turn is **not possible on the transport Archon uses today**, and this is now
a measured fact, not an inference: DSH hard-rejects a second prompt in 2 ms with
`a prompt is already in flight for this session`. But DSH itself **does** have a mid-turn
message queue — it is exposed on a different DSH transport that Archon does not speak, and the
ACP bridge deliberately surfaces none of it. So the ceiling is a **bridge/transport gap, not an
architectural absence**, and the practical fallback is much better than stop-and-resume.

Evidence tiers used below: **[EXPERIMENT]** = executed locally against the pinned DSH;
**[PROBE]** = runtime introspection of the installed package; **[SOURCE]** = file:line in this
repo; **[SPEC]** = published protocol documentation.

---

## 1. Transport (Q1)

Not an in-process SDK — a **raw subprocess** speaking **ACP JSON-RPC over newline-delimited
JSON on stdio**.

- **[SOURCE]** `acp-client.ts:430-434` — `spawnFn(input.nodeBin, [input.dshEntrypoint, '--profile', input.profile], { cwd, env, stdio: ['pipe','pipe','pipe'] })`
- **[SOURCE]** `acp-client.ts:481-484` — `ndJsonStream(Writable.toWeb(child.stdin), Readable.toWeb(child.stdout))`
- Protocol SDK: **`@agentclientprotocol/sdk@1.4.0`**, a direct dependency
  (`packages/providers/package.json` → `"@agentclientprotocol/sdk": "1.4.0"`; `bun.lock:272`).
- Agent: **`@deepseek-ai/dsh@0.1.2-rc.1`** (`bun.lock:482`), which pins the same ACP SDK 1.4.0
  through `@deepseek-ai/dsh-acp` (`bun.lock:484`). 213 `@deepseek-ai/dsh-*` packages in the tree.
- Profile: `acp`, and **only** `acp` — `config.ts:37-43` throws on anything else:
  _"expected 'acp' because other DSH profiles speak a different protocol."_ `dsh --help` lists
  `acp`, `web`, `headless`, `tui`.

No port, no socket: one child process per turn, stdio only.

## 2. How a turn starts today (Q2)

The prompt is a plain text block — **but** the connection is genuinely bidirectional and stays
live for the whole turn.

- **[SOURCE]** `acp-client.ts:302` — `session/new` (or `:292` `session/resume`)
- **[SOURCE]** `acp-client.ts:345-348` —
  `promptResponse = await ctx.request(methods.agent.session.prompt, { sessionId, prompt: [{ type: 'text', text: outbound }] })`

`ctx` is an ACP `ClientContext` exposing `request` / `notify` **[PROBE]**, and the code already
uses it mid-turn: `acp-client.ts:314-320` fires
`ctx.notify(methods.agent.session.cancel, { sessionId })` while `session/prompt` is still
awaiting. So an inbound channel physically exists. The question is only what the agent accepts
on it.

## 3. Can we send a second user message mid-turn? (Q3) — **No. Measured.**

### 3a. The experiment

Because a real answer needed the agent actually mid-turn, I stood up a fake
OpenAI/DeepSeek-compatible upstream (Bun HTTP server, slow SSE stream, logs every request with
a timestamp and the full message history), pointed DSH at it with
`DEEPSEEK_BASE_URL=http://127.0.0.1:39511` and a dummy `DEEPSEEK_API_KEY` (`env.ts:28` only
checks non-empty), and drove a bare ACP client against the spawned child — deliberately **not**
`driveDeepseekAcpTurn`, which closes the session in its `finally` (`acp-client.ts:364`) and is
single-prompt by construction.

A smoke run confirmed the rig was real before anything else: the fake logged
`POST /chat/completions stream=true msgs=4` and the turn resolved `{"stopReason":"end_turn"}`.

### 3b. Result — concurrent `session/prompt` **[EXPERIMENT]**

```
[acp    630ms] >> prompt A
[acp   5631ms] >> prompt B (A still in flight)
[acp   5634ms] << B REJECTED after 2ms:
                 code=-32602 message="Invalid params: a prompt is already in flight for this session"
[acp  29673ms] << A resolved: {"stopReason":"end_turn"}
```

Upstream log for the whole run: **one** request. `REQ#1` only. Prompt B's text never reached
the model, and A was completely unaffected.

So the guard is:

- **hard** — a JSON-RPC `-32602 invalidParams`, not a queue and not a wait;
- **early** — 2 ms, before any model work;
- **per-session** — keyed on the session, which is the unit Archon uses.

### 3c. Why — no method exists to expose

**[PROBE]** ACP SDK 1.4.0's complete agent-side method set:

```
initialize, authenticate, logout, providers/{list,set,disable},
session/{new, load, list, delete, fork, resume, close, set_mode, set_config_option, prompt, cancel},
nes/{...}, document/{...}
```

No steer, inject, append, follow-up or queue method. The client-side set
(`session/request_permission`, `session/update`, `fs/*`, `terminal/*`, `elicitation/*`) is all
agent→client.

**[SPEC]** agentclientprotocol.com/protocol/prompt-turn: turns are sequential — _"Once a prompt
turn completes, the Client may send another `session/prompt`"_ — and the spec documents no
mid-turn input mechanism at all.

**[PROBE]** DSH's ACP bridge (`@deepseek-ai/dsh-acp`) registers exactly six requests plus one
notification and nothing else:

```js
.onRequest(methods.agent.initialize, …)
.onRequest(methods.agent.session.new, …)      .onRequest(methods.agent.session.list, …)
.onRequest(methods.agent.session.resume, …)   .onRequest(methods.agent.session.close, …)
.onRequest(methods.agent.session.setConfigOption, …)
.onRequest(methods.agent.session.prompt, ({ params, signal }) => implementation.prompt(params, signal))
.onNotification(methods.agent.session.cancel, ({ params }) => implementation.cancel(params))
```

**[EXPERIMENT]** And DSH advertises nothing extra. Live `initialize` handshake (no API key needed):

```json
{
  "protocolVersion": 1,
  "agentInfo": { "name": "deepseek-harness-acp", "version": "0.0.1" },
  "agentCapabilities": {
    "mcpCapabilities": { "http": true },
    "promptCapabilities": { "image": false, "audio": false, "embeddedContext": false },
    "sessionCapabilities": { "close": {}, "list": {}, "resume": {} }
  },
  "authMethods": []
}
```

## 4. The part that changes the answer: DSH _does_ have a mid-turn queue

It is simply not on ACP. **[PROBE]** `@deepseek-ai/dsh-agent` exports an `Inbox` class:

```
Inbox.prototype: append, apply, claim, clear, hasPending, locate, mutate,
                 nextStep, nextTurn, prepend, remove, replace, splice, validate
```

```js
get nextTurn()   { return this.state["next-turn"]; }
get nextStep()   { return this.state["next-step"]; }
get hasPending() { return this.nextTurn.length > 0 || this.nextStep.length > 0; }

claim(target, turn) {
  const claimed = this.mutate("next-step", 0, this.nextStep.length, [], false);
  if (target === "next-turn") claimed.push(...this.mutate("next-turn", 0, 1, [], false));
  for (const message of claimed) this.notifications.claimed(message, turn);
  return claimed;
}
```

Three things matter here:

1. **Two tiers, `next-step` and `next-turn`** — a step-level queue and a turn-level queue.
   That is the same shape every harness with real steering uses (steer now vs. follow up after).
2. **Messages carry ids** — `locate(messageId)`, `replace(messageId, …)`, `remove(messageId)`.
   An operator message could be stamped and tracked.
3. **Three lifecycle notifications per message** — `notifications.inserted(message)` when queued,
   `notifications.claimed(message, turn)` when the agent actually consumes it,
   `notifications.discarded(message)` when it is dropped **[PROBE]**. That is precisely the
   queued → delivered → dropped state machine a steering UI needs, and ACP gives no way to
   surface any of it.

Better still, the queue is **event-sourced into the session log**: `Inbox.mutate` calls
`this.session.append("agent/inbox/spliced", splice)` before mutating **[PROBE]**, so queue state
is durable and replayable rather than in-memory bookkeeping.

It is live machinery, not dead code: **[PROBE]** `@deepseek-ai/dsh-goal-round-driver` drives it
(`agent.inbox.nextStep.some(…)`, `agent.inbox.nextTurn.some(…)`, `agent.inbox.prepend("next-step", message)`).

And it is reachable over DSH's _other_ transport. **[PROBE]**
`@deepseek-ai/dsh-api-session-controller` exports a `SessionController` whose methods are
decorated as RPC endpoints:

```
prototype: attachment, cancel, control, create, follow, fork, inspect, list, modelCatalog,
           page, promote, prompt, rename, resolveAgent, search, selectModel, updateQueue
decorators: _prompt_decorators = [Remote("prompt")];  _cancel_decorators = [Remote("cancel")];
            _updateQueue_decorators = [Remote("updateQueue")];
            _follow_decorators = [Remote({ mode: "stream" })];
            _control_decorators = [Remote({ mode: "stream" })];
```

`updateQueue` → `this.commands.updateQueue(request)` — the RPC that mutates the inbox. This is
the surface DSH's own `web` profile serves (`@deepseek-ai/dsh-api-gateway`, which carries a
`ws` dependency at `bun.lock:502`).

**Honest limit:** I could not prove that `next-step` is drained _during_ a running turn rather
than only between turns. The consumer of `Inbox.claim` lives in a non-exported closure — a sweep
of all 213 `@deepseek-ai/dsh-*` packages for an exported caller found none. The two-tier
`next-step`/`next-turn` split and the per-claim `turn` argument make step-level delivery the
overwhelmingly likely reading, but it is inference, not measurement. Proving it needs a live
`web`-profile session, which is the transport swap itself.

## 5. Id + echo (Q4)

**On ACP today: none.** `session/prompt` resolves exactly once, at end of turn, carrying only a
`stopReason`. There is no message id and no per-message acknowledgement. A "delivered" badge
cannot be honestly rendered.

The id and the echo both exist one layer down — `Inbox` message ids and
`notifications.claimed(message, turn)` — and neither crosses the ACP bridge.

## 6. Session resume (Q5)

Supported, and stronger than the generic fallback.

- **[SOURCE]** `acp-client.ts:290-300` — `session/resume` with `{ sessionId, cwd, mcpServers }`.
- **[SOURCE]** `acp-client.ts:90-96` — `requireAgentCapabilities` hard-fails the turn unless the
  agent advertises both `resume` and `close`; the handshake above confirms DSH advertises both.
- **[PROBE]** DSH guards re-entry: `resumeSession` throws
  `invalidParams: session is already active: <id>` when the session is still live, and
  `session is not resumable` for subagent/child sessions.

Worth stating against the lead's note that every provider declares `sessionResume: true`:
for deepseek, resume is a **cold** path — new process, new session activation, context rebuilt
from persistence. Section 7 shows a materially cheaper option.

## 7. Smallest change that gets us mid-turn (Q6)

### Tier 0 — cancel-and-continue on the **same live connection**. Measured, and good.

Not steering, but far better than stop-and-resume, and it needs no upstream change.
**[EXPERIMENT]**:

```
[acp    559ms] >> prompt A
[acp   6559ms] >> session/cancel
[acp   6579ms] << A resolved after 6020ms: {"stopReason":"cancelled"}
[acp   6579ms] ** cancel -> A resolution latency: 20ms
[acp   6579ms] >> prompt C on the SAME session, no session/close
[acp  31675ms] << C resolved: {"stopReason":"end_turn"}
```

Upstream log for the same run — this is the load-bearing part:

```
[fake  6264ms] REQ#1 POST /chat/completions stream=true msgs=4
                 #1 user:"PROMPT-ALPHA: begin a long task."
[fake  8644ms]   #1 -> CLIENT CANCELLED the upstream stream
[fake  8675ms] REQ#2 POST /chat/completions stream=true msgs=6
                 #2 user:"PROMPT-ALPHA: begin a long task."
                 #2 assistant:"[r1t0][r1t1][r1t2][r1t3]"        ← A's PARTIAL output, retained
                 #2 user:"PROMPT-CHARLIE: here is the extra context you were missing."
```

So after a cancel the model sees the original task, **everything the agent had produced so far**,
and then the operator's new message. Functionally that is one turn of steering with the in-flight
model call sacrificed. The upstream HTTP stream is genuinely aborted, so no tokens are burned
after the cancel.

**Timings, in one clock.** The two logs run on different clocks (the fake started ~2 s before the
probe). Calibrating on the one event both sides see — cancel sent at acp 6559 ms, upstream abort
observed at fake 8644 ms — gives a fake-ahead offset of **≈ 2085 ms**. Converting:

|                            | fake clock | acp clock | delta                     |
| -------------------------- | ---------- | --------- | ------------------------- |
| prompt A issued            | —          | 559 ms    | —                         |
| `REQ#1` (first model call) | 6264 ms    | ≈ 4179 ms | **3620 ms of cold setup** |
| `session/cancel` sent      | —          | 6559 ms   | —                         |
| A resolves `cancelled`     | —          | 6579 ms   | **20 ms**                 |
| prompt C issued            | —          | 6579 ms   | —                         |
| `REQ#2` (new model call)   | 8675 ms    | ≈ 6590 ms | **11 ms**                 |

So the continuation is effectively instant: **31 ms from cancel to the new model call**. The
expensive part is the _first_ turn — ~3.6 s before DSH makes any model call at all, spent
assembling skills and the runtime-context snapshot (the concurrent run shows the same shape:
prompt A at 630 ms → `REQ#1` at ≈ 4556 ms, 3.9 s; the smoke run ≈ 4.0 s).

**That gap is the whole argument for Tier 0.** Cancel-and-continue keeps the process, the session
and the assembled context warm, so it pays ~30 ms. Stop-and-resume — the universal
`sessionResume: true` fallback — pays a process spawn plus `session/resume` plus that ~3.6 s
setup again, every time the operator speaks.

**What has to change in our code** — the mechanics are 90% present, the lifecycle is what blocks it:

1. `acp-client.ts:364` unconditionally calls `session/close` in the `finally`, and
   `acp-client.ts:527` `reapChild`s the process. Both must become conditional so the session and
   the child survive a steer.
2. `driveDeepseekAcpTurn` is shaped for one prompt (`input.prompt` is a single string) — it needs
   to loop while an inbound channel yields messages.
3. `IAgentProvider.sendQuery(prompt: string, …)` has no inbound channel at all. This is the same
   blocker Claude has at `claude/provider.ts:1618`; it is Archon-side work no provider avoids.

Cost to the user: the current model call is aborted and the run still pays for the tokens already
generated. Dead time is ~30 ms. Nothing is lost from the transcript.

**Tested during model streaming only.** The operator's real case is often steering during a long
_tool_ call (a test run, a build). Whether `session/cancel` also kills a running bash child, and
whether a partial tool result is retained in the transcript the way the partial assistant text
was, is untested here. DSH clearly has explicit handling for the case — `@deepseek-ai/dsh-session`
exports `interruptedTurnClosers` **[PROBE]** — but I did not exercise it, so do not assume the
tool-call path behaves identically.

### Tier 1 — real steering: swap the DSH transport. Concrete, but not small.

Speak DSH's `SessionController` RPC (`prompt` / `cancel` / `updateQueue` / `follow` / `control`)
over the `web`-profile API gateway instead of ACP. That is where `updateQueue` lives, and with it
the `next-step` inbox, message ids, and the `claimed` delivery notification — i.e. everything a
proper steering UI needs.

What stands in the way, precisely:

- `config.ts:37-43` hard-rejects any profile but `acp`, so this is not a config flip.
- The whole of `acp-client.ts` (529 lines: handshake, capability assertions, permission
  answering, session update mapping, stderr redaction, child reaping) is ACP-shaped and would
  need a sibling implementation against a WebSocket + the typert RPC protocol
  (`@deepseek-ai/dsh-typert-protocol`), which is undocumented publicly and versioned `0.1.2-rc.1`.
- `event-bridge.ts`'s `mapDeepseekSessionUpdate` maps ACP `session/update` notifications; the
  gateway emits a different event vocabulary.
- The pinned agent is an **rc** build. Betting Archon's deepseek path on its internal RPC surface
  is a real stability risk in a way ACP — a published, versioned spec — is not.

### Tier 2 — upstream ask. Cheaper and more legitimate than it first looks.

**[SPEC]** ACP explicitly sanctions private extensions:

> _"The protocol reserves any method name starting with an underscore (`_`) for custom extensions."_

plus a `_meta` field on every protocol type, with the documented convention that implementations
advertise custom capabilities via `_meta` on the capability objects at `initialize` so clients can
feature-negotiate. Unrecognised custom methods answer `-32601 Method not found`.

So a DSH-side `_session/steer` (or an `updateQueue` passthrough) would be **on-spec, not a
protocol violation** — and DSH already owns every piece behind it: the `next-step` inbox, message
ids, and the three delivery notifications. The ask upstream is small and well-shaped: expose the
existing queue on the bridge, advertise it in `agentCapabilities._meta`, and ACP clients that
don't understand it are unaffected. This is the cheapest real fix in the whole report — it is just
not ours to make. Worth filing; do not plan a schedule around it.

### Recommendation

Tier 0. It is measured, it retains partial output, it costs one aborted model call and ~31 ms,
and it reuses machinery that already exists in `acp-client.ts`. Tier 1 is the only path to true
mid-turn steering for deepseek, and it is a transport rewrite against an rc-versioned private
protocol — worth revisiting only if deepseek becomes a primary harness or upstream stabilises the
gateway API.

---

## Answering the requirement directly

The user's requirement is that **every** provider they use supports mid-turn. For deepseek, on
the transport Archon speaks today, the honest answer is **no**, and the blocking reason is one
line of upstream code: DSH's ACP bridge rejects a concurrent prompt with
`a prompt is already in flight for this session` before doing anything else. No flag, no option,
no SDK upgrade changes that — the method to carry the message does not exist in ACP 1.4.0.

What deepseek _can_ do, today, with Archon-side work only: stop the current model call in 20 ms,
keep the process, the session and all partial output warm, and have the model working on the
operator's message ~31 ms later — versus a spawn plus `session/resume` plus ~3.6 s of context
setup for the generic `sessionResume` fallback. If the product promise is "your message reaches
the agent without losing its work", deepseek can honour that, and cheaply. If the promise is
"without interrupting it", it cannot.

## Unresolved questions

1. **Does `next-step` deliver mid-turn or only between turns?** Strongly implied by the two-tier
   inbox and the `claim(target, turn)` signature; not measured, because the consumer is in a
   closed closure and proving it requires standing up the `web` profile.
2. **What does the typert RPC `updateQueue` request actually accept?** The decorator name is
   confirmed; the payload schema was not recovered from the bundles.
3. **Does `session/cancel` interrupt a running tool call as cleanly as a model stream?** Only the
   streaming case was measured. `interruptedTurnClosers` suggests DSH handles it deliberately;
   untested.
4. **Is the `--patch` overlay a viable middle path?** `dsh --help` documents repeatable plugin-layer
   patches. Whether a patch could register an extra `_`-prefixed handler on the ACP connection is
   unknown — the connection is built inside `dsh-acp`'s `apply` closure, which suggests not, but I
   did not test it. If it works, it collapses Tier 2 into something we could ship ourselves.
5. **Should Tier 0 be built for deepseek alone, or only once the provider contract grows a shared
   inbound channel?** The channel is the majority of the work and is common to every provider.

## Notes

- Report written to the path the lead specified (`archon/plans/reports/scoutsdk-…`), not the
  hook's path (`plans/260912-1405-agent-steering/plans/reports/ScoutSdkProviders-…`).
- Nothing in the repo was modified. The experiment ran from a temporary probe file under
  `packages/providers/` (needed for module resolution) which was deleted in the same shell
  invocation; `git status -- packages/` is clean. The fake upstream and every spawned DSH child
  were killed; `pgrep` confirms none survive.
