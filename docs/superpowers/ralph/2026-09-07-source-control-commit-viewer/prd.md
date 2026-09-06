# Open a Commit's Files in the Same Viewer — Ralph PRD

Source plan: `docs/superpowers/plans/2026-09-07-source-control-commit-viewer.md`
Derived slug: `2026-09-07-source-control-commit-viewer`

## Overview

Implement Source Control Story 2.2: let an operator select a commit on the legacy Source Control History graph at `/legacy/workflows/runs/:id`, expand that commit's modified (`M`), added (`A`), and deleted (`D`) files inline beneath the graph row, and open those files in the existing shared `FileViewer` as `parent → commit`. The implementation is partitioned into eight vertical slices covering git object and parent resolution, commit-scoped diff parsing, server HTTP route handling, OpenAPI contract generation and web API clients, inline expand UI in History, viewer scope and opener integration, scope-safe paging and frozen reload transactions, and full acceptance verification.

## Problem

Story 1.1–1.3 introduced the Changes region and the shared viewer for uncommitted Now changes (`scope: "now"`, `ref: "live"`). Story 2.1 added the commit history lane graph below Changes, but commits are currently non-expandable indicators. Operators cannot inspect what files changed in a past commit or view the corresponding diffs or blobs in the legacy run view. Adding a separate viewer or navigating away from the run screen would fragment the UI and violate the approved single-viewer architecture. Furthermore, accessing commit files must enforce strict repository boundaries: only commits reachable from the run checkout's `HEAD` may be inspected, preventing arbitrary object exploration in shared object stores.

## Solution

1. **Reachable commit resolution & name-status listing (`@archon/git`)**:
   - Parse and validate 40-character SHA-1 or 64-character SHA-256 object names (`FULL_GIT_OBJECT_ID_RE`).
   - Validate commit type (`rev-parse --verify --quiet OID^{commit}`) and `HEAD` reachability (`merge-base --is-ancestor OID HEAD`). Reject unreachable or non-commit objects with `GitCommitRefError`.
   - Resolve parent OIDs (`rev-list --parents -n 1 OID`).
   - Parse NUL-delimited `diff-tree --name-status -z` output (`parseNameStatusZ`), projecting ordinary `M`/`A`/`D`/`T`, renames (`R` → old `D` + new `A`), and copies (`C` → new `A`).
   - Extend `changedFiles` to accept `{ commit?: string }`, computing revision as `sha256(oid + '\0' + nameStatusStdout)`.

2. **Commit-scoped diffs & raw file reads (`@archon/git`)**:
   - Extend `fileDiff` to accept `FileDiffRequest.commit`. For root commits, pass `--root`; for commits with a parent, pass `parentOid commitOid`.
   - Set `scope: "commit"` and `ref: fullOid` on `FileDiffResult`.
   - Support `fileFallback: true` for modified non-text or oversized files, falling back to reading the commit's after-side tree.
   - For raw files (`fileAt`), validate reachable commit source before reading via `ls-tree -z` and `cat-file blob`.

3. **Server transport & route validation (`@archon/server`)**:
   - Accept optional `ref` query parameter on `GET /api/workflows/runs/{runId}/git/changes` and `GET /api/workflows/runs/{runId}/git/diff`.
   - Accept `source=worktree | head | FULL_OID` on `GET /api/workflows/runs/{runId}/git/file/{path...}`.
   - Validate full object names using `isValidGitObjectId`. Return HTTP 400 (`Invalid commit ref`) for malformed, non-commit, or unreachable refs with paired Pino logs (`errorType: "invalid_ref"`).
   - Maintain CAP-6 envelope behavior (HTTP 200 with `emptyReason: "container" | "no_checkout"`).

4. **Web API clients & generated OpenAPI types (`@archon/web`)**:
   - Regenerate `packages/web/src/lib/api.generated.d.ts` from the server OpenAPI document.
   - Update `getWorkflowRunGitChanges` and `getWorkflowRunGitDiff` to accept optional `ref` and validate commit format.
   - Update `GitFileSource` to `'worktree' | 'head' | string`, validating commit hex before fetch.

5. **Inline expand History UI (`@archon/web`)**:
   - Support expanding at most one commit inline below its row in `CommitHistoryGraph` using `ChangedFilesList`.
   - Manage virtual row heights dynamically with `virtualizer.measureElement`.
   - Isolate keyboard navigation: listbox Enter/Space toggles expand; nested file list Enter/Space opens file without bubbling or collapsing the outer row.
   - Display `No file changes` for empty commits, and handle loading/error states cleanly.

