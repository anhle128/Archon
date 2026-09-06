# Open a Changed File in the Shared Viewer — Ralph PRD

## Overview

Implement Source Control Story 1.2: an operator can open any **Now** changed file from the legacy run screen at `/legacy/workflows/runs/:id` in a reusable, status-keyed viewer without leaving that screen. The implementation is deliberately split across the git package, server routes, typed web clients, reusable viewer primitives, and tab orchestration so a fresh Ralph iteration can complete and verify one vertical slice at a time.

## Problem

The existing Source Control tab presents a frozen list of uncommitted changes but cannot inspect file content. Implementing inspection must preserve checkout confinement, literal git path handling, CAP-6 availability behavior, binary downloads, frozen list/viewer snapshots, and the existing legacy-screen boundary. The solution must not turn this Story 1.2 work into History, pagination, streaming, write controls, or console work.

## Solution

Add narrowly-scoped `@archon/git` reads for a live worktree file and a HEAD-to-worktree diff; expose them through a CAP-6-protected JSON diff route and a raw byte route; generate and hand-type the corresponding web clients; then compose a virtualized selectable list and a responsive, abort-safe viewer. The final iteration runs every specified automated gate and changes the source-control tracker only after all gates pass.

## Goals and success metrics

- An operator can mouse- or keyboard-open `M`, `A`, and `D` files from a Now changes list; `M` uses the diff route, `A` uses raw worktree bytes, and `D` uses raw HEAD bytes.
- Every client-supplied path is a decoded, server-issued git-relative path; traversal, absolute paths, NUL, checkout escape, shell execution, and `oid:path` reads are rejected or avoided.
- Text, binary, CAP-6, missing-file, and opaque-failure contracts exactly match the locked route contract.
- Modified views display correctly indexed Before/After hunks, independently scroll in both axes, and stack under 900 px; added/deleted text is highlighted safely and binary content only downloads.
- Changes list and selected content remain frozen until the operator explicitly accepts `Changed on disk — Reload`; cancellation, Escape, Close, and stale candidate reads cannot overwrite the current selection.
- The exact focused tests, package suites, `bun run validate`, `git diff --check`, scope review, and manual legacy-screen check pass before the tracker moves to `done`.

## Non-goals

- Story 1.3 pagination, first-paint cutoffs, Load more, streaming, the 50 MB policy, inline images, and hex peek.
- History, commit logs/lists/OIDs, a lane graph, durable snapshots, container-overlay reads, secret redaction, polling, or a sequential-run tab model.
- Persisted split sizes, database/schema changes, environment/process changes, write controls, or console imports/modifications.

## Locked technical context

The source plan is [2026-09-06-source-control-shared-viewer.md](../../plans/2026-09-06-source-control-shared-viewer.md). Its goal and package boundary are at lines 6–12; global security, API, UI, logging, dependency, and TDD constraints are at lines 22–65; the public git/HTTP contracts are at lines 99–157; task specifications are at lines 167–2300; exclusions and PR handoff are at lines 2302–2322.

- The current git process wrapper is `packages/git/src/exec.ts:67-78`; package-root exports are `packages/git/src/index.ts:1-16`. Keep the new buffer wrapper internal and publish only `fileAt`, `fileDiff`, and their types.
- `packages/server/src/routes/git/changes-handler.ts:1-80` currently embeds the run checkout lookup and CAP-6 gate. Extract that adapter without changing the existing changes response, then recheck the gate after a ready-gate I/O rejection.
- Existing git response schemas live in `packages/server/src/routes/schemas/git.schemas.ts:1-32`; use `z` from `@hono/zod-openapi`, schema-derived types, nonnegative hunk starts, and OpenAPI JSON route registration.
- `packages/server/src/routes/api.ts:535-536` imports the existing changes route and `packages/server/src/routes/api.ts:4949-4951` registers it. Register the diff beside it; register the raw wildcard route with `app.get` and its explanatory OpenAPI limitation comment.
- `packages/web/src/lib/api.ts:64-75` owns bounded non-2xx handling. Extract the shared private check without changing its 200-character behavior. Generated JSON types must come from `packages/web/src/lib/api.generated.d.ts`; the raw wildcard client remains hand-typed.
- `packages/web/src/components/workflows/source-control/source-control-panel.tsx:8-140` owns current list branches and active-index clamping. Preserve all CAP-6/loading/stale/error/clean branches while replacing only the inlined listbox.
- `packages/web/src/components/workflows/source-control/source-control-tab.tsx:13-59` owns the frozen list query/reducer boundary. Maintain its no-retry/no-polling/no-focus-refetch settings and do not alter `packages/web/src/components/workflows/WorkflowExecution.tsx`.
- Use only `react-diff-view@3.3.3` as the new direct production dependency; use installed `highlight.js` through its string API and `@tanstack/react-virtual`; use percentage strings with `react-resizable-panels` v4.
- Run RED then minimal GREEN then refactor for each story. Never run bare root `bun test`; keep all three HTTP routes in `packages/server/src/routes/api.git-changes.test.ts` and mounted viewer behavior in `packages/web/src/component-integration/source-control-tab.test.tsx` because their mock graphs are intentionally isolated.

