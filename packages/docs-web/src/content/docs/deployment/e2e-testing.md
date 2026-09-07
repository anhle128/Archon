---
title: E2E Testing
description: Set up chrome-devtools-axi for live agent-driven browser testing in Archon workflows.
category: deployment
area: infra
audience: [developer, operator]
status: current
sidebar:
  order: 5
---

Archon has two browser layers. Do not mix them up:

| Layer | Tool | Role |
|-------|------|------|
| Live agent UI | [chrome-devtools-axi](https://github.com/kunchenguid/chrome-devtools-axi) | `archon-validate-pr` E2E commands, `validate-ui`, `replicate-issue` |
| Merge / regression | Playwright (`e2e/`, `pr-e2e-verify`) | Durable committed specs. **Unchanged** — do not convert to AXI |

AXI is an **optional** external dependency for live agent-driven flows. Core Archon and Playwright gates work without it.

**Migration:** this fork removed Vercel Labs `agent-browser`. Do not install or invoke `agent-browser`. Isolation is `CHROME_DEVTOOLS_AXI_SESSION=$WORKFLOW_ID`, not `--session`.

## Installation

```bash
# Zero install — recommended
npx -y chrome-devtools-axi --help

# Optional global install
npm install -g chrome-devtools-axi
```

Needs a local Chrome (or Chromium). Do not use `bunx`.

## Verify

```bash
npx -y chrome-devtools-axi --version

# Smoke test — open a page, then stop this session's bridge
npx -y chrome-devtools-axi open https://example.com
npx -y chrome-devtools-axi stop
```

## Where It's Used

| Resource | Type | Purpose |
|----------|------|---------|
| `archon-validate-pr` | Workflow | E2E testing phase of PR validation |
| `validate-ui` | Skill | Comprehensive UI testing |
| `replicate-issue` | Skill | Issue reproduction via browser |
| `archon-create-issue` | Workflow | web-ui reproduction playbook |
| `archon-validate-pr-e2e-main.md` | Command | E2E tests against the main branch |
| `archon-validate-pr-e2e-feature.md` | Command | E2E tests against the feature branch |

Playwright `e2e/` and `pr-e2e-verify` do **not** use AXI.

## Parallel sessions

AXI has no `--session` flag. Each named session gets its own bridge, derived port, and (in the default isolated launch) its own Chrome:

```bash
export CHROME_DEVTOOLS_AXI_SESSION="$WORKFLOW_ID"
npx -y chrome-devtools-axi open http://localhost:5173
# ...
npx -y chrome-devtools-axi stop
```

Do **not** export `CHROME_DEVTOOLS_AXI_PORT` when running concurrent sessions — it forces every session onto one port and the second run fails to bind.

## Platform-Specific Notes

### Docker

`chrome-devtools-axi` and Node are **pre-installed** in the Archon Docker image. System Chromium is wired via `PUPPETEER_EXECUTABLE_PATH`. Container Chrome flags (`--no-sandbox`) are set with `CHROME_DEVTOOLS_AXI_CHROME_ARGS`. No extra install step.

### macOS / Linux

Works natively after the commands above. If a stale bridge is stuck:

```bash
npx -y chrome-devtools-axi stop
npx -y chrome-devtools-axi open http://localhost:3090
```

Do not `pkill chrome` or `pkill node`.

### Windows

AXI talks to its bridge over HTTP (`localhost:9224` by default, or a per-session derived port). It does **not** use the Unix-domain-socket daemon that made `agent-browser` fail on Windows.

Try AXI natively on Windows first. The [E2E Testing on WSL](/deployment/e2e-testing-wsl/) page is only for the optional topology where Chrome runs inside WSL and the Archon dev servers run on Windows.

## Running Without AXI

If AXI is not installed and `npx` cannot fetch it, live E2E workflow nodes fail when the agent tries to invoke the CLI. The agent is instructed (via prompt) to stop after 2 failed connection attempts and produce a code-review-only report — a prompt-level instruction, not automated workflow logic.

You can safely run all non-E2E workflows without AXI. Playwright `e2e/` does not need it.
