# Story 6.1 outcome — Claude and Pi resume after AskHuman

## Scope

Story 6.1 is a provider protocol spike, not production HITL implementation.
It records redacted Claude runtime evidence on exact SDK `0.3.209`, an isolated `0.3.261` comparison, and a real Pi `0.80.6` durable reopen characterization.
AD-6 remains provider-owned resume injection: the executor supplies ordered `resumeInteractions`, providers inject answers, and workflows do not encode answers in prompt prose.
This document cites evidence only; it does not copy prompts, answers, transcripts, credentials, or environment data.

## Evidence

### Claude SDK 0.3.209

Source: `_bmad-output/implementation-artifacts/workflow-run-view-hitl/evidence/6-1-claude-0.3.209.json`.
`schemaVersion` is `1` and `sdkVersion` is `0.3.209`.
Both required aliases were recorded: `sonnet` and `opus`.
`requires_action` was not observed on either model.
`failureCategory` is null on both models.

`sonnet` host-abort facts: `handlerCallsBeforePause=1`, `handlerCallsAfterResume=1`, `sessionIdCaptured=true`, `resumedSameSession=true`, `completionMarkerSeen=true`.
`sonnet` deferred facts: `firstStopReason=tool_deferred`, `deferredToolUsePresent=true`, `handlerCallsBeforePause=0`, one PreToolUse tool-use id (`toolu_013opg8M9QjsxQqrENdftExd`, not repeated on resume), `updatedInputReachedHandler=false`, `resumedHandlerCalls=0`, `resumedSuccessfully=true`, `unavailable=false`.
`sonnet` classification is `host-abort-new-user-message` because the same-id defer round trip is incomplete.

`opus` host-abort facts: `handlerCallsBeforePause=1`, `handlerCallsAfterResume=1`, `sessionIdCaptured=true`, `resumedSameSession=true`, `completionMarkerSeen=true`.
`opus` deferred facts: `firstStopReason=tool_deferred`, `deferredToolUsePresent=true`, `handlerCallsBeforePause=0`, one PreToolUse tool-use id (`toolu_015GjhdGn47hac4k3uPnq17M`, not repeated on resume), `updatedInputReachedHandler=false`, `resumedHandlerCalls=0`, `resumedSuccessfully=true`, `unavailable=false`.
`opus` classification is `host-abort-new-user-message` because the same-id defer round trip is incomplete.

Top-level classification is `host-abort-new-user-message`.
Both aliases independently proved the same non-inconclusive protocol on the required exact version.

### Claude SDK 0.3.261 comparison

Source: `_bmad-output/implementation-artifacts/workflow-run-view-hitl/evidence/6-1-claude-0.3.261.json`.
`schemaVersion` is `1` and `sdkVersion` is `0.3.261`.
Both required aliases were recorded: `sonnet` and `opus`.
`requires_action` was not observed on either model.
`failureCategory` is null on both models.

`sonnet` host-abort facts: `handlerCallsBeforePause=1`, `handlerCallsAfterResume=1`, `sessionIdCaptured=true`, `resumedSameSession=true`, `completionMarkerSeen=true`.
`sonnet` deferred facts: `firstStopReason=tool_deferred`, `deferredToolUsePresent=true`, `handlerCallsBeforePause=0`, repeated same PreToolUse tool-use id (`toolu_016wYtjStkP3xyooRiRXFQLV` then `toolu_016wYtjStkP3xyooRiRXFQLV`), `updatedInputReachedHandler=true`, `resumedHandlerCalls=1`, `resumedSuccessfully=true`, `unavailable=false`.
`sonnet` classification is `tool-deferred-reissue` because the complete same-id defer round trip is preferred over an also-proved host abort.

`opus` host-abort facts: `handlerCallsBeforePause=1`, `handlerCallsAfterResume=1`, `sessionIdCaptured=true`, `resumedSameSession=true`, `completionMarkerSeen=true`.
`opus` deferred facts: `firstStopReason=tool_deferred`, `deferredToolUsePresent=true`, `handlerCallsBeforePause=0`, repeated same PreToolUse tool-use id (`toolu_016ETV9P2mevok1rgUoJeL3Y` then `toolu_016ETV9P2mevok1rgUoJeL3Y`), `updatedInputReachedHandler=true`, `resumedHandlerCalls=1`, `resumedSuccessfully=true`, `unavailable=false`.
`opus` classification is `tool-deferred-reissue` because the complete same-id defer round trip is preferred over an also-proved host abort.

Top-level classification is `tool-deferred-reissue`.
This file is comparison evidence only.
It does not override the required `0.3.209` protocol, relax the exact manifest pin, or authorize an automatic dependency upgrade.

### Pi 0.80.6 durable reopen

Focused test command: `(cd packages/providers && bun test src/community/pi/askhuman-resume.characterization.test.ts)`.
The test uses real `SessionManager`, `AgentSession`, dispose, reopen, `appendMessage(ToolResultMessage)`, and `session.agent.continue()`, with only the model transport replaced by a deterministic faux provider.
The persisted order after two reopens is `assistant tool call -> matching tool result -> continuation assistant message`.

## AD-6 decision

CONFIRM: Claude host-aborts after the custom `mcp__archon__AskHuman` callback persists the Ask, resumes the same provider session with one provider-owned user message, and does not reissue AskHuman; no answer is inserted by workflows.

CONFIRM: Pi opens the persisted SessionManager, appends each matching ToolResultMessage through SessionManager.appendMessage before createAgentSession, constructs the new AgentSession from that manager, verifies the tool result is the agent transcript tail, and calls session.agent.continue(); AgentSession.continue() is not an API.

## AskUserQuestion decision

Archon rejects Claude's built-in `AskUserQuestion` as a product channel.
The selected Claude mechanism is host abort plus one provider-owned user message on the custom `mcp__archon__AskHuman` tool only.
PreToolUse `defer` may operate on that custom MCP tool in later SDK versions, but it is not an AskUserQuestion product path and is not the active `0.3.209` protocol.

## Version decision

The repository manifests and `bun.lock` name exact Claude SDK `0.3.209`, not a caret range.
Isolated SDK `0.3.261` produced `tool-deferred-reissue` as comparison evidence only and does not replace the required `0.3.209` proof or authorize a floating range.

## Story gate

COMPLETE: Story 6.1 is complete.
Claude exact `0.3.209` proved host-abort-new-user-message on sonnet and opus, Pi `0.80.6` proved the durable reopen order, both evidence files are redacted and valid, AD-6 and the diagrams agree, and `bun run validate` passed.
