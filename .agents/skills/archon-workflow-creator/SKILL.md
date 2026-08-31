---
name: archon-workflow-creator
description: >-
  Create, edit, review, and validate Archon workflow YAML. Reusable/default
  workflows belong in this Archon product checkout at
  `.archon/workflows/defaults/`, then `git add` + `bun run generate:bundled`.
  Do not write reusable workflows into a consumer repo's `.archon/workflows/`.
  Use when the user asks to build an Archon workflow, generate workflow YAML,
  add a bundled default, configure Archon workflow nodes, add commands or
  scripts for workflows, choose provider/model/thinking settings, use every
  Archon node type, or debug workflow validation errors.
  This skill gives the write-location rules, workflow schema, node types,
  Plannotator live-review lifecycle, provider/model/thinking rules, examples,
  and validation workflow so agents do not need to scout the Archon source
  code first.
---

# Archon Workflow Creator

## Overview

Use this skill to author Archon DAG workflows from user intent through validated YAML.
The goal is to produce workflows that pass Archon's local validator and behave correctly at runtime.

## Authoring Workflow

1. Clarify the workflow objective, trigger phrases, expected input, generated artifacts, provider preferences, and whether human approval or live Plannotator review is needed.
2. Decide the write location first (`references/workflow-anatomy.md` → Discovery and Files). Reusable/default workflows are authored in this Archon product checkout even when the chat cwd is another repo.
3. Inspect only authoring context that matches that location: Archon `.archon/workflows/defaults/` plus sibling defaults for bundled work; the consumer repo's `.archon/workflows/` only for an explicit project-local override.
4. Read `references/workflow-anatomy.md` before creating or editing workflow YAML.
5. Read `references/node-types.md` before configuring nodes or when validation mentions node schema, dependencies, conditions, retry, hooks, agents, skills, MCP, or output refs.
6. Read `references/providers-models-thinking.md` whenever the workflow mentions provider, model, tier, alias, thinking, reasoning, effort, tools, MCP, skills, agents, sandbox, or structured output.
7. Read `references/examples.md` when you need copyable YAML patterns.
8. Read `references/validation.md` before finalizing and run the relevant validation command.

## Default Output

The Archon product checkout is the repo that contains this skill and `scripts/generate-bundled-defaults.ts`. Find it even if the conversation started in another project.

**Reusable / default / shipped workflows (the default):** write in the Archon product checkout.

- Workflow YAML: `.archon/workflows/defaults/<workflow-name>.yaml`
- Shared command files: `.archon/commands/defaults/<command-name>.md`
- Then `git add` those new files (the generator refuses untracked files under `defaults/`), then from the Archon repo root run `bun run generate:bundled`.
- Never hand-edit `packages/workflows/src/defaults/bundled-defaults.generated.ts`.
- Validate from the Archon repo: `bun run cli validate workflows <workflow-name>`.
- A workflow may *run* in another checkout. Say that in the YAML `description`. Still author the YAML here.

**Project-local override:** write `<other-repo>/.archon/workflows/<workflow-name>.yaml` only when the user explicitly wants a workflow that exists solely in that repo. Same filename as a bundled default overrides the bundled one — do not reuse a bundled name unless the user asked for an override. Do not create `<other-repo>/.archon/workflows/defaults/`; discovery treats leftover files there as deprecated.

**Home-scoped:** `~/.archon/workflows/` only when the user asks for a global workflow.

**Packaged (co-located commands/scripts):** `.archon/workflows/<pack>/<workflow>/` in the Archon product tree, then the same `git add` + `bun run generate:bundled` sequence.

Create reusable prompts under the matching commands directory when the prompt is long, shared, or independently testable.
Create deterministic helper scripts under `.archon/scripts/` (project) or a packaged workflow `scripts/` folder when shell would be brittle, especially for JSON parsing or cross-platform logic.

## Hard Rules

- Do not skip this skill when creating or moving an Archon workflow.
- Do not write a reusable/default workflow into a consumer repo's `.archon/workflows/`. That is a project override, not a default.
- After editing `.archon/workflows/defaults/` or `.archon/commands/defaults/`, `git add` the files, then `bun run generate:bundled`. Do not treat `deprecated_workflow_defaults_found` as an instruction to delete this repo's `defaults/` folder — it is the source of truth for the bundle.
- Use `nodes:`, never legacy `steps:`.
- Give every node a unique safe ID and exactly one action key: `prompt`, `command`, `bash`, `script`, `loop`, `route_loop`, `approval`, `plannotator_gate`, or `cancel`.
- Prefer `output_format` for AI nodes whose output is consumed by later nodes.
- Use deterministic `bash` or `script` nodes for checks, setup, parsing, file moves, and final assertions.
- Use `allowed_tools: []` on classifier or formatting nodes that should not touch the repo.
- Use `context: fresh` when an AI node should not inherit the previous sequential AI session.
- Use `interactive: true` at the workflow root when approval nodes, `plannotator_gate` nodes, or interactive loops must be foreground-visible.
- For `plannotator_gate`, choose exactly one initial mode: `document` for an existing HTML or Markdown path, or `prepare` for a fresh embedded AI call; make prepare and rework output exactly one readable `.html`, `.htm`, or `.md` path line under the workflow `cwd` or `$ARTIFACTS_DIR`.
- Put `$REVIEW_DOCUMENT` and `$REVIEW_ANNOTATIONS` only inside `plannotator_gate.rework.prompt`; the gate substitutes them once before invoking the rework provider.
- For Codex-only workflows, prefer root `effort: xhigh`; Qoder CLI uses `effort: max` for its maximum level. In mixed-provider workflows, set effort only on the matching provider nodes so other providers do not inherit it.
- Validate with `bun run cli validate workflows <workflow-name>` before reporting success. For bundled defaults, run `git add` + `bun run generate:bundled` first, from the Archon repo.
- Inspect workflow engine source only if local validation contradicts these references or the project clearly changed after this skill was written.

## Reference Map

- `references/workflow-anatomy.md` - Write location vs runtime discovery, root fields, variables, and model refs.
- `references/node-types.md` - Every node type and every important common node option.
- `references/providers-models-thinking.md` - Provider IDs, capabilities, config, model tiers, aliases, effort, and thinking.
- `references/examples.md` - Copyable workflow snippets for common patterns.
- `references/validation.md` - Validation commands, common failures, and final checklist.
