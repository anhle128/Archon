# Open Every Changed File Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.
> Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an operator open every Now changed file in the existing shared viewer, with first-paint chunking, Load more, Cancel, inline images, and hex-plus-download for other binaries, so large text and binaries never block inspection or dump as garbage.

**Architecture:** `@archon/git` keeps the only git I/O and applies the single build-tunable cutoff table from `viewer-rules.md`.
The server stays a thin CAP-6 gate plus serializer: JSON hunk pages keep `registerOpenApiRoute`, and the existing raw wildcard file route gains opaque `cursor` / `download=1` query params plus presentation headers.
The web trusts those headers, appends opaque cursors, virtualizes accumulated hunks, and never imports `@archon/git` or `packages/web/src/experiments/console/`.

**Tech Stack:** Bun 1.3, strict TypeScript, Node `execFile` / `spawn` argv arrays, Hono OpenAPI, Zod from `@hono/zod-openapi`, React 19, TanStack Query 5, installed `@tanstack/react-virtual` 3, installed `highlight.js` 11, existing `react-diff-view@3.3.3`, and Bun tests.

**Spec:** `_bmad-output/planning-artifacts/epics-source-control/epics.md`, Story 1.3.

**Canonical design:** `_bmad-output/specs/spec-archon-source-control/SPEC.md` CAP-7, `_bmad-output/specs/spec-archon-source-control/viewer-rules.md`, and `_bmad-output/planning-artifacts/architecture/architecture-Archon-source-control-2026-09-05/ARCHITECTURE-SPINE.md` AD-3, AD-4, and AD-5.

**Companion decisions:** `_bmad-output/specs/spec-archon-source-control/brownfield.md` and `_bmad-output/planning-artifacts/epics-source-control/implementation-readiness-report-2026-09-06.md`.

**Issue:** GitHub issue #77, tracker key `1-3-open-every-changed-file`.

**Depends on:** Story 1.2 is already `done` in `_bmad-output/implementation-artifacts/archon-source-control/sprint-status.yaml`.

## Global Constraints

- Story 1.3 is Now-only and must not add History, log records, commit lists, client-supplied tree-ish values, or commit OIDs to HTTP.
- Story 1.2 already shipped the shared viewer, 30/70 split, Cancel on first open, opaque diff `cursor` query, NUL-as-binary, and download-only binary fallback.
- This story owns hunk pagination, Load more, the 256 KB or 2,000-line first-paint cutoff, the ~1 MB "do not fetch the whole file in one viewer GET" rule, download-only above about 50 MB, inline images, and hex peek.
- All numeric thresholds live in one module and must match `viewer-rules.md`.
- Do not invent a parallel cutoff table in `@archon/web`.
- The surface remains `/legacy/workflows/runs/:id`, and no file under `packages/web/src/experiments/console/` may be imported or modified.
- The client sends only `runId`, the server-issued git-relative path, `source=worktree|head`, the fixed Now selector, an opaque cursor when one is non-empty, and optional `download=1`.
- The server loads the existing `workflow_runs.working_path`, and it never accepts `working_path` or an absolute checkout path from the client.
- The server must not reconstruct the checkout from isolation metadata or add a database column.
- Every git invocation uses an argv array through `execFileAsync`, `execFileBufferAsync`, or `spawn`, and no implementation may use `exec`, a shell string, or `oid:path` syntax.
- Tree-shaped reads use `git --literal-pathspecs ls-tree -z TREE -- PATH` followed by `git cat-file -s BLOB_OID` and `git cat-file blob BLOB_OID`.
- A live candidate is realpathed and must remain beneath the already-realpathed checkout before bytes are read.
- Path validation rejects an empty path, NUL, POSIX absolute paths, Windows drive or UNC paths, `.git` as the first segment, and any `..` segment after URI decoding.
- Filenames containing a colon, a leading dash, spaces, newlines, or glob metacharacters must still work.
- JSON routes use `registerOpenApiRoute(createRoute(...), handler)`.
- The raw file route stays `app.get` because OpenAPI 3.0 cannot represent the wildcard path.
- Do not regenerate `packages/web/src/lib/api.generated.d.ts` unless an OpenAPI JSON schema actually changes.
- The raw file client stays hand-typed.
- Auth remains the global `/api/*` gate with no `requireWebUser` call and no per-run owner ACL.
- Both git content routes still return HTTP 200 with `{ emptyReason: "container" | "no_checkout" }` for CAP-6.
- Modified files use only the JSON diff route for text hunks.
- Added files use only raw `source=worktree`.
- Deleted files use only raw `source=head`.
- A ready Now diff always has `scope: "now"`, `ref: "live"`, and `status: "M"`.
- `fileDiff` keeps `-U3` context and never sends a whole-file snapshot for `M`.
- The web treats `cursor` as opaque and appends it only when non-empty.
- The list and already-painted viewer content remain frozen until the operator explicitly accepts `Changed on disk — Reload`.
- Load more must not rewrite the list snapshot and must not be mistaken for a stale-content event.
- No stage, unstage, edit, discard, commit, or other write control is added.
- Syntax highlighting stays on installed `highlight.js`.
- Do not add Shiki, Monaco, refractor, a sanitizer dependency, a second diff library, or any new production dependency.
- Lists already virtualize with `@tanstack/react-virtual`.
- Diff hunks must virtualize with the same library and the same zero-height fallback already used by `changed-files-list.tsx`.
- Pino events use `domain.action_state`, pair every started event with completed or failed, and never log checkout paths, remotes, file contents, file paths, cursors that embed a path, or path-bearing error messages.
- Failure logs contain only `runId` and a stable `errorType`.
- User copy is terse and non-alarming and must not introduce `Error:`, `unsupported`, or a warning glyph.
- NFR6 remains accepted: do not add redaction or a denylist, and `.env` text must still open as text.
- Do not add a public `@archon/git` export beyond the current `fileAt` / `fileDiff` I/O pair.
- `mock.module()` merges omitted exports from the real module, so a new public I/O export would require stubbing all 31 existing `@archon/git` factories.
- Continue using the existing isolated `packages/server/src/routes/api.git-changes.test.ts` process for all three git HTTP routes.
- Continue using the existing isolated `packages/web/src/component-integration/source-control-tab.test.tsx` process for mounted viewer behavior.
- `@archon/web` must not import `@archon/git`.
- Every behavior change follows RED, verified RED, minimal GREEN, verified GREEN, and only then refactoring.
- Run all command blocks from the repository root, and use a subshell for commands that must execute inside a package.
- Do not run `bun test` from the repository root without a path.
- Do not mark the tracker done until focused tests, affected package suites, `bun run validate`, `git diff --check`, and the manual acceptance check all pass.
- Every full Markdown sentence in this plan stays on one physical line.

## File Structure

- Create `packages/git/src/viewer-limits.ts` for the single cutoff table, opaque cursors, media sniffing, hex formatting, text paging, hunk paging, and presentation choice.
- Create `packages/git/src/viewer-limits.test.ts` for those pure functions.
- Modify `packages/git/src/file-read.ts` so `fileDiff` paginates hunks and `fileAt` accepts an optional view/full intent without adding a new public export.
- Modify `packages/git/src/file-read.test.ts` for pagination, bounded view reads, image sniffing, hex peek, and download-only classification.
- Modify `packages/git/src/index.ts` only if exported types grow; do not export `viewer-limits` helpers.
- Modify `packages/server/src/routes/git/diff-handler.ts` to pass the opaque cursor into `fileDiff`.
- Modify `packages/server/src/routes/git/file-handler.ts` to pass view/full intent, echo presentation headers, and honor `download=1`.
- Modify `packages/server/src/routes/api.git-changes.test.ts` for cursor pages, presentation headers, invalid cursors, and download versus view.
- Modify `packages/web/src/lib/api.ts` and `packages/web/src/lib/api.git-changes.test.ts` for paged text, image bytes, hex bytes, and download-only results.
- Create `packages/web/src/components/workflows/source-control/hex-peek.ts` and `hex-peek.test.ts` as a web-local formatter that mirrors the git hex format exactly.
- Modify `packages/web/src/components/workflows/source-control/file-viewer.tsx` and `file-viewer.test.tsx` for Load more, image, hex, download-only, and virtualized hunks.
- Modify `packages/web/src/components/workflows/source-control/source-control-tab.tsx` to append pages, keep Cancel on in-flight Load more, revoke image object URLs, and stop using whole-diff JSON as a stale fingerprint.
- Modify `packages/web/src/component-integration/source-control-tab.test.tsx` for Load more, images, hex, download-only, and fingerprint stability.
- Modify `_bmad-output/implementation-artifacts/archon-source-control/sprint-status.yaml` only after every acceptance gate passes.
- Do not modify `packages/web/src/components/workflows/WorkflowExecution.tsx`.
- Do not add a package, table, env var, process, or deployable.

