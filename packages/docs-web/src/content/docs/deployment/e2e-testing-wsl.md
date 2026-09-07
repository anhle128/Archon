---
title: E2E Testing on WSL
description: Optional WSL topology for chrome-devtools-axi when Chrome runs in WSL and Archon servers run on Windows.
category: deployment
area: infra
audience: [developer]
status: current
sidebar:
  order: 6
---

[chrome-devtools-axi](https://github.com/kunchenguid/chrome-devtools-axi) uses an HTTP bridge (default port 9224, or a per-session derived port). It does **not** need the old `agent-browser` WSL workaround for [Unix-domain sockets on Windows](https://github.com/vercel-labs/agent-browser/issues/56).

**Prefer native Windows first.** See the [E2E Testing Guide](/deployment/e2e-testing/).

Use this page only when Chrome must run **inside WSL** while the Archon backend/frontend stay on Windows. Typical reason: WSL has the only working Chrome/Chromium, or you already bind the dev servers to `0.0.0.0` for WSL access.

> Playwright `e2e/` and `pr-e2e-verify` are a separate merge gate. This page is only for live AXI flows.

## Prerequisites

- WSL2 with Ubuntu (`wsl --list --verbose`)
- Node.js in WSL so `npx -y chrome-devtools-axi` works
- Chrome or Chromium in WSL

## Setup

### 1. Find the Windows host IP accessible from WSL

```bash
ipconfig | findstr "IPv4" | findstr "WSL"
# Example output: IPv4 Address. . . . . . . . . . . : 172.18.64.1
```

Or from inside WSL:

```bash
wsl -d Ubuntu -- bash -c "cat /etc/resolv.conf | grep nameserver"
```

### 2. Start dev servers on Windows (bound to all interfaces)

```bash
# Backend (Hono on port 3090) - already binds to 0.0.0.0 by default
bun run dev:server &

# Frontend (Vite on port 5173) - needs --host flag
cd packages/web && bun x vite --host 0.0.0.0 &
```

### 3. Verify WSL can reach the servers

```bash
wsl -d Ubuntu -- curl -s http://172.18.64.1:3090/api/health
wsl -d Ubuntu -- curl -s -o /dev/null -w "%{http_code}" http://172.18.64.1:5173
```

## Running AXI from WSL

Prefix commands from the Windows terminal, or run them inside WSL. Keep `CHROME_DEVTOOLS_AXI_SESSION` set if another AXI run might be active:

```bash
wsl -d Ubuntu -- env CHROME_DEVTOOLS_AXI_SESSION=wsl-ui \
  npx -y chrome-devtools-axi open http://172.18.64.1:5173

wsl -d Ubuntu -- env CHROME_DEVTOOLS_AXI_SESSION=wsl-ui \
  npx -y chrome-devtools-axi snapshot

wsl -d Ubuntu -- env CHROME_DEVTOOLS_AXI_SESSION=wsl-ui \
  npx -y chrome-devtools-axi click @g1:1

wsl -d Ubuntu -- env CHROME_DEVTOOLS_AXI_SESSION=wsl-ui \
  npx -y chrome-devtools-axi fill @g1:2 "some text"

wsl -d Ubuntu -- env CHROME_DEVTOOLS_AXI_SESSION=wsl-ui \
  npx -y chrome-devtools-axi wait 3000

wsl -d Ubuntu -- env CHROME_DEVTOOLS_AXI_SESSION=wsl-ui \
  npx -y chrome-devtools-axi stop
```

Pass refs exactly as printed (`@g1:1`). On `STALE_REF`, re-snapshot — do not reuse the old ref.

## Screenshots

Save to a WSL-native path first, then copy to the Windows filesystem via `/mnt/c/`:

```bash
wsl -d Ubuntu -- bash -c '
  CHROME_DEVTOOLS_AXI_SESSION=wsl-ui npx -y chrome-devtools-axi screenshot /home/user/screenshot.png &&
  cp /home/user/screenshot.png /path/to/archon/e2e-screenshots/my-test.png
'
```

Then Read the copied file. Saving straight to `/mnt/c/...` can still confuse path translation in some shells.

## Gotchas

- **`localhost` doesn't work from WSL2** — use the Windows host IP
- **Vite must bind to `0.0.0.0`** — default `localhost` isn't reachable from WSL
- **Git Bash path expansion** — `/status` gets expanded to `C:/Program Files/Git/status` when passed through Git Bash
- **SSE `Connected` indicator** — only shows for `web` platform conversations; Telegram/Slack conversations show `Disconnected` (expected)
- **Stale bridge** — `npx -y chrome-devtools-axi stop` for that session, then retry `open`. Do not `pkill chrome` or `pkill node`
