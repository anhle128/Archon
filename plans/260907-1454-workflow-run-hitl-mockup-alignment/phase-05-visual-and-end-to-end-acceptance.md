---
title: 'Phase 5: Visual and End-to-End Acceptance'
status: done
---

# Phase 5: Visual and End-to-End Acceptance

## Outcome

Priority: P1.
Estimate: 16-24h.
Dependency: Phases 1-4 implemented and their focused checks passed.
Prove that both real run views match the canonical mockup and retain all production behavior.
A green unit suite or a screenshot of the app alone cannot close this phase.

## File Inventory

Create paths are proposed.
Tests created in Phase 1 are modified here.

| Action             | Full path                                                                                                                                              | Change                                                                    | Rough LOC |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------- | --------- |
| Modify             | `/Users/dale/Desktop/workspace/OceanLabs/workflow-engine/archon/e2e/ui/workflow-run-hitl.spec.ts`                                                      | Full authenticated Ask/history/composer/gate journey on both surfaces     | 200-350   |
| Create             | `/Users/dale/Desktop/workspace/OceanLabs/workflow-engine/archon/e2e/ui/workflow-run-hitl-visual.spec.ts`                                               | Stable state/view/viewport captures and approved comparisons              | 120-220   |
| Modify             | `/Users/dale/Desktop/workspace/OceanLabs/workflow-engine/archon/e2e/fixtures/workflows/e2e-hitl-run.yaml`                                              | Complete deterministic node/route/loop scenarios                          | 30-70     |
| Modify             | `/Users/dale/Desktop/workspace/OceanLabs/workflow-engine/archon/e2e/lib/playwright/archon-runtime.ts`                                                  | Reuse Phase 1 start/observe/cleanup; add web-backed run setup             | 50-100    |
| Modify             | `/Users/dale/Desktop/workspace/OceanLabs/workflow-engine/archon/e2e/lib/playwright/run-detail.ts`                                                      | Shared journey selectors with accessible targets                          | 20-50     |
| Modify             | `/Users/dale/Desktop/workspace/OceanLabs/workflow-engine/archon/e2e/playwright.config.ts`                                                              | Stable visual project settings and explicit screenshot policy             | 15-35     |
| Modify             | `/Users/dale/Desktop/workspace/OceanLabs/workflow-engine/archon/e2e/package.json`                                                                      | Add a narrow HITL command only if useful to CI                            | 0-10      |
| Generate and track | `/Users/dale/Desktop/workspace/OceanLabs/workflow-engine/archon/e2e/package-lock.json`                                                                 | Produce package-manager lock compatible with manifest                     | Generated |
| Modify             | `/Users/dale/Desktop/workspace/OceanLabs/workflow-engine/archon/.github/workflows/test.yml`                                                            | Dedicated standalone HITL Playwright job with evidence upload             | 40-80     |
| Modify             | `/Users/dale/Desktop/workspace/OceanLabs/workflow-engine/archon/_bmad-output/specs/spec-workflow-run-view-hitl/SPEC.md`                                | Make UX document and canonical mockup required companions                 | 10-25     |
| Modify             | `/Users/dale/Desktop/workspace/OceanLabs/workflow-engine/archon/_bmad-output/specs/spec-workflow-run-view-hitl/ux-design.md`                           | Resolve superseded sizing/graph/interaction text and production fallbacks | 20-50     |
| Create             | `/Users/dale/Desktop/workspace/OceanLabs/workflow-engine/archon/plans/260907-1454-workflow-run-hitl-mockup-alignment/reports/visual-acceptance.md`     | State-by-state reference comparison and final deviations                  | 100-160   |
| Create             | `/Users/dale/Desktop/workspace/OceanLabs/workflow-engine/archon/plans/260907-1454-workflow-run-hitl-mockup-alignment/reports/end-to-end-acceptance.md` | Runtime, auth, provider, CI and rollback evidence                         | 80-120    |

Reference screenshot files under `e2e/ui/workflow-run-hitl-visual.spec.ts-snapshots/` are generated review artifacts.
Do not create them from the current app until the side-by-side review is accepted.
Read the existing docs before updating them.
Do not edit auto-generated files manually or update CHANGELOG.md.

## End-to-End Setup

Use the existing standalone Playwright package and isolated real Archon runtime.
The product path must include browser, API, database, executor and provider adapter.
The deterministic provider must call the real AskHuman native handler and honor resume data.
It is not enough to seed an Ask row or intercept the answer HTTP request.

