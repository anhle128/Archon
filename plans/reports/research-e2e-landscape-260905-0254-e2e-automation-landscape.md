# E2E Automation Landscape — Research Report

Scope: how to replace manual PR click-through QA with automated E2E for Archon (Bun+TS+React+SQLite/Postgres). 2025-2026 sources prioritized.

## A. Playwright (microsoft/playwright)

Playwright = MS framework driving Chromium/Firefox/WebKit "with a single API — in your tests, in your scripts, and as a tool for AI agents." [github.com/microsoft/playwright](https://github.com/microsoft/playwright)

Components:

- **@playwright/test runner** — full test framework, browser isolation, auto-waiting, web-first assertions, parallel by default.
- **Playwright Library** — raw automation lib (scraping/PDF, no test runner).
- **Playwright CLI** — token-efficient CLI "designed for coding agents."
- **Playwright MCP** — MCP server so agents drive pages via accessibility snapshots (not pixels), tool surface incl. `browser_navigate`, `browser_click`, `browser_type`, `browser_snapshot` + ~30 more. Accessibility-tree snapshots = fewer tokens, work with non-vision models, reproducible. [Bug0 2026 roundup](https://bug0.com/blog/playwright-mcp-servers-ai-testing), [Shiplight](https://www.shiplight.ai/blog/playwright-mcp)
- **VS Code extension** — recording/debugging in editor.

**webServer config** (`playwright.config.ts`) auto-boots the app before tests, polls a URL until ready (2xx/3xx/4xx), tears down after:

```ts
webServer: {
  command: 'npm run start',
  url: 'http://localhost:3000',
  reuseExistingServer: !process.env.CI,
},
use: { baseURL: 'http://localhost:3000' },
```

`timeout` defaults 60s; `env` auto-includes `PLAYWRIGHT_TEST=1`. [playwright.dev/docs/test-webserver](https://playwright.dev/docs/test-webserver)

**Fixtures** — encapsulate setup/teardown, reusable across files, composable (e.g. an `authenticatedPage` fixture that logs in then yields). Basis for API-seeding-before-UI pattern (see E). [playwright.dev/docs/test-fixtures](https://playwright.dev/docs/test-fixtures)

**codegen** (`npx playwright codegen <url>`) records clicks/typing into a generated test script — good for a first draft, not for judgment-based assertions.

**Trace viewer** — GUI stepping through recorded actions incl. DOM snapshots before/after each step. Configure `trace: 'on-first-retry'`; after CI, `npx playwright show-report` → click trace icon on a failing test. [playwright.dev/docs/trace-viewer-intro](https://playwright.dev/docs/trace-viewer-intro)

**HTML report** — default reporter, filterable by browser/status/flakiness, uploaded as CI artifact (30-day retention typical).

**Playwright Test Agents (planner/generator/healer)** — shipped as first-party agent defs, NOT experimental-labeled in docs:

```
npx playwright init-agents --loop=claude   # also: vscode, codex, opencode
```

- **Planner** explores the running app, writes a Markdown test plan to `specs/`.
- **Generator** turns the plan into real Playwright spec files in `tests/`, verifying selectors live against the running app.
- **Healer** re-runs failing tests, inspects live UI, patches selectors/waits/flow until green or guardrails stop it.
  `--loop` flag enables plan→generate→run→heal repeating without a human re-triggering each phase. Needs VS Code ≥1.105 (Oct 2025) if using that loop. [playwright.dev/docs/test-agents](https://playwright.dev/docs/test-agents), [currents.dev state-of-ecosystem 2026](https://currents.dev/posts/state-of-playwright-ai-ecosystem-in-2026), [testdino.com](https://testdino.com/blog/playwright-ai-ecosystem)

**GitHub Actions wiring** (standard, auto-scaffolded by `npm init playwright@latest`):

1. checkout + Node setup
2. `npm ci`
3. `npx playwright install --with-deps` (Debian/Ubuntu-only apt-get path; fails on Alpine/Nix/Amazon Linux — install only missing deps manually there, or `--only-shell` to skip full-browser download and use just the headless shell)
4. `npx playwright test`
5. upload HTML report / traces as artifacts
   Runs on `ubuntu-latest` typically. [playwright.dev/docs/ci-intro](https://playwright.dev/docs/ci-intro), [Steve Fenton 2025](https://stevefenton.co.uk/blog/2025/09/playwright-insteall-github-actions/)

## B. chrome-devtools-axi (kunchenguid)

**What it is**: a **CLI tool**, not itself an MCP server — it wraps `chrome-devtools-mcp` behind an "AXI-compliant" interface. AXI = "Agent eXecution Interface," the author's own spec for agent-ergonomic CLIs. Self-description: "wraps chrome-devtools-mcp with an AXI-compliant CLI," "the most agent-ergonomic browser automation." [github.com/kunchenguid/chrome-devtools-axi](https://github.com/kunchenguid/chrome-devtools-axi)

Architecture: persistent bridge server keeps the underlying MCP session alive across CLI invocations (avoids Chrome relaunch cost per call). Output uses "TOON encoding" claimed ~40% smaller than raw JSON; benchmarked (by the author) at 57% fewer input tokens / 26% lower cost / 27% fewer agent turns vs raw chrome-devtools-mcp.

Relation to Chrome DevTools Protocol / official chrome-devtools-mcp: it's a thin efficiency layer ON TOP of `ChromeDevTools/chrome-devtools-mcp` (the official Google-org MCP server, 50.9k stars, 3.6k forks, 1185 commits, actively maintained, Puppeteer-based, "officially supports Google Chrome only"). [github.com/ChromeDevTools/chrome-devtools-mcp](https://github.com/ChromeDevTools/chrome-devtools-mcp)

**Maturity**: 354 stars, MIT license, on npm, has CI. **Small and young relative to its base** — no independent evidence of production adoption found beyond the README's own benchmark claims. Honest read: a solo/small-team optimization wrapper, not a widely-adopted standard.

**Intended use**: explicitly "agent-driven browsing" (autonomous exploration/interaction), the README itself contrasts this against "deterministic test scripts." **Not** a fit for committed, re-run-every-CI-run regression tests — it's closer to a cheaper way to let an agent explore/verify live, once, per invocation. For Archon's PR-verification use case this maps to the "agent judges live" side of the choice in section D, not the "generate a committed spec" side, and even then it's an alternative CLI wrapper around the same underlying MCP server Playwright/Claude could reach more directly via `@playwright/mcp` or `chrome-devtools-mcp` itself.

## C. Landscape 2025-2026

**(1) Deterministic scripted E2E** — Playwright or Cypress, `data-testid` selectors, checked into repo, run every CI push. Pro: fast, cheap, zero flakiness once stable, full audit trail (diff review in PR). Con: brittle to UI churn, someone must write/maintain the scripts, doesn't scale to "verify whatever this PR happened to change" without a human picking scenarios.

**(2) AI-generated Playwright tests** — Playwright's own planner/generator/healer (A above), or driving Claude Code + Playwright MCP / Chrome DevTools MCP by hand to write specs from a ticket/PR description, or Cursor equivalents. Output is still a normal committed `.spec.ts` — AI is a one-time (or self-healing) authoring assist, execution stays deterministic. [Medium: "How I Taught Claude to Write My Playwright Tests From a Ticket"](https://medium.com/@moshe.avitan_18466/how-i-taught-claude-to-write-my-playwright-tests-from-a-ticket-bc178efa0d37), [endform.dev](https://endform.dev/blog/playwright-mcp-claude-code), [alexop.dev](https://alexop.dev/posts/building_ai_qa_engineer_claude_code_playwright/)

**(3) Fully agentic exploratory QA** — LLM drives the browser live from natural-language acceptance criteria each run, judges pass/fail itself, no persisted script (or a disposable one). Tools:

- **Stagehand** (Browserbase) — `act`/`extract`/`observe` primitives + optional autonomous `agent` mode; v3 dropped Playwright dep for direct CDP (+44% perf on complex DOM); open-source SDK, cloud infra optional. Best as a library to mix deterministic + AI-resolved steps, not a full QA platform. [browserbase.com/stagehand](https://www.browserbase.com/stagehand), [docs.stagehand.dev](https://docs.stagehand.dev/v3/first-steps/introduction)
- **Magnitude** — vision-first (screenshots, not DOM), Claude Sonnet 4 recommended, SOTA-claimed 94% WebVoyager benchmark; open source. Good when DOM/accessibility tree is unreliable (canvas apps, iframes); heavier/costlier than DOM-based tools. [github.com/magnitudedev/magnitude](https://github.com/magnitudedev/magnitude)
- **TestDriver.ai** — "computer-use SDK," vision-based, no selectors, self-healing, tags into GitHub PRs and commits generated tests to a branch — actually hybrid (2)+(3): explores live, then commits a script. [docs.testdriver.ai](https://docs.testdriver.ai/)
- **Shortest** (antiwork) — natural-language tests on top of Playwright + Anthropic Claude API; smaller/community project, GitHub 2FA support noted. [github.com/antiwork/shortest](https://github.com/antiwork/shortest)
- **Momentic** — low-code/plain-English editor, self-healing locators, autonomous "agent explores app and generates tests"; tests stored as YAML in-repo so a PR reviewer can read them (hybrid). No public pricing; free tier ~2000 credits. [momentic.ai](https://momentic.ai/blog/best-agentic-qa-tools-for-coding-agents)
- **QA Wolf** — managed/agentic E2E service (not self-hosted), generates real Playwright/Appium code from prompts, reviewable in CI/CD; enterprise pricing (~$24k-126k/yr reported ranges), or self-serve credit-based. Heavier commercial commitment than this use case needs. [qawolf.com](https://www.qawolf.com/blog/the-12-best-ai-testing-tools-in-2026)
- **Anthropic Computer Use / Browser Use tools** — GA'd Aug 2026 (`computer_toolset_20260801`, `browser_toolset_20260801`). Browser Use reads the accessibility tree directly (no screenshots needed) — closer to Playwright MCP's approach than to Magnitude's vision approach; usable as the "hands" behind a custom judge-live workflow, not a packaged testing product. [enterprisedna.co](https://enterprisedna.co/resources/news/anthropic-browser-use-computer-use-skills-api-enterprise-ga-august-2026/), [thenewstack.io](https://thenewstack.io/anthropic-browser-use-tool/)

**(4) Hybrid — agent authors once, script committed, re-run deterministically ("self-healing tests")** — this is where most of the market has converged for 2026: Playwright's own agents, TestDriver, Momentic all land here. Determinism for CI cost/speed, AI only re-invoked on failure (healer) or on new-feature authoring, not every run. [currents.dev](https://currents.dev/posts/state-of-playwright-ai-ecosystem-in-2026)

Trade-offs summary: pure-scripted = cheapest+most deterministic but 0 authoring automation; pure-agentic-live = zero maintenance but real $ + latency + occasional-nondeterministic-judgment cost per run, weakest audit trail; hybrid = one extra LLM cost at authoring/healing time, otherwise behaves like (1).

## D. Recommendation for Archon's use case (verify ONE PR's new features, not a regression suite)

Practitioner consensus for this exact shape (build-once-per-feature, not maintain-forever-regression) is **hybrid, leaning toward "agent generates a Playwright spec once, spec is committed with the PR."** Reasoning:

- Archon already has a governed workflow engine with approval gates — a generated `.spec.ts` reviewed in the PR diff is auditable the same way code is, matching the "Fail Fast + Explicit Errors" / "Reversibility" principles in this repo's engineering rules.
- A "judge live every time" agent (Magnitude/Stagehand-agent-mode/pure computer-use) has no diff to review, non-deterministic pass/fail, and recurring inference cost for a task (verify PR #N once, maybe re-run once on push) that doesn't need to run nightly.
- Playwright's own planner→generator→healer loop is purpose-built for exactly "read a PR/spec, explore live app, write Markdown plan, generate spec, self-heal on next run" — and produces committed artifacts an Archon `bash:`/`prompt:` node pipeline can drive without a new SDK dependency (already using `@playwright/test` conventions the ecosystem expects).
- Keep a **live judging step only as the last mile**: after the generated spec runs, have an AI prompt node read the HTML report / trace + a summary of what changed, and write the human-readable PASS/CONCERNS verdict — that's "agent judges" applied to _interpreting results_, not to _driving the browser_, which is far cheaper and more reliable.

**Minimal one-afternoon first step (zero E2E experience)**:

1. `npm init playwright@latest` in the web package (or `bunx create-playwright`), accept ubuntu+chromium-only defaults.
2. Add `webServer` config pointing at `bun run dev:server` + `bun run dev:web` (or one combined `bun run dev`), with a scratch/temp DB via env var (see E).
3. Manually click through ONE real feature once using `npx playwright codegen http://localhost:5173` to get a first draft spec — this alone replaces "click by hand" with "click by hand once, replay forever."
4. Add 2-3 `expect()` assertions by hand for what "worked" means.
5. Run `npx playwright test`, look at the HTML report.
   That's a deterministic regression test for one flow, no AI needed yet — the natural next increment is wiring `npx playwright init-agents --loop=claude` so future PRs get the plan→generate step automated.

## E. Practical notes: Bun + React + SQLite

- **Bun vs Playwright**: Playwright's own test runner (`@playwright/test`) fundamentally assumes Node's module loader; running it _under_ `bun run`/`bun test` hits real bugs — an open Bun issue shows `.esm.preflight` ESM-loader-hook failure when Playwright is invoked via `bun run --bun`. [oven-sh/bun#28609](https://github.com/oven-sh/bun/issues/28609). Bun 1.4 improved this (Chromium launch, `connectOverCDP`, `--ui` reportedly working), but the pragmatic, currently-safe pattern is: **use `bunx playwright test`** (Bun as package manager/executor only) or literally shell out to `node`/`npx playwright test` for the actual test run, keeping Bun for the app itself. [Bun 1.4 blog](https://bun.com/blog/bun-v1.4), [oven-sh/bun#8222](https://github.com/oven-sh/bun/issues/8222), [oven-sh/bun#23826](https://github.com/oven-sh/bun/issues/23826). Given Archon already special-cases test isolation per package, treat Playwright as its own isolated invocation (own `bunfig`-free directory, own `npx`/`bunx` call) rather than folding it into `bun run test`.
- **Isolated DB per run**: set `ARCHON_HOME` (Archon already supports this override) to a fresh temp dir per Playwright run (`mktemp -d`, or `${{ runner.temp }}` in CI) so `~/.archon/archon.db` (SQLite default) is disposable and schema auto-applies on boot — zero manual migration step needed, matching Archon's "SQLite is the default, auto-initialized" behavior already documented in this repo. Pass it via the `env` key of `webServer` so the same env reaches both `dev:server` and any seeding script.
- **Ephemeral ports**: Archon's worktree dev server already auto-allocates a deterministic port per path (3190-4089 hash-based); for a CI/PR-verification run, either reuse that mechanism or pin one free port per run (`PORT=$(shuf -i 4090-4999 -n1)` or similar) and feed it into both `webServer.url`/`command` and Playwright's `baseURL`.
- **Headless Chromium in CI**: `npx playwright install --with-deps` on `ubuntu-latest` is standard and covers apt deps; that flag is Debian/Ubuntu-specific (fails on Alpine/Nix/Amazon Linux) — irrelevant for GitHub-hosted `ubuntu-latest`/`macos-latest` runners. On `macos-latest` no extra system deps are normally needed since GitHub's macOS images already carry required libs; add `--only-shell` if you want to skip the full headed Chromium binary and only fetch the smaller headless shell, cutting CI install time. [playwright.dev/docs/browsers](https://playwright.dev/docs/browsers), [Steve Fenton](https://stevefenton.co.uk/blog/2025/09/playwright-insteall-github-actions/)
- **Seed via API before UI steps**: recommended pattern is a Playwright fixture that calls Archon's own REST API (`POST /api/codebases`, `/api/workflows/:name/run`, etc. — already OpenAPI-documented) to create the exact preconditions a PR's new feature needs, THEN drives the UI only for the behavior actually under test — reserves UI-driven creation only for flows that ARE the feature being verified. Avoids coupling tests to internal schema and re-uses the app's own validation. [scrolltest.com pattern writeup](https://scrolltest.com/playwright-database-seeding-e2e-api/), [dev.to seeding writeup](https://dev.to/matejstetiar/playwright-test-data-seeding-a-real-backend-for-e2e-suites-3ieh)

## Comparison Table

| Tool                                              | Type                                         | Determinism                               | AI-native        | Maturity                                        | Fit for "verify 1 PR"                                                               |
| ------------------------------------------------- | -------------------------------------------- | ----------------------------------------- | ---------------- | ----------------------------------------------- | ----------------------------------------------------------------------------------- |
| Playwright (`@playwright/test`)                   | Scripted framework                           | High                                      | No (core)        | Very mature, MS-backed                          | Backbone — use regardless of AI layer                                               |
| Playwright Test Agents (planner/generator/healer) | Hybrid: AI authors, script committed         | High after gen                            | Yes, first-party | New (2025-2026), no experimental flag but young | **Best fit** — matches "generate once, commit, re-run"                              |
| Playwright MCP                                    | MCP server (agent↔browser bridge)            | N/A (bridge)                              | Yes              | Mature, official                                | Use as the driver under any agent workflow                                          |
| chrome-devtools-mcp                               | MCP server (Chrome DevTools Protocol)        | N/A (bridge)                              | Yes              | Very mature, Google-org, 50.9k★                 | Alt driver; Chrome-only                                                             |
| chrome-devtools-axi                               | CLI wrapper over chrome-devtools-mcp         | N/A                                       | Yes              | Small/young, 354★, solo project                 | Niche token-efficiency wrapper; not needed unless token cost is a proven bottleneck |
| Stagehand                                         | Library (act/extract/observe/agent)          | Mixed (deterministic steps + AI fallback) | Yes              | Mature (Browserbase-backed), v3-v4 active       | Good for brittle-selector spots inside otherwise scripted tests                     |
| Magnitude                                         | Vision-first agent                           | Low (live judgment)                       | Yes              | Newer, open source, benchmark-strong            | Only if DOM/accessibility tree is unreliable                                        |
| TestDriver.ai                                     | Computer-use SDK, commits generated tests    | High after commit                         | Yes              | Commercial, active                              | Hybrid option if buying a SaaS is acceptable                                        |
| Shortest                                          | NL tests on Playwright + Claude              | Medium                                    | Yes              | Small community project (antiwork)              | Lightweight alt to Playwright agents; less proven                                   |
| Momentic                                          | Low-code + autonomous explorer, YAML in repo | High (YAML reviewable)                    | Yes              | Commercial, active                              | Viable if SaaS acceptable; overlaps Playwright agents                               |
| QA Wolf                                           | Managed agentic E2E service                  | High (generates Playwright code)          | Yes              | Commercial, enterprise-priced                   | Overkill/cost for single-PR verification                                            |
| Anthropic Browser Use / Computer Use              | Raw agent tool (GA Aug 2026)                 | Low standalone                            | Yes              | New, production-GA                              | Building block for a custom judge-live step, not a packaged answer                  |

## Gaps / Unresolved Questions

- No hands-on verification that `bunx playwright test` (vs plain `npx`) is fully stable on Bun 1.4+ for this repo specifically — recommend a quick spike before committing to the pattern.
- Playwright Test Agents' `--loop=claude` output format (what exactly gets written into `.claude/` or similar) wasn't directly inspected — worth a 10-minute hands-on trial before designing the Archon workflow YAML around it.
- No pricing/ToS check done for any commercial tool (TestDriver, Momentum, QA Wolf) — flagged only from search snippets, not verified against current vendor pages.
- Didn't find independent (non-vendor) benchmarks corroborating chrome-devtools-axi's efficiency claims (57%/26%/27%) — treat as author-reported only.

Status: DONE
Summary: Playwright + its first-party planner/generator/healer Test Agents is the clear fit for Archon's "verify one PR's new features, script committed" goal; chrome-devtools-axi is a small solo CLI wrapper around the official chrome-devtools-mcp server for live agent-driven browsing, not a testing framework, and isn't needed here. Recommended path: `create-playwright` → manual codegen'd first spec (1 afternoon) → later automate via `init-agents --loop=claude` inside an Archon workflow, seeding state via the existing REST API and an ephemeral `ARCHON_HOME` SQLite DB per run.
Unresolved questions: see Gaps section above.
