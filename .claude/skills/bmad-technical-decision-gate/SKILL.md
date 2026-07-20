---
name: bmad-technical-decision-gate
description: Clears story-level technical decisions before implementation. Use when the user says "clear technical decisions", "run technical decision gate", or invokes "$bmad-technical-decision-gate".
---

# Story Technical Decision Gate

## Overview

Gate `$bmad-create-story` before creation or `$validate-story` during existing-story revalidation.

## Resolution Rules

- `{skill-root}` is this skill's installed directory.
- `{project-root}` is the project working directory.
- `{run-folder}` is `{project-root}/_bmad-output/planning-artifacts/story-decisions/{story-key}`.
- `{artifact}` is `{run-folder}/technical-decisions.md`.
- `{memlog}` is `{run-folder}/.memlog.md`.

## On Activation

Parse the selector and `--intent create|revalidate`; set `{mode-flag}` to empty, `--batch`, or `--headless`, rejecting combinations before preflight or mutation.
Resolve a filesystem-safe `{story-key}` from the selector or one authoritative planning record, never a capability title.
Ask one target question in guided or batch mode when needed; headless requires an explicit key and `--intent`.

Resolve `{story-root}` from BMAD `implementation_artifacts`, defaulting to `{project-root}/_bmad-output/implementation-artifacts`; load project context.
Set `{python-runner}` to `uv run`, otherwise `python3`; block if neither can execute the stdlib-only helper.
Preflight `{project-root}/_bmad/scripts/memlog.py` and a writable run folder before creating state.
Record a missing-config assumption after the workspace exists.
An unsafe preflight returns `BLOCKED` with the corrective action; before workspace creation, headless returns `{"status":"blocked","gate":"BLOCKED","reason":"<actionable preflight failure>","artifact":null,"memlog":null}`.

Before evidence ingestion, run `{python-runner} {skill-root}/scripts/validate_decision_gate.py {artifact} --inspect --memlog {memlog} --story-root {story-root} --story-key {story-key} --intent {intent} {mode-flag}`.
Use its JSON as authority: initialize both files only for `ABSENT`; state or intent violations preserve existing files and return `BLOCKED` with recovery guidance.
Before mutation, `revalidate` requires a gate or story artifact, while `create` rejects an existing story.
Initialize the pair through `memlog.py` and helper `--init --story {story-key}`, adding `--batch` in batch mode.
Append the accepted intent to the memlog.
When state exists, read both once for semantic context; only a validated `PASS` paired with `sessionComplete` is final unless intent is `revalidate`.
An existing story requires explicit `revalidate`; ordinary story-quality review routes to `$validate-story` and stops this gate.

For revalidation, judge whether approved content may be affected, conservatively choosing yes when uncertain, then invoke `--begin-revalidation` with `--approved-content-affected` when applicable before changing decisions.
Append the memlog event `revalidation started` immediately after the transition.
Surface conflicts with settled decisions and append each change and rejected prior reasoning to the memlog.
Rerun reconciliation, semantic review, normalization, and validation before restoring `PASS`.

In headless mode, append every inferred assumption and decision to the memlog.

## Establish the Evidence Chain

Inspect before asking questions: read the plan, approved product and architecture, canonical examples, consumers, adjacent stories, code, tests, and history.
Classify sourced claims as normative authority, validated example, runtime reality, historical context, or proposal.
Code evidences existing behavior, not intended authority; examples are normative only when explicitly canonical.
Do not resolve contradictions by source order, convenience, implementation cost, or personal preference.
Checkpoint source reconciliation in the artifact and its rationale in the memlog.

Only problems materially affecting this story's lifecycle, contracts, proof, or implementation boundary enter `Unresolved Decisions`.
Record unrelated debt or adjacent defects as typed memlog `note` events with a suggested owner and follow-up route; they neither interrupt the gate nor increment `unresolvedDecisionCount`.

## Reconcile the Lifecycle

Resolve the lifecycle across these story-relevant topics:

- Boundary success and execution semantics: accepted, running, completed, synchronous, asynchronous, detached, or resumed.
- Legal transitions and owners of validation, mutation, dispatch, execution, monitoring, recovery, and cleanup.
- Identity, idempotency, concurrency, compare-and-swap, partial failure, rollback, and compatibility.
- How callers observe continuation or completion.
- Security, migration, and cross-process ownership constraints.

Never hide a producer/consumer mismatch in an undocumented adapter, prefer current code over a canonical fixture, or invent handoff, ownership, or recovery policy.

