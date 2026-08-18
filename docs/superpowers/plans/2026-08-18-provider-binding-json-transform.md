# Provider-Binding Outbound JSON Transform Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.
> Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an optional per-binding JSONata outbound transform and private receiver headers so Archon can persist a receiver-shaped JSON body and send extra auth headers without changing `workflow-event-envelope.v1` or exposing secrets.

**Architecture:** Keep `workflow-event-envelope.v1` as the only transform input.
Normalize and AST-validate the JSONata config before any binding write, evaluate the expression exactly once after envelope construction, and persist the exact serialized string as `event_body`.
Store private receiver headers in a separate binding column, merge them after Archon-owned HMAC headers, and persist only redacted header evidence on delivery attempts.

**Tech Stack:** Bun, strict TypeScript, Zod through `@hono/zod-openapi`, `jsonata@2.2.2`, SQLite, PostgreSQL, and Bun Test.

**Spec:** `docs/superpowers/specs/2026-08-18-provider-binding-json-transform-design.md`

## Global Constraints

- Use the approved design as the source of truth and do not add receiver-specific fields, schemas, names, or routing rules.
- Keep `workflow-event-envelope.v1` unchanged at runtime and in insertion order.
- Add `jsonata` version `2.2.2` only to `@archon/core` through Bun so the root lockfile records the exact resolution.
- Store the transform in `transform` and the private header map in `delivery_headers`.
- Persist the normalized transform object, including resolved defaults.
- Validate transform and headers before create or update mutates the database.
- Apply the transform once at enqueue time, never at delivery time.
- Persist the exact `transformWorkflowEventBody` string as `event_body`.
- Keep HMAC input as `timestamp + "." + row.event_body` and never rebuild that body.
- Catch classified transform errors separately from the existing best-effort enqueue guard.
- Persist transform failures as `status = "not-routable"`, `not_routable_reason = "transform-failed"`, `last_error = <safe code>`, `event_body = JSON.stringify(canonicalEnvelope)`, and `next_attempt_at = null`.
- Never fail the workflow run because a transform or outbox write failed.
- Keep receiver header values out of public binding reads, command output, logs, errors, and delivery-attempt evidence.
- Use file flags only for transform, envelope, and receiver-header inputs.
- Do not echo file paths or file contents in success or error envelopes.
- Database changes are additive in both dialects.
- Every new `ADD COLUMN ... NOT NULL` must include a `DEFAULT`.
- Never edit `packages/core/src/db/bundled-schema.generated.ts` by hand.
- Regenerate the bundled schema with `bun run generate:bundled-schema`.
- Derive TypeScript types with `z.infer<typeof schema>` except the sanctioned recursive-schema pattern, which this feature does not need.
- Import `z` from `@hono/zod-openapi` in core schema files.
- Use `z.record(z.string(), valueSchema)` for record schemas.
- Do not add `any`.
- Visit JSONata AST nodes as `Record<string, unknown>` and do not use JSONata's incomplete `ExprNode` `any` fields.
- Reject both AST `type` values `regex` and `regexp` because JSONata 2.2.2 runtime nodes use `regex` while the published types say `regexp`.
- Map JSONata `timeout` to `timeoutMs`, `stack` to `stackDepth`, and `sequence` to `maxSequenceSize`.
- Classify JSONata `D1012` as `TRANSFORM_TIMEOUT`, `D1011` as `TRANSFORM_STACK_LIMIT`, and `D2015` as `TRANSFORM_SEQUENCE_LIMIT`.
- Put the dry-run command in `packages/cli/src/commands/provider-binding-test.ts` so that command cannot import `@archon/core/db/*`.
- Add `@archon/core` export `"./events/*": "./src/events/*.ts"`.
- Map CLI transform errors to category `provider_contract`, except `TRANSFORM_TIMEOUT` which uses `timeout`.
- Do not add a web UI, plugin registry, second engine, XML, form encoding, or delivery-time transform.
- Do not change workflow event-type filtering or Archon's HMAC header names or format.
- Never run `bun test` from the repository root.
- Run package tests from their package directory.
- Keep every new or substantially edited Markdown sentence on its own physical line.
- Never add an agent name as a commit co-author.

## File Map

- Create `packages/core/src/schemas/provider-binding-transform.ts` for the discriminated transform schema, UTF-8 expression check, and `normalizeProviderBindingTransform()`.
- Create `packages/core/src/schemas/provider-binding-transform.test.ts` for config parse, default, and cap tests.
- Create `packages/core/src/events/provider-binding-transform.ts` for `ProviderBindingTransformError`, AST policy, result validation, and `transformWorkflowEventBody()`.
- Create `packages/core/src/events/provider-binding-transform.test.ts` for AST, evaluation, identity, and result tests.
- Create `packages/core/src/events/delivery-headers.ts` for header validation, merge, and redacted evidence.
- Create `packages/core/src/events/delivery-headers.test.ts` for reserved names, token grammar, and privacy tests.
- Create `packages/cli/src/commands/provider-binding-test.ts` for the side-effect-free `binding.test` command.
- Create `_bmad-output/planning-artifacts/contracts/workflow-commander/examples/providers/archon/commands/binding-test-success.json` for the additive command fixture.
- Modify `packages/core/package.json` to depend on `jsonata@2.2.2` and to run the new test files.
- Modify `packages/core/src/schemas/index.ts` to export the transform schema and type.
- Modify `packages/core/src/schemas/workflow-provider-binding.ts` to add optional public `transform`.
- Modify `packages/core/src/schemas/workflow-provider-binding.test.ts` to cover public transform parsing and private-field stripping.
- Modify `packages/core/src/events/workflow-event-envelope.ts` to replace the hand-written envelope interface with a Zod schema.
- Modify `packages/core/src/events/workflow-event-envelope.test.ts` to lock identity serialization and dry-run envelope validation.
- Modify `packages/core/src/db/provider-bindings.ts` to persist, patch, and privately read the two new columns.
- Modify `packages/core/src/db/provider-bindings.test.ts` for create, update, rotate, disable, and privacy tests.
- Modify `migrations/000_combined.sql` to add the two additive columns and `ALTER TABLE` statements.
- Modify `packages/core/src/db/adapters/sqlite.ts` for the fresh schema and `migrateColumns()`.
- Modify `packages/core/src/db/adapters/sqlite.test.ts` for fresh, upgrade, default, and parity coverage.
- Modify `packages/core/src/db/adapters/postgres.test.ts` to assert the new SQL markers.
- Modify `packages/core/src/db/provider-bindings-bundled-schema.test.ts` to assert the new columns.
- Generate `packages/core/src/db/bundled-schema.generated.ts` with `bun run generate:bundled-schema`.
- Modify `packages/core/src/workflows/store-adapter.ts` to transform once and persist `transform-failed` evidence.
- Modify `packages/core/src/workflows/store-adapter.test.ts` for identity, transformed body, filter-before-transform, and failure tests.
- Modify `packages/server/src/workflow-events/dispatcher.ts` to validate headers, merge after HMAC headers, and persist redacted evidence.
- Modify `packages/server/src/workflow-events/dispatcher.test.ts` for stored-body HMAC, header merge, and redaction.
- Modify `packages/cli/src/cli.ts` to parse the new file flags and dispatch `provider-binding test`.
- Modify `packages/cli/src/commands/provider-binding.ts` to read the file flags and pass patch values.
- Modify `packages/cli/src/commands/workflow-provider-command-envelope.ts` to add `binding.test`.
- Modify `packages/cli/src/commands/provider-binding.test.ts`, `provider-binding.e2e.test.ts`, and `workflow-provider-command-envelope.test.ts`.
- Modify `_bmad-output/planning-artifacts/contracts/workflow-commander/schemas/workflow-command-envelope.schema.json` to add `binding.test`.
- Modify `_bmad-output/planning-artifacts/contracts/workflow-commander/validate_contracts.py` to require the new success fixture.
- Modify `packages/docs-web/src/content/docs/reference/cli.md` and the CLI usage text.

---

### Task 1: Transform Config Schema And Normalization

**Files:**

- Create: `packages/core/src/schemas/provider-binding-transform.ts`
- Create: `packages/core/src/schemas/provider-binding-transform.test.ts`
- Modify: `packages/core/src/schemas/index.ts`
- Modify: `packages/core/package.json`
- Modify: `bun.lock`

**Interfaces:**

- Consumes: `@hono/zod-openapi` `z`.
- Produces: `jsonataProviderBindingTransformSchema`, `providerBindingTransformSchema`, `ProviderBindingTransform`, `JSONATA_EXPRESSION_MAX_BYTES = 32768`, `normalizeProviderBindingTransform(value: unknown): ProviderBindingTransform`.

- [ ] **Step 1: Write the failing schema tests**

Create `packages/core/src/schemas/provider-binding-transform.test.ts`:

```ts
import { describe, expect, test } from 'bun:test';
import { normalizeProviderBindingTransform } from './provider-binding-transform';

describe('normalizeProviderBindingTransform', () => {
  test('parses a valid JSONata config and applies every default', () => {
    const result = normalizeProviderBindingTransform({
      engine: 'jsonata',
      expression: '{ "eventType": eventType }',
    });
    expect(result).toEqual({
      engine: 'jsonata',
      expression: '{ "eventType": eventType }',
      timeoutMs: 50,
      stackDepth: 128,
      maxSequenceSize: 10_000,
      maxOutputBytes: 65_536,
    });
  });

  test('rejects each value above its hard cap', () => {
    const base = { engine: 'jsonata', expression: '{ "ok": true }' };
    expect(() => normalizeProviderBindingTransform({ ...base, timeoutMs: 201 })).toThrow(
      /TRANSFORM_CONFIG_INVALID/
    );
    expect(() => normalizeProviderBindingTransform({ ...base, stackDepth: 513 })).toThrow(
      /TRANSFORM_CONFIG_INVALID/
    );
    expect(() => normalizeProviderBindingTransform({ ...base, maxSequenceSize: 100_001 })).toThrow(
      /TRANSFORM_CONFIG_INVALID/
    );
    expect(() => normalizeProviderBindingTransform({ ...base, maxOutputBytes: 262_145 })).toThrow(
      /TRANSFORM_CONFIG_INVALID/
    );
  });

  test('rejects an empty expression and an oversized UTF-8 expression', () => {
    expect(() =>
      normalizeProviderBindingTransform({ engine: 'jsonata', expression: '' })
    ).toThrow(/TRANSFORM_CONFIG_INVALID/);
    expect(() =>
      normalizeProviderBindingTransform({
        engine: 'jsonata',
        expression: 'é'.repeat(16_385),
      })
    ).toThrow(/TRANSFORM_CONFIG_INVALID/);
  });

  test('rejects an unknown engine', () => {
    expect(() =>
      normalizeProviderBindingTransform({ engine: 'jq', expression: '.' })
    ).toThrow(/TRANSFORM_CONFIG_INVALID/);
  });
});
```

