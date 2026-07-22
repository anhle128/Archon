---
title: 'BMAD create-story blocked resume'
type: 'bugfix'
created: '2026-07-22'
status: 'done'
baseline_commit: '7c8ebdc42c62dedeeb25022f375a3bd9c6bd5771'
context:
  - '{project-root}/brain/StoryProofGuardrails.md'
  - '{project-root}/_bmad-output/implementation-artifacts/epic-3-partial-retro-2026-07-16.md'
  - '{project-root}/_bmad-output/implementation-artifacts/story-3-3d-partial-retro-2026-07-20.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The BMAD create-story workflows allow `create-story` to return `status: blocked`, but the next state-recording node treats that as a hard failure.
That leaves the run failed with no human action to resolve the blocker and resume.

**Approach:** Make blocked story creation an interactive loop state instead of an exception path.
After the user resolves the blocker and approves/resumes, rerun story creation or repair first, then record state and continue to story readiness validation.

## Boundaries & Constraints

**Always:** Preserve the public node id `create-story` and the downstream `$create-story.output.story_file`, `story_name`, `story_key`, `sprint_status`, and `status` contract.
Keep genuine body-node execution errors fail-fast.
Keep the existing story file existence, state file update, story hash, and no-content-diff repair guards.
Keep `validate-story-readiness` independent and fresh-context.
When `BLOCKED` appears in readiness output, the next create-story pass must pause for human source-of-truth resolution instead of failing at the recorder.

**Ask First:** Halt if implementation requires a new workflow YAML language feature, public retry-node support for loop-group body nodes, schema/database migrations, or changing BMAD skill semantics.

**Never:** Do not skip validation after a blocker.
Do not treat approval feedback as an authoritative decision replacing canonical docs or technical decisions.
Do not remove `blocked` from the create-story output schema.
Do not hand-edit generated bundled defaults.

## I/O & Edge-Case Matrix

| Scenario                       | Input / State                                                      | Expected Output / Behavior                                                                                                                 | Error Handling                                                                                  |
| ------------------------------ | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------- |
| Initial blocked story creation | `author-story` returns `status: blocked`                           | Workflow pauses as an interactive loop with an actionable gate message and blocker artifact; run is not failed                             | User rejects to stop, or approves after fixing canonical sources                                |
| Resume after blocker           | Paused run resumes with user feedback                              | The create-story body reruns before any state recording or validation; successful output becomes `$create-story.output`                    | If it blocks again, pause again until loop budget is exhausted                                  |
| Successful story creation      | `author-story` returns `draft` or `repaired` and story file exists | Recorder updates state/hash and emits the story JSON plus completion signal; downstream validation reads `$create-story.output.story_file` | Missing story file or no-diff repair remains a fail-fast error                                  |
| Readiness BLOCKED              | Readiness report persists `gate: BLOCKED`                          | Existing readiness route sends the run back to `create-story`, which pauses for human resolution instead of failing                        | Repeated unresolved blockers consume loop attempts and then fail with the existing budget error |
| Loop-group body mutation       | Workflow mutates checkout and body node is checkpointable          | Pre-node checkpoint is persisted with a namespaced body step id such as `create-story.author-story`                                        | Top-level retry behavior remains unchanged unless explicitly supported later                    |

</frozen-after-approval>

## Code Map

- `.archon/workflows/defaults/bmad-create-and-dev-story-with-tea.yml` -- primary failing BMAD create/dev/TEA workflow.
- `.archon/workflows/defaults/bmad-create-and-dev-story.yml` -- sibling create/dev workflow with the same blocked hard-fail pattern.
- `.archon/workflows/defaults/bmad-create-story-with-tea.yml` -- sibling create/story/TEA workflow with the same blocked hard-fail pattern.
- `packages/workflows/src/dag-executor.ts` -- loop-group execution, interactive pause/resume, and pre-node checkpoint creation.
- `packages/workflows/src/dag-executor.test.ts` -- executor regression coverage for loop-group resume and checkpoint behavior.
- `packages/workflows/src/defaults/bundled-defaults.generated.ts` -- generated bundled workflow artifact regenerated from YAML sources only.

## Tasks & Acceptance

**Execution:**