## Locked Contracts

The single cutoff table is:

~~~ts
export const VIEWER_FIRST_PAINT_BYTES = 256 * 1024;
export const VIEWER_FIRST_PAINT_LINES = 2000;
export const VIEWER_STREAM_BYTES = 1024 * 1024;
export const VIEWER_DOWNLOAD_ONLY_BYTES = 50 * 1024 * 1024;
export const VIEWER_HEX_PEEK_BYTES = 4 * 1024;
export const VIEWER_BINARY_PROBE_BYTES = 8 * 1024;
export const VIEWER_DIFF_CONTEXT_LINES = 3;
~~~

The git data contract becomes:

~~~ts
type GitFilePresentation = 'text' | 'image' | 'hex' | 'download';

type FileAtIntent = 'full' | 'view';

interface FileAtRequest {
  intent?: FileAtIntent;
  cursor?: string;
}

interface FileAtResult {
  path: string;
  bytes: Uint8Array;
  binary: boolean;
  contentHash: string;
  byteLength: number;
  truncated: boolean;
  cursor: string;
  presentation: GitFilePresentation;
  mediaType: string;
}

interface FileDiffResult {
  path: string;
  status: 'M';
  scope: 'now';
  ref: 'live';
  hunks: DiffHunk[];
  cursor: string;
  truncated: boolean;
  binary: boolean;
}

function fileAt(
  workingPath: RepoPath | WorktreePath,
  relativePath: string,
  source: FileAtSource,
  request?: FileAtRequest
): Promise<FileAtResult>;

function fileDiff(
  workingPath: RepoPath | WorktreePath,
  relativePath: string,
  cursor?: string
): Promise<FileDiffResult>;
~~~

Omitted `fileAt` request keeps today's full-read behavior so existing full-byte tests stay valid.
View intent never reads more than the chosen presentation requires.
Text view pages are `min(remaining bytes, 256 KiB)` stopped earlier at 2,000 lines on a newline when one exists in the window.
A single oversize hunk is still sent whole and never split.
`M` diffs keep `-U3` and never include the unmodified remainder of the file.

Presentation order is:

1. `byteLength > 50 MiB` and not a hex peek of a non-image binary → `download` with empty `bytes`.
2. Image magic or SVG prefix → `image` with full bytes when `byteLength <= 50 MiB`, otherwise `download`.
3. NUL in the first 8 KiB → `hex` with at most 4 KiB.
4. Otherwise `text` with a first-paint page.

Image sniffing runs before the NUL heuristic because PNG, JPEG, GIF, and WEBP headers usually contain no NUL.
SVG without NUL is still an image when the UTF-8 prefix is `<svg` or `<?xml` plus `<svg` inside the first 8 KiB.
Images render through `<img src={blobUrl}>`, never through inline SVG DOM.

Opaque cursors are unpadded base64url JSON.
File pages use `{"o": nextByteOffset}`.
Hunk pages use `{"h": nextHunkIndex}`.
Empty cursor means offset `0` or hunk index `0`.
Garbage, missing fields, negative numbers, and non-integers are invalid.

The raw file route is `GET /api/workflows/runs/:runId/git/file/*?source=worktree|head&cursor=OPAQUE_OPTIONAL&download=1_OPTIONAL`.

Successful raw responses keep `ETag: "<64-lowercase-hex-contentHash>"` and add:

- `X-Archon-Git-Byte-Length: <decimal full size>`
- `X-Archon-Git-Truncated: true|false`
- `X-Archon-Git-Cursor: <opaque or empty>`
- `X-Archon-Git-Presentation: text|image|hex|download`
- `X-Archon-Git-Media-Type: image/png|image/jpeg|image/gif|image/webp|image/svg+xml|` empty otherwise

Content-Type is `text/plain; charset=utf-8` for text, the image media type for images, and `application/octet-stream` for hex and download.
`download=1` or presentation `download` sets `Content-Disposition: attachment; filename="download"`.
CAP-6 remains HTTP 200 JSON with no ETag and no presentation headers.
Missing run is HTTP 404 with `{ error: "Workflow run not found" }`.
Invalid path or source is HTTP 400 with `{ error: "Invalid file path" }` or `{ error: "Invalid file source" }`.
Invalid cursor is HTTP 400 with `{ error: "Invalid file cursor" }`.
Missing file is HTTP 404 with `{ error: "File not found" }`.
Unexpected post-gate failures stay opaque HTTP 500 with `Could not read git diff` or `Could not read git file`.

The web file client becomes:

~~~ts
type GitFileClientResult =
  | { kind: 'empty'; emptyReason: GitEmptyReason }
  | {
      kind: 'text';
      text: string;
      contentHash: string;
      truncated: boolean;
      cursor: string;
      byteLength: number;
    }
  | {
      kind: 'image';
      bytes: Uint8Array;
      contentHash: string;
      mediaType: string;
      byteLength: number;
    }
  | { kind: 'hex'; bytes: Uint8Array; contentHash: string; byteLength: number }
  | { kind: 'download'; contentHash: string; byteLength: number };
~~~

`gitFileUrl` adds `cursor` only when non-empty and adds `download=1` only when requested.
The viewer Download link always uses `download=1` and never a cursor.

## Open Questions

### OQ-1 — Image detection versus the NUL heuristic

PNG, JPEG, GIF, and WEBP headers usually contain no NUL, so the git 8 KiB NUL probe would otherwise dump them as highlighted text.
**Provisional default:** sniff those magic bytes and the SVG prefix on every file, before NUL, and treat a match as an image.

### OQ-2 — Hex peek above the download-only size

Story 1.3 says files above about 50 MB are download-only and also says non-image binaries get a 4 KiB hex peek.
**Provisional default:** text and images above 50 MB are download-only with no inline body.
**Provisional default:** non-image binaries still return a 4 KiB hex peek plus Download, because that peek is 4 KiB and keeps the file inspectable.

### OQ-3 — Streaming the Download body for files above 50 MB

AD-2 forbids the route from assembling git argv, and a new public stream helper would poison 31 `mock.module('@archon/git')` factories.
**Provisional default:** the viewer never inlines those files.
**Provisional default:** `download=1` may buffer through existing `fileAt({ intent: 'full' })` for files at or under 50 MB.
**Provisional default:** files above 50 MB are not fully read for view, and `download=1` for those sizes is allowed to use `fileAt({ intent: 'full' })` without a new public export.
Do not build a second git I/O API in this story.

---

### Task 1: Add the single cutoff table and pure paging helpers

**Files:**

- Create: `packages/git/src/viewer-limits.ts`
- Create: `packages/git/src/viewer-limits.test.ts`

**Interfaces:**

- Produces the seven cutoff constants listed in Locked Contracts.
- Produces `encodeGitCursor` / `decodeGitCursor`.
- Produces `sniffGitMediaType(bytes: Uint8Array): string`.
- Produces `sliceTextPage(bytes: Uint8Array, byteOffset: number): { slice: Uint8Array; nextOffset: number; truncated: boolean }`.
- Produces `pageHunks(hunks, startIndex)` using change content bytes and change counts.
- Produces `chooseGitFilePresentation({ byteLength, mediaType, binary })`.
- Produces `formatGitHexPeek(bytes: Uint8Array): string`.

- [ ] **Step 1: Write the failing pure tests**

Create `packages/git/src/viewer-limits.test.ts` with this complete content:

~~~ts
import { describe, expect, test } from 'bun:test';

import {
  VIEWER_DIFF_CONTEXT_LINES,
  VIEWER_DOWNLOAD_ONLY_BYTES,
  VIEWER_FIRST_PAINT_BYTES,
  VIEWER_FIRST_PAINT_LINES,
  VIEWER_HEX_PEEK_BYTES,
  VIEWER_STREAM_BYTES,
  chooseGitFilePresentation,
  decodeGitCursor,
  encodeGitCursor,
  formatGitHexPeek,
  pageHunks,
  sliceTextPage,
  sniffGitMediaType,
} from './viewer-limits';

const PNG = Uint8Array.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
  0x89, 0x00, 0x00, 0x00, 0x0a, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00,
  0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae,
  0x42, 0x60, 0x82,
]);

describe('viewer-limits constants', () => {
  test('match viewer-rules.md and do not invent a parallel table', () => {
    expect(VIEWER_FIRST_PAINT_BYTES).toBe(256 * 1024);
    expect(VIEWER_FIRST_PAINT_LINES).toBe(2000);
    expect(VIEWER_STREAM_BYTES).toBe(1024 * 1024);
    expect(VIEWER_DOWNLOAD_ONLY_BYTES).toBe(50 * 1024 * 1024);
    expect(VIEWER_HEX_PEEK_BYTES).toBe(4 * 1024);
    expect(VIEWER_DIFF_CONTEXT_LINES).toBe(3);
  });
});

