# Reusable Verification Skill Generators

Status: design and plugin implementation approved by the user on 2026-09-10, including packaging the new selector generator as a plugin.

## Objective

Given a project, generate two project-local skills that another agent can use without Archon, a workflow engine, or the generators installed:

- `verify-<project>` proves user-facing behavior through executable scenarios and retained evidence.
- `select-verify-<project>-targets` interprets a request and change, then obtains a validated selection from the verifier.

Use two independently callable generators, in this order:

```text
create-verification-skill
  -> inspect project and agree coverage
  -> generate and exercise verify-<project>, catalog, and helper

create-select-verify-target-skill
  -> inspect project and the generated verifier contract
  -> generate and exercise select-verify-<project>-targets

request + plan + complete diff
  -> proposal.json -> normalize -> selection.json -> prove
  -> result.json + evidence
```

No third orchestration skill is needed for v1. Running the generators consecutively is the supported bootstrap procedure; neither generator implicitly invokes the other.

## Existing Evidence and Alternatives

The installed `create-verification-skill` currently creates a prose skill and Markdown feature map, then drives one feature. It does not require a machine catalog, selection normalization, or complete scenario results. Keep its project discovery, real-user interaction, isolation, and evidence-preserving cleanup; strengthen its executable contract and qualification requirements.

The revised Archon pair is the behavioral reference, not a portable implementation to copy wholesale. Its JSON selection, current-commit provenance, scenario completeness, and historical bug controls are reusable ideas. Bun, Archon packages, SQLite, provider fixtures, process management, and Playwright paths are project-specific.

The selected design is two generators with one verifier-owned contract. A combined generator would prevent independent selector creation and repair. Two generators independently inventing catalogs would create conflicting behavior IDs and scenario lists. A new universal runner package would introduce distribution and adapter maintenance before a second implementation demonstrates the need.

## Initial Coverage Policy

Discover public surfaces broadly from source, docs, routes, commands, menus, exports, and existing tests. Report the inspected boundaries and any discovery limits rather than claiming exhaustive understanding.

Before generating executable coverage, propose a scope with source evidence, user outcomes, runtime prerequisites, test reuse opportunities, and deferred behaviors. The generator makes the recommendation; the user does not need to know which tests to choose.

Include primary user journeys and relevant failures with material consequences, such as incorrect authorization, lost writes, or stuck lifecycle transitions. Cover the whole agreed journey, including its important entry points and state variants. A rendered page is not proof that its primary action works. Do not use a fixed feature count across projects.

List lower-priority or currently untestable behavior as explicit gaps. Scope approval permits verification work for the agreed journeys, not product fixes or unrestricted external actions. Renegotiate scope when missing infrastructure materially increases cost or risk.

## Ownership and Generated Layout

The verifier owns behavior definitions, scenario bindings, gap records, schemas, normalization, execution, and result aggregation. The selector owns project-specific impact interpretation guidance and calls the verifier's helper. It never maintains another test list or result parser.

```text
.agents/skills/
  verify-<project>/
    SKILL.md
    contract.json
    schemas/                 JSON schemas for the public artifacts
    features/
      README.md              navigation and scope, not a second catalog
      <feature-id>.json      behavior-to-scenario bindings
    coverage-gaps.json       discovered behaviors without executable coverage
    bin/                     documented helper entrypoint
    ...                      supporting code only where needed
  select-verify-<project>-targets/
    SKILL.md
    references/              project-specific impact notes, only if substantial
```

Scenario source should stay in the project's durable test suite when one exists. Add focused tests or support fixtures there instead of copying a competing harness into the skill. A skill-owned scenario directory is appropriate when the project has no suitable suite. The generated skill documents all owned support files, dependencies, and invocation commands.

Generated paths and commands are project-relative or resolved from the installed skill location. Do not retain the generator author's home directory, Archon paths, credentials, or workflow environment assumptions.

During bootstrap, newly generated files can make the authoring checkout dirty. Qualify against an explicitly identified clean product worktree, with the new verification tooling outside it. That proves the named baseline, not uncommitted product edits. Preserve user work and do not create product commits merely to satisfy the proof guard. A harness that cannot separate its tooling and target must report this prerequisite rather than quietly testing another checkout.

## Generator: create-verification-skill

