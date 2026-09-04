# Archon Source Control — isolated handoff index

Parent workspace is canonical. Destination is always `archon/<same relative path>`.
Do not flatten these into `implementation-artifacts/`.

Sync from the parent workspace:

```bash
bash scripts/sync-subproject.sh archon source-control
```

Manifest: `scripts/handoffs/archon/source-control.manifest`.

## What an Archon agent reads

| Role | Path (inside Archon) |
| --- | --- |
| Tracker | `_bmad-output/implementation-artifacts/archon-source-control/sprint-status.yaml` |
| Epics / stories | `_bmad-output/planning-artifacts/epics-source-control/epics.md` |
| Architecture (how) | `_bmad-output/planning-artifacts/prds/prd-source-control/architecture.md` |
| Architecture addendum | `_bmad-output/planning-artifacts/prds/prd-source-control/addendum.md` |
| Architecture decisions | `plans/architectures/archon-source-control.md` |
| PRD | `_bmad-output/planning-artifacts/prds/prd-source-control/prd.md` |
| SPEC | `_bmad-output/specs/spec-archon-source-control/SPEC.md` |
| UX | `_bmad-output/planning-artifacts/ux-designs/ux-Archon-2026-08-31/DESIGN.md` |
| UX experience | `_bmad-output/planning-artifacts/ux-designs/ux-Archon-2026-08-31/EXPERIENCE.md` |
| Brainstorm (trace only) | `_bmad-output/brainstorming/brainstorm-archon-ui-file-and-git-2026-08-28/brainstorm-intent.md` |

If any of these are missing, stop. Ask for a parent-workspace sync. Do not read `..`.
