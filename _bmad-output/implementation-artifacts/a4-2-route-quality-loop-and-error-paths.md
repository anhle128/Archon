# Story a4.2: Route Quality Loop And Error Paths

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As an Archon workflow maintainer,
I want one bounded quality route loop after `quality-gate-summary` that returns fixable `FAIL` findings to `dev-story`, sends `PASS` forward, stops cleanly on `ERROR`, and writes a `review-loop-error` artifact on exhaustion,
so that the v2 workflow has exactly one quality routing authority and tooling/contract errors never re-enter the dev-story fix loop.

## Acceptance Criteria

1. **Given** `quality-gate-summary` emits `gate: "FAIL"`, **When** `quality-route-loop` runs, **Then** the route returns to `dev-story` (a back-edge that re-runs the full dev → TEA → CR → summary pipeline) **And** the next round carries the same `story_ref` (`$resolve-story-input.output.story_ref` is unchanged across rounds).
2. **Given** `quality-gate-summary` emits `gate: "PASS"`, **When** `quality-route-loop` runs, **Then** the route continues forward to the tail (`create-pull-request`) — the single forward exit that a5.1 will later re-target to `decision-needed-check`.
3. **Given** the loop budget is exhausted (the summary keeps returning `FAIL` past `max_iterations` `FAIL` evaluations), **When** routing runs, **Then** the route lands on `review-loop-error` **And** `review-loop-error` records the open findings pointer and the round/iteration count (stdout + best-effort `review-loop-error.json`) **And** the workflow terminates with a non-zero exit (fail closed, no PR).
4. **Given** the quality decision is an `ERROR` (a required role contract is missing/empty or has a mismatched `story_ref` / `contract_version` / `workflow`, or a role gate is `ERROR`), **When** the summary runs, **Then** `quality-gate-summary` exits non-zero (fails the node) so `quality-route-loop` cannot evaluate and the route **never** reaches `dev-story` — `ERROR` is kept strictly separate from a routable `FAIL`.
5. **Given** the redesign consolidates to one loop, **When** the v2 workflow is parsed by `parseWorkflow` (the same schema + DAG validation the CLI `validate workflows` invokes), **Then** it passes schema and DAG validation with exactly one `route_loop` node (`quality-route-loop`, `from: verify-quality-summary`), the former `code-review-gate` route_loop removed, `gate-planner` depending on `verify-story-identity`, and the v1 baseline workflow byte-for-byte unchanged.
6. **Given** the change lands, **When** the bundled defaults are regenerated, **Then** source (`.archon/workflows/defaults/...`) and bundle (`bundled-defaults.generated.ts`) stay consistent (`bun run check:bundled` passes) **And** a DAG fixture proves all four route outcomes end-to-end: `FAIL`→`dev-story`, `PASS`→forward, `ERROR`→no `dev-story` reroute, exhaustion→`review-loop-error`.

## Tasks / Subtasks

