---
title: 'Code Review: Workflow Run HITL Mockup Alignment'
date: 2026-09-07
status: blocked
review_target: 'Pending changes for plan 260907-1454-workflow-run-hitl-mockup-alignment'
---

# Code Review: Workflow Run HITL Mockup Alignment

## Verdict

Block this change.

Spec compliance failed.
The implementation does not connect the new execution-history contract to either production run view.
The inline annotation control is also absent from both views.
Fresh repository validation fails.

The focused HITL E2E file passes, but it does not test the missing contracts.

## Findings

### [P1] Feed server execution history to both production run views

The Legacy adapter maps `nodeExecutions` at [WorkflowExecution.tsx](/Users/dale/.cursor/worktrees/archon/txce/packages/web/src/components/workflows/WorkflowExecution.tsx:134), but it does not pass the value to the pane at [WorkflowExecution.tsx](/Users/dale/.cursor/worktrees/archon/txce/packages/web/src/components/workflows/WorkflowExecution.tsx:848).
The Legacy pane calls `buildLogRows` without the third argument at [LegacyGraphLogsPane.tsx](/Users/dale/.cursor/worktrees/archon/txce/packages/web/src/components/workflows/LegacyGraphLogsPane.tsx:178).
The Console adapter also maps the value at [runs.ts](/Users/dale/.cursor/worktrees/archon/txce/packages/web/src/experiments/console/skills/runs.ts:106), but the route calls `buildLogRows` without it at [RunDetailPage.tsx](/Users/dale/.cursor/worktrees/archon/txce/packages/web/src/experiments/console/routes/RunDetailPage.tsx:245).
Both views therefore use the event fallback that groups by node ID, loop iteration number, or route sequence.
They do not select the server-owned occurrence or attempt.
The Console message-loader contract also accepts only `runId` and `nodeId` at [ConsoleInspectPane.tsx](/Users/dale/.cursor/worktrees/archon/txce/packages/web/src/experiments/console/components/ConsoleInspectPane.tsx:53), and the room makes an unscoped read at [ConsoleNodeRoom.tsx](/Users/dale/.cursor/worktrees/archon/txce/packages/web/src/experiments/console/components/ConsoleNodeRoom.tsx:550).

Impact: retries, route re-entry, and repeated loop executions can still mix in one room.
The core Phase 2, Phase 3, and Phase 4 acceptance contract is not active in production.

Required fix: pass `nodeExecutions` into both row builders, keep the selected occurrence and attempt in host state, and make both message loaders use that exact scope.

### [P1] Put the same occurrence scope on lifecycle start and terminal events

The agent-node `node_started` event includes the execution scope at [dag-executor.ts](/Users/dale/.cursor/worktrees/archon/txce/packages/workflows/src/dag-executor.ts:1967), but its normal `node_completed` event omits the scope at [dag-executor.ts](/Users/dale/.cursor/worktrees/archon/txce/packages/workflows/src/dag-executor.ts:3211).
Loop iteration starts include the scope at [dag-executor.ts](/Users/dale/.cursor/worktrees/archon/txce/packages/workflows/src/dag-executor.ts:5411), but loop iteration completion omits it at [dag-executor.ts](/Users/dale/.cursor/worktrees/archon/txce/packages/workflows/src/dag-executor.ts:6465).
The failure paths have the same mismatch.
The projection closes a scoped entry only when the terminal event carries the same `occurrence_id` at [workflow-execution-history.ts](/Users/dale/.cursor/worktrees/archon/txce/packages/server/src/routes/workflow-execution-history.ts:171).
It otherwise adds an unknown terminal row and leaves the original scoped row running at [workflow-execution-history.ts](/Users/dale/.cursor/worktrees/archon/txce/packages/server/src/routes/workflow-execution-history.ts:185).
No production `mintTranscriptExecutionScope` call supplies `routeActivationSeq`, including the main node scope at [dag-executor.ts](/Users/dale/.cursor/worktrees/archon/txce/packages/workflows/src/dag-executor.ts:1935).
The projection therefore cannot label a route pass from the new scope contract.
The projection tests use terminal events with manually added scope at [workflow-execution-history.test.ts](/Users/dale/.cursor/worktrees/archon/txce/packages/server/src/routes/workflow-execution-history.test.ts:36), so they do not represent executor output.