- [ ] **Step 2: Run the tests and verify they fail**

Run:

```bash
cd packages/core
bun test src/schemas/provider-binding-transform.test.ts
```

Expected: FAIL because `./provider-binding-transform` does not exist.

- [ ] **Step 3: Add the dependency and write the schema module**

From the repository root:

```bash
bun add jsonata@2.2.2 --filter @archon/core
```

Create `packages/core/src/schemas/provider-binding-transform.ts`:

```ts
import { z } from '@hono/zod-openapi';

export const JSONATA_EXPRESSION_MAX_BYTES = 32_768;

export const jsonataProviderBindingTransformSchema = z.object({
  engine: z.literal('jsonata'),
  expression: z.string().min(1),
  timeoutMs: z.number().int().positive().max(200).default(50),
  stackDepth: z.number().int().positive().max(512).default(128),
  maxSequenceSize: z.number().int().positive().max(100_000).default(10_000),
  maxOutputBytes: z.number().int().positive().max(262_144).default(65_536),
});

export const providerBindingTransformSchema = z.discriminatedUnion('engine', [
  jsonataProviderBindingTransformSchema,
]);

export type ProviderBindingTransform = z.infer<typeof providerBindingTransformSchema>;

function utf8Bytes(value: string): number {
  return new TextEncoder().encode(value).length;
}

export function normalizeProviderBindingTransform(value: unknown): ProviderBindingTransform {
  const parsed = providerBindingTransformSchema.safeParse(value);
  if (!parsed.success) {
    throw new Error('TRANSFORM_CONFIG_INVALID');
  }
  if (utf8Bytes(parsed.data.expression) > JSONATA_EXPRESSION_MAX_BYTES) {
    throw new Error('TRANSFORM_CONFIG_INVALID');
  }
  return parsed.data;
}
```

Export the schema, type, constant, and function from `packages/core/src/schemas/index.ts` under a `ProviderBindingTransform` comment block.

In `packages/core/package.json`, append `&& bun test src/schemas/provider-binding-transform.test.ts` to the existing `src/schemas/workflow-provider-binding.test.ts` test invocation.

- [ ] **Step 4: Run the tests and verify they pass**

Run:

```bash
cd packages/core
bun test src/schemas/provider-binding-transform.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/package.json bun.lock packages/core/src/schemas/provider-binding-transform.ts packages/core/src/schemas/provider-binding-transform.test.ts packages/core/src/schemas/index.ts
git commit -m "$(cat <<'EOF'
feat(core): add provider-binding JSONata transform schema

EOF
)"
```

---

### Task 2: Compile-Time JSONata AST Policy

**Files:**

- Create: `packages/core/src/events/provider-binding-transform.ts`
- Create: `packages/core/src/events/provider-binding-transform.test.ts`
- Modify: `packages/core/package.json`

**Interfaces:**

- Consumes: `ProviderBindingTransform` and `normalizeProviderBindingTransform()` from Task 1.
- Produces: `TRANSFORM_ERROR_CODES`, `TransformErrorCode`, `ProviderBindingTransformError`, `isProviderBindingTransformError(err: unknown): err is ProviderBindingTransformError`, `validateProviderBindingTransform(transform: ProviderBindingTransform): void`.

- [ ] **Step 1: Write the failing AST tests**

Create `packages/core/src/events/provider-binding-transform.test.ts`:

```ts
import { describe, expect, test } from 'bun:test';
import { normalizeProviderBindingTransform } from '../schemas/provider-binding-transform';
import {
  ProviderBindingTransformError,
  validateProviderBindingTransform,
} from './provider-binding-transform';

function transform(expression: string) {
  return normalizeProviderBindingTransform({ engine: 'jsonata', expression });
}

describe('validateProviderBindingTransform', () => {
  test('accepts object construction and canonical envelope field selection', () => {
    expect(() =>
      validateProviderBindingTransform(
        transform('{ "eventType": eventType, "runId": workflowRunRef.runId }')
      )
    ).not.toThrow();
  });

  test('rejects $eval, $now, $millis, and $random by AST node', () => {
    for (const expression of ['$eval("1")', '$now()', '$millis()', '$random()']) {
      expect(() => validateProviderBindingTransform(transform(expression))).toThrow(
        ProviderBindingTransformError
      );
      try {
        validateProviderBindingTransform(transform(expression));
      } catch (err) {
        expect(err).toBeInstanceOf(ProviderBindingTransformError);
        expect((err as ProviderBindingTransformError).code).toBe('TRANSFORM_FUNCTION_DISALLOWED');
        expect((err as Error).message).toBe('TRANSFORM_FUNCTION_DISALLOWED');
        expect((err as Error).message).not.toContain(expression);
      }
    }
  });

  test('rejects an aliased disallowed function call', () => {
    expect(() =>
      validateProviderBindingTransform(transform('($f := $now; $f())'))
    ).toThrow(/TRANSFORM_FUNCTION_DISALLOWED/);
  });

  test('rejects an unknown direct function call', () => {
    expect(() =>
      validateProviderBindingTransform(transform('$pad("x", 8)'))
    ).toThrow(/TRANSFORM_FUNCTION_DISALLOWED/);
  });

  test('rejects partial application, function application, lambdas, transform expressions, and regex nodes', () => {
    expect(() =>
      validateProviderBindingTransform(transform('$string(?)'))
    ).toThrow(/TRANSFORM_AST_DISALLOWED/);
    expect(() =>
      validateProviderBindingTransform(transform('"x" ~> $uppercase()'))
    ).toThrow(/TRANSFORM_AST_DISALLOWED/);
    expect(() =>
      validateProviderBindingTransform(transform('function($x){$x}'))
    ).toThrow(/TRANSFORM_AST_DISALLOWED/);
    expect(() =>
      validateProviderBindingTransform(transform('payload ~> |foo|{bar: 1}|'))
    ).toThrow(/TRANSFORM_AST_DISALLOWED/);
    expect(() =>
      validateProviderBindingTransform(transform('$contains(eventType, /run/)'))
    ).toThrow(/TRANSFORM_AST_DISALLOWED/);
  });

  test('rejects an uncompilable expression without leaking token text', () => {
    try {
      validateProviderBindingTransform(transform('{'));
      throw new Error('expected compile failure');
    } catch (err) {
      expect(err).toBeInstanceOf(ProviderBindingTransformError);
      expect((err as ProviderBindingTransformError).code).toBe('TRANSFORM_COMPILE_FAILED');
      expect((err as Error).message).toBe('TRANSFORM_COMPILE_FAILED');
      expect((err as Error).message).not.toContain('{');
    }
  });
});
```

- [ ] **Step 2: Run the tests and verify they fail**

Run:

```bash
cd packages/core
bun test src/events/provider-binding-transform.test.ts
```

Expected: FAIL because `./provider-binding-transform` does not exist.

- [ ] **Step 3: Write the error type, compiler, and AST visitor**

Create `packages/core/src/events/provider-binding-transform.ts`:

```ts
import jsonata from 'jsonata';
import type { ProviderBindingTransform } from '../schemas/provider-binding-transform';

export const TRANSFORM_ERROR_CODES = [
  'TRANSFORM_CONFIG_INVALID',
  'TRANSFORM_COMPILE_FAILED',
  'TRANSFORM_FUNCTION_DISALLOWED',
  'TRANSFORM_AST_DISALLOWED',
  'TRANSFORM_TIMEOUT',
  'TRANSFORM_STACK_LIMIT',
  'TRANSFORM_SEQUENCE_LIMIT',
  'TRANSFORM_RESULT_INVALID',
  'TRANSFORM_OUTPUT_TOO_LARGE',
  'TRANSFORM_EVALUATION_FAILED',
] as const;

export type TransformErrorCode = (typeof TRANSFORM_ERROR_CODES)[number];

export class ProviderBindingTransformError extends Error {
  readonly code: TransformErrorCode;

  constructor(code: TransformErrorCode) {
    super(code);
    this.name = 'ProviderBindingTransformError';
    this.code = code;
  }
}

export function isProviderBindingTransformError(
  err: unknown
): err is ProviderBindingTransformError {
  return err instanceof ProviderBindingTransformError;
}

const ALLOWED_FUNCTIONS = new Set([
  'string',
  'length',
  'substring',
  'substringBefore',
  'substringAfter',
  'uppercase',
  'lowercase',
  'trim',
  'contains',
  'split',
  'join',
  'number',
  'floor',
  'ceil',
  'round',
  'abs',
  'sqrt',
  'power',
  'boolean',
  'not',
  'count',
  'sum',
  'min',
  'max',
  'average',
  'keys',
  'lookup',
  'append',
  'exists',
  'merge',
  'reverse',
  'distinct',
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function walkAst(node: unknown, seen: WeakSet<object>): void {
  if (!isRecord(node) && !Array.isArray(node)) return;
  if (isRecord(node)) {
    if (seen.has(node)) return;
    seen.add(node);
    const type = node.type;
    if (type === 'function') {
      const procedure = node.procedure;
      if (
        !isRecord(procedure) ||
        procedure.type !== 'variable' ||
        typeof procedure.value !== 'string' ||
        !ALLOWED_FUNCTIONS.has(procedure.value)
      ) {
        throw new ProviderBindingTransformError('TRANSFORM_FUNCTION_DISALLOWED');
      }
    }
    if (
      type === 'partial' ||
      type === 'lambda' ||
      type === 'transform' ||
      type === 'apply' ||
      type === 'regex' ||
      type === 'regexp'
    ) {
      throw new ProviderBindingTransformError('TRANSFORM_AST_DISALLOWED');
    }
    for (const value of Object.values(node)) {
      walkAst(value, seen);
    }
    return;
  }
  for (const value of node) {
    walkAst(value, seen);
  }
}

export function compileProviderBindingTransform(transform: ProviderBindingTransform): jsonata.Expression {
  let compiled: jsonata.Expression;
  try {
    compiled = jsonata(transform.expression, {
      timeout: transform.timeoutMs,
      stack: transform.stackDepth,
      sequence: transform.maxSequenceSize,
    });
  } catch {
    throw new ProviderBindingTransformError('TRANSFORM_COMPILE_FAILED');
  }
  walkAst(compiled.ast(), new WeakSet<object>());
  return compiled;
}

export function validateProviderBindingTransform(transform: ProviderBindingTransform): void {
  compileProviderBindingTransform(transform);
}
```

