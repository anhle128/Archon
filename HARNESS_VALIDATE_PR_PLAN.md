# harness-validate-pr

## Context

Add an Archon DAG workflow that validates a harness-service PR the same way `archon-validate-pr` validates Archon: prove the bug on the PR base, then prove the fix on the feature checkout. Runtime proof is live smoke, not `cargo test --workspace`. HTTP/SSE PRs spawn `gigo-daemon` and curl. TUI PRs drive the real `xai-grok-pager` binary. Mixed PRs do both. Docs/tooling-only PRs stop after dual-branch code review.

All new files live in `/Users/dale/Desktop/workspace/OceanLabs/agentic-os-plan/harness-service`. Do not add this workflow to Archon bundled defaults under `workflow-engine/archon/.archon/workflows/defaults/`.

## Approach

### 1. Initialize project Archon layout

Create:

```
.archon/
  config.yaml
  workflows/harness-validate-pr.yaml
  commands/
    harness-validate-pr-code-review-main.md
    harness-validate-pr-code-review-feature.md
    harness-validate-pr-runtime-main.md
    harness-validate-pr-runtime-feature.md
    harness-validate-pr-report.md
```

Append to existing `.gitignore` (do not replace the file):

```
.archon/.env
.archon/state/
```

`.archon/config.yaml` contents exactly:

```yaml
worktree:
  baseBranch: <detected>

github:
  prRemote: origin
```

Detect `baseBranch` with `git symbolic-ref --quiet refs/remotes/origin/HEAD` and take the last path segment. If that fails, use `develop` (AGENTS.md compare example). Do not invent a different default.

Do not set `defaults.loadDefaultWorkflows: false`. Bundled Archon workflows may remain visible; this project workflow overrides only if a filename collides (it must not: name is `harness-validate-pr`).

### 2. Write the DAG YAML

Create `.archon/workflows/harness-validate-pr.yaml` with this exact contract.

Root fields:

```yaml
name: harness-validate-pr
description: |
  Use when: User wants thorough PR validation of harness-service that proves the bug on base and the fix on the feature branch, including live HTTP+SSE and/or TUI smoke.
  Triggers: "validate PR", "validate pr #123", "test this PR", "verify PR", "full PR validation",
            "validate pull request", "test PR end-to-end", "harness validate pr".
  Does: Fetches PR info -> allocates an HTTP port -> dual-branch code review ->
        classifies HTTP/SSE vs TUI vs both vs review-only -> live smoke on base then feature ->
        cleanup -> verdict report + gh pr comment.
  NOT for: Quick code-only reviews, fixing the PR, cargo test --workspace, browser E2E, Archon-the-product validation (use archon-validate-pr).
worktree:
  enabled: false
mutates_checkout: false
requires: [github]
```

`worktree.enabled: false` is required: the feature runtime must use the live checkout, and a second Archon isolation worktree would force another full Rust compile. Document in the workflow description that `--branch` / `--from` hard-error because of this pin. Callers run from the PR checkout:

```bash
cd /Users/dale/Desktop/workspace/OceanLabs/agentic-os-plan/harness-service
archon workflow run harness-validate-pr "#123"
```

Copy `fetch-pr` bash from `workflow-engine/archon/.archon/workflows/defaults/archon-validate-pr.yaml` (node `fetch-pr`) with no logic change. It writes `$ARTIFACTS_DIR/.pr-number` and `$ARTIFACTS_DIR/.pr-repo` and dumps `gh pr view` JSON.

Add `find-port` bash (one HTTP port only; TUI does not bind a product port):

```yaml
- id: find-port
  bash: |
    HTTP_PORT=$(bun -e "const s = Bun.serve({port: 0, fetch: () => new Response('')}); console.log(s.port); s.stop()")
    echo "$HTTP_PORT" > "$ARTIFACTS_DIR/.http-port"
    echo "HTTP_PORT=$HTTP_PORT"
```

Add `resolve-paths` depending on `fetch-pr`. Same path dump as Archon validate-pr (`.canonical-repo`, `.worktree-path`, `.feature-branch`, `.pr-head`, `.pr-base`) plus checkout mismatch:

