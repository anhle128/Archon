# Open Every Changed File in the Shared Viewer — Ralph PRD

## Overview

Implement Source Control Story 1.3: enable an operator to open every **Now** changed file in the existing shared viewer at `/legacy/workflows/runs/:id` with bounded first paint, Load more pagination, cancellable reads, inline images, a hex peek for ordinary binaries, and streamed downloads. The implementation is partitioned into eight focused vertical slices across the git package, server routes, generated types, web API client, reusable viewer primitives, tab orchestration, and final acceptance verification so each step can be developed and proven independently in a single Ralph iteration.

## Problem

Story 1.2 provided initial file inspection for basic text and diff views, but large files, multi-megabyte diffs, images (PNG, JPEG, GIF, WEBP, SVG), and non-text binary files cannot be opened safely without exceeding memory budgets, corrupting multi-byte UTF-8 characters, bloating the DOM, or failing on Node buffer limits. Downloads buffered complete files in memory, modified non-text files attempted to render diff hunks instead of falling back to raw inspection, and accumulating content risked triggering false staleness against frozen snapshots.

## Solution

Establish a single numeric cutoff table in `@archon/git` for first paint, streaming, download-only, hex peek, binary probe, and diff context lines. Add version-bound opaque cursors distinguishing byte offsets from hunk indices. Stream downloads and tree reads without whole-file buffering. Incrementally parse unified diff hunks without whole-diff buffering, routing modified images, binaries, and oversized files to raw worktree fallback (`fileFallback: true`). Expose presentation headers and stream bodies over HTTP. Parse presentations in the web client into a discriminated `GitFileClientResult` union. Format a 4 KiB hex peek, safely render images through revoking object URLs, and virtualize diff hunks with `@tanstack/react-virtual`. Orchestrate append-only page loads, separate initial open cancellation from Load more page cancellation, and freeze reload fingerprints so page accumulation never triggers false staleness.

## Goals and success metrics

- **Bounded first paint:** Text files stop at approximately 256 KiB or 2,000 lines; diff hunks stop at approximately 256 KiB serialized JSON or 2,000 changes. The first selected hunk is never split even if oversized.
- **Opaque version-bound cursors:** Base64url JSON cursors encode axis (`o` for offset, `h` for hunk) and 64-hex version string. Invalid cursors return HTTP 400 (`Invalid file cursor`) and stale cursors return HTTP 409 (`File changed`).
- **Abortable streamed downloads:** Downloads stream from byte zero with `Content-Disposition: attachment; filename="download"` and full `Content-Length` without server buffering.
- **Incremental diff parsing:** Diff generation spawns `git diff -U3` and parses chunks into hunks on the fly, killing the subprocess immediately upon filling a page or receiving an abort signal.
- **Raw fallback for modified non-text:** Modified SVG, other images, NUL binaries, and files > 50 MiB return `fileFallback: true` with empty hunks so the viewer redirects to raw worktree inspection.
- **Safe inline images:** PNG, JPEG, GIF, WEBP, and SVG render via `<img>` and `URL.createObjectURL`; SVG markup is never injected into the DOM. Object URLs are revoked on byte change and component unmount.
- **Hex peek for ordinary binaries:** Non-image NUL binaries at or below 50 MiB render at most the first 4 KiB formatted as offset, padded hex, and printable ASCII, accompanied by a Download link.
- **Download-only for oversized files:** Any file > 50 MiB presents `This file is too large to open here.` plus Download without reading a body probe.
- **Virtualized diff rendering:** Diff hunks virtualize in independent Before and After panes via `@tanstack/react-virtual`, rendering only `.sc-virtual-hunk` items and passing the 2 MiB diff spike in < 1,000 ms.
- **Cancellable reads and Load more:** Initial Cancel closes the viewer; Load more Cancel aborts only the active page request and leaves painted content visible. Appending pages does not trigger `Changed on disk — Reload`.
- **Privacy and security:** `.env` opens as ordinary highlighted text (NFR6); logs never contain paths, file content, cursors, or sensitive messages.

## Non-goals

- Epic 2 History, commit logs, per-commit file inspection, commit OIDs, or lane graphs.
- Staging, unstaging, editing, discarding, committing, or any write operations.
- Secret redaction, denylists, or content sanitizers.
- Adding Shiki, Monaco, refractor, or alternative diff libraries.
- Database schema changes, migrations, or new environment variables.
- Modifying files under `packages/web/src/experiments/console/` or `packages/web/src/components/workflows/WorkflowExecution.tsx`.

## Locked technical context