describe('cursors', () => {
  test('round-trips file and hunk offsets and treats empty as zero', () => {
    expect(decodeGitCursor('')).toEqual({ o: 0, h: 0 });
    expect(decodeGitCursor(encodeGitCursor({ o: 4096 }))).toEqual({ o: 4096, h: 0 });
    expect(decodeGitCursor(encodeGitCursor({ h: 2 }))).toEqual({ o: 0, h: 2 });
  });

  test('rejects garbage, negatives, and non-integers', () => {
    expect(() => decodeGitCursor('not-base64')).toThrow('Invalid file cursor');
    expect(() => decodeGitCursor(Buffer.from('{"o":-1}', 'utf8').toString('base64url'))).toThrow(
      'Invalid file cursor'
    );
    expect(() => decodeGitCursor(Buffer.from('{"h":1.5}', 'utf8').toString('base64url'))).toThrow(
      'Invalid file cursor'
    );
  });
});

describe('sniffGitMediaType', () => {
  test('detects png jpeg gif webp and svg without requiring NUL', () => {
    expect(sniffGitMediaType(PNG)).toBe('image/png');
    expect(sniffGitMediaType(Uint8Array.from([0xff, 0xd8, 0xff, 0xe0]))).toBe('image/jpeg');
    expect(sniffGitMediaType(Uint8Array.from(Buffer.from('GIF89a', 'ascii')))).toBe('image/gif');
    const webp = new Uint8Array(12);
    webp.set(Buffer.from('RIFF', 'ascii'), 0);
    webp.set(Buffer.from('WEBP', 'ascii'), 8);
    expect(sniffGitMediaType(webp)).toBe('image/webp');
    expect(sniffGitMediaType(Uint8Array.from(Buffer.from('<svg xmlns="n"></svg>\n', 'utf8')))).toBe(
      'image/svg+xml'
    );
    expect(
      sniffGitMediaType(Uint8Array.from(Buffer.from('<?xml version="1.0"?><svg></svg>', 'utf8')))
    ).toBe('image/svg+xml');
    expect(sniffGitMediaType(Uint8Array.from(Buffer.from('hello\n', 'utf8')))).toBe('');
  });
});

describe('sliceTextPage', () => {
  test('stops at 2000 lines even when under 256 KiB', () => {
    const lines = Array.from({ length: 2500 }, (_, index) => `L${String(index)}`);
    const bytes = Uint8Array.from(Buffer.from(lines.join('\n') + '\n', 'utf8'));
    const page = sliceTextPage(bytes, 0);
    expect(Buffer.from(page.slice).toString('utf8')).toContain('L1999\n');
    expect(Buffer.from(page.slice).toString('utf8')).not.toContain('L2000\n');
    expect(page.truncated).toBe(true);
    expect(page.nextOffset).toBeGreaterThan(0);
  });

  test('stops at 256 KiB on the previous newline when lines are huge', () => {
    const line = 'x'.repeat(2000) + '\n';
    const bytes = Uint8Array.from(Buffer.from(line.repeat(200), 'utf8'));
    const page = sliceTextPage(bytes, 0);
    expect(page.slice.byteLength).toBeLessThanOrEqual(VIEWER_FIRST_PAINT_BYTES);
    expect(page.truncated).toBe(true);
    const second = sliceTextPage(bytes, page.nextOffset);
    expect(second.slice.byteLength).toBeGreaterThan(0);
  });

  test('a short file is not truncated', () => {
    const bytes = Uint8Array.from(Buffer.from('one\ntwo\n', 'utf8'));
    const page = sliceTextPage(bytes, 0);
    expect(page.truncated).toBe(false);
    expect(page.nextOffset).toBe(bytes.byteLength);
    expect(Buffer.from(page.slice).toString('utf8')).toBe('one\ntwo\n');
  });
});

describe('pageHunks', () => {
  test('always includes the first hunk and then stops at the line budget', () => {
    const hunks = Array.from({ length: 5 }, (_, index) => ({
      header: `@@ -${String(index + 1)} +${String(index + 1)} @@`,
      changes: Array.from({ length: 900 }, () => ({ content: 'x' })),
    }));
    const first = pageHunks(hunks, 0);
    expect(first.hunks).toHaveLength(3);
    expect(first.truncated).toBe(true);
    expect(first.nextIndex).toBe(3);
    const second = pageHunks(hunks, first.nextIndex);
    expect(second.hunks).toHaveLength(2);
    expect(second.truncated).toBe(false);
  });
});

describe('chooseGitFilePresentation', () => {
  test('prefers image, then hex, then text, and download-only above 50 MiB', () => {
    expect(
      chooseGitFilePresentation({
        byteLength: 100,
        mediaType: 'image/png',
        binary: false,
      })
    ).toBe('image');
    expect(
      chooseGitFilePresentation({
        byteLength: VIEWER_DOWNLOAD_ONLY_BYTES + 1,
        mediaType: 'image/png',
        binary: false,
      })
    ).toBe('download');
    expect(
      chooseGitFilePresentation({
        byteLength: VIEWER_DOWNLOAD_ONLY_BYTES + 1,
        mediaType: '',
        binary: true,
      })
    ).toBe('hex');
    expect(
      chooseGitFilePresentation({
        byteLength: VIEWER_DOWNLOAD_ONLY_BYTES + 1,
        mediaType: '',
        binary: false,
      })
    ).toBe('download');
    expect(chooseGitFilePresentation({ byteLength: 10, mediaType: '', binary: true })).toBe('hex');
    expect(chooseGitFilePresentation({ byteLength: 10, mediaType: '', binary: false })).toBe('text');
  });
});

describe('formatGitHexPeek', () => {
  test('renders offset hex and ascii with dots for non-printables', () => {
    const text = formatGitHexPeek(Uint8Array.from([0x00, 0x41, 0xff]));
    expect(text).toContain('00000000');
    expect(text).toContain('00 41 ff');
    expect(text).toContain('|');
    expect(text).toContain('.A.');
  });
});
~~~

- [ ] **Step 2: Verify RED**

Run:

~~~bash
( cd packages/git && bun test src/viewer-limits.test.ts )
~~~

Expected: FAIL because `packages/git/src/viewer-limits.ts` does not exist.

- [ ] **Step 3: Implement the pure module**

Create `packages/git/src/viewer-limits.ts` implementing the constants and helpers so every assertion in Step 1 passes.
`decodeGitCursor` must accept `{"o":n}`, `{"h":n}`, or both, defaulting a missing key to `0`.
`sliceTextPage` must not split a UTF-8 code point and must prefer the last newline at or before the byte budget.
`pageHunks` must count each change as one line and `content.length + 1` bytes, always keep a first hunk that alone exceeds the budget, and stop before adding a later hunk that would exceed either budget.
`sniffGitMediaType` must recognize PNG, JPEG (`FF D8 FF`), GIF87a/GIF89a, RIFF/WEBP at offset 8, and SVG as specified.
`chooseGitFilePresentation` must implement the Locked Contracts order, including hex for oversized non-image binaries.

- [ ] **Step 4: Verify GREEN**

Run:

~~~bash
( cd packages/git && bun test src/viewer-limits.test.ts )
~~~

Expected: PASS.

- [ ] **Step 5: Commit**

~~~bash
git add packages/git/src/viewer-limits.ts packages/git/src/viewer-limits.test.ts
git commit -m "$(cat <<'EOF'
feat(sc): add source-control viewer cutoffs and paging helpers

Story 1.3 needs one build-tunable cutoff table before git I/O can page large files.
EOF
)"
~~~

---

### Task 2: Page Now hunks without sending the whole file

**Files:**

- Modify: `packages/git/src/file-read.ts`
- Modify: `packages/git/src/file-read.test.ts`

**Interfaces:**

- `FileDiffResult.cursor` becomes `string`.
- `FileDiffResult.truncated` becomes `boolean`.
- `fileDiff(workingPath, relativePath, cursor?: string)` pages with `pageHunks`.
- Diff argv uses `` `-U${VIEWER_DIFF_CONTEXT_LINES}` ``.

- [ ] **Step 1: Write the failing pagination tests**

Append these tests inside the existing `fileAt and fileDiff` describe in `packages/git/src/file-read.test.ts`, after the current `fileDiff reports HEAD-to-worktree` test.

