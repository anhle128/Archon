# Analysis Report: skills/bmad-technical-decision-gate

Generated: 2026-07-19T20:08:55+07:00 · Schema: 2

**Grade: Fair**

> Fair: the batch-review contract is coherent and testable, but activation preflight, durable working state, and independent semantic review remain unsafe for a trustworthy PASS.

The revised skill now gives batch review a clear user-approval boundary, keeps runtime evidence separate from normative authority, and deterministically validates the artifact contract. Its remaining risks are concentrated rather than diffuse: target and prerequisite resolution can still break headless execution, multi-turn state is only partially durable, and the same reasoning pass still authors and certifies PASS.

| Severity | Count |
| --- | --- |
| Critical | 0 |
| High | 4 |
| Medium | 4 |
| Low | 2 |

## Themes

### 1. Activation has no closed preflight contract

- Root cause: The workflow begins creating durable state before it has guaranteed a canonical story key, non-interactive headless behavior, required runtime helpers, and a writable workspace.
- Fix: Define one preflight that resolves an authoritative filesystem-safe story key and runtime prerequisites before the run folder, never prompts in headless mode, and returns an actionable BLOCKED result when safe audited continuation is impossible.
- Findings:
  - `architecture-1` Planned-capability activation can still leave story-key unresolved — `skills/bmad-technical-decision-gate/SKILL.md:On Activation`
  - `architecture-2` Headless activation can enter an interactive question path — `skills/bmad-technical-decision-gate/SKILL.md:On Activation and Resolve Remaining Decisions by Mode`
  - `enhancement-2` Make headless activation strictly non-interactive — `SKILL.md:On Activation and Validate and Hand Off`
  - `enhancement-4` Add graceful degradation for runtime prerequisites — `SKILL.md:On Activation`

### 2. Working state exists but does not span the full lifecycle

- Root cause: The memlog is initialized before the structured artifact, evolving reconciliation can remain conversation-bound, and completed runs are not distinguished from resumable work.
- Fix: Initialize and checkpoint the artifact with the memlog, record headless assumptions, mark only validated PASS runs complete, and make resume distinguish open work from an explicit update to completed decisions.
- Findings:
  - `architecture-3` Working-state recovery is only partially durable — `skills/bmad-technical-decision-gate/SKILL.md:On Activation through Produce the Gate Artifact`
  - `enhancement-3` Complete the working-state lifecycle — `SKILL.md:On Activation, Establish the Evidence Chain, and Validate and Hand Off`

### 3. PASS lacks independent semantic challenge

- Root cause: The same facilitator reconciles the evidence and certifies that its own lifecycle, ownership map, contradictions, and proof sketch are complete, while the validator can check only structure.
- Fix: Before PASS, run independent lifecycle-ownership and source-authority reviews, then resolve every material finding or convert it into an unresolved decision, with sequential self-review as the fallback.
- Findings:
  - `enhancement-1` Add parallel semantic review before PASS — `SKILL.md:Validate and Hand Off`

### 4. The intelligence boundary needs one normalization pass

- Root cause: The prompt still sorts and counts batch entries even though those operations are deterministic, while the script uses word count to make a semantic quality warning about the proof sketch.
- Fix: Move stable batch ordering and unresolved-count derivation into the Python helper, and remove the proof-length heuristic so the prompt retains semantic judgment while the script owns plumbing.
- Findings:
  - `determinism-1` Prompt performs deterministic batch normalization — `skills/bmad-technical-decision-gate/SKILL.md:Resolve Remaining Decisions by Mode and Produce the Gate Artifact`
  - `determinism-2` Word count is used as a proof-quality heuristic — `skills/bmad-technical-decision-gate/scripts/validate_decision_gate.py:proof-body warning`

## Strengths

- Batch mode records every problem and suggested solution for one explicit whole-file user review.
- PENDING review cannot produce PASS, and only an APPROVED batch artifact may proceed.
- The skill treats current code as runtime evidence rather than automatic normative authority.
- The artifact validator is stdlib-only, tested, and owns structural gate consistency.
- The fixed v1 surface still matches the user's explicit decision to decline customization.

