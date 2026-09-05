# See This Run's Uncommitted Files Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.
> Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a read-only Source Control tab on the legacy DAG run screen that lists this run's live uncommitted files as `M`/`A`/`D` from server-resolved git, including CAP-6 empty states, manual Reload, and a stale banner.

**Architecture:** `@archon/git` owns porcelain parsing and `git -C` reads via `execFileAsync`.
The server resolves `workflow_runs.working_path`, applies the AD-6 container gate, realpaths the checkout, and returns JSON.
`@archon/web` renders a Changes-only tab from generated OpenAPI types and never sends `working_path`.

**Tech Stack:** Bun, TypeScript, `@archon/git` `execFileAsync`, Hono `registerOpenApiRoute`, Zod from `@hono/zod-openapi`, React 19, TanStack Query, Radix Tabs, `renderToStaticMarkup` tests.

**Spec:** `_bmad-output/planning-artifacts/epics-source-control/epics.md` Story 1.1.
Companions: `_bmad-output/specs/spec-archon-source-control/SPEC.md`, `_bmad-output/specs/spec-archon-source-control/brownfield.md`, `_bmad-output/planning-artifacts/architecture/architecture-Archon-source-control-2026-09-05/ARCHITECTURE-SPINE.md` AD-1, AD-2, AD-3, AD-6, AD-7, AD-9, and `_bmad-output/planning-artifacts/ux-designs/ux-Archon-2026-08-31/EXPERIENCE.md` Voice and Tone.

