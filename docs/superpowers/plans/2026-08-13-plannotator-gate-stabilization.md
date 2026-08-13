# Plannotator Gate Stabilization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.
> Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `plannotator_gate` deterministic across child decisions, external approval, rework, review re-open, and workflow resume, with production-path tests that prove downstream nodes execute once.

**Architecture:** Keep the existing in-process supervisor and existing workflow-run metadata model.
Add a per-gate `gateId` fencing token, expose the existing database approval CAS through `IWorkflowStore`, add one narrow atomic phase transition, and make `pending` a hard DAG stop.
The live supervisor owns normal approve continuation; an explicit `review-open` rotates the fencing token and starts a replacement executor.

**Tech Stack:** Bun, strict TypeScript, Zod-derived workflow schemas, SQLite/PostgreSQL through the existing database adapter, Bun subprocess APIs, and `bun:test`.

## Global Constraints

- [ ] Start on a feature branch from `dev`; never commit directly to `dev` or `main`.
- [ ] Preserve the current uncommitted changes in `.archon/workflows/defaults/archon-speckit-feature.yaml`, `packages/workflows/src/dag-executor.ts`, `packages/workflows/src/dag-executor.test.ts`, and `packages/workflows/src/defaults/bundled-defaults.generated.ts`.
- [ ] Decide with the owner whether those four current changes belong on the stabilization branch before modifying overlapping hunks.
- [ ] Never edit `packages/workflows/src/defaults/bundled-defaults.generated.ts` by hand.
- [ ] Regenerate bundled defaults only with `bun run generate:bundled`.
- [ ] Keep upstream Plannotator source changes out of this plan because the installed binary already implements and tests `--persist-session` and `--result-file`.
- [ ] Do not add a database column, background service, lease timer, PID liveness heuristic, feature flag, or new dependency.
- [ ] Do not claim remote team access in v1 because Archon has no stable machine-readable surface URL, tunnel ownership, or authentication contract.
- [ ] Keep every full sentence in edited Markdown on its own physical line.
- [ ] Use `bun run test` for the full suite and targeted `bun test <file>` commands for single files.
- [ ] Never run bare `bun test` from the repository root.

## Corrected Lifecycle Contract

The implementation is complete only when these invariants hold.

1. Every fresh `plannotator_gate` pause has a non-empty `metadata.approval.gateId`.
2. Every phase, document, and approval write is conditional on the expected `nodeId`, `gateId`, paused status, and unresolved state.
3. A stale supervisor can kill its child and return `pending`, but it cannot resolve the replacement gate or continue downstream.
4. Any `pending` node output stops the current DAG invocation even if another invocation has already changed the run back to `running`.
5. A decision produced by the live Plannotator child is resolved through the same database CAS as CLI, API, chat, and tool approval.
6. Normal external approval of a live Plannotator gate records the decision but does not start a second executor.
7. `review-open` is an explicit takeover: it rotates `gateId`, requests phase `opening`, and starts one replacement executor in human CLI and web API modes.
8. JSON CLI mode records the takeover but does not stream a resumed workflow; the caller must issue `workflow resume` separately.
9. A non-zero Plannotator exit, missing result file, unreadable document, unsupported binary, or invalid decision fails loudly with bounded diagnostics.
10. The producer → Plannotator gate → downstream path is exercised through `executeDagWorkflow`, not only through helper tests.

---

## Task 1: Record the corrected contract and rollback boundary

**Files:**

- Modify: `docs/superpowers/specs/2026-08-12-plannotator-gate-design.md`
- Modify: `docs/superpowers/plans/2026-08-12-plannotator-gate.md`
- Add: `docs/superpowers/plans/2026-08-13-plannotator-gate-stabilization.md`

- [ ] Add a “2026-08-13 stabilization correction” section to the design.

The section must state that `gateId` is the logical process owner, normal Plannotator approval is supervisor-owned, and `review-open` is an explicit owner replacement.
It must replace the original claim that generic approve auto-resume is safe for this gate type.

- [ ] Remove “team receives a live review URL” from v1 acceptance criteria.

Replace it with the narrower guarantee that Archon launches and supervises a local Plannotator session.
State that remote sharing requires a future upstream machine-readable URL contract plus an Archon authentication and exposure design.

- [ ] Mark the old implementation plan as superseded by this stabilization plan.

Add a short notice at the top of `2026-08-12-plannotator-gate.md` instead of rewriting its historical tasks.

- [ ] Verify that the correction is explicit and contains no placeholders.

Run:

```bash
rg -n "stabilization correction|gateId|explicit takeover|remote sharing|superseded" \
  docs/superpowers/specs/2026-08-12-plannotator-gate-design.md \
  docs/superpowers/plans/2026-08-12-plannotator-gate.md
rg -n "TODO|TBD|placeholder" \
  docs/superpowers/specs/2026-08-12-plannotator-gate-design.md \
  docs/superpowers/plans/2026-08-12-plannotator-gate.md
```

