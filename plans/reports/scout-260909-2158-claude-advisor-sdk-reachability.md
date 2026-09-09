# Scout: Claude advisor reachability through the Agent SDK Archon uses

Date: 2026-09-09 | Read-only source research | Author: ScoutClaudeAdvisor

## Verdict (one line)

**The advisor block IS reachable today — it rides the SDK message stream unfiltered — but it is not typed by the SDK, and Archon silently drops it.** The gate is server-side (GrowthBook flag + first-party beta), so a self-hosted install cannot turn it on with only its own API key by any documented means.

## Sources and their limits (read this before trusting a citation)

| Source                           | Identity                                                                                                                                                                                   | Trust                                                                                          |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------- |
| claude-code checkout             | `/Users/dale/Desktop/workspace/OceanLabs/agentic-os-plan/claude-code`, `package.json:3` → `claude-code-oss` **2.15.1**, commit `352010f "init project"` (no upstream ref)                  | Source of truth for _how the feature works_; vintage vs shipped CLI unresolved — see skew note |
| Installed SDK                    | `@anthropic-ai/claude-agent-sdk` **0.3.209** (`package.json:76`, `packages/providers/package.json:42`, `bun.lock:276`)                                                                     | Version verified from the repo                                                                 |
| Published SDK artifacts          | fetched from unpkg for the exact pinned `0.3.209`: `sdk.d.ts`, `sdk-tools.d.ts`, `bridge.d.ts`, `browser-sdk.d.ts`, `agentSdkTypes.d.ts`, `sdk.mjs`, `package.json` → cached in scratchpad | Substituted for `node_modules` — see hook note                                                 |
| GrowthBook / API server behavior | not inspectable from any source here                                                                                                                                                       | Unknown; every claim about it is marked `[?]`                                                  |
| Archon                           | working tree, branch `develop`                                                                                                                                                             | Direct                                                                                         |

**`node_modules` read was blocked**, not skipped: the user's `scout-block` hook (`/Users/dale/.claude/hooks/scout-block.cjs`, pattern `node_modules`) denies both Bash and Read there. I did not circumvent it. I fetched the **published artifacts of the identical pinned version 0.3.209** from unpkg instead — the same published tarball the lockfile pins (`sha512` at `bun.lock:276`). I could not read the local copy to compare. Citations below use `sdk.d.ts:<line>` / `sdk.mjs:<byte-offset>` against those fetched files (scratchpad `.../scratchpad/sdk-types.d.ts` = published `sdk.d.ts`).

**Version skew `[?]`** — SDK `0.3.209/package.json` declares `"claudeCodeVersion": "2.1.209"`; the checkout is `2.15.1`. The two numbering lines cannot be ordered from source. Skew is **materially mitigated** for the claims that matter: the shipped `sdk.mjs` carries the _same_ advisor Settings schema, describe-string identical to the checkout's (`sdk.mjs@863742` vs `utils/settings/types.ts:712-715`), and the shipped model catalog carries a per-model `advisor_rank` field (`sdk.mjs@369221`, `@376039`…). The advisor feature exists in the 0.3.209 vintage. Mechanism details cited only from the checkout still carry the skew caveat.

---

## Q1 — Is advisor confined to the CLI harness, or does it ride the SDK stream?

**It rides the stream. Verified end-to-end, seven links, no filter anywhere.**

