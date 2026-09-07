# DeepSeek Harness Community Provider Implementation Plan

> **For Grok:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan task by task.

**Goal:** Add a community provider named `deepseek` that drives the pinned DeepSeek Harness runtime over ACP for chat and workflow turns, with durable resume, cancellation, MCP, conservative permissions, best-effort structured output, and no fabricated usage.

**Architecture:** `@archon/providers` remains the only production package changed outside generated documentation.
The Bun host dynamically loads the ACP client, starts the pinned DSH JavaScript entry point under a real Node executable, translates ACP notifications into `MessageChunk` values through an async queue, and terminates the child after every turn.
The provider uses the existing registry, config, credential, MCP-loader, structured-output, and resumed-outcome seams instead of adding provider-specific wiring in higher packages.

**Tech stack:** Bun, strict TypeScript, Bun test, `@agentclientprotocol/sdk@1.4.0`, `@deepseek-ai/dsh@0.1.2-rc.1`, Node `child_process`, and ACP v1 JSON-RPC over stdio.

**Authoritative input:** GitHub issue #121 and `docs/superpowers/specs/2026-09-07-deepseek-provider-design.md`.

## Scope and non-negotiable constraints

- Register `deepseek` with `builtIn: false` and credential vendor `deepseek`.
- Keep production implementation under `packages/providers/src/community/deepseek/`, apart from the existing provider registry and barrel seams.
- Do not edit `packages/core/src/config/config-loader.ts`, `packages/core/src/config/config-types.ts`, credential delivery, auth routes, API schemas, or database files.
- Do not add a DeepSeek block to `packages/workflows/src/defaults/tier-defaults.json` because no approved DashScope model IDs exist for the three tiers.
- Pin both new dependencies exactly, without `^` or `~` ranges.
- Keep every ACP SDK value import behind the dynamic import of `./acp-client` from `DeepseekProvider.sendQuery()`.
- Use `import type` for ACP types outside that dynamic module.
- Never import the DSH package as executable JavaScript in the Archon process.
- Start DSH as `<node> <resolved @deepseek-ai/dsh/lib/bin.js> --profile acp`.
- Use ACP `client().onNotification(methods.client.session.update, ...)`; do not try to `yield` from inside `connectWith()`.
- Send abort with `ctx.notify(methods.agent.session.cancel, ...)` because `session/cancel` is an ACP notification, not a request.
- Call `session/close` as a request after every created or resumed session.
- If `session/resume` fails, surface one terminal error result and never call `session/new`.
- Auto-answer every permission request with `cancelled`; only explicit `danger-full-access` changes the DSH permission environment.
- Do not advertise ACP filesystem, terminal, or elicitation client capabilities and do not add handlers for them.
- Support stdio and Streamable HTTP MCP declarations; fail fast on SSE because the pinned DSH ACP implementation rejects it.
- Build the MCP expansion environment as `{ ...process.env, ...requestOptions.env }` so acting-user and codebase values beat ambient values.
- Never map ACP `usage_update` to `tokens`, `usageBreakdown`, or cost because pinned DSH sends context occupancy rather than per-request billing usage.
- Never log or expose the resolved `DEEPSEEK_API_KEY` in errors, child stderr, test output, or the live spike.
- Use the existing `augmentPromptForJsonSchema`, `tryParseStructuredOutput`, `withResumedOutcome`, and `resumedOutcome` helpers.
- Keep `askHuman: false`, `nativeTools: false`, and `containerExec: false`.
- Run package tests from their package directories and never run root `bun test`.
- Use `bun run validate` for the final repository check.

## File map

### Create

- `packages/providers/src/community/deepseek/capabilities.ts` defines the exact capability object.
- `packages/providers/src/community/deepseek/config.ts` parses provider-owned config and translates effort.
- `packages/providers/src/community/deepseek/config.test.ts` covers supported config, invalid config, and the provisional `maxTokens` failure.
- `packages/providers/src/community/deepseek/node-resolver.ts` resolves Node and the pinned DSH entry point.
- `packages/providers/src/community/deepseek/node-resolver.test.ts` covers precedence, executability, Windows behavior, source resolution, and compiled-mode failure.
- `packages/providers/src/community/deepseek/env.ts` constructs the child environment.
- `packages/providers/src/community/deepseek/env.test.ts` proves credential, base-URL, and permission precedence.
- `packages/providers/src/community/deepseek/permission.ts` returns the fail-safe ACP permission answer.
- `packages/providers/src/community/deepseek/permission.test.ts` proves no option is selected.
- `packages/providers/src/community/deepseek/errors.ts` defines typed provider errors, terminal error chunks, and secret redaction.
- `packages/providers/src/community/deepseek/errors.test.ts` covers every subtype and secret redaction.
- `packages/providers/src/community/deepseek/event-bridge.ts` maps typed ACP session updates to chunks while retaining tool-call state.
- `packages/providers/src/community/deepseek/event-bridge.test.ts` uses ACP-typed fixtures, including the shape emitted by pinned DSH.
- `packages/providers/src/community/deepseek/mcp.ts` validates and converts Archon MCP maps into ACP declarations.
- `packages/providers/src/community/deepseek/mcp.test.ts` covers stdio, HTTP, command lookup, malformed entries, and rejected SSE.
- `packages/providers/src/community/deepseek/async-queue.ts` bridges callback notifications into an async iterator.
- `packages/providers/src/community/deepseek/async-queue.test.ts` covers order, close, and queued failure.
- `packages/providers/src/community/deepseek/acp-client.ts` owns process transport, ACP lifecycle, streaming, abort, close, and reaping.
- `packages/providers/src/community/deepseek/acp-client.test.ts` drives the client against an in-process fake ACP agent.
- `packages/providers/src/community/deepseek/provider.ts` implements `IAgentProvider` and the error-as-result boundary.
- `packages/providers/src/community/deepseek/provider.test.ts` tests orchestration through injected, typed seams.
- `packages/providers/src/community/deepseek/provider-lazy-load.test.ts` proves registry import and instantiation do not evaluate ACP SDK values.
- `packages/providers/src/community/deepseek/ndjson-stream.test.ts` characterizes Bun's Node-to-Web stream adapters with the pinned ACP SDK.
- `packages/providers/src/community/deepseek/registration.ts` registers the provider idempotently.
- `packages/providers/src/community/deepseek/index.ts` exposes the supported DeepSeek surface.
- `packages/providers/src/community/deepseek/acp-handshake-spike.ts` is an explicit opt-in live handshake and one-turn check.

### Modify

- `packages/providers/src/types.ts` adds `DeepseekProviderDefaults` in the contract layer.
- `packages/providers/src/registry.ts` imports and invokes `registerDeepseekProvider()` in the community aggregator.
- `packages/providers/src/registry.test.ts` covers registration metadata, capabilities, credentials, and idempotence.
- `packages/providers/src/index.ts` re-exports the public DeepSeek surface.
- `packages/providers/package.json` adds exact dependencies, a DeepSeek export, focused test invocations, and the opt-in spike script.
- `bun.lock` records the exact dependency graph.
- `packages/workflows/src/loader.test.ts` proves a registered `provider: deepseek` workflow parses successfully.
- `scripts/generate-capability-matrix.ts` adds the partial-MCP caveat for DeepSeek.
- `packages/docs-web/src/content/docs/reference/provider-capabilities.md` is regenerated and never edited by hand.
- `packages/docs-web/src/content/docs/getting-started/ai-assistants.md` documents setup, config, limitations, and usage behavior.
- `packages/docs-web/src/content/docs/reference/configuration.md` documents provider config and environment variables.
- `packages/docs-web/src/content/docs/guides/mcp-servers.md` documents DeepSeek's stdio/HTTP support and SSE rejection.

## Verified external contracts