## Recommendations

1. Close activation with canonical target, headless, dependency, and writable-workspace preflight behavior. (resolves: architecture-1, architecture-2, enhancement-2, enhancement-4)
2. Make the artifact and memlog durable from initialization through completion and update. (resolves: architecture-3, enhancement-3)
3. Move batch sorting and counting into the helper and remove the proof-length heuristic. (resolves: determinism-1, determinism-2)
4. Add two independent semantic challenge lenses before PASS. (resolves: enhancement-1)
5. Consolidate the repeated proof-sketch requirement into one complete contract. (resolves: leanness-1)

## Experience

- **Guided technical decision gate** — Resolve one authoritative story key, establish durable state, reconcile evidence and lifecycle ownership, answer one material question at a time, challenge the result, validate it, and hand off only on PASS.
- **Batch whole-file review** — Resolve one authoritative story key, write every problem and suggested solution in descending risk order, return a PENDING BLOCKED artifact for whole-file review, then promote approved suggestions and re-evaluate PASS.
- **Headless automation** — Preflight an explicit target and runtime prerequisites without prompting, record assumptions, produce a validated artifact when possible, and otherwise return a stable actionable BLOCKED result.
- Headless: Partially ready: result JSON exists, but startup can still prompt or fail before a stable run folder and audit path are available.

## Findings

### High (4)

#### architecture-1 — Planned-capability activation can still leave story-key unresolved

- Lens: architecture
- Location: `skills/bmad-technical-decision-gate/SKILL.md:On Activation`
- Evidence: Activation accepts either a story key or a planned capability, while the run folder, artifact, memlog topic, and downstream handoff all require `{story-key}`. Inferring a plausible target does not produce a stable filesystem-safe key, so an explicitly supported invocation can reach unresolved paths. This violates the architecture lens's requirement that earlier sections produce every value later sections consume.
- Recommendation: Require a concrete story key before resolving the run folder. Derive it only from unique authoritative planning metadata; otherwise ask in guided or batch mode, and require it explicitly for headless mode.

#### architecture-2 — Headless activation can enter an interactive question path

- Lens: architecture
- Location: `skills/bmad-technical-decision-gate/SKILL.md:On Activation and Resolve Remaining Decisions by Mode`
- Evidence: The shared activation path says to ask for the target when discovery is ambiguous, with no headless exception. A `--headless` caller can therefore be prompted before reaching the promised JSON-only return, and without a story key the required artifact and memlog paths cannot be resolved. This breaks the Skill Quality Principles' headless-mode audit contract and the architecture lens's three-mode soundness rule.
- Recommendation: Make an explicit canonical story key a headless precondition and never prompt in that mode. If it is absent or ambiguous, use a deterministic preflight BLOCKED return and record the failure in a defined memlog location, or revise the headless return contract to cover pre-artifact failures explicitly.

#### enhancement-1 — Add parallel semantic review before PASS

- Lens: enhancement
- Location: `SKILL.md:Validate and Hand Off`
- Evidence: The Parallel review lenses pattern is absent: the same facilitator that reconciles sources and proposes decisions also certifies PASS, while the validator checks only structural and gate consistency.
- Recommendation: Before PASS, run two independent reviews of the completed artifact: one skeptical lifecycle and ownership review and one source-authority and contradiction review. Require resolution of every material finding, and use a sequential self-review with the same two lenses as Graceful degradation when subagents are unavailable.

#### enhancement-2 — Make headless activation strictly non-interactive

- Lens: enhancement
- Location: `SKILL.md:On Activation and Validate and Hand Off`
- Evidence: Headless readiness is only partial because activation unconditionally asks for the target when discovery is ambiguous, so an automator can hang before the later headless rules apply.
- Recommendation: Require an explicit story selector for --headless unless exactly one target is deterministically discoverable. On missing or ambiguous input, ask no question and return a stable blocked preflight JSON result; define nullable artifact and memlog fields for failures that occur before a run folder can be resolved.

