# Scout: OMP `providerPayload` + RPC protocol v2

Read-only source research. Feeds the `--mode json` → `--mode rpc` switch decision.

## Source of truth for citations

All `packages/…` paths below are the **OMP** repo unless prefixed `archon:`.

|                                 |                                                                                                                            |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| OMP checkout used               | `/Users/dale/Desktop/workspace/OceanLabs/agentic-os-plan/oh-my-pi`                                                         |
| Commit                          | `9892714499` (`feat(catalog,ai,coding-agent): add DeepInfra provider`), clean tree                                         |
| `packages/coding-agent` version | `18.0.4`                                                                                                                   |
| Matches lead's anchors          | yes — `rpc-frame.ts:5-8`, `rpc-mode.ts:727-735` (ready), `:736-740` (v2 flip), `:977-980` (raw subscribe) all land exactly |

Two other checkouts exist and were rejected as anchors: `opensources/oh-my-pi` (v17.4.0, dirty tree) and `external/oh-my-pi` (v16.0.6, no `rpc-frame.ts` at all).

**Drift check.** `rpc-frame.ts` and `print-mode.ts` are **byte-identical** between the 18.0.4 and 17.4.0 checkouts — the frame codec and the strip logic have been stable across at least those vintages. `rpc-mode.ts` differs by 51 lines and `rpc-types.ts` differs, so _those_ line numbers shift between versions even though the behavior described here holds in both.

**`[?]` Binary vintage.** The locally installed binary is `omp/18.0.11` (`/Users/dale/.bun/bin/omp`); no checkout of 18.0.11 is on disk. Archon **pins no version** — `archon:packages/providers/src/community/omp/binary-resolver.ts:96` just tells the user `bun install -g @oh-my-pi/pi-coding-agent` and resolves whatever is on PATH. So line numbers describe 18.0.4; behavior is corroborated at 17.4.0 for the codec files but is `[?]` for 18.0.11.

---

## Bottom line

The lead framed the decision as "drop a field vs. write a codec". **That framing understates both sides.**

1. **`providerPayload` is not the payload problem.** It is OpenAI-Responses-only, `undefined` on every other backend. The actual size driver in rpc mode is the `partial: AssistantMessage` full-message snapshot that rides **every streaming delta** — stripped in json mode, raw in rpc mode. That is quadratic, and OMP's own source says it once produced multi-GB logs.
2. **Protocol v1 is lossy and the reader cannot opt out.** Shrinking happens writer-side, before the bytes leave OMP. Dropping the field on receipt does nothing for a frame that already exceeded 1 MiB. v2 skips the shrink passes entirely.
3. **The v2 reader is ~79 portable lines**, one new frame kind, and OMP ships a reference implementation you can lift.

So the real trade is **"accept silent truncation of any >1 MiB event" vs. "~79-line decoder"**, not "drop a field vs. write a codec".

**And one finding that outranks the whole question:** rpc mode does not emit the `session` header, which Archon's parser requires — every turn fails with `omp_incomplete_output` until Archon seeds `sessionId` from `get_state`. See Q7 item 2. Fix that first; the codec decision is downstream of it.

---

## Q1 — What is `providerPayload`?

**Type is a single concrete shape, not an open bag** (`packages/ai/src/types.ts:854-861`):

```ts
export interface OpenAIResponsesHistoryPayload {
  type: 'openaiResponsesHistory';
  provider?: string;
  dt?: boolean;
  items: Array<Record<string, unknown>>;
}
export type ProviderPayload = OpenAIResponsesHistoryPayload;
```

**Where it lives.** A field on _messages_, not on events — `UserMessage` (`types.ts:873`), `DeveloperMessage` (`:883`), `AssistantMessage` (`:975`). Events carry it only transitively, by embedding a message.

**What it holds.** Verbatim OpenAI Responses API history items, kept solely to replay transport-native history to that same API. OMP's own docblock, `print-mode.ts:55-56`:

> `providerPayload` is transport-native replay state, opaque and useless outside this process.

Constructed at `packages/ai/src/utils.ts:445-456` (`createOpenAIResponsesHistoryPayload`), consumed by `getOpenAIResponsesHistoryPayload` (`:458-468`) which **discards it when `payloadProvider !== currentProvider`** — i.e. it is worthless even to OMP across a provider switch. Assignment sites carrying real API items: `packages/ai/src/providers/openai-responses-server.ts:357` and `:376` (`structuredCloneJSON(item)` — a raw wire item), and `packages/coding-agent/src/session/session-context.ts:159-172` (remote-compaction replacement history).

