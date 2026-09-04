---
stepsCompleted:
  [
    'step-01-validate-prerequisites',
    'step-02-design-epics',
    'step-03-create-stories',
    'step-04-final-validation',
  ]
inputDocuments:
  - ../prds/prd-source-control/prd.md
  - ../prds/prd-source-control/architecture.md
  - ../prds/prd-source-control/addendum.md
---

# Archon Source Control Tab - Epic Breakdown

## Overview

This document provides the complete epic and story breakdown for the Archon Source Control tab, decomposing the requirements from the PRD and Architecture — plus a **standalone UX contract** (`../ux-designs/ux-Archon-2026-08-31/` DESIGN.md + EXPERIENCE.md; see UX Design Requirements) — into implementable stories.
Feature-scoped epic directory (matches `{planning_artifacts}/*epic*/*.md`): `archon/_bmad-output/planning-artifacts/epics-source-control/` holds **only** this `epics.md`. PRD, architecture, addendum, and IR remain in `prds/prd-source-control/`. Do not reuse Epic 3 — that ID is Workflow Commander in `planning-artifacts/epics.md`. This feature's durable snapshot is **Epic 4**. Implementation tracking is the project tracker `{implementation_artifacts}/sprint-status.yaml` (not a per-feature copy); story files are `{implementation_artifacts}/{{story_key}}.md`.

## Requirements Inventory

### Functional Requirements

FR1: Source Control tab on the workflow-run screen with two regions — uncommitted **Changes** above a **commit-history graph** (branch/merge lanes), scoped to the run.
FR2: Manual **Reload** control; no auto-refresh or polling.
FR3: List changed files for the selected scope (Now, and per selected commit), each labelled `M` / `A` / `D` (other git statuses project: rename→D+A, copy→A, type-change→M, unmerged→M).
FR4: Status-keyed diff viewer — `M` two-pane diff (red before / green after), `A`/`D` single-pane content; direction Now=`HEAD→worktree`, commit=`parent→commit`.
FR5: Every file opens regardless of size or type — large text streams (Load more), binary renders inline (image) or offers download/hex; nothing blocks.
FR6: Inspect any commit in history — its `M`/`A`/`D` files and content/diffs, read from the run's own branch (not base), including commits not merged to base.
FR7: Server-resolved, run-confined, read-only access — checkout root resolved server-side from `runId`; the UI never supplies the checkout root or an absolute/filesystem path (it may pass a server-returned repo-relative path the server validates); no write/commit surface.
FR8: Empty state when there is no readable git checkout (`working_path` null, directory absent at read time, not a git checkout, or a container-backend run).
FR9: Durable run-end snapshot so history/diffs survive checkout cleanup — **fast-follow, not MVP** (live checkout is primary; snapshot is the fallback).

### NonFunctional Requirements

NFR1 (Performance): fetch-on-click with explicit loading; no measurable regression to the run screen; large content streams; reads on-demand only (no polling).
NFR2 (Security): resolve the checkout root server-side from `runId` (never client-supplied; the client may pass a server-returned repo-relative path); realpath-contain live (Now) reads under `working_path`; read commit content by validating a full commit OID from `log` then `git --literal-pathspecs ls-tree -z <oid> -- <path>` (exactly one exact entry) + `git cat-file blob <blobOid>` (no `<oid>:<path>` revision syntax; pathspec magic disabled); do NOT reject `:`, leading `-`, or glob metachars in filenames (valid — FR5 opens them; rely on `--`/argv + `--literal-pathspecs`); reject NUL / absolute / encoded-`..`; `execFileAsync`/`@archon/git`, argv-safe (no shell string); strictly read-only.
NFR3 (Reliability): a vanished/missing checkout degrades to the Empty state (never a crash); existence decided at read time, not by run status; a CAP-8 snapshot-write failure must not mark the run failed.
NFR4 (Compatibility): honor Archon package boundaries — `registerOpenApiRoute` (with the raw `app.get` exception for the wildcard content route); `@archon/web` consumes OpenAPI-generated types only; no SDK leakage across boundaries.
NFR5 (Observability): server-side reads emit named structured logs (`{domain}.{action}_{state}`) and never log file contents, disallowed paths, or secrets.
NFR6 (Privacy/secrets — residual risk): v1 ships without redaction/denylist; the Viewer can surface `.env`/keys; accepted for read-only trusted internal users, recorded for revisit.
NFR7 (Accessibility): realizes the PRD Cross-Cutting **Accessibility** NFR — the diff carries `+`/`-` gutter markers as the non-color cue (WCAG 1.4.1; red/green tint secondary); `M`/`A`/`D` badges letter-carried; the Changes list, commit-graph, and viewer are keyboard-operable; WCAG-AA contrast verified (diff markers ≥ 4.5:1, commit-graph lanes ≥ 3:1 non-text); layout reflows/zooms without loss (tested 320px/400%; stack/unified specifics `[ASSUMPTION]`). UX contract: `../ux-designs/ux-Archon-2026-08-31/EXPERIENCE.md` (Accessibility Floor).

