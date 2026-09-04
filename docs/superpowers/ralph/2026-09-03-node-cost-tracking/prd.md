# Workflow Node Usage and Cost Tracking Ralph PRD

Source plan: `docs/superpowers/plans/2026-09-03-node-cost-tracking.md`  
Derived slug: `2026-09-03-node-cost-tracking`

## Overview

Archon needs operational cost visibility for workflow AI execution. Operators must be able to answer which workflow run, node, Archon agent provider, upstream provider, and model consumed tokens or money, without changing workflow execution semantics or turning partial telemetry into false certainty.

The reviewed implementation plan is authoritative over the older product design where conflicts exist, especially around map-shaped identities, node-completion persistence, retry replacement, parent usage copying, speculative chat columns, and CLI flag naming (`docs/superpowers/plans/2026-09-03-node-cost-tracking.md:7-10`).

## Problem

Current workflow cost data is too coarse for trustworthy operations. A node can spend money and then fail, reask, retry, pause, resume, or run a loop iteration before any successful node-completion event exists (`docs/superpowers/plans/2026-09-03-node-cost-tracking.md:71-74`). Mutable per-node totals or parent rollups would erase failed/repeated spend or double-count child runs (`docs/superpowers/plans/2026-09-03-node-cost-tracking.md:75-80`).

The feature must preserve missingness: Archon must never invent usage, request counts, model attribution, or billed USD that an upstream SDK did not report (`docs/superpowers/plans/2026-09-03-node-cost-tracking.md:20-24`).

## Solution

Implement an additive normalized provider usage contract, capture one append-only usage event per usage-bearing provider stream pass, materialize a normalized ledger beside the audit event, add operator-only point-in-time pricing estimates, and expose direct-run usage through REST, CLI, run detail, and one console Cost page.

Providers normalize only what they observe; the workflow executor attaches run/node/agent-provider context; core owns persistence, pricing, and aggregate queries; server, CLI, and web consume one report contract (`docs/superpowers/plans/2026-09-03-node-cost-tracking.md:1355-1369`).

## Goals and Success Metrics

| Goal | Success metric | Evidence source |
| --- | --- | --- |
| Truthful provider usage capture | Every provider with authoritative usage emits `usageBreakdown` without fabricating absent fields | Provider contract and adapter tests from the plan matrix (`docs/superpowers/plans/2026-09-03-node-cost-tracking.md:1132-1148`) |
| Append-only pass accounting | Success, failure, reask, retry, loop, resume, and retry-node attempts remain queryable simultaneously | Workflow executor tests (`docs/superpowers/plans/2026-09-03-node-cost-tracking.md:1160-1174`) |
| Durable event-plus-ledger integrity | Normal path commits matching event/ledger rows atomically; fallback writes one detectable event-only record | Persistence tests (`docs/superpowers/plans/2026-09-03-node-cost-tracking.md:1176-1195`) |
| Separate reported and estimated cost | API, CLI, and web show reported USD, estimated USD, zero, sub-cent, and missing values distinctly | Query/API and CLI/web tests (`docs/superpowers/plans/2026-09-03-node-cost-tracking.md:1196-1227`) |
| Safe rollout | SQLite/PostgreSQL parity, generated schema, OpenAPI types, docs, validation, and schema-upgrade checks pass | Validation sequence (`docs/superpowers/plans/2026-09-03-node-cost-tracking.md:1303-1345`) |

## Non-Goals

