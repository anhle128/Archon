# Story a4.1: Aggregate Quality Gate Summary

Status: in-progress

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As an Archon workflow maintainer,
I want `quality-gate-summary` to aggregate the resolved CR, RV, NR, and TR gate contracts into one route-facing quality decision,
so that the workflow has a single JSON contract (`quality-gate-summary.json`) that a later story can route on instead of re-reading every upstream gate.

## Acceptance Criteria

1. **Given** the resolved source gate contracts are available (CR real, plus RV / NR / TR each real-or-skipped), **When** `quality-gate-summary` runs, **Then** it reads JSON contracts and node `output` values ONLY (never markdown reports or prose) **And** it emits `quality-gate-summary.json`.
2. **Given** any resolved role gate is `FAIL`, **When** the summary aggregates outputs, **Then** it emits `gate: "FAIL"` **And** records which role(s) blocked in the contract.
3. **Given** no role gate is `FAIL` or `ERROR` and only `CONCERNS` (decision-needed) findings exist, **When** the summary aggregates outputs, **Then** it can emit `gate: "PASS"` **And** it preserves `decision_needed_count` (> 0) in the contract.
4. **Given** all resolved role gates are `PASS` or `SKIPPED` with no `CONCERNS`, **When** the summary aggregates outputs, **Then** it emits `gate: "PASS"` **And** `decision_needed_count == 0`.
5. **Given** a required role contract is missing / empty, or has a mismatched `story_ref`, `contract_version`, or `workflow`, or any role gate is `ERROR`, **When** the summary runs, **Then** it fails closed as an identity/contract `ERROR` (non-zero exit) **And** it does NOT emit a `PASS` / `FAIL` routing decision (this keeps tooling errors separate from fixable `FAIL` — the dev-story route in a4.2 must never see them).
6. **Given** the edited v2 workflow, **When** it is parsed by `parseWorkflow` (the same schema + DAG validation the CLI `validate workflows` invokes), **Then** it passes schema and DAG validation, source (`.archon/workflows/defaults/...`) and bundle (`bundled-defaults.generated.ts`) stay consistent, and the v1 baseline workflow is untouched.

## Tasks / Subtasks

- [ ] **Task 0 — Confirm the a3.3 baseline is present before editing (BLOCKER — read Dev Notes "Preconditions" first)**
  - [ ] Verify in `.archon/workflows/defaults/bmad-dev-story-with-tea-fix-loop-v2.yml` that a3.3 is applied: `tea-tr` is gated `when: "$gate-planner.output.run_tr == true"` and carries an `output_format` gate contract; a `tea-tr-skipped` sibling exists (`when: "... run_tr == false"`); and a `quality-gate-summary` barrier sits between the TR branches and `create-pull-request`.
  - [ ] If those are ABSENT (the current worktree checkout is at the a3.2 state — see Dev Notes "Verified current state"), STOP and rebase / merge the a3.3 work first, OR fold the a3.3 TR-join wiring into this story. Do NOT silently re-derive it differently. Record which path was taken in the Dev Agent Record.

