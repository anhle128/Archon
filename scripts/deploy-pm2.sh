#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

APP_NAME="${ARCHON_PM2_NAME:-archon}"
ECOSYSTEM_FILE="${ARCHON_PM2_ECOSYSTEM:-$ROOT_DIR/ecosystem.pm2.config.cjs}"
RUN_COMPOSE=1
BUILD_WEB=1
RUN_STARTUP=0
SAVE_PM2=1
COMPOSE_PROFILES="${ARCHON_PM2_COMPOSE_PROFILES:-}"
COMPOSE_SERVICES="${ARCHON_PM2_COMPOSE_SERVICES:-}"

usage() {
  cat <<'USAGE'
Usage: scripts/deploy-pm2.sh [options]

Runs Archon on the host with PM2 so agent subprocesses can use host-native
CLI tools (claude, codex, git, gh), while optional sidecar services continue
to run through Docker Compose.

Options:
  --with-db        Start the compose postgres service with profile "with-db".
  --with-auth      Start the compose auth-service with profile "auth".
  --no-compose     Do not run Docker Compose services.
  --no-build       Skip bun install and web build.
  --no-save        Skip "pm2 save".
  --startup        Run "pm2 startup" after starting the app.
  -h, --help       Show this help.

Environment:
  ARCHON_PM2_NAME               PM2 app name. Default: archon
  ARCHON_BUN_BIN                Absolute path to bun if it is not on PATH.
  ARCHON_PM2_COMPOSE_PROFILES   Extra compose profiles, space separated.
  ARCHON_PM2_COMPOSE_SERVICES   Extra compose services, space separated.
  ARCHON_PM2_ECOSYSTEM          Ecosystem config path.

Notes:
  - If DATABASE_URL in .env starts with postgresql:// or postgres://, postgres
    is started automatically unless --no-compose is used.
  - For host PM2 + compose postgres, DATABASE_URL should point to localhost,
    for example:
      postgresql://postgres:postgres@localhost:5432/remote_coding_agent
  - This script stops compose services named "app" and "dev" before PM2 starts
    so they do not fight the host service for PORT.
  - This script never runs "docker compose down -v", "docker volume rm", or any
    other volume/database reset. Deploys must preserve existing history.
USAGE
}

add_word() {
  local current="$1"
  local word="$2"
  case " $current " in
    *" $word "*) printf '%s' "$current" ;;
    *) printf '%s' "${current:+$current }$word" ;;
  esac
}

get_env_value() {
  local key="$1"
  if [ ! -f .env ]; then
    return 1
  fi
  awk -F= -v key="$key" '
    $1 == key {
      value = substr($0, length(key) + 2)
      sub(/^[[:space:]]+/, "", value)
      sub(/[[:space:]]+$/, "", value)
      gsub(/^"|"$/, "", value)
      gsub(/^'\''|'\''$/, "", value)
      print value
      exit
    }
  ' .env
}

require_command() {
  local cmd="$1"
  local hint="$2"
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "Missing required command: $cmd" >&2
    echo "$hint" >&2
    exit 1
  fi
}

resolve_bun() {
  local bun_bin="${ARCHON_BUN_BIN:-}"
  if [ -n "$bun_bin" ] && [ -x "$bun_bin" ]; then
    printf '%s' "$bun_bin"
    return 0
  fi
  bun_bin="$(command -v bun || true)"
  if [ -n "$bun_bin" ]; then
    printf '%s' "$bun_bin"
    return 0
  fi
  for candidate in "$HOME/.bun/bin/bun" /opt/homebrew/bin/bun /usr/local/bin/bun; do
    if [ -x "$candidate" ]; then
      printf '%s' "$candidate"
      return 0
    fi
  done
  return 1
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --with-db)
      COMPOSE_PROFILES="$(add_word "$COMPOSE_PROFILES" with-db)"
      COMPOSE_SERVICES="$(add_word "$COMPOSE_SERVICES" postgres)"
      ;;
    --with-auth)
      COMPOSE_PROFILES="$(add_word "$COMPOSE_PROFILES" auth)"
      COMPOSE_SERVICES="$(add_word "$COMPOSE_SERVICES" auth-service)"
      ;;
    --no-compose)
      RUN_COMPOSE=0
      ;;
    --no-build)
      BUILD_WEB=0
      ;;
    --no-save)
      SAVE_PM2=0
      ;;
    --startup)
      RUN_STARTUP=1
      ;;
    -h | --help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      usage >&2
      exit 1
      ;;
  esac
  shift