Create a real test web identity and link it to the same internal user UUID as the run starter.
A matching display name is not sufficient.
Use a second authenticated context for the teammate/read-only case.
Use SQLite and the existing loopback reverse-proxy identity transport with distinct X-Archon-User values in browser extraHTTPHeaders.
The existing resolver accepts this transport when getAuth is null.
Map those web identities to internal UUIDs and link the starter to the CLI identity.
Add a no-header context that gets 401 for answer mutation.
This proves route authorization; it does not claim Better Auth login/session coverage or require a new PostgreSQL auth fixture.
Identity fixtures may seed identity records through existing test setup; pending Ask records must come from execution.
For CLI-started runs, expect the CLI to return its paused JSON envelope and exit.
Answer in the browser, verify the stored answer, then explicitly resume through the CLI.
Do not change production CLI behavior to wait.
For automatic browser continuation, separately dispatch a real web run with a valid parent conversation and verify answer-to-resume.
Keep the cases distinct because a CLI run without a parent conversation does not auto-resume through the web API.

Use actual workflow execution for ordinary nodes, tool results, route re-entry, loops, gate actions, child links and retained decisions.
Seeded typed old-history records are allowed only as labeled compatibility/visual fixtures.
Do not count those as engine or provider proof.
Run real Claude and Pi integration smoke checks separately when credentials permit.
Record provider, model, fixture, run ID and result without credentials or private output.
A missing paid-provider credential is an explicit coverage limit, not a deterministic-suite failure or claimed pass.

## Screenshot Acceptance Contract

1. Capture the canonical mockup and actual product at the same stable state, viewport and font state.
   Use 1440x1000 and 1280x900 for direct desktop comparison.
   Use 390x844 and 768x1024 to verify the documented production fallback.
2. Compare reference and actual side by side.
   Record layout, spacing, typography, color, borders, card content, controls, graph geometry and focus states.
   Classify each visible difference as fixed or explicitly accepted with its reason.
3. Review the baseline against the canonical mockup before adding application regression snapshots.
   An app screenshot cannot approve itself.
   Do not update snapshots solely to make a failed check pass.
4. Store reference and actual images plus the comparison table in the report or CI artifacts.
   Give each image a stable ID tied to its scenario, viewport and surface.
   Mask only unavoidable changing IDs/times outside the checked subject.
   Do not mask node content, tool result, controls, status, panel edges or graph geometry.
5. Require zero unresolved visual deviations before calling the alignment complete.
   A product feature beyond the mockup is retained with a deliberate placement record.
   No story is done on tests alone while its required reference comparison is missing.
6. If browser policy still prevents capture, state that visual acceptance is blocked.
   Do not bypass the restriction or replace captures with source assertions.

## Capture Matrix

| State                               | Legacy capture                    | Console capture          | Required inspection                                  |
| ----------------------------------- | --------------------------------- | ------------------------ | ---------------------------------------------------- |
| Initial no selection                | Graph, Logs, Chat                 | Log, Graph, Artifacts    | Header, tabs, full available width                   |
| Running prompt/command              | Room plus selected view           | Room plus stream         | Text roles and tool input/output                     |
| Tool error/missing/truncated        | Agent room                        | Agent room and stream    | Factual outcome, wrapping, retained-full control     |
| Awaiting Ask                        | Chat and room together            | Stream and room together | Count, questions, controlled drafts, focused pointer |
| Other/multi-select/decline          | Ask form                          | Ask form                 | Options, disabled/sending/error states               |
| Answer accepted/late/resume failure | Retained answer                   | Retained answer          | Correct result and retry guidance                    |
| Bash and script                     | Terminal room                     | Terminal room            | Real command/output/error grouping                   |
| Approval/review gate                | Gate room                         | Gate room                | Actual document/link, annotation meaning, decision   |
| Route/retry/nested loop             | Graph and selected pass           | Graph and divider/room   | Correct occurrence, colors, ports and retry edge     |
| Workflow/loop-group/cancel          | Typed room                        | Typed room               | Child link and factual control-node state            |
| Long IDs/output and many nodes      | Wide and narrow                   | Wide and narrow          | No overlap, fixed geometry, usable scroll            |
| Min/default/max room width          | 320/460/720px where space permits | Same after project rail  | Separator, focus, clamping                           |
| Keyboard/reduced motion             | Graph and Ask                     | Graph and Ask            | Focus trace, close return, reduced motion            |

## Scenario Matrix