An isolated reproduction returned one running scoped row and one completed `terminal_without_matching_start` row for one completed node.

Impact: the new server history reports phantom running executions and duplicate terminal executions.
This data would remain wrong after the UI wiring is fixed.

Required fix: carry one scope object through all start, completion, failure, skip, and loop terminal events, populate the route activation sequence, and add an executor-to-projection test that uses real event payloads.

### [P1] Select Ask answers by the active occurrence

`selectAnsweredAsksForActivation` selects every answered Ask for the node and retry epoch at [transcript-execution-scope.ts](/Users/dale/.cursor/worktrees/archon/txce/packages/workflows/src/transcript-execution-scope.ts:75).
It does not select the active occurrence or the active tool request.
`mapAnsweredAskResume` sends every matched answer to the provider at [dag-executor.ts](/Users/dale/.cursor/worktrees/archon/txce/packages/workflows/src/dag-executor.ts:1851).
The test omits its `otherOccurrence` fixture from the selection assertion at [transcript-execution-scope.test.ts](/Users/dale/.cursor/worktrees/archon/txce/packages/workflows/src/transcript-execution-scope.test.ts:71).

An isolated reproduction with two same-node, same-epoch occurrences returned both `old` and `current` Ask tool IDs.

Impact: a resumed loop or repeated activation can receive a stale answer.
It can also fail resume when the old and current rows have different provider session IDs.

Required fix: recover the active durable scope first, then select only answered rows for that occurrence and its expected tool requests.

### [P1] Add the inline annotation action to both gate rooms

The Legacy client defines `submitWorkflowRunReviewFeedback` at [api.ts](/Users/dale/.cursor/worktrees/archon/txce/packages/web/src/lib/api.ts:863).
The Console client defines `submitRunReviewFeedback` at [runs.ts](/Users/dale/.cursor/worktrees/archon/txce/packages/web/src/experiments/console/skills/runs.ts:184).
No production component calls either function.
The Legacy gate room only shows Open Plannotator, Approve, and Reject at [GateRoom.tsx](/Users/dale/.cursor/worktrees/archon/txce/packages/web/src/components/workflows/GateRoom.tsx:58).
The Console gate body has the same controls at [ConsoleNodeRoom.tsx](/Users/dale/.cursor/worktrees/archon/txce/packages/web/src/experiments/console/components/ConsoleNodeRoom.tsx:366).

Impact: users cannot use the mockup's Send annotations action on either surface.
The new endpoint is dead production code.

Required fix: add the controlled feedback editor and submit action to both gate rooms, show the authoritative receipt state, and keep approval separate from annotation submission.

### [P1] Make feedback receipts durable across claim, processing, and session rotation

The first audit event stores only the `accepted` receipt at [workflows.ts](/Users/dale/.cursor/worktrees/archon/txce/packages/core/src/db/workflows.ts:2071).
Claiming changes the receipt to `claimed` only in run metadata at [workflows.ts](/Users/dale/.cursor/worktrees/archon/txce/packages/core/src/db/workflows.ts:2147).
The next transition clears both the receipt and the claim at [workflows.ts](/Users/dale/.cursor/worktrees/archon/txce/packages/core/src/db/workflows.ts:237).
No code persists `processed`, `failed`, or `superseded` receipt events.
The duplicate request lookup also occurs after current phase and session checks at [workflows.ts](/Users/dale/.cursor/worktrees/archon/txce/packages/core/src/db/workflows.ts:1978) and [workflows.ts](/Users/dale/.cursor/worktrees/archon/txce/packages/core/src/db/workflows.ts:2028).

Impact: an identical retry after a claim or session rotation returns a gate or session error instead of its durable receipt.
A reload cannot show the claimed or final state that the plan requires.
A crash after claim has no durable final receipt lifecycle.

Required fix: perform the run and request-ID receipt lookup before active-session validation, append each state transition durably, and retain the receipt after the active approval metadata is cleared.

### [P1] Arbitrate queued inline feedback before processing a native child result