~~~ts
  test('fileDiff uses -U3 and pages hunks through an opaque cursor', async () => {
    const workingPath = toWorktreePath(repoPath);
    const originalAsync = exec.execFileAsync;
    const asyncSpy = spyOn(exec, 'execFileAsync').mockImplementation(
      (cmd: string, args: string[], options?: Parameters<typeof originalAsync>[2]) =>
        originalAsync(cmd, args, options)
    );
    const many = Array.from({ length: 2500 }, (_, index) => `keep-${String(index)}`).join('\n');
    await writeFile(join(repoPath, 'paged.ts'), `${many}\n`);
    await exec.execFileAsync('git', ['-C', repoPath, 'add', 'paged.ts']);
    await exec.execFileAsync('git', ['-C', repoPath, 'commit', '-m', 'page']);
    const next = Array.from({ length: 2500 }, (_, index) => `chg-${String(index)}`).join('\n');
    await writeFile(join(repoPath, 'paged.ts'), `${next}\n`);

    const first = await fileDiff(workingPath, 'paged.ts');
    expect(first.truncated).toBe(true);
    expect(first.cursor.length).toBeGreaterThan(0);
    expect(first.hunks.length).toBeGreaterThan(0);
    expect(first.hunks.length).toBeLessThan(first.hunks.reduce((sum, hunk) => sum + hunk.changes.length, 0) + 1);
    const argv = asyncSpy.mock.calls.map(call => call[1] as string[]).flat();
    expect(argv).toContain('-U3');
    expect(argv).not.toContain('-U0');

    const second = await fileDiff(workingPath, 'paged.ts', first.cursor);
    expect(second.hunks[0]?.header).not.toBe(first.hunks[0]?.header);
    asyncSpy.mockRestore();
  });

  test('fileDiff rejects a garbage cursor as GitFileError invalid_cursor', async () => {
    await expect(fileDiff(toWorktreePath(repoPath), 'tracked.ts', 'nope')).rejects.toMatchObject({
      name: 'GitFileError',
      code: 'invalid_cursor',
    });
  });
~~~

Add `'invalid_cursor'` to `GitFileErrorCode` in the test expectation by implementing it in the same GREEN step.
Widen the existing `toMatchObject` for `tracked.ts` so `cursor` may be a string rather than only `''`.

- [ ] **Step 2: Verify RED**

Run:

~~~bash
( cd packages/git && bun test src/file-read.test.ts )
~~~

Expected: FAIL because `fileDiff` still returns every hunk with `cursor: ''` and `truncated: false`, and `GitFileError` has no `invalid_cursor` code.

- [ ] **Step 3: Implement hunk paging**

In `packages/git/src/file-read.ts`:
- Import paging helpers and `VIEWER_DIFF_CONTEXT_LINES` from `./viewer-limits`.
- Extend `GitFileErrorCode` with `'invalid_cursor'`.
- Change `fileDiff` to `fileDiff(workingPath, relativePath, cursor = '')`.
- Keep the binary probe and empty-hunk binary result.
- Keep `--literal-pathspecs`, `--no-ext-diff`, `--no-textconv`, `--text`, and `` `-U${VIEWER_DIFF_CONTEXT_LINES}` ``.
- Parse the unified diff, `decodeGitCursor(cursor)` to a hunk index, and return `pageHunks` with `encodeGitCursor({ h: nextIndex })` when truncated.
- Map cursor decode failures to `new GitFileError('invalid_cursor')`.

- [ ] **Step 4: Verify GREEN**

Run:

~~~bash
( cd packages/git && bun test src/file-read.test.ts src/viewer-limits.test.ts )
~~~

Expected: PASS.

- [ ] **Step 5: Commit**

~~~bash
git add packages/git/src/file-read.ts packages/git/src/file-read.test.ts
git commit -m "$(cat <<'EOF'
feat(sc): page Now git hunks at the viewer first-paint budget

Modified files must send hunks plus three lines of context, not the whole file.
EOF
)"
~~~

---

### Task 3: Bound view reads and classify presentation

**Files:**

- Modify: `packages/git/src/file-read.ts`
- Modify: `packages/git/src/file-read.test.ts`

**Interfaces:**

- Extend `FileAtResult` with `byteLength`, `truncated`, `cursor`, `presentation`, and `mediaType`.
- Add optional `FileAtRequest` as the fourth `fileAt` argument.
- Default intent `full` remains a complete byte read.
- Intent `view` applies presentation and first-paint limits.
- Do not export new functions from `packages/git/src/index.ts`.

- [ ] **Step 1: Write the failing view-read tests**

Append these tests to `packages/git/src/file-read.test.ts` in the existing real-repo describe.

~~~ts
  test('view intent pages a 2500-line added file and continues from the cursor', async () => {
    const lines = Array.from({ length: 2500 }, (_, index) => `line-${String(index)}`);
    await writeFile(join(repoPath, 'big.txt'), `${lines.join('\n')}\n`);
    const first = await fileAt(toWorktreePath(repoPath), 'big.txt', { kind: 'worktree' }, { intent: 'view' });
    expect(first.presentation).toBe('text');
    expect(first.truncated).toBe(true);
    expect(first.byteLength).toBeGreaterThan(first.bytes.byteLength);
    expect(Buffer.from(first.bytes).toString('utf8')).toContain('line-0\n');
    expect(Buffer.from(first.bytes).toString('utf8')).not.toContain('line-2000\n');
    const second = await fileAt(
      toWorktreePath(repoPath),
      'big.txt',
      { kind: 'worktree' },
      { intent: 'view', cursor: first.cursor }
    );
    expect(Buffer.from(second.bytes).toString('utf8')).toContain('line-2000\n');
  });

  test('view intent classifies a PNG as image and a NUL file as hex without dumping the 1 MiB fixture', async () => {
    await writeFile(join(repoPath, 'tiny.png'), PNG);
    const image = await fileAt(
      toWorktreePath(repoPath),
      'tiny.png',
      { kind: 'worktree' },
      { intent: 'view' }
    );
    expect(image.presentation).toBe('image');
    expect(image.mediaType).toBe('image/png');
    expect(image.bytes).toEqual(PNG);

    const hex = await fileAt(
      toWorktreePath(repoPath),
      'nul-1mb.bin',
      { kind: 'tree', treeIsh: 'HEAD' },
      { intent: 'view' }
    );
    expect(hex.presentation).toBe('hex');
    expect(hex.binary).toBe(true);
    expect(hex.bytes.byteLength).toBe(VIEWER_HEX_PEEK_BYTES);
    expect(hex.byteLength).toBe(NUL_FIXTURE_BYTES);
  });

  test('view intent does not open a worktree file whose size exceeds 50 MiB', async () => {
    const fsPromises = await import('fs/promises');
    const originalLstat = fsPromises.lstat;
    const lstatSpy = spyOn(fsPromises, 'lstat').mockImplementation(async (path, options) => {
      const stat = await originalLstat(path, options);
      if (String(path).endsWith('added.ts')) {
        return { ...stat, size: VIEWER_DOWNLOAD_ONLY_BYTES + 1, isSymbolicLink: () => false, isFile: () => true };
      }
      return stat;
    });
    const openSpy = spyOn(fsPromises, 'open');
    try {
      const result = await fileAt(
        toWorktreePath(repoPath),
        'added.ts',
        { kind: 'worktree' },
        { intent: 'view' }
      );
      expect(result.presentation).toBe('download');
      expect(result.bytes.byteLength).toBe(0);
      expect(result.byteLength).toBe(VIEWER_DOWNLOAD_ONLY_BYTES + 1);
      expect(openSpy).not.toHaveBeenCalled();
    } finally {
      lstatSpy.mockRestore();
      openSpy.mockRestore();
    }
  });

  test('full intent still returns every byte of the committed 1048577-byte NUL fixture', async () => {
    const result = await fileAt(toWorktreePath(repoPath), 'nul-1mb.bin', {
      kind: 'tree',
      treeIsh: 'HEAD',
    });
    expect(result.bytes.byteLength).toBe(NUL_FIXTURE_BYTES);
    expect(result.presentation).toBe('hex');
  });
~~~

Define `PNG` once at the top of the test file using the same bytes as Task 1.
Import `VIEWER_HEX_PEEK_BYTES` and `VIEWER_DOWNLOAD_ONLY_BYTES`.
Existing full-read tests must keep passing after `FileAtResult` grows extra fields.

- [ ] **Step 2: Verify RED**

Run:

~~~bash
( cd packages/git && bun test src/file-read.test.ts )
~~~

Expected: FAIL because `fileAt` does not accept a fourth argument and always returns the whole file.

- [ ] **Step 3: Implement bounded `fileAt`**

