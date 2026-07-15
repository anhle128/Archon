# Deferred Work

## Deferred from: code review of 3-1-implement-archon-workflow-provider-binding-lifecycle (2026-07-13)

- Ambient `DEFAULT_AI_ASSISTANT` leaks into existing `packages/core/src/db/codebases.test.ts`; pre-existing, reproduced only when the variable is set.
- No disposable live PostgreSQL DDL/restart-convergence lane exists; keep the explicit residual risk until infrastructure supports it.

## Deferred from: code review of 3-3b-provide-archon-start-and-status-cli-json (2026-07-16)

- `bun run validate` failed in the full parallel package test phase on unrelated core/server test output, while focused Story 3.3b checks passed; reproduce separately against the base branch before treating it as caused by this story.
