---
title: 'Phase 2: Transcript and Execution History'
status: done
---

# Phase 2: Transcript and Execution History

## Outcome

Priority: P1.
Estimate: 36-52h, including the inline review-feedback path.
Dependency: Phase 1 red reproduction and visual inventory.
Produce complete, bounded transcript data and one server-owned execution history for both UIs.
Keep existing API callers compatible.
No workflow YAML or authorization changes are in scope.

## Source Findings

Both provider loops in `dag-executor.ts` append tool calls but omit tool results.
Transcript rows lack execution identity.
Both UI history builders collapse reruns, and room selectors can include later output.
The existing database CHECK admits only `text`, `tool`, and `status`.
The writer awaits each append but fails open without logging content.
Preserve those constraints while adding the missing information.

## Proposed Data Contract

All new symbols in this section are proposals, not existing APIs.
Use Zod schemas and derived types for persisted and HTTP data.

| Data                 | Proposed representation                                                                | Invariant                                                            |
| -------------------- | -------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| Occurrence           | `occurrence_id`, UUID created at node admission                                        | One logical activation of one node in one run                        |
| Attempt              | `attempt_id`, UUID per actual provider/execution retry                                 | Distinguish repeated attempts inside an occurrence                   |
| Position             | Existing retry epoch, route activation sequence, full ordered loop ancestry            | Nested loop iteration 1 is not equal to another parent's iteration 1 |
| Transcript scope     | Nullable `metadata` JSON column with typed execution and stream fields                 | Old payload schemas and row kinds remain unchanged                   |
| Ask scope            | Nullable `execution_scope` JSON column on pending interactions                         | Resume identity survives transcript append failure                   |
| Text identity        | Stream/message/block ID plus typed `complete`, `delta`, or `snapshot` mode             | Never concatenate independent complete messages                      |
| Tool identity        | Occurrence, attempt and tool-use ID; `call` or `result` phase                          | Never correlate only by tool name or bare ID                         |
| Completeness         | Provider output state, transport truncation, retained-full availability, typed outcome | Missing output is not an empty successful output                     |
| History response     | Optional `nodeExecutions` on GET run                                                   | One server projection for every node kind                            |
| Incremental response | Optional cursor mode on GET node messages                                              | No-query request retains the existing response contract              |

An occurrence starts on fresh node admission, route re-entry, or a new loop iteration.
A manual retry starts a new occurrence in its new retry epoch.
A provider retry within that occurrence gets a new attempt.
Ask pause/resume retains the same occurrence and logical attempt so an emitted resumed tool result can pair with the original call.
The authoritative answer does not depend on that result being emitted.
A distinct resumed stream gets its own stream ID.
If resume actually retries failed provider work, create a new attempt and show that transition.
Carry the same generated scope through node-start records and execution.
Existing createWorkflowEvent is fail-open and swallows persistence errors; awaiting it does not prove durability.
Do not change that global event-emitter contract.
A transcript row can preserve its own scope even when a lifecycle event is absent.
If a resume has no durable evidence for admission, expose unknown scope and refuse to reuse an earlier answer/session based on node ID alone.
When Ask pauses, store the same scope in the pending record before unwind.
On resume, read it from the matching pending record, including when no transcript append succeeded.
Update mapAnsweredAskResume to select only the active occurrence and its tool request, not every answered row for the node.
Restore the actual loop control index and full nested-loop ancestry from pending execution_scope before selecting startIteration or applying answers.
An Ask at iteration 3 must continue iteration 3, not execute iteration 1 with old metadata.
Preserve the unique run/tool_use_id pending-interaction contract.
Adding execution scope does not make repeated Ask tool-use IDs within one run safe or valid.
Do not create process-global counters or use timestamps as execution identity.
Preserve scope through nested-loop executor calls and route activation records.
After a crash, reuse identity only when durable pending/lifecycle data proves that the same incomplete activation continues.
Do not guess from elapsed time or mark another process's run terminal.

## Immutable Transcript Projection

