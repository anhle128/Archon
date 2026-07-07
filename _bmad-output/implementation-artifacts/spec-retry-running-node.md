---
title: 'Retry Running Workflow Node'
type: 'feature'
created: '2026-07-03'
status: 'draft'
context:
  - '{project-root}/CLAUDE.md'
---

<frozen-after-approval reason="human-owned intent - do not modify unless human renegotiates">

## Intent

**Problem:** Operators can retry a failed DAG node, but a node that is visibly stuck in `running` state cannot be retried from the CLI or Web UI.
This blocks recovery for long-running AI nodes where the process is alive enough to keep the run open but no longer making useful progress.

**Approach:** Treat a retry of the currently running target node as an explicit manual supersession.
The retry must increment the run retry epoch, invalidate the target node plus descendants, start the same retry execution path used for failed nodes, and make older lower-epoch attempts stop or become projection-ignored if they emit late events.

## Boundaries & Constraints

**Always:** Preserve the existing failed-node retry behavior.
Keep running-node retry as a user-triggered action through the existing CLI and Web retry surfaces.
Require the selected node's latest effective state to be `failed` or `running`.
Use retry epoch metadata as the cross-process supersession signal.
Ignore stale lower-epoch node lifecycle events after a retry request invalidates a node.
Keep route-loop controller retry blocked and guide the user to `route_loop.from`.

**Ask First:** Ask before adding a new workflow run status, a new database table, or a background stale-run cleanup service.
Ask before changing retry semantics for paused, completed, cancelled, skipped, or pending nodes.
Ask before making retry automatically trigger from idle timestamps.

**Never:** Do not silently cancel or fail running work based only on staleness.
Do not add a destructive `git clean` path.
Do not allow retry of arbitrary running descendants when the selected node is not itself the running or failed target.
Do not let an older pre-retry executor mark the run failed or completed after a newer retry epoch owns the run.

## I/O & Edge-Case Matrix

| Scenario                  | Input / State                                                                                        | Expected Output / Behavior                                                                    | Error Handling                                                                                 |
| ------------------------- | ---------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Failed node retry         | Run status is `failed`; selected node latest state is `failed`                                       | Existing retry behavior remains unchanged                                                     | Existing retry errors remain unchanged                                                         |
| Running node retry        | Run status is `running`; selected node latest state is `running`                                     | Retry epoch increments; selected node and descendants are invalidated; retry execution starts | If preparation or dispatch fails after claim, run is failed with retry setup or dispatch error |
| Running run, wrong target | Run status is `running`; selected node latest state is `completed`, `skipped`, `pending`, or unknown | Retry is rejected                                                                             | Error explains the latest effective node status                                                |
| Stale event race          | Old attempt emits lower-epoch `node_completed` or `node_failed` after `node_retry_requested`         | Projection keeps the retry epoch state and does not regress to stale output                   | Stale event is ignored by projection logic                                                     |
| Route-loop controller     | Selected node is a `route_loop` controller                                                           | Retry is rejected with source-node guidance                                                   | Existing route-loop guidance is preserved                                                      |

</frozen-after-approval>

## Code Map

- `packages/core/src/operations/workflow-retry.ts` -- Shared retry eligibility, event projection check, checkpoint setup, session invalidation, and retry audit events.
- `packages/core/src/db/workflows.ts` -- CAS claim that moves a retryable run into the next retry epoch.
- `packages/cli/src/commands/workflow.ts` -- CLI `workflow retry-node` status gate and dispatch path.
- `packages/server/src/routes/api.ts` -- Web retry API gate, error mapping, dispatch, and API node-state projection.
- `packages/web/src/lib/workflow-retry.ts` -- Web retry affordance eligibility and CLI guidance generation.
- `packages/web/src/components/workflows/WorkflowNodeRetryAction.tsx` -- User-facing retry panel copy and action rendering.
- `packages/workflows/src/dag-executor.ts` -- DAG executor status checks that must stop older retry epochs from writing terminal state.
- `packages/workflows/src/retry-state.ts` -- Latest effective node-state projection used by retry preparation and run-detail APIs.
- `packages/core/src/operations/workflow-retry.test.ts` -- Shared retry behavior tests.
- `packages/core/src/db/workflows.test.ts` -- Retry claim CAS tests.
- `packages/workflows/src/retry-state.test.ts` -- Projection tests for stale lower-epoch lifecycle events.
- `packages/web/src/lib/workflow-retry.test.ts` and `packages/web/src/components/workflows/WorkflowNodeRetryAction.test.tsx` -- Web eligibility and rendering tests.

