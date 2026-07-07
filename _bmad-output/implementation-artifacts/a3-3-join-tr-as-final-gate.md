# Story a3.3: Join TR As Final Gate

Status: in-progress

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As an Archon workflow maintainer,
I want `TR` (traceability review) to run after resolved `RV` and `NR` branch outputs, with an explicit skipped-branch sibling,
so that traceability is evaluated as the final release gate and the tail still resolves whether `TR` runs or is skipped.

## Acceptance Criteria

1. **Given** `run_tr` is true, **When** the `RV` and `NR` branches resolve, **Then** `tea-tr` runs with a valid `trigger_rule` **And** it consumes either the real gate contracts (`tea-rv.gate.json` / `tea-nr.gate.json`) or the skipped contracts (`tea-rv-skipped.gate.json` / `tea-nr-skipped.gate.json`).
2. **Given** `run_tr` is false, **When** the `TR` branch resolves, **Then** `tea-tr-skipped` emits a `SKIPPED` contract **And** the downstream successor can still run from a resolved TR-role contract.
3. **Given** the edited v2 workflow, **When** it is parsed by `parseWorkflow` (the same schema + DAG validation the CLI `validate workflows` invokes), **Then** it passes schema and DAG validation with `when:` and `trigger_rule` usage valid.
4. **Given** a real `RV` or `NR` branch node fails, **When** the `tea-tr` join evaluates, **Then** `tea-tr` must NOT run and the tail must NOT be reached (fail-closed, not `all_done`).
5. **Given** the change lands, **When** the bundled defaults are regenerated, **Then** source (`.archon/workflows/defaults/...`) and bundle (`bundled-defaults.generated.ts`) stay consistent, and the v1 baseline workflow is untouched.

## Tasks / Subtasks