Expected: the first command finds every corrected contract term and the second command prints nothing new.

- [ ] Commit the documentation correction.

```bash
git add docs/superpowers/specs/2026-08-12-plannotator-gate-design.md \
  docs/superpowers/plans/2026-08-12-plannotator-gate.md \
  docs/superpowers/plans/2026-08-13-plannotator-gate-stabilization.md
git commit -m "docs(workflows): correct plannotator gate lifecycle"
```

---

## Task 2: Put gate resolution and phase transitions behind the production store

**Files:**

- Modify: `packages/workflows/src/schemas/workflow-run.ts`
- Modify: `packages/workflows/src/store.ts`
- Modify: `packages/core/src/db/workflows.ts`
- Modify: `packages/core/src/workflows/store-adapter.ts`
- Modify: `packages/core/src/operations/workflow-operations.ts`
- Modify: `packages/core/src/operations/workflow-operations.test.ts`
- Modify: `packages/core/src/db/workflows.test.ts`
- Modify: `packages/core/src/db/workflows.resume-cas.integration.test.ts`
- Modify: `packages/core/src/workflows/store-adapter.test.ts`
- Modify: `packages/workflows/src/dag-executor.test.ts`
- Modify: `packages/workflows/src/executor-preamble.test.ts`
- Modify: `packages/workflows/src/executor.test.ts`
- Modify: `packages/workflows/src/script-node-deps.test.ts`
- Modify: `packages/workflows/src/subrun.test.ts`

- [ ] Write failing SQLite integration tests for stale phase writes and stale gate resolution.

Add tests to `workflows.resume-cas.integration.test.ts` that seed a paused Plannotator gate with `gateId: 'gate-a'`.
The first test resolves the gate and then attempts a phase write for `gate-a`; the phase write must report `resolved` and preserve `approval.resolved`.
The second test rotates ownership to `gate-b` and then attempts resolution with `gate-a`; the stale resolution must lose and write no events.
The third test runs `Promise.all` with phase and approval writers and asserts there is exactly one `node_completed` event and the final resolution remains approved.

Run:

```bash
bun test packages/core/src/db/workflows.resume-cas.integration.test.ts
```

Expected before implementation: the new tests fail because the narrow store operations and `gateId` do not exist.

- [ ] Add the fencing token to the approval metadata type.

Add this optional field to `ApprovalContext` so old persisted runs remain readable:

```ts
/** Fencing token for the current plannotator_gate supervisor instance. */
gateId?: string;
```

Document that every newly paused Plannotator gate must set it even though the field is optional for migration compatibility.

- [ ] Add typed store contracts for gate identity, atomic resolution, and atomic phase replacement.

Use these shapes in `store.ts`:

```ts
export interface ApprovalGateIdentity {
  nodeId: string;
  gateId?: string;
}

export interface GateResolutionEvent {
  event_type: WorkflowEventType;
  step_name: string;
  data: Record<string, unknown>;
}

export interface PlannotatorGateTransitionInput {
  runId: string;
  nodeId: string;
  expectedGateId: string;
  nextGateId?: string;
  document: string;
  phase: NonNullable<ApprovalContext['phase']>;
}

export type PlannotatorGateTransitionResult =
  | { outcome: 'updated'; approval: ApprovalContext }
  | { outcome: 'resolved'; resolved: 'approved' | 'rejected' }
  | { outcome: 'superseded' }
  | { outcome: 'stopped'; status: WorkflowRunStatus };
```

Add these required methods to `IWorkflowStore`:

```ts
resolveApprovalGate(
  id: string,
  expected: ApprovalGateIdentity,
  metadata: Record<string, unknown>,
  events: GateResolutionEvent[]
): Promise<{ resolved: boolean }>;

transitionPlannotatorGate(
  input: PlannotatorGateTransitionInput
): Promise<PlannotatorGateTransitionResult>;
```

- [ ] Extend the existing database CAS to verify identity inside the transaction.

Change `workflowDb.resolveApprovalGate` to accept `ApprovalGateIdentity` before the metadata argument.
Inside its existing transaction, lock and normalize the current row before the conditional update.
Return `{ resolved: false }` without writing metadata or events when `nodeId` differs, when an expected `gateId` differs, when the run is not paused, or when the gate is already resolved.
Do not weaken the existing unresolved SQL predicate.
Update both `approveWorkflow` and the rework branch of `rejectWorkflow` to pass the approval context’s `{ nodeId, gateId }` identity.

- [ ] Implement `transitionPlannotatorGate` as one transaction for both dialects.

Follow the existing `persistRouteDecisionTransition` transaction pattern.
Use `FOR UPDATE` only on PostgreSQL, normalize the row, validate `approval.type === 'plannotator_gate'`, compare `nodeId` and `gateId`, and build the next approval object from the locked current object.
Write the whole nested approval object so PostgreSQL top-level JSON merge and SQLite `json_patch` produce the same result.
Never accept a caller-provided `resolved` value in this operation.

