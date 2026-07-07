---
project_name: 'Archon'
user_name: 'kevin'
date: '2026-07-06'
sections_completed:
  [
    'technology_stack',
    'language_rules',
    'framework_rules',
    'testing_rules',
    'quality_rules',
    'workflow_rules',
    'anti_patterns',
  ]
existing_patterns_found: 18
status: 'complete'
rule_count: 77
optimized_for_llm: true
---

# Project Context for AI Agents

_This file contains critical rules and patterns that AI agents must follow when implementing code in this project._
_Focus on unobvious details that agents might otherwise miss._

---

## Technology Stack & Versions

- Runtime/package manager: Bun `^1.3.0`, ESM workspaces under `packages/*`.
- Language: TypeScript `^5.3.0`, `strict: true`, target/lib `ES2022`, module resolution `bundler`.
- Backend/API: Hono `^4.12.16`, `@hono/zod-openapi` `^1.4.0`, Zod v4.
- Database: SQLite via `bun:sqlite` by default; PostgreSQL via `pg ^8.11.0` when `DATABASE_URL` is set.
- Web app: React `^19.0.0`, Vite `^6.0.0`, Tailwind CSS v4, shadcn/Radix primitives, Zustand `^5.0.12`, TanStack Query `^5.0.0`.
- Workflow engine: YAML DAG workflows, bundled defaults generated from `.archon/commands/defaults/` and `.archon/workflows/defaults/`.
- Provider SDKs: Claude Agent SDK `^0.3.193`, OpenAI Codex SDK `^0.139.0`, OpenCode SDK `^1.17.3`, Pi `^0.79.1`, GitHub Copilot SDK `~1.0.1`.
- Platform adapters: Slack Bolt `^4.6.0`, grammy `^1.36.0`, Octokit `^22.0.0`, discord.js `^14.16.0`.
- Auth: Better Auth `~1.3`, enabled for web only when configured with PostgreSQL and `BETTER_AUTH_SECRET`.
- Docs: Astro `^6.1.0` with Starlight `^0.38.0`.
- Release version source: root `package.json` `version` is the project version; do not treat generated files or package-local metadata as independent release sources.

## Critical Implementation Rules

### Language-Specific Rules

- All TypeScript must satisfy the root strict config: explicit function return types, no unused locals/parameters, no implicit returns, no fallthrough switches, and no non-null assertions.
- Do not use `any` unless an inline comment names the external SDK type gap or the validation that makes the assertion safe.
- Use `import type` for type-only imports and named imports for runtime values.
- Do not use `import * as core from '@archon/core'`; namespace imports are only acceptable for focused submodules such as `@archon/core/db/conversations` or `@archon/git`.
- Keep the repo ESM-native; do not introduce CommonJS `require` or Node-only module assumptions unless the surrounding file already does so for build tooling.
- Prefer `execFileAsync` or `@archon/git` helpers for process calls; never use shell-string `exec` for git operations.
- Define Zod schemas as the source of truth and derive types with `z.infer<typeof schema>` instead of writing parallel interfaces.
- Import `z` from `@hono/zod-openapi` for server, core, and workflow schemas; only SDK-only provider leaf code may import directly from `zod`.
- Always write Zod records as `z.record(z.string(), valueSchema)` because this project uses Zod v4.
- Use explicit discriminated unions and typed interfaces for major contracts instead of hidden dynamic shapes.

### Framework-Specific Rules