In `packages/core/package.json`, append `&& bun test src/events/provider-binding-transform.test.ts` after the existing `src/events/workflow-event-envelope.test.ts` invocation.

- [ ] **Step 4: Run the tests and verify they pass**

Run:

```bash
cd packages/core
bun test src/events/provider-binding-transform.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/events/provider-binding-transform.ts packages/core/src/events/provider-binding-transform.test.ts packages/core/package.json
git commit -m "$(cat <<'EOF'
feat(core): validate provider-binding JSONata AST policy

EOF
)"
```

---

### Task 3: Evaluate, Result Validation, And Identity Path

**Files:**

- Modify: `packages/core/src/events/provider-binding-transform.ts`
- Modify: `packages/core/src/events/provider-binding-transform.test.ts`
- Modify: `packages/core/package.json`

**Interfaces:**

- Consumes: `compileProviderBindingTransform()` from Task 2 and `WorkflowEventEnvelope` from `packages/core/src/events/workflow-event-envelope.ts`.
- Produces:

```ts
export interface TransformBodyResult {
  body: string;
  outputBytes: number;
  engine: 'identity' | 'jsonata';
  durationMs: number;
}

export async function transformWorkflowEventBody(
  envelope: WorkflowEventEnvelope,
  transform: ProviderBindingTransform | null
): Promise<TransformBodyResult>;
```

- [ ] **Step 1: Write the failing evaluation tests**

Append to `packages/core/src/events/provider-binding-transform.test.ts`:

```ts
import { buildWorkflowEventEnvelope } from './workflow-event-envelope';
import { transformWorkflowEventBody } from './provider-binding-transform';

const envelope = buildWorkflowEventEnvelope({
  eventId: 'evt-1',
  eventType: 'workflow.run.started',
  occurredAt: '2026-07-25T00:00:00.000Z',
  run: { id: 'run-1', workflow_name: 'bmad-dev-story' },
  codebase: {
    id: 'cb-1',
    name: 'workflow-engine',
    default_cwd: '/workspace/workflow-engine',
    default_branch: 'dev',
  },
  binding: { provider: 'archon', name: 'workflow-engine-primary' },
  payload: { state: 'running', startedAt: '2026-07-25T00:00:00.000Z' },
});

describe('transformWorkflowEventBody', () => {
  test('returns current JSON.stringify(envelope) bytes for identity behavior', async () => {
    const result = await transformWorkflowEventBody(envelope, null);
    expect(result.engine).toBe('identity');
    expect(result.body).toBe(JSON.stringify(envelope));
    expect(result.outputBytes).toBe(new TextEncoder().encode(result.body).length);
  });

  test('returns exact serialized JSON and its byte length', async () => {
    const result = await transformWorkflowEventBody(
      envelope,
      transform('{ "eventType": eventType, "ok": true }')
    );
    expect(result.engine).toBe('jsonata');
    expect(result.body).toBe('{"eventType":"workflow.run.started","ok":true}');
    expect(result.outputBytes).toBe(new TextEncoder().encode(result.body).length);
  });

  test('rejects a scalar top-level result', async () => {
    await expect(transformWorkflowEventBody(envelope, transform('eventType'))).rejects.toThrow(
      /TRANSFORM_RESULT_INVALID/
    );
  });

  test('rejects undefined, functions, symbols, bigints, non-finite numbers, sparse arrays, cycles, and non-plain objects', async () => {
    const { assertJsonTransformResult } = await import('./provider-binding-transform');
    expect(() => assertJsonTransformResult(undefined)).toThrow(/TRANSFORM_RESULT_INVALID/);
    expect(() => assertJsonTransformResult(() => 'x')).toThrow(/TRANSFORM_RESULT_INVALID/);
    expect(() => assertJsonTransformResult(Symbol('x'))).toThrow(/TRANSFORM_RESULT_INVALID/);
    expect(() => assertJsonTransformResult(1n)).toThrow(/TRANSFORM_RESULT_INVALID/);
    expect(() => assertJsonTransformResult(Number.NaN)).toThrow(/TRANSFORM_RESULT_INVALID/);
    expect(() => assertJsonTransformResult(Number.POSITIVE_INFINITY)).toThrow(
      /TRANSFORM_RESULT_INVALID/
    );
    expect(() => assertJsonTransformResult(Number.NEGATIVE_INFINITY)).toThrow(
      /TRANSFORM_RESULT_INVALID/
    );
    const sparse: unknown[] = [];
    sparse[1] = 'x';
    expect(() => assertJsonTransformResult(sparse)).toThrow(/TRANSFORM_RESULT_INVALID/);
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(() => assertJsonTransformResult(cyclic)).toThrow(/TRANSFORM_RESULT_INVALID/);
    expect(() => assertJsonTransformResult(new Date('2026-07-25T00:00:00.000Z'))).toThrow(
      /TRANSFORM_RESULT_INVALID/
    );
  });

  test('rejects output above the configured UTF-8 limit', async () => {
    await expect(
      transformWorkflowEventBody(
        envelope,
        normalizeProviderBindingTransform({
          engine: 'jsonata',
          expression: '{ "v": "éé" }',
          maxOutputBytes: 5,
        })
      )
    ).rejects.toThrow(/TRANSFORM_OUTPUT_TOO_LARGE/);
  });

  test('enforces timeout, stack, and sequence limits with deterministic fixtures', async () => {
    await expect(
      transformWorkflowEventBody(
        envelope,
        normalizeProviderBindingTransform({
          engine: 'jsonata',
          expression: '{ "n": [1..20] }',
          maxSequenceSize: 10,
        })
      )
    ).rejects.toMatchObject({ code: 'TRANSFORM_SEQUENCE_LIMIT' });

    await expect(
      transformWorkflowEventBody(
        envelope,
        normalizeProviderBindingTransform({
          engine: 'jsonata',
          expression: '{ "v": $string($string($string($string("x")))) }',
          stackDepth: 2,
        })
      )
    ).rejects.toMatchObject({ code: 'TRANSFORM_STACK_LIMIT' });

    await expect(
      transformWorkflowEventBody(
        envelope,
        normalizeProviderBindingTransform({
          engine: 'jsonata',
          expression: '{ "n": [1..4000].$string($length($string($))) }',
          timeoutMs: 1,
          maxSequenceSize: 100_000,
        })
      )
    ).rejects.toMatchObject({ code: 'TRANSFORM_TIMEOUT' });
  });
});
```

If the stack or timeout fixture does not trip JSONata on the local machine, keep the fixture and add a direct classifier assertion with `{ code: 'D1011' }` or `{ code: 'D1012' }`.
Do not weaken the sequence fixture.

- [ ] **Step 2: Run the tests and verify they fail**

Run:

```bash
cd packages/core
bun test src/events/provider-binding-transform.test.ts
```

Expected: FAIL because `transformWorkflowEventBody` and `assertJsonTransformResult` are not exported.

- [ ] **Step 3: Implement evaluation and JSON-result validation**

Add these exports to `packages/core/src/events/provider-binding-transform.ts`:

```ts
import type { WorkflowEventEnvelope } from './workflow-event-envelope';

export interface TransformBodyResult {
  body: string;
  outputBytes: number;
  engine: 'identity' | 'jsonata';
  durationMs: number;
}

export function assertJsonTransformResult(value: unknown, seen = new WeakSet<object>()): void {
  if (value === undefined || typeof value === 'function' || typeof value === 'symbol' || typeof value === 'bigint') {
    throw new ProviderBindingTransformError('TRANSFORM_RESULT_INVALID');
  }
  if (typeof value === 'number' && !Number.isFinite(value)) {
    throw new ProviderBindingTransformError('TRANSFORM_RESULT_INVALID');
  }
  if (value === null || typeof value === 'string' || typeof value === 'boolean' || typeof value === 'number') {
    return;
  }
  if (typeof value !== 'object') {
    throw new ProviderBindingTransformError('TRANSFORM_RESULT_INVALID');
  }
  if (seen.has(value)) {
    throw new ProviderBindingTransformError('TRANSFORM_RESULT_INVALID');
  }
  seen.add(value);
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      if (!Object.prototype.hasOwnProperty.call(value, index)) {
        throw new ProviderBindingTransformError('TRANSFORM_RESULT_INVALID');
      }
      assertJsonTransformResult(value[index], seen);
    }
    return;
  }
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) {
    throw new ProviderBindingTransformError('TRANSFORM_RESULT_INVALID');
  }
  for (const nested of Object.values(value as Record<string, unknown>)) {
    assertJsonTransformResult(nested, seen);
  }
}

function classifyJsonataError(err: unknown): TransformErrorCode {
  const code =
    typeof err === 'object' && err !== null && 'code' in err ? String((err as { code: unknown }).code) : '';
  if (code === 'D1012') return 'TRANSFORM_TIMEOUT';
  if (code === 'D1011') return 'TRANSFORM_STACK_LIMIT';
  if (code === 'D2015') return 'TRANSFORM_SEQUENCE_LIMIT';
  return 'TRANSFORM_EVALUATION_FAILED';
}

export async function transformWorkflowEventBody(
  envelope: WorkflowEventEnvelope,
  transform: ProviderBindingTransform | null
): Promise<TransformBodyResult> {
  const startedAt = Date.now();
  if (transform === null) {
    const body = JSON.stringify(envelope);
    return {
      body,
      outputBytes: new TextEncoder().encode(body).length,
      engine: 'identity',
      durationMs: Date.now() - startedAt,
    };
  }

  const compiled = compileProviderBindingTransform(transform);
  let raw: unknown;
  try {
    raw = await compiled.evaluate(envelope);
  } catch (err) {
    if (isProviderBindingTransformError(err)) throw err;
    throw new ProviderBindingTransformError(classifyJsonataError(err));
  }

  if (raw === null || typeof raw !== 'object') {
    throw new ProviderBindingTransformError('TRANSFORM_RESULT_INVALID');
  }
  assertJsonTransformResult(raw);
  const body = JSON.stringify(raw);
  const outputBytes = new TextEncoder().encode(body).length;
  if (outputBytes > transform.maxOutputBytes) {
    throw new ProviderBindingTransformError('TRANSFORM_OUTPUT_TOO_LARGE');
  }
  return {
    body,
    outputBytes,
    engine: 'jsonata',
    durationMs: Date.now() - startedAt,
  };
}
```

