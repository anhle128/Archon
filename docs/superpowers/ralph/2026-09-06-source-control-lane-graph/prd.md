# Walk This Run's Commit History as a Lane Graph Ralph PRD

Source plan: `docs/superpowers/plans/2026-09-06-source-control-lane-graph.md`  
Derived slug: `2026-09-06-source-control-lane-graph`

## Overview

Implement Source Control Story 2.1: insert a keyboard-operable History region below Changes on the legacy Source Control tab at `/legacy/workflows/runs/:id` and render the run checkout's commits as a branch/merge lane graph driven by `log` records that include `parents[]`, including commits that never landed on `dev`.

The implementation is partitioned into eight focused vertical slices across the `@archon/git` package, server routes, generated types, pure lane assignment, frozen history state management, virtualized SVG lane graph widget, tab integration, and final acceptance verification so each step can be developed and proven independently in a single Ralph iteration.

Moving to or clicking a commit highlights the row only; opening that commit's files is deferred to Story 2.2 (`docs/superpowers/plans/2026-09-06-source-control-lane-graph.md:11, 24`).

## Problem

Current Source Control functionality (Stories 1.1–1.3) allows inspecting uncommitted file changes (`M`, `A`, `D`) in the worktree, but gives operators no visibility into the commit history of the workflow run's branch.

1. **Missing history context:** Operators cannot see previous commits made during workflow execution or branch development, especially commits that never merged into `dev` (`docs/superpowers/plans/2026-09-06-source-control-lane-graph.md:6, 38`).
2. **Topology blindness:** A plain chronological list without branch and merge topology fails to communicate branch points, feature merges, and parallel development lines (`docs/superpowers/plans/2026-09-06-source-control-lane-graph.md:25`).
3. **Disruptive live reloads:** Polling or background run status updates could cause layout thrashing or rewrite active commit views without operator consent (`docs/superpowers/plans/2026-09-06-source-control-lane-graph.md:42-43`).
4. **Accessibility and rendering friction:** Using heavy canvas libraries like `@xyflow/react` inside a compact 30% list pane fights standard keyboard listbox semantics (`aria-activedescendant`), scrolling, and virtualization (`docs/superpowers/plans/2026-09-06-source-control-lane-graph.md:140-146`).

## Solution

1. **Public git log read:** `@archon/git` introduces `log(workingPath)` invoking `git log --date-order --format=%H%x00%P%x00%an%x00%aI%x00%s -z --max-count=501 HEAD` through `execFileAsync` with `-C`. Parses NUL-delimited records, supports SHA-1 (40-char) and SHA-256 (64-char) object names, detects unborn/empty repositories via `isEmptyHistoryError`, and caps output to 500 commits using the 501st as a truncation sentinel (`docs/superpowers/plans/2026-09-06-source-control-lane-graph.md:88-137, 202-654`).
2. **Concealed host checkout route:** Server exposes `GET /api/workflows/runs/{runId}/git/log` with CAP-6 host confinement via `loadRunCheckout`. Missing run returns 404, container or missing checkout returns 200 with `{ emptyReason: 'container' | 'no_checkout', commits: [], revision: '', truncated: false }`, post-gate git failures return opaque 500, and paired Pino events track request lifecycle (`docs/superpowers/plans/2026-09-06-source-control-lane-graph.md:119-122, 655-1002`).
3. **Typed web client:** Regenerate OpenAPI types in `packages/web/src/lib/api.generated.d.ts` and export `getWorkflowRunGitLog(runId, options)` sending encoded `runId` only, with no `working_path` and full `AbortSignal` forwarding (`docs/superpowers/plans/2026-09-06-source-control-lane-graph.md:1003-1148`).
4. **Pure Spike 3 lane assignment:** Pure function `assignCommitLanes` in `commit-lanes.ts` computes topology rows with explicit `lane`, `incomingLanes`, `throughLanes`, `parentLanes`, and `isMerge` flags before virtualization, processing commits newest-first and maintaining reserved lane slots (`docs/superpowers/plans/2026-09-06-source-control-lane-graph.md:138-162, 1149-1443`).
5. **Frozen history snapshot state:** `gitLogSnapshotReducer` manages displayed vs pending history snapshots using the revision hash, ensuring incoming changes are held until the operator accepts `Changed on disk — Reload` (`docs/superpowers/plans/2026-09-06-source-control-lane-graph.md:1444-1668`).
6. **Virtualized SVG lane graph widget:** `CommitHistoryGraph` virtualizes rows via `@tanstack/react-virtual` with a 24px row height. Each row paints an inline SVG column (`laneCount * 12px` wide) using `stroke-text-secondary`, `strokeWidth="1.5"`, circles for ordinary commits, and diamonds for merge commits filled with `fill-text-primary`. Opacity is strictly prohibited to guarantee >= 3:1 contrast. Keyboard navigation provides `aria-activedescendant` listbox control with ArrowUp/Down, Home, End, and Enter/Space selection (`docs/superpowers/plans/2026-09-06-source-control-lane-graph.md:45-48, 1669-2174`).
7. **Two-region layout and tab integration:** `SourceControlPanel` renders Changes above History in a vertical flex column (`flex-1 min-h-0` each). History mounts `CommitHistoryGraph`, shows `No commits yet` for unborn repos, shows truncation notices when truncated, and handles whole-tab CAP-6 (where CAP-6 from either region hides History). `SourceControlTab` queries git log on mount with `staleTime: Infinity` and coordinates concurrent reload across Changes and History (`docs/superpowers/plans/2026-09-06-source-control-lane-graph.md:192-196, 2175-2853`).
8. **Verification and sprint update:** Execute targeted test suites in isolated processes, verify package suites, confirm repository formatting and validation gates, verify the 19-point acceptance matrix, and update sprint status (`docs/superpowers/plans/2026-09-06-source-control-lane-graph.md:2854-2964`).

