---
title: 'Story 5.6 acceptance — agent history and responsive run room'
date: 2026-09-09
status: evidence
---

# Story 5.6 acceptance

Runtime: isolated Archon server (SQLite, `ARCHON_E2E_FAKE_PROVIDER=1`, per-worker `ARCHON_HOME`), Playwright Chromium, production web dist (`bun run build:web`).

Journeys used **`e2e-fake` only**. Live Claude and Codex behavior was **not established**.

Product room size is asserted against the Task 1 percentage contract (`default 40%`, `min 24%`, `max 60%`). The mockup's fixed pixel widths were **not** used as product sizing assertions.

Headless Playwright cannot reproduce a physical on-screen keyboard. The mobile geometry assertion proves reachability in the layout viewport; physical-keyboard overlap remains a named manual limitation.

## Commands

```sh
bun run build:web
cd e2e && npm run typecheck
cd e2e && npx playwright test -c playwright.config.ts ui/workflow-run-hitl-room.spec.ts --workers=1
cd e2e && npx playwright test -c playwright.config.ts ui/workflow-run-hitl-visual.spec.ts --workers=1
cd e2e && npm run test:ui
bun run validate
```

Captures: `plans/260907-1454-workflow-run-hitl-mockup-alignment/reports/captures/` (`{console,legacy}-{actual,mockup}-{1440x1000,1024x900,768x900,390x844}.png` plus `{console,legacy}-actual-200-percent-zoom.png`).

## Viewport evidence

Split vs single-pane is measured on the **inspect pane**, not the window. The threshold is `60rem` (960px at a 16px root). A wide window can still go single-pane if the application rail leaves the inspect pane narrower than that.

| Viewport  | Surface | Mode                                  | Room ratio                                    | Readable                                                                    | Horizontal overflow | Close / Back                                       | Verdict |
| --------- | ------- | ------------------------------------- | --------------------------------------------- | --------------------------------------------------------------------------- | ------------------- | -------------------------------------------------- | ------- |
| 1440×1000 | Console | split                                 | 0.38–0.42 default; drag restore within 0.02   | Tool output and Ask card visible in the room region                         | None observed       | Close; main width returns within 2px               | matched |
| 1440×1000 | Legacy  | split                                 | 0.38–0.42 when opened at this size            | Tool output visible; room width > 240px                                     | None observed       | Close                                              | matched |
| 1024×900  | Console | split when inspect pane ≥ 960px       | 0.24–0.60 when both panes visible             | Room region remains open                                                    | None observed       | Close                                              | matched |
| 1024×900  | Legacy  | split when inspect pane ≥ 960px       | 0.38–0.42 in the dedicated ratio case         | Room width > 240px; output visible                                          | None observed       | Close                                              | matched |
| 768×900   | Console | single-pane (inspect pane < 960px)    | n/a — main view hidden+attached               | Room remains open                                                           | None observed       | Back                                               | matched |
| 768×900   | Legacy  | single-pane when inspect pane < 960px | n/a — ratio skipped unless both panes visible | Room remains open                                                           | None observed       | Back                                               | matched |
| 390×844   | Console | single-pane                           | n/a                                           | Ask card and Submit stay inside the viewport; Log scroll/draft survive Back | None observed       | Back restores Log tab, selected row, scroll, draft | matched |
| 390×844   | Legacy  | single-pane                           | n/a                                           | Ask card remains usable; Logs focus and shared draft survive Back           | None observed       | Back restores Logs focus and draft                 | matched |

### 1440×1000 rail and 200% scale

- Split mode follows **inspect-pane width**, not the window. Widening the application rail can push the inspect pane below 960px and switch Console/Legacy to Back without a viewport change.
- Collapsing the rail restores split when the inspect pane is ≥ 960px; the stored percentage (default 40%, clamped 24–60) is reused.
- Chromium CDP applies a 2× device scale with a 720×500 CSS viewport over a 1440×1000 screen for both surfaces. Each selected-node room remains visible and is captured. This exercises the same layout geometry and device-pixel ratio as 200% browser zoom without depending on browser-toolbar keyboard shortcuts that headless Chromium ignores.

## Behavioral proof (Playwright)

| Case                                                             | Result |
| ---------------------------------------------------------------- | ------ |
| Console open/close releases width                                | Pass   |
| Legacy readable percentage room at 1024×900                      | Pass   |
| Graph restores last explicit iteration                           | Pass   |
| Agent history: ASSISTANT, tool, context, Input/Output, outcome   | Pass   |
| Execution selector uses distinct occurrence ids                  | Pass   |
| Shared Ask draft                                                 | Pass   |
| Answered and declined records stay read-only                     | Pass   |
| Awaiting input focuses `#run-ask-card-…`                         | Pass   |
| Narrow Back keeps Log state                                      | Pass   |
| Mobile Ask reachable                                             | Pass   |
| Deep-link once-per-query and opener focus                        | Pass   |
| Reload restores dragged ratio within 0.02                        | Pass   |
| Long history: ≥2 cursor pages, `limit=100`, later `afterSeq > 0` | Pass   |
| Visible `[data-tool-id]` equals stored distinct tool ids (>100)  | Pass   |
| Truncated long output retrieves and renders the recorded tail    | Pass   |
| Console Reply rejects missing parent; no conversation create     | Pass   |
| Console Reply posts to the parent web conversation               | Pass   |
| Legacy Chat / Source Control / Terminal survive without a parent | Pass   |
| Console Artifacts keeps the room docked                          | Pass   |
| Visual captures at the four required viewports                   | Pass   |
| Chromium 2× scale / 200%-equivalent layout on both surfaces      | Pass   |

## Explicit limitations

- **Provider:** `e2e-fake` only. Live Claude and Codex AskHuman/resume behavior was not exercised.
- **Mockup pixels:** mockup screenshots are review artifacts. Product assertions use percentage contract only.
- **Physical keyboard:** headless Chromium has no on-screen keyboard; 390×844 Submit-in-viewport is a layout proof only.
- **OS/browser chrome:** the automated 200%-equivalent check uses Chromium CDP device metrics rather than a toolbar shortcut; OS accessibility UI itself is outside the web surface.
- **Full `npm run test:ui`:** all 39 runnable UI tests pass. One unrelated ENV-overlay spec remains explicitly marked `test.fixme` in its source.

## Deviations

None on the automated viewports or the Chromium 2× scale check above.