1. **Discover.** Read project guidance, manifests, launch commands, user surfaces, existing tests, data/auth setup, observable side effects, and isolation/teardown facilities. Identify actual supported platforms and safe external boundaries. Completion: a source-grounded scope recommendation, with unresolved prerequisites distinguished from unknown behavior.
2. **Agree scope.** Present the initial coverage proposal and necessary fixture/dependency changes. Obtain confirmation before building them. If a verifier already exists, identify its format and propose a scoped upgrade instead of replacing it. Completion: named journeys, expected outcomes, included variants, and declared gaps.
3. **Build the contract.** Assign stable feature, behavior, and scenario IDs. Define proof obligations and prerequisite metadata; bind every covered behavior to real executable scenarios. Completion: schema-valid catalog with resolvable, unambiguous scenario bindings.
4. **Build the verifier.** Reuse the native runner and structured reports; add a thin helper for snapshotting, normalization, execution, provenance, and aggregation. Document launch/doctor/drive/evidence/cleanup where applicable. Completion: documented operations execute and produce validated artifacts without a workflow engine.
5. **Qualify.** Exercise every scenario in the agreed executable scope, inspect the action and outcome evidence, check negative controls, and clean up after every attempt. Completion: an honest qualification report distinguishing proven coverage, reproduced product defects, and unmet prerequisites.

Do not repair production behavior to make qualification green. Fix only demonstrated verification drift within the approved scope. A broken build or inaccessible environment is a prerequisite failure to report, not authorization to repair unrelated product code.

## Generator: create-select-verify-target-skill

1. **Locate the verifier.** Resolve the explicitly named verifier, or the unambiguous local candidate. Read its descriptor, schemas, catalog, gaps, helper help, and qualification limits. Missing or incompatible contracts stop selector generation with a precise upgrade prerequisite; do not infer compatibility from a filename.
2. **Discover impact context.** Inspect the project's actual development branch convention, module boundaries, shared components, user entry points, and relevant tests. Read source rather than deriving impact from path keywords alone. Completion: project-specific guidance for common changes and cross-cutting effects, with source references.
3. **Generate the selector.** Teach the consumer to read the full request/plan and complete diff, propose affected behavior IDs with evidence and confidence, declare gaps, and call normalization. Keep stable behavior links in the verifier, not duplicated in selector instructions.
4. **Qualify selection.** Exercise representative local, cross-cutting, uncertain, and uncovered changes. Check actual normalized artifacts and failure behavior, not just generated headings. Completion: correct required coverage, explainable expansions, and no valid handoff on gaps or stale inputs.
5. **Exercise the pair.** Pass a fresh selection to the generated verifier and inspect its executable result. Completion: no manual artifact repairs or unpublished author knowledge are needed between the two skills.

The selector does not fix product code, edit normalized scenario IDs, generate replacement tests, or declare a product PASS. If coverage needs expansion, report the gap for a separately scoped verifier update.

## Shared Protocol

The portable protocol is named `project-verification`, version `1`. This identifies the new public contract, not an assertion that every existing Archon artifact with `version: 1` already implements it.

`create-verification-skill` owns the canonical protocol reference, JSON schemas, and conformance examples. Each generated verifier receives a self-contained copy. `create-select-verify-target-skill` consumes the target verifier's copy; it does not embed a second canonical schema. Future incompatible protocol versions require an explicit upgrade, not a silent conversion.

`contract.json` declares the protocol/version, verifier skill name, helper invocation as an argv array, and project-relative schema locations. The generated selector records its supported protocol version and resolves the descriptor at use time. Runner internals and implementation language are outside this public interface. Invoke the entrypoint with structured arguments; scenario IDs resolve through the catalog/helper, not through shell commands reconstructed from agent prose.

### Helper Operations

| Operation                                                  | Responsibility                                                                      |
| ---------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `catalog --json`                                           | Return the validated catalog, known gaps, and catalog digest.                       |
| `snapshot --repo PATH --base REF`                          | Resolve the complete Git change and checkout state.                                 |
| `normalize-selection PROPOSAL --repo PATH --out SELECTION` | Validate the proposal and derive required scenarios.                                |
| `validate-selection SELECTION --repo PATH`                 | Revalidate an existing selection against the current checkout and tooling contract. |
| `prove --selection SELECTION --repo PATH`                  | Execute and aggregate every required scenario for a change-level claim.             |
| `prove --scenario ID --repo PATH`                          | Run an explicitly requested diagnostic without claiming complete change coverage.   |