| Contract | Pinned behavior the implementation must use |
| --- | --- |
| ACP transport | `ndJsonStream(output: WritableStream<Uint8Array>, input: ReadableStream<Uint8Array>)` returns an ACP `Stream`. |
| ACP client | `client({ name }).onRequest(...).onNotification(...).connectWith(streamOrAgent, operation)` is the supported fluent API. |
| Session updates | Updates arrive through `methods.client.session.update` notifications whose params contain `{ sessionId, update }`. |
| Abort | `methods.agent.session.cancel` is a notification and must be sent with `notify()`. |
| Close | `methods.agent.session.close` is a request and must be sent with `request()`. |
| Resume | `ResumeSessionResponse` does not expose an `ActiveSession`, so fresh and resumed turns must both use direct `ctx.request()` calls. |
| Model selection | Pinned DSH accepts `configId: 'model'` with `value: JSON.stringify([providerRoute, model])`. |
| Effort | Pinned DSH accepts only the `reasoning_effort` configuration option in addition to `model`. |
| MCP | Pinned DSH accepts ACP stdio and Streamable HTTP declarations and rejects SSE declarations. |
| DSH tool result | Pinned DSH normally emits tool output in `ToolCallUpdate.content`, so `rawOutput` cannot be assumed present. |
| Usage | Pinned DSH emits context `used` and `size`; it does not provide the billing-token breakdown required by Archon's usage contract. |
| DSH default | The pinned ACP profile advertises `deepseek-official` with `deepseek-v4-flash`; the plan does not invent a `deepseek-v3` tier mapping. |

## Open questions with binding provisional defaults

1. **How should `maxTokens` travel over pinned DSH ACP?**
The issue lists `maxTokens`, but `@deepseek-ai/dsh-acp@0.1.2-rc.1` exposes only `model` and `reasoning_effort` through `session/set_config_option`.
**Provisional default:** reject a configured `assistants.deepseek.maxTokens` with subtype `deepseek_unsupported_config`, omit it from `DeepseekProviderDefaults` and user examples, and do not invent `configId: 'max_tokens'`, a patch overlay, or a private environment variable.
A maintainer may replace this default only with a released DSH ACP contract and corresponding tests.

2. **How should a standalone compiled Archon binary provide a spawnable Node dependency tree for bundled DSH?**
`bun build --compile` can bundle dynamically imported ACP code into the Archon executable, but Node cannot execute the DSH package graph from Bun's embedded filesystem.
**Provisional default:** support source/npm installs where `createRequire(import.meta.url).resolve('@deepseek-ai/dsh/lib/bin.js')` returns an on-disk tree, and fail before spawn in `BUNDLED_IS_BINARY` mode with subtype `deepseek_runtime_unavailable` and an actionable source-install message.
Do not silently use a global `dsh`, extract hundreds of unaudited files at runtime, or add a Node sidecar.
A separately reviewed packaging design is required before claiming standalone-binary support.

## Task 0: Establish the baseline, pin dependencies, and characterize Bun streams

**Files:**

- Modify: `packages/providers/package.json`
- Modify: `bun.lock`
- Create: `packages/providers/src/community/deepseek/ndjson-stream.test.ts`

**Consumes:** The clean branch and the exact dependency versions named by issue #121.

**Produces:** A reproducible dependency graph and an early proof that the chosen in-process transport works under Bun.

### Step 1: Install the existing lockfile and record the focused baseline

Run from the repository root:

```bash
bun install --frozen-lockfile
cd packages/providers
bun run type-check
bun test src/registry.test.ts
```

Expected: all commands pass before DeepSeek changes.
If a baseline command fails, record the exact pre-existing failure before continuing and do not weaken a test.

### Step 2: Add exact production dependencies

Run from the repository root:

```bash
bun --filter @archon/providers add --exact @agentclientprotocol/sdk@1.4.0 @deepseek-ai/dsh@0.1.2-rc.1
```

Verify the resulting `packages/providers/package.json` contains literal versions `1.4.0` and `0.1.2-rc.1`.
Verify the installed package metadata from the provider package:

```bash
cd packages/providers
bun -e "import { readFileSync } from 'node:fs'; const p = new URL('../package.json', import.meta.resolve('@agentclientprotocol/sdk')); console.log(JSON.parse(readFileSync(p, 'utf8')).version)"
bun -e "import { createRequire } from 'node:module'; import { readFileSync } from 'node:fs'; const r = createRequire(import.meta.url); console.log(JSON.parse(readFileSync(r.resolve('@deepseek-ai/dsh/package.json'), 'utf8')).version)"
```

Expected: the commands print `1.4.0` and `0.1.2-rc.1`.

### Step 3: Add the Bun stream characterization test

Create `ndjson-stream.test.ts` with one real loopback test that uses `PassThrough`, `Readable.toWeb`, `Writable.toWeb`, and a dynamic ACP import.
The central test body is:

```ts
const pipe = new PassThrough();
const output = Writable.toWeb(pipe) as WritableStream<Uint8Array>;
const input = Readable.toWeb(pipe) as ReadableStream<Uint8Array>;
const { ndJsonStream } = await import('@agentclientprotocol/sdk');
const stream = ndJsonStream(output, input);
const message = { jsonrpc: '2.0', method: 'test/ping' } as const;
const reader = stream.readable.getReader();
const writer = stream.writable.getWriter();
await writer.write(message);
expect((await reader.read()).value).toEqual(message);
await writer.close();
```

This is a compatibility characterization, so it is allowed to pass immediately without production changes.

### Step 4: Run the characterization test

Run from `packages/providers`:

```bash
bun test src/community/deepseek/ndjson-stream.test.ts
```

Expected: PASS on Bun with the pinned SDK.
If it fails on a supported platform, stop and reopen the architecture decision instead of implementing an unspecified sidecar.

### Step 5: Commit the dependency and characterization slice

```bash
git add packages/providers/package.json bun.lock packages/providers/src/community/deepseek/ndjson-stream.test.ts
git commit -m "chore(providers): pin DeepSeek ACP runtime dependencies"
```

Do not add the already tracked design file to this commit.

## Task 1: Define config, effort translation, and capabilities

**Files:**

- Modify: `packages/providers/src/types.ts`
- Create: `packages/providers/src/community/deepseek/config.ts`
- Create: `packages/providers/src/community/deepseek/config.test.ts`
- Create: `packages/providers/src/community/deepseek/capabilities.ts`

**Consumes:** Provider contract types and the shared effort ladder semantics.

**Produces:** A validated provider-owned config object and the exact registry capabilities.

### Step 1: Write failing config and capability tests

Add table-driven tests for these observable cases:

- `{}` returns `{ profile: 'acp', providerRoute: 'deepseek-official', permissionMode: 'workspace-write' }`.
- Trim `model`, `baseUrl`, `providerRoute`, and `nodeBin`.
- Accept only `http:` and `https:` base URLs.
- Accept only profile `acp` because all other DSH profiles speak a different protocol.
- Accept only `workspace-write` and `danger-full-access` permission modes.
- Translate `minimal -> off`, `medium -> low`, and `xhigh -> high`.
- Preserve `off`, `low`, `high`, and `max`.
- Reject an unknown or blank effort instead of silently omitting it.
- Reject a `providerRoute` without a `model` because DSH's model value is an inseparable `[route, model]` pair.
- Reject any defined `maxTokens` with an error naming the unsupported pinned ACP surface.
- Assert the capability object exactly matches the object below.

The expected capability object is:

```ts
{
  sessionResume: true,
  mcp: true,
  hooks: false,
  skills: false,
  agents: false,
  toolRestrictions: false,
  structuredOutput: 'best-effort',
  envInjection: true,
  costControl: false,
  effortControl: true,
  thinkingControl: false,
  fallbackModel: false,
  sandbox: false,
  settingSources: false,
  nativeTools: false,
  containerExec: false,
  askHuman: false,
}
```