**Issue:** [#75](https://github.com/anhle128/Archon/issues/75) tracker key `1-1-see-this-runs-uncommitted-files`.

## Global Constraints

- Story 1.1 is list-only: no History region, no viewer, no `react-diff-view`, no 30/70 split, no empty 70% pane.
- Console is not a v1 surface; do not import `/console`.
- Client sends `runId` only; never `working_path` or an absolute path.
- Server reads existing `workflow_runs.working_path`; do not add a column; do not re-derive the checkout from isolation metadata.
- Git argv uses `execFileAsync` only; never `exec` or a shell string.
- JSON routes use `registerOpenApiRoute`; web types come from `packages/web/src/lib/api.generated.d.ts` only.
- Auth matches `/api/artifacts/:runId/*`: global `/api/*` gate only; no `requireWebUser`; no per-run owner ACL.
- CAP-6 is HTTP 200 with `{ emptyReason: "container" | "no_checkout" }` and is never a 404.
- Missing `conversation.isolation_env_id` or a missing env row is not CAP-6; fall through to host dir+git.
- Container gate is `isolationEnvironments.getById(envId).provider === 'container'` and is status-agnostic.
- Live git is the source of truth; `workflow_events` must not author the list.
- Status set is exactly `M`/`A`/`D` with letter-carried badges.
- Projections: untracked → `A`; rename → `D` + `A`; copy → `A`; type-change / unmerged → `M`.
- No write / commit / stage / edit / discard chrome.
- No polling of git; run-detail's 3s status poll must not refetch git.
- Pino events use `domain.action_state`; never log paths, remotes, file contents, or secrets.
- Copy is terse and non-alarming; never invent "Error:", "unsupported", or "⚠️".
- Do not add tables, processes, env vars, or deployables.
- `mock.module()` merges; adding exports to `@archon/git` or calling `isolationEnvDb.getById` from `api.ts` requires updating every existing factory.
- Package tests stay isolated; add new server test files as separate `bun test` invocations.
- Each full Markdown sentence in this plan is already on its own physical line; keep that if you edit the plan.

## File Structure

- Create: `packages/git/src/changed-files.ts` — porcelain parse, status projection, `changedFiles`, `isGitWorkTree`.
- Create: `packages/git/src/git-path.ts` — lexical and realpath containment for relative git paths.
- Create: `packages/git/src/changed-files.test.ts` — parser, projection, `changedFiles`, special filenames.
- Create: `packages/git/src/git-path.test.ts` — NUL / absolute / encoded `..` / symlink-escape tests.
- Modify: `packages/git/src/index.ts` — export the new helpers and types.
- Create: `packages/server/src/routes/schemas/git.schemas.ts` — OpenAPI Zod for the changes route.
- Create: `packages/server/src/routes/git/checkout-gate.ts` — AD-6 gate used by this route and later git routes.
- Create: `packages/server/src/routes/git/checkout-gate.test.ts` — container / no_checkout / fall-through tests.
- Create: `packages/server/src/routes/git/changes-route.ts` — `createRoute` config.
- Create: `packages/server/src/routes/git/changes-handler.ts` — resolve, gate, serialize.
- Create: `packages/server/src/routes/api.git-changes.test.ts` — HTTP tests in their own Bun process.
- Modify: `packages/server/src/routes/api.ts` — register `GET /api/workflows/runs/{runId}/git/changes`.
- Modify: `packages/server/package.json` — append the two new `bun test` invocations.
- Modify: every existing `mock.module('@archon/git')` factory listed in Task 2.
- Modify: every server `mock.module('@archon/core/db/isolation-environments')` factory listed in Task 4.
- Modify: `packages/web/src/lib/api.generated.d.ts` — add path + schemas (or regenerate).
- Modify: `packages/web/src/lib/api.ts` — `getWorkflowRunGitChanges`.
- Create: `packages/web/src/components/workflows/source-control/changed-file-row.tsx`.
- Create: `packages/web/src/components/workflows/source-control/source-control-panel.tsx`.
- Create: `packages/web/src/components/workflows/source-control/dag-run-tabs.ts`.
- Create: `packages/web/src/components/workflows/source-control/source-control-panel.test.tsx`.
- Create: `packages/web/src/components/workflows/source-control/dag-run-tabs.test.ts`.
- Modify: `packages/web/src/components/workflows/WorkflowExecution.tsx` — fourth tab, fetch-on-click, no viewer column.
- Modify: `_bmad-output/implementation-artifacts/archon-source-control/sprint-status.yaml` — mark the story done after tests pass.

## Locked Wire Contract

```ts
type GitEmptyReason = 'container' | 'no_checkout';
type GitChangedFileStatus = 'M' | 'A' | 'D';

type GitChangedFile = {
  path: string;
  status: GitChangedFileStatus;
};

type GitChangesResponse = {
  emptyReason?: GitEmptyReason;
  files: GitChangedFile[];
  revision: string;
};
```

`path` is a git-relative path from porcelain.
It is the server-issued file ref for Story 1.2; the client must echo it later and must never invent an absolute path.
`revision` is a 64-character lowercase hex SHA-256 of `headSha + NUL + porcelainBytes`.
CAP-6 responses still return `files: []` and `revision: ""`.
Unknown query parameters including `working_path` are ignored.
A missing run is HTTP 404 `{ error: "Workflow run not found" }`.
A git failure after the checkout is proven readable is HTTP 500 `{ error: "Could not read git changes" }` with no path in the body.

## Open Questions

### OQ-1 — Divergence detection without polling

EXPERIENCE.md leaves the stale banner's no-poll detector unspecified.
**Provisional default:** the client freezes the first successful non-empty-reason snapshot.
Reload refetches.
If `revision` is unchanged, keep the list and do not show the banner.
If `revision` changed, show **Changed on disk — Reload** and keep the frozen list.
A second Reload while the banner is visible applies the pending snapshot and clears the banner.
Never rewrite the open list from a background timer.

### OQ-2 — Keyboard bindings

No source specifies keys.
**Provisional default:** the Changes list is a `role="listbox"` with focusable options.
ArrowUp / ArrowDown move the active option.
Home / End jump to first / last.
Enter and Space do nothing in Story 1.1 because there is no viewer.

### OQ-3 — Sequential non-DAG runs

The existing tab bar renders only when `isDag` is true.
**Provisional default:** add Source Control only to that DAG tab bar.
Do not invent a new tab bar for sequential runs.

### OQ-4 — `vm` and `remote` isolation providers

AD-6 names only `container`.
**Provisional default:** only `provider === 'container'` is CAP-6 `container`.
`worktree`, `vm`, `remote`, and unknown values fall through to host dir+git.

### OQ-5 — In-region git/API error copy

EXPERIENCE.md leaves client error copy open.
**Provisional default:** keep the previous list and show in-region text `Could not refresh changes.` plus Reload.
Do not use a modal, toast, "Error:", "unsupported", or "⚠️".

### OQ-6 — Generated OpenAPI types without a running server

`packages/web` `generate:types` needs `http://localhost:3090/api/openapi.json`.
**Provisional default:** after the route exists, prefer `bun --filter @archon/web generate:types` if the server is up.
If it is not, hand-edit `api.generated.d.ts` to the exact fragments in Task 5 so type-check passes.

---

### Task 1: Porcelain projection and path containment

**Files:**
- Create: `packages/git/src/changed-files.ts`
- Create: `packages/git/src/changed-files.test.ts`
- Create: `packages/git/src/git-path.ts`
- Create: `packages/git/src/git-path.test.ts`

**Interfaces:**
- Consumes: none.
- Produces: `parsePorcelainV1Z(stdout: string): PorcelainEntry[]`, `projectChangedFiles(entries: PorcelainEntry[]): ChangedFile[]`, `assertSafeGitRelPath(checkoutRealpath: string, relPath: string): string`, `assertContainedPath(checkoutRealpath: string, relPath: string, realpathFn?: (p: string) => Promise<string>): Promise<string>`, `GitPathEscapeError`.

- [ ] **Step 1: Write the failing tests**

Create `packages/git/src/changed-files.test.ts` with this content:

```ts
import { describe, expect, test } from 'bun:test';

import { parsePorcelainV1Z, projectChangedFiles } from './changed-files';

describe('parsePorcelainV1Z + projectChangedFiles', () => {
  test('maps modified, untracked, and deleted paths onto M/A/D', () => {
    const stdout = [' M src/a.ts', '?? new.ts', 'D  gone.ts'].join('\0') + '\0';
    expect(projectChangedFiles(parsePorcelainV1Z(stdout))).toEqual([
      { path: 'gone.ts', status: 'D' },
      { path: 'new.ts', status: 'A' },
      { path: 'src/a.ts', status: 'M' },
    ]);
  });

  test('projects a rename as D of the old path plus A of the new path', () => {
    const stdout = 'R  new-name.ts\0old-name.ts\0';
    expect(projectChangedFiles(parsePorcelainV1Z(stdout))).toEqual([
      { path: 'new-name.ts', status: 'A' },
      { path: 'old-name.ts', status: 'D' },
    ]);
  });

  test('projects a copy as A of the new path only', () => {
    const stdout = 'C  copy.ts\0source.ts\0';
    expect(projectChangedFiles(parsePorcelainV1Z(stdout))).toEqual([
      { path: 'copy.ts', status: 'A' },
    ]);
  });

  test('projects type-change and unmerged as M', () => {
    const stdout = ['T  file.bin', 'UU conflict.ts'].join('\0') + '\0';
    expect(projectChangedFiles(parsePorcelainV1Z(stdout))).toEqual([
      { path: 'conflict.ts', status: 'M' },
      { path: 'file.bin', status: 'M' },
    ]);
  });

  test('skips ignored entries and keeps colon, leading-dash, and glob names', () => {
    const stdout = ['!! skip.log', '?? :colon.ts', '?? -dash.ts', '?? foo*.ts'].join('\0') + '\0';
    expect(projectChangedFiles(parsePorcelainV1Z(stdout))).toEqual([
      { path: '-dash.ts', status: 'A' },
      { path: ':colon.ts', status: 'A' },
      { path: 'foo*.ts', status: 'A' },
    ]);
  });
});
```

Create `packages/git/src/git-path.test.ts` with this content:

```ts
import { afterEach, describe, expect, test } from 'bun:test';
import { mkdir, rm, symlink, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';

import { assertContainedPath, assertSafeGitRelPath, GitPathEscapeError } from './git-path';

const root = join(tmpdir(), `git-path-${Date.now()}`);

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('assertSafeGitRelPath', () => {
  test('rejects NUL, absolute, and encoded .. segments', () => {
    expect(() => assertSafeGitRelPath('/checkout', 'a\0b')).toThrow(GitPathEscapeError);
    expect(() => assertSafeGitRelPath('/checkout', '/etc/passwd')).toThrow(GitPathEscapeError);
    expect(() => assertSafeGitRelPath('/checkout', '..%2f..%2fetc%2fpasswd')).toThrow(
      GitPathEscapeError
    );
    expect(() => assertSafeGitRelPath('/checkout', '%2e%2e/secret')).toThrow(GitPathEscapeError);
  });

  test('accepts colon, leading-dash, and glob filenames', () => {
    expect(assertSafeGitRelPath('/checkout', ':colon.ts')).toBe(':colon.ts');
    expect(assertSafeGitRelPath('/checkout', '-dash.ts')).toBe('-dash.ts');
    expect(assertSafeGitRelPath('/checkout', 'foo*.ts')).toBe('foo*.ts');
  });
});

describe('assertContainedPath', () => {
  test('refuses a symlink that realpaths outside the checkout', async () => {
    const checkout = join(root, 'co');
    await mkdir(checkout, { recursive: true });
    const outside = join(root, 'outside.txt');
    await writeFile(outside, 'secret\n');
    await symlink(outside, join(checkout, 'link.txt'));
    await expect(assertContainedPath(checkout, 'link.txt')).rejects.toBeInstanceOf(
      GitPathEscapeError
    );
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test packages/git/src/changed-files.test.ts packages/git/src/git-path.test.ts`

Expected: FAIL with module-not-found for `./changed-files` and `./git-path`.

- [ ] **Step 3: Write minimal implementation**

Create `packages/git/src/git-path.ts` with this content:

```ts
import { realpath as fsRealpath } from 'fs/promises';
import { isAbsolute, posix, resolve as pathResolve, sep } from 'path';

export class GitPathEscapeError extends Error {
  readonly code = 'path_escape';
  constructor() {
    super('Path is outside the checkout');
    this.name = 'GitPathEscapeError';
  }
}

function containedRoot(checkoutRealpath: string): string {
  return checkoutRealpath.endsWith(sep) ? checkoutRealpath : `${checkoutRealpath}${sep}`;
}

export function assertSafeGitRelPath(checkoutRealpath: string, relPath: string): string {
  if (relPath.includes('\0')) throw new GitPathEscapeError();
  let decoded = relPath;
  try {
    decoded = decodeURIComponent(relPath);
  } catch {
    decoded = relPath;
  }
  if (decoded.includes('\0')) throw new GitPathEscapeError();
  const unified = decoded.replace(/\\/g, '/');
  if (isAbsolute(decoded) || unified.startsWith('/') || /^[A-Za-z]:[\\/]/.test(decoded)) {
    throw new GitPathEscapeError();
  }
  const normalized = posix.normalize(unified);
  const segments = normalized.split('/').filter(segment => segment.length > 0);
  if (segments.some(segment => segment === '..')) throw new GitPathEscapeError();
  const joined = pathResolve(checkoutRealpath, ...segments);
  const root = containedRoot(checkoutRealpath);
  if (joined !== checkoutRealpath && !joined.startsWith(root)) throw new GitPathEscapeError();
  return segments.join('/');
}

export async function assertContainedPath(
  checkoutRealpath: string,
  relPath: string,
  realpathFn: (p: string) => Promise<string> = fsRealpath
): Promise<string> {
  const rel = assertSafeGitRelPath(checkoutRealpath, relPath);
  const candidate = pathResolve(checkoutRealpath, rel);
  const root = containedRoot(checkoutRealpath);
  let resolved: string;
  try {
    resolved = await realpathFn(candidate);
  } catch {
    if (candidate !== checkoutRealpath && !candidate.startsWith(root)) {
      throw new GitPathEscapeError();
    }
    return rel;
  }
  if (resolved !== checkoutRealpath && !resolved.startsWith(root)) {
    throw new GitPathEscapeError();
  }
  return rel;
}
```

Create `packages/git/src/changed-files.ts` with this content:

```ts
export type ChangedFileStatus = 'M' | 'A' | 'D';

export interface ChangedFile {
  path: string;
  status: ChangedFileStatus;
}

export interface PorcelainEntry {
  xy: string;
  path: string;
  origPath?: string;
}

function isRenameOrCopy(xy: string): boolean {
  return xy.includes('R') || xy.includes('C');
}

export function parsePorcelainV1Z(stdout: string): PorcelainEntry[] {
  const parts = stdout.split('\0');
  const entries: PorcelainEntry[] = [];
  let i = 0;
  while (i < parts.length) {
    const rec = parts[i];
    if (!rec) {
      i += 1;
      continue;
    }
    const xy = rec.slice(0, 2);
    const path = rec.slice(3);
    if (!path) {
      i += 1;
      continue;
    }
    if (isRenameOrCopy(xy)) {
      const origPath = parts[i + 1] ?? '';
      entries.push({ xy, path, origPath });
      i += 2;
      continue;
    }
    entries.push({ xy, path });
    i += 1;
  }
  return entries;
}

function projectXy(xy: string): ChangedFileStatus {
  if (xy.includes('U') || xy.includes('T')) return 'M';
  if (xy === '??' || xy.includes('A')) return 'A';
  if (xy.includes('D')) return 'D';
  return 'M';
}

export function projectChangedFiles(entries: readonly PorcelainEntry[]): ChangedFile[] {
  const files: ChangedFile[] = [];
  for (const entry of entries) {
    if (entry.xy === '!!') continue;
    if (entry.xy.includes('R')) {
      if (entry.origPath) files.push({ path: entry.origPath, status: 'D' });
      files.push({ path: entry.path, status: 'A' });
      continue;
    }
    if (entry.xy.includes('C')) {
      files.push({ path: entry.path, status: 'A' });
      continue;
    }
    files.push({ path: entry.path, status: projectXy(entry.xy) });
  }
  return files.sort((a, b) => {
    if (a.path < b.path) return -1;
    if (a.path > b.path) return 1;
    return a.status.localeCompare(b.status);
  });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test packages/git/src/changed-files.test.ts packages/git/src/git-path.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/git/src/changed-files.ts packages/git/src/changed-files.test.ts packages/git/src/git-path.ts packages/git/src/git-path.test.ts
git commit -m "feat(git): parse porcelain status into M/A/D and refuse path escape"
```

---

### Task 2: `changedFiles` / `isGitWorkTree` and mock-factory stubs

**Files:**
- Modify: `packages/git/src/changed-files.ts`
- Modify: `packages/git/src/changed-files.test.ts`
- Modify: `packages/git/src/index.ts`
- Modify: every `mock.module('@archon/git')` factory listed in Step 3.

**Interfaces:**
- Consumes: `parsePorcelainV1Z`, `projectChangedFiles`, `execFileAsync`.
- Produces: `changedFiles(workingPath: RepoPath | WorktreePath): Promise<ChangedFilesResult>`, `isGitWorkTree(workingPath: RepoPath | WorktreePath): Promise<boolean>`, `ChangedFilesResult`.

- [ ] **Step 1: Write the failing tests**

Append this block to `packages/git/src/changed-files.test.ts`:

```ts
import { afterEach, beforeEach, mock, spyOn } from 'bun:test';
import { mkdir, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';

import { execFileAsync } from './exec';
import { changedFiles, isGitWorkTree } from './changed-files';
import { toWorktreePath } from './types';

describe('isGitWorkTree and changedFiles', () => {
  const testDir = join(tmpdir(), `changed-files-${Date.now()}`);

  beforeEach(async () => {
    await mkdir(testDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  async function initRepo(name: string): Promise<string> {
    const repoPath = join(testDir, name);
    await mkdir(repoPath, { recursive: true });
    const git = async (args: string[]): Promise<string> => {
      const result = await execFileAsync('git', args, { cwd: repoPath });
      return result.stdout.trim();
    };
    await git(['init']);
    await git(['config', 'core.autocrlf', 'false']);
    await git(['config', 'user.name', 'Archon Test']);
    await git(['config', 'user.email', 'archon-test@example.com']);
    await writeFile(join(repoPath, 'tracked.txt'), 'initial\n');
    await git(['add', 'tracked.txt']);
    await git(['commit', '-m', 'initial']);
    return repoPath;
  }

  test('isGitWorkTree is true for a repo and false for a plain directory', async () => {
    const repoPath = await initRepo('repo');
    const plain = join(testDir, 'plain');
    await mkdir(plain, { recursive: true });
    expect(await isGitWorkTree(toWorktreePath(repoPath))).toBe(true);
    expect(await isGitWorkTree(toWorktreePath(plain))).toBe(false);
  });

  test('changedFiles lists special filenames and returns a stable revision hex', async () => {
    const repoPath = await initRepo('special');
    await writeFile(join(repoPath, ':colon.ts'), 'x\n');
    await writeFile(join(repoPath, '-dash.ts'), 'x\n');
    await writeFile(join(repoPath, 'foo*.ts'), 'x\n');
    await writeFile(join(repoPath, 'tracked.txt'), 'dirty\n');
    const result = await changedFiles(toWorktreePath(repoPath));
    expect(result.files).toEqual([
      { path: '-dash.ts', status: 'A' },
      { path: ':colon.ts', status: 'A' },
      { path: 'foo*.ts', status: 'A' },
      { path: 'tracked.txt', status: 'M' },
    ]);
    expect(result.revision).toMatch(/^[a-f0-9]{64}$/);
  });

  test('changedFiles uses literal-pathspecs porcelain -z and does not log', async () => {
    const execSpy = spyOn(await import('./exec'), 'execFileAsync');
    execSpy.mockImplementation(async (cmd: string, args: string[]) => {
      if (args.includes('status')) return { stdout: '?? new.ts\0', stderr: '' };
      if (args.includes('rev-parse') && args.includes('HEAD')) {
        return { stdout: 'abc123\n', stderr: '' };
      }
      return { stdout: 'true\n', stderr: '' };
    });
    const result = await changedFiles(toWorktreePath('/workspace/repo'));
    expect(result.files).toEqual([{ path: 'new.ts', status: 'A' }]);
    const statusCall = execSpy.mock.calls.find(call => call[1]?.includes('status'));
    expect(statusCall?.[0]).toBe('git');
    expect(statusCall?.[1]).toEqual([
      '-C',
      '/workspace/repo',
      '--literal-pathspecs',
      'status',
      '--porcelain=v1',
      '-z',
      '--untracked-files=all',
    ]);
    execSpy.mockRestore();
  });
});
```

Fix the test file so all imports live at the top once; do not duplicate `bun:test` imports.
The `changedFiles` spy test must import `execFileAsync` from `./exec` and spy that same module binding, because `changed-files.ts` will call `execFileAsync` from `./exec`.

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/git/src/changed-files.test.ts`

Expected: FAIL with `changedFiles is not a function` or module export missing.

- [ ] **Step 3: Write minimal implementation**

Append to `packages/git/src/changed-files.ts`:

```ts
import { createHash } from 'crypto';
import { createLogger } from '@archon/paths';
import { execFileAsync } from './exec';
import type { RepoPath, WorktreePath } from './types';

export interface ChangedFilesResult {
  files: ChangedFile[];
  revision: string;
}

let cachedLog: ReturnType<typeof createLogger> | undefined;
function getLog(): ReturnType<typeof createLogger> {
  if (!cachedLog) cachedLog = createLogger('git');
  return cachedLog;
}

export async function isGitWorkTree(workingPath: RepoPath | WorktreePath): Promise<boolean> {
  try {
    const { stdout } = await execFileAsync('git', [
      '-C',
      workingPath,
      'rev-parse',
      '--is-inside-work-tree',
    ]);
    return stdout.trim() === 'true';
  } catch {
    return false;
  }
}

export async function changedFiles(
  workingPath: RepoPath | WorktreePath
): Promise<ChangedFilesResult> {
  try {
    const status = await execFileAsync('git', [
      '-C',
      workingPath,
      '--literal-pathspecs',
      'status',
      '--porcelain=v1',
      '-z',
      '--untracked-files=all',
    ]);
    let headSha = '';
    try {
      const head = await execFileAsync('git', ['-C', workingPath, 'rev-parse', 'HEAD']);
      headSha = head.stdout.trim();
    } catch {
      headSha = '';
    }
    const files = projectChangedFiles(parsePorcelainV1Z(status.stdout));
    const revision = createHash('sha256')
      .update(`${headSha}\0${status.stdout}`)
      .digest('hex');
    return { files, revision };
  } catch (err) {
    const error = err as Error;
    getLog().error(
      { errorType: error.constructor.name, error: error.message },
      'git.changed_files_failed'
    );
    throw error;
  }
}
```

Keep the `createLogger` import at the top of the file with the other imports.
Do not interpolate `workingPath` into the log object.

Modify `packages/git/src/index.ts` to add these exports next to the existing branch exports:

```ts
export {
  parsePorcelainV1Z,
  projectChangedFiles,
  changedFiles,
  isGitWorkTree,
} from './changed-files';
export type { ChangedFile, ChangedFileStatus, ChangedFilesResult, PorcelainEntry } from './changed-files';
export { assertSafeGitRelPath, assertContainedPath, GitPathEscapeError } from './git-path';
```

Then add these four stub keys to **every** existing `mock.module('@archon/git', () => ({ ... }))` factory:

```ts
changedFiles: mock(async () => ({ files: [], revision: '0'.repeat(64) })),
isGitWorkTree: mock(async () => false),
assertSafeGitRelPath: (_checkoutRealpath: string, relPath: string) => relPath,
assertContainedPath: mock(async (_checkoutRealpath: string, relPath: string) => relPath),
```

Factories to update, each at the `mock.module('@archon/git'` object already in the file:

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
19. `packages/server/src/routes/api.health.test.ts`
20. `packages/server/src/routes/api.messages.test.ts`
21. `packages/server/src/routes/api.provider-keys.test.ts`
22. `packages/server/src/routes/api.providers.test.ts`
23. `packages/server/src/routes/api.usage.test.ts`
24. `packages/server/src/routes/api.user-ai-prefs.test.ts`
25. `packages/server/src/routes/api.workflow-runs.test.ts`
26. `packages/workflows/src/executor-preamble.test.ts`
27. `packages/workflows/src/executor.test.ts`
28. `packages/workflows/src/runtime-check.test.ts`
29. `packages/workflows/src/script-node-deps.test.ts`
30. `packages/workflows/src/subrun.test.ts`

If a factory already imports `mock` from `bun:test`, reuse it.
If a factory uses plain functions instead of `mock()`, plain `async () => ({ files: [], revision: '0'.repeat(64) })` is acceptable.

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test packages/git/src/changed-files.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/git/src/changed-files.ts packages/git/src/changed-files.test.ts packages/git/src/index.ts packages/adapters packages/cli packages/core packages/isolation packages/server/src/routes packages/workflows/src
git commit -m "feat(git): add changedFiles helper and stub new git exports in test mocks"
```

---

### Task 3: AD-6 checkout gate

**Files:**
- Create: `packages/server/src/routes/git/checkout-gate.ts`
- Create: `packages/server/src/routes/git/checkout-gate.test.ts`
- Modify: `packages/server/package.json` `scripts.test` to insert `&& bun test src/routes/git/checkout-gate.test.ts` immediately after `bun test src/routes/api.workflow-runs.test.ts`.

**Interfaces:**
- Consumes: injected `getConversationById`, `getIsolationEnvById`, `realpathFn`, `pathExists`, `isGitWorkTree`.
- Produces: `resolveRunCheckout(input: ResolveRunCheckoutInput): Promise<CheckoutGateResult>`.

```ts
export type GitEmptyReason = 'container' | 'no_checkout';

export type CheckoutGateResult =
  | { kind: 'run_not_found' }
  | { kind: 'empty'; emptyReason: GitEmptyReason }
  | { kind: 'ready'; workingPath: string };

export interface ResolveRunCheckoutInput {
  run: { conversation_id: string; working_path: string | null } | null;
  getConversationById: (id: string) => Promise<{ isolation_env_id: string | null } | null>;
  getIsolationEnvById: (id: string) => Promise<{ provider: string } | null>;
  realpathFn: (p: string) => Promise<string>;
  pathExists: (p: string) => Promise<boolean>;
  isGitWorkTree: (p: string) => Promise<boolean>;
}
```

- [ ] **Step 1: Write the failing test**

Create `packages/server/src/routes/git/checkout-gate.test.ts` with this content:

```ts
import { describe, expect, test } from 'bun:test';

import { resolveRunCheckout } from './checkout-gate';

function deps(overrides?: Partial<Parameters<typeof resolveRunCheckout>[0]>): Parameters<
  typeof resolveRunCheckout
>[0] {
  return {
    run: { conversation_id: 'conv-1', working_path: '/wt' },
    getConversationById: async () => ({ isolation_env_id: null }),
    getIsolationEnvById: async () => null,
    realpathFn: async p => p,
    pathExists: async () => true,
    isGitWorkTree: async () => true,
    ...overrides,
  };
}

describe('resolveRunCheckout', () => {
  test('returns run_not_found when the run is missing', async () => {
    expect(await resolveRunCheckout(deps({ run: null }))).toEqual({ kind: 'run_not_found' });
  });

  test('returns container before any git or realpath call', async () => {
    let gitCalls = 0;
    let realpathCalls = 0;
    const result = await resolveRunCheckout(
      deps({
        getConversationById: async () => ({ isolation_env_id: 'env-1' }),
        getIsolationEnvById: async () => ({ provider: 'container' }),
        realpathFn: async p => {
          realpathCalls += 1;
          return p;
        },
        isGitWorkTree: async () => {
          gitCalls += 1;
          return true;
        },
      })
    );
    expect(result).toEqual({ kind: 'empty', emptyReason: 'container' });
    expect(gitCalls).toBe(0);
    expect(realpathCalls).toBe(0);
  });

  test('missing isolation_env_id is not CAP-6 and uses the host path', async () => {
    const result = await resolveRunCheckout(
      deps({
        getConversationById: async () => ({ isolation_env_id: null }),
      })
    );
    expect(result).toEqual({ kind: 'ready', workingPath: '/wt' });
  });

  test('missing env row is not CAP-6', async () => {
    const result = await resolveRunCheckout(
      deps({
        getConversationById: async () => ({ isolation_env_id: 'missing' }),
        getIsolationEnvById: async () => null,
      })
    );
    expect(result).toEqual({ kind: 'ready', workingPath: '/wt' });
  });

  test('null working_path, missing dir, and non-git dir are no_checkout', async () => {
    expect(
      await resolveRunCheckout(deps({ run: { conversation_id: 'c', working_path: null } }))
    ).toEqual({ kind: 'empty', emptyReason: 'no_checkout' });
    expect(await resolveRunCheckout(deps({ pathExists: async () => false }))).toEqual({
      kind: 'empty',
      emptyReason: 'no_checkout',
    });
    expect(await resolveRunCheckout(deps({ isGitWorkTree: async () => false }))).toEqual({
      kind: 'empty',
      emptyReason: 'no_checkout',
    });
  });

  test('child runs use the same conversation FK gate', async () => {
    const result = await resolveRunCheckout(
      deps({
        run: { conversation_id: 'shared-conv', working_path: '/child-wt' },
        getConversationById: async id =>
          id === 'shared-conv' ? { isolation_env_id: 'env-1' } : null,
        getIsolationEnvById: async () => ({ provider: 'container' }),
      })
    );
    expect(result).toEqual({ kind: 'empty', emptyReason: 'container' });
  });

  test('vm and remote providers fall through to host git', async () => {
    const result = await resolveRunCheckout(
      deps({
        getConversationById: async () => ({ isolation_env_id: 'env-1' }),
        getIsolationEnvById: async () => ({ provider: 'vm' }),
      })
    );
    expect(result).toEqual({ kind: 'ready', workingPath: '/wt' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/server/src/routes/git/checkout-gate.test.ts`

Expected: FAIL with module-not-found for `./checkout-gate`.

- [ ] **Step 3: Write minimal implementation**

Create `packages/server/src/routes/git/checkout-gate.ts` with this content:

```ts
export type GitEmptyReason = 'container' | 'no_checkout';

export type CheckoutGateResult =
  | { kind: 'run_not_found' }
  | { kind: 'empty'; emptyReason: GitEmptyReason }
  | { kind: 'ready'; workingPath: string };

export interface ResolveRunCheckoutInput {
  run: { conversation_id: string; working_path: string | null } | null;
  getConversationById: (id: string) => Promise<{ isolation_env_id: string | null } | null>;
  getIsolationEnvById: (id: string) => Promise<{ provider: string } | null>;
  realpathFn: (p: string) => Promise<string>;
  pathExists: (p: string) => Promise<boolean>;
  isGitWorkTree: (p: string) => Promise<boolean>;
}

export async function resolveRunCheckout(
  input: ResolveRunCheckoutInput
): Promise<CheckoutGateResult> {
  if (!input.run) return { kind: 'run_not_found' };

  const conversation = input.run.conversation_id
    ? await input.getConversationById(input.run.conversation_id)
    : null;
  const envId = conversation?.isolation_env_id ?? null;
  if (envId) {
    const env = await input.getIsolationEnvById(envId);
    if (env?.provider === 'container') {
      return { kind: 'empty', emptyReason: 'container' };
    }
  }

  const workingPath = input.run.working_path;
  if (!workingPath) return { kind: 'empty', emptyReason: 'no_checkout' };
  const exists = await input.pathExists(workingPath);
  if (!exists) return { kind: 'empty', emptyReason: 'no_checkout' };

  let resolved: string;
  try {
    resolved = await input.realpathFn(workingPath);
  } catch {
    return { kind: 'empty', emptyReason: 'no_checkout' };
  }

  const isGit = await input.isGitWorkTree(resolved);
  if (!isGit) return { kind: 'empty', emptyReason: 'no_checkout' };
  return { kind: 'ready', workingPath: resolved };
}
```

In `packages/server/package.json`, edit `scripts.test` so the chain contains `bun test src/routes/api.workflow-runs.test.ts && bun test src/routes/git/checkout-gate.test.ts && bun test src/routes/api.usage.test.ts`.
Keep every other existing invocation unchanged.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test packages/server/src/routes/git/checkout-gate.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/routes/git/checkout-gate.ts packages/server/src/routes/git/checkout-gate.test.ts packages/server/package.json
git commit -m "feat(server): add AD-6 git checkout gate for source-control reads"
```

---

### Task 4: GET `/api/workflows/runs/{runId}/git/changes`

**Files:**
- Create: `packages/server/src/routes/schemas/git.schemas.ts`
- Create: `packages/server/src/routes/git/changes-route.ts`
- Create: `packages/server/src/routes/git/changes-handler.ts`
- Create: `packages/server/src/routes/api.git-changes.test.ts`
- Modify: `packages/server/src/routes/api.ts`
- Modify: `packages/server/package.json` to add `&& bun test src/routes/api.git-changes.test.ts` immediately after the checkout-gate invocation.
- Modify: every server `mock.module('@archon/core/db/isolation-environments')` factory listed below.

**Interfaces:**
- Consumes: `resolveRunCheckout`, `changedFiles`, `isGitWorkTree`, `workflowDb.getWorkflowRun`, `conversationDb.getConversationById`, `isolationEnvDb.getById`.
- Produces: HTTP `GET /api/workflows/runs/{runId}/git/changes` returning `GitChangesResponse`.

- [ ] **Step 1: Write the failing HTTP tests**

Create `packages/server/src/routes/api.git-changes.test.ts` with this content:

```ts
import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { OpenAPIHono } from '@hono/zod-openapi';
import type { ConversationLockManager } from '@archon/core';
import type { WebAdapter } from '../adapters/web';
import { validationErrorHook } from './openapi-defaults';
import { mockAllWorkflowModules } from '../test/workflow-mock-factories';

const mockGetWorkflowRun = mock(async (_id: string) => null as null | MockRun);
const mockGetConversationById = mock(
  async (_id: string) => null as null | { id: string; isolation_env_id: string | null }
);
const mockGetById = mock(async (_id: string) => null as null | { provider: string });
const mockChangedFiles = mock(async () => ({
  files: [] as { path: string; status: 'M' | 'A' | 'D' }[],
  revision: 'rev-1',
}));
const mockIsGitWorkTree = mock(async () => true);

type MockRun = {
  id: string;
  conversation_id: string;
  working_path: string | null;
  status: string;
};

mockAllWorkflowModules();

mock.module('@archon/core/db/workflows', () => ({
  getWorkflowRun: mockGetWorkflowRun,
}));
mock.module('@archon/core/db/conversations', () => ({
  getConversationById: mockGetConversationById,
}));
mock.module('@archon/core/db/isolation-environments', () => ({
  getById: mockGetById,
  listByCodebase: mock(async () => []),
  updateStatus: mock(async () => {}),
}));
mock.module('@archon/git', () => ({
  changedFiles: mockChangedFiles,
  isGitWorkTree: mockIsGitWorkTree,
  assertSafeGitRelPath: (_c: string, rel: string) => rel,
  assertContainedPath: mock(async (_c: string, rel: string) => rel),
  removeWorktree: mock(async () => {}),
  toRepoPath: (p: string) => p,
  toWorktreePath: (p: string) => p,
}));

import { registerApiRoutes } from './api';

function makeApp(): OpenAPIHono {
  const app = new OpenAPIHono({ defaultHook: validationErrorHook });
  const mockWebAdapter = {
    setConversationDbId: mock(() => {}),
    emitSSE: mock(async () => {}),
    emitLockEvent: mock(async () => {}),
  } as unknown as WebAdapter;
  const mockLockManager = {
    acquireLock: mock(async (_id: string, fn: () => Promise<void>) => {
      await fn();
      return { status: 'started' };
    }),
    getStats: mock(() => ({ active: 0, queued: 0 })),
  } as unknown as ConversationLockManager;
  registerApiRoutes(app, mockWebAdapter, mockLockManager);
  return app;
}

let checkoutDir = '';

const runRow = (): MockRun => ({
  id: 'run-1',
  conversation_id: 'conv-1',
  working_path: checkoutDir,
  status: 'running',
});

describe('GET /api/workflows/runs/:runId/git/changes', () => {
  beforeEach(async () => {
    checkoutDir = await mkdtemp(join(tmpdir(), 'git-changes-'));
    mockGetWorkflowRun.mockReset();
    mockGetConversationById.mockReset();
    mockGetById.mockReset();
    mockChangedFiles.mockReset();
    mockIsGitWorkTree.mockReset();
    mockGetWorkflowRun.mockImplementation(async () => runRow());
    mockGetConversationById.mockImplementation(async () => ({
      id: 'conv-1',
      isolation_env_id: null,
    }));
    mockGetById.mockImplementation(async () => null);
    mockChangedFiles.mockImplementation(async () => ({
      files: [{ path: 'src/a.ts', status: 'M' }],
      revision: 'abc',
    }));
    mockIsGitWorkTree.mockImplementation(async () => true);
  });

  afterEach(async () => {
    await rm(checkoutDir, { recursive: true, force: true });
  });

  test('404 when the run is missing', async () => {
    mockGetWorkflowRun.mockImplementation(async () => null);
    const response = await makeApp().request('/api/workflows/runs/missing/git/changes');
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: 'Workflow run not found' });
  });

  test('200 container CAP-6 without calling git', async () => {
    mockGetConversationById.mockImplementation(async () => ({
      id: 'conv-1',
      isolation_env_id: 'env-1',
    }));
    mockGetById.mockImplementation(async () => ({ provider: 'container' }));
    const response = await makeApp().request('/api/workflows/runs/run-1/git/changes');
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      emptyReason: 'container',
      files: [],
      revision: '',
    });
    expect(mockChangedFiles).not.toHaveBeenCalled();
  });

  test('200 no_checkout when working_path is null', async () => {
    mockGetWorkflowRun.mockImplementation(async () => ({ ...runRow(), working_path: null }));
    const response = await makeApp().request('/api/workflows/runs/run-1/git/changes');
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      emptyReason: 'no_checkout',
      files: [],
      revision: '',
    });
  });

  test('200 lists M/A/D from git and ignores working_path query', async () => {
    const response = await makeApp().request(
      '/api/workflows/runs/run-1/git/changes?working_path=/etc'
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      files: [{ path: 'src/a.ts', status: 'M' }],
      revision: 'abc',
    });
    expect(mockChangedFiles).toHaveBeenCalledTimes(1);
    expect(mockChangedFiles.mock.calls[0]?.[0]).toBe(checkoutDir);
  });

  test('200 empty files on a clean worktree is not CAP-6', async () => {
    mockChangedFiles.mockImplementation(async () => ({ files: [], revision: 'clean' }));
    const response = await makeApp().request('/api/workflows/runs/run-1/git/changes');
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ files: [], revision: 'clean' });
  });

  test('500 on git failure after a readable checkout, without a path in the body', async () => {
    mockChangedFiles.mockImplementation(async () => {
      throw new Error(`boom at ${checkoutDir}/secret`);
    });
    const response = await makeApp().request('/api/workflows/runs/run-1/git/changes');
    expect(response.status).toBe(500);
    const body = (await response.json()) as { error: string };
    expect(body.error).toBe('Could not read git changes');
    expect(JSON.stringify(body)).not.toContain(checkoutDir);
  });
});
```

This new file must remain a separate `bun test` invocation so its `mock.module` factories do not collide with `api.workflow-runs.test.ts`.
Do not add the git-changes tests into `api.workflow-runs.test.ts`.
The handler uses real `fs/promises.stat` and `realpath` against the temp checkout created in `beforeEach`.
`changedFiles` and `isGitWorkTree` stay mocked.

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/server/src/routes/api.git-changes.test.ts`

