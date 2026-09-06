# Open a Commit's Files in the Same Viewer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.
> Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an operator select a commit on the legacy Source Control History graph, expand that commit's `M` / `A` / `D` files inline, and open them in the existing shared viewer as `parent → commit`.

**Architecture:** `@archon/git` extends the existing `changedFiles` and `fileDiff` helpers with an optional full commit object name.
The server reuses `loadRunCheckout` and the CAP-6 gate, and it accepts a server-issued lowercase object name on the existing JSON changes/diff routes plus the raw file wildcard.
The web keeps Changes pinned at the top, expands at most one commit inline in History with the same `ChangedFilesList` widget, and loads the already-mounted `FileViewer` with `scope: "commit"` and `ref` equal to that object name.

**Tech Stack:** Bun 1.3, strict TypeScript, Node `execFile` through `@archon/git`, Hono OpenAPI, Zod from `@hono/zod-openapi`, React 19, TanStack Query 5, installed `@tanstack/react-virtual` 3, installed `react-diff-view` 3.3.3, and Bun tests.
Do not add a dependency.

**Spec:** `_bmad-output/planning-artifacts/epics-source-control/epics.md`, Story 2.2.

**Canonical design:** `_bmad-output/specs/spec-archon-source-control/SPEC.md` CAP-2, CAP-3, CAP-4, CAP-5, CAP-6; `_bmad-output/specs/spec-archon-source-control/viewer-rules.md`; `_bmad-output/planning-artifacts/architecture/architecture-Archon-source-control-2026-09-05/ARCHITECTURE-SPINE.md` AD-1 through AD-7 and AD-9; `_bmad-output/planning-artifacts/prds/prd-source-control/addendum.md`; `_bmad-output/planning-artifacts/ux-designs/ux-Archon-2026-08-31/DESIGN.md` `commit-graph-row.expand`; `_bmad-output/planning-artifacts/ux-designs/ux-Archon-2026-08-31/EXPERIENCE.md` Inspect a commit / Return to Now.

