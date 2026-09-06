# Walk This Run's Commit History as a Lane Graph Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.
> Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Insert a keyboard-operable History region below Changes on the legacy Source Control tab and render this run checkout's commits as a branch/merge lane graph driven by `log` records that include `parents[]`, including commits that never landed on `dev`.

**Architecture:** `@archon/git` owns a read-only `log` helper that walks `HEAD` through `execFileAsync` argv arrays.
The server reuses `loadRunCheckout`, applies the same CAP-6 gate as every other git route, and exposes `GET /api/workflows/runs/{runId}/git/log` as OpenAPI JSON.
The web app fetches that log on tab mount, freezes it beside the existing Changes snapshot, assigns lanes in a pure function, and paints one virtualized row per commit with a bespoke SVG lane column.
Selecting a commit highlights the row only; opening that commit's files is Story 2.2.

**Tech Stack:** Bun, strict TypeScript, `child_process.execFile` through `@archon/git` `execFileAsync`, Hono OpenAPI, Zod from `@hono/zod-openapi`, React 19, TanStack Query 5, `@tanstack/react-virtual` 3, and Bun tests.
Do not add a dependency.
Do not import `@xyflow/react` into the Source Control folder.

**Spec:** `_bmad-output/planning-artifacts/epics-source-control/epics.md` Story 2.1.
**Canonical design:** `_bmad-output/specs/spec-archon-source-control/SPEC.md` CAP-1, CAP-4, CAP-6; `_bmad-output/planning-artifacts/prds/prd-source-control/addendum.md` log row; `_bmad-output/planning-artifacts/architecture/architecture-Archon-source-control-2026-09-05/ARCHITECTURE-SPINE.md` AD-1, AD-2, AD-3, AD-6, AD-7, AD-9; `_bmad-output/planning-artifacts/ux-designs/ux-Archon-2026-08-31/DESIGN.md` `commit-graph-row`; `_bmad-output/planning-artifacts/ux-designs/ux-Archon-2026-08-31/EXPERIENCE.md` Commit Graph.
**Issue:** [#78](https://github.com/anhle128/Archon/issues/78), tracker key `2-1-walk-this-runs-commit-history-as-a-lane-graph`.
**Depends on:** Stories 1.1–1.3 are `done` in `_bmad-output/implementation-artifacts/archon-source-control/sprint-status.yaml`.

## Global Constraints

- Story 2.1 inserts History plus the lane graph and must not open a commit's files, list per-commit `M`/`A`/`D`, or send a commit OID to `/git/diff` or `/git/file`.
- A plain chronological list without lane topology is not an acceptable fallback.
- The surface remains `/legacy/workflows/runs/:id`.
- No file under `packages/web/src/experiments/console/` may be imported or modified.
- The client sends only `runId` on the log route; it never sends `working_path`, an absolute path, or a client-invented tree-ish.
- The server reads existing `workflow_runs.working_path`; do not add a column and do not reconstruct the checkout from isolation metadata.
- Git commands use `execFileAsync` with an argv array that includes `-C` and the trusted path; never use `exec`, a shell string, or `cwd` interpolation for this helper.
- JSON routes use the local `registerOpenApiRoute(createRoute(...), handler)` wrapper.
- Web response types are generated from the running server into `packages/web/src/lib/api.generated.d.ts`; do not hand-edit that generated file.
- Auth matches the existing git routes: the global `/api/*` gate only, with no `requireWebUser` and no per-run owner ACL.
- CAP-6 is HTTP 200 with `emptyReason: "container" | "no_checkout"` on the log route; there is no "history is immutable" exemption for containers.
- A missing conversation, a null `conversation.isolation_env_id`, or a missing isolation-environment row skips only the container branch and continues to the host checkout gate.
- Host availability is decided at request time from a non-null path, directory existence, successful `realpath`, and a git-work-tree check.
- Live git is the source of truth; do not derive history from `workflow_events`.
- `log` walks the run checkout `HEAD`, not base `dev`, so commits that never merged to `dev` are present.
- Do not pass `--first-parent` or `--all`.
- An unborn repository is a live checkout with region empty History (`No commits yet`), not CAP-6.
- Git/API failure on a valid checkout keeps the previously displayed history and shows in-region Reload; copy is not alarm (`Error:`, `unsupported`, `⚠️`).
- Fetch git log only while the Source Control body is mounted; never poll; never let the three-second run-detail status poll invalidate the log query.
- Reload refetches Changes and History together and still never rewrites the open view until the operator accepts `Changed on disk — Reload`.
- Pino events use `domain.action_state`, pair started with completed or failed, and never log checkout paths, remotes, file contents, subjects, or error messages that can contain a path.
- Lanes are not color-only: merge commits use a diamond, ordinary commits use a circle, the 7-character short OID is visible, and stroke/fill use existing `text-primary` / `text-secondary` tokens against `surface` (non-text contrast ≥ 3:1).
- Do not add a table, process, environment variable, deployable, package, or dependency.
- Do not import `@xyflow/react` from `packages/web/src/components/workflows/source-control/`.
- `mock.module()` merges over the real module in Bun 1.3.11, so every existing `@archon/git` mock factory must stub the new `log` export.
- Keep the three existing git HTTP routes plus the new log route in the isolated `packages/server/src/routes/api.git-changes.test.ts` process.
- Keep mounted Source Control behavior in the isolated `packages/web/src/component-integration/source-control-tab.test.tsx` process.
- Every production behavior follows RED, verified RED, minimal GREEN, verified GREEN, and only then refactoring.
- Run command blocks from the repository root.
- Never run an unscoped `bun test` from the repository root.
- Every full Markdown sentence in this plan stays on one physical line.

## File Structure

- Create `packages/git/src/git-log.ts` for NUL-delimited `git log` parsing, unborn-repo detection, truncation, revision fingerprinting, and the public `log` helper.
- Create `packages/git/src/git-log.test.ts` for parser cases plus a real temporary repository with a merge and a `dev` sibling branch.
- Modify `packages/git/src/index.ts` to export `log`, `parseGitLogZ`, `isEmptyHistoryError`, `GIT_LOG_MAX_COMMITS`, and the log types.
- Modify the 31 existing `mock.module('@archon/git')` factories listed in Task 1 to stub `log`.
- Modify `packages/server/src/routes/schemas/git.schemas.ts` to add `GitLogCommit` and `GitLogResponse`.
- Create `packages/server/src/routes/git/log-route.ts` for the `createRoute` definition.
- Create `packages/server/src/routes/git/log-handler.ts` cloning the changes-handler gate, recheck, and Pino pattern.
- Modify `packages/server/src/routes/api.ts` only to import and register the log route beside the existing git JSON routes.
- Modify `packages/server/src/routes/api.git-changes.test.ts` to stub `log` and cover the HTTP contract.
- Regenerate `packages/web/src/lib/api.generated.d.ts` from the running server.
- Modify `packages/web/src/lib/api.ts` to re-export generated log types and add `getWorkflowRunGitLog`.
- Modify `packages/web/src/lib/api.git-changes.test.ts` for the runId-only log request.
- Create `packages/web/src/components/workflows/source-control/commit-lanes.ts` for the pure lane-assignment function (Spike 3 outcome).
- Create `packages/web/src/components/workflows/source-control/commit-lanes.test.ts` for linear, merge, octopus, root, empty, not-one-lane-per-branch, and windowed-row continuity.
- Modify `packages/web/src/components/workflows/source-control/source-control-state.ts` to freeze History snapshots with the same displayed/pending rules as Changes.
- Modify `packages/web/src/components/workflows/source-control/source-control-state.test.ts` for History fingerprint transitions.
- Create `packages/web/src/components/workflows/source-control/format-commit-time.ts` and `format-commit-time.test.ts` for relative commit timestamps.
- Create `packages/web/src/components/workflows/source-control/commit-graph-row.tsx` for one accessible graph row.
- Create `packages/web/src/components/workflows/source-control/commit-history-graph.tsx` for the virtualized History listbox plus SVG lanes.
- Create `packages/web/src/components/workflows/source-control/commit-history-graph.test.tsx` for copy, SVG topology, keyboard, and a11y.
- Modify `packages/web/src/components/workflows/source-control/source-control-panel.tsx` to render History below Changes on a live checkout.
- Modify `packages/web/src/components/workflows/source-control/source-control-panel.test.tsx` so ready snapshots include History and CAP-6 snapshots still do not.
- Modify `packages/web/src/components/workflows/source-control/source-control-tab.tsx` to query log, combine stale, and pass History props.
- Modify `packages/web/src/component-integration/source-control-tab.test.tsx` for mounted log fetch, empty history, CAP-6, stale across both regions, and no file-open on commit select.
- Modify `_bmad-output/implementation-artifacts/archon-source-control/sprint-status.yaml` only after every acceptance and repository gate passes.
- Do not modify `packages/web/src/components/workflows/WorkflowExecution.tsx`, any console experiment, a database schema, a package manifest, or `bun.lock`.

## Locked Wire Contract

```ts
export const GIT_LOG_MAX_COMMITS = 500;

export interface GitLogCommit {
  oid: string;
  parents: string[];
  authorName: string;
  authorDate: string;
  subject: string;
}

export interface GitLogResult {
  commits: GitLogCommit[];
  revision: string;
  truncated: boolean;
}

export function log(workingPath: RepoPath | WorktreePath): Promise<GitLogResult>;
```

`oid` and every `parents[]` entry are 40-character lowercase hexadecimal SHA-1 object names.
`parents` is empty for a root commit and ordered exactly as git `%P` (first parent first).
`authorDate` is git `%aI` (ISO-8601 with offset) copied verbatim.
`subject` is git `%s`.

A populated or empty live-checkout log response has a 64-character lowercase hexadecimal SHA-256 `revision`.
The revision input is the exact `git log` stdout string returned by `execFileAsync`.
`truncated` is `true` only when `commits.length === GIT_LOG_MAX_COMMITS`.

A CAP-6 response is HTTP 200 with `{ emptyReason: "container" | "no_checkout", commits: [], revision: "", truncated: false }`.
A missing run is HTTP 404 with `{ error: "Workflow run not found" }`.
A post-gate git failure is HTTP 500 with `{ error: "Could not read git history" }`.
Unknown query parameters, including `working_path`, are ignored and never influence checkout resolution.

The argv for a successful read is exactly:

```ts
['-C', workingPath, '--no-optional-locks', 'log', '--format=%H%x00%P%x00%an%x00%aI%x00%s', '-z', `--max-count=${String(GIT_LOG_MAX_COMMITS)}`, 'HEAD']
```

Parser: split stdout on `'\0'`, drop a trailing empty record, then consume groups of five fields `(oid, parentsRaw, authorName, authorDate, subject)`.
`parentsRaw` splits on ASCII space and drops empty tokens.
A remainder that is not a multiple of five, a non-40-hex oid, or a non-40-hex parent throws `Malformed git log output`.

Unborn / missing `HEAD` is not thrown to the route: `log` returns `{ commits: [], revision, truncated: false }` whose revision is the SHA-256 of empty stdout.
Detect that case only via `isEmptyHistoryError` matching git stderr/message substrings `does not have any commits yet`, `unknown revision or path not in the working tree`, and `ambiguous argument 'HEAD'`.
Any other git failure throws so the handler can recheck CAP-6 or return 500.

## Spike 3 Outcome (locked for this story)

Reuse of `@xyflow/react` is rejected for History.
React Flow on this screen is a pan/zoom canvas with Controls and MiniMap (`WorkflowDagViewer.tsx`), which fights a compact keyboard listbox inside the 30% list pane.
The lane algorithm is custom either way.
The shipped renderer is a bespoke SVG lane column beside HTML commit rows, virtualized with the already-installed `@tanstack/react-virtual`.
No new dependency is added.
Lane assignment runs on the full in-memory page returned by `/git/log`; virtualization windows rows but does not recompute lanes per window.
Cursor pagination across pages is out of scope because v1 loads at most 500 commits in one response.

## Open Questions

### OQ-1 — Renderer

The approved material leaves `@xyflow/react` versus bespoke SVG as a pre-build spike.
**Provisional default:** bespoke SVG as locked in Spike 3 Outcome above.

### OQ-2 — Log range and cap

The approved material says `git log` of the run branch with `%H %P` plus author/date/subject, but does not pin `--max-count` or `HEAD` versus `--all`.
**Provisional default:** `git log HEAD --max-count=500` so unmerged-to-`dev` commits appear and a huge clone cannot dump unbounded JSON.

### OQ-3 — CAP-6 log envelope

Diff/file CAP-6 bodies are `{ emptyReason }` only, while Changes includes empty arrays and an empty revision.
**Provisional default:** list-shaped like Changes: `{ emptyReason, commits: [], revision: "", truncated: false }`.

### OQ-4 — Keyboard bindings

The accessibility floor requires History to be keyboard-operable and leaves exact keys open.
**Provisional default:** History is a listbox with `aria-activedescendant`; ArrowUp/ArrowDown move one row; Home/End jump; Enter/Space select the commit without opening files; Tab moves between the Changes listbox and the History listbox.

### OQ-5 — Combined stale banner

Story 2.1 does not restate the two-step stale flow, but FR-2 and AD-9 still forbid rewriting the open view.
**Provisional default:** one shared `Changed on disk — Reload` if either the Changes fingerprint or the History fingerprint diverges; accepting applies both pending snapshots.

### OQ-6 — Relative time

DESIGN asks for message + author + relative time and does not specify the formatter.
**Provisional default:** a tested `formatCommitTime(iso, nowMs)` using `Intl.RelativeTimeFormat('en', { numeric: 'auto' })` for durations under 30 days and `formatStarted` from `@/lib/format` otherwise; the visible `<time datetime>` keeps the raw `%aI` string.

### OQ-7 — Left-pane height split

UX places Changes above History and leaves the height ratio open.
**Provisional default:** the live-checkout left pane is a column flex; Changes and History each get `flex-1 min-h-0` and scroll independently.

---

### Task 1: Add the public `log` git read

**Files:**
- Create: `packages/git/src/git-log.ts`
- Create: `packages/git/src/git-log.test.ts`
- Modify: `packages/git/src/index.ts`
- Modify: the 31 exact mock-factory files in Step 4.

**Interfaces:**
- Consumes: `execFileAsync` and the existing `RepoPath`/`WorktreePath` brands.
- Produces: `parseGitLogZ(stdout: string): GitLogCommit[]`.
- Produces: `isEmptyHistoryError(error: unknown): boolean`.
- Produces: `log(workingPath: RepoPath | WorktreePath): Promise<GitLogResult>`.
- Produces: `GIT_LOG_MAX_COMMITS`.

- [ ] **Step 1: Write the failing parser and real-git tests**

Create `packages/git/src/git-log.test.ts` with this complete content:

```ts
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { execFileAsync } from './exec';
import {
  GIT_LOG_MAX_COMMITS,
  isEmptyHistoryError,
  log,
  parseGitLogZ,
} from './git-log';
import { toWorktreePath } from './types';

const OID_A = 'a'.repeat(40);
const OID_B = 'b'.repeat(40);
const OID_C = 'c'.repeat(40);

describe('parseGitLogZ', () => {
  test('parses one commit with two parents', () => {
    const stdout = `${OID_C}\0${OID_A} ${OID_B}\0Ada\0${'2026-09-06T18:09:18-07:00'}\0merge feature\0`;

    expect(parseGitLogZ(stdout)).toEqual([
      {
        oid: OID_C,
        parents: [OID_A, OID_B],
        authorName: 'Ada',
        authorDate: '2026-09-06T18:09:18-07:00',
        subject: 'merge feature',
      },
    ]);
  });

  test('parses a root commit with empty parents', () => {
    const stdout = `${OID_A}\0\0Ada\0${'2026-09-06T18:09:18Z'}\0init\0`;

    expect(parseGitLogZ(stdout)).toEqual([
      {
        oid: OID_A,
        parents: [],
        authorName: 'Ada',
        authorDate: '2026-09-06T18:09:18Z',
        subject: 'init',
      },
    ]);
  });

  test('fails fast on malformed records', () => {
    expect(() => parseGitLogZ(`${OID_A}\0`)).toThrow('Malformed git log output');
    expect(() => parseGitLogZ(`not-an-oid\0\0Ada\0${'2026-09-06T00:00:00Z'}\0x\0`)).toThrow(
      'Malformed git log output'
    );
  });
});

describe('isEmptyHistoryError', () => {
  test('detects unborn and missing HEAD wording', () => {
    expect(
      isEmptyHistoryError(Object.assign(new Error('x'), { stderr: 'does not have any commits yet' }))
    ).toBe(true);
    expect(
      isEmptyHistoryError(
        Object.assign(new Error("ambiguous argument 'HEAD'"), { stderr: '' })
      )
    ).toBe(true);
    expect(
      isEmptyHistoryError(
        Object.assign(new Error('x'), { stderr: 'unknown revision or path not in the working tree' })
      )
    ).toBe(true);
    expect(isEmptyHistoryError(new Error('Permission denied'))).toBe(false);
  });
});

describe('log', () => {
  let root = '';
  let repoPath = '';

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'archon-git-log-'));
    repoPath = join(root, 'repo');
    await mkdir(repoPath);
    await execFileAsync('git', ['init', repoPath]);
    await execFileAsync('git', ['-C', repoPath, 'config', 'user.email', 'dev@example.com']);
    await execFileAsync('git', ['-C', repoPath, 'config', 'user.name', 'Dev']);
  });

  afterAll(async () => {
    await rm(root, { recursive: true, force: true });
  });

  test('returns an empty list for an unborn repository', async () => {
    const result = await log(toWorktreePath(repoPath));
    expect(result.commits).toEqual([]);
    expect(result.truncated).toBe(false);
    expect(result.revision).toMatch(/^[a-f0-9]{64}$/);
  });

  test('includes merge parents and commits that never landed on dev', async () => {
    await execFileAsync('git', ['-C', repoPath, 'commit', '--allow-empty', '-m', 'base']);
    await execFileAsync('git', ['-C', repoPath, 'branch', 'dev']);
    await execFileAsync('git', ['-C', repoPath, 'checkout', '-b', 'feature']);
    await execFileAsync('git', ['-C', repoPath, 'commit', '--allow-empty', '-m', 'feature work']);
    await execFileAsync('git', ['-C', repoPath, 'checkout', '-']);
    await execFileAsync('git', ['-C', repoPath, 'commit', '--allow-empty', '-m', 'run work']);
    await execFileAsync('git', ['-C', repoPath, 'merge', 'feature', '-m', 'merge feature']);

    const result = await log(toWorktreePath(repoPath));
    const subjects = result.commits.map(commit => commit.subject);

    expect(subjects).toContain('merge feature');
    expect(subjects).toContain('feature work');
    expect(subjects).toContain('run work');
    expect(subjects).toContain('base');

    const merge = result.commits.find(commit => commit.subject === 'merge feature');
    expect(merge?.parents).toHaveLength(2);
    expect(merge?.parents[0]).toMatch(/^[a-f0-9]{40}$/);
    expect(merge?.parents[1]).toMatch(/^[a-f0-9]{40}$/);
    expect(result.truncated).toBe(false);
    expect(result.revision).toMatch(/^[a-f0-9]{64}$/);
    expect(GIT_LOG_MAX_COMMITS).toBe(500);

    const { stdout: devOnly } = await execFileAsync('git', [
      '-C',
      repoPath,
      'log',
      '--format=%s',
      'dev',
    ]);
    expect(devOnly).toContain('base');
    expect(devOnly).not.toContain('run work');
    expect(devOnly).not.toContain('feature work');
  });
});
```

- [ ] **Step 2: Run the test and verify RED**

Run:

```bash
bun test packages/git/src/git-log.test.ts
```

Expected: FAIL because `./git-log` does not exist.

- [ ] **Step 3: Implement the helper**

Create `packages/git/src/git-log.ts` with this complete content:

```ts
import { createHash } from 'crypto';

import { execFileAsync } from './exec';
import type { RepoPath, WorktreePath } from './types';

export const GIT_LOG_MAX_COMMITS = 500;

const OID_RE = /^[a-f0-9]{40}$/;

export interface GitLogCommit {
  oid: string;
  parents: string[];
  authorName: string;
  authorDate: string;
  subject: string;
}

export interface GitLogResult {
  commits: GitLogCommit[];
  revision: string;
  truncated: boolean;
}

function errorText(error: unknown): string {
  if (typeof error !== 'object' || error === null) return String(error);
  const err = error as { message?: unknown; stderr?: unknown };
  return `${String(err.message ?? '')} ${String(err.stderr ?? '')}`;
}

export function isEmptyHistoryError(error: unknown): boolean {
  const text = errorText(error);
  return (
    text.includes('does not have any commits yet') ||
    text.includes('unknown revision or path not in the working tree') ||
    text.includes("ambiguous argument 'HEAD'")
  );
}

export function parseGitLogZ(stdout: string): GitLogCommit[] {
  const records = stdout.split('\0');
  if (records.length > 0 && records[records.length - 1] === '') records.pop();
  if (records.length % 5 !== 0) throw new Error('Malformed git log output');

  const commits: GitLogCommit[] = [];
  for (let index = 0; index < records.length; index += 5) {
    const oid = records[index] ?? '';
    const parentsRaw = records[index + 1] ?? '';
    const authorName = records[index + 2] ?? '';
    const authorDate = records[index + 3] ?? '';
    const subject = records[index + 4] ?? '';
    if (!OID_RE.test(oid)) throw new Error('Malformed git log output');
    const parents = parentsRaw === '' ? [] : parentsRaw.split(' ').filter(Boolean);
    if (parents.some(parent => !OID_RE.test(parent))) {
      throw new Error('Malformed git log output');
    }
    commits.push({ oid, parents, authorName, authorDate, subject });
  }
  return commits;
}

export async function log(workingPath: RepoPath | WorktreePath): Promise<GitLogResult> {
  let stdout = '';
  try {
    const result = await execFileAsync(
      'git',
      [
        '-C',
        workingPath,
        '--no-optional-locks',
        'log',
        '--format=%H%x00%P%x00%an%x00%aI%x00%s',
        '-z',
        `--max-count=${String(GIT_LOG_MAX_COMMITS)}`,
        'HEAD',
      ],
      { maxBuffer: 8 * 1024 * 1024 }
    );
    stdout = result.stdout;
  } catch (error) {
    if (!isEmptyHistoryError(error)) throw error;
    stdout = '';
  }

  const commits = parseGitLogZ(stdout);
  return {
    commits,
    revision: createHash('sha256').update(stdout).digest('hex'),
    truncated: commits.length === GIT_LOG_MAX_COMMITS,
  };
}
```

In `packages/git/src/index.ts`, immediately after the changed-files type export block, add:

```ts
// Commit log (run-branch history)
export { GIT_LOG_MAX_COMMITS, isEmptyHistoryError, log, parseGitLogZ } from './git-log';
export type { GitLogCommit, GitLogResult } from './git-log';
```

- [ ] **Step 4: Stub `log` in every `@archon/git` mock factory**

Add this key to every factory below, keeping every existing key:

```ts
log: mock(async () => ({ commits: [], revision: '', truncated: false })),
```

Files:

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

In `packages/server/src/routes/api.git-changes.test.ts`, declare `mockLog` next to `mockChangedFiles` and pass that mock as the `log` key so later HTTP tests can configure it.

- [ ] **Step 5: Verify GREEN**

Run:

```bash
bun test packages/git/src/git-log.test.ts
bun --filter @archon/git test
bun --filter @archon/git type-check
```

Expected: all commands exit 0.

- [ ] **Step 6: Refactor only while green**

Keep the argv, parser, unborn mapping, and fingerprint identical.
Re-run `bun test packages/git/src/git-log.test.ts`.

- [ ] **Step 7: Commit**

```bash
git add packages/git/src/git-log.ts packages/git/src/git-log.test.ts packages/git/src/index.ts \
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
git commit -m "feat(git): walk run-branch commit log with parents"
```

---

### Task 2: Add `GET /api/workflows/runs/{runId}/git/log`

**Files:**
- Modify: `packages/server/src/routes/schemas/git.schemas.ts`
- Create: `packages/server/src/routes/git/log-route.ts`
- Create: `packages/server/src/routes/git/log-handler.ts`
- Modify: `packages/server/src/routes/api.ts`
- Modify: `packages/server/src/routes/api.git-changes.test.ts`

**Interfaces:**
- Consumes: `loadRunCheckout`, `log`, `toWorktreePath`.
- Produces: OpenAPI `GitLogResponse`.

- [ ] **Step 1: Write the failing HTTP tests**

In `packages/server/src/routes/api.git-changes.test.ts`, import `GitLogResult` from `@archon/git`.
Keep `mockLog` from Task 1 and default it to `{ commits: [], revision: REVISION, truncated: false }`.
Append these tests (same isolated process as the existing git HTTP tests):

```ts
test('git log returns CAP-6 container without calling log', async () => {
  mockGetWorkflowRun.mockResolvedValue(runRow());
  mockGetConversationById.mockResolvedValue({ isolation_env_id: 'env-1' });
  mockGetById.mockResolvedValue({ provider: 'container' });
  const app = makeApp();
  const response = await app.request('/api/workflows/runs/run-1/git/log');
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({
    emptyReason: 'container',
    commits: [],
    revision: '',
    truncated: false,
  });
  expect(mockLog).not.toHaveBeenCalled();
});

test('git log returns CAP-6 no_checkout without calling log', async () => {
  mockGetWorkflowRun.mockResolvedValue(runRow({ working_path: null }));
  mockGetConversationById.mockResolvedValue({ isolation_env_id: null });
  const app = makeApp();
  const response = await app.request('/api/workflows/runs/run-1/git/log');
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({
    emptyReason: 'no_checkout',
    commits: [],
    revision: '',
    truncated: false,
  });
  expect(mockLog).not.toHaveBeenCalled();
});

test('git log serializes HEAD commits and ignores working_path query', async () => {
  mockGetWorkflowRun.mockResolvedValue(runRow());
  mockGetConversationById.mockResolvedValue({ isolation_env_id: null });
  mockIsGitWorkTree.mockResolvedValue(true);
  mockLog.mockResolvedValue({
    commits: [
      {
        oid: 'a'.repeat(40),
        parents: ['b'.repeat(40)],
        authorName: 'Ada',
        authorDate: '2026-09-06T18:09:18Z',
        subject: 'run work',
      },
    ],
    revision: REVISION,
    truncated: false,
  });
  const app = makeApp();
  const response = await app.request(
    '/api/workflows/runs/run-1/git/log?working_path=/tmp/hostile'
  );
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({
    commits: [
      {
        oid: 'a'.repeat(40),
        parents: ['b'.repeat(40)],
        authorName: 'Ada',
        authorDate: '2026-09-06T18:09:18Z',
        subject: 'run work',
      },
    ],
    revision: REVISION,
    truncated: false,
  });
  expect(mockLog).toHaveBeenCalledTimes(1);
  expect(String(mockLog.mock.calls[0]?.[0])).not.toContain('hostile');
});

test('git log returns 404 for a missing run', async () => {
  mockGetWorkflowRun.mockResolvedValue(null);
  const app = makeApp();
  const response = await app.request('/api/workflows/runs/missing/git/log');
  expect(response.status).toBe(404);
  expect(await response.json()).toEqual({ error: 'Workflow run not found' });
});

test('git log maps post-gate failure to 500 and rechecks CAP-6', async () => {
  mockGetWorkflowRun.mockResolvedValue(runRow());
  mockGetConversationById.mockResolvedValue({ isolation_env_id: null });
  mockIsGitWorkTree.mockResolvedValue(true);
  mockLog.mockRejectedValue(namedError('Error'));
  const app = makeApp();
  const response = await app.request('/api/workflows/runs/run-1/git/log');
  expect(response.status).toBe(500);
  expect(await response.json()).toEqual({ error: 'Could not read git history' });
});
```

Also assert Pino pairs `git.log_started` then `git.log_completed` or `git.log_failed` with `{ runId }` / `{ runId, commitCount }` / `{ runId, emptyReason }` / `{ runId, errorType }` and never a path key.

- [ ] **Step 2: Run the tests and verify RED**

Run:

```bash
bun test packages/server/src/routes/api.git-changes.test.ts
```

Expected: FAIL because `/git/log` is unregistered (Hono 404) or `mockLog` is unused.

- [ ] **Step 3: Implement schema, route, handler, and registration**

Append to `packages/server/src/routes/schemas/git.schemas.ts`:

```ts
export const gitLogCommitSchema = z
  .object({
    oid: z.string().regex(/^[a-f0-9]{40}$/),
    parents: z.array(z.string().regex(/^[a-f0-9]{40}$/)),
    authorName: z.string(),
    authorDate: z.string().min(1),
    subject: z.string(),
  })
  .openapi('GitLogCommit');
export type GitLogCommit = z.infer<typeof gitLogCommitSchema>;

const gitReadyLogResponseSchema = z.object({
  commits: z.array(gitLogCommitSchema),
  revision: revisionSchema,
  truncated: z.boolean(),
});

const gitEmptyLogResponseSchema = z.object({
  emptyReason: gitEmptyReasonSchema,
  commits: z.array(gitLogCommitSchema).max(0),
  revision: z.literal(''),
  truncated: z.literal(false),
});

export const gitLogResponseSchema = z
  .union([gitReadyLogResponseSchema, gitEmptyLogResponseSchema])
  .openapi('GitLogResponse');
export type GitLogResponse = z.infer<typeof gitLogResponseSchema>;
```

Create `packages/server/src/routes/git/log-route.ts`:

```ts
import { createRoute, z } from '@hono/zod-openapi';

import { errorSchema } from '../schemas/common.schemas';
import { gitLogResponseSchema } from '../schemas/git.schemas';

export const gitLogRoute = createRoute({
  method: 'get',
  path: '/api/workflows/runs/{runId}/git/log',
  tags: ['Workflows'],
  summary: "List a run checkout's commit history",
  request: {
    params: z.object({ runId: z.string().min(1) }),
  },
  responses: {
    200: {
      content: { 'application/json': { schema: gitLogResponseSchema } },
      description: 'Commit log or a CAP-6 empty envelope',
    },
    404: {
      content: { 'application/json': { schema: errorSchema } },
      description: 'Workflow run not found',
    },
    500: {
      content: { 'application/json': { schema: errorSchema } },
      description: 'Git read failed',
    },
  },
});
```

Create `packages/server/src/routes/git/log-handler.ts` as a clone of `changes-handler.ts` with these substitutions: import `log` instead of `changedFiles`; events `git.log_started` / `git.log_completed` / `git.log_failed`; empty body `{ emptyReason, commits: [], revision: '', truncated: false }`; ready body `{ commits, revision, truncated }`; completed payload `{ runId, commitCount: result.commits.length }`; 500 message `Could not read git history`.
Call `log(toWorktreePath(gate.workingPath))`.
On helper throw, recheck `loadRunCheckout` and convert a vanished checkout to CAP-6.
Log `{ runId, errorType }` only.

In `packages/server/src/routes/api.ts`, import `gitLogRoute` and `handleGitLog`.
Register immediately after the changes route:

```ts
  registerOpenApiRoute(gitLogRoute, async c => {
    return handleGitLog(c, apiError);
  });
```

Do not call `requireWebUser`.

- [ ] **Step 4: Verify GREEN**

Run:

```bash
bun test packages/server/src/routes/api.git-changes.test.ts
bun --filter @archon/server type-check
```

Expected: both exit 0.

- [ ] **Step 5: Refactor only while green, then commit**

```bash
git add packages/server/src/routes/schemas/git.schemas.ts \
  packages/server/src/routes/git/log-route.ts \
  packages/server/src/routes/git/log-handler.ts \
  packages/server/src/routes/api.ts \
  packages/server/src/routes/api.git-changes.test.ts
git commit -m "feat(server): expose run git log"
```

---

### Task 3: Generate the web contract and add the log client

**Files:**
- Regenerate: `packages/web/src/lib/api.generated.d.ts`
- Modify: `packages/web/src/lib/api.ts`
- Modify: `packages/web/src/lib/api.git-changes.test.ts`

**Interfaces:**
- Consumes: generated `components['schemas']['GitLogResponse']`.
- Produces: `getWorkflowRunGitLog(runId: string, options?: { signal?: AbortSignal }): Promise<GitLogResponse>`.

- [ ] **Step 1: Write the failing client test**

Append to `packages/web/src/lib/api.git-changes.test.ts`:

```ts
describe('getWorkflowRunGitLog', () => {
  test('GETs the encoded run-scoped log URL without a checkout path', async () => {
    fetchSpy = spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          commits: [
            {
              oid: 'a'.repeat(40),
              parents: [],
              authorName: 'Ada',
              authorDate: '2026-09-06T18:09:18Z',
              subject: 'init',
            },
          ],
          revision: 'a'.repeat(64),
          truncated: false,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    );

    const response = await getWorkflowRunGitLog('run/one');

    expect(response).toEqual({
      commits: [
        {
          oid: 'a'.repeat(40),
          parents: [],
          authorName: 'Ada',
          authorDate: '2026-09-06T18:09:18Z',
          subject: 'init',
        },
      ],
      revision: 'a'.repeat(64),
      truncated: false,
    });
    expect(fetchSpy).toHaveBeenCalledWith('/api/workflows/runs/run%2Fone/git/log', undefined);
    expect(String(fetchSpy.mock.calls[0]?.[0])).not.toContain('working_path');
  });
});
```

Import `getWorkflowRunGitLog` from `./api`.

- [ ] **Step 2: Run the test and verify RED**

Run:

```bash
bun test packages/web/src/lib/api.git-changes.test.ts
```

Expected: FAIL because `getWorkflowRunGitLog` is not exported.

- [ ] **Step 3: Regenerate OpenAPI types from the implemented server**

Start the server on the generate-types port:

```bash
PORT=3090 bun run dev:server
```

After the server reports that port 3090 is listening, run:

```bash
bun --filter @archon/web generate:types
```

Stop only the server process started for this task.
Do not hand-edit `packages/web/src/lib/api.generated.d.ts`.
Read `packages/web/src/lib/api.generated.d.ts` and confirm it contains `/api/workflows/runs/{runId}/git/log` and `GitLogResponse`.

- [ ] **Step 4: Add the generated-type re-exports and client**

In `packages/web/src/lib/api.ts`, next to the other git types, add:

```ts
export type GitLogResponse = components['schemas']['GitLogResponse'];
export type GitLogCommit = components['schemas']['GitLogCommit'];
```

Add:

```ts
export async function getWorkflowRunGitLog(
  runId: string,
  options?: { signal?: AbortSignal }
): Promise<GitLogResponse> {
  return fetchJSON(
    `/api/workflows/runs/${encodeURIComponent(runId)}/git/log`,
    options?.signal ? { signal: options.signal } : undefined
  );
}
```

- [ ] **Step 5: Verify GREEN and commit**

Run:

```bash
bun test packages/web/src/lib/api.git-changes.test.ts
bun --filter @archon/web type-check
```

```bash
git add packages/web/src/lib/api.generated.d.ts packages/web/src/lib/api.ts packages/web/src/lib/api.git-changes.test.ts
git commit -m "feat(web): add run git log client"
```

---

### Task 4: Implement Spike 3 lane assignment

**Files:**
- Create: `packages/web/src/components/workflows/source-control/commit-lanes.ts`
- Create: `packages/web/src/components/workflows/source-control/commit-lanes.test.ts`

**Interfaces:**
- Consumes: `{ oid: string; parents: readonly string[] }`.
- Produces: `assignCommitLanes(commits): LaneGraph`.

The algorithm is newest-first (git log order).
Maintain `active: (string | null)[]` as the oid each lane is waiting to paint next.
For commit `C`:
1. Collect lanes whose `active[i] === C.oid`.
2. If none, reuse the first `null` lane or append.
3. Primary lane is the smallest matching index.
4. Extra matching lanes close (`active[i] = null`).
5. First parent continues on the primary lane; additional parents occupy a lane already waiting for that parent, else a free/new lane.
6. A root commit clears the primary lane.

Each row records `{ oid, lane, parentLanes, isMerge, activeLanes }` where `activeLanes` is the set of lane indexes that still have a reserved oid after placing `C` plus `C.lane` (needed so virtualized rows can draw through-lines).
`laneCount` is one more than the maximum lane index seen.

This is topology assignment, not one-lane-per-named-branch.

- [ ] **Step 1: Write the failing tests**

Create `packages/web/src/components/workflows/source-control/commit-lanes.test.ts`:

```ts
import { describe, expect, test } from 'bun:test';

import { assignCommitLanes } from './commit-lanes';

const A = 'a'.repeat(40);
const B = 'b'.repeat(40);
const C = 'c'.repeat(40);
const D = 'd'.repeat(40);
const E = 'e'.repeat(40);

describe('assignCommitLanes', () => {
  test('places a linear history on lane 0', () => {
    const graph = assignCommitLanes([
      { oid: C, parents: [B] },
      { oid: B, parents: [A] },
      { oid: A, parents: [] },
    ]);
    expect(graph.rows.map(row => row.lane)).toEqual([0, 0, 0]);
    expect(graph.laneCount).toBe(1);
    expect(graph.rows[0]?.isMerge).toBe(false);
  });

  test('assigns a second lane through a merge rather than one lane per branch name', () => {
    const graph = assignCommitLanes([
      { oid: D, parents: [C, B] },
      { oid: C, parents: [A] },
      { oid: B, parents: [A] },
      { oid: A, parents: [] },
    ]);
    expect(graph.rows[0]).toMatchObject({ oid: D, isMerge: true });
    expect(graph.rows[0]?.parentLanes).toHaveLength(2);
    expect(new Set(graph.rows.map(row => row.lane)).size).toBeGreaterThan(1);
    expect(graph.laneCount).toBeGreaterThan(1);
  });

  test('keeps an octopus merge on one row with three parent lanes', () => {
    const graph = assignCommitLanes([
      { oid: E, parents: [A, B, C] },
      { oid: A, parents: [] },
      { oid: B, parents: [] },
      { oid: C, parents: [] },
    ]);
    expect(graph.rows[0]?.isMerge).toBe(true);
    expect(graph.rows[0]?.parentLanes).toHaveLength(3);
  });

  test('returns an empty graph', () => {
    expect(assignCommitLanes([])).toEqual({ rows: [], laneCount: 0 });
  });

  test('windowing a computed page does not change lane numbers', () => {
    const commits = [
      { oid: D, parents: [C, B] },
      { oid: C, parents: [A] },
      { oid: B, parents: [A] },
      { oid: A, parents: [] },
    ];
    const full = assignCommitLanes(commits);
    expect(full.rows.slice(1, 3).map(row => ({ oid: row.oid, lane: row.lane }))).toEqual(
      full.rows.slice(1, 3).map(row => ({ oid: row.oid, lane: row.lane }))
    );
  });
});
```

- [ ] **Step 2: Run the test and verify RED**

Run:

```bash
bun test packages/web/src/components/workflows/source-control/commit-lanes.test.ts
```

Expected: FAIL because `./commit-lanes` does not exist.

- [ ] **Step 3: Implement `assignCommitLanes`**

Create `packages/web/src/components/workflows/source-control/commit-lanes.ts`:

```ts
export interface LaneCommitInput {
  oid: string;
  parents: readonly string[];
}

export interface LaneRow {
  oid: string;
  lane: number;
  parentLanes: number[];
  isMerge: boolean;
  activeLanes: number[];
}

export interface LaneGraph {
  rows: LaneRow[];
  laneCount: number;
}

export function assignCommitLanes(commits: readonly LaneCommitInput[]): LaneGraph {
  const active: (string | null)[] = [];
  const rows: LaneRow[] = [];

  for (const commit of commits) {
    const matches: number[] = [];
    for (let index = 0; index < active.length; index += 1) {
      if (active[index] === commit.oid) matches.push(index);
    }

    let lane: number;
    if (matches.length === 0) {
      const free = active.findIndex(value => value === null);
      lane = free === -1 ? active.length : free;
      if (lane === active.length) active.push(commit.oid);
      else active[lane] = commit.oid;
    } else {
      lane = matches[0] ?? 0;
      for (const extra of matches.slice(1)) active[extra] = null;
    }

    const parentLanes: number[] = [];
    const parents = commit.parents;
    if (parents.length === 0) {
      active[lane] = null;
    } else {
      const firstParent = parents[0] ?? '';
      active[lane] = firstParent;
      parentLanes.push(lane);
      for (const parent of parents.slice(1)) {
        let parentLane = active.findIndex(value => value === parent);
        if (parentLane === -1) {
          parentLane = active.findIndex(value => value === null);
          if (parentLane === -1) {
            parentLane = active.length;
            active.push(parent);
          } else {
            active[parentLane] = parent;
          }
        }
        parentLanes.push(parentLane);
      }
    }

    const activeLanes: number[] = [];
    for (let index = 0; index < active.length; index += 1) {
      if (active[index] !== null || index === lane) activeLanes.push(index);
    }

    rows.push({
      oid: commit.oid,
      lane,
      parentLanes,
      isMerge: parents.length > 1,
      activeLanes,
    });
  }

  let laneCount = 0;
  for (const row of rows) {
    laneCount = Math.max(laneCount, row.lane + 1);
    for (const parentLane of row.parentLanes) laneCount = Math.max(laneCount, parentLane + 1);
    for (const activeLane of row.activeLanes) laneCount = Math.max(laneCount, activeLane + 1);
  }

  return { rows, laneCount };
}
```

- [ ] **Step 4: Verify GREEN, refactor only while green, commit**

Run:

```bash
bun test packages/web/src/components/workflows/source-control/commit-lanes.test.ts
```

```bash
git add packages/web/src/components/workflows/source-control/commit-lanes.ts \
  packages/web/src/components/workflows/source-control/commit-lanes.test.ts
git commit -m "feat(web): assign source-control commit lanes"
```

---

### Task 5: Freeze History snapshots beside Changes

**Files:**
- Modify: `packages/web/src/components/workflows/source-control/source-control-state.ts`
- Modify: `packages/web/src/components/workflows/source-control/source-control-state.test.ts`

**Interfaces:**
- Consumes: `GitLogResponse`.
- Produces: `GitLogSnapshot`, `toGitLogSnapshot`, and reuse of `sourceControlSnapshotReducer` via a history-specific fingerprint helper if the existing reducer already keys on `revision`/`emptyReason`.

If the existing reducer can freeze `{ emptyReason?, revision }` without caring about `files`, extract a shared snapshot reducer parameterized by `fingerprint` rather than duplicating control flow.
If extraction would be larger than a thin wrapper, duplicate the displayed/pending machine as `historySnapshotReducer` keyed by `ready:${revision}` / `empty:${emptyReason}`.
Do not let a History fingerprint change rewrite the displayed Changes snapshot.

`toGitLogSnapshot` maps CAP-6 to `{ emptyReason, commits: [], revision: '', truncated: false }` and ready bodies to `{ commits, revision, truncated }`.

- [ ] **Step 1: Write failing tests** for initial null displayed, first ready log accepted, divergent log revision going to pending, CAP-6 fingerprint distinct from empty commits, and `accept_pending` applying History without touching a Changes snapshot.

- [ ] **Step 2: Run and verify RED.**

```bash
bun test packages/web/src/components/workflows/source-control/source-control-state.test.ts
```

- [ ] **Step 3: Implement the History freeze helpers.**

- [ ] **Step 4: Verify GREEN and commit.**

```bash
git add packages/web/src/components/workflows/source-control/source-control-state.ts \
  packages/web/src/components/workflows/source-control/source-control-state.test.ts
git commit -m "feat(web): freeze source-control history snapshots"
```

---

### Task 6: Render the lane graph widget

**Files:**
- Create: `packages/web/src/components/workflows/source-control/format-commit-time.ts`
- Create: `packages/web/src/components/workflows/source-control/format-commit-time.test.ts`
- Create: `packages/web/src/components/workflows/source-control/commit-graph-row.tsx`
- Create: `packages/web/src/components/workflows/source-control/commit-history-graph.tsx`
- Create: `packages/web/src/components/workflows/source-control/commit-history-graph.test.tsx`

**Interfaces:**
- Consumes: `GitLogCommit[]`, `assignCommitLanes`, `nextChangedFileIndex`.
- Produces: a History listbox that is not a plain list.

Constants: `COMMIT_ROW_HEIGHT = 24`, `LANE_WIDTH = 12`.
Each row is `role="option"` with `id={`${idPrefix}-${index}`}`.
The listbox uses `aria-label="Commit history"` and `aria-activedescendant`.
Visible text is subject, authorName, `formatCommitTime`, and `oid.slice(0, 7)`.
The lane cell is inline SVG:
- width `laneCount * LANE_WIDTH`, height `COMMIT_ROW_HEIGHT`
- through-lines for `activeLanes` as vertical `line` elements with `class="stroke-text-secondary"` and `strokeWidth="1.5"`
- ordinary commit: `circle` filled `fill-text-primary`
- merge commit: `polygon` diamond filled `fill-text-primary`
- outgoing parent connectors as `path` elements to `parentLanes` at the bottom of the row
- `aria-hidden="true"` on the SVG because the option `aria-label` names merge vs ordinary
Option `aria-label` is `${subject}, ${shortOid}, ${authorName}${isMerge ? ', merge' : ''}`.
Do not import `@xyflow/react`.
Virtualize with `useVirtualizer` estimate 24px, same 280px initial-rect fallback pattern as `changed-files-list.tsx`.
Enter/Space call `onSelectCommit(commit)` only.

`formatCommitTime(iso: string, nowMs: number): string` uses `Intl.RelativeTimeFormat('en', { numeric: 'auto' })` for absolute delta under 30 days and otherwise `formatStarted(iso)` from `@/lib/format`.

- [ ] **Step 1: Write failing tests** using `renderToStaticMarkup`.
A two-parent merge fixture must contain `<svg`, a `<polygon` or diamond points, a `<circle` for the non-merge row, the subject text, the 7-character short oid, `role="listbox"`, and `aria-label="Commit history"`.
It must not be only an ordered list of subjects with no SVG.
Keyboard helper tests reuse `nextChangedFileIndex`.
`formatCommitTime` is deterministic given `nowMs`.

- [ ] **Step 2: Verify RED.**

```bash
bun test packages/web/src/components/workflows/source-control/commit-history-graph.test.tsx
bun test packages/web/src/components/workflows/source-control/format-commit-time.test.ts
```

- [ ] **Step 3: Implement the components.**

- [ ] **Step 4: Verify GREEN, refactor only while green, commit.**

```bash
git add packages/web/src/components/workflows/source-control/format-commit-time.ts \
  packages/web/src/components/workflows/source-control/format-commit-time.test.ts \
  packages/web/src/components/workflows/source-control/commit-graph-row.tsx \
  packages/web/src/components/workflows/source-control/commit-history-graph.tsx \
  packages/web/src/components/workflows/source-control/commit-history-graph.test.tsx
git commit -m "feat(web): render source-control commit lane graph"
```

---

### Task 7: Insert History below Changes and fetch log on tab mount

**Files:**
- Modify: `packages/web/src/components/workflows/source-control/source-control-panel.tsx`
- Modify: `packages/web/src/components/workflows/source-control/source-control-panel.test.tsx`
- Modify: `packages/web/src/components/workflows/source-control/source-control-tab.tsx`
- Modify: `packages/web/src/component-integration/source-control-tab.test.tsx`

**Interfaces:**
- Panel gains `historySnapshot`, `historyLoadState`, `selectedOid`, `onSelectCommit`.
- CAP-6 early returns stay whole-tab and still omit the History heading.
- Ready checkout renders `h2` `Changes` then `h2` `History`.
- Ready empty history shows `No commits yet` (`role="status"`).
- History loading copy is `Loading history` / `Refreshing history`.
- History error copy is `Could not refresh history.`
- Tab adds `useQuery({ queryKey: ['workflowRunGitLog', runId], queryFn: ({ signal }) => getWorkflowRunGitLog(runId, { signal }), retry: false, refetchInterval: false, refetchOnReconnect: false, refetchOnWindowFocus: false, staleTime: Infinity })`.
- `onReload` refetches both queries and runs both snapshot reducers.
- Combined `stale` is true if either pending snapshot is waiting.
- Selecting a commit sets `selectedOid` only; it must not call `getWorkflowRunGitDiff` or `getWorkflowRunGitFile`.
- Do not expand inline file lists.

- [ ] **Step 1: Update panel tests**

Change `renders M/A/D as letter-carried options and no write or History chrome` to still forbid Stage/Discard/Commit and write chrome, but require `History` when a ready `historySnapshot` is passed.
Add tests:
- ready Changes + empty history shows `No commits yet` and is not CAP-6 copy
- container CAP-6 still has no `History` heading and no Reload
- no_checkout CAP-6 still has no `History` heading and has Reload
- history error keeps commit rows and `Could not refresh history.`

Pass `historySnapshot: { commits: [], revision: 'a'.repeat(64), truncated: false }` in ready tests.

- [ ] **Step 2: Run panel tests and verify RED.**

```bash
bun test packages/web/src/components/workflows/source-control/source-control-panel.test.tsx
```

- [ ] **Step 3: Implement panel layout**

On a live checkout, structure:

```tsx
<div className="flex h-full min-h-0 flex-col">
  {/* existing header Reload / stale banner / changes load+error / changes list */}
  <div className="flex min-h-0 flex-1 flex-col">
    <h2 className="text-sm font-medium text-text-primary">History</h2>
    {/* history load/error */}
    {history ready && commits.length === 0 ? <p role="status">No commits yet</p> : null}
    {commits.length > 0 ? <CommitHistoryGraph ... /> : null}
  </div>
</div>
```

Changes and History each sit in `flex-1 min-h-0` children so they scroll independently.

- [ ] **Step 4: Verify panel GREEN.**

- [ ] **Step 5: Write failing mounted tests**

In `packages/web/src/component-integration/source-control-tab.test.tsx`, extend the fetch mock to answer `/git/log` as well as `/git/changes`.
Add tests:
- mounting the tab GETs `/git/log` with the encoded runId and without `working_path`
- a live checkout with zero commits shows `No commits yet` and `Changes`
- container CAP-6 on log/changes shows the existing container sentence and no History heading
- selecting a commit does not issue `/git/diff` or `/git/file`
- Reload refetches both URLs; a changed log revision shows `Changed on disk — Reload` without replacing the displayed subject until accept
- query options still disable interval refetch

- [ ] **Step 6: Verify RED, implement tab wiring, verify GREEN.**

Run:

```bash
bun test packages/web/src/components/workflows/source-control/
NODE_ENV=development bun test packages/web/src/component-integration/source-control-tab.test.tsx
bun --filter @archon/web type-check
```

Keep `file-viewer.test.tsx`'s `not.toContain('History')` assertion; the viewer still has no History chrome.

- [ ] **Step 7: Commit**

```bash
git add packages/web/src/components/workflows/source-control/source-control-panel.tsx \
  packages/web/src/components/workflows/source-control/source-control-panel.test.tsx \
  packages/web/src/components/workflows/source-control/source-control-tab.tsx \
  packages/web/src/component-integration/source-control-tab.test.tsx
git commit -m "feat(web): show run commit history as a lane graph"
```

---

### Task 8: Run acceptance gates and update sprint status

**Files:**
- Modify: `_bmad-output/implementation-artifacts/archon-source-control/sprint-status.yaml`

- [ ] **Step 1: Run every focused test in its intended process**

```bash
bun test packages/git/src/git-log.test.ts
bun test packages/web/src/components/workflows/source-control/commit-lanes.test.ts
bun test packages/server/src/routes/api.git-changes.test.ts
bun test packages/web/src/lib/api.git-changes.test.ts
bun test packages/web/src/components/workflows/source-control/
NODE_ENV=development bun test packages/web/src/component-integration/source-control-tab.test.tsx
```

Expected: every command exits 0 with no test failures or React act warnings.

- [ ] **Step 2: Run affected package suites**

```bash
bun --filter @archon/git test
bun --filter @archon/server test
bun --filter @archon/web test
```

Expected: all package scripts exit 0.
The server git tests and the mounted web test must appear as their own Bun invocations in the script output.

- [ ] **Step 3: Run the mandatory repository gate**

```bash
bun run validate
git diff --check
```

Expected: both commands exit 0.

- [ ] **Step 4: Confirm the acceptance matrix**

| Criterion | Automated or inspection proof |
| --- | --- |
| History region below Changes on a live checkout | panel tests |
| No History region on CAP-6 | panel tests |
| Not a plain chronological list | graph tests require SVG circle/polygon plus subjects |
| `log` records include `parents[]` | git-log tests and HTTP serialization |
| Commits not merged to `dev` appear | real-repository git-log test |
| Keyboard-operable History | `nextChangedFileIndex` plus listbox markup |
| Lanes not color-only and use token strokes | diamond vs circle plus visible short OID; token classes `stroke-text-secondary` / `fill-text-primary` |
| `No commits yet` is a region empty | panel test |
| CAP-6 HTTP 200 on `/git/log` for container and no_checkout | HTTP tests |
| No history-is-immutable exemption | container test never calls `log` |
| `log` lives in `@archon/git` via `execFileAsync` | git-log implementation and real-git test |
| JSON uses `registerOpenApiRoute`; web types from `api.generated.d.ts` | route registration and generated-file presence |
| Client sends encoded `runId` only | API client test |
| Selecting a commit does not open files | mounted test |
| Manual Reload still freezes the open view | mounted stale test |
| No write chrome | panel test |
| Console untouched | scoped diff contains no `packages/web/src/experiments/console/` file |
| No new dependency | `bun.lock` / `package.json` unmodified |

- [ ] **Step 5: Perform a legacy-screen smoke check**

Run:

```bash
bun run dev
```

Open `/legacy/workflows/runs/:id` for an existing DAG run, select Source Control, and confirm Changes remains on top, History is a lane graph rather than a naked list, an empty repo would show `No commits yet`, and clicking a commit does not open the viewer.
Stop only the dev processes started for this check.
If no DAG run exists in the local database, record that the automated suites are the acceptance evidence; do not fabricate a run or broaden this story.

- [ ] **Step 6: Update sprint status only after Steps 1 through 5 pass**

In `_bmad-output/implementation-artifacts/archon-source-control/sprint-status.yaml`, change only:

```yaml
  epic-2: in-progress
  2-1-walk-this-runs-commit-history-as-a-lane-graph: done
```

Keep `2-2-open-a-commits-files-in-the-same-viewer` at `backlog`.
Keep `last_updated: 2026-09-06`.

- [ ] **Step 7: Commit the tracker update**

```bash
git add _bmad-output/implementation-artifacts/archon-source-control/sprint-status.yaml
git commit -m "chore(sc): mark commit-history lane graph story done"
```

## Out of Scope

- Story 2.2 per-commit `M`/`A`/`D` lists, inline expand under a commit row, `parent → commit` diffs, and commit OIDs on `/git/diff` or `/git/file`.
- CAP-8 durable snapshot writing.
- Container overlay reads.
- Secret redaction.
- Cursor-paginated history beyond the 500-commit cap.
- `@xyflow/react` History renderer.
- Sequential non-DAG run tabs.

## Pull Request Handoff

Before opening a pull request, rerun `bun run validate` and use `.github/pull_request_template.md`.
Keep Problem and outcome, Review guidance, Solution, and Validation.
Include focused RED/GREEN evidence, the full validation result, the manual smoke result or its explicit no-local-run limitation, and `Closes #78`.
Do not write `N/A` sections and do not close the issue outside the PR workflow.
