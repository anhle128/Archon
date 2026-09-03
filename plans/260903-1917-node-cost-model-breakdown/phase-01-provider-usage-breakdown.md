# Phase 1 — Provider Usage Breakdown

## Context

Every provider's `result` chunk already carries `tokens`/`cost` (`packages/providers/src/types.ts:230-283`). Per-model detail exists at the boundary but is dropped. This phase replaces the untyped `modelUsage?: Record<string, unknown>` with a typed breakdown map and populates it per provider.

## Requirements

- New exported type in `packages/providers/src/types.ts`, replacing the `modelUsage` field on the `result` variant of `MessageChunk`:

  ```ts
  /** Usage attributed to one concrete model within a single provider query. */
  export interface ModelUsageEntry {
    input: number;
    output: number;
    cacheRead?: number;
    cacheWrite?: number;
    costUsd?: number;
    /** Number of assistant turns/messages attributed to this model. */
    calls: number;
    /** Set only when the source is authoritative (e.g. OMP advisor transcript). */
    kind?: 'advisor';
  }
  /** Keyed "<provider>/<model>" when the provider id is known, else "<model>". */
  export type UsageBreakdown = Record<string, ModelUsageEntry>;
  ```

  Field on result chunk: `usageBreakdown?: UsageBreakdown`. Keep existing `tokens`/`cost`/`resolvedModel` untouched (consumers unchanged).

- Grep check before renaming: `rg -n "modelUsage" packages/` — update Grok pass-through and the observability helper (`packages/providers/src/observability.ts:142-143` reads `Object.keys(chunk.modelUsage)[0]`).

## Per-provider population

1. **Claude** (`packages/providers/src/claude/provider.ts`, near `selectResolvedModelId` lines 123-148 and result emission ~1108-1195): map SDK `modelUsage: Record<model, ModelUsage>` entries into `usageBreakdown` (SDK gives per-model input/output/cache tokens + costUSD). Keep the existing highest-output `resolvedModel` selection and WARN.
2. **OMP** (`packages/providers/src/community/omp/event-parser.ts`): in `consumeMessageEnd`, key by `${provider}/${model}` (already computed for `resolvedModel`, line 262-263) and accumulate per key instead of only the single `this.tokens` total. Keep the total accumulation as-is (backward compat). Include cache fields if `usage.cacheRead/cacheWrite` present in message_end payload (verify field names against the omp JSON output; do not guess — if absent, omit).
3. **Pi** (`packages/providers/src/community/pi/event-bridge.ts`): FIRST verify usage semantics against the pinned SDK (`@earendil-works/pi-coding-agent@0.80.6`, source github.com/earendil-works/pi — node_modules is hook-blocked): is `AssistantMessage.usage` per-message or session-cumulative? If per-message: sum across all assistant messages of the query (fixes the existing last-message under-count) and build one breakdown entry per `responseModel`. Include `cacheRead`/`cacheWrite`. If cumulative: keep last-message read, single entry.
4. **Grok** (`packages/providers/src/grok/event-parser.ts:127-191`): translate its `modelUsage` object into breakdown entries if per-model; else single entry from tokens + `total_cost_usd`.
5. **Codex** (`packages/providers/src/codex/provider.ts:325-331, ~769-796`): single entry from tokens, no `costUsd`, keyed by resolved/requested model.
6. **OpenCode** (`packages/providers/src/community/opencode/tokens.ts`): single entry incl. `info.cost`; if per-agent totals identify distinct models, one entry per model.
7. **Copilot** (`packages/providers/src/community/copilot/event-bridge.ts:111-124`): single entry, tokens only.
8. **Qoder**: no data — emit no `usageBreakdown`.

## Files

- `packages/providers/src/types.ts`
- `packages/providers/src/observability.ts`
- `packages/providers/src/claude/provider.ts`
- `packages/providers/src/community/omp/event-parser.ts`
- `packages/providers/src/community/pi/event-bridge.ts`
- `packages/providers/src/grok/event-parser.ts`
- `packages/providers/src/codex/provider.ts`
- `packages/providers/src/community/opencode/tokens.ts` (+ session/multi-agent if model info lives there)
- `packages/providers/src/community/copilot/event-bridge.ts`
- Existing colocated tests for each touched file

## Validation

- `bun --filter @archon/providers test`
- Unit tests: OMP parser fed message_end events with two different models → two entries + unchanged total; Claude modelUsage with fallback entry → two entries; Pi multi-assistant-message fixture → summed (after semantics verification).

## Risk / rollback

Additive optional field; consumers ignore it until phase 2. Rollback = revert the package. The Pi semantics fix changes reported totals (correcting an under-count) — call it out in the PR.
