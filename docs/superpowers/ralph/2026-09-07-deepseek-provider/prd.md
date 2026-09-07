# DeepSeek Harness Community Provider Ralph PRD

Source plan: `docs/superpowers/plans/2026-09-07-deepseek-provider.md`  
Derived slug: `2026-09-07-deepseek-provider`

## Overview

Add a community provider named `deepseek` that drives the pinned DeepSeek Harness (DSH) runtime over Agent Client Protocol (ACP) for chat and workflow turns. The provider supports durable session resume, cancellation, Model Context Protocol (MCP), conservative fail-safe permissions, best-effort structured output, and truthful usage reporting (no fabricated tokens, breakdown, or costs).

The host process runs on Bun, dynamically loads the ACP client, and launches the pinned DSH entrypoint under a real Node executable (`<node> <resolved @deepseek-ai/dsh/lib/bin.js> --profile acp`). Communication uses ACP v1 JSON-RPC over stdio. ACP session notifications stream into an async queue that yields `MessageChunk` values, and the child process is reaped cleanly after every turn (`docs/superpowers/plans/2026-09-07-deepseek-provider.md:7-14`).

Production changes are restricted to `@archon/providers`, documentation, matrix generation, and a focused workflow loader test (`docs/superpowers/plans/2026-09-07-deepseek-provider.md:17-20`).

## Problem

Archon needs to support DeepSeek models via the official DeepSeek Harness runtime without compromising Archon's security, stability, or telemetry integrity:
1. **Runtime Isolation & Packaging**: DSH is distributed as Node-targeted JavaScript (`@deepseek-ai/dsh`) and speaks ACP over stdio. Node cannot execute DSH from Bun's embedded binary filesystem (`BUNDLED_IS_BINARY`), so Archon must detect binary mode preflight and resolve a valid Node executable on source/npm installations (`docs/superpowers/plans/2026-09-07-deepseek-provider.md:111-115`).
2. **Protocol & Lifecycle Fidelity**: ACP notifications must be mapped to Archon chunks in real time without leaking live subprocesses or hanging on blocked pipes. Session resume must be fail-closed (never falling back to `session/new` if resume fails), and cancel must be an ACP notification followed by session close and process reaping (`docs/superpowers/plans/2026-09-07-deepseek-provider.md:26-29`).
3. **Fail-Safe Security**: DSH prompts for tool permissions by default. Archon must auto-cancel all permission requests to prevent interactive hanging, permitting full access only when `permissionMode: danger-full-access` is explicitly configured (`docs/superpowers/plans/2026-09-07-deepseek-provider.md:30`). Stored API keys must never leak in error messages, child stderr, or logs (`docs/superpowers/plans/2026-09-07-deepseek-provider.md:35`).
4. **Truthful Telemetry**: Pinned DSH reports context occupancy (`used` and `size`) in `usage_update`, rather than per-request billing tokens. Archon must omit token and cost metrics rather than fabricating billing data (`docs/superpowers/plans/2026-09-07-deepseek-provider.md:34`).
5. **Config & Protocol Bounds**: Pinned DSH ACP exposes only `model` and `reasoning_effort`. Configured `maxTokens` or unsupported MCP transports (SSE) must fail fast with clear typed errors instead of being silently ignored (`docs/superpowers/plans/2026-09-07-deepseek-provider.md:106-109`).

## Solution

1. **Exact Runtime Dependencies**: Pin `@agentclientprotocol/sdk@1.4.0` and `@deepseek-ai/dsh@0.1.2-rc.1` in `packages/providers/package.json` (`docs/superpowers/plans/2026-09-07-deepseek-provider.md:144-161`).
2. **Preflight & Resolution**: Parse provider config, translate effort levels, construct child environment with secret redaction, auto-cancel permission requests, and locate Node and bundled DSH paths (`docs/superpowers/plans/2026-09-07-deepseek-provider.md:203-485`).
3. **Event & MCP Translation**: Map ACP `SessionUpdate` events to Archon `MessageChunk` values without fabricating usage. Validate and convert Archon MCP configs into ACP stdio and Streamable HTTP declarations, rejecting SSE (`docs/superpowers/plans/2026-09-07-deepseek-provider.md:486-586`).
4. **ACP Client & Process Runner**: Manage ACP handshake, session creation/resume, prompt execution, abort via `session/cancel`, prompt augmentation for structured output, and process lifecycle with SIGTERM/SIGKILL escalation (`docs/superpowers/plans/2026-09-07-deepseek-provider.md:587-754`).
5. **Provider Boundary & Registry**: Implement `DeepseekProvider` adhering to `IAgentProvider`, convert thrown errors into redacted error results, lazily import ACP client code, register provider idempotently in community registry, and update operator documentation and capability matrix (`docs/superpowers/plans/2026-09-07-deepseek-provider.md:755-994`).
6. **Live Verification & Audit**: Add non-default opt-in live test spike and execute repository validation and pattern audit (`docs/superpowers/plans/2026-09-07-deepseek-provider.md:995-1393`).

