## Problem and outcome

The delivered Workflow Run HITL interface does not match its approved plan and mockup.
The alignment plan was marked done, but real browser inspection still shows incorrect room lifecycle, fixed room width, incorrect agent message layout, and broken narrow layouts.
Repair both Console and Legacy through a local Archon workflow until the full approved UI contract is met.
Extend `pr-e2e-verify` to automate test execution, visual review, repair, and verification after each repair.

## Delivery instructions

- Use the current product baseline: commit `981c7b39f` in `anhle128/Archon`.
  Initial browser failure evidence and approved source links remain pinned to that baseline.
  Before workflow execution, the delivery branch was fast-forwarded to `e5b074331` on `develop` to retain the new Terminal feature and existing automatic PR gate.
  This integration does not change the approved HITL plan or mockup files.
- Work on a new feature branch and create a PR to **`anhle128/Archon:develop`**.
- Root agent coordinates; execution and independent verification run through agents.
- Use **Claude Sonnet 5**, literal model `claude-sonnet-5`, for UI repair nodes.
- Set **`route_loop.max_iterations: 5`** in Archon as the only repair limit.
  Do not implement a second retry counter or repair loop in scripts.
- Show the cycle as verify → concrete problems and proposed fixes → repair → verify.
- Run **Archon local from source**, not an old installed binary.
- Trigger `pr-e2e-verify` with both the PR reference and this issue reference.
- The workflow must read the complete issue body and all required source documents before it writes tests or implements repairs.
- Do not merge automatically.

## Source authority

Use these files at the current checkout; the links pin the original accepted source to the baseline commit.