- [x] `.archon/workflows/defaults/bmad-create-and-dev-story-with-tea.yml` -- replace the standalone `create-story` plus blocked-failing recorder path with a `loop_group` named `create-story` containing `author-story`, success recorder, and blocked reporter branches.
- [x] `.archon/workflows/defaults/bmad-create-and-dev-story.yml` -- apply the same loop shape while preserving its existing state directory and downstream `dev-story` path.
- [x] `.archon/workflows/defaults/bmad-create-story-with-tea.yml` -- apply the same loop shape while preserving its `record-story-readiness-state` behavior and TEA downstream refs.
- [x] `packages/workflows/src/dag-executor.ts` -- pass the parent `mutatesCheckout` value into loop-group body execution and persist body checkpoints using the namespaced step id to avoid collisions.
- [x] `packages/workflows/src/dag-executor.test.ts` -- add focused tests for blocked loop-group pause/resume and namespaced checkpoint creation for mutating loop-group body nodes.
- [x] Generated bundled defaults -- run the canonical generator after YAML edits and commit the generated diff.

**Acceptance Criteria:**

- Given a BMAD create-story workflow where story authoring returns `blocked`, when the recorder branch would previously run, then the run pauses with `type: interactive_loop` and does not fail.
- Given a paused blocked create-story loop, when the user approves with feedback, then the next iteration reruns authoring before state recording or readiness validation.
- Given authoring returns `draft` or `repaired`, when the story file exists, then state recording emits a JSON object compatible with existing `$create-story.output.*` downstream references.
- Given the workflow mutates checkout, when a loop-group body node runs, then a pre-node checkpoint is persisted under a namespaced body step id and top-level checkpoint behavior remains intact.

## Spec Change Log

## Design Notes

Use `loop_group` because `blocked` is not an execution error and the engine already has interactive loop approval/resume semantics.
The terminal successful body node must print the story JSON first and the completion signal separately so the group output remains parseable as the existing `create-story` object after signal stripping.
The blocked branch must not throw; it should report the blocker and omit the completion signal, allowing the group gate to pause.
Body checkpoint ids should use the same prefix concept as workflow event `step_name`, for example `create-story.author-story`, because raw body ids can collide across groups or nested groups.

## Verification

**Commands:**

- `bun test packages/workflows/src/dag-executor.test.ts` -- expected: focused executor regressions pass in the isolated workflows package context.
- `bun run generate:bundled` -- expected: generated bundled defaults update only from changed workflow YAML sources.
- `bun run check:bundled` -- expected: no generated-default drift remains.
- `bun run validate` -- expected: full pre-PR gate passes.

## Suggested Review Order

**Workflow blocked-state control**

- `create-story` stays the public entry point while becoming the interactive loop.
  [`bmad-create-and-dev-story.yml:119`](../../.archon/workflows/defaults/bmad-create-and-dev-story.yml#L119)

- `signal_completes` lets successful first story creation continue without a gate pause.
  [`bmad-create-and-dev-story.yml:128`](../../.archon/workflows/defaults/bmad-create-and-dev-story.yml#L128)

- BLOCKED plus user feedback reruns repair against canonical sources.
  [`bmad-create-and-dev-story.yml:142`](../../.archon/workflows/defaults/bmad-create-and-dev-story.yml#L142)

- Blocked reporting omits the completion signal and avoids failing the recorder.
  [`bmad-create-and-dev-story.yml:221`](../../.archon/workflows/defaults/bmad-create-and-dev-story.yml#L221)

**Executor loop semantics**

- Loop-group output strips standalone completion signals before downstream JSON refs.
  [`dag-executor.ts:144`](../../packages/workflows/src/dag-executor.ts#L144)

- Body execution now inherits checkout-mutation checkpoint behavior.
  [`dag-executor.ts:3330`](../../packages/workflows/src/dag-executor.ts#L3330)

- Checkpoint rows use namespaced loop body ids.
  [`dag-executor.ts:5331`](../../packages/workflows/src/dag-executor.ts#L5331)

**Coverage and bundled defaults**

- Regression covers blocked pause, feedback resume, and downstream validation.
  [`dag-executor.test.ts:14388`](../../packages/workflows/src/dag-executor.test.ts#L14388)

- Regression covers successful first-iteration completion without a pause.
  [`dag-executor.test.ts:14548`](../../packages/workflows/src/dag-executor.test.ts#L14548)

- Regression covers namespaced checkpoints for mutating loop-group body nodes.
  [`dag-executor.test.ts:8279`](../../packages/workflows/src/dag-executor.test.ts#L8279)

- Bundled defaults canary preserves the BMAD loop contract.
  [`bundled-defaults.test.ts:160`](../../packages/workflows/src/defaults/bundled-defaults.test.ts#L160)
