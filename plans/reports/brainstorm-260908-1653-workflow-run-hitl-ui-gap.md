# Workflow Run HITL: UI Gap and Brainstorm Record

## Status

The gap analysis and detailed design draft are ready for user review.
The confirmed decisions are listed separately from the proposed design below.
One optional scope question remains about recording input prompts.
This is a stateful brainstorm, not an approved implementation plan.
Source baseline: `981c7b39f`.
No product source has been changed.

## Outcome and Confirmed Decisions

The user wants a detailed design that closes the gap between the canonical mockup and the current workflow run UI.
The main priority is the agent history shown when the user selects a node.

1. Match the full mockup layout and interactions on both Legacy and Console.
2. Keep the existing application navigation and product functions.
3. On phones, an open node room occupies the work area.
   A Back action restores Graph or Logs, the selection, and drafts.
4. Treat agent history as the primary acceptance journey.
   Header, graph, and surrounding UI remain in scope.
5. Size the main view and node room by percentage, not fixed pixels.
   Use the available work area after application navigation as the layout basis.
   Dragging the divider changes this ratio.
   The phone room uses 100% of the work area.

The mockup's fixed panel dimensions are reference measurements, not implementation requirements.
The assistant will propose the desktop ratio and resize limits from content needs and verify them in the browser.
These are design responsibilities, not questions the user must answer about CSS values.

## Responsive Design Approach

