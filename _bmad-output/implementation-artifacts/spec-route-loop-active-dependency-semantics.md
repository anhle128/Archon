---
title: 'Route Loop Active Dependency Semantics'
type: 'feature'
created: '2026-07-09T00:00:00+07:00'
status: 'done'
baseline_commit: '4a1334a495b04fa88a23dfb83e024a08dd32e782'
context:
  - '{project-root}/_bmad-output/project-context.md'
---

<frozen-after-approval reason="human-owned intent - do not modify unless human renegotiates">

## Intent

**Problem:** `route_loop.from` duplicates `depends_on` and forces a single condition source, which blocks route-loop nodes that need to accept more than one possible incoming source while evaluating only the active path.
The BMAD readiness/correct-course loop needs `bmad-check-implementation-readiness` to depend on both the initial validation path and the correction path, but a negative rerun must not let stale validation success satisfy `one_success`.

**Approach:** Remove `route_loop.from` from the public workflow shape and make the route-loop node's `depends_on` list the allowed condition source set.
During route-loop scheduled reruns, track the active dependency for each rerun node and evaluate trigger rules against that active dependency instead of every dependency.

## Boundaries & Constraints

**Always:** Preserve normal DAG trigger behavior outside route-loop scheduled execution.
Reject legacy YAML that still declares `route_loop.from`.
Require every route-loop controller to have at least one `depends_on` entry.
Require every `$node.output...` reference in `route_loop.condition` to reference a node listed in that controller's `depends_on`.
Keep `bmad-check-implementation-readiness` with `depends_on: [validate-bmad-command, bmad-correct-course]` and `trigger_rule: one_success`.
Regenerate bundled defaults instead of hand-editing generated files.
Preserve existing unrelated dirty worktree changes.

**Ask First:** Halt before changing route-loop behavior for non-scheduled normal DAG execution or before deleting/rewriting unrelated default workflows.

**Never:** Do not add a replacement `source` field to `route_loop`.
Do not silently accept legacy `route_loop.from`.
Do not make route-loop conditions read arbitrary nodes outside `depends_on`.
Do not manually edit generated bundle files.

## I/O & Edge-Case Matrix

| Scenario                 | Input / State                                                                                             | Expected Output / Behavior                                                             | Error Handling                                                                 |
| ------------------------ | --------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| Initial readiness path   | `bmad-check-implementation-readiness` depends on validation and correction; only validation has completed | Readiness runs because the active incoming source is `validate-bmad-command`           | Missing validation output still skips or fails per existing trigger behavior   |
| Negative correction path | Route-loop selects `bmad-correct-course`, then readiness is scheduled for rerun                           | Readiness evaluates `one_success` against active dependency `bmad-correct-course` only | If correction failed, readiness does not rerun due to stale validation success |
| Legacy route-loop YAML   | Controller declares `route_loop.from`                                                                     | Loader rejects the workflow                                                            | Validation error names the unsupported field or legacy shape                   |
| Invalid condition source | Condition references `$other.output.result` but `other` is not in controller `depends_on`                 | Loader rejects the workflow                                                            | Validation error names the unauthorized reference                              |

</frozen-after-approval>

## Code Map

- `packages/workflows/src/schemas/route-loop.ts` -- engine schema for route-loop configuration.
- `packages/workflows/src/loader.ts` -- graph-level route-loop validation and condition reference checks.
- `packages/workflows/src/dag-executor.ts` -- route-loop condition evaluation, negative rerun planning, trigger-rule checks, and active rerun scheduling.
- `packages/workflows/src/route-loop-state.ts` -- persisted route decision event payload and structured route-loop output.
- `packages/core/src/schemas/workflow-event.ts` and `packages/server/src/routes/schemas/workflow.schemas.ts` -- API-facing node-routed event validation.
- `packages/web/src/lib/dag-layout.ts`, `packages/web/src/components/workflows/WorkflowCanvas.tsx`, `packages/web/src/components/workflows/NodeInspector.tsx`, and `/console` builder files -- visual graph import, editing, validation, and export.
- `.archon/workflows/defaults/bmad-readiness-correct-course-loop.yml` -- bundled default workflow source that must drop `route_loop.from`.

## Tasks & Acceptance

**Execution:**

- [x] `packages/workflows/src/schemas/route-loop.ts` -- remove `from` from the schema and types -- makes `depends_on` the single source declaration.
- [x] `packages/workflows/src/loader.ts` -- update route-loop validation for non-empty `depends_on`, unknown dependencies, no `when` on source nodes, exit routes, and condition references limited to the dependency set -- rejects ambiguous or legacy workflows before execution.
- [x] `packages/workflows/src/dag-executor.ts` -- replace `route_loop.from` usages with active source resolution and schedule active dependency ids for rerun nodes -- prevents stale dependency outputs from satisfying trigger rules.
- [x] `packages/workflows/src/route-loop-state.ts`, `packages/core/src/schemas/workflow-event.ts`, and route/API tests -- replace decision payload `from` with `sources: string[]` -- keeps runtime events aligned with the new contract.
- [x] `packages/web` workflow builder and `/console` builder files -- serialize route-loop controllers without `from`, preserve multiple incoming dependencies, render the BMAD loop with the main positive lane and lower negative correction lane, and avoid serializing visual aliases as extra workflow nodes -- keeps the UI faithful to the engine.
- [x] `.archon/workflows/defaults/bmad-readiness-correct-course-loop.yml` -- remove `route_loop.from`, keep readiness dependencies and `one_success`, then run `bun run generate:bundled` -- updates source and generated defaults safely.
- [x] Focused loader, executor, API/schema, and UI tests -- add regressions for the matrix above -- proves the route-loop active path behavior.

