# Live, interactive agent view — verified findings

Companion to `design.md` in this directory, which carries the decisions. Split out to keep each
file under the project's 800-line documentation limit. Read `design.md` first — it states the
beliefs these findings overturn.

Evidence marking: **[V]** verified by reading source in session · **[S]** subagent-reported with
file:line, not personally re-read · **[?]** unverified. Version-skew caveats are in `design.md`.

## 3. Verified findings

### 3.1 The surfaces already share a render-neutral data layer [V]

```
workflow_node_messages (DB)
  → GET /api/workflows/runs/{runId}/nodes/{nodeId}/messages   (afterSeq / nextCursor / highWatermark)
  → lib/node-message-pages.ts        NodeMessageRow[]
  → lib/project-text-transcript.ts   merge streamed text deltas
  → lib/pair-tool-transcript.ts      pair tool call + result
  → lib/agent-history.ts             buildAgentHistory() → AgentHistoryItem[]
      ├─→ Legacy  NodeRoom.tsx
      └─→ Console ConsoleAgentHistoryList.tsx
```

`AgentHistoryItem` is a three-arm union (`assistant` | `tool` | `lifecycle`) — `agent-history.ts:18-48`.

### 3.2 The render fork is deliberate and absolute [V]

`ConsoleAgentHistoryList.tsx:1-4`: _"Console-owned agent history renderer. Uses AgentHistoryItem only
as data and never imports Legacy React components."_ Console imports **zero** components from
`@/components/`. Legacy is scheduled for deletion (`App.tsx:93-95`); Console is already the default
(`App.tsx:75-76`).

**Consequence: shared logic goes in `lib/`; JSX is written twice, thin.** Duplicating a little JSX
for a surface that is being deleted beats refactoring code on its way out.

### 3.3 Transcript schema and execution identity [V]

`workflows/src/schemas/node-message.ts:30-36` — closed union, **exactly three kinds**:
`text {text}` · `tool {name,id,input?,output?}` · `status {state,detail?}`.
The DB enforces it with `kind IN ('text','tool','status')` [S], and
`nodeTranscriptMetadataSchema` is `.strict()` (`schemas/node-execution.ts:43`).

`schemas/node-execution.ts:9-24`:

```ts
LoopAncestryEntry = { node_id: string; iteration: number }   // iteration: positive int
TranscriptExecutionScope = { occurrence_id, attempt_id, retry_epoch?, loop_ancestry?, route_activation_seq? }
```

- `mintTranscriptExecutionScope()` → **new occurrence + new attempt**; called per retry and per loop
  iteration (`dag-executor.ts:263, 1987, 3614, 3908, 5185, 5461`).
- `newTranscriptAttempt()` → **same occurrence, new attempt** (`dag-executor.ts:2286, 6330`).
- **One occurrence contains many attempts.** Naming a UI group "Attempt" while `attempt_id` means
  something finer is a collision — see §5.7.

Neither renderer reads any of this today.

### 3.4 Provider tool naming [V]

`superpower-feature.yaml` mixes providers **in one run**: `omp` (line 8), `claude` (31), `codex` (82).
A single transcript can carry three conventions.

| Provider              | Names                                                             | Input                                                 | Note                                       |
| --------------------- | ----------------------------------------------------------------- | ----------------------------------------------------- | ------------------------------------------ |
| **omp**               | lowercase `read` `glob` `grep` `todo` `task`                      | `path`, `pattern`, `op`/`list`                        | dominant in the local DB                   |
| pi                    | lowercase, 7 built-ins `read bash edit write grep find ls`        | `path`                                                | `pi/options-translator.ts:148` [S]         |
| **claude**            | PascalCase, 24 names (`claude/capabilities.ts:11-36`)             | **`file_path`, `command`, `old_string`/`new_string`** | renames `Task`→`Agent`, `MultiEdit`→`Edit` |
| codex                 | **tool name IS the raw command**; web search `🔍 Searching: ${q}` | **no `input` attached**                               | `codex/provider.ts:541-560` [S]            |
| opencode/copilot/grok | SDK passthrough, no declared vocabulary                           | passthrough                                           | no `knownToolNames`                        |

