---
name: agent-browser
description: >
  Deprecated redirect. Vercel Labs agent-browser is removed in this Archon
  fork. Use chrome-devtools-axi for live agent-driven browser automation.
---

# agent-browser is removed

This fork no longer uses [Vercel Labs agent-browser](https://github.com/vercel-labs/agent-browser).

**Use `/chrome-devtools-axi` (skill `chrome-devtools-axi`) and `npx -y chrome-devtools-axi`.**

Do not install or invoke `agent-browser`. Parallel isolation is `CHROME_DEVTOOLS_AXI_SESSION=$WORKFLOW_ID`, not `--session`. Cleanup is `chrome-devtools-axi stop` for that session, not `agent-browser close`.

Playwright `e2e/` and `pr-e2e-verify` are unchanged and are not AXI.
