---
title: 'Raw provider-owned effort passthrough'
type: 'bugfix'
created: '2026-07-18'
status: 'done'
baseline_commit: 'babcc88ad351e6efe0224b2e01c3f066a19df0f8'
spec_loop_iteration: 2
context:
  - '{project-root}/_bmad-output/project-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Workflow `modelReasoningEffort` is loaded but not propagated to DAG execution, while Archon also filters effort through provider-specific vocabularies. Codex can therefore fall back to its local default (for example `max`) instead of receiving the workflow value, and future provider values are rejected or dropped.

**Approach:** Carry one raw `effort` string through every Archon source and let each provider map it at its boundary: Claude SDK `effort`, Codex `modelReasoningEffort`, and Qoder CLI `--reasoning-effort`. Preserve legacy `modelReasoningEffort` inputs as fallbacks, with `effort` taking precedence.

## Boundaries & Constraints

**Always:** Preserve the exact non-empty string supplied by the user without trimming, normalization, or vocabulary validation. Apply precedence `node effort > workflow effort > workflow modelReasoningEffort (legacy) > tier/alias effort > provider legacy config > provider/SDK default`. Keep strict TypeScript annotations and document the narrow Codex SDK assertion needed because its union may lag the CLI/API vocabulary.

**Ask First:** Halt before changing the precedence, removing a legacy configuration key, or changing effort behavior for a provider beyond mapping the raw value to its existing provider option.

**Never:** Introduce a unified effort enum, translate values between provider vocabularies, silently drop an unknown value, or silently fall back after an explicitly supplied value is rejected by a provider.

## I/O & Edge-Case Matrix

| Scenario           | Input / State                                                     | Expected Output / Behavior                                                                  | Error Handling                                    |
| ------------------ | ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| Node override      | Codex node `effort: xhigh`; lower layers differ                   | Codex receives exactly `xhigh` as `modelReasoningEffort`                                    | Provider/CLI reports unsupported values unchanged |
| Workflow legacy    | No node/workflow `effort`; workflow `modelReasoningEffort: xhigh` | Effective raw effort is `xhigh`                                                             | No local vocabulary check                         |
| Preset passthrough | Tier or alias has a future value such as `ultra`                  | Provider receives exactly `ultra` through `nodeConfig.effort`                               | No warning/drop by engine, CLI, API, or UI        |
| Provider mapping   | Claude, Codex, or Qoder receives the same raw value               | It maps respectively to SDK `effort`, Codex `modelReasoningEffort`, or `--reasoning-effort` | Provider error is surfaced if invalid             |
| Missing effort     | No layer supplies effort                                          | Provider defaults remain in effect                                                          | No synthetic Archon default                       |
| Empty effort       | A persisted/API/CLI entry supplies `""`                           | Configuration is rejected as structurally invalid                                           | Clear validation error; no fallback               |

</frozen-after-approval>

## Code Map

- `packages/workflows/src/schemas/`, `loader.ts`, `model-validation.ts`, `dag-executor.ts` -- accept raw effort, resolve precedence, and emit the effective value.
- `packages/providers/src/types.ts`, `claude/`, `codex/`, `community/{qodercli,pi,copilot}/` -- provider-owned parsing and raw SDK/CLI translation while preserving separate legacy `thinking` semantics.
- `packages/core/src/orchestrator/orchestrator-agent.ts` -- direct-chat tier/alias passthrough.
- `packages/cli/src/commands/ai.ts`, `packages/server/src/routes/` -- settings validation without vocabulary ownership.
- `packages/web/src/experiments/console/`, `packages/web/src/routes/SettingsPage.tsx`, `packages/web/src/lib/api.generated.d.ts` -- all reachable free-text settings surfaces and regenerated API types.
- `book/` -- document raw provider-specific effort semantics and precedence.

## Tasks & Acceptance

**Execution:**

- [x] `packages/workflows/src/{schemas,loader.ts,model-validation.ts,dag-executor.ts}` -- replace effort enums/routing with raw-string resolution, legacy fallback, and unfiltered observability; reject unsupported provider capability explicitly rather than silently ignoring effort.
- [x] `packages/providers/src/{types.ts,claude,codex,community/{qodercli,pi,copilot}}` -- map raw node effort unchanged to each existing provider SDK/CLI field, retain provider legacy config fallbacks, preserve pre-change `thinking` precedence/validation, and log Qoder's effective resolved effort.
- [x] `packages/core/src/orchestrator/orchestrator-agent.ts` -- route preset effort uniformly through `nodeConfig.effort` and surface unsupported provider capability without silent fallback; update direct-chat tests.
- [x] `packages/cli/src/commands/ai.ts` and `packages/server/src/routes/` -- validate only provider identity plus non-empty string shape; prove future and exact whitespace-bearing values persist unchanged.
- [x] `packages/web/src/experiments/console/` and `packages/web/src/routes/SettingsPage.tsx` -- replace every reachable hardcoded effort selector/filter with free text, preserve exact values, and prevent hidden stale effort when switching to a provider without effort capability.
- [x] `packages/web/src/lib/api.generated.d.ts` and `book/` -- regenerate types and revise reference/authoring documentation.
- [x] `packages/**/**.test.*` -- lock the complete precedence chain, raw Claude/Codex/Qoder/Pi/Copilot boundary mapping, provider rejection without fallback, legacy workflow-run metadata compatibility, exact whitespace preservation, and Qoder effective-effort observability.