Update `FileAtResult` and `fileAt` as locked.
For worktree view reads, `lstat` first, classify from size plus an 8 KiB prefix when needed, and `read` only the required range through the existing inode-checked handle.
For tree view reads, `ls-tree -z` then `git cat-file -s` on the blob OID; skip `cat-file blob` when presentation is `download`; otherwise read the blob and slice.
If a blob is larger than 50 MiB and a 4 KiB hex prefix is required, spawn `git cat-file blob OID` with an argv array, read at most 4 KiB, and kill the child.
Never use `oid:path`.
`contentHash` for intent `full` remains SHA-256 of the full bytes.
`contentHash` for intent `view` is SHA-256 of `byteLength` plus worktree `ino:mtimeMs` or the blob OID so the viewer can fingerprint without hashing a 50 MiB object.
Symlink worktree reads stay the `readlink` target string.
Map cursor decode failures to `GitFileError('invalid_cursor')`.

Fill `presentation` / `mediaType` for intent `full` too so HTTP download can reuse the classifier without a second public API.

- [ ] **Step 4: Verify GREEN**

Run:

~~~bash
( cd packages/git && bun test src/file-read.test.ts src/viewer-limits.test.ts )
( cd packages/git && bun run type-check )
~~~

Expected: PASS.

- [ ] **Step 5: Commit**

~~~bash
git add packages/git/src/file-read.ts packages/git/src/file-read.test.ts
git commit -m "$(cat <<'EOF'
feat(sc): bound source-control view reads and classify file presentation

Large text pages, images, hex peeks, and download-only files must not dump whole blobs into the viewer.
EOF
)"
~~~

---

### Task 4: Thread cursors and presentation through the git HTTP routes

**Files:**

- Modify: `packages/server/src/routes/git/diff-handler.ts`
- Modify: `packages/server/src/routes/git/file-handler.ts`
- Modify: `packages/server/src/routes/api.git-changes.test.ts`

**Interfaces:**

- Diff handler calls `fileDiff(workingPath, path, cursor)` where `cursor` is the query value or `''`.
- File handler calls `fileAt(..., { intent: download ? 'full' : 'view', cursor })`.
- File handler writes the locked presentation headers on successful non-CAP-6 responses.
- `invalid_cursor` maps to HTTP 400 `{ error: "Invalid file cursor" }` on both routes.

- [ ] **Step 1: Write the failing HTTP tests**

In `packages/server/src/routes/api.git-changes.test.ts`, extend `FileAtResult` literals with the new fields through one helper:

~~~ts
function readyFileAt(overrides: Partial<FileAtResult> = {}): FileAtResult {
  return {
    path: 'x.ts',
    bytes: TEXT_BYTES,
    binary: false,
    contentHash: TEXT_HASH,
    byteLength: TEXT_BYTES.byteLength,
    truncated: false,
    cursor: '',
    presentation: 'text',
    mediaType: '',
    ...overrides,
  };
}
~~~

Replace every `Promise<FileAtResult>` object with `readyFileAt(...)`.
Update `mockFileAt` to accept a fourth request argument and `mockFileDiff` to accept a third cursor argument.

Add tests:

~~~ts
test('forwards a non-empty diff cursor to fileDiff and returns the page envelope', async () => {
  mockGetWorkflowRun.mockResolvedValue(runRow());
  mockFileDiff.mockImplementationOnce(async (_workingPath, _path, cursor) => ({
    path: 'src/a.ts',
    status: 'M',
    scope: 'now',
    ref: 'live',
    hunks: [
      {
        oldStart: 3,
        oldLines: 1,
        newStart: 3,
        newLines: 1,
        header: '@@ -3,1 +3,1 @@',
        changes: [{ type: 'normal', content: 'tail', oldLine: 3, newLine: 3 }],
      },
    ],
    cursor: '',
    truncated: false,
    binary: false,
  }));
  const app = makeApp();
  const response = await app.request(
    '/api/workflows/runs/run-1/git/diff?path=src/a.ts&cursor=opaque-token'
  );
  expect(response.status).toBe(200);
  expect(mockFileDiff.mock.calls[0]?.[2]).toBe('opaque-token');
  const body = await response.json();
  expect(body.truncated).toBe(false);
  expect(body.cursor).toBe('');
  expectDiffLogPair('git.diff_completed');
});

test('maps invalid_cursor on diff to HTTP 400 Invalid file cursor', async () => {
  mockGetWorkflowRun.mockResolvedValue(runRow());
  mockFileDiff.mockRejectedValueOnce(namedError('GitFileError', 'invalid_cursor'));
  const app = makeApp();
  const response = await app.request('/api/workflows/runs/run-1/git/diff?path=src/a.ts&cursor=bad');
  expect(response.status).toBe(400);
  expect(await response.json()).toEqual({ error: 'Invalid file cursor' });
});

test('view file responses include presentation headers and do not treat hex as text/plain', async () => {
  mockGetWorkflowRun.mockResolvedValue(runRow());
  mockFileAt.mockResolvedValueOnce(
    readyFileAt({
      path: 'blob.bin',
      bytes: Uint8Array.from([0, 1, 2, 3]),
      binary: true,
      presentation: 'hex',
      truncated: false,
      byteLength: 99,
    })
  );
  const app = makeApp();
  const response = await app.request('/api/workflows/runs/run-1/git/file/blob.bin?source=worktree');
  expect(response.status).toBe(200);
  expect(response.headers.get('Content-Type')).toBe('application/octet-stream');
  expect(response.headers.get('X-Archon-Git-Presentation')).toBe('hex');
  expect(response.headers.get('X-Archon-Git-Byte-Length')).toBe('99');
  expect(response.headers.get('X-Archon-Git-Truncated')).toBe('false');
  expect(Buffer.from(await response.arrayBuffer())).toEqual(Buffer.from([0, 1, 2, 3]));
  expect(mockFileAt.mock.calls.at(-1)?.[3]).toEqual({ intent: 'view', cursor: '' });
});

test('download=1 uses full intent and attachment disposition', async () => {
  mockGetWorkflowRun.mockResolvedValue(runRow());
  mockFileAt.mockResolvedValueOnce(
    readyFileAt({
      path: 'blob.bin',
      bytes: Uint8Array.from([0, 1, 2]),
      binary: true,
      presentation: 'download',
    })
  );
  const app = makeApp();
  const response = await app.request(
    '/api/workflows/runs/run-1/git/file/blob.bin?source=worktree&download=1'
  );
  expect(response.status).toBe(200);
  expect(response.headers.get('Content-Disposition')).toBe('attachment; filename="download"');
  expect(mockFileAt.mock.calls.at(-1)?.[3]).toEqual({ intent: 'full', cursor: '' });
});

test('image view uses the sniffed media type and no attachment header', async () => {
  mockGetWorkflowRun.mockResolvedValue(runRow());
  mockFileAt.mockResolvedValueOnce(
    readyFileAt({
      path: 'tiny.png',
      bytes: Uint8Array.from([0x89, 0x50, 0x4e, 0x47]),
      presentation: 'image',
      mediaType: 'image/png',
    })
  );
  const app = makeApp();
  const response = await app.request('/api/workflows/runs/run-1/git/file/tiny.png?source=worktree');
  expect(response.headers.get('Content-Type')).toBe('image/png');
  expect(response.headers.get('Content-Disposition')).toBeNull();
  expect(response.headers.get('X-Archon-Git-Media-Type')).toBe('image/png');
});

test('forwards a file cursor and maps invalid_cursor to HTTP 400', async () => {
  mockGetWorkflowRun.mockResolvedValue(runRow());
  const app = makeApp();
  await app.request('/api/workflows/runs/run-1/git/file/big.txt?source=worktree&cursor=abc');
  expect(mockFileAt.mock.calls.at(-1)?.[3]).toEqual({ intent: 'view', cursor: 'abc' });
  mockFileAt.mockRejectedValueOnce(namedError('GitFileError', 'invalid_cursor'));
  const response = await app.request(
    '/api/workflows/runs/run-1/git/file/big.txt?source=worktree&cursor=abc'
  );
  expect(response.status).toBe(400);
  expect(await response.json()).toEqual({ error: 'Invalid file cursor' });
});
~~~

Update the existing binary attachment test so it uses `download=1` and `presentation: 'download'`.
Keep CAP-6 JSON tests unchanged.
`namedError` already sets `name` and optional `code`; use that for `invalid_cursor`.

- [ ] **Step 2: Verify RED**

Run:

~~~bash
( cd packages/server && bun test src/routes/api.git-changes.test.ts )
~~~

Expected: FAIL because handlers ignore cursor, always call full `fileAt`, and never set presentation headers.

- [ ] **Step 3: Implement the thin handler changes**

`handleGitDiff` reads `c.req.query('cursor') ?? ''` and passes it to `fileDiff`.
Classify `GitFileError` + `invalid_cursor` as HTTP 400 `Invalid file cursor` before the generic 500 path.
Do not log the cursor or path.

