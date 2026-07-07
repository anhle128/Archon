---
title: 'Add qodercli Provider'
type: 'feature'
created: '2026-07-07T00:00:00+07:00'
status: 'done'
baseline_commit: '88a17e833443d407793de9e61c91b5dfe5c1dff2'
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Archon can run Claude Code, Codex, Pi, Copilot, and OpenCode providers, but it cannot use the locally installed `qodercli` agent.
Users who already authenticate Qoder locally need to select `qodercli` in Archon config, workflows, tiers, and aliases the same way they select `codex` or `claude`.

**Approach:** Add a bundled community provider with id `qodercli` that invokes the installed `qodercli` binary in non-interactive print mode.
The provider must pass through configurable `model` and reasoning level, support session IDs when possible, and integrate with Archon's provider registry, config, model-effort validation, docs, and tests.

## Boundaries & Constraints

**Always:** Preserve existing Claude/Codex behavior and the existing uncommitted web changes.
Keep the provider localized under `packages/providers/src/community/qodercli/` except for registry, config exposure, model-effort validation, package script, and docs touchpoints.
Use typed TypeScript only, no `any`, and fail with clear errors when `qodercli` is missing, not executable, not logged in, or exits non-zero.
Use the locally observed CLI contract from `qodercli 1.0.38`: `--print`, `--cwd`, `--model`, `--reasoning-effort`, `--permission-mode`, `--resume`, `--session-id`, `--fork-session`, `--output-format`, `--system-prompt`, `--mcp-config`, and `--setting-sources`.

**Ask First:** Ask before adding Archon-managed Qoder credential storage, a new Qoder OAuth/login flow, UI-specific Qoder credential readiness detection, or support for cloud remote Qoder sessions.
Ask before making Qoder a core built-in provider instead of a bundled community provider.

**Never:** Do not call a real Qoder model in tests.
Do not edit `CHANGELOG.md` or generated files unless an existing validation command proves regeneration is required.
Do not rely on shell string concatenation for subprocess execution.
Do not silently ignore requested model or reasoning config when the provider can validate or route it.

## I/O & Edge-Case Matrix

| Scenario               | Input / State                                                                                | Expected Output / Behavior                                                                                             | Error Handling                                                                     |
| ---------------------- | -------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Configured run         | `provider: qodercli`, `model: <literal>`, and `effort: high` or `modelReasoningEffort: high` | Spawn `qodercli --print --cwd <cwd> --model <model> --reasoning-effort high ...` and stream stdout as assistant chunks | Non-zero exit yields a terminal error chunk with stderr/stdout preview             |
| Missing binary         | No `qodercli` on PATH and no configured binary path                                          | Provider invocation fails before spawn with install/config instructions                                                | Error names `QODERCLI_BIN_PATH` and `assistants.qodercli.qodercliBinaryPath`       |
| Not logged in          | `qodercli status -o json` reports `logged_in: false` or the run exits with login text        | User sees an actionable login error                                                                                    | Message tells user to run `qodercli login`                                         |
| Structured output node | Workflow node declares `output_format`                                                       | Provider augments the prompt and parses final stdout with the shared best-effort parser                                | If parsing fails, downstream best-effort validation/reask behavior handles failure |
| Resume requested       | Archon passes `resumeSessionId`                                                              | Provider invokes `--resume <id>` and returns a result chunk stamped with the same session id                           | If Qoder rejects the resume, surface failure rather than silently starting cold    |

</frozen-after-approval>

## Code Map

- `packages/providers/src/types.ts` -- Defines provider-default config shapes and shared provider contracts.
- `packages/providers/src/registry.ts` -- Registers bundled community providers via a single aggregator.
- `packages/providers/src/community/copilot/*` -- Closest CLI-backed community-provider pattern for config parsing, binary resolution, registration, and tests.
- `packages/providers/src/shared/structured-output.ts` -- Existing best-effort JSON prompt and parser utilities for non-native structured output.
- `packages/workflows/src/model-validation.ts` -- Routes tier/alias `effort` values to provider-specific fields and validates provider effort vocabularies.
- `packages/core/src/config/config-loader.ts` -- Safely exposes non-sensitive assistant defaults in `/api/config`.
- `packages/providers/package.json` -- Explicit provider test list and package exports.
- `packages/docs-web/src/content/docs/getting-started/ai-assistants.md` -- User-facing assistant setup and capability documentation.