Run from `packages/providers`:

```bash
bun test src/community/deepseek/config.test.ts
```

Expected: FAIL because the modules and contract type do not exist.

### Step 2: Add the canonical config type

Insert this contract beside the other community-provider defaults in `packages/providers/src/types.ts`:

```ts
export interface DeepseekProviderDefaults {
  [key: string]: unknown;
  model?: string;
  baseUrl?: string;
  providerRoute?: string;
  profile?: 'acp';
  permissionMode?: 'workspace-write' | 'danger-full-access';
  effort?: string;
  nodeBin?: string;
}
```

Do not add `maxTokens` until the open question has a supported transport.

### Step 3: Implement the parser and effort translation

Export these exact values and functions from `config.ts`:

```ts
export const DEFAULT_DEEPSEEK_PROFILE = 'acp' as const;
export const DEFAULT_DEEPSEEK_PROVIDER_ROUTE = 'deepseek-official';
export const DEFAULT_DEEPSEEK_PERMISSION_MODE = 'workspace-write' as const;

export function parseDeepseekConfig(raw: Record<string, unknown>): DeepseekProviderDefaults;

export function resolveDeepseekEffort(value: unknown): 'off' | 'low' | 'high' | 'max' | undefined;
```

Parse defaults into the returned object so callers have one source of truth.
Use a `switch` for effort mapping and throw an actionable config error in the default branch.
Check `raw.maxTokens !== undefined` before building the result and throw `DeepseekProviderError` with subtype `deepseek_unsupported_config` after Task 2 introduces that class.
Until Task 2 exists, make the red-green slice throw a plain `Error` with the exact same message, then replace only the error type in Task 2.

### Step 4: Add the capability constant

Use a structural compile-time check:

```ts
export const DEEPSEEK_CAPABILITIES = {
  sessionResume: true,
  mcp: true,
  hooks: false,
  skills: false,
  agents: false,
  toolRestrictions: false,
  structuredOutput: 'best-effort',
  envInjection: true,
  costControl: false,
  effortControl: true,
  thinkingControl: false,
  fallbackModel: false,
  sandbox: false,
  settingSources: false,
  nativeTools: false,
  containerExec: false,
  askHuman: false,
} as const satisfies ProviderCapabilities;
```

Do not add `knownToolNames` because `toolRestrictions` is false.

### Step 5: Run the focused tests and type-check

Run from `packages/providers`:

```bash
bun test src/community/deepseek/config.test.ts
bun run type-check
```

Expected: PASS.

### Step 6: Commit the contract slice

```bash
git add packages/providers/src/types.ts packages/providers/src/community/deepseek/config.ts packages/providers/src/community/deepseek/config.test.ts packages/providers/src/community/deepseek/capabilities.ts
git commit -m "feat(providers): define DeepSeek config and capabilities"
```

## Task 2: Add fail-safe environment, permission, runtime resolution, and typed errors

**Files:**

- Create: `packages/providers/src/community/deepseek/env.ts`
- Create: `packages/providers/src/community/deepseek/env.test.ts`
- Create: `packages/providers/src/community/deepseek/permission.ts`
- Create: `packages/providers/src/community/deepseek/permission.test.ts`
- Create: `packages/providers/src/community/deepseek/errors.ts`
- Create: `packages/providers/src/community/deepseek/errors.test.ts`
- Create: `packages/providers/src/community/deepseek/node-resolver.ts`
- Create: `packages/providers/src/community/deepseek/node-resolver.test.ts`
- Modify: `packages/providers/src/community/deepseek/config.ts`

**Consumes:** Parsed config, `BUNDLED_IS_BINARY`, process environment, and ACP permission response types.

**Produces:** Tested preflight values that are safe to hand to the ACP process layer.

### Step 1: Write failing tests

Use isolated input records instead of mutating global `process.env`.
Cover all of these cases:

- Request `DEEPSEEK_API_KEY` beats ambient `DEEPSEEK_API_KEY`.
- Config `baseUrl` beats request and ambient `DEEPSEEK_BASE_URL`.
- Request `DEEPSEEK_BASE_URL` beats ambient when config omits it.
- Missing API key throws subtype `deepseek_missing_api_key` before spawn.
- Default permission writes `DSH_PERMISSION_MODE=workspace-write`.
- Explicit dangerous mode writes `DSH_PERMISSION_MODE=danger-full-access`.
- No environment construction writes `DSH_PROVIDER_ROUTE`.
- Permission response is exactly `{ outcome: { outcome: 'cancelled' } }` for every request.
- Error conversion preserves a known subtype and maps unknown errors to `deepseek_acp_error`.
- Error conversion replaces every occurrence of the actual API key with `[REDACTED]`.
- `DEEPSEEK_NODE_BIN` beats config, config beats the host Node executable, the host Node executable beats PATH, and PATH is used only when the host is Bun.
- A nonexistent or non-executable explicit Node path fails with its source label.
- Windows accepts a regular `.exe` or `.cmd` file without a POSIX execute-bit check.
- Source mode resolves an entry ending in `@deepseek-ai/dsh/lib/bin.js`.
- Binary mode throws subtype `deepseek_runtime_unavailable` before attempting package resolution.

Run from `packages/providers`:

```bash
bun test src/community/deepseek/env.test.ts
bun test src/community/deepseek/permission.test.ts
bun test src/community/deepseek/errors.test.ts
bun test src/community/deepseek/node-resolver.test.ts
```

Expected: FAIL because the modules do not exist.

### Step 2: Implement typed errors and redaction

Use one owned error type at deterministic boundaries:

```ts
export type DeepseekErrorSubtype =
  | 'deepseek_missing_api_key'
  | 'deepseek_unsupported_config'
  | 'deepseek_runtime_unavailable'
  | 'deepseek_spawn_failed'
  | 'deepseek_resume_failed'
  | 'deepseek_mcp_config_error'
  | 'deepseek_protocol_error'
  | 'deepseek_aborted'
  | 'deepseek_acp_error';

export class DeepseekProviderError extends Error {
  readonly name = 'DeepseekProviderError';
  constructor(readonly subtype: DeepseekErrorSubtype, message: string, options?: ErrorOptions) {
    super(message, options);
  }
}
```

Export `redactDeepseekSecrets(message, secrets)` and `toDeepseekErrorResult(error, secrets)`.
The result must be `{ type: 'result', isError: true, errorSubtype, errors: [sanitizedMessage] }` and must not synthesize tokens, usage, cost, or session ids.
Wrap known phases with `DeepseekProviderError` instead of classifying control flow by arbitrary prose.

### Step 3: Implement environment construction

Use this input contract:

```ts
export interface DeepseekChildEnvInput {
  ambient: Record<string, string | undefined>;
  request?: Record<string, string>;
  baseUrl?: string;
  permissionMode: 'workspace-write' | 'danger-full-access';
}

export function buildDeepseekChildEnv(input: DeepseekChildEnvInput): Record<string, string>;
```

Filter `undefined` ambient entries, overlay request entries, overlay config `baseUrl`, then set `DSH_PERMISSION_MODE`.
Validate the final `DEEPSEEK_API_KEY` is a non-empty string without trimming or logging its value.

### Step 4: Implement the permission response

Export a zero-state function with an ACP type-only import:

```ts
export function answerDeepseekPermissionRequest(): RequestPermissionResponse {
  return { outcome: { outcome: 'cancelled' } };
}
```

Do not branch on permission options and do not return a selected option id.

### Step 5: Implement Node and DSH resolution

Expose injectable facts so tests do not mock global modules:

```ts
export interface DeepseekRuntimeFacts {
  isBinary: boolean;
  execPath: string;
  isNodeHost: boolean;
  platform: NodeJS.Platform;
  findNodeOnPath: (
    env: Record<string, string | undefined>,
    platform: NodeJS.Platform
  ) => string | undefined;
}

export function resolveDeepseekNodeBinary(
  configNodeBin: string | undefined,
  env?: Record<string, string | undefined>,
  facts?: DeepseekRuntimeFacts
): string;

export function resolveBundledDshEntrypoint(isBinary?: boolean): string;
```

