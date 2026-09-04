---
title: "See this run's uncommitted changed files"
type: 'feature'
created: '2026-09-05'
status: 'in-progress'
baseline_revision: '21bb96d9c1035fe8fb2183fcb22b88135922f02f'
review_loop_iteration: 1
followup_review_recommended: false
context: ['{project-root}/_bmad-output/implementation-artifacts/epic-1-context.md']
warnings: ['oversized']
deferred: []
---

<intent-contract>

## Intent

**Problem:** Operators can't see what a workflow run's checkout changed but hasn't committed without SSH or a local clone — there's no view for this on the existing run screen.

**Approach:** Add a read-only `GET /api/runs/{runId}/changes` endpoint (backed by the already-existing `getGitStatus` git helper) gated by container/no-checkout detection, plus a new "Source Control" tab on the run screen showing those files in a master-detail shell: a Changes list on the left and a placeholder Viewer pane on the right (the real diff/content Viewer is built in later stories).

## Boundaries & Constraints

**Always:** Read-only — no stage/unstage/discard/commit affordance anywhere. Manual refresh only via a Reload control — no auto-refresh or polling. Every file carries exactly one status letter M/A/D. A container-isolation-backed run or one with no readable checkout returns `{readable:false}` and renders the Empty state — never a 500. The server resolves the checkout path from `runId` only; no client-supplied path exists on this route. A missing conversation or null `isolation_env_id` is not container-backed — fall through to the checkout read. Clicking a row selects it (visual state only) — no diff/content fetch.

**Never:** Do not build the diff viewer, file-content viewer, or large/binary handling (Stories 1.2–1.4) — the right pane is a static placeholder only. Do not add stage/unstage/discard/commit UI. Do not add auto-refresh, polling, or websockets. Do not write a new git helper — `getGitStatus` already returns the required `{readable, entries:[{path,status}]}` shape.

## I/O & Edge-Case Matrix

| Scenario                       | Input / State                                                    | Expected Output / Behavior                                                      | Error Handling                |
| ------------------------------ | ---------------------------------------------------------------- | ------------------------------------------------------------------------------- | ----------------------------- |
| Readable checkout with changes | valid runId, host/worktree checkout with git changes             | 200 `{readable:true, files:[{path,status}]}`                                    | No error                      |
| Readable checkout, no changes  | valid runId, clean checkout                                      | 200 `{readable:true, files:[]}` — list renders empty, not the Empty-state panel | No error                      |
| Container-backed run           | valid runId, conversation's isolation env `provider:'container'` | 200 `{readable:false, reason:'container'}` — Empty state, no Reload CTA         | No error                      |
| No checkout on disk            | valid runId, `working_path` null or directory missing/not-git    | 200 `{readable:false, reason:'unavailable'}` — Empty state, with Reload CTA     | No error                      |
| Unknown runId                  | nonexistent runId                                                | 404                                                                             | Standard `jsonError` response |

</intent-contract>

## Code Map