1. **Produced by the API, not synthesized.** `advisor_tool_result` arrives as a `content_block_start` on the wire and is stored verbatim: `services/api/claude.ts:2039-2050` — the `default:` branch does `contentBlocks[part.index] = { ...part.content_block }`, then flips `isAdvisorInProgress` for logging only. Nothing consumes or removes it.
2. **Survives normalization.** `utils/messages.ts:2651-2751` `normalizeContentFromAPI()` — `default: return contentBlock` (`:2747-2748`). Only `tool_use` and `server_tool_use` inputs are reshaped; unknown types pass untouched.
3. **Lands in the assistant message.** `services/api/claude.ts:2192-2210` (per-block) and `:2571-2594` (final) build `AssistantMessage` with that content.
4. **Split per block for the SDK.** `utils/messages.ts:750-772` — one output message per content block, `content: [_]`.
5. **Not filtered as "empty".** `utils/messages.ts:689-719` `isNotEmptyMessage()` — `content[0].type !== 'text'` returns **true** (`:711-712`). An advisor-only frame passes.
6. **Converted to the SDK frame.** `utils/queryHelpers.ts:102-119` `normalizeMessage()` yields `{ type: 'assistant', message: _.message, parent_tool_use_id, session_id, uuid, error }` — `message` is the whole `BetaMessage`; the block is inside `message.content[0]`.
7. **Written to stdout verbatim.** `QueryEngine.ts:761-769` → `ask()` `QueryEngine.ts:1186` → `cli/print.ts:2145` (`for await (const message of ask(...))`) → `cli/print.ts:2233,2241` `output.enqueue(message)` → `cli/print.ts:865` (`for await … runHeadlessStreaming`) → `cli/print.ts:886` `await structuredIO.write(message)`.

And the SDK does **not** filter it on the way in — this is the link that matters most for Archon and it is verified against the shipped runtime, not the source tree:

8. `sdk.mjs@537805` `ProcessTransport.readMessages()`: per stdout line, `o = Ze(r)` (JSON parse), `yield o`. No schema validation, no allowlist.
9. `sdk.mjs@546087` `Query.readMessages()`: intercepts only `control_response`, `control_request`, `control_cancel_request`, `keep_alive`, `transcript_mirror`; **everything else** → `this.inputStream.enqueue(e)`. Assistant frames are forwarded whole.

Conclusion: an advisor call produces an ordinary `type: 'assistant'` SDK message whose `message.content[0].type` is `'server_tool_use'` (name `'advisor'`) or `'advisor_tool_result'`. Archon's `for await` loop already receives it.

### Correction to the brief's premise

The brief listed three discriminators. Only **one and a half** survive at the SDK boundary:

- **Yes — block `type`** (`advisor_tool_result` / `server_tool_use` + `name === 'advisor'`): present, and the only reliable signal. `utils/advisor.ts:36-44` `isAdvisorBlock()` is the exact predicate.
- **Partial — "assistant-role, unlike ordinary tool results"**: true, but useless as a _discriminator_ at step 6, because every block already arrives in its own assistant frame.
- **No — `advisorModel` on the AssistantMessage**: **dropped**. It exists internally (`services/api/claude.ts:2588-2590`, `:2207`; carried through `utils/messages.ts:771` for the ink renderer) but `utils/queryHelpers.ts:110-117` does not copy it onto the SDK frame, and the published type has no such field (`sdk.d.ts:2787-2810`). **Archon can never learn which advisor model answered.** Any design that keys on `advisorModel` is dead on arrival.

Payload shape (`utils/advisor.ts:16-32`): `content` is one of `{type:'advisor_result', text}`, `{type:'advisor_redacted_result', encrypted_content}`, or `{type:'advisor_tool_result_error', error_code}`. Only the first is displayable text — the CLI's own list view renders only that case (`components/Messages.tsx:743-748`).

---

## Q2 — The SDK surface: what is actually typed in 0.3.209

Installed/pinned version: **0.3.209**. Grep of **every** published `.d.ts` (`sdk.d.ts`, `sdk-tools.d.ts`, `bridge.d.ts`, `browser-sdk.d.ts`, `agentSdkTypes.d.ts` — the last is just `export * from './sdk.js'`):

| Symbol                                      | In SDK types?                                                                                                                                                                |
| ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `advisor_tool_result`                       | **No** — 0 hits in every `.d.ts`                                                                                                                                             |
| `server_tool_use` (as a content-block type) | **No** — 0 hits in `sdk.d.ts`; the single hit in `sdk-tools.d.ts:110-113` is the usage counter `{ web_search_requests, web_fetch_requests }` (read, not inferred), unrelated |
| `AdvisorBlock` / `isAdvisorBlock`           | **No**                                                                                                                                                                       |
| `advisorModel`                              | **Yes, once** — `sdk.d.ts:6161-6163`, inside `export declare interface Settings` (`sdk.d.ts:4794`). Not on `Options`, not on any message type                                |

