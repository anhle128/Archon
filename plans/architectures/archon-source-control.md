# Architecture — Archon Source Control tab

Mode: brownfield (Archon is an existing Bun + TypeScript monorepo).
Intent + reference docs (the lens for every decision):

- PRD: `archon/_bmad-output/planning-artifacts/prds/prd-source-control/prd.md` (FR-1..9, status final).
- Addendum (technical depth): `.../prds/prd-source-control/addendum.md`.
- SPEC + companions: `_bmad-output/specs/spec-archon-source-control/`.
  Prior code investigation (grounding): live API `GET /api/workflows/runs/{runId}` exposes `working_path` + `codebase_id`; `@archon/git` has only boolean `hasUncommittedChanges`; artifact route `GET /api/artifacts/:runId/*` resolves path server-side and rejects `..`; isolation env provider is `worktree`|`container`; cleanup lifecycle removes checkouts.

## Already locked by SPEC/PRD (not re-litigated here)

Read-only; read by `working_path` resolved server-side from `runId` (never client-supplied); realpath + reject `..`; git via `execFileAsync`/`@archon/git`, no shell-string; states `M`/`A`/`D`; viewer M=diff, A/D=single-pane; diff direction Now=HEAD→worktree, commit=parent→commit; container-backend run → Empty state (v1); CAP-8 durable snapshot = fast-follow, run-end trigger; secret redaction deferred with recorded risk.

## Remaining architectural decisions (the map)

- D1. Git-read layer placement — where the structured status/diff/log/show logic lives.
- D2. API route shape + transport — JSON endpoints vs raw route; how diffs/large files/binary move.
- D3. Frontend diff viewer — build vs buy; data-fetching + state.
- D4. CAP-8 snapshot seam (fast-follow) — where the run-end write hooks in.
- D5. Container detection + empty-state gating — how the server knows to short-circuit.
- Spikes — large-diff/large-file streaming perf (the "slow" concern); diff-viewer rendering.

Each decision below records: question, options, user answer, consequences.

---

## D1 — Git-read layer placement

Question: where does the structured read-only git logic (changed files M/A/D, file diff, file-at-ref, log) live?
Options: (a) extend `@archon/git` with focused read-only helpers, thin server routes; (b) inline git in the `@archon/server` route; (c) a new `@archon/source-control` package.
Answer: (a).
Consequences: add read-only helpers to `@archon/git` (e.g. `changedFiles`, `fileDiff`, `fileAt`, `log`) built on `execFileAsync`; unit-test them at the git layer.
Server routes stay thin — they own path-resolution from `runId`, container detection, auth, and transport, not git mechanics.
Honors the AGENTS rule "use `@archon/git` for git operations; `execFileAsync` not shell-string".
`@archon/git` depends only on `@archon/paths`, so the new surface stays at a safe low layer.

## D2 — API route shape + transport

Question: what response shape carries the read data (changed-file list, commit log, per-commit files, file diff, file content incl. large/binary)?
Options: (a) all-JSON OpenAPI; (b) JSON OpenAPI for structured metadata + a raw wildcard route for file content/binary (the artifacts precedent); (c) all-raw.
Answer: (b) — coach-decided as a reversible, low-stakes transport call after the user asked for plain context and did not need to adjudicate it; the user's earlier "a" was uninformed and is superseded here.
Consequences: structured endpoints (changes list, commit log, per-commit files, diff hunks) are JSON via `registerOpenApiRoute` so `@archon/web` gets generated types; file content / large text / binary go through a raw wildcard route modeled on `GET /api/artifacts/:runId/*` (server-resolved, `..`-rejected) with byte/line range support.
This satisfies FR-5 (stream large/binary without base64 bloat) and honors both AGENTS rules (OpenAPI routes for JSON; the sanctioned raw `app.get` exception for wildcard/non-JSON).
Reversible: can consolidate to all-JSON later without disturbing the data model or approach.

