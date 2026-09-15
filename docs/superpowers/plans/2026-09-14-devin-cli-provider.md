# Devin CLI Community Provider Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `devin` community provider that runs the installed Devin CLI over ACP (`devin --permission-mode yolo acp`) for chat and workflow turns, with durable AskHuman pause/re-entry, session resume, cancellation, per-turn token usage, a status-only shared-login credential surface, and truthful capability flags.

**Architecture:** `@archon/providers` gains `community/devin/`, modeled on the DeepSeek ACP adapter but replacing its permission policy, capability gate, and `session/resume` path. One `devin` child per turn: initialize → `session/new` or `session/load` (replay suppressed) → `session/set_mode` to `bypass` (the CLI permission flag does not reach ACP sessions) → `session/set_config_option` for the model → `session/prompt` → cancel + reap. AskHuman rides ACP **elicitation** (Devin's native `ask_user_question` tool routes to the client's `elicitation/create` when the client advertises the form capability), not a per-turn MCP bridge — see *Evidence* below. `@archon/core` learns to detect the shared Devin login for the Agents settings card; `@archon/web` renders that status for a single-credential agent.

**Tech Stack:** Bun, strict TypeScript, Bun test, `@agentclientprotocol/sdk@1.4.0` (already a dependency), Node `child_process`, ACP v1 JSON-RPC over stdio, Devin CLI `3000.10.21` on the host.

**Authoritative input:** `docs/superpowers/specs/2026-09-14-devin-cli-provider-design.md`.

## Global Constraints

- Provider id `devin`, `builtIn: false`, registered through `registerCommunityProviders()`; adapter lives in `packages/providers/src/community/devin/`.
- Child command is exactly `<devin> --permission-mode yolo acp [--agent-type X] [--refusal-fallback a,b]`, and every session is switched to Devin's `bypass` mode over ACP (`session/set_mode`) right after `session/new` or `session/load`, because the CLI flag never reaches ACP sessions (E8). `yolo` is fixed; a configured `permissionMode` or `sandbox` key is rejected.
- Every ACP request that waits on Devin's network (`initialize`, `session/new`, `session/load`, `session/set_mode`, `session/set_config_option`) runs under a bounded timeout (default 60 s, override `DEVIN_ACP_SETUP_TIMEOUT_MS`) so a hung remote-config fetch (E11) fails the turn instead of parking it.
- No new npm dependency. `@agentclientprotocol/sdk` stays `1.4.0` and loads only inside `sendQuery()` via `await import('./acp-client')`.
- Use `import type` for every ACP type outside `acp-client.ts`.
- Never inject, store, log, or echo a Devin credential. Redact secret-looking env values from stderr excerpts. Never log question text.
- Never call `session/new` after a failed `session/load`. Never retry an AskHuman re-entry.
- Only `PromptResponse.usage` maps to usage. It is a draft ACP field (not in the stable v1 schema) that Devin emits and that measured per turn on 3000.10.21 (E7); `usage_update` never maps; no cost is computed.
- Capability flags must match wired behavior: `sessionResume: true`, `structuredOutput: 'best-effort'`, `envInjection: true`, `askHuman: true`; everything else `false` (including `mcp` and `nativeTools` — see Evidence E3/E4).
- Use the shared helpers `augmentPromptForJsonSchema`, `tryParseStructuredOutput`, `withResumedOutcome`, `resumedOutcome`.
- Run package tests from their package directories; never run root `bun test`. Final check is `bun run validate`.
- Code comments must explain invariants, never reference this plan, findings, or spec sections.

## Evidence gathered on 2026-09-14 (live probes against Devin CLI 3000.10.21)

Each item was reproduced with a throwaway script in an isolated temp git repo. The implementer must not re-derive these; the live smoke (Task 11) re-proves them.

- **E1 — Initialize.** `agentCapabilities.loadSession: true`; `mcpCapabilities.http: false, sse: false`; `sessionCapabilities` carries only `list`/`delete`/`additionalDirectories` (no `resume`, no `close`); `authMethods: [{ id: 'devin-browser' }]`; `_meta.mcpConfigPath: ~/.config/devin/mcp_config.json`. Devin emits `_cognition.ai/*` extension notifications continuously; the SDK `client()` builder ignores unhandled notifications (verified by every probe).
- **E2 — Cross-process `session/load` works.** A fresh `devin` process loaded a session created by an earlier process in ~1 s. Before the load response, Devin replays the history as ordinary `session/update` notifications (`user_message_chunk`, `agent_message_chunk`, `session_info_update`, `config_option_update`, `current_mode_update`, `available_commands_update`, `usage_update` …). A bogus id fails with JSON-RPC `code -32016`, message `Session not found`, `data['cognition.ai/errorKind'] = 'session_not_found'`.
- **E3 — Per-session ACP MCP servers are invisible to the model.** With `session/new.mcpServers = [stdio server]`, Devin spawned the server and sent MCP `initialize` + `notifications/initialized`, but never `tools/list`; the model's `mcp_list_servers` showed only the config-file servers and `mcp_list_tools('archonprobe')` failed with `Server archonprobe not found in configuration`. Declaring `clientCapabilities._meta['cognition.ai/mcp'] = true` did not change that. Therefore the spec's turn-scoped MCP bridge cannot deliver a NativeTool on this CLI build, and Archon's per-node `mcp:` cannot reach the model either.
- **E4 — Elicitation delivers AskHuman.** With `clientCapabilities.elicitation = { form: {} }` (accepted by Devin although the SDK 1.4.0 `ClientCapabilities` type lacks the field), the model gains a native `ask_user_question` tool. Calling it produced, in order on the same stdio stream: a `tool_call` update (`toolCallId`, `title: 'Asked user …'`, `_meta['cognition.ai/inferenceToolName'] = 'ask_user_question'`, `rawInput.questions[]`), then a client request `elicitation/create` with `{ sessionId, mode: 'form', message, requestedSchema: { type: 'object', properties: { q0: { title, description, type: 'string', oneOf: [{ const: 'red', title }, { const: 'blue', title }] } }, required: ['q0'] }, _meta: { 'cognition.ai/allowOther': true } }`. Responding `{ action: 'accept', content: { q0: 'blue' } }` continued the turn.
- **E5 — Durable pause + re-entry works.** Responding `{ action: 'cancel' }` and sending `session/cancel` ended the turn with `stopReason: 'cancelled'` and a `tool_call_update` `status: 'failed'` (`Canceled due to user interrupt`). A **new** process then did `session/load` (10 replayed updates), sent one user message `AskHuman <toolCallId> answers:\n[{"questionId":"q0","value":"blue"}]\n\nContinue the task using these answers. Do not call ask_user_question again for these questions.` and the model answered `CHOSEN=blue` without asking again; only new events followed the load.
- **E6 — Model selection.** `session/new` returns `configOptions` including `{ id: 'model', category: 'model', type: 'select', currentValue: '<default id>', options: [{ value: 'claude-opus-5-medium', name: 'Claude Opus 5 Medium' }, …] }` (385 options). `session/set_config_option { configId: 'model', value: 'claude-opus-5-low' }` succeeded; `value: 'no-such-model-xyz'` and `value: 'opus'` both failed with `code -32002`, message `Resource not found`, `data.uri = 'Model not found: <value>. Available models: …'`. The CLI flag `--model no-such-model-xyz` was **silently ignored** (session kept the default), while `--model opus` resolved to `claude-opus-5-medium`.
- **E7 — Usage.** `PromptResponse.usage` = `{ totalTokens, inputTokens, outputTokens, cachedReadTokens?, cachedWriteTokens? }` and is per turn (the re-entry turn in E5 reported its own numbers, not a running total). `usage_update` carries context occupancy plus cumulative `_meta` counters and must not map.
- **E8 — Permission and modes.** Devin's docs list `--permission-mode` values `normal` (alias `auto`, default), `accept-edits`, `smart`, `dangerous` (aliases `yolo`, `bypass`), and `autonomous` (needs `--sandbox`); `--help` prints only the first four. **The flag never reaches ACP sessions:** with `yolo`, `dangerous`, `auto`, `accept-edits`, `smart`, or no flag at all, `session/new` and `session/load` both report `modes.currentModeId: 'accept-edits'` and `availableModes` `accept-edits` (Code), `smart`, `ask`, `plan`, `bypass` (Bypass Permissions). `session/set_mode { sessionId, modeId: 'bypass' }` returns `{}` and is followed by `config_option_update` + `current_mode_update { currentModeId: 'bypass' }`. Devin's docs state that bypass auto-approves every tool call but organization-level deny/ask rules from Team Settings still apply. `devin acp --help` exposes `--agent-type <summarizer|review>`, `--model`, `--refusal-fallback <a,b>` (env `DEVIN_MODEL`, `DEVIN_REFUSAL_FALLBACK`).
- **E9 — Login state.** `devin auth status` prints `Logged in (via Devin).` and `Credentials: File: ~/.local/share/devin/credentials.toml` (XDG data dir). User config lives at `~/.config/devin/` (`config.json`, `cli/`, `skills/`). The ACP SDK exposes `RequestError.authRequired()`; ACP reserves JSON-RPC code `-32000` for "authentication required".
- **E10 — Tool naming.** Devin tool events carry the tool name in `_meta['cognition.ai/inferenceToolName']` and a human `title`; `name` is absent. Sidekick sub-agent events use ids prefixed `sk::` with `_meta['cognition.ai/sidekick'] = true`.
- **E11 — `session/new` can hang.** One probe's `session/new` never returned within 90 s while Devin's own log showed `remote config revalidation failed … fetch timed out` after MCP connect; a retry completed in 1 s. Setup requests need a bounded timeout.
- **E12 — Host config auto-import.** On every `session/new` Devin loads rules from `CLAUDE.md`/`AGENTS.md`, `.windsurf/rules`, `.cursor/rules`; skills from `~/.config/devin/skills`, `~/.agents/skills`, `.claude/skills`, `.agents/skills`; MCP servers from `~/.config/devin/mcp_config.json` plus project `.devin/mcp_config.json` and `.devin/mcp_config.local.json`; and hooks from `~/.claude/settings.json` (unknown hook names warn, non-fatal). It also snapshots a login-shell environment for its exec tool, so injected env must be proven by the live smoke rather than assumed. Devin's changelog through 3000.10.21 never mentions ACP-declared `mcpServers` reaching tool discovery, so E3 is a product limitation rather than a probe artifact.

## Decisions that deviate from the spec (confirmed by the maintainer in chat on 2026-09-14)

All four decisions below were accepted as written. Execution has not started and the execution approach (subagent-per-task or inline) is still open.

1. **AskHuman via ACP elicitation, not an MCP bridge.** Spec: turn-scoped stdio MCP server + private IPC. Evidence E3 shows the bridge cannot reach the model on the installed CLI; E4/E5 show elicitation gives the same durable pause/re-entry with no child MCP process, no IPC secret, and no listener to leak. The plan implements elicitation. `nativeTools` stays `false` (only the `AskHuman` NativeTool can be honored). If Devin later exposes ACP-declared MCP servers to the model, the bridge can be added as a separate change.
2. **`mcp: false` in v1.** Spec target was `mcp: true` for stdio. E3 proves Archon-supplied per-turn stdio servers never reach the model, so declaring `mcp: true` would be untrue. Devin-managed MCP config (`~/.config/devin/mcp_config.json`) keeps working untouched; a node that sets `mcp:` gets the executor's normal capability warning.
3. **The configured model string is passed to Devin verbatim; Archon never translates or guesses.** Spec asks to accept ids and aliases. E6 shows the only path that fails loudly on an unknown model is `session/set_config_option`, which rejects aliases, while `--model` accepts aliases but silently ignores unknown ones. The plan sends whatever the user configured through `set_config_option` and never passes `--model`; whether the string is an id or an alias is Devin's decision, and the person configuring is expected to know which they wrote. On CLI 3000.10.21 that means exact ids from `devin models list`.
4. **`yolo` is enforced over ACP as `bypass`, and a withheld bypass fails the turn.** The CLI flag never reaches ACP sessions (E8), so the client calls `session/set_mode` after every `session/new`/`session/load`; if an organization policy removes `bypass` from the available modes, the turn fails naming the modes rather than running in a stricter mode silently.

## File map

### Create — `packages/providers/src/community/devin/`

| File | Responsibility |
| --- | --- |
| `capabilities.ts` | `DEVIN_CAPABILITIES` constant. |
| `config.ts` (+ `.test.ts`) | `parseDevinConfig`, `buildDevinSpawnArgs`. |
| `binary-resolver.ts` (+ `.test.ts`) | `resolveDevinBinary`, `devinCredentialsPath`, `checkDevinReadiness`, `assertDevinLoggedIn`. |
| `errors.ts` (+ `.test.ts`) | `DevinProviderError`, subtypes, ACP error classification, secret redaction, `toDevinErrorResult`, `isAskHumanControlError`. |
| `async-queue.ts` (+ `.test.ts`) | Callback → async-iterator bridge (verbatim copy of the DeepSeek queue; two copies is below the rule-of-three threshold). |
| `event-bridge.ts` (+ `.test.ts`) | ACP `SessionUpdate` → `MessageChunk[]`, replay suppression, ask tool-call id tracking. |
| `elicitation.ts` (+ `.test.ts`) | `elicitationToAskHumanQuestions`, `buildDevinAskResumePrompt`. |
| `usage.ts` (+ `.test.ts`) | `devinPromptUsageToBreakdown`. |
| `acp-client.ts` (+ `.test.ts`) | ACP lifecycle over an in-process agent or stdio, cancellation, elicitation handling, permission blocking, process reaping. |
| `provider.ts` (+ `.test.ts`) | `DevinProvider` — preflight, error-as-result, control-error rethrow. |
| `provider-lazy-load.test.ts` | Proves the ACP SDK is not evaluated at import/registration time. |
| `registration.ts`, `index.ts` | Registry entry and public barrel. |
| `acp-live-smoke.ts` | Opt-in real-CLI smoke (`DEVIN_LIVE_TEST=1`). |

### Modify

- `packages/providers/src/types.ts` — add `DevinProviderDefaults`.
- `packages/providers/src/registry.ts`, `registry.test.ts`, `src/index.ts`, `package.json` — registration, exports, test invocations, smoke script.
- `packages/core/src/credentials/catalog.ts`, `catalog.test.ts` — ambient detection for vendor `devin`.
- `packages/web/src/experiments/console/components/AgentCredentialCard.tsx` (+ new `.test.tsx`) — ambient status for single-credential agents.
- `packages/workflows/src/loader.test.ts`, `dag-executor.test.ts` — provider selection and AskHuman pause/re-entry with a Devin-shaped provider.
- `scripts/generate-capability-matrix.ts` — caveat rows; regenerate `packages/docs-web/src/content/docs/reference/provider-capabilities.md`.
- `packages/docs-web/src/content/docs/getting-started/ai-assistants.md`, `reference/configuration.md`, `guides/mcp-servers.md`, `CHANGELOG.md`.

## Verified external contracts the code must use

| Contract | Behavior |
| --- | --- |
| Client builder | `client({ name }).onRequest(...).onNotification(...).connectWith(streamOrAgent, op)`; `ctx.request(method, params)`, `ctx.notify(method, params)`. |
| Methods | `methods.agent.initialize`, `methods.agent.session.new`, `.load`, `.setConfigOption`, `.prompt`, `.cancel` (notification); `methods.client.session.update`, `.requestPermission`; `methods.client.elicitation.create`. `session/close` is not advertised by Devin and is never called. |
| Elicitation capability | Send `clientCapabilities: { elicitation: { form: {} } }` only when an `AskHuman` NativeTool is supplied. The SDK type lacks the field; pin with one documented assertion. |
| Elicitation response | `{ action: 'cancel' }` after the AskHuman handler pauses the run; `{ action: 'accept', content }` is never sent by Archon (answers travel through re-entry). |
| Permission response | `{ outcome: { outcome: 'cancelled' } }` plus a terminal `devin_permission_blocked` error naming `toolCall.title`. |
| Mode | `session/set_mode { sessionId, modeId: 'bypass' }` after `session/new`/`session/load`; skipped when `modes.currentModeId` is already `bypass`; fails when `availableModes` lacks it. |
| Setup timeout | `SendRequestOptions.cancellationSignal` plus a local race so `initialize`/`session/*` setup calls fail with a clear message after `DEVIN_ACP_SETUP_TIMEOUT_MS` (default 60000). |
| Model | `session/set_config_option { sessionId, configId: 'model', value }`; read `configOptions` entries with `id === 'model'` for `currentValue`. |
| Errors | JSON-RPC `code -32000` → not logged in; `data['cognition.ai/errorKind'] === 'session_not_found'` or a failed `session/load` → session load failed; `code -32002` with `data.uri` starting `Model not found` → unsupported model. |
| Usage | `PromptResponse.usage` only. |

## Open questions with binding provisional defaults

1. **Multi-select elicitation shape.** Only single-select (`type: 'string'` + `oneOf`) was observed. **Default:** also accept `type: 'array'` whose `items` carries `oneOf`/`enum` as `selection: 'multi'`, and fail the turn with `devin_protocol_error` on any other property shape. The live smoke asks a single-select question; multi-select stays "inferred from the ACP schema" in the docs until observed.
2. **`yolo` versus ACP mode.** `yolo` is a documented alias of `dangerous` for the CLI, but ACP sessions ignore the flag (E8). **Default:** keep the flag as approved and enforce the same posture over ACP with `session/set_mode` → `bypass` on every turn; if `bypass` is missing from `availableModes` (an organization policy), fail the turn with `devin_protocol_error` naming the available modes rather than running in a stricter mode silently.
3. **Compiled binaries.** Nothing in this design needs a script runtime beside the Archon process, so no `BUNDLED_IS_BINARY` branch is planned. If the implementer finds one is needed, stop and report rather than adding a silent fallback.

---

## Task 1: Contract layer — defaults type, config parser, spawn args, capabilities

**Files:**
- Modify: `packages/providers/src/types.ts` (after the `DeepseekProviderDefaults` interface, before `ProviderDefaults`)
- Create: `packages/providers/src/community/devin/capabilities.ts`
- Create: `packages/providers/src/community/devin/config.ts`
- Test: `packages/providers/src/community/devin/config.test.ts`

**Interfaces:**
- Consumes: `ProviderCapabilities` from `../../types`.
- Produces: `DevinProviderDefaults`, `DEVIN_CAPABILITIES`, `DEVIN_PERMISSION_MODE`, `parseDevinConfig(raw): DevinProviderDefaults`, `buildDevinSpawnArgs(config): string[]`. `DevinProviderError` is defined in Task 2; Task 1 throws a plain `Error` from the parser and Task 2 does NOT change that — the provider boundary wraps parser errors as `devin_unsupported_config` (Task 6).

- [ ] **Step 1: Write the failing config and capability tests**

```ts
// packages/providers/src/community/devin/config.test.ts
import { describe, expect, test } from 'bun:test';

import { DEVIN_CAPABILITIES } from './capabilities';
import { buildDevinSpawnArgs, DEVIN_PERMISSION_MODE, parseDevinConfig } from './config';

describe('parseDevinConfig', () => {
  test('applies no defaults and keeps only supported keys', () => {
    expect(parseDevinConfig({})).toEqual({});
    expect(
      parseDevinConfig({
        model: ' claude-opus-5-low ',
        binaryPath: '/opt/devin/bin/devin',
        agentType: 'review',
        refusalFallback: ['claude-sonnet-5-medium', 'gpt-5-medium'],
        unrelated: true,
      })
    ).toEqual({
      model: 'claude-opus-5-low',
      binaryPath: '/opt/devin/bin/devin',
      agentType: 'review',
      refusalFallback: ['claude-sonnet-5-medium', 'gpt-5-medium'],
    });
  });

  test('rejects blank strings, bad agent types, and bad fallback lists', () => {
    expect(() => parseDevinConfig({ model: '  ' })).toThrow(/assistants\.devin\.model/);
    expect(() => parseDevinConfig({ binaryPath: 42 })).toThrow(/assistants\.devin\.binaryPath/);
    expect(() => parseDevinConfig({ agentType: 'planner' })).toThrow(
      /assistants\.devin\.agentType: expected 'summarizer' or 'review'/
    );
    expect(() => parseDevinConfig({ refusalFallback: 'opus' })).toThrow(
      /assistants\.devin\.refusalFallback: expected an array of non-empty strings/
    );
    expect(() => parseDevinConfig({ refusalFallback: [''] })).toThrow(
      /assistants\.devin\.refusalFallback/
    );
  });

  test('rejects permissionMode and sandbox because yolo is fixed', () => {
    expect(() => parseDevinConfig({ permissionMode: 'auto' })).toThrow(
      /assistants\.devin\.permissionMode is unsupported: Archon always runs Devin in yolo mode/
    );
    expect(() => parseDevinConfig({ sandbox: true })).toThrow(
      /assistants\.devin\.sandbox is unsupported/
    );
  });
});

describe('buildDevinSpawnArgs', () => {
  test('always pins yolo and the acp subcommand', () => {
    expect(buildDevinSpawnArgs({})).toEqual(['--permission-mode', DEVIN_PERMISSION_MODE, 'acp']);
  });

  test('appends agent type and comma-joined refusal fallbacks, never --model', () => {
    expect(
      buildDevinSpawnArgs({
        model: 'claude-opus-5-low',
        agentType: 'summarizer',
        refusalFallback: ['a', 'b'],
      })
    ).toEqual([
      '--permission-mode',
      'yolo',
      'acp',
      '--agent-type',
      'summarizer',
      '--refusal-fallback',
      'a,b',
    ]);
  });
});

describe('DEVIN_CAPABILITIES', () => {
  test('declares only the wired capabilities', () => {
    expect(DEVIN_CAPABILITIES).toEqual({
      sessionResume: true,
      mcp: false,
      hooks: false,
      skills: false,
      agents: false,
      toolRestrictions: false,
      structuredOutput: 'best-effort',
      envInjection: true,
      costControl: false,
      effortControl: false,
      thinkingControl: false,
      fallbackModel: false,
      sandbox: false,
      settingSources: false,
      nativeTools: false,
      containerExec: false,
      askHuman: true,
    });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run from `packages/providers`: `bun test src/community/devin/config.test.ts`
Expected: FAIL — `Cannot find module './capabilities'` (or `./config`).

- [ ] **Step 3: Add the defaults type to the contract layer**

Insert after the `DeepseekProviderDefaults` interface in `packages/providers/src/types.ts`:

```ts
/**
 * Community provider defaults for the Devin CLI over ACP.
 * Permission mode is always `yolo`, so there is no key for it. `model` must be
 * an exact id from `devin models list`; aliases are not accepted because the
 * ACP config option rejects them while the CLI flag ignores unknown names.
 */
export interface DevinProviderDefaults {
  [key: string]: unknown;
  model?: string;
  binaryPath?: string;
  agentType?: 'summarizer' | 'review';
  refusalFallback?: string[];
}
```

- [ ] **Step 4: Implement the capability constant**

```ts
// packages/providers/src/community/devin/capabilities.ts
import type { ProviderCapabilities } from '../../types';