So: **the block is untyped, the config key is typed.** Consequences:

- `SDKAssistantMessage.message` is `BetaMessage` (`sdk.d.ts:2787-2789`, imported from `@anthropic-ai/sdk` at `sdk.d.ts:1`). At runtime the advisor block sits in `content[0]`; in TypeScript it is not in the `BetaContentBlock` union, so consuming it requires a narrow assertion. The upstream comment is explicit: _"The SDK does not yet have types for advisor blocks. TODO(hackyon): Migrate to the real anthropic SDK types when this feature ships publicly"_ (`utils/advisor.ts:7-8`).
- `SDKPartialAssistantMessage` (`sdk.d.ts:4028-4035`) carries the raw `BetaRawMessageStreamEvent`, so `includePartialMessages` would surface the same block at `content_block_start` time. Archon does **not** use that mode — zero occurrences of `includePartialMessages` anywhere in `packages/providers/src/`.

---

## Q3 — Archon's handling today: silent drop

`packages/providers/src/claude/provider.ts:1139-1150`:

```ts
for (const block of content) {
  if (block.type === 'text' && block.text) {
    yield { type: 'assistant', content: block.text, textMode: 'complete' };
  } else if (block.type === 'tool_use' && block.name) {
    yield { type: 'tool', toolName: block.name, toolInput: block.input ?? {}, ... };
  }
}
```

Two branches, **no `else`**. An `advisor_tool_result` block is dropped with **no log, no warning, no event** — it does not reach the workflow event log, the SSE stream, artifacts, or the UI.

The type is also hand-declared and narrowed to exactly those two cases:

```ts
// packages/providers/src/claude/provider.ts:95-101
interface ContentBlock {
  type: 'text' | 'tool_use';
  text?: string;
  name?: string;
  input?: Record<string, unknown>;
  id?: string;
}
```

That is a live violation of AGENTS.md _SDK Type Patterns_ ("import and use external SDK types directly … rather than redeclaring an equivalent local interface"), and it is precisely why the block is invisible: the compiler cannot warn about a case the local type says cannot exist.

Contrast — Archon **does** already log unknown _system_ subtypes (`provider.ts:1269`, `claude.system_message_unhandled`). The unknown-**content-block** equivalent is simply missing. Same file, same loop, one branch apart.

---

## Q4 — The gate: can a self-hosted install turn it on?

**No — not by any means the code exposes to a normal install.** Four independent gates, all in `utils/advisor.ts:60-69` unless noted:

| Gate                                                                                               | Where                                               | Can an operator set it?                                                                       |
| -------------------------------------------------------------------------------------------------- | --------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| GrowthBook flag `tengu_sage_compass` → `{ enabled, canUserConfigure, baseModel, advisorModel }`    | `utils/advisor.ts:53-58, 68`                        | **No** — server-delivered feature config                                                      |
| First-party (or Foundry) API provider, no `CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS`                 | `utils/advisor.ts:64-67` → `utils/betas.ts:215-220` | Only by using the first-party API; Bedrock/Vertex 400 on the header (comment `advisor.ts:64`) |
| Base model must support advisor: `opus-4-6` / `sonnet-4-6` substring, **or `USER_TYPE === 'ant'`** | `utils/advisor.ts:89-96`                            | model choice: yes; the `ant` bypass: see below                                                |
| Kill switch `CLAUDE_CODE_DISABLE_ADVISOR_TOOL`                                                     | `utils/advisor.ts:61-63`                            | Yes — but it only turns it **off**                                                            |

Names, exactly:

- **Beta header:** `advisor-tool-2026-03-01` — `constants/betas.ts:32`, pushed at `services/api/claude.ts:1076-1078` whenever `isAdvisorEnabled()`, i.e. even on non-agentic queries so history can be parsed.
- **Feature flag:** `tengu_sage_compass` — `utils/advisor.ts:56`.
- **Env vars:** `CLAUDE_CODE_DISABLE_ADVISOR_TOOL` (off switch), `CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS` (off switch), `USER_TYPE` (internal bypass).
- **Settings key:** `advisorModel` — `utils/settings/types.ts:712-715`, mirrored in the shipped SDK at `sdk.d.ts:6161-6163`.
- **CLI flag:** `--advisor <model>` — `main.tsx:5210-5215`, registered **only** when `canUserConfigureAdvisor()`; slash command `/advisor` `commands/advisor.ts:96-107`, same gate.
- **Request shape:** a server tool appended to `tools`: `{ type: 'advisor_20260301', name: 'advisor', model: advisorModel }` — `services/api/claude.ts:1386-1395`, plus `ADVISOR_TOOL_INSTRUCTIONS` into the system prompt (`:1366`, text at `utils/advisor.ts:130-145`).

**The SDK path is explicitly in scope, not an accident.** `services/api/claude.ts:1065-1070`: `isAgenticQuery` includes `options.querySource === 'sdk'`, and `:1081` gates the advisor tool on exactly that. Headless/print mode wires `advisorModel` into initial state at `main.tsx:3716` (and `:4154`). Anthropic built this to fire for SDK consumers.

**Two consequences the decision should not miss:**

1. **Silent server-side activation is possible without any Archon change.** `getExperimentAdvisorModels()` (`utils/advisor.ts:75-85`) plus `services/api/claude.ts:1084-1093`: when the flag ships with `baseModel`/`advisorModel` set and `canUserConfigure: false`, the CLI **overrides** the advisor model itself whenever the base model matches — note this is the _experiment_ branch, which fires precisely when the operator is **not** allowed to configure anything — no user config, no flag on Archon's side. On that day, Archon's runs start receiving advisor blocks and dropping them at `provider.ts:1139-1150` with zero signal. This is a latent gap **independent** of the build-now-vs-later decision.
2. **History rewriting on a flag flip.** Without the beta header, `stripAdvisorBlocks()` (`utils/messages.ts:5463-5487`) replaces advisor content with the literal text `[Advisor response]` before the request (`services/api/claude.ts:1303-1305`) — the API rejects a dangling advisor `server_tool_use` otherwise (`utils/messages.ts:5223-5224`). Relevant to Archon's `persist_session` resume if the flag toggles between runs.

**The only conceivable local test path, and it is unverifiable from source `[?]`:** `USER_TYPE` is a plain env var. Setting `USER_TYPE=ant` unlocks the GrowthBook env override `CLAUDE_INTERNAL_FC_OVERRIDES` (`services/analytics/growthbook.ts:173-184`, gated solely on that env check) and bypasses the model gate (`utils/advisor.ts:94`). A first-party-keyed install could therefore make the **client** send `advisor-tool-2026-03-01` and the `advisor_20260301` tool spec. **Whether the API accepts that beta for a non-allowlisted account cannot be determined from this source tree** — it is a server-side decision. Treat as unproven; do not plan a test schedule around it.

---

## Q5 — What would have to change, and is there an Archon-side seam?

**Nothing in the SDK has to change for the data to arrive.** It already arrives (Q1). Three separable pieces of work, smallest first:

1. **Stop the silent drop (recommended regardless of the decision).** Add the `else` branch at `packages/providers/src/claude/provider.ts:1150` — log the unknown block type, mirroring `claude.system_message_unhandled` at `:1269`. Cost: a few lines. Value: the day advisor (or any future server tool) fires, Archon has evidence instead of silence. Ties directly to AGENTS.md _Fail Fast + Explicit Errors_.
2. **Fix the type, which is the real root cause.** Replace the hand-rolled `ContentBlock` (`provider.ts:95-101`) with `BetaMessage['content'][number]` from `@anthropic-ai/sdk` — the type `SDKAssistantMessage.message` is actually declared as (`sdk.d.ts:2789`, imported at `sdk.d.ts:1`). This turns "block types we do not handle" into something the compiler can see. Advisor blocks still need a narrow assertion (`utils/advisor.ts:7-8`), which is exactly the sanctioned SDK-type-assertion case in AGENTS.md. **Caveat:** `@anthropic-ai/sdk` is **not** a declared dependency of any Archon package — it resolves only as the agent SDK's peer dep (`bun.lock:276` declares the peer `>=0.93.0`; `bun.lock:294` resolves `0.93.0`), and `@earendil-works/pi-ai` separately pins `0.91.1` (`bun.lock:934`). Adopting the type means adding an explicit direct dependency to `packages/providers/package.json`, which today lists only `@anthropic-ai/claude-agent-sdk` (`:42`). That is a real, if small, decision — not a free import.
3. **A display path** (`type: 'advisor'` event → workflow event log → UI). Only this piece is the "build the Claude advisor path" feature, and it is the piece that **cannot be tested today** because of Q4.

**Existing passthrough seams:** none for content blocks. The `settings` seam exists but is unused — `Options.settings?: string | Settings` (`sdk.d.ts:1836`) accepts `advisorModel`, and Archon builds its options at `packages/providers/src/claude/provider.ts:1634` (`buildBaseClaudeOptions`) → `query({ prompt, options })` at `:1689`, passing **no** `settings` key (grep: zero `settings:` in that file). So wiring `advisorModel` through later is a one-key addition — but per Q4 it is inert until the flag ships with **`canUserConfigure: true`**, not merely `enabled: true`: `main.tsx:3101-3103` reads `getInitialAdvisorSetting()` only when `canUserConfigureAdvisor()`, and that helper returns `undefined` otherwise (`utils/advisor.ts:71-73, 108-113`).

---

## Bottom line for the build-now-vs-later decision

- **Reachability is not the blocker.** The content reaches Archon's Claude provider unfiltered, today, in `message.content[0]`.
- **Testability is the blocker.** One server-delivered GrowthBook flag gates everything and no operator input can set it; the beta header is first-party-only (server-side acceptance unknown); the model choice and the kill switch are the only client-side gates, and the kill switch only turns it off. There is no documented way for a self-hosted install to enable advisor with its own key. A feature built now cannot be exercised end-to-end, only unit-tested against a synthetic block.
- **Recommendation:** ship OMP-only for the user-facing feature; do items 1 and 2 above now as a small, independently justified hygiene change. They are ~20 lines, fix a live AGENTS.md violation, and convert the "Anthropic flips the flag" scenario from silent data loss into a logged event.
- **Design constraint for whenever the Claude adapter is built:** discriminate on block `type` only (`isAdvisorBlock` semantics, `utils/advisor.ts:36-44`), handle all three content variants (`text`, `encrypted_content`, `error_code` — `utils/advisor.ts:16-32`), and do **not** expect `advisorModel` on the frame.

---

## Unresolved questions

1. `[?]` **Version skew.** Checkout is `claude-code-oss 2.15.1`; SDK 0.3.209 declares `claudeCodeVersion 2.1.209`. Orderable only against upstream release history, which this checkout lacks (single commit, no tags). Mitigated but not eliminated — see the skew note. To close: `git log` on a real upstream clone, or extract the bundled binary via the SDK's `extractFromBunfs.js` and read its version string.
2. `[?]` **Server-side acceptance of the beta for a non-first-party account.** Unknowable from source. Decides whether _any_ local test of a Claude advisor path is possible.
3. `[?]` **`advisor_rank` semantics.** Present per model in the shipped catalog (`sdk.mjs@369221` etc., schema `@380314`); I did not verify it is the advisor-tool selection rank rather than an unrelated ranking. Does not affect any conclusion — it is corroborating evidence only.
4. **Closed, not open:** `includePartialMessages` — Archon does not use it (zero hits in `packages/providers/src/`). `sdk-tools.d.ts` `server_tool_use` — read at `:110-113`, it is a usage counter.
5. **Not investigated (out of scope):** the OMP advisor path, and whether Archon's workflow event schema has a natural slot for a non-tool, non-text assistant artifact.