## Goals and Success Metrics

| Goal | Success metric | Evidence source |
| --- | --- | --- |
| Reproducible ACP runtime | Pinned exact SDK and DSH versions; Bun stream adapter passes loopback characterization | `ndjson-stream.test.ts` (`docs/superpowers/plans/2026-09-07-deepseek-provider.md:163-193`) |
| Fail-safe preflight & permissions | Missing credentials and unsupported options fail fast; all permission prompts auto-cancel | `env.test.ts`, `permission.test.ts`, `node-resolver.test.ts` (`docs/superpowers/plans/2026-09-07-deepseek-provider.md:350-484`) |
| Truthful chunk translation | Message, thinking, and tool chunks stream correctly; no usage or cost is fabricated | `event-bridge.test.ts` (`docs/superpowers/plans/2026-09-07-deepseek-provider.md:488-537`) |
| Deterministic ACP lifecycle | Fresh turns call new; resumed turns call resume; cancel aborts and reaps child cleanly | `acp-client.test.ts` (`docs/superpowers/plans/2026-09-07-deepseek-provider.md:636-753`) |
| Lazy evaluation & registry integration | Provider registration does not evaluate ACP SDK values; workflow parser resolves `deepseek` | `provider-lazy-load.test.ts`, `registry.test.ts`, `loader.test.ts` (`docs/superpowers/plans/2026-09-07-deepseek-provider.md:835-917`) |
| Operator documentation & compliance | Capability matrix regenerated with MCP caveat; guide and config reference updated; full validation passes | `scripts/generate-capability-matrix.ts`, docs files, `bun run validate` (`docs/superpowers/plans/2026-09-07-deepseek-provider.md:921-993, 1048-1393`) |

## Non-Goals

- Per-request token, cache, reasoning, or cost usage reporting (`docs/superpowers/plans/2026-09-07-deepseek-provider.md:1424`).
- Token-level streaming beyond committed ACP message and thought updates (`docs/superpowers/plans/2026-09-07-deepseek-provider.md:1425`).
- ACP session fork, load, list, delete, mode, plan, terminal, elicitation, and filesystem extensions (`docs/superpowers/plans/2026-09-07-deepseek-provider.md:1426`).
- Native Archon tools, AskHuman, hooks, skills, inline sub-agents, tool restrictions, fallback models, cost controls, sandbox overrides, setting sources, and container execution (`docs/superpowers/plans/2026-09-07-deepseek-provider.md:1427`).
- MCP SSE support until pinned DSH supports it (`docs/superpowers/plans/2026-09-07-deepseek-provider.md:1428`).
- Private `max_tokens` ACP option or DSH patch overlays (`docs/superpowers/plans/2026-09-07-deepseek-provider.md:1429`).
- DeepSeek tier defaults in workflows without approved DashScope model IDs (`docs/superpowers/plans/2026-09-07-deepseek-provider.md:1430`).
- Node sidecar, runtime extraction, or global DSH fallback (`docs/superpowers/plans/2026-09-07-deepseek-provider.md:1431-1433`).
- Any changes to database schema, API schemas, credential delivery, auth routes, or core config loader (`docs/superpowers/plans/2026-09-07-deepseek-provider.md:1434`).

## Technical Context

