---
name: select-verify-archon-targets
description: >-
  Choose verify-archon feature-map ids to prove after a product change.
  Use when an Archon workflow node must pick one or more ids from
  `.agents/skills/verify-archon/features/` based on a plan and git diff.
---

# Select verify-archon targets

Pick the smallest set of feature-map ids whose user paths this change can break.
Do not implement product code. Do not start Mini, PM2, or Tailscale.

## Map

Read `.agents/skills/verify-archon/features/README.md` and the feature files there.
Allowed ids only:

- `discover-workflows`
- `web-console`
- `diagnose-install`
- `run-deterministic-workflow`
- `inspect-run`

## Inputs

- Superpowers plan path from the node prompt
- Base SHA file (diff this SHA to HEAD, plus staged/unstaged)
- User request text

## Rules

- Include every id whose mapped user path the diff or plan can break.
- If anything under `packages/web` changed, include `web-console`.
- Always emit at least one id.
- If nothing else is justified, use `discover-workflows`.
- Local bun verify only.

## Output

Write proposed ids (one per line, no commentary) to
`$ARTIFACTS_DIR/verify/feature-ids.proposed.txt`.
A later bash node is the source of truth (may add `web-console` or the fallback).

Return JSON only: `feature_ids`, `rationale`, `web_changed`.