Expected: FAIL because the route is unregistered (404 from Hono, not the JSON above).

- [ ] **Step 3: Write minimal implementation**

Create `packages/server/src/routes/schemas/git.schemas.ts`:

```ts
import { z } from '@hono/zod-openapi';

export const gitEmptyReasonSchema = z.enum(['container', 'no_checkout']).openapi('GitEmptyReason');
export type GitEmptyReason = z.infer<typeof gitEmptyReasonSchema>;

export const gitChangedFileStatusSchema = z.enum(['M', 'A', 'D']).openapi('GitChangedFileStatus');

export const gitChangedFileSchema = z
  .object({
    path: z.string().min(1),
    status: gitChangedFileStatusSchema,
  })
  .openapi('GitChangedFile');
export type GitChangedFile = z.infer<typeof gitChangedFileSchema>;

export const gitChangesResponseSchema = z
  .object({
    emptyReason: gitEmptyReasonSchema.optional(),
    files: z.array(gitChangedFileSchema),
    revision: z.string(),
  })
  .openapi('GitChangesResponse');
export type GitChangesResponse = z.infer<typeof gitChangesResponseSchema>;
```

Create `packages/server/src/routes/git/changes-route.ts`:

```ts
import { createRoute, z } from '@hono/zod-openapi';
import { errorSchema } from '../schemas/common.schemas';
import { gitChangesResponseSchema } from '../schemas/git.schemas';

export const gitChangesRoute = createRoute({
  method: 'get',
  path: '/api/workflows/runs/{runId}/git/changes',
  tags: ['Workflows'],
  summary: "List a run's uncommitted git changes",
  description:
    'Read-only porcelain projection for the run checkout resolved server-side from runId. ' +
    'CAP-6 is HTTP 200 with emptyReason container|no_checkout.',
  request: {
    params: z.object({ runId: z.string() }),
  },
  responses: {
    200: {
      content: { 'application/json': { schema: gitChangesResponseSchema } },
      description: 'Changes or CAP-6 empty envelope',
    },
    404: {
      content: { 'application/json': { schema: errorSchema } },
      description: 'Run not found',
    },
    500: {
      content: { 'application/json': { schema: errorSchema } },
      description: 'Git read failed',
    },
  },
});
```

