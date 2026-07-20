# Analysis Report: skills/bmad-technical-decision-gate

Generated: 2026-07-19T20:24:51+07:00 · Schema: 2

**Grade: Good**

> Good: the core gate now passes four lenses cleanly, with one remaining high-risk gap in safely reopening completed decisions and two scope-routing refinements.

Activation, deterministic normalization, headless behavior, working-state durability, and independent semantic review now form a coherent gate, and the leanness, architecture, determinism, and customization lenses found no defects. The remaining work is concentrated in revisit semantics: a completed PASS needs an explicit invalidation transition, and discovery must separate story-blocking decisions from unrelated debt and from ordinary validation of an already-created story.

| Severity | Count |
| --- | --- |
| Critical | 0 |
| High | 1 |
| Medium | 2 |
| Low | 0 |

## Themes

### 1. Existing-story intent and completed-gate updates share no transition contract

- Root cause: The skill can reopen completed work but does not first establish whether the user is updating pre-creation decisions, revalidating an existing story, or requesting ordinary story-quality review, so stale PASS and APPROVED metadata can survive a material change.
- Fix: Resolve create, update, or revalidation intent before ingestion; an update immediately invalidates PASS and affected batch approval, records the contradiction, and reruns the full gate, while ordinary story review routes to story validation.
- Findings:
  - `enhancement-1` Add a safe update transition for completed gates — `skills/bmad-technical-decision-gate/SKILL.md:On Activation and Challenge, Validate, and Hand Off`
  - `enhancement-3` Add intent-stage routing for an existing story — `skills/bmad-technical-decision-gate/SKILL.md:Overview and On Activation`

### 2. Broad evidence discovery needs a story-boundary filter

- Root cause: The skill intentionally scans adjacent code and plans but currently sends every discovered problem into the gate, allowing unrelated architectural debt to inflate the batch artifact and block the selected story.
- Fix: Only gate problems that materially affect the selected story's lifecycle, contracts, proof, or implementation boundary; record unrelated findings as memlog notes with an owner or follow-up route.
- Findings:
  - `enhancement-2` Add capture-don't-interrupt scope containment — `skills/bmad-technical-decision-gate/SKILL.md:Establish the Evidence Chain and Resolve Remaining Decisions by Mode`

## Strengths

- Leanness, architecture, determinism, and customization all passed without findings.
- Headless startup is non-interactive and returns an actionable blocked preflight result.
- The artifact and memlog now preserve both evolving state and decision rationale across turns.
- Batch ordering and count derivation are deterministic, atomic, and covered by CLI tests.
- Two independent semantic reviews challenge every candidate PASS with a sequential fallback.

## Recommendations

1. Add an explicit intent and invalidation transition for completed gates and existing stories. (resolves: enhancement-1, enhancement-3)
2. Keep unrelated debt out of Unresolved Decisions and capture it without interrupting the gate. (resolves: enhancement-2)

## Experience

- **New pre-creation gate** — Resolve the planned story, establish durable state, reconcile scoped evidence, decide through guided or batch review, challenge PASS, validate, and hand off to create-story.
- **Completed-gate update** — Confirm update intent, invalidate stale PASS and affected approval, record the changed authority or decision, rerun reconciliation and reviews, then restore PASS only after validation.
- **Existing-story invocation** — Distinguish technical-decision revalidation from ordinary story-quality review, then either reopen the gate explicitly or route to the story validation workflow.
- Headless: Operationally ready for new targets, but existing-story and completed-gate invocations still need an explicit intent parameter or actionable BLOCKED route.

## Findings

### High (1)

#### enhancement-1 — Add a safe update transition for completed gates

- Lens: enhancement
- Location: `skills/bmad-technical-decision-gate/SKILL.md:On Activation and Challenge, Validate, and Hand Off`
- Evidence: The Working state across turns pattern is present through the artifact and memlog, and the skill recognizes an explicit update after `session complete`, but it does not define how an update invalidates a prior `PASS` or `APPROVED` state. A changed authority, lifecycle decision, or proof could therefore be processed while stale final metadata remains visible.
- Recommendation: Define an explicit update transition: read both state files, surface contradictions with prior decisions, append the change and rejected reasoning to the memlog, immediately reset `gate` to `BLOCKED`, reset batch `reviewStatus` to `PENDING` when approved content is affected, and rerun reconciliation, semantic review, normalization, and validation before restoring `PASS`.

### Medium (2)

#### enhancement-2 — Add capture-don't-interrupt scope containment

- Lens: enhancement
- Location: `skills/bmad-technical-decision-gate/SKILL.md:Establish the Evidence Chain and Resolve Remaining Decisions by Mode`
- Evidence: The Capture-don't-interrupt pattern is missing. The skill scans adjacent stories, implementation, tests, and history, while batch mode says to write every discovered problem; it never distinguishes a story-blocking technical decision from unrelated architectural debt or adjacent defects. A broad scan can therefore inflate the batch file and block the story on issues outside its lifecycle.
- Recommendation: State that only problems materially affecting the selected story's lifecycle, contracts, proof, or implementation boundary enter `Unresolved Decisions`; capture unrelated findings as typed memlog notes with a suggested owner or follow-up workflow, without interrupting the gate or incrementing `unresolvedDecisionCount`.

#### enhancement-3 — Add intent-stage routing for an existing story

- Lens: enhancement
- Location: `skills/bmad-technical-decision-gate/SKILL.md:Overview and On Activation`
- Evidence: The Intent-before-ingestion pattern is incomplete for wrong-intent users. The overview positions the gate before `bmad-create-story`, the description says before implementation, and activation resolves a story key without checking whether a story artifact already exists or what stage the user intends to gate. An accidental invocation against an already-created story can proceed under an ambiguous downstream contract.
- Recommendation: Before evidence ingestion, detect whether the target already has a story artifact. In guided or batch mode, clarify whether the user wants a pre-creation gate or an explicit update/revalidation; in headless mode require that intent as input or return actionable `BLOCKED`. Route ordinary story-quality review to the story validation workflow instead of silently treating it as pre-creation work.