- `packages/git/src/status.ts:37-62` -- `getGitStatus(dirPath)`, returns `{readable:true, entries:[{path,status:'M'|'A'|'D'}]}` or `{readable:false}`. Keep this public shape and the "unavailable" detection as-is — only its internal `classifyStatus`/`parsePorcelainStatus` (lines 64-88) need correcting; see Tasks.
- `packages/git/src/index.ts:52-53` -- public export of `getGitStatus`.
- `packages/git/src/git.test.ts:2586-2676` -- existing `getGitStatus` tests. One of them, `'collapses renames to M and resolves the new path'`, currently locks in the wrong (pre-PRD) rename behavior and must be corrected, not just left passing — see Tasks.
- `_bmad-output/planning-artifacts/prds/prd-source-control/prd.md:101` and `.../addendum.md:38` -- the authoritative status-projection rule: "Three states only: `M`/`A`/`D`. ... rename → `D` (old path) + `A` (new path); copy → `A`; type-change → `M`; unmerged → `M`." `classifyStatus` today collapses rename/copy/type-change all to `M` (losing the old path on rename) and silently drops unmerged codes (file disappears from the list entirely) — both diverge from this rule.
- `packages/server/src/routes/api.ts:986-1010` -- `listRunArtifactsRoute` `createRoute(...)` definition — pattern to copy for the new route (runId param, 200/400/404/500 responses).
- `packages/server/src/routes/api.ts:4969-5066` -- artifacts route handler — pattern for run lookup (`getWorkflowRun`), server-resolved path, containment guard, `c.json(...)` return.
- `packages/server/src/routes/api.ts:3570-3576` -- `registerOpenApiRoute` wrapper.
- `packages/server/src/routes/api.ts:562` -- `jsonError()` helper for 404/500 responses.
- `packages/server/src/routes/schemas/workflow.schemas.ts:344-358` -- `artifactFileSchema` + `listArtifactsResponseSchema` — pattern to copy for `changedFileSchema` + `runChangesResponseSchema`.
- `packages/core/src/db/workflows.ts:526-539` -- `getWorkflowRun(id)`.
- `packages/workflows/src/schemas/workflow-run.ts:170-183` -- `workflowRunSchema` (`working_path`, `codebase_id`, `conversation_id` fields).
- `packages/core/src/db/conversations.ts:20` -- `getConversationById(id)`.
- `packages/core/src/schemas/conversation.ts:21` -- `conversationRowSchema.isolation_env_id`.
- `packages/core/src/db/isolation-environments.ts:50` -- `getById(id)`.
- `packages/isolation/src/types.ts:24,269-283` -- `IsolationProviderType` (`'worktree'|'container'|'vm'|'remote'`), `IsolationEnvironmentRow.provider`.
- `packages/web/src/components/workflows/WorkflowExecution.tsx:301` -- `activeView` state, extend union with `'source-control'`.
- `WorkflowExecution.tsx:858-879` -- `TabsList`/`TabsTrigger` JSX pattern to mirror.
- `WorkflowExecution.tsx:741-818` -- `renderBody()` if/else dispatch — add a `source-control` branch.
- `WorkflowExecution.tsx:744-795` -- existing `ResizablePanelGroup`/`ResizablePanel`/`ResizableHandle` two-pane usage — reuse for the master-detail shell.
- `packages/web/src/lib/api.ts:64-75,403-425` -- `fetchJSON` helper + `listWorkflowRuns`/`getWorkflowRun` pattern for a new `getRunChanges(runId)` function.
- `packages/web/src/hooks/useProviders.ts:1-24` -- `useQuery` hook pattern to copy for a new `useRunChanges(runId)` hook (`staleTime: Infinity`, manual `refetch()`).
- `packages/web/src/components/workflows/DagNodeProgress.tsx:89-100,22-32` -- clickable-row pattern + small colored status-badge pattern (template for the M/A/D badge).
- `packages/web/src/components/workflows/ArtifactSummary.tsx:79-92` -- filename + right-aligned dimmed-path row pattern.
- `packages/web/src/components/workflows/WorkflowCard.tsx:65-77` -- keyboard-accessible clickable div (`role="button"`, `tabIndex`, `aria-pressed`, `onKeyDown` Enter/Space) — reuse for row a11y.
- `packages/web/src/components/ui/resizable.tsx` -- shadcn wrapper over `react-resizable-panels` (already a `packages/web/package.json` dependency).
- No `role="status"`/live-region or shared production `EmptyState` exists in `packages/web/src` today (the only `EmptyState` component is `experiments/console`-scoped) — both are new, local to the new component, not reused across the experiments/production boundary.

## Tasks & Acceptance

**Execution:**