```bash
PR_HEAD_SHA=$(gh pr view "$PR_NUMBER" --repo "$PR_REPO" --json headRefOid -q .headRefOid)
LOCAL_SHA=$(git rev-parse HEAD)
echo "$PR_HEAD_SHA" > "$ARTIFACTS_DIR/.pr-head-sha"
echo "$LOCAL_SHA" > "$ARTIFACTS_DIR/.local-head-sha"
if [ "$PR_HEAD_SHA" != "$LOCAL_SHA" ]; then
  echo "mismatch $LOCAL_SHA != $PR_HEAD_SHA" > "$ARTIFACTS_DIR/.checkout-mismatch"
fi
```

Do not fail the node on mismatch. Report later mentions it.

Add `prepare-main-tree` depending on `fetch-pr` and `resolve-paths`. This exists because `worktree.enabled: false` means the live tree is the feature branch; code-review-main must not `cat` files from `pwd`.

```yaml
- id: prepare-main-tree
  depends_on: [fetch-pr, resolve-paths]
  timeout: 180000
  bash: |
    set -euo pipefail
    CANONICAL_REPO=$(tr -d '\n' < "$ARTIFACTS_DIR/.canonical-repo")
    PR_BASE=$(tr -d '\n' < "$ARTIFACTS_DIR/.pr-base")
    MAIN_TREE="$ARTIFACTS_DIR/main-checkout"
    git -C "$CANONICAL_REPO" fetch origin "$PR_BASE" --quiet
    git -C "$CANONICAL_REPO" worktree add --detach "$MAIN_TREE" "origin/$PR_BASE" --quiet
    echo "$MAIN_TREE" > "$ARTIFACTS_DIR/.e2e-main-worktree"
    git -C "$MAIN_TREE" log --oneline -1
```

If `worktree add` fails because the path exists, `git -C "$CANONICAL_REPO" worktree remove "$MAIN_TREE" --force` then retry once. If still failing, exit 1.

Classifier node `classify-testability` depends only on `fetch-pr`. `model: small`, `allowed_tools: []`, `context: fresh`. Prompt rules (put these literals in the YAML prompt):

- `http_sse: yes` when any changed path is under `crates/apps/daemon/` or `crates/harness/` (including `crates/harness/contracts/`). Also yes when a backend change alters SSE frames, session JSON, or `/v1` routes even if the file sits next to those trees.
- `tui: yes` when any changed path is under `crates/codegen/xai-grok-pager/`, `crates/codegen/xai-grok-pager-bin/`, `crates/codegen/xai-grok-pager-render/`, `crates/codegen/xai-grok-pager-minimal/`, `crates/codegen/xai-grok-pager-pty-harness/`, `crates/codegen/xai-grok-shell/`, or `crates/codegen/xai-grok-markdown/`.
- Both may be `yes` on mixed PRs.
- Both `no` for docs, `.claude/`, `brain/`, `specs/`, `tasks/`, README, and other non-runtime files.

`output_format` required properties: `http_sse` enum `[yes, no]`, `tui` enum `[yes, no]`, `reasoning` string, `http_test_plan` string, `tui_test_plan` string.

Code review nodes:

```yaml
- id: code-review-main
  command: harness-validate-pr-code-review-main
  depends_on: [fetch-pr, resolve-paths, prepare-main-tree]
  context: fresh

- id: code-review-feature
  command: harness-validate-pr-code-review-feature
  depends_on: [fetch-pr, resolve-paths, code-review-main]
  context: fresh
```

Runtime nodes (sequential so they share one HTTP port and one `CARGO_TARGET_DIR` without cargo lock fights):

```yaml
- id: runtime-main
  command: harness-validate-pr-runtime-main
  depends_on:
    [
      classify-testability,
      find-port,
      resolve-paths,
      prepare-main-tree,
      code-review-main,
      code-review-feature,
    ]
  when: "$classify-testability.output.http_sse == 'yes' || $classify-testability.output.tui == 'yes'"
  context: fresh
  idle_timeout: 1800000
  skills: [tui-test]

- id: runtime-feature
  command: harness-validate-pr-runtime-feature
  depends_on: [runtime-main, find-port, resolve-paths]
  when: "$classify-testability.output.http_sse == 'yes' || $classify-testability.output.tui == 'yes'"
  context: fresh
  idle_timeout: 1800000
  skills: [tui-test]
```