Create `packages/server/src/routes/git/changes-handler.ts`:

```ts
import type { Context } from 'hono';
import { realpath, stat } from 'fs/promises';
import { changedFiles, isGitWorkTree, toWorktreePath } from '@archon/git';
import { createLogger } from '@archon/paths';
import * as conversationDb from '@archon/core/db/conversations';
import * as isolationEnvDb from '@archon/core/db/isolation-environments';
import * as workflowDb from '@archon/core/db/workflows';
import { resolveRunCheckout } from './checkout-gate';
import type { GitChangesResponse } from '../schemas/git.schemas';

let cachedLog: ReturnType<typeof createLogger> | undefined;
function getLog(): ReturnType<typeof createLogger> {
  if (!cachedLog) cachedLog = createLogger('api');
  return cachedLog;
}

async function pathExists(p: string): Promise<boolean> {
  try {
    const s = await stat(p);
    return s.isDirectory();
  } catch {
    return false;
  }
}

export async function handleGitChanges(
  c: Context,
  apiError: (c: Context, status: 404 | 500, message: string) => Response
): Promise<Response> {
  const runId = c.req.param('runId') ?? '';
  getLog().info({ runId }, 'git.changes_started');
  try {
    const run = await workflowDb.getWorkflowRun(runId);
    const gate = await resolveRunCheckout({
      run: run ? { conversation_id: run.conversation_id, working_path: run.working_path } : null,
      getConversationById: async id => {
        const conv = await conversationDb.getConversationById(id);
        return conv ? { isolation_env_id: conv.isolation_env_id } : null;
      },
      getIsolationEnvById: async id => {
        const env = await isolationEnvDb.getById(id);
        return env ? { provider: env.provider } : null;
      },
      realpathFn: realpath,
      pathExists,
      isGitWorkTree,
    });

    if (gate.kind === 'run_not_found') {
      getLog().info({ runId }, 'git.changes_failed');
      return apiError(c, 404, 'Workflow run not found');
    }
    if (gate.kind === 'empty') {
      getLog().info({ runId, emptyReason: gate.emptyReason }, 'git.changes_completed');
      const body: GitChangesResponse = {
        emptyReason: gate.emptyReason,
        files: [],
        revision: '',
      };
      return c.json(body);
    }

    const result = await changedFiles(toWorktreePath(gate.workingPath));
    const body: GitChangesResponse = {
      files: result.files,
      revision: result.revision,
    };
    getLog().info({ runId, fileCount: body.files.length }, 'git.changes_completed');
    return c.json(body);
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    getLog().error({ runId, errorType: error.constructor.name }, 'git.changes_failed');
    return apiError(c, 500, 'Could not read git changes');
  }
}
```

