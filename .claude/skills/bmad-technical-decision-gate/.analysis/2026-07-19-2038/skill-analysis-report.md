# Analysis Report: skills/bmad-technical-decision-gate

Generated: 2026-07-19T20:42:42+07:00 · Schema: 2

**Grade: Fair**

> Fair: semantic scope and review behavior are now coherent, but safety-critical gate transitions and degraded validation still depend on model-executed plumbing, while headless revalidation lacks a concrete intent input.

Leanness, architecture, and customization pass cleanly, and the skill now handles story scope, existing-story routing, and completed-gate semantics explicitly. The remaining risk is operational determinism: discovery, initialization, revalidation invalidation, and validator fallback need executable contracts so a stale PASS cannot survive and an automator can supply intent without conversation.

| Severity | Count |
| --- | --- |
| Critical | 0 |
| High | 3 |
| Medium | 2 |
| Low | 0 |

## Themes

### 1. Safety-critical state plumbing remains prompt-owned

- Root cause: The prompt owns filesystem discovery, state initialization, and the completed-gate invalidation transition even though each has one correct transformation and can expose a stale PASS if performed partially.
- Fix: Extend the native helper with inspect/init and atomic begin-revalidation operations that return compact JSON, leaving intent and conflict judgment to the prompt.
- Findings:
  - `determinism-1` State discovery and initialization remain prompt plumbing — `skills/bmad-technical-decision-gate/SKILL.md:25-35`
  - `determinism-2` Safety-critical revalidation transition is model-executed — `skills/bmad-technical-decision-gate/SKILL.md:36-37`

### 2. Headless and degraded execution paths lack executable inputs

- Root cause: The skill requires explicit headless intent without naming a parameter, and its unavailable-helper fallback asks the model to reproduce deterministic behavior after an earlier uv preflight may already have blocked the run.
- Fix: Define `--intent create|revalidate`, execute the helper through uv or compatible python3, and fail closed when neither runtime can preserve deterministic validation.
- Findings:
  - `determinism-3` Fallback asks the model to reproduce validator behavior — `skills/bmad-technical-decision-gate/SKILL.md:116-118`
  - `enhancement-1` Add an explicit headless intent input — `SKILL.md:On Activation`
  - `enhancement-2` Make validation dependency degradation reachable — `SKILL.md:On Activation; Challenge, Validate, and Hand Off`

## Strengths

- Leanness, architecture, and customization passed without findings.
- The 1,978-token runtime prompt remains within the desired budget and contains no scanner-detected prompt waste.
- Story-scope containment prevents adjacent debt from blocking the selected story.
- Existing-story review routes to `$validate-story`, while technical revalidation explicitly invalidates stale completion semantics.
- Batch sorting, count derivation, structural validation, and atomic normalization are covered by 15 passing tests.

## Recommendations

1. Add native inspect/init and atomic begin-revalidation operations to the validator helper. (resolves: determinism-1, determinism-2)
2. Define and record the machine-supplied `--intent create|revalidate` contract. (resolves: enhancement-1)
3. Use an explicit uv-to-python3 helper execution chain and block when deterministic validation cannot run. (resolves: determinism-3, enhancement-2)

## Experience

- **New guided or batch gate** — Resolve the target, establish durable state, reconcile scoped evidence, obtain decisions or whole-file approval, challenge the candidate PASS, validate, and hand off.
- **Completed-gate revalidation** — Resolve revalidation intent, atomically invalidate stale completion metadata, record changed authority and rejected reasoning, rerun the full gate, and restore PASS only after review and validation.
- **Headless invocation** — Supply a story selector, mode, and explicit intent; receive one deterministic PASS or actionable BLOCKED JSON result.
- Headless: The JSON return contract is sound, but existing-story automation is incomplete until a stable intent input and deterministic helper fallback are defined.

## Findings

### High (3)

#### determinism-2 — Safety-critical revalidation transition is model-executed

- Lens: determinism
- Location: `skills/bmad-technical-decision-gate/SKILL.md:36-37`
- Evidence: The prompt is responsible for immediately setting `gate: BLOCKED`, conditionally resetting batch `reviewStatus: PENDING`, and only later restoring `PASS` after the full gate reruns.
- Recommendation: This is a determinism leak because the state transition has one correct transformation and protects a previously completed gate from remaining falsely PASS. Apply the determinism test and signal-verb scan: let the prompt judge whether approved content is affected, then pass that boolean to a native `begin-revalidation` operation that atomically performs the required frontmatter transition and returns JSON before semantic work continues.

#### enhancement-1 — Add an explicit headless intent input

- Lens: enhancement
- Location: `SKILL.md:On Activation`
- Evidence: The headless-readiness pattern is incomplete: an existing story requires explicit create-versus-revalidate intent, but activation only defines parsing the story selector plus `--batch` or `--headless`; no machine-suppliable intent parameter or accepted values are defined. An automator therefore cannot deterministically satisfy the requirement and must receive `BLOCKED` even when it knows the intended operation.
- Recommendation: Define and parse a stable headless input such as `--intent create|revalidate`. Reject missing or invalid intent with the accepted values and route ordinary story review to `$validate-story`; record the accepted intent in the memlog.

#### enhancement-2 — Make validation dependency degradation reachable

- Lens: enhancement
- Location: `SKILL.md:On Activation; Challenge, Validate, and Hand Off`
- Evidence: The graceful-degradation pattern is internally unreachable for a common hostile environment: activation preflights `uv` and blocks before workspace creation when it is unavailable, while the later instruction says to perform validation operations directly if the validator is unavailable after workspace creation. A machine with Python but no `uv` is stopped before the documented fallback can run.
- Recommendation: Preflight a deterministic fallback chain: use `uv` first, otherwise invoke the bundled validator with a compatible `python3`, and block only when neither runtime can execute it. Remove the instruction to reproduce normalization and validation manually, because that does not preserve the helper's deterministic guarantees.

### Medium (2)

#### determinism-1 — State discovery and initialization remain prompt plumbing

- Lens: determinism
- Location: `skills/bmad-technical-decision-gate/SKILL.md:25-35`
- Evidence: The prompt must "detect whether the story artifact or a completed gate already exists", initialize missing files, then "read both once" and determine whether `session complete` is final.
- Recommendation: This leaks deterministic filesystem inspection, frontmatter parsing, final-event extraction, and skeleton initialization into the prompt. Apply the determinism test and signal-verb scan, then add an `inspect`/`init` helper that emits compact pre-pass JSON containing file existence, parsed gate fields, and the last memlog event. Keep only intent resolution and conflict interpretation in the prompt.

#### determinism-3 — Fallback asks the model to reproduce validator behavior

- Lens: determinism
- Location: `skills/bmad-technical-decision-gate/SKILL.md:116-118`
- Evidence: After prescribing the validator, the skill says: "If unavailable after workspace creation, perform the same operations directly and record the fallback." Those operations include sorting, counting, structural validation, and normalization.
- Recommendation: This explicitly moves deterministic work back into the prompt. The determinism test and signal-verb scan classify normalize, validate, sort, and count as script-owned. Fail closed with an actionable BLOCKED result when the bundled helper is missing or unusable, rather than asking the model to emulate it.