- [ ] **Task 1 — Gate `tea-tr` on `run_tr` and add its output contract (AC: #1, #3)**
  - [ ] In `.archon/workflows/defaults/bmad-dev-story-with-tea-fix-loop-v2.yml`, add `when: "$gate-planner.output.run_tr == true"` to the existing `tea-tr` node.
  - [ ] Add a `prompt_suffix` to `tea-tr` that pins `$resolve-story-input.output.story_ref` and instructs the model to emit the required structured fields (mirror the `tea-rv` / `tea-nr` prompt_suffix, lines 561-570 / 633-642).
  - [ ] Add an `output_format` object schema to `tea-tr` with required fields: `contract_version`, `workflow`, `node`, `gate` (enum `[PASS, FAIL, CONCERNS, ERROR]` — NO `SKIPPED`), `story_ref`, `findings_count`, `report_file`. Copy the shape from `tea-rv`/`tea-nr` (lines 576-602).
  - [ ] Keep `tea-tr`'s existing `depends_on: [tea-rv, tea-rv-skipped, tea-nr, tea-nr-skipped]`, `trigger_rule: none_failed_min_one_success`, `provider: claude`, `model: sonnet`, `context: fresh`, `idle_timeout: 900000`, and `output_type: trace-findings`.
- [ ] **Task 2 — Add the `tea-tr-skipped` sibling node (AC: #2, #3)**
  - [ ] Add a new `bash:` node `tea-tr-skipped` with `when: "$gate-planner.output.run_tr == false"` and `depends_on: [gate-planner]` (it depends on gate-planner directly, NOT on the RV/NR branches — see Dev Notes "DAG shape").
  - [ ] Emit a `gate: "SKIPPED"` contract via the `bun -e 'JSON.stringify(...)'` encoder pattern (copy `tea-rv-skipped`, lines 605-627). Fields: `contract_version:"1.0"`, `workflow:"bmad-dev-story-with-tea-fix-loop-v2"`, `node:"tea-tr-skipped"`, `story_ref` (from `$resolve-story-input.output.story_ref`), `gate:"SKIPPED"`, `findings_count:0`, `reason` (from `$gate-planner.output.reason_tr`).
  - [ ] Best-effort write `$RUN_DIR/tea-tr-skipped.gate.json` (mirror lines 620-624).
  - [ ] Set `timeout: 60000` and `output_type: trace-skipped`.
- [ ] **Task 3 — Rewire the tail so it resolves from either TR branch (AC: #2, #4)**
  - [ ] Change `create-pull-request` `depends_on: [tea-tr]` → `depends_on: [tea-tr, tea-tr-skipped]` and add `trigger_rule: none_failed_min_one_success` so the tail runs from whichever TR branch resolved and fails closed if a real branch failed.
- [ ] **Task 4 — Update the predecessor (a3.2) tests that assert the pre-a3.3 state (AC: #1, #2, #5)**
  - [ ] In `packages/workflows/src/defaults/v2-tea-branches-contract.test.ts`, the `TD-010` block (lines 298-313) asserts `tea-tr` has NO `when:`, that `tea-tr-skipped` is absent ("belongs to a later story"), and that `create-pull-request` depends on `['tea-tr']`. Update these assertions to the a3.3 reality (see Dev Notes "Regression map"). Do NOT delete the fail-closed / `none_failed_min_one_success` / four-way-`depends_on` assertions — those stay true.
  - [ ] Update the `TD-016` additive-count assertion (lines 385-391) — `tea-tr-skipped` is now a third new node id versus the branch baseline.
  - [ ] In `packages/workflows/src/defaults/v2-tea-branches-dag.test.ts`, the happy-path scenarios drive the real `gate-planner` which emits `run_tr=true`, so `tea-tr` still completes on every happy path — confirm those assertions still hold after adding `when: run_tr == true`. Only fix a scenario if it breaks.
- [ ] **Task 5 — Add a3.3 coverage for the TR join + skip contract (AC: #1, #2, #4)**
  - [ ] Add structural/contract assertions (co-located contract test is fine — no `mock.module`): `tea-tr` has `when == "$gate-planner.output.run_tr == true"`, an `output_format` with the required gate-envelope fields and gate enum excluding `SKIPPED`, and a `prompt_suffix` pinning `story_ref`; `tea-tr-skipped` exists as a bash node with the inverse `when`, `depends_on: [gate-planner]`, `timeout: 60000`, `output_type: trace-skipped`, uses the `JSON.stringify` encoder, and sets `gate:"SKIPPED"`; `create-pull-request` depends on `['tea-tr', 'tea-tr-skipped']` with `trigger_rule: none_failed_min_one_success`.
  - [ ] Add a condition-evaluator unit proof that `run_tr` boolean drives exactly one TR branch per flag value (mirror `v2-tea-branches-contract.test.ts` TD-014, lines 142-163) — this is how the `run_tr=false` path is proven, since the real gate-planner always emits `run_tr=true`.
  - [ ] Add/extend a DAG behavioral proof (in the isolated `v2-tea-branches-dag.test.ts` invocation, or a new isolated file) that on the real-gate-planner happy path `tea-tr` completes and `tea-tr-skipped` is `skipped`; and that a failed real `RV`/`NR` branch keeps `tea-tr` from completing and the tail unreachable (extend TD-005/TD-006, lines 629-686).
  - [ ] Register any NEW `mock.module`-using DAG test file as its OWN isolated `bun test` segment in `packages/workflows/package.json` (never co-located).
- [ ] **Task 6 — Regenerate bundle + validate (AC: #3, #5)**
  - [ ] Run `bun run generate:bundled` to refresh `packages/workflows/src/defaults/bundled-defaults.generated.ts`.
  - [ ] Run `bun run check:bundled` to confirm no drift.
  - [ ] Run the affected package tests, then `bun run validate` before finishing.

### Review Findings

- [x] [Review][Patch] R1-F1 — The new TR join acceptance tests are not wired into the normal package test script.
      Evidence: `packages/workflows/src/defaults/v2-tr-join-dag.test.ts:23` documents that the DAG file uses `mock.module()` and must run in its own invocation, but `packages/workflows/package.json:26` does not include either `v2-tr-join-contract.test.ts` or `v2-tr-join-dag.test.ts`.
      Required fix: add `v2-tr-join-contract.test.ts` to a non-mock workflow defaults test batch and add `v2-tr-join-dag.test.ts` as its own `bun test` segment.
- [x] [Review][Patch] R1-F2 — A schema-valid real `tea-tr` gate with `gate: "FAIL"` or `gate: "ERROR"` can still allow `create-pull-request` to run.
      Evidence: `tea-tr.output_format` allows `FAIL` and `ERROR`, while `create-pull-request` only checks upstream node completion via `none_failed_min_one_success`.
      Required fix: add a deterministic post-TR gate verification or summary step before PR handoff that blocks unacceptable real TR gate values before `create-pull-request` can run.
- [x] [Review][Patch] R1-F3 — If `run_tr` is false while a real RV or NR branch fails, the PR tail can still run from `tea-tr-skipped`.
      Evidence: `tea-tr-skipped` depends only on `gate-planner`, and `create-pull-request` depends only on `tea-tr` and `tea-tr-skipped`.
      Required fix: add a fail-closed barrier or summary before PR handoff that depends on resolved RV, NR, and TR role branches and blocks the tail when any real RV or NR branch failed.
- [x] [Review][Patch] R1-F4 — The new `quality-gate-summary` barrier breaks the `run_tr=false` path by unconditionally reading `$tea-tr.output.gate` even when `tea-tr` is skipped.
      Evidence: `.archon/workflows/defaults/bmad-dev-story-with-tea-fix-loop-v2.yml:799` assigns `GATE=$tea-tr.output.gate`, while skipped producers have no field output to read.
      Required fix: rework the barrier so it selects the resolved TR-role contract without dereferencing `$tea-tr.output.gate` when `tea-tr` is skipped, while preserving fail-closed behavior for branch failures and real TR `FAIL` / `ERROR` gates.
- [x] [Review][Patch] R1-F6 — `quality-gate-summary` allows an invalid real `tea-tr` contract to pass the final PR gate.
      Evidence: `.archon/workflows/defaults/bmad-dev-story-with-tea-fix-loop-v2.yml:799-807` reads `$tea-tr.output` and greps the raw JSON text only for `FAIL` / `ERROR`, while `tea-tr.output_format` only declares `contract_version`, `workflow`, `node`, `story_ref`, `gate`, `findings_count`, and `report_file` as broad primitive fields.
      Required fix: parse the real TR JSON contract deterministically before PR handoff and validate `contract_version`, `workflow`, `node`, `story_ref`, `gate`, and a non-negative `findings_count`; block `FAIL` / `ERROR` by parsed gate value and add tests for story or node mismatch plus formatted JSON and substring false positives.

## Dev Notes

### Scope in one line

Wire `TR` as the joined final release gate: gate the existing `tea-tr` on `run_tr == true`, give it a structured gate contract, add a `tea-tr-skipped` sibling for `run_tr == false`, and rewire the tail (`create-pull-request`) to resolve from whichever TR branch ran while failing closed on a real branch failure. This is the direct continuation of a3.2 (RV/NR sibling branches) — a3.2's tests explicitly deferred `tea-tr-skipped` and the `when:` on `tea-tr` to "a later story"; **this is that story.**

### The ONLY files you touch

- `.archon/workflows/defaults/bmad-dev-story-with-tea-fix-loop-v2.yml` — UPDATE (the primary artifact; edit `tea-tr`, add `tea-tr-skipped`, edit `create-pull-request`).
- `packages/workflows/src/defaults/bundled-defaults.generated.ts` — REGENERATED (never hand-edit; run `bun run generate:bundled`).
- `packages/workflows/src/defaults/v2-tea-branches-contract.test.ts` — UPDATE (fix the a3.2 assertions that asserted the pre-a3.3 state; add a3.3 structural assertions here or in a new co-located contract test).
- `packages/workflows/src/defaults/v2-tea-branches-dag.test.ts` — UPDATE (confirm happy path still holds; extend fail-closed proof). If you add a new `mock.module` DAG file, also UPDATE `packages/workflows/package.json` test script for isolation.

Do NOT modify: `bmad-dev-story-with-tea-fix-loop.yml` (v1 baseline — must stay byte-for-byte unchanged), `gate-planner` (owned by a3.1, already done and emitting `run_tr`/`reason_tr`), or any `@archon/core`/`@archon/server` code.

### Current state of `tea-tr` (v2 YAML, lines 701-710) — what you are changing

```yaml
- id: tea-tr
  prompt: |
    bmad-testarch-trace $ARGUMENTS
  provider: claude
  depends_on: [tea-rv, tea-rv-skipped, tea-nr, tea-nr-skipped]
  trigger_rule: none_failed_min_one_success
  context: fresh
  model: sonnet
  idle_timeout: 900000
  output_type: trace-findings
```

It already has the correct four-way `depends_on` and `trigger_rule` (a3.2 landed those). It is MISSING: the `when: run_tr == true` gate, the `output_format` gate contract, and the `prompt_suffix` that pins `story_ref`. Add those three; keep everything else.

### Target `tea-tr` (add `when`, `prompt_suffix`, `output_format`)

Model the `prompt_suffix` and `output_format` exactly on `tea-rv` (lines 557-603) and `tea-nr` (lines 629-675). Required contract fields: `contract_version`, `workflow`, `node` (`"tea-tr"`), `gate` (enum `["PASS","FAIL","CONCERNS","ERROR"]` — **SKIPPED is excluded from real branches**, only skip nodes emit it), `story_ref`, `findings_count`, `report_file`. `output_type: trace-findings` stays.

### Target `tea-tr-skipped` (NEW node — copy `tea-rv-skipped`, lines 605-627)

- `when: "$gate-planner.output.run_tr == false"`
- `depends_on: [gate-planner]` — the skip node hangs off `gate-planner`, exactly like `tea-rv-skipped`/`tea-nr-skipped`. It does NOT depend on the RV/NR branches. Architecture confirms this: the mermaid edge is `GP -->|not run_tr| TRSkip` [Source: _bmad-output/planning-artifacts/architecture.md#Architecture Paradigm, line 41].
- `bash:` body emits the SKIPPED contract via the `bun -e 'process.stdout.write(JSON.stringify({...}))'` encoder — never a naive `echo "{...}"` (a3.2 contract test TD-008 enforces this pattern for JSON-safety with backslash/quote/newline in `reason`).
- Contract fields: `contract_version:"1.0"`, `workflow:"bmad-dev-story-with-tea-fix-loop-v2"`, `node:"tea-tr-skipped"`, `story_ref` (from `$resolve-story-input.output.story_ref`), `gate:"SKIPPED"`, `findings_count:0`, `reason` (from `$gate-planner.output.reason_tr`).
- Best-effort artifact write to `$RUN_DIR/tea-tr-skipped.gate.json`.
- `timeout: 60000`, `output_type: trace-skipped`.

### DAG shape after your change

```
gate-planner ─┬─ (run_rv==true)  → tea-rv ────────────┐
              ├─ (run_rv==false) → tea-rv-skipped ─────┤
              ├─ (run_nr==true)  → tea-nr ─────────────┤→ tea-tr (when run_tr==true,
              ├─ (run_nr==false) → tea-nr-skipped ─────┘   none_failed_min_one_success) ─┐
              └─ (run_tr==false) → tea-tr-skipped ─────────────────────────────────────┬─┴→ create-pull-request
                                                                                        │   (depends_on both,
                                                                                        │    none_failed_min_one_success)
```

`tea-tr` joins the four RV/NR branch nodes; `tea-tr-skipped` is a fifth sibling off `gate-planner`. `create-pull-request` joins `[tea-tr, tea-tr-skipped]`. (Architecture's final target inserts `quality-gate-summary` between the TR join and the PR — that's a4.1, out of scope here. For a3.3 the current tail `create-pull-request` IS the "downstream successor" of AC #2.) [Source: _bmad-output/planning-artifacts/architecture.md#Architecture Paradigm, lines 37-48]

### CRITICAL: why the `run_tr=false` path is proven structurally, not behaviorally

`gate-planner` **hardcodes `RUN_TR=true`** with `reason_tr="Traceability review is the default final release gate."` [v2 YAML lines 527-528]. This is intentional and owned by a3.1 (done): at gate-planner time, CR has already passed (the route loop only advances on PASS) and RV/NR have not run yet, so there is no signal to set `run_tr=false`. **Do NOT modify `gate-planner` to fabricate a false path** — that reverses a3.1's completed decision and violates YAGNI (no accepted use case sets `run_tr=false` today).

Consequence: the real `gate-planner` bash always drives `tea-tr` (real) on the behavioral DAG test. The `run_tr=false` → `tea-tr-skipped` path is therefore proven by (1) a contract/structural assertion on the `when:` string and node wiring, and (2) a `condition-evaluator` unit proof that the boolean drives exactly one branch — mirroring how a3.2 proved skip paths in TD-014 (`v2-tea-branches-contract.test.ts` lines 142-163). The architecture still requires the node to exist and a `SKIPPED` fixture to be covered [Source: architecture.md#Validation Rules, line 151; #Workflow-Owned Nodes, line 104]. This keeps the a3.2 principle intact: a mocked `gate-planner` would be a fake test (TD-010) — so do not stub gate-planner to force `run_tr=false` in a behavioral test.

### Regression map — a3.2 tests that assert the pre-a3.3 state (MUST update)

In `packages/workflows/src/defaults/v2-tea-branches-contract.test.ts`:

- **TD-010, lines 298-308** — `it('tea-tr stays unconditional in scope — no when:, and tea-tr-skipped is absent')`. This now INVERTS: `tea-tr` MUST have `when == '$gate-planner.output.run_tr == true'`, and `tea-tr-skipped` MUST exist. Update the assertion (do not just delete it — flip it to assert the a3.3 wiring).
- **TD-010, lines 310-313** — `it('create-pull-request still depends on tea-tr (unchanged tail)')` asserts `depends_on` equals `['tea-tr']`. Update to `['tea-tr', 'tea-tr-skipped']` and assert `trigger_rule: none_failed_min_one_success`.
- **TD-016, lines 385-391** — `it('v2 change is additive — exactly two new node ids...')`. `tea-tr-skipped` is a third additive node id; extend the assertion to include it.
- **KEEP unchanged (still true):** TD-010 lines 282-296 — `tea-tr depends on all four RV/NR branch nodes` and `tea-tr uses none_failed_min_one_success`. These remain valid; do not touch them.

The a3.2 DAG tests (`v2-tea-branches-dag.test.ts`) drive the real gate-planner (`run_tr=true`), so `tea-tr` still completes on every happy path even after you add `when: run_tr == true`. Expect them to still pass; only fix a scenario if adding the `when` actually flips it.

### Schema + executor facts you can rely on (verified in source)

- `trigger_rule` valid values: `all_success`, `one_success`, `none_failed_min_one_success`, `all_done` [`packages/workflows/src/schemas/dag-node.ts:23-28`]. Use `none_failed_min_one_success`.
- A single node may legally declare `when:` + `trigger_rule:` + multiple `depends_on:` together. The only `superRefine` restrictions apply to `route_loop` nodes, not to prompt/bash join nodes [`dag-node.ts:143-144, 476-632`].
- `output_format` + `prompt_suffix` are supported on `prompt:` (AI) nodes; `output_type` is supported on all node types including `bash:` [`dag-node.ts:646, 659, 674, 681, 688`].
- `when: false` → node enters `skipped` state [`dag-executor.ts:~3602-3634`, event `dag_node_skipped_condition`].
- `none_failed_min_one_success` join logic: `return !anyFailed && anySucceeded ? 'run' : 'skip'` where `skipped` upstreams are neither `failed` nor `completed` — i.e. skips are tolerated, one real success is required, any real failure fails the join closed [`dag-executor.ts:784-788`]. This is exactly what makes `tea-tr` run when one RV branch completed + its sibling skipped, and what makes `create-pull-request` run when `tea-tr` completed + `tea-tr-skipped` skipped (or vice-versa).

### Contract envelope + gate vocabulary (project invariants)

- Every route-facing contract carries `contract_version`, `workflow`, `story_ref`, `node`, `gate`/`status`, count fields, and evidence pointers [Source: architecture.md#Contract Envelope, lines 111-124].
- Gate outputs use ONLY `PASS`, `FAIL`, `CONCERNS`, `SKIPPED`, `ERROR` [Source: architecture.md#Contract Envelope, lines 125-131]. Real `tea-tr` gate enum excludes `SKIPPED`; only `tea-tr-skipped` emits `SKIPPED`.
- Story identity: every contract in one run carries the same `story_ref`; mismatch is `ERROR`, never a recoverable warning [Source: architecture.md#Story Identity Rule; project-context.md "Critical Don't-Miss Rules"]. That is why `tea-tr`'s `prompt_suffix` must pin `$resolve-story-input.output.story_ref` and `tea-tr-skipped` must copy it into the contract.
- Fail-closed on JSON contracts: never parse markdown/prose for routing [Source: architecture.md#A-AD-2; project-context.md]. The `tea-tr-skipped` bash node emits JSON only.

### Project rules that bite here (from project-context.md)

- Bundled defaults are GENERATED from `.archon/workflows/defaults/`; NEVER hand-edit `bundled-defaults.generated.ts`. After editing the YAML run `bun run generate:bundled`; `bun run validate`/CI runs `check:bundled` and fails loudly on drift.
- Bun `mock.module()` is process-global and irreversible; any NEW test file that uses it must run as its own isolated `bun test` segment in `packages/workflows/package.json`. The existing `v2-tea-branches-dag.test.ts` already runs isolated; contract tests without `mock.module` co-locate safely.
- Do NOT run root `bun test`. Use `bun run test` (per-package isolation) or a single-file `bun test path/to/file.test.ts` for focused checks.
- No plan/finding/epic identifiers in code or test artifacts (no `A3.3`, `A-FR-3`, etc.). `TD-nnn`/`AC#` scenario tags are allowed as a stable test taxonomy. Node ids and `output_type` labels must be kebab-case (`tea-tr-skipped`, `trace-skipped`).
- Long Markdown: one full sentence per physical line (applies if you touch any `.md`).

### Regenerate + validate commands

- `bun run generate:bundled` — refresh the embedded bundle after YAML edits.
- `bun run check:bundled` — verify no drift (part of `validate`).
- `bun test packages/workflows/src/defaults/v2-tea-branches-contract.test.ts` — focused contract check.
- `bun test packages/workflows/src/defaults/v2-tea-branches-dag.test.ts` — focused isolated DAG check.
- `bun run validate` — full pre-PR gate (bundled checks, type-check, lint `--max-warnings 0`, format, package-isolated tests).

### Project Structure Notes

- Workflow source of truth is the YAML under `.archon/workflows/defaults/`; the TypeScript bundle is a generated mirror. Node ids, `when:` strings, `trigger_rule`, and `output_format` schemas all live in the YAML. No new packages, migrations, routes, or schemas are introduced by this story — it is a pure DAG-wiring change plus its tests.
- The change is strictly additive to the v2 file (one new node, three field additions on `tea-tr`, one `depends_on`/`trigger_rule` change on `create-pull-request`) and touches no runtime engine code — the executor already supports every primitive used.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story A3.3: Join TR As Final Gate] — story statement, ACs, dependency on A3.2 + BMAD-TEA T4.1, `tea-tr.gate.json` / `tea-tr-skipped.gate.json` contracts.
- [Source: _bmad-output/planning-artifacts/architecture.md#A-AD-4: TEA Gates Are Conditional Release Gates] — "TR joins the resolved RV and NR branch outputs and defaults to running after blocking findings are cleared."
- [Source: _bmad-output/planning-artifacts/architecture.md#Workflow-Owned Nodes, lines 103-104] — `tea-tr` → `tea-tr.gate.json`; `tea-tr-skipped` → `tea-tr-skipped.gate.json`.
- [Source: _bmad-output/planning-artifacts/architecture.md#Architecture Paradigm, lines 37-48] — DAG mermaid: `tea-tr-skipped` hangs off `gate-planner` via `not run_tr`.
- [Source: .archon/workflows/defaults/bmad-dev-story-with-tea-fix-loop-v2.yml, lines 557-710] — `tea-rv` / `tea-rv-skipped` / `tea-nr` / `tea-nr-skipped` / `tea-tr` patterns to copy; `gate-planner` `run_tr`/`reason_tr` emission at lines 527-542.
- [Source: packages/workflows/src/defaults/v2-tea-branches-contract.test.ts, TD-010 lines 281-314, TD-014 lines 122-164, TD-016 lines 385-391] — predecessor assertions to update + the skip-branch condition-evaluator proof pattern.
- [Source: packages/workflows/src/defaults/v2-tea-branches-dag.test.ts, TD-001..TD-006] — DAG harness + fail-closed join proofs to extend for the TR join.
- [Source: packages/workflows/src/schemas/dag-node.ts:23-28, 143-144, 646-701] — `trigger_rule` enum; `when`/`trigger_rule`/`depends_on` coexistence; `output_format`/`output_type` node-type support.
- [Source: packages/workflows/src/dag-executor.ts:784-788] — `none_failed_min_one_success` join semantics.
- [Source: _bmad-output/project-context.md] — bundled-defaults generation rule, mock.module isolation rule, no-plan-refs-in-code rule, fail-closed-on-JSON rule, story-identity rule.

## Dev Agent Record

### Agent Model Used

### Debug Log References

### Completion Notes List

- Fix pass 1: Addressed three HIGH-severity review findings (R1-F1, R1-F2, R1-F3).
- R1-F1: Wired `v2-tr-join-contract.test.ts` and `v2-tr-join-dag.test.ts` into `packages/workflows/package.json` test script.
- R1-F2+F3: Added `quality-gate-summary` bash barrier node that depends on all six branch nodes, checks TR gate value (blocks FAIL/ERROR, allows CONCERNS), and sits between TR branches and `create-pull-request`.
- Key implementation detail: variable substitution values are "already shell-quoted" by the executor, so bash assignments must be unquoted (`GATE=$tea-tr.output.gate`, not `GATE="$tea-tr.output.gate"`).
- All 37 contract tests and 10 DAG tests pass. Full workflows package tests pass (0 fail). Bundled checks pass.
- Fix pass 2: Addressed R1-F4 — the barrier's field-level `$tea-tr.output.gate` threw `producer-not-run` when `tea-tr` was skipped on the `run_tr=false` path.
- R1-F4 fix: Replaced field-level `$tea-tr.output.gate` with whole-output `$tea-tr.output` (returns empty string for skipped nodes, not a throw). Bash `case` pattern checks for `"gate":"FAIL"` / `"gate":"ERROR"` in the JSON text only when output is non-empty. Updated TD-042 to assert the whole-output pattern and explicitly verify field-level is NOT used.
- All 37 contract tests and 10 DAG tests still pass after the fix. Full workflows package tests: 0 fail. Bundled checks pass.
- Fix pass 3: Addressed R1-F6 — the barrier used raw substring matching (`case` pattern) on the JSON text instead of deterministic JSON parsing and envelope validation.
- R1-F6 fix: Replaced `case` substring matching with `bun -e` inline script using `JSON.parse()` to validate the full contract envelope (`contract_version`, `workflow`, `node`, `story_ref`, `findings_count`, `gate`). Whole-output `$tea-tr.output` reference preserved (no `producer-not-run` on skipped tea-tr). Added 4 new DAG tests (TD-044 through TD-047) for story_ref mismatch, node mismatch, negative findings_count, and substring false-positive immunity. Updated contract test TD-042 to assert JSON.parse and envelope validation.
- 37 contract tests pass. 14 DAG tests pass (10 original + 4 new). Full workflows package tests: 0 fail. Bundled checks pass. Type-check, lint, format all pass.

### File List

- `.archon/workflows/defaults/bmad-dev-story-with-tea-fix-loop-v2.yml` — Added `quality-gate-summary` bash barrier node; rewired `create-pull-request` to depend on it; fixed barrier to use whole-output `$tea-tr.output` instead of field-level `$tea-tr.output.gate`; replaced substring matching with `bun -e` JSON.parse envelope validation (R1-F6).
- `packages/workflows/src/defaults/bundled-defaults.generated.ts` — Regenerated from YAML source.
- `packages/workflows/package.json` — Added `v2-tr-join-contract.test.ts` to non-mock batch; added `v2-tr-join-dag.test.ts` as isolated segment.
- `packages/workflows/src/defaults/v2-tr-join-contract.test.ts` — Updated TD-027 for barrier; added TD-042 for barrier structural assertions; updated TD-042 for whole-output pattern (R1-F4 fix); updated TD-042 for JSON.parse envelope validation (R1-F6 fix).
- `packages/workflows/src/defaults/v2-tr-join-dag.test.ts` — Added TD-043 for FAIL/ERROR/CONCERNS gate behavior proof; added TD-044 through TD-047 for envelope validation proofs (R1-F6 fix).
- `packages/workflows/src/defaults/v2-tea-branches-contract.test.ts` — Updated TD-010 for barrier dependency.