- Direct-chat usage (`docs/superpowers/plans/2026-09-03-node-cost-tracking.md:49-52`).
- Per-user billing, quotas, chargeback, or invoice reconciliation (`docs/superpowers/plans/2026-09-03-node-cost-tracking.md:51-52`).
- Historical backfill (`docs/superpowers/plans/2026-09-03-node-cost-tracking.md:53-56`).
- New budget enforcement or `maxBudgetUsd` behavior (`docs/superpowers/plans/2026-09-03-node-cost-tracking.md:53-56`).
- Parent/child run-tree rollups (`docs/superpowers/plans/2026-09-03-node-cost-tracking.md:55-56`).
- Repricing historical rows when config or catalog changes (`docs/superpowers/plans/2026-09-03-node-cost-tracking.md:56`).
- New workflow YAML fields or expression-language behavior (`docs/superpowers/plans/2026-09-03-node-cost-tracking.md:57`).
- Speculative chat schema or unsupported Qoder usage fabrication (`docs/superpowers/plans/2026-09-03-node-cost-tracking.md:58-60`).

## Technical Context

- Provider contract: add `ModelSource`, `ModelUsageEntry`, `UsageBreakdown`, and `usageBreakdown?: UsageBreakdown` in `packages/providers/src/types.ts`; retain deprecated `modelUsage` compatibility data (`docs/superpowers/plans/2026-09-03-node-cost-tracking.md:167-206`).
- Provider normalizer: `packages/providers/src/usage-breakdown.ts` validates non-empty identities, safe integer token fields, positive requests, finite non-negative USD, source/model consistency, reasoning bounds, at least one numeric measure, zero preservation, and missing-as-undefined semantics (`docs/superpowers/plans/2026-09-03-node-cost-tracking.md:215-229`).
- Attribution axes: workflow recorder attaches `agentProvider`; provider usage entries carry upstream provider/model only; observability must never guess the main model from a multi-model usage array (`docs/superpowers/plans/2026-09-03-node-cost-tracking.md:231-265`).
- Provider mappings: Claude, Pi, Codex, Grok, OMP primary, OpenCode, Copilot, and Qoder behavior is fixed by the mapping section (`docs/superpowers/plans/2026-09-03-node-cost-tracking.md:266-382`).
- OMP enrichment: implement `packages/providers/src/community/omp/session-usage.ts` for primary, advisor, task-subagent, recursive/nested transcript usage with byte-delta resume/fork safety and strict read bounds (`docs/superpowers/plans/2026-09-03-node-cost-tracking.md:384-443`).
- Workflow usage event: add internal `node_usage_recorded`, strict workflow schemas, snake_case persisted payload, validated boundary filtering, and no event copy into `node_completed`, run metadata, external outbox, or dashboard source types (`docs/superpowers/plans/2026-09-03-node-cost-tracking.md:444-501`).
- Recorder and executor: add narrow `IWorkflowUsageRecorder` in `packages/workflows/src/usage.ts`, wire through `WorkflowDeps`, implement core recorder in `packages/core/src/workflows/usage-recorder.ts`, and record exactly once at the standard AI pass and direct-loop pass sites (`docs/superpowers/plans/2026-09-03-node-cost-tracking.md:502-546`).
- Ledger schema: add `remote_agent_usage_ledger` with exactly 17 columns, event FK ownership, constraints, indexes, dialect parity, generated bundled schema, and database inventory updates (`docs/superpowers/plans/2026-09-03-node-cost-tracking.md:547-600`).
- Atomic write path: `insertWorkflowEvent()` accepts caller ids, normal recorder inserts one event plus all rows in one transaction, and a duplicate-safe fallback writes a single event-only record without failing workflow execution (`docs/superpowers/plans/2026-09-03-node-cost-tracking.md:602-636`).
- Pricing: add global-only `pricing.models` in `GlobalConfig`, exact provider/model matching, reported-cost precedence, Pi catalog fallback, no repository pricing, no fuzzy matches, no partial estimates, and ledger-only materialized estimates (`docs/superpowers/plans/2026-09-03-node-cost-tracking.md:638-711`).
- Query/API: add core `usageReportSchema`, `GET /api/usage`, fixed filters/groups/defaults/limits, nullable sums, missing counts, separate reported/estimated USD, conservative ledger coverage, safe numeric conversion, and parameterized SQL (`docs/superpowers/plans/2026-09-03-node-cost-tracking.md:713-830`).
- Run detail: add nullable `usage` to `workflowRunDetailSchema`, query the direct run by node, return `usage: null` on usage-query failure, and never include child usage (`docs/superpowers/plans/2026-09-03-node-cost-tracking.md:832-847`).
- CLI: add top-level `archon usage` with `--since`/`--until`, not `--from`/`--to`; add to `noGitCommands`; reuse core query; distinguish reported, estimated, zero, sub-cent, and absent values (`docs/superpowers/plans/2026-09-03-node-cost-tracking.md:849-883`).
- Console: add one `/console/cost` route, one usage skill, one breakdown table, generated API types, explicit cache keys, UTC date-only controls, direct-run usage labels, failed-node usage, and a system mapping for `node_usage_recorded` (`docs/superpowers/plans/2026-09-03-node-cost-tracking.md:885-936`).
- Testing and validation: implementation sequence, test matrix, global acceptance criteria, validation commands, compatibility, rollout, and rollback are prescribed by plan lines `938-1345` and `1228-1276`.