## Resolve Remaining Decisions by Mode

Classify public contracts, lifecycle semantics, durable state mutation, migrations, security boundaries, and cross-process ownership as high risk.

- In guided mode, ask one material question at a time, cite both sides, explain the consequence, recommend an evidence-grounded answer, and checkpoint it.
- In batch mode, never decide or interrupt; record every problem and suggestion with `HIGH`, `MEDIUM`, or `LOW`, then let the helper sort and count.
- Set `mode: batch`, `reviewStatus: PENDING`, and `gate: BLOCKED`; only explicit whole-file approval promotes suggestions and sets `APPROVED`, while changes trigger another review.
- In headless mode, choose only evidence-determined or low-risk details and return `BLOCKED` instead of guessing any unresolved high-risk decision.

## Produce the Gate Artifact

Write `{artifact}` with YAML frontmatter containing `story`, `gate`, and `unresolvedDecisionCount`.
The helper derives `unresolvedDecisionCount` in every mode; never edit it manually.
For batch mode, also include `mode: batch` and `reviewStatus: PENDING | APPROVED`.
Use exactly these substantive sections:

- `## Decision Summary`
- `## Source Reconciliation`
- `## Lifecycle and Ownership`
- `## Decisions`
- `## Unresolved Decisions`
- `## Executable Proof Sketch`
- `## Downstream Handoff`

For each material decision, state its identifier, behavior, authority, rejected alternatives, affected contracts, and owners when applicable.
For each conflict, identify its artifacts and whether an upstream authority must change.
Start each guided or headless unresolved item with `- TD-<id>:` for deterministic counting.
The proof sketch must exercise the real external boundary and observable lifecycle so it distinguishes the selected semantics from plausible alternatives.

In a pending batch artifact, place every problem under `## Unresolved Decisions` using a `### [HIGH|MEDIUM|LOW] TD-<id> — <title>` heading and the labels `**Problem:**`, `**Evidence:**`, `**Impact:**`, and `**Suggested solution:**`.
Do not copy a suggested solution into `## Decisions` before the user approves the whole file.

Set `gate: PASS` only when one lifecycle satisfies all normative sources, every state-changing boundary has an owner, no material decision remains unresolved, conflicts have explicit resolutions, and the artifact has a valid executable proof sketch.
Batch `PASS` additionally requires explicit whole-file approval and `reviewStatus: APPROVED`.
Otherwise block and route product ambiguity to `bmad-prd` or `bmad-correct-course`, ownership to `bmad-architecture`, behavior to `bmad-investigate`, technology evidence to `bmad-technical-research`, and contract conflicts to canonical owners.

Do not edit canonical artifacts or code without a separate request, create the story, or claim implementation readiness.

## Challenge, Validate, and Hand Off

Normalize and validate with `{python-runner} {skill-root}/scripts/validate_decision_gate.py {artifact} --normalize --verbose`.
If the helper or selected runner becomes unusable, set `BLOCKED` with a corrective action; never reproduce its deterministic operations manually.
Fix structural failures before semantic review.

Before any candidate `PASS`, run two independent reviews in parallel when subagents are available:

- The lifecycle lens attacks transitions, ownership, concurrency, failure, recovery, and proof discrimination.
- The authority lens attacks normative-source conflicts, canonical-example drift, producer-consumer mismatches, and unsupported assumptions.

Require only source-backed findings, each with `HIGH`, `MEDIUM`, or `LOW` severity and its required resolution.
When subagents are unavailable, perform the same two reviews sequentially as explicit self-critiques.
Resolve every material finding or convert it into an unresolved decision, then normalize and validate again.
If a post-approval review adds a batch problem, reset `reviewStatus: PENDING` and return the whole file for another user review.

Append the final gate and artifact path to the memlog.
For `PASS`, hand `{artifact}` to `$bmad-create-story` before creation or hand it with the existing story to `$validate-story` in Validate Mode; the latter must not run create-story.
A `BLOCKED` artifact stops downstream story work and routes pending review or decisions to the user and named owners.
After a validated `PASS` handoff, append the memlog event `session complete`.

Headless returns only `{"status":"complete","gate":"PASS","next":"<bmad-create-story|validate-story>","artifact":"<path>","memlog":"<path>"}` or, after workspace creation, `{"status":"blocked","gate":"BLOCKED","reason":"<concise unresolved decision>","artifact":"<path>","memlog":"<path>"}`.
