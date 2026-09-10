# Reusable Verification Skill Generators Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver two project-aware generators whose outputs select and prove declared user behaviors through one portable, executable contract.

**Architecture:** Upgrade `create-verification-skill` to own the protocol, catalog, normalization, proof, and qualification procedure. Add `create-select-verify-target-skill` as a consumer of the generated verifier's contract. Reuse each target project's durable tests and native runtime; do not introduce a universal runner package.

**Tech Stack:** Markdown skills, JSON Schema 2020-12 and JSON conformance fixtures. Author-side checks use Python 3.9+, `unittest`, `jsonschema==4.23.0`, and `PyYAML==6.0.2` in an isolated environment; these are not mandatory runtimes for generated verifiers. The reference evaluation uses Archon's existing Bun/Playwright suite; the independent evaluation uses a Python CLI.

**Spec:** `docs/superpowers/specs/2026-09-10-reusable-verification-generators-design.md` in the Archon verification worktree; approved by the user on 2026-09-10.

## Global Constraints

- "No third orchestration skill is needed for v1."
- "The verifier owns behavior definitions, scenario bindings, gap records, schemas, normalization, execution, and result aggregation."
- "Do not use a fixed feature count across projects."
- "Do not repair production behavior to make qualification green."
- "Commit-bound selection in v1 requires Git."
- "Proof exits zero only on product PASS."
- "Every attempt uses a fresh evidence directory and its own result."
- "Do not advertise compatibility or automatically invoke" the old maintenance skill.
- Preserve existing installed invocation metadata and the previously tested Archon skills, tests, workflow, staged changes, and historical worktrees.
- No global skill edits, automatic installation, production driving, force pushes, merges, or consumer-product commits.
- Use `apply_patch` for manual files. Stage explicit paths. A task's commit must not include another task's or the user's changes.

## Source and Authorization Gate

The installed lock records `oceanlabs-holding/skills`, source path `plugins/create-verification-skill/skills/create-verification-skill/SKILL.md`. The installed directory is not a Git checkout.

Read-only planning clone: `/tmp/verification-generators-plan.OC5YKi/skills`, observed HEAD `9ad1bd81555b311c348899870bec0839d83fbbdc`, default branch `master`. It remains unmodified. Recheck the source at execution time; do not assume this temporary clone still exists.

Source `AGENTS.md` and `update-and-publish-oceanlabs-skill` require generalization, a feature branch, commits with Problem/Why/How/Context/Generalization, and an opened PR after plugin edits. They prohibit treating installed/cache directories as source. **Resolved 2026-09-10: after disclosure, the user authorized plugin edits and packaging the new skill as a plugin. Source PR delivery is included; merging and installed-skill updates are not.**

After authorization, use the publisher skill's preflight and clone procedure, then create `update/verification-generators-v1`. Record the actual clone and evidence roots as `SKILLS_REPO` and `EVAL_ROOT` in the executor's run notes. All plugin/test paths below are relative to `SKILLS_REPO`; logs and generated evaluation projects live under a fresh external `EVAL_ROOT`.

## File Responsibilities

| Path | Responsibility |
| --- | --- |
| `plugins/create-verification-skill/skills/create-verification-skill/SKILL.md` | Discovery, scope confirmation, generation, qualification, and boundaries. |
| Same directory: `references/protocol.md` | Authoritative protocol operations, invariants, canonicalization, errors, and compatibility. |
| Same directory: `references/qualification.md` | Live controls, evidence, cleanup, and qualified/partial/blocked outcomes. |
| Same directory: `assets/protocol/schemas/*.schema.json` | Self-contained schemas copied into generated verifiers. |
| Same directory: `assets/protocol/conformance.json` | Portable schema, selection, and result test vectors. |
| Same directory: existing `references/feature-map-example/` | Narrative example updated to point to machine coverage, not a second authority. |
| `plugins/create-select-verify-target-skill/skills/create-select-verify-target-skill/SKILL.md` | Locate compatible verifier, inspect project impact, create and qualify the selector. |
| Same directory: `references/selector-evaluation.md` | Behavior-based selection evaluation, without another canonical schema. |
| `scripts/check-verification-assets.py` | Author-side parser/schema/link/metadata checks; not a project proof runner. |
| `tests/test_verification_assets.py` | Tests for that checker and the protocol assets. |
| `tests/test_verification_fixture.py` | Tests of the disposable evaluation application's public CLI. |
| `tests/test_verification_packaging.py` | Plugin discovery, version, and install-list consistency checks. |
| `tests/verification-requirements.txt` | Pinned author-check dependencies. |
| `tests/fixtures/verification-notes/notes/{cli,storage}.py` | Tiny real CLI and persistence layer, for evaluation only. |
| `tests/fixtures/verification-notes/README.md` | User commands and expected behavior of that CLI. |
| `.claude-plugin/marketplace.json`, `README.md` | Register the new plugin and document the normal distribution path. |