After the poll, the supervisor checks inline feedback only when `childResult` is undefined at [plannotator-gate-supervisor.ts](/Users/dale/.cursor/worktrees/archon/txce/packages/workflows/src/plannotator-gate-supervisor.ts:227).
If the child exits during the same poll that observes already queued feedback, the code skips the inline claim and lets the native decision claim first at [plannotator-gate-supervisor.ts](/Users/dale/.cursor/worktrees/archon/txce/packages/workflows/src/plannotator-gate-supervisor.ts:315).
The current race test preclaims the inline result instead of submitting queued feedback before the native exit.

Impact: accepted inline feedback can be lost to a later native approval or annotation.
The result depends on poll timing instead of the durable decision order.

Required fix: read and arbitrate both candidates under the same run and session check before either branch processes a decision.

### [P1] Project text stream boundaries instead of rendering every chunk as a message

The executor stores `text_mode`, `stream_id`, `message_id`, and `block_id` at [dag-executor.ts](/Users/dale/.cursor/worktrees/archon/txce/packages/workflows/src/dag-executor.ts:2292).
The workflow run UI does not read these fields.
It renders each text row as an independent Markdown document at [NodeRoom.tsx](/Users/dale/.cursor/worktrees/archon/txce/packages/web/src/components/workflows/NodeRoom.tsx:202) and [ConsoleNodeRoom.tsx](/Users/dale/.cursor/worktrees/archon/txce/packages/web/src/experiments/console/components/ConsoleNodeRoom.tsx:282).
Copilot emits deltas without a message ID at [event-bridge.ts](/Users/dale/.cursor/worktrees/archon/txce/packages/providers/src/community/copilot/event-bridge.ts:250).
OpenCode emits delta or snapshot mode without the available part and message identity at [session.ts](/Users/dale/.cursor/worktrees/archon/txce/packages/providers/src/community/opencode/session.ts:182).

Impact: delta Markdown can break across cards, and repeated snapshots can appear as duplicate full messages.
Independent streams cannot be replaced or combined safely.

Required fix: provide stable provider IDs where available and add a text projection that concatenates deltas and replaces snapshots only inside one matching stream and block.

### [P1] Preserve and present tool outcome and completeness

Provider tool results include `toolOutcome`, `exitCode`, `truncated`, and `outputState` at [types.ts](/Users/dale/.cursor/worktrees/archon/txce/packages/providers/src/types.ts:343).
The transcript metadata schema has no outcome or exit-code field at [node-execution.ts](/Users/dale/.cursor/worktrees/archon/txce/packages/workflows/src/schemas/node-execution.ts:29).
The executor persists only truncation and output state at [dag-executor.ts](/Users/dale/.cursor/worktrees/archon/txce/packages/workflows/src/dag-executor.ts:2425).
The UI card renders only input, output, and a payload-derived pending state at [NodeRoom.tsx](/Users/dale/.cursor/worktrees/archon/txce/packages/web/src/components/workflows/NodeRoom.tsx:216).

Impact: a missing, failed, interrupted, or provider-truncated result can appear as the same generic unavailable state.
The audit view cannot state the actual provider outcome.

Required fix: persist the typed outcome and exit code with the immutable result row, and render factual outcome and completeness labels on both surfaces.

### [P1] Implement the required narrow-layout fallback

The Console inspect pane changes to a vertical stack below the `lg` breakpoint at [ConsoleInspectPane.tsx](/Users/dale/.cursor/worktrees/archon/txce/packages/web/src/experiments/console/components/ConsoleInspectPane.tsx:164), but the fixed project rail still consumes at least 232 px.
The stored 390 px Console capture is 446 px wide and leaves the run content in a one-character column.
The Legacy pane remains an always-horizontal resizable group at [LegacyGraphLogsPane.tsx](/Users/dale/.cursor/worktrees/archon/txce/packages/web/src/components/workflows/LegacyGraphLogsPane.tsx:372).
The stored 390 px Legacy capture is 690 px wide and pushes most of the room off-screen.
The visual report acknowledges clipping and rail competition but marks both as fixed at [visual-acceptance.md](/Users/dale/.cursor/worktrees/archon/txce/plans/260907-1454-workflow-run-hitl-mockup-alignment/reports/visual-acceptance.md:27).

Impact: the Ask interaction is not fully usable at the required 390 px fallback.
The acceptance statement that narrow layouts remain usable is false.

Required fix: collapse or hide the Console rail when space is not available, stack the Legacy room below the graph or logs, and test an actionable Ask card at 390 px and 768 px.

