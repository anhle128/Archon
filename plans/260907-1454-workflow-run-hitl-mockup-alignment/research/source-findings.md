---
title: 'Workflow Run Mockup Source Findings'
date: 2026-09-07
baseline: a50a8e61
status: complete
---

# Workflow Run Mockup Source Findings

## Context

The user requested `ak:plan --deep` to restore the full run view to `_bmad-output/specs/spec-workflow-run-view-hitl/ux-mockup`.
The scope includes Legacy and Console, not the separate Source Control mockup.
This report records source evidence, not completed visual acceptance.
Browser policy blocked live screenshots and opening the local mockup in the investigation turn.
Do not bypass that policy or claim screenshot parity from source reads.

## Delivery Failure

- `SPEC.md` names its companions as the complete contract but omits the UX document and mockup.
- `epics-workflow-run-view-hitl/epics.md:97` records that the UX/mockup was absent at extraction.
- `docs/superpowers/plans/2026-09-06-node-transcript-logs-legacy.md:2019` changes tool blocks into chips with collapsed JSON details.
- That plan's acceptance walkthrough checks content and ordering, not comparison with the mockup.
- `NodeRoom.tsx:147` implements the substituted tool presentation.

## Visual Inventory

Mockup references below are relative to `_bmad-output/specs/spec-workflow-run-view-hitl/ux-mockup/`.
Web paths below are relative to `packages/web/src/`.

| Area               | Mockup source                                                               | Current owner and required correction                                                                                                                                   |
| ------------------ | --------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Legacy header      | `index.html #run-header`, `styles.css .rh-*`                                | `components/workflows/WorkflowExecution.tsx`: restore two-level title, run ID, status and metadata hierarchy; use real metadata                                         |
| Console header     | `console.html .cc-head`, `.cc-meta`                                         | `experiments/console/components/RunDetailHeader.tsx`: match density and arrangement; retain real usage, provenance, environment and IDE controls                        |
| Tabs               | `#tabs`, `.cc-viewbtns`                                                     | `components/workflows/source-control/dag-run-tabs.tsx`, Console `StreamToolbar.tsx`: match tab treatment; retain Source Control and real Artifacts                      |
| Panel lifecycle    | `app.js openPanel/closePanel/syncPanelLayout`                               | `LegacyGraphLogsPane.tsx`, Console `ConsoleInspectPane.tsx`: initially closed unless deep-linked; close returns space; preserve selection and drafts across views       |
| Panel size         | `styles.css #node-panel`, `app.js resize binding`                           | Mockup default 460px, range 320-720px; current Legacy 60/40 and Console fixed 380px differ                                                                              |
| Panel header       | `renderPanel`, `.ph-row`, `.ph-meta`, `.iter-chips`                         | Both room shells need type, name, status, start offset, duration, pass/iteration chips and close control                                                                |
| Legacy Logs        | `renderLogsRow/paintLogsRow`, `.logrun`, `.lr-*`                            | `NodeRunList.tsx`: replace fixed 224px list with complete rows, status indicator, node/pass, type, status, duration, start offset                                       |
| Console Log        | `console-app.js renderStreamSection`, `.cc-node`, `.cc-divider`, `.cc-body` | `RunStream.tsx`, `NodeDivider.tsx`: one section and sticky divider per execution with its exact content                                                                 |
| Legacy Chat        | `addChat/chatNodeEntry`, `.cuser`, `.csys`, `.cnode`                        | `ChatTimeline.tsx`, `build-chat-timeline.ts`: actor labels, compact node entries, system/route/decision records, inline interactions                                    |
| Agent text         | `renderItem`, `.pmsg-role`, `.pmsg-text`                                    | `NodeRoom.tsx`, Console room: role label, complete Markdown block, 12.5px body, correct spacing                                                                         |
| Tool cards         | `.ptool`, `.ptool-head`, `.ptool-io`                                        | Both room renderers: inset border, name, structured summary, visible input/output, wrapping; no invented summaries                                                      |
| Status and answers | `.psys`, `.panswer`                                                         | Both surfaces: quiet lifecycle notes and compact retained answer records                                                                                                |
| Bash/script        | `.pbash`, `.pbash-cmd`, `.pbash-out`                                        | `StdoutRoom.tsx` and Console body: attributed command header and terminal grouping with real output/error/truncation                                                    |
| Gates              | `gateCard/gateSummary`, `.approval-card`                                    | `GateRoom.tsx`, Console gate body/footer: execution-scoped review card and retained decision; actual review link/doc metadata                                           |
| Routes             | `.proute-*`                                                                 | `RouteControllerRoom.tsx`, Console body: route outcome block and decision details                                                                                       |
| Other node kinds   | UX taxonomy plus current typed rooms                                        | Preserve workflow child links, loop-group details and script/approval support; cover cancel nodes with factual terminal content                                         |
| Ask cards          | `askCard/askSummary`, `.ask-*`                                              | `AskCard.tsx`, `ask/ConsoleAskCard.tsx`: request and node header, question numbering, compact options/actions, complete current error states                            |
| Awaiting           | `syncAwaitingBanner`, Console `syncAwaiting`                                | `WorkflowAskChrome.tsx`, `ask/ConsoleAskChrome.tsx`: correct count, node/gate pointers, target visibility, keyboard focus                                               |
| Composer           | `#chat-composer`, `#cc-composer`                                            | Legacy `RunChatComposer`; Console lacks general run composer: use real conversation destination and existing send skill, never claim queued delivery without a contract |
| Graph geometry     | `computeLayout`, constants                                                  | Reuse `lib/run-graph`; target 208x58 nominal nodes, 34px horizontal and 46px vertical gaps; current 180x80/40/80 differ                                                 |
| Graph cards        | `.gnode`, `.gn-head`, `.gn-join`                                            | `ExecutionDagNode.tsx`, `RunGraphPanel.tsx`: type border, join badge, pass/loop summary and stable geometry                                                             |
| Graph edges        | `.edge-g`, `.eg-cond`, `.eg-route-*`, `.eg-loopback`                        | `RunGraphRouteEdge.tsx`, shared `routes.ts`/`taken-path.ts`: arrow geometry, amber negative route, retry curve and executed-pass evidence                               |
| Graph interaction  | `bindViewport`, `fitGraph`, `setHoverNode`                                  | Keep ReactFlow on Legacy; add Console pointer pan, cursor zoom, fit on entry; both get connected-edge hover/focus tracing                                               |
| Artifacts          | `#cc-view-artifacts`                                                        | Keep real `ArtifactPanel` data and previews; align list treatment and preserve open panel when switching view                                                           |

