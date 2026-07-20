# Analysis Report: skills/bmad-technical-decision-gate

Generated: 2026-07-20T10:27:59+07:00 · Schema: 2

**Grade: Good**

> The v6 fixes hold, but the skill must reject the undefined `--batch --headless` hybrid before it is ready to install.

Story identity, deterministic count ownership, durable state pairing, and the supported guided, batch, and headless journeys are now coherent and well tested. The remaining gap is one unsupported combined invocation whose two mode contracts prescribe incompatible artifact formats and decision behavior.

| Severity | Count |
| --- | --- |
| Critical | 0 |
| High | 1 |
| Medium | 1 |
| Low | 0 |

## Themes

### 1. Ambiguous hybrid mode

- Root cause: Activation does not reject simultaneous batch and headless flags, so two individually sound mode contracts become contradictory for one accepted input shape.
- Fix: Reject `--batch --headless` before preflight or durable-state mutation and return an actionable blocked result.
- Findings:
  - `architecture-1` Batch and headless modes are not explicitly mutually exclusive — `SKILL.md:On Activation and Resolve Remaining Decisions by Mode`
  - `enhancement-1` Add explicit mutual exclusion for batch and headless modes — `SKILL.md:On Activation, Resolve Remaining Decisions by Mode, Produce the Gate Artifact`

## Strengths

- Artifact frontmatter story identity is compared exactly with the selected story before handoff or mutation.
- The helper derives and validates unresolvedDecisionCount for guided, headless, and batch artifacts.
- State-pair, completion, revalidation, approval, and stage-correct handoff invariants are explicit and covered by 38 tests.
- The skill stays lean at 1999 tokens and its runtime path, integrity, and script scans pass.

## Recommendations

1. Make `--batch` and `--headless` mutually exclusive during activation and add regression coverage proving rejection happens without creating or changing state. (resolves: architecture-1, enhancement-1)

## Experience

- **Guided review** — Resolve one sourced material decision at a time, normalize the artifact, review it independently, and hand off only after a validated PASS.
- **Batch review** — Collect and risk-sort every problem and suggested solution, block for whole-file approval, then promote only the approved file.
- **Existing-story revalidation** — Inspect the paired state and exact story identity, invalidate completion atomically, reconcile affected decisions, and route PASS to Validate Story.
- Headless: Headless execution is deterministic for its documented inputs, but it needs an early rejection for simultaneous batch mode.

## Findings

### High (1)

#### enhancement-1 — Add explicit mutual exclusion for batch and headless modes

- Lens: enhancement
- Location: `SKILL.md:On Activation, Resolve Remaining Decisions by Mode, Produce the Gate Artifact`
- Evidence: The three-mode architecture describes guided, batch, and headless behavior but does not reject `--batch --headless`. In that journey, batch requires every problem to remain undecided and use structured `### [RISK]` entries, while headless permits low-risk decisions and requires unresolved items to use `- TD-<id>:` bullets. The batch validator rejects the headless representation, so an automator can enter an internally conflicting flow.
- Recommendation: Declare guided, batch, and headless as mutually exclusive modes during activation and return an actionable `BLOCKED` response for `--batch --headless`; this removes only an undefined hybrid and preserves every supported journey.

### Medium (1)

#### architecture-1 — Batch and headless modes are not explicitly mutually exclusive

- Lens: architecture
- Location: `SKILL.md:On Activation and Resolve Remaining Decisions by Mode`
- Evidence: Activation parses an optional `--batch` or `--headless` mode but never rejects both flags together. If both are supplied, batch mode says to never decide and wait for whole-file user approval, while headless mode says to choose evidence-determined or low-risk details and return without interactive review. The artifact initialization path can also receive `--batch` while the interaction contract remains headless, so the skill has no single authoritative behavior for this accepted input shape.
- Recommendation: Declare `--batch` and `--headless` mutually exclusive and reject their combination before preflight or state mutation.