Support an explicit evidence destination; otherwise use a documented ignored or external location. Stdout is machine-readable for the documented JSON operations; diagnostics go to stderr. Normalize/validate exit zero only on success. Proof exits zero only on product PASS. An infrastructure error or unreadable report is nonzero, never success inferred from missing output.

### Public Artifacts

| Artifact  | Required meaning                                                                                                                                                                          |
| --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Catalog   | Stable feature/behavior/scenario IDs; observable outcomes; impact mappings; scenario bindings, prerequisites, and proof obligations; explicit uncovered behavior.                         |
| Snapshot  | Exact base and HEAD identities, complete changed paths including deletions/renames, and dirty state.                                                                                      |
| Proposal  | Protocol-compatible version, snapshot identities/paths, affected behavior IDs with confidence and rationale, and coverage gaps.                                                           |
| Selection | Original proposal, catalog digest, normalized behavior/scenario IDs, and automatic coverage expansions.                                                                                   |
| Result    | Fresh run identity, mode, target provenance, selection/catalog/tooling digests, required and executed scenario IDs, per-scenario status/evidence, aggregate verdict, and failure reasons. |

A catalog binding means executable coverage exists; it is not a cached PASS. Known uncovered behaviors belong in `coverage-gaps.json`, not in fictional runnable scenarios. Runtime-unavailable prerequisites for an existing scenario are reported as unsupported required proof. The catalog digest includes both bindings and known gaps.

Canonical JSON/digest behavior is specified once in the protocol conformance data. Equivalent sets, such as changed paths, are canonicalized consistently; semantically ordered data stays ordered. All implementations validate against the emitted schemas and the same pass/fail conformance examples.

### Selection Rules

- The agent interprets the request, plan, source, and diff; code validates resolved IDs and invariants.
- Use an explicit base first, otherwise the project's observed development-branch merge-base. An ambiguous base is an error, not permission to guess `main` or `HEAD~1`.
- Include the complete diff. Known impact mappings conservatively add required behaviors and omitted impacted features. Medium/low confidence broadens to the relevant feature; uncertainty beyond it must name additional impact or a gap.
- Reject unknown IDs, unknown changed paths, unresolved gaps, missing scenario bindings, empty change selections, substituted bases, stale identities, and dirty commit-bound targets. A docs-only or otherwise unsupported change does not become an unrelated smoke PASS.
- Path mappings supplement semantic interpretation; they do not prove that the agent's reasoning found every impact. Selection evaluations explicitly test plausible omissions and cross-module changes.
- Explicit historical regression checks may use base equal to HEAD and select from the requested behavior. An empty diff alone never justifies that exception.

Commit-bound selection in v1 requires Git. A non-Git project may have diagnostic proof, with unavailable commit provenance declared, but cannot claim support for the complete change-selection protocol. No fabricated SHA or implicit recursive file-snapshot system is introduced.

### Proof Rules

Execute the real public interaction appropriate to the project: browser, CLI/TUI, service API, desktop/mobile harness, or a library's public API. An API call does not replace a requested UI action. Verify authoritative effects and necessary transitions in addition to visible state. Use test doubles only at genuine external boundaries, never to replace the first-party behavior being proved.

PASS requires all required scenarios to be accounted for, successful, and backed by their declared obligations. Missing, duplicated, skipped, flaky, failed, unsupported, stale, malformed, or incomplete required proof cannot pass. Screenshots and final-state observations support assertions but cannot replace the initiating action or persistence evidence when those are obligations.

Revalidate selection and provenance before and after selection-mode execution. Record the actual product HEAD for Git targets and a digest of the verification helper, scenarios, fixtures, configuration, and relevant dependency locks. A newer product HEAD, changed tooling, or changed catalog invalidates the earlier proof. Diagnostic results explicitly identify their mode; unavailable Git provenance or selection fields are null, not invented. Keep verification tooling separate from a historical target so testing an old defect does not require editing the defective checkout.

Every attempt uses a fresh evidence directory and its own result. A failed attempt cannot consume a previous successful selection/result as current evidence. Cleanup preserves reports and attachments, removes only owned resources, and leaves the user's tracked and untracked work intact. Evidence must omit or redact secrets.

## Qualification and Product Verdicts

Generator qualification and product verification are separate outcomes:

- **Qualified for the declared scope:** all agreed scenarios have been exercised, evidence/reporting/cleanup contracts hold, and a fresh consumer can operate the pair. Report reproduced product defects as FAIL even when the verifier correctly detects them.
- **Partial:** generated material exists, but named scenarios, controls, or prerequisites remain untested. Report only the actually qualified subset; do not silently shrink the agreed scope.
- **Blocked:** no safe, usable execution path can be established. Preserve useful discovery and explain what the user must resolve.

