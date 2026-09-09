# Live, interactive agent view — research + design

Date: 2026-09-09 · Branch: `develop` · User: kevin

**Status: research record + agreed design decisions. NOT an implementation plan.**
Track A below is detailed enough to plan from. Track B is a sketch and needs its own design pass.

Supersedes and merges:

- `plans/260909-1957-readable-agent-transcript/design.md` — the earlier, narrower "make the
  transcript readable" design. **Deleted 2026-09-09** by the user's decision: it held nothing this
  document does not, and where the two differed it was wrong. Recoverable from git if ever needed
  (`git checkout -- plans/260909-1957-readable-agent-transcript/`).
- `plans/reports/research-260909-2107-live-interactive-agent-view.md` — **kept**. It records the
  research _process_: which subagent reported what, where two contradicted each other, and where a
  conclusion was drawn wrong and corrected. This document keeps only the conclusions, so that report
  is the audit trail behind every [S] finding here.

Evidence marking: **[V]** verified by reading source in session · **[S]** subagent-reported with
file:line, not personally re-read · **[?]** unverified.

**Beliefs this document overturns.** Each was believed during the work and is now disproved by
source. If you carry one in from an earlier read or an earlier doc, it is wrong:

| Belief                                       | Reality                                                                                    | Where       |
| -------------------------------------------- | ------------------------------------------------------------------------------------------ | ----------- |
| `todo` has two ops                           | nine, and bare `done`/`drop`/`rm` target **everything**                                    | §3.5, §5.5  |
| `glob` is a content search                   | its output is a **file list**; a metacharacter-free `path` is a directory listing          | §3.5, §5.2  |
| `text_kind` needs no backend change          | no DB migration, but the metadata schema is `.strict()`                                    | §4.2        |
| `dag-executor` has a tool-round drain point  | it consumes the stream; the drain is the harness's                                         | §3.7, §4.3a |
| `providerPayload` is the rpc payload problem | it is `undefined` outside OpenAI-Responses; the driver is `partial`                        | §3.8, §11.4 |
| Claude's advisor is unreachable              | it reaches Archon today; **testability** is the blocker                                    | §3.6, §11.5 |
| `advisorModel` identifies the advisor        | dropped before the SDK frame                                                               | §3.6        |
| AskHuman's web UI is not wired               | **shipped on both surfaces**; Track B extends it, and a prior BMad SPEC owns that contract | §3.10, §6   |

**Two bugs found along the way**, both independent of either track: the `isFollowUpTurnEvent`
allowlist (§3.9) and Claude's silent drop of unknown content blocks (§3.9, §11.5).

**Version-skew caveats, carried into every [S] citation.** OMP is cited at 18.0.4 against an 18.0.11
binary that Archon does not pin (§11.6). The claude-code checkout is `claude-code-oss 2.15.1` while
the SDK declares `2.1.209` — unorderable from source. SDK citations are against the **published
0.3.209 artifact**, fetched by the hash-pinned version rather than read from `node_modules`.

Evidence: `plans/reports/scout-260909-2158-omp-providerpayload-rpc-v2.md` ·
`plans/reports/scout-260909-2158-claude-advisor-sdk-reachability.md`

---

## 1. Scope

**Outcome.** The node room becomes a place to _watch an agent work and intervene_, not a log to read
afterwards. The user's rule: click a **running** node → interact; click a **finished** node → read
the full history.

Two tracks, deliberately separable:

| Track                       | What                                                 | Backend? | Applies to old runs?   |
| --------------------------- | ---------------------------------------------------- | -------- | ---------------------- |
| **A — readable transcript** | tool cards, todo, task, diffs, attempt grouping      | no       | **yes, retroactively** |
| **B — live + interactive**  | thinking, initial prompt, advisor, mid-turn steering | yes      | no — new runs only     |

Track A is a pure function of data already stored, so it improves every historical run the moment it
ships. Track B needs persistence that does not exist yet, so it can never apply retroactively. That
asymmetry is the reason to keep them apart.

A third piece — a run-level "Files changed" panel for Console — stays out of both; the git routes
are run-scoped, not node-scoped (§9).

## 2. Problem

Both node rooms render every tool call as two always-open `<pre>` blocks of pretty-printed JSON: [V]

- Legacy `components/workflows/NodeRoom.tsx:255-264`
- Console `experiments/console/components/inspect/ConsoleAgentHistoryList.tsx:187-196`
- both via `lib/pair-tool-transcript.ts:75-78` `formatToolIo()` = `JSON.stringify(v, null, 2)`

