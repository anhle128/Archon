# Mid-turn steering for the stdin-ignored CLI providers

Scope: **omp** and **grok**. (`qodercli` dropped from scope by the lead; its
material is deliberately excluded.) Read-only research — no repo file modified.

Both binaries are installed on this machine, so the evidence below is primary
source: each CLI's own `--help`, its own shipped docs, literals from its own
binary, and — for omp — its actual source checkout.

Versions observed: `omp` **v18.1.16**, `grok` **1.0.30 (04b7ffed98c6) [stable]**.
Flag and protocol surfaces drift between releases; re-check before building.

## Verdict

| Provider | Mid-turn possible?                                                                                                         | What it would take                                                                                                                                                                                      |
| -------- | -------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **omp**  | **Yes — first class, and the cheaper of the two.** Dedicated `steer` command; `steer` is the _default_ streaming behavior. | Switch `--mode json` → `--mode rpc`, keep the child's stdin open, **extend** (not replace) `OmpEventParser` — RPC reuses the event vocabulary it already parses. Use RPC, **not** `omp acp` (see §1.5). |
| **grok** | **Yes — on the wire.** `x.ai/interject` ACP extension method, plus an `x.ai/queue/*` family.                               | Drop `--single` for `grok agent stdio`, implement a JSON-RPC/ACP client + the `x.ai/*` extensions, and move every argv flag into protocol params. Substantially larger than omp.                        |

**Common blocker, both:** `IAgentProvider.sendQuery(prompt, cwd, resumeSessionId, options)`
(`packages/providers/src/types.ts`) is a one-shot async generator with no way to
push a message after it starts, and each provider holds its child process
privately inside `sendQuery`'s closure — even the process handle is unreachable
from outside. That seam is needed regardless of which CLI capability is used. It
is shared with the SDK-backed providers and is not scoped by this report.

---

## 1. omp

### 1.1 What the CLI is, and is it ours?

**Third-party, not vendored.** Binary `omp` ("Oh My Pi"), resolved by
`packages/providers/src/community/omp/binary-resolver.ts` in this order:
`OMP_BIN_PATH` → `assistants.omp.ompBinaryPath` → autodetect (`~/.local/bin`,
`~/.bun/bin`, `/opt/homebrew/bin` on arm64 macOS, `/usr/local/bin`) → `which omp`.

Install routes, from the resolver's own not-found error (lines 91-101):
`curl -fsSL https://omp.sh/install | sh`, `brew install can1357/tap/omp`,
`bun install -g @oh-my-pi/pi-coding-agent`.

It is a relative of the `pi` provider Archon already runs in-process
(`@earendil-works/pi-coding-agent`) — different package, different vendor
namespace, same protocol lineage.

**On this machine `omp` resolves to a checkout of the upstream source repo:**
`/Users/dale/.bun/bin/omp -> /Users/dale/Desktop/workspace/opensources/oh-my-pi/packages/coding-agent/dist/omp`.
Everything below cites that repo directly.

### 1.2 Does the CLI read stdin during a turn?

**Yes — in RPC mode, stdin is a live command channel.** `omp --help`:

```
--mode=<value>   Output mode: text (default), json, rpc, or rpc-ui
```

plus a subcommand `acp  Run Oh My Pi as an ACP (Agent Client Protocol) server over stdio`.

`docs/rpc.md` (875 lines) is the canonical wire contract:

> RPC mode runs the coding agent as a newline-delimited JSON protocol over stdio.
>
> - **stdin**: commands (`RpcCommand`), extension UI responses, and host-tool updates/results
> - **stdout**: a ready frame, command responses (`RpcResponse`), session/agent events, …

> The process claims stdin before extension discovery, then parses it one non-empty
> JSONL line at a time. Malformed JSON emits a recoverable `command: "parse"` failure
> and does not terminate the loop.

That stdin stays readable **while work is in flight** is stated outright in
`packages/coding-agent/src/modes/rpc/rpc-mode.ts` (:309, :328), about sending
`abort_bash` during a long-running bash:

