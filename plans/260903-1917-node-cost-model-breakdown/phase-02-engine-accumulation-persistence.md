# Phase 2 — Engine Accumulation + Persistence

## Context

`dag-executor.ts` already accumulates `nodeCostUsd`/`nodeTokens` per node (result-chunk handler ~2270-2298), sums loop iterations (`loopTotalCostUsd`, ~4211, ~5066), rolls sub-run cost into the parent node (D8, ~554, ~6530), and writes run totals once at run end (~10184-10188). This phase adds the breakdown map alongside each of those, same lifecycle, same NaN guards.

## Requirements

- Zod schema `usageBreakdownSchema` in `packages/workflows/src/schemas/` (new file `usage-breakdown.ts`, re-export from `index.ts`); `z.record(z.string(), entrySchema)` — explicit key type per repo convention; import `z` from `@hono/zod-openapi`.
- Node-level: accumulate a `nodeUsageBreakdown` map in the stream pass (merge `msg.usageBreakdown` entries key-wise: sum numeric fields, sum `calls`). Reset per reask attempt exactly like `nodeCostUsd` (`runStreamPass` resets, ~2030-2035); accumulate across attempts like `accumulatedCostUsd` (~2657-2663).
- Persist in `node_completed` event payload as `usage_breakdown` next to the existing `cost_usd`/`model_usage` (~2909-2941). Loop nodes: merged map across iterations, following each `loopTotalCostUsd` write site (single-node loop AND loop_group; mind the #2333 double-count notes at ~4415 — breakdown follows the same "charge once" decision as cost_usd at each site).
- Run-level: merge all node maps and write `usage_by_model` into run metadata beside `total_cost_usd` (~10184). Same "omit when empty" style.
- Sub-run rollup: child run's `usage_by_model` merges into the parent `workflow:` node's breakdown (extend the D8 outcome plumbing ~6530-6558) and thence into the parent run map.
- Resume: totals for completed nodes are re-read from persisted events/metadata — verify the existing resume path for `total_cost_usd` and mirror it; must not double-count (#2333) and must not regress #2345 (usage lost across pause gates — out of scope to fix, in scope to not worsen).
- Key format is opaque to the engine; no parsing of `provider/model` keys (Natural Language Is Not a Wire Format does not apply — this is typed data — but keys stay opaque strings regardless).

## Files

- `packages/workflows/src/schemas/usage-breakdown.ts` (new) + `packages/workflows/src/schemas/index.ts`
- `packages/workflows/src/dag-executor.ts`
- `packages/workflows/src/dag-executor.test.ts` (or the focused test file colocated with the touched paths)

## Validation

- `bun --filter @archon/workflows test`
- Tests: (1) node with two-model breakdown persists both entries; (2) reask attempt does not leak prior attempt's map; (3) loop 3 iterations → summed map, charged once; (4) sub-run map merges into parent; (5) run metadata map equals sum of node maps; (6) resume of a half-complete run does not double-count completed nodes.

## Risk / rollback

Payload/metadata additive JSON — old readers unaffected; old runs simply lack the fields (readers must treat absence as "not recorded", never zero). Rollback = revert; no schema migration involved.