**Claude's keys are settled from primary evidence.** This research ran _inside Claude Code_, so its
built-in tool schemas were directly observable: `Read {file_path, offset, limit}` ·
`Edit {file_path, old_string, new_string, replace_all}` · `Write {file_path, content}` ·
`Bash {command, timeout, description, run_in_background}`. This matches the repo's own fixtures
(`plannotator-gate-executor.test.ts:662`, `claude/provider.test.ts:230,505`, `tool-formatter.ts:45`)
and refutes an earlier subagent claim of `path`/`old_str`.

Two consequences: **Claude's edit payload carries before _and_ after content**, so inline diff for
Claude is unconditional (§5.6); and Archon hardcodes **no** Claude key anywhere under
`providers/src/claude/` — pure pass-through — so alias sets remain the correct design even though the
spelling is now known. [V]

~~Residual risk **[?]**: these are the _Claude Code harness_ schemas; Archon calls the Claude _Agent
SDK_, same built-in tools but could drift by version.~~ **Resolved 2026-09-09 [V].** The published
Agent SDK `sdk-tools.d.ts` for the pinned 0.3.209 declares the same shapes — `FileEditInput`
`{file_path, old_string, new_string, replace_all?}`, `FileReadInput {file_path}`,
`FileWriteInput {file_path, content}`, `BashInput {command}`. No drift, and no exploratory run needed.

Reading that file also settled two things alias sets can **not** absorb, because they are semantic
rather than lexical:

- **`GlobInput {pattern, path?}` — `path` is the directory to search.** OMP's `glob` has no `pattern`
  and its `path` **is** the pattern. The same key, opposite meanings. A resolver reading `path` for
  the glob family would show a Claude user their search directory instead of their pattern.
- **`GrepInput.output_mode` defaults to `files_with_matches`**, so Claude's grep returns bare file
  paths, not `path:line` matches, unless the model asked for content. The body arm has to come from
  `output_mode`, not from the family.

And two tools are structurally different between providers, not merely spelled differently:
Claude's `TodoWriteInput {todos:[{content,status,activeForm}]}` is a whole-list replacement with
explicit statuses and no phases, against OMP's nine mutating ops; Claude's `AgentInput
{description,prompt,subagent_type?}` is a **single** dispatch against OMP's batch. Both are handled
by per-provider normalizers at the `lib/` edge rather than by branching in a renderer.

### 3.5 Real payloads — the local sample was not representative [V]

**Corrected 2026-09-09.** This section was first written from the laptop database: 46 tool rows, one
run, names `read` 31 · `glob` 7 · `grep` 5 · `todo` 2 · `task` 1, `output` absent on every row.
Measuring the **deployment** database instead (read-only, `sqlite3 -readonly` on the Mac mini's
`/Users/agent/.archon/archon.db`, 1.7 GB) gives a different picture entirely:

|                        | laptop | deployment      |
| ---------------------- | ------ | --------------- |
| tool rows              | 46     | **22,867**      |
| runs                   | 1      | **31**          |
| distinct tool names    | 5      | **2,369**       |
| rows carrying `output` | 0      | roughly a third |

The laptop sample came from a **research** workflow — it reads and searches, never writes — so it
contained no `bash`, no `edit`, and none of the write-heavy traffic that dominates real runs.

**Measured family coverage over all 22,867 rows**, using the alias table as first drafted:

```
file-read 5554 · GENERIC FALLBACK 4914 · codex-shell (tier 3) 4911 · shell 3584
search 2625 · file-write 803 · glob 228 · todo 198 · task 46 · web 6
```

**21.5% of real rows would have rendered as bare `key: value`** — the exact defect the work exists to
remove, invisible in a sample that happened to be 100% covered. What the fallback actually contained:

| name                                                                          | rows  | belongs to                                                                                |
| ----------------------------------------------------------------------------- | ----- | ----------------------------------------------------------------------------------------- |
| `read_file`                                                                   | 1,605 | file-read — and it carries the path in **`target_file`**, a key the resolver did not know |
| `run_terminal_command`                                                        | 1,182 | shell                                                                                     |
| `search_replace`                                                              | 904   | **file-write**, despite the name containing "search"                                      |
| `eval`                                                                        | 821   | a code-execution family that did not exist; carries `code` + `language`                   |
| `hub` · `get_command_or_subagent_output` · `search_tool` · `lsp` · `list_dir` | 379   | mixed                                                                                     |

Three consequences, all now in `SPEC-readable-agent-transcript`:

- **Alias matching normalizes the name** (case-fold, strip `_` and `-`) and matches **exact tokens,
  never substrings.** `search_replace` → `searchreplace` _contains_ `search` but is an edit tool;
  substring matching would misfile 904 rows into the wrong family.
- **Codex tool names are frequently multi-line** — whole shell loops and `&&` chains stored as the
  name, across 4,911 rows. A collapsed row is one line, so the headline must take the first non-empty
  line only. This is a main path, not an edge case.
- Adding five measured aliases, the `target_file` key, and a `code` family drops the generic fallback
  from 21.5% to under 2%.

The payload examples below remain from the laptop sample; they are the `todo` and `task` shapes.

```jsonc
{"op":"init","list":[{"phase":"Research","items":["Read story 5.5 spec and brainstorm","…"]},{"phase":"Plan","items":["…"]}]}
{"op":"done","task":"Read story 5.5 spec and brainstorm"}
{"context":"# Goal\n…# Constraints\n…","tasks":[{"name":"ScoutConsole","agent":"scout","task":"# Target\n…"}]}
```

**`todo` has nine ops [S]** (`tools/todo.ts:69-88`):
`init | start | done | rm | drop | block | unblock | append | view`.
Statuses `pending | in_progress | completed | abandoned | blocked` (`todo.ts:21`).
**Input carries no status field** — status is implied entirely by which op ran. An item is a bare
string on input; on output it is `TodoItem {content, status, blocker?}` in `TodoPhase {name, tasks}`.

Two behaviours that produce wrong UI if ignored:

- **`{"op":"done"}` with neither `task` nor `phase` completes EVERY task in EVERY phase**
  (`todo.ts:389`). Same targeting for `drop`, and `rm` with neither clears everything.
- **Every op is followed by auto-promotion** (`normalizeInProgressTask`, `todo.ts:146-161`): extra
  `in_progress` collapse to the first, and if none is in progress the earliest `pending` is promoted.
  **A row therefore changes tasks it never named.**

Two parsing gotchas: `op` may be **absent** and is repaired leniently (`inferTodoOp`,
`todo.ts:567-574` — `list`→`init`, `items`+`phase`→`append`); legacy rows use a **batch** shape
`{ops:[…]}` (`todo.ts:913, 919-929`).

**`glob` has no `pattern` field — `path` IS the pattern [S]** (`tools/glob.ts:43-50`): `path?`
(defaults `"."`; `;`-separated for multiple targets), `hidden?` (default true), `gitignore?`
(default true), `limit?` (default and cap 200). `strict = true` rejects extra keys, which is why
`pattern` never appears. A `path` with no glob metacharacters degrades to a recursive listing
(`path-utils.ts:1048-1077`). There is **no `find` and no `ls` tool**; `findSchema` is legacy naming.

### 3.6 Advisor — two entirely different mechanisms

**Claude Code: a server-side tool — reachable but untestable. [S]** The model emits
`server_tool_use{name:'advisor'}`; the API runs the advisor model server-side and continues the
**same assistant message** with an `advisor_tool_result` block (`utils/advisor.ts:9-44`). No client
injection exists anywhere.

**It is NOT confined to the CLI.** The block survives normalization
(`utils/messages.ts:2747-2748`, `default: return contentBlock`), is not filtered as empty
(`:711-712`), and reaches stdout (`cli/print.ts:886`). The SDK forwards it unfiltered — verified
against the **published 0.3.209 artifact**: `ProcessTransport.readMessages()` JSON-parses each line
with no allowlist (`sdk.mjs@537805`), and `Query.readMessages()` intercepts only
control/keep-alive/transcript frames, enqueueing everything else (`sdk.mjs@546087`). `isAgenticQuery`
explicitly includes `options.querySource === 'sdk'` (`services/api/claude.ts:1065-1070`), gating the
advisor tool at `:1081` — **built to fire for SDK consumers.** The data would arrive in Archon's
existing `for await` loop today; §3.9 records where it is then dropped.

**Discriminate on block `type` only.** `advisorModel` is **dropped** before the SDK frame
(`utils/queryHelpers.ts:110-117`) and absent from the published type (`sdk.d.ts:2787-2810`) — Archon
can never learn which advisor model answered. Assistant-role is true but useless, since every block
arrives in its own assistant frame. Three payload variants (`utils/advisor.ts:16-32`):
`advisor_result{text}` (the only displayable one), `advisor_redacted_result{encrypted_content}`,
`advisor_tool_result_error{error_code}`. The blocks are untyped in the SDK — upstream says so
(`utils/advisor.ts:7-8`).