Correction: the "Answer: (b)" line above was recorded prematurely.
The user chose (a), then said they did not understand and asked for context; "continue" meant continue explaining, not a confirmation of (b).
Status: D2 is PENDING — coach recommendation is (b); awaiting the user's explicit A-or-B call now that the plain-language context has been given.
D3 (frontend diff viewer) was posed before D2 was locked and is on hold until D2 is confirmed.

Resolution: with the plain-language context provided, the user explicitly confirmed (b). D2 is now LOCKED = (b) (JSON OpenAPI for structured metadata + raw wildcard route for file content/binary, ranges supported). The pending status above is resolved.

## D3 — Frontend diff viewer: research findings (user-requested web search)

Installed deps already in `archon/packages/web/package.json` that matter here: `react-resizable-panels` ^4 (two-pane split), `@tanstack/react-virtual` ^3 (virtualize large files/diffs), `highlight.js` ^11 + `rehype-highlight` ^7 (syntax highlighting), `@tanstack/react-query`, `zustand`, radix/shadcn.
NOT installed: any diff library, Monaco, Shiki, react-diff-viewer(-continued), react-diff-view, @git-diff-view.
Consequence: a custom viewer reuses existing deps and adds nothing heavy; any library is a NEW dependency. Do not add Shiki — reuse the installed highlight.js.

Library landscape (web search, 2026):

- react-diff-view — consumes a unified diff string (git diff output); split + unified; token system + web-worker + virtualization for large; NO built-in syntax highlight (wire highlight.js). Best fit for a server-computed-diff design.
- react-diff-viewer-continued (4.4.0, actively maintained) — takes old/new strings and diffs client-side; render-prop highlight (can use highlight.js); virtualization + JSON/YAML fast paths. Simplest API, but wants both file sides (client diff), less aligned with server hunks.
- @git-diff-view/react (git-diff-view) — universal native-perf engine, growing adoption; heavier concept surface.
- diff2html — framework-agnostic, turns a unified diff into HTML; usable in React but not React-native.
- Monaco — full VS Code fidelity, heaviest bundle; overkill for read-only viewing.

