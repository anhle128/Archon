# Verification evidence

Proof artifacts from `verify-archon` live here.

| Path | What it is |
| --- | --- |
| `runs/<run-id>/` | One verification session. Cleanup must not delete this tree. |
| `last-proof/` | The last committed generator proof (optional). Reviewers can read this without rerunning. |

Each run directory contains command transcripts (`*.cmd.txt`), HTTP JSON (`*.http.json`), CLI JSON (`*.cli.json`), and a `summary.json` naming the feature driven and the instance (port, `ARCHON_HOME`, base URL).

Do not put secrets, API keys, or production Mini database dumps here.