Append a completion as a second `tool` row with the same validated legacy payload shape.
Do not update the call row or add a new row kind.
The presentation projection combines call/result into one card anchored at the call's sequence.
Claude and Pi Ask continuation may emit no old tool_result chunk.
Project the authoritative pending-interaction answer as an Ask completion/retained answer, distinct from provider tool output.
Do not leave an answered Ask pending merely because no result chunk arrived.
Keep intervening text in sequence order.
If the call is absent, show the result as a standalone result card.
If a result is absent, retain an explicit pending, interrupted, unavailable, or unknown state based on actual evidence.
Do not infer completion from stream end.
A repeated result is de-duplicated only by stable message identity, not equal content.
Keep exact old text/tool/status payload validators strict.
Accept absent or NULL metadata for rows created by older writers.

Preserve Pi and OMP buffering.
Claude text blocks are complete messages; Copilot may emit deltas; OpenCode may emit delta or snapshot.
Annotate boundaries at the provider adapter, where those semantics are known.
Snapshot replacement must affect only its matching stream/block.
Do not change direct-chat presentation as a side effect of transcript normalization.
Persist user-visible provider system records, including Codex file-change messages, as existing status rows with typed metadata.
Preserve current configured-MCP noise filtering in both ordinary and loop paths.

## History and Transport

The server projection groups lifecycle events, transcript scope, pending interactions and node states into ordered occurrences.
Its entries include node type, status, start/end/offset/duration when known, attempt/loop/pass identity, scoped error/resume outcome, bounded event ownership, and transcript cursor references.
Include prompt, command, loop, bash, script, approval, review gate, route controller, child workflow, loop group, skipped and cancelled nodes.
Bash output, gate decisions, route records and child links must be bounded by the selected occurrence.
Do not return the entire transcript for a selected historical execution.

For old data, use only existing unambiguous lifecycle/iteration markers.
If a boundary is ambiguous, return an unknown-scope entry and explain that the old record cannot be assigned.
Never assign all messages to the first matching iteration or synthesize missing output.
Do not backfill immutable rows with guessed identities.

Keep `nodeStates`, `events`, `pending_interactions`, usage, and existing GET-run fields intact.
Add `nodeExecutions` as optional for gradual client rollout.
Use the existing GET messages route with optional validated `afterSeq`, `limit`, and occurrence/attempt scope parameters.
Sequence cursors remain monotonic within run/node, not per rendered card.
The no-query form continues to return exactly the legacy `{ messages }` envelope and legacy row fields.
Explicitly serialize out new metadata and paging fields for that mode; do not merely rely on optional schema keys.
Return enriched rows and new metadata only in an opt-in response mode.
Cursor mode may add `nextCursor` and `hasMore`; new names must be documented and covered by OpenAPI tests.
Page boundaries must allow a later result to update a previously loaded call card.
Use stable cache keys including run, node and scope, cancel stale requests, and avoid polling every historical room.
The UI phases own query/cache changes after these contracts exist.
Expose a scoped server high-watermark/tail in cursor mode.
At completed/failed/cancelled status, clients must perform a final cursor drain to that watermark before stopping polling.
Loaded-page tails do not prove that all history or all pending Ask requests are loaded.
Apply scope and sequence predicates before SQL LIMIT, not after fetching and slicing full history.
Use a default page size of 100 and a maximum of 500; reject invalid cursors and limits.
History projection reads identity and lifecycle metadata without selecting full transcript payloads.
Use existing run/node/seq indexes and measured query plans before adding a scoped index.

Reuse `MAX_TOOL_OUTPUT_CHARS` from the existing server web truncation owner for transport previews.
Preserve provider limits explicitly: Claude may already have cut output at 10,000 characters; Codex search can return no output; Qoder is text-only; Grok stream closure is not captured output.
If full output was retained, add an authorized detail read only when the card needs that inspection.
Proposed route: GET `/api/workflows/runs/:runId/nodes/:nodeId/messages/:messageId`.
Validate the full run/node/message relationship and reuse existing API access controls.
If full output was not retained, label the actual missing/truncated state.
Do not claim that an expand action can recover discarded data.
Keep large output out of repeated GET-run payloads.

## Inline Review Feedback