- API routes must use `registerOpenApiRoute(createRoute({...}), handler)` so OpenAPI, runtime validation, and frontend type generation stay aligned.
- Raw wildcard artifact routes may use `app.get(...)` only when OpenAPI 3.0 cannot represent the path and the response is non-JSON; keep the explanatory comment with the exception.
- Multipart-or-JSON routes still register through `registerOpenApiRoute`, but omit `request.body` and manually parse both content types in the handler.
- Core row schemas belong in `packages/core/src/schemas/`, route schemas in `packages/server/src/routes/schemas/`, and engine schemas in `packages/workflows/src/schemas/`.
- `@archon/web` must consume OpenAPI-derived types through `packages/web/src/lib/api.ts` or `api.generated.d.ts`; do not import from `@archon/workflows`, `@archon/server`, or backend packages in web code.
- Regenerate web API types with `bun --filter @archon/web generate:types` only while the server is running on port `3090`.
- Workflow engine code must receive DB, AI, config, and platform behavior through `WorkflowDeps`; it must not import `@archon/core`, `@archon/server`, or adapter packages directly.
- Provider SDK dependencies stay inside `@archon/providers`; workflow-facing provider contracts come from `@archon/providers/types`.
- Add community providers by localizing implementation under `packages/providers/src/community/<id>/` and registering through the provider registry, not by adding scattered switch statements.
- Workflow YAML node validation goes through `dagNodeSchema.safeParse()`; graph-level checks for cycles, dependencies, and `$nodeId.output` references stay in `validateDagStructure()`.
- Bundled default commands and workflows are generated from `.archon/commands/defaults/` and `.archon/workflows/defaults/`; never hand-edit `packages/workflows/src/defaults/bundled-defaults.generated.ts`.
- Database access goes through the `IDatabase` adapter interface and must work for both SQLite and PostgreSQL unless the code is explicitly backend-specific.
- SQLite does not support `RETURNING` on `UPDATE` or `DELETE` through the adapter; use a `SELECT` before mutation when row data is needed.
- React UI uses existing components, tokens, and `packages/web/src/index.css`; avoid introducing new visual tokens without updating the design source.
- The `/console` experiment is isolated: it must not import production web UI modules, `@tanstack/react-query`, or function exports from `@/lib/api`; use generated types and the local skills layer.

### Testing Rules

- Do not run root `bun test` as the validation signal; it runs all packages in one process and causes `mock.module()` pollution failures.
- Use `bun run test` for the full suite because package scripts split tests into isolated Bun processes.
- For focused checks, run the relevant package script or a single test file rather than broad root discovery.
- Treat `mock.module()` as process-global and irreversible; `mock.restore()` does not restore replaced modules in Bun.
- When adding tests that mock the same module differently, place them in a separate test invocation in that package's `package.json`.
- Prefer testing through public package boundaries and narrow interfaces such as `IDatabase`, `IWorkflowStore`, `WorkflowDeps`, `IAgentProvider`, and platform adapters.
- Workflow changes need loader/schema tests plus executor or route behavior coverage when they affect DAG semantics, `when`, `trigger_rule`, `route_loop`, retries, sessions, or artifacts.
- API changes need route tests and generated type checks when the OpenAPI surface changes.
- Database changes must cover both SQLite and PostgreSQL behavior when SQL semantics differ.
- UI changes should include reducer/store/component tests for state transitions, and E2E or screenshot verification when the user-facing flow or layout changes materially.
- Bug fixes should start by reproducing the bug as close to the end-user path as practical before changing implementation code.
- `bun run validate` is the pre-PR gate and includes generated checks, type-check, lint with zero warnings, format check, and package-isolated tests.

### Code Quality & Style Rules

- ESLint warnings are failures; CI expects `bun run lint --max-warnings 0`.
- Inline ESLint disables are acceptable only for documented external SDK type gaps or intentional assertions after validation.
- Never bulk-disable ESLint at file level to make CI pass.
- Follow naming rules: interfaces and type aliases are PascalCase, functions are camelCase or PascalCase, variables are camelCase or UPPER_CASE.
- Use single quotes, semicolons, trailing commas where Prettier emits them, 2-space indentation, and `printWidth: 100`.
- Keep files and abstractions scoped to the package boundary; do not create cross-layer helper modules that mix policy, transport, storage, and UI.
- Apply rule-of-three pragmatically: duplicate small local logic when it is clearer, and extract shared utilities only after repeated stable usage.
- Comments should explain non-obvious policy, fallback behavior, or external constraints; avoid comments that restate the code.
- Long Markdown documents should put each full sentence on its own physical line.
- Do not manually modify `CHANGELOG.md` or files marked auto-generated.
- Generated files changed by source edits must be regenerated with the project script instead of hand-edited.
- Structured logs should use named Pino events in the `{domain}.{action}_{state}` style and avoid leaking prompts, user content, paths, remotes, tokens, or raw secrets.