The core update must be equivalent to:

```ts
const nextApproval: ApprovalContext = {
  ...currentApproval,
  gateId: input.nextGateId ?? input.expectedGateId,
  document: input.document,
  phase: input.phase,
};
```

Return `resolved`, `superseded`, or `stopped` before issuing the update when the locked state no longer matches.

- [ ] Wire both methods through `createWorkflowStore`.

The production adapter must contain direct mappings to `workflowDb.resolveApprovalGate` and `workflowDb.transitionPlannotatorGate`.
There must be no optional callback and no read-check-write fallback in production.

- [ ] Update every strict `IWorkflowStore` test double listed in this task.

Use a small deterministic implementation for the new methods in each central mock factory.
Do not make the production methods optional merely to avoid updating test doubles.

- [ ] Add PostgreSQL SQL-shape tests and real SQLite behavior tests.

In `workflows.test.ts`, assert the PostgreSQL path locks the row, replaces the nested approval atomically, and writes audit events only for the winning resolver.
In `workflows.resume-cas.integration.test.ts`, keep the real SQLite race tests described above.

- [ ] Run the store-focused checks.

```bash
bun test packages/core/src/db/workflows.test.ts
bun test packages/core/src/db/workflows.resume-cas.integration.test.ts
bun test packages/core/src/workflows/store-adapter.test.ts
bun run type-check
```

Expected: every command exits zero, and TypeScript confirms every `IWorkflowStore` implementation has both methods.

- [ ] Commit the atomic store seam.

```bash
git add packages/workflows/src/schemas/workflow-run.ts \
  packages/workflows/src/store.ts \
  packages/core/src/db/workflows.ts \
  packages/core/src/workflows/store-adapter.ts \
  packages/core/src/operations/workflow-operations.ts \
  packages/core/src/operations/workflow-operations.test.ts \
  packages/core/src/db/workflows.test.ts \
  packages/core/src/db/workflows.resume-cas.integration.test.ts \
  packages/core/src/workflows/store-adapter.test.ts \
  packages/workflows/src/dag-executor.test.ts \
  packages/workflows/src/executor-preamble.test.ts \
  packages/workflows/src/executor.test.ts \
  packages/workflows/src/script-node-deps.test.ts \
  packages/workflows/src/subrun.test.ts
git commit -m "fix(workflows): fence plannotator gate state writes"
```

---

## Task 3: Fence the supervisor and make `pending` stop the DAG

**Files:**

- Modify: `packages/workflows/src/plannotator-gate-supervisor.ts`
- Modify: `packages/workflows/src/plannotator-gate-supervisor.test.ts`
- Modify: `packages/workflows/src/plannotator-gate-executor.ts`
- Modify: `packages/workflows/src/plannotator-gate-executor.test.ts`
- Modify: `packages/workflows/src/dag-executor.ts`
- Modify: `packages/workflows/src/dag-executor.test.ts`

- [ ] Replace the supervisor test store’s deep-merge illusion before changing production code.

Make `FakeGateStore` implement `resolveApprovalGate` and `transitionPlannotatorGate` with the same identity checks as production.
Make its generic `updateWorkflowRun` retain only top-level merge behavior so no test accidentally relies on SQLite-only nested merge.
Delete the injected `resolveGate` callback from `baseDeps`.

- [ ] Add failing supervisor tests for fencing.

Add one test where `review-open` rotates `gate-a` to `gate-b` while the old child is running.
Assert the old supervisor kills the child, returns `{ kind: 'superseded' }`, writes no completion event, and never calls `resumeWorkflowRun`.
Add one test where an old child produces an approval after rotation and assert `resolveApprovalGate` loses by identity.
Add one test where a phase transition races approval and assert the approval survives.

Run:

```bash
bun test packages/workflows/src/plannotator-gate-supervisor.test.ts
```

Expected before implementation: the new fencing tests fail.

- [ ] Make `gateId` a required supervisor dependency.

Remove `ResolveGateFn`, `resolveGate?`, and `fallbackResolveGate`.
Change the supervisor result to this discriminated union:

```ts
export type PlannotatorGateSupervisorResult =
  | { kind: 'approved'; output: string }
  | { kind: 'superseded' };
```

- [ ] Route every supervisor state write through the store CAS.

`setPhase` must call `store.transitionPlannotatorGate` with the expected `gateId`.
Map `updated` to continue, `resolved` to the existing resolution path, `stopped` to the existing terminal error, and `superseded` to child cleanup plus `{ kind: 'superseded' }`.
`recordApproval` must call `store.resolveApprovalGate` with `{ nodeId, gateId }` and return whether it won, observed a resolution, or lost ownership.
When the resolution CAS loses because the current gate has another `gateId`, the supervisor must return `superseded`; it must not fall through to `completeApproved`.
Delete every generic `updateWorkflowRun` call from the supervisor.

- [ ] Reuse a takeover token when a resumed executor re-enters the gate.