The mockup's Send annotations action is distinct from AskHuman and approval.
No Archon annotation submission endpoint exists today.
Keep this work limited to that mockup control; do not redesign Plannotator.

Use a durable supervisor-consumed submission in the existing approval metadata and workflow-event store.
Do not proxy the browser's review URL or depend on an undocumented endpoint in an installed Plannotator binary.
The external source checkout has a feedback endpoint, but lacks a per-session capability handshake and is not proof of the deployed version.
The supervisor-native path avoids that dependency and keeps cross-process ownership explicit.

1. Add a typed POST `/api/workflows/runs/:runId/review-feedback` with `{ nodeId, gateId, reviewSessionId, requestId, feedback }`.
   Validate UUID request/session IDs, nonempty feedback bounded to 16 KiB UTF-8, and strict unknown-key rejection.
   Reuse declared-gate authorization; do not silently add Ask's starter-only restriction.
2. Add optional `reviewSessionId` and typed `feedbackSubmission` to the existing approval context.
   Generate a new session ID for each annotate child, not only each gate supervisor.
   Publish it only with the current waiting-decision state and clear session-specific fields on every replacement or exit.
   Older contexts without a session ID remain readable but cannot accept inline feedback until review-open creates a current session.
3. Extend the existing transactional gate operations in `core/src/db/workflows.ts`.
   Under the run lock, validate paused/unresolved Plannotator gate, node, gate ID, review session and `waiting_decision` phase.
   Store one pending submission and an audit receipt atomically with `insertWorkflowEvent`, which throws on failure.
   Use a typed review-feedback event, not an approval event that old UI could mistake for approval.
   Check prior receipts by run/request ID for idempotency; identical retries return the receipt, different payload reuse or another submission for the same session returns 409.
   Perform that receipt lookup under the same run lock and retain receipts after current session metadata is cleared.
   The HTTP response means accepted/pending, not rework applied.
4. The owning supervisor consumes the durable submission through a fenced claim operation.
   Arbitrate queued feedback and native child decisions under the same run/session check before processing either result.
   Native approval and native annotation must acquire that same claim before mutating state.
   Ignore results from an intentionally stopped or superseded child instead of treating them as failures or later approvals.
   After a winning inline claim, stop and await its own annotate child, then pass the validated feedback into the same typed annotated-decision branch used by native results.
   Do not forge a result file, parse user text as a decision, or write approval from the HTTP handler.
   Preserve the existing external approve/cancel checks before and after rework.
5. Reuse `runReworkAgent` and the existing `reworking -> waiting_decision` path.
   Keep the workflow paused until explicit approval wins.
   Persist accepted, claimed, processed, superseded or failed receipts for both UIs.
   A crash after claim has unknown rework completion; do not automatically rerun possibly completed agent work.
   Show the retained receipt and existing review-open recovery action.
   Never transfer an old submission to a replacement review session.

Additional existing owners to modify, with adjacent tests: `packages/workflows/src/plannotator-gate-supervisor.ts`, `packages/workflows/src/plannotator-gate-executor.ts`, `packages/workflows/src/schemas/workflow-run.ts`, `packages/workflows/src/store.ts`, `packages/core/src/db/workflows.ts`, `packages/core/src/db/workflow-events.ts`, `packages/core/src/operations/workflow-operations.ts`, and `packages/core/src/workflows/store-adapter.ts`.
The API/schema and two frontend read/action adapters already listed below also own this endpoint.
Use Zod-derived types for the new submission and receipt shape; do not duplicate hand-written wire types.
Budget 180-300 source lines plus 150-250 focused test lines for this path.
No new database table, URL proxy, upstream Plannotator patch or generic messaging service is planned.

Required checks cover native/inline approval races, duplicate and changed-body retries, wrong gate/session, review-open rotation, terminal runs, supervisor in a CLI process, child-stop failure, crash after claim, and retained feedback after reload.
The full journey is Send -> accepted -> paused rework -> replacement document/review -> explicit approval -> continuation.
The mockup's immediate completion after annotation is a simulation shortcut, not a production rule.

## File Inventory

Create entries are proposed.
Each path is exact; grouped estimates include adjacent tests listed below.

