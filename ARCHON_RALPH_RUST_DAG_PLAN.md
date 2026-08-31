# Ralph loop: project-aware validation + issue/plan-aware, co-located PRD

Improvements to the `ak-implement` pipeline. The shared `archon-ralph-dag.yaml` stays untouched
(bun-hardcoded original) — zero blast radius.

## 1. Project-aware validation — separate workflow file

- **`archon-ralph-dag.yaml`** — original, untouched.
- **`archon-ralph-dag-project-aware.yaml`** — new; the loop's VALIDATE steps run the PROJECT's own
  checks (Toolchain detection: Cargo.toml→cargo, package.json→bun/npm, go.mod→go, pyproject→python;
  prefer the story's acceptanceCriteria) and respect the project's own build/publish policy. Its
  `detect-input` accepts ANY directory holding prd.json+prd.md (not just `.archon/ralph/`); `validate-prd`
  trusts detect-input's prd_dir (no global `.archon/ralph` scan).
- **`ak-implement.yaml`** `ralph-implement` → `archon-ralph-dag-project-aware`.
- Rejected the cargo-hardcoded fork (`archon-ralph-rust-dag` + `ak-implement-rust`).

## 2. Input: a GitHub issue OR a local plan path; PRD co-located with the plan

`ak-implement`'s `$ARGUMENTS` is commonly a GitHub issue (e.g.
`https://github.com/…/x10.gigo.harness-service/issues/178`) whose body links the canonical plan
(`**Plan (canonical, files-first):** [`plans/<slug>/plan.md`](…)`). The pipeline resolves the plan
location and writes the Ralph PRD NEXT TO the plan (never `.archon/ralph/`).

- **`resolve-plan-source`** (AI, prompt + `gh`, output `{plan_path}`): if `$ARGUMENTS` is a GitHub issue
  (URL or `#N`), resolve the repo (URL's owner/repo, else current repo's origin), `gh issue view` it, and
  extract the canonical plan path its body links — returns a LOCAL path (never the URL). If `$ARGUMENTS`
  is already a local dir / `.md` file, passes it through. (AI, per "Natural Language Is Not a Wire
  Format": the agent interprets the issue; bash validates the returned path.)
- **`resolve-plan`** (bash, deterministic) consumes `$resolve-plan-source.output.plan_path`, then:
  - Directory plan → `prd_dir = <that directory>`.
  - Canonical `<dir>/plan.md` → NORMALIZED to `<dir>` (so the whole plan dir — plan.md + phase-\*.md — is
    read, and the PRD co-locates in `<dir>`). Prevents the `plans/ralph/plan` mistake.
  - Any other `<dir>/<name>.md` → `prd_dir = <dirname(dirname)>/ralph/<name>` (parent dir name → `ralph`):
    - `docs/superpowers/plans/foo.md` → `docs/superpowers/ralph/foo/`
    - `plans/architectures/bar.md` → `plans/ralph/bar/`
  - `mkdir -p prd_dir`; emits JSON `{plan_path, prd_dir}` (diagnostics → stderr).
- **`build-ralph-prd`** reads `$resolve-plan.output.plan_path` (dir → plan.md + phase-\*.md; file → the
  file), writes prd.md/prd.json ONLY into `$resolve-plan.output.prd_dir`.
- **`verify-and-complete`** reads the plan via `.plan_path`; audit written into
  `$build-ralph-prd.output.prd_dir`.

Confirmed a schemaless bash node emitting JSON resolves `$node.output.field` (output-ref.ts path 3), so
the deterministic bash resolver can hand structured `{plan_path, prd_dir}` downstream.

## Verification (repo Archon)

1. `bun run validate` → exit 0.
2. `bun run check:bundled` → up to date (67 commands, 38 workflows).
3. `bun run cli workflow list` → `errorCount:0`; `archon-ralph-dag` (original) and
   `archon-ralph-dag-project-aware`; `ak-implement` (with `resolve-plan-source` → `resolve-plan` chain)
   loads.
4. `bun test packages/workflows/src/defaults/bundled-defaults.test.ts` → 39 pass, incl. 7 resolve-plan
   tests: directory plan; canonical `<slug>/plan.md` → directory (NOT `plans/ralph/plan`); file →
   `docs/superpowers/ralph/<name>`; file → `plans/ralph/<name>`; empty → exit 1; missing → exit 1; non-.md
   → exit 1 (run against the SHIPPED bundled bash with the source token injected).

## Assumptions

- Issue-driven runs: the issue body links a plan path under `plans/…`, `specs/…`, or
  `docs/superpowers/plans/…`. `gh` is authed in the run environment.
- Directory plans hold `plan.md` (+ optional phase files); a file plan is any other `.md`.
- Loop agent detects the toolchain from manifest/CLAUDE.md/AGENTS.md and prefers the story's
  acceptance-criteria commands.