Add `"./events/*": "./src/events/*.ts"` to `packages/core/package.json` `exports`.

- [ ] **Step 4: Run the tests and verify they pass**

Run:

```bash
cd packages/core
bun test src/events/provider-binding-transform.test.ts src/events/workflow-event-envelope.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/events/provider-binding-transform.ts packages/core/src/events/provider-binding-transform.test.ts packages/core/package.json
git commit -m "$(cat <<'EOF'
feat(core): evaluate provider-binding outbound JSON transforms

EOF
)"
```

---

### Task 4: Canonical Envelope Zod Schema

**Files:**

- Modify: `packages/core/src/events/workflow-event-envelope.ts`
- Modify: `packages/core/src/events/workflow-event-envelope.test.ts`

**Interfaces:**

- Consumes: `externalWorkflowEventTypeSchema` and the existing per-event payload schemas.
- Produces: `workflowEventEnvelopeSchema` and `export type WorkflowEventEnvelope = z.infer<typeof workflowEventEnvelopeSchema>`.
- Preserves: `buildWorkflowEventEnvelope()` key insertion order and the current identity `JSON.stringify` bytes.

- [ ] **Step 1: Write the failing envelope schema tests**

Append to `packages/core/src/events/workflow-event-envelope.test.ts`:

```ts
import { workflowEventEnvelopeSchema } from './workflow-event-envelope';

test('workflowEventEnvelopeSchema selects the payload schema from eventType', () => {
  const envelope = buildWorkflowEventEnvelope({
    eventId: 'evt-1',
    eventType: 'workflow.run.started',
    occurredAt: '2026-07-25T00:00:00.000Z',
    run,
    codebase: baseCodebase,
    binding,
    payload: payloads['workflow.run.started'],
  });
  expect(workflowEventEnvelopeSchema.parse(envelope).eventType).toBe('workflow.run.started');
  expect(() =>
    workflowEventEnvelopeSchema.parse({
      ...envelope,
      eventType: 'workflow.run.completed',
    })
  ).toThrow();
});

test('identity serialized body matches the current literal output', () => {
  const envelope = buildWorkflowEventEnvelope({
    eventId: 'evt-identity',
    eventType: 'workflow.run.started',
    occurredAt: '2026-07-25T00:00:00.000Z',
    run,
    codebase: baseCodebase,
    binding,
    payload: payloads['workflow.run.started'],
  });
  expect(JSON.stringify(envelope)).toBe(
    JSON.stringify({
      schemaVersion: 'workflow-event-envelope.v1',
      provider: 'archon',
      eventId: 'evt-identity',
      eventType: 'workflow.run.started',
      occurredAt: '2026-07-25T00:00:00.000Z',
      bindingRef: {
        provider: 'archon',
        name: 'workflow-engine-primary',
        bindingId: 'wpb_archon::workflow_engine_primary',
        projectRef: 'project:cb-1',
      },
      workflowRunRef: {
        provider: 'archon',
        runId: 'run-1',
        workflowName: 'bmad-dev-story',
        projectRef: 'project:cb-1',
      },
      projectRef: {
        id: 'cb-1',
        codebaseRef: 'workflow-engine',
        repositoryPath: '/workspace/workflow-engine',
        defaultBranch: 'dev',
      },
      idempotencyKey: 'archon:workflow-engine-primary:evt-identity',
      payload: { state: 'running', startedAt: '2026-07-25T00:00:00.000Z' },
    })
  );
});
```

- [ ] **Step 2: Run the tests and verify they fail**

Run:

```bash
cd packages/core
bun test src/events/workflow-event-envelope.test.ts
```

Expected: FAIL because `workflowEventEnvelopeSchema` is not exported.

- [ ] **Step 3: Replace the hand-written interface with the Zod schema**

In `packages/core/src/events/workflow-event-envelope.ts`, keep the payload map and builder.
Replace `export interface WorkflowEventEnvelope { ... }` with:

```ts
export const workflowEventEnvelopeSchema = z
  .object({
    schemaVersion: z.literal('workflow-event-envelope.v1'),
    provider: z.string().min(1),
    eventId: z.string().min(1),
    eventType: externalWorkflowEventTypeSchema,
    occurredAt: dateTimeSchema,
    bindingRef: z.object({
      provider: z.string().min(1),
      name: z.string().min(1),
      bindingId: z.string().min(1),
      projectRef: z.string().min(1),
    }),
    workflowRunRef: z.object({
      provider: z.string().min(1),
      runId: z.string().min(1),
      workflowName: z.string().min(1),
      projectRef: z.string().min(1),
    }),
    projectRef: z.object({
      id: z.string().min(1),
      codebaseRef: z.string().min(1),
      repositoryPath: z.string().min(1),
      defaultBranch: z.string().min(1).optional(),
    }),
    idempotencyKey: z.string().min(1),
    payload: z.record(z.string(), z.unknown()),
  })
  .superRefine((value, ctx) => {
    const parsed = workflowEventPayloadSchemas[value.eventType].safeParse(value.payload);
    if (parsed.success) return;
    for (const issue of parsed.error.issues) {
      ctx.addIssue({
        code: 'custom',
        path: ['payload', ...issue.path],
        message: issue.message,
      });
    }
  });

export type WorkflowEventEnvelope = z.infer<typeof workflowEventEnvelopeSchema>;
```

Keep `buildWorkflowEventEnvelope()` returning the same keys in the same insertion order.
Do not construct the builder result through `workflowEventEnvelopeSchema.parse()` if that would change key order.

- [ ] **Step 4: Run the tests and verify they pass**

Run:

```bash
cd packages/core
bun test src/events/workflow-event-envelope.test.ts src/events/provider-binding-transform.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/events/workflow-event-envelope.ts packages/core/src/events/workflow-event-envelope.test.ts
git commit -m "$(cat <<'EOF'
feat(core): derive workflow-event-envelope.v1 from Zod

EOF
)"
```

---

### Task 5: Receiver Header Validation

**Files:**

- Create: `packages/core/src/events/delivery-headers.ts`
- Create: `packages/core/src/events/delivery-headers.test.ts`
- Modify: `packages/core/package.json`

**Interfaces:**

- Consumes: no binding or outbox types.
- Produces:

```ts
export type DeliveryHeaders = Record<string, string>;
export const UNSAFE_DELIVERY_HEADERS = 'unsafe-delivery-headers';
export function normalizeDeliveryHeaders(value: unknown): DeliveryHeaders;
export function validateDeliveryHeaders(headers: DeliveryHeaders): void;
export function mergeDeliveryHeaders(
  archonHeaders: Record<string, string>,
  receiverHeaders: DeliveryHeaders
): Record<string, string>;
export function buildDeliveryHeaderEvidence(
  archonHeaders: Record<string, string>,
  receiverHeaders: DeliveryHeaders
): Record<string, string>;
```

- [ ] **Step 1: Write the failing header tests**

Create `packages/core/src/events/delivery-headers.test.ts`:

```ts
import { describe, expect, test } from 'bun:test';
import {
  buildDeliveryHeaderEvidence,
  mergeDeliveryHeaders,
  normalizeDeliveryHeaders,
  validateDeliveryHeaders,
} from './delivery-headers';

const archonHeaders = {
  'Content-Type': 'application/json',
  'X-Webhook-Signature-V2': 'sig',
  'X-Webhook-Timestamp': '1',
  'X-Request-ID': 'id-1',
};

describe('delivery headers', () => {
  test('accepts a valid private header map', () => {
    expect(normalizeDeliveryHeaders({ Authorization: 'Bearer secret' })).toEqual({
      Authorization: 'Bearer secret',
    });
  });

  test('rejects reserved names without case sensitivity', () => {
    expect(() => validateDeliveryHeaders({ 'content-type': 'text/plain' })).toThrow(
      /unsafe-delivery-headers/
    );
    expect(() => validateDeliveryHeaders({ Host: 'example.com' })).toThrow(
      /unsafe-delivery-headers/
    );
  });

  test('rejects invalid names and CR or LF values', () => {
    expect(() => validateDeliveryHeaders({ 'Bad Name': 'x' })).toThrow(/unsafe-delivery-headers/);
    expect(() => validateDeliveryHeaders({ Authorization: 'Bearer\r\nsecret' })).toThrow(
      /unsafe-delivery-headers/
    );
  });

  test('rejects more than 16 headers and oversize names or values', () => {
    const many: Record<string, string> = {};
    for (let index = 0; index < 17; index += 1) many[`X-H${index}`] = 'v';
    expect(() => validateDeliveryHeaders(many)).toThrow(/unsafe-delivery-headers/);
    expect(() => validateDeliveryHeaders({ ['X'.repeat(129)]: 'v' })).toThrow(
      /unsafe-delivery-headers/
    );
    expect(() => validateDeliveryHeaders({ Authorization: 'x'.repeat(8193) })).toThrow(
      /unsafe-delivery-headers/
    );
  });

  test('merges receiver headers after Archon-owned headers without replacement', () => {
    const merged = mergeDeliveryHeaders(archonHeaders, {
      Authorization: 'Bearer secret',
      'content-type': 'text/plain',
    });
    expect(merged['Content-Type']).toBe('application/json');
    expect(merged.Authorization).toBe('Bearer secret');
  });

  test('redacts receiver values in attempt evidence and keeps Archon values', () => {
    expect(
      buildDeliveryHeaderEvidence(archonHeaders, { Authorization: 'Bearer secret' })
    ).toEqual({
      ...archonHeaders,
      Authorization: '[REDACTED]',
    });
  });
});
```

- [ ] **Step 2: Run the tests and verify they fail**

Run:

```bash
cd packages/core
bun test src/events/delivery-headers.test.ts
```

Expected: FAIL because `./delivery-headers` does not exist.

- [ ] **Step 3: Implement validation, merge, and evidence helpers**

Create `packages/core/src/events/delivery-headers.ts` with these exact rules from the design:

- Header names must match `^[!#$%&'*+.^_`|~0-9A-Za-z-]+$`.
- Names and values must not contain `\r` or `\n`.
- Compare names without case.
- Reject reserved names: `Content-Type`, `X-Webhook-Signature-V2`, `X-Webhook-Timestamp`, `X-Request-ID`, `Host`, `Content-Length`, `Connection`, `Keep-Alive`, `Proxy-Authenticate`, `Proxy-Authorization`, `Proxy-Connection`, `TE`, `Trailer`, `Transfer-Encoding`, `Upgrade`.
- Cap count at 16, name at 128 UTF-8 bytes, value at 8,192 UTF-8 bytes, and all values at 32,768 UTF-8 bytes.
- `normalizeDeliveryHeaders()` parses `z.record(z.string(), z.string())`, then calls `validateDeliveryHeaders()`.
- `mergeDeliveryHeaders()` copies Archon headers first, then adds receiver headers whose lower-case names are not already present.
- `buildDeliveryHeaderEvidence()` copies Archon headers verbatim and sets every receiver name to `[REDACTED]`.
- Throw `new Error('unsafe-delivery-headers')` and never put a header name or value in the error message.

In `packages/core/package.json`, append `&& bun test src/events/delivery-headers.test.ts` to the events test invocation.

- [ ] **Step 4: Run the tests and verify they pass**

Run:

```bash
cd packages/core
bun test src/events/delivery-headers.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/events/delivery-headers.ts packages/core/src/events/delivery-headers.test.ts packages/core/package.json
git commit -m "$(cat <<'EOF'
feat(core): validate private provider-binding delivery headers

EOF
)"
```

---

### Task 6: Additive Binding Columns

**Files:**

- Modify: `migrations/000_combined.sql`
- Modify: `packages/core/src/db/adapters/sqlite.ts`
- Modify: `packages/core/src/db/adapters/sqlite.test.ts`
- Modify: `packages/core/src/db/adapters/postgres.test.ts`
- Modify: `packages/core/src/db/provider-bindings-bundled-schema.test.ts`
- Generate: `packages/core/src/db/bundled-schema.generated.ts`

**Interfaces:**

- Consumes: the existing `remote_agent_workflow_provider_bindings` table.
- Produces: nullable `transform TEXT` and `delivery_headers TEXT NOT NULL DEFAULT '{}'`.

- [ ] **Step 1: Write the failing schema tests**

In `packages/core/src/db/adapters/sqlite.test.ts`, inside `describe('remote_agent_workflow_provider_bindings (Story 3.1)')`, add:

```ts
test('fresh schema has transform and delivery_headers', async () => {
  db = createTestDb();
  const cols = raw_pragma(currentDbPath, 'remote_agent_workflow_provider_bindings');
  expect(cols).toContain('transform');
  expect(cols).toContain('delivery_headers');
});

test('upgrade: adds transform and delivery_headers with empty-object default', async () => {
  const dbPath = join(
    import.meta.dir,
    `.test-sqlite-binding-transform-${Date.now()}-${Math.random().toString(36).slice(2)}.db`
  );
  currentDbPath = dbPath;
  const raw = new Database(dbPath);
  raw.exec(`
    CREATE TABLE remote_agent_workflow_provider_bindings (
      id TEXT PRIMARY KEY,
      provider TEXT NOT NULL,
      name TEXT NOT NULL,
      codebase_id TEXT NOT NULL,
      event_route TEXT NOT NULL,
      event_types TEXT NOT NULL DEFAULT '[]',
      signing_secret TEXT,
      state TEXT NOT NULL DEFAULT 'active',
      binding_version INTEGER NOT NULL DEFAULT 1,
      created_at TEXT,
      updated_at TEXT,
      UNIQUE (provider, name)
    );
    INSERT INTO remote_agent_workflow_provider_bindings
      (id, provider, name, codebase_id, event_route)
    VALUES ('wpb-legacy', 'archon', 'legacy', 'cb-legacy', 'https://hermes.example/events');
  `);
  raw.close();

  db = new SqliteAdapter(dbPath);
  const cols = raw_pragma(dbPath, 'remote_agent_workflow_provider_bindings');
  expect(cols).toContain('transform');
  expect(cols).toContain('delivery_headers');
  const rows = await db.query<{ transform: string | null; delivery_headers: string }>(
    'SELECT transform, delivery_headers FROM remote_agent_workflow_provider_bindings WHERE id = $1',
    ['wpb-legacy']
  );
  expect(rows.rows[0]?.transform).toBeNull();
  expect(rows.rows[0]?.delivery_headers).toBe('{}');
});
```

In the same file, raise `MIN_NON_AUTH_COLUMNS` from `136` to `138`.

In `packages/core/src/db/provider-bindings-bundled-schema.test.ts` and the Postgres outbox marker test, assert these exact SQL fragments:

```ts
expect(sql).toContain('transform        TEXT');
expect(sql).toContain("delivery_headers TEXT NOT NULL DEFAULT '{}'");
expect(sql).toContain(
  'ALTER TABLE remote_agent_workflow_provider_bindings\n  ADD COLUMN IF NOT EXISTS transform TEXT;'
);
expect(sql).toContain(
  "ALTER TABLE remote_agent_workflow_provider_bindings\n  ADD COLUMN IF NOT EXISTS delivery_headers TEXT NOT NULL DEFAULT '{}';"
);
```

- [ ] **Step 2: Run the tests and verify they fail**

Run:

```bash
cd packages/core
bun test src/db/adapters/sqlite.test.ts src/db/adapters/postgres.test.ts src/db/provider-bindings-bundled-schema.test.ts
```

Expected: FAIL because the columns and SQL markers do not exist.

- [ ] **Step 3: Add the columns in both dialects and regenerate the bundled schema**

In `migrations/000_combined.sql`, add the columns to the `CREATE TABLE` body after `signing_secret`:

```sql
  transform        TEXT,
  delivery_headers TEXT NOT NULL DEFAULT '{}',
```

Add these upgrade statements after the existing `event_types` `ALTER TABLE`:

```sql
ALTER TABLE remote_agent_workflow_provider_bindings
  ADD COLUMN IF NOT EXISTS transform TEXT;

ALTER TABLE remote_agent_workflow_provider_bindings
  ADD COLUMN IF NOT EXISTS delivery_headers TEXT NOT NULL DEFAULT '{}';
```

In `packages/core/src/db/adapters/sqlite.ts` `createSchema()`, add the same logical columns and defaults to the binding `CREATE TABLE`.

In `migrateColumns()`, after the `event_types` add, add:

```ts
if (cols.length > 0 && !colNames.has('transform')) {
  this.db.run('ALTER TABLE remote_agent_workflow_provider_bindings ADD COLUMN transform TEXT');
}
if (cols.length > 0 && !colNames.has('delivery_headers')) {
  this.db.run(
    "ALTER TABLE remote_agent_workflow_provider_bindings ADD COLUMN delivery_headers TEXT NOT NULL DEFAULT '{}'"
  );
}
```

From the repository root:

```bash
bun run generate:bundled-schema
```

- [ ] **Step 4: Run the tests and verify they pass**

Run:

```bash
cd packages/core
bun test src/db/adapters/sqlite.test.ts src/db/adapters/postgres.test.ts src/db/provider-bindings-bundled-schema.test.ts
```

Then from the repository root:

```bash
bun run check:bundled-schema
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add migrations/000_combined.sql packages/core/src/db/adapters/sqlite.ts packages/core/src/db/adapters/sqlite.test.ts packages/core/src/db/adapters/postgres.test.ts packages/core/src/db/provider-bindings-bundled-schema.test.ts packages/core/src/db/bundled-schema.generated.ts
git commit -m "$(cat <<'EOF'
feat(core): add provider-binding transform and delivery header columns

EOF
)"
```

---

### Task 7: Binding Persistence Lifecycle

**Files:**

- Modify: `packages/core/src/schemas/workflow-provider-binding.ts`
- Modify: `packages/core/src/schemas/workflow-provider-binding.test.ts`
- Modify: `packages/core/src/db/provider-bindings.ts`
- Modify: `packages/core/src/db/provider-bindings.test.ts`

**Interfaces:**

- Consumes: `normalizeProviderBindingTransform()`, `validateProviderBindingTransform()`, `normalizeDeliveryHeaders()`, and `DeliveryHeaders`.
- Produces:

```ts
export type WorkflowProviderBindingWithSecret = WorkflowProviderBinding & {
  signing_secret?: string | null;
  delivery_headers: DeliveryHeaders;
};

export async function createBinding(input: {
  provider: string;
  name: string;
  codebaseId: string;
  eventRoute: string;
  eventTypes?: readonly ExternalWorkflowEventType[];
  signingSecret?: string | null;
  transform?: ProviderBindingTransform | null;
  deliveryHeaders?: DeliveryHeaders | null;
}): Promise<WorkflowProviderBinding>;

export async function updateBinding(input: {
  provider: string;
  name: string;
  codebaseId: string;
  eventRoute: string;
  eventTypes?: readonly ExternalWorkflowEventType[];
  signingSecret?: string | null;
  transform?: ProviderBindingTransform | null;
  deliveryHeaders?: DeliveryHeaders | null;
}): Promise<WorkflowProviderBinding>;
```

`undefined` preserves a stored column.
`null` clears `transform` to SQL `NULL` and `delivery_headers` to `'{}'`.

- [ ] **Step 1: Write the failing persistence tests**

In `packages/core/src/schemas/workflow-provider-binding.test.ts`, add tests that:

- parse a public row with a normalized `transform` object
- strip both `signing_secret` and `delivery_headers` from the public schema

In `packages/core/src/db/provider-bindings.test.ts`, extend `bindingRow()` so existing rows can include `transform: null` and `delivery_headers: '{}'`.
Add tests that assert:

```ts
test('create stores normalized transform JSON and private receiver header JSON', async () => {
  // insert params contain JSON.stringify(normalizedTransform) and JSON.stringify({ Authorization: 'Bearer secret' })
});

test('public getBinding does not expose receiver header values', async () => {
  mockQuery.mockResolvedValueOnce(
    createQueryResult([
      bindingRow({
        transform: JSON.stringify({
          engine: 'jsonata',
          expression: '{ "ok": true }',
          timeoutMs: 50,
          stackDepth: 128,
          maxSequenceSize: 10000,
          maxOutputBytes: 65536,
        }),
        delivery_headers: JSON.stringify({ Authorization: 'Bearer secret' }),
        signing_secret: 'local-test-value',
      }),
    ], 1)
  );
  const result = await getBinding('archon', 'workflow-engine-primary');
  expect(result?.transform?.engine).toBe('jsonata');
  expect('delivery_headers' in (result ?? {})).toBe(false);
  expect('signing_secret' in (result ?? {})).toBe(false);
});