**Issue:** [#79](https://github.com/anhle128/Archon/issues/79), tracker key `2-2-open-a-commits-files-in-the-same-viewer`.

**Depends on:** Stories 1.1–1.3 and 2.1 are `done` in `_bmad-output/implementation-artifacts/archon-source-control/sprint-status.yaml`.

## Global Constraints

- Story 2.2 reuses the Story 1.2/1.3 viewer and the Story 2.1 lane graph.
- Do not add a second viewer, a second diff library, Shiki, Monaco, or any new dependency.
- The surface remains `/legacy/workflows/runs/:id`.
- No file under `packages/web/src/experiments/console/` may be imported or modified.
- Do not modify `packages/web/src/components/workflows/WorkflowExecution.tsx`.
- The client sends only `runId`, server-issued git-relative paths, and server-issued full commit object names from `/git/log`.
- Never send `working_path`, an absolute path, `HEAD`, `live`, a short SHA, a branch name, or `oid:path`.
- The server loads existing `workflow_runs.working_path`.
- Do not add a database column and do not reconstruct the checkout from isolation metadata.
- Every git invocation uses an argv array through `execFileAsync` or `streamGitStdout`.
- Never use `exec`, a shell string, or `oid:path` syntax.
- Tree-shaped reads stay `git --literal-pathspecs ls-tree -z TREE -- PATH` then `git cat-file blob BLOB_OID`.
- `fileAt` already accepts `{ kind: 'tree', treeIsh }` for any colon-free tree-ish; Story 2.2 must not add a new `fileAt` overload.
- Commit file lists use `git diff-tree` name-status, not `git status`, not `git show`, and not `workflow_events`.
- Merge commits compare the first parent to the commit.
- Root commits use `diff-tree --root`.
- Do not hard-code the SHA-1 empty tree.
- Do not extend `execFileAsync` with stdin for this story.
- Path validation still rejects empty, NUL, POSIX absolute, Windows drive or UNC, encoded `..`, and `.git` as the first segment.
- Filenames containing a colon, a leading dash, spaces, newlines, or glob metacharacters must still work.
- JSON routes use `registerOpenApiRoute(createRoute(...), handler)`.
- The raw file route stays `app.get` because OpenAPI 3.0 cannot represent the wildcard path.
- JSON web types come from regenerated `packages/web/src/lib/api.generated.d.ts`.
- `GitFileSource` remains hand-typed because the raw wildcard route is absent from OpenAPI.
- Auth remains the global `/api/*` gate with no `requireWebUser` and no per-run owner ACL.
- Every git route still returns HTTP 200 with `{ emptyReason: "container" | "no_checkout" }` for CAP-6, including commit-scoped reads.
- There is no "history is immutable" exemption for containers.
- Now diffs stay `scope: "now"` and `ref: "live"`.
- Commit diffs use `scope: "commit"` and `ref` equal to the full lowercase object name, never `"live"`.
- `A` / `D` still use the raw content route, not the hunk endpoint.
- Commit `A` reads the commit tree.
- Commit `D` reads the first-parent tree.
- Commit `M` is diff-only except the existing Story 1.3 binary `fileFallback` path, which then reads the commit tree (the after side).
- Hunk `cursor` stays opaque.
- Story 1.3 first-paint, Load more, Cancel, inline image, hex peek, and download-only thresholds stay unchanged.
- `onLoadMore` for a commit-scoped text or diff page must keep sending that commit oid, not `worktree` / `head` / Now `live`.
- Changes stays pinned at the top.
- Clicking a commit expands or collapses that commit's file list inline beneath the graph row.
- At most one commit is expanded.
- There is no Back control.
- Return-to-Now is clicking a Changes row or collapsing History; Changes never disappears.
- Expanding a commit must not open the viewer.
- Opening a file from either list uses the same `FileViewer`.
- Reload still refetches Changes and History together, and also refetches the expanded commit list when one is expanded.
- The open view is never mutated until the operator accepts `Changed on disk — Reload`.
- No stage, unstage, edit, discard, or commit chrome.
- Pino events stay `domain.action_state`, pair started with completed or failed, and never log checkout paths, remotes, file contents, file paths, object names, subjects, or path-bearing error messages.
- Failure logs contain only `runId` and a stable `errorType`.
- User copy is terse and non-alarming and must not introduce `Error:`, `unsupported`, or a warning glyph.
- Empty commit files copy is `No file changes`, not `No uncommitted changes`, and not CAP-6.
- Do not add a new package-root I/O export.
- Existing `mock.module('@archon/git')` factories therefore do not need a new stub.
- Continue using the isolated `packages/server/src/routes/api.git-changes.test.ts` process for all git HTTP routes.
- Continue using the isolated `packages/web/src/component-integration/source-control-tab.test.tsx` process for mounted behavior.
- Every behavior change follows RED, verified RED, minimal GREEN, verified GREEN, and only then refactoring.
- Run command blocks from the repository root, and use a subshell for commands that must execute inside a package.
- Do not run `bun test` from the repository root without a path.
- Component and mounted web tests must set `NODE_ENV=development`.
- Do not mark the tracker done until focused tests, affected package suites, `bun run validate`, `git diff --check`, and the manual acceptance check all pass.
- Every full Markdown sentence in this plan stays on one physical line.

## File Structure

- Create `packages/git/src/git-oid.ts` for full-object-name parsing and first-parent resolution.
- Create `packages/git/src/git-oid.test.ts` for format and reachable-commit behavior.
- Modify `packages/git/src/changed-files.ts` to parse `diff-tree` name-status and accept `{ commit }`.
- Modify `packages/git/src/changed-files.test.ts` for parser cases plus a nested real-repository describe that does not mutate the existing Now fixture.
- Modify `packages/git/src/index.ts` to export `parseNameStatusZ` beside `parsePorcelainV1Z`.
- Do not export `parseGitObjectId`, `resolveCommitParents`, `FULL_GIT_OBJECT_ID_RE`, or `GitCommitRefError` from the package root.
- Do not modify `packages/git/src/git-log.ts`; leave its local `FULL_OID_RE` in place.
- Modify `packages/git/src/file-read.ts` so `FileDiffRequest` / `FileDiffResult` accept commit scope.
- Modify `packages/git/src/file-read.test.ts` with a nested commit-diff describe that uses its own temp repo.
- Modify `packages/server/src/routes/git/path-input.ts` to add `isValidGitObjectId`.
- Do not modify `packages/server/src/routes/schemas/git.schemas.ts`; the optional `ref` query lives on the route objects.
- Modify `packages/server/src/routes/git/changes-route.ts` and `changes-handler.ts` for optional `ref`.
- Modify `packages/server/src/routes/git/diff-route.ts` and `diff-handler.ts` for optional `ref`.
- Modify `packages/server/src/routes/git/file-handler.ts` so `source` may be `worktree`, `head`, or a full object name.
- Modify `packages/server/src/routes/api.git-changes.test.ts` under the existing isolated mock graph.
- Widen `handleGitChanges` `apiError` status to include `400`.
- Regenerate `packages/web/src/lib/api.generated.d.ts` from `http://localhost:3090/api/openapi.json`.
- Modify `packages/web/src/lib/api.ts` and `packages/web/src/lib/api.git-changes.test.ts`.
- Modify `packages/web/src/components/workflows/source-control/commit-graph-row.tsx` for `aria-expanded`.
- Modify `packages/web/src/components/workflows/source-control/commit-history-graph.tsx` and `commit-history-graph.test.tsx`.
- Modify `packages/web/src/components/workflows/source-control/source-control-panel.tsx` and `source-control-panel.test.tsx`.
- Modify `packages/web/src/components/workflows/source-control/source-control-tab.tsx`.
- Modify `packages/web/src/component-integration/source-control-tab.test.tsx`.
- Modify `_bmad-output/implementation-artifacts/archon-source-control/sprint-status.yaml` only after every acceptance gate passes.
- Do not modify any `mock.module('@archon/git')` factory outside `packages/server/src/routes/api.git-changes.test.ts`.

## Locked Contracts

```ts
export const FULL_GIT_OBJECT_ID_RE = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/;

export class GitCommitRefError extends Error {
  readonly code: 'invalid_ref';
}

export function parseGitObjectId(raw: string): string;
export async function resolveCommitParents(
  workingPath: RepoPath | WorktreePath,
  oid: string
): Promise<string[]>;

export function parseNameStatusZ(stdout: string): PorcelainEntry[];

export interface ChangedFilesRequest {
  commit?: string;
}

export async function changedFiles(
  workingPath: RepoPath | WorktreePath,
  request?: ChangedFilesRequest
): Promise<ChangedFilesResult>;

export interface FileDiffRequest {
  cursor?: string;
  signal?: AbortSignal;
  commit?: string;
}

export interface FileDiffResult {
  path: string;
  status: 'M';
  scope: 'now' | 'commit';
  ref: 'live' | string;
  hunks: DiffHunk[];
  cursor: string;
  truncated: boolean;
  binary: boolean;
  fileFallback: boolean;
}
```

`ChangedFilesResult` stays `{ files: ChangedFile[]; revision: string }` with `revision` a 64-character lowercase SHA-256.

For a commit list, `revision` is `sha256(oid + '\0' + name-status stdout)`.

`parents` from `rev-list --parents -n 1 OID` is ordered first parent first.

A missing `commit` option keeps today's porcelain Now path byte-for-byte, including a one-argument `changedFiles(workingPath)` call.

Transport:

- Now list: `GET /api/workflows/runs/{runId}/git/changes`
- Commit list: `GET /api/workflows/runs/{runId}/git/changes?ref=FULL_OID`
- Now diff: `GET /api/workflows/runs/{runId}/git/diff?path=GIT_PATH&cursor=OPAQUE_OPTIONAL`
- Commit diff: `GET /api/workflows/runs/{runId}/git/diff?path=GIT_PATH&ref=FULL_OID&cursor=OPAQUE_OPTIONAL`
- Raw Now added: `?source=worktree`
- Raw Now deleted: `?source=head`
- Raw commit blob: `?source=FULL_OID`

Unknown query keys including `working_path` are ignored for checkout resolution.

Malformed or unreachable `ref` / commit `source` is HTTP 400 `{ error: "Invalid commit ref" }` with `errorType: "invalid_ref"`.

`source` that is not `worktree`, `head`, or a full object name stays HTTP 400 `{ error: "Invalid file source" }`.

CAP-6 remains HTTP 200 with the existing empty envelopes.

Missing run remains HTTP 404 `{ error: "Workflow run not found" }`.

Post-gate git failures remain opaque HTTP 500 `Could not read git changes` / `Could not read git diff` / `Could not read git file`.

Commit listing argv when the commit has a first parent is exactly:

```ts
[
  '-C',
  workingPath,
  '--literal-pathspecs',
  '--no-optional-locks',
  'diff-tree',
  '-r',
  '--name-status',
  '-z',
  '-M',
  '-C',
  parentOid,
  commitOid,
]
```

Commit listing argv when the commit is a root is exactly:

```ts
[
  '-C',
  workingPath,
  '--literal-pathspecs',
  '--no-optional-locks',
  'diff-tree',
  '--root',
  '-r',
  '--name-status',
  '-z',
  '-M',
  '-C',
  commitOid,
]
```

Commit `M` diff argv when the commit has a first parent is exactly:

```ts
[
  '--no-optional-locks',
  '--literal-pathspecs',
  'diff-tree',
  '-p',
  '--no-color',
  '--no-ext-diff',
  '--no-textconv',
  '--text',
  `-U${String(VIEWER_DIFF_CONTEXT_LINES)}`,
  parentOid,
  commitOid,
  '--',
  path,
]
```

Commit `M` diff argv for a root commit uses the same array except it inserts `'--root'` immediately after `'diff-tree'` and omits `parentOid`.

Those commit diff streams use `acceptExitCodes: [0]`.

Now `fileDiff` keeps today's `git diff HEAD -- path` with `acceptExitCodes: [0, 1]`.

Web `GitFileSource` becomes `'worktree' | 'head' | string` where the string must match `FULL_GIT_OBJECT_ID_RE` before fetch.

Web viewer scope:

```ts
type ViewerScope =
  | { kind: 'now' }
  | { kind: 'commit'; oid: string; parentOid: string | null };
```

## Required Implementation Order

Execute Tasks 1 through 8 in numeric order.
Do not parallelize Tasks 1 through 4 because HTTP and generated types depend on the git helpers.
Do not start Task 6 before Task 5 is green.
Do not start Task 7 before Task 6 is green.
Update sprint status only after every Task 8 gate passes.

## Open Questions

### OQ-1 — Where the commit file list renders

The UX spines lock inline expand beneath the commit row, with Changes pinned and no Back control.
**Provisional default:** accordion expand/collapse in History; at most one commit expanded; Changes always shows Now files.

### OQ-2 — Merge parent

Story 2.2 says `parent → commit` and does not name octopus parents.
**Provisional default:** first parent only, matching `git show`.

### OQ-3 — Empty commit copy

Sources distinguish region empties from CAP-6 and do not give commit-empty wording.
**Provisional default:** `No file changes` under the expanded row.

### OQ-4 — Nested list height

An expanded commit can contain many files inside a virtualized History list.
**Provisional default:** the inline `ChangedFilesList` uses `max-h-60 overflow-auto`, `idPrefix={`sc-commit-${oid}-file`}`, and `ariaLabel="Commit files"`.
The History virtualizer estimates expanded height as `COMMIT_ROW_HEIGHT + 36` while loading or empty, otherwise `COMMIT_ROW_HEIGHT + Math.min(fileCount, 8) * 28 + 8`, then calls `measure()` when files arrive.

### OQ-5 — Commit list URL

AD-3 seeds `/git/{changes,log,diff}` plus `/git/file/*`.
**Provisional default:** reuse `/git/changes?ref=FULL_OID` rather than adding a fourth JSON path.

These provisional defaults are implementation directives and do not require the implementer to pause.

---

### Task 1: Commit object-name parsing and commit `changedFiles`

**Files:**

- Create: `packages/git/src/git-oid.ts`
- Create: `packages/git/src/git-oid.test.ts`
- Modify: `packages/git/src/changed-files.ts`
- Modify: `packages/git/src/changed-files.test.ts`
- Modify: `packages/git/src/index.ts`

**Interfaces:**

- Consumes: `execFileAsync`, `RepoPath`, `WorktreePath`, `PorcelainEntry`, `projectChangedFiles`
- Produces: `parseGitObjectId`, `resolveCommitParents`, `GitCommitRefError`, `parseNameStatusZ`, `changedFiles(path, { commit })`

- [ ] **Step 1: Write the failing object-id and name-status tests**

Create `packages/git/src/git-oid.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';

import { execFileAsync } from './exec';
import { GitCommitRefError, parseGitObjectId, resolveCommitParents } from './git-oid';
import { toWorktreePath } from './types';

describe('parseGitObjectId', () => {
  test('accepts full SHA-1 and SHA-256 object names', () => {
    const sha1 = 'a'.repeat(40);
    const sha256 = 'b'.repeat(64);
    expect(parseGitObjectId(sha1)).toBe(sha1);
    expect(parseGitObjectId(sha256)).toBe(sha256);
  });

  test('rejects empty, short, uppercase, live, HEAD, and peel syntax', () => {
    for (const value of ['', 'abc', 'A'.repeat(40), 'live', 'HEAD', 'origin/dev', `${'a'.repeat(40)}:path`]) {
      expect(() => parseGitObjectId(value)).toThrow(GitCommitRefError);
    }
  });
});

describe('resolveCommitParents', () => {
  let root = '';
  let repoPath = '';

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'archon-git-oid-'));
    repoPath = join(root, 'repo');
    await mkdir(repoPath);
    await execFileAsync('git', ['init', '-b', 'main', repoPath]);
    await execFileAsync('git', ['-C', repoPath, 'config', 'user.email', 'dev@example.com']);
    await execFileAsync('git', ['-C', repoPath, 'config', 'user.name', 'Dev']);
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  test('returns no parents for a root and the first parent for a merge', async () => {
    await execFileAsync('git', ['-C', repoPath, 'commit', '--allow-empty', '-m', 'base']);
    const base = (await execFileAsync('git', ['-C', repoPath, 'rev-parse', 'HEAD'])).stdout.trim();
    await execFileAsync('git', ['-C', repoPath, 'checkout', '-b', 'feature']);
    await execFileAsync('git', ['-C', repoPath, 'commit', '--allow-empty', '-m', 'feature']);
    const feature = (await execFileAsync('git', ['-C', repoPath, 'rev-parse', 'HEAD'])).stdout.trim();
    await execFileAsync('git', ['-C', repoPath, 'checkout', 'main']);
    await execFileAsync('git', ['-C', repoPath, 'commit', '--allow-empty', '-m', 'mainline']);
    await execFileAsync('git', ['-C', repoPath, 'merge', '--no-ff', 'feature', '-m', 'merge']);
    const merge = (await execFileAsync('git', ['-C', repoPath, 'rev-parse', 'HEAD'])).stdout.trim();

    expect(await resolveCommitParents(toWorktreePath(repoPath), base)).toEqual([]);
    const mergeParents = await resolveCommitParents(toWorktreePath(repoPath), merge);
    expect(mergeParents[0]?.length).toBe(base.length);
    expect(mergeParents).toHaveLength(2);
    expect(mergeParents[1]).toBe(feature);
  });

  test('rejects an unreachable full object name', async () => {
    await expect(
      resolveCommitParents(toWorktreePath(repoPath), 'a'.repeat(40))
    ).rejects.toBeInstanceOf(GitCommitRefError);
  });
});
```

In `packages/git/src/changed-files.test.ts`, add `parseNameStatusZ` to the existing named import from `./changed-files`.
Then add this describe next to the porcelain parser tests, keeping the existing Now tests:

```ts
describe('parseNameStatusZ and commit changedFiles', () => {
  test('maps ordinary, added, deleted, and type-change letters', () => {
    const stdout = ['M', 'src/a.ts', 'A', 'new.ts', 'D', 'gone.ts', 'T', 'file.bin'].join('\0') + '\0';
    expect(projectChangedFiles(parseNameStatusZ(stdout))).toEqual([
      { path: 'file.bin', status: 'M' },
      { path: 'gone.ts', status: 'D' },
      { path: 'new.ts', status: 'A' },
      { path: 'src/a.ts', status: 'M' },
    ]);
  });

  test('projects rename as old D plus new A and copy as new A', () => {
    const stdout = 'R100\0old-name.ts\0new-name.ts\0C100\0source.ts\0copy.ts\0';
    expect(projectChangedFiles(parseNameStatusZ(stdout))).toEqual([
      { path: 'copy.ts', status: 'A' },
      { path: 'new-name.ts', status: 'A' },
      { path: 'old-name.ts', status: 'D' },
    ]);
  });

  test('preserves spaces and newlines because records are NUL-delimited', () => {
    const stdout = 'A\0path with space.ts\0A\0line\nbreak.ts\0';
    expect(projectChangedFiles(parseNameStatusZ(stdout))).toEqual([
      { path: 'line\nbreak.ts', status: 'A' },
      { path: 'path with space.ts', status: 'A' },
    ]);
  });

  test('fails fast on malformed name-status records', () => {
    expect(() => parseNameStatusZ('M\0')).toThrow('Malformed git name-status output');
    expect(() => parseNameStatusZ('R100\0new.ts\0')).toThrow('Malformed git name-status output');
  });
});
```

Add this nested describe after the existing `changedFiles and isGitWorkTree` describe.
Do not write into that describe's shared `repoPath`.

```ts
describe('commit changedFiles', () => {
  let root = '';
  let repoPath = '';

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'archon-commit-changed-files-'));
    repoPath = join(root, 'repo');
    await mkdir(repoPath);
    await execFileAsync('git', ['init', '-b', 'main', repoPath]);
    await execFileAsync('git', ['-C', repoPath, 'config', 'user.email', 'dev@example.com']);
    await execFileAsync('git', ['-C', repoPath, 'config', 'user.name', 'Dev']);
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  test('lists a commit against its first parent including rename and special names', async () => {
    const workingPath = toWorktreePath(repoPath);
    await writeFile(join(repoPath, 'tracked.ts'), 'old\n');
    await writeFile(join(repoPath, '-dash.ts'), 'dash\n');
    await writeFile(join(repoPath, 'path with space.ts'), 'space\n');
    await execFileAsync('git', ['-C', repoPath, 'add', '-A']);
    await execFileAsync('git', ['-C', repoPath, 'commit', '-m', 'root']);
    const rootOid = (await execFileAsync('git', ['-C', repoPath, 'rev-parse', 'HEAD'])).stdout.trim();

    const rootFiles = await changedFiles(workingPath, { commit: rootOid });
    expect(rootFiles.files).toEqual(
      expect.arrayContaining([
        { path: '-dash.ts', status: 'A' },
        { path: 'path with space.ts', status: 'A' },
        { path: 'tracked.ts', status: 'A' },
      ])
    );
    expect(rootFiles.revision).toMatch(/^[a-f0-9]{64}$/);

    await writeFile(join(repoPath, 'tracked.ts'), 'changed\n');
    await writeFile(join(repoPath, 'added-in-commit.ts'), 'new\n');
    await execFileAsync('git', ['-C', repoPath, 'rm', '-f', '--', '-dash.ts']);
    await execFileAsync('git', ['-C', repoPath, 'mv', 'path with space.ts', 'renamed space.ts']);
    await execFileAsync('git', ['-C', repoPath, 'add', '-A']);
    await execFileAsync('git', ['-C', repoPath, 'commit', '-m', 'delta']);
    const delta = (await execFileAsync('git', ['-C', repoPath, 'rev-parse', 'HEAD'])).stdout.trim();

    const files = await changedFiles(workingPath, { commit: delta });
    expect(files.files).toEqual(
      expect.arrayContaining([
        { path: 'tracked.ts', status: 'M' },
        { path: 'added-in-commit.ts', status: 'A' },
        { path: '-dash.ts', status: 'D' },
        { path: 'path with space.ts', status: 'D' },
        { path: 'renamed space.ts', status: 'A' },
      ])
    );

    const now = await changedFiles(workingPath);
    expect(now.files.some(file => file.path === 'added-in-commit.ts')).toBe(false);

    await expect(changedFiles(workingPath, { commit: 'HEAD' })).rejects.toMatchObject({
      name: 'GitCommitRefError',
    });
    await expect(changedFiles(workingPath, { commit: delta.slice(0, 7) })).rejects.toMatchObject({
      name: 'GitCommitRefError',
    });
  });

  test('lists a merge against the first parent only', async () => {
    const workingPath = toWorktreePath(repoPath);
    await writeFile(join(repoPath, 'base.ts'), 'base\n');
    await execFileAsync('git', ['-C', repoPath, 'add', 'base.ts']);
    await execFileAsync('git', ['-C', repoPath, 'commit', '-m', 'base']);
    await execFileAsync('git', ['-C', repoPath, 'checkout', '-b', 'feature']);
    await writeFile(join(repoPath, 'feature.ts'), 'feature\n');
    await execFileAsync('git', ['-C', repoPath, 'add', 'feature.ts']);
    await execFileAsync('git', ['-C', repoPath, 'commit', '-m', 'feature']);
    await execFileAsync('git', ['-C', repoPath, 'checkout', 'main']);
    await writeFile(join(repoPath, 'mainline.ts'), 'main\n');
    await execFileAsync('git', ['-C', repoPath, 'add', 'mainline.ts']);
    await execFileAsync('git', ['-C', repoPath, 'commit', '-m', 'mainline']);
    await execFileAsync('git', ['-C', repoPath, 'merge', '--no-ff', 'feature', '-m', 'merge']);
    const merge = (await execFileAsync('git', ['-C', repoPath, 'rev-parse', 'HEAD'])).stdout.trim();

    const files = await changedFiles(workingPath, { commit: merge });
    expect(files.files).toEqual([{ path: 'feature.ts', status: 'A' }]);
  });
});
```

- [ ] **Step 2: Verify RED**

Run:

```bash
( cd packages/git && bun test src/git-oid.test.ts src/changed-files.test.ts )
```

Expected: FAIL because `git-oid.ts` and `parseNameStatusZ` do not exist.

- [ ] **Step 3: Implement the minimal git-oid and commit listing path**

Create `packages/git/src/git-oid.ts`:

```ts
import { execFileAsync } from './exec';
import type { RepoPath, WorktreePath } from './types';

export const FULL_GIT_OBJECT_ID_RE = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/;

export class GitCommitRefError extends Error {
  readonly code = 'invalid_ref' as const;

  constructor() {
    super('Invalid git commit ref');
    this.name = 'GitCommitRefError';
  }
}

export function parseGitObjectId(raw: string): string {
  if (!FULL_GIT_OBJECT_ID_RE.test(raw)) throw new GitCommitRefError();
  return raw;
}

export async function resolveCommitParents(
  workingPath: RepoPath | WorktreePath,
  oid: string
): Promise<string[]> {
  const parsed = parseGitObjectId(oid);
  let stdout = '';
  try {
    const result = await execFileAsync('git', [
      '-C',
      workingPath,
      'rev-list',
      '--parents',
      '-n',
      '1',
      parsed,
    ]);
    stdout = result.stdout.trim();
  } catch {
    throw new GitCommitRefError();
  }
  const parts = stdout.split(' ').filter(Boolean);
  if (parts[0] !== parsed) throw new GitCommitRefError();
  const parents = parts.slice(1);
  if (parents.some(parent => !FULL_GIT_OBJECT_ID_RE.test(parent) || parent.length !== parsed.length)) {
    throw new GitCommitRefError();
  }
  return parents;
}
```

Add `parseNameStatusZ` to `packages/git/src/changed-files.ts` and extend `changedFiles`.
Keep the current porcelain body as the no-`commit` branch.

```ts
import { parseGitObjectId, resolveCommitParents } from './git-oid';

export function parseNameStatusZ(stdout: string): PorcelainEntry[] {
  const records = stdout.split('\0');
  if (records.length > 0 && records[records.length - 1] === '') records.pop();
  const entries: PorcelainEntry[] = [];
  for (let index = 0; index < records.length; ) {
    const status = records[index] ?? '';
    if (status.length === 0) throw new Error('Malformed git name-status output');
    const code = status[0];
    if (code === 'R' || code === 'C') {
      const origPath = records[index + 1];
      const path = records[index + 2];
      if (!origPath || !path) throw new Error('Malformed git name-status output');
      entries.push({ xy: code, path, origPath });
      index += 3;
      continue;
    }
    const path = records[index + 1];
    if (!path) throw new Error('Malformed git name-status output');
    entries.push({ xy: code === 'U' ? 'UU' : code, path });
    index += 2;
  }
  return entries;
}

export interface ChangedFilesRequest {
  commit?: string;
}

export async function changedFiles(
  workingPath: RepoPath | WorktreePath,
  request?: ChangedFilesRequest
): Promise<ChangedFilesResult> {
  if (request?.commit !== undefined) {
    const commit = parseGitObjectId(request.commit);
    const parents = await resolveCommitParents(workingPath, commit);
    const args =
      parents[0] === undefined
        ? [
            '-C',
            workingPath,
            '--literal-pathspecs',
            '--no-optional-locks',
            'diff-tree',
            '--root',
            '-r',
            '--name-status',
            '-z',
            '-M',
            '-C',
            commit,
          ]
        : [
            '-C',
            workingPath,
            '--literal-pathspecs',
            '--no-optional-locks',
            'diff-tree',
            '-r',
            '--name-status',
            '-z',
            '-M',
            '-C',
            parents[0],
            commit,
          ];
    const status = await execFileAsync('git', args);
    return {
      files: projectChangedFiles(parseNameStatusZ(status.stdout)),
      revision: createHash('sha256').update(commit).update('\0').update(status.stdout).digest('hex'),
    };
  }

  // existing porcelain implementation unchanged below
}
```

Do not call `resolveCommitParents` in the Now branch.
Export `parseNameStatusZ` from `packages/git/src/index.ts` next to `parsePorcelainV1Z`.
Do not export git-oid symbols from the package root.

- [ ] **Step 4: Verify GREEN**

Run:

```bash
( cd packages/git && bun test src/git-oid.test.ts src/changed-files.test.ts )
```

Expected: PASS.

- [ ] **Step 5: Refactor if needed, then commit**

```bash
git add packages/git/src/git-oid.ts packages/git/src/git-oid.test.ts packages/git/src/changed-files.ts packages/git/src/changed-files.test.ts packages/git/src/index.ts
git commit -m "$(cat <<'EOF'
feat(git): list a commit's M/A/D files from diff-tree

EOF
)"
```

---

### Task 2: Commit-scoped `fileDiff`

**Files:**

- Modify: `packages/git/src/file-read.ts`
- Modify: `packages/git/src/file-read.test.ts`

**Interfaces:**

- Consumes: `parseGitFilePath`, `inspectTree`, `resolveCommitParents`, `parseGitObjectId`, `streamGitStdout`, `HunkPageAccumulator`, `VIEWER_DIFF_CONTEXT_LINES`
- Produces: `FileDiffRequest.commit?`, `FileDiffResult.scope: 'now' | 'commit'`, `FileDiffResult.ref: 'live' | fullOid`

- [ ] **Step 1: Write the failing commit diff tests**

Append a nested describe at the end of `packages/git/src/file-read.test.ts`.
Do not commit inside the existing `fileAt and fileDiff` beforeAll repo.

```ts
describe('commit fileDiff', () => {
  let root = '';
  let repoPath = '';

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'archon-commit-file-diff-'));
    repoPath = join(root, 'repo');
    await mkdir(repoPath);
    await exec.execFileAsync('git', ['init', '-b', 'main', repoPath]);
    await exec.execFileAsync('git', ['-C', repoPath, 'config', 'user.email', 'test@example.com']);
    await exec.execFileAsync('git', ['-C', repoPath, 'config', 'user.name', 'Test User']);
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  test('commit fileDiff compares first parent to the commit and never uses live or oid:path', async () => {
    const workingPath = toWorktreePath(repoPath);
    await writeFile(join(repoPath, 'tracked.ts'), 'before line\n');
    await exec.execFileAsync('git', ['-C', repoPath, 'add', 'tracked.ts']);
    await exec.execFileAsync('git', ['-C', repoPath, 'commit', '-m', 'parent']);
    const parent = (await exec.execFileAsync('git', ['-C', repoPath, 'rev-parse', 'HEAD'])).stdout.trim();
    await writeFile(join(repoPath, 'tracked.ts'), 'after line\n');
    await exec.execFileAsync('git', ['-C', repoPath, 'add', 'tracked.ts']);
    await exec.execFileAsync('git', ['-C', repoPath, 'commit', '-m', 'child']);
    const child = (await exec.execFileAsync('git', ['-C', repoPath, 'rev-parse', 'HEAD'])).stdout.trim();

    const result = await fileDiff(workingPath, 'tracked.ts', { commit: child });
    expect(result.scope).toBe('commit');
    expect(result.ref).toBe(child);
    expect(result.status).toBe('M');
    expect(result.fileFallback).toBe(false);
    expect(result.hunks.some(hunk => hunk.changes.some(change => change.content.includes('after line')))).toBe(
      true
    );

    const now = await fileDiff(workingPath, 'tracked.ts');
    expect(now.scope).toBe('now');
    expect(now.ref).toBe('live');

    const childProcess = await import('child_process');
    const spawnSpy = spyOn(childProcess, 'spawn');
    try {
      await fileDiff(workingPath, 'tracked.ts', { commit: child });
      const flat = spawnSpy.mock.calls.flatMap(call => (call[1] as string[] | undefined) ?? []);
      expect(flat.some(arg => arg.includes(':'))).toBe(false);
      expect(flat).toContain(parent);
      expect(flat).toContain(child);
      expect(flat).not.toContain('HEAD');
    } finally {
      spawnSpy.mockRestore();
    }

    await expect(fileDiff(workingPath, 'tracked.ts', { commit: 'HEAD' })).rejects.toMatchObject({
      name: 'GitCommitRefError',
    });
  });

  test('commit binary M returns fileFallback against the commit tree', async () => {
    const workingPath = toWorktreePath(repoPath);
    await writeFile(join(repoPath, 'blob.bin'), Buffer.from([0, 1, 2]));
    await exec.execFileAsync('git', ['-C', repoPath, 'add', 'blob.bin']);
    await exec.execFileAsync('git', ['-C', repoPath, 'commit', '-m', 'binary parent']);
    await writeFile(join(repoPath, 'blob.bin'), Buffer.from([0, 9, 9]));
    await exec.execFileAsync('git', ['-C', repoPath, 'add', 'blob.bin']);
    await exec.execFileAsync('git', ['-C', repoPath, 'commit', '-m', 'binary child']);
    const child = (await exec.execFileAsync('git', ['-C', repoPath, 'rev-parse', 'HEAD'])).stdout.trim();
    const result = await fileDiff(workingPath, 'blob.bin', { commit: child });
    expect(result).toMatchObject({
      status: 'M',
      scope: 'commit',
      ref: child,
      hunks: [],
      binary: true,
      fileFallback: true,
    });
  });
});
```

- [ ] **Step 2: Verify RED**

Run:

```bash
( cd packages/git && bun test src/file-read.test.ts )
```

Expected: FAIL because `FileDiffRequest` has no `commit` field or because commit diffs still return `scope: "now"`.

- [ ] **Step 3: Implement commit `fileDiff`**

In `packages/git/src/file-read.ts`, change the types:

```ts
import { parseGitObjectId, resolveCommitParents } from './git-oid';

export interface FileDiffRequest {
  cursor?: string;
  signal?: AbortSignal;
  commit?: string;
}

export interface FileDiffResult {
  path: string;
  status: 'M';
  scope: 'now' | 'commit';
  ref: 'live' | string;
  hunks: DiffHunk[];
  cursor: string;
  truncated: boolean;
  binary: boolean;
  fileFallback: boolean;
}
```

Replace `rawFallbackResult` with a scope-aware helper:

```ts
function rawFallbackResult(
  path: string,
  binary: boolean,
  scope: FileDiffResult['scope'],
  ref: FileDiffResult['ref']
): FileDiffResult {
  return {
    path,
    status: 'M',
    scope,
    ref,
    hunks: [],
    cursor: '',
    truncated: false,
    binary,
    fileFallback: true,
  };
}
```

Update the Now `fileDiff` success and fallback returns to keep `scope: 'now'` and `ref: 'live'`.
When `request?.commit` is set, do not inspect the worktree.

Commit branch shape:

```ts
if (request?.commit !== undefined) {
  const commit = parseGitObjectId(request.commit);
  const parents = await resolveCommitParents(workingPath, commit);
  const after = await inspectTree(workingPath, path, commit);
  const afterClass = await classifyInspected(after, signal);
  let before: InspectedFile | undefined;
  if (parents[0] !== undefined) {
    try {
      before = await inspectTree(workingPath, path, parents[0]);
    } catch (error) {
      if (!(error instanceof GitFileError && error.code === 'not_found')) throw error;
    }
  }
  const beforeClass = before === undefined ? undefined : await classifyInspected(before, signal);
  if (needsRawFallback(afterClass) || (beforeClass !== undefined && needsRawFallback(beforeClass))) {
    return rawFallbackResult(path, afterClass.binary || (beforeClass?.binary ?? false), 'commit', commit);
  }
  const version = hashIdentity([after.contentHash, before?.contentHash ?? '']);
  const startIndex = decodeAxisCursor(request?.cursor, 'h', version);
  const pager = new HunkPageAccumulator(startIndex);
  const args =
    parents[0] === undefined
      ? [
          '--no-optional-locks',
          '--literal-pathspecs',
          'diff-tree',
          '--root',
          '-p',
          '--no-color',
          '--no-ext-diff',
          '--no-textconv',
          '--text',
          `-U${String(VIEWER_DIFF_CONTEXT_LINES)}`,
          commit,
          '--',
          path,
        ]
      : [
          '--no-optional-locks',
          '--literal-pathspecs',
          'diff-tree',
          '-p',
          '--no-color',
          '--no-ext-diff',
          '--no-textconv',
          '--text',
          `-U${String(VIEWER_DIFF_CONTEXT_LINES)}`,
          parents[0],
          commit,
          '--',
          path,
        ];
  const stream = streamGitStdout({ workingPath, args, signal, acceptExitCodes: [0] });
  // existing pager/readStreamChunks loop, then return scope:'commit', ref:commit
}
```

Map `GitCommitRefError` through unchanged.
Do not use `git diff HEAD` in the commit branch.
Do not use `HEAD:path`.
Do not change `inspectTree`; it already uses `ls-tree -z` then `cat-file blob`.

- [ ] **Step 4: Verify GREEN**

Run:

```bash
( cd packages/git && bun test src/file-read.test.ts src/changed-files.test.ts src/git-oid.test.ts )
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/git/src/file-read.ts packages/git/src/file-read.test.ts
git commit -m "$(cat <<'EOF'
feat(git): diff a commit against its first parent

EOF
)"
```

---

### Task 3: HTTP `ref` and commit file source

**Files:**

- Modify: `packages/server/src/routes/git/path-input.ts`
- Modify: `packages/server/src/routes/git/changes-route.ts`
- Modify: `packages/server/src/routes/git/changes-handler.ts`
- Modify: `packages/server/src/routes/git/diff-route.ts`
- Modify: `packages/server/src/routes/git/diff-handler.ts`
- Modify: `packages/server/src/routes/git/file-handler.ts`
- Modify: `packages/server/src/routes/api.git-changes.test.ts`

**Interfaces:**

- Consumes: `changedFiles`, `fileDiff`, `fileAt`, `loadRunCheckout`, `isValidGitFilePath`
- Produces: optional query `ref`, `source=FULL_OID` → `{ kind: 'tree', treeIsh: oid }`

- [ ] **Step 1: Write the failing HTTP tests**

In `packages/server/src/routes/api.git-changes.test.ts`, add these tests after the existing log tests.
Keep every existing Now/CAP-6/path test.

```ts
const COMMIT = '1'.repeat(40);

test('Now changes omit the second changedFiles argument', async () => {
  mockGetWorkflowRun.mockResolvedValue(runRow());
  const response = await makeApp().request('/api/workflows/runs/run-1/git/changes');
  expect(response.status).toBe(200);
  expect(mockChangedFiles.mock.calls[0]?.length).toBe(1);
});

test('commit changes pass the server-issued ref into changedFiles', async () => {
  mockGetWorkflowRun.mockResolvedValue(runRow());
  mockChangedFiles.mockResolvedValueOnce({
    files: [{ path: 'src/a.ts', status: 'M' }],
    revision: REVISION,
  });
  const response = await makeApp().request(`/api/workflows/runs/run-1/git/changes?ref=${COMMIT}`);
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({
    files: [{ path: 'src/a.ts', status: 'M' }],
    revision: REVISION,
  });
  expect(mockChangedFiles).toHaveBeenCalledWith(expect.any(String), { commit: COMMIT });
});

test('rejects a non-object-name changes ref before git', async () => {
  const response = await makeApp().request('/api/workflows/runs/run-1/git/changes?ref=HEAD');
  expect(response.status).toBe(400);
  expect(await response.json()).toEqual({ error: 'Invalid commit ref' });
  expect(mockChangedFiles).not.toHaveBeenCalled();
  expect(mockGetWorkflowRun).not.toHaveBeenCalled();
});

test('commit CAP-6 still short-circuits changes before git', async () => {
  mockGetWorkflowRun.mockResolvedValue({ ...runRow(), working_path: null });
  const response = await makeApp().request(`/api/workflows/runs/run-1/git/changes?ref=${COMMIT}`);
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({
    emptyReason: 'no_checkout',
    files: [],
    revision: '',
  });
  expect(mockChangedFiles).not.toHaveBeenCalled();
});

test('maps GitCommitRefError from changedFiles to Invalid commit ref', async () => {
  mockGetWorkflowRun.mockResolvedValue(runRow());
  mockChangedFiles.mockRejectedValueOnce(namedError('GitCommitRefError', 'invalid_ref'));
  const response = await makeApp().request(`/api/workflows/runs/run-1/git/changes?ref=${COMMIT}`);
  expect(response.status).toBe(400);
  expect(await response.json()).toEqual({ error: 'Invalid commit ref' });
  expect(JSON.stringify(mockLogger.info.mock.calls)).not.toContain(COMMIT);
  expect(JSON.stringify(mockLogger.error.mock.calls)).not.toContain(COMMIT);
});

test('commit diff passes commit into fileDiff and serializes scope commit', async () => {
  mockGetWorkflowRun.mockResolvedValue(runRow());
  mockFileDiff.mockResolvedValueOnce({
    path: 'src/a.ts',
    status: 'M',
    scope: 'commit',
    ref: COMMIT,
    hunks: [],
    cursor: '',
    truncated: false,
    binary: false,
    fileFallback: false,
  });
  const response = await makeApp().request(
    `/api/workflows/runs/run-1/git/diff?path=src%2Fa.ts&ref=${COMMIT}`
  );
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ scope: 'commit', ref: COMMIT, status: 'M' });
  expect(mockFileDiff).toHaveBeenCalledWith(expect.any(String), 'src/a.ts', {
    cursor: '',
    signal: expect.anything(),
    commit: COMMIT,
  });
});

test('Now diff omits commit from fileDiff', async () => {
  mockGetWorkflowRun.mockResolvedValue(runRow());
  await makeApp().request('/api/workflows/runs/run-1/git/diff?path=src%2Fa.ts');
  const request = mockFileDiff.mock.calls[0]?.[2] as { commit?: string } | undefined;
  expect(request?.commit).toBeUndefined();
});

test('maps GitCommitRefError from fileDiff to Invalid commit ref', async () => {
  mockGetWorkflowRun.mockResolvedValue(runRow());
  mockFileDiff.mockRejectedValueOnce(namedError('GitCommitRefError', 'invalid_ref'));
  const response = await makeApp().request(
    `/api/workflows/runs/run-1/git/diff?path=src%2Fa.ts&ref=${COMMIT}`
  );
  expect(response.status).toBe(400);
  expect(await response.json()).toEqual({ error: 'Invalid commit ref' });
});

test('maps source=full-oid to a tree fileAt read', async () => {
  mockGetWorkflowRun.mockResolvedValue(runRow());
  const response = await makeApp().request(
    `/api/workflows/runs/run-1/git/file/src%2Fa.ts?source=${COMMIT}`
  );
  expect(response.status).toBe(200);
  expect(mockFileAt).toHaveBeenCalledWith(
    expect.any(String),
    'src/a.ts',
    { kind: 'tree', treeIsh: COMMIT },
    expect.anything()
  );
});

test('still rejects source=HEAD as an invalid file source', async () => {
  const response = await makeApp().request('/api/workflows/runs/run-1/git/file/src%2Fa.ts?source=HEAD');
  expect(response.status).toBe(400);
  expect(await response.json()).toEqual({ error: 'Invalid file source' });
  expect(mockFileAt).not.toHaveBeenCalled();
});

test('maps GitFileError invalid_ref on a commit source to Invalid commit ref', async () => {
  mockGetWorkflowRun.mockResolvedValue(runRow());
  mockFileAt.mockRejectedValueOnce(namedError('GitFileError', 'invalid_ref'));
  const response = await makeApp().request(
    `/api/workflows/runs/run-1/git/file/src%2Fa.ts?source=${COMMIT}`
  );
  expect(response.status).toBe(400);
  expect(await response.json()).toEqual({ error: 'Invalid commit ref' });
});
```

- [ ] **Step 2: Verify RED**

Run:

```bash
( cd packages/server && bun test src/routes/api.git-changes.test.ts )
```

Expected: FAIL because `ref` is ignored and `source` still allows only `worktree|head`.

- [ ] **Step 3: Implement transport validation and handlers**

Add to `packages/server/src/routes/git/path-input.ts`:

```ts
export function isValidGitObjectId(raw: string): boolean {
  return /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(raw);
}
```

Update `changes-route.ts` request to:

```ts
request: {
  params: z.object({ runId: z.string().min(1) }),
  query: z.object({
    ref: z.string().optional(),
  }),
},
```

Add `400` with `errorSchema` and description `Invalid commit ref`.

Widen `handleGitChanges` to `apiError(c, status: 400 | 404 | 500, message: string)`.
Read `const ref = c.req.query('ref')`.
If `ref !== undefined && ref !== ''` and `!isValidGitObjectId(ref)`, log `git.changes_failed` with `errorType: "invalid_ref"` and return 400 `Invalid commit ref` before `loadRunCheckout`.
Treat empty `ref` the same as missing `ref`.
After a live gate, call Now as `changedFiles(toWorktreePath(gate.workingPath))` with one argument.
When `ref` is a valid object name, call `changedFiles(toWorktreePath(gate.workingPath), { commit: ref })`.
In the inner catch, if `error` has `name === 'GitCommitRefError'`, return 400 `Invalid commit ref` and do not log the ref.

Update `diff-route.ts` query to `{ path: z.string(), cursor: z.string().optional(), ref: z.string().optional() }` and summary to mention Now or commit hunks.
Add the same 400 invalid-ref path.

In `handleGitDiff`, after path validation, if `ref` is present, non-empty, and invalid, 400 `Invalid commit ref`.
Pass `commit: ref && ref !== '' ? ref : undefined` into `fileDiff`.
Classify `GitCommitRefError` and `GitFileError` `invalid_ref` as 400 `Invalid commit ref`.

In `handleGitFile`, replace the source check with:

```ts
const sourceQuery = c.req.query('source') ?? '';
let source: FileAtSource;
if (sourceQuery === 'worktree') {
  source = { kind: 'worktree' };
} else if (sourceQuery === 'head') {
  source = { kind: 'tree', treeIsh: 'HEAD' };
} else if (isValidGitObjectId(sourceQuery)) {
  source = { kind: 'tree', treeIsh: sourceQuery };
} else {
  getLog().info({ runId, errorType: 'invalid_source' }, 'git.file_failed');
  return apiError(c, 400, 'Invalid file source');
}
```

Classify `GitCommitRefError` / `GitFileError` `invalid_ref` as 400 `Invalid commit ref`.
Do not log `sourceQuery`.

- [ ] **Step 4: Verify GREEN**

Run:

```bash
( cd packages/server && bun test src/routes/api.git-changes.test.ts src/routes/git/checkout-gate.test.ts )
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/routes/git/path-input.ts packages/server/src/routes/git/changes-route.ts packages/server/src/routes/git/changes-handler.ts packages/server/src/routes/git/diff-route.ts packages/server/src/routes/git/diff-handler.ts packages/server/src/routes/git/file-handler.ts packages/server/src/routes/api.git-changes.test.ts
git commit -m "$(cat <<'EOF'
feat(server): accept commit refs on git changes, diff, and file

EOF
)"
```

---

### Task 4: Web git clients and generated types

**Files:**

- Modify: `packages/web/src/lib/api.generated.d.ts` via generate, never by hand
- Modify: `packages/web/src/lib/api.ts`
- Modify: `packages/web/src/lib/api.git-changes.test.ts`

**Interfaces:**

- Consumes: generated `GitChangesResponse` / `GitDiffResponse`
- Produces: `getWorkflowRunGitChanges(runId, { ref?, signal? })`, `getWorkflowRunGitDiff(runId, path, { ref?, cursor?, signal? })`, `GitFileSource = 'worktree' | 'head' | string`

- [ ] **Step 1: Write the failing client tests**

In `packages/web/src/lib/api.git-changes.test.ts`, add:

```ts
test('getWorkflowRunGitChanges encodes ref only when it is a full object name', async () => {
  fetchSpy = mockFetchSuccess();
  await getWorkflowRunGitChanges('run/one', { ref: '1'.repeat(40) });
  expect(fetchSpy).toHaveBeenCalledWith(
    '/api/workflows/runs/run%2Fone/git/changes?ref=' + '1'.repeat(40)
  );
});

test('getWorkflowRunGitChanges omits ref for Now', async () => {
  fetchSpy = mockFetchSuccess();
  await getWorkflowRunGitChanges('run/one');
  expect(fetchSpy).toHaveBeenCalledWith('/api/workflows/runs/run%2Fone/git/changes');
});

test('getWorkflowRunGitChanges rejects HEAD before fetch', async () => {
  fetchSpy = mockFetchSuccess();
  await expect(getWorkflowRunGitChanges('run/one', { ref: 'HEAD' })).rejects.toThrow('Invalid commit ref');
  expect(fetchSpy).not.toHaveBeenCalled();
});

test('getWorkflowRunGitDiff appends ref and opaque cursor', async () => {
  fetchSpy = mockFetchResponse(jsonResponse(READY_DIFF));
  await getWorkflowRunGitDiff('run/one', 'src/a.ts', {
    ref: '1'.repeat(40),
    cursor: 'opaque+token',
  });
  expect(String(fetchSpy.mock.calls[0]?.[0])).toBe(
    '/api/workflows/runs/run%2Fone/git/diff?path=src%2Fa.ts&ref=' +
      '1'.repeat(40) +
      '&cursor=opaque%2Btoken'
  );
});

test('gitFileUrl accepts a full object name as source', () => {
  expect(gitFileUrl('run-1', 'a.ts', '1'.repeat(40))).toContain('source=' + '1'.repeat(40));
  expect(gitFileUrl('run-1', 'a.ts', 'worktree')).toContain('source=worktree');
  expect(() => gitFileUrl('run-1', 'a.ts', 'HEAD')).toThrow('Invalid commit ref');
});
```

- [ ] **Step 2: Verify RED**

Run:

```bash
( cd packages/web && bun test src/lib/api.git-changes.test.ts )
```

Expected: FAIL because the clients do not send `ref`.

- [ ] **Step 3: Regenerate OpenAPI types**

`packages/web/package.json` `generate:types` is hardcoded to `http://localhost:3090/api/openapi.json`.
Start a server on 3090 after Task 3 is committed.

```bash
PORT=3090 bun run dev:server
```

Wait until `GET http://localhost:3090/api/health` succeeds.
If 3090 is already bound to this worktree's Task 3 server, reuse it.
If 3090 is bound to another checkout, do not kill by process name; bind this typegen server only after that other process is stopped by the operator of that checkout.

```bash
bun --filter @archon/web generate:types
```

Stop only the server process started for this task.
Do not hand-edit `packages/web/src/lib/api.generated.d.ts`.
Confirm `/api/workflows/runs/{runId}/git/changes` query includes `ref` and `/git/diff` query includes `ref`.

- [ ] **Step 4: Implement the clients**

In `packages/web/src/lib/api.ts`:

```ts
const FULL_GIT_OBJECT_ID_RE = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/;

export type GitFileSource = 'worktree' | 'head' | string;

function assertCommitRef(ref: string): string {
  if (!FULL_GIT_OBJECT_ID_RE.test(ref)) throw new Error('Invalid commit ref');
  return ref;
}

export async function getWorkflowRunGitChanges(
  runId: string,
  options?: { ref?: string; signal?: AbortSignal }
): Promise<GitChangesResponse> {
  const params = new URLSearchParams();
  if (options?.ref) params.set('ref', assertCommitRef(options.ref));
  const query = params.toString();
  return fetchJSON(
    `/api/workflows/runs/${encodeURIComponent(runId)}/git/changes${query ? `?${query}` : ''}`,
    options?.signal ? { signal: options.signal } : undefined
  );
}

export async function getWorkflowRunGitDiff(
  runId: string,
  path: string,
  options?: { cursor?: string; ref?: string; signal?: AbortSignal }
): Promise<GitDiffResponse> {
  const params = new URLSearchParams({ path });
  if (options?.ref) params.set('ref', assertCommitRef(options.ref));
  if (options?.cursor) params.set('cursor', options.cursor);
  return fetchJSON(
    '/api/workflows/runs/' + encodeURIComponent(runId) + '/git/diff?' + params.toString(),
    options?.signal ? { signal: options.signal } : undefined
  );
}
```

Keep `gitFileUrl` putting `source` into `URLSearchParams`.
If `source` is not `'worktree'` or `'head'`, call `assertCommitRef(source)` before building the URL.
Do not parse `cursor`.

- [ ] **Step 5: Verify GREEN and commit**

Run:

```bash
( cd packages/web && bun test src/lib/api.git-changes.test.ts )
```

Expected: PASS.

```bash
git add packages/web/src/lib/api.ts packages/web/src/lib/api.git-changes.test.ts packages/web/src/lib/api.generated.d.ts
git commit -m "$(cat <<'EOF'
feat(web): send commit refs on source-control git clients

EOF
)"
```

---

### Task 5: Inline commit file list in History

**Files:**

- Modify: `packages/web/src/components/workflows/source-control/commit-graph-row.tsx`
- Modify: `packages/web/src/components/workflows/source-control/commit-history-graph.tsx`
- Modify: `packages/web/src/components/workflows/source-control/commit-history-graph.test.tsx`
- Modify: `packages/web/src/components/workflows/source-control/source-control-panel.tsx`
- Modify: `packages/web/src/components/workflows/source-control/source-control-panel.test.tsx`

**Interfaces:**

- Consumes: `ChangedFilesList`, `GitChangedFile`, `GitLogCommit`, `COMMIT_ROW_HEIGHT`
- Produces: `expandedOid`, `commitFiles`, `commitFilesLoadState`, `onToggleCommit`, `onOpenCommitFile`

- [ ] **Step 1: Write the failing graph and panel tests**

In `commit-history-graph.test.tsx`, add:

```ts
test('renders expanded commit files inline with a distinct list prefix and no Back copy', () => {
  const html = renderToStaticMarkup(
    <CommitHistoryGraph
      commits={COMMITS}
      nowMs={NOW}
      expandedOid={D}
      commitFiles={[{ path: 'src/from-commit.ts', status: 'M' }]}
      commitFilesLoadState="idle"
      onToggleCommit={(): void => undefined}
    />
  );
  expect(html).toContain('aria-expanded="true"');
  expect(html).toContain('aria-label="Commit files"');
  expect(html).toContain('src/from-commit.ts');
  expect(html).toContain('sc-commit-' + D + '-file-0');
  expect(html).toContain('>M<');
  expect(html).not.toContain('Back');
});
```

The graph test does not assert Changes copy.
That assertion lives in the panel test.

```ts
test('keeps Changes pinned while History shows an expanded commit file list', () => {
  const html = renderPanel({
    snapshot: { files: [{ path: 'now.ts', status: 'A' }], revision: 'a'.repeat(64) },
    historySnapshot: {
      commits: [
        {
          oid: '1'.repeat(40),
          parents: [],
          authorName: 'Ada',
          authorDate: '2026-09-06T18:09:18Z',
          subject: 'work',
        },
      ],
      revision: 'a'.repeat(64),
      truncated: false,
    },
    expandedOid: '1'.repeat(40),
    commitFiles: [{ path: 'then.ts', status: 'M' }],
    commitFilesLoadState: 'idle',
    onToggleCommit: (): void => undefined,
  });
  expect(html).toContain('Changes');
  expect(html).toContain('now.ts');
  expect(html).toContain('then.ts');
  expect(html).toContain('History');
  expect(html).not.toContain('Back');
  expect(html).not.toContain('Stage');
});

test('shows No file changes for an expanded empty commit', () => {
  const html = renderPanel({
    snapshot: { files: [], revision: 'a'.repeat(64) },
    historySnapshot: {
      commits: [
        {
          oid: '1'.repeat(40),
          parents: [],
          authorName: 'Ada',
          authorDate: '2026-09-06T18:09:18Z',
          subject: 'empty',
        },
      ],
      revision: 'a'.repeat(64),
      truncated: false,
    },
    expandedOid: '1'.repeat(40),
    commitFiles: [],
    commitFilesLoadState: 'idle',
    onToggleCommit: (): void => undefined,
  });
  expect(html).toContain('No file changes');
  expect(html).toContain('No uncommitted changes');
});
```

- [ ] **Step 2: Verify RED**

Run:

```bash
NODE_ENV=development bun test packages/web/src/components/workflows/source-control/commit-history-graph.test.tsx packages/web/src/components/workflows/source-control/source-control-panel.test.tsx
```

Expected: FAIL because the new props do not exist.

- [ ] **Step 3: Implement inline expand chrome**

Extend `CommitGraphRowProps` with `expanded: boolean`.
Set `aria-expanded={props.expanded}` on the row button.
Keep the row as `role="option"`.
Do not put the file list inside the button.

Extend `CommitHistoryGraphProps`:

```ts
export interface CommitHistoryGraphProps {
  commits: readonly GitLogCommit[];
  nowMs?: number;
  idPrefix?: string;
  expandedOid?: string | null;
  commitFiles?: readonly GitChangedFile[];
  commitFilesLoadState?: 'idle' | 'loading' | 'error';
  selectedPath?: string | null;
  onToggleCommit?: (commit: GitLogCommit) => void;
  onOpenFile?: (file: GitChangedFile) => void;
}
```

Do not import `SourceControlLoadState` from `source-control-panel.tsx`.
Import `ChangedFilesList`.
Clicking a row or pressing Enter/Space on the History listbox calls `onToggleCommit` with the active commit and still does not call `onOpenFile`.
Arrow/Home/End still only move `activeIndex`.

Render the inline list as a sibling of `CommitGraphRow` only for the expanded index.
Give the nested list its own `activeIndex` state so keyboard inside `Commit files` works.

```tsx
{props.expandedOid === commit.oid ? (
  <div className="max-h-60 overflow-auto pl-2">
    {props.commitFilesLoadState === 'loading' ? (
      <p role="status" className="px-2 py-2 text-xs text-text-secondary">
        Loading files
      </p>
    ) : null}
    {props.commitFilesLoadState === 'error' ? (
      <p role="status" className="px-2 py-2 text-xs text-text-secondary">
        Could not refresh files.
      </p>
    ) : null}
    {props.commitFilesLoadState === 'idle' && (props.commitFiles?.length ?? 0) === 0 ? (
      <p role="status" className="px-2 py-2 text-xs text-text-secondary">
        No file changes
      </p>
    ) : null}
    {(props.commitFiles?.length ?? 0) > 0 ? (
      <ChangedFilesList
        files={props.commitFiles ?? []}
        activeIndex={commitFileActiveIndex}
        onActiveIndexChange={setCommitFileActiveIndex}
        selectedPath={props.selectedPath}
        onOpenFile={props.onOpenFile}
        ariaLabel="Commit files"
        idPrefix={`sc-commit-${commit.oid}-file`}
      />
    ) : null}
  </div>
) : null}
```

Update `estimateSize` as locked in OQ-4 and call `virtualizer.measure()` in an effect when `expandedOid` or `commitFiles` changes.

Pass the new props through `SourceControlPanel`.
Do not hide the Changes list when a commit is expanded.

- [ ] **Step 4: Verify GREEN**

Run the same component test command from Step 2.

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/components/workflows/source-control/commit-graph-row.tsx packages/web/src/components/workflows/source-control/commit-history-graph.tsx packages/web/src/components/workflows/source-control/commit-history-graph.test.tsx packages/web/src/components/workflows/source-control/source-control-panel.tsx packages/web/src/components/workflows/source-control/source-control-panel.test.tsx
git commit -m "$(cat <<'EOF'
feat(web): expand a commit's files inline on the history graph

EOF
)"
```

---

### Task 6: Load commit files into the shared viewer

**Files:**

- Modify: `packages/web/src/components/workflows/source-control/source-control-tab.tsx`
- Modify: `packages/web/src/component-integration/source-control-tab.test.tsx`

**Interfaces:**

- Consumes: `getWorkflowRunGitChanges`, `getWorkflowRunGitDiff`, `getWorkflowRunGitFile`, `FileViewer`
- Produces: `ViewerScope = { kind: 'now' } | { kind: 'commit'; oid: string; parentOid: string | null }`

- [ ] **Step 1: Write the failing mounted tests**

Update `mockGitRoutes` so `/git/changes?ref=` does not increment the Now changes counter:

```ts
onCommitChanges?: (
  ref: string,
  call: number,
  init?: RequestInit
) => GitChangesResponse | Response | Promise<GitChangesResponse | Response>;
```

Inside the fetch mock, if `url.includes('/git/changes')`, parse with `new URL(url, 'http://archon.local')`.
If `searchParams.get('ref')` is non-null, call `onCommitChanges`.
If `onCommitChanges` is missing, throw `Unexpected commit changes fetch: ${url}`.
Otherwise call `onChanges`.

Add this fixture next to `HISTORY_COMMIT`:

```ts
const CHILD_COMMIT: GitLogCommit = {
  oid: 'c'.repeat(40),
  parents: ['p'.repeat(40)],
  authorName: 'Ada',
  authorDate: '2026-09-06T18:09:18Z',
  subject: 'child subject',
};
```

Add these three tests inside `describe('SourceControlTab')`:

```ts
test('expanding a commit fetches that commit list and does not open the viewer', async () => {
  fetchSpy = mockGitRoutes({
    onChanges: () => ({ files: [{ path: 'now.ts', status: 'A' }], revision: REVISION_A }),
    onLog: () => ({ commits: [CHILD_COMMIT], revision: REVISION_A, truncated: false }),
    onCommitChanges: (ref) => {
      expect(ref).toBe(CHILD_COMMIT.oid);
      return { files: [{ path: 'then.ts', status: 'M' }], revision: REVISION_B };
    },
  });
  await renderTab('run/one');
  await waitFor(() => host.textContent?.includes(CHILD_COMMIT.subject) === true, 'commit row');
  const row = host.querySelector('#sc-history-commit-0');
  if (!(row instanceof HTMLElement)) throw new Error('missing commit row');
  await act(async () => {
    row.click();
  });
  await waitFor(() => host.textContent?.includes('then.ts') === true, 'commit files');
  expect(host.textContent).toContain('now.ts');
  expect(host.querySelector('[aria-label="Before"]')).toBeNull();
  expect(calledUrls(fetchSpy).some(url => url.includes('/git/diff'))).toBe(false);
  expect(calledUrls(fetchSpy).some(url => url.includes('/git/file/'))).toBe(false);
  expect(calledUrls(fetchSpy).some(url => url.includes('working_path'))).toBe(false);
});

