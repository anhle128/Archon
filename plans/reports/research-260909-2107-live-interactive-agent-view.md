# Research — live, interactive agent view in the node room

> **SUPERSEDED (2026-09-09)** by `plans/260909-2130-live-interactive-agent-view/design.md`, which
> merges this document with the earlier design and applies corrections found during the merge.
> Kept only as a source record — do not plan or implement from this file.

Date: 2026-09-09 · Branch: `develop` · Status: **research notes, NOT a plan.** Nothing here is agreed scope.

Companion doc: the earlier, narrower "make the transcript readable" design at
`plans/260909-1957-readable-agent-transcript/design.md` — **deleted 2026-09-09**, superseded by the
merged document above; recoverable from git.

Evidence marking: **[V]** = verified by reading source in this session. **[S]** = reported by a
research subagent with file:line, not personally re-read. **[?]** = unverified/assumption.

---

## 1. What the topic became

Started as: replace raw JSON in the agent-node detail view with readable tool cards.

Ended as: **the node room is a live, interactive agent surface.** User's framing, verbatim intent:
click a _running_ node → interact with it; click a _finished_ node → read its full history.
Plus: show the agent's thinking, the initial prompt, file changes, todo, task, and the
**advisor** notifications the agent receives while working.

User decisions recorded this session:

- Collapsed one-line tool rows, failures auto-expand. **Settled against mockups.**
- Chip-style tool label + glyph status (`✓ ✕ ◐`), middle-elision for paths. **Settled.**
- Include `todo` and `task` renderers (upgraded from the 3-family proposal).
- Two phases: frontend-only transcript work first, Console "Files changed" panel second.
- **Do (B) mid-turn user input AND (C) provider mid-turn input.**
- **Switch the OMP provider from `--mode json` to `--mode rpc`.**

---

## 2. Archon web: transcript architecture [V]

```
workflow_node_messages (DB)
  → GET /api/workflows/runs/{runId}/nodes/{nodeId}/messages   (cursor: afterSeq, highWatermark)
  → lib/node-message-pages.ts        NodeMessageRow[]
  → lib/project-text-transcript.ts   merge streamed text deltas
  → lib/pair-tool-transcript.ts      pair tool call+result
  → lib/agent-history.ts             buildAgentHistory() → AgentHistoryItem[]   ← shared, render-neutral
      ├─→ Legacy  components/workflows/NodeRoom.tsx
      └─→ Console experiments/console/components/inspect/ConsoleAgentHistoryList.tsx
```

- Both surfaces share the **data** layer, deliberately fork the **render** layer.
  `ConsoleAgentHistoryList.tsx:1-4` docblock: "never imports Legacy React components."
- Console imports **zero** components from `@/components/`. Boundary is absolute. [V]
- Legacy is scheduled for deletion — `App.tsx:93-95` "removed once the console has proven itself";
  `App.tsx:75-76` console is already default (`/` → `/console`).
- Raw JSON origin: `pair-tool-transcript.ts:75-78` `formatToolIo()` = `JSON.stringify(v, null, 2)`,
  rendered in always-open `<details open>` at `NodeRoom.tsx:255-264` and
  `ConsoleAgentHistoryList.tsx:187-196`.
- Weak humanizer: `agent-history.ts:50` `TOOL_CONTEXT_KEYS = ['cmd','path','file_path','query','url']`
  — misses `command` and `pattern`, so mostly contributes nothing.
- Three independent humanizers exist (Rule of Three satisfied): backend
  `workflows/src/utils/tool-formatter.ts:37-84` (PascalCase-keyed, chat/Telegram, **not importable
  from web** — package rule), `agent-history.ts:171` `toolContext()`, and
  `components/chat/ToolCallCard.tsx:31` `Object.values(tool.input)[0]`.
- Deps already present: `react-diff-view@3.3.3`, `highlight.js`, `rehype-highlight`,
  `react-markdown`, `@tanstack/react-virtual`, `@xterm/xterm`. No new dep needed.
- Reusable pure logic in Legacy tree: `source-control/git-hunk-adapter.ts` (58 lines, pure). [S]

### Transcript schema [V]

`workflows/src/schemas/node-message.ts:30-36` — closed discriminated union, **exactly three kinds**:

```
text   → { text }
tool   → { name, id, input?, output? }
status → { state, detail? }
```

