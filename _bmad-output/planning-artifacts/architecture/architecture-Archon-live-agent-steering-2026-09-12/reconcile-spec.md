# Reconcile — spine vs spec-live-agent-steering

14 spec constraints walked against the spine.

| Spec constraint                                          | Spine home                                                           |
| -------------------------------------------------------- | -------------------------------------------------------------------- |
| Stop pauses run not node                                 | AD-4                                                                 |
| Two blocking seams ours                                  | AD-1/AD-2 (prompt) + AD-3/AD-4 (stop)                                |
| Stop signal via DB                                       | AD-3                                                                 |
| Only mid-turn needs server process                       | AD-6                                                                 |
| Draft queue browser state                                | AD-9                                                                 |
| Operator message = text row, origin=operator             | AD-5                                                                 |
| Dock absent on finished node                             | UX-owned (control-states, spines) — not an engine invariant          |
| Stop is not undo                                         | UX-copy (spines) — not an engine invariant                           |
| Steer carries node id + retry epoch                      | AD-8                                                                 |
| **Stop and resume are two gated steps (wait for ready)** | **GAP — fold into AD-4**                                             |
| Delivery confirmed by id                                 | AD-7                                                                 |
| **Steer delivery must not emit a turn-start event**      | **GAP — new AD-11**                                                  |
| Provider defaults to unsupported                         | SUPERSEDED by the universal-queue-and-flush model; owed to bmad-spec |
| Deliver at next boundary is default                      | AD-1                                                                 |

## Two gaps to close in triage

- Two-gated-steps: after stop, wait for runtime-ready before resuming (aion's race). Fold into AD-4's Rule.
- No turn-start on a steer delivery: a stray turn-start opens a phantom boundary and corrupts the transcript record. New AD.
