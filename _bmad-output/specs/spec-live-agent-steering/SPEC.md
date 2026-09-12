---
id: SPEC-live-agent-steering
companions:
  - provider-steering-matrix.md
  - engine-integration.md
  - control-states.md
  - ../../../plans/reports/aionscout-260912-aion-live-interaction.md
  - ../../../plans/reports/scoutcli-260912-midturn-cli-providers.md
  - ../../../plans/reports/scoutsdk-260912-midturn-sdk-providers.md
  - ../../project-context.md
---

> **Canonical contract.** This SPEC and the files in `companions:` are the complete contract for what to build. The three `plans/reports/` companions are required reading, not background: they carry the `file:line` citations and the measured numbers every constraint below was derived from, including two results that overturned earlier conclusions. `provider-steering-matrix.md` holds the per-provider mechanisms; `engine-integration.md` holds everything between the browser and the provider seam; `control-states.md` holds the control state machine.

# Live Agent Steering

## Why

Opening a node of a running agent today gives a read-only transcript. An operator can watch the agent work on the wrong test suite for two minutes and do nothing but wait for it to finish being wrong.

The half that is missing is the ability to act: stop the node, and tell it what to do instead.

What blocks it is on our side, in two places rather than one — and one of them is smaller than it looks. `IAgentProvider.sendQuery()` is a one-shot generator with no way in after it starts, and each provider keeps its child process private inside that closure, so no message can reach a live agent. Stopping, by contrast, already reaches: a streaming node polls the run status every ten seconds and aborts on it. What is wrong there is the **outcome** — the cancel path marks the node _failed_, which fails the run — and AskHuman already demonstrates the other ending, pausing a node mid-turn and leaving it resumable. Both seams are built once and shared by every provider.

The agents themselves are the easier half, though not the uniform half. Two of the five accept a message into a live turn today, one cannot, and two have a mechanism whose reachability from our transport nobody has established. The matrix says which is which, and the feature is designed so that the ones that cannot still deliver it.

## Capabilities

- **CAP-1** — Compose while the agent works
  - **intent:** An operator watching a running node can write a message without disturbing it.
  - **success:** The composer is mounted and enabled while the node runs, and the send control reads `Queue`. Sending holds the message; the node is untouched, no tool call is interrupted and nothing is lost. The interface states that the queue is per-tab.

- **CAP-2** — Stop a running node from its own room
  - **intent:** An operator can stop the node they are watching without abandoning the whole run.
  - **success:** A stop control in the node's header ends that node's turn and leaves the node **resumable** — not failed. The run pauses rather than fails, reusing the path AskHuman already takes. Nodes already streaming in the same layer finish their own output; no later layer starts until the operator sends. The transcript shows the in-flight tool call as _interrupted_ rather than _failed_. The interface does not present the stop as instantaneous, because the signal reaches the node on a poll. Nothing in the interface suggests the stop undid work already done.

- **CAP-3** — Send the queue on resume
  - **intent:** After stopping, the operator sends everything they have written and the node carries on from there.
  - **success:** While stopped, the send control reads `Send now`. Sending delivers every queued message plus the one just typed, **in written order**, and the node resumes. Ordering is enforced by us, not assumed of the provider. Both controls revert the instant it resumes, from the node's state rather than from a remembered mode.

- **CAP-4** — The exchange is part of the record
  - **intent:** Anyone reading the transcript afterwards can see what the operator said, and when, relative to what the agent did.
  - **success:** The operator's messages and the interrupted tool call appear as ordinary transcript rows in the order they happened — between the call they interrupted and the one they caused. An operator row is visibly the operator's, never mistakable for the agent's own text.

- **CAP-5** — Mid-turn delivery where the provider allows it
  - **intent:** On a provider that accepts a message into a live turn, the operator does not have to stop the node at all.
  - **success:** Gated by a declared per-provider capability that **defaults to unsupported**, and set only from a mechanism exercised against that provider — never from one that is merely advertised. Where supported, the message reaches the agent with no stop, no interrupted tool call, and no turn-start event. Where unsupported, CAP-2 and CAP-3 still deliver the feature.

- **CAP-6** — The interface claims only what it knows
  - **intent:** An operator can tell whether a message merely left the browser or actually reached the agent.
  - **success:** A message reads `sent` until the provider echoes back the id we stamped on it, at which point it reads `delivered`. Correlation is by id alone. On a provider that returns no echo — which today is every one except claude — the interface never claims `delivered`.

## Constraints