**Not the raw LLM response.** It is the _request-side native history representation_, not the response body.

**Size.** No literal byte figure in source. Two indirect measures:

- It is large enough that OMP strips it from every `--mode json` frame (`print-mode.ts:39-43`, `:72-81`) and from shared exports (`export/share.ts:390`, `:413`, `:460`).
- The persistence tests characterize the items as **encrypted reasoning blobs stored twice** (once as `thinkingSignature`, once inside `providerPayload.items`) and exercise a `>MAX_PERSIST_CHARS` truncation path — `test/session-persistence/signature-persistence.test.ts:232` and `:262`. So on a reasoning model the payload can approach the size of the message's own thinking content.

**Decisive scoping fact:** `ProviderPayload` has exactly one member (`types.ts:861`), and the only producers are the openai-responses paths above. **On an Anthropic, Google, OpenRouter, or any non-Responses backend, `providerPayload` is `undefined` and there is nothing to drop.**

## Q2 — What does `printableEvent` strip?

**Two classes, not one.** `packages/coding-agent/src/modes/print-mode.ts:58-83`. The docblock at `:45-57` is explicit that this exists to make transcripts grow _linearly instead of quadratically_.

| Event                             | What is removed                                                                       | Line     |
| --------------------------------- | ------------------------------------------------------------------------------------- | -------- |
| `message_update` (`done`/`error`) | everything except `{type, reason}`                                                    | `:62-67` |
| `message_update` (all others)     | **`assistantMessageEvent.partial`** — the whole in-progress `AssistantMessage`        | `:68-69` |
| `message_start`, `message_end`    | `message.providerPayload`                                                             | `:72-73` |
| `turn_end`                        | `message.providerPayload` **and** `providerPayload` on every entry of `toolResults[]` | `:74-79` |
| `agent_end`                       | `providerPayload` on every entry of `messages[]`                                      | `:80-81` |
| everything else                   | nothing — returned by reference                                                       | `:82`    |

**The `partial` strip is the expensive one.** Every streaming variant carries it — `types.ts:1284-1294`, eleven variants, each with `partial: AssistantMessage`. And since `AssistantMessage` itself has `providerPayload?` (`types.ts:975`), in rpc mode the payload rides inside `partial` **on every delta** as well.

Archon's parser reads only `assistantMessageEvent.{type, delta}` (`archon:packages/providers/src/community/omp/event-parser.ts:218-228`). It never touches `partial`. So in rpc mode that snapshot is pure wire waste for Archon — but it is on the wire, and it is what drives frames toward the 1 MiB ceiling.

## Q3 — Behavior at the 1 MiB ceiling (v1)

`MAX_RPC_FRAME_BYTES = 1024 * 1024`, inclusive of the newline (`rpc-frame.ts:6`, `:42-44`).

Order of operations in `encodeRpcFrameFromJson` (`rpc-frame.ts:242-263`):

1. **Fits →** emit as-is (`:248`).
2. **`type: "response"` →** replaced outright by `overflowFrame` (`:249-251`). No shrink attempted.
3. **`agent_end` compaction** (`:253`, impl `:191-215`) — `messages` is replaced by the suffix the client has not yet seen, and a **`messageCount`** field is added.
4. **Seven shrink passes** (`:257-260`), applied whole-frame, each strictly tighter — `SHRINK_PASSES` at `:29-37`:

   | pass | stringCap | arrayLimit | objectLimit |
   | ---- | --------- | ---------- | ----------- |
   | 1    | 256 KiB   | 512        | 512         |
   | 2    | 64 KiB    | 256        | 256         |
   | 3    | 16 KiB    | 128        | 128         |
   | 4    | 4 KiB     | 64         | 64          |
   | 5    | 1 KiB     | 32         | 32          |
   | 6    | 256       | 8          | 16          |
   | 7    | 64        | 1          | 8           |

5. **Still too big →** `overflowFrame` (`:262`, impl `:217-240`).

**Is elision marked?** Partially, and **never with a top-level flag**. Markers are in-band, at the elision site (`:46-50`, `:56-69`):

