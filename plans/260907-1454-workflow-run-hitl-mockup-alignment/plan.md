---
title: 'Workflow Run HITL Mockup Alignment'
description: 'Restore both run views to the canonical mockup with correct execution history.'
status: pending
priority: P1
effort: '104-148h'
branch: dev
tags: [bugfix, frontend, backend, database, api]
blockedBy: []
blocks: []
created: 2026-09-07
---

# Workflow Run HITL Mockup Alignment

## Outcome

Restore the full visual and interaction contract in `_bmad-output/specs/spec-workflow-run-view-hitl/ux-mockup/` on Legacy and Console.
Correct missing tool results and mixed execution history so the restored UI shows real data.
Keep Source Control, Artifacts, usage, environment, provenance, IDE links, cancel, resume, and retry accessible.
This is an implementation plan only.
All implementation remains pending.

## Authority and Scope

Read [source findings](research/source-findings.md) and [Phase 1](phase-01-start.md) for the complete inventory.
Canonical sources are `index.html`, `console.html`, `app.js`, `console-app.js`, and `styles.css` in the mockup directory.
The older `ux-prototype` is not the visual authority.
Use `ux-design.md` for accessibility and responsive cases absent from the mockup.
Do not replace graph libraries, share React modules across the Console boundary, widen authorization, or change workflow YAML.

## Proposed Decisions

These defaults are provisional while optional user answers are pending.

| Decision            | Proposed default                                                                                 |
| ------------------- | ------------------------------------------------------------------------------------------------ |
| Ask location        | Chat/stream and node room share request, draft, action state, and controller within each surface |
| Visual tokens       | Match the mockup with scoped semantic tokens; map brand aliases and document new tokens          |
| Simulation controls | Replay and view-as remain test-only                                                              |

The composer sends to the run's valid parent web conversation through the existing send API.
It does not promise queued agent delivery or treat prose as a gate decision.
Disable it with a factual reason when no valid destination exists.

## Phase Roadmap

| #   | Phase                                                                            | Status  | Depends On | Estimate |
| --- | -------------------------------------------------------------------------------- | ------- | ---------- | -------- |
| 1   | [Visual Contract and Red E2E](phase-01-start.md)                                 | Pending | None       | 12-16h   |
| 2   | [Transcript and Execution History](phase-02-transcript-and-execution-history.md) | Pending | 1          | 36-52h   |
| 3   | [Legacy Run View and Shared Graph](phase-03-legacy-run-view.md)                  | Pending | 2          | 20-28h   |
| 4   | [Console Run View](phase-04-console-run-view.md)                                 | Pending | 3          | 20-28h   |
| 5   | [Visual and End-to-End Acceptance](phase-05-visual-and-end-to-end-acceptance.md) | Pending | 4          | 16-24h   |

Dependency order is `1 -> 2 -> 3 -> 4 -> 5`.
Phase 3 owns shared graph changes; Phase 4 consumes them.
Related work needs coordination, not blocking dependencies:
[Source Control](../260907-0357-source-control-mockup-alignment/plan.md) and [Node Cost](../260903-1917-node-cost-model-breakdown/plan.md).

## Acceptance

- [ ] Every mockup feature maps to real data and a verified interaction on both surfaces.
- [ ] History separates occurrences, attempts, route passes, retry epochs, and nested loops.
- [ ] Real tool invocation, Ask pause, authorized answer, resume, and retained answer pass through server, database, and executor.
- [ ] All critical/high scenarios pass; medium deviations are fixed or explicitly accepted.
- [ ] Side-by-side captures match the canonical mockup, with no unresolved visual deviations.
- [ ] Narrow layouts, keyboard use, resizing, scroll, and drafts remain usable.
- [ ] Root `bun run validate`, PostgreSQL schema upgrades, and standalone Playwright pass.
- [ ] Rollback keeps additive database fields intact.

## Red Team Review

[Review record](reports/plan-review.md): 14 consolidated findings, 13 incorporated and one rejected with source evidence.

## Validation Log

[Validation record](reports/plan-review.md#validation): three proposed defaults await confirmation; no implementation approval or screenshot parity is claimed.

<!-- slug: workflow-run-hitl-mockup-alignment -->