- **A stop pauses the run, it does not suspend one node.** Settled by the product owner: the operator stop routes into the path AskHuman already takes (`dag-executor.ts:3339-3347` → `pauseOnAskHuman` → `state: 'pending'`, never failed). The accepted cost is that no later layer starts while a node sits stopped, including nodes independent of it — near-free on the sequential chains these workflows actually are, and it buys a lifecycle that is already tested.
- **Two blocking seams are ours, not the providers'.** `IAgentProvider.sendQuery()` is a one-shot async generator with no way to push a message in after it starts, and each provider holds its child process privately inside that closure. Separately, stopping a node currently means failing it: the abort recorded during streaming is classified as a cancel and written as `node_failed` with `Cancelled by user` (`dag-executor.ts:3124-3157`, classifier `:3386-3394`). Both are built once for all five providers. See `engine-integration.md`.
- **The stop signal travels through the database, not through memory.** A streaming node polls `getWorkflowRunStatus` every ten seconds (`dag-executor.ts:2304-2334`, interval `:682`), so a stop reaches a detached run as well as an in-process one — but never faster than that poll. `paused` is explicitly _not_ a stop (`:700-702`, `:2306-2309`), so an operator stop needs its own signal rather than reusing the run's pause status.
- **Only mid-turn delivery needs the executor in the server's process.** Web dispatch runs `executeWorkflow` in the API server's process (`server/src/routes/api.ts:3200-3228`); CLI `--detach` spawns a detached child (`cli/src/commands/workflow.ts:696-722`). CAP-5 hands a message to a live child and therefore binds to that process; CAP-2 and CAP-3 do not.
- **The draft queue lives in browser state.** No table, no migration. Justified rather than assumed: the agent runs as a subprocess of the server, so a server death kills the run, and a persisted queue would have had nothing left to deliver to. The interface must say the queue is per-tab rather than let the operator believe the server is holding it. The cost of this choice, taken deliberately: no crash safety for unsent drafts, and no consumed-vs-delivered badge of the kind persistence would have bought.
- **An operator message is an ordinary `text` transcript row carrying `metadata.origin = 'operator'`.** No new table and no widened `kind` enum. The metadata schema is `.strict()`, so this is an additive typed-contract change plus a regenerated `api.generated` — not a database migration.
- **Stop is not undo.** Session state is saved up to the last completed tool call, but files the agent already wrote stay written — nothing is rolled back. This is not new behaviour; the existing abort path has always worked this way. The control must not imply otherwise, because an operator stops _precisely when they think something is going wrong_, which is exactly when they are most likely to assume it cleans up.
- **A steer carries the node id and retry epoch it was written against.** A steer aimed at a superseded attempt is rejected rather than delivered to a different run of the same node.
- **Stop and resume are two gated steps.** After stopping, wait for the runtime to report ready before resuming — driving the resume straight off the stop is a race, and it is the one aion documents having hit.
- **Delivery is confirmed by id, never by matching text or timestamps.** Messages can be merged into one turn, arrive out of order, or be echoed late; text matching silently mis-attributes all three.
- **A steer delivery must not emit a turn-start event.** A stray one opens a phantom turn boundary mid-stream and corrupts the record the transcript is built from.
- **Provider support defaults to unsupported, and is claimed only from an exercised mechanism.** An advertised capability is a lead, not a row.
- **Deliver at the next boundary is the default meaning; immediate interrupt is the special case.** Three mechanisms deliver at the same point — the next tool-call boundary — because that is the natural rest point of an agent loop. The seam should take that as its baseline rather than modelling everything as an interrupt.

## Non-goals

- **qodercli, pi, copilot and opencode.** Not in use today. Two were checked far enough to know they can join later.
- **Persisting the draft queue.** See the browser-state constraint.
- **Auto-send queue mode.** aion offers a pill that drains the queue automatically after each reply. Every send here stays operator-initiated.
- **Cancelling one individual tool call.** No provider offers it — one reports the command unsupported at that granularity, another has nothing on the wire below turn level. Stopping is turn-level or session-level.
- **The read-only transcript itself.** That is `spec-readable-agent-transcript`, already specced and reviewed. It already renders the interrupted-tool outcome a stop produces. CAP-4 is the one place this spec reaches into it — see the dependency below.

## Cross-spec dependency

CAP-4 needs a change in `spec-readable-agent-transcript`. `AgentHistoryItem` there has kinds `assistant | tool | lifecycle`, and an operator row is none of them; its AD-1 puts every row's meaning in the shared core, so the new kind and its treatment on both shells belong in that spec, not this one. Open it there before CAP-4 is built.

## Success signal

An operator watches a node run the wrong test suite, types a correction, presses Stop and then Send, and the agent resumes against the right one — without leaving the node room, without abandoning the run, and without losing the record of what happened. Reading that transcript a week later shows the wrong command, the operator's correction, and the right command, in that order.

## Open questions

- **Must _mid-turn_ delivery reach a detached run?** Stopping already does. If mid-turn must too, the in-process route is not enough, and grok's leader socket is the only lead found.
- Does the pinned `@openai/codex-sdk` 0.144.5 expose `thread.turn()` and its `TurnHandle.steer()`? The published Python SDK documents both; the TypeScript README shows only `run()`/`runStreamed()`. Reading the installed types settles it.
- Grok's hooks payload: the mechanism is advertised and the handshake confirms it, but the exact shape of the text field has not been exercised. One implementation spike settles it.
- Does deepseek's cancel interrupt a running **tool call** as cleanly as it interrupts a model stream? Only streaming was exercised.
- What does the composer do on a **finished** node — does a message re-run it, or is the composer simply absent?
