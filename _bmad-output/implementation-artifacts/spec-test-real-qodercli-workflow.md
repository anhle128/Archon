---
title: 'Test Real Qodercli Workflow'
type: 'feature'
created: '2026-07-07T00:00:00+07:00'
status: 'done'
baseline_commit: '72be7dff'
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Archon now has a `qodercli` provider, but there is no local workflow that intentionally exercises the real installed Qoder CLI end to end.
This makes it harder to verify local auth, provider discovery, model routing, reasoning effort routing, prompt execution, structured-output parsing, and node output references after provider changes.

**Approach:** Add a repo-local test workflow under `.archon/workflows/test-workflows/` that runs one real Qoder prompt and one real Qoder structured-output prompt, then asserts both outputs in a deterministic bash node.
Use a small explicit model from the locally observed Qoder model list and a low reasoning effort so the workflow is cheap enough for local smoke testing.

## Boundaries & Constraints

**Always:** Keep this as a local test workflow, not a bundled default user workflow.
Name it clearly as an E2E smoke test.
Use `provider: qodercli`, `model: Lite`, and `effort: low` so the workflow verifies the provider-specific Qoder path without relying on the user's global default assistant.
Keep prompts deterministic and short.
Include assertions that fail when Qoder returns no output or structured output is missing.
Preserve the existing unrelated dirty web files.

**Ask First:** Ask before changing the Qoder provider implementation, changing global tier defaults, adding docs beyond a small workflow comment, or running a long/multi-prompt real Qoder test outside this smoke workflow.

**Never:** Do not add this workflow to `.archon/workflows/defaults/` or regenerate bundled defaults for it.
Do not make the smoke test require edits, file writes, shell tools from Qoder, or non-local network setup beyond Qoder's own authenticated model call.
Do not hard-code local usernames, email addresses, session IDs, or machine-specific paths.

## I/O & Edge-Case Matrix

| Scenario                            | Input / State                                                                              | Expected Output / Behavior                                                                | Error Handling                                            |
| ----------------------------------- | ------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| Real local Qoder smoke              | `qodercli status -o json` reports `logged_in: true` and the workflow is run from this repo | A simple prompt returns non-empty text and a structured prompt returns a JSON object      | Bash assert node prints `PASS` with both outputs          |
| Missing login or binary             | Qoder CLI is absent or logged out                                                          | Workflow fails before or during the first Qoder node with the provider's actionable error | Error names `qodercli login` or Qoder binary setup        |
| Empty or unparseable model response | Qoder returns no content or structured output cannot be parsed                             | Workflow reaches the assert node only when outputs exist; otherwise run fails             | Bash assert node exits non-zero with a clear failure line |

</frozen-after-approval>

## Code Map

- `.archon/workflows/test-workflows/e2e-codex-smoke.yaml` -- Closest smoke workflow pattern with a simple AI node, structured-output node, and bash assertion.
- `.archon/workflows/test-workflows/e2e-pi-smoke.yaml` -- Community provider smoke pattern using low effort and comments explaining local auth behavior.
- `packages/workflows/src/schemas/workflow.ts` -- Workflow-level provider, model, effort, and node schema entry point.
- `packages/workflows/src/schemas/dag-node.ts` -- Prompt, structured-output, timeout, and bash node fields accepted by YAML workflows.
- `packages/cli/src/commands/validate.ts` -- CLI validation path used by `bun run cli validate workflows`.

## Tasks & Acceptance

**Execution:**

- [x] `.archon/workflows/test-workflows/e2e-qodercli-smoke.yaml` -- add a local Qoder CLI E2E smoke workflow with simple prompt, structured output prompt, and bash assertion -- gives this machine a direct real-provider verification path.

**Acceptance Criteria:**

- Given the repo workflow list is loaded, when `bun run cli workflow list --json` runs, then `e2e-qodercli-smoke` is discoverable as a project workflow.
- Given workflow validation runs, when `bun run cli validate workflows e2e-qodercli-smoke` executes, then the workflow passes schema/provider validation.
- Given this local machine has `qodercli` installed and logged in, when `bun run cli workflow run e2e-qodercli-smoke --no-worktree "smoke"` executes, then the run completes and the assert node prints `PASS`.

## Verification

**Commands:**

- `qodercli status -o json` -- expected: `logged_in` is `true`.
- `bun run cli validate workflows e2e-qodercli-smoke` -- expected: validation passes.
- `bun run cli workflow run e2e-qodercli-smoke --no-worktree "smoke"` -- expected: workflow completes and prints a `PASS` assertion.

## Suggested Review Order

- Entry point names the local Qoder smoke workflow and pins provider/model/effort.
  [`e2e-qodercli-smoke.yaml:5`](../../.archon/workflows/test-workflows/e2e-qodercli-smoke.yaml#L5)

- Non-mutating declaration prevents smoke runs from checkpointing unrelated dirty files.
  [`e2e-qodercli-smoke.yaml:10`](../../.archon/workflows/test-workflows/e2e-qodercli-smoke.yaml#L10)

- Simple prompt verifies the real local Qoder CLI path streams text.
  [`e2e-qodercli-smoke.yaml:14`](../../.archon/workflows/test-workflows/e2e-qodercli-smoke.yaml#L14)

- Structured node verifies best-effort JSON parsing and schema validation.
  [`e2e-qodercli-smoke.yaml:20`](../../.archon/workflows/test-workflows/e2e-qodercli-smoke.yaml#L20)

- Bash assertion fails loudly on empty output or missing structured fields.
  [`e2e-qodercli-smoke.yaml:37`](../../.archon/workflows/test-workflows/e2e-qodercli-smoke.yaml#L37)
