# DeepSeek Harness Provider Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.
> Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a first-class community provider `deepseek` (`builtIn: false`) that drives the bundled DeepSeek Harness (`dsh`) runtime over ACP so workflow and chat nodes can select DeepSeek / DashScope.

**Architecture:** Archon (Bun) is the ACP client in-process via `@agentclientprotocol/sdk@1.4.0`.
It spawns the bundled `@deepseek-ai/dsh@0.1.2-rc.1` CLI under a resolved Node binary as `node <dsh-bin> --profile acp`, injects `DEEPSEEK_API_KEY` / `DEEPSEEK_BASE_URL` into the child env, maps `session/update` into `MessageChunk`, auto-answers `session/request_permission` fail-safe, and never throws out of `sendQuery`.

**Tech Stack:** Bun + TypeScript, `@archon/providers` community-provider seam, `@agentclientprotocol/sdk@1.4.0`, `@deepseek-ai/dsh@0.1.2-rc.1`, Bun test.

**Spec:** `docs/superpowers/specs/2026-09-07-deepseek-provider-design.md` (issue #121).

## Global Constraints

- Follow Phase 2: localize the provider under `packages/providers/src/community/deepseek/` plus one aggregator line in `registry.ts`, barrel exports, `package.json` deps/exports/test splits, and `registry.test.ts`.
- Do not edit `packages/core/src/config/config-types.ts`.
- Do not edit `packages/core/src/config/config-loader.ts` (including `SAFE_ASSISTANT_FIELDS`).
- Do not edit credential delivery, the Pi vendor map, or `/api/auth/providers`.
- Do not edit `CHANGELOG.md`.
- Do not manually edit `packages/docs-web/src/content/docs/reference/provider-capabilities.md`.
- Regenerate the matrix with `bun run generate:capability-matrix` after registration.
- Keep `packages/providers/src/types.ts` free of SDK value imports and runtime deps.
- Use complete TypeScript annotations and no `any`.
- All ACP SDK and DSH value imports are lazy `await import()` inside `sendQuery` (or a helper only dynamically imported from `sendQuery`).
- `import type` from `@agentclientprotocol/sdk` is allowed in mapper files.
- Never statically import `@deepseek-ai/dsh`; resolve `lib/bin.js` and spawn it.
- Never assume the Archon host is Node; spawn DSH under a resolved Node binary.
- `askHuman` MUST stay `false`.
- Do not map ACP `usage_update` to `tokens` / `usageBreakdown`.
- Errors never throw out of `sendQuery`; yield a terminal `{ type: 'result', isError: true, ... }`.
- Resume is fail-fast and terminal: if `resumeSessionId` is set and `session/resume` fails, classify the error and stop.
- Never fall back to `session/new` on resume failure.
- Tests must assert `session/new` is not called when resume fails.
- Route and model are selected only via ACP `session/set_config_option` with `configId: 'model'` and `value: JSON.stringify([providerRoute, model])`.
- Do not invent a `DSH_PROVIDER_ROUTE` (or similar) environment variable.
- Tests must assert that `set_config_option` call shape.
- Default permission mode is `workspace-write` (reject prompts); `danger-full-access` is opt-in only.
- Never run `bun test` from the repository root.
- Run package tests through `bun test <relative-file>` from `packages/providers` or `bun --filter @archon/providers test`.
- Keep every new or substantially edited Markdown sentence on its own physical line.
- Never add an agent name as a commit co-author.

## File Structure

Create:

- `packages/providers/src/community/deepseek/capabilities.ts` — `DEEPSEEK_CAPABILITIES`.
- `packages/providers/src/community/deepseek/config.ts` — `parseDeepseekConfig`.
- `packages/providers/src/community/deepseek/config.test.ts`.
- `packages/providers/src/community/deepseek/node-resolver.ts` — Node binary + bundled `dsh` CLI path.
- `packages/providers/src/community/deepseek/node-resolver.test.ts`.
- `packages/providers/src/community/deepseek/event-bridge.ts` — ACP `SessionUpdate` → `MessageChunk[]`.
- `packages/providers/src/community/deepseek/event-bridge.test.ts`.
- `packages/providers/src/community/deepseek/permission.ts` — deterministic permission answers.
- `packages/providers/src/community/deepseek/permission.test.ts`.
- `packages/providers/src/community/deepseek/env.ts` — child env + API-key fail-fast.
- `packages/providers/src/community/deepseek/env.test.ts`.
- `packages/providers/src/community/deepseek/errors.ts` — classified error messages / subtypes.
- `packages/providers/src/community/deepseek/acp-client.ts` — spawn + ACP drive + abort/close.
- `packages/providers/src/community/deepseek/acp-client.test.ts`.
- `packages/providers/src/community/deepseek/provider.ts` — `DeepseekProvider`.
- `packages/providers/src/community/deepseek/provider.test.ts`.
- `packages/providers/src/community/deepseek/provider-lazy-load.test.ts` — own `bun test` invocation.
- `packages/providers/src/community/deepseek/registration.ts`.
- `packages/providers/src/community/deepseek/index.ts`.
- `packages/providers/src/community/deepseek/acp-handshake-spike.ts` — optional live spike, not in the default test script.

Modify:

- `packages/providers/src/types.ts` — add `DeepseekProviderDefaults` after `OpencodeProviderDefaults`.
- `packages/providers/src/registry.ts` — import + call `registerDeepseekProvider()`.
- `packages/providers/src/registry.test.ts` — aggregator assertions + `describe('registerDeepseekProvider')`.
- `packages/providers/src/index.ts` — community export block.
- `packages/providers/package.json` — deps, `exports`, test-script splits, spike script.
- `packages/workflows/src/defaults/tier-defaults.json` — `deepseek` block (see Open Questions).
- `packages/docs-web/src/content/docs/getting-started/ai-assistants.md` — DeepSeek section + usage-table row.
- `packages/docs-web/src/content/docs/reference/configuration.md` — `assistants.deepseek` example.
- `packages/docs-web/src/content/docs/reference/provider-capabilities.md` — generated only.

Do not modify:

- `packages/core/src/config/config-types.ts`
- `packages/core/src/config/config-loader.ts`
- credential delivery / Pi vendor map / auth routes

## Source-Derived Integration Contract

| Concern | Source | Required Archon behavior |
| --- | --- | --- |
| ACP client | `@agentclientprotocol/sdk@1.4.0` `client()`, `ndJsonStream(output, input)`, `methods`, `PROTOCOL_VERSION` | Prefer non-deprecated `client({ name }).onRequest(...).connectWith(stream, op)`. `ClientSideConnection` is deprecated in 1.4.0. |
| Stream adapters | Node `Readable.toWeb` / `Writable.toWeb` | `ndJsonStream(Writable.toWeb(child.stdin), Readable.toWeb(child.stdout))`. Verify under Bun in Task 9. |
| DSH CLI | `@deepseek-ai/dsh@0.1.2-rc.1` `bin.dsh = lib/bin.js` | Spawn `node <resolved lib/bin.js> --profile <profile>` with default profile `acp`. Never `import` the package. |
| Credentials | Pi vendor map already has `deepseek` → `DEEPSEEK_API_KEY` | Registration `credentials.specs` uses vendor `deepseek`. Store the DashScope token there. |
| Base URL | DSH `deepseek-official` prefers `$DEEPSEEK_BASE_URL` | Config `assistants.deepseek.baseUrl` wins over ambient `DEEPSEEK_BASE_URL`. |
| Child env order | Design §4 | `{...process.env}` then `Object.assign(..., options.env)` then explicit `DEEPSEEK_BASE_URL` / `DSH_PERMISSION_MODE`. Acting-user vault key must beat ambient. |
| Model + route | DSH ACP `session/set_config_option` | After session create/resume, call `session/set_config_option` with `configId: 'model'` and `value: JSON.stringify([providerRoute, model])`. Default `providerRoute` is `deepseek-official`. Never set a `DSH_PROVIDER_ROUTE` env var. |
| Resume | ACP `session/resume` | Fail-fast classified error if resume fails. Never fall back to `session/new`. Stamp `resumed: true` only after a successful `session/resume`. |
| Abort | ACP `session/cancel` | Map `abortSignal` to `session/cancel`, reap the child, yield `result` with `stopReason: 'aborted'`. |
| Permissions | ACP `session/request_permission` | Default answer `{ outcome: { outcome: 'cancelled' } }`. `danger-full-access` sets `DSH_PERMISSION_MODE` so DSH should not ask. |
| Usage | ACP `usage_update` is `{used,size}` occupancy | Omit `tokens` and `usageBreakdown`. Do not add a usage-contract test. |
| Structured output | shared helpers | `augmentPromptForJsonSchema` + `tryParseStructuredOutput`. Capability `'best-effort'`. |
| MCP | `loadMcpConfig` + ACP `session/new` `mcpServers` | Translate `nodeConfig.mcp` into ACP `McpServer[]`. Capability `mcp: true`. |

Capability declaration (copy exactly):

```typescript
export const DEEPSEEK_CAPABILITIES: ProviderCapabilities = {
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
};
```

## Open Questions

Provisional defaults are binding for this implementation unless the maintainer overrides them before coding.

1. **Node binary precedence.** Provisional: `DEEPSEEK_NODE_BIN` env, then `assistants.deepseek.nodeBin`, then `process.execPath` when `process.versions.bun` is absent, then `PATH` lookup of `node` / `node.exe`.
2. **Web UI safe config fields.** Issue #121 forbids config-loader edits. Provisional: do not add `SAFE_ASSISTANT_FIELDS.deepseek`. `GET /api/config` shows `assistants.deepseek: {}`. Operators configure YAML.
3. **Tier default model ids.** Provisional: all of `small` / `medium` / `large` use `deepseek-v3` (passthrough id from the design). Operators override in `tiers:` after confirming the DashScope console id.
4. **ACP `fs/*` handlers.** Provisional: do not advertise `fs` client capabilities. If a request still arrives, return a JSON-RPC error so the turn cannot hang. DSH owns workspace tools in-process.

Resolved before coding (not questions):

- Resume failure is terminal and must never call `session/new`.
- `providerRoute` + `model` are applied only through `session/set_config_option` (`configId: 'model'`, `value: JSON.stringify([providerRoute, model])`).

---

### Task 0: Baseline, Design Doc, and Dependencies

**Files:**

- Verify: `docs/superpowers/specs/2026-09-07-deepseek-provider-design.md`
- Modify: `packages/providers/package.json` (dependencies only in this task)
- Modify: root lockfile via `bun add`

**Interfaces:**

- Consumes: none.
- Produces: `@agentclientprotocol/sdk@1.4.0` and `@deepseek-ai/dsh@0.1.2-rc.1` available to later tasks.

- [ ] **Step 1: Capture the worktree state.**

Run:

```bash
git status --short --branch
```

Expected: current feature branch.
Record unrelated dirty paths so later diffs can ignore them.

- [ ] **Step 2: Confirm the design doc is present.**

Run:

```bash
test -f docs/superpowers/specs/2026-09-07-deepseek-provider-design.md && echo present
```

Expected: `present`.
If missing, stop; the spec is required.

- [ ] **Step 3: Run nearest existing baselines from `packages/providers`.**

Run:

```bash
bun test src/registry.test.ts
bun test src/community/omp/config.test.ts
bun test src/shared/resumed.test.ts
bun test src/shared/structured-output.test.ts
```

Expected: all PASS.
If one fails before DeepSeek work, record the exact failure and do not hide it in later commits.

- [ ] **Step 4: Add pinned dependencies.**

From the repo root:

```bash
bun --filter @archon/providers add @agentclientprotocol/sdk@1.4.0 @deepseek-ai/dsh@0.1.2-rc.1
```

Expected: `packages/providers/package.json` lists exact versions `"1.4.0"` and `"0.1.2-rc.1"` (no caret on the SDK pin).
Confirm `bin.dsh` is `lib/bin.js`:

```bash
bun -e "console.log(require('./packages/providers/node_modules/@deepseek-ai/dsh/package.json').bin.dsh)"
```

Expected: `lib/bin.js`.

- [ ] **Step 5: Commit.**

```bash
git add docs/superpowers/specs/2026-09-07-deepseek-provider-design.md packages/providers/package.json bun.lock
git commit -m "chore(providers): pin ACP SDK 1.4.0 and DeepSeek Harness 0.1.2-rc.1"
```

---

### Task 1: Config Parser, Defaults Type, and Capabilities

**Files:**

- Modify: `packages/providers/src/types.ts` (insert after `OpencodeProviderDefaults`)
- Create: `packages/providers/src/community/deepseek/capabilities.ts`
- Create: `packages/providers/src/community/deepseek/config.ts`
- Create: `packages/providers/src/community/deepseek/config.test.ts`

**Interfaces:**

- Consumes: raw `SendQueryOptions.assistantConfig` as `Record<string, unknown>`.
- Produces: `DeepseekProviderDefaults`, `parseDeepseekConfig(raw: Record<string, unknown>): DeepseekProviderDefaults`, `DEEPSEEK_CAPABILITIES: ProviderCapabilities`, `DEEPSEEK_PERMISSION_MODES`, `DEEPSEEK_EFFORTS`.

- [ ] **Step 1: Write the failing config tests.**

Create `packages/providers/src/community/deepseek/config.test.ts`:

```typescript
import { describe, expect, test } from 'bun:test';

import { DEEPSEEK_CAPABILITIES } from './capabilities';
import { parseDeepseekConfig } from './config';

describe('DEEPSEEK_CAPABILITIES', () => {
  test('declares the v1 ACP surface and keeps askHuman false', () => {
    expect(DEEPSEEK_CAPABILITIES).toEqual({
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
    });
  });
});

describe('parseDeepseekConfig', () => {
  test('returns empty object for empty input', () => {
    expect(parseDeepseekConfig({})).toEqual({});
  });

  test('parses the supported DeepSeek defaults', () => {
    expect(
      parseDeepseekConfig({
        model: ' deepseek-v3 ',
        baseUrl: ' https://dashscope-intl.aliyuncs.com/compatible-mode/v1 ',
        providerRoute: ' deepseek-official ',
        profile: ' acp ',
        permissionMode: 'workspace-write',
        maxTokens: 65536,
        effort: 'high',
        nodeBin: ' /usr/bin/node ',
        ignored: 'value',
      })
    ).toEqual({
      model: 'deepseek-v3',
      baseUrl: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1',
      providerRoute: 'deepseek-official',
      profile: 'acp',
      permissionMode: 'workspace-write',
      maxTokens: 65536,
      effort: 'high',
      nodeBin: '/usr/bin/node',
    });
  });

  test('rejects blank or non-string string fields', () => {
    expect(() => parseDeepseekConfig({ model: '   ' })).toThrow('assistants.deepseek.model');
    expect(() => parseDeepseekConfig({ baseUrl: 42 })).toThrow('assistants.deepseek.baseUrl');
    expect(() => parseDeepseekConfig({ nodeBin: '' })).toThrow('assistants.deepseek.nodeBin');
  });

  test('rejects invalid permissionMode', () => {
    expect(() => parseDeepseekConfig({ permissionMode: 'yolo' })).toThrow('permissionMode');
  });

  test('accepts danger-full-access', () => {
    expect(parseDeepseekConfig({ permissionMode: 'danger-full-access' })).toEqual({
      permissionMode: 'danger-full-access',
    });
  });

  test('rejects non-positive maxTokens', () => {
    expect(() => parseDeepseekConfig({ maxTokens: 0 })).toThrow('maxTokens');
    expect(() => parseDeepseekConfig({ maxTokens: 1.5 })).toThrow('maxTokens');
  });

  test('rejects empty effort', () => {
    expect(() => parseDeepseekConfig({ effort: '' })).toThrow('non-empty string');
  });
});
```

- [ ] **Step 2: Run tests and confirm they fail for missing modules.**

Run from `packages/providers`:

```bash
bun test src/community/deepseek/config.test.ts
```

Expected: FAIL because `./config` / `./capabilities` do not exist.

- [ ] **Step 3: Add `DeepseekProviderDefaults` to `packages/providers/src/types.ts` immediately after `OpencodeProviderDefaults`.**

```typescript
/**
 * Community provider defaults for DeepSeek Harness (`dsh`) over ACP.
 */
export interface DeepseekProviderDefaults {
  [key: string]: unknown;
  /** Passthrough model id (for example `deepseek-v3`). */
  model?: string;
  /** OpenAI-compatible base URL injected as `DEEPSEEK_BASE_URL`. */
  baseUrl?: string;
  /**
   * DSH LLM route used as the first element of `session/set_config_option`
   * `configId: 'model'` value `JSON.stringify([providerRoute, model])`.
   * Default at session setup: `deepseek-official`.
   */
  providerRoute?: string;
  /** DSH profile name. Default at spawn time: `acp`. */
  profile?: string;
  /** Permission policy. Default at spawn time: `workspace-write`. */
  permissionMode?: 'workspace-write' | 'danger-full-access';
  /** Optional token cap (not USD). */
  maxTokens?: number;
  /** Provider-owned effort string (`off`/`low`/`high`/`max` or a ladder rung). */
  effort?: string;
  /** Absolute path to a Node binary used to spawn `dsh`. */
  nodeBin?: string;
}
```

- [ ] **Step 4: Implement capabilities and the parser.**

Create `packages/providers/src/community/deepseek/capabilities.ts`:

```typescript
import type { ProviderCapabilities } from '../../types';

export const DEEPSEEK_CAPABILITIES: ProviderCapabilities = {
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
};
```

Create `packages/providers/src/community/deepseek/config.ts`:

```typescript
import type { DeepseekProviderDefaults } from '../../types';

export type { DeepseekProviderDefaults };

export const DEEPSEEK_PERMISSION_MODES = ['workspace-write', 'danger-full-access'] as const;
export type DeepseekPermissionMode = (typeof DEEPSEEK_PERMISSION_MODES)[number];

export const DEEPSEEK_EFFORTS = ['off', 'low', 'high', 'max'] as const;
export type DeepseekEffort = (typeof DEEPSEEK_EFFORTS)[number];

export const DEFAULT_DEEPSEEK_PROVIDER_ROUTE = 'deepseek-official';
export const DEFAULT_DEEPSEEK_PROFILE = 'acp';

function parseTrimmedString(
  raw: Record<string, unknown>,
  field: 'model' | 'baseUrl' | 'providerRoute' | 'profile' | 'effort' | 'nodeBin'
): string | undefined {
  const value = raw[field];
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`Invalid assistants.deepseek.${field}: expected a non-empty string.`);
  }
  return value.trim();
}

function parsePermissionMode(value: unknown): DeepseekPermissionMode | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || !(DEEPSEEK_PERMISSION_MODES as readonly string[]).includes(value)) {
    throw new Error(
      'Invalid assistants.deepseek.permissionMode: expected "workspace-write" or "danger-full-access".'
    );
  }
  return value as DeepseekPermissionMode;
}

function parseMaxTokens(value: unknown): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
    throw new Error('Invalid assistants.deepseek.maxTokens: expected a positive integer.');
  }
  return value;
}

export function parseDeepseekConfig(raw: Record<string, unknown>): DeepseekProviderDefaults {
  const config: DeepseekProviderDefaults = {};
  const model = parseTrimmedString(raw, 'model');
  const baseUrl = parseTrimmedString(raw, 'baseUrl');
  const providerRoute = parseTrimmedString(raw, 'providerRoute');
  const profile = parseTrimmedString(raw, 'profile');
  const permissionMode = parsePermissionMode(raw.permissionMode);
  const maxTokens = parseMaxTokens(raw.maxTokens);
  const effort = parseTrimmedString(raw, 'effort');
  const nodeBin = parseTrimmedString(raw, 'nodeBin');

  if (model !== undefined) config.model = model;
  if (baseUrl !== undefined) config.baseUrl = baseUrl;
  if (providerRoute !== undefined) config.providerRoute = providerRoute;
  if (profile !== undefined) config.profile = profile;
  if (permissionMode !== undefined) config.permissionMode = permissionMode;
  if (maxTokens !== undefined) config.maxTokens = maxTokens;
  if (effort !== undefined) config.effort = effort;
  if (nodeBin !== undefined) config.nodeBin = nodeBin;
  return config;
}
```

- [ ] **Step 5: Run tests and confirm they pass.**

```bash
bun test src/community/deepseek/config.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit.**

```bash
git add packages/providers/src/types.ts packages/providers/src/community/deepseek/capabilities.ts packages/providers/src/community/deepseek/config.ts packages/providers/src/community/deepseek/config.test.ts
git commit -m "feat(providers): add DeepSeek config parser and capabilities"
```

---

### Task 2: Node Binary and Bundled `dsh` Resolvers

**Files:**

- Create: `packages/providers/src/community/deepseek/node-resolver.ts`
- Create: `packages/providers/src/community/deepseek/node-resolver.test.ts`

**Interfaces:**

- Consumes: `config.nodeBin`, `env.DEEPSEEK_NODE_BIN`, `process.execPath`, `PATH`.
- Produces: `resolveNodeBinaryPath(configNodeBin?: string, env?: Record<string, string | undefined>): Promise<string>` and `resolveDshCliPath(): string`.

- [ ] **Step 1: Write the failing resolver tests.**

Create `packages/providers/src/community/deepseek/node-resolver.test.ts`:

```typescript
import { afterEach, describe, expect, test } from 'bun:test';
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { resolveDshCliPath, resolveNodeBinaryPath } from './node-resolver';

const originalEnvPath = process.env.DEEPSEEK_NODE_BIN;

async function makeExecutable(name: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'archon-deepseek-node-'));
  const path = join(dir, name);
  await writeFile(path, '#!/usr/bin/env sh\nexit 0\n');
  await chmod(path, 0o755);
  return path;
}

