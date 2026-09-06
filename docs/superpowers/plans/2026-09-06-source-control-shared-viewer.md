# Open a Changed File in the Shared Viewer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.
> Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an operator open any Now changed file from the legacy Source Control tab in one reusable status-keyed viewer without leaving the run screen.

**Architecture:** The <code>@archon/git</code> package owns defensive path parsing, live-path containment, binary-safe file reads, and HEAD-to-worktree hunk production.
The server reuses the existing CAP-6 checkout gate and exposes one OpenAPI JSON diff route plus one raw wildcard content route.
The web keeps the Story 1.1 list snapshot frozen, renders a reusable virtualized list and viewer in a responsive resizable split, and re-reads selected content only on explicit Reload.

**Tech Stack:** Bun 1.3, strict TypeScript, Node <code>execFile</code>, Hono OpenAPI, Zod from <code>@hono/zod-openapi</code>, React 19, TanStack Query 5, <code>react-resizable-panels</code> 4.7.3, <code>react-diff-view</code> 3.3.3, installed <code>highlight.js</code> 11, installed <code>@tanstack/react-virtual</code> 3, and Bun tests.

**Spec:** <code>_bmad-output/planning-artifacts/epics-source-control/epics.md</code>, Story 1.2.

**Canonical design:** <code>_bmad-output/specs/spec-archon-source-control/SPEC.md</code>, CAP-3, CAP-5, and CAP-6.

**Companion decisions:** <code>_bmad-output/specs/spec-archon-source-control/brownfield.md</code>, <code>_bmad-output/specs/spec-archon-source-control/viewer-rules.md</code>, and <code>_bmad-output/planning-artifacts/architecture/architecture-Archon-source-control-2026-09-05/ARCHITECTURE-SPINE.md</code>, AD-1 through AD-6 and AD-9.

**Issue:** GitHub issue #76, tracker key <code>1-2-open-a-changed-file-in-the-shared-viewer</code>.

## Global Constraints

