# Workflow Anatomy

## Table of Contents

- Discovery and files
- Minimal skeleton
- Root fields
- Runtime variables
- Output references
- Model references
- Authoring sequence

## Discovery and Files

Authoring location is not the same as the chat cwd.

### Where to write

| Kind | Path (Archon product checkout unless noted) | When |
| ---- | ------------------------------------------- | ---- |
| Bundled default (default) | `.archon/workflows/defaults/<name>.yaml` | Reusable, shipped, or the user did not ask for a project-only file |
| Bundled command | `.archon/commands/defaults/<name>.md` | Prompt is long, shared, or independently testable |
| Packaged workflow | `.archon/workflows/<pack>/<workflow>/` | Needs co-located commands/scripts |
| Project override | `<other-repo>/.archon/workflows/<name>.yaml` | User explicitly wants a file that lives only in that repo |
| Global | `~/.archon/workflows/<name>.yaml` | User explicitly wants a home-scoped workflow |

The Archon product checkout is the repo that contains this skill and `scripts/generate-bundled-defaults.ts`. Write bundled defaults there even when the conversation started in another repo (for example a service that will *run* the workflow).

After adding or editing files under `.archon/workflows/defaults/` or `.archon/commands/defaults/`:

1. `git add` those files. `bun run generate:bundled` refuses untracked files under `defaults/`.
2. From the Archon repo root, run `bun run generate:bundled`.
3. Do not hand-edit `packages/workflows/src/defaults/bundled-defaults.generated.ts`.
4. Validate with `bun run cli validate workflows <name>` from the Archon repo.

Do not create `<consumer-repo>/.archon/workflows/defaults/`. Discovery warns `deprecated_workflow_defaults_found` and hints `rm -rf` for leftover files there. That warning is not an instruction to delete this product repo's `defaults/` folder.

A project file with the same filename as a bundled default overrides the bundled one. Do not reuse a bundled filename unless the user asked for an override.

### Runtime discovery

