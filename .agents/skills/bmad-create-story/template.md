# Story {{epic_num}}.{{story_num}}: {{story_title}}

Status: draft

<!-- A story may become ready-for-dev only after solution-readiness and proof-readiness validation pass. -->

## Story

As a {{role}},
I want {{action}},
so that {{benefit}}.

## Acceptance Criteria

1. [Add acceptance criteria from epics/PRD]

## Tasks / Subtasks

- [ ] Slice 1: [behavior or invariant slice] (AC: #)
  - [ ] Implement the complete behavior across all owned surfaces.
  - [ ] Add positive and failing-path proof for the owned invariant.
- [ ] Slice 2: [behavior or invariant slice] (AC: #)
  - [ ] Preserve existing behavior on adjacent surfaces.
  - [ ] Wire the required proof into the mandated command.

## Dev Notes

### Feature and System Context

- Outcome:
- Architectural role:
- Upstream authorities:
- Downstream consumers:
- User-visible or system-visible behavior:

### Canonical Artifact Reconciliation

| Source | Relevant claim | Current code or prior-story decision | Resolution |
| --- | --- | --- | --- |
| [Source: path#section] |  |  |  |

### Solution Surface Map

| Surface | Owner or authority | Current state | Required change | Consumers | Proof |
| --- | --- | --- | --- | --- | --- |
|  |  |  |  |  |  |

### Invariant and Ownership Map

| Invariant | Source of truth | Enforcement owner | Created or transformed at | Persisted or transmitted at | Consumed by | Proof |
| --- | --- | --- | --- | --- | --- | --- |
|  |  |  |  |  |  |  |

### Lifecycle and State Analysis

| State or phase | Entry condition | Valid transition | Exit condition | Failure or interruption behavior | Recovery or cleanup behavior |
| --- | --- | --- | --- | --- | --- |
|  |  |  |  |  |  |

### Failure, Concurrency, Security, and Compatibility Analysis

- Typed failures:
- Concurrency and race conditions:
- Transaction, atomicity, and partial-write boundaries:
- Security and trust boundaries:
- Compatibility and migration boundaries:
- Diagnostics and evidence preservation:

### Solution Design and Decision Record

- Selected approach:
- Why this approach preserves simplicity, robustness, scalability, and long-term maintainability:
- Rejected alternative:
- Rejection reason:

### Implementation Slices

| Slice | Owned behavior or invariant | Files or modules | Positive proof | Failing-path proof | Integration impact |
| --- | --- | --- | --- | --- | --- |
|  |  |  |  |  |  |

### Executable Proof Design

| Acceptance Criterion | Proof command or test | Positive assertion | Failing-path assertion | Required state or side effect | Prohibited side effect | Evidence |
| --- | --- | --- | --- | --- | --- | --- |
| AC #1 |  |  |  |  |  |  |

### Explicit Boundary and Deferral Record

| Excluded behavior or deferred concern | Owner or future story | Reason | Current invariant remains complete because |
| --- | --- | --- | --- |
| None | N/A - no exclusion | N/A - no deferral |  |

### Project Structure Notes

- Alignment with unified project structure (paths, modules, naming)
- Detected conflicts or variances (with rationale)

### References

- Cite all technical details with source paths and sections, e.g. [Source: docs/<file>.md#Section]

## Failure Analysis & Proof Readiness

### Failure Mode Risk Scan

- F1 Contract invariants not enforced: N/A - reason.
- F2 Split source of truth: N/A - reason.
- F3 Fail-open ingress validation: N/A - reason.
- F4 Incomplete drift/coverage gates: N/A - reason.
- F5 Mandated commands not running real gates: N/A - reason.
- F6 Bypassable dependency-direction checks: N/A - reason.
- F7 Cleanup without preserved-behavior regression tests: N/A - reason.
- F8 Review findings recorded without ownership triage: N/A - reason.

### AC Proof Matrix

| Acceptance Criterion | Proof Command/Test | Failing-Path Evidence | Ownership Boundary | Deferral Decision |
| --- | --- | --- | --- | --- |
| AC #1 |  |  |  |  |

## Dev Agent Record

### Agent Model Used

{{agent_model_name_version}}

### Debug Log References

### Completion Notes List

### File List