Default `isBinary` to `BUNDLED_IS_BINARY`.
Use precedence `DEEPSEEK_NODE_BIN`, config `nodeBin`, Node-host `process.execPath`, then `which node` or `where node` under the supplied environment.
Put PATH lookup behind `facts.findNodeOnPath` so unit tests can drive both POSIX and Windows behavior without changing `process.platform` or starting a shell.
On POSIX, require a regular file with `X_OK`.
On Windows, require a regular file and do not apply `X_OK`.
In source mode, resolve `@deepseek-ai/dsh/lib/bin.js` with `createRequire(import.meta.url).resolve()` and require a regular file.
In binary mode, throw the provisional actionable error before `createRequire()`.

### Step 6: Replace the provisional config error type

Change the Task 1 `maxTokens` rejection to `DeepseekProviderError('deepseek_unsupported_config', ...)`.

### Step 7: Run the focused tests and type-check

Run from `packages/providers`:

```bash
bun test src/community/deepseek/env.test.ts
bun test src/community/deepseek/permission.test.ts
bun test src/community/deepseek/errors.test.ts
bun test src/community/deepseek/node-resolver.test.ts
bun test src/community/deepseek/config.test.ts
bun run type-check
```

Expected: PASS.

### Step 8: Commit the preflight slice

```bash
git add packages/providers/src/community/deepseek/env.ts packages/providers/src/community/deepseek/env.test.ts packages/providers/src/community/deepseek/permission.ts packages/providers/src/community/deepseek/permission.test.ts packages/providers/src/community/deepseek/errors.ts packages/providers/src/community/deepseek/errors.test.ts packages/providers/src/community/deepseek/node-resolver.ts packages/providers/src/community/deepseek/node-resolver.test.ts packages/providers/src/community/deepseek/config.ts
git commit -m "feat(providers): add DeepSeek runtime preflight"
```

## Task 3: Translate ACP updates without inventing data

**Files:**

- Create: `packages/providers/src/community/deepseek/event-bridge.ts`
- Create: `packages/providers/src/community/deepseek/event-bridge.test.ts`

**Consumes:** ACP `SessionUpdate` and Archon `MessageChunk` types.

**Produces:** A stateful, deterministic event translator used by the ACP lifecycle.

### Step 1: Write failing typed fixture tests

Construct fixtures with `satisfies SessionUpdate` and assert literal chunk arrays.
Cover these cases:

- `agent_message_chunk` text maps to one `assistant` chunk.
- `agent_thought_chunk` text maps to one `thinking` chunk.
- Non-text message content is ignored rather than stringified as assistant prose.
- `tool_call` emits a `tool` chunk with `name ?? title`, the stable `toolCallId`, and object `rawInput`.
- Non-object `rawInput` is preserved as `{ rawInput: value }` rather than discarded.
- An in-progress `tool_call_update` changes stored name/input but emits no terminal result.
- A completed update with no name uses the name stored from the matching start.
- A pinned-DSH-shaped completed update with `content: [{ type: 'content', content: { type: 'text', text: 'ok' } }]` and no `rawOutput` emits output `ok`.
- A structured `rawOutput` is serialized with `JSON.stringify` and takes precedence over display content.
- `completed` maps to `toolOutcome: 'success'` and `failed` maps to `toolOutcome: 'error'`.
- A terminal update deletes stored tool state so a reused id cannot inherit stale data.
- `usage_update`, plans, modes, config updates, session info, compaction, and user-message updates emit no chunks.

Run from `packages/providers`:

```bash
bun test src/community/deepseek/event-bridge.test.ts
```

Expected: FAIL because the translator does not exist.

### Step 2: Implement the translator

Use this public surface:

```ts
export interface DeepseekEventState {
  readonly tools: Map<string, { name: string; input?: Record<string, unknown> }>;
}

export function createDeepseekEventState(): DeepseekEventState;

export function mapDeepseekSessionUpdate(
  update: SessionUpdate,
  state: DeepseekEventState
): MessageChunk[];
```

Use an exhaustive `switch (update.sessionUpdate)` and a `never` assertion so a future ACP variant is a compile-time decision.
Flatten tool content by returning text from `type: 'content'` text blocks and JSON-stringifying non-text content, diff blocks, and terminal blocks.
Never derive success or failure from output text.
Never map `usage_update`, even if the ACP SDK type has optional cost fields, because the pinned server contract does not expose per-request billing.

### Step 3: Run tests and type-check

Run from `packages/providers`:

```bash
bun test src/community/deepseek/event-bridge.test.ts
bun run type-check
```

Expected: PASS.

### Step 4: Commit the event slice

```bash
git add packages/providers/src/community/deepseek/event-bridge.ts packages/providers/src/community/deepseek/event-bridge.test.ts
git commit -m "feat(providers): translate DeepSeek ACP events"
```

## Task 4: Validate and translate per-node MCP declarations

**Files:**

- Create: `packages/providers/src/community/deepseek/mcp.ts`
- Create: `packages/providers/src/community/deepseek/mcp.test.ts`

**Consumes:** The existing `loadMcpConfig()` output and the child environment used for command lookup.

**Produces:** ACP `McpServer[]` containing only shapes accepted by pinned DSH.

### Step 1: Write failing tests

Cover these exact input/output behaviors:

- Omitted `type` is stdio.
- Stdio requires a non-empty `command` and accepts only string `args` and string-valued `env`.
- An absolute stdio command remains unchanged.
- A bare command such as `npx` resolves to an absolute executable through supplied PATH using `which` or `where`.
- An unresolved bare command fails with subtype `deepseek_mcp_config_error` and names the server and command.
- Stdio output is `{ name, command: absolutePath, args, env: [{ name, value }] }`.
- HTTP requires an absolute `http:` or `https:` URL and converts headers into `{ name, value }[]`.
- SSE always fails with a message that pinned DSH ACP supports only stdio and Streamable HTTP.
- Unknown transport types, arrays, null, malformed env, malformed headers, and blank server names fail fast.
- Input objects are not mutated.

Run from `packages/providers`:

```bash
bun test src/community/deepseek/mcp.test.ts
```

Expected: FAIL because the module does not exist.

### Step 2: Implement the strict translator

Export:

```ts
export function buildDeepseekMcpServers(
  servers: Record<string, unknown>,
  env: Record<string, string>
): McpServer[];
```

Import `McpServer` as a type only.
Keep validation local and explicit rather than adding a new shared schema for one caller.
Use the same Windows regular-file rule as the Node resolver.
Do not skip unsupported servers with warnings because that would overstate `mcp: true` and silently remove requested tools.

### Step 3: Run tests and type-check

Run from `packages/providers`:

```bash
bun test src/community/deepseek/mcp.test.ts
bun run type-check
```

Expected: PASS.

### Step 4: Commit the MCP slice

```bash
git add packages/providers/src/community/deepseek/mcp.ts packages/providers/src/community/deepseek/mcp.test.ts
git commit -m "feat(providers): translate DeepSeek ACP MCP config"
```

## Task 5: Add the callback-to-generator queue

**Files:**

- Create: `packages/providers/src/community/deepseek/async-queue.ts`
- Create: `packages/providers/src/community/deepseek/async-queue.test.ts`

**Consumes:** Callback-driven ACP notifications.

**Produces:** An SDK-free async iterable with deterministic terminal behavior.

### Step 1: Write failing queue tests

Test that pushed values preserve order, a waiting reader receives the next pushed value, `close()` ends after buffered values, and `fail(error)` rejects only after buffered values are drained.
Test that push, close, and fail after terminal state do not resolve a waiter twice.

