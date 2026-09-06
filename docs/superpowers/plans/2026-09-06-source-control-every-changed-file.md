# Open Every Changed File Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.
> Steps use checkbox (<code>- [ ]</code>) syntax for tracking.

**Goal:** Let an operator open every Now changed file in the existing shared viewer with bounded first paint, Load more, cancellable reads, inline images, a hex peek for ordinary binaries, and streamed downloads.

**Architecture:** <code>@archon/git</code> owns one build-time cutoff table, version-bound opaque cursors, bounded worktree/blob reads, streamed downloads, media classification, and streamed hunk pagination.
The server remains the CAP-6 gate and serializer, while the web app appends opaque pages, keeps the displayed snapshot frozen, renders image bytes through a revoking object URL, and virtualizes accumulated diff hunks.

**Tech Stack:** Bun 1.3, strict TypeScript, Node <code>execFile</code>/<code>spawn</code> argv arrays and Web Streams, Hono OpenAPI, Zod from <code>@hono/zod-openapi</code>, React 19, TanStack Query 5, <code>@tanstack/react-virtual</code> 3, <code>highlight.js</code> 11, <code>react-diff-view</code> 3.3.3, and Bun tests.

**Spec:** <code>_bmad-output/planning-artifacts/epics-source-control/epics.md</code>, Story 1.3.

**Canonical design:** <code>_bmad-output/specs/spec-archon-source-control/SPEC.md</code> CAP-7, <code>_bmad-output/specs/spec-archon-source-control/viewer-rules.md</code>, and <code>_bmad-output/planning-artifacts/architecture/architecture-Archon-source-control-2026-09-05/ARCHITECTURE-SPINE.md</code> AD-2 through AD-5.

**Companion decisions:** <code>_bmad-output/specs/spec-archon-source-control/brownfield.md</code> and <code>_bmad-output/planning-artifacts/epics-source-control/implementation-readiness-report-2026-09-06.md</code>.

**Issue:** GitHub issue #77, tracker key <code>1-3-open-every-changed-file</code>.

**Depends on:** Story 1.2 is <code>done</code> in <code>_bmad-output/implementation-artifacts/archon-source-control/sprint-status.yaml</code>.

## Global Constraints

