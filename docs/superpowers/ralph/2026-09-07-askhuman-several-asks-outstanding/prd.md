# Keep Several Asks Outstanding Without a Second Scheduler Ralph PRD

Source plan: `docs/superpowers/plans/2026-09-07-askhuman-several-asks-outstanding.md`
Derived slug: `2026-09-07-askhuman-several-asks-outstanding`

## Overview

Story 6.4 of the Workflow Run View HITL epic proves and preserves the contract for multiple outstanding `AskHuman` interactions across concurrent nodes, repeated asks from one node, and child runs without introducing per-node scheduling or a second pause model (`docs/superpowers/plans/2026-09-07-askhuman-several-asks-outstanding.md:7-12`).

Archon maintains a single run-scoped pause model where each `AskHuman` call persists one pending-interaction row and idempotently pauses the workflow run (`docs/superpowers/plans/2026-09-07-askhuman-several-asks-outstanding.md:9-11`). The database remains the source of truth for the run-wide pending count; the retry-state projector derives each node's `awaiting` overlay from pending rows owned by that node; and the DAG executor allows already-started sibling streams to complete while refusing to schedule another layer after any node awaits input. Child workflow asks stay keyed to the child `workflow_run_id`, with the existing child-pause policy propagating the pause to the parent without copying rows.

Because Stories 6.1 through 6.3 already implemented these production mechanics, this work is predominantly characterization coverage. The only behavioral defect discovered is in the stateful sub-run test double (`InMemoryStore.pauseWorkflowRun()` in `packages/workflows/src/subrun.test.ts`), which incorrectly creates approval metadata on an Ask-only pause (`docs/superpowers/plans/2026-09-07-askhuman-several-asks-outstanding.md:12, 45-46, 644-646`).

