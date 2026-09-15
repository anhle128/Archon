---
title: 'Phase 1: Obstacle-aware skip detour'
status: todo
priority: P1
effort: '4h'
dependencies: []
---

# Phase 1: Obstacle-aware skip detour

## Overview

Change `forwardGeometry` so a multi-layer forward edge in the same column leaves the spine and uses a right-flank lane. That is the screenshot bug.

## Context

- Mockup: [clarify-file-check-edges.html](./mockups/clarify-file-check-edges.html) tab A
- Geometry today: `packages/web/src/lib/run-graph/routes.ts`
- Locked wrong behavior: `packages/web/src/lib/run-graph/routes.test.ts` "vertically aligned multi-layer edge still enters the target top"
- Positions stay in `positions.ts`. Do not move nodes in this phase.

## Requirements

- Functional: if `|targetLayer - sourceLayer| > 1` and `|dx| ≤ SIDE_PORT_THRESHOLD`, route on the right flank and enter the target right port.
- Functional: adjacent-layer edges stay bottom → top vertical cubics.
- Functional: existing offset long edges (`|dx| > 156`) keep current left/right entry.
- Functional: multiple collinear skips from one source get distinct lanes (`+GUTTER`, `+2*GUTTER`, …). Second skip in this subgraph is `clarify-respond → red-team`.
- Non-functional: no extra layout pass beyond grouping edges that share a source. Keep `layout()` sync and deterministic.
- Non-functional: back-edge left gutter unchanged.

## Architecture

`buildRoutes` currently layouts each edge in isolation. Add a per-source index for collinear skips before calling `forwardGeometry`.

Pseudocode:

```
function forwardGeometry(sourcePos, targetPos, sourceLayer, targetLayer, laneIndex = 0):
  dx = centerX(target) - centerX(source)
  layerDelta = abs(targetLayer - sourceLayer)
  if layerDelta <= 1:
    return verticalCubic(bottomCenter → topCenter)   # unchanged
  if abs(dx) > SIDE_PORT_THRESHOLD:
    return existingSideEntry()                       # unchanged
  lane = sourcePos.x + NODE_WIDTH + BACK_EDGE_GUTTER + laneIndex * BACK_EDGE_GUTTER
  start = bottomCenter(sourcePos)
  end = rightCenter(targetPos)
  return cubic(start, {x: lane, y: start.y}, {x: lane, y: end.y}, end)
```

`laneIndex` is the 0-based order of collinear multi-layer forward edges from the same source, definition order.

Do not use `Math.sign(0)` — that path exists today in the non-short branch and would send `dx = 0` to `leftCenter`. Explicit right flank.

## Related Code Files

- Modify: `packages/web/src/lib/run-graph/routes.ts`
- Modify: `packages/web/src/lib/run-graph/routes.test.ts`
- Modify: `packages/web/src/lib/run-graph/constants.ts` only if a named `SKIP_EDGE_GUTTER` is clearer than reusing `BACK_EDGE_GUTTER`
- Unchanged: `positions.ts`, YAML workflows, `build-run-graph-input.ts` (phase 2)

## Implementation Steps

1. Replace the `shortEdge` disjunction. Adjacent-only for the vertical cubic.
2. Add an explicit collinear-skip branch. Right flank, right port, cubic matching `backGeometry` mirrored.
3. In `buildRoutes`, count collinear skips per source and pass `laneIndex`.
4. Delete or rewrite the test that locks top-entry for vertically aligned multi-layer edges.
5. Add a fixture matching the no-hitl clarify subgraph (check, respond, apply, red-team) and assert:
   - check→respond: `sourcePort=bottom`, `targetPort=top`, same `x` on path start/end
   - check→red-team: `targetPort=right`, path `x` reaches `source.x + NODE_WIDTH + gutter`
   - path of check→red-team does not stay on `centerX(check)` for the mid y of respond
6. Keep back-edge and self-edge tests green.

## Todo

- [ ] Split `shortEdge` into adjacent vs collinear-skip
- [ ] Right-flank geometry + lane index
- [ ] Replace collinear top-entry test
- [ ] Clarify-chain fixture
- [ ] Confirm Console graph consumes the same `layout()` with no extra change

## Success Criteria

- [ ] Screenshot topology: then spine and skip flank are different paths
- [ ] Skip does not share the vertical `x` of respond/apply through their y-range
- [ ] `bun test packages/web/src/lib/run-graph/routes.test.ts`
- [ ] Retry back-edge path string in `layout.test.ts` unchanged

## Risk Assessment

- Two skips on the right can still crowd if lane spacing is too small. Signal: fixture with check→red-team and respond→red-team. Response: increment `laneIndex`.
- Right-port entry may sit under a node handle visually. Signal: marker buried in the card. Response: end at `rightCenter`, same as today's offset long edges.
- Treating every collinear long edge as a skip also detours harmless empty-rank jumps. Cheap, keep the rule simple. Do not special-case "has intermediate node" unless a test DAG looks worse.

## Security Considerations

None. Layout-only, no user data.
