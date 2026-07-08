# Story a5.1: Orchestrate Decision Needed Follow-Up

Status: in-progress

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As an Archon workflow maintainer,
I want a `decision-needed-check` node between the quality route loop's PASS exit and PR preparation that consumes the quality summary, cleanly passes forward when there are no deferred human-judgment items, and fails closed (blocking PR) when unresolved `decision_needed` findings exist but cannot be tracked,
so that deferred decisions are never silently dropped or misrepresented as fixed work, and the workflow only reaches PR handoff once decision-needed follow-up is either absent or verifiably tracked.

## ⚠️ READ FIRST — Cross-Project Blocker (Task 0)

This story has a hard dependency on work that **does not exist in this repository and is owned by BMAD-METHOD** (Stories M3.1 and M3.2):

1. A **per-finding `decision-needed.json`** input contract (finding id, title, source gate). Today only the aggregate `decision_needed_count` (a 0–4 count of role gates in `CONCERNS`) exists — there is NO per-finding decision-needed artifact anywhere in the repo.
2. A **BMAD-METHOD sync contract** (request/response) to write Linear references back into BMAD artifacts. No such command, skill, or contract exists.
3. Any **Linear integration** (client, API key wiring, MCP config). Completely greenfield — zero references in the codebase.

Consequence: the epic's positive-path acceptance criteria (create/reuse a Linear issue per finding, sync references back, record `created`/`reused`/`synced` counts) are **BLOCKED and not buildable today**.
The story is therefore authored in three explicit layers (Buildable-Now / Fail-Closed / Deferred-Live), and the dev MUST NOT fabricate the missing cross-project contracts or stand up a speculative always-on Linear client.
See Dev Notes → "The three implementation layers" and "The DON'Ts" before writing any code.

## Acceptance Criteria

