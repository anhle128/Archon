# Archon verification map

This directory is the maintained source for proving Archon the way a user does — CLI, HTTP API, and the web console — on **this** checkout (`anhle128/Archon`). Read the index before driving the app, then use the matching feature file as the recipe.

## Baseline preconditions

- Work from the repository root. Confirm `git remote -v` points at `anhle128/Archon`.
- Default target is a **local bun server** started by this skill (`HOST=127.0.0.1`, explicit `PORT`, isolated `ARCHON_HOME`). That path is fully offline and is what cloud agents must use.
- Oceanlabs production Mini (PM2 + PostgreSQL, typically port 3090 over Tailscale) is an **optional remote target**. Never start, stop, restart, or deploy Mini as part of verification. Set `ARCHON_VERIFY_TARGET=mini` and `ARCHON_VERIFY_BASE_URL` only when the user asked to inspect that install **and** the host is reachable.
- Put `verify-archon` on `PATH` or invoke `.agents/skills/verify-archon/bin/verify-archon`.
- Run `verify-archon doctor` and require the expected base URL, isolated home (local target), and `/api/health` `status: "ok"`.
- Never drive an instance this run did not launch, except the explicit Mini remote target.
- Solo SQLite installs have no web login. Do not set `BETTER_AUTH_SECRET` or `DATABASE_URL` on the local verification instance.

## Driving conventions

- Start every recipe from the baseline state unless its preconditions say otherwise.
- Prefer CLI `--json` and HTTP JSON for CLI/API features. **web-console** requires a real browser, visible DOM assertions, and screenshots — HTTP the console reads is not a pass.
- Treat every command as literal. Keep quoted names and flags unchanged.
- Run Archon CLI through `verify-archon cli -- <args>` so `ARCHON_HOME` matches the launched instance.
- Run HTTP through `verify-archon http <path>` so the request hits the instance under doctor.
- Restore scratch state (isolated home, registered verification codebase) during cleanup. Do not remove proof artifacts.

## Proof and skip reporting

- Capture the user action and the resulting state, not only the final payload.
- CLI proof includes the command, stdout, stderr, and exit code.
- HTTP proof includes the method, URL, status, and response body.
- Mutation proof includes a read-only second view (list after register, `workflow get` after a run).
- Record the feature ID and entry point used with every artifact.
- Report an unreachable path with the attempted command and the unmet precondition.
- Do not report a skipped entry point as verified through a different path.
- `archon doctor` failing on a missing Claude/Codex binary is expected on an offline cloud VM. That is not a failed instance doctor unless the feature under test needs that provider.

## Feature entry contract

Each feature file starts with an H1 title and one paragraph describing the user-visible behavior. It then uses exactly four H2 sections in this order.

1. `Sub-features` lists short IDs with one line for each behavior.
2. `How to get to it (user POV)` lists every user entry point.
3. `Driving it with verify-archon` starts with `Preconditions:` and uses labeled bullets that pair each user action with an exact command and observable result.
4. `Gotchas` lists traps that can waste or invalidate a verification run.

Keep implementation details out of the map. Name only user paths, stable handles, required state, commands, and observable proof.

## Features

- [Diagnose the install](./diagnose-install.md) covers `archon doctor` and `GET /api/health`.
- [Discover workflows](./discover-workflows.md) covers CLI list/validate and the HTTP catalog, including project registration so `?cwd=` is legal.
- [Run a deterministic workflow](./run-deterministic-workflow.md) covers `e2e-deterministic` dry-run and a real no-AI run.
- [Inspect a workflow run](./inspect-run.md) covers `runs` / `get` / `status` after a run exists.
- [Open the web console](./web-console.md) covers Playwright against `/console` and `/console/settings` (screenshots required; HTTP the UI reads is supporting only).
