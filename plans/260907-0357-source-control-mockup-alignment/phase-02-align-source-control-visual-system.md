---
title: 'Phase 2: Align Source Control Visual System'
status: todo
priority: P1
effort: 1d
dependencies: [1]
---

# Phase 2: Align Source Control Visual System

<!-- Updated: Validation Session 1 - corrected the Source Control owner path and confirmed semantic-token visual alignment. -->

## Overview

Apply the restored visual contract to the existing Source Control component tree.
Keep the current data flow and all later functional behavior.

## Requirements

- [ ] Use the existing design tokens and current Source Control components.
- [ ] Match mockup geometry and density, and map colors through existing semantic tokens.
- [ ] Target a 14 percent diff tint unless the contrast check requires an adjustment.
- [ ] Keep Changes compact and let History fill the remaining left-panel height.
- [ ] Keep the left panel resizable from 20 to 70 percent with a 30 percent default.
- [ ] Keep the commit lane graph and expanded commit file viewer.
- [ ] Keep Close, Escape, Reload, Return to Now, virtualization, and file fallbacks.
- [ ] Keep all empty, loading, error, and stale states accessible.

## Files to Modify

- `packages/web/src/components/workflows/source-control/source-control-tab.tsx`
- `packages/web/src/components/workflows/source-control/source-control-split.tsx`
- `packages/web/src/components/workflows/source-control/source-control-panel.tsx`
- `packages/web/src/components/workflows/source-control/changed-files-list.tsx`
- `packages/web/src/components/workflows/source-control/changed-file-row.tsx`
- `packages/web/src/components/workflows/source-control/commit-history-graph.tsx`
- `packages/web/src/components/workflows/source-control/commit-graph-row.tsx`
- `packages/web/src/components/workflows/source-control/file-viewer.tsx`
- `packages/web/src/components/workflows/source-control/virtualized-diff.tsx`
- `packages/web/src/components/workflows/source-control/source-control-diff.css`

## Implementation Steps

1. Move whole-tab `container` and `no_checkout` states to the Source Control tab root so they center across the full workspace.
2. Keep region-level empty and error states inside their owning region so the other region stays usable.
3. Change the left-panel flex model so Changes shrink to content and History owns the remaining height.
4. Apply the small uppercase tertiary region headers and dense full-width row geometry from the design.
5. Use sans-serif file labels in navigation chrome and use neutral badge surfaces with warning, success, and error letters.
6. Retain the lane graph while aligning commit subjects, metadata, spacing, selection, hover, and focus states.
7. Apply the surface background, mono path, status badge, quiet Reload, and retained Close action to the viewer header.
8. Put the stale notice in viewer chrome without changing the atomic snapshot acceptance logic.
9. Move `Load more` from the header to the file-stream boundary.
10. Center the idle prompt and expand viewer loading to skeleton rows with the existing Cancel action.
11. Keep the binary note, hex preview, image preview, and Download action within the aligned viewer shell.
12. Set diff panes to the surface background, use 14 percent line tints unless contrast requires an adjustment, and color `-` and `+` markers with error and success tokens.
13. Keep independent horizontal and vertical scrolling, tabular line numbers, disabled ligatures, and vertical diff stacking below 900 pixels.
14. Style the local resize handle with the required hit area and centered grip without changing the shared default.

## Todo

- [ ] Align whole-tab and region state ownership.
- [ ] Align panel geometry and navigation rows.
- [ ] Align commit graph presentation.
- [ ] Align viewer chrome and controls.
- [ ] Align diff and fallback presentation.
- [ ] Confirm keyboard and focus behavior after each change.

## Success Criteria

- [ ] The visual hierarchy matches the restored mockup at desktop and narrow widths.
- [ ] Changed file and commit rows remain keyboard accessible and have visible focus.
- [ ] All existing Source Control capabilities remain available.
- [ ] No API, server, database, shared token, or dependency change is required.

## Risks and Controls

- Moving stale UI can break the frozen snapshot contract.
- Keep the existing reload callback and accept all pending snapshot data in one action.
- Dense rows can reduce target clarity.
- Preserve full-width hit targets and visible hover, selected, and focus states.
