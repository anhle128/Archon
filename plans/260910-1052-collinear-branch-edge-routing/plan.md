---
title: 'Collinear branch edge routing'
description: 'Separate then/else edges that share one vertical corridor on the run graph.'
status: pending
priority: P1
effort: 6h
branch: develop
tags: [bugfix, frontend]
blockedBy: []
blocks: []
created: 2026-09-10
---

# Collinear branch edge routing

## Overview

`clarify-file-check` in `speckit-ralph-native-no-hitl-feature` is a bash discriminator, not a `route_loop`. True path: `when == HAS_QUESTIONS` → `clarify-respond` → `clarify-apply`. False path: join edge `clarify-file-check → red-team` with `trigger_rule: none_failed_min_one_success`. Layout stacks that chain in one column. `forwardGeometry` treats `|dx| ≤ 156px` as a short edge, so both paths are bottom-center → top-center cubics on the same `x`. They paint as one line.

Do not change workflow YAML. Fix geometry in `packages/web/src/lib/run-graph/routes.ts`. Same layout module feeds Legacy Graph and Console Graph.

Mockup: [clarify-file-check-edges.html](./mockups/clarify-file-check-edges.html)

## Brainstorm contract

- **Outcome:** A branching source with an adjacent then-edge and a multi-layer skip-edge shows two separable paths. Viewer can tell HAS_QUESTIONS from skip/join.
- **Constraints:** Keep node positions. Keep back-edge left gutter. No YAML/runtime change. Console and Legacy share `layout()`.
- **Non-goals:** Relayout every DAG into two columns. Infer XOR semantics that the join does not have. Redesign `route_loop` handles.
- **Acceptance:** The screenshot topology no longer collides. Fixture test for this chain. Adjacent-layer spine edges stay vertical.

## Diagnosis

Verified by `routes.ts:95` and `routes.test.ts` "vertically aligned multi-layer edge still enters the target top".

```
shortEdge = |targetLayer - sourceLayer| <= 1
         || |dx| <= SIDE_PORT_THRESHOLD   // 156px = 0.75 * NODE_WIDTH
```

Same-column skip has `dx = 0`, so it always takes the vertical cubic. Skip cubic runs through `clarify-respond` and `clarify-apply`.

Edges the UI emits for this subgraph (`build-run-graph-input.ts`):

| id                                   | kind        | role                 |
| ------------------------------------ | ----------- | -------------------- |
| clarify-file-check → clarify-respond | conditional | then (`when`)        |
| clarify-respond → clarify-apply      | dependency  | spine                |
| clarify-file-check → red-team        | dependency  | skip / join          |
| clarify-respond → red-team           | dependency  | join, also collinear |
| clarify-apply → red-team             | dependency  | adjacent fan-in      |

Positive/negative handles on `ExecutionDagNode` are `route_loop` only and unused here. Paths are precomputed SVG; xyflow handle offsets do not move them.

## Chosen direction

**A — obstacle-aware right flank**, confirmed 2026-09-10.
Ship phase 1 geometry and phase 2 then/else paint together.

- Adjacent (`layerDelta <= 1`): keep current bottom → top cubic.
- Multi-layer and `|dx| > 156`: keep current side-port entry.
- Multi-layer and `|dx| ≤ 156`: right-flank cubic, enter target `right` port. Left flank is already back-edge territory.
- Taken `conditional` → success stroke. Sibling skip of a conditional → `else` label + accent. Join edges that are not that sibling stay unlabeled.

Rejected:

- **B lane offset ±12px:** still punches through node bodies.
- **C two-column cluster:** correct flowchart, changes `positions.ts` for every skip DAG. Larger than the bug.

## Cross-Plan Dependencies

None. HITL mockup alignment plan is done and does not own `routes.ts` geometry.

## Goals

| #   | Goal                                                       | Priority |
| --- | ---------------------------------------------------------- | -------- |
| 1   | Collinear skip edges detour around intermediate nodes      | P1       |
| 2   | Then vs else readable by color and label, not only by path | P2       |

## Phases

| #   | Phase                                                                      | Status  |
| --- | -------------------------------------------------------------------------- | ------- |
| 1   | [Obstacle-aware skip detour](./phase-01-start.md)                          | Pending |
| 2   | [Then else visual distinction](./phase-02-then-else-visual-distinction.md) | Pending |

## Success Criteria

- [ ] On the no-hitl clarify chain, HAS_QUESTIONS edge and check→red-team skip are not the same SVG path.
- [ ] Skip does not cross the bounding box of respond/apply.
- [ ] Adjacent sequential edges stay vertical cubics.
- [ ] Back-edges still use the left gutter.
- [ ] YAML and executor semantics unchanged.
- [ ] `routes.test.ts` replaces the collinear-top-entry lock with a flank assertion.
- [ ] Legacy and Console graphs both pick up the change via shared `layout()`.

## Open questions

None. Approach A and phase 1+2 locked by user.

<!-- slug: collinear-branch-edge-routing -->
