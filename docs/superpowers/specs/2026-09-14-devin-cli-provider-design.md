# Devin CLI Provider Design

**Status:** ACP and `yolo` direction approved in chat on 2026-09-14; detailed spec pending review.

## Outcome and boundaries

Add `devin` as an Archon community provider that runs the installed Devin CLI against the cwd or managed worktree selected by Archon.
It must work in direct conversations and workflow AI nodes through the existing `IAgentProvider` contract.
It must preserve Archon workflow gates, audit events, cancellation, session continuity, and AskHuman.
All users in one Archon installation share the machine's Devin CLI login.
The child runs in Devin's `yolo` permission mode for tool actions.
The provider does not create Devin Cloud sessions or store a second credential in Archon.

The provider must state the difference between a Devin CLI feature and an Archon per-node control.
It must never declare an Archon capability only because the Devin CLI has a feature with a similar name.
An unsupported control must produce Archon's normal capability warning or a clear failure, as appropriate.

## Approach

Use `devin --permission-mode yolo acp` as a subprocess and the already installed `@agentclientprotocol/sdk` as the protocol client.
The ACP path gives Archon structured events, session identifiers, and cancellation.
The CLI `--print` path does not give the same event and control contract.
The Cloud API would move execution out of the Archon worktree, so it is outside this design.

Register the provider through `registerCommunityProviders()`.
Keep the adapter in `packages/providers/src/community/devin/`.
Use existing provider helpers for structured output and resumed outcomes.
Do not copy the DeepSeek-specific permission policy, transport checks, or session-resume method.

## Runtime flow

1. Resolve the local `devin` executable and check that it can start.
2. Start the child with the exact Archon cwd, the selected model, `yolo`, and the execution environment supplied for that turn.
3. Use the machine's existing `devin auth login` state; do not request or inject a per-user Devin key.
4. Initialize ACP and check each protocol feature needed for the turn before sending the prompt.
5. Create a new ACP session, or use `session/load` for a stored session ID.
6. Map new ACP text, thought, tool, tool-result, and terminal events to `MessageChunk` values with stable tool-call IDs.
7. Suppress history replayed by `session/load` so old content does not appear as a new answer.
8. On abort, send ACP cancellation, close the child, and reap it.
9. Return the actual session ID and terminal result to Archon; never substitute a new session after a failed load.

The installed CLI, version `3000.10.21`, advertised `sessionCapabilities.loadSession: true` in a local ACP initialization probe.
The adapter must check this at runtime because the installed CLI can change.
The final implementation must prove session load with a real resumed turn, not only with the initialization response.

## AskHuman and workflow HITL

Archon's AskHuman persistence, answer API, run view, and workflow re-entry already exist.
The Devin adapter must expose the existing `NativeTool` to Devin through a turn-scoped local stdio MCP server.
The MCP server runs as a child, so a private local IPC channel must forward tool calls to the provider process that holds the `NativeTool` handler.
The IPC channel must use a per-turn secret, accept only the local child, and close with the ACP turn.
The provider process must call Archon's `AskHuman` handler with a stable tool-use ID and the active Devin session ID.
That handler writes the pending interaction and pauses the workflow.
The provider process must carry `AskHumanAwaitingError` from the handler to the ACP driver through an in-process control signal.
The driver must cancel the current ACP turn immediately, and the workflow executor must retain its current pending-node behavior.
An MCP child error must not be mistaken for a successful AskHuman result.

After an answer or decline, Archon re-enters the node with `resumeInteractions` and the saved session ID.
The adapter must load that session and send an answer message that names the matching AskHuman call and includes only the validated answer.
It must not repeat the original prompt, create a new session, or allow another tool action after the pause signal.
The resumed turn must display only new events.
This uses the same durable pause and re-entry model as the current Claude AskHuman path.

An end-to-end test must prove this sequence with the real Devin CLI before `askHuman` or `nativeTools` is declared true.
If the installed ACP server cannot accept the turn-scoped MCP tool or cannot resume the paused AskHuman turn, the feature is not complete and the provider must not be presented as having full shared-flow support.

## Permission mode

`yolo` applies only to Devin's own tool permission checks inside the spawned child.
It does not approve, reject, or skip any Archon workflow gate or AskHuman interaction.
Do not add a new Archon permission card or use the dormant `kind: permission` confirmation route for this provider.
Devin organization rules can still deny or ask for an action despite `yolo`.
If ACP sends a permission request in that case, cancel that request and end the turn with a clear error that names the blocked action without exposing credentials.
Never leave the ACP request waiting without a response or change Devin's organization policy.

## Models, configuration, and credentials