| Priority | Scenario                                                       | Pass condition                                                                                          |
| -------- | -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Critical | CLI-origin Ask, authenticated browser answer, CLI resume       | Real pending row and answer; explicit continuation completes                                            |
| Critical | Parent-backed web-origin Ask answer                            | Browser automatically resumes the real run                                                              |
| Critical | Teammate attempts Ask answer                                   | Existing starter-only authorization rejects it                                                          |
| Critical | Duplicate/late answer and run stopped before answer            | First-wins and terminal rules preserved                                                                 |
| Critical | Ask in iteration 3 inside nested loop                          | Resume continues actual iteration/ancestry, not iteration 1                                             |
| Critical | Route re-entry after answered Ask                              | Earlier answer/session is not reused for a new occurrence                                               |
| Critical | Composer text resembles approval                               | Conversation send only; no gate mutation                                                                |
| Critical | Old/new database writers coexist                               | Additive schema and strict legacy response compatibility hold                                           |
| High     | Graph/log/chat/awaiting/deep-link selection                    | Same exact occurrence opens in its room                                                                 |
| High     | Tool call/result across cursor pages                           | One card at call position with real result                                                              |
| High     | Ask call transcript append fails                               | Pending source still renders question and retained answer                                               |
| High     | Inline gate annotations from browser with CLI-owned supervisor | Accepted receipt, paused rework, replacement review, explicit approval, then continuation               |
| High     | Native approval races inline Send, or review session changes   | One current decision path; losing/stale submission has a factual receipt and cannot reach a new session |
| High     | Poll while drafting/reading old output                         | Draft, focus and scroll survive                                                                         |
| High     | Pan/zoom/fit and long graph labels                             | Nonblank graph, no clipping or overlap                                                                  |
| High     | Source Control, Artifacts, usage and environment               | Existing controls remain reachable and usable                                                           |
| Medium   | Empty/unknown historical room                                  | Honest state with no invented transcript                                                                |
| Medium   | Mobile/touch/keyboard resize                                   | Controls fit; Ask usable at every target viewport                                                       |
| Medium   | Abort/retry test and occupied fixture port                     | Safe cleanup, no orphaned process or unrelated kill                                                     |

## CI and Commands

Root `bun run validate` does not execute standalone Playwright.
Current `test.yml` and `e2e-smoke.yml` do not run this UI suite.
Add a focused job to `test.yml` using the existing Bun/Node setup conventions.
Install the standalone package, install Chromium, build the web app, typecheck E2E, then run the two HITL specs.
Upload actual/reference/diff images, traces, HTML report, and JSON/JUnit results on failure and preserve acceptance evidence on success.
Do not add automatic baseline regeneration.

The local `e2e/package-lock.json` was not tracked during source review.
Do not assume `npm ci` is reproducible before resolving that.
Use the existing npm manifest and generate the lock through npm.
Inspect ignore rules and track the lock intentionally within the scoped test-infrastructure change.
Only then use `npm ci` in CI.
Do not hand-edit the lock or silently switch package managers.

Planned commands from the root:

```sh
npm install --package-lock-only --prefix e2e
npm ci --prefix e2e
npm exec --prefix e2e -- playwright install chromium
bun run build:web
bun run --cwd e2e typecheck
bun run --cwd e2e test:ui --grep "HITL"
bun run validate
bun run check:schema-upgrades
```

CI Linux browser installation may use the same Playwright command with `--with-deps`.
Keep PostgreSQL schema-upgrade setup aligned with the existing dedicated CI job.
Run real-provider smoke commands from their existing package test owners after reading their credential prerequisites.
Current owners are `packages/providers/src/claude/askhuman-resume-spike.test.ts` and `packages/providers/src/community/pi/askhuman-resume.characterization.test.ts`.
A characterization unit test alone is not a live-provider integration pass.
Record the actual live workflow command and result in the acceptance report.

## Durable Contract

Update SPEC.md's companion list so UX design and all five mockup files are required inputs to implementation and review.
Record that `ux-prototype` is not the visual authority.
Correct superseded UX sizing and graph-library language to match the accepted production approach.
Do not claim that Console shares a React panel with Legacy.
Make direct reference comparison a story completion condition, not an optional walkthrough.
Keep generated API schemas as the machine authority and link to them instead of copying every field into docs.

## Exit and Rollback

- [x] All critical/high scenarios pass on both surfaces. (HITL E2E 12/12; nested-loop Ask iter 3 and route re-entry are explicit coverage limits, not failures.)
- [x] Complete side-by-side matrix has no unresolved visual deviations.
- [x] Browser limitations and real-provider credential limits are explicit. (Live Claude/Pi: explicit coverage limit — no paid credentials.)
- [x] Root `bun run validate` and standalone E2E pass. PostgreSQL schema-upgrades skipped — no local Postgres (explicit coverage limit).
- [x] CI executes the focused suite and retains evidence.
- [x] All fixture-owned processes exit before temporary-directory removal.
- [x] User-visible docs and the SPEC companion list prevent the prior acceptance gap.

Rollback UI phases as focused commits while leaving additive data fields intact.
If CI exposes a flaky test, fix its cause; do not weaken assertions or regenerate snapshots.
Do not mark phase status complete until runtime and visual evidence satisfy the gate.
