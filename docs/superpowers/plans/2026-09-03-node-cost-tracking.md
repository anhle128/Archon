# Node Cost Tracking (Per-Model/Provider Breakdown + Usage Ledger) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** After an agent-calling workflow node finishes, report its cost broken down per `(provider, model)` — including Claude fallbackModel, OMP fallback-chain, and OMP advisor sessions — per node, rolled up per run, and queryable across runs via a usage ledger with estimated pricing for token-only providers.

**Architecture:** Providers emit a typed `usageBreakdown` map in their `result` chunk. The dag-executor accumulates it per node (across reask attempts, loop iterations, sub-runs), writes it as JSON to the `node_completed` event payload and run metadata (per-run view), and writes flat rows to a new `remote_agent_usage_ledger` table (cross-run reporting). A pricing module fills estimated USD for providers that report tokens only. API + CLI + a web Cost page read the ledger.

**Tech Stack:** Bun + TypeScript, Zod (`@hono/zod-openapi`), SQLite + PostgreSQL (dual dialect, additive schema), OpenAPIHono, React + Tailwind v4 (web console).

**Spec:** `docs/superpowers/specs/2026-09-03-node-cost-tracking-design.md`

## Global Constraints

- **Strict TypeScript**, complete annotations, no unjustified `any`. Zero ESLint warnings (`--max-warnings 0`).
- **Zod:** import `z` from `@hono/zod-openapi` in all schema files; derive types with `z.infer` (never parallel hand-written interfaces); `z.record(z.string(), valueSchema)` with explicit key type.
- **Schema is additive-only, both dialects.** Only ADD tables/columns/indexes. Every `ADD COLUMN NOT NULL` carries a `DEFAULT`. New indexes/`COMMENT ON COLUMN` go in the trailing "Indexes and column comments" section of `migrations/000_combined.sql`, never beside the table body. Mirror every change into SQLite `createSchema()` in `packages/core/src/db/adapters/sqlite.ts`. Run `bun run generate:bundled-schema` after editing the migration; `bun run check:schema-upgrades` (Postgres) must pass.
- **No fabricated numbers:** never write `$0` for unknown cost; never guess model attribution; estimated USD lives only in `cost_estimated_usd`, never in `cost_usd`, the JSON breakdown, or run totals. Absence stays absence.
- **Cost tracking must never fail a node or run.** Every failure in the cost path (ledger write, transcript read, catalog lookup) logs a WARN and continues.
- **No plan/finding refs in code, comments, migration names, test names, or commit messages** — explain the invariant directly. Migration/table names use domain slugs.
- **Package deps:** `@archon/workflows` may import only `@archon/git`, `@archon/paths`, `@archon/providers/types`, `@hono/zod-openapi`, `zod`. `@archon/web` never imports `@archon/workflows` — it reads generated types.
- **Logging:** `createLogger('<module>')` from `@archon/paths`; structured object first, event name `{domain}.{action}_{state}` second.
- **Run the narrowest test first:** `bun --filter @archon/<pkg> test`. Do NOT run `bun test` from the repo root. Full gate before PR: `bun run validate`.

---

## File Structure

**New files**
- `packages/providers/src/shared/usage-breakdown.ts` — pure `usageKey`, `mergeUsageEntry`, `mergeUsageBreakdown` helpers over the provider `UsageBreakdown` type.
- `packages/workflows/src/schemas/usage-breakdown.ts` — `modelUsageEntrySchema`, `usageBreakdownSchema` (Zod; `z.infer` must match the provider TS type).
- `packages/core/src/db/usage-ledger.ts` — ledger row insert (idempotent per node), delete-for-node, and query functions.
- `packages/core/src/pricing/estimate-cost.ts` — estimated-USD resolver (config → Pi catalog → none).
- `packages/server/src/routes/schemas/usage.ts` — Zod request/response schemas for the usage API.
- `packages/web/src/experiments/console/components/UsageBreakdownTable.tsx` — per-run/per-node breakdown table.
- `packages/web/src/experiments/console/routes/CostPage.tsx` — cross-run Cost page.
- `packages/web/src/experiments/console/primitives/usage.ts` — pure aggregation/formatting helpers for the Cost page (unit-tested).
- `packages/providers/src/community/omp/advisor-usage.ts` — advisor-transcript reader.

**Modified files**
- `packages/providers/src/types.ts` — replace `modelUsage?: Record<string, unknown>` with `usageBreakdown?: UsageBreakdown`; add `ModelUsageEntry`/`UsageBreakdown` types.
- `packages/providers/src/observability.ts` — read the new field shape.
- `packages/providers/src/{claude/provider.ts, community/omp/event-parser.ts, community/pi/event-bridge.ts, grok/event-parser.ts, codex/provider.ts, community/opencode/tokens.ts, community/copilot/event-bridge.ts}` — populate `usageBreakdown`.
- `packages/providers/src/community/omp/provider.ts` — fold advisor usage after process exit.
- `packages/workflows/src/schemas/index.ts` — export usage-breakdown schema; `schemas/workflow-run.ts` — add `usage_by_model` to `workflowRunMetadataSchema`.
- `packages/workflows/src/dag-executor.ts` — accumulate per node, persist to event + run metadata, fold to run totals, loop/sub-run merge, call ledger write.
- `packages/workflows/src/store.ts` — add `recordUsageLedger` to `IWorkflowStore`.
- `packages/core/src/db/adapters/sqlite.ts` — SQLite ledger table + indexes; `migrations/000_combined.sql` — Postgres ledger table + trailing indexes; `packages/core/src/db/adapters/sqlite.test.ts` parity allowlist if needed.
- `packages/core/src/workflows/store-adapter.ts` — implement `recordUsageLedger`.
- `packages/core/src/index.ts` — export usage-ledger query fns + pricing.
- `packages/server/src/routes/api.ts` — register `GET /api/usage`.
- `packages/cli/src/cli.ts` — register `archon usage`.
- `packages/web/src/lib/api.generated.d.ts` — regenerate; wire the two new components into run detail + console nav.

---

# PHASE 1 — Provider `usageBreakdown` (contract + per-provider population)

### Task 1: Usage-breakdown types + pure merge helpers

**Files:**
- Modify: `packages/providers/src/types.ts` (result variant, ~line 258-283; `modelUsage` at 270)
- Create: `packages/providers/src/shared/usage-breakdown.ts`
- Modify: `packages/providers/src/observability.ts` (~142-143)
- Test: `packages/providers/src/shared/usage-breakdown.test.ts`

**Interfaces:**
- Produces: `interface ModelUsageEntry { input:number; output:number; cacheRead?:number; cacheWrite?:number; costUsd?:number; calls:number; kind?:'advisor' }`; `type UsageBreakdown = Record<string, ModelUsageEntry>`; result-chunk field `usageBreakdown?: UsageBreakdown`; `usageKey(provider:string|undefined, model:string):string`; `mergeUsageEntry(b:UsageBreakdown, key:string, e:ModelUsageEntry):void`; `mergeUsageBreakdown(target:UsageBreakdown, source:UsageBreakdown|undefined):void`.

- [ ] **Step 1: Write the failing test**

```ts
// packages/providers/src/shared/usage-breakdown.test.ts
import { describe, it, expect } from 'bun:test';
import { usageKey, mergeUsageEntry, mergeUsageBreakdown } from './usage-breakdown';
import type { UsageBreakdown } from '../types';

describe('usage-breakdown helpers', () => {
  it('usageKey joins provider and model, or model alone', () => {
    expect(usageKey('anthropic', 'claude-opus-4')).toBe('anthropic/claude-opus-4');
    expect(usageKey(undefined, 'gpt-5')).toBe('gpt-5');
  });

  it('mergeUsageEntry sums numerics and creates a copy for a new key', () => {
    const b: UsageBreakdown = {};
    mergeUsageEntry(b, 'a/m', { input: 10, output: 5, calls: 1 });
    mergeUsageEntry(b, 'a/m', { input: 3, output: 2, calls: 1, costUsd: 0.02 });
    expect(b['a/m']).toEqual({ input: 13, output: 7, calls: 2, costUsd: 0.02 });
  });

  it('mergeUsageEntry accumulates optional cache/cost only when present', () => {
    const b: UsageBreakdown = {};
    mergeUsageEntry(b, 'k', { input: 1, output: 1, calls: 1, cacheRead: 4 });
    mergeUsageEntry(b, 'k', { input: 1, output: 1, calls: 1, cacheWrite: 2 });
    expect(b['k']).toEqual({ input: 2, output: 2, calls: 2, cacheRead: 4, cacheWrite: 2 });
  });

  it('mergeUsageEntry keeps the last non-undefined kind', () => {
    const b: UsageBreakdown = {};
    mergeUsageEntry(b, 'k', { input: 1, output: 1, calls: 1 });
    mergeUsageEntry(b, 'k', { input: 1, output: 1, calls: 1, kind: 'advisor' });
    expect(b['k'].kind).toBe('advisor');
  });

  it('mergeUsageBreakdown is a no-op on undefined source', () => {
    const t: UsageBreakdown = { 'a/m': { input: 1, output: 1, calls: 1 } };
    mergeUsageBreakdown(t, undefined);
    expect(t).toEqual({ 'a/m': { input: 1, output: 1, calls: 1 } });
  });

  it('mergeUsageBreakdown does not mutate the source entries', () => {
    const src: UsageBreakdown = { k: { input: 1, output: 1, calls: 1 } };
    const tgt: UsageBreakdown = {};
    mergeUsageBreakdown(tgt, src);
    mergeUsageEntry(tgt, 'k', { input: 9, output: 9, calls: 1 });
    expect(src.k).toEqual({ input: 1, output: 1, calls: 1 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun --filter @archon/providers test usage-breakdown`
Expected: FAIL — `Cannot find module './usage-breakdown'`.

- [ ] **Step 3: Add types to `types.ts`**

In `packages/providers/src/types.ts`, immediately after the `TokenUsage` interface (ends line ~235) add:

```ts
/** Usage attributed to one concrete model within a single provider query. */
export interface ModelUsageEntry {
  input: number;
  output: number;
  cacheRead?: number;
  cacheWrite?: number;
  /** Provider-REPORTED cost only. Never an estimate. */
  costUsd?: number;
  /** Assistant turns/messages attributed to this model. */
  calls: number;
  /** Set only when the source is authoritative (e.g. OMP advisor transcript). */
  kind?: 'advisor';
}

/** Usage keyed "<provider>/<model>" (or "<model>" when provider id is unknown). */
export type UsageBreakdown = Record<string, ModelUsageEntry>;
```

In the `result` variant of `MessageChunk`, replace the line
`      modelUsage?: Record<string, unknown>;`
with
`      usageBreakdown?: UsageBreakdown;`

- [ ] **Step 4: Create the helper module**

```ts
// packages/providers/src/shared/usage-breakdown.ts
import type { ModelUsageEntry, UsageBreakdown } from '../types';

/** Build the breakdown key. Provider id is prefixed when known so the same
 *  model served by two providers stays distinct in reports. */
export function usageKey(provider: string | undefined, model: string): string {
  return provider && provider.length > 0 ? `${provider}/${model}` : model;
}

/** Merge one entry into a breakdown map in place. Numeric fields sum; optional
 *  cache/cost fields accumulate only when the incoming entry supplies them; a
 *  non-undefined `kind` wins. */
export function mergeUsageEntry(
  breakdown: UsageBreakdown,
  key: string,
  entry: ModelUsageEntry
): void {
  const existing = breakdown[key];
  if (!existing) {
    breakdown[key] = { ...entry };
    return;
  }
  existing.input += entry.input;
  existing.output += entry.output;
  existing.calls += entry.calls;
  if (entry.cacheRead !== undefined)
    existing.cacheRead = (existing.cacheRead ?? 0) + entry.cacheRead;
  if (entry.cacheWrite !== undefined)
    existing.cacheWrite = (existing.cacheWrite ?? 0) + entry.cacheWrite;
  if (entry.costUsd !== undefined) existing.costUsd = (existing.costUsd ?? 0) + entry.costUsd;
  if (entry.kind !== undefined) existing.kind = entry.kind;
}

/** Merge every entry of `source` into `target` in place. No-op when source is
 *  absent. Copies entries so the source map is never aliased or mutated. */
export function mergeUsageBreakdown(
  target: UsageBreakdown,
  source: UsageBreakdown | undefined
): void {
  if (!source) return;
  for (const [key, entry] of Object.entries(source)) mergeUsageEntry(target, key, entry);
}
```

- [ ] **Step 5: Update `observability.ts`**

