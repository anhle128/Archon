# Investigation: Workflow Effort Used Stale Pre-Sync Definition

## Hand-off Brief

1. **What happened.** Workflow run `2cd4ee8d8d46653a52c1bfac199fdc33` displayed and actually used `high` for two Codex nodes configured as `xhigh`; its Qoder node configured as `max` also ran with `high`.
2. **Root cause.** The deterministic workflow command selected revision `2e169716` before isolation synchronized the canonical source to `b8ce8bd5`. The executor retained that stale parsed workflow object after the repository and worktree files were updated.
3. **Required correction.** Synchronize Git-backed isolated launch roots before workflow discovery and selection. Preserve explicit live/folder behavior and continue with local definitions when synchronization fails.

## Case Info

| Field        | Value                                                                                                                                       |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Date opened  | 2026-07-19                                                                                                                                  |
| Status       | Root cause confirmed; remediation in progress                                                                                               |
| Run          | `2cd4ee8d8d46653a52c1bfac199fdc33`                                                                                                          |
| Workflow     | `bmad-create-and-dev-story-with-tea`                                                                                                        |
| Working path | `/Users/agent/.archon/workspaces/anhle128/Archon/worktrees/archon/thread-5eee59a5`                                                          |
| Evidence     | Screenshot, SQLite run/events, Git reflog and historical YAML, process list, Codex rollout files, live Qoder argv, executor/provider source |

## Problem Statement

The current workflow definition specifies `effort: xhigh` for `validate-story-readiness` and `design-risk-based-tests`, plus `effort: max` for Qoder `dev-story`.
The run UI and persisted events reported `high` for all three nodes.
The investigation must determine whether Archon normalized the values, the provider downgraded them, or the run executed a stale definition.

## Timeline

| Local time (+07)  | Event                                                                                                  | Confidence |
| ----------------- | ------------------------------------------------------------------------------------------------------ | ---------- |
| 00:53:19          | Commit `0eae73be` migrated the workflow to Codex `xhigh` and Qoder `max`.                              | Confirmed  |
| 00:57:39          | Merge commit `b8ce8bd5` landed on `dev`.                                                               | Confirmed  |
| 00:58:56          | Archon server started.                                                                                 | Confirmed  |
| 00:59:29          | Workflow discovery selected the project definition while its canonical source was still at `2e169716`. | Confirmed  |
| 00:59:31–00:59:32 | Canonical source reflog records resets from `2e169716` to `b8ce8bd5`.                                  | Confirmed  |
| 00:59:32          | The workflow run and isolated worktree were created.                                                   | Confirmed  |
| 01:12:11          | `validate-story-readiness` emitted `effort: high`.                                                     | Confirmed  |
| 01:14:46          | `design-risk-based-tests` emitted `effort: high`.                                                      | Confirmed  |
| 01:32:58          | Qoder was launched with `--reasoning-effort high`.                                                     | Confirmed  |

## Confirmed Findings

### Finding 1: The UI was not responsible

SQLite `node_started` events persist `effort: high`, and the UI renders that runtime metadata without normalization.
Both Codex rollout files independently record `turn_context.effort` as `high`.
The live Qoder process argv contained `--reasoning-effort high`.

### Finding 2: Current effort passthrough preserves raw values

The DAG executor copies the resolved workflow/node effort to `nodeConfig.effort`.
The Codex provider gives that value precedence and passes it to `ThreadOptions.modelReasoningEffort` unchanged.
The Qoder provider likewise supplies the raw value to `--reasoning-effort`.
No current `xhigh`/`max` to `high` conversion exists at these boundaries.

### Finding 3: Historical revision `2e169716` exactly matches the run

At `2e169716`, the workflow had root `modelReasoningEffort: high`, no Codex node overrides, and Qoder `effort: high`.
Those are the exact values observed in the run.
At `b8ce8bd5`, the same nodes resolve to Codex `xhigh` and Qoder `max`.

### Finding 4: Execution retained the pre-sync workflow object

Workflow discovery parses YAML into a `WorkflowDefinition` before isolation creation.
Isolation then synchronizes the canonical repository and creates the worktree from the updated remote base.
Execution receives the earlier in-memory object and does not rediscover YAML from the synchronized checkout.

## Hypotheses

| Hypothesis                                                         | Status    | Resolution                                                                                                      |
| ------------------------------------------------------------------ | --------- | --------------------------------------------------------------------------------------------------------------- |
| UI mislabeled `xhigh` as `high`                                    | Refuted   | Persisted events and provider-side evidence both contain `high`.                                                |
| Codex SDK downgraded `xhigh`                                       | Refuted   | Archon emitted `nodeConfig.effort: high` before provider dispatch; the SDK passes the supplied value through.   |
| Tier, alias, assistant config, or user preferences supplied `high` | Refuted   | The run has no user preference layer, uses literal models, and event provenance identifies `nodeConfig.effort`. |
| A stale pre-sync workflow definition was selected                  | Confirmed | Source reflog timing and the exact values at `2e169716` match every affected node.                              |

## Causal Trace

1. The deterministic launcher discovers and selects the workflow from the canonical source.
2. The source is still at `2e169716`, so the parsed object contains Codex/Qoder `high`.
3. Isolation synchronization advances the source and creates the worktree at `b8ce8bd5`.
4. The executor uses the already-selected object rather than reloading the updated YAML.
5. Providers receive `high` unchanged, events persist `high`, and the UI displays `high`.

## Conclusion

**Confidence: High.**

The provider-specific effort implementation is functioning correctly.
The mismatch was caused by launch ordering: workflow discovery occurred before repository synchronization, leaving the run with a stale in-memory definition even though the worktree file showed the new configuration afterward.

## Remediation and Verification

- Synchronize Git-backed isolated server/web and CLI launch roots before workflow discovery.
- Skip Git synchronization for folder projects and explicit live CLI runs.
- Treat synchronization failures as warnings and continue with the available local definition.
- Add ordering regression tests that prove synchronization precedes discovery and that raw provider effort values remain present in the selected definition.
- Run focused core/CLI suites followed by `bun run validate`.