**The real blocker is testability.** Four gates, none operator-settable: GrowthBook flag
`tengu_sage_compass` (server-delivered, `utils/advisor.ts:53-58`), beta header
`advisor-tool-2026-03-01`, first-party/Foundry only (`constants/betas.ts:32`; Bedrock/Vertex 400),
base model `opus-4-6`/`sonnet-4-6`, and a kill switch that only turns it _off_. **A self-hosted
install cannot enable it with its own key.** Resolved in §11.5.

**OMP: a separate reviewer agent. [S]** Own model, own session, own transcript. Driven **once per
completed primary turn** — not a timer, not a tool count (`agent-session.ts:1240-1251` →
`session-advisors.ts:336-354`). Returns advice through one tool, `advise(note, severity)`. Off by
default (`advisor.enabled = false`); needs `--advisor`.

Reaches the running agent as a `role:"custom"` / `customType:"advisor"` message via three channels —
`aside` (`nit`), `steer` (`concern`/`blocker`), `preserve` — **all three surfacing on the stream as
`message_start` + `message_end`**:

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

Detector: `message.role === 'custom' && message.customType === 'advisor'`; `details.notes` is the
structure, `content` the exact bytes the model saw.

**`__advisor.jsonl` is NOT reachable from Archon's artifact API. [V]** In OMP's own terms it sits
next to the session transcript, in a directory byte-identical to OMP's `getArtifactsDir()`
(`session-manager.ts:109-112, 1971-1974`) [S]. But `buildOmpArgs` never passes `--session-dir`
(`omp/provider.ts:131`ff), so OMP writes under `~/.omp/agent/sessions/<encoded-cwd>/<ts>_<id>/`,
which Archon only _derives_ for usage accounting (`omp/session-usage.ts:256-273, 1018`). Archon's
artifact routes serve `~/.archon/workspaces/<project>/artifacts/runs/<id>/` — a different tree.
**So capture advisor from the live event stream (§3.9), and treat the JSONL as a history fallback.**

### 3.7 Mid-turn input — both harnesses converge on one pattern [S]

|                                      | Claude Code                                                         | OMP                                                            |
| ------------------------------------ | ------------------------------------------------------------------- | -------------------------------------------------------------- |
| Queue                                | `messageQueueManager.ts:40-56`, module-global, outside React        | `#steeringQueue`/`#followUpQueue`, `agent.ts:990-1005`         |
| Priorities                           | `now` / `next` / `later` (`textInputTypes.ts:269-287`)              | `steer` / `followUp`, `set_steering_mode`                      |
| Drain point                          | tool-round boundary, `query.ts:1547-1590`                           | tool-batch boundary, `agent-loop.ts:1044/1449/1478`            |
| Injection                            | `queued_command` attachment → user msg in a system-reminder wrapper | push into `currentContext.messages`, `agent-loop.ts:1089-1097` |
| **Streaming input to the model API** | **NO** — fixed `messages` array                                     | **NO** — materialized array                                    |
| Interrupt                            | separate (Esc / SDK `interrupt()` / `priority:'now'`)               | separate (`abort`; deliberately **keeps** the steer queue)     |

**The enabler is not an SDK feature.** "Mid-turn" means _between two API calls_, at a tool boundary.
What is required is a queue plus a drain point — and **both live inside the harness**, in the rows
above. Archon has neither: `dag-executor` consumes the provider's stream and appends transcript rows
as chunks pass (§3.9); it does not drive the tool loop. So Archon's job is to _send_, at a moment of
its choosing, and the harness drains at its own boundary (§4.3a).

Claude Code's injection preamble (`utils/messages.ts:5496-5512`) distinguishes `human` /
`coordinator` / `channel` / `task-notification` origins and marks non-user origins untrusted — worth
copying as a pattern.

### 3.8 OMP `--mode json` → `--mode rpc`

**The wire does not change at protocol v1. [V]** `rpc-frame.ts:5-8`: _"Maximum UTF-8 size of one
**newline-delimited** RPC frame"_, `MAX_RPC_FRAME_BYTES = 1 MiB`. Chunking exists **only in v2**, and
v2 activates only after an explicit `negotiate_protocol` (`rpc-mode.ts:736-740`). At v1,
`encodeRpcFrameFromJson` (`rpc-frame.ts:242-260`) always emits exactly one newline-terminated line;
oversized frames are compacted then progressively shrunk, never split. **Staying on v1 means no
frame codec to write and line-splitting survives.**

