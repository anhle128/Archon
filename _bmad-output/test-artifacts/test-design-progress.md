---
workflowStatus: 'completed'
totalSteps: 5
stepsCompleted:
  [
    'step-01-detect-mode',
    'step-02-load-context',
    'step-03-risk-and-testability',
    'step-04-coverage-plan',
    'step-05-generate-output',
  ]
lastStep: 'step-05-generate-output'
nextStep: ''
lastSaved: '2026-07-09'
inputDocuments:
  - '_bmad-output/implementation-artifacts/a5-1-orchestrate-decision-needed-follow-up.md'
  - '_bmad-output/implementation-artifacts/sprint-status.yaml'
  - '_bmad-output/implementation-artifacts/a4-2-route-quality-loop-and-error-paths.md'
  - '_bmad-output/implementation-artifacts/a4-1-aggregate-quality-gate-summary.md'
  - '_bmad-output/project-context.md'
  - '_bmad/tea/config.yaml'
  - '_bmad-output/planning-artifacts/architecture.md'
  - '_bmad-output/planning-artifacts/epics.md'
  - '_bmad-output/planning-artifacts/prd.md'
  - '_bmad-output/test-artifacts/test-design/test-design-a4-2-route-quality-loop-and-error-paths.md'
  - 'packages/workflows/package.json'
  - 'packages/workflows/src/defaults/v2-quality-route-loop-contract.test.ts'
  - 'packages/workflows/src/defaults/v2-quality-route-loop-dag.test.ts'
  - '.archon/workflows/defaults/bmad-dev-story-with-tea-fix-loop-v2.yml'
  - '.agents/skills/bmad-testarch-test-design/resources/knowledge/risk-governance.md'
  - '.agents/skills/bmad-testarch-test-design/resources/knowledge/probability-impact.md'
  - '.agents/skills/bmad-testarch-test-design/resources/knowledge/test-levels-framework.md'
  - '.agents/skills/bmad-testarch-test-design/resources/knowledge/test-priorities-matrix.md'
  - '.agents/skills/bmad-testarch-test-design/resources/knowledge/nfr-criteria.md'
  - '.agents/skills/bmad-testarch-test-design/resources/knowledge/contract-testing.md'
outputDocument: '_bmad-output/test-artifacts/test-design/test-design-a5-1-orchestrate-decision-needed-follow-up.md'
---

# Test Design Progress

## Step 1: Detect Mode And Prerequisites

Mode: Epic-level test design.

Reason: `_bmad-output/implementation-artifacts/sprint-status.yaml` exists, and the input is a story-level implementation artifact with acceptance criteria, tasks, dev notes, and reviewer concerns.

Primary requirements source: `_bmad-output/implementation-artifacts/a5-1-orchestrate-decision-needed-follow-up.md`.

Prerequisites: Available for buildable-now and fail-closed planning.

Live Linear and BMAD-METHOD sync prerequisites are explicitly absent and are handled as deferred waivers, not hidden coverage.

## Step 2: Load Context And Knowledge Base

Configuration loaded from `_bmad/tea/config.yaml`.

Detected project stack: fullstack Bun and TypeScript monorepo.

Detected story execution surface: backend workflow DAG YAML plus `@archon/workflows` Bun tests.

Browser exploration: skipped because the story has no browser target URL and no UI acceptance path.

Existing test patterns loaded: co-located Bun structural contract tests with `parseWorkflow`, isolated Bun DAG executor tests for files using `mock.module()`, source-versus-bundle assertions, and v1 baseline preservation checks.

Required knowledge fragments loaded: risk governance, probability-impact scoring, test-level selection, test-priority mapping, NFR criteria, and contract-testing guidance.

## Step 3: Risk And Testability

Risk scoring uses probability 1-3 multiplied by impact 1-3.

Every known reviewer concern was classified as a risk, explicit non-risk, or waiver.

P0/P1 priority was assigned whenever a concern can break core workflow behavior, security, data integrity, compatibility, or cross-process contract behavior.

Highest risks are missing cross-project live dependencies, fake Linear/sync behavior, incorrect PASS seam wiring, malformed summary validation, fail-open handling for decision-needed items, and insufficient DAG proof.

## Step 4: Coverage Plan

Coverage uses structural Bun contract tests for workflow shape, generated bundle parity, package test registration, and forbidden live integration.

Coverage uses isolated real DAG executor tests for no-op success, fail-closed decision-needed behavior, malformed or stale summaries, duplicate artifact writes, dependency failure, and A4.2 route-loop regression.

Every acceptance criterion, high-risk item, and reviewer concern maps to scenarios or waivers in the final document.

## Step 5: Output And Validation

Final output written to `_bmad-output/test-artifacts/test-design/test-design-a5-1-orchestrate-decision-needed-follow-up.md`.

Checklist validation result: pass.

Open waivers remain for deferred live Linear create/reuse, real BMAD-METHOD sync error, cancellation, credential/auth behavior, A6 proof-run decision-needed expectations, load/scalability, and browser UI.
