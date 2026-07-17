# Epic 3 Partial Retrospective - Create-Story Depth Gate

Status: partial retrospective

Scope: completed Epic 3 stories `3-1`, `3-3a`, and `3-3b`.
Epic 3 remains in progress; remaining stories are `3-3c`, `3-3d`, `3-5`, and `3-7`.

## Core Finding

The repeated code review findings are not mainly an implementation-discipline problem.
The deeper process issue is that `create-story` output was too shallow for contract-first, machine-readable provider work.

When story context did not deeply specify parser boundaries, fail-closed paths, contract fixtures, classifier behavior, DB edge cases, stdout/stderr rules, and required negative tests, implementation followed that shallow framing.
Code review then had to discover missing story-level requirements after the code was already written.

## Evidence From Completed Stories

Story `3-1` needed repeated review passes around unresolved lifecycle policy, contract conformance, storage identity, fail-closed CLI behavior, row validation, and backend-specific behavior.

Story `3-3a` was comparatively contained because it focused on the shared envelope helper and closed type surface.
Its review findings were narrow: command/category type closure and shared metadata helper reuse.

Story `3-3b` generated a large review tail because the story touched many CLI escape points before the final provider envelope:
argument parsing, git preflight, dispatcher validation, workflow command handling, DB lookup, workflow execution results, stdout suppression, result persistence, verbose event sanitization, and error classification.

## Root Cause

`create-story` did not force enough pre-implementation analysis for this class of story.

For Epic 3, a story is not ready for development unless it explicitly names:

- Contract fixtures and intentional fixture deltas.
- Every pre-handler failure boundary that can bypass JSON envelope generation.
- Every stdout/stderr source that can corrupt machine-readable output.
- DB and persistence edge cases, including backend-specific behavior.
- Error classifier positive and negative cases.
- Raw CLI flag parsing risks, especially values after `--` and positional text.
- Required negative tests and subprocess/dispatch tests.
- Policy decisions that must be ratified before code starts.

## Decision

Do not continue the remaining Epic 3 stories using the current story depth.

Before implementation starts for `3-3c`, `3-3d`, `3-5`, or `3-7`, regenerate or revise each story with a stronger create-story gate.
Code review should validate the implementation against a deep story, not compensate for a shallow one.

## Action Items

1. Deepen create-story output for remaining Epic 3 stories.
   Owner: Amelia (Developer)
   Success criteria: each remaining story includes contract fixtures, failure paths, CLI/parser or event-delivery boundaries, DB edge cases, stdout/stderr rules where relevant, classifier cases, and required tests before development starts.

2. Add a review-risk checklist to each remaining Epic 3 story.
   Owner: Murat (Test Architect)
   Success criteria: each story includes risks learned from `3-1` and `3-3b`, with explicit evidence required before moving to review.

3. Escalate unresolved contract or policy decisions before implementation.
   Owner: Winston (System Architect)
   Success criteria: no story starts coding around missing schema fields, ambiguous fixture deltas, undefined lifecycle transitions, or unsupported runtime behavior.

4. Keep code review focused on implementation correctness.
   Owner: Amelia (Developer)
   Success criteria: future code review findings should primarily be implementation defects, not missing story requirements that should have been specified up front.

## Remaining Epic 3 Gate

The remaining stories should not move from `backlog` to implementation until their story files are revised with this gate.
This is a partial retrospective action, not final Epic 3 closure.