`handleGitFile` reads `cursor` and `download`.
`download` is true only when the query equals `1`.
Call `fileAt(toWorktreePath(gate.workingPath), path, source, { intent: download ? 'full' : 'view', cursor })`.
On success, set ETag plus the locked headers.
Body bytes come from `result.bytes`.
Do not log presentation as if it were a path.
CAP-6, 404, and 400 path/source behavior stay identical.

- [ ] **Step 4: Verify GREEN**

Run:

~~~bash
( cd packages/server && bun test src/routes/api.git-changes.test.ts )
~~~

Expected: PASS, including the older changes/diff/file containment tests.

- [ ] **Step 5: Commit**

~~~bash
git add packages/server/src/routes/git/diff-handler.ts packages/server/src/routes/git/file-handler.ts packages/server/src/routes/api.git-changes.test.ts
git commit -m "$(cat <<'EOF'
feat(sc): page git file and diff HTTP responses

The viewer needs opaque cursors and presentation headers without changing CAP-6 or containment.
EOF
)"
~~~

---

### Task 5: Teach the web git client to read paged and binary presentations

**Files:**

- Modify: `packages/web/src/lib/api.ts`
- Modify: `packages/web/src/lib/api.git-changes.test.ts`

**Interfaces:**

- Replace `GitFileClientResult` with the locked union.
- `getWorkflowRunGitFile(runId, path, source, options?: { cursor?: string; download?: boolean; signal?: AbortSignal })`.
- `gitFileUrl(runId, path, source, options?: { cursor?: string; download?: boolean })`.

- [ ] **Step 1: Write the failing client tests**

Update `packages/web/src/lib/api.git-changes.test.ts`.
Keep the empty-cursor diff test.
Add file URL and result tests:

~~~ts
test('gitFileUrl adds cursor only when non-empty and download=1 only when requested', () => {
  expect(gitFileUrl('run/one', 'src/a.ts', 'worktree')).toBe(
    '/api/workflows/runs/run%2Fone/git/file/src/a.ts?source=worktree'
  );
  expect(gitFileUrl('run/one', 'src/a.ts', 'worktree', { cursor: 'ab+c' })).toBe(
    '/api/workflows/runs/run%2Fone/git/file/src/a.ts?source=worktree&cursor=ab%2Bc'
  );
  expect(gitFileUrl('run/one', 'src/a.ts', 'worktree', { download: true })).toBe(
    '/api/workflows/runs/run%2Fone/git/file/src/a.ts?source=worktree&download=1'
  );
});

test('parses text paging headers', async () => {
  fetchSpy = mockFetchResponse(
    new Response('hello\n', {
      status: 200,
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        ETag: `"${CONTENT_HASH}"`,
        'X-Archon-Git-Presentation': 'text',
        'X-Archon-Git-Truncated': 'true',
        'X-Archon-Git-Cursor': 'next',
        'X-Archon-Git-Byte-Length': '99',
      },
    })
  );
  await expect(getWorkflowRunGitFile('run/one', 'src/a.ts', 'worktree')).resolves.toEqual({
    kind: 'text',
    text: 'hello\n',
    contentHash: CONTENT_HASH,
    truncated: true,
    cursor: 'next',
    byteLength: 99,
  });
});

test('parses image bytes and hex bytes and does not call response.text', async () => {
  const bytes = new Uint8Array([0x89, 0x50]);
  const response = new Response(bytes, {
    status: 200,
    headers: {
      'Content-Type': 'image/png',
      ETag: `"${CONTENT_HASH}"`,
      'X-Archon-Git-Presentation': 'image',
      'X-Archon-Git-Media-Type': 'image/png',
      'X-Archon-Git-Byte-Length': '2',
      'X-Archon-Git-Truncated': 'false',
    },
  });
  textSpy = spyOn(response, 'text');
  fetchSpy = mockFetchResponse(response);
  await expect(getWorkflowRunGitFile('run/one', 'tiny.png', 'worktree')).resolves.toEqual({
    kind: 'image',
    bytes,
    contentHash: CONTENT_HASH,
    mediaType: 'image/png',
    byteLength: 2,
  });
  expect(textSpy).not.toHaveBeenCalled();
});

test('download presentation cancels the body and does not parse text', async () => {
  const cancel = mock(() => Promise.resolve());
  const response = new Response(new Uint8Array([0, 1]), {
    status: 200,
    headers: {
      'Content-Type': 'application/octet-stream',
      ETag: `"${CONTENT_HASH}"`,
      'X-Archon-Git-Presentation': 'download',
      'X-Archon-Git-Byte-Length': '80',
      'X-Archon-Git-Truncated': 'false',
    },
  });
  Object.defineProperty(response, 'body', { value: { cancel } });
  textSpy = spyOn(response, 'text');
  fetchSpy = mockFetchResponse(response);
  await expect(getWorkflowRunGitFile('run/one', 'huge.bin', 'worktree')).resolves.toEqual({
    kind: 'download',
    contentHash: CONTENT_HASH,
    byteLength: 80,
  });
  expect(textSpy).not.toHaveBeenCalled();
  expect(cancel).toHaveBeenCalledTimes(1);
});
~~~

Replace the old binary test that cancelled every `application/octet-stream` body, because hex must read those bytes.

- [ ] **Step 2: Verify RED**

Run:

~~~bash
( cd packages/web && bun test src/lib/api.git-changes.test.ts )
~~~

Expected: FAIL because the client still returns `{ kind: 'binary' }` and ignores presentation headers.

- [ ] **Step 3: Implement the client**

Update `gitFileUrl` and `getWorkflowRunGitFile` as locked.
Read presentation from `X-Archon-Git-Presentation`.
If that header is missing, keep the Story 1.2 content-type fallback: JSON CAP-6, `text/plain` as complete text (`truncated: false`, `cursor: ''`, `byteLength: text.length`), `application/octet-stream` as `download` after cancelling the body.
`byteLength` parses `X-Archon-Git-Byte-Length` as a non-negative integer and fails fast with `Invalid git file response` when absent on a presented body except CAP-6.
Hex and image kinds use `new Uint8Array(await response.arrayBuffer())`.
Never call `response.text()` for image, hex, or download.

- [ ] **Step 4: Verify GREEN**

Run:

~~~bash
( cd packages/web && bun test src/lib/api.git-changes.test.ts )
~~~

Expected: PASS.

- [ ] **Step 5: Commit**

~~~bash
git add packages/web/src/lib/api.ts packages/web/src/lib/api.git-changes.test.ts
git commit -m "$(cat <<'EOF'
feat(sc): parse paged git file presentations in the web client

The viewer needs text cursors, image bytes, hex bytes, and download-only results from the raw route.
EOF
)"
~~~

---

### Task 6: Render Load more, images, hex, download-only, and virtualized hunks

**Files:**

- Create: `packages/web/src/components/workflows/source-control/hex-peek.ts`
- Create: `packages/web/src/components/workflows/source-control/hex-peek.test.ts`
- Modify: `packages/web/src/components/workflows/source-control/file-viewer.tsx`
- Modify: `packages/web/src/components/workflows/source-control/file-viewer.test.tsx`

**Interfaces:**

~~~ts
export type FileViewerState =
  | { kind: 'idle' }
  | { kind: 'loading'; file: GitChangedFile }
  | { kind: 'diff'; file: GitChangedFile; response: GitReadyDiffResponse }
  | {
      kind: 'text';
      file: GitChangedFile;
      text: string;
      contentHash: string;
      truncated: boolean;
    }
  | {
      kind: 'image';
      file: GitChangedFile;
      contentHash: string;
      objectUrl: string;
      downloadHref: string;
    }
  | {
      kind: 'hex';
      file: GitChangedFile;
      contentHash: string;
      hex: string;
      downloadHref: string;
    }
  | {
      kind: 'download';
      file: GitChangedFile;
      contentHash: string;
      downloadHref: string;
    }
  | { kind: 'unavailable'; file: GitChangedFile; emptyReason: GitEmptyReason }
  | { kind: 'error'; file: GitChangedFile };

export interface FileViewerProps {
  state: FileViewerState;
  stacked: boolean;
  loadingMore?: boolean;
  onCancel: () => void;
  onReload: () => void;
  onClose: () => void;
  onLoadMore?: () => void;
}
~~~

- [ ] **Step 1: Write the failing UI tests**

Create `packages/web/src/components/workflows/source-control/hex-peek.test.ts`:

~~~ts
import { describe, expect, test } from 'bun:test';

import { formatHexPeek } from './hex-peek';

describe('formatHexPeek', () => {
  test('matches the git helper ascii hexdump', () => {
    expect(formatHexPeek(Uint8Array.from([0x00, 0x41, 0xff]))).toContain('00 41 ff');
    expect(formatHexPeek(Uint8Array.from([0x00, 0x41, 0xff]))).toContain('.A.');
  });
});
~~~