- Story 1.2 is Now-only and must not add History, log records, commit lists, client-supplied tree-ish values, or commit OIDs to HTTP.
- Story 1.3 owns hunk pagination, Load more, the 256 KB or 2,000-line first-paint cutoff, streaming above about 1 MB, download-only above about 50 MB, inline images, and hex peek.
- Story 1.2 must still provide a working download for every NUL-detected binary response; returning an empty attachment is not a usable fallback.
- The surface remains <code>/legacy/workflows/runs/:id</code>, and no file under <code>packages/web/src/experiments/console/</code> may be imported or modified.
- The client sends only <code>runId</code>, the server-issued git-relative path, the fixed Now source selector, and an opaque cursor when one is non-empty.
- The server loads the existing <code>workflow_runs.working_path</code>, and it never accepts <code>working_path</code> or an absolute checkout path from the client.
- The server must not reconstruct the checkout from isolation metadata or add a database column.
- Every git invocation uses an argv array through <code>execFileAsync</code> or <code>execFileBufferAsync</code>, and no implementation may use <code>exec</code>, a shell string, or <code>oid:path</code> syntax.
- Tree-shaped reads use <code>git --literal-pathspecs ls-tree -z TREE -- PATH</code> followed by <code>git cat-file blob BLOB_OID</code>.
- A live candidate is realpathed and must remain beneath the already-realpathed checkout before bytes are read.
- Path validation rejects an empty path, NUL, POSIX absolute paths, Windows drive or UNC paths, and any <code>..</code> segment after URI decoding.
- Filenames containing a colon, a leading dash, spaces, newlines, or glob metacharacters must still work.
- JSON routes use <code>registerOpenApiRoute(createRoute(...), handler)</code>.
- The raw file route uses <code>app.get</code> because OpenAPI 3.0 cannot represent the wildcard path and because successful responses are raw bytes.
- JSON web types come from the regenerated <code>packages/web/src/lib/api.generated.d.ts</code>.
- The raw file client is hand-typed because the raw wildcard route is intentionally absent from OpenAPI.
- Auth remains the global <code>/api/*</code> gate with no <code>requireWebUser</code> call and no per-run owner ACL.
- Both new routes return HTTP 200 with <code>{ emptyReason: "container" | "no_checkout" }</code> for CAP-6.
- Modified files use only the JSON diff route, added files use only raw <code>source=worktree</code>, and deleted files use only raw <code>source=head</code>.
- A ready Now diff always has <code>scope: "now"</code>, <code>ref: "live"</code>, <code>status: "M"</code>, and no snapshot mode.
- Story 1.2 returns all hunks with <code>cursor: ""</code> and <code>truncated: false</code>.
- The web treats <code>cursor</code> as opaque and appends it only when non-empty.
- The list and selected viewer content remain frozen until the operator explicitly accepts <code>Changed on disk — Reload</code>.
- No stage, unstage, edit, discard, commit, or other write control is added.
- Syntax highlighting uses the already-installed <code>highlight.js</code> through its public string API, and tests must prove attacker-controlled markup remains text rather than executable markup.
- Do not add Shiki, Monaco, refractor, a sanitizer dependency, or a second diff library.
- The only new direct production dependency is exactly <code>react-diff-view@3.3.3</code>, and lodash remains transitive.
- <code>react-resizable-panels</code> v4 treats numeric sizes as pixels, so percentage constraints must be strings such as <code>"30%"</code>.
- The split defaults to 30% list and 70% viewer, allows the list to resize from 20% through 70%, and does not persist sizes.
- Modified-file panes scroll independently in both axes and stack before-over-after below 900 CSS pixels.
- Changes and future History scopes use the same list component with distinct ID prefixes.
- Pino events use <code>domain.action_state</code>, pair every started event with completed or failed, and never log checkout paths, remotes, file contents, file paths, or path-bearing error messages.
- Failure logs contain only <code>runId</code> and a stable <code>errorType</code>.
- User copy is terse and non-alarming and must not introduce <code>Error:</code>, <code>unsupported</code>, or a warning glyph.
- <code>mock.module()</code> merges omitted exports from the real module, so all 31 existing <code>@archon/git</code> mock factories must stub the two new public I/O exports in the same task that publishes them.
- Continue using the existing isolated <code>packages/server/src/routes/api.git-changes.test.ts</code> process for all three git HTTP routes because they share one mock graph.
- Continue using the existing isolated <code>packages/web/src/component-integration/source-control-tab.test.tsx</code> process for mounted viewer behavior because it already owns the happy-dom and QueryClient globals.
- Every behavior change follows RED, verified RED, minimal GREEN, verified GREEN, and only then refactoring.
- Run all command blocks from the repository root, and use a subshell for commands that must execute inside a package.
- Do not run <code>bun test</code> from the repository root without a path.
- Do not mark the tracker done until focused tests, affected package suites, <code>bun run validate</code>, <code>git diff --check</code>, and the manual acceptance check all pass.
- Every full Markdown sentence in this plan stays on one physical line.

## File Structure

- Create <code>packages/git/src/git-path.ts</code> for git-relative path validation and realpath containment.
- Create <code>packages/git/src/git-path.test.ts</code> for traversal, special-name, and symlink containment behavior.
- Modify <code>packages/git/src/exec.ts</code> to add the internal binary-safe <code>execFileBufferAsync</code> wrapper.
- Create <code>packages/git/src/file-read.ts</code> for <code>fileAt</code>, <code>fileDiff</code>, NUL detection, content hashing, and unified-diff parsing.
- Create <code>packages/git/src/file-read.test.ts</code> for real-git file and diff behavior.
- Modify <code>packages/git/src/index.ts</code> to export only <code>fileAt</code>, <code>fileDiff</code>, and their data types.
- Modify the 31 existing <code>@archon/git</code> mock-factory test files listed in Task 2.
- Create <code>packages/server/src/routes/git/run-checkout.ts</code> for database lookup plus reuse of <code>resolveRunCheckout</code>.
- Create <code>packages/server/src/routes/git/path-input.ts</code> for transport-level decoded-path validation.
- Modify <code>packages/server/src/routes/git/changes-handler.ts</code> to use <code>loadRunCheckout</code> without changing its response.
- Modify <code>packages/server/src/routes/schemas/git.schemas.ts</code> to add canonical hunk schemas.
- Create <code>packages/server/src/routes/git/diff-route.ts</code> and <code>packages/server/src/routes/git/diff-handler.ts</code>.
- Create <code>packages/server/src/routes/git/file-handler.ts</code>.
- Modify <code>packages/server/src/routes/api.ts</code> to register the JSON diff route and raw wildcard file route.
- Modify <code>packages/server/src/routes/api.git-changes.test.ts</code> to cover changes, diff, and file under its existing isolated mock graph.
- Regenerate <code>packages/web/src/lib/api.generated.d.ts</code>.
- Modify <code>packages/web/src/lib/api.ts</code> and <code>packages/web/src/lib/api.git-changes.test.ts</code> for the diff and raw clients.
- Modify <code>packages/web/package.json</code> and <code>bun.lock</code> for the exact viewer dependency.
- Create <code>packages/web/src/components/workflows/source-control/git-hunk-adapter.ts</code> and <code>git-hunk-adapter.test.ts</code>.
- Create <code>packages/web/src/components/workflows/source-control/syntax-highlight.tsx</code> and <code>syntax-highlight.test.tsx</code>.
- Create <code>packages/web/src/components/workflows/source-control/changed-files-list.tsx</code>.
- Modify <code>packages/web/src/components/workflows/source-control/changed-file-row.tsx</code>, <code>source-control-panel.tsx</code>, and <code>source-control-panel.test.tsx</code>.
- Create <code>packages/web/src/components/workflows/source-control/source-control-diff.css</code>.
- Create <code>packages/web/src/components/workflows/source-control/file-viewer.tsx</code> and <code>file-viewer.test.tsx</code>.
- Create <code>packages/web/src/components/workflows/source-control/source-control-split.tsx</code> and <code>use-stacked-viewport.ts</code>.
- Modify <code>packages/web/src/components/workflows/source-control/source-control-tab.tsx</code>.
- Modify the already-isolated <code>packages/web/src/component-integration/source-control-tab.test.tsx</code>.
- Modify <code>_bmad-output/implementation-artifacts/archon-source-control/sprint-status.yaml</code> only after every acceptance gate passes.
- Do not modify <code>packages/web/src/components/workflows/WorkflowExecution.tsx</code>; its existing one-line <code>SourceControlTab</code> mount is the required boundary.

## Locked Contracts

The public git data contract is:

~~~ts
type DiffChange =
  | { type: 'normal'; content: string; oldLine: number; newLine: number }
  | { type: 'insert'; content: string; newLine: number }
  | { type: 'delete'; content: string; oldLine: number };

interface DiffHunk {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  header: string;
  changes: DiffChange[];
}

interface FileAtResult {
  path: string;
  bytes: Uint8Array;
  binary: boolean;
  contentHash: string;
}

interface FileDiffResult {
  path: string;
  status: 'M';
  scope: 'now';
  ref: 'live';
  hunks: DiffHunk[];
  cursor: '';
  truncated: false;
  binary: boolean;
}
~~~

The JSON diff response is either a ready <code>FileDiffResult</code> or exactly <code>{ emptyReason: "container" | "no_checkout" }</code>.

The diff route is <code>GET /api/workflows/runs/{runId}/git/diff?path=GIT_PATH&cursor=OPAQUE_OPTIONAL</code>.

The raw route is <code>GET /api/workflows/runs/:runId/git/file/*?source=worktree|head</code>.

Successful text and binary raw responses include <code>ETag: "&lt;64-lowercase-hex-contentHash&gt;"</code>.

Text is HTTP 200 <code>text/plain; charset=utf-8</code> with the actual bytes.

Binary is HTTP 200 <code>application/octet-stream</code> with the actual bytes and <code>Content-Disposition: attachment; filename="download"</code>.

CAP-6 is HTTP 200 JSON with no ETag.

Missing run is HTTP 404 with <code>{ error: "Workflow run not found" }</code>.

Invalid path or source is HTTP 400 with <code>{ error: "Invalid file path" }</code> or <code>{ error: "Invalid file source" }</code>.

Missing file is HTTP 404 with <code>{ error: "File not found" }</code>.

Unexpected post-gate failures are opaque HTTP 500 responses with <code>Could not read git diff</code> or <code>Could not read git file</code>.

## Open Questions

None.

The adopted Story 1.2 contract and repository versions resolve the earlier draft choices.

---

### Task 1: Add defensive git path confinement

**Files:**

- Create: <code>packages/git/src/git-path.ts</code>
- Create: <code>packages/git/src/git-path.test.ts</code>

**Interfaces:**

- Produces internal <code>GitPathError</code> with code <code>empty | nul | absolute | dotdot | escape</code>.
- Produces internal <code>parseGitFilePath(raw: string): string</code>.
- Produces internal <code>containLivePath(checkoutRoot: string, relativePath: string): Promise&lt;string&gt;</code>.

- [ ] **Step 1: Write the failing path tests**

Create <code>packages/git/src/git-path.test.ts</code> with the following complete behavior table.

~~~ts
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';

import { containLivePath, GitPathError, parseGitFilePath } from './git-path';

describe('parseGitFilePath', () => {
  test('accepts server-issued special relative names', () => {
    for (const path of [':colon.ts', '-dash.ts', 'foo*.ts', 'path with space.ts', 'line\nbreak.ts', 'src/a.ts']) {
      expect(parseGitFilePath(path)).toBe(path);
    }
  });

  test('rejects empty, NUL, POSIX absolute, Windows absolute, and dot-dot segments', () => {
    for (const path of ['', 'a\0b', '/etc/passwd', '\\\\server\\share', 'C:\\Windows\\x', '../x', 'a/../x', 'a\\..\\x']) {
      expect(() => parseGitFilePath(path)).toThrow(GitPathError);
    }
  });
});

describe('containLivePath', () => {
  let root = '';
  let checkout = '';

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'archon-git-path-'));
    checkout = join(root, 'checkout');
    await mkdir(checkout);
    await writeFile(join(checkout, 'inside.ts'), 'ok\n');
    await mkdir(join(root, 'outside'));
    await writeFile(join(root, 'outside', 'secret.txt'), 'nope\n');
  });

  afterAll(async () => {
    await rm(root, { recursive: true, force: true });
  });

  test('returns the canonical file beneath the canonical checkout', async () => {
    const path = await containLivePath(checkout, 'inside.ts');
    expect(path.endsWith('inside.ts')).toBe(true);
  });

  test.skipIf(process.platform === 'win32')('rejects a symlink that resolves outside', async () => {
    await symlink(join(root, 'outside'), join(checkout, 'escape'));
    await expect(containLivePath(checkout, 'escape/secret.txt')).rejects.toMatchObject({
      name: 'GitPathError',
      code: 'escape',
    });
  });
});
~~~

- [ ] **Step 2: Verify RED**

Run:

~~~bash
( cd packages/git && bun test src/git-path.test.ts )
~~~

Expected: FAIL because <code>packages/git/src/git-path.ts</code> does not exist.

- [ ] **Step 3: Implement the minimal path module**

Create <code>packages/git/src/git-path.ts</code> with this implementation shape.

~~~ts
import { realpath } from 'fs/promises';
import { isAbsolute, join, relative, sep } from 'path';

export type GitPathErrorCode = 'empty' | 'nul' | 'absolute' | 'dotdot' | 'escape';

export class GitPathError extends Error {
  readonly code: GitPathErrorCode;

  constructor(code: GitPathErrorCode) {
    super('Invalid git file path');
    this.name = 'GitPathError';
    this.code = code;
  }
}

export function parseGitFilePath(raw: string): string {
  if (raw.length === 0) throw new GitPathError('empty');
  if (raw.includes('\0')) throw new GitPathError('nul');
  if (
    raw.startsWith('/') ||
    raw.startsWith('\\') ||
    /^[A-Za-z]:[\\/]/.test(raw)
  ) {
    throw new GitPathError('absolute');
  }
  if (raw.split(/[\\/]/).some(segment => segment === '..')) {
    throw new GitPathError('dotdot');
  }
  return raw;
}

export async function containLivePath(
  checkoutRoot: string,
  relativePath: string
): Promise<string> {
  const parsed = parseGitFilePath(relativePath);
  const canonicalRoot = await realpath(checkoutRoot);
  const canonicalCandidate = await realpath(join(canonicalRoot, parsed));
  const fromRoot = relative(canonicalRoot, canonicalCandidate);
  if (
    fromRoot === '..' ||
    fromRoot.startsWith('..' + sep) ||
    isAbsolute(fromRoot)
  ) {
    throw new GitPathError('escape');
  }
  return canonicalCandidate;
}
~~~

Do not catch <code>realpath</code> errors here because the caller must distinguish a missing file from an unexpected filesystem failure.

- [ ] **Step 4: Verify GREEN**

Run:

~~~bash
( cd packages/git && bun test src/git-path.test.ts )
~~~

Expected: PASS.

- [ ] **Step 5: Commit**

~~~bash
git add packages/git/src/git-path.ts packages/git/src/git-path.test.ts
git commit -m "feat(git): confine live file paths"
~~~

---

### Task 2: Add public binary-safe file and Now diff reads

**Files:**

- Modify: <code>packages/git/src/exec.ts</code>
- Create: <code>packages/git/src/file-read.ts</code>
- Create: <code>packages/git/src/file-read.test.ts</code>
- Modify: <code>packages/git/src/index.ts</code>
- Modify: the 31 exact mock files listed in Step 5

**Interfaces:**

- Produces public <code>fileAt(workingPath, relativePath, source): Promise&lt;FileAtResult&gt;</code>.
- Produces public <code>fileDiff(workingPath, relativePath): Promise&lt;FileDiffResult&gt;</code>.
- Keeps <code>parseUnifiedDiff</code>, <code>hasNulInFirst8k</code>, and the error classes internal to the package.

- [ ] **Step 1: Write the failing parser and real-git tests**

Create <code>packages/git/src/file-read.test.ts</code>.

The test fixture must initialize one real repository, commit ordinary and special names plus a 1,048,577-byte NUL fixture, then modify <code>tracked.ts</code>, <code>:colon.ts</code>, and <code>foo*.ts</code>, add <code>added.ts</code> and a NUL file, and delete <code>-dash.ts</code>.

Add these focused assertions before implementation.

~~~ts
test('does not invent a trailing context line or drop content that resembles a file header', () => {
  const stdout = [
    'diff --git a/x b/x',
    '--- a/x',
    '+++ b/x',
    '@@ -0,0 +1,2 @@',
    '+++ literal-content',
    '+tail',
    '',
  ].join('\n');
  expect(parseUnifiedDiff(stdout)).toEqual([
    {
      oldStart: 0,
      oldLines: 0,
      newStart: 1,
      newLines: 2,
      header: '@@ -0,0 +1,2 @@',
      changes: [
        { type: 'insert', content: '++ literal-content', newLine: 1 },
        { type: 'insert', content: 'tail', newLine: 2 },
      ],
    },
  ]);
});

test('detects NUL only within the first 8192 bytes', () => {
  expect(hasNulInFirst8k(new Uint8Array([1, 0, 2]))).toBe(true);
  const late = new Uint8Array(9000);
  late[8192] = 0;
  expect(hasNulInFirst8k(late)).toBe(false);
});
~~~

The real-git tests must prove all of the following with literal expected content.

- HEAD returns the committed <code>tracked.ts</code> bytes through <code>ls-tree -z</code> and <code>cat-file blob</code>.
- Worktree returns the modified <code>tracked.ts</code> and added-file bytes.
- HEAD returns deleted <code>-dash.ts</code> content.
- Colon, leading-dash, glob, spaces, and newlines remain literal pathspecs.
- An in-checkout symlink returns its git blob value, which is the link target string, rather than dereferencing and returning the target file's contents.
- A symlink resolving outside causes <code>fileAt</code> and <code>fileDiff</code> to reject with <code>GitPathError</code>.
- Missing worktree and tree files reject with a named <code>GitFileError</code> whose code is <code>not_found</code>.
- A missing or invalid tree-ish rejects with <code>GitFileError</code> code <code>invalid_ref</code> rather than being misreported as a missing file.
- <code>fileDiff</code> reports HEAD-to-worktree delete and insert lines, <code>scope: "now"</code>, <code>ref: "live"</code>, empty cursor, and no truncation.
- A NUL file returns <code>binary: true</code> and no hunks.
- The committed 1,048,577-byte NUL fixture returns every byte through <code>fileAt</code>, proving the binary download path does not inherit Node's default one-megabyte <code>execFile</code> ceiling.
- Every <code>FileAtResult.contentHash</code> is 64 lowercase hexadecimal characters and changes when bytes change.
- A spy wrapping the real exec functions sees <code>--literal-pathspecs</code>, <code>ls-tree</code>, <code>cat-file</code>, and a separate path argv after <code>--</code>, and never sees <code>HEAD:</code>.

- [ ] **Step 2: Verify RED**

Run:

~~~bash
( cd packages/git && bun test src/file-read.test.ts )
~~~

Expected: FAIL because <code>file-read.ts</code> and <code>execFileBufferAsync</code> do not exist.

- [ ] **Step 3: Add the internal buffer exec wrapper**

Add this export immediately after <code>execFileAsync</code> in <code>packages/git/src/exec.ts</code>.

~~~ts
export async function execFileBufferAsync(
  cmd: string,
  args: string[],
  options?: { timeout?: number; cwd?: string; maxBuffer?: number; env?: NodeJS.ProcessEnv }
): Promise<{ stdout: Buffer; stderr: Buffer }> {
  const result = await promisifiedExecFile(cmd, args, {
    ...options,
    encoding: 'buffer',
  });
  return {
    stdout: Buffer.isBuffer(result.stdout) ? result.stdout : Buffer.from(result.stdout ?? ''),
    stderr: Buffer.isBuffer(result.stderr) ? result.stderr : Buffer.from(result.stderr ?? ''),
  };
}
~~~

Do not export <code>execFileBufferAsync</code> from <code>packages/git/src/index.ts</code> because it has no caller outside this package.

- [ ] **Step 4: Implement <code>file-read.ts</code> minimally**

Use discriminated change types so inserted lines cannot accidentally carry old line numbers and deleted lines cannot accidentally carry new line numbers.

~~~ts
import { createHash } from 'crypto';
import { lstat, readFile, readlink } from 'fs/promises';
import { join } from 'path';

import * as exec from './exec';
import { containLivePath, GitPathError, parseGitFilePath } from './git-path';
import type { RepoPath, WorktreePath } from './types';

export type DiffChange =
  | { type: 'normal'; content: string; oldLine: number; newLine: number }
  | { type: 'insert'; content: string; newLine: number }
  | { type: 'delete'; content: string; oldLine: number };

export interface DiffHunk {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  header: string;
  changes: DiffChange[];
}

export interface FileAtResult {
  path: string;
  bytes: Uint8Array;
  binary: boolean;
  contentHash: string;
}

export interface FileDiffResult {
  path: string;
  status: 'M';
  scope: 'now';
  ref: 'live';
  hunks: DiffHunk[];
  cursor: '';
  truncated: false;
  binary: boolean;
}

export type FileAtSource = { kind: 'worktree' } | { kind: 'tree'; treeIsh: string };
type GitFileErrorCode = 'not_found' | 'invalid_ref';

export class GitFileError extends Error {
  readonly code: GitFileErrorCode;

  constructor(code: GitFileErrorCode) {
    super('Git file read failed');
    this.name = 'GitFileError';
    this.code = code;
  }
}

const HUNK_RE = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

function isMissing(error: unknown): boolean {
  if (!(error instanceof Error) || !('code' in error)) return false;
  const code = (error as NodeJS.ErrnoException).code;
  return code === 'ENOENT' || code === 'ENOTDIR';
}

function hashBytes(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

export function hasNulInFirst8k(bytes: Uint8Array): boolean {
  return bytes.subarray(0, Math.min(8192, bytes.byteLength)).includes(0);
}

export function parseUnifiedDiff(stdout: string): DiffHunk[] {
  if (stdout.includes('Binary files ') || stdout.includes('GIT binary patch')) return [];
  const hunks: DiffHunk[] = [];
  let current: DiffHunk | null = null;
  let oldLine = 0;
  let newLine = 0;
  for (const line of stdout.split('\n')) {
    const match = line.match(HUNK_RE);
    if (match) {
      current = {
        oldStart: Number(match[1]),
        oldLines: Number(match[2] ?? '1'),
        newStart: Number(match[3]),
        newLines: Number(match[4] ?? '1'),
        header: line,
        changes: [],
      };
      oldLine = current.oldStart;
      newLine = current.newStart;
      hunks.push(current);
      continue;
    }
    if (!current || line.startsWith('\\')) continue;
    if (line.startsWith('+')) {
      current.changes.push({ type: 'insert', content: line.slice(1), newLine });
      newLine += 1;
    } else if (line.startsWith('-')) {
      current.changes.push({ type: 'delete', content: line.slice(1), oldLine });
      oldLine += 1;
    } else if (line.startsWith(' ')) {
      current.changes.push({ type: 'normal', content: line.slice(1), oldLine, newLine });
      oldLine += 1;
      newLine += 1;
    }
  }
  return hunks;
}
~~~

Finish <code>fileAt</code> with these exact branches.

~~~ts
export async function fileAt(
  workingPath: RepoPath | WorktreePath,
  relativePath: string,
  source: FileAtSource
): Promise<FileAtResult> {
  const path = parseGitFilePath(relativePath);
  let bytes: Uint8Array;
  if (source.kind === 'worktree') {
    const candidate = join(workingPath, path);
    let entry: Awaited<ReturnType<typeof lstat>>;
    try {
      entry = await lstat(candidate);
    } catch (error) {
      if (isMissing(error)) throw new GitFileError('not_found');
      throw error;
    }
    let canonical: string;
    try {
      canonical = await containLivePath(workingPath, path);
    } catch (error) {
      if (isMissing(error)) throw new GitFileError('not_found');
      throw error;
    }
    const buffer = entry.isSymbolicLink()
      ? Buffer.from(await readlink(candidate))
      : await readFile(canonical);
    bytes = new Uint8Array(buffer);
  } else {
    if (
      source.treeIsh.length === 0 ||
      source.treeIsh.includes('\0') ||
      source.treeIsh.includes(':') ||
      source.treeIsh.startsWith('-')
    ) {
      throw new GitFileError('invalid_ref');
    }
    let listing: { stdout: string };
    try {
      listing = await exec.execFileAsync('git', [
        '-C',
        workingPath,
        '--literal-pathspecs',
        'ls-tree',
        '-z',
        source.treeIsh,
        '--',
        path,
      ]);
    } catch {
      throw new GitFileError('invalid_ref');
    }
    const record = listing.stdout.split('\0').find(value => value.length > 0);
    const tab = record?.indexOf('\t') ?? -1;
    const meta = tab >= 0 ? record?.slice(0, tab).split(' ') : undefined;
    const listedPath = tab >= 0 ? record?.slice(tab + 1) : undefined;
    if (!meta || meta[1] !== 'blob' || !meta[2] || listedPath !== path) {
      throw new GitFileError('not_found');
    }
    const blob = await exec.execFileBufferAsync(
      'git',
      ['-C', workingPath, 'cat-file', 'blob', meta[2]],
      { maxBuffer: Number.POSITIVE_INFINITY }
    );
    bytes = new Uint8Array(blob.stdout);
  }
  return {
    path,
    bytes,
    binary: hasNulInFirst8k(bytes),
    contentHash: hashBytes(bytes),
  };
}
~~~

The unbounded <code>cat-file</code> buffer deliberately avoids inventing a Story 1.2 size cutoff; Story 1.3 must replace this whole-file path with its adopted streaming and download-only policy.

Finish <code>fileDiff</code> with a security-preserving binary probe and one literal HEAD-to-worktree diff command.

~~~ts
async function probeBinary(
  workingPath: RepoPath | WorktreePath,
  path: string,
  source: FileAtSource
): Promise<boolean> {
  try {
    return (await fileAt(workingPath, path, source)).binary;
  } catch (error) {
    if (error instanceof GitPathError) throw error;
    if (error instanceof GitFileError && error.code === 'not_found') return false;
    throw error;
  }
}

export async function fileDiff(
  workingPath: RepoPath | WorktreePath,
  relativePath: string
): Promise<FileDiffResult> {
  const path = parseGitFilePath(relativePath);
  const binary =
    (await probeBinary(workingPath, path, { kind: 'worktree' })) ||
    (await probeBinary(workingPath, path, { kind: 'tree', treeIsh: 'HEAD' }));
  if (binary) {
    return {
      path,
      status: 'M',
      scope: 'now',
      ref: 'live',
      hunks: [],
      cursor: '',
      truncated: false,
      binary: true,
    };
  }
  const diff = await exec.execFileAsync('git', [
    '-C',
    workingPath,
    '--no-optional-locks',
    '--literal-pathspecs',
    'diff',
    '--no-color',
    '--no-ext-diff',
    '--text',
    '-U3',
    'HEAD',
    '--',
    path,
  ]);
  return {
    path,
    status: 'M',
    scope: 'now',
    ref: 'live',
    hunks: parseUnifiedDiff(diff.stdout),
    cursor: '',
    truncated: false,
    binary: false,
  };
}
~~~

- [ ] **Step 5: Publish the narrow API and keep all merging mocks hermetic**

Add only these exports to <code>packages/git/src/index.ts</code>.

~~~ts
export { fileAt, fileDiff } from './file-read';
export type {
  DiffChange,
  DiffHunk,
  FileAtResult,
  FileAtSource,
  FileDiffResult,
} from './file-read';
~~~

Do not export either error class, either path helper, the diff parser, or the buffer exec wrapper from the package root.

Add these two stubs to every existing <code>mock.module('@archon/git')</code> factory.

~~~ts
fileAt: mock(async () => ({
  path: 'x.ts',
  bytes: new Uint8Array(),
  binary: false,
  contentHash: '0'.repeat(64),
})),
fileDiff: mock(async () => ({
  path: 'x.ts',
  status: 'M' as const,
  scope: 'now' as const,
  ref: 'live' as const,
  hunks: [],
  cursor: '' as const,
  truncated: false as const,
  binary: false,
})),
~~~

Use an ordinary async function instead of <code>mock</code> only in a factory that does not import Bun's <code>mock</code>.

Update exactly these 31 files.

1. <code>packages/adapters/src/community/forge/gitea/adapter.test.ts</code>
2. <code>packages/adapters/src/community/forge/gitlab/adapter.test.ts</code>
3. <code>packages/adapters/src/forge/github/adapter.test.ts</code>
4. <code>packages/adapters/src/forge/github/context.test.ts</code>
5. <code>packages/cli/src/commands/isolation.test.ts</code>
6. <code>packages/cli/src/commands/workflow-command-contract.test.ts</code>
7. <code>packages/cli/src/commands/workflow.test.ts</code>
8. <code>packages/core/src/db/workflows.test.ts</code>
9. <code>packages/core/src/operations/isolation-operations.test.ts</code>
10. <code>packages/core/src/operations/workflow-retry.test.ts</code>
11. <code>packages/core/src/orchestrator/orchestrator-agent.test.ts</code>
12. <code>packages/core/src/orchestrator/orchestrator-isolation.test.ts</code>
13. <code>packages/core/src/orchestrator/orchestrator.test.ts</code>
14. <code>packages/core/src/orchestrator/post-message-reminder.test.ts</code>
15. <code>packages/core/src/services/cleanup-service.test.ts</code>
16. <code>packages/isolation/src/pr-state.test.ts</code>
17. <code>packages/server/src/routes/api.auth.test.ts</code>
18. <code>packages/server/src/routes/api.codebases.test.ts</code>
19. <code>packages/server/src/routes/api.git-changes.test.ts</code>
20. <code>packages/server/src/routes/api.health.test.ts</code>
21. <code>packages/server/src/routes/api.messages.test.ts</code>
22. <code>packages/server/src/routes/api.provider-keys.test.ts</code>
23. <code>packages/server/src/routes/api.providers.test.ts</code>
24. <code>packages/server/src/routes/api.usage.test.ts</code>
25. <code>packages/server/src/routes/api.user-ai-prefs.test.ts</code>
26. <code>packages/server/src/routes/api.workflow-runs.test.ts</code>
27. <code>packages/workflows/src/executor-preamble.test.ts</code>
28. <code>packages/workflows/src/executor.test.ts</code>
29. <code>packages/workflows/src/runtime-check.test.ts</code>
30. <code>packages/workflows/src/script-node-deps.test.ts</code>
31. <code>packages/workflows/src/subrun.test.ts</code>

Re-run this inventory and require exactly 31 results.

~~~bash
test "$(rg -l "mock\\.module\\(['\"]@archon/git['\"]" packages | wc -l | tr -d ' ')" = "31"
~~~

- [ ] **Step 6: Verify GREEN**

Run:

~~~bash
( cd packages/git && bun test src/git-path.test.ts )
( cd packages/git && bun test src/file-read.test.ts )
( cd packages/git && bun run type-check )
bun run type-check
~~~

Expected: every command exits 0.

- [ ] **Step 7: Commit**

Stage <code>packages/git/src/exec.ts</code>, <code>packages/git/src/file-read.ts</code>, <code>packages/git/src/file-read.test.ts</code>, <code>packages/git/src/index.ts</code>, and the 31 listed mock files.

~~~bash
git diff --cached --name-only
git commit -m "feat(git): read changed file content and diffs"
~~~

Confirm the staged list contains no unrelated file before committing.

---

### Task 3: Add the Now diff JSON route

**Files:**

- Create: <code>packages/server/src/routes/git/run-checkout.ts</code>
- Create: <code>packages/server/src/routes/git/path-input.ts</code>
- Modify: <code>packages/server/src/routes/git/changes-handler.ts</code>
- Modify: <code>packages/server/src/routes/schemas/git.schemas.ts</code>
- Create: <code>packages/server/src/routes/git/diff-route.ts</code>
- Create: <code>packages/server/src/routes/git/diff-handler.ts</code>
- Modify: <code>packages/server/src/routes/api.ts</code>
- Modify: <code>packages/server/src/routes/api.git-changes.test.ts</code>

**Interfaces:**

- Produces <code>loadRunCheckout(runId: string): Promise&lt;CheckoutGateResult&gt;</code>.
- Produces <code>isValidGitFilePath(raw: string): boolean</code> for already-decoded HTTP input.
- Produces <code>GET /api/workflows/runs/{runId}/git/diff</code>.

- [ ] **Step 1: Add failing diff-route tests to the existing isolated HTTP file**

Extend the existing <code>@archon/git</code> factory in <code>api.git-changes.test.ts</code> with named <code>mockFileAt</code> and <code>mockFileDiff</code> functions.

Reset and restore their default implementations in the existing <code>beforeEach</code>.

Add tests with these exact behaviors and literal bodies.

~~~ts
test('returns a ready Now hunk response from the canonical checkout', async () => {
  const canonical = await realpath(checkoutDir);
  mockFileDiff.mockResolvedValueOnce({
    path: 'src/a.ts',
    status: 'M',
    scope: 'now',
    ref: 'live',
    hunks: [{
      oldStart: 0,
      oldLines: 0,
      newStart: 1,
      newLines: 1,
      header: '@@ -0,0 +1 @@',
      changes: [{ type: 'insert', content: 'x', newLine: 1 }],
    }],
    cursor: '',
    truncated: false,
    binary: false,
  });
  const response = await makeApp().request(
    '/api/workflows/runs/run-1/git/diff?path=src%2Fa.ts&cursor=opaque-token&working_path=%2Fetc'
  );
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({
    path: 'src/a.ts',
    status: 'M',
    scope: 'now',
    ref: 'live',
    cursor: '',
    truncated: false,
    binary: false,
  });
  expect(mockFileDiff).toHaveBeenCalledWith(canonical, 'src/a.ts');
});
~~~

Add separate tests for each of these mutations.

- Missing <code>path</code> returns the repository's standard OpenAPI validation 400 before the handler or <code>fileDiff</code>; decoded <code>../x</code>, decoded <code>a\..\x</code>, POSIX absolute, Windows absolute, and NUL enter the handler and return exactly <code>{ error: "Invalid file path" }</code> before <code>fileDiff</code>.
- Colon, leading-dash, and glob paths reach <code>fileDiff</code> unchanged.
- A missing run returns the existing 404 body.
- Container and null <code>working_path</code> each return HTTP 200 with only <code>emptyReason</code> and do not call <code>fileDiff</code>.
- Removing the checkout inside <code>mockFileDiff</code> before it rejects causes a second gate check and returns HTTP 200 <code>{ emptyReason: "no_checkout" }</code>, not 404 or 500.
- Add the parallel regression to the existing Changes-route cases by removing the checkout inside <code>mockChangedFiles</code> before rejection and expecting its established CAP-6 changes envelope.
- A named <code>GitFileError</code> with code <code>not_found</code> maps to the file 404 body.
- A named <code>GitPathError</code> maps to the invalid-path 400 body.
- An unexpected path-bearing error maps to the opaque 500 body, and serialized logger calls do not contain the checkout or requested path.
- Every request that enters the handler records <code>git.diff_started</code> followed by exactly one <code>git.diff_completed</code> or <code>git.diff_failed</code>.
- Completed logs may contain <code>runId</code>, <code>emptyReason</code>, <code>binary</code>, and <code>truncated</code>.
- Failed logs contain only <code>runId</code> and a stable <code>errorType</code>.

- [ ] **Step 2: Verify RED**

Run:

~~~bash
( cd packages/server && bun test src/routes/api.git-changes.test.ts )
~~~

Expected: the existing changes tests pass and the new diff tests fail because the route is not registered.

- [ ] **Step 3: Extract the existing checkout-loading adapter**

Create <code>run-checkout.ts</code> by moving only the database and filesystem adapter code from <code>changes-handler.ts</code>.

The complete exported function must retain the existing CAP-6 behavior.

~~~ts
import { realpath, stat } from 'fs/promises';

import * as conversationDb from '@archon/core/db/conversations';
import * as isolationEnvDb from '@archon/core/db/isolation-environments';
import * as workflowDb from '@archon/core/db/workflows';
import { isGitWorkTree, toWorktreePath } from '@archon/git';

import { resolveRunCheckout, type CheckoutGateResult } from './checkout-gate';

async function pathExists(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}

export async function loadRunCheckout(runId: string): Promise<CheckoutGateResult> {
  const run = await workflowDb.getWorkflowRun(runId);
  return resolveRunCheckout({
    run: run ? { conversation_id: run.conversation_id, working_path: run.working_path } : null,
    getConversationById: async id => {
      const conversation = await conversationDb.getConversationById(id);
      return conversation ? { isolation_env_id: conversation.isolation_env_id } : null;
    },
    getIsolationEnvById: async id => {
      const environment = await isolationEnvDb.getById(id);
      return environment ? { provider: environment.provider } : null;
    },
    pathExists,
    realpathFn: realpath,
    isGitWorkTree: path => isGitWorkTree(toWorktreePath(path)),
  });
}
~~~

Replace the inline lookup in <code>handleGitChanges</code> with <code>const gate = await loadRunCheckout(runId)</code>.

If <code>changedFiles</code> rejects after a ready gate, call <code>loadRunCheckout</code> once more and return CAP-6 when the checkout disappeared; otherwise preserve the existing opaque 500 response.

Do not change the changes response or log contract.

- [ ] **Step 4: Add transport validation and Zod schemas**

Create <code>path-input.ts</code>.

~~~ts
export function isValidGitFilePath(raw: string): boolean {
  if (raw.length === 0 || raw.includes('\0')) return false;
  if (raw.startsWith('/') || raw.startsWith('\\') || /^[A-Za-z]:[\\/]/.test(raw)) {
    return false;
  }
  return !raw.split(/[\\/]/).some(segment => segment === '..');
}
~~~

Append schemas to <code>git.schemas.ts</code> and derive every server type with <code>z.infer</code>.

Use <code>nonnegative()</code>, not <code>positive()</code>, for hunk starts because valid empty-side hunks begin at zero.

~~~ts
export const gitDiffChangeSchema = z
  .union([
    z.object({
      type: z.literal('normal'),
      content: z.string(),
      oldLine: z.number().int().positive(),
      newLine: z.number().int().positive(),
    }),
    z.object({
      type: z.literal('insert'),
      content: z.string(),
      newLine: z.number().int().positive(),
    }),
    z.object({
      type: z.literal('delete'),
      content: z.string(),
      oldLine: z.number().int().positive(),
    }),
  ])
  .openapi('GitDiffChange');

export const gitDiffHunkSchema = z
  .object({
    oldStart: z.number().int().nonnegative(),
    oldLines: z.number().int().nonnegative(),
    newStart: z.number().int().nonnegative(),
    newLines: z.number().int().nonnegative(),
    header: z.string(),
    changes: z.array(gitDiffChangeSchema),
  })
  .openapi('GitDiffHunk');

const gitReadyDiffResponseSchema = z.object({
  path: z.string().min(1),
  status: z.literal('M'),
  scope: z.enum(['now', 'commit']),
  ref: z.string().min(1),
  hunks: z.array(gitDiffHunkSchema),
  cursor: z.string(),
  truncated: z.boolean(),
  binary: z.boolean(),
});

const gitEmptyDiffResponseSchema = z.object({
  emptyReason: gitEmptyReasonSchema,
});

export const gitDiffResponseSchema = z
  .union([gitReadyDiffResponseSchema, gitEmptyDiffResponseSchema])
  .openapi('GitDiffResponse');

export type GitDiffResponse = z.infer<typeof gitDiffResponseSchema>;
~~~

- [ ] **Step 5: Add the OpenAPI route and thin handler**

Create <code>diff-route.ts</code> with method <code>get</code>, path <code>/api/workflows/runs/{runId}/git/diff</code>, required <code>path</code>, optional string <code>cursor</code>, and documented 200, 400, 404, and 500 responses.

Use <code>gitDiffResponseSchema</code> for 200 and the existing <code>errorSchema</code> for failures.

Create <code>diff-handler.ts</code> with this control-flow order.

1. Read <code>runId</code> and decoded query <code>path</code>.
2. Log <code>git.diff_started</code> with only <code>runId</code>.
3. Reject invalid transport paths before checkout lookup or git.
4. Call <code>loadRunCheckout</code>.
5. Map missing run and CAP-6.
6. Call <code>fileDiff(toWorktreePath(gate.workingPath), path)</code>.
7. Return the result without reading or interpreting <code>cursor</code>.
8. If the git read rejects after a ready gate, call <code>loadRunCheckout</code> once more and return CAP-6 if the checkout vanished.
9. Classify named <code>GitPathError</code> and named <code>GitFileError</code> structurally because their classes are intentionally not public package exports.
10. Log only stable error types such as <code>invalid_path</code>, <code>run_not_found</code>, <code>file_not_found</code>, and <code>git_read_failed</code>.
11. Never log the path or caught error message.

Use this local structural classifier in <code>diff-handler.ts</code> because the package deliberately does not publish its error classes.

~~~ts
type ClassifiedGitReadError = 'invalid_path' | 'file_not_found' | 'git_read_failed';

function classifyGitReadError(error: unknown): ClassifiedGitReadError {
  if (typeof error !== 'object' || error === null) return 'git_read_failed';
  const candidate = error as { name?: unknown; code?: unknown };
  if (candidate.name === 'GitPathError') return 'invalid_path';
  if (candidate.name === 'GitFileError' && candidate.code === 'not_found') {
    return 'file_not_found';
  }
  return 'git_read_failed';
}
~~~

Map <code>invalid_path</code> to HTTP 400 with <code>Invalid file path</code>, <code>file_not_found</code> to HTTP 404 with <code>File not found</code>, and <code>git_read_failed</code> to HTTP 500 with <code>Could not read git diff</code>.

For validation, missing-run, CAP-6, success, and caught-error branches, emit one terminal log beside the response so no early return can omit or duplicate the pair.

Register it next to <code>gitChangesRoute</code> in <code>api.ts</code>.

~~~ts
registerOpenApiRoute(gitDiffRoute, async c => {
  return handleGitDiff(c, apiError);
});
~~~

Do not add a server package test-script entry because this route is tested in the already-isolated git HTTP file.

- [ ] **Step 6: Verify GREEN**

Run:

~~~bash
( cd packages/server && bun test src/routes/api.git-changes.test.ts )
( cd packages/server && bun test src/routes/git/checkout-gate.test.ts )
( cd packages/server && bun run type-check )
~~~

Expected: every command exits 0.

- [ ] **Step 7: Commit**

~~~bash
git add packages/server/src/routes/git/run-checkout.ts \
  packages/server/src/routes/git/path-input.ts \
  packages/server/src/routes/git/changes-handler.ts \
  packages/server/src/routes/schemas/git.schemas.ts \
  packages/server/src/routes/git/diff-route.ts \
  packages/server/src/routes/git/diff-handler.ts \
  packages/server/src/routes/api.ts \
  packages/server/src/routes/api.git-changes.test.ts
git commit -m "feat(server): expose Now git hunks"
~~~

---

### Task 4: Add the raw text and binary file route

**Files:**

- Create: <code>packages/server/src/routes/git/file-handler.ts</code>
- Modify: <code>packages/server/src/routes/api.ts</code>
- Modify: <code>packages/server/src/routes/api.git-changes.test.ts</code>

**Interfaces:**

- Produces <code>GET /api/workflows/runs/:runId/git/file/*?source=worktree|head</code>.
- Produces byte-preserving text and binary responses with a content-hash ETag.

- [ ] **Step 1: Add failing raw-route tests to the existing git HTTP file**

Add tests that use the existing <code>makeApp</code>, checkout, database, logger, and git mocks.

Use a default <code>mockFileAt</code> result with <code>bytes: Uint8Array.from([0x68, 0x69, 0x0a])</code>, <code>binary: false</code>, and <code>contentHash: "a".repeat(64)</code>.

Cover these exact cases.

- Missing and unknown source values return the literal invalid-source 400 body.
- Encoded slash, colon, leading dash, glob, spaces, and newlines arrive at <code>fileAt</code> as the original git path.
- Encoded slash traversal, backslash traversal, POSIX absolute, Windows absolute, NUL, and malformed percent encoding return 400 before <code>fileAt</code>.
- <code>source=worktree</code> calls <code>fileAt</code> with <code>{ kind: "worktree" }</code>.
- <code>source=head</code> calls <code>fileAt</code> with <code>{ kind: "tree", treeIsh: "HEAD" }</code>.
- A missing run returns 404.
- Container and null <code>working_path</code> return CAP-6 JSON with no ETag and no <code>fileAt</code> call.
- Removing the checkout inside <code>mockFileAt</code> before it rejects causes a second gate check and returns HTTP 200 <code>{ emptyReason: "no_checkout" }</code> with no ETag.
- Text returns the exact bytes, text content type, and quoted content-hash ETag.
- Binary returns the exact non-empty bytes, octet-stream content type, attachment header, and quoted content-hash ETag.
- Named missing-file and path errors map to 404 and 400.
- Unexpected errors map to the opaque 500 and do not leak paths through the response or logger.
- Started, completed, and failed logging obeys the locked field allowlists.

The binary assertion must be literal and must fail if the implementation returns an empty attachment.

~~~ts
expect(Array.from(new Uint8Array(await response.arrayBuffer()))).toEqual([0, 1, 2]);
~~~

- [ ] **Step 2: Verify RED**

Run:

~~~bash
( cd packages/server && bun test src/routes/api.git-changes.test.ts )
~~~

Expected: diff and changes tests pass and the new file tests fail because the wildcard route is absent.

- [ ] **Step 3: Implement the raw handler**

Create <code>file-handler.ts</code>.

Extract the wildcard path from the first <code>/git/file/</code> marker in <code>c.req.path</code> rather than rebuilding a prefix from the decoded <code>runId</code>, so an encoded run ID cannot break extraction.

Decode exactly once with <code>decodeURIComponent</code>, then call <code>isValidGitFilePath</code>.

Copy the Task 3 structural classifier into <code>file-handler.ts</code>; two route-local uses do not justify a shared abstraction under the repository's Rule of Three.

After a ready gate, re-run <code>loadRunCheckout</code> once when <code>fileAt</code> rejects and return CAP-6 if the checkout disappeared before classifying the file-read error.

Add <code>invalid_source</code> for source validation, retain <code>invalid_path</code>, <code>run_not_found</code>, <code>file_not_found</code>, and <code>git_read_failed</code>, and map the last code to HTTP 500 with <code>Could not read git file</code>.

Log <code>git.file_started</code> with only <code>runId</code>, log completed with only <code>runId</code>, <code>emptyReason</code>, and <code>binary</code> when applicable, and log failed with only <code>runId</code> and <code>errorType</code>.

Return bytes and headers with this exact success branch.

~~~ts
const headers = {
  ETag: '"' + result.contentHash + '"',
  'Content-Type': result.binary
    ? 'application/octet-stream'
    : 'text/plain; charset=utf-8',
  ...(result.binary
    ? { 'Content-Disposition': 'attachment; filename="download"' }
    : {}),
};
return new Response(Buffer.from(result.bytes), { status: 200, headers });
~~~

The handler must return CAP-6 JSON before constructing raw headers.

The handler must never decode text on the server merely to decide whether it is binary because <code>fileAt</code> already applied the NUL-in-first-8KB rule.

- [ ] **Step 4: Register the raw route**

Register the route near the JSON git routes in <code>api.ts</code>.

~~~ts
// GET /api/workflows/runs/:runId/git/file/*
// The wildcard carries a server-issued git-relative path and is decoded exactly once.
// NUL, absolute paths, and any slash or backslash ".." segment are rejected after decoding.
// OpenAPI 3.0 cannot represent this wildcard, and successful responses are raw bytes.
app.get('/api/workflows/runs/:runId/git/file/*', async c => {
  return handleGitFile(c, apiError);
});
~~~

Do not call <code>requireWebUser</code>.

- [ ] **Step 5: Verify GREEN**

Run:

~~~bash
( cd packages/server && bun test src/routes/api.git-changes.test.ts )
( cd packages/server && bun test src/routes/git/checkout-gate.test.ts )
( cd packages/server && bun run type-check )
~~~

Expected: every command exits 0.

- [ ] **Step 6: Commit**

~~~bash
git add packages/server/src/routes/git/file-handler.ts \
  packages/server/src/routes/api.ts \
  packages/server/src/routes/api.git-changes.test.ts
git commit -m "feat(server): serve changed file bytes"
~~~

---

### Task 5: Generate the web contract and add cancellable clients

**Files:**

- Regenerate: <code>packages/web/src/lib/api.generated.d.ts</code>
- Modify: <code>packages/web/src/lib/api.ts</code>
- Modify: <code>packages/web/src/lib/api.git-changes.test.ts</code>

**Interfaces:**

- Produces <code>getWorkflowRunGitDiff(runId, path, options)</code>.
- Produces <code>gitFileUrl(runId, path, source)</code>.
- Produces <code>getWorkflowRunGitFile(runId, path, source, init)</code>.

- [ ] **Step 1: Add failing client behavior tests**

Extend <code>api.git-changes.test.ts</code> with these cases.

- Diff encodes the run ID and query path, omits <code>cursor=</code> when empty, and echoes a non-empty opaque cursor without parsing it.
- Diff forwards the exact <code>AbortSignal</code> in <code>RequestInit</code>.
- Raw URL encoding applies <code>encodeURIComponent</code> to each path segment while preserving slash separators.
- Added and deleted source values serialize only as <code>worktree</code> and <code>head</code>.
- Text returns <code>{ kind: "text", text, contentHash }</code> from a quoted ETag.
- Octet stream returns <code>{ kind: "binary", contentHash }</code> without calling <code>response.text()</code>.
- CAP-6 JSON returns <code>{ kind: "empty", emptyReason }</code> and does not require an ETag.
- A successful raw non-CAP-6 response without a valid 64-hex ETag fails fast.
- Non-2xx errors retain the existing bounded API-error behavior, but UI tests never render the thrown message.

- [ ] **Step 2: Verify RED**

Run:

~~~bash
( cd packages/web && bun test src/lib/api.git-changes.test.ts )
~~~

Expected: FAIL because the new client exports do not exist.

- [ ] **Step 3: Regenerate OpenAPI types**

Start only the server in one terminal.

~~~bash
bun run dev:server
~~~

After port 3090 is listening, run this from the repository root in another terminal.

~~~bash
bun --filter @archon/web generate:types
~~~

Stop only the server process started for generation.

Do not hand-edit <code>api.generated.d.ts</code>.

Verify the JSON route and schemas are present and the raw wildcard route is absent.

~~~bash
rg -n '"/api/workflows/runs/\{runId\}/git/diff"|GitDiffResponse|GitDiffHunk|GitDiffChange' packages/web/src/lib/api.generated.d.ts
! rg -n 'git/file' packages/web/src/lib/api.generated.d.ts
~~~

- [ ] **Step 4: Add generated aliases and clients**

Add these types near the existing git aliases in <code>api.ts</code>.

~~~ts
export type GitDiffResponse = components['schemas']['GitDiffResponse'];
export type GitReadyDiffResponse = Exclude<
  GitDiffResponse,
  { emptyReason: GitEmptyReason }
>;
export type GitDiffHunk = components['schemas']['GitDiffHunk'];
export type GitDiffChange = components['schemas']['GitDiffChange'];
export type GitFileSource = 'worktree' | 'head';
export type GitFileClientResult =
  | { kind: 'empty'; emptyReason: GitEmptyReason }
  | { kind: 'binary'; contentHash: string }
  | { kind: 'text'; text: string; contentHash: string };
~~~

Implement cursor handling exactly.

~~~ts
export async function getWorkflowRunGitDiff(
  runId: string,
  path: string,
  options?: { cursor?: string; signal?: AbortSignal }
): Promise<GitDiffResponse> {
  const params = new URLSearchParams({ path });
  if (options?.cursor) params.set('cursor', options.cursor);
  return fetchJSON(
    '/api/workflows/runs/' +
      encodeURIComponent(runId) +
      '/git/diff?' +
      params.toString(),
    options?.signal ? { signal: options.signal } : undefined
  );
}
~~~

Implement raw URL construction by encoding segments, not the whole path.

Require a quoted or unquoted 64-hex ETag only after CAP-6 JSON has been handled.

Cancel an octet-stream response body before returning the binary descriptor so inspection never dumps or unnecessarily retains the bytes.

The browser will perform a fresh same-origin GET through <code>gitFileUrl</code> when the operator activates Download.

Use this URL and response branch shape, extracting the current bounded non-2xx body handling from <code>fetchJSON</code> into one private helper so both clients preserve the existing 200-character limit.

~~~ts
export function gitFileUrl(runId: string, path: string, source: GitFileSource): string {
  const encodedPath = path.split('/').map(segment => encodeURIComponent(segment)).join('/');
  return (
    '/api/workflows/runs/' +
    encodeURIComponent(runId) +
    '/git/file/' +
    encodedPath +
    '?source=' +
    encodeURIComponent(source)
  );
}

function contentHashFromEtag(response: Response): string {
  const etag = response.headers.get('ETag') ?? '';
  const match = etag.match(/^(?:"([a-f0-9]{64})"|([a-f0-9]{64}))$/);
  const contentHash = match?.[1] ?? match?.[2];
  if (!contentHash) throw new Error('Invalid git file response');
  return contentHash;
}

export async function getWorkflowRunGitFile(
  runId: string,
  path: string,
  source: GitFileSource,
  options?: { signal?: AbortSignal }
): Promise<GitFileClientResult> {
  const url = gitFileUrl(runId, path, source);
  const response = await fetch(url, options?.signal ? { signal: options.signal } : undefined);
  await assertApiResponseOk(response, url);
  const contentType = response.headers.get('Content-Type') ?? '';
  if (contentType.includes('application/json')) {
    const body: unknown = await response.json();
    if (
      typeof body === 'object' &&
      body !== null &&
      'emptyReason' in body &&
      (body.emptyReason === 'container' || body.emptyReason === 'no_checkout')
    ) {
      return { kind: 'empty', emptyReason: body.emptyReason };
    }
    throw new Error('Invalid git file response');
  }
  const contentHash = contentHashFromEtag(response);
  if (contentType.includes('application/octet-stream')) {
    await response.body?.cancel();
    return { kind: 'binary', contentHash };
  }
  if (contentType.includes('text/plain')) {
    return { kind: 'text', text: await response.text(), contentHash };
  }
  throw new Error('Invalid git file response');
}
~~~

Name the extracted non-2xx helper <code>assertApiResponseOk(response: Response, url: string): Promise&lt;void&gt;</code>, have <code>fetchJSON</code> call it before <code>res.json()</code>, and keep the existing status, path-only URL, and 200-character body truncation exactly unchanged.

- [ ] **Step 5: Verify GREEN**

Run:

~~~bash
( cd packages/web && bun test src/lib/api.git-changes.test.ts )
( cd packages/web && bun run type-check )
~~~

Expected: both commands exit 0.

- [ ] **Step 6: Commit**

~~~bash
git add packages/web/src/lib/api.generated.d.ts \
  packages/web/src/lib/api.ts \
  packages/web/src/lib/api.git-changes.test.ts
git commit -m "feat(web): add changed file read clients"
~~~

---

### Task 6: Pin the viewer and adapt hunks and syntax safely

**Files:**

- Modify: <code>packages/web/package.json</code>
- Modify: <code>bun.lock</code>
- Create: <code>packages/web/src/components/workflows/source-control/git-hunk-adapter.ts</code>
- Create: <code>packages/web/src/components/workflows/source-control/git-hunk-adapter.test.ts</code>
- Create: <code>packages/web/src/components/workflows/source-control/syntax-highlight.tsx</code>
- Create: <code>packages/web/src/components/workflows/source-control/syntax-highlight.test.tsx</code>

**Interfaces:**

- Produces <code>toHunkData</code> and <code>hunksForSide</code> with the actual <code>react-diff-view@3.3.3</code> union types.
- Produces <code>highlightedHtml</code>, <code>highlightDiffTokens</code>, and <code>renderHighlightedToken</code>.

- [ ] **Step 1: Install the exact dependency**

Run:

~~~bash
( cd packages/web && bun add --exact react-diff-view@3.3.3 )
~~~

Expected: <code>packages/web/package.json</code> contains exactly <code>"react-diff-view": "3.3.3"</code>, and the repository's existing <code>bun.lock</code> changes.

Do not add lodash directly.

- [ ] **Step 2: Write failing hunk-adapter tests**

The adapter tests must assert the real 3.3.3 shapes.

~~~ts
expect(toChangeData({ type: 'insert', content: 'new', newLine: 2 })).toEqual({
  type: 'insert',
  content: 'new',
  lineNumber: 2,
  isInsert: true,
});
expect(toChangeData({ type: 'delete', content: 'old', oldLine: 3 })).toEqual({
  type: 'delete',
  content: 'old',
  lineNumber: 3,
  isDelete: true,
});
expect(toChangeData({
  type: 'normal',
  content: 'same',
  oldLine: 4,
  newLine: 5,
})).toEqual({
  type: 'normal',
  content: 'same',
  oldLineNumber: 4,
  newLineNumber: 5,
  isNormal: true,
});
~~~

Add a malformed generated change fixture missing its required line number and assert the adapter throws a stable <code>Invalid git hunk change</code> error.

Add a side-filter test proving old drops insertions and new drops deletions while both keep normal lines.

- [ ] **Step 3: Verify adapter RED**

Run:

~~~bash
( cd packages/web && bun test src/components/workflows/source-control/git-hunk-adapter.test.ts )
~~~

Expected: FAIL because the adapter does not exist.

- [ ] **Step 4: Implement the mapper against actual dependency types**

Create <code>git-hunk-adapter.ts</code>.

Do not emit the draft's nonexistent combination of <code>lineNumber</code>, <code>oldLineNumber</code>, <code>newLineNumber</code>, and all three boolean flags on every union member.

Use this exhaustive mapping, including the runtime checks that make malformed generated data fail fast.

~~~ts
import type { ChangeData, HunkData } from 'react-diff-view';

import type { GitDiffChange, GitDiffHunk } from '@/lib/api';

function requiredLine(value: number | undefined): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) {
    throw new Error('Invalid git hunk change');
  }
  return value;
}

export function toChangeData(change: GitDiffChange): ChangeData {
  switch (change.type) {
    case 'insert':
      return {
        type: 'insert',
        content: change.content,
        lineNumber: requiredLine(change.newLine),
        isInsert: true,
      };
    case 'delete':
      return {
        type: 'delete',
        content: change.content,
        lineNumber: requiredLine(change.oldLine),
        isDelete: true,
      };
    case 'normal':
      return {
        type: 'normal',
        content: change.content,
        oldLineNumber: requiredLine(change.oldLine),
        newLineNumber: requiredLine(change.newLine),
        isNormal: true,
      };
  }
}

export function toHunkData(hunk: GitDiffHunk): HunkData {
  return {
    content: hunk.header,
    oldStart: hunk.oldStart,
    oldLines: hunk.oldLines,
    newStart: hunk.newStart,
    newLines: hunk.newLines,
    changes: hunk.changes.map(toChangeData),
  };
}

export function hunksForSide(hunks: readonly HunkData[], side: 'old' | 'new'): HunkData[] {
  return hunks.flatMap(hunk => {
    const changes = hunk.changes.filter(change =>
      side === 'old' ? change.type !== 'insert' : change.type !== 'delete'
    );
    return changes.length === 0 ? [] : [{ ...hunk, changes }];
  });
}
~~~

- [ ] **Step 5: Write failing safe-highlight tests**

Create <code>syntax-highlight.test.tsx</code>.

Use <code>renderToStaticMarkup</code> to prove ordinary TypeScript receives at least one <code>hljs-</code> token class.

Use attacker-controlled <code>&lt;img src=x onerror=alert(1)&gt;</code> as input and prove the rendered markup contains escaped text and no real <code>&lt;img</code> element.

Test both full-file HTML and a diff token rendered through <code>renderHighlightedToken</code>.

- [ ] **Step 6: Verify highlight RED**

Run:

~~~bash
( cd packages/web && bun test src/components/workflows/source-control/syntax-highlight.test.tsx )
~~~

Expected: FAIL because the highlight module does not exist.

- [ ] **Step 7: Implement highlighting with the public highlight.js API**

Create <code>syntax-highlight.tsx</code>.

Import <code>highlight.js/lib/common</code>, call <code>highlightAuto(raw).value</code>, and inject only that library-produced HTML.

Do not call <code>highlightElement</code> on an element that already contains untrusted markup.

For diff lines, build <code>HunkTokens</code> arrays indexed by the dependency's real line numbers.

Use a custom token with <code>type: "highlighted"</code> and the safe highlighted HTML in <code>value</code>.

Populate both old and new arrays for normal changes, only old for deletes, and only new for inserts.

Implement <code>renderHighlightedToken</code> so only <code>highlighted</code> uses <code>dangerouslySetInnerHTML</code> and every other token delegates to the dependency's default renderer.

The global app stylesheet already imports <code>highlight.js/styles/github-dark-dimmed.min.css</code>, so do not add a second theme.

Use this exact token indexing and renderer shape so the dependency's <code>lineNumber - 1</code> lookups receive the intended line.

~~~tsx
import hljs from 'highlight.js/lib/common';
import type { HunkData, HunkTokens, RenderToken, TokenNode } from 'react-diff-view';

export function highlightedHtml(raw: string): string {
  return hljs.highlightAuto(raw).value;
}

function highlightedToken(content: string): TokenNode[] {
  return [{ type: 'highlighted', value: highlightedHtml(content) }];
}

export function highlightDiffTokens(hunks: readonly HunkData[]): HunkTokens {
  const old: TokenNode[][] = [];
  const next: TokenNode[][] = [];
  for (const hunk of hunks) {
    for (const change of hunk.changes) {
      if (change.type === 'insert') {
        next[change.lineNumber - 1] = highlightedToken(change.content);
      } else if (change.type === 'delete') {
        old[change.lineNumber - 1] = highlightedToken(change.content);
      } else {
        old[change.oldLineNumber - 1] = highlightedToken(change.content);
        next[change.newLineNumber - 1] = highlightedToken(change.content);
      }
    }
  }
  return { old, new: next };
}

export const renderHighlightedToken: RenderToken = (token, renderDefault, index) => {
  if (token.type !== 'highlighted' || typeof token.value !== 'string') {
    return renderDefault(token, index);
  }
  return <span key={index} dangerouslySetInnerHTML={{ __html: token.value }} />;
};
~~~

- [ ] **Step 8: Verify GREEN**

Run:

~~~bash
( cd packages/web && bun test src/components/workflows/source-control/git-hunk-adapter.test.ts )
( cd packages/web && bun test src/components/workflows/source-control/syntax-highlight.test.tsx )
( cd packages/web && bun run type-check )
~~~

Expected: every command exits 0.

- [ ] **Step 9: Commit**

~~~bash
git add packages/web/package.json bun.lock \
  packages/web/src/components/workflows/source-control/git-hunk-adapter.ts \
  packages/web/src/components/workflows/source-control/git-hunk-adapter.test.ts \
  packages/web/src/components/workflows/source-control/syntax-highlight.tsx \
  packages/web/src/components/workflows/source-control/syntax-highlight.test.tsx
git commit -m "feat(web): prepare highlighted diff rendering"
~~~

---

### Task 7: Extract a reusable, virtualized, selectable file list

**Files:**

- Create: <code>packages/web/src/components/workflows/source-control/changed-files-list.tsx</code>
- Modify: <code>packages/web/src/components/workflows/source-control/changed-file-row.tsx</code>
- Modify: <code>packages/web/src/components/workflows/source-control/source-control-panel.tsx</code>
- Modify: <code>packages/web/src/components/workflows/source-control/source-control-panel.test.tsx</code>
- Modify: <code>packages/web/src/component-integration/source-control-tab.test.tsx</code>

**Interfaces:**

- Produces reusable <code>ChangedFilesList</code> with caller-supplied <code>ariaLabel</code>, <code>idPrefix</code>, files, active index, selected path, list ref, active-index callback, and open callback.
- Extends <code>SourceControlPanel</code> with optional <code>onOpenFile</code>, <code>selectedPath</code>, <code>ariaLabel</code>, and <code>listRef</code>.

- [ ] **Step 1: Add failing list behavior tests**

Extend <code>source-control-panel.test.tsx</code> so a caller-supplied <code>ariaLabel</code> and <code>idPrefix</code> appear in the rendered listbox and option IDs.

Update the selected-state expectation so <code>aria-selected</code> represents the opened file, while <code>data-active</code> represents the active descendant.

Extend the already-isolated mounted tab test with a direct <code>SourceControlPanel</code> render that dispatches Enter and Space on the active row and clicks a second row.

Assert the callback receives the exact file for each interaction.

Add a 200-file mounted case that gives the listbox a 280-pixel measured rectangle, waits for the virtualizer, and asserts that fewer than 200 options are mounted.

Scroll to a later index and assert the later path becomes mounted.

- [ ] **Step 2: Verify RED**

Run:

~~~bash
( cd packages/web && bun test src/components/workflows/source-control/source-control-panel.test.tsx )
( cd packages/web && NODE_ENV=development bun test src/component-integration/source-control-tab.test.tsx )
~~~

Expected: the new API, interaction, and virtualization assertions fail.

- [ ] **Step 3: Make each row a selectable option**

Render each row as <code>&lt;button type="button" role="option" tabIndex={-1}&gt;</code>.

Use <code>aria-selected={selected}</code>, <code>data-active={active ? "true" : "false"}</code>, and the existing visible M, A, or D badge.

Click must focus the listbox, make the row active, and then call <code>onOpen(file)</code>.

Prevent the row's pointer-down default so clicking an option leaves DOM focus on the listbox; this prevents a later Enter key from both bubbling to the listbox handler and synthesizing a second button click.

Do not use <code>aria-selected</code> for focus because that creates multiple selected options after keyboard movement.

- [ ] **Step 4: Implement actual virtual positioning**

Create <code>changed-files-list.tsx</code> around <code>useVirtualizer</code> with count, scroll element, 28-pixel estimate, and overscan 8.

When virtual items exist, render one relative spacer with <code>height: virtualizer.getTotalSize()</code>.

Render each mounted row in an absolutely positioned full-width wrapper translated by <code>virtualItem.start</code>.

Keep the all-row fallback only for unmeasured server rendering so the current static-markup tests remain meaningful.

On ArrowUp, ArrowDown, Home, and End, compute the next active index, call <code>virtualizer.scrollToIndex(nextIndex, { align: "auto" })</code>, and update the active callback.

On Enter or Space, prevent default and open the current active file without moving the active index.

Use <code>idPrefix + "-" + index</code> for option IDs so Changes and future History lists can coexist.

Set <code>aria-activedescendant</code> only when the active option is mounted after virtual scrolling.

- [ ] **Step 5: Replace only the inlined listbox**

Keep every CAP-6, loading, stale, error, Reload, and clean-worktree branch in <code>SourceControlPanel</code> unchanged.

Keep active-index clamping in the panel and pass it into <code>ChangedFilesList</code>.

Default <code>ariaLabel</code> to <code>Uncommitted changes</code>, <code>idPrefix</code> to <code>sc-changes-file</code>, <code>selectedPath</code> to null, and <code>onOpenFile</code> to a no-op.

Re-export <code>nextChangedFileIndex</code> from <code>source-control-panel.tsx</code> so existing imports remain compatible.

- [ ] **Step 6: Verify GREEN**

Run:

~~~bash
( cd packages/web && bun test src/components/workflows/source-control/source-control-panel.test.tsx )
( cd packages/web && NODE_ENV=development bun test src/component-integration/source-control-tab.test.tsx )
( cd packages/web && bun test src/components/workflows/source-control/dag-run-tabs.test.tsx )
( cd packages/web && bun run type-check )
~~~

Expected: every command exits 0 with no React act warning.

- [ ] **Step 7: Commit**

~~~bash
git add packages/web/src/components/workflows/source-control/changed-files-list.tsx \
  packages/web/src/components/workflows/source-control/changed-file-row.tsx \
  packages/web/src/components/workflows/source-control/source-control-panel.tsx \
  packages/web/src/components/workflows/source-control/source-control-panel.test.tsx \
  packages/web/src/component-integration/source-control-tab.test.tsx
git commit -m "feat(web): make changed files reusable and virtualized"
~~~

---

### Task 8: Add the reusable status-keyed viewer

**Files:**

- Create: <code>packages/web/src/components/workflows/source-control/source-control-diff.css</code>
- Create: <code>packages/web/src/components/workflows/source-control/file-viewer.tsx</code>
- Create: <code>packages/web/src/components/workflows/source-control/file-viewer.test.tsx</code>

**Interfaces:**

- Produces a discriminated <code>FileViewerState</code> union.
- Produces <code>FileViewer</code> with state, stacked mode, Cancel, Reload, and Close callbacks.

- [ ] **Step 1: Write failing viewer tests**

Create <code>file-viewer.test.tsx</code> with one behavior per test.

Cover this state union.

~~~ts
export type FileViewerState =
  | { kind: 'idle' }
  | { kind: 'loading'; file: GitChangedFile }
  | { kind: 'diff'; file: GitChangedFile; response: GitReadyDiffResponse }
  | { kind: 'text'; file: GitChangedFile; text: string; contentHash: string }
  | { kind: 'binary'; file: GitChangedFile; contentHash: string; downloadHref: string }
  | { kind: 'unavailable'; file: GitChangedFile; emptyReason: GitEmptyReason }
  | { kind: 'error'; file: GitChangedFile };
~~~

The tests must prove these observable outcomes.

- Idle says <code>Select a file to inspect</code>.
- Loading has a status skeleton and a native Cancel button.
- Modified text has separately labelled Before and After panes, one visible minus marker on the deleted side, one visible plus marker on the inserted side, and no Snapshot control.
- A normal context change with <code>oldLine: 4</code> and <code>newLine: 9</code> renders line 4 in Before and line 9 in After, guarding the version 3.3.3 unified-mode side-selection trap.
- Wide modified mode uses side-by-side pane layout, while stacked mode uses before-over-after.
- Each modified pane has its own horizontal and vertical scroll container and <code>tabIndex=0</code>.
- Added and deleted text use one pane with syntax highlighting and no diff insert or delete background class.
- Attacker-controlled source renders as text and creates no image element.
- Binary never renders content, says <code>Binary file. Download to inspect.</code>, and has a same-origin Download link.
- <code>no_checkout</code> says <code>This run's checkout isn't available right now.</code> and has Reload, while container says <code>This run's files aren't available on the host.</code> and has no Reload.
- Error state keeps the file heading and has the quiet <code>Could not open this file.</code> sentence plus Reload.
- Close is a native button with an accessible label.
- No rendered branch contains Snapshot, stage, edit, discard, commit, <code>Error:</code>, <code>unsupported</code>, a warning glyph, or console markup.

- [ ] **Step 2: Verify RED**

Run:

~~~bash
( cd packages/web && bun test src/components/workflows/source-control/file-viewer.test.tsx )
~~~

Expected: FAIL because <code>file-viewer.tsx</code> does not exist.

- [ ] **Step 3: Implement diff styling**

Create <code>source-control-diff.css</code>.

Set the dependency's insert and delete variables from <code>color-mix(in oklch, var(--success) 18%, var(--surface-inset))</code> and <code>color-mix(in oklch, var(--error) 18%, var(--surface-inset))</code>; the repository has success and error foreground tokens but no separate success or error background token.

Keep marker glyph color at <code>var(--text-primary)</code> and give markers a fixed monospace one-character column.

Set diff tables to a non-wrapping width that grows with content so horizontal scrolling stays inside each pane.

Give each pane's <code>Diff</code> the <code>sc-diff-side</code> class plus <code>sc-diff-before</code> or <code>sc-diff-after</code>.

Use split view internally, then hide columns three and four in <code>sc-diff-before</code> and columns one and two in <code>sc-diff-after</code> at both the <code>col</code> and row-cell levels.

This preserves the dependency's correct old and new line-number and token lookup for normal context lines while still presenting two independent one-sided panes.

Use these selectors rather than positional selectors on only code cells, because split rows contain both gutter and code cells.

~~~css
.sc-diff-side {
  --diff-background-color: var(--surface-inset);
  --diff-text-color: var(--text-primary);
  --diff-gutter-insert-background-color: color-mix(in oklch, var(--success) 18%, var(--surface-inset));
  --diff-code-insert-background-color: color-mix(in oklch, var(--success) 18%, var(--surface-inset));
  --diff-gutter-delete-background-color: color-mix(in oklch, var(--error) 18%, var(--surface-inset));
  --diff-code-delete-background-color: color-mix(in oklch, var(--error) 18%, var(--surface-inset));
}

.sc-diff-side.diff {
  min-width: 100%;
  width: max-content;
  table-layout: auto;
}

.sc-diff-side .diff-code {
  white-space: pre;
  word-break: normal;
  overflow-wrap: normal;
}

.sc-diff-before col:nth-child(n + 3),
.sc-diff-before .diff-line > :nth-child(n + 3),
.sc-diff-after col:nth-child(-n + 2),
.sc-diff-after .diff-line > :nth-child(-n + 2) {
  display: none;
}

.sc-diff-marker {
  display: inline-block;
  width: 1ch;
  margin-right: 0.5ch;
  color: var(--text-primary);
  font-family: monospace;
  text-align: center;
}
~~~

- [ ] **Step 4: Implement the viewer state branches**

Import <code>Diff</code> from <code>react-diff-view</code>, its <code>style/index.css</code>, the local CSS, the hunk adapter, and the highlight helper.

For modified text, map once with <code>toHunkData</code>, derive old and new side hunks, and render two separate <code>Diff diffType="modify"</code> trees.

Use <code>viewType="split"</code> for both trees, <code>sc-diff-before</code> for the old filtered hunks, and <code>sc-diff-after</code> for the new filtered hunks; do not use unified view because version 3.3.3 resolves normal-line tokens and line numbers from the new side in unified mode.

Pass the matching <code>highlightDiffTokens</code> result and <code>renderHighlightedToken</code> to each tree.

Use a side-aware gutter renderer so delete receives <code>-</code> only in the old gutter, insert receives <code>+</code> only in the new gutter, and normal lines receive an empty marker.

Then call the dependency-provided default gutter renderer so line numbers remain.

~~~tsx
const renderGutter: RenderGutter = ({ change, side, renderDefault }) => {
  const marker =
    change.type === 'delete' && side === 'old'
      ? '-'
      : change.type === 'insert' && side === 'new'
        ? '+'
        : '';
  return (
    <>
      <span aria-hidden="true" className="sc-diff-marker">{marker}</span>
      <span>{renderDefault()}</span>
    </>
  );
};
~~~

Wrap each tree in its own <code>min-h-0 min-w-0 flex-1 overflow-auto</code> region labelled Before or After.

Use <code>flex-row</code> when wide and <code>flex-col</code> when stacked.

For added and deleted text, render one <code>pre</code> and <code>code className="hljs"</code> using only <code>highlightedHtml(state.text)</code>.

For binary, never mount a text or diff node.

For error and unavailable branches, invoke only the passed Reload callback and never show the caught exception message.

Keep the component independent of <code>SourceControlTab</code>, TanStack Query, run IDs, and every console module.

- [ ] **Step 5: Verify GREEN**

Run:

~~~bash
( cd packages/web && bun test src/components/workflows/source-control/file-viewer.test.tsx )
( cd packages/web && bun test src/components/workflows/source-control/git-hunk-adapter.test.ts )
( cd packages/web && bun test src/components/workflows/source-control/syntax-highlight.test.tsx )
( cd packages/web && bun run type-check )
~~~

Expected: every command exits 0.

- [ ] **Step 6: Commit**

~~~bash
git add packages/web/src/components/workflows/source-control/source-control-diff.css \
  packages/web/src/components/workflows/source-control/file-viewer.tsx \
  packages/web/src/components/workflows/source-control/file-viewer.test.tsx
git commit -m "feat(web): render the shared changed file viewer"
~~~

---

### Task 9: Orchestrate open, Cancel, Reload, and the responsive split

**Files:**

- Create: <code>packages/web/src/components/workflows/source-control/source-control-split.tsx</code>
- Create: <code>packages/web/src/components/workflows/source-control/use-stacked-viewport.ts</code>
- Modify: <code>packages/web/src/components/workflows/source-control/source-control-tab.tsx</code>
- Modify: <code>packages/web/src/component-integration/source-control-tab.test.tsx</code>

**Interfaces:**

- Produces the 30/70 resizable layout with a 20% through 70% list constraint.
- Produces abort-safe selected-file loading and a separately frozen pending viewer snapshot.

- [ ] **Step 1: Add failing mounted acceptance tests**

Extend the already-isolated <code>source-control-tab.test.tsx</code> instead of creating a second happy-dom harness.

Add one test per behavior.

- Clicking or pressing Enter on M fetches only the encoded diff URL, keeps the list visible, and shows Before and After.
- Opening A fetches only <code>source=worktree</code>, and opening D fetches only <code>source=head</code>.
- The client never sends <code>working_path</code>.
- Opening a second file aborts the first request, and a late first response cannot overwrite the second selection.
- Cancel aborts the current request, removes the skeleton, clears the selection, and leaves the list focused and visible.
- Escape closes any viewer state and returns focus to the listbox.
- A file 500 keeps the list and selected filename, shows quiet in-viewer Reload, and a successful retry replaces only the viewer.
- A CAP-6 file response keeps the frozen list, shows the quiet unavailable viewer branch, and follows the container versus no-checkout Reload rule.
- A NUL M response performs the raw worktree read needed for its content hash and renders a Download link whose GET returns actual bytes.
- Reload re-fetches the list and the selected file, but does not mutate either displayed snapshot.
- A divergent list does not expose the stale-accept affordance until the matching selected-file candidate has finished loading, so acceptance cannot mix a new list with old viewer content.
- When list revision stays identical but selected diff or text content changes, the old content remains and <code>Changed on disk — Reload</code> appears.
- Accepting the changed-on-disk affordance swaps both pending snapshots atomically.
- If the accepted pending list removes the selected path, the viewer closes.
- If the accepted pending list keeps the path with a changed status, the selected file and status-keyed mode update together.
- A mocked viewport below 900 yields list-above-viewer and before-over-after.
- A 900-pixel viewport yields the horizontal list/viewer split.
- The resizable separator is keyboard focusable.
- No test emits a React act warning.

- [ ] **Step 2: Verify RED**

Run:

~~~bash
( cd packages/web && NODE_ENV=development bun test src/component-integration/source-control-tab.test.tsx )
~~~

Expected: existing Story 1.1 tests pass and the new viewer tests fail because the tab does not open files or render a split.

- [ ] **Step 3: Implement the responsive primitives**

Create <code>use-stacked-viewport.ts</code> with an initial <code>window.matchMedia("(max-width: 899px)")</code> read, a <code>change</code> listener, listener cleanup, and an SSR-safe false default.

Create <code>source-control-split.tsx</code>.

Use percentage strings because the installed panel library interprets numbers as pixels.

~~~tsx
<ResizablePanelGroup
  orientation={stacked ? 'vertical' : 'horizontal'}
  className="h-full min-h-0 min-w-0"
>
  <ResizablePanel id="source-control-list" defaultSize="30%" minSize="20%" maxSize="70%">
    {list}
  </ResizablePanel>
  <ResizableHandle withHandle />
  <ResizablePanel id="source-control-viewer" defaultSize="70%" minSize="30%" maxSize="80%">
    {viewer}
  </ResizablePanel>
</ResizablePanelGroup>
~~~

Do not provide persistence storage or callbacks.

- [ ] **Step 4: Implement one abort-safe viewer loader**

In <code>source-control-tab.tsx</code>, add a helper that accepts <code>runId</code>, <code>GitChangedFile</code>, and <code>AbortSignal</code> and returns a non-loading <code>FileViewerState</code>.

Use this exact routing.

- M calls <code>getWorkflowRunGitDiff</code>.
- A calls <code>getWorkflowRunGitFile</code> with worktree.
- D calls <code>getWorkflowRunGitFile</code> with head.
- A ready binary M performs one raw worktree read to obtain <code>contentHash</code> for change detection, then returns the binary state and worktree download URL.
- A CAP-6 result becomes unavailable and never replaces the Changes snapshot.
- A thrown <code>AbortError</code> is ignored by the caller.
- Every other exception becomes the quiet error state without retaining or rendering the exception.

Use this complete status dispatch and let fetch failures reject to the request-ID-guarded caller.

~~~ts
type LoadedViewerState = Exclude<
  FileViewerState,
  { kind: 'idle' | 'loading' | 'error' }
>;

async function loadViewerFile(
  runId: string,
  file: GitChangedFile,
  signal: AbortSignal
): Promise<LoadedViewerState> {
  if (file.status === 'M') {
    const response = await getWorkflowRunGitDiff(runId, file.path, { signal });
    if ('emptyReason' in response) {
      return { kind: 'unavailable', file, emptyReason: response.emptyReason };
    }
    if (!response.binary) return { kind: 'diff', file, response };
    const raw = await getWorkflowRunGitFile(runId, file.path, 'worktree', { signal });
    if (raw.kind === 'empty') {
      return { kind: 'unavailable', file, emptyReason: raw.emptyReason };
    }
    if (raw.kind !== 'binary') throw new Error('Invalid binary git file response');
    return {
      kind: 'binary',
      file,
      contentHash: raw.contentHash,
      downloadHref: gitFileUrl(runId, file.path, 'worktree'),
    };
  }

  const source: GitFileSource = file.status === 'A' ? 'worktree' : 'head';
  const response = await getWorkflowRunGitFile(runId, file.path, source, { signal });
  if (response.kind === 'empty') {
    return { kind: 'unavailable', file, emptyReason: response.emptyReason };
  }
  if (response.kind === 'binary') {
    return {
      kind: 'binary',
      file,
      contentHash: response.contentHash,
      downloadHref: gitFileUrl(runId, file.path, source),
    };
  }
  return {
    kind: 'text',
    file,
    text: response.text,
    contentHash: response.contentHash,
  };
}
~~~

Track a monotonically increasing request ID with the current <code>AbortController</code>.

Apply a result only when its request ID is still current and its signal is not aborted.

Abort on a new selection, a new Reload, Cancel, Close, Escape, accepting pending data, run ID change, and component unmount.

- [ ] **Step 5: Keep displayed and pending viewer snapshots separate**

Track <code>selectedFile</code>, displayed <code>viewerState</code>, and optional <code>{ file, state }</code> pending viewer data.

The ordinary open action clears pending viewer data, enters loading, and replaces the displayed viewer only when its current request completes.

The Reload action first calls the existing changes <code>refetch</code>.

Use the <code>refetch</code> result only when <code>isSuccess</code> is true, convert <code>result.data</code> through <code>toSourceControlSnapshot</code>, and do not mistake TanStack Query's retained prior data for a successful candidate after an error.

Change the existing <code>data</code> effect so it dispatches only the first successful snapshot when <code>snapshotState.displayed</code> is null; after initial load, the explicit Reload callback alone owns candidate-list dispatch.

If the returned candidate snapshot is ready and still contains the selected path, re-read that candidate file without showing a loading state over the displayed viewer.

Compare text by <code>contentHash</code>, binary by <code>contentHash</code>, and diff by its typed fields and hunk content.

Implement that comparison as a pure <code>viewerFingerprint</code> helper: <code>text:&lt;hash&gt;</code>, <code>binary:&lt;hash&gt;</code>, <code>diff:&lt;JSON.stringify(response)&gt;</code>, <code>unavailable:&lt;emptyReason&gt;</code>, <code>error</code>, <code>idle</code>, or <code>loading:&lt;status&gt;:&lt;path&gt;</code>.

Store a differing candidate as pending and leave the displayed viewer unchanged.

When a selected path remains in a ready candidate list, wait for its candidate viewer read before dispatching either pending value, then batch the list dispatch and pending-viewer update in the same event turn.

Do not expose a newly divergent list through <code>snapshotState.pending</code> while its matching viewer request is still in flight.

Clear pending viewer data when the candidate fingerprint matches the displayed viewer, and never infer equality from the Changes revision.

If the list refetch or selected-file re-read fails during this global Reload, retain both displayed snapshots, clear no existing pending data, leave the Changes-header Reload button enabled, and store no exception object.

Set the stale affordance when either the Story 1.1 snapshot reducer has pending list data or pending viewer data exists.

The accept action applies the pending list and matching pending viewer together.

The accept action closes the viewer if the accepted list is CAP-6 or no longer contains the selected path.

The accept action reuses the candidate file object so a status change selects the correct viewer mode.

Do not treat a same-revision list as proof that open file bytes stayed unchanged.

- [ ] **Step 6: Compose the tab and keyboard behavior**

Wrap <code>SourceControlPanel</code> and <code>FileViewer</code> in <code>SourceControlSplit</code>.

Pass selected path, open callback, and a real listbox ref to the panel.

Pass Cancel, Reload, and Close callbacks to the viewer.

When the displayed state is <code>error</code>, the viewer's Reload callback starts a direct selected-file request and replaces only that error state on success; it does not create a stale candidate.

When the displayed state is <code>unavailable</code> with <code>no_checkout</code>, the viewer's Reload callback runs the global list-and-selected-file Reload path because checkout availability may have changed.

Handle Escape on the tab root, close the viewer, and focus the listbox ref.

Keep the existing query options with <code>retry: false</code>, no interval, no reconnect refetch, no focus refetch, and infinite stale time.

Do not pass <code>workingPath</code> or modify <code>WorkflowExecution.tsx</code>.

- [ ] **Step 7: Verify GREEN**

Run:

~~~bash
( cd packages/web && NODE_ENV=development bun test src/component-integration/source-control-tab.test.tsx )
( cd packages/web && bun test src/components/workflows/source-control/ )
( cd packages/web && bun test src/lib/api.git-changes.test.ts )
( cd packages/web && bun test src/components/workflows/WorkflowExecution.test.tsx )
( cd packages/web && bun run type-check )
~~~

Expected: every command exits 0 with no React act warning.

The existing Story 1.1 test must still keep an old file list visible until the changed-on-disk affordance is accepted.

- [ ] **Step 8: Commit**

~~~bash
git add packages/web/src/components/workflows/source-control/source-control-split.tsx \
  packages/web/src/components/workflows/source-control/use-stacked-viewport.ts \
  packages/web/src/components/workflows/source-control/source-control-tab.tsx \
  packages/web/src/component-integration/source-control-tab.test.tsx
git commit -m "feat(web): open changed files in a frozen shared viewer"
~~~

---

### Task 10: Run acceptance gates and update the tracker

**Files:**

- Modify: <code>_bmad-output/implementation-artifacts/archon-source-control/sprint-status.yaml</code>

**Interfaces:**

- Produces tracker state <code>1-2-open-a-changed-file-in-the-shared-viewer: done</code> only after all gates pass.

- [ ] **Step 1: Run every focused test in its intended process**

~~~bash
( cd packages/git && bun test src/git-path.test.ts )
( cd packages/git && bun test src/file-read.test.ts )
( cd packages/server && bun test src/routes/git/checkout-gate.test.ts )
( cd packages/server && bun test src/routes/api.git-changes.test.ts )
( cd packages/web && bun test src/lib/api.git-changes.test.ts )
( cd packages/web && bun test src/components/workflows/source-control/ )
( cd packages/web && NODE_ENV=development bun test src/component-integration/source-control-tab.test.tsx )
( cd packages/web && bun test src/components/workflows/WorkflowExecution.test.tsx )
~~~

Expected: every command exits 0 with no failure, warning, unexpected network request, or React act warning.

- [ ] **Step 2: Run affected package suites**

~~~bash
bun --filter @archon/git test
bun --filter @archon/server test
bun --filter @archon/web test
~~~

Expected: all package scripts exit 0.

The git HTTP test and mounted Source Control tab test must each appear as their own Bun invocation in package output.

- [ ] **Step 3: Run the repository gate**

~~~bash
bun run validate
git diff --check
~~~

Expected: both commands exit 0.

Do not mark the story done if type-check, lint with zero warnings, formatting, install smoke, generated-file checks, or any package test fails.

- [ ] **Step 4: Inspect scope and dependency invariants**

~~~bash
git diff --name-only dev...HEAD
rg -n "from ['\"].*experiments/console|Shiki|Monaco|refractor" packages/web/src/components/workflows/source-control packages/web/src/lib/api.ts
rg -n '"react-diff-view": "3\\.3\\.3"' packages/web/package.json
~~~

Expected: only planned files appear, the forbidden import and library search has no match, and the exact dependency search has one match.

Confirm no database, environment, process, package, write control, History region, or polling behavior was added.

- [ ] **Step 5: Confirm the acceptance matrix**

| Criterion | Evidence |
| --- | --- |
| Select or keyboard-open a Now file | Mounted tab interaction tests |
| Reusable list and viewer boundaries | <code>ChangedFilesList</code> and <code>FileViewer</code> component tests |
| 30/70 percentage split and 20–70% list resizing | Split code, mounted orientation tests, and manual drag |
| M before-left and after-right with independent scrolling | Viewer tests and manual overflow check |
| M is HEAD to worktree and has no snapshot mode | Real-git test and viewer test |
| Plus and minus gutters are not color-only | Viewer glyph assertions |
| Marker contrast is at least 4.5:1 | Browser contrast inspection in Step 6 |
| A and D use the correct raw source and no diff coloring | Mounted route tests and viewer tests |
| Hunk JSON, zero starts, live ref, and opaque cursor | Parser, HTTP, generated-type, and client tests |
| Syntax uses highlight.js without markup injection | Safe-highlight tests |
| Below 900 stacks both layout levels | Mounted breakpoint and viewer tests |
| Loading skeleton, Cancel, retry, close, and Escape | Mounted interaction tests |
| Virtualized list remains keyboard-correct | Mounted 200-file test |
| Live realpath containment and symlink semantics | Git path and file tests |
| Encoded traversal is refused | HTTP tests |
| Colon, dash, glob, space, and newline paths work | Real-git and HTTP tests |
| Tree reads use ls-tree and cat-file, never oid:path | Wrapped-real-exec assertions |
| CAP-6 is HTTP 200 on both new routes | HTTP tests for container and no checkout |
| Binary bytes download and never render as text | Raw byte, client, and viewer tests |
| Same-list-revision content changes remain frozen | Mounted Reload test |
| Logs pair and do not leak paths | HTTP logger tests |
| No write or History chrome | Existing and new component tests |
| One exact new dependency | Manifest and lockfile inspection |

- [ ] **Step 6: Perform the legacy-screen manual check**

Run:

~~~bash
bun run dev
~~~

Open an existing DAG run with a live host checkout at <code>/legacy/workflows/runs/:id</code>.

Open one M file and one A or D file.

Drag the list from 20% through 70% and confirm the viewer never overflows the window.

At a viewport below 900 pixels, confirm the list is above the viewer and Before is above After.

Use long lines and enough lines to confirm each diff pane scrolls independently in both axes.

Use browser accessibility or color tools to record that the visible plus and minus markers have contrast of at least 4.5:1 against their rendered backgrounds.

Trigger Reload after changing the selected file and confirm the old content remains until <code>Changed on disk — Reload</code> is accepted.

Confirm the browser console has no React error and that no write or History control appears.

Stop only the processes started for this check.

If no suitable live run exists, record that limitation in PR Validation and do not fabricate a run, but all automated gates must still pass.

- [ ] **Step 7: Update exactly one tracker value**

In <code>sprint-status.yaml</code>, change only:

~~~yaml
  1-2-open-a-changed-file-in-the-shared-viewer: backlog
~~~

to:

~~~yaml
  1-2-open-a-changed-file-in-the-shared-viewer: done
~~~

The existing <code>last_updated: 2026-09-06</code> already has the correct date and must not be rewritten for noise.

Keep Story 1.3 at backlog and Epic 1 at in-progress.

- [ ] **Step 8: Commit the tracker update**

~~~bash
git add _bmad-output/implementation-artifacts/archon-source-control/sprint-status.yaml
git commit -m "chore(sc): mark shared viewer story done"
~~~

## Out of Scope

- Story 1.3 hunk pagination, large-text chunking, Load more, streaming, the final 50 MB policy, inline images, and hex peek.
- Epic 2 History, commit log, per-commit file lists, commit OIDs, and lane graph.
- CAP-8 durable snapshot writing.
- Container overlay reads.
- Secret redaction.
- Persisted split sizes.
- A Source Control tab model for sequential non-DAG runs.

## Pull Request Handoff

Before opening a pull request, rerun <code>bun run validate</code> and copy <code>.github/pull_request_template.md</code> into the PR body.

Target <code>dev</code>, never <code>main</code>.

Keep Problem and outcome, Review guidance, Solution, and Validation, and delete unused conditional sections and every instructional comment.

Record focused RED and GREEN evidence, full validation, the manual check or its explicit live-run limitation, the binary-download behavior, the containment review, and the new dependency.

Link the issue with <code>Closes #76</code>.

Do not close the issue separately.