No parentheses in `when` (engine does not support them). `&&` / `||` only.

Cleanup + report, both `trigger_rule: all_done` so skipped/failed runtime still produces a verdict:

```yaml
- id: cleanup-processes
  depends_on: [runtime-main, runtime-feature]
  trigger_rule: all_done
  bash: |
    # kill .e2e-*-pid files; fuser/lsof/netstat on .http-port; tui-test --session $WORKFLOW_ID close;
    # git worktree remove of .e2e-main-worktree
```

Copy kill-by-PID-then-port pattern from Archon `cleanup-processes`, but never `pkill` by image name (`chrome`, `node`, `bun`, `cargo`, `gigo-daemon` without a port/PID). For tui-test, close only `--session "$WORKFLOW_ID"` (the session id is also written to `$ARTIFACTS_DIR/.tui-session`). Then remove leftover `$ARTIFACTS_DIR/main-checkout` via `git -C "$CANONICAL_REPO" worktree remove --force`.

```yaml
- id: final-report
  command: harness-validate-pr-report
  depends_on:
    [
      code-review-main,
      code-review-feature,
      runtime-main,
      runtime-feature,
      classify-testability,
      cleanup-processes,
    ]
  trigger_rule: all_done
  context: fresh
```

Node IDs must match `[A-Za-z_][A-Za-z0-9_-]{0,63}`. Every node has exactly one action key.

### 3. Code-review command: main (pre-PR)

Create `.archon/commands/harness-validate-pr-code-review-main.md` by copying structure from `workflow-engine/archon/.archon/commands/defaults/archon-validate-pr-code-review-main.md`, with these substitutions:

- Read changed files from `$ARTIFACTS_DIR/.e2e-main-worktree` (the detached `origin/$PR_BASE` tree), never from `pwd`.
- If a path is missing on base (new file), record `Claim: new file, absent on base`.
- Write `$ARTIFACTS_DIR/code-review-main.md` with the same `YES / NO / PARTIAL` claim table as the Archon command.
- Do not start the daemon or pager.

Success criteria identical: `PR_CONTEXT_LOADED`, `MAIN_CODE_ANALYZED`, `BUG_ASSESSED`, `ARTIFACT_WRITTEN`.

### 4. Code-review command: feature (post-PR)

Create `.archon/commands/harness-validate-pr-code-review-feature.md` from the Archon feature command, substitutions:

- Diff via `gh pr diff`.
- Full files from `pwd` (feature checkout).
- Compare each file to `$ARTIFACTS_DIR/.e2e-main-worktree/<path>` when that path exists.
- CLAUDE.md / AGENTS.md compliance instead of Archon CLAUDE.md: read `AGENTS.md` and `CLAUDE.md` at repo root; check focused-test policy (no `cargo test --workspace` in the PR), `GIGO_*` env ownership vs `brain/EnvMapping.md` if the diff touches env keys.
- Write `$ARTIFACTS_DIR/code-review-feature.md` with `APPROVE / REQUEST_CHANGES / NEEDS_DISCUSSION` and score /5.

### 5. Runtime command: main (reproduce)

Create `.archon/commands/harness-validate-pr-runtime-main.md`.

Shared env for every cargo invocation in this node and the feature node:

```bash
export CARGO_TARGET_DIR="$ARTIFACTS_DIR/cargo-target"
export RUST_MIN_STACK=16777216
```

Read `$classify-testability.output.http_sse` and `.tui`. Skip the surface that is `no`.

**HTTP/SSE when `http_sse == yes`:**

1. `MAIN_TREE` from `.e2e-main-worktree`. `HTTP_PORT` from `.http-port`.
2. `GIGO_HOME="$ARTIFACTS_DIR/gigo-home-main"`; `mkdir -p "$GIGO_HOME"`.
3. Write `$GIGO_HOME/config.toml`:

```toml
[http]
listen = "127.0.0.1:<HTTP_PORT>"
```

4. `GIGO_RUNNER_LISTENER_TOKEN` = `openssl rand -hex 32` (or `python3 -c 'import secrets; print(secrets.token_hex(32))'`). Persist the token only in `$ARTIFACTS_DIR/.runner-token` with mode `0600`. Never echo it. Daemon `main` fails closed without this env (`load_runner_listener_token` in `crates/apps/daemon/src/main.rs`).
5. Build and spawn from `MAIN_TREE`:

