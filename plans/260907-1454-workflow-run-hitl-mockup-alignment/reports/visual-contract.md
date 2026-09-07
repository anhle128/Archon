---
title: 'Workflow Run HITL Visual Contract'
date: 2026-09-07
status: inventory
locked_decisions:
  ask_location: chat_and_room_shared_controller
  visual_tokens: mockup_scoped_semantic
  simulation_controls: test_only
---

# Visual Contract

Canonical sources (do not use `ux-prototype`):

- `_bmad-output/specs/spec-workflow-run-view-hitl/ux-mockup/index.html`
- `_bmad-output/specs/spec-workflow-run-view-hitl/ux-mockup/console.html`
- `_bmad-output/specs/spec-workflow-run-view-hitl/ux-mockup/app.js`
- `_bmad-output/specs/spec-workflow-run-view-hitl/ux-mockup/console-app.js`
- `_bmad-output/specs/spec-workflow-run-view-hitl/ux-mockup/styles.css`
- `_bmad-output/specs/spec-workflow-run-view-hitl/ux-design.md` for accessibility and responsive cases absent from the mockup

`--auto` locked the three provisional plan defaults: Ask is synchronized in Chat/stream and the node room; match the mockup with scoped semantic tokens; Replay and view-as stay test-only.

## URLs

| Surface | Run URL                          | Node deep-link                                                                          |
| ------- | -------------------------------- | --------------------------------------------------------------------------------------- |
| Legacy  | `/legacy/workflows/runs/:runId`  | No query param today; selection is React state. Phase 3 may add a compatible deep-link. |
| Console | `/console/p/:projectId/r/:runId` | `?node=<nodeId>` via `readNodeSearchParam`                                              |

Console Log/Graph/Artifacts view is localStorage (`archon.console.detailView`), not a query param.

Capture viewports: 1440x1000 and 1280x900 (desktop parity); 390x844 and 768x1024 (documented fallback).

## Tokens

Mockup `:root` already mirrors `packages/web/src/index.css` (oklch surfaces, accent, success/warning/error, node-type hues, `--radius: 0.625rem`).

Phase 3 adds **scoped** run-view semantic tokens under both run-view roots. Do not apply the run palette sitewide. Map undefined Console mockup tokens to documented brand tokens in `packages/docs-web/src/content/docs/brand/index.md`.

| Token / measure | Canonical value                                             | Notes                                       |
| --------------- | ----------------------------------------------------------- | ------------------------------------------- |
| Agent body      | 12.5px / 1.5 line-height                                    | `.pmsg-text`                                |
| Tool card       | inset surface, 1px `--border`, `--radius`, 8px 10px padding | `.ptool` — not a pill chip                  |
| Tool I/O        | visible wrapping `pre`, 11px                                | Do not collapse to JSON `<details>`         |
| Panel default   | 460px                                                       | Range 320–720px, clamped to available space |
| Graph node      | 208×58 px                                                   | `app.js` `NODE_W` / `NODE_H`                |
| Graph gaps      | 34px horizontal, 46px vertical                              | `GAP_X` / `GAP_Y`                           |
| Ask card        | warning border, `--radius`, 12px 14px                       | `.ask-card`                                 |

Replay (`#btn-replay`) and Legacy "view as" (`#view-toggle`) are mockup simulation controls. Production must not ship them; tests may emulate starter vs teammate via identity headers.

## Feature inventory

| Area            | Required result                                                                                                 | Owner                            | Capture ID        |
| --------------- | --------------------------------------------------------------------------------------------------------------- | -------------------------------- | ----------------- |
| Legacy header   | Two-level title, run ID, status, compact metadata chips                                                         | Phase 3                          | `legacy-header`   |
| Console header  | Compact title + metadata; retain usage, provenance, env, IDE, cancel/resume/retry                               | Phase 4                          | `console-header`  |
| Tabs            | Exact active/idle treatment; retain Source Control and Artifacts                                                | Phases 3–4                       | `tabs`            |
| Panel lifecycle | Closed unless deep-linked; close restores space; selection/drafts survive views                                 | Phases 3–4                       | `panel-lifecycle` |
| Panel width     | Default 460px; 320–720px clamped                                                                                | Phases 3–4                       | `panel-width`     |
| Panel heading   | Type, name, status, duration, start offset, pass/iteration chips, close                                         | Phases 3–4                       | `panel-heading`   |
| Legacy Logs     | Complete rows: status mark, node/pass, type, status, duration, offset                                           | Phase 3                          | `legacy-logs`     |
| Legacy Chat     | User labels, compact node records, lifecycle/route/decision, inline Ask                                         | Phase 3                          | `legacy-chat`     |
| Console Log     | One section + sticky divider per execution with exact body                                                      | Phase 4                          | `console-log`     |
| Agent text      | Role label, complete Markdown, 12.5px                                                                           | Phases 3–4                       | `agent-text`      |
| Tool cards      | Inset border, name, factual summary, visible input/output                                                       | Phases 3–4                       | `tool-cards`      |
| Status/answers  | Quiet lifecycle notes and compact retained answers                                                              | Phases 3–4                       | `status-answers`  |
| Bash/script     | Attributed command header, grouped terminal output                                                              | Phases 3–4                       | `bash-script`     |
| Gate            | Scoped review card, real document/link, annotations, actions, retained outcome                                  | Phases 3–4                       | `gate`            |
| Route           | Outcome block, decision details, selected-pass evidence                                                         | Phases 3–4                       | `route`           |
| Other nodes     | Child workflow links, loop-group detail, factual cancel                                                         | Phases 3–4                       | `other-nodes`     |
| Ask             | Request/node heading, question numbers, options, Other, submit/decline, errors                                  | Phases 3–4                       | `ask`             |
| Awaiting        | Correct count and focusable node/gate pointer                                                                   | Phases 3–4                       | `awaiting`        |
| Composer        | Real parent-conversation send; factual unavailable state                                                        | Phases 3–4                       | `composer`        |
| Graph           | 208×58 nodes, 34/46 gaps, type border, join badge, amber negative route, retry curve, pan/zoom/fit, hover trace | Phase 3 shared; Phase 4 renderer | `graph`           |
| Artifacts       | Real list/preview; open room preserved                                                                          | Phase 4                          | `artifacts`       |

## Production fallbacks

- Desktop dimensions: mockup wins over older UX text.
- Below 1024px: UX document stacked graph/panel; collapsible graph summary.
- 1024–1279px: favor the panel; collapse secondary graph chrome.
- Account for app navigation and the Console project rail.
- A 320px minimum must not force a room beside navigation.
- Ask must stay usable at 390px and 768px.
- Add keyboard resize, focus labels, touch access, and reduced-motion (absent from the prototype).

## Exceptions

- Do not copy mockup Replay or view-as into production chrome.
- Do not replace visible tool I/O with chips and collapsed JSON.
- Do not edit the mockup to match the product.
- Unavailable old data is marked unknown, never filled from simulation content.
- Console must not import Legacy React modules; shared `lib/run-graph` remains the only sanctioned runtime `@/lib` exception.
