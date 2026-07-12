# Investigation: Readiness Evaluator False Positive

## Hand-off Brief

1. **What happened.** The supplied workflow-run screenshot shows `bmad-readiness-correct-course-loop` completed after `route-loop` selected `positive`, while the user reports that a later manual `bmad-check-implementation-readiness` still found work.
2. **Where the case stands.** The run evidence confirms the evaluator accurately reflected the automated readiness node's `READY` and zero-issue result, and the user has withdrawn the later manual run as an invalid comparison.
3. **What's needed next.** No engineering action is required unless a future valid reproduction shows the automated readiness result contradicting its own report.

## Case Info

| Field            | Value                                                                                                                                      |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Ticket           | N/A                                                                                                                                        |
| Date opened      | 2026-07-11                                                                                                                                 |
| Status           | Concluded                                                                                                                                  |
| System           | Archon v0.5.0 Web UI at `localhost:5173`; run ID `a6010eee2661099a3f443d9e9b859087`; macOS screenshot captured 2026-07-11 16:27 local time |
| Evidence sources | User screenshot, user description, workflow source, generated bundled workflow reference, pending run records and readiness reports        |

## Problem Statement

The user reports that `bmad-readiness-correct-course-loop` completed successfully because `readiness-evaluator` returned `positive`, but a subsequent manual `bmad-check-implementation-readiness` still identifies problems requiring work.
The initial claim is that `readiness-evaluator` produced a false positive and prematurely terminated a safety-critical correction loop.

## Evidence Inventory

| Source                                  | Status    | Notes                                                                                                                                        |
| --------------------------------------- | --------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Supplied screenshot                     | Available | Shows the named run as `completed`, the `route-loop` annotation `positive → end`, and the run ID in the URL.                                 |
| Workflow definition                     | Available | `.archon/workflows/defaults/bmad-readiness-correct-course-loop.yml:65` defines `readiness-evaluator`; line 119 routes `positive` to `end`.   |
| Persisted workflow run and node outputs | Available | SQLite contains all nine evaluator and route attempts, including the final readiness output, evaluator JSON, and route decision.             |
| Workflow-time readiness report          | Available | The final readiness node and evaluator both read the same external-worktree report, which declared `READY` with zero issues at 06:18 UTC.    |
| Manual readiness report                 | Available | The same report path was regenerated at 16:23 local time and now has frontmatter `NEEDS WORK` with one medium issue.                         |
| Planning artifact state                 | Available | The external worktree has no modified PRD, UX, architecture, or epics input; only the readiness report is modified under planning artifacts. |
| Version control                         | Partial   | Workflow checkpoint history and current worktree state are available; an exact byte-level snapshot comparison remains open.                  |
| Static validation                       | Available | `bun run cli validate workflows bmad-readiness-correct-course-loop --json` reports the workflow valid with zero warnings or errors.          |
| Test sources                            | Available | Loader, structured-output, route-loop, persistence, API, and UI tests exist; no tests were executed during Outcome 2.                        |
| Test results                            | Missing   | No focused or full test run has been performed in this investigation.                                                                        |
| Issue tracker                           | Missing   | No ticket was supplied or discovered for this incident.                                                                                      |

## Investigation Backlog

| #   | Path to Explore                                                                                                | Priority | Status      | Notes                                                                                                     |
| --- | -------------------------------------------------------------------------------------------------------------- | -------- | ----------- | --------------------------------------------------------------------------------------------------------- |
| 1   | Recover run `a6010eee2661099a3f443d9e9b859087` and every readiness/evaluator node output.                      | High     | Done        | Nine evaluator attempts were recovered directly from SQLite.                                              |
| 2   | Identify and compare the readiness report inspected by the evaluator with the later manual report.             | High     | In Progress | Both executions used the same path; finding-level comparison remains.                                     |
| 3   | Reproduce `bmad-check-implementation-readiness` against the same artifact state.                               | High     | Open        | The user's manual rerun is now evidenced, but the investigation has not independently executed the skill. |
| 4   | Trace report discovery, output interpolation, structured output validation, and route-loop condition handling. | High     | Open        | Source perimeter is mapped and ready for causal tracing.                                                  |
| 5   | Review version-control changes between workflow completion and manual review.                                  | Medium   | In Progress | Current status shows no changed planning inputs, but exact snapshot comparison remains.                   |
| 6   | Explain why the same planning inputs produced a zero-issue conclusion and then `UX-ALIGN-1`.                   | High     | Open        | This is the primary causal thread for Outcome 3.                                                          |

