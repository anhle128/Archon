---
title: Architecture — Archon Source Control Tab
status: decided
created: '2026-08-30'
updated: '2026-09-01'
companions:
  - prd.md
  - addendum.md
source: Decision doc from plan-architecture; distilled from the interactive Q&A in plans/architectures/archon-source-control.md. Self-contained for isolated Archon implementation (no parent-workspace files required).
---

# Architecture — Archon Source Control Tab

High-level decision doc (the _how_), paired with `prd.md` (the _what/why_) and `addendum.md` (technical depth). Not a task-by-task plan.

## Problem & goals

Archon runs execute on a remote server; the operator's browser has no repo clone. On the workflow-run screen they must answer "did this run change the files I think it did?" — inspect a run's own remote checkout (changed files M/A/D, their content, commit history) read-only, without SSH or clone. Every decision below is judged against that goal and against Archon's conventions (KISS, minimal-impact, package boundaries, `@archon/git` for git, OpenAPI-typed web).

## Approaches considered

- **A. New read-only git API + web tab (recommended).** A thin read-only git layer in `@archon/git`, server routes that resolve the run's checkout from `runId`, and a new web Source Control tab rendering diffs. Gives live inspection of the checkout and any commit; fits the existing artifact-route and `@archon/git` patterns.
- **B. Artifacts-only (rejected as primary).** Snapshot a run's changes as artifacts and have the UI read only artifacts. Reuses the existing artifact pipeline, but gives only post-hoc, run-end data — no live "what changed right now" and no arbitrary-commit browsing. Kept as the _durable-history fallback_ (CAP-8), not the primary read path.
- **C. Client-side git / embedded terminal (rejected).** Ship repo data to the browser and diff client-side, or embed a shell. Fights the no-local-repo reality, bloats the client, and widens the security surface.

## Recommended approach

Approach **A**. A new read-only git API reads the run's checkout server-side (checkout root resolved from `runId`, never client-supplied; the client passes only a server-returned repo-relative path the server validates), exposed as JSON metadata + a raw content route; a new web tab renders the two regions (Changes + commit history) and a status-keyed viewer (M diff / A·D single-pane) using `react-diff-view` plus already-installed deps. The **live checkout is the source of truth**; a **run-end durable snapshot** (fast-follow) is the fallback after cleanup. Container-backend runs are excluded (Empty state). It plugs into: `@archon/git` (new read helpers), `@archon/server` (new routes + schemas), `@archon/web` (new tab), and `@archon/workflows`/core (the fast-follow snapshot hook).

## Key decisions

- **Stack & libraries.**
  - Git-read logic lives in **`@archon/git`** as focused read-only helpers (`changedFiles`, `fileDiff`, `fileAt`, `log`) over `execFileAsync` — not inline in the server, not a new package (D1). Alternatives (server-inline, new `@archon/source-control` package) rejected for convention/YAGNI.
  - Transport: **JSON (OpenAPI-registered) for structured metadata + a raw wildcard route for file content/binary** (the `/api/artifacts/:runId/*` precedent), ranges supported (D2). All-JSON and all-raw rejected (base64 bloat / lost types).
  - Frontend diff viewer: **`react-diff-view`** (one new dep) reusing the already-installed `highlight.js` for tokenization, `react-resizable-panels` for the split, `@tanstack/react-virtual` for large content, `@tanstack/react-query` for fetching (D3). Note: react-diff-view does **not** virtualize on its own — large diffs rely on hunk pagination + react-virtual. Monaco (heavy) and `react-diff-viewer-continued` (client-side diff, needs both file sides) rejected; do **not** add Shiki.
  - **Commit-history graph (no new dep; renderer spike-selected).** Render the run branch's commits as a branch/merge **lane graph** — a graph is the **locked requirement** (not a plain list). The renderer is chosen by Spike 3 — **reuse the already-installed `@xyflow/react`** (the run screen's Graph tab stack, `WorkflowDagViewer`; layout-agnostic) **or** a bespoke SVG — **either way no new dependency**. Lane positions come from a lane-assignment over the commit `log` records (which carry `parents[]`); the long-history windowing / pagination strategy is also spike-selected. The lane algorithm + paged lane continuity are a **medium-risk spike**.
- **Data model (shape, not columns).** No new persistent entities in v1 — reads live git plus the existing `workflow_runs` row (`working_path`, `codebase_id`, `output_root`, `conversation_id`), the `conversations` row (`isolation_env_id`), and `isolation_environments` (`provider`, `status`). The fast-follow CAP-8 snapshot is a **file artifact** under `output_root` (a JSON manifest of name-status M/A/D + per-file diff + A/D content + log), not a DB table.
  - **Diff hunk contract (locked):** the diff endpoint returns a canonical JSON hunk schema `{ path, status:"M", scope, ref, hunks:[{oldStart,oldLines,newStart,newLines,header,changes:[{type,oldLine?,newLine?,content}]}], cursor, truncated }` (Zod route schema, OpenAPI-registered); a thin, tested web adapter maps it to react-diff-view's `HunkData`/`ChangeData`. The endpoint does **not** emit unified-diff text. `A`/`D` content comes from the raw content route, not this endpoint.