test('private reads return receiver headers for delivery', async () => {
  const result = await getBindingByIdWithSecret('wpb-1');
  expect(result?.delivery_headers).toEqual({ Authorization: 'Bearer secret' });
});

test('update omission preserves both configurations', async () => {
  await updateBinding({
    provider: 'archon',
    name: 'workflow-engine-primary',
    codebaseId: 'cb-1',
    eventRoute: 'https://hermes.example/events/v2',
  });
  const [, params] = mockQuery.mock.calls[1] as [string, unknown[]];
  expect(params).toContain(0); // transform_supplied
  expect(params).toContain(0); // delivery_headers_supplied
});

test('update with null clears the selected configuration', async () => {
  await updateBinding({
    provider: 'archon',
    name: 'workflow-engine-primary',
    codebaseId: 'cb-1',
    eventRoute: 'https://hermes.example/events/v2',
    transform: null,
    deliveryHeaders: null,
  });
  const [sql, params] = mockQuery.mock.calls[1] as [string, unknown[]];
  expect(sql).toContain('CASE WHEN');
  expect(params).toContain(null); // cleared transform
  expect(params).toContain('{}'); // cleared headers
});

test('invalid transform or header fails before a database mutation', async () => {
  await expect(
    createBinding({
      provider: 'archon',
      name: 'workflow-engine-primary',
      codebaseId: 'cb-1',
      eventRoute: 'https://hermes.example/events',
      transform: normalizeProviderBindingTransform({
        engine: 'jsonata',
        expression: '$now()',
      }),
    })
  ).rejects.toThrow(/TRANSFORM_FUNCTION_DISALLOWED/);
  expect(mockQuery).not.toHaveBeenCalled();
});

test('rotate and disable SQL do not write transform or delivery_headers', async () => {
  await rotateBinding('archon', 'workflow-engine-primary', 'rotated-secret');
  await disableBinding('archon', 'workflow-engine-primary');
  const sql = mockQuery.mock.calls.map(call => (call as [string, unknown[]])[0]).join('\n');
  expect(sql).not.toMatch(/SET[\s\S]*transform\s*=/);
  expect(sql).not.toMatch(/SET[\s\S]*delivery_headers\s*=/);
});

test('corrupt JSON produces a classified binding corruption error without raw values', async () => {
  mockQuery.mockResolvedValueOnce(
    createQueryResult([bindingRow({ transform: '{not-json', delivery_headers: '{not-json' })], 1)
  );
  await expect(getBinding('archon', 'workflow-engine-primary')).rejects.toThrow(/BINDING_CORRUPT_ROW/);
  await expect(getBinding('archon', 'workflow-engine-primary')).rejects.not.toThrow(/not-json/);
});
```

- [ ] **Step 2: Run the tests and verify they fail**

Run:

```bash
cd packages/core
bun test src/schemas/workflow-provider-binding.test.ts src/db/provider-bindings.test.ts
```

Expected: FAIL because the public schema and persistence layer do not yet know the new fields.

- [ ] **Step 3: Persist and project the new columns**

Add optional public `transform` to `workflowProviderBindingSchema`:

```ts
transform: providerBindingTransformSchema.nullable().optional(),
```

In `provider-bindings.ts`:

- Extend the private schema with `signing_secret` and `delivery_headers: z.record(z.string(), z.string())`.
- Parse `transform` and `delivery_headers` JSON text in `normalizeBindingRow()`.
- On JSON parse failure, throw `new Error('BINDING_CORRUPT_ROW: transform')` or `new Error('BINDING_CORRUPT_ROW: delivery_headers')` without the raw text.
- Default missing `delivery_headers` to `{}` after a successful parse.
- Before `createBinding()` or `updateBinding()` opens a transaction, if a transform object is supplied call `validateProviderBindingTransform()`, and if headers are supplied call `normalizeDeliveryHeaders()`.
- Insert `transform` and `delivery_headers` in `createBinding()`.
- Omitted create values store SQL `NULL` and `'{}'`.
- Replace only the new-column assignments in `updateBinding()` with the design's `CASE WHEN transform_supplied = 1` / `delivery_headers_supplied = 1` SQL.
- Keep the existing `COALESCE` behavior for `event_types` and `signing_secret`.
- Leave rotate and disable SQL unchanged so those columns are preserved without a read/rewrite.

- [ ] **Step 4: Run the tests and verify they pass**

Run:

```bash
cd packages/core
bun test src/schemas/workflow-provider-binding.test.ts src/db/provider-bindings.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/schemas/workflow-provider-binding.ts packages/core/src/schemas/workflow-provider-binding.test.ts packages/core/src/db/provider-bindings.ts packages/core/src/db/provider-bindings.test.ts
git commit -m "$(cat <<'EOF'
feat(core): persist provider-binding transforms and private headers

EOF
)"
```

---

### Task 8: Enqueue-Time Transform And Transform-Failed Evidence

**Files:**

- Modify: `packages/core/src/workflows/store-adapter.ts`
- Modify: `packages/core/src/workflows/store-adapter.test.ts`

**Interfaces:**

- Consumes: `buildWorkflowEventEnvelope()`, `transformWorkflowEventBody()`, `isProviderBindingTransformError()`, and `resolution.binding.transform`.
- Produces: a pending outbox row whose `event_body` is the exact transformed string, or a `not-routable` row with `not_routable_reason = "transform-failed"`.

- [ ] **Step 1: Write the failing enqueue tests**

In `packages/core/src/workflows/store-adapter.test.ts`, add tests that use the existing `bindingRow()` helper plus an optional `transform` object.

```ts
test('enqueueExternalWorkflowEvent persists the exact current body when the binding has no transform', async () => {
  // existing routable fixture
  const [insert] = mockEnqueueExternalWorkflowEvent.mock.calls[0] as [Record<string, unknown>];
  const envelope = JSON.parse(insert.event_body as string);
  expect(insert.event_body).toBe(JSON.stringify(envelope));
});

test('enqueueExternalWorkflowEvent evaluates a transform once and persists the exact string', async () => {
  mockResolveEventRoute.mockResolvedValueOnce({
    routable: true,
    codebase: codebaseRow(),
    binding: bindingRow({
      transform: {
        engine: 'jsonata',
        expression: '{ "eventType": eventType }',
        timeoutMs: 50,
        stackDepth: 128,
        maxSequenceSize: 10000,
        maxOutputBytes: 65536,
      },
    }),
    route: 'https://hermes.example/events',
    secret: 'test-secret',
  });
  // enqueue workflow.run.completed
  const [insert] = mockEnqueueExternalWorkflowEvent.mock.calls[0] as [Record<string, unknown>];
  expect(insert.event_body).toBe('{"eventType":"workflow.run.completed"}');
  expect(insert.status).toBe('pending');
});

test('enqueueExternalWorkflowEvent filters events before transformation', async () => {
  mockResolveEventRoute.mockResolvedValueOnce({
    routable: true,
    codebase: codebaseRow(),
    binding: bindingRow({
      event_types: ['workflow.approval.requested'],
      transform: {
        engine: 'jsonata',
        expression: '$now()',
        timeoutMs: 50,
        stackDepth: 128,
        maxSequenceSize: 10000,
        maxOutputBytes: 65536,
      },
    }),
    route: 'https://hermes.example/events',
    secret: 'test-secret',
  });
  await store.enqueueExternalWorkflowEvent({
    workflow_run_id: 'run-1',
    event_type: 'workflow.run.started',
    occurred_at: '2026-08-18T00:00:00.000Z',
    payload: { state: 'running', startedAt: '2026-08-18T00:00:00.000Z' },
  });
  expect(mockEnqueueExternalWorkflowEvent).not.toHaveBeenCalled();
});

test('enqueueExternalWorkflowEvent records transform-failed evidence without rejecting the workflow', async () => {
  mockResolveEventRoute.mockResolvedValueOnce({
    routable: true,
    codebase: codebaseRow(),
    binding: bindingRow({
      transform: {
        engine: 'jsonata',
        expression: 'eventType',
        timeoutMs: 50,
        stackDepth: 128,
        maxSequenceSize: 10000,
        maxOutputBytes: 65536,
      },
    }),
    route: 'https://hermes.example/events',
    secret: 'test-secret',
  });
  await expect(
    store.enqueueExternalWorkflowEvent({
      workflow_run_id: 'run-1',
      event_type: 'workflow.run.started',
      occurred_at: '2026-08-18T00:00:00.000Z',
      payload: { state: 'running', startedAt: '2026-08-18T00:00:00.000Z' },
    })
  ).resolves.toBeUndefined();
  const [insert] = mockEnqueueExternalWorkflowEvent.mock.calls[0] as [Record<string, unknown>];
  expect(insert).toMatchObject({
    status: 'not-routable',
    not_routable_reason: 'transform-failed',
    last_error: 'TRANSFORM_RESULT_INVALID',
    next_attempt_at: null,
  });
  const body = JSON.parse(insert.event_body as string) as { schemaVersion: string; eventType: string };
  expect(body.schemaVersion).toBe('workflow-event-envelope.v1');
  expect(body.eventType).toBe('workflow.run.started');
});
```

Add a logger spy test that the transform failure log object contains only `bindingId`, `eventType`, `engine`, `durationMs`, and `errorCode`, and that it does not contain `err`, the expression, or the envelope.

- [ ] **Step 2: Run the tests and verify they fail**

Run:

```bash
cd packages/core
bun test src/workflows/store-adapter.test.ts
```

Expected: FAIL because enqueue still always does `JSON.stringify(envelope)` and has no `transform-failed` path.

- [ ] **Step 3: Transform once after envelope construction**

In `enqueueExternalWorkflowEvent()`, after the existing event-type filter and `buildWorkflowEventEnvelope()` call, replace the pending insert body with:

```ts
const transformStartedAt = Date.now();
try {
  const transformed = await transformWorkflowEventBody(envelope, resolution.binding.transform ?? null);
  getLog().debug(
    {
      bindingId: resolution.binding.id,
      eventType: envelope.eventType,
      engine: transformed.engine,
      durationMs: transformed.durationMs,
      outputBytes: transformed.outputBytes,
    },
    'workflow_event_outbox_transform_completed'
  );
  await workflowEventOutboxDb.enqueueExternalWorkflowEvent({
    event_id: envelope.eventId,
    idempotency_key: envelope.idempotencyKey,
    event_type: envelope.eventType,
    workflow_run_id: run.id,
    codebase_id: resolution.codebase.id,
    binding_id: resolution.binding.id,
    event_route: resolution.route,
    event_body: transformed.body,
    status: 'pending',
    next_attempt_at: input.occurred_at,
  });
} catch (err) {
  if (!isProviderBindingTransformError(err)) throw err;
  getLog().warn(
    {
      bindingId: resolution.binding.id,
      eventType: envelope.eventType,
      engine: resolution.binding.transform?.engine ?? 'identity',
      durationMs: Date.now() - transformStartedAt,
      errorCode: err.code,
    },
    'workflow_event_outbox_transform_failed'
  );
  await workflowEventOutboxDb.enqueueExternalWorkflowEvent({
    event_id: envelope.eventId,
    idempotency_key: envelope.idempotencyKey,
    event_type: envelope.eventType,
    workflow_run_id: run.id,
    codebase_id: resolution.codebase.id,
    binding_id: resolution.binding.id,
    event_body: JSON.stringify(envelope),
    status: 'not-routable',
    not_routable_reason: 'transform-failed',
    last_error: err.code,
    next_attempt_at: null,
  });
}
```

If `transformWorkflowEventBody()` throws after some duration, include that duration when the result exists.
On classified failure before a result is returned, omit `outputBytes` and do not attach `err`.
Leave the outer best-effort `catch` in place so unexpected throws still cannot fail the workflow.

- [ ] **Step 4: Run the tests and verify they pass**

Run:

```bash
cd packages/core
bun test src/workflows/store-adapter.test.ts src/events/workflow-event-envelope.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/workflows/store-adapter.ts packages/core/src/workflows/store-adapter.test.ts
git commit -m "$(cat <<'EOF'
feat(core): transform workflow events once before outbox persist