- truncated string → the string's own tail becomes `` `\n…[N chars elided for RPC frame]` ``
- truncated array → an **extra element** appended: `` `…[N items elided for RPC frame]` ``
- truncated object → an added key `rpcFrameElidedKeys: <number>`
- overflow → the frame is _replaced_ by `{type: "rpc_frame_error", originalType, error}`, or for `agent_end` by `{type:"agent_end", messages: [], messageCount}` (`:228-234`)

**Consequences for a reader.** `shrinkValue` is type-blind (`:52-73`) — it walks the whole frame and will truncate assistant `content[].text`, tool-call `arguments`, and tool-result content alike. A reader that only inspects known fields sees a **shorter but structurally valid** message with no signal that anything was lost; the only evidence is the sentinel string embedded in the data itself. An elided array picks up an extra element of the _wrong type_, which will break a consumer that assumes element shape.

Concretely for Archon: `event-parser.ts:245` maps `message_end.message.content[]` text blocks and `:250-258` reconciles that against the streamed text, warning `omp.streaming_text_mismatch` and setting `streamError = 'omp_stream_mismatch'`. A shrink pass that truncates `content[].text` would trip exactly that path — the failure is at least _loud_, but it is a failure, not a recovery.

## Q4 — Protocol v2 chunking

**Frame format** — exactly **one** new kind, `RpcChunkFrame` (`rpc-types.ts:152-160`):

```ts
{
  type: 'rpc_chunk';
  chunkId: string;
  index: number;
  count: number;
  byteLength: number;
  data: string;
}
```

`data` is base64 of a 256 KiB slice (`RPC_CHUNK_PAYLOAD_BYTES`, `rpc-frame.ts:10`) of the UTF-8 serialization of one logical frame. `byteLength` is the total for the whole logical frame. Emission: `encodeChunkedRpcFrames` (`:93-117`), one JSONL line at a time for backpressure.

**Reader obligations** (all implemented by `RpcFrameDecoder`, `rpc-frame.ts:136-189`):

- One reassembly buffer, single-sequence — a non-chunk frame arriving mid-sequence throws `"rpc chunk sequence interrupted"` (`:141`). Sequences never interleave.
- Strictly sequential: must start at `index 0` (`:165`), `nextIndex` must match exactly (`:169-175`).
- Metadata validation (`:146-160`): `chunkId` non-empty ≤128 chars; `index`/`count`/`byteLength` safe integers; `count >= 2`; `count <= ceil(64 MiB / 256 KiB)`; `index < count`; **`byteLength >= MAX_RPC_FRAME_BYTES`** and `<= MAX_RPC_REASSEMBLED_BYTES`.
- Strict base64 (`:123-133`) — regex-validated _and_ round-trip verified.
- Per-chunk cap 256 KiB (`:162`); running total must not exceed `byteLength` (`:179`) and must equal it at the end (`:181`).
- Final decode is `TextDecoder("utf-8", {fatal: true})` then `JSON.parse`, result must be an object (`:184-186`).

**Size caps:** `MAX_RPC_REASSEMBLED_BYTES = 64 MiB` (`:8`). Over that, the writer emits `overflowFrame` instead — checked on `byteLength` _before_ any full allocation (`:94-98`).

**Abort/error path:** every violation **throws**. There is no per-sequence error frame and no resync — the reference client lets the throw propagate out of its stdout loop, which is terminal for the worker (`rpc-client.ts:338-349`). A chunk arriving before negotiation is an explicit guard: `throw new Error("RPC chunk received before protocol negotiation")` (`rpc-client.ts:347-348`).

**Realistic line count for a correct reader:**

| piece                                         | lines    | cite                    |
| --------------------------------------------- | -------- | ----------------------- |
| `PendingRpcChunks` interface                  | 8        | `rpc-frame.ts:14-21`    |
| 3 constants                                   | 3        | `:6`, `:8`, `:10`       |
| `isRpcChunkFrame`                             | 3        | `:119-121`              |
| `decodeBase64`                                | 11       | `:123-133`              |
| `RpcFrameDecoder`                             | 54       | `:136-189`              |
| **portable codec subtotal**                   | **~79**  |                         |
| `supportsRpcProtocolV2`                       | 9        | `rpc-client.ts:149-157` |
| ready-intercept + pre-negotiation chunk guard | ~11      | `rpc-client.ts:339-349` |
| negotiate handshake                           | ~12      | `rpc-client.ts:417-428` |
| **total wiring**                              | **~110** |                         |