### Additional Requirements

- New read-only helpers in `@archon/git`: `changedFiles`, `fileDiff`, `fileAt` (via `git ls-tree` + `git cat-file blob`), `log` (today only boolean `hasUncommittedChanges` exists).
- New `@archon/server` read-only routes: JSON (OpenAPI) for changes list / commit log / per-commit files / diff hunks (canonical hunk schema + `cursor`/`truncated` pagination); a raw wildcard route (artifacts precedent) for file content / binary with byte/line range.
- `@archon/web` Source Control tab: two regions + status-keyed viewer, `react-diff-view` dependency, a thin tested hunk-JSON→`react-diff-view` adapter, reuse installed `highlight.js` (no Shiki), `react-resizable-panels` split, `@tanstack/react-virtual` for large content.
- D5 container gate: resolve `run.conversation_id`→`conversation.isolation_env_id`→`isolationEnvironments.getById(envId).provider`; container (any status) → Empty state; host/worktree ignores env status.
- D6 read-containment mechanism + tests (symlink escape, encoded traversal, invalid ref, unreachable OID, colon-filename success).
- CAP-8 run-end snapshot hook via `WorkflowDeps` (fast-follow): idempotent, existence-checked, temp+atomic-rename under `output_root`, non-fatal on failure.
- Spikes: (1) large diff/file performance through paged hunks + virtualization; (2) end-to-end `M`-file vertical slice to lock the hunk contract + adapter.
- Validation tasks: read-time checkout-existence check against the real host; confirm/define child-subrun env resolution for container detection.

### UX Design Requirements

A standalone UX contract now exists — `../ux-designs/ux-Archon-2026-08-31/DESIGN.md` (visual identity: inherits the Archon design system; diff red/green + `+`/`-` markers, M/A/D badges, master-detail layout) and `../ux-designs/ux-Archon-2026-08-31/EXPERIENCE.md` (IA, states, interactions, **Accessibility Floor**, key flow). It supersedes the earlier "UX inline only" note. Load-bearing UX requirements map to **NFR7 (Accessibility)** and the story ACs (Story 1.2 diff markers, Story 2.1 lane graph). Deferred UX assumptions (diff tint, split ratio, row height, graph renderer, key bindings, reflow breakpoint) are in the EXPERIENCE Open Questions — build-time decisions, not v1 blockers.

### FR Coverage Map

- **FR1** → Epic 1 (tab + Changes region, Story 1.1) **and** Epic 2 (commit-history region, Story 2.1) — the two-region layout spans both
- **FR2** → Epic 1 — manual Reload (no polling)
- **FR3** → Epic 1 (uncommitted / Now list) — extended in Epic 2 (per-commit list)
- **FR4** → Epic 1 — status-keyed viewer (M diff / A·D content); reused by Epic 2
- **FR5** → Epic 1 — every file opens (large / binary)
- **FR6** → Epic 2 — inspect any commit from the run checkout
- **FR7** → Epic 1 — server-resolved, run-confined, read-only access (D5/D6)
- **FR8** → Epic 1 — empty state + container gate
- **FR9** → Epic 4 — durable run-end snapshot (fast-follow)
- **NFR1–NFR7** → cross-cutting, realized primarily in Epic 1; Epic 2/4 inherit (NFR7 accessibility spans the diff viewer + the commit-history graph)

## Epic List

### Epic 1: Inspect a run's uncommitted changes (v1 core)

Operator opens the Source Control tab on the run screen and sees the run's uncommitted changed files (M/A/D), opening any file as a diff (M) or single-pane content (A/D), read from the run's remote checkout — resolved securely server-side, every file opens, manual Reload; a run with no readable checkout (including container-backend) shows the Empty state. This vertical slice proves the whole read pattern and security containment end-to-end.
**FRs covered:** FR1, FR2, FR3 (Now scope), FR4, FR5, FR7, FR8. **NFRs:** NFR1–NFR7.

### Epic 2: Browse commit history

Operator opens the commit-history region and inspects any commit's files (M/A/D) and their content/diffs (parent→commit), reusing Epic 1's viewer and git-read layer.
**FRs covered:** FR1 (commit-history region), FR6, FR3 (per-commit scope).

### Epic 4: Durable run history (fast-follow)

