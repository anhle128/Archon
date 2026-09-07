# DeepSeek Harness provider (`deepseek`) — Design

Status: **draft — awaiting final review** · Date: 2026-09-07 · Next: `writing-plans`

> **v1 scope decision (accepted):** per-request token/cost usage is **deferred**, not shipped in v1.
> The ACP route emits only context occupancy, not billing tokens (see §5, §6, §12).
> This is an accepted, documented gap versus "full feature parity"; the path to add it later is §14 (a DSH-side ACP `_meta` usage extension).
> No DeepSeek Harness change is required for v1.

## 1. Goal

Add a first-class community provider `deepseek` (`builtIn: false`) to `@archon/providers`.
It targets full feature parity with the other providers except per-request usage, which is deferred (§14).
It is powered by the DeepSeek Harness (`dsh`) agent runtime — the engine behind `dsh-tui`.
The operator authenticates via an Alibaba Cloud DashScope token over the OpenAI-compatible endpoint, not a direct DeepSeek key.

## 2. Key findings (evidence)

`dsh-tui` is an interactive TUI, unusable headless; the runtime under it (DeepSeek Harness, `dsh`) is drivable programmatically.
The runtime ships two automation surfaces, both auto-created on first use (`packages/bundle/base/README.md:46`).

SDK JSON-RPC (`dsh --profile sdk`): sessions are in-process only — the server calls `ctx.agents.create({sessionId})`, never `resume()` (`packages/sdk/server/src/server.ts:259-292`); it carries per-request usage but has no durable resume and no cancel.
ACP (`dsh --profile acp`, `@deepseek-ai/dsh-acp`): the standard [Agent Client Protocol](https://agentclientprotocol.com) automation server.
ACP has durable session persistence across process restarts (README:12); `session/resume` calls `ctx.agents.resume({resumeSessionId})` (`packages/acp/acp/src/session.ts:149`); it also has `session/cancel`, MCP servers, `session/set_config_option` (model + `reasoning_effort`), and semantic `session/update` streaming — but it drops per-request billing usage on the wire (`packages/acp/acp/src/updates.ts:87-101`).

Chosen surface: ACP, for durable resume + cancel + MCP; usage is deferred (§14).
The DSH `deepseek-official` LLM adapter is OpenAI-compatible-gateway capable and prefers `$DEEPSEEK_BASE_URL` (`packages/llm/llm-deepseek/README.md:40,54`), so it can target DashScope's compatible endpoint.
Archon's credential system already knows vendor `deepseek` → `DEEPSEEK_API_KEY` via the Pi vendor map, so delivery is fully data-driven with zero wiring.
A live SDK handshake spike succeeded (spawn → boot → `initialize`, ~2.3s, keyless), proving the runtime launches under Node from a Bun host; the spike and its `sdk`-profile side effect were reverted.

## 3. Architecture (ACP route)

Archon (Bun) acts as the ACP client in-process — the ACP SDK is a light, native-free JSON-RPC-over-stdio library, so no Node sidecar is required.
Only the DSH server needs Node, and we spawn it explicitly so Bun never runs it.

```
Archon @archon/providers (Bun)
  └─ @agentclientprotocol/sdk  (ClientSideConnection over ndJsonStream)
        └─ spawn: node <bundled dsh bin> --profile acp   (child; env carries creds)
              └─ DSH ACP server → deepseek-official adapter → DashScope/DeepSeek (HTTPS)
```

Dependencies added to `@archon/providers`: `@agentclientprotocol/sdk@1.4.0` (DSH's exact pin, for wire compatibility) and `@deepseek-ai/dsh` (the runtime, pinned to a matched line such as `0.1.2-rc.1`; ~588 transitive packages, accepted).
All value imports are lazy `await import()` inside `sendQuery` for compiled-binary safety; types use `import type`.
Runtime resolution uses the bundled `@deepseek-ai/dsh` (version-matched to the ACP client) rather than the operator's global `dsh`, so the `acp` profile and protocol always match.
A Node binary is resolved explicitly to run the server (`process.execPath` when it is Node, else `DEEPSEEK_NODE_BIN` or PATH); the host runtime is never assumed to be Node.
Client wiring follows `subagent-acp/src/run.ts:444`: `clientApp.connect(ndJsonStream(child.stdin→web, child.stdout→web))`, then `initialize` → `session/new` (or `session/resume`) → `session/prompt` → consume `session/update` → `session/cancel` on abort → `session/close`.
Bun caveat to verify in the spike: `ndJsonStream` plus the Node↔web stream adapters must run under Bun; if they do not, fall back to a thin Node sidecar running the same ACP client, kept as a localized swap.

## 4. Credentials & Alibaba/DashScope routing

API key delivery is data-driven with zero new wiring.
The registration declares `credentials: { kind: 'static', specs: [{ vendor: 'deepseek', displayName: 'DeepSeek', kinds: ['api_key'] }] }`, which merges onto the existing vendor and is delivered as `DEEPSEEK_API_KEY` into the run/chat env; store the DashScope token there.
Base URL is not in the delivery map, so the provider reads `assistants.deepseek.baseUrl` and injects `DEEPSEEK_BASE_URL` (it also honors an ambient value); point it at DashScope's compatible endpoint.

Precedence has two independent rules.
API key: `options.env.DEEPSEEK_API_KEY` (the acting user's vault) over ambient `process.env.DEEPSEEK_API_KEY`.
Base URL: `assistants.deepseek.baseUrl` over per-request/ambient `DEEPSEEK_BASE_URL` over the DSH default.

Child-env construction order is the safeguard:

```
child.env = { ...process.env }                 // ambient baseline
Object.assign(child.env, options.env)          // per-user creds win over ambient
if (config.baseUrl) child.env.DEEPSEEK_BASE_URL = config.baseUrl
child.env.DSH_PERMISSION_MODE = permissionMode // see §7
```

A global ambient token must never beat the acting user's vault key.
Fail fast with an actionable message if no key resolves from either layer.

## 5. Event mapping (ACP `session/update` → Archon `MessageChunk`)

The mapping uses the ACP SDK's own types, with no hand-rolled shapes.

| ACP surface | Archon `MessageChunk` |
|---|---|
| `session/update` agent message text | `{type:'assistant', content}` |
| `session/update` agent thought | `{type:'thinking', content}` |
| tool call lifecycle (start) | `{type:'tool', toolName, toolInput, toolCallId}` |
| tool call lifecycle (end) | `{type:'tool_result', toolName, toolOutput, toolCallId, toolOutcome}` |
| `usage_update {used,size}` | context occupancy only; NOT mapped to `tokens`/`usageBreakdown` (§6, §14) |
| `session/prompt` settlement (`stopReason`) | captured → result `stopReason` (via ACP `codec.ts` mapping) |
| turn done | `{type:'result', sessionId, stopReason, resumed}` (no `tokens`/`usageBreakdown` in v1) |

Streaming granularity is per committed message/thought (ACP emits committed semantic updates, not raw deltas); token-level deltas are out of scope.
Resume is fail-fast: with `resumeSessionId`, call `session/resume`, and if it fails (the persisted session is gone) surface a classified error — never silently `session/new`; `session/new` is used only when no `resumeSessionId` is given, and the `resumed` flag is stamped via the shared `withResumedOutcome` helper.
Abort maps `options.abortSignal` to `session/cancel` (graceful), then closes and reaps the child and emits a `result` with `stopReason:'aborted'`.
Errors are never thrown out of `sendQuery`; they surface as a terminal `{type:'result', isError:true, errorSubtype, errors:[...]}` with a classified message.
Structured output is best-effort: on an `options.outputFormat` JSON schema, augment the prompt with the shared `augmentPromptForJsonSchema` and parse the final message into `result.structuredOutput`, and the dag-executor validates and re-asks up to three times.
Usage/billing is deferred in v1 (§14): ACP `usage_update` reports only context occupancy (`used`/`size`), not per-request input/output/cache/reasoning tokens (`packages/acp/acp/src/updates.ts:87-101`), so the result omits `tokens` and `usageBreakdown` and never synthesizes billing.

## 6. Capabilities

```
sessionResume:   true    // durable via ACP session/resume (verified)
mcp:             true    // ACP mounts stdio + Streamable HTTP MCP servers
effortControl:   true    // session/set_config_option reasoning_effort (off/low/high/max)
envInjection:    true    // child env carries creds + base URL
structuredOutput:'best-effort'
toolRestrictions:false · hooks:false · skills:false · agents:false
costControl:     false   // maxTokens is a token cap, not USD
thinkingControl: false   // governed by reasoningEffort
fallbackModel:   false · sandbox:false · settingSources:false
nativeTools:     false · containerExec:false
askHuman:        false   // permission requests are auto-answered, never surfaced (§7)
```

`askHuman:false` MUST hold (the "only Claude + Pi advertise AskHuman" test).
Per-request usage/billing is NOT reported in v1 (ACP emits context occupancy only, §5); the result chunk omits `tokens`/`usageBreakdown`, and §14 is the path to add it.

## 7. Permission handling (fail-safe)

The `acp` profile defaults to `workspace-write + ask` (`bundle/base/cordis.patch.yml:217,230-247`), so the server can emit `session/request_permission`, and without a client response the turn hangs.
The client registers `.onRequest(methods.client.session.requestPermission, …)` and auto-answers deterministically, never surfacing a human (matching `subagent-acp`, which defaults to `reject`).

Config `deepseek.permissionMode` (default `workspace-write`) drives the policy.
`workspace-write` injects `DSH_PERMISSION_MODE=workspace-write` and the client answers permission prompts with `cancelled` (reject), which is safe, never hangs, and confines the agent to workspace writes.
`danger-full-access` injects `DSH_PERMISSION_MODE=danger-full-access` so DSH policy becomes `never` (no prompts) with full access, and it is opt-in only.
Never auto-approve by default, and never silently force `danger-full-access`.

## 8. Config surface

`.archon/config.yaml`:

```yaml
assistants:
  deepseek:
    model: deepseek-v3                # passthrough id (confirm in DashScope console)
    baseUrl: https://dashscope-intl.aliyuncs.com/compatible-mode/v1   # confirm host
    providerRoute: deepseek-official  # DSH LLM route (default)
    profile: acp                      # dsh profile (default)
    permissionMode: workspace-write   # or danger-full-access
    maxTokens: 65536                  # optional
    effort: high                      # off|low|high|max (or a ladder rung)
    nodeBin: /path/to/node            # optional; else auto-resolved
```

Config is data-driven: `config-loader` auto-adds `assistants.deepseek` from the registration, with no `config-types.ts` edit (Phase-2 rule).
Optionally add a `tier-defaults.json` deepseek block so bare `small`/`medium`/`large` tiers resolve without user-configured tiers.

## 9. Integration points

New `packages/providers/src/community/deepseek/`: `provider.ts`, `acp-client.ts` (spawn + ACP drive + permission handler), `event-bridge.ts`, `capabilities.ts`, `config.ts`, `node-resolver.ts`, `errors.ts`, `registration.ts`, `index.ts`, plus tests.
Edits: `registry.ts` (one import + call in `registerCommunityProviders()`), `providers/index.ts` (export block), `providers/package.json` (deps + exports subpath + mock.module test-split entries), and `registry.test.ts` (describe block).
Then run `bun run generate:capability-matrix` (a CI gate).
Credential delivery, the config loader, and the `/api/auth/providers` matrix need no edits because they are data-driven.

## 10. Testing plan

Unit tests: `config` parse, `capabilities` shape, `node-resolver`, `event-bridge` (ACP `session/update` fixtures → `MessageChunk`), and the permission-handler policy.
Provider tests: `sendQuery` against a mocked ACP client (streaming, resume, abort, error-as-result, structured output).
Implementation-phase spike (needs the operator's Alibaba token): a real ACP handshake plus one turn through DashScope, and verification that Bun runs `ndJsonStream`.

## 11. Runtime prerequisites

A Node binary must be present to run the bundled `dsh` server.
`DEEPSEEK_API_KEY` (the DashScope token) is supplied via the vault or ambient env, and `DEEPSEEK_BASE_URL` points at DashScope; the `acp` profile auto-creates on first use.

## 12. Open risks

DSH `deepseek-official` ↔ DashScope wire compatibility is unconfirmed because the adapter serializes `reasoning_effort`/`thinking`, and only a live turn confirms it.
Dependency weight (~588 packages) is accepted and lazy-imported.
Bun compatibility of the ACP client streams must be verified in the spike, with a Node-sidecar fallback if needed.
The bundled `dsh` version pin must track the ACP client's line.
Per-request usage is absent in v1 (§14), so cost dashboards and `usage_ledger` stay empty for this provider until the extension lands.

## 13. Out of scope (YAGNI) for v1

Token-level streaming; MCP resources/prompts; ACP fork/delete/load/modes/plans/terminals; in-process Cordis embedding; the SDK JSON-RPC route; surfacing permission prompts to a human; auto-approving permission prompts by default; synthesizing billing usage from context occupancy.

## 14. Future work — per-request usage (deferred from v1)

The usage data already exists in DSH at `packages/acp/acp/src/updates.ts:93` as `event.data.usage` (a full `TokenUsage` with input/output/cache/reasoning), but the standard `usage_update` emits only `{used,size}`.
The path to add usage is a DSH-side ACP extension: emit that per-request `TokenUsage` under a stable namespaced ACP `_meta` key on `usage_update` (ACP 1.4 allows `_meta` on `UsageUpdate`), leaving `costUsd` absent unless the gateway reports real cost, and have Archon's ACP client consume `_meta` into `usageBreakdown`.
`deepseek-harness/` is the official upstream (`github.com/deepseek-ai/deepseek-harness`), not a fork we control, so this change must land upstream (accepted, released, then version-pinned) or be carried in a maintained fork — a materially higher-cost, cross-org effort, which is the reason usage is deferred from v1.
It also requires contract tests on the shared `_meta` key across both repos.