`packages/providers/src/observability.ts:142-143` currently reads `chunk.modelUsage`. Replace the block that does `if (chunk?.type === 'result' && chunk.modelUsage) { return Object.keys(chunk.modelUsage)[0]; }` with:

```ts
  if (chunk?.type === 'result' && chunk.usageBreakdown) {
    return Object.keys(chunk.usageBreakdown)[0];
  }
```

- [ ] **Step 6: Run tests to verify pass + typecheck**

Run: `bun --filter @archon/providers test usage-breakdown && bun --filter @archon/providers run type-check`
Expected: PASS; type-check clean (any other reader of the old `modelUsage` field now fails type-check — fix each by reading `usageBreakdown`).

- [ ] **Step 7: Commit**

```bash
git add packages/providers/src/types.ts packages/providers/src/shared/usage-breakdown.ts packages/providers/src/shared/usage-breakdown.test.ts packages/providers/src/observability.ts
git commit -m "feat(providers): typed usage breakdown map on result chunk"
```

---

### Task 2: OMP parser — per-model breakdown

**Files:**
- Modify: `packages/providers/src/community/omp/event-parser.ts` (fields ~45-60; `consumeMessageEnd` 227-267; `buildObservedResult` 128-144; `accumulateUsage` 331-339)
- Test: `packages/providers/src/community/omp/event-parser.test.ts` (existing)

**Interfaces:**
- Consumes: `UsageBreakdown`, `usageKey`, `mergeUsageEntry` (Task 1).
- Produces: OMP `result` chunk now carries `usageBreakdown` with one entry per `${provider}/${model}` seen across `message_end` events; the existing collapsed `tokens`/`cost` totals are unchanged.

- [ ] **Step 1: Write the failing test**

```ts
// add to packages/providers/src/community/omp/event-parser.test.ts
import { usageKey } from '../../shared/usage-breakdown';

it('emits one breakdown entry per model while keeping the collapsed total', () => {
  const p = new OmpEventParser(false);
  p.consumeLine(JSON.stringify({ type: 'session', id: 's1' }));
  const msgEnd = (provider: string, model: string, input: number, output: number, cost: number) =>
    JSON.stringify({
      type: 'message_end',
      message: {
        role: 'assistant',
        provider,
        model,
        stopReason: 'end_turn',
        content: [{ type: 'text', text: 'hi' }],
        usage: { input, output, totalTokens: input + output, cost: { total: cost } },
      },
    });
  p.consumeLine(JSON.stringify({ type: 'message_start', message: { role: 'assistant' } }));
  p.consumeLine(msgEnd('anthropic', 'claude-opus-4', 100, 50, 0.03));
  p.consumeLine(JSON.stringify({ type: 'message_start', message: { role: 'assistant' } }));
  p.consumeLine(msgEnd('openai', 'gpt-5', 200, 20, 0.01));
  p.consumeLine(JSON.stringify({ type: 'agent_end' }));
  const result = p.buildResult(undefined);

  expect(result.type).toBe('result');
  if (result.type !== 'result') throw new Error('expected result');
  expect(result.usageBreakdown).toEqual({
    [usageKey('anthropic', 'claude-opus-4')]: { input: 100, output: 50, calls: 1, costUsd: 0.03 },
    [usageKey('openai', 'gpt-5')]: { input: 200, output: 20, calls: 1, costUsd: 0.01 },
  });
  // Collapsed total is preserved (backward compat).
  expect(result.tokens).toEqual({ input: 300, output: 70, total: 370, cost: 0.04 });
  expect(result.cost).toBeCloseTo(0.04, 6);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun --filter @archon/providers test omp/event-parser`
Expected: FAIL — `result.usageBreakdown` is `undefined`.

- [ ] **Step 3: Add the breakdown field + accumulate per model**

In `event-parser.ts`, add imports at top:
```ts
import type { UsageBreakdown } from '../../types';
import { usageKey, mergeUsageEntry } from '../../shared/usage-breakdown';
```
Add a field beside `private tokens` (line ~55):
```ts
  private breakdown: UsageBreakdown = {};
```
In `consumeMessageEnd`, after the existing `this.accumulateUsage(usage);` (line ~260) and after `this.resolvedModel` is computed (line ~263), add:
```ts
    const cacheObj = asObject(usage.cost); // OMP nests cost only; cache lives under usage.*
    const cacheRead = numberField(usage.cacheRead);
    const cacheWrite = numberField(usage.cacheWrite);
    mergeUsageEntry(this.breakdown, usageKey(provider, model), {
      input: numberField(usage.input),
      output: numberField(usage.output),
      calls: 1,
      ...(numberField(cacheObj?.total) > 0 ? { costUsd: numberField(cacheObj?.total) } : {}),
      ...(cacheRead > 0 ? { cacheRead } : {}),
      ...(cacheWrite > 0 ? { cacheWrite } : {}),
    });
```
> Cache fields: `usage.cacheRead`/`usage.cacheWrite` are read defensively — `numberField` returns 0 when absent, and the spread omits zero values, so an OMP build that does not emit them simply yields no cache fields (no guess).

In `buildObservedResult` (line ~133-143), add to the returned object, inside the `numTurns > 0` guard block so it only appears when a turn ran:
```ts
      ...(this.numTurns > 0 && Object.keys(this.breakdown).length > 0
        ? { usageBreakdown: this.breakdown }
        : {}),
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun --filter @archon/providers test omp/event-parser`
Expected: PASS (new test + all existing OMP parser tests).

- [ ] **Step 5: Commit**

```bash
git add packages/providers/src/community/omp/event-parser.ts packages/providers/src/community/omp/event-parser.test.ts
git commit -m "feat(providers): omp per-model usage breakdown"
```

---

### Task 3: Claude provider — modelUsage → breakdown

**Files:**
- Modify: `packages/providers/src/claude/provider.ts` (`selectResolvedModelId` 123-148; result emission ~1108-1195, where `cost` is set from `resultMsg.total_cost_usd` at 1195)
- Test: `packages/providers/src/claude/provider.test.ts` (existing) — add a focused unit for the mapping helper

**Interfaces:**
- Consumes: `UsageBreakdown`, `usageKey`, `mergeUsageEntry`; the Claude SDK `ModelUsage` shape already imported in this file (used by `selectResolvedModelId`, line 130).
- Produces: a `buildClaudeBreakdown(modelUsage: Record<string, ModelUsage> | undefined): UsageBreakdown | undefined` exported helper, and the result chunk carries `usageBreakdown`.

- [ ] **Step 1: Write the failing test**

```ts
// add to packages/providers/src/claude/provider.test.ts
import { buildClaudeBreakdown } from './provider';

it('buildClaudeBreakdown maps every model entry incl. a fallback model', () => {
  const modelUsage = {
    'claude-opus-4': { inputTokens: 100, outputTokens: 40, cacheReadInputTokens: 10, cacheCreationInputTokens: 5, costUSD: 0.03 },
    'claude-sonnet-4': { inputTokens: 200, outputTokens: 20, cacheReadInputTokens: 0, cacheCreationInputTokens: 0, costUSD: 0.01 },
  } as unknown as Parameters<typeof buildClaudeBreakdown>[0];
  expect(buildClaudeBreakdown(modelUsage)).toEqual({
    'anthropic/claude-opus-4': { input: 100, output: 40, calls: 1, cacheRead: 10, cacheWrite: 5, costUsd: 0.03 },
    'anthropic/claude-sonnet-4': { input: 200, output: 20, calls: 1, costUsd: 0.01 },
  });
});

it('buildClaudeBreakdown returns undefined for empty/absent input', () => {
  expect(buildClaudeBreakdown(undefined)).toBeUndefined();
  expect(buildClaudeBreakdown({} as never)).toBeUndefined();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun --filter @archon/providers test claude/provider`
Expected: FAIL — `buildClaudeBreakdown` not exported.

- [ ] **Step 3: Implement and export the helper**

In `claude/provider.ts`, near `selectResolvedModelId` (line ~123), add imports if missing:
```ts
import type { UsageBreakdown } from '../types';
import { usageKey, mergeUsageEntry } from '../shared/usage-breakdown';
```
Add:
```ts
/** Map the Claude SDK per-model usage record to a provider-neutral breakdown.
 *  Every model the turn used appears — including a fallbackModel or subagent
 *  model — each keyed under the "anthropic/" provider prefix. Cache-creation
 *  tokens map to cacheWrite, cache-read to cacheRead. Returns undefined when the
 *  SDK reported no per-model usage. */
export function buildClaudeBreakdown(
  modelUsage: Record<string, ModelUsage> | undefined
): UsageBreakdown | undefined {
  if (!modelUsage) return undefined;
  const entries = Object.entries(modelUsage);
  if (entries.length === 0) return undefined;
  const breakdown: UsageBreakdown = {};
  for (const [model, u] of entries) {
    const cacheRead = u.cacheReadInputTokens ?? 0;
    const cacheWrite = u.cacheCreationInputTokens ?? 0;
    mergeUsageEntry(breakdown, usageKey('anthropic', model), {
      input: u.inputTokens ?? 0,
      output: u.outputTokens ?? 0,
      calls: 1,
      ...(cacheRead > 0 ? { cacheRead } : {}),
      ...(cacheWrite > 0 ? { cacheWrite } : {}),
      ...(typeof u.costUSD === 'number' ? { costUsd: u.costUSD } : {}),
    });
  }
  return breakdown;
}
```
> `ModelUsage` is the SDK type already referenced at line 130. If the exact field names differ (`cacheReadInputTokens` etc.), read the type from `@anthropic-ai/claude-agent-sdk` and match them — do not guess; the test encodes the expected mapping and must be updated to the real field names if they differ.

At the result-chunk emission (~line 1190-1195, where `cost: resultMsg.total_cost_usd` is spread), add next to it:
```ts
        ...(buildClaudeBreakdown(resultMsg.modelUsage as Record<string, ModelUsage> | undefined)
          ? { usageBreakdown: buildClaudeBreakdown(resultMsg.modelUsage as Record<string, ModelUsage> | undefined) }
          : {}),
```
(Keep the existing `selectResolvedModelId(...)` call and its WARN unchanged.)

- [ ] **Step 4: Run tests to verify pass**

Run: `bun --filter @archon/providers test claude/provider`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/providers/src/claude/provider.ts packages/providers/src/claude/provider.test.ts
git commit -m "feat(providers): claude per-model usage breakdown incl. fallback model"
```

---

### Task 4: Pi provider — verify semantics, then breakdown

**Files:**
- Modify: `packages/providers/src/community/pi/event-bridge.ts` (`usageToTokens` 103-111; `buildResultChunk` 152-195; `mapPiEvent` context)
- Test: `packages/providers/src/community/pi/event-bridge.test.ts` (existing)

**Interfaces:**
- Consumes: `UsageBreakdown`, `usageKey`, `mergeUsageEntry`.
- Produces: Pi `result` chunk carries `usageBreakdown` (one entry per `responseModel`), and — if verification shows per-message usage — `tokens`/`cost` become summed across assistant messages instead of last-message-only.

- [ ] **Step 1: VERIFY Pi usage semantics (no code yet)**

Read the pinned SDK source. `node_modules` is hook-blocked, so read from the indexed local clone or GitHub:

Run: `rg -n "usage|totalTokens|cacheRead|responseModel" /Users/dale/Desktop/workspace/OceanLabs/agentic-os-plan/oh-my-pi/packages/coding-agent/src --glob '*assistant*' | head -40`

Determine: is `AssistantMessage.usage` **per-message** (each assistant message carries only its own turn) or **session-cumulative** (each carries the running total)? Record the answer in the commit body. This decides Steps 3a vs 3b.

- [ ] **Step 2: Write the failing test (covers both semantics via distinct models)**

```ts
// add to packages/providers/src/community/pi/event-bridge.test.ts
it('emits a breakdown entry per responseModel', () => {
  // Build a transcript with two assistant messages on different models.
  // Uses the same fixture factory the existing tests use; see file top.
  const messages = [
    makeAssistant({ responseModel: 'anthropic/claude-opus-4', usage: { input: 100, output: 40, totalTokens: 140, cacheRead: 10, cacheWrite: 0, cost: { total: 0.03 } } }),
    makeAssistant({ responseModel: 'anthropic/claude-haiku-4-5', usage: { input: 50, output: 10, totalTokens: 60, cacheRead: 0, cacheWrite: 0, cost: { total: 0.001 } } }),
  ];
  const result = buildResultChunk(messages, undefined);
  expect(result.usageBreakdown).toEqual({
    'anthropic/claude-opus-4': { input: 100, output: 40, calls: 1, cacheRead: 10, costUsd: 0.03 },
    'anthropic/claude-haiku-4-5': { input: 50, output: 10, calls: 1, costUsd: 0.001 },
  });
});
```
> `makeAssistant` / `buildResultChunk` invocation must match the existing test file's helpers and the real `buildResultChunk` signature (line 152). Adjust the call to the actual signature seen in the file; keep the assertion.

- [ ] **Step 3a: If per-message — sum across messages + per-model breakdown**

Replace the last-message-only read in `buildResultChunk` with a fold over all assistant messages. Add helper near `usageToTokens`:
```ts
import type { UsageBreakdown } from '../../types';
import { usageKey, mergeUsageEntry } from '../../shared/usage-breakdown';

