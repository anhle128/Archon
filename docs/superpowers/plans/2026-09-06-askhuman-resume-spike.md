# Prove Claude and Pi Resume After AskHuman Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.
> Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prove the AD-6 AskHuman resume protocol on lockfile Claude Agent SDK `0.3.209` and Pi `session.agent.continue()` at `pi-agent-core` `0.80.6`, write the spike outcome, and confirm or amend AD-6 before Story 6.3 ships continue.

**Architecture:** Story 6.1 is a required AD-6 spike, not a user-facing slice.
It records SDK _how_ and encodes that how as pure mapping helpers.
It does not persist Asks, pause runs, inject `AskHuman`, or wire `sendQuery`.
`@archon/providers` owns the characterization tests and the mapping helpers.
The architecture spine is the only place a protocol change may land.

**Tech Stack:** Bun, strict TypeScript, Bun Test, `@anthropic-ai/claude-agent-sdk` lockfile `0.3.209`, `@earendil-works/pi-coding-agent` / `pi-agent-core` / `pi-ai` lockfile `0.80.6`.

**Spec:** `_bmad-output/planning-artifacts/epics-workflow-run-view-hitl/epics.md` Story 6.1.

**Source Contracts:** `_bmad-output/specs/spec-workflow-run-view-hitl/SPEC.md` CAP-4 / NFR7 assumptions, `_bmad-output/specs/spec-workflow-run-view-hitl/brownfield.md` Pi prompt→dispose, `_bmad-output/planning-artifacts/architecture/architecture-Archon-2026-09-05/ARCHITECTURE-SPINE.md` AD-6 / AD-9 / Deferred spikes, and `_bmad-output/planning-artifacts/architecture/architecture-Archon-2026-09-05/reviews/review-version-reality.md` Findings 1–3 and 5.