> send `abort_bash` while a long-running `bash` is in flight … so a subsequent
> `abort_bash` frame can be read and handled without waiting

### 1.3 The steering commands

`docs/rpc.md` §"Prompting" (canonical, mirrors `src/modes/rpc/rpc-types.ts`):

```
{ id?, type: "prompt", message: string, images?: ImageContent[], streamingBehavior?: "steer" | "followUp" }
{ id?, type: "steer", message: string, images?: ImageContent[] }
{ id?, type: "follow_up", message: string, images?: ImageContent[] }
{ id?, type: "abort" }
{ id?, type: "abort_and_prompt", message: string, images?: ImageContent[] }
{ id?, type: "new_session", parentSession?: string }
```

§"While streaming":

> `AgentSession.prompt()` requires `streamingBehavior` during active streaming:
>
> - `"steer"` => queued steering message (interrupt path)
> - `"followUp"` => queued follow-up message (post-turn path)
>   If omitted during streaming, prompt fails.

§"Queue modes" / §"Mode semantics":

```
{ id?, type: "set_steering_mode",  mode: "all" | "one-at-a-time" }
{ id?, type: "set_follow_up_mode", mode: "all" | "one-at-a-time" }
{ id?, type: "set_interrupt_mode", mode: "immediate" | "wait" }
```

> - `set_interrupt_mode`
>   - `"immediate"`: tool execution checks steering between tool calls; pending
>     steering can abort remaining tool calls in the turn
>   - `"wait"`: defer steering until turn completion

Defaults (from `packages/agent/src/agent.ts`, quoted in the doc): `steeringMode`
`"one-at-a-time"`, `followUpMode` `"one-at-a-time"`, `interruptMode` `"immediate"`.

Confirmed in the implementation, not only the doc — `src/modes/rpc/rpc-mode.ts`:

```
:120    streamingBehavior: "steer" | "followUp" = "steer",
:1031   // If streaming and streamingBehavior specified, queues via steer/followUp
:1046   case "steer": {
:1047       await session.steer(command.message, command.images);
:1056   case "abort": {
:1057       await session.abort({ reason: USER_INTERRUPT_LABEL });
```

Line 120: **`steer` is the default** streaming behavior, not `followUp`.

This is exactly the requested behavior — the operator types, the message reaches
the agent at the next tool boundary, the turn is not killed.

### 1.4 If we flipped `stdin: 'ignore'` to `stdin: 'pipe'`

**Nothing useful on its own.** `buildOmpArgs`
(`packages/providers/src/community/omp/provider.ts:131`) builds
`--mode json --cwd … --yolo --no-title … -- <prompt>`; the prompt is argv and the
run is one-shot. Piping stdin without changing the mode gains nothing.

The change is a **mode switch**, not a stdin switch:

- `--mode json` → `--mode rpc`
- prompt moves from argv to a `{type:"prompt"}` frame on stdin
- `OmpEventParser` is **extended, not replaced**. RPC forwards the same
  `AgentSessionEvent` stream json-mode already emits; Archon's parser already
  switches on exactly that vocabulary —
  `packages/providers/src/community/omp/event-parser.ts` handles `session` (:160),
  `message_start` (:168), `message_update` (:180), `message_end` (:182),
  `tool_execution_start` (:184), `tool_execution_end` (:186), `notice` (:188),
  `auto_retry_start` (:193), `agent_end` (:207). RPC adds only an envelope around
  it: `ready`, `response`, `available_commands_update`, `rpc_chunk`, and the
  host-tool / extension-UI requests. The work is to ignore or route those, not to
  re-learn the event model.
- the parser has also already met the `agent_end`-is-not-terminal nuance (:80
  "OMP can dispose a finished turn without emitting agent_end on stdout"; :153
  "agent_end ends a turn, not the stream"), which is the same rule RPC states as
  `isTerminal !== false`
- completion becomes `agent_end` with `isTerminal !== false`, not process exit
- recommended: send `{type:"negotiate_protocol",protocolVersion:2}` immediately,
  or stdout frames >1 MiB are lossy (v1 has only "bounded fallback behavior")

