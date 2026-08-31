# harness-validate-feature-pr

## Context

Add a **harness-service** Archon project workflow that reviews/validates a **feature PR on the PR checkout only**. It is not an Archon-the-product validator and it is not dual-branch: no `code-review-main`, no runtime-on-base, no main worktree, no “bug confirmed on base” verdict.

Runtime proof is live harness-service smoke, not `cargo test --workspace` and not Archon `agent-browser`:

- **HTTP + SSE** (`gigo-daemon`): requires an isolated SQLite home and **successful embedded migrations** before any `/v1` call. `/ready` is not enough by itself — verify `chat.db` and schema-history tables.
- **TUI** (`xai-grok-pager` driven by microsoft `tui-test` as the required proof; `pty-scenario` optional extra evidence).
- Mixed PRs do both. Docs/tooling-only PRs stop after code review.

All new files live in `/Users/dale/Desktop/workspace/OceanLabs/agentic-os-plan/harness-service`. Do **not** add this workflow to Archon bundled defaults under `workflow-engine/archon/.archon/workflows/defaults/`. Do not implement `HARNESS_VALIDATE_PR_PLAN.md` (that plan is the dual-branch bugfix sibling).

## Approach

### 1. Initialize project Archon layout

Create:

```
.archon/
  config.yaml
  workflows/harness-validate-feature-pr.yaml
  commands/
    harness-validate-feature-pr-code-review.md
    harness-validate-feature-pr-runtime-tui.md
    harness-validate-feature-pr-report.md
```

Append to existing `.gitignore` (do not replace the file):

```
.archon/.env
.archon/state/
```

`.archon/config.yaml` contents exactly:

```yaml
worktree:
  baseBranch: develop

github:
  prRemote: origin
```

`baseBranch` is `develop` (`git symbolic-ref --quiet refs/remotes/origin/HEAD`). Do not invent `main`.

Do not set `defaults.loadDefaultWorkflows: false`. Bundled Archon workflows may remain visible; this project workflow must not collide on filename (`harness-validate-feature-pr`).

### 2. Write the DAG YAML

Create `.archon/workflows/harness-validate-feature-pr.yaml` with this contract.

Root fields:

```yaml
name: harness-validate-feature-pr
description: |
  Use when: User wants to validate or review a harness-service feature PR on the
            feature checkout only — confirm claimed HTTP/SSE and/or TUI behavior
            works, without proving a bug on develop/base.
  Triggers: "validate feature PR", "validate feature pr #123", "verify feature PR",
            "review feature PR", "feature PR validation", "test feature PR",
            "harness validate feature pr".
  Does: Fetches PR info -> allocates an HTTP port -> prepares isolated GIGO_HOME
        (SQLite + runner token) -> code review of the PR checkout ->
        classifies HTTP/SSE vs TUI vs both vs review-only -> live smoke on the
        feature checkout (daemon migrate+HTTP+SSE and/or pager PTY) ->
        cleanup -> verdict report + gh pr comment.
  NOT for: Bugfix PRs that need bug-on-base then fix-on-feature proof
            (use harness-validate-pr when that workflow exists).
            Archon-the-product validation (use archon-validate-pr /
            archon-validate-feature-pr). cargo test --workspace, browser E2E,
            fixing the PR, general exploration.
worktree:
  enabled: false
mutates_checkout: false
requires: [github]
```

`worktree.enabled: false` is required: the feature runtime must use the live checkout; a second Archon isolation worktree would force another full Rust compile. Callers run from the PR checkout:

```bash
cd /Users/dale/Desktop/workspace/OceanLabs/agentic-os-plan/harness-service
archon workflow run harness-validate-feature-pr "#123"
```

`--branch` / `--from` hard-error because of this pin.

Nodes, in this order:

**`fetch-pr`** — same control flow as `archon-validate-pr` `fetch-pr`: repo from `git remote get-url "$PR_REMOTE"` (`$PR_REMOTE` is an Archon-substituted workflow variable backed by `github.prRemote`, default `origin`; the engine also exports it in the bash node env), with an optional override when the trigger message carries an explicit GitHub PR URL. Writes `.pr-number` + `.pr-repo`, dumps `gh pr view` JSON. Verified through Archon substitution (`substituteWorkflowVariables` with `shellSafe: true` + the loaded repo config), not a standalone shell.

