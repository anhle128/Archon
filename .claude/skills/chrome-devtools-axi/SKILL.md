---
name: chrome-devtools-axi
description: >-
  Drive a real Chrome session through the chrome-devtools-axi CLI (open,
  snapshot, click/fill, screenshot). Use for live UI authoring in
  plan-tests / web-automation-test-pr — not as a replacement for committed
  Playwright specs. Triggers: "chrome-devtools-axi", "AXI browser", "live
  UI drive", "screenshot evidence".
user-invocable: false
---

# chrome-devtools-axi

Thin Archon skill for the **live authoring drive** (Mode B: drive once → crystallize
Playwright). Command flags evolve upstream — treat `npx -y chrome-devtools-axi --help`
(and `npx -y chrome-devtools-axi <cmd> --help`) as the current CLI source of truth.
If AXI output suggests a follow-up starting with `chrome-devtools-axi`, re-run it as
`npx -y chrome-devtools-axi ...`.

This skill does **not** replace `e2e/` Playwright (`npm run test:ui`). Do not use it
to rewrite `archon-validate-pr-e2e-*`, `validate-ui`, or `replicate-issue`.

## Invoke

```bash
npx -y chrome-devtools-axi <command> ...
```

No global install required.

## Session isolation (parallel runs)

Set a unique session on **every** AXI command so concurrent worktrees/agents do not
share a bridge, port, or stale-ref generation counter:

```bash
export CHROME_DEVTOOLS_AXI_SESSION="${WORKFLOW_ID:-plan-tests}"
npx -y chrome-devtools-axi open "http://127.0.0.1:<port>/"
```

- Do **not** export `CHROME_DEVTOOLS_AXI_PORT` globally — it collapses every named
  session onto one port and the second run fails.
- Session names must be 1–64 chars from `[A-Za-z0-9._-]`. `$WORKFLOW_ID` is safe.
- Default (unset) session uses port 9224 and the legacy `~/.chrome-devtools-axi/` paths.

## Drive loop

1. `open <url>` — navigate; output includes an accessibility snapshot with `uid=` refs.
2. `snapshot` — re-orient after navigation or a significant DOM change.
3. `click @<uid>` / `fill @<uid> <text>` — pass refs **exactly** as printed (include the
   `g:` generation prefix). Do not invent refs.
4. `screenshot <path>` — write a PNG (or `--format` from `--help`) to a real file.
5. After a state-changing action, confirm with a fresh `snapshot`, `eval`, or
   `screenshot` before claiming success.

## STALE_REF

If a click/fill fails with `STALE_REF`, the page re-rendered (or freshness could not
be confirmed). **Re-run `snapshot` and retry with the new refs.** Never invent a uid
and never ignore the error.

Limited retries: snapshot → act again, at most twice. If it still fails, stop and
report the failure — do not guess.

## Screenshots are evidence

- Write authoring screenshots under `$ARTIFACTS_DIR/plan-tests/` (create the directory).
- After each significant UI state, capture a screenshot, then **Read the image file**
  and judge the visible UX before writing Playwright asserts.
- A snapshot tree is not a substitute for a screenshot on UI/UX work.

## Cleanup (no broadcast kill)

Stop **this session's** bridge only:

```bash
CHROME_DEVTOOLS_AXI_SESSION="${WORKFLOW_ID:-plan-tests}" npx -y chrome-devtools-axi stop
```

If you started the app under test, kill **only the PIDs you recorded**.

**Never** `pkill chrome`, `pkill node`, `killall`, or `agent-browser close` without a
session — those take down other parallel runs.

## Skip AXI when

`curl`/`fetch` against a JSON API is enough (no visible UI). Then say so and produce
no fake screenshot.