## Timeline of Events

| Time                                     | Event                                                                                      | Source                                     | Confidence |
| ---------------------------------------- | ------------------------------------------------------------------------------------------ | ------------------------------------------ | ---------- |
| Before 2026-07-11 16:27 local            | Workflow run reached `route-loop`, selected `positive`, and completed via `end`.           | Supplied screenshot                        | Confirmed  |
| After workflow completion                | User manually ran `bmad-check-implementation-readiness` and reports remaining problems.    | User description                           | Deduced    |
| 2026-07-11 03:40:03 UTC                  | Persisted workflow events begin for the run.                                               | `~/.archon/archon.db`                      | Confirmed  |
| 2026-07-11 04:04:51 through 06:04:21 UTC | Evaluator attempts 1 through 8 returned `negative` and routed through Correct Course.      | `~/.archon/archon.db`                      | Confirmed  |
| 2026-07-11 06:18:10 UTC                  | Final readiness node declared `READY` with zero issues and cited the external report path. | `~/.archon/archon.db`                      | Confirmed  |
| 2026-07-11 06:18:52 UTC                  | Final evaluator returned `positive`, and route attempt 9 selected `end`.                   | `~/.archon/archon.db`                      | Confirmed  |
| 2026-07-11 16:23:43 +0700                | The same report path was regenerated with frontmatter `NEEDS WORK` and one medium issue.   | External worktree report mtime and content | Confirmed  |

## Confirmed Findings

### Finding 1: A positive evaluator result is terminal

**Evidence:** `.archon/workflows/defaults/bmad-readiness-correct-course-loop.yml:119`

**Detail:** The route-loop condition tests whether `readiness-evaluator.output.result` equals `positive`, and the positive route targets `end`.

### Finding 2: The observed run took the positive terminal route

**Evidence:** `/var/folders/84/5njq4pvs747b3zzntvtgtpl80000gn/T/TemporaryItems/NSIRD_screencaptureui_wDgvRz/Screenshot 2026-07-11 at 16.27.15.png`

**Detail:** The screenshot visibly labels the route decision `positive → end` and the overall run `completed`.

### Finding 3: The final evaluator accurately reflected the final readiness node's declared result

**Evidence:** `~/.archon/archon.db`, workflow events at 2026-07-11 06:18:10 and 06:18:52 UTC.

**Detail:** The readiness node declared `READY` with zero critical, high, medium, or low issues, and the evaluator then returned `positive`, `READY`, and zero issues.

### Finding 4: The workflow performed eight correction rounds before returning positive

**Evidence:** `~/.archon/archon.db`, route-loop events for attempts 1 through 9.

**Detail:** Attempts 1 through 8 selected `negative`; attempt 9 selected `positive`, with `negative_count` equal to 8.

### Finding 5: The manual rerun changed the verdict at the same report path

**Evidence:** `/Users/dale/.archon/workspaces/oceanlabs-holding/x10.oh.gigo-agent/worktrees/archon/thread-bae3547b/_bmad-output/planning-artifacts/implementation-readiness-report-2026-07-11.md:12`

**Detail:** The current frontmatter says `NEEDS WORK`, and the final revalidation verdict identifies `UX-ALIGN-1`, a two-versus-three visible session-column contradiction, as one medium issue.

### Finding 6: Current version-control state shows no modified planning input documents

**Evidence:** Read-only `git status --short` in the external workflow worktree on 2026-07-11.

**Detail:** Under planning artifacts, only `implementation-readiness-report-2026-07-11.md` is modified; the PRD, UX, architecture, and epics inputs are not modified.

## Deduced Conclusions

### Deduction 1: The loop trusted the evaluator decision without an independent deterministic readiness gate

**Based on:** Finding 1 and Finding 2.

**Reasoning:** The evaluator's `positive` value directly selects the terminal node, and the observed run followed that edge.

**Conclusion:** Any evaluator false positive can prematurely report the workflow as clean unless another guard exists outside the visible route contract.

## Hypothesized Paths

### Hypothesis 1: `readiness-evaluator` returned a false positive despite unresolved readiness findings

**Status:** Refuted

**Theory:** The evaluator interpreted incomplete or ambiguous readiness output as clean, selected the wrong report, or failed to count non-blocking wording as corrective work.

**Supporting indicators:** The observed route was positive, while the user reports a later manual readiness review found remaining work.

