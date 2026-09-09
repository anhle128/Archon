# Readable agent transcript — design

Status: accepted (design approved 2026-09-09)
Surfaces: Legacy node room + Console node room
Phase: 1 of 2 (Phase 2 = run-level "Files changed" panel for Console, separate spec)

---

## 1. Outcome

When a user opens an agent node's detail view, the transcript reads as a legible
account of what the agent did — one scannable line per tool call, with the real
work (command, file, pattern, checklist, sub-agent fan-out) as the headline.
Raw `JSON.stringify` output never appears as the default presentation of a tool
call on either surface.

## 2. Problem

Both node rooms render every tool call as two always-open `<pre>` blocks of
pretty-printed JSON:

- Legacy: `packages/web/src/components/workflows/NodeRoom.tsx:255-264`
- Console: `packages/web/src/experiments/console/components/inspect/ConsoleAgentHistoryList.tsx:187-196`
- Both bottom out in `formatToolIo()` — `packages/web/src/lib/pair-tool-transcript.ts:75-78`:
  `if (typeof value === 'string') return value; return JSON.stringify(value, null, 2);`

Two compounding faults:

1. **`<details open>`** — input _and_ output are expanded by default, so a run
   with 40 tool calls is an unscannable wall of JSON.
2. **No semantic summary** — the only humanising step is
   `toolContext()` (`packages/web/src/lib/agent-history.ts:171-183`) driven by
   `TOOL_CONTEXT_KEYS = ['cmd', 'path', 'file_path', 'query', 'url']`
   (`agent-history.ts:50`). It misses `command` (only `cmd` is listed) and
   `pattern`, so in practice it contributes little.

## 3. Verified findings

### 3.1 The two surfaces already share a render-neutral data layer

```
workflow_node_messages (DB)
  → GET /api/workflows/runs/{runId}/nodes/{nodeId}/messages
  → lib/node-message-pages.ts        NodeMessageRow[]
  → lib/project-text-transcript.ts   (merges streamed text deltas)
  → lib/pair-tool-transcript.ts      (pairs tool call + result rows)
  → lib/agent-history.ts             buildAgentHistory() → AgentHistoryItem[]
      ├─→ Legacy  components/workflows/NodeRoom.tsx
      └─→ Console experiments/console/components/inspect/ConsoleAgentHistoryList.tsx
```

`AgentHistoryItem` is a three-arm union (`assistant` | `tool` | `lifecycle`) —
`agent-history.ts:18-48`. Both surfaces consume it as pure data.

### 3.2 The render layer is deliberately forked, and the fork is absolute

`ConsoleAgentHistoryList.tsx:1-4` docblock: _"Console-owned agent history
renderer. Uses AgentHistoryItem only as data and never imports Legacy React
components."_

Verified: Console has **zero** imports from `@/components/` across the whole
`src/experiments/console/` tree. Legacy is scheduled for deletion —
`App.tsx:93-95`: _"Classic UI, re-rooted under /legacy for the deprecation
window… Removed from the codebase once the console has proven itself."_
`App.tsx:75-76`: the console is already the default UI (`/` → `/console`).

**Consequence:** shared _logic_ goes in `lib/`; JSX is written twice, thin.
Duplicating a small amount of JSX for a surface scheduled for deletion is
cheaper and lower-risk than refactoring code that is going away.

### 3.3 Transcript payloads are typed end to end

`packages/workflows/src/schemas/node-message.ts:16-27` → wire schema
`packages/server/src/routes/schemas/workflow.schemas.ts:185-224` → frontend
`packages/web/src/lib/api.generated.d.ts:5215-5330`.

```
kind 'text'   → payload { text: string }
kind 'tool'   → payload { name: string, id: string, input?: unknown, output?: unknown }
kind 'status' → payload { state: string, detail?: string }
```

`metadata` carries `tool_phase` (call|result), `outcome`, `exit_code`,
`output_state`, `truncated`, `full_output_available`, and `metadata.execution`
(`occurrence_id`, `attempt_id`, `retry_epoch`, `loop_ancestry`,
`route_activation_seq`).

**No schema change and no migration is required for this work.** Presentation is
a pure function of data already stored, so it applies retroactively to every
historical run.

### 3.4 Tool naming differs per provider, and one run can mix providers

`.archon/workflows/defaults/superpower-feature.yaml` declares `provider: omp`
at line 8, `provider: claude` at line 31, and `provider: codex` at line 82 —
**a single run's transcript can contain all three naming conventions.**