Reference implementations exist: a TypeScript helper at
`packages/coding-agent/src/modes/rpc/rpc-client.ts` (spawns `bun <cliPath> --mode rpc`;
explicitly "a convenience wrapper, not the protocol definition") and a Python
package `omp-rpc`.

### 1.5 Other channels — and a warning about `omp acp`

- **`omp acp`** — ACP server over stdio. **Do not use it for steering.** Its
  ordinary prompt path _cancels_ rather than steers. `src/modes/acp/acp-agent.ts:819-835`:

  > New prompt arrived while the previous turn is still in-flight … Implicitly
  > cancel the running turn so the new prompt can queue behind the abort cleanup —
  > identical to what `cancel()` does when called explicitly.

  ACP mode does use `{ streamingBehavior: "steer" }` in exactly one place
  (`:1039`), and it is the _skill-command_ path (`promptCustomMessage`), not a
  client-sent prompt. So a third-party ACP client steering omp is not available
  through the standard `session/prompt`. **RPC mode is the correct target.**

- **`--mode rpc-ui`** — exists in `--help`, absent from `docs/rpc.md`. Unexamined.
- No control file, polling, socket, or HTTP endpoint observed for omp.

### 1.6 What it does on SIGINT / abort

**Clean, and resumable — answerable from source, no live turn needed.**
`src/modes/session-teardown.ts` routes SIGINT through the _same_ teardown as a
keypress exit:

> Signal-safe session teardown: persists the in-progress editor draft, then
> disposes the session (which emits `session_shutdown`, cancels the session's
> background async jobs, and closes the session manager). Shared by the TUI
> Ctrl+C/Ctrl+D/`/exit` keypress path … and by the postmortem
> `SIGINT`/`SIGTERM`/`SIGHUP`/`uncaughtException` handlers so a real kernel signal
> executes the exact same teardown as a keypress exit.

and `disposeSession` receives the postmortem reason "so `AgentSession.dispose()`
can persist the real exit reason instead of the generic `"dispose"`".

In RPC mode a signal is unnecessary anyway — `{type:"abort"}` is in-band, and on
stdin close "accepted commands are drained, the session is disposed, and the
process exits with code `0`".

### 1.7 Session resume

Supported and already used. `--resume`/`-r` (by ID prefix, path, or picker),
`--continue`/`-c`, `--no-session` (ephemeral), `--fork`. Archon passes these in
`buildOmpArgs` (provider.ts:148-152). Capability `sessionResume: true`
(`community/omp/capabilities.ts`). RPC adds `{type:"new_session", parentSession?}`.

**Flag-visibility caveat:** two flags Archon passes are real but **hidden from
`--help`** — `--fork` (`oh-my-pi/packages/coding-agent/src/cli/flag-tables.ts:128`)
and `--yolo` (an alias of `--auto-approve`, `src/cli/args.ts:279`). Archon's
invocation is correct; they are simply undocumented, so a `--help` sweep will not
catch a breaking change to them.

---

## 2. grok

### 2.1 What the CLI is, and is it ours?

**Third-party (xAI), not vendored.** Binary `grok`, resolved by
`packages/providers/src/grok/binary-resolver.ts`: `GROK_BIN_PATH` →
`assistants.grok.grokBinaryPath` → autodetect (`~/.local/bin`,
`/opt/homebrew/bin` on arm64 macOS, `/usr/local/bin`) → `which grok`. Install
route from its not-found error: `curl -fsSL https://x.ai/cli/install.sh | bash`.

On this machine: `/Users/dale/.local/bin/grok -> /Users/dale/.grok/downloads/grok-1.0.30-macos-aarch64`,
a Rust Mach-O binary. Evidence is `--help` output plus literals recovered from
that binary, which embeds both its documentation and its Rust source paths.

`grok --help` self-describes as "Grok Build TUI" — the interactive TUI is the
default; `--single`/`-p` is the headless escape hatch Archon uses.

### 2.2 Does the CLI read stdin during a turn?