Two compounding faults: **`<details open>`** (input _and_ output expanded by default, so a 40-call
run is a wall of JSON), and **no semantic summary** — the only humanising step is
`agent-history.ts:171` `toolContext()`, driven by
`TOOL_CONTEXT_KEYS = ['cmd','path','file_path','query','url']` (`agent-history.ts:50`), which misses
`command` and `pattern` and so contributes almost nothing.

Separately, several things the agent does are **never shown at all**: its thinking, the prompt that
started it, advisor notifications it receives mid-work, and OMP's todo/compaction lifecycle (§3.9).

---

## 3. Verified findings

**Moved to `findings.md` in this directory** — §3.1 through §3.10, unchanged. Split out so each
file stays under the 800-line documentation limit. Every `§3.x` reference below resolves there.

## 4. Decisions

### 4.1 Visual — settled against interactive mockups

Mockups at `.superpowers/brainstorm/19932-1788959699/content/{transcript,transcript-v2}.html`
(`.superpowers/` is gitignored).

- One line per tool call, **collapsed by default; failures auto-expand**.
- **Chip** = short stable label (details §5.3); **status glyph** `✓ ✕ ◐` plus colour, never colour
  alone; **path headlines elide in the middle**; unknown tools fall back to `key: value`, never JSON.

### 4.2 An injected user message is a first-class transcript row

A mid-turn interjection changes what the node did. If it is not recorded, the audit trail claims the
node acted alone when it acted on an instruction. So it is persisted like any other turn content —
which needs the same additive metadata extension as thinking and prompt: an optional **`text_kind`
discriminator on `kind:'text'` rows**, never a new `kind` value. The DB CHECK constraint on `kind`
(§3.3) makes a new kind the dangerous option.

**Cost, stated exactly.** No DB migration — the metadata column is already JSON, so no column is
added and no shipped writer breaks. But `nodeTranscriptMetadataSchema` is `.strict()`
(`node-execution.ts:43`, §3.3), so a new field is rejected until the Zod schema declares it. The
change is therefore: **strict Zod schema + wire schema + `bun --filter @archon/web generate:types`** —
a backend change in `@archon/workflows`, which is why this belongs to Track B and not Track A (§1).

**Who writes it.** Archon, at the moment it hands the text to the provider port (§4.3b). Recording and
delivering are one step, so a delivered message can never be missing from the transcript — and an
interjection that cannot be delivered is refused rather than stored for later (§4.3a).

Note what this does **not** claim: the tool-round-boundary drain in §3.7 is the _harness's_ internal
mechanism (OMP's `#steeringQueue`, Claude's `messageQueueManager`), not Archon's. `dag-executor`
consumes the provider's stream and appends transcript rows as chunks pass (§3.9); it does not drive
the tool loop and has no boundary hook to drain at. Archon queues and records; the provider injects
at its own boundary. Whether the row is sequenced at send time or at injection time is a real
question and is left to the Track B design pass (§11.2). §6 therefore puts the schema before the
queue: the queue writes what the schema makes legal.

Because of this, **the interjection and its audit record are the same write** — which is what makes
4.3 cheap.

### 4.3 One process per node execution; the steering seam lives in Archon

**Status: accepted by the user (2026-09-09), after advisor review of the decision itself.** Two
overstatements were trimmed at that review and are marked below: no inbox table is pre-committed
(a), and the warm-pool escape hatch is bounded by what RPC allows post-spawn ("The cost").

**Process lifetime stays as today: one OMP process per `sendQuery`,** i.e. per node execution
attempt. Per-run (one long-lived process per run) is rejected on four evidenced grounds:

1. **Concurrency** — independent nodes in a layer run concurrently (`dag-executor.ts:5`). One shared
   process means one shared session: either serialize the layer, or multiplex concurrent nodes into
   one session and silently share context, destroying the node independence the DAG guarantees.
2. **Pause duration** — a run can sit at a gate for hours or days; a long-lived process will not
   survive it, and AGENTS.md's _No Autonomous Lifecycle Mutation Across Process Boundaries_ plus the
   CLI orphan-cleanup precedent say do not try.
3. **Retry** — `retry-node` maps 1:1 onto `occurrence_id`/`attempt_id` with a per-node process; a
   per-run process would have to be told to "forget", exactly the hidden cross-boundary state the
   constitution warns about.
