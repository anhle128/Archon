# Workflow Node Usage and Cost Tracking Implementation Plan

**Status:** independently reviewed and ready for implementation

**Reviewed:** 2026-09-03

**Product design:** `docs/superpowers/specs/2026-09-03-node-cost-tracking-design.md`

The linked design remains the product-intent record, but its technical sections predate this repository review.
Where it conflicts with this plan—especially map-shaped identities, node-completion persistence, replace-delete retry handling, parent usage copying, speculative chat columns, and CLI `--from`—this reviewed plan is authoritative.

## Goal

Give an operator a trustworthy answer to “which workflow run, node, agent provider, upstream provider, and model consumed tokens or money?” without changing workflow execution semantics.

The implementation must capture every usage report the configured provider makes available for workflow AI execution, preserve failed and repeated attempts instead of replacing them, distinguish provider-reported USD from estimated USD, and expose direct-run usage through the REST API, CLI, run detail, and one console Cost page.

This is operational cost visibility, not an invoicing system.

In this plan, “provider-reported” means a USD value supplied to Archon by the upstream SDK or CLI.
Pi, OMP, OpenCode, or another tool may calculate that value from its own catalog; Archon does not assert that it equals an invoice.
“Estimated” means Archon itself calculated the value from the operator config or Pi catalog.

It must never invent usage, model attribution, request counts, or billed USD that an upstream SDK did not report.

## User Outcome

After this work:

- An operator can inspect a run and see cumulative direct usage for each node, including spend from failed attempts, structured-output reasks, loop iterations, resumes, and manual node retries.
- An operator can query the current month or a bounded UTC range by agent, upstream provider, model, project, day, or node.
- Provider-reported USD and catalog/config estimates are shown separately.
- Missing model, token, request, or USD data is visible as missing, never rendered as zero.
- Child workflow runs own their usage, so an installation-wide report counts each charge once.
- Existing `cost_usd`, token totals, budget behavior, and historical runs continue to work.

## Scope

### In scope

- Workflow AI executions made through `IAgentProvider.sendQuery()`.
- Primary model usage and provider-visible subagent usage.
- OMP primary, advisor, and task-subagent usage that can be read safely from transcripts.
- An append-only workflow usage event and normalized ledger.
- Provider-reported cost plus optional point-in-time estimates.
- REST, CLI, run-detail, and console reporting.
- SQLite and PostgreSQL parity, upgrade safety, and rollback behavior.

### Non-goals

- Direct-chat usage.
- Per-user billing, quotas, chargeback, or invoice reconciliation.
- Historical backfill.
- New budget enforcement or changes to `maxBudgetUsd`.
- Parent/child run-tree rollups.
- Repricing historical rows when configuration or the bundled catalog changes.
- New workflow YAML fields or expression-language behavior.
- Adding speculative nullable `chat` columns or a `source` discriminator for a caller that does not exist.
- Making Qoder report data its CLI does not expose.

## Repository Evidence and Corrections to the Draft

The prior draft was treated as unverified.

The following evidence changes material parts of its design:

1. `packages/providers/src/types.ts` currently exposes legacy `TokenUsage`, `cost`, `resolvedModel`, and raw `modelUsage` on the terminal result chunk.
   `MessageChunk` is an extension contract used by built-in and community providers, so deleting `modelUsage` in this feature would be an unnecessary compatibility break.
2. `packages/workflows/src/dag-executor.ts` has two distinct AI streaming paths: the standard AI-node `runStreamPass` path and the direct `loop` path.
   Both have structured-output reasks, and the standard path can observe more than one cumulative result while background tasks drain.
3. A completed node is not the accounting unit.
   A node can spend money and fail, pause, reask, retry, or run another loop iteration before `node_completed` exists.
4. `workflow retry-node` deliberately re-executes a node under a new retry epoch.
   Delete-and-replace by `(run, node)` would erase real historical spend.
5. Child `workflow:` nodes already have their own run rows through `parent_run_id`.
   Copying child usage into a parent ledger or parent usage map would double-count installation-wide reporting.
6. `remote_agent_workflow_events` is the existing append-only audit stream.
   A dedicated usage event is a better JSON source than mutable run metadata and remains available for failed and paused work.
7. `createWorkflowEvent()` is intentionally non-throwing, while `insertWorkflowEvent()` is the throwing primitive used inside transactions.
   Usage needs a separate narrow recorder port whose core implementation builds an atomic event-plus-ledger operation on the latter, with the normal event path as a degradation fallback.
8. Only `workflow_started`, `workflow_completed`, and `approval_requested` are mapped into the external workflow-event outbox in `packages/core/src/workflows/store-adapter.ts`.
   Usage events must remain internal and must not create high-volume outbound callbacks.
9. The dashboard poller explicitly filters to lifecycle events.
   A usage event must not be added to `DASHBOARD_SOURCE_EVENT_TYPES`; the following node terminal event already causes the required refetch.
10. `packages/web/src/experiments/console/primitives/event.ts` renders unknown workflow events as raw JSON text.
    The new event therefore needs an explicit `system` mapping so it remains behind the existing System toggle.
11. The CLI already assigns `--from` and `--from-branch` to worktree branch selection.
    The usage command must use `--since` and `--until` rather than overload `--from`.
12. `usage` is installation-wide and must be added to the CLI’s `noGitCommands` array and its mirrored contract test.
13. The pinned Claude Agent SDK exposes per-model input, output, cache-read, cache-creation, and USD fields, but no per-model request count.
14. The pinned Codex SDK exposes total input, cached input, output, and reasoning output.
    Its API does not expose observed model, request count, or USD on `turn.completed`.
15. The pinned Pi SDK defines reasoning as a subset of output, exposes cache read/write and cost, and reports `responseModel` separately from the requested `model`.
    Its `agent_end.messages` collection is the new messages for the current invocation, so summing all assistant messages fixes the current last-message undercount without rereading session history.
16. The pinned Copilot SDK emits one `assistant.usage` event per LLM API call with a required model and optional token/cache/reasoning fields.
    Its `cost` field is a billing multiplier, not USD, and must not be stored as `costUsd`; the installed payload has no `agentId`, only free-form `initiator` and deprecated `parentToolCallId` attribution.
17. OpenCode sends repeated `message.updated` notifications for an assistant message.
    The current “latest assistant only” state loses tool-heavy calls; usage must be retained once per assistant message id and repeated updates must replace, not duplicate, that message.
18. Grok exposes aggregate tokens/USD plus per-model `modelCalls`, not per-model tokens or USD.
    Multi-model totals cannot be apportioned honestly.
19. OMP primary `message_end` records contain provider, model, token/cache/reasoning, and USD usage.
    Advisor transcripts are not merely siblings of the main transcript: task-agent transcripts and nested advisor transcripts live recursively under the main session artifact directory.
20. OMP fork mode copies prior transcript artifacts.
    Reading whole destination files after a fork would count historical usage again; resume/fork enrichment must be byte-delta based and verify the copied prefix before reading it.
21. OMP is an arbitrary external binary, not a pinned package dependency.
    Transcript enrichment must fail closed when its session layout or file prefix cannot be proven.
22. The Pi model catalog wrapper currently drops cache rates and tier data even though the pinned SDK’s `ModelCost` includes `input`, `output`, `cacheRead`, `cacheWrite`, and request-wide tiers.
23. Global and repository configuration are distinct.
    Pricing is operator financial policy and belongs only in `~/.archon/config.yaml`; a repository must not be able to change installation reporting estimates.
24. The current PostgreSQL migration contains 19 application tables plus four PostgreSQL-only Better Auth tables, although its header and `AGENTS.md` inventory omit some application tables.
    This feature adds the twentieth application table and must correct the inventory rather than call it “table 21.”
25. SQLite/PostgreSQL parity currently guards 138 compared non-auth columns.
    The new normalized ledger below adds 17 columns, so the expected post-change floor is 155; the implementation must use the count produced by the parity test rather than blindly copying a number.

## Constitution Check

### Before implementation

- **Type safety:** PASS.
  The provider contract is additive, persistence and route schemas use Zod, types are derived with `z.infer`, records use explicit key schemas, and no `any` is required.
- **Package boundaries:** PASS.
  Workflows imports the contract only from `@archon/providers/types`; core owns database/config/pricing policy; server owns HTTP schemas; web consumes generated API types.