done

require_command docker "Install Docker Desktop or Docker Engine first."
require_command pm2 "Install PM2 first, for example: npm install -g pm2"

if ! BUN_BIN="$(resolve_bun)"; then
  echo "Missing required command: bun" >&2
  echo "Install Bun first: https://bun.sh" >&2
  echo "Or run with ARCHON_BUN_BIN=/absolute/path/to/bun scripts/deploy-pm2.sh" >&2
  exit 1
fi
export ARCHON_BUN_BIN="$BUN_BIN"
export PATH="$(dirname "$BUN_BIN"):$PATH"

if [ ! -f .env ]; then
  echo "Missing .env. Create it from .env.example and set your local credentials." >&2
  exit 1
fi

DATABASE_URL="$(get_env_value DATABASE_URL || true)"
if [ "$RUN_COMPOSE" -eq 1 ] && [ -n "$DATABASE_URL" ]; then
  case "$DATABASE_URL" in
    postgresql://* | postgres://*)
      COMPOSE_PROFILES="$(add_word "$COMPOSE_PROFILES" with-db)"
      COMPOSE_SERVICES="$(add_word "$COMPOSE_SERVICES" postgres)"
      ;;
  esac
  case "$DATABASE_URL" in
    *@postgres:*)
      echo "Warning: DATABASE_URL uses host 'postgres'. Host PM2 cannot resolve Docker DNS." >&2
      echo "Use localhost instead for PM2, e.g. postgresql://postgres:postgres@localhost:5432/remote_coding_agent" >&2
      ;;
  esac
fi

echo "Stopping compose app/dev containers if they exist..."
# Data safety: use stop, not down. Never remove Docker volumes here; postgres
# data and any previous Docker-side SQLite data must survive every deploy.
docker compose stop app dev >/dev/null 2>&1 || true

if [ "$RUN_COMPOSE" -eq 1 ] && [ -n "$COMPOSE_SERVICES" ]; then
  compose_cmd=(docker compose)
  for profile in $COMPOSE_PROFILES; do
    compose_cmd+=(--profile "$profile")
  done
  compose_cmd+=(up -d)
  for service in $COMPOSE_SERVICES; do
    compose_cmd+=("$service")
  done
  echo "Starting compose services: $COMPOSE_SERVICES"
  "${compose_cmd[@]}"
elif [ "$RUN_COMPOSE" -eq 1 ]; then
  echo "No compose sidecar services selected. Skipping Docker Compose startup."
  if [ -z "$DATABASE_URL" ]; then
    echo "SQLite mode: PM2 will use host data under ~/.archon, not Docker volumes."
    echo "Existing Docker volumes are preserved but are not used by the host PM2 process."
  fi
else
  echo "Docker Compose startup disabled."
fi

if [ "$BUILD_WEB" -eq 1 ]; then
  echo "Installing dependencies..."
  "$BUN_BIN" install --frozen-lockfile --linker=hoisted

  echo "Building web UI..."
  "$BUN_BIN" run build:web

  echo "Preparing local Codex auth if CODEX_* env vars are configured..."
  "$BUN_BIN" run setup-auth
fi

echo "Starting Archon with PM2..."
if pm2 describe "$APP_NAME" >/dev/null 2>&1; then
  pm2 restart "$ECOSYSTEM_FILE" --update-env
else
  pm2 start "$ECOSYSTEM_FILE" --update-env
fi

if [ "$SAVE_PM2" -eq 1 ]; then
  pm2 save
fi

if [ "$RUN_STARTUP" -eq 1 ]; then
  echo "Configuring PM2 startup. You may be prompted for sudo depending on your OS."
  pm2 startup
fi

PORT="$(get_env_value PORT || true)"
PORT="${PORT:-3090}"
HEALTH_URL="http://127.0.0.1:$PORT/api/health"
UI_URL="http://127.0.0.1:$PORT/"

echo "Waiting for Archon health check: $HEALTH_URL"
for _ in $(seq 1 30); do
  if curl -fsS "$HEALTH_URL" >/dev/null 2>&1; then
    echo "Archon is healthy."
    echo "Open Archon at: $UI_URL"
    pm2 status "$APP_NAME"
    exit 0
  fi
  sleep 1
done

echo "Archon did not become healthy within 30 seconds." >&2
echo "Check logs with: pm2 logs $APP_NAME" >&2
exit 1