4. **Cross-node context is a deliberate opt-in** (`persist_session` + `--resume`); a shared process
   would make it the accidental default.

**Three principles that make this hold up long-term:**

**(a) Archon records and gates; the transcript row is the durable artifact.** The steering seam
belongs above the provider: Archon is multi-surface (Slack, Telegram, GitHub, Discord, web, CLI) and
a provider-owned queue cannot serve them, while every future provider then gets steering for free
with only _delivery_ per-provider.

**What is durable is the `kind:'text'` row of §4.2 — not a pending-message queue.** An undelivered
interjection is never replayed. _Paused_: the node is not running, so §6 does not render the input
box — nothing to enqueue. _Crash or retry_: a new attempt restarts from the original prompt, so a
message aimed at attempt N ("stop, wrong file") describes state attempt N+1 never reached; replaying
it would mislead the agent. Delivery is immediate to a live port, or refused with a reason (c).
Whether an inbox table is ever warranted is a Track B question — none is committed here, per
AGENTS.md's YAGNI rule against schema with no caller.

**(b) Delivery is a narrow opt-in port plus a capability flag — never a change to `IAgentProvider`.**
11 implementors, 9 irrelevant (§3.10); AGENTS.md's ISP rule says define a new interface. OMP delivers
via RPC `steer`, Claude via the SDK's `AsyncIterable<SDKUserMessage>` + `priority`, everything else
declares the capability false. Slots into the existing capability registry and
`bun run generate:capability-matrix`.

**(c) Degradation is loud and defined.** A provider that cannot steer must not silently drop the
message: hold it for the next node boundary, or refuse the input with a reason (AGENTS.md Fail-Fast).
The capability flag is also what tells the UI whether to render the input box — keeping the promise
in §6's state model that **the input appears only when it can do something**.

**What this buys.** The engine never learns that OMP speaks RPC. Protocol changes, new providers, or
a better Claude channel touch only that adapter; the queue, transcript rows, UI and governance stay put.

**The cost, stated plainly.** Per-node spawn cost remains; RPC does not worsen it. If it ever bites, a
warm pool is possible _behind_ the port — but constrained by what RPC allows after spawn: the inbound
commands are `prompt · steer · follow_up · abort · abort_and_prompt · set_steering_mode ·
set_interrupt_mode` (§3.8), with no `set_cwd` and no `set_model`, and both `--cwd` and the model are
spawn-time args (`omp/provider.ts:131`). So a pool would have to be keyed per `(cwd, model, …)`. That
is a real limit, not a free optimization — it is not offered as proof the boundary is right.

**Hard requirement.** The RPC session must be registered and torn down deterministically at node end.
Single-shot → persistent session is precisely the change that breeds orphaned processes — and rpc
mode makes the teardown _explicit_: it exits on **stdin EOF**, not after `agent_end`
(`rpc-mode.ts:1521-1540`), so closing stdin is the termination signal. Waiting for `agent_end` and
expecting exit hangs the node.

---

## 5. Track A design — the transcript presenter (frontend only)

### 5.1 New module `packages/web/src/lib/tool-presentation.ts`

Pure, React-free, provider-agnostic. Input is structural, not tied to `AgentHistoryItem`, so
`ToolCallCard.tsx` can adopt it later without a rewrite.

```ts
export interface ToolPresentationInput {
  name: string;
  input: unknown;
  output: unknown;
}

export type ToolFamily = 'shell' | 'file' | 'search' | 'glob' | 'todo' | 'task' | 'web' | 'generic';

export interface ToolPresentation {
  family: ToolFamily;
  /** Chip text: the normalised tool name when short and stable, else the family name.
   *  Codex sets the name to the whole command, so it falls back to 'shell'.
   *  MCP renders 'server · tool'. Guaranteed short — never the raw name unchecked. */
  label: string;
  /** The single salient argument — command, path, pattern. Never JSON. */
  headline: string;
  /** 'path' elides in the MIDDLE so the filename survives; 'text' elides at the end. */
  headlineKind: 'path' | 'text';
  /** Collapsed-row secondary facts: '14 matches', '+12 −3', 'exit 1'. */
  badges: string[];
  body:
    | { kind: 'terminal'; command: string }
    | { kind: 'diff'; path: string; before: string; after: string }
    | { kind: 'matches'; pattern: string; scope: string | null }
    | { kind: 'paths'; pattern: string; scope: string | null }
    | { kind: 'task'; context: string; subtasks: TaskSubtask[] }
    | { kind: 'generic'; fields: { key: string; value: string }[] };
}

export interface TaskSubtask {
  name: string;
  agent: string | null;
  prompt: string;
}

export function toolPresentation(input: ToolPresentationInput): ToolPresentation;
```

