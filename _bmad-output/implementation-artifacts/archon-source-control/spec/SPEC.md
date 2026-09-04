---
id: SPEC-archon-source-control
companions:
  - brownfield.md
  - viewer-rules.md
  - architecture-diagrams.md
  - roadmap.md
  - ../../../archon/_bmad-output/project-context.md
sources:
  - ../../brainstorming/brainstorm-archon-ui-file-and-git-2026-08-28/brainstorm-intent.md
---

> **Canonical contract.** This SPEC and the files in `companions:` are the complete, preservation-validated contract for what to build, test, and validate. Source documents listed in frontmatter are for traceability only — consult them only if you need narrative rationale or prose color this contract intentionally omits.

# Archon — Source Control tab on the workflow-run screen

## Why

A pain to solve. Archon workflow runs execute on a remote server; the operator watches them in a browser that has no clone of the repo. On the workflow-run screen (today: Graph / Logs / Chat) they cannot answer the one question that matters after a run touches a repo — **"did this run change the files I think it did?"** They need to inspect the run's own remote worktree — which files changed, what the changes are, and the commit history — without cloning anything locally. The absence of a local repo is the _reason this feature exists_, not a limitation to work around; a remote-run-scoped git inspector is precisely what an embedded IDE or a generic file tree is not.

## Capabilities

- **CAP-1**
  - **intent:** On the workflow-run screen, a fourth tab (**Source Control**, beside Graph / Logs / Chat) presents, for the current run, its uncommitted **Changes** above its **commit history**, in the shape of VS Code's Source Control panel.
  - **success:** Opening a run whose worktree is available, the operator sees both regions populated for that run without leaving the screen; a run with no available worktree shows the CAP-6 empty state instead.
- **CAP-2**
  - **intent:** For the selected scope — uncommitted (Now) and per selected commit — the operator sees which files changed, each labelled `M` (modified), `A` (added), or `D` (deleted).
  - **success:** Every listed entry is a real changed path in that scope, shown as one of `M`/`A`/`D`; other git statuses project onto these (rename → `D`+`A`, copy → `A`, type-change → `M`, unmerged → `M`). (see `viewer-rules.md`)
- **CAP-3**
  - **intent:** Clicking any file in either region opens one shared viewer whose mode is keyed by status: `M` → two-pane diff (red = before, green = after); `A` → single-pane new-file content; `D` → single-pane content of the removed file, no color.
  - **success:** An `M` file shows before/after hunks; an `A` file shows full new content; a `D` file shows the removed file's content; diff direction is Now = `HEAD → worktree`, selected commit = `parent → commit`. (see `viewer-rules.md`)
- **CAP-4**
  - **intent:** The operator can select any commit in the history and see its `M`/`A`/`D` files and their contents — the run's own branch history, including commits not present on the base branch.
  - **success:** A commit on the run branch that is not yet merged into `dev` still shows its files and diffs.
- **CAP-5**
  - **intent:** Source Control inspection is strictly read-only and confined to the run being viewed — it exposes no write, commit, or path-injection surface and cannot read anything outside that run.
  - **success:** No request can read outside the run's realpathed worktree, and no write/commit code path exists. (see `brownfield.md`)
- **CAP-6**
  - **intent:** When the run has no readable host git checkout — `working_path` null, its directory absent at read time (e.g. the checkout was cleaned up), not a git checkout (e.g. a non-git folder), or a container-backend run whose host path is stale — the tab shows an explicit "no worktree / not available" empty state.
  - **success:** Such runs render the empty state and never surface an error or crash.
- **CAP-7**
  - **intent:** Any changed file can be opened regardless of size or type — large files and binaries included — without blocking the operator.
  - **success:** No file is blocked from opening; a multi-MB text file and a binary file both open or present a usable fallback. (see `viewer-rules.md`)
- **CAP-8** _(SHOULD — not v1-critical)_
  - **intent:** A run's Source Control history and diffs stay available after its worktree has been cleaned up, from a durable server-side capture; the live worktree is the primary source while it exists, the durable capture the fallback once it is gone.
  - **success:** After the worktree is reaped, Source Control history and diffs for that run still load. (see `brownfield.md`, `roadmap.md`)

## Constraints

- Read run content via `git -C working_path` against the run's own checkout, never the base `default_cwd` (which sits on `dev`); the run branch is invisible at base unless merged. (see `brownfield.md`)
- Pin every read to `run.working_path` from `GET /api/workflows/runs/{runId}` (`codebase_id` for identity); **realpath** it (runtime showed the same logical tree under two different absolute root strings — cause unconfirmed). Every run backed by a **host git checkout** (isolated worktree, in-place, or `--no-worktree` repo) is read the same way, by `working_path`; a null / missing / non-git-checkout `working_path` yields the CAP-6 empty state. **Container-backend runs are out of v1** — they render the CAP-6 empty state (host path is stale mid-run; see Non-goals). (see `brownfield.md`)
- This is a **new** read-only git API — none exists today. Model it on `GET /api/artifacts/:runId/*` + `resolveRunArtifactDir` (server-side resolution, `..` rejected). `@archon/git` today exposes only a boolean `hasUncommittedChanges`. (see `brownfield.md`)
- Security: resolve the worktree path server-side from `runId`; **never** accept `working_path` from the UI; use `execFileAsync` / `@archon/git` with server-controlled args, never a shell string. (see `brownfield.md`)
- The checkout can disappear mid-view (cleanup on conversation/PR close, scheduler merged-6h / stale-14d, manual command, codebase delete, orphan); a terminal run status does **not** imply removal. Detect a vanished checkout by directory existence at read time (missing → CAP-6), not by run status or isolation-env bookkeeping. (see `brownfield.md`)
- Post-cleanup GC: after `git branch -D` + checkout removal, unmerged run commits may become unreachable — durable history therefore requires capture-before-teardown (CAP-8). (see `brownfield.md`)
- Viewer mode, diff direction, and large/binary open-strategy are fixed by `viewer-rules.md`.
- Honor Archon package boundaries and coding rules — `execFileAsync` (no shell-string git), `registerOpenApiRoute`, the `@archon/web` OpenAPI-types import boundary, no SDK leakage outside `@archon/providers`. (see adopted `../../../archon/_bmad-output/project-context.md`)

## Non-goals

- No standalone Snapshot mode for `M` files — `M` is diff-only in v1.
- No full Explorer tree of unchanged files.
- No edit / commit / write of any kind from the UI — read-only.
- No auto-refresh or polling; refreshing is a manual **Reload**.
- No authoritative change-view reconstructed from the workflow event stream — events are provenance hints only, never the change list. (see `brownfield.md`)
- Not an embedded IDE or a generic remote file browser.
- No Source Control for **container-backend** runs in v1 — they render the CAP-6 empty state; the host `working_path` is stale mid-run, and reading the container overlay (docker exec / overlay diff walk) is a post-v1 upgrade. (see `roadmap.md`)

## Success signal

Opening the Source Control tab on a real remote run (e.g. the `speckit-no-hitl-feature` run) lists that run's changed `M`/`A`/`D` files and its commits, opens an `M` file as a red/green diff, an `A` file as single-pane content, and a `D` file as the removed file's content, all read from the run's checkout resolved server-side from `runId`; a run whose checkout has been reaped shows the empty state (or, once CAP-8 lands, still loads history and diffs from the run-end snapshot).

## Assumptions

- SPEC.md and companions are authored in English per config `document_output_language`, although the originating brainstorm ran in Vietnamese.
