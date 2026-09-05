# Archon — Workflow Run View (HITL) UX Mockup

A self-contained, interactive prototype of the redesigned **workflow run view** with
mid-run human-in-the-loop (AskHuman + live-review gates). Plain HTML/CSS/JS — no build
step, no network calls, no frameworks. All data is simulated and the timeline is
deterministic (`setTimeout`-driven).

## Open it

Double-click `index.html`, or:

```bash
open index.html        # macOS
# or serve it (optional — file:// works fine):
python3 -m http.server 8000   # then http://localhost:8000
```

Everything runs client-side; there is nothing to install.

## Two surfaces, one design language

The mockup ships the same run-view design mapped onto **both** Archon surfaces,
so they can be compared 1:1 (a switcher in the header jumps between them):

- **`index.html` — Legacy surface**: tabbed layout (Graph / Logs / Chat), the
  shared NodePanel docked right, Ask/gate cards in the Chat tab.
- **`console.html` — Command Center surface**: the console's log-first idiom.
  The run stream renders **one section per node run** (loops appear once per
  iteration, re-runs once per pass — never merged); Ask/gate cards render
  **inline at the awaiting node's section** instead of a free-text composer;
  the **same NodePanel** docks right and opens from any divider or graph node;
  the Graph view reuses the same layered-DAG renderer; the "Reply…" composer
  stays at the bottom. The header status pill carries the `awaiting` state
  (amber, pulsing, click to jump to the card).

Both pages run the identical simulation, so every beat can be compared across
surfaces.

## The scenario

A fake run of the **real** `speckit-ralph-native-feature` workflow
(`.archon/workflows/defaults/speckit-ralph-native-feature.yaml`) — 31 nodes, chosen
because it exercises everything the graph renderer must survive in production:

- a long linear spine (setup → specify → clarify → … → create-pull-request)
- a conditional edge (`clarify-respond` runs only `when: HAS_QUESTIONS`)
- `trigger_rule` joins (`one_success`, `none_failed_min_one_success`)
- three `plannotator_gate` human gates
- a `loop` node (`ralph-loop-run`, max 100 iterations)
- a `route_loop` router with **positive / negative / exhausted** routes
- a **retry loop-back**: the converge review gate feeds back into
  `ralph-tasks-to-ralph`, so several nodes execute **twice**

The simulated run answers one AskHuman card (`clarify`), approves three gates, takes
the **negative** route first (converge FAIL → review gate → retry loop), then passes
on the second converge and runs to PR creation.

## The graph renderer

Built for complex graphs, no library:

- **Layered DAG layout** — longest-path layering, barycenter crossing reduction,
  cycle-safe: the retry loop-back edge is detected by DFS and drawn as a dashed teal
  edge routed around the left flank (labeled "retry loop") instead of breaking the
  layering.
- **Pan / zoom / fit** — drag the background to pan, scroll-wheel zooms to the
  cursor, toolbar buttons for ± and Fit. Fit runs automatically when you open the
  Graph tab.
- **Curved bezier routing with distance-aware ports** — every edge leaves the
  bottom of its source as a smooth curve. Short edges (adjacent layers, e.g. a
  `route_loop` fan-out) enter the **top** of the target, arriving vertically.
  Long edges (spanning multiple layers) with a clear side offset enter
  horizontally through the **side facing the source**, so a cross-graph
  connection never sweeps behind intermediate nodes. Arrowheads are long,
  sharp, swallowtail-notched, and the tip touches the node border.
- **Edge semantics** — solid gray = `depends_on`; dashed = conditional (`when:`),
  labeled on the horizontal lane; colored routes from a `route_loop` (green PASS /
  amber FAIL / red exhausted); join badges on nodes with `trigger_rule`.
- **Taken-path coloring** — an edge lights up only once the run actually flows
  through it (its target node has started). Untaken branches stay dim, so the
  executed path reads at a glance; on a `route_loop`, only the route(s) the run
  really took go full-color.
- **Hover tracing** — hovering a node lights up its incoming + outgoing edges in
  accent blue and fades everything else, answering "where does this node go?"
  instantly even in dense joins.
- **Node cards** — compact, color-coded left border per kind (bash / prompt / loop /
  gate / route / command), live status line, loop iteration counter.

## Layout model: one shared node panel

The right-hand panel is shared by all three tabs. Clicking a node in **Graph**, a
row in **Logs**, or a node chip in **Chat** opens the same panel (with a close ✕ and
a drag-to-resize handle). Selecting another node swaps the panel content in place.

## What to try

| Interaction | Where | Shows |
| --- | --- | --- |
| Watch the run walk the graph | **Graph** tab | 31-node layered layout; awaiting nodes glow amber; route edges color the taken path |
| Hover a node | Graph | Its in/out edges light up blue, rest fades — trace any connection instantly |
| Pan / zoom / Fit | Graph toolbar + mouse | Complex-graph navigation |
| Click any node | Graph | Shared side panel with that node's own log |
| Answer the **clarify** Ask card | Chat tab (or banner chip) | AskHuman: 2 questions (single + multi), one atomic submit |
| Approve the three gates | Chat tab | plannotator_gate cards: review URL, doc path, Approve / Send annotations |
| Watch the retry loop | Graph + Logs | converge FAIL → negative route → review gate → nodes re-run (pass 2) |
| Open **ralph-loop-run** | Logs tab | One row **per iteration**, never merged — panel chips switch iterations |
| Open a re-run node (e.g. `ralph-sync-back`) | Logs tab | One row per pass (`#2` marker); panel chips switch passes |
| Flip **view as: teammate** | header switch | Cards become read-only: only the starter can answer/decide |
| **Replay** | header button | Restarts the whole simulation deterministically |

## Logs tab: node-run history, never merged

The Logs tab is a chronological list of **node runs**, not a merged stream:

- a normal node → one row
- a loop node → one row **per iteration** (`ralph-loop-run ×1`, `×2`, …)
- a node re-executed via the retry loop → one row **per pass** (`#2` marker)

Each row shows status, duration, and start offset, and opens the shared panel scoped
to exactly that run.

## Spec mapping

- **CAP-1** (run view = graph + per-node panel): Graph tab, click-to-inspect.
- **CAP-2** (agent room): the panel shows streamed text, tool calls, bash output.
- **CAP-3/4** (AskHuman inline + contract): clarify card — multi-question, single
  atomic submit, answered state retained in history.
- **CAP-5** (concurrency): the awaiting banner counts all pending cards/gates and
  clears only when the last one resolves.
- **CAP-6** (authorization): starter/teammate view toggle.

## Assumptions made (spec ambiguities)

- The header shows a single run-level badge; "Awaiting input" is derived (≥1 node
  awaiting) rather than a stored run status.
- plannotator_gate cards offer Approve / Send annotations (rework); both resolve the
  gate in the mockup — the real rework loop is out of scope for the prototype.
- Loop iterations are numbered continuously across retry passes (`×1…×5`), with the
  pass noted in the panel header — every execution stays individually addressable.