**Would confirm:** The workflow-time readiness report contains actionable findings while the persisted evaluator output is `positive`.

**Would refute:** The workflow-time report is clean and the later manual findings result from artifact changes, different inputs, or a different review contract.

**Resolution:** Persisted events show the evaluator matched the immediately preceding readiness node's `READY` and zero-issue result, and the user subsequently identified the manual run as incorrect and withdrew it as a comparator.

### Hypothesis 2: The evaluator inspected a stale or different readiness report

**Status:** Refuted

**Theory:** Report discovery selected the newest filename or an explicitly mentioned path that did not correspond to the current readiness node output.

**Supporting indicators:** The evaluator prompt allows fallback discovery of the newest matching report when no explicit path is present.

**Would confirm:** The selected report path differs from the report generated by the immediately preceding readiness node.

**Would refute:** The persisted evaluator evidence proves it inspected the exact report emitted by that node.

**Resolution:** Persisted tool events show the final readiness node and evaluator both read the same report path before the positive decision.

### Hypothesis 3: Planning artifacts changed after the workflow completed

**Status:** Refuted

**Theory:** The manual review assessed a later artifact state containing new or reintroduced issues.

**Supporting indicators:** The two checks occurred at different times.

**Would confirm:** Version-control or filesystem evidence shows relevant planning-artifact changes between the workflow report and manual report.

**Would refute:** Both reports assess byte-identical planning artifacts.

**Resolution:** The external worktree shows no modified PRD, UX, architecture, or epics inputs, and the user identified the manual run itself as incorrect.

## Missing Evidence

| Gap                                | Impact                                                                                                                               | How to Obtain                                                                                          |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------ |
| Exact workflow-time report bytes   | Determines whether the later manual run discovered an issue that was absent from the report text or overwritten during regeneration. | Read the report from checkpoint commit `95a400f` and compare it with the current worktree report.      |
| Independent readiness reproduction | Distinguishes an isolated model inconsistency from a deterministic instruction or artifact problem.                                  | Activate and execute `bmad-check-implementation-readiness` in sequence against the preserved worktree. |
| Manual invocation transcript       | Shows the exact prompt, model, and execution context used for the user's manual rerun.                                               | Obtain the conversation/run record if persisted, or ask the user for the invocation surface.           |
| Focused test results               | Establishes whether engine routing and structured-output behavior match existing contracts.                                          | Run the relevant package tests after causal tracing identifies the necessary scope.                    |

## Source Code Trace

| Element       | Detail                                                                                                               |
| ------------- | -------------------------------------------------------------------------------------------------------------------- |
| Error origin  | Unconfirmed; initial routing contract at `.archon/workflows/defaults/bmad-readiness-correct-course-loop.yml:65`      |
| Trigger       | Completion of `bmad-check-implementation-readiness` invokes `readiness-evaluator`.                                   |
| Condition     | `readiness-evaluator.output.result == 'positive'` selects `end`.                                                     |
| Related files | Workflow YAML, workflow executor/route-loop implementation, run store, readiness reports, BMAD readiness skill files |

## Conclusion

**Confidence:** Medium

No `readiness-evaluator` defect is established.
The evaluator's positive decision matched the automated readiness node's structured result, and the user withdrew the later manual readiness result as invalid.
Confidence is Medium because the invalidity of the manual run is user-confirmed rather than independently reconstructed.

## Recommended Next Steps

### Fix direction

No fix is recommended.
Reopen only if a valid manual or automated reproduction demonstrates that the evaluator contradicts the report it actually inspected.

### Diagnostic

None while the invalid manual run is excluded.

## Reproduction Plan

No reproduction is required for the closed case.
For a future recurrence, preserve the workflow-time report bytes and the complete manual invocation transcript before regenerating the report.

## Side Findings

- The current workflow contract delegates a safety-critical terminal decision to an AI prompt returning schema-constrained JSON, which makes evidence provenance and fail-closed behavior especially important.

## Follow-up: 2026-07-11

### New Evidence

The user stated that the manual `bmad-check-implementation-readiness` execution was incorrect and instructed the investigation to ignore it.

### Additional Findings

With the manual result withdrawn, no valid contradictory readiness result remains.

### Updated Hypotheses

Hypotheses 1 through 3 are refuted for this incident.

### Backlog Changes

All remaining causal tracing, reproduction, and test tasks are closed as unnecessary for this incident.

### Updated Conclusion

Status is Concluded.
No evaluator bug is established, and no code change is recommended.
