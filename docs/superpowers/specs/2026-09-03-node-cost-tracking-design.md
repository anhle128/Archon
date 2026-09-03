# Node Cost Tracking with Per-Model/Provider Breakdown and Usage Ledger

**Status:** approved design (user-validated 2026-09-03)
**Supersedes:** narrows/extends the draft plan at `plans/260903-1917-node-cost-model-breakdown/`

## Problem

When a workflow node calls an AI agent, the operator cannot see what that node cost broken down by model and provider. Totals exist (node `cost_usd`, run `total_cost_usd`), but:

- Per-model data is discarded at two points: the dag-executor never reads the provider `modelUsage` field, and the OMP event parser collapses per-message `provider`/`model` usage into one sum (`packages/providers/src/community/omp/event-parser.ts:260-263, 331-339`).
- OMP (oh-my-pi) advisor sessions spend money invisibly: advisors run in the `--mode json` Archon spawns (gated only on the user's `advisor.enabled` setting) but their usage never reaches the JSON stream — it lives in per-advisor transcript JSONL files.
- No cross-run reporting exists: "how much did project X spend on Claude this month?" is unanswerable without scanning every run's metadata JSON.

## Decisions (user-confirmed)

1. **Architecture A + C**: per-run JSON breakdown (event payload + run metadata) AND a queryable `remote_agent_usage_ledger` table, both fed from the same accumulated numbers.
2. **Scope v1 = workflow nodes only.** Ledger schema carries a `source` column so direct-chat spend can be added later without schema change.
3. **Estimated pricing for providers that report tokens but no USD** (Codex, Copilot): estimate from a catalog, stored in a separate column, always visually marked (`≈`). Provider-reported USD always wins and is never mixed with estimates.
4. **Reporting surfaces v1**: usage API endpoint + CLI command + a Cost page in the web console, plus per-node/per-run breakdown in Run detail.

## Current state (evidence)

- Provider `result` chunk contract already carries `tokens {input, output, total?, cost?}`, `cost`, `modelUsage?: Record<string, unknown>`, `resolvedModel` (`packages/providers/src/types.ts:230-283`).
- Node/run totals persisted: `node_completed` payload `cost_usd`/`tokens_in`/`tokens_out` (`packages/workflows/src/dag-executor.ts:2909-2941`); loop iteration summing (`~4211, ~5066`); `workflow:` sub-run rollup ("D8", `~554, ~6530`); run metadata `total_cost_usd`/`total_tokens_in`/`total_tokens_out` written once at run end (`~10184-10188`).
- Cost reporting per provider: **USD + per-model**: Claude (SDK `modelUsage` incl. fallbackModel; `selectResolvedModelId` currently collapses to highest-output model with a WARN, `claude/provider.ts:123-148, 1195`). **USD single**: Grok (`total_cost_usd`), OMP (accumulated `usage.cost.total`), Pi (`cost.total`, last assistant message only), OpenCode (`info.cost`, `opencode/tokens.ts:20`). **Tokens only**: Codex, Copilot. **Nothing**: Qoder.
- Pi under-count suspect: usage read from the last assistant message only (`pi/event-bridge.ts:163`); semantics vs. per-message accumulation must be verified against `@earendil-works/pi-coding-agent@0.80.6` before changing.
- OMP advisor findings (verified in oh-my-pi source, v18.0.4): advisors instantiated in `AgentSession` core (`agent-session.ts:1536-1537`), driven from `onPrimaryTurnEnd` (`:1249`) — they run in headless json mode. Advisor LLM usage is not emitted on the main stream (only notices and `retry_fallback_applied/succeeded`, `session-advisors.ts:946-963, 1323`). oh-my-pi itself reads advisor cost back from sibling transcript JSONL files (`advisor/transcript-recorder.ts:50-88`).
- Known adjacent issues: #2333 (loop-gate usage carried across pause, fixed), #2345 (usage lost across pause/resume gates, open), #2314 (never fabricate model attribution).

## Design

### 1. Architecture

One source, two sinks. Providers return a `usageBreakdown` map in the `result` chunk → dag-executor accumulates it per node (across retries, reasks, loop iterations) → on node completion the same numbers are written to:

- (a) `node_completed` event payload (`usage_breakdown`) and, at run end, run metadata (`usage_by_model`) — powers the per-run view;
- (b) flat rows in `remote_agent_usage_ledger` — powers cross-run reporting.

The two sinks must never be computed independently.

### 2. Provider contract

In `packages/providers/src/types.ts`, replace `modelUsage?: Record<string, unknown>` on the `result` variant with:

```ts
export interface ModelUsageEntry {
  input: number;
  output: number;
  cacheRead?: number;
  cacheWrite?: number;
  costUsd?: number;        // provider-reported only, never estimated
  calls: number;           // assistant turns attributed to this model
  kind?: 'advisor';        // set only when authoritative
}
export type UsageBreakdown = Record<string, ModelUsageEntry>; // key "<provider>/<model>"
```

Population: Claude maps SDK `modelUsage` entries (captures fallbackModel + subagent models; keep existing resolvedModel selection + WARN). OMP keys by the `${provider}/${model}` it already computes per `message_end` and accumulates per key (captures fallback-chain switches); the collapsed total remains for backward compat. Pi: verify per-message vs cumulative semantics first; if per-message, sum across assistant messages (fixes the under-count) and split entries by `responseModel`; include cache fields. Grok/OpenCode/Codex/Copilot: single entry from what each reports. Qoder: no breakdown. Update `observability.ts:142-143` which reads the old field shape.

### 3. Ledger table (additive, both dialects)

```
remote_agent_usage_ledger
  id                  PK
  created_at          timestamp
  source              TEXT NOT NULL DEFAULT 'workflow'   -- 'chat' reserved
  workflow_run_id     TEXT nullable   -- set for workflow rows; NULL reserved for future chat rows
  node_id             TEXT nullable   -- executor's persisted node identifier (loop_group: '<groupId>.<nodeId>')
  workflow_name       TEXT nullable
  codebase_id         nullable FK-style reference
  user_id             nullable
  provider            TEXT NOT NULL
  model               TEXT NOT NULL
  kind                TEXT nullable                      -- 'advisor'
  tokens_input        INTEGER NOT NULL
  tokens_output       INTEGER NOT NULL
  cache_read          INTEGER nullable
  cache_write         INTEGER nullable
  calls               INTEGER NOT NULL
  cost_usd            REAL nullable                      -- provider-reported only
  cost_estimated_usd  REAL nullable                      -- catalog/config estimate
  pricing_source      TEXT nullable                      -- 'catalog' | 'config'
```

- One row per (completed node × breakdown entry). Write at node completion.
- **Idempotency:** before insert, delete existing rows for `(workflow_run_id, node_id)` in the same transaction — makes `workflow retry-node` and resume re-execution report correctly (latest execution wins).
- Indexes: `(created_at)`, `(codebase_id, created_at)`, `(provider, created_at)`, `(workflow_run_id)` — placed in the trailing index section of `migrations/000_combined.sql` per the schema-upgrade ordering rule.
- Mirror into SQLite `createSchema()`; update the parity allowlists; run `bun run generate:bundled-schema`; `bun run check:schema-upgrades` must pass.
- Ledger write failure: WARN and continue — cost tracking must never fail a node.

### 4. Pricing estimation

Resolution order per entry: provider-reported `costUsd` (stored as `cost_usd`, authoritative) → `pricing:` override in `.archon/config.yaml` (optional operator-maintained entries) → Pi model catalog lookup (already in-repo: `packages/providers/src/community/pi/model-catalog.ts`, surfaced by `GET /api/providers/pi/models` with per-model cost) → none (fields stay NULL; reports count "N rows missing USD").

- Catalog match is **exact model id** only — no fuzzy matching (no-guess principle).
- Estimates are computed at ledger-write time from tokens (input/output, cache rates when the catalog provides them) and stored in `cost_estimated_usd` with `pricing_source`; they are never written into `cost_usd`, the JSON breakdown, or run totals.

### 5. Engine flow

- Accumulate `nodeUsageBreakdown` alongside the existing `nodeCostUsd`: reset per reask attempt (mirror `runStreamPass` resets), accumulate across attempts (mirror `accumulatedCostUsd`), NaN-guard identically (drop loudly, never persist non-finite).
- Loop nodes: merge iteration maps; charge once, following each existing `loopTotalCostUsd` write site and the #2333 double-count notes.
- Sub-runs (`workflow:` nodes): the child run writes its own ledger rows under its own run id (cross-run reports are correct by construction); the JSON view keeps the D8 rollup — child `usage_by_model` merges into the parent node's map.
- Fan-out children are independent child runs — same rule.
- #2345 (usage lost across pause/resume gates) is out of scope; completed-node ledger rows are unaffected. Documented limitation.
- Ledger keys are opaque strings to the engine; it never parses `provider/model` back apart — provider and model are carried as separate columns from the entry's origin.

### 6. Surfaces

- **Run detail (web console):** breakdown table under the existing cost figure — model, calls, tokens in/out, cache, cost; `≈` prefix for estimated values; advisor entries labelled. Node divider gets an expandable per-node version. Brand tokens only.
- **API:** `GET /api/usage` with `from`/`to`/`codebase`/`provider`/`model`/`kind`/`group_by` — Zod schemas via `registerOpenApiRoute`, shapes derived from the engine schema (`z.infer`, no parallel interfaces).
- **CLI:** `archon usage` with `--from/--to/--by provider|model|project` and `--json`.
- **Console Cost page:** monthly/project/provider/model aggregates from the API, real vs estimated USD distinguished, count of rows missing USD, drill-down links to run detail.
- Regenerate `packages/web/src/lib/api.generated.d.ts`; `@archon/web` never imports `@archon/workflows`.

### 7. OMP advisor capture

After the omp process exits, resolve the session's advisor transcripts from the `session` event id (layout verified against the installed omp version; baseline OMP 17.2.9 per `docs/superpowers/plans/2026-08-06-omp-cli-provider.md`), sum per-advisor assistant `usage` (input/output/cacheRead/cacheWrite/cost.total) + advisor model/provider, and emit `kind: 'advisor'` entries into the node's breakdown. All layout knowledge lives in one function documenting which oh-my-pi source it mirrors. Missing/unreadable/malformed transcripts: WARN (`omp.advisor_transcript_unreadable`) and omit — never fail the node, never write zeros. `--no-session` runs may have no transcripts; documented. Optional parallel track: upstream feature request to oh-my-pi for advisor/fallback usage in a stream event.

### 8. Absence and error posture

- No fabricated values anywhere: no $0 for unknown cost, no guessed model attribution, no estimated values in authoritative columns.
- Old runs and cost-less providers render "not recorded"/tokens-only, never zero.
- All failures in the cost path (ledger write, transcript read, catalog lookup) log WARN with context and let the node/run proceed.

### 9. Testing

- Provider units: OMP two-model fixture → two entries + unchanged total; Claude fallback fixture → two entries; Pi multi-message fixture (post semantics verification).
- Engine: reask isolation, loop merge charged once, sub-run rollup, run map = Σ node maps, resume no-double-count, retry-node ledger idempotency (old rows replaced).
- Schema: dialect parity tests, `check:schema-upgrades` on Postgres, migration statement ordering test.
- Surfaces: API filter/group_by units; CLI `--json` passthrough.
- All tests deterministic, no real DB/network in units (mock.module factory rules).

## Phases

1. Provider `usageBreakdown` (contract + 8 providers)
2. Engine accumulation + JSON persistence (payload + run metadata)
3. Ledger schema + write path + pricing module
4. API + CLI + run-detail breakdown UI
5. Console Cost page
6. OMP advisor capture

Dependencies: 2→1, 3→2, 4/5/6→3 (4, 5, 6 mutually independent).

## Non-goals

New budget/quota enforcement (existing `maxBudgetUsd` untouched); backfill of historical runs; per-user billing; chat-surface recording (schema-ready only); fixing #2345.

## Open items

- Pi usage semantics (per-message vs cumulative) — verify against `@earendil-works/pi` v0.80.6 source during phase 1; determines whether the accumulation fix applies.
- Advisor transcript on-disk layout for the omp version actually installed — verify during phase 6 before coding the reader.
