# Ralph loop on Rust repos — project-aware validation (pivot from fork)

## Context

Codex adversarial review of the fork plan, then user challenged the whole approach as
over-engineered. Investigation confirmed: the system already validates project-aware by delegation
(`speckit-ralph-native-feature.yaml:618` → `archon-speckit-ralph-iteration` → repo AGENTS.md "run
whatever the project requires"), and the project owns publish policy (`cargo clean` before PR at
`speckit-ralph-native-feature.yaml:815-827`), which the fork's hardcoded "NEVER cargo clean" would
override. Decision (user-approved): **project-aware loop, NO fork.**

## Checklist

- [x] Delete forked YAMLs `archon-ralph-rust-dag.yaml` + `ak-implement-rust.yaml` (never entered bundle).
- [x] Make `archon-ralph-dag.yaml` loop project-aware: - Add "Toolchain detection (do this once)" block at Phase 2 start (Cargo.toml→cargo,
      package.json→bun/npm, go.mod→go, pyproject→python; prefer story acceptanceCriteria; follow the
      project's own build/publish policy, do NOT override). - §2.3/§3.1/§3.2/§3.3, PHASE_2/3 checkpoints, VALIDATED, edge cases → project-aware wording (drop
      hardcoded `bun run …`). - event-emit `bun run cli …` → `archon … || true`.
- [x] Keep F3 fix (resolve-plan discovery, spaces-safe) + its 3 regression tests in ak-implement.yaml.
- [x] Regenerate bundle; `check:bundled` up to date (67 commands, 37 workflows).
- [x] `workflow list` → errorCount:0; archon-ralph-dag present; 0 fork entries.
- [x] Rewrite `ARCHON_RALPH_RUST_DAG_PLAN.md` to the project-aware decision + record fork rejection.

## Rejected

- The cargo-hardcoded fork (`archon-ralph-rust-dag` + `ak-implement-rust`). Swapped one hardcode for
  another, duplicated 789+310 lines, and would override project-owned publish policy.
- F1 (mutually-exclusive detect branch) and F2 (final-cargo-gate, child-no-PR) were fork-specific and are
  moot. If `ak-implement` hardening is wanted for all stacks, do it on the shared workflow separately.

## Validation

- [x] `bun run check:bundled` → up to date.
- [x] `bun run cli workflow list` → `errorCount:0`; `archon-ralph-dag` loads; no `*-rust-dag` /
      `ak-implement-rust`.
- [x] `grep -n 'bun run' archon-ralph-dag.yaml` → 1 line (JS example inside Toolchain detection note).
- [x] `bun test bundled-defaults.test.ts` → pass (incl. 3 resolve-plan regression tests).

## Files changed

- `.archon/workflows/defaults/archon-ralph-dag.yaml` — loop validation made project-aware.
- `.archon/workflows/defaults/ak-implement.yaml` — resolve-plan discovery fix (spaces-safe) [F3].
- `packages/workflows/src/defaults/bundled-defaults.generated.ts` — regenerated.
- `packages/workflows/src/defaults/bundled-defaults.test.ts` — 3 resolve-plan regression tests.
- `ARCHON_RALPH_RUST_DAG_PLAN.md` — rewritten to the project-aware decision.
- Deleted: `archon-ralph-rust-dag.yaml`, `ak-implement-rust.yaml`.