| Provider                  | Names                                                                           | Input                          | Source                                                                       |
| ------------------------- | ------------------------------------------------------------------------------- | ------------------------------ | ---------------------------------------------------------------------------- |
| **omp** (oh-my-pi)        | lowercase: `read` `glob` `grep` `todo` `task`                                   | `path`, `pattern`, `op`/`list` | observed in DB; `session-usage.ts:670,691,710` handles `toolName === 'task'` |
| **pi**                    | lowercase, 7 built-ins: `read` `bash` `edit` `write` `grep` `find` `ls`         | `path` (not `file_path`)       | `community/pi/options-translator.ts:148`                                     |
| **claude**                | PascalCase, 24 names                                                            | **unverified — see 3.6**       | `claude/capabilities.ts:11-36`                                               |
| **codex**                 | **tool name IS the raw command string**; web search is `🔍 Searching: ${query}` | **no `input` attached**        | `codex/provider.ts:541-560`                                                  |
| opencode / copilot / grok | SDK passthrough, no declared vocabulary                                         | passthrough                    | no `knownToolNames` in their `capabilities.ts`                               |

Claude renames, `claude/capabilities.ts:43-48`: `Task`→`Agent`,
`BashOutput`→`TaskOutput`, `KillShell`→`TaskStop`, `MultiEdit`→`Edit`.

### 3.5 Real payload shapes observed in the local database

Local dev DB (`~/.archon/archon.db`), 46 `kind='tool'` rows, all from the
`superpower-feature` workflow. Name distribution: `read` 31, `glob` 7, `grep` 5,
`todo` 2, `task` 1. Input keys: `read→path`, `glob→path`, `grep→pattern,path`,
`todo→op,list` / `op,task`, `task→context,tasks`.

`todo` — **state accumulates across calls**:

```json
{"op":"init","list":[{"phase":"Research","items":["Read story 5.5 spec and brainstorm", "..."]},
                     {"phase":"Plan","items":["..."]}]}
{"op":"done","task":"Read story 5.5 spec and brainstorm"}
```

`task` — **parallel sub-agent dispatch**:

```json
{
  "context": "# Goal\n...\n# Constraints\n...\n# Contract\n...",
  "tasks": [{ "name": "ScoutConsole", "agent": "scout", "task": "# Target\n...markdown..." }]
}
```

Only ops `init` and `done` were observed. The full op vocabulary is unverified —
see §9.

### 3.6 Claude's input key names are NOT verified

Two independent research passes disagreed: one reported `Read → {path}` and
`Edit → {file, old_str, new_str}`; the other explicitly warned _"Claude input
schema undocumented — do NOT assume field names like `file_path`, `old_string`
without runtime verification."_ `node_modules` inspection is blocked by a local
hook.

**This uncertainty is load-bearing for the design.** It is the reason the
resolver duck-types over _alias sets_ rather than matching one spelling. The
design is correct whichever spelling is real; no task in this spec may hardcode a
single key name.

### 3.7 Humanisation already exists in three places (Rule of Three satisfied)

1. `packages/workflows/src/utils/tool-formatter.ts:37-84` — backend, emits a flat
   emoji string for chat/Telegram. Keyed on `'Bash'`/`'Read'` (PascalCase only).
   Consumed by `orchestrator-agent.ts:24` and `dag-executor.ts:103`.
   **Not reusable from web** — `@archon/web` must never import `@archon/workflows`
   (AGENTS.md, Package Split).
2. `lib/agent-history.ts:171` `toolContext()` — the weak version described in §2.
3. `components/chat/ToolCallCard.tsx:31` — `Object.values(tool.input)[0]`, i.e.
   the first value of the input object, arbitrarily.

Three independent implementations justifies extracting one. The new module is
frontend-only and must not attempt to share code with (1).

### 3.8 Dependencies already present

`packages/web/package.json`: `react-diff-view@3.3.3`, `highlight.js`,
`rehype-highlight`, `react-markdown`, `@tanstack/react-virtual`, `@xterm/xterm`.
**No new dependency is required.**

Reusable pure logic in the Legacy source-control tree:
`source-control/git-hunk-adapter.ts` (58 lines, pure) converts
`GitDiffChange`/`GitDiffHunk` → react-diff-view `ChangeData`/`HunkData`.