6. **Shared viewer integration (`@archon/web`)**:
   - Support `ViewerScope = { kind: 'now' } | { kind: 'commit'; oid: string; parentOid: string | null }`.
   - Open commit files in the existing `FileViewer` (`M` as `parent → commit`, `A` as commit tree blob, `D` as first-parent tree blob).
   - Binary `M` fallback reads the commit tree (after side).
   - Collapsing a commit row only hides the inline list; it does not close or modify the open viewer.

7. **Scope-safe paging & frozen Reload transaction (`@archon/web`)**:
   - Paging (`onLoadMore`) preserves commit OID and opaque cursors.
   - Reload refetches Changes, History, and the expanded commit in a single transaction, holding updates behind the frozen snapshot banner until explicit operator acceptance.
   - Selecting any file in Changes restores `scope: "now"` (Return-to-Now).

8. **Acceptance gates & sprint tracking**:
   - Verify all unit and integration suites, `bun run validate`, `git diff --check`, and update `sprint-status.yaml`.

## Goals and Success Metrics

- **Inline expand:** Clicking a commit expands its file list inline beneath the graph row without opening the viewer. At most one commit is expanded at a time.
- **Shared viewer reuse:** Commit files open in the same `FileViewer` widget. `M` displays diff against first parent (or `--root` for root commit); `A` displays commit blob; `D` displays first-parent blob; binary `M` fallback displays commit blob.
- **Reachability enforcement:** Only commit objects reachable from the checkout's `HEAD` can be read; missing objects, non-commits, or unreachable commits return HTTP 400 (`Invalid commit ref`).
- **Return to Now:** Opening a file in Changes resets viewer scope to Now. Collapsing an expanded commit does not alter the open viewer.
- **Scope-safe paging:** `onLoadMore` for commit files preserves commit scope and OID.
- **Frozen reload:** Reload fetches Now, History, and expanded commit snapshots together and freezes them until operator acceptance.
- **Keyboard isolation:** Arrow keys and Enter/Space inside nested `Commit files` do not bubble or trigger parent row collapse/navigation.
- **Zero new dependencies:** Reuses existing `react-diff-view`, `@tanstack/react-virtual`, and Hono/OpenAPI libraries.

## Non-Goals

- CAP-8 snapshot writing.
- Container overlay reads or "history is immutable" bypasses for containers.
- Secret redaction or content sanitization.
- Adding a second viewer pane or alternative diff libraries (Shiki, Monaco).
- Modifying `packages/web/src/experiments/console/` or `WorkflowExecution.tsx`.
- Write/stage/commit/revert operations.
- Multiple simultaneous expanded commits.
- Back button navigation.

## Technical Context

The implementation plan is located at `docs/superpowers/plans/2026-09-07-source-control-commit-viewer.md`.
- Locked contracts and schemas: lines 122–274.
- Required implementation order: lines 276–283.
- Resolved implementation choices and provisional defaults: lines 284–310.
- Task 1: Commit object-name parsing and commit `changedFiles`: lines 312–773.
  - `packages/git/src/git-oid.ts`
  - `packages/git/src/git-oid.test.ts`
  - `packages/git/src/changed-files.ts`
  - `packages/git/src/changed-files.test.ts`
  - `packages/git/src/index.ts`
- Task 2: Commit-scoped `fileDiff`: lines 774–1144.
  - `packages/git/src/file-read.ts`
  - `packages/git/src/file-read.test.ts`
- Task 3: HTTP `ref` and commit file source: lines 1145–1462.
  - `packages/server/src/routes/git/path-input.ts`
  - `packages/server/src/routes/git/changes-route.ts`
  - `packages/server/src/routes/git/changes-handler.ts`
  - `packages/server/src/routes/git/diff-route.ts`
  - `packages/server/src/routes/git/diff-handler.ts`
  - `packages/server/src/routes/git/file-handler.ts`
  - `packages/server/src/routes/api.ts`
  - `packages/server/src/routes/api.git-changes.test.ts`
- Task 4: Web git clients and generated types: lines 1463–1642.
  - `packages/web/src/lib/api.generated.d.ts`
  - `packages/web/src/lib/api.ts`
  - `packages/web/src/lib/api.git-changes.test.ts`