In `executePlannotatorGateNode`, inspect `workflowRun.metadata.approval`.
Reuse its `gateId` only when it is an unresolved Plannotator approval for the same node and its phase is `opening`.
Otherwise create a fresh token with `crypto.randomUUID()`.
Pass that token to the supervisor and include it in the fresh pause context.

- [ ] Return `pending` when the executor loses ownership.

Use this branch after the supervisor returns:

```ts
if (result.kind === 'superseded') {
  return { state: 'pending', output: '' };
}
return { state: 'completed', output: result.output };
```

- [ ] Make `pending` propagate as a hard stop from `runLayers`.

Change `runLayers` to return a small outcome union such as `'completed' | 'pending'`.
Return `pending` immediately after a layer produces any pending node output.
At the top-level `executeDagWorkflow` call site, return before terminal tally or `completeWorkflowRun` when the outcome is pending.
At the loop-group call site, propagate `{ state: 'pending', output: '' }` to its parent instead of converting takeover into failure.
Do not persist `node_completed` for a pending output.

This propagation is required because a replacement executor may already have changed the shared run status to `running` before the old executor reaches the between-layer status check or terminal completion code.

- [ ] Add a DAG regression test for superseded execution.

Have a node return `pending` while the mocked run status is `running`.
Assert no downstream node executes and the old invocation does not complete or fail the workflow run.

- [ ] Run the focused tests.

```bash
bun test packages/workflows/src/plannotator-gate-supervisor.test.ts
bun test packages/workflows/src/plannotator-gate-executor.test.ts
bun test packages/workflows/src/dag-executor.test.ts
```

Expected: all fencing, pending-stop, and existing route-loop tests pass.

- [ ] Commit the fenced supervisor.

```bash
git add packages/workflows/src/plannotator-gate-supervisor.ts \
  packages/workflows/src/plannotator-gate-supervisor.test.ts \
  packages/workflows/src/plannotator-gate-executor.ts \
  packages/workflows/src/plannotator-gate-executor.test.ts \
  packages/workflows/src/dag-executor.ts \
  packages/workflows/src/dag-executor.test.ts
git commit -m "fix(workflows): fence plannotator gate supervisors"
```

---

## Task 4: Enforce one normal continuation owner across every approval surface

**Files:**

- Modify: `packages/core/src/operations/workflow-operations.ts`
- Modify: `packages/core/src/operations/workflow-operations.test.ts`
- Modify: `packages/cli/src/commands/workflow.ts`
- Modify: `packages/cli/src/commands/workflow.test.ts`
- Modify: `packages/server/src/routes/api.ts`
- Modify: `packages/server/src/routes/api.workflow-runs.test.ts`
- Modify: `packages/core/src/orchestrator/orchestrator-agent.ts`
- Modify: `packages/core/src/orchestrator/orchestrator-agent.test.ts`
- Modify: `packages/core/src/orchestrator/manage-run-tool.ts`
- Modify: `packages/core/src/orchestrator/manage-run-tool.test.ts`
- Modify: `packages/core/src/handlers/command-handler.ts`
- Modify: `packages/core/src/handlers/command-handler.test.ts`

- [ ] Add failing surface tests before changing the shared result type.

Cover human CLI approve, web API approve, natural-language approval, `manage_run approve`, and slash-command approval for `approval.type === 'plannotator_gate'`.
Assert the decision is recorded, the response says the live supervisor will continue, and no resume dispatch starts.
Keep existing auto-resume behavior unchanged for standard approval and interactive-loop gates.

- [ ] Add an explicit continuation policy to `ApprovalOperationResult`.

Use:

```ts
continuation: 'caller_resume' | 'live_plannotator_supervisor';
```

Return `live_plannotator_supervisor` only for `approval.type === 'plannotator_gate'`.
Do not infer the policy again in each caller from a collapsed `type` field.

- [ ] Make each caller honor the shared policy.

Human CLI must skip `workflowRunCommand(..., { resume: true })` for the live-supervisor policy.
The approve API route must skip `tryAutoResumeAfterGate` for the live-supervisor policy.
Natural-language approval must skip workflow discovery and execution for the live-supervisor policy.
The tool and slash-command paths already defer execution, but their text must stop telling the user that a new response is required to resume.

- [ ] Preserve JSON CLI behavior.

JSON mode must still record a clean one-line envelope without starting a workflow.
Include the continuation policy in the envelope data so automation can distinguish “supervisor will continue” from “caller must resume.”

- [ ] Run every affected surface suite.

```bash
bun test packages/core/src/operations/workflow-operations.test.ts
bun test packages/cli/src/commands/workflow.test.ts
bun test packages/server/src/routes/api.workflow-runs.test.ts
bun test packages/core/src/orchestrator/orchestrator-agent.test.ts
bun test packages/core/src/orchestrator/manage-run-tool.test.ts
bun test packages/core/src/handlers/command-handler.test.ts
```

Expected: Plannotator approval starts zero replacement executions, while existing standard-gate auto-resume tests remain green.

