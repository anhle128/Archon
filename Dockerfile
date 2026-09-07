# =============================================================================
# Archon - Remote Agentic Coding Platform
# Multi-stage build: deps → web build → production image
# =============================================================================

# ---------------------------------------------------------------------------
# Stage 1: Install dependencies
# ---------------------------------------------------------------------------
FROM oven/bun:1.3.11-slim AS deps

WORKDIR /app

# Copy root package files and lockfile
COPY package.json bun.lock ./

# Copy ALL workspace package.json files (monorepo lockfile depends on all of them)
COPY packages/adapters/package.json ./packages/adapters/
COPY packages/cli/package.json ./packages/cli/
COPY packages/core/package.json ./packages/core/
# docs-web source is NOT copied — it's a static site deployed separately
# (see .github/workflows/deploy-docs.yml). package.json is included only
# so Bun's workspace lockfile resolves correctly.
COPY packages/docs-web/package.json ./packages/docs-web/
COPY packages/git/package.json ./packages/git/
COPY packages/isolation/package.json ./packages/isolation/
COPY packages/paths/package.json ./packages/paths/
COPY packages/providers/package.json ./packages/providers/
COPY packages/server/package.json ./packages/server/
COPY packages/web/package.json ./packages/web/
COPY packages/workflows/package.json ./packages/workflows/

# Install ALL dependencies (including devDependencies needed for web build)
# --linker=hoisted: Bun's default "isolated" linker stores packages in
# node_modules/.bun/ with symlinks that Vite/Rollup cannot resolve during
# production builds. Hoisted layout gives classic flat node_modules.
RUN bun install --frozen-lockfile --linker=hoisted

# ---------------------------------------------------------------------------
# Stage 2: Build web UI (Vite + React)
# ---------------------------------------------------------------------------
FROM deps AS web-build

# Copy full source (needed for workspace resolution and web build)
COPY . .

# Build the web frontend — output goes to packages/web/dist/
RUN bun run build:web && \
    test -f packages/web/dist/index.html || \
    (echo "ERROR: Web build produced no index.html" >&2 && exit 1)

# ---------------------------------------------------------------------------
# Stage 3: Production image
# ---------------------------------------------------------------------------
FROM oven/bun:1.3.11-slim AS production

# OCI Labels for GHCR
LABEL org.opencontainers.image.source="https://github.com/coleam00/Archon"
LABEL org.opencontainers.image.description="Control AI coding assistants remotely from Telegram, Slack, Discord, and GitHub"
LABEL org.opencontainers.image.licenses="MIT"

# Prevent interactive prompts during installation
ENV DEBIAN_FRONTEND=noninteractive

WORKDIR /app