Do not log `gate.workingPath`.

In `packages/server/src/routes/api.ts`:
1. Import `gitChangesRoute` from `./git/changes-route`.
2. Import `handleGitChanges` from `./git/changes-handler`.
3. Inside `registerApiRoutes`, after `registerOpenApiRoute` is defined, register:

```ts
registerOpenApiRoute(gitChangesRoute, async c => {
  return handleGitChanges(c, apiError);
});
```

Place this next to the other `/api/workflows/runs/{runId}` registrations, after `getWorkflowRunRoute` is fine.
Do not add `requireWebUser`.

Add `getById: mock(async () => null)` to every server factory of `mock.module('@archon/core/db/isolation-environments'`:

1. `packages/server/src/routes/api.auth.test.ts`
2. `packages/server/src/routes/api.codebases.test.ts`
3. `packages/server/src/routes/api.conversations.test.ts` (the factory is currently `() => ({})`; add `getById`)
4. `packages/server/src/routes/api.health.test.ts`
5. `packages/server/src/routes/api.messages.test.ts`
6. `packages/server/src/routes/api.provider-keys.test.ts`
7. `packages/server/src/routes/api.providers.test.ts`
8. `packages/server/src/routes/api.usage.test.ts`
9. `packages/server/src/routes/api.user-ai-prefs.test.ts`
10. `packages/server/src/routes/api.workflow-envs.test.ts` (currently `() => ({})`)
11. `packages/server/src/routes/api.workflow-runs.test.ts`
12. `packages/server/src/routes/api.workflows.test.ts` (currently `() => ({})`)