**`find-port`** — one HTTP port (TUI does not bind a product port). Prefer `python3` ephemeral bind; fall back to `bun`. Write `$ARTIFACTS_DIR/.http-port`.

**`resolve-paths`** — dump `.canonical-repo`, `.worktree-path`, `.feature-branch`, `.pr-head`, `.pr-base`. **Fail fast** (`exit 1`) if `git rev-parse HEAD` != PR `headRefOid` — smoke-testing the wrong checkout produces misleading verdicts. Downstream must not read `.canonical-repo` or `.pr-base` for a before/after comparison.

**`prepare-sqlite`** — `depends_on: [find-port]`. Always runs (even for TUI-only / review-only) so skip-cascade cannot drop runtime. Isolated `$ARTIFACTS_DIR/gigo-home`, `config.toml` `[http] listen = "127.0.0.1:<port>"`, `GIGO_RUNNER_LISTENER_TOKEN` at `$ARTIFACTS_DIR/.runner-token` mode `0600`. **Do not** create `chat.db` here and **do not** copy `~/.gigo/chat.db`. Daemon bootstrap fails closed if the token is missing _before_ any SQLite open.

**`classify-testability`** — `depends_on: [fetch-pr]`, `allowed_tools: []`, `context: fresh`. Required `output_format`: `http_sse` enum `[yes, no]`, `tui` enum `[yes, no]`, `reasoning`, typed `http_requests` array (`method`, `path`, `body`, `expect_status`, `invariant`, `claim`). Do **not** emit a prose `http_test_plan` or `tui_test_plan` — prose between nodes is a wire format; an AI consumer is not an exception.

Classifier rules (literals):

- `http_sse: yes` when any changed path is under `crates/apps/daemon/` or `crates/harness/` (including `crates/harness/contracts/` and `crates/harness/sqlite/`). Also yes when a backend change alters SSE frames, session JSON, `/v1` routes, or SQLite migrations even if the file sits next to those trees.
- `tui: yes` when any changed path is under `crates/codegen/xai-grok-pager/`, `crates/codegen/xai-grok-pager-bin/`, `crates/codegen/xai-grok-pager-render/`, `crates/codegen/xai-grok-pager-minimal/`, `crates/codegen/xai-grok-pager-pty-harness/`, `crates/codegen/xai-grok-shell/`, or `crates/codegen/xai-grok-markdown/`.
- Both may be `yes` on mixed PRs.
- Both `no` for docs, `.claude/`, `brain/`, `specs/`, `tasks/`, README, and other non-runtime files.

When `http_sse == yes`, `http_requests` MUST contain at least one non-baseline `/v1` request (not `/health`, `/ready`, `POST /v1/sessions`, `GET .../stream`). When `http_sse == no`, emit `[]`. `tui` is only the yes/no gate — `runtime-tui` inspects the PR/checkout and plans tui-test actions **in that same node**. Do NOT write steps to reproduce a bug on develop/base.

**`code-review`**

```yaml
- id: code-review
  command: harness-validate-feature-pr-code-review
  depends_on: [fetch-pr, resolve-paths]
  context: fresh
```

**`runtime-http`** (one supervised `bash:` lifetime) and **`runtime-tui`** (AI, gated on `tui == yes`).

Do **not** leave the daemon running for a later AI node. Do **not** add a `plan-http` interpreter node: that would re-create prose-as-wire-format (`http_test_plan` string → later node). Classifier `output_format.http_requests` is the typed contract. Bash validates (allowlist, method, size, `expect_status`, `invariant`) then executes in the same shell that launched the daemon, then trap-kills it.

For `http_sse == yes`, APPROVE needs `.http-status` to contain **both** `HTTP_SSE_EXERCISED` and `HTTP_PLAN_EXERCISED` (declared status + body invariant + at least one 2xx; never 'any 200-599').

```yaml
- id: runtime-http # bash: ONE shell — build, launch, trap EXIT/INT/TERM/HUP,
  bash: | #   poll /health+/ready, SQLite history, POST session, SSE,
    ...                       #   execute $classify-testability.output.http_requests (allowlisted), trap cleanup.
  depends_on: [classify-testability, find-port, resolve-paths, prepare-sqlite, code-review]
  when: "$classify-testability.output.http_sse == 'yes'"
  timeout: 1800000

- id: runtime-tui
  command: harness-validate-feature-pr-runtime-tui
  depends_on:
    [fetch-pr, classify-testability, find-port, resolve-paths, prepare-sqlite, code-review]
  when: "$classify-testability.output.tui == 'yes'"
  context: fresh
  idle_timeout: 1800000
  skills: [tui-test]
```