**Not in the mode Archon uses.** `buildGrokArgs` (`grok/provider.ts:115-125`)
passes `--single <prompt> --verbatim --output-format streaming-json`. `--single`
is documented as "Single-turn prompt. Prints the response to stdout and exits" —
one-shot, prompt in argv. (`--verbatim` = "Send the prompt exactly as given".)

**But grok ships a real agent server.** `grok agent --help`:

```
Commands:
  stdio     Run the agent over stdio
  headless  Run the agent headlessly over the Grok WebSocket relay
  serve     Run the agent as a WebSocket server
  leader    Run as the shared leader process for other clients
```

and on the top-level `--help`:

```
--output-format streaming-json:  NDJSON: one ACP session update per line, the agent's native format
```

**ACP is grok's native protocol**, and `grok agent stdio` speaks it over stdio.
The method set appears as one contiguous literal run in the binary:

```
initialize authenticate session/new session/load session/prompt session/cancel session/set_model
```

grok's own docs carry a complete third-party integration example, which settles
whether outside clients are expected:

> ## Integration example: a TypeScript ACP client
>
> ```typescript
> this.proc = spawn('grok', ['agent', '--always-approve', 'stdio']);
> this.rl = readline.createInterface({ input: this.proc.stdout! });
> await this.request('initialize', {
>   protocolVersion: 1,
>   clientCapabilities: {
>     fs: { readTextFile: true, writeTextFile: true },
>     terminal: true,
>   },
> });
> const { sessionId } = await this.request('session/new', {
>   cwd: this.cwd,
>   mcpServers: [],
>   _meta: { yoloMode: true },
> });
> ```

(A Python variant is embedded too, alongside a client compatibility table —
"marimo notebook | Supported", "JetBrains | Coming soon".)

### 2.3 The steering channel

grok's own TUI is a separate crate (`xai-grok-pager`) and is **itself an ACP
client**, so its mid-turn steering travels over the ACP wire rather than through
in-process calls. Recovered as a contiguous literal run — the Rust
`serialize <X> params` / method-name / error-message triples:

```
serialize interject    params   x.ai/interject      couldn't send interjection:      [clean triple]
serialize queue/remove params   x.ai/queue/remove   Failed to send queue/remove notification:  [clean triple]
serialize queue/clear  params   …                   Failed to send queue/clear notification:   [see note]
```

Reading-confidence note, since these are rodata literals rather than a schema:
the `interject` and `queue/remove` rows are contiguous runs in the binary and are
safe to read as method + error pairs. **`x.ai/queue/clear` is reconstructed from
two separate sites** — `serialize queue/clear params` sits next to its error
string in one run, while the `x.ai/queue/clear` literal appears in another
(`serialize params` `x.ai/queue/clear` `prompt submitted`). The method almost
certainly exists; the pairing is inferred.

`x.ai/interject` is the client→agent mid-turn message, and is a **request rather
than a notification**: its error string is "couldn't send interjection" (not
"Failed to send … notification", the form the queue ops use), the binary carries
`struct InterjectRequest with 4 elements`, and there is a response to parse —
`failed to deserialize response:` immediately precedes `interjectionId`.

I am confident the response carries **`interjectionId`** — it is also the field
name in the `x.ai/session/interjection` notification, which I did recover in
parsing context. A `queued` literal sits directly beside it and _may_ be the
second field, but adjacent rodata is not a struct definition: the four field
names of `InterjectRequest`, and the full response shape, are **unverified**.
Recover them from a live handshake, not from this report.

Supporting literals:

- `x.ai/session/interjection` — the agent→client notification, carrying
  `sessionId` and `interjectionId`
  (`crates/codegen/xai-grok-pager/src/app/acp_handler/session_notification.rs`)
- `x.ai/queue/changed` — queue-state notification
  (`crates/codegen/xai-grok-pager/src/app/acp_handler/queue.rs`)
- a queue-op family: `queue_remove queue_reorder queue_clear queue_edit queue_interject`
- server side: `crates/codegen/xai-grok-shell/src/session/acp_session_impl/interjection.rs`,
  `.../prompt_queue.rs`, and a dedicated crate `crates/common/xai-interjection-core/`