Empty factories must become `{ getById: mock(async () => null) }` so `mock.module` merge does not call real SQL when `registerApiRoutes` loads the handler module.

Also add `changedFiles` / `isGitWorkTree` stubs to any server git mock that Task 2 already listed.

Update `packages/server/package.json` `scripts.test` so the chain contains `bun test src/routes/git/checkout-gate.test.ts && bun test src/routes/api.git-changes.test.ts`.

- [ ] **Step 4: Run tests to verify they pass**

Run these two commands, because each file has its own `mock.module` graph:

```bash
bun test packages/server/src/routes/git/checkout-gate.test.ts
bun test packages/server/src/routes/api.git-changes.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/routes/schemas/git.schemas.ts packages/server/src/routes/git packages/server/src/routes/api.ts packages/server/src/routes/api.git-changes.test.ts packages/server/package.json packages/server/src/routes/api.auth.test.ts packages/server/src/routes/api.codebases.test.ts packages/server/src/routes/api.conversations.test.ts packages/server/src/routes/api.health.test.ts packages/server/src/routes/api.messages.test.ts packages/server/src/routes/api.provider-keys.test.ts packages/server/src/routes/api.providers.test.ts packages/server/src/routes/api.usage.test.ts packages/server/src/routes/api.user-ai-prefs.test.ts packages/server/src/routes/api.workflow-envs.test.ts packages/server/src/routes/api.workflow-runs.test.ts packages/server/src/routes/api.workflows.test.ts
git commit -m "feat(server): add read-only run git changes endpoint"
```

---

### Task 5: Web OpenAPI types and API client

**Files:**
- Modify: `packages/web/src/lib/api.generated.d.ts`
- Modify: `packages/web/src/lib/api.ts`

**Interfaces:**
- Consumes: `GitChangesResponse` from OpenAPI.
- Produces: `getWorkflowRunGitChanges(runId: string): Promise<GitChangesResponse>`.

- [ ] **Step 1: Write the failing client test**

There is no existing API-client test file.
Add this function-level test as `packages/web/src/lib/api.git-changes.test.ts`:

```ts
import { afterEach, describe, expect, test, mock } from 'bun:test';

const fetchMock = mock(async (_url: string) => {
  return new Response(JSON.stringify({ files: [{ path: 'a.ts', status: 'M' }], revision: 'r1' }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
});
globalThis.fetch = fetchMock as unknown as typeof fetch;

afterEach(() => {
  fetchMock.mockClear();
});

describe('getWorkflowRunGitChanges', () => {
  test('GETs the run-scoped git changes path and never sends working_path', async () => {
    const { getWorkflowRunGitChanges } = await import('./api');
    const body = await getWorkflowRunGitChanges('run-1');
    expect(body).toEqual({ files: [{ path: 'a.ts', status: 'M' }], revision: 'r1' });
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/workflows/runs/run-1/git/changes');
    expect(String(fetchMock.mock.calls[0]?.[0])).not.toContain('working_path');
  });
});
```

`packages/web/package.json` `test` already runs `bun test src/lib/`, so this file is picked up without a script edit.

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/web/src/lib/api.git-changes.test.ts`

Expected: FAIL with `getWorkflowRunGitChanges is not exported`.

- [ ] **Step 3: Write minimal implementation**

If the server is running on port 3090, run:

```bash
bun --filter @archon/web generate:types
```

If it is not running, insert this path into `packages/web/src/lib/api.generated.d.ts` `export interface paths` immediately before `"/api/workflows/runs/{runId}": {` (currently near line 2281):

```ts
    "/api/workflows/runs/{runId}/git/changes": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List a run's uncommitted git changes */
        get: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    runId: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Changes or CAP-6 empty envelope */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["GitChangesResponse"];
                    };
                };
                /** @description Run not found */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["Error"];
                    };
                };
                /** @description Git read failed */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["Error"];
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
```

Insert these schemas into `components.schemas` next to `WorkflowRunDetail`:

```ts
        GitEmptyReason: "container" | "no_checkout";
        GitChangedFileStatus: "M" | "A" | "D";
        GitChangedFile: {
            path: string;
            status: components["schemas"]["GitChangedFileStatus"];
        };
        GitChangesResponse: {
            emptyReason?: components["schemas"]["GitEmptyReason"];
            files: components["schemas"]["GitChangedFile"][];
            revision: string;
        };
```

Then add to `packages/web/src/lib/api.ts` after `getWorkflowRun`:

```ts
export type GitChangesResponse = components['schemas']['GitChangesResponse'];
export type GitChangedFile = components['schemas']['GitChangedFile'];
export type GitEmptyReason = components['schemas']['GitEmptyReason'];