No parentheses in `when`. `&&` / `||` only. AI stays for classify / report / TUI; HTTP **execution** is one bash lifetime consuming typed classifier output.

**`cleanup-processes`** — `depends_on: [runtime-http, runtime-tui]`, `trigger_rule: all_done`. Kill `.e2e-*-pid`, free `.http-port` (`fuser` / `lsof` / `netstat`+`taskkill`), `tui-test --session $WORKFLOW_ID close`. Never `pkill` by image name (`gigo-daemon`, `cargo`, `chrome`). No main-worktree remove. Skipped `runtime` still satisfies `all_done`.

**`final-report`**

```yaml
- id: final-report
  command: harness-validate-feature-pr-report
  depends_on: [code-review, runtime-http, runtime-tui, classify-testability, cleanup-processes]
  trigger_rule: all_done
  context: fresh
```

Forbidden node ids: `code-review-main`, `runtime-main`, `prepare-main-tree`, `e2e-test-main`. Forbidden commands: `archon-validate-pr-*`, `harness-validate-pr-*` (dual-branch names).

### 3. Code-review command

`.archon/commands/harness-validate-feature-pr-code-review.md`

- Diff via `gh pr diff`; full files from `pwd`.
- Map each PR **claim** (title/body/`Fixes #N` as feature requirements, not a bug to reproduce on base) → YES / PARTIAL / NO.
- AGENTS.md + CLAUDE.md: focused-test policy (no `cargo test --workspace` in the PR); `GIGO_*` env vs `brain/EnvMapping.md` if the diff touches env keys.
- Artifact: `$ARTIFACTS_DIR/code-review.md`.
- Success: `DIFF_ANALYZED`, `FILES_READ`, `CLAIMS_MAPPED`, `AGENTS_MD_CHECKED`, `ARTIFACT_WRITTEN`. Do **not** include `MAIN_COMPARED`.

### 4. Runtime (HTTP+SSE needs DB + migrations; TUI is PTY)

HTTP is the `runtime-http` bash node (not a command file): trap-supervised daemon + baseline + `$classify-testability.output.http_requests`. TUI is `.archon/commands/harness-validate-feature-pr-runtime-tui.md` — that node inspects the PR/checkout and plans tui-test actions itself. Do **not** add `harness-validate-feature-pr-runtime.md`, `harness-validate-feature-pr-runtime-http-plan.md`, a `plan-http` node, or a classifier `tui_test_plan` string — command discovery exposes every `.archon/commands` file, and prose between nodes is a wire format.

Shared env:

```bash
export CARGO_TARGET_DIR="$ARTIFACTS_DIR/cargo-target"
export RUST_MIN_STACK=16777216
```

Read `$classify-testability.output.http_sse` and `.tui`. Skip the surface that is `no`.

#### HTTP/SSE when `http_sse == yes` — database and migrations are mandatory

Daemon bootstrap (`crates/apps/daemon/src/main.rs` `bootstrap`):

1. Fail closed on missing `GIGO_RUNNER_LISTENER_TOKEN` **before** any SQLite open (never creates `chat.db` without a token).
2. `SqliteConversationStore::open` on `$GIGO_HOME/chat.db` (optional split `storage.conversation_database_uri` is out of scope for this smoke; use single-store).
   - Product Refinery migrations V1–V9 → history table `harness_conversation_schema_history`.
   - Operational Refinery V1–V2 → `harness_operational_schema_history`.
3. `SqliteHarnessEventJournal::open_with_config` on the same primary:
   - Journal `migrations::apply` → `harness_journal_schema_migrations`.
   - Admission Refinery V1 → `harness_admission_schema_history`.
4. If **any** migrate/open fails, the process exits and **never binds HTTP**. `/health` and `/ready` must not be treated as success in that case.

Required sequence:

1. `GIGO_HOME` from `$ARTIFACTS_DIR/.gigo-home` (prepared node). `HTTP_PORT` from `.http-port`. Token from `.runner-token` — never echo it.
2. From `pwd` (feature checkout):

