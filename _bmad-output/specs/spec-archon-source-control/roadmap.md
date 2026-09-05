# Roadmap — beyond v1 MUST

Preserves the SHOULD / COULD scope from the source. These are not v1 commitments, but several bend v1 design decisions (noted), so they belong in the contract.

## SHOULD

- **Durable git-snapshot artifact** — already a capability: **CAP-8**. Kept here for lineage; the kernel owns it.

## COULD (deferred, post-v1)

Design-bending ones are marked → the v1 build should not foreclose them.

- **Logs ↔ Source Control link** — a log line that ran a command links to the files it touched.
- **Graph node changed-files badge / filter** — a node shows "N files changed"; clicking filters Source Control to that node's files.
- **Reuse the diff viewer as the HITL review surface** — at an approval gate, show the run's diffs before approve. → v1: build the viewer as a reusable component, not welded into the tab.
- **Event provenance overlay** — a hint layer (which node / log line may relate to a file) laid over the git truth. Never authoritative (see Non-goals). → v1: keep the read model clean enough to layer hints later.
- **Default history to the run's own commit** — open history focused on this run's commits, with full history as a fallback filter. → v1: CAP-4 read path should make "this run's commits" a cheap selection.
- **Collapse the empty Changes region on auto-commit / no-HITL runs** — when nothing is uncommitted, lead with history. → v1: CAP-1 layout should tolerate an empty Changes region gracefully.
- **Read container-backend runs** — via `docker exec` git or the overlay diff walk, handling suspended / finalized containers. → v1 shows the CAP-6 empty state for container runs.
