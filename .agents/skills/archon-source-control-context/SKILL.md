---
name: archon-source-control-context
description: Load Archon Source Control implementation context already synced into this repo. Use when implementing Source Control, creating stories, or when epics, architecture, SPEC, or sprint-status are needed inside Archon.
---

# Archon Source Control context (read only)

This repo is isolated. Do not read `..`. Do not run parent sync scripts from here.

Index: `_bmad-output/planning-artifacts/archon-source-control/README.md`

If that file is missing, stop and tell the user to run from the parent workspace:

```bash
bash scripts/sync-subproject.sh archon source-control
```

## Read in this order

1. `_bmad-output/implementation-artifacts/archon-source-control/sprint-status.yaml`
2. `_bmad-output/planning-artifacts/epics-source-control/epics.md`
3. `_bmad-output/planning-artifacts/prds/prd-source-control/architecture.md`
4. `_bmad-output/planning-artifacts/prds/prd-source-control/addendum.md`
5. `plans/architectures/archon-source-control.md`
6. `_bmad-output/planning-artifacts/prds/prd-source-control/prd.md`
7. `_bmad-output/specs/spec-archon-source-control/SPEC.md`
8. `_bmad-output/planning-artifacts/ux-designs/ux-Archon-2026-08-31/DESIGN.md`
9. `_bmad-output/planning-artifacts/ux-designs/ux-Archon-2026-08-31/EXPERIENCE.md`
