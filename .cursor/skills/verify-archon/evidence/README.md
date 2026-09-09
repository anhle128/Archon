# Verification evidence

Proof artifacts from `verify-archon` live here.

| Path | What it is |
| --- | --- |
| `runs/<run-id>/` | One verification session. Cleanup must not delete this tree. |
| `last-proof/<feature>/` | Slim committed subset of the last generator proof for that feature (so `discover-workflows` and `web-console` coexist). Full HTTP dumps stay in `runs/` (gitignored). |

Each run directory contains command transcripts (`*.cmd.txt`), HTTP JSON (`*.http.json`), CLI JSON (`*.cli.json`), and a `summary.json` naming the feature driven and the instance (port, `ARCHON_HOME`, base URL). UI proofs also write `console-*.png`, `ui-assertions.json`, and optional `video/*.webm`.

Do not put secrets, API keys, or production Mini database dumps here.