# Install system dependencies + gosu for privilege dropping in entrypoint
RUN apt-get update && apt-get install -y \
    curl \
    git \
    bash \
    ca-certificates \
    gnupg \
    gosu \
    postgresql-client \
    # ripgrep + jq: expected by Claude Code / Codex agents (rg is their default
    # code-search tool; jq powers JSON handling in bash workflow nodes) — see #1836
    ripgrep \
    jq \
    # Chromium for chrome-devtools-axi E2E (CDP via chrome-devtools-mcp)
    chromium \
    && rm -rf /var/lib/apt/lists/*

# Install GitHub CLI
RUN curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg | dd of=/usr/share/keyrings/githubcli-archive-keyring.gpg \
    && chmod go+r /usr/share/keyrings/githubcli-archive-keyring.gpg \
    && echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" | tee /etc/apt/sources.list.d/github-cli.list > /dev/null \
    && apt-get update \
    && apt-get install -y gh \
    && rm -rf /var/lib/apt/lists/*

# chrome-devtools-axi is a Node CLI (wraps chrome-devtools-mcp). Keep nodejs/npm —
# unlike the old agent-browser native binary, AXI cannot run after purging Node.
# Agents may call `chrome-devtools-axi` (global) or `npx -y chrome-devtools-axi`.
# Preinstall chrome-devtools-mcp and pin CHROME_DEVTOOLS_AXI_MCP_PATH so each
# session skips a cold `npx` of the MCP server. npm's global prefix varies by
# distro, so resolve it at build time and symlink to a stable path.
RUN apt-get update && apt-get install -y --no-install-recommends nodejs npm \
    && npm install -g chrome-devtools-axi chrome-devtools-mcp \
    && MCP_JS="$(npm prefix -g)/lib/node_modules/chrome-devtools-mcp/build/src/bin/chrome-devtools-mcp.js" \
    && test -f "$MCP_JS" \
    && ln -sf "$MCP_JS" /usr/local/lib/chrome-devtools-mcp.js \
    && npm cache clean --force \
    && rm -rf /var/lib/apt/lists/*

# Point Puppeteer/MCP at system Chromium; container Chrome needs --no-sandbox.
# AXI has no --session flag: parallel runs set CHROME_DEVTOOLS_AXI_SESSION instead.
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium
ENV CHROME_DEVTOOLS_AXI_CHROME_ARGS="--no-sandbox --disable-dev-shm-usage --disable-gpu"
ENV CHROME_DEVTOOLS_AXI_MCP_PATH=/usr/local/lib/chrome-devtools-mcp.js

# CLAUDE_BIN_PATH is set at container startup (docker-entrypoint.sh).
# The entrypoint pins the glibc variant to bypass the SDK's musl-first resolver.

# Create non-root user for running Claude Code
# Claude Code refuses to run with --dangerously-skip-permissions as root for security
# /app is still empty here (only WORKDIR created it) — non-recursive chown suffices.
RUN useradd -m -u 1001 -s /bin/bash appuser \
    && chown appuser:appuser /app

# Create Archon directories
RUN mkdir -p /.archon/workspaces /.archon/worktrees \
    && chown -R appuser:appuser /.archon

# A trailing `RUN chown -R /app` would duplicate every inode into a new image layer (#1970).
USER appuser

# Copy root package files and lockfile
COPY --chown=appuser:appuser package.json bun.lock ./

# Copy ALL workspace package.json files
COPY --chown=appuser:appuser packages/adapters/package.json ./packages/adapters/
COPY --chown=appuser:appuser packages/cli/package.json ./packages/cli/
COPY --chown=appuser:appuser packages/core/package.json ./packages/core/
# docs-web source is NOT copied — it's a static site deployed separately
# (see .github/workflows/deploy-docs.yml). package.json is included only
# so Bun's workspace lockfile resolves correctly.
COPY --chown=appuser:appuser packages/docs-web/package.json ./packages/docs-web/
COPY --chown=appuser:appuser packages/git/package.json ./packages/git/
COPY --chown=appuser:appuser packages/isolation/package.json ./packages/isolation/
COPY --chown=appuser:appuser packages/paths/package.json ./packages/paths/
COPY --chown=appuser:appuser packages/providers/package.json ./packages/providers/
COPY --chown=appuser:appuser packages/server/package.json ./packages/server/
COPY --chown=appuser:appuser packages/web/package.json ./packages/web/
COPY --chown=appuser:appuser packages/workflows/package.json ./packages/workflows/

# Install production dependencies only (--ignore-scripts skips husky prepare hook).
# Cache goes to /tmp and is removed in the same layer: not baked into the image,
# not copied into the /home/appuser volume on first run.
RUN HOME=/home/appuser BUN_INSTALL_CACHE_DIR=/tmp/bun-install-cache \
      bun install --frozen-lockfile --production --ignore-scripts --linker=hoisted \
    && rm -rf /tmp/bun-install-cache

# Copy application source (Bun runs TypeScript directly, no compile step needed)
COPY --chown=appuser:appuser packages/adapters/ ./packages/adapters/
COPY --chown=appuser:appuser packages/cli/ ./packages/cli/
COPY --chown=appuser:appuser packages/core/ ./packages/core/
COPY --chown=appuser:appuser packages/git/ ./packages/git/
COPY --chown=appuser:appuser packages/isolation/ ./packages/isolation/
COPY --chown=appuser:appuser packages/paths/ ./packages/paths/
COPY --chown=appuser:appuser packages/providers/ ./packages/providers/
COPY --chown=appuser:appuser packages/server/ ./packages/server/
COPY --chown=appuser:appuser packages/workflows/ ./packages/workflows/

# Copy pre-built web UI from build stage
COPY --from=web-build --chown=appuser:appuser /app/packages/web/dist/ ./packages/web/dist/

# Copy config, migrations, and bundled defaults
COPY --chown=appuser:appuser .archon/ ./.archon/
COPY --chown=appuser:appuser migrations/ ./migrations/
COPY --chown=appuser:appuser tsconfig*.json ./

# Back to root: the entrypoint must start as root to fix volume ownership,
# and the gosu git-config setup below requires it.
USER root

# Create .codex directory for Codex authentication
RUN mkdir -p /home/appuser/.codex && chown appuser:appuser /home/appuser/.codex

# Configure git to trust Archon directories (as appuser)
RUN gosu appuser git config --global --add safe.directory '/.archon/workspaces' && \
    gosu appuser git config --global --add safe.directory '/.archon/workspaces/*' && \
    gosu appuser git config --global --add safe.directory '/.archon/worktrees' && \
    gosu appuser git config --global --add safe.directory '/.archon/worktrees/*'

# Copy entrypoint script (fixes volume permissions, drops to appuser)
# sed strips Windows CRLF in case .gitattributes eol=lf was bypassed
COPY docker-entrypoint.sh /usr/local/bin/
RUN sed -i 's/\r$//' /usr/local/bin/docker-entrypoint.sh \
    && chmod +x /usr/local/bin/docker-entrypoint.sh

# Default port (matches .env.example PORT=3000)
EXPOSE 3000

ENTRYPOINT ["docker-entrypoint.sh"]