- **Single-tenant model:** PASS.
  Reporting is installation-wide with optional project filtering; no tenant columns or row scoping are added.
- **Workflow language constitution:** PASS.
  No YAML field or runtime graph behavior changes.
- **Fail fast and explicit errors:** PASS.
  Invalid provider data is rejected at the boundary and logged; absence stays absent.
  Cost-observability failures do not mutate lifecycle state or fail already-completed AI work.
- **Additive schema:** PASS.
  One new table and indexes are added to both dialects; no rename, retype, or drop occurs.
- **KISS/YAGNI:** PASS.
  The plan removes speculative chat support, parent rollup, mutable duplicate metadata, opaque map keys, and replace semantics.
- **Reproducibility:** PASS.
  Catalog estimates use the locked Pi implementation plus the operator's current catalog and are materialized with provenance once; validation uses package-isolated tests and the repository generators.
- **Security:** PASS with explicit OMP controls.
  Pricing is not repository-controlled, SQL grouping is whitelisted, and transcript reads are bounded and path-checked.
- **Reversibility:** PASS.
  Old binaries ignore the additive table/event; rollback is application-only and never drops collected data.

Re-run this check after implementation.

## Locked Design

### 1. Accounting unit and ownership

The accounting unit is one completed provider stream pass, not one completed DAG node.

A pass is one invocation of `IAgentProvider.sendQuery()` that yields at least one terminal result containing a non-empty valid usage breakdown.

The provider contract requires the last terminal result for a `sendQuery()` invocation to be cumulative for that invocation.

If a provider emits intermediate cumulative results while background tasks drain, the executor keeps only the latest result from that pass.

Each standard structured-output reask is a new pass.

Each direct-loop iteration/reask is a new pass.

Each outer executor retry and each manual retry epoch creates new append-only records.

Usage belongs to the run that directly invoked the provider.

A child workflow run records its own AI usage; its parent does not copy that usage into the new event or ledger.

The existing legacy parent totals remain unchanged and are explicitly presented as a different, legacy scope.

### 2. Provider usage contract

Add the following additive contract in `packages/providers/src/types.ts`:

```ts
export type ModelSource = 'reported' | 'requested' | 'unknown';

export interface ModelUsageEntry {
  /** Upstream model/catalog namespace: anthropic, openai, xai, github-copilot, etc. */
  provider: string;
  /** Concrete model id, or null when the upstream source did not identify one. */
  model: string | null;
  /** Whether model came from an upstream response, effective request, or neither. */
  modelSource: ModelSource;
  /** Provider-reported non-cached input when distinguishable; otherwise its input field. */
  inputTokens?: number;
  /** Provider-reported output, inclusive of reasoning where the SDK defines it that way. */
  outputTokens?: number;
  /** A subset of outputTokens, never added to output again. */
  reasoningTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  /** Known upstream model-call count; omitted when the SDK reports only an aggregate turn. */
  requests?: number;
  /** Upstream SDK/CLI-supplied USD; never an Archon estimate or subscription multiplier. */
  costUsd?: number;
  /** Present only when the upstream source identifies hidden delegated work. */
  kind?: 'advisor' | 'subagent';
}

export type UsageBreakdown = readonly ModelUsageEntry[];
```

Add `usageBreakdown?: UsageBreakdown` to the `result` variant.

Retain `modelUsage?: Record<string, unknown>` as deprecated compatibility data; do not remove it in this work.

Do not add new raw producers, but preserve an existing built-in emission while adding the normalized field; Grok currently emits raw `modelUsage`, so removing that runtime field is outside this additive change.

Third-party implementations and consumers remain source-compatible.

The array is intentional:

- Model ids can contain `/`, so `${provider}/${model}` is not a safe identity key.
- Multiple calls to the same model must remain distinct when the upstream source reports them distinctly; this improves tiered estimates.
- Aggregate SDK reports remain one aggregate entry and are never split into fabricated calls.
- Identity lives in fields, not in a string that downstream code must parse.

Contract invariants:

- `provider` is a trimmed, non-empty string.
- `modelSource === 'unknown'` requires `model === null`.
- `modelSource === 'reported'` or `'requested'` requires a non-empty `model`.
- Every present token field is a non-negative safe integer; a present `requests` count is a positive safe integer.
- `reasoningTokens` cannot exceed `outputTokens` when both are present.
- `costUsd` is finite and non-negative; zero is valid and must not be dropped.
- An entry has at least one numeric measure.
- Missing measures remain `undefined`, not zero.
- Estimated fields, run ids, node ids, prompts, and transcript text are forbidden in this provider contract.

Create a small provider-internal normalizer in `packages/providers/src/usage-breakdown.ts` that validates individual entries without importing workflow or core code.

It may concatenate observations and sum only where an upstream SDK itself reports an aggregate; it must not create opaque identity keys or turn absent values into zero.

### 3. Model attribution and observability

`agentProvider` is the Archon adapter selected by the workflow.

It is trusted execution context attached once by the workflow recorder; it is not repeated in provider-supplied usage entries.

`provider` is the upstream model/catalog namespace, not necessarily the payment processor used by a hosted or subscription account.

These axes must not be conflated.

Examples:

| Selected Archon adapter | Attached `agentProvider` | Entry `provider` source |
| --- | --- | --- |
| Claude | `claude` | `anthropic` |
| Codex | `codex` | `openai` |
| Grok | `grok` | `xai` |
| Pi | `pi` | Pi assistant message `provider` |
| OMP | `omp` | OMP assistant message `provider` |
| OpenCode | `opencode` | OpenCode `providerID` |
| Copilot | `copilot` | `github-copilot` |

Update `packages/providers/src/observability.ts` to resolve a span model in this order:

1. Terminal `resolvedModel`.
2. Effective `options.model`.
3. Configured assistant model.
4. No model attribute.

Never select the first element of a multi-model usage array.

For Claude, preserve `resolvedModel` only when the SDK’s `modelUsage` has exactly one model.

When it has multiple models, emit all usage entries, warn, and omit `resolvedModel`; selecting the greatest-output model is still a guess about which model was “main.”

### 4. Provider mappings

#### Claude

In `packages/providers/src/claude/provider.ts`, map every SDK `modelUsage` entry to one normalized observation:

- `provider: 'anthropic'`
- model key with `modelSource: 'reported'`
- `inputTokens`, `outputTokens`, `cacheReadInputTokens`, `cacheCreationInputTokens`, and `costUSD`
- omit `requests`; `webSearchRequests` is not a model-call count and `costUSD` already carries authoritative cost

Normalize usage before classifying an SDK result as an API failure.

If Claude’s outer provider retry consumes a usage-bearing result, carry those observations into the eventual terminal result.

If the last attempt fails, yield an `isError` result containing the accumulated usage and the same typed classification details before returning, so the executor can persist usage and then fail the node.

Do not weaken the existing typed auth/rate-limit/crash classification or retry policy.

If the SDK throws or closes without usage, do not synthesize an entry.

#### Pi

In `packages/providers/src/community/pi/event-bridge.ts`, inspect every assistant message in the current `agent_end.messages` array.

Produce one observation per assistant message:

- `provider: message.provider`
- non-empty `message.responseModel` with `modelSource: 'reported'`; otherwise non-empty `message.model` with `modelSource: 'requested'`; otherwise null/unknown
- input/output/cache-read/cache-write/reasoning and `cost.total`
- `requests: 1`

Reasoning is a subset of output.

Sum every assistant message into the legacy `TokenUsage`/cost result instead of using only the last message.

Continue to use the last assistant message for stop reason, error, structured-output completion, and `resolvedModel` semantics.

#### Codex

In both Codex terminal-result construction paths in `packages/providers/src/codex/provider.ts`:

- `provider: 'openai'`
- effective requested model with `modelSource: 'requested'`, or `model: null`/`unknown` when no effective model is known
- `inputTokens = max(input_tokens - cached_input_tokens, 0)`
- `cacheReadTokens = cached_input_tokens`
- `outputTokens = output_tokens`
- `reasoningTokens = reasoning_output_tokens`
- omit request count and USD

Keep legacy `TokenUsage.input` unchanged for compatibility; it currently reflects Codex’s total input value.

Treat reasoning as a subset of output.

No usage entry is possible for a failed/incomplete Codex turn that provides no `turn.completed.usage`.

#### Grok

In `packages/providers/src/grok/event-parser.ts`:

- Use `provider: 'xai'`.
- Pass the effective requested model from `packages/providers/src/grok/provider.ts` into the parser; the current parser has no model-request context.
- If `modelUsage` names exactly one valid model, attach aggregate tokens/USD and its `modelCalls` to that reported model.
- If it names multiple valid models, emit one requests-only observation per model and one `model: null`/`modelSource: 'unknown'` observation containing aggregate tokens/USD with no request count.
- If it names no model, attach aggregate values to the effective requested model as `requested` when the provider knows it; otherwise use the unknown-model observation.
- Do not divide aggregate tokens or USD across model names.
- Preserve Grok’s existing raw `modelUsage` alongside normalized observations for compatibility; new code must consume `usageBreakdown`.

#### OMP primary stream

In `packages/providers/src/community/omp/event-parser.ts`, produce one observation per assistant `message_end` using its reported provider/model and full usage object.

Include input, output, reasoning, cache read/write, `cost.total`, and `requests: 1`.

Continue accumulating the existing legacy totals and last `resolvedModel`.

The final `usageBreakdown` for the stream contains every observed primary assistant call.

#### OpenCode

In `packages/providers/src/community/opencode/session.ts`, keep a map of latest assistant info by assistant message id rather than one `latestAssistantInfo` value.

Repeated `message.updated` events replace the same map entry.

At `session.idle`, produce one observation per distinct assistant message using `providerID`, `modelID`, cost, and token/cache/reasoning fields.

The single-session path omits `kind`.

In `packages/providers/src/community/opencode/multi-agent.ts`, maintain the same per-message map in each child state and mark those observations `kind: 'subagent'`.

Sum all distinct messages into legacy totals.

Fix `packages/providers/src/community/opencode/tokens.ts` so reasoning is not added to output a second time; the pinned SDK defines it as an output subset.

#### Copilot

In `packages/providers/src/community/copilot/event-bridge.ts`, capture every `assistant.usage` event instead of overwriting the preceding event.

Each observation uses:

- `provider: 'github-copilot'`
- reported `data.model`
- optional input/output/cache-read/cache-write/reasoning values
- `requests: 1`
- `kind: 'subagent'` only when non-empty `data.parentToolCallId` explicitly links the call to a parent tool invocation; otherwise omit it

Ignore `data.cost` for USD because the SDK documents it as a model multiplier.

Do not classify from the free-form `initiator` example text; the installed SDK does not define an enum contract for it.

Sum usage events into legacy token totals without adding reasoning twice.

#### Qoder

Leave `packages/providers/src/community/qodercli/provider.ts` unchanged unless its actual result contract gains authoritative usage.

No row is better than fabricated zero usage.

### 5. OMP hidden-session enrichment

Create `packages/providers/src/community/omp/session-usage.ts`, not an advisor-only helper.

It must capture both advisor and task-subagent usage.

The resolver must support and test the layouts actually used by the supported OMP formats:

- main transcript: `<sessionDir>/<timestamp>_<sessionId>.jsonl`
- main artifact directory: the transcript path without `.jsonl`
- top-level advisor transcripts inside that artifact directory
- task-agent transcripts recursively inside the artifact directory
- nested advisor transcripts next to their owning task-agent transcript according to OMP’s filename constructors

Do not assume all advisor files are siblings of the main transcript.

Session-directory resolution order:

1. Exact `PI_CODING_AGENT_SESSION_DIR` when provided to the spawned OMP environment.
2. The supported `PI_CODING_AGENT_DIR`/default OMP session-root derivation mirrored in one documented resolver.
3. If the layout cannot be proven, warn once and omit hidden usage.

Do not move OMP’s session directory; doing so would break resume compatibility.

For a fresh persisted session, resolve the emitted session id after process exit and parse only files belonging to that session artifact directory.

For `--resume` or `--fork`:

1. Before spawning OMP, resolve the source transcript/artifact directory.
2. Snapshot each candidate file by relative path, byte length, and a digest of the existing prefix.
3. After exit, resolve the destination transcript from the emitted session id.
4. For a file whose destination prefix matches the snapshot, parse only appended bytes.
5. Parse the complete contents of genuinely new files.
6. If a copied file’s prefix, identity, or containment check fails, warn and omit that file rather than risk double-counting history.
7. If the pre-spawn snapshot cannot be established, continue the OMP call but skip hidden-session enrichment for that invocation.

A snapshotted JSONL file must end at a newline record boundary.
If it does not, omit that file because parsing only later bytes could reinterpret a partial historical record.

For `--no-session`, do not search for transcripts.

Reader safety requirements:

- Resolve real paths and reject symlinks or paths escaping the resolved session artifact root.
- Open and read the verified file itself, re-checking file identity/size after open where the platform permits, so a path swap cannot redirect the reader after containment validation.
- Validate the main session header id and cwd before trusting the artifact directory.
- Search only the exact bounded session root and exact session id; never recursively scan the home directory.
- Stream JSONL rather than loading whole transcripts.
- Cap candidate files at 1,000, total bytes considered at 256 MiB, bytes read from any one file at 64 MiB, and a JSONL line at 8 MiB; define named constants and boundary tests.
- If any bound is exceeded, omit all hidden-session enrichment for that invocation and warn rather than publish a silently partial advisor/subagent total; primary streamed usage remains valid.
- Parse assistant messages only; never persist prompt, response, tool, or transcript content.
- Malformed lines/files are logged with path-safe metadata and omitted.
- Transcript read failures never change the provider result’s success/error status.

Mark advisor observations `kind: 'advisor'` and task-agent observations `kind: 'subagent'`.

Enrich the final result after process exit on success, protocol error, or non-zero exit when usage is available.

Add hidden usage to the legacy aggregate tokens/cost so existing totals improve, but keep `numTurns` as the primary-stream count.

### 6. Persisted usage event

Add `node_usage_recorded` to `WORKFLOW_EVENT_TYPES` in `packages/workflows/src/store.ts`.

Create `packages/workflows/src/schemas/usage-breakdown.ts` with strict Zod schemas and re-export them from `packages/workflows/src/schemas/index.ts`.

Import `z` from `@hono/zod-openapi`, derive types with `z.infer`, and add a compile-time structural check against the provider contract imported from `@archon/providers/types`.

At the provider-result runtime boundary, validate entries independently, retain valid entries in order, and log only the rejected index/schema issues, not the raw value.

A malformed entry must not poison other authoritative observations in the same result; if none remain, do not write an event.

The persisted event is the authoritative per-run JSON sink for raw observed usage:

```json
{
  "schema_version": 1,
  "agent_provider": "codex",
  "usage_breakdown": [
    {
      "provider": "openai",
      "model": "gpt-5.4",
      "model_source": "requested",
      "input_tokens": 100,
      "output_tokens": 20,
      "reasoning_tokens": 8,
      "cache_read_tokens": 40
    }
  ],
  "retry_epoch": 0,
  "iteration": null,
  "reask_attempt": 0,
  "terminal_error": false,
  "error_subtype": null
}
```

Use snake_case in persisted event data and camelCase in TypeScript/API response objects.

The event has the actual persisted `step_name`:

- normal node: node id
- loop-group body node: the existing namespaced `<groupId>.<nodeId>` id
- direct loop: loop node id

Do not add the breakdown to `node_completed` or new run metadata.

Those sinks only describe successful/latest state and cannot faithfully represent failed attempts or append-only spend.

Keep the existing `node_completed.cost_usd`, token fields, run metadata totals, loop accounting, and budget behavior for compatibility.

Built-in legacy aggregates may become more accurate where the provider currently keeps only the last reported call or double-counts reasoning, but the executor must not use the new ledger, estimates, or OMP transcript enrichment for `maxBudgetUsd` decisions.
Claude remains the only built-in provider advertising `costControl`, and its existing SDK-enforced budget option/error path stays unchanged.

Do not add `node_usage_recorded` to `INTERNAL_EVENT_TYPE_MAP` or `DASHBOARD_SOURCE_EVENT_TYPES`.

Map it explicitly to a compact `system` event in `packages/web/src/experiments/console/primitives/event.ts` so raw usage JSON is not rendered by the unknown-event fallback.

### 7. Usage-recorder port and executor write sites

Do not add an unrelated accounting method to the already broad `IWorkflowStore`.

Create a separate narrow port in `packages/workflows/src/usage.ts`:

```ts
export interface IWorkflowUsageRecorder {
  recordWorkflowUsage(input: RecordWorkflowUsageInput): Promise<void>;
}
```

`RecordWorkflowUsageInput` carries run id, actual step name, the selected agent-provider id, validated usage array, retry epoch, optional loop iteration, reask attempt, and terminal error metadata.

The executor obtains the agent-provider id from its resolved node execution context, never from a usage entry.

It does not carry pricing or ledger columns; core owns that policy.

Add a required `usageRecorder: IWorkflowUsageRecorder` dependency to `WorkflowDeps` in `packages/workflows/src/deps.ts`.

Re-export the recorder/input types from `deps.ts` so core continues to import workflow contracts through the existing `@archon/workflows/deps` package export; no new package-root import is needed.

Create the core implementation in `packages/core/src/workflows/usage-recorder.ts` and wire it in the one canonical `createWorkflowDeps()` factory.

Leave `createWorkflowStore()` and `IWorkflowStore` unchanged.

Update every structural `WorkflowDeps` implementation and test helper.

Use `rg` over `WorkflowDeps`, `createWorkflowDeps`, and explicit dependency object literals before considering this task complete.

In `packages/workflows/src/dag-executor.ts`:

- Capture the last valid terminal `usageBreakdown` separately inside each standard `runStreamPass`.
- In a non-throwing `finally`/pass-exit path, call `deps.usageRecorder.recordWorkflowUsage` exactly once when that pass reported usage.
- Record before the structured-output reask decision and before an error result escapes.
- Include the current reask attempt, retry epoch, and error subtype.
- Do the same in the separate direct-loop streaming path for every iteration/reask.
- Let ordinary loop-group AI nodes use the standard path and existing namespaced step name; do not add a group-level duplicate.
- Do not write a row for bash, script, command, gate, route, cancel, or `workflow:` wrapper nodes unless they directly invoke an AI provider through one of the two traced paths.
- Do not copy child-run usage into the parent.

An exception/abort with no terminal usage result remains unrecorded because no authoritative numbers exist.

The method must never mask the original node result or exception.

### 8. Ledger schema

Add `remote_agent_usage_ledger` as a normalized child of the audit event.

Do not duplicate run id, node id, workflow name, codebase id, user id, source, or timestamp in the ledger; those are available through the referenced event and run and duplicating them creates consistency hazards.

The table has exactly these 17 columns:

| Column | PostgreSQL | SQLite | Rules |
| --- | --- | --- | --- |
| `id` | UUID | TEXT | primary key |
| `workflow_event_id` | UUID | TEXT | non-null FK to workflow events, cascade delete |
| `entry_index` | INTEGER | INTEGER | non-negative position in event array |
| `agent_provider` | TEXT | TEXT | non-empty |
| `provider` | TEXT | TEXT | non-empty |
| `model` | TEXT nullable | TEXT nullable | null only for unknown source |
| `model_source` | TEXT | TEXT | reported/requested/unknown |
| `kind` | TEXT nullable | TEXT nullable | advisor/subagent/null |
| `tokens_input` | BIGINT nullable | INTEGER nullable | non-negative |
| `tokens_output` | BIGINT nullable | INTEGER nullable | non-negative |
| `tokens_reasoning` | BIGINT nullable | INTEGER nullable | non-negative, not above output when output exists |
| `tokens_cache_read` | BIGINT nullable | INTEGER nullable | non-negative |
| `tokens_cache_write` | BIGINT nullable | INTEGER nullable | non-negative |
| `requests` | BIGINT nullable | INTEGER nullable | positive when present |
| `cost_usd` | DOUBLE PRECISION nullable | REAL nullable | reported, non-negative |
| `cost_estimated_usd` | DOUBLE PRECISION nullable | REAL nullable | estimated, non-negative |
| `pricing_source` | TEXT nullable | TEXT nullable | config/catalog only with estimate |

Constraints:

- Unique `(workflow_event_id, entry_index)`.
- At least one token, request, reported-cost, or estimated-cost measure is non-null.
- Reported and estimated USD are mutually exclusive.
- `pricing_source` is present exactly when `cost_estimated_usd` is present; the matched identity is already the row's exact `provider`/`model` pair and is not duplicated in another column.
- `model_source` and model nullability agree.
- Numeric values are non-negative, with requests positive when present; application validation also enforces safe integers and finite values.

Indexes:

- ledger `(workflow_event_id, entry_index)` through the unique constraint
- ledger `(agent_provider)`
- ledger `(provider, model)`
- workflow events `(created_at)` partial to `event_type = 'node_usage_recorded'`, or the closest dialect-equivalent index proven by query-plan tests
- workflow runs `(codebase_id)`, which is currently missing and is required for project reporting joins

Place all PostgreSQL indexes and column comments in the final “Indexes and column comments” section after every additive column statement.

Mirror the table and constraints in `packages/core/src/db/adapters/sqlite.ts`.

Update the migration header and `AGENTS.md` table inventory to enumerate all 20 application tables plus the four PostgreSQL-only Better Auth tables after this change, including the previously omitted checkpoint/schema-version/event-delivery tables.

Raise `MIN_NON_AUTH_COLUMNS` to the actual post-change compared count reported by the parity test; 138 existing plus 17 new columns predicts 155.

Generate `packages/core/src/db/bundled-schema.generated.ts` only with `bun run generate:bundled-schema`.

### 9. Atomic event and ledger write

Create `packages/core/src/db/usage-ledger.ts` and `packages/core/src/schemas/usage-ledger.ts`.

Re-export core schemas from `packages/core/src/schemas/index.ts` and a `usageDb` namespace from both `packages/core/src/db/index.ts` and `packages/core/src/index.ts` for server/CLI callers.

Change `insertWorkflowEvent()` in `packages/core/src/db/workflow-events.ts` to accept an optional caller-generated event id and return the id it inserted.

Existing callers may ignore the return value.

The core recorder’s `recordWorkflowUsage()` implementation performs this sequence:

1. Strictly validate the complete input and convert the camelCase provider entries to the versioned snake_case event payload.
2. Resolve any estimates and generate one event id before opening a database transaction.
3. Begin `getDatabase().withTransaction()`.
4. Insert one `node_usage_recorded` event using `insertWorkflowEvent()` with that id.
5. Insert one ledger row per `usage_breakdown` entry with the same array index.
6. Commit.

There is no delete or replace path.

If validation fails, log a structured warning and write nothing.

If the transaction fails, it rolls back both sinks.

Then attempt one event-only fallback with the same pre-generated id and authoritative JSON payload.

That preserves the run audit even though the normalized ledger is incomplete.
It does not preserve an Archon-computed point-in-time estimate, which intentionally never enters event JSON.

The fallback insert must use an explicit duplicate-id-ignore option limited to this recovery path, so an ambiguous commit response cannot create a second usage event when the original transaction actually committed.

If fallback event creation also fails, retain the existing structured error log as the final degradation; never fail or mutate the workflow lifecycle.

Do not enqueue an external workflow event for either path.

### 10. Price estimation

Add operator-only pricing to `GlobalConfig`:

```yaml
pricing:
  models:
    - provider: openai
      model: gpt-5.4
      input: 2.50
      output: 15.00
      cacheRead: 0.25
      cacheWrite: 0
```

Rates are USD per one million tokens.

`models` is a list so provider and model remain separate identity fields even when either contains `/`.

`provider` and `model` are trimmed non-empty strings, duplicate `(provider, model)` pairs are invalid, and the four rate fields are optional finite non-negative numbers with at least one required per model entry.

Do not add `pricing` to `RepoConfig`, `MergedConfig`, `SafeConfig`, configuration mutation endpoints, or the web settings UI.

Load it directly through cached `loadGlobalConfig()` at the core accounting boundary.

Validate pricing entries at use time because config loading currently parses YAML into TypeScript types without a runtime schema.

An invalid rate logs a warning and leaves that observation unpriced; it does not fail a node or partially apply the invalid entry.

Create `packages/core/src/usage/estimate.ts` with this precedence:

1. If `costUsd` is present, including zero, store it in `cost_usd` and do not estimate.
2. Exact global-config `(provider, model)` pair.
3. Exact Pi catalog `provider` and `id` pair.
4. No estimate.

Never use a bare-model, prefix, substring, case-folded, or fuzzy match.

Treat `costUsd` as upstream-supplied, not invoice-verified; the source SDK/CLI may itself have derived it from a catalog.