Copy `formatGitHexPeek` byte-for-byte into `hex-peek.ts` so the web package does not import `@archon/git`.
The two implementations must stay identical; the test above is the contract.

Extend `file-viewer.test.tsx`:
- Add `truncated: false` to existing text states.
- Replace `kind: 'binary'` with `kind: 'hex'` and `kind: 'download'` in `STATES`.
- Pass `onLoadMore` through `renderViewer`.
- Add tests:

~~~ts
  test('truncated text and diff show a Load more button and loadingMore shows Cancel', () => {
    const text = renderViewer({
      kind: 'text',
      file: ADDED,
      text: 'hello\n',
      contentHash: 'a'.repeat(64),
      truncated: true,
    });
    expect(text).toContain('>Load more<');
    const loading = renderToStaticMarkup(
      <FileViewer
        state={{ kind: 'text', file: ADDED, text: 'hello\n', contentHash: 'a'.repeat(64), truncated: true }}
        stacked={false}
        loadingMore={true}
        onCancel={(): void => undefined}
        onReload={(): void => undefined}
        onClose={(): void => undefined}
        onLoadMore={(): void => undefined}
      />
    );
    expect(loading).toContain('>Cancel<');
  });

  test('image uses an img tag with the object URL and a Download link', () => {
    const html = renderViewer({
      kind: 'image',
      file: { path: 'tiny.png', status: 'A' },
      contentHash: 'b'.repeat(64),
      objectUrl: 'blob:tiny',
      downloadHref: DOWNLOAD_HREF + '&download=1',
    });
    expect(html).toContain('<img');
    expect(html).toContain('src="blob:tiny"');
    expect(html).toContain('download=1');
    expect(html).not.toContain('class="hljs"');
  });

  test('hex shows a preformatted peek and never a highlighted source dump', () => {
    const html = renderViewer({
      kind: 'hex',
      file: BINARY,
      contentHash: 'b'.repeat(64),
      hex: '00000000  00 41 ff                                          |.A.|',
      downloadHref: DOWNLOAD_HREF + '&download=1',
    });
    expect(html).toContain('00000000');
    expect(html).toContain('>Download<');
    expect(html).not.toContain('class="hljs"');
    expect(html).not.toContain('sc-diff-before');
  });

  test('download-only offers Download and no preformatted body', () => {
    const html = renderViewer({
      kind: 'download',
      file: BINARY,
      contentHash: 'b'.repeat(64),
      downloadHref: DOWNLOAD_HREF + '&download=1',
    });
    expect(html).toContain('>Download<');
    expect(html).toContain('This file is too large to open here.');
    expect(html).not.toContain('<pre');
  });
~~~

Keep the attacker-controlled markup test.
Keep plus/minus gutter tests.
Quiet chrome must still forbid Stage/Edit/Discard/Commit/History/Error:/unsupported/warning glyphs.

- [ ] **Step 2: Verify RED**

Run:

~~~bash
( cd packages/web && bun test src/components/workflows/source-control/file-viewer.test.tsx src/components/workflows/source-control/hex-peek.test.ts )
~~~

Expected: FAIL because the new states and Load more control do not exist.

- [ ] **Step 3: Implement the viewer**

Implement `hex-peek.ts` as a copy of `formatGitHexPeek`.
Update `FileViewerState` and `FileViewer`.
Show `Load more` when `kind === 'text' && truncated` or `kind === 'diff' && response.truncated`.
Show `Cancel` when `kind === 'loading'` or `loadingMore === true`.
Image body is `<img alt="" src={objectUrl} />` plus Download.
Hex body is `<pre><code>{hex}</code></pre>` plus Download.
Download-only copy is exactly `This file is too large to open here.`
Virtualize diff hunks with `useVirtualizer` the same way `changed-files-list.tsx` does, including `initialRect: { width: 0, height: 280 }` and a fallback that renders all hunks when `getVirtualItems()` is empty so `renderToStaticMarkup` tests still see Before/After content.
Do not use `dangerouslySetInnerHTML` for SVG.

- [ ] **Step 4: Verify GREEN**

Run:

~~~bash
( cd packages/web && bun test src/components/workflows/source-control/ )
~~~

Expected: PASS.

- [ ] **Step 5: Commit**

~~~bash
git add packages/web/src/components/workflows/source-control/hex-peek.ts packages/web/src/components/workflows/source-control/hex-peek.test.ts packages/web/src/components/workflows/source-control/file-viewer.tsx packages/web/src/components/workflows/source-control/file-viewer.test.tsx
git commit -m "$(cat <<'EOF'
feat(sc): render paged text, images, hex peeks, and virtualized hunks

Every changed file must open or show a usable fallback without dumping binaries as text.
EOF
)"
~~~

---

### Task 7: Orchestrate Load more, Cancel, and image object URLs in the tab

**Files:**

- Modify: `packages/web/src/components/workflows/source-control/source-control-tab.tsx`

**Interfaces:**

- `loadViewerFile` returns the new viewer kinds.
- Diff fingerprint no longer stringifies the whole hunk array.
- Load more appends text or hunks using the last opaque cursor.
- Image `objectUrl` is revoked on close, selection change, run change, and unmount.

- [ ] **Step 1: Write characterization assertions as mounted tests in Task 8**

This task is the production wiring those tests will exercise.
Do not skip Task 8.

While implementing, keep these invariants in `source-control-tab.tsx`:
- `M` text still calls `getWorkflowRunGitDiff`.
- `M` with `response.binary === true` then calls `getWorkflowRunGitFile(..., 'worktree')` and maps image/hex/download.
- `A` uses `worktree`, `D` uses `head`.
- `.env` text still becomes `kind: 'text'`.
- `viewerFingerprint` for diff is `diff:${file.status}:${file.path}:${response.ref}:${response.binary}:${response.hunks[0]?.header ?? ''}`.
- `viewerFingerprint` for text/image/hex/download uses `contentHash` only.
- Load more uses the current state's cursor and does not dispatch list snapshot actions.
- In-flight Load more sets `loadingMore` and reuses `beginRequest` so Cancel aborts it.
- Download hrefs always include `download=1`.

- [ ] **Step 2: Verify RED via the first new mounted test from Task 8 after writing it**

Write Task 8's Load more test first if desired, then come back.
Expected before wiring: the test cannot find `Load more` or appended text.

- [ ] **Step 3: Implement tab wiring**

Update `loadViewerFile` to map the new client union onto `FileViewerState`.
For images, `URL.createObjectURL(new Blob([bytes], { type: mediaType }))`.
For hex, `formatHexPeek(bytes)`.
Pass `onLoadMore` and `loadingMore` into `FileViewer`.
On Load more for text, fetch with `{ cursor }` and concatenate `text`.
On Load more for diff, fetch with `{ cursor }` and concatenate `hunks`, replacing `cursor` / `truncated` from the new page.
Ignore Load more results when the request id is stale or aborted.
Revoke prior object URLs before creating a new one and on cleanup.

- [ ] **Step 4: Verify GREEN after Task 8 tests exist**

Run the Task 8 command.
Expected: PASS.

- [ ] **Step 5: Commit together with Task 8.**

---

### Task 8: Mounted Load more, binary fallbacks, fingerprint stability, and the lodash spike

**Files:**

- Modify: `packages/web/src/component-integration/source-control-tab.test.tsx`
- Create: `packages/web/src/components/workflows/source-control/large-diff-spike.test.ts`

- [ ] **Step 1: Write the failing mounted tests**

Add helpers next to `binaryFileResponse`:

~~~ts
function presentedFileResponse(
  body: BodyInit,
  hash: string,
  headers: Record<string, string>
): Response {
  return new Response(body, {
    status: 200,
    headers: {
      ETag: `"${hash}"`,
      'X-Archon-Git-Truncated': 'false',
      'X-Archon-Git-Cursor': '',
      'X-Archon-Git-Byte-Length': '1',
      ...headers,
    },
  });
}
~~~

Add tests inside `describe('SourceControlTab')`:

1. Opening a 2500-line added file whose first response is truncated shows `Load more`; clicking it requests the same path with `cursor=` and appends the second page without changing the Changes list.
2. Cancel during Load more aborts that fetch, keeps the first page, and focuses the list only if the operator also closes; Load more Cancel must not clear the first page.
3. A PNG `A` file renders `img` and a `download=1` link, and never `hljs`.
4. A NUL `M` file still avoids Before/After and now shows hex digits plus Download.
5. A download-only response shows `This file is too large to open here.` and Download, with no `<pre>`.
6. Reload that returns the same `contentHash` and first hunk header but a different later hunk page does not show `Changed on disk — Reload` merely because Load more already appended hunks.
7. Opening `.env` still renders highlighted text, proving NFR6 has no denylist.