### [P1] Restore the repository validation gate

Fresh `bun run validate` exited with code 1.
Type-check and lint passed.
`format:check` failed on 26 files and stopped validation before installer and package tests.
The active plan claims that validation is green at [plan.md](/Users/dale/.cursor/worktrees/archon/txce/plans/260907-1454-workflow-run-hitl-mockup-alignment/plan.md:21).

Impact: the change cannot pass the required pre-PR gate or current CI checks.

Required fix: format the reported files, run the full validation command again, and update the plan only after the fresh command exits with code 0.

### [P2] Do not clamp away the extra cursor row at a 500-row request limit

The route requests `limit + 1` rows to calculate `hasMore` at [api.ts](/Users/dale/.cursor/worktrees/archon/txce/packages/server/src/routes/api.ts:5239).
The database function clamps every requested limit to 500 at [workflow-node-messages.ts](/Users/dale/.cursor/worktrees/archon/txce/packages/core/src/db/workflow-node-messages.ts:175).
When the client requests the supported maximum of 500, the route can never receive row 501.

Impact: `hasMore` is false for a 500-row page even when more transcript rows exist.
A final cursor drain can stop early.

Required fix: let the internal query request one row above the public maximum, or calculate continuation with a separate existence query.

### [P2] Enforce the feedback limit in UTF-8 bytes

Both feedback schemas use `.max(16384)` at [workflow.schemas.ts](/Users/dale/.cursor/worktrees/archon/txce/packages/server/src/routes/schemas/workflow.schemas.ts:497) and [workflow-run.ts](/Users/dale/.cursor/worktrees/archon/txce/packages/workflows/src/schemas/workflow-run.ts:20).
Zod applies that limit to JavaScript UTF-16 code units, not UTF-8 bytes.
An isolated check accepted 5,000 emoji with a UTF-8 size of 20,000 bytes.

Impact: the endpoint accepts bodies above the stated 16 KiB trust-boundary limit.

Required fix: add a refinement that checks `Buffer.byteLength(feedback, 'utf8') <= 16 * 1024`, and use the same schema at every trust boundary.

## Spec Compliance

- MISSING: both run views consume server-owned occurrences and attempts.
- MISSING: route passes and retry executions select exact transcript data.
- PARTIAL: tool call and result rows persist, but result outcome and completeness are not presented.
- MISSING: delta and snapshot text boundaries produce complete Markdown blocks.
- MISSING: Send annotations is available on Legacy and Console.
- MISSING: feedback receipts retain accepted, claimed, processed, superseded, and failed states.
- MISSING: the 390 px narrow fallback keeps Ask fully usable.
- FAIL: root validation is green.
- PASS: the existing focused HITL journey covers Ask answer, explicit CLI resume, web auto-resume, tool output visibility, and retained operational tabs.

## Verification Evidence

- `bun run --cwd e2e playwright test -c playwright.config.ts ui/workflow-run-hitl.spec.ts`: 11 passed in 1.7 minutes.
- `bun test src/routes/workflow-execution-history.test.ts`: 4 passed.
- Focused server review-feedback tests: 11 passed.
- Focused workflow scope, schema, and Plannotator supervisor tests: 53 passed.
- `bun run build:web`: passed.
- `bun run --cwd e2e typecheck`: passed.
- `git diff --check`: passed.
- `bun run validate`: failed at `format:check` with 26 files.
- PostgreSQL `bun run check:schema-upgrades`: not run because no local PostgreSQL service was available.

## Test Gaps

- No E2E test selects two occurrences of the same node and verifies isolated room data.
- No test passes real executor lifecycle events into the execution-history projection.
- No E2E test uses Send annotations because the control is absent.
- No test submits queued inline feedback before a simultaneous native child exit.
- No test verifies retained feedback receipts after claim, failure, processing, or session rotation.
- No UI test verifies Copilot delta or OpenCode snapshot projection.
- No cursor test covers more than 500 scoped messages.
- The visual test captures screenshots, but it does not assert viewport overflow or Ask usability.

## Review Boundary

The review covered the current staged, unstaged, and untracked implementation for plan `260907-1454-workflow-run-hitl-mockup-alignment`.
The boundary contained 97 changed paths with 3,830 additions and 500 deletions when the review started.
This review made no implementation changes.
