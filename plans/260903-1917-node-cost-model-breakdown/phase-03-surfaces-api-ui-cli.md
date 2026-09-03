# Phase 3 — Surfaces: API, Web, CLI

## Context

Run/node cost already renders: run header cost (`packages/web/src/experiments/console/components/RunDetailHeader.tsx:117-122`), per-node cost suffix (`NodeDivider.tsx:72-73`), Slack cost footer (`packages/adapters/src/chat/slack/blocks.ts:67-84`). This phase exposes the breakdown through the API contract and renders it; Slack stays total-only (footer unchanged).

## Requirements

- **API**: extend the route schemas in `packages/server/src/routes/schemas/` where run detail / run events are served so `usage_breakdown` (node event payload) and `usage_by_model` (run metadata) are part of the OpenAPI contract. Reuse/derive from the engine `usageBreakdownSchema` — no parallel hand-written interface (`z.infer` rule).
- **Web types**: regenerate `packages/web/src/lib/api.generated.d.ts` (`bun --filter @archon/web generate:types`, server running). `@archon/web` must not import from `@archon/workflows`.
- **Web UI** (console experiment surfaces already listing cost):
  - Run detail: breakdown table under the existing cost figure — one row per `provider/model` key: model, calls, tokens in/out, cache (when present), cost (blank when unreported, labelled "n/a", never $0.00). Advisor entries (`kind: 'advisor'`) grouped/labelled distinctly.
  - Node divider/detail: same rows scoped to the node, behind an expandable element to keep the divider compact.
  - Follow brand tokens (`packages/web/src/index.css`); no ad-hoc colors.
- **CLI**: `workflow get`/`status` human output prints a per-model line under the existing totals; `--json` passes fields through untouched.
- Absence handling everywhere: old runs and cost-less providers show "not recorded" semantics, never fabricated zeros.

## Files

- `packages/server/src/routes/schemas/` (run/event schema files)
- `packages/web/src/lib/api.generated.d.ts` (generated)
- `packages/web/src/experiments/console/components/RunDetailHeader.tsx`, `NodeDivider.tsx`, related run primitives (`primitives/run.ts`, `primitives/event.ts`)
- `packages/cli/src/` workflow status/get formatting
- Colocated tests

## Validation

- `bun run validate`
- Manual: run a two-provider workflow via web API, confirm run detail shows both models with correct sums; `bun run cli workflow get <id> --json | jq '.usage_by_model'`.

## Risk / rollback

Read-only display of additive fields. Rollback = revert UI/API commits independently of phases 1-2.