| Action   | Full path                                                                                                                 | Change                                                              | Rough LOC |
| -------- | ------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- | --------- |
| Modify   | `/Users/dale/Desktop/workspace/OceanLabs/workflow-engine/archon/packages/providers/src/types.ts`                          | Optional text-boundary, outcome and completeness metadata           | 30-60     |
| Modify   | `/Users/dale/Desktop/workspace/OceanLabs/workflow-engine/archon/packages/providers/src/claude/provider.ts`                | Complete text identity and output-cut metadata                      | 25-60     |
| Modify   | `/Users/dale/Desktop/workspace/OceanLabs/workflow-engine/archon/packages/providers/src/codex/provider.ts`                 | Tool result/exit and intentionally absent output metadata           | 25-50     |
| Modify   | `/Users/dale/Desktop/workspace/OceanLabs/workflow-engine/archon/packages/providers/src/community/pi/event-bridge.ts`      | Scoped IDs/outcome; preserve buffering                              | 20-50     |
| Modify   | `/Users/dale/Desktop/workspace/OceanLabs/workflow-engine/archon/packages/providers/src/community/copilot/event-bridge.ts` | Delta boundaries and result metadata                                | 20-50     |
| Modify   | `/Users/dale/Desktop/workspace/OceanLabs/workflow-engine/archon/packages/providers/src/community/opencode/session.ts`     | Delta/snapshot identity and error output                            | 30-70     |
| Modify   | `/Users/dale/Desktop/workspace/OceanLabs/workflow-engine/archon/packages/providers/src/community/omp/event-parser.ts`     | Outcome from isError; preserve buffering                            | 20-50     |
| Modify   | `/Users/dale/Desktop/workspace/OceanLabs/workflow-engine/archon/packages/providers/src/grok/event-parser.ts`              | Captured output versus synthetic closure                            | 20-50     |
| Modify   | `/Users/dale/Desktop/workspace/OceanLabs/workflow-engine/archon/packages/providers/src/community/qodercli/provider.ts`    | Explicit complete/text-only boundaries as needed                    | 10-25     |
| Create   | `/Users/dale/Desktop/workspace/OceanLabs/workflow-engine/archon/packages/workflows/src/schemas/node-execution.ts`         | Typed scope and transcript metadata schemas                         | 70-110    |
| Modify   | `/Users/dale/Desktop/workspace/OceanLabs/workflow-engine/archon/packages/workflows/src/schemas/node-message.ts`           | Optional nullable metadata with strict old payloads                 | 15-30     |
| Modify   | `/Users/dale/Desktop/workspace/OceanLabs/workflow-engine/archon/packages/workflows/src/schemas/pending-interaction.ts`    | Optional nullable execution scope                                   | 10-20     |
| Modify   | `/Users/dale/Desktop/workspace/OceanLabs/workflow-engine/archon/packages/workflows/src/schemas/index.ts`                  | Export scope schemas/types                                          | 2-8       |
| Modify   | `/Users/dale/Desktop/workspace/OceanLabs/workflow-engine/archon/packages/workflows/src/dag-executor.ts`                   | Scope propagation, both result branches, all lifecycle boundaries   | 160-280   |
| Modify   | `/Users/dale/Desktop/workspace/OceanLabs/workflow-engine/archon/packages/workflows/src/ask-human.ts`                      | Persist scope independently of transcript writes                    | 15-35     |
| Modify   | `/Users/dale/Desktop/workspace/OceanLabs/workflow-engine/archon/packages/workflows/src/node-transcript.ts`                | Retain awaited fail-open append; typed metadata only                | 0-20      |
| Modify   | `/Users/dale/Desktop/workspace/OceanLabs/workflow-engine/archon/migrations/000_combined.sql`                              | Add nullable transcript metadata and pending scope columns          | 12-25     |
| Modify   | `/Users/dale/Desktop/workspace/OceanLabs/workflow-engine/archon/packages/core/src/db/adapters/sqlite.ts`                  | Mirror columns in createSchema and additive migrateColumns          | 15-35     |
| Generate | `/Users/dale/Desktop/workspace/OceanLabs/workflow-engine/archon/packages/core/src/db/bundled-schema.generated.ts`         | Run schema generator; never hand-edit                               | Generated |
| Modify   | `/Users/dale/Desktop/workspace/OceanLabs/workflow-engine/archon/packages/core/src/db/workflow-node-messages.ts`           | Parse/store metadata and optional cursor/detail reads               | 90-150    |
| Modify   | `/Users/dale/Desktop/workspace/OceanLabs/workflow-engine/archon/packages/core/src/db/workflow-pending-interactions.ts`    | Parse/store scope without changing first-wins resolution            | 20-45     |
| Modify   | `/Users/dale/Desktop/workspace/OceanLabs/workflow-engine/archon/packages/workflows/src/store.ts`                          | Optional list options only if needed; preserve two-argument callers | 10-25     |
| Modify   | `/Users/dale/Desktop/workspace/OceanLabs/workflow-engine/archon/packages/core/src/workflows/store-adapter.ts`             | Forward optional options without changing append behavior           | 5-15      |
| Create   | `/Users/dale/Desktop/workspace/OceanLabs/workflow-engine/archon/packages/server/src/routes/workflow-execution-history.ts` | One typed server projection for every node kind                     | 180-280   |
| Modify   | `/Users/dale/Desktop/workspace/OceanLabs/workflow-engine/archon/packages/server/src/routes/schemas/workflow.schemas.ts`   | History, cursor and optional detail route schemas                   | 80-140    |
| Modify   | `/Users/dale/Desktop/workspace/OceanLabs/workflow-engine/archon/packages/server/src/routes/api.ts`                        | Add history to GET run and bounded messages/detail handlers         | 70-130    |
| Generate | `/Users/dale/Desktop/workspace/OceanLabs/workflow-engine/archon/packages/web/src/lib/api.generated.d.ts`                  | Generate OpenAPI types from running source server                   | Generated |
| Modify   | `/Users/dale/Desktop/workspace/OceanLabs/workflow-engine/archon/packages/web/src/lib/api.ts`                              | Optional typed read options and history type exports                | 20-40     |
| Modify   | `/Users/dale/Desktop/workspace/OceanLabs/workflow-engine/archon/packages/web/src/experiments/console/skills/runs.ts`      | Map optional nodeExecutions and cursor read parameters              | 20-40     |

