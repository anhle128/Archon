# Node Cost Tracking Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.
> Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist per-model and per-provider usage for every workflow AI node, write the same numbers to run JSON and a queryable ledger, estimate missing USD without mixing it into authoritative cost, and surface the breakdown in API, CLI, run detail, and a console Cost page.

**Architecture:** Providers emit a typed `usageBreakdown` map on the `result` chunk, with authoritative `provider` and `model` on every entry and no estimated fields.
The dag-executor accumulates that map next to `nodeCostUsd`, writes it to `node_completed.usage_breakdown` and run metadata `usage_by_model`, then hands the same map to `IWorkflowStore.replaceNodeUsageLedger()`.
The store adapter is the only ledger writer: it estimates missing USD into separate ledger columns and replace-deletes by `(workflow_run_id, node_id)` inside one transaction.

**Tech Stack:** Bun, strict TypeScript, Zod from `@hono/zod-openapi`, SQLite and PostgreSQL additive schema, existing Pi model catalog, Bun Test, React console experiment.

**Spec:** `docs/superpowers/specs/2026-09-03-node-cost-tracking-design.md`

This plan supersedes the draft at `plans/260903-1917-node-cost-model-breakdown/` wherever they disagree.
The approved design (JSON breakdown plus ledger, estimated pricing, usage API, Cost page) is the source of truth.

## Global Constraints