- [ ] Commit the continuation policy.

```bash
git add packages/core/src/operations/workflow-operations.ts \
  packages/core/src/operations/workflow-operations.test.ts \
  packages/cli/src/commands/workflow.ts \
  packages/cli/src/commands/workflow.test.ts \
  packages/server/src/routes/api.ts \
  packages/server/src/routes/api.workflow-runs.test.ts \
  packages/core/src/orchestrator/orchestrator-agent.ts \
  packages/core/src/orchestrator/orchestrator-agent.test.ts \
  packages/core/src/orchestrator/manage-run-tool.ts \
  packages/core/src/orchestrator/manage-run-tool.test.ts \
  packages/core/src/handlers/command-handler.ts \
  packages/core/src/handlers/command-handler.test.ts
git commit -m "fix(workflows): keep plannotator approval supervisor-owned"
```

---

## Task 5: Make `review-open` an atomic explicit takeover

**Files:**

- Modify: `packages/core/src/operations/workflow-operations.ts`
- Modify: `packages/core/src/operations/workflow-operations.test.ts`
- Modify: `packages/cli/src/commands/workflow.ts`
- Modify: `packages/cli/src/commands/workflow.test.ts`
- Modify: `packages/server/src/routes/api.ts`
- Modify: `packages/server/src/routes/api.workflow-runs.test.ts`

- [ ] Add failing operation tests for takeover semantics.

Test that `reviewOpenWorkflow` rejects non-paused, resolved, non-Plannotator, and missing-document runs.
Test that an open gate calls `transitionPlannotatorGate` with the current `gateId`, a new `nextGateId`, the current document, and phase `opening`.
Test that `resolved`, `superseded`, and `stopped` outcomes become actionable errors rather than success responses.

- [ ] Rotate ownership instead of writing a stale approval object.

Generate the replacement token with `crypto.randomUUID()`.
Delete the generic `workflowDb.updateWorkflowRun` call from `reviewOpenWorkflow`.
Call `workflowDb.transitionPlannotatorGate` or the shared store-backed equivalent and return the new token only internally for tests and logging.

The operation return should include:

```ts
{
  document: string;
  nodeId: string;
  phase: 'opening';
  continuation: 'caller_resume';
  workflowName: string;
  workingPath: string | null;
  userMessage: string | null;
  codebaseId: string | null;
  conversationId: string;
}
```

These existing run fields give the CLI the same explicit resume context returned by `approveWorkflow`; the CLI must not rediscover the target from ambient `cwd`.

- [ ] Auto-dispatch a replacement in human CLI mode.

After the takeover succeeds, reuse the same discovery, conversation lookup, and `workflowRunCommand(..., { resume: true })` path as human approve.
Extract a private helper only if approve and review-open would otherwise duplicate the same complete block for a third time.
Do not add a new public abstraction.

- [ ] Keep JSON CLI output non-streaming.

JSON mode returns the takeover acknowledgement and `continuation: 'caller_resume'` without inline execution.
Its message must tell automation to invoke `workflow resume <id>`.

- [ ] Auto-dispatch a replacement from the web route.

Extend `tryAutoResumeAfterGate` with an explicit `review-open` action and greppable event names.
Call it after the atomic takeover.
Return success only after the takeover is recorded; if dispatch is unavailable, keep the run paused and return the existing manual-resume instruction.

- [ ] Add CLI and API regression tests.

Human CLI must dispatch exactly once.
JSON CLI must dispatch zero times.
The web route must dispatch `/workflow resume <id>` exactly once for a web parent and zero times for a non-web parent.
The old supervisor fencing test from Task 3 must prove that the replacement does not let the old DAG continue.

- [ ] Run the focused suites.

```bash
bun test packages/core/src/operations/workflow-operations.test.ts
bun test packages/cli/src/commands/workflow.test.ts
bun test packages/server/src/routes/api.workflow-runs.test.ts
```

Expected: review-open has a tested one-click human/API recovery path and a deterministic JSON automation path.

- [ ] Commit takeover recovery.

```bash
git add packages/core/src/operations/workflow-operations.ts \
  packages/core/src/operations/workflow-operations.test.ts \
  packages/cli/src/commands/workflow.ts \
  packages/cli/src/commands/workflow.test.ts \
  packages/server/src/routes/api.ts \
  packages/server/src/routes/api.workflow-runs.test.ts
git commit -m "fix(workflows): make review-open an explicit takeover"
```

---

## Task 6: Harden document validation and remove double prompt substitution

**Files:**

- Modify: `packages/workflows/src/plannotator-gate-executor.ts`
- Modify: `packages/workflows/src/plannotator-gate-executor.test.ts`
- Modify: `packages/workflows/src/plannotator-gate-supervisor.ts`
- Modify: `packages/workflows/src/plannotator-gate-supervisor.test.ts`

- [ ] Add failing path-boundary tests.