## Goals and Success Metrics

| Goal | Success metric | Evidence source |
| --- | --- | --- |
| Two-region panel layout | Changes renders above History on live checkouts; both regions scroll independently with `flex-1 min-h-0` | Panel tests (`docs/superpowers/plans/2026-09-06-source-control-lane-graph.md:2197-2490`) |
| Strict CAP-6 confinement | CAP-6 from either Changes or History returns 200 with quiet empty state and hides History | Server tests and panel tests (`docs/superpowers/plans/2026-09-06-source-control-lane-graph.md:668-819, 2225-2285`) |
| Genuine graph topology | Lane assignment draws top-to-node convergence, vertical through-lines, and node-to-bottom parent edges | Pure lane tests and SVG snapshot tests (`docs/superpowers/plans/2026-09-06-source-control-lane-graph.md:1175-1326, 1731-1844`) |
| Full run-branch history | Commits that never merged to `dev` appear in history; parents match git `%P` | Real git repository test in `@archon/git` (`docs/superpowers/plans/2026-09-06-source-control-lane-graph.md:347-406`) |
| Bounded response cap | Output capped at 500 commits; 501st commit acts as sentinel for `truncated: true` | Unit and parser tests (`docs/superpowers/plans/2026-09-06-source-control-lane-graph.md:293-324`) |
| Keyboard-operable listbox | ArrowUp/Down, Home/End move active commit; Enter/Space select without opening files; `aria-activedescendant` is updated | Listbox unit and mounted integration tests (`docs/superpowers/plans/2026-09-06-source-control-lane-graph.md:1757-1844, 2520-2580`) |
| High-contrast non-color-only lanes | Circles for ordinary commits, diamonds for merge commits, short OID displayed; strokes exceed 3:1 contrast with zero opacity | Component tests and markup assertions (`docs/superpowers/plans/2026-09-06-source-control-lane-graph.md:45-48, 1735-1755`) |
| Frozen snapshot stability | Divergent log revisions are held in pending; displayed view only updates on operator Reload | Reducer unit tests and tab integration tests (`docs/superpowers/plans/2026-09-06-source-control-lane-graph.md:1458-1557, 2605-2676`) |
| Safe test mock isolation | All 31 existing `@archon/git` mock factories stub `log` to avoid live git fallthrough | Mock factory audit in Task 1 (`docs/superpowers/plans/2026-09-06-source-control-lane-graph.md:530-594`) |