Archon workflows are YAML files discovered from three scopes.
Bundled defaults load first (embedded in a binary; in source mode they load from this product's `.archon/workflows/defaults/` plus packaged folders), global workflows load from `~/.archon/workflows/`, and project workflows load from `<run-cwd>/.archon/workflows/`.
Higher scopes override lower scopes when filenames match.
Workflow discovery descends at most one subdirectory.
Use `.yaml` or `.yml`.

Project commands live under `.archon/commands/`.
Command discovery also supports global commands and one subdirectory.
A command node uses the command name without `.md`.
Command names must not contain `/`, `\`, `..`, and must not start with `.`.

Project scripts live under `.archon/scripts/`.
Global scripts live under `~/.archon/scripts/`.
Script discovery descends at most one subdirectory.
Script names are keyed by basename without extension.
`.ts` and `.js` run through `bun`.
`.py` runs through `uv`.
Duplicate script basenames within one scope are invalid.

## Minimal Skeleton

```yaml
name: my-workflow
description: |
  Use when: User wants ...
  Triggers: "phrase one", "phrase two".
  Does: ...
  NOT for: ...

provider: claude
model: medium

nodes:
  - id: classify
    prompt: |
      Classify this request: $ARGUMENTS
    allowed_tools: []
    output_format:
      type: object
      properties:
        kind:
          type: string
          enum: [bug, feature]
      required: [kind]

  - id: report
    depends_on: [classify]
    bash: |
      set -e
      kind=$classify.output.kind
      printf 'kind=%s\n' "$kind"
```

## Root Fields

Required root fields:

| Field         | Meaning                                         |
| ------------- | ----------------------------------------------- |
| `name`        | Non-empty workflow name; prefer kebab-case.     |
| `description` | Router-facing description and trigger guidance. |
| `nodes`       | Non-empty DAG node list.                        |

Optional root fields:

| Field                   | Values                                                 | Notes                                                                                               |
| ----------------------- | ------------------------------------------------------ | --------------------------------------------------------------------------------------------------- |
| `provider`              | registered provider ID                                 | Default provider for AI nodes.                                                                      |
| `model`                 | literal model, `small`, `medium`, `large`, or `@alias` | Model presets can also change the effective provider.                                               |
| `interactive`           | boolean                                                | Use true for approval, Plannotator, or loop gates that must pause visibly.                           |
| `worktree.enabled`      | boolean                                                | `false` forces live checkout; `true` forces isolated worktree.                                      |
| `mutates_checkout`      | boolean                                                | Omitted means true and path-lock applies; set false only for read-only or per-run-scoped workflows. |
| `persist_sessions`      | boolean                                                | Default `persist_session` for eligible AI nodes.                                                    |
| `tags`                  | string array                                           | UI and discovery metadata.                                                                          |
| `requires`              | `[github]`                                             | Blocks early when per-user GitHub identity is required and absent.                                  |
| `additionalDirectories` | string array                                           | Accepted by schema; prefer Codex assistant config for runtime effect.                               |
| `modelReasoningEffort`  | non-empty provider-specific string                     | Legacy workflow fallback for `effort`; preserved for compatibility.                                 |
| `webSearchMode`         | `disabled`, `cached`, `live`                           | Accepted by schema; prefer Codex assistant config for runtime effect.                               |
| `effort`                | non-empty provider-specific string                     | Preserved exactly and passed to providers that support effort.                                      |
| `thinking`              | `adaptive`, `enabled`, `disabled`, or object form      | Workflow default for Claude-style thinking.                                                         |
| `fallbackModel`         | non-empty string                                       | Claude-only capability.                                                                             |
| `betas`                 | non-empty string array                                 | Claude SDK beta headers.                                                                            |
| `sandbox`               | object                                                 | Claude sandbox settings.                                                                            |

Do not use `steps:`.
The loader rejects legacy step workflows.

For Codex-only workflows, set root `effort: xhigh` when every inheriting AI node resolves to Codex.
For mixed-provider workflows, set `effort: xhigh` on each Codex AI node instead; a root effort is inherited by non-Codex nodes too.
Qoder CLI's maximum value is `effort: max`; place it on Qoder nodes in mixed-provider workflows.

## Runtime Variables

These variables are substituted in prompts, command files, loop prompts, bash, and scripts as applicable.

| Variable            | Meaning                                                         |
| ------------------- | --------------------------------------------------------------- |
| `$WORKFLOW_ID`      | Workflow run ID.                                                |
| `$USER_MESSAGE`     | User trigger text.                                              |
| `$ARGUMENTS`        | Same as user trigger text in workflow execution.                |
| `$ARTIFACTS_DIR`    | Pre-created run artifact directory.                             |
| `$BASE_BRANCH`      | Base branch from config, caller, or git detection.              |
| `$DOCS_DIR`         | Configured docs path or `docs/`.                                |
| `$CONTEXT`          | GitHub issue or PR context when available.                      |
| `$EXTERNAL_CONTEXT` | Alias for issue or PR context.                                  |
| `$ISSUE_CONTEXT`    | Alias for issue or PR context.                                  |
| `$LOOP_USER_INPUT`  | User feedback on the first resumed interactive loop iteration.  |
| `$LOOP_PREV_OUTPUT` | Previous loop iteration output.                                 |
| `$REJECTION_REASON` | Approval rejection feedback inside `approval.on_reject.prompt`. |

If `$BASE_BRANCH` is referenced and no base branch resolves, execution fails fast.
If context variables are referenced with no context, they become empty strings.

Bash nodes receive environment variables for `ARTIFACTS_DIR`, `LOG_DIR`, `BASE_BRANCH`, `USER_MESSAGE`, `ARGUMENTS`, loop variables, rejection reason, context aliases, and managed project env vars.
Script nodes receive `ARTIFACTS_DIR`, `LOG_DIR`, `BASE_BRANCH`, and managed project env vars.

## Plannotator Gate Variables

`plannotator_gate.rework.prompt` has two gate-owned placeholders.

| Variable              | Meaning                                                                |
| --------------------- | ---------------------------------------------------------------------- |
| `$REVIEW_DOCUMENT`    | Absolute path of the HTML or Markdown document open for review.        |
| `$REVIEW_ANNOTATIONS` | Reviewer feedback returned by the latest Plannotator annotate session. |

These placeholders are substituted once over the original rework prompt.
Literal placeholder text inside the document path or annotations is preserved and is not scanned again.
They are not general workflow variables and should only be used inside `plannotator_gate.rework.prompt`.
They are invalid in `document`, `prepare.prompt`, and every other workflow field.

## Output References

Use `$nodeId.output` to consume the whole text output of an upstream node.
Use `$nodeId.output.field` to consume a JSON field.
Field access is strict when the producer declares `output_format.properties`.
Referencing a field not declared in the schema fails the consuming node.
For schemaless producers, field access requires the output text to be a JSON object containing that key.

In bash nodes, Archon injects `$node.output` substitutions already shell-quoted.
Do not wrap them in double quotes.
Use this pattern:

```yaml
bash: |
  status=$classify.output.status
  printf 'status=%s\n' "$status"
```

In script nodes, substitutions are not shell-quoted.
For Bun scripts, JSON object output can be assigned directly:

```yaml
script: |
  const data = $classify.output;
  console.log(data.status);
runtime: bun
```

For Python scripts, use `json.loads` when the substituted value is text:

```yaml
script: |
  import json
  data = json.loads("""$classify.output""")
  print(data["status"])
runtime: uv
```

## Model References

`model:` accepts three forms.
Tier names `small`, `medium`, and `large` resolve through built-in defaults plus config tiers.
Custom aliases start with `@` and resolve through config aliases.
Any other string is a provider literal and passes through to the provider SDK.

Model tiers and aliases resolve to a provider plus model.
If `provider: claude` and `model: medium` resolves to Codex, Archon warns and uses the resolved provider.
Use `small`, `medium`, or `large` for portable bundled or global workflows.
Reserve `@custom` aliases for project workflows where `.archon/config.yaml` owns the alias.

## Authoring Sequence

1. Decide write location (bundled default vs explicit project override vs global). Do not skip this.
2. Name the workflow and write router-quality description text. If it must run in another checkout, say so in the description.
3. Choose root provider and model defaults.
4. Sketch the DAG as node IDs and dependencies before writing prompts.
5. Add deterministic setup, checks, and assertions as bash or script nodes.
6. Add AI nodes only where reasoning, code editing, or synthesis is needed.
7. Add `output_format` to every AI node whose fields feed conditions or later nodes.
8. Add human gates only where user decision is required.
9. If the file is under `defaults/`, `git add` it, then `bun run generate:bundled`.
10. Validate after every substantial change.