Note there is **no `todo` body arm**: todo state spans calls and is folded one level up (§5.5).

**`matches` and `paths` are two arms, not one, because the two searches return different things.**
Grep returns `path:line: text`; glob returns bare file paths — and §3.5 establishes that OMP's `glob`
with a metacharacter-free `path` is a _recursive directory listing_, whose output has no line numbers
to parse. One arm would make a renderer guess which it received, and 7 of the 46 observed rows are
`glob`.

### 5.2 Resolver — four tiers, in order

No tier ever produces a JSON dump.

**Tier 1 — name match**, case-insensitive over alias sets:

| Family           | Aliases                                                            |
| ---------------- | ------------------------------------------------------------------ |
| shell            | `bash` `shell` `run` `command` `execute`                           |
| file (write)     | `edit` `write` `create` `str_replace` `apply_patch` `notebookedit` |
| file (read)      | `read` `view` `cat` `open`                                         |
| search (content) | `grep` `search` `rg`                                               |
| glob (files)     | `glob` `find` `ls` `list`                                          |

`find` and `ls` do not exist in OMP (§3.5) and are listed only as tolerant aliases for other
providers — an alias that never fires costs nothing, but a missing one falls to `generic`.
| todo | `todo` `todowrite` `plan` |
| task | `task` `agent` `subagent` `dispatch` |
| web | `webfetch` `websearch` `fetch` `browse` |

MCP (`mcp__server__tool`) → `generic`, label `server · tool`, per `tool-formatter.ts:70-76`.

**Tier 2 — duck-type on input keys.** Used when Tier 1 misses, and to pick the headline _within_ a
matched family. First hit wins:

| Signal       | Keys, in priority order                                                 |
| ------------ | ----------------------------------------------------------------------- |
| command      | `command` `cmd` `script`                                                |
| path         | `file_path` `path` `file` `filename` `notebook_path`                    |
| pattern      | `pattern` `query` `regex` `search`                                      |
| url          | `url` `uri`                                                             |
| before/after | `old_string`/`new_string`, `old_str`/`new_str`, `content`/`new_content` |

Claude's spelling is confirmed (`file_path`, `old_string`/`new_string` — §3.4) so it leads each list;
the alternates stay because other providers genuinely use them (OMP/Pi use `path`) and they cost
nothing.

**The `glob` family reads its pattern from `path`, and that is not a bug** (§3.5): `glob` has no
`pattern` field, and `strict = true` means one can never appear. So for family `glob` the `path`
signal supplies the headline, `headlineKind` is `'path'` (middle elision keeps both `packages/web/…`
and the trailing `**/*.tsx`), and the body is `paths` — never `matches`. Only the content-search
family reads `pattern`/`query`/`regex`.

**Tier 3 — name-only.** `input` absent or empty (Codex `command_execution`, §3.4): family `shell`,
headline = the name verbatim. Emoji-bearing names (`🔍 Searching: …`) pass through unchanged; they
are already human-readable.

**Tier 4 — generic.** Up to three scalar top-level entries as `key: value`, each value truncated to
80 chars. Objects and arrays collapse to `{…}` / `[n]`, never expanded inline. With no scalar entry,
the headline is the tool name alone.

### 5.3 Collapsed row — the unit of work

```
▸   ✓    [read]   console/primitives/event.ts        237 lines · 120ms
▾   ✕    [bash]   bun test node-room                   exit 1 · 2.4s
chev glyph chip    headline (flex, min-width:0)        badges (right)
```

**Status glyph `✓ ✕ ◐ –`** — chosen over coloured dots so status survives without colour; a dot
encodes state in hue alone and is lost to a colour-blind reader. Mapped from the existing
`AgentHistoryItem.outcome` via `deriveOutcome()` (`agent-history.ts:120-136`), reused unchanged.
Colour is applied _in addition to_ the glyph, never instead of it.

**Chip** — for a recognised tool, the normalised tool name (`read`, `grep`, `edit`), because that is
what the user recognises. It falls back to the family name only when the raw name is unusable, which
is exactly Codex: the name is the whole command (`npm run build && bun test --coverage`) and would
burst the chip, so the chip reads `shell` and the command becomes the headline. Precise rule: use
`name` when it is a single token of ≤24 characters, else the family name. `label` is already
resolved, so renderers never re-derive it.