- Scope v1 is workflow nodes only.
- Ledger `source` defaults to `'workflow'`; `'chat'` is reserved and unused.
- Provider output is authoritative usage only: `ModelUsageEntry` and JSON `usage_breakdown` MUST NOT contain `costEstimatedUsd`, `pricing_source`, engine `node_id`, or any estimated field.
- Provider-reported `costUsd` is the only value allowed in `cost_usd`, JSON `usage_breakdown`, and run totals.
- Estimated USD lives only in ledger column `cost_estimated_usd` with `pricing_source` `'catalog'` or `'config'`.
- `kind` is omitted on ordinary provider entries.
- `kind: 'advisor'` is set only when an OMP advisor transcript is the authoritative source.
- OMP per-model merging happens in `packages/providers/src/community/omp/event-parser.ts`, not in the store adapter.
- Pi and every other provider receive only `SendQueryOptions` they already receive.
- Do not pass engine `node_id`, run id, or ledger identity into provider `sendQuery` or result mapping.
- Namespacing (`<groupId>.<nodeId>`), estimation, and ledger persistence happen downstream of providers.
- Never fabricate `$0`, never guess a model id (#2314), never persist non-finite numbers.
- Old runs and cost-less providers render "not recorded" or tokens-only, never `$0.00`.
- Cost-path failures (ledger write, transcript read, catalog lookup) log WARN and must not fail the node.
- The engine never parses `"provider/model"` map keys.
- `#2345` (usage lost across pause/resume gates) is out of scope and must not be worsened.
- `#2333` loop-gate token semantics stay as-is.
- `maxBudgetUsd` is untouched.
- No historical backfill, no per-user billing, no chat-surface recording.
- Database changes are additive in both dialects.
- Every new `ADD COLUMN ... NOT NULL` has a `DEFAULT`.
- New indexes and `COMMENT ON COLUMN` go in the trailing "Indexes and column comments" section of `migrations/000_combined.sql`.
- Mirror the table into SQLite `createSchema()`.
- Generate `packages/core/src/db/bundled-schema.generated.ts` only with `bun run generate:bundled-schema`.
- Derive types with `z.infer<typeof schema>`.
- Import `z` from `@hono/zod-openapi` in core, workflows, and server schema files.
- Use `z.record(z.string(), valueSchema)` for record schemas.
- `@archon/web` never imports `@archon/workflows`.
- `@archon/workflows` imports provider types only from `@archon/providers/types`.
- No `any`.
- Never run `bun test` from the repository root.
- Run mock-heavy files in their existing isolated `bun test` invocations.
- When adding an `IWorkflowStore` method, update every mock factory that already stubs `getDagResumeSnapshot`.
- Keep every full Markdown sentence on its own physical line in new or substantially edited Markdown.
- Never add an agent name as a commit co-author.
- Do not edit `CHANGELOG.md`.

## File Map

- Create `packages/providers/src/usage-breakdown.ts` for keying, sanitizing, and merging `UsageBreakdown` maps.
- Create `packages/providers/src/usage-breakdown.test.ts` for merge, NaN drop, and key rules.
- Modify `packages/providers/src/types.ts` to replace `modelUsage` with `usageBreakdown` and export `ModelUsageEntry` / `UsageBreakdown`.
- Re-export `mergeUsageBreakdown` from `packages/providers/src/types.ts` so `@archon/workflows` can import it from `@archon/providers/types`.
- Modify `packages/providers/src/observability.ts` to read `resolvedModel` then `usageBreakdown`.
- Modify `packages/providers/src/claude/provider.ts` to map SDK `modelUsage` into `usageBreakdown` with `kind` omitted.
- Modify `packages/providers/src/claude/provider.test.ts` for fallback/subagent two-entry fixtures.
- Modify `packages/providers/src/community/omp/event-parser.ts` to accumulate per `${provider}/${model}`.
- Modify colocated OMP event-parser tests for a two-model fixture.
- Modify `packages/providers/src/community/pi/event-bridge.ts` after verifying Pi usage semantics.
- Modify Pi event-bridge tests for multi-assistant-message usage.
- Modify `packages/providers/src/grok/event-parser.ts` to emit a single typed entry and stop passing raw `modelUsage`.
- Modify `packages/providers/src/codex/provider.ts` for a tokens-only entry keyed by requested/resolved model.
- Modify `packages/providers/src/community/opencode/session.ts` and `multi-agent.ts` for OpenCode entries.
- Modify `packages/providers/src/community/copilot/event-bridge.ts` for a tokens-only entry.
- Leave Qoder emitting no `usageBreakdown`.
- Create `packages/workflows/src/schemas/usage-breakdown.ts` and tests.
- Modify `packages/workflows/src/schemas/index.ts` to re-export the schema and type.
- Modify `packages/workflows/src/store.ts` to add `replaceNodeUsageLedger`.
- Modify `packages/workflows/src/dag-executor.ts` to accumulate, persist JSON, and call the store.
- Modify `packages/workflows/src/dag-executor.test.ts` and `packages/workflows/src/subrun.test.ts` for engine behavior.
- Create `packages/core/src/schemas/usage-ledger.ts` for the ledger row and query shapes.
- Create `packages/core/src/usage/estimate.ts` and tests for config-then-catalog estimation.
- Create `packages/core/src/db/usage-ledger.ts` and tests for replace/query.
- Modify `migrations/000_combined.sql` and `packages/core/src/db/adapters/sqlite.ts`.
- Modify `packages/core/src/db/adapters/sqlite.test.ts` (`MIN_NON_AUTH_COLUMNS` becomes 157).
- Modify `packages/core/src/config/config-types.ts` and `config-loader.ts` for optional `pricing.models`.
- Modify `packages/core/src/workflows/store-adapter.ts` and its test required-method list.
- Create `packages/server/src/routes/schemas/usage.schemas.ts`.
- Modify `packages/server/src/routes/api.ts` to register `GET /api/usage`.
- Create `packages/cli/src/commands/usage.ts` and tests.
- Modify `packages/cli/src/cli.ts` and `packages/docs-web/src/content/docs/reference/cli.md`.
- Modify console run primitives, `RunDetailHeader.tsx`, `NodeDivider.tsx`, and add `UsageBreakdownTable.tsx`.
- Create `packages/web/src/experiments/console/routes/CostPage.tsx` and wire `ConsoleApp.tsx`.
- Create `packages/providers/src/community/omp/advisor-usage.ts` and tests with fixture transcripts.
- Modify `packages/providers/src/community/omp/provider.ts` to fold advisor entries after process exit.
- Modify `packages/docs-web/src/content/docs/reference/configuration.md` for `pricing:`.
- Generate bundled schema and web OpenAPI types with the repo generators.

---

### Task 1: UsageBreakdown Contract And Merge Helper

**Files:**

- Create: `packages/providers/src/usage-breakdown.ts`
- Create: `packages/providers/src/usage-breakdown.test.ts`
- Modify: `packages/providers/src/types.ts:230-283`
- Modify: `packages/providers/src/observability.ts:133-147`
- Modify: `packages/providers/package.json` test script (append `&& bun test src/usage-breakdown.test.ts` to an existing isolated invocation that does not `mock.module` `./types`)

**Interfaces:**

- Consumes: existing `TokenUsage` and `MessageChunk` result variant.
- Produces:

```ts
export interface ModelUsageEntry {
  /** Archon agent id or upstream vendor id reported by the provider. Never parsed from the map key. */
  provider: string;
  /** Concrete model id reported by the provider. Never guessed. */
  model: string;
  input: number;
  output: number;
  cacheRead?: number;
  cacheWrite?: number;
  /** Provider-reported USD only. Never estimated. */
  costUsd?: number;
  /** Assistant turns attributed to this model. */
  calls: number;
  /** Set only for authoritative OMP advisor transcripts. Omit on ordinary entries. */
  kind?: 'advisor';
}

export type UsageBreakdown = Record<string, ModelUsageEntry>;

export function usageBreakdownKey(provider: string, model: string): string;
export function sanitizeUsageEntry(entry: ModelUsageEntry): ModelUsageEntry | undefined;
export function mergeUsageBreakdown(into: UsageBreakdown, from: UsageBreakdown): UsageBreakdown;
```

- Result chunk field becomes `usageBreakdown?: UsageBreakdown`.
- Delete `modelUsage?: Record<string, unknown>` from the result variant.
- `usageBreakdownKey` returns `` `${provider}/${model}` ``.
- `sanitizeUsageEntry` returns `undefined` when `provider` or `model` is empty, or when `input`, `output`, `calls`, or present optional numbers are non-finite.
- `sanitizeUsageEntry` also returns `undefined` if the object contains `costEstimatedUsd` or `pricingSource` (those fields must never be produced by providers).
- `mergeUsageBreakdown` sums `input`, `output`, `calls`, and present optional numeric fields.
- On key collision, keep the first entry's `provider` and `model`.
- `kind` stays `'advisor'` if either side has it; otherwise the merged entry omits `kind`.
- Keep existing `tokens`, `cost`, and `resolvedModel` untouched.
- Re-export the three helper functions from `packages/providers/src/types.ts` so workflows can import them from `@archon/providers/types`.

- [ ] **Step 1: Write the failing merge tests.**

Create `packages/providers/src/usage-breakdown.test.ts`:

```ts
import { describe, expect, test } from 'bun:test';
import {
  mergeUsageBreakdown,
  sanitizeUsageEntry,
  usageBreakdownKey,
  type ModelUsageEntry,
} from './usage-breakdown';

const claude: ModelUsageEntry = {
  provider: 'claude',
  model: 'claude-sonnet-4-6',
  input: 10,
  output: 4,
  costUsd: 0.02,
  calls: 1,
};

describe('usageBreakdownKey', () => {
  test('joins provider and model without parsing later', () => {
    expect(usageBreakdownKey('omp', 'gpt-5.4')).toBe('omp/gpt-5.4');
  });
});

describe('sanitizeUsageEntry', () => {
  test('drops non-finite cost and empty model', () => {
    expect(sanitizeUsageEntry({ ...claude, costUsd: Number.NaN })).toBeUndefined();
    expect(sanitizeUsageEntry({ ...claude, model: '' })).toBeUndefined();
  });

  test('ordinary entries omit kind', () => {
    expect(sanitizeUsageEntry(claude)?.kind).toBeUndefined();
  });
});

describe('mergeUsageBreakdown', () => {
  test('sums two models and the same key', () => {
    const haiku: ModelUsageEntry = {
      provider: 'claude',
      model: 'claude-haiku-4-5',
      input: 3,
      output: 1,
      calls: 1,
    };
    const first = mergeUsageBreakdown({}, {
      [usageBreakdownKey(claude.provider, claude.model)]: claude,
      [usageBreakdownKey(haiku.provider, haiku.model)]: haiku,
    });
    const second = mergeUsageBreakdown(first, {
      [usageBreakdownKey(claude.provider, claude.model)]: {
        ...claude,
        input: 5,
        output: 2,
        calls: 1,
        costUsd: 0.01,
      },
    });
    expect(second['claude/claude-sonnet-4-6']).toMatchObject({
      provider: 'claude',
      model: 'claude-sonnet-4-6',
      input: 15,
      output: 6,
      costUsd: 0.03,
      calls: 2,
    });
    expect(second['claude/claude-sonnet-4-6']?.kind).toBeUndefined();
    expect(second['claude/claude-haiku-4-5']?.input).toBe(3);
  });
});
```

- [ ] **Step 2: Run the test and confirm it fails.**

Run from `packages/providers`:

```bash
bun test src/usage-breakdown.test.ts
```

Expected: FAIL with `Cannot find module './usage-breakdown'`.

- [ ] **Step 3: Implement types, helper, and observability.**

Add to `packages/providers/src/types.ts` immediately after `TokenUsage`:

```ts
export interface ModelUsageEntry {
  provider: string;
  model: string;
  input: number;
  output: number;
  cacheRead?: number;
  cacheWrite?: number;
  costUsd?: number;
  calls: number;
  kind?: 'advisor';
}

export type UsageBreakdown = Record<string, ModelUsageEntry>;
```

Replace `modelUsage?: Record<string, unknown>` on the result variant with `usageBreakdown?: UsageBreakdown`.

Create `packages/providers/src/usage-breakdown.ts` exporting the three functions above and re-exporting the types from `./types`.

Re-export `usageBreakdownKey`, `sanitizeUsageEntry`, and `mergeUsageBreakdown` from `types.ts` (import the implementations from `./usage-breakdown` only if that does not create a cycle; if it would, keep the implementations in `types.ts` and have `usage-breakdown.ts` re-export them).
Prefer implementations in `usage-breakdown.ts` and duplicate-export the functions at the bottom of `types.ts` using `export { ... } from './usage-breakdown'` only if `types.ts` remains free of SDK imports.

If a cycle appears, put the function bodies in `types.ts` (allowed: no SDK, no runtime deps) and make `usage-breakdown.ts` a thin re-export for tests.

In `observability.ts` `resolveModel`, replace the `chunk.modelUsage` branch with:

```ts
  if (chunk?.type === 'result' && chunk.resolvedModel?.id) return chunk.resolvedModel.id;
  if (chunk?.type === 'result' && chunk.usageBreakdown) {
    return Object.keys(chunk.usageBreakdown)[0];
  }
```

Grep `packages/` for `modelUsage` and update every remaining TypeScript reference in this and later provider tasks.
Do not leave a parallel `modelUsage` field.

- [ ] **Step 4: Run tests.**

```bash
bun test src/usage-breakdown.test.ts
bun test src/observability.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add packages/providers/src/types.ts packages/providers/src/usage-breakdown.ts packages/providers/src/usage-breakdown.test.ts packages/providers/src/observability.ts packages/providers/package.json
git commit -m "feat(providers): add typed usageBreakdown contract"
```

---

### Task 2: Claude Per-Model Breakdown

**Files:**

- Modify: `packages/providers/src/claude/provider.ts:95-148,1186-1199`
- Modify: `packages/providers/src/claude/provider.test.ts` (existing `modelUsage` fixtures around the `selectResolvedModelId` tests)

**Interfaces:**

- Consumes: SDK `SDKResultMessage.modelUsage` (`Record<string, ModelUsage>`).
- Produces: `usageBreakdown` on the Claude result chunk.
- Keep `selectResolvedModelId` and its WARN exactly as they are.
- Do not set `kind` on Claude entries.
- Do not pass `node.id` or any engine identity into this mapper.

Map each SDK entry:

```ts
import { mergeUsageBreakdown, sanitizeUsageEntry, usageBreakdownKey } from '../usage-breakdown';
import type { UsageBreakdown } from '../types';

function claudeUsageBreakdown(
  modelUsage: Record<string, ModelUsage> | undefined
): UsageBreakdown | undefined {
  if (!modelUsage) return undefined;
  let breakdown: UsageBreakdown = {};
  for (const [model, usage] of Object.entries(modelUsage)) {
    const entry = sanitizeUsageEntry({
      provider: 'claude',
      model,
      input: usage.inputTokens,
      output: usage.outputTokens,
      ...(Number.isFinite(usage.cacheReadInputTokens)
        ? { cacheRead: usage.cacheReadInputTokens }
        : {}),
      ...(Number.isFinite(usage.cacheCreationInputTokens)
        ? { cacheWrite: usage.cacheCreationInputTokens }
        : {}),
      ...(Number.isFinite(usage.costUSD) ? { costUsd: usage.costUSD } : {}),
      calls: 1,
    });
    if (!entry) continue;
    breakdown = mergeUsageBreakdown(breakdown, { [usageBreakdownKey('claude', model)]: entry });
  }
  return Object.keys(breakdown).length > 0 ? breakdown : undefined;
}
```

Verify SDK field names against the imported `ModelUsage` type before coding.
If the installed SDK uses different cache/cost names, map only fields that exist on that type.
Do not invent cache fields.

Spread `...(breakdown ? { usageBreakdown: breakdown } : {})` onto the existing result yield at `provider.ts:1186`.

- [ ] **Step 1: Write the failing fallback fixture.**

In `packages/providers/src/claude/provider.test.ts`, next to the existing multi-key `modelUsage` test, add:

```ts
    test('emits usageBreakdown for every modelUsage key including fallback', async () => {
      mockQuery.mockImplementation(async function* () {
        yield {
          type: 'result',
          session_id: 'sid-multi-model',
          usage: { input_tokens: 500, output_tokens: 80 },
          total_cost_usd: 0.12,
          modelUsage: {
            'claude-haiku-4-5-20251001': {
              inputTokens: 400,
              outputTokens: 20,
              cacheReadInputTokens: 10,
              cacheCreationInputTokens: 2,
              costUSD: 0.02,
            },
            'claude-sonnet-4-6': {
              inputTokens: 100,
              outputTokens: 60,
              costUSD: 0.1,
            },
          },
        };
      });
      const chunks = [];
      for await (const chunk of provider.sendQuery('hi', '/tmp', undefined, undefined)) {
        chunks.push(chunk);
      }
      const result = chunks.find(c => c.type === 'result');
      expect(result?.type).toBe('result');
      if (result?.type !== 'result') throw new Error('missing result');
      expect(result.usageBreakdown?.['claude/claude-sonnet-4-6']).toMatchObject({
        provider: 'claude',
        model: 'claude-sonnet-4-6',
        input: 100,
        output: 60,
        costUsd: 0.1,
        calls: 1,
      });
      expect(result.usageBreakdown?.['claude/claude-sonnet-4-6']?.kind).toBeUndefined();
      expect(result.usageBreakdown?.['claude/claude-haiku-4-5-20251001']?.cacheRead).toBe(10);
      expect(result.resolvedModel?.id).toBe('claude-sonnet-4-6');
    });
```

- [ ] **Step 2: Run the test and confirm it fails.**

```bash
bun test src/claude/provider.test.ts
```

Expected: FAIL because `usageBreakdown` is missing.

- [ ] **Step 3: Implement the mapping and yield it.**

- [ ] **Step 4: Re-run the Claude provider tests.**

Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git commit -m "feat(providers): emit Claude usageBreakdown from SDK modelUsage"
```

---

### Task 3: OMP Per-Message Model Accumulation

**Files:**

- Modify: `packages/providers/src/community/omp/event-parser.ts:55-60,128-143,227-339`
- Modify: the colocated OMP event-parser test file that already feeds `message_end` usage

**Interfaces:**

- Consumes: `message.provider`, `message.model`, `message.usage.{input,output,totalTokens,cost.total}` and optional `usage.cacheRead` / `usage.cacheWrite` only if those keys are finite numbers on real fixtures.
- Produces: parser-private `breakdown: UsageBreakdown` merged in `accumulateUsage`, copied onto `buildObservedResult`.
- Keep the collapsed `this.tokens` total unchanged.
- This is the only OMP merge site for primary (non-advisor) usage.
- Do not merge OMP maps in `store-adapter` or `usage-ledger.ts`.

Do not guess cache field names.
If a two-model fixture's `usage` object has no cache keys, omit cache fields.
Do not set `kind` on these primary entries.

- [ ] **Step 1: Write the failing two-model test.**

Feed two assistant `message_end` events, first `anthropic/claude-sonnet-4-6`, then `openai-codex/gpt-5.4`, and assert:

```ts
expect(Object.keys(result.usageBreakdown ?? {})).toEqual([
  'anthropic/claude-sonnet-4-6',
  'openai-codex/gpt-5.4',
]);
expect(result.usageBreakdown?.['anthropic/claude-sonnet-4-6']?.kind).toBeUndefined();
expect(result.tokens).toEqual({
  input: 15,
  output: 9,
  total: 24,
  cost: 0.03,
});
expect(result.cost).toBe(0.03);
```

Use the same `numberField` / `assertUsage` rules as production.
Totals must match today's collapsed accumulation.

- [ ] **Step 2: Run the OMP event-parser tests and confirm FAIL.**

- [ ] **Step 3: Implement per-key accumulation.**

In `accumulateUsage`, after updating `this.tokens`, if `provider` and `model` are non-empty, merge one sanitized entry with `calls: 1`.
Store provider/model from `consumeMessageEnd` before calling `accumulateUsage`, or pass them in.

- [ ] **Step 4: Re-run OMP parser tests.**

Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git commit -m "feat(providers): accumulate OMP usageBreakdown per provider/model"
```

---

### Task 4: Pi Usage Semantics And Breakdown

**Files:**

- Modify: `packages/providers/src/community/pi/event-bridge.ts:101-194`
- Modify: colocated Pi event-bridge tests

**Interfaces:**

- Consumes: Pi `AssistantMessage.usage` and `responseModel` from the transcript already passed to `buildResultChunk(messages)`.
- Produces: `usageBreakdown` on `buildResultChunk`.
- Provider field is `'pi'` when the message has no upstream vendor string.
- Model field is `responseModel` when it is a non-empty string.
- If `responseModel` is missing, omit `usageBreakdown` entirely (tokens/cost on the result chunk stay).
- Do not add parameters for engine `node_id`, run id, or step name.
- Do not set `kind`.

- [ ] **Step 1: Verify Pi usage semantics against `@earendil-works/pi-coding-agent@0.80.6`.**

Read the installed type/docs for `AssistantMessage.usage` (prefer the package's `.d.ts` / README in `node_modules/@earendil-works/pi-coding-agent`).
If `node_modules` is unreadable, fetch the `0.80.6` source for `AssistantMessage`.

Decision rule:

- If usage is per-message: sum every assistant message in the transcript and split entries by `responseModel`.
- If usage is session-cumulative: keep the last assistant message for totals (today's behavior) and emit one breakdown entry from that last message.
- If still ambiguous, default to per-message sum (the known last-message under-count is the defect being fixed).

Record the decision in a short comment on `buildResultChunk` naming the file/version you read.
Do not cite this plan id in the comment.

- [ ] **Step 2: Write the failing multi-message fixture.**

Two assistant messages, different `responseModel` values, per-message usage `{input:1,output:1,cost.total:0.01}` each.
If Step 1 chose cumulative, the second message's usage should be the running total and the test expects one entry with that total.

- [ ] **Step 3: Run Pi event-bridge tests and confirm FAIL.**

- [ ] **Step 4: Implement.**

Include `cacheRead` / `cacheWrite` from Pi `Usage` when those fields are finite numbers on the typed `Usage` struct.

- [ ] **Step 5: Re-run tests and commit.**

```bash
git commit -m "feat(providers): emit Pi usageBreakdown from assistant usage"
```

---

### Task 5: Remaining Providers

**Files:**

- Modify: `packages/providers/src/grok/event-parser.ts:30-194` and `event-parser.test.ts`
- Modify: `packages/providers/src/codex/provider.ts:324-333,793-798` and the Codex result-chunk tests
- Modify: `packages/providers/src/community/opencode/session.ts` result yield (~257-275) and `multi-agent.ts` token fold (~342)
- Modify: `packages/providers/src/community/copilot/event-bridge.ts` terminal result in `bridgeSession`
- Qoder: no `usageBreakdown`

**Interfaces:**

- Grok: one entry, `provider: 'grok'`, `model` from the first `modelUsage` key if it is a non-empty string, else omit `usageBreakdown`.
- Tokens and `cost` stay as today.
- `calls` is `modelCalls` when that nested field is a finite number, otherwise `1`.
- Stop putting raw `modelUsage` on the result chunk.
- Codex: tokens-only entry, `provider: 'codex'`, `model` from `requestOptions.model` when it is a non-empty string, else omit breakdown.
- Do not invent `costUsd`.
- OpenCode: `provider: 'opencode'`, `model` from `latestAssistantInfo.modelID` when non-empty, include `costUsd` from `normalizeTokens` cost when finite.
- If multi-agent totals identify distinct `modelID`s, one entry per model; otherwise one entry.
- Copilot: tokens-only, `provider: 'copilot'`, `model` from `requestOptions.model` when non-empty, else omit breakdown.
- Qoder: assert the result chunk has no `usageBreakdown`.
- No provider in this task sets `kind` or estimated fields.

- [ ] **Step 1: Write one failing test per provider listed above.**

Grok uses the existing end-event fixture in `event-parser.test.ts` and asserts `usageBreakdown['grok/grok-build']` plus unchanged `cost: 0.25`.
Codex asserts tokens without `costUsd`.
OpenCode asserts `costUsd` from `info.cost`.
Copilot asserts tokens-only.
Qoder asserts `usageBreakdown` is undefined.

- [ ] **Step 2: Run each provider test file and confirm FAIL.**

- [ ] **Step 3: Implement the mappings.**

- [ ] **Step 4: Re-run those tests.**

Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git commit -m "feat(providers): emit usageBreakdown for Grok Codex OpenCode Copilot"
```

---

### Task 6: Engine Zod Schema For Persistence

**Files:**

- Create: `packages/workflows/src/schemas/usage-breakdown.ts`
- Create: `packages/workflows/src/schemas/usage-breakdown.test.ts`
- Modify: `packages/workflows/src/schemas/index.ts`
- Modify: `packages/workflows/package.json` test script to include `src/schemas/usage-breakdown.test.ts` in the existing `src/schemas.test.ts` invocation

**Interfaces:**

- Produces:

```ts
import { z } from '@hono/zod-openapi';
import type { ModelUsageEntry, UsageBreakdown } from '@archon/providers/types';

export const modelUsageEntrySchema = z.object({
  provider: z.string().min(1),
  model: z.string().min(1),
  input: z.number().finite(),
  output: z.number().finite(),
  cacheRead: z.number().finite().optional(),
  cacheWrite: z.number().finite().optional(),
  costUsd: z.number().finite().optional(),
  calls: z.number().int().finite(),
  kind: z.literal('advisor').optional(),
});

export const usageBreakdownSchema = z.record(z.string(), modelUsageEntrySchema);

export type ModelUsageEntryPersisted = z.infer<typeof modelUsageEntrySchema>;
export type UsageBreakdownPersisted = z.infer<typeof usageBreakdownSchema>;
```

`ModelUsageEntryPersisted` must be assignable to `ModelUsageEntry`.
The schema MUST reject unknown keys such as `costEstimatedUsd` (use Zod's default object strip or `.strict()` if sibling schemas are strict; match `dag-node` object strictness).
Do not add estimated fields to this schema.

- [ ] **Step 1: Write failing schema tests** that parse a valid two-key map, reject empty provider, reject `NaN` cost, reject a missing `calls` field, and assert a parsed Claude entry has no `kind`.

- [ ] **Step 2: Run `bun test src/schemas/usage-breakdown.test.ts` from `packages/workflows` and confirm FAIL.**

- [ ] **Step 3: Implement the schema file and re-export it from `schemas/index.ts`.**

- [ ] **Step 4: Re-run the schema test.**

Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git commit -m "feat(workflows): add usageBreakdown persistence schema"
```

---

### Task 7: AI-Node Accumulation And `node_completed` JSON

**Files:**

- Modify: `packages/workflows/src/dag-executor.ts:500-507,1970-2035,2270-2298,2656-2663,2900-2964`
- Modify: `packages/workflows/src/dag-executor.test.ts` (extend the existing cost tests around `passes total_cost_usd` / result-chunk handling)
- Modify every in-repo `IWorkflowStore` mock that lists `getDagResumeSnapshot` so it also has `replaceNodeUsageLedger: mock(() => Promise.resolve())` (no-op until Task 13)

**Interfaces:**

- Extend `NodeExecutionResult`:

```ts
type NodeExecutionResult = NodeOutput & {
  costUsd?: number;
  tokens?: TokenUsage;
  loopIterations?: number;
  usageBreakdown?: UsageBreakdown;
};
```

- Add `let nodeUsageBreakdown: UsageBreakdown | undefined` next to `nodeCostUsd`.
- Reset it to `undefined` at the start of `runStreamPass` (same list as `nodeCostUsd = undefined`).
- On `msg.type === 'result'`, if `msg.usageBreakdown` parses with `usageBreakdownSchema.safeParse`, merge it into a per-pass map.
- If parse fails or any entry is non-finite, WARN `dag_node.usage_breakdown_ignored` and drop that chunk's map.
- Also NaN-guard `msg.cost` the same way as tokens (`dag_node.usage_cost_non_finite_ignored`).
- Across reasks, merge per-pass maps into `accumulatedUsageBreakdown` the same way `accumulatedCostUsd` sums, then assign back onto `nodeUsageBreakdown`.
- Persist on `node_completed` data as `usage_breakdown` next to `cost_usd`, omitted when empty.
- Return it on `NodeExecutionResult`.
- Import `mergeUsageBreakdown` from `@archon/providers/types`.

- [ ] **Step 1: Write failing tests in `dag-executor.test.ts`.**

1. Two-model result persists both keys on `node_completed.data.usage_breakdown` and those objects have no `costEstimatedUsd`.
2. Reask: first pass map `{claude/a: 1 call}` then second pass `{claude/b: 1 call}` persists both, and a failed first pass does not leak after `runStreamPass` reset (mirror existing reask tests).
3. Non-finite `cost` is omitted and does not appear as `cost_usd`.

Until Task 12, `replaceNodeUsageLedger` may be a no-op mock.

- [ ] **Step 2: Run `bun test src/dag-executor.test.ts` from `packages/workflows` and confirm the new tests FAIL.**

- [ ] **Step 3: Implement accumulation and JSON persist.**

Do not write ledger rows yet.
Do not attach estimates to the JSON payload.

- [ ] **Step 4: Re-run the new tests plus the existing `total_cost_usd` tests.**

Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git commit -m "feat(workflows): accumulate usageBreakdown on AI nodes"
```

---

### Task 8: Loop And Loop-Group JSON Maps

**Files:**

- Modify: `packages/workflows/src/dag-executor.ts` loop totals (~4043, ~4210, ~4415, ~5062-5076, ~5938)
- Modify: `packages/workflows/src/dag-executor.test.ts` existing loop / loop_group COST tests (~13957, ~18710)

**Interfaces:**

- Add `loopTotalUsageBreakdown` beside `loopTotalCostUsd`.
- Merge each iteration's map with `mergeUsageBreakdown`.
- Charge once at the same sites that add `loopTotalCostUsd`.
- Single-node `loop:`: persist merged `usage_breakdown` on that node's `node_completed` (this node is the leaf).
- `loop_group:`: do **not** persist `usage_breakdown` on the group aggregate `node_completed` row (follow the #2333 token note: body rows are authoritative; putting an aggregate map on the group row would double-count any consumer that sums `node_completed`).
- The group `NodeExecutionResult` still returns the merged map so run-level JSON can include the group once (body results stay in the scoped iteration ctx and never enter `runCtx`).

- [ ] **Step 1: Write failing tests.**

1. Single-node loop, 3 iterations, same model, `calls === 3` and tokens/cost summed, one `node_completed` for the loop id.
2. `loop_group` two-iteration COST test: group `node_completed.data.usage_breakdown` is undefined; body `node_completed` rows exist.

- [ ] **Step 2: Run the loop cost tests and confirm FAIL.**

- [ ] **Step 3: Implement merge sites.**

- [ ] **Step 4: Re-run those tests.**

- [ ] **Step 5: Commit.**

```bash
git commit -m "feat(workflows): merge loop usageBreakdown maps"
```

---

### Task 9: Sub-Run JSON Rollup And Run Metadata

**Files:**

- Modify: `packages/workflows/src/dag-executor.ts` `childOutcomeFromRun` (~622-646), `asCompleted` (~6504-6561), fan-out `writeCompleted` (~6982), `RunLayersContext` (~7635), `runLayers` cost fold (~8787), `completeWorkflowRun` (~10181-10188)
- Modify: `packages/workflows/src/subrun.test.ts` D8 assertions (~538-552, ~2659-2670)
- Modify: `packages/workflows/src/dag-executor.test.ts` `passes total_cost_usd` / omit-when-empty tests

**Interfaces:**

- Extend `ChildWorkflowOutcome` with `usageBreakdown?: UsageBreakdown`.
- Read child `metadata.usage_by_model` via `usageBreakdownSchema.safeParse`.
- Merge child map into the parent `workflow:` node's JSON `usage_breakdown` (D8).
- Fan-out parent JSON merges children the same way as `sumFanOutCost`.
- Do not write parent ledger rows for children (Task 13).
- `runLayers` merges `output.usageBreakdown` into `ctx.usageByModel`.
- `completeWorkflowRun` metadata includes `usage_by_model` when the map is non-empty, omitted when empty (same style as `total_cost_usd`).
- Resume: `getDagResumeSnapshot` still rebuilds tokens from events and does not need to rebuild `usage_by_model`.
- Completed nodes are skipped, so their maps must not be merged again.
- Add a resume test: half-complete run, completed node had a breakdown, resumed remaining node adds a second model, final `usage_by_model` is the merge of both and the first node's calls are not doubled.

- [ ] **Step 1: Write failing tests** for sub-run merge, fan-out merge, omit-when-empty, resume no-double-count, and `usage_by_model ===` merge of top-level node maps (loop_group counted once via its return value, not via body events).

- [ ] **Step 2: Run `bun test src/subrun.test.ts` and the new dag-executor tests; confirm FAIL.**

- [ ] **Step 3: Implement rollup and metadata write.**

- [ ] **Step 4: Re-run those tests.**

- [ ] **Step 5: Commit.**

```bash
git commit -m "feat(workflows): persist run usage_by_model and sub-run rollup"
```

---

### Task 10: Ledger Table In Both Dialects

**Files:**

- Modify: `migrations/000_combined.sql` (CREATE TABLE in the tables section; indexes in the trailing indexes section)
- Modify: `packages/core/src/db/adapters/sqlite.ts` `createSchema()`
- Modify: `packages/core/src/db/adapters/sqlite.test.ts` (`MIN_NON_AUTH_COLUMNS` from 138 to 157)
- Modify: the migration header table count comment
- Modify: `packages/core/src/db/schema-version.ts` is not hand-bumped
- Run: `bun run generate:bundled-schema`

**Interfaces:**

PostgreSQL and SQLite table `remote_agent_usage_ledger`:

- `id` PK (text UUID, same default pattern as sibling tables)
- `created_at` timestamp not null default now
- `source` TEXT NOT NULL DEFAULT `'workflow'`
- `workflow_run_id` TEXT NULL
- `node_id` TEXT NULL
- `workflow_name` TEXT NULL
- `codebase_id` TEXT NULL
- `user_id` TEXT NULL
- `provider` TEXT NOT NULL
- `model` TEXT NOT NULL
- `kind` TEXT NULL
- `tokens_input` INTEGER NOT NULL
- `tokens_output` INTEGER NOT NULL
- `cache_read` INTEGER NULL
- `cache_write` INTEGER NULL
- `calls` INTEGER NOT NULL
- `cost_usd` REAL NULL
- `cost_estimated_usd` REAL NULL
- `pricing_source` TEXT NULL

Indexes (trailing section only in the Postgres migration):

- `(created_at)`
- `(codebase_id, created_at)`
- `(provider, created_at)`
- `(workflow_run_id)`

SQLite: matching `CREATE INDEX IF NOT EXISTS` next to other sqlite indexes inside `createSchema()`, not in a Postgres-only comment block.

- [ ] **Step 1: Write/extend sqlite parity tests** so a missing new table fails.
  Keep `POSTGRES_ONLY_COLUMNS` / `SQLITE_ONLY_COLUMNS` unchanged.
  Bump `MIN_NON_AUTH_COLUMNS` to 157 (19 new columns).

- [ ] **Step 2: Run `bun test src/db/adapters/sqlite.test.ts` from `packages/core` and confirm FAIL** on missing table / floor.

- [ ] **Step 3: Add the table and indexes to both dialects, then run `bun run generate:bundled-schema`.**

- [ ] **Step 4: Re-run sqlite tests and `bun run check:bundled-schema`.**

If Postgres is reachable, also run `bun run check:schema-upgrades`.
If it is not, record that as a remaining validation item; do not skip the sqlite parity tests.

- [ ] **Step 5: Commit including the generated bundled schema.**

```bash
git commit -m "feat(core): add remote_agent_usage_ledger table"
```

---

### Task 11: Pricing Config And Estimate Module

**Files:**

- Modify: `packages/core/src/config/config-types.ts` `GlobalConfig`, `RepoConfig`, `MergedConfig`
- Modify: `packages/core/src/config/config-loader.ts` to merge `pricing.models` (repo per-key overrides global)
- Create: `packages/core/src/usage/estimate.ts`
- Create: `packages/core/src/usage/estimate.test.ts`
- Modify: `packages/docs-web/src/content/docs/reference/configuration.md` to document `pricing:`
- Modify: `packages/core/package.json` test script to run `src/usage/estimate.test.ts` in a split that does not `mock.module` the Pi catalog

**Interfaces:**

```ts
export interface PricingModelRate {
  input: number;
  output: number;
  cacheRead?: number;
  cacheWrite?: number;
}

export interface PricingConfig {
  models?: Record<string, PricingModelRate>;
}

export type PricingSource = 'config' | 'catalog';

export interface UsageEstimate {
  costEstimatedUsd: number;
  pricingSource: PricingSource;
}

export function estimateUsageCost(input: {
  provider: string;
  model: string;
  tokensInput: number;
  tokensOutput: number;
  cacheRead?: number;
  cacheWrite?: number;
  pricing: PricingConfig | undefined;
  catalog: ReadonlyArray<{ id: string; ref: string; cost: { input: number; output: number } }>;
}): UsageEstimate | undefined;
```

Resolution order:

1. If the caller already has provider-reported `costUsd`, do not call this function.
2. Exact key match on `pricing.models[model]`, then `pricing.models[provider + '/' + model]`.
3. Exact catalog match on `id === model`, then `ref === provider + '/' + model`, then `ref === model`.
4. Else `undefined`.

Rates are USD per million tokens.
`cost = (input * rate.input + output * rate.output + cacheRead * rate.cacheRead + cacheWrite * rate.cacheWrite) / 1_000_000` using `0` for missing cache tokens and omitting cache terms when the rate has no cache field.

No fuzzy matching.
This module must not be imported by `@archon/providers`.

- [ ] **Step 1: Write failing estimate tests** for config hit, catalog hit, config-over-catalog, no match, and exact-ref match only.

- [ ] **Step 2: Run `bun test src/usage/estimate.test.ts` from `packages/core` and confirm FAIL.**

- [ ] **Step 3: Implement types, merge in `loadConfig`, and `estimateUsageCost`.**

`listPiModels()` is async and SDK-backed.
The estimate module must accept an already-loaded catalog array so unit tests never import the Pi SDK.

- [ ] **Step 4: Re-run estimate tests and existing `config-loader.test.ts`.**

- [ ] **Step 5: Commit.**

```bash
git commit -m "feat(core): add pricing overrides and usage estimate helper"
```

---

### Task 12: Ledger Replace/Query And Store Port

**Files:**

- Create: `packages/core/src/schemas/usage-ledger.ts`
- Create: `packages/core/src/db/usage-ledger.ts`
- Create: `packages/core/src/db/usage-ledger.test.ts`
- Modify: `packages/core/src/schemas/index.ts`
- Modify: `packages/workflows/src/store.ts`
- Modify: `packages/core/src/workflows/store-adapter.ts`
- Modify: `packages/core/src/workflows/store-adapter.test.ts` requiredMethods list
- Grep `replaceNodeUsageLedger` / `getDagResumeSnapshot` mock factories and add the method everywhere

**Interfaces:**

```ts
export interface ReplaceNodeUsageLedgerInput {
  workflowRunId: string;
  nodeId: string;
  workflowName: string | null;
  codebaseId: string | null;
  userId: string | null;
  breakdown: UsageBreakdown;
}

// IWorkflowStore
replaceNodeUsageLedger(input: ReplaceNodeUsageLedgerInput): Promise<void>;
```

Store adapter contract matches `createWorkflowEvent`: catch all errors, log WARN `usage.ledger_write_failed`, never throw.

Implementation:

1. `usageBreakdownSchema.safeParse`; on failure WARN and return.
2. `db.withTransaction`: `DELETE FROM remote_agent_usage_ledger WHERE workflow_run_id = $1 AND node_id = $2`.
3. For each entry, copy `entry.provider` / `entry.model` (never parse the key).
4. If `entry.costUsd` is a finite number, insert `cost_usd = entry.costUsd` and leave estimate null.
5. Else call `estimateUsageCost` with merged config pricing plus `listPiModels()` (catch catalog errors, treat as empty catalog).
6. Insert one row per entry with `source = 'workflow'`.

Do not merge maps in the adapter.
The engine passes the already-merged node map.

Query helper for Task 14 (same file):

```ts
export interface UsageLedgerQuery {
  from?: string;
  to?: string;
  codebaseId?: string;
  provider?: string;
  model?: string;
  kind?: string;
  runId?: string;
  groupBy: 'provider' | 'model' | 'project' | 'day' | 'none';
}

export interface UsageLedgerGroup {
  key: string;
  provider?: string;
  model?: string;
  codebaseId?: string;
  day?: string;
  tokensInput: number;
  tokensOutput: number;
  calls: number;
  costUsd: number | null;
  costEstimatedUsd: number | null;
  rowsMissingUsd: number;
}
```

`costUsd` in a group is the sum of non-null `cost_usd` only.
`costEstimatedUsd` is the sum of non-null `cost_estimated_usd` only.
Never add those two sums together in this helper.
`rowsMissingUsd` counts rows whose `cost_usd` and `cost_estimated_usd` are both null.

- [ ] **Step 1: Write failing tests** using the existing sqlite test DB helper:

1. Replace writes two entries then replace again with one entry; count for that node is 1.
2. Provider-reported cost leaves `cost_estimated_usd` null.
3. Tokens-only Codex-like entry plus a config price fills `cost_estimated_usd` and `pricing_source = 'config'`.
4. Adapter swallows insert errors (mock `query` throw) and does not reject.

- [ ] **Step 2: Run the new tests and confirm FAIL.**

- [ ] **Step 3: Implement schema, db module, adapter method, and mock updates.**

- [ ] **Step 4: Re-run those tests plus `store-adapter.test.ts`.**

- [ ] **Step 5: Commit.**

```bash
git commit -m "feat(core): replace usage ledger rows at node completion"
```

---

### Task 13: Engine Ledger Write Sites

**Files:**

- Modify: `packages/workflows/src/dag-executor.ts` AI-node success path, `executeLoopNode` completion, loop-group completion/failure charge paths
- Modify: `packages/workflows/src/dag-executor.test.ts`
- Modify: `packages/workflows/src/subrun.test.ts`

**Interfaces:**

Call `deps.store.replaceNodeUsageLedger` with the **same map** just persisted to JSON (one source, two sinks).

Write sites:

- `executeNodeInternal` success, when `usageBreakdown` is non-empty **and** `ctx.stepNamePrefix` is empty (not a loop-group body invocation).
- `executeLoopNode` success/failure that already writes `loopTotalCostUsd`, using the merged loop map and `stepName` as `nodeId`.
- `loop_group`: keep a `Map<string, UsageBreakdown>` keyed by namespaced body id (`stepNamePrefix + bodyNodeId`).
  After each iteration, merge that iteration's body `NodeExecutionResult.usageBreakdown` into the cumulative map.
  When the group completes **or** fails after charging, for each namespaced id with a non-empty cumulative map, call `replaceNodeUsageLedger` **once** with that cumulative map.
  Do not call replace from `executeNodeInternal` for body iterations (that would keep only the last iteration).
- Do not write ledger for `workflow:` parent nodes or fan-out parent nodes.
  Children write under their own `workflow_run_id`.

`nodeId` is the executor persisted step name (`<groupId>.<nodeId>` for body nodes).
Providers never see this `nodeId`.

- [ ] **Step 1: Write failing tests.**

1. AI node completion mock store receives one replace call whose `breakdown` equals `node_completed.data.usage_breakdown`.
2. Loop-group 3 iterations of body node `g.work` with 1 call each: after the group finishes, replace was called for `g.work` with `calls === 3` (not 1).
3. Sub-run: child store replace uses child run id; parent `workflow:` node does not insert parent-run ledger rows.
4. Resume of a completed node does not call replace again for that node.
5. Simulated retry: two replaces for the same `(runId, nodeId)` leave one set of rows (assert via a memory store that implements delete-on-replace).

Use an in-memory `replaceNodeUsageLedger` that records calls.
A true SQL idempotency test lives in Task 12.

- [ ] **Step 2: Run those tests and confirm FAIL.**

- [ ] **Step 3: Implement the write sites.**

Wrap each call in `.catch` only if the store contract could still throw from a bad mock; production adapter already swallows.

- [ ] **Step 4: Re-run engine tests.**

- [ ] **Step 5: Commit.**

```bash
git commit -m "feat(workflows): write usage ledger from accumulated node maps"
```

---

### Task 14: `GET /api/usage`

**Files:**

- Create: `packages/server/src/routes/schemas/usage.schemas.ts`
- Create: colocated server usage route tests (follow an existing `registerOpenApiRoute` test file under `packages/server/src/routes/`)
- Modify: `packages/server/src/routes/api.ts`
- Modify: `packages/server/src/routes/schemas/` index re-export if one exists
- After the route exists, regenerate `packages/web/src/lib/api.generated.d.ts` with `bun --filter @archon/web generate:types` while the server is running on the worktree port

**Interfaces:**

Query (all optional except that `group_by` defaults to `'provider'`):

- `from`, `to` (ISO timestamps)
- `codebase`
- `provider`
- `model`
- `kind`
- `run_id`
- `group_by`: `'provider' | 'model' | 'project' | 'day' | 'none'`

Response (`z.infer`, no parallel interface):

```ts
{
  groups: UsageLedgerGroup[];
  totals: {
    tokensInput: number;
    tokensOutput: number;
    calls: number;
    costUsd: number | null;
    costEstimatedUsd: number | null;
    rowsMissingUsd: number;
  };
}
```

Register with `registerOpenApiRoute`.
Do not mix estimated and reported USD in `totals.costUsd`.

- [ ] **Step 1: Write failing tests** for filter + each `group_by`, and for `run_id`.
  Mock the db query helper, do not open a real database.

- [ ] **Step 2: Run the server test file and confirm FAIL.**

- [ ] **Step 3: Implement schemas, handler, and OpenAPI registration.**

- [ ] **Step 4: Re-run tests.**

- [ ] **Step 5: Commit, including generated web types if the generator ran.**

```bash
git commit -m "feat(server): add GET /api/usage aggregates"
```

If `generate:types` cannot run because the server is not up, add a follow-up step in Task 16/17 that regenerates types before UI compile.

---

### Task 15: `archon usage` CLI

**Files:**

- Create: `packages/cli/src/commands/usage.ts`
- Create: `packages/cli/src/commands/usage.test.ts`
- Modify: `packages/cli/src/cli.ts` (`printUsage` and `main` dispatch)
- Modify: `packages/cli/package.json` test script: `&& bun test src/commands/usage.test.ts` as its own invocation
- Modify: `packages/docs-web/src/content/docs/reference/cli.md`

**Interfaces:**

```text
archon usage [--from <iso>] [--to <iso>] [--by provider|model|project] [--json]
```

`--by` maps to `group_by`.
Default `--by provider`.
`--json` prints the API/query helper result unchanged.
Human mode prints one line per group: key, calls, tokens in/out, reported USD or `n/a`, estimated USD prefixed with `≈` when present, and `N rows missing USD` on the totals line.

This command does **not** require a git repository.
It reads the Archon database.

- [ ] **Step 1: Write failing tests** for `--json` passthrough, default grouping, invalid `--by`, and human `≈` / `n/a` formatting.
  Mock the core query helper.

- [ ] **Step 2: Run `bun test src/commands/usage.test.ts` from `packages/cli` and confirm FAIL.**

- [ ] **Step 3: Implement command, dispatch, help, and docs.**

- [ ] **Step 4: Re-run the usage tests.**

- [ ] **Step 5: Commit.**

```bash
git commit -m "feat(cli): add archon usage command"
```

---

### Task 16: Run Detail Breakdown UI

**Files:**

- Modify: `packages/web/src/experiments/console/primitives/event.ts` and `event.test.ts`
- Modify: `packages/web/src/experiments/console/primitives/run.ts` and `run.test.ts`
- Create: `packages/web/src/experiments/console/components/UsageBreakdownTable.tsx`
- Create: `packages/web/src/experiments/console/components/UsageBreakdownTable.test.tsx` if the package already tests components with bun; otherwise test parsing in `event.test.ts` / `run.test.ts` and keep the table presentational
- Modify: `packages/web/src/experiments/console/components/RunDetailHeader.tsx`
- Modify: `packages/web/src/experiments/console/components/NodeDivider.tsx`
- Modify: `packages/web/src/experiments/console/lib/format.ts` (`formatCostApprox`)
- Modify: `packages/web/src/experiments/console/skills/` if run detail needs `GET /api/usage?run_id=`

**Interfaces:**

Parse `usage_breakdown` from node events and `usage_by_model` from run metadata with the same shape as the Zod schema (hand-rolled guards in the web primitive files; do not import `@archon/workflows`).

`UsageBreakdownTable` columns: model (`provider/model` key), calls, tokens in, tokens out, cache (blank if absent), cost.

Cost cell rules:

- Provider-reported `costUsd` → `formatCost(costUsd)` with no `≈`.
- Else if a ledger estimate is available for that key → `≈` + `formatCost(estimate)`.
- Else → `n/a` (never `$0.00`).

Advisor rows (`kind === 'advisor'`) render a text label `advisor` using existing brand tokens (`text-text-secondary`), no new colors.

Run header: table under the existing cost figure.
Node divider: collapsed by default, expandable, so the divider stays compact.

To honor estimated `≈` without putting estimates in JSON, fetch `GET /api/usage?run_id=<id>&group_by=none` once per run detail load.
If that request fails, show JSON-only costs and still never fabricate zeros.

Brand tokens only (`packages/web/src/index.css`).

- [ ] **Step 1: Write failing primitive tests** that read a two-model `usage_by_model` and an advisor node event.

- [ ] **Step 2: Run the console primitive tests and confirm FAIL.**

- [ ] **Step 3: Implement parsing, table, header, and divider.**

- [ ] **Step 4: Re-run those tests.**

- [ ] **Step 5: Commit.**

```bash
git commit -m "feat(web): show per-model cost breakdown on run detail"
```

---

### Task 17: Console Cost Page

**Files:**

- Create: `packages/web/src/experiments/console/routes/CostPage.tsx`
- Create: `packages/web/src/experiments/console/skills/usage.ts`
- Modify: `packages/web/src/experiments/console/ConsoleApp.tsx`
- Modify: `packages/web/src/experiments/console/components/ProjectRail.tsx` (add a Cost control next to Settings, linking to `/console/cost` or `/console/p/:projectId/cost`)
- Tests: skill/parser tests if other skills have them; otherwise a pure function extracting groups from the API payload

**Interfaces:**

Routes:

- `/console/cost`
- `/console/p/:projectId/cost` (sends `codebase=<projectId>`)

Page shows aggregates from `GET /api/usage` for the current month (`from`/`to` UTC month bounds) with toggles for `group_by` provider, model, and project.

Each group shows reported USD, estimated USD with `≈`, and the missing-USD count from totals.

Group keys that include a `run` dimension are not required.
Drill-down: if the API group represents a single run in a future revision, link to `/console/p/:projectId/r/:runId`.
For v1, link the project group to `/console/p/:projectId`.

- [ ] **Step 1: Write a failing skill test** that maps the API payload into view models distinguishing reported vs estimated vs missing.

- [ ] **Step 2: Run it and confirm FAIL.**

- [ ] **Step 3: Implement skill, page, routes, and rail link.**

- [ ] **Step 4: Re-run the skill test.**

- [ ] **Step 5: Commit.**

```bash
git commit -m "feat(web): add console Cost page"
```

---

### Task 18: OMP Advisor Transcript Capture

**Files:**

- Create: `packages/providers/src/community/omp/advisor-usage.ts`
- Create: `packages/providers/src/community/omp/advisor-usage.test.ts`
- Create fixture JSONL files under `packages/providers/src/community/omp/fixtures/`
- Modify: `packages/providers/src/community/omp/provider.ts` after the process exits and `buildResult` runs
- Modify: `packages/providers/package.json` test script to run `src/community/omp/advisor-usage.test.ts` in its own invocation

**Interfaces:**

```ts
export async function loadOmpAdvisorUsage(input: {
  sessionId: string | undefined;
  persistSession: boolean | undefined;
}): Promise<UsageBreakdown>;
```

Advisor entries set `kind: 'advisor'`.
Primary parser entries remain without `kind`.
Merge advisor maps in the OMP provider after process exit using `mergeUsageBreakdown`, not in core.

- [ ] **Step 1: Verify on-disk layout against the installed `omp` binary before writing production paths.**

Record the omp version (`omp --version` or package version).
Read oh-my-pi `advisor/transcript-recorder.ts` for the installed version if the source is available.
If the layout cannot be verified, default to: sibling `*.jsonl` files next to the session transcript named from the session id, excluding the main session file.
Keep every path rule inside `loadOmpAdvisorUsage` with a docblock naming the oh-my-pi file it mirrors.
Do not put layout knowledge in `event-parser.ts`.

- [ ] **Step 2: Write failing fixture tests.**

1. Two advisor transcripts present → two `kind: 'advisor'` entries with summed input/output/cache/cost.total.
2. Missing directory → empty map, no throw.
3. Unreadable file → WARN `omp.advisor_transcript_unreadable`, omit that advisor.
4. Malformed JSONL line → skip that line, keep other lines (mirror oh-my-pi tolerance).
5. `persistSession === false` (`--no-session`) → empty map without reading disk.

- [ ] **Step 3: Run `bun test src/community/omp/advisor-usage.test.ts` from `packages/providers` and confirm FAIL.**

- [ ] **Step 4: Implement the reader and merge into the OMP result `usageBreakdown` after process exit.**

Never fail the node.
Never write zero entries for missing advisors.

- [ ] **Step 5: Re-run advisor tests plus OMP provider tests.**

- [ ] **Step 6: Commit.**

```bash
git commit -m "feat(providers): include OMP advisor usage from transcripts"
```

Optional parallel non-blocking work: file an upstream oh-my-pi issue asking for advisor/fallback usage on the JSON stream.
Do not block this task on that issue.

---

### Task 19: Docs And Final Validation

**Files:**

- Modify: `packages/docs-web/src/content/docs/reference/cli.md` if Task 15 did not finish the page
- Modify: `packages/docs-web/src/content/docs/reference/configuration.md` for `pricing.models`
- Modify: `AGENTS.md` table count only if that file's table list is still "20 Tables" in this worktree; add `remote_agent_usage_ledger` as table 21 with a one-line description
- Do not edit `CHANGELOG.md`

- [ ] **Step 1: Add a short CLI section** covering `--from/--to/--by/--json`, `n/a`, `≈`, and that the command uses the DB (no git repo required).

- [ ] **Step 2: Document `pricing.models` exact-id matching, USD-per-million rates, and that estimates never enter `cost_usd` or JSON breakdowns.**

- [ ] **Step 3: Run validation.**

```bash
bun --filter @archon/providers test
bun --filter @archon/workflows test
bun --filter @archon/core test
bun --filter @archon/server test
bun --filter @archon/cli test
bun --filter @archon/web test
bun run generate:bundled-schema
bun run check:bundled-schema
bun run type-check
bun run lint
bun run validate
```

If PostgreSQL is reachable:

```bash
bun run check:schema-upgrades
```

Expected: all commands exit 0.

- [ ] **Step 4: Commit docs if they changed.**

```bash
git commit -m "docs: describe usage ledger reporting and pricing overrides"
```

---

## Testing Strategy

| Test file | Cases | Validates |
| --- | --- | --- |
| `packages/providers/src/usage-breakdown.test.ts` | merge, NaN drop, key format, no kind on ordinary entries | contract helper |
| `packages/providers/src/claude/provider.test.ts` | two SDK models, `kind` omitted | Claude mapping |
| OMP event-parser tests | two models, unchanged totals, `kind` omitted | OMP accumulation |
| Pi event-bridge tests | multi-message per Step 1 decision | Pi mapping |
| Grok/Codex/OpenCode/Copilot/Qoder tests | single entry or absence | remaining providers |
| `packages/providers/src/community/omp/advisor-usage.test.ts` | fixtures, WARN, `--no-session` | advisor capture |
| `packages/workflows/src/schemas/usage-breakdown.test.ts` | parse/reject | persistence schema |
| `packages/workflows/src/dag-executor.test.ts` | reask, loop, resume, ledger calls | engine JSON + writes |
| `packages/workflows/src/subrun.test.ts` | child JSON rollup, no parent ledger | D8 |
| `packages/core/src/usage/estimate.test.ts` | config/catalog/no-match | estimates |
| `packages/core/src/db/usage-ledger.test.ts` | replace idempotency, reported vs estimated | ledger |
| `packages/core/src/db/adapters/sqlite.test.ts` | parity + column floor 157 | schema |
| server usage route tests | filters and group_by | API |
| `packages/cli/src/commands/usage.test.ts` | `--json`, `≈`, `n/a` | CLI |
| console primitive tests | parse breakdown, never zero | UI |

### Edge Cases Checklist

- [ ] Empty `usageBreakdown` omitted from JSON and no ledger insert
- [ ] Non-finite token/cost/breakdown dropped with WARN
- [ ] Codex/Copilot tokens-only rows
- [ ] Qoder no breakdown
- [ ] Loop-group 3 iterations counted once in ledger
- [ ] Sub-run children billed under child run id only
- [ ] `workflow retry-node` replace semantics
- [ ] Resume does not double-count completed nodes
- [ ] Ledger write failure does not fail the node
- [ ] Advisor missing transcripts omit entries
- [ ] `--no-session` skips advisor files
- [ ] Catalog/config miss leaves both USD columns null and increments `rowsMissingUsd`
- [ ] Old runs without fields render "not recorded"
- [ ] JSON payloads contain no `costEstimatedUsd`

## Acceptance Criteria

- [ ] Agent node `node_completed` includes `usage_breakdown` keyed by `provider/model` with `provider` and `model` fields on each entry
- [ ] JSON breakdown entries have no estimated fields
- [ ] Ordinary provider entries omit `kind`; only OMP advisor transcripts set `kind: 'advisor'`
- [ ] Run metadata includes `usage_by_model` equal to the merge of top-level node maps (loop_group once, sub-run D8 JSON rollup included)
- [ ] `remote_agent_usage_ledger` has one cumulative row set per `(workflow_run_id, node_id)` for leaf AI nodes and loop-group body nodes
- [ ] Provider-reported USD never mixes with estimates
- [ ] Estimated USD is marked `≈` on Cost page, `archon usage`, and run detail when ledger estimates exist
- [ ] Codex/Copilot show tokens without fake USD; Qoder shows no usage map
- [ ] OMP fallback-chain models each appear; advisor cost is `kind: 'advisor'` or explicitly absent
- [ ] `GET /api/usage` filters and groups as specified, including optional `run_id`
- [ ] `archon usage --json` passes the aggregate payload through
- [ ] Console Cost page shows monthly aggregates with missing-USD counts
- [ ] `#2345` is not "fixed" and is not worsened
- [ ] `bun run validate` is green
- [ ] `bun run check:schema-upgrades` is green when Postgres is available

## Validation Commands

```bash
bun --filter @archon/providers test
bun --filter @archon/workflows test
bun --filter @archon/core test
bun --filter @archon/server test
bun --filter @archon/cli test
bun --filter @archon/web test
bun run generate:bundled-schema
bun run check:bundled-schema
bun run type-check
bun run lint
bun run validate
bun run check:schema-upgrades
```

Never run `bun test` from the repository root.

## Open Questions

1. **Ledger columns vs map keys.**
   The spec's `UsageBreakdown` values had no `provider`/`model`, but ledger columns require them and §5 forbids parsing the map key.
   **Default:** required `provider` and `model` on every `ModelUsageEntry`; the map key is display-only.

2. **Pi usage semantics.**
   **Default:** verify `@earendil-works/pi-coding-agent@0.80.6`; if still ambiguous, sum per assistant message.

3. **OMP advisor transcript layout.**
   **Default:** verify against the installed omp version; if unverified, read sibling JSONL files beside the session transcript and fail soft.

4. **Loop-group ledger vs repeated `node_completed`.**
   Body nodes reuse `<groupId>.<nodeId>` every iteration, so per-completion delete+insert would keep only the last iteration.
   **Default:** accumulate namespaced body maps and replace ledger rows once when the group finishes.

5. **Run-detail `≈` vs estimates not in JSON.**
   **Default:** `GET /api/usage?run_id=` supplies estimates to run detail; JSON remains provider-reported only.

6. **Cost page URL.**
   **Default:** `/console/cost` and `/console/p/:projectId/cost`.

7. **`archon usage` git requirement.**
   **Default:** no git repo required; the command reads the Archon DB.

8. **Catalog cache rates.**
   Pi catalog currently exposes `{input, output}` only.
   **Default:** apply cache rates only when `pricing.models` provides them; catalog estimates ignore cache tokens.

## Risks

| Risk | Likelihood | Impact | Mitigation |
| --- | --- | --- | --- |
| Pi usage is cumulative and summing double-counts | Med | High | Verify SDK before changing; fixture decides |
| OMP transcript layout drifts | Med | Med | One function, WARN+omit, no node failure |
| Loop-group ledger double-count or last-iteration-only | High | High | Write once from cumulative body maps; 3-iteration test |
| `IWorkflowStore` mock factories miss the new method and open a real DB | Med | High | Grep `getDagResumeSnapshot` factories in the same task |
| Schema upgrade index placement | Med | High | Trailing index section + `check:schema-upgrades` |
| Estimates leaking into `cost_usd` or JSON | Low | High | Separate ledger columns; schema/tests forbid estimated fields on entries |

## Spec Coverage

| Spec section | Task |
| --- | --- |
| Provider contract | 1–5 |
| Engine JSON flow | 7–9 |
| Ledger table | 10, 12–13 |
| Pricing | 11 |
| API / CLI / run detail / Cost page | 14–17 |
| OMP advisors | 18 |
| Absence/error posture | 1, 7, 12, 16, 18 |
| Non-goals | Global Constraints |
| Pi + advisor open items | Open Questions 2–3, Tasks 4 and 18 |