Pass an Archon-selected model to Devin through its ACP `--model` option or a supported session config option.
Accept Devin's installed model IDs and aliases without a hard-coded copy of its model catalog.
Keep Archon's existing free-text model selector and document `devin models list` as the source for installed model names.
An unsupported model must fail with Devin's reason instead of silently selecting another one.

Allow provider-specific assistant config for Devin's `agentType` and ordered refusal fallback models because the local ACP command exposes both.
Keep these in the existing assistant config map; do not add workflow YAML fields.
Let Devin load its own rules, skills, hooks, plugins, subagents, and configured MCP servers from its normal user and project config paths.
The provider must not rewrite those files or claim that Archon's different per-node hooks, skills, or inline agents have been translated.

Register a status-only, installation-level Devin credential surface.
The existing Agents settings view must show whether the local CLI and shared login are usable, without offering a per-user key form or returning the account identity or token.
The run path must give a clear login or executable error if readiness changed after the view was loaded.
Worktree path, child environment, and credential handling must be tested without logging secret values.

## Capability contract

The release capability matrix must reflect verified adapter behavior.
The target values are `sessionResume: true`, `mcp: true` for ACP stdio and Devin-managed MCP config, `structuredOutput: 'best-effort'`, `envInjection: true`, `nativeTools: true`, and `askHuman: true`.
Keep `hooks`, `skills`, `agents`, `toolRestrictions`, `costControl`, `effortControl`, `thinkingControl`, `fallbackModel`, `sandbox`, `settingSources`, and `containerExec` false unless an Archon control with the same meaning is translated and tested.
Devin's own hooks, skills, subagents, refusal fallback, and sandbox are separate CLI features; their existence does not make the corresponding Archon flags true.
The chosen `yolo` mode does not use Devin's `--sandbox` autonomous mode.

For Archon-supplied MCP servers, the adapter must accept stdio when ACP accepts it.
The local initialization probe advertised `mcpCapabilities.http: false` and `sse: false`.
The adapter must fail clearly if an Archon per-turn HTTP or SSE MCP server cannot be attached, while leaving Devin-managed MCP configuration intact.
Do not convert a server to another transport without an explicit, tested bridge.

Only report usage fields that ACP or Devin actually emits for that turn.
Do not calculate costs from context occupancy or copy cumulative session statistics into one turn's bill.
State the absence of reliable per-turn cost data in the capability reference until a measured source exists.

## Errors and lifecycle

Classify missing binary, missing login, protocol mismatch, failed session load, bad model, MCP setup failure, abort, child exit, and unresolved permission request separately.
Return terminal provider errors with actionable messages and no secret values.
Do not retry a failed AskHuman re-entry automatically because a retry could repeat earlier file or tool actions.
Do not leave a child process, MCP server, or listener after a turn ends, aborts, or fails.
Keep Archon's existing rule that another process cannot mark an ambiguous non-terminal run failed based on age alone.

## Verification and documentation

Unit tests must cover registration, binary/config parsing, ACP event conversion, replay suppression, model selection, capability truthfulness, cancellation, and sanitized errors.
An isolated ACP fixture must cover a new turn, session load, failed load, tool events, and a permission request that is cancelled without hanging.
Workflow integration tests must cover the AskHuman pause, answer, decline, and re-entry paths with the existing store and API contracts.
One real CLI end-to-end smoke in an isolated temporary git repository must prove a prompt, a resumed turn, and AskHuman through the MCP bridge.
This smoke must avoid destructive prompts and must not depend on network access in the normal test suite.

Update the smallest owning user docs for provider setup, shared-login behavior, `yolo`, model selection, and verified limitations.
Regenerate the provider capability reference with its owning script; do not edit generated files by hand.
Run focused provider and workflow tests, then the repository validation command before a PR.

## Supported-surface report at release

The release note must list each Archon capability as wired, supplied by Devin's own config, or unsupported.
It must call out ACP HTTP/SSE per-turn MCP limits, any missing per-turn usage or cost data, and any interactive CLI feature that Archon's one-turn provider contract cannot expose.
It must distinguish those adapter limits from features absent in Devin CLI itself.

## Sources checked

- [Devin CLI commands and ACP entry point](https://docs.devin.ai/cli/reference/commands).
- [Devin CLI permission modes](https://docs.devin.ai/cli/reference/permissions).
- `packages/providers/src/types.ts` and `packages/providers/src/community/deepseek/acp-client.ts` for the Archon provider and ACP contracts.
- `packages/workflows/src/ask-human.ts` and `packages/workflows/src/dag-executor.ts` for durable AskHuman pause and re-entry.
- `packages/core/src/db/workflow-pending-interactions.ts` for the separate pending-permission contract.
