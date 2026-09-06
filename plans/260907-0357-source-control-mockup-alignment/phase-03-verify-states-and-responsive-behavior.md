---
title: 'Phase 3: Verify States and Responsive Behavior'
status: todo
priority: P1
effort: 5h
dependencies: [2]
---

# Phase 3: Verify States and Responsive Behavior

<!-- Updated: Validation Session 1 - replaced nonexistent test paths with existing owner tests and kept adjacent defects out of scope. -->

## Overview

Protect the visual alignment and every later Source Control behavior with focused tests and live browser checks.

## Requirements

- [ ] Test semantics and behavior instead of taking brittle full-markup snapshots.
- [ ] Keep every current functional assertion unless the accepted visual contract changes its presentation.
- [ ] Verify real UI output through the Vite Web UI at port `5173`.
- [ ] Verify desktop, boundary, and narrow viewport behavior.
- [ ] Finish with the repository validation command.

## Test Files to Modify

- `packages/web/src/components/workflows/source-control/source-control-panel.test.tsx`
- `packages/web/src/components/workflows/source-control/commit-history-graph.test.tsx`
- `packages/web/src/components/workflows/source-control/file-viewer.test.tsx`
- `packages/web/src/components/workflows/source-control/use-stacked-viewport.test.ts`
- `packages/web/src/component-integration/source-control-tab.test.tsx`

## Implementation Steps

1. Update `source-control-panel.test.tsx` for whole-tab state ownership, region geometry, row semantics, and badge intent.
2. Update `file-viewer.test.tsx` for viewer chrome, diff presentation, scrolling, and wide or stacked panes.
3. Update `use-stacked-viewport.test.ts` for the 900 and 899 pixel boundary contract.
4. Update the mounted integration test for `container`, `no_checkout`, region empties, loading, error, stale, Reload, and file-selection flows.
5. Keep explicit integration coverage for Close, Escape, Return to Now, commit selection, virtualization, large files, binary files, image files, hex preview, and Download.
6. Run `(cd packages/web && bun test src/components/workflows/source-control/)`.
7. Run `(cd packages/web && NODE_ENV=development bun test src/component-integration/source-control-tab.test.tsx)`.
8. Run `bun --filter @archon/web type-check`.
9. Run `bun --filter @archon/web build`.
10. Inspect populated modified, added, and deleted rows at a desktop width near 1440 pixels.
11. Inspect layout behavior at exactly 900 pixels and at 899 pixels.
12. Inspect empty Changes, empty History, whole-tab empty, panel loading, viewer loading with Cancel, API error, stale Reload, large-file, binary, image, and commit-expanded states.
13. Confirm both diff panes scroll independently and do not clip long lines.
14. Confirm focus order, Escape behavior, contrast, and the absence of console errors.
15. Record any defect outside the Source Control tab as a separate follow-up finding.
16. Run `bun run validate`.

## Todo

- [ ] Update focused component tests.
- [ ] Update mounted integration coverage.
- [ ] Complete the automated validation sequence.
- [ ] Complete the live visual state matrix.
- [ ] Record final before-and-after evidence in the implementation report.

## Success Criteria

- [ ] Focused Source Control tests pass.
- [ ] The mounted Source Control integration test passes.
- [ ] Web type-check and build pass.
- [ ] The live state matrix matches the restored visual contract without console errors or unintended overflow.
- [ ] `bun run validate` passes without hidden warnings or skipped failures.

## Rollback

Revert the frontend and test changes for this plan.
No data migration or API rollback is required.

## Risks and Controls

- Class-based tests can become brittle.
- Prefer role, label, state, and layout-contract assertions, and use live browser evidence for pixel checks.