DB enforces it: `migrations/000_combined.sql` `kind IN ('text','tool','status')` CHECK. [S]
`nodeTranscriptMetadataSchema` is `.strict()` (`schemas/node-execution.ts:43`). [V]

### Execution identity [V]

`schemas/node-execution.ts:9-24`:

```ts
LoopAncestryEntry = { node_id: string; iteration: number }   // iteration: positive int
TranscriptExecutionScope = { occurrence_id, attempt_id, retry_epoch?, loop_ancestry?, route_activation_seq? }
```

- `mintTranscriptExecutionScope()` → **new occurrence + new attempt**. Called per retry and per loop
  iteration (`dag-executor.ts:263, 1987, 3614, 3908, 5185, 5461`).
- `newTranscriptAttempt()` → **same occurrence, new attempt** (`dag-executor.ts:2286, 6330`).
- So **one occurrence contains many attempts.** Naming a UI group "Attempt" while `attempt_id`
  means something finer is a collision — group by `occurrence_id`, label from `retry_epoch` /
  `loop_ancestry`, never from `attempt_id`.
- Neither renderer reads any of this today.

---

## 3. Provider reality: tool naming [V]

`superpower-feature.yaml` mixes providers **in one run**: `provider: omp` (line 8),
`provider: claude` (31), `provider: codex` (82). A single transcript can carry three conventions.

| Provider              | Names                                                             | Input keys                     | Note                                       |
| --------------------- | ----------------------------------------------------------------- | ------------------------------ | ------------------------------------------ |
| **omp**               | lowercase `read` `glob` `grep` `todo` `task`                      | `path`, `pattern`, `op`/`list` | dominant in the local DB                   |
| pi                    | lowercase, 7 built-ins `read bash edit write grep find ls`        | `path`                         | `pi/options-translator.ts:148` [S]         |
| claude                | PascalCase, 24 names (`claude/capabilities.ts:11-36`)             | **UNVERIFIED — see below**     | renames `Task`→`Agent`, `MultiEdit`→`Edit` |
| codex                 | **tool name IS the raw command**; web search `🔍 Searching: ${q}` | **no `input` attached**        | `codex/provider.ts:541-560` [S]            |
| opencode/copilot/grok | SDK passthrough, no declared vocabulary                           | passthrough                    | no `knownToolNames`                        |

**[?] Claude input key spelling is unresolved.** Two subagents disagreed (`path` vs `file_path`,
`old_str` vs `old_string`); `node_modules` reads are blocked by a local hook. This uncertainty is
load-bearing: it is _why_ the resolver must duck-type over alias sets rather than match one spelling.

### Real payloads observed in `~/.archon/archon.db` [V]

46 tool rows, all from `superpower-feature`. Names: `read` 31, `glob` 7, `grep` 5, `todo` 2, `task` 1.
All rows: `input` is an object, `output` absent, `metadata.tool_phase` absent.

```jsonc
// todo — state ACCUMULATES across calls; cannot render from one call
{"op":"init","list":[{"phase":"Research","items":["Read story 5.5 spec and brainstorm", "…"]},
                     {"phase":"Plan","items":["…"]}]}
{"op":"done","task":"Read story 5.5 spec and brainstorm"}

// task — parallel subagent dispatch
{"context":"# Goal\n…# Constraints\n…","tasks":[{"name":"ScoutConsole","agent":"scout","task":"# Target\n…"}]}
```

Only ops `init` / `done` observed — full vocabulary unknown **[?]**.
`glob` carried `path` but no `pattern`, which is odd for a glob **[?]**.

---

## 4. Advisor — two entirely different mechanisms

### Claude Code: a **server-side tool** [S]

Model emits `server_tool_use{name:'advisor'}`; the API runs the advisor model server-side and
continues the **same assistant message** with an `advisor_tool_result` block. No client injection
anywhere; the CLI only observes.

```ts
// claude-code utils/advisor.ts:9-44
{ type:'server_tool_use', id, name:'advisor', input }
{ type:'advisor_tool_result', tool_use_id,
  content: {type:'advisor_result', text} | {type:'advisor_redacted_result', encrypted_content}
         | {type:'advisor_tool_result_error', error_code} }
```

