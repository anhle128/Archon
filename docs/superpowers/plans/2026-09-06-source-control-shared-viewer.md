# Open a Changed File in the Shared Viewer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.
> Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an operator select a Now changed file on the legacy Source Control tab and inspect it in a reusable status-keyed viewer with a 30/70 resizable split, without adding History, large-file streaming, or image/hex fallbacks.

**Architecture:** `@archon/git` owns path confinement, `fileAt`, and `fileDiff`.
The server reuses `resolveRunCheckout`, exposes one OpenAPI hunk-JSON route for `M`, and one raw wildcard route for `A`/`D` content.
The web tab composes a reusable Changes list widget and a reusable viewer; `WorkflowExecution.tsx` stays a one-line mount.

**Tech Stack:** Bun, strict TypeScript, `execFileAsync` / `execFileBufferAsync` through `@archon/git`, Hono OpenAPI, Zod from `@hono/zod-openapi`, React 19, TanStack Query 5, `react-resizable-panels` v4, `react-diff-view@3.3.3`, installed `highlight.js@^11.11.1` left unused for HTML injection, installed `@tanstack/react-virtual@^3`, and Bun tests.

**Spec:** `_bmad-output/planning-artifacts/epics-source-control/epics.md` Story 1.2.
**Companion decisions:** `_bmad-output/specs/spec-archon-source-control/SPEC.md` CAP-3 and CAP-5, `_bmad-output/specs/spec-archon-source-control/brownfield.md`, `_bmad-output/specs/spec-archon-source-control/viewer-rules.md`, and `_bmad-output/planning-artifacts/architecture/architecture-Archon-source-control-2026-09-05/ARCHITECTURE-SPINE.md` AD-1, AD-2, AD-3, AD-4, AD-5, AD-6, and AD-9.
**Predecessor:** Story 1.1 is `done` in sprint-status (`docs/superpowers/plans/2026-09-06-source-control-changes-list.md`, issue #75).
**Issue:** [#76](https://github.com/anhle128/Archon/issues/76), tracker key `1-2-open-a-changed-file-in-the-shared-viewer`.

## Global Constraints

- Story 1.2 opens Now files only; do not add History, `log`, per-commit file lists, or commit OIDs on the HTTP surface.
- Load more, first-paint 256 KB / 2,000-line cutoffs, >1 MB streaming, >50 MB download-only, inline images, and hex peek are Story 1.3.
- The v1 surface remains `/legacy/workflows/runs/:id`; do not import from or change `packages/web/src/experiments/console/`.
- The client sends `runId` plus the server-issued git-relative path from the Changes list; it never sends `working_path` or an absolute filesystem path.
- The server reads existing `workflow_runs.working_path`; do not add a column and do not reconstruct the checkout from isolation metadata.
- Git commands use argv arrays; never `exec`, a shell command string, or `oid:path` (`HEAD:path` included).
- Commit-shaped blob reads use `git --literal-pathspecs ls-tree -z <treeIsh> -- <path>` then `git cat-file blob <blobOid>`.
- Live worktree reads `realpath` the candidate and require it to stay under the already-realpathed checkout.
- Reject NUL, absolute paths, and `..` segments after URI decoding; `:`, leading `-`, and glob filenames MUST succeed.
- JSON routes use `registerOpenApiRoute(createRoute(...), handler)`.
- The raw file route uses `app.get` with the same wildcard + decode + `..` comment pattern as `/api/artifacts/:runId/*`.
- Web response types for JSON come from `packages/web/src/lib/api.generated.d.ts`; do not hand-edit that generated file.
- The raw file client may be hand-typed because the wildcard route is not representable in OpenAPI 3.0.
- Auth matches run-detail and artifacts: global `/api/*` gate only, no `requireWebUser`, no per-run owner ACL.
- CAP-6 is HTTP 200 with `{ emptyReason: "container" | "no_checkout" }` on both new git routes; it is not a 404.
- `M` uses the hunk JSON endpoint only; `A`/`D` use the raw content endpoint only.
- Now hunk JSON uses `scope: "now"` and `ref: "live"`; never null or omitted `ref`.
- `cursor` is an opaque string; the web echoes it as `?cursor=` only when non-empty and MUST NOT parse it as a scroll offset.
- `M` is diff-only; there is no standalone snapshot mode.
- No stage, unstage, edit, discard, commit, or other write control is present.
- Do not add Shiki, Monaco, or refractor.
- The one new production dependency is `react-diff-view@3.3.3`; lodash arrives transitively and is not a direct dependency.
- Pino events use `domain.action_state`, pair started with completed or failed, and never log checkout paths, remotes, file contents, file paths, or error messages that can contain a path.
- User copy is terse and non-alarming; do not introduce `Error:`, `unsupported`, or `⚠️`.
- Do not add a table, process, environment variable, deployable, or package besides the pinned viewer dependency.
- `mock.module()` merges over the real module in Bun 1.3.11, so every existing `@archon/git` mock factory must stub the new package exports.
- Server test files with distinct `mock.module()` graphs must run in separate Bun processes through `packages/server/package.json`.
- The mounted viewer query test must run in its own Bun process so its happy-dom globals cannot pollute the existing component suite.
- Every production behavior follows RED, verified RED, minimal GREEN, verified GREEN, and only then refactoring.
- Run every command block from the repository root; package-scoped commands use a subshell so later commands remain rooted correctly.
- Every full Markdown sentence in this plan stays on one physical line.

## File Structure

- Create `packages/git/src/git-path.ts` for wire-path parsing and live `realpath` containment.
- Create `packages/git/src/git-path.test.ts` for NUL, absolute, `..`, colon, dash, glob, and symlink-escape cases.
- Modify `packages/git/src/exec.ts` to add binary-safe `execFileBufferAsync` without changing `execFileAsync` string behavior.
- Create `packages/git/src/file-read.ts` for `fileAt`, `fileDiff`, unified-diff parsing, and NUL detection.
- Create `packages/git/src/file-read.test.ts` for real-git HEAD/worktree reads, `ls-tree`/`cat-file` argv, special filenames, and binary detection.
- Modify `packages/git/src/index.ts` to publish Story 1.2 git functions and types.
- Modify every `mock.module('@archon/git')` factory, including `packages/server/src/routes/api.git-changes.test.ts`.
- Create `packages/server/src/routes/git/run-checkout.ts` to share run lookup plus `resolveRunCheckout` across git handlers.
- Modify `packages/server/src/routes/git/changes-handler.ts` to call that helper without changing the HTTP contract.
- Modify `packages/server/src/routes/schemas/git.schemas.ts` to add hunk and diff schemas.
- Create `packages/server/src/routes/git/diff-route.ts` and `packages/server/src/routes/git/diff-handler.ts`.
- Create `packages/server/src/routes/api.git-diff.test.ts` for the isolated diff HTTP contract.
- Create `packages/server/src/routes/git/file-handler.ts` for the raw wildcard file route.
- Create `packages/server/src/routes/api.git-file.test.ts` for the isolated raw-file HTTP contract.
- Modify `packages/server/src/routes/api.ts` to register the JSON diff route and the raw file `app.get`.
- Modify `packages/server/package.json` to isolate the two new server test files.
- Regenerate `packages/web/src/lib/api.generated.d.ts` from the running server.
- Modify `packages/web/src/lib/api.ts` to add the diff and file clients.
- Create `packages/web/src/lib/api.git-file.test.ts` for encoded URLs, `source`, and no checkout path.
- Add `react-diff-view@3.3.3` in `packages/web/package.json` / the lockfile.
- Create `packages/web/src/components/workflows/source-control/git-hunk-adapter.ts` and `git-hunk-adapter.test.ts`.
- Create `packages/web/src/components/workflows/source-control/changed-files-list.tsx`.
- Modify `changed-file-row.tsx`, `source-control-panel.tsx`, and their tests so Enter/Space/click open a file through a callback.
- Create `packages/web/src/components/workflows/source-control/file-viewer.tsx` and `file-viewer.test.tsx`.
- Create `packages/web/src/components/workflows/source-control/source-control-split.tsx` and `viewport-stack.ts`.
- Modify `source-control-tab.tsx` to split, fetch on open, Cancel via `AbortController`, and keep the frozen list snapshot.
- Create `packages/web/src/component-integration/source-control-viewer.test.tsx` for the mounted open/cancel/split flow.
- Modify `packages/web/package.json` to isolate that mounted test.
- Modify `_bmad-output/implementation-artifacts/archon-source-control/sprint-status.yaml` only after every acceptance gate passes.

## Locked Wire Contract

```ts
type GitEmptyReason = 'container' | 'no_checkout';
type GitDiffScope = 'now' | 'commit';
type GitDiffChangeType = 'normal' | 'insert' | 'delete';
type GitFileSource = 'worktree' | 'head';

type GitDiffChange = {
  type: GitDiffChangeType;
  content: string;
  oldLine?: number;
  newLine?: number;
};

type GitDiffHunk = {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  header: string;
  changes: GitDiffChange[];
};

type GitDiffResponse =
  | {
      emptyReason?: never;
      path: string;
      status: 'M';
      scope: GitDiffScope;
      ref: string;
      hunks: GitDiffHunk[];
      cursor: string;
      truncated: boolean;
      binary: boolean;
    }
  | {
      emptyReason: GitEmptyReason;
    };

type GitFileEmptyResponse = { emptyReason: GitEmptyReason };
```

HTTP:

- `GET /api/workflows/runs/{runId}/git/diff?path=<git-relative>&cursor=<opaque?>`
- Ready Now body has `scope: "now"`, `ref: "live"`, `status: "M"`, `cursor: ""`, `truncated: false` in this story.
- `binary: true` means do not render hunks as text; `hunks` is `[]`.
- CAP-6 JSON is `{ emptyReason }` with HTTP 200.
- Missing run is HTTP 404 `{ error: "Workflow run not found" }`.
- Invalid path is HTTP 400 `{ error: "Invalid file path" }`.
- Missing blob/file after a ready checkout is HTTP 404 `{ error: "File not found" }`.
- Post-gate git failure is HTTP 500 `{ error: "Could not read git diff" }`.

- `GET /api/workflows/runs/:runId/git/file/*?source=worktree|head`
- CAP-6 is HTTP 200 `Content-Type: application/json` with `{ emptyReason }`.
- Text is HTTP 200 `text/plain; charset=utf-8` with the raw bytes decoded as UTF-8 replacement-free only when `hasNulInFirst8k` is false.
- Binary is HTTP 200 `application/octet-stream` with empty body and `Content-Disposition: attachment; filename="download"`.
- Missing `source` or an unknown source is HTTP 400 `{ error: "Invalid file source" }`.
- Invalid path is HTTP 400 `{ error: "Invalid file path" }`.
- Missing file is HTTP 404 `{ error: "File not found" }`.
- Post-gate git/fs failure is HTTP 500 `{ error: "Could not read git file" }`.
- Unknown query parameters, including `working_path`, never influence checkout resolution.

Logging (no paths):

- `git.diff_started` / `git.diff_completed` / `git.diff_failed`
- `git.file_started` / `git.file_completed` / `git.file_failed`
- Completed payloads may include `runId`, `emptyReason`, `binary`, `truncated`, and `fileCount` is not required.
- Failed payloads include `runId` and `errorType` only.

## Open Questions

### OQ-1 — Independent pane scroll versus one split table

`react-diff-view` split mode is a single table, so both sides share one scroll container.
**Provisional default:** always render two independently scrolling panes (before and after), each using `Diff` with `viewType="unified"` and side-filtered hunks.
**Provisional default:** at viewport width ≥ 900px the panes sit left/right; below 900px they stack before-over-after.

### OQ-2 — Hunk cursor in Story 1.2

Story 1.3 owns Load more.
**Provisional default:** `fileDiff` returns every hunk git emits, `cursor` is `""`, and `truncated` is `false`.
**Provisional default:** the web client accepts `cursor` on the type and does not send `?cursor=` while it is empty.

### OQ-3 — highlight.js HTML injection

AD-5 names installed highlight.js and forbids Shiki/Monaco/refractor.
Inserting `highlight.js` HTML without a sanitizer is an XSS hole on attacker-controlled file content.
**Provisional default:** Story 1.2 does not call `highlight.js` and does not pass `tokens` into `Diff`.
**Provisional default:** A/D content is a `<pre>` of plain text; `M` uses react-diff-view default text rendering plus `+`/`-` gutter characters.

### OQ-4 — List virtualization versus SSR tests

`@tanstack/react-virtual` needs a measured parent; `renderToStaticMarkup` has height 0.
**Provisional default:** `ChangedFilesList` uses `useVirtualizer` when `getVirtualItems().length > 0`, otherwise it maps all rows.
That keeps Story 1.1 SSR tests green and still plants the virtualizer for Story 1.3.

### OQ-5 — `binary` on hunk JSON

AD-4 did not list `binary`, but Story 1.2 requires NUL-in-first-8KB files not to dump as text.
**Provisional default:** add required boolean `binary` on the ready diff object (default `false` in writers).
This is additive OpenAPI, not a second cutoff.

### OQ-6 — Raw file `source`

A/D need HEAD versus worktree without accepting a client tree-ish.
**Provisional default:** required query `source=worktree|head` only; never a free OID.

### OQ-7 — Split persistence

**Provisional default:** default 30/70 every mount; do not persist panel sizes.

### OQ-8 — Keyboard after 1.1 consumed Enter

Story 1.1 consumed Enter/Space without opening.
**Provisional default:** Enter and Space open the active row; Escape closes the viewer and focuses the listbox.

---

### Task 1: Add git path confinement

**Files:**
- Create: `packages/git/src/git-path.ts`
- Create: `packages/git/src/git-path.test.ts`

**Interfaces:**
- Consumes: `fs/promises.realpath`, `path.join`, `path.sep`.
- Produces: `GitPathError` with `code: 'empty' | 'nul' | 'absolute' | 'dotdot' | 'escape'`.
- Produces: `parseGitFilePath(raw: string): string`.
- Produces: `containLivePath(checkoutRoot: string, relativePath: string): Promise<string>`.

- [ ] **Step 1: Write the failing confinement tests**

Create `packages/git/src/git-path.test.ts` with this complete content:

```ts
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';

import { containLivePath, GitPathError, parseGitFilePath } from './git-path';

describe('parseGitFilePath', () => {
  test('accepts colon, leading dash, glob, space, and nested relative paths', () => {
    expect(parseGitFilePath(':colon.ts')).toBe(':colon.ts');
    expect(parseGitFilePath('-dash.ts')).toBe('-dash.ts');
    expect(parseGitFilePath('foo*.ts')).toBe('foo*.ts');
    expect(parseGitFilePath('path with space.ts')).toBe('path with space.ts');
    expect(parseGitFilePath('src/a.ts')).toBe('src/a.ts');
  });

  test('rejects empty, NUL, absolute, and dot-dot segments', () => {
    expect(() => parseGitFilePath('')).toThrow(GitPathError);
    expect(() => parseGitFilePath('a\0b.ts')).toThrow(GitPathError);
    expect(() => parseGitFilePath('/etc/passwd')).toThrow(GitPathError);
    expect(() => parseGitFilePath('\\etc\\passwd')).toThrow(GitPathError);
    expect(() => parseGitFilePath('C:/Windows/notepad.exe')).toThrow(GitPathError);
    expect(() => parseGitFilePath('../secret')).toThrow(GitPathError);
    expect(() => parseGitFilePath('src/../secret')).toThrow(GitPathError);
    try {
      parseGitFilePath('../secret');
    } catch (error) {
      expect(error).toBeInstanceOf(GitPathError);
      expect((error as GitPathError).code).toBe('dotdot');
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

  test('returns the realpathed file when it stays under the checkout', async () => {
    const resolved = await containLivePath(checkout, 'inside.ts');
    expect(resolved.endsWith('inside.ts')).toBe(true);
    expect(resolved.startsWith(checkout)).toBe(true);
  });

  test.skipIf(process.platform === 'win32')('refuses a symlink that escapes the checkout', async () => {
    await symlink(join(root, 'outside'), join(checkout, 'escape'));
    await expect(containLivePath(checkout, 'escape/secret.txt')).rejects.toMatchObject({
      name: 'GitPathError',
      code: 'escape',
    });
  });
});
```

- [ ] **Step 2: Run the test and verify RED**

Run:

```bash
bun test packages/git/src/git-path.test.ts
```

Expected: FAIL because `./git-path` does not exist.

- [ ] **Step 3: Implement the minimal confinement module**

Create `packages/git/src/git-path.ts` with this complete content:

```ts
import { realpath } from 'fs/promises';
import { join, sep } from 'path';

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
  if (!raw) throw new GitPathError('empty');
  if (raw.includes('\0')) throw new GitPathError('nul');
  if (raw.startsWith('/') || raw.startsWith('\\') || /^[A-Za-z]:[\\/]/.test(raw)) {
    throw new GitPathError('absolute');
  }
  if (raw.split('/').some(segment => segment === '..' || segment === '\\..')) {
    throw new GitPathError('dotdot');
  }
  return raw;
}

function isInsideCheckout(checkoutRoot: string, resolved: string): boolean {
  const root = checkoutRoot.endsWith(sep) ? checkoutRoot : checkoutRoot + sep;
  return resolved === checkoutRoot || resolved.startsWith(root);
}

export async function containLivePath(
  checkoutRoot: string,
  relativePath: string
): Promise<string> {
  const parsed = parseGitFilePath(relativePath);
  let resolved: string;
  try {
    resolved = await realpath(join(checkoutRoot, parsed));
  } catch {
    throw new GitPathError('escape');
  }
  if (!isInsideCheckout(checkoutRoot, resolved)) {
    throw new GitPathError('escape');
  }
  return resolved;
}
```

Missing worktree files throw `escape` here so the HTTP layer can map containment failures to 400 without distinguishing a dangling path from an escape at this helper.
`fileAt` maps `ENOENT` on the worktree source to `GitFileError('not_found')` before calling this helper when `stat` says the path does not exist.

- [ ] **Step 4: Verify GREEN**

Run:

```bash
bun test packages/git/src/git-path.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit the confinement helper**

```bash
git add packages/git/src/git-path.ts packages/git/src/git-path.test.ts
git commit -m "feat(git): confine live file paths under checkout"
```

---

### Task 2: Add `fileAt` and `fileDiff`

**Files:**
- Modify: `packages/git/src/exec.ts`
- Create: `packages/git/src/file-read.ts`
- Create: `packages/git/src/file-read.test.ts`

**Interfaces:**
- Consumes: `execFileAsync`, `execFileBufferAsync`, `parseGitFilePath`, `containLivePath`.
- Produces: `hasNulInFirst8k(bytes: Uint8Array): boolean`.
- Produces: `parseUnifiedDiff(stdout: string): DiffHunk[]`.
- Produces: `fileAt(workingPath, relativePath, source: { kind: 'worktree' } | { kind: 'tree'; treeIsh: string }): Promise<FileAtResult>`.
- Produces: `fileDiff(workingPath, relativePath): Promise<FileDiffResult>`.
- Produces: `GitFileError` with `code: 'not_found' | 'invalid_ref'`.

- [ ] **Step 1: Write the failing file-read tests**

Create `packages/git/src/file-read.test.ts` with this complete content:

```ts
import { afterAll, beforeAll, describe, expect, spyOn, test } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';

import * as exec from './exec';
import { execFileAsync } from './exec';
import {
  fileAt,
  fileDiff,
  GitFileError,
  hasNulInFirst8k,
  parseUnifiedDiff,
} from './file-read';
import { toWorktreePath } from './types';

describe('hasNulInFirst8k and parseUnifiedDiff', () => {
  test('detects NUL only in the first 8 KB', () => {
    expect(hasNulInFirst8k(new Uint8Array([1, 2, 3]))).toBe(false);
    expect(hasNulInFirst8k(new Uint8Array([1, 0, 3]))).toBe(true);
    const late = new Uint8Array(9000);
    late[8192] = 0;
    expect(hasNulInFirst8k(late)).toBe(false);
  });

  test('parses a single-file unified diff into hunks without git prefixes', () => {
    const stdout = [
      'diff --git a/src/a.ts b/src/a.ts',
      'index 111..222 100644',
      '--- a/src/a.ts',
      '+++ b/src/a.ts',
      '@@ -1,2 +1,3 @@',
      ' line1',
      '-old',
      '+new',
      '+tail',
      '',
    ].join('\n');

    expect(parseUnifiedDiff(stdout)).toEqual([
      {
        oldStart: 1,
        oldLines: 2,
        newStart: 1,
        newLines: 3,
        header: '@@ -1,2 +1,3 @@',
        changes: [
          { type: 'normal', content: 'line1', oldLine: 1, newLine: 1 },
          { type: 'delete', content: 'old', oldLine: 2 },
          { type: 'insert', content: 'new', newLine: 2 },
          { type: 'insert', content: 'tail', newLine: 3 },
        ],
      },
    ]);
  });

  test('returns no hunks for a binary git diff', () => {
    expect(parseUnifiedDiff('Binary files a/x.bin and b/x.bin differ\n')).toEqual([]);
  });
});

describe('fileAt and fileDiff', () => {
  let root = '';
  let repoPath = '';

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'archon-file-read-'));
    repoPath = join(root, 'repo');
    await mkdir(repoPath);
    await execFileAsync('git', ['-C', repoPath, 'init']);
    await execFileAsync('git', ['-C', repoPath, 'config', 'user.email', 'sc@example.com']);
    await execFileAsync('git', ['-C', repoPath, 'config', 'user.name', 'SC']);
    await writeFile(join(repoPath, 'tracked.ts'), 'old\n');
    await writeFile(join(repoPath, ':colon.ts'), 'colon-old\n');
    await writeFile(join(repoPath, '-dash.ts'), 'dash-old\n');
    await writeFile(join(repoPath, 'foo*.ts'), 'glob-old\n');
    await execFileAsync('git', ['-C', repoPath, 'add', '-A']);
    await execFileAsync('git', ['-C', repoPath, 'commit', '-m', 'base']);
    await writeFile(join(repoPath, 'tracked.ts'), 'new\n');
    await writeFile(join(repoPath, 'added.ts'), 'added\n');
    await rm(join(repoPath, '-dash.ts'));
    await writeFile(join(repoPath, 'nul.bin'), Buffer.from([0x00, 1, 2]));
    await execFileAsync('git', ['-C', repoPath, 'add', 'nul.bin']);
  });

  afterAll(async () => {
    await rm(root, { recursive: true, force: true });
  });

  test('reads worktree and HEAD without oid:path syntax', async () => {
    const execSpy = spyOn(exec, 'execFileAsync');
    const bufferSpy = spyOn(exec, 'execFileBufferAsync');
    const wt = toWorktreePath(repoPath);

    const head = await fileAt(wt, 'tracked.ts', { kind: 'tree', treeIsh: 'HEAD' });
    const worktree = await fileAt(wt, 'tracked.ts', { kind: 'worktree' });
    const added = await fileAt(wt, 'added.ts', { kind: 'worktree' });
    const deleted = await fileAt(wt, '-dash.ts', { kind: 'tree', treeIsh: 'HEAD' });
    const colon = await fileAt(wt, ':colon.ts', { kind: 'tree', treeIsh: 'HEAD' });

    expect(new TextDecoder().decode(head.bytes)).toBe('old\n');
    expect(new TextDecoder().decode(worktree.bytes)).toBe('new\n');
    expect(new TextDecoder().decode(added.bytes)).toBe('added\n');
    expect(new TextDecoder().decode(deleted.bytes)).toBe('dash-old\n');
    expect(new TextDecoder().decode(colon.bytes)).toBe('colon-old\n');
    expect(head.binary).toBe(false);

    const argvJoined = [...execSpy.mock.calls, ...bufferSpy.mock.calls]
      .map(call => (call[1] as string[]).join('\0'))
      .join('\n');
    expect(argvJoined).not.toContain('HEAD:');
    expect(argvJoined).toContain('ls-tree');
    expect(argvJoined).toContain('cat-file');
    execSpy.mockRestore();
    bufferSpy.mockRestore();
  });

  test('rejects colon tree-ish, invalid OID, and missing files', async () => {
    const wt = toWorktreePath(repoPath);
    await expect(fileAt(wt, 'tracked.ts', { kind: 'tree', treeIsh: 'HEAD:tracked.ts' })).rejects.toMatchObject(
      { name: 'GitFileError', code: 'invalid_ref' }
    );
    await expect(
      fileAt(wt, 'tracked.ts', { kind: 'tree', treeIsh: 'a'.repeat(40) })
    ).rejects.toMatchObject({ name: 'GitFileError', code: 'not_found' });
    await expect(fileAt(wt, 'missing.ts', { kind: 'worktree' })).rejects.toMatchObject({
      name: 'GitFileError',
      code: 'not_found',
    });
  });

  test('diffs HEAD to worktree and flags NUL binaries', async () => {
    const wt = toWorktreePath(repoPath);
    const diff = await fileDiff(wt, 'tracked.ts');
    expect(diff).toMatchObject({
      path: 'tracked.ts',
      status: 'M',
      scope: 'now',
      ref: 'live',
      cursor: '',
      truncated: false,
      binary: false,
    });
    expect(diff.hunks[0]?.changes.some(change => change.type === 'delete' && change.content === 'old')).toBe(
      true
    );
    expect(diff.hunks[0]?.changes.some(change => change.type === 'insert' && change.content === 'new')).toBe(
      true
    );

    const binary = await fileDiff(wt, 'nul.bin');
    expect(binary.binary).toBe(true);
    expect(binary.hunks).toEqual([]);

    const special = await fileDiff(wt, 'foo*.ts');
    expect(special.path).toBe('foo*.ts');
  });
});
```

`execFileBufferAsync` is imported from `./exec` in the test spy setup, so Step 3 must add it there rather than only in a disconnected file.

- [ ] **Step 2: Run the test and verify RED**

Run:

```bash
bun test packages/git/src/file-read.test.ts
```

Expected: FAIL because `./file-read` does not exist or `execFileBufferAsync` is not exported from `./exec`.

- [ ] **Step 3: Implement buffer exec plus file reads**

Add this export to `packages/git/src/exec.ts` immediately after `execFileAsync`:

```ts
export async function execFileBufferAsync(
  cmd: string,
  args: string[],
  options?: { timeout?: number; cwd?: string; maxBuffer?: number; env?: NodeJS.ProcessEnv }
): Promise<{ stdout: Buffer; stderr: Buffer }> {
  const result = await promisifiedExecFile(cmd, args, { ...options, encoding: 'buffer' });
  return {
    stdout: Buffer.isBuffer(result.stdout) ? result.stdout : Buffer.from(result.stdout ?? ''),
    stderr: Buffer.isBuffer(result.stderr) ? result.stderr : Buffer.from(result.stderr ?? ''),
  };
}
```

Do not create `packages/git/src/exec-buffer.ts`; keep the buffer helper next to `execFileAsync` so spies on `./exec` see both functions.

Create `packages/git/src/file-read.ts` with this complete content:

```ts
import { readFile, stat } from 'fs/promises';
import { join } from 'path';