### 3.9 Execution identity is recorded but thrown away by the UI

`packages/workflows/src/transcript-execution-scope.ts:24-42` mints new
`occurrence_id`/`attempt_id` per retry and per loop iteration; `retry_epoch` is
0-indexed (`schemas/workflow-run.ts:80-84`). Rows carry this today. Neither
renderer reads it, so a retried or looping node presents every attempt as one
flat undifferentiated list.

## 4. Constraints

- No database schema change, no migration, no backend change.
- `@archon/web` must not import from `@archon/workflows` (AGENTS.md).
- Console must not import from `@/components/` (§3.2). Enforced by review.
- Strict TypeScript; no `any` without justification; ESLint `--max-warnings 0`.
- Zero raw `JSON.stringify` as a _default_ presentation. It remains available
  behind an explicit "raw" affordance (§5.4).
- No plan references in code (no "Phase 1", no finding codes) — CLAUDE.md §5.
  Comments explain the invariant, not this document.

## 5. Design

### 5.1 New module: `packages/web/src/lib/tool-presentation.ts`

Pure, React-free, provider-agnostic. Its input is structural, not tied to
`AgentHistoryItem`, so `ToolCallCard.tsx` can adopt it later without a rewrite:

```ts
export interface ToolPresentationInput {
  name: string;
  input: unknown;
  output: unknown;
}

export type ToolFamily = 'shell' | 'file' | 'search' | 'todo' | 'task' | 'web' | 'generic';

export interface ToolPresentation {
  family: ToolFamily;
  /** Verb shown in the collapsed row, e.g. "Read", "Bash", "Grep". */
  label: string;
  /** The single salient argument, e.g. the command or the file path. Never JSON. */
  headline: string;
  /** Secondary facts for the collapsed row, e.g. "14 matches", "+12 −3". */
  badges: string[];
  /** How the expanded body should render the input/output pair. */
  body:
    | { kind: 'terminal'; command: string }
    | { kind: 'diff'; path: string; before: string; after: string }
    | { kind: 'search'; pattern: string; scope: string | null }
    | { kind: 'todo' } // rendered from folded state, not this item
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

### 5.2 Resolver — four tiers, in order

A raw JSON dump is never the result of any tier.

**Tier 1 — name match.** Case-insensitive, over alias sets:

| Family      | Aliases                                                            |
| ----------- | ------------------------------------------------------------------ |
| shell       | `bash` `shell` `run` `command` `execute`                           |
| file        | `edit` `write` `create` `str_replace` `apply_patch` `notebookedit` |
| file (read) | `read` `view` `cat` `open`                                         |
| search      | `grep` `glob` `find` `search` `ls` `list`                          |
| todo        | `todo` `todowrite` `plan`                                          |
| task        | `task` `agent` `subagent` `dispatch`                               |
| web         | `webfetch` `websearch` `fetch` `browse`                            |

MCP tools (`mcp__server__tool`) resolve to `generic` with label
`server · tool`, matching the existing convention at `tool-formatter.ts:70-76`.

**Tier 2 — duck-type on input keys.** Applied when Tier 1 does not match, and
also to pick the headline _within_ a matched family. Alias sets, first hit wins:

| Signal                 | Keys (in priority order)                                                |
| ---------------------- | ----------------------------------------------------------------------- |
| command                | `command` `cmd` `script`                                                |
| path                   | `file_path` `path` `file` `filename` `notebook_path`                    |
| pattern                | `pattern` `query` `regex` `search`                                      |
| url                    | `url` `uri`                                                             |
| content (before/after) | `old_string`/`new_string`, `old_str`/`new_str`, `content`/`new_content` |

This tier is what makes §3.6 survivable: both spellings are listed, so whichever
Claude actually uses, it resolves.

**Tier 3 — name-only.** `input` absent or empty (the Codex `command_execution`
case, §3.4): family `shell`, headline = the name verbatim, no `$` prefix
synthesised beyond display. Emoji-bearing names (`🔍 Searching: …`) pass through
as the headline unchanged — they are already human-readable.

**Tier 4 — generic.** Take up to three scalar (string/number/boolean) top-level
entries; render `key: value` with each value truncated to 80 chars. Objects and
arrays are summarised as `{…}` / `[n]`, never expanded inline. If no scalar
entry exists, the headline is the tool name alone.

### 5.3 Collapsed row (the unit of work)

One line per tool call, collapsed by default. **A failed call auto-expands.**

```
▸ ✓ read    src/lib/agent-history.ts            120ms
▸ ✓ grep    "TODO" in packages/web/src      14 matches
▸ ◐ task    Review the auth flow               running
▾ ✕ bash    npm test                   exit 1 · 2.4s
      $ npm test
      FAIL  src/foo.test.ts