Run from `packages/providers`:

```bash
bun test src/community/deepseek/async-queue.test.ts
```

Expected: FAIL because the queue does not exist.

### Step 2: Implement the queue

Use one terminal state and one waiter type without `any`:

```ts
interface QueueWaiter<T> {
  resolve: (result: IteratorResult<T>) => void;
  reject: (error: unknown) => void;
}

export class AsyncQueue<T> implements AsyncIterable<T> {
  push(value: T): void;
  close(): void;
  fail(error: unknown): void;
  [Symbol.asyncIterator](): AsyncIterator<T>;
}
```

Drain buffered values before returning `done: true` or rejecting with the stored failure.
Throw on `push()` after terminal state so lifecycle bugs fail loudly in tests.
Make repeated `close()` and `fail()` idempotent because process teardown can race connection settlement.

### Step 3: Run tests and type-check

Run from `packages/providers`:

```bash
bun test src/community/deepseek/async-queue.test.ts
bun run type-check
```

Expected: PASS.

### Step 4: Commit the queue slice

```bash
git add packages/providers/src/community/deepseek/async-queue.ts packages/providers/src/community/deepseek/async-queue.test.ts
git commit -m "feat(providers): add async queue for ACP streaming"
```

## Task 6: Drive the complete ACP lifecycle and process cleanup

**Files:**

- Create: `packages/providers/src/community/deepseek/acp-client.ts`
- Create: `packages/providers/src/community/deepseek/acp-client.test.ts`

**Consumes:** Resolved process inputs, typed MCP declarations, event translation, permission policy, structured-output helpers, and the async queue.

**Produces:** A streaming turn runner whose only external dependency is an ACP connection target.

### Step 1: Define the test seam and write failing fake-agent tests

Use an in-process `agent({ name: 'fake-dsh' })` from the real pinned ACP SDK rather than mocking JSON-RPC.
The fake registers handlers for initialize, new, resume, set-config-option, prompt, close, and the cancel notification.
The prompt handler sends notifications with `c.client.notify(methods.client.session.update, ...)` before it resolves.

Cover these behaviors in separate tests:

- Order is `initialize`, `session/new`, optional config, `session/prompt`, `session/close`.
- New and resume receive the absolute cwd and the complete `mcpServers` array.
- A fresh turn returns the session id from `session/new`.
- A resumed turn uses the requested session id and never calls new.
- A rejected resume throws `deepseek_resume_failed`, still tears down the connection, and never calls prompt or close for an unopened session.
- A model request sends exactly `{ sessionId, configId: 'model', value: JSON.stringify(['deepseek-official', model]) }`.
- No model config call is made when no model is configured.
- Effort sends exactly `configId: 'reasoning_effort'` with the already translated value.
- A config-option rejection fails the turn; it is never logged and ignored.
- The first `iterator.next()` receives a notification-derived assistant chunk while the fake prompt promise is still pending.
- Tool events preserve their call id and pinned-DSH content output.
- The final result contains `sessionId` and ACP `stopReason` and omits usage fields.
- Structured output augments the outbound prompt and places the parsed object on the result.
- A malformed structured reply leaves `structuredOutput` absent so the executor can re-ask.
- A fake permission request receives `{ outcome: { outcome: 'cancelled' } }`.
- Aborting during prompt sends a cancel notification, closes the session, and ends with local `stopReason: 'aborted'` and subtype `deepseek_aborted`.
- Consumer early return sends cancel for an active session and releases the connection.
- Close rejection is surfaced rather than hidden behind a successful result.
- The production wrapper spawns the exact Node path with `[dshEntrypoint, '--profile', 'acp']`, the requested cwd, and the constructed environment.
- Success, protocol failure, abort, and consumer return all send `SIGTERM` and await the child's exit.
- A child that does not exit within an injected zero-millisecond test grace receives `SIGKILL` without making the test sleep for the production two seconds.
- Spawn error and early child exit surface subtype `deepseek_spawn_failed`, include at most 4096 redacted stderr characters, and never include the key.

Run from `packages/providers`:

```bash
bun test src/community/deepseek/acp-client.test.ts
```

Expected: FAIL because the runner does not exist.

### Step 2: Define the turn input

Use this contract:

```ts
export interface DeepseekAcpTurnInput {
  cwd: string;
  prompt: string;
  resumeSessionId?: string;
  model?: string;
  providerRoute: string;
  effort?: 'off' | 'low' | 'high' | 'max';
  mcpServers: McpServer[];
  outputSchema?: Record<string, unknown>;
  abortSignal?: AbortSignal;
}

export function driveDeepseekAcpTurn(
  target: Stream | AgentApp,
  input: DeepseekAcpTurnInput
): AsyncGenerator<MessageChunk>;
```

Keep `target` injectable so tests use `AgentApp` and production uses an stdio `Stream`.
The overload cast needed to pass the union into `connectWith()` is permitted only with a comment explaining that the SDK exposes both overloads and runtime dispatch accepts both validated members.

### Step 3: Implement the client app and streaming operation

Build one `AsyncQueue<MessageChunk>` and one event state before connecting.
Register these handlers before `connectWith()`:

```ts
client({ name: 'archon-deepseek' })
  .onRequest(methods.client.session.requestPermission, () => answerDeepseekPermissionRequest())
  .onNotification(methods.client.session.update, ({ params }) => {
    if (params.sessionId !== activeSessionId) return;
    for (const chunk of mapDeepseekSessionUpdate(params.update, eventState)) {
      if (chunk.type === 'assistant') transcript += chunk.content;
      queue.push(chunk);
    }
  });
```

Inside `connectWith()`, perform these operations in order:

1. Request initialize with `PROTOCOL_VERSION` and empty `clientCapabilities`.
2. Require the returned protocol version to equal `PROTOCOL_VERSION`.
3. Require `agentCapabilities.sessionCapabilities.resume` and `.close` because the provider advertises both.
4. Require `agentCapabilities.mcpCapabilities.http` when any HTTP MCP declaration is present.
5. Call resume with `{ sessionId, cwd, mcpServers }` or new with `{ cwd, mcpServers }`.
6. Assign `activeSessionId` before any config or prompt request.
7. Set model only when `input.model` exists.
8. Set reasoning effort only when `input.effort` exists.
9. Attach the abort listener and send cancel with `ctx.notify()` if it fires.
10. Build the outbound text with `augmentPromptForJsonSchema(input.prompt, input.outputSchema)` only when a schema exists.
11. Skip prompt if the signal won the race after session setup; otherwise request prompt with one text block containing the outbound text.
12. Remove the abort listener.
13. Request close for the active session.
14. Parse the accumulated assistant transcript with `tryParseStructuredOutput()` only when a schema exists.
15. Push either the normal result with the parsed value when present or the local aborted result only after close succeeds.

Start the `connectWith()` promise without awaiting it, pipe its success to `queue.close()`, and pipe its failure to `queue.fail(error)`.
Then `for await` the queue so notification chunks are observable before prompt settlement.
In the generator's `finally`, cancel an active unfinished session and await connection settlement so `.return()` cannot leak a live turn.
Wrap resume request failures immediately as `deepseek_resume_failed` and other protocol negotiation, config, prompt, or close failures as `deepseek_protocol_error` while retaining the original error as `cause`.

### Step 4: Add the production stdio wrapper

Export a second function:

```ts
export interface DeepseekProcessInput extends DeepseekAcpTurnInput {
  nodeBin: string;
  dshEntrypoint: string;
  profile: 'acp';
  env: Record<string, string>;
}

export interface DeepseekProcessDependencies {
  spawn?: typeof spawn;
  terminateGraceMs?: number;
}

export function runDeepseekAcpTurn(
  input: DeepseekProcessInput,
  dependencies?: DeepseekProcessDependencies
): AsyncGenerator<MessageChunk>;
```