Linked issue: [#89](https://github.com/anhle128/Archon/issues/89).
Canonical specifications: `_bmad-output/specs/spec-workflow-run-view-hitl/SPEC.md` (CAP-5), `_bmad-output/planning-artifacts/epics-workflow-run-view-hitl/epics.md` (Story 6.4).

## Problem

While single AskHuman interactions pause and resume as expected, concurrent workflow execution introduces complex multi-interaction edge cases that must be characterized and defended against regression:

1. **Concurrent Sibling Asks**: When two independent agent nodes in the same DAG layer invoke `AskHuman` concurrently, the first pause changes the run status to `paused`. The second node must still be able to persist its pending row and complete its `sendQuery` teardown without failing on an "already paused" precondition (`docs/superpowers/plans/2026-09-07-askhuman-several-asks-outstanding.md:438-454`).
2. **In-Flight Sibling Streaming**: A sibling node already running when another node pauses the run must be permitted to finish streaming its response and record `node_completed` rather than being abruptly severed or dropped (`docs/superpowers/plans/2026-09-07-askhuman-several-asks-outstanding.md:498-545`).
3. **DAG Layer Boundary**: While running siblings may finish, no subsequent DAG layer may start execution while any node in the current layer remains awaiting input (`docs/superpowers/plans/2026-09-07-askhuman-several-asks-outstanding.md:26, 475-476, 495-497`).
4. **Multiple Asks on One Node**: An agent node may invoke `AskHuman` multiple times across a turn. That node must stay in `awaiting` state as long as any of its pending rows remains unresolved, and must not prematurely transition to completed or failed (`docs/superpowers/plans/2026-09-07-askhuman-several-asks-outstanding.md:103-117, 551-601`).
5. **Run-Wide Atomic CAS**: Resolving an Ask when other pending rows remain on the run (including non-Ask kinds such as `permission`) must return `resumed: false` and keep the run `paused`. The run must resume to `running` only when the remaining count reaches zero in that exact database transaction (`docs/superpowers/plans/2026-09-07-askhuman-several-asks-outstanding.md:28, 197-279`).
6. **Child Run Isolation**: A child workflow (`workflow:` node) that invokes `AskHuman` must record the pending row under the child `workflow_run_id`. Attempting to resolve the Ask via the parent `runId` must fail with `PendingInteractionNotFoundError` (`docs/superpowers/plans/2026-09-07-askhuman-several-asks-outstanding.md:30, 284-330`).
7. **Test Double Divergence**: In `packages/workflows/src/subrun.test.ts`, `InMemoryStore.pauseWorkflowRun()` unconditionally populates `metadata.approval` even when `approvalContext` is `undefined`, diverging from the production SQLite/Postgres behavior (`docs/superpowers/plans/2026-09-07-askhuman-several-asks-outstanding.md:45, 644-646`).
8. **Stale Documentation**: Internal comments in `packages/workflows/src/dag-executor.ts` describe paused stream continuation as approval-only (`docs/superpowers/plans/2026-09-07-askhuman-several-asks-outstanding.md:56, 613-619`).

## Solution

Systematically characterize the repository's verified baseline through focused, deterministic test coverage across each owning architectural layer:

1. **Projection (`packages/workflows/src/retry-state.test.ts`)**: Add tests proving that `projectLatestEffectiveNodeStates()` overlays `awaiting` onto a node with mixed answered/pending rows and isolates `awaiting` to the specific sibling node that owns the pending row (`docs/superpowers/plans/2026-09-07-askhuman-several-asks-outstanding.md:90-162`).
2. **Database Transactions (`packages/core/src/db/workflow-pending-interactions.test.ts`)**: In real SQLite, prove that answering one of several asks yields `resumed: false`, that pending permission rows prevent resume, and that child Asks can only be answered using the child `runId` (`docs/superpowers/plans/2026-09-07-askhuman-several-asks-outstanding.md:165-350`).
3. **DAG Scheduling Concurrency (`packages/workflows/src/dag-executor.test.ts`, `dag-executor.ts`)**: Use deterministic promise barriers (`deferred()`) to characterize two concurrent Ask nodes, in-flight streaming completion during pause, and same-node multiple Asks. Correct three stale comments in `dag-executor.ts` (`docs/superpowers/plans/2026-09-07-askhuman-several-asks-outstanding.md:353-635`).
4. **Sub-Run Harness & Child Ownership (`packages/workflows/src/subrun.test.ts`)**: Execute a strict red-green cycle to repair `InMemoryStore.pauseWorkflowRun()` so Ask-only pauses omit approval metadata. Add an end-to-end child run test proving child row ownership and parent pause propagation (`docs/superpowers/plans/2026-09-07-askhuman-several-asks-outstanding.md:637-862`).
5. **Read Model (`packages/server/src/routes/api.workflow-runs.test.ts`)**: Characterize that GET `/api/workflows/runs/:runId` embeds all pending and answered rows for sibling and same-node asks and projects all pending owners as `awaiting` (`docs/superpowers/plans/2026-09-07-askhuman-several-asks-outstanding.md:865-1002`).
6. **Validation & Tracking (`_bmad-output/implementation-artifacts/workflow-run-view-hitl/sprint-status.yaml`)**: Execute the full package test matrix and `bun run validate`. Resolve the 2 registered timestamp conflicts in `sprint-status.yaml` using `@theirs` (commit `c25ea00c`), mark Story 6.4 `done`, and prepare PR handoff (`docs/superpowers/plans/2026-09-07-askhuman-several-asks-outstanding.md:1005-1090`).

## Goals and Success Metrics

| Goal | Success Metric | Evidence Source |
| --- | --- | --- |
| Sibling Node Ask Concurrency | Two concurrent nodes persist Ask rows; second persist-and-pause teardown succeeds after the first pause; downstream layer does not start | `packages/workflows/src/dag-executor.test.ts` (`docs/superpowers/plans/2026-09-07-askhuman-several-asks-outstanding.md:438-496`) |
| Sibling Stream Completion | In-flight streaming sibling finishes streaming and records `node_completed` while run is paused by another node | `packages/workflows/src/dag-executor.test.ts` (`docs/superpowers/plans/2026-09-07-askhuman-several-asks-outstanding.md:498-545`) |
| Same-Node Multiple Asks | Two Ask calls from one node persist distinct rows and keep node `awaiting` without completed or failed events | `packages/workflows/src/retry-state.test.ts`, `packages/workflows/src/dag-executor.test.ts` (`docs/superpowers/plans/2026-09-07-askhuman-several-asks-outstanding.md:103-117, 551-601`) |
| Run-Wide Pending CAS | Answering one row returns `resumed: false` and remaining count; answering the last row of any kind transitions run to `running` with `resumed: true` in one transaction | `packages/core/src/db/workflow-pending-interactions.test.ts` (`docs/superpowers/plans/2026-09-07-askhuman-several-asks-outstanding.md:197-279`) |
| Child Run Ask Isolation | Child Ask rows are stored under child `workflow_run_id`; parent pauses without copying rows; resolving through parent run ID throws `PendingInteractionNotFoundError` | `packages/core/src/db/workflow-pending-interactions.test.ts`, `packages/workflows/src/subrun.test.ts` (`docs/superpowers/plans/2026-09-07-askhuman-several-asks-outstanding.md:284-330, 728-842`) |
| Test Double Parity | `InMemoryStore.pauseWorkflowRun` sets `status = 'paused'` without adding `metadata.approval` when `approvalContext` is undefined | `packages/workflows/src/subrun.test.ts` (`docs/superpowers/plans/2026-09-07-askhuman-several-asks-outstanding.md:651-713`) |
| Read Model Embedding | GET `/api/workflows/runs/:runId` embeds all rows and projects all pending owners as `awaiting` | `packages/server/src/routes/api.workflow-runs.test.ts` (`docs/superpowers/plans/2026-09-07-askhuman-several-asks-outstanding.md:880-982`) |
| Full Pre-PR Validation | All package test suites, `git diff --check`, and root `bun run validate` exit 0; `sprint-status.yaml` marked `done` without conflicts | Test runner, linter, typecheck, `sprint-status.yaml` (`docs/superpowers/plans/2026-09-07-askhuman-several-asks-outstanding.md:1012-1083`) |

## Non-Goals

- Adding per-node pause state or an independent per-node resume scheduler (e.g., allowing an unblocked sibling to progress past an Ask while the run remains running) (`docs/superpowers/plans/2026-09-07-askhuman-several-asks-outstanding.md:31, 465-468`).
- Adding a second Ask HTTP endpoint, a new run status enum value (e.g., `awaiting` run status), or new workflow YAML fields (`docs/superpowers/plans/2026-09-07-askhuman-several-asks-outstanding.md:31`).
- Changing production database schemas, migrations, OpenAPI schemas, or generated web API types (`docs/superpowers/plans/2026-09-07-askhuman-several-asks-outstanding.md:32`).
- Inferring run chrome from `nodeStates`; the UI contract remains `run.status === 'paused' && pending_interactions.some(row => row.status === 'pending')` (`docs/superpowers/plans/2026-09-07-askhuman-several-asks-outstanding.md:33, 980-982`).
- Modifying production DAG executor logic beyond correcting stale comments (`docs/superpowers/plans/2026-09-07-askhuman-several-asks-outstanding.md:56, 618-619`).
- Modifying UI components or rendering cards (owned by Stories 6.5 and 6.6).

## Technical Context

- `packages/workflows/src/retry-state.ts`: Implements row-driven per-node `awaiting` overlay (`docs/superpowers/plans/2026-09-07-askhuman-several-asks-outstanding.md:40, 63`).
- `packages/workflows/src/retry-state.test.ts`: Target of Task 1 projector characterization tests (`docs/superpowers/plans/2026-09-07-askhuman-several-asks-outstanding.md:90-162`).
- `packages/core/src/db/workflow-pending-interactions.ts`: Owns run-scoped pending counting and atomic resolution in SQLite/Postgres (`docs/superpowers/plans/2026-09-07-askhuman-several-asks-outstanding.md:41, 64`).
- `packages/core/src/db/workflow-pending-interactions.test.ts`: Target of Task 2 transaction and ownership tests in real SQLite (`docs/superpowers/plans/2026-09-07-askhuman-several-asks-outstanding.md:165-350`).
- `packages/core/src/db/workflows.ts`: Implements idempotent Ask-only pause without metadata changes (`docs/superpowers/plans/2026-09-07-askhuman-several-asks-outstanding.md:65`).
- `packages/workflows/src/dag-executor.ts`: DAG executor handling layer scheduling with `Promise.allSettled`, checking `shouldContinueStreamingForStatus`, and catching `AskHumanAwaitingError` (`docs/superpowers/plans/2026-09-07-askhuman-several-asks-outstanding.md:42, 68, 613-619`).
- `packages/workflows/src/dag-executor.test.ts`: Target of Task 3 concurrency characterization with deferred promise barriers (`docs/superpowers/plans/2026-09-07-askhuman-several-asks-outstanding.md:353-635`).
- `packages/workflows/src/subrun.test.ts`: Contains `InMemoryStore` test double to repair under TDD red-green cycle, and receives child Ask e2e test (`docs/superpowers/plans/2026-09-07-askhuman-several-asks-outstanding.md:45, 637-862`).
- `packages/server/src/routes/api.ts`: Supplies pending interaction list to `projectLatestEffectiveNodeStates` and dispatches continuation on `resumed: true` (`docs/superpowers/plans/2026-09-07-askhuman-several-asks-outstanding.md:44, 69`).
- `packages/server/src/routes/api.workflow-runs.test.ts`: Target of Task 5 run-detail read model tests (`docs/superpowers/plans/2026-09-07-askhuman-several-asks-outstanding.md:865-1002`).
- `_bmad-output/implementation-artifacts/workflow-run-view-hitl/sprint-status.yaml`: Sprint status file with registered merge conflicts to resolve before marking Story 6.4 `done` (`docs/superpowers/plans/2026-09-07-askhuman-several-asks-outstanding.md:46-48, 1005-1083`).

## Story Overview

| Priority | Story ID | Title | Depends On | Plan Anchors |
| --- | --- | --- | --- | --- |
| 1 | US-001 | Characterize pending-row node projection for mixed rows and sibling nodes | - | Task 1: 90-162 |
| 2 | US-002 | Characterize run-wide Ask resolution, multi-kind blockers, and run ownership in SQLite | US-001 | Task 2: 165-350 |
| 3 | US-003 | Characterize concurrent DAG Ask scheduling and update executor comments | US-001 | Task 3: 353-635 |
| 4 | US-004 | Repair stateful sub-run test double and characterize child run Ask ownership | US-001, US-002, US-003 | Task 4: 637-862 |
| 5 | US-005 | Characterize run-detail API read model with multiple outstanding Ask rows | US-001, US-002 | Task 5: 865-1002 |
| 6 | US-006 | Run full validation matrix, resolve tracking conflicts, and mark Story 6.4 done | US-001, US-002, US-003, US-004, US-005 | Task 6: 1005-1083 |