## Cross-story invariants

- Now-only: no client tree-ish/OIDs, no `working_path`/absolute checkout input, no checkout reconstruction, no database change, no History or write UI.
- Git commands use argv through `execFileAsync`/`execFileBufferAsync`; tree reads use `--literal-pathspecs ls-tree -z TREE -- PATH` then `cat-file blob BLOB_OID`, never a shell, `exec`, or `oid:path`.
- Paths reject empty, NUL, POSIX/Windows/UNC absolute paths, and either-slash `..` segments after decoding, while colon/dash/glob/space/newline file names remain literal.
- CAP-6 on both new routes is HTTP 200 JSON `{ emptyReason: "container" | "no_checkout" }` with no ETag; missing run is 404; invalid path/source is 400; missing file is 404; post-gate errors are opaque 500 responses.
- Ready diffs are `status: "M"`, `scope: "now"`, `ref: "live"`, `cursor: ""`, `truncated: false`; cursors are opaque and sent only when non-empty.
- Pino starts pair exactly once with completed or failed; failure logs contain only `runId` and a stable `errorType`, never paths, checkout details, contents, remotes, or caught messages.
- User copy is terse and non-alarming: never render `Error:`, `unsupported`, a warning glyph, Snapshot, or a write/History control.

## Story overview

| Priority | ID | Story | Depends on | Outcome |
| ---: | --- | --- | --- | --- |
| 1 | US-001 | Confine live git paths | — | Internal parser and realpath containment are proven. |
| 2 | US-002 | Read files and Now diffs safely | US-001 | Public binary-safe git reads and literal diff hunks are available. |
| 3 | US-003 | Expose the Now diff API | US-002 | CAP-6-gated OpenAPI hunk route is available. |
| 4 | US-004 | Serve raw file bytes | US-003 | CAP-6-gated text/binary raw route is available. |
| 5 | US-005 | Add typed cancellable web clients | US-003, US-004 | Generated diff types and raw/diff clients are ready. |
| 6 | US-006 | Prepare safe diff rendering | US-005 | Exact diff dependency, hunk mapping, and XSS-safe highlighting are ready. |
| 7 | US-007 | Extract a virtualized changed-file list | — | Existing list behavior is reusable and selectable. |
| 8 | US-008 | Render the reusable file viewer | US-005, US-006 | Status-keyed text/diff/binary/CAP-6 viewer is ready. |
| 9 | US-009 | Orchestrate split, loading, and frozen snapshots | US-005, US-007, US-008 | Legacy tab opens files safely in the responsive split. |
| 10 | US-010 | Validate scope and mark the tracker | US-001, US-002, US-003, US-004, US-005, US-006, US-007, US-008, US-009 | All gates pass and only then the tracker is updated. |

## Ralph execution notes

Complete stories in ascending priority. A story must add its failing tests first, run the focused RED command, implement the smallest compliant change, run the stated GREEN commands, and leave `passes` false until its acceptance criteria actually pass. Do not commit or implement unrelated plan work in an iteration. US-010 is the sole story authorized to edit `_bmad-output/implementation-artifacts/archon-source-control/sprint-status.yaml`.