Spawn with `spawn(input.nodeBin, [input.dshEntrypoint, '--profile', input.profile], { cwd: input.cwd, env: input.env, stdio: ['pipe', 'pipe', 'pipe'] })`.
Convert `child.stdin` with `Writable.toWeb()` and `child.stdout` with `Readable.toWeb()`, then pass them to `ndJsonStream()` in output-first order.
Drain stderr continuously into a capped buffer so the child cannot block on a full pipe.
Do not log stderr.
On failure, append at most 4096 redacted stderr characters to the owned error message.
In `finally`, send `SIGTERM`, wait at most two seconds for exit, send `SIGKILL` only if still running, and await the exit event so no zombie remains.
Default `terminateGraceMs` to 2000 and inject `0` in the escalation test.
Wrap spawn and early-exit failures with subtype `deepseek_spawn_failed`.

### Step 5: Run the focused tests and type-check

Run from `packages/providers`:

```bash
bun test src/community/deepseek/acp-client.test.ts
bun run type-check
```

Expected: PASS.

### Step 6: Commit the ACP lifecycle slice

```bash
git add packages/providers/src/community/deepseek/acp-client.ts packages/providers/src/community/deepseek/acp-client.test.ts
git commit -m "feat(providers): drive DeepSeek Harness over ACP"
```

## Task 7: Implement the provider boundary with error-as-result behavior

**Files:**

- Create: `packages/providers/src/community/deepseek/provider.ts`
- Create: `packages/providers/src/community/deepseek/provider.test.ts`

**Consumes:** Every tested helper from Tasks 1 through 6 and `IAgentProvider`.

**Produces:** The `DeepseekProvider` class used by registration.

### Step 1: Write failing provider tests through injected dependencies

Define a typed dependency seam for runtime resolution and the turn runner so these tests do not spawn DSH.
Cover these cases:

- `getType()` is `deepseek` and `getCapabilities()` returns the shared constant.
- A pre-aborted signal yields one `deepseek_aborted` result and does not parse config, resolve runtime, load MCP, or invoke the runner.
- A missing API key yields one `deepseek_missing_api_key` result and does not resolve or spawn.
- `options.model` beats assistant config model.
- `nodeConfig.effort` beats assistant config effort and is translated before the runner.
- The child environment proves request credential and config base-URL precedence.
- MCP loading receives `{ ...process.env, ...requestOptions.env }`, and duplicate missing variable names yield one visible system warning.
- MCP translator errors yield `deepseek_mcp_config_error` and do not run a turn.
- Fresh success does not add a `resumed` property.
- Resume success stamps `resumed: true` through `withResumedOutcome`.
- Resume failure yields exactly one terminal `deepseek_resume_failed` result and never retries without the session id.
- Unknown runner failure yields exactly one redacted `deepseek_acp_error` result.
- Assistant and tool chunks remain in original order.
- Result chunks never gain `tokens`, `usageBreakdown`, or synthesized cost.

Run from `packages/providers`:

```bash
bun test src/community/deepseek/provider.test.ts
```

Expected: FAIL because the provider does not exist.

### Step 2: Implement a lazy default runner

Use this seam:

```ts
export type DeepseekTurnRunner = (
  input: DeepseekProcessInput
) => AsyncGenerator<MessageChunk>;

export interface DeepseekProviderDependencies {
  runTurn?: DeepseekTurnRunner;
  resolveNodeBinary?: typeof resolveDeepseekNodeBinary;
  resolveDshEntrypoint?: typeof resolveBundledDshEntrypoint;
}
```

The constructor stores injected overrides only.
When no runner is injected, `sendQuery()` must execute `const { runDeepseekAcpTurn } = await import('./acp-client')` after all synchronous preflight checks.
Do not statically import `acp-client.ts` from `provider.ts`.

### Step 3: Implement `sendQuery()` in one outer try/catch

Perform these actions in order:

1. Return the local aborted result when `abortSignal.aborted` is already true.
2. Parse `requestOptions.assistantConfig ?? {}`.
3. Build the child environment and fail before runtime resolution when the key is missing.
4. Resolve Node and DSH paths.
5. Load MCP only when `requestOptions.nodeConfig?.mcp` exists, passing the merged ambient/request environment as the third argument.
6. Convert MCP declarations strictly and collect one deduplicated missing-variable warning.
7. Choose model as `requestOptions.model ?? config.model`.
8. Choose effort as `requestOptions.nodeConfig?.effort ?? config.effort` and translate it.
9. Choose `outputSchema` only from `requestOptions.outputFormat?.schema`.
10. Dynamically resolve the default runner.
11. Yield warnings before the runner stream.
12. Wrap the runner with `withResumedOutcome(stream, resumedOutcome(resumeSessionId, true))`.
13. Yield the wrapped stream unchanged.
14. Catch every thrown value, convert it with the actual resolved key as a redaction secret when available, yield one error result, and return.

The class signatures are:

```ts
export class DeepseekProvider implements IAgentProvider {
  getType(): string;
  getCapabilities(): ProviderCapabilities;
  sendQuery(
    prompt: string,
    cwd: string,
    resumeSessionId?: string,
    requestOptions?: SendQueryOptions
  ): AsyncGenerator<MessageChunk>;
}
```

Do not log the raw caught value.
Do not create a fresh session after any failure.

### Step 4: Run tests and type-check

Run from `packages/providers`:

```bash
bun test src/community/deepseek/provider.test.ts
bun run type-check
```

Expected: PASS.

### Step 5: Commit the provider slice

```bash
git add packages/providers/src/community/deepseek/provider.ts packages/providers/src/community/deepseek/provider.test.ts
git commit -m "feat(providers): implement DeepSeek provider boundary"
```

## Task 8: Register, export, and prove lazy loading and workflow selection

**Files:**

- Create: `packages/providers/src/community/deepseek/registration.ts`
- Create: `packages/providers/src/community/deepseek/index.ts`
- Create: `packages/providers/src/community/deepseek/provider-lazy-load.test.ts`
- Modify: `packages/providers/src/registry.ts`
- Modify: `packages/providers/src/registry.test.ts`
- Modify: `packages/providers/src/index.ts`
- Modify: `packages/providers/package.json`
- Modify: `packages/workflows/src/loader.test.ts`

**Consumes:** A complete lazy provider implementation and the existing Phase-2 registry seam.

**Produces:** Application-visible registration without new entrypoint or config-loader edits.

### Step 1: Write failing registry assertions

Extend the community aggregator test to assert `deepseek` exists after one call and has count one after a second call.
Add one provider-specific test that expects:

```ts
expect(getRegistration('deepseek')).toMatchObject({
  id: 'deepseek',
  displayName: 'DeepSeek Harness (community)',
  builtIn: false,
  credentials: {
    kind: 'static',
    specs: [{ vendor: 'deepseek', displayName: 'DeepSeek', kinds: ['api_key'] }],
  },
});
expect(getProviderCapabilities('deepseek')).toEqual(DEEPSEEK_CAPABILITIES);
```

Run from `packages/providers`:

```bash
bun test src/registry.test.ts
```

Expected: FAIL because the provider is not registered.

### Step 2: Write the failing lazy-load regression test in an isolated process

Mock only `@agentclientprotocol/sdk` with a factory counter before importing the registration module.
Do not mock `@deepseek-ai/dsh` because production never imports it as a module.
Assert importing registration, registering the provider, and instantiating it leave the ACP SDK factory count at zero.
Keep this test in its own `bun test` invocation because `mock.module()` pollutes Bun's process-wide module cache.

Run from `packages/providers`:

```bash
bun test src/community/deepseek/provider-lazy-load.test.ts
```

Expected: FAIL because the registration module does not exist.

### Step 3: Add registration and barrels

