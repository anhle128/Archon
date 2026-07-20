# Analysis Report: skills/bmad-technical-decision-gate

Generated: 2026-07-19T21:01:31+07:00 · Schema: 2

**Grade: Fair**

> Fair: deterministic execution now passes cleanly, but durable state must be treated as an invariant pair and the revalidation branch still needs stage-correct preconditions and handoff.

The skill is lean, deterministic, test-backed, and sound across its core guided, batch, and headless mechanics. The remaining defects are lifecycle wiring rather than technical-decision semantics: partial state must fail closed instead of being silently recreated, and create versus revalidate must select both valid starting state and the correct downstream consumer.

| Severity | Count |
| --- | --- |
| Critical | 0 |
| High | 2 |
| Medium | 2 |
| Low | 0 |

## Themes

### 1. Durable state lacks a paired invariant

- Root cause: The run folder is named but its artifact and memlog paths are implicit, and missing files are initialized independently even when the surviving peer carries prior state, allowing contradictory or fabricated resumes.
- Fix: Bind exact artifact and memlog paths, initialize only when both are absent, and fail closed with recovery guidance when one is missing or completion facts disagree.
- Findings:
  - `architecture-2` Durable artifact and memlog placeholders are not explicitly resolved — `SKILL.md:Resolution Rules; On Activation`
  - `enhancement-1` Add a paired-state recovery policy — `SKILL.md:On Activation`

### 2. Intent does not yet own the full lifecycle route

- Root cause: Create and revalidate are parsed but are not checked against inspected state or carried through to different downstream consumers, so invalid starts and an existing-story PASS can reach the wrong handoff.
- Fix: Validate intent against existing gate/story state before mutation, then hand create PASS to bmad-create-story and existing-story revalidation PASS to an explicit validation or correction route.
- Findings:
  - `architecture-1` Existing-story revalidation has no stage-correct handoff — `SKILL.md:Overview; On Activation; Challenge, Validate, and Hand Off`
  - `enhancement-2` Reject revalidation with no prior subject — `SKILL.md:On Activation`

## Strengths

- Leanness, determinism, and customization passed without findings.
- The 1,963-token runtime prompt remains below the configured desired threshold.
- The helper now owns deterministic inspection, initialization, normalization, validation, and atomic revalidation invalidation.
- Twenty-five unit and subprocess tests cover batch approval, direct-Python fallback, state inspection, and revalidation transitions.
- Story-scoped evidence and explicit whole-file batch approval preserve the user's technical authority.

## Recommendations

1. Enforce the artifact and memlog as one explicitly named state pair, including contradictory-completion recovery. (resolves: architecture-2, enhancement-1)
2. Add create/revalidate state preconditions and intent-specific PASS handoffs. (resolves: architecture-1, enhancement-2)

## Experience

- **Fresh create gate** — Confirm both state files are absent, initialize the pair, reconcile evidence, obtain decisions or approval, validate PASS, and hand the artifact to bmad-create-story.
- **Existing-story revalidation** — Require prior gate or story state, atomically invalidate completion, reconcile changed decisions, validate PASS, and route to existing-story validation or correction without rerunning create-story.
- **Partial or contradictory resume** — Preserve surviving state, return BLOCKED, and name the recovery action instead of inventing the missing half.
- Headless: Machine inputs and JSON returns are deterministic, but headless safety still depends on enforcing intent preconditions and paired-state consistency before mutation.

## Findings

### High (2)

#### architecture-1 — Existing-story revalidation has no stage-correct handoff

- Lens: architecture
- Location: `SKILL.md:Overview; On Activation; Challenge, Validate, and Hand Off`
- Evidence: The Overview defines bmad-create-story as the consumer, while On Activation permits explicit revalidation when a story artifact already exists. The final handoff still speaks only in terms of handing PASS to bmad-create-story or stopping story creation, with no revalidation-specific consumer. This breaks the prompt-quality canon's outcome-and-consumer contract: an already-created story can complete the gate without a defined route for reconciling changed decisions back into that story.
- Recommendation: Branch the outcome and handoff on the accepted intent plus storyArtifact.exists. For create, hand PASS to bmad-create-story. For revalidate on an existing story, return the PASS artifact to an explicit existing-story validation or correction route and state that bmad-create-story must not run; make BLOCKED wording stage-neutral.

#### enhancement-1 — Add a paired-state recovery policy

- Lens: enhancement
- Location: `SKILL.md:On Activation`
- Evidence: The working-state and graceful-degradation patterns are incomplete on resume: the skill creates whichever of the artifact or memlog is missing, even when its counterpart already contains durable state, and treats `sessionComplete` as final without requiring a validated `PASS` artifact. An interrupted or partially deleted workspace can therefore pair old decisions with a fresh rationale log, pair an old log with a blank artifact, or stop on contradictory completion state.
- Recommendation: Treat the artifact and memlog as one state pair: initialize only when both are absent; when exactly one is missing or completion facts contradict, preserve the surviving files and return `BLOCKED` with a recovery action. Treat `sessionComplete` as final only when the existing artifact validates as `PASS`.

### Medium (2)

#### architecture-2 — Durable artifact and memlog placeholders are not explicitly resolved

- Lens: architecture
- Location: `SKILL.md:Resolution Rules; On Activation`
- Evidence: The run folder is defined, but the first helper command consumes <artifact> and <memlog> before either placeholder is assigned a stable path. The artifact path is only implied later by Produce the Gate Artifact, and no canonical memlog filename is declared. This weakens the Skill Quality Principles' working-state-across-turns pattern because separate invocations can inspect or append to different inferred files.
- Recommendation: Define {artifact} as {run-folder}/technical-decisions.md and {memlog} as one exact file under the run folder in Resolution Rules, then use those placeholders consistently in inspect, init, append, validation, returns, and handoff.

#### enhancement-2 — Reject revalidation with no prior subject

- Lens: enhancement
- Location: `SKILL.md:On Activation`
- Evidence: The intent-before-ingestion pattern parses `create|revalidate` but does not validate the selected intent against inspected state. A headless caller can request `revalidate` when neither a story artifact nor gate state exists; the workflow then initializes blank state and records a revalidation intent even though there is nothing to revalidate.
- Recommendation: After inspection and before initialization, require `revalidate` to have an existing story artifact or existing gate artifact. Otherwise return actionable `BLOCKED` directing the caller to use `--intent create`; apply the corresponding existing-story rejection for `create` before mutating state.