Never estimate an unknown model.

Extend `PiModelInfo.cost` in `packages/providers/src/community/pi/model-catalog.ts` to expose cache-read/cache-write rates and optional request-wide tiers from the pinned SDK.

Update `packages/server/src/routes/schemas/provider.schemas.ts`, route tests, and generated web types for that additive model-catalog response.

Apply the matched rate to input, output, cache-read, and cache-write tokens.

Reasoning is already inside output and is not charged again.

Require both input and output token counts before estimating a model call.

Apply cache rates only to cache dimensions the provider reported; the contract's input field already remains the provider's unsplit input value when it cannot distinguish cache usage.

If an observation has positive reported usage in any category whose matched pricing entry lacks a rate, leave the whole estimate null rather than publish a known-partial number.

Missing token dimensions remain missing in report coverage and are never rewritten as zero.

Request-only observations remain unpriced in v1.

Apply the highest tier whose threshold is strictly below aggregate input `inputTokens + cacheReadTokens + cacheWriteTokens`, matching the pinned catalog’s `calculateCost()` rule.

For SDKs that expose only a multi-call aggregate, the result remains explicitly approximate because per-request tier boundaries cannot be reconstructed.

Store the materialized estimate and `pricing_source` in the ledger; the row's separate `provider` and `model` columns already identify the exact match.

Never put estimates in provider results, workflow-event JSON, legacy run totals, or `cost_usd`.

The Pi catalog implementation and built-in snapshot are pinned by the lockfile, while the operator's `~/.pi/agent/models.json` entries are merged by the existing registry; the merged catalog and Archon configuration are process-cached.

Document that manual pricing or user Pi catalog edits take effect in a long-running server after restart; a CLI invocation starts a fresh process.
Do not add a file watcher in this feature.

Do not perform file reads or catalog construction inside the database transaction.

### 11. Query semantics and REST API

Add a core query operation and a camelCase `usageReportSchema`/`UsageReport` inferred with `z.infer` in `packages/core/src/schemas/usage-report.ts`.

The core query and CLI use that inferred report contract.

Register `GET /api/usage` with `registerOpenApiRoute(createRoute(...), handler)`.

Put HTTP query schemas and the OpenAPI-labelled response wrapper in `packages/server/src/routes/schemas/usage.schemas.ts`, reuse the core report schema, and import `z` from `@hono/zod-openapi`.

Do not create a parallel handwritten API response interface or make core/CLI import server code.

Query parameters use the project’s camelCase API convention:

- `from`, `to`: both present or both absent, RFC 3339 instants, interpreted as a half-open UTC range `[from, to)`
- `codebaseId`
- `agentProvider`
- `provider`
- `model`
- `kind`: `unclassified`, `advisor`, or `subagent`; `unclassified` maps to SQL `NULL`
- `runId`
- `nodeId`: exact persisted step name; valid only with `runId`
- `groupBy`: `agent`, `provider`, `model`, `project`, `run`, `day`, or `node`; default `provider`

Defaults and limits:

- With neither dates nor `runId`, use the current UTC calendar month.
- With `runId` and no dates, query the entire direct run.
- When dates are present, require `from < to`.
- Cross-run ranges cannot exceed 366 days.
- `groupBy=node` requires `runId`.
- `nodeId` requires `runId`.
- Return at most 500 groups.
- Fetch 501 to detect overflow and return a 400 narrowing error; never return a silently truncated accounting report.
- Return groups in a deterministic ascending order by their dimension tuple (with SQL `NULL` values first) so API snapshots, CLI output, and pagination-free UI rendering are stable across dialects.

Group dimensions are fixed:

| `groupBy` | Dimensions |
| --- | --- |
| `agent` | `agentProvider` |
| `provider` | `provider` |
| `model` | `provider`, `model`, `modelSource` |
| `project` | `codebaseId`, current codebase name; null means the run is no longer assigned |
| `run` | `runId`, `workflowName`, `codebaseId` |
| `day` | UTC `YYYY-MM-DD` |
| `node` | `runId`, `nodeId`, `agentProvider`, `provider`, `model`, `modelSource`, `kind` |

Use explicit optional dimension fields in the response, not opaque concatenated keys.

The response has this stable top-level form:

```ts
{
  scope: {
    from: string | null;
    to: string | null;
    codebaseId?: string;
    runId?: string;
    includesChildRollup: false;
  };
  groupBy: 'agent' | 'provider' | 'model' | 'project' | 'run' | 'day' | 'node';
  totals: UsageMetrics;
  groups: Array<{ dimensions: UsageDimensions; metrics: UsageMetrics }>;
  coverage: UsageLedgerCoverage;
}
```

For an unfiltered installation report, child runs appear as their own direct-use run rows; no parent contains a copied child charge.

Each totals/group metric object contains:

- nullable sums for input, output, reasoning, cache-read, cache-write, and requests
- nullable `reportedUsd`
- nullable `estimatedUsd`
- `recordCount`
- missing-record counts for every token/request metric
- `rowsMissingUsd`, meaning neither reported nor estimated USD exists

Do not add reported and estimated USD into one “effective” number.

Return ledger coverage:

```ts
{
  usageEventCount: number;
  ledgeredEventCount: number;
  unledgeredEventCount: number;
  hasRecordedUsage: boolean;
  historicalBackfill: false;
  filterScope: 'date-project-run-node';
}
```

Coverage is evaluated using only date, project, run, and node filters because a fallback event has no normalized row on which agent/provider/model/kind filters can operate.

This is ledger-integrity coverage only: it compares new usage events with normalized rows.
It cannot detect a provider pass that emitted no event, including passes produced by an older writer or an SDK with no terminal usage object, and `historicalBackfill: false` makes that boundary machine-readable.

Document this conservative scope in the OpenAPI descriptions and UI tooltip.

Use the event’s timestamp as the accounting timestamp and UTC-day source.

Join ledger → workflow event → workflow run → codebase.

Convert PostgreSQL `SUM(BIGINT)` and `COUNT(*)` strings to safe JavaScript numbers at the boundary and reject values beyond `Number.MAX_SAFE_INTEGER` rather than round silently.

Validate USD aggregates as finite non-negative numbers and fail the report with a structured error rather than serialize `NaN`/infinity or corrupted negative totals.

Use dialect-specific timestamp parameter formatting and UTC day expressions.

All filter values are SQL parameters.

All dynamic group/order SQL fragments come from an exhaustive enum switch; never interpolate request strings.

Use the installation’s existing API authentication.

This remains single-tenant visibility: any authenticated install user sees installation usage, matching existing run visibility.

### 12. Run-detail API

Extend `workflowRunDetailSchema` in `packages/server/src/routes/schemas/workflow.schemas.ts` with:

- `usage`: the same usage response schema, nullable

In the existing `GET /api/workflows/runs/{runId}` handler, query the entire direct run with `groupBy: 'node'`.

The nested response keeps the common object-valued `scope`: its `runId` is the requested run, `from`/`to` are null, and `includesChildRollup` is false.
Do not introduce a second string-valued `scope` discriminator.

If usage querying fails, log the error and return `usage: null`; do not turn a previously working run-detail request into HTTP 500.

Old runs with no usage events return a valid empty summary with `hasRecordedUsage: false`.

Do not walk `parent_run_id` or include child runs.

### 13. CLI

Add top-level `archon usage` in `packages/cli/src/commands/usage.ts` and wire it through `packages/cli/src/cli.ts`.

Supported flags:

- `--since <RFC3339>`
- `--until <RFC3339>`
- `--by agent|provider|model|project|run|day|node`
- `--codebase-id <uuid>`
- `--agent <id>`
- existing global `--provider <id>`
- `--model <id>`
- `--kind unclassified|advisor|subagent`
- existing global `--run-id <id>`
- existing global `--node <persisted-step-id>`; valid only with `--run-id`
- `--json`

Do not use `--from` or `--to`; `--from` already owns worktree branch selection, and matching `--since`/`--until` avoids an asymmetric collision.

Add `usage` to `noGitCommands` and update the mirrored test in `packages/cli/src/cli.test.ts`.

Because top-level parsing uses `strict: false`, add command-specific validation that rejects flags not supported by `usage` rather than silently ignoring typos.

Reuse the core query operation, defaults, filters, range bounds, and node-group requirement; do not duplicate SQL.

