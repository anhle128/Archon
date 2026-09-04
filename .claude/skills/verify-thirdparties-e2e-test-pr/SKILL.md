---
name: verify-thirdparties-e2e-test-pr
description: >-
  Use to gate a Pull Request on third-party end-to-end test coverage. Given the
  third-party dependencies a PR touches (external APIs it integrates or mocks),
  it checks the PR's SOURCE CODE for a real third-party e2e/contract test for
  each one, ticks the covered requirements, and reports which are missing. This
  is the "Lane A" gate: it makes downstream mocking trustworthy — without a real
  third-party test anchoring a mock, the mock is false confidence. It does ONE
  thing (the coverage verdict); it does not build the app, drive a browser, or
  author tests. Triggers: "verify third-party tests PR", "third-party e2e gate",
  "check PR contract tests", "lane A gate", "mock anchor check".
---

# verify-thirdparties-e2e-test-pr

## Responsibility (single)

Emit a **third-party e2e coverage verdict** for one PR:
- Input: the list of third-party e2e requirements (from `web-automation-test-pr`, or derived here from the PR diff) + the PR's source code.
- For each requirement, search the source for a real third-party e2e/contract test (makes a real call to that dependency and asserts the response SHAPE). **Tick** the ones present.
- Output `{ allTicked, ticked[], unticked[] }` — a structured verdict.

Out of scope: writing the missing tests (that is the implement agent / a `supplement-tests` node), building the app, driving a browser, authoring web specs. **Single responsibility: the gate only.**

## Why this gate exists

Writing third-party e2e tests is the **implement agent's** responsibility, not this workflow's. This skill only verifies they exist and are sufficient. If they are missing, every mocked Lane B test behind them is worthless (you can't know the real dependency still works). So: no third-party coverage → negative verdict → the run must not proceed on trust.

## Inputs

- A PR reference (number or branch).
- Optionally, `thirdparty_e2e_requirements[]` produced by `web-automation-test-pr`. If absent, derive it: read `gh pr diff <n>` and identify which external/third-party integrations the PR adds or changes (AI provider SDKs, GitHub API, payment, external HTTP — interpret the diff; do NOT regex prose).

## Steps

1. **Resolve the requirements list.** Use the handed-in list, or derive it from the PR diff (which third-party surfaces does this PR touch?). Read the changed source — do not guess.
2. **Check source for each requirement.** For each third-party requirement, search the PR's test files for a real e2e/contract test covering it: a test that actually calls the dependency (or a recorded fixture validated against it) and asserts the response shape the PR's code parses. Interpret the code; a unit test that mocks the dependency does NOT satisfy a third-party requirement.
3. **Tick / untick.** Mark each requirement covered (✓) or missing (✗). Record the evidence (test file:line) for ticked ones and the specific gap for unticked ones.
4. **Emit the structured verdict** (see Output). This is what a `route_loop` condition reads (`condition: "$verify-thirdparties-e2e-test-pr.output.allTicked == true"`).

## Output

Structured JSON (declare via `output_format` when used as a workflow node, so `allTicked` is readable by a `route_loop` condition):
```
{
  "pr": <n>,
  "allTicked": <boolean>,
  "ticked":   [ { "requirement": "...", "evidence": "path:line" } ],
  "unticked": [ { "requirement": "...", "gap": "why it's missing / insufficient" } ],
  "rationale": "..."
}
```

## Escalation on gaps

- In the workflow, `allTicked == false` routes the `route_loop` to a `supplement-tests` node (auto-add + re-verify), and on exhaustion to a comment node.
- The supported way to comment gaps onto the PR is a deterministic `bash:` node running `gh pr comment "<pr>" --body-file "$ARTIFACTS_DIR/<file>.md"` (there is NO adapter API callable from a node; precedent: `.archon/workflows/defaults/harness-validate-feature-pr.yaml` `post-report`). When run manually, print the missing requirements and (if asked) post them with `gh pr comment`.

## Notes / constraints

- Skill file lives at `.claude/skills/verify-thirdparties-e2e-test-pr/` so both Claude Code and an Archon Claude-provider node (`skills: [verify-thirdparties-e2e-test-pr]`) resolve it.
- Deterministic verdict: interpret the code, then commit to a structured `{allTicked, ...}` — never leave the pass/fail as prose.
- Feature-agnostic; the PR is an input.
- "Don't guess" — read the actual source before ticking/unticking.