Require a healthy end-to-end control for each supported runner integration. Where a known defective revision or existing safe negative fixture is available, verify that the corresponding behavioral assertion fails and a healthy counterpart passes. Preserve the product FAIL; the experiment succeeded because it detected the defect.

When no suitable behavioral negative control exists, report that qualification limit. Schema rejection, missing browser, startup failure, or fabricated result fixtures prove guard behavior only; they do not prove product-bug detection. Do not mutate user product code to manufacture a defect. Deliberate mutants belong only in purpose-built disposable evaluation projects.

## Implementation Packaging and Compatibility

Keep each generator's `SKILL.md` focused on its ordered procedure, boundaries, and completion criteria. Put substantial protocol details, evaluation recipes, and project-specific harness adaptation guidance behind explicit reference links. Add assets or scripts only for demonstrated reuse or deterministic checks, not a directory for every possible framework.

Use a runtime already supported by the target project when reasonable. Do not impose Bun, Python, Node, Bash, Playwright, SQLite, Archon imports, or a hosted service universally. Runtime/platform prerequisites must be explicit and tested; portable JSON does not imply every harness runs on every OS.

Before implementation, resolve the editable source of the installed generator and its existing distribution process. Preserve invocation metadata and unrelated customization. Global installation/publishing is a separate action from authoring and local evaluation; no automatic publication or global replacement is part of generation in a consumer project.

Existing project verifiers are not silently migrated. Propose the required compatible changes, preserve durable tests and documented callers, and requalify after an approved upgrade. The current Archon pair and workflow remain unchanged during generator authoring/evaluation unless a separate migration is approved; use an isolated copy to evaluate adapting this reference.

`maintain-verification-skill` currently assumes a Markdown feature map, skill-directory-only edits, and its own shipping process. That is not yet the new contract's maintenance loop, particularly when scenarios live in the durable suite. Do not advertise compatibility or automatically invoke it. Updating that third skill is a separate follow-up, not a hidden part of v1.

## Evaluation Plan

1. **Contract checks:** run language-independent positive/negative schema and normalization fixtures against generated helpers. Include unknown/duplicate IDs, gaps, unmapped/omitted/reordered paths, stale SHA/catalog/tooling, dirty targets, and all incomplete scenario statuses. A top-level claimed PASS must not override failed required proof.
2. **Reference project:** evaluate the generators in an isolated Archon copy with the known Ask regression. A healthy owned Ask must submit, persist, resume, and complete; the defective unowned Ask must fail on its actual disabled control. Do not alter the previously approved skill/workflow worktree for this experiment.
3. **Independent project:** generate both skills from scratch for a small Git-backed Python CLI with file persistence, using its native test tooling. Cover write/read behavior, malformed input, and one behavioral defect in a disposable fixture. This checks that generation does not depend on Archon, Bun, a browser, or a server.
4. **Selector evaluation:** use local, shared-module, uncertain, and uncovered change requests for both projects. Compare normalized obligations, not exact prose or the smallest test count. Never give the consumer the intended selection in advance.
5. **Cold consumption:** have a fresh agent follow only the generated skills and raw request in the isolated project, without generator access or hidden setup knowledge. Inspect actual artifacts and cleanup. Delegation requires the normal execution authorization; this specification does not grant external access or permission to run production actions.

Keep transcripts, selections, proof results, scope limitations, and failure analysis outside product source. Re-run the affected evaluation after a generator fix. Do not call the portable generator qualified based on Archon alone or schema checks alone.

## Delivery Boundary

V1 delivers the updated `create-verification-skill`, the new `create-select-verify-target-skill`, their necessary references/assets/checks, and qualification evidence from the two projects. No workflow/CI changes, new runner service, product defect fixes, automatic commits of consumer work, PR creation, maintenance migration, or broad framework support matrix are included.

Implementation authorization: the installed generator comes from `oceanlabs-holding/skills`. After the source policy was disclosed, the user authorized plugin edits and explicitly requested the new skill in a plugin too. The source-repository PR required by its `AGENTS.md` is included in authoring delivery. The no-PR boundary above continues to apply to generated skills operating in consumer projects. No merge, marketplace release, or global installation is authorized.

Next gate: qualify both generators in isolation before opening the source PR.