Implement `registerDeepseekProvider(): void` with the same idempotent `isRegisteredProvider()` guard as other community registrations.
Add one import and one call in `registerCommunityProviders()` before the environment-gated fake provider.
Export `DeepseekProvider`, `parseDeepseekConfig`, `registerDeepseekProvider`, `DEEPSEEK_CAPABILITIES`, and `DeepseekProviderDefaults` from the community index and root index.
Add `"./community/deepseek": "./src/community/deepseek/index.ts"` to package exports.
Run the registry and lazy-load tests again and expect both to pass.

### Step 4: Prove workflow selection at the package boundary

In `packages/workflows/src/loader.test.ts`, import `registerDeepseekProvider` beside the existing registry bootstrap.
Add a focused test that registers DeepSeek, parses this YAML through `parseWorkflowYaml()`, and asserts both the workflow and node resolve provider `deepseek`:

```yaml
name: deepseek-provider
description: DeepSeek provider selection
provider: deepseek
nodes:
  - id: run
    provider: deepseek
    prompt: hello
```

Restore the normal `registerBuiltinProviders()` plus `registerOmpProvider()` test state in `finally` after clearing the registry.
This test changes no workflow production code.

Run from `packages/workflows`:

```bash
bun test src/loader.test.ts
```

Expected: PASS.

### Step 5: Add all DeepSeek test invocations to the provider package script

Add each ordinary DeepSeek test file as its own explicit invocation in `packages/providers/package.json`.
Place `provider-lazy-load.test.ts` in its own final DeepSeek invocation so its mock cannot affect any following DeepSeek test.
Keep the existing package-level process splits intact.

The DeepSeek portion must include:

```text
config.test.ts
node-resolver.test.ts
env.test.ts
permission.test.ts
errors.test.ts
event-bridge.test.ts
mcp.test.ts
async-queue.test.ts
acp-client.test.ts
provider.test.ts
ndjson-stream.test.ts
provider-lazy-load.test.ts
```

### Step 6: Run registry, lazy-load, workflow, and package checks

Run from `packages/providers`:

```bash
bun test src/registry.test.ts
bun test src/community/deepseek/provider-lazy-load.test.ts
bun run test
bun run type-check
```

Run from `packages/workflows`:

```bash
bun test src/loader.test.ts
bun run type-check
```

Expected: PASS.

### Step 7: Commit the integration slice

```bash
git add packages/providers/src/community/deepseek/registration.ts packages/providers/src/community/deepseek/index.ts packages/providers/src/community/deepseek/provider-lazy-load.test.ts packages/providers/src/registry.ts packages/providers/src/registry.test.ts packages/providers/src/index.ts packages/providers/package.json packages/workflows/src/loader.test.ts
git commit -m "feat(providers): register DeepSeek community provider"
```

## Task 9: Add operator documentation and regenerate the capability matrix

**Files:**

- Modify: `scripts/generate-capability-matrix.ts`
- Modify: `packages/docs-web/src/content/docs/getting-started/ai-assistants.md`
- Modify: `packages/docs-web/src/content/docs/reference/configuration.md`
- Modify: `packages/docs-web/src/content/docs/guides/mcp-servers.md`
- Regenerate: `packages/docs-web/src/content/docs/reference/provider-capabilities.md`

**Consumes:** Final registration and capabilities.

**Produces:** Accurate setup documentation and generated provider metadata.

### Step 1: Add the generated-matrix caveat

Add this entry to `CAVEATS` in `scripts/generate-capability-matrix.ts`:

```ts
{
  provider: 'deepseek',
  key: 'mcp',
  note:
    'Pinned DeepSeek Harness ACP supports stdio and Streamable HTTP MCP servers; ' +
    'SSE declarations fail fast instead of being ignored.',
},
```

### Step 2: Update the AI assistants guide

Add DeepSeek Harness to the frontmatter description and to the best-effort structured-output row.
Add a `## DeepSeek Harness (Community Provider)` section before the shared credentials/settings sections.
The section must state all of these facts:

- The provider id is `deepseek` and the operator supplies a DashScope token as vendor `deepseek` or `DEEPSEEK_API_KEY`.
- `assistants.deepseek.baseUrl` overrides request and ambient `DEEPSEEK_BASE_URL`.
- Supported keys are `model`, `baseUrl`, `providerRoute`, `profile`, `permissionMode`, `effort`, and `nodeBin`.
- `providerRoute` defaults to `deepseek-official`, profile is fixed to `acp`, and permission defaults to `workspace-write` with permission requests rejected.
- `danger-full-access` is explicit and removes the safe permission posture.
- A configured model is sent as the exact DSH model option pair `[providerRoute, model]`.
- No built-in tier defaults are provided because model IDs vary by DashScope account and region.
- Do not present `deepseek-v3` as a confirmed model id; tell operators to use a model advertised by their pinned DSH/DashScope setup.
- `maxTokens` is rejected under the provisional default because pinned DSH ACP has no corresponding option.
- Source/npm installs use the bundled version-matched DSH package, while standalone compiled binaries fail with the documented runtime-unavailable message under the provisional default.
- The runtime requires a real Node executable resolved by `DEEPSEEK_NODE_BIN`, `nodeBin`, Node-host `process.execPath`, or PATH.
- Results omit token and cost usage in v1.
- The Web config API exposes no DeepSeek fields because issue #121 forbids a `SAFE_ASSISTANT_FIELDS` edit, so operators set these values in `~/.archon/config.yaml` or `.archon/config.yaml`.

Use an example without an invented model value:

```yaml
assistants:
  deepseek:
    baseUrl: https://dashscope-intl.aliyuncs.com/compatible-mode/v1
    providerRoute: deepseek-official
    profile: acp
    permissionMode: workspace-write
    effort: high
```

Tell the reader to add `model` only after confirming the exact account/region id.
Add `| DeepSeek | Not reported in v1; pinned DSH ACP exposes context occupancy but not per-request billing tokens. |` to the workflow-usage table.

### Step 3: Update the configuration reference

Add `deepseek` to the `defaultAssistant` comment.
Add a provider section with rows for `DEEPSEEK_API_KEY`, `DEEPSEEK_BASE_URL`, and `DEEPSEEK_NODE_BIN`.
Document the same config keys and precedence as the implementation.
Do not add `DSH_PROVIDER_ROUTE` or `maxTokens` to a supported-key list.

### Step 4: Update the MCP guide

Add DeepSeek to the supported-provider introduction.
State that DeepSeek expands MCP environment and header values from ambient plus acting-user/codebase env.
State that DeepSeek resolves bare stdio commands through PATH, supports stdio and HTTP, and rejects SSE before starting the turn.
Do not imply `allowed_tools` can create an MCP-only boundary for DeepSeek because `toolRestrictions` is false.

### Step 5: Regenerate and verify the matrix

Run from the repository root:

```bash
bun run generate:capability-matrix
bun run check:capability-matrix
bun --filter @archon/docs-web type-check
```

Expected: the generated page lists `deepseek` as a community provider with session resume, MCP, environment injection, and effort control enabled; structured output is best-effort; all other axes including AskHuman are off; and the MCP cell carries the caveat.

### Step 6: Commit the documentation slice

```bash
git add scripts/generate-capability-matrix.ts packages/docs-web/src/content/docs/getting-started/ai-assistants.md packages/docs-web/src/content/docs/reference/configuration.md packages/docs-web/src/content/docs/guides/mcp-servers.md packages/docs-web/src/content/docs/reference/provider-capabilities.md
git commit -m "docs(providers): document DeepSeek Harness provider"
```

## Task 10: Add the explicit opt-in live spike

**Files:**

- Create: `packages/providers/src/community/deepseek/acp-handshake-spike.ts`
- Modify: `packages/providers/package.json`

**Consumes:** The production provider and real operator credentials.

**Produces:** A repeatable manual proof of DSH/DashScope interoperability without entering the default test suite.

### Step 1: Implement the gated spike

