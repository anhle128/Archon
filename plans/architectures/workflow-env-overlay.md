# Architecture log — workflow ENV overlay

Intent: `docs/superpowers/specs/2026-09-04-workflow-env-overlay-design.md`

Mode: brownfield (Archon existing engine + console).

Stack: skipped.
The product already is Bun + TypeScript + SQLite/PostgreSQL + OpenAPI Hono + React console.
No new runtime or library is in play.

## Source notes

Spec already locked product intent:
allowlisted JSON patch per node, ENV rows keyed by `workflow_name` on the install, Web UI + API only, optional picker, snapshot on the run, PATCH replaces the whole `patches` object, no graph overlay, no `loop_group` body overlay, post-overlay `validateDagStructure`.

Existing plug-in points:
`POST /api/workflows/:name/run` dispatches through the conversation orchestrator and returns `{ accepted, status }`.
Worktree / isolation is created at the orchestrator dispatch seam (`orchestrator-agent.ts` around the `validateAndResolveIsolation` call), **before** `executeWorkflow`.
Declared `inputs` already have an invocation gate before isolation.
`WorkflowDeps` injects DB/user ports into `@archon/workflows`.
`resolveNodeModel` must not grow a new origin.

## Q1 — where the overlay gate runs (asked, awaiting answer)

Question: Overlay must fail before a worktree exists.
Isolation is created in the orchestrator **before** `executeWorkflow`.
Where does the gate live?

Options offered:

- A. Invocation gate on the orchestrator/server dispatch seam, before `validateAndResolveIsolation`.
  Pure apply + `validateDagStructure` stay in `@archon/workflows` (no DB).
  Core/server loads the ENV row (fresh `envId`) and calls that pure function.
  Resume/retry never loads the ENV row; they re-apply `metadata.envOverlay` only.
  HTTP 400 / dispatch refusal when the gate fails, so no worktree.

- B. Inside `executeWorkflow` after isolation.
  Smaller touch surface.
  Breaks the spec guarantee: the worktree already exists.

- C. HTTP run route only.
  True 400 on Start.
  Misses any other dispatch path that also creates isolation.
  Still needs a second copy of the gate for resume snapshot apply.

Recommendation: A.
It matches the existing `inputs` invocation-gate pattern.
It keeps DAG math in `@archon/workflows` and DB lookup in core.
B is cheaper to type and wrong about worktrees.

User answer: (pending)

## Q1 supersession — HTTP 400 is not available inside handleMessage

`dispatchToOrchestrator` catches `handleMessage` errors inside the lock and still returns `{ accepted: true }`.
Queued work can run after the HTTP response.
Original option A cannot promise HTTP 400.

Corrected question: how do we fail overlay errors, given that isolation is pre-`executeWorkflow` and the run route always accepts after dispatch?

Options offered (replace A/B/C above):

- A. Two-phase freeze.
  HTTP route: load ENV, 400 if missing/wrong workflow, freeze `{ envId, envName, patches }` into `HandleMessageContext`.
  Optionally also apply + `validateDagStructure` on the route so graph errors are HTTP 400 too (needs cwd discovery on the route).
  Orchestrator: before isolation, re-apply the frozen candidate only.
  No second DB read, no TOCTOU.
  Resume: snapshot only.

- B. Keep `{ accepted: true }`, fail before isolation, surface via SSE / failed run.
  Revise the spec: overlay errors are not HTTP 400.
  Gate still sits before `validateAndResolveIsolation`.

- C. Validate everything only inside `executeWorkflow`.
  Worktree already exists.
  Rejected as breaking the guarantee.

Recommendation: A with graph validation on the route as well, because v1 is Web+API only and Start should not create a run for a dangling `$node.output`.
B if we refuse to load YAML on the run route.

User answer: A (two-phase freeze + graph validation on the HTTP route).
Consequences: `POST .../run` must load ENV and the expanded DAG, apply, `validateDagStructure`, and 400 before dispatch.
Frozen candidate travels on `HandleMessageContext`.
Orchestrator re-applies that candidate before isolation with no second DB read.
Resume/retry hydrates `metadata.envOverlay` only.

## Q2 — which DAG the HTTP preflight validates (asked, awaiting answer)

Question: Graph validation on `POST .../run` needs a cwd to discover/expand YAML.
The run body today has `conversationId` + `message` + `inputs`, not cwd.

Options offered:

- A. Resolve cwd from the conversation's codebase (`default_cwd`), same as console listing.
  If `envId` is set and the conversation has no project/cwd → 400.
  Matches DraftRunCard (conversation created with `codebaseId`).

- B. Existence-only 400 on the route (`envId` + workflow_name).
  Graph validation waits for the pre-isolation gate (real cwd).
  Graph errors are not HTTP 400 (response already accepted unless we block dispatch until the gate).
  Conflicts with Q1-A if dispatch is still async.

- C. Add explicit `cwd` / `codebaseId` on the run body.
  Callers must send it.
  Duplicates conversation provenance.

Recommendation: A.
v1 console always binds a project before Start.
Do not add a second identity field.

User answer: (pending)

## Q2 restatement (user asked for context; no answer yet)

User: they did not understand the cwd question and asked to hear the full context and be asked again.
This is not an answer to A/B/C.