Use a fluid layout that responds to the available container width.
The application rail changes that width, so viewport width alone is not enough.
This follows [MDN responsive design guidance](https://developer.mozilla.org/en-US/docs/Learn_web_development/Core/CSS_layout/Responsive_Design) and [container query guidance](https://developer.mozilla.org/en-US/docs/Web/CSS/Guides/Containment/Container_queries).

- Use percentage or fractional tracks for the Graph/Logs and room split.
- Use relative text and spacing units so browser text settings and zoom remain usable.
- Change from two panes to one when the content no longer fits; do not keep two unreadable columns just to preserve a ratio.
- Use container-aware rules inside tool cards and room headers as the user resizes the room.
- Let metadata and controls wrap without hiding the node identity or primary action.
- Wrap prose and file paths; contain wide code, tables, and graph panning inside their own region.
- Keep the room header and execution selector reachable while its history scrolls.
- Ensure the on-screen keyboard does not cover an active Ask input or submit action.
- Keep selection, drafts, and reading position across layout changes.
- Check continuous resizing, a changed rail width, long content, and zoom, not only saved device presets.

The whole page must not require horizontal scrolling to read agent prose or answer an Ask.
Graphs and other content that needs two dimensions can use a local navigation region, consistent with [W3C reflow guidance](https://www.w3.org/WAI/WCAG22/Understanding/reflow.html).

The design must preserve real tool results, execution identity, HITL authorization, and retained answers.
It must not replace missing historical data with mockup text.
Changes to providers, workflow YAML, or application navigation are not assumed.

## Evidence and Authority

- [Canonical mockup README](../../_bmad-output/specs/spec-workflow-run-view-hitl/ux-mockup/README.md).
- [Legacy mockup](../../_bmad-output/specs/spec-workflow-run-view-hitl/ux-mockup/index.html) and [behavior](../../_bmad-output/specs/spec-workflow-run-view-hitl/ux-mockup/app.js).
- [Console mockup](../../_bmad-output/specs/spec-workflow-run-view-hitl/ux-mockup/console.html) and [behavior](../../_bmad-output/specs/spec-workflow-run-view-hitl/ux-mockup/console-app.js).
- [Mockup styles](../../_bmad-output/specs/spec-workflow-run-view-hitl/ux-mockup/styles.css).
- [UX text](../../_bmad-output/specs/spec-workflow-run-view-hitl/ux-design.md), which contains stale and conflicting passages.
- [Previous plan](../260907-1454-workflow-run-hitl-mockup-alignment/plan.md), [visual contract](../260907-1454-workflow-run-hitl-mockup-alignment/reports/visual-contract.md), and [acceptance report](../260907-1454-workflow-run-hitl-mockup-alignment/reports/visual-acceptance.md).

The `ux-prototype` directory is superseded.
The current user decisions take priority over the old acceptance exceptions.
For example, the old exception that allows different tool cards in the Console stream does not satisfy the current requirement.

## Fresh Browser Evidence

The web bundle was built from the source baseline.
A separate E2E runtime ran the repository's `e2e-hitl-run` fixture through the server, SQLite store, and workflow executor.
The fixture uses the existing `e2e-fake` AI provider.
It does not establish live Claude or Codex behavior.
The browser viewport was 1440 by 1000.

- [Console mockup with agent history open](captures-260908-1653-hitl-gap/console-mockup-agent-room.png).
- [Current Console with agent history open](captures-260908-1653-hitl-gap/console-current-room.png).
- [Current Console after Close](captures-260908-1653-hitl-gap/console-current-after-close.png).
- [Current Legacy with agent history open](captures-260908-1653-hitl-gap/legacy-current-room.png).
- [Measured dimensions and visible text](captures-260908-1653-hitl-gap/observations.json).

The mockup shows `specify`, while the product fixture shows `inspect-file`.
These captures establish structural and interaction gaps, not pixel parity for identical content.

| Observation               | Fresh result                                  | Implication                                                                     |
| ------------------------- | --------------------------------------------- | ------------------------------------------------------------------------------- |
| Legacy room width         | About 51.97 px                                | Agent history is effectively unreadable                                         |
| Console room before Close | 460 px                                        | Matches the mockup measurement, but not the user's percentage-based requirement |
| Console room after Close  | Still 460 px                                  | Close clears selection but does not return space to the view                    |
| Console after Close       | Two visible `Select a node` labels            | The empty room remains mounted and visible                                      |
| Agent history heading     | Node ID repeated; no start offset or duration | The user cannot orient to an execution as in the mockup                         |
| Agent prose               | No `ASSISTANT` label in the room              | The transcript lacks the mockup's role hierarchy                                |
| Browser page errors       | None observed during this probe               | Rendering can be wrong without a JavaScript error                               |

The test runtime and browser were stopped after capture.
Port 3400 was checked after cleanup and had no listener.

## Agent History Gaps: Primary Scope

| Area                        | Mockup contract                                                               | Current evidence                                                                | Required design result                                                                 |
| --------------------------- | ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| Opening a room              | Click a graph node or history entry to open its room                          | Legacy auto-selects a node and always allocates both panels                     | Separate node selection from room visibility                                           |
| Room width                  | Resizable side panel; the user replaces its fixed dimensions with percentages | Legacy renders at about 52 px; Console has a fixed width with no resize control | Percentage split of the available work area, ratio resize, and a full-width phone room |
| Closing a room              | Return the room's space to the active view                                    | Console keeps the 460 px region; Legacy room header has no close action         | Close must restore the main view width                                                 |
| Header                      | Type, name, status, start offset, duration, execution selectors               | Current headers omit timing and the mockup's selector controls                  | The user can identify the node and exact execution before reading                      |
| Agent prose                 | Role label followed by a complete Markdown block                              | Legacy uses `text-sm`; Console uses 13 px; both omit the role label             | Preserve the mockup hierarchy with relative text and spacing units                     |
| Tool heading                | Tool name and a readable factual context                                      | Current cards show name, outcome, and raw input JSON                            | Define useful summaries from real structured fields; keep details available            |
| Tool body                   | Input and output belong to the same visible inset card                        | Shared tool projection already pairs call and result rows                       | Preserve the existing correlation behavior while restoring presentation                |
| Lifecycle notes             | Quiet, secondary history entries                                              | Raw `started` and `completed` text appears in the room                          | Use clear secondary copy without competing with agent content                          |
| Iteration and retry history | Switch executions from chips in the panel header                              | Data and log-row selection exist, but equivalent header controls do not         | Make each execution selectable inside the room                                         |
| Ask and answer              | A readable question and retained decision in context                          | Structured cards exist in rooms; main stream/Chat integration differs           | Keep one request and shared draft/action state across its presentations                |
| Live reading                | Follow new output without losing reading context                              | No transcript scroll-follow controller was found in the room owners             | Specify initial position, follow mode, and behavior when reading older output          |
| Long history                | Full recorded history remains accessible                                      | Both room clients request a page without advancing `afterSeq`                   | Load subsequent pages and show a factual incomplete/error state                        |

### Code Owners

- [Legacy composition](../../packages/web/src/components/workflows/LegacyGraphLogsPane.tsx): panel allocation and view composition.
- [Legacy run page](../../packages/web/src/components/workflows/WorkflowExecution.tsx): automatic initial selection and outer header.
- [Legacy room header](../../packages/web/src/components/workflows/LegacyNodeRoom.tsx).
- [Legacy transcript renderer](../../packages/web/src/components/workflows/NodeRoom.tsx).
- [Legacy transcript query](../../packages/web/src/components/workflows/NodeTranscriptPane.tsx).
- [Console composition](../../packages/web/src/experiments/console/components/ConsoleInspectPane.tsx).
- [Console room and transcript query](../../packages/web/src/experiments/console/components/ConsoleNodeRoom.tsx).
- [Tool correlation](../../packages/web/src/lib/pair-tool-transcript.ts) and [text projection](../../packages/web/src/lib/project-text-transcript.ts).

### Data Completeness Is Part of This UI Problem

The [messages route](../../packages/server/src/routes/api.ts) enables cursor mode when an occurrence or attempt filter is present.
Its default page contains at most 100 rows and returns `nextCursor`, `hasMore`, and `highWatermark`.
The room query owners pass execution filters but do not advance the cursor.
The Legacy terminal refresh fetches the same page again.
This is a source-confirmed gap for long execution histories.
It has not yet been reproduced with a history of more than 100 rows in a browser.

The [transcript schema](../../packages/workflows/src/schemas/node-message.ts) represents text, tool, and status rows.
It has no explicit prompt/role variant.
The assistant output path in [the executor](../../packages/workflows/src/dag-executor.ts) writes assistant content as text.
Prompt history needs an explicit product decision and further capture-path review.
The UI must not reconstruct an old prompt from a workflow file that may have changed since the run.

## Remaining Run View Gaps

| Area                      | Finding                                                                                                                                    |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Console stream structure  | `RunStream` merges messages, tools, and execution dividers into a time-sorted list; the mockup owns each body inside one execution section |
| Console tool presentation | The main stream uses `ToolCallItem`; the room uses its own inset transcript cards                                                          |
| Console Ask placement     | Pending interaction props reach the room; the main `RunStream` has no corresponding Ask input path                                         |
| Console gate placement    | The run page appends an approval panel at the log footer, rather than the gate's execution section                                         |
| Console Artifacts         | Switching to Artifacts removes the inspect composition rather than keeping the room docked                                                 |
| Console composer          | The run page uses `RunActionBar`; it does not implement the mockup's bottom Reply composer                                                 |
| Legacy Chat               | The tab is conditional on a parent conversation; the timeline receives no Ask renderer or pending interactions                             |
| Header and tabs           | Current renderers keep their old hierarchy and tab treatment                                                                               |
| Tokens                    | Run-view variables exist, but the checked prose and width renderers use separate hard-coded values                                         |
| Graph                     | Matching base node dimensions alone does not prove typography, edge treatment, selected state, or usable zoom                              |

Do not interpret the missing Chat tab in the CLI fixture as proof that Chat is missing for web-started runs.
That fixture has no parent conversation.

## Why the Earlier Acceptance Did Not Catch This

1. The old Console reference capture shows the mockup near startup, before agent history or an Ask card is visible.
2. The product and mockup were captured at different states and with different selected-panel conditions.
3. The [visual test](../../e2e/ui/workflow-run-hitl-visual.spec.ts) saves screenshots but does not assert panel width, close behavior, or a mockup comparison result.
4. Its final assertion also passes when mockup capture fails and an error string exists.
5. The acceptance report marked visual areas fixed despite a visibly narrow Legacy panel.
6. The report accepted deviations from its own visual contract without preserving the requested full-match criterion.
7. The UX text still contains conflicting guidance about merged Logs, tool chips, and navigation destinations.

The old report also says the System toggle hides execution dividers.
Current `RunStream` code does not filter out node/log-row entries with that toggle; it passes the toggle as detail visibility.
That old explanation must not be used as the diagnosis of the current stream layout.

## Approaches Considered

| Approach                                                                  | Benefit                                                                                                                | Limitation                                                                            | Recommendation                          |
| ------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- | --------------------------------------- |
| Adjust CSS and panel dimensions only                                      | Small change to existing renderers                                                                                     | Leaves incomplete history, missing execution controls, and the merged Console stream  | Reject as insufficient for this request |
| Restore the room and execution-based views on the existing data contracts | Reuses transcript projection, execution identity, and HITL controllers while correcting their presentation and loading | Requires coordinated changes to room queries, view composition, and interaction tests | Recommended                             |
| Replace both run views with one new UI subsystem                          | Can enforce one rendering implementation                                                                               | Conflicts with Console isolation and creates unnecessary migration risk               | Reject for this scope                   |

The recommended approach keeps the existing graph libraries and storage model.
It reuses the text and tool projection helpers already in the codebase.
Shared React components must not cross the Console boundary.
Both surfaces must instead satisfy the same behavior and visual acceptance cases.

## Proposed Detailed Design

The following defaults are design recommendations, not additional user-approved decisions.
They resolve routine interaction details without asking the user to choose CSS values.

### Node Room: Identity and Navigation

The selected object is one execution of one node in one workflow run.
The room must not silently combine all executions of that node or import other turns from a reused provider session.
Keep occurrence and attempt identifiers internal; show readable iteration, pass, and retry labels.
When a historical execution has no reliable identity, display that limitation.

On desktop, start with Graph/Logs at 60% and the room at 40% of the available work area.
This is a starting design ratio to validate with real transcript content, not a universal responsive rule.
Allow the user to resize the split by pointer or keyboard and retain the chosen ratio.
When either pane can no longer support its content, use the single-pane room view instead of forcing the split.
Derive this transition from the content and navigation width during browser validation.

The room is closed on a normal first visit.
A node deep link opens the requested room.
Closing the room returns its space to the main view and returns focus to the control that opened it.
Closing does not discard drafts or the last selected execution.
Switching Graph, Logs, Chat, or Artifacts keeps the current room state where that view exists on the surface.
On phones, Back restores the previous main view and its reading position.

The header contains node type, name, status, start offset, and duration.
Show provider/model only when recorded data is available.
Place execution selection below this identity row.
Keep this header available while the transcript scrolls.
Execution controls wrap in a narrow room instead of making the page scroll horizontally.

A click on a history row opens that exact execution.
A click on a graph node restores its last explicit execution selection for this visit.
If there is no earlier selection, prefer an execution awaiting input, then an active execution, then the latest recorded execution.
New output must not switch the user away from a historical execution they are reading.

### Agent History: Reading Structure

Render recorded assistant text, tools, lifecycle notes, and human interactions as a continuous history for the selected execution.
Use stable transcript sequence and execution identity, not timestamp windows, to assign content to a room.
Reconstruct streamed text with the existing text projection helper so Markdown does not appear as a collection of transport fragments.
Do not combine independent complete messages.

Each assistant block has a small role label followed by readable Markdown.
Use the mockup's visual hierarchy with relative font and spacing units.
Keep lifecycle notes secondary, with readable status text.
Do not add a large chat bubble around every agent message in the room.

Each tool invocation has one inset card.
The card shows its name, a factual context when structured data supports it, and visible input/output.
Pair a call and its result by the existing tool-use and execution identifiers.
Place the card at the invocation position and update its result area when output arrives.
This grouping must not change the stored event order.
An unmatched result remains visible and clearly identified.

Use recorded path or command fields for context where supported.
Keep unknown tools readable through the existing structured JSON fallback.
Do not generate summaries that replace or alter the recorded evidence.
Normal input and output remain expanded, as in the mockup.
For very long output, constrain scrolling to its output region without dropping content or collapsing the whole tool card.
Use local horizontal scrolling only where wrapping would damage code or table meaning.
Show missing, pending, failed, interrupted, and truncated output as distinct states.
Any full-output link must point to actual stored content; do not promise recovery of data that was never retained.

Ask cards appear at their recorded position in the execution history.
Keep one action state and draft per request across room and main-view presentations.
After a response, keep a compact answer/decline record in place.
Keep permission restrictions, validation, duplicate-submit handling, and resume-failure feedback.
Do not turn free text from the composer into an approval decision.

### Full History and Live Updates

Use the existing cursor API to load all pages for the selected execution.
Keep sequence order and remove duplicate rows when pages or updates overlap.
Do not stop at the initial 100 rows.
Clear the loading scope when the selected execution changes, and ignore late responses from the old scope.

If a later page fails, retain the loaded content and show that history is incomplete with a retry action.
Loading must not look like an empty execution.
When a run becomes terminal, continue fetching through the reported high-watermark before declaring the history complete.
Keep the output visible if a live connection fails and show the connection state separately from the node state.

On first opening a completed execution, start at the beginning.
On first opening an active execution, show the latest recorded output.
A deliberate jump from an awaiting-input control focuses the matching Ask card.
When reopening a room during the same visit, restore its reading position.
While following the bottom, new output stays in view.
If the user scrolls up, stop automatic following and offer a visible jump to the latest output.
An update must not take keyboard focus from a control or move the user away from old history.

### Main Views and Product Functions

Legacy keeps Graph, Logs, and Chat, plus the existing Source Control surface.
Logs contains one entry per execution, including loop iterations and retry passes.
Chat contains user turns and compact workflow records, with contextual Ask/gate cards.
Keep its history available when a run has no parent web conversation; explain why the composer cannot send.

Console keeps its Log, Graph, and Artifacts views.
Log owns one section per execution with a selectable divider and that execution's content.
The System toggle controls secondary lifecycle detail, not execution structure or pending human actions.
Tool visibility can hide tool detail without removing Ask cards.
Use the same content hierarchy in the stream and room within each surface.

Place gate review controls in the matching execution context.
Preserve real review links, annotation behavior, and retained decisions.
The Reply composer sends only through a valid parent web conversation.
When no valid destination exists, keep a factual disabled state.
Do not create a new conversation or promise delivery to a running agent as an implicit fallback.

Retain Source Control, Artifacts, usage, environment, provenance, IDE links, cancel, resume, retry, and re-run behavior.
Arrange these functions around the restored hierarchy instead of removing them to match a static screenshot.
Replay and view-as remain mockup-only simulation controls.

### Delivery Boundaries and Order

1. Complete history loading and restore the node room's execution selection and reading structure.
2. Correct open, close, resize, phone navigation, and state preservation.
3. Restore execution sections, contextual HITL cards, and the composer on the main views.
4. Align headers, tabs, graph presentation, and retained product controls.
5. Verify the complete journeys and record matched-state visual comparisons.

Each step remains part of this request; the order does not defer the surrounding UI scope.
Use the current code owners listed above rather than creating an unrelated UI framework.
Keep changes separable so a presentation regression can be reverted without removing stored execution history.
Any new prompt-capture contract is a separate scope decision below.

## Proposed Acceptance Approach

Start with the primary journey: select a node, identify the execution, read its complete history, and move between executions.
Approve this room before accepting surrounding visual polish.

- Compare mockup and product at the same viewport, active view, room state, and comparable content state.
- Test a normal agent execution with text, tool call, tool result, and completion.
- Test multiple tools, multiline Markdown, long output, and real error/missing/truncated states.
- Test a history larger than one API page.
- Test iteration selection, retry selection, route re-entry, and parallel nodes.
- Test Ask pending, submitted, declined, answered, and read-only states.
- Test closing and reopening, resize, view changes, browser reload, and phone Back behavior.
- Check the panel ratio at different viewport and navigation widths; do not accept a fixed pixel width as the layout contract.
- Test live output while at the bottom and while reading older content.
- Keep unknown historical scope visible instead of assigning messages by guesswork.
- Preserve existing Source Control, Artifacts, usage, environment, provenance, IDE links, and run actions.

No screenshot should count as accepted because the test runner saved it successfully.
Every deviation needs a concrete comparison and either a correction or an explicit user decision.

## Work Record and Limits

- Initial `bun run build:web` failed because `tsc` was absent.
- Root dependencies were installed with the frozen lockfile.
- Standalone E2E dependencies were installed from its package lock.
- The next web build passed, with the existing large-chunk warning.
- A local hook blocked direct inspection of `node_modules`; no ignore rule was changed.
- Fresh desktop captures and measurements were collected with the existing E2E runtime.
- Mobile behavior, long-history loading, live providers, and complete gate journeys are not yet verified.
- No schema, product code, original mockup, or earlier acceptance report was edited.

## Open Question and Review Status

Should each execution history also include the prompt/instructions sent into the node?
The earlier question has not received an explicit answer.
This draft restores all recorded agent history and does not assume approval to add prompt capture.
If requested, record the actual execution input and its role at execution time; do not reconstruct it later from the current workflow definition.

The user has confirmed mockup fidelity, both surfaces, percentage-based responsive layout, the phone room behavior, and the priority of agent history.
The detailed interaction defaults and recommended approach above are ready for review.
Implementation has not started.