/** Sum usage across every assistant message and split per responseModel.
 *  Pi reports usage per message, so the last message alone under-counts a
 *  multi-turn query. */
function buildPiBreakdown(messages: readonly unknown[]): {
  totals: TokenUsage;
  breakdown: UsageBreakdown;
} {
  const breakdown: UsageBreakdown = {};
  let input = 0, output = 0, total = 0, cost = 0;
  for (const m of messages) {
    if (!isAssistantMessage(m)) continue;
    const u = m.usage;
    input += u.input; output += u.output; total += u.totalTokens; cost += u.cost.total;
    const model = (m as { responseModel?: string }).responseModel;
    if (model) {
      mergeUsageEntry(breakdown, usageKey(undefined, model), {
        input: u.input, output: u.output, calls: 1,
        ...(u.cacheRead ? { cacheRead: u.cacheRead } : {}),
        ...(u.cacheWrite ? { cacheWrite: u.cacheWrite } : {}),
        ...(u.cost.total ? { costUsd: u.cost.total } : {}),
      });
    }
  }
  return { totals: { input, output, total, cost }, breakdown };
}
```
Wire it: in `buildResultChunk`, compute `const { totals, breakdown } = buildPiBreakdown(messages);` and emit `tokens: totals`, `cost: totals.cost`, and `usageBreakdown: breakdown` (when non-empty) instead of the single-message `usageToTokens(last.usage)`.
> `responseModel` already prefixes `<provider>/<model>` in Pi refs, so pass `undefined` as the provider to `usageKey` — do not double-prefix.

- [ ] **Step 3b: If session-cumulative — keep last-message totals, single breakdown entry**

Keep the existing `usageToTokens(last.usage)` totals. Add one entry from the last message's `responseModel`:
```ts
const last = /* existing last assistant message */;
const breakdown: UsageBreakdown = {};
const model = (last as { responseModel?: string }).responseModel;
if (model) mergeUsageEntry(breakdown, usageKey(undefined, model), {
  input: last.usage.input, output: last.usage.output, calls: 1,
  ...(last.usage.cacheRead ? { cacheRead: last.usage.cacheRead } : {}),
  ...(last.usage.cacheWrite ? { cacheWrite: last.usage.cacheWrite } : {}),
  ...(last.usage.cost.total ? { costUsd: last.usage.cost.total } : {}),
});
```
Emit `usageBreakdown: breakdown` when non-empty. Adjust the Step-2 test to a single cumulative message.

- [ ] **Step 4: Run tests to verify pass**

Run: `bun --filter @archon/providers test pi/event-bridge`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/providers/src/community/pi/event-bridge.ts packages/providers/src/community/pi/event-bridge.test.ts
git commit -m "feat(providers): pi per-model usage breakdown (usage semantics: <per-message|cumulative>)"
```

---

### Task 5: Grok, Codex, OpenCode, Copilot — single/simple breakdown

**Files:**
- Modify: `packages/providers/src/grok/event-parser.ts` (~127-191); `packages/providers/src/codex/provider.ts` (~325-331, ~769-796); `packages/providers/src/community/opencode/tokens.ts` (~7-22); `packages/providers/src/community/copilot/event-bridge.ts` (~111-124)
- Test: each provider's existing colocated test file

**Interfaces:**
- Consumes: `UsageBreakdown`, `usageKey`, `mergeUsageEntry`.
- Produces: each provider's `result` chunk carries a `usageBreakdown` — Grok/OpenCode include `costUsd`; Codex/Copilot omit `costUsd` (tokens only). Qoder is untouched (emits none).

- [ ] **Step 1: Write failing tests (one per provider)**

```ts
// grok/event-parser.test.ts
it('emits a breakdown entry with cost', () => {
  const r = parseGrokToResult({ /* usage input=100 output=40, total_cost_usd=0.02, model 'grok-4' */ });
  expect(r.usageBreakdown).toEqual({ 'xai/grok-4': { input: 100, output: 40, calls: 1, costUsd: 0.02 } });
});
// codex/provider.test.ts
it('emits a tokens-only breakdown (no costUsd)', () => {
  const r = /* drive one turn_completed with usage input=100 output=40, model 'gpt-5-codex' */;
  expect(r.usageBreakdown).toEqual({ 'openai/gpt-5-codex': { input: 100, output: 40, calls: 1 } });
  expect(r.usageBreakdown['openai/gpt-5-codex'].costUsd).toBeUndefined();
});
// community/opencode/tokens.test.ts
it('normalizeTokens carries cost into a breakdown entry', () => {
  const { breakdown } = normalizeTokensWithBreakdown({ input: 100, output: 40, cost: 0.02 }, 'anthropic', 'claude-opus-4');
  expect(breakdown).toEqual({ 'anthropic/claude-opus-4': { input: 100, output: 40, calls: 1, costUsd: 0.02 } });
});
// community/copilot/event-bridge.test.ts
it('emits a tokens-only breakdown', () => {
  const r = /* drive with inputTokens=100 outputTokens=40, model 'gpt-4.1' */;
  expect(r.usageBreakdown).toEqual({ 'github-copilot/gpt-4.1': { input: 100, output: 40, calls: 1 } });
});
```
> Fill each `/* ... */` with the file's existing test-driver pattern (each test file already has a parse/drive helper). The assertions are the contract.

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun --filter @archon/providers test grok/event-parser codex/provider opencode/tokens copilot/event-bridge`
Expected: FAIL — `usageBreakdown` undefined in each.

- [ ] **Step 3: Implement each**

For each provider, at the point where the result chunk / tokens are assembled, build one entry with `usageKey(<providerId>, <model>)` where `<providerId>` is the fixed vendor id (`xai`, `openai`, `github-copilot`) and `<model>` is the resolved model already known at that site. Include `costUsd` ONLY where a USD value exists (Grok `total_cost_usd`; OpenCode `info.cost`). Codex/Copilot: no `costUsd`. Emit `usageBreakdown` only when the entry has non-zero tokens. Use `mergeUsageEntry` into a fresh `{}`.
> OpenCode: if the session exposes per-agent model ids (`opencode/session.ts`/`multi-agent.ts`), emit one entry per distinct model; otherwise a single entry. Read the file to decide; default to single entry when the model is ambiguous (no guess).

- [ ] **Step 4: Run tests to verify pass**

Run: `bun --filter @archon/providers test grok/event-parser codex/provider opencode/tokens copilot/event-bridge`
Expected: PASS.

- [ ] **Step 5: Full providers suite + typecheck, then commit**

Run: `bun --filter @archon/providers test && bun --filter @archon/providers run type-check`
Expected: PASS, clean.

```bash
git add packages/providers/src/grok packages/providers/src/codex packages/providers/src/community/opencode packages/providers/src/community/copilot
git commit -m "feat(providers): usage breakdown for grok, codex, opencode, copilot"
```

---

# PHASE 2 — Engine accumulation + JSON persistence

### Task 6: Usage-breakdown Zod schema + run-metadata field

**Files:**
- Create: `packages/workflows/src/schemas/usage-breakdown.ts`
- Modify: `packages/workflows/src/schemas/index.ts`; `packages/workflows/src/schemas/workflow-run.ts` (`workflowRunMetadataSchema` ~142-160)
- Test: `packages/workflows/src/schemas/usage-breakdown.test.ts`

**Interfaces:**
- Produces: `modelUsageEntrySchema`, `usageBreakdownSchema`, `UsageByModel` type (`z.infer`), and `workflowRunMetadataSchema.usage_by_model?: UsageByModel`. `z.infer<typeof modelUsageEntrySchema>` must be structurally assignable to the provider `ModelUsageEntry`.

- [ ] **Step 1: Write the failing test**

```ts
// packages/workflows/src/schemas/usage-breakdown.test.ts
import { describe, it, expect } from 'bun:test';
import { usageBreakdownSchema, modelUsageEntrySchema } from './usage-breakdown';