Update the existing NUL `M` test that expects only `Binary file. Download to inspect.`; hex peek replaces that copy.
Keep the Cancel-on-first-open test.

Create `packages/web/src/components/workflows/source-control/large-diff-spike.test.ts`:

~~~ts
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'fs';
import { join } from 'path';
import { renderToStaticMarkup } from 'react-dom/server';

import type { GitReadyDiffResponse } from '@/lib/api';

import { FileViewer } from './file-viewer';

describe('large-diff spike', () => {
  test('react-diff-view still declares lodash and a 2 MB hunk payload renders', () => {
    const manifest = JSON.parse(
      readFileSync(join(import.meta.dir, '../../../../node_modules/react-diff-view/package.json'), 'utf8')
    ) as { dependencies?: Record<string, string> };
    expect(manifest.dependencies?.lodash).toBeTypeOf('string');

    const line = 'x'.repeat(64);
    const changes = Array.from({ length: 8000 }, (_, index) => ({
      type: 'insert' as const,
      content: line,
      newLine: index + 1,
    }));
    const response: GitReadyDiffResponse = {
      path: 'big.ts',
      status: 'M',
      scope: 'now',
      ref: 'live',
      cursor: '',
      truncated: false,
      binary: false,
      hunks: [
        {
          header: '@@ -0,0 +1,8000 @@',
          oldStart: 0,
          oldLines: 0,
          newStart: 1,
          newLines: 8000,
          changes,
        },
      ],
    };
    const html = renderToStaticMarkup(
      <FileViewer
        state={{ kind: 'diff', file: { path: 'big.ts', status: 'M' }, response }}
        stacked={false}
        onCancel={(): void => undefined}
        onReload={(): void => undefined}
        onClose={(): void => undefined}
      />
    );
    expect(html).toContain('Before');
    expect(html).toContain('After');
    expect(html.length).toBeGreaterThan(1000);
  });
});
~~~

Do not assert a one-second wall clock; virtualization plus this render is the spike evidence that `react-diff-view` stays.

- [ ] **Step 2: Verify RED**

Run:

~~~bash
NODE_ENV=development bun test packages/web/src/component-integration/source-control-tab.test.tsx
( cd packages/web && bun test src/components/workflows/source-control/large-diff-spike.test.ts )
~~~

Expected: FAIL on missing Load more / image / hex behaviors until Task 7 wiring exists.
The spike test may already pass once Task 6 virtualizes hunks; that is acceptable.

- [ ] **Step 3: Finish Task 7 wiring until these tests pass**

- [ ] **Step 4: Verify GREEN**

Run:

~~~bash
( cd packages/web && bun test src/lib/api.git-changes.test.ts )
( cd packages/web && bun test src/components/workflows/source-control/ )
NODE_ENV=development bun test packages/web/src/component-integration/source-control-tab.test.tsx
~~~

Expected: PASS.

- [ ] **Step 5: Commit Task 7 and Task 8 together**

~~~bash
git add packages/web/src/components/workflows/source-control/source-control-tab.tsx packages/web/src/component-integration/source-control-tab.test.tsx packages/web/src/components/workflows/source-control/large-diff-spike.test.ts
git commit -m "$(cat <<'EOF'
feat(sc): open every Now changed file with paging and binary fallbacks

Operators can Load more large text, inspect images inline, and hex-peek other binaries without leaving the run screen.
EOF
)"
~~~

---

### Task 9: Run acceptance gates and update the tracker

**Files:**

- Modify: `_bmad-output/implementation-artifacts/archon-source-control/sprint-status.yaml` only after the gates pass.

- [ ] **Step 1: Run focused evidence**

~~~bash
( cd packages/git && bun test src/viewer-limits.test.ts src/file-read.test.ts )
( cd packages/server && bun test src/routes/api.git-changes.test.ts )
( cd packages/web && bun test src/lib/api.git-changes.test.ts )
( cd packages/web && bun test src/components/workflows/source-control/ )
NODE_ENV=development bun test packages/web/src/component-integration/source-control-tab.test.tsx
~~~

Expected: every command exits 0.

- [ ] **Step 2: Run affected package suites**

~~~bash
( cd packages/git && bun run test )
( cd packages/server && bun run test )
( cd packages/web && bun run test )
~~~

Expected: every command exits 0.

- [ ] **Step 3: Run the repository gate**

~~~bash
bun run validate
git diff --check
~~~

Expected: both commands exit 0.

Do not mark the story done if type-check, lint with zero warnings, formatting, install smoke, generated-file checks, or any package test fails.

- [ ] **Step 4: Inspect scope and dependency invariants**

~~~bash
git diff --name-only
rg -n "from ['\"].*experiments/console|Shiki|Monaco|refractor" packages/web/src/components/workflows/source-control packages/web/src/lib/api.ts
rg -n '"react-diff-view": "3\\.3\\.3"' packages/web/package.json
rg -n "export \\{ fileAt, fileDiff" packages/git/src/index.ts
~~~

Expected: only planned files appear, the forbidden import search has no match, `react-diff-view` remains exactly 3.3.3, and `@archon/git` still publishes only `fileAt` and `fileDiff` as file I/O.
Confirm no database, environment, process, package, write control, History region, polling, or denylist was added.

- [ ] **Step 5: Confirm the acceptance matrix**

| Criterion | Evidence |
| --- | --- |
| First paint is about 256 KB or 2,000 lines | `viewer-limits` tests and real-git view paging |
| Load more fetches the rest with an opaque cursor | HTTP, client, and mounted tab tests |
| `M` sends hunks plus 3 lines of context, not the whole file | `fileDiff` argv and paging tests |
| Files above about 1 MB are not fetched whole in one viewer GET | first-paint paging plus `VIEWER_STREAM_BYTES` constant |
| Files above about 50 MB are download-only in the viewer | `chooseGitFilePresentation`, lstat-size test, mounted download-only test |
| PNG JPEG GIF WEBP SVG render inline | sniff tests, HTTP image headers, mounted `img` test |
| Other binaries are hex peek plus Download, never highlighted text | hex tests and updated NUL `M` mounted test |
| Lists and diffs virtualize | existing list tests plus virtualized DiffPanes and large-diff spike |
| Lodash runtime of `react-diff-view` is counted | large-diff spike reads `react-diff-view/package.json` |
| No polling and no server git-result cache | unchanged query flags and no new cache module |
| NFR6 has no denylist | mounted `.env` still opens as text |
| CAP-6, containment, and quiet copy still hold | existing HTTP and viewer tests |
| No new public git I/O export | index.ts inspection |

- [ ] **Step 6: Perform the legacy-screen manual check**

Run:

~~~bash
bun run dev
~~~

Open an existing DAG run with a live host checkout at `/legacy/workflows/runs/:id`.
Open a large text file and confirm first paint plus Load more.
Open a PNG or JPEG and confirm it renders inline.
Open a NUL binary and confirm hex plus Download, with no highlighted dump.
Confirm Cancel still aborts an in-flight open.
Confirm Reload still freezes the open view until `Changed on disk — Reload` is accepted.
Confirm `.env` still opens.
Stop only the processes started for this check.
If no suitable live run exists, record that limitation in PR Validation and do not fabricate a run, but all automated gates must still pass.

- [ ] **Step 7: Update exactly one tracker value**

In `_bmad-output/implementation-artifacts/archon-source-control/sprint-status.yaml`, change only:

~~~yaml
  1-3-open-every-changed-file: backlog
~~~

to:

~~~yaml
  1-3-open-every-changed-file: done
~~~

Keep Epic 1 `in-progress` until a later retrospective.
Do not rewrite `last_updated` unless the calendar day changed.

- [ ] **Step 8: Commit the tracker update**

~~~bash
git add _bmad-output/implementation-artifacts/archon-source-control/sprint-status.yaml
git commit -m "chore(sc): mark open-every-changed-file story done"
~~~

## Out of Scope

- Epic 2 History, commit log, per-commit file lists, commit OIDs, and lane graph.
- CAP-8 durable snapshot writing.
- Container overlay reads.
- Secret redaction.
- A new public git stream API.
- Persisted split sizes.
- A Source Control tab model for sequential non-DAG runs.

## Pull Request Handoff

Before opening a pull request, rerun `bun run validate` and copy `.github/pull_request_template.md` into the PR body.
Target `dev`, never `main`.
Keep Problem and outcome, Review guidance, Solution, and Validation, and delete unused conditional sections and every instructional comment.
Record focused RED and GREEN evidence, full validation, the manual check or its explicit live-run limitation, image/hex/download-only behavior, paging, and the lodash spike.
Link the issue with `Closes #77`.
Do not close the issue separately.