Buildable-now ACs (#1–#4, #7) are fully implementable and testable in this repository today.
Deferred ACs (#5, #6) are the epic's live-integration criteria; they are BLOCKED on BMAD-METHOD M3.1/M3.2 and a Linear integration, and are recorded here for traceability — do NOT attempt to satisfy them by inventing the missing contracts.

1. **(Wiring)** **Given** the v2 workflow tail, **When** the `decision-needed-check` node is added, **Then** it is inserted at the route loop's PASS seam: `quality-route-loop.routes.positive` becomes `decision-needed-check` (was `create-pull-request`), and `create-pull-request.depends_on` becomes `[decision-needed-check]` (was `[quality-route-loop]`) **And** `parseWorkflow` (the same schema + DAG validation the CLI `validate workflows` runs) passes with the single `route_loop` unchanged (`from: verify-quality-summary`, `negative: dev-story`, `exhausted: review-loop-error`).

2. **(No-op pass-forward — the only success path buildable today)** **Given** the resolved `quality-gate-summary.json` has `decision_needed_count == 0`, **When** `decision-needed-check` runs, **Then** it emits a successful `decision-needed-check.json` contract with `status: "PASS"`, `deferred: false`, `deferred_count: 0`, `created_count: 0`, `reused_count: 0`, `synced_count: 0`, and an empty `deferred_items: []` **And** the node exits zero so `create-pull-request` runs.

3. **(Contract envelope + story identity)** **Given** `decision-needed-check` emits its contract, **When** the contract is produced, **Then** it carries the full route-facing envelope — `contract_version: "1.0"`, `workflow: "bmad-dev-story-with-tea-fix-loop-v2"`, `node: "decision-needed-check"`, `story_ref` (equal to `$resolve-story-input.output.story_ref`), `status`, `decision_needed_count` (echoed from the summary), and the count/`deferred` fields from AC #2 — **And** it is best-effort persisted to `$ARTIFACTS_DIR/bmad-dev-story-with-tea-fix-loop/decision-needed.json` **And** a mismatched/empty `story_ref`, `contract_version`, `workflow`, or `node` on the consumed summary fails the node closed (non-zero exit, no contract emitted).

4. **(Fail-closed when items exist but cannot be tracked)** **Given** the summary has `decision_needed_count > 0` **And** the Linear + BMAD-METHOD sync capability is not available/configured (the state in this repository today), **When** `decision-needed-check` runs, **Then** the node fails closed: it exits non-zero (the same mechanism `quality-gate-summary` uses for `ERROR`) with a clear diagnostic naming the unavailable capability **And** because `create-pull-request.depends_on: [decision-needed-check]`, PR preparation does NOT run. No new routing branch or `route_loop` is added — blocking is achieved purely by node failure + dependency.

5. **(DEFERRED — blocked on M3.1/M3.2 + Linear)** **Given** `decision_needed_count > 0` **And** the Linear + sync capability IS available, **When** `decision-needed-check` runs, **Then** it creates or reuses one Linear issue per unresolved finding and sends Linear issue id, Linear URL, finding id, and story reference to the BMAD-METHOD sync contract, and on sync success emits `decision-needed-check.json` recording `created_count`, `reused_count`, `synced_count`, and `deferred: true`. This path is NOT implemented in this story (its inputs do not exist); it is specified so a5.2's PR handoff and the future integration have a stable target shape.

6. **(DEFERRED — blocked on M3.1/M3.2 + Linear)** **Given** the BMAD-METHOD sync fails or is unavailable **When** the capability was expected, **Then** the node emits `ERROR` (non-zero exit) and the workflow does not continue to PR preparation. Note: AC #4 already implements the "unavailable" half of this behavior fail-closed for today's repository state; the "sync returns ERROR after a real call" half is deferred with AC #5.

7. **(Bundle parity + baseline untouched)** **Given** the change lands, **When** the bundled defaults are regenerated, **Then** source (`.archon/workflows/defaults/bmad-dev-story-with-tea-fix-loop-v2.yml`) and bundle (`packages/workflows/src/defaults/bundled-defaults.generated.ts`) stay consistent (`bun run check:bundled` passes) **And** the v1 baseline `bmad-dev-story-with-tea-fix-loop.yml` is byte-for-byte unchanged.

## Tasks / Subtasks

- [x] **Task 0 — Confirm/obtain the cross-project baseline before building beyond fail-closed (HARD GATE — read "READ FIRST" + Dev Notes "The cross-project blocker" first)**
  - [x] Confirm the a4.2 tail is present in this checkout (it is, verified): `verify-quality-summary` (bash reader), `quality-route-loop` (`from: verify-quality-summary`, `positive: create-pull-request`, `negative: dev-story`, `exhausted: review-loop-error`, `max_iterations: 20`), `code-review-gate` absent, and `create-pull-request.depends_on: [quality-route-loop]`. If ABSENT, STOP and reconcile a4.2 first (mirrors the a4.1/a4.2 baseline-drift gate). Record the state in the Dev Agent Record.
  - [x] Determine whether BMAD-METHOD M3.1 (`decision-needed.json` per-finding shape) and M3.2 (sync request/response contract) are available to this run. They are NOT in this repository and MUST NOT be read by traversing out of `archon` (epics.md line 16, prd.md line 17). If they are unavailable (today's state), implement ONLY the Buildable-Now + Fail-Closed layers (Tasks 1–5); do NOT build the live Linear/sync path (AC #5/#6). Record the decision and which layers were built.
  - [x] Confirm with the operator (surface in the end-of-run questions) whether decision-needed items are expected in the proof run (a6.1). If yes and the deps are absent, this story ships as fail-closed-only and a6.1's decision-needed leg stays blocked until M3.1/M3.2 land.

- [x] **Task 1 — Add the `decision-needed-check` node at the PASS seam (AC: #1, #2, #3)**
  - [x] Add a `bash:` node `id: decision-needed-check` (JSON-only, no AI — the routing/blocking decision must never depend on prose; A-AD-2). Set `timeout: 60000` and `output_type: decision-needed-check`.
  - [x] Set `depends_on: [quality-route-loop, quality-gate-summary, resolve-story-input]`. Rationale (verified against `loader.ts`): the node is the route loop's `positive` target so it depends on `quality-route-loop` (mirrors how `create-pull-request` did); it also reads the summary contract and the resolved story key by substitution, so it depends on those producers to guarantee they are completed. This is DAG-legal — see Dev Notes "Verified node shape".
  - [x] Body: read the summary UNQUOTED (`SUMMARY=$quality-gate-summary.output`) and the resolved ref UNQUOTED (`RESOLVED_REF=$resolve-story-input.output.story_ref`) — substitution values are already shell-quoted by the executor. Parse and validate with `bun -e` + `JSON.parse` (never `grep`/`case` on raw JSON): fail closed (`echo "ERROR: ..." >&2; exit 1`) unless `contract_version == "1.0"`, `workflow == "bmad-dev-story-with-tea-fix-loop-v2"`, `node == "quality-gate-summary"`, `story_ref` non-empty AND `== RESOLVED_REF`, and `decision_needed_count` is an integer `>= 0`.

- [x] **Task 2 — No-op success path: `decision_needed_count == 0` → emit PASS, exit 0 (AC: #2, #3)**
  - [x] When `decision_needed_count == 0`: serialize `decision-needed-check.json` with `bun -e 'process.stdout.write(JSON.stringify({...}))'` carrying the full envelope (Task 3 fields) with `status: "PASS"`, `deferred: false`, `deferred_count: 0`, `created_count: 0`, `reused_count: 0`, `synced_count: 0`, `deferred_items: []`. `printf '%s'` it to stdout (becomes `$decision-needed-check.output`) and exit 0.
  - [x] Best-effort write to `$ARTIFACTS_DIR/bmad-dev-story-with-tea-fix-loop/decision-needed.json` using the exact guarded pattern from `gate-planner`/`quality-gate-summary` (`if [ -n "${ARTIFACTS_DIR:-}" ]; then RUN_DIR=...; mkdir -p ... || true; printf ... > ... || true; fi`). File name is `decision-needed.json` in the flat RUN_DIR (see Dev Notes "Artifact path").

- [x] **Task 3 — Contract envelope + fail-closed identity validation (AC: #3, #4)**
  - [x] Envelope fields emitted on the success path: `contract_version: "1.0"`, `workflow: "bmad-dev-story-with-tea-fix-loop-v2"`, `node: "decision-needed-check"`, `story_ref` (the resolved key), `status` (`"PASS"`), `decision_needed_count` (echoed), `deferred` (bool), `deferred_count`, `created_count`, `reused_count`, `synced_count`, `deferred_items` (array; empty today). Do NOT emit `gate` — use `status` (this node is not a quality gate; it never returns `FAIL`/`CONCERNS`/`SKIPPED`).
  - [x] All identity/envelope validation must exit BEFORE any contract is written to stdout — never emit a partial contract on the error path (mirrors `quality-gate-summary` Task 3 discipline).

- [x] **Task 4 — Fail-closed path: `decision_needed_count > 0` and capability unavailable (AC: #4, #6-partial)**
  - [x] When `decision_needed_count > 0` AND the live Linear/sync capability is not available (today's state — see Task 0), `echo "ERROR: <n> unresolved decision-needed finding(s) require Linear follow-up + BMAD-METHOD sync, which is not available in this workflow. Blocking PR (fail closed)." >&2; exit 1`. This is the SAME blocking mechanism as `quality-gate-summary`'s `ERROR` exit — a non-zero exit that halts the run before `create-pull-request` (which `depends_on: [decision-needed-check]`).
  - [x] Do NOT add a `route_loop`, a `when:` branch, or a separate error node for this — blocking is structural (node fails → dependent PR node never runs). Do NOT route this back to `dev-story` (it is not a fixable quality `FAIL`; it is deferred human-judgment work + a missing capability).
  - [x] Detecting "capability available" MUST be explicit and default-off: absent any configured capability, treat as unavailable. Do NOT infer availability from the mere presence of an env var name you invented. See Dev Notes "How to gate the live path" — the recommended gate is a config-file-presence probe (mirroring the `check-ntfy`/`notify` conditional pattern), decided in Unresolved Questions #1.

- [x] **Task 5 — Rewire the tail seam (AC: #1)**
  - [x] Change `quality-route-loop.routes.positive: create-pull-request` → `positive: decision-needed-check`. Leave `negative`, `exhausted`, `from`, `condition`, and `max_iterations` untouched.
  - [x] Change `create-pull-request.depends_on: [quality-route-loop]` → `depends_on: [decision-needed-check]`. Touch nothing else on `create-pull-request` (its `command: archon-create-pr`, provider/model/`context: fresh` stay).
  - [x] Confirm no other node references `quality-route-loop` as `positive` and that `review-loop-error` still depends on `[quality-route-loop]` (unchanged — it is the `exhausted` target).

- [x] **Task 6 — Tests: contract (co-located, no mock) + DAG (isolated, real bash) (AC: #1–#4, #7)**
  - [x] Add `packages/workflows/src/defaults/v2-decision-needed-contract.test.ts` (NO `mock.module` — safe to co-locate). Parse the v2 YAML from disk with `parseWorkflow` + import `BUNDLED_WORKFLOWS`; assert: `decision-needed-check` exists as a `bash` node with `output_type: decision-needed-check` and `depends_on == [quality-route-loop, quality-gate-summary, resolve-story-input]`; the body reads whole-output `$quality-gate-summary.output` (and explicitly NOT field-level `$quality-gate-summary.output.decision_needed_count`) and uses `bun -e` + `JSON.parse` (not `grep`/`case`); `quality-route-loop.routes.positive == "decision-needed-check"`; `create-pull-request.depends_on == ["decision-needed-check"]`; exactly one `route_loop` still exists with `from: verify-quality-summary`; the v1 baseline is byte-for-byte unchanged; and `parseWorkflow` succeeds. Follow `v2-quality-route-loop-contract.test.ts` for structure.
  - [x] Add `packages/workflows/src/defaults/v2-decision-needed-dag.test.ts` (uses `mock.module` + real executor + real bash — MUST run as its OWN isolated `bun test` segment). Prove end-to-end with a stubbed upstream driving each case: (a) `decision_needed_count: 0` → node emits `status:"PASS"`, `deferred:false`, exit 0, `create-pull-request` reached; (b) `decision_needed_count: 2` (capability unavailable) → node exits non-zero, `create-pull-request` NOT reached; (c) summary with a mismatched `story_ref` → node fails closed (no contract), `create-pull-request` NOT reached; (d) confirm the emitted `decision-needed.json` on path (a) carries the full envelope + `story_ref` equal to the resolved key. Follow `v2-quality-route-loop-dag.test.ts` for the harness (mock.module + real bash executor).
  - [x] Register `v2-decision-needed-contract.test.ts` in the non-mock workflow-defaults batch and `v2-decision-needed-dag.test.ts` as its OWN `bun test` segment in `packages/workflows/package.json` (never co-locate a `mock.module` file). Keep both files free of plan/story/finding identifiers; use `TD-nnn`/`AC#` tags only (a4.1/a4.2 review discipline).

- [x] **Task 7 — Regenerate bundle + validate (AC: #1, #7)**
  - [x] `bun run generate:bundled` to refresh `packages/workflows/src/defaults/bundled-defaults.generated.ts`; then `bun run check:bundled` to confirm no drift.
  - [x] Run the two new tests (`bun test packages/workflows/src/defaults/v2-decision-needed-contract.test.ts` and the isolated `...-dag.test.ts`); then `bun run validate` before finishing.

### Review Findings

- [x] [Review][Patch] R1-F1 — `decision-needed-check` coerces malformed `decision_needed_count` values to `0`, allowing a false no-op PASS instead of failing closed. [.archon/workflows/defaults/bmad-dev-story-with-tea-fix-loop-v2.yml:990] — FIXED: replaced `Number(s.decision_needed_count)` with `typeof count !== "number"` guard; bundle regenerated; all tests pass.
- [ ] [Review][Patch] R2-F1 — The malformed-count regression test still exercises a duplicated helper script instead of the actual YAML node body, so the exact `Number(...)` regression from R1 could be reintroduced without failing the test suite. [packages/workflows/src/defaults/v2-decision-needed-contract.test.ts:143]
- [ ] [Review][Patch] R2-F2 — The contract test asserts that an ignored, local `.archon/mcp/linear.json` file is absent from the developer checkout, making validation depend on untracked local machine state. [packages/workflows/src/defaults/v2-decision-needed-contract.test.ts:269]

## Dev Notes

### Scope in one line

Insert one fail-closed `bash:` node `decision-needed-check` at the route loop's PASS exit (between `quality-route-loop` and `create-pull-request`): pass forward cleanly when `decision_needed_count == 0`, block PR (non-zero exit) when unresolved decision-needed items exist but cannot be tracked, and leave the live Linear-create/reuse + BMAD-METHOD-sync path specified-but-unbuilt because its inputs are cross-project and absent.

### The cross-project blocker (READ — this determines what you build)

Epic A5.1 declares `Depends on: Story A4.2, BMAD-METHOD Story M3.1, and BMAD-METHOD Story M3.2` [Source: epics.md line 252]. A4.2 is done and present. M3.1 and M3.2 are **BMAD-METHOD-owned and not in this repository**, and the handoff rule is explicit: "No Archon story may require traversal out of `archon` to read parent workspace planning files during implementation" [Source: epics.md line 16; prd.md line 17]. Architecture confirms the direction of ownership: "Archon depends on BMAD-METHOD for … `decision-needed.json`" and "Archon must fail closed when required upstream contracts are unavailable" [Source: architecture.md lines 156–174].

What this means concretely, verified by full-repo search:

- There is **no per-finding `decision-needed.json`** produced anywhere. `decision_needed` is a finding _classification_ emitted inside the BMAD code-review skill (CONCERNS-class, "requires human input"), surfaced only as human-readable markdown (`decision-log.md`, `findings/open-findings.md`). The only machine signal is the aggregate `decision_needed_count` on `quality-gate-summary.json`, computed as the count of role gates (CR/RV/NR/TR) in `CONCERNS` (0–4) — NOT a per-finding count [Source: bmad-dev-story-with-tea-fix-loop-v2.yml quality-gate-summary node, `decision_needed_count: concernsCount`].
- There is **no BMAD-METHOD sync command/skill/contract** anywhere (`.archon/commands/`, `.agents/skills/`, `.qoder/skills/` all searched). The nearest false positives are `archon-sync-pr-with-main` (git) and `bmad-quick-dev/sync-sprint-status` (sprint file writer) — neither is the decision-needed sync.
- There is **no Linear integration** anywhere — no client, no `LINEAR_API_KEY`, no MCP config, no `linear.app`. The only Linear mentions are the planning prose for this exact feature and a hypothetical example in `packages/docs-web/src/content/docs/guides/mcp-servers.md`.

Therefore the live positive path (AC #5/#6 create/reuse/sync) is **not buildable today**. Build the Buildable-Now + Fail-Closed layers; specify the live path as a stable target; defer it explicitly. This is the same class of blocker a4.1/a4.2 hit (baseline drift), but MORE severe because it is cross-project and cannot be resolved by an in-repo rebase.

### The three implementation layers

1. **Buildable-Now (Tasks 1–3, 5)** — add the node, wire the seam, no-op pass-forward on `decision_needed_count == 0`, full contract envelope, story-identity fail-closed. Fully testable in this repo today.
2. **Fail-Closed (Task 4)** — when `decision_needed_count > 0` and no tracking capability is available (today's state), exit non-zero → PR does not run. This is the honest, safe behavior and it satisfies the "unavailable" half of AC #6 for the current repository. It embodies the project rule "Do not treat `decision_needed` or human-judgment follow-up as fixed work … defer and link it explicitly" [Source: project-context.md line 135] and "Archon must fail closed when required upstream contracts are unavailable" [Source: architecture.md line 174].
3. **Deferred-Live (AC #5/#6)** — the Linear create-or-reuse + BMAD-METHOD sync. NOT built here. Recommend the mechanism, gate it behind explicit config, and log it as Unresolved Questions #1/#2 for the operator/M-team.

Be honest in the Dev Agent Record: state plainly that the epic's create/reuse/sync fixtures cannot be satisfied in this repository state and that the story shipped as fail-closed-only (if that is the path taken).

### The DON'Ts (anti-disaster core — a naive dev will get these wrong)

- **Do NOT stand up an always-on Linear client / GraphQL calls.** That is speculative integration with no accepted, wired use case (YAGNI) and silently broadens network access — both explicitly forbidden [Source: project-context.md "Do not add speculative … provider settings without a concrete accepted use case"; "Do not silently broaden … network access"]. Gate any live path behind explicit config presence, or defer it entirely.
- **Do NOT invent the BMAD-METHOD sync contract shape or a fake `decision-needed.json`.** Fail closed when they are absent; never parse markdown/prose (`decision-log.md`, `open-findings.md`) as a routing/sync API [Source: architecture.md#A-AD-2; project-context.md "Fail closed on missing … JSON contracts; do not parse Markdown reports or prose as workflow route APIs"].
- **"Blocks PR" = node exits non-zero.** `create-pull-request.depends_on: [decision-needed-check]`, so a failed node structurally prevents PR. Do NOT add a new routing branch, `when:` gate, or second `route_loop`. Mirror the `quality-gate-summary` ERROR-exit mechanism.
- **Do NOT route decision-needed failure back to `dev-story`.** It is deferred human-judgment work + a missing capability, categorically distinct from a fixable quality `FAIL`. Keeping `ERROR`/deferred separate from the dev-story loop is a hard rule [Source: architecture.md#A-AD-5; project-context.md "Do not route workflow ERROR outcomes back into implementation loops … keep tooling/schema errors separate from fixable findings"].
- **Do NOT emit a `gate` field** on this contract or return `FAIL`/`CONCERNS`/`SKIPPED`. Use `status`. This node either succeeds (`PASS`, exit 0) or fails closed (non-zero exit, no contract).
- **Do NOT modify** `quality-gate-summary`, `verify-quality-summary`, `quality-route-loop`'s internals (only its `positive` target), the TEA nodes, `gate-planner`, or any engine code (`dag-executor.ts`, `loader.ts`, `route-loop*.ts`). This is a DAG-wiring + bash-node + tests change only.

### Verified node shape (route_loop positive-target + extra depends_on is DAG-legal)

The node is the `route_loop`'s `positive` target AND reads two upstream contracts. Verified against `packages/workflows/src/loader.ts` that `depends_on: [quality-route-loop, quality-gate-summary, resolve-story-input]` is legal:

- `validateRouteLoopStructure` only constrains the `route_loop` NODE's own `depends_on` (must be exactly `[from]`) — it does NOT restrict the route TARGETS' `depends_on` [Source: loader.ts:274–347].
- The exit-path constraint checks whether the `positive` target can REACH `from` by following _forward_ (dependents) edges: `collectPathNodesToTarget(target='decision-needed-check', from='verify-quality-summary', dependents)` [Source: loader.ts:237–271, 315–323]. From `decision-needed-check` the only forward successor is `create-pull-request`, which reaches nothing further — so it never reaches `verify-quality-summary`. Adding `quality-gate-summary`/`resolve-story-input` to `decision-needed-check`'s `depends_on` changes THOSE nodes' forward reach, not `decision-needed-check`'s own — so the exit-path check is unaffected. No violation.
- `validateDagStructure` confirms all `depends_on` refs exist and runs Kahn cycle detection [Source: loader.ts:143–226]. The resulting shape is a diamond (`quality-gate-summary → verify-quality-summary → quality-route-loop → decision-needed-check`, plus `quality-gate-summary → decision-needed-check`), not a cycle — `quality-gate-summary` precedes `decision-needed-check` on both paths.
- The loader's `$nodeId.output` reference scan only inspects `when:`, `prompt:`, and `loop.prompt` fields — NOT `bash:` bodies [Source: loader.ts:192–224]. So the bash substitutions here are not loader-validated for existence; the `depends_on` edges are what guarantee the producers ran and their `.output` is available at substitution time. This is exactly why the extra `depends_on` entries matter — they are the runtime guarantee, not decoration.

Model the node on `verify-quality-summary` (the existing bash JSON reader, lines 532–552) and `quality-gate-summary` (the existing bash JSON emitter + best-effort RUN_DIR write, lines 398–530).

### Target node shape (author this)

```yaml
- id: decision-needed-check
  bash: |
    set -e
    SUMMARY=$quality-gate-summary.output
    RESOLVED_REF=$resolve-story-input.output.story_ref

    if [ -z "$RESOLVED_REF" ]; then
      echo "ERROR: resolved story_ref is empty." >&2
      exit 1
    fi
    if [ -z "$SUMMARY" ]; then
      echo "ERROR: quality-gate-summary output is empty." >&2
      exit 1
    fi

    CONTRACT=$(
      DNC_SUMMARY="$SUMMARY" DNC_RESOLVED="$RESOLVED_REF" \
      bun -e '
        const s = JSON.parse(process.env.DNC_SUMMARY || "");
        const resolved = process.env.DNC_RESOLVED;
        if (s.contract_version !== "1.0") { console.error("ERROR: contract_version"); process.exit(1); }
        if (s.workflow !== "bmad-dev-story-with-tea-fix-loop-v2") { console.error("ERROR: workflow"); process.exit(1); }
        if (s.node !== "quality-gate-summary") { console.error("ERROR: node"); process.exit(1); }
        if (!s.story_ref || s.story_ref !== resolved) { console.error("ERROR: story_ref"); process.exit(1); }
        const count = Number(s.decision_needed_count);
        if (!Number.isInteger(count) || count < 0) { console.error("ERROR: decision_needed_count"); process.exit(1); }
        if (count > 0) {
          // Deferred human-judgment items exist but no Linear + BMAD-METHOD sync
          // capability is available in this workflow. Fail closed to block PR.
          console.error("ERROR: " + count + " unresolved decision-needed finding(s) require Linear follow-up + BMAD-METHOD sync, which is unavailable. Blocking PR (fail closed).");
          process.exit(1);
        }
        process.stdout.write(JSON.stringify({
          contract_version: "1.0",
          workflow: "bmad-dev-story-with-tea-fix-loop-v2",
          node: "decision-needed-check",
          story_ref: resolved,
          status: "PASS",
          decision_needed_count: count,
          deferred: false,
          deferred_count: 0,
          created_count: 0,
          reused_count: 0,
          synced_count: 0,
          deferred_items: []
        }));
      '
    )

    printf '%s' "$CONTRACT"

    if [ -n "${ARTIFACTS_DIR:-}" ]; then
      RUN_DIR="$ARTIFACTS_DIR/bmad-dev-story-with-tea-fix-loop"
      mkdir -p "$RUN_DIR" 2>/dev/null || true
      printf '%s' "$CONTRACT" > "$RUN_DIR/decision-needed.json" 2>/dev/null || true
    fi
  timeout: 60000
  depends_on: [quality-route-loop, quality-gate-summary, resolve-story-input]
  output_type: decision-needed-check
```

Reminder on bash assignments: substitution values are already shell-quoted by the executor, so write `SUMMARY=$quality-gate-summary.output` UNQUOTED (not `="$..."`) — a3.3/a4.1/a4.2 executor note. Note the fail-closed `count > 0` branch above is the Task-4 behavior; when the live path lands (AC #5), it replaces that branch's `exit 1` with the Linear-create/reuse + sync logic and a `deferred: true` contract — but only behind an explicit availability gate (Unresolved Questions #1).

### Artifact path

Every tail node writes to the flat directory `$ARTIFACTS_DIR/bmad-dev-story-with-tea-fix-loop/<name>.json` (note: the sub-path drops the `-v2` suffix — it matches the `prepare-bmad-state` `RUN_DIR` and the state.json `workflow` value, both `bmad-dev-story-with-tea-fix-loop`). Use `decision-needed.json` as the file name (matches the architecture node-table "Required Output" naming and the PRD's `decision-needed.json`/`decision-needed-check.json` usage). The `output_type: decision-needed-check` additionally makes the executor write typed sidecars under `$ARTIFACTS_DIR/nodes/decision-needed-check.md` + `.meta.json` automatically — that is separate from and complementary to the best-effort JSON write.

### How the tail is wired today (verified in this checkout)

Confirmed present (a4.2 end-state): `quality-gate-summary` (bash aggregator, emits `gate`/`round`/`blocking_count`/`decision_needed_count`/`findings_total`/`cr_gate`…`tr_gate`, exits non-zero on any role ERROR/mismatch, lines 398–530) → `verify-quality-summary` (bash reader, re-validates envelope, emits bare `PASS`/`FAIL`, lines 532–552) → `quality-route-loop` (`route_loop`, `from: verify-quality-summary`, `condition: "$verify-quality-summary.output == 'PASS'"`, `max_iterations: 20`, `positive: create-pull-request`, `negative: dev-story`, `exhausted: review-loop-error`, lines 554–564). `create-pull-request` is a `command: archon-create-pr` node, `depends_on: [quality-route-loop]`, `context: fresh` (lines 966–972). `review-loop-error` is a fail-closed bash node, `depends_on: [quality-route-loop]` (lines 930–964). There is NO `code-review-gate` node (removed in a4.2). The `decision-needed-check` node does not exist yet.

`quality-gate-summary.json` is your ONLY structured input for the decision. It carries `decision_needed_count` (0–4, count of CONCERNS role gates) but NO per-finding detail and NO evidence pointers — it drops the upstream `report_file`/`open_findings_file`/`decision_log_file` pointers. So a per-finding create/reuse path (AC #5) cannot be built from this contract alone; it needs the M3.1 `decision-needed.json`. For AC #2/#4 you only need the count, which IS present.

### How the live path would be built (recommend, don't build)

Two existing mechanisms are available when M3.1/M3.2 + a Linear key land (do NOT build now — recorded for the deferred path and Unresolved Questions #1):

- **`script: runtime: bun` node** calling the Linear GraphQL API with `fetch()`, reading `LINEAR_API_KEY` from `process.env` (deterministic, fixture-testable — matches the epic's "fixtures prove created, reused, no-op, sync-success, sync-failure" integration validation). Env vars reach node subprocesses via `config.envVars` (repo `.archon/config.yaml` `env:` or `remote_agent_codebase_env_vars`), spread last so managed vars win [Source: dag-executor.ts executeScriptNode/executeBashNode env merge; executor.ts:417].
- **Conditional `mcp:` node** mirroring the `check-ntfy` → `notify` pattern in `.archon/workflows/defaults/archon-smart-pr-review.yaml:118–141`: a bash probe (`test -f .archon/mcp/linear.json && echo true || echo false`) gates an `mcp: .archon/mcp/linear.json` node with `when: "$probe.output == 'true'"`. The MCP config interpolates `$LINEAR_API_KEY` from env [Source: providers/src/mcp/config.ts; schemas/dag-node.ts:154]. This is the AI-driven alternative; only Claude/Codex nodes honor `mcp:`.
  The BMAD-METHOD sync half is invoked the same way existing BMAD steps are — a `command:` node referencing a `.archon/commands/defaults/<name>.md` (like `code-review-auto` → `bmad-code-review-auto`) or a `prompt: bmad-<skill> $ARGUMENTS` node — once that command/skill is delivered by M3.2. Neither exists yet.

### How to gate the live path (default-off)

If/when the live path is added, availability MUST be explicit and default-off — never inferred from an env var name you invent (that would silently change behavior and broaden network access). The recommended gate is a config-file-presence probe (`.archon/mcp/linear.json` or a dedicated capability marker), matching the `check-ntfy`/`notify` graceful-degradation pattern, so the absence of config deterministically routes to fail-closed. Decide the exact marker in Unresolved Questions #1 before building the live path.

### route_loop / executor facts you can rely on (verified in source)

- The `route_loop` node's `depends_on` must be exactly `[from]`; route TARGETS have no such restriction (they are ordinary nodes) [Source: loader.ts:280–286]. `create-pull-request` and `review-loop-error` already depend on `[quality-route-loop]`; `decision-needed-check` becoming the `positive` target and depending on `[quality-route-loop, …]` is the same pattern, extended.
- Positive/exhausted targets must not reach `from` via forward edges; negative may [Source: loader.ts:315–323]. Verified the new shape passes (see "Verified node shape").
- Whole-output `$node.output` returns the producer's full stdout; field-level `$node.output.field` on a `skipped` node throws `producer-not-run`. `quality-gate-summary` always runs (never skipped) so either form is safe, but use whole-output + `JSON.parse` for uniformity and to keep the loader out of field-ref validation [Source: a4.1/a4.2 Dev Notes; loader.ts field-ref rules].
- Substitution values are pre-quoted by the executor → bash assignments UNQUOTED.
- Best-effort RUN_DIR writes are guarded (`|| true`) and never fail the node; the node's own contract goes to STDOUT (the routing/handoff channel), the file is a convenience for a5.2's handoff.

### Contract envelope + project invariants that bite here

- Every route-facing contract carries `contract_version`, `workflow`, `story_ref`, `node`, count fields, and (when applicable) evidence pointers; gate/status vocabulary is the closed set `PASS|FAIL|CONCERNS|SKIPPED|ERROR` [Source: architecture.md#Contract Envelope, lines 111–139]. This node uses `status: "PASS"` on success; failure is an exit-non-zero ERROR (no contract), never a `status: "ERROR"` string routed on.
- Story identity: every contract in one run carries the SAME `story_ref`; mismatch is `ERROR`, never a recoverable warning [Source: architecture.md#Story Identity Rule, lines 133–138; project-context.md]. Validate `story_ref == $resolve-story-input.output.story_ref` and fail closed on mismatch.
- JSON contracts are the ONLY route/handoff API; never parse markdown/prose; missing/invalid/untrusted JSON ⇒ fail closed [Source: architecture.md#A-AD-2; project-context.md].
- `decision_needed` is deferred work: it does NOT fail `quality-gate-summary` when no blocking findings remain (that is why the loop can PASS with `decision_needed_count > 0`), and `decision-needed-check` runs AFTER the loop passes, BEFORE PR [Source: architecture.md#A-AD-6, lines 85–90].
- Bundled defaults are GENERATED from `.archon/workflows/defaults/`; NEVER hand-edit `bundled-defaults.generated.ts`; run `bun run generate:bundled`, and `bun run validate`/CI run `check:bundled` [Source: project-context.md; CLAUDE.md].
- Bun `mock.module()` is process-global and irreversible; the DAG test (uses it) runs as its OWN `bun test` segment; the contract test (no mock) co-locates. Do NOT run root `bun test`; use `bun run test` or single-file invocation [Source: project-context.md Testing Rules; CLAUDE.md].
- No plan/story/epic/finding identifiers in code or test artifacts (no `A5.1`, `A-FR-6`, `a5-1`, `R1-F1`); `TD-nnn`/`AC#` are the allowed test taxonomy; node ids and `output_type` are kebab-case [Source: CLAUDE.md; project-context.md]. a4.1/a4.2 added guard regexes for `R\d-F\d` and `a\d[-.]\d` in test files — keep the new tests clean.
- Long Markdown: one full sentence per physical line (this file, and any `.md` you touch) [Source: project-context.md].
- All new TS satisfies strict config (explicit return types, no unused, no `any` without a justifying comment); single quotes, semicolons, 2-space indent, `printWidth: 100`.

### Previous story intelligence (a4.2 — the direct dependency)

- a4.2 (done) delivered exactly the seam this story extends: it routed `quality-route-loop.positive → create-pull-request` and noted verbatim "this forward edge is the seam `decision-needed-check` will be inserted at" and "a5.1 will later re-target the positive route to `decision-needed-check`" [Source: a4-2 Task 4, AC #2]. a4.2's Unresolved Question #4 pre-registered this exact deferral: "Epic A4.2 AC #2 literally says PASS routes 'to decision-needed-check', but that node is a5.1's deliverable … a5.1 will insert decision-needed-check at that seam." You are executing that plan.
- a4.2 review findings that carry into your discipline: (1) when reading state via `bun -e` from an env var, ensure the shell command actually EXPORTS that var into the `bun -e` invocation (the `RLE_STATE` bug — the env prefix `DNC_SUMMARY="$SUMMARY"` in the sample above is the correct pattern); (2) test files must not embed real story keys — use a neutral synthetic key whose prefix satisfies `resolve-story-input`'s awk pattern (`[a-z][a-z0-9]*-[0-9]+-`, e.g. an `x1-0-…` synthetic) but does NOT match the naming-hygiene guard (`a[0-9][-.][0-9]`). Reuse a4.2's synthetic-key approach in your DAG test.
- a4.2's tests (`v2-quality-route-loop-contract.test.ts`, `v2-quality-route-loop-dag.test.ts`) are the closest templates — copy their parse-from-disk contract harness and their `mock.module` + real-bash DAG harness.

### The files you touch

- `.archon/workflows/defaults/bmad-dev-story-with-tea-fix-loop-v2.yml` — UPDATE (add `decision-needed-check`; retarget `quality-route-loop.routes.positive`; retarget `create-pull-request.depends_on`).
- `packages/workflows/src/defaults/bundled-defaults.generated.ts` — REGENERATED (never hand-edit; `bun run generate:bundled`).
- `packages/workflows/src/defaults/v2-decision-needed-contract.test.ts` — NEW (co-located, no `mock.module`).
- `packages/workflows/src/defaults/v2-decision-needed-dag.test.ts` — NEW (isolated `bun test` segment; uses `mock.module`).
- `packages/workflows/package.json` — UPDATE (wire both new test files into the correct segments).

Do NOT modify: `bmad-dev-story-with-tea-fix-loop.yml` (v1 baseline — byte-for-byte unchanged), `quality-gate-summary` / `verify-quality-summary` / the `route_loop` internals / TEA nodes / `gate-planner` / `resolve-story-input` (you consume their outputs, you do not change them), `archon-create-pr` (a5.2 extends the PR handoff, not this story), or any `@archon/core` / `@archon/server` / engine code.

### Project Structure Notes

The workflow source of truth is the YAML under `.archon/workflows/defaults/`; the TypeScript bundle is a generated mirror. This change is additive-plus-two-rewires in the v2 file (one new node, one `route_loop` target change, one `depends_on` change) and touches no runtime engine code — the executor already supports `bash`, `depends_on`, whole-output substitution, `output_type`, and best-effort artifact writes.
Alignment note: after this story the v2 DAG matches the architecture mermaid's `Loop -->|PASS| Decision --> PR` shape [Source: architecture.md lines 44–48]. Variance to flag: the architecture assumes `decision-needed-check` performs live Linear/sync; this story ships the node with the live path deferred and a fail-closed guard, because the M3.1/M3.2 + Linear inputs are absent — see Unresolved Questions #1–#3 and the Dev Agent Record.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story A5.1, lines 244–271] — story statement, ACs (create/reuse Linear per finding; send issue id/URL/finding id/story ref to sync; record created/reused/synced counts + deferred status; ERROR + no PR on sync failure/unavailable; no-op when none), and `Depends on: A4.2 + BMAD-METHOD M3.1 + M3.2`.
- [Source: _bmad-output/planning-artifacts/prd.md#A-FR-6, lines 129–140] — run after loop PASS, before PR; create/reuse one Linear issue per unresolved finding; write issue id/URL back to BMAD artifacts; ERROR on failure; successful no-op when none.
- [Source: _bmad-output/planning-artifacts/architecture.md#A-AD-6, lines 85–90] — `decision_needed` is deferred work; `decision-needed-check` runs before PR; creates/reuses Linear issues; invokes BMAD-METHOD sync; blocks PR unless sync succeeds.
- [Source: _bmad-output/planning-artifacts/architecture.md#Workflow-Owned Nodes, line 107] — `decision-needed-check` required output `decision-needed-check.json`; [#Contract Envelope + Story Identity, lines 111–138] — envelope fields, gate/status vocabulary, same-`story_ref` invariant; [#Cross-Project Dependencies + Validation, lines 154–174] — `decision-needed.json` is BMAD-METHOD-owned; fail closed when upstream contracts are unavailable.
- [Source: _bmad-output/implementation-artifacts/a4-2-route-quality-loop-and-error-paths.md] — the loop wiring this story extends; the pre-registered `decision-needed-check` seam and deferral (Task 4, AC #2, Unresolved Question #4); the `RLE_STATE` env-export finding and the synthetic-story-key test discipline.
- [Source: _bmad-output/implementation-artifacts/a4-1-aggregate-quality-gate-summary.md] — the `quality-gate-summary` contract you consume (`decision_needed_count` = count of CONCERNS role gates; no per-finding field; W-001 waiver flags that a Linear-sync story would need finer per-finding counts).
- [Source: .archon/workflows/defaults/bmad-dev-story-with-tea-fix-loop-v2.yml] — `quality-gate-summary` (398–530), `verify-quality-summary` (532–552), `quality-route-loop` (554–564), `code-review-auto` command-invocation pattern (287–333), `review-loop-error` (930–964), `create-pull-request` (966–972); the `prepare-bmad-state` RUN_DIR/state.json setup and the best-effort JSON write idiom (`gate-planner`, `tea-rv-skipped`).
- [Source: .archon/workflows/defaults/archon-smart-pr-review.yaml:118–141] — the `check-ntfy` → `notify` conditional-MCP graceful-degradation pattern to mirror IF/when the live Linear path is built.
- [Source: packages/workflows/src/loader.ts:143–347] — `validateDagStructure` (ref existence, Kahn cycle detection, `$node.output` scan of when/prompt only) and `validateRouteLoopStructure` (route_loop `depends_on == [from]`; forward-reachability exit-path constraint) proving the verified node shape is DAG-legal.
- [Source: packages/workflows/src/schemas/dag-node.ts:154; packages/providers/src/mcp/config.ts] — per-node `mcp:` path + `$VAR` env interpolation (deferred live-path mechanism).
- [Source: packages/workflows/src/executor.ts:417; dag-executor.ts executeBashNode/executeScriptNode env merge] — `config.envVars` (repo `env:` + `codebase_env_vars`) reach node subprocesses; a bash/script node can read `$LINEAR_API_KEY` (deferred live-path mechanism).
- [Source: _bmad-output/project-context.md, lines 126–137] — fail-closed-on-JSON, story-identity, ERROR-≠-FAIL, "defer decision_needed and link explicitly", "do not broaden network access", "no speculative provider settings", bundled-defaults generation, mock.module isolation, no-plan-refs-in-code.

## Unresolved Questions

1. **Live Linear/sync path availability gate (blocks AC #5/#6).** The create-or-reuse-issue + BMAD-METHOD sync path cannot be built until M3.1 (`decision-needed.json` per-finding shape) and M3.2 (sync request/response contract) are delivered AND a Linear credential/mechanism is chosen. When they land, how is "capability available" signalled to the node (recommended: presence of `.archon/mcp/linear.json` or a dedicated capability marker, default-off, mirroring `check-ntfy`)? This story ships the node fail-closed (Task 4) and defers the live path. Confirm the gate before building it.
2. **`decision_needed_count` granularity (blocks per-finding create/reuse).** `quality-gate-summary.decision_needed_count` is a 0–4 count of role gates in `CONCERNS`, NOT a per-finding count, and carries no finding id/title/source-gate detail. AC #5 requires "one Linear issue per unresolved finding" — that needs the M3.1 per-finding `decision-needed.json`. Until it exists, the node can only know THAT decision-needed items exist (count > 0), not enumerate them. Confirm the per-finding source will be M3.1's contract.
3. **Ship fail-closed-only now, or block the story?** Given the cross-project deps are absent, the recommended path is to ship the Buildable-Now + Fail-Closed layers (a real, safe, tested node that blocks PR when decision-needed items exist and cannot be tracked) and defer the live path. The alternative is to hold the story until M3.1/M3.2 land. This decision gates a6.1's decision-needed proof leg. Confirm which path the operator wants.
4. **`create-pull-request` on the fail-closed path.** With `create-pull-request.depends_on: [decision-needed-check]`, a fail-closed exit means NO PR is prepared even when the ONLY outstanding matter is deferred decisions (not a quality defect). That is the spec-mandated behavior ("PR preparation cannot run when … sync … is unavailable", epics.md line 254) and the safe default, but it means a repo with any decision-needed finding cannot reach PR through v2 until the live path lands. Confirm this is acceptable for the interim (it is the only fail-closed-correct option).

## Dev Agent Record

### Agent Model Used

Codex (gpt-5.5) for implementation, Claude (sonnet) for review.

### Debug Log References

All tests passed on first run after implementation was already in place from prior workflow nodes.
Contract test: 48 pass, 2 skip (deferred AC#5/#6 scaffolds), 0 fail.
DAG test: 12 pass, 1 skip (mid-DAG fault-injection scaffold), 0 fail.
`bun run check:bundled` passed. `bun run type-check` passed across all packages.

### Completion Notes List

- Implemented Buildable-Now + Fail-Closed layers only (Tasks 0-5, 7).
- Deferred live Linear/sync path (AC #5/#6) — cross-project dependencies (BMAD-METHOD M3.1/M3.2) and Linear integration are absent from this repository.
- The `decision-needed-check` bash node is inserted at the PASS seam between `quality-route-loop` and `create-pull-request`.
- When `decision_needed_count == 0`: emits `status: "PASS"` contract with full envelope, exits 0, PR proceeds.
- When `decision_needed_count > 0`: fails closed with diagnostic naming unavailable capability, exits non-zero, PR blocked.
- No new routing branches, route_loops, or error nodes added — blocking is purely structural via `depends_on`.
- Bundle regenerated and source/bundle parity confirmed.
- v1 baseline unchanged.

### File List

- `.archon/workflows/defaults/bmad-dev-story-with-tea-fix-loop-v2.yml` — added `decision-needed-check` node, retargeted `quality-route-loop.routes.positive`, retargeted `create-pull-request.depends_on`
- `packages/workflows/src/defaults/bundled-defaults.generated.ts` — regenerated
- `packages/workflows/src/defaults/v2-decision-needed-contract.test.ts` — new contract test (48 assertions)
- `packages/workflows/src/defaults/v2-decision-needed-dag.test.ts` — new DAG test (12 assertions)
- `packages/workflows/package.json` — registered both test files in correct batch segments