- **Boundaries & contracts.**
  - **Access/auth:** server resolves the checkout from `runId`; the UI never supplies the checkout root or an absolute/filesystem path (it may pass a server-returned repo-relative path the server validates against the run's tree); strictly read-only (no write/commit surface). Same visibility as the run (open admin/member; no new per-tab restriction).
  - **Read-containment (locks CAP-5, D6):** `..` rejection alone is insufficient. Live (Now) raw reads resolve+realpath the candidate and MUST verify it stays under the realpathed `working_path` (reject symlink escapes). Commit-scoped reads avoid `<oid>:<path>` revision syntax: validate a full commit **OID the server returned from `log`** (hex, reachable), then `git --literal-pathspecs ls-tree -z <oid> -- <repoRelativePath>` requiring exactly ONE exact entry, then `git cat-file blob <blobOid>` (for `D`, the parent OID's tree). `--literal-pathspecs` disables pathspec magic (`*`, `[]`, `:()`); `--` + argv handles a leading `-`. Do **not** reject `:`, leading `-`, or glob metachars — they are valid filenames FR-5 must open. Reject NUL / absolute path / encoded traversal. Tests: symlink escape, encoded traversal, invalid ref, unreachable OID all refused; colon, leading-dash, and glob-metachar filenames all open (success).
  - **Container exclusion (D5):** route container-backend runs to the Empty state **before** any git read. Signal = isolation env `provider === 'container'` (any status), resolved via existing FKs: `run.conversation_id` → `conversation.isolation_env_id` → `isolationEnvironments.getById(envId).provider` (`getById` is status-agnostic, so a destroyed container is still caught). `WorkflowRun` has no `workflow_type`/`workflow_id`, so no `findByWorkflow`/`findActiveByWorkflow`; not codebase `kind`; not a filesystem heuristic. Host/worktree provider (or a run with no resolvable env link) ignores env status and uses the directory/git existence check. Child/subruns lacking their own conversation→env link are a documented separate case (top-level detection uses the existing FK; subrun resolution settled at build).
  - **Archon rules:** `execFileAsync`/`@archon/git` (no shell-string git), `registerOpenApiRoute` (with the sanctioned raw `app.get` exception for the wildcard content route), `@archon/web` consumes OpenAPI-generated types only, no SDK leakage across package boundaries.
- **Other — CAP-8 snapshot seam (fast-follow, D4).** Written by a workflow-executor finalize hook injected through `WorkflowDeps` (CAP-8 is the justifying caller). Failure semantics locked: idempotent, existence-checked at invocation, temp-write + atomic rename under `output_root`, and a snapshot failure MUST NOT mark the run failed (log + metric). The live API falls back to the Empty state when neither checkout nor snapshot exists.

## Missing pieces (what must exist that doesn't yet)

- `@archon/git`: read-only helpers `changedFiles` / `fileDiff` / `fileAt` (via `git ls-tree` + `git cat-file blob`, not `git show <oid>:<path>`) / `log` — the `log` record **adds `parents[]`** (format includes `%H %P` alongside author / date / subject, NUL-delimited) for the branch/merge lane graph (today only boolean `hasUncommittedChanges` exists).
- `@archon/server`: new read-only routes (changes list, commit log, per-commit files, diff hunks as JSON; raw content/binary route) + Zod route schemas; the `runId` → checkout resolution, the D5 container gate (reusing `getConversationById` + `isolationEnvironments.getById` — no new query), and the D6 containment checks.
- `@archon/web`: the Source Control tab (two regions + status-keyed viewer), the **commit-history lane graph** (renderer spike-selected — `@xyflow/react` reuse or a bespoke SVG; no new dep), the hunk→react-diff-view adapter, the `react-diff-view` dependency, highlight.js wiring.
- `@archon/workflows`/core: the fast-follow run-end snapshot hook via `WorkflowDeps` (CAP-8).

## Spikes & experiments

- **Spike 1 — large diff/file performance.** Render a ~2 MB diff and a multi-MB file through paged hunks + `@tanstack/react-virtual`, ~1 day. Rule: first-paint < ~1s + smooth scroll → keep react-diff-view; else shrink page size / server pre-tokenize / reconsider Monaco for the diff pane only.
- **Spike 2 — end-to-end M-file slice.** `@archon/git` → canonical hunk JSON → web adapter → react-diff-view + highlight.js, ~1 day. Rule: contract + highlight faithful → lock the pattern for A/D + history; painful adapter → revisit the hunk schema first.
- **Spike 3 — commit-graph lane layout (medium-risk, do before Epic 2 Story 2.1).** Prototype lane/column assignment through merges from the `log` records' `parents[]`, and lane continuity across paged / windowed rows on real run history. **Outcome must be a working topology graph** — the spike selects the renderer (`@xyflow/react` reuse vs bespoke SVG) and the pagination/windowing strategy from the prototype. A plain chronological list is **not** an acceptable outcome (the graph is the locked requirement). No new dependency either way — the risk is the algorithm, not the renderer.

## Open questions

- Read-time checkout-existence check confirmed against the real remote host (never `stat`'d in planning).
- CAP-8 snapshot manifest wire format (trigger is fixed to run-end; only format open) — settled at build.
- Large-file chunk size + binary hex-peek threshold — defaults recorded in `addendum.md`; tune after Spike 1.
- Secret-redaction revisit trigger (v1 defers with recorded residual risk).
- Container detection FK is confirmed in source: `validateAndResolveIsolation` atomically writes `conversation.isolation_env_id = result.env.id` and rolls back if linking fails (`core/src/orchestrator/orchestrator.ts:152-174`), so top-level runs have the link. Requirement (not an open question): test top-level container → Empty state, and define + test child/subrun env resolution (subruns may lack their own conversation→env link).