Human output shows reported USD as `$…`, estimates as `≈$…`, exact known zero as `$0.00`/`≈$0.00`, and absent values as `n/a`.

Use two decimals at or above one cent, up to six decimals below one cent, and a `<$0.000001`/`≈<$0.000001` floor for smaller positive values; never round a positive cost into the zero representation.

Print a coverage warning when `unledgeredEventCount > 0`.

`--json` writes exactly the API-equivalent camelCase object to stdout through existing stdout helpers and keeps logs off stdout.

Document examples and the half-open UTC range in `packages/docs-web/src/content/docs/reference/cli.md`.

### 14. Console Cost page and run detail

Add one route, `/console/cost`, in `ConsoleApp.tsx` and one installation-level navigation item in `ProjectRail.tsx`.

Do not create a duplicate project-scoped Cost route; project is a filter on the one page.

Create:

- `packages/web/src/experiments/console/routes/CostPage.tsx`
- `packages/web/src/experiments/console/skills/usage.ts`
- `packages/web/src/experiments/console/components/UsageBreakdownTable.tsx`

Export the usage skill from `packages/web/src/experiments/console/skills/index.ts`.

Use types from `packages/web/src/lib/api.generated.d.ts` through the established API re-exports.

Never import workflows/core packages into web.

Add a normalized usage cache key containing every filter and grouping value.

The Cost page defaults to the current UTC month and provides date, project, agent/provider/model/kind filters, grouping selection including run, run-detail links from run groups with a non-null `codebaseId`, and an explicit Refresh control.

Use UTC date-only “From” and “Through” controls: send UTC midnight for From and UTC midnight after Through as the API's exclusive `to`, and reject a range over 366 days before fetching.

A run whose project was deleted remains visible but has no link because the existing run-detail route requires `/console/p/:projectId/r/:runId`; do not invent a second run-detail route for this edge case.

No SSE subscription is needed in v1.

Show reported USD, estimated USD, unpriced row count, token/request coverage, and ledger coverage as separate values, using the same zero-versus-small-positive display rule as the CLI.

The empty state distinguishes “no usage recorded” from a known zero cost.

Update `packages/web/src/experiments/console/skills/runs.ts` to derive the run-detail response from the generated schema and retain its new `usage` value.

Pass the direct-run usage summary into `RunDetailHeader`, `RunStream`, and `NodeDivider` as needed rather than reconstructing accounting from visible lifecycle events.

The run header shows direct reported and estimated USD separately.

If a non-null usage report has no recorded entries but the legacy run has a cost, show it with an explicit “legacy total” label rather than present it as the new direct ledger total.

Treat `usage: null` as “usage report unavailable” with a visible warning; treat a non-null report with `hasRecordedUsage: false` as “not recorded.”
Neither state is zero, and query failure must not be silently replaced by the legacy value.

Node rows show cumulative usage across all recorded attempts/iterations for that actual step name and expand into the shared breakdown table.

Failed nodes can show usage because the data comes from the dedicated event/ledger, not `node_completed`.

Use existing design tokens only.

Map `node_usage_recorded` to `kind: 'system'` in the event primitive and add a regression test proving it does not render raw JSON when the System toggle is off.

Regenerate web OpenAPI types with the server running.

## Implementation Sequence

### Task 1: Add and test the provider contract

**Files:**

- Modify `packages/providers/src/types.ts`.
- Modify `packages/providers/src/index.ts` to re-export `ModelSource`, `ModelUsageEntry`, and `UsageBreakdown` with the other public contract types.
- Create `packages/providers/src/usage-breakdown.ts`.
- Create `packages/providers/src/usage-breakdown.test.ts`.
- Modify `packages/providers/src/observability.ts` and its tests.
- Modify `packages/providers/package.json` so every new provider test file runs in an appropriate isolated invocation.

**Work:**

- Add the types and additive result field.
- Retain the deprecated raw field.
- Implement finite/non-negative/absence-preserving normalization.
- Test slash-containing model ids, unknown models, zero cost, absent fields, unsafe integers, reasoning bounds, and forbidden estimates.
- Test that a mixed valid/invalid runtime array preserves only the valid entry without logging its raw payload.
- Update observability precedence and multi-model tests.

**Exit condition:** every provider can emit the new array without a downstream or package-boundary change.

### Task 2: Normalize SDK-native usage

**Files:**

- Modify Claude, Codex, Grok, Pi, Copilot, and OpenCode files named in the provider mappings, including `packages/providers/src/grok/provider.ts` for requested-model context.
- Modify their colocated tests.
- Modify `packages/providers/src/community/pi/model-catalog.ts` and tests.
- Modify `packages/server/src/routes/schemas/provider.schemas.ts` and provider route tests for the additive catalog shape.

**Work:**

- Implement the exact mappings above.
- Preserve terminal error and retry classification.
- Correct Pi/Copilot/OpenCode last-only or overwrite undercounts.
- Correct reasoning double-count behavior.
- Prove legacy totals and new breakdown agree where both are fully observable.

**Exit condition:** fixture results contain truthful normalized observations for all SDK-supported providers and Qoder remains absent.

### Task 3: Add OMP primary and hidden-session usage

**Files:**

- Modify `packages/providers/src/community/omp/event-parser.ts` and tests.
- Create `packages/providers/src/community/omp/session-usage.ts` and tests/fixtures.
- Modify `packages/providers/src/community/omp/provider.ts` and tests.

**Work:**

- Add primary per-message observations.
- Implement exact session resolution, pre-spawn snapshot, prefix verification, delta parsing, recursive task/advisor classification, and bounds.
- Enrich success and usage-bearing error results without changing error status.

**Exit condition:** fresh, resume, fork, nested advisor, nested task, malformed, escaped-path, oversized, and no-session fixtures prove no historical double-count and fail-soft behavior.

### Task 4: Add persistence schemas and additive database shape

**Files:**

- Create `packages/workflows/src/schemas/usage-breakdown.ts` and add its cases to `packages/workflows/src/schemas.test.ts` so the existing isolated schema invocation runs them.
- Modify `packages/workflows/src/schemas/index.ts`.
- Modify `packages/workflows/src/store.ts` only to add the internal `node_usage_recorded` event type.
- Create `packages/core/src/schemas/usage-ledger.ts` and export it.
- Modify `migrations/000_combined.sql`.
- Modify `packages/core/src/db/adapters/sqlite.ts` and `sqlite.test.ts`.
- Regenerate `packages/core/src/db/bundled-schema.generated.ts`.
- Update the database inventory in `AGENTS.md`.

**Work:**

- Add strict event/ledger schemas and all SQL constraints/indexes.
- Correct table inventory and the parity floor.
- Add fresh-schema, reverse-parity, cascade, constraint, idempotence, and statement-order coverage.

**Exit condition:** both dialects have the same 20 non-auth application tables/columns and an old schema upgrades additively.

### Task 5: Implement pricing, atomic writes, and queries

**Files:**

- Create `packages/core/src/usage/estimate.ts` and tests.
- Create `packages/core/src/db/usage-ledger.ts` and tests.
- Create `packages/core/src/schemas/usage-report.ts` and export its inferred report type.
- Modify `packages/core/src/config/config-types.ts` and config-loader tests.
- Modify `packages/core/src/db/workflow-events.ts` and tests.
- Modify `packages/core/src/db/index.ts`.
- Modify `packages/core/src/index.ts`.
- Modify `packages/core/package.json` to run the new DB/pricing test files in package-isolated invocations.
- Create `packages/workflows/src/usage.ts` and modify `packages/workflows/src/deps.ts`.
- Create `packages/core/src/workflows/usage-recorder.ts` and tests.
- Modify `packages/core/src/workflows/store-adapter.ts` only to wire the recorder into `createWorkflowDeps()`; update its dependency-factory tests.

**Work:**

- Add global-only pricing types and use-time validation.
- Implement exact config/catalog estimation and materialization.
- Accept/return explicit event ids in the throwing insert primitive and add duplicate-safe fallback behavior.
- Add the atomic event-plus-ledger transaction and fallback event.
- Implement dialect-safe aggregate queries and coverage.
- Update every `WorkflowDeps` test helper found by repository search.

**Exit condition:** one recorder call either commits matching event/rows, or commits only the detectable fallback event, and never throws into workflow execution.

### Task 6: Record every workflow AI pass

**Files:**