## Story Overview

| Priority | Story | Title | Depends on | Plan anchors |
| --- | --- | --- | --- | --- |
| 1 | US-001 | Provider usage contract and normalizer | - | 167-265, 940-960, 1132-1138 |
| 2 | US-002 | Normalize SDK-native providers | US-001 | 268-332, 962-980, 1139-1148 |
| 3 | US-003 | Normalize community SDK providers and Pi catalog | US-001 | 287-300, 344-376, 680-682, 962-980 |
| 4 | US-004 | Enrich OMP transcript usage safely | US-001 | 334-343, 384-443, 981-996, 1150-1159 |
| 5 | US-005 | Add usage event schemas and event type | US-001 | 444-501, 997-1017 |
| 6 | US-006 | Add ledger schema and dialect parity | US-005 | 547-600, 997-1017 |
| 7 | US-007 | Implement global pricing estimates | US-003, US-006 | 638-711, 1018-1043, 1176-1195 |
| 8 | US-008 | Implement recorder port and atomic writes | US-005, US-006, US-007 | 502-530, 602-636, 1018-1043 |
| 9 | US-009 | Implement usage report query | US-006, US-008 | 713-830, 1018-1043, 1196-1212 |
| 10 | US-010 | Record every workflow AI pass | US-001, US-008 | 532-546, 1045-1060, 1160-1174 |
| 11 | US-011 | Add REST usage and run detail contracts | US-009 | 713-847, 1062-1078 |
| 12 | US-012 | Add the archon usage CLI | US-009 | 849-883, 1080-1095, 1213-1220 |
| 13 | US-013 | Add console Cost page and run-detail usage | US-011 | 885-936, 1097-1112, 1221-1227 |
| 14 | US-014 | Document and complete final verification | US-002, US-003, US-004, US-010, US-011, US-012, US-013 | 1114-1128, 1228-1345 |
| 15 | US-015 | Stop guessing Claude resolved model | US-001, US-002 | 253-265, 270-285, 1417-1446 |
| 16 | US-016 | Validate usage at workflow boundaries | US-005, US-010, US-015 | 444-454, 532-546, 1448-1477 |
| 17 | US-017 | Preserve provider-reported missingness | US-003, US-004, US-016 | 215-225, 287-300, 322-342, 334-343, 384-443, 1479-1512 |
| 18 | US-018 | Harden OMP hidden-session discovery | US-004, US-017 | 384-443, 1514-1548 |
| 19 | US-019 | Keep pricing identity structured | US-007, US-018 | 653-711, 1550-1577 |
| 20 | US-020 | Aggregate every node ledger group | US-013, US-019 | 885-936, 928-930, 1579-1609 |
| 21 | US-021 | Render coverage before empty states | US-013, US-020 | 913-927, 1611-1642 |
| 22 | US-022 | Label full human grouping tuples | US-012, US-013, US-021 | 749-761, 849-881, 1644-1672 |
| 23 | US-023 | Enforce RFC3339 usage ranges | US-009, US-011, US-012, US-013, US-022 | 725-747, 905-908, 1674-1707 |
| 24 | US-024 | Run post-convergence validation | US-023 | 1303-1345, 1709 |
| 25 | US-025 | Do not fabricate OpenCode request counts | US-002, US-017, US-024 | 215-225, 344-358, 1715-1743 |
| 26 | US-026 | Finish OMP hidden-session ownership and bounded streaming | US-018, US-025 | 384-443, 1514-1548, 1745-1776 |
| 27 | US-027 | Make every terminal result replace workflow pass state | US-016, US-026 | 444-454, 532-546, 1448-1477, 1778-1806 |
| 28 | US-028 | Preserve fractional RFC3339 boundaries in SQLite reports | US-023, US-027 | 725-747, 1196-1208, 1808-1835 |
| 29 | US-029 | Return one coherent usage-report snapshot | US-009, US-028 | 713-830, 1196-1212, 1837-1864 |
| 30 | US-030 | Derive web usage request contract from generated OpenAPI types | US-013, US-029 | 899-900, 917-919, 1866-1895 |
| 31 | US-031 | Run post-Convergence 2 validation | US-030 | 1303-1345, 1897 |
| 32 | US-032 | Isolate SQLite transactions from unrelated queries | US-008, US-029, US-031 | 1903-1936 |
| 33 | US-033 | Recognize only exact OMP main transcripts | US-026, US-032 | 1938-1966 |
| 34 | US-034 | Preserve OpenCode usage across late failures | US-025, US-033 | 1968-1998 |
| 35 | US-035 | Preserve Copilot usage across late sendAndWait rejects | US-003, US-010, US-034 | 2000-2030 |
| 36 | US-036 | Preserve OMP and Grok usage across transport failures | US-002, US-004, US-035 | 2032-2063 |
| 37 | US-037 | Make coverage UI truthful for filters and node scope | US-013, US-021, US-022, US-036 | 2065-2095 |
| 38 | US-038 | Reject malformed pricing before estimation | US-007, US-019, US-037 | 2097-2126 |
| 39 | US-039 | Run post-Convergence 3 validation | US-038 | 1303-1345, 2128 |
| 40 | US-040 | Preserve OpenCode usage across raw stream failures | US-034, US-039 | 2134-2164 |
| 41 | US-041 | Reject calendar-impossible OMP main transcript names | US-033, US-040 | 2166-2193 |
| 42 | US-042 | Follow OMP task ownership recursively through task transcripts | US-026, US-041 | 2195-2225 |
| 43 | US-043 | Reject usage instants beyond lossless precision | US-023, US-028, US-042 | 2227-2261 |
| 44 | US-044 | Keep partial coverage distinct from filter misses | US-037, US-043 | 2263-2292 |
| 45 | US-045 | Separate GET usage and run-detail nullability | US-011, US-030, US-044 | 2294-2326 |
| 46 | US-046 | Bound OMP directory enumeration before entry allocation | US-042, US-045 | 2328-2355 |
| 47 | US-047 | Preserve reported zero in legacy totals and fallbacks | US-010, US-013, US-017, US-046 | 2357-2390 |
| 48 | US-048 | Justify or remove unrelated bundled-workflow test changes | US-047 | 2392-2421 |
| 49 | US-049 | Run post-Convergence 4 validation | US-048 | 1303-1345, 2423 |

## Ralph Execution Notes

- Implement exactly one story per fresh-context Ralph iteration.
- Do not start a story until every `dependsOn` story has `passes: true`.
- Keep the implementation additive: no provider contract deletion, no schema drops/renames, no parent rollup, no backfill, no new YAML fields.
- Each story's acceptance criteria are pass/fail and derived from the plan's TDD matrix.
- Story-level `passes` values start as `false` and are updated only by the Ralph loop after verification.
