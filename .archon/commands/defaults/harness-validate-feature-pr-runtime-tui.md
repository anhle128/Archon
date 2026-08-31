---
description: Live-TUI smoke of a harness-service feature checkout via microsoft/tui-test; this node inspects the PR/checkout and plans+runs feature assertions; writes runtime-tui.md
argument-hint: (none - reads from artifacts)
---

# Runtime: TUI (tui-test)

Runs only when `tui == yes`. **Required proof is tui-test** (microsoft/tui-test) driving
the real pager in a headless PTY. `pty-scenario` is optional extra evidence. HTTP/SSE
(baseline + feature requests) is the supervised `runtime-http` bash node. Do NOT redo HTTP here.

Write **`$ARTIFACTS_DIR/runtime-tui.md`**.

**Classifier (already decided, typed enum only):**

- `tui`: $classify-testability.output.tui

Do **not** read a TUI plan from the classifier. That field does not exist. Prose
between nodes is a wire format; plan TUI actions **in this node** after inspecting
the PR and checkout.

**PR identity (structured fetch-pr JSON, not a test plan):**

$fetch-pr.output

## Shared env

```bash
export CARGO_TARGET_DIR="$ARTIFACTS_DIR/cargo-target"
export RUST_MIN_STACK=16777216
export PATH="$HOME/.local/bin:$PATH"
cd "$(tr -d '\n' < "$ARTIFACTS_DIR/.worktree-path")"
```

## Steps

1. Inspect the PR and checkout **in this node** (do not wait for a plan from classify):

```bash
PR_NUMBER=$(tr -d '\n' < "$ARTIFACTS_DIR/.pr-number")
PR_REPO=$(tr -d '\n' < "$ARTIFACTS_DIR/.pr-repo")
gh pr view "$PR_NUMBER" --repo "$PR_REPO" --json title,body,files,headRefName,url
gh pr diff "$PR_NUMBER" --repo "$PR_REPO"
```

Treat title/body/`Fixes #N` as **feature requirements**. Read changed pager/TUI files
from `pwd` (paths under `crates/codegen/xai-grok-pager*`, `xai-grok-shell`,
`xai-grok-markdown`). Derive the feature assertions yourself: which tui-test
`type`/keys/`mouse click --on-text` plus `wait`/`expect` prove each claimed TUI
behavior. Write that derived list into `runtime-tui.md` **before** running it.
Do not invent a develop/base comparison.

2. Build the pager:

```bash
cargo build -p xai-grok-pager-bin --bin xai-grok-pager
```

3. Read `.claude/skills/tui-test/SKILL.md` and `references/harness-pager.md` before launching.
4. Run `.claude/skills/tui-test/scripts/ensure_cli.sh` **check-only** (never download). If the
   check fails, write `runtime-tui.md` status `TUI_TOOLING_FAILED` and stop. The report treats
   missing tui-test evidence as non-approvable — never fall back silently.
5. Launch a named session (blocked-backend baseline env from the in-crate e2e recipe):

```bash
SESSION="hvfpr-$WORKFLOW_ID"
TMP_HOME=$(mktemp -d)
DEAD=http://127.0.0.1:1/v1
tui-test --session "$SESSION" close >/dev/null 2>&1 || true
tui-test --session "$SESSION" run --restart --cols 120 --rows 50 \
  --cwd "$TMP_HOME" --timeout-text 30000 --timeout-idle 15000 \
  --env HOME="$TMP_HOME" --env TERM=xterm-256color --env RUST_MIN_STACK=16777216 \
  --env XAI_API_KEY=test-key-for-ci --env XAI_API_BASE_URL="$DEAD" \
  --env GIGO_CLI_CHAT_PROXY_BASE_URL="$DEAD" \
  --env GIGO_TELEMETRY_ENABLED=false --env GIGO_FEEDBACK_ENABLED=false \
  -- "$CARGO_TARGET_DIR/debug/xai-grok-pager" --no-leader
```