Cover a directory named `*.html`, an unreadable file, a non-HTML file, a relative path escaping `cwd`, an absolute path outside both allowed roots, and a symlink inside `cwd` whose real target escapes the roots.
Keep positive cases for a readable HTML file under `cwd` and under `artifactsDir`.

- [ ] Replace `existsSync` validation with real file and root validation.

Use only `node:fs` and `node:path`.
Resolve the candidate with `realpathSync`, require `statSync(candidate).isFile()`, require `accessSync(candidate, constants.R_OK)`, and allow only `.html` or `.htm`.
Use `relative(root, candidate)` to require the real candidate to stay inside the real `cwd` or `artifactsDir` root.
Apply the same validator to the initial document and every rework-produced document.

- [ ] Make document-path parser output strict enough for a trust boundary.

Require exactly one non-empty output line rather than silently ignoring trailing prose.
Keep spaces within the one path line valid.
Update `plannotator-gate.test.ts` so trailing commentary fails.

- [ ] Remove double placeholder substitution.

Remove `reworkPromptTemplate` and the already-filled `prompt` from the supervisor callback contract.
Pass only `documentPath` and `annotations` to `runReworkAgent`.
Build the rework prompt exactly once in `plannotator-gate-executor.ts`.

Add a test where the reviewer annotation literally contains `$REVIEW_DOCUMENT` and `$REVIEW_ANNOTATIONS`.
Assert those literal strings survive inside the inserted annotation text and are not substituted a second time.

- [ ] Run the boundary suites.

```bash
bun test packages/workflows/src/plannotator-gate.test.ts
bun test packages/workflows/src/plannotator-gate-executor.test.ts
bun test packages/workflows/src/plannotator-gate-supervisor.test.ts
```

Expected: unsafe paths and noisy path outputs fail, valid paths pass, and prompt placeholders are expanded once.

- [ ] Commit boundary hardening.

```bash
git add packages/workflows/src/plannotator-gate.ts \
  packages/workflows/src/plannotator-gate.test.ts \
  packages/workflows/src/plannotator-gate-executor.ts \
  packages/workflows/src/plannotator-gate-executor.test.ts \
  packages/workflows/src/plannotator-gate-supervisor.ts \
  packages/workflows/src/plannotator-gate-supervisor.test.ts
git commit -m "fix(workflows): harden plannotator gate inputs"
```

---

## Task 7: Verify binary capabilities and consume atomic result files

**Files:**

- Modify: `packages/workflows/src/plannotator-gate.ts`
- Modify: `packages/workflows/src/plannotator-gate.test.ts`
- Modify: `packages/workflows/src/plannotator-gate-executor.ts`
- Modify: `packages/workflows/src/plannotator-gate-executor.test.ts`
- Modify: `packages/workflows/src/plannotator-gate-supervisor.ts`
- Modify: `packages/workflows/src/plannotator-gate-supervisor.test.ts`

- [ ] Add failing capability and subprocess tests.

Test a present binary whose `annotate --help` omits `--persist-session`.
Test a present binary whose help omits `--result-file`.
Test help exit non-zero with stderr.
Test annotate exit non-zero, exit zero without a result file, valid atomic result JSON, and large stderr that would block if not drained concurrently.

- [ ] Make preflight asynchronous and behavioral.

After resolving the executable, run:

```text
resolved Plannotator binary path + annotate --help
```

Require exit code zero and require both `--persist-session` and `--result-file` in combined stdout and stderr.
Do not cache the result in v1 because gate startup is infrequent and a process-level cache would complicate environment changes.

- [ ] Add `--result-file` to the fixed argv contract.

Change the builder to accept the result path:

```ts
buildAnnotateArgv(documentPath, resultFilePath)
```

The expected argv is:

```ts
[
  'annotate',
  documentPath,
  '--gate',
  '--json',
  '--persist-session',
  '--result-file',
  resultFilePath,
]
```

- [ ] Create one result file per `gateId` and child attempt.

Place it under an existing gate-owned directory inside `artifactsDir`.
Remove any stale file before spawn and delete the result file after reading it.
Do not place decision files in the repository root.
Add `artifactsDir` to the supervisor dependencies and pass the existing executor argument through; do not derive a second artifact root.

- [ ] Drain both child pipes concurrently.

The wait implementation must start both reads before awaiting exit:

```ts
const stdoutPromise = proc.stdout
  ? new Response(proc.stdout).text()
  : Promise.resolve('');
const stderrPromise = proc.stderr
  ? new Response(proc.stderr).text()
  : Promise.resolve('');
const exitCode = await proc.exited;
const [stdout, stderr] = await Promise.all([stdoutPromise, stderrPromise]);
```

Extend the child result type with `stderr` and the result-file payload.
Parse the result-file payload with the existing strict decision parser instead of parsing mixed process stdout.

- [ ] Fail loudly on process protocol errors.

Treat non-zero exit, missing result file, unreadable result file, and invalid JSON as controlled gate errors.
Include at most 4 KiB of trimmed stderr in logs and the user-facing failure so diagnostics are useful but bounded.
Never treat an exit code as approval without a valid decision payload.