## Non-Goals

- Opening a commit's files, listing per-commit `M`/`A`/`D`, or passing commit OIDs to `/git/diff` or `/git/file` (deferred to Story 2.2, `docs/superpowers/plans/2026-09-06-source-control-lane-graph.md:11, 24`).
- Plain chronological commit lists without lane topology (`docs/superpowers/plans/2026-09-06-source-control-lane-graph.md:25`).
- Any surface modification outside `/legacy/workflows/runs/:id` (no imports from or edits to `packages/web/src/experiments/console/`, `docs/superpowers/plans/2026-09-06-source-control-lane-graph.md:27`).
- Client-supplied checkout paths, absolute paths, or client-invented tree-ishes (`docs/superpowers/plans/2026-09-06-source-control-lane-graph.md:28`).
- Database schema changes, migrations, or new tables/columns (`docs/superpowers/plans/2026-09-06-source-control-lane-graph.md:29, 49`).
- Importing `@xyflow/react` into Source Control (`docs/superpowers/plans/2026-09-06-source-control-lane-graph.md:50, 140`).
- Git write operations (staging, unstaging, committing, discarding, branching, `docs/superpowers/plans/2026-09-06-source-control-lane-graph.md:2205-2215`).
- Adding new runtime packages or dependencies (`docs/superpowers/plans/2026-09-06-source-control-lane-graph.md:14, 49`).

## Technical Context

- **Git helper contract:** `packages/git/src/git-log.ts` exports `log(workingPath: RepoPath | WorktreePath): Promise<GitLogResult>`, `GIT_LOG_MAX_COMMITS = 500`, and types `GitLogCommit` and `GitLogResult` (`docs/superpowers/plans/2026-09-06-source-control-lane-graph.md:90-108`).
- **Git command argv:** `['-C', workingPath, '--no-optional-locks', 'log', '--date-order', '--format=%H%x00%P%x00%an%x00%aI%x00%s', '-z', '--max-count=501', 'HEAD']` executed via `execFileAsync` (`docs/superpowers/plans/2026-09-06-source-control-lane-graph.md:126-128`).
- **NUL-delimited parser:** Split stdout on `\0`, discard trailing empty record, group into 5-field tuples: `(oid, parentsRaw, authorName, authorDate, subject)`. Validate 40-char or 64-char lowercase hex object names without mixing lengths (`docs/superpowers/plans/2026-09-06-source-control-lane-graph.md:130-133`).
- **Unborn repo detection:** `isEmptyHistoryError(err)` matches `does not have any commits yet`, `unknown revision or path not in the working tree`, and `ambiguous argument 'HEAD'`. Returns `{ commits: [], revision: EMPTY_SHA256, truncated: false }` (`docs/superpowers/plans/2026-09-06-source-control-lane-graph.md:134-136`).
- **Mock module isolation:** Bun's `mock.module()` merges omitted exports from real modules; all 31 existing `@archon/git` mock factories must explicitly stub `log` (`docs/superpowers/plans/2026-09-06-source-control-lane-graph.md:51, 530-594`).
- **Server route & handler:** `GET /api/workflows/runs/{runId}/git/log` uses `loadRunCheckout` for CAP-6 gate, rechecks on ENOENT post-read, maps unexpected errors to opaque 500 (`{ error: 'Could not read git history' }`), and logs paired Pino events `git.log_started` and `git.log_completed` / `git.log_failed` (`docs/superpowers/plans/2026-09-06-source-control-lane-graph.md:655-973`).
- **Generated web types:** Re-export generated `GitLogCommit` and `GitLogResponse` from `packages/web/src/lib/api.ts` after running `bun --filter @archon/web generate:types` (`docs/superpowers/plans/2026-09-06-source-control-lane-graph.md:1003-1127`).
- **Spike 3 lane algorithm:** Pure `assignCommitLanes` algorithm in `packages/web/src/components/workflows/source-control/commit-lanes.ts` runs on the full in-memory list before virtualization, tracking active reservations and assigning lanes and edges (`docs/superpowers/plans/2026-09-06-source-control-lane-graph.md:1149-1443`).
- **Snapshot state management:** `packages/web/src/components/workflows/source-control/source-control-state.ts` implements `gitLogSnapshotReducer` alongside existing `sourceControlReducer`, freezing displayed history and capturing divergent revisions in pending (`docs/superpowers/plans/2026-09-06-source-control-lane-graph.md:1444-1668`).
- **Relative time formatting:** `formatCommitTime(iso, nowMs)` in `format-commit-time.ts` uses `Intl.RelativeTimeFormat('en', { numeric: 'auto' })` for deltas under 30 days and UTC `Intl.DateTimeFormat` for older dates (`docs/superpowers/plans/2026-09-06-source-control-lane-graph.md:188-191, 1854-1899`).
- **SVG lane graph & row:** `commit-graph-row.tsx` and `commit-history-graph.tsx` render virtualized options with `useVirtualizer` (estimate 24px, 280px initial fallback). SVG width `laneCount * 12px`, height `24px`, strokes `stroke-text-secondary`, fill `fill-text-primary`, no opacity (`docs/superpowers/plans/2026-09-06-source-control-lane-graph.md:45-48, 1900-2143`).
- **Panel & Tab integration:** `source-control-panel.tsx` renders Changes and History in flex column. `source-control-tab.tsx` queries log with `useQuery`, combines stale flags, and coordinates concurrent reload (`docs/superpowers/plans/2026-09-06-source-control-lane-graph.md:2175-2853`).
- **Testing processes:** Unit and integration tests must run in isolated processes as specified in plan lines `52-53, 2859-2871`.

