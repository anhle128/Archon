# Per-Node AI Cost Breakdown by Provider/Model

**Status:** planned (awaiting user approval to implement)
**Branch base:** dev

## Outcome

After an agent-calling node completes, Archon reports what it cost (USD + tokens) broken down per `(provider, model)` — including Claude `fallbackModel` usage, OMP fallback-chain models, and OMP advisor sessions — per node and rolled up per run (loops, retries, sub-runs included). Visible in Web UI, API, CLI.

## Current state (verified)

- Node `cost_usd`/`tokens_in`/`tokens_out` + run `total_cost_usd` already persisted (`packages/workflows/src/dag-executor.ts:2909-2941, 10184-10188`); loop summing + sub-run rollup exist.
- Per-model data exists at provider boundary but is discarded: Claude SDK `modelUsage` record dropped (executor never reads `msg.modelUsage`); OMP parser collapses per-message `provider`/`model` into one total (`packages/providers/src/community/omp/event-parser.ts:260-263, 331-339`).
- Cost USD reported by: Claude, Grok, OMP, Pi, OpenCode. Tokens-only: Codex, Copilot. Nothing: Qoder.
- Pi under-count suspect: usage read from last assistant message only (`packages/providers/src/community/pi/event-bridge.ts:163`).
- OMP advisors run in `--mode json` (gated on `advisor.enabled` setting) but their usage never reaches the JSON stream; cost lives in per-advisor transcript JSONL (oh-my-pi `session-advisors.ts`, `advisor/transcript-recorder.ts:50-88`).

## Design (accepted direction "A")

Typed usage-breakdown map, keyed `"<provider>/<model>"`:

```ts
{ input: number; output: number; cacheRead?: number; cacheWrite?: number;
  costUsd?: number; calls: number; kind?: 'advisor' }
```

- Providers populate what they authoritatively know; absence stays absence (no fabricated cost, no guessed kind — precedent #2314).
- dag-executor accumulates per node (reasks/retries/iterations), persists to `node_completed` payload (`usage_breakdown`) and run metadata (`usage_by_model`). Sub-run maps merge into parent (same path as existing D8 cost rollup).
- JSON metadata/payload only — no DB migration.

## Phases

| #   | Phase                                                                            | Depends on           |
| --- | -------------------------------------------------------------------------------- | -------------------- |
| 1   | [Provider usage breakdown](phase-01-provider-usage-breakdown.md)                 | —                    |
| 2   | [Engine accumulation + persistence](phase-02-engine-accumulation-persistence.md) | 1                    |
| 3   | [Surfaces: API, Web, CLI](phase-03-surfaces-api-ui-cli.md)                       | 2                    |
| 4   | [OMP advisor capture](phase-04-omp-advisor-capture.md)                           | 2 (independent of 3) |

## Acceptance criteria

1. Agent node completion event carries `usage_breakdown` per provider/model; loop/retry/reask usage summed; no double-count on resume (respects #2333 semantics; must not worsen #2345).
2. Run metadata carries merged `usage_by_model`; `workflow:` sub-runs merge into parent.
3. Web run detail shows per-node and per-run breakdown; CLI `workflow get/status --json` exposes it.
4. OMP node using a fallback chain shows every model used; advisor cost appears as `kind: 'advisor'` entries (phase 4) or is explicitly absent — never a fabricated zero.
5. Codex/Copilot rows show tokens with cost omitted; Qoder shows no usage data.
6. `bun run validate` green.

## Non-goals

Own pricing catalog; new budget/quota enforcement; backfill of historical runs; per-user billing.

## Unresolved questions

- Phase 4 path: transcript-read (self-contained today) vs upstream oh-my-pi event (cleaner long-term). Default = transcript-read; user may choose to also file the upstream request.