**Headline elides in the MIDDLE for paths.** A tail cut (`packages/web/src/experiments/console/com…`)
loses the only identifying part; middle elision keeps both ends
(`packages/web/src/…/inspect/ConsoleAgentHistoryList.tsx`). Commands and patterns elide at the end,
where the head carries meaning. The headline element needs `min-width: 0` inside the flex row or it
will not shrink.

**Badges** are right-aligned and never wrap: duration, exit code, match count, `+n −m`, plus the
existing truncation markers (`truncated`, `output missing`, `output unknown` —
`ConsoleAgentHistoryList.tsx:165-171`), preserved as-is.

### 5.4 Expanded body

| Family  | Rendering                                                                                                                                            |
| ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| shell   | terminal block, `$ command` header, output preformatted; exit-code badge                                                                             |
| file    | diff via `react-diff-view` when before/after present (§5.6), else path + preview                                                                     |
| search  | pattern + scope, then results as a list; `path:line` lines become items                                                                              |
| glob    | the pattern (or listed directory), then output as a **flat list of file paths** — no `path:line` parsing, because there are no line numbers to parse |
| todo    | folded checklist (§5.5) — from accumulated state, not this call                                                                                      |
| task    | `context` as markdown, then one collapsible card per subtask                                                                                         |
| web     | url + title, output as markdown                                                                                                                      |
| generic | `key: value` list; output as markdown if it parses as text, else preformatted                                                                        |

Every card keeps a **"Raw" toggle** revealing the original JSON — preserving today's debugging
capability while removing it as the default. The existing `canLoadFullOutput` / `onLoadFullOutput`
flow (`ConsoleAgentHistoryList.tsx:199-208`) is preserved.

### 5.5 New module `packages/web/src/lib/todo-state.ts` — rewritten for the real op set

Todo state accumulates across calls, so it cannot be rendered from one item. This module folds the
ordered `todo` calls of one node into current state, mirroring the fold pattern already in
`pair-tool-transcript.ts`.

```ts
export type TodoStatus = 'pending' | 'in_progress' | 'completed' | 'abandoned' | 'blocked';
export interface TodoItem {
  content: string;
  status: TodoStatus;
  blocker?: string;
}
export interface TodoPhase {
  phase: string;
  items: TodoItem[];
}

export function projectTodoState(inputs: readonly unknown[]): TodoPhase[];
```

Must implement the **nine** ops of §3.5, not a two-op sketch:

| op        | Targeting                                                                      | Effect                                                   |
| --------- | ------------------------------------------------------------------------------ | -------------------------------------------------------- |
| `init`    | `list[{phase,items}]`, or flat `items` (+ optional `phase`, default `"Tasks"`) | replace everything, all `pending`                        |
| `append`  | `phase` required + non-empty `items`                                           | lazily create phase, append as `pending`                 |
| `start`   | `task` required                                                                | others `in_progress` → `pending`; this one `in_progress` |
| `done`    | `task`, or `phase`, **or neither → ALL**                                       | `completed`                                              |
| `drop`    | same as `done`, incl. bare = all                                               | `abandoned`                                              |
| `block`   | `task` or `phase` required; optional `reason`                                  | `blocked` + blocker; never reopens completed/abandoned   |
| `unblock` | `task` or `phase` required                                                     | `blocked` → `pending`, blocker cleared                   |
| `rm`      | optional `task`/`phase`; omit both → clear all                                 | delete rows                                              |
| `view`    | —                                                                              | no change                                                |

Three rules that are easy to get wrong and will show as a lying checklist:

- **Bare `done`/`drop`/`rm` are all-targeting.** Treating a missing `task` as a no-op under-reports
  wildly.
- **Auto-promotion runs after every op**: collapse multiple `in_progress` to the first, and if none
  is in progress promote the earliest `pending`. A row changes tasks it never named.
- **`op` may be absent** — infer it (`list`→`init`, `items`+`phase`→`append`) rather than discarding
  the row, and accept the legacy batch shape `{ops:[…]}`.

Unknown ops leave state unchanged. A `done` before any `init` produces no state — render nothing
rather than a fabricated list. **A phase left with zero items by `rm` is dropped, not rendered as an
empty header** — an empty heading reads as "this phase has no work", which is a different claim from
"this phase is gone"; `projectTodoState` therefore returns only non-empty phases, and an all-empty
fold returns `[]`, which renders nothing.