/**
 * Devin CLI capabilities — every flag mirrors wired ACP behavior.
 * `askHuman` rides ACP elicitation of Devin's native ask_user_question tool.
 * `mcp` and `nativeTools` stay false: per-session ACP MCP servers are spawned
 * by Devin but never exposed to its model, so nothing Archon attaches per turn
 * can be called. Effort lives inside Devin model ids, hence no effortControl.
 */
export const DEVIN_CAPABILITIES = {
  sessionResume: true,
  mcp: false,
  hooks: false,
  skills: false,
  agents: false,
  toolRestrictions: false,
  structuredOutput: 'best-effort',
  envInjection: true,
  costControl: false,
  effortControl: false,
  thinkingControl: false,
  fallbackModel: false,
  sandbox: false,
  settingSources: false,
  nativeTools: false,
  containerExec: false,
  askHuman: true,
} as const satisfies ProviderCapabilities;
```

- [ ] **Step 5: Implement the parser and spawn-arg builder**

```ts
// packages/providers/src/community/devin/config.ts
import type { DevinProviderDefaults } from '../../types';

export type { DevinProviderDefaults };

/** Devin's own tool-permission mode for the spawned child. Fixed by design. */
export const DEVIN_PERMISSION_MODE = 'yolo' as const;

const AGENT_TYPES = ['summarizer', 'review'] as const;
type DevinAgentType = (typeof AGENT_TYPES)[number];

function parseTrimmedString(
  raw: Record<string, unknown>,
  field: 'model' | 'binaryPath'
): string | undefined {
  const value = raw[field];
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`Invalid assistants.devin.${field}: expected a non-empty string.`);
  }
  return value.trim();
}

function parseAgentType(value: unknown): DevinAgentType | undefined {
  if (value === undefined) return undefined;
  if (typeof value === 'string' && (AGENT_TYPES as readonly string[]).includes(value.trim())) {
    return value.trim() as DevinAgentType;
  }
  throw new Error("Invalid assistants.devin.agentType: expected 'summarizer' or 'review'.");
}

function parseRefusalFallback(value: unknown): string[] | undefined {
  if (value === undefined) return undefined;
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    !value.every((item): item is string => typeof item === 'string' && item.trim().length > 0)
  ) {
    throw new Error(
      'Invalid assistants.devin.refusalFallback: expected an array of non-empty strings.'
    );
  }
  return value.map(item => item.trim());
}

/**
 * Parse raw `assistants.devin` config into typed defaults. Keys that would
 * change Devin's permission posture are rejected instead of ignored so an
 * operator cannot believe a stricter mode is in effect.
 */
export function parseDevinConfig(raw: Record<string, unknown>): DevinProviderDefaults {
  if (raw.permissionMode !== undefined) {
    throw new Error(
      'assistants.devin.permissionMode is unsupported: Archon always runs Devin in yolo mode.'
    );
  }
  if (raw.sandbox !== undefined) {
    throw new Error(
      'assistants.devin.sandbox is unsupported: Devin sandbox mode is not part of the yolo contract.'
    );
  }

  const config: DevinProviderDefaults = {};
  const model = parseTrimmedString(raw, 'model');
  const binaryPath = parseTrimmedString(raw, 'binaryPath');
  const agentType = parseAgentType(raw.agentType);
  const refusalFallback = parseRefusalFallback(raw.refusalFallback);
  if (model !== undefined) config.model = model;
  if (binaryPath !== undefined) config.binaryPath = binaryPath;
  if (agentType !== undefined) config.agentType = agentType;
  if (refusalFallback !== undefined) config.refusalFallback = refusalFallback;
  return config;
}

/**
 * Child argv after the binary. The model is deliberately NOT passed here:
 * `--model` accepts aliases but silently keeps the default on an unknown name,
 * so the model is applied over ACP where an unknown id fails loudly.
 */
export function buildDevinSpawnArgs(config: DevinProviderDefaults): string[] {
  const args = ['--permission-mode', DEVIN_PERMISSION_MODE, 'acp'];
  if (config.agentType !== undefined) args.push('--agent-type', config.agentType);
  if (config.refusalFallback !== undefined && config.refusalFallback.length > 0) {
    args.push('--refusal-fallback', config.refusalFallback.join(','));
  }
  return args;
}
```

- [ ] **Step 6: Run the tests and type-check**

Run from `packages/providers`:
```bash
bun test src/community/devin/config.test.ts
bun run type-check
```
Expected: all tests PASS; type-check clean.

- [ ] **Step 7: Commit**

```bash
git add packages/providers/src/types.ts packages/providers/src/community/devin/capabilities.ts packages/providers/src/community/devin/config.ts packages/providers/src/community/devin/config.test.ts
git commit -m "feat(providers): add devin config parser and capability contract"
```

## Task 2: Binary resolution, login readiness, and typed errors

**Files:**
- Create: `packages/providers/src/community/devin/errors.ts`
- Test: `packages/providers/src/community/devin/errors.test.ts`
- Create: `packages/providers/src/community/devin/binary-resolver.ts`
- Test: `packages/providers/src/community/devin/binary-resolver.test.ts`

**Interfaces:**
- Consumes: `MessageChunk`, `AskHumanControlError`, `AskHumanAwaitingError`, `AskHumanNoStarterError`, `AskHumanPauseFailedError` from `../../types`.
- Produces:
  - `type DevinErrorSubtype`, `class DevinProviderError extends Error { subtype }`
  - `isAskHumanControlError(error: unknown): error is AskHumanControlError`
  - `classifyDevinAcpError(error: unknown, fallback: DevinErrorSubtype): Error` (returns AskHuman control errors unchanged)
  - `isRedactableSecretValue`, `isDevinSecretName`, `collectDevinSecretValues(env)`, `redactDevinSecrets(message, secrets)`, `toDevinErrorResult(error, secrets)`
  - `resolveDevinBinary(configBinaryPath, env?, facts?): string`, `devinCredentialsPath(env?): string`, `checkDevinReadiness(env?, facts?): DevinReadiness`, `assertDevinLoggedIn(env?): void`
  - `interface DevinReadiness { binaryPath?: string; loggedIn: boolean; ready: boolean }`

- [ ] **Step 1: Write the failing error tests**

```ts
// packages/providers/src/community/devin/errors.test.ts
import { describe, expect, test } from 'bun:test';

import { AskHumanAwaitingError, AskHumanPauseFailedError } from '../../types';
import {
  classifyDevinAcpError,
  collectDevinSecretValues,
  DevinProviderError,
  isAskHumanControlError,
  redactDevinSecrets,
  toDevinErrorResult,
} from './errors';

describe('DevinProviderError', () => {
  test('carries subtype and name', () => {
    const error = new DevinProviderError('devin_binary_missing', 'no devin');
    expect(error.name).toBe('DevinProviderError');
    expect(error.subtype).toBe('devin_binary_missing');
    expect(error.message).toBe('no devin');
  });
});

describe('classifyDevinAcpError', () => {
  test('returns existing provider errors unchanged', () => {
    const error = new DevinProviderError('devin_aborted', 'x');
    expect(classifyDevinAcpError(error, 'devin_acp_error')).toBe(error);
  });

  test('returns AskHuman control errors unchanged', () => {
    const awaiting = new AskHumanAwaitingError('call_1', 'node', 'run');
    const failed = new AskHumanPauseFailedError('call_1', 'node', 'run', 'db down');
    expect(classifyDevinAcpError(awaiting, 'devin_acp_error')).toBe(awaiting);
    expect(classifyDevinAcpError(failed, 'devin_acp_error')).toBe(failed);
    expect(isAskHumanControlError(awaiting)).toBe(true);
    expect(isAskHumanControlError(new Error('plain'))).toBe(false);
  });

  test('maps JSON-RPC -32000 to devin_not_logged_in with a login hint', () => {
    const result = classifyDevinAcpError(
      Object.assign(new Error('Authentication required'), { code: -32000 }),
      'devin_acp_error'
    );
    expect(result).toBeInstanceOf(DevinProviderError);
    expect((result as DevinProviderError).subtype).toBe('devin_not_logged_in');
    expect(result.message).toContain('devin auth login');
  });

  test('maps session_not_found to devin_session_load_failed', () => {
    const result = classifyDevinAcpError(
      Object.assign(new Error('Session not found'), {
        code: -32016,
        data: { 'cognition.ai/errorKind': 'session_not_found' },
      }),
      'devin_acp_error'
    ) as DevinProviderError;
    expect(result.subtype).toBe('devin_session_load_failed');
    expect(result.message).toContain('Session not found');
  });

  test('maps a model lookup failure to devin_unsupported_model using the ACP detail', () => {
    const result = classifyDevinAcpError(
      Object.assign(new Error('Resource not found'), {
        code: -32002,
        data: { uri: 'Model not found: opus. Available models: claude-opus-5-medium' },
      }),
      'devin_acp_error'
    ) as DevinProviderError;
    expect(result.subtype).toBe('devin_unsupported_model');
    expect(result.message).toBe('Model not found: opus. Available models: claude-opus-5-medium');
  });

  test('falls back to the caller subtype with the original message', () => {
    const result = classifyDevinAcpError(new Error('boom'), 'devin_session_load_failed');
    expect(result).toMatchObject({ subtype: 'devin_session_load_failed', message: 'boom' });
  });
});

describe('secret redaction', () => {
  test('collects only secret-named env values of usable length', () => {
    expect(
      collectDevinSecretValues({
        DEVIN_API_TOKEN: 'tok-1234567890',
        PATH: '/usr/bin',
        SHORT_SECRET: 'ab',
        GITHUB_TOKEN: 'ghp_abcdef',
      })
    ).toEqual(['tok-1234567890', 'ghp_abcdef']);
  });

  test('redacts longest secrets first', () => {
    expect(redactDevinSecrets('x tok-12345 y tok-12345-long', ['tok-12345', 'tok-12345-long'])).toBe(
      'x [REDACTED] y [REDACTED]'
    );
  });

  test('toDevinErrorResult produces a terminal redacted result without session or usage', () => {
    const result = toDevinErrorResult(
      new DevinProviderError('devin_spawn_failed', 'spawn failed: tok-12345'),
      ['tok-12345']
    );
    expect(result).toEqual({
      type: 'result',
      isError: true,
      errorSubtype: 'devin_spawn_failed',
      errors: ['spawn failed: [REDACTED]'],
    });
    expect(toDevinErrorResult(new Error('plain'), []).errorSubtype).toBe('devin_acp_error');
  });
});
```

- [ ] **Step 2: Write the failing binary-resolver tests**

```ts
// packages/providers/src/community/devin/binary-resolver.test.ts
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  assertDevinLoggedIn,
  checkDevinReadiness,
  devinCredentialsPath,
  resolveDevinBinary,
  type DevinRuntimeFacts,
} from './binary-resolver';
import { DevinProviderError } from './errors';

let dir: string;
let fakeBin: string;

function facts(found?: string): DevinRuntimeFacts {
  return { platform: process.platform, findOnPath: () => found };
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'archon-devin-bin-'));
  fakeBin = join(dir, 'devin');
  writeFileSync(fakeBin, '#!/bin/sh\nexit 0\n');
  if (process.platform !== 'win32') chmodSync(fakeBin, 0o755);
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('resolveDevinBinary', () => {
  test('DEVIN_BIN_PATH beats config which beats PATH', () => {
    expect(resolveDevinBinary('/nope', { DEVIN_BIN_PATH: fakeBin }, facts('/also-nope'))).toBe(fakeBin);
    expect(resolveDevinBinary(fakeBin, {}, facts('/also-nope'))).toBe(fakeBin);
    expect(resolveDevinBinary(undefined, {}, facts(fakeBin))).toBe(fakeBin);
  });

  test('rejects relative env paths and unusable files', () => {
    expect(() => resolveDevinBinary(undefined, { DEVIN_BIN_PATH: 'devin' }, facts())).toThrow(
      /DEVIN_BIN_PATH is set to "devin" but must be an absolute path/
    );
    expect(() => resolveDevinBinary(join(dir, 'missing'), {}, facts())).toThrow(DevinProviderError);
  });

  test('throws devin_binary_missing with install guidance when nothing resolves', () => {
    try {
      resolveDevinBinary(undefined, {}, facts(undefined));
      throw new Error('expected throw');
    } catch (error) {
      expect(error).toBeInstanceOf(DevinProviderError);
      expect((error as DevinProviderError).subtype).toBe('devin_binary_missing');
      expect((error as Error).message).toContain('Install the Devin CLI');
    }
  });
});

describe('login readiness', () => {
  test('credentials path honors XDG_DATA_HOME and falls back to ~/.local/share', () => {
    expect(devinCredentialsPath({ XDG_DATA_HOME: '/xdg' })).toBe(
      join('/xdg', 'devin', 'credentials.toml')
    );
    expect(devinCredentialsPath({ HOME: '/home/u' })).toBe(
      join('/home/u', '.local', 'share', 'devin', 'credentials.toml')
    );
  });

  test('checkDevinReadiness reports binary + login without throwing', () => {
    const dataHome = join(dir, 'data');
    mkdirSync(join(dataHome, 'devin'), { recursive: true });
    const env = { DEVIN_BIN_PATH: fakeBin, XDG_DATA_HOME: dataHome };
    expect(checkDevinReadiness(env, facts())).toEqual({
      binaryPath: fakeBin,
      loggedIn: false,
      ready: false,
    });
    writeFileSync(join(dataHome, 'devin', 'credentials.toml'), '');
    expect(checkDevinReadiness(env, facts())).toEqual({
      binaryPath: fakeBin,
      loggedIn: true,
      ready: true,
    });
    expect(checkDevinReadiness({ XDG_DATA_HOME: dataHome }, facts(undefined))).toEqual({
      loggedIn: true,
      ready: false,
    });
  });

  test('assertDevinLoggedIn throws devin_not_logged_in when the credentials file is absent', () => {
    expect(() => assertDevinLoggedIn({ XDG_DATA_HOME: join(dir, 'empty') })).toThrow(
      /Run `devin auth login` on the Archon host/
    );
  });
});
```

- [ ] **Step 3: Run both tests to verify they fail**

Run from `packages/providers`:
```bash
bun test src/community/devin/errors.test.ts
bun test src/community/devin/binary-resolver.test.ts
```
Expected: FAIL — modules not found.

- [ ] **Step 4: Implement typed errors, classification, and redaction**

```ts
// packages/providers/src/community/devin/errors.ts
import {
  AskHumanAwaitingError,
  AskHumanNoStarterError,
  AskHumanPauseFailedError,
  type AskHumanControlError,
  type MessageChunk,
} from '../../types';

export type DevinErrorSubtype =
  | 'devin_binary_missing'
  | 'devin_not_logged_in'
  | 'devin_unsupported_config'
  | 'devin_spawn_failed'
  | 'devin_child_exited'
  | 'devin_protocol_error'
  | 'devin_session_load_failed'
  | 'devin_unsupported_model'
  | 'devin_permission_blocked'
  | 'devin_aborted'
  | 'devin_acp_error';

export class DevinProviderError extends Error {
  readonly name = 'DevinProviderError';
  constructor(
    readonly subtype: DevinErrorSubtype,
    message: string,
    options?: ErrorOptions
  ) {
    super(message, options);
  }
}

/** JSON-RPC code ACP reserves for "authentication required". */
export const ACP_AUTH_REQUIRED_CODE = -32000;

