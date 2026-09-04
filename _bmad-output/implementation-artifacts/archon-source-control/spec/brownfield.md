# Brownfield notes — existing Archon code + runtime that constrains this feature

Load-bearing facts gathered from the Archon codebase and a live run on the remote host. Every item here bends a build decision in SPEC.md; cited by name from Constraints.

## Path pinning (which worktree to read)

- A run binds to exactly **one** `codebase_id` and **one** checkout `working_path` (nullable). Both are persisted on the run row and exposed at `GET /api/workflows/runs/{runId}`; the web UI already reads `workingPath` (`WorkflowExecution.tsx:344`).
- Read must be pinned to `run.working_path` + `codebase_id` — never a guessed repo root.
- `working_path` is written to the run's cwd by `executeWorkflow` (`executor.ts:1398-1404`); folder projects run in-place at `workingCwd` (`workflow.ts:1970-1977`) and `--no-worktree` runs at `cwd` (`workflow.ts:2088-2089`) — so it is **not** null for those. Distinguish an isolated git worktree from an in-place / non-git run by codebase `kind` / isolation provider, not by null. A null `working_path` is a missing/legacy state → CAP-6 empty state. v1 git read presupposes a git worktree (isolated or `--no-worktree` repo); a non-git folder project → CAP-6 empty state.
- Submodules are initialized `--recursive` into the worktree on create.
- **Realpath required.** Runtime showed the same logical tree referenced under two different absolute root strings (`/Users/agent/.archon/...` and `/Volumes/WD_BLACK/archon/...`); the cause (symlink / mount / relocation) was not confirmed. The server must `realpath` and tolerate the divergence; a stale `working_path` would break reads.
- Code refs: `packages/isolation/src/providers/worktree.ts`; `packages/workflows/src/schemas/workflow-run.ts:168-180`.

## Read source (worktree, not base)

- Run content is read with `git -C working_path` (status / log / show / diff). The worktree shares the repo object store.
- The base `default_cwd` sits on baseBranch `dev` and does **not** show the run branch unless it has been merged → history/diffs for a run must be read from the run's worktree, not from base.

## Worktree lifecycle (files can vanish mid-view)

- Code path: a terminal run status does not itself trigger worktree removal. (Runtime showed a `completed` run's `working_path` still recorded; the directory's on-disk presence was not verified — see the validation task below.)
- Removal is triggered by: conversation / PR close; the cleanup scheduler (merged ≈ 6h, stale ≈ 14d); manual command; codebase delete; orphan cleanup.
- `destroy` removes the checkout and runs `git branch -D`; the isolation environment status is `active | destroyed`.
- Therefore: for host checkouts, detect a vanished checkout by **directory existence at read time** (missing → CAP-6 empty state); do not gate on isolation-env status or run status. Every host-checkout run is read the same way — by `working_path`.
- Post-cleanup GC: after `branch -D` + checkout removal, commits that were never merged/pushed can become unreachable and be GC'd → durable history requires capturing before teardown (CAP-8).
- Validation task (implementation): the checkout's on-disk presence was never `stat`'d during this analysis (no fs endpoint, no SSH); verify the read-time existence check against the real host when building.
- Code refs: `packages/core/src/services/cleanup-service.ts`; `packages/isolation/src/types.ts:28`.
- **Container-backend exception:** folder-container runs keep the same host `working_path`, but changes live in an overlay volume; the host path reflects them only after write-back (`packages/isolation/src/backends/container.ts:4-16`, `types.ts:487-501`). Reading the host path mid-run shows stale state → **v1 non-goal** (container runs render the CAP-6 empty state); reading the overlay is a post-v1 upgrade. Host checkouts are unaffected.

## No existing API — build a new read-only one, on the artifacts model

- SOURCE-confirmed: the only raw (non-OpenAPI) routes are `/api/stream/__dashboard__`, `/api/stream/:conversationId`, `/api/artifacts/:runId/*`, and the GitHub webhook. There is **no** git / worktree / diff / source route today. The feature is entirely new.
- `@archon/git` exposes only a boolean `hasUncommittedChanges` (`git status --porcelain`) — no structured status, diff, show, or log content APIs.
- Reuse the artifact route as the pattern: `GET /api/artifacts/:runId/*` + `resolveRunArtifactDir` resolve the path **server-side** and reject any `..` segment (`api.ts:5071-5078`). The new git-read endpoints follow the same shape.

## Security (server resolves; UI never sends a path)

- The new git-read API must resolve the worktree path server-side from `runId` and **never** accept `working_path` (or any path) from the client — this prevents path traversal. Reuse the `..`-rejection pattern.
- Invoke git via `execFileAsync` / `@archon/git` with server-controlled argument arrays — never a shell string (Archon rule; see adopted `project-context.md`).

## Events are provenance only (not a change list)

- The workflow event stream is **not** authoritative for what changed: shell commands, `sed`, scripts, subprocesses, renames, and deletes mutate files without emitting a structured path event.
- Events may be used only as a hint layer (which node / log line may relate to a file), never as the change list. Git against the worktree is the source of truth.

## Minimal new endpoints (derived)

- `status` — Now changed files (`M`/`A`/`D`) for the run checkout.
- `log` — commit history for the worktree branch.
- `show` / `diff` — `M`: `parent..commit` (history) and `HEAD..worktree` (Now); `A`: new-file content; `D`: removed-file content (from `parent` / `HEAD`).
  All resolve `working_path` server-side from `runId`, realpath, reject `..`, and run through `execFileAsync` / `@archon/git`.

## Durable capture (CAP-8, SHOULD)

- Mechanic: at **run-end** the server writes a git-snapshot — name-status (`M`/`A`/`D`), per-file unified diff, `A`/`D` file content, and `git log` — as an artifact under the run row's `output_root` (written once at run start, persists after worktree teardown). Per-commit granularity is a post-v1 option.
- Read order: the live worktree is primary while it exists; this capture is the fallback once the worktree is reaped.
- Trigger fixed to **run-end** (v1 of CAP-8); the wire format (a JSON manifest) is decided at build and must serve the same read API (CAP-1..4) as the live path.