Fit against D1/D2 (server runs git diff; D2 sends structured hunks as JSON + raw content route): react-diff-view aligns best (feed it the server's unified diff); react-diff-viewer-continued would instead need both file versions fetched so it can diff client-side.
Coach recommendation (pending user lock): either (c-lean) custom viewer over the already-installed react-resizable-panels + @tanstack/react-virtual + highlight.js (zero new heavy dep, full control, fits KISS/minimal-impact), or (b-lib) add react-diff-view and reuse highlight.js (one dep, fits the server-diff pipeline, large-file virtualization out of the box). react-diff-viewer-continued is the simplest drop-in but fits the design less well.

Answer: (b-lib) react-diff-view.
Correction to the recommendation before locking: react-diff-view does NOT virtualize out of the box — its core render is slow on very large diffs (its README notes ~26s to render a ~2.2 MB diff) and the demo relies on a custom large-diff lazy-load; its web-worker only offloads tokenization.
Therefore large diffs still require D2's hunk/chunk pagination PLUS Archon's already-installed `@tanstack/react-virtual` / lazy rendering — react-diff-view alone does not solve large-file performance.
D2 locked diff transport as JSON hunks, so an ADAPTER is required: map the server's JSON hunks to react-diff-view's hunk/change model (`HunkData`/`ChangeData`), or have the diff endpoint emit a unified-diff string and use react-diff-view's `parseDiff`. Decide the exact shape at build; do not assume "feed unified diff directly".
Syntax highlighting reuses the installed `highlight.js` via react-diff-view's tokenize hook — do NOT add Shiki.
Consequences: one new dependency (react-diff-view); A/D single-pane content uses the raw content route from D2; large-file/large-diff performance is a spike (see Spikes).

### D3 contract lock — diff hunk shape (resolves the open branch)

The "map JSON hunks or switch to unified diff, decide at build" branch is closed now, not deferred to the implementer.
Decision: the diff endpoint returns a CANONICAL JSON hunk schema; the web adapter maps it to react-diff-view's `HunkData`/`ChangeData` model; the endpoint does NOT emit unified-diff text.
Canonical shape (Zod route schema in `packages/server/src/routes/schemas/`, OpenAPI-registered so `@archon/web` gets the type):
`{ path, status: "M", scope: "now"|"commit", ref: string|null, hunks: [ { oldStart, oldLines, newStart, newLines, header, changes: [ { type: "normal"|"insert"|"delete", oldLine?, newLine?, content } ] } ], cursor: string|null, truncated: boolean }`.
Pagination: `cursor` is an opaque next-page token; `truncated` signals more hunks — this is the hunk/chunk pagination D3 requires for large diffs (react-diff-view does not virtualize on its own).
`A`/`D` are not diffs — their single-pane content comes from the D2 raw content route (with byte/line range), not this endpoint.
The adapter is a thin, pure web-side function (server hunk JSON -> react-diff-view model); it is a tested unit, not implementer discretion.

## D4 — CAP-8 durable snapshot seam (fast-follow)

Question: where does the run-end snapshot write hook in, so it runs before the checkout is cleaned up?
Options: (a) workflow-executor finalize hook via `WorkflowDeps`; (b) a `workflow.run.completed` listener in core; (c) piggyback the run-end artifact/state flush.
Answer: (a) — accepted "theo đề xuất".
Consequences: the snapshot is written by an executor finalize hook injected through `WorkflowDeps`, running at run terminal while the checkout is still present (capture-before-teardown); CAP-8 is the concrete current caller that justifies the new `WorkflowDeps` method (satisfies the AGENTS "extend WorkflowDeps only with a current caller" rule).
Exact manifest is deferred (fast-follow) but reuses the D3 canonical hunk schema + D2 content model, so the snapshot serves the same read API as the live path.

## D6 — Read-containment mechanism (locks CAP-5)

Question: how do we guarantee "no read outside the run's checkout" when the checkout may contain symlinks pointing outside it? Rejecting `..` alone is insufficient.
Decision (locked, not left to the implementer):

- Now / live-checkout raw content: resolve + realpath the candidate path, then MUST verify the realpathed result is still under the realpathed `working_path`; reject if it escapes. A symlink that points outside the checkout is refused even though it contains no `..`.
- A/D and any commit-scoped content: read via `git show <ref>:<repo-relative-path>` (git object-store read), which resolves the path inside the tree object and does not follow filesystem symlinks out of the checkout — preferred over filesystem traversal.
- Reject encoded traversal at the boundary: percent-encoded `..`, absolute paths, backslashes.
  Required tests: a tracked symlink escaping the checkout (e.g. to `/etc/passwd`) is refused; encoded-traversal attempts are refused; a legitimate in-checkout symlink resolves normally.
  This is the concrete mechanism behind CAP-5's "no request reads outside the run's realpathed checkout"; the PRD/SPEC promised the property, this locks the how.

## D5 — Container detection + empty-state gating

Question: how does the server know a run is container-backed, to route to the Empty state before any git read?
Options: (a) look up `isolation_environments.provider`; (b) infer from codebase `kind`; (c) filesystem heuristic on `working_path`.
Answer: (a).
Consequences: the server branches to the Empty state when the run's isolation environment has `provider === 'container'`, decided BEFORE any git read — the diagram's "container-backend run?" node. The signal is `isolation_environments.provider`, not codebase `kind`, not a filesystem heuristic.
Lookup (locked, using existing FKs — no invented query): resolve `run.conversation_id` → `conversation.isolation_env_id` → `isolationEnvironments.getById(envId).provider`. Both `getConversationById` and `isolationEnvironments.getById` already exist; `getById` is status-agnostic, so a destroyed container env is still detected. `WorkflowRun` carries only `conversation_id`/`codebase_id`/`working_path` (`packages/workflows/src/schemas/workflow-run.ts:169-182`) — no `workflow_type`/`workflow_id` — so do NOT use `findActiveByWorkflow` or invent a `findByWorkflow`; the conversation→env FK (`core/src/schemas/conversation.ts:17-22`) is the authority.
Provider is used ONLY to exclude container runs — a container env of ANY status → Empty state. For host/worktree provider (or a run with no resolvable env link), IGNORE env status and continue with the D6 existence check (`working_path` exists && is a git checkout). Host availability is decided by directory/git existence at read time — the locked SPEC/PRD decision — not by env status. Child/subruns that lack their own conversation→env link are a documented separate case (top-level container detection uses the existing FK; subrun resolution settled at build).

## D4 correction — CAP-8 hook failure semantics

Retract the earlier "checkout is guaranteed present at hook time": cleanup, manual destroy, or codebase-delete can race independently.
Locked failure semantics for the run-end snapshot hook:

- idempotent; checks checkout existence at invocation and no-ops if already gone;
- writes to a temp path, then atomic-renames under `output_root`;
- a snapshot-write failure MUST NOT mark the run failed — log + emit a metric and continue;
- the live read API falls back to the CAP-6 Empty state when NEITHER the checkout NOR a snapshot exists.
  Required tests: duplicate hook invocation (idempotent no-op); checkout-gone-at-hook-time race (no crash, run not marked failed).

## Spikes & experiments

Spike 1 — Large diff/file performance (the "slow" remote concern + react-diff-view's non-virtualized core).
Question: do D2 hunk pagination + Archon's `@tanstack/react-virtual` keep the viewer responsive on a big diff/file read from the remote?
Spike: render a ~2 MB diff and a multi-MB file through the paged hunk endpoint + virtualization, timebox ~1 day.
Decision rule: first-paint under ~1s with smooth scroll → keep react-diff-view; if it stalls → shrink page size / pre-tokenize server-side / reconsider Monaco for the diff pane only.

Spike 2 — End-to-end vertical slice for one `M` file.
Question: does the server-hunk JSON → web adapter → react-diff-view + highlight.js chain hold as designed?
Spike: wire one `M` file end to end (`@archon/git` changedFiles+fileDiff → canonical hunk JSON → adapter → react-diff-view with highlight.js), timebox ~1 day.
Decision rule: contract + highlight correct and render faithful → lock the pattern for A/D + history; if the adapter is painful → revisit the hunk schema before building the rest.

Validation tasks (not spikes): confirm the run row exposes the `(codebase_id, workflow_type, workflow_id)` identity D5's `findByWorkflow` needs; confirm the read-time checkout-existence check against the real remote host (PRD open question 1).

## Post-decision refinements (review advisories)

D6 input trust (corrected): do NOT use `<oid>:<path>` revision syntax and do NOT blanket-reject `:` (a valid Git filename — FR-5 must open it). Validate a full commit OID from `log` (hex + reachable), resolve the tree entry with `git ls-tree -z <oid> -- <repoRelativePath>`, then read the blob via `git cat-file blob <blobOid>` (D uses the parent OID's tree). Keep NUL / absolute / leading-`-` / encoded-traversal checks + argv-safe invocation. Tests: invalid ref, unreachable OID, symlink escape, encoded traversal, and a colon-in-filename SUCCESS test.
D5 open question resolved from source: `validateAndResolveIsolation` atomically writes `conversation.isolation_env_id = result.env.id` and rolls back on link failure (`core/src/orchestrator/orchestrator.ts:152-174`), so top-level runs have the FK. Converted from "confirm populated" to a test requirement (top-level container → Empty state; define + test child/subrun env resolution).
D6 input trust (further corrected): do NOT reject `:` / leading `-` / glob metachars in filenames — all valid, FR-5 must open them. Use `git --literal-pathspecs ls-tree -z <oid> -- <path>` (exactly one exact entry) + `git cat-file blob <blobOid>` (disables pathspec magic; `--`/argv handles leading `-`); keep NUL/absolute/encoded-`..` rejection + realpath-contain for live reads. Add success tests for colon, leading-dash, and glob-metachar filenames.