**Acceptance Criteria:**

- Given a route-loop controller with `depends_on: [review, corrected-review]`, when its condition references only those nodes, then workflow loading succeeds.
- Given a route-loop controller with `route_loop.from`, when workflow loading validates it, then the workflow is rejected.
- Given a negative route-loop rerun where `bmad-correct-course` fails, when readiness has stale validation success from the first pass, then readiness is not rerun.
- Given the BMAD default workflow, when the builder lays out the graph, then the main lane proceeds to `positive -> end` and the lower lane proceeds through `negative -> bmad-correct-course -> bmad-check-implementation-readiness`.
- Given a visual alias is used to communicate repeated readiness in the graph, when the workflow serializes, then only one real readiness DAG node is emitted.

## Design Notes

Active dependency tracking should stay local to route-loop scheduled execution.
The scheduler can keep a map from rerun node id to active dependency ids and pass those ids to `checkTriggerRule`.
Normal topological DAG execution should continue to call trigger evaluation with the node's full `depends_on` list.
Route-loop condition evaluation can resolve its source set from the controller's `depends_on`, but a condition must still evaluate against the full `nodeOutputs` map so existing `$node.output.field` substitution semantics remain intact after loader validation.

## Verification

**Commands:**

- `bun test packages/workflows/src/loader.test.ts` -- passed.
- `bun test packages/workflows/src/schemas.test.ts` -- passed.
- `bun test packages/workflows/src/retry-state.test.ts` -- passed.
- `bun test packages/workflows/src/dag-executor.test.ts` -- passed.
- `bun test packages/core/src/schemas/index.test.ts && bun test packages/core/src/db/workflow-events.test.ts && bun test packages/core/src/db/workflows.test.ts && bun test packages/core/src/db/workflows.resume-cas.integration.test.ts && bun test packages/core/src/operations/workflow-retry.test.ts` -- passed.
- `bun test packages/server/src/routes/api.workflows.test.ts && bun test packages/server/src/routes/api.workflow-runs.test.ts && bun test packages/server/src/adapters/web/dashboard-event-poller.test.ts && bun test packages/server/src/adapters/web/workflow-bridge.test.ts` -- passed.
- `bun --filter @archon/web test` -- passed.
- `bun test packages/web/src/components/workflows/WorkflowExecution.test.tsx` -- passed after the generated API type guard fix.
- `bun run generate:bundled` -- passed and regenerated bundled defaults.
- `bun --filter @archon/web generate:types` -- passed and regenerated OpenAPI web types.
- `bun run check:bundled` -- passed.
- `bun run type-check` -- passed.

## Suggested Review Order

**Engine Contract**

- Start with the public schema shape: `from` is gone.
  [`route-loop.ts:29`](../../packages/workflows/src/schemas/route-loop.ts#L29)

- Loader makes `depends_on` the validated route-loop source set.
  [`loader.ts:142`](../../packages/workflows/src/loader.ts#L142)

- Trigger evaluation accepts active dependencies only when scheduled.
  [`dag-executor.ts:761`](../../packages/workflows/src/dag-executor.ts#L761)

- Negative rerun planning computes active path dependencies.
  [`dag-executor.ts:925`](../../packages/workflows/src/dag-executor.ts#L925)

- Layer execution snapshots and applies active dependency ids.
  [`dag-executor.ts:3428`](../../packages/workflows/src/dag-executor.ts#L3428)

- Route controllers require only active source outputs during reruns.
  [`dag-executor.ts:3848`](../../packages/workflows/src/dag-executor.ts#L3848)

**Route Decision Data**

- Route-loop transition output now emits `sources`.
  [`route-loop-state.ts:18`](../../packages/workflows/src/route-loop-state.ts#L18)

- Core event validation accepts `sources`.
  [`workflow-event.ts:10`](../../packages/core/src/schemas/workflow-event.ts#L10)

**Builder And Defaults**

- Builder edge generation preserves multiple route-loop inputs.
  [`WorkflowBuilder.tsx:60`](../../packages/web/src/components/workflows/WorkflowBuilder.tsx#L60)

- Canvas serialization keeps dependencies outside `route_loop`.
  [`WorkflowCanvas.tsx:103`](../../packages/web/src/components/workflows/WorkflowCanvas.tsx#L103)

- Graph layout suppresses duplicate route target dependency edges.
  [`dag-layout.ts:153`](../../packages/web/src/lib/dag-layout.ts#L153)

- Default readiness workflow keeps the two-source readiness join.
  [`bmad-readiness-correct-course-loop.yml:74`](../../.archon/workflows/defaults/bmad-readiness-correct-course-loop.yml#L74)

**Regression Tests**

- Loader rejects legacy `from` and accepts multi-source conditions.
  [`loader.test.ts:2169`](../../packages/workflows/src/loader.test.ts#L2169)

- Executor proves stale validation success cannot trigger readiness.
  [`dag-executor.test.ts:5974`](../../packages/workflows/src/dag-executor.test.ts#L5974)

- Web serialization avoids writing `route_loop.from`.
  [`WorkflowCanvas.test.ts:6`](../../packages/web/src/components/workflows/WorkflowCanvas.test.ts#L6)
