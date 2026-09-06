---
title: 'Phase 1: Establish Visual Baseline and Contract'
status: todo
priority: P1
effort: 3h
dependencies: []
---

# Phase 1: Establish Visual Baseline and Contract

<!-- Updated: Validation Session 1 - corrected the Source Control owner path and limited adjacent defects to follow-up findings. -->

## Overview

Reproduce the current legacy Source Control screen through the same `bun run dev` path that the user uses.
Build a visual traceability matrix before product code changes.

## Requirements

- [ ] Use the restored mockup and its design documents as the visual authority.
- [ ] Use the later Source Control epics and tests as the functional authority.
- [ ] Preserve the commit lane graph, commit viewer, Close and Escape behavior, virtualization, large-file loading, binary fallbacks, and frozen Reload behavior.
- [ ] Limit the target to `/legacy/workflows/runs/:id` and the Source Control tab.
- [ ] Make no product code changes in this phase.

## Related Files

- Read `_bmad-output/planning-artifacts/ux-designs/ux-Archon-2026-09-05/DESIGN.md`.
- Read `_bmad-output/planning-artifacts/ux-designs/ux-Archon-2026-09-05/EXPERIENCE.md`.
- Read `_bmad-output/planning-artifacts/ux-designs/ux-Archon-2026-09-05/mockups/key-screen-source-control-2026-09-05.html`.
- Read `_bmad-output/planning-artifacts/epics-source-control/epics.md`.
- Read `docs/superpowers/ralph/2026-09-06-source-control-every-changed-file/prd.md`.
- Read `docs/superpowers/ralph/2026-09-07-source-control-commit-viewer/prd.md`.
- Compare `packages/web/src/components/workflows/source-control/`.
- Compare `packages/web/src/components/workflows/source-control/source-control-tab.tsx`.

## Implementation Steps

1. Run `bun install --frozen-lockfile` if the current install cannot resolve locked Web dependencies.
2. Reuse the existing `bun run dev` process when it belongs to this worktree.
3. Open the Vite Web UI at `http://localhost:5173`, not the API server at port `3090`.
4. Select or create a real git-backed workflow run with modified, added, and deleted files plus commit history.
5. Capture desktop evidence near 1440 pixels and responsive evidence at 900 and 899 pixels.
6. Record each mismatch for layout, spacing, typography, colors, actions, loading, empty, error, stale, large-file, binary, and commit states.
7. Map each mismatch to one owning component and one acceptance check.
8. Record defects outside the Source Control tab as separate follow-up findings without changing this plan's scope.

## Todo

- [ ] Confirm the development dependency tree is usable.
- [ ] Confirm the correct development URL.
- [ ] Capture the current visual baseline.
- [ ] Complete the visual and behavior traceability matrix.

## Success Criteria

- [ ] The evidence covers every state listed in this phase.
- [ ] The matrix separates visual changes from protected functional behavior.
- [ ] No duplicate development process or alternate port is created.
- [ ] No server, API, database, or workflow contract change is proposed.

## Risks and Controls

- A run may not contain all required states.
- Use a real temporary git-backed run or an existing deterministic integration fixture, and do not add fake product behavior.