## Data Findings

- Transcript rows have no execution identity in `packages/workflows/src/schemas/node-message.ts`.
- Both provider loops in `dag-executor.ts:2322` and `:5794` write only tool calls.
- Both `tool_result` branches at `:2373` and `:5850` omit transcript output writes.
- Both UI `build-log-rows.ts` implementations collapse ordinary reruns and key loop rows by iteration alone.
- Both room selectors choose the first matching iteration marker and return all rows when a marker is absent.
- `select-room-data.ts` has an open-ended event slice, which can mix later stdout/gate/child records into old selections.
- The existing database CHECK permits only `text`, `tool`, and `status`; do not add a new kind that requires a constraint replacement.
- Append completion as another `tool` row and preserve strict legacy payload shapes.
- A new nullable typed metadata column can carry execution scope, stream identity, tool phase, output completeness and outcome without breaking older explicit-column readers.
- Ask scope must persist independently of transcript rows because transcript recording is fail-open.
- A resumed Ask continues its logical occurrence; a new loop iteration or route re-entry needs another occurrence; provider retries need a distinct attempt identity.
- Old missing output cannot be reconstructed; ambiguous old execution boundaries must be shown as unknown.
- The GET messages route currently returns all rows, and clients poll the whole transcript every second.

## Provider Limits

| Provider | Evidence and constraint                                                                                                                         |
| -------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Claude   | `claude/provider.ts:905`: response/outcome available, successful output cut at 10,000 characters before normalization; text blocks are complete |
| Codex    | `codex/provider.ts:637`: command output/exit available; web-search output intentionally empty; file changes use system messages                 |
| Pi       | `community/pi/event-bridge.ts:321`: output/ID/outcome available; existing buffering at `:396` must remain correct                               |
| Copilot  | `community/copilot/event-bridge.ts:251`: text deltas; output from detailedContent/content at `:280`                                             |
| OpenCode | `community/opencode/session.ts:187`: delta or snapshot text; callID/output/error available; test snapshot overlap before joining                |
| OMP      | `community/omp/event-parser.ts:300`: IDs/results available; isError not mapped to outcome; buffering already exists                             |
| Grok     | `grok/event-parser.ts:268`: output available; synthetic stream-end closure is not captured output                                               |
| Qoder    | `community/qodercli/provider.ts:488`: stdout text only; do not invent structured tools                                                          |

## Protected Contracts

- Ask questions and answers come from `pending_interactions`, not prose or transcript status.
- Preserve starter-only Ask authorization, first-wins submission, decline, late-answer, failed-resume and indefinite wait behavior.
- Do not convert review annotations into approval.
- Console uses its own skill/store/UI modules; only type-only generated API imports and the existing shared run-graph runtime exception are permitted.
- Preserve current Source Control, real Artifacts, usage/ledger displays, environment/provenance and lifecycle controls.
- The mockup has simulation-only Replay/viewer controls, no responsive media rules, no reduced-motion support, and some undefined Console tokens.
- Correct these prototype omissions explicitly through accessible production behavior; do not copy defects.

## Existing Test Infrastructure

- `e2e/` is an existing standalone Playwright 1.60.0 package with its own config.
- `e2e/package-lock.json` exists locally but is not tracked; a clean CI checkout cannot use it until the dependency lock is generated and tracked through the package manager.
- `e2e/lib/playwright/archon-runtime.ts` starts a real isolated server/SQLite and runs real workflows with an external fake provider.
- The existing fake provider only emits usage/text, and `askHuman`, native tools and resume are false.
- Extending tests for Ask requires a real test provider tool invocation/resume contract, not seeded pending rows pretending to prove the execution flow.
- Current config captures screenshots only on failure; explicit approved visual baselines must be added.
- Root `bun run validate` does not run standalone Playwright.
- Focused baseline checks from researcher: workflow schema/writer 4 pass, real SQLite node-message store 6 pass, Legacy room/pane 17 pass.
- Source test declaration counts: NodeRoom 7, NodeTranscriptPane 10, LegacyNodeRoom 13, NodeRunList 2, ChatTimeline 9, AskCard 8, LegacyGraphLogsPane 39, WorkflowExecution 8, ConsoleNodeRoom 14, RunStream 18, RunGraphPanel 5, RunDetailHeader 8, NodeDivider 4; shared graph layout 7, positions 9, routes 10, taken-path 4.

## Unresolved Decisions

Three optional user questions are pending: inline Ask placement, exact scoped token fidelity, and keeping mockup simulation controls test-only.
Recommended defaults: expose one synchronized Ask in Chat/stream and node panel; match mockup with scoped brand tokens; keep simulation controls in tests only.
No product source files were changed during research.