The renderer shows the **latest** folded state once, anchored at the _last_ todo call, with earlier
todo calls collapsed to a one-line "todo updated" row, so a near-identical checklist is not repeated.

### 5.6 Inline diff from an edit payload

When before/after are both present (Tier 2 `before/after` signal), compute a line diff and adapt it
to `react-diff-view` through the existing pure `source-control/git-hunk-adapter.ts` (58 lines). That
file must **move to `packages/web/src/lib/`** so Console can import it without crossing the
`@/components/` boundary (§3.2); Legacy's import path updates. It is pure, so the move is mechanical.

**Claude always qualifies** (`old_string`/`new_string` — §3.4). **Codex never does** (no tool input at
all), so it falls back to path + preview. Never fabricate a diff.

### 5.7 Attempt / iteration grouping

Group by `metadata.execution.occurrence_id`. When a node's transcript holds more than one occurrence,
insert a header between groups:

- retry → `Attempt {retry_epoch + 1}`
- loop → `Iteration {n}` from the **last** `loop_ancestry` entry (`{node_id, iteration}`, §3.3); the
  array is the nesting stack, innermost last.
- both → `Iteration {n} · Attempt {retry_epoch + 1}`.

**Never label a group from `attempt_id`.** One occurrence contains many attempts (§3.3), so surfacing
`attempt_id` as "Attempt" would collide with the retry meaning users expect.

A single-occurrence node renders exactly as today. Rows with no execution metadata keep the existing
`UNKNOWN_SCOPE_NOTICE` (`ConsoleAgentHistoryList.tsx:16-17`), which exists for precisely this case.

### 5.8 Changes to `agent-history.ts`

- Add `presentation: ToolPresentation` to the `tool` arm, computed in `toToolItem()`
  (`agent-history.ts:146-169`).
- Add `exitCode: number | null` to the `tool` arm — `deriveOutcome()` already reads it
  (`agent-history.ts:126`) then discards it, and the `exit 1` badge needs it.
- Add `occurrenceId`, `retryEpoch`, and `loopAncestry` to every arm for §5.7.
- Fold todo state here (§5.5) and attach the result to the **last** todo item, marking earlier ones
  superseded — `buildAgentHistory()` is the only layer that sees the whole ordered node transcript,
  so it is the only place the fold can live.
- **Delete** `TOOL_CONTEXT_KEYS`, `toolContext()`, and the `context` field on the `tool` arm;
  `presentation` supersedes them. Remove both renderers' `item.context.map(...)` blocks
  (`ConsoleAgentHistoryList.tsx:178-182` and the Legacy equivalent).

Renderers receive everything through `AgentHistoryItem` and never import `tool-presentation.ts`.

---

## 6. Track B sketch — live and interactive

**Not designed yet. This records the shape the research implies, not an agreed plan.**

State model that matches what is buildable:

| Node state                       | Surface                                                         |
| -------------------------------- | --------------------------------------------------------------- |
| running, not waiting             | live tail; read-only (stop available)                           |
| running, waiting on ask/approval | **already shipped** — Ask card on both surfaces (§3.10)         |
| running, steering supported      | input always available, queued to the next tool boundary (§4.3) |
| finished                         | full history (Track A)                                          |

Pieces, in rough dependency order:

1. **`text_kind` metadata** (§4.2) — unlocks thinking, initial prompt, and recorded interjections.
   No DB migration, but it _is_ a backend change: strict Zod schema + wire schema +
   `bun --filter @archon/web generate:types` (§4.2).
2. **OMP `--mode rpc`** (§3.8) with all three traps handled. Scope, in order: seed `sessionId` from
   `get_state` (trap 0 — without it every turn fails); negotiate protocol v2 (§11.4); send the prompt
   as a `prompt` command and **close stdin to terminate**; drop `providerPayload` on receipt.
3. **Parser fixes** — capture `role:'custom'` messages in `omp/event-parser.ts` (advisor,
   `mid-run-todo-nudge`); handle `todo_reminder` and `auto_compaction_*`; replace the
   `isFollowUpTurnEvent` allowlist with `agent_end.isTerminal`; pass `--advisor`. Fixes a real bug
   (§3.9) and makes advisor visible.
