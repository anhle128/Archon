---
title: 'Workflow Run Mockup Alignment Plan Review'
date: 2026-09-07
status: draft-for-user-review
---

# Workflow Run Mockup Alignment Plan Review

## Review Scope

Reviewed the index and all five phase files against the canonical mockup and current source.
Two research agents performed separate failure-mode and scope reviews.
The controller checked security boundaries, source paths, consumers and consistency.
Creating another review agent failed with the session thread limit; existing agents were reused instead.
No browser, build, lint or product-test run was part of the document review.
Earlier research reported 27 baseline passes: 4 workflow schema/writer, 6 real SQLite store, and 17 Legacy room/pane checks.
Those checks do not prove visual parity.

Paths in the evidence table are relative to the repository root.
Line numbers refer to the research baseline `a50a8e61`.
The later `7981e417` commit did not change the product files used by the review.

## Findings

Fourteen consolidated findings: ten High and four Medium.
Thirteen are incorporated into the plan; one proposed expansion is rejected because an existing supported transport covers the requirement.
Duplicate observations from the two reviewers are merged below.

| #   | Severity | Finding and source evidence                                                                                                                                                                               | Disposition and plan correction                                                                                                                                                                          |
| --- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | High     | Lifecycle writes do not acknowledge durability: `packages/core/src/db/workflow-events.ts:129`, `packages/workflows/src/dag-executor.ts:1934`                                                              | Accept; Phase 2 preserves fail-open events and uses surviving transcript/pending scope, with explicit unknown scope instead of false recovery claims                                                     |
| 2   | High     | Ask resume need not emit the original tool result: `packages/providers/src/claude/provider.ts:1475`, `packages/providers/src/community/pi/provider.ts:398`                                                | Accept; Phase 2 resolves Ask from the pending-interaction answer, not a promised provider result                                                                                                         |
| 3   | High     | Resume selects historical answers by node alone: `packages/workflows/src/dag-executor.ts:1840`, `:10083`                                                                                                  | Accept; Phase 2 scopes eligible resume requests to the active occurrence and keeps older answers as history                                                                                              |
| 4   | High     | Ask in a later loop iteration resumes at the wrong index: `packages/workflows/src/dag-executor.ts:5139`, `:5371`, `:5946`                                                                                 | Accept; Phases 2 and 5 restore actual iteration and nested ancestry, including iteration 3                                                                                                               |
| 5   | Medium   | Provider system records are not persisted: `packages/providers/src/codex/provider.ts:713`, `packages/workflows/src/dag-executor.ts:2572`                                                                  | Accept; Phase 2 captures user-visible system records through status rows while preserving noise filtering                                                                                                |
| 6   | High     | Loaded-page tail is not execution/global tail: `packages/web/src/components/workflows/merge-agent-room-items.ts:41`, `NodeTranscriptPane.tsx:80`                                                          | Accept; Phases 2-4 filter Ask by scope and use server tail evidence with a separate error fallback                                                                                                       |
| 7   | Medium   | Terminal status can stop polling before the last result: `packages/web/src/components/workflows/NodeTranscriptPane.tsx:25`, `:74`                                                                         | Accept; both clients drain through the scoped final high-watermark before becoming static                                                                                                                |
| 8   | Medium   | Later resume failure rewrites older Ask presentation: `packages/web/src/components/workflows/LegacyGraphLogsPane.tsx:397`, `ask-card-presentation.ts:47`                                                  | Accept; Phase 2 supplies scoped errors and Phases 3-4 use the request occurrence's state                                                                                                                 |
| 9   | High     | Console sections retain unscoped content and metadata: `packages/web/src/experiments/console/components/RunStream.tsx:342`, `RunDetailPage.tsx:189`, `components/inspect/build-console-log-entries.ts:73` | Accept; Phase 4 replaces timestamp/FIFO/node-only projection with one bounded local scope cache shared by stream and room                                                                                |
| 10  | High     | Reviewer proposed a new PostgreSQL Better Auth fixture because SQLite cannot enable Better Auth: `packages/server/src/auth/config.ts:26`                                                                  | Reject that expansion; `packages/server/src/routes/api.ts:2170-2228` supports the existing proxy identity header with SQLite; Phases 1 and 5 explicitly test that path, not login/session authentication |
| 11  | High     | CLI and web names do not link starter identity: `packages/cli/src/commands/workflow.ts:2154`, `packages/server/src/routes/api.ts:2187`, `:5209`                                                           | Accept; isolated fixture links internal UUIDs and supplies separate starter, teammate and no-header browser contexts                                                                                     |
| 12  | High     | CLI exits when paused and browser answer alone cannot resume that run: `packages/cli/src/commands/workflow.ts:2430`, `:2648`, `packages/server/src/routes/api.ts:2925`                                    | Accept; separate CLI pause/answer/explicit-resume and parent-backed web auto-resume journeys                                                                                                             |
| 13  | High     | Inline annotation action has no Archon API, and comment approval is not annotation: `packages/server/src/routes/api.ts:4790`, `packages/workflows/src/plannotator-gate-supervisor.ts:267`                 | Accept with a supervisor-native design; Phase 2 specifies typed submission, transactional session fencing and paused rework; Phases 3-5 use and verify it                                                |
| 14  | Medium   | All-node acceptance omits classifier owners: `packages/web/src/lib/dag-layout.ts:86`, `components/workflows/resolve-room-kind.ts:4`, `experiments/console/components/inspect/resolve-room-kind.ts:8`      | Accept; Phases 3-4 include display/classifier owners and tests, including cancel rather than agent fallback                                                                                              |