**Acceptance Criteria:**

- Given conflicting values at every layer, when a workflow node runs, then the documented precedence selects one exact raw string.
- Given an unknown non-empty effort value, when it crosses workflow, settings, API, UI, and provider layers, then Archon neither rewrites nor rejects it.
- Given an explicit invalid provider value, when the provider/CLI rejects it, then the original error is surfaced instead of falling back.
- Given legacy workflow or provider `modelReasoningEffort`, when no higher-priority `effort` exists, then existing configurations continue to work.
- Given an old workflow-run record, when it is read after the change, then its effort metadata remains compatible.

## Spec Change Log

- **Iteration 2 — adversarial review:** Reviewers found that the execution map omitted the reachable legacy `SettingsPage` and the existing Pi/Copilot effort adapters; the first derivation also changed Qoder's separate `thinking` precedence and logged its config default instead of the effective override. Expanded the Code Map and tasks to cover every reachable UI/provider boundary, preserve legacy `thinking` behavior, fail visibly for unsupported capabilities, and require full precedence/legacy/error/whitespace regression coverage. This avoids partial passthrough, hidden stale values, provider-side translation/drop, and Qoder compatibility regressions. **KEEP:** raw non-empty workflow schemas; node/workflow/legacy/preset/provider precedence; legacy `modelReasoningEffort` compatibility; Claude/Codex/Qoder provider-owned mapping; CLI/API free-string persistence; free-text console controls; generated OpenAPI types; documentation; green full validation.

## Design Notes

`nodeConfig.effort` is the provider-neutral transport field, not a shared semantic vocabulary. Translation happens once at each provider boundary; legacy provider config remains a lower-priority compatibility source.

## Verification

**Commands:**

- `bun run test` -- all package suites pass in their required isolated processes.
- `bun run validate` -- bundled checks, generated-schema checks, type-check, lint, formatting, and all tests pass.

## Suggested Review Order

**Resolution and compatibility**

- Start here: one explicit precedence chain selects the raw provider-owned value.
  [`dag-executor.ts:927`](../../packages/workflows/src/dag-executor.ts#L927)

- Raw non-empty node values replace the shared vocabulary without trimming.
  [`dag-node.ts:46`](../../packages/workflows/src/schemas/dag-node.ts#L46)

- Workflow `effort` and legacy `modelReasoningEffort` remain distinct compatibility inputs.
  [`workflow.ts:21`](../../packages/workflows/src/schemas/workflow.ts#L21)

- Observability records the selected raw value without legacy filtering.
  [`dag-executor.ts:363`](../../packages/workflows/src/dag-executor.ts#L363)

**Provider boundaries**

- Codex maps raw effort narrowly to `modelReasoningEffort` and rejects empty transport values.
  [`provider.ts:85`](../../packages/providers/src/codex/provider.ts#L85)

- Claude assigns the same raw transport value directly to SDK `effort`.
  [`claude/provider.ts:506`](../../packages/providers/src/claude/provider.ts#L506)

- Qoder preserves legacy thinking semantics while forwarding raw effort to its CLI flag.
  [`qodercli/provider.ts:143`](../../packages/providers/src/community/qodercli/provider.ts#L143)

- Pi keeps thinking shorthands separate from exact raw effort transport.
  [`options-translator.ts:99`](../../packages/providers/src/community/pi/options-translator.ts#L99)

- Copilot forwards raw effort while retaining its independent thinking precedence.
  [`copilot/provider.ts:121`](../../packages/providers/src/community/copilot/provider.ts#L121)

**Settings and direct chat**

- Direct-chat presets use the same transport and fail unsupported capabilities visibly.
  [`orchestrator-agent.ts:101`](../../packages/core/src/orchestrator/orchestrator-agent.ts#L101)

- CLI settings validate only provider identity and non-empty string shape.
  [`ai.ts:342`](../../packages/cli/src/commands/ai.ts#L342)

- Provider switches clear hidden effort when the target cannot honor it.
  [`ModelTiersPanel.tsx:162`](../../packages/web/src/experiments/console/components/ModelTiersPanel.tsx#L162)

- The production Codex setting is free text instead of a stale enum.
  [`SettingsPage.tsx:541`](../../packages/web/src/routes/SettingsPage.tsx#L541)

**Tests and guidance**

- The table-driven regression locks every precedence layer and whitespace behavior.
  [`dag-executor.test.ts:10461`](../../packages/workflows/src/dag-executor.test.ts#L10461)

- Provider mapping guidance documents raw values, failures, and separate thinking semantics.
  [`authoring-workflows.md:236`](../../packages/docs-web/src/content/docs/guides/authoring-workflows.md#L236)