test('opening a commit M file uses parent-to-commit diff in the same viewer', async () => {
  fetchSpy = mockGitRoutes({
    onChanges: () => ({ files: [{ path: 'now.ts', status: 'A' }], revision: REVISION_A }),
    onLog: () => ({ commits: [CHILD_COMMIT], revision: REVISION_A, truncated: false }),
    onCommitChanges: () => ({
      files: [{ path: 'then.ts', status: 'M' }],
      revision: REVISION_B,
    }),
    onDiff: (url) => {
      expect(url).toContain('ref=' + CHILD_COMMIT.oid);
      expect(url).toContain('path=then.ts');
      return jsonResponse({
        path: 'then.ts',
        status: 'M',
        scope: 'commit',
        ref: CHILD_COMMIT.oid,
        hunks: [
          {
            oldStart: 1,
            oldLines: 1,
            newStart: 1,
            newLines: 1,
            header: '@@ -1 +1 @@',
            changes: [
              { type: 'delete', content: 'before', oldLine: 1 },
              { type: 'insert', content: 'after', newLine: 1 },
            ],
          },
        ],
        cursor: '',
        truncated: false,
        binary: false,
        fileFallback: false,
      });
    },
  });
  await renderTab('run/one');
  await waitFor(() => host.textContent?.includes(CHILD_COMMIT.subject) === true, 'commit row');
  const row = host.querySelector('#sc-history-commit-0');
  if (!(row instanceof HTMLElement)) throw new Error('missing commit row');
  await act(async () => {
    row.click();
  });
  await waitFor(() => host.textContent?.includes('then.ts') === true, 'commit files');
  await clickOption('then.ts');
  await waitFor(() => host.querySelector('[aria-label="Before"]') !== null, 'commit diff');
  expect(host.querySelector('[aria-label="After"]')).not.toBeNull();
});