|                  | `--mode json` (today)             | `--mode rpc`                                                                                                     |
| ---------------- | --------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Wire             | NDJSON                            | NDJSON at v1; chunked at v2                                                                                      |
| `session` header | first line (`print-mode.ts:114`)  | **never emitted** — see trap 0                                                                                   |
| Event payload    | filtered by `printableEvent`      | **raw** — `session.subscribe(e => output(e))`, `rpc-mode.ts:977-980`                                             |
| Lifecycle        | single-shot; exits after the turn | persistent; `ready` handshake (`rpc-mode.ts:727-735`), exits on **stdin EOF** (`:1521-1540`)                     |
| Inbound          | none                              | `prompt` · `steer` · `follow_up` · `abort` · `abort_and_prompt` · `set_steering_mode` · `set_interrupt_mode` [S] |

**Three traps. Trap 0 breaks every turn. [S]**

**0 — rpc mode never emits the `session` header.** `sessionManager.getHeader()` is written to stdout
at exactly one place in the mode layer, `print-mode.ts:114`; `rpc-mode.ts` never calls it — rpc's
first line is `ready` instead. Archon derives `sessionId` **only** from that header
(`event-parser.ts:160-167`) and `buildResult` hard-fails without it (`:81-99`):
`omp_incomplete_output — "OMP CLI completed without a required session header."` **Switching mode
with no other change fails every turn, blaming a missing header rather than the switch.**
Fix: issue the `get_state` command and seed `sessionId` from `data.sessionId`
(`rpc-types.ts:108`, required; handler `rpc-mode.ts:1106-1116`). The one alternative is closed —
`main.ts:1072` also calls `getHeader()` but reads `providerPromptCacheKey` for fork inheritance and
never writes to stdout. Two weaker carriers exist (`session_info_update`, `get_messages_page`) but
neither is emitted spontaneously.

**1 — the payload driver is `partial`, not `providerPayload`.** `printableEvent` strips **two**
classes (`print-mode.ts:58-83`): `providerPayload`, and `assistantMessageEvent.partial` — a whole
in-progress `AssistantMessage` snapshot riding **every** streaming delta (11 variants,
`types.ts:1284-1294`). OMP's own docblock says the `partial` strip exists to keep transcripts linear
instead of quadratic, and that its absence once produced multi-GB logs (`print-mode.ts:45-57`). rpc
subscribes raw, so the snapshot goes on the wire. **No command suppresses it** — the 39-command
`RpcCommand` union has a subscription filter for _subagents_ only (`rpc-types.ts:28-66`);
`streamingBehavior` is queue policy, not verbosity. Archon reads only
`assistantMessageEvent.{type, delta}` (`event-parser.ts:218-228`), so `partial` is pure wire waste
for Archon — but it is what pushes frames toward the 1 MiB ceiling. Resolved in §11.4.

**2 — lifecycle, not parsing, is the bulk of the work** — single-shot → persistent session changes
process management, prompt delivery (arg → `prompt` command), and teardown. Note rpc exits on
**stdin EOF**, not after `agent_end`: a reader that waits for `agent_end` and expects the process to
exit will hang (§4.3, hard requirement).

### 3.9 What Archon drops today — gaps and one real bug [V]

- `omp/event-parser.ts:168-179` — `message_start` only acts when `role === 'assistant'`, else `[]`.
- `omp/event-parser.ts:232` — `consumeMessageEnd` returns `[]` unless `role === 'assistant'`.
  → **All OMP advisor messages die at these two lines.**
- `omp/provider.ts:131` — args are `['--mode','json','--cwd',cwd,'--yolo','--no-title']` plus
  model/thinking/skills/session flags; **no `--advisor`**, and OMP defaults it off, so advisor has
  never run under Archon.
- `omp/event-parser.ts:23-31` — `isFollowUpTurnEvent` allowlists only `message_start`,
  `message_update`, `message_end`, `tool_execution_start`, `tool_execution_end`. A `todo_reminder`,
  `auto_compaction_*` or `notice` after `agent_end` is silently dropped **and** leaves `sawAgentEnd`
  set. OMP already emits `agent_end.isTerminal` [S], the correct signal. **This is a bug.**
