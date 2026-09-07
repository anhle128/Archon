---
title: 'HITL end-to-end acceptance'
date: 2026-09-07
status: evidence
---

# End-to-end acceptance

Runtime: isolated Archon server (SQLite, `ARCHON_E2E_FAKE_PROVIDER=1`, per-worker `ARCHON_HOME`), Playwright Chromium, production web dist (`bun run build:web`).

Command:

```sh
bun run build:web
bun run --cwd e2e typecheck
bun run --cwd e2e test:ui:hitl
```

Result: **12 passed** (2026-09-07, ~1.7 min, 1 worker).

CI: `.github/workflows/test.yml` job `e2e-hitl` (`npm ci --prefix e2e`, Chromium `--with-deps`, typecheck, HITL grep, evidence upload). Lockfile: tracked `e2e/package-lock.json`; root gitignore now allows that path and ignores `e2e/bun.lock`.

## Critical scenarios

| Scenario                                   | Proof                                                                                                                         | Result |
| ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------- | ------ |
| CLI-origin Ask, browser answer, CLI resume | Envelope paused; starter POST 200; duplicate 409; teammate 403; anon 401; `workflow resume` → completed                       | Pass   |
| Console Ask card submit, CLI-origin        | UI Submit stamps Answered; run row unpauses (`running`) without web auto-dispatch; CLI resume completes                       | Pass   |
| Parent-backed web-origin Ask               | `runHitlWorkflowViaWeb` registers folder codebase + conversation; answer auto-resumes to `completed`                          | Pass   |
| Teammate cannot answer                     | 403                                                                                                                           | Pass   |
| Composer ≠ approve                         | CLI-origin: Chat tab absent, composer absent, Ask still pending. Web-origin: POST conversation `"approve"` leaves Ask pending | Pass   |
| Tool call + result                         | ≥2 `kind: tool` rows; output contains `HITL_TOOL_OUTPUT_VISIBLE`; UI `.ptool` on Console and Legacy                           | Pass   |
| Loop occurrences                           | `inspect-twice` has ≥2 distinct `occurrence_id`/`attempt_id` in `nodeExecutions`                                              | Pass   |
| Replay / view-as absent                    | `#btn-replay` / `#view-toggle` count 0                                                                                        | Pass   |
| Artifacts retained                         | Console Artifacts tab opens empty-state (“No artifacts written…”)                                                             | Pass   |
| Source Control retained                    | Legacy Source Control tab visible                                                                                             | Pass   |

## Coverage limits (explicit, not claimed pass)

| Item                                                   | Why not in this suite                                                                                                                                                                                                                                                                      |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Ask inside nested loop iteration 3                     | Fixture is a 2-iteration single loop then a separate Ask node. Would need a new YAML + fake-provider `askOnIteration` path.                                                                                                                                                                |
| Route re-entry after answered Ask                      | No `route_loop` in the HITL fixture.                                                                                                                                                                                                                                                       |
| Inline Plannotator annotations vs native approval race | Covered by unit tests in Phase 2; no live supervisor in this Playwright stack.                                                                                                                                                                                                             |
| Live Claude / Pi AskHuman                              | `packages/providers/src/claude/askhuman-resume-spike.test.ts` and `packages/providers/src/community/pi/askhuman-resume.characterization.test.ts` remain characterization/unit. CI AI smoke is opt-in (`e2e-smoke.yml`). No funded key in this run — **not a deterministic-suite failure**. |
| Better Auth session cookies                            | Identity is `X-Archon-User` on the existing loopback resolver. Proves route auth, not login UI.                                                                                                                                                                                            |
| `bun run check:schema-upgrades`                        | Needs reachable PostgreSQL (CI `schema-upgrade` job). Not run in this local pass unless `PGHOST` is set.                                                                                                                                                                                   |
| Pixel-diff Playwright snapshots of the app             | Forbidden as self-approval. Visual evidence is mockup-vs-actual PNG comparison in `visual-acceptance.md`.                                                                                                                                                                                  |

## Auth / provider / rollback

- Starter web identity shares the CLI starter UUID. Teammate is a distinct `X-Archon-User`.
- Fake provider is env-gated; capability matrix must not list it when the env is unset (Phase 1 unit coverage).
- Additive schema only. Rollback UI by reverting Phases 3–4; leave occurrence/attempt columns in place.
- Fixture-owned processes: `createArchonRuntime.stop()` SIGTERM/SIGKILL then `rmSync` of the temp tree. Occupied worker port refuses to launch.

## Root checks

- `bun run validate`: **pass** (tester, 2026-09-07, ~113s) after regenerating bundled defaults and lint/format on HITL-touched files.
- `bun run check:schema-upgrades`: **not run locally** — PostgreSQL unreachable (`PGHOST`/`DATABASE_URL` unset). CI `schema-upgrade` job remains the gate.
- `@archon/providers` full suite: 26/27. The failing OmpProvider NDJSON session test is unrelated to HITL and is not a Phase 5 blocker.
