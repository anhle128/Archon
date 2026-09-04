# Epic 1 Context: Inspect a run's uncommitted changes (v1 core)

<!-- Generated from planning artifacts. Regenerate with compile-epic-context if planning docs change. -->

## Goal

Give an operator, from the existing workflow-run screen, a way to see and read what a run changed but has not yet committed — without SSH or a local clone. Opening a new Source Control tab lists the run's uncommitted files badged `M`/`A`/`D`, and clicking one opens a status-keyed viewer: a two-pane diff for modified files, single-pane content for added/deleted files. Every file must open regardless of size or type, and a run with no readable checkout (missing, cleaned up, or container-backed) degrades to a clear Empty state instead of an error. This is the vertical slice that proves the whole read pattern and security containment end-to-end — commit history (Epic 2) and durable snapshots (Epic 4) build on what this epic establishes.

## Stories

- Story 1.1: See this run's uncommitted changed files
- Story 1.2: Open a modified file as a diff
- Story 1.3: Open an added or deleted file's content
- Story 1.4: Open large and binary files without blocking

## Requirements & Constraints

- The tab shows a Changes region (uncommitted "Now" scope) for the viewed run; refresh is manual only — a Reload control re-fetches on demand, no auto-refresh or background polling ever occurs.
- Every listed file carries exactly one status letter: `M` modified, `A` added, `D` deleted. Other git statuses project onto these: rename → `D`(old path)+`A`(new path), copy → `A`, type-change → `M`, unmerged → `M`; untracked-new files also fold to `A`.
- Viewer is status-keyed: `M` renders a two-pane diff (red=before/green=after, direction `HEAD→worktree`); `A`/`D` render single-pane content with no diff coloring. `M` has no standalone snapshot mode — diff-only.
- Every file must open — large text streams in chunks with a Load-more control (never refused); binary files are never dumped as text (images render inline, other binaries offer download or a hex peek); opening shows immediate skeleton/metadata feedback and can be cancelled.
- Access is strictly read-only with no write/commit surface anywhere. The checkout root is resolved server-side from `runId`; the client never supplies the checkout root or an absolute path — only a server-returned repo-relative path, which the server realpath-validates against the checkout and rejects for `..`, NUL bytes, or encoded traversal. Filenames containing `:`, a leading `-`, or glob metacharacters must still open successfully.
- A run with no readable checkout (`working_path` null, directory absent at read time, not a git checkout, or a container-backend run) shows the Empty state, never an error — presence is decided by directory existence at read time, never by run status. Container-backed runs are routed to the Empty state before any git read; the same gate applies identically to a child/subrun sharing a container-backed conversation.
- No measurable regression to the run screen's responsiveness is acceptable; reads are on-demand/fetch-on-click only.
- The diff view must not rely on color alone: every changed line carries a `+`/`-` gutter marker meeting ≥4.5:1 contrast as the primary accessible cue; `M`/`A`/`D` badges are letter-carried, never color-only; the Changes list and viewer must be fully keyboard-operable in reading order.
- Server-side reads emit structured logs (`{domain}.{action}_{state}`) and never log file contents, disallowed paths, or secrets. v1 ships without secret redaction/denylist — accepted residual risk given read-only access limited to trusted internal users who can already view the run.

## Technical Decisions

- New read-only helpers land in `@archon/git`: `changedFiles`, `fileDiff`, `fileAt` (via `ls-tree` + `cat-file blob`, never `git show <oid>:<path>`) — over `execFileAsync`, argv-safe, no shell strings.
- New `@archon/server` routes: OpenAPI-registered JSON for the changes list and diff hunks (canonical schema `{ path, status, scope, ref, hunks[], cursor, truncated }` — no unified-diff text), plus a raw wildcard route (the existing artifacts-route pattern) for file content/binary with byte/line range; `A`/`D` content is served only by the raw route, never the hunk endpoint.
- Read-containment: live ("Now") reads resolve+realpath the candidate path and must verify it stays under the realpathed `working_path`; commit-scoped content reads validate a full OID before `ls-tree`/`cat-file` (no `<oid>:<path>` syntax) — `--literal-pathspecs` plus `--`/argv handles metacharacter and leading-dash filenames without a reject.
- Container gate: resolved via the existing FK chain `run.conversation_id → conversation.isolation_env_id → isolationEnvironments.getById(envId).provider` (status-agnostic — a destroyed container still gates); host/worktree providers ignore env status and use directory/git existence instead.
- Frontend: `react-diff-view` is the one new dependency; reuse already-installed `highlight.js` (no Shiki), `react-resizable-panels` for the master-detail split, `@tanstack/react-virtual` for large content, `@tanstack/react-query` for fetching. A thin, tested adapter maps the hunk JSON to react-diff-view's model.
- No new persistent DB entities — reads live git plus the existing `workflow_runs` (`working_path`, `codebase_id`), `conversations` (`isolation_env_id`), and `isolation_environments` (`provider`, `status`) rows.
- Tunable defaults: text first-paints ~256KB/~2,000 lines then Load-more; files >~1MB stream with Cancel; files >~50MB offer download only; binary detected by a NUL byte in the first 8KB; hex peek shows the first ~4KB.
- Spike gate: prove a ~2MB diff and a multi-MB file render via paged hunks + virtualization with first-paint <~1s and smooth scroll before locking the react-diff-view pattern for the rest of the tab.

## UX & Interaction Patterns

- Master-detail, two columns: left "Source Control" panel with the Changes region on top; right pane is the shared viewer (file breadcrumb + content/diff). Split is user-resizable.
- Changes row: filename + dimmed directory path + right-aligned M/A/D badge; no stage/unstage/discard/commit affordances anywhere — clicking a row is the only action.
- Empty state fully replaces the panel with a title + one-sentence body, terse and non-alarming (never "Error:"). Two distinct copies: container-backed run gets no Reload CTA (files aren't on the host — reload can't help); no-readable-checkout gets a Reload CTA (may be transient, e.g. checkout not ready yet).
- Loading: file list and sizes render immediately from metadata; the viewer itself paints a skeleton with a Cancel affordance while bytes stream in.
- Focus management: never steal focus on first paint or an unconditional Empty-state render; move focus only when a re-render removes the element the user currently has focused; announce updates via a `role="status"` live region with concise metadata only (never diff body text).

## Cross-Story Dependencies

- Story 1.1 (Changes list, tab shell, container gate, Empty state) is the foundation; Stories 1.2 and 1.3 both depend on its file list and shared Viewer component to have somewhere to render into.
- Story 1.4 (large/binary handling) extends the Viewer opened by 1.2 (diff) and 1.3 (single-pane content), so it depends on both being in place first.
- Epic 2 (commit history) reuses this epic's Viewer and git-read layer for per-commit reads — keep both status-keyed and scope-agnostic (Now vs. commit) rather than Now-specific.
- Epic 4's durable snapshot is a fallback behind the same read API this epic defines; no blocking dependency in this direction, but the live API's Empty-state behavior must stay consistent with what Epic 4 will layer in later.