6. Baseline (each exit code decides; `wait` timeout = exit 1):

```bash
tui-test --session "$SESSION" wait text "Quit" --timeout 30000
tui-test --session "$SESSION" expect text "Quit" --no-strict --timeout 5000
tui-test --session "$SESSION" expect text "panicked" --not --timeout 5000
```

Any non-zero → TUI_FAILED. The baseline alone does not validate the PR's claimed TUI changes.

7. **Feature-specific coverage (required).** Execute the assertions this node derived in
   step 1: `type`/key presses/`mouse click --on-text` plus `wait`/`expect` on the text
   that behavior renders. Record every command + exit code in `runtime-tui.md`.
   - If an interaction needs backend responses, do NOT use the dead backend: start a scripted
     mock (python/bun HTTP server answering `/v1/settings` 200 and `/v1/chat/completions` with
     the scripted SSE this node chose — the same contract `MockInferenceServer`/`ContentController`
     provide in-crate) under an isolated `HOME`, and point `XAI_API_BASE_URL`/
     `GIGO_CLI_CHAT_PROXY_BASE_URL` at it.
   - If a claimed behavior cannot be exercised by tui-test on this checkout, record it NOT
     COVERED with the reason; `TUI_EXERCISED` requires the NOT-COVERED set to be empty
     (otherwise TUI_FAILED).

8. Dump chrome and close:

```bash
.claude/skills/tui-test/scripts/dump_session.sh "$SESSION" "$ARTIFACTS_DIR/tui-test" after || true
tui-test --session "$SESSION" close
echo "$SESSION" > "$ARTIFACTS_DIR/.tui-session"
```

Never `tui-test close` without `--session`. Never `pkill` by image name.

### Optional pty-scenario (extra evidence)

```bash
cargo build -p xai-grok-pager-pty-harness --bin pty-scenario
cp crates/codegen/xai-grok-pager/tests/scenarios/welcome.yaml "$ARTIFACTS_DIR/tui-scenario.yaml"
mkdir -p "$ARTIFACTS_DIR/pty"
"$CARGO_TARGET_DIR/debug/pty-scenario" \
  --scenario "$ARTIFACTS_DIR/tui-scenario.yaml" \
  --binary "$CARGO_TARGET_DIR/debug/xai-grok-pager" \
  --artifacts "$ARTIFACTS_DIR/pty" > "$ARTIFACTS_DIR/pty/report.json" || true
```

`pty-scenario` writes `report.json` + `bugs.md` itself under `$ARTIFACTS_DIR/pty/<scenario>/<started_at_ms>/`; the redirect adds a top-level copy. Supplementary only — the verdict rides on tui-test.

## Write `$ARTIFACTS_DIR/runtime-tui.md`

```markdown
# Feature PR Runtime TUI: PR #{number}

**tui classifier**: yes

## Plan (derived in this node)

- claims: {from PR title/body}
- assertions: {each tui-test command planned before run}

## TUI

**Status**: TUI_EXERCISED / TUI_FAILED / TUI_TOOLING_FAILED

- tui-test session: {name}; ensure_cli check-only: ok/failed
- baseline: wait "Quit" ok/failed; expect "Quit" ok/failed; expect no "panicked" ok/failed
- feature assertions: {each command + exit code, or NOT COVERED + reason}
- mock backend used: {none / scripted mock URL}
- chrome dump: {$ARTIFACTS_DIR/tui-test paths}
- optional pty-scenario: {exit/status or skipped}
```

## Success Criteria

- **TUI_EXERCISED**: baseline passed AND every feature assertion this node derived from
  the PR/checkout passed (NOT-COVERED empty)
- **ARTIFACT_WRITTEN**: `$ARTIFACTS_DIR/runtime-tui.md`

Forbidden: dual-branch bugfix success tokens, any main-vs-feature comparison token,
and any classifier TUI prose plan.