The script must skip with exit code zero unless `DEEPSEEK_LIVE_TEST=1`.
When enabled, it must require `DEEPSEEK_API_KEY`, `DEEPSEEK_BASE_URL`, and `DEEPSEEK_LIVE_MODEL` without printing their values.
Instantiate `DeepseekProvider`, send the prompt `Reply with exactly pong.` with the configured base URL and model, consume the complete stream, and require one non-error result with a non-empty session id.
Then send `Reply with exactly pong again.` using that session id and require a non-error result with `resumed: true`.
Print only `DeepSeek ACP live spike passed` after both turns.
Never print chunks, request environments, stderr, keys, URLs, or model ids.

### Step 2: Add the non-default script

Add:

```json
"spike:deepseek:acp": "bun src/community/deepseek/acp-handshake-spike.ts"
```

Do not add the spike to `test` or `validate` because it performs a billed network request.

### Step 3: Run the safe skip path

Run from `packages/providers` with the opt-in variable absent:

```bash
bun run spike:deepseek:acp
```

Expected: a concise skipped message and exit code zero.

Run the live path only when the operator explicitly provides authorization and credentials:

```bash
DEEPSEEK_LIVE_TEST=1 bun run spike:deepseek:acp
```

Expected: `DeepSeek ACP live spike passed` and no secret material in output.
If the live path cannot be authorized, record it as not run rather than claiming it passed.

### Step 4: Commit the spike

```bash
git add packages/providers/src/community/deepseek/acp-handshake-spike.ts packages/providers/package.json
git commit -m "test(providers): add DeepSeek ACP live spike"
```

## Task 11: Run final validation and audit the implementation

**Files:**

- Verify all files listed in this plan.

**Consumes:** The complete implementation and documentation.

**Produces:** Evidence that the change satisfies package and repository gates.

### Step 1: Run all DeepSeek-focused tests

Run from `packages/providers`:

```bash
bun test src/community/deepseek/config.test.ts
bun test src/community/deepseek/node-resolver.test.ts
bun test src/community/deepseek/env.test.ts
bun test src/community/deepseek/permission.test.ts
bun test src/community/deepseek/errors.test.ts
bun test src/community/deepseek/event-bridge.test.ts
bun test src/community/deepseek/mcp.test.ts
bun test src/community/deepseek/async-queue.test.ts
bun test src/community/deepseek/acp-client.test.ts
bun test src/community/deepseek/provider.test.ts
bun test src/community/deepseek/ndjson-stream.test.ts
bun test src/community/deepseek/provider-lazy-load.test.ts
bun test src/registry.test.ts
```

Expected: PASS.

### Step 2: Run affected package checks

Run from `packages/providers`:

```bash
bun run test
bun run type-check
```

Run from `packages/workflows`:

```bash
bun test src/loader.test.ts
bun run type-check
```

Expected: PASS.

### Step 3: Run generated-file and repository validation

Run from the repository root:

```bash
bun run check:capability-matrix
bun run validate
```

Expected: PASS with zero lint warnings and no generated-file drift.

### Step 4: Audit forbidden and required patterns

Run from the repository root:

```bash
rg -n "DSH_PROVIDER_ROUTE|max_tokens|deepseek-v3" packages/providers/src/community/deepseek packages/docs-web/src/content/docs --glob '!*.test.ts'
rg -n "from '@agentclientprotocol/sdk'|import\('@agentclientprotocol/sdk'\)" packages/providers/src/community/deepseek
rg -n "session\.cancel|methods\.agent\.session\.cancel" packages/providers/src/community/deepseek --glob '!*.test.ts'
rg -n "tokens|usageBreakdown|usage_update" packages/providers/src/community/deepseek
```

Expected: the first command returns no runtime-code or user-documentation matches.
Expected: production ACP value imports are confined to `acp-client.ts`, which is dynamically imported by the provider; all other production imports are type-only, and tests may import SDK values directly.
Expected: cancel is sent only through `notify()` in production.
Expected: usage appears only in tests or comments asserting omission and never populates a result.

### Step 5: Inspect the final diff

```bash
git status --short
git diff --check
git diff --stat dev...HEAD
git diff dev...HEAD -- packages/providers packages/workflows/src/loader.test.ts scripts/generate-capability-matrix.ts packages/docs-web/src/content/docs
```

Expected: no unrelated code, schema, config-loader, credential-delivery, auth, generated API, or database changes.

### Step 6: Create a final validation commit only if validation produced tracked changes

```bash
git add packages/providers/package.json bun.lock packages/docs-web/src/content/docs/reference/provider-capabilities.md
git commit -m "chore(providers): finalize DeepSeek validation"
```

Skip this commit when the working tree is already clean.

## Acceptance criteria

- `registerCommunityProviders()` makes `deepseek` available exactly once with `builtIn: false` and vendor credential `deepseek`.
- A workflow declaring `provider: deepseek` passes loader validation without workflow production changes.
- Registry import and provider instantiation do not evaluate ACP SDK values.
- Source/npm mode starts the exact pinned DSH entry point under a validated Node executable with `--profile acp`.
- Standalone-binary mode fails before spawn with the provisional actionable runtime error and never falls back to a global DSH install.
- Acting-user `DEEPSEEK_API_KEY` beats ambient credentials and config `baseUrl` beats request or ambient base URLs.
- No emitted or logged error contains the resolved API key.
- Default permission behavior is workspace-write plus deterministic cancellation of every permission prompt.
- Full access occurs only when `permissionMode: danger-full-access` is explicit.
- Fresh turns call new; resumed turns call resume; resume failure never calls new.
- Assistant, thinking, tool, and tool-result chunks arrive before the terminal result and preserve tool call ids.
- A DSH tool result carried only in ACP `content` remains visible.
- Abort uses the ACP cancel notification, closes the session, reaps the process, and reports local stop reason `aborted`.
- Every opened session is closed, and every child is reaped after success, error, abort, or consumer return.
- Model routing uses only ACP `configId: 'model'` with `JSON.stringify([providerRoute, model])`.
- Effort uses only ACP `configId: 'reasoning_effort'` with a validated mapped value.
- Unsupported `maxTokens` fails fast under the provisional default and is never silently ignored.
- MCP stdio and HTTP declarations are validated and forwarded; unsupported SSE fails before prompt execution.
- Best-effort structured output uses the shared prompt augmentation and parser and leaves final schema validation/re-ask to the workflow executor.
- Results omit `tokens`, `usageBreakdown`, and fabricated cost.
- Capabilities are exactly the declared object, especially `askHuman: false`, `nativeTools: false`, and `containerExec: false`.
- The generated capability matrix and the three hand-written docs surfaces describe the runtime truth and provisional limitations.
- All focused tests, affected package tests, type checks, generated-file checks, and `bun run validate` pass.
- The live spike either passes with explicit authorization or is accurately reported as not run.

## Out of scope

- Per-request token, cache, reasoning, or cost usage.
- Token-level streaming beyond committed ACP message and thought updates.
- ACP session fork, load, list, delete, mode, plan, terminal, elicitation, and filesystem extensions.
- Native Archon tools, AskHuman, hooks, skills, inline sub-agents, tool restrictions, fallback models, cost controls, sandbox overrides, setting sources, and container execution.
- MCP SSE until pinned DSH supports it.
- A private `max_tokens` ACP option or DSH patch overlay.
- DeepSeek tier defaults without approved model ids.
- A Node sidecar.
- Global DSH fallback.
- Runtime extraction or standalone-binary packaging without a separately reviewed design.
- Any database, API-schema, credential-delivery, auth-route, or core config-loader change.

## Rollback

Revert the DeepSeek-specific commits in reverse order, remove the one community-registry call and barrel exports, regenerate the capability matrix, and rerun `bun run validate`.
Existing stored vendor `deepseek` credentials are shared credential data and must not be deleted during rollback.