```bash
cd "$MAIN_TREE"
GIGO_HOME="$GIGO_HOME" GIGO_RUNNER_LISTENER_TOKEN="$(cat "$ARTIFACTS_DIR/.runner-token")" \
  cargo build -p gigo-daemon --bin gigo-daemon
GIGO_HOME="$GIGO_HOME" GIGO_RUNNER_LISTENER_TOKEN="$(cat "$ARTIFACTS_DIR/.runner-token")" \
  "$CARGO_TARGET_DIR/debug/gigo-daemon" > "$ARTIFACTS_DIR/.e2e-main-daemon.log" 2>&1 &
echo $! > "$ARTIFACTS_DIR/.e2e-main-daemon-pid"
```

6. Poll `GET http://127.0.0.1:$HTTP_PORT/health` then `GET /ready` for up to 60s (`sleep 2` loop). Expect `{"status":"ok"}` and `{"status":"ready"}`. On timeout, dump last 40 log lines, write `e2e-http-main.md` as `DAEMON_NOT_READY`, and skip remaining HTTP cases (do not retry more than this one 60s window).
7. Always run the baseline after ready:
   - `POST http://127.0.0.1:$HTTP_PORT/v1/sessions` with `Content-Type: application/json` and body `{"harness_id":"gigo"}`. If 4xx, retry once with `{"harness_id":"gigo-native"}`. Capture `id` from JSON (field name as returned; if missing, parse any conversation id string in the body).
   - `GET /v1/sessions/{id}/stream` with `Accept: text/event-stream` via `curl -N --max-time 20`. Pass if HTTP 200 and `Content-Type` contains `text/event-stream`, and the body contains either `: keepalive` or any `data:` / `event:` frame. Do not require a native runner or a real LLM. Live deltas are out of scope unless the PR claim is specifically a live frame and the test plan can produce it without a real worker; then mark that claim `PARTIAL`.
8. Then execute `$classify-testability.output.http_test_plan` against the same server (only `/v1` routes that exist on this nest: sessions, events, stream, elicitations resolve, cancel, reconnect, recovery, harnesses, harnesses/candidates, harnesses/{id}/check, projects). Record status codes and redacted bodies (truncate to 500 bytes; never log the runner token).
9. Kill the daemon PID and free the port before leaving the HTTP section so TUI can start cleanly.

**TUI when `tui == yes`:**

1. From `MAIN_TREE`: `cargo build -p xai-grok-pager-bin --bin xai-grok-pager` and `cargo build -p xai-grok-pager-pty-harness --bin pty-scenario`.
2. Write `$ARTIFACTS_DIR/tui-main-scenario.yaml`. Default content is a copy of `crates/codegen/xai-grok-pager/tests/scenarios/welcome.yaml` with `name` set to `validate-pr-main-welcome`. If `tui_test_plan` names a more specific existing scenario under `crates/codegen/xai-grok-pager/tests/scenarios/`, copy that file instead of welcome. If the PR needs a new journey, author a YAML using the same schema (`name`, `mock.response`, `steps` with `wait_for_text` / `assert_contains` / `assert_not_contains` / `screenshot`) and keep it under `$ARTIFACTS_DIR` (do not commit product scenarios unless the PR already added them).
3. Run:

```bash
cd "$MAIN_TREE"
"$CARGO_TARGET_DIR/debug/pty-scenario" \
  --scenario "$ARTIFACTS_DIR/tui-main-scenario.yaml" \
  --binary "$CARGO_TARGET_DIR/debug/xai-grok-pager" \
  --artifacts "$ARTIFACTS_DIR/pty-main"
```

`pty-scenario` starts `ContentController` (mock inference + `TestSandbox`) internally. Do not invent a bun mock of `/v1/chat/completions`. Pass/fail is the process exit code plus `report.json` in the artifacts dir.

4. If `PATH` has `tui-test` reporting `tui-test 0.1.0-beta.2` (`$HOME/.local/bin` first; check-only via `.claude/skills/tui-test/scripts/ensure_cli.sh`, never download), additionally dump chrome: `tui-test --session $WORKFLOW_ID` is optional. If the CLI is missing or fails twice, skip tui-test and keep pty-scenario as the TUI proof. Never `tui-test close` without `--session`. Write `$WORKFLOW_ID` to `$ARTIFACTS_DIR/.tui-session`.
5. Forbidden: `pkill` chrome/node/bun/cargo; `tui-test close --all`.