Keep raw agent prompts, transcripts, expected selections, generated skills, product snapshots, and execution reports outside published plugin bodies. Reference-project names belong in private evaluation notes, not reusable generator instructions.

## Task 1: Establish Baselines and a Real Independent Fixture

**Files:** Create the three evaluation-fixture files above and `tests/test_verification_fixture.py`; create `tests/verification-requirements.txt`. Keep baseline transcripts under `EVAL_ROOT/baseline/`.

**Interfaces:** `python -m notes.cli --file PATH add TEXT` appends a note and prints its integer ID as JSON; `list` prints the stored array. Each record is `{id: integer, text: string}`. Blank text exits 2 without changing storage. IDs increase from 1. The parent directory must already exist. Corrupt existing JSON exits nonzero without rewriting it. All state is confined to the explicitly supplied file.

- [ ] Write the public-CLI test before implementing the fixture. The test must read authoritative state with a second process, not trust the add response:

```python
def test_add_survives_a_fresh_process(self):
    with tempfile.TemporaryDirectory() as tmp:
        path = Path(tmp) / "notes.json"
        command = [sys.executable, "-m", "notes.cli", "--file", str(path)]
        created = subprocess.run(command + ["add", "first"], cwd=FIXTURE,
                                 capture_output=True, text=True, check=True)
        listed = subprocess.run(command + ["list"], cwd=FIXTURE,
                                capture_output=True, text=True, check=True)
        self.assertEqual(json.loads(created.stdout), 1)
        self.assertEqual(json.loads(listed.stdout), [{"id": 1, "text": "first"}])
```

Define `FIXTURE` from the test file's repository root and import the standard-library modules shown. Add tests for a second append, blank text leaving bytes unchanged, and corrupt JSON leaving bytes unchanged.

- [ ] Run `python3 -m unittest discover -s tests -p test_verification_fixture.py -v`. Observe failure because the CLI does not exist. Implement `cli.main(argv: list[str]) -> int` using `argparse` and `storage.load(path: Path) -> list[dict]` / `storage.add(path: Path, text: str) -> int` using JSON and atomic file replacement. Annotate record types with `TypedDict`, not unconstrained dictionaries, in the actual code. Re-run to green.
- [ ] Prepare a clean Git repository from the fixture under `EVAL_ROOT`. Keep a healthy commit and, in a separate disposable checkout only, a defective commit that acknowledges add but omits the write. Run the same public test on both. The negative control must fail because the note is absent after a fresh process, not because imports or startup fail. Do not publish the defective implementation as a normal fixture.
- [ ] Before editing generator instructions, run a fresh consumer with the installed old generator against the healthy fixture and the request below. Do not supply this implementation plan or the expected answer:

```text
Use create-verification-skill to make this project's note creation and listing
verifiable by another agent. Discover the project before proposing coverage.
After I confirm scope, build and exercise the generated verifier. Keep product
code unchanged and preserve evidence. Report exactly what is proven and missing.
```

Complete the consumer's actual scope-confirmation exchange; do not invent a user approval. Record whether its output has executable behavior coverage, retained evidence, and a machine handoff usable by a selector. Reuse the same raw request later with the new generator. Baseline failures must be observed, not inferred from absence of new filenames.

- [ ] Run an unguided selector-generation baseline against an explicitly prepared compatible verifier once Task 2's contract is available, before Task 4. Keep that baseline separate from the old-verifier baseline. No guidance control and revised guidance must see equivalent raw project evidence.
- [ ] Commit only the healthy fixture, its passing tests, and author dependency pins, with the required five-part commit context. Keep baseline evidence external. This task does not claim either generator is implemented.

## Task 2: Define and Check the Portable Contract

**Files:** Create `references/protocol.md`, `assets/protocol/schemas/{contract,catalog,gaps,snapshot,proposal,selection,result}.schema.json`, `assets/protocol/conformance.json`, `scripts/check-verification-assets.py`, and `tests/test_verification_assets.py`.