Restated in product terms: Start + ENV must validate against the same workflow file the run will execute.
That file depends on project folder because a project YAML can shadow a bundled workflow of the same name.
The run body does not include a folder path; the console conversation already has a project.

Recommendation unchanged: A, with one shared `prepareWorkflowEnvOverlay` in core so the HTTP route and the orchestrator pre-isolation gate cannot discover two different DAGs.

## Q2 user reply (not yet locked)

User: they do not want a folder path in this design.
They believe binding an ENV to a workflow is just comparing `workflow_name`.
This is not yet a locked A/B/C.

Consequence if we take that as the HTTP preflight:
route 400 only for missing ENV or `workflow_name` mismatch.
Node-id and `$node.output` checks need the loaded DAG and therefore happen at the pre-isolation gate, which already has the project cwd.
Those graph errors then cannot be HTTP 400, because the run route has already accepted.
The run API still does not grow a cwd field.

## Q2 user: asked what shadowing / node-id fail at run start means

Not an A/B lock.
Explanation to give: ENV rows key only on workflow name.
Discovery can load a different YAML file of that same name (project file wins over bundled).
The patch names node ids from the YAML the operator had in mind.
If the loaded file has no such id, apply fails with `unknown_node` at the overlay gate, before isolation.
That is independent of sending a folder path on the request.

## Q2 locked

User confirmed they were talking about existing Archon workflow-name shadowing (project YAML wins over bundled for the same name).
They already said name comparison is enough for the HTTP binding.

Lock: the HTTP route freezes the ENV after `envId` lookup + `workflow_name` match only.
It does not load YAML and does not need a folder on the request.
The orchestrator, which already has the project cwd, applies the frozen patches to the DAG it actually loaded, before isolation.
`$node.output` / structure checks run on the DAG after apply.
Unknown node ids in the ENV are not graph failures (see Q3).

Q1 consequence “all graph errors are HTTP 400 on the run route” is superseded.
HTTP 400 remains only for missing ENV or workflow_name mismatch.

## Q3 — missing node ids in an ENV (locked)

Question (user-initiated): if the ENV names a node the loaded workflow does not have, what happens?

User answer: that is fine.
There is no apply for that key.
Do not fail the run.

Options considered: fail `unknown_node` (spec draft) vs skip extra keys (user).
User chose skip.

Consequences: extra keys are skipped (warn log).
Forbidden fields and wrong type on nodes that exist still fail.
The run snapshot stores the **filtered applied** patch map, not the original ENV map, so resume cannot later apply a key that was skipped at start if YAML gains that node.
Optional `skippedNodeIds` on the snapshot for audit/UI.
Spec hard-fail `unknown_node` is superseded.

## Apply purity (locked, engineering)

Apply must return a patched clone.
Bundled definitions are cached; in-place mutation would leak ENV A into a later no-ENV run.
Regression: ENV A then no-ENV on the same cached definition leaves original nodes unchanged.

## Q4 — see provider/model/thinking at Start (asked, awaiting answer)

User: today provider/model/thinking are only visible when a node actually starts.
With an ENV, they cannot tell at Start whether the ENV applied correctly.
They want to see model, provider, and thinking level as soon as the workflow starts.

Options offered:

- A. Preview on the Start form after ENV is selected, before dispatch.
  A GET uses conversation project cwd, clones DAG, applies ENV, runs `resolveNodeModel`, returns per-node provider/model/thinking.

- B. At the pre-isolation gate, stamp the same effective table onto the run snapshot and show it on run detail immediately.
  Does not wait for `node_started`.

- C. Both A and B, one shared helper so the form and the run cannot disagree.

Recommendation: C.
A answers “did I pick the right ENV” before spend.
B answers “what this run actually froze” after Start.

User answer: C (preview on Start form AND frozen table on the run).

## Q4 supersession — run row does not exist before isolation

The workflow run row is created inside `executeWorkflow`, after `validateAndResolveIsolation`.
Original B/C cannot stamp a frozen table onto a run that does not exist yet without a lifecycle change.

Corrected options:

- A. Preview-only GET on the Start form (conversation cwd, clone, apply, `resolveNodeModel`).
  No run-row stamp before nodes.

- B. Change lifecycle: create the run row before isolation so a frozen table exists as soon as Start is clicked.
  Expensive, one-way-ish.

- C. Preview GET before Start, and write the effective table when the run row is created (after isolation, before first `sendQuery`).
  Run detail shows it as soon as the run appears, not per `node_started`.
  No new run-row-before-isolation lifecycle.

Recommendation: C (this corrected C).
Gives pre-click verification and post-click audit without moving run creation.

User answer: C (corrected).
Preview GET on the Start form, and write the effective provider/model/thinking table when the run row is created (after isolation, before first sendQuery).
Not a run-row-before-isolation lifecycle change.
Consequences: one shared resolve helper; form preview uses conversation project cwd; run detail reads the stamped table, not `node_started`.

Engineering lock for Q4-C: do not call `resolveNodeModel` alone for the Start table.
It does not return `thinking`.
Extract `resolveNodeExecutionMetadata` covering provider, model, effort, and thinking (node → workflow → preset, same as `applyPresetOptions`) and use it for preview, snapshot, and `node_started`.

## Interruption

User asked about legacy dashboard mobile, then said we are still in plan-architecture for ENV overlay.
Dashboard work is out of this architecture log.
Q4 corrected options remain unanswered.
