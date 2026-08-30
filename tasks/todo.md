# Loop node "current/expected (max N)" display

## Goal

The workflow graph loop node showed `1/100 iterations` (current/`max_iterations`).
Show the real expected total instead: `1/20 (max 100)`, where `20` = pending
(incomplete) `userStories` in the Ralph `prd.json`. Falls back to `current/max
iterations` when no total is known.

## Final design (constitution-compliant — no new YAML field)

The first design added a `loop.expected_iterations` YAML field. That failed the
Workflow Language Constitution admissibility test (Q1: "does the engine need it to
govern the run?" — a display value does not). Reverted in favour of a **typed
inter-node projection**, which rides the _sanctioned_ "typed data between nodes"
surface, not the policed YAML surface:

1. An upstream node (the Ralph `bash:` preflight) prints ONE discriminated JSON object
   on stdout: `{ "type": "loop_progress", "targetNodeId": "<loop id>",
"expectedIterations": N, "hasPending": <bool> }`.
2. The executor parses ONLY the bounded `{ targetNodeId, expectedIterations }` (never
   raw stdout; `Number.isSafeInteger` + positive + nonblank target) and attaches it as
   `loop_progress` to the node's `node_completed` persisted event data AND the emitter
   `NodeCompletedEvent.loopProgress`.
3. Web sets the TARGET loop node's `expectedIterations`:
   - REST replay: `enrichDagNodesWithLoopProgress` over persisted `node_completed` data.
   - Live SSE: `workflow-bridge` projects `loopProgress` onto the `dag_node` event;
     `handleDagNode` applies it to an EXISTING target node (no placeholder).
4. Renderer (`ExecutionDagNode` / `DagNodeProgress`) shows `current/expected (max N)`
   from `node.expectedIterations`, else `current/max iterations`.
5. Ralph `speckit-ralph-test.yaml`: preflight emits the payload; loop gated by
   `when: "$ralph-native-preflight.output.hasPending == 'true'"` (zero-pending → loop
   skipped, no error). No `expected_iterations` field. Ambient `provider: omp` / model
   edits on the loop node preserved untouched.

Display-only throughout: never affects control flow, completion, or `max_iterations`.

## Status — all done

- [x] Revert the `loop.expected_iterations` YAML-field path (schema, executor
      resolution, loop-event field, loader scan, include-expander rewrite, builder
      variant/round-trip/content, quick-reference row, constitution row, field docs).
- [x] Engine projection: `LoopProgress` type + `parseLoopProgress` (hardened) +
      `node_completed` persisted `loop_progress` + emitter `loopProgress`.
- [x] Web projection: bridge `dag_node.loopProgress`, `DagNodeEvent.loopProgress`,
      store `handleDagNode`, REST `enrichDagNodesWithLoopProgress` (hardened), renderer
      reuse of `DagNodeState.expectedIterations`.
- [x] YAML payload + `when` gate; `generate:bundled`; web OpenAPI types regenerated
      (field removed from generated types).
- [x] Docs: loop-nodes "Loop progress display" projection section (replaces the field
      docs); constitution row removed (no YAML feature added).
- [x] Tests: bridge (projection + omit), store (`handleDagNode` apply + absent-target
      no-placeholder), REST replay enrich, executor (parse payload onto `node_completed` + ignore non-positive), zero-pending skip, renderer literal `1/20 (max 100)` +
      `1/100 iterations` fallback.

## Verification

- type-check `@archon/workflows`, `@archon/web`, `@archon/server`: pass.
- tests: dag-executor + loader/include/event/condition + web store/execution/round-trip/
  content/renderer/dagnode + server bridge: 0 fail (run after final edits).
- `check:bundled` up to date; changed files Prettier + ESLint clean.

To see it: run THIS repo (`bun run dev`), not the `:3090` `opensources/Archon` checkout.
