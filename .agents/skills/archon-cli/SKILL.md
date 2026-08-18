---
name: archon-cli
description: >-
  Operate the Archon command-line interface to set up and diagnose Archon, manage AI credentials and models, discover, validate, run, monitor, approve, reject, retry, resume, and complete workflows, manage isolation environments, and use marketplace and server commands.
  Use when the user asks an agent to run Archon CLI commands, delegate work to an Archon workflow, inspect or control a workflow run, or explain Archon CLI usage.
---

# Archon CLI

Use Archon through its CLI and verify every state change.
Use the installed `archon` command outside the Archon source repository.
Inside the Archon source repository, use `bun run cli` if `archon` is not on `PATH`.

## Operating Procedure

1. Work from the target project directory, or pass `--cwd <path>`.
2. Run `archon version` to confirm that the CLI is available.
3. Run `archon --help` before using an unfamiliar command.
4. Run `archon doctor` when setup, credentials, the database, a provider, or an adapter may be faulty.
5. Run `archon workflow list --json` before selecting a workflow.
6. Use the least destructive command and keep the default worktree isolation.
7. Execute the command and preserve stderr for diagnostics.
8. Check the exit code and query the resulting state before reporting success.

When the CLI behavior is unclear, read `packages/docs-web/src/content/docs/reference/cli.md` in an Archon source checkout.
Otherwise, use the current CLI reference at `https://archon.diy/reference/cli/`.
Treat `archon --help` and the current CLI reference as authoritative.

## Command Map

| Goal | Command |
| --- | --- |
| Check installation | `archon version` |
| Configure Archon | `archon setup` |
| Diagnose Archon | `archon doctor` or `archon doctor --full` |
| Send one chat message | `archon chat "<message>"` |
| List workflows | `archon workflow list --json` |
| Validate definitions | `archon validate workflows [name]` or `archon validate commands [name]` |
| Run a workflow | `archon workflow run <name> "<message>"` |
| Start a detached run | `archon workflow run <name> "<message>" --detach --json` |
| Test DAG routing | `archon workflow run <name> "<message>" --dry-run --stubs <file> --json` |
| List recent runs | `archon workflow runs --json` |
| Inspect one run | `archon workflow get <run-id> --verbose --json` |
| List active runs | `archon workflow status --json` |
| Approve a gate | `archon workflow approve <run-id> [comment] --json` |
| Reject a gate | `archon workflow reject <run-id> [comment] --json` |
| Resume a run | `archon workflow resume <run-id>` |
| Retry a failed node | `archon workflow retry-node <run-id> <node-id>` |
| Cancel a non-terminal run | `archon workflow abandon <run-id> --json` |
| Continue a worktree | `archon continue <branch> [message]` |
| Finish a branch lifecycle | `archon complete <branch>` |
| Inspect isolation | `archon isolation list` |
| Find or install workflows | `archon workflow search [query]` or `archon workflow install <slug>` |
| Manage providers and models | `archon ai ...` |
| Start the web UI | `archon serve` |

## Run Workflows

Keep the default worktree mode for repository projects.
Add `--branch <name>` only when the user needs a specific branch name.
Add `--from <branch>` to change only the worktree start point.
Add `--base <branch>` only when the user also wants that branch as the pull request target.
Use `--no-worktree` only when the user explicitly accepts changes in the live checkout.

Use `--folder` on the first run for a non-git folder project that must run in place.
Use `--container` with a folder project when the user requests overlay isolation and approval-gated write-back.

Use `--detach --json` for long, non-interactive work that the agent will monitor.
The detached acknowledgement contains `conversationId` and `logPath`, but it does not contain the run ID because the child creates the run.
Wait for the run to appear in `archon workflow runs --json`, then match the acknowledgement `conversationId` to `runs[].worker_platform_id` and read that row's `id`.
Inspect the run with `archon workflow get <run-id> --json`.
Do not report completion from a detached acknowledgement.

Use `--dry-run` to check deterministic DAG control flow without creating a run or contacting a provider.
Do not add `--exec-code` unless the local bash and script nodes are trusted because this flag can cause local side effects.

## Use JSON Correctly

Prefer `--json` for commands that support it.
Parse stdout and keep stderr visible.

A real `workflow run --json` does not produce a clean JSON document unless it also uses `--detach`.
A `workflow run --dry-run --json` does produce one complete JSON document.

Read a `workflow get --json` lifecycle state from `result.state` and its completion flag from `result.terminal`.
Read the full run ID from `workflowRunRef.runId`.
Read paused gate details from `metadata.approval` when that field is present.

The `approve`, `reject`, and `resume` commands do not continue execution inline when `--json` is present.
After an approval or rejection, read the JSON acknowledgement and run `archon workflow resume <run-id>` only when `resumable` is `true`.
Then monitor the run again.

## Protect User State

Do not infer permission to approve, reject, abandon, complete, clean up, reset telemetry, remove credentials, install a workflow, or change configuration.
Run these commands only when the user requested the matching state change.

Inspect the run, isolation environment, and git state before `complete` or `isolation cleanup`.
Do not bypass an error by switching to `--no-worktree` or by resetting user files.

Never put API keys in command arguments.
Use the masked prompt for `archon ai key set <vendor>`, or provide the key through stdin when the user supplied a safe input source.

## Handle Failures

Report the exact failing command, exit code, and useful stderr.
Use `archon doctor` for environment faults.
Use `archon workflow get <run-id> --verbose --json` for run faults.
Use `archon workflow retry-node <run-id> <node-id>` only after you identify the failed node.
Never mark an ambiguous running or paused workflow as abandoned because it appears stale.
