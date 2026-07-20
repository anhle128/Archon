# Analysis Report: skills/bmad-technical-decision-gate

Generated: 2026-07-20T10:13:17+07:00 · Schema: 2

**Grade: Good**

> Good: lifecycle routing and paired-state recovery are now sound, with one remaining high-risk identity check plus smaller count-ownership and reviewer-transport refinements.

Determinism, customization, and enhancement pass cleanly, while create/revalidate routing now reaches the correct stage-specific consumer and survives partial state safely. Before installation, inspection must bind artifact identity to the selected story key; guided unresolved counts should also have one deterministic owner, and an unused reviewer JSON transport can be simplified.

| Severity | Count |
| --- | --- |
| Critical | 0 |
| High | 1 |
| Medium | 1 |
| Low | 1 |

## Themes

### 1. Artifact state is validated structurally but not fully bound to route identity

- Root cause: The helper owns state validation and counting, but inspection does not compare the artifact story to the selected story key and count derivation is implemented only for batch despite broader prompt wording.
- Fix: Bind artifact story identity during inspection and make normalization derive unresolved counts consistently for guided and batch artifacts.
- Findings:
  - `architecture-1` Resume inspection does not bind gate identity to the selected story — `skills/bmad-technical-decision-gate/scripts/validate_decision_gate.py:inspect_state`
  - `architecture-2` Guided unresolved-count ownership is internally contradictory — `skills/bmad-technical-decision-gate/SKILL.md:Produce the Gate Artifact; skills/bmad-technical-decision-gate/scripts/validate_decision_gate.py:initial_artifact and normalize_batch_artifact`

### 2. Internal review transport exceeds its consumer contract

- Root cause: The reviewer output is constrained to exact JSON although no parser consumes it, so serialization detail adds prompt surface without improving the semantic review.
- Fix: Require source-backed findings with severity and required resolution without prescribing unused JSON serialization.
- Findings:
  - `leanness-1` Reviewer response schema over-specifies transport — `skills/bmad-technical-decision-gate/SKILL.md:Challenge, Validate, and Hand Off (line 118)`

## Strengths

- Determinism, customization, and enhancement passed without findings.
- The 1,996-token prompt remains below the configured desired threshold.
- Create and existing-story revalidation now have evidence-backed, stage-correct consumers.
- Artifact and memlog are treated as one fail-closed state pair with validated completion consistency.
- Thirty-two tests cover state recovery, intent preconditions, direct-Python fallback, batch approval, and revalidation transitions.

## Recommendations

1. Reject artifact story identity mismatches during inspection and add PASS and BLOCKED pair coverage. (resolves: architecture-1)
2. Generalize helper normalization to derive guided unresolved counts as well as batch counts. (resolves: architecture-2)
3. Replace the unused reviewer JSON schema with a semantic-only return contract. (resolves: leanness-1)

## Experience

- **Fresh create gate** — Resolve identity and intent, inspect absent paired state, initialize safely, reconcile decisions, validate PASS, and hand off to create-story.
- **Existing-story revalidation** — Inspect and validate the state pair, atomically invalidate completion, reconcile changes, restore PASS, and hand off to Validate Story with an explicit headless next route.
- **Unsafe resume** — Partial state, contradictory completion, or invalid intent preserves existing files and returns actionable BLOCKED before mutation.
- Headless: Headless inputs, failures, and next-workflow routing are complete; artifact identity must still be compared with the supplied story key before this path is safe to install.

## Findings

### High (1)

#### architecture-1 — Resume inspection does not bind gate identity to the selected story

- Lens: architecture
- Location: `skills/bmad-technical-decision-gate/scripts/validate_decision_gate.py:inspect_state`
- Evidence: The artifact and memlog paths are explicitly bound under the story-keyed run folder, but inspection only requires a `story` frontmatter field and never compares it with `story_key`. A valid paired state for another story can therefore pass inspection and reach the create-story or Validate Story consumer, violating the project-context rule that route-facing story identity mismatches are errors.
- Recommendation: During inspection, require the artifact's `story` value to equal the selected `story_key`; preserve both files and return a state invariant violation before mutation or handoff when they differ. Add coverage for mismatched identity in complete PASS and BLOCKED pairs.

### Medium (1)

#### architecture-2 — Guided unresolved-count ownership is internally contradictory

- Lens: architecture
- Location: `skills/bmad-technical-decision-gate/SKILL.md:Produce the Gate Artifact; skills/bmad-technical-decision-gate/scripts/validate_decision_gate.py:initial_artifact and normalize_batch_artifact`
- Evidence: SKILL.md instructs every artifact to initialize `unresolvedDecisionCount: 0` and says the helper derives the final value, while the helper initializes guided mode at 1 and derives counts only for batch mode. A guided BLOCKED artifact following SKILL.md therefore fails validation until the agent discovers and repairs this unstated ownership mismatch, contrary to the architecture coherence requirement and the Skill Quality Principles' rule that counting belongs to deterministic code.
- Recommendation: Choose one coherent contract: preferably make the helper normalize and derive guided counts as well, then state that all modes initialize at zero and rely on it; otherwise explicitly require the prompt to maintain guided counts and limit the helper-derivation claim to batch mode.

### Low (1)

#### leanness-1 — Reviewer response schema over-specifies transport

- Lens: leanness
- Location: `skills/bmad-technical-decision-gate/SKILL.md:Challenge, Validate, and Hand Off (line 118)`
- Evidence: The skill dictates an exact one-line JSON shape for internal reviewer responses, but no runtime helper or downstream parser consumes that serialization. Under the canon's core test, the shape is format re-teaching rather than review-quality guidance.
- Recommendation: Replace the JSON template with the outcome constraint: "Return only source-backed findings, each with severity and the required resolution."