```bash
cd "$(tr -d '\n' < "$ARTIFACTS_DIR/.worktree-path")"
GIGO_HOME="$GIGO_HOME" GIGO_RUNNER_LISTENER_TOKEN="$(cat "$ARTIFACTS_DIR/.runner-token")" \
  cargo build -p gigo-daemon --bin gigo-daemon
GIGO_HOME="$GIGO_HOME" GIGO_RUNNER_LISTENER_TOKEN="$(cat "$ARTIFACTS_DIR/.runner-token")" \
  "$CARGO_TARGET_DIR/debug/gigo-daemon" > "$ARTIFACTS_DIR/.e2e-daemon.log" 2>&1 &
DPID=$!
trap 'kill "$DPID" 2>/dev/null; pkill -P "$DPID" 2>/dev/null; kill -9 "$DPID" 2>/dev/null' EXIT INT TERM HUP
```

The PID is local to this bash node. Do not expect it to outlive the shell.

3. Poll `GET http://127.0.0.1:$HTTP_PORT/health` then `GET /ready` for up to 60s (`sleep 2`). Expect `{"status":"ok"}` and `{"status":"ready"}`.
   - If the PID exits before bind: dump last 80 log lines, write `runtime.md` HTTP section as `MIGRATE_OR_STORE_FAILED`, skip remaining HTTP cases. Do not retry more than this one 60s window.
4. **Prove migrations** against `$GIGO_HOME/chat.db` (python3 `sqlite3` stdlib; `sqlite3` CLI optional). Require tables:
   - `harness_conversation_schema_history` with `MAX(version) >= 9`
   - `harness_operational_schema_history` with `MAX(version) >= 2`
   - `harness_admission_schema_history` with `MAX(version) >= 1`
   - `harness_journal_schema_migrations` non-empty
     Write the query results to `$ARTIFACTS_DIR/sqlite-migrations.txt`. If the file is missing or versions are short, HTTP baseline is `MIGRATIONS_INCOMPLETE` even if `/ready` returned 200.
5. Never reuse host `~/.gigo` or a pre-seeded `chat.db`. Redis may be down (degraded); do not require Redis.
6. Baseline after migrate-ok:
   - `POST /v1/sessions` `Content-Type: application/json` body `{"harness_id":"gigo"}`. If 4xx, retry once with `{"harness_id":"gigo-native"}`. Capture conversation id (`id` or `conversation.id`).
   - `GET /v1/sessions/{id}/stream` `Accept: text/event-stream` via `curl -N --max-time 20`. Pass if HTTP 200, `Content-Type` contains `text/event-stream`, and body contains `: keepalive` or any `data:` / `event:` frame. Do not require a native runner or a real LLM.
7. Then execute `$classify-testability.output.http_requests` (allowlisted `/v1` only) in this same shell. A case passes only if live status is in `expect_status`/`expect_statuses` **and** the body `invariant` holds. Empty invariant is rejected. `HTTP_PLAN_EXERCISED` also requires at least one live 2xx — a 400/503 error handler is not registry/lifecycle/reconnect proof. Truncate bodies to 500 bytes; never log the runner token.
8. Trap cleanup kills the daemon when this bash node exits (success, failure, cancel, or timeout). Do not hand the PID to a later node.

#### TUI when `tui == yes`

1. `cargo build -p xai-grok-pager-bin --bin xai-grok-pager` and `cargo build -p xai-grok-pager-pty-harness --bin pty-scenario`.
2. Scenario: copy `crates/codegen/xai-grok-pager/tests/scenarios/welcome.yaml` to `$ARTIFACTS_DIR/tui-scenario.yaml` (or a more specific existing scenario this TUI node selected from the checkout). `pty-scenario` starts `ContentController` internally — do not invent a bun mock of `/v1/chat/completions`. Do not take a TUI plan from the classifier.
3. Run:

```bash
"$CARGO_TARGET_DIR/debug/pty-scenario" \
  --scenario "$ARTIFACTS_DIR/tui-scenario.yaml" \
  --binary "$CARGO_TARGET_DIR/debug/xai-grok-pager" \
  --artifacts "$ARTIFACTS_DIR/pty" \
  > "$ARTIFACTS_DIR/pty/report.json"
```

