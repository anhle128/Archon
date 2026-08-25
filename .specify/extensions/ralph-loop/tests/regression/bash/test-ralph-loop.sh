#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"

_fake_pi_runner() {
  local expected_approval="$1"
  shift
  [ "$#" -eq 7 ]
  [ "$1" = "--mode" ]
  [ "$2" = "json" ]
  [ "$3" = "$expected_approval" ]
  [ "$4" = "--model" ]
  [ -n "$5" ]
  [ "$6" = "--thinking" ]
  [ -n "$7" ]
  printf '%s\n' '{"type":"session","id":"runner-test","cwd":"/tmp"}'
  printf '%s\n' '{"type":"message_end","message":{"role":"assistant","content":[{"type":"text","text":"<promise>COMPLETE</promise>"}]}}'
}

omp() {
  if [ "${OMP_TEST_ERROR:-0}" = "1" ]; then
    printf '%s\n' '{"type":"session","id":"error-test","cwd":"/tmp"}'
    printf '%s\n' '{"type":"message_end","message":{"role":"assistant","content":[],"stopReason":"error","errorMessage":"402 Insufficient credits"}}'
    printf '%s\n' '{"type":"turn_end","message":{"usage":{"input":0,"output":0,"cacheRead":0}}}'
    return 7
  fi
  _fake_pi_runner --auto-approve "$@"
}

pi() {
  _fake_pi_runner --approve "$@"
}

grok() {
  [ "$#" -eq 9 ]
  [ "$1" = "--yolo" ]
  [ "$2" = "--model" ]
  [ -n "$3" ]
  [ "$4" = "--reasoning-effort" ]
  [ -n "$5" ]
  [ "$6" = "--output-format" ]
  [ "$7" = "streaming-messages-json" ]
  [ "$8" = "--prompt-file" ]
  [ -f "$9" ]
  printf '%s\n' "{\"type\":\"system\",\"subtype\":\"init\",\"session_id\":\"grok-test\",\"model\":\"$3\"}"
  if [ "${GROK_TEST_ERROR:-0}" = "1" ]; then
    printf '%s\n' '{"type":"result","subtype":"error_during_execution","is_error":true,"errors":["401 Unauthorized"]}'
    return 9
  fi
  printf '%s\n' '{"type":"assistant","message":{"role":"assistant","content":[{"type":"tool_use","name":"run_terminal_command","input":{"command":"pwd"}}]}}'
  printf '%s\n' '{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"<promise>COMPLETE</promise>"}]}}'
  printf '%s\n' '{"type":"result","subtype":"success","is_error":false,"total_cost_usd":0,"duration_ms":1,"num_turns":1}'
}

export -f _fake_pi_runner omp pi grok

assert_tasks_to_prd_uses_repo_feature_directory() (
  fixture_root="$(mktemp -d)"
  trap 'rm -rf "$fixture_root"' EXIT

  feature_dir="$fixture_root/specs/1-1-list-gigo-without-external-detection"
  extension_dir="$fixture_root/.specify/extensions/ralph-loop"
  mkdir -p "$feature_dir" "$extension_dir/scripts/bash"
  git -C "$fixture_root" init -q -b feature/test
  git -C "$fixture_root" config user.email test@example.com
  git -C "$fixture_root" config user.name Test
  git -C "$fixture_root" commit -q --allow-empty -m fixture
  cp "$REPO_ROOT/scripts/bash/tasks-to-prd.sh" "$extension_dir/scripts/bash/"

  cat > "$fixture_root/.specify/feature.json" <<'EOF'
{
  "feature_directory": "specs/1-1-list-gigo-without-external-detection"
}
EOF
  cat > "$feature_dir/tasks.md" <<'EOF'
# Tasks: Feature-directory fixture

## Phase 1: Setup

- [ ] T001 Create the fixture
EOF

  (
    cd "$extension_dir"
    bash scripts/bash/tasks-to-prd.sh >/dev/null
  )

  [ -f "$feature_dir/prd.json" ]
  [ -f "$feature_dir/progress.txt" ]
  [ ! -e "$extension_dir/prd.json" ]
  [ ! -e "$extension_dir/progress.txt" ]
  jq -e '.specDirectory == "specs/1-1-list-gigo-without-external-detection"' \
    "$feature_dir/prd.json" >/dev/null
  jq -e '.ralph_prd_file == "specs/1-1-list-gigo-without-external-detection/prd.json"' \
    "$fixture_root/.specify/feature.json" >/dev/null
)

assert_runner() {
  local tool="$1" expected_session="${2:-runner-t (/tmp)}" expected_action="${3:-}" output
  output=$(RALPH_I_UNDERSTAND_DANGEROUS=1 \
    RALPH_PRD_FILE=/dev/null \
    RALPH_PROGRESS_FILE=/dev/null \
    "$REPO_ROOT/ralph.sh" --tool "$tool" 1)
  grep -q "Starting Ralph - Tool: $tool" <<< "$output"
  grep -q "session: \"$expected_session\"" <<< "$output"
  [ -z "$expected_action" ] || grep -q "$expected_action" <<< "$output"
  grep -q 'Ralph completed all tasks!' <<< "$output"
}

bash -n "$REPO_ROOT/ralph.sh"
for file in "$REPO_ROOT"/scripts/bash/*.sh; do
  bash -n "$file"
done

assert_tasks_to_prd_uses_repo_feature_directory
assert_runner omp
assert_runner pi
assert_runner grok 'grok-tes (gpt-5.5)' 'terminal: "pwd"'

set +e
error_output=$(OMP_TEST_ERROR=1 \
  RALPH_I_UNDERSTAND_DANGEROUS=1 \
  RALPH_PRD_FILE=/dev/null \
  RALPH_PROGRESS_FILE=/dev/null \
  "$REPO_ROOT/ralph.sh" --tool omp 1 2>&1)
error_status=$?
set -e

[ "$error_status" -eq 7 ]
grep -q 'error: "402 Insufficient credits"' <<< "$error_output"
if grep -q 'Iteration 1 complete' <<< "$error_output"; then
  exit 1
fi

set +e
grok_error_output=$(GROK_TEST_ERROR=1 \
  RALPH_I_UNDERSTAND_DANGEROUS=1 \
  RALPH_PRD_FILE=/dev/null \
  RALPH_PROGRESS_FILE=/dev/null \
  "$REPO_ROOT/ralph.sh" --tool grok 1 2>&1)
grok_error_status=$?
set -e

[ "$grok_error_status" -eq 9 ]
grep -q 'error: "401 Unauthorized"' <<< "$grok_error_output"
if grep -q 'Iteration 1 complete' <<< "$grok_error_output"; then
  exit 1
fi

echo "Ralph loop regression tests passed."