The ~79-line codec is **directly liftable** — `rpc-frame.ts`'s decoder half imports only `isRecord` from `@oh-my-pi/pi-utils` and `RpcChunkFrame` (a 7-field interface). Neither dependency forces an OMP package dependency on Archon.

## Q5 — `negotiate_protocol`

**Client-initiated. Yes.** OMP never offers; it only advertises and answers.

**Ordering.** OMP writes `ready` **before** reading any stdin (`rpc-mode.ts:727-735`):

```jsonc
{
  "type": "ready",
  "protocolVersion": 1,
  "supportedProtocolVersions": [1, 2],
  "maxFrameBytes": 1048576,
  "maxReassembledFrameBytes": 67108864,
}
```

Note `protocolVersion: 1` is hardcoded in the type (`rpc-types.ts:144-150`) — it is the _current_ version, and `supportedProtocolVersions` is the offer.

**Request** (`rpc-types.ts:30`): `{ id?: string, type: "negotiate_protocol", protocolVersion: number }`
**Response** (`rpc-types.ts:195-202`): `{ id?, type: "response", command: "negotiate_protocol", success: true, data: { protocolVersion: 2 } }`
Any value other than `2` is rejected with an error response (`rpc-mode.ts:1005-1009`).

**The flip is deferred by exactly one frame** (`rpc-mode.ts:736-740`): `output()` writes the frame _first_, then calls `frameEncoder.setProtocolVersion(2)`. So the negotiate response itself is still v1-encoded; every frame after it is v2. A reader must not expect chunks before it has seen that response — which is precisely the guard at `rpc-client.ts:347`.

**Never sent → stays v1 forever.** `RpcFrameEncoder.#protocolVersion` defaults to `1` (`rpc-frame.ts:273`) and only `setProtocolVersion` changes it. No timeout, no auto-upgrade. **v1 is the safe default: doing nothing is a valid, working reader** — it just inherits the Q3 truncation.

The reference client also verifies the ceilings match its own compiled constants before negotiating (`rpc-client.ts:149-157`) — a version-skew guard worth copying given Archon pins no OMP version.

## Q6 — Does Archon need anything only in `providerPayload`?

**No. Nothing.** Verified from both ends — the OMP type and Archon's consumer.

| Archon needs       | Where it actually lives                                                                                                                                                                                                                                                                                                              | Only in `providerPayload`? |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------- |
| token usage / cost | `AssistantMessage.usage: Usage`, a required sibling field (`types.ts:954`); read at `archon:event-parser.ts:233-234`, which **throws** if absent                                                                                                                                                                                     | **no**                     |
| thinking content   | `ThinkingContent` in `AssistantMessage.content[]` (`types.ts:929-937`); streamed as `thinking_delta` (`types.ts:1289`), consumed at `archon:event-parser.ts:225-227`                                                                                                                                                                 | **no**                     |
| tool inputs        | `ToolCall` in `content[]` with `arguments: Record<string, unknown>` (`types.ts:827-849`); Archon uses the `tool_execution_start` event instead (`archon:event-parser.ts:184`)                                                                                                                                                        | **no**                     |
| tool outputs       | `ToolResultMessage.content` (`types.ts:982-988`); Archon uses `tool_execution_end` (`archon:event-parser.ts:186`)                                                                                                                                                                                                                    | **no**                     |
| advisor notes      | `CustomMessage` — `{role: "custom", customType: string, content, display, …}` (`packages/agent/src/compaction/messages.ts:19-28`); advisor filtered by `customType === "advisor"` at `packages/coding-agent/src/advisor/runtime.ts:741`, `:1077`. A **separate message role**; `CustomMessage` has no `providerPayload` field at all | **no**                     |

**Archon's parser never reads `providerPayload`.** Grep of `archon:packages/providers/src/community/omp/` returns zero hits. What it consumes (`event-parser.ts:151-212`): `session`, `message_start`, `message_update`, `message_end`, `tool_execution_start`, `tool_execution_end`, `notice`, `auto_retry_start`, `agent_end`. From `message_end.message` specifically (`:230-238`): `role`, `content`, `usage`, `model`, `stopReason` — all first-class siblings.

**Dropping `providerPayload` on receipt loses Archon nothing.** OMP itself discards it on provider mismatch (`utils.ts:466`) and strips it from every json-mode frame today — so Archon has _already_ been running without it since the provider was written.

## Q7 — What else changes between `--mode json` and `--mode rpc`