import * as exec from './exec';
import { containLivePath, GitPathError, parseGitFilePath } from './git-path';
import type { RepoPath, WorktreePath } from './types';

export type DiffChangeType = 'normal' | 'insert' | 'delete';

export interface DiffChange {
  type: DiffChangeType;
  content: string;
  oldLine?: number;
  newLine?: number;
}

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

export type GitFileErrorCode = 'not_found' | 'invalid_ref';

export class GitFileError extends Error {
  readonly code: GitFileErrorCode;

  constructor(code: GitFileErrorCode) {
    super('Git file read failed');
    this.name = 'GitFileError';
    this.code = code;
  }
}

const HUNK_RE = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

export function hasNulInFirst8k(bytes: Uint8Array): boolean {
  const limit = Math.min(8192, bytes.byteLength);
  return bytes.subarray(0, limit).includes(0);
}

function isUnsafeTreeIsh(treeIsh: string): boolean {
  return (
    treeIsh.length === 0 ||
    treeIsh.includes('\0') ||
    treeIsh.includes(':') ||
    treeIsh.startsWith('-')
  );
}

function parseLsTreeBlobOid(stdout: string, expectedPath: string): string | null {
  const record = stdout.split('\0').find(entry => entry.length > 0);
  if (!record) return null;
  const tab = record.indexOf('\t');
  if (tab < 0) return null;
  const path = record.slice(tab + 1);
  if (path !== expectedPath) return null;
  const meta = record.slice(0, tab).split(' ');
  if (meta[1] !== 'blob' || !meta[2]) return null;
  return meta[2];
}

