# Provider steering matrix

How each of the five providers in use accepts a message into a running session, and what it costs to reach it. Every row is evidence, and the **Verified** column says what kind — the citations live in the three `plans/reports/` companions.

Support is a **declared capability that defaults to unsupported** (SPEC constraint). A provider absent from this table is incapable until a row is added for it.

## The five

| Provider     | Mechanism                                                                   | Delivery point                             | Verified                                                  | Cost to reach                                                                                       |
| ------------ | --------------------------------------------------------------------------- | ------------------------------------------ | --------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| **omp**      | Native `steer` command in RPC mode                                          | Between tool calls                         | **Source** — its own repo and shipped docs                | **Lowest.** Switch `--mode json` to `--mode rpc`, keep stdin open, extend the existing event parser |
| **claude**   | Streaming input + `interrupt()`                                             | Next boundary, or immediate                | **Vendor docs**                                           | SDK upgrade from the pinned version, and the prompt changes from a string to an async iterable      |
| **codex**    | `turn/steer`, exposed as `TurnHandle.steer()`                               | Queued into the active turn                | **Documented for the Python SDK; unshown for TypeScript** | Unknown until the pinned types are read                                                             |
| **grok**     | Hooks extension: block at `pre_tool_use`, carry the text in the stop signal | Next tool call                             | **Advertised, never exercised**                           | **Highest.** One-shot mode goes; an ACP client comes in                                             |
| **deepseek** | None. Cancel-and-continue on the warm connection is the fallback            | Immediate, and it costs the in-flight call | **Measured**                                              | Moderate — stop closing the session and reaping the child; loop the turn driver                     |

**Read the table honestly: two rows are yes, one is no, two are unknown.** omp and claude accept a message into a live turn. deepseek cannot — a concurrent prompt is rejected in 2 ms. codex and grok both have a mechanism that exists and a reachability question nobody has answered from our side.

## Per-provider notes that change what gets built

### omp — cheapest, with two traps

`steer` is its **default** streaming behaviour, and its RPC mode emits the same event vocabulary the existing parser already reads, wrapped in an envelope. Its interrupt mode is documented as checking for pending steering between tool calls, and pending steering can abort the remaining tool calls of a turn.

**Trap 1 — use RPC mode, never its ACP mode.** ACP mode _implicitly cancels_ a running turn when a new prompt arrives; the source comment says so outright, calling it identical to an explicit cancel. It looks like steering and behaves like a stop. This is the single most likely wrong turn in the whole feature, because ACP is the more standard-looking of the two doors.

**Trap 2 — the steering queue defaults to one-at-a-time.** `steeringMode` defaults to `"one-at-a-time"`, so sending a queue of three messages does not deliver three. CAP-3's ordering promise needs `set_steering_mode: "all"` or explicit per-item sequencing; it is not free.

Two smaller notes: send `negotiate_protocol` with `protocolVersion: 2` immediately or stdout frames above 1 MiB are lossy, and the event stream carries **no steer-specific event** — so omp cannot confirm delivery either.

### claude — the only one that can confirm delivery

`interrupt()` is documented as available **only in streaming input mode**, so the transport change and the interrupt capability arrive together.

This is also the one provider that can satisfy CAP-6: a caller-set `uuid` on the user message is echoed back, on the result, on the turn's first reply, and on thinking frames. The docs state plainly that a string prompt — which is what Archon passes now — carries none, which is exactly why no delivery signal exists today. The pre-result echo requires a newer SDK than the one pinned.

One caution on wording taken from aion, which owns the raw stdin we would not: even with full frame control they never got _guaranteed_ mid-turn folding — a pure-text turn opens a follow-up turn after its result. The copy must not promise "immediate".

### codex — the mechanism is real, the route to it is not established

`turn/steer` is documented as a **soft injection** queued into the active turn's input, explicitly contrasted with a hard cancel, with a synchronous acknowledgement so a rejection is learned immediately.

The published docs carry it further than the aion report could. Codex's own SDK reference documents `thread.turn(...)` returning a `TurnHandle` with `steer(input)` and `interrupt()` alongside `stream()` and `run()` — so steering is a first-class SDK affordance, not only a wire method. That reference is the **Python** SDK's; the TypeScript README shows `run()` and `runStreamed()` and nothing else.

Archon is on the TypeScript side: `@openai/codex-sdk` 0.144.5, calling `thread.runStreamed(prompt, turnOptions)` (`packages/providers/src/codex/provider.ts:1093`) — the one-shot form, with no handle to steer through. So the question is no longer "does codex support this" but "does the pinned TypeScript SDK expose `turn()`". Reading the installed types answers it in a minute; `node_modules` is blocked by a hook in this session. Until then codex is unknown rather than moderate-cost, and the aion report's "assume not" is now too pessimistic.

### grok — not the method its own client uses

`x.ai/interject` is **not reachable** by a third-party client. Over `grok agent stdio` it answers `-32601 Method not found`, identical to the answer given to a method invented as a control. Settled by handshake; no model call. This closes the `scoutcli` report's first unresolved question, which named exactly this risk.

The channel that remains is the hooks extension the handshake **does** advertise: blocking events include `pre_tool_use`, decisions include deny and block, and the stop signals include a field carrying additional context to the agent. Same delivery point as omp, different door — but advertised is not exercised, and the exact payload shape wants one spike.

A second door exists and is unexplored: the **leader socket** (`~/.grok/leader.sock`, `grok agent leader`, `--leader` — "multiple clients share one backend"). It is the only channel found anywhere in this research that reaches a session the caller did not spawn, which makes it the one lead worth keeping if steering must reach runs the server did not start.

### deepseek — no, and the fallback is a cancel

A second prompt while one is in flight is **rejected in 2 ms** with `-32602 invalid params: a prompt is already in flight for this session` — measured, not inferred. No method in the protocol it speaks could carry a steer, and it advertises no extension for one.

What it can do is cancel-and-continue on the **same open connection**: measured at **31 ms** end to end, with the cancelled turn's partial output **retained** rather than discarded — the agent does not lose what it was doing. The comparison that decides the design: the first turn spends roughly **3.6 seconds** assembling context before any model call, so a cold stop-and-resume pays that again every single time the operator speaks. Keeping the connection warm requires not closing the session and not reaping the child, both of which the code does unconditionally today.

Call it what it is. The report's own closing line is the one to quote in any UI copy: if the promise is "your message reaches the agent without losing its work", deepseek honours it; if the promise is "without interrupting it", it cannot.

Its own agent runtime does have a real steering inbox with two queues, message ids, and three lifecycle notifications; it simply is not exposed on the protocol we speak. The ceiling is a bridge gap, not an architectural absence — and the protocol sanctions `_`-prefixed extensions, so raising it upstream is a small, legitimate ask rather than a violation. File it; do not schedule around it.

## The convergence worth designing around

Three mechanisms deliver at the **same point** — the next tool-call boundary. omp checks for steering between tool calls, grok blocks at `pre_tool_use`, and claude's hook contract has the same shape. That is not coincidence; it is the natural rest point of an agent loop.

So the seam should take **"deliver at the next boundary"** as its default meaning, with immediate interrupt as the special case. Modelling it the other way round — interrupt first, boundary delivery as a degraded mode — inverts the common case into the exception.

## What a steer must carry

Borrowed from aion's `expectedTurnId`, which exists to make a stale steer fail loudly instead of landing in the wrong place: a steer carries the **node id and the retry epoch** it was written against. An attempt that has since been superseded rejects it rather than delivering it to a different run of the same node.