describe('resolveNodeBinaryPath', () => {
  afterEach(() => {
    if (originalEnvPath === undefined) delete process.env.DEEPSEEK_NODE_BIN;
    else process.env.DEEPSEEK_NODE_BIN = originalEnvPath;
  });

  test('prefers DEEPSEEK_NODE_BIN over config.nodeBin', async () => {
    const envPath = await makeExecutable('node');
    const configPath = await makeExecutable('other-node');
    process.env.DEEPSEEK_NODE_BIN = envPath;
    try {
      await expect(resolveNodeBinaryPath(configPath)).resolves.toBe(envPath);
    } finally {
      await rm(dirname(envPath), { recursive: true, force: true });
      await rm(dirname(configPath), { recursive: true, force: true });
    }
  });

  test('uses config.nodeBin when the env override is absent', async () => {
    delete process.env.DEEPSEEK_NODE_BIN;
    const path = await makeExecutable('node');
    try {
      await expect(resolveNodeBinaryPath(path, {})).resolves.toBe(path);
    } finally {
      await rm(dirname(path), { recursive: true, force: true });
    }
  });

  test('rejects a missing DEEPSEEK_NODE_BIN with an actionable label', async () => {
    await expect(
      resolveNodeBinaryPath(undefined, { DEEPSEEK_NODE_BIN: '/definitely/missing/node' })
    ).rejects.toThrow('DEEPSEEK_NODE_BIN');
  });
});