4. **Archon-owned steering seam** — send-time delivery + narrow provider port + capability flag
   (§4.3). No inbox table unless the design pass proves one is needed.
5. ~~Wire AskHuman into the web UI~~ — **already shipped, remove from scope.** Both node rooms
   answer Asks today (§3.10). This was a wrong [S] finding, corrected 2026-09-09.

**Track B has a prior contract: `_bmad-output/specs/spec-workflow-run-view-hitl/`.** Its Epics 5 and
6 built the node-centric run view and mid-turn AskHuman on both surfaces, and all 13 stories are
`done`. That SPEC calls itself the _canonical contract_ for the node room and names its UX mockups a
required companion. **The Track B design pass must start there and state what it changes**, or it
will re-specify a shipped product and contradict a live contract. This document's contribution to
Track B is the provider-side research (§3.6–§3.9) and §4.3 — not a new run-view design.

**Why the transport moves ahead of the parser.** Both land in `omp/`, and the mode switch changes
what the parser receives: unstripped `providerPayload`, a `ready` frame, and `response` frames
(§3.8). Writing the parser fixes against `--mode json` output means re-testing every one of them
after the switch. If step 3 is nonetheless taken first — it is valuable alone and unblocks advisor
without touching lifecycle — its tests must be run against **both** modes, not just the current one.

---

## 7. Non-goals

- **RunStream** `ToolCallItem.tsx` — its docblock states input and output are always visible _by
  deliberate design_; it also consumes a different type. Changing it reverses an explicit decision.
- **Chat** `ToolCallCard.tsx` — different data path, already has a usable card. §5.1 keeps future
  adoption cheap.
- **Run-level "Files changed" panel** — separate design; git routes are run-scoped (§9).
- Backend `tool-formatter.ts`; chat and Telegram output stay untouched.
- Node-level git attribution — impossible with run-scoped routes.

## 8. Testing

Pure modules get unit tests, matching `pair-tool-transcript.test.ts` and
`merge-agent-room-items.test.ts`.

`tool-presentation.test.ts`, table-driven over §5.2:

- each Tier 1 alias resolves to the right family;
- `file_path` **and** `path` both resolve; `old_string` **and** `old_str` both resolve — Claude's
  spelling is confirmed but other providers use the alternates;
- Codex shape (`{name:'npm test'}`, no input) → shell, headline `npm test`;
- emoji name passes through unchanged;
- `mcp__server__tool` → generic, `server · tool`;
- unknown tool with object input → generic `key: value`, **asserting the output contains no `{` or
  `\n  "` that would indicate a JSON dump**;
- empty/null/array input never throws;
- chip rule: short name kept verbatim; long Codex-style name falls back to family. Assert
  `label.length <= 24` **for every row**, so no future tool can burst the chip;
- `headlineKind` is `'path'` for the file **and glob** families, `'text'` for shell and content search;
- `glob` resolves to family `glob` with body `paths` and `grep` to family `search` with body
  `matches` — the split that finding 3.5 forces (glob output has no line numbers).

`todo-state.test.ts` — one case per op in §5.5, plus the three traps:

- bare `{"op":"done"}` completes **every** task in every phase; same for `drop`; bare `rm` clears all;
- auto-promotion fires after every op — assert a task the row never named changed status;
- a row with **no** `op` is inferred (`list`→`init`, `items`+`phase`→`append`), not discarded;
- legacy `{ops:[…]}` batch shape is accepted;
- `block` does not reopen a `completed` task; `unblock` only affects `blocked`;
- unknown op leaves state unchanged; `done` before any `init` renders nothing;
- `rm` that empties a phase drops the phase — assert no empty header survives, and that an
  all-empty fold returns `[]`;
- the real fixture from §3.5 reproduces the expected two phases.

Renderer tests on both surfaces (extending `NodeRoom.test.tsx`, `ConsoleNodeRoom.test.tsx`):

- successful tool call collapsed by default; failed one expanded;
- `exit 1` badge when `exitCode` is non-zero;
- multi-occurrence renders attempt headers, single-occurrence does not;
- a long path headline elides in the middle — **assert the filename is still present**;
- status is rendered as a glyph character, not colour alone — this is the §4.1 accessibility
  guarantee and is easy to regress in a restyle.

Run `bun run validate` before any PR (AGENTS.md).

## 9. Known limitations to state in the PR