Distinguishable three ways: `type` is `advisor_tool_result` (not `tool_result`); it sits inside an
**assistant** message (ordinary tool results are user-role); the emitted `AssistantMessage` carries
an `advisorModel` field.

UI reference (`components/messages/AdvisorMessage.tsx`): in-progress = spinner + **Advising** +
dim `using <model>`; done = `✔ Advisor has reviewed the conversation and will apply the feedback`
with **content hidden by default**, expand via Ctrl+O; error = `Advisor unavailable (<code>)`.

Gated behind an unreleased beta header `advisor-tool-2026-03-01` + a feature flag + first-party API
only. **Not something Archon can rely on today.**

### OMP: a **separate reviewer agent** [S]

Own model, own session, own transcript. Driven **once per completed primary turn** (not a timer, not
a tool count): `agent-session.ts:1240-1251` → `session-advisors.ts:336-354`. Returns advice through
one tool, `advise(note, severity)`. Off by default (`advisor.enabled = false`); needs `--advisor`.

Reaches the running agent as a `role:"custom"` / `customType:"advisor"` message via three channels —
`aside` (severity `nit`), `steer` (`concern`/`blocker`), `preserve`. All three surface on the stream
as `message_start` + `message_end`:

```jsonc
{
  "type": "message_start",
  "message": {
    "role": "custom",
    "customType": "advisor",
    "attribution": "agent",
    "content": "<advisory severity=\"concern\">…</advisory>",
    "details": { "notes": [{ "note": "…", "severity": "concern", "advisor": "Architecture" }] },
  },
}
```

Detector: `message.role === 'custom' && message.customType === 'advisor'`.
`details.notes` = structure; `content` = the exact bytes the model saw.

`__advisor.jsonl` holds **advice content + reasoning + usage** — a full transcript, not an
accounting sidecar. Written under the **session file's** directory, _not_ the artifacts root. [S]

> **Correction to an earlier claim in this session.** I stated `__advisor.jsonl` is already reachable
> through the existing artifact API because the listing route only skips dotfiles
> (`api.ts:6368` `if (entry.name.startsWith('.')) continue;` [V]) and the file starts with `_`.
> The dotfile fact is correct, but the **location** is not confirmed to be under `$ARTIFACTS_DIR`.
> Do not rely on the "free frontend path" until the path is verified.

---

## 5. Mid-turn input — both harnesses converge on one pattern [S]

|                                  | Claude Code                                                        | OMP                                                            |
| -------------------------------- | ------------------------------------------------------------------ | -------------------------------------------------------------- |
| Queue                            | `utils/messageQueueManager.ts:40-56`, module-global, outside React | `#steeringQueue`/`#followUpQueue`, `agent.ts:990-1005`         |
| Priorities                       | `now` / `next` / `later` (`textInputTypes.ts:269-287`)             | `steer` / `followUp`, `set_steering_mode`                      |
| Drain point                      | tool-round boundary, `query.ts:1547-1590`                          | tool-batch boundary, `agent-loop.ts:1044/1449/1478`            |
| Injection                        | attachment `queued_command` → user msg in `system-reminder`        | push into `currentContext.messages`, `agent-loop.ts:1089-1097` |
| **Streaming input to model API** | **NO** — fixed `messages` array; `stream:true` is output only      | **NO** — materialized array                                    |
| Interrupt                        | separate (Esc / SDK `interrupt()` / `priority:'now'`)              | separate (`abort`; deliberately **keeps** the steer queue)     |

**Key correction to my earlier reasoning.** I had said (C) was blocked because SDKs don't accept
mid-turn input. Wrong. _Neither harness_ accepts mid-turn input at the model API. "Mid-turn" means
**between two API calls**, at a tool boundary. The enabler is a queue + a drain point, not an SDK
capability. Archon's `dag-executor` already has the tool loop, so the drain point exists.

Claude Code's preamble when injecting (`utils/messages.ts:5496-5512`) is worth copying as a pattern —
it distinguishes `human` / `coordinator` / `channel` / `task-notification` origins, and marks
non-user origins as untrusted.

Claude Agent SDK public surface already exposes what Archon would need:
`query(prompt: string | AsyncIterable<SDKUserMessage>)` (`runtimeTypes.ts:78`) and
`priority: z.enum(['now','next','later'])` (`coreSchemas.ts:1280`). [S]

---

