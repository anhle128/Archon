---
name: sync-archon-source-control
description: Sync Archon Source Control planning (SPEC, PRD, architecture, epics, UX, sprint-status) from the workflow-engine parent into the Archon subproject so isolated implementation agents have full context. Use when the user says sync to Archon, handoff source-control, implement Source Control in Archon, or needs Archon agents to see epics/architecture.
---

# Sync Archon Source Control

Parent workspace plans; Archon implements. Isolated Archon agents must not read `..`.

## Run (parent workspace)

```bash
bash scripts/sync-archon-source-control.sh
bash scripts/sync-archon-source-control.sh --dry-run
```

Script location is `scripts/sync-archon-source-control.sh` next to `archon/`.
Do not invent a copy inside Archon.

## After sync, Archon agents read only these

Package (start here):

- `_bmad-output/implementation-artifacts/archon-source-control/sprint-status.yaml`
- `_bmad-output/implementation-artifacts/archon-source-control/epics.md`
- `_bmad-output/implementation-artifacts/archon-source-control/architecture.md`
- `_bmad-output/implementation-artifacts/archon-source-control/architecture-decisions.md`
- `_bmad-output/implementation-artifacts/archon-source-control/prd.md`
- `_bmad-output/implementation-artifacts/archon-source-control/addendum.md`
- `_bmad-output/implementation-artifacts/archon-source-control/spec/SPEC.md`
- `_bmad-output/implementation-artifacts/archon-source-control/DESIGN.md`
- `_bmad-output/implementation-artifacts/archon-source-control/EXPERIENCE.md`

BMad-native mirrors:

- `_bmad-output/planning-artifacts/epics-source-control/epics.md`
- `_bmad-output/planning-artifacts/prds/prd-source-control/`
- `_bmad-output/specs/spec-archon-source-control/`

If the package is missing inside Archon, stop and tell the user to run the parent script.

## Do not

- Traverse into the parent workspace from Archon
- Use symlinks
- Repoint `implementation_artifacts` for all Archon work