- **Claude: unknown content blocks are dropped without a sound. [S] This is a second real bug.**
  `claude/provider.ts:1139-1150` handles `text` and `tool_use` with **no `else`** — no log, no event.
  The root cause is one file up: `ContentBlock` is hand-declared as `type: 'text' | 'tool_use'`
  (`:95-101`), so the compiler cannot see a case the local type says is impossible. That is a live
  violation of AGENTS.md _SDK Type Patterns_. Contrast `:1269`, which already logs unknown **system**
  subtypes as `claude.system_message_unhandled` — the content-block equivalent is simply missing.
  It matters beyond advisor: `getExperimentAdvisorModels()` (`utils/advisor.ts:75-85` +
  `services/api/claude.ts:1084-1093`) lets Anthropic enable advisor **server-side with no Archon
  change**, on the branch that fires precisely when the operator may _not_ configure anything. On
  that day Archon starts losing data with zero signal. Fix is ~20 lines and independent of both
  tracks — see §11.5.
- **Thinking is never persisted.** Providers emit `MessageChunk {type:'thinking', content}`
  (`providers/src/types.ts:317`; omp `event-parser.ts:226`, codex `provider.ts:668`, pi
  `event-bridge.ts:304`, opencode `session.ts:215`) but **no handler for `chunk.type === 'thinking'`
  exists anywhere in `@archon/workflows`**, and `appendNodeTranscript` is only ever called with
  `kind` `status`/`text`/`tool` (`dag-executor.ts:2002, 2350, 2423, 5204, 5777, 5994`).
- **The resolved prompt is never persisted.** `node_started` carries `command`, `provider`, `tier`,
  `model`, `modelReasoningEffort`, `effort` — no prompt (`dag-executor.ts:2017-2034`).
- Unhandled OMP session events [S]: `todo_reminder`, `auto_compaction_start`/`_end` (**not**
  `compaction_start/end`), `auto_retry_end`, `retry_fallback_applied`, `model_changed`,
  `ttsr_triggered`, `todo_auto_clear`, `irc_message`, `thinking_level_changed`, `goal_updated`.

### 3.10 Interaction primitives already present [V unless marked]

- **AskHuman is fully wired, end to end — the earlier "Web UI not wired" [S] was wrong. [V]** The
  route `POST /api/workflows/runs/{runId}/ask/{requestId}/answer` (`api.ts:1489-1491`) has UI on
  **both** surfaces: Legacy `components/workflows/{AskCard,WorkflowAskChrome}.tsx` +
  `ask-answer-controller.ts` + `parse-ask-envelope.ts`; Console
  `experiments/console/components/ask/ConsoleAskChrome.tsx`. Shipped by BMad epics 5 and 6 of
  `SPEC-workflow-run-view-hitl`, all 13 stories `done`
  (`_bmad-output/implementation-artifacts/workflow-run-view-hitl/sprint-status.yaml:47-62`),
  most recently commit `56c61f72` _"feat(web): align agent history and the responsive run room"_.
  **Consequence: the interactive surface is not greenfield.** Track B extends an existing Ask card
  and an existing node-room timeline rather than building one — and any Track B design must start
  from that SPEC, not from this document (see design.md §6).
- `pending_interactions` (kind ask|permission, status pending|answered|purged); approval gates work,
  `capture_response: true` keeps the reviewer's comment.
- SSE: `GET /api/stream/:conversationId`, `GET /api/stream/__dashboard__` (`api.ts:3729-3778`). [S]
- Node-message API supports live tail + backfill (`afterSeq` / `nextCursor` / `highWatermark`). [S]
- **No** route for unsolicited input to a running node. [V]
- Container-paused runs are CLI-resumable only. [S]
- Git routes are **run-scoped, never node-scoped**. [S]
- `sendQuery` takes `prompt: string` and is declared on `IAgentProvider` (`types.ts:903`) with
  **11 implementors** — claude, codex, copilot, pi, grok, deepseek, qodercli, omp, opencode,
  e2e-fake, and the `observability.ts` decorator. [V]
- OMP is spawned **inside `sendQuery`** (`omp/provider.ts:380`), and independent nodes in a layer run
  concurrently via `Promise.allSettled` (`dag-executor.ts:5`). [V]

---