Write `$ARTIFACTS_DIR/e2e-main.md` covering both surfaces that ran, with `BUG REPRODUCED / NOT REPRODUCED / SKIPPED` per case and paths to pty screenshots / curl logs.

Kill daemon (if still up) before the node ends. Do not remove `main-checkout` here; feature runtime does not use it, cleanup does.

### 6. Runtime command: feature (verify fix)

Create `.archon/commands/harness-validate-pr-runtime-feature.md`.

Phase 0: kill leftover `.e2e-main-daemon-pid` and anything on `.http-port` (same loop as Archon e2e-feature Phase 0). Close leftover tui-test session `$WORKFLOW_ID` if still open.

Load `$ARTIFACTS_DIR/e2e-main.md` and re-run every HTTP and TUI case that ran on main, from `pwd` (feature checkout), same `CARGO_TARGET_DIR`, but:

- `GIGO_HOME="$ARTIFACTS_DIR/gigo-home-feature"` (do not reuse main's sqlite `chat.db`).
- Daemon log/pid files use `.e2e-feature-daemon.log` / `.e2e-feature-daemon-pid`.
- Pager scenario artifacts go to `$ARTIFACTS_DIR/pty-feature`.
- Scenario YAML is `$ARTIFACTS_DIR/tui-feature-scenario.yaml`. Start from the main scenario; only change expected strings that the PR claims to fix (e.g. assert the bug text is absent). If main used welcome.yaml, feature uses the same wait for `Quit` plus any extra assertions from `tui_test_plan`.

HTTP uses the same `.http-port`. TUI extra UX: if tui-test is available, also `set` is N/A; use pty-scenario `resize` step already in welcome.yaml as the viewport check.

Write `$ARTIFACTS_DIR/e2e-feature.md` with columns Main Result / Feature Result / Fix Verified.

Kill daemon PIDs (main and feature pid files) and free the port. Verify the port is free with `lsof`/`netstat` before finishing.

### 7. Report command

Create `.archon/commands/harness-validate-pr-report.md` from Archon `archon-validate-pr-report.md`.

Read: `code-review-main.md`, `code-review-feature.md`, `e2e-main.md`, `e2e-feature.md` (missing files are `NOT AVAILABLE` when classifier skipped runtime). If `.checkout-mismatch` exists, mention it under Bug Confirmation.

Verdict enum stays `APPROVE / REQUEST_CHANGES / NEEDS_DISCUSSION`. APPROVE requires:

- Bug confirmed on base (or justified `NO` with code evidence).
- Fix addresses root cause.
- If `http_sse == yes`: health/ready + session/stream baseline passed on feature, and PR-specific HTTP cases that reproduced on main are fixed.
- If `tui == yes`: pty-scenario passed on feature for the same scenario family, and the reproduced chrome bug is gone.
- No regressions listed as CRITICAL/HIGH.
- AGENTS.md focused-test policy not violated by the PR.

Write `$ARTIFACTS_DIR/validation-report.md` then `gh pr comment` with the condensed table. Footer: `_Validated by harness-validate-pr workflow_`.

### 8. Validate the workflow

From harness-service (Archon CLI on PATH; inside the Archon repo this would be `bun run cli`, but this project uses the installed `archon` binary):

```bash
cd /Users/dale/Desktop/workspace/OceanLabs/agentic-os-plan/harness-service
archon workflow list --json
```

The JSON must contain an object with `"name": "harness-validate-pr"`. If the local CLI supports `archon workflow validate harness-validate-pr` (or `archon validate workflows harness-validate-pr`), run that too and require exit 0. If the subcommand does not exist, `workflow list --json` plus a dry read of the YAML is the gate; do not claim validator success.

Fix any loader errors (unknown keys, `when` field not in `output_format`, missing command files, skill `tui-test` not found). Skill resolution is `.claude/skills/tui-test/SKILL.md` which already exists in harness-service.

Do not run the workflow against a live PR in this implementation unless the user supplies a PR number after the files land.

## Critical files & anchors

- `crates/apps/daemon/src/main.rs` — `DaemonConfig::load` reads `$GIGO_HOME/config.toml` key `http.listen` (default `127.0.0.1:8787`); `GIGO_RUNNER_LISTENER_TOKEN` is mandatory; `TcpListener::bind(config.listen)`; probes are not here.
- `crates/apps/daemon/src/router.rs` — `GET /health`, `GET /ready`; nest `/v1`.
- `crates/apps/daemon/src/routes/mod.rs` `v1_nest()` — session create/list/get, `GET /sessions/{id}/stream`, events, elicitations, cancel, reconnect, recovery, harnesses, projects.
- `crates/codegen/xai-grok-pager/tests/scenarios/welcome.yaml` — default TUI smoke (`wait_for_text: Quit`).
- `crates/codegen/xai-grok-pager-pty-harness/Cargo.toml` — `[[bin]] name = "pty-scenario"`.
- Copy-from: `workflow-engine/archon/.archon/workflows/defaults/archon-validate-pr.yaml` and its five command files under `.archon/commands/defaults/`.

## Verification

1. `test -f .archon/workflows/harness-validate-pr.yaml` and the five command files exist.
2. `cd harness-service && archon workflow list --json` includes `"name": "harness-validate-pr"`.
3. YAML load: every `command:` value matches a basename in `.archon/commands/` without `.md`. `when` on runtime nodes uses `http_sse` / `tui` fields declared on `classify-testability.output_format`.
4. HTTP smoke contract (manual or first real run): with a throwaway `GIGO_HOME` and random `GIGO_RUNNER_LISTENER_TOKEN`, `gigo-daemon` bound to `127.0.0.1:<port>` answers `GET /health` → `{"status":"ok"}` and `GET /ready` → `{"status":"ready"}`. `POST /v1/sessions` with `{"harness_id":"gigo"}` returns a conversation id. `GET /v1/sessions/{id}/stream` is `text/event-stream`.
5. TUI smoke contract: `pty-scenario --scenario crates/codegen/xai-grok-pager/tests/scenarios/welcome.yaml --binary target/debug/xai-grok-pager` (or `$CARGO_TARGET_DIR/debug/...`) exits 0 and writes a welcome screenshot under `--artifacts`.
6. Dual-branch contract: `prepare-main-tree` path `$ARTIFACTS_DIR/main-checkout` has `HEAD` equal to `origin/$PR_BASE`; feature commands use `pwd`.
7. Cleanup contract: after `cleanup-processes`, `.http-port` has no listener and `git worktree list` does not contain `main-checkout`.

Risky-step checks: if daemon never becomes `/ready`, HTTP section must record `DAEMON_NOT_READY` and still allow TUI + report. If `pty-scenario` exits 2 (tooling) twice, skip TUI and report `TUI_TOOLING_FAILED`. Never escalate to `pkill`.

## Assumptions & contingencies

- Caller runs Archon with cwd = harness-service on the PR branch. If `.checkout-mismatch` is present, report `NEEDS_DISCUSSION` only when feature runtime still ran against local files; do not abort setup.
- `origin/<base>` is fetchable. If fetch fails, `prepare-main-tree` fails the run (no silent fallback to `main` vs `develop`).
- Redis may be down; daemon treats subscriber connect failure as degraded and still binds HTTP (`main.rs` around `SharedRedisSubscriber::from_default_url`). Do not require Redis.
- Shared `CARGO_TARGET_DIR=$ARTIFACTS_DIR/cargo-target` for both trees. If cargo incremental errors mention stale fingerprint / crate mismatch, split to `cargo-target-main` and `cargo-target-feature` and rebuild; do not `cargo clean` the user’s repo `target/`.
- `POST /v1/sessions` body is `{"harness_id":"gigo"}` first, then `gigo-native`. If both 4xx, skip stream baseline, keep `/health` `/ready`, mark session/stream `NOT REPRODUCED` with the status code.
- tui-test is optional evidence; pty-scenario is the required TUI proof. Do not add a product `tui_spotcheck_server` binary.
- First cargo build of `gigo-daemon` + pager can exceed 10 minutes; `idle_timeout: 1800000` covers it. Do not lower it.
  )
