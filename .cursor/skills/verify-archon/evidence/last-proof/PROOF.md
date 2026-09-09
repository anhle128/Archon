# Generator proof — discover-workflows

Captured on 2026-09-09 against this checkout, using the local bun target (not Mini).

## Invoke

```bash
.cursor/skills/verify-archon/bin/verify-archon prove discover-workflows
```

Step-wise: `launch` → `doctor --json` → `drive discover-workflows` → `cleanup`.

## What was proved

Feature: **discover-workflows**

1. Launch `bun run dev:server` at `http://127.0.0.1:13090` with isolated `ARCHON_HOME` and empty `DATABASE_URL` (SQLite).
2. `GET /api/health` returned `status: "ok"`, `adapter: "web"`, `version: "0.9.0"`.
3. `archon doctor` passed (database, writable isolated home, bundled defaults). AI binaries skipped — expected offline.
4. `workflow list --json` included `e2e-deterministic` (83 workflows).
5. `validate workflows e2e-deterministic --json` was valid with 0 errors (1 warning: `uv` not on PATH).
6. `GET /api/workflows` (no cwd) returned the bundled catalog (38 workflows).
7. `POST /api/codebases` registered `/workspace` as `anhle128/Archon` (`kind: repo`).
8. `GET /api/workflows?cwd=/workspace` included `{name: e2e-deterministic, source: project}`.
9. Cleanup stopped PID 13090's listener, removed isolated home, and left this evidence tree.

## Artifacts here

Slim copies only (full workflow-definition dumps stay in `../runs/<run-id>/`, gitignored).

| File                                  | Proof                                    |
| ------------------------------------- | ---------------------------------------- |
| `launch-health.http.json`             | Server ready                             |
| `doctor.cli.txt`                      | Product doctor checklist                 |
| `workflow-list.cli.names.json`        | CLI catalog includes `e2e-deterministic` |
| `validate-e2e-deterministic.cli.json` | Valid definition                         |
| `workflows-bundled.http.names.json`   | HTTP catalog without project             |
| `codebase-register.meta.json`         | Registered this checkout                 |
| `workflows-project.http.names.json`   | HTTP catalog after register              |
| `summary.json`                        | Feature id and ok                        |

## Not claimed

- Mini / Tailscale
- Vite `/console` HTML
- A real `e2e-deterministic` run (`uv` missing on this VM)