- Story 1.3 is Now-only and must not add History, log records, commit lists, client-supplied tree-ish values, or commit OIDs to HTTP.
- The surface remains <code>/legacy/workflows/runs/:id</code>, and no file under <code>packages/web/src/experiments/console/</code> may be imported or modified.
- The client sends only <code>runId</code>, a server-issued git-relative path, <code>source=worktree|head</code>, an opaque cursor when non-empty, and <code>download=1</code> for a download link.
- The server resolves <code>workflow_runs.working_path</code>; it never accepts an absolute checkout path and never reconstructs one from isolation metadata.
- Every git invocation uses an argv array through <code>execFileAsync</code>, <code>execFileBufferAsync</code>, or an internal <code>spawn</code> wrapper; shell-string <code>exec</code> and <code>oid:path</code> are forbidden.
- Tree reads use <code>git --literal-pathspecs ls-tree -z TREE -- PATH</code>, <code>git cat-file -s BLOB_OID</code>, and <code>git cat-file blob BLOB_OID</code>.
- A live candidate is realpathed and must remain under the already-realpathed checkout before a handle is opened.
- The opened worktree handle must still match the lstat identity and metadata before its bytes or stream are returned.
- Existing empty, NUL, absolute, Windows drive/UNC, <code>.git</code>, decoded <code>..</code>, symlink-escape, and special-filename behavior must remain covered.
- JSON routes use <code>registerOpenApiRoute(createRoute({...}), handler)</code>.
- The raw wildcard file route remains <code>app.get</code> because OpenAPI 3.0 cannot represent the wildcard and successful responses are not JSON.
- Auth remains the global <code>/api/*</code> gate with no <code>requireWebUser</code> call and no per-run owner ACL.
- CAP-6 remains HTTP 200 JSON with <code>{ emptyReason: "container" | "no_checkout" }</code> and no ETag or presentation headers.
- A ready Now diff keeps <code>scope: "now"</code>, <code>ref: "live"</code>, <code>status: "M"</code>, and three context lines.
- Added files use raw <code>source=worktree</code>, deleted files use raw <code>source=head</code>, and modified files use diff hunks unless <code>fileFallback</code> directs the web to raw <code>source=worktree</code>.
- Modified SVG, other images, NUL binaries, and files over the download-only threshold must set <code>fileFallback: true</code>; <code>binary</code> remains the actual NUL heuristic and must not be overloaded to mean “use the raw route.”
- First-paint and subsequent text/hunk pages use the same approximate 256 KiB or 2,000-line budget.
- All files larger than 1 MiB are cancellable without a whole-file server buffer; text uses bounded pages, images use a streamed response body, diffs use a spawned incremental parser, and downloads stream.
- Every file larger than 50 MiB is download-only, including non-image binaries; the unqualified download-only acceptance criterion takes precedence over the hex-peek criterion.
- Images are sniffed before NUL classification so PNG, JPEG, GIF, WEBP, and SVG reach the inline image branch.
- A non-image NUL binary at or below 50 MiB returns at most the first 4 KiB for the web-local hex formatter.
- No viewer GET may buffer a complete file or blob larger than the body it is allowed to return.
- Default <code>fileAt</code> full intent remains only for backward-compatible package callers and tests; the server must use <code>view</code> or <code>download</code>.
- Opaque cursors are version-bound and route-specific so a file cursor cannot be used as a hunk cursor and a changed live file cannot be appended to an older page.
- The web never decodes a cursor and appends it only when non-empty.
- A stale page cursor maps to HTTP 409 <code>{ error: "File changed" }</code>; the web keeps painted content and runs the existing manual Reload comparison.
- Invalid cursors map to HTTP 400 <code>{ error: "Invalid file cursor" }</code>.
- Load more must not dispatch list-snapshot actions or create <code>Changed on disk — Reload</code> merely because the displayed viewer accumulated pages.
- Cancel during the first open closes the viewer as Story 1.2 does; Cancel during Load more aborts only that page and keeps painted content.
- The list and painted content stay frozen until the operator accepts <code>Changed on disk — Reload</code>.
- Syntax highlighting stays on installed <code>highlight.js</code>.
- Do not add Shiki, Monaco, refractor, a sanitizer, another diff library, or any production dependency.
- Diff hunks use <code>@tanstack/react-virtual</code> with the existing 280-pixel initial-rect fallback pattern.
- Image bytes render only through <code>Blob</code>, <code>URL.createObjectURL</code>, and <code>&lt;img&gt;</code>; never mount SVG markup into the DOM.
- Object URLs are revoked when their bytes change and when the image component unmounts.
- Pino events use <code>domain.action_state</code>, pair started with completed or failed, and never log checkout paths, remotes, file contents, file paths, cursors, or path-bearing errors.
- Failure logs contain only <code>runId</code> and a stable <code>errorType</code>.
- User copy remains terse and must not add <code>Error:</code>, <code>unsupported</code>, or warning glyphs.
- NFR6 remains accepted, so <code>.env</code> opens as text and no redaction or denylist is added.
- No new public git I/O function is added; <code>fileAt</code> and <code>fileDiff</code> remain the pair exported from <code>@archon/git</code>.
- Type-only additions to the existing <code>fileAt</code>/<code>fileDiff</code> contract are exported from <code>packages/git/src/index.ts</code>.
- Keep the three git HTTP routes in the isolated <code>packages/server/src/routes/api.git-changes.test.ts</code> process.
- Keep mounted Source Control behavior in the isolated <code>packages/web/src/component-integration/source-control-tab.test.tsx</code> process.
- Every production behavior follows RED, verified RED, minimal GREEN, verified GREEN, and refactor only while green.
- Run command blocks from the repository root and use a subshell for package-local commands.
- Never run an unscoped <code>bun test</code> from the repository root.
- Do not mark the tracker done before focused tests, affected package suites, the performance spike, <code>bun run validate</code>, <code>git diff --check</code>, and manual acceptance pass.
- Every full Markdown sentence in this plan stays on one physical line.

---

## File Structure

- Create <code>packages/git/src/viewer-limits.ts</code> for the one cutoff table, route-specific versioned cursors, media sniffing, presentation selection, and UTF-8-safe text page boundaries.
- Create <code>packages/git/src/viewer-limits.test.ts</code> for cursor, classification, boundary, line-limit, byte-limit, and Unicode behavior.
- Create <code>packages/git/src/git-stream.ts</code> for internal abortable git-stdout prefix and Web Stream adapters.
- Create <code>packages/git/src/diff-page.ts</code> for incremental unified-diff parsing and hunk-page accumulation.
- Create <code>packages/git/src/diff-page.test.ts</code> for exact hunk parsing and page budgets.
- Modify <code>packages/git/src/file-read.ts</code> for bounded view reads, streamed downloads/images, version checks, raw fallbacks for modified files, and streamed diff pages.
- Modify <code>packages/git/src/file-read.test.ts</code> for real-repository paging, streaming, fallback, cancellation, cursor, containment, and special-path coverage.
- Modify <code>packages/git/src/index.ts</code> to export the expanded types but no new I/O function.
- Modify <code>packages/server/src/routes/schemas/git.schemas.ts</code> to add <code>fileFallback</code> to ready diff responses.
- Modify <code>packages/server/src/routes/git/diff-route.ts</code> to document the new HTTP 409 response.
- Modify <code>packages/server/src/routes/git/diff-handler.ts</code> to forward cursor and request cancellation and map cursor errors.
- Modify <code>packages/server/src/routes/git/file-handler.ts</code> to select view/download intent, forward cancellation, and serialize bytes or streams with presentation headers.
- Modify <code>packages/server/src/routes/api.git-changes.test.ts</code> for diff fallback, cursors, 409, stream bodies, headers, and download behavior.
- Regenerate <code>packages/web/src/lib/api.generated.d.ts</code> because the OpenAPI diff schema and response set change.
- Modify <code>packages/web/src/lib/api.ts</code> and <code>packages/web/src/lib/api.git-changes.test.ts</code> for paged text, image bytes, hex bytes, download-only metadata, and raw response validation.
- Create <code>packages/web/src/components/workflows/source-control/hex-peek.ts</code> and <code>hex-peek.test.ts</code> for the only hex formatter.
- Create <code>packages/web/src/components/workflows/source-control/inline-image.tsx</code> for object-URL ownership and cleanup.
- Create <code>packages/web/src/components/workflows/source-control/inline-image.test.tsx</code> for object-URL replacement and unmount cleanup.
- Create <code>packages/web/src/components/workflows/source-control/virtualized-diff.tsx</code> for independent virtualized Before and After panes.
- Modify <code>packages/web/src/components/workflows/source-control/file-viewer.tsx</code> and <code>file-viewer.test.tsx</code> for the new viewer states and controls.
- Modify <code>packages/web/src/components/workflows/source-control/source-control-tab.tsx</code> for state mapping, append-only page loads, cancellation, stale cursors, and stable Reload fingerprints.
- Modify <code>packages/web/src/component-integration/source-control-tab.test.tsx</code> for mounted paging, cancellation, image cleanup, fallback, virtualization, and Reload behavior.
- Create <code>packages/web/src/component-integration/source-control-large-diff-spike.tsx</code> for the approved 2 MiB, one-second, lodash-inclusive spike.
- Modify <code>_bmad-output/implementation-artifacts/archon-source-control/sprint-status.yaml</code> only after all acceptance gates pass.
- Do not modify <code>packages/web/src/components/workflows/WorkflowExecution.tsx</code>, any console experiment, a database schema, a package manifest, or <code>bun.lock</code>.

## Locked Contracts

The only numeric cutoff module defines these build-time defaults.

~~~ts
export const VIEWER_FIRST_PAINT_BYTES = 256 * 1024;
export const VIEWER_FIRST_PAINT_LINES = 2000;
export const VIEWER_STREAM_BYTES = 1024 * 1024;
export const VIEWER_DOWNLOAD_ONLY_BYTES = 50 * 1024 * 1024;
export const VIEWER_HEX_PEEK_BYTES = 4 * 1024;
export const VIEWER_BINARY_PROBE_BYTES = 8 * 1024;
export const VIEWER_DIFF_CONTEXT_LINES = 3;
~~~

The opaque cursor payload is internal and remains unpadded base64url JSON.

~~~ts
type ViewerCursorAxis = 'o' | 'h';
type ViewerCursorPayload =
  | { o: number; v: string }
  | { h: number; v: string };

class ViewerCursorError extends Error {
  readonly code: 'invalid' | 'stale';
}

function encodeViewerCursor(axis: ViewerCursorAxis, value: number, version: string): string;
function decodeViewerCursor(
  cursor: string,
  axis: ViewerCursorAxis,
  currentVersion: string
): number;
~~~

An empty cursor decodes to zero.
Non-empty cursors must contain exactly the requested axis plus a 64-lowercase-hex version, and the numeric value must be a non-negative safe integer.
Malformed base64url, padding, non-canonical encoding, extra or missing fields, the wrong axis, and invalid numbers are <code>invalid</code>.
A valid cursor whose version differs from the current file or diff version is <code>stale</code>.

The public git data contract becomes:

~~~ts
export type GitFilePresentation = 'text' | 'image' | 'hex' | 'download';
export type FileAtIntent = 'full' | 'view' | 'download';

export type FileAtRequest =
  | { intent?: 'full'; cursor?: never; signal?: AbortSignal }
  | { intent: 'view'; cursor?: string; signal?: AbortSignal }
  | { intent: 'download'; cursor?: never; signal?: AbortSignal };

interface FileAtMetadata {
  path: string;
  binary: boolean;
  contentHash: string;
  byteLength: number;
  truncated: boolean;
  cursor: string;
  presentation: GitFilePresentation;
  mediaType: string;
}

export interface FileAtBytesResult extends FileAtMetadata {
  delivery: 'bytes';
  bytes: Uint8Array;
}

export interface FileAtStreamResult extends FileAtMetadata {
  delivery: 'stream';
  stream: ReadableStream<Uint8Array>;
}

export type FileAtResult = FileAtBytesResult | FileAtStreamResult;

export interface FileDiffRequest {
  cursor?: string;
  signal?: AbortSignal;
}

export interface FileDiffResult {
  path: string;
  status: 'M';
  scope: 'now';
  ref: 'live';
  hunks: DiffHunk[];
  cursor: string;
  truncated: boolean;
  binary: boolean;
  fileFallback: boolean;
}

export function fileAt(
  workingPath: RepoPath | WorktreePath,
  relativePath: string,
  source: FileAtSource,
  request?: { intent?: 'full'; cursor?: never; signal?: AbortSignal }
): Promise<FileAtBytesResult>;
export function fileAt(
  workingPath: RepoPath | WorktreePath,
  relativePath: string,
  source: FileAtSource,
  request: { intent: 'download'; cursor?: never; signal?: AbortSignal }
): Promise<FileAtStreamResult>;
export function fileAt(
  workingPath: RepoPath | WorktreePath,
  relativePath: string,
  source: FileAtSource,
  request: { intent: 'view'; cursor?: string; signal?: AbortSignal }
): Promise<FileAtResult>;
export function fileAt(
  workingPath: RepoPath | WorktreePath,
  relativePath: string,
  source: FileAtSource,
  request?: FileAtRequest
): Promise<FileAtResult>;

export function fileDiff(
  workingPath: RepoPath | WorktreePath,
  relativePath: string,
  request?: FileDiffRequest
): Promise<FileDiffResult>;
~~~

Default/full <code>fileAt</code> returns <code>delivery: "bytes"</code> with all bytes to preserve the existing package contract.
View intent returns bounded bytes for text/hex/download-only metadata, bytes for images up to 1 MiB, and a stream for images above 1 MiB through 50 MiB.
Download intent returns <code>delivery: "stream"</code> from byte zero and never accepts or applies a page cursor.
Worktree <code>contentHash</code> is SHA-256 of source kind, device, inode, mode, size, mtime in nanoseconds, and ctime in nanoseconds from a bigint lstat that is rechecked on the opened handle.
Tree <code>contentHash</code> is SHA-256 of source kind, blob OID, and blob byte length.
Text pages read at most 256 KiB plus three UTF-8 boundary bytes and stop earlier after the 2,000th newline.
Text page boundaries never split a UTF-8 code point, and concatenating every page reproduces the original decoded text.
Hunk page size is the UTF-8 byte length of each hunk’s JSON plus its change count; the first selected hunk is never split even when it alone exceeds a budget.
Hunk parsing is incremental, kills the child after the first hunk that does not fit, and never uses <code>execFile</code> buffering for the diff body.

Presentation selection is unambiguous.

1. A file larger than 50 MiB is <code>download</code> without reading a probe.
2. At or below 50 MiB, PNG, JPEG, GIF87a/GIF89a, RIFF/WEBP, or an SVG prefix is <code>image</code>.
3. At or below 50 MiB, a NUL in the first 8 KiB is <code>hex</code>.
4. Every other file is <code>text</code>.

SVG sniffing ignores a UTF-8 BOM and leading whitespace, accepts <code>&lt;svg</code>, or accepts an XML declaration followed by <code>&lt;svg</code> within the 8 KiB probe.
SVG bytes are never inserted with <code>dangerouslySetInnerHTML</code>.

The ready diff JSON adds <code>fileFallback: boolean</code>.
The web follows the raw worktree route when <code>fileFallback</code> is true.

The raw route is <code>GET /api/workflows/runs/:runId/git/file/*?source=worktree|head&amp;cursor=OPAQUE_OPTIONAL&amp;download=1_OPTIONAL</code>.
Successful raw responses keep a quoted 64-hex ETag and add these headers.

- <code>X-Archon-Git-Byte-Length: DECIMAL_FULL_SIZE</code>
- <code>X-Archon-Git-Truncated: true|false</code>
- <code>X-Archon-Git-Cursor: OPAQUE_OR_EMPTY</code>
- <code>X-Archon-Git-Presentation: text|image|hex|download</code>
- <code>X-Archon-Git-Media-Type: IMAGE_MEDIA_TYPE_OR_EMPTY</code>

Text uses <code>text/plain; charset=utf-8</code>, image uses the sniffed image media type, and hex/download use <code>application/octet-stream</code>.
Only <code>download=1</code> and a download-only view set <code>Content-Disposition: attachment; filename="download"</code>.
A streamed download also sets <code>Content-Length</code> to the full byte length.

The web raw-file union is:

~~~ts
export type GitFileClientResult =
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

The viewer states carry the page cursor and a first-page Reload fingerprint.

~~~ts
export type FileViewerState =
  | { kind: 'idle' }
  | { kind: 'loading'; file: GitChangedFile }
  | {
      kind: 'diff';
      file: GitChangedFile;
      response: GitReadyDiffResponse;
      reloadFingerprint: string;
    }
  | {
      kind: 'text';
      file: GitChangedFile;
      text: string;
      contentHash: string;
      truncated: boolean;
      cursor: string;
    }
  | {
      kind: 'image';
      file: GitChangedFile;
      contentHash: string;
      bytes: Uint8Array;
      mediaType: string;
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
~~~

For a truncated first diff page, <code>reloadFingerprint</code> is its opaque version-bound cursor.
For a complete first diff page, <code>reloadFingerprint</code> is the JSON of that complete response.
Appending pages never changes <code>reloadFingerprint</code>.

## Open Questions

None.
The canonical acceptance criteria resolve image-before-NUL and the unqualified greater-than-50-MiB download-only rule, while AD-3 and CAP-7 require streamed rather than buffered downloads.

---

### Task 1: Add the cutoff, cursor, media, and text-page rules

**Files:**

- Create: <code>packages/git/src/viewer-limits.ts</code>
- Create: <code>packages/git/src/viewer-limits.test.ts</code>

**Interfaces:**

- Produces the seven constants and the cursor, classification, and text-page contracts in Locked Contracts.
- Consumes no production code outside the standard library.

- [ ] **Step 1: Write failing behavior tests**

Create <code>packages/git/src/viewer-limits.test.ts</code> with literal boundary values rather than assertions that merely restate exported constants.

~~~ts
import { describe, expect, test } from 'bun:test';

import {
  ViewerCursorError,
  chooseGitFilePresentation,
  decodeViewerCursor,
  encodeViewerCursor,
  sliceTextPage,
} from './viewer-limits';

const VERSION = 'a'.repeat(64);
const FILE_CURSOR =
  'eyJvIjo0MDk2LCJ2IjoiYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYSJ9';

describe('viewer cursors', () => {
  test('encodes a canonical route-specific versioned file cursor', () => {
    expect(encodeViewerCursor('o', 4096, VERSION)).toBe(FILE_CURSOR);
    expect(decodeViewerCursor(FILE_CURSOR, 'o', VERSION)).toBe(4096);
    expect(decodeViewerCursor('', 'o', VERSION)).toBe(0);
  });

  test('rejects a hunk cursor on the file route and rejects extra fields', () => {
    const hunk = Buffer.from('{"h":2,"v":"' + VERSION + '"}', 'utf8').toString('base64url');
    const extra = Buffer.from('{"o":2,"v":"' + VERSION + '","x":1}', 'utf8').toString('base64url');
    expect(() => decodeViewerCursor(hunk, 'o', VERSION)).toThrow(ViewerCursorError);
    expect(() => decodeViewerCursor(extra, 'o', VERSION)).toThrow(ViewerCursorError);
  });

  test('distinguishes malformed and stale cursors', () => {
    try {
      decodeViewerCursor('not+base64url', 'o', VERSION);
      expect.unreachable('expected invalid cursor');
    } catch (error) {
      expect(error).toMatchObject({ name: 'ViewerCursorError', code: 'invalid' });
    }
    try {
      decodeViewerCursor(FILE_CURSOR, 'o', 'b'.repeat(64));
      expect.unreachable('expected stale cursor');
    } catch (error) {
      expect(error).toMatchObject({ name: 'ViewerCursorError', code: 'stale' });
    }
  });
});

describe('text first paint', () => {
  test('stops after exactly 2000 newline-terminated lines', () => {
    const raw = Array.from({ length: 2001 }, (_unused, index) => 'L' + String(index) + '\n').join('');
    const page = sliceTextPage(Buffer.from(raw, 'utf8'), false);
    expect(Buffer.from(page.bytes).toString('utf8').endsWith('L1999\n')).toBe(true);
    expect(Buffer.from(page.bytes).toString('utf8')).not.toContain('L2000\n');
    expect(page.truncated).toBe(true);
  });

  test('never exceeds 262144 bytes and does not split a UTF-8 code point', () => {
    const raw = 'x'.repeat(262143) + '🙂tail';
    const page = sliceTextPage(Buffer.from(raw, 'utf8'), false);
    expect(page.bytes.byteLength).toBeLessThanOrEqual(262144);
    expect(Buffer.from(page.bytes).toString('utf8')).not.toContain('�');
    expect(page.consumedBytes).toBeGreaterThan(0);
    expect(page.truncated).toBe(true);
  });

  test('returns every byte of a short final page', () => {
    const page = sliceTextPage(Buffer.from('one\ntwo\n', 'utf8'), false);
    expect(Buffer.from(page.bytes).toString('utf8')).toBe('one\ntwo\n');
    expect(page.consumedBytes).toBe(8);
    expect(page.truncated).toBe(false);
  });
});

describe('presentation selection', () => {
  test('makes every file above 52428800 bytes download-only before probing', () => {
    expect(chooseGitFilePresentation(52428801, new Uint8Array([0]))).toEqual({
      presentation: 'download',
      binary: false,
      mediaType: '',
    });
  });

  test('detects each approved image before applying the NUL heuristic', () => {
    const cases: Array<[Uint8Array, string]> = [
      [Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]), 'image/png'],
      [Uint8Array.from([0xff, 0xd8, 0xff, 0]), 'image/jpeg'],
      [Buffer.from('GIF89a\0', 'binary'), 'image/gif'],
      [Buffer.from('RIFF0000WEBP\0', 'binary'), 'image/webp'],
      [Buffer.from('\uFEFF  <?xml version="1.0"?>\\n<svg></svg>', 'utf8'), 'image/svg+xml'],
    ];
    for (const [bytes, mediaType] of cases) {
      expect(chooseGitFilePresentation(bytes.byteLength, bytes)).toEqual({
        presentation: 'image',
        binary: bytes.includes(0),
        mediaType,
      });
    }
  });

  test('classifies an ordinary NUL payload as hex and ordinary UTF-8 as text', () => {
    expect(chooseGitFilePresentation(3, Uint8Array.from([1, 0, 2])).presentation).toBe('hex');
    expect(chooseGitFilePresentation(6, Buffer.from('hello\n')).presentation).toBe('text');
  });
});
~~~

- [ ] **Step 2: Verify RED**

Run:

~~~bash
( cd packages/git && bun test src/viewer-limits.test.ts )
~~~

Expected: FAIL because <code>viewer-limits.ts</code> does not exist.
Fix syntax/setup errors until the tests fail only for the missing production module.

- [ ] **Step 3: Implement the minimal pure rules**

Create <code>packages/git/src/viewer-limits.ts</code> with the Locked Contracts signatures.
Use <code>Buffer.byteLength</code> for UTF-8 budgets, validate canonical base64url by decoding and re-encoding, validate exact own keys, and use a byte boundary at or before byte 262144 that excludes an incomplete UTF-8 suffix.
Use the 2,000th newline boundary before the byte boundary when it exists.

~~~ts
export interface TextPage {
  bytes: Uint8Array;
  consumedBytes: number;
  truncated: boolean;
}

export interface GitFileClassification {
  presentation: GitFilePresentation;
  binary: boolean;
  mediaType: string;
}

export function sliceTextPage(window: Uint8Array, hasBytesAfterWindow: boolean): TextPage;
export function chooseGitFilePresentation(
  byteLength: number,
  probe: Uint8Array
): GitFileClassification;
~~~

- [ ] **Step 4: Verify GREEN**

Run:

~~~bash
( cd packages/git && bun test src/viewer-limits.test.ts )
( cd packages/git && bun run type-check )
~~~

Expected: PASS with no warning.

- [ ] **Step 5: Commit**

~~~bash
git add packages/git/src/viewer-limits.ts packages/git/src/viewer-limits.test.ts
git commit -m "feat(sc): add bounded viewer rules and cursors"
~~~

---

### Task 2: Make file views bounded and downloads abortable streams

**Files:**

- Create: <code>packages/git/src/git-stream.ts</code>
- Modify: <code>packages/git/src/file-read.ts</code>
- Modify: <code>packages/git/src/file-read.test.ts</code>
- Modify: <code>packages/git/src/index.ts</code>

**Interfaces:**

- Consumes the viewer rules from Task 1.
- Produces <code>FileAtRequest</code>, <code>FileAtResult</code>, <code>FileAtBytesResult</code>, <code>FileAtStreamResult</code>, <code>GitFilePresentation</code>, and the new <code>fileAt</code> behavior in Locked Contracts.
- Keeps <code>git-stream.ts</code> internal to the package.

- [ ] **Step 1: Add failing real-file and real-blob tests**

In <code>packages/git/src/file-read.test.ts</code>, add <code>open</code> and <code>truncate</code> to the existing <code>fs/promises</code> import and append these tests inside the existing real-repository describe.

~~~ts
test('view pages a 2500-line worktree file and reconstructs it through opaque cursors', async () => {
  const expected = Array.from({ length: 2500 }, (_unused, index) => 'line-' + String(index) + '\n').join('');
  await writeFile(join(repoPath, 'big.txt'), expected);
  const chunks: string[] = [];
  let cursor = '';
  do {
    const page = await fileAt(
      toWorktreePath(repoPath),
      'big.txt',
      { kind: 'worktree' },
      { intent: 'view', cursor }
    );
    expect(page.delivery).toBe('bytes');
    if (page.delivery !== 'bytes') throw new Error('Expected bytes');
    chunks.push(Buffer.from(page.bytes).toString('utf8'));
    cursor = page.cursor;
    if (!page.truncated) break;
    expect(cursor.length).toBeGreaterThan(0);
  } while (true);
  expect(chunks.join('')).toBe(expected);
});

test('view pages a tree blob without corrupting a boundary emoji', async () => {
  const expected = 'x'.repeat(262143) + '🙂tail\n';
  await writeFile(join(repoPath, 'emoji.txt'), expected);
  await exec.execFileAsync('git', ['-C', repoPath, 'add', 'emoji.txt']);
  await exec.execFileAsync('git', ['-C', repoPath, 'commit', '-m', 'emoji']);
  const first = await fileAt(
    toWorktreePath(repoPath),
    'emoji.txt',
    { kind: 'tree', treeIsh: 'HEAD' },
    { intent: 'view' }
  );
  expect(first.delivery).toBe('bytes');
  if (first.delivery !== 'bytes') throw new Error('Expected bytes');
  const second = await fileAt(
    toWorktreePath(repoPath),
    'emoji.txt',
    { kind: 'tree', treeIsh: 'HEAD' },
    { intent: 'view', cursor: first.cursor }
  );
  expect(second.delivery).toBe('bytes');
  if (second.delivery !== 'bytes') throw new Error('Expected bytes');
  expect(Buffer.concat([Buffer.from(first.bytes), Buffer.from(second.bytes)]).toString('utf8')).toBe(expected);
});

test('view returns only 4096 bytes for a non-image NUL blob', async () => {
  const result = await fileAt(
    toWorktreePath(repoPath),
    'nul-1mb.bin',
    { kind: 'tree', treeIsh: 'HEAD' },
    { intent: 'view' }
  );
  expect(result.delivery).toBe('bytes');
  if (result.delivery !== 'bytes') throw new Error('Expected bytes');
  expect(result.presentation).toBe('hex');
  expect(result.binary).toBe(true);
  expect(result.bytes.byteLength).toBe(4096);
  expect(result.byteLength).toBe(1_048_577);
  expect(result.truncated).toBe(false);
  expect(result.cursor).toBe('');
});

test('view classifies a 52428801-byte sparse worktree file without returning its body', async () => {
  const path = join(repoPath, 'huge.txt');
  await writeFile(path, 'x');
  await truncate(path, 52_428_801);
  const result = await fileAt(
    toWorktreePath(repoPath),
    'huge.txt',
    { kind: 'worktree' },
    { intent: 'view' }
  );
  expect(result.delivery).toBe('bytes');
  if (result.delivery !== 'bytes') throw new Error('Expected bytes');
  expect(result.presentation).toBe('download');
  expect(result.bytes.byteLength).toBe(0);
  expect(result.byteLength).toBe(52_428_801);
});

test('download intent streams a file from byte zero and preserves exact bytes', async () => {
  await writeFile(join(repoPath, 'download.bin'), Uint8Array.from([0, 1, 2, 3]));
  const result = await fileAt(
    toWorktreePath(repoPath),
    'download.bin',
    { kind: 'worktree' },
    { intent: 'download' }
  );
  expect(result.delivery).toBe('stream');
  if (result.delivery !== 'stream') throw new Error('Expected stream');
  expect(new Uint8Array(await new Response(result.stream).arrayBuffer())).toEqual(
    Uint8Array.from([0, 1, 2, 3])
  );
});

test('an image above 1048576 bytes uses an abortable stream instead of a full buffer', async () => {
  const bytes = new Uint8Array(1_048_577);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  await writeFile(join(repoPath, 'large.png'), bytes);
  const controller = new AbortController();
  const result = await fileAt(
    toWorktreePath(repoPath),
    'large.png',
    { kind: 'worktree' },
    { intent: 'view', signal: controller.signal }
  );
  expect(result.delivery).toBe('stream');
  if (result.delivery !== 'stream') throw new Error('Expected stream');
  const reader = result.stream.getReader();
  const first = await reader.read();
  expect(first.value?.byteLength).toBeGreaterThan(0);
  controller.abort();
  await reader.cancel();
});

test('a cursor becomes stale when the live file changes between pages', async () => {
  const path = join(repoPath, 'stale.txt');
  await writeFile(path, 'x\n'.repeat(2500));
  const first = await fileAt(
    toWorktreePath(repoPath),
    'stale.txt',
    { kind: 'worktree' },
    { intent: 'view' }
  );
  await writeFile(path, 'y\n'.repeat(2500));
  await expect(
    fileAt(
      toWorktreePath(repoPath),
      'stale.txt',
      { kind: 'worktree' },
      { intent: 'view', cursor: first.cursor }
    )
  ).rejects.toMatchObject({ name: 'GitFileError', code: 'stale_cursor' });
});
~~~

Keep the existing default full-read test for the 1,048,577-byte NUL fixture and update its result assertion to narrow <code>delivery === "bytes"</code>.
Extend the existing tree-command test to require <code>cat-file -s</code> before <code>cat-file blob</code> and to keep forbidding <code>HEAD:path</code>.

- [ ] **Step 2: Verify RED**

Run:

~~~bash
( cd packages/git && bun test src/file-read.test.ts )
~~~

Expected: FAIL because <code>fileAt</code> has no request argument, metadata, cursor, bounded read, or stream delivery.

- [ ] **Step 3: Add the internal stream adapter**

Create <code>packages/git/src/git-stream.ts</code> with these internal signatures.

~~~ts
export interface GitStreamRequest {
  workingPath: RepoPath | WorktreePath;
  args: string[];
  signal?: AbortSignal;
}

export function streamGitStdout(request: GitStreamRequest): ReadableStream<Uint8Array>;
export async function readGitStdoutWindow(
  request: GitStreamRequest,
  skipBytes: number,
  takeBytes: number
): Promise<Uint8Array>;
~~~

Use <code>spawn('git', ['-C', workingPath, ...args], { stdio: ['ignore', 'pipe', 'pipe'], signal })</code>.
The Web Stream <code>cancel()</code> path must abort or kill the child, and a non-zero exit before intentional cutoff must error the stream without exposing stderr in a public error.
The bounded reader discards <code>skipBytes</code>, collects at most <code>takeBytes</code>, then kills the child intentionally.

- [ ] **Step 4: Implement bounded <code>fileAt</code>**

Refactor <code>packages/git/src/file-read.ts</code> around an internal inspected-source record.

~~~ts
interface InspectedFile {
  path: string;
  byteLength: number;
  contentHash: string;
  readWindow(offset: number, length: number, signal?: AbortSignal): Promise<Uint8Array>;
  stream(signal?: AbortSignal): ReadableStream<Uint8Array>;
}
~~~

For worktree files, use bigint lstat, contain, open, and compare <code>dev</code>, <code>ino</code>, <code>mode</code>, <code>size</code>, <code>mtimeNs</code>, and <code>ctimeNs</code> on the opened handle before returning a reader.
Keep symlink content equal to its link-target bytes.
For tree files, keep the literal <code>ls-tree -z</code> lookup, use <code>cat-file -s</code> for length, and use Task 2’s spawned helpers for bounded windows and streams.
For view intent, inspect size first, return download-only metadata above 50 MiB without a probe, otherwise read at most 8 KiB, classify, and read only the body required by the presentation.
For text, decode the <code>o</code> cursor against <code>contentHash</code>, read at most 256 KiB plus three bytes from that offset, and encode the next offset only when truncated.
For hex, return at most 4 KiB.
For images through 1 MiB, return all bytes; for larger allowed images, return a stream.
For download intent, return a stream and ignore no bytes.
Extend <code>GitFileErrorCode</code> with <code>invalid_cursor</code> and <code>stale_cursor</code> and map <code>ViewerCursorError.code</code> exactly.

- [ ] **Step 5: Export only the expanded data types**

Update the existing file-read export block in <code>packages/git/src/index.ts</code>.

~~~ts
export { fileAt, fileDiff } from './file-read';
export type {
  DiffChange,
  DiffHunk,
  FileAtBytesResult,
  FileAtIntent,
  FileAtRequest,
  FileAtResult,
  FileAtSource,
  FileAtStreamResult,
  FileDiffRequest,
  FileDiffResult,
} from './file-read';
export type { GitFilePresentation } from './viewer-limits';
~~~

Do not export a runtime value from <code>git-stream.ts</code> or <code>viewer-limits.ts</code>, either error class, or any new I/O function from the package root.

- [ ] **Step 6: Verify GREEN**

Run:

~~~bash
( cd packages/git && bun test src/viewer-limits.test.ts src/file-read.test.ts )
( cd packages/git && bun run type-check )
~~~

Expected: PASS, including existing containment, full-byte, textconv, and special-filename tests.

- [ ] **Step 7: Commit**

~~~bash
git add packages/git/src/git-stream.ts packages/git/src/file-read.ts packages/git/src/file-read.test.ts packages/git/src/index.ts
git commit -m "feat(sc): bound file views and stream downloads"
~~~

---

### Task 3: Parse and page Now diffs without buffering the whole diff

**Files:**

- Create: <code>packages/git/src/diff-page.ts</code>
- Create: <code>packages/git/src/diff-page.test.ts</code>
- Modify: <code>packages/git/src/file-read.ts</code>
- Modify: <code>packages/git/src/file-read.test.ts</code>

**Interfaces:**

- Consumes Task 1 cutoffs/cursors and Task 2 source inspection/streaming.
- Produces incremental hunk parsing, <code>FileDiffRequest</code>, and <code>fileFallback</code>.

- [ ] **Step 1: Write failing pure hunk-page tests**

Create <code>packages/git/src/diff-page.test.ts</code>.

~~~ts
import { describe, expect, test } from 'bun:test';

import { HunkPageAccumulator, parseUnifiedDiffChunks } from './diff-page';

describe('incremental diff parsing', () => {
  test('preserves a multibyte line split across stream chunks', async () => {
    const raw = '@@ -1 +1 @@\n-old\n+🙂new\n';
    const bytes = Buffer.from(raw, 'utf8');
    const split = bytes.indexOf(0xf0) + 2;
    const hunks = await parseUnifiedDiffChunks([bytes.subarray(0, split), bytes.subarray(split)]);
    expect(hunks[0]?.changes).toEqual([
      { type: 'delete', content: 'old', oldLine: 1 },
      { type: 'insert', content: '🙂new', newLine: 1 },
    ]);
  });
});

describe('HunkPageAccumulator', () => {
  test('stops before a later hunk that would exceed 2000 changes', () => {
    const pager = new HunkPageAccumulator(0);
    for (let index = 0; index < 3; index += 1) {
      const decision = pager.push({
        header: '@@ -1 +1 @@',
        oldStart: 1,
        oldLines: 900,
        newStart: 1,
        newLines: 900,
        changes: Array.from({ length: 900 }, () => ({
          type: 'normal' as const,
          content: 'x',
          oldLine: 1,
          newLine: 1,
        })),
      });
      if (index < 2) expect(decision).toBe('continue');
      else expect(decision).toBe('page_full');
    }
    expect(pager.result()).toMatchObject({ nextIndex: 2, truncated: true });
    expect(pager.result().hunks).toHaveLength(2);
  });

  test('keeps one oversized first hunk whole', () => {
    const pager = new HunkPageAccumulator(0);
    const decision = pager.push({
      header: '@@ -1 +1 @@',
      oldStart: 1,
      oldLines: 0,
      newStart: 1,
      newLines: 1,
      changes: [{ type: 'insert', content: 'x'.repeat(300_000), newLine: 1 }],
    });
    expect(decision).toBe('continue');
    expect(pager.result().hunks).toHaveLength(1);
  });

  test('stops before a later hunk that would cross 262144 serialized bytes', () => {
    const pager = new HunkPageAccumulator(0);
    const hunk = {
      header: '@@ -1 +1 @@',
      oldStart: 1,
      oldLines: 0,
      newStart: 1,
      newLines: 1,
      changes: [{ type: 'insert' as const, content: 'x'.repeat(140_000), newLine: 1 }],
    };
    expect(pager.push(hunk)).toBe('continue');
    expect(pager.push({ ...hunk, newStart: 2 })).toBe('page_full');
    expect(pager.result().hunks).toHaveLength(1);
    expect(pager.result()).toMatchObject({ nextIndex: 1, truncated: true });
  });
});
~~~

- [ ] **Step 2: Verify pure RED**

Run:

~~~bash
( cd packages/git && bun test src/diff-page.test.ts )
~~~

Expected: FAIL because <code>diff-page.ts</code> does not exist.

- [ ] **Step 3: Implement the incremental parser and accumulator**

Create <code>packages/git/src/diff-page.ts</code>.
Use one streaming <code>TextDecoder</code>, carry an incomplete final line between chunks, reuse the current hunk-header semantics, and emit a completed hunk only when the next header or EOF arrives.
Stop visiting immediately when the callback returns <code>page_full</code>.
Compute hunk bytes with <code>Buffer.byteLength(JSON.stringify(hunk), 'utf8')</code>.
Skip exactly <code>startIndex</code> complete hunks, include the first selected hunk even when oversized, and return <code>page_full</code> before a later hunk that would exceed 262,144 bytes or 2,000 changes.

~~~ts
export type HunkPageDecision = 'continue' | 'page_full';

export interface HunkPageResult {
  hunks: DiffHunk[];
  nextIndex: number;
  truncated: boolean;
}

export class HunkPageAccumulator {
  constructor(startIndex: number);
  push(hunk: DiffHunk): HunkPageDecision;
  finish(): void;
  result(): HunkPageResult;
}

export async function visitUnifiedDiffChunks(
  chunks: Iterable<Uint8Array> | AsyncIterable<Uint8Array>,
  visit: (hunk: DiffHunk) => HunkPageDecision
): Promise<void>;
export async function parseUnifiedDiffChunks(
  chunks: Iterable<Uint8Array> | AsyncIterable<Uint8Array>
): Promise<DiffHunk[]>;
~~~

- [ ] **Step 4: Write failing real-git pagination and fallback tests**

Append to <code>packages/git/src/file-read.test.ts</code>.

~~~ts
test('fileDiff streams many disjoint hunks with -U3 and a hunk cursor', async () => {
  const original = Array.from({ length: 25_000 }, (_unused, index) => 'keep-' + String(index));
  await writeFile(join(repoPath, 'paged.ts'), original.join('\n') + '\n');
  await exec.execFileAsync('git', ['-C', repoPath, 'add', 'paged.ts']);
  await exec.execFileAsync('git', ['-C', repoPath, 'commit', '-m', 'paged']);
  const changed = [...original];
  for (let index = 0; index < changed.length; index += 10) changed[index] = 'changed-' + String(index);
  await writeFile(join(repoPath, 'paged.ts'), changed.join('\n') + '\n');

  const first = await fileDiff(toWorktreePath(repoPath), 'paged.ts');
  expect(first.truncated).toBe(true);
  expect(first.cursor.length).toBeGreaterThan(0);
  expect(first.fileFallback).toBe(false);
  expect(first.hunks.length).toBeGreaterThan(0);

  const second = await fileDiff(toWorktreePath(repoPath), 'paged.ts', { cursor: first.cursor });
  expect(second.hunks[0]?.header).not.toBe(first.hunks[0]?.header);
});

test('fileDiff directs an SVG M file to raw worktree content without calling it binary', async () => {
  await writeFile(join(repoPath, 'image.svg'), '<svg><text>old</text></svg>\n');
  await exec.execFileAsync('git', ['-C', repoPath, 'add', 'image.svg']);
  await exec.execFileAsync('git', ['-C', repoPath, 'commit', '-m', 'svg']);
  await writeFile(join(repoPath, 'image.svg'), '<svg><text>new</text></svg>\n');
  const result = await fileDiff(toWorktreePath(repoPath), 'image.svg');
  expect(result.binary).toBe(false);
  expect(result.fileFallback).toBe(true);
  expect(result.hunks).toEqual([]);
});

test('fileDiff directs a modified file above 52428800 bytes to raw download-only fallback', async () => {
  const path = join(repoPath, 'huge-modified.dat');
  await writeFile(path, 'a');
  await truncate(path, 52_428_801);
  await exec.execFileAsync('git', ['-C', repoPath, 'add', 'huge-modified.dat']);
  await exec.execFileAsync('git', ['-C', repoPath, 'commit', '-m', 'huge modified']);
  const handle = await open(path, 'r+');
  await handle.write(Buffer.from('b'), 0, 1, 0);
  await handle.close();
  const result = await fileDiff(toWorktreePath(repoPath), 'huge-modified.dat');
  expect(result.fileFallback).toBe(true);
  expect(result.hunks).toEqual([]);
});

test('fileDiff rejects a stale hunk cursor after the file changes', async () => {
  const lines = Array.from({ length: 4000 }, (_unused, index) => 'line-' + String(index));
  await writeFile(join(repoPath, 'stale-diff.ts'), lines.join('\n') + '\n');
  await exec.execFileAsync('git', ['-C', repoPath, 'add', 'stale-diff.ts']);
  await exec.execFileAsync('git', ['-C', repoPath, 'commit', '-m', 'stale diff']);
  const changed = [...lines];
  for (let index = 0; index < changed.length; index += 10) changed[index] = 'first-' + String(index);
  await writeFile(join(repoPath, 'stale-diff.ts'), changed.join('\n') + '\n');
  const first = await fileDiff(toWorktreePath(repoPath), 'stale-diff.ts');
  expect(first.truncated).toBe(true);
  await writeFile(join(repoPath, 'stale-diff.ts'), 'different\n'.repeat(4000));
  await expect(
    fileDiff(toWorktreePath(repoPath), 'stale-diff.ts', { cursor: first.cursor })
  ).rejects.toMatchObject({ name: 'GitFileError', code: 'stale_cursor' });
});
~~~

Update every existing <code>FileDiffResult</code> expectation to include <code>fileFallback</code>.
Keep the current NUL test and assert <code>binary: true</code>, <code>fileFallback: true</code>, and no hunks.

- [ ] **Step 5: Verify real-git RED**

Run:

~~~bash
( cd packages/git && bun test src/file-read.test.ts )
~~~

Expected: FAIL because <code>fileDiff</code> still buffers with <code>execFileAsync</code>, ignores requests, and has no <code>fileFallback</code>.

- [ ] **Step 6: Implement streamed <code>fileDiff</code>**

Inspect both worktree and HEAD with bounded probes.
If either side classifies as image, hex, or download, return no hunks with <code>fileFallback: true</code> and keep <code>binary</code> equal to whether either 8-KiB probe contained NUL.
For text, derive a version hash from both inspected source hashes, decode the <code>h</code> cursor, and spawn this exact argv tail.

~~~ts
[
  '--no-optional-locks',
  '--literal-pathspecs',
  'diff',
  '--no-color',
  '--no-ext-diff',
  '--no-textconv',
  '--text',
  '-U3',
  'HEAD',
  '--',
  path,
]
~~~

Feed stdout incrementally into <code>HunkPageAccumulator</code>.
Cancel the git stdout reader after <code>page_full</code> so <code>git-stream.ts</code> kills the child, encode <code>nextIndex</code> with axis <code>h</code>, and return an empty cursor only at EOF.
Forward <code>request.signal</code> so an aborted HTTP request kills the diff child.
Map invalid/stale viewer cursors to the matching <code>GitFileError</code> codes.

- [ ] **Step 7: Verify GREEN**

Run:

~~~bash
( cd packages/git && bun test src/viewer-limits.test.ts src/diff-page.test.ts src/file-read.test.ts )
( cd packages/git && bun run type-check )
~~~

Expected: PASS without a max-buffer error and without running textconv.

- [ ] **Step 8: Commit**

~~~bash
git add packages/git/src/diff-page.ts packages/git/src/diff-page.test.ts packages/git/src/file-read.ts packages/git/src/file-read.test.ts
git commit -m "feat(sc): stream and page Now diff hunks"
~~~

---

### Task 4: Serialize cursors, fallbacks, and streams at the HTTP boundary

**Files:**

- Modify: <code>packages/server/src/routes/schemas/git.schemas.ts</code>
- Modify: <code>packages/server/src/routes/git/diff-route.ts</code>
- Modify: <code>packages/server/src/routes/git/diff-handler.ts</code>
- Modify: <code>packages/server/src/routes/git/file-handler.ts</code>
- Modify: <code>packages/server/src/routes/api.git-changes.test.ts</code>
- Regenerate: <code>packages/web/src/lib/api.generated.d.ts</code>

**Interfaces:**

- Consumes Task 2 and Task 3 git contracts.
- Produces <code>fileFallback</code> in OpenAPI, HTTP 400/409 cursor mapping, raw presentation headers, and streamed bodies.

- [ ] **Step 1: Update test doubles, then write failing HTTP tests**

In <code>packages/server/src/routes/api.git-changes.test.ts</code>, keep <code>FileAtResult</code>, add <code>FileAtBytesResult</code>, <code>FileAtRequest</code>, and <code>FileDiffRequest</code> to the type imports, update <code>mockFileAt</code>/<code>mockFileDiff</code> to accept those request types, add <code>fileFallback: false</code> to diff fixtures, and use this byte-result helper.

~~~ts
function readyFileAt(overrides: Partial<FileAtBytesResult> = {}): FileAtBytesResult {
  return {
    delivery: 'bytes',
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

Append these boundary tests.

~~~ts
test('diff forwards cursor and request cancellation and returns fileFallback', async () => {
  mockFileDiff.mockResolvedValueOnce({
    path: 'image.svg',
    status: 'M',
    scope: 'now',
    ref: 'live',
    hunks: [],
    cursor: '',
    truncated: false,
    binary: false,
    fileFallback: true,
  });
  const response = await makeApp().request(
    '/api/workflows/runs/run-1/git/diff?path=image.svg&cursor=opaque'
  );
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ fileFallback: true });
  expect(mockFileDiff.mock.calls[0]?.[2]).toMatchObject({ cursor: 'opaque' });
  expect(mockFileDiff.mock.calls[0]?.[2]?.signal).toBeInstanceOf(AbortSignal);
});

test('diff maps invalid and stale cursors without logging cursor text', async () => {
  mockFileDiff.mockRejectedValueOnce(namedError('GitFileError', 'invalid_cursor'));
  let response = await makeApp().request(
    '/api/workflows/runs/run-1/git/diff?path=x.ts&cursor=secret-invalid'
  );
  expect(response.status).toBe(400);
  expect(await response.json()).toEqual({ error: 'Invalid file cursor' });
  expect(JSON.stringify(mockLogger.info.mock.calls)).not.toContain('secret-invalid');

  mockLogger.info.mockClear();
  mockLogger.error.mockClear();
  mockFileDiff.mockRejectedValueOnce(namedError('GitFileError', 'stale_cursor'));
  response = await makeApp().request(
    '/api/workflows/runs/run-1/git/diff?path=x.ts&cursor=secret-stale'
  );
  expect(response.status).toBe(409);
  expect(await response.json()).toEqual({ error: 'File changed' });
  expect(JSON.stringify(mockLogger.info.mock.calls)).not.toContain('secret-stale');
});

test('hex view returns bytes and all presentation headers without attachment', async () => {
  mockFileAt.mockResolvedValueOnce(
    readyFileAt({
      path: 'blob.bin',
      bytes: Uint8Array.from([0, 1, 2]),
      binary: true,
      byteLength: 99,
      presentation: 'hex',
    })
  );
  const response = await makeApp().request(
    '/api/workflows/runs/run-1/git/file/blob.bin?source=worktree'
  );
  expect(response.headers.get('Content-Type')).toBe('application/octet-stream');
  expect(response.headers.get('Content-Disposition')).toBeNull();
  expect(response.headers.get('X-Archon-Git-Presentation')).toBe('hex');
  expect(response.headers.get('X-Archon-Git-Byte-Length')).toBe('99');
  expect(new Uint8Array(await response.arrayBuffer())).toEqual(Uint8Array.from([0, 1, 2]));
  expect(mockFileAt.mock.calls.at(-1)?.[3]).toMatchObject({ intent: 'view', cursor: '' });
});

test('download=1 returns a streamed attachment with full Content-Length', async () => {
  const stream = new ReadableStream<Uint8Array>({
    start(controller): void {
      controller.enqueue(Uint8Array.from([0, 1, 2]));
      controller.close();
    },
  });
  mockFileAt.mockResolvedValueOnce({
    delivery: 'stream',
    stream,
    path: 'blob.bin',
    binary: true,
    contentHash: TEXT_HASH,
    byteLength: 3,
    truncated: false,
    cursor: '',
    presentation: 'download',
    mediaType: '',
  });
  const response = await makeApp().request(
    '/api/workflows/runs/run-1/git/file/blob.bin?source=worktree&download=1'
  );
  expect(response.headers.get('Content-Disposition')).toBe('attachment; filename="download"');
  expect(response.headers.get('Content-Length')).toBe('3');
  expect(new Uint8Array(await response.arrayBuffer())).toEqual(Uint8Array.from([0, 1, 2]));
  expect(mockFileAt.mock.calls.at(-1)?.[3]).toMatchObject({ intent: 'download' });
});

test('file route maps stale cursor to 409 and keeps CAP-6 free of presentation headers', async () => {
  mockFileAt.mockRejectedValueOnce(namedError('GitFileError', 'stale_cursor'));
  const stale = await makeApp().request(
    '/api/workflows/runs/run-1/git/file/x.ts?source=worktree&cursor=opaque'
  );
  expect(stale.status).toBe(409);
  expect(await stale.json()).toEqual({ error: 'File changed' });

  mockGetWorkflowRun.mockResolvedValueOnce({ ...runRow(), working_path: null });
  const empty = await makeApp().request(
    '/api/workflows/runs/run-1/git/file/x.ts?source=worktree'
  );
  expect(empty.headers.get('X-Archon-Git-Presentation')).toBeNull();
  expect(empty.headers.get('ETag')).toBeNull();
});
~~~

Update the existing binary attachment test so only <code>download=1</code> expects attachment behavior.

- [ ] **Step 2: Verify RED**

Run:

~~~bash
( cd packages/server && bun test src/routes/api.git-changes.test.ts )
~~~

Expected: FAIL because the routes omit fallback/schema/409 behavior, ignore cursor/signal, and always serialize a buffered full result.

- [ ] **Step 3: Implement schema and handler changes**

Add <code>fileFallback: z.boolean()</code> to <code>gitReadyDiffResponseSchema</code>.
Add a 409 <code>errorSchema</code> response to <code>gitDiffRoute</code>.
Change both handler callback status unions to include 409.
Pass <code>{ cursor: c.req.query('cursor') ?? '', signal: c.req.raw.signal }</code> to <code>fileDiff</code>.
Call <code>fileAt</code> with <code>{ intent: 'download', signal }</code> only for <code>download=1</code>, otherwise with <code>{ intent: 'view', cursor, signal }</code>.
Serialize <code>result.bytes</code> for byte delivery and <code>result.stream</code> for stream delivery.
Apply the Locked Contracts headers only after CAP-6 and error branches.
Map <code>invalid_cursor</code> to 400/<code>Invalid file cursor</code> and <code>stale_cursor</code> to 409/<code>File changed</code>.
Use stable log error types <code>invalid_cursor</code> and <code>stale_cursor</code> without logging the cursor.

- [ ] **Step 4: Verify route GREEN**

Run:

~~~bash
( cd packages/server && bun test src/routes/api.git-changes.test.ts )
( cd packages/server && bun run type-check )
~~~

Expected: PASS, including all older CAP-6, containment, source, special-name, and quiet-log tests.

- [ ] **Step 5: Regenerate the OpenAPI client types**

In one terminal run:

~~~bash
bun run dev:server
~~~

After <code>http://localhost:3090/api/openapi.json</code> responds, run in a second terminal:

~~~bash
bun --filter @archon/web generate:types
~~~

Stop only the server started for this step.
Confirm the generated ready diff schema includes <code>fileFallback: boolean</code> and the diff operation includes 409.

- [ ] **Step 6: Commit**

~~~bash
git add packages/server/src/routes/schemas/git.schemas.ts \
  packages/server/src/routes/git/diff-route.ts \
  packages/server/src/routes/git/diff-handler.ts \
  packages/server/src/routes/git/file-handler.ts \
  packages/server/src/routes/api.git-changes.test.ts \
  packages/web/src/lib/api.generated.d.ts
git commit -m "feat(sc): expose paged and streamed git reads"
~~~

---

### Task 5: Parse raw presentations in the web API client

**Files:**

- Modify: <code>packages/web/src/lib/api.ts</code>
- Modify: <code>packages/web/src/lib/api.git-changes.test.ts</code>

**Interfaces:**

- Consumes Task 4 headers and generated <code>fileFallback</code>.
- Produces the <code>GitFileClientResult</code> union and these signatures.

~~~ts
export function gitFileUrl(
  runId: string,
  path: string,
  source: GitFileSource,
  options?: { cursor?: string; download?: boolean }
): string;

export async function getWorkflowRunGitFile(
  runId: string,
  path: string,
  source: GitFileSource,
  options?: { cursor?: string; signal?: AbortSignal }
): Promise<GitFileClientResult>;
~~~

- [ ] **Step 1: Write failing client tests**

Replace the old generic binary test and append these tests in <code>packages/web/src/lib/api.git-changes.test.ts</code>.

~~~ts
test('gitFileUrl emits only non-empty cursor and requested download', () => {
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

test('parses text paging metadata', async () => {
  fetchSpy = mockFetchResponse(
    new Response('hello\n', {
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        ETag: '"' + CONTENT_HASH + '"',
        'X-Archon-Git-Presentation': 'text',
        'X-Archon-Git-Media-Type': '',
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

test('parses an image as bytes without calling response.text', async () => {
  const imageResponse = new Response(Uint8Array.from([0x89, 0x50]), {
    headers: {
      'Content-Type': 'image/png',
      ETag: '"' + CONTENT_HASH + '"',
      'X-Archon-Git-Presentation': 'image',
      'X-Archon-Git-Media-Type': 'image/png',
      'X-Archon-Git-Byte-Length': '2',
      'X-Archon-Git-Truncated': 'false',
      'X-Archon-Git-Cursor': '',
    },
  });
  textSpy = spyOn(imageResponse, 'text');
  fetchSpy = mockFetchResponse(imageResponse);
  await expect(getWorkflowRunGitFile('run/one', 'tiny.png', 'worktree')).resolves.toEqual({
    kind: 'image',
    bytes: Uint8Array.from([0x89, 0x50]),
    contentHash: CONTENT_HASH,
    mediaType: 'image/png',
    byteLength: 2,
  });
  expect(textSpy).not.toHaveBeenCalled();
});

test('parses a hex presentation as bytes rather than text', async () => {
  const response = new Response(Uint8Array.from([0, 0x41, 0xff]), {
    headers: {
      'Content-Type': 'application/octet-stream',
      ETag: '"' + CONTENT_HASH + '"',
      'X-Archon-Git-Presentation': 'hex',
      'X-Archon-Git-Media-Type': '',
      'X-Archon-Git-Byte-Length': '3',
      'X-Archon-Git-Truncated': 'false',
      'X-Archon-Git-Cursor': '',
    },
  });
  textSpy = spyOn(response, 'text');
  fetchSpy = mockFetchResponse(response);
  await expect(getWorkflowRunGitFile('run/one', 'blob.bin', 'worktree')).resolves.toEqual({
    kind: 'hex',
    bytes: Uint8Array.from([0, 0x41, 0xff]),
    contentHash: CONTENT_HASH,
    byteLength: 3,
  });
  expect(textSpy).not.toHaveBeenCalled();
});

test('download-only cancels its empty body and returns metadata', async () => {
  const cancel = mock(() => Promise.resolve());
  const response = new Response(null, {
    headers: {
      'Content-Type': 'application/octet-stream',
      ETag: '"' + CONTENT_HASH + '"',
      'X-Archon-Git-Presentation': 'download',
      'X-Archon-Git-Media-Type': '',
      'X-Archon-Git-Byte-Length': '52428801',
      'X-Archon-Git-Truncated': 'false',
      'X-Archon-Git-Cursor': '',
    },
  });
  Object.defineProperty(response, 'body', { value: { cancel } });
  fetchSpy = mockFetchResponse(response);
  await expect(getWorkflowRunGitFile('run/one', 'huge.bin', 'worktree')).resolves.toEqual({
    kind: 'download',
    contentHash: CONTENT_HASH,
    byteLength: 52_428_801,
  });
  expect(cancel).toHaveBeenCalledTimes(1);
});

test('rejects inconsistent presented headers', async () => {
  fetchSpy = mockFetchResponse(
    new Response('hello', {
      headers: {
        'Content-Type': 'text/plain',
        ETag: '"' + CONTENT_HASH + '"',
        'X-Archon-Git-Presentation': 'text',
        'X-Archon-Git-Media-Type': '',
        'X-Archon-Git-Truncated': 'true',
        'X-Archon-Git-Cursor': '',
        'X-Archon-Git-Byte-Length': '5',
      },
    })
  );
  await expect(getWorkflowRunGitFile('run/one', 'x.ts', 'worktree')).rejects.toThrow(
    'Invalid git file response'
  );
});
~~~

Keep the Story 1.2 fallback tests for missing presentation headers, CAP-6 JSON, invalid ETag, abort-signal forwarding, special path encoding, and bounded API error text.

- [ ] **Step 2: Verify RED**

Run:

~~~bash
( cd packages/web && bun test src/lib/api.git-changes.test.ts )
~~~

Expected: FAIL because the client still returns <code>binary</code> and ignores presentation headers and file cursors.

- [ ] **Step 3: Implement the client union and validation**

Update <code>gitFileUrl</code> with <code>URLSearchParams</code>, preserving per-segment path encoding.
Read and validate ETag, presentation, non-negative integer byte length, exact boolean truncated value, cursor consistency, media type, and content type.
Require a non-empty cursor exactly when text is truncated.
Use <code>response.text()</code> only for text, <code>arrayBuffer()</code> only for image/hex, and cancel the body for download-only.
Keep the missing-presentation backward fallback: JSON CAP-6, text as an untruncated final page, and octet-stream as download-only.

- [ ] **Step 4: Verify GREEN**

Run:

~~~bash
( cd packages/web && bun test src/lib/api.git-changes.test.ts )
( cd packages/web && bun run type-check )
~~~

Expected: PASS.

- [ ] **Step 5: Commit**

~~~bash
git add packages/web/src/lib/api.ts packages/web/src/lib/api.git-changes.test.ts
git commit -m "feat(sc): parse paged git file presentations"
~~~

---

### Task 6: Render hex, images, Load more, and virtualized hunks

**Files:**

- Create: <code>packages/web/src/components/workflows/source-control/hex-peek.ts</code>
- Create: <code>packages/web/src/components/workflows/source-control/hex-peek.test.ts</code>
- Create: <code>packages/web/src/components/workflows/source-control/inline-image.tsx</code>
- Create: <code>packages/web/src/components/workflows/source-control/inline-image.test.tsx</code>
- Create: <code>packages/web/src/components/workflows/source-control/virtualized-diff.tsx</code>
- Modify: <code>packages/web/src/components/workflows/source-control/file-viewer.tsx</code>
- Modify: <code>packages/web/src/components/workflows/source-control/file-viewer.test.tsx</code>
- Create: <code>packages/web/src/component-integration/source-control-large-diff-spike.tsx</code>

**Interfaces:**

- Consumes Task 5 file kinds and existing <code>git-hunk-adapter.ts</code>/<code>syntax-highlight.tsx</code>.
- Produces the Locked Contracts viewer state plus <code>loadingMore</code> and <code>onLoadMore</code> props.

~~~ts
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

- [ ] **Step 1: Write failing formatter and viewer tests**

Create <code>hex-peek.test.ts</code> with an exact, independently derived line.

~~~ts
import { expect, test } from 'bun:test';

import { formatHexPeek } from './hex-peek';

test('formats sixteen-byte rows with offset, padded hex, and printable ASCII', () => {
  expect(formatHexPeek(Uint8Array.from([0x00, 0x41, 0xff]))).toBe(
    '00000000  00 41 ff                                         |.A.             |'
  );
});
~~~

Create <code>inline-image.test.tsx</code> with one mounted lifecycle test.

~~~tsx
import { afterEach, beforeEach, expect, mock, test } from 'bun:test';
import { Window } from 'happy-dom';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import { InlineImage } from './inline-image';

let win: Window;
let host: Element;
let root: Root | null;
const createObjectURL = mock((_blob: Blob): string => 'blob:first');
const revokeObjectURL = mock((_url: string): void => undefined);

beforeEach(() => {
  win = new Window({ url: 'https://localhost/' });
  Object.assign(globalThis as object, {
    window: win,
    document: win.document,
    HTMLElement: win.HTMLElement,
    Element: win.Element,
    Node: win.Node,
    Blob: win.Blob,
    URL: win.URL,
    IS_REACT_ACT_ENVIRONMENT: true,
  });
  createObjectURL.mockReset();
  createObjectURL.mockReturnValueOnce('blob:first').mockReturnValueOnce('blob:second');
  revokeObjectURL.mockReset();
  Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: createObjectURL });
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: revokeObjectURL });
  host = win.document.createElement('div') as unknown as Element;
  win.document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  win.close();
});

test('replaces and revokes object URLs when bytes change and on unmount', async () => {
  const mountedRoot = root;
  if (!mountedRoot) throw new Error('Missing React root');
  await act(async () => {
    mountedRoot.render(<InlineImage bytes={Uint8Array.from([1])} mediaType="image/png" />);
  });
  expect(host.querySelector('img')?.getAttribute('src')).toBe('blob:first');
  await act(async () => {
    mountedRoot.render(<InlineImage bytes={Uint8Array.from([2])} mediaType="image/png" />);
  });
  expect(revokeObjectURL).toHaveBeenCalledWith('blob:first');
  expect(host.querySelector('img')?.getAttribute('src')).toBe('blob:second');
  await act(async () => mountedRoot.unmount());
  root = null;
  expect(revokeObjectURL).toHaveBeenCalledWith('blob:second');
});
~~~

Update every existing text state in <code>file-viewer.test.tsx</code> with <code>truncated: false</code> and <code>cursor: ""</code>.
Add <code>fileFallback: false</code> to <code>MARKER_HUNK_DIFF</code>, <code>LINE_TRAP_DIFF</code>, and every inline ready diff fixture required by the regenerated type.
Update every existing diff state with <code>reloadFingerprint: JSON.stringify(response)</code>, using the fixture variable passed to that state.
Replace the binary state with hex and download states.
Change <code>renderViewer</code> to pass <code>onLoadMore={(): void =&gt; undefined}</code> so truncated-state tests exercise the control.
Append these tests.

~~~tsx
test('a truncated text page and truncated diff expose Load more', () => {
  const text = renderViewer({
    kind: 'text',
    file: ADDED,
    text: 'hello\n',
    contentHash: 'a'.repeat(64),
    truncated: true,
    cursor: 'next',
  });
  expect(text).toContain('>Load more<');
  const diff = renderViewer({
    kind: 'diff',
    file: MODIFIED,
    response: { ...MARKER_HUNK_DIFF, truncated: true, cursor: 'next' },
    reloadFingerprint: 'next',
  });
  expect(diff).toContain('>Load more<');
});

test('loadingMore replaces Load more with Cancel without hiding painted text', () => {
  const html = renderToStaticMarkup(
    <FileViewer
      state={{
        kind: 'text',
        file: ADDED,
        text: 'painted\n',
        contentHash: 'a'.repeat(64),
        truncated: true,
        cursor: 'next',
      }}
      stacked={false}
      loadingMore={true}
      onCancel={(): void => undefined}
      onReload={(): void => undefined}
      onClose={(): void => undefined}
      onLoadMore={(): void => undefined}
    />
  );
  expect(html).toContain('painted');
  expect(html).toContain('>Cancel<');
  expect(html).not.toContain('>Load more<');
});

test('image state offers Download without highlighting or inline SVG markup', () => {
  const html = renderViewer({
    kind: 'image',
    file: { path: 'tiny.svg', status: 'A' },
    contentHash: 'b'.repeat(64),
    bytes: Buffer.from('<svg><script>bad()</script></svg>'),
    mediaType: 'image/svg+xml',
    downloadHref: DOWNLOAD_HREF + '&download=1',
  });
  expect(html).toContain('>Download<');
  expect(html).not.toContain('<script>');
  expect(html).not.toContain('class="hljs"');
});

test('hex renders a plain preformatted peek and a download link', () => {
  const html = renderViewer({
    kind: 'hex',
    file: BINARY,
    contentHash: 'b'.repeat(64),
    hex: '00000000  00 41 ff                                         |.A.             |',
    downloadHref: DOWNLOAD_HREF + '&download=1',
  });
  expect(html).toContain('00000000');
  expect(html).toContain('>Download<');
  expect(html).not.toContain('class="hljs"');
  expect(html).not.toContain('sc-diff-before');
});

test('download-only has no preformatted body', () => {
  const html = renderViewer({
    kind: 'download',
    file: BINARY,
    contentHash: 'b'.repeat(64),
    downloadHref: DOWNLOAD_HREF + '&download=1',
  });
  expect(html).toContain('This file is too large to open here.');
  expect(html).toContain('>Download<');
  expect(html).not.toContain('<pre');
});
~~~

Keep the attacker-markup, Before/After, gutter, responsive, quiet-copy, Reload, and Close tests.

- [ ] **Step 2: Create the failing large-diff spike**

Create <code>packages/web/src/component-integration/source-control-large-diff-spike.tsx</code>.
The script must build a fixture whose hunk content is at least 2 MiB, mount <code>FileViewer</code> in happy-dom, count mounted <code>.sc-virtual-hunk</code> elements, bundle <code>file-viewer.tsx</code> with <code>Bun.build({ metafile: true, write: false })</code>, sum metafile input bytes whose path includes <code>node_modules/lodash/</code>, and print one JSON object with <code>fixtureBytes</code>, <code>renderMs</code>, <code>mountedHunks</code>, <code>totalHunks</code>, <code>bundleBytes</code>, and <code>lodashInputBytes</code>.
Exit non-zero when fixture bytes are below 2,097,152, render time is 1,000 ms or more, all hunks mount, the bundle fails, or lodash input bytes are zero.

Use this complete script body.

~~~tsx
import { Window } from 'happy-dom';
import { join } from 'path';
import { act } from 'react';
import { createRoot } from 'react-dom/client';

import type { GitReadyDiffResponse } from '@/lib/api';

import { FileViewer } from '../components/workflows/source-control/file-viewer';

class ResizeObserverStub {
  observe(): void {
    return undefined;
  }
  unobserve(): void {
    return undefined;
  }
  disconnect(): void {
    return undefined;
  }
}

const win = new Window({ url: 'https://localhost/' });
Object.assign(globalThis as object, {
  window: win,
  document: win.document,
  self: win,
  HTMLElement: win.HTMLElement,
  Element: win.Element,
  Node: win.Node,
  MutationObserver: win.MutationObserver,
  ResizeObserver: win.ResizeObserver ?? ResizeObserverStub,
  requestAnimationFrame: win.requestAnimationFrame.bind(win),
  cancelAnimationFrame: win.cancelAnimationFrame.bind(win),
  getComputedStyle: win.getComputedStyle.bind(win),
  IS_REACT_ACT_ENVIRONMENT: true,
});

const totalHunks = 4096;
const content = 'x'.repeat(512);
const fixtureBytes = Buffer.byteLength(content, 'utf8') * totalHunks;
const response: GitReadyDiffResponse = {
  path: 'large.ts',
  status: 'M',
  scope: 'now',
  ref: 'live',
  cursor: '',
  truncated: false,
  binary: false,
  fileFallback: false,
  hunks: Array.from({ length: totalHunks }, (_unused, index) => ({
    header: '@@ -0,0 +' + String(index + 1) + ' @@',
    oldStart: 0,
    oldLines: 0,
    newStart: index + 1,
    newLines: 1,
    changes: [{ type: 'insert' as const, content, newLine: index + 1 }],
  })),
};

const host = win.document.createElement('div');
win.document.body.append(host);
const root = createRoot(host);
const started = performance.now();
await act(async () => {
  root.render(
    <FileViewer
      state={{
        kind: 'diff',
        file: { path: 'large.ts', status: 'M' },
        response,
        reloadFingerprint: 'spike',
      }}
      stacked={false}
      onCancel={(): void => undefined}
      onReload={(): void => undefined}
      onClose={(): void => undefined}
    />
  );
  await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
});
const renderMs = performance.now() - started;
const mountedHunks = host.querySelectorAll('.sc-virtual-hunk').length;

const build = await Bun.build({
  entrypoints: [join(import.meta.dir, '../components/workflows/source-control/file-viewer.tsx')],
  target: 'browser',
  write: false,
  minify: true,
  metafile: true,
});
const bundleBytes = build.outputs.reduce((sum, output) => sum + output.size, 0);
const lodashInputBytes = Object.entries(build.metafile?.inputs ?? {})
  .filter(([path]) => path.includes('node_modules/lodash/'))
  .reduce((sum, [, input]) => sum + input.bytes, 0);

const report = {
  fixtureBytes,
  renderMs,
  mountedHunks,
  totalHunks,
  bundleBytes,
  lodashInputBytes,
};
console.log(JSON.stringify(report));

await act(async () => root.unmount());
win.close();

if (
  !build.success ||
  fixtureBytes < 2_097_152 ||
  renderMs >= 1000 ||
  mountedHunks <= 0 ||
  mountedHunks >= totalHunks ||
  lodashInputBytes <= 0
) {
  process.exitCode = 1;
}
~~~

Run:

~~~bash
( cd packages/web && NODE_ENV=development bun run src/component-integration/source-control-large-diff-spike.tsx )
~~~

Expected: FAIL because the current viewer mounts every hunk and has no <code>.sc-virtual-hunk</code> boundary.

- [ ] **Step 3: Implement the formatter, object-URL owner, and virtualized panes**

Implement <code>formatHexPeek</code> as 16 bytes per row with an eight-digit lowercase offset, 47-character padded hex field, and 16-character printable-ASCII field.
Do not add a second backend formatter.

Implement <code>inline-image.tsx</code> with this ownership rule.

~~~tsx
export function InlineImage(props: {
  bytes: Uint8Array;
  mediaType: string;
}): ReactElement {
  const [objectUrl, setObjectUrl] = useState('');
  useEffect(() => {
    const url = URL.createObjectURL(new Blob([props.bytes.slice().buffer], { type: props.mediaType }));
    setObjectUrl(url);
    return (): void => URL.revokeObjectURL(url);
  }, [props.bytes, props.mediaType]);
  return objectUrl ? <img alt="" src={objectUrl} /> : <div role="status" />;
}
~~~

Implement <code>virtualized-diff.tsx</code> as two independently scrolling side components.
Each side owns its own scroll ref and <code>useVirtualizer</code>, uses <code>initialRect: { width: 0, height: 280 }</code>, estimates height from the visible change count, renders only virtual items as absolutely positioned <code>.sc-virtual-hunk</code> wrappers, and falls back to all side hunks only when <code>getVirtualItems()</code> is empty for static rendering.
Render one existing <code>Diff</code> per mounted hunk and keep existing highlighting and gutter callbacks.

- [ ] **Step 4: Implement viewer states and controls**

Move <code>DiffPanes</code> into <code>virtualized-diff.tsx</code>.
Render <code>InlineImage</code> plus Download for image, plain <code>&lt;pre&gt;&lt;code&gt;</code> plus Download for hex, and exact copy <code>This file is too large to open here.</code> plus Download for download-only.
Show Load more only for a truncated text/diff state with a non-empty cursor and a supplied callback.
Show Cancel for the initial loading state or while <code>loadingMore</code> is true.
Never use syntax highlighting for image or hex.

- [ ] **Step 5: Verify GREEN and the accepted spike**

Run:

~~~bash
( cd packages/web && bun test src/components/workflows/source-control/ )
( cd packages/web && NODE_ENV=development bun run src/component-integration/source-control-large-diff-spike.tsx )
( cd packages/web && bun run type-check )
~~~

Expected: all commands PASS, the spike reports at least 2,097,152 fixture bytes, fewer mounted than total hunks, positive lodash input bytes, and <code>renderMs &lt; 1000</code>.
If the one-second rule still fails after hunk virtualization, stop and report the measured JSON because the approved architecture makes the viewer-stack decision contingent on this spike and forbids silently adding Monaco.

- [ ] **Step 6: Commit**

~~~bash
git add packages/web/src/components/workflows/source-control/hex-peek.ts \
  packages/web/src/components/workflows/source-control/hex-peek.test.ts \
  packages/web/src/components/workflows/source-control/inline-image.tsx \
  packages/web/src/components/workflows/source-control/inline-image.test.tsx \
  packages/web/src/components/workflows/source-control/virtualized-diff.tsx \
  packages/web/src/components/workflows/source-control/file-viewer.tsx \
  packages/web/src/components/workflows/source-control/file-viewer.test.tsx \
  packages/web/src/component-integration/source-control-large-diff-spike.tsx
git commit -m "feat(sc): render virtualized diffs and binary previews"
~~~

---

### Task 7: Append pages without losing cancellation or frozen Reload behavior

**Files:**

- Modify: <code>packages/web/src/component-integration/source-control-tab.test.tsx</code>
- Modify: <code>packages/web/src/components/workflows/source-control/source-control-tab.tsx</code>

**Interfaces:**

- Consumes the Task 4 <code>fileFallback</code>, Task 5 client union, and Task 6 viewer states.
- Produces append-only text/hunk loading, load-only cancellation, raw fallback mapping, stale-cursor Reload, and stable first-page fingerprints.

- [ ] **Step 1: Add presented-response and object-URL test helpers**

Add this helper beside the current file-response helpers.

~~~ts
function presentedFileResponse(
  body: BodyInit | null,
  hash: string,
  headers: Record<string, string>
): Response {
  return new Response(body, {
    status: 200,
    headers: {
      ETag: '"' + hash + '"',
      'X-Archon-Git-Truncated': 'false',
      'X-Archon-Git-Cursor': '',
      'X-Archon-Git-Byte-Length': '1',
      'X-Archon-Git-Media-Type': '',
      ...headers,
    },
  });
}
~~~

Add <code>URL: win.URL</code> and <code>Blob: win.Blob</code> to <code>installHappyDom()</code>’s globals, then add these module variables and lifecycle lines.

~~~ts
let createObjectUrlMock: Mock<(blob: Blob) => string>;
let revokeObjectUrlMock: Mock<(url: string) => void>;

// Inside beforeEach, after installHappyDom():
createObjectUrlMock = mock((_blob: Blob): string => 'blob:archon-image');
revokeObjectUrlMock = mock((_url: string): void => undefined);
Object.defineProperty(URL, 'createObjectURL', {
  configurable: true,
  value: createObjectUrlMock,
});
Object.defineProperty(URL, 'revokeObjectURL', {
  configurable: true,
  value: revokeObjectUrlMock,
});

// Inside afterEach, after root.unmount():
delete (URL as unknown as { createObjectURL?: unknown }).createObjectURL;
delete (URL as unknown as { revokeObjectURL?: unknown }).revokeObjectURL;
~~~

- [ ] **Step 2: Write failing mounted paging and cancellation tests**

Append these tests before changing production code.

~~~tsx
test('Load more appends text with the opaque cursor and leaves the Changes list unchanged', async () => {
  fetchSpy = mockGitRoutes({
    onChanges: () => ({
      files: [{ path: 'big.txt', status: 'A' }],
      revision: REVISION_A,
    }),
    onFile: (_url, call) =>
      call === 1
        ? presentedFileResponse('first\n', HASH_A, {
            'Content-Type': 'text/plain; charset=utf-8',
            'X-Archon-Git-Truncated': 'true',
            'X-Archon-Git-Cursor': 'opaque+next',
            'X-Archon-Git-Byte-Length': '13',
            'X-Archon-Git-Presentation': 'text',
          })
        : presentedFileResponse('second\n', HASH_A, {
            'Content-Type': 'text/plain; charset=utf-8',
            'X-Archon-Git-Presentation': 'text',
            'X-Archon-Git-Byte-Length': '13',
          }),
  });
  await renderTab('run-1');
  await waitFor(() => host.textContent?.includes('big.txt') === true, 'file list');
  await clickOption('big.txt');
  await waitFor(() => host.textContent?.includes('Load more') === true, 'Load more');
  await act(async () => requireButton('Load more').click());
  await waitFor(() => host.textContent?.includes('second') === true, 'second page');
  expect(host.textContent).toContain('first');
  expect(host.querySelectorAll('[role="option"]')).toHaveLength(1);
  expect(calledUrls(fetchSpy).at(-1)).toContain('cursor=opaque%2Bnext');
});

test('Cancel during Load more aborts only the page and keeps painted text', async () => {
  const pending = createDeferred<Response>();
  let pageSignal: AbortSignal | undefined;
  fetchSpy = mockGitRoutes({
    onChanges: () => ({
      files: [{ path: 'big.txt', status: 'A' }],
      revision: REVISION_A,
    }),
    onFile: (_url, call, init) => {
      if (call === 1) {
        return presentedFileResponse('painted\n', HASH_A, {
          'Content-Type': 'text/plain; charset=utf-8',
          'X-Archon-Git-Truncated': 'true',
          'X-Archon-Git-Cursor': 'next',
          'X-Archon-Git-Byte-Length': '20',
          'X-Archon-Git-Presentation': 'text',
        });
      }
      pageSignal = init?.signal ?? undefined;
      return pending.promise;
    },
  });
  await renderTab('run-1');
  await waitFor(() => host.textContent?.includes('big.txt') === true, 'file list');
  await clickOption('big.txt');
  await waitFor(() => host.textContent?.includes('Load more') === true, 'Load more');
  await act(async () => requireButton('Load more').click());
  await waitFor(() => host.textContent?.includes('Cancel') === true, 'page Cancel');
  await act(async () => requireButton('Cancel').click());
  expect(pageSignal?.aborted).toBe(true);
  expect(host.textContent).toContain('painted');
  expect(host.querySelector('[aria-label="Close"]')).not.toBeNull();
  expect(host.textContent).not.toContain('Select a file to inspect');
});
~~~

- [ ] **Step 3: Write failing mounted fallback and cleanup tests**

Append separate tests for image, hex, and download-only.

~~~tsx
test('an SVG M fallback renders through img and revokes its object URL on close', async () => {
  fetchSpy = mockGitRoutes({
    onChanges: () => ({
      files: [{ path: 'image.svg', status: 'M' }],
      revision: REVISION_A,
    }),
    onDiff: () =>
      jsonResponse({
        ...readyDiff('image.svg', 'old', 'new'),
        hunks: [],
        fileFallback: true,
      }),
    onFile: () =>
      presentedFileResponse(Buffer.from('<svg></svg>'), HASH_A, {
        'Content-Type': 'image/svg+xml',
        'X-Archon-Git-Presentation': 'image',
        'X-Archon-Git-Media-Type': 'image/svg+xml',
        'X-Archon-Git-Byte-Length': '11',
      }),
  });
  await renderTab('run-1');
  await waitFor(() => host.textContent?.includes('image.svg') === true, 'file list');
  await clickOption('image.svg');
  await waitFor(() => host.querySelector('img') !== null, 'inline image');
  expect(host.querySelector('img')?.getAttribute('src')).toBe('blob:archon-image');
  expect(host.querySelector('a')?.getAttribute('href')).toContain('download=1');
  await act(async () => requireButton('Close').click());
  expect(createObjectUrlMock).toHaveBeenCalledTimes(1);
  expect(revokeObjectUrlMock).toHaveBeenCalledWith('blob:archon-image');
});

test('selecting another image revokes the prior object URL before replacing it', async () => {
  let objectUrlIndex = 0;
  createObjectUrlMock.mockImplementation((_blob: Blob): string => {
    objectUrlIndex += 1;
    return 'blob:image-' + String(objectUrlIndex);
  });
  fetchSpy = mockGitRoutes({
    onChanges: () => ({
      files: [
        { path: 'one.png', status: 'A' },
        { path: 'two.png', status: 'A' },
      ],
      revision: REVISION_A,
    }),
    onFile: url =>
      presentedFileResponse(Uint8Array.from([0x89, 0x50]), url.includes('one.png') ? HASH_A : HASH_B, {
        'Content-Type': 'image/png',
        'X-Archon-Git-Presentation': 'image',
        'X-Archon-Git-Media-Type': 'image/png',
        'X-Archon-Git-Byte-Length': '2',
      }),
  });
  await renderTab('run-1');
  await waitFor(() => host.textContent?.includes('two.png') === true, 'file list');
  await clickOption('one.png');
  await waitFor(() => host.querySelector('img')?.getAttribute('src') === 'blob:image-1', 'first image');
  await clickOption('two.png');
  await waitFor(() => host.querySelector('img')?.getAttribute('src') === 'blob:image-2', 'second image');
  expect(revokeObjectUrlMock).toHaveBeenCalledWith('blob:image-1');
});

test('a NUL M fallback renders hex and Download without diff or highlighting', async () => {
  fetchSpy = mockGitRoutes({
    onChanges: () => ({
      files: [{ path: 'blob.bin', status: 'M' }],
      revision: REVISION_A,
    }),
    onDiff: () => jsonResponse({ ...binaryDiff('blob.bin'), fileFallback: true }),
    onFile: () =>
      presentedFileResponse(Uint8Array.from([0, 0x41, 0xff]), HASH_A, {
        'Content-Type': 'application/octet-stream',
        'X-Archon-Git-Presentation': 'hex',
        'X-Archon-Git-Byte-Length': '3',
      }),
  });
  await renderTab('run-1');
  await waitFor(() => host.textContent?.includes('blob.bin') === true, 'file list');
  await clickOption('blob.bin');
  await waitFor(() => host.textContent?.includes('00000000') === true, 'hex');
  expect(host.querySelector('[aria-label="Before"]')).toBeNull();
  expect(host.querySelector('.hljs')).toBeNull();
  expect(host.querySelector('a')?.getAttribute('href')).toContain('download=1');
});

test('download-only renders no pre body', async () => {
  fetchSpy = mockGitRoutes({
    onChanges: () => ({
      files: [{ path: 'huge.dat', status: 'A' }],
      revision: REVISION_A,
    }),
    onFile: () =>
      presentedFileResponse(null, HASH_A, {
        'Content-Type': 'application/octet-stream',
        'Content-Disposition': 'attachment; filename="download"',
        'X-Archon-Git-Presentation': 'download',
        'X-Archon-Git-Byte-Length': '52428801',
      }),
  });
  await renderTab('run-1');
  await waitFor(() => host.textContent?.includes('huge.dat') === true, 'file list');
  await clickOption('huge.dat');
  await waitFor(
    () => host.textContent?.includes('This file is too large to open here.') === true,
    'download-only'
  );
  expect(host.querySelector('pre')).toBeNull();
  expect(host.querySelector('a')?.getAttribute('href')).toContain('download=1');
});
~~~

- [ ] **Step 4: Write failing Reload, stale-cursor, privacy, and virtualization tests**

Add four focused tests.
The first opens a truncated diff, loads its second page, manually reloads the unchanged first page with the same initial cursor, and asserts no <code>Changed on disk — Reload</code>.
The second returns HTTP 409 from Load more, then returns a fresh first page with a different version-bound cursor during the automatic Reload comparison, and asserts painted content remains plus <code>Changed on disk — Reload</code>.
The third opens <code>.env</code> as a presented text response and asserts an <code>.hljs</code> element exists.
The fourth returns at least 3,000 one-change hunks, waits for <code>.sc-virtual-hunk</code>, and asserts the mounted wrapper count is positive and less than 3,000.

Use these literal initial diff pages so the test does not derive expected fingerprints from production code.

~~~ts
const FIRST_DIFF_PAGE: GitReadyDiffResponse = {
  path: 'large.ts',
  status: 'M',
  scope: 'now',
  ref: 'live',
  cursor: 'version-one',
  truncated: true,
  binary: false,
  fileFallback: false,
  hunks: [{
    header: '@@ -1 +1 @@',
    oldStart: 1,
    oldLines: 1,
    newStart: 1,
    newLines: 1,
    changes: [{ type: 'insert', content: 'first', newLine: 1 }],
  }],
};

const SECOND_DIFF_PAGE: GitReadyDiffResponse = {
  ...FIRST_DIFF_PAGE,
  cursor: '',
  truncated: false,
  hunks: [{
    header: '@@ -10 +10 @@',
    oldStart: 10,
    oldLines: 1,
    newStart: 10,
    newLines: 1,
    changes: [{ type: 'insert', content: 'second', newLine: 10 }],
  }],
};
~~~

Append these exact tests.

~~~tsx
test('appended diff hunks do not make an unchanged first page look stale', async () => {
  fetchSpy = mockGitRoutes({
    onChanges: () => ({
      files: [{ path: 'large.ts', status: 'M' }],
      revision: REVISION_A,
    }),
    onDiff: (_url, call) =>
      jsonResponse(call === 2 ? SECOND_DIFF_PAGE : FIRST_DIFF_PAGE),
  });
  await renderTab('run-1');
  await waitFor(() => host.textContent?.includes('large.ts') === true, 'file list');
  await clickOption('large.ts');
  await waitFor(() => host.textContent?.includes('Load more') === true, 'Load more');
  await act(async () => requireButton('Load more').click());
  await waitFor(() => host.textContent?.includes('second') === true, 'second hunk page');
  await act(async () => requireButton('Reload').click());
  const activeFetchSpy = fetchSpy;
  if (!activeFetchSpy) throw new Error('Missing fetch spy');
  await waitFor(
    () => calledUrls(activeFetchSpy).filter(url => url.includes('/git/diff')).length === 3,
    'fresh first hunk page'
  );
  expect(host.textContent).toContain('second');
  expect(host.textContent).not.toContain('Changed on disk — Reload');
});

test('a stale text cursor keeps painted content and enters the existing Reload flow', async () => {
  fetchSpy = mockGitRoutes({
    onChanges: () => ({
      files: [{ path: 'large.txt', status: 'A' }],
      revision: REVISION_A,
    }),
    onFile: (_url, call) => {
      if (call === 1) {
        return presentedFileResponse('painted\n', HASH_A, {
          'Content-Type': 'text/plain; charset=utf-8',
          'X-Archon-Git-Truncated': 'true',
          'X-Archon-Git-Cursor': 'old-version',
          'X-Archon-Git-Byte-Length': '20',
          'X-Archon-Git-Presentation': 'text',
        });
      }
      if (call === 2) {
        return new Response(JSON.stringify({ error: 'File changed' }), {
          status: 409,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return presentedFileResponse('fresh\n', HASH_B, {
        'Content-Type': 'text/plain; charset=utf-8',
        'X-Archon-Git-Truncated': 'true',
        'X-Archon-Git-Cursor': 'new-version',
        'X-Archon-Git-Byte-Length': '21',
        'X-Archon-Git-Presentation': 'text',
      });
    },
  });
  await renderTab('run-1');
  await waitFor(() => host.textContent?.includes('large.txt') === true, 'file list');
  await clickOption('large.txt');
  await waitFor(() => host.textContent?.includes('Load more') === true, 'Load more');
  await act(async () => requireButton('Load more').click());
  await waitFor(
    () => host.textContent?.includes('Changed on disk — Reload') === true,
    'stale affordance'
  );
  expect(host.textContent).toContain('painted');
  expect(host.textContent).not.toContain('fresh');
});

test('.env remains ordinary highlighted text', async () => {
  fetchSpy = mockGitRoutes({
    onChanges: () => ({
      files: [{ path: '.env', status: 'A' }],
      revision: REVISION_A,
    }),
    onFile: () =>
      presentedFileResponse('TOKEN=visible\n', HASH_A, {
        'Content-Type': 'text/plain; charset=utf-8',
        'X-Archon-Git-Presentation': 'text',
        'X-Archon-Git-Byte-Length': '14',
      }),
  });
  await renderTab('run-1');
  await waitFor(() => host.textContent?.includes('.env') === true, 'file list');
  await clickOption('.env');
  await waitFor(() => host.querySelector('.hljs') !== null, 'highlighted env');
  expect(host.textContent).toContain('TOKEN');
});

test('a 3000-hunk response mounts only the virtual window', async () => {
  const response: GitReadyDiffResponse = {
    path: 'virtual.ts',
    status: 'M',
    scope: 'now',
    ref: 'live',
    cursor: '',
    truncated: false,
    binary: false,
    fileFallback: false,
    hunks: Array.from({ length: 3000 }, (_unused, index) => ({
      header: '@@ -0,0 +' + String(index + 1) + ' @@',
      oldStart: 0,
      oldLines: 0,
      newStart: index + 1,
      newLines: 1,
      changes: [{ type: 'insert' as const, content: 'line', newLine: index + 1 }],
    })),
  };
  fetchSpy = mockGitRoutes({
    onChanges: () => ({
      files: [{ path: 'virtual.ts', status: 'M' }],
      revision: REVISION_A,
    }),
    onDiff: () => jsonResponse(response),
  });
  await renderTab('run-1');
  await waitFor(() => host.textContent?.includes('virtual.ts') === true, 'file list');
  await clickOption('virtual.ts');
  await waitFor(() => host.querySelectorAll('.sc-virtual-hunk').length > 0, 'virtual hunks');
  expect(host.querySelectorAll('.sc-virtual-hunk').length).toBeLessThan(3000);
});
~~~

Keep every existing Story 1.1/1.2 mounted test.
Update existing <code>readyDiff</code>/<code>binaryDiff</code> helpers with <code>fileFallback: false/true</code>, and update old raw fixtures with presentation headers where the new branch is under test.

- [ ] **Step 5: Verify RED**

Run:

~~~bash
( cd packages/web && NODE_ENV=development bun test src/component-integration/source-control-tab.test.tsx )
~~~

Expected: FAIL on missing append, load-only cancellation, new fallbacks, stable fingerprint, stale-cursor Reload, or hunk virtualization behavior.

- [ ] **Step 6: Implement state mapping and stable fingerprints**

Map raw text with <code>cursor</code>/<code>truncated</code>, image bytes/media type, formatted hex, and download-only metadata to the Locked Contracts states.
For <code>M</code>, fetch raw worktree content when <code>response.fileFallback</code> is true.
Every Download href uses <code>gitFileUrl(..., { download: true })</code> and no cursor.
For an initial truncated diff, store its first cursor as <code>reloadFingerprint</code>; for a complete diff, store its complete response JSON.
Use <code>reloadFingerprint</code> in <code>viewerFingerprint</code> and preserve it while appending hunks.
Keep content-hash fingerprints for text/image/hex/download.

- [ ] **Step 7: Implement Load more and the two Cancel meanings**

Add <code>loadingMore</code> state.
The Load more callback must guard the selected file, state kind, <code>truncated</code>, and non-empty cursor before starting.
For text, request the same source with the current cursor, require another text result with the same <code>contentHash</code>, append text, and replace cursor/truncated.
For diff, request the current cursor, require the same path/ref/status with <code>fileFallback: false</code>, append hunks, replace cursor/truncated, and preserve <code>reloadFingerprint</code>.
Use <code>beginRequest</code> so selection changes, close, run changes, unmount, and Cancel abort the request.
When <code>loadingMore</code> is true, <code>onCancel</code> calls <code>abortCurrent()</code> and clears only <code>loadingMore</code>.
When the viewer is in initial loading, <code>onCancel</code> keeps the existing close-and-focus behavior.
On a status-409 page error, keep the current viewer, clear <code>loadingMore</code>, and call the existing <code>onReload</code> comparison path.
No Load more branch may call <code>dispatch</code>.

- [ ] **Step 8: Verify GREEN**

Run:

~~~bash
( cd packages/web && NODE_ENV=development bun test src/component-integration/source-control-tab.test.tsx )
( cd packages/web && bun test src/components/workflows/source-control/ )
( cd packages/web && bun test src/lib/api.git-changes.test.ts )
( cd packages/web && bun run type-check )
~~~

Expected: PASS with no React act warning.

- [ ] **Step 9: Commit**

~~~bash
git add packages/web/src/component-integration/source-control-tab.test.tsx \
  packages/web/src/components/workflows/source-control/source-control-tab.tsx
git commit -m "feat(sc): append cancellable source-control pages"
~~~

---

### Task 8: Run acceptance gates and update the tracker

**Files:**

- Modify: <code>_bmad-output/implementation-artifacts/archon-source-control/sprint-status.yaml</code> only after every gate passes.

**Interfaces:**

- Consumes the complete implementation.
- Produces validated Story 1.3 behavior and exactly one tracker-value change.

- [ ] **Step 1: Run focused evidence**

~~~bash
( cd packages/git && bun test src/viewer-limits.test.ts src/diff-page.test.ts src/file-read.test.ts )
( cd packages/server && bun test src/routes/api.git-changes.test.ts )
( cd packages/web && bun test src/lib/api.git-changes.test.ts )
( cd packages/web && bun test src/components/workflows/source-control/ )
( cd packages/web && NODE_ENV=development bun test src/component-integration/source-control-tab.test.tsx )
( cd packages/web && NODE_ENV=development bun run src/component-integration/source-control-large-diff-spike.tsx )
~~~

Expected: every command exits zero, no warning appears, and the spike JSON satisfies the Locked Contracts thresholds.

- [ ] **Step 2: Run affected package suites**

~~~bash
( cd packages/git && bun run test )
( cd packages/server && bun run test )
( cd packages/web && bun run test )
~~~

Expected: every package script exits zero in its intended process split.

- [ ] **Step 3: Run the repository gate**

~~~bash
bun run validate
git diff --check
~~~

Expected: both commands exit zero.
Do not update the tracker if type-check, zero-warning lint, formatting, install smoke, generated checks, or a package test fails.

- [ ] **Step 4: Inspect scope and dependency invariants**

~~~bash
git diff --name-only dev...HEAD
rg -n "from ['\"].*experiments/console|Shiki|Monaco|refractor" \
  packages/web/src/components/workflows/source-control packages/web/src/lib/api.ts
rg -n '"react-diff-view": "3\\.3\\.3"' packages/web/package.json
rg -n "^export \\{ fileAt, fileDiff \\}" packages/git/src/index.ts
git diff --name-only dev...HEAD -- packages/web/package.json bun.lock migrations packages/core/src/db
~~~

Expected: only planned files appear, the forbidden import/library search has no match, the exact diff dependency remains, the root git package still exports only the existing file I/O pair, and the final manifest/database search has no output.
Confirm no History region, polling, server git-result cache, redaction, denylist, write control, environment key, process, table, or deployable was added.

- [ ] **Step 5: Confirm the acceptance matrix**

| Criterion | Evidence |
| --- | --- |
| First paint is at most about 256 KiB or 2,000 lines | Literal-boundary pure tests and real file/blob paging |
| Load more reconstructs text and appends hunk pages through opaque cursors | Git, HTTP, client, and mounted tests |
| Cursors are route-specific and reject changed live content | Cursor tests, real stale file/diff tests, HTTP 400/409 tests |
| M uses incremental <code>-U3</code> hunks and no whole-diff buffer | Real multi-hunk test and spawned parser |
| Modified SVG/image/binary/oversized files reach raw fallback | <code>fileFallback</code> git, schema, route, and mounted tests |
| Files above 1 MiB remain cancellable without whole-file buffering | Bounded tree/worktree tests, abortable spawn/stream code, mounted Cancel |
| Every file above 50 MiB is download-only | Literal classifier and real sparse-file tests |
| Downloads stream instead of buffering | Git stream and HTTP streamed-body tests |
| PNG/JPEG/GIF/WEBP/SVG render inline without SVG DOM insertion | Media table and mounted image test |
| Other binaries at or below 50 MiB show 4-KiB-or-less hex plus Download | Real blob, formatter, route, and mounted tests |
| Lists and accumulated diffs virtualize | Existing list tests, mounted hunk-count test, and spike |
| The 2-MiB spike is under one second and counts lodash bundle input | Spike JSON |
| Manual Reload remains frozen and page append is not false staleness | Mounted Reload/fingerprint tests |
| Object URLs are revoked | Mounted close/selection/unmount cleanup tests |
| No polling or git-result cache appears | Existing query flags and scope inspection |
| NFR6 still opens <code>.env</code> | Mounted privacy-residual test |
| CAP-6, containment, special filenames, and quiet logging remain | Existing and extended git HTTP tests |
| No public git I/O helper or dependency was added | Root export and manifest inspection |

- [ ] **Step 6: Perform the legacy-screen manual check**

Run:

~~~bash
bun run dev
~~~

Open an existing DAG run with a live host checkout at <code>/legacy/workflows/runs/:id</code>.
Open a multi-megabyte text file and confirm the skeleton, first page, Load more, and appended content.
Cancel one in-flight Load more and confirm the first page stays open.
Open PNG or JPEG and SVG changes and confirm each renders in <code>&lt;img&gt;</code>.
Open a small NUL binary and confirm a hex peek plus Download with no highlighted source.
Open a file over 50 MiB and confirm download-only copy appears immediately and its Download completes.
Change a file between pages and confirm the old page stays painted while <code>Changed on disk — Reload</code> appears.
Confirm <code>.env</code> still opens as highlighted text.
Confirm the browser console has no React error and the run screen remains responsive.
Stop only the processes started for this check.
If no suitable live run exists, record that limitation in PR Validation and do not fabricate one, but all automated gates and the spike must still pass.

- [ ] **Step 7: Update exactly one tracker value**

In <code>_bmad-output/implementation-artifacts/archon-source-control/sprint-status.yaml</code>, change only:

~~~yaml
  1-3-open-every-changed-file: backlog
~~~

to:

~~~yaml
  1-3-open-every-changed-file: done
~~~

Keep Epic 1 <code>in-progress</code>.
The current <code>last_updated: 2026-09-06</code> already matches the plan date and must not be rewritten.

- [ ] **Step 8: Commit the tracker update**

~~~bash
git add _bmad-output/implementation-artifacts/archon-source-control/sprint-status.yaml
git commit -m "chore(sc): mark open-every-changed-file story done"
~~~

## Out of Scope

- Epic 2 History, commit log, per-commit files, commit OIDs, and lane graph.
- CAP-8 durable snapshot writing or fallback reads.
- Container overlay reads.
- Secret redaction or a denylist.
- A new public git I/O function or a server git-result cache.
- Persisted split sizes.
- Source Control on sequential non-DAG runs.
- Stage, unstage, edit, discard, commit, or any write operation.

## Pull Request Handoff

Before opening a pull request, rerun <code>bun run validate</code> and copy <code>.github/pull_request_template.md</code> into the PR body.
Target <code>dev</code>, never <code>main</code>.
Keep Problem and outcome, Review guidance, Solution, and Validation, and delete unused conditional sections and every instructional comment.
Record RED/GREEN evidence, the focused and full gates, the spike JSON, the manual check or explicit live-run limitation, cursor staleness, paging, streaming downloads, image/hex/download-only behavior, and object-URL cleanup.
Link the issue with <code>Closes #77</code>.
Do not close the issue separately.