- [ ] Confirm the installed binary meets the new contract.

Run:

```bash
plannotator annotate --help
```

Expected: the output contains both `--persist-session` and `--result-file`.

- [ ] Run the subprocess suites.

```bash
bun test packages/workflows/src/plannotator-gate.test.ts
bun test packages/workflows/src/plannotator-gate-executor.test.ts
bun test packages/workflows/src/plannotator-gate-supervisor.test.ts
```

Expected: every process failure is deterministic and stderr stress does not hang.

- [ ] Commit process hardening.

```bash
git add packages/workflows/src/plannotator-gate.ts \
  packages/workflows/src/plannotator-gate.test.ts \
  packages/workflows/src/plannotator-gate-executor.ts \
  packages/workflows/src/plannotator-gate-executor.test.ts \
  packages/workflows/src/plannotator-gate-supervisor.ts \
  packages/workflows/src/plannotator-gate-supervisor.test.ts
git commit -m "fix(workflows): verify plannotator process protocol"
```

---

## Task 8: Add production-shaped gate integration coverage

**Files:**

- Modify: `packages/workflows/src/plannotator-gate-executor.test.ts`
- Modify: `packages/workflows/src/dag-executor.test.ts`
- Modify: `packages/workflows/package.json` only if a new isolated test file becomes necessary because of `mock.module` pollution

- [ ] Build a temporary fake Plannotator executable inside the tests.

Use a test-created executable with an `#!/usr/bin/env bun` shebang and `chmodSync(path, 0o755)`.
It must answer `annotate --help`, locate `--result-file`, optionally wait for a decision control file, atomically rename a temporary decision file into place, and exit with a test-controlled code.
Point `PLANNOTATOR_BIN` at it and restore the environment in `afterEach`.

The fake executable must exercise the real `Bun.spawn`, argv, result-file, stdout, stderr, and exit-code path.
Do not inject the supervisor spawn function in these integration tests.

- [ ] Add an executor-level approve test through the real spawn path.

Call `executePlannotatorGateNode` with a real temporary HTML document and production-shaped store methods.
Assert it pauses with a `gateId`, reads the approved result file, writes one `node_completed` event, resumes once, and returns `completed`.

- [ ] Add an executor-level annotation/rework test.

Make the first child return `annotated`, have the provider write and return a second valid HTML path, and make the second child return `approved`.
Assert the provider is called once, the second child receives the new document, and the final approval event is written once.

- [ ] Add a full DAG producer → gate → downstream test.

Use `executeDagWorkflow` with three nodes.
The producer writes and prints an HTML path, the real gate executor uses the fake binary, and the downstream node appends one line to a marker file.
Assert the marker has exactly one line, the gate has exactly one `node_completed` event, and `completeWorkflowRun` is called once.

- [ ] Add a full takeover race test.

Start the old gate with `gate-a`, rotate to `gate-b` through the same transition operation used by `review-open`, and run the replacement invocation.
Assert the old child is terminated, the old invocation stops on `pending`, the replacement completes, and the downstream marker is still written exactly once.

- [ ] Run coverage for the previously unexecuted production body.

```bash
bun test --coverage packages/workflows/src/plannotator-gate-executor.test.ts
bun test packages/workflows/src/dag-executor.test.ts
```

Expected: `executePlannotatorGateNode` and its DAG dispatch branch are executed by tests, and all assertions pass.

- [ ] Run the package-isolated workflow suite.

```bash
bun --filter @archon/workflows test
```

Expected: all workflow test batches pass without mock pollution.

- [ ] Commit the integration coverage.

```bash
git add packages/workflows/src/plannotator-gate-executor.test.ts \
  packages/workflows/src/dag-executor.test.ts \
  packages/workflows/package.json
git commit -m "test(workflows): cover plannotator gate end to end"
```

---

## Task 9: Re-enable the Speckit convergence rollout only behind passing tests

**Files:**

- Modify: `.archon/workflows/defaults/archon-speckit-feature.yaml`
- Modify: `packages/workflows/src/loader.test.ts`
- Modify: `packages/workflows/src/dag-executor.test.ts`
- Regenerate: `packages/workflows/src/defaults/bundled-defaults.generated.ts`

- [ ] Reconcile the current uncommitted route-loop fix before editing the default workflow.

Preserve the intended change that removes stale `when` guards from the convergence explainer and review gate.
Preserve the route-loop rerun fix and its prior-completed-node regression test unless a failing test proves a smaller correction is needed.
Do not reset or silently replace the owner’s current patch.

- [ ] Add a loader topology test for the default workflow.

Assert all of these edges and conditions:

```text
speckit-converge FAIL
  -> speckit-converge-explain
  -> speckit-converge-review-gate
  -> speckit-implement-ralph
  -> speckit-converge

speckit-converge PASS
  -> create-pull-request
```

Assert the explainer and review gate have no duplicate `when` condition that can conflict with route activation.
Assert the route loop owns the retry limit and exhausted route.