## Tasks & Acceptance

**Execution:**

- [x] `packages/providers/src/types.ts` -- add `QoderCliProviderDefaults` with `model`, `modelReasoningEffort`, `qodercliBinaryPath`, `configDir`, `permissionMode`, `outputFormat`, `settingSources`, and optional `mcpConfig` fields -- keeps config typed at the provider boundary.
- [x] `packages/providers/src/community/qodercli/config.ts` -- parse and validate Qoder assistant defaults -- keeps malformed config from crashing provider registration.
- [x] `packages/providers/src/community/qodercli/binary-resolver.ts` -- resolve an executable from `QODERCLI_BIN_PATH`, config, canonical local paths, or PATH -- gives compiled and source runs deterministic failure modes.
- [x] `packages/providers/src/community/qodercli/capabilities.ts` and `registration.ts` -- declare conservative capabilities and idempotently register `qodercli` -- integrates with `/api/providers` and workflow validation.
- [x] `packages/providers/src/community/qodercli/provider.ts` -- spawn `qodercli` with argv arrays, merge request env, stream stdout/stderr safely, map model/reasoning/session options, support abort, and parse best-effort structured output -- implements the provider.
- [x] `packages/providers/src/community/qodercli/*.test.ts` -- cover config parsing, binary resolution, argv construction, streaming, non-zero exit, abort, structured output, and registration -- avoids live Qoder calls.
- [x] `packages/providers/src/registry.ts` and `packages/providers/src/registry.test.ts` -- add `registerQoderCliProvider()` to the community aggregator and assertions -- keeps provider discovery complete.
- [x] `packages/workflows/src/model-validation.ts` and tests -- treat `qodercli` reasoning effort like Qoder's `--reasoning-effort` vocabulary and route tier/alias `effort` to `modelReasoningEffort` -- makes model tiers configurable.
- [x] `packages/core/src/config/config-loader.ts` and relevant config tests -- expose only safe Qoder config fields (`model`, `modelReasoningEffort`, `permissionMode`, `outputFormat`) -- avoids leaking local paths.
- [x] `packages/providers/package.json` -- export the Qoder provider subpath if useful and add Qoder tests to the explicit test script -- keeps package checks running.
- [x] `packages/docs-web/src/content/docs/getting-started/ai-assistants.md` -- document setup, sample config, capabilities, and the `qodercli login` auth boundary -- makes the new provider discoverable.

**Acceptance Criteria:**

- Given `qodercli` is registered, when workflow validation sees `provider: qodercli`, then it accepts the provider id and includes it in provider lists.
- Given `assistants.qodercli.model` and `assistants.qodercli.modelReasoningEffort` are configured, when `sendQuery()` runs, then the spawned command includes `--model` and `--reasoning-effort` with those values unless overridden by request model or routed tier effort.
- Given a tier or alias resolves to `{ provider: 'qodercli', model, effort: 'high' }`, when the workflow runs, then the effort routes to Qoder reasoning instead of being dropped.
- Given the Qoder binary is absent or the user is not logged in, when the provider is invoked, then the user receives a clear actionable error and no silent fallback provider is used.
- Given a node declares `output_format`, when Qoder returns parseable JSON text, then the result chunk includes `structuredOutput`.
- Given provider tests run with mocked child processes, when no live Qoder account exists, then tests still pass deterministically.

## Design Notes

Qoder auth should stay outside Archon credential storage in v1 because the local CLI already owns `qodercli login` and `qodercli status -o json`.
The provider can declare an empty static credential catalog initially, then surface login failures from the runtime path.
This avoids adding a fake OAuth surface that Archon cannot actually complete.

Use `qodercli --print` instead of interactive mode so workflow and chat calls terminate predictably.
Prefer `--permission-mode bypass_permissions` as the Archon default unless the user config overrides it, matching the non-interactive trust model already used by Claude and Codex providers.

## Verification

**Commands:**