- runtime strings: `Queued mid-turn interjection`, `Interjection sent`,
  `Interjection failed. Requeued:`, `server appended prompt to pending_inputs`,
  `server_queue_input`, `cancels_turn`
- TUI keybinding actions `SendPrompt`, `InterjectPrompt`, `StashPrompt`,
  `CancelTurn`, `ToggleQueue` — interject is a distinct action from cancel

Semantics, from grok's own embedded docs:

> `follow_up_behavior = "queue"` # mid-turn follow-ups: "queue" (wait for turn end;
> default) or "steer" (plain Enter still queues visibly, then injects at the next
> tool/model safe gap).

> Sends a message to the agent mid-turn without cancelling it (interject), so you
> can steer or add context while it keeps working.

And for subagents, a three-way `delivery` parameter naming the same model:

> - `steer` (the default) joins the current turn at its next safe point.
> - `queue` waits as a protected later turn instead of entering the active turn.
> - `interject` is urgent: it is delivered ahead of pending steers at the earliest
>   safe point, and it interrupts a subagent that is blocked waiting on background work.

grok even biases the model toward reading such a message as steering rather than
cancellation (system-prompt literal):

> Default to treating it as guidance for the work in progress users are more often
> steering than canceling.

An interjection can also cancel pending tool calls — literal: `Tool execution
cancelled due to earlier user followup message for tool`.

**Residual uncertainty, stated precisely.** Third-party ACP clients are
documented and supported (§2.2's integration example is grok's own). What I did
_not_ find is `x.ai/interject` in that public example — it appears only on the
pager's path. Whether the `x.ai/*` extension methods are ungated for an arbitrary
client is therefore unverified; the binary carries `clientVersion`,
`leaderVersion`, and `Version mismatch: … Restart grok to match`
(`.../acp/leader_bridge.rs:64`), so a version or capability gate is possible.
Confirm with one real `grok agent stdio` handshake before committing.

### 2.4 If we flipped `stdin: 'ignore'` to `stdin: 'pipe'`

**Nothing useful** while `--single` is in the argv — it is defined as
print-and-exit, and there is no evidence it reads stdin at all. The change needed
is a transport replacement, not a stdin flag:

1. Spawn `grok agent stdio` instead of `grok --single …`
2. Implement a JSON-RPC 2.0 ACP client: `initialize` → `session/new` → `session/prompt`
3. Consume `session/update` notifications and map them to Archon `MessageChunk`s.
   `GrokEventParser` is partly reusable — grok's `streaming-json` _is_ ACP session
   updates, and the parser already handles `text`, `thought`, `tool_call`,
   `tool_call_update`, `error`, `end` (`grok/event-parser.ts:73-89`) — but it
   currently consumes bare NDJSON payloads, so the JSON-RPC envelope must be
   unwrapped before handing frames to it.
4. Send `x.ai/interject` to steer; `session/cancel` to stop
5. **Re-derive every current flag.** `buildGrokArgs`' argv flags (`--tools`,
   `--disallowed-tools`, `--json-schema`, `--reasoning-effort`, `--permission-mode`,
   `--agents`, `--system-prompt-override`, `--rules`, `--resume`, `--fork-session`)
   must move into `initialize`/`session/new` params or a per-connection plugin —
   `grok agent --help` documents `--plugin-dir` as exactly that: "Used by the Agent
   SDKs to inject per-connection plugins."

   **One mapping is already known**, and it is the flag Archon leans on hardest.
   Archon passes `--permission-mode bypassPermissions` by default
   (`grok/provider.ts:124`); over ACP the integration example carries it as
   session metadata — `session/new` with `_meta: { yoloMode: true }` — and the
   other embedded sample instead spawns `grok agent --always-approve stdio`, i.e.
   the same intent as a process flag. Either route exists; neither is a blocker.

   **Watch the handshake types:** the two embedded examples disagree on
   `protocolVersion` — `1` (number) in one, `"1"` (string) in the other. Either
   the field is loosely typed or one sample has drifted. Send what a live
   `initialize` accepts rather than trusting either sample.

This is the larger of the two changes — a new transport, not a new mode.