- Modify `packages/workflows/src/dag-executor.ts`.
- Modify `packages/workflows/src/dag-executor.test.ts`.
- Modify `packages/workflows/src/subrun.test.ts`.
- Update other workflow test fixtures that construct `WorkflowDeps`.

**Work:**

- Add standard-path and direct-loop recording at the two actual provider consumption sites.
- Pass actual namespaced ids and attempt metadata.
- Do not add parent rollup or mutable usage metadata.

**Exit condition:** tests prove one append per usage-bearing pass across success, error, reask, retry, loop, resume, and manual retry epoch.

### Task 7: Add API and run-detail contracts

**Files:**

- Create `packages/server/src/routes/schemas/usage.schemas.ts`.
- Modify `packages/server/src/routes/api.ts`.
- Modify `packages/server/src/routes/schemas/workflow.schemas.ts`.
- Modify `packages/server/src/routes/api.workflow-runs.test.ts` and create focused `packages/server/src/routes/api.usage.test.ts` coverage.
- Modify `packages/server/package.json` to run the new route test in its own invocation, preserving `mock.module()` isolation.

**Work:**

- Register `GET /api/usage`.
- Add all query validation, fixed group definitions, cap detection, coverage, and nullable sums.
- Add direct usage to run detail with failure isolation.

**Exit condition:** OpenAPI and route tests prove filters, dates, limits, grouping, old-run emptiness, and run-detail degradation.

### Task 8: Add the CLI

**Files:**

- Create `packages/cli/src/commands/usage.ts` and tests.
- Modify `packages/cli/src/cli.ts` and `cli.test.ts`.
- Modify `packages/cli/package.json` to include the new command test in an isolated invocation.
- Modify `packages/docs-web/src/content/docs/reference/cli.md`.

**Work:**

- Wire top-level parsing without Git validation or flag collisions.
- Reuse the core query.
- Add strict per-command flag validation and exact JSON stdout tests.

**Exit condition:** human and JSON modes distinguish reported, estimated, zero, and missing values and match API semantics.

### Task 9: Add console reporting

**Files:**

- Create the Cost page, usage skill, and shared breakdown table.
- Modify `ConsoleApp.tsx`, `ProjectRail.tsx`, `store/keys.ts`, run skills, run page/header/stream/divider, and event primitive/tests.
- Regenerate `packages/web/src/lib/api.generated.d.ts`.

**Work:**

- Build the single Cost route and filters.
- Show direct run and per-node usage from the API.
- Hide the audit event by default while retaining System visibility.
- Add component tests for loading, request error, empty, partial, zero, sub-cent, estimated, reported, and coverage-warning states.

**Exit condition:** the console answers the product questions without reconstructing costs client-side.

### Task 10: Documentation and final verification

**Files:**

- Modify `packages/docs-web/src/content/docs/reference/configuration.md`.
- Modify any provider capability/setup documentation whose usage limitations changed.
- Do not modify `CHANGELOG.md` in this feature plan.

**Work:**

- Document global-only pricing, exact provider/model pairs and rates, estimate limitations, UTC range semantics, direct-run scope, no backfill, coverage warnings, and OMP fail-soft behavior.
- Re-run the Constitution Check.
- Run the full validation sequence below.

**Exit condition:** documentation and generated artifacts match the implemented public contracts and every required validation passes.

## Test Matrix

### Provider contract

- Missing values stay absent; known zero survives.
- NaN, infinity, negative values, zero requests, unsafe integers, empty identities, model/source mismatch, and reasoning-over-output are rejected.
- A model id containing `/` remains intact.
- Deprecated `modelUsage` remains type-compatible.

### Provider adapters

- Claude: one model, multiple models, cache values, zero USD, usage-bearing final error, retry accumulation, no-usage throw.
- Pi: multiple assistant messages in one `agent_end`, response-model override, cache/reasoning, error message, no assistant.
- Codex: cached input subtraction, cache greater than input guard, reasoning subset, requested model, unknown model, incomplete turn.
- Grok: one model, multiple model-call keys plus unknown aggregate, no model, zero cost, malformed modelCalls.
- OMP stream: multiple primary messages/models, full token dimensions, protocol/non-zero result, no usage.
- OpenCode: repeated updates for one id, several assistant ids, single and multi-agent, reasoning not double-counted.
- Copilot: multiple usage events, deprecated parent-tool attribution present/absent, free-form initiator ignored, multiplier ignored, optional fields.
- Qoder: no fabricated breakdown.

### OMP transcript safety

- Fresh session reads new advisor and task-agent files.
- Resume reads only appended bytes and rejects a snapshot ending mid-record.
- Forked copied history is not counted.
- New nested files are counted once.
- Changed prefix, wrong session header/cwd, symlink, path escape, unsupported layout, malformed JSONL, excessive files/bytes/line, and missing files warn and omit.
- `PI_CODING_AGENT_SESSION_DIR`, supported default path, and `--no-session` behave as specified.
- Prompt/response content never appears in the returned usage object or logs.

### Workflow executor

- Standard AI success records once.
- SDK error result with usage records once before failure.
- Generator throw without a terminal usage result records nothing.
- Two cumulative terminal results in one pass record only the latest.
- Each structured-output reask records independently.
- Each outer retry records independently.
- Each direct-loop iteration/reask records independently with iteration metadata.
- Loop-group body nodes use their namespaced step id and have no group duplicate.
- Pause/resume and retry-node append rather than replace.
- Retry epochs are retained.
- Child run records direct usage once and parent gets no new usage duplicate.
- Non-AI nodes do not record.
- Recorder rejection never changes the node outcome.

### Persistence and pricing

- Event and all rows commit together.
- A ledger insert failure rolls back the event and rows, then writes one fallback event.
- An ambiguous transaction result followed by fallback cannot create a duplicate usage event.
- No delete runs during retry/resume.
- Event deletion/run cascade deletes ledger children.
- Every SQL constraint is exercised.
- Provider-reported zero suppresses estimation.
- Exact config provider/model pairs override exact catalog pairs, including ids containing `/`.
- Duplicate config provider/model pairs and invalid rate objects are rejected for estimation without failing the workflow.
- Unknown/fuzzy/bare model does not match.
- A call missing input or output tokens is not estimated.
- Missing positive-use category rate prevents partial estimate.
- Reasoning is not double charged.
- Tier threshold and non-finite multiplication behavior are tested.
- Catalog/config failure yields null estimate and structured warning.
- Existing config update operations preserve an operator-authored `pricing` block unchanged.
- Coverage detects fallback usage events without rows.

### Query/API

- Both/neither date requirement, `from < to`, half-open boundary, current UTC month, entire-run default, 366-day cap, and UTC day grouping.
- All filters and seven group modes.
- `kind=unclassified` maps to SQL null.
- Node grouping and the exact node filter require run id.
- Group 501 returns 400 rather than partial data.
- Group ordering is deterministic and treats null dimensions identically in SQLite and PostgreSQL.
- Null sums and missing counts distinguish absent from zero.
- PostgreSQL bigint results are converted safely.
- Non-finite or negative USD aggregates fail explicitly.
- SQL values are parameterized and group expressions are enum-selected.
- Coverage is documented and tested as date/project/run/node scoped.
- Coverage is labelled as event-to-ledger integrity only and cannot be read as a percentage of all historical provider calls.
- Old run returns `hasRecordedUsage: false`.
- Run-detail usage failure returns the rest of the detail with `usage: null`.

### CLI/web

- `archon usage` runs outside Git.
- `--from` remains worktree-only and usage rejects it.
- Unsupported flags fail clearly.
- `--node` requires `--run-id` and filters the exact persisted step name.
- JSON stdout is exact and machine-readable.
- Human output distinguishes exact zero, positive sub-cent values, missing, reported, and estimated amounts.
- Cost page filter cache keys do not collide.
- Cost page date-only controls produce the documented inclusive UTC calendar-day selection over the API's half-open range.
- Run header labels direct vs legacy scope.
- Run detail distinguishes report-unavailable, not-recorded, known-zero, and legacy-only states.
- Failed node usage renders.
- New audit event is hidden without the System toggle and never dumps raw JSON.

## Compatibility, Migration, Rollout, and Rollback

### Compatibility