export function isAskHumanControlError(error: unknown): error is AskHumanControlError {
  return (
    error instanceof AskHumanAwaitingError ||
    error instanceof AskHumanNoStarterError ||
    error instanceof AskHumanPauseFailedError
  );
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function acpCode(error: unknown): number | undefined {
  if (!isRecord(error)) return undefined;
  return typeof error.code === 'number' ? error.code : undefined;
}

function acpData(error: unknown): Record<string, unknown> | undefined {
  if (!isRecord(error) || !isRecord(error.data)) return undefined;
  return error.data;
}

/**
 * Turn an ACP request failure into a typed provider error. AskHuman control
 * errors pass through untouched because the executor branches on their class;
 * wrapping them would turn a deliberate pause into a node failure.
 */
export function classifyDevinAcpError(error: unknown, fallback: DevinErrorSubtype): Error {
  if (error instanceof DevinProviderError) return error;
  if (isAskHumanControlError(error)) return error;

  const code = acpCode(error);
  const data = acpData(error);
  if (code === ACP_AUTH_REQUIRED_CODE) {
    return new DevinProviderError(
      'devin_not_logged_in',
      'Devin CLI is not logged in. Run `devin auth login` on the Archon host, then retry.',
      { cause: error }
    );
  }
  if (data?.['cognition.ai/errorKind'] === 'session_not_found') {
    return new DevinProviderError('devin_session_load_failed', errorMessage(error), {
      cause: error,
    });
  }
  const uri = data?.uri;
  if (code === -32002 && typeof uri === 'string' && uri.startsWith('Model not found')) {
    return new DevinProviderError('devin_unsupported_model', uri, { cause: error });
  }
  return new DevinProviderError(fallback, errorMessage(error), { cause: error });
}

const SENSITIVE_ENV_NAME_PATTERN =
  /(?:API[_-]?KEY|ACCESS[_-]?KEY|PRIVATE[_-]?KEY|TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIAL|AUTH(?:ORIZATION)?|COOKIE)/i;
const MIN_SECRET_LENGTH = 4;

/** Values shorter than the floor match ordinary output and would shred it. */
export function isRedactableSecretValue(value: string | undefined): value is string {
  return value !== undefined && value.length >= MIN_SECRET_LENGTH;
}

export function isDevinSecretName(name: string): boolean {
  return SENSITIVE_ENV_NAME_PATTERN.test(name);
}

export function collectDevinSecretValues(env: Record<string, string | undefined>): string[] {
  const secrets: string[] = [];
  for (const [name, value] of Object.entries(env)) {
    if (isDevinSecretName(name) && isRedactableSecretValue(value) && !secrets.includes(value)) {
      secrets.push(value);
    }
  }
  return secrets;
}

export function redactDevinSecrets(message: string, secrets: readonly string[]): string {
  let redacted = message;
  // Longest first so a shorter secret that prefixes a longer one cannot leave a tail.
  for (const secret of [...secrets].sort((a: string, b: string) => b.length - a.length)) {
    if (secret.length === 0) continue;
    redacted = redacted.split(secret).join('[REDACTED]');
  }
  return redacted;
}

/** Terminal result chunk for a failed turn. Never synthesizes usage or a session id. */
export function toDevinErrorResult(
  error: unknown,
  secrets: readonly string[]
): Extract<MessageChunk, { type: 'result' }> {
  const subtype = error instanceof DevinProviderError ? error.subtype : 'devin_acp_error';
  return {
    type: 'result',
    isError: true,
    errorSubtype: subtype,
    errors: [redactDevinSecrets(errorMessage(error), secrets)],
  };
}
```

- [ ] **Step 5: Implement binary resolution and readiness**

```ts
// packages/providers/src/community/devin/binary-resolver.ts
import { execFileSync } from 'node:child_process';
import { accessSync, constants as fsConstants, existsSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';

import { DevinProviderError } from './errors';

export interface DevinRuntimeFacts {
  platform: NodeJS.Platform;
  findOnPath: (env: Record<string, string | undefined>, platform: NodeJS.Platform) => string | undefined;
}

export interface DevinReadiness {
  binaryPath?: string;
  loggedIn: boolean;
  ready: boolean;
}

const INSTALL_HINT =
  'Install the Devin CLI (https://docs.devin.ai/cli) and put `devin` on PATH, or set DEVIN_BIN_PATH or assistants.devin.binaryPath to its absolute path.';

function definedEnv(env: Record<string, string | undefined>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(env).filter((entry): entry is [string, string] => entry[1] !== undefined)
  );
}

function findDevinOnPath(
  env: Record<string, string | undefined>,
  platform: NodeJS.Platform
): string | undefined {
  const lookupCmd = platform === 'win32' ? 'where' : 'which';
  try {
    const output = execFileSync(lookupCmd, ['devin'], {
      encoding: 'utf-8',
      env: definedEnv(env),
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    const first = output.split(/\r?\n/)[0]?.trim();
    if (!first) return undefined;
    return isAbsolute(first) ? first : resolve(first);
  } catch {
    return undefined;
  }
}

function defaultFacts(): DevinRuntimeFacts {
  return { platform: process.platform, findOnPath: findDevinOnPath };
}

function isUsableExecutable(path: string, platform: NodeJS.Platform): boolean {
  try {
    if (!statSync(path).isFile()) return false;
    if (platform !== 'win32') accessSync(path, fsConstants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function assertBinary(path: string, sourceLabel: string, platform: NodeJS.Platform): string {
  if (!isAbsolute(path)) {
    throw new DevinProviderError(
      'devin_binary_missing',
      `${sourceLabel} is set to "${path}" but must be an absolute path. ${INSTALL_HINT}`
    );
  }
  if (!isUsableExecutable(path, platform)) {
    throw new DevinProviderError(
      'devin_binary_missing',
      `${sourceLabel} is set to "${path}" but it is not an executable file. ${INSTALL_HINT}`
    );
  }
  return path;
}

/** Precedence: DEVIN_BIN_PATH → assistants.devin.binaryPath → PATH. */
export function resolveDevinBinary(
  configBinaryPath: string | undefined,
  env: Record<string, string | undefined> = process.env,
  facts: DevinRuntimeFacts = defaultFacts()
): string {
  if (env.DEVIN_BIN_PATH) return assertBinary(env.DEVIN_BIN_PATH, 'DEVIN_BIN_PATH', facts.platform);
  if (configBinaryPath) {
    return assertBinary(configBinaryPath, 'assistants.devin.binaryPath', facts.platform);
  }
  const fromPath = facts.findOnPath(env, facts.platform);
  if (fromPath) return assertBinary(fromPath, 'PATH', facts.platform);
  throw new DevinProviderError('devin_binary_missing', `Devin CLI was not found. ${INSTALL_HINT}`);
}

/**
 * Where `devin auth login` stores the shared machine login. Only the file's
 * existence is ever read — never its contents.
 */
export function devinCredentialsPath(env: Record<string, string | undefined> = process.env): string {
  const dataHome = env.XDG_DATA_HOME && env.XDG_DATA_HOME.length > 0
    ? env.XDG_DATA_HOME
    : join(env.HOME && env.HOME.length > 0 ? env.HOME : homedir(), '.local', 'share');
  return join(dataHome, 'devin', 'credentials.toml');
}

/** Status-only readiness for the Agents settings card. Never throws, never reads secrets. */
export function checkDevinReadiness(
  env: Record<string, string | undefined> = process.env,
  facts: DevinRuntimeFacts = defaultFacts()
): DevinReadiness {
  let binaryPath: string | undefined;
  try {
    binaryPath = resolveDevinBinary(undefined, env, facts);
  } catch {
    binaryPath = undefined;
  }
  const loggedIn = existsSync(devinCredentialsPath(env));
  return {
    ...(binaryPath !== undefined ? { binaryPath } : {}),
    loggedIn,
    ready: binaryPath !== undefined && loggedIn,
  };
}

export function assertDevinLoggedIn(env: Record<string, string | undefined> = process.env): void {
  if (existsSync(devinCredentialsPath(env))) return;
  throw new DevinProviderError(
    'devin_not_logged_in',
    'Devin CLI is not logged in on this machine. Run `devin auth login` on the Archon host, then retry.'
  );
}
```

- [ ] **Step 6: Run the tests and type-check**

Run from `packages/providers`:
```bash
bun test src/community/devin/errors.test.ts
bun test src/community/devin/binary-resolver.test.ts
bun run type-check
```
Expected: PASS; type-check clean.

- [ ] **Step 7: Commit**

```bash
git add packages/providers/src/community/devin/errors.ts packages/providers/src/community/devin/errors.test.ts packages/providers/src/community/devin/binary-resolver.ts packages/providers/src/community/devin/binary-resolver.test.ts
git commit -m "feat(providers): add devin binary resolution, login readiness, and typed errors"
```

## Task 3: Async queue and ACP event bridge

**Files:**
- Create: `packages/providers/src/community/devin/async-queue.ts` — verbatim copy of `packages/providers/src/community/deepseek/async-queue.ts` (no edits; see file map for the duplication rationale).
- Create: `packages/providers/src/community/devin/async-queue.test.ts` — verbatim copy of `packages/providers/src/community/deepseek/async-queue.test.ts` with the import path unchanged (`./async-queue`).
- Create: `packages/providers/src/community/devin/event-bridge.ts`
- Test: `packages/providers/src/community/devin/event-bridge.test.ts`

**Interfaces:**
- Consumes: `SessionUpdate`, `ContentBlock`, `ToolCallContent` types from `@agentclientprotocol/sdk` (type-only), `MessageChunk` from `../../types`.
- Produces: `DEVIN_ASK_TOOL_NAME = 'ask_user_question'`, `interface DevinEventState { tools; pendingAskToolCallIds: string[]; replaying: boolean }`, `createDevinEventState()`, `devinToolName(update)`, `mapDevinSessionUpdate(update, state): MessageChunk[]`.

- [ ] **Step 1: Copy the queue and its test, then run the test**

```bash
cp packages/providers/src/community/deepseek/async-queue.ts packages/providers/src/community/devin/async-queue.ts
cp packages/providers/src/community/deepseek/async-queue.test.ts packages/providers/src/community/devin/async-queue.test.ts
cd packages/providers && bun test src/community/devin/async-queue.test.ts
```
Expected: PASS (same tests, same implementation).

- [ ] **Step 2: Write the failing event-bridge tests**

```ts
// packages/providers/src/community/devin/event-bridge.test.ts
import { describe, expect, test } from 'bun:test';
import type { SessionUpdate } from '@agentclientprotocol/sdk';

import { createDevinEventState, devinToolName, mapDevinSessionUpdate } from './event-bridge';

const text = (kind: 'agent_message_chunk' | 'agent_thought_chunk' | 'user_message_chunk', t: string): SessionUpdate =>
  ({ sessionUpdate: kind, content: { type: 'text', text: t } }) as SessionUpdate;

describe('mapDevinSessionUpdate', () => {
  test('maps message and thought chunks; drops user chunks and housekeeping updates', () => {
    const state = createDevinEventState();
    expect(mapDevinSessionUpdate(text('agent_message_chunk', 'hi'), state)).toEqual([
      { type: 'assistant', content: 'hi' },
    ]);
    expect(mapDevinSessionUpdate(text('agent_thought_chunk', 'hmm'), state)).toEqual([
      { type: 'thinking', content: 'hmm' },
    ]);
    expect(mapDevinSessionUpdate(text('user_message_chunk', 'me'), state)).toEqual([]);
    for (const update of [
      { sessionUpdate: 'usage_update', used: 1, size: 2 },
      { sessionUpdate: 'available_commands_update', availableCommands: [] },
      { sessionUpdate: 'current_mode_update', currentModeId: 'accept-edits' },
      { sessionUpdate: 'session_info_update' },
      { sessionUpdate: 'config_option_update', configOptions: [] },
    ] as unknown as SessionUpdate[]) {
      expect(mapDevinSessionUpdate(update, state)).toEqual([]);
    }
  });

  test('drops everything while replaying a loaded session', () => {
    const state = createDevinEventState();
    state.replaying = true;
    expect(mapDevinSessionUpdate(text('agent_message_chunk', 'old'), state)).toEqual([]);
    expect(
      mapDevinSessionUpdate(
        { sessionUpdate: 'tool_call', toolCallId: 'old-1', title: 'Read file' } as SessionUpdate,
        state
      )
    ).toEqual([]);
    expect(state.tools.size).toBe(0);
    state.replaying = false;
    expect(mapDevinSessionUpdate(text('agent_message_chunk', 'new'), state)).toEqual([
      { type: 'assistant', content: 'new' },
    ]);
  });

  test('names tools from cognition.ai/inferenceToolName, then name, then title', () => {
    expect(
      devinToolName({ title: 'Read file', _meta: { 'cognition.ai/inferenceToolName': 'read' } })
    ).toBe('read');
    expect(devinToolName({ title: 'Read file', name: 'reader' })).toBe('reader');
    expect(devinToolName({ title: 'Read file' })).toBe('Read file');
    expect(devinToolName({})).toBeUndefined();
  });

  test('emits tool then tool_result with the remembered name and terminal status', () => {
    const state = createDevinEventState();
    const call = {
      sessionUpdate: 'tool_call',
      toolCallId: 'call_1',
      title: 'Listed MCP tools for gitnexus',
      rawInput: { server_name: 'gitnexus' },
      _meta: { 'cognition.ai/inferenceToolName': 'mcp_list_tools' },
    } as SessionUpdate;
    expect(mapDevinSessionUpdate(call, state)).toEqual([
      {
        type: 'tool',
        toolName: 'mcp_list_tools',
        toolCallId: 'call_1',
        toolInput: { server_name: 'gitnexus' },
      },
    ]);
    expect(
      mapDevinSessionUpdate(
        { sessionUpdate: 'tool_call_update', toolCallId: 'call_1', status: 'in_progress' } as SessionUpdate,
        state
      )
    ).toEqual([]);
    expect(
      mapDevinSessionUpdate(
        {
          sessionUpdate: 'tool_call_update',
          toolCallId: 'call_1',
          status: 'completed',
          content: [{ type: 'content', content: { type: 'text', text: '- `query`' } }],
        } as SessionUpdate,
        state
      )
    ).toEqual([
      {
        type: 'tool_result',
        toolName: 'mcp_list_tools',
        toolCallId: 'call_1',
        toolOutput: '- `query`',
        toolOutcome: 'success',
      },
    ]);
    expect(state.tools.has('call_1')).toBe(false);
  });

  test('records ask_user_question tool-call ids in order for elicitation correlation', () => {
    const state = createDevinEventState();
    const ask = (id: string): SessionUpdate =>
      ({
        sessionUpdate: 'tool_call',
        toolCallId: id,
        title: 'Asked user Which color?',
        rawInput: { questions: [] },
        _meta: { 'cognition.ai/inferenceToolName': 'ask_user_question' },
      }) as SessionUpdate;
    mapDevinSessionUpdate(ask('call_a'), state);
    mapDevinSessionUpdate(ask('call_b'), state);
    expect(state.pendingAskToolCallIds).toEqual(['call_a', 'call_b']);
    expect(
      mapDevinSessionUpdate(
        {
          sessionUpdate: 'tool_call_update',
          toolCallId: 'call_a',
          status: 'failed',
          content: [{ type: 'content', content: { type: 'text', text: 'Canceled due to user interrupt' } }],
        } as SessionUpdate,
        state
      )
    ).toEqual([
      {
        type: 'tool_result',
        toolName: 'ask_user_question',
        toolCallId: 'call_a',
        toolOutput: 'Canceled due to user interrupt',
        toolOutcome: 'error',
      },
    ]);
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run from `packages/providers`: `bun test src/community/devin/event-bridge.test.ts`
Expected: FAIL — `Cannot find module './event-bridge'`.

- [ ] **Step 4: Implement the event bridge**

```ts
// packages/providers/src/community/devin/event-bridge.ts
import type { ContentBlock, SessionUpdate, ToolCallContent } from '@agentclientprotocol/sdk';

import type { MessageChunk } from '../../types';

/** Devin's native question tool; its calls are answered through ACP elicitation. */
export const DEVIN_ASK_TOOL_NAME = 'ask_user_question';

const INFERENCE_TOOL_NAME_META = 'cognition.ai/inferenceToolName';

export interface DevinEventState {
  readonly tools: Map<string, { name: string; input?: Record<string, unknown> }>;
  /**
   * ask_user_question tool-call ids in arrival order, not yet claimed by an
   * elicitation request. Devin sends the tool_call notification before the
   * elicitation request on the same ordered stream, so FIFO correlation gives
   * the elicitation the transcript's own tool-call id.
   */
  readonly pendingAskToolCallIds: string[];
  /** True while session/load replays history; every update is dropped then. */
  replaying: boolean;
}

export function createDevinEventState(): DevinEventState {
  return { tools: new Map(), pendingAskToolCallIds: [], replaying: false };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function asToolInput(rawInput: unknown): Record<string, unknown> | undefined {
  if (rawInput === undefined) return undefined;
  if (isPlainObject(rawInput)) return rawInput;
  return { rawInput };
}

function flattenContentBlock(block: ContentBlock): string {
  if (block.type === 'text') return block.text;
  return JSON.stringify(block);
}

function flattenToolContent(content: readonly ToolCallContent[] | null | undefined): string {
  if (!content || content.length === 0) return '';
  return content
    .map(item => (item.type === 'content' ? flattenContentBlock(item.content) : JSON.stringify(item)))
    .join('');
}

function toolOutputFromUpdate(update: {
  rawOutput?: unknown;
  content?: readonly ToolCallContent[] | null;
}): string {
  if (update.rawOutput !== undefined) {
    return typeof update.rawOutput === 'string' ? update.rawOutput : JSON.stringify(update.rawOutput);
  }
  return flattenToolContent(update.content);
}

/**
 * Devin reports the tool identity in `_meta`; `name` is absent and `title` is a
 * human sentence. Prefer the machine name, then any declared name, then title.
 */
export function devinToolName(update: {
  name?: string | null;
  title?: string | null;
  _meta?: { [key: string]: unknown } | null;
}): string | undefined {
  const inferred = update._meta?.[INFERENCE_TOOL_NAME_META];
  if (typeof inferred === 'string' && inferred.length > 0) return inferred;
  if (typeof update.name === 'string' && update.name.length > 0) return update.name;
  if (typeof update.title === 'string' && update.title.length > 0) return update.title;
  return undefined;
}

/**
 * Translate one ACP SessionUpdate into zero or more Archon MessageChunks.
 * usage_update never maps: it carries context occupancy and cumulative
 * counters, not this turn's bill.
 */
export function mapDevinSessionUpdate(update: SessionUpdate, state: DevinEventState): MessageChunk[] {
  if (state.replaying) return [];

  switch (update.sessionUpdate) {
    case 'agent_message_chunk': {
      if (update.content.type !== 'text') return [];
      return [{ type: 'assistant', content: update.content.text }];
    }
    case 'agent_thought_chunk': {
      if (update.content.type !== 'text') return [];
      return [{ type: 'thinking', content: update.content.text }];
    }
    case 'tool_call': {
      const name = devinToolName(update) ?? 'unknown';
      const input = asToolInput(update.rawInput);
      state.tools.set(update.toolCallId, { name, ...(input !== undefined ? { input } : {}) });
      if (name === DEVIN_ASK_TOOL_NAME) state.pendingAskToolCallIds.push(update.toolCallId);
      return [
        {
          type: 'tool',
          toolName: name,
          toolCallId: update.toolCallId,
          ...(input !== undefined ? { toolInput: input } : {}),
        },
      ];
    }
    case 'tool_call_update': {
      const stored = state.tools.get(update.toolCallId);
      const name = devinToolName(update) ?? stored?.name ?? 'unknown';
      const input = update.rawInput !== undefined ? asToolInput(update.rawInput) : stored?.input;
      const terminal = update.status === 'completed' || update.status === 'failed';
      if (!terminal) {
        state.tools.set(update.toolCallId, { name, ...(input !== undefined ? { input } : {}) });
        return [];
      }
      state.tools.delete(update.toolCallId);
      return [
        {
          type: 'tool_result',
          toolName: name,
          toolCallId: update.toolCallId,
          toolOutput: toolOutputFromUpdate(update),
          toolOutcome: update.status === 'completed' ? 'success' : 'error',
        },
      ];
    }
    case 'user_message_chunk':
    case 'plan':
    case 'plan_update':
    case 'plan_removed':
    case 'available_commands_update':
    case 'current_mode_update':
    case 'config_option_update':
    case 'session_info_update':
    case 'usage_update':
    case 'compaction_update':
    case 'compaction_summary_chunk':
      return [];
    default: {
      const exhaustive: never = update;
      return exhaustive;
    }
  }
}
```

- [ ] **Step 5: Run the tests and type-check**

Run from `packages/providers`:
```bash
bun test src/community/devin/async-queue.test.ts
bun test src/community/devin/event-bridge.test.ts
bun run type-check
```
Expected: PASS; type-check clean.

- [ ] **Step 6: Commit**

```bash
git add packages/providers/src/community/devin/async-queue.ts packages/providers/src/community/devin/async-queue.test.ts packages/providers/src/community/devin/event-bridge.ts packages/providers/src/community/devin/event-bridge.test.ts
git commit -m "feat(providers): translate devin ACP session updates into message chunks"
```

## Task 4: Elicitation → AskHuman conversion, re-entry prompt, and per-turn usage

**Files:**
- Create: `packages/providers/src/community/devin/elicitation.ts`
- Test: `packages/providers/src/community/devin/elicitation.test.ts`
- Create: `packages/providers/src/community/devin/usage.ts`
- Test: `packages/providers/src/community/devin/usage.test.ts`

**Interfaces:**
- Consumes: `CreateElicitationRequest`, `Usage` types from `@agentclientprotocol/sdk` (type-only); `ResumeInteraction`, `UsageBreakdown` from `../../types`; `DevinProviderError` from `./errors`.
- Produces:
  - `interface DevinAskHumanQuestion { id: string; prompt: string; selection: 'single' | 'multi'; options: string[]; allowOther: boolean }`
  - `elicitationToAskHumanQuestions(request: CreateElicitationRequest): DevinAskHumanQuestion[]` (throws `DevinProviderError('devin_protocol_error')` on unsupported shapes)
  - `buildDevinAskResumePrompt(interactions: readonly ResumeInteraction[]): string`
  - `devinPromptUsageToBreakdown(usage: Usage | null | undefined, model: string | undefined): UsageBreakdown | undefined`

- [ ] **Step 1: Write the failing elicitation tests**

```ts
// packages/providers/src/community/devin/elicitation.test.ts
import { describe, expect, test } from 'bun:test';
import type { CreateElicitationRequest } from '@agentclientprotocol/sdk';

import { buildDevinAskResumePrompt, elicitationToAskHumanQuestions } from './elicitation';
import { DevinProviderError } from './errors';

function form(properties: Record<string, unknown>, meta?: Record<string, unknown>): CreateElicitationRequest {
  return {
    sessionId: 'sess-1',
    mode: 'form',
    message: 'Which color do you prefer?',
    requestedSchema: { type: 'object', properties, required: Object.keys(properties) },
    ...(meta ? { _meta: meta } : {}),
  } as unknown as CreateElicitationRequest;
}

describe('elicitationToAskHumanQuestions', () => {
  test('maps the observed single-select shape', () => {
    const request = form(
      {
        q0: {
          title: 'Color',
          description: 'Which color do you prefer?',
          type: 'string',
          oneOf: [
            { const: 'red', title: 'Choose red.' },
            { const: 'blue', title: 'Choose blue.' },
          ],
        },
      },
      { 'cognition.ai/allowOther': true }
    );
    expect(elicitationToAskHumanQuestions(request)).toEqual([
      {
        id: 'q0',
        prompt: 'Which color do you prefer?',
        selection: 'single',
        options: ['red', 'blue'],
        allowOther: true,
      },
    ]);
  });

  test('maps string enum and array multi-select shapes; allowOther defaults to false', () => {
    const request = form({
      q0: { title: 'Size', type: 'string', enum: ['s', 'm'] },
      q1: { description: 'Toppings', type: 'array', items: { oneOf: [{ const: 'a' }, { const: 'b' }] } },
      q2: { title: 'Extras', type: 'array', items: { enum: ['x'] } },
    });
    expect(elicitationToAskHumanQuestions(request)).toEqual([
      { id: 'q0', prompt: 'Size', selection: 'single', options: ['s', 'm'], allowOther: false },
      { id: 'q1', prompt: 'Toppings', selection: 'multi', options: ['a', 'b'], allowOther: false },
      { id: 'q2', prompt: 'Extras', selection: 'multi', options: ['x'], allowOther: false },
    ]);
  });

  test('falls back to the request message as the prompt', () => {
    const request = form({ q0: { type: 'string', enum: ['yes', 'no'] } });
    expect(elicitationToAskHumanQuestions(request)[0]?.prompt).toBe('Which color do you prefer?');
  });

  test('rejects url mode, non-object schemas, and free-text properties', () => {
    const url = { sessionId: 's', mode: 'url', message: 'm', url: 'https://x' } as unknown as CreateElicitationRequest;
    expect(() => elicitationToAskHumanQuestions(url)).toThrow(DevinProviderError);
    expect(() => elicitationToAskHumanQuestions(form({}))).toThrow(/no questions/);
    expect(() => elicitationToAskHumanQuestions(form({ q0: { type: 'string' } }))).toThrow(
      /property "q0"/
    );
    expect(() => elicitationToAskHumanQuestions(form({ q0: { type: 'number' } }))).toThrow(
      DevinProviderError
    );
  });
});

describe('buildDevinAskResumePrompt', () => {
  test('names each tool call, carries only the answer payload, and forbids re-asking', () => {
    const prompt = buildDevinAskResumePrompt([
      { tool_use_id: 'call_1', payload: [{ questionId: 'q0', value: 'blue' }], declined: false },
      { tool_use_id: 'call_2', payload: 'declined', declined: true },
    ]);
    expect(prompt).toBe(
      'AskHuman call_1 answers:\n[{"questionId":"q0","value":"blue"}]\n\n' +
        'AskHuman call_2 was declined.\n\n' +
        'Continue the task using these answers. Do not call ask_user_question again for these questions.'
    );
  });
});
```

- [ ] **Step 2: Write the failing usage tests**

```ts
// packages/providers/src/community/devin/usage.test.ts
import { describe, expect, test } from 'bun:test';

import { devinPromptUsageToBreakdown } from './usage';

describe('devinPromptUsageToBreakdown', () => {
  test('maps per-turn prompt usage without cost', () => {
    expect(
      devinPromptUsageToBreakdown(
        { totalTokens: 60136, inputTokens: 60068, outputTokens: 68, cachedReadTokens: 59951, cachedWriteTokens: 114 },
        'claude-opus-5-low'
      )
    ).toEqual([
      {
        provider: 'devin',
        model: 'claude-opus-5-low',
        modelSource: 'reported',
        inputTokens: 60068,
        outputTokens: 68,
        cacheReadTokens: 59951,
        cacheWriteTokens: 114,
      },
    ]);
  });

  test('omits absent cache and reasoning fields and marks unknown model', () => {
    expect(
      devinPromptUsageToBreakdown({ totalTokens: 10, inputTokens: 8, outputTokens: 2 }, undefined)
    ).toEqual([{ provider: 'devin', model: null, modelSource: 'unknown', inputTokens: 8, outputTokens: 2 }]);
    expect(
      devinPromptUsageToBreakdown(
        { totalTokens: 12, inputTokens: 8, outputTokens: 2, thoughtTokens: 2, cachedReadTokens: null },
        'm'
      )?.[0]
    ).toMatchObject({ reasoningTokens: 2 });
  });

  test('returns undefined when the response carried no usage', () => {
    expect(devinPromptUsageToBreakdown(undefined, 'm')).toBeUndefined();
    expect(devinPromptUsageToBreakdown(null, 'm')).toBeUndefined();
  });
});
```

- [ ] **Step 3: Run both tests to verify they fail**

Run from `packages/providers`:
```bash
bun test src/community/devin/elicitation.test.ts
bun test src/community/devin/usage.test.ts
```
Expected: FAIL — modules not found.

- [ ] **Step 4: Implement the elicitation converter and re-entry prompt**

```ts
// packages/providers/src/community/devin/elicitation.ts
import type { CreateElicitationRequest } from '@agentclientprotocol/sdk';

import type { ResumeInteraction } from '../../types';
import { DEVIN_ASK_TOOL_NAME } from './event-bridge';
import { DevinProviderError } from './errors';

const ALLOW_OTHER_META = 'cognition.ai/allowOther';

export interface DevinAskHumanQuestion {
  id: string;
  prompt: string;
  selection: 'single' | 'multi';
  options: string[];
  allowOther: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function protocolError(message: string): never {
  throw new DevinProviderError('devin_protocol_error', message);
}

/** Option labels from `oneOf: [{ const }]` or `enum: []`; undefined when neither exists. */
function optionLabels(node: Record<string, unknown>): string[] | undefined {
  if (Array.isArray(node.oneOf)) {
    const labels = node.oneOf.map(entry => (isRecord(entry) ? entry.const : undefined));
    if (labels.every((label): label is string => typeof label === 'string')) return labels;
    return undefined;
  }
  if (Array.isArray(node.enum) && node.enum.every((v): v is string => typeof v === 'string')) {
    return [...node.enum];
  }
  return undefined;
}

function questionPrompt(node: Record<string, unknown>, fallback: string): string {
  if (typeof node.description === 'string' && node.description.length > 0) return node.description;
  if (typeof node.title === 'string' && node.title.length > 0) return node.title;
  return fallback;
}

/**
 * Convert a Devin form elicitation into Archon AskHuman questions. Only
 * choice-shaped properties are accepted: a free-text or numeric field has no
 * AskHuman equivalent, and inventing one would answer a question Devin never
 * asked in that form.
 */
export function elicitationToAskHumanQuestions(
  request: CreateElicitationRequest
): DevinAskHumanQuestion[] {
  if (request.mode !== 'form') {
    protocolError(`Devin elicitation mode "${String(request.mode)}" is not supported; only form questions map to AskHuman.`);
  }
  const schema = (request as { requestedSchema?: unknown }).requestedSchema;
  if (!isRecord(schema) || !isRecord(schema.properties)) {
    protocolError('Devin elicitation carried no object schema.');
  }
  const entries = Object.entries(schema.properties);
  if (entries.length === 0) protocolError('Devin elicitation carried no questions.');

  const allowOther = request._meta?.[ALLOW_OTHER_META] === true;
  return entries.map(([id, node]) => {
    if (!isRecord(node)) protocolError(`Devin elicitation property "${id}" is not an object.`);
    if (node.type === 'string') {
      const options = optionLabels(node);
      if (options === undefined) {
        protocolError(`Devin elicitation property "${id}" is free text; AskHuman needs options.`);
      }
      return { id, prompt: questionPrompt(node, request.message), selection: 'single', options, allowOther };
    }
    if (node.type === 'array') {
      const items = isRecord(node.items) ? node.items : {};
      const options = optionLabels(items);
      if (options === undefined) {
        protocolError(`Devin elicitation property "${id}" is an array without options.`);
      }
      return { id, prompt: questionPrompt(node, request.message), selection: 'multi', options, allowOther };
    }
    return protocolError(`Devin elicitation property "${id}" has unsupported type "${String(node.type)}".`);
  });
}

/**
 * The one user message a re-entry turn sends. The original prompt is already in
 * the loaded session, so this carries only the validated answers.
 */
export function buildDevinAskResumePrompt(interactions: readonly ResumeInteraction[]): string {
  const blocks = interactions.map(interaction =>
    interaction.declined
      ? `AskHuman ${interaction.tool_use_id} was declined.`
      : `AskHuman ${interaction.tool_use_id} answers:\n${JSON.stringify(interaction.payload)}`
  );
  return (
    blocks.join('\n\n') +
    `\n\nContinue the task using these answers. Do not call ${DEVIN_ASK_TOOL_NAME} again for these questions.`
  );
}
```

- [ ] **Step 5: Implement the usage mapper**

```ts
// packages/providers/src/community/devin/usage.ts
import type { Usage } from '@agentclientprotocol/sdk';

import type { ModelUsageEntry, UsageBreakdown } from '../../types';

/**
 * Map ACP PromptResponse.usage (per prompt turn) to one usage row. Cost is
 * never derived: Devin bills in ACUs through its own account, not per token.
 */
export function devinPromptUsageToBreakdown(
  usage: Usage | null | undefined,
  model: string | undefined
): UsageBreakdown | undefined {
  if (usage === null || usage === undefined) return undefined;
  const entry: ModelUsageEntry = {
    provider: 'devin',
    model: model ?? null,
    modelSource: model !== undefined ? 'reported' : 'unknown',
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
  };
  if (typeof usage.thoughtTokens === 'number') entry.reasoningTokens = usage.thoughtTokens;
  if (typeof usage.cachedReadTokens === 'number') entry.cacheReadTokens = usage.cachedReadTokens;
  if (typeof usage.cachedWriteTokens === 'number') entry.cacheWriteTokens = usage.cachedWriteTokens;
  return [entry];
}
```

- [ ] **Step 6: Run the tests and type-check**

Run from `packages/providers`:
```bash
bun test src/community/devin/elicitation.test.ts
bun test src/community/devin/usage.test.ts
bun run type-check
```
Expected: PASS; type-check clean. If `ModelUsageEntry` fields are `readonly`, build the object literal in one expression with conditional spreads instead of assignments.

- [ ] **Step 7: Commit**

```bash
git add packages/providers/src/community/devin/elicitation.ts packages/providers/src/community/devin/elicitation.test.ts packages/providers/src/community/devin/usage.ts packages/providers/src/community/devin/usage.test.ts
git commit -m "feat(providers): map devin elicitation to AskHuman and prompt usage to breakdown"
```

## Task 5: ACP client — lifecycle, elicitation, permission blocking, cancellation, reaping

**Files:**
- Create: `packages/providers/src/community/devin/acp-client.ts`
- Test: `packages/providers/src/community/devin/acp-client.test.ts`

**Interfaces:**
- Consumes: `client`, `methods`, `ndJsonStream`, `PROTOCOL_VERSION` (values) and `AgentApp`, `ClientContext`, `CreateElicitationRequest`, `InitializeResponse`, `PromptResponse`, `SendRequestOptions`, `SessionConfigOption`, `SessionModeState`, `Stream` (types) from `@agentclientprotocol/sdk`; `AsyncQueue`; `createDevinEventState`, `mapDevinSessionUpdate`; `elicitationToAskHumanQuestions`, `buildDevinAskResumePrompt`; `devinPromptUsageToBreakdown`; `classifyDevinAcpError`, `DevinProviderError`, `isAskHumanControlError`, redaction helpers; `augmentPromptForJsonSchema`, `tryParseStructuredOutput` from `../../shared/structured-output`; `MessageChunk`, `NativeTool`, `ResumeInteraction`, `AskHumanControlError` from `../../types`.
- Produces:
  - `interface DevinAcpTurnInput { cwd; prompt; resumeSessionId?; model?; outputSchema?; abortSignal?; askHuman?: NativeTool; resumeInteractions?: readonly ResumeInteraction[] }`
  - `interface DevinProcessInput extends DevinAcpTurnInput { binaryPath: string; spawnArgs: string[]; env: Record<string, string>; secretValues?: readonly string[] }`
  - `interface DevinProcessDependencies { spawn?: typeof spawn; terminateGraceMs?: number }`
  - `driveDevinAcpTurn(target: Stream | AgentApp, input: DevinAcpTurnInput): AsyncGenerator<MessageChunk>` — throws AskHuman control errors as-is.
  - `runDevinAcpTurn(input: DevinProcessInput, deps?: DevinProcessDependencies): AsyncGenerator<MessageChunk>`

- [ ] **Step 1: Write the failing fake-agent tests**

```ts
// packages/providers/src/community/devin/acp-client.test.ts
import { describe, expect, test } from 'bun:test';
import { EventEmitter } from 'node:events';
import { PassThrough, Readable, Writable } from 'node:stream';
import type { ChildProcess } from 'node:child_process';
import {
  agent,
  methods,
  ndJsonStream,
  PROTOCOL_VERSION,
  RequestError,
  type AgentApp,
  type CreateElicitationRequest,
  type InitializeRequest,
  type InitializeResponse,
  type SessionUpdate,
} from '@agentclientprotocol/sdk';

import { AskHumanAwaitingError, type MessageChunk, type NativeTool } from '../../types';
import { driveDevinAcpTurn, runDevinAcpTurn, type DevinProcessInput } from './acp-client';
import { DevinProviderError } from './errors';

interface RecordedCall {
  method: string;
  params: unknown;
}

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
}

function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(r => {
    resolve = r;
  });
  return { promise, resolve };
}

function defaultInitialize(): InitializeResponse {
  return {
    protocolVersion: PROTOCOL_VERSION,
    agentCapabilities: { loadSession: true, mcpCapabilities: { http: false, sse: false } },
    authMethods: [{ id: 'devin-browser', name: 'Log in with browser' }],
  };
}

const DEFAULT_MODES = {
  currentModeId: 'accept-edits',
  availableModes: [
    { id: 'accept-edits', name: 'Code' },
    { id: 'bypass', name: 'Bypass Permissions' },
  ],
};

const MODEL_OPTION = {
  id: 'model',
  name: 'Model',
  category: 'model',
  type: 'select' as const,
  currentValue: 'fusion-default',
  options: [
    { value: 'fusion-default', name: 'Fusion' },
    { value: 'claude-opus-5-low', name: 'Claude Opus 5 Low' },
  ],
};

function askElicitation(sessionId: string): CreateElicitationRequest {
  return {
    sessionId,
    mode: 'form',
    message: 'Which color do you prefer?',
    requestedSchema: {
      type: 'object',
      properties: {
        q0: { title: 'Color', description: 'Which color do you prefer?', type: 'string', oneOf: [{ const: 'red' }, { const: 'blue' }] },
      },
      required: ['q0'],
    },
    _meta: { 'cognition.ai/allowOther': true },
  } as unknown as CreateElicitationRequest;
}

interface FakeDevin {
  app: AgentApp;
  calls: RecordedCall[];
  methodsCalled: () => string[];
  permissionResponses: unknown[];
  elicitationResponses: unknown[];
  cancelled: Deferred<void>;
}

function createFakeDevin(options?: {
  sessionId?: string;
  initialize?: (params: InitializeRequest) => InitializeResponse;
  loadError?: Error;
  modes?: { currentModeId: string; availableModes: { id: string; name: string }[] };
  newHold?: Deferred<void>;
  setModeError?: Error;
  replayUpdates?: SessionUpdate[];
  modelValueApplied?: string;
  modelError?: Error;
  promptUpdates?: SessionUpdate[];
  promptText?: string;
  promptHold?: Deferred<void>;
  requestPermission?: boolean;
  elicitAfterToolCall?: boolean;
  onPromptSettled?: () => void;
}): FakeDevin {
  const calls: RecordedCall[] = [];
  const permissionResponses: unknown[] = [];
  const elicitationResponses: unknown[] = [];
  const cancelled = createDeferred<void>();
  const sessionId = options?.sessionId ?? 'sess-new-1';
  let currentModel = MODEL_OPTION.currentValue;

  const app = agent({ name: 'fake-devin' })
    .onRequest(methods.agent.initialize, c => {
      calls.push({ method: methods.agent.initialize, params: c.params });
      return options?.initialize ? options.initialize(c.params) : defaultInitialize();
    })
    .onRequest(methods.agent.session.new, async c => {
      calls.push({ method: methods.agent.session.new, params: c.params });
      if (options?.newHold !== undefined) await options.newHold.promise;
      return { sessionId, modes: options?.modes ?? DEFAULT_MODES, configOptions: [MODEL_OPTION] };
    })
    .onRequest(methods.agent.session.setMode, c => {
      calls.push({ method: methods.agent.session.setMode, params: c.params });
      if (options?.setModeError) throw options.setModeError;
      return {};
    })
    .onRequest(methods.agent.session.load, async c => {
      calls.push({ method: methods.agent.session.load, params: c.params });
      if (options?.loadError) throw options.loadError;
      for (const update of options?.replayUpdates ?? []) {
        await c.client.notify(methods.client.session.update, { sessionId: c.params.sessionId, update });
      }
      return { modes: options?.modes ?? DEFAULT_MODES, configOptions: [MODEL_OPTION] };
    })
    .onRequest(methods.agent.session.setConfigOption, c => {
      calls.push({ method: methods.agent.session.setConfigOption, params: c.params });
      if (options?.modelError) throw options.modelError;
      currentModel = options?.modelValueApplied ?? String((c.params as { value: unknown }).value);
      return { configOptions: [{ ...MODEL_OPTION, currentValue: currentModel }] };
    })
    .onRequest(methods.agent.session.prompt, async c => {
      calls.push({ method: methods.agent.session.prompt, params: c.params });
      const sid = c.params.sessionId;
      if (options?.requestPermission) {
        permissionResponses.push(
          await c.client.request(methods.client.session.requestPermission, {
            sessionId: sid,
            toolCall: { toolCallId: 'perm-1', title: 'Delete the repository' },
            options: [{ optionId: 'allow', name: 'Allow', kind: 'allow_once' }],
          })
        );
        await cancelled.promise;
        return { stopReason: 'cancelled' as const };
      }
      for (const update of options?.promptUpdates ?? []) {
        await c.client.notify(methods.client.session.update, { sessionId: sid, update });
      }
      if (options?.elicitAfterToolCall) {
        await c.client.notify(methods.client.session.update, {
          sessionId: sid,
          update: {
            sessionUpdate: 'tool_call',
            toolCallId: 'call_ask_1',
            title: 'Asked user Which color do you prefer?',
            rawInput: { questions: [] },
            _meta: { 'cognition.ai/inferenceToolName': 'ask_user_question' },
          } as SessionUpdate,
        });
        elicitationResponses.push(
          await c.client.request(methods.client.elicitation.create, askElicitation(sid))
        );
        await cancelled.promise;
        await c.client.notify(methods.client.session.update, {
          sessionId: sid,
          update: {
            sessionUpdate: 'tool_call_update',
            toolCallId: 'call_ask_1',
            status: 'failed',
            content: [{ type: 'content', content: { type: 'text', text: 'Canceled due to user interrupt' } }],
          } as SessionUpdate,
        });
        return { stopReason: 'cancelled' as const };
      }
      if (options?.promptText !== undefined) {
        await c.client.notify(methods.client.session.update, {
          sessionId: sid,
          update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: options.promptText } },
        });
      }
      if (options?.promptHold !== undefined) {
        await Promise.race([options.promptHold.promise, cancelled.promise]);
      }
      options?.onPromptSettled?.();
      return {
        stopReason: 'end_turn' as const,
        usage: { totalTokens: 10, inputTokens: 8, outputTokens: 2, cachedReadTokens: 5 },
      };
    })
    .onNotification(methods.agent.session.cancel, c => {
      calls.push({ method: methods.agent.session.cancel, params: c.params });
      cancelled.resolve();
    });

  return {
    app,
    calls,
    methodsCalled: () => calls.map(call => call.method),
    permissionResponses,
    elicitationResponses,
    cancelled,
  };
}

async function collect(stream: AsyncGenerator<MessageChunk>): Promise<MessageChunk[]> {
  const chunks: MessageChunk[] = [];
  for await (const chunk of stream) chunks.push(chunk);
  return chunks;
}

function baseInput(overrides: Partial<Parameters<typeof driveDevinAcpTurn>[1]> = {}) {
  return { cwd: '/repo', prompt: 'hello', ...overrides };
}

function askTool(handler: NativeTool['handler']): NativeTool {
  return { name: 'AskHuman', description: 'ask', inputSchema: { type: 'object' }, handler };
}

describe('driveDevinAcpTurn — fresh turn', () => {
  test('initializes without elicitation, creates a session, streams text, and reports usage + model', async () => {
    const fake = createFakeDevin({ promptText: 'PONG' });
    const chunks = await collect(driveDevinAcpTurn(fake.app, baseInput()));
    expect(fake.methodsCalled()).toEqual(['initialize', 'session/new', 'session/set_mode', 'session/prompt']);
    const init = fake.calls[0]?.params as InitializeRequest;
    expect(init.clientCapabilities).toEqual({});
    expect(chunks).toEqual([
      { type: 'assistant', content: 'PONG' },
      {
        type: 'result',
        sessionId: 'sess-new-1',
        stopReason: 'end_turn',
        resolvedModel: { id: 'fusion-default' },
        usageBreakdown: [
          { provider: 'devin', model: 'fusion-default', modelSource: 'reported', inputTokens: 8, outputTokens: 2, cacheReadTokens: 5 },
        ],
      },
    ]);
  });

  test('never sends session/close or --model; applies the model through set_config_option', async () => {
    const fake = createFakeDevin({ promptText: 'ok' });
    const chunks = await collect(driveDevinAcpTurn(fake.app, baseInput({ model: 'claude-opus-5-low' })));
    expect(fake.methodsCalled()).toEqual(['initialize', 'session/new', 'session/set_mode', 'session/set_config_option', 'session/prompt']);
    expect(fake.calls[3]?.params).toEqual({ sessionId: 'sess-new-1', configId: 'model', value: 'claude-opus-5-low' });
    const result = chunks.at(-1);
    expect(result).toMatchObject({ type: 'result', resolvedModel: { id: 'claude-opus-5-low' } });
  });

  test('an unknown model fails with Devin reason before any prompt is sent', async () => {
    const fake = createFakeDevin({
      modelError: Object.assign(new RequestError(-32002, 'Resource not found'), {
        data: { uri: 'Model not found: opus. Available models: claude-opus-5-low' },
      }),
    });
    await expect(collect(driveDevinAcpTurn(fake.app, baseInput({ model: 'opus' })))).rejects.toMatchObject({
      subtype: 'devin_unsupported_model',
      message: 'Model not found: opus. Available models: claude-opus-5-low',
    });
    expect(fake.methodsCalled()).not.toContain('session/prompt');
  });

  test('fails on protocol mismatch and on a missing loadSession capability', async () => {
    const mismatch = createFakeDevin({ initialize: () => ({ ...defaultInitialize(), protocolVersion: 999 }) });
    await expect(collect(driveDevinAcpTurn(mismatch.app, baseInput()))).rejects.toMatchObject({
      subtype: 'devin_protocol_error',
    });
    const noLoad = createFakeDevin({
      initialize: () => ({ ...defaultInitialize(), agentCapabilities: { loadSession: false } }),
    });
    await expect(collect(driveDevinAcpTurn(noLoad.app, baseInput()))).rejects.toMatchObject({
      subtype: 'devin_protocol_error',
      message: expect.stringContaining('loadSession'),
    });
  });

  test('switches a new session to bypass mode right after session/new', async () => {
    const fake = createFakeDevin({ promptText: 'x' });
    await collect(driveDevinAcpTurn(fake.app, baseInput()));
    expect(fake.calls[2]).toEqual({ method: 'session/set_mode', params: { sessionId: 'sess-new-1', modeId: 'bypass' } });
  });

  test('skips set_mode when the session already reports bypass', async () => {
    const fake = createFakeDevin({
      promptText: 'x',
      modes: { currentModeId: 'bypass', availableModes: DEFAULT_MODES.availableModes },
    });
    await collect(driveDevinAcpTurn(fake.app, baseInput()));
    expect(fake.methodsCalled()).toEqual(['initialize', 'session/new', 'session/prompt']);
  });

  test('fails before the prompt when bypass is not an available mode', async () => {
    const fake = createFakeDevin({
      modes: { currentModeId: 'accept-edits', availableModes: [{ id: 'accept-edits', name: 'Code' }] },
    });
    await expect(collect(driveDevinAcpTurn(fake.app, baseInput()))).rejects.toMatchObject({
      subtype: 'devin_protocol_error',
      message: expect.stringContaining('bypass'),
    });
    expect(fake.methodsCalled()).not.toContain('session/prompt');
  });

  test('a session/new that never answers fails within the setup timeout', async () => {
    const previous = process.env.DEVIN_ACP_SETUP_TIMEOUT_MS;
    process.env.DEVIN_ACP_SETUP_TIMEOUT_MS = '50';
    try {
      const fake = createFakeDevin({ newHold: createDeferred<void>() });
      await expect(collect(driveDevinAcpTurn(fake.app, baseInput()))).rejects.toMatchObject({
        subtype: 'devin_protocol_error',
        message: expect.stringContaining('did not answer within'),
      });
    } finally {
      if (previous === undefined) delete process.env.DEVIN_ACP_SETUP_TIMEOUT_MS;
      else process.env.DEVIN_ACP_SETUP_TIMEOUT_MS = previous;
    }
  });

  test('augments the prompt for structured output and parses the transcript', async () => {
    const fake = createFakeDevin({ promptText: '{"ok":true}' });
    const chunks = await collect(
      driveDevinAcpTurn(fake.app, baseInput({ outputSchema: { type: 'object', properties: { ok: { type: 'boolean' } } } }))
    );
    const prompt = (fake.calls.find(c => c.method === 'session/prompt')?.params as { prompt: { text: string }[] }).prompt[0]?.text;
    expect(prompt).toContain('CRITICAL: Respond with ONLY a JSON object');
    expect(chunks.at(-1)).toMatchObject({ type: 'result', structuredOutput: { ok: true } });
  });

  test('a not-logged-in agent fails session/new with devin_not_logged_in', async () => {
    const fake = createFakeDevin();
    const app = agent({ name: 'auth-required' })
      .onRequest(methods.agent.initialize, () => defaultInitialize())
      .onRequest(methods.agent.session.new, () => {
        throw RequestError.authRequired();
      });
    void fake;
    await expect(collect(driveDevinAcpTurn(app, baseInput()))).rejects.toMatchObject({
      subtype: 'devin_not_logged_in',
    });
  });
});

describe('driveDevinAcpTurn — session load', () => {
  test('loads the stored session, suppresses replayed history, and streams only new events', async () => {
    const fake = createFakeDevin({
      sessionId: 'sess-old',
      replayUpdates: [
        { sessionUpdate: 'user_message_chunk', content: { type: 'text', text: 'old prompt' } },
        { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'old answer' } },
        { sessionUpdate: 'tool_call', toolCallId: 'old-1', title: 'Read file' } as SessionUpdate,
      ],
      promptText: 'new answer',
    });
    const chunks = await collect(driveDevinAcpTurn(fake.app, baseInput({ resumeSessionId: 'sess-old' })));
    expect(fake.methodsCalled()).toEqual(['initialize', 'session/load', 'session/set_mode', 'session/prompt']);
    expect(fake.calls[1]?.params).toEqual({ sessionId: 'sess-old', cwd: '/repo', mcpServers: [] });
    expect(chunks).toEqual([
      { type: 'assistant', content: 'new answer' },
      expect.objectContaining({ type: 'result', sessionId: 'sess-old' }),
    ]);
  });

  test('a failed load is terminal and never creates a new session', async () => {
    const fake = createFakeDevin({
      loadError: Object.assign(new RequestError(-32016, 'Session not found'), {
        data: { 'cognition.ai/errorKind': 'session_not_found' },
      }),
    });
    await expect(collect(driveDevinAcpTurn(fake.app, baseInput({ resumeSessionId: 'gone' })))).rejects.toMatchObject({
      subtype: 'devin_session_load_failed',
    });
    expect(fake.methodsCalled()).toEqual(['initialize', 'session/load']);
  });

  test('an AskHuman re-entry sends only the answer message into the loaded session', async () => {
    const fake = createFakeDevin({ sessionId: 'sess-old', promptText: 'CHOSEN=blue' });
    const chunks = await collect(
      driveDevinAcpTurn(
        fake.app,
        baseInput({
          prompt: 'original node prompt',
          resumeSessionId: 'sess-old',
          askHuman: askTool(async () => 'unused'),
          resumeInteractions: [{ tool_use_id: 'call_ask_1', payload: [{ questionId: 'q0', value: 'blue' }], declined: false }],
        })
      )
    );
    const promptParams = fake.calls.find(c => c.method === 'session/prompt')?.params as { prompt: { text: string }[] };
    expect(promptParams.prompt[0]?.text).toBe(
      'AskHuman call_ask_1 answers:\n[{"questionId":"q0","value":"blue"}]\n\nContinue the task using these answers. Do not call ask_user_question again for these questions.'
    );
    expect(promptParams.prompt[0]?.text).not.toContain('original node prompt');
    expect(chunks[0]).toEqual({ type: 'assistant', content: 'CHOSEN=blue' });
  });
});

describe('driveDevinAcpTurn — AskHuman pause', () => {
  test('advertises elicitation only when AskHuman is supplied', async () => {
    const fake = createFakeDevin({ promptText: 'x' });
    await collect(driveDevinAcpTurn(fake.app, baseInput({ askHuman: askTool(async () => 'ok') })));
    const init = fake.calls[0]?.params as InitializeRequest;
    expect(init.clientCapabilities).toEqual({ elicitation: { form: {} } });
  });

  test('pauses: calls the handler with the tool-call id, cancels the turn, rethrows the control error', async () => {
    const fake = createFakeDevin({ elicitAfterToolCall: true });
    const seen: { input: unknown; context: unknown }[] = [];
    const awaiting = new AskHumanAwaitingError('call_ask_1', 'node-1', 'run-1');
    const handler: NativeTool['handler'] = async (input, context) => {
      seen.push({ input, context });
      throw awaiting;
    };
    const gen = driveDevinAcpTurn(fake.app, baseInput({ askHuman: askTool(handler) }));
    const chunks: MessageChunk[] = [];
    let thrown: unknown;
    try {
      for await (const chunk of gen) chunks.push(chunk);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBe(awaiting);
    expect(seen).toEqual([
      {
        input: { questions: [{ id: 'q0', prompt: 'Which color do you prefer?', selection: 'single', options: ['red', 'blue'], allowOther: true }] },
        context: { toolUseId: 'call_ask_1', sessionId: 'sess-new-1' },
      },
    ]);
    expect(fake.elicitationResponses).toEqual([{ action: 'cancel' }]);
    expect(fake.methodsCalled()).toContain('session/cancel');
    expect(chunks.map(c => c.type)).toEqual(['tool', 'tool_result']);
    expect(chunks.some(c => c.type === 'result')).toBe(false);
  });

  test('a handler failure is terminal, not a pause, and never reads as a successful answer', async () => {
    const fake = createFakeDevin({ elicitAfterToolCall: true });
    await expect(
      collect(driveDevinAcpTurn(fake.app, baseInput({ askHuman: askTool(async () => { throw new Error('db down'); }) })))
    ).rejects.toMatchObject({ subtype: 'devin_protocol_error', message: expect.stringContaining('db down') });
    expect(fake.elicitationResponses).toEqual([{ action: 'cancel' }]);
  });

  test('an elicitation without AskHuman is cancelled and fails the turn', async () => {
    const fake = createFakeDevin({ elicitAfterToolCall: true });
    await expect(collect(driveDevinAcpTurn(fake.app, baseInput()))).rejects.toMatchObject({
      subtype: 'devin_protocol_error',
      message: expect.stringContaining('elicitation'),
    });
  });
});

describe('driveDevinAcpTurn — permission and abort', () => {
  test('a permission request is cancelled and ends the turn naming the blocked action', async () => {
    const fake = createFakeDevin({ requestPermission: true });
    await expect(collect(driveDevinAcpTurn(fake.app, baseInput()))).rejects.toMatchObject({
      subtype: 'devin_permission_blocked',
      message: expect.stringContaining('Delete the repository'),
    });
    expect(fake.permissionResponses).toEqual([{ outcome: { outcome: 'cancelled' } }]);
    expect(fake.methodsCalled()).toContain('session/cancel');
  });

  test('abort during the prompt sends session/cancel and yields an aborted result', async () => {
    const hold = createDeferred<void>();
    const abort = new AbortController();
    const fake = createFakeDevin({ promptHold: hold, promptText: 'partial' });
    const gen = driveDevinAcpTurn(fake.app, baseInput({ abortSignal: abort.signal }));
    const first = await gen.next();
    expect(first.value).toEqual({ type: 'assistant', content: 'partial' });
    abort.abort();
    const rest: MessageChunk[] = [];
    for await (const chunk of gen) rest.push(chunk);
    expect(rest).toEqual([{ type: 'result', sessionId: 'sess-new-1', stopReason: 'aborted', isError: true, errorSubtype: 'devin_aborted' }]);
    expect(fake.methodsCalled()).toContain('session/cancel');
  });

  test('a pre-aborted signal skips the prompt', async () => {
    const abort = new AbortController();
    abort.abort();
    const fake = createFakeDevin({ promptText: 'never' });
    const chunks = await collect(driveDevinAcpTurn(fake.app, baseInput({ abortSignal: abort.signal })));
    expect(chunks).toEqual([{ type: 'result', sessionId: 'sess-new-1', stopReason: 'aborted', isError: true, errorSubtype: 'devin_aborted' }]);
    expect(fake.methodsCalled()).not.toContain('session/prompt');
  });
});

class FakeChild extends EventEmitter {
  readonly stdin = new PassThrough();
  readonly stdout = new PassThrough();
  readonly stderr = new PassThrough();
  readonly pid = 4242;
  exitCode: number | null = null;
  signalCode: NodeJS.Signals | null = null;
  killed = false;
  readonly signals: Array<NodeJS.Signals | number | undefined> = [];
  ignoreTerm = false;

  kill(signal?: NodeJS.Signals | number): boolean {
    this.signals.push(signal);
    this.killed = true;
    const name = signal ?? 'SIGTERM';
    if (name === 'SIGTERM' && this.ignoreTerm) return true;
    if (this.exitCode !== null || this.signalCode !== null) return true;
    const sig = typeof name === 'string' ? name : 'SIGTERM';
    queueMicrotask(() => {
      if (this.exitCode !== null || this.signalCode !== null) return;
      this.signalCode = sig as NodeJS.Signals;
      this.emit('exit', null, sig);
    });
    return true;
  }

  crash(code: number, stderrText?: string): void {
    if (stderrText !== undefined) this.stderr.write(stderrText);
    this.exitCode = code;
    this.stdin.destroy();
    this.stdout.destroy();
    this.emit('exit', code, null);
  }
}

function attachAgent(child: FakeChild, fake: FakeDevin): void {
  const stream = ndJsonStream(
    Writable.toWeb(child.stdout) as WritableStream<Uint8Array>,
    Readable.toWeb(child.stdin) as ReadableStream<Uint8Array>
  );
  fake.app.connect(stream);
}

function processInput(overrides: Partial<DevinProcessInput> = {}): DevinProcessInput {
  return {
    cwd: '/repo',
    prompt: 'hello',
    binaryPath: '/usr/local/bin/devin',
    spawnArgs: ['--permission-mode', 'yolo', 'acp'],
    env: { PATH: '/usr/bin', DEVIN_API_TOKEN: 'tok-secret-1234' },
    ...overrides,
  };
}

describe('runDevinAcpTurn — process wrapper', () => {
  test('spawns the binary with cwd, args, and env, streams the turn, and reaps the child', async () => {
    const fake = createFakeDevin({ promptText: 'PONG' });
    const child = new FakeChild();
    const spawnCalls: unknown[] = [];
    const spawnImpl = ((command: string, args: string[], options: unknown) => {
      spawnCalls.push({ command, args, options });
      attachAgent(child, fake);
      return child as unknown as ChildProcess;
    }) as unknown as typeof import('node:child_process').spawn;
    const chunks = await collect(runDevinAcpTurn(processInput(), { spawn: spawnImpl, terminateGraceMs: 0 }));
    expect(spawnCalls).toEqual([
      {
        command: '/usr/local/bin/devin',
        args: ['--permission-mode', 'yolo', 'acp'],
        options: { cwd: '/repo', env: { PATH: '/usr/bin', DEVIN_API_TOKEN: 'tok-secret-1234' }, stdio: ['pipe', 'pipe', 'pipe'] },
      },
    ]);
    expect(chunks[0]).toEqual({ type: 'assistant', content: 'PONG' });
    expect(child.signals).toContain('SIGTERM');
  });

  test('a child that dies mid-turn fails with devin_child_exited and redacted stderr', async () => {
    const fake = createFakeDevin({ promptHold: createDeferred<void>() });
    const child = new FakeChild();
    const spawnImpl = (() => {
      attachAgent(child, fake);
      queueMicrotask(() => child.crash(1, 'fatal: token tok-secret-1234 rejected'));
      return child as unknown as ChildProcess;
    }) as unknown as typeof import('node:child_process').spawn;
    let thrown: unknown;
    try {
      await collect(runDevinAcpTurn(processInput(), { spawn: spawnImpl, terminateGraceMs: 0 }));
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(DevinProviderError);
    expect((thrown as DevinProviderError).subtype).toBe('devin_child_exited');
    expect((thrown as Error).message).toContain('[REDACTED]');
    expect((thrown as Error).message).not.toContain('tok-secret-1234');
  });

  test('a spawn failure maps to devin_spawn_failed', async () => {
    const spawnImpl = (() => {
      throw new Error('ENOENT');
    }) as unknown as typeof import('node:child_process').spawn;
    await expect(collect(runDevinAcpTurn(processInput(), { spawn: spawnImpl }))).rejects.toMatchObject({
      subtype: 'devin_spawn_failed',
    });
  });

  test('AskHuman control errors pass through the wrapper untouched', async () => {
    const fake = createFakeDevin({ elicitAfterToolCall: true });
    const child = new FakeChild();
    const spawnImpl = (() => {
      attachAgent(child, fake);
      return child as unknown as ChildProcess;
    }) as unknown as typeof import('node:child_process').spawn;
    const awaiting = new AskHumanAwaitingError('call_ask_1', 'n', 'r');
    let thrown: unknown;
    try {
      await collect(
        runDevinAcpTurn(processInput({ askHuman: askTool(async () => { throw awaiting; }) }), { spawn: spawnImpl, terminateGraceMs: 0 })
      );
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBe(awaiting);
    expect(child.signals).toContain('SIGTERM');
  });

  test('escalates to SIGKILL when the child ignores SIGTERM', async () => {
    const fake = createFakeDevin({ promptText: 'x' });
    const child = new FakeChild();
    child.ignoreTerm = true;
    const spawnImpl = (() => {
      attachAgent(child, fake);
      return child as unknown as ChildProcess;
    }) as unknown as typeof import('node:child_process').spawn;
    await collect(runDevinAcpTurn(processInput(), { spawn: spawnImpl, terminateGraceMs: 5 }));
    expect(child.signals).toEqual(['SIGTERM', 'SIGKILL']);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run from `packages/providers`: `bun test src/community/devin/acp-client.test.ts`
Expected: FAIL — `Cannot find module './acp-client'`.

- [ ] **Step 3: Implement the ACP client**

```ts
// packages/providers/src/community/devin/acp-client.ts
import { spawn, type ChildProcess } from 'node:child_process';
import { Readable, Writable } from 'node:stream';

import {
  client,
  methods,
  ndJsonStream,
  PROTOCOL_VERSION,
  type AgentApp,
  type ClientCapabilities,
  type ClientContext,
  type CreateElicitationRequest,
  type InitializeResponse,
  type PromptResponse,
  type SendRequestOptions,
  type SessionConfigOption,
  type SessionModeState,
  type Stream,
} from '@agentclientprotocol/sdk';

import { augmentPromptForJsonSchema, tryParseStructuredOutput } from '../../shared/structured-output';
import type { AskHumanControlError, MessageChunk, NativeTool, ResumeInteraction } from '../../types';
import { AsyncQueue } from './async-queue';
import { buildDevinAskResumePrompt, elicitationToAskHumanQuestions } from './elicitation';
import { createDevinEventState, mapDevinSessionUpdate } from './event-bridge';
import {
  classifyDevinAcpError,
  collectDevinSecretValues,
  DevinProviderError,
  isAskHumanControlError,
  isRedactableSecretValue,
  redactDevinSecrets,
} from './errors';
import { devinPromptUsageToBreakdown } from './usage';

const STDERR_CAP = 4096;
const DEFAULT_TERMINATE_GRACE_MS = 2000;
const DEFAULT_SETUP_TIMEOUT_MS = 60_000;
/** Devin's ACP session mode that auto-approves its own tool calls — the ACP-side meaning of `yolo`. */
const DEVIN_SESSION_MODE = 'bypass';

export interface DevinAcpTurnInput {
  cwd: string;
  prompt: string;
  resumeSessionId?: string;
  model?: string;
  outputSchema?: Record<string, unknown>;
  abortSignal?: AbortSignal;
  /** Archon's AskHuman tool for this turn; its presence advertises elicitation. */
  askHuman?: NativeTool;
  /** Answers for a re-entry turn; requires `resumeSessionId`. */
  resumeInteractions?: readonly ResumeInteraction[];
}

export interface DevinProcessInput extends DevinAcpTurnInput {
  binaryPath: string;
  spawnArgs: string[];
  env: Record<string, string>;
  /** Extra values to redact from stderr excerpts beyond the env-derived set. */
  secretValues?: readonly string[];
}

export interface DevinProcessDependencies {
  spawn?: typeof spawn;
  terminateGraceMs?: number;
}

type ResultChunk = Extract<MessageChunk, { type: 'result' }>;

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

function requireAgentCapabilities(init: InitializeResponse): void {
  if (init.protocolVersion !== PROTOCOL_VERSION) {
    throw new DevinProviderError(
      'devin_protocol_error',
      `ACP protocol version mismatch: expected ${String(PROTOCOL_VERSION)}, got ${String(init.protocolVersion)}.`
    );
  }
  if (init.agentCapabilities?.loadSession !== true) {
    throw new DevinProviderError(
      'devin_protocol_error',
      'Devin ACP agent must advertise loadSession; session resume and AskHuman re-entry depend on it.'
    );
  }
}

/**
 * The ACP SDK 1.4.0 ClientCapabilities type predates the elicitation field,
 * but the Devin agent reads it. Pinned with one assertion so the rest of the
 * file stays typed.
 */
function clientCapabilitiesFor(askHuman: NativeTool | undefined): ClientCapabilities {
  if (askHuman === undefined) return {};
  return { elicitation: { form: {} } } as unknown as ClientCapabilities;
}

function currentModel(options: SessionConfigOption[] | null | undefined): string | undefined {
  const model = options?.find(option => option.id === 'model');
  if (model === undefined || model.type !== 'select') return undefined;
  return typeof model.currentValue === 'string' ? model.currentValue : undefined;
}

function setupTimeoutMs(): number {
  const raw = process.env.DEVIN_ACP_SETUP_TIMEOUT_MS;
  const parsed = raw === undefined ? Number.NaN : Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_SETUP_TIMEOUT_MS;
}

/**
 * Bound a setup request that depends on Devin's network (remote config, session
 * store). The SDK gets a cancellation signal and a local race guarantees a clear
 * provider error even if the SDK never settles the cancelled request.
 */
async function withSetupTimeout<T>(
  label: string,
  run: (options: SendRequestOptions) => Promise<T>
): Promise<T> {
  const ms = setupTimeoutMs();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  const timedOut = new Promise<never>((_resolve: unknown, reject: (error: Error) => void) => {
    controller.signal.addEventListener(
      'abort',
      () => {
        reject(
          new DevinProviderError(
            'devin_protocol_error',
            `Devin ACP ${label} did not answer within ${String(ms)} ms; Devin may be waiting on its remote config fetch. Retry the turn.`
          )
        );
      },
      { once: true }
    );
  });
  try {
    return await Promise.race([run({ cancellationSignal: controller.signal }), timedOut]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * The CLI permission flag does not reach ACP sessions, which start in Devin's
 * `accept-edits` mode. Enforce the approved posture over ACP and refuse to run
 * in a stricter mode silently when bypass is withheld by policy.
 */
async function ensureBypassMode(
  ctx: ClientContext,
  sessionId: string,
  modes: SessionModeState | null | undefined
): Promise<void> {
  if (modes?.currentModeId === DEVIN_SESSION_MODE) return;
  const available = modes?.availableModes.map(mode => mode.id) ?? [];
  if (!available.includes(DEVIN_SESSION_MODE)) {
    throw new DevinProviderError(
      'devin_protocol_error',
      `Devin session mode "${DEVIN_SESSION_MODE}" is unavailable (available: ${available.join(', ') || 'none'}); an organization policy may restrict it.`
    );
  }
  try {
    await withSetupTimeout('session/set_mode', options =>
      ctx.request(methods.agent.session.setMode, { sessionId, modeId: DEVIN_SESSION_MODE }, options)
    );
  } catch (error) {
    throw classifyDevinAcpError(error, 'devin_protocol_error');
  }
}

function abortedResult(sessionId: string): ResultChunk {
  return { type: 'result', sessionId, stopReason: 'aborted', isError: true, errorSubtype: 'devin_aborted' };
}

function successResult(
  sessionId: string,
  response: PromptResponse | undefined,
  structuredOutput: unknown,
  model: string | undefined
): ResultChunk {
  const usageBreakdown = devinPromptUsageToBreakdown(response?.usage, model);
  return {
    type: 'result',
    sessionId,
    stopReason: response?.stopReason ?? 'end_turn',
    ...(structuredOutput !== undefined ? { structuredOutput } : {}),
    ...(model !== undefined ? { resolvedModel: { id: model } } : {}),
    ...(usageBreakdown !== undefined ? { usageBreakdown } : {}),
  };
}

function waitMs(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve: () => void) => {
    setTimeout(resolve, ms);
  });
}

/**
 * Drive one ACP turn against an in-process agent or an stdio stream.
 *
 * Three signals end a turn early and each cancels the ACP session before the
 * prompt returns: the caller's abort signal, a permission request (yolo means
 * Devin should not ask; if it does, Archon refuses and stops), and an AskHuman
 * pause raised by the elicitation handler. AskHuman control errors are
 * rethrown unchanged so the executor can park the node.
 */
export async function* driveDevinAcpTurn(
  target: Stream | AgentApp,
  input: DevinAcpTurnInput
): AsyncGenerator<MessageChunk> {
  if (input.resumeInteractions !== undefined && input.resumeInteractions.length > 0 && input.resumeSessionId === undefined) {
    throw new DevinProviderError('devin_protocol_error', 'AskHuman re-entry requires the stored Devin session id.');
  }

  const queue = new AsyncQueue<MessageChunk>();
  const state = createDevinEventState();
  let activeSessionId: string | undefined;
  let sessionLive = false;
  let clientCtx: ClientContext | undefined;
  let transcript = '';
  let aborted = input.abortSignal?.aborted === true;
  let controlError: AskHumanControlError | undefined;
  let terminalError: DevinProviderError | undefined;
  let cancelSent: Promise<void> | undefined;

  const requestCancel = (): void => {
    if (clientCtx === undefined || activeSessionId === undefined || cancelSent !== undefined) return;
    cancelSent = clientCtx.notify(methods.agent.session.cancel, { sessionId: activeSessionId });
  };

  const app = client({ name: 'archon-devin' })
    .onRequest(methods.client.session.requestPermission, ({ params }) => {
      const title = params.toolCall.title ?? params.toolCall.toolCallId;
      terminalError ??= new DevinProviderError(
        'devin_permission_blocked',
        `Devin asked for permission to run "${title}" despite yolo mode; Archon refused and stopped the turn. Adjust Devin's organization rules or the prompt.`
      );
      requestCancel();
      return { outcome: { outcome: 'cancelled' } };
    })
    .onRequest(methods.client.elicitation.create, async ({ params }) => {
      await handleElicitation(params);
      return { action: 'cancel' };
    })
    .onNotification(methods.client.session.update, ({ params }) => {
      if (params.sessionId !== activeSessionId) return;
      for (const chunk of mapDevinSessionUpdate(params.update, state)) {
        if (chunk.type === 'assistant') transcript += chunk.content;
        queue.push(chunk);
      }
    });

  async function handleElicitation(params: CreateElicitationRequest): Promise<void> {
    if (input.askHuman === undefined) {
      terminalError ??= new DevinProviderError(
        'devin_protocol_error',
        'Devin sent an elicitation request but no AskHuman tool was supplied for this turn.'
      );
      requestCancel();
      return;
    }
    const toolUseId = state.pendingAskToolCallIds.shift() ?? `devin-ask-${Date.now().toString(36)}`;
    try {
      const questions = elicitationToAskHumanQuestions(params);
      const returned = await input.askHuman.handler({ questions }, { toolUseId, sessionId: activeSessionId });
      terminalError ??= new DevinProviderError(
        'devin_protocol_error',
        `AskHuman handler returned instead of pausing (${returned.length} chars); the turn cannot continue safely.`
      );
    } catch (error) {
      if (isAskHumanControlError(error)) {
        controlError ??= error;
      } else {
        terminalError ??= new DevinProviderError(
          'devin_protocol_error',
          `AskHuman handler failed: ${errorMessage(error)}`,
          { cause: error }
        );
      }
    }
    requestCancel();
  }

  // The SDK overloads connectWith(Stream) and connectWith(AgentApp); one cast covers both.
  const targetForConnect = target as Stream & AgentApp;

  const connected: Promise<void> = app
    .connectWith(targetForConnect, async (ctx: ClientContext) => {
      clientCtx = ctx;
      try {
        const init = await withSetupTimeout('initialize', options =>
          ctx.request(
            methods.agent.initialize,
            { protocolVersion: PROTOCOL_VERSION, clientCapabilities: clientCapabilitiesFor(input.askHuman) },
            options
          )
        );
        requireAgentCapabilities(init);

        let configOptions: SessionConfigOption[] | null | undefined;
        let modes: SessionModeState | null | undefined;
        if (input.resumeSessionId !== undefined) {
          const resumeSessionId = input.resumeSessionId;
          activeSessionId = resumeSessionId;
          state.replaying = true;
          try {
            const loaded = await withSetupTimeout('session/load', options =>
              ctx.request(
                methods.agent.session.load,
                { sessionId: resumeSessionId, cwd: input.cwd, mcpServers: [] },
                options
              )
            );
            configOptions = loaded?.configOptions;
            modes = loaded?.modes;
          } catch (error) {
            throw classifyDevinAcpError(error, 'devin_session_load_failed');
          } finally {
            state.replaying = false;
          }
        } else {
          let created;
          try {
            created = await withSetupTimeout('session/new', options =>
              ctx.request(methods.agent.session.new, { cwd: input.cwd, mcpServers: [] }, options)
            );
          } catch (error) {
            throw classifyDevinAcpError(error, 'devin_acp_error');
          }
          activeSessionId = created.sessionId;
          configOptions = created.configOptions;
          modes = created.modes;
        }
        const sessionId = activeSessionId;
        sessionLive = true;

        await ensureBypassMode(ctx, sessionId, modes);

        let model = currentModel(configOptions);
        const requestedModel = input.model;
        if (requestedModel !== undefined) {
          try {
            const applied = await withSetupTimeout('session/set_config_option', options =>
              ctx.request(
                methods.agent.session.setConfigOption,
                { sessionId, configId: 'model', value: requestedModel },
                options
              )
            );
            model = currentModel(applied.configOptions) ?? requestedModel;
          } catch (error) {
            throw classifyDevinAcpError(error, 'devin_unsupported_model');
          }
        }

        const onAbort = (): void => {
          aborted = true;
          requestCancel();
        };
        if (!aborted) input.abortSignal?.addEventListener('abort', onAbort);

        let promptResponse: PromptResponse | undefined;
        try {
          if (!aborted) {
            const outbound =
              input.resumeInteractions !== undefined && input.resumeInteractions.length > 0
                ? buildDevinAskResumePrompt(input.resumeInteractions)
                : input.outputSchema !== undefined
                  ? augmentPromptForJsonSchema(input.prompt, input.outputSchema)
                  : input.prompt;
            try {
              promptResponse = await ctx.request(methods.agent.session.prompt, {
                sessionId,
                prompt: [{ type: 'text', text: outbound }],
              });
            } catch (error) {
              if (!aborted && controlError === undefined && terminalError === undefined) throw error;
            }
          }
        } finally {
          input.abortSignal?.removeEventListener('abort', onAbort);
          if (cancelSent !== undefined) {
            try {
              await cancelSent;
            } catch {
              // The connection may already be closing; nothing else to release.
            }
          }
          sessionLive = false;
        }

        if (controlError !== undefined) throw controlError;
        if (terminalError !== undefined) throw terminalError;
        if (aborted) {
          queue.push(abortedResult(sessionId));
          return;
        }
        const structured = input.outputSchema !== undefined ? tryParseStructuredOutput(transcript) : undefined;
        queue.push(successResult(sessionId, promptResponse, structured, model));
      } catch (error) {
        throw classifyDevinAcpError(error, 'devin_protocol_error');
      }
    })
    .then(
      () => {
        queue.close();
      },
      (error: unknown) => {
        queue.fail(error);
      }
    );

  try {
    for await (const chunk of queue) {
      yield chunk;
    }
  } finally {
    if (sessionLive) requestCancel();
    await connected;
  }
}

interface StderrEvidence {
  readonly text: string;
  readonly truncated: boolean;
  readonly secrets: readonly string[];
}

function trailingSecretFragmentLength(redacted: string, secrets: readonly string[]): number {
  let longest = 0;
  for (const secret of secrets) {
    const maxPrefix = Math.min(secret.length - 1, redacted.length);
    for (let length = maxPrefix; length > longest; length--) {
      if (redacted.endsWith(secret.slice(0, length))) {
        longest = length;
        break;
      }
    }
  }
  return longest;
}

/** Truncation can split a secret; drop any trailing prefix of one, repeatedly. */
function stripTrailingSecretFragments(redacted: string, secrets: readonly string[]): string {
  let safe = redacted;
  while (safe.length > 0) {
    const fragment = trailingSecretFragmentLength(safe, secrets);
    if (fragment === 0) break;
    safe = safe.slice(0, safe.length - fragment);
  }
  return safe;
}

function redactedStderrExcerpt(stderr: StderrEvidence): string {
  const redacted = redactDevinSecrets(stderr.text, stderr.secrets);
  const safe = stderr.truncated ? stripTrailingSecretFragments(redacted, stderr.secrets) : redacted;
  return safe.slice(0, STDERR_CAP);
}

function withStderr(error: DevinProviderError, stderr: StderrEvidence): DevinProviderError {
  const excerpt = redactedStderrExcerpt(stderr);
  if (excerpt.length === 0) return error;
  return new DevinProviderError(error.subtype, `${error.message}\n${excerpt}`, { cause: error });
}

function childHasExited(child: ChildProcess): boolean {
  return child.exitCode !== null || child.signalCode !== null;
}

async function reapChild(child: ChildProcess, terminateGraceMs: number): Promise<void> {
  if (childHasExited(child)) return;
  const exited = new Promise<void>((resolve: () => void) => {
    child.once('exit', () => {
      resolve();
    });
  });
  if (childHasExited(child)) return;
  child.kill('SIGTERM');
  if (childHasExited(child)) {
    await exited;
    return;
  }
  await Promise.race([exited, waitMs(terminateGraceMs)]);
  if (!childHasExited(child)) child.kill('SIGKILL');
  await exited;
}

/**
 * Spawn the Devin CLI and drive one ACP turn over stdio. The child is always
 * reaped when the turn ends, aborts, pauses, or fails.
 */
export async function* runDevinAcpTurn(
  input: DevinProcessInput,
  dependencies?: DevinProcessDependencies
): AsyncGenerator<MessageChunk> {
  const spawnFn = dependencies?.spawn ?? spawn;
  const terminateGraceMs = dependencies?.terminateGraceMs ?? DEFAULT_TERMINATE_GRACE_MS;
  const secrets = [
    ...new Set([
      ...collectDevinSecretValues(input.env),
      ...(input.secretValues ?? []).filter(isRedactableSecretValue),
    ]),
  ];
  const stderrBufferCap = STDERR_CAP + Math.max(0, ...secrets.map((secret: string) => secret.length));

  let child: ChildProcess;
  try {
    child = spawnFn(input.binaryPath, input.spawnArgs, {
      cwd: input.cwd,
      env: input.env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
  } catch (error) {
    throw new DevinProviderError('devin_spawn_failed', redactDevinSecrets(errorMessage(error), secrets), {
      cause: error,
    });
  }

  let stderrText = '';
  let stderrTruncated = false;
  child.stderr?.on('data', (chunk: Buffer | string) => {
    if (stderrText.length >= stderrBufferCap) {
      stderrTruncated = true;
      return;
    }
    stderrText += typeof chunk === 'string' ? chunk : chunk.toString('utf8');
    if (stderrText.length > stderrBufferCap) {
      stderrText = stderrText.slice(0, stderrBufferCap);
      stderrTruncated = true;
    }
  });

  let finished = false;
  let resolveDeath: ((error: DevinProviderError) => void) | undefined;
  const death = new Promise<DevinProviderError>((resolve: (error: DevinProviderError) => void) => {
    resolveDeath = resolve;
  });
  child.once('error', (error: Error) => {
    if (!finished) resolveDeath?.(new DevinProviderError('devin_spawn_failed', error.message, { cause: error }));
  });
  child.once('exit', (code: number | null, signal: NodeJS.Signals | null) => {
    if (!finished) {
      resolveDeath?.(
        new DevinProviderError(
          'devin_child_exited',
          `Devin CLI exited before the ACP turn completed (code=${String(code)}, signal=${String(signal)}).`
        )
      );
    }
  });

  if (child.stdin === null || child.stdout === null) {
    finished = true;
    await reapChild(child, terminateGraceMs);
    throw new DevinProviderError('devin_spawn_failed', 'Devin CLI process is missing stdio pipes.');
  }

  const stream = ndJsonStream(
    Writable.toWeb(child.stdin) as unknown as WritableStream<Uint8Array>,
    Readable.toWeb(child.stdout) as unknown as ReadableStream<Uint8Array>
  );
  const gen = driveDevinAcpTurn(stream, input);

  try {
    while (true) {
      const winner = await Promise.race([
        gen.next().then((result: IteratorResult<MessageChunk>) => ({ kind: 'chunk' as const, result })),
        death.then((error: DevinProviderError) => ({ kind: 'death' as const, error })),
      ]);
      if (winner.kind === 'death') throw winner.error;
      if (winner.result.done) break;
      yield winner.result.value;
    }
    finished = true;
  } catch (error) {
    finished = true;
    if (isAskHumanControlError(error)) throw error;
    const stderr: StderrEvidence = { text: stderrText, truncated: stderrTruncated, secrets };
    if (error instanceof DevinProviderError) throw withStderr(error, stderr);
    throw withStderr(
      new DevinProviderError('devin_acp_error', redactDevinSecrets(errorMessage(error), secrets), { cause: error }),
      stderr
    );
  } finally {
    finished = true;
    try {
      await gen.return(undefined);
    } catch {
      // The turn already failed or completed.
    }
    await reapChild(child, terminateGraceMs);
  }
}
```

- [ ] **Step 4: Run the tests and type-check**

Run from `packages/providers`:
```bash
bun test src/community/devin/acp-client.test.ts
bun run type-check
```
Expected: PASS; type-check clean. If `methods.client.elicitation.create` is not accepted by the typed `onRequest` overload, use the string overload documented in the SDK (`onRequest('elicitation/create', parser, handler)`) with the schema's `zod` parser from `@agentclientprotocol/sdk` — keep the response shape `{ action: 'cancel' }`.

- [ ] **Step 5: Commit**

```bash
git add packages/providers/src/community/devin/acp-client.ts packages/providers/src/community/devin/acp-client.test.ts
git commit -m "feat(providers): drive devin ACP turns with elicitation-backed AskHuman and cancellation"
```

## Task 6: Provider boundary — preflight, error-as-result, control-error rethrow

**Files:**
- Create: `packages/providers/src/community/devin/provider.ts`
- Test: `packages/providers/src/community/devin/provider.test.ts`

**Interfaces:**
- Consumes: `DevinProcessInput` (type) from `./acp-client`; `parseDevinConfig`, `buildDevinSpawnArgs`; `resolveDevinBinary`, `assertDevinLoggedIn`; `DevinProviderError`, `collectDevinSecretValues`, `isAskHumanControlError`, `toDevinErrorResult`; `DEVIN_CAPABILITIES`; `withResumedOutcome`, `resumedOutcome` from `../../shared/resumed`; `IAgentProvider`, `MessageChunk`, `ProviderCapabilities`, `SendQueryOptions` from `../../types`.
- Produces: `type DevinTurnRunner = (input: DevinProcessInput) => AsyncGenerator<MessageChunk>`, `interface DevinProviderDependencies { runTurn?; resolveBinary?; assertLoggedIn? }`, `class DevinProvider implements IAgentProvider`.

- [ ] **Step 1: Write the failing provider tests**

```ts
// packages/providers/src/community/devin/provider.test.ts
import { describe, expect, test } from 'bun:test';

import { AskHumanAwaitingError, type MessageChunk, type NativeTool } from '../../types';
import type { DevinProcessInput } from './acp-client';
import { DEVIN_CAPABILITIES } from './capabilities';
import { DevinProviderError } from './errors';
import { DevinProvider, type DevinTurnRunner } from './provider';

async function collect(stream: AsyncGenerator<MessageChunk>): Promise<MessageChunk[]> {
  const chunks: MessageChunk[] = [];
  for await (const chunk of stream) chunks.push(chunk);
  return chunks;
}

function successChunks(): MessageChunk[] {
  return [
    { type: 'assistant', content: 'PONG' },
    { type: 'result', sessionId: 'sess-1', stopReason: 'end_turn' },
  ];
}

function recordingRunner(calls: DevinProcessInput[], chunks: MessageChunk[] = successChunks()): DevinTurnRunner {
  return async function* (input: DevinProcessInput): AsyncGenerator<MessageChunk> {
    calls.push(input);
    for (const chunk of chunks) yield chunk;
  };
}

function throwingRunner(calls: DevinProcessInput[], error: unknown): DevinTurnRunner {
  return async function* (input: DevinProcessInput): AsyncGenerator<MessageChunk> {
    calls.push(input);
    throw error;
  };
}

function askTool(): NativeTool {
  return { name: 'AskHuman', description: 'ask', inputSchema: { type: 'object' }, handler: async () => 'x' };
}

function provider(runner: DevinTurnRunner, overrides: { binary?: () => string; loggedIn?: () => void } = {}): DevinProvider {
  return new DevinProvider({
    runTurn: runner,
    resolveBinary: overrides.binary ?? ((): string => '/stub/devin'),
    assertLoggedIn: overrides.loggedIn ?? ((): void => undefined),
  });
}

describe('DevinProvider', () => {
  test('exposes type and capabilities', () => {
    const p = provider(recordingRunner([]));
    expect(p.getType()).toBe('devin');
    expect(p.getCapabilities()).toBe(DEVIN_CAPABILITIES);
  });

  test('builds the turn input from config, request options, and env; stamps resumed on resume', async () => {
    const calls: DevinProcessInput[] = [];
    const p = provider(recordingRunner(calls));
    const ask = askTool();
    const abort = new AbortController();
    const chunks = await collect(
      p.sendQuery('do it', '/repo', 'sess-1', {
        model: 'claude-opus-5-low',
        env: { FOO: 'bar' },
        assistantConfig: { agentType: 'review', refusalFallback: ['a'] },
        outputFormat: { type: 'json_schema', schema: { type: 'object' } },
        abortSignal: abort.signal,
        nativeTools: [ask, { name: 'manage_run', description: 'x', inputSchema: {}, handler: async () => '' }],
        resumeInteractions: [{ tool_use_id: 'call_1', payload: 'declined', declined: true }],
      })
    );
    expect(calls).toHaveLength(1);
    const input = calls[0]!;
    expect(input).toMatchObject({
      cwd: '/repo',
      prompt: 'do it',
      resumeSessionId: 'sess-1',
      model: 'claude-opus-5-low',
      binaryPath: '/stub/devin',
      spawnArgs: ['--permission-mode', 'yolo', 'acp', '--agent-type', 'review', '--refusal-fallback', 'a'],
      outputSchema: { type: 'object' },
      resumeInteractions: [{ tool_use_id: 'call_1', payload: 'declined', declined: true }],
    });
    expect(input.askHuman).toBe(ask);
    expect(input.abortSignal).toBe(abort.signal);
    expect(input.env.FOO).toBe('bar');
    expect(input.env.PATH).toBe(process.env.PATH);
    expect(chunks.at(-1)).toMatchObject({ type: 'result', sessionId: 'sess-1', resumed: true });
  });

  test('config model is the fallback when the request has none', async () => {
    const calls: DevinProcessInput[] = [];
    await collect(provider(recordingRunner(calls)).sendQuery('x', '/repo', undefined, { assistantConfig: { model: 'cfg-model' } }));
    expect(calls[0]?.model).toBe('cfg-model');
    expect(calls[0]?.askHuman).toBeUndefined();
    expect(calls[0]?.resumeSessionId).toBeUndefined();
  });

  test('pre-aborted signal yields devin_aborted without preflight', async () => {
    const calls: DevinProcessInput[] = [];
    let resolved = false;
    const abort = new AbortController();
    abort.abort();
    const p = provider(recordingRunner(calls), { binary: () => { resolved = true; return '/stub/devin'; } });
    const chunks = await collect(p.sendQuery('x', '/repo', undefined, { abortSignal: abort.signal }));
    expect(chunks).toEqual([
      { type: 'result', isError: true, errorSubtype: 'devin_aborted', errors: ['Devin turn aborted before start.'] },
    ]);
    expect(calls).toEqual([]);
    expect(resolved).toBe(false);
  });

  test('invalid config, missing binary, and missing login become terminal results before spawn', async () => {
    const calls: DevinProcessInput[] = [];
    const bad = await collect(provider(recordingRunner(calls)).sendQuery('x', '/repo', undefined, { assistantConfig: { permissionMode: 'auto' } }));
    expect(bad[0]).toMatchObject({ type: 'result', isError: true, errorSubtype: 'devin_unsupported_config' });

    const noBin = await collect(
      provider(recordingRunner(calls), { binary: () => { throw new DevinProviderError('devin_binary_missing', 'no devin'); } }).sendQuery('x', '/repo')
    );
    expect(noBin[0]).toMatchObject({ type: 'result', isError: true, errorSubtype: 'devin_binary_missing', errors: ['no devin'] });

    const noLogin = await collect(
      provider(recordingRunner(calls), { loggedIn: () => { throw new DevinProviderError('devin_not_logged_in', 'login'); } }).sendQuery('x', '/repo')
    );
    expect(noLogin[0]).toMatchObject({ type: 'result', isError: true, errorSubtype: 'devin_not_logged_in' });
    expect(calls).toEqual([]);
  });

  test('runner failures become redacted terminal results', async () => {
    const calls: DevinProcessInput[] = [];
    const p = provider(throwingRunner(calls, new DevinProviderError('devin_child_exited', 'died: tok-secret-9999')));
    const chunks = await collect(p.sendQuery('x', '/repo', undefined, { env: { DEVIN_API_TOKEN: 'tok-secret-9999' } }));
    expect(chunks).toEqual([
      { type: 'result', isError: true, errorSubtype: 'devin_child_exited', errors: ['died: [REDACTED]'] },
    ]);
  });

  test('AskHuman control errors are thrown out of sendQuery, not converted', async () => {
    const awaiting = new AskHumanAwaitingError('call_1', 'node', 'run');
    const p = provider(throwingRunner([], awaiting));
    let thrown: unknown;
    try {
      await collect(p.sendQuery('x', '/repo', undefined, { nativeTools: [askTool()] }));
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBe(awaiting);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run from `packages/providers`: `bun test src/community/devin/provider.test.ts`
Expected: FAIL — `Cannot find module './provider'`.

- [ ] **Step 3: Implement the provider**

```ts
// packages/providers/src/community/devin/provider.ts
import type { IAgentProvider, MessageChunk, ProviderCapabilities, SendQueryOptions } from '../../types';
import { resumedOutcome, withResumedOutcome } from '../../shared/resumed';
import type { DevinProcessInput } from './acp-client';
import { assertDevinLoggedIn, resolveDevinBinary } from './binary-resolver';
import { DEVIN_CAPABILITIES } from './capabilities';
import { buildDevinSpawnArgs, parseDevinConfig } from './config';
import {
  collectDevinSecretValues,
  DevinProviderError,
  isAskHumanControlError,
  toDevinErrorResult,
} from './errors';

export type DevinTurnRunner = (input: DevinProcessInput) => AsyncGenerator<MessageChunk>;

export interface DevinProviderDependencies {
  runTurn?: DevinTurnRunner;
  resolveBinary?: typeof resolveDevinBinary;
  assertLoggedIn?: typeof assertDevinLoggedIn;
}

const ASK_HUMAN_TOOL_NAME = 'AskHuman';

function childEnv(request: Record<string, string> | undefined): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) env[key] = value;
  }
  if (request !== undefined) Object.assign(env, request);
  return env;
}

function parseConfigOrThrow(raw: Record<string, unknown>): ReturnType<typeof parseDevinConfig> {
  try {
    return parseDevinConfig(raw);
  } catch (error) {
    if (error instanceof DevinProviderError) throw error;
    throw new DevinProviderError(
      'devin_unsupported_config',
      error instanceof Error ? error.message : String(error),
      { cause: error }
    );
  }
}

/**
 * Devin CLI community provider. Preflight and error-as-result live here; ACP
 * SDK values load only when `sendQuery()` dynamically imports `./acp-client`.
 * AskHuman control errors are rethrown because the executor pauses on them.
 */
export class DevinProvider implements IAgentProvider {
  constructor(private readonly dependencies: DevinProviderDependencies = {}) {}

  getType(): string {
    return 'devin';
  }

  getCapabilities(): ProviderCapabilities {
    return DEVIN_CAPABILITIES;
  }

  async *sendQuery(
    prompt: string,
    cwd: string,
    resumeSessionId?: string,
    requestOptions?: SendQueryOptions
  ): AsyncGenerator<MessageChunk> {
    if (requestOptions?.abortSignal?.aborted === true) {
      yield toDevinErrorResult(new DevinProviderError('devin_aborted', 'Devin turn aborted before start.'), []);
      return;
    }

    let secrets: string[] = [];
    try {
      const config = parseConfigOrThrow(requestOptions?.assistantConfig ?? {});
      const resolveBinary = this.dependencies.resolveBinary ?? resolveDevinBinary;
      const assertLoggedIn = this.dependencies.assertLoggedIn ?? assertDevinLoggedIn;
      const binaryPath = resolveBinary(config.binaryPath, process.env);
      assertLoggedIn(process.env);

      const env = childEnv(requestOptions?.env);
      secrets = collectDevinSecretValues(env);
      const askHuman = requestOptions?.nativeTools?.find(tool => tool.name === ASK_HUMAN_TOOL_NAME);
      const runTurn = this.dependencies.runTurn ?? (await import('./acp-client')).runDevinAcpTurn;

      const input: DevinProcessInput = {
        cwd,
        prompt,
        binaryPath,
        spawnArgs: buildDevinSpawnArgs(config),
        env,
        secretValues: secrets,
        ...(resumeSessionId !== undefined ? { resumeSessionId } : {}),
        ...(requestOptions?.model !== undefined
          ? { model: requestOptions.model }
          : config.model !== undefined
            ? { model: config.model }
            : {}),
        ...(requestOptions?.outputFormat?.schema !== undefined ? { outputSchema: requestOptions.outputFormat.schema } : {}),
        ...(requestOptions?.abortSignal !== undefined ? { abortSignal: requestOptions.abortSignal } : {}),
        ...(askHuman !== undefined ? { askHuman } : {}),
        ...(requestOptions?.resumeInteractions !== undefined ? { resumeInteractions: requestOptions.resumeInteractions } : {}),
      };

      yield* withResumedOutcome(runTurn(input), resumedOutcome(resumeSessionId, true));
    } catch (error: unknown) {
      if (isAskHumanControlError(error)) throw error;
      yield toDevinErrorResult(error, secrets);
    }
  }
}
```

- [ ] **Step 4: Run the tests and type-check**

Run from `packages/providers`:
```bash
bun test src/community/devin/provider.test.ts
bun run type-check
```
Expected: PASS; type-check clean.

- [ ] **Step 5: Commit**

```bash
git add packages/providers/src/community/devin/provider.ts packages/providers/src/community/devin/provider.test.ts
git commit -m "feat(providers): add DevinProvider boundary with preflight and error-as-result"
```

## Task 7: Register, export, prove lazy loading, and wire package scripts

**Files:**
- Create: `packages/providers/src/community/devin/registration.ts`
- Create: `packages/providers/src/community/devin/index.ts`
- Create: `packages/providers/src/community/devin/provider-lazy-load.test.ts`
- Modify: `packages/providers/src/registry.ts` (imports near line 27; `registerCommunityProviders()` near line 196)
- Modify: `packages/providers/src/registry.test.ts` (imports near line 19; new describe after the `registerDeepseekProvider` block)
- Modify: `packages/providers/src/index.ts` (after the DeepSeek export block ending near line 169)
- Modify: `packages/providers/package.json` (`exports`, `scripts.test`, new `spike:devin:acp` script)
- Modify: `packages/workflows/src/loader.test.ts` (after the `provider: deepseek` test near line 655)

**Interfaces:**
- Produces: `registerDevinProvider(): void`; barrel exports `DEVIN_CAPABILITIES`, `DevinProvider`, `parseDevinConfig`, `registerDevinProvider`, `checkDevinReadiness`, `devinCredentialsPath`, `type DevinProviderDefaults`, `type DevinReadiness`. Task 8 imports `checkDevinReadiness` from `@archon/providers`.

- [ ] **Step 1: Write the failing registry assertions**

Add to `packages/providers/src/registry.test.ts` imports:
```ts
import { registerDevinProvider } from './community/devin/registration';
import { DEVIN_CAPABILITIES } from './community/devin/capabilities';
```
Add after the `registerDeepseekProvider (community provider)` describe block:
```ts
  describe('registerDevinProvider (community provider)', () => {
    test('registers devin with community metadata, an ambient-only credential, and capabilities', () => {
      registerDevinProvider();
      expect(getRegistration('devin')).toMatchObject({
        id: 'devin',
        displayName: 'Devin CLI (community)',
        builtIn: false,
        credentials: {
          kind: 'static',
          specs: [{ vendor: 'devin', displayName: 'Devin', kinds: ['ambient'] }],
        },
      });
      expect(getProviderCapabilities('devin')).toEqual(DEVIN_CAPABILITIES);
    });

    test('is idempotent and part of registerCommunityProviders', () => {
      registerDevinProvider();
      expect(() => registerDevinProvider()).not.toThrow();
      clearRegistry();
      registerCommunityProviders();
      expect(getRegisteredProviders().filter(provider => provider.id === 'devin')).toHaveLength(1);
    });
  });
```
If `registerCommunityProviders` or `clearRegistry` are not already imported in that file, add them to the existing `./registry` import.

- [ ] **Step 2: Write the failing lazy-load test**

```ts
// packages/providers/src/community/devin/provider-lazy-load.test.ts
/**
 * Regression test: @agentclientprotocol/sdk must not load at module-import time.
 * Devin talks ACP over stdio through a dynamically imported client; a static SDK
 * value import in the registration or provider graph would evaluate ACP during
 * registerCommunityProviders() and in binaries that never run a Devin turn.
 * Runs in its own `bun test` invocation because mock.module is process-wide.
 */
import { expect, mock, test } from 'bun:test';

let acpSdkLoadCount = 0;

mock.module('@agentclientprotocol/sdk', () => {
  acpSdkLoadCount += 1;
  return {};
});

test('importing registration and instantiating DevinProvider does not evaluate the ACP SDK', async () => {
  const { registerDevinProvider } = await import('./registration');
  const { DevinProvider } = await import('./provider');
  const { clearRegistry } = await import('../../registry');

  clearRegistry();
  registerDevinProvider();

  const provider = new DevinProvider();
  expect(provider.getType()).toBe('devin');
  expect(provider.getCapabilities()).toBeDefined();
  expect(acpSdkLoadCount).toBe(0);
});
```

- [ ] **Step 3: Write the failing workflow-selection test**

Add to `packages/workflows/src/loader.test.ts`, next to the DeepSeek case (reuse that test's import style for `registerDevinProvider` from `@archon/providers`):
```ts
    it('should accept provider: devin when the community provider is registered', () => {
      registerDevinProvider();
      try {
        const { workflow } = parseWorkflowYaml(`name: devin-provider
description: Devin provider selection
provider: devin
nodes:
  - id: run
    provider: devin
    prompt: hello
`);
        expect(workflow.provider).toBe('devin');
        expect(workflow.nodes[0].provider).toBe('devin');
      } finally {
        clearRegistry();
        registerBuiltinProviders();
        registerOmpProvider();
      }
    });
```

- [ ] **Step 4: Run the three tests to verify they fail**

```bash
cd packages/providers && bun test src/registry.test.ts; bun test src/community/devin/provider-lazy-load.test.ts
cd ../workflows && bun test src/loader.test.ts
```
Expected: FAIL — `registerDevinProvider` cannot be resolved.

- [ ] **Step 5: Add registration and barrels**

```ts
// packages/providers/src/community/devin/registration.ts
import { isRegisteredProvider, registerProvider } from '../../registry';

import { DEVIN_CAPABILITIES } from './capabilities';
import { DevinProvider } from './provider';

/**
 * Register the Devin CLI community provider. Idempotent so every process
 * entrypoint can call it. The credential is ambient-only: every user of the
 * install shares the machine's `devin auth login`, so there is no per-user key
 * to connect and the settings card only reports whether that login is usable.
 */
export function registerDevinProvider(): void {
  if (isRegisteredProvider('devin')) return;
  registerProvider({
    id: 'devin',
    displayName: 'Devin CLI (community)',
    factory: () => new DevinProvider(),
    capabilities: DEVIN_CAPABILITIES,
    builtIn: false,
    credentials: {
      kind: 'static',
      specs: [{ vendor: 'devin', displayName: 'Devin', kinds: ['ambient'] }],
    },
  });
}
```

```ts
// packages/providers/src/community/devin/index.ts
export { checkDevinReadiness, devinCredentialsPath, type DevinReadiness } from './binary-resolver';
export { DEVIN_CAPABILITIES } from './capabilities';
export { parseDevinConfig, type DevinProviderDefaults } from './config';
export { DevinProvider } from './provider';
export { registerDevinProvider } from './registration';
```

In `packages/providers/src/registry.ts` add the import beside the other community registrations and the call as the last named provider before the env-gated e2e fake:
```ts
import { registerDevinProvider } from './community/devin/registration';
// …
  registerDeepseekProvider();
  registerDevinProvider();
  // Env-gated (ARCHON_E2E_FAKE_PROVIDER) — no-op in production.
  registerE2eFakeProvider();
```

In `packages/providers/src/index.ts` after the DeepSeek block:
```ts
export {
  checkDevinReadiness,
  DEVIN_CAPABILITIES,
  devinCredentialsPath,
  DevinProvider,
  parseDevinConfig,
  registerDevinProvider,
  type DevinProviderDefaults,
  type DevinReadiness,
} from './community/devin';
```

In `packages/providers/package.json`:
- `exports`: add `"./community/devin": "./src/community/devin/index.ts",` after the deepseek entry.
- `scripts.test`: insert, immediately after `bun test src/community/deepseek/provider-lazy-load.test.ts`, the segment:
  `&& bun test src/community/devin/config.test.ts && bun test src/community/devin/binary-resolver.test.ts && bun test src/community/devin/errors.test.ts && bun test src/community/devin/async-queue.test.ts && bun test src/community/devin/event-bridge.test.ts && bun test src/community/devin/elicitation.test.ts && bun test src/community/devin/usage.test.ts && bun test src/community/devin/acp-client.test.ts && bun test src/community/devin/provider.test.ts && bun test src/community/devin/provider-lazy-load.test.ts`
- `scripts`: add `"spike:devin:acp": "bun src/community/devin/acp-live-smoke.ts"` (file created in Task 11).

In `packages/workflows/src/loader.test.ts`, extend the existing `@archon/providers` import with `registerDevinProvider`.

- [ ] **Step 6: Run registry, lazy-load, loader, and package checks**

```bash
cd packages/providers && bun test src/registry.test.ts && bun test src/community/devin/provider-lazy-load.test.ts && bun run type-check
cd ../workflows && bun test src/loader.test.ts && bun run type-check
cd ../.. && bun run lint
```
Expected: PASS; no lint warnings.

- [ ] **Step 7: Commit**

```bash
git add packages/providers/src/community/devin/registration.ts packages/providers/src/community/devin/index.ts packages/providers/src/community/devin/provider-lazy-load.test.ts packages/providers/src/registry.ts packages/providers/src/registry.test.ts packages/providers/src/index.ts packages/providers/package.json packages/workflows/src/loader.test.ts
git commit -m "feat(providers): register the devin community provider"
```

## Task 8: Status-only credential surface — core detection and the Agents card

**Files:**
- Modify: `packages/core/src/credentials/catalog.ts` (`isAmbientConfigured`, currently branches on `amazon-bedrock` and `google-vertex`)
- Modify: `packages/core/src/credentials/catalog.test.ts` (after the `ambient detection reports amazon-bedrock` test)
- Modify: `packages/web/src/experiments/console/components/AgentCredentialCard.tsx` (`ambientSource` near line 40; `CredentialRow` badges near lines 254-266)
- Create: `packages/web/src/experiments/console/components/AgentCredentialCard.test.tsx`

**Interfaces:**
- Consumes: `checkDevinReadiness` from `@archon/providers` (Task 7 export); `AgentCredentials` type from `../skills` in web.
- Produces: `GET /api/auth/providers` returns for agent `devin` one credential `{ vendor: 'devin', kinds: ['ambient'], ambientConfigured: boolean }` and `ready === ambientConfigured`. No API schema change: `agentCredentialStatusSchema` already carries `ambientConfigured?: boolean`, so `api.generated.d.ts` needs no regeneration.

- [ ] **Step 1: Write the failing core test**

Add to `packages/core/src/credentials/catalog.test.ts` inside the same describe as the Bedrock ambient test (it already imports `buildAgentCredentialMatrix`; add `mkdirSync`, `mkdtempSync`, `rmSync`, `writeFileSync`, `chmodSync` from `node:fs`, `tmpdir` from `node:os`, `join` from `node:path` if missing):
```ts
    test('ambient detection reports devin from the local CLI plus shared login', () => {
      const dir = mkdtempSync(join(tmpdir(), 'archon-devin-catalog-'));
      const fakeBin = join(dir, 'devin');
      writeFileSync(fakeBin, '#!/bin/sh\nexit 0\n');
      if (process.platform !== 'win32') chmodSync(fakeBin, 0o755);
      const dataHome = join(dir, 'data');
      mkdirSync(join(dataHome, 'devin'), { recursive: true });
      const saved = { bin: process.env.DEVIN_BIN_PATH, xdg: process.env.XDG_DATA_HOME };
      try {
        process.env.DEVIN_BIN_PATH = fakeBin;
        process.env.XDG_DATA_HOME = dataHome;
        let devin = buildAgentCredentialMatrix([]).find(a => a.id === 'devin')!;
        expect(devin.credentials).toEqual([
          {
            vendor: 'devin',
            displayName: 'Devin',
            kinds: ['ambient'],
            connected: null,
            subscriptionAvailable: false,
            installEnv: false,
            ambientConfigured: false,
          },
        ]);
        expect(devin.ready).toBe(false);

        writeFileSync(join(dataHome, 'devin', 'credentials.toml'), '');
        devin = buildAgentCredentialMatrix([]).find(a => a.id === 'devin')!;
        expect(devin.credentials[0]?.ambientConfigured).toBe(true);
        expect(devin.ready).toBe(true);
      } finally {
        if (saved.bin === undefined) delete process.env.DEVIN_BIN_PATH;
        else process.env.DEVIN_BIN_PATH = saved.bin;
        if (saved.xdg === undefined) delete process.env.XDG_DATA_HOME;
        else process.env.XDG_DATA_HOME = saved.xdg;
        rmSync(dir, { recursive: true, force: true });
      }
    });
```
Check the file's `beforeEach`/registration setup: it must call `registerCommunityProviders()` (or the matrix cannot contain `devin`). If it registers providers individually, add `registerDevinProvider()` next to the Pi registration.

- [ ] **Step 2: Run the core test to verify it fails**

Run from `packages/core`: `bun test src/credentials/catalog.test.ts`
Expected: FAIL — `ambientConfigured` is `false` after the credentials file exists (no `devin` branch yet). If the test fails earlier because `devin` is absent from the matrix, fix the registration setup noted in Step 1 first.

- [ ] **Step 3: Add the detection branch**

In `packages/core/src/credentials/catalog.ts`, extend the `@archon/providers` import with `checkDevinReadiness`, then add before the final `return false;` of `isAmbientConfigured`:
```ts
  if (vendor === 'devin') {
    // Shared machine login: the CLI must be resolvable and `devin auth login`
    // must have written its credentials file. Only existence is checked.
    return checkDevinReadiness().ready;
  }
```

- [ ] **Step 4: Run the core test and type-check**

Run from `packages/core`: `bun test src/credentials/catalog.test.ts && bun run type-check`
Expected: PASS.

- [ ] **Step 5: Write the failing component test**

```tsx
// packages/web/src/experiments/console/components/AgentCredentialCard.test.tsx
/**
 * A single-credential agent whose only credential kind is `ambient` must show
 * whether the shared login is usable; there is no key form or login button.
 */
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { installHappyDom, restoreHappyDom } from '../test/install-happy-dom';
import { AgentCredentialCard } from './AgentCredentialCard';
import type { AgentCredentials } from '../skills';

function devinAgent(ambientConfigured: boolean): AgentCredentials {
  return {
    id: 'devin',
    displayName: 'Devin CLI (community)',
    catalog: 'static',
    ready: ambientConfigured,
    credentials: [
      {
        vendor: 'devin',
        displayName: 'Devin',
        kinds: ['ambient'],
        connected: null,
        subscriptionAvailable: false,
        installEnv: false,
        ambientConfigured,
      },
    ],
  };
}

describe('AgentCredentialCard — ambient-only single credential', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    installHappyDom();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
    });
    container.remove();
    restoreHappyDom();
  });

  async function render(agent: AgentCredentials): Promise<void> {
    await act(async () => {
      root.render(
        createElement(AgentCredentialCard, {
          agent,
          connections: [],
          connectEnabled: true,
          piModelCounts: new Map(),
        })
      );
    });
  }

  test('shows the shared login as configured with its source and no connect controls', async () => {
    await render(devinAgent(true));
    expect(container.textContent).toContain('configured via devin auth login');
    expect(container.querySelector('button')).toBeNull();
  });

  test('shows not detected when the CLI or login is missing', async () => {
    await render(devinAgent(false));
    expect(container.textContent).toContain('not detected');
    expect(container.textContent).toContain('needs credential');
    expect(container.querySelector('button')).toBeNull();
  });
});
```

- [ ] **Step 6: Run the component test to verify it fails**

Run from `packages/web`: `NODE_ENV=development bun test src/experiments/console/components/AgentCredentialCard.test.tsx`
Expected: FAIL — neither "configured via" nor "not detected" is rendered for a single-credential agent.

- [ ] **Step 7: Render ambient status in `CredentialRow` and name the Devin source**

In `AgentCredentialCard.tsx`:
1. Extend `ambientSource`:
```ts
function ambientSource(vendor: string): string {
  if (vendor === 'amazon-bedrock') return 'AWS env';
  if (vendor === 'google-vertex') return 'gcloud env';
  if (vendor === 'devin') return 'devin auth login';
  return 'env';
}
```
2. In `CredentialRow`, directly after the `cred.installEnv` badge (`using install env`) add:
```tsx
          {cred.kinds.includes('ambient') && cred.connected === null && !cred.installEnv ? (
            cred.ambientConfigured === true ? (
              <span className="font-mono text-[10.5px] text-success">
                configured via {ambientSource(cred.vendor)}
              </span>
            ) : (
              <span className="font-mono text-[10.5px] text-text-tertiary">not detected</span>
            )
          ) : null}
```
The multi-backend ambient block (`groups.ambient`) is unchanged; it never routes an ambient credential through `CredentialRow`, so nothing renders twice.

- [ ] **Step 8: Run the web tests, type-check, and lint**

```bash
cd packages/web && NODE_ENV=development bun test src/experiments/console/components/AgentCredentialCard.test.tsx && bun run type-check
cd ../.. && bun run lint
```
Expected: PASS; no warnings.

- [ ] **Step 9: Commit**

```bash
git add packages/core/src/credentials/catalog.ts packages/core/src/credentials/catalog.test.ts packages/web/src/experiments/console/components/AgentCredentialCard.tsx packages/web/src/experiments/console/components/AgentCredentialCard.test.tsx
git commit -m "feat(credentials): report shared devin login as a status-only ambient credential"
```

## Task 9: Workflow integration — AskHuman pause and re-entry with a Devin-shaped provider

**Files:**
- Modify: `packages/workflows/src/dag-executor.test.ts` (provider registration near lines 73-87; the `executeDagWorkflow -- AskHuman pause` describe near line 25085; the `executeDagWorkflow -- AskHuman resume re-entry` describe near line 25908 and its `invokeDag` helper near line 25983)

**Interfaces:**
- Consumes: existing helpers `createMockStore`, `createMockDeps`, `createMockPlatform`, `minimalConfig`, `makeWorkflowRun`, `mockSendQueryDag`, `mockGetAgentProviderDag`, `wireAskPause`, `invokeInjectedAskHuman`, `makeAnsweredAsk`, `wireAnsweredAsks`, `invokeDag`; `DEVIN_CAPABILITIES` and `registerDevinProvider` from `@archon/providers`.

- [ ] **Step 1: Register the provider in the test process**

Extend the `@archon/providers` import (lines 73-78) with `registerDevinProvider` and `DEVIN_CAPABILITIES`, and add `registerDevinProvider();` right after `registerPiProvider();` (line 87).

- [ ] **Step 2: Write the failing pause test**

Inside `describe('executeDagWorkflow -- AskHuman pause', …)`, after the Claude `it.each` pause test, add:
```ts
  it('injects AskHuman for a devin node (askHuman true, nativeTools false) and pauses on the control error', async () => {
    mockGetAgentProviderDag.mockImplementation(() => ({
      sendQuery: mockSendQueryDag,
      getType: () => 'devin',
      getCapabilities: () => DEVIN_CAPABILITIES,
    }));
    mockSendQueryDag.mockImplementation(async function* (
      _prompt: string,
      _cwd: string,
      _resume?: string,
      options?: SendQueryOptions
    ) {
      expect(options?.nativeTools?.map(tool => tool.name)).toEqual(['AskHuman']);
      await invokeInjectedAskHuman(options, 'call_ask_1', 'peach-country');
    });

    const store = createMockStore();
    wireAskPause(store);
    const workflowRun = makeWorkflowRun('devin-ask-pause-run');
    const live: WorkflowEmitterEvent[] = [];
    const unsubscribe = getWorkflowEventEmitter().subscribe(event => {
      if ('runId' in event && event.runId === workflowRun.id) live.push(event);
    });
    try {
      await executeDagWorkflow(
        createMockDeps(store),
        createMockPlatform(),
        'conv-dag',
        testDir,
        { name: 'devin-ask-pause', nodes: [{ id: 'review', prompt: 'ask the starter' }] },
        workflowRun,
        'devin',
        undefined,
        join(testDir, 'artifacts'),
        join(testDir, 'state'),
        join(testDir, 'logs'),
        'main',
        'docs/',
        { ...minimalConfig, assistant: 'devin' as const, assistants: { ...minimalConfig.assistants, devin: {} } }
      );
    } finally {
      unsubscribe();
    }

    expect(store.insertPendingInteraction).toHaveBeenCalledWith(
      expect.objectContaining({ tool_use_id: 'call_ask_1', provider_session_id: 'peach-country', kind: 'ask' })
    );
    expect(store.pauseWorkflowRun).toHaveBeenCalledTimes(1);
    expect(store.completeWorkflowRun).not.toHaveBeenCalled();
    expect(store.failWorkflowRun).not.toHaveBeenCalled();
    expect(live.filter(e => e.type === 'node_awaiting')).toHaveLength(1);
    expect(live.some(e => e.type === 'node_completed' || e.type === 'node_failed')).toBe(false);
  });
```
Copy the exact store/emitter assertions used by the neighbouring Claude test if their helper names differ from the ones above (for example the node-message `status: 'awaiting'` check); the behaviors asserted must be identical to the Claude case.

- [ ] **Step 3: Write the failing re-entry test**

Extend `invokeDag`'s `assistant` parameter type to `'claude' | 'pi' | 'devin'` and its config branch:
```ts
    const config =
      assistant === 'pi'
        ? { ...minimalConfig, assistant: 'pi' as const, assistants: { ...minimalConfig.assistants, pi: {} } }
        : assistant === 'devin'
          ? { ...minimalConfig, assistant: 'devin' as const, assistants: { ...minimalConfig.assistants, devin: {} } }
          : minimalConfig;
```
Then add inside the re-entry describe:
```ts
  it('re-enters a devin node with the stored Devin session id and mapped answers, without forking', async () => {
    mockGetAgentProviderDag.mockImplementation(() => ({
      sendQuery: mockSendQueryDag,
      getType: () => 'devin',
      getCapabilities: () => DEVIN_CAPABILITIES,
    }));
    const calls: { prompt: string; resume?: string; options?: SendQueryOptions }[] = [];
    mockSendQueryDag.mockImplementation(async function* (
      prompt: string,
      _cwd: string,
      resume?: string,
      options?: SendQueryOptions
    ) {
      calls.push({ prompt, resume, options });
      yield { type: 'assistant', content: 'CHOSEN=blue' };
      yield { type: 'result', sessionId: resume, resumed: true };
    });

    const store = createMockStore();
    wireAnsweredAsks(store, [
      makeAnsweredAsk({
        node_id: 'review',
        tool_use_id: 'call_ask_1',
        provider_session_id: 'peach-country',
        answer: { answers: [{ questionId: 'q0', value: 'blue' }] },
      }),
    ]);

    await invokeDag(store, [{ id: 'review', prompt: 'original prompt' }], makeWorkflowRun('devin-ask-resume-run'), 'devin');

    expect(calls).toHaveLength(1);
    expect(calls[0]?.prompt).toBe('original prompt');
    expect(calls[0]?.resume).toBe('peach-country');
    expect(calls[0]?.options?.forkSession).toBe(false);
    expect(calls[0]?.options?.resumeInteractions).toEqual([
      { tool_use_id: 'call_ask_1', payload: [{ questionId: 'q0', value: 'blue' }], declined: false },
    ]);
    expect(calls[0]?.options?.nativeTools?.map(tool => tool.name)).toEqual(['AskHuman']);
  });
```
Mirror the neighbouring Pi re-entry test for the exact `makeAnsweredAsk` fields (status, retry epoch, occurrence) so the row is selected by `mapAnsweredAskResume`.

- [ ] **Step 4: Run the tests to verify they fail, then pass**

Run from `packages/workflows`: `bun test src/dag-executor.test.ts -t "devin"`
Expected first: FAIL on `registerDevinProvider` import until Task 7 is merged into the branch; afterwards PASS (no production change is needed in this task — it proves the existing executor contract holds for the new provider).

Then run the full file: `bun test src/dag-executor.test.ts` — Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/workflows/src/dag-executor.test.ts
git commit -m "test(workflows): cover AskHuman pause and re-entry for the devin provider"
```

## Task 10: Operator documentation, capability matrix, and changelog

**Files:**
- Modify: `scripts/generate-capability-matrix.ts` (`CAVEATS` array near line 88)
- Regenerate: `packages/docs-web/src/content/docs/reference/provider-capabilities.md` (never edited by hand)
- Modify: `packages/docs-web/src/content/docs/getting-started/ai-assistants.md` (description line 3; structured-output table line 24; new section after the DeepSeek section near line 915; usage table near line 1012)
- Modify: `packages/docs-web/src/content/docs/reference/configuration.md` (provider-id lists at lines 59 and 449; new section after the DeepSeek section near line 506)
- Modify: `packages/docs-web/src/content/docs/guides/mcp-servers.md` (line 19 sentence and the transports section near line 403)
- Modify: `CHANGELOG.md` (`## [Unreleased]` → `### Added`)

- [ ] **Step 1: Add the matrix caveats**

Append to `CAVEATS` in `scripts/generate-capability-matrix.ts`:
```ts
  {
    provider: 'devin',
    key: 'askHuman',
    note:
      'Delivered through ACP elicitation of Devin\'s native ask_user_question tool; single- and ' +
      'multi-select questions only. Devin pauses by cancelling the turn and re-enters via session/load.',
  },
  {
    provider: 'devin',
    key: 'sessionResume',
    note:
      'ACP session/load in a fresh devin process; a stored id that no longer exists fails the turn ' +
      'instead of starting a new session.',
  },
```

- [ ] **Step 2: Regenerate and check the matrix**

```bash
bun run generate:capability-matrix && bun run check:capability-matrix
```
Expected: the generated file gains a `devin` column with ✅ on `sessionResume`, `structuredOutput` (best-effort), `envInjection`, `askHuman`, ❌ elsewhere, and both caveats rendered. The check exits 0.

- [ ] **Step 3: Document the provider in the AI assistants guide**

1. Line 3 description: append `, and Devin CLI` after `DeepSeek Harness`.
2. Line 24 best-effort row: append `, Devin` after `DeepSeek`.
3. Insert after the DeepSeek section's `### See also` block:

```markdown
## Devin CLI (Community Provider)

**Drive the locally installed Devin CLI over ACP.** The provider id is `devin`, registered as `builtIn: false`.

Archon runs `devin --permission-mode yolo acp` as a child process in the conversation's cwd or the managed worktree and speaks the Agent Client Protocol to it. Every turn spawns a fresh child and reaps it when the turn ends, aborts, pauses, or fails.

### Shared login

All users of one Archon install share the machine's Devin login. Run `devin auth login` once on the Archon host; Archon never asks for, stores, or injects a per-user Devin key. The Settings → Agents card shows whether the CLI is on `PATH` (or at `DEVIN_BIN_PATH` / `assistants.devin.binaryPath`) and whether the login file exists, without showing the account. A run started after the login expires fails with `devin_not_logged_in` and the same `devin auth login` instruction.

### yolo mode

`yolo` is Devin's own tool-permission mode (an alias of `dangerous` / `bypass` in Devin's docs). Archon passes `--permission-mode yolo` to the child and, because ACP sessions start in Devin's `accept-edits` mode regardless of that flag, switches every session to `bypass` over ACP before the first prompt. It does not approve, skip, or answer any Archon approval gate or AskHuman question. Devin organization rules (Team Settings deny/ask rules) still apply in bypass mode; when Devin asks for permission anyway, Archon cancels the request and ends the turn with `devin_permission_blocked` naming the blocked action. If `bypass` is not offered for the session, the turn fails instead of running in a stricter mode silently. Devin's `--sandbox` mode is not used, and `assistants.devin.permissionMode` / `sandbox` are rejected.

### Models

Set `model` to an exact id from `devin models list` (for example `claude-opus-5-low`). Effort is part of the id, so the node `effort:` field warns and is ignored. Aliases such as `opus` are not accepted: the ACP model option rejects them, and the CLI flag that does accept them silently keeps the default on a typo, which Archon cannot detect. An unknown id fails the turn with Devin's own message listing the available models. Without a `model`, Devin's enterprise default applies and the result reports the resolved id.

### AskHuman and questions

When a workflow node runs on Devin, Archon advertises the ACP elicitation capability and Devin exposes its native `ask_user_question` tool. A question becomes an Archon AskHuman: the run pauses, the turn is cancelled, and after the answer or decline Archon reloads the same Devin session in a new child and sends one message carrying only the validated answer. Single- and multi-select questions are supported; free-text elicitations are not and fail the turn.

### Devin's own configuration

Devin loads its own rules (`CLAUDE.md`, `AGENTS.md`, `.cursor/rules`, `.windsurf/rules`), skills (`~/.config/devin/skills`, `.claude/skills`, `.agents/skills`), hooks (`~/.claude/settings.json`), plugins, subagents, and MCP servers (`~/.config/devin/mcp_config.json`, project `.devin/mcp_config.json`, local `.devin/mcp_config.local.json`) on every session. Archon does not rewrite those files and does not translate its per-node `hooks`, `skills`, `agents`, or `mcp` fields; those warn as unsupported. Per-session MCP servers declared over ACP are spawned by Devin but not exposed to its model on CLI `3000.10.21`, so Archon does not attach any.

### Config keys

Supported `assistants.devin` keys: `model`, `binaryPath`, `agentType` (`summarizer` or `review`), and `refusalFallback` (ordered list of model ids tried when the upstream provider refuses a request). The Web config API exposes no Devin fields; set them in `~/.archon/config.yaml` or `.archon/config.yaml`:

```yaml
assistants:
  devin:
    model: claude-opus-5-low
    refusalFallback:
      - claude-sonnet-5-medium
```

### See also

- [Provider Capability Matrix](/reference/provider-capabilities/) — generated from the Devin capability declaration.
- [Configuration Reference](/reference/configuration/) — `DEVIN_BIN_PATH` and the `assistants.devin` keys.
```

4. Usage table (near line 1012), add after the DeepSeek row:
```markdown
| Devin | Input/output/cached-read/cached-write tokens from the ACP prompt response for that turn; no cost — Devin bills in ACUs on its own account. |
```

- [ ] **Step 4: Document the config surface**

In `configuration.md`:
1. Lines 59 and 449: append `, devin` to the registered provider id lists.
2. After the DeepSeek section (before `### Platform Adapters -- Slack`):
```markdown
### AI Providers -- Devin CLI (community)

| Variable | Description | Default |
| --- | --- | --- |
| `DEVIN_BIN_PATH` | Absolute path to the `devin` executable. Highest precedence, then `assistants.devin.binaryPath`, then `PATH`. | -- |
| `DEVIN_ACP_SETUP_TIMEOUT_MS` | Upper bound for each ACP setup request (`initialize`, `session/new`, `session/load`, `session/set_mode`, `session/set_config_option`). Devin can stall on its remote-config fetch; a stalled request fails the turn with a retry hint. | `60000` |

Login is shared machine-wide through `devin auth login`; Archon reads only whether `$XDG_DATA_HOME/devin/credentials.toml` (default `~/.local/share/devin/credentials.toml`) exists.
Supported `assistants.devin` keys: `model` (exact id from `devin models list`), `binaryPath`, `agentType`, and `refusalFallback`.
`permissionMode` and `sandbox` are rejected at parse time: Archon always runs Devin in `yolo` mode without the sandbox.
The Web config API exposes no Devin fields — set these values in `~/.archon/config.yaml` or `.archon/config.yaml`.
See the [AI Assistants guide](/getting-started/ai-assistants/#devin-cli-community-provider) for setup.
```

- [ ] **Step 5: Document the MCP limitation**

In `guides/mcp-servers.md`, after the sentence on line 19 that lists the providers MCP works with, add: `Devin nodes do not accept Archon's \`mcp:\` field; Devin uses the servers in its own \`~/.config/devin/mcp_config.json\`.` In the transports section near line 403 add a bullet: `- **Devin** — no per-node MCP. ACP-declared per-session servers are spawned but not exposed to the model on CLI 3000.10.21, so \`mcp:\` warns and is ignored; configure servers in Devin's own config instead.`

- [ ] **Step 6: Add the changelog entry**

Under `## [Unreleased]` → `### Added`, add a bullet in the file's narrative style:
```markdown
- **Devin CLI is available as a community provider.** `provider: devin` runs the locally installed Devin CLI over the Agent Client Protocol in the conversation's checkout, using the machine's shared `devin auth login` in Devin's `yolo` tool mode. Session resume, cancellation, structured output (best-effort), env injection, and per-turn token usage are wired. AskHuman rides Devin's native ask-the-user tool through ACP elicitation: a question pauses the run, and after the answer Archon reloads the same Devin session and continues with only the validated answer. Supported-surface summary: wired — `sessionResume`, `structuredOutput`, `envInjection`, `askHuman`; supplied by Devin's own config — rules, skills, hooks, plugins, subagents, MCP servers, refusal fallback; unsupported — per-node `mcp` (per-session ACP servers are not exposed to the model on CLI 3000.10.21), `nativeTools`, `hooks`, `skills`, `agents`, tool restrictions, `effort`/`thinking` (effort is part of the Devin model id), `maxBudgetUsd`, `fallbackModel`, `sandbox`, `settingSources`, container exec. Model aliases are not accepted (exact ids from `devin models list`), and no cost is reported because Devin bills in ACUs.
```

- [ ] **Step 7: Verify docs build and generated files**

```bash
bun run check:capability-matrix && bun --filter @archon/docs-web build
```
Expected: check exits 0; the docs build succeeds (fix any broken anchor the build reports).

- [ ] **Step 8: Commit**

```bash
git add scripts/generate-capability-matrix.ts packages/docs-web/src/content/docs/reference/provider-capabilities.md packages/docs-web/src/content/docs/getting-started/ai-assistants.md packages/docs-web/src/content/docs/reference/configuration.md packages/docs-web/src/content/docs/guides/mcp-servers.md CHANGELOG.md
git commit -m "docs: document the devin community provider and regenerate the capability matrix"
```

## Task 11: Opt-in live smoke against the real Devin CLI

**Files:**
- Create: `packages/providers/src/community/devin/acp-live-smoke.ts`

**Interfaces:**
- Consumes: `DevinProvider`; `AskHumanAwaitingError`, `MessageChunk`, `NativeTool`, `SendQueryOptions` from `../../types`.
- Produces: `bun run spike:devin:acp` (script added in Task 7). Gated by `DEVIN_LIVE_TEST=1`; prints one line per proven step; exit code 1 on any failure. Never run by `bun run test` or CI.

- [ ] **Step 1: Implement the gated smoke**

```ts
// packages/providers/src/community/devin/acp-live-smoke.ts
/**
 * Live smoke for the Devin CLI provider. Diagnostic only — never imported by
 * production code or tests. Requires a logged-in `devin` on PATH and network
 * access; set DEVIN_LIVE_TEST=1 to run. Uses a throwaway git repository and
 * prompts that read nothing and write nothing.
 */
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  AskHumanAwaitingError,
  type MessageChunk,
  type NativeTool,
  type SendQueryOptions,
} from '../../types';
import { DevinProvider } from './provider';

type ResultChunk = Extract<MessageChunk, { type: 'result' }>;

const PONG_PROMPT = 'Reply with exactly the word PONG. Do not use any tools.';
const PONG_AGAIN_PROMPT = 'Reply with exactly the word PONG again. Do not use any tools.';
const ASK_PROMPT =
  'Before answering, you MUST ask me one clarifying question with your ask_user_question tool: ' +
  '"Which color do you prefer?" with options red and blue (single choice). After I answer, reply ' +
  'with exactly: CHOSEN=<my answer> and nothing else. Do not use any other tools.';

function step(name: string, ok: boolean, detail = ''): void {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) process.exitCode = 1;
}

async function collect(stream: AsyncGenerator<MessageChunk>): Promise<{ chunks: MessageChunk[]; thrown?: unknown }> {
  const chunks: MessageChunk[] = [];
  try {
    for await (const chunk of stream) chunks.push(chunk);
  } catch (error) {
    return { chunks, thrown: error };
  }
  return { chunks };
}

function lastResult(chunks: MessageChunk[]): ResultChunk | undefined {
  return chunks.filter((chunk): chunk is ResultChunk => chunk.type === 'result').at(-1);
}

function transcript(chunks: MessageChunk[]): string {
  return chunks.map(chunk => (chunk.type === 'assistant' ? chunk.content : '')).join('').trim();
}

async function main(): Promise<void> {
  if (process.env.DEVIN_LIVE_TEST !== '1') {
    console.log('Devin live smoke skipped (set DEVIN_LIVE_TEST=1 to run).');
    return;
  }
  const cwd = await mkdtemp(join(tmpdir(), 'archon-devin-smoke-'));
  execFileSync('git', ['init', '-q'], { cwd });
  const provider = new DevinProvider();
  const options: SendQueryOptions = process.env.DEVIN_LIVE_MODEL
    ? { model: process.env.DEVIN_LIVE_MODEL }
    : {};

  try {
    // 1. Fresh turn.
    const fresh = await collect(provider.sendQuery(PONG_PROMPT, cwd, undefined, options));
    const freshResult = lastResult(fresh.chunks);
    step('fresh turn returns PONG', transcript(fresh.chunks).includes('PONG') && freshResult?.isError !== true);
    step('fresh turn reports a session id', typeof freshResult?.sessionId === 'string' && freshResult.sessionId.length > 0, freshResult?.sessionId);
    step('fresh turn reports per-turn usage without cost', freshResult?.usageBreakdown?.[0]?.inputTokens !== undefined && freshResult.usageBreakdown[0]?.costUsd === undefined);
    const sessionId = freshResult?.sessionId;
    if (sessionId === undefined) return;

    // 2. Resumed turn in a new process.
    const resumed = await collect(provider.sendQuery(PONG_AGAIN_PROMPT, cwd, sessionId, options));
    const resumedResult = lastResult(resumed.chunks);
    step('resumed turn loads the stored session', resumedResult?.resumed === true && resumedResult.sessionId === sessionId);
    step('resumed turn shows only new output', !transcript(resumed.chunks).includes('PONG\nPONG'), transcript(resumed.chunks));

    // 2b. Injected env reaches Devin's exec tool (bypass mode runs it without a prompt).
    const envTurn = await collect(
      provider.sendQuery(
        'Run the shell command `printf %s "$ARCHON_SMOKE_MARKER"` exactly once with your exec tool and reply with exactly its output and nothing else.',
        cwd,
        undefined,
        { ...options, env: { ARCHON_SMOKE_MARKER: 'archon-env-ok' } }
      )
    );
    step('injected env reaches the exec tool', transcript(envTurn.chunks).includes('archon-env-ok'), transcript(envTurn.chunks));

    // 3. Failed load is terminal.
    const gone = await collect(provider.sendQuery(PONG_PROMPT, cwd, 'no-such-session-xyz', options));
    step('failed session load is terminal', lastResult(gone.chunks)?.errorSubtype === 'devin_session_load_failed');

    // 4. Unsupported model fails with Devin reason.
    const badModel = await collect(provider.sendQuery(PONG_PROMPT, cwd, undefined, { ...options, model: 'no-such-model-xyz' }));
    step('unknown model fails loudly', lastResult(badModel.chunks)?.errorSubtype === 'devin_unsupported_model', lastResult(badModel.chunks)?.errors?.[0]?.slice(0, 80));

    // 5. AskHuman pause through elicitation.
    const seen: { toolUseId?: string; sessionId?: string; questions?: unknown }[] = [];
    const askTool: NativeTool = {
      name: 'AskHuman',
      description: 'smoke',
      inputSchema: { type: 'object' },
      handler: async (input, context) => {
        seen.push({ toolUseId: context?.toolUseId, sessionId: context?.sessionId, questions: input.questions });
        throw new AskHumanAwaitingError(context?.toolUseId ?? 'missing', 'smoke-node', 'smoke-run');
      },
    };
    const paused = await collect(provider.sendQuery(ASK_PROMPT, cwd, undefined, { ...options, nativeTools: [askTool] }));
    step('AskHuman pause throws the control error', paused.thrown instanceof AskHumanAwaitingError);
    step('AskHuman handler received the tool-call id and session id', seen[0]?.toolUseId !== undefined && seen[0]?.sessionId !== undefined, JSON.stringify(seen[0]));
    step('no result chunk after the pause', lastResult(paused.chunks) === undefined);
    const askSession = seen[0]?.sessionId;
    const askToolUseId = seen[0]?.toolUseId;
    if (askSession === undefined || askToolUseId === undefined) return;

    // 6. Re-entry with the answer.
    const reentered = await collect(
      provider.sendQuery(ASK_PROMPT, cwd, askSession, {
        ...options,
        nativeTools: [askTool],
        resumeInteractions: [{ tool_use_id: askToolUseId, payload: [{ questionId: 'q0', value: 'blue' }], declined: false }],
      })
    );
    step('re-entry answers without asking again', transcript(reentered.chunks).includes('CHOSEN=blue') && seen.length === 1, transcript(reentered.chunks));
    step('re-entry reports resumed', lastResult(reentered.chunks)?.resumed === true);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
}

await main();
```

- [ ] **Step 2: Run the safe skip path and lint**

```bash
cd packages/providers && bun run spike:devin:acp && bun run type-check
cd ../.. && bun run lint
```
Expected: prints `Devin live smoke skipped …`, exit 0; lint clean.

- [ ] **Step 3: Run the live smoke once on a logged-in host and record the output**

```bash
cd packages/providers && DEVIN_LIVE_TEST=1 bun run spike:devin:acp
```
Expected: every line starts with `PASS`. Paste the output into the PR description's Validation section. If any line is `FAIL`, the corresponding capability claim is not proven — fix the adapter or lower the flag before opening the PR; do not edit the generated matrix by hand.

- [ ] **Step 4: Commit**

```bash
git add packages/providers/src/community/devin/acp-live-smoke.ts
git commit -m "test(providers): add opt-in live smoke for the devin provider"
```

## Task 12: Final validation and supported-surface audit

**Files:** none new. This task proves the branch and produces the PR body inputs.

- [ ] **Step 1: Run every Devin-focused test in isolation**

```bash
cd packages/providers
for f in config binary-resolver errors async-queue event-bridge elicitation usage acp-client provider provider-lazy-load; do bun test src/community/devin/$f.test.ts || exit 1; done
bun test src/registry.test.ts
cd ../workflows && bun test src/loader.test.ts && bun test src/dag-executor.test.ts
cd ../core && bun test src/credentials/catalog.test.ts
cd ../web && NODE_ENV=development bun test src/experiments/console/components/AgentCredentialCard.test.tsx
```
Expected: PASS everywhere.

- [ ] **Step 2: Audit forbidden and required patterns**

```bash
cd packages/providers/src/community/devin
! grep -n "'--model'" *.ts | grep -v test | grep -v "never" # the flag is never passed
! grep -rn "session.close\|session/close\|session.resume\b" *.ts
! grep -rn "usage_update" acp-client.ts usage.ts
grep -n "import type" acp-client.ts >/dev/null && ! grep -rn "from '@agentclientprotocol/sdk'" provider.ts registration.ts config.ts capabilities.ts binary-resolver.ts errors.ts
grep -rn "elicitation: { form: {} }" acp-client.ts
```
Expected: every negated grep finds nothing; the last grep finds the capability line. Also confirm no test file spawns a real `devin` (only `acp-live-smoke.ts` may).

- [ ] **Step 3: Confirm no leftover processes or temp files**

```bash
pgrep -fl "devin --permission-mode" || echo "no devin children"
git status --porcelain
```
Expected: no stray `devin` processes; `git status` shows only intended files.

- [ ] **Step 4: Run the repository validation**

```bash
bun run validate
```
Expected: every step passes, including `check:capability-matrix`. Fix regressions rather than weakening tests.

- [ ] **Step 5: Assemble the supported-surface report for the PR**

Fill the PR template (`.github/pull_request_template.md`) and include this table in *Solution* (adjust only if the live smoke changed a claim):

| Archon control | Status | Note |
| --- | --- | --- |
| `sessionResume` / `persist_session` | wired | ACP `session/load` in a fresh child; missing session fails the turn. |
| AskHuman (`askHuman`) | wired | Devin `ask_user_question` → ACP elicitation → durable pause → `session/load` + answer message. Single/multi-select only. |
| `output_format` | wired (best-effort) | Prompt augmentation + parse + executor validation/re-ask. |
| `env:` / per-project env | wired | Merged over the host env for the child. |
| Cancellation | wired | Abort → `session/cancel` → SIGTERM/SIGKILL reap. |
| Usage | tokens only | Per-turn ACP `PromptResponse.usage`; no cost (Devin bills in ACUs). |
| Model | exact ids | `session/set_config_option`; aliases rejected; unknown ids fail with Devin's reason. |
| `mcp:` | unsupported | ACP per-session servers are not exposed to the model on CLI 3000.10.21. Devin's own `mcp_config.json` works. |
| `nativeTools` (e.g. `manage_run`) | unsupported | Same root cause; chat uses the CLI-bash run-management prompt section. |
| `hooks`, `skills`, `agents` | supplied by Devin's config | Loaded from `~/.config/devin/`; Archon fields warn. |
| `allowed_tools`/`denied_tools`, `effort`, `thinking`, `maxBudgetUsd`, `fallbackModel`, `sandbox`, `settingSources` | unsupported | Executor warning; effort is encoded in Devin model ids; refusal fallback is Devin config, not Archon `fallbackModel`. |
| Permission mode | wired | `--permission-mode yolo` on the child plus ACP `session/set_mode` → `bypass` on every turn; organization deny/ask rules still apply; bypass withheld → turn fails. |
| Container exec | unsupported | `containerExec: false`; container runs fail fast before dispatch. |
| HTTP/SSE MCP | not applicable | `mcpCapabilities.http/sse: false` and per-node MCP is off. |

Also paste the live-smoke output from Task 11 under *Validation*, and state the CLI version it ran against.

- [ ] **Step 6: Final commit only if validation produced tracked changes**

```bash
git status --porcelain
```
If lint/format touched files, commit them: `git commit -am "chore: apply validation fixes for devin provider"`. Otherwise nothing to commit.

---

## Self-review against the spec

- **Outcome/boundaries** — provider runs the local CLI in Archon's cwd/worktree (Task 5/6), preserves gates, audit events, cancellation, session continuity, AskHuman (Tasks 5, 6, 9); shared login, `yolo`, no second credential (Tasks 2, 8). Capability truthfulness enforced by Task 1's exact-equality test and Task 10's matrix regeneration.
- **Runtime flow 1–9** — binary resolve + start (Task 2/6), cwd/model/yolo/env (Tasks 1, 5, 6), machine login only (Task 2), initialize capability checks (Task 5 `requireAgentCapabilities`), new/load (Task 5), event mapping with stable tool-call ids (Task 3), replay suppression (Task 3/5), abort → cancel + reap (Task 5), real session id returned and no substitute session after a failed load (Task 5 tests).
- **AskHuman** — the spec's MCP bridge is replaced by elicitation (Decision 1, evidence E3–E5); pause writes the pending row via the existing handler, cancels immediately, throws the branded error (Task 5/6); re-entry loads the session and sends only the answer (Tasks 4, 5, 9); no automatic retry (executor contract, Task 9); real-CLI proof before `askHuman: true` ships (Task 11).
- **Permission mode** — `--permission-mode yolo` on the child plus ACP `session/set_mode` → `bypass` each turn because the flag never reaches ACP sessions (E8, Task 5); a permission request is cancelled and ends the turn naming the action; no new permission card (Task 5).
- **Models/config/credentials** — exact ids via config option (Decision 3, Task 5), `agentType` + `refusalFallback` in assistant config only (Task 1), Devin's own config untouched (docs Task 10), status-only credential + settings card (Task 8), run-time login/executable errors (Tasks 2, 5, 6), secret-safe tests (Tasks 2, 5, 6).
- **Capability contract** — `mcp: false` and `nativeTools: false` deviate from the spec targets with evidence (Decision 2); all other target values match.
- **Errors/lifecycle** — separate subtypes for binary, login, protocol, load, model, permission, abort, child exit (Task 2); reaping in every path (Task 5); no age-based lifecycle mutation anywhere.
- **Verification/docs** — unit, fixture, workflow integration, live smoke, docs, regenerated matrix, `bun run validate` (Tasks 1–12).
- **Type consistency check** — `DevinAcpTurnInput.askHuman?: NativeTool` and `resumeInteractions` are produced by Task 6 and consumed by Task 5; `checkDevinReadiness` is exported in Task 7 and consumed in Task 8; `DEVIN_ASK_TOOL_NAME` is defined in Task 3 and used in Task 4; `classifyDevinAcpError` returns `Error` so control errors pass through (Tasks 2, 5, 6).