### 2.5 Other channels

- **Unix socket:** `--leader-socket <PATH>`, default `~/.grok/leader.sock`.
  `grok agent leader` runs "the shared leader process for other clients"; the
  `--leader` flag "Connect[s] to a shared leader process instead of starting a new
  agent. Allows multiple clients to share one backend." Managed via
  `grok leader list/info/kill`. A second, already-built multi-client path into a
  running session — and the most interesting one if Archon ever wants an
  out-of-band steering channel into a run it did not spawn.
- **WebSocket:** `grok agent serve --bind 127.0.0.1:2419 --secret <SECRET>`
  (`GROK_AGENT_SECRET`), plus `grok agent headless` over the grok.com relay.
- No control file or polling mechanism observed.

### 2.6 What it does on SIGINT / abort

**Fully answered by grok's own shipped docs**, quoted verbatim from the binary:

> ## Interrupted Headless Runs
>
> On SIGINT/SIGTERM:
>
> - Session state saved up to the last completed tool call
> - File modifications by tools are **not rolled back**
> - Exit code is **130** for SIGINT (`128 + 2`) and **143** for SIGTERM (`128 + 15`);
>   CI pipelines can distinguish these from a normal error (exit code `1`)
> - Resume: `grok -p "continue" --resume "<id>"` or `grok -p "continue" --continue`

Two consequences for Archon. First, a stopped grok turn **is** resumable, and
grok documents the exact incantation. Second — worth flagging to whoever designs
the fallback path — "file modifications by tools are not rolled back" means an
abort mid-turn leaves the worktree in a partial state; that is the same hazard
Archon's existing SIGTERM→SIGKILL path already has, not a new one.

In-band, ACP `session/cancel` is the stop. grok classifies the cause: literal
`user_interrupt` ("Ctrl+C, a client stop button, or a client `session/cancel`")
alongside `permission_rejected`, `permission_cancelled`, `max_turns`, `no_progress`.

### 2.7 Session resume

Supported and already used. `--resume [<SESSION_ID_OR_TITLE>]` (UUID-shaped values
always mean IDs; other values match session titles for the current directory,
failing on ambiguity), `--continue`, `--fork-session`, `--session-id <UUID>` (new
sessions only, or naming a fork). ACP exposes `session/load`. Archon passes
`--resume`/`--fork-session` today (`buildGrokArgs`, provider.ts:149-152).
Capability `sessionResume: true` (`grok/capabilities.ts`).

One flag worth knowing: `--restore-code` "Restore the original session's repository
snapshot when resuming"; without it "resume restores conversation only".

---

## Method and disclosure

Evidence is `--help` output, each vendor's own shipped/embedded docs, and literals
recovered with `strings` from the installed binaries — plus, for omp, its actual
source checkout at `/Users/dale/Desktop/workspace/opensources/oh-my-pi/`.

No repo file was modified. No model turn was run against either CLI: every claim
above comes from reading, not from executing a prompt. Nothing here cost tokens
at either vendor.

## Unresolved questions

1. **Are grok's `x.ai/*` extension methods reachable by a non-pager ACP client, or
   gated by the version/capability handshake?** (§2.3.) This is the one fact that
   could downgrade grok's verdict from "yes" to "cancel-and-re-prompt". Settling it
   needs one live `grok agent stdio` handshake — cheap, but it runs a real process,
   so I left it for an implementation spike rather than a read-only scout.
2. **omp `--mode rpc-ui`** — present in `--help`, absent from `docs/rpc.md`.
   Possibly a richer host surface than `rpc`; unexamined.
3. **Exact field names of grok's `InterjectRequest`** (known: 4 fields; response is
   `{interjectionId, queued}`). Recoverable from a live handshake or by watching
   the pager's own traffic against a leader socket.
4. **How an omp steering message is surfaced back to the caller** — whether it
   produces a distinguishable event in the `AgentSessionEvent` stream, which Archon
   would want in order to show the operator that the steer landed. `docs/rpc.md`
   §"Event Stream Schema" lists no steer-specific event; `prompt_result` and
   `agent_end` may be the only signals.