Ordered by how likely each is to break a naive line-parser.

1. **`message_update` carries `partial` — the headline.** rpc mode subscribes raw (`rpc-mode.ts:977-980`), json mode filters through `printableEvent` (`print-mode.ts:156`). Every delta now ships a full `AssistantMessage` snapshot. `print-mode.ts:47-52` says this is the regression that "produced multi-GB logs". Archon reads only `.type`/`.delta`, so it is _parseable_ — but it is what will push frames into Q3's shrink passes on long turns. **This, not `providerPayload`, is the payload cost of the switch.**

2. **The `session` header is GONE in rpc mode — this breaks every turn today.** `sessionManager.getHeader()` is called at exactly one place in the mode layer, `print-mode.ts:114`; **`rpc-mode.ts` never calls it** (verified by grep across `packages/coding-agent/src`). rpc mode's first line is `ready` instead.

   Archon derives `sessionId` **only** from that header (`archon:event-parser.ts:160-167`), and `buildResult` hard-fails when it is unset (`archon:event-parser.ts:81-99`):

   ```
   isError: true, errorSubtype: 'omp_incomplete_output'
   "OMP CLI completed without a required session header."
   ```

   So switching to `--mode rpc` with no other change makes **every turn fail**, with an error message that blames a missing header rather than the mode switch. This is the first thing the switch must fix, ahead of any payload consideration.

   Door closed on the one alternative: `main.ts:1072` also calls `getHeader()`, but it reads `header?.providerPromptCacheKey` to inherit a prompt-cache key on fork (`main.ts:1065-1085`) — **it never writes to stdout**. `print-mode.ts:114` is the only stdout emission of the header in the tree.

   **Fix:** rpc mode exposes the id through the `get_state` command — `RpcSessionState.sessionId: string`, required, not optional (`rpc-types.ts:108`; handler at `rpc-mode.ts:1106-1116`; response envelope at `rpc-types.ts:214`). Send `get_state` and seed `sessionId` from `data.sessionId`.

   Two weaker sources, for completeness: `session_info_update` carries it (`rpc-mode.ts:1030`) but fires only from a slash-command title-change callback; `get_messages_page` carries it (`:1394`) but only in response to a paging request. Neither is emitted spontaneously — `get_state` is the only reliable path.

   `[?]` **Timing not verified.** `session.sessionId` assignment timing was not traced, so whether `get_state` is answerable immediately after `ready` is unconfirmed. This is not load-bearing: Archon reads `sessionId` only at `buildResult` time, so issuing `get_state` any time before closing stdin satisfies the check. Prefer right after `ready`; fall back to after the first `agent_end` if it comes back empty.

3. **New frame kinds a line-parser will hit.** Beyond agent events: `ready` (`rpc-mode.ts:727`), `response` envelopes for every command (`rpc-types.ts:194+`), `extension_ui_request` (`:692`), `extension_error` (`:966`), `available_commands_update` (`:993`), `command_output` (`:1025`), `session_info_update` (`:1030`), `config_update` (`:1033`), `prompt_result` (`:155`), `rpc_frame_error` (`rpc-frame.ts:236`), and under v2 `rpc_chunk`. Archon's parser has a `default:` arm that flushes and ignores (`archon:event-parser.ts:207-210`), so unknown kinds are survivable — **except** `rpc_chunk`, which under v2 must be reassembled, and which Archon will never see unless it negotiates.

4. **Process lifecycle inverts.** json mode takes the prompt as argv and exits after the turn. rpc mode blocks on stdin and **exits only on stdin EOF** — `readRpcInputFrames` at `rpc-mode.ts:1521-1525`, then `process.exit(0)` at `:1540`. Archon must send `{type:"prompt", message}` on stdin and **close stdin to terminate**. A parser that waits for `agent_end` and expects exit will hang. Note `agent_end` already does not mean end-of-stream in json mode either — Archon handles this at `event-parser.ts:157-159` (`isFollowUpTurnEvent`); rpc mode makes it permanent.

5. **`agent_end.messages` may be a suffix, in _both_ versions.** `compactTerminalFrame` (`rpc-frame.ts:191-215`) fires whenever the frame exceeds 1 MiB, slicing off messages the client already received via `message_end` and adding `messageCount`. **New behavior — json mode never went through `rpc-frame.ts` at all.** A reader must not treat `agent_end.messages` as the complete transcript. Archon currently uses `agent_end` only as a turn boundary (`archon:event-parser.ts:207-210`), so it is not exposed today — but it constrains any future use.

