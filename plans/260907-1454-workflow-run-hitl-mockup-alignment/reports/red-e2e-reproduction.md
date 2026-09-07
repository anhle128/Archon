---
title: 'Phase 1 red E2E reproduction'
date: 2026-09-07
status: reproduced
locked_decisions:
  ask_location: chat_and_room_shared_controller
  visual_tokens: mockup_scoped_semantic
  simulation_controls: test_only
---

# Red E2E Reproduction

Real stack: isolated Archon server + SQLite + executor + env-gated `e2e-fake` provider.
Fixture: `e2e/fixtures/workflows/e2e-hitl-run.yaml` (`inspect-file` → `inspect-twice` ×2 → `ask-starter`).
Suite: `bun run --cwd e2e test:ui --grep "HITL"` — 8 passed (one expected `test.fail` for the product tool-card assertion).

Captures: [reports/captures/](captures/).

## What passed (fixture and runtime are real)

| Check                                                                 | Result                                 |
| --------------------------------------------------------------------- | -------------------------------------- |
| CLI `--json` exits 0 with `result.state === 'paused'`                 | Pass                                   |
| Native `AskHuman` persists `pending_interactions` for `ask-starter`   | Pass                                   |
| Starter `X-Archon-User` answer → 200; teammate → 403; no header → 401 | Pass                                   |
| CLI `workflow resume` after answer completes the run                  | Pass                                   |
| Live-start observes the **new** run id before CLI exit                | Pass                                   |
| Replay / view-as are absent from production chrome                    | Pass                                   |
| Fake provider still honors `<<E2E_USAGE>>` and no-directive paths     | Pass (`packages/providers` unit tests) |

## Recorded defects

### 1. Tool result never reaches the transcript

**Product assertion (expected fail):** `[P1] RED: inspect-file room shows visible tool output matching the mockup card`.

`GET /api/workflows/runs/:runId/nodes/inspect-file/messages` returns `kind: 'tool'` rows with `name`/`id`/`input` and **no** `output`. `HITL_TOOL_OUTPUT_VISIBLE` is absent from every payload.

**Source:** both provider loops in `packages/workflows/src/dag-executor.ts` append a tool **call** (`appendNodeTranscript` ~2322 and ~5794) then handle `tool_result` (~2373 / ~5850) by emitting `tool_completed` events only. They never write a second `tool` row.

The fake provider **does** emit `tool` + `tool_result` with `toolOutput: HITL_TOOL_OUTPUT_VISIBLE`. The omission is the executor, not the fixture.

**UI:** Console Log renders each call as a purple `TOOL` pill + `Read path="HITL_TOOL_INPUT.txt"` with duration. No inset `.ptool` card, no visible wrapping input/output. That matches `NodeRoom.tsx` `ToolTranscriptItem` (rounded-full chip + collapsed `<details>`), not mockup `.ptool`.

### 2. Two loop occurrences mix in the stream

`inspect-twice` actually ran twice (`Loop node 'inspect-twice' completed after 2 iterations`; bottom list shows `inspect-twice x1` and `x2`; two+ tool rows in the node transcript).

Console Log (default: Tool calls on, System off) concatenates adjacent assistant chunks into one paragraph: `[e2e-fake] tool passE2E_LOOP_DONE`. There is no `#node-transition-inspect-twice` divider in that filtered stream, so a later room selector can mix iteration bodies.

**Source:** stream builder + System filter hide per-occurrence dividers; transcript rows lack `occurrence_id`/`attempt_id`.

### 3. Visual contract gaps vs mockup

| Area           | Mockup (`console-mockup-1440x1000.png`)             | Actual (`console-actual-1440x1000.png`)                                                           |
| -------------- | --------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Tool cards     | Inset surface, visible I/O                          | Pill chip, input inline, no output                                                                |
| Agent text     | Role + 12.5px complete Markdown blocks              | `AGENT` label + concatenated chunks                                                               |
| Ask            | Request heading, numbered questions, Submit/Decline | Right pane Ask exists (question + yes/no/Other) but compact payload toggle, no mockup card chrome |
| Header         | Compact title/metadata; **no** Replay in production | Compact header retained; Replay/view-as absent (correct)                                          |
| Tabs           | Log / Graph / Artifacts                             | Present; Source Control owned by a sibling plan                                                   |
| Narrow 390×844 | Stacked graph/panel, usable Ask                     | Project rail + run chrome squeeze the Ask card; question/options still present                    |

## Capture IDs

| ID                                   | Files                                                                  |
| ------------------------------------ | ---------------------------------------------------------------------- |
| `console-log` / `tool-cards` / `ask` | `captures/console-actual-1440x1000.png`, `console-actual-1280x900.png` |
| `console-mockup` desktop             | `captures/console-mockup-1440x1000.png`, `console-mockup-1280x900.png` |
| Narrow fallback                      | `captures/console-actual-390x844.png`, `console-actual-768x1024.png`   |

Mockup `file://` capture loaded. The static HTML without `app.js` hydration shows empty log chrome plus mockup **Replay** / Legacy↔Command Center toggles — simulation controls, test-only, must not ship.

## Visual evidence limits

Playwright Chromium captured the four required viewports. Fonts were present (no webfont timeout). Changing values (run id prefix, clock, duration) were not masked; they sit outside the tool-card/history defect.

No browser-policy block. Canonical mockup screenshots are the static HTML shell, not the fully scripted sample run — use `ux-mockup/app.js` / `console-app.js` in later visual baselines if Phase 5 needs populated mockup frames.

## Phase 2 entry

Do not treat this report as parity. The product assertion must stay red until Phases 2–5 write the result row, scope history, and restore `.ptool` cards on both surfaces.
