---
title: Source Control mockup alignment implemented
date: 2026-09-07
summary: Legacy Source Control tab visually aligned to the 2026-09-05 mockup; focused web tests pass; full bun run validate still flakes on unrelated CLI/core/providers subprocess timeouts.
---

# Source Control mockup alignment implemented

## What happened

Executed `plans/260907-0357-source-control-mockup-alignment` in auto mode.

Phase 1 captured a live baseline on run `3b392d9590846072a1b8b58a1f990287` at 1440 / 900 / 899.

Phase 2 aligned the legacy Source Control tab:

- Whole-tab empty states moved to `source-control-empty-state.tsx` (tab root).
- `StatusBadge` for M/A/D using warning/success/error tokens.
- Compact Changes + History fill; 32px rows; sans path in the list, mono path in the viewer header.
- Diff surface uses `--surface` with 14% color-mix tints and colored +/- markers.
- Stale banner lives in FileViewer (`Changed on disk — Reload`).

Phase 3: focused Source Control tests + mounted integration test updated; `@archon/web` is 605/0. Live matrix verified (split at 900, stacked at 899, stale accept cycle). Code-reviewer: APPROVE, 0 high-confidence issues.

## Decision

Keep `.prettierignore` addition of `.agent/` so `format:check` is not blocked by local agent scratch files. Do not treat CLI/core/providers subprocess timeouts (exit 137, 5s/7s/30s/180s) as Source Control regressions — they appear under machine load and pass when those packages are re-run in isolation.

## Next steps

- Re-run `bun run validate` on a quiet machine and check the remaining Phase 3 validate boxes.
- Commit when asked. No docs-site/API update needed.

> Historical work record — not durable authority. Prefer docs/specs/ADRs for current decisions.