## 6. OMP `--mode json` → `--mode rpc`

User decided to make this switch. Cost assessment:

### The good news [V]

`rpc-frame.ts:5-8`: _"Maximum UTF-8 size of one **newline-delimited** RPC frame"_,
`MAX_RPC_FRAME_BYTES = 1 MiB`. Chunking exists **only in protocol v2**, and v2 activates only after
an explicit `negotiate_protocol` (`rpc-mode.ts:736-740`). At v1, `encodeRpcFrameFromJson`
(`rpc-frame.ts:242-260`) always emits exactly one newline-terminated line — oversized frames are
compacted then progressively shrunk via `SHRINK_PASSES`, never split.

**Staying on v1 means the wire stays NDJSON. No frame codec to write. Line splitting survives.**

### What actually changes [V unless marked]

|               | `--mode json` (today)                                              | `--mode rpc`                                                                                                     |
| ------------- | ------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------- |
| Wire          | NDJSON                                                             | NDJSON at v1                                                                                                     |
| Event payload | filtered by `printableEvent` (strips `providerPayload`, `partial`) | **raw** — `session.subscribe(e => output(e))`, `rpc-mode.ts:977-980`                                             |
| Lifecycle     | single-shot; stdin read once before start                          | persistent session; `ready` handshake frame first (`rpc-mode.ts:727-735`)                                        |
| Inbound       | none                                                               | `prompt` · `steer` · `follow_up` · `abort` · `abort_and_prompt` · `set_steering_mode` · `set_interrupt_mode` [S] |

Archon spawns `['--mode','json','--cwd',cwd,'--yolo','--no-title']` — `omp/provider.ts:131`. [V]
Note there is **no `--advisor`**, and OMP's default is `enabled:false`, so advisor has never run.

### Two traps to write into any future spec

1. **`providerPayload` is no longer stripped.** `printableEvent` is print-mode-only. Frames get much
   larger, so the 1 MiB v1 ceiling gets closer — and at that ceiling v1 **silently elides content**.
   Archon should drop `providerPayload` on receipt, or negotiate v2. Worst case this loses exactly
   the large tool outputs the UI most needs.
2. **Lifecycle, not parsing, is the bulk of the work.** Single-shot → persistent session changes
   process management, prompt delivery (arg → `prompt` command), and teardown per node.

---

## 7. What Archon drops today (gaps and one real bug) [V]

- `omp/event-parser.ts:168-179` — `message_start` only acts when `role === 'assistant'`, else `[]`.
- `omp/event-parser.ts:232` — `consumeMessageEnd` returns `[]` unless `role === 'assistant'`.
  → **All OMP advisor messages are discarded at these two lines.**
- `omp/event-parser.ts:23-31` — `isFollowUpTurnEvent` allowlists only `message_start`,
  `message_update`, `message_end`, `tool_execution_start`, `tool_execution_end`. A `todo_reminder`,
  `auto_compaction_*`, or `notice` arriving after `agent_end` is silently dropped **and** leaves
  `sawAgentEnd` set. OMP already emits `agent_end.isTerminal` [S], which is the correct signal.
  **This is a bug, not a missing feature.**
- Agent **thinking** is never persisted for workflow runs: providers emit
  `MessageChunk {type:'thinking', content}` (`providers/src/types.ts:317`) — omp
  `event-parser.ts:226`, codex `provider.ts:668`, pi `event-bridge.ts:304`, opencode
  `session.ts:215` — but **no handler for `chunk.type === 'thinking'` exists anywhere in
  `@archon/workflows`**, and `appendNodeTranscript` is only ever called with `kind` `status`/`text`/`tool`
  (`dag-executor.ts:2002, 2350, 2423, 5204, 5777, 5994`).
- The **resolved prompt** is never persisted. `node_started` event data carries `command`,
  `provider`, `tier`, `model`, `modelReasoningEffort`, `effort` — no prompt
  (`dag-executor.ts:2017-2034`).
- Unhandled OMP session events [S]: `todo_reminder`, `auto_compaction_start`/`_end` (note: **not**
  `compaction_start/end`), `auto_retry_end`, `retry_fallback_applied`, `model_changed`,
  `ttsr_triggered`, `todo_auto_clear`, `irc_message`, `thinking_level_changed`, `goal_updated`.
