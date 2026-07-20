# Analysis Report: skills/bmad-technical-decision-gate

Generated: 2026-07-19T19:37:51+07:00 · Schema: 2

**Grade: Fair**

> Fair: the evidence-first core is strong, but target identity, working-state durability, and semantic challenge are not yet strong enough to guarantee a trustworthy PASS.

The skill clearly separates current runtime behavior from normative authority, preserves high-risk decisions for the user, and validates its artifact contract deterministically. Its main weakness is that the gate is not yet closed end to end: target identity can remain ambiguous, evolving analysis can live only in conversation, and PASS receives no independent semantic challenge before story creation.

| Severity | Count |
| --- | --- |
| Critical | 0 |
| High | 3 |
| Medium | 3 |
| Low | 1 |

## Themes

### 1. The gate contract is not closed end to end

- Root cause: The workflow accepts an unresolved target identity and produces two gate states, but it does not define deterministic target resolution or distinct downstream behavior for PASS and BLOCKED across guided and headless modes.
- Fix: Require a concrete authoritative story key before creating run state, return BLOCKED rather than prompt when headless target discovery is ambiguous, and allow bmad-create-story handoff only for PASS.
- Findings:
  - `architecture-1` Planned-capability activation can leave story-key unresolved — `skills/bmad-technical-decision-gate/SKILL.md:Activation`
  - `architecture-2` Handoff does not condition story creation on PASS — `skills/bmad-technical-decision-gate/SKILL.md:Validate and Hand Off`
  - `enhancement-3` Complete the headless no-question path — `skills/bmad-technical-decision-gate/SKILL.md:Activation`

### 2. Working analysis is not durable throughout the conversation

- Root cause: The memlog records why decisions changed, but the structured reconciliation, ownership map, and unresolved-decision set are written only at the end and can be lost during compaction or resume.
- Fix: Create the technical-decisions artifact skeleton at initialization, update it throughout the run, and resume from it alongside the append-only memlog.
- Findings:
  - `enhancement-1` Add structured working state throughout the run — `skills/bmad-technical-decision-gate/SKILL.md:Activation through Produce the Gate Artifact`

### 3. PASS relies on the same reasoning pass that authored it

- Root cause: The validator proves structural consistency but cannot challenge the semantic conclusion that conflicts are resolved, lifecycle ownership is complete, and the proof sketch is discriminating.
- Fix: Before PASS, run independent contract-conflict and lifecycle-recovery review lenses, then resolve each finding or convert it into an unresolved decision.
- Findings:
  - `enhancement-2` Add semantic challenge lenses before PASS — `skills/bmad-technical-decision-gate/SKILL.md:Validate and Hand Off`

## Strengths

- The skill treats code as runtime evidence rather than automatic normative authority.
- Validated canonical fixtures and conflicting upstream artifacts receive explicit reconciliation instead of silent reinterpretation.
- Guided, yolo, and headless modes preserve user control over high-risk decisions.
- The stdlib validator has tests and correctly prevents structurally inconsistent PASS and BLOCKED artifacts.
- The fixed v1 contract matches the user's explicit decision not to add customization.

## Recommendations

1. Close target resolution and downstream gate semantics across guided and headless modes. (resolves: architecture-1, architecture-2, enhancement-3)
2. Persist the evolving analysis in technical-decisions.md from initialization through resume. (resolves: enhancement-1)
3. Add two focused semantic challenge lenses before PASS. (resolves: enhancement-2)
4. Make per-decision metadata conditional on relevance instead of requiring placeholder fields. (resolves: leanness-1)
5. Adopt the canonical Overview and On Activation headings. (resolves: architecture-3)

## Experience

- **Guided technical decision gate** — Resolve one authoritative story key, inspect and classify evidence, reconcile the lifecycle, ask one material question at a time, challenge the draft, validate the artifact, then hand off only on PASS.
- **Headless automation** — Receive an explicit story key, resolve evidence-backed decisions, write durable state, and return either a PASS JSON handoff or a BLOCKED JSON result without prompting.
- Headless: Partially ready: the result contract is machine-readable, but ambiguous target discovery must return BLOCKED instead of reaching an interaction point.

## Findings

### High (3)

#### architecture-1 — Planned-capability activation can leave story-key unresolved

- Lens: architecture
- Location: `skills/bmad-technical-decision-gate/SKILL.md:Activation`
- Evidence: Activation accepts either a story key or a planned capability, but every durable path immediately depends on `{story-key}` and no instruction derives a stable, filesystem-safe story key from a capability. This can leave the run folder, memlog, and artifact path unresolved on an explicitly supported invocation path.
- Recommendation: Require a concrete story key before resolving the run folder. When the input is only a capability, derive a stable filesystem-safe key from authoritative planning metadata, or ask the user when no unique authoritative key exists.