- [x] **Task 0 — Confirm the a4.1 baseline is present before editing (BLOCKER — read Dev Notes "Preconditions" first)**
  - [x] Verify in `.archon/workflows/defaults/bmad-dev-story-with-tea-fix-loop-v2.yml` that a4.1 is applied: a `quality-gate-summary` bash node exists as the four-role aggregator (8-source `depends_on` including `code-review-auto`, `resolve-story-input`, and the six RV/NR/TR branch nodes; `trigger_rule: none_failed_min_one_success`; `output_type: quality-gate-summary`; emits a JSON contract with `gate` (`PASS`|`FAIL`), `round`, `blocking_count`, `decision_needed_count`, and per-role `*_gate` echoes; **exits non-zero** on any role `ERROR` / missing contract / identity mismatch). Also verify the `code-review-gate` route_loop node exists (`from: verify-story-identity`, `positive: gate-planner`, `negative: dev-story`, `exhausted: review-loop-error`).
  - [x] **If those are ABSENT** (this worktree's checkout is at the ~a3.2 state — see Dev Notes "Verified current state": no `quality-gate-summary`, `tea-tr` unconditional, no `tea-tr-skipped`), **STOP** and rebase / merge the a3.3 + a4.1 work first, OR fold their wiring (TR join + four-role summary) into this story before starting. Do NOT silently re-derive them differently. Record which path was taken in the Dev Agent Record. (a4.1 hit this exact drift — it folded a3.3 in per its Task 0.)

- [x] **Task 1 — Add the summary gate-reader node `verify-quality-summary` (bash, emits bare `PASS`/`FAIL`) (AC: #1, #2, #4)**
  - [x] Add a new `bash:` node `verify-quality-summary` with `depends_on: [quality-gate-summary, resolve-story-input]`, `timeout: 60000`, `output_type: quality-summary-verified`. This node is REQUIRED because a `route_loop` condition cannot use field access (`$node.output.gate`) on a bash JSON node — the loader forbids field-ref conditions unless the `from` node declares `output_format.properties`, and bash nodes don't (see Dev Notes "Why a reader node is required"). Mirror the existing `verify-story-identity` pattern (lines 335-396) which does exactly this for the CR gate.
  - [x] Body: read the whole summary output UNQUOTED (`SUMMARY=$quality-gate-summary.output` — substitution values are already shell-quoted by the executor), `JSON.parse` it with `bun -e` (never `grep`/`case` on raw JSON — a3.3 finding), and validate fail-closed BEFORE printing anything: `contract_version == "1.0"`; `workflow == "bmad-dev-story-with-tea-fix-loop-v2"`; `node == "quality-gate-summary"`; `story_ref` non-empty AND equal to `$resolve-story-input.output.story_ref`; `gate` is exactly `PASS` or `FAIL`. Any violation → `echo "ERROR: ..." >&2; exit 1`.
  - [x] On success: `printf '%s' "$GATE"` (bare `PASS` or `FAIL` — nothing else on stdout). This becomes `$verify-quality-summary.output`, the bare value the route_loop condition compares.

- [x] **Task 2 — Remove the `code-review-gate` route_loop and rewire `gate-planner` (AC: #5)**
  - [x] Delete the `code-review-gate` node (the `route_loop` at lines 398-407). The architecture mandates exactly one quality loop, sourced from the summary (A-AD-5, Epic A4 "One Quality Route Loop") — the CR-gate short-circuit is being consolidated INTO the single summary loop. See Dev Notes "Design decision: one loop, at the summary".
  - [x] Change `gate-planner` `depends_on: [code-review-gate]` → `depends_on: [verify-story-identity]`. `verify-story-identity` is retained unchanged as the fail-closed CR identity/envelope barrier (it still `exit 1`s on CR `ERROR` / mismatch); its `PASS`/`FAIL` stdout is simply no longer routed on. Do NOT delete `verify-story-identity`.
  - [x] Confirm no other node still references `code-review-gate` in `depends_on` or a route target after deletion.

- [x] **Task 3 — Add the single `quality-route-loop` route_loop node (AC: #1, #2, #3)**
  - [x] Add `quality-route-loop` with `depends_on: [verify-quality-summary]` and a `route_loop` block: `from: verify-quality-summary`; `condition: "$verify-quality-summary.output == 'PASS'"` (bare-output comparison — matches the `code-review-gate` condition style); `max_iterations: 20` (preserve the budget of the loop being replaced — see Unresolved Questions #2 on the 3-vs-20 discrepancy); `routes: { positive: create-pull-request, negative: dev-story, exhausted: review-loop-error }`.
  - [x] Do NOT add `when`, `trigger_rule`, or `retry` to this node — the schema forbids all three on a `route_loop` node (`dag-node.ts` superRefine). The `route_loop` node's only `depends_on` must be exactly its `from` node (`loader.ts` `validateRouteLoopStructure`).
  - [x] Routing semantics to preserve: condition TRUE (`gate==PASS`) → `positive` (`create-pull-request`) and the loop counter resets; condition FALSE (`gate==FAIL`) → increments the per-node counter, routes `negative` (`dev-story`) while `count <= max_iterations`, routes `exhausted` (`review-loop-error`) once `count > max_iterations`.

- [x] **Task 4 — Rewire the tail and the exhausted target (AC: #2, #3)**
  - [x] Change `create-pull-request` `depends_on` (currently `[tea-tr]` in this worktree / `[quality-gate-summary]` in the a4.1 end-state) → `depends_on: [quality-route-loop]`. `create-pull-request` is the loop's `positive` target and must depend on the route_loop node (mirrors how the old `gate-planner` depended on `code-review-gate`). Leave the rest of the node untouched. Note for a5.1: this forward edge is the seam `decision-needed-check` will be inserted at.
  - [x] Change `review-loop-error` `depends_on: [code-review-gate]` → `depends_on: [quality-route-loop]` (it is now the `exhausted` target of the single quality loop).

- [x] **Task 5 — Make `review-loop-error` record open findings + round/iteration count (AC: #3)**
  - [x] Keep `review-loop-error` a fail-closed `bash:` node that `exit 1`s. Ensure it prints (and best-effort writes `$RUN_DIR/review-loop-error.json`) at minimum: the open-findings file pointer (`findings/open-findings.md`), the decision-log pointer, and a round/iteration count. Source the count from `state.json` (`$RUN_DIR/state.json` `round`) and/or by echoing that the quality loop exhausted its `max_iterations` budget; keep it dependency-light (the route_loop DB counter is not readable from bash — do not attempt to read it). Mirror the best-effort `RUN_DIR` JSON write pattern used by `gate-planner` / `tea-rv-skipped`.
  - [x] Do NOT emit a route-facing `gate`/`status` contract here — `review-loop-error` is a terminal error node; nothing routes on it.

- [x] **Task 6 — Tests: contract (co-located, no mock) + DAG (isolated, real bash) (AC: #1–#6)**
  - [x] Add `packages/workflows/src/defaults/v2-quality-route-loop-contract.test.ts` (NO `mock.module` — safe to co-locate). Parse the v2 YAML from disk with `parseWorkflow` + import `BUNDLED_WORKFLOWS`; assert: exactly ONE `route_loop` node exists and it is `quality-route-loop` (`from: verify-quality-summary`, `condition == "$verify-quality-summary.output == 'PASS'"`, routes `positive: create-pull-request` / `negative: dev-story` / `exhausted: review-loop-error`, `max_iterations` set); `code-review-gate` is ABSENT; `gate-planner.depends_on` includes `verify-story-identity` and NOT `code-review-gate`; `verify-quality-summary` is a bash node reading whole-output `$quality-gate-summary.output` (and explicitly NOT field-level `$quality-gate-summary.output.gate`), using `bun -e` + `JSON.parse` (not `grep`/`case`); `create-pull-request.depends_on == [quality-route-loop]`; `review-loop-error.depends_on == [quality-route-loop]`; the v1 baseline (`bmad-dev-story-with-tea-fix-loop.yml`) is byte-for-byte unchanged; and `parseWorkflow` passes. Follow the structure of `v2-quality-summary-contract.test.ts`.
  - [x] Add `packages/workflows/src/defaults/v2-quality-route-loop-dag.test.ts` (uses `mock.module` + real executor + real bash — MUST run as its OWN isolated `bun test` segment). Prove all four route outcomes end-to-end with a stubbed `quality-gate-summary` output driving each case: (a) `gate:"PASS"` → `verify-quality-summary` outputs `PASS` → `create-pull-request` reached, `dev-story` ran once; (b) `gate:"FAIL"` round 1 then `gate:"PASS"` round 2 → `dev-story` re-runs (assert it executed twice) and the same `story_ref` flows both rounds, then forward to `create-pull-request`; (c) summary node FAILS (exit non-zero, the `ERROR` case) → `verify-quality-summary` does not run, `quality-route-loop` cannot evaluate, workflow terminates, `dev-story` did NOT re-run and `create-pull-request` NOT reached; (d) `gate:"FAIL"` on every round past `max_iterations` → `exhausted` → `review-loop-error` runs (exit 1) and records findings + round count, `create-pull-request` NOT reached. Follow `v2-quality-summary-dag.test.ts` for the harness.
  - [x] Register `v2-quality-route-loop-contract.test.ts` in the non-mock workflow-defaults batch and `v2-quality-route-loop-dag.test.ts` as its OWN `bun test` segment in `packages/workflows/package.json` (never co-locate a `mock.module` file).

- [x] **Task 7 — Regenerate bundle + validate (AC: #5, #6)**
  - [x] `bun run generate:bundled` to refresh `packages/workflows/src/defaults/bundled-defaults.generated.ts`; then `bun run check:bundled` to confirm no drift.
  - [x] `bun test packages/workflows/src/defaults/v2-quality-route-loop-contract.test.ts` and the isolated `...-dag.test.ts`; then `bun run validate` before finishing.

### Review Findings

- [x] [Review][Patch] `review-loop-error` records `round: "0"` instead of reading the actual active round from `state.json` because the `bun -e` snippet reads `process.env.RLE_STATE` but the shell command never sets `RLE_STATE="$STATE"` [.archon/workflows/defaults/bmad-dev-story-with-tea-fix-loop-v2.yml:946].
- [x] [Review][Patch] The new route-loop tests embed a real story key and their naming-hygiene guard exempts it, despite the story rule that code and test artifacts must not carry plan, story, epic, or finding identifiers [packages/workflows/src/defaults/v2-quality-route-loop-contract.test.ts:146].

## Dev Notes

### Scope in one line

Consolidate the v2 quality routing into ONE bounded `route_loop` sourced from `quality-gate-summary`: add a `verify-quality-summary` reader that turns the summary JSON into a bare `PASS`/`FAIL`, remove the `code-review-gate` route_loop, add `quality-route-loop` (FAIL→`dev-story`, PASS→`create-pull-request`, exhausted→`review-loop-error`), and keep `ERROR` fail-closed (summary node fails → loop never evaluates → never reroutes to `dev-story`).

### Design decision: one loop, at the summary (READ — this reverses an implemented loop)

The governing architecture is explicit and stated three independent ways:
`quality-gate-summary` is the **only** source for `quality-route-loop` [Source: architecture.md#A-AD-5, lines 77-83];
Epic A4 is titled **"One Quality Route Loop"** and says "route exactly one bounded fix loop" [Source: epics.md#Epic A4, lines 155-157];
this story's own driver is "one bounded quality route loop after summary" [Source: epics.md#Story A4.2, lines 213-215].
The architecture mermaid routes `CR --> gate-planner` with **no loop at CR**, and shows the single loop as `Summary --> Loop`, `Loop -->|FAIL| DS`, `Loop -->|PASS| Decision`, `Loop -->|exhausted| LoopError` [Source: architecture.md#Architecture Paradigm, lines 42-60].

The current v2 YAML diverges: it has a `code-review-gate` route_loop that short-circuits CR `FAIL` straight back to `dev-story` BEFORE the TEA gates run. This story removes that loop and makes the summary the single routing authority. Rationale beyond the spec: the workflow engine analysis found that two `route_loop` nodes both routing `negative` to `dev-story` with overlapping back-paths is **untested and re-entrant** (the summary loop's back-path would re-run the CR `route_loop` node mid-path). Consolidating to one loop is both spec-aligned and the safer engine behavior.

**Trade-off (documented, not hidden):** with the single summary loop, the TEA gates (`tea-rv`/`tea-nr`/`tea-tr` — expensive AI passes) run even on a round where CR failed, before the loop routes back. The removed short-circuit avoided that. `gate-planner` still gates RV on `test_files_changed > 0` and NR on `nfr_relevant`, so the extra cost per fail-round is typically `tea-tr` (+ `tea-rv` when tests changed), bounded by `max_iterations`. If the operator wants to keep the CR short-circuit for compute savings, that is a deliberate divergence from A-AD-5 — see Unresolved Questions #1 before deviating.

### Why a reader node (`verify-quality-summary`) is required

A `route_loop` `condition` that uses field access (`$node.output.gate == 'PASS'`) is rejected at load time unless the `from` node declares `output_format.properties` with that field [Source: packages/workflows/src/loader.ts:336-341, `validateRouteLoopStructure`]. `quality-gate-summary` is a `bash:` node that `printf`s JSON — it has no `output_format` schema, so a field-access condition on it fails loader validation. The proven pattern already in this file is a bash "gate reader": `verify-story-identity` reads the CR JSON and `printf`s a bare `PASS`/`FAIL`, and `code-review-gate`'s condition is the bare-output form `"$verify-story-identity.output == 'PASS'"` [Source: v2 YAML lines 335-407]. `verify-quality-summary` replicates that pattern for the summary. (Bare-output conditions bypass field-ref loader validation entirely — the loader only validates `.field` refs.)

### Why `ERROR` cannot reach `dev-story` (the clean fail-closed path)

a4.1's `quality-gate-summary` **exits non-zero** (fails the node) on any role `ERROR`, missing/empty required contract, or identity mismatch — it never emits a `gate: "ERROR"` value [Source: a4-1-aggregate-quality-gate-summary.md, AC #5 + Task 3, lines 19, 39-42]. Downstream, `verify-quality-summary` `depends_on: [quality-gate-summary]`, so a failed summary means `verify-quality-summary` never runs; and even if it ran, the `route_loop` engine refuses to evaluate a condition whose `from` node is not `completed` — it fails the route_loop node rather than routing `negative` [Source: dag-executor.ts:3791-3800, "route_loop cannot evaluate condition because '<from>' has not completed successfully"]. Net: an `ERROR` terminates the workflow before any reroute to `dev-story`. This is the mechanism that satisfies AC #4 and the epic's "ERROR does not route to `dev-story`" integration check — assert it in DAG fixture (c), do NOT add a separate error branch.

### route_loop engine facts you can rely on (verified in source)

- **Schema** [Source: packages/workflows/src/schemas/route-loop.ts:6-36]: `route_loop` requires `from` (a node id), `condition` (non-empty string), and `routes` (strict object with required `positive`/`negative`/`exhausted` node ids). `max_iterations` is `int 1..100`, default 10. The block is `.strict()` (no extra keys). `dagNodeSchema` forbids `when`, `trigger_rule`, and `retry` on a route_loop node [dag-node.ts:597-618].
- **Routing** [Source: packages/workflows/src/route-loop-state.ts:52-65]: condition TRUE → `positive`, counter resets to 0. Condition FALSE → counter++; `count > max_iterations` → `exhausted`, else `negative`. So `max_iterations: 20` allows 20 `FAIL` reroutes to `dev-story`; the 21st `FAIL` evaluation routes to `exhausted`. Counters are keyed by the route_loop node id in run metadata `loopCounters` [workflow-run.ts:132], persisted per decision.
- **Back-edge re-run** [Source: dag-executor.ts:903-934 `buildSelectedRouteRerunPlan` + loader.ts:237-272 `collectPathNodesToTarget`]: a `negative` → `dev-story` re-runs exactly the nodes on the forward path from `dev-story` to the loop's `from` (inclusive), plus the route_loop node. With `from: verify-quality-summary`, the negative back-path re-runs `dev-story → tea-automate → code-review-auto → verify-story-identity → gate-planner → (RV/NR branches) → tea-tr[/-skipped] → quality-gate-summary → verify-quality-summary → quality-route-loop`. Nodes off that path (e.g. `resolve-story-input`) keep their cached output and do NOT re-run — this is why `story_ref` is stable across rounds (AC #1).
- **Loader validation** [Source: loader.ts:274-347 `validateRouteLoopStructure`]: the route_loop node must have exactly one `depends_on` equal to `from`; `positive` and `exhausted` targets must NOT be able to reach `from` (enforced exits); `negative` may reach back; the `condition` may only reference `from`. Multiple route_loop nodes are legal in one DAG, but this story intentionally leaves exactly one.

### Preconditions — the a4.1 baseline this story builds on (READ FIRST)

Architecture places the loop AFTER the summary: `... TR / TRSkip --> quality-gate-summary --> quality-route-loop --> create-pull-request` [Source: architecture.md#Architecture Paradigm, lines 42-60]. Epic A4.2 declares `Depends on: Story A4.1` and `Blocking behavior: This story cannot complete until PASS, FAIL, ERROR, and exhaustion paths are validated` [Source: epics.md#Story A4.2, lines 217-219]. a4.1 (marked `done`) produced the four-role `quality-gate-summary` that emits a routable `gate: PASS|FAIL` and exits non-zero on `ERROR` [Source: a4-1-aggregate-quality-gate-summary.md, Completion Notes + File List, lines 181-201]. This story adds the routing on top of that contract — it invents no new summary fields.

### Verified current state of THIS worktree (a discrepancy the dev must resolve)

The v2 YAML in this checkout is at the **~a3.2** state, NOT the a4.1 (or even a3.3) state.
Verified by direct read of `.archon/workflows/defaults/bmad-dev-story-with-tea-fix-loop-v2.yml`: `tea-tr` (line 701) is unconditional (no `when`, no `output_format`); there is NO `tea-tr-skipped`; there is NO `quality-gate-summary`; `create-pull-request` (line 733) declares `depends_on: [tea-tr]`; and a `code-review-gate` route_loop (lines 398-407) is present.
Root cause: the `_bmad-output` planning/implementation docs were authored in a different primary checkout (`story_location:` in `sprint-status.yaml` points at `.../OceanLabs/workflow-engine/Archon/...`); this worktree has not received the a3.3 + a4.1 code merges, and its dependencies are not installed.
Consequence: **Task 0 is a hard gate.** Confirm/rebase the a3.3 + a4.1 baseline before editing (recommended), or explicitly fold their wiring into this story. Record the path taken. This mirrors exactly what a4.1's dev faced and resolved (a4.1 folded a3.3 in). See Unresolved Questions #3.

### The files you touch

- `.archon/workflows/defaults/bmad-dev-story-with-tea-fix-loop-v2.yml` — UPDATE (add `verify-quality-summary`, add `quality-route-loop`, remove `code-review-gate`, rewire `gate-planner` / `create-pull-request` / `review-loop-error` `depends_on`, ensure `review-loop-error` records findings+round).
- `packages/workflows/src/defaults/bundled-defaults.generated.ts` — REGENERATED (never hand-edit; run `bun run generate:bundled`).
- `packages/workflows/src/defaults/v2-quality-route-loop-contract.test.ts` — NEW (co-located, no `mock.module`).
- `packages/workflows/src/defaults/v2-quality-route-loop-dag.test.ts` — NEW (isolated `bun test` segment; uses `mock.module`).
- `packages/workflows/package.json` — UPDATE (wire both new test files into the correct test segments).

Do NOT modify: `bmad-dev-story-with-tea-fix-loop.yml` (v1 baseline — byte-for-byte unchanged), `quality-gate-summary` (owned by a4.1 — you consume its contract, you do not change it), `verify-story-identity` (keep as the CR identity barrier; only `gate-planner`'s `depends_on` moves onto it), the `gate-planner` body, the TEA branch nodes, or any `@archon/core` / `@archon/server` / engine (`dag-executor.ts`, `loader.ts`, `route-loop*.ts`) code. This is a DAG-wiring + bash-reader change plus tests — the executor already supports every primitive used (`bash`, `route_loop`, `depends_on`, whole-output substitution, bare-output condition).

### Target node shapes (author these)

`verify-quality-summary` (NEW bash reader — model on `verify-story-identity`, lines 335-396):

```yaml
- id: verify-quality-summary
  bash: |
    set -e
    SUMMARY=$quality-gate-summary.output
    RESOLVED_REF=$resolve-story-input.output.story_ref
    # JSON.parse + validate envelope/identity, extract gate, fail closed on anything
    # that is not a clean PASS/FAIL, then printf the bare gate. Use bun -e + JSON.parse.
    GATE=$(
      QRS_SUMMARY="$SUMMARY" QRS_RESOLVED="$RESOLVED_REF" \
      bun -e '
        const s = JSON.parse(process.env.QRS_SUMMARY || "");
        if (s.contract_version !== "1.0") { console.error("ERROR: contract_version"); process.exit(1); }
        if (s.workflow !== "bmad-dev-story-with-tea-fix-loop-v2") { console.error("ERROR: workflow"); process.exit(1); }
        if (s.node !== "quality-gate-summary") { console.error("ERROR: node"); process.exit(1); }
        if (!s.story_ref || s.story_ref !== process.env.QRS_RESOLVED) { console.error("ERROR: story_ref"); process.exit(1); }
        if (s.gate !== "PASS" && s.gate !== "FAIL") { console.error("ERROR: gate"); process.exit(1); }
        process.stdout.write(s.gate);
      '
    )
    printf '%s' "$GATE"
  timeout: 60000
  depends_on: [quality-gate-summary, resolve-story-input]
  output_type: quality-summary-verified
```

`quality-route-loop` (NEW route_loop — model on `code-review-gate`, lines 398-407):

```yaml
- id: quality-route-loop
  depends_on: [verify-quality-summary]
  route_loop:
    from: verify-quality-summary
    condition: "$verify-quality-summary.output == 'PASS'"
    max_iterations: 20
    routes:
      positive: create-pull-request
      negative: dev-story
      exhausted: review-loop-error
```

Reminder on bash assignments: variable-substitution values are already shell-quoted by the executor, so write `SUMMARY=$quality-gate-summary.output` UNQUOTED (not `="$..."`) — a3.3 executor note, carried in a4.1 Dev Notes.

### Contract envelope + project invariants that bite here

- JSON contracts are the only route API; never parse markdown/prose for routing; missing/invalid/untrusted JSON ⇒ `ERROR` [Source: architecture.md#A-AD-2, lines 51-57; project-context.md "Critical Don't-Miss Rules"]. `verify-quality-summary` reads only `quality-gate-summary`'s JSON output.
- `ERROR` is separate from `FAIL` and must NOT route to `dev-story` [Source: architecture.md#A-AD-5, lines 77-83; project-context.md]. Achieved structurally (summary node failure halts the loop) — see "Why ERROR cannot reach dev-story".
- Story identity: every route-facing contract in one run carries the same `story_ref`; mismatch is `ERROR`, never a recoverable warning [Source: architecture.md#Story Identity Rule, lines 141-146]. `verify-quality-summary` re-checks `story_ref` against `$resolve-story-input.output.story_ref`; the `negative` back-edge does not re-run `resolve-story-input`, so `story_ref` is stable (AC #1).
- Gate outputs use only `PASS`, `FAIL`, `CONCERNS`, `SKIPPED`, `ERROR` [Source: architecture.md#Contract Envelope, lines 133-139]. The summary's routing `gate` is `PASS`|`FAIL` only (a4.1); `verify-quality-summary` accepts exactly those two and fails closed otherwise.
- Bundled defaults are GENERATED from `.archon/workflows/defaults/`; NEVER hand-edit `bundled-defaults.generated.ts`. Run `bun run generate:bundled` after YAML edits; `bun run validate` / CI runs `check:bundled` and fails on drift [Source: project-context.md, CLAUDE.md].
- Bun `mock.module()` is process-global and irreversible; any NEW test file using it runs as its OWN isolated `bun test` segment in `packages/workflows/package.json`. Contract tests without `mock.module` co-locate safely [Source: project-context.md Testing Rules, CLAUDE.md]. Do NOT run root `bun test`; use `bun run test` or a single-file invocation.
- No plan/finding/epic/story identifiers in code or test artifacts (no `A4.2`, `A-FR-5`, `a4-2`, `R1-F1`, etc.). `TD-nnn` / `AC#` scenario tags are the allowed stable test taxonomy. Node ids and `output_type` labels are kebab-case [Source: CLAUDE.md rule 5, project-context.md]. a4.1's review added guard regexes catching `R\d-F\d` and `a\d.\d` in test files — keep the new tests clean of these.
- Long Markdown: one full sentence per physical line (applies to any `.md` you touch) [Source: project-context.md].
- All new TS satisfies strict config (explicit return types, no unused, no `any` without a justifying comment); single quotes, semicolons, 2-space indent, `printWidth: 100`.

### Previous story intelligence (a4.1 — the direct dependency)

- a4.1 evolved `quality-gate-summary` into the four-role aggregator; its contract is your input. It emits `gate` (`PASS`|`FAIL`), `round` (from `code-review-auto.output.round`), `blocking_count`, `decision_needed_count`, `findings_total`, and `cr_gate`/`rv_gate`/`nr_gate`/`tr_gate` echoes; it exits non-zero on `ERROR`/missing/mismatch [Source: a4-1 Tasks 1-3, Completion Notes].
- a4.1 review findings that carry into your test discipline: whole-output `$node.output` returns `''` for a skipped node and never throws (field-level access on a skipped node throws `producer-not-run`) — your reader uses whole-output on `quality-gate-summary` (which always runs, never skipped, so this is safe either way); parse/serialize JSON only with `bun -e` + `JSON.parse`/`JSON.stringify`, never `grep`/`case` on raw JSON; node-identity validation must check the EXACT expected producer id, not either/or [Source: a4-1 Review Findings R1-F1..R3-F1, lines 59-63].
- a4.1's tests (`v2-quality-summary-contract.test.ts`, `v2-quality-summary-dag.test.ts`) are the closest templates for your two new files — copy their parse-from-disk harness (contract) and mock.module + real-bash executor harness (DAG).

### Project Structure Notes

The workflow source of truth is the YAML under `.archon/workflows/defaults/`; the TypeScript bundle is a generated mirror. Node ids, `depends_on`, and `route_loop` blocks all live in the YAML. This change is additive-plus-one-removal in the v2 file (two new nodes, one removed node, three rewired `depends_on`) and touches no runtime engine code — the executor already supports `route_loop`, bare-output conditions, and whole-output substitution (verified in source). Alignment note: after this story the v2 DAG matches the architecture mermaid's `Summary --> Loop --> {DS | PR | LoopError}` shape, with the single loop sourced (via the reader) from `quality-gate-summary`; the a4.1 variance (summary → `create-pull-request` directly, no loop) is now resolved.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story A4.2: Route Quality Loop And Error Paths, lines 211-236] — story statement, ACs (FAIL→dev-story same story_ref, PASS→decision-needed-check, exhaustion→review-loop-error records open findings + round count), dependency on A4.1, integration validation (FAIL routes to dev-story, PASS forward, ERROR not to dev-story, exhaustion writes review-loop-error).
- [Source: _bmad-output/planning-artifacts/architecture.md#A-AD-5 One Quality Route Loop, lines 77-83] — quality-gate-summary is the ONLY source for the loop; FAIL→dev-story; PASS→decision-needed-check; exhaustion→review-loop-error; ERROR ≠ FAIL and must not route to dev-story.
- [Source: _bmad-output/planning-artifacts/architecture.md#Architecture Paradigm mermaid, lines 42-60] — Summary → Loop → {DS (FAIL) | Decision (PASS) | LoopError (exhausted)}; CR → gate-planner with no CR-level loop.
- [Source: _bmad-output/planning-artifacts/architecture.md#A-AD-2 + Contract Envelope + Story Identity Rule, lines 51-57, 122-146] — JSON-only routing, gate vocabulary, same-story_ref invariant, fail-closed on missing/invalid JSON.
- [Source: _bmad-output/implementation-artifacts/a4-1-aggregate-quality-gate-summary.md] — the `quality-gate-summary` contract you consume (gate PASS|FAIL, round, decision_needed_count, exits non-zero on ERROR), and the JSON.parse / node-identity / whole-output test discipline.
- [Source: .archon/workflows/defaults/bmad-dev-story-with-tea-fix-loop-v2.yml] — `verify-story-identity` bash gate-reader pattern to mirror (335-396); `code-review-gate` route_loop to remove and mirror shape from (398-407); `gate-planner` (409-555); `review-loop-error` (712-731); `create-pull-request` (733-739). NOTE this file is at the ~a3.2 state in THIS worktree — Task 0 reconciles that.
- [Source: packages/workflows/src/schemas/route-loop.ts:6-36] — route_loop schema: required `from`/`condition`/`routes`, `max_iterations` int 1..100 default 10, strict object, no `when`/`trigger_rule`/`retry`.
- [Source: packages/workflows/src/route-loop-state.ts:52-65] — TRUE→positive (counter reset); FALSE→counter++ then negative (count<=max) or exhausted (count>max).
- [Source: packages/workflows/src/loader.ts:274-347 validateRouteLoopStructure + 336-341] — route_loop DAG validation; field-ref conditions require `from` to declare `output_format.properties` (why a bash reader node is needed).
- [Source: packages/workflows/src/dag-executor.ts:903-934 + 3791-3800] — negative back-edge re-run plan; route_loop fails (does not route negative) when `from` is not completed (the ERROR fail-closed mechanism).
- [Source: packages/workflows/src/dag-executor.test.ts + loader.test.ts + condition-evaluator.test.ts] — existing route_loop test patterns (end-to-end rerun order, two-loop cases, field-ref/exit-path loader validation) to reference.
- [Source: _bmad-output/project-context.md] — bundled-defaults generation, mock.module isolation, no-plan-refs-in-code, fail-closed-on-JSON, story-identity, ERROR-≠-FAIL, SDK/package-boundary rules.

### ATDD Artifacts

Red-phase acceptance scaffolds generated before implementation (TDD red):

- Checklist: `_bmad-output/test-artifacts/atdd-checklist-a4-2-route-quality-loop-and-error-paths.md`
- Contract tests (co-located, no `mock.module`): `packages/workflows/src/defaults/v2-quality-route-loop-contract.test.ts`
- DAG tests (isolated `bun test` segment, `mock.module`): `packages/workflows/src/defaults/v2-quality-route-loop-dag.test.ts`
- Both files are registered in `packages/workflows/package.json` (contract in the shared non-mock batch; DAG as its own standalone segment).
- All scenarios assert target behavior and are RED against this ~a3.2 checkout until Task 0's baseline plus the reader/loop wiring land.

## Unresolved Questions

1. **CR short-circuit removal (design confirmation).** This story removes the `code-review-gate` route_loop and consolidates to a single loop at the summary, per the architecture (A-AD-5 "ONLY source", Epic A4 "One Quality Route Loop"). The cost is that TEA gates run even on CR-failing rounds. The operator was asked to confirm consolidate-vs-keep-both and did not select; the story proceeds on the spec-mandated consolidation. If the operator instead wants to preserve the CR short-circuit for compute savings, that is a deliberate divergence from A-AD-5 and changes Tasks 2-4 — confirm before the dev deviates.
2. **Loop budget: 3 vs 20.** The workflow `description` says "up to three rounds" and `prepare-bmad-state`'s `state.json` sets `maxRounds: 3`, but the implemented `code-review-gate` uses `max_iterations: 20`. This story preserves `20` for the consolidated loop (continuity with the loop it replaces). Confirm whether the intended quality-loop budget is `3` or `20`; if `3`, set `max_iterations: 3` and reconcile the `state.json`/description drift.
3. **a4.1/a3.3 baseline not present in this worktree.** The v2 YAML here is at the ~a3.2 state (no `quality-gate-summary`, `tea-tr` unconditional, no `tea-tr-skipped`), yet sprint-status marks a3-3 and a4-1 `done`. Task 0 blocks on rebasing/merging those, or folding their wiring in. Confirm the dev should rebase the upstream branch into this worktree (recommended) before starting.
4. **`decision-needed-check` forward target (a5.1 seam).** Epic A4.2 AC #2 literally says PASS routes "to `decision-needed-check`", but that node is a5.1's deliverable and route targets must reference existing nodes. This story routes `positive → create-pull-request` (the "PASS routes forward" integration check), and a5.1 will insert `decision-needed-check` at that seam. Confirm this deferral is acceptable (it is the only option that keeps the DAG valid in a4.2 scope).

## Dev Agent Record

### Agent Model Used

Qoder (Claude Sonnet 4 via Claude Code SDK)

### Debug Log References

- Task 0: Confirmed a4.1 baseline (quality-gate-summary, tea-tr gated, tea-tr-skipped) already present in this worktree's v2 YAML along with all a4.2 wiring (verify-quality-summary, quality-route-loop, code-review-gate removed, gate-planner/create-pull-request/review-loop-error rewired). No rebase needed.
- Prettier format fix: 6 files (3 test-artifacts markdown + 3 test TS files) had formatting drift; fixed with `bun x prettier --write`.
- Stale test references: `v2-cr-auto-routing.test.ts` had two assertions referencing the removed `code-review-gate` node (lines 443, 524). Updated both to `quality-route-loop` with `not.toBe('completed')` semantics.

### Completion Notes List

- All 8 tasks completed. The v2 YAML consolidates to exactly one quality route loop sourced from quality-gate-summary via the verify-quality-summary bash reader.
- Contract test: 47/47 pass (TD-200 through TD-235). Covers YAML structure, reader safety, technique proofs, bundle parity, naming conventions, and test registration.
- DAG test: 9 pass, 1 expected skip (TD-220 through TD-229). Proves all four route outcomes end-to-end with real bash + real executor: PASS→forward, FAIL→re-run then PASS, ERROR→no reroute, exhaustion→review-loop-error.
- Full `bun run validate` passes: check:bundled, check:bundled-skill, check:bundled-schema, check:pi-vendor-map, type-check, lint (0 warnings), format, and all test segments.
- No engine code was modified. This was purely a DAG-wiring + bash-reader change plus tests, as the story scope mandated.

### File List

- `.archon/workflows/defaults/bmad-dev-story-with-tea-fix-loop-v2.yml` — Updated (verify-quality-summary + quality-route-loop added, code-review-gate removed, gate-planner/create-pull-request/review-loop-error rewired, review-loop-error records findings + round count)
- `packages/workflows/src/defaults/bundled-defaults.generated.ts` — Regenerated via `bun run generate:bundled`
- `packages/workflows/src/defaults/v2-quality-route-loop-contract.test.ts` — New (47 assertions, co-located in non-mock batch)
- `packages/workflows/src/defaults/v2-quality-route-loop-dag.test.ts` — New (9 pass + 1 skip, isolated bun test segment)
- `packages/workflows/package.json` — Updated (contract test in shared batch, DAG test as standalone segment)
- `packages/workflows/src/defaults/v2-cr-auto-routing.test.ts` — Fixed two stale code-review-gate references
- `packages/workflows/src/defaults/v2-gate-planner-contract.test.ts` — Prettier format fix
- `_bmad-output/test-artifacts/atdd-checklist-a4-2-route-quality-loop-and-error-paths.md` — Prettier format fix
- `_bmad-output/test-artifacts/test-design-progress.md` — Prettier format fix
- `_bmad-output/test-artifacts/test-design/test-design-a4-2-route-quality-loop-and-error-paths.md` — Prettier format fix

### Fix Pass (Round 2)

Applied fixes for two CR findings (R1-F1 High, R1-F2 Medium).

**R1-F1 fix**: Added `RLE_STATE="$STATE"` env var prefix to the `bun -e` command in `review-loop-error` so the Bun process receives the state file path.
Tightened TD-223 to parse `review-loop-error.json` and assert the round field is a positive integer (not just that the word "round" appears).

**R1-F2 fix**: Replaced real story key `a1-2-preserve-story-input-resolution` with neutral synthetic `x1-0-synthetic-quality-ref` in both route-loop test files.
The `x1-0-` prefix satisfies `resolve-story-input`'s awk key pattern (`[a-z][a-z0-9]*-[0-9]+-`) without matching the naming-hygiene guard (`a[0-9][-.][0-9]`).
Removed the `!line.includes('CANONICAL_REF')` exemption from the guard.
Broadened the guard regex from `a[0-9]\.[0-9]` to `a[0-9][-.][0-9]` to catch both dotted and hyphenated story identifiers.

**Validation**: Contract 47/47 pass, DAG 9 pass + 1 skip, `bun run validate` exit 0.