- [S] Archon's `pi/event-bridge.ts:292-293` comments name `compaction_start` / `queue_update`,
  which do not exist in OMP 18.0.4 — stale comments, worth re-checking against the installed
  `@earendil-works/pi-coding-agent`.

### Consequence for thinking + prompt

Both need persistence before they can be shown, and both would only ever appear for **new** runs —
unlike the transcript-rendering work, which applies retroactively.

Least-invasive shape identified: **one additive optional metadata field**, e.g.
`text_kind: 'response' | 'thinking' | 'prompt'` on `kind:'text'` rows. Metadata is JSON so there is
no migration, and it avoids touching the `kind` union — which is guarded by a DB CHECK constraint
that an older Archon binary would enforce against a new value. Adding a `kind:'thinking'` is
therefore the dangerous option, not the clean one.

---

## 8. Interaction primitives Archon already has [V unless marked]

- **AskHuman answer route exists**: `POST /api/workflows/runs/{runId}/ask/{requestId}/answer`
  (`api.ts:1489-1491`) with `answerAskHuman` + typed errors. Web UI not wired. [S: UI gap]
- `pending_interactions` table: `kind` ask|permission, `status` pending|answered|purged.
- Approval gates work; `capture_response: true` stores the reviewer's comment.
- SSE transports exist: `GET /api/stream/:conversationId`, `GET /api/stream/__dashboard__`
  (`api.ts:3729-3778`). [S]
- Node-message API supports live tail + backfill via `afterSeq` / `nextCursor` / `highWatermark`. [S]
- **No** route for unsolicited input to a running node — no steer/interrupt/inject path. [V]
- Container-paused runs are CLI-resumable only; web resume fails fast. [S]
- Git routes are **run-scoped, never node-scoped** — `/git/changes`, `/git/diff`, `/git/log`,
  `/git/file`. "What did _this node_ change" is not answerable from git; only per-tool-call diffs
  give node-level attribution. [S]

### A state model that fits what is actually buildable

| Node state                       | Surface                                                             |
| -------------------------------- | ------------------------------------------------------------------- |
| running, not waiting             | live tail; read-only (stop available)                               |
| running, waiting on ask/approval | **input appears** — this is the chat moment; backend already exists |
| finished                         | full history (the settled mockup)                                   |

Adding (B) turns row 1 into "input always available, queued to the next tool boundary".

---

## 9. Settled visual decisions (carried from the mockups)

Mockups: `.superpowers/brainstorm/19932-1788959699/content/{transcript,transcript-v2}.html`
(`.superpowers/` added to `.gitignore` this session).

- One line per tool call, collapsed by default; **failed calls auto-expand**.
- Chip = short stable label: the tool name when it is a single token ≤24 chars, else the family
  name. Codex's command-as-name therefore renders chip `shell` + command as headline.
  MCP `mcp__gitnexus__query` → `gitnexus · query`.
- Status as **glyph** `✓ ✕ ◐` plus colour — never colour alone (accessibility; chosen over dots
  for exactly this reason).
- Path headlines elide in the **middle** so the filename survives; commands/patterns elide at the end.
- Fallback for unknown tools: up to 3 scalar `key: value` pairs. Never `JSON.stringify`.

---

## 10. Unresolved questions — SUPERSEDED, kept as the record of what was open

> Read §11 and §12 for the answers. Every item below except the Claude-SDK-drift note was resolved
> later in the same session. This section is retained so the reasoning trail stays honest about what
> was and was not known at the time.

1. **Claude's real input key names** (`path` vs `file_path`, `old_str` vs `old_string`). Two
   subagents disagreed; local `node_modules` reads are hook-blocked. Mitigated by alias sets, but
   should be confirmed empirically from a real Claude run's rows.
2. **Does Claude's edit payload carry before/after content at all?** Determines whether inline diffs
   ever fire for Claude.
3. **`__advisor.jsonl` actual location** — under the session dir or `$ARTIFACTS_DIR`? Decides
   whether advisor history is reachable with zero backend change.
4. **OMP `todo` op vocabulary** beyond `init`/`done`. A fold that ignores unknown ops under-reports
   progress silently.
5. **OMP `glob` input** appears to lack `pattern`. Confirm what it actually sends.
6. **Codex tool call/result pairing** — if Codex emits no result row, `card.pending` leaves every
   Codex tool rendering as "running" forever. All 46 local rows are OMP, so this is untested.
