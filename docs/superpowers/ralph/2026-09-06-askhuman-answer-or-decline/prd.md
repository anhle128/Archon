# Answer or Decline the Ask Implementation PRD

Source plan: `docs/superpowers/plans/2026-09-06-askhuman-answer-or-decline.md`  
Derived slug: `2026-09-06-askhuman-answer-or-decline`

## Overview

Story 6.3 of the Workflow Run View HITL epic completes the answer-and-resume lifecycle for `AskHuman`. When an agent node in Claude or Pi pauses on `AskHuman` (established in Story 6.2), the authenticated run starter can submit valid answers or decline via `POST /api/workflows/runs/{runId}/ask/{requestId}/answer`.

In a single atomic database transaction, Archon validates the answer against the stored question envelope, transitions the pending interaction row from `pending` to `answered`, and—if no pending interaction remains for that run—executes a compare-and-swap (CAS) to resume the workflow run from `paused` to `running`. The executor then re-enters unfinished asking nodes with ordered `resumeInteractions`, continuing the interrupted Claude or Pi session without putting human answers into the node prompt. Terminal status changes (cancel or fail) atomically purge any remaining unresolved Ask rows.

Linked issue: [#88](https://github.com/anhle128/Archon/issues/88).

## Problem

Story 6.2 paused the workflow run and persisted `remote_agent_pending_interactions` rows, but provided no way to answer or resume:
1. There is no route or operation for the human to answer or decline pending questions.
2. Resuming an Ask must never steal or overwrite `metadata.approval` (which is reserved for workflow gates).
3. If an answer route and executor resume drift, runs could be double-resumed, resurrected from cancelled/failed states, or stranded in `paused`.
4. Putting answers directly into node prompts would break prompt caching, mutate user definitions, and desynchronize provider sessions.
5. Claude and Pi handle session continuation differently: Claude requires provider-owned user message injection with `forkSession: false`, while Pi requires reopening the specific session, durably appending matching `ToolResultMessage` records, and invoking `session.agent.continue()`.
6. Cancelling or failing a run while questions are pending would leave dangling unresolved interactions.

## Solution

1. **Contracts (`packages/workflows`, `packages/providers`)**: Define strict Zod schemas for `askAnswerBodySchema`, `resolvePendingInteractionInputSchema`, `resolvePendingInteractionResultSchema`, and export `askHumanQuestionSchema`. Add `ResumeInteraction` to `SendQueryOptions` in `@archon/providers`.
2. **Atomic Persistence & Shared Transition (`packages/core/src/db`)**: Extract the query-scoped resume logic into `packages/core/src/db/workflow-resume-transition.ts`. In `workflow-pending-interactions.ts`, implement `resolvePendingInteraction` with PostgreSQL `FOR UPDATE` / SQLite transaction locking, semantic envelope validation, status CAS, last-pending check, `'paused-ask'` resume transition, and `interaction_resolved` event insertion.
3. **Terminal Purge (`packages/core/src/db`)**: Implement `purgePendingInteractionsInTransaction` and call it from winning updates in `cancelWorkflowRun`, `cancelRecoveryWorkflowRun`, `resolveAndCancelApprovalGate`, `failWorkflowRun`, and `failOrphanedRuns`.
4. **Store Port (`packages/workflows`, `packages/core`)**: Add `resolvePendingInteraction` to `IWorkflowPendingInteractionStore` and `WorkflowStoreAdapter`, and update all test doubles.
5. **Event Emission & Bridge (`packages/workflows`, `packages/server`, `packages/adapters`)**: Add `interaction_resolved` to `WorkflowEmitterEvent`, map it in the web bridge to `workflow_status` (running/paused refetch signal without payload leak), and keep the Slack bridge silent.
6. **Operations (`packages/core/src/operations`)**: Implement `answerAskHuman` enforcing authentication, starter matching (`run.user_id`), safe logging (`workflow.ask_resolved`), event emission, and update `resumeWorkflow` to accept already-running runs with answered Asks.
7. **HTTP Route (`packages/server/src/routes`)**: Register `POST /api/workflows/runs/{runId}/ask/{requestId}/answer` via OpenAPIHono with status mappings (`200`, `400`, `401`, `403`, `404`, `409`, `500`) and trigger web auto-resume dispatch on winning final resume.
8. **Hydration (`packages/workflows/src/executor.ts`)**: Update `inspectResumableRun` and `hydrateResumableRun` to recognize first-node answered Asks with zero completed nodes, block if still pending, and return already-`running` runs without a redundant resume CAS.
9. **DAG Re-entry (`packages/workflows/src/dag-executor.ts`)**: Load answered Ask rows before layer execution; override provider session id with `provider_session_id`; inject `resumeInteractions` with `forkSession: false` on the first pass of command/prompt/loop nodes; isolate prompts from answers; enforce zero engine retries on resume failure.
10. **Claude Provider (`packages/providers/src/claude`)**: Build provider-owned resume prompt via `buildClaudeAskResumePrompt`, pass `options.resume`, set `options.forkSession = false`, sanitize failure logs and terminal errors.
11. **Pi Provider (`packages/providers/src/community/pi`)**: Add `requireExisting` to `resolvePiSession` (throwing `PiSessionResumeRequiredError` without cold-creating), append matching `ToolResultMessage` records, verify transcript tail, support `startMode: 'continue'` calling `session.agent.continue()`, and sanitize failure logs.
12. **Verification & Story Closure**: Regenerate `packages/web/src/lib/api.generated.d.ts`, run all package-isolated test suites, pass `bun run validate`, and update `sprint-status.yaml`.

## Goals and Success Metrics

| Goal | Success Metric | Evidence Source |
| --- | --- | --- |
| Authorized Answer/Decline | Only the run starter can answer or decline; missing auth is 401, different user is 403, duplicate write is 409 | Route and operations tests (`packages/server/src/routes/api.workflow-runs.test.ts`, `packages/core/src/operations/workflow-operations.test.ts`) |
| Atomic State CAS | Answers, resolution audit event, and run resume commit in one transaction; run resumes only when 0 pending rows remain | Database integration tests (`packages/core/src/db/workflow-pending-interactions.test.ts`) |
| Purge on Terminal Transitions | Cancel and failure transitions purge unresolved pending rows in the same transaction | Database lifecycle tests (`packages/core/src/db/workflows.test.ts`) |
| Prompt & Payload Isolation | Executor prompt never receives answer data; SSE and logs never leak answers, questions, or envelopes | DAG executor and provider unit tests (`packages/workflows/src/dag-executor.test.ts`, `packages/providers/src/claude/provider.test.ts`, `packages/providers/src/community/pi/provider.test.ts`) |
| Safe Re-entry & Hydration | Already-running runs hydrate without a second resume CAS; unfinished asking nodes re-enter with ordered interactions | Workflow executor tests (`packages/workflows/src/executor.test.ts`, `packages/workflows/src/dag-executor.test.ts`) |
| Full Provider Continuation | Claude continues in-session without fork; Pi appends tool results and calls `agent.continue()` without cold fallback | Provider test suites and pinned characterization test |

## Non-Goals

- Ask cards, Submit controls, teammate chrome, and composer HITL (Stories 6.5 and 6.6).
- Permission confirmation POST and Permission cards (Story 6.7).
- Per-node independent scheduling (Story 6.4).
- CLI, Slack, Telegram, Discord, GitHub, or `manage_run` answer commands.
- Assistant-prose detection as an Ask.
- Workflow YAML syntax changes or new run statuses (e.g. `awaiting` run status).
- Claude SDK or Pi SDK upgrades.

## Technical Context

- `packages/workflows/src/schemas/pending-interaction.ts`: Add `askAnswerItemSchema`, `askAnswerBodySchema`, `resolvePendingInteractionInputSchema`, `resolvePendingInteractionResultSchema`, and move `askHumanQuestionSchema` here (`docs/superpowers/plans/2026-09-06-askhuman-answer-or-decline.md:141-259`).
- `packages/providers/src/types.ts`: Add `ResumeInteraction` and `SendQueryOptions.resumeInteractions` (`docs/superpowers/plans/2026-09-06-askhuman-answer-or-decline.md:185-197`).
- `packages/core/src/db/workflow-resume-transition.ts`: New file extracting query-scoped resume logic (`docs/superpowers/plans/2026-09-06-askhuman-answer-or-decline.md:263-288`).
- `packages/core/src/db/workflow-pending-interactions.ts`: Implement `resolvePendingInteraction` and `purgePendingInteractionsInTransaction` (`docs/superpowers/plans/2026-09-06-askhuman-answer-or-decline.md:300-345`).
- `packages/core/src/db/workflows.ts`: Call shared resume transition and call purge from `cancelWorkflowRun`, `cancelRecoveryWorkflowRun`, `resolveAndCancelApprovalGate`, `failWorkflowRun`, and `failOrphanedRuns` (`docs/superpowers/plans/2026-09-06-askhuman-answer-or-decline.md:347-360`).
- `packages/workflows/src/store.ts`: Add `resolvePendingInteraction` to `IWorkflowPendingInteractionStore` (`docs/superpowers/plans/2026-09-06-askhuman-answer-or-decline.md:362-378`).
- `packages/core/src/workflows/store-adapter.ts`: Delegate `resolvePendingInteraction` (`docs/superpowers/plans/2026-09-06-askhuman-answer-or-decline.md:368-372`).
- `packages/workflows/src/event-emitter.ts`: Add `interaction_resolved` event (`docs/superpowers/plans/2026-09-06-askhuman-answer-or-decline.md:434-442`).
- `packages/server/src/adapters/web/workflow-bridge.ts`: Map `interaction_resolved` to `workflow_status` (`docs/superpowers/plans/2026-09-06-askhuman-answer-or-decline.md:444-450`).
- `packages/core/src/operations/workflow-operations.ts`: Add `answerAskHuman` and update `resumeWorkflow` (`docs/superpowers/plans/2026-09-06-askhuman-answer-or-decline.md:362-402`).
- `packages/server/src/routes/api.ts`: Register POST `/api/workflows/runs/{runId}/ask/{requestId}/answer` (`docs/superpowers/plans/2026-09-06-askhuman-answer-or-decline.md:452-470`).
- `packages/workflows/src/executor.ts`: Support first-node Ask inspection and hydrate-when-running without a second CAS (`docs/superpowers/plans/2026-09-06-askhuman-answer-or-decline.md:404-418`).
- `packages/workflows/src/dag-executor.ts`: Re-enter unfinished nodes with ordered interactions, apply session id precedence, and isolate prompt (`docs/superpowers/plans/2026-09-06-askhuman-answer-or-decline.md:420-462`).
- `packages/providers/src/claude/provider.ts`: Add `buildClaudeAskResumePrompt`, call query with resume prompt and `forkSession: false` (`docs/superpowers/plans/2026-09-06-askhuman-answer-or-decline.md:464-494`).
- `packages/providers/src/community/pi/session-resolver.ts`: Support `requireExisting` (`docs/superpowers/plans/2026-09-06-askhuman-answer-or-decline.md:496-508`).
- `packages/providers/src/community/pi/event-bridge.ts`: Add `startMode: 'continue'` (`docs/superpowers/plans/2026-09-06-askhuman-answer-or-decline.md:520-530`).
- `packages/providers/src/community/pi/provider.ts`: Append `ToolResultMessage`, verify transcript tail, and continue agent (`docs/superpowers/plans/2026-09-06-askhuman-answer-or-decline.md:510-546`).

## Story Overview

| Priority | Story ID | Title | Depends On | Plan Anchors |
| --- | --- | --- | --- | --- |
| 1 | US-001 | Define AskHuman answer and provider contracts | - | Task 1: 388-424 |
| 2 | US-002 | Implement atomic answer CAS and shared resume primitive | US-001 | Task 2: 426-488 |
| 3 | US-003 | Purge pending interactions on terminal transitions | US-002 | Task 3: 490-547 |
| 4 | US-004 | Expose pending-interaction resolution store port and update doubles | US-001, US-002 | Task 4: 549-601 |
| 5 | US-005 | Map AskHuman resolution as a refetch event | US-001 | Task 5: 603-670 |
| 6 | US-006 | Own AskHuman answer and resume operations | US-001, US-002, US-005 | Task 6: 672-730 |
| 7 | US-007 | Register starter-only AskHuman answer route and auto-dispatch | US-001, US-006 | Task 7: 732-805 |
| 8 | US-008 | Hydrate operation-resumed AskHuman runs without second CAS | US-001, US-004 | Task 8: 807-862 |
| 9 | US-009 | Re-enter AskHuman nodes with resume interactions | US-001, US-004, US-008 | Task 9: 864-946 |
| 10 | US-010 | Continue Claude after AskHuman answers | US-001, US-009 | Task 10: 948-1002 |
| 11 | US-011 | Continue Pi after AskHuman answers | US-001, US-009 | Task 11: 1004-1077 |
| 12 | US-012 | Regenerate API contract, full validation, and mark Story 6.3 done | US-001..US-011 | Task 12: 1079-1150 |
