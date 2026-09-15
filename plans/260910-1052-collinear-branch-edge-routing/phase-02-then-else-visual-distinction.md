---
title: 'Phase 2: Then else visual distinction'
status: todo
priority: P2
effort: '2h'
dependencies: [1]
---

# Phase 2: Then else visual distinction

## Overview

After paths no longer overlap, paint and label then vs else so the screenshot's two meanings stay readable when both edges are taken (HAS_QUESTIONS, red-team also live).

## Context

- Phase 1 separates geometry. This phase does not move paths.
- Today `kind: conditional` is dashed and, when taken, `accent-bright` — same color as a taken skip `kind: dependency`.
- `outcome: positive | negative` exists only for `kind: route` (`route_loop`).
- Join `check → red-team` is not exclusive else. It still fires when the then path ran. Label it as skip/join, not as XOR false.

## Requirements

- Functional: a `conditional` edge uses success stroke when taken (then). Untaken stays dashed border.
- Functional: a dependency skip that shares a source with a conditional sibling may carry `label: "else"` or keep unlabeled; if labeled, put the chip on the flank `labelPosition`.
- Functional: do not mark `respond → red-team` as else. Only the sibling of a `conditional` from the same source.
- Non-functional: no YAML change. Inference stays in `build-run-graph-input.ts` or `buildRoutes`.
- Non-functional: `route_loop` positive/negative/exhausted colors stay as they are.

## Architecture

Preferred: keep `LayoutEdgeKind`. Do not add a new kind unless a test cannot distinguish skip from ordinary join.

In `build-run-graph-input.ts`, after emitting edges:

```
for each source S:
  hasConditional = S has an outgoing kind=conditional
  for each outgoing dependency S→T:
    if hasConditional and layer(T) > layer(conditionalTarget):
      set label = "else" if label empty
```

Layer is not known at input-build time. Simpler rule without layers:

```
if S has outgoing conditional to A and outgoing dependency to B and A !== B:
  tag B as else
```

That matches check→respond (conditional) + check→red-team (dependency). It does not tag respond→red-team (respond has no `when`).

Stroke in `RunGraphRouteEdge`:

- taken + `kind: conditional` → `var(--success)` (then)
- taken + else-tagged dependency → `var(--accent)` (same token as negative route)
- taken + ordinary dependency → keep `accent-bright`

## Related Code Files

- Modify: `packages/web/src/components/workflows/build-run-graph-input.ts`
- Modify: `packages/web/src/components/workflows/build-run-graph-input.test.ts`
- Modify: `packages/web/src/components/workflows/RunGraphRouteEdge.tsx`
- Modify: `packages/web/src/components/workflows/RunGraphRouteEdge.test.tsx`
- Optional: Console copy of edge construction in `packages/web/src/experiments/console/components/graph/build-run-graph-input.ts` — keep inference in one helper if both files duplicate the loop. Prefer extracting a tiny `tagElseEdges(edges)` in `lib/run-graph` over two copies.

## Implementation Steps

1. Add an optional `outcome?: 'negative'` or a boolean `elseSkip` on `LayoutEdge` only if a new field is needed. Prefer reusing `outcome: 'negative'` on a dependency edge so `RunGraphRouteEdge` already paints accent.
2. Tag else edges in the shared input builder.
3. Paint taken conditionals as success.
4. Tests: HAS_QUESTIONS fixture colors; NO_QUESTIONS fixture (screenshot) shows dashed then + accent else; `respond → red-team` is not tagged else.
5. If Console duplicates the builder, apply the same tag or extract helper.

## Todo

- [ ] Tag else sibling of a conditional without touching YAML
- [ ] Taken conditional → success stroke
- [ ] Tests for screenshot state and HAS_QUESTIONS state
- [ ] Deduplicate Console vs Legacy tagging if both emit edges

## Success Criteria

- [ ] Screenshot state: dashed gray then on spine, accent else on right flank, labels do not share a point
- [ ] HAS_QUESTIONS state: green then on spine, else flank still visible (join may also be taken)
- [ ] `bun test` on the four files above
- [ ] No change to `.archon/workflows/defaults/speckit-ralph-native-no-hitl-feature.yaml`

## Risk Assessment

- Calling the join "else" is slightly wrong when both paths ran. Signal: users think red-team skipped respond. Response: label `else` only, keep join edges from respond/apply unlabeled. Do not hide the join.
- Extracting a helper across Legacy/Console may exceed this phase. Signal: Console still overlapping labels. Response: duplicate the three-line tag in Console if extract slips; geometry from phase 1 already flows through shared `layout()`.

## Security Considerations

None.