## Additional Checks

- Preserve the pending-interaction unique `(workflow_run_id, tool_use_id)` contract; transcript scope does not make repeated Ask IDs legal.
- Keep the no-query message envelope and fields unchanged; metadata and cursors are opt-in.
- Apply scoped SQL filtering before LIMIT and exclude large payloads from run-history projection.
- Keep node-aggregate usage labeled as aggregate, not per-occurrence cost.
- Keep declared-gate authorization separate from starter-only Ask authorization.
- Render tool output as escaped text and retain existing safe Markdown/link handling.
- Do not mutate auto-generated files by hand, replace graph libraries or add Console runtime imports.

## Annotation Decision

The external Plannotator source has a feedback endpoint at revision `67658dcdbbc29bb5da321b2f8d59ed0032f7a4b7`.
That source is not evidence of the installed binary's capability and has no per-session capability handshake for the proposed proxy.
The plan therefore does not depend on that endpoint.
It uses Archon's existing owned supervisor, fenced approval metadata and transactional audit insertion.
Source owners are `packages/core/src/db/workflows.ts:203`, `packages/core/src/db/workflow-events.ts:104`, and `packages/workflows/src/plannotator-gate-supervisor.ts:267`.
The new typed submission remains an explicit implementation requirement, not a claim that an annotation API already exists.
The scope reviewer checked this final supervisor-native design and found no remaining material contradiction.
The user acknowledged which mockup control this refers to; that acknowledgement is not implementation approval.

## Validation

Three optional questions were presented during planning.
No explicit answers to those choices have been received.

| Question                                                               | Proposed default                                                           | State                      |
| ---------------------------------------------------------------------- | -------------------------------------------------------------------------- | -------------------------- |
| Keep Ask actionable in both inline Chat/stream and the node room?      | Both locations use one request controller and controlled draft per surface | Awaiting user confirmation |
| Match mockup typography, colors and spacing or retain current styling? | Match the mockup with scoped semantic tokens; no sitewide theme rewrite    | Awaiting user confirmation |
| Ship Replay/view-as simulation controls?                               | Keep them test-only                                                        | Awaiting user confirmation |

The latest acknowledgement does not resolve these three choices.
The plan is complete as a review draft; implementation remains pending.
Browser policy blocked reference/live captures during research.
No alternative browser or transport was used to bypass that restriction.
Phase 1 must reproduce the issue in a permitted environment, and Phase 5 must complete visual acceptance.

## Whole-Plan Consistency

Re-read the index and all five phase files after review corrections.
Check the final files for stale CLI-wait assumptions, false durability, generic node-only Ask selection, missing final cursor drain, unscoped Console stream content and an invented existing annotation endpoint.
The annotation transport is the new supervisor-native path in Phase 2, not a proxy to an external review URL.
Three product choices remain explicitly provisional; they are not hidden contradictory requirements.
The final sweep found no unresolved internal contradiction.
The three user choices and unavailable screenshot evidence remain explicit review gates.

## Final Checks

- `ak plan validate`: passed with `valid: true`.
- Local link and inventory check: eight documents, 100 existing-owner references, 15 links, 11 proposed create paths, zero errors.
- Two Phase 5 modification targets are correctly created in Phase 1; they are not missing existing source files.
- `git diff --check`: passed.
- Index length: 79 lines.
- Prettier did not run: the tool hook blocked direct access to `node_modules/.bin/prettier`.
- No alternate command or ignore-rule change was used to bypass that block.
- No product source, database, generated code, or release file was changed.
- No background server or watcher was started by this planning session.

## Tooling Notes

AgentKit created the plan and phase stubs and pinned the worktree's active plan.
Its phase-add operation did not refresh the index table; the authored index now links all five phases.
The optional `.claude/scripts/set-active-plan.cjs` hook is absent; no replacement hook was invented.
No live task surface was available, so phase checklists remain the durable task record.
Plan CLI validation checks structure only; it does not replace the source review or user decisions.