Inspect `packages/core/src/schemas/workflow-node-message.ts` and `packages/core/src/schemas/pending-interaction.ts`.
They are canonical schema aliases; do not duplicate types there.

## Consumer Audit and Protection Checklist

Observed production call sites:

- `appendNodeTranscript`: six calls in `packages/workflows/src/dag-executor.ts`, at source baseline lines 1920, 2255, 2322, 5036, 5583 and 5794.
- `appendNodeMessage`: writer `packages/workflows/src/node-transcript.ts` and adapter `packages/core/src/workflows/store-adapter.ts`.
- Database `listNodeMessages`: `packages/core/src/workflows/store-adapter.ts` and `packages/server/src/routes/api.ts`.
- Legacy `getWorkflowNodeMessages`: `WorkflowExecution.tsx` passes it to `LegacyGraphLogsPane.tsx`, `LegacyNodeRoom.tsx` and `NodeTranscriptPane.tsx` through typed props.
- Console `listNodeMessages`: `routes/RunDetailPage.tsx` passes it to the inspect room.
- `createAskHumanTool`: `nativeToolsForAskHuman` in `dag-executor.ts`, called in the ordinary and loop paths at baseline lines 2126 and 5029.
- Store test implementations: `dag-executor.test.ts`, `script-node-deps.test.ts`, `executor-preamble.test.ts`, `node-transcript.test.ts`, `subrun.test.ts`, and `executor.test.ts` under `packages/workflows/src/`.
- DB module mocks: `packages/core/src/workflows/store-adapter.test.ts` and `packages/server/src/routes/api.workflow-runs.test.ts`.
  Add stubs there for new DB exports so Bun does not expose real I/O through merged mocks.