EOF
)"
```

---

### Task 9: Dispatcher Header Merge, Redaction, And Stored-Body HMAC

**Files:**

- Modify: `packages/server/src/workflow-events/dispatcher.ts`
- Modify: `packages/server/src/workflow-events/dispatcher.test.ts`

**Interfaces:**

- Consumes: `getBindingByIdWithSecret()`, `validateDeliveryHeaders()`, `mergeDeliveryHeaders()`, `buildDeliveryHeaderEvidence()`, and `row.event_body`.
- Produces: HTTP headers that include validated receiver headers, attempt evidence with `[REDACTED]` receiver values, and `last_error = "unsafe-delivery-headers"` when stored headers are corrupt.

- [ ] **Step 1: Write the failing dispatcher tests**

In `packages/server/src/workflow-events/dispatcher.test.ts`, keep the existing stored-body HMAC test and add:

```ts
test('HMAC uses the stored transformed body and retries send the same bytes', async () => {
  const body = '{"eventType":"workflow.run.completed"}';
  const row = outboxRow({ event_body: body });
  mockClaimDueOutboxEvents.mockResolvedValueOnce([row]);
  const fetchImpl = mock(async () => new Response('', { status: 204 }));
  const dispatcher = new WorkflowEventDispatcher({
    now: () => fixedNow,
    fetchImpl,
    enqueueDeliveryFailed: mockStoreEnqueueExternalWorkflowEvent,
  });
  await dispatcher.drainNow();
  const [, request] = fetchImpl.mock.calls[0] as [string, RequestInit];
  expect(request.body).toBe(body);
  const headers = request.headers as Record<string, string>;
  const expectedSignature = createHmac('sha256', 'test-secret')
    .update(`${Math.floor(fixedNow.getTime() / 1000)}.${body}`)
    .digest('hex');
  expect(headers['X-Webhook-Signature-V2']).toBe(expectedSignature);
});

test('valid receiver headers reach HTTP and are redacted in attempt evidence', async () => {
  mockGetBindingByIdWithSecret.mockResolvedValueOnce({
    signing_secret: 'test-secret',
    delivery_headers: { Authorization: 'Bearer secret' },
  });
  mockClaimDueOutboxEvents.mockResolvedValueOnce([outboxRow()]);
  const fetchImpl = mock(async () => new Response('', { status: 204 }));
  const dispatcher = new WorkflowEventDispatcher({
    now: () => fixedNow,
    fetchImpl,
    enqueueDeliveryFailed: mockStoreEnqueueExternalWorkflowEvent,
  });
  await dispatcher.drainNow();
  const [, request] = fetchImpl.mock.calls[0] as [string, RequestInit];
  expect((request.headers as Record<string, string>).Authorization).toBe('Bearer secret');
  const attemptHeaders = (mockInsertPendingAttempt.mock.calls[0] as [string, number, { headers: Record<string, string> }])[2]
    .headers;
  expect(attemptHeaders.Authorization).toBe('[REDACTED]');
  expect(attemptHeaders['Content-Type']).toBe('application/json');
});

test('corrupt stored headers prevent HTTP and mark terminal-failure', async () => {
  mockGetBindingByIdWithSecret.mockResolvedValueOnce({
    signing_secret: 'test-secret',
    delivery_headers: { 'Content-Type': 'text/plain' },
  });
  mockClaimDueOutboxEvents.mockResolvedValueOnce([outboxRow()]);
  const fetchImpl = mock(async () => new Response('', { status: 204 }));
  const dispatcher = new WorkflowEventDispatcher({ now: () => fixedNow, fetchImpl });
  await dispatcher.drainNow();
  expect(fetchImpl).not.toHaveBeenCalled();
  expect(mockInsertPendingAttempt).not.toHaveBeenCalled();
  expect(mockUpdateOutboxAfterAttempt.mock.calls[0]?.[1]).toMatchObject({
    status: 'terminal-failure',
    last_error: 'unsafe-delivery-headers',
    next_attempt_at: null,
  });
});
```

Add an assertion that the unsafe-header log object contains `bindingId` and `outboxEventId` and does not contain `Authorization`, `Bearer`, or `secret`.

- [ ] **Step 2: Run the tests and verify they fail**

Run:

```bash
cd packages/server
bun test src/workflow-events/dispatcher.test.ts
```

Expected: FAIL because the dispatcher never reads `delivery_headers`.

- [ ] **Step 3: Merge headers after HMAC headers and persist evidence separately**

In `WorkflowEventDispatcher.deliver()`:

1. Keep the current missing-route and missing-secret terminal-failure paths.
2. After the secret check, read `binding.delivery_headers ?? {}`.
3. Call `validateDeliveryHeaders()`.
4. On failure, log `{ bindingId: row.binding_id, outboxEventId: row.id }` as `workflow_events.unsafe_delivery_headers` and set `terminal-failure` / `unsafe-delivery-headers` without calling `fetch` or `insertPendingAttempt`.
5. Build the current Archon header map first.
6. Create `requestHeaders = mergeDeliveryHeaders(archonHeaders, receiverHeaders)`.
7. Create `evidenceHeaders = buildDeliveryHeaderEvidence(archonHeaders, receiverHeaders)`.
8. Sign `row.event_body` exactly as today.
9. Pass `evidenceHeaders` to `insertPendingAttempt`.
10. POST `row.event_body` with `requestHeaders`.

Do not parse or reserialize `row.event_body`.

- [ ] **Step 4: Run the tests and verify they pass**

Run:

```bash
cd packages/server
bun test src/workflow-events/
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/workflow-events/dispatcher.ts packages/server/src/workflow-events/dispatcher.test.ts
git commit -m "$(cat <<'EOF'
feat(server): merge private delivery headers without exposing secrets

EOF
)"
```

---

### Task 10: CLI Create And Update File Flags

**Files:**

- Modify: `packages/cli/src/cli.ts`
- Modify: `packages/cli/src/commands/provider-binding.ts`
- Modify: `packages/cli/src/commands/provider-binding.test.ts`
- Modify: `packages/cli/src/commands/provider-binding.e2e.test.ts`

**Interfaces:**

- Consumes: `--transform-file` and `--receiver-headers-file` JSON files.
- Produces: `BindingArgs.transformFile?: string`, `BindingArgs.receiverHeadersFile?: string`, and create/update calls that pass `transform` / `deliveryHeaders` as `undefined` or `null` or a parsed object.

- [ ] **Step 1: Write the failing CLI tests**

In `packages/cli/src/commands/provider-binding.test.ts`, add tests that write temp JSON files and call the command functions with `transformFile` / `receiverHeadersFile`.

Required cases:

- create with a valid transform file and a valid headers file calls `createBinding()` with the normalized object and header map
- omitted update flags call `updateBinding()` without `transform` or `deliveryHeaders`
- a file containing JSON `null` calls `updateBinding()` with `transform: null` or `deliveryHeaders: null`
- invalid transform JSON or `$now()` fails before `createBinding` / `updateBinding`
- the error envelope does not contain the file path, the expression, or `Bearer secret`

In `packages/cli/src/commands/provider-binding.e2e.test.ts`, add a no-git-repo test that `--transform-file` and `--receiver-headers-file` parse as string options and that a missing value does not swallow `--json`.

- [ ] **Step 2: Run the tests and verify they fail**

Run:

```bash
cd packages/cli
bun test src/commands/provider-binding.test.ts src/commands/provider-binding.e2e.test.ts
```

Expected: FAIL because the flags and file readers do not exist.

- [ ] **Step 3: Parse the file flags and apply create/update semantics**

In `packages/cli/src/cli.ts`:

- Add `--transform-file` and `--receiver-headers-file` to `normalizeProviderBindingArgs()` and `parseArgs()`.
- Pass both values into `bindingArgs`.
- Keep `provider-binding` in `noGitCommands`.

In `packages/cli/src/commands/provider-binding.ts`:

- Extend `BindingArgs` with the two optional file paths.
- Read files only when the flag is present.
- Parse JSON and treat JSON `null` as a supplied clear.
- On create, omitted or JSON `null` becomes `undefined` so the db layer stores no configuration.
- On update, omitted stays `undefined` and JSON `null` becomes `null`.
- Classify unread or invalid JSON as `MALFORMED_REQUEST` with `fieldErrors` `{ path: '/transform', code: 'unreadable' | 'invalid' }` or `{ path: '/deliveryHeaders', code: 'unreadable' | 'invalid' }`.
- Do not put the path, expression, or header values in `details`.
- Call `createBinding()` / `updateBinding()` only after both files parse.
- Leave status, rotate, and disable output shapes unchanged.

- [ ] **Step 4: Run the tests and verify they pass**

Run:

```bash
cd packages/cli
bun test src/commands/provider-binding.test.ts src/commands/provider-binding.e2e.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/cli.ts packages/cli/src/commands/provider-binding.ts packages/cli/src/commands/provider-binding.test.ts packages/cli/src/commands/provider-binding.e2e.test.ts
git commit -m "$(cat <<'EOF'
feat(cli): accept provider-binding transform and header files

