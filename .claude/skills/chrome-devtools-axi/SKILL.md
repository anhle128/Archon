---
name: chrome-devtools-axi
description: >
  Control a real Chrome session through chrome-devtools-axi for Archon UI
  testing, form filling, screenshots, and issue reproduction. Use whenever a
  task needs a live browser: opening or testing a web page, clicking through a
  flow, extracting page content, debugging console/network, or judging UX from
  screenshots. Prefer this over agent-browser (removed in this fork) and over
  Playwright for live agent-driven flows. Playwright remains the durable
  e2e/ + pr-e2e-verify merge gate — do not convert those to AXI.
---

# Browser automation with chrome-devtools-axi

[chrome-devtools-axi](https://github.com/kunchenguid/chrome-devtools-axi) wraps [chrome-devtools-mcp](https://www.npmjs.com/package/chrome-devtools-mcp) in an agent-ergonomic CLI.

It is an **optional** external tool — needed only for live agent-driven UI flows (`archon-validate-pr` E2E commands, `validate-ui`, `replicate-issue`, `archon-create-issue` web-ui playbook). Core Archon and Playwright `e2e/` / `pr-e2e-verify` do not depend on it.

**Live CLI is the source of truth** for flags and new commands:

```bash
npx -y chrome-devtools-axi --help
npx -y chrome-devtools-axi <command> --help
```

If AXI output suggests a follow-up starting with `chrome-devtools-axi`, run it as `npx -y chrome-devtools-axi ...` unless the CLI is already on `PATH` (Docker image).

Do **not** use `agent-browser`. That tool is removed in this fork.

## Installation

```bash
# Zero install — recommended
npx -y chrome-devtools-axi --help

# Optional global install
npm install -g chrome-devtools-axi
```

Needs a local Chrome (or Chromium). The Archon Docker image preinstalls the CLI, Node, and system Chromium.

**Do not use `bunx`** for this package. Invoke with `npx -y` or a global `chrome-devtools-axi` binary.

## Session isolation (parallel validate-pr)

AXI has **no** `--session` flag. Isolation is an env var: `CHROME_DEVTOOLS_AXI_SESSION`.

Each session name gets its own bridge process, derived port, on-disk state under `~/.chrome-devtools-axi/sessions/<name>/`, and (in the default isolated launch mode) its own Chrome. That is the equivalent of the old `agent-browser --session $WORKFLOW_ID` pattern.

```bash
# Set once per workflow / test worker — do not export CHROME_DEVTOOLS_AXI_PORT
export CHROME_DEVTOOLS_AXI_SESSION="$WORKFLOW_ID"
axi() { npx -y chrome-devtools-axi "$@"; }

axi open "http://localhost:$FRONTEND_PORT"
axi snapshot
axi click @g1:1
axi screenshot "$ARTIFACTS_DIR/step.png"
axi stop    # stops THIS session's bridge + Chrome only
```

Rules:

- On every AXI command in `archon-validate-pr` (and any other parallel run), `CHROME_DEVTOOLS_AXI_SESSION` must be `$WORKFLOW_ID`.
- Persist the id to `$ARTIFACTS_DIR/.browser-session` so cleanup nodes can stop the same session.
- **Never** export `CHROME_DEVTOOLS_AXI_PORT` globally. It overrides the per-session derived port and makes the second parallel run fail to bind.
- `axi stop` without a session env stops the **default** session (port 9224), not other named sessions — still do not call it unless you own that session.
- Do **not** `pkill chrome`, `pkill chromium`, `pkill node`, or `taskkill //IM chrome.exe`. That kills the user's browser and other workflows.

If two runs attach to the **same** already-running Chrome (`CHROME_DEVTOOLS_AXI_AUTO_CONNECT=1` or the same `CHROME_DEVTOOLS_AXI_BROWSER_URL`), they share that browser and are isolated only at the bridge. Archon validate-pr uses the default isolated launch, so each `$WORKFLOW_ID` gets its own Chrome. Do not set `AUTO_CONNECT` / `BROWSER_URL` in those workflows.

## Core workflow

1. `open <url>` — navigates **and** returns a snapshot with refs
2. Interact with refs **exactly** as printed (`@g1:1`, not `@e1`)
3. Re-`snapshot` after navigation, submits, or any significant DOM change
4. `screenshot` then **Read the image** before judging UX or claiming a bug is fixed
5. Verify state-changing actions with a fresh snapshot, `eval`, or screenshot — a current ref can still produce no visible change
6. `stop` this session when done

```bash
npx -y chrome-devtools-axi open http://localhost:5173
npx -y chrome-devtools-axi snapshot
npx -y chrome-devtools-axi click @g1:1
npx -y chrome-devtools-axi fill @g1:2 "text"
npx -y chrome-devtools-axi screenshot /tmp/archon-ui.png
# Read /tmp/archon-ui.png with the Read tool
npx -y chrome-devtools-axi stop
```

## Stale refs

Refs carry a `g:` generation prefix that increments on every new accessibility tree. Pass them back **exactly** as printed.

UID actions fail loud with `STALE_REF` when the page mutated since that snapshot (or when the ref is an untagged legacy id). Do **not** retry the same ref. Re-snapshot and use the new ids.

Re-snapshot when:

- `open` / `back` / a click navigated
- a form submit or dialog changed the page
- you get `STALE_REF`
- more than a few interactions have passed and you are unsure the tree is current

## Commands (Archon subset)

`open` already snapshots. There is no `snapshot -i`. There is no `close` — use `stop` for the session or `closepage` for one tab. There is no `wait --load networkidle` — use `wait <ms>` or `wait <text>`.

### Navigation and page

```bash
npx -y chrome-devtools-axi open <url>
npx -y chrome-devtools-axi snapshot
npx -y chrome-devtools-axi screenshot path.png
npx -y chrome-devtools-axi screenshot path.png --full-page
npx -y chrome-devtools-axi scroll down
npx -y chrome-devtools-axi back
npx -y chrome-devtools-axi wait 2000
npx -y chrome-devtools-axi wait "Healthy"
npx -y chrome-devtools-axi eval "document.title"
```

### Interaction

```bash
npx -y chrome-devtools-axi click @g1:1
npx -y chrome-devtools-axi fill @g1:2 "text"
npx -y chrome-devtools-axi type "text"
npx -y chrome-devtools-axi press Enter
npx -y chrome-devtools-axi hover @g1:1
npx -y chrome-devtools-axi dialog accept
npx -y chrome-devtools-axi upload @g1:1 ./file.pdf
```

### Tabs, viewport, debug

```bash
npx -y chrome-devtools-axi pages
npx -y chrome-devtools-axi newpage <url>
npx -y chrome-devtools-axi selectpage <id>
npx -y chrome-devtools-axi closepage <id>
npx -y chrome-devtools-axi resize 1920 1080
npx -y chrome-devtools-axi emulate --viewport 375x812
npx -y chrome-devtools-axi console
npx -y chrome-devtools-axi console --type error
npx -y chrome-devtools-axi network
```

### Bridge

```bash
npx -y chrome-devtools-axi start
npx -y chrome-devtools-axi stop
```

For the full command list (lighthouse, perf-*, heap, fillform, drag), use `--help`.

## Screenshots as UX evidence

1. Save to a real path (`$ARTIFACTS_DIR/...` in workflows, `/tmp/...` in ad-hoc skills)
2. **Read the file** with the Read tool — do not describe the UI from the snapshot text alone
3. Compare before/after (or main vs feature) side by side

## Failures

If AXI cannot start or connect after **2** attempts, stop retrying. Do not escalate to killing Chrome/Node. Skip browser E2E, keep code-review findings, and say AXI was unavailable.

Stale bridge: `CHROME_DEVTOOLS_AXI_SESSION=$WORKFLOW_ID npx -y chrome-devtools-axi stop` then retry `open`. Do not `pkill` the default bridge of another session.

## Docker

The image installs `chrome-devtools-axi` globally, keeps Node (required), and points Puppeteer at system Chromium with container Chrome flags (`--no-sandbox`). Agents inside the container may call `chrome-devtools-axi` or `npx -y chrome-devtools-axi`.

## Playwright vs AXI

| Layer | Tool | Role |
|-------|------|------|
| Live agent UI | chrome-devtools-axi | validate-pr E2E commands, validate-ui, replicate-issue |
| Merge / regression | Playwright `e2e/`, `pr-e2e-verify` | Durable committed specs — **do not convert to AXI** |