### Medium (4)

#### determinism-1 — Prompt performs deterministic batch normalization

- Lens: determinism
- Location: `skills/bmad-technical-decision-gate/SKILL.md:Resolve Remaining Decisions by Mode and Produce the Gate Artifact`
- Evidence: The prompt says to write problems "ordered by risk as `HIGH`, `MEDIUM`, then `LOW`" and to set `unresolvedDecisionCount`, while the script only rejects an incorrect order or count after generation.
- Recommendation: This leaks deterministic sorting and counting into the prompt. Apply the determinism test and signal-verb scan: extend the native Python helper with a normalization or rendering operation that stably groups entries by HIGH, MEDIUM, LOW, preserves within-risk order, derives `unresolvedDecisionCount`, and emits the normalized artifact before validation.

#### architecture-3 — Working-state recovery is only partially durable

- Lens: architecture
- Location: `skills/bmad-technical-decision-gate/SKILL.md:On Activation through Produce the Gate Artifact`
- Evidence: A new run initializes only `.memlog.md`, while `technical-decisions.md` is created later. The resume rule then says to resume both files when either exists, so the normal guided pause can leave only the memlog available. Material source reconciliation, lifecycle structure, ownership mapping, and unresolved-decision ordering are not explicitly persisted as they evolve. The Skill Quality Principles identify this as the multi-turn producing-skill failure where state can remain conversation-bound.
- Recommendation: Initialize the artifact skeleton with the memlog, update its evidence, lifecycle, ownership, and unresolved-decision sections at durable checkpoints, and restore or initialize each missing state file independently on resume.

#### enhancement-3 — Complete the working-state lifecycle

- Lens: enhancement
- Location: `SKILL.md:On Activation, Establish the Evidence Chain, and Validate and Hand Off`
- Evidence: The Working state across turns pattern is partially present through the artifact and memlog, but PASS never calls set-complete, activation resumes every existing log without distinguishing completed work, and headless inferences are not explicitly captured as typed assumption entries.
- Recommendation: Append typed assumption and decision entries for every headless inference, call memlog.py set-complete only after a validated PASS handoff, and make activation distinguish an open run from a completed run so completed decisions are presented as final unless the user explicitly requests an update.

#### enhancement-4 — Add graceful degradation for runtime prerequisites

- Lens: enhancement
- Location: `SKILL.md:On Activation`
- Evidence: Graceful degradation exists for the artifact validator but not for missing BMAD config, the project memlog helper, uv, or an unwritable run folder, so the workflow can terminate without a usable artifact or actionable blocked result.
- Recommendation: Add an activation preflight for required config, helper, runner, and output access. Fail with a concise actionable BLOCKED result when audit-preserving continuation is unsafe, and document any safe fallback explicitly instead of failing at the first shell command.

### Low (2)

#### leanness-1 — Proof-sketch criterion is repeated three times

- Lens: leanness
- Location: `SKILL.md:50,86,92`
- Evidence: The requirement that the executable proof distinguish the chosen semantics from alternatives appears in the lifecycle checklist, the artifact-content rules, and the PASS gate criteria; line 86 adds the only distinct constraint, namely exercising the real external boundary and observable lifecycle.
- Recommendation: State the complete requirement once near the artifact definition: "The proof sketch must exercise the real external boundary and observable lifecycle so it distinguishes the selected semantics from plausible alternatives." Keep the PASS criterion as a short reference to a valid proof sketch, and remove the lifecycle-list repetition.

#### determinism-2 — Word count is used as a proof-quality heuristic

- Lens: determinism
- Location: `skills/bmad-technical-decision-gate/scripts/validate_decision_gate.py:proof-body warning`
- Evidence: The validator emits "Executable Proof Sketch is unusually short" solely when `len(proof_body.split()) < 8`.
- Recommendation: This is an intelligence leak because proof executability and adequacy depend on meaning, not word count. Keep deterministic structure validation in the script, but remove this heuristic or report only the neutral metric; leave proof-quality judgment to the prompt under the determinism test.