**Interfaces:** The checker accepts `--repo PATH` and optional `--skill NAME`, reads only the selected generator tree(s), prints JSON `{ok: boolean, errors: string[]}`, and exits 0 iff checks pass. Default scope is both generators; Task 2 uses `--skill create-verification-skill` because the selector does not exist yet. Packaging is checked separately in Task 6. Schemas use protocol `project-verification` version `1`; each is self-contained, with local `$defs` where needed. Individual feature files validate against the catalog schema's feature definition. The conformance file contains arrays `schema_cases`, `selection_cases`, and `result_cases`. A generated helper uses its native unit tests to consume the semantic vectors; the author checker must not pretend structural schema validation proves normalization or execution semantics.

- [ ] Add checker tests that call it as a subprocess and parse JSON; first test fails because the checker/assets are missing. Test one valid artifact and one invalid required field for each schema. The fixture below tests report structure, not real product proof:

```python
def test_proposal_rejects_empty_impact(self):
    case = next(c for c in self.vectors["schema_cases"]
                if c["id"] == "proposal-valid")
    invalid = copy.deepcopy(case["instance"])
    invalid["affected_behaviors"] = []
    with self.assertRaises(jsonschema.ValidationError):
        self.validators["proposal"].validate(invalid)
```

In `setUp`, load the assets through `Path` and `json`, construct `Draft202012Validator` instances keyed by schema filename stem, and load `conformance.json`. No remote schema retrieval is needed. Create the author environment with `python3 -m venv "$EVAL_ROOT/venv"` and install with `"$EVAL_ROOT/venv/bin/python" -m pip install -r tests/verification-requirements.txt`. Record resolved transitive versions externally; direct pins alone are not a complete lock. Official release references: [jsonschema 4.23.0](https://pypi.org/project/jsonschema/4.23.0/) and [PyYAML 6.0.2](https://pypi.org/project/PyYAML/6.0.2/).

- [ ] Implement schema constraints with these exact artifact fields; use strict object properties and nonempty IDs/paths. Each JSON document carries `version: 1`:

| Schema | Fields |
| --- | --- |
| contract | `protocol`, `version`, `skill`, `entrypoint: string[]`, `schemas: {catalog,gaps,snapshot,proposal,selection,result}`; paths are relative to the descriptor directory. |
| catalog | `version`, `features`, `gaps`, `catalog_sha256`; each feature has `id,description,impact_paths,behaviors,scenarios`. |
| gaps | `version`, `gaps`; each gap has `id,description,impact_paths,reason`. |
| snapshot | `version`, `base_sha`, `head_sha`, `changed_paths`, `dirty`. |
| proposal | `version`, `base_sha`, `head_sha`, `changed_paths`, `affected_behaviors`, `coverage_gaps`; each affected behavior has `id,confidence,rationale`. |
| selection | `version`, `proposal`, `catalog_sha256`, `behavior_ids`, `scenario_ids`, `broadened_features`. |
| result | `version`, `run_id`, `mode`, `repo`, `product`, `catalog_sha256`, `selection_sha256`, `tooling_sha256`, `behavior_ids`, `scenario_ids`, `scenarios`, `errors`, `ok`, `verdict`, `evidence_dir`. |

Behavior entries have `id,description,priority,impact_paths,scenarios`. Scenario entries have `id,runner,prerequisites,proof_obligations`; runner is `{kind: string, id: string}`, resolved by the native helper's documented registry, not executable prose. A runtime must reject an unknown binding before proof. Results use `mode: selection | scenario-debug` and `verdict: PASS | FAIL`. Each scenario result has `id,status,errors,attachments`; status is `passed | failed | flaky | skipped | missing | unsupported`; attachments have `name,path`.

Passing selection-mode results require a clean non-null snapshot and selection digest. Failed attempts may have null unavailable provenance/digests when preflight prevented computing them, with explicit errors; still write a fresh FAIL result. Diagnostic results may have null unavailable provenance/selection fields, explicitly documented. Schema conditions reject `ok: true` paired with verdict FAIL, but completeness/digest/current-checkout validation remains executable logic. Known gaps are included when hashing the catalog, excluding the digest field itself.

Selection operations accept `--base REF` as an independent caller-supplied bound (or resolve the documented observed development-branch merge-base when omitted). Never accept proposal.base_sha itself as authority for the expected base. Empty-diff historical selection requires explicit `--historical` and a named behavior request; normal change selection rejects an empty diff. These additive flags make the spec's substituted-base and explicit-historical rules executable, without implicit state files.

- [ ] Write the exact helper operations from the spec into `protocol.md`; proof accepts `--evidence-root PATH` and creates a fresh child directory for each attempt. Define base ancestry, full diff handling including both rename endpoints, clean-target checks, unknown-path failure, scope broadening, actual scenario resolution, startup/timeout/cleanup failure handling, and fresh evidence semantics. Define canonicalization as UTF-8 compact JSON with object keys sorted by Unicode code point, no ASCII escaping, and no NaN/Infinity; normalize only documented set-valued arrays before hashing. Include cross-language vectors with Unicode, path reordering, and duplicate semantic IDs. Use integer protocol counters; scenario payloads are not hashed through an unspecified float serializer.
- [ ] Populate selection vectors with a complete two-behavior notes catalog, snapshot, proposal, and either expected normalized fields or expected failure category. Cover high confidence, medium/low expansion, a shared storage file adding the omitted behavior, uncovered behavior, unknown ID/path, omitted/deleted/renamed paths, substituted base, dirty target, and order-equivalent path sets. Rejection vectors for duplicate catalog IDs must fail catalog construction, not silently deduplicate identities.
- [ ] Populate result vectors for a complete PASS and each nonpassing required status, duplicate/missing/extra scenario, contradictory top-level PASS, stale product/catalog/tooling/selection, and missing current result after an earlier PASS. Label these as guard conformance fixtures, never as real behavioral evidence.
- [ ] Implement the checker using `yaml.safe_load` for frontmatter and `jsonschema` for artifacts. Preserve the old `disable-model-invocation: true` field and validate its type; the generic installed `quick_validate.py` currently rejects that supported existing key, so do not remove invocation policy to satisfy it. Validate every local reference and schema file, and reject unresolved generator placeholders in generated evaluation outputs.
- [ ] Run author checks to green with `"$EVAL_ROOT/venv/bin/python" -m unittest discover -s tests -p test_verification_assets.py -v` and the checker scoped to `--skill create-verification-skill`. Record that schema tests do not yet establish generator or runner correctness. Commit the protocol/checker changes with the required context.

## Task 3: Upgrade and Qualify create-verification-skill

**Files:** Modify the existing generator `SKILL.md` and its three feature-map example files; create `references/qualification.md`. Reuse Task 2's assets without embedding another contract in the main body.

**Interfaces:** Consumes an inspected project, user-approved scope, and canonical protocol assets. Produces the verifier tree from the spec, project-native runnable scenarios, a valid `contract.json`, and an external qualification report. It does not create the selector automatically.

- [ ] Review the actual old-generator baseline and identify which requirements were missed. Add bounded pressure probes for smoke-only completion, missing auth, a dirty authoring checkout, and a framework different from the reference project. For new behavior-shaping wording, compare five fresh-context samples with the control before relying on the wording. Keep full generation/drive evaluation separate from these cheap probes.
- [ ] Replace the generator's top-level procedure with the following control structure, expanding through references only where the reader needs it:

```markdown
## Discover and agree scope
Read the project's instructions, public surfaces, tests, launch/data/auth setup,
and isolation boundaries. Recommend primary journeys and high-consequence
variants with source evidence; record deferred behaviors. Confirm scope and
necessary verification-file/dependency edits before generation.

## Generate the verifier
Read references/protocol.md. Install its schemas locally, construct the
behavior/scenario catalog and explicit gaps, and reuse the project's native
tests. Write exact launch/doctor/drive/evidence/cleanup commands. Keep tooling
and the target checkout independently addressable.

## Qualify and hand off
Read references/qualification.md. Execute every agreed scenario and preserve
the actual product verdict. Report qualified scope, partial work, blockers,
and missing controls. Describe how to invoke create-select-verify-target-skill
next; do not invoke it or update workflows/maintenance automatically.
```

- [ ] Update the old example so its Markdown is navigation/user guidance and its machine binding is authoritative. Retain useful reachability/interaction/gotcha content; remove the instruction that driving one convenient feature qualifies all mapped coverage. Keep published wording project-agnostic and preserve existing frontmatter policy.
- [ ] Run the new generator on a fresh independent fixture through an actual scope-confirmation exchange. Inspect the resulting native tests, schemas, catalog, helper help and qualification result. No undeclared Bun, Archon import, browser, or server dependency is acceptable for the simple CLI.
- [ ] Execute the generated helper on the healthy and defective targets. Check process exit, `result.json`, actual file read-back, and surviving evidence after cleanup. Also remove a required result and retry after a prior PASS: the new attempt must fail. Run the generated helper's native tests against the portable semantic vectors from Task 2.
- [ ] Do not advance to selector implementation until this generator has passed its local qualification or the user has explicitly resolved a blocker. Re-run failed cases after corrections. Commit only the verifier generator/reference changes; do not install globally or publish an unqualified version.

## Task 4: Create and Qualify create-select-verify-target-skill

**Files:** Create the new selector generator `SKILL.md` and `references/selector-evaluation.md`; extend author checker tests for its references and metadata.

**Interfaces:** Consumes a compatible project-local `contract.json`, catalog/gaps, actual project source/branch conventions, and raw change requests. Produces `.agents/skills/select-verify-<project>-targets/SKILL.md` plus substantial project-specific notes only when needed. Runtime handoff remains `proposal.json -> normalize-selection -> selection.json`.

- [ ] Complete the unguided selector baseline deferred in Task 1 against the qualified verifier. Use the same normal, shared-module, and uncovered-change prompts for baseline and revised generator. The consumer must not receive expected IDs, prior findings, or prepared rationale.
- [ ] Write the generator around this decision sequence:

```markdown
## Locate the verifier
Resolve an explicit target or the single compatible local candidate. Read its
descriptor, schemas, catalog, gaps, helper help and qualification limits.
Missing/unsupported contracts stop generation with an upgrade prerequisite.

## Inspect project impact
Read actual branch conventions, public entry points, shared modules and tests.
Generate instructions that require the full request/plan and complete diff.

## Generate and qualify selection
The generated agent proposes behavior IDs, confidence, rationale and gaps.
It invokes the verifier to normalize and validate; it never edits normalized
scenario IDs, duplicates the catalog or declares a product PASS. Test local,
cross-cutting, uncertain, uncovered and stale-input handoffs through the real
helper. Report expansion and failures using the helper's artifacts.
```

- [ ] Run discovery failures for no verifier, multiple ambiguous verifiers, incompatible version, broken entrypoint, and an uncovered behavior. The outcome must be a precise prerequisite/coverage error, not an invented selector contract or default smoke.
- [ ] On isolated fixture commits, change CLI-only handling, then shared storage, then a new unmapped export surface. Read the actual normalized selections and gaps. Shared storage must include both affected note behaviors; uncovered changes must not hand off a usable selection. A later HEAD or catalog change invalidates the earlier selection.
- [ ] Verify that the selector still works when only generated skills are available and both generator directories are absent from the consumer environment. Use `--scenario` only for explicitly diagnostic requests, not as an escape from failed change selection. Commit the qualified selector generator and its checks.

## Task 5: Exercise Both Generators Against the Reference Project

**Files:** No edits in the original Archon checkout or its existing worktrees. Generated verifier/selector/native-test changes belong only in a new external evaluation copy; reports under `EVAL_ROOT/reference/`.

**Interfaces:** Use the known target commit `095bc33fa2edf22a475f7fee3857318fc091e864` for the Ask regression. The existing `hitl.answer` binding and the three durable Ask scenarios are evaluation input, not portable generator literals. Tooling and target paths remain separate.

- [ ] Record hashes/status of the existing Archon work before the experiment. Prepare a separate copy of the current verification tooling and a clean detached product target. The generator must inspect the existing verifier, identify incompatibility with the new descriptor/protocol, and ask for the scoped upgrade before editing the evaluation copy.
- [ ] Run `create-verification-skill` there. Reuse durable Ask scenarios rather than reproducing them in a private harness. Accept no protocol claiming that the old artifact `version: 1` alone establishes compatibility with `project-verification` v1.
- [ ] Run `create-select-verify-target-skill` there and consume both generated skills in a fresh context. Check selected obligations for Ask answering from the request, then for a real changed shared owner/viewer consumer in a separate prepared fixture. Do not tell the consumer the expected selection.
- [ ] Execute required proof. Healthy owned Ask must submit via the UI, persist its answer, explicitly continue, and reach completed UI. The defective unowned Console and Legacy controls must return product FAIL at the behavioral assertion. Missing auth, build failure, or broken selectors do not count as defect detection.
- [ ] Repeat the invalidation checks after a product HEAD change and a verification-tooling change. Missing/skipped/flaky/unsupported proof and old evidence must block PASS. Confirm runtime ownership/cleanup and compare protected original hashes/status again.
- [ ] Re-run the independent CLI pair after any generator correction found here. Completion requires genuine generation/consumption on both projects; a patched Archon helper alone does not establish portability. Record qualification and limits externally, without copying private logs into the plugin repository.

## Task 6: Register Plugins and Validate Distribution

**Files:** Modify `.claude-plugin/marketplace.json` and `README.md`; create `tests/test_verification_packaging.py`. No CI workflow additions.

**Interfaces:** Marketplace entry for `create-select-verify-target-skill` points to `./plugins/create-select-verify-target-skill`, category `development`, version `0.0.1`. Bump the existing verifier plugin from the observed `0.0.1` to `0.0.2`; rebase the increment on the actual source version if it changed before execution. Leave unrelated plugin versions intact.

- [ ] Add this structural discovery test before registering the new plugin:

```python
def test_selector_plugin_is_discoverable(self):
    catalog = json.loads((ROOT / ".claude-plugin/marketplace.json").read_text())
    matches = [p for p in catalog["plugins"]
               if p["name"] == "create-select-verify-target-skill"]
    self.assertEqual(len(matches), 1)
    skill = ROOT / matches[0]["source"] / "skills/create-select-verify-target-skill/SKILL.md"
    self.assertTrue(skill.is_file())
```

Define `ROOT` from the test file, not the caller's cwd. Add checks that the OMP install loop includes the new plugin exactly once, all listed skill paths exist, and unchanged plugins keep their versions relative to the recorded source baseline.

- [ ] Run the packaging test, observe the missing entry, add the entry/version change, and update the README plugin count and installation list. Document the two-generator call order without claiming global skills are already installed or auto-updated.
- [ ] Run all author checks in the isolated environment:

```bash
"$EVAL_ROOT/venv/bin/python" -m unittest discover -s tests -p 'test_verification_*.py' -v
"$EVAL_ROOT/venv/bin/python" scripts/check-verification-assets.py --repo .
git diff --check
```

Also validate both skill frontmatters using parsed YAML, linked resources, and the existing invocation-policy field. Do not weaken or delete metadata merely because a generic validator has a narrower allowlist.

- [ ] Review the complete plugin diff for project names, local absolute paths, fake qualification claims, duplicated catalogs and schemas, unrelated changes, and accidental evidence. Stage only the two plugins, their author checks/healthy fixture, catalog, and intentional README edits. Commit with Problem/Why/How/Context/Generalization.

## Task 7: Authorized Handoff and Publication

**Files:** No implementation files beyond corrections supported by review. PR body under `EVAL_ROOT`, never committed as a product artifact.

**Interfaces:** Requires the source-publication decision from the start of this plan and all qualification gates. This task does not authorize merge or installation.

- [ ] Review the actual final diff and qualification evidence. Report generation coverage, both projects, baseline failures, real negative controls, remaining unsupported prerequisites, and any tests not run. A partial result is not a qualified release.
- [ ] If source PR publication was authorized, follow `update-and-publish-oceanlabs-skill`. Push only the feature branch and create the PR against the actual default branch. Use `.github/PULL_REQUEST_TEMPLATE.md` and include Problem, Why, Context, Change/How, Generalization, and Validation with concrete evidence summaries. Keep private logs/paths and unrelated work out of the public body.
- [ ] Confirm the PR's actual head matches the reviewed source commit. Report its URL. Do not merge or change global installed skills. After merge, describe the normal updater path instead of running a broad global update implicitly.
- [ ] If publication was not authorized, do not begin plugin edits under this plan. Resolve the source policy with the user first; do not evade it by editing installed copies or claiming the source task finished locally.

## Self-Review Coverage Map

| Spec concern | Tasks |
| --- | --- |
| Repository discovery and agreed risk-based scope | 1, 3, 4 |
| One verifier-owned portable protocol | 2, 3, 4 |
| Existing tests, native runtimes, no parallel harness | 1, 3, 5 |
| Version compatibility, existing-verifier upgrade | 2, 4, 5 |
| Complete diff, semantic selection, gaps, uncertainty | 2, 4, 5 |
| Current product/tooling identity and fresh evidence | 2, 3, 5 |
| Correct behavioral proof and honest qualification | 1, 3, 5 |
| Cold consumption without generators/workflows | 3, 4, 5 |
| Protected user work, isolated controls, cleanup | 1, 3, 5 |
| Maintenance deferred, no automatic global edits | 3, 6, 7 |
| Distribution and discovered source-policy boundary | Authorization gate, 6, 7 |

Execution is sequential through the generator qualification gates. Fresh consumer agents may run independent bounded evaluation cases when authorized by the chosen execution mode and skill-testing instructions; never edit and drive the same verification tooling concurrently.
