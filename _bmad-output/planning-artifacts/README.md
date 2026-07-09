# Archon BMad Planning Handoff

This folder is the local planning input package for isolated Archon implementation.
The implementation environment may not be able to read the parent workspace.
Parent planning must materialize Archon-owned implementation inputs here before Archon BMad implementation starts.

The active Archon implementation input is Hermes Agent Workflow Commander.
Implementation agents must read the flat files in this folder:

```text
prd.md
architecture.md
epics.md
```

Do not use archived or feature-scoped subfolders as active implementation input unless the Archon BMAD workflow is explicitly changed to read those paths.
The previous BMAD TEA V2 flat handoff was removed from the active paths because it was not aligned with the parent workspace Workflow Commander plan.

Do not place implementation artifacts here.
Archon implementation artifacts are generated locally under:

```text
archon/_bmad-output/implementation-artifacts/
```

Run implementation workflows from inside `archon/`.
Do not rely on parent workspace paths during implementation.
