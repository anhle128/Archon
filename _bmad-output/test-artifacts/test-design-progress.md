---
workflowStatus: 'completed'
totalSteps: 5
stepsCompleted:
  - 'step-01-detect-mode'
  - 'step-02-load-context'
  - 'step-03-risk-and-testability'
  - 'step-04-coverage-plan'
  - 'step-05-generate-output'
lastStep: 'step-05-generate-output'
nextStep: ''
lastSaved: '2026-07-19'
mode: 'epic-level'
epic: '3'
story: '3.3c'
inputDocuments:
  - '_bmad-output/implementation-artifacts/3-3c-provide-archon-provider-decision-command-cli-json.md'
  - '_bmad-output/project-context.md'
  - '_bmad/tea/config.yaml'
  - '_bmad-output/planning-artifacts/prd.md'
  - '_bmad-output/planning-artifacts/architecture.md'
  - '_bmad-output/planning-artifacts/epics.md'
  - '_bmad-output/planning-artifacts/contracts/workflow-commander/schemas/workflow-command-envelope.schema.json'
  - 'packages/cli/src/commands/workflow.ts'
  - 'packages/cli/src/cli.ts'
  - 'packages/cli/src/commands/workflow-provider-command-envelope.ts'
  - 'packages/cli/src/commands/workflow.test.ts'
  - 'packages/cli/src/commands/workflow-json.e2e.test.ts'
  - 'packages/cli/src/commands/workflow-command-contract.test.ts'
  - 'packages/cli/src/commands/workflow-provider-command-envelope.test.ts'
  - 'packages/cli/package.json'
  - '.agents/skills/bmad-testarch-test-design/resources/knowledge/risk-governance.md'
  - '.agents/skills/bmad-testarch-test-design/resources/knowledge/probability-impact.md'
  - '.agents/skills/bmad-testarch-test-design/resources/knowledge/test-levels-framework.md'
  - '.agents/skills/bmad-testarch-test-design/resources/knowledge/test-priorities-matrix.md'
  - '.agents/skills/bmad-testarch-test-design/resources/knowledge/nfr-criteria.md'
  - '.agents/skills/bmad-testarch-test-design/resources/knowledge/contract-testing.md'
  - '.agents/skills/bmad-testarch-test-design/resources/knowledge/error-handling.md'
outputDocument: '_bmad-output/test-artifacts/test-design/test-design-3-3c-provide-archon-provider-decision-command-cli-json.md'
---

# Test Design Progress: 3.3c Provide Archon Provider Decision Command CLI JSON

## Step 1: Detect Mode

Mode selected: Epic-Level.

Reason: the supplied implementation artifact is a focused story handoff with explicit acceptance criteria, implementation slices, contract references, and reviewer/retro concerns for one CLI JSON decision-command story.

Prerequisite result: PASS - `_bmad-output/implementation-artifacts/3-3c-provide-archon-provider-decision-command-cli-json.md` exists and provides acceptance criteria plus detailed risk evidence.

## Step 2: Load Context

Configuration loaded: Playwright utils enabled; Pact.js utils disabled; Pact MCP disabled; browser automation `auto`; test stack `auto`; risk threshold `p1`; test artifacts rooted at `_bmad-output/test-artifacts`.

Detected project stack: fullstack Bun + strict TypeScript monorepo, with this story's executable surface concentrated in headless CLI JSON, command dispatch, workflow operation formatting, and in-repo JSON schema contracts.

Loaded project evidence: story 3.3c, project context, PRD/architecture/epics context, workflow command envelope schema and fixtures, `workflow.ts`, `cli.ts`, shared envelope builder, existing CLI test files, package-isolated test script, and TEA risk/priority/level/NFR/contract/error-handling knowledge fragments.

Existing test patterns: `workflow.test.ts` for command unit behavior and mocks, `workflow-json.e2e.test.ts` for real subprocess JSON purity and argv guard behavior, `workflow-command-contract.test.ts` for emitted-envelope contract checks, and `workflow-provider-command-envelope.test.ts` for shared builder/schema regression.

## Step 3: Risk and Testability

Risk assessment completed with 17 risks.
High-risk concerns focus on controller contract breakage, fail-open JSON error paths, stdout/stderr contamination, pre-handler bypasses, decision-state integrity, classifier specificity, forbidden output fields, timeout handling, and test isolation.

Every known reviewer concern was dispositioned as a risk or explicit non-risk with probability, impact, score, and scenario/waiver mapping.

## Step 4: Coverage Plan

Coverage plan completed with 50 atomic scenarios: 25 P0, 20 P1, and 5 P2.

The matrix includes happy path, negative path, boundary cases, malformed input, stale data, duplicate actions, out-of-order decision ordering, partial failure, dependency failure, timeout, cancellation waiver, concurrency/race, rollback, permission/auth waiver, and regression cases.

## Step 5: Generate Output

Output written to `_bmad-output/test-artifacts/test-design/test-design-3-3c-provide-archon-provider-decision-command-cli-json.md`.

Checklist validation summary: PASS with waivers W-001 through W-008 recorded for parser limitation, BMAD-only fixture fields, event stream ordering, local CLI permission/auth boundary, cancellation, performance threshold, full cross-process race, and recovery-command envelope conversion.