6. **Malformed input does not kill the process.** A bad stdin line yields `{type:"response", command:"parse", success:false}` and the loop continues (`rpc-mode.ts:1523-1524`, `rpc-input.ts:41-62`) — deliberate, per OMP issue #5194.

7. **`extension_ui_request` — low risk under Archon's current args.** The _blocking_ variants (`editor` at `:641`, `requestRpcDialog` at `:692`) are extension-driven and await a host response indefinitely unless `opts.timeout` is set (`:676-681`); an unanswered one **hangs the run**. Archon passes `--no-extensions` (`archon:provider.ts:132`, `enableExtensions !== true`) so these should not fire. The non-extension emitters — `notify` (`:822`), `setStatus` (`:831`), `setWidget` (`:850`), `setEditorText` (`:894`) — are all explicitly fire-and-forget. `setTitle` is additionally gated on `PI_RPC_EMIT_TITLE=1` (`:876-880`). On stdin close, pending requests are rejected rather than left hanging (`:1528-1530`). **Residual risk:** if Archon ever drops `--no-extensions`, an unanswered blocking dialog becomes a hang with no timeout.

---

## Recommendation

**Negotiate v2.** Not for `providerPayload` — that field is a non-issue Archon already lives without, and is `undefined` outside OpenAI-Responses backends. Negotiate because **v1's writer-side shrink is silent, type-blind, and unreachable from the reader**, and because rpc mode's raw `partial` snapshots make >1 MiB frames materially more likely than json mode ever did. v2 replaces "quietly truncate assistant text and tool arguments" with "reassemble, losslessly, up to 64 MiB". The cost is ~79 liftable lines plus ~30 of handshake, against one new frame kind.

**There is no cheaper knob.** The full `RpcCommand` union is 39 commands (`rpc-types.ts:28-66`) and contains **no event-verbosity or subscription filter for the main session**. The only subscription control is `set_subagent_subscription` (`:47`, levels `off`/`progress`/`events` per `:163`), which governs _subagent_ event forwarding, not the main stream. `streamingBehavior` on `prompt` (`:33`) is queue policy for mid-turn prompts (`rpc-mode.ts:121`, `:1056-1062`), not verbosity. So `partial` cannot be suppressed writer-side by any command — negotiating v2 is the only lever a client has over frame size.

Dropping `providerPayload` on receipt is orthogonal and nearly free (`delete msg.providerPayload` on `message_start`/`message_end`/`turn_end`/`agent_end`, plus inside `assistantMessageEvent.partial`) — do it as a size reduction, but do not treat it as an alternative to v2. It does not touch the truncation problem.

If v2 is deferred: v1 is a correct, working default (Q5) — but Archon should detect the in-band elision sentinels (`…[N chars elided for RPC frame]`, `rpcFrameElidedKeys`) rather than trusting frame contents, since the existing `omp_stream_mismatch` path (`archon:event-parser.ts:250-258`) will surface truncation as a hard error with a misleading name.

---

## Unresolved

1. **`[?]` Binary vintage.** Everything is cited at 18.0.4; the installed binary is 18.0.11 and Archon pins nothing. The codec files are byte-identical 17.4.0↔18.0.4, so the Q3/Q4/Q5 answers are very likely stable — but `rpc-mode.ts` line numbers (Q7's frame-kind list, the `ready` and negotiate sites) **will** have moved.
2. ~~Does rpc mode emit a `session` header?~~ **Resolved: no.** See Q7 item 2 — it is a hard breakage with a known fix (`get_state`). Re-verify against the target binary given item 1.
3. **`[?]` No measured byte size for `providerPayload`.** Only the indirect evidence in Q1. Moot for the recommendation, but unmeasured.
4. **`[?]` No measured frequency of >1 MiB frames** under rpc mode's raw `partial`. The quadratic mechanism is proven from source; the actual crossover rate for Archon's workloads is not. This is the number that would make the v2 case quantitative rather than structural — a one-turn capture against a real workload would settle it.
5. **Not investigated:** the mid-turn steering surface itself (`steer` / `follow_up` / `abort_and_prompt`, `streamingBehavior: "steer" | "followUp"` at `rpc-types.ts:33`) — the actual motivation for the switch. Confirmed present; semantics out of scope for this task.