`pty-scenario` writes `report.json` + `bugs.md` under `<artifacts>/<scenario>/<started_at_ms>/` and also prints the report to stdout (`status` lowercase `passed`/`skipped`/`failed`); the redirect adds a top-level copy. Pass/fail is process exit code. Write `$WORKFLOW_ID` to `$ARTIFACTS_DIR/.tui-session`. 4. Optional: if `tui-test 0.1.0-beta.2` is on PATH (`$HOME/.local/bin` first; check-only via `.claude/skills/tui-test/scripts/ensure_cli.sh`, never download), extra chrome dump. If missing or fails twice, skip tui-test and keep pty-scenario as the TUI proof. Never `tui-test close` without `--session`.

Write `$ARTIFACTS_DIR/runtime.md` covering both surfaces that ran. Success: `DB_MIGRATED` (HTTP path), `HTTP_SSE_EXERCISED` or skipped, `TUI_EXERCISED` or skipped, `ARTIFACT_WRITTEN`. Not `BUG REPRODUCED` / `FIX_VERIFIED`.

### 5. Report command

`.archon/commands/harness-validate-feature-pr-report.md`

Read `code-review.md` + `runtime.md` (runtime missing = review-only or skip). Cross-reference each claim: code map, HTTP/SSE if classified, TUI if classified.

**APPROVE required (all):**

| Criteria                                                                                                                                                                                                                  | Required for APPROVE |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------- |
| Claimed behavior implemented in code                                                                                                                                                                                      | Yes                  |
| If `http_sse == yes`: isolated `chat.db` migrated (history tables) AND health/ready AND session/stream baseline                                                                                                           | Yes                  |
| If `tui == yes`: tui-test passed baseline + feature-specific assertions `runtime-tui` derived from the PR/checkout in that node; `TUI_FAILED`/`TUI_TOOLING_FAILED` prevents APPROVE (REQUEST_CHANGES or NEEDS_DISCUSSION) | Yes, mandatory       |
| No CRITICAL/HIGH correctness issues                                                                                                                                                                                       | Yes                  |
| AGENTS.md focused-test policy not violated                                                                                                                                                                                | Yes                  |

**Forbidden as APPROVE requirements:** “Bug confirmed on develop/base”, “Fix addresses root cause”, any main-vs-feature table.

Always `gh pr comment`. Header `## Harness Feature PR Validation Report`. Footer `_Validated by harness-validate-feature-pr workflow_`.

### 6. Validate the workflow

From harness-service:

```bash
cd /Users/dale/Desktop/workspace/OceanLabs/agentic-os-plan/harness-service
archon workflow list --json
```

JSON must contain `"name": "harness-validate-feature-pr"`. If `archon workflow validate harness-validate-feature-pr` exists, require exit 0.

Do not run against a live PR unless the user supplies a PR number after the files land.

## Critical files & anchors

- `crates/apps/daemon/src/main.rs` — `DaemonConfig::load` (`$GIGO_HOME/config.toml` `http.listen`, default `127.0.0.1:8787`); token mandatory; `SqliteConversationStore::open` then journal open then bind.
- `crates/harness/sqlite/src/conversation_store.rs` `open_selected_paths_inner` — product then operational migrate.
- `crates/harness/sqlite/src/lib.rs` `SqliteHarnessEventJournal::open_with_config` — journal + admission migrate.
- History tables: `harness_conversation_schema_history`, `harness_operational_schema_history`, `harness_admission_schema_history`, `harness_journal_schema_migrations`.
- `crates/apps/daemon/src/router.rs` — `GET /health`, `GET /ready`; nest `/v1`.
- `crates/codegen/xai-grok-pager/tests/scenarios/welcome.yaml` — default TUI smoke (`wait_for_text: Quit`).
- `crates/codegen/xai-grok-pager-pty-harness/Cargo.toml` — `[[bin]] name = "pty-scenario"`.

## Verification

1. The three command files + YAML + `.archon/config.yaml` exist under harness-service.
2. `archon workflow list --json` includes `"name": "harness-validate-feature-pr"`.
3. Grep the new files: **zero** `code-review-main`, `e2e-main`, `BUG REPRODUCED`, `Bug confirmed on main`, `Compare with main`.
4. HTTP path in the runtime command orders: token → build/spawn → `/ready` → **sqlite history proof** → `POST /v1/sessions` → SSE stream.
5. `prepare-sqlite` does not copy host `chat.db` and does not skip the token.

[Showing lines 1-300 of 303. Use :301 to continue]