**Issue:** [#86](https://github.com/anhle128/Archon/issues/86)

## Global Constraints

- Story 6.1 gates Story 6.3 continue.
- Story 6.2 may persist an Ask without continue.
- Do not implement `AskHuman` `NativeTool`, `AskHumanAwaitingError`, `capabilities.askHuman`, pending tables, pause-without-approval, answer POST, SSE events, or UI cards.
- Do not wrap Claude `AskUserQuestion`.
- Do not treat `AgentSession.continue()` as the Pi API.
- Do not put answers into a prompt from `@archon/workflows`.
- Do not call vendor APIs in CI.
- Do not bump `@anthropic-ai/claude-agent-sdk` off lockfile `0.3.209` unless this story amends AD-6 to require a newer SDK.
- Do not bump Pi off lockfile `0.80.6`.
- Do not add `askHuman` to `ProviderCapabilities`.
- Adding that field without a matrix axis fails `bun run generate:capability-matrix`.
- Do not change `NativeTool.handler` off `Promise<string>`.
- Do not stringify or log answer bodies.
- Do not use `any`.
- Do not run `bun test` from the repository root.
- Run package tests from that package directory.
- Run every command block from the repository root.
- Package-scoped commands use a subshell so later commands remain rooted correctly.
- New provider test files must get their own `bun test <file>` invocation in `packages/providers/package.json`.
- Characterization tests must import the real lockfile SDKs.
- They must not `mock.module` `@anthropic-ai/claude-agent-sdk` or `@earendil-works/pi-coding-agent`.

---

## File Map

- Create `packages/providers/src/shared/resume-interactions.ts` for the AD-6 `ResumeInteraction` shape and the `"declined"` token.
- Create `packages/providers/src/shared/resume-interactions.test.ts` for empty-array rejection, declined vs payload, and field names.
- Create `packages/providers/src/claude/sdk-ask-resume.characterization.test.ts` to lock Claude SDK `0.3.209` types for `defer`, `tool_deferred`, `requires_action`, and `AskUserQuestion`.
- Create `packages/providers/src/claude/ask-resume-protocol.ts` to map `ResumeInteraction[]` to one new user-message string with no tool re-issue.
- Create `packages/providers/src/claude/ask-resume-protocol.test.ts` for that mapper.
- Create `packages/providers/src/community/pi/sdk-ask-resume.characterization.test.ts` to lock Pi `0.80.6` `Agent.continue`, the absence of `AgentSession.continue`, `ToolResultMessage`, and Archon `session.dispose()`.
- Create `packages/providers/src/community/pi/ask-resume-protocol.ts` to map `ResumeInteraction[]` to `ToolResultMessage[]` plus the reopen recipe constants.
- Create `packages/providers/src/community/pi/ask-resume-protocol.test.ts` for that mapper and recipe.
- Modify `packages/providers/package.json` to invoke the five new test files in isolated `bun test` processes and to pin `@anthropic-ai/claude-agent-sdk` to exact `0.3.209` when AD-6 is confirmed without a bump.
- Modify root `package.json` the same way for the Claude SDK pin.
- Create `_bmad-output/implementation-artifacts/workflow-run-view-hitl/6-1-askhuman-resume-spike.md` as the written spike outcome.
- Modify `_bmad-output/planning-artifacts/architecture/architecture-Archon-2026-09-05/ARCHITECTURE-SPINE.md` AD-6 Rule, Stack Claude row, Claude SDK convention row, and the two Deferred spike rows.
- Modify `_bmad-output/implementation-artifacts/workflow-run-view-hitl/sprint-status.yaml` only after the code tasks and outcome pass.

Do not modify `packages/workflows/src/dag-executor.ts`, `packages/providers/src/claude/provider.ts` `sendQuery`, `packages/providers/src/community/pi/provider.ts` `sendQuery`, `packages/providers/src/claude/native-tools.ts` production wrapper, `packages/providers/src/community/pi/native-tools.ts` production wrapper, `packages/providers/src/types.ts` `SendQueryOptions`, `packages/server/`, `packages/web/`, `packages/core/src/db/`, or `migrations/000_combined.sql`.

## Patterns to Mirror

**Isolated `bun test` files** live in `packages/providers/package.json` `scripts.test`.
Each file is its own process because `mock.module()` is process-global.

**SDK type-lock tests** live in `packages/providers/src/community/pi/usage-contract.test.ts`.
Fixtures use `satisfies Usage` so a vendor type reshape fails compile, not a loose object.

**Claude resume today** is `options.resume = resumeSessionId` in `packages/providers/src/claude/provider.ts` around the `sendQuery` option build.
The next user turn is the `prompt` string passed to `query({ prompt, options })`.
There is no `resumeInteractions` field yet.

**Pi resume today** is `resolvePiSession` in `packages/providers/src/community/pi/session-resolver.ts` (`SessionManager.create` vs `open(path)`).
`bridgeSession` in `packages/providers/src/community/pi/event-bridge.ts` always `session.dispose()` in `finally`.

**Claude MCP tool names** use `ARCHON_TOOL_SERVER = 'archon'` in `packages/providers/src/claude/native-tools.ts`.
A future `AskHuman` tool is therefore `mcp__archon__AskHuman`.

**Claude native-tool wrapper** awaits `spec.handler` and wraps the string as MCP `CallToolResult` with no try/catch.
A throw currently becomes an SDK tool error, not a `sendQuery` reject.
Story 6.2 changes that wrapper.
This story only records that the current path is host abort, not PreToolUse `defer`.

**Pi native-tool wrapper** awaits `spec.handler` inside `defineTool` `execute(toolCallId, params)`.
The first argument is the tool-call id that AD-6 `tool_use_id` must match.

**AskUserQuestion** is already in `CLAUDE_KNOWN_TOOL_NAMES` in `packages/providers/src/claude/capabilities.ts`.
AD-9 forbids wrapping it.

## Authoritative Contracts

### Spike questions this story must answer in writing

1. Claude `0.3.209`: is AskHuman resume host abort plus one new user message, or PreToolUse `defer` / `tool_deferred` with tool re-issue?
2. If the AD-6 Rule must change, amend the spine in this story.
3. Do not fork a silent second protocol.
4. Keep lockfile exact `0.3.209` until that amendment.
5. Pi: does `session.agent.continue()` work after Archon's `dispose()`, and what reopen contract is required?
6. `AgentSession.continue()` is not the API.

### Provisional protocol (safe default unless characterization disproves it)

Keep AD-6's Archon-visible contract:

- Executor later passes `resumeInteractions: Array<{ tool_use_id, payload, declined }>` in store order.
- Executor does not stuff answers into the prompt.
- Claude maps the array to **one** new user-message string.
- Claude does **not** re-issue AskHuman / deferred tool / `updatedInput`.
- Pi maps each item to a `ToolResultMessage` then calls `session.agent.continue()`.
- Pending-row `provider_session_id` is the session SoT (Story 6.3 wires it).

Record SDK how as:

- Claude AskHuman is a custom in-process MCP tool, not `AskUserQuestion`.
- Documented `tool_deferred` is the `AskUserQuestion` + PreToolUse `defer` path.
- AD-9 forbids that path.
- Therefore Claude how is **host abort** of the MCP tool callback, then `options.resume` plus one new user message.
- `requires_action` and `tool_deferred` types exist at `0.3.209` and must stay unused by AskHuman.
- Pi how is dispose (today's `bridgeSession` finally), `SessionManager.open` by `provider_session_id`, append `ToolResultMessage`s so the transcript tail is `toolResult`, then `session.agent.continue()`.
- Same-process skip-dispose is an AD-6 optimization and is not the durable proof.

### `ResumeInteraction`

```ts
export interface ResumeInteraction {
  tool_use_id: string;
  payload: unknown;
  declined: boolean;
}

export const ASK_RESUME_DECLINED = 'declined' as const;
```

When `declined` is true, the mapped body is exactly `'declined'` and `payload` is ignored.
When `declined` is false and `payload` is a string, use that string.
Otherwise `JSON.stringify(payload)`.
Empty arrays throw.
Do not log `payload`.

### Claude mapper

```ts
export function mapClaudeResumeUserMessage(interactions: ResumeInteraction[]): string
```

Return one string for the next `query({ prompt })` user turn.
Join multiple items with a single newline.
Never emit tool_use / tool_result XML or JSON.
Never mention `AskUserQuestion` or `mcp__archon__AskHuman`.

### Pi mapper

```ts
export function mapPiResumeToolResults(
  interactions: ResumeInteraction[],
  options?: { toolName?: string; timestamp?: number }
): ToolResultMessage[]
```

Each item becomes:

```ts
{
  role: 'toolResult',
  toolCallId: item.tool_use_id,
  toolName: options?.toolName ?? 'AskHuman',
  content: [{ type: 'text', text: <declined-or-payload> }],
  isError: false,
  timestamp: options?.timestamp ?? Date.now(),
} satisfies ToolResultMessage
```

Default `toolName` is `'AskHuman'` so Story 6.2 can match the NativeTool name.
Preserve store order.
Empty arrays throw.

### Pi reopen recipe (exported constants, not a live SDK call)

```ts
export const PI_ASK_RESUME_API = {
  continueTarget: 'session.agent.continue',
  forbiddenTarget: 'AgentSession.continue',
  afterDispose: 'SessionManager.open',
  appendBeforeContinue: 'toolResult',
} as const;
```

### Outcome document required sections

The file `_bmad-output/implementation-artifacts/workflow-run-view-hitl/6-1-askhuman-resume-spike.md` must contain:

- Claude lockfile version observed (`0.3.209`).
- Whether host abort or `tool_deferred` / PreToolUse `defer` is required for AskHuman.
- Explicit reject of wrapping `AskUserQuestion`.
- Pi lockfile versions observed (`pi-coding-agent` `0.80.6`, `pi-agent-core` `0.80.6`).
- Whether `session.agent.continue()` is the continue API.
- Whether `AgentSession.continue()` exists (it must not be used).
- Reopen-after-dispose contract (`SessionManager.open` + append `ToolResultMessage` + `session.agent.continue()`).
- Confirm-or-amend verdict for AD-6.
- Paths of the characterization and protocol tests that constitute CI evidence.
- Statement that Story 6.3 must not ship continue if this file is missing.

---

### Task 1: Add the shared `ResumeInteraction` contract

**Files:**

- Create: `packages/providers/src/shared/resume-interactions.ts`
- Create: `packages/providers/src/shared/resume-interactions.test.ts`
- Modify: `packages/providers/package.json` `scripts.test`

**Interfaces:**

- Produces: `ResumeInteraction`, `ASK_RESUME_DECLINED`, `serializeResumePayload(item: ResumeInteraction): string`, `assertResumeInteractions(items: ResumeInteraction[]): ResumeInteraction[]`.

- [ ] **Step 1: Write the failing tests**

Create `packages/providers/src/shared/resume-interactions.test.ts`:

```ts
import { describe, expect, test } from 'bun:test';

import {
  ASK_RESUME_DECLINED,
  assertResumeInteractions,
  serializeResumePayload,
  type ResumeInteraction,
} from './resume-interactions';

describe('ResumeInteraction', () => {
  test('declined ignores payload and returns the declined token', () => {
    const item: ResumeInteraction = {
      tool_use_id: 'toolu_1',
      payload: { answers: [{ questionId: 'q1', value: 'secret' }] },
      declined: true,
    };
    expect(serializeResumePayload(item)).toBe(ASK_RESUME_DECLINED);
    expect(ASK_RESUME_DECLINED).toBe('declined');
  });

  test('string payload is used verbatim when not declined', () => {
    expect(
      serializeResumePayload({
        tool_use_id: 'toolu_1',
        payload: 'plain',
        declined: false,
      })
    ).toBe('plain');
  });

  test('non-string payload is JSON.stringified when not declined', () => {
    expect(
      serializeResumePayload({
        tool_use_id: 'toolu_1',
        payload: { answers: [{ questionId: 'q1', value: 'east' }] },
        declined: false,
      })
    ).toBe('{"answers":[{"questionId":"q1","value":"east"}]}');
  });

  test('assertResumeInteractions throws on empty array', () => {
    expect(() => assertResumeInteractions([])).toThrow(/non-empty/);
  });

  test('assertResumeInteractions returns the same array when non-empty', () => {
    const items: ResumeInteraction[] = [
      { tool_use_id: 'a', payload: null, declined: true },
    ];
    expect(assertResumeInteractions(items)).toBe(items);
  });
});
```

- [ ] **Step 2: Run the tests and confirm they fail**

```bash
(cd packages/providers && bun test src/shared/resume-interactions.test.ts)
```

Expected: FAIL because `./resume-interactions` does not exist.

- [ ] **Step 3: Write the implementation**

Create `packages/providers/src/shared/resume-interactions.ts`:

```ts
export interface ResumeInteraction {
  tool_use_id: string;
  payload: unknown;
  declined: boolean;
}

export const ASK_RESUME_DECLINED = 'declined' as const;

export function assertResumeInteractions(
  interactions: ResumeInteraction[]
): ResumeInteraction[] {
  if (interactions.length === 0) {
    throw new Error('resumeInteractions must be non-empty');
  }
  return interactions;
}

export function serializeResumePayload(item: ResumeInteraction): string {
  if (item.declined) {
    return ASK_RESUME_DECLINED;
  }
  if (typeof item.payload === 'string') {
    return item.payload;
  }
  return JSON.stringify(item.payload);
}
```

- [ ] **Step 4: Run the tests and confirm they pass**

```bash
(cd packages/providers && bun test src/shared/resume-interactions.test.ts)
```

Expected: PASS.

- [ ] **Step 5: Refactor if needed, then add the isolated invocation**

In `packages/providers/package.json` `scripts.test`, replace `bun test src/shared/resumed.test.ts && bun test src/shared/effort.test.ts` with `bun test src/shared/resumed.test.ts && bun test src/shared/resume-interactions.test.ts && bun test src/shared/effort.test.ts`.

Do not restyle unrelated script entries.

---

### Task 2: Characterize Claude SDK 0.3.209 and encode the user-message mapper

**Files:**

- Create: `packages/providers/src/claude/sdk-ask-resume.characterization.test.ts`
- Create: `packages/providers/src/claude/ask-resume-protocol.ts`
- Create: `packages/providers/src/claude/ask-resume-protocol.test.ts`
- Modify: `packages/providers/package.json` `scripts.test`

**Interfaces:**

- Consumes: `ResumeInteraction`, Claude SDK types `HookPermissionDecision`, `TerminalReason`, `SDKDeferredToolUse`.
- Produces: `mapClaudeResumeUserMessage`, `CLAUDE_ASK_RESUME_HOW`.

- [ ] **Step 1: Write the failing characterization tests**

Create `packages/providers/src/claude/sdk-ask-resume.characterization.test.ts`.
Do not `mock.module` the SDK.

```ts
import { createRequire } from 'node:module';
import { describe, expect, test } from 'bun:test';
import type {
  HookPermissionDecision,
  SDKDeferredToolUse,
  TerminalReason,
} from '@anthropic-ai/claude-agent-sdk';

import { CLAUDE_CAPABILITIES } from './capabilities';
import { ARCHON_TOOL_SERVER } from './native-tools';

const require = createRequire(import.meta.url);

describe('Claude Agent SDK 0.3.209 AskHuman resume characterization', () => {
  test('lockfile install is exact 0.3.209', () => {
    const pkg = require('@anthropic-ai/claude-agent-sdk/package.json') as {
      version: string;
    };
    expect(pkg.version).toBe('0.3.209');
  });

  test('HookPermissionDecision includes defer (documented pause, not AskHuman)', () => {
    const defer: HookPermissionDecision = 'defer';
    const allow: HookPermissionDecision = 'allow';
    expect(defer).toBe('defer');
    expect(allow).toBe('allow');
  });

  test('TerminalReason includes tool_deferred and tool_deferred_unavailable', () => {
    const deferred: TerminalReason = 'tool_deferred';
    const unavailable: TerminalReason = 'tool_deferred_unavailable';
    expect(deferred).toBe('tool_deferred');
    expect(unavailable).toBe('tool_deferred_unavailable');
  });

  test('SDKDeferredToolUse is the documented deferred-tool payload', () => {
    const sample: SDKDeferredToolUse = {
      id: 'toolu_1',
      name: 'AskUserQuestion',
      input: {},
    };
    expect(sample.id).toBe('toolu_1');
  });

  test('session_state_changed types include requires_action at this pin', () => {
    const state: 'idle' | 'running' | 'requires_action' = 'requires_action';
    expect(state).toBe('requires_action');
  });

  test('AskUserQuestion is a known Claude tool and must not be wrapped', () => {
    expect(CLAUDE_CAPABILITIES.knownToolNames).toContain('AskUserQuestion');
  });

  test('Archon MCP server name yields mcp__archon__AskHuman for a tool named AskHuman', () => {
    expect(ARCHON_TOOL_SERVER).toBe('archon');
    expect(`mcp__${ARCHON_TOOL_SERVER}__AskHuman`).toBe('mcp__archon__AskHuman');
  });
});
```

- [ ] **Step 2: Run characterization and confirm the lockfile facts**

```bash
(cd packages/providers && bun test src/claude/sdk-ask-resume.characterization.test.ts)
```

Expected: PASS against lockfile `0.3.209`.
If `version` is not `0.3.209`, stop and treat that as an AD-6 amendment trigger.
Do not bump the SDK in this task.

- [ ] **Step 3: Write the failing protocol tests**

Create `packages/providers/src/claude/ask-resume-protocol.test.ts`:

```ts
import { describe, expect, test } from 'bun:test';

import type { ResumeInteraction } from '../shared/resume-interactions';
import {
  CLAUDE_ASK_RESUME_HOW,
  mapClaudeResumeUserMessage,
} from './ask-resume-protocol';

const answered: ResumeInteraction = {
  tool_use_id: 'toolu_1',
  payload: { answers: [{ questionId: 'q1', value: 'east' }] },
  declined: false,
};

const declined: ResumeInteraction = {
  tool_use_id: 'toolu_2',
  payload: { answers: [{ questionId: 'q1', value: 'ignored' }] },
  declined: true,
};

describe('mapClaudeResumeUserMessage', () => {
  test('maps one answered interaction to one user-message string', () => {
    expect(mapClaudeResumeUserMessage([answered])).toBe(
      '{"answers":[{"questionId":"q1","value":"east"}]}'
    );
  });

  test('maps declined to the declined token and ignores payload', () => {
    expect(mapClaudeResumeUserMessage([declined])).toBe('declined');
  });

  test('joins multiple interactions into one user message in store order', () => {
    expect(mapClaudeResumeUserMessage([answered, declined])).toBe(
      '{"answers":[{"questionId":"q1","value":"east"}]}\ndeclined'
    );
  });

  test('throws on empty array', () => {
    expect(() => mapClaudeResumeUserMessage([])).toThrow(/non-empty/);
  });

  test('does not mention AskUserQuestion or MCP tool re-issue', () => {
    const body = mapClaudeResumeUserMessage([answered]);
    expect(body).not.toContain('AskUserQuestion');
    expect(body).not.toContain('mcp__archon__AskHuman');
    expect(body).not.toContain('tool_use');
    expect(CLAUDE_ASK_RESUME_HOW).toEqual({
      abort: 'host-abort-mcp-tool',
      resume: 'options.resume-plus-one-user-message',
      not: 'pretooluse-defer-tool-reissue',
    });
  });
});
```

- [ ] **Step 4: Run the protocol tests and confirm they fail**

```bash
(cd packages/providers && bun test src/claude/ask-resume-protocol.test.ts)
```

Expected: FAIL because `./ask-resume-protocol` does not exist.

- [ ] **Step 5: Write the mapper**

Create `packages/providers/src/claude/ask-resume-protocol.ts`:

```ts
import {
  assertResumeInteractions,
  serializeResumePayload,
  type ResumeInteraction,
} from '../shared/resume-interactions';

export const CLAUDE_ASK_RESUME_HOW = {
  abort: 'host-abort-mcp-tool',
  resume: 'options.resume-plus-one-user-message',
  not: 'pretooluse-defer-tool-reissue',
} as const;

export function mapClaudeResumeUserMessage(
  interactions: ResumeInteraction[]
): string {
  return assertResumeInteractions(interactions)
    .map(serializeResumePayload)
    .join('\n');
}
```

- [ ] **Step 6: Run the protocol tests and confirm they pass**

```bash
(cd packages/providers && bun test src/claude/ask-resume-protocol.test.ts)
```

Expected: PASS.

- [ ] **Step 7: Refactor if needed, then add isolated invocations**

In `packages/providers/package.json` `scripts.test`, replace `bun test src/claude/native-tools.test.ts && bun test src/claude/config.test.ts` with `bun test src/claude/native-tools.test.ts && bun test src/claude/sdk-ask-resume.characterization.test.ts && bun test src/claude/ask-resume-protocol.test.ts && bun test src/claude/config.test.ts`.

Do not call `sendQuery`.
Do not change `native-tools.ts`.

---

### Task 3: Characterize Pi 0.80.6 continue-after-dispose and encode the ToolResult mapper

**Files:**

- Create: `packages/providers/src/community/pi/sdk-ask-resume.characterization.test.ts`
- Create: `packages/providers/src/community/pi/ask-resume-protocol.ts`
- Create: `packages/providers/src/community/pi/ask-resume-protocol.test.ts`
- Modify: `packages/providers/package.json` `scripts.test`

**Interfaces:**

- Consumes: `ResumeInteraction`, `AgentSession` from `@earendil-works/pi-coding-agent`, `ToolResultMessage` from `@earendil-works/pi-ai`.
- Produces: `mapPiResumeToolResults`, `PI_ASK_RESUME_API`.

- [ ] **Step 1: Write the failing characterization tests**

Create `packages/providers/src/community/pi/sdk-ask-resume.characterization.test.ts`.
Do not `mock.module` Pi.

```ts
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'bun:test';
import type { AgentSession } from '@earendil-works/pi-coding-agent';
import type { ToolResultMessage } from '@earendil-works/pi-ai';

const require = createRequire(import.meta.url);

describe('Pi 0.80.6 AskHuman resume characterization', () => {
  test('pi-coding-agent lockfile install is exact 0.80.6', () => {
    const pkg = require('@earendil-works/pi-coding-agent/package.json') as {
      version: string;
    };
    expect(pkg.version).toBe('0.80.6');
  });

  test('pi-agent-core lockfile install is exact 0.80.6', () => {
    const pkg = require('@earendil-works/pi-agent-core/package.json') as {
      version: string;
    };
    expect(pkg.version).toBe('0.80.6');
  });

  test('AgentSession has agent and dispose and does not have continue', () => {
    type HasContinue = 'continue' extends keyof AgentSession ? true : false;
    type HasAgent = 'agent' extends keyof AgentSession ? true : false;
    type HasDispose = 'dispose' extends keyof AgentSession ? true : false;
    const hasContinue: HasContinue = false;
    const hasAgent: HasAgent = true;
    const hasDispose: HasDispose = true;
    expect(hasContinue).toBe(false);
    expect(hasAgent).toBe(true);
    expect(hasDispose).toBe(true);
  });

  test('session.agent.continue is the continue API', () => {
    type AgentContinue = AgentSession['agent']['continue'];
    type IsFn = AgentContinue extends (...args: never[]) => unknown ? true : false;
    const isFn: IsFn = true;
    expect(isFn).toBe(true);
  });

  test('ToolResultMessage role is toolResult and keys include toolCallId', () => {
    const sample = {
      role: 'toolResult',
      toolCallId: 'call_1',
      toolName: 'AskHuman',
      content: [{ type: 'text', text: 'declined' }],
      isError: false,
      timestamp: 1,
    } satisfies ToolResultMessage;
    expect(sample.role).toBe('toolResult');
    expect(sample.toolCallId).toBe('call_1');
  });

  test('Archon bridgeSession still disposes the session in finally', () => {
    const src = readFileSync(join(import.meta.dir, 'event-bridge.ts'), 'utf8');
    expect(src).toContain('session.dispose()');
    expect(src).toContain('always `dispose()` the session');
  });
});
```

- [ ] **Step 2: Run characterization**

```bash
(cd packages/providers && bun test src/community/pi/sdk-ask-resume.characterization.test.ts)
```

Expected: PASS on lockfile `0.80.6`.
If `AgentSession` grows a `continue` method, the `HasContinue = false` assignment fails compile.
Stop and amend AD-6 rather than calling that method.

- [ ] **Step 3: Write the failing protocol tests**

Create `packages/providers/src/community/pi/ask-resume-protocol.test.ts`:

```ts
import { describe, expect, test } from 'bun:test';
import type { ToolResultMessage } from '@earendil-works/pi-ai';

import type { ResumeInteraction } from '../../shared/resume-interactions';
import {
  PI_ASK_RESUME_API,
  mapPiResumeToolResults,
} from './ask-resume-protocol';

const answered: ResumeInteraction = {
  tool_use_id: 'call_1',
  payload: { answers: [{ questionId: 'q1', value: 'east' }] },
  declined: false,
};

const declined: ResumeInteraction = {
  tool_use_id: 'call_2',
  payload: { ignored: true },
  declined: true,
};

describe('mapPiResumeToolResults', () => {
  test('maps each interaction to a ToolResultMessage in store order', () => {
    const rows = mapPiResumeToolResults([answered, declined], { timestamp: 42 });
    expect(rows).toHaveLength(2);
    const first = rows[0];
    const second = rows[1];
    if (!first || !second) throw new Error('expected two tool results');
    expect(first).toMatchObject({
      role: 'toolResult',
      toolCallId: 'call_1',
      toolName: 'AskHuman',
      content: [
        {
          type: 'text',
          text: '{"answers":[{"questionId":"q1","value":"east"}]}',
        },
      ],
      isError: false,
      timestamp: 42,
    });
    expect(second.toolCallId).toBe('call_2');
    expect(second.content).toEqual([{ type: 'text', text: 'declined' }]);
    const _typed: ToolResultMessage[] = rows;
    expect(_typed).toHaveLength(2);
  });

  test('throws on empty array', () => {
    expect(() => mapPiResumeToolResults([])).toThrow(/non-empty/);
  });

  test('resume API is session.agent.continue after SessionManager.open', () => {
    expect(PI_ASK_RESUME_API).toEqual({
      continueTarget: 'session.agent.continue',
      forbiddenTarget: 'AgentSession.continue',
      afterDispose: 'SessionManager.open',
      appendBeforeContinue: 'toolResult',
    });
  });
});
```

- [ ] **Step 4: Run the protocol tests and confirm they fail**

```bash
(cd packages/providers && bun test src/community/pi/ask-resume-protocol.test.ts)
```

Expected: FAIL because `./ask-resume-protocol` does not exist.

- [ ] **Step 5: Write the mapper**

Create `packages/providers/src/community/pi/ask-resume-protocol.ts`:

```ts
import type { ToolResultMessage } from '@earendil-works/pi-ai';

import {
  assertResumeInteractions,
  serializeResumePayload,
  type ResumeInteraction,
} from '../../shared/resume-interactions';

export const PI_ASK_RESUME_API = {
  continueTarget: 'session.agent.continue',
  forbiddenTarget: 'AgentSession.continue',
  afterDispose: 'SessionManager.open',
  appendBeforeContinue: 'toolResult',
} as const;

export function mapPiResumeToolResults(
  interactions: ResumeInteraction[],
  options?: { toolName?: string; timestamp?: number }
): ToolResultMessage[] {
  const toolName = options?.toolName ?? 'AskHuman';
  const timestamp = options?.timestamp ?? Date.now();
  return assertResumeInteractions(interactions).map(item => ({
    role: 'toolResult',
    toolCallId: item.tool_use_id,
    toolName,
    content: [{ type: 'text', text: serializeResumePayload(item) }],
    isError: false,
    timestamp,
  }));
}
```

- [ ] **Step 6: Run the protocol tests and confirm they pass**

```bash
(cd packages/providers && bun test src/community/pi/ask-resume-protocol.test.ts)
```

Expected: PASS.

- [ ] **Step 7: Refactor if needed, then add isolated invocations**

In `packages/providers/package.json` `scripts.test`, replace `bun test src/community/pi/native-tools.test.ts && bun test src/community/pi/provider.test.ts` with `bun test src/community/pi/native-tools.test.ts && bun test src/community/pi/sdk-ask-resume.characterization.test.ts && bun test src/community/pi/ask-resume-protocol.test.ts && bun test src/community/pi/provider.test.ts`.

Do not call `session.agent.continue()` against a live model.
Do not remove `session.dispose()` from `event-bridge.ts`.
Story 6.3 decides when durable reopen skips in-process dispose.

---

### Task 4: Write the spike outcome, confirm AD-6, and pin Claude 0.3.209

**Files:**

- Create: `_bmad-output/implementation-artifacts/workflow-run-view-hitl/6-1-askhuman-resume-spike.md`
- Modify: `_bmad-output/planning-artifacts/architecture/architecture-Archon-2026-09-05/ARCHITECTURE-SPINE.md`
- Modify: `packages/providers/package.json`
- Modify: `package.json`

**Interfaces:**

- Consumes: Task 2 and Task 3 test results.
- Produces: written confirm-or-amend verdict.

- [ ] **Step 1: If characterization disproved the provisional protocol, amend AD-6 instead of confirming it**

Amendment triggers (any one is enough):

- Installed `@anthropic-ai/claude-agent-sdk` version is not `0.3.209`.
- `AgentSession` has a `continue` method that AD-6 should use instead of `session.agent.continue`.
- A later live spike (optional, not CI) proves custom MCP `AskHuman` cannot host-abort and must use PreToolUse `defer`.

If amending: rewrite the AD-6 Rule in the spine to the new single protocol.
Keep lockfile `0.3.209` unless the amendment explicitly requires `0.3.261` or another version.
Do not leave both host-abort and `tool_deferred` as legal AskHuman resumes.

- [ ] **Step 2: Write the outcome file using this body when the provisional protocol holds**

Create `_bmad-output/implementation-artifacts/workflow-run-view-hitl/6-1-askhuman-resume-spike.md` with this content (keep each prose sentence on its own line):

```markdown
# Story 6.1 spike outcome — Claude and Pi resume after AskHuman

**Issue:** [#86](https://github.com/anhle128/Archon/issues/86)

**Date:** 2026-09-06

**Verdict:** CONFIRM AD-6 Archon-visible contract.
Record SDK how below.
Do not fork a second protocol.

## Claude (`@anthropic-ai/claude-agent-sdk` lockfile 0.3.209)

Observed install version is `0.3.209`.

`HookPermissionDecision` includes `defer`.

`TerminalReason` includes `tool_deferred` and `tool_deferred_unavailable`.

`SDKSessionStateChangedMessage.state` includes `requires_action`.

Those types exist at the pin.
They are the documented pause for built-in `AskUserQuestion` plus PreToolUse `defer`, which re-issues the tool with `updatedInput`.

AskHuman is a custom in-process MCP tool (`mcp__archon__AskHuman`).
AD-9 forbids wrapping `AskUserQuestion`.
Archon's current MCP wrapper awaits `NativeTool.handler` and does not return `permissionDecision: "defer"`.

**Required how:** host abort of the MCP AskHuman callback, then `options.resume` plus one new user message from `mapClaudeResumeUserMessage`.
Do not PreToolUse-defer.
Do not re-issue AskHuman.

CI evidence: `packages/providers/src/claude/sdk-ask-resume.characterization.test.ts`, `packages/providers/src/claude/ask-resume-protocol.test.ts`.

## Pi (`pi-coding-agent` / `pi-agent-core` lockfile 0.80.6)

Observed `pi-coding-agent` version is `0.80.6`.

Observed `pi-agent-core` version is `0.80.6`.

`AgentSession.continue` does not exist.

`session.agent.continue()` does exist.
JSDoc requires the last transcript message to be user or tool-result.

Archon `bridgeSession` still calls `session.dispose()` in `finally`.
Durable resume therefore cannot keep the in-memory session.

**Required how:** `SessionManager.open` using `provider_session_id`, append `mapPiResumeToolResults` onto `session.agent.state.messages` so the tail is `toolResult`, then `session.agent.continue()`.
Same-process skip-dispose remains an optimization and must still consume `resumeInteractions`.

CI evidence: `packages/providers/src/community/pi/sdk-ask-resume.characterization.test.ts`, `packages/providers/src/community/pi/ask-resume-protocol.test.ts`.

## AD-6

Confirmed.
Spine Rule spike sentence is replaced with the how above.

Story 6.3 must not ship continue without this file.
Story 6.2 may persist an Ask without continue.
```

If Step 1 amended instead, rewrite the Verdict and how sections to match the amendment.
Do not leave CONFIRM in the file if the spine Rule changed to `tool_deferred`.

- [ ] **Step 3: Close the spike in the architecture spine**

In `_bmad-output/planning-artifacts/architecture/architecture-Archon-2026-09-05/ARCHITECTURE-SPINE.md`:

Replace the AD-6 Rule sentence `SDK _how_ (Claude \`tool_deferred\` vs host abort; Pi reopen-after-dispose) is a required spike — it may amend this Rule, not fork it silently.` with `SDK how (Story 6.1, lockfile Claude 0.3.209 / pi-agent-core 0.80.6): Claude host-aborts the in-process MCP AskHuman tool (do not PreToolUse-defer; do not wrap AskUserQuestion; resume is options.resume plus one new user message, no tool re-issue). Pi durable resume is SessionManager.open then append ToolResultMessage(s) onto session.agent.state.messages then session.agent.continue() (not AgentSession.continue()). Same-process skip-dispose remains an optimization that must still use resumeInteractions.`

In the Consistency Conventions Claude SDK row, keep lockfile **0.3.209** and replace “until the AD-6 spike amends AD-6” with “Story 6.1 confirmed host abort plus new user message; do not float this pin without a new AD-6 amendment.”

In the Stack table Claude row, change `**0.3.209** (lockfile exact until AD-6 spike; npm latest 0.3.261)` to `**0.3.209** (lockfile exact; Story 6.1 confirmed; do not caret-float to 0.3.261 without amending AD-6)`.

In Deferred, replace the Claude `tool_deferred` / PreToolUse `defer` row Why with `Story 6.1 rejected this for AskHuman. AskUserQuestion plus defer remains out of scope (AD-9).`

Replace the Pi reopen-after-dispose row Why with `Story 6.1 recorded SessionManager.open plus ToolResultMessage plus session.agent.continue() as the durable recipe. sendQuery wiring is Story 6.3.`

If Step 1 amended to `tool_deferred`, write the opposite sentences instead of these confirm sentences.

- [ ] **Step 4: Pin the Claude SDK exact version when AD-6 is confirmed without a bump**

In `packages/providers/package.json` and root `package.json`, change `"@anthropic-ai/claude-agent-sdk": "^0.3.209"` to `"@anthropic-ai/claude-agent-sdk": "0.3.209"`.

Do not change Pi ranges.
`^0.80.6` already stays on 0.80.x.

Do not run a lockfile-changing install unless `bun.lock` would otherwise drift.
After the pin, `bun.lock` should still resolve `@anthropic-ai/claude-agent-sdk@0.3.209`.

- [ ] **Step 5: Type-check providers**

```bash
(cd packages/providers && bun run type-check)
```

Expected: PASS.

---

### Task 5: Record story completion and run validation

**Files:**

- Modify: `_bmad-output/implementation-artifacts/workflow-run-view-hitl/sprint-status.yaml`

- [ ] **Step 1: Confirm every new test file is in `scripts.test`**

`packages/providers/package.json` `scripts.test` must contain all five of:

- `bun test src/shared/resume-interactions.test.ts`
- `bun test src/claude/sdk-ask-resume.characterization.test.ts`
- `bun test src/claude/ask-resume-protocol.test.ts`
- `bun test src/community/pi/sdk-ask-resume.characterization.test.ts`
- `bun test src/community/pi/ask-resume-protocol.test.ts`

Each must be its own `bun test` process, not a glob.

- [ ] **Step 2: Run focused tests**

```bash
(cd packages/providers && bun test src/shared/resume-interactions.test.ts)
(cd packages/providers && bun test src/claude/sdk-ask-resume.characterization.test.ts)
(cd packages/providers && bun test src/claude/ask-resume-protocol.test.ts)
(cd packages/providers && bun test src/community/pi/sdk-ask-resume.characterization.test.ts)
(cd packages/providers && bun test src/community/pi/ask-resume-protocol.test.ts)
```

Expected: PASS.

- [ ] **Step 3: Prove out-of-scope paths were not touched**

```bash
git diff --name-only -- packages/workflows/src/dag-executor.ts packages/providers/src/claude/provider.ts packages/providers/src/community/pi/provider.ts packages/providers/src/claude/native-tools.ts packages/providers/src/community/pi/native-tools.ts packages/providers/src/types.ts packages/server packages/web packages/core/src/db migrations/000_combined.sql
```

Expected: no output.

- [ ] **Step 4: Update sprint status**

In `_bmad-output/implementation-artifacts/workflow-run-view-hitl/sprint-status.yaml` set:

- header comment `# last_updated:` to `2026-09-06` plus the local time
- `last_updated:` to the same timestamp string
- `epic-6:` to `in-progress`
- `6-1-prove-claude-and-pi-can-resume-after-askhuman:` to `done`

Leave every other story `backlog`.

- [ ] **Step 5: Format-check and full validate**

```bash
git diff --check
bun run validate
```

Expected: PASS.

---

## Testing Strategy

### Tests to write

| Test file | Cases | Validates |
| --- | --- | --- |
| `packages/providers/src/shared/resume-interactions.test.ts` | declined token, string payload, JSON payload, empty throw | AD-6 / AD-7 declined wire |
| `packages/providers/src/claude/sdk-ask-resume.characterization.test.ts` | exact `0.3.209`, `defer`, `tool_deferred`, `requires_action`, `AskUserQuestion` listed, MCP name | NFR7, version-reality Finding 1 and 3 |
| `packages/providers/src/claude/ask-resume-protocol.test.ts` | one message, declined, join order, empty throw, no AskUserQuestion / tool re-issue | AD-6 Claude mapping |
| `packages/providers/src/community/pi/sdk-ask-resume.characterization.test.ts` | exact `0.80.6`, no `AgentSession.continue`, `agent.continue` exists, `ToolResultMessage`, dispose in bridge | NFR7, brownfield dispose |
| `packages/providers/src/community/pi/ask-resume-protocol.test.ts` | toolCallId mapping, declined, order, empty throw, reopen constants | AD-6 Pi mapping |

### Edge Cases Checklist

- [ ] Empty `resumeInteractions` throws rather than sending an empty user turn.
- [ ] `declined: true` ignores payload.
- [ ] Multiple answered rows become one Claude user message in store order.
- [ ] Multiple answered rows become one Pi `ToolResultMessage` per row in store order.
- [ ] Claude mapper never emits `AskUserQuestion` or `mcp__archon__AskHuman`.
- [ ] Pi mapper uses `role: 'toolResult'` so `continue()` is not asked to resume from an assistant tail.
- [ ] Installed Claude SDK version is exactly `0.3.209`.
- [ ] Installed Pi packages are exactly `0.80.6`.
- [ ] `sendQuery` is unchanged.
- [ ] No live Anthropic or Pi model call in CI.

---

## Validation Commands

1. `(cd packages/providers && bun test src/shared/resume-interactions.test.ts)`
2. `(cd packages/providers && bun test src/claude/sdk-ask-resume.characterization.test.ts)`
3. `(cd packages/providers && bun test src/claude/ask-resume-protocol.test.ts)`
4. `(cd packages/providers && bun test src/community/pi/sdk-ask-resume.characterization.test.ts)`
5. `(cd packages/providers && bun test src/community/pi/ask-resume-protocol.test.ts)`
6. `(cd packages/providers && bun run type-check)`
7. `git diff --name-only -- packages/workflows/src/dag-executor.ts packages/providers/src/claude/provider.ts packages/providers/src/community/pi/provider.ts packages/providers/src/claude/native-tools.ts packages/providers/src/community/pi/native-tools.ts packages/providers/src/types.ts packages/server packages/web packages/core/src/db migrations/000_combined.sql` produces no output.
8. `git diff --check`
9. `bun run validate`

## Acceptance Criteria

- [ ] Characterization tests import lockfile Claude SDK `0.3.209` and fail if the installed version drifts.
- [ ] Characterization records that `defer` / `tool_deferred` / `requires_action` exist and are not the AskHuman path.
- [ ] `AskUserQuestion` is explicitly not wrapped.
- [ ] `mapClaudeResumeUserMessage` turns `ResumeInteraction[]` into one user-message string with no tool re-issue.
- [ ] Characterization tests import lockfile Pi `0.80.6` and prove `AgentSession.continue` is absent.
- [ ] Characterization proves `session.agent.continue` exists and that Archon still `dispose()`s in `bridgeSession`.
- [ ] `mapPiResumeToolResults` turns each interaction into a `ToolResultMessage` with matching `toolCallId`.
- [ ] Reopen recipe is `SessionManager.open` plus append `toolResult` plus `session.agent.continue()`.
- [ ] `_bmad-output/implementation-artifacts/workflow-run-view-hitl/6-1-askhuman-resume-spike.md` exists and states CONFIRM or AMEND.
- [ ] AD-6 in the architecture spine no longer says the SDK how is an open spike.
- [ ] Claude package.json pins are exact `0.3.209` when the protocol is confirmed without a bump.
- [ ] `sendQuery`, AskHuman injection, schema, pause, POST, and UI are unchanged.
- [ ] Focused tests above pass.
- [ ] `_bmad-output/implementation-artifacts/workflow-run-view-hitl/sprint-status.yaml` entry `6-1-prove-claude-and-pi-can-resume-after-askhuman` is `done`.

## Risks

| Risk | Likelihood | Impact | Mitigation |
| --- | --- | --- | --- |
| CI calls a live model and flakes | Medium | High | Characterization is type-and-lockfile only |
| `mock.module` in provider tests leaks into characterization | High | High | New files get isolated `bun test` processes and must not mock the SDKs |
| Implementer wires `sendQuery.resumeInteractions` in this story | Medium | High | File map forbids provider.ts / dag-executor changes |
| Implementer wraps `AskUserQuestion` because docs use it | Medium | High | Characterization asserts the name is known and the mapper must not mention it |
| Caret `^0.3.209` floats a later install to `0.3.261` | High | High | Pin exact `0.3.209` after confirm |
| Pi `continue()` after dispose is only type-proven | Medium | Medium | Outcome records reopen recipe; 6.3 fails the node if reopen cannot re-enter |
| Someone treats `AgentSession.continue` as the API | Low | High | Compile-time `HasContinue = false` plus exported `forbiddenTarget` |

## NOT Building

- `AskHuman` NativeTool, `AskHumanAwaitingError`, or `capabilities.askHuman`.
- Converter support for `questions[]` object arrays.
- `remote_agent_pending_interactions` or any schema change.
- Optional `approvalContext` on `pauseWorkflowRun`.
- `SendQueryOptions.resumeInteractions` on `types.ts` (Story 6.3 adds it and calls the mappers).
- Claude `sendQuery` / Pi `sendQuery` continue wiring.
- Removing `session.dispose()` from `bridgeSession`.
- PreToolUse `defer` hooks.
- Wrapping `AskUserQuestion`.
- Answer POST, SSE `node_awaiting`, or UI Ask cards.
- Live vendor-API harness as a CI gate.

## Open Questions

1. Should CI require a live Anthropic / Pi model round-trip?
   Provisional default: no.
   Lockfile type characterization plus pure mappers plus the written outcome satisfy Story 6.1.
   A live harness may be added later behind env keys and must not be required for `bun run validate`.

2. Should this story add `resumeInteractions` to `SendQueryOptions`?
   Provisional default: no.
   Keep the shape in `packages/providers/src/shared/resume-interactions.ts`.
   Story 6.3 adds the field to `SendQueryOptions` and calls the mappers from `sendQuery`.

3. If a future live run shows custom MCP AskHuman cannot host-abort, may 6.3 use `tool_deferred` without amending AD-6?
   Provisional default: no.
   Only this story (or a follow-up that amends the spine) may change the Rule.
   Story 6.3 must not fork a silent second protocol.
