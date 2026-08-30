# Reconcile — Source Control PRD vs source spec set

**Scope:** Walk the canonical contract (SPEC.md + brownfield.md + viewer-rules.md + architecture-diagrams.md + roadmap.md) and brainstorm-intent.md claim-by-claim against `prd.md` + `addendum.md`. Confirm every load-bearing claim landed; flag dropped intent nuance; flag contradictions with locked decisions; confirm self-containment.

**Verdict:** PASS with minor findings. All load-bearing capabilities, constraints, non-goals, and viewer/diff rules are preserved in prd.md + addendum.md. One genuine contradiction (snapshot trigger) and a handful of low-severity nuance drops. PRD + addendum are self-contained (no parent-workspace dependency, no `..` traversal).

---

## Coverage matrix (load-bearing source claim → landing site)

| Source claim                                                                                                                               | Where in source                                      | Landed in PRD/addendum                                                       |
| ------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------- | ---------------------------------------------------------------------------- |
| 4th tab Source Control, Changes above history, VS Code SCM shape                                                                           | CAP-1, viewer-rules §two-regions                     | FR-1, §4.1, glossary, diagrams ✓                                             |
| M/A/D badges for Now + per-commit                                                                                                          | CAP-2                                                | FR-3 ✓                                                                       |
| git-status projection: rename→D+A, copy→A, type-change→M, unmerged→M                                                                       | CAP-2, viewer-rules §9                               | FR-3 consequence + addendum ✓                                                |
| Shared viewer keyed by status; M=2-pane red/green, A=1-pane new, D=1-pane removed no color                                                 | CAP-3, viewer-rules table                            | FR-4 ✓                                                                       |
| Diff direction: Now=HEAD→worktree, commit=parent→commit; before=left/red                                                                   | CAP-3, viewer-rules §diff                            | FR-4 + addendum ✓                                                            |
| Inspect any commit incl. commits not on base branch                                                                                        | CAP-4                                                | FR-6 ✓                                                                       |
| Read-only, run-confined, no write/commit/path-injection, no read outside realpathed worktree                                               | CAP-5, brownfield §security                          | FR-7 + NFR Security ✓                                                        |
| Every file opens (large text + binary) without blocking                                                                                    | CAP-7                                                | FR-5 ✓                                                                       |
| Durable snapshot fallback; live primary / snapshot fallback                                                                                | CAP-8, brownfield §durable                           | FR-9 (fast-follow) + addendum ✓                                              |
| Read via `git -C working_path`, never base `default_cwd` (dev)                                                                             | Constraint, brownfield §read-source                  | addendum §read-model ✓                                                       |
| Pin to `working_path`+`codebase_id` from GET run; realpath (two root strings); read uniformly                                              | Constraint, brownfield §path-pinning                 | addendum §path-pinning + §read-model "read by working_path, uniformly" ✓     |
| New read-only API modeled on artifact route + `resolveRunArtifactDir`, `..` rejected; `@archon/git` only `hasUncommittedChanges`           | Constraint, brownfield §no-API                       | addendum §new-API ✓                                                          |
| Server resolves path from runId, never accepts client path; execFileAsync no shell-string                                                  | Constraint, brownfield §security                     | FR-7 + addendum + NFR ✓                                                      |
| Checkout vanishes mid-view; cleanup triggers; terminal status ≠ removed; detect by dir existence at read time (not env/run status)         | Constraint, brownfield §lifecycle                    | FR-8 + addendum §lifecycle + NFR Reliability ✓                               |
| Post-cleanup GC → capture-before-teardown                                                                                                  | Constraint, brownfield §GC                           | addendum §lifecycle/GC ✓                                                     |
| Container-backend runs out of v1 → empty state (host path stale mid-run; overlay read post-v1)                                             | Constraint, Non-goal, brownfield §container, roadmap | §5, §6.2, addendum §container ✓                                              |
| Events are provenance-only, never the change list                                                                                          | Non-goal, brownfield §events                         | §5, addendum §read-model ✓                                                   |
| Non-goals: no M-snapshot mode, no Explorer tree, no edit/commit, no polling, not an IDE/file-browser                                       | Non-goals                                            | §5 (all) ✓                                                                   |
| Submodules init `--recursive`                                                                                                              | brownfield §path-pinning                             | addendum §path-pinning ✓                                                     |
| Large-text thresholds (~256KB/~2000 lines first paint; M=hunks+3 ctx); >1MB stream+Cancel; >50MB download-only; skeleton+Cancel            | viewer-rules §large+binary                           | addendum §every-file-opens ✓                                                 |
| Binary: NUL in first 8KB; images inline (png/jpg/gif/webp/svg); others download+hex-peek ~4KB                                              | viewer-rules §binary                                 | addendum §every-file-opens ✓                                                 |
| Untracked-new uses A mechanism                                                                                                             | viewer-rules §states                                 | addendum §viewer ✓                                                           |
| Manual Reload; "changed — Reload" affordance not mutate under reader                                                                       | viewer-rules §refresh                                | FR-2 + addendum ✓                                                            |
| Snapshot mechanic: name-status + per-file diff + A/D content + git log under output_root (output_root written at run start)                | brownfield §durable                                  | addendum §durable + FR-9 ✓                                                   |
| Checkout on-disk presence never `stat`'d in planning → verify at build                                                                     | Constraint, brownfield §validation                   | §8.1 + addendum §lifecycle ✓                                                 |
| Archon package boundaries (execFileAsync, registerOpenApiRoute, @archon/web OpenAPI-types boundary, no SDK leak outside @archon/providers) | Constraint, adopted project-context                  | addendum §new-API + NFR Compatibility ✓ (inlined; no parent-file dependency) |
| JTBD "did this run change the files I think it did?"                                                                                       | SPEC Why, brainstorm JTBD                            | §1, §2.1 ✓                                                                   |
| Absence-of-local-repo is the _reason_ the feature exists, not a limitation                                                                 | SPEC Why, brainstorm                                 | §1 ✓                                                                         |
| Not an IDE / not a generic file tree contrast                                                                                              | SPEC Why, brainstorm                                 | §1, §5 ✓                                                                     |
| English authoring / Vietnamese origin                                                                                                      | SPEC Assumptions                                     | §9 ✓                                                                         |