## Story Overview

| Priority | ID | Title | Depends on | Outcome / Plan Anchors |
| ---: | --- | --- | --- | --- |
| 1 | US-001 | Add the public log git read | — | Read-only `log` in `@archon/git`, 501 sentinel cap, unborn repo detection, 31 mock stubs (`docs/superpowers/plans/2026-09-06-source-control-lane-graph.md:202-654`). |
| 2 | US-002 | Add GET /api/workflows/runs/{runId}/git/log route | US-001 | OpenAPI log route, CAP-6 checkout gate, post-gate error mapping, paired Pino events (`docs/superpowers/plans/2026-09-06-source-control-lane-graph.md:655-1002`). |
| 3 | US-003 | Generate web contract and add log client | US-002 | Regenerated `api.generated.d.ts`, type re-exports, typed `getWorkflowRunGitLog` client (`docs/superpowers/plans/2026-09-06-source-control-lane-graph.md:1003-1148`). |
| 4 | US-004 | Implement Spike 3 commit lane assignment | US-003 | Pure `assignCommitLanes` function mapping commit parentage to lane indices and edge vectors (`docs/superpowers/plans/2026-09-06-source-control-lane-graph.md:1149-1443`). |
| 5 | US-005 | Freeze History snapshots beside Changes | US-003 | `GitLogSnapshot` types and `gitLogSnapshotReducer` for frozen history snapshots and reload staging (`docs/superpowers/plans/2026-09-06-source-control-lane-graph.md:1444-1668`). |
| 6 | US-006 | Render virtualized History lane graph widget | US-004 | `formatCommitTime`, accessible SVG `CommitGraphRow`, virtualized `CommitHistoryGraph` listbox (`docs/superpowers/plans/2026-09-06-source-control-lane-graph.md:1669-2174`). |
| 7 | US-007 | Insert History below Changes and integrate tab queries | US-003, US-005, US-006 | Two-region panel layout, whole-tab CAP-6, tab log `useQuery`, combined stale and concurrent reload (`docs/superpowers/plans/2026-09-06-source-control-lane-graph.md:2175-2853`). |
| 8 | US-008 | Verify full acceptance gates and update sprint status | US-001, US-002, US-003, US-004, US-005, US-006, US-007 | Package suites, validation gates, acceptance matrix verification, sprint status update (`docs/superpowers/plans/2026-09-06-source-control-lane-graph.md:2854-2964`). |