- `packages/server/src/routes/schemas/workflow.schemas.ts` -- add `changedFileSchema` (`{path, status: z.enum(['M','A','D'])}`) and `runChangesResponseSchema` (`{readable, reason?: z.enum(['container','unavailable']), files}`) -- wire contract, mirrors `artifactFileSchema`/`listArtifactsResponseSchema`.
- `packages/server/src/routes/api.ts` -- add `GET /api/runs/{runId}/changes` (`createRoute` + `registerOpenApiRoute` handler) -- looks up the run, resolves the container gate via the conversation→isolation-environment FK chain, calls `getGitStatus(working_path)` when not container-gated, returns the envelope.
- `packages/server/src/routes/api.test.ts` (or nearest existing route test file) -- tests for the container-gate, no-checkout-gate, has-changes, and no-changes branches of the new route.
- `packages/web/src/lib/api.ts` -- add `getRunChanges(runId)` typed fetch function; regenerate types via `bun --filter @archon/web generate:types` once the route is live.
- `packages/web/src/hooks/useRunChanges.ts` (new) -- `useRunChanges(runId)` hook wrapping `useQuery` with `staleTime: Infinity` + manual `refetch`.
- `packages/web/src/components/workflows/SourceControlTab.tsx` (new) -- master-detail shell: Changes list (row = filename + dimmed dir path + right-aligned M/A/D badge, keyboard-accessible), right placeholder pane ("Select a file to view its changes"), Reload button, `role="status"` live region, two Empty-state copies (container: no CTA; unavailable: Reload CTA).
- `packages/web/src/components/workflows/WorkflowExecution.tsx` -- extend `activeView` union, add the tab trigger, add the `renderBody()` branch rendering `<SourceControlTab runId={runId} />`.
- `packages/git/src/status.ts` -- correct `classifyStatus`/`parsePorcelainStatus` to implement the PRD's exact projection: a rename line (`R  old -> new`) emits **two** entries, `{path: old, status: 'D'}` and `{path: new, status: 'A'}`; a copy code (`C`) maps to `A`; an unmerged code in either column (`U`, or `AA`/`DD` conflict pairs) maps to `M` instead of being dropped; type-change (`T`) stays `M`. Keep the public `getGitStatus`/`GitStatusEntry` shape unchanged.
- `packages/git/src/git.test.ts` -- correct `'collapses renames to M and resolves the new path'` to assert the two-entry `D`(old)+`A`(new) result instead of a single `M`; add a copy-code test asserting `A`; add an unmerged-code test asserting the file is listed with `M`, not dropped.
- `packages/web/src/components/workflows/SourceControlTab.tsx` -- when a reload removes the row that currently holds focus (its path is no longer in `data.files`), move focus to the Changes-list container (or the nearest remaining row) instead of leaving it to default to `<body>`.

**Acceptance Criteria:**

- Given a checkout with a renamed file, when the operator opens the tab, then the list shows two rows for it — the old path marked `D` and the new path marked `A`.
- Given a checkout with a copied file, when the operator opens the tab, then it is marked `A`.
- Given a checkout with an unmerged (conflicted) file, when the operator opens the tab, then it appears in the list marked `M` — never silently omitted.
- Given a row currently holds keyboard focus, when a reload removes that row from the list, then focus moves to the list container or a remaining row — never silently to the page body.
- Given a run with a readable checkout with uncommitted changes, when the operator opens the Source Control tab, then each file shows with exactly one M/A/D badge and no error.
- Given a run with a readable, clean checkout, when the operator opens the tab, then the Changes list renders empty (not the Empty-state panel).
- Given a container-isolation-backed run, when the operator opens the tab, then the Empty state renders with no Reload CTA.
- Given a run with no readable checkout, when the operator opens the tab, then the Empty state renders with a Reload CTA.
- Given the list is showing files, when the operator clicks Reload, then it re-fetches on demand only — no automatic refresh otherwise.
- Given the list is showing files, when the operator clicks a row, then it is marked selected and the right pane shows the placeholder text, with no diff/content fetched.
- Given the tab is rendered, when inspected for accessibility, then every row is reachable/activatable via keyboard and the M/A/D badge is letter-carried, not color-only.

## Spec Change Log

### 2026-09-05 — Amendment from review pass 1

- **Triggering findings:** (1) `getGitStatus`'s classification collapses rename→`M` and copy→`M` (losing the old path on rename), and silently drops unmerged codes entirely, all diverging from the explicit PRD rule at `prd.md:101`/`addendum.md:38` ("rename → `D`(old)+`A`(new); copy → `A`; unmerged → `M`"). (2) Reload removing the currently-focused row leaves keyboard focus to default to `<body>`, contradicting the epic context's focus-management invariant.
- **What was amended:** Code Map corrected to say `getGitStatus`'s internals (not just its public shape) need fixing, with the PRD citation and the specific test that locks in the wrong behavior. Tasks & Acceptance gained four items: fix `classifyStatus`/`parsePorcelainStatus`, correct/add the three `git.test.ts` cases, add explicit focus-management behavior on row removal, and four new Acceptance Criteria covering rename/copy/unmerged display and focus-on-removal.
- **Known-bad state avoided:** shipping a Changes list that silently omits conflicted files (an operator could believe a run has no unresolved conflicts when it does) and that shows a rename as a single misleadingly-plain `M` row instead of the PRD's two-row `D`+`A` projection; and a reload that silently drops keyboard focus to the page body for assistive-tech users.
- **KEEP — preserve on re-derivation:** the route's `{readable, reason?, files}` envelope design and its container/no-checkout gating (including that a _destroyed_ container-provider environment still gates — status-agnostic, per the epic context); the genuine-read-failure-throws-500 vs. gated-empty-state distinction; the master-detail shell (`ResizablePanelGroup` two-pane layout, static unchanging Viewer placeholder regardless of selection); the letter-carried `StatusBadge` (never color-only); the keyboard-accessible row pattern (`role="button"`, `tabIndex`, `aria-pressed`, `onKeyDown` Enter/Space); the two distinct Empty-state copies (container: no Reload CTA; unavailable: Reload CTA); `useRunChanges`'s `staleTime: Infinity` + manual-only refetch; the read-only posture (no stage/unstage/discard/commit affordance anywhere); the `role="status"` live region announcing concise counts only.