---

## Gap list

### G1 — CONTRADICTION: snapshot trigger reopened vs a locked decision — **Severity: MEDIUM**

- **What:** brownfield.md §durable (line 57) locks the CAP-8 trigger: _"Trigger fixed to run-end (v1 of CAP-8); the wire format (a JSON manifest) is decided at build."_ Only the **wire format** is left open. The PRD reopens the **trigger** as undecided: prd.md §8.2 ("run-end only vs per-commit … Decide at build"), FR-9 note (line 188, "Snapshot trigger (run-end vs per-commit) … finalized at build"), and addendum.md line 59 ("Undecided at build: trigger (run-end vs per-commit)").
- **Where in source:** brownfield.md line 57 (locked); cf. SPEC success line 71 ("run-end snapshot"), brownfield line 55 ("at run-end the server writes").
- **Mitigating:** architecture-diagrams.md line 44 shows "(checkpoint: run-end / per-commit)" — the spec set is itself slightly ambiguous, which likely seeded the drift. Also CAP-8 is a fast-follow (not v1-critical), lowering blast radius.
- **Recommendation:** re-lock trigger = run-end for v1 of CAP-8 (per brownfield, the load-bearing constraints doc); keep only the wire format as the open question. Do NOT silently flip either way — surface to PM.

### G2 — NUANCE DROP: FR-8 trigger list omits the container-backend empty-state case — **Severity: LOW-MEDIUM**

- **What:** CAP-6 intent (SPEC line 39) enumerates **four** empty-state triggers: null `working_path`, directory absent at read time, not a git checkout, **and a container-backend run whose host path is stale**. FR-8's testable consequence list (prd.md lines 169-172) covers only the first three; container→empty-state is handled only as a §5/§6.2 non-goal. An implementation/test agent reading FR-8 in isolation may not add a container→empty-state case.
- **Where in source:** SPEC.md CAP-6 (line 39).
- **Recommendation:** add container-backend (stale host path) as an explicit FR-8 empty-state consequence, cross-linking §5.

