# web-automation-test-pr — E2E for PR #71 (workflow usage/cost tracking)

Structure: full end-to-end USER STORY first, then EDGE CASES. Real Archon stack (frontend+backend+DB); the ONLY mock is the external AI provider (via a fake `getAgentProvider`). All facts read from source; not guessed.

## USER STORY (happy path, end to end)

A user runs a workflow whose node uses an AI agent, on a project. The agent consumes tokens; the provider returns a result carrying a usage breakdown. Archon records it (writes a `node_usage_recorded` event + INSERTs `remote_agent_usage_ledger` rows, atomically). The user opens `/console/cost`, and sees the run's cost — reported USD by provider, tokens, coverage.

Real flow exercised:
`run workflow → node AI pass → [MOCK external provider result+usage] → dag-executor finally → usageRecorder.recordWorkflowUsage → event + ledger INSERT (real DB) → GET /api/usage (real query) → Cost page render`

## REAL vs MOCKED

- **Real:** the workflow executor, the recorder, the DB insert + query, `/api/usage`, the Cost UI.
- **Mocked (only external):** the AI provider, injected at `WorkflowDeps.getAgentProvider`. The fake `IAgentProvider.sendQuery` yields a terminal `result` chunk with a chosen `usageBreakdown: ModelUsageEntry[]` (per scenario). Nothing else is faked; ledger rows are produced by the REAL recorder.
- **Gap this fills:** no existing test runs a real workflow through a provider and asserts real ledger rows (current tests mock the recorder, or the DB, or seed the ledger directly).

## EDGE CASES (derived from the story — grounded)

Provider matrix drives most of these (source: per-provider usage extraction):

- **E1 [P0] Provider reports cost** (claude/grok/pi/opencode/omp) — fake yields `costUsd` → ledger `cost_usd` set, `cost_estimated_usd` null → UI: **REPORTED $X**, ESTIMATED n/a.
- **E2 [P0] Provider tokens-only + priced** (codex/copilot, model has a config/catalog price) — fake yields tokens, no `costUsd` → recorder estimates via map → `cost_estimated_usd` + `pricing_source` → UI: **ESTIMATED $Y**, REPORTED separate.
- **E3 [P1] Provider tokens-only + UNPRICED** (codex/copilot, no matching price) — both cost columns null → UI: tokens shown, USD absent / counted under `rowsMissingUsd` (unpriced rows). This is the axis Codex/Copilot uniquely hit.
- **E4 [P1] OMP advisor pass** — fake yields a primary entry + an extra entry `kind:'advisor'` → **two ledger rows**; UI Kind filter = Advisor shows the advisor row distinctly.
- **E5 [P1] Subagent** (opencode/omp) — entry `kind:'subagent'` → ledger `kind='subagent'`; Kind filter = Subagent.
- **E6 [P1] Fallback model** — fake reports a model id different from the requested one → ledger `model` = the reported (fallback) model, no synthetic tag; UI groupBy=Model shows the real model used.
- **E7 [P0] No usage observed** — fake yields a result with NO usageBreakdown (or empty) → recorder writes NOTHING → UI: "No usage recorded" (missing ≠ $0.00).
- **E8 [P1] Multiple providers in one run** — two nodes, two providers → groupBy=Provider shows both groups; totals sum reported separately from estimated (never combined).
- **E9 [P2] Partial measures** — entry with some token fields null → UI missing-measures counters (`in/out/reason/cacheR/cacheW/req`) reflect the nulls.
- **Frontend-only states (lower prio, still valid):** filter no-match → `data-usage-state="filter-empty"` (≠ "No usage recorded"); `/api/usage` 500 → role=alert "not zero cost"; groupBy=Node without runId → client validation, no request.

## MOCKED EXTERNALS → verify-thirdparties-e2e-test-pr requirements

For each provider whose usage shape we fake, the backend must have a contract/e2e test proving the real SDK returns usage in that shape (so the fake is anchored):

- REQ-TP-<provider>: backend test asserting the provider's real usage extraction (costUsd vs tokens, model, kind) matches what the fake emits. Candidates to CHECK (not assume): per-provider tests under `packages/providers/src/**/*usage*`, `usage-breakdown` tests.

## OPEN RISKS (implementation)

1. **Injecting the fake in a SERVED instance:** the seam `WorkflowDeps.getAgentProvider` is confirmed at the type level, but a real `bun run start` builds `deps` via core `createWorkflowDeps()`. Need to confirm HOW the Web E2E swaps in the fake (env hook / registry registration / test-only deps override) — may be net-new plumbing, not just a function swap.
2. `/api/usage` cost precedence for rows with neither `cost_usd` nor `cost_estimated_usd` (Codex/Copilot unpriced) — confirm how the report presents them before asserting E3.
3. OMP advisor row normally comes from on-disk transcripts; the fake can emit a synthetic `kind:'advisor'` entry directly (bypassing OMP's file layout) — confirm the E2E prefers that shortcut.

## CRYSTALLIZE

→ `e2e/ui/usage-cost.spec.ts` (Playwright). Requires: the fake-provider injection (net-new) + `e2e/` package + Playwright (net-new).