describe('usageBreakdownSchema', () => {
  it('parses a valid map', () => {
    const v = { 'anthropic/claude-opus-4': { input: 100, output: 40, calls: 1, costUsd: 0.03, cacheRead: 10 } };
    expect(usageBreakdownSchema.parse(v)).toEqual(v);
  });
  it('rejects a missing required field', () => {
    expect(() => modelUsageEntrySchema.parse({ input: 1, output: 1 })).toThrow(); // calls missing
  });
  it('accepts kind advisor', () => {
    expect(modelUsageEntrySchema.parse({ input: 1, output: 1, calls: 1, kind: 'advisor' }).kind).toBe('advisor');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun --filter @archon/workflows test usage-breakdown`
Expected: FAIL — module not found.

- [ ] **Step 3: Create the schema**

```ts
// packages/workflows/src/schemas/usage-breakdown.ts
import { z } from '@hono/zod-openapi';

/** Usage attributed to one concrete model. Mirrors the provider `ModelUsageEntry`
 *  TS interface (packages/providers/src/types.ts); the two MUST stay structurally
 *  equal so persisted engine data round-trips provider output. */
export const modelUsageEntrySchema = z.object({
  input: z.number(),
  output: z.number(),
  cacheRead: z.number().optional(),
  cacheWrite: z.number().optional(),
  costUsd: z.number().optional(),
  calls: z.number(),
  kind: z.literal('advisor').optional(),
});

/** Keyed "<provider>/<model>" (or "<model>"). */
export const usageBreakdownSchema = z.record(z.string(), modelUsageEntrySchema);

export type ModelUsageEntry = z.infer<typeof modelUsageEntrySchema>;
export type UsageByModel = z.infer<typeof usageBreakdownSchema>;
```

- [ ] **Step 4: Export it + add the run-metadata field**

In `schemas/index.ts`, after the node-artifact export block add:
```ts
// Usage breakdown (per-model cost/tokens)
export { modelUsageEntrySchema, usageBreakdownSchema } from './usage-breakdown';
export type { ModelUsageEntry, UsageByModel } from './usage-breakdown';
```
In `schemas/workflow-run.ts`, import at top: `import { usageBreakdownSchema } from './usage-breakdown';` and add to the `workflowRunMetadataSchema` object (line ~142) a field:
```ts
    usage_by_model: usageBreakdownSchema.optional(),
```

- [ ] **Step 5: Run test + typecheck**

Run: `bun --filter @archon/workflows test usage-breakdown && bun --filter @archon/workflows run type-check`
Expected: PASS, clean.

- [ ] **Step 6: Commit**

```bash
git add packages/workflows/src/schemas/usage-breakdown.ts packages/workflows/src/schemas/usage-breakdown.test.ts packages/workflows/src/schemas/index.ts packages/workflows/src/schemas/workflow-run.ts
git commit -m "feat(workflows): usage-breakdown schema + run metadata usage_by_model"
```

---

### Task 7: Node-level accumulation + `node_completed` payload

**Files:**
- Modify: `packages/workflows/src/dag-executor.ts` — the single-node execution function (declarations near `let nodeCostUsd` ~1974; per-attempt reset in `runStreamPass` ~2030-2035; result-chunk handler where `if (msg.cost !== undefined) nodeCostUsd = msg.cost;` ~2289; across-attempt sum ~2657-2663; `node_completed` payload ~2909-2941; node outcome return ~2955-2965)
- Test: `packages/workflows/src/dag-executor.test.ts` (existing) — a focused node-completion test with a stub provider

**Interfaces:**
- Consumes: `UsageBreakdown` from `@archon/providers/types`; `mergeUsageBreakdown` from `@archon/providers/shared/usage-breakdown` (pure, import allowed — verify the subpath resolves; if the package only exposes `/types`, re-export the two helpers from `@archon/providers/types` so the workflows package can import them under its allowed dep).
- Produces: node outcome object gains `usageBreakdown?: UsageBreakdown`; `node_completed` event `data.usage_breakdown` present when non-empty.

- [ ] **Step 1: Confirm the helper import path resolves under the workflows dep rule**

Run: `rg -n "\"./types\"|exports|\"./shared" packages/providers/package.json`
Expected: shows the `/types` export. If `/shared/usage-breakdown` is NOT an exported subpath, add `export { usageKey, mergeUsageEntry, mergeUsageBreakdown } from './shared/usage-breakdown';` to `packages/providers/src/types.ts` (pure re-export, keeps the zero-SDK-dep contract) so `@archon/workflows` imports them from `@archon/providers/types`. Commit that one-line change with this task.

- [ ] **Step 2: Write the failing test**

```ts
// add to packages/workflows/src/dag-executor.test.ts (near other single-node tests)
it('persists usage_breakdown on node_completed from provider result', async () => {
  // Stub provider whose sendQuery yields one result chunk with usageBreakdown.
  const events: Array<{ type: string; data: Record<string, unknown> }> = [];
  const store = makeTestStore({ onEvent: e => events.push(e) }); // existing test helper
  const provider = makeStubProvider(async function* () {
    yield { type: 'assistant', content: 'done' };
    yield {
      type: 'result',
      cost: 0.04,
      tokens: { input: 300, output: 70 },
      usageBreakdown: {
        'anthropic/claude-opus-4': { input: 100, output: 50, calls: 1, costUsd: 0.03 },
        'openai/gpt-5': { input: 200, output: 20, calls: 1, costUsd: 0.01 },
      },
    };
  });
  await runSinglePromptNode({ store, provider, prompt: 'hi' }); // existing harness
  const completed = events.find(e => e.type === 'node_completed');
  expect(completed?.data.usage_breakdown).toEqual({
    'anthropic/claude-opus-4': { input: 100, output: 50, calls: 1, costUsd: 0.03 },
    'openai/gpt-5': { input: 200, output: 20, calls: 1, costUsd: 0.01 },
  });
});

it('does not leak a prior reask attempt breakdown', async () => {
  // Provider first yields a validation-miss (best-effort), then a good result.
  // Assert the persisted breakdown equals the SUM across attempts, matching cost_usd.
  // (mirror the existing reask cost test in this file)
});
```
> `makeTestStore`, `makeStubProvider`, `runSinglePromptNode` are the existing harness names in this test file — match whatever the file actually uses (read the top of `dag-executor.test.ts`). The assertions are the contract.

- [ ] **Step 3: Run test to verify it fails**

Run: `bun --filter @archon/workflows test dag-executor -t "usage_breakdown"`
Expected: FAIL — `usage_breakdown` absent from the event.

- [ ] **Step 4: Accumulate in the executor (mirror nodeCostUsd exactly)**

Add import at top of `dag-executor.ts`:
```ts
import type { UsageBreakdown } from '@archon/providers/types';
import { mergeUsageBreakdown } from '@archon/providers/types';
```
Beside `let nodeCostUsd: number | undefined;` (~1974) add:
```ts
  let nodeUsageBreakdown: UsageBreakdown = {};
  let accumulatedUsageBreakdown: UsageBreakdown = {};
```
In `runStreamPass`, where `nodeCostUsd = undefined;` resets per attempt (~2033), add: `nodeUsageBreakdown = {};` (fresh per attempt — matches cost's replace-within-attempt).
In the result-chunk handler, right after `if (msg.cost !== undefined) nodeCostUsd = msg.cost;` (~2289) add:
```ts
        if (msg.usageBreakdown) {
          nodeUsageBreakdown = {};
          mergeUsageBreakdown(nodeUsageBreakdown, msg.usageBreakdown);
        }
```
Where attempts are summed (~2657-2663, beside `accumulatedCostUsd = (accumulatedCostUsd ?? 0) + nodeCostUsd; nodeCostUsd = accumulatedCostUsd;`) add:
```ts
      mergeUsageBreakdown(accumulatedUsageBreakdown, nodeUsageBreakdown);
      nodeUsageBreakdown = accumulatedUsageBreakdown;
```

- [ ] **Step 5: Persist to the event + return in the outcome**

In the `node_completed` `data` object (~2909-2941), add beside `...(nodeCostUsd !== undefined ? { cost_usd: nodeCostUsd } : {})`:
```ts
          ...(Object.keys(nodeUsageBreakdown).length > 0
            ? { usage_breakdown: nodeUsageBreakdown }
            : {}),
```
In the completed outcome return (~2955-2965) add beside `costUsd: nodeCostUsd,`:
```ts
      ...(Object.keys(nodeUsageBreakdown).length > 0 ? { usageBreakdown: nodeUsageBreakdown } : {}),
```
Add `usageBreakdown?: UsageBreakdown;` to the node-outcome result type (the same interface that declares `costUsd?: number;` — search `costUsd?: number;` in this file, ~502, and add the field there).

- [ ] **Step 6: Run test to verify it passes**

Run: `bun --filter @archon/workflows test dag-executor -t "usage_breakdown|reask"`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/workflows/src/dag-executor.ts packages/workflows/src/dag-executor.test.ts packages/providers/src/types.ts
git commit -m "feat(workflows): accumulate and persist per-node usage breakdown"
```

---

### Task 8: Run-level fold + sub-run merge → run metadata

**Files:**
- Modify: `packages/workflows/src/dag-executor.ts` — run context init (`totalCostUsd: 0` ~4181 for loop ctx; the top-level run ctx where `ctx.totalCostUsd` lives; the node-outcome fold at ~8787-8794; sub-run rollup at ~6530-6558; run-end `completeWorkflowRun` ~10182-10190)
- Test: `packages/workflows/src/dag-executor.test.ts`

**Interfaces:**
- Consumes: node outcome `usageBreakdown` (Task 7); `mergeUsageBreakdown`.
- Produces: `completeWorkflowRun` metadata carries `usage_by_model` (merged across all nodes). Sub-run child metadata `usage_by_model` merges into the parent `workflow:` node's breakdown.

- [ ] **Step 1: Write the failing test**

```ts
// add to packages/workflows/src/dag-executor.test.ts
it('run metadata usage_by_model is the sum of node breakdowns', async () => {
  const metas: Array<Record<string, unknown>> = [];
  const store = makeTestStore({ onComplete: (_id, meta) => metas.push(meta) });
  const provider = makeStubProvider(/* two nodes, each yields a result with a breakdown */);
  await runTwoNodeWorkflow({ store, provider }); // existing/analogous harness
  expect(metas.at(-1)?.usage_by_model).toEqual({
    'anthropic/claude-opus-4': { input: 200, output: 100, calls: 2, costUsd: 0.06 },
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun --filter @archon/workflows test dag-executor -t "usage_by_model"`
Expected: FAIL — metadata lacks `usage_by_model`.

- [ ] **Step 3: Add the run-level accumulator**

Where the run ctx is created with `totalCostUsd`, `totalTokensIn`, `totalTokensOut` fields, add `usageByModel: {} as UsageBreakdown`. At the node-outcome fold (~8787, beside `ctx.totalCostUsd += output.costUsd;`) add:
```ts
        mergeUsageBreakdown(ctx.usageByModel, output.usageBreakdown);
```

- [ ] **Step 4: Merge sub-run child metadata**

At the sub-run rollup (~6530-6558, where `outcome.costUsd` rolls into the parent node) read the child run's persisted `usage_by_model` from its metadata and attach it to the parent node outcome's `usageBreakdown` so Step 3's fold picks it up:
```ts
      // Child run persists usage_by_model in its metadata; thread it up so the
      // parent run's aggregate and the parent node's breakdown both include it.
      ...(childUsageByModel ? { usageBreakdown: childUsageByModel } : {}),
```
where `childUsageByModel` is read from the child `WorkflowRun.metadata.usage_by_model` at the same place `outcome.costUsd` is derived from the child summary.

- [ ] **Step 5: Write it at run end**

In the `completeWorkflowRun` call (~10182-10190), beside `...(totalCostUsd > 0 ? { total_cost_usd: totalCostUsd } : {})` add:
```ts
      ...(Object.keys(ctx.usageByModel).length > 0 ? { usage_by_model: ctx.usageByModel } : {}),
```

- [ ] **Step 6: Run test to verify it passes**

Run: `bun --filter @archon/workflows test dag-executor -t "usage_by_model|sub-run"`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/workflows/src/dag-executor.ts packages/workflows/src/dag-executor.test.ts
git commit -m "feat(workflows): roll node usage breakdown into run metadata + sub-runs"
```

---

### Task 9: Loop / loop_group iteration merge

**Files:**
- Modify: `packages/workflows/src/dag-executor.ts` — loop ctx (`totalCostUsd: 0` ~4181; `loopTotalCostUsd` accumulation ~4211; loop `node_completed`/outcome ~4238, ~4432-4526; single-node loop mirror ~5066, ~5526-6083)
- Test: `packages/workflows/src/dag-executor.test.ts`

**Interfaces:**
- Consumes: per-iteration node outcome `usageBreakdown`.
- Produces: a loop node's `node_completed` + outcome carry a `usage_breakdown` merged across iterations, charged once (no double-count) — mirrors `loopTotalCostUsd`.

- [ ] **Step 1: Write the failing test**

```ts
// add to packages/workflows/src/dag-executor.test.ts
it('loop node merges per-iteration breakdowns and charges once', async () => {
  const events: Array<{ type: string; data: Record<string, unknown> }> = [];
  const store = makeTestStore({ onEvent: e => events.push(e) });
  const provider = makeStubProvider(/* 3 iterations, each result breakdown input=10 output=5 cost=0.01, until signal on 3rd */);
  await runLoopNode({ store, provider, maxIterations: 3 });
  const completed = events.find(e => e.type === 'node_completed');
  expect(completed?.data.usage_breakdown).toEqual({
    'anthropic/claude-opus-4': { input: 30, output: 15, calls: 3, costUsd: 0.03 },
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun --filter @archon/workflows test dag-executor -t "loop node merges"`
Expected: FAIL.

- [ ] **Step 3: Merge per iteration**

Beside the loop ctx `totalCostUsd: 0` init, add `usageByModel: {} as UsageBreakdown`. Where `loopTotalCostUsd = (loopTotalCostUsd ?? 0) + iterCtx.totalCostUsd;` (~4211, and the single-node-loop mirror ~5066) add:
```ts
    mergeUsageBreakdown(loopUsageByModel, iterCtx.usageByModel);
```
declaring `let loopUsageByModel: UsageBreakdown = {};` beside `let loopTotalCostUsd`. At every loop `node_completed` payload + outcome site that spreads `...(loopTotalCostUsd !== undefined ? { cost_usd: loopTotalCostUsd } : {})` (~4417, ~5939) add:
```ts
            ...(Object.keys(loopUsageByModel).length > 0 ? { usage_breakdown: loopUsageByModel } : {}),
```
and at the outcome returns spreading `costUsd: loopTotalCostUsd` add `...(Object.keys(loopUsageByModel).length > 0 ? { usageBreakdown: loopUsageByModel } : {})`.
> Follow the #2333 "charge once" decision already encoded at each site: add the breakdown spread ONLY where `cost_usd` is spread, so it inherits the same no-double-count guard (e.g. the loop_group aggregate-vs-per-node rows).

- [ ] **Step 4: Run test to verify it passes**

Run: `bun --filter @archon/workflows test dag-executor -t "loop"`
Expected: PASS (new + existing loop tests).

- [ ] **Step 5: Full workflows suite, then commit**

Run: `bun --filter @archon/workflows test`
Expected: PASS.

```bash
git add packages/workflows/src/dag-executor.ts packages/workflows/src/dag-executor.test.ts
git commit -m "feat(workflows): merge per-iteration usage breakdown for loop nodes"
```

---

# PHASE 3 — Ledger schema + write path + pricing

### Task 10: `remote_agent_usage_ledger` table (both dialects)

**Files:**
- Modify: `migrations/000_combined.sql` (table body near the other `CREATE TABLE`; indexes + `COMMENT ON COLUMN` in the trailing section ~750-820)
- Modify: `packages/core/src/db/adapters/sqlite.ts` (`createSchema()` ~584+, add table; indexes go inside `createSchema` too for SQLite)
- Modify: `packages/core/src/db/adapters/sqlite.test.ts` (parity test — add table to any allowlist if the parity check needs it)
- Test: `packages/core/src/db/adapters/sqlite.test.ts` (parity) + `bun run check:schema-upgrades`

**Interfaces:**
- Produces: table `remote_agent_usage_ledger` with columns per the spec; queryable by `created_at`, `codebase_id`, `provider`, `workflow_run_id`.

- [ ] **Step 1: Add the Postgres table to the migration**

In `migrations/000_combined.sql`, in the table-definition section, add:
```sql
CREATE TABLE IF NOT EXISTS remote_agent_usage_ledger (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at         TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  source             TEXT NOT NULL DEFAULT 'workflow',
  workflow_run_id    UUID REFERENCES remote_agent_workflow_runs(id) ON DELETE CASCADE,
  node_id            TEXT,
  workflow_name      TEXT,
  codebase_id        UUID REFERENCES remote_agent_codebases(id) ON DELETE SET NULL,
  user_id            UUID REFERENCES remote_agent_users(id) ON DELETE SET NULL,
  provider           TEXT NOT NULL,
  model              TEXT NOT NULL,
  kind               TEXT,
  tokens_input       INTEGER NOT NULL DEFAULT 0,
  tokens_output      INTEGER NOT NULL DEFAULT 0,
  cache_read         INTEGER,
  cache_write        INTEGER,
  calls              INTEGER NOT NULL DEFAULT 0,
  cost_usd           DOUBLE PRECISION,
  cost_estimated_usd DOUBLE PRECISION,
  pricing_source     TEXT
);
```

- [ ] **Step 2: Add indexes to the trailing section**

At the end of the "Indexes and column comments" section (~after line 816):
```sql
CREATE INDEX IF NOT EXISTS idx_usage_ledger_created_at
  ON remote_agent_usage_ledger(created_at);
CREATE INDEX IF NOT EXISTS idx_usage_ledger_codebase_created
  ON remote_agent_usage_ledger(codebase_id, created_at);
CREATE INDEX IF NOT EXISTS idx_usage_ledger_provider_created
  ON remote_agent_usage_ledger(provider, created_at);
CREATE INDEX IF NOT EXISTS idx_usage_ledger_run
  ON remote_agent_usage_ledger(workflow_run_id);
```

- [ ] **Step 3: Mirror into SQLite `createSchema()`**

In `packages/core/src/db/adapters/sqlite.ts` `createSchema()`, add after the workflow_node_checkpoints table:
```sql
      CREATE TABLE IF NOT EXISTS remote_agent_usage_ledger (
        id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
        created_at TEXT DEFAULT (datetime('now')),
        source TEXT NOT NULL DEFAULT 'workflow',
        workflow_run_id TEXT REFERENCES remote_agent_workflow_runs(id) ON DELETE CASCADE,
        node_id TEXT,
        workflow_name TEXT,
        codebase_id TEXT REFERENCES remote_agent_codebases(id) ON DELETE SET NULL,
        user_id TEXT REFERENCES remote_agent_users(id) ON DELETE SET NULL,
        provider TEXT NOT NULL,
        model TEXT NOT NULL,
        kind TEXT,
        tokens_input INTEGER NOT NULL DEFAULT 0,
        tokens_output INTEGER NOT NULL DEFAULT 0,
        cache_read INTEGER,
        cache_write INTEGER,
        calls INTEGER NOT NULL DEFAULT 0,
        cost_usd REAL,
        cost_estimated_usd REAL,
        pricing_source TEXT
      );
```
Immediately after (still in `createSchema`, since these columns exist in the same block):
```sql
      CREATE INDEX IF NOT EXISTS idx_usage_ledger_created_at ON remote_agent_usage_ledger(created_at);
      CREATE INDEX IF NOT EXISTS idx_usage_ledger_codebase_created ON remote_agent_usage_ledger(codebase_id, created_at);
      CREATE INDEX IF NOT EXISTS idx_usage_ledger_provider_created ON remote_agent_usage_ledger(provider, created_at);
      CREATE INDEX IF NOT EXISTS idx_usage_ledger_run ON remote_agent_usage_ledger(workflow_run_id);
```

- [ ] **Step 4: Regenerate embedded schema + run parity/upgrade checks**

Run:
```bash
bun run generate:bundled-schema
bun --filter @archon/core test sqlite
```
Expected: parity test PASS (SQLite and Postgres agree on `remote_agent_usage_ledger` table + columns). If the parity test enumerates an allowlist, no exception is needed — the table exists in both.

- [ ] **Step 5: Run the Postgres upgrade check**

Run: `bun run check:schema-upgrades`
Expected: PASS (needs a reachable Postgres via `PGHOST`/`DATABASE_URL`). Only the pre-existing `remote_agent_codebases_kind_check` divergence is printed; the new table converges fresh-vs-upgrade.

- [ ] **Step 6: Commit**

```bash
git add migrations/000_combined.sql packages/core/src/db/adapters/sqlite.ts packages/workflows/src/defaults/bundled-defaults.generated.ts packages/core/src/db/adapters/sqlite.test.ts
git commit -m "feat(db): add usage ledger table (sqlite + postgres, additive)"
```
> The `generate:bundled-schema` output file path may differ — `git status` after the generate step and stage whatever it wrote.

---

### Task 11: Ledger DB module (insert idempotent per node + queries)

**Files:**
- Create: `packages/core/src/db/usage-ledger.ts`
- Modify: `packages/core/src/index.ts` (export the query fns)
- Test: `packages/core/src/db/usage-ledger.test.ts`

**Interfaces:**
- Produces:
  - `interface UsageLedgerRowInput { source?: string; workflowRunId?: string; nodeId?: string; workflowName?: string; codebaseId?: string; userId?: string; provider: string; model: string; kind?: 'advisor'; tokensInput: number; tokensOutput: number; cacheRead?: number; cacheWrite?: number; calls: number; costUsd?: number; costEstimatedUsd?: number; pricingSource?: 'catalog'|'config' }`
  - `recordUsageLedgerForNode(workflowRunId: string, nodeId: string, rows: UsageLedgerRowInput[]): Promise<void>` — deletes existing rows for `(workflowRunId, nodeId)` then inserts, in one transaction (idempotent across retry-node/resume).
  - `queryUsage(filter: UsageQuery): Promise<UsageQueryResult>` where `UsageQuery = { from?: Date; to?: Date; codebaseId?: string; provider?: string; model?: string; kind?: string; groupBy: 'provider'|'model'|'workflow'|'day' }` and `UsageQueryResult = { groups: Array<{ key: string; tokensInput: number; tokensOutput: number; costUsd: number; costEstimatedUsd: number; rowsMissingUsd: number }>; }`.

- [ ] **Step 1: Write the failing test**

```ts
// packages/core/src/db/usage-ledger.test.ts
import { describe, it, expect, beforeEach } from 'bun:test';
// Use the same in-memory sqlite setup the other db tests use (ARCHON_HOME temp dir + fresh adapter).
import { recordUsageLedgerForNode, queryUsage } from './usage-ledger';
import { setupTestDb, seedRun } from './test-helpers'; // match existing helper names

describe('usage-ledger', () => {
  beforeEach(async () => { await setupTestDb(); });

  it('insert then re-insert for same node replaces rows (idempotent)', async () => {
    const runId = await seedRun();
    await recordUsageLedgerForNode(runId, 'n1', [
      { provider: 'anthropic', model: 'claude-opus-4', tokensInput: 100, tokensOutput: 40, calls: 1, costUsd: 0.03 },
    ]);
    await recordUsageLedgerForNode(runId, 'n1', [
      { provider: 'anthropic', model: 'claude-opus-4', tokensInput: 5, tokensOutput: 2, calls: 1, costUsd: 0.001 },
    ]);
    const res = await queryUsage({ groupBy: 'model' });
    expect(res.groups).toEqual([
      { key: 'claude-opus-4', tokensInput: 5, tokensOutput: 2, costUsd: 0.001, costEstimatedUsd: 0, rowsMissingUsd: 0 },
    ]);
  });

  it('queryUsage groups by provider and counts rows missing usd', async () => {
    const runId = await seedRun();
    await recordUsageLedgerForNode(runId, 'a', [
      { provider: 'anthropic', model: 'claude-opus-4', tokensInput: 100, tokensOutput: 40, calls: 1, costUsd: 0.03 },
    ]);
    await recordUsageLedgerForNode(runId, 'b', [
      { provider: 'openai', model: 'gpt-5-codex', tokensInput: 200, tokensOutput: 20, calls: 1 }, // no usd, no estimate
    ]);
    const res = await queryUsage({ groupBy: 'provider' });
    const openai = res.groups.find(g => g.key === 'openai');
    expect(openai?.rowsMissingUsd).toBe(1);
    expect(openai?.costUsd).toBe(0);
  });
});
```
> Match `setupTestDb`/`seedRun`/`test-helpers` to the actual helpers used by neighboring db tests (read one, e.g. `workflow-events.test.ts`). If none exist, seed via `createWorkflowStore().createWorkflowRun(...)`.

- [ ] **Step 2: Run test to verify it fails**

Run: `bun --filter @archon/core test usage-ledger`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the module**

```ts
// packages/core/src/db/usage-ledger.ts
import { pool, getDatabaseType } from './connection';
import { createLogger } from '@archon/paths';

let cachedLog: ReturnType<typeof createLogger> | undefined;
const log = () => (cachedLog ??= createLogger('db.usage-ledger'));

export interface UsageLedgerRowInput {
  source?: string;
  workflowRunId?: string;
  nodeId?: string;
  workflowName?: string;
  codebaseId?: string;
  userId?: string;
  provider: string;
  model: string;
  kind?: 'advisor';
  tokensInput: number;
  tokensOutput: number;
  cacheRead?: number;
  cacheWrite?: number;
  calls: number;
  costUsd?: number;
  costEstimatedUsd?: number;
  pricingSource?: 'catalog' | 'config';
}

export interface UsageQuery {
  from?: Date;
  to?: Date;
  codebaseId?: string;
  provider?: string;
  model?: string;
  kind?: string;
  groupBy: 'provider' | 'model' | 'workflow' | 'day';
}

export interface UsageGroup {
  key: string;
  tokensInput: number;
  tokensOutput: number;
  costUsd: number;
  costEstimatedUsd: number;
  rowsMissingUsd: number;
}
export interface UsageQueryResult { groups: UsageGroup[]; }

function toDbDate(d: Date): string {
  return getDatabaseType() === 'sqlite'
    ? d.toISOString().replace('T', ' ').slice(0, 19)
    : d.toISOString();
}

/** Replace all ledger rows for one node, then insert the given rows, atomically.
 *  Idempotent: a retry-node or resume re-execution overwrites the prior rows so
 *  cross-run reports reflect the latest execution, never a double count.
 *  Never throws — cost tracking must not fail a run. */
export async function recordUsageLedgerForNode(
  workflowRunId: string,
  nodeId: string,
  rows: UsageLedgerRowInput[]
): Promise<void> {
  try {
    await pool.withTransaction(async q => {
      await q('DELETE FROM remote_agent_usage_ledger WHERE workflow_run_id = $1 AND node_id = $2', [
        workflowRunId,
        nodeId,
      ]);
      for (const r of rows) {
        await q(
          `INSERT INTO remote_agent_usage_ledger
            (source, workflow_run_id, node_id, workflow_name, codebase_id, user_id,
             provider, model, kind, tokens_input, tokens_output, cache_read, cache_write,
             calls, cost_usd, cost_estimated_usd, pricing_source)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)`,
          [
            r.source ?? 'workflow',
            r.workflowRunId ?? workflowRunId,
            r.nodeId ?? nodeId,
            r.workflowName ?? null,
            r.codebaseId ?? null,
            r.userId ?? null,
            r.provider,
            r.model,
            r.kind ?? null,
            r.tokensInput,
            r.tokensOutput,
            r.cacheRead ?? null,
            r.cacheWrite ?? null,
            r.calls,
            r.costUsd ?? null,
            r.costEstimatedUsd ?? null,
            r.pricingSource ?? null,
          ]
        );
      }
    });
  } catch (err) {
    log().warn(
      { err: err as Error, workflowRunId, nodeId, rowCount: rows.length },
      'usage_ledger.record_failed'
    );
  }
}

/** Aggregate ledger rows. `costUsd` sums provider-reported only; estimates sum
 *  separately; `rowsMissingUsd` counts rows with neither. */
export async function queryUsage(filter: UsageQuery): Promise<UsageQueryResult> {
  const where: string[] = [];
  const params: unknown[] = [];
  const add = (clause: string, value: unknown) => {
    params.push(value);
    where.push(clause.replace('?', `$${params.length}`));
  };
  if (filter.from) add('created_at >= ?', toDbDate(filter.from));
  if (filter.to) add('created_at <= ?', toDbDate(filter.to));
  if (filter.codebaseId) add('codebase_id = ?', filter.codebaseId);
  if (filter.provider) add('provider = ?', filter.provider);
  if (filter.model) add('model = ?', filter.model);
  if (filter.kind) add('kind = ?', filter.kind);

  const keyExpr =
    filter.groupBy === 'provider' ? 'provider'
    : filter.groupBy === 'model' ? 'model'
    : filter.groupBy === 'workflow' ? 'workflow_name'
    : getDatabaseType() === 'sqlite' ? "substr(created_at,1,10)" : "to_char(created_at,'YYYY-MM-DD')";

  const sql = `
    SELECT ${keyExpr} AS key,
           COALESCE(SUM(tokens_input),0)  AS tokens_input,
           COALESCE(SUM(tokens_output),0) AS tokens_output,
           COALESCE(SUM(cost_usd),0)      AS cost_usd,
           COALESCE(SUM(cost_estimated_usd),0) AS cost_estimated_usd,
           SUM(CASE WHEN cost_usd IS NULL AND cost_estimated_usd IS NULL THEN 1 ELSE 0 END) AS rows_missing_usd
    FROM remote_agent_usage_ledger
    ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
    GROUP BY key
    ORDER BY cost_usd DESC, key ASC`;

  const res = await pool.query(sql, params);
  return {
    groups: res.rows.map(row => ({
      key: String((row as Record<string, unknown>).key ?? ''),
      tokensInput: Number((row as Record<string, unknown>).tokens_input ?? 0),
      tokensOutput: Number((row as Record<string, unknown>).tokens_output ?? 0),
      costUsd: Number((row as Record<string, unknown>).cost_usd ?? 0),
      costEstimatedUsd: Number((row as Record<string, unknown>).cost_estimated_usd ?? 0),
      rowsMissingUsd: Number((row as Record<string, unknown>).rows_missing_usd ?? 0),
    })),
  };
}
```
> `pool.query` / `pool.withTransaction` and the `$n` placeholder style must match the exact `connection.ts` API used by `workflow-events.ts` (read it; that file uses the same `pool` import). If `withTransaction` lives on `IDatabase` rather than `pool`, adapt the call to the real seam — the DELETE-then-INSERT must stay in one transaction.

- [ ] **Step 4: Export from core**

In `packages/core/src/index.ts` add:
```ts
export {
  recordUsageLedgerForNode,
  queryUsage,
  type UsageLedgerRowInput,
  type UsageQuery,
  type UsageQueryResult,
  type UsageGroup,
} from './db/usage-ledger';
```

- [ ] **Step 5: Run test to verify it passes**

Run: `bun --filter @archon/core test usage-ledger`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/db/usage-ledger.ts packages/core/src/db/usage-ledger.test.ts packages/core/src/index.ts
git commit -m "feat(core): usage ledger db module (idempotent per-node write + query)"
```

---

### Task 12: Pricing estimate module

**Files:**
- Create: `packages/core/src/pricing/estimate-cost.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/src/pricing/estimate-cost.test.ts`

**Interfaces:**
- Produces: `interface PriceRate { inputPerMTok: number; outputPerMTok: number; cacheReadPerMTok?: number; cacheWritePerMTok?: number }`; `interface EstimateInput { provider: string; model: string; input: number; output: number; cacheRead?: number; cacheWrite?: number }`; `estimateCost(input: EstimateInput, catalog: PricingCatalog): { costEstimatedUsd: number; pricingSource: 'catalog'|'config' } | undefined`; `type PricingCatalog = { config?: Record<string, PriceRate>; piModels?: Array<{ ref: string; cost?: { input?: number; output?: number; cacheRead?: number; cacheWrite?: number } }> }`.

- [ ] **Step 1: Write the failing test**

```ts
// packages/core/src/pricing/estimate-cost.test.ts
import { describe, it, expect } from 'bun:test';
import { estimateCost } from './estimate-cost';

describe('estimateCost', () => {
  const catalog = {
    config: { 'openai/gpt-5-codex': { inputPerMTok: 1.25, outputPerMTok: 10 } },
    piModels: [{ ref: 'anthropic/claude-opus-4', cost: { input: 15, output: 75 } }],
  };
  it('prefers config over catalog and computes per-MTok', () => {
    const r = estimateCost({ provider: 'openai', model: 'gpt-5-codex', input: 1_000_000, output: 100_000 }, catalog);
    expect(r).toEqual({ costEstimatedUsd: 1.25 + 1.0, pricingSource: 'config' });
  });
  it('falls back to the pi catalog', () => {
    const r = estimateCost({ provider: 'anthropic', model: 'claude-opus-4', input: 1_000_000, output: 0 }, catalog);
    expect(r).toEqual({ costEstimatedUsd: 15, pricingSource: 'catalog' });
  });
  it('returns undefined on an exact-id miss (no fuzzy match)', () => {
    expect(estimateCost({ provider: 'openai', model: 'gpt-4o', input: 100, output: 100 }, catalog)).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun --filter @archon/core test estimate-cost`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// packages/core/src/pricing/estimate-cost.ts
export interface PriceRate {
  inputPerMTok: number;
  outputPerMTok: number;
  cacheReadPerMTok?: number;
  cacheWritePerMTok?: number;
}
export interface EstimateInput {
  provider: string;
  model: string;
  input: number;
  output: number;
  cacheRead?: number;
  cacheWrite?: number;
}
export interface PricingCatalog {
  config?: Record<string, PriceRate>;
  piModels?: Array<{
    ref: string;
    cost?: { input?: number; output?: number; cacheRead?: number; cacheWrite?: number };
  }>;
}

const PER_MTOK = 1_000_000;

/** Estimate USD from token counts. Config rates win over the Pi catalog. Match
 *  is by EXACT "<provider>/<model>" id — no fuzzy matching. Returns undefined
 *  when no rate is found; the caller then leaves cost_estimated_usd NULL. */
export function estimateCost(
  input: EstimateInput,
  catalog: PricingCatalog
): { costEstimatedUsd: number; pricingSource: 'catalog' | 'config' } | undefined {
  const key = `${input.provider}/${input.model}`;
  const configRate = catalog.config?.[key];
  if (configRate) {
    return { costEstimatedUsd: applyRate(input, configRate), pricingSource: 'config' };
  }
  const pi = catalog.piModels?.find(m => m.ref === key);
  if (pi?.cost && (pi.cost.input !== undefined || pi.cost.output !== undefined)) {
    return {
      costEstimatedUsd: applyRate(input, {
        inputPerMTok: pi.cost.input ?? 0,
        outputPerMTok: pi.cost.output ?? 0,
        cacheReadPerMTok: pi.cost.cacheRead,
        cacheWritePerMTok: pi.cost.cacheWrite,
      }),
      pricingSource: 'catalog',
    };
  }
  return undefined;
}

function applyRate(i: EstimateInput, r: PriceRate): number {
  let usd = (i.input / PER_MTOK) * r.inputPerMTok + (i.output / PER_MTOK) * r.outputPerMTok;
  if (i.cacheRead && r.cacheReadPerMTok) usd += (i.cacheRead / PER_MTOK) * r.cacheReadPerMTok;
  if (i.cacheWrite && r.cacheWritePerMTok) usd += (i.cacheWrite / PER_MTOK) * r.cacheWritePerMTok;
  return usd;
}
```
> Verify the Pi catalog's cost units against `packages/providers/src/community/pi/model-catalog.ts` (per-MTok vs per-token). If Pi reports per-token, drop the `/PER_MTOK` divisor for the `piModels` branch — adjust `applyRate` accordingly and fix the test's expected numbers. Do not guess the unit; read the field.

- [ ] **Step 4: Export + run test**

Add to `packages/core/src/index.ts`: `export { estimateCost, type PricingCatalog, type EstimateInput, type PriceRate } from './pricing/estimate-cost';`
Run: `bun --filter @archon/core test estimate-cost`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/pricing/estimate-cost.ts packages/core/src/pricing/estimate-cost.test.ts packages/core/src/index.ts
git commit -m "feat(core): usage cost estimation from config + pi catalog"
```

---

### Task 13: Wire executor → ledger via the store seam

**Files:**
- Modify: `packages/workflows/src/store.ts` (`IWorkflowStore` ~194) — add `recordUsageLedger`
- Modify: `packages/workflows/src/dag-executor.ts` — call it at node completion (beside the `node_completed` event persist)
- Modify: `packages/core/src/workflows/store-adapter.ts` (~367+) — implement `recordUsageLedger` (build rows from breakdown, resolve estimates, call `recordUsageLedgerForNode`)
- Test: `packages/core/src/workflows/store-adapter.test.ts`

**Interfaces:**
- Consumes: `UsageBreakdown`; `recordUsageLedgerForNode`, `estimateCost` (core); the run's `codebase_id`/`user_id`/`workflow_name` (already on `WorkflowRun`).
- Produces: `IWorkflowStore.recordUsageLedger(input: { workflowRunId: string; nodeId: string; workflowName: string; codebaseId?: string; userId?: string; breakdown: UsageBreakdown }): Promise<void>`.

- [ ] **Step 1: Add the method to the interface**

In `packages/workflows/src/store.ts`, inside `interface IWorkflowStore`, add:
```ts
  /** Persist per-model usage rows for a completed node (idempotent per node).
   *  Implementations resolve estimated pricing and must never throw. */
  recordUsageLedger(input: {
    workflowRunId: string;
    nodeId: string;
    workflowName: string;
    codebaseId?: string;
    userId?: string;
    breakdown: import('@archon/providers/types').UsageBreakdown;
  }): Promise<void>;
```

- [ ] **Step 2: Write the failing store-adapter test**

```ts
// add to packages/core/src/workflows/store-adapter.test.ts
it('recordUsageLedger writes one row per model with estimates for token-only providers', async () => {
  const store = createWorkflowStore();
  const runId = await seedRunWithCodebase(); // existing/analogous helper
  await store.recordUsageLedger({
    workflowRunId: runId,
    nodeId: 'n1',
    workflowName: 'demo',
    breakdown: {
      'anthropic/claude-opus-4': { input: 100, output: 40, calls: 1, costUsd: 0.03 },
      'openai/gpt-5-codex': { input: 1_000_000, output: 0, calls: 1 }, // token-only → estimated
    },
  });
  const res = await queryUsage({ groupBy: 'model' });
  const opus = res.groups.find(g => g.key === 'claude-opus-4');
  const codex = res.groups.find(g => g.key === 'gpt-5-codex');
  expect(opus?.costUsd).toBeCloseTo(0.03, 6);
  expect(codex?.costUsd).toBe(0);              // no provider USD
  expect(codex?.costEstimatedUsd).toBeGreaterThan(0); // estimated (requires a catalog/config rate present in test env)
});
```
> If no pricing rate is configured in the test environment, assert `codex?.rowsMissingUsd === 1` instead — both are valid absence behavior. Pick the branch matching how the test seeds pricing.

- [ ] **Step 3: Implement in the adapter**

In `store-adapter.ts`, add to the returned store object:
```ts
    recordUsageLedger: async (input): Promise<void> => {
      try {
        const catalog = await loadPricingCatalog(); // config pricing + pi models; best-effort, cached
        const rows = Object.entries(input.breakdown).map(([key, e]) => {
          const slash = key.indexOf('/');
          const provider = slash > 0 ? key.slice(0, slash) : '';
          const model = slash > 0 ? key.slice(slash + 1) : key;
          const est =
            e.costUsd === undefined
              ? estimateCost({ provider, model, input: e.input, output: e.output, cacheRead: e.cacheRead, cacheWrite: e.cacheWrite }, catalog)
              : undefined;
          return {
            workflowRunId: input.workflowRunId,
            nodeId: input.nodeId,
            workflowName: input.workflowName,
            codebaseId: input.codebaseId,
            userId: input.userId,
            provider,
            model,
            kind: e.kind,
            tokensInput: e.input,
            tokensOutput: e.output,
            cacheRead: e.cacheRead,
            cacheWrite: e.cacheWrite,
            calls: e.calls,
            costUsd: e.costUsd,
            costEstimatedUsd: est?.costEstimatedUsd,
            pricingSource: est?.pricingSource,
          };
        });
        await recordUsageLedgerForNode(input.workflowRunId, input.nodeId, rows);
      } catch (err) {
        createLogger('workflow.store-adapter').warn(
          { err: err as Error, workflowRunId: input.workflowRunId, nodeId: input.nodeId },
          'usage_ledger.adapter_record_failed'
        );
      }
    },
```
Add a small cached `loadPricingCatalog()` in the adapter (or `packages/core/src/pricing/catalog.ts`): read `pricing:` from merged config (`loadMergedConfig`) and the Pi model list (reuse whatever powers `GET /api/providers/pi/models`; best-effort → `{ piModels: [] }` on failure). Import `estimateCost` and `recordUsageLedgerForNode` from the core db/pricing modules.

- [ ] **Step 4: Call it from the executor at node completion**

In `dag-executor.ts`, immediately after the `node_completed` event `.createWorkflowEvent({...}).catch(...)` block, add:
```ts
    if (Object.keys(nodeUsageBreakdown).length > 0) {
      void deps.store.recordUsageLedger({
        workflowRunId: workflowRun.id,
        nodeId: node.id,
        workflowName: workflowRun.workflow_name,
        codebaseId: workflowRun.codebase_id ?? undefined,
        userId: workflowRun.user_id ?? undefined,
        breakdown: nodeUsageBreakdown,
      });
    }
```
Apply the SAME call at the loop `node_completed` sites (Task 9) using `loopUsageByModel`, and at the sub-run parent-node completion. (One ledger write per completed node; the child run wrote its own rows already.)
> For a stub `IWorkflowStore` used elsewhere in tests, add a no-op `recordUsageLedger: async () => {}` so type-check passes — grep `IWorkflowStore` test doubles and update each.

- [ ] **Step 5: Run tests**

Run: `bun --filter @archon/core test store-adapter && bun --filter @archon/workflows run type-check`
Expected: PASS, clean.

- [ ] **Step 6: Commit**

```bash
git add packages/workflows/src/store.ts packages/workflows/src/dag-executor.ts packages/core/src/workflows/store-adapter.ts packages/core/src/workflows/store-adapter.test.ts packages/core/src/pricing
git commit -m "feat(workflows): write per-node usage to the ledger via store seam"
```

---

# PHASE 4 — API + CLI + run-detail UI

### Task 14: `GET /api/usage` endpoint

**Files:**
- Create: `packages/server/src/routes/schemas/usage.ts`
- Modify: `packages/server/src/routes/api.ts` (register the route)
- Test: `packages/server/src/routes/usage.test.ts` (or the existing api route test file pattern)

**Interfaces:**
- Consumes: `queryUsage`, `UsageQuery` (core).
- Produces: `GET /api/usage?from&to&codebase&provider&model&kind&group_by` → `{ groups: UsageGroup[] }` (200); 400 on invalid `group_by`.

- [ ] **Step 1: Write the failing test**

```ts
// packages/server/src/routes/usage.test.ts
import { describe, it, expect } from 'bun:test';
import { makeTestApp } from '../test/app'; // match existing route-test harness
// seed a couple of ledger rows via createWorkflowStore().recordUsageLedger(...)

describe('GET /api/usage', () => {
  it('returns grouped usage', async () => {
    const app = await makeTestApp();
    const res = await app.request('/api/usage?group_by=provider');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.groups)).toBe(true);
  });
  it('400 on invalid group_by', async () => {
    const app = await makeTestApp();
    const res = await app.request('/api/usage?group_by=bogus');
    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun --filter @archon/server test usage`
Expected: FAIL — route 404.

- [ ] **Step 3: Add the schema**

```ts
// packages/server/src/routes/schemas/usage.ts
import { z } from '@hono/zod-openapi';

export const usageQuerySchema = z.object({
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  codebase: z.string().optional(),
  provider: z.string().optional(),
  model: z.string().optional(),
  kind: z.string().optional(),
  group_by: z.enum(['provider', 'model', 'workflow', 'day']).default('provider'),
});

export const usageGroupSchema = z.object({
  key: z.string(),
  tokensInput: z.number(),
  tokensOutput: z.number(),
  costUsd: z.number(),
  costEstimatedUsd: z.number(),
  rowsMissingUsd: z.number(),
});
export const usageResponseSchema = z.object({ groups: z.array(usageGroupSchema) });
```

- [ ] **Step 4: Register the route**

In `packages/server/src/routes/api.ts`, using the local `registerOpenApiRoute(createRoute({...}), handler)` wrapper:
```ts
registerOpenApiRoute(
  createRoute({
    method: 'get',
    path: '/api/usage',
    request: { query: usageQuerySchema },
    responses: {
      200: { content: { 'application/json': { schema: usageResponseSchema } }, description: 'Aggregated usage' },
    },
  }),
  async c => {
    const q = c.req.valid('query');
    const result = await queryUsage({
      from: q.from ? new Date(q.from) : undefined,
      to: q.to ? new Date(q.to) : undefined,
      codebaseId: q.codebase,
      provider: q.provider,
      model: q.model,
      kind: q.kind,
      groupBy: q.group_by,
    });
    return c.json(result, 200);
  }
);
```
Import `queryUsage` from `@archon/core` and the schemas from `./schemas/usage`.

- [ ] **Step 5: Run test to verify it passes**

Run: `bun --filter @archon/server test usage`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/server/src/routes/schemas/usage.ts packages/server/src/routes/api.ts packages/server/src/routes/usage.test.ts
git commit -m "feat(server): GET /api/usage cross-run usage reporting"
```

---

### Task 15: `archon usage` CLI command

**Files:**
- Modify: `packages/cli/src/cli.ts` (register command following the existing `workflow` command pattern)
- Test: `packages/cli/src/usage-command.test.ts` (or extend an existing CLI test)

**Interfaces:**
- Consumes: `queryUsage` (core).
- Produces: `archon usage [--from ISO] [--to ISO] [--by provider|model|project] [--provider X] [--codebase ID] [--json]`. `--by project` maps to `groupBy: 'workflow'`. Human output prints a table; `--json` prints `queryUsage` result verbatim.

- [ ] **Step 1: Write the failing test**

```ts
// packages/cli/src/usage-command.test.ts
import { describe, it, expect } from 'bun:test';
import { buildUsageQueryArgs } from './cli'; // export a pure arg→UsageQuery mapper for testing

describe('usage command arg mapping', () => {
  it('maps --by project to workflow grouping', () => {
    expect(buildUsageQueryArgs({ by: 'project' }).groupBy).toBe('workflow');
  });
  it('defaults grouping to provider', () => {
    expect(buildUsageQueryArgs({}).groupBy).toBe('provider');
  });
  it('parses --from into a Date', () => {
    const q = buildUsageQueryArgs({ from: '2026-09-01T00:00:00Z' });
    expect(q.from instanceof Date).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun --filter @archon/cli test usage-command`
Expected: FAIL — `buildUsageQueryArgs` not exported.

- [ ] **Step 3: Implement the mapper + command**

Add and export the pure mapper in `cli.ts`:
```ts
export function buildUsageQueryArgs(opts: {
  from?: string; to?: string; by?: string; provider?: string; model?: string; codebase?: string; kind?: string;
}): import('@archon/core').UsageQuery {
  const by = opts.by === 'project' ? 'workflow' : (opts.by ?? 'provider');
  return {
    from: opts.from ? new Date(opts.from) : undefined,
    to: opts.to ? new Date(opts.to) : undefined,
    provider: opts.provider,
    model: opts.model,
    codebaseId: opts.codebase,
    kind: opts.kind,
    groupBy: (['provider', 'model', 'workflow', 'day'].includes(by) ? by : 'provider') as import('@archon/core').UsageQuery['groupBy'],
  };
}
```
Register the `usage` command in the CLI table (mirror how `workflow` is registered): parse flags, call `queryUsage(buildUsageQueryArgs(opts))`, then:
- `--json`: `console.log(JSON.stringify(result, null, 2))`.
- human: print a table `key | tokens in | tokens out | cost | ~est | missing$`, marking estimated with a leading `≈` and appending a footer line when any group has `rowsMissingUsd > 0`: `N model-rows report tokens only (no USD)`.

- [ ] **Step 4: Run test + a manual smoke**

Run: `bun --filter @archon/cli test usage-command`
Expected: PASS.
Manual: `bun run cli usage --by model --json` → prints `{ "groups": [...] }` (empty on a fresh DB).

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/cli.ts packages/cli/src/usage-command.test.ts
git commit -m "feat(cli): archon usage cross-run reporting command"
```

---

### Task 16: Run-detail breakdown UI

**Files:**
- Create: `packages/web/src/experiments/console/components/UsageBreakdownTable.tsx`
- Modify: `packages/web/src/experiments/console/components/RunDetailHeader.tsx` (~117-122); `NodeDivider.tsx` (~72-73); regenerate `packages/web/src/lib/api.generated.d.ts`
- Test: `packages/web/src/experiments/console/components/UsageBreakdownTable.test.tsx` (if the console has a test runner) OR a pure formatter unit in `primitives/usage.ts`

**Interfaces:**
- Consumes: the run's `usage_by_model` (from run metadata, via the run detail API response) and each node event's `usage_breakdown`.
- Produces: `<UsageBreakdownTable entries={UsageByModel} />` rendering rows: model, calls, tokens in/out, cache, cost. Estimated cost shown as `≈ $x` (from a sibling estimated map when provider USD absent); no `$0.00` for unknown cost — show `—`.

- [ ] **Step 1: Regenerate API types (server must be running)**

Run:
```bash
bun run dev:server &   # note the PID it prints; stop it when done
bun --filter @archon/web generate:types
```
Confirm `UsageByModel`/`usage_by_model` appears in `packages/web/src/lib/api.generated.d.ts`.

- [ ] **Step 2: Write the failing formatter test**

```ts
// packages/web/src/experiments/console/primitives/usage.test.ts
import { describe, it, expect } from 'bun:test';
import { formatCostCell } from './usage';

describe('formatCostCell', () => {
  it('renders provider cost as $', () => {
    expect(formatCostCell({ costUsd: 0.0312 })).toBe('$0.0312');
  });
  it('renders estimate with ≈ when only estimate present', () => {
    expect(formatCostCell({ costEstimatedUsd: 0.02 })).toBe('≈ $0.0200');
  });
  it('renders em-dash when neither present (never $0)', () => {
    expect(formatCostCell({})).toBe('—');
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `bun --filter @archon/web test usage`
Expected: FAIL — `formatCostCell` not found.
> If `@archon/web` has no bun test runner wired, move `formatCostCell` into a plain `.ts` and test it under a package that does, or add the test to the nearest configured runner. Do not skip the pure-function test.

- [ ] **Step 4: Implement the formatter + table**

```ts
// packages/web/src/experiments/console/primitives/usage.ts
export function formatCostCell(v: { costUsd?: number; costEstimatedUsd?: number }): string {
  if (typeof v.costUsd === 'number') return `$${v.costUsd.toFixed(4)}`;
  if (typeof v.costEstimatedUsd === 'number') return `≈ $${v.costEstimatedUsd.toFixed(4)}`;
  return '—';
}
```
Build `UsageBreakdownTable.tsx` rendering one row per key from the `usage_by_model` map, using brand tokens from `packages/web/src/index.css` (no ad-hoc hex). Group/label `kind: 'advisor'` rows with a small "advisor" badge. Render it under the existing cost figure in `RunDetailHeader.tsx` and, collapsed/expandable, in `NodeDivider.tsx`.

- [ ] **Step 5: Run test + typecheck + manual**

Run: `bun --filter @archon/web test usage && bun --filter @archon/web run type-check`
Expected: PASS, clean.
Manual: run a two-provider workflow via the web API; open its run detail; confirm both models render with correct tokens and `≈` where estimated. Stop the dev server (recorded PID).

- [ ] **Step 6: Commit**

```bash
git add packages/web/src/experiments/console/components/UsageBreakdownTable.tsx packages/web/src/experiments/console/primitives/usage.ts packages/web/src/experiments/console/primitives/usage.test.ts packages/web/src/experiments/console/components/RunDetailHeader.tsx packages/web/src/experiments/console/components/NodeDivider.tsx packages/web/src/lib/api.generated.d.ts
git commit -m "feat(web): per-model usage breakdown in run detail"
```

---

# PHASE 5 — Console Cost page

### Task 17: Cross-run Cost page

**Files:**
- Create: `packages/web/src/experiments/console/routes/CostPage.tsx`
- Modify: console nav/router (where console routes are registered); `primitives/usage.ts` (add aggregation helpers)
- Test: `packages/web/src/experiments/console/primitives/usage.test.ts` (extend)

**Interfaces:**
- Consumes: `GET /api/usage` (Task 14) via the generated client; `formatCostCell` (Task 16).
- Produces: a Cost page with a group-by selector (provider/model/project/day), date range, real vs estimated USD columns, a "rows missing USD" note, and drill-down links to run detail.

- [ ] **Step 1: Write the failing aggregation test**

```ts
// extend packages/web/src/experiments/console/primitives/usage.test.ts
import { totalRealCost, totalEstimatedCost, totalMissingUsdRows } from './usage';

it('sums real and estimated cost and missing-usd rows across groups', () => {
  const groups = [
    { key: 'anthropic', tokensInput: 1, tokensOutput: 1, costUsd: 0.03, costEstimatedUsd: 0, rowsMissingUsd: 0 },
    { key: 'openai', tokensInput: 1, tokensOutput: 1, costUsd: 0, costEstimatedUsd: 0.02, rowsMissingUsd: 0 },
    { key: 'copilot', tokensInput: 1, tokensOutput: 1, costUsd: 0, costEstimatedUsd: 0, rowsMissingUsd: 3 },
  ];
  expect(totalRealCost(groups)).toBeCloseTo(0.03, 6);
  expect(totalEstimatedCost(groups)).toBeCloseTo(0.02, 6);
  expect(totalMissingUsdRows(groups)).toBe(3);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun --filter @archon/web test usage`
Expected: FAIL — helpers not exported.

- [ ] **Step 3: Implement the helpers + page**

Add to `primitives/usage.ts`:
```ts
import type { UsageGroup } from '../../../lib/api'; // generated type alias for the /api/usage group
export const totalRealCost = (g: UsageGroup[]) => g.reduce((s, x) => s + (x.costUsd ?? 0), 0);
export const totalEstimatedCost = (g: UsageGroup[]) => g.reduce((s, x) => s + (x.costEstimatedUsd ?? 0), 0);
export const totalMissingUsdRows = (g: UsageGroup[]) => g.reduce((s, x) => s + (x.rowsMissingUsd ?? 0), 0);
```
Build `CostPage.tsx`: query `/api/usage` with the selected `group_by`/date range; render a table of groups with real + `≈ estimated` columns; show a header stat row (`totalRealCost`, `≈ totalEstimatedCost`, and a "`N` rows tokens-only" note when `totalMissingUsdRows > 0`); link each `workflow`/`day` group to a filtered run list. Register the route + a nav entry in the console. Brand tokens only; wide table in an `overflow-x:auto` container.

- [ ] **Step 4: Run test + typecheck + manual**

Run: `bun --filter @archon/web test usage && bun --filter @archon/web run type-check`
Expected: PASS, clean.
Manual: open the Cost page; switch group-by; confirm totals and the tokens-only note match `bun run cli usage --json`.

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/experiments/console/routes/CostPage.tsx packages/web/src/experiments/console/primitives/usage.ts packages/web/src/experiments/console/primitives/usage.test.ts
git commit -m "feat(web): cross-run Cost console page"
```

---

# PHASE 6 — OMP advisor capture

### Task 18: Advisor transcript reader + provider wiring

**Files:**
- Create: `packages/providers/src/community/omp/advisor-usage.ts`
- Modify: `packages/providers/src/community/omp/provider.ts` (fold advisor usage into the result after process exit; session id from the parser)
- Test: `packages/providers/src/community/omp/advisor-usage.test.ts` (fixture transcript files)

**Interfaces:**
- Consumes: `UsageBreakdown`, `usageKey`, `mergeUsageEntry`; the session id captured by `OmpEventParser.getSessionId()`.
- Produces: `readAdvisorUsage(sessionId: string, home: string): Promise<UsageBreakdown>` — returns `kind:'advisor'` entries summed from advisor transcript JSONL; `{}` on any absence/error.

- [ ] **Step 1: VERIFY the on-disk layout (no code yet)**

Read the installed omp's transcript layout — the baseline the provider targets (OMP 17.2.9 per `docs/superpowers/plans/2026-08-06-omp-cli-provider.md`), and cross-check the local clone:

Run: `rg -n "loadAdvisorTranscriptCosts|advisor|sessions/|\.jsonl|transcript" /Users/dale/Desktop/workspace/OceanLabs/agentic-os-plan/oh-my-pi/packages/coding-agent/src/advisor/transcript-recorder.ts`

Record: the session directory path relative to `ARCHON_HOME`/omp home, the advisor transcript filename pattern (per-advisor sibling files), and the JSONL line shape carrying `message.usage` (input/output/cacheRead/cacheWrite/cost.total) + the advisor's model/provider. This determines the fixture and the reader's glob.

- [ ] **Step 2: Write the failing test with fixtures**

```ts
// packages/providers/src/community/omp/advisor-usage.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readAdvisorUsage } from './advisor-usage';

describe('readAdvisorUsage', () => {
  let home: string;
  beforeEach(async () => { home = await mkdtemp(join(tmpdir(), 'omp-adv-')); });
  afterEach(async () => { await rm(home, { recursive: true, force: true }); });

  it('sums advisor assistant usage into kind:advisor entries', async () => {
    // Lay out fixture per the VERIFIED path from Step 1 (adjust dir/filename to match).
    const dir = join(home, /* verified session subpath */ 'sessions', 's1', 'advisors');
    await mkdir(dir, { recursive: true });
    const line = (model: string, input: number, output: number, cost: number) =>
      JSON.stringify({ type: 'message', entry: { type: 'assistant', message: { role: 'assistant', model, provider: 'anthropic', usage: { input, output, cacheRead: 0, cacheWrite: 0, cost: { total: cost } } } } }) + '\n';
    await writeFile(join(dir, 'reviewer.jsonl'), line('claude-opus-4', 100, 40, 0.03) + line('claude-opus-4', 10, 5, 0.004));
    const usage = await readAdvisorUsage('s1', home);
    expect(usage).toEqual({
      'anthropic/claude-opus-4': { input: 110, output: 45, calls: 2, costUsd: 0.034, kind: 'advisor' },
    });
  });

  it('returns {} when the session dir is absent', async () => {
    expect(await readAdvisorUsage('missing', home)).toEqual({});
  });

  it('skips a malformed line, keeps the rest', async () => {
    const dir = join(home, 'sessions', 's2', 'advisors');
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'a.jsonl'), 'not-json\n' + JSON.stringify({ type: 'message', entry: { type: 'assistant', message: { role: 'assistant', model: 'm', provider: 'p', usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, cost: { total: 0.001 } } } } }) + '\n');
    const usage = await readAdvisorUsage('s2', home);
    expect(usage['p/m']).toEqual({ input: 1, output: 1, calls: 1, costUsd: 0.001, kind: 'advisor' });
  });
});
```
> Adjust the fixture directory/filename and the JSONL entry shape to exactly what Step 1 verified. The assertions (sum, `kind:'advisor'`, absence → `{}`, malformed-line tolerance) are the contract.

- [ ] **Step 3: Run test to verify it fails**

Run: `bun --filter @archon/providers test advisor-usage`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement the reader**

```ts
// packages/providers/src/community/omp/advisor-usage.ts
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createLogger } from '@archon/paths';
import type { UsageBreakdown } from '../../types';
import { usageKey, mergeUsageEntry } from '../../shared/usage-breakdown';

const log = createLogger('provider.omp.advisor-usage');

/** Directory holding one JSONL transcript per advisor for a session. Mirrors
 *  oh-my-pi's advisor transcript layout (see transcript-recorder.ts). All layout
 *  knowledge lives here so an omp-format change touches exactly one function. */
function advisorDir(sessionId: string, home: string): string {
  return join(home, 'sessions', sessionId, 'advisors'); // <-- set to the VERIFIED path
}

/** Sum advisor LLM usage from a session's transcripts into kind:'advisor'
 *  breakdown entries. Advisor usage never reaches the omp JSON stream, so this
 *  is the only capture path. Returns {} on any absence/error — never throws,
 *  never fabricates zeros. */
export async function readAdvisorUsage(sessionId: string, home: string): Promise<UsageBreakdown> {
  const breakdown: UsageBreakdown = {};
  let files: string[];
  try {
    files = (await readdir(advisorDir(sessionId, home))).filter(f => f.endsWith('.jsonl'));
  } catch {
    return breakdown; // no advisors ran, or no session dir
  }
  for (const file of files) {
    let text: string;
    try {
      text = await readFile(join(advisorDir(sessionId, home), file), 'utf8');
    } catch (err) {
      log.warn({ err: err as Error, file }, 'omp.advisor_transcript_unreadable');
      continue;
    }
    for (const rawLine of text.split('\n')) {
      const line = rawLine.trim();
      if (!line) continue;
      try {
        const msg = extractAssistantUsage(JSON.parse(line));
        if (msg) {
          mergeUsageEntry(breakdown, usageKey(msg.provider, msg.model), {
            input: msg.input,
            output: msg.output,
            calls: 1,
            ...(msg.cacheRead ? { cacheRead: msg.cacheRead } : {}),
            ...(msg.cacheWrite ? { cacheWrite: msg.cacheWrite } : {}),
            ...(msg.cost ? { costUsd: msg.cost } : {}),
            kind: 'advisor',
          });
        }
      } catch {
        // One malformed line costs only itself (mirrors oh-my-pi's own tolerance).
      }
    }
  }
  return breakdown;
}

interface AdvisorUsage {
  provider: string | undefined;
  model: string;
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  cost: number;
}

/** Pull one assistant message's usage from a transcript record. Shape mirrors
 *  the VERIFIED transcript line from Step 1; returns undefined for non-assistant
 *  or usage-less records. */
function extractAssistantUsage(record: unknown): AdvisorUsage | undefined {
  const entry = (record as { entry?: { type?: string; message?: unknown } })?.entry;
  if (entry?.type !== 'assistant') return undefined;
  const m = entry.message as
    | { role?: string; model?: string; provider?: string; usage?: { input?: number; output?: number; cacheRead?: number; cacheWrite?: number; cost?: { total?: number } } }
    | undefined;
  if (!m || m.role !== 'assistant' || !m.model || !m.usage) return undefined;
  return {
    provider: m.provider,
    model: m.model,
    input: m.usage.input ?? 0,
    output: m.usage.output ?? 0,
    cacheRead: m.usage.cacheRead ?? 0,
    cacheWrite: m.usage.cacheWrite ?? 0,
    cost: m.usage.cost?.total ?? 0,
  };
}
```

- [ ] **Step 5: Wire it into the omp provider**

In `packages/providers/src/community/omp/provider.ts`, after the process exits and the parser's result is built, fold advisor usage into the result's `usageBreakdown` (best-effort):
```ts
const sessionId = parser.getSessionId();
if (sessionId && result.type === 'result') {
  const advisor = await readAdvisorUsage(sessionId, resolveOmpHome());
  if (Object.keys(advisor).length > 0) {
    const merged = { ...(result.usageBreakdown ?? {}) };
    mergeUsageBreakdown(merged, advisor);
    result.usageBreakdown = merged;
  }
}
```
`resolveOmpHome()` = the omp session home the CLI writes to (verify from Step 1; likely `ARCHON_HOME`/omp default). Import `readAdvisorUsage` and `mergeUsageBreakdown`. Document in a provider docblock that `--no-session` runs (`persistSession === false`, provider.ts:142) may have no transcripts, so advisor usage is uncapturable there.

- [ ] **Step 6: Run tests to verify pass**

Run: `bun --filter @archon/providers test advisor-usage omp/`
Expected: PASS.

- [ ] **Step 7: Full providers suite + commit**

Run: `bun --filter @archon/providers test`
Expected: PASS.

```bash
git add packages/providers/src/community/omp/advisor-usage.ts packages/providers/src/community/omp/advisor-usage.test.ts packages/providers/src/community/omp/provider.ts
git commit -m "feat(providers): capture omp advisor usage from session transcripts"
```

---

## Final Validation

- [ ] **Full gate**

Run: `bun run validate`
Expected: all steps pass (type-check, lint, format, per-package tests, `check:bundled-schema`).

- [ ] **Postgres schema-upgrade check**

Run: `bun run check:schema-upgrades`
Expected: PASS (reachable Postgres). Only the excused `remote_agent_codebases_kind_check` divergence prints.

- [ ] **End-to-end smoke**

Run a two-provider workflow (one Claude node with a fallbackModel, one Codex node), then:
```bash
bun run cli usage --by model --json
bun run cli usage --by provider
```
Expected: Claude models (incl. fallback) show real USD; Codex shows tokens with estimated (or `—` + missing-usd note). Run detail shows the same per-node.

---

## Self-Review Notes (spec coverage)

- Spec §2 provider contract → Tasks 1–5. §3 ledger → Tasks 10–11. §4 pricing → Task 12. §5 engine flow → Tasks 6–9, 13. §6 surfaces → Tasks 14–17. §7 advisor → Task 18. §8 absence/error posture → enforced in Tasks 11 (never-throw), 12 (undefined on miss), 16 (`—` not `$0`), 18 (`{}` on error). §9 testing → each task's tests + Final Validation.
- Open items carried as explicit verify-first steps: Pi semantics (Task 4 Step 1), advisor layout (Task 18 Step 1). Both specify both branches — not placeholders.
- Type consistency: `UsageBreakdown`/`ModelUsageEntry` defined once in providers `types.ts` (Task 1), mirrored as Zod in workflows (Task 6, flagged must-match), consumed unchanged downstream. `queryUsage`/`UsageQuery`/`UsageGroup` defined in Task 11, reused verbatim in Tasks 13–17.