`MessageChunk` has 25 non-test declaration/import/export files in the source search.
Besides the changed provider files, compatibility readers are:
`packages/providers/src/index.ts`, `observability.ts`, `shared/resumed.ts`,
`community/opencode/provider.ts`, `community/opencode/multi-agent.ts`,
`grok/provider.ts`, `community/copilot/provider.ts`, `community/pi/ui-context-stub.ts`,
`community/pi/provider.ts`, `community/omp/provider.ts`, `e2e-fake/provider.ts`,
`packages/workflows/src/event-emitter.ts`, `packages/workflows/src/deps.ts`,
`packages/server/src/adapters/web.ts`, `packages/core/src/types/index.ts`,
and `packages/core/src/db/workflow-node-sessions.ts`.
Keep additions optional; use package typechecks to protect these consumers.
Do not change their semantics without a failing characterization test.

- [x] No new kind, payload-key relaxation, row mutation, or destructive schema change.
- [x] Existing explicit-column readers and old writers work against the upgraded database.
- [x] Ask first-wins, starter-only authorization, decline, late answer, failed resume, and indefinite wait stay intact.
- [x] Declared gates retain their existing general API auth and gate-state rules; do not impose Ask's starter-only rule on them.
- [x] Annotation submission does not approve a gate.
- [x] Corrupt rows fail closed and error logs contain identity/error type only.
- [x] GET routes use `registerOpenApiRoute(createRoute(...), handler)`.
- [x] No transcript body is copied to logs or repeated GET-run history payloads.
- [x] Console consumes generated types and its own skill, with no shared React import.

## Implementation Steps

1. Add typed scope and metadata schemas with old-row fixtures first.
2. Add nullable columns to both dialects and their upgrade paths.
   Put new PostgreSQL indexes/comments only in the trailing section if needed.
   Reuse the existing run/node/seq index before adding another.
   Generate the embedded schema.
3. Thread occurrence/attempt/loop scope through ordinary, loop, nested-loop, route re-entry and retry execution.
   Persist pending Ask scope before pause; recover it before resumed provider work.
4. Characterize provider text/output semantics and add only the required optional metadata.
   Preserve current Pi/OMP coalescing and complete-message boundaries.
5. Append result rows in both provider loops through the awaited writer.
   Test failed append followed by successful result and Ask continuation.
6. Implement the server history projection and bounded event assignment.
   Include deterministic node output and control nodes, not only agent messages.
7. Add optional GET fields and cursor mode.
   Add an authorized full-output detail route only if retained output needs a separate read.
8. Generate frontend API types and update the two read adapters.
   UI selection and rendering changes belong to Phases 3 and 4.
9. Verify fresh install, every shipped PostgreSQL baseline, idempotence, and old-reader/new-writer compatibility.
   Do not rewrite old history.

## Test Inventory

Modify existing tests:
`packages/workflows/src/schemas/node-message.test.ts`,
`packages/workflows/src/schemas/pending-interaction.test.ts`,
`packages/workflows/src/node-transcript.test.ts`,
`packages/workflows/src/ask-human.test.ts`,
`packages/workflows/src/dag-executor.test.ts`,
`packages/core/src/db/workflow-node-messages.test.ts`,
`packages/core/src/db/workflow-pending-interactions.test.ts`,
`packages/core/src/db/adapters/sqlite.test.ts`,
`packages/core/src/workflows/store-adapter.test.ts`,
`packages/server/src/routes/api.workflow-runs.test.ts`,
`packages/web/src/lib/get-workflow-node-messages.test.ts`,
and `packages/web/src/experiments/console/skills/runs.node-messages.test.ts`.
Create `packages/server/src/routes/workflow-execution-history.test.ts`.
Add 600-1000 changed test lines across these owners, focused on behavior.

Extend existing provider tests:
`claude/provider.test.ts`, `codex/provider.test.ts`,
`community/pi/event-bridge.test.ts`, `community/copilot/event-bridge.test.ts`,
`community/opencode/provider.test.ts`, `community/omp/event-parser.test.ts`,
`grok/event-parser.test.ts`, and `community/qodercli/provider.test.ts` under `packages/providers/src/`.
Cover native formats instead of replaying already normalized chunks only.