7. **Does Archon pass a fixed string or an async iterable to the Claude SDK `query()`?** Determines
   the size of (B)/(C) for Claude.
8. **Governance**: an injected mid-turn user message changes what a node did. It must land in the
   transcript as a first-class row for the audit trail to stay honest — which needs the same
   metadata extension as thinking/prompt.
9. Where the OMP RPC session lifecycle should live (per-node process vs per-run), and how it
   interacts with the existing process-cleanup rules.

---

## 11. Answers found after §10 was written (2026-09-09, later same session)

**Q6 — Codex tool pairing: NO PROBLEM. [V]** Codex emits `tool_result` at
`codex/provider.ts:653, 676, 765, 791`, carrying `toolCallId: itemId` plus `toolOutcome`,
`exitCode`, and `outputState: 'full'`. Pairing on `payload.id` works; Codex even supplies an exit
code for free. Only the tool _input_ is missing (hence the name-only resolver tier). Closed.

**Q7 — Claude SDK call shape: `prompt` is a plain `string`, and this is an INTERFACE-level
problem. [V]** `claude/provider.ts:1689` calls `query({ prompt: queryPrompt, options })`, and
`queryPrompt` resolves from `sendQuery(prompt: string, …)` — `claude/provider.ts:1536-1541`.
`sendQuery` is declared on `IAgentProvider` (`providers/src/types.ts:903`) and **implemented in 11
places**: claude, codex, copilot, pi, grok, deepseek, qodercli, omp, opencode, e2e-fake, plus the
`observability.ts` decorator.

Consequence: widening `prompt` to accept an async iterable would change the core contract and touch
all 11, nine of which have nothing to do with steering. AGENTS.md's ISP rule covers this exactly —
_"Do not add unrelated methods to an existing interface — define a new one."_ The indicated shape is
a **separate narrow opt-in interface** (e.g. a steerable-provider port) plus a capability flag, so
only providers that genuinely support mid-turn input implement it. That also lines up with the
existing capability registry and `bun run generate:capability-matrix`. The `observability.ts`
decorator must forward whatever new port is added.

**Q1 + Q2 — Claude's tool input shape: BOTH RESOLVED, from primary evidence. [V]**

Archon hardcodes **no** Claude input key anywhere under `providers/src/claude/` — pure pass-through,
so Archon itself does not "know" the shape. The repo's own fixtures assume `file_path` and
`command`: `toolName:'Write', toolInput:{ file_path }` (`plannotator-gate-executor.test.ts:662`),
`toolName:'Bash', toolInput:{ command }` (`claude/provider.test.ts:230, 505`), and
`tool-formatter.ts:45` keys Read on `file_path`.

Those are hand-authored fixtures, so they only establish repo belief. The **primary** source is
better and was available all along: this research session ran _inside Claude Code_, whose built-in
tool schemas are therefore directly observable:

| Tool    | Input keys                                               |
| ------- | -------------------------------------------------------- |
| `Read`  | `file_path`, `offset`, `limit`                           |
| `Edit`  | `file_path`, `old_string`, `new_string`, `replace_all`   |
| `Write` | `file_path`, `content`                                   |
| `Bash`  | `command`, `timeout`, `description`, `run_in_background` |

Consequences:

- It is **`file_path`**, not `path`; **`old_string`/`new_string`**, not `old_str`/`new_str`. The
  earlier subagent claim of `path`/`old_str` for Claude was wrong. Alias sets still cover both
  spellings (they cost nothing and other providers do use `path`), but the presenter prefers
  `file_path`.
- **Claude's edit payload DOES carry before and after content.** Inline diff for Claude is therefore
  unconditional, not best-effort. The conditional fallback is still needed — but for Codex (no tool
  input at all), not for Claude.

Caveat: these are the schemas the Claude Code harness exposes. Archon calls the Claude _Agent SDK_,
which ships the same built-in tools but could drift by version. Strong evidence, not a frozen
contract — the alias sets absorb any drift.

**Q3 — `__advisor.jsonl` location: RESOLVED. The "free frontend path" is DEAD.**