- `usageBreakdown` is additive.
- Deprecated `modelUsage` remains in the provider result contract for third-party providers.
- Existing token/cost fields, run metadata, event payloads, and budget enforcement remain readable.
- Pi, Copilot, OpenCode, and OMP legacy aggregate values can change where the mapped provider corrections include previously discarded calls, hidden OMP work, or remove reasoning double-counting; this is an accuracy correction, not a new control path.
- Estimated cost and the new ledger never feed `maxBudgetUsd`; Claude's existing SDK-enforced budget behavior is unchanged.
- New API fields/routes are additive.
- Historical runs remain valid and return an explicit no-recorded-usage state.

### Migration and mixed versions

- The schema is applied idempotently on every connection in both adapters.
- The new table/indexes are additive and safe for an older Archon binary to ignore.
- Old writers do not emit usage events; reports cannot quantify those calls, advertise `historicalBackfill: false`, and never present their absence as zero.
- New-writer ledger failures leave a detectable JSON event.
- V1 has no automatic re-ledgering job or repair command; operators keep the fallback event, investigate the structured error, and deploy a forward fix while reports continue to show the integrity gap.
- There is no backfill and no startup scan.
- A briefly mismatched old web bundle may show an unknown usage event as raw JSON until the new bundle is deployed; the new bundle’s explicit system mapping resolves it.

### Rollout

1. Apply schema and generated bundled schema.
2. Deploy provider/executor writers and query code together.
3. Deploy generated API client and UI in the same release.
4. Verify one controlled workflow for each available provider and compare provider-reported totals with the ledger.
5. Check structured logs for invalid usage, OMP transcript omission, and ledger fallback warnings.
6. Confirm `unledgeredEventCount` is zero for the controlled runs.

No feature flag is required because absent usage is already a safe, explicit state and the write path cannot fail workflow execution.

### Rollback

Revert the application code only.

Do not drop the table, indexes, event rows, or configuration key.

Older code ignores them, preserving both additive-schema safety and collected audit data for a later forward fix.

### Operational characteristics

- Row growth is proportional to provider-reported observations, not tool events or streamed chunks.
- Reporting is bounded by date range and group count and supported by event/run/provider indexes.
- The accounting transaction contains only inserts; config/catalog work happens before it.
- OMP disk reads are post-process, bounded, streamed, and fail-soft.
- No prompt, response, credential, tool payload, or transcript content is added to the ledger.
- Floating-point USD totals are operational estimates/provider reports, not decimal invoice accounting; the UI must not imply cent-perfect reconciliation.

## Acceptance Criteria

The feature is complete only when all of the following are true:

- [ ] Every provider with authoritative usage emits the normalized additive contract according to the mapping above.
- [ ] No provider fabricates an unknown model, absent token category, request count, or USD value.
- [ ] The last terminal result is cumulative per `sendQuery()` invocation, including usage-bearing internal retries.
- [ ] Standard AI and direct-loop paths write exactly one append-only usage event per usage-bearing pass.
- [ ] Failed attempts, reasks, loop iterations, resumes, and retry epochs remain queryable simultaneously.
- [ ] Child usage is owned only by the child run in the new accounting path.
- [ ] Event JSON and ledger rows originate from the same validated array and commit atomically in the normal path.
- [ ] A failed ledger transaction produces a detectable event-only fallback and does not fail the workflow.
- [ ] Reported and estimated USD are stored and displayed separately; a combined authoritative-looking total does not exist.
- [ ] Global exact provider/model pricing and exact catalog fallback work without parsing concatenated identity keys; repository config cannot alter prices.
- [ ] SQLite and PostgreSQL schemas, constraints, indexes, generated schema, and released-schema upgrades pass.
- [ ] `GET /api/usage` implements the documented filters, groups, bounds, missing-value semantics, and conservative coverage.
- [ ] Run detail returns direct usage without making usage-query failure fatal.
- [ ] `archon usage` works outside Git, has no `--from` collision, and matches API semantics in JSON mode.
- [ ] The console has one Cost page and per-run/per-node direct usage with explicit reported/estimated/missing/legacy labels.
- [ ] OMP resume/fork tests prove copied history is not counted and unsafe layouts fail closed.
- [ ] No new usage event is sent through the external outbox or high-frequency dashboard poller.
- [ ] Historical runs and old writers render “not recorded,” not zero.
- [ ] Documentation describes scope, estimates, UTC ranges, coverage, compatibility, and rollback.
- [ ] The post-implementation Constitution Check and all validation commands pass.

## Validation Commands

Install dependencies before inspecting locked SDK types or running validation:

```bash
bun install --frozen-lockfile
```

Run focused package scripts; never run `bun test` from the repository root:

```bash
bun --filter @archon/providers test
bun --filter @archon/workflows test
bun --filter @archon/core test
bun --filter @archon/server test
bun --filter @archon/cli test
bun --filter @archon/web test
bun --filter @archon/web build
bun --filter @archon/docs-web build
```

Regenerate tracked artifacts:

```bash
bun run generate:bundled-schema
bun run dev:server
# In another shell after the server is ready:
bun --filter @archon/web generate:types
```

Run repository validation:

```bash
bun run validate
```

Because the PostgreSQL upgrade check is intentionally outside `validate`, run it against a reachable PostgreSQL instance:

```bash
bun run check:schema-upgrades
```

The implementation is not ready for a pull request until every command above that applies to the environment passes and any unavailable live-PostgreSQL check is reported explicitly.

## Final Design Review

### 1. Product goal and user outcome

The design answers direct workflow cost questions at run, node, agent, provider, model, project, and time levels.

It preserves missingness and explains estimates, so the UI does not turn incomplete telemetry into false certainty.

### 2. Architecture and technical correctness

Providers normalize only what they observe; workflows attach execution context; core owns durability and pricing; server/CLI/web consume one query contract.

The append-only pass model matches actual execution paths and avoids retry/loop loss.

### 3. Public and internal contracts

The provider and REST changes are additive.

Persisted JSON is versioned, the ledger is normalized, and generated web types remain the browser contract.

### 4. Security, reliability, and data integrity

Atomic normal writes, event-only fallback, SQL whitelisting, strict validation, cascade ownership, global-only pricing, and bounded OMP reads cover the identified failure modes.

No lifecycle mutation depends on accounting success.

### 5. Performance and scalability

Writes are append-only and proportional to actual reported model observations.

Queries are range/group bounded and use the workflow-event/run/provider indexes.

No transcript or historical-run scan occurs during reporting.

### 6. Implementation completeness

Both provider consumption sites, every supported provider, workflow dependency test helpers, both database dialects, all reporting surfaces, generated artifacts, and documentation are named.

### 7. Testing and verification

The matrix covers attribution, missingness, failure, retry, loops, subruns, transcript safety, transaction rollback, dialect behavior, contracts, and UI states.

### 8. Operations, compatibility, migration, and rollback

The design is additive, has no backfill, exposes event/ledger divergence without claiming to measure old-writer calls, deploys UI/API together, and rolls back without dropping data.

### 9. Simplicity and long-term maintainability

One provider array, one event type, one child ledger table, one query operation, and one Cost page replace the draft’s mutable metadata, replace-delete logic, speculative chat schema, parent rollup, and opaque map keys.

## Remaining Known Limits

- Providers cannot report usage an SDK omits, especially failures without a terminal usage object.
- Provider mappings are for the lockfile versions inspected here; dependency upgrades require re-running fixture/contract tests and deliberately mapping any new usage dimensions.
- An aborted stream that does not yield a terminal usage result is not estimated from partial counters and remains unrecorded.
- OMP is externally versioned; unknown or unsafe transcript layouts intentionally omit hidden usage and warn.
- A different process appending to the same OMP session during one Archon invocation cannot be attributed perfectly; the supported case assumes one active writer per persisted session and the prefix checks fail closed on detectable interference.
- Catalog estimates are point-in-time list-price equivalents, not proof of subscription or negotiated billing.
- SDK aggregate usage can make request-tier estimates less precise than per-call observations.
- Floating-point USD is appropriate for operational visibility but not billing-grade decimal reconciliation.
- Coverage can detect event/ledger divergence only at date/project/run/node scope, not inside agent/provider/model/kind filters.
- Coverage cannot count uninstrumented calls from old writers, providers without terminal usage, or aborted streams; the no-backfill label and missing-state UI prevent those gaps from appearing as zero but cannot quantify them.
- An event-only fallback preserves raw usage but is excluded from aggregates and loses any materialized estimate until a future explicit reconciliation feature is implemented.

These limits are explicit, testable, and do not block the v1 goal.