- [ ] Add one default-workflow execution test for FAIL → review → retry → PASS.

Use deterministic provider outputs and the fake Plannotator executable from Task 8.
Assert the call order contains convergence, explainer, gate, Ralph, convergence, and PR exactly in that order.
Assert the first-pass completed Ralph path is reactivated on the negative route and the PR node executes once only after PASS.

- [ ] Add one exhaustion test.

Return FAIL for every convergence attempt.
Assert the route reaches its configured exhausted target, does not create a PR, and does not spin beyond `max_iterations`.

- [ ] Regenerate the bundled file through the generator.

```bash
bun run generate:bundled
```

Expected: only the generated representation of the edited default workflow changes.

- [ ] Validate the real workflow definition.

```bash
bun run cli validate workflows archon-speckit-feature
bun run check:bundled
bun test packages/workflows/src/loader.test.ts
bun test packages/workflows/src/dag-executor.test.ts
```

Expected: workflow validation succeeds, bundled defaults are current, and both route outcomes are deterministic.

- [ ] Commit the rollout separately so it has a clean rollback path.

```bash
git add .archon/workflows/defaults/archon-speckit-feature.yaml \
  packages/workflows/src/loader.test.ts \
  packages/workflows/src/dag-executor.test.ts \
  packages/workflows/src/defaults/bundled-defaults.generated.ts
git commit -m "fix(workflows): stabilize speckit convergence review loop"
```

Rollback rule: revert only this rollout commit and regenerate bundled defaults if the convergence workflow remains unstable; keep the core gate safety fixes.

---

## Task 10: Run the complete quality gate and perform an adversarial audit

**Files:**

- Modify only files required to fix failures discovered by validation

- [ ] Run the focused gate and lifecycle suites once more.

```bash
bun test packages/workflows/src/plannotator-gate.test.ts
bun test packages/workflows/src/plannotator-gate-supervisor.test.ts
bun test packages/workflows/src/plannotator-gate-executor.test.ts
bun test packages/core/src/db/workflows.resume-cas.integration.test.ts
bun test packages/core/src/operations/workflow-operations.test.ts
bun test packages/cli/src/commands/workflow.test.ts
bun test packages/server/src/routes/api.workflow-runs.test.ts
```

Expected: all commands exit zero with no hanging child process.

- [ ] Run the full repository validation exactly as CI does.

```bash
bun run validate
```

Expected: bundled checks, schema checks, type-check, lint with zero warnings, formatting, installation tests, and all isolated package tests pass.

- [ ] Inspect the final diff for generated-file and scope mistakes.

```bash
git status --short
git diff --check
git diff --stat dev...HEAD
git diff dev...HEAD -- packages/workflows/src/defaults/bundled-defaults.generated.ts
rg -n "fallbackResolveGate|resolveGate\?|updateWorkflowRun\(.*approval" \
  packages/workflows/src/plannotator-gate-supervisor.ts \
  packages/core/src/operations/workflow-operations.ts
```

Expected: no whitespace errors, no fallback resolver, no generic approval phase write, and the generated diff matches the YAML source change.

- [ ] Perform a final lifecycle matrix review.

Verify these scenarios from tests and persisted events:

| Scenario | Expected owner | Expected terminal behavior |
|---|---|---|
| Child approves | Existing supervisor | Resume once, downstream once |
| API or CLI approves | Existing supervisor | Record only, supervisor resumes |
| Child returns annotations | Existing supervisor | Rework once, reopen with same `gateId` |
| Reviewer invokes review-open | Replacement supervisor | Old returns pending, replacement runs |
| Old child approves after takeover | No ownership | CAS loses, no events |
| Child exits non-zero | Existing supervisor | Controlled failure with bounded stderr |
| Result file missing or invalid | Existing supervisor | Controlled failure, never implicit approval |
| Run is cancelled or abandoned | No owner | Child killed, no downstream work |

- [ ] Commit only genuine validation fixes.

Stage each exact file reported by `git status --short` only after inspecting its diff, then commit with `test(workflows): close plannotator gate validation gaps`.
Skip this commit when validation required no changes.

## Completion Criteria

- [ ] Production uses required store CAS methods; no optional approval fallback remains.
- [ ] PostgreSQL top-level JSON merge cannot erase a concurrent resolution.
- [ ] SQLite and PostgreSQL SQL-shape tests cover the same identity contract.
- [ ] Normal external Plannotator approval cannot start a second executor.
- [ ] Review-open takeover fences the old supervisor and starts at most one replacement dispatch per caller.
- [ ] A pending node cannot leak into downstream execution.
- [ ] Binary capability, result-file, exit-code, stderr, path, and prompt-substitution failures are tested.
- [ ] `executePlannotatorGateNode` and DAG dispatch are covered through production-shaped execution.
- [ ] Speckit convergence FAIL, PASS, retry, and exhaustion paths are tested before rollout.
- [ ] `bun run validate` passes.