### G3 — INTENT NUANCE: "live remote worktree radar" metaphor dropped — **Severity: LOW**

- **What:** brainstorm framing (line 11) is _"một radar worktree remote sống, không phải một cây file IDE"_ (a **live remote-worktree radar**, not an IDE file tree). PRD renders this as "run-scoped git inspector" (§1). The substantive contrast (not-an-IDE / not-a-generic-file-browser) is fully preserved; only the "radar" image is gone.
- **Where in source:** brainstorm-intent.md line 11-15.
- **Note:** SPEC.md itself already dropped "radar" (uses "git inspector"), so this is not a PRD regression against the canonical contract — informational only.

### G4 — ILLUSTRATIVE DROP: concrete success-signal run name not carried — **Severity: LOW**

- **What:** SPEC Success signal (line 71) names a real run (`speckit-no-hitl-feature`) as the acceptance walkthrough. SM-1 (prd.md line 222) keeps the intent ("on real runs") but drops the concrete example.
- **Where in source:** SPEC.md line 71.
- **Note:** illustrative color, not load-bearing; acceptable. Optional to re-add as a validation example.

### G5 — MECHANISM DETAIL DROP (non-gap): "distinguish worktree vs in-place by codebase kind / isolation provider" — **Severity: LOW (informational)**

- **What:** brownfield.md line 9 says to distinguish an isolated worktree from an in-place/non-git run "by codebase `kind` / isolation provider, not by null." The addendum simplifies to uniform "read by `working_path` + directory/is-git existence check."
- **Note:** the SPEC (line 51) _already_ made this simplification ("read the same way, by `working_path`"), and the addendum preserves the load-bearing half — that `working_path` is NOT null for folder/`--no-worktree` runs and null = missing/legacy → empty state (addendum line 16). Consistent with the canonical contract; not a real gap.

---

## Resolved evolutions (PRD correctly tracks newer canonical decision — NOT contradictions)

- **M/A → M/A/D:** brainstorm MUST (line 19) and line 85 say "only two states M and A." SPEC/viewer-rules elevated to three states **M/A/D**. PRD uses M/A/D (FR-3/FR-4) — correctly follows the canonical SPEC, not the older brainstorm.
- **Empty-state detection:** brainstorm (lines 58-59) proposed gating on env status `active|destroyed` **plus** worktree existence. SPEC/brownfield revised to **directory-existence at read time only, do NOT gate on isolation-env or run status** (brownfield line 24). PRD follows the revision (addendum line 9 "no isolation-env gate"; FR-8) — correct.

---

## New PRD material (additions beyond the spec — acceptable, recorded)

- **Secret-redaction deferral** (§5, §6.2, §8.4, Constraints & Guardrails, SM-C2): the SPEC/brainstorm do not mention secret handling. The PRD introduces the deferral **with a recorded residual risk** and a revisit trigger. This is an addition, not a contradiction — consistent with CAP-5's read-only/trusted-user framing.

---

## Self-containment check — PASS

- PRD §0 and §Integration ("Self-contained handoff") assert no parent-workspace files are needed for an isolated Archon implementation agent. Verified:
  - `prd.md` companions = `addendum.md` (local sibling); no other required-reading references.
  - All code references in the addendum point **inside** the `archon` subproject (`packages/server/src/routes/api.ts`, `packages/git/…`, `packages/isolation/…`, `packages/web/…`, `packages/workflows/…`) — the implementation agent's own tree.
  - The `source:` frontmatter mentioning the spec/brainstorm is **provenance only**, not a dependency.
  - The adopted Archon coding rules from `../../../archon/_bmad-output/project-context.md` are **inlined** into the addendum + NFR Compatibility — no `..` traversal or external read required.
  - No `..` path traversal is required to build from prd.md + addendum.md.