```

Status glyphs map from the existing `AgentHistoryItem.outcome`
(`running` | `succeeded` | `failed` | `interrupted` | `unknown`), computed by
`deriveOutcome()` (`agent-history.ts:120-136`) — reused unchanged.

### 5.4 Expanded body

| Family  | Rendering                                                                                              |
| ------- | ------------------------------------------------------------------------------------------------------ |
| shell   | terminal-styled block, `$ command` header, then output as preformatted text; exit code badge           |
| file    | diff via `react-diff-view` when before/after are both present (§5.6); otherwise path + content preview |
| search  | pattern + scope, then results as a list; lines matching `path:line` become the list items              |
| todo    | folded checklist (§5.5) — rendered from accumulated state, not this call alone                         |
| task    | `context` as markdown, then one collapsible card per subtask (`name`, `agent`, `prompt`)               |
| web     | url + title, output as markdown                                                                        |
| generic | `key: value` field list; output as markdown if it parses as text, else preformatted                    |

Every card keeps a **"Raw" toggle** revealing the original JSON. This preserves
the current capability for debugging while removing it as the default. The
existing `canLoadFullOutput` / `onLoadFullOutput` truncation flow
(`ConsoleAgentHistoryList.tsx:199-208`) is preserved as-is.

### 5.5 New module: `packages/web/src/lib/todo-state.ts`

`todo` state accumulates across calls (§3.5), so it cannot be rendered from a
single item. This module folds the ordered `todo` calls of one node into current
state — mirroring the existing fold pattern in `pair-tool-transcript.ts`:

```ts
export interface TodoItem {
  text: string;
  done: boolean;
}
export interface TodoPhase {
  phase: string;
  items: TodoItem[];
}