- `bun test packages/providers/src/community/qodercli/config.test.ts` -- expected: parser tests pass.
- `bun test packages/providers/src/community/qodercli/binary-resolver.test.ts` -- expected: resolver tests pass without requiring the real binary.
- `bun test packages/providers/src/community/qodercli/provider.test.ts` -- expected: mocked subprocess tests pass.
- `bun test packages/providers/src/registry.test.ts` -- expected: community provider aggregation includes `qodercli`.
- `bun test packages/workflows/src/model-validation.test.ts` -- expected: Qoder effort routing and validation pass.
- `bun --filter @archon/providers test` -- expected: provider package passes.
- `bun run type-check` -- expected: strict TypeScript passes.

## Suggested Review Order

**Provider Runtime**

- Entry point wires config parsing, preflight, spawning, streaming, and result handling.
  [`provider.ts:397`](../../packages/providers/src/community/qodercli/provider.ts#L397)

- Argument builder maps Archon options onto the observed Qoder CLI contract.
  [`provider.ts:184`](../../packages/providers/src/community/qodercli/provider.ts#L184)

- Status preflight fails fast for logged-out, hung, or cancelled Qoder sessions.
  [`provider.ts:305`](../../packages/providers/src/community/qodercli/provider.ts#L305)

- Binary resolution honors env, config, vendor paths, autodetect paths, and PATH.
  [`binary-resolver.ts:109`](../../packages/providers/src/community/qodercli/binary-resolver.ts#L109)

**Provider Registration And Config**

- Typed defaults define every supported Qoder assistant setting.
  [`types.ts:84`](../../packages/providers/src/types.ts#L84)

- Parser rejects malformed supported fields before spawning an external CLI.
  [`config.ts:101`](../../packages/providers/src/community/qodercli/config.ts#L101)

- Capabilities declare the supported community-provider surface explicitly.
  [`capabilities.ts:7`](../../packages/providers/src/community/qodercli/capabilities.ts#L7)

- Registration keeps Qoder community-scoped with local CLI auth ownership.
  [`registration.ts:11`](../../packages/providers/src/community/qodercli/registration.ts#L11)

- Community aggregation makes provider discovery and validation see qodercli.
  [`registry.ts:179`](../../packages/providers/src/registry.ts#L179)

**Model Routing And Metadata**

- Provider effort vocabulary routes Qoder tiers to modelReasoningEffort.
  [`model-validation.ts:238`](../../packages/workflows/src/model-validation.ts#L238)

- DAG tier application preserves Qoder max effort in assistant config.
  [`dag-executor.ts:266`](../../packages/workflows/src/dag-executor.ts#L266)

- Runtime metadata keeps provider-specific reasoning strings visible to APIs.
  [`dag-executor.ts:368`](../../packages/workflows/src/dag-executor.ts#L368)

- Direct chat falls back from assistants.qodercli.model to missing tier aliases.
  [`orchestrator-agent.ts:123`](../../packages/core/src/orchestrator/orchestrator-agent.ts#L123)

- API projection forwards Qoder max reasoning metadata without Codex-only narrowing.
  [`api.ts:137`](../../packages/server/src/routes/api.ts#L137)

**Safe Exposure And Docs**

- Safe config exposes only non-sensitive Qoder assistant fields.
  [`config-loader.ts:139`](../../packages/core/src/config/config-loader.ts#L139)

- Provider package exports Qoder subpaths and includes tests in the package script.
  [`package.json:21`](../../packages/providers/package.json#L21)

- User docs cover install, login boundary, binary resolution, model, and effort config.
  [`ai-assistants.md:253`](../../packages/docs-web/src/content/docs/getting-started/ai-assistants.md#L253)

**Tests**

- Provider tests cover argv, streaming, errors, abort, and structured output.
  [`provider.test.ts:87`](../../packages/providers/src/community/qodercli/provider.test.ts#L87)

- Workflow tests cover Qoder effort routing and node-start metadata.
  [`dag-executor.test.ts:1199`](../../packages/workflows/src/dag-executor.test.ts#L1199)

- API test verifies Qoder max reasoning survives run projection.
  [`api.workflow-runs.test.ts:906`](../../packages/server/src/routes/api.workflow-runs.test.ts#L906)
