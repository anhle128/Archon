# Discover workflows

Discover workflows lets a user see which YAML workflows Archon will run from this checkout, distinguish bundled defaults from project files, and validate a named definition before invoking it.

## Sub-features

- `list-cli` lists workflows from the repository via the Archon CLI.
- `validate-cli` validates one named workflow (`e2e-deterministic`) without running it.
- `list-http-bundled` lists bundled + home-scoped workflows from `GET /api/workflows` with no project context.
- `register-project` registers this checkout as a local codebase so `?cwd=` is accepted.
- `list-http-project` lists project workflows after registration, including `e2e-deterministic`.

## How to get to it (user POV)

- Run `archon workflow list` (from source: `bun run cli workflow list`) inside this git repo.
- Run `archon validate workflows e2e-deterministic`.
- Open the web console at `/console` and read the workflow catalog (it calls `GET /api/workflows`).
- Register the project from the console or `POST /api/codebases` with `{ "path": "<repo-root>" }`, then reload the catalog.

## Driving it with verify-archon

Preconditions:

- Archon is healthy at the launched base URL (`verify-archon doctor` passed).
- Local target uses the isolated `ARCHON_HOME` from launch (empty codebase list).
- The repo root contains `.archon/workflows/test-workflows/e2e-deterministic.yaml`.

- **CLI list.** List workflows from the checkout. Run `verify-archon cli -- workflow list --json`. Exit code `0`. `workflows` is a non-empty array and includes an object whose `name` is `e2e-deterministic`.
- **CLI validate.** Validate that definition. Run `verify-archon cli -- validate workflows e2e-deterministic --json`. Exit code `0`. The named result has no error-level issues.
- **HTTP bundled catalog.** List without a project. Run `verify-archon http /api/workflows`. Status `200`. `workflows` is non-empty. This payload may omit project-only files such as `e2e-deterministic`.
- **Register checkout.** Add the local path the way the console does. Run `verify-archon http POST /api/codebases --body '{"path":"'"$REPO"'"}'`. Status `201` or `200` (already existed). Body includes `id` and `default_cwd` equal to the repo root.
- **HTTP project catalog.** List with the registered cwd. Run `verify-archon http "/api/workflows?cwd=$REPO"`. Status `200`. Some entry has `workflow.name` equal to `e2e-deterministic` and `source` of `project`.
- **Proof.** Re-read both catalogs. Evidence contains `workflow-list.cli.json`, `validate-e2e-deterministic.cli.json`, `workflows-bundled.http.json`, `codebase-register.http.json`, and `workflows-project.http.json`. The project list still contains `e2e-deterministic`.

## Gotchas

- `GET /api/workflows?cwd=<path>` returns `400 Invalid cwd: must match a registered codebase path` until the path is registered. Do not pass `cwd` on a fresh isolated home.
- `bun --filter @archon/server` runs with cwd `packages/server`. Never assume the server process cwd is the repo root; pass `--cwd` / `?cwd=` explicitly after registration.
- `bun run cli --cwd <path>` can be stolen by Bun's own `--cwd`. Use `verify-archon cli -- …` or `bun run cli -- --cwd <path> …`.
- CLI list from this git repo includes project + bundled + global. HTTP without `cwd` is bundled + home only. Those catalogs are not the same set.
- Do not invoke `archon-assist` or any AI workflow as a substitute for list/validate.