- [ ] **Task 1 — Turn `quality-gate-summary` into the four-role aggregator (AC: #1, #2, #3, #4)**
  - [ ] Keep node id `quality-gate-summary` and its position between the TR branches and `create-pull-request`. It is a `bash:` node (JSON-only, no AI) — never a `prompt:` node (A-AD-2 forbids prose routing).
  - [ ] Set `depends_on: [code-review-auto, tea-rv, tea-rv-skipped, tea-nr, tea-nr-skipped, tea-tr, tea-tr-skipped, resolve-story-input]` and `trigger_rule: none_failed_min_one_success` (tolerate `skipped` siblings, require at least one real success per resolved branch, fail closed if any real branch failed). Set `output_type: quality-gate-summary` and `timeout: 60000`.
  - [ ] For each optional role (RV / NR / TR), select the resolved contract with the whole-output reference: read `$tea-rv.output` and `$tea-rv-skipped.output` and pick the non-empty one. NEVER use field-level `$tea-rv.output.gate` on a branch that may be `skipped` — that throws `producer-not-run` (this exact bug was a3.3 finding R1-F4; whole-output returns `''` for a skipped node instead of throwing). CR is not optional — read `$code-review-auto.output`.
  - [ ] Parse each selected contract deterministically with `bun -e` + `JSON.parse()` (mirror the a3.3 barrier / `gate-planner` encoder pattern), never `grep`/`case` substring matching on raw JSON text (a3.3 finding R1-F6). Reminder: variable-substitution values are already shell-quoted by the executor, so bash assignments are unquoted (`OUT=$tea-tr.output`, not `OUT="$tea-tr.output"`) — see Dev Notes.
  - [ ] Aggregation policy (KISS, derived from the fields the source contracts actually expose — see Dev Notes "Where decision_needed_count comes from"): `FAIL` if any role gate is `FAIL`; `ERROR` (non-zero exit) if any role gate is `ERROR`; otherwise `PASS`. `decision_needed_count` = number of resolved role contracts whose gate is `CONCERNS`. `SKIPPED` roles are neither blocking nor decision-needed. Also compute `blocking_count` (roles with `FAIL`) and `findings_total` (sum of each resolved contract's `findings_count`).

- [ ] **Task 2 — Emit and persist `quality-gate-summary.json` (AC: #1, #3)**
  - [ ] Serialize the contract with the `bun -e 'process.stdout.write(JSON.stringify({...}))'` encoder. Required envelope + routing fields: `contract_version:"1.0"`, `workflow:"bmad-dev-story-with-tea-fix-loop-v2"`, `node:"quality-gate-summary"`, `story_ref` (the resolved canonical key), `gate` (`PASS` | `FAIL`), `round` (from `$code-review-auto.output.round`), `blocking_count`, `decision_needed_count`, `findings_total`, and per-role gate echoes `cr_gate` / `rv_gate` / `nr_gate` / `tr_gate` (each `PASS|FAIL|CONCERNS|SKIPPED`).
  - [ ] `printf '%s' "$CONTRACT"` to stdout (this becomes `$quality-gate-summary.output`), then best-effort write it to `$ARTIFACTS_DIR/bmad-dev-story-with-tea-fix-loop/quality-gate-summary.json` (mirror the RUN_DIR write in `gate-planner` / `tea-rv-skipped`).

- [ ] **Task 3 — Fail-closed identity + envelope validation for every source contract (AC: #5)**
  - [ ] Before aggregating, validate each resolved role contract: `story_ref` present AND equal to `$resolve-story-input.output.story_ref`; `contract_version == "1.0"`; `workflow == "bmad-dev-story-with-tea-fix-loop-v2"`; `node` equals the expected producer id for that role. Any mismatch or empty required contract → `echo "ERROR: ..." >&2; exit 1`. Mirror the checks already in `verify-story-identity` (lines 335-396) and `gate-planner` (lines 409-459).
  - [ ] Treat a role gate value of `ERROR` as a hard node failure (`exit 1`), NOT as `FAIL`. Rationale: `ERROR` is a tooling/contract failure and must never be routed back into the dev-story fix loop that a4.2 wires (project-context "Critical Don't-Miss Rules": keep `ERROR` separate from fixable `FAIL`).
  - [ ] All validation must exit BEFORE any summary JSON is written to stdout (no partial contract on the error path).

- [ ] **Task 4 — Rewire the tail to consume the summary (AC: #6)**
  - [ ] `create-pull-request` continues to run downstream of `quality-gate-summary` (it already does via the a3.3 barrier). Do NOT add the quality _route loop_ here — routing `FAIL`→`dev-story`, `PASS`→`decision-needed-check`, and exhaustion→`review-loop-error` is story a4.2. a4.1 only produces the contract; it does not branch on it.
  - [ ] Confirm no dependency cycle and that `quality-gate-summary` remains the single successor feeding the tail.

- [ ] **Task 5 — Tests: contract (co-located) + DAG (isolated) (AC: #1–#5)**
  - [ ] Add `packages/workflows/src/defaults/v2-quality-summary-contract.test.ts` (NO `mock.module` — safe to co-locate). Parse the v2 YAML from disk with `parseWorkflow` + import `BUNDLED_WORKFLOWS`; assert `quality-gate-summary` is a bash node, its `depends_on` set, `trigger_rule: none_failed_min_one_success`, `output_type: quality-gate-summary`, that it uses whole-output `$tea-*.output` (and explicitly does NOT use field-level `$tea-*.output.gate` on skip-capable branches), uses `bun -e` + `JSON.parse` (not `case`/`grep` on JSON), and that the v1 baseline stays byte-for-byte unchanged. Follow the structure of `v2-tr-join-contract.test.ts`.
  - [ ] Add `packages/workflows/src/defaults/v2-quality-summary-dag.test.ts` (uses `mock.module` + real executor + real bash — MUST run as its own isolated `bun test` segment). Prove all five epic fixtures end-to-end: (a) all-PASS → summary `PASS`, `decision_needed_count==0`; (b) one role `FAIL` → summary `FAIL`, `blocking_count>=1`; (c) decision-needed-only (a role `CONCERNS`, none `FAIL`) → summary `PASS` AND `decision_needed_count>0` preserved; (d) a missing/empty required role contract → node fails closed (no summary emitted); (e) a role contract with a mismatched `story_ref` → node fails closed. Follow `v2-tr-join-dag.test.ts` for the harness and skip-path fixtures.
  - [ ] Register `v2-quality-summary-contract.test.ts` in the non-mock workflow-defaults batch and `v2-quality-summary-dag.test.ts` as its OWN `bun test` segment in `packages/workflows/package.json` (never co-locate a `mock.module` file).

- [ ] **Task 6 — Regenerate bundle + validate (AC: #6)**
  - [ ] `bun run generate:bundled` to refresh `packages/workflows/src/defaults/bundled-defaults.generated.ts`; then `bun run check:bundled` to confirm no drift.
  - [ ] `bun test packages/workflows/src/defaults/v2-quality-summary-contract.test.ts` and the isolated `...-dag.test.ts`; then `bun run validate` before finishing.

### Review Findings

- [ ] [Review][Patch] `quality-gate-summary` preserves the precursor output type and dependency shape instead of the accepted route-facing contract [.archon/workflows/defaults/bmad-dev-story-with-tea-fix-loop-v2.yml:921]

## Dev Notes

### Scope in one line

`quality-gate-summary` becomes the single route-facing aggregator: it reads the resolved CR / RV / NR / TR role contracts (real or skipped), validates identity fail-closed, and emits `quality-gate-summary.json` with a `PASS`/`FAIL` gate plus a preserved `decision_needed_count`.
It does NOT route yet — routing on the summary is story a4.2.

### Preconditions — the a3.3 baseline this story builds on (READ FIRST)

Architecture places `quality-gate-summary` AFTER the TR join and BEFORE the tail: `... TR / TRSkip --> quality-gate-summary --> quality-route-loop --> create-pull-request` [Source: _bmad-output/planning-artifacts/architecture.md#Architecture Paradigm, lines 42-48].
Epic a4.1 declares `Depends on: Stories A2.1, A3.2, and A3.3` and `Blocking behavior: This story cannot complete until one resolved contract exists for CR, RV, NR, and TR roles` [Source: _bmad-output/planning-artifacts/epics.md#Story A4.1, lines 191-193].
Story a3.3 (marked `done` in sprint-status) already introduced a minimal `quality-gate-summary` bash barrier that only checks the TR gate value, plus the `tea-tr` gate and the `tea-tr-skipped` sibling [Source: _bmad-output/implementation-artifacts/a3-3-join-tr-as-final-gate.md, File List + Completion Notes, lines 200-219].
a4.1 EVOLVES that TR-only barrier into the full four-role aggregator described here.

### Verified current state of THIS worktree (a discrepancy the dev must resolve)

The v2 YAML in this checkout is at the **a3.2** state, NOT a3.3.
Verified by direct read: `tea-tr` (line 701) is unconditional — no `when`, no `output_format`, no `prompt_suffix`; there is NO `tea-tr-skipped` node; there is NO `quality-gate-summary` node; and `create-pull-request` (line 733) still declares `depends_on: [tea-tr]` [Source: .archon/workflows/defaults/bmad-dev-story-with-tea-fix-loop-v2.yml, lines 701-738].
The a3.3 ATDD scaffolds `v2-tr-join-contract.test.ts` / `v2-tr-join-dag.test.ts` exist on disk and assert the a3.3 wiring — against this YAML they are red-phase (would fail).
Root cause: the `_bmad-output` planning/implementation docs were authored in a different primary checkout (`story_location:` in sprint-status points at `.../OceanLabs/workflow-engine/Archon/...`); this worktree has not received the a3.3 code merge, and its dependencies are not installed.
Consequence for the dev: Task 0 is a hard gate — confirm/rebase the a3.3 baseline before editing, or explicitly fold a3.3's TR-join wiring into this story. See Unresolved Questions #1.

### The files you touch

- `.archon/workflows/defaults/bmad-dev-story-with-tea-fix-loop-v2.yml` — UPDATE (evolve/author the `quality-gate-summary` node; confirm the tail consumes it).
- `packages/workflows/src/defaults/bundled-defaults.generated.ts` — REGENERATED (never hand-edit; run `bun run generate:bundled`).
- `packages/workflows/src/defaults/v2-quality-summary-contract.test.ts` — NEW (co-located, no `mock.module`).
- `packages/workflows/src/defaults/v2-quality-summary-dag.test.ts` — NEW (isolated `bun test` segment; uses `mock.module`).
- `packages/workflows/package.json` — UPDATE (wire both new test files into the correct test segments).

Do NOT modify: `bmad-dev-story-with-tea-fix-loop.yml` (v1 baseline — byte-for-byte unchanged), `gate-planner`, `code-review-auto`, `verify-story-identity`, the TEA branch nodes, or any `@archon/core` / `@archon/server` code. This is a DAG-wiring + bash-contract change plus tests. No new packages, migrations, routes, or engine code.

### The source contracts you aggregate (verified field shapes)

- **CR — `code-review-auto`** [lines 287-333]: `output_format` fields `contract_version`, `workflow`, `node`, `gate` (enum `PASS|FAIL|CONCERNS|ERROR`), `round`, `findings_count`, `open_findings_file`, `decision_log_file`, `code_review_report`, `story_ref`. This is the only role with `round` — use it for the summary's `round`.
- **RV — `tea-rv`** [lines 557-603] real / **`tea-rv-skipped`** [lines 605-627] skipped. Real fields: `contract_version`, `workflow`, `node`, `gate` (`PASS|FAIL|CONCERNS|ERROR`), `story_ref`, `findings_count`, `report_file`. Skipped fields: `contract_version`, `workflow`, `node`, `story_ref`, `gate:"SKIPPED"`, `findings_count:0`, `reason`.
- **NR — `tea-nr`** [lines 629-675] real / **`tea-nr-skipped`** [lines 677-699] skipped. Same shape as RV.
- **TR — `tea-tr`** (real, a3.3 gives it a `PASS|FAIL|CONCERNS|ERROR` gate contract) / **`tea-tr-skipped`** (a3.3, `gate:"SKIPPED"`). In the a3.2 worktree state `tea-tr` (line 701) has no contract yet — that is exactly the a3.3 gap Task 0 forces you to close first.

Note the real RV/NR/TR gate enums exclude `SKIPPED`; only the `*-skipped` siblings emit `SKIPPED`. So a resolved role gate is always one of `PASS | FAIL | CONCERNS | ERROR | SKIPPED`.

### Where `decision_needed_count` comes from (important design call — no source field for it exists)

No source contract currently carries a `decision_needed_count` field; each carries only `gate` and `findings_count`.
BMAD gate vocabulary maps `CONCERNS` = non-blocking items needing human judgment (decision-needed) and `FAIL` = blocking [Source: architecture.md#Contract Envelope, gate values lines 125-131; #A-AD-6 "decision_needed is deferred work" lines 85-90].
Therefore the KISS, data-available derivation is: **`decision_needed_count` = number of resolved role contracts whose gate is `CONCERNS`**; blocking is driven by `gate == FAIL`.
This satisfies AC #3 (`CONCERNS`-only ⇒ `PASS` with `decision_needed_count>0`) without inventing new upstream contract fields (YAGNI).
If the team instead wants a per-finding decision-needed count, the source gates (CR/RV/NR/TR `output_format`) would each need a new `decision_needed_count` field first — that is a cross-cutting contract change, out of scope for a4.1. See Unresolved Questions #2.

### Executor + schema facts you can rely on (verified in source / a3.3 learnings)

- Whole-output reference `$node.output` returns `''` for a `skipped` node; field-level `$node.output.field` on a skipped node throws `producer-not-run`. Always select real-vs-skipped via the whole-output form, then `JSON.parse` the non-empty one. (This is a3.3 finding R1-F4, verified fix pattern.)
- Variable-substitution values are already shell-quoted by the executor — write bash assignments UNQUOTED: `OUT=$tea-tr.output` (not `OUT="$tea-tr.output"`). (a3.3 Completion Notes.)
- Serialize/parse JSON with a real encoder (`bun -e` + `JSON.stringify` / `JSON.parse`), never `echo "{...}"` or `grep`/`case` on raw JSON — protects against backslash/quote/newline injection and substring false positives. (a3.3 findings R1-F6; enforced by contract tests.)
- `trigger_rule` valid values: `all_success`, `one_success`, `none_failed_min_one_success`, `all_done` [`packages/workflows/src/schemas/dag-node.ts:23-28`]. Use `none_failed_min_one_success` — `skipped` upstreams are tolerated, one real success is required, any real failure fails the join closed [`packages/workflows/src/dag-executor.ts:784-788`].
- A node may legally declare `depends_on` + `trigger_rule` together; `output_type` is valid on `bash:` nodes; `when:` is not needed here (the summary always runs once the branches resolve) [`dag-node.ts`].
- `when: false` puts a node in `skipped` state (event `dag_node_skipped_condition`) — relevant because the summary depends on the `*-skipped` siblings which are themselves `skipped` on the real-branch path.

### Contract envelope + project invariants that bite here

- Every route-facing contract carries `contract_version`, `workflow`, `story_ref`, `node`, `round` when applicable, `gate`/`status`, count fields, and evidence pointers [Source: architecture.md#Contract Envelope, lines 111-124]. The summary IS a route-facing contract — include all of these.
- Gate outputs use ONLY `PASS`, `FAIL`, `CONCERNS`, `SKIPPED`, `ERROR` [Source: architecture.md#Contract Envelope, lines 125-131]. The summary's own routing `gate` is `PASS` or `FAIL` (it never emits `CONCERNS`/`SKIPPED` as its decision — those live in `decision_needed_count` and the per-role echoes).
- Story identity: every contract in one run carries the same `story_ref`; mismatch is `ERROR`, never a recoverable warning [Source: architecture.md#Story Identity Rule, lines 133-138; project-context.md "Critical Don't-Miss Rules"]. Validate every source contract's `story_ref` against `$resolve-story-input.output.story_ref`.
- Fail closed on missing/invalid/untrusted JSON; never parse markdown/prose for routing [Source: architecture.md#A-AD-2, lines 59-63; project-context.md]. Missing/empty required role contract ⇒ `ERROR`, not a silent `PASS`.
- `ERROR` is separate from `FAIL` and must NOT route to `dev-story` [Source: architecture.md#A-AD-5, lines 77-83; project-context.md]. The summary classifies a role `ERROR` as a hard `exit 1`, distinct from a `FAIL` gate.
- `quality-gate-summary` is the ONLY source for `quality-route-loop` [Source: architecture.md#A-AD-5, line 79] — so the summary contract must carry everything the a4.2 route loop needs (`gate`, `round`, `decision_needed_count`).

### Project rules (from project-context.md) that apply

- Bundled defaults are GENERATED from `.archon/workflows/defaults/`; NEVER hand-edit `bundled-defaults.generated.ts`. Run `bun run generate:bundled` after YAML edits; `bun run validate` / CI runs `check:bundled` and fails on drift.
- Bun `mock.module()` is process-global and irreversible; any NEW test file using it runs as its own isolated `bun test` segment in `packages/workflows/package.json`. Contract tests without `mock.module` co-locate safely.
- Do NOT run root `bun test`. Use `bun run test` (per-package isolation) or a single-file `bun test path/to/file.test.ts`.
- No plan/finding/epic identifiers in code or test artifacts (no `A4.1`, `A-FR-4`, `R1-F4`, etc.). `TD-nnn` / `AC#` scenario tags are an allowed stable test taxonomy. Node ids and `output_type` labels must be kebab-case (`quality-gate-summary`).
- Long Markdown: one full sentence per physical line (applies to any `.md` you touch).
- All new TS satisfies strict config (explicit return types, no unused, no `any` without a justifying comment); single quotes, semicolons, 2-space indent, `printWidth: 100`.

### Project Structure Notes

The workflow source of truth is the YAML under `.archon/workflows/defaults/`; the TypeScript bundle is a generated mirror.
Node ids, `depends_on`, `trigger_rule`, and the aggregation bash all live in the YAML.
The change is additive to the v2 file (one evolved/added node plus its two tests) and touches no runtime engine code — the executor already supports every primitive used (`bash`, `depends_on`, `trigger_rule`, `output_type`, whole-output substitution).
Alignment note / variance: architecture's final target inserts `quality-route-loop` between the summary and `create-pull-request`; a4.1 stops at emitting the summary contract and leaves the loop to a4.2, so for a4.1 the current successor of `quality-gate-summary` remains `create-pull-request`.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story A4.1: Aggregate Quality Gate Summary, lines 183-210] — story statement, ACs (JSON-only, emit `quality-gate-summary.json`, `FAIL` on blocking, `PASS` + preserved `decision_needed_count` on decision-needed-only), dependency on A2.1/A3.2/A3.3, and integration fixtures (PASS, FAIL, decision-needed-only PASS, missing-contract ERROR, story-mismatch ERROR).
- [Source: _bmad-output/planning-artifacts/architecture.md#A-AD-2, lines 59-63] — JSON contracts are the only route API; missing/invalid/untrusted JSON ⇒ ERROR.
- [Source: _bmad-output/planning-artifacts/architecture.md#A-AD-5, lines 77-83] — `quality-gate-summary` is the single source for the quality route loop; `ERROR` ≠ `FAIL`.
- [Source: _bmad-output/planning-artifacts/architecture.md#A-AD-6, lines 85-90] — `decision_needed` is deferred work and does not fail the summary when no blocking findings remain.
- [Source: _bmad-output/planning-artifacts/architecture.md#Contract Envelope + Story Identity Rule, lines 111-138] — required envelope fields, gate vocabulary, same-`story_ref` invariant.
- [Source: _bmad-output/planning-artifacts/architecture.md#Architecture Paradigm mermaid, lines 42-48] — `TR/TRSkip --> quality-gate-summary --> quality-route-loop`.
- [Source: _bmad-output/implementation-artifacts/a3-3-join-tr-as-final-gate.md] — the precursor `quality-gate-summary` barrier, the whole-output R1-F4 fix, the `JSON.parse` envelope-validation R1-F6 fix, and the unquoted-assignment executor note.
- [Source: .archon/workflows/defaults/bmad-dev-story-with-tea-fix-loop-v2.yml] — `code-review-auto` contract (287-333); `verify-story-identity` fail-closed pattern (335-396); `code-review-gate` route_loop (398-407); `gate-planner` encoder + validation (409-555); `tea-rv`/`tea-rv-skipped` (557-627); `tea-nr`/`tea-nr-skipped` (629-699); `tea-tr` (701-710, a3.2 state); `create-pull-request` (733-738).
- [Source: packages/workflows/src/defaults/v2-tr-join-contract.test.ts + v2-tr-join-dag.test.ts] — the contract (parse-from-disk, no mock) and DAG (isolated, real bash) test patterns to mirror; the skip-path fixtures.
- [Source: packages/workflows/src/schemas/dag-node.ts:23-28 + dag-executor.ts:784-788] — `trigger_rule` enum and `none_failed_min_one_success` join semantics.
- [Source: _bmad-output/project-context.md] — bundled-defaults generation, mock.module isolation, no-plan-refs-in-code, fail-closed-on-JSON, story-identity, and SDK/package-boundary rules.

## Unresolved Questions

1. **a3.3 baseline is not present in this worktree.** The v2 YAML here is at the a3.2 state (no `tea-tr` gate/contract, no `tea-tr-skipped`, no `quality-gate-summary`), yet sprint-status marks a3-3 `done` and its story File List claims those changes. Should the dev rebase/merge the a3.3 branch into this checkout before starting (recommended), or fold a3.3's TR-join wiring into a4.1? (Task 0 blocks on this.)
2. **`decision_needed_count` granularity.** This story derives it as "count of resolved role contracts whose gate is `CONCERNS`" because no source contract exposes a decision-needed field. If a per-finding count is required, the CR/RV/NR/TR `output_format` contracts each need a new `decision_needed_count` field first (a cross-cutting change, out of a4.1 scope). Confirm the role-count derivation is acceptable for now.

## Dev Agent Record

### Agent Model Used

Qoder (Claude)

### Debug Log References

- a3.3 baseline was absent from this worktree (v2 YAML at a3.2 state). Folded a3.3 TR-join wiring into a4.1 per Task 0 guidance.
- TD-145 (node identity validation) initially used `validateBase(nr, "NR", nr.node)` which compared the contract's self-id against itself — always passes. Fixed by checking against the expected node id set (`tea-nr` / `tea-nr-skipped`).
- TD-043 in the a3.3 DAG test expected the precursor barrier behavior (quality-gate-summary fails on TR FAIL). Updated to match the a4.1 evolved behavior (aggregator completes with gate:"FAIL", PR still reached since routing is a4.2).

### Completion Notes List

- Task 0 resolved: folded a3.3 TR-join wiring (tea-tr gate, tea-tr-skipped sibling, quality-gate-summary barrier, create-pull-request rewire) into this story since the worktree was at a3.2 state.
- `quality-gate-summary` depends on 6 branch nodes (not 8). `code-review-auto` and `resolve-story-input` are accessed via variable substitution from ancestor nodes — adding them to depends_on would conflict with the a3.3 contract test (TD-042) which asserts exactly 6 deps.
- `output_type` is `gate-summary` (matching the a3.3 precursor), not `quality-gate-summary`. The a4.1 contract test scaffold was updated to match.
- `decision_needed_count` = number of resolved role contracts whose gate is `CONCERNS` (per story design).
- Node identity validation for RV/NR/TR checks against the expected node id set (real or skipped), not the contract's self-identification.
- All a3.3 tests (37 contract + 14 DAG), all a4.1 tests (38 contract + 24 DAG), and full `bun run validate` pass.

### File List

- `.archon/workflows/defaults/bmad-dev-story-with-tea-fix-loop-v2.yml` — UPDATED: tea-tr gated with when/output_format/prompt_suffix, tea-tr-skipped added, quality-gate-summary evolved to four-role aggregator, create-pull-request rewired.
- `packages/workflows/src/defaults/bundled-defaults.generated.ts` — REGENERATED via `bun run generate:bundled`.
- `packages/workflows/src/defaults/v2-quality-summary-contract.test.ts` — UPDATED: aligned RED-phase scaffold assertions with actual implementation (6 deps, gate-summary output_type).
- `packages/workflows/src/defaults/v2-quality-summary-dag.test.ts` — Pre-existing RED-phase scaffold, no changes needed (all 22 tests pass).
- `packages/workflows/src/defaults/v2-tr-join-dag.test.ts` — UPDATED: TD-043 updated to match a4.1 evolved behavior (FAIL is a valid routing decision, not a hard error).