## Tasks & Acceptance

**Execution:**

- [ ] `packages/workflows/src/retry-state.ts` -- Make projection ignore lifecycle events whose retry epoch is older than the current projected state for that node -- prevents stale old attempts from overwriting a manual retry.
- [ ] `packages/core/src/operations/workflow-retry.ts` -- Accept `failed` runs with failed target nodes and `running` runs with running target nodes -- keeps retry explicit and target-scoped.
- [ ] `packages/core/src/db/workflows.ts` -- Let the retry claim CAS advance `failed` or `running` runs into the next retry epoch -- provides one atomic ownership transition for both retry modes.
- [ ] `packages/cli/src/commands/workflow.ts` -- Remove the failed-only pre-gate and rely on shared retry preparation for precise status and node-state errors -- keeps CLI behavior consistent with Web.
- [ ] `packages/server/src/routes/api.ts` -- Allow Web retry API calls for `failed` and `running` runs and keep other statuses rejected -- exposes the new behavior without broad lifecycle mutation.
- [ ] `packages/web/src/lib/workflow-retry.ts` and `packages/web/src/components/workflows/WorkflowNodeRetryAction.tsx` -- Show retry action for eligible running nodes and update copy so it is not failed-node-only -- makes the visible stuck-node workflow recoverable.
- [ ] `packages/workflows/src/dag-executor.ts` -- Treat a higher stored retry epoch as superseding the current executor and skip terminal writes from the older executor -- prevents old attempts from clobbering the retry.
- [ ] Tests listed in the Code Map -- Add or update focused unit tests for the matrix above -- locks behavior without relying on slow live AI runs.

**Acceptance Criteria:**

- Given a workflow run is `running` and selected node `dev-story` is latest effective `running`, when the user runs `archon workflow retry-node <run-id> dev-story`, then the retry is accepted and a new retry epoch starts for `dev-story` and downstream nodes.
- Given a workflow run is `running` and selected node `prepare-bmad-state` is latest effective `completed`, when the user retries that node, then the retry is rejected with a message naming the node's latest effective status.
- Given a Web-created running run has a selected running node, when the user selects that node in the run detail view, then the retry action is visible and posts to the existing retry endpoint.
- Given an older executor emits a lower-epoch node lifecycle event after retry has been requested, when node states are projected, then the older event does not replace the newer retry epoch state.
- Given an older executor observes that the database retry epoch is higher than its own epoch, when it reaches a streaming or layer boundary check, then it stops without marking the run completed or failed.

## Design Notes

Retrying a running node is not the same as automatic orphan cleanup.
It is an explicit operator action against a selected node, and the retry epoch is the authority that separates the old attempt from the new one.
This matches the existing retry model, keeps the same run id, and avoids inventing a second lifecycle for forced retries.

The executor must compare the epoch it started with against the current persisted epoch.
`status: running` alone is no longer enough to mean "this executor still owns the run" once a manual running-node retry is allowed.

## Verification

**Commands:**

- `bun test packages/workflows/src/retry-state.test.ts` -- expected: projection ignores stale lower-epoch lifecycle events.
- `bun test packages/core/src/operations/workflow-retry.test.ts` -- expected: retry preparation accepts failed/failed and running/running pairs, and rejects mismatched node states.
- `bun test packages/core/src/db/workflows.test.ts` -- expected: retry claim CAS accepts failed or running statuses and still reports conflicts.
- `bun test packages/web/src/lib/workflow-retry.test.ts packages/web/src/components/workflows/WorkflowNodeRetryAction.test.tsx` -- expected: Web retry action appears for eligible running nodes and keeps route-loop guidance.
- `bun run type-check` -- expected: TypeScript passes with strict types.