In OMP's own terms the file sits next to the session transcript [S]:
`transcript-recorder.ts:163-165` joins `sessionFile.slice(0, -'.jsonl'.length)` with the filename,
and its docblock says explicitly _"derived from the session file … never `getArtifactsDir()` —
subagents adopt the parent's artifact manager … every subagent advisor would collide."_
That directory is byte-identical to OMP's `getArtifactsDir()` (`session-manager.ts:109-112`,
`:1971-1974`), so within OMP `<artifactsDir>/__advisor*.jsonl` is right, with subagent advisors one
level deeper at `<artifactsDir>/<SubId>/__advisor*.jsonl` (recursive scan needed).

**But OMP's artifacts dir is not Archon's.** `buildOmpArgs` passes
`['--mode','json','--cwd',cwd,'--yolo','--no-title']` plus model/thinking/skills/session flags and
**never `--session-dir`** (`omp/provider.ts:131`ff). [V] So OMP writes under
`~/.omp/agent/sessions/<encoded-cwd>/<ts>_<sessionId>/`, which Archon resolves only by _deriving_ it
from env (`omp/session-usage.ts:256-273`, and the matching comment at `:1018`
_"OMP: artifactsDir = sessionFile without `.jsonl`"_). [V] Archon's own artifact HTTP surface
(`GET /api/runs/:runId/artifacts`, `GET /api/artifacts/:runId/*`) serves
`~/.archon/workspaces/<project>/artifacts/runs/<id>/` — a different tree entirely.

Conclusion: **the web UI cannot reach advisor history through the existing artifact API.** My earlier
hypothesis was wrong, and the later hedge was right for the wrong reason (the dotfile rule was never
the obstacle; the directory is). Archon's backend _does_ already resolve that path for usage
accounting, so a new backend route could expose it — but the better route is different: advisor
messages arrive on the **live event stream** as `role:'custom'`/`customType:'advisor'`, so capture
them there (the two `return []` sites in §7) and treat the JSONL only as a history fallback.

**Q4 — OMP `todo` has NINE ops, not two. The fold sketched earlier is far too naive. [S]**
Schema `tools/todo.ts:69-88`:
`op: "init" | "start" | "done" | "rm" | "drop" | "block" | "unblock" | "append" | "view"`.
Statuses `pending | in_progress | completed | abandoned | blocked` (`todo.ts:21`). **Input carries no
status field at all** — status is implied entirely by which op ran. An item is a bare string on
input; on output it is `TodoItem { content, status, blocker? }` inside `TodoPhase { name, tasks }`.

Two behaviours that will produce wrong UI if ignored:

- **`{"op":"done"}` with neither `task` nor `phase` completes EVERY task in EVERY phase**
  (`getTaskTargets`, `todo.ts:389`). Same targeting for `drop`.
- **Every op is followed by auto-promotion** (`normalizeInProgressTask`, `todo.ts:146-161`): extra
  `in_progress` entries collapse to the first, and if none is in progress the earliest `pending` is
  promoted. **A row therefore changes tasks it never named.**

Two parsing gotchas: `op` may be **absent** and is repaired leniently (`inferTodoOp`,
`todo.ts:567-574` — `list`→`init`, `items`+`phase`→`append`); and legacy rows use a **batch** shape
`{ops:[…]}` alongside the current single-op shape (`todo.ts:913, 919-929`).

**Q5 — OMP `glob` has NO `pattern` field; `path` IS the pattern. The observed rows were normal. [S]**
Schema `tools/glob.ts:43-50`: `path?` (glob, file, or directory; `;`-separated for multiple targets;
defaults to `"."`), `hidden?` (default `true`), `gitignore?` (default `true`), `limit?`
(default and hard cap `200`). `readonly strict = true` (`glob.ts:149`) — extra keys are rejected,
which is exactly why `pattern` never appears. A `path` without glob metacharacters degrades to a
recursive listing (`parseFindPattern`, `path-utils.ts:1048-1077` → `globPattern: "**/*"`), so
`{"path":"src"}` means _list everything under `src/`_. There is **no `find` and no `ls` tool** —
`glob` is the only one; the internal name `findSchema` is legacy. So the earlier "odd" flag was
wrong: showing `path` as the headline is correct, and a duck-type on `path` already does it.

---

## 12. Architecture decisions (user-approved, 2026-09-09)

### Q8 — An injected user message IS a first-class transcript row. **Decided by the user.**