The source plan is [2026-09-06-source-control-every-changed-file.md](../../plans/2026-09-06-source-control-every-changed-file.md).
- Plan goal and architecture: lines 6–11.
- Global security, API, UI, logging, and TDD constraints: lines 23–73.
- File structure and touched paths: lines 76–103.
- Locked cutoff constants (`VIEWER_FIRST_PAINT_BYTES = 262144`, `VIEWER_FIRST_PAINT_LINES = 2000`, `VIEWER_STREAM_BYTES = 1048576`, `VIEWER_DOWNLOAD_ONLY_BYTES = 52428800`, `VIEWER_HEX_PEEK_BYTES = 4096`, `VIEWER_BINARY_PROBE_BYTES = 8192`, `VIEWER_DIFF_CONTEXT_LINES = 3`): lines 109–117.
- Opaque cursor types and errors (`ViewerCursorAxis`, `ViewerCursorPayload`, `ViewerCursorError`): lines 121–143.
- Public git contracts (`FileAtRequest`, `FileAtResult`, `FileAtBytesResult`, `FileAtStreamResult`, `FileDiffRequest`, `FileDiffResult`, `fileAt`, `fileDiff`): lines 146–225.
- Presentation selection precedence (download > image > hex > text): lines 237–245.
- HTTP raw route headers (`X-Archon-Git-Byte-Length`, `X-Archon-Git-Truncated`, `X-Archon-Git-Cursor`, `X-Archon-Git-Presentation`, `X-Archon-Git-Media-Type`): lines 250–261.
- Web raw file client union (`GitFileClientResult`): lines 265–284.
- Web viewer states and reload fingerprints (`FileViewerState`): lines 289–334.
- Task 1 (limits, cursors, media, text pages): lines 342–516.
- Task 2 (bounded file views, abortable stream downloads): lines 519–775.
- Task 3 (streamed Now diffs, `HunkPageAccumulator`, `fileFallback`): lines 778–1036.
- Task 4 (HTTP boundary serialization, OpenAPI schemas, 409 mapping): lines 1039–1250.
- Task 5 (web API client presentation parsing, `gitFileUrl`): lines 1253–1449.
- Task 6 (hex peek formatter, `InlineImage`, `virtualized-diff.tsx`, `file-viewer.tsx`, large diff spike): lines 1452–1850.
- Task 7 (source-control-tab state mapping, append-only pages, dual Cancel semantics, stable fingerprints): lines 1853–2327.
- Task 8 (focused evidence, package suites, validation, scope audit, acceptance matrix, tracker update): lines 2330–2454.
- Out of scope & PR handoff: lines 2455–2474.

## Cross-story invariants

- **Now-only:** No client tree-ish, commit OIDs, or absolute checkout paths are accepted. Server resolves `workflow_runs.working_path` and verifies checkout confinement.
- **Git invocation:** Every git command uses an argv array via `execFileAsync`, `execFileBufferAsync`, or internal `spawn`. Shell `exec` and `oid:path` are forbidden. Tree reads use `--literal-pathspecs ls-tree -z TREE -- PATH` followed by `cat-file blob BLOB_OID`.
- **Filesystem containment:** Worktree targets are verified with bigint lstat, path containment check, opened handle descriptor check (`dev`, `ino`, `mode`, `size`, `mtimeNs`, `ctimeNs`), preventing symlink escape and TOCTOU races.
- **Presentation headers:** Successful raw file responses return quoted 64-hex ETag, `X-Archon-Git-Byte-Length`, `X-Archon-Git-Truncated`, `X-Archon-Git-Cursor`, `X-Archon-Git-Presentation`, and `X-Archon-Git-Media-Type`. CAP-6 responses omit these headers.
- **Error mapping:** Missing run returns 404, invalid path/cursor returns 400 (`Invalid file cursor`), stale cursor returns 409 (`File changed`), missing file returns 404, and post-gate errors return opaque 500.
- **Structured logging:** Pino events pair `{domain}.{action}_started` with `_completed` or `_failed`. Log objects contain only `runId` and stable `errorType`. Never log paths, content, cursors, or sensitive details.
- **UI & copy:** Terse, non-alarming copy. Never prefix with `Error:`, `unsupported`, or warning glyphs. `.env` files open as highlighted text without redaction.
- **No extra dependencies:** Use existing `react-diff-view@3.3.3`, installed `highlight.js`, and `@tanstack/react-virtual`. No new dependencies in `package.json` or `bun.lock`.

## Story overview

| Priority | ID | Story | Depends on | Outcome |
| ---: | --- | --- | --- | --- |
| 1 | US-001 | Add viewer limits, cursors, media detection, and text page boundaries | — | Pure cutoff constants, base64url version-bound cursors, media sniffer, and UTF-8 safe text page splitter. |
| 2 | US-002 | Make file views bounded and downloads abortable streams | US-001 | Bounded worktree/tree reads, abortable stream adapter, `fileAt` request/result contracts, and types exported from `@archon/git`. |
| 3 | US-003 | Parse and page Now diffs without buffering the whole diff | US-002 | Incremental unified diff parser, `HunkPageAccumulator`, streamed `fileDiff`, `fileFallback` for non-text modified files, and hunk cursors. |
| 4 | US-004 | Serialize cursors, fallbacks, and streams at the HTTP boundary | US-003 | OpenAPI `fileFallback` schema, HTTP 409 cursor mapping, raw presentation headers, streamed file responses, and regenerated types. |
| 5 | US-005 | Parse raw presentations in the web API client | US-004 | Discriminated `GitFileClientResult` union, query param encoding in `gitFileUrl`, stream body cancellation, and header validation. |
| 6 | US-006 | Render hex, images, Load more, and virtualized hunks | US-005 | 16-byte hex formatter, revoking `InlineImage`, independent virtualized Before/After diff panes, updated `FileViewer`, and 2 MiB diff spike. |
| 7 | US-007 | Append pages without losing cancellation or frozen Reload behavior | US-006 | Append-only text/diff loading in tab, dual Cancel semantics, fallback routing for `M` files, stale cursor Reload handling, and frozen fingerprints. |
| 8 | US-008 | Run acceptance gates and update the tracker | US-001, US-002, US-003, US-004, US-005, US-006, US-007 | All focused tests, package test suites, validation, scope audit, acceptance matrix, and tracker update (`1-3-open-every-changed-file: done`). |

## Ralph execution notes

Execute stories strictly in ascending priority order (US-001 to US-008). Each story begins with failing RED tests, verifies failure, implements minimal GREEN changes, verifies passing tests and type-checks, and commits cleanly. `passes` must remain `false` in `prd.json` until the corresponding story's acceptance criteria are fully met. Only US-008 is permitted to edit `_bmad-output/implementation-artifacts/archon-source-control/sprint-status.yaml`.