## Scenario Matrix

| Priority | Scenario                                                  | Expected result                                                           |
| -------- | --------------------------------------------------------- | ------------------------------------------------------------------------- |
| Critical | Ask append fails, pending insert succeeds, answer resumes | Same scope from pending record; no lost question                          |
| Critical | Concurrent nodes and reused non-Ask tool IDs              | No cross-node/attempt result pairing; Ask IDs retain run-level uniqueness |
| Critical | Same node repeats through route, retry and nested loop    | Separate occurrence with exact scoped content                             |
| Critical | Old binary writes after upgrade                           | Nullable metadata accepted; old payload/check constraints valid           |
| Critical | Unauthorized detail/answer or mismatched run/node/message | Existing authorization and ownership reject access                        |
| High     | Complete text, deltas, snapshots overlap                  | Complete messages stay separate; no duplicate snapshot prefix             |
| High     | Result arrives on next cursor page                        | Original card updates at call position                                    |
| High     | Missing call or missing output                            | Result-only visible; unknown/partial states factual                       |
| High     | Bash/gate/child output followed by another occurrence     | No event leakage into old room                                            |
| High     | Provider truncates or synthetic closure occurs            | No false full-output or success claim                                     |
| Critical | Ask at nested-loop iteration 3 resumes                    | Actual loop index and ancestry restored                                   |
| Critical | New route occurrence follows answered Ask                 | No previous answer/session reuse                                          |
| High     | Ask resume emits no old tool result                       | Authoritative pending answer completes Ask display                        |
| High     | Later occurrence has resume failure                       | Earlier successful Ask remains successful                                 |
| High     | Final tool result arrives with terminal status            | Final cursor drain includes it                                            |
| High     | Codex file-change system record                           | Visible scoped status; configured-MCP noise stays filtered                |
| High     | Ambiguous historical iteration markers                    | Unknown scope; no invented boundaries                                     |
| Medium   | 10,000 transcript rows and large output                   | Bounded cursor reads, no repeated full-output transfer                    |
| Medium   | Corrupt metadata and sequence conflict                    | Payload-free failure; existing one-retry rule preserved                   |

## Commands and Acceptance

Run focused files first from each package cwd.
Keep conflicting Bun module mocks in separate invocations.

```sh
bun test src/schemas/node-message.test.ts src/schemas/pending-interaction.test.ts
bun test src/node-transcript.test.ts
bun test src/ask-human.test.ts
bun test src/dag-executor.test.ts
```

The commands above use cwd `packages/workflows`.

```sh
bun test src/db/workflow-node-messages.test.ts
bun test src/db/workflow-pending-interactions.test.ts
bun test src/db/adapters/sqlite.test.ts
bun test src/workflows/store-adapter.test.ts
```

The commands above use cwd `packages/core`.

```sh
bun test src/routes/workflow-execution-history.test.ts
bun test src/routes/api.workflow-runs.test.ts
```

The commands above use cwd `packages/server`.
Then run from the root:

```sh
bun run generate:bundled-schema
bun run check:bundled-schema
bun run check:schema-upgrades
bun run --cwd packages/providers test
bun run type-check
bun run lint
```

`check:schema-upgrades` needs reachable PostgreSQL and scratch-database privileges.
After starting or reusing the source server at port 3090, run `bun --filter @archon/web generate:types`.
Track and stop any server started for this generation.

- [x] All critical/high data scenarios pass.
- [x] Cursor/no-query OpenAPI response tests and old history fixtures pass.
- [x] Both dialect upgrades and generated files are verified. PostgreSQL schema-upgrades skipped — no local Postgres (explicit coverage limit).
- [x] Phase 1 missing-result reproduction passes its data assertions.
- [x] UI parity verified in Phases 3-5.

## Risks and Rollback

Execution identity errors can misattribute private tool output or an answer.
Require exact scope and authoritative pending records before connecting cards.
Extra columns are additive-only.
Rollback code to old readers while leaving new columns and immutable rows in place.
Do not drop columns, rewrite payloads, or rebuild the table to roll back the UI.