A mid-turn interjection changes what the node did. If it is not recorded, the audit trail claims the
node acted on its own when it acted on an instruction. So the interjection is persisted like any
other turn content — which means it needs the same additive metadata extension identified for
thinking and prompt (§7): an optional `text_kind` discriminator on `kind:'text'` rows, never a new
`kind` value (the DB CHECK constraint makes a new `kind` the dangerous option).

This also means **the queue and the audit log are the same artifact**, not two systems to keep in
sync — which is what makes the next decision cheap.

### Q9 — Keep one process per node execution. Put the queue in Archon. **Recommended and accepted.**

**Process lifetime stays exactly as today: one OMP process per `sendQuery` call**, i.e. per node
execution attempt (`omp/provider.ts:380` spawns inside `sendQuery`). [V]

Per-run (one long-lived process for a whole run) is rejected on four grounds, all evidenced:

1. **Concurrency.** `dag-executor.ts:5` — _"Independent nodes within the same layer run concurrently
   via Promise.allSettled."_ One shared process means one shared session: either serialize the layer
   (losing parallelism) or multiplex concurrent nodes into one session (silently sharing context and
   destroying the node independence the DAG exists to guarantee). [V]
2. **Pause duration.** A run can sit at an approval gate for hours or days. A long-lived process does
   not survive that, and AGENTS.md's _No Autonomous Lifecycle Mutation Across Process Boundaries_
   plus the CLI orphan-cleanup precedent say do not try.
3. **Retry.** `retry-node` resets a node and re-runs it; per-node maps 1:1 onto
   `occurrence_id`/`attempt_id`. A per-run process would have to be told to "forget" — exactly the
   hidden cross-boundary state the constitution warns about.
4. **Cross-node context is a deliberate opt-in** (`persist_session` + `--resume`). A shared process
   would make it the accidental default, reversing an explicit design decision.

**The three principles that make this hold up long-term:**

**(a) The queue belongs to Archon, not to any provider.** Claude Code and OMP independently arrived
at the same shape — a queue _outside_ the agent loop. Archon should own a durable inbox scoped to
one node execution. Why this is the long-term choice, not just the convenient one:

- Archon is multi-surface (Slack, Telegram, GitHub, Discord, web, CLI); a provider-owned queue
  cannot serve them.
- It survives crash, pause, resume and retry, because it lives in the database rather than in RAM.
- Q8 already makes interjections transcript rows, so queue and audit trail are one story.
- Every future provider gets steering at the Archon level for free; only _delivery_ is per-provider.

**(b) Delivery is a narrow opt-in port plus a capability flag — never a change to
`IAgentProvider`.** Q7 measured the blast radius: `sendQuery` has 11 implementors and 9 of them have
nothing to do with steering; AGENTS.md's ISP rule says define a new interface instead. OMP delivers
via the RPC `steer` command, Claude via the SDK's `AsyncIterable<SDKUserMessage>` + `priority`, and
everything else declares the capability false. This slots into the existing capability registry and
`bun run generate:capability-matrix`.

**(c) Degradation is loud and defined.** A provider that cannot steer must not silently drop the
message: either hold it and deliver at the next node boundary, or refuse the input with a reason
(AGENTS.md Fail-Fast). The capability flag is also what tells the UI whether to render the input box
at all — which is what keeps the promise in §8's state model: **the input appears only when it can
actually do something.**

**What this buys.** The engine never learns that OMP speaks RPC. If OMP changes protocol, a new
provider appears, or Claude's SDK gains a better channel, only that adapter changes; the queue,
the transcript rows, the UI, and the governance story stay put.

**The cost, stated plainly.** Per-node spawn cost remains. RPC does not worsen it — same spawn,
different mode. If it ever bites, a warm process pool is an optimization _behind_ the port that
changes no contract; that it can be added later without disturbing anything is itself evidence the
boundary sits in the right place.

**Hard requirement that comes with this.** The RPC session must be registered and torn down
deterministically at node end. Moving from single-shot to a persistent session is precisely the
change that breeds orphaned processes, and each node now holds a longer-lived process than before.

### Still open

- Nothing blocking from §10. Remaining work is design/planning, not research.
- One item deferred by nature: confirming Claude Agent SDK's built-in tool schemas match the Claude
  Code harness schemas recorded in §11, which a single real Claude run would settle.
