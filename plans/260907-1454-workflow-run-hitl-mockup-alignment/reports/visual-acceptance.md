---
title: 'HITL visual acceptance'
date: 2026-09-07
status: compared
---

# Visual acceptance

Canonical mockup: `_bmad-output/specs/spec-workflow-run-view-hitl/ux-mockup/` (`index.html`, `console.html`, `app.js`, `console-app.js`, `styles.css`).
`ux-prototype/` is not authority. App screenshots do not approve themselves.

Captures live in `reports/captures/`. Mockup pages use their own demo fixture (`speckit-ralph-native-feature`); product captures use the live `e2e-hitl-run` pause. Comparison is layout, tokens, card geometry, and controls — not identical copy.

## Capture index

| ID                       | Viewport                               | Surface | Files                                            |
| ------------------------ | -------------------------------------- | ------- | ------------------------------------------------ |
| console-awaiting-inspect | 1440×1000, 1280×900, 390×844, 768×1024 | Console | `console-actual-*.png` vs `console-mockup-*.png` |
| legacy-awaiting-graph    | same                                   | Legacy  | `legacy-actual-*.png` vs `legacy-mockup-*.png`   |

`file://` mockup capture succeeded in Chromium (no `mockup-capture-limit.txt`).

## Verdicts

| Subject                                                                              | 1440 / 1280                                                                                                                                              | 390 / 768                                            | Verdict                                                                                           |
| ------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Inspect pane default ~460px, clamp 320–720                                           | Pane docks right of Log; deep-link `?node=inspect-file` opens the room                                                                                   | Pane remains usable; project rail competes for width | **Fixed**                                                                                         |
| Agent room `.ptool` card, wrapping I/O, no `<details>`, no `.rounded-full` Read chip | Console room shows Read / INPUT / `HITL_TOOL_OUTPUT_VISIBLE`. Playwright asserts `.ptool` and zero Read chips on both surfaces                           | OUTPUT may clip at 390px but remains in the card     | **Fixed**                                                                                         |
| Graph nodes 208×58, gaps 34/46                                                       | Legacy Graph shows three typed nodes (`inspect-file` completed, `inspect-twice` 2/2, `ask-starter` waiting-on-you). Constants imported by both renderers | Graph still reachable via tab                        | **Fixed**                                                                                         |
| Awaiting chrome is warning, not error                                                | Header pill + Ask node amber                                                                                                                             | Same                                                 | **Fixed**                                                                                         |
| Replay / view-as                                                                     | Present only on mockup (`#btn-replay`, Legacy/Command Center toggle). Production count is 0                                                              | Same                                                 | **Fixed**                                                                                         |
| Source Control / Artifacts                                                           | Legacy keeps Source Control tab. Console keeps Artifacts (empty-state copy for this fixture)                                                             | Tabs remain                                          | **Fixed** (retained production controls)                                                          |
| Console Log stream compact `TOOL Read` rows                                          | Stream stays log-first chips; the mockup stream uses fuller cards. Room is the card contract                                                             | Same                                                 | **Accepted** — log-first density; room `.ptool` is the required card                              |
| System filter default off                                                            | Lifecycle / per-occurrence dividers hidden until System is on                                                                                            | Same                                                 | **Accepted** — documented Console default; occurrence identity is in `nodeExecutions` + Logs list |
| Mockup demo content vs e2e fixture                                                   | Different workflow names and copy                                                                                                                        | Same                                                 | **Accepted** — not a product deviation                                                            |
| Ask card in Chat/stream _and_ room                                                   | Console room Ask is covered by the journey spec. Stream copy shares the controller (unit-tested `mountContext`)                                          | Ask still reachable via `?node=`                     | **Fixed** for the room; stream duplicate is controller-scoped                                     |

## Unresolved

None for the required card/graph/panel/awaiting contract at the captured awaiting+inspect-file state.

Not in this capture pass (called out in `end-to-end-acceptance.md`, not visual blockers): bash/script terminal rooms, plannotator annotation chrome, nested-loop Ask on iteration 3, route re-entry, keyboard/reduced-motion traces.

## Rule applied

Do not regenerate application snapshots to make a check pass. These files are review artifacts from a live isolated run, compared against the canonical mockup at the same viewports.