export function parseUnifiedDiff(stdout: string): DiffHunk[] {
  if (stdout.includes('Binary files ') || stdout.includes('GIT binary patch')) return [];
  const hunks: DiffHunk[] = [];
  let current: DiffHunk | null = null;
  let oldLine = 0;
  let newLine = 0;
  for (const line of stdout.split('\n')) {
    if (line.startsWith('diff ') || line.startsWith('index ') || line.startsWith('--- ') || line.startsWith('+++ ')) {
      continue;
    }
    const hunkMatch = line.match(HUNK_RE);
    if (hunkMatch) {
      current = {
        oldStart: Number(hunkMatch[1]),
        oldLines: Number(hunkMatch[2] ?? '1'),
        newStart: Number(hunkMatch[3]),
        newLines: Number(hunkMatch[4] ?? '1'),
        header: line.startsWith('@@') ? line : `@@ -${hunkMatch[1]},${hunkMatch[2] ?? '1'} +${hunkMatch[3]},${hunkMatch[4] ?? '1'} @@`,
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
      continue;
    }
    if (line.startsWith('-')) {
      current.changes.push({ type: 'delete', content: line.slice(1), oldLine });
      oldLine += 1;
      continue;
    }
    if (line.startsWith(' ') || line === '') {
      const content = line.startsWith(' ') ? line.slice(1) : line;
      current.changes.push({ type: 'normal', content, oldLine, newLine });
      oldLine += 1;
      newLine += 1;
    }
  }
  return hunks;
}

export async function fileAt(
  workingPath: RepoPath | WorktreePath,
  relativePath: string,
  source: FileAtSource
): Promise<FileAtResult> {
  const path = parseGitFilePath(relativePath);
  if (source.kind === 'worktree') {
    try {
      await stat(join(workingPath, path));
    } catch {
      throw new GitFileError('not_found');
    }
    let abs: string;
    try {
      abs = await containLivePath(workingPath, path);
    } catch (error) {
      if (error instanceof GitPathError) throw error;
      throw new GitFileError('not_found');
    }
    const buf = await readFile(abs);
    const bytes = new Uint8Array(buf);
    return { path, bytes, binary: hasNulInFirst8k(bytes) };
  }
  if (isUnsafeTreeIsh(source.treeIsh)) throw new GitFileError('invalid_ref');
  let ls: { stdout: string };
  try {
    ls = await exec.execFileAsync('git', [
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
    throw new GitFileError('not_found');
  }
  const blobOid = parseLsTreeBlobOid(ls.stdout, path);
  if (!blobOid) throw new GitFileError('not_found');
  const blob = await exec.execFileBufferAsync('git', ['-C', workingPath, 'cat-file', 'blob', blobOid], {
    maxBuffer: 20 * 1024 * 1024,
  });
  const bytes = new Uint8Array(blob.stdout);
  return { path, bytes, binary: hasNulInFirst8k(bytes) };
}

export async function fileDiff(
  workingPath: RepoPath | WorktreePath,
  relativePath: string
): Promise<FileDiffResult> {
  const path = parseGitFilePath(relativePath);
  let binary = false;
  try {
    const after = await fileAt(workingPath, path, { kind: 'worktree' });
    binary = after.binary;
  } catch {
    // Intentional: a worktree-side read can fail for a deleted-then-modified edge; HEAD still diffs.
  }
  try {
    const before = await fileAt(workingPath, path, { kind: 'tree', treeIsh: 'HEAD' });
    binary = binary || before.binary;
  } catch {
    // Intentional: unborn or missing HEAD blob still allows git diff to describe the after side.
  }
  const diff = await exec.execFileAsync('git', [
    '-C',
    workingPath,
    '--literal-pathspecs',
    '--no-optional-locks',
    '--no-ext-diff',
    'diff',
    '--no-color',
    '-U3',
    'HEAD',
    '--',
    path,
  ]);
  if (diff.stdout.includes('Binary files ') || diff.stdout.includes('GIT binary patch')) {
    binary = true;
  }
  return {
    path,
    status: 'M',
    scope: 'now',
    ref: 'live',
    hunks: binary ? [] : parseUnifiedDiff(diff.stdout),
    cursor: '',
    truncated: false,
    binary,
  };
}
```

Do not catch `git diff` failures inside this module; the server maps them to the opaque 500.

- [ ] **Step 4: Verify GREEN**

Run:

```bash
bun test packages/git/src/file-read.test.ts
bun test packages/git/src/git-path.test.ts
```

Expected: both PASS.

If `git add -A` in the fixture fails to add `:colon.ts` or `foo*.ts` on a platform, set `GIT_LITERAL_PATHSPECS=1` in that `beforeAll` via `execFileAsync` env rather than changing the production helper.

- [ ] **Step 5: Commit the file reads**

```bash
git add packages/git/src/exec.ts packages/git/src/file-read.ts packages/git/src/file-read.test.ts
git commit -m "feat(git): read file contents and Now diffs"
```

---

### Task 3: Export file reads and stub merging git mocks

**Files:**
- Modify: `packages/git/src/index.ts`
- Modify: the 31 exact mock-factory files in Step 2.

**Interfaces:**
- Consumes: Task 1 and Task 2 modules.
- Produces: package exports `fileAt`, `fileDiff`, `parseGitFilePath`, `containLivePath`, `GitPathError`, `GitFileError` plus their types.

- [ ] **Step 1: Write the failing export smoke by type-checking a handler-shaped import**

Do not add server files yet.
Add this block to `packages/git/src/index.ts` after the changed-files exports:

```ts
export { containLivePath, parseGitFilePath, GitPathError } from './git-path';
export type { GitPathErrorCode } from './git-path';
export { fileAt, fileDiff, GitFileError } from './file-read';
export type {
  DiffChange,
  DiffHunk,
  FileAtResult,
  FileAtSource,
  FileDiffResult,
  GitFileErrorCode,
} from './file-read';
```

Leave `hasNulInFirst8k` and `parseUnifiedDiff` unexported from the package root; tests import them from `./file-read`.

- [ ] **Step 2: Stub I/O exports in every merging git mock**

Add these exact properties to every existing `mock.module('@archon/git', () => ({ ... }))` factory:

```ts
fileDiff: mock(async () => ({
  path: 'x.ts',
  status: 'M' as const,
  scope: 'now' as const,
  ref: 'live' as const,
  hunks: [],
  cursor: '',
  truncated: false,
  binary: false,
})),
fileAt: mock(async () => ({ path: 'x.ts', bytes: new Uint8Array(), binary: false })),
containLivePath: mock(async (_root: string, rel: string) => rel),
```

Use a plain async function only in a factory that intentionally does not use Bun's `mock`.
Do not stub `GitPathError` or `parseGitFilePath`; omitted class/pure exports keep the real implementations, which is required for `instanceof GitPathError`.
Update all 31 files:

1. `packages/adapters/src/community/forge/gitea/adapter.test.ts`
2. `packages/adapters/src/community/forge/gitlab/adapter.test.ts`
3. `packages/adapters/src/forge/github/adapter.test.ts`
4. `packages/adapters/src/forge/github/context.test.ts`
5. `packages/cli/src/commands/isolation.test.ts`
6. `packages/cli/src/commands/workflow-command-contract.test.ts`
7. `packages/cli/src/commands/workflow.test.ts`
8. `packages/core/src/db/workflows.test.ts`
9. `packages/core/src/operations/isolation-operations.test.ts`
10. `packages/core/src/operations/workflow-retry.test.ts`
11. `packages/core/src/orchestrator/orchestrator-agent.test.ts`
12. `packages/core/src/orchestrator/orchestrator-isolation.test.ts`
13. `packages/core/src/orchestrator/orchestrator.test.ts`
14. `packages/core/src/orchestrator/post-message-reminder.test.ts`
15. `packages/core/src/services/cleanup-service.test.ts`
16. `packages/isolation/src/pr-state.test.ts`
17. `packages/server/src/routes/api.auth.test.ts`
18. `packages/server/src/routes/api.codebases.test.ts`
19. `packages/server/src/routes/api.git-changes.test.ts`
20. `packages/server/src/routes/api.health.test.ts`
21. `packages/server/src/routes/api.messages.test.ts`
22. `packages/server/src/routes/api.provider-keys.test.ts`
23. `packages/server/src/routes/api.providers.test.ts`
24. `packages/server/src/routes/api.usage.test.ts`
25. `packages/server/src/routes/api.user-ai-prefs.test.ts`
26. `packages/server/src/routes/api.workflow-runs.test.ts`
27. `packages/workflows/src/executor-preamble.test.ts`
28. `packages/workflows/src/executor.test.ts`
29. `packages/workflows/src/runtime-check.test.ts`
30. `packages/workflows/src/script-node-deps.test.ts`
31. `packages/workflows/src/subrun.test.ts`

- [ ] **Step 3: Verify GREEN and package compatibility**

Run:

```bash
bun test packages/git/src/git-path.test.ts
bun test packages/git/src/file-read.test.ts
( cd packages/git && bun run type-check )
bun run type-check
```

Expected: all commands exit 0.

- [ ] **Step 4: Commit the exports and mock stubs**

Stage only `packages/git/src/index.ts` and the 31 mock files, then commit:

```bash
git add packages/git/src/index.ts \
  packages/adapters/src/community/forge/gitea/adapter.test.ts \
  packages/adapters/src/community/forge/gitlab/adapter.test.ts \
  packages/adapters/src/forge/github/adapter.test.ts \
  packages/adapters/src/forge/github/context.test.ts \
  packages/cli/src/commands/isolation.test.ts \
  packages/cli/src/commands/workflow-command-contract.test.ts \
  packages/cli/src/commands/workflow.test.ts \
  packages/core/src/db/workflows.test.ts \
  packages/core/src/operations/isolation-operations.test.ts \
  packages/core/src/operations/workflow-retry.test.ts \
  packages/core/src/orchestrator/orchestrator-agent.test.ts \
  packages/core/src/orchestrator/orchestrator-isolation.test.ts \
  packages/core/src/orchestrator/orchestrator.test.ts \
  packages/core/src/orchestrator/post-message-reminder.test.ts \
  packages/core/src/services/cleanup-service.test.ts \
  packages/isolation/src/pr-state.test.ts \
  packages/server/src/routes/api.auth.test.ts \
  packages/server/src/routes/api.codebases.test.ts \
  packages/server/src/routes/api.git-changes.test.ts \
  packages/server/src/routes/api.health.test.ts \
  packages/server/src/routes/api.messages.test.ts \
  packages/server/src/routes/api.provider-keys.test.ts \
  packages/server/src/routes/api.providers.test.ts \
  packages/server/src/routes/api.usage.test.ts \
  packages/server/src/routes/api.user-ai-prefs.test.ts \
  packages/server/src/routes/api.workflow-runs.test.ts \
  packages/workflows/src/executor-preamble.test.ts \
  packages/workflows/src/executor.test.ts \
  packages/workflows/src/runtime-check.test.ts \
  packages/workflows/src/script-node-deps.test.ts \
  packages/workflows/src/subrun.test.ts
git diff --cached --name-only
git commit -m "feat(git): export fileAt and fileDiff"
```

Confirm no file outside this task appears before committing.

---

### Task 4: Add the Now diff JSON route

**Files:**
- Create: `packages/server/src/routes/git/run-checkout.ts`
- Modify: `packages/server/src/routes/git/changes-handler.ts`
- Modify: `packages/server/src/routes/schemas/git.schemas.ts`
- Create: `packages/server/src/routes/git/diff-route.ts`
- Create: `packages/server/src/routes/git/diff-handler.ts`
- Create: `packages/server/src/routes/api.git-diff.test.ts`
- Modify: `packages/server/src/routes/api.ts`
- Modify: `packages/server/package.json`

**Interfaces:**
- Consumes: `loadRunCheckout`, `fileDiff`, `GitPathError`, `GitFileError`.
- Produces: `GET /api/workflows/runs/{runId}/git/diff`.

- [ ] **Step 1: Write the failing HTTP tests**

Create `packages/server/src/routes/api.git-diff.test.ts` using the same mock skeleton as `api.git-changes.test.ts` (same `runRow`, `makeApp`, `mockGetWorkflowRun`, conversation/isolation mocks, logger, `validationErrorHook`, `mockAllWorkflowModules`, and `registerApiRoutes`).
Replace the git mock with:

```ts
const mockFileDiff = mock(async (_workingPath: string, _path: string): Promise<FileDiffResult> => ({
  path: 'src/a.ts',
  status: 'M',
  scope: 'now',
  ref: 'live',
  hunks: [],
  cursor: '',
  truncated: false,
  binary: false,
}));
const mockChangedFiles = mock(async () => ({ files: [], revision: REVISION }));
const mockIsGitWorkTree = mock(async (_workingPath: string): Promise<boolean> => true);

mock.module('@archon/git', () => ({
  changedFiles: mockChangedFiles,
  isGitWorkTree: mockIsGitWorkTree,
  fileDiff: mockFileDiff,
  fileAt: mock(async () => ({ path: 'x.ts', bytes: new Uint8Array(), binary: false })),
  containLivePath: mock(async (_root: string, rel: string) => rel),
}));
```

Add these tests (keep the 404 / container / null-working_path / hostile-query / opaque-500 pattern from the changes file, pointed at `/git/diff?path=src%2Fa.ts`):

```ts
test('returns 400 for encoded dot-dot and absolute paths without calling fileDiff', async () => {
  mockGetWorkflowRun.mockResolvedValueOnce(runRow());
  const encoded = await makeApp().request(
    '/api/workflows/runs/run-1/git/diff?path=..%2Fetc%2Fpasswd'
  );
  expect(encoded.status).toBe(400);
  expect(await encoded.json()).toEqual({ error: 'Invalid file path' });
  expect(mockFileDiff).not.toHaveBeenCalled();
});

test('returns ready Now hunk JSON and ignores working_path', async () => {
  const canonical = await realpath(checkoutDir);
  mockFileDiff.mockResolvedValueOnce({
    path: 'src/a.ts',
    status: 'M',
    scope: 'now',
    ref: 'live',
    hunks: [
      {
        oldStart: 1,
        oldLines: 1,
        newStart: 1,
        newLines: 1,
        header: '@@ -1 +1 @@',
        changes: [{ type: 'insert', content: 'x', newLine: 1 }],
      },
    ],
    cursor: '',
    truncated: false,
    binary: false,
  });
  const response = await makeApp().request(
    '/api/workflows/runs/run-1/git/diff?path=src%2Fa.ts&working_path=%2e%2e%2fetc&cursor='
  );
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({
    path: 'src/a.ts',
    status: 'M',
    scope: 'now',
    ref: 'live',
    hunks: [
      {
        oldStart: 1,
        oldLines: 1,
        newStart: 1,
        newLines: 1,
        header: '@@ -1 +1 @@',
        changes: [{ type: 'insert', content: 'x', newLine: 1 }],
      },
    ],
    cursor: '',
    truncated: false,
    binary: false,
  });
  expect(mockFileDiff).toHaveBeenCalledWith(canonical, 'src/a.ts');
  expect(mockLogger.info.mock.calls).toContainEqual([
    { runId: 'run-1', binary: false, truncated: false },
    'git.diff_completed',
  ]);
});

test('returns CAP-6 container envelope on the diff route', async () => {
  mockGetConversationById.mockResolvedValueOnce({ isolation_env_id: 'env-1' });
  mockGetById.mockResolvedValueOnce({ provider: 'container' });
  const response = await makeApp().request('/api/workflows/runs/run-1/git/diff?path=src%2Fa.ts');
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ emptyReason: 'container' });
  expect(mockFileDiff).not.toHaveBeenCalled();
});

test('maps GitFileError not_found to 404 without leaking paths', async () => {
  const { GitFileError } = await import('@archon/git');
  mockFileDiff.mockRejectedValueOnce(new GitFileError('not_found'));
  const response = await makeApp().request('/api/workflows/runs/run-1/git/diff?path=src%2Fa.ts');
  const body = await response.json();
  expect(response.status).toBe(404);
  expect(body).toEqual({ error: 'File not found' });
  expect(JSON.stringify(mockLogger.error.mock.calls)).not.toContain(checkoutDir);
});
```

Copy `runRow`, `makeApp`, `REVISION`, logger, and `beforeEach` from `api.git-changes.test.ts` so the file is self-contained.
If `GitFileError` cannot be constructed from the mocked module, define a local `class GitFileError extends Error { code = 'not_found'; name = 'GitFileError'; }` in the test file and throw that, then make the handler detect `error instanceof Error && error.name === 'GitFileError'`.
Prefer detecting `error.name` so the mock-merged real class and a test double both work.

- [ ] **Step 2: Run the test and verify RED**

Run:

```bash
bun test packages/server/src/routes/api.git-diff.test.ts
```

Expected: FAIL because the diff route is unregistered or `fileDiff` is never called.

- [ ] **Step 3: Implement schemas, shared checkout loader, route, and handler**

Append to `packages/server/src/routes/schemas/git.schemas.ts`:

```ts
export const gitDiffScopeSchema = z.enum(['now', 'commit']).openapi('GitDiffScope');

export const gitDiffChangeSchema = z
  .object({
    type: z.enum(['normal', 'insert', 'delete']),
    content: z.string(),
    oldLine: z.number().int().positive().optional(),
    newLine: z.number().int().positive().optional(),
  })
  .openapi('GitDiffChange');

export const gitDiffHunkSchema = z
  .object({
    oldStart: z.number().int().positive(),
    oldLines: z.number().int().nonnegative(),
    newStart: z.number().int().positive(),
    newLines: z.number().int().nonnegative(),
    header: z.string(),
    changes: z.array(gitDiffChangeSchema),
  })
  .openapi('GitDiffHunk');

export const gitReadyDiffResponseSchema = z.object({
  path: z.string().min(1),
  status: z.literal('M'),
  scope: gitDiffScopeSchema,
  ref: z.string().min(1),
  hunks: z.array(gitDiffHunkSchema),
  cursor: z.string(),
  truncated: z.boolean(),
  binary: z.boolean(),
});

export const gitEmptyDiffResponseSchema = z.object({
  emptyReason: gitEmptyReasonSchema,
});

export const gitDiffResponseSchema = z
  .union([gitReadyDiffResponseSchema, gitEmptyDiffResponseSchema])
  .openapi('GitDiffResponse');
export type GitDiffResponse = z.infer<typeof gitDiffResponseSchema>;
```

Create `packages/server/src/routes/git/run-checkout.ts` by moving the `pathExists` helper and the `getWorkflowRun` + `resolveRunCheckout` block out of `changes-handler.ts` into `loadRunCheckout(runId: string): Promise<CheckoutGateResult>`.
Then make `handleGitChanges` call `loadRunCheckout(runId)` so the changes tests stay green.

Create `packages/server/src/routes/git/diff-route.ts`:

```ts
import { createRoute, z } from '@hono/zod-openapi';

import { errorSchema } from '../schemas/common.schemas';
import { gitDiffResponseSchema } from '../schemas/git.schemas';

export const gitDiffRoute = createRoute({
  method: 'get',
  path: '/api/workflows/runs/{runId}/git/diff',
  tags: ['Workflows'],
  summary: "Get a run's Now modified-file diff",
  request: {
    params: z.object({ runId: z.string().min(1) }),
    query: z.object({
      path: z.string().min(1),
      cursor: z.string().optional(),
    }),
  },
  responses: {
    200: {
      content: { 'application/json': { schema: gitDiffResponseSchema } },
      description: 'Now hunk JSON or a CAP-6 empty envelope',
    },
    400: {
      content: { 'application/json': { schema: errorSchema } },
      description: 'Invalid file path',
    },
    404: {
      content: { 'application/json': { schema: errorSchema } },
      description: 'Workflow run or file not found',
    },
    500: {
      content: { 'application/json': { schema: errorSchema } },
      description: 'Git read failed',
    },
  },
});
```

Create `packages/server/src/routes/git/diff-handler.ts`:

```ts
import type { Context } from 'hono';

import { fileDiff, GitFileError, parseGitFilePath, toWorktreePath } from '@archon/git';
import { createLogger } from '@archon/paths';

import type { GitDiffResponse } from '../schemas/git.schemas';
import { loadRunCheckout } from './run-checkout';

let cachedLog: ReturnType<typeof createLogger> | undefined;

function getLog(): ReturnType<typeof createLogger> {
  if (!cachedLog) cachedLog = createLogger('api');
  return cachedLog;
}

function isNamedError(error: unknown, name: string): boolean {
  return error instanceof Error && error.name === name;
}

export async function handleGitDiff(
  c: Context,
  apiError: (c: Context, status: 400 | 404 | 500, message: string) => Response
): Promise<Response> {
  const runId = c.req.param('runId') ?? '';
  const rawPath = c.req.query('path') ?? '';
  getLog().info({ runId }, 'git.diff_started');
  try {
    parseGitFilePath(rawPath);
  } catch {
    getLog().info({ runId }, 'git.diff_failed');
    return apiError(c, 400, 'Invalid file path');
  }
  try {
    const gate = await loadRunCheckout(runId);
    if (gate.kind === 'run_not_found') {
      getLog().info({ runId }, 'git.diff_failed');
      return apiError(c, 404, 'Workflow run not found');
    }
    if (gate.kind === 'empty') {
      const body: GitDiffResponse = { emptyReason: gate.emptyReason };
      getLog().info({ runId, emptyReason: gate.emptyReason }, 'git.diff_completed');
      return c.json(body);
    }
    const result = await fileDiff(toWorktreePath(gate.workingPath), rawPath);
    const body: GitDiffResponse = result;
    getLog().info(
      { runId, binary: result.binary, truncated: result.truncated },
      'git.diff_completed'
    );
    return c.json(body);
  } catch (error) {
    if (isNamedError(error, 'GitPathError')) {
      getLog().info({ runId }, 'git.diff_failed');
      return apiError(c, 400, 'Invalid file path');
    }
    if (isNamedError(error, 'GitFileError') && (error as GitFileError).code === 'not_found') {
      getLog().info({ runId }, 'git.diff_failed');
      return apiError(c, 404, 'File not found');
    }
    getLog().error(
      { runId, errorType: error instanceof Error ? error.name : typeof error },
      'git.diff_failed'
    );
    return apiError(c, 500, 'Could not read git diff');
  }
}
```

Register next to the changes route in `packages/server/src/routes/api.ts`:

```ts
import { gitDiffRoute } from './git/diff-route';
import { handleGitDiff } from './git/diff-handler';

registerOpenApiRoute(gitDiffRoute, async c => {
  return handleGitDiff(c, apiError);
});
```

Insert this isolated invocation immediately after `bun test src/routes/api.git-changes.test.ts` in `packages/server/package.json`:

```text
&& bun test src/routes/api.git-diff.test.ts
```

Do not call `requireWebUser`.
Do not log `rawPath`.

- [ ] **Step 4: Verify GREEN**

Run:

```bash
bun test packages/server/src/routes/api.git-diff.test.ts
bun test packages/server/src/routes/api.git-changes.test.ts
bun test packages/server/src/routes/git/checkout-gate.test.ts
```

Expected: all PASS.

- [ ] **Step 5: Commit the diff route**

```bash
git add packages/server/src/routes/git/run-checkout.ts \
  packages/server/src/routes/git/changes-handler.ts \
  packages/server/src/routes/schemas/git.schemas.ts \
  packages/server/src/routes/git/diff-route.ts \
  packages/server/src/routes/git/diff-handler.ts \
  packages/server/src/routes/api.git-diff.test.ts \
  packages/server/src/routes/api.ts \
  packages/server/package.json
git commit -m "feat(server): add Now git diff JSON route"
```

---

### Task 5: Add the raw git file route

**Files:**
- Create: `packages/server/src/routes/git/file-handler.ts`
- Create: `packages/server/src/routes/api.git-file.test.ts`
- Modify: `packages/server/src/routes/api.ts`
- Modify: `packages/server/package.json`

**Interfaces:**
- Consumes: `loadRunCheckout`, `fileAt`, `parseGitFilePath`.
- Produces: `GET /api/workflows/runs/:runId/git/file/*?source=worktree|head`.

- [ ] **Step 1: Write the failing raw-file tests**

Create `packages/server/src/routes/api.git-file.test.ts` with the same app/run/logger mocks as the diff tests, plus:

```ts
const mockFileAt = mock(async () => ({
  path: 'src/a.ts',
  bytes: new Uint8Array(Buffer.from('hello\n')),
  binary: false,
}));
```

Tests:

```ts
test('returns 400 when source is missing or unknown', async () => {
  const missing = await makeApp().request('/api/workflows/runs/run-1/git/file/src/a.ts');
  expect(missing.status).toBe(400);
  expect(await missing.json()).toEqual({ error: 'Invalid file source' });
  const bad = await makeApp().request('/api/workflows/runs/run-1/git/file/src/a.ts?source=HEAD');
  expect(bad.status).toBe(400);
});

test('returns CAP-6 JSON for container without calling fileAt', async () => {
  mockGetConversationById.mockResolvedValueOnce({ isolation_env_id: 'env-1' });
  mockGetById.mockResolvedValueOnce({ provider: 'container' });
  const response = await makeApp().request(
    '/api/workflows/runs/run-1/git/file/src/a.ts?source=worktree'
  );
  expect(response.status).toBe(200);
  expect(response.headers.get('content-type') ?? '').toContain('application/json');
  expect(await response.json()).toEqual({ emptyReason: 'container' });
  expect(mockFileAt).not.toHaveBeenCalled();
});

test('returns text/plain for worktree text and uses the canonical checkout', async () => {
  const canonical = await realpath(checkoutDir);
  const response = await makeApp().request(
    '/api/workflows/runs/run-1/git/file/src/a.ts?source=worktree&working_path=%2e%2e%2fetc'
  );
  expect(response.status).toBe(200);
  expect(response.headers.get('content-type')).toContain('text/plain');
  expect(await response.text()).toBe('hello\n');
  expect(mockFileAt).toHaveBeenCalledWith(canonical, 'src/a.ts', { kind: 'worktree' });
});

test('returns octet-stream with empty body for NUL binaries', async () => {
  mockFileAt.mockResolvedValueOnce({
    path: 'nul.bin',
    bytes: new Uint8Array([0, 1, 2]),
    binary: true,
  });
  const response = await makeApp().request(
    '/api/workflows/runs/run-1/git/file/nul.bin?source=head'
  );
  expect(response.status).toBe(200);
  expect(response.headers.get('content-type')).toContain('application/octet-stream');
  expect((await response.arrayBuffer()).byteLength).toBe(0);
  expect(mockFileAt).toHaveBeenCalledWith(await realpath(checkoutDir), 'nul.bin', {
    kind: 'tree',
    treeIsh: 'HEAD',
  });
});

test('rejects encoded traversal after decode', async () => {
  const response = await makeApp().request(
    '/api/workflows/runs/run-1/git/file/..%2Fetc%2Fpasswd?source=worktree'
  );
  expect(response.status).toBe(400);
  expect(await response.json()).toEqual({ error: 'Invalid file path' });
  expect(mockFileAt).not.toHaveBeenCalled();
});

test('decodes colon filenames and does not require a commit OID from the client', async () => {
  mockFileAt.mockResolvedValueOnce({
    path: ':colon.ts',
    bytes: new Uint8Array(Buffer.from('colon\n')),
    binary: false,
  });
  const response = await makeApp().request(
    '/api/workflows/runs/run-1/git/file/%3Acolon.ts?source=head'
  );
  expect(response.status).toBe(200);
  expect(await response.text()).toBe('colon\n');
  expect(mockFileAt.mock.calls[0]?.[1]).toBe(':colon.ts');
});
```

- [ ] **Step 2: Run the test and verify RED**

Run:

```bash
bun test packages/server/src/routes/api.git-file.test.ts
```

Expected: FAIL because the wildcard route is missing.

- [ ] **Step 3: Implement the raw handler and `app.get`**

Create `packages/server/src/routes/git/file-handler.ts`:

```ts
import type { Context } from 'hono';

import { fileAt, GitFileError, parseGitFilePath, toWorktreePath } from '@archon/git';
import { createLogger } from '@archon/paths';

import { loadRunCheckout } from './run-checkout';

let cachedLog: ReturnType<typeof createLogger> | undefined;

function getLog(): ReturnType<typeof createLogger> {
  if (!cachedLog) cachedLog = createLogger('api');
  return cachedLog;
}

function isNamedError(error: unknown, name: string): boolean {
  return error instanceof Error && error.name === name;
}

export function extractGitFilePath(requestPath: string, runId: string): string | null {
  const prefix = `/api/workflows/runs/${runId}/git/file/`;
  if (!requestPath.startsWith(prefix)) return null;
  const rawEncoded = requestPath.slice(prefix.length);
  let raw: string;
  try {
    raw = decodeURIComponent(rawEncoded);
  } catch {
    return null;
  }
  if (!raw || raw.includes('\0') || raw.split('/').some(segment => segment === '..')) return null;
  try {
    return parseGitFilePath(raw);
  } catch {
    return null;
  }
}

export async function handleGitFile(
  c: Context,
  apiError: (c: Context, status: 400 | 404 | 500, message: string) => Response
): Promise<Response> {
  const runId = c.req.param('runId') ?? '';
  const source = c.req.query('source') ?? '';
  getLog().info({ runId }, 'git.file_started');
  if (source !== 'worktree' && source !== 'head') {
    getLog().info({ runId }, 'git.file_failed');
    return apiError(c, 400, 'Invalid file source');
  }
  const relativePath = extractGitFilePath(c.req.path, runId);
  if (!relativePath) {
    getLog().info({ runId }, 'git.file_failed');
    return apiError(c, 400, 'Invalid file path');
  }
  try {
    const gate = await loadRunCheckout(runId);
    if (gate.kind === 'run_not_found') {
      getLog().info({ runId }, 'git.file_failed');
      return apiError(c, 404, 'Workflow run not found');
    }
    if (gate.kind === 'empty') {
      getLog().info({ runId, emptyReason: gate.emptyReason }, 'git.file_completed');
      return c.json({ emptyReason: gate.emptyReason });
    }
    const result = await fileAt(
      toWorktreePath(gate.workingPath),
      relativePath,
      source === 'worktree' ? { kind: 'worktree' } : { kind: 'tree', treeIsh: 'HEAD' }
    );
    getLog().info({ runId, binary: result.binary }, 'git.file_completed');
    if (result.binary) {
      return new Response(null, {
        status: 200,
        headers: {
          'Content-Type': 'application/octet-stream',
          'Content-Disposition': 'attachment; filename="download"',
        },
      });
    }
    return new Response(Buffer.from(result.bytes), {
      status: 200,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    });
  } catch (error) {
    if (isNamedError(error, 'GitPathError')) {
      getLog().info({ runId }, 'git.file_failed');
      return apiError(c, 400, 'Invalid file path');
    }
    if (isNamedError(error, 'GitFileError') && (error as GitFileError).code === 'not_found') {
      getLog().info({ runId }, 'git.file_failed');
      return apiError(c, 404, 'File not found');
    }
    getLog().error(
      { runId, errorType: error instanceof Error ? error.name : typeof error },
      'git.file_failed'
    );
    return apiError(c, 500, 'Could not read git file');
  }
}
```

In `packages/server/src/routes/api.ts`, next to the artifacts wildcard, register:

```ts
import { handleGitFile } from './git/file-handler';

// GET /api/workflows/runs/:runId/git/file/*
// Wildcard captures the git-relative path (e.g. "src/a.ts", ":colon.ts").
// Path traversal is blocked after decodeURIComponent: any ".." segment or NUL is rejected.
// NOTE: Uses app.get() instead of registerOpenApiRoute because:
//  1. Wildcard path params (*) are not representable in OpenAPI 3.0
//  2. Response is raw text/octet-stream or a CAP-6 JSON envelope
app.get('/api/workflows/runs/:runId/git/file/*', async c => {
  return handleGitFile(c, apiError);
});
```

Insert `&& bun test src/routes/api.git-file.test.ts` immediately after the git-diff test invocation in `packages/server/package.json`.

- [ ] **Step 4: Verify GREEN**

Run:

```bash
bun test packages/server/src/routes/api.git-file.test.ts
bun test packages/server/src/routes/api.git-diff.test.ts
bun test packages/server/src/routes/api.git-changes.test.ts
```

Expected: all PASS.
If `c.req.path` is not percent-encoded the same way as the artifacts route, follow that route's `decodeURIComponent` behavior exactly and adjust `extractGitFilePath` until the colon test passes.

- [ ] **Step 5: Commit the raw file route**

```bash
git add packages/server/src/routes/git/file-handler.ts \
  packages/server/src/routes/api.git-file.test.ts \
  packages/server/src/routes/api.ts \
  packages/server/package.json
git commit -m "feat(server): add raw git file route"
```

---

### Task 6: Generate web types and add git file clients

**Files:**
- Regenerate: `packages/web/src/lib/api.generated.d.ts`
- Modify: `packages/web/src/lib/api.ts`
- Create: `packages/web/src/lib/api.git-file.test.ts`

**Interfaces:**
- Consumes: generated `GitDiffResponse`.
- Produces: `getWorkflowRunGitDiff(runId, path, options?: { cursor?: string; signal?: AbortSignal })`.
- Produces: `getWorkflowRunGitFile(runId, path, source: 'worktree' | 'head', init?: RequestInit)`.

- [ ] **Step 1: Write the failing client tests**

Create `packages/web/src/lib/api.git-file.test.ts`:

```ts
import { afterEach, describe, expect, spyOn, test } from 'bun:test';

import { getWorkflowRunGitDiff, getWorkflowRunGitFile } from './api';

let fetchSpy: ReturnType<typeof spyOn> | undefined;

afterEach(() => {
  fetchSpy?.mockRestore();
  fetchSpy = undefined;
});

describe('getWorkflowRunGitDiff', () => {
  test('GETs the encoded run and path without a checkout path', async () => {
    fetchSpy = spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          path: 'src/a.ts',
          status: 'M',
          scope: 'now',
          ref: 'live',
          hunks: [],
          cursor: '',
          truncated: false,
          binary: false,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    );
    const response = await getWorkflowRunGitDiff('run/one', 'src/a.ts');
    expect(response).toMatchObject({ status: 'M', ref: 'live', scope: 'now' });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(String(fetchSpy.mock.calls[0]?.[0])).toBe(
      '/api/workflows/runs/run%2Fone/git/diff?path=src%2Fa.ts'
    );
    expect(String(fetchSpy.mock.calls[0]?.[0])).not.toContain('working_path');
    expect(String(fetchSpy.mock.calls[0]?.[0])).not.toContain('cursor=');
  });
});

describe('getWorkflowRunGitFile', () => {
  test('encodes each path segment and required source', async () => {
    fetchSpy = spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('hello\n', { status: 200, headers: { 'Content-Type': 'text/plain; charset=utf-8' } })
    );
    const response = await getWorkflowRunGitFile('run/one', ':colon.ts', 'head');
    expect(response).toEqual({ kind: 'text', text: 'hello\n' });
    expect(String(fetchSpy.mock.calls[0]?.[0])).toBe(
      '/api/workflows/runs/run%2Fone/git/file/%3Acolon.ts?source=head'
    );
  });

  test('treats octet-stream as binary without reading a text dump', async () => {
    fetchSpy = spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(null, { status: 200, headers: { 'Content-Type': 'application/octet-stream' } })
    );
    const response = await getWorkflowRunGitFile('run-1', 'nul.bin', 'worktree');
    expect(response).toEqual({ kind: 'binary' });
  });

  test('parses CAP-6 JSON on the raw route', async () => {
    fetchSpy = spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ emptyReason: 'container' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    );
    const response = await getWorkflowRunGitFile('run-1', 'a.ts', 'worktree');
    expect(response).toEqual({ kind: 'empty', emptyReason: 'container' });
  });
});
```

- [ ] **Step 2: Run the test and verify RED**

Run:

```bash
bun test packages/web/src/lib/api.git-file.test.ts
```

Expected: FAIL because the new client functions are not exported.

- [ ] **Step 3: Regenerate OpenAPI types from the implemented server**

In one terminal, start the server:

```bash
bun run dev:server
```

After the server reports that port 3090 is listening, run this in a second terminal:

```bash
bun --filter @archon/web generate:types
```

Stop only the server process started for this task.
Do not hand-edit `packages/web/src/lib/api.generated.d.ts`.
Verify generation produced the diff route and schema:

```bash
rg -n '"/api/workflows/runs/\\{runId\\}/git/diff"|GitDiffResponse' packages/web/src/lib/api.generated.d.ts
```

Expected: both the path and schema name are present.
The raw file route will not appear in OpenAPI; that is required.

- [ ] **Step 4: Add the generated-type re-exports and clients**

Immediately after `getWorkflowRunGitChanges` in `packages/web/src/lib/api.ts`, add:

```ts
export type GitDiffResponse = components['schemas']['GitDiffResponse'];
export type GitDiffHunk = components['schemas']['GitDiffHunk'];
export type GitDiffChange = components['schemas']['GitDiffChange'];
export type GitFileSource = 'worktree' | 'head';
export type GitFileClientResult =
  | { kind: 'empty'; emptyReason: GitEmptyReason }
  | { kind: 'binary' }
  | { kind: 'text'; text: string };

export async function getWorkflowRunGitDiff(
  runId: string,
  path: string,
  options?: { cursor?: string; signal?: AbortSignal }
): Promise<GitDiffResponse> {
  const params = new URLSearchParams({ path });
  if (options?.cursor) params.set('cursor', options.cursor);
  const init = options?.signal ? { signal: options.signal } : undefined;
  return fetchJSON(
    `/api/workflows/runs/${encodeURIComponent(runId)}/git/diff?${params.toString()}`,
    init
  );
}

export function gitFileUrl(runId: string, path: string, source: GitFileSource): string {
  const encodedPath = path
    .split('/')
    .map(segment => encodeURIComponent(segment))
    .join('/');
  return `/api/workflows/runs/${encodeURIComponent(runId)}/git/file/${encodedPath}?source=${source}`;
}

export async function getWorkflowRunGitFile(
  runId: string,
  path: string,
  source: GitFileSource,
  init?: RequestInit
): Promise<GitFileClientResult> {
  const res = await (init === undefined ? fetch(gitFileUrl(runId, path, source)) : fetch(gitFileUrl(runId, path, source), init));
  if (!res.ok) {
    const body = await res.text();
    const truncated = body.length > 200 ? body.slice(0, 200) + '...' : body;
    throw Object.assign(new Error(`API error ${res.status}: ${truncated}`), { status: res.status });
  }
  const contentType = res.headers.get('content-type') ?? '';
  if (contentType.includes('application/json')) {
    const body = (await res.json()) as { emptyReason?: GitEmptyReason };
    if (body.emptyReason === 'container' || body.emptyReason === 'no_checkout') {
      return { kind: 'empty', emptyReason: body.emptyReason };
    }
  }
  if (contentType.includes('application/octet-stream')) {
    return { kind: 'binary' };
  }
  return { kind: 'text', text: await res.text() };
}
```

- [ ] **Step 5: Verify GREEN**

Run:

```bash
bun test packages/web/src/lib/api.git-file.test.ts
bun test packages/web/src/lib/api.git-changes.test.ts
( cd packages/web && bun run type-check )
```

Expected: all commands exit 0.

- [ ] **Step 6: Commit the generated contract and clients**

```bash
git add packages/web/src/lib/api.generated.d.ts packages/web/src/lib/api.ts packages/web/src/lib/api.git-file.test.ts
git commit -m "feat(web): add git diff and file clients"
```

---

### Task 7: Pin react-diff-view and map hunk JSON

**Files:**
- Modify: `packages/web/package.json` and the lockfile via `bun add`
- Create: `packages/web/src/components/workflows/source-control/git-hunk-adapter.ts`
- Create: `packages/web/src/components/workflows/source-control/git-hunk-adapter.test.ts`

**Interfaces:**
- Consumes: generated `GitDiffHunk` / `GitDiffChange`.
- Produces: `toHunkData(hunk): HunkData`, `toChangeData(change): ChangeData`, `hunksForSide(hunks, 'old' | 'new'): HunkData[]`.

- [ ] **Step 1: Install the pinned dependency (required before the mapper tests import it)**

Run from the repository root:

```bash
bun --filter @archon/web add react-diff-view@3.3.3
```

Expected: `packages/web/package.json` lists `"react-diff-view": "3.3.3"`.
Do not add lodash, Shiki, Monaco, or refractor as direct dependencies.

- [ ] **Step 2: Write the failing mapper tests**

Create `packages/web/src/components/workflows/source-control/git-hunk-adapter.test.ts`:

```ts
import { describe, expect, test } from 'bun:test';

import type { GitDiffHunk } from '@/lib/api';

import { hunksForSide, toHunkData } from './git-hunk-adapter';

const hunk: GitDiffHunk = {
  oldStart: 1,
  oldLines: 2,
  newStart: 1,
  newLines: 3,
  header: '@@ -1,2 +1,3 @@',
  changes: [
    { type: 'normal', content: 'line1', oldLine: 1, newLine: 1 },
    { type: 'delete', content: 'old', oldLine: 2 },
    { type: 'insert', content: 'new', newLine: 2 },
    { type: 'insert', content: 'tail', newLine: 3 },
  ],
};

describe('toHunkData', () => {
  test('maps wire hunks onto react-diff-view HunkData and ChangeData flags', () => {
    const mapped = toHunkData(hunk);
    expect(mapped.content).toBe('@@ -1,2 +1,3 @@');
    expect(mapped.oldStart).toBe(1);
    expect(mapped.changes[1]).toMatchObject({
      type: 'delete',
      content: 'old',
      isDelete: true,
      isInsert: false,
      isNormal: false,
      oldLineNumber: 2,
    });
    expect(mapped.changes[2]).toMatchObject({
      type: 'insert',
      content: 'new',
      isInsert: true,
      newLineNumber: 2,
    });
  });
});

describe('hunksForSide', () => {
  test('drops inserts from the before pane and deletes from the after pane', () => {
    const mapped = toHunkData(hunk);
    const before = hunksForSide([mapped], 'old');
    const after = hunksForSide([mapped], 'new');
    expect(before[0]?.changes.map(change => change.type)).toEqual(['normal', 'delete']);
    expect(after[0]?.changes.map(change => change.type)).toEqual(['normal', 'insert', 'insert']);
  });
});
```

- [ ] **Step 3: Run the test and verify RED**

Run:

```bash
bun test packages/web/src/components/workflows/source-control/git-hunk-adapter.test.ts
```

Expected: FAIL because `./git-hunk-adapter` does not exist.

- [ ] **Step 4: Implement the mapper**

Create `packages/web/src/components/workflows/source-control/git-hunk-adapter.ts`:

```ts
import type { ChangeData, HunkData } from 'react-diff-view';

import type { GitDiffChange, GitDiffHunk } from '@/lib/api';

export function toChangeData(change: GitDiffChange): ChangeData {
  return {
    type: change.type,
    content: change.content,
    isNormal: change.type === 'normal',
    isInsert: change.type === 'insert',
    isDelete: change.type === 'delete',
    oldLineNumber: change.oldLine,
    newLineNumber: change.newLine,
    lineNumber: change.type === 'insert' ? change.newLine : change.oldLine,
  };
}

export function toHunkData(hunk: GitDiffHunk): HunkData {
  return {
    oldStart: hunk.oldStart,
    oldLines: hunk.oldLines,
    newStart: hunk.newStart,
    newLines: hunk.newLines,
    content: hunk.header,
    changes: hunk.changes.map(toChangeData),
  };
}

export function hunksForSide(hunks: readonly HunkData[], side: 'old' | 'new'): HunkData[] {
  return hunks.map(hunk => {
    const changes = hunk.changes.filter(change =>
      side === 'old' ? change.type !== 'insert' : change.type !== 'delete'
    );
    return { ...hunk, changes };
  });
}
```

If `ChangeData` / `HunkData` are not exported from `react-diff-view@3.3.3`, declare local structural types with those exact fields in this file and keep the tests' assertions.

Do not import highlight.js here.

- [ ] **Step 5: Verify GREEN**

Run:

```bash
bun test packages/web/src/components/workflows/source-control/git-hunk-adapter.test.ts
( cd packages/web && bun run type-check )
```

Expected: both PASS.

- [ ] **Step 6: Commit the viewer dependency and mapper**

```bash
git add packages/web/package.json bun.lock packages/web/src/components/workflows/source-control/git-hunk-adapter.ts packages/web/src/components/workflows/source-control/git-hunk-adapter.test.ts
git commit -m "feat(web): map git hunk JSON to react-diff-view"
```

If the lockfile name is `bun.lockb`, stage that file instead.

---

### Task 8: Make the Changes list a reusable openable widget

**Files:**
- Create: `packages/web/src/components/workflows/source-control/changed-files-list.tsx`
- Modify: `packages/web/src/components/workflows/source-control/changed-file-row.tsx`
- Modify: `packages/web/src/components/workflows/source-control/source-control-panel.tsx`
- Modify: `packages/web/src/components/workflows/source-control/source-control-panel.test.tsx`

**Interfaces:**
- Consumes: `GitChangedFile`.
- Produces: `ChangedFilesList` with `ariaLabel`, `files`, `activeIndex`, `selectedPath`, `onActiveIndexChange`, `onOpen`.
- Produces: `SourceControlPanel` `onOpenFile?: (file: GitChangedFile) => void`.

- [ ] **Step 1: Write the failing open/select tests**

Add these cases to `source-control-panel.test.tsx` (keep existing copy tests):

```ts
test('exposes a reusable listbox labelled for Changes or a caller-supplied scope', () => {
  const html = renderPanel({
    snapshot: { files: [{ path: 'a.ts', status: 'M' }], revision: 'a'.repeat(64) },
    ariaLabel: 'Commit files',
  });
  expect(html).toContain('aria-label="Commit files"');
});
```

That case is RED until `SourceControlPanel` accepts `ariaLabel` defaulting to `Uncommitted changes`.
Then add a unit test file `changed-files-list.test.tsx` is unnecessary if the panel tests cover markup; add this pure expectation instead:

```ts
test('Enter and Space keep the active index so the panel can open that row', () => {
  expect(nextChangedFileIndex('Enter', 1, 3)).toBe(1);
  expect(nextChangedFileIndex(' ', 1, 3)).toBe(1);
});
```

That second test already matches Task 1.1 behavior; keep it as a characterization.
The RED for this task is the missing `ariaLabel` prop and the missing `onOpenFile` wiring documented in Step 3.

- [ ] **Step 2: Run the test and verify RED**

Run:

```bash
bun test packages/web/src/components/workflows/source-control/source-control-panel.test.tsx
```

Expected: FAIL on the new `ariaLabel` assertion.

- [ ] **Step 3: Extract the list widget and wire open**

Update `changed-file-row.tsx` so the option is clickable:

```ts
export function ChangedFileRow(props: {
  file: GitChangedFile;
  id: string;
  active: boolean;
  selected: boolean;
  onOpen: () => void;
}): ReactElement {
```

Set `aria-selected={props.selected || props.active}` is wrong; keep `aria-selected={props.active}` for the roving index, and add `data-open={props.selected ? 'true' : 'false'}`.
Call `props.onOpen` from `onClick`.

Create `packages/web/src/components/workflows/source-control/changed-files-list.tsx`:

```ts
import { useRef, type KeyboardEvent, type ReactElement } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';

import type { GitChangedFile } from '@/lib/api';

import { ChangedFileRow } from './changed-file-row';

export function nextChangedFileIndex(key: string, currentIndex: number, fileCount: number): number {
  if (fileCount <= 0) return 0;
  if (key === 'ArrowDown') return Math.min(fileCount - 1, currentIndex + 1);
  if (key === 'ArrowUp') return Math.max(0, currentIndex - 1);
  if (key === 'Home') return 0;
  if (key === 'End') return fileCount - 1;
  return Math.min(fileCount - 1, Math.max(0, currentIndex));
}

export function ChangedFilesList(props: {
  files: readonly GitChangedFile[];
  activeIndex: number;
  selectedPath: string | null;
  ariaLabel: string;
  onActiveIndexChange: (index: number) => void;
  onOpen: (file: GitChangedFile) => void;
}): ReactElement {
  const parentRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: props.files.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 28,
    overscan: 8,
  });
  const virtualItems = virtualizer.getVirtualItems();
  const rows = virtualItems.length > 0 ? virtualItems.map(item => props.files[item.index]!) : [...props.files];
  const rowIndexes =
    virtualItems.length > 0 ? virtualItems.map(item => item.index) : props.files.map((_, index) => index);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (
      event.key === 'ArrowDown' ||
      event.key === 'ArrowUp' ||
      event.key === 'Home' ||
      event.key === 'End' ||
      event.key === 'Enter' ||
      event.key === ' '
    ) {
      event.preventDefault();
    }
    props.onActiveIndexChange(nextChangedFileIndex(event.key, props.activeIndex, props.files.length));
    if ((event.key === 'Enter' || event.key === ' ') && props.files[props.activeIndex]) {
      props.onOpen(props.files[props.activeIndex]!);
    }
  };

  return (
    <div
      ref={parentRef}
      role="listbox"
      aria-label={props.ariaLabel}
      aria-activedescendant={`sc-file-${String(props.activeIndex)}`}
      tabIndex={0}
      onKeyDown={onKeyDown}
      className="min-h-0 flex-1 overflow-auto p-2"
    >
      {rows.map((file, displayIndex) => {
        const index = rowIndexes[displayIndex] ?? displayIndex;
        return (
          <ChangedFileRow
            key={`${file.status}:${file.path}`}
            id={`sc-file-${String(index)}`}
            file={file}
            active={index === props.activeIndex}
            selected={props.selectedPath === file.path}
            onOpen={(): void => {
              props.onActiveIndexChange(index);
              props.onOpen(file);
            }}
          />
        );
      })}
    </div>
  );
}
```

Update `SourceControlPanelProps` with `onOpenFile?: (file: GitChangedFile) => void`, `selectedPath?: string | null`, and `ariaLabel?: string`.
Replace the inlined listbox with `ChangedFilesList`.
Default `ariaLabel` to `Uncommitted changes`.
If `onOpenFile` is omitted, pass a no-op so existing callers compile.

Keep CAP-6, stale banner, Reload, and region-empty branches unchanged.
Move `nextChangedFileIndex` into `changed-files-list.tsx` and re-export it from `source-control-panel.tsx` so existing tests keep importing it from the panel module.
Do not create a circular import between the panel and the list.

- [ ] **Step 4: Verify GREEN**

Run:

```bash
bun test packages/web/src/components/workflows/source-control/source-control-panel.test.tsx
bun test packages/web/src/components/workflows/source-control/dag-run-tabs.test.tsx
```

Expected: PASS.
Existing tests must still prove letter-carried badges, no History/write chrome, and keyboard index movement.

- [ ] **Step 5: Commit the reusable list**

```bash
git add packages/web/src/components/workflows/source-control/changed-files-list.tsx \
  packages/web/src/components/workflows/source-control/changed-file-row.tsx \
  packages/web/src/components/workflows/source-control/source-control-panel.tsx \
  packages/web/src/components/workflows/source-control/source-control-panel.test.tsx
git commit -m "feat(web): make Changes list openable and reusable"
```

---

### Task 9: Add the reusable status-keyed viewer

**Files:**
- Create: `packages/web/src/components/workflows/source-control/viewport-stack.ts`
- Create: `packages/web/src/components/workflows/source-control/viewport-stack.test.ts`
- Create: `packages/web/src/components/workflows/source-control/source-control-diff.css`
- Create: `packages/web/src/components/workflows/source-control/file-viewer.tsx`
- Create: `packages/web/src/components/workflows/source-control/file-viewer.test.tsx`

**Interfaces:**
- Consumes: `GitChangedFile`, `GitDiffResponse`, `hunksForSide`, `toHunkData`, `Diff`/`Hunk` from `react-diff-view`.
- Produces: `FileViewer` that is not imported by `WorkflowExecution.tsx` and does not import `/console`.

- [ ] **Step 1: Write the failing viewer tests**

Create `packages/web/src/components/workflows/source-control/viewport-stack.test.ts`:

```ts
import { describe, expect, test } from 'bun:test';

import { isStackedViewport } from './viewport-stack';

describe('isStackedViewport', () => {
  test('stacks below 900px and not at 900px', () => {
    expect(isStackedViewport(899)).toBe(true);
    expect(isStackedViewport(900)).toBe(false);
  });
});
```

Create `packages/web/src/components/workflows/source-control/file-viewer.test.tsx`:

```ts
import { describe, expect, test } from 'bun:test';
import type { ComponentProps } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { FileViewer } from './file-viewer';

type Props = ComponentProps<typeof FileViewer>;

function renderViewer(overrides: Partial<Props> = {}): string {
  return renderToStaticMarkup(
    <FileViewer
      file={null}
      loadState="idle"
      stacked={false}
      diff={null}
      content={null}
      binary={false}
      downloadHref={null}
      onCancel={(): void => undefined}
      onClose={(): void => undefined}
      {...overrides}
    />
  );
}

describe('FileViewer', () => {
  test('shows a skeleton and Cancel while bytes are in flight', () => {
    const html = renderViewer({
      file: { path: 'a.ts', status: 'M' },
      loadState: 'loading',
    });
    expect(html).toContain('Cancel');
    expect(html).toContain('Loading file');
  });

  test('renders M as two labelled panes with plus and minus gutters and no snapshot control', () => {
    const html = renderViewer({
      file: { path: 'a.ts', status: 'M' },
      loadState: 'ready',
      diff: {
        path: 'a.ts',
        status: 'M',
        scope: 'now',
        ref: 'live',
        hunks: [
          {
            oldStart: 1,
            oldLines: 1,
            newStart: 1,
            newLines: 1,
            header: '@@ -1 +1 @@',
            changes: [
              { type: 'delete', content: 'old', oldLine: 1 },
              { type: 'insert', content: 'new', newLine: 1 },
            ],
          },
        ],
        cursor: '',
        truncated: false,
        binary: false,
      },
    });
    expect(html).toContain('aria-label="Before"');
    expect(html).toContain('aria-label="After"');
    expect(html).toContain('old');
    expect(html).toContain('new');
    expect(html).toContain('>-<');
    expect(html).toContain('>+<');
    expect(html).not.toContain('Snapshot');
    expect(html).not.toContain('console');
  });

  test('stacks before over after when stacked is true', () => {
    const html = renderViewer({
      file: { path: 'a.ts', status: 'M' },
      loadState: 'ready',
      stacked: true,
      diff: {
        path: 'a.ts',
        status: 'M',
        scope: 'now',
        ref: 'live',
        hunks: [],
        cursor: '',
        truncated: false,
        binary: false,
      },
    });
    expect(html).toContain('flex-col');
  });

  test('renders A and D as a single uncolored pane', () => {
    const added = renderViewer({
      file: { path: 'new.ts', status: 'A' },
      loadState: 'ready',
      content: 'added line',
    });
    expect(added).toContain('added line');
    expect(added).not.toContain('aria-label="Before"');
    const deleted = renderViewer({
      file: { path: 'gone.ts', status: 'D' },
      loadState: 'ready',
      content: 'removed line',
    });
    expect(deleted).toContain('removed line');
  });

  test('does not dump binary bytes as text', () => {
    const html = renderViewer({
      file: { path: 'nul.bin', status: 'A' },
      loadState: 'ready',
      binary: true,
      downloadHref: '/api/workflows/runs/run-1/git/file/nul.bin?source=worktree',
      content: '\u0000secret',
    });
    expect(html).toContain('This file is not text');
    expect(html).toContain('Download');
    expect(html).not.toContain('secret');
  });
});
```

- [ ] **Step 2: Run the tests and verify RED**

Run:

```bash
bun test packages/web/src/components/workflows/source-control/viewport-stack.test.ts
bun test packages/web/src/components/workflows/source-control/file-viewer.test.tsx
```

Expected: FAIL because the modules do not exist.

- [ ] **Step 3: Implement the viewer**

Create `packages/web/src/components/workflows/source-control/viewport-stack.ts`:

```ts
export function isStackedViewport(widthPx: number, breakpointPx = 900): boolean {
  return widthPx < breakpointPx;
}
```

Create `packages/web/src/components/workflows/source-control/source-control-diff.css`:

```css
.source-control-diff .diff-code-insert {
  background: color-mix(in oklch, var(--success) 18%, transparent);
}
.source-control-diff .diff-code-delete {
  background: color-mix(in oklch, var(--error) 18%, transparent);
}
.source-control-gutter-marker {
  color: var(--text-primary);
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 12px;
  width: 1ch;
  display: inline-block;
}
```

Create `packages/web/src/components/workflows/source-control/file-viewer.tsx` that:

- Imports `Diff` and `Hunk` from `react-diff-view` and `react-diff-view/style/index.css` plus `source-control-diff.css`.
- For `loadState === 'loading'` renders `role="status"` text `Loading file` and a `Cancel` button calling `onCancel`.
- For `binary` renders the sentence `This file is not text. Download to inspect.` and an `<a download href={downloadHref}>Download</a>` when `downloadHref` is set; it must not render `content`.
- For `file.status === 'M'` and a ready non-binary `diff`, maps hunks with `toHunkData`, splits with `hunksForSide`, and renders two `overflow-auto min-h-0 flex-1` panes labelled `Before` and `After`.
- Uses `viewType="unified"` and `diffType="modify"` on each pane.
- Passes `renderGutter` so a `span.source-control-gutter-marker` contains `-` for deletes, `+` for inserts, and a space otherwise, then the default gutter.
- Wraps panes in `flex h-full min-h-0` plus `flex-col` when `stacked` else `flex-row`.
- For `A`/`D` ready text, renders one `<pre className="h-full min-h-0 overflow-auto whitespace-pre p-3 font-mono text-xs text-text-primary">`.
- For idle with no file, renders `Select a file to inspect`.
- Sets `tabIndex={0}` on each scroll pane.
- Does not import highlight.js, Shiki, Monaco, or anything under `experiments/console`.

If `renderToStaticMarkup` does not emit `>+<` because `renderGutter` is client-only, add a visually present `span` sibling in the gutter renderer and also put `aria-label="insert"` / `aria-label="delete"` on those markers, then assert those labels in the test instead of the raw `>+<` characters.
Prefer asserting the marker characters because NFR7 requires the `+`/`-` glyphs.

- [ ] **Step 4: Verify GREEN**

Run:

```bash
bun test packages/web/src/components/workflows/source-control/viewport-stack.test.ts
bun test packages/web/src/components/workflows/source-control/file-viewer.test.tsx
bun test packages/web/src/components/workflows/source-control/git-hunk-adapter.test.ts
( cd packages/web && bun run type-check )
```

Expected: all PASS.
If `Diff` cannot render under `renderToStaticMarkup`, wrap it in a small `DiffPane` that still writes the `+`/`-` spans from `hunk.changes` even when the library returns empty HTML.

- [ ] **Step 5: Commit the viewer**

```bash
git add packages/web/src/components/workflows/source-control/viewport-stack.ts \
  packages/web/src/components/workflows/source-control/viewport-stack.test.ts \
  packages/web/src/components/workflows/source-control/source-control-diff.css \
  packages/web/src/components/workflows/source-control/file-viewer.tsx \
  packages/web/src/components/workflows/source-control/file-viewer.test.tsx
git commit -m "feat(web): add shared status-keyed git viewer"
```

---

### Task 10: Split the tab and fetch on open

**Files:**
- Create: `packages/web/src/components/workflows/source-control/source-control-split.tsx`
- Modify: `packages/web/src/components/workflows/source-control/source-control-tab.tsx`
- Modify: `packages/web/src/components/workflows/source-control/source-control-panel.tsx` if needed to fill the list pane height
- Create: `packages/web/src/component-integration/source-control-viewer.test.tsx`
- Modify: `packages/web/package.json`

**Interfaces:**
- Consumes: `getWorkflowRunGitDiff`, `getWorkflowRunGitFile`, `gitFileUrl`, `AbortController`.
- Produces: 30/70 `ResizablePanelGroup` inside `SourceControlTab`; `WorkflowExecution.tsx` stays a one-line mount.

- [ ] **Step 1: Write the failing mounted viewer tests**

Create `packages/web/src/component-integration/source-control-viewer.test.tsx` by copying the happy-dom, QueryClient, and `renderTab` helpers from `source-control-tab.test.tsx`, then adding:

```ts
test('opens an M file from the list via the diff URL and keeps the list visible', async () => {
  fetchSpy = spyOn(globalThis, 'fetch').mockImplementation((async (input: RequestInfo) => {
    const url = String(input);
    if (url.includes('/git/changes')) {
      return new Response(
        JSON.stringify({
          files: [{ path: 'src/a.ts', status: 'M' }],
          revision: REVISION_A,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }
    if (url.includes('/git/diff')) {
      return new Response(
        JSON.stringify({
          path: 'src/a.ts',
          status: 'M',
          scope: 'now',
          ref: 'live',
          hunks: [
            {
              oldStart: 1,
              oldLines: 1,
              newStart: 1,
              newLines: 1,
              header: '@@ -1 +1 @@',
              changes: [
                { type: 'delete', content: 'old', oldLine: 1 },
                { type: 'insert', content: 'new', newLine: 1 },
              ],
            },
          ],
          cursor: '',
          truncated: false,
          binary: false,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }
    throw new Error(`unexpected ${url}`);
  }) as unknown as typeof fetch);

  await renderTab('run/one');
  await waitFor(() => host.textContent?.includes('src/a.ts'), 'the changed file row');
  const row = host.querySelector('#sc-file-0');
  if (!(row instanceof HTMLElement)) throw new Error('missing row');
  await act(async () => {
    row.click();
  });
  await waitFor(() => host.textContent?.includes('old'), 'the before pane');
  expect(host.textContent).toContain('src/a.ts');
  expect(host.textContent).toContain('Before');
  expect(String(fetchSpy.mock.calls.map(call => String(call[0]))).join('\n')).toContain(
    '/api/workflows/runs/run%2Fone/git/diff?path=src%2Fa.ts'
  );
  expect(String(fetchSpy.mock.calls.map(call => String(call[0]))).join('\n')).not.toContain('working_path');
});

test('opens A via worktree and D via head and never calls the diff route', async () => {
  fetchSpy = spyOn(globalThis, 'fetch').mockImplementation((async (input: RequestInfo) => {
    const url = String(input);
    if (url.includes('/git/changes')) {
      return new Response(
        JSON.stringify({
          files: [
            { path: 'new.ts', status: 'A' },
            { path: 'gone.ts', status: 'D' },
          ],
          revision: REVISION_A,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }
    if (url.includes('/git/file/new.ts?source=worktree')) {
      return new Response('added\n', { status: 200, headers: { 'Content-Type': 'text/plain' } });
    }
    if (url.includes('/git/file/gone.ts?source=head')) {
      return new Response('removed\n', { status: 200, headers: { 'Content-Type': 'text/plain' } });
    }
    throw new Error(`unexpected ${url}`);
  }) as unknown as typeof fetch);

  await renderTab('run-1');
  await waitFor(() => host.textContent?.includes('new.ts'), 'added row');
  const added = host.querySelector('#sc-file-0');
  if (!(added instanceof HTMLElement)) throw new Error('missing added row');
  await act(async () => {
    added.click();
  });
  await waitFor(() => host.textContent?.includes('added'), 'added content');
  const deleted = host.querySelector('#sc-file-1');
  if (!(deleted instanceof HTMLElement)) throw new Error('missing deleted row');
  await act(async () => {
    deleted.click();
  });
  await waitFor(() => host.textContent?.includes('removed'), 'deleted content');
  const urls = fetchSpy.mock.calls.map(call => String(call[0])).join('\n');
  expect(urls).not.toContain('/git/diff');
});

test('Cancel aborts the in-flight open and leaves the list in place', async () => {
  let diffStarted: (() => void) | undefined;
  const diffGate = new Promise<void>(resolve => {
    diffStarted = resolve;
  });
  fetchSpy = spyOn(globalThis, 'fetch').mockImplementation((async (input: RequestInfo, init?: RequestInit) => {
    const url = String(input);
    if (url.includes('/git/changes')) {
      return new Response(
        JSON.stringify({ files: [{ path: 'slow.ts', status: 'M' }], revision: REVISION_A }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }
    if (url.includes('/git/diff')) {
      diffStarted?.();
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(resolve, 5_000);
        init?.signal?.addEventListener('abort', () => {
          clearTimeout(timeout);
          reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
        });
      });
    }
    throw new Error(`unexpected ${url}`);
  }) as unknown as typeof fetch);

  await renderTab('run-1');
  await waitFor(() => host.textContent?.includes('slow.ts'), 'row');
  const row = host.querySelector('#sc-file-0');
  if (!(row instanceof HTMLElement)) throw new Error('missing row');
  await act(async () => {
    row.click();
  });
  await waitFor(() => host.textContent?.includes('Cancel'), 'cancel control');
  await act(async () => {
    requireButton('Cancel').click();
  });
  await waitFor(() => !host.textContent?.includes('Loading file'), 'cancelled viewer');
  expect(host.textContent).toContain('slow.ts');
});
```

Copy `REVISION_A`, `installHappyDom`, `waitFor`, `requireButton`, and render helpers from the existing tab test so this file is isolated.

- [ ] **Step 2: Run the test and verify RED**

Run:

```bash
NODE_ENV=development bun test packages/web/src/component-integration/source-control-viewer.test.tsx
```

Expected: FAIL because clicking a row does not fetch `/git/diff`.

- [ ] **Step 3: Implement the split and open orchestration**

Create `packages/web/src/components/workflows/source-control/source-control-split.tsx`:

```ts
import type { ReactElement, ReactNode } from 'react';

import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable';

export function SourceControlSplit(props: {
  stacked: boolean;
  list: ReactNode;
  viewer: ReactNode;
}): ReactElement {
  return (
    <ResizablePanelGroup
      orientation={props.stacked ? 'vertical' : 'horizontal'}
      className="h-full min-h-0"
    >
      <ResizablePanel defaultSize={30} minSize={20} maxSize={70}>
        {props.list}
      </ResizablePanel>
      <ResizableHandle withHandle />
      <ResizablePanel defaultSize={70} minSize={30}>
        {props.viewer}
      </ResizablePanel>
    </ResizablePanelGroup>
  );
}
```

Update `SourceControlTab` to:

1. Keep the existing changes query and snapshot reducer (do not poll).
2. Track `selected: GitChangedFile | null`, `loadState` for the viewer, `diff`, `content`, `binary`, and an `AbortController` ref.
3. On `onOpenFile`, abort the previous controller, create a new one, set loading, then:
   - `M` → `getWorkflowRunGitDiff(runId, file.path, { signal })`
   - `A` → `getWorkflowRunGitFile(runId, file.path, 'worktree', { signal })`
   - `D` → `getWorkflowRunGitFile(runId, file.path, 'head', { signal })`
4. Ignore `AbortError`.
5. If the diff/file result is CAP-6 empty, do not replace the frozen Changes snapshot.
   Show the viewer idle instead.
6. If `binary` (diff.binary or file result kind binary), set `binary` true and `downloadHref` to `gitFileUrl` with worktree for A/M and head for D.
7. Cancel calls `abort()` and clears the open file so Cancel matches Story 1.2 cancel-in-flight.
8. Use `window.matchMedia('(max-width: 899px)')` to set `stacked`; subscribe to `change`.
9. Wrap `SourceControlPanel` and `FileViewer` in `SourceControlSplit`.
10. Pass `onOpenFile` and `selectedPath`.
11. On `accept_pending`, close the viewer when the new file list no longer includes the selected path.
    If it still includes that path, refetch the open file.
12. Handle `Escape` on the split container by closing the viewer and focusing the listbox.
13. Do not pass `workingPath` anywhere.
14. Do not import `/console`.

Insert this isolated invocation into `packages/web/package.json` immediately after the existing `source-control-tab.test.tsx` invocation:

```text
&& NODE_ENV=development bun test src/component-integration/source-control-viewer.test.tsx
```

- [ ] **Step 4: Verify GREEN**

Run:

```bash
NODE_ENV=development bun test packages/web/src/component-integration/source-control-viewer.test.tsx
NODE_ENV=development bun test packages/web/src/component-integration/source-control-tab.test.tsx
bun test packages/web/src/components/workflows/source-control/
( cd packages/web && bun run type-check )
```

Expected: all PASS with no React act warnings.
The existing stale-list test must still keep `old.ts` until `Changed on disk — Reload` is accepted.

- [ ] **Step 5: Commit the split tab**

```bash
git add packages/web/src/components/workflows/source-control/source-control-split.tsx \
  packages/web/src/components/workflows/source-control/source-control-tab.tsx \
  packages/web/src/component-integration/source-control-viewer.test.tsx \
  packages/web/package.json
git commit -m "feat(web): open Source Control files in a 30/70 viewer"
```

---

### Task 11: Run acceptance gates and update sprint status

**Files:**
- Modify: `_bmad-output/implementation-artifacts/archon-source-control/sprint-status.yaml`

**Interfaces:**
- Consumes: the complete implementation from Tasks 1 through 10.
- Produces: `1-2-open-a-changed-file-in-the-shared-viewer: done` only after all gates pass.

- [ ] **Step 1: Run every focused test in its intended process**

Run:

```bash
bun test packages/git/src/git-path.test.ts
bun test packages/git/src/file-read.test.ts
bun test packages/server/src/routes/git/checkout-gate.test.ts
bun test packages/server/src/routes/api.git-changes.test.ts
bun test packages/server/src/routes/api.git-diff.test.ts
bun test packages/server/src/routes/api.git-file.test.ts
bun test packages/web/src/lib/api.git-changes.test.ts
bun test packages/web/src/lib/api.git-file.test.ts
bun test packages/web/src/components/workflows/source-control/
NODE_ENV=development bun test packages/web/src/component-integration/source-control-tab.test.tsx
NODE_ENV=development bun test packages/web/src/component-integration/source-control-viewer.test.tsx
bun test packages/web/src/components/workflows/WorkflowExecution.test.tsx
```

Expected: every command exits 0 with no test failures or React act warnings.

- [ ] **Step 2: Run affected package suites**

Run:

```bash
bun --filter @archon/git test
bun --filter @archon/server test
bun --filter @archon/web test
```

Expected: all package scripts exit 0.
The new server tests and the mounted viewer test must appear as their own Bun invocations in the script output.

- [ ] **Step 3: Run the mandatory repository gate**

Run:

```bash
bun run validate
git diff --check
```

Expected: both commands exit 0.
Do not mark the story done if type-check, lint with zero warnings, format-check, install smoke, any package test, or any generated-file check fails.

- [ ] **Step 4: Confirm the acceptance matrix**

| Criterion | Automated or inspection proof |
| --- | --- |
| Select a Now file opens the shared viewer | `source-control-viewer.test.tsx` |
| Viewer lives under `source-control/` and is not welded into `WorkflowExecution.tsx` | `WorkflowExecution.tsx` still mounts only `SourceControlTab`; scoped diff has no console import |
| List widget is reusable via `ariaLabel` | panel `ariaLabel` test plus `ChangedFilesList` export |
| 30/70 split resizable 20–70% | `SourceControlSplit` `defaultSize={30}` / `70`, `minSize={20}` / `maxSize={70}` |
| `M` is two independently scrolling panes, HEAD → worktree | viewer tests plus `fileDiff` real-git test |
| `+` / `-` gutters, not color-only | file-viewer marker assertions plus `source-control-diff.css` using `--text-primary` |
| No standalone snapshot mode | file-viewer test forbids `Snapshot` |
| `A`/`D` use the raw route, not diff | mounted A/D test |
| Hunk JSON shape with `scope: "now"` and `ref: "live"` | HTTP diff test plus mapper test |
| `cursor` is opaque and unused in 1.2 | client test omits `cursor=` when empty |
| Below 900px lists-above-viewer and before-over-after | `isStackedViewport(899)` and viewer `flex-col` test |
| Skeleton + Cancel for in-flight open | file-viewer loading test and mounted Cancel test |
| Viewer keyboard: panes tabbable, Escape closes | tab `tabIndex={0}` and Escape handler in `SourceControlTab` |
| Live `realpath` containment and symlink refuse | `git-path.test.ts` |
| Encoded `..` refuse | HTTP diff and file tests |
| Colon / leading-dash / glob success | `file-read.test.ts` and raw colon HTTP test |
| `ls-tree` + `cat-file`, never `oid:path` | `file-read.test.ts` argv assertion |
| CAP-6 HTTP 200 on both new routes | diff and file HTTP tests |
| One new dep `react-diff-view@3.3.3` | `packages/web/package.json` |
| No Shiki/Monaco/refractor | scoped diff |
| NUL not dumped as text | file-read binary test, raw octet-stream test, viewer binary test |
| Frozen list snapshot still holds during Reload | existing tab integration test |
| Pino names and path privacy | HTTP logger assertions |
| No write chrome | existing panel tests |
| Story 1.3 thresholds not invented | no 256 KB / 1 MB / 50 MB constants added |

- [ ] **Step 5: Perform a legacy-screen smoke check**

Run the application:

```bash
bun run dev
```

Open an existing DAG run, select Source Control, click an `M` file and an `A` or `D` file.
Confirm the 30/70 split, independent pane scroll, Cancel while loading if the file is slow, no History region, and no browser console React errors.
Stop the dev processes started for this check.
If no DAG run with a live checkout exists, record that the automated git, HTTP, mapper, viewer, and mounted tests are the acceptance evidence; do not fabricate a run or broaden this story.

- [ ] **Step 6: Update sprint status only after Steps 1 through 5 pass**

In `_bmad-output/implementation-artifacts/archon-source-control/sprint-status.yaml`, change only:

```yaml
development_status:
  epic-1: in-progress
  1-1-see-this-runs-uncommitted-files: done
  1-2-open-a-changed-file-in-the-shared-viewer: done
```

Keep Story 1.3 at `backlog`.
Set `last_updated: 2026-09-06`.

- [ ] **Step 7: Commit the tracker update**

```bash
git add _bmad-output/implementation-artifacts/archon-source-control/sprint-status.yaml
git commit -m "chore(sc): mark shared-viewer story done"
```

## Out of Scope

- Story 1.3 large-text cutoffs, Load more, streaming, 50 MB download-only, inline images, and hex peek.
- Epic 2 History, commit log, per-commit files, commit OIDs on HTTP, and lane graph.
- CAP-8 durable snapshot writing.
- Container overlay reads.
- Secret redaction.
- Syntax highlighting via highlight.js HTML.
- Persisted split sizes.
- A new tab model for sequential non-DAG runs.

## Pull Request Handoff

Before opening a pull request, rerun `bun run validate` and use `.github/pull_request_template.md`.
Keep Problem and outcome, Review guidance, Solution, and Validation.
Include focused RED/GREEN evidence, the full validation result, the manual smoke result or its explicit no-local-run limitation, and `Closes #76`.
Do not write `N/A` sections and do not close the issue outside the PR workflow.