After a run's checkout is cleaned up, its history and diffs still load from a server-written run-end snapshot under `output_root`.
**FRs covered:** FR9.

## Epic 1: Inspect a run's uncommitted changes (v1 core)

Operator can see and read what a run changed but has not committed, from its remote checkout, on the run screen. Delivered as ordered vertical slices; each story is independently demonstrable and depends only on earlier stories.

### Story 1.1: See this run's uncommitted changed files

As an operator,
I want to open a Source Control tab on the run screen and see the files this run changed but hasn't committed, each marked M/A/D,
So that I can tell at a glance what the run touched — without SSH or a clone.

**Requirements:** FR1 (tab + Changes region), FR2, FR3 (Now), FR7, FR8; NFR1–NFR5, NFR7 (Changes rows keyboard-operable).

**Acceptance Criteria:**

**Given** a run whose remote checkout is a live host git checkout
**When** I open the Source Control tab
**Then** the Changes region lists the run's uncommitted paths, each badged `M`/`A`/`D`, matching the checkout's `git status`
**And** a Reload control re-fetches on demand, with no background polling.

**Given** a run with no readable checkout (`working_path` null, directory absent at read time, not a git checkout, or a container-backend run)
**When** I open the tab
**Then** it shows the Empty state, never an error.

**Given** any request for the list
**When** the server serves it
**Then** it resolves the checkout from `runId` (container gate via `conversation → isolation_env → provider` first), never from a client-supplied checkout root or absolute path.

**Given** a child/subrun that persists the same `conversationDbId` as its `conversation_id` (executor.ts:867-875)
**When** the container gate runs
**Then** a child sharing a container-backed conversation returns the Empty state before any git read, and a child under a host/worktree conversation proceeds to its own `working_path` existence/git check — the D5 FK gate applies identically to child and top-level.

**Given** the Changes list
**When** I navigate by keyboard
**Then** each file row is focusable and openable via keyboard (NFR7), in reading order, with no pointer required.

### Story 1.2: Open a modified file as a diff

As an operator,
I want to click a modified (`M`) file and see a two-pane red/green diff,
So that I can read exactly what changed.

**Requirements:** FR4 (M diff), FR3; NFR2 (read-containment), NFR4, NFR7 (diff non-color cue + contrast).

**Acceptance Criteria:**

**Given** an `M` file in the Changes list
**When** I click it
**Then** a two-pane diff opens (red = before / green = after) for `HEAD → worktree`, rendered from server-computed hunks.

**Given** the two-pane diff
**When** it renders
**Then** each changed line carries a `+`/`-` gutter marker as the non-color cue (WCAG 1.4.1) — color is never the only signal — and the marker meets ≥ 4.5:1 contrast (NFR7 / UX Accessibility Floor).

**Given** a filename containing `:`, a leading `-`, or glob metacharacters
**When** I open its diff
**Then** it opens correctly (no rejection).

**Given** a path that escapes the checkout via symlink or encoded traversal
**When** it is requested
**Then** the server refuses it (realpath-contained under `working_path`).

**Given** the diff endpoint
**When** it returns hunks
**Then** they follow the canonical hunk JSON schema (`hunks[]` with old/new start+lines and `changes`, plus `cursor`/`truncated`), and a tested pure web adapter maps them to react-diff-view's model.