/** Fold ordered todo tool inputs into current checklist state. */
export function projectTodoState(inputs: readonly unknown[]): TodoPhase[];
```

Semantics:

- `op: 'init'` — replace the whole checklist from `list[]`, all items `done: false`.
- `op: 'done'` — mark the item whose text equals `task` as done. Match on exact
  string first, then trimmed equality. **An unmatched `done` is ignored, not an
  error** — the op vocabulary is not fully known (§3.5, §9).
- Any unrecognised `op` — ignored, leaving state unchanged.
- No `init` seen yet — a `done` produces no state; render nothing rather than a
  fabricated list.

The renderer shows the **latest** folded state once, anchored at the _last_ todo
call in the list, with earlier todo calls collapsed to a one-line
"todo updated" row. This avoids repeating a near-identical checklist N times.

### 5.6 Inline diff from an edit payload

When before/after strings are both present (Tier 2 `content` signal), compute a
line diff and adapt it to `react-diff-view` through the existing pure
`source-control/git-hunk-adapter.ts`. A new pure helper builds the synthetic
hunk. `git-hunk-adapter.ts` must **move to `packages/web/src/lib/`** so Console
can import it without crossing the `@/components/` boundary (§3.2); Legacy's
import path is updated. It is pure and 58 lines, so the move is mechanical.

When before/after are not both present — Codex always, possibly Claude — fall
back to path + preview. **Do not fabricate a diff.**

### 5.7 Attempt / iteration grouping

Group items by `metadata.execution.occurrence_id`. When a node's transcript
contains more than one occurrence, insert a header between groups:

- retry: `Attempt {retry_epoch + 1}`
- loop: `Iteration {n}` derived from `loop_ancestry`

A single-occurrence node renders exactly as today — no header, no visual change.
Rows with **no** execution metadata keep the existing
`UNKNOWN_SCOPE_NOTICE` warning (`ConsoleAgentHistoryList.tsx:16-17`), which
already exists for precisely this case.

### 5.8 Change to `agent-history.ts`

- Add `presentation: ToolPresentation` to the `tool` arm, computed in
  `toToolItem()` (`agent-history.ts:146-169`).
- Add `exitCode: number | null` to the `tool` arm. `deriveOutcome()` already
  reads it (`agent-history.ts:126`) but discards it; the `exit 1` badge needs it.
- Add `occurrenceId: string | null` and `retryEpoch: number | null` to every arm
  for §5.7 grouping.
- **Delete** `TOOL_CONTEXT_KEYS` and `toolContext()`, and the `context` field on
  the `tool` arm. `presentation.badges` and `presentation.headline` supersede
  them. Both renderers' `item.context.map(...)` blocks are removed
  (`ConsoleAgentHistoryList.tsx:178-182`, and the Legacy equivalent).

Renderers receive the descriptor through `AgentHistoryItem` and never import
`tool-presentation.ts` themselves.

## 6. Non-goals

- **RunStream** `experiments/console/components/ToolCallItem.tsx`. Its docblock
  states input and output are always visible _by deliberate design_: _"The Run
  Stream surface shows node tools inline and should never hide them behind a
  disclosure."_ It also consumes a different type (`InlineToolCall`). Changing it
  would reverse an explicit decision — out of scope.
- **Chat** `components/chat/ToolCallCard.tsx` — different data path
  (`ToolCallDisplay` from conversation messages) and it already has a usable
  card. §5.1 keeps future adoption cheap; adopting it now is not in scope.
- **Run-level "Files changed" panel for Console** — Phase 2, separate spec. The
  four git routes are run-scoped, so it is not a node-room feature (§8).
- Backend/`tool-formatter.ts` changes; chat and Telegram output are untouched.
- Node-level git attribution — impossible with run-scoped routes (§8).

## 7. Testing

Pure modules get unit tests, matching the convention already established by
`pair-tool-transcript.test.ts`, `agent-history` consumers, and
`merge-agent-room-items.test.ts`.

`tool-presentation.test.ts` — table-driven, one case per row of §5.2:

- each Tier 1 alias resolves to the right family;
- `path` **and** `file_path` both resolve (the §3.6 hedge, asserted explicitly);
- `old_str`/`old_string` both resolve;
- Codex shape (`{name: 'npm test'}`, no input) → shell, headline `npm test`;
- emoji name passes through unchanged;
- `mcp__server__tool` → generic with `server · tool`;
- unknown tool with object input → generic `key: value`, **asserting the result
  contains no `{` or `\n  "` that would indicate a JSON dump**;
- empty/null/array input never throws.

`todo-state.test.ts`:

- `init` then two `done` → correct ticks;
- `done` with no prior `init` → empty, no throw;
- `done` naming a non-existent item → ignored, state unchanged;
- unknown `op` → state unchanged;
- real fixture from §3.5 reproduces the expected two phases.

Renderer tests (both surfaces, extending the existing
`NodeRoom.test.tsx` and `ConsoleNodeRoom.test.tsx`):

- a successful tool call is collapsed by default;
- a failed tool call is expanded by default;
- `exit 1` badge appears when `exitCode` is non-zero;
- multi-occurrence transcript renders attempt headers; single-occurrence does not.

Run `bun run validate` before the PR (AGENTS.md).

## 8. Known limitation to state in the PR

`GET /api/workflows/runs/{runId}/git/{changes,diff,log,file}` are **run-scoped**.
There is no node-scoped git query, so "what did _this node_ change" is not
answerable from git. Per-tool-call diffs (§5.6) are the only node-level file
attribution available, and they exist only for providers that send before/after
content. Phase 2's panel is therefore run-level by necessity, not by choice.

## 9. Open questions

1. **OMP `todo` op vocabulary** — only `init` and `done` observed in 2 rows.
   If ops such as `start`/`skip`/`cancel` exist, §5.5 ignores them silently and
   the checklist under-reports progress. Mitigation: the fold ignores unknown ops
   rather than failing. Resolve by inspecting OMP's tool schema during
   implementation and extending the fold if needed.
2. **Claude input key spelling** (§3.6) — unresolved by two research passes and
   blocked from `node_modules` locally. Mitigated by alias sets, and asserted by
   the test listed in §7. Worth confirming empirically from a real Claude run's
   rows before merge.
3. **Does Claude's edit payload carry before/after content at all?** If not,
   §5.6 never fires for Claude and file cards fall back to path + preview. Does
   not block; determines how much value §5.6 delivers in practice.
4. **`glob` on OMP takes `path` but no `pattern`** in the observed rows, which
   is odd for a glob. Confirm what OMP actually sends so the search headline is
   not empty for that tool.
