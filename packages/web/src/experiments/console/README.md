# Console (spike)

A greenfield spike of Archon's web UI built around four primitives:

- **Project · Run · Workflow · Worktree**

Mounted at `/console/*`. Not part of the shipped product. Validates the mental model before any migration. If dogfooding succeeds, extract to `packages/console` and begin replacing production surfaces. If it fails, we learn cheaply.

## Routes

- `/console` → Runs view (scope = `all`)
- `/console/settings` → Settings (assistant config, system health, GitHub identity) — global
- `/console/builder` → Workflow builder (project picker + open a workflow) — global
- `/console/builder/:name` → Workflow builder editing `:name` (deep-link with `?project=<id>`)
- `/console/p/:projectId` → Runs view scoped to a project
- `/console/p/:projectId/chat` → Project-scoped agent chat
- `/console/p/:projectId/r/:runId` → Run detail

## Chat uploads

The composer's 📎 attaches files (≤5, ≤10 MB each, type-guarded client-side; the
server validates authoritatively) and sends them via the existing multipart
`sendMessage`. **Limitation:** files can't ride the _first_ message of a brand-new
conversation (`createConversation` is JSON-only) — the UI shows a notice to
re-attach once the chat exists. Drag-drop / paste / optimistic chips are tracked
in #1913.

## Chat user scoping

On multi-user installs (web auth enabled) each signed-in user gets their own
per-project conversation: the list request passes the non-enforcing `mine=true`
filter, and the first send lazily creates a conversation attributed to the
sender. Chat turns execute with the **sender's** per-user credentials and AI
prefs (the conversation creator is only a fallback when no sender identity
resolves). Solo installs see no change — without an identity, `mine=true`
narrows nothing.

## Constraints

- **Isolated.** Forbidden imports from `packages/web/src/{components,stores,contexts,routes,hooks}` and `@tanstack/react-query`, `@/lib/api` (function exports). Enforced by ESLint and `console-isolation.test.ts`. Type-only imports from `@/lib/api.generated` are allowed. The inspect graph's only sanctioned runtime `@/lib` import is `@/lib/run-graph`.
- **Skill API is the single mutation surface.** Every UI action calls one skill verb. See `skills/`.
- **Design tokens reused.** Uses the oklch semantic tokens from `packages/web/src/index.css` (`bg-surface`, `text-text-primary`, `bg-success`, `bg-warning`, `bg-error`, etc.).
- **Vocabulary.** Only _Project, Run, Workflow, Worktree_ appear in user-facing copy. No _Dashboard, Deployment, Infrastructure, Secrets, Activity, Pipeline, Stage_.

## Inspect command center

- **Log filter vs inspect selection.** `StreamToolbar` still owns the chronological Log filter (`archon.console.runNodeFilter`, default `all`, including **All nodes**). Opening a node room is a separate `InspectSelection` synchronized with `?node=` on `/console/p/:projectId/r/:runId`. Chat result cards and the workflow dock deep-link with `consoleRunHref`.
- **Agent transcripts.** `GET /api/workflows/runs/:runId/nodes/:nodeId/messages` is requested only for agent rooms and polled every 1s while the run is `running` or `paused`.
- **AskHuman.** Command Center agent rooms render structured Ask cards from GET-run `pending_interactions` at the matching tool invocation.
  Awaiting chrome uses warning tokens and `waiting on you` / `Awaiting input (n)`.
  Console still must not import production UI modules, React Query, `@/lib/api` functions, or legacy Ask React modules.
  `ChatComposer` on the chat page is not an Ask path.

## Persisted UI state (localStorage)

Client-only view preferences. All reads are try/catch-guarded and fall back to the default, so a disabled/over-quota store never breaks rendering.

| Key                             | Default   | Set by           | Purpose                                                                                |
| ------------------------------- | --------- | ---------------- | -------------------------------------------------------------------------------------- |
| `archon.console.detailView`     | `log`     | Run detail       | Active tab (`log` / `graph` / `artifacts`)                                             |
| `archon.console.showToolCalls`  | `1` (on)  | Run detail       | Tool-calls toggle in the stream                                                        |
| `archon.console.showSystem`     | `0` (off) | Run detail       | System/detail toggle in the stream                                                     |
| `archon.console.runNodeFilter`  | `all`     | Run detail       | Node filter (`all` or a nodeId); auto-resets when the node is absent from the open run |
| `archon.console.railWidth`      | —         | Project rail     | Persisted sidebar width                                                                |
| `archon.console.lastWorkflow`   | —         | Chat / dispatch  | Last-used workflow                                                                     |
| `archon.console.builderProject` | —         | Workflow builder | Selected project (`cwd`); also mirrored as `?project=`                                 |

## Status

Active experiment under `/console`. The original milestoned plan (`M1`–`M4`)
that scaffolded this surface has been completed; ongoing work is driven by
user feedback during dogfooding rather than a milestone roadmap. Issues and
ideas land via the PR template's UX Journey section.

The `builder/` subtree (Archon Studio workflow builder): PR-1 (data layer —
types, variant registry, round-trip model, validation) and PR-2 (the canvas UI)
are merged; PR-3 wires connected mode (`/console/builder[/:name]`, project
picker, load/save/rename/delete through the workflow API, dirty + nav guard,
bundled Save-as) and is in review. See `builder/README.md`.