describe('resolveDshCliPath', () => {
  test('resolves the bundled @deepseek-ai/dsh lib/bin.js', () => {
    const path = resolveDshCliPath();
    expect(path.replaceAll('\\', '/')).toMatch(/@deepseek-ai\/dsh\/lib\/bin\.js$/);
  });
});
```

- [ ] **Step 2: Run tests and confirm they fail.**

```bash
bun test src/community/deepseek/node-resolver.test.ts
```

Expected: FAIL because `./node-resolver` does not exist.

- [ ] **Step 3: Implement the resolvers.**

Create `packages/providers/src/community/deepseek/node-resolver.ts`:

```typescript
import { accessSync, constants as fsConstants, existsSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { basename } from 'node:path';

const require = createRequire(import.meta.url);

export function isExecutableFile(path: string): boolean {
  try {
    accessSync(path, fsConstants.X_OK);
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

function definedEnv(env: Record<string, string | undefined>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(env).filter((entry): entry is [string, string] => entry[1] !== undefined)
  );
}

function assertExecutable(path: string, sourceLabel: string): string {
  if (!existsSync(path)) {
    throw new Error(`${sourceLabel} points at a missing file: ${path}`);
  }
  if (!isExecutableFile(path)) {
    throw new Error(`${sourceLabel} is not an executable file: ${path}`);
  }
  return path;
}

export function resolveFromPath(
  binary: string,
  env: Record<string, string | undefined> = process.env
): string | undefined {
  const lookupCmd = process.platform === 'win32' ? 'where' : 'which';
  try {
    const output = execFileSync(lookupCmd, [binary], {
      encoding: 'utf8',
      env: definedEnv(env),
    });
    const first = output.split(/\r?\n/).map(line => line.trim()).find(Boolean);
    return first;
  } catch {
    return undefined;
  }
}

function isHostNode(): boolean {
  return process.versions.bun === undefined && /^node(\.exe)?$/i.test(basename(process.execPath));
}

export async function resolveNodeBinaryPath(
  configNodeBin?: string,
  env: Record<string, string | undefined> = process.env
): Promise<string> {
  const envPath = env.DEEPSEEK_NODE_BIN?.trim();
  if (envPath) return assertExecutable(envPath, 'DEEPSEEK_NODE_BIN');
  if (configNodeBin) return assertExecutable(configNodeBin, 'assistants.deepseek.nodeBin');
  if (isHostNode()) return assertExecutable(process.execPath, 'process.execPath');
  const fromPath = resolveFromPath(process.platform === 'win32' ? 'node.exe' : 'node', env);
  if (fromPath) return assertExecutable(fromPath, 'PATH node');
  throw new Error(
    'DeepSeek Harness needs a Node binary to spawn `dsh`. Set DEEPSEEK_NODE_BIN or assistants.deepseek.nodeBin, or install Node on PATH.'
  );
}

export function resolveDshCliPath(): string {
  return require.resolve('@deepseek-ai/dsh/lib/bin.js');
}
```

- [ ] **Step 4: Run tests and confirm they pass.**

```bash
bun test src/community/deepseek/node-resolver.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add packages/providers/src/community/deepseek/node-resolver.ts packages/providers/src/community/deepseek/node-resolver.test.ts
git commit -m "feat(providers): resolve Node and bundled dsh for DeepSeek ACP"
```

---

### Task 3: ACP `session/update` Event Bridge

**Files:**

- Create: `packages/providers/src/community/deepseek/event-bridge.ts`
- Create: `packages/providers/src/community/deepseek/event-bridge.test.ts`

**Interfaces:**

- Consumes: ACP SDK `SessionUpdate` (`import type` only).
- Produces: `mapSessionUpdate(update: SessionUpdate, ctx: EventBridgeContext): MessageChunk[]` and `buildResultChunk(input: { sessionId: string; stopReason: string; assistantText?: string; jsonSchema?: Record<string, unknown> }): MessageChunk`.

- [ ] **Step 1: Write the failing mapper tests.**

Create `packages/providers/src/community/deepseek/event-bridge.test.ts`:

```typescript
import { describe, expect, test } from 'bun:test';
import type { SessionUpdate } from '@agentclientprotocol/sdk';

import { buildResultChunk, createEventBridgeContext, mapSessionUpdate } from './event-bridge';

function textChunk(sessionUpdate: 'agent_message_chunk' | 'agent_thought_chunk', text: string): SessionUpdate {
  return {
    sessionUpdate,
    content: { type: 'text', text },
  } as SessionUpdate;
}

describe('mapSessionUpdate', () => {
  test('maps agent message text to assistant chunks', () => {
    const ctx = createEventBridgeContext();
    expect(mapSessionUpdate(textChunk('agent_message_chunk', 'Hello'), ctx)).toEqual([
      { type: 'assistant', content: 'Hello' },
    ]);
  });

  test('maps agent thought text to thinking chunks', () => {
    const ctx = createEventBridgeContext();
    expect(mapSessionUpdate(textChunk('agent_thought_chunk', 'hmm'), ctx)).toEqual([
      { type: 'thinking', content: 'hmm' },
    ]);
  });

  test('maps tool_call start and completed update to tool + tool_result', () => {
    const ctx = createEventBridgeContext();
    const start = mapSessionUpdate(
      {
        sessionUpdate: 'tool_call',
        toolCallId: 'call-1',
        title: 'Read README',
        name: 'read',
        status: 'pending',
        rawInput: { path: 'README.md' },
      } as SessionUpdate,
      ctx
    );
    expect(start).toEqual([
      {
        type: 'tool',
        toolName: 'read',
        toolInput: { path: 'README.md' },
        toolCallId: 'call-1',
      },
    ]);

    const end = mapSessionUpdate(
      {
        sessionUpdate: 'tool_call_update',
        toolCallId: 'call-1',
        status: 'completed',
        rawOutput: 'ok',
      } as SessionUpdate,
      ctx
    );
    expect(end).toEqual([
      {
        type: 'tool_result',
        toolName: 'read',
        toolOutput: 'ok',
        toolCallId: 'call-1',
        toolOutcome: 'success',
      },
    ]);
  });

  test('maps failed tool updates to toolOutcome error', () => {
    const ctx = createEventBridgeContext();
    mapSessionUpdate(
      {
        sessionUpdate: 'tool_call',
        toolCallId: 'call-2',
        title: 'Bash',
        name: 'bash',
        status: 'in_progress',
      } as SessionUpdate,
      ctx
    );
    const end = mapSessionUpdate(
      {
        sessionUpdate: 'tool_call_update',
        toolCallId: 'call-2',
        status: 'failed',
        rawOutput: 'boom',
      } as SessionUpdate,
      ctx
    );
    expect(end[0]).toMatchObject({
      type: 'tool_result',
      toolCallId: 'call-2',
      toolOutcome: 'error',
      toolOutput: 'boom',
    });
  });

  test('does not map usage_update to tokens', () => {
    const ctx = createEventBridgeContext();
    expect(
      mapSessionUpdate(
        { sessionUpdate: 'usage_update', used: 12, size: 100 } as SessionUpdate,
        ctx
      )
    ).toEqual([]);
  });
});

describe('buildResultChunk', () => {
  test('omits tokens and usageBreakdown', () => {
    const chunk = buildResultChunk({
      sessionId: 'sess-1',
      stopReason: 'end_turn',
      assistantText: '{"ok":true}',
      jsonSchema: { type: 'object' },
    });
    expect(chunk).toMatchObject({
      type: 'result',
      sessionId: 'sess-1',
      stopReason: 'end_turn',
      structuredOutput: { ok: true },
    });
    expect(chunk).not.toHaveProperty('tokens');
    expect(chunk).not.toHaveProperty('usageBreakdown');
  });
});
```

- [ ] **Step 2: Run tests and confirm they fail.**

```bash
bun test src/community/deepseek/event-bridge.test.ts
```

Expected: FAIL because `./event-bridge` does not exist.

- [ ] **Step 3: Implement the mapper.**

Create `packages/providers/src/community/deepseek/event-bridge.ts`:

```typescript
import { createLogger } from '@archon/paths';
import type { SessionUpdate } from '@agentclientprotocol/sdk';

import type { MessageChunk } from '../../types';
import { tryParseStructuredOutput } from '../../shared/structured-output';

let cachedLog: ReturnType<typeof createLogger> | undefined;
function getLog(): ReturnType<typeof createLogger> {
  if (!cachedLog) cachedLog = createLogger('provider.deepseek');
  return cachedLog;
}

export interface EventBridgeContext {
  toolCallIdToName: Map<string, string>;
  assistantText: string;
}

export function createEventBridgeContext(): EventBridgeContext {
  return { toolCallIdToName: new Map(), assistantText: '' };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function textFromContent(content: unknown): string {
  if (!isRecord(content)) return '';
  if (content.type === 'text' && typeof content.text === 'string') return content.text;
  return '';
}

function serializeOutput(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value === undefined || value === null) return '';
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

export function mapSessionUpdate(update: SessionUpdate, ctx: EventBridgeContext): MessageChunk[] {
  switch (update.sessionUpdate) {
    case 'agent_message_chunk': {
      const content = textFromContent(update.content);
      if (!content) return [];
      ctx.assistantText += content;
      return [{ type: 'assistant', content }];
    }
    case 'agent_thought_chunk': {
      const content = textFromContent(update.content);
      if (!content) return [];
      return [{ type: 'thinking', content }];
    }
    case 'tool_call': {
      const toolName = update.name?.trim() || update.title || 'unknown';
      ctx.toolCallIdToName.set(update.toolCallId, toolName);
      const toolInput = isRecord(update.rawInput) ? update.rawInput : {};
      return [
        {
          type: 'tool',
          toolName,
          toolInput,
          toolCallId: update.toolCallId,
        },
      ];
    }
    case 'tool_call_update': {
      if (update.status !== 'completed' && update.status !== 'failed') return [];
      const toolName = ctx.toolCallIdToName.get(update.toolCallId) ?? update.name?.trim() ?? 'unknown';
      return [
        {
          type: 'tool_result',
          toolName,
          toolOutput: serializeOutput(update.rawOutput),
          toolCallId: update.toolCallId,
          toolOutcome: update.status === 'completed' ? 'success' : 'error',
        },
      ];
    }
    case 'usage_update':
      return [];
    default:
      getLog().debug({ sessionUpdate: update.sessionUpdate }, 'deepseek.unhandled_session_update');
      return [];
  }
}

export function buildResultChunk(input: {
  sessionId: string;
  stopReason: string;
  assistantText?: string;
  jsonSchema?: Record<string, unknown>;
}): MessageChunk {
  const chunk: MessageChunk = {
    type: 'result',
    sessionId: input.sessionId,
    stopReason: input.stopReason,
  };
  if (input.jsonSchema && input.assistantText) {
    const parsed = tryParseStructuredOutput(input.assistantText);
    if (parsed !== undefined) {
      return { ...chunk, structuredOutput: parsed };
    }
  }
  return chunk;
}
```

If `SessionUpdate` field names differ from this sketch (`used`/`size` on `usage_update`, `name` on `tool_call`), adjust the mapper to the SDK types until `bun x tsc --noEmit` in `@archon/providers` is clean.
Do not invent billing fields.

- [ ] **Step 4: Run tests and confirm they pass.**

```bash
bun test src/community/deepseek/event-bridge.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add packages/providers/src/community/deepseek/event-bridge.ts packages/providers/src/community/deepseek/event-bridge.test.ts
git commit -m "feat(providers): map DeepSeek ACP session updates to MessageChunk"
```

---

### Task 4: Permission Policy, Child Env, and Error Classification

**Files:**

- Create: `packages/providers/src/community/deepseek/permission.ts`
- Create: `packages/providers/src/community/deepseek/permission.test.ts`
- Create: `packages/providers/src/community/deepseek/env.ts`
- Create: `packages/providers/src/community/deepseek/env.test.ts`
- Create: `packages/providers/src/community/deepseek/errors.ts`

**Interfaces:**

- Consumes: `DeepseekPermissionMode`, `DeepseekProviderDefaults`, `options.env`.
- Produces: `answerPermissionRequest(): { outcome: { outcome: 'cancelled' } }`, `buildDeepseekChildEnv(...)`, `classifyDeepseekError(error: unknown): { errorSubtype: string; message: string }`.

- [ ] **Step 1: Write failing permission and env tests.**

Create `packages/providers/src/community/deepseek/permission.test.ts`:

```typescript
import { describe, expect, test } from 'bun:test';

import { answerPermissionRequest } from './permission';

describe('answerPermissionRequest', () => {
  test('always cancels so the default policy never auto-approves', () => {
    expect(answerPermissionRequest()).toEqual({ outcome: { outcome: 'cancelled' } });
  });
});
```

Create `packages/providers/src/community/deepseek/env.test.ts`:

```typescript
import { describe, expect, test } from 'bun:test';

import { buildDeepseekChildEnv } from './env';

describe('buildDeepseekChildEnv', () => {
  test('lets options.env beat ambient API keys', () => {
    const env = buildDeepseekChildEnv({
      ambient: { DEEPSEEK_API_KEY: 'ambient-key', PATH: '/bin' },
      requestEnv: { DEEPSEEK_API_KEY: 'vault-key' },
      config: {},
      permissionMode: 'workspace-write',
    });
    expect(env.DEEPSEEK_API_KEY).toBe('vault-key');
    expect(env.DSH_PERMISSION_MODE).toBe('workspace-write');
  });

  test('lets config.baseUrl beat ambient DEEPSEEK_BASE_URL', () => {
    const env = buildDeepseekChildEnv({
      ambient: { DEEPSEEK_API_KEY: 'k', DEEPSEEK_BASE_URL: 'https://ambient.example/v1' },
      requestEnv: {},
      config: { baseUrl: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1' },
      permissionMode: 'workspace-write',
    });
    expect(env.DEEPSEEK_BASE_URL).toBe('https://dashscope-intl.aliyuncs.com/compatible-mode/v1');
  });

  test('does not invent a DSH_PROVIDER_ROUTE env var', () => {
    const env = buildDeepseekChildEnv({
      ambient: { DEEPSEEK_API_KEY: 'k' },
      requestEnv: {},
      config: { providerRoute: 'deepseek-official' },
      permissionMode: 'danger-full-access',
    });
    expect(env.DSH_PROVIDER_ROUTE).toBeUndefined();
    expect(env.DSH_PERMISSION_MODE).toBe('danger-full-access');
  });

  test('throws when no API key resolves', () => {
    expect(() =>
      buildDeepseekChildEnv({
        ambient: {},
        requestEnv: {},
        config: {},
        permissionMode: 'workspace-write',
      })
    ).toThrow('DEEPSEEK_API_KEY');
  });
});
```

- [ ] **Step 2: Run tests and confirm they fail.**

```bash
bun test src/community/deepseek/permission.test.ts
bun test src/community/deepseek/env.test.ts
```

Expected: FAIL because the modules do not exist.

- [ ] **Step 3: Implement permission, env, and errors.**

Create `packages/providers/src/community/deepseek/permission.ts`:

```typescript
export function answerPermissionRequest(): { outcome: { outcome: 'cancelled' } } {
  return { outcome: { outcome: 'cancelled' } };
}
```

Create `packages/providers/src/community/deepseek/env.ts`:

```typescript
import type { DeepseekPermissionMode, DeepseekProviderDefaults } from './config';

export interface BuildDeepseekChildEnvInput {
  ambient: Record<string, string | undefined>;
  requestEnv: Record<string, string> | undefined;
  config: DeepseekProviderDefaults;
  permissionMode: DeepseekPermissionMode;
}

export function buildDeepseekChildEnv(input: BuildDeepseekChildEnvInput): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(input.ambient)) {
    if (value !== undefined) env[key] = value;
  }
  if (input.requestEnv) Object.assign(env, input.requestEnv);
  if (input.config.baseUrl) env.DEEPSEEK_BASE_URL = input.config.baseUrl;
  env.DSH_PERMISSION_MODE = input.permissionMode;
  if (!env.DEEPSEEK_API_KEY || env.DEEPSEEK_API_KEY.trim().length === 0) {
    throw new Error(
      'DeepSeek requires DEEPSEEK_API_KEY (store the DashScope token as vendor `deepseek` or export it in the environment).'
    );
  }
  return env;
}
```

Create `packages/providers/src/community/deepseek/errors.ts`:

```typescript
export function classifyDeepseekError(error: unknown): { errorSubtype: string; message: string } {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes('DEEPSEEK_API_KEY')) {
    return { errorSubtype: 'deepseek_missing_api_key', message };
  }
  if (message.includes('resume') || message.includes('session/resume')) {
    return { errorSubtype: 'deepseek_resume_failed', message };
  }
  if (message.includes('Node binary') || message.includes('DEEPSEEK_NODE_BIN') || message.includes('spawn')) {
    return { errorSubtype: 'deepseek_spawn_failed', message };
  }
  return { errorSubtype: 'deepseek_acp_error', message };
}
```

- [ ] **Step 4: Run tests and confirm they pass.**

```bash
bun test src/community/deepseek/permission.test.ts
bun test src/community/deepseek/env.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add packages/providers/src/community/deepseek/permission.ts packages/providers/src/community/deepseek/permission.test.ts packages/providers/src/community/deepseek/env.ts packages/providers/src/community/deepseek/env.test.ts packages/providers/src/community/deepseek/errors.ts
git commit -m "feat(providers): add DeepSeek permission policy and child env"
```

---

### Task 5: ACP Client Drive (In-Process Fake Agent)

**Files:**

- Create: `packages/providers/src/community/deepseek/acp-client.ts`
- Create: `packages/providers/src/community/deepseek/acp-client.test.ts`

**Interfaces:**

- Consumes: `Stream` from `@agentclientprotocol/sdk`, `mapSessionUpdate`, `answerPermissionRequest`.
- Produces: `runDeepseekAcpTurn(input: DeepseekAcpTurnInput): AsyncGenerator<MessageChunk>`.

```typescript
export interface DeepseekAcpTurnInput {
  transport: Stream | AgentApp;
  cwd: string;
  prompt: string;
  resumeSessionId?: string;
  abortSignal?: AbortSignal;
  model?: string;
  providerRoute?: string;
  effort?: string;
  maxTokens?: number;
  jsonSchema?: Record<string, unknown>;
  mcpServers?: McpServer[];
}
```

Use the SDK's in-process `client().connectWith(agentApp)` so these tests do not spawn `dsh` and do not need `mock.module`.

- [ ] **Step 1: Write failing ACP client tests.**

Create `packages/providers/src/community/deepseek/acp-client.test.ts` that builds a fake `agent({ name: 'fake-dsh' })` handling `initialize`, `session/new`, `session/prompt`, `session/cancel`, `session/close`, `session/set_config_option`, and `session/resume`.

Required cases (do not skip either of the first two):

1. **Model/route option shape.** On a fresh turn with `model: 'deepseek-v3'` and `providerRoute: 'deepseek-official'`, the fake records `session/set_config_option` calls.
   Expect at least one call whose params include `configId: 'model'` and `value: JSON.stringify(['deepseek-official', 'deepseek-v3'])`.
   Default `providerRoute` to `'deepseek-official'` when the input omits it but `model` is set.
   Do not call `session/set_config_option` for model when both `model` and `providerRoute` are omitted.

2. **Resume failure is terminal.** When `resumeSessionId` is set and the fake `session/resume` throws, `runDeepseekAcpTurn` rejects (or the generator yields a classified resume error and completes) and the fake's `sessionNewCalls` counter stays `0`.
   The fake must increment `sessionNewCalls` only from the `session/new` handler.

3. Fresh `session/prompt` notifies one `agent_message_chunk` then returns `{ stopReason: 'end_turn' }`.
   Assert assistant chunk `'Hello'` and a terminal result with `sessionId`, `stopReason: 'end_turn'`, and no `tokens`.

4. Successful `session/resume` does not increment `sessionNewCalls` and the turn continues on the resumed id.

5. When `abortSignal` aborts during prompt, the fake records `session/cancel` and the generator yields `stopReason: 'aborted'`.

6. The client registers `session/request_permission` and answers `{ outcome: { outcome: 'cancelled' } }`.

Use SDK exports:

```typescript
import { agent, client, methods, PROTOCOL_VERSION } from '@agentclientprotocol/sdk';
```

Because Task 6 will dynamic-import this whole file from `sendQuery`, static SDK imports in `acp-client.ts` are allowed.

- [ ] **Step 2: Run tests and confirm they fail.**

```bash
bun test src/community/deepseek/acp-client.test.ts
```

Expected: FAIL because `./acp-client` does not exist.

- [ ] **Step 3: Implement `runDeepseekAcpTurn`.**

Required control flow:

1. `client({ name: 'archon-deepseek' }).onRequest(methods.client.session.requestPermission, async () => answerPermissionRequest())`.
2. `connectWith(input.transport, async (ctx) => { ... })`.
3. `ctx.request(methods.agent.initialize, { protocolVersion: PROTOCOL_VERSION, clientInfo: { name: 'archon', version: 'deepseek' }, clientCapabilities: {} })`.
   If the SDK's `InitializeRequest` field names differ, match the generated type exactly.
4. If `resumeSessionId` is set, call only `ctx.request(methods.agent.session.resume, { sessionId: resumeSessionId, cwd: input.cwd })`.
   On failure, throw `Error('session/resume failed: ...')`.
   Do not call `session/new` on any resume path, including after the throw.
5. Else `ctx.buildSession({ cwd: input.cwd, mcpServers: input.mcpServers ?? [] }).start()`.
6. After a successful new or resumed session, if `model` is set (or `providerRoute` is set), call `methods.agent.session.setConfigOption` with:

```typescript
{
  sessionId,
  configId: 'model',
  value: JSON.stringify([input.providerRoute ?? 'deepseek-official', input.model ?? '']),
}
```

   If `effort` is set, also call `setConfigOption` with `configId: 'reasoning_effort'` and the mapped effort string.
   If `maxTokens` is set, also call `setConfigOption` with `configId: 'max_tokens'` and `String(maxTokens)`.
   Ignore unknown-option errors after logging `deepseek.config_option_ignored`.
   Never write `DSH_PROVIDER_ROUTE` anywhere.

7. Call `session.prompt(input.prompt)` or `ctx.request(methods.agent.session.prompt, { sessionId, prompt: [{ type: 'text', text: input.prompt }] })`.
8. Loop `session.nextUpdate()` until `kind === 'stop'`.
   Yield `mapSessionUpdate` chunks for `session_update`.
9. On `input.abortSignal`, `ctx.request(methods.agent.session.cancel, { sessionId })` then yield `{ type: 'result', sessionId, stopReason: 'aborted' }` and return.
10. Yield `buildResultChunk({ sessionId, stopReason, assistantText, jsonSchema })`.
11. `finally`: `ctx.request(methods.agent.session.close, { sessionId })` best-effort.

Effort mapping before `reasoning_effort`:

- `off` → `off`
- ladder `minimal` → `off`
- `clampEffort(value, ['low', 'high', 'max'])` for other rungs (`medium` → `low`, `xhigh` → `high`)
- unknown non-empty string: pass through once; if DSH rejects, log and continue

Do not implement a Node sidecar in this task.

- [ ] **Step 4: Run tests and confirm they pass.**

```bash
bun test src/community/deepseek/acp-client.test.ts
```

Expected: PASS, including the `set_config_option` shape assertion and `sessionNewCalls === 0` on resume failure.

- [ ] **Step 5: Commit.**

```bash
git add packages/providers/src/community/deepseek/acp-client.ts packages/providers/src/community/deepseek/acp-client.test.ts
git commit -m "feat(providers): drive DeepSeek Harness over ACP client"
```

---

### Task 6: `DeepseekProvider.sendQuery`

**Files:**

- Create: `packages/providers/src/community/deepseek/provider.ts`
- Create: `packages/providers/src/community/deepseek/provider.test.ts`

**Interfaces:**

- Consumes: `parseDeepseekConfig`, `buildDeepseekChildEnv`, `resolveNodeBinaryPath`, `resolveDshCliPath`, `runDeepseekAcpTurn`, `loadMcpConfig`, `augmentPromptForJsonSchema`, `withResumedOutcome` / `resumedOutcome`, `classifyDeepseekError`.
- Produces: `class DeepseekProvider implements IAgentProvider` with `getType(): 'deepseek'`, `getCapabilities(): DEEPSEEK_CAPABILITIES`, `sendQuery(...): AsyncGenerator<MessageChunk>`.

Injectable seams:

```typescript
export type DeepseekTurnRunner = typeof runDeepseekAcpTurn;
```

Constructor: `new DeepseekProvider({ spawn?, runTurn? })`.

Default spawner uses `node:child_process.spawn(nodeBin, [dshBin, '--profile', profile], { cwd, env, stdio: ['pipe','pipe','pipe'] })`.
Command shape: `[nodeBin, dshBin, '--profile', profile]` with `profile` default `'acp'`.

- [ ] **Step 1: Write failing provider tests.**

Collect helper:

```typescript
async function collect(
  provider: DeepseekProvider,
  resumeSessionId?: string,
  requestOptions: SendQueryOptions = {}
): Promise<MessageChunk[]> {
  const chunks: MessageChunk[] = [];
  for await (const chunk of provider.sendQuery('hi', '/tmp/project', resumeSessionId, requestOptions)) {
    chunks.push(chunk);
  }
  return chunks;
}
```

Required cases:

1. Missing API key yields `{ type: 'result', isError: true, errorSubtype: 'deepseek_missing_api_key' }` and does not spawn.
2. Successful fake turn yields assistant + result with `sessionId` and without `tokens`.
3. Injected `runTurn` receives `providerRoute: 'deepseek-official'` (default) and `model` from `options.model` or config, so Task 5's `set_config_option` contract is preserved at the provider boundary.
4. `resumeSessionId` plus successful turn stamps `resumed: true` via `withResumedOutcome`.
5. `resumeSessionId` plus runner throw containing `session/resume` yields `errorSubtype: 'deepseek_resume_failed'` and does not invoke a second turn with a blank resume id.
6. Abort before spawn yields `stopReason: 'aborted'`.
7. `outputFormat.json_schema` is passed through as `jsonSchema` and the prompt passed to the runner is the augmented prompt.
8. Child env passed to spawn has vault `DEEPSEEK_API_KEY` beating ambient, config `DEEPSEEK_BASE_URL`, `DSH_PERMISSION_MODE`, and no `DSH_PROVIDER_ROUTE`.
9. Spawn command includes `--profile acp` by default.
10. `nodeConfig.mcp` is loaded with `loadMcpConfig` and forwarded as `mcpServers` (use a temp JSON file).

- [ ] **Step 2: Run tests and confirm they fail.**

```bash
bun test src/community/deepseek/provider.test.ts
```

Expected: FAIL because `./provider` does not exist.

- [ ] **Step 3: Implement `DeepseekProvider`.**

`sendQuery` algorithm:

1. If `abortSignal?.aborted`, yield `{ type: 'result', isError: true, stopReason: 'aborted', errorSubtype: 'deepseek_aborted', errors: ['Query aborted'] }` and return.
2. `parseDeepseekConfig(requestOptions?.assistantConfig ?? {})`.
3. `permissionMode = config.permissionMode ?? 'workspace-write'`.
4. Try `buildDeepseekChildEnv({ ambient: process.env, requestEnv: requestOptions?.env, config, permissionMode })`.
   On throw, yield classified error result and return.
5. Resolve node + dsh paths.
6. `effectivePrompt = outputFormat ? augmentPromptForJsonSchema(prompt, schema) : prompt`.
7. Translate MCP if `nodeConfig.mcp` is a non-empty string via `loadMcpConfig`.
   Convert each named server into the SDK `McpServer` union (`stdio` command/args/env, or `http`/`sse` URL).
   If a server shape cannot be represented, skip it and yield a `system` warning chunk.
8. Spawn `node dsh --profile ${config.profile ?? 'acp'}` with the child env.
9. Build `ndJsonStream(Writable.toWeb(child.stdin), Readable.toWeb(child.stdout))` inside the dynamically imported ACP client path.
10. Pass `model: requestOptions?.model ?? config.model` and `providerRoute: config.providerRoute ?? 'deepseek-official'` into `runDeepseekAcpTurn`.
11. `yield* withResumedOutcome(runTurn(...), resumedOutcome(resumeSessionId, true))` on success.
    If the runner throws, classify, yield `{ type: 'result', isError: true, errorSubtype, errors: [message] }`.
    If resume was requested and failed, do not start a fresh session and do not stamp `resumed: true`.
12. Drain stderr to `getLog().warn` / debug; never parse it as ACP.
13. `finally`: SIGTERM the child, then SIGKILL after 5000 ms if still alive (copy OMP's `scheduleKill` pattern).

`getType()` returns `'deepseek'`.
`getCapabilities()` returns `DEEPSEEK_CAPABILITIES`.

Do not statically import `./acp-client` or `@agentclientprotocol/sdk` from `provider.ts`.
Use `const { runDeepseekAcpTurn } = await import('./acp-client')` inside `sendQuery` unless `this.runTurn` was injected.

- [ ] **Step 4: Run tests and confirm they pass.**

```bash
bun test src/community/deepseek/provider.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add packages/providers/src/community/deepseek/provider.ts packages/providers/src/community/deepseek/provider.test.ts
git commit -m "feat(providers): implement DeepSeek IAgentProvider.sendQuery"
```

---

### Task 7: Registration, Barrel, Test Splits, Lazy-Load

**Files:**

- Create: `packages/providers/src/community/deepseek/registration.ts`
- Create: `packages/providers/src/community/deepseek/index.ts`
- Create: `packages/providers/src/community/deepseek/provider-lazy-load.test.ts`
- Modify: `packages/providers/src/registry.ts`
- Modify: `packages/providers/src/registry.test.ts`
- Modify: `packages/providers/src/index.ts`
- Modify: `packages/providers/package.json`

**Interfaces:**

- Consumes: `DeepseekProvider`, `DEEPSEEK_CAPABILITIES`.
- Produces: `registerDeepseekProvider(): void` idempotent; registry id `'deepseek'`; `builtIn: false`; credentials `{ kind: 'static', specs: [{ vendor: 'deepseek', displayName: 'DeepSeek', kinds: ['api_key'] }] }`.

- [ ] **Step 1: Write failing registry and lazy-load tests.**

In `packages/providers/src/registry.test.ts`:

1. Import `registerDeepseekProvider`.
2. In `registerCommunityProviders (aggregator)`, assert `isRegisteredProvider('deepseek')` is true and the deepseek count is 1 after a second aggregator call.
3. Add:

```typescript
describe('registerDeepseekProvider (community provider)', () => {
  test('registers DeepSeek with wired capabilities and the deepseek vendor credential', () => {
    registerDeepseekProvider();
    const registration = getRegistration('deepseek');
    expect(registration.displayName).toBe('DeepSeek Harness (community)');
    expect(registration.builtIn).toBe(false);
    expect(registration.credentials).toEqual({
      kind: 'static',
      specs: [{ vendor: 'deepseek', displayName: 'DeepSeek', kinds: ['api_key'] }],
    });
    expect(getProviderCapabilities('deepseek')).toEqual({
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
    });
  });

  test('is idempotent and does not collide with built-ins', () => {
    registerDeepseekProvider();
    expect(() => registerDeepseekProvider()).not.toThrow();
    expect(getRegisteredProviders().filter(provider => provider.id === 'deepseek')).toHaveLength(1);
  });
});
```

The existing test `expect(capable).toEqual(['claude', 'pi'])` for `askHuman` must still pass.

Create `packages/providers/src/community/deepseek/provider-lazy-load.test.ts` copied from Copilot's pattern, mocking both `@agentclientprotocol/sdk` and `@deepseek-ai/dsh` with `mock.module` counters, then:

```typescript
clearRegistry();
registerCommunityProviders();
const provider = getAgentProvider('deepseek');
expect(provider.getType()).toBe('deepseek');
expect(acpSdkLoaded).toBe(false);
expect(dshLoaded).toBe(false);
```

- [ ] **Step 2: Run tests and confirm they fail.**

```bash
bun test src/registry.test.ts
bun test src/community/deepseek/provider-lazy-load.test.ts
```

Expected: FAIL (unregistered id / missing module).

- [ ] **Step 3: Implement registration and wiring.**

`registration.ts`:

```typescript
import { isRegisteredProvider, registerProvider } from '../../registry';

import { DEEPSEEK_CAPABILITIES } from './capabilities';
import { DeepseekProvider } from './provider';

export function registerDeepseekProvider(): void {
  if (isRegisteredProvider('deepseek')) return;
  registerProvider({
    id: 'deepseek',
    displayName: 'DeepSeek Harness (community)',
    factory: () => new DeepseekProvider(),
    capabilities: DEEPSEEK_CAPABILITIES,
    builtIn: false,
    credentials: {
      kind: 'static',
      specs: [{ vendor: 'deepseek', displayName: 'DeepSeek', kinds: ['api_key'] }],
    },
  });
}
```

`index.ts` re-exports capabilities, config, resolvers, provider, registration, and types.

In `registry.ts` add:

```typescript
import { registerDeepseekProvider } from './community/deepseek/registration';
```

and call `registerDeepseekProvider();` inside `registerCommunityProviders()` before the e2e fake.

In `packages/providers/src/index.ts` add an export block after the OMP exports:

```typescript
export {
  DEEPSEEK_CAPABILITIES,
  DeepseekProvider,
  parseDeepseekConfig,
  registerDeepseekProvider,
  resolveNodeBinaryPath,
  resolveDshCliPath,
  type DeepseekProviderDefaults,
} from './community/deepseek';
```

In `packages/providers/package.json` `exports` add:

```json
"./community/deepseek": "./src/community/deepseek/index.ts"
```

In the `test` script, after the OMP provider invocation and before OpenCode, insert separate invocations:

```text
&& bun test src/community/deepseek/config.test.ts && bun test src/community/deepseek/node-resolver.test.ts && bun test src/community/deepseek/event-bridge.test.ts && bun test src/community/deepseek/permission.test.ts && bun test src/community/deepseek/env.test.ts && bun test src/community/deepseek/acp-client.test.ts && bun test src/community/deepseek/provider.test.ts && bun test src/community/deepseek/provider-lazy-load.test.ts
```

`provider-lazy-load.test.ts` MUST be its own `bun test` invocation.
Do not add a usage-contract test.

- [ ] **Step 4: Run tests and confirm they pass.**

```bash
bun test src/registry.test.ts
bun test src/community/deepseek/provider-lazy-load.test.ts
bun test src/community/deepseek/provider.test.ts
```

Expected: PASS.
`askHuman` capable ids remain `['claude', 'pi']`.

- [ ] **Step 5: Commit.**

```bash
git add packages/providers/src/community/deepseek/registration.ts packages/providers/src/community/deepseek/index.ts packages/providers/src/community/deepseek/provider-lazy-load.test.ts packages/providers/src/registry.ts packages/providers/src/registry.test.ts packages/providers/src/index.ts packages/providers/package.json
git commit -m "feat(providers): register deepseek community provider"
```

---

### Task 8: Docs, Tiers, and Capability Matrix

**Files:**

- Modify: `packages/docs-web/src/content/docs/getting-started/ai-assistants.md`
- Modify: `packages/docs-web/src/content/docs/reference/configuration.md`
- Modify: `packages/workflows/src/defaults/tier-defaults.json`
- Generate: `packages/docs-web/src/content/docs/reference/provider-capabilities.md`

**Interfaces:**

- Consumes: registered `deepseek` capabilities.
- Produces: operator docs and generated matrix column for `deepseek`.

- [ ] **Step 1: Add `deepseek` to `tier-defaults.json`.**

```json
"deepseek": {
  "small": { "model": "deepseek-v3", "effort": "low" },
  "medium": { "model": "deepseek-v3", "effort": "high" },
  "large": { "model": "deepseek-v3", "effort": "max" }
}
```

- [ ] **Step 2: Document the provider in `ai-assistants.md`.**

Update the frontmatter description to include DeepSeek Harness.
Add DeepSeek to the structured-output best-effort row.
Insert a new `## DeepSeek Harness (community provider)` section before `## Per-user credentials and AI Settings` with:

- Community provider id `deepseek`.
- Requires a Node binary (`DEEPSEEK_NODE_BIN` / `assistants.deepseek.nodeBin` / PATH).
- Archon bundles `@deepseek-ai/dsh` and spawns `dsh --profile acp`.
- Store the DashScope token as vendor `deepseek` (`DEEPSEEK_API_KEY`).
- Set `assistants.deepseek.baseUrl` to the DashScope compatible endpoint.
- YAML example matching the design (`model`, `baseUrl`, `providerRoute`, `profile`, `permissionMode`, `effort`, `nodeBin`).
- Model and route are applied through ACP `session/set_config_option` (`configId: 'model'`, value `[providerRoute, model]`).
- Permission default `workspace-write` rejects ACP permission prompts; `danger-full-access` is opt-in.
- Resume failure is terminal (the node fails; Archon does not start a cold session).
- v1 does not report per-request usage.

Add a usage-table row:

```markdown
| DeepSeek | Not reported in v1. ACP `usage_update` is context occupancy only. |
```

Keep every full Markdown sentence on its own physical line.

- [ ] **Step 3: Add `assistants.deepseek` to the configuration reference example.**

In `packages/docs-web/src/content/docs/reference/configuration.md` global assistants example, add:

```yaml
  deepseek:
    model: deepseek-v3
    baseUrl: https://dashscope-intl.aliyuncs.com/compatible-mode/v1
    providerRoute: deepseek-official
    profile: acp
    permissionMode: workspace-write
    effort: high
    # nodeBin: /usr/bin/node
```

Update `defaultAssistant` comment to mention `deepseek`.

- [ ] **Step 4: Regenerate the capability matrix.**

From repo root:

```bash
bun run generate:capability-matrix
```

Expected: `provider-capabilities.md` lists `deepseek` as a community provider with `sessionResume`/`mcp`/`effortControl`/`envInjection` ✅, `structuredOutput` best-effort, `askHuman` ❌.

- [ ] **Step 5: Check the matrix is current.**

```bash
bun run check:capability-matrix
```

Expected: `check:capability-matrix OK`.

- [ ] **Step 6: Commit.**

```bash
git add packages/workflows/src/defaults/tier-defaults.json packages/docs-web/src/content/docs/getting-started/ai-assistants.md packages/docs-web/src/content/docs/reference/configuration.md packages/docs-web/src/content/docs/reference/provider-capabilities.md
git commit -m "docs(providers): document DeepSeek Harness community provider"
```

---

### Task 9: Bun `ndJsonStream` Verification and Optional Live Spike

**Files:**

- Create: `packages/providers/src/community/deepseek/ndjson-stream.test.ts`
- Create: `packages/providers/src/community/deepseek/acp-handshake-spike.ts`
- Modify: `packages/providers/package.json` scripts + test split

**Interfaces:**

- Consumes: `ndJsonStream` from `@agentclientprotocol/sdk`.
- Produces: proof that Bun can round-trip one JSON-RPC message on web streams; optional live handshake script.

- [ ] **Step 1: Write a failing Bun stream test.**

Create `packages/providers/src/community/deepseek/ndjson-stream.test.ts` that:

1. Dynamically imports `{ ndJsonStream }` from `@agentclientprotocol/sdk`.
2. Creates a pair of `TransformStream<Uint8Array>` looping output into input.
3. Writes one JSON-RPC request object as NDJSON into the writable byte stream.
4. Reads one decoded message from `stream.readable`.

If this fails under Bun with a stream-adapter error, implement the documented fallback: a thin Node sidecar that only hosts `ndJsonStream` + `client()`, talking to Archon over a second stdio pipe.
Keep the fallback localized in `acp-client.ts`.
Do not add the sidecar unless this test proves Bun cannot run `ndJsonStream`.

- [ ] **Step 2: Run the stream test.**

```bash
bun test src/community/deepseek/ndjson-stream.test.ts
```

Expected: FAIL then PASS after the test file exists and `ndJsonStream` works.
Add this file as its own `bun test` invocation in `package.json` next to the other deepseek tests.

- [ ] **Step 3: Add the optional live spike script.**

Create `packages/providers/src/community/deepseek/acp-handshake-spike.ts` that:

1. Exits 0 with a skip message when `DEEPSEEK_API_KEY` is unset (so CI never calls DashScope).
2. When the key is set, resolves Node + `dsh`, spawns `--profile acp`, runs `initialize` + `session/new` + `session/set_config_option` (`configId: 'model'`, `value: JSON.stringify(['deepseek-official', model])`) + one `session/prompt` of `ping`, prints `ok sessionId=...`, then `session/close` and reaps the child.
3. Uses the same child-env builder as production.

Add script:

```json
"spike:deepseek:acp": "bun src/community/deepseek/acp-handshake-spike.ts"
```

Do not add the spike to the default `test` script.

- [ ] **Step 4: Commit.**

```bash
git add packages/providers/src/community/deepseek/ndjson-stream.test.ts packages/providers/src/community/deepseek/acp-handshake-spike.ts packages/providers/package.json
git commit -m "test(providers): verify DeepSeek ACP streams under Bun"
```

---

### Task 10: Validation

**Files:**

- Verify only.

- [ ] **Step 1: Run DeepSeek-focused tests from `packages/providers`.**

```bash
bun test src/community/deepseek/config.test.ts
bun test src/community/deepseek/node-resolver.test.ts
bun test src/community/deepseek/event-bridge.test.ts
bun test src/community/deepseek/permission.test.ts
bun test src/community/deepseek/env.test.ts
bun test src/community/deepseek/acp-client.test.ts
bun test src/community/deepseek/provider.test.ts
bun test src/community/deepseek/provider-lazy-load.test.ts
bun test src/community/deepseek/ndjson-stream.test.ts
bun test src/registry.test.ts
```

Expected: all PASS.

- [ ] **Step 2: Run the package test script.**

```bash
bun --filter @archon/providers test
```

Expected: PASS (no mock.module pollution).

- [ ] **Step 3: Type-check providers.**

```bash
bun --filter @archon/providers type-check
```

Expected: PASS.

- [ ] **Step 4: Full validate from repo root.**

```bash
bun run generate:capability-matrix
bun run validate
```

Expected: every validate step PASS, including `check:capability-matrix`.

- [ ] **Step 5: Optional live spike (needs DashScope token).**

```bash
bun --filter @archon/providers spike:deepseek:acp
```

Expected without a key: skip / exit 0.
Expected with `DEEPSEEK_API_KEY` and `DEEPSEEK_BASE_URL`: handshake + one turn prints `ok`.

## Acceptance Criteria

- `deepseek` is registered as a community provider (`builtIn: false`) and `provider: deepseek` is a valid workflow provider id.
- ACP client drives bundled `dsh --profile acp` end to end: streaming, durable resume, cancel/abort, error-as-result.
- Resume failure is terminal: tests prove `session/new` is not called when `session/resume` fails.
- Model and route are applied with `session/set_config_option` `{ configId: 'model', value: JSON.stringify([providerRoute, model]) }`; tests prove that shape.
- DashScope token is `DEEPSEEK_API_KEY`; `DEEPSEEK_BASE_URL` comes from config over ambient; vault env beats ambient.
- Permission handler is fail-safe (default reject; `danger-full-access` opt-in).
- Capabilities match the table above, especially `askHuman: false`.
- Result chunks omit `tokens` / `usageBreakdown`.
- Unit + provider tests exist as listed; lazy-load has its own `bun test` invocation.
- `bun run generate:capability-matrix` is current; `bun run validate` is green.
- Design doc is on the branch at `docs/superpowers/specs/2026-09-07-deepseek-provider-design.md`.

## Out of Scope

- Per-request usage / `usageBreakdown` / `_meta` billing extension.
- Token-level streaming.
- MCP resources/prompts.
- ACP fork/delete/load/plans/terminals.
- SDK JSON-RPC (`dsh --profile sdk`) route.
- Surfacing permission prompts to a human.
- Auto-approving permission prompts by default.
- Synthesizing billing from context occupancy.
- Inventing `DSH_PROVIDER_ROUTE` or any undocumented DSH env for model routing.
- `config-types.ts` / `config-loader.ts` / credential-delivery edits.

## Rollback

Revert the DeepSeek commits, remove `registerDeepseekProvider()` and barrel exports, rerun `bun run generate:capability-matrix`, and leave operator DashScope tokens in the existing `deepseek` vendor store (unchanged).
