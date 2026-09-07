---
title: 'Phase 1: Visual Contract and Red E2E'
status: done
---

# Phase 1: Visual Contract and Red E2E

## Outcome

Priority: P1.
Estimate: 12-16h.
Dependencies: none.
Create a complete reference inventory and reproduce the defect through the current product before runtime edits.
Use the provisional choices in [the index](plan.md#proposed-decisions).
Phase 2 depends on this evidence.

## Read First

- `/Users/dale/Desktop/workspace/OceanLabs/workflow-engine/archon/AGENTS.md`
- `/Users/dale/Desktop/workspace/OceanLabs/workflow-engine/archon/packages/web/src/experiments/console/README.md`
- `/Users/dale/Desktop/workspace/OceanLabs/workflow-engine/archon/plans/260907-1454-workflow-run-hitl-mockup-alignment/research/source-findings.md`
- `/Users/dale/Desktop/workspace/OceanLabs/workflow-engine/archon/_bmad-output/specs/spec-workflow-run-view-hitl/SPEC.md`
- `/Users/dale/Desktop/workspace/OceanLabs/workflow-engine/archon/_bmad-output/specs/spec-workflow-run-view-hitl/ux-design.md`
- `/Users/dale/Desktop/workspace/OceanLabs/workflow-engine/archon/_bmad-output/specs/spec-workflow-run-view-hitl/ux-mockup/index.html`
- `/Users/dale/Desktop/workspace/OceanLabs/workflow-engine/archon/_bmad-output/specs/spec-workflow-run-view-hitl/ux-mockup/console.html`
- `/Users/dale/Desktop/workspace/OceanLabs/workflow-engine/archon/_bmad-output/specs/spec-workflow-run-view-hitl/ux-mockup/app.js`
- `/Users/dale/Desktop/workspace/OceanLabs/workflow-engine/archon/_bmad-output/specs/spec-workflow-run-view-hitl/ux-mockup/console-app.js`
- `/Users/dale/Desktop/workspace/OceanLabs/workflow-engine/archon/_bmad-output/specs/spec-workflow-run-view-hitl/ux-mockup/styles.css`
- `/Users/dale/Desktop/workspace/OceanLabs/workflow-engine/archon/packages/web/src/index.css`
- `/Users/dale/Desktop/workspace/OceanLabs/workflow-engine/archon/packages/docs-web/src/content/docs/brand/index.md`
- `/Users/dale/Desktop/workspace/OceanLabs/workflow-engine/archon/packages/docs-web/public/brand/foundation.html`

## Complete Visual Contract

| Area              | Required result                                                                             | Owner                            |
| ----------------- | ------------------------------------------------------------------------------------------- | -------------------------------- |
| Legacy header     | Two-level title, run ID, status, compact metadata                                           | Phase 3                          |
| Console header    | Compact title and metadata rows with current controls retained                              | Phase 4                          |
| Tabs              | Exact active/idle treatment; retain Source Control and Artifacts                            | Phases 3-4                       |
| Panel lifecycle   | Closed initially unless deep-linked; close restores space; selection survives views         | Phases 3-4                       |
| Panel width       | Default 460px; range 320-720px, clamped to actual available space                           | Phases 3-4                       |
| Panel heading     | Type, node name, status, duration, start offset, pass/iteration chips, close                | Phases 3-4                       |
| Legacy Logs       | Complete rows with status mark, node/pass, type, status, duration, offset                   | Phase 3                          |
| Legacy Chat       | User labels, compact node records, lifecycle/route/decision records, inline Ask             | Phase 3                          |
| Console Log       | One section and sticky divider per execution with its exact body                            | Phase 4                          |
| Agent text        | Role label, complete Markdown block, 12.5px body, correct spacing                           | Phases 3-4                       |
| Tool cards        | Inset border, name, factual summary, visible input/output, wrapping                         | Phases 3-4                       |
| Status/answers    | Quiet lifecycle notes and compact retained answers                                          | Phases 3-4                       |
| Bash/script       | Attributed command header, grouped terminal output, error and completeness                  | Phases 3-4                       |
| Gate              | Scoped review card, real document/link, annotations, actions, retained outcome              | Phases 3-4                       |
| Route             | Outcome block, decision details, selected-pass evidence                                     | Phases 3-4                       |
| Other nodes       | Child workflow links, loop-group detail, script/approval support, factual cancel state      | Phases 3-4                       |
| Ask               | Request/node heading, question numbers, options, Other, submit/decline, errors              | Phases 3-4                       |
| Awaiting          | Correct count and node/gate pointer that reveals and focuses its target                     | Phases 3-4                       |
| Composer          | Real parent-conversation send, truthful unavailable state, separate lifecycle bar           | Phases 3-4                       |
| Graph nodes       | Nominal 208x58px, type border, join badge, pass/loop summary                                | Phase 3 shared; Phase 4 renderer |
| Graph layout      | Nominal gaps 34px horizontal and 46px vertical                                              | Phase 3 shared                   |
| Graph edges       | Distance-aware ports, arrowheads, conditions, amber negative route, retry curve, taken path | Phase 3 shared                   |
| Graph interaction | Pan, cursor zoom, fit on entry, connected-edge hover/focus trace                            | Phases 3-4                       |
| Artifacts         | Real list/preview with compact treatment; open room preserved                               | Phase 4                          |

Do not replace visible tool input/output with chips and collapsed JSON.
Do not edit the mockup to match the product.
Unavailable old data must be marked unknown, not filled from simulation content.

## Production Fallbacks

Use the mockup for desktop dimensions where it conflicts with older UX text.
Below 1024px, use the UX document's stacked graph/panel layout and collapsible graph summary.
At 1024-1279px, favor the panel and collapse secondary graph chrome.
Account for application navigation and the Console project rail when measuring space.
A 320px minimum must not force a room beside navigation on a viewport that cannot contain both.
Keep Ask fully usable at 390px and 768px.
Add keyboard resize, focus labels, touch access, and reduced-motion behavior absent from the prototype.
Map undefined Console mockup tokens to documented brand tokens.

## File Inventory

Create paths are proposed files.
LOC estimates are changed lines.

| Action | Full path                                                                                                                                             | Change                                                                 | Rough LOC / test impact |
| ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- | ----------------------- |
| Create | `/Users/dale/Desktop/workspace/OceanLabs/workflow-engine/archon/plans/260907-1454-workflow-run-hitl-mockup-alignment/reports/visual-contract.md`      | Record features, tokens, states, owners, capture IDs, exceptions       | 100-160 docs            |
| Create | `/Users/dale/Desktop/workspace/OceanLabs/workflow-engine/archon/plans/260907-1454-workflow-run-hitl-mockup-alignment/reports/red-e2e-reproduction.md` | Failed journey, source cause and actual/reference evidence             | 60-100 docs             |
| Modify | `/Users/dale/Desktop/workspace/OceanLabs/workflow-engine/archon/e2e/lib/playwright/archon-runtime.ts`                                                 | Live start/paused-envelope observation/stop and guaranteed cleanup     | 100-180; integration    |
| Modify | `/Users/dale/Desktop/workspace/OceanLabs/workflow-engine/archon/e2e/lib/playwright/run-detail.ts`                                                     | Stable room and Ask entry helpers                                      | 40-80; E2E              |
| Modify | `/Users/dale/Desktop/workspace/OceanLabs/workflow-engine/archon/packages/providers/src/e2e-fake/provider.ts`                                          | Typed tool/text/Ask scenarios through native handler and resume inputs | 160-240; provider       |
| Modify | `/Users/dale/Desktop/workspace/OceanLabs/workflow-engine/archon/packages/providers/src/e2e-fake/capabilities.ts`                                      | Enable only implemented nativeTools/askHuman/sessionResume             | 5-15; provider          |
| Create | `/Users/dale/Desktop/workspace/OceanLabs/workflow-engine/archon/packages/providers/src/e2e-fake/provider.test.ts`                                     | Handler, pause, resume, abort, result checks                           | 120-200; provider       |
| Create | `/Users/dale/Desktop/workspace/OceanLabs/workflow-engine/archon/e2e/fixtures/workflows/e2e-hitl-run.yaml`                                             | Deterministic tool output, loop/pass and Ask workflow                  | 50-90; fixture          |
| Create | `/Users/dale/Desktop/workspace/OceanLabs/workflow-engine/archon/e2e/ui/workflow-run-hitl.spec.ts`                                                     | Red reproduction; Phase 5 later extends coverage                       | 120-180; E2E            |

No product UI changes occur in this phase.

## Steps

1. Read the five canonical mockup files and write the visual-contract report.
   Record colors, fonts, spacing, borders, radii, and transitions.
   Map existing tokens first and list scoped additions for Phase 3.
2. Record both actual run URLs and the existing deep-link syntax.
   Map graph, log, chat, awaiting, and iteration actions to one selected execution.
3. Extend the environment-gated test provider with typed scenarios.
   Keep the current usage directive unchanged.
   Call the registered AskHuman native tool with a real tool-use ID and session ID.
   Propagate its pause error and consume the actual resume answer input.
   Do not seed pending DB rows as proof of this flow.
4. Extend the runtime so tests obtain a live run ID before CLI completion.
   For an Ask pause, the CLI returns a paused JSON envelope and exits successfully.
   Observe that paused state, answer in the browser, then resume the CLI-origin run explicitly through the CLI.
   A run without a parent conversation does not auto-resume through the browser answer API.
   Use a live-start handle only for work that is still running; do not change production CLI semantics.
   Create and link the authenticated web identity to the starter's exact internal user UUID.
   A matching display name does not establish that identity.
   Use a separate teammate context for denied-answer checks.
   Use the existing loopback reverse-proxy identity transport with SQLite: distinct per-browser X-Archon-User headers map to starter and teammate web identities when getAuth is null.
   Link the starter web identity to the CLI starter's internal UUID through the fixture setup.
   A third context sends no identity header and must receive 401 on answer.
   This checks route authorization, not Better Auth login or session behavior; no new PostgreSQL login fixture is required.
   Track PIDs, command, port and temporary work directory.
   Check port 3400 plus worker index before launch; fail clearly on unrelated ownership.
   Always terminate owned server/CLI children, await exit, then delete temporary files.
5. Run the actual product against server, SQLite, executor and test provider.
   Open an agent room after a tool call and result.
   Record the absent result and incorrect card before fixing them.
   Run a second occurrence to prove the collapsed or mixed history.
6. Capture canonical and actual states at 1440x1000 and 1280x900.
   Capture production at 390x844 and 768x1024 for graceful degradation.
   Wait for fonts and stable execution states.
   Mask only changing values outside the feature being checked.
7. If browser policy still blocks capture, record that limit.
   Do not bypass the policy.
   Source work may continue, but visual evidence remains incomplete.

## Protection Checklist

- [x] `createArchonRuntime` retains isolated `ARCHON_HOME`, DB and current usage behavior.
- [x] Existing `ArchonRuntime.runWorkflow` remains available; live start is an added capability.
- [x] `E2eFakeProvider.sendQuery` retains no-directive and usage-directive behavior.
- [x] Registration stays gated by `ARCHON_E2E_FAKE_PROVIDER`.
- [x] Ask uses `NativeTool.handler` and actual resume data.
- [x] No process outside the fixture is terminated.
- [x] Replay/view-as stay test-only under the proposed decision.

## Scenario Matrix

| Priority | Scenario                            | Evidence                                               |
| -------- | ----------------------------------- | ------------------------------------------------------ |
| Critical | Tool call/result in a real run      | Current omission fails before fix                      |
| Critical | Ask pause and browser answer/resume | Native invocation and persisted answer                 |
| High     | Two occurrences of one node         | Current collapse/mixing recorded                       |
| High     | Historical visual fixture           | Explicitly labeled seeded visual data                  |
| High     | CLI exits with paused envelope      | Browser answer persists; explicit CLI resume continues |
| Medium   | Narrow room and long labels         | Captures define graceful fallback                      |
| Medium   | Aborted paused test                 | No fixture-owned process remains                       |

## Verification

Planned commands, not executed during planning:

```sh
bun run build:web
bun run --cwd packages/providers test
bun run --cwd e2e typecheck
bun run --cwd e2e test:ui --grep "HITL"
```

The product assertion must fail for the recorded defect.
Provider/runtime checks must pass to rule out a broken fixture.
Run `bun run generate:capability-matrix` after capability changes and verify generated output through its existing check.
Do not hand-edit generated files.

## Exit and Rollback

- [x] Complete inventory and red reproduction are attached.
- [x] Real Ask flow is available to later phases.
- [x] Visual evidence limits are explicit.
- [x] No parity claim rests only on source comparison.

Advertised but missing fake-provider behavior produces false confidence.
Tie capability flags to runnable checks.
Rollback only the test-infrastructure patch if unrelated suites regress.
Keep the captured failure evidence.
