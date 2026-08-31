# harness-validate-feature-pr — validation evidence

Investigation record for the `harness-validate-feature-pr` bundled workflow, kept so the gate design and its proof can be re-audited later.

- Workflow: `.archon/workflows/defaults/harness-validate-feature-pr.yaml`
- Commands: `.archon/commands/defaults/harness-validate-feature-pr-{code-review,runtime-tui,report}.md`
- Committed on `dev` (commit `5babb6c1` "update").
- Story name derived from context (not in `sprint-status.yaml` / `plans/` / `docs/superpowers/plans/`; the `81430257` sprint-status change only added Source Control backlog stories, with no `done` transition).

## Why the gate is trustworthy (two fixes)

### 1. HTTP: prose plan -> typed `http_requests` + strict matching

The earlier gate counted any live status in 200–599 as "exercised", so a run with 400/503 responses reported every request passing — a false positive.
The fix (node `runtime-http`) makes the classifier emit a typed `http_requests[]` array of `{ method, path, body, expect_status, expect_statuses?, invariant, claim }`.
A case passes only when the live status is in `expect_status` (or `expect_statuses` when provided), never "any 2xx–5xx".
The body `invariant` must also hold: an empty invariant or `"status"` is rejected, `"json"` requires the body to parse as JSON, any other string must appear in the body, and a 4xx/5xx claim needs a distinctive error substring because reaching an error handler is not proof.
`HTTP_PLAN_EXERCISED` requires every feature case to pass AND at least one live 2xx; otherwise the status is `HTTP_PLAN_FAILED`.

### 2. TUI: removed the prose wire `tui_test_plan`

The classifier used to pass a prose TUI plan between nodes, and prose between nodes is a wire format even when the consumer is an AI node.
The fix makes the classifier emit only `tui: yes|no`.
`runtime-tui` now inspects the PR/checkout itself (`gh pr view` / `gh pr diff` plus the pager files on the checkout) and plans its tui-test actions in that same node before running them.

## Reproducible proof (committed, drift-proof)

`verify_http_gate.py` extracts the exact gate Python from the committed workflow YAML (node `runtime-http`) and runs it against a local mock daemon, so it proves the shipped gate and cannot drift from it.
Captured output lives in `expected-gate-results.md`.

```bash
python3 tests/harness-validate-feature-pr/verify_http_gate.py   # exit 0 = 5/5 cases as expected
```

Each case asserts both the verdict and a substring of `http-plan-results.md`:

- 2xx registry + typed 405 -> `HTTP_PLAN_EXERCISED` (`happy_2xx=2`)
- reconnect 503 declared `expect_status: 200` -> `HTTP_PLAN_FAILED` (`status 503 not in [200]`), the exact false positive now blocked
- only a 4xx -> `HTTP_PLAN_FAILED` (`happy_2xx=0`)
- empty invariant, isolated by a valid 2xx -> `HTTP_PLAN_FAILED` (`body invariant required`)
- `expect_statuses: [200, 409]`, live 200 -> `HTTP_PLAN_EXERCISED`

## Verified in the migration session (schema + bundle only)

These are the commands actually run when moving the workflow into bundled defaults.
They are schema and bundle checks, not an end-to-end workflow run.

- `bun run cli validate workflows harness-validate-feature-pr` -> `1 valid, 0 errors` (2 warnings on this machine's default provider `codex`: `allowed_tools` on `classify-testability` and `skills` on `runtime-tui` are ignored by codex, with no warnings on a claude-default install).
- `bun run generate:bundled` (this migration) -> `67 commands, 35 workflows`, and `bun run check:bundled` -> up to date; the bundle's workflow count later rose to 36 as a concurrent workflow addition landed on `dev`, so the count is timeline-dependent and the stable signals are the `validate` result and check:bundled "up to date".
- `bun run cli workflow list` -> `harness-validate-feature-pr` present (discoverable).

No new end-to-end run, verdict, or PR comment was produced by the migration.

## Earlier build-phase runs (secondary pointers — the committed test above is the durable proof)

Run artifacts live under `~/.archon/workspaces/<project>/artifacts/runs/<run-id>/`, which is gitignored and never committed.
They are referenced by id so they can be re-fetched if still present.

- Localtest overlay run `0d0e6e981e7e7f6974ac6032c3f5ca4a`: `.http-status` = `DB_MIGRATED + HTTP_SSE_EXERCISED + HTTP_PLAN_EXERCISED`, `feature_exercised=4/4` (`GET /v1/harnesses` 200, `GET /v1/harnesses/candidates` 200, `POST /v1/harnesses/gigo/check` 200, `GET /v1/harnesses/gigo/check` 405 typed).
- Executor fixtures (mock HTTP) plus live `gigo-daemon` tests of node `runtime-http` proved the strict gate — `503` vs `expect_status: 200` -> `HTTP_PLAN_FAILED`, and `200` + body invariant -> `HTTP_PLAN_EXERCISED` — exercising the bash executor rather than the full DAG.

## Reproduce

Real run (worktree disabled, so run from the PR checkout at the PR head commit):

```bash
cd <harness-service checkout>
archon workflow run harness-validate-feature-pr "#<PR>"
```

Re-validate schema with `bun run cli validate workflows harness-validate-feature-pr`.
The gate logic lives in `.archon/workflows/defaults/harness-validate-feature-pr.yaml`, node `runtime-http` (Python heredoc: `expect_status`/`expect_statuses` + `invariant` + `happy_2xx`).

## Where results appear when the workflow runs

- A `gh pr comment` on the PR, with header `## Harness Feature PR Validation Report`, footer `_Validated by harness-validate-feature-pr workflow_`, and verdict `APPROVE` / `REQUEST_CHANGES` / `NEEDS_DISCUSSION`.
- Per-run artifacts under `~/.archon/workspaces/<project>/artifacts/runs/<run-id>/`: `validation-report.md`, `code-review.md`, `runtime-http.md`, `http-plan-results.md`, `runtime-tui.md`, `.http-status`, `sqlite-migrations.txt`, and daemon logs.
- Inspect via `archon workflow runs`, `archon workflow status <id>`; REST `GET /api/runs/:runId/artifacts` and `GET /api/artifacts/:runId/*`; or the Web UI run view.

## Known gap / follow-up (reliability)

`final-report` is an unconstrained AI command (no `output_format` / `output_type`), and "always gh pr comment" is prompt-driven.
If the agent fails before or during posting, the user may get neither a stable surfaced summary nor a comment URL.
The proposed follow-up is a deterministic publish/receipt node that verifies `validation-report.md` exists, posts it, captures the comment URL, and emits run id + artifact path + verdict back to the invoking channel.