#### enhancement-1 — Add structured working state throughout the run

- Lens: enhancement
- Location: `skills/bmad-technical-decision-gate/SKILL.md:Activation through Produce the Gate Artifact`
- Evidence: The working-state pattern is only partially realized: Activation resumes from `.memlog.md`, while `technical-decisions.md` is introduced only after interrogation and is not explicitly read on resume. The memlog records discoveries and rationale, but the evolving source reconciliation, lifecycle, ownership map, and unresolved-decision set can still live only in conversation until artifact production.
- Recommendation: Use the documented Both strategy deliberately: create the `technical-decisions.md` skeleton when the run folder is initialized, update its evidence, lifecycle, and unresolved-decision sections as the run progresses, and read that artifact once alongside the memlog on resume. This preserves the work-in-progress in the artifact and reserves the memlog for why decisions changed.

#### enhancement-2 — Add semantic challenge lenses before PASS

- Lens: enhancement
- Location: `skills/bmad-technical-decision-gate/SKILL.md:Validate and Hand Off`
- Evidence: The significant downstream artifact receives only deterministic structural validation before PASS. The Parallel review lenses pattern is absent, so the same reasoning process that reconciled the sources also decides that no contradiction, missing lifecycle owner, or weak proof remains.
- Recommendation: Before a PASS result, run two focused review lenses: one searches for unresolved normative or producer-consumer contract conflicts, and one attacks lifecycle ownership, failure recovery, and the executable proof sketch. Require findings to be resolved or converted into unresolved decisions, and fall back to sequential self-review when subagents are unavailable.

### Medium (3)

#### leanness-1 — Every decision must carry fields that may be irrelevant

- Lens: leanness
- Location: `skills/bmad-technical-decision-gate/SKILL.md:Produce the Gate Artifact`
- Evidence: The instruction requires every decision, including evidence-determined low-risk details, to include an identifier, chosen behavior, rationale, rejected alternatives, authoritative evidence, affected contracts, and owner. Under the canon's core test and truncate-before-delete rule, rejected alternatives, affected contracts, and ownership do not change the quality of decisions for which no real alternative, contract impact, or distinct owner exists; they instead encourage placeholder prose and inflate the downstream artifact.
- Recommendation: Require each material decision to state its chosen behavior and authoritative rationale or evidence. Require rejected alternatives only where a genuine conflict or choice existed, and affected contracts and owners only when applicable.

#### architecture-2 — Handoff does not condition story creation on PASS

- Lens: architecture
- Location: `skills/bmad-technical-decision-gate/SKILL.md:Validate and Hand Off`
- Evidence: The skill promises a gate and forbids claiming implementation readiness, yet the final instruction always tells `bmad-create-story` to consume the artifact as canonical input without stating that a `BLOCKED` artifact must stop story creation. Earlier sections produce two gate states, but the consumer contract does not define distinct behavior for them.
- Recommendation: Make the handoff conditional: a `PASS` artifact may be consumed by `bmad-create-story`, while a `BLOCKED` artifact must stop story creation and route its unresolved decisions to the named owners.

#### enhancement-3 — Complete the headless no-question path

- Lens: enhancement
- Location: `skills/bmad-technical-decision-gate/SKILL.md:Activation`
- Evidence: The Three-mode architecture is useful, but Activation says to ask for the target when discovery is ambiguous before defining any headless exception. An automator invoking `--headless` without a uniquely discoverable target can therefore reach an interaction point instead of receiving a usable blocked return.
- Recommendation: Make an explicit story target mandatory for `--headless`, or return BLOCKED without prompting when target discovery is ambiguous. Define the corresponding reason and artifact or memlog handling so every headless interaction point has a deterministic caller-visible outcome.

### Low (1)

#### architecture-3 — Simple-workflow lifecycle headings miss canonical names

- Lens: architecture
- Location: `skills/bmad-technical-decision-gate/SKILL.md`
- Evidence: The workflow-integrity pre-pass classifies the skill as a simple workflow but flags the absence of exact `## Overview` and `## On Activation` sections. The overview content is currently unheaded and the activation section is named `## Activation`.
- Recommendation: Place the opening outcome and consumer contract under `## Overview` and rename `## Activation` to `## On Activation` so the inline workflow matches the expected simple-workflow structure.