test('opening a commit A file reads the commit oid and a D file reads the parent oid', async () => {
  fetchSpy = mockGitRoutes({
    onChanges: () => ({ files: [], revision: REVISION_A }),
    onLog: () => ({ commits: [CHILD_COMMIT], revision: REVISION_A, truncated: false }),
    onCommitChanges: () => ({
      files: [
        { path: 'added.ts', status: 'A' },
        { path: 'gone.ts', status: 'D' },
      ],
      revision: REVISION_B,
    }),
    onFile: (url) => textFileResponse('body\n', HASH_A),
  });
  await renderTab('run/one');
  await waitFor(() => host.textContent?.includes(CHILD_COMMIT.subject) === true, 'commit row');
  await act(async () => {
    host.querySelector('#sc-history-commit-0')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
  await waitFor(() => host.textContent?.includes('added.ts') === true, 'commit files');
  await clickOption('added.ts');
  await waitFor(
    () =>
      calledUrls(fetchSpy).some(
        url => url.includes('/git/file/added.ts') && url.includes('source=' + CHILD_COMMIT.oid)
      ),
    'commit A source'
  );
  await clickOption('gone.ts');
  await waitFor(
    () =>
      calledUrls(fetchSpy).some(
        url => url.includes('/git/file/gone.ts') && url.includes('source=' + CHILD_COMMIT.parents[0])
      ),
    'commit D parent source'
  );
});
```

- [ ] **Step 2: Verify RED**

Run:

```bash
NODE_ENV=development bun test packages/web/src/component-integration/source-control-tab.test.tsx
```

Expected: FAIL because expanding a commit does not fetch `?ref=` and opening a commit file still hits Now `worktree` / `live`.

- [ ] **Step 3: Implement viewer scope in the tab**

Add:

```ts
type ViewerScope =
  | { kind: 'now' }
  | { kind: 'commit'; oid: string; parentOid: string | null };
```

Keep `selectedFile` plus `viewerScope: ViewerScope` defaulting to `{ kind: 'now' }`.
Keep a `viewerScopeRef` in sync with state for `onLoadMore`.

Replace `loadViewerFile` with a scope-aware helper:

```ts
async function loadViewerFile(
  runId: string,
  file: GitChangedFile,
  scope: ViewerScope,
  signal: AbortSignal
): Promise<LoadedViewerState> {
  if (file.status === 'M') {
    const response = await getWorkflowRunGitDiff(runId, file.path, {
      signal,
      ref: scope.kind === 'commit' ? scope.oid : undefined,
    });
    if ('emptyReason' in response) {
      return { kind: 'unavailable', file, emptyReason: response.emptyReason };
    }
    if (!response.fileFallback) {
      return {
        kind: 'diff',
        file,
        response,
        reloadFingerprint: diffReloadFingerprint(response),
      };
    }
    const source: GitFileSource = scope.kind === 'commit' ? scope.oid : 'worktree';
    const raw = await getWorkflowRunGitFile(runId, file.path, source, { signal });
    if (raw.kind === 'empty') {
      return { kind: 'unavailable', file, emptyReason: raw.emptyReason };
    }
    if (raw.kind === 'text') {
      return {
        kind: 'text',
        file,
        text: raw.text,
        contentHash: raw.contentHash,
        truncated: raw.truncated,
        cursor: raw.cursor,
      };
    }
    return fromRawFile(runId, file, source, raw);
  }
  const source: GitFileSource =
    scope.kind === 'commit'
      ? file.status === 'A'
        ? scope.oid
        : (scope.parentOid ?? '')
      : file.status === 'A'
        ? 'worktree'
        : 'head';
  if (source === '') {
    return { kind: 'error', file };
  }
  const response = await getWorkflowRunGitFile(runId, file.path, source, { signal });
  if (response.kind === 'empty') {
    return { kind: 'unavailable', file, emptyReason: response.emptyReason };
  }
  if (response.kind === 'text') {
    return {
      kind: 'text',
      file,
      text: response.text,
      contentHash: response.contentHash,
      truncated: response.truncated,
      cursor: response.cursor,
    };
  }
  return fromRawFile(runId, file, source, response);
}
```

`onOpenFile` from Changes sets `viewerScope` to `{ kind: 'now' }` then loads.
`onOpenCommitFile` sets `viewerScope` to `{ kind: 'commit', oid, parentOid: commit.parents[0] ?? null }` then loads.

Hold `expandedCommit: GitLogCommit | null` and `commitFiles` / `commitFilesLoadState` / `pendingCommitFiles`.
`onToggleCommit` collapses when the same oid is expanded; otherwise expands that oid, clears commit files, and fetches `getWorkflowRunGitChanges(runId, { ref: commit.oid, signal })`.
Do not call `loadViewerFile` from toggle.
If the fetch returns CAP-6, dispatch the existing snapshot empty path as today's CAP-6 handling does for Now/log.
If it returns files, store them in `commitFiles` state.
Do not write those files into the Now snapshot reducer.

`onLoadMore` must pass `ref` / commit source from `viewerScopeRef`.
For paging text, commit `A` uses `scope.oid` and commit `D` uses `scope.parentOid`.
For paging diffs, pass `{ cursor, ref: scope.kind === 'commit' ? scope.oid : undefined }`.

`onReload` continues to refetch Now changes and log, and if `expandedCommit` is set it also refetches that commit's files.
If the commit-file revision differs, keep displayed `commitFiles` and store the new list as `pendingCommitFiles`.
If `viewerScope.kind === 'commit'` and a file is open, call `loadViewerFile` with commit scope into `pendingViewer` instead of replacing `viewerState`.
If `viewerScope.kind === 'now'`, keep today's Now pending-viewer path.
Pending Now/log/commit-files still freeze the open viewer.
Accepting pending must not swap a Now file into a commit viewer or the reverse.
If the accepted log no longer contains `expandedCommit.oid`, collapse History files and return the viewer to idle only when the open file belonged to that missing commit.

Pass expand/file props into `SourceControlPanel`.
Changes `onOpenFile` stays the Now opener.
Selected path highlighting: Changes list uses `viewerScope.kind === 'now' ? selectedFile?.path : null`; commit list uses the inverse.

- [ ] **Step 4: Verify GREEN**

Run:

```bash
NODE_ENV=development bun test packages/web/src/component-integration/source-control-tab.test.tsx
```

Expected: the three new tests PASS and the existing Story 2.1 tests still PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/components/workflows/source-control/source-control-tab.tsx packages/web/src/component-integration/source-control-tab.test.tsx
git commit -m "$(cat <<'EOF'
feat(web): open commit files in the shared source-control viewer

EOF
)"
```

---

### Task 7: Mounted return-to-Now, freeze, and keyboard

**Files:**

- Modify: `packages/web/src/component-integration/source-control-tab.test.tsx`
- Modify: `packages/web/src/components/workflows/source-control/source-control-tab.tsx` only if a Task 7 assertion proves a missing freeze or return-to-Now path

**Interfaces:**

- Consumes: `mockGitRoutes`, `CHILD_COMMIT`, `FileViewer`
- Produces: coverage for return-to-Now, stale freeze, and Enter-expands-without-opening

- [ ] **Step 1: Write the failing remaining tests**

Add:

```ts
test('selecting a Changes file returns the viewer to now/live', async () => {
  fetchSpy = mockGitRoutes({
    onChanges: () => ({ files: [{ path: 'now.ts', status: 'A' }], revision: REVISION_A }),
    onLog: () => ({ commits: [CHILD_COMMIT], revision: REVISION_A, truncated: false }),
    onCommitChanges: () => ({
      files: [{ path: 'then.ts', status: 'M' }],
      revision: REVISION_B,
    }),
    onDiff: (url) => {
      if (!url.includes('ref=' + CHILD_COMMIT.oid)) {
        throw new Error(`Unexpected diff fetch: ${url}`);
      }
      return jsonResponse({
        path: 'then.ts',
        status: 'M',
        scope: 'commit',
        ref: CHILD_COMMIT.oid,
        hunks: [
          {
            oldStart: 1,
            oldLines: 1,
            newStart: 1,
            newLines: 1,
            header: '@@ -1 +1 @@',
            changes: [
              { type: 'delete', content: 'before', oldLine: 1 },
              { type: 'insert', content: 'after', newLine: 1 },
            ],
          },
        ],
        cursor: '',
        truncated: false,
        binary: false,
        fileFallback: false,
      });
    },
    onFile: (url) => {
      expect(url).toContain('source=worktree');
      expect(url).not.toContain('ref=');
      return textFileResponse('now-body\n', HASH_A);
    },
  });
  await renderTab('run/one');
  await waitFor(() => host.textContent?.includes(CHILD_COMMIT.subject) === true, 'commit row');
  await act(async () => {
    host.querySelector('#sc-history-commit-0')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
  await waitFor(() => host.textContent?.includes('then.ts') === true, 'commit files');
  await clickOption('then.ts');
  await waitFor(() => host.querySelector('[aria-label="Before"]') !== null, 'commit diff');
  await clickOption('now.ts');
  await waitFor(() => host.textContent?.includes('now-body') === true, 'now file');
  expect(host.querySelector('[aria-label="Before"]')).toBeNull();
  expect(host.textContent).not.toContain('Back');
  expect(
    calledUrls(fetchSpy).some(url => url.includes('/git/file/now.ts') && url.includes('source=worktree'))
  ).toBe(true);
});

test('Reload freezes an open commit diff until Changed on disk is accepted', async () => {
  let diffCall = 0;
  fetchSpy = mockGitRoutes({
    onChanges: call =>
      call === 1
        ? { files: [{ path: 'now.ts', status: 'A' }], revision: REVISION_A }
        : { files: [{ path: 'now.ts', status: 'A' }], revision: REVISION_B },
    onLog: call =>
      call === 1
        ? { commits: [CHILD_COMMIT], revision: REVISION_A, truncated: false }
        : {
            commits: [{ ...CHILD_COMMIT, subject: 'rewritten subject' }],
            revision: REVISION_B,
            truncated: false,
          },
    onCommitChanges: () => ({
      files: [{ path: 'then.ts', status: 'M' }],
      revision: REVISION_B,
    }),
    onDiff: () => {
      diffCall += 1;
      const after = diffCall === 1 ? 'frozen-after' : 'pending-after';
      return jsonResponse({
        path: 'then.ts',
        status: 'M',
        scope: 'commit',
        ref: CHILD_COMMIT.oid,
        hunks: [
          {
            oldStart: 1,
            oldLines: 1,
            newStart: 1,
            newLines: 1,
            header: '@@ -1 +1 @@',
            changes: [
              { type: 'delete', content: 'before', oldLine: 1 },
              { type: 'insert', content: after, newLine: 1 },
            ],
          },
        ],
        cursor: '',
        truncated: false,
        binary: false,
        fileFallback: false,
      });
    },
  });
  await renderTab('run/one');
  await waitFor(() => host.textContent?.includes(CHILD_COMMIT.subject) === true, 'commit row');
  await act(async () => {
    host.querySelector('#sc-history-commit-0')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
  await waitFor(() => host.textContent?.includes('then.ts') === true, 'commit files');
  await clickOption('then.ts');
  await waitFor(() => host.textContent?.includes('frozen-after') === true, 'open commit diff');
  await act(async () => {
    requireButton('Reload').click();
  });
  await waitFor(
    () => host.textContent?.includes('Changed on disk — Reload') === true,
    'stale banner'
  );
  expect(host.textContent).toContain('frozen-after');
  expect(host.textContent).not.toContain('pending-after');
  expect(host.textContent).toContain(CHILD_COMMIT.subject);
  expect(host.textContent).not.toContain('rewritten subject');
  await act(async () => {
    requireButton('Changed on disk — Reload').click();
  });
  await waitFor(() => host.textContent?.includes('rewritten subject') === true, 'accepted History');
  await waitFor(() => host.textContent?.includes('pending-after') === true, 'accepted commit diff');
});
```

Change the existing test `'operates History from the keyboard without opening a diff or file in Story 2.1'` as follows.
Keep ArrowDown moving `aria-activedescendant`.
After Enter, assert a `/git/changes?ref=` fetch for the second commit oid.
Keep asserting no `/git/diff` and no `/git/file/` until a commit file is opened.
Rename it to `'keyboard Enter expands files and still does not open a diff until a file is activated'`.

Keep the CAP-6 tests proving History is absent and no commit fetch occurs.

- [ ] **Step 2: Verify RED**

Run:

```bash
NODE_ENV=development bun test packages/web/src/component-integration/source-control-tab.test.tsx
```

Expected: FAIL on return-to-Now and/or freeze if Task 6 did not yet wire those paths; the renamed keyboard test should already fetch `?ref=` from Task 6.

- [ ] **Step 3: Make the remaining tests pass with the smallest tab changes**

Do not weaken assertions.
Do not allow `working_path` in any called URL.
If return-to-Now fails, set `viewerScope` to `{ kind: 'now' }` in the Changes `onOpenFile` path before `loadViewerFile`.
If freeze fails, keep `viewerState` on Reload when `viewerScope.kind === 'commit'` and only apply `pendingViewer` in `onAcceptPending`.

- [ ] **Step 4: Verify GREEN**

Run the same mounted test command.

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/component-integration/source-control-tab.test.tsx packages/web/src/components/workflows/source-control/source-control-tab.tsx
git commit -m "$(cat <<'EOF'
test(web): cover commit-scope source-control viewer behavior

EOF
)"
```

---

### Task 8: Acceptance gates and sprint status

**Files:**

- Modify: `_bmad-output/implementation-artifacts/archon-source-control/sprint-status.yaml`

- [ ] **Step 1: Run focused packages**

```bash
( cd packages/git && bun test src/git-oid.test.ts src/changed-files.test.ts src/file-read.test.ts )
( cd packages/server && bun test src/routes/api.git-changes.test.ts src/routes/git/checkout-gate.test.ts )
( cd packages/web && bun test src/lib/api.git-changes.test.ts )
NODE_ENV=development bun test packages/web/src/components/workflows/source-control/commit-history-graph.test.tsx packages/web/src/components/workflows/source-control/source-control-panel.test.tsx
NODE_ENV=development bun test packages/web/src/component-integration/source-control-tab.test.tsx
```

Expected: PASS.

- [ ] **Step 2: Run package test scripts**

```bash
( cd packages/git && bun run test )
( cd packages/server && bun run test )
( cd packages/web && bun run test )
```

Expected: all package scripts exit 0.
The server git tests and the mounted web test must appear as their own Bun invocations.

- [ ] **Step 3: Formatting and repository gate**

```bash
bun run format:check
git diff --check
bun run validate
```

Expected: all three exit 0.

- [ ] **Step 4: Confirm the acceptance matrix**

| Criterion | Proof |
| --- | --- |
| Select a commit → that commit's `M`/`A`/`D` with Now projections | git name-status tests plus mounted expand test |
| Same `FileViewer` / `ChangedFilesList` | tab wiring and distinct `idPrefix` tests |
| `M` is `parent → commit` | fileDiff argv test and mounted diff `scope: "commit"` |
| `A` raw from commit oid, `D` raw from first parent | mounted file URL test |
| Hunk JSON `scope: "commit"` and `ref` is the full oid, never `live` | HTTP and mounted tests |
| Client sends only `runId` plus server-issued path/oid | API client tests; no `working_path` |
| Return to Now restores live scope | mounted Changes click test |
| Reload / stale banner never mutate the open view | mounted freeze test |
| Inline expand, Changes pinned, no Back | panel tests |
| Expand does not open the viewer | mounted expand test |
| `changedFiles` / `fileDiff` / `fileAt` accept a commit ref | git tests |
| Blob reads stay `ls-tree -z` + `cat-file blob` | existing file-read argv test plus commit diff spawn test |
| CAP-6 HTTP 200 on commit-scoped routes | HTTP tests |
| JSON OpenAPI except raw file wildcard | route files |
| Keyboard: Enter expands, file open is a separate activation | mounted keyboard test |
| No write chrome | panel tests |
| Console untouched | scoped diff contains no `packages/web/src/experiments/console/` file |
| No new dependency | `bun.lock` / package manifests unmodified |
| No new package-root I/O export | `packages/git/src/index.ts` still exports `changedFiles` / `fileDiff` / `fileAt` / `log` only as I/O |

- [ ] **Step 5: Legacy-screen smoke check**

```bash
bun run dev
```

Open `/legacy/workflows/runs/:id` for an existing DAG run, select Source Control, click a History commit, confirm its files expand under the row while Changes stays, open an `M` file as a two-pane diff, open an `A` or `D` file as a single pane, click a Changes file and see Now content, and confirm Reload does not rewrite the open pane until `Changed on disk — Reload`.
Stop only the dev processes started for this check.
If no DAG run exists in the local database, record that the automated suites are the acceptance evidence; do not fabricate a run or broaden this story.

- [ ] **Step 6: Update sprint status only after Steps 1 through 5 pass**

In `_bmad-output/implementation-artifacts/archon-source-control/sprint-status.yaml`, change only:

```yaml
last_updated: 2026-09-07
```

and:

```yaml
  2-2-open-a-commits-files-in-the-same-viewer: done
  epic-2: done
```

Epic 2 has no Story 2.3 in this tracker, so set `epic-2: done` when 2.2 is done.

- [ ] **Step 7: Commit the tracker update**

```bash
git add _bmad-output/implementation-artifacts/archon-source-control/sprint-status.yaml
git commit -m "$(cat <<'EOF'
chore(sc): mark commit files in shared viewer story done

EOF
)"
```

## Out of Scope

- CAP-8 snapshot writing.
- Container overlay reads.
- Secret redaction.
- Hunk pagination behavior beyond reusing Story 1.3 cursors on commit diffs.
- A second History file-list widget that replaces Changes.
- `@xyflow/react` History renderer.
- Sequential non-DAG run tabs.
- Write / stage / commit chrome.
- Closing GitHub issue #79 outside the pull-request workflow.

## Pull Request Handoff

Before opening a pull request, rerun `bun run validate` and use `.github/pull_request_template.md`.
Keep Problem and outcome, Review guidance, Solution, and Validation.
Include focused RED/GREEN evidence, the full validation result, the manual smoke result or its explicit no-local-run limitation, and `Closes #79`.
Do not write `N/A` sections and do not close the issue outside the PR workflow.