| Source                                                                                                                                                         | Purpose                                                                              |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| [Alignment plan](https://github.com/anhle128/Archon/blob/981c7b39f/plans/260907-1454-workflow-run-hitl-mockup-alignment/plan.md)                               | Full scope and dependencies                                                          |
| [Phase 1](https://github.com/anhle128/Archon/blob/981c7b39f/plans/260907-1454-workflow-run-hitl-mockup-alignment/phase-01-start.md)                            | Contract and red E2E                                                                 |
| [Phase 2](https://github.com/anhle128/Archon/blob/981c7b39f/plans/260907-1454-workflow-run-hitl-mockup-alignment/phase-02-transcript-and-execution-history.md) | Execution history and transcript                                                     |
| [Phase 3](https://github.com/anhle128/Archon/blob/981c7b39f/plans/260907-1454-workflow-run-hitl-mockup-alignment/phase-03-legacy-run-view.md)                  | Legacy and shared graph                                                              |
| [Phase 4](https://github.com/anhle128/Archon/blob/981c7b39f/plans/260907-1454-workflow-run-hitl-mockup-alignment/phase-04-console-run-view.md)                 | Console run view                                                                     |
| [Phase 5](https://github.com/anhle128/Archon/blob/981c7b39f/plans/260907-1454-workflow-run-hitl-mockup-alignment/phase-05-visual-and-end-to-end-acceptance.md) | Full visual and E2E acceptance                                                       |
| [Visual contract](https://github.com/anhle128/Archon/blob/981c7b39f/plans/260907-1454-workflow-run-hitl-mockup-alignment/reports/visual-contract.md)           | Canonical dimensions, feature inventory, and responsive rules                        |
| [Mockup directory](https://github.com/anhle128/Archon/tree/981c7b39f/_bmad-output/specs/spec-workflow-run-view-hitl/ux-mockup)                                 | Canonical `index.html`, `console.html`, `app.js`, `console-app.js`, and `styles.css` |
| [UX design](https://github.com/anhle128/Archon/blob/981c7b39f/_bmad-output/specs/spec-workflow-run-view-hitl/ux-design.md)                                     | Accessibility and responsive cases absent from mockup                                |

The older `ux-prototype` is not the visual authority.
The old plan's completion checkboxes and acceptance reports are claims to verify, not proof.
Do not edit the plan, mockup, requirements, or approved baselines to match an incorrect implementation.
Desktop dimensions come from the mockup; responsive and accessibility behavior absent from the mockup comes from the visual contract and UX design.

## Confirmed failures and causes

1. **Room opens without a node click.**
   `RunDetailPage.tsx` resolves an initial selection through `console-inspect-selection.ts`, which falls back to awaiting, running, approval, or first rows when the URL has no node.
   A plain Console run URL opens the awaiting node room.
2. **Close does not restore space.**
   Close clears selection and the URL parameter, but the render condition still mounts `ConsoleInspectPane`.
   At 1440×1000, browser measurement after Close showed a 460px room at x=980 and only 700px for the main content; the room displayed “Select a node”.
3. **Room cannot be resized.**
   `ConsoleInspectPane.tsx` applies fixed `lg:w-[460px]` with min/max classes but has no resize control.
   The room region had zero resize separators.
4. **Agent content differs from the approved layout.**
   `RunStream.tsx` uses `MessageItem variant="log"`, which renders rounded bordered cards, a violet side border, and muted monospaced body text.
   The mockup uses compact role-labelled Markdown inside a section for each execution, with borders around tool records only.
5. **Responsive layout is incomplete.**
   Console narrow toolbar actions clip; Legacy at a 390px viewport produced a document wider than the viewport.
   Legacy desktop inspection also showed a severely compressed room.
   Diagnose those layout owners before applying a shared resize pattern.
6. **Acceptance permits the wrong result.**
   `e2e/ui/workflow-run-hitl-visual.spec.ts` captures app and mockup images in different states, does not compare them, and passes even when mockup capture throws.
   Some unit tests assert a persistent room or “Select a node” after Close.
   The current `pr-e2e-verify` repair loop covers third-party anchors only; failed E2E reaches reporting without a UI repair loop.

## Workflow work

- [ ] Reuse and extend `pr-e2e-verify` with explicit issue context and an isolated checkout of the PR head.
- [ ] Save the issue body, plan sources, and mockup sources as run context, with their revisions or hashes.
- [ ] Before repair, map every accepted requirement to a runnable check or matched-state visual comparison.
- [ ] Write meaningful red tests from requirements, not from the current implementation.
- [ ] Lock the source requirements and critical acceptance tests against repair-time changes.
- [ ] Run deterministic setup, build, focused E2E, and required regression checks without swallowing failures.
- [ ] Use an independent fresh agent session for visual and contract review.
- [ ] For every visual comparison, identify the source, UI state, viewport, reference image, actual image, and result.
- [ ] Feed concrete failures into a Sonnet 5 repair node, then rerun verification on the changed candidate.
- [ ] Preserve the existing real third-party contract coverage requirement.
- [ ] Reject missing evidence, failed commands, incomplete requirement coverage, stale evidence, and changes to locked sources or tests.
- [ ] After five permitted repair entries, a further failed verification takes the exhausted route and returns an error with retained findings.
      Do not automatically start another run or reset the counter to bypass this limit.
- [ ] Publish only the candidate that passed; reject concurrent PR head changes.
- [ ] Run durable UI regression verification automatically for subsequent UI PR changes.
- [ ] Update the existing `PR E2E Verify` Actions caller to pass both named inputs and inspect the current publication evidence.
      Automatic runs use the trusted base revision; a base without the new workflow contract must fail before provider execution.
      The bootstrap PR uses the reviewed local run until the upgrade is manually merged, or an operator explicitly dispatches a reviewed revision.

## UI acceptance matrix

All rows apply to both Console and Legacy where the source contract names both surfaces.
This is the minimum inventory; the linked phase files retain their full scope.

| Area                 | Required observable result                                                                                                            |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Initial room state   | A plain run URL has no room; valid node deep-links open the correct room                                                              |
| Room interactions    | Node click opens the correct execution; Close restores main width and focus; view changes preserve selection and drafts as specified  |
| Room size            | Default 460px; pointer and keyboard resize; 320–720px desktop range clamped to available width                                        |
| Room heading         | Type, node name, status, duration, start offset, execution chips, and Close                                                           |
| Console Log          | One section and sticky divider per execution with exactly scoped content                                                              |
| Agent content        | Complete Markdown with role label; 12.5px / 1.5 line height; no inherited outer message bubble                                        |
| Tools                | Inset bordered cards, factual name and summary, visible wrapping input/output; no collapsed JSON substitute                           |
| History              | Separate occurrences, attempts, route passes, retry epochs, and nested loops; no fuzzy time-window or FIFO cross-execution mixing     |
| Status and decisions | Quiet lifecycle records and compact retained answers                                                                                  |
| Bash and script      | Attributed command header and grouped terminal output                                                                                 |
| Gates and routes     | Correctly scoped review document, annotations, actions, retained outcome, route decision, and selected-pass evidence                  |
| Other nodes          | Child workflow links, loop-group detail, and factual cancel information                                                               |
| Ask                  | Request/node heading, numbered questions, options, Other, submit, decline, errors, correct authorization, retained answer, and resume |
| Awaiting             | Correct count and focusable node/gate pointer                                                                                         |
| Composer             | Real parent-conversation send; factual disabled state when unavailable                                                                |
| Legacy Logs and Chat | Complete log rows and compact node chat records with lifecycle, route, decision, and inline Ask                                       |
| Graph                | Canonical 208×58 nodes, 34/46 spacing, type borders, join badges, negative route, retry curve, pan/zoom/fit, and hover trace          |
| Existing controls    | Preserve Source Control, Artifacts, Terminal, usage, environment, provenance, IDE links, cancel, resume, and retry                    |
| Responsive layout    | Usable actions and Ask at 390×844 and 768×1024; no document overflow; account for app navigation and project rail                     |
| Accessibility        | Keyboard focus and resize, labelled controls, touch access, and reduced motion                                                        |

## Evidence and completion

- [ ] Demonstrate the known failures on the original candidate before changing production UI.
- [ ] Capture matched stable states at 1440×1000 and 1280×900.
- [ ] Check 390×844 and 768×1024 against the responsive rules; do not approve a broken mobile mockup as a baseline.
- [ ] Inspect the actual images; screenshot existence alone cannot pass a visual criterion.
- [ ] Show that durable tests fail on the old behavior and pass on the repaired behavior.
- [ ] Run the real HITL journey through server, database, executor, pause, authorized answer, and resume.
- [ ] Run `bun run validate` and the standalone Playwright suite required by the changed UI contract.
- [ ] Record the Archon run ID, node/model evidence, loop outcomes, tested tree, published commit, test results, and visual review findings on the PR.
- [ ] Resolve every UI discrepancy in scope; do not replace full acceptance with a small passing subset.
- [ ] Stop only the background processes owned by this work and leave no orphan server or browser process.

## Boundaries

Do not replace graph libraries, mix Console and Legacy React component boundaries, broaden authorization, or change database schema for this UI repair unless a demonstrated defect requires an explicit scoped design update.
Do not modify user-owned `WATCHDOG.yml` or commit credentials, local databases, or runtime logs.
Use the existing isolated E2E runtime and explain which provider behavior is simulated versus anchored by real provider contracts.
If a browser policy blocks an action, report it and use an allowed source; do not evade the policy through another URL or tool.
The coordinator's browser already blocked the local `file:` URL for `ux-mockup/console.html`.
Do not serve or open that blocked document through another URL or browser tool to bypass that decision.
Local source reads and the existing mockup PNG captures in the original plan's `reports/captures/` remain available for inspection.
Use those only when their state and viewport match the criterion; missing permitted reference evidence is a failed finding, not a passing comparison.

## Trigger context

Supply this issue as a required named workflow input together with the PR reference.
The run must preserve the full issue body, rather than passing only its title or a short summary to implementation.
All repair and verification nodes must be able to read the same source context and the latest failed checks.
