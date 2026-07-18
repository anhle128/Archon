# Deferred Work

## Deferred from: code review of 3-1-implement-archon-workflow-provider-binding-lifecycle (2026-07-13)

- Ambient `DEFAULT_AI_ASSISTANT` leaks into existing `packages/core/src/db/codebases.test.ts`; pre-existing, reproduced only when the variable is set.
- No disposable live PostgreSQL DDL/restart-convergence lane exists; keep the explicit residual risk until infrastructure supports it.

## Deferred from: code review of 3-3b-provide-archon-start-and-status-cli-json (2026-07-16)

- `bun run validate` failed in the full parallel package test phase on unrelated core/server test output, while focused Story 3.3b checks passed; reproduce separately against the base branch before treating it as caused by this story.
- Workflow Commander canonical command examples still encode BMAD-specific semantics (`bmad-dev-story`, `phase`, and `projectBindingRef`).
  Hermes-agent reuse should be designed around generic controller contracts, with BMAD-specific examples moved to a separate fixture family or adapter-level documentation.

## Deferred from: code review of raw-provider-owned-effort-passthrough (2026-07-18)

- Assistant-settings PATCH merge semantics cannot unset an existing `modelReasoningEffort` by clearing the legacy Settings page or console field: omission preserves the saved value, while an empty string is structurally invalid. This predates raw effort passthrough and needs an explicit nullable delete contract across API, config merge, and both UIs.
- Tier and alias editors preserve a pre-existing effort value loaded for a provider whose current capabilities report `effortControl: false`; the value is hidden and can survive an unrelated save. Capability-aware legacy-state cleanup or an explicit removable warning needs a focused UI/API design.