### Development Workflow Rules

- `main` is the release branch; feature work branches from `dev` and merges back into `dev`.
- Do not commit directly to `main`.
- Project `.archon/config.yaml` sets worktree `baseBranch: dev`; preserve that assumption unless the branch policy changes.
- PRs must use `.github/PULL_REQUEST_TEMPLATE.md`, fill every section, and include validation evidence.
- When creating PRs with `gh pr create`, pass an explicit body from the template because GitHub only auto-applies it in the web UI.
- Link issues with `Closes #...`, `Fixes #...`, or `Resolves #...` when applicable.
- Pre-PR validation is `bun run validate`, which runs bundled checks, Pi vendor map checks, type-check, lint, format check, and tests.
- If `.archon/commands/defaults/` or `.archon/workflows/defaults/` changes, run `bun run generate:bundled` or verify with `bun run check:bundled`.
- If bundled schema sources change, run `bun run generate:bundled-schema` or verify with `bun run check:bundled-schema`.
- If Pi provider vendor/model mapping changes, run `bun run generate:pi-vendor-map` or verify with `bun run check:pi-vendor-map`.
- If API schemas or routes change, regenerate web types with the server running on port `3090`.
- Releases use the release workflow, Semantic Versioning, the root `package.json` version, and Keep a Changelog format; do not manually edit changelog files during normal feature work.
- Commit messages must not auto-add an agent co-author line.

### Critical Don't-Miss Rules

- Never run `git clean -fd`; it can permanently delete user work.
- Never silently discard, reset, or overwrite worktree changes unless the user explicitly requested that destructive action.
- Do not autonomously mark non-terminal workflow runs or environments as failed, cancelled, destroyed, or abandoned based only on age or ambiguous ownership across processes.
- Fail closed on missing, invalid, or untrusted JSON contracts; do not parse Markdown reports or prose as workflow route APIs.
- Workflow route-facing contracts must preserve the same story or run identity across nodes; identity mismatch is an error, not a recoverable warning.
- Do not silently broaden AI provider permissions, filesystem access, network access, sandbox settings, tool access, or credential delivery.
- Secrets and user credentials must stay encrypted at rest where existing stores do so, and must not appear in logs, telemetry, artifacts, API responses, or UI state.
- Webhooks must verify signatures, and internal credential endpoints must stay loopback-only unless a deployment guard explicitly changes that trust boundary.
- Do not add multi-tenant policy, visibility matrices, or role complexity beyond the existing open-by-default admin/member seam without an accepted feature.
- Do not import SDK packages outside `@archon/providers`; SDK churn must not leak into `@archon/workflows`, `@archon/core`, `@archon/server`, or `@archon/web`.
- Do not add workflow engine dependencies on core DB modules; extend `IWorkflowStore` or `WorkflowDeps` only when there is a current caller and a narrow contract.
- Do not duplicate runtime enum arrays when they can be derived from schema `.options`.
- Do not treat `decision_needed` or human-judgment follow-up as fixed work in generated PR handoffs; defer and link it explicitly.
- Do not route workflow `ERROR` outcomes back into implementation loops that are meant for quality `FAIL`; keep tooling/schema errors separate from fixable findings.
- Do not add speculative config keys, interface methods, feature flags, workflow branches, or provider settings without a concrete accepted use case.

---

## Usage Guidelines

**For AI Agents:**

- Read this file before implementing any code.
- Follow all rules exactly as documented.
- When in doubt, prefer the more restrictive option.
- Update this file if durable new implementation patterns emerge.

**For Humans:**

- Keep this file lean and focused on agent needs.
- Update it when the technology stack, package boundaries, or generated artifact flow changes.
- Review periodically for outdated rules.
- Remove rules that become obvious or obsolete over time.

Last Updated: 2026-07-06