- Task 5: Inline commit file list in History: lines 1643–1942.
  - `packages/web/src/components/workflows/source-control/commit-graph-row.tsx`
  - `packages/web/src/components/workflows/source-control/commit-history-graph.tsx`
  - `packages/web/src/components/workflows/source-control/commit-history-graph.test.tsx`
  - `packages/web/src/components/workflows/source-control/source-control-panel.tsx`
  - `packages/web/src/components/workflows/source-control/source-control-panel.test.tsx`
- Task 6: Load commit files into the shared viewer: lines 1943–2378.
  - `packages/web/src/components/workflows/source-control/source-control-tab.tsx`
  - `packages/web/src/component-integration/source-control-tab.test.tsx`
- Task 7: Scope-safe paging, Reload freeze, and keyboard isolation: lines 2379–2745.
  - `packages/web/src/components/workflows/source-control/source-control-tab.tsx`
  - `packages/web/src/component-integration/source-control-tab.test.tsx`
- Task 8: Acceptance gates and sprint status: lines 2746–2871.
  - `_bmad-output/implementation-artifacts/archon-source-control/sprint-status.yaml`

## Cross-Story Invariants

- **Git Invocation**: Always use argv arrays with `execFileAsync` or `streamGitStdout`. Never use shell interpolation, `exec`, or `oid:path` syntax.
- **Path Validation**: Must reject empty, NUL, POSIX absolute, Windows UNC/drive, encoded `..`, and `.git` segments.
- **Special Filenames**: Files containing colons, leading dashes, spaces, newlines, and glob metacharacters must be handled safely.
- **Reachability Gating**: Existence in the object store is insufficient; commits must be ancestors of `HEAD` via `merge-base --is-ancestor OID HEAD`.
- **CAP-6 Parity**: Container and no-checkout runs return HTTP 200 `{ emptyReason: "container" | "no_checkout" }` across all git endpoints without exception.
- **No Console Contamination**: Do not import or modify any file in `packages/web/src/experiments/console/` or `WorkflowExecution.tsx`.
- **Logging Safety**: Pino events follow `domain.action_state`. Never log checkout paths, remotes, file contents, file paths, object names, or path-bearing error messages. Failures record only `runId` and stable `errorType`.
- **UI Copy**: Terse and non-alarming. Do not introduce `Error:`, `unsupported`, or warning glyphs. Empty commit files show `No file changes`.

## Story Overview

| Priority | ID | Title | Depends On | Outcome |
| :--- | :--- | :--- | :--- | :--- |
| 1 | US-001 | Commit object-name parsing and commit `changedFiles` | - | `parseGitObjectId`, `resolveCommitParents`, `parseNameStatusZ`, and `changedFiles(path, { commit })` with reachable ancestor validation. |
| 2 | US-002 | Commit-scoped `fileDiff` | US-001 | Commit-scoped `fileDiff` comparing first parent (or `--root`) to commit, `scope: "commit"`, `ref: fullOid`, binary fallback, and `fileAt` reachability check. |
| 3 | US-003 | HTTP `ref` and commit file source | US-002 | Server routes accepting optional `ref` for changes/diff and `source=FULL_OID` for file, with HTTP 400 mapping for invalid/unreachable refs. |
| 4 | US-004 | Web git clients and generated types | US-003 | Regenerated `api.generated.d.ts`, typed `getWorkflowRunGitChanges`, `getWorkflowRunGitDiff`, and `GitFileSource` client validation. |
| 5 | US-005 | Inline commit file list in History | US-004 | Expandable commit rows in `CommitHistoryGraph`, dynamic virtual row height measurement, `ChangedFilesList` integration, and keyboard event isolation. |
| 6 | US-006 | Load commit files into the shared viewer | US-005 | `ViewerScope` state in `SourceControlTab`, opening commit `M`/`A`/`D` and fallback binary files in `FileViewer`, preserving open view on collapse. |
| 7 | US-007 | Scope-safe paging, Reload freeze, and keyboard isolation | US-006 | Scope-preserving `onLoadMore`, atomic 3-snapshot Reload transaction, Return-to-Now upon Changes file click, and stale cursor handling. |
| 8 | US-008 | Acceptance gates and sprint status | US-001, US-002, US-003, US-004, US-005, US-006, US-007 | Passing focused and package test suites, `bun run validate`, `git diff --check`, and sprint status update for Story 2.2 and Epic 2. |