## Review Triage Log

### 2026-09-05 — Review pass

- verdicts: 21 findings — high 1, medium 5, low 6, false 9, maybe-false 0
- findings:
  - `[high]` `[bad_spec]` (blind-hunter) `getGitStatus`'s classification collapses rename→M (should be `D`(old)+`A`(new)) and copy→M (should be `A`), losing the old path — verified against `prd.md:101` / `addendum.md:38`, which explicitly require this exact projection; locked in by the pre-existing test `'collapses renames to M and resolves the new path'`. Amendment: Code Map + Tasks now require correcting `packages/git/src/status.ts` classification and its test.
  - `[high]` `[bad_spec]` (blind-hunter) same root cause: `classifyStatus` returns `null` for unmerged codes (`UU`/`AU`/`UA`/etc.), so conflicted files are silently dropped from the list entirely — verified by reading `classifyStatus`; contradicts both the PRD's "unmerged → M" rule and this spec's own "every file carries exactly one status letter" boundary (an unmerged file carries none — it's invisible). Same amendment as above.
  - `[medium]` `[bad_spec]` (edge-case-hunter) reload removing the currently-focused row (via the `selectedPath`-clearing effect) drops keyboard focus to `<body>` with no deliberate target — verified: React unmounts the focused node on re-render, browser defaults to body; contradicts the epic context's explicit focus-management invariant ("move focus only when a re-render removes the element the user currently has focused"), which this spec's Code Map cited but did not carry into an explicit task. Amendment: new Task/AC added.
  - `[medium]` `[patch]` (blind-hunter + verification-gap, grouped — same root cause) two of three new failure branches in the route handler (`run_lookup_failed`, `isolation_lookup_failed`) are implemented correctly (verified: both already return `apiError(c,500,...)`) but have zero test coverage — only `status_read_failed` is tested. Real coverage gap, trivial fix (2 tests mirroring the existing one). Moot this pass — code will be re-derived; left for the next review pass.
  - `[medium]` `[patch]` (edge-case-hunter) the fetch-failure branch (`isError || !data`) discards a previously-successful file list and replaces it with the full Empty-state panel — react-query keeps `data` from the last success during a failed refetch, so checking `!data` alone (dropping the `isError ||`) would preserve the working view. Trivial reorder, no new surface. Moot this pass.
  - `[medium]` `[defer]` (verification-gap ×3, grouped — same root cause) Reload-click→refetch wiring, row click/keydown→selection, and the run-screen's tab-switching wiring are all genuinely untested at the interaction level — confirmed by grep: `packages/web` has no `@testing-library/react` (or equivalent) anywhere, so `renderToStaticMarkup`-based tests structurally cannot exercise clicks/keydowns. This is a pre-existing, package-wide absence of interaction-testing infrastructure (every other interactive component — `DagNodeProgress`, `WorkflowCard`, etc. — has the same gap), not something this story introduced, so it is not this story's problem to fix.
  - `[low]` `[patch]` (blind-hunter) the "destroyed container still gates" test asserts `toMatchObject({reason:'container'})` but never asserts `response.status`, unlike its sibling test — real but very unlikely to matter (would only hide a bug if `apiError`'s error shape ever overlapped a 200 body). Fix is a trivial one-line assertion addition, so not auto-rejected despite low everyday impact. Moot this pass.
  - `[low]` `[patch]` (blind-hunter) `useRunChanges` has no `enabled: !!runId` guard — verified unreachable today (runId is always a non-empty router param whenever `SourceControlTab` mounts) but a cheap, direct guard. Moot this pass.
  - `[low]` `[patch]` (blind-hunter) the `/^[A-Za-z0-9_-]+$/` runId regex is duplicated verbatim between `listRunArtifactsRoute`'s handler and the new route instead of factored into one shared constant — real duplicated-source-of-truth risk if the valid-runId format ever changes, but the dedup fix is small and direct. Moot this pass.
  - `[low]` `[reject]` (blind-hunter) the fetch-failure Empty state always offers a Reload CTA even for a run that 404'd (permanently, not transiently) — unlikely to be hit in everyday use (the tab only renders from an already-valid run screen) and disambiguating fetch-failure causes in the UI is more than a direct correction (new state/branching). Rejected per the low-finding rule.
  - `[low]` `[reject]` (edge-case-hunter) `useRunChanges`'s `queryFn` doesn't forward react-query's `AbortSignal` to the fetch, so a superseded request isn't cancelled — imperceptible to the user (react-query already discards the stale response), and threading a signal through the shared `fetchJSON` helper widens its public surface. Rejected per the low-finding rule.
  - `[false]` `[reject]` (blind-hunter) claimed the container gate's `provider === 'container'` check implicitly under-handles `'vm'`/`'remote'` providers — refuted: grepped the codebase and confirmed neither value is ever produced anywhere today, so that branch is unreachable; per this workflow's own classify rule, code that fails loudly on an unreachable situation is not a defect.
  - `[false]` `[reject]` (blind-hunter) claimed the response schema should already carry `scope`/`ref` fields so Epic 2 can reuse it — refuted: the epic context's "canonical schema" note names `hunks[]`, which only applies to the diff-hunks endpoint (a later story), not this story's plain file list; pre-adding speculative fields ahead of Epic 2's actual shape violates this project's stated YAGNI rule.
  - `[false]` `[reject]` (blind-hunter) claimed `warnings: ['oversized']` and `followup_review_recommended: false` are contradictory frontmatter — refuted: they are independent fields serving unrelated purposes at unrelated times (planning-time size flag vs. review-time outcome flag set fresh at finalize); no logical relationship exists between them.
  - `[false]` `[reject]` (edge-case-hunter, low confidence, "claim" kind) claimed a genuine `getGitStatus` throw (permission denied, timeout) returning 500 contradicts this spec's "never a 500" boundary — refuted: that boundary is explicitly scoped to the two named gate outcomes (container-backed, no readable checkout); a real read failure is a distinct, third case the spec's Design Notes and the code's own comments both call out separately.
  - `[false]` `[reject]` (intent-alignment) noted `sprint-status.yaml` still reads `backlog` while the spec reads `in-review` — the auditor's own analysis already concludes this is the expected shape under "never write the board," not a defect.
  - `[false]` `[reject]` (intent-alignment) noted the verbatim intent never confirms or contradicts `in-review` as a valid status — the auditor's own analysis already concludes this is a gap the given text simply doesn't fill either way, not a divergence.
  - `[false]` `[reject]` (intent-alignment) noted the "Auto Run Result must report `awaiting-operator`" requirement is invisible to a diff-based review — not a defect: verified separately that no AC in this story requires a human-only external action, so `awaiting-operator` was correctly never triggered.

## Design Notes

The response envelope is `{readable, reason?, files}` rather than an HTTP error code for the gated cases, because "no readable checkout" is expected, common (cleaned-up runs, container runs), and must render as UI empty state, not as a fetch error the frontend has to special-case. `reason` distinguishes the two Empty-state copies the UX spec requires (container vs. transient/unavailable) without the client re-deriving isolation-provider logic itself.

## Verification

**Commands:**

- `bun run type-check` -- expected: no new type errors
- `bun run lint` -- expected: zero warnings
- `bun test packages/server` -- expected: new route tests pass
- `bun test packages/git` -- expected: existing `getGitStatus` tests still pass unchanged
- `bun --filter @archon/web generate:types` -- expected: `api.generated.d.ts` includes the new route types

**Manual checks:**

- `bun run dev`; open a run with a worktree checkout with uncommitted changes; open Source Control tab; verify list + badges.
- Open a run whose isolation env `provider` is `container`; verify Empty state with no Reload button.
- Open a run with `working_path: null`; verify Empty state with Reload button; click Reload; verify re-fetch.