**Given** a ~2 MB diff
**When** opened via paged hunks + virtualization
**Then** the viewer shows loading and never blocks the run screen, and measured render performance is recorded against a baseline. (The ~1s figure is Spike 1's decision heuristic in `architecture.md`, not a hard SLA — the PRD sets no SLA.)

### Story 1.3: Open an added or deleted file's content

As an operator,
I want to click an added (`A`) or deleted (`D`) file and read its content in a single pane,
So that I can see what was added or removed.

**Requirements:** FR4 (A/D content); NFR2.

**Acceptance Criteria:**

**Given** an `A` file
**When** I click it
**Then** its full new content renders single-pane, no diff coloring.

**Given** a `D` file
**When** I click it
**Then** the removed file's content renders single-pane, read via `git --literal-pathspecs ls-tree` + `cat-file blob` on the validated OID (no `<oid>:<path>` revision syntax).

### Story 1.4: Open large and binary files without blocking

As an operator,
I want large and binary files to still open,
So that no change is hidden from me.

**Requirements:** FR5; NFR1.

**Acceptance Criteria:**

**Given** a multi-MB text file
**When** I open it
**Then** it streams in chunks with a Load-more control and a skeleton + Cancel, and the tab never blocks the run screen.

**Given** a binary file
**When** I open it
**Then** it is not dumped as text — an image renders inline; other binaries offer download or a hex peek.

**Given** the tunable thresholds
**When** files are opened
**Then** text first-paints ~256 KB / ~2,000 lines then Load-more; files > ~1 MB stream with Cancel; files > ~50 MB offer download only; binary is detected by a NUL byte in the first 8 KB; the hex peek shows the first ~4 KB (defaults, tunable at build).

## Epic 2: Browse commit history

Operator can inspect the run branch's commits and what each one did, reusing Epic 1's viewer and git-read layer. The commit history renders as a branch/merge **lane graph** (renderer spike-selected — reuse `@xyflow/react` or a bespoke SVG; no new dep — see architecture Spike 3).

### Story 2.1: See the run's commit history

As an operator,
I want to see the commits on this run's branch,
So that I can pick one to inspect.

**Requirements:** FR1 (commit-history region — the second region of the two-region tab), FR6 (history), FR8; NFR1, NFR7 (graph keyboard-operable + lane contrast ≥ 3:1).

**Acceptance Criteria:**

**Given** a run with a live checkout
**When** I open the commit-history region
**Then** it renders the run branch's commits as a **branch/merge lane graph** (read from the run checkout, including commits not present on the base branch), one row per commit with message / author / relative time.

**Given** the checkout is unavailable
**When** I open the region
**Then** it shows the Empty state.

**Given** the Source Control tab (FR1's two-region layout)
**When** it renders
**Then** the commit-history region appears below the Changes region — together they complete FR1's two-region tab.

**Given** the run branch contains a merge commit
**When** the history renders
**Then** the graph draws the branch/merge lanes correctly (multi-parent), one row per commit — lanes computed from the `log` records' `parents[]`.

**Given** the commit-history graph
**When** I navigate by keyboard
**Then** commit rows are focusable, and I can expand/collapse a commit's files and open a file entirely by keyboard (NFR7).

**Given** the rendered lane graph
**When** it is displayed
**Then** the lane dots/lines meet ≥ 3:1 non-text contrast against the background, and no information is conveyed by lane color alone (NFR7).

> **Spike (do first — medium-risk, architecture Spike 3):** commit lane-assignment through merges + lane continuity across paged / windowed rows. Outcome must be a working topology graph — choose `@xyflow/react` reuse vs a bespoke SVG, and the windowing/pagination strategy, from the prototype (no new dep). A plain list is not an acceptable fallback (the graph is locked). Depends on the `log` record carrying `parents[]`.

### Story 2.2: Inspect a commit's files and diffs

As an operator,
I want to click any commit and see its `M`/`A`/`D` files and open their diffs/content,
So that I can see what that commit did.

**Requirements:** FR6 (inspect commit), FR3 (per-commit), FR4 (viewer reuse); NFR2.

**Acceptance Criteria:**

**Given** a commit in the history
**When** I click it
**Then** its changed files list, each badged `M`/`A`/`D`.

**Given** a file within a selected commit
**When** I open it
**Then** `M` shows a `parent → commit` diff, `A` shows new content, `D` shows removed content (validated OID + ls-tree/cat-file), reusing the Epic 1 viewer.

**Given** an invalid or unreachable commit OID, or a filename containing `:` / a leading `-` / glob metacharacters
**When** the commit content is requested
**Then** an invalid or unreachable OID is refused, and the literal filename opens correctly (validated OID + `--literal-pathspecs` ls-tree + cat-file).

## Epic 4: Durable run history (fast-follow)

A run's Source Control survives checkout cleanup via a server-written run-end snapshot.

### Story 4.1: Persist a run-end snapshot

As the system,
I want to write a durable snapshot of a run's changes and history at run end,
So that they survive checkout cleanup.

**Requirements:** FR9 (write side); NFR3.

**Acceptance Criteria:**

**Given** a run reaching a terminal state with its checkout still present
**When** the finalize hook runs
**Then** it writes a snapshot (name-status `M`/`A`/`D` + per-file diff + `A`/`D` content + `log`) under `output_root` via temp write + atomic rename.

**Given** the hook runs more than once, or the checkout is already gone
**When** it runs
**Then** it is idempotent / no-ops, and a write failure logs + emits a metric but never marks the run failed.

### Story 4.2: Load Source Control from the snapshot after cleanup

As an operator,
I want a reaped run's Source Control to still load,
So that its history isn't lost.

**Requirements:** FR9 (read fallback); NFR3.

**Acceptance Criteria:**

**Given** a run whose checkout was cleaned up but whose snapshot exists
**When** I open the tab
**Then** the changes list, commit history, and diffs load from the snapshot via the same read API.

**Given** neither a checkout nor a snapshot exists
**When** I open the tab
**Then** the Empty state shows.
