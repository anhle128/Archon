---
description: Execute one Speckit Ralph batch with paths resolved from the active feature
argument-hint: (none - reads the active feature and Ralph instructions)
---

# Speckit Ralph Iteration

Execute exactly one Ralph iteration.
Do not run `ralph.sh`.

## Resolve File Locations

1. Resolve the repository root with `git rev-parse --show-toplevel`.
2. Read `<repo-root>/.specify/feature.json`.
3. Read `ralph_prd_file` and `ralph_progress_file` from that JSON file.
4. Resolve each relative value from the repository root and keep absolute values unchanged.
5. Confirm that both resolved paths are regular files.

The workflow preflight validates these inputs before this command runs.
Do not guess or fabricate a path if an input becomes unavailable.

## Apply The Ralph Instructions

Read `<repo-root>/.specify/extensions/ralph-loop/AGENTS.md` completely.
Use it as the authority for task selection, batch size, implementation, verification, progress updates, and the required `speckit-git-commit` commit.

Apply only these two overrides:

1. Treat every literal `$RALPH_PRD_FILE` reference as the resolved PRD path and every literal `$RALPH_PROGRESS_FILE` reference as the resolved progress path.
2. Ignore the source `Stop Condition` section and any request to emit `<promise>COMPLETE</promise>`.

After the required commit, finish the response normally.
The workflow engine checks the PRD after the iteration and decides whether another iteration is required.
