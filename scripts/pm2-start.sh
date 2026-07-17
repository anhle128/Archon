#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

# PM2 injects NODE_APP_INSTANCE into managed processes. Only manual invocations
# should deploy; a PM2 child must start the server directly to avoid recursion.
if [ -z "${NODE_APP_INSTANCE:-}" ]; then
  exec "$ROOT_DIR/scripts/deploy-pm2.sh" "$@"
fi

BUN_BIN="${ARCHON_BUN_BIN:-}"
if [ -z "$BUN_BIN" ]; then
  BUN_BIN="$(command -v bun || true)"
fi
if [ -z "$BUN_BIN" ]; then
  for candidate in "$HOME/.bun/bin/bun" /opt/homebrew/bin/bun /usr/local/bin/bun; do
    if [ -x "$candidate" ]; then
      BUN_BIN="$candidate"
      break
    fi
  done
fi
if [ -z "$BUN_BIN" ]; then
  echo "bun not found. Install Bun or set ARCHON_BUN_BIN=/absolute/path/to/bun." >&2
  exit 127
fi
export ARCHON_BUN_BIN="$BUN_BIN"
export PATH="$(dirname "$BUN_BIN"):$PATH"

exec "$BUN_BIN" run start
