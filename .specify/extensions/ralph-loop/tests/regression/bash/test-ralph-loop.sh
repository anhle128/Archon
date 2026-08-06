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
  _fake_pi_runner --auto-approve "$@"
}

pi() {
  _fake_pi_runner --approve "$@"
}

export -f _fake_pi_runner omp pi

assert_runner() {
  local tool="$1" output
  output=$(RALPH_I_UNDERSTAND_DANGEROUS=1 \
    RALPH_PRD_FILE=/dev/null \
    RALPH_PROGRESS_FILE=/dev/null \
    "$REPO_ROOT/ralph.sh" --tool "$tool" 1)
  grep -q "Starting Ralph - Tool: $tool" <<< "$output"
  grep -q 'session: "runner-t (/tmp)"' <<< "$output"
  grep -q 'Ralph completed all tasks!' <<< "$output"
}

bash -n "$REPO_ROOT/ralph.sh"
for file in "$REPO_ROOT"/scripts/bash/*.sh; do
  bash -n "$file"
done

assert_runner omp
assert_runner pi

echo "Ralph loop regression tests passed."
