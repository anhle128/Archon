# Story {{epic_num}}.{{story_num}}: {{story_title}}

Status: draft

## Story

As a {{role}},
I want {{action}},
so that {{benefit}}.

## Acceptance Criteria

1. [AC-1] [Observable behavior and boundary]

## Story Contract

### Authority and Source Precedence

| Source | Claim | Disposition | Effect on this story |
| --- | --- | --- | --- |
| [Source: path#section] | [Normative claim] | ADOPT | [Concrete requirement] |

### Risk Profile

- stateful: not-applicable — [specific reason]
- async-process: not-applicable — [specific reason]
- cli-api: not-applicable — [specific reason]
- cross-package: not-applicable — [specific reason]
- compatibility: not-applicable — [specific reason]
- security: not-applicable — [specific reason]

### Decision and Invariant Ledger

This table is the normative implementation authority for this story.

| ID | Source | Acceptance IDs | Required behavior | Owner or boundary | Task IDs | Surface IDs | Proof IDs | Disposition |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| INV-1 | [Source: path#section] | AC-1 | [Required and prohibited behavior] | [Owning module/process/store] | TASK-1 | SURF-1 | PROOF-1 | IMPLEMENT |

### Changed Surface Contract

| Surface ID | Classification | Module or contract | Current behavior | Required or preserved behavior | Consumers | Owner |
| --- | --- | --- | --- | --- | --- | --- |
| SURF-1 | CHANGE | [path or public contract] | [Current evidence] | [Required behavior] | [Callers/consumers] | [Owner] |

### Stateful and Persistence Contract

N/A — risk profile marks `stateful` not-applicable because [same concrete reason].

### Async and Process Contract

N/A — risk profile marks `async-process` not-applicable because [same concrete reason].

### CLI and API Contract

N/A — risk profile marks `cli-api` not-applicable because [same concrete reason].

### Cross-Package and Generated Contract

N/A — risk profile marks `cross-package` not-applicable because [same concrete reason].

### Compatibility Contract

N/A — risk profile marks `compatibility` not-applicable because [same concrete reason].

### Security Contract

N/A — risk profile marks `security` not-applicable because [same concrete reason].

## Tasks / Subtasks

- [ ] [TASK-1] Close INV-1 across its owned surfaces (AC: AC-1; Invariants: INV-1; Surfaces: SURF-1; Proof: PROOF-1)
  - [ ] Implement the required behavior at the owning boundary.
  - [ ] Preserve or regenerate every classified adjacent surface.
  - [ ] Add the mapped positive, negative, and boundary proof.

## Proof Plan

| Proof ID | Covers | Observable | Owning boundary | Command or test | Positive assertion | Negative or boundary assertion |
| --- | --- | --- | --- | --- | --- | --- |
| PROOF-1 | AC-1, INV-1 | [return-value/protocol-envelope/durable-state/dispatch-ack/worker-claim/terminal-outcome/consumer-contract/no-side-effect] | [Owner] | [Exact focused command/test] | [Concrete assertion] | [Concrete failing or boundary assertion] |

## Explicit Deferrals

| Deferred item | Owner | Reason | Residual risk | Follow-up trigger |
| --- | --- | --- | --- | --- |
| None | N/A | No deferral | None | N/A |

## References

- [Source: path#section]

## Dev Agent Record

### Agent Model Used

{{agent_model_name_version}}

### Debug Log References

### Completion Notes List

### File List