- `GET /api/workflows/runs/{runId}/git/{changes,diff,log,file}` are **run-scoped**. "What did _this
  node_ change" is not answerable from git; per-tool-call diffs (§5.6) are the only node-level
  attribution, and they exist only where the provider sends before/after content.
- Track B applies to **new runs only**. Thinking, prompts, advisor and interjections were never
  persisted, so no backfill is possible.
- Advisor under Claude is gated behind an unreleased beta + feature flag + first-party API (§3.6).

## 10. Constraints

- **Track A**: no schema change, no migration, no backend change. **Track B**: additive metadata only
  — never a new `kind` value (§4.2).
- `@archon/web` must not import from `@archon/workflows`.
- Console must not import from `@/components/` (§3.2).
- Strict TypeScript, no unjustified `any`, ESLint `--max-warnings 0`.
- Zero raw `JSON.stringify` as a _default_ presentation; it stays behind the explicit Raw toggle.
- No plan references in code — no phase numbers, no finding codes (CLAUDE.md). Comments explain the
  invariant, not this document.

## 11. Open items

1. **[?]** Confirm the Claude _Agent SDK_ built-in tool schemas match the Claude Code harness schemas
   recorded in §3.4. One real Claude run settles it. Alias sets absorb any drift meanwhile.
2. Track B needs its own design pass before planning — §6 is a sketch, not a design.
3. Where the OMP RPC session registry lives, and how its teardown integrates with existing
   process-cleanup (the §4.3 hard requirement).
4. **RESOLVED — negotiate protocol v2.** [S] The deciding constraint is not payload size but
   **losslessness**: v1 shrinks _writer-side_ through seven type-blind passes (`rpc-frame.ts:29-37`)
   that truncate assistant text and tool `arguments` alike, marked only by in-band sentinels, never a
   top-level flag. **A reader cannot opt out, and dropping a field on receipt does nothing for a
   frame already over 1 MiB.** With trap 1's `partial` snapshots on the wire, crossing that ceiling
   is materially likelier than json mode ever made it, and there is no verbosity knob to turn (39
   RPC commands, subagent filter only). For a feature whose whole purpose is showing what the agent
   did, silent truncation is the wrong default — and it would surface through `omp_stream_mismatch`
   (`event-parser.ts:250-258`) under a misleading name. Cost: one frame kind (`rpc_chunk`,
   `rpc-types.ts:152-160`) plus a **~79-line decoder that lifts directly** (`RpcFrameDecoder`,
   `rpc-frame.ts:136-189` — imports only `isRecord` and a 7-field interface) and ~30 lines of
   handshake. Do `delete providerPayload` on receipt too, as orthogonal hygiene — **not** as an
   alternative to v2. Full evidence chain in the OMP scout report.
5. **RESOLVED — advisor ships OMP-only; the Claude hygiene fix ships now, separately.** [S] Not
   because Claude is unreachable — it is reachable (§3.6) — but because it is **untestable**:
   `tengu_sage_compass` is server-delivered and no operator input sets it, so a Claude path could
   only be unit-tested against a synthetic block. Build the OMP path, and key the presenter on a
   neutral "advisory" item so Claude later becomes an adapter rather than a rewrite (discriminate on
   block `type` alone; handle all three payload variants — §3.6).
   **Separately and now**, fix §3.9's silent drop: add the `else` branch logging the unknown block
   type, mirroring `claude.system_message_unhandled` (`claude/provider.ts:1269`), and replace the
   hand-rolled `ContentBlock` (`:95-101`) with the real SDK type. ~20 lines, one PR, blocked on
   neither track. **One real decision inside it:** the type fix needs `@anthropic-ai/sdk` as a
   _direct_ dependency of `@archon/providers` (today only `@anthropic-ai/claude-agent-sdk`,
   `package.json:42`; it resolves as a transitive peer, `bun.lock:294`). Small, but not free.
6. **NEW — pin the OMP version, or verify the ceilings at handshake.** The switch makes Archon depend
   on RPC frame semantics of a binary it does not pin (`binary-resolver.ts:96` takes whatever is on
   PATH). Codec files are byte-identical 17.4.0 ↔ 18.0.4, so §11.4 is stable — but `rpc-mode.ts` line
   numbers move, so **trap 0's `get_state` fix must be re-verified against the target binary.** OMP's
   own client checks the advertised `maxFrameBytes`/`maxReassembledFrameBytes` against its compiled
   constants before negotiating (`rpc-client.ts:149-157`); copying that turns version skew into a
   loud refusal instead of a corrupt read.