EOF
)"
```

---

### Task 11: Dry-Run Command, Contract, And Docs

**Files:**

- Create: `packages/cli/src/commands/provider-binding-test.ts`
- Create: `_bmad-output/planning-artifacts/contracts/workflow-commander/examples/providers/archon/commands/binding-test-success.json`
- Modify: `packages/cli/src/cli.ts`
- Modify: `packages/cli/src/commands/workflow-provider-command-envelope.ts`
- Modify: `packages/cli/src/commands/workflow-provider-command-envelope.test.ts`
- Modify: `packages/cli/src/commands/provider-binding.test.ts`
- Modify: `packages/cli/src/commands/provider-binding.e2e.test.ts`
- Modify: `_bmad-output/planning-artifacts/contracts/workflow-commander/schemas/workflow-command-envelope.schema.json`
- Modify: `_bmad-output/planning-artifacts/contracts/workflow-commander/validate_contracts.py`
- Modify: `packages/docs-web/src/content/docs/reference/cli.md`

**Interfaces:**

- Consumes: `--transform-file`, `--envelope-file`, `normalizeProviderBindingTransform()`, `workflowEventEnvelopeSchema`, and `transformWorkflowEventBody()`.
- Produces: command identifier `binding.test` and result `{ operation: "test", engine: "jsonata", transformedBody: string, outputBytes: number }`.

- [ ] **Step 1: Write the failing dry-run and contract tests**

Add `binding.test` to `PROVIDER_CLI_SYNTAX_BASELINE` as:

```ts
'binding.test':
  'archon provider-binding test --transform-file <path> --envelope-file <path> --json',
```

Change the schema-enum length assertion from `12` to `13`.

Create `binding-test-success.json`:

```json
{
  "schemaVersion": "workflow-command-envelope.v1",
  "intendedProducer": "Archon",
  "intendedConsumer": "Hermes",
  "owningSubproject": "archon",
  "provider": "archon",
  "command": "binding.test",
  "correlationId": "corr_binding_test_success",
  "issuedAt": "2026-08-18T00:00:00.000Z",
  "success": true,
  "bindingRef": {
    "provider": "archon",
    "name": "workflow-engine-primary",
    "bindingId": "wpb_archon::workflow_engine_primary",
    "projectRef": "project:cb-1"
  },
  "result": {
    "operation": "test",
    "engine": "jsonata",
    "transformedBody": "{\"eventType\":\"workflow.run.started\"}",
    "outputBytes": 36
  }
}
```

Add `binding-test-success.json` to `REQUIRED_COMMAND_EXAMPLES` in `validate_contracts.py`.

Add command-unit tests that:

- accept a valid transform file and envelope file and return the exact transformed string and UTF-8 byte length
- use `binding.test` and the sample envelope `bindingRef`
- reject a null transform file, an invalid envelope, and a scalar transform result with a stable transform error code
- do not import or call `createBinding`, `enqueueExternalWorkflowEvent`, or `fetch`
- do not contain the file path, expression, or envelope dump in the error envelope

Add an e2e test in a temp directory that is not a git repo:

```bash
bun packages/cli/src/cli.ts provider-binding test --transform-file ... --envelope-file ... --json
```

Add a source test that `packages/cli/src/commands/provider-binding-test.ts` does not contain `@archon/core/db`.

- [ ] **Step 2: Run the tests and verify they fail**

Run:

```bash
cd packages/cli
bun test src/commands/workflow-provider-command-envelope.test.ts src/commands/provider-binding.test.ts src/commands/provider-binding.e2e.test.ts src/commands/provider-binding-contract.test.ts
```

Expected: FAIL because `binding.test` is absent from the command enum and there is no dry-run command.

- [ ] **Step 3: Implement the dry-run command and document it**

Add `'binding.test'` to `WORKFLOW_PROVIDER_COMMANDS` and `BINDING_COMMANDS`.

Add `'binding.test'` to both command enums in `workflow-command-envelope.schema.json`.

Create `packages/cli/src/commands/provider-binding-test.ts` that:

- requires `--transform-file` and `--envelope-file`
- reads and parses JSON without logging the path
- rejects JSON `null` for the transform file
- parses the transform with `normalizeProviderBindingTransform()`
- parses the envelope with `workflowEventEnvelopeSchema`
- calls `transformWorkflowEventBody(envelope, transform)`
- emits a success envelope whose `bindingRef` comes from the sample envelope
- maps `ProviderBindingTransformError.code` into the existing error-envelope `error.code`
- also maps a plain `Error` whose message is a `TRANSFORM_*` code, because `normalizeProviderBindingTransform()` throws that message before the evaluator runs
- uses category `timeout` only for `TRANSFORM_TIMEOUT` and `provider_contract` for the other transform codes

In `packages/cli/src/cli.ts`:

- add `--envelope-file` to the string-option set
- dispatch `case 'test'` to `providerBindingTestCommand`
- add `test` to the human-readable available-subcommand list
- add a `provider-binding` section to `printUsage()`

In `packages/docs-web/src/content/docs/reference/cli.md`, add a `provider-binding` section after `validate commands` that documents:

- `create` / `update` `--transform-file` and `--receiver-headers-file`
- omitted update flags preserve configuration
- JSON `null` clears transform to SQL `NULL` and headers to `{}`
- `archon provider-binding test --transform-file <path> --envelope-file <path> --json`
- defaults and hard caps from the design table
- the allowed function list and rejected constructs
- transform-failed outbox evidence
- private receiver headers, the reserved-name list, and that HMAC headers stay active
- the POSIX `0600` temporary-file pattern and that the file should be removed after success
- a generic JSONata example that uses only canonical envelope fields, such as `{ "eventType": eventType, "runId": workflowRunRef.runId }`

Do not document a receiver-specific body schema.

Keep every new documentation sentence on its own physical line.

- [ ] **Step 4: Run the tests and the full validation suite**

Run:

```bash
cd packages/cli
bun test src/commands/workflow-provider-command-envelope.test.ts src/commands/provider-binding.test.ts src/commands/provider-binding.e2e.test.ts src/commands/provider-binding-contract.test.ts
```

```bash
cd packages/core
bun test src/schemas/provider-binding-transform.test.ts src/schemas/workflow-provider-binding.test.ts src/events/provider-binding-transform.test.ts src/events/delivery-headers.test.ts src/events/workflow-event-envelope.test.ts src/db/provider-bindings.test.ts src/db/adapters/sqlite.test.ts src/db/provider-bindings-bundled-schema.test.ts src/workflows/store-adapter.test.ts
```

```bash
cd packages/server
bun test src/workflow-events/dispatcher.test.ts
```

From the repository root:

```bash
bun run validate
```

Expected: every command exits 0.

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/cli.ts packages/cli/src/commands/provider-binding-test.ts packages/cli/src/commands/workflow-provider-command-envelope.ts packages/cli/src/commands/workflow-provider-command-envelope.test.ts packages/cli/src/commands/provider-binding.test.ts packages/cli/src/commands/provider-binding.e2e.test.ts _bmad-output/planning-artifacts/contracts/workflow-commander/schemas/workflow-command-envelope.schema.json _bmad-output/planning-artifacts/contracts/workflow-commander/validate_contracts.py _bmad-output/planning-artifacts/contracts/workflow-commander/examples/providers/archon/commands/binding-test-success.json packages/docs-web/src/content/docs/reference/cli.md
git commit -m "$(cat <<'EOF'
feat(cli): add provider-binding transform dry-run command

EOF
)"
```

---

## Acceptance Criteria

- [ ] A binding with no transform persists `JSON.stringify(canonicalEnvelope)` and the dispatcher HMAC-signs that exact string.
- [ ] A valid JSONata transform is compiled and AST-checked before create or update writes.
- [ ] Enqueue evaluates the transform once against the canonical envelope and persists the exact returned string as `event_body`.
- [ ] Event-type filtering still happens before envelope construction and produces no outbox row.
- [ ] A transform error persists `not-routable` / `transform-failed` with a safe error code and the canonical envelope body, and it does not fail the workflow run.
- [ ] Invalid or reserved receiver headers are rejected on write and, if stored data is corrupt, block HTTP with `unsafe-delivery-headers`.
- [ ] Public binding reads, status output, command errors, logs, and delivery-attempt evidence never contain receiver header values.
- [ ] Update omission preserves transform and headers; JSON `null` files clear the selected configuration.
- [ ] Rotate and disable preserve both configurations without rewriting them.
- [ ] `archon provider-binding test` works outside a git repo, does not open the database, and returns the exact transformed string plus UTF-8 byte length.
- [ ] SQLite fresh and upgrade paths, PostgreSQL additive SQL, dialect parity, and `bun run check:bundled-schema` all pass.
- [ ] Existing binding command identifiers and envelopes remain valid, with `binding.test` added additively.

## Validation Commands

```bash
bun add jsonata@2.2.2 --filter @archon/core
bun run generate:bundled-schema
bun run check:bundled-schema
```

```bash
cd packages/core
bun test src/schemas/provider-binding-transform.test.ts src/schemas/workflow-provider-binding.test.ts src/events/provider-binding-transform.test.ts src/events/delivery-headers.test.ts src/events/workflow-event-envelope.test.ts src/db/provider-bindings.test.ts src/db/adapters/sqlite.test.ts src/db/adapters/postgres.test.ts src/db/provider-bindings-bundled-schema.test.ts src/workflows/store-adapter.test.ts
```

```bash
cd packages/server
bun test src/workflow-events/dispatcher.test.ts
```

```bash
cd packages/cli
bun test src/commands/provider-binding.test.ts src/commands/provider-binding.e2e.test.ts src/commands/provider-binding-contract.test.ts src/commands/workflow-provider-command-envelope.test.ts
```

```bash
bun run validate
```

## Open Questions

There are no remaining product decisions in the approved design.

Implementation defaults already chosen above, and not open for reinterpretation during execution:

- Reject both JSONata AST types `regex` and `regexp`.
- Keep the dry-run command in a DB-free CLI module.
- Export `@archon/core/events/*` instead of adding a plugin registry.
- Map CLI transform failures to `provider_contract` except `TRANSFORM_TIMEOUT`.