- **Dependencies**: Pin `@agentclientprotocol/sdk@1.4.0` and `@deepseek-ai/dsh@0.1.2-rc.1` in `packages/providers/package.json` (`docs/superpowers/plans/2026-09-07-deepseek-provider.md:144-161`).
- **Capability Object**: Exact 16-key structure in `packages/providers/src/community/deepseek/capabilities.ts` (`docs/superpowers/plans/2026-09-07-deepseek-provider.md:234-254`).
- **Config & Effort**: `packages/providers/src/community/deepseek/config.ts` parses `model`, `baseUrl`, `providerRoute`, `profile`, `permissionMode`, `effort`, `nodeBin`. Maps effort `minimal->off`, `medium->low`, `xhigh->high`; rejects unknown effort and `maxTokens` (`docs/superpowers/plans/2026-09-07-deepseek-provider.md:218-301`).
- **Typed Errors & Redaction**: `packages/providers/src/community/deepseek/errors.ts` defines `DeepseekProviderError` with 9 subtypes, `redactDeepseekSecrets`, and `toDeepseekErrorResult` producing `{ type: 'result', isError: true, errorSubtype, errors: [...] }` (`docs/superpowers/plans/2026-09-07-deepseek-provider.md:370-394`).
- **Environment Precedence**: Request `DEEPSEEK_API_KEY` beats ambient; config `baseUrl` beats request and ambient `DEEPSEEK_BASE_URL`; request `DEEPSEEK_BASE_URL` beats ambient; sets `DSH_PERMISSION_MODE`; never sets `DSH_PROVIDER_ROUTE` (`docs/superpowers/plans/2026-09-07-deepseek-provider.md:353-359, 396-410`).
- **Permission Response**: Always returns `{ outcome: { outcome: 'cancelled' } }` without selecting an option id (`docs/superpowers/plans/2026-09-07-deepseek-provider.md:412-422`).
- **Node & DSH Resolution**: Precedence `DEEPSEEK_NODE_BIN` -> config `nodeBin` -> host `process.execPath` -> PATH. Source mode resolves `@deepseek-ai/dsh/lib/bin.js`; compiled binary mode fails with `deepseek_runtime_unavailable` (`docs/superpowers/plans/2026-09-07-deepseek-provider.md:424-463`).
- **Event Bridge**: `packages/providers/src/community/deepseek/event-bridge.ts` translates ACP `SessionUpdate` to Archon chunks. Supports pinned DSH nested content `ToolCallUpdate`, preserves call IDs, ignores `usage_update` (`docs/superpowers/plans/2026-09-07-deepseek-provider.md:488-537`).
- **MCP Bridge**: `packages/providers/src/community/deepseek/mcp.ts` validates stdio (command via PATH) and Streamable HTTP; rejects SSE with `deepseek_mcp_config_error` (`docs/superpowers/plans/2026-09-07-deepseek-provider.md:541-585`).
- **Async Queue**: `packages/providers/src/community/deepseek/async-queue.ts` provides iterable FIFO buffer bridging push callbacks to async generator (`docs/superpowers/plans/2026-09-07-deepseek-provider.md:589-632`).
- **ACP Client & Process Runner**: `packages/providers/src/community/deepseek/acp-client.ts` drives handshake, prompt, abort (`ctx.notify(methods.agent.session.cancel, ...)`), structured output, and process cleanup with 2000ms SIGTERM -> SIGKILL grace (`docs/superpowers/plans/2026-09-07-deepseek-provider.md:636-753`).
- **Provider Class**: `packages/providers/src/community/deepseek/provider.ts` implements `IAgentProvider`. Injects dependencies for testing; lazily imports `./acp-client` in production; catches errors and emits redacted error result (`docs/superpowers/plans/2026-09-07-deepseek-provider.md:757-831`).
- **Registry & Exports**: `packages/providers/src/community/deepseek/registration.ts` registers `deepseek` with `builtIn: false` and vendor `deepseek`. Lazy-load test proves zero ACP SDK value evaluation upon import/instantiation (`docs/superpowers/plans/2026-09-07-deepseek-provider.md:835-917`).
- **Docs & Matrix**: Regenerate matrix via `bun run generate:capability-matrix`; update `ai-assistants.md`, `configuration.md`, and `mcp-servers.md` (`docs/superpowers/plans/2026-09-07-deepseek-provider.md:921-993`).
- **Live Spike & Final Audit**: Opt-in spike script `spike:deepseek:acp`; final validation commands and regex audits (`docs/superpowers/plans/2026-09-07-deepseek-provider.md:995-1393`).

## Story Overview

| Priority | Story | Title | Depends on | Plan anchors |
| --- | --- | --- | --- | --- |
| 1 | US-001 | Pin ACP and DSH runtime dependencies and characterize Bun streams | - | 117-202 |
| 2 | US-002 | Define DeepSeek config, effort translation, and capabilities | US-001 | 203-346 |
| 3 | US-003 | Implement runtime resolution, child environment, permission policy, and typed errors | US-001, US-002 | 348-485 |
| 4 | US-004 | Translate ACP session updates without fabricating usage | US-001 | 486-538 |
| 5 | US-005 | Validate and convert per-node MCP declarations | US-001, US-003 | 539-586 |
| 6 | US-006 | Implement async callback-to-generator queue | US-001 | 587-633 |
| 7 | US-007 | Drive complete ACP turn lifecycle and process cleanup | US-001, US-003, US-004, US-005, US-006 | 634-754 |
| 8 | US-008 | Implement DeepSeekProvider boundary with error-as-result semantics | US-002, US-003, US-005, US-007 | 755-832 |
| 9 | US-009 | Register provider, export public surface, and prove lazy loading and workflow selection | US-008 | 833-918 |
| 10 | US-010 | Document DeepSeek provider and regenerate capability matrix | US-009 | 919-994 |
| 11 | US-011 | Add explicit opt-in ACP live handshake spike | US-009 | 995-1045 |
| 12 | US-012 | Final repository validation and pattern audit | US-009, US-010, US-011 | 1046-1393 |

## Ralph Execution Notes

- Implement exactly one story per fresh-context Ralph iteration.
- Do not start a story until every `dependsOn` story has `passes: true`.
- Run package tests from their respective package directories; never run root `bun test`.
- Keep ACP SDK value imports isolated to `acp-client.ts`; use type-only imports elsewhere in production code.
- Never log, emit, or include `DEEPSEEK_API_KEY` in stderr, errors, or test output.