export async function getWorkflowRunGitChanges(runId: string): Promise<GitChangesResponse> {
  return fetchJSON(`/api/workflows/runs/${encodeURIComponent(runId)}/git/changes`);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test packages/web/src/lib/api.git-changes.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/lib/api.ts packages/web/src/lib/api.generated.d.ts packages/web/src/lib/api.git-changes.test.ts
git commit -m "feat(web): add generated git changes client"
```

---

### Task 6: Changes list UI

**Files:**
- Create: `packages/web/src/components/workflows/source-control/dag-run-tabs.ts`
- Create: `packages/web/src/components/workflows/source-control/dag-run-tabs.test.ts`
- Create: `packages/web/src/components/workflows/source-control/changed-file-row.tsx`
- Create: `packages/web/src/components/workflows/source-control/source-control-panel.tsx`
- Create: `packages/web/src/components/workflows/source-control/source-control-panel.test.tsx`

**Interfaces:**
- Consumes: `GitChangesResponse`.
- Produces: `dagRunTabValues(parentPlatformId: string | null): ReadonlyArray<'graph' | 'logs' | 'chat' | 'source-control'>`, `SourceControlPanel` props below.

```ts
export type SourceControlPanelProps = {
  emptyReason?: 'container' | 'no_checkout';
  files: ReadonlyArray<{ path: string; status: 'M' | 'A' | 'D' }>;
  loadState: 'idle' | 'loading' | 'error';
  stale: boolean;
  onReload: () => void;
  activeIndex: number;
  onActiveIndexChange: (index: number) => void;
};
```

- [ ] **Step 1: Write the failing tests**

Create `packages/web/src/components/workflows/source-control/dag-run-tabs.test.ts`:

```ts
import { describe, expect, test } from 'bun:test';

import { dagRunTabValues } from './dag-run-tabs';

describe('dagRunTabValues', () => {
  test('inserts Source Control after Chat when Chat exists', () => {
    expect(dagRunTabValues('parent-1')).toEqual(['graph', 'logs', 'chat', 'source-control']);
  });

  test('keeps Source Control when Chat is absent', () => {
    expect(dagRunTabValues(null)).toEqual(['graph', 'logs', 'source-control']);
  });
});
```

Create `packages/web/src/components/workflows/source-control/source-control-panel.test.tsx`:

```ts
import { describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';

import { SourceControlPanel } from './source-control-panel';

describe('SourceControlPanel', () => {
  test('renders letter-carried M/A/D rows and no write chrome', () => {
    const html = renderToStaticMarkup(
      <SourceControlPanel
        files={[
          { path: 'src/a.ts', status: 'M' },
          { path: 'new.ts', status: 'A' },
          { path: 'gone.ts', status: 'D' },
        ]}
        loadState="idle"
        stale={false}
        onReload={(): void => undefined}
        activeIndex={0}
        onActiveIndexChange={(): void => undefined}
      />
    );
    expect(html).toContain('Changes');
    expect(html).toContain('src/a.ts');
    expect(html).toContain('>M<');
    expect(html).toContain('>A<');
    expect(html).toContain('>D<');
    expect(html).not.toContain('Commit');
    expect(html).not.toContain('Stage');
    expect(html).not.toContain('Discard');
    expect(html).not.toContain('History');
  });

  test('shows region empty copy on a live checkout with no files', () => {
    const html = renderToStaticMarkup(
      <SourceControlPanel
        files={[]}
        loadState="idle"
        stale={false}
        onReload={(): void => undefined}
        activeIndex={0}
        onActiveIndexChange={(): void => undefined}
      />
    );
    expect(html).toContain('No uncommitted changes');
    expect(html).not.toContain('No worktree available');
    expect(html).not.toContain('No files to show');
  });

  test('does not flash region empty while the first fetch is in flight', () => {
    const html = renderToStaticMarkup(
      <SourceControlPanel
        files={[]}
        loadState="loading"
        stale={false}
        onReload={(): void => undefined}
        activeIndex={0}
        onActiveIndexChange={(): void => undefined}
      />
    );
    expect(html).toContain('Changes');
    expect(html).not.toContain('No uncommitted changes');
  });
  test('container empty has no Reload CTA', () => {
    const html = renderToStaticMarkup(
      <SourceControlPanel
        emptyReason="container"
        files={[]}
        loadState="idle"
        stale={false}
        onReload={(): void => undefined}
        activeIndex={0}
        onActiveIndexChange={(): void => undefined}
      />
    );
    expect(html).toContain('No files to show');
    expect(html).toContain(
      'This run executed inside a container — its working files aren&#x27;t on the host to read.'
    );
    expect(html).not.toContain('>Reload<');
  });

  test('no_checkout empty has Reload', () => {
    const html = renderToStaticMarkup(
      <SourceControlPanel
        emptyReason="no_checkout"
        files={[]}
        loadState="idle"
        stale={false}
        onReload={(): void => undefined}
        activeIndex={0}
        onActiveIndexChange={(): void => undefined}
      />
    );
    expect(html).toContain('No worktree available');
    expect(html).toContain(
      'This run&#x27;s checkout isn&#x27;t available or readable right now — it may not be ready yet, or it may have been cleaned up.'
    );
    expect(html).toContain('Reload');
  });

  test('stale banner and in-region error keep the list and avoid alarm copy', () => {
    const html = renderToStaticMarkup(
      <SourceControlPanel
        files={[{ path: 'keep.ts', status: 'M' }]}
        loadState="error"
        stale={true}
        onReload={(): void => undefined}
        activeIndex={0}
        onActiveIndexChange={(): void => undefined}
      />
    );
    expect(html).toContain('keep.ts');
    expect(html).toContain('Changed on disk — Reload');
    expect(html).toContain('Could not refresh changes.');
    expect(html).not.toContain('Error:');
    expect(html).not.toContain('unsupported');
    expect(html).not.toContain('⚠️');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test packages/web/src/components/workflows/source-control/`

Expected: FAIL with module-not-found.

- [ ] **Step 3: Write minimal implementation**

Create `packages/web/src/components/workflows/source-control/dag-run-tabs.ts`:

```ts
export type DagRunTab = 'graph' | 'logs' | 'chat' | 'source-control';

export function dagRunTabValues(parentPlatformId: string | null): readonly DagRunTab[] {
  if (parentPlatformId) return ['graph', 'logs', 'chat', 'source-control'];
  return ['graph', 'logs', 'source-control'];
}
```

Create `packages/web/src/components/workflows/source-control/changed-file-row.tsx`:

```ts
import type { ReactElement } from 'react';

export function ChangedFileRow(props: {
  path: string;
  status: 'M' | 'A' | 'D';
  active: boolean;
  id: string;
}): ReactElement {
  return (
    <div
      id={props.id}
      role="option"
      aria-selected={props.active}
      tabIndex={props.active ? 0 : -1}
      className={`flex items-center gap-2 rounded-md px-2 py-1.5 text-xs ${
        props.active ? 'bg-surface-elevated' : 'hover:bg-surface-hover'
      }`}
    >
      <span className="min-w-0 flex-1 truncate text-text-primary font-mono">{props.path}</span>
      <span
        aria-label={
          props.status === 'M' ? 'M, modified' : props.status === 'A' ? 'A, added' : 'D, deleted'
        }
        className="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium text-text-primary bg-surface-inset"
      >
        {props.status}
      </span>
    </div>
  );
}
```

Create `packages/web/src/components/workflows/source-control/source-control-panel.tsx`:

```ts
import type { KeyboardEvent, ReactElement } from 'react';

import { ChangedFileRow } from './changed-file-row';

export type SourceControlPanelProps = {
  emptyReason?: 'container' | 'no_checkout';
  files: ReadonlyArray<{ path: string; status: 'M' | 'A' | 'D' }>;
  loadState: 'idle' | 'loading' | 'error';
  stale: boolean;
  onReload: () => void;
  activeIndex: number;
  onActiveIndexChange: (index: number) => void;
};

export function SourceControlPanel(props: SourceControlPanelProps): ReactElement {
  if (props.emptyReason === 'container') {
    return (
      <div role="status" className="flex h-full flex-col items-start gap-2 p-4 text-text-secondary">
        <h2 className="text-sm font-medium text-text-primary">No files to show</h2>
        <p className="text-sm">
          This run executed inside a container — its working files aren't on the host to read.
        </p>
      </div>
    );
  }

  if (props.emptyReason === 'no_checkout') {
    return (
      <div role="status" className="flex h-full flex-col items-start gap-2 p-4 text-text-secondary">
        <h2 className="text-sm font-medium text-text-primary">No worktree available</h2>
        <p className="text-sm">
          This run's checkout isn't available or readable right now — it may not be ready yet, or it
          may have been cleaned up.
        </p>
        <button
          type="button"
          onClick={props.onReload}
          className="text-xs text-primary hover:text-accent-bright"
        >
          Reload
        </button>
      </div>
    );
  }

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (props.files.length === 0) return;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      props.onActiveIndexChange(Math.min(props.files.length - 1, props.activeIndex + 1));
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      props.onActiveIndexChange(Math.max(0, props.activeIndex - 1));
    }
    if (event.key === 'Home') {
      event.preventDefault();
      props.onActiveIndexChange(0);
    }
    if (event.key === 'End') {
      event.preventDefault();
      props.onActiveIndexChange(props.files.length - 1);
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center justify-between border-b border-border px-4 py-1.5">
        <h2 className="text-sm font-medium text-text-primary">Changes</h2>
        <button
          type="button"
          onClick={props.onReload}
          className="text-xs text-primary hover:text-accent-bright"
        >
          Reload
        </button>
      </div>
      {props.stale ? (
        <div role="status" className="px-4 py-2 text-xs text-text-secondary">
          Changed on disk — Reload
        </div>
      ) : null}
      {props.loadState === 'error' ? (
        <div role="status" className="px-4 py-2 text-xs text-text-secondary">
          Could not refresh changes.
        </div>
      ) : null}
      {props.files.length === 0 && props.loadState !== 'loading' ? (
        <p role="status" className="px-4 py-3 text-sm text-text-secondary">
          No uncommitted changes
        </p>
      ) : (
        <div
          role="listbox"
          aria-label="Uncommitted changes"
          tabIndex={0}
          onKeyDown={onKeyDown}
          className="min-h-0 flex-1 overflow-auto p-2"
        >
          {props.files.map((file, index) => (
            <ChangedFileRow
              key={`${file.status}:${file.path}`}
              id={`sc-file-${String(index)}`}
              path={file.path}
              status={file.status}
              active={index === props.activeIndex}
            />
          ))}
        </div>
      )}
    </div>
  );
}
```

Use JSX files with `.tsx` extensions as named above.
Do not import from `@/experiments/console`.
Do not render a viewer column.

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test packages/web/src/components/workflows/source-control/`

Expected: PASS.

`renderToStaticMarkup` encodes apostrophes as `&#x27;`, which the assertions above already match.

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/components/workflows/source-control
git commit -m "feat(web): add Source Control changes list panel"
```

---

### Task 7: Wire the tab into the legacy run screen

**Files:**
- Modify: `packages/web/src/components/workflows/WorkflowExecution.tsx`

**Interfaces:**
- Consumes: `dagRunTabValues`, `SourceControlPanel`, `getWorkflowRunGitChanges`.
- Produces: DAG tab `source-control` that fetches git only when selected.

- [ ] **Step 1: Write the failing tab-value test already added in Task 6, then extend WorkflowExecution**

Do not mount `WorkflowExecution` (it needs QueryClient, SSE, and routing).
The tab contract is `dagRunTabValues`.
After wiring, grep the file to prove `source-control` is a `TabsTrigger` value and `getWorkflowRunGitChanges` is called only from a query with `enabled: isDag && activeView === 'source-control'`.

Add this characterization test to `packages/web/src/components/workflows/source-control/dag-run-tabs.test.ts` after wiring, as a source-text contract:

Create `packages/web/src/components/workflows/source-control/workflow-execution-sc.test.ts`:

```ts
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'fs';
import { join } from 'path';

describe('WorkflowExecution Source Control wiring', () => {
  const source = readFileSync(
    join(import.meta.dir, '..', 'WorkflowExecution.tsx'),
    'utf8'
  );

  test('adds a Source Control tab and does not ship a viewer column', () => {
    expect(source).toContain('value="source-control"');
    expect(source).toContain('Source Control');
    expect(source).toContain('getWorkflowRunGitChanges');
    expect(source).toContain("activeView === 'source-control'");
    expect(source).not.toContain('react-diff-view');
    expect(source).not.toContain('History');
  });
});
```

Source-text tests are allowed here only as characterization that the tab exists without rendering the 885-line screen.
They must still fail before the edit.

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/web/src/components/workflows/source-control/workflow-execution-sc.test.ts`

Expected: FAIL because `WorkflowExecution.tsx` has no `source-control` string.

- [ ] **Step 3: Write minimal implementation**

In `packages/web/src/components/workflows/WorkflowExecution.tsx`:

1. Change `activeView` state type from `'graph' | 'logs' | 'chat'` to `'graph' | 'logs' | 'chat' | 'source-control'`.
2. Import `getWorkflowRunGitChanges` from `@/lib/api`.
3. Import `SourceControlPanel` and `dagRunTabValues` from `./source-control/source-control-panel` and `./source-control/dag-run-tabs`.
4. Add local state:

```ts
type ScSnapshot = {
  files: Array<{ path: string; status: 'M' | 'A' | 'D' }>;
  revision: string;
  emptyReason?: 'container' | 'no_checkout';
};
const [scActiveIndex, setScActiveIndex] = useState(0);
const [scDisplayed, setScDisplayed] = useState<ScSnapshot | null>(null);
const scDisplayedRef = useRef<ScSnapshot | null>(null);
const [scPending, setScPending] = useState<ScSnapshot | null>(null);
const [scStale, setScStale] = useState(false);
```

Reset those fields in the existing `useEffect` that runs on `runId` change, including `scDisplayedRef.current = null`.

5. Move `const isDag = dagDefinitionNodes !== null || (initialData?.dagNodes.length ?? 0) > 0;` to sit above the git query.
Add this query after that line:

```ts
const gitChangesQuery = useQuery({
  queryKey: ['workflowRunGitChanges', runId],
  queryFn: () => getWorkflowRunGitChanges(runId),
  enabled: isDag && activeView === 'source-control',
  refetchInterval: false,
  staleTime: Infinity,
});
```

Do not use the run query's 3000 ms `refetchInterval` for git.

6. Apply snapshots with a `useEffect` on `gitChangesQuery.data`:

```ts
useEffect(() => {
  const data = gitChangesQuery.data;
  if (!data) return;
  if (data.emptyReason) {
    const next = { files: [], revision: '', emptyReason: data.emptyReason };
    scDisplayedRef.current = next;
    setScDisplayed(next);
    setScPending(null);
    setScStale(false);
    return;
  }
  const current = scDisplayedRef.current;
  if (!current) {
    const next = { files: data.files, revision: data.revision };
    scDisplayedRef.current = next;
    setScDisplayed(next);
    setScStale(false);
    return;
  }
  if (data.revision === current.revision) {
    setScStale(false);
    setScPending(null);
    return;
  }
  setScPending({ files: data.files, revision: data.revision });
  setScStale(true);
}, [gitChangesQuery.data]);
```

7. Reload handler:

```ts
const handleSourceControlReload = useCallback((): void => {
  if (scStale && scPending) {
    scDisplayedRef.current = scPending;
    setScDisplayed(scPending);
    setScPending(null);
    setScStale(false);
    return;
  }
  void gitChangesQuery.refetch();
}, [scStale, scPending, gitChangesQuery]);
```

8. Keep the existing Graph and Logs triggers.
Render Chat only when `dagRunTabValues(parentPlatformId).includes('chat')`.
Always render `<TabsTrigger value="source-control">Source Control</TabsTrigger>` as the last trigger.

9. In `renderBody`, before the Logs fallback:

```tsx
if (isDag && activeView === 'source-control') {
  return (
    <SourceControlPanel
      emptyReason={scDisplayed?.emptyReason}
      files={scDisplayed?.files ?? []}
      loadState={gitChangesQuery.isError ? 'error' : gitChangesQuery.isFetching ? 'loading' : 'idle'}
      stale={scStale}
      onReload={handleSourceControlReload}
      activeIndex={scActiveIndex}
      onActiveIndexChange={setScActiveIndex}
    />
  );
}
```

`SourceControlPanel` must not show "No uncommitted changes" while `loadState === 'loading'` and `files` is empty.
Do not block the rest of the run screen.
Do not add a ResizablePanel viewer.

10. Confirm `workingPath` is still used only for `ChatInterface cwdOverride`.
Do not pass it into `getWorkflowRunGitChanges`.

- [ ] **Step 4: Run tests to verify they pass**

Run:

```bash
bun test packages/web/src/components/workflows/source-control/
bun test packages/web/src/components/workflows/WorkflowExecution.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/components/workflows/WorkflowExecution.tsx packages/web/src/components/workflows/source-control
git commit -m "feat(web): add Source Control tab to the legacy DAG run screen"
```

---

### Task 8: Sprint status and validation

**Files:**
- Modify: `_bmad-output/implementation-artifacts/archon-source-control/sprint-status.yaml`

**Interfaces:**
- Consumes: passing tests from Tasks 1–7.
- Produces: `1-1-see-this-runs-uncommitted-files: done` and `epic-1: in-progress`.

- [ ] **Step 1: Run the focused validation commands**

Run these exact commands and keep them green before editing sprint status:

```bash
bun test packages/git/src/changed-files.test.ts packages/git/src/git-path.test.ts
bun test packages/server/src/routes/git/checkout-gate.test.ts
bun test packages/server/src/routes/api.git-changes.test.ts
bun test packages/web/src/lib/api.git-changes.test.ts
bun test packages/web/src/components/workflows/source-control/
bun --filter @archon/git test
bun --filter @archon/web test
bun --filter @archon/server test
bun run type-check
bun run lint --max-warnings 0
bun run format:check
```

If `format:check` fails, run `bun run format` only on files this plan touched, then re-run `format:check`.

- [ ] **Step 2: Confirm the acceptance matrix**

Every Story 1.1 criterion must already be true:

| Criterion | Proof |
| --- | --- |
| Fourth tab Source Control on `/legacy/workflows/runs/:id` | Task 7 tab trigger + `dagRunTabValues` |
| Console not a v1 surface | no `/console` import |
| Changes region, no History | panel copy tests |
| Fetch on click, no poll | `enabled: activeView === 'source-control'` and `refetchInterval: false` |
| `M`/`A`/`D` letter badges | panel tests + porcelain tests |
| Untracked/rename/copy/type-change/unmerged projections | Task 1 |
| Keyboard-operable list | Arrow keys in panel |
| `workflow_events` do not author the list | handler calls `changedFiles` only |
| Clean worktree region empty | "No uncommitted changes" |
| CAP-6 HTTP 200 `container` / `no_checkout` | gate + HTTP tests |
| Container copy, no Reload | panel test |
| `no_checkout` Reload | panel test |
| Missing `isolation_env_id` is not CAP-6 | gate test |
| Git failure keeps list, in-region Reload, no alarm copy | panel + HTTP 500 |
| Reload + stale banner, no silent rewrite | OQ-1 handler |
| Client sends `runId` only | API client test |
| Server `working_path` + realpath | gate |
| Helpers in `@archon/git` | Task 2 |
| `registerOpenApiRoute` + generated types | Tasks 4–5 |
| Auth like artifacts | no `requireWebUser` |
| Pino `git.changes_*` without paths | handler |
| symlink-escape / encoded `..` refuse | git-path tests |
| colon / leading-dash / glob SUCCESS | porcelain + real repo tests |
| container top-level CAP-6 | gate + HTTP |
| no write chrome | panel test |
| no empty 70% viewer | Task 7 characterization |

- [ ] **Step 3: Update sprint status**

In `_bmad-output/implementation-artifacts/archon-source-control/sprint-status.yaml` set:

```yaml
  epic-1: in-progress
  1-1-see-this-runs-uncommitted-files: done
```

Keep `1-2` and `1-3` as `backlog`.
Set `last_updated` to the commit date.

- [ ] **Step 4: Commit**

```bash
git add _bmad-output/implementation-artifacts/archon-source-control/sprint-status.yaml
git commit -m "chore(sc): mark story 1-1-see-this-runs-uncommitted-files done"
```

Do not close GitHub issue #75 from this plan; the implementer records focused-test evidence in the PR body.

## Out of scope

- Story 1.2 viewer, hunk JSON, `fileDiff` / `fileAt`, `react-diff-view`.
- Story 1.3 large/binary thresholds.
- Story 2.1 History region and `log`.
- CAP-8 snapshot write.
- Container overlay reads.
- Secret redaction.

## Validation commands

```bash
bun test packages/git/src/changed-files.test.ts packages/git/src/git-path.test.ts
bun test packages/server/src/routes/git/checkout-gate.test.ts
bun test packages/server/src/routes/api.git-changes.test.ts
bun test packages/web/src/lib/api.git-changes.test.ts
bun test packages/web/src/components/workflows/source-control/
bun --filter @archon/git test
bun --filter @archon/web test
bun --filter @archon/server test
bun run type-check
bun run lint --max-warnings 0
bun run format:check
```

Optional if the server is running: `bun --filter @archon/web generate:types`.

Full repo gate before a PR, not required between tasks: `bun run validate`.
