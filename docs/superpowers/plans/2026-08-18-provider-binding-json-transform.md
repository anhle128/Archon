# Provider-Binding Outbound JSON Transform Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.
> Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an optional per-binding JSONata outbound transform and private receiver headers so Archon persists receiver-shaped JSON exactly once and delivers it without changing `workflow-event-envelope.v1` or exposing secrets.

**Architecture:** Keep the canonical workflow event envelope as the only transform input.
Normalize and AST-validate JSONata before binding writes, evaluate once after envelope construction, and persist the exact serialized result in the outbox.
Store private receiver headers separately from the public transform, validate them at write and send time, merge them after Archon-owned HMAC headers, and persist only redacted request-header evidence.

**Tech Stack:** Bun, strict TypeScript, Zod from `@hono/zod-openapi`, `jsonata@2.2.2`, SQLite, PostgreSQL, Bun Test, and the existing workflow-command JSON contract validator.

**Spec:** `docs/superpowers/specs/2026-08-18-provider-binding-json-transform-design.md`

## Global Constraints

- Use the approved design as the source of truth.
- Do not add receiver-specific fields, receiver-specific schemas, routing rules, a transform registry, a second engine, XML, form encoding, a web UI, or delivery-time transformation.
- Keep `workflow-event-envelope.v1` unchanged at runtime, including the builder's top-level key insertion order.
- Add exactly `jsonata@2.2.2` to `@archon/core` with Bun and commit the resulting root `bun.lock` change.
- Store normalized transform JSON in nullable `transform` and private receiver-header JSON in `delivery_headers TEXT NOT NULL DEFAULT '{}'`.
- Validate and normalize supplied transform and header values before `createBinding()` or `updateBinding()` starts a transaction.
- Preserve omitted update values and use a JSON `null` file to clear the selected value.
- Apply a transform once at enqueue time and never at delivery time.
- Persist the exact string returned by `transformWorkflowEventBody()` as `event_body`.
- Keep HMAC input exactly `timestamp + "." + row.event_body` and never parse, rebuild, or reserialize `row.event_body` in the dispatcher.
- Persist classified transform failures as `status = "not-routable"`, `not_routable_reason = "transform-failed"`, `last_error = <safe transform code>`, `event_body = JSON.stringify(canonicalEnvelope)`, and `next_attempt_at = null`.
- Keep workflow execution non-throwing when transformation or outbox persistence fails.
- Keep receiver header values out of public binding projections, CLI output, logs, errors, artifacts, and delivery-attempt evidence.
- Use file flags for transform, sample-envelope, and receiver-header JSON.
- Never echo an input file path or file content in a success or error envelope.
- Keep database changes additive in both dialects.
- Include a `DEFAULT` on every new `ADD COLUMN ... NOT NULL` statement.
- Generate `packages/core/src/db/bundled-schema.generated.ts` only with `bun run generate:bundled-schema`.
- Derive data-shape types with `z.infer<typeof schema>`.
- Import `z` from `@hono/zod-openapi` in core schema code.
- Use `z.record(z.string(), valueSchema)` for record schemas.
- Do not add `any`.
- Traverse JSONata AST values as `Record<string, unknown>` and arrays instead of using the incomplete `ExprNode` fields typed as `any`.
- Reject both JSONata AST types `regex` and `regexp`.
- Pass `{ timeout: timeoutMs, stack: stackDepth, sequence: maxSequenceSize }` to JSONata 2.2.2.
- Classify JSONata `D1012` as `TRANSFORM_TIMEOUT`, `D1011` as `TRANSFORM_STACK_LIMIT`, and `D2015` as `TRANSFORM_SEQUENCE_LIMIT`.
- Put the side-effect-free command in `packages/cli/src/commands/provider-binding-test.ts` and do not import `@archon/core/db/*` from that file.
- Export the core event modules through `"./events/*": "./src/events/*.ts"`.
- Map `TRANSFORM_TIMEOUT` to CLI category `timeout` and exit code `69`.
- Map every other `TRANSFORM_*` code to CLI category `provider_contract` and exit code `64`.
- Mark transform failures non-retryable because the same input and limits will deterministically fail again.
- Map unreadable or non-JSON input files and invalid canonical envelopes to `MALFORMED_REQUEST` with safe field errors.
- Do not change workflow event-type filtering or Archon's HMAC header names or format.
- Never run `bun test` from the repository root.
- Run mock-heavy Bun test files in separate invocations to avoid `mock.module()` cache pollution.
- Keep every full Markdown sentence on its own physical line.
- Never add an agent name as a commit co-author.

## File Map

- Create `packages/core/src/schemas/provider-binding-transform.ts` for the discriminated transform schemas and derived type.
- Create `packages/core/src/schemas/provider-binding-transform.test.ts` for schema defaults and numeric bounds.
- Create `packages/core/src/events/provider-binding-transform.ts` for normalization, safe errors, JSONata compilation, AST policy, evaluation, result validation, and serialization.
- Create `packages/core/src/events/provider-binding-transform.test.ts` for byte limits, AST policy, evaluator guardrails, result rules, and identity behavior.
- Create `packages/core/src/events/delivery-headers.ts` for the private header schema, safe validation, merge, and redacted evidence.
- Create `packages/core/src/events/delivery-headers.test.ts` for token grammar, limits, reserved names, and privacy behavior.
- Create `packages/cli/src/commands/provider-binding-test.ts` for the side-effect-free `binding.test` command.
- Create `packages/cli/src/commands/provider-binding-test.test.ts` for dry-run unit, error, privacy, and dependency-boundary tests.
- Create `_bmad-output/planning-artifacts/contracts/workflow-commander/examples/providers/archon/commands/binding-test-success.json` for the additive command fixture.
- Modify `packages/core/package.json` for `jsonata@2.2.2`, the `./events/*` export, and isolated new test invocations.
- Modify `bun.lock` only through `bun add jsonata@2.2.2 --filter @archon/core`.
- Modify `packages/core/src/schemas/index.ts` to export the transform schemas and type.
- Modify `packages/core/src/schemas/workflow-provider-binding.ts` to expose optional public `transform` while continuing to strip private fields.
- Modify `packages/core/src/schemas/workflow-provider-binding.test.ts` for the new public projection.
- Modify `packages/core/src/events/workflow-event-envelope.ts` to replace the parallel hand-written envelope interface with a strict Zod schema and derived type.
- Modify `packages/core/src/events/workflow-event-envelope.test.ts` for event-specific payload validation, strict canonical shape, and identity serialization.
- Modify `migrations/000_combined.sql` to add `transform` and `delivery_headers` to the PostgreSQL fresh and upgrade schema.
- Modify `packages/core/src/db/adapters/sqlite.ts` to add the same fresh columns and idempotent upgrade checks.
- Modify `packages/core/src/db/adapters/sqlite.test.ts` for fresh shape, nullability, defaults, upgrade preservation, and parity count.
- Modify `packages/core/src/db/adapters/postgres.test.ts` to check the real combined SQL in the existing provider-binding convergence test.
- Modify `packages/core/src/db/provider-bindings-bundled-schema.test.ts` to check both disk and bundled SQL.
- Generate `packages/core/src/db/bundled-schema.generated.ts` with the existing generator.
- Modify `packages/core/src/db/provider-bindings.ts` to normalize, validate, persist, patch, publicly project, and privately read the two columns.
- Modify `packages/core/src/db/provider-bindings.test.ts` for create, update, private reads, public privacy, rotate, disable, and corruption behavior.
- Modify `packages/core/src/db/workflow-event-outbox.ts` to accept and insert initial `last_error` evidence.
- Modify `packages/core/src/db/workflow-event-outbox.test.ts` to lock initial `last_error` persistence.
- Modify `packages/core/src/workflows/store-adapter.ts` to transform once and persist `transform-failed` evidence.
- Modify `packages/core/src/workflows/store-adapter.test.ts` to prove call order, call count, exact bodies, safe errors, and safe logs.
- Modify `packages/server/src/workflow-events/dispatcher.ts` to validate private headers, merge them after HMAC headers, redact attempt evidence, and terminally reject corrupt headers.
- Modify `packages/server/src/workflow-events/dispatcher.test.ts` for stored-body retry HMAC, header merge, parser failures, validation failures, and redaction.
- Modify `packages/cli/src/commands/provider-binding.ts` to load and validate create/update file inputs with safe patch semantics.
- Modify `packages/cli/src/commands/provider-binding.test.ts` for create/update file behavior and secret-free errors.
- Modify `packages/cli/src/commands/provider-binding.e2e.test.ts` for argument parsing and the no-git dry run.
- Modify `packages/cli/src/cli.ts` to register the file flags, dispatch `provider-binding test`, and update built-in usage.
- Modify `packages/cli/package.json` to run `provider-binding-test.test.ts` in its own Bun process.
- Modify `packages/cli/src/commands/workflow-provider-command-envelope.ts` to add `binding.test` to the shared command sets.
- Modify `packages/cli/src/commands/workflow-provider-command-envelope.test.ts` to keep the source tuple, JSON Schema enum, and syntax baseline aligned.
- Modify `_bmad-output/planning-artifacts/contracts/workflow-commander/schemas/workflow-command-envelope.schema.json` to add `binding.test` to both binding command enums.
- Modify `_bmad-output/planning-artifacts/contracts/workflow-commander/validate_contracts.py` to require the new success fixture.
- Modify `packages/docs-web/src/content/docs/reference/cli.md` to document configuration, limits, privacy, failure evidence, and the dry run.

---

### Task 1: Transform Configuration Schema

**Files:**

- Create: `packages/core/src/schemas/provider-binding-transform.ts`
- Create: `packages/core/src/schemas/provider-binding-transform.test.ts`
- Modify: `packages/core/src/schemas/index.ts`
- Modify: `packages/core/package.json`

**Interfaces:**

- Consumes: `z` from `@hono/zod-openapi`.
- Produces: `JSONATA_EXPRESSION_MAX_BYTES`, `jsonataProviderBindingTransformSchema`, `providerBindingTransformSchema`, and `ProviderBindingTransform`.

- [ ] **Step 1: Write the failing schema tests**

Create `packages/core/src/schemas/provider-binding-transform.test.ts`:

```ts
import { describe, expect, test } from 'bun:test';
import {
  jsonataProviderBindingTransformSchema,
  providerBindingTransformSchema,
} from './provider-binding-transform';

describe('providerBindingTransformSchema', () => {
  test('applies every JSONata default', () => {
    expect(
      providerBindingTransformSchema.parse({
        engine: 'jsonata',
        expression: '{ "eventType": eventType }',
      })
    ).toEqual({
      engine: 'jsonata',
      expression: '{ "eventType": eventType }',
      timeoutMs: 50,
      stackDepth: 128,
      maxSequenceSize: 10_000,
      maxOutputBytes: 65_536,
    });
  });

  test('rejects empty expressions, unknown engines, non-positive limits, and every hard-cap overflow', () => {
    const base = { engine: 'jsonata' as const, expression: '{ "ok": true }' };
    expect(() => providerBindingTransformSchema.parse({ ...base, expression: '' })).toThrow();
    expect(() => providerBindingTransformSchema.parse({ engine: 'jq', expression: '.' })).toThrow();
    for (const patch of [
      { timeoutMs: 0 },
      { timeoutMs: 201 },
      { stackDepth: 0 },
      { stackDepth: 513 },
      { maxSequenceSize: 0 },
      { maxSequenceSize: 100_001 },
      { maxOutputBytes: 0 },
      { maxOutputBytes: 262_145 },
    ]) {
      expect(() => jsonataProviderBindingTransformSchema.parse({ ...base, ...patch })).toThrow();
    }
  });
});
```

- [ ] **Step 2: Run the test and verify it fails for the missing module**

Run from `packages/core`:

```bash
bun test src/schemas/provider-binding-transform.test.ts
```

Expected: FAIL with `Cannot find module './provider-binding-transform'`.

- [ ] **Step 3: Create the schema and export it**

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
```

Add this block to `packages/core/src/schemas/index.ts` after the workflow-provider-binding exports:

```ts
// ProviderBindingTransform
export {
  JSONATA_EXPRESSION_MAX_BYTES,
  jsonataProviderBindingTransformSchema,
  providerBindingTransformSchema,
} from './provider-binding-transform';
export type { ProviderBindingTransform } from './provider-binding-transform';
```

Append a separate `&& bun test src/schemas/provider-binding-transform.test.ts` segment to the `test` script in `packages/core/package.json`.

- [ ] **Step 4: Run the schema tests**

Run from `packages/core`:

```bash
bun test src/schemas/provider-binding-transform.test.ts
bun x tsc --noEmit
```

Expected: both commands exit `0`.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/schemas/provider-binding-transform.ts packages/core/src/schemas/provider-binding-transform.test.ts packages/core/src/schemas/index.ts packages/core/package.json
git commit -m "feat(core): add provider-binding transform schema"
```

---

### Task 2: JSONata Normalization, Safe Errors, And AST Policy

**Files:**

- Create: `packages/core/src/events/provider-binding-transform.ts`
- Create: `packages/core/src/events/provider-binding-transform.test.ts`
- Modify: `packages/core/package.json`
- Modify: `bun.lock`

**Interfaces:**

- Consumes: `ProviderBindingTransform`, `providerBindingTransformSchema`, and `JSONATA_EXPRESSION_MAX_BYTES` from Task 1.
- Produces: `TRANSFORM_ERROR_CODES`, `TransformErrorCode`, `ProviderBindingTransformError`, `isProviderBindingTransformError()`, `normalizeProviderBindingTransform()`, `compileProviderBindingTransform()`, and `validateProviderBindingTransform()`.

- [ ] **Step 1: Write failing normalization and AST tests**

Create `packages/core/src/events/provider-binding-transform.test.ts` with this first red slice:

```ts
import { describe, expect, test } from 'bun:test';
import {
  ProviderBindingTransformError,
  normalizeProviderBindingTransform,
  validateProviderBindingTransform,
} from './provider-binding-transform';

function transform(expression: string) {
  return normalizeProviderBindingTransform({ engine: 'jsonata', expression });
}

describe('provider-binding JSONata policy', () => {
  test('normalizes defaults and rejects an oversized UTF-8 expression with a safe error', () => {
    expect(transform('{ "ok": true }')).toMatchObject({
      timeoutMs: 50,
      stackDepth: 128,
      maxSequenceSize: 10_000,
      maxOutputBytes: 65_536,
    });
    try {
      normalizeProviderBindingTransform({
        engine: 'jsonata',
        expression: 'é'.repeat(16_385),
      });
      throw new Error('expected normalization failure');
    } catch (error) {
      expect(error).toBeInstanceOf(ProviderBindingTransformError);
      expect((error as ProviderBindingTransformError).code).toBe('TRANSFORM_CONFIG_INVALID');
      expect((error as Error).message).toBe('TRANSFORM_CONFIG_INVALID');
      expect((error as Error).message).not.toContain('é');
    }
  });

  test('accepts canonical field selection and approved direct functions', () => {
    expect(() =>
      validateProviderBindingTransform(
        transform('{ "eventType": $uppercase(eventType), "runId": workflowRunRef.runId }')
      )
    ).not.toThrow();
  });

  test('rejects disallowed, unknown, dynamic, and aliased calls without source leakage', () => {
    for (const expression of [
      '$eval("1")',
      '$now()',
      '$millis()',
      '$random()',
      '$pad("x", 8)',
      '($f := $now; $f())',
      '($f := $uppercase; $f("x"))',
    ]) {
      try {
        validateProviderBindingTransform(transform(expression));
        throw new Error('expected policy failure');
      } catch (error) {
        expect(error).toBeInstanceOf(ProviderBindingTransformError);
        expect((error as ProviderBindingTransformError).code).toBe(
          'TRANSFORM_FUNCTION_DISALLOWED'
        );
        expect((error as Error).message).not.toContain(expression);
      }
    }
  });

  test('rejects partials, apply, lambdas, transform expressions, and regex AST nodes', () => {
    for (const expression of [
      '$string(?)',
      '"x" ~> $uppercase()',
      'function($x){$x}',
      'payload ~> |foo|{bar: 1}|',
      '$contains(eventType, /run/)',
    ]) {
      expect(() => validateProviderBindingTransform(transform(expression))).toThrow(
        /TRANSFORM_AST_DISALLOWED/
      );
    }
  });

  test('classifies syntax failures without token text', () => {
    try {
      validateProviderBindingTransform(transform('{'));
      throw new Error('expected compile failure');
    } catch (error) {
      expect(error).toBeInstanceOf(ProviderBindingTransformError);
      expect((error as ProviderBindingTransformError).code).toBe('TRANSFORM_COMPILE_FAILED');
      expect((error as Error).message).toBe('TRANSFORM_COMPILE_FAILED');
      expect((error as Error).message).not.toContain('{');
    }
  });
});
```

- [ ] **Step 2: Run the test and verify the missing module failure**

Run from `packages/core`:

```bash
bun test src/events/provider-binding-transform.test.ts
```

Expected: FAIL with `Cannot find module './provider-binding-transform'`.

- [ ] **Step 3: Add JSONata and implement normalization plus AST validation**

Run once from the repository root:

```bash
bun add jsonata@2.2.2 --filter @archon/core
```

Create `packages/core/src/events/provider-binding-transform.ts` with these declarations and policy helpers:

```ts
import jsonata from 'jsonata';
import {
  JSONATA_EXPRESSION_MAX_BYTES,
  providerBindingTransformSchema,
  type ProviderBindingTransform,
} from '../schemas/provider-binding-transform';

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
  error: unknown
): error is ProviderBindingTransformError {
  return error instanceof ProviderBindingTransformError;
}

function utf8Bytes(value: string): number {
  return new TextEncoder().encode(value).length;
}

export function normalizeProviderBindingTransform(value: unknown): ProviderBindingTransform {
  const parsed = providerBindingTransformSchema.safeParse(value);
  if (
    !parsed.success ||
    utf8Bytes(parsed.data.expression) > JSONATA_EXPRESSION_MAX_BYTES
  ) {
    throw new ProviderBindingTransformError('TRANSFORM_CONFIG_INVALID');
  }
  return parsed.data;
}

const ALLOWED_FUNCTIONS = new Set<string>([
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

const DISALLOWED_AST_TYPES = new Set<string>([
  'partial',
  'lambda',
  'transform',
  'apply',
  'regex',
  'regexp',
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function visitAst(value: unknown, seen: WeakSet<object>): void {
  if (Array.isArray(value)) {
    if (seen.has(value)) return;
    seen.add(value);
    for (const item of value) visitAst(item, seen);
    return;
  }
  if (!isRecord(value)) return;
  if (seen.has(value)) return;
  seen.add(value);

  const type = value.type;
  if (typeof type === 'string' && DISALLOWED_AST_TYPES.has(type)) {
    throw new ProviderBindingTransformError('TRANSFORM_AST_DISALLOWED');
  }
  if (type === 'function') {
    const procedure = value.procedure;
    if (
      !isRecord(procedure) ||
      procedure.type !== 'variable' ||
      typeof procedure.value !== 'string' ||
      !ALLOWED_FUNCTIONS.has(procedure.value)
    ) {
      throw new ProviderBindingTransformError('TRANSFORM_FUNCTION_DISALLOWED');
    }
  }
  for (const nested of Object.values(value)) visitAst(nested, seen);
}

export function compileProviderBindingTransform(
  transform: ProviderBindingTransform
): jsonata.Expression {
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
  visitAst(compiled.ast(), new WeakSet<object>());
  return compiled;
}

export function validateProviderBindingTransform(transform: ProviderBindingTransform): void {
  compileProviderBindingTransform(transform);
}
```

Add a separate `&& bun test src/events/provider-binding-transform.test.ts` segment immediately after the existing workflow-envelope test segment in `packages/core/package.json`.

- [ ] **Step 4: Run the AST tests and type check**

Run from `packages/core`:

```bash
bun test src/events/provider-binding-transform.test.ts
bun x tsc --noEmit
```

Expected: both commands exit `0`.

- [ ] **Step 5: Commit**

```bash
git add packages/core/package.json bun.lock packages/core/src/events/provider-binding-transform.ts packages/core/src/events/provider-binding-transform.test.ts
git commit -m "feat(core): validate provider-binding JSONata policy"
```

---

### Task 3: Transform Evaluation, JSON Result Validation, And Identity Bytes

**Files:**

- Modify: `packages/core/src/events/provider-binding-transform.ts`
- Modify: `packages/core/src/events/provider-binding-transform.test.ts`
- Modify: `packages/core/package.json`

**Interfaces:**

- Consumes: `compileProviderBindingTransform()` from Task 2 and `WorkflowEventEnvelope` from `packages/core/src/events/workflow-event-envelope.ts`.
- Produces: `TransformBodyResult`, `assertJsonTransformResult()`, and `transformWorkflowEventBody()`.

- [ ] **Step 1: Add failing evaluator and result-validation tests**

Append these imports and tests to `packages/core/src/events/provider-binding-transform.test.ts`:

```ts
import { spyOn } from 'bun:test';
import { buildWorkflowEventEnvelope } from './workflow-event-envelope';
import {
  assertJsonTransformResult,
  transformWorkflowEventBody,
} from './provider-binding-transform';

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
  test('preserves the exact current identity serialization', async () => {
    const result = await transformWorkflowEventBody(envelope, null);
    expect(result).toEqual({
      body: JSON.stringify(envelope),
      outputBytes: new TextEncoder().encode(JSON.stringify(envelope)).length,
      engine: 'identity',
      durationMs: expect.any(Number),
    });
  });

  test('returns exact JSONata serialization and UTF-8 byte length', async () => {
    const result = await transformWorkflowEventBody(
      envelope,
      transform('{ "eventType": eventType, "value": "é" }')
    );
    expect(result.body).toBe('{"eventType":"workflow.run.started","value":"é"}');
    expect(result.outputBytes).toBe(new TextEncoder().encode(result.body).length);
    expect(result.engine).toBe('jsonata');
  });

  test('rejects scalar top-level output and UTF-8 output over the configured limit', async () => {
    await expect(transformWorkflowEventBody(envelope, transform('eventType'))).rejects.toMatchObject({
      code: 'TRANSFORM_RESULT_INVALID',
    });
    await expect(
      transformWorkflowEventBody(
        envelope,
        normalizeProviderBindingTransform({
          engine: 'jsonata',
          expression: '{ "v": "éé" }',
          maxOutputBytes: 5,
        })
      )
    ).rejects.toMatchObject({ code: 'TRANSFORM_OUTPUT_TOO_LARGE' });
  });

  test('rejects every non-JSON result shape and accepts repeated non-cyclic references', () => {
    for (const invalid of [
      undefined,
      () => 'x',
      Symbol('x'),
      1n,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      Number.NEGATIVE_INFINITY,
      new Date('2026-07-25T00:00:00.000Z'),
    ]) {
      expect(() => assertJsonTransformResult(invalid)).toThrow(/TRANSFORM_RESULT_INVALID/);
    }
    const sparse: unknown[] = [];
    sparse[1] = 'x';
    expect(() => assertJsonTransformResult(sparse)).toThrow(/TRANSFORM_RESULT_INVALID/);
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(() => assertJsonTransformResult(cyclic)).toThrow(/TRANSFORM_RESULT_INVALID/);
    const shared = { value: 'ok' };
    expect(() => assertJsonTransformResult({ left: shared, right: shared })).not.toThrow();
    expect(() => assertJsonTransformResult(Object.assign(Object.create(null), { ok: true }))).not.toThrow();
  });

  test('maps deterministic sequence, stack, and timeout guardrail failures', async () => {
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

    let now = 0;
    const dateNow = spyOn(Date, 'now').mockImplementation(() => {
      now += 10;
      return now;
    });
    try {
      await expect(
        transformWorkflowEventBody(
          envelope,
          normalizeProviderBindingTransform({
            engine: 'jsonata',
            expression: '{ "n": [1..20] }',
            timeoutMs: 1,
            maxSequenceSize: 100,
          })
        )
      ).rejects.toMatchObject({ code: 'TRANSFORM_TIMEOUT' });
    } finally {
      dateNow.mockRestore();
    }
  });
});
```

- [ ] **Step 2: Run the evaluator test and verify the missing exports fail**

Run from `packages/core`:

```bash
bun test src/events/provider-binding-transform.test.ts
```

Expected: FAIL because `assertJsonTransformResult` and `transformWorkflowEventBody` are not exported.

- [ ] **Step 3: Implement result validation, safe classification, and serialization**

Add `import type { WorkflowEventEnvelope } from './workflow-event-envelope';` and the following code to `packages/core/src/events/provider-binding-transform.ts`:

```ts
export interface TransformBodyResult {
  body: string;
  outputBytes: number;
  engine: 'identity' | 'jsonata';
  durationMs: number;
}

export function assertJsonTransformResult(
  value: unknown,
  activePath = new WeakSet<object>()
): void {
  if (
    value === undefined ||
    typeof value === 'function' ||
    typeof value === 'symbol' ||
    typeof value === 'bigint'
  ) {
    throw new ProviderBindingTransformError('TRANSFORM_RESULT_INVALID');
  }
  if (typeof value === 'number' && !Number.isFinite(value)) {
    throw new ProviderBindingTransformError('TRANSFORM_RESULT_INVALID');
  }
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'boolean' ||
    typeof value === 'number'
  ) {
    return;
  }
  if (typeof value !== 'object' || activePath.has(value)) {
    throw new ProviderBindingTransformError('TRANSFORM_RESULT_INVALID');
  }

  activePath.add(value);
  try {
    if (Array.isArray(value)) {
      for (let index = 0; index < value.length; index += 1) {
        if (!Object.prototype.hasOwnProperty.call(value, index)) {
          throw new ProviderBindingTransformError('TRANSFORM_RESULT_INVALID');
        }
        assertJsonTransformResult(value[index], activePath);
      }
      return;
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new ProviderBindingTransformError('TRANSFORM_RESULT_INVALID');
    }
    for (const nested of Object.values(value as Record<string, unknown>)) {
      assertJsonTransformResult(nested, activePath);
    }
  } finally {
    activePath.delete(value);
  }
}

function classifyJsonataError(error: unknown): TransformErrorCode {
  const code =
    typeof error === 'object' && error !== null && 'code' in error
      ? String((error as { code: unknown }).code)
      : '';
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
      outputBytes: utf8Bytes(body),
      engine: 'identity',
      durationMs: Math.max(0, Date.now() - startedAt),
    };
  }

  const compiled = compileProviderBindingTransform(transform);
  let raw: unknown;
  try {
    raw = await compiled.evaluate(envelope);
  } catch (error) {
    throw new ProviderBindingTransformError(classifyJsonataError(error));
  }
  if (raw === null || typeof raw !== 'object') {
    throw new ProviderBindingTransformError('TRANSFORM_RESULT_INVALID');
  }

  let body: string;
  try {
    assertJsonTransformResult(raw);
    body = JSON.stringify(raw);
  } catch (error) {
    if (isProviderBindingTransformError(error)) throw error;
    throw new ProviderBindingTransformError('TRANSFORM_RESULT_INVALID');
  }
  const outputBytes = utf8Bytes(body);
  if (outputBytes > transform.maxOutputBytes) {
    throw new ProviderBindingTransformError('TRANSFORM_OUTPUT_TOO_LARGE');
  }
  return {
    body,
    outputBytes,
    engine: 'jsonata',
    durationMs: Math.max(0, Date.now() - startedAt),
  };
}
```

Add `"./events/*": "./src/events/*.ts"` to `packages/core/package.json` next to the existing schema wildcard export.

- [ ] **Step 4: Run the transform tests and type check**

Run from `packages/core`:

```bash
bun test src/events/provider-binding-transform.test.ts
bun x tsc --noEmit
```

Expected: both commands exit `0`.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/events/provider-binding-transform.ts packages/core/src/events/provider-binding-transform.test.ts packages/core/package.json
git commit -m "feat(core): evaluate outbound JSONata transforms"
```

---

### Task 4: Strict Canonical Envelope Zod Schema

**Files:**

- Modify: `packages/core/src/events/workflow-event-envelope.ts`
- Modify: `packages/core/src/events/workflow-event-envelope.test.ts`

**Interfaces:**

- Consumes: `externalWorkflowEventTypeSchema` and the existing `workflowEventPayloadSchemas` map.
- Produces: `workflowEventEnvelopeSchema` and `WorkflowEventEnvelope = z.infer<typeof workflowEventEnvelopeSchema>`.
- Preserves: `buildWorkflowEventEnvelope()` output keys, insertion order, and identity bytes.

- [ ] **Step 1: Add failing canonical-envelope tests**

Append these tests to `packages/core/src/events/workflow-event-envelope.test.ts` and import `workflowEventEnvelopeSchema`:

```ts
test('workflowEventEnvelopeSchema selects the payload schema from eventType', () => {
  const envelope = buildWorkflowEventEnvelope({
    eventId: 'evt-schema',
    eventType: 'workflow.run.started',
    occurredAt: '2026-07-25T00:00:00.000Z',
    run,
    codebase: baseCodebase,
    binding,
    payload: payloads['workflow.run.started'],
  });
  expect(workflowEventEnvelopeSchema.parse(envelope).eventType).toBe('workflow.run.started');
  expect(() =>
    workflowEventEnvelopeSchema.parse({ ...envelope, eventType: 'workflow.run.completed' })
  ).toThrow();
});

test('workflowEventEnvelopeSchema rejects non-canonical top-level and ref keys', () => {
  const envelope = buildWorkflowEventEnvelope({
    eventId: 'evt-strict',
    eventType: 'workflow.run.started',
    occurredAt: '2026-07-25T00:00:00.000Z',
    run,
    codebase: baseCodebase,
    binding,
    payload: payloads['workflow.run.started'],
  });
  expect(() => workflowEventEnvelopeSchema.parse({ ...envelope, extra: true })).toThrow();
  expect(() =>
    workflowEventEnvelopeSchema.parse({
      ...envelope,
      bindingRef: { ...envelope.bindingRef, secret: 'must-not-pass' },
    })
  ).toThrow();
});

test('identity serialization remains byte-identical to the current literal shape', () => {
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
    '{"schemaVersion":"workflow-event-envelope.v1","provider":"archon","eventId":"evt-identity","eventType":"workflow.run.started","occurredAt":"2026-07-25T00:00:00.000Z","bindingRef":{"provider":"archon","name":"workflow-engine-primary","bindingId":"wpb_archon::workflow_engine_primary","projectRef":"project:cb-1"},"workflowRunRef":{"provider":"archon","runId":"run-1","workflowName":"bmad-dev-story","projectRef":"project:cb-1"},"projectRef":{"id":"cb-1","codebaseRef":"workflow-engine","repositoryPath":"/workspace/workflow-engine","defaultBranch":"dev"},"idempotencyKey":"archon:workflow-engine-primary:evt-identity","payload":{"state":"running","startedAt":"2026-07-25T00:00:00.000Z"}}'
  );
});
```

- [ ] **Step 2: Run the envelope test and verify the missing export fails**

Run from `packages/core`:

```bash
bun test src/events/workflow-event-envelope.test.ts
```

Expected: FAIL because `workflowEventEnvelopeSchema` is not exported.

- [ ] **Step 3: Remove the parallel envelope interface and insert the schema after its dependencies**

Change the workflow-event import in `packages/core/src/events/workflow-event-envelope.ts` to import both the schema value and type:

```ts
import {
  externalWorkflowEventTypeSchema,
  type ExternalWorkflowEventType,
} from '../schemas/workflow-event';
```

Delete only `export interface WorkflowEventEnvelope { ... }` from its current location.
Insert the following schema block immediately after the complete `workflowEventPayloadSchemas` declaration and before `buildWorkflowEventEnvelope()`.
This location is required because the schema uses `nonEmptyStringSchema`, `dateTimeSchema`, and `workflowEventPayloadSchemas`, all of which are `const` values that must already be initialized.

```ts
const bindingRefSchema = z
  .object({
    provider: nonEmptyStringSchema,
    name: nonEmptyStringSchema,
    bindingId: nonEmptyStringSchema,
    projectRef: nonEmptyStringSchema,
  })
  .strict();

const workflowRunRefSchema = z
  .object({
    provider: nonEmptyStringSchema,
    runId: nonEmptyStringSchema,
    workflowName: nonEmptyStringSchema,
    projectRef: nonEmptyStringSchema,
  })
  .strict();

const projectRefSchema = z
  .object({
    id: nonEmptyStringSchema,
    codebaseRef: nonEmptyStringSchema,
    repositoryPath: nonEmptyStringSchema,
    defaultBranch: nonEmptyStringSchema.optional(),
  })
  .strict();

export const workflowEventEnvelopeSchema = z
  .object({
    schemaVersion: z.literal('workflow-event-envelope.v1'),
    provider: nonEmptyStringSchema,
    eventId: nonEmptyStringSchema,
    eventType: externalWorkflowEventTypeSchema,
    occurredAt: dateTimeSchema,
    bindingRef: bindingRefSchema,
    workflowRunRef: workflowRunRefSchema,
    projectRef: projectRefSchema,
    idempotencyKey: nonEmptyStringSchema,
    payload: z.record(z.string(), z.unknown()),
  })
  .strict()
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

Keep `BuildWorkflowEventEnvelopeInput` and `buildWorkflowEventEnvelope()` unchanged.
Do not construct builder output by calling `.parse()`, because the builder already validates the payload and must preserve its existing insertion order.

- [ ] **Step 4: Run envelope and transform tests separately**

Run from `packages/core`:

```bash
bun test src/events/workflow-event-envelope.test.ts
bun test src/events/provider-binding-transform.test.ts
bun x tsc --noEmit
```

Expected: all commands exit `0`.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/events/workflow-event-envelope.ts packages/core/src/events/workflow-event-envelope.test.ts
git commit -m "feat(core): validate the canonical workflow event envelope"
```

---

### Task 5: Private Receiver Header Validation And Redacted Evidence

**Files:**

- Create: `packages/core/src/events/delivery-headers.ts`
- Create: `packages/core/src/events/delivery-headers.test.ts`
- Modify: `packages/core/package.json`

**Interfaces:**

- Produces: `deliveryHeadersSchema`, `DeliveryHeaders`, `UNSAFE_DELIVERY_HEADERS`, `normalizeDeliveryHeaders()`, `validateDeliveryHeaders()`, `mergeDeliveryHeaders()`, and `buildDeliveryHeaderEvidence()`.

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
  test('accepts a valid string record', () => {
    expect(normalizeDeliveryHeaders({ Authorization: 'Bearer secret' })).toEqual({
      Authorization: 'Bearer secret',
    });
  });

  test('rejects non-string values with a constant non-secret error', () => {
    try {
      normalizeDeliveryHeaders({ Authorization: { secret: 'Bearer secret' } });
      throw new Error('expected validation failure');
    } catch (error) {
      expect((error as Error).message).toBe('unsafe-delivery-headers');
      expect((error as Error).message).not.toContain('Bearer secret');
    }
  });

  test('rejects every reserved name case-insensitively', () => {
    for (const name of [
      'content-type',
      'X-WEBHOOK-SIGNATURE-V2',
      'x-webhook-timestamp',
      'x-request-id',
      'Host',
      'Content-Length',
      'Connection',
      'Keep-Alive',
      'Proxy-Authenticate',
      'Proxy-Authorization',
      'Proxy-Connection',
      'TE',
      'Trailer',
      'Transfer-Encoding',
      'Upgrade',
    ]) {
      expect(() => validateDeliveryHeaders({ [name]: 'x' })).toThrow(
        /unsafe-delivery-headers/
      );
    }
  });

  test('rejects invalid names, line breaks, count, per-field bytes, and aggregate value bytes', () => {
    expect(() => validateDeliveryHeaders({ 'Bad Name': 'x' })).toThrow();
    expect(() => validateDeliveryHeaders({ 'Bad\rName': 'x' })).toThrow();
    expect(() => validateDeliveryHeaders({ Authorization: 'Bearer\nsecret' })).toThrow();
    expect(() =>
      validateDeliveryHeaders(
        Object.fromEntries(Array.from({ length: 17 }, (_, index) => [`X-H${index}`, 'v']))
      )
    ).toThrow();
    expect(() => validateDeliveryHeaders({ ['é'.repeat(65)]: 'v' })).toThrow();
    expect(() => validateDeliveryHeaders({ Authorization: 'é'.repeat(4_097) })).toThrow();
    expect(() =>
      validateDeliveryHeaders({
        'X-A': 'x'.repeat(8_192),
        'X-B': 'x'.repeat(8_192),
        'X-C': 'x'.repeat(8_192),
        'X-D': 'x'.repeat(8_192),
        'X-E': 'x',
      })
    ).toThrow();
  });

  test('merges valid receiver headers and redacts only their evidence values', () => {
    expect(mergeDeliveryHeaders(archonHeaders, { Authorization: 'Bearer secret' })).toEqual({
      ...archonHeaders,
      Authorization: 'Bearer secret',
    });
    expect(
      buildDeliveryHeaderEvidence(archonHeaders, { Authorization: 'Bearer secret' })
    ).toEqual({
      ...archonHeaders,
      Authorization: '[REDACTED]',
    });
    expect(() =>
      mergeDeliveryHeaders(archonHeaders, { 'content-type': 'text/plain' })
    ).toThrow(/unsafe-delivery-headers/);
  });
});
```

- [ ] **Step 2: Run the test and verify the missing module failure**

Run from `packages/core`:

```bash
bun test src/events/delivery-headers.test.ts
```

Expected: FAIL with `Cannot find module './delivery-headers'`.

- [ ] **Step 3: Implement the safe header module**

Create `packages/core/src/events/delivery-headers.ts`:

```ts
import { z } from '@hono/zod-openapi';

export const deliveryHeadersSchema = z.record(z.string(), z.string());
export type DeliveryHeaders = z.infer<typeof deliveryHeadersSchema>;

export const UNSAFE_DELIVERY_HEADERS = 'unsafe-delivery-headers';
const HEADER_TOKEN = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;
const RESERVED = new Set(
  [
    'Content-Type',
    'X-Webhook-Signature-V2',
    'X-Webhook-Timestamp',
    'X-Request-ID',
    'Host',
    'Content-Length',
    'Connection',
    'Keep-Alive',
    'Proxy-Authenticate',
    'Proxy-Authorization',
    'Proxy-Connection',
    'TE',
    'Trailer',
    'Transfer-Encoding',
    'Upgrade',
  ].map(name => name.toLowerCase())
);

function fail(): never {
  throw new Error(UNSAFE_DELIVERY_HEADERS);
}

function utf8Bytes(value: string): number {
  return new TextEncoder().encode(value).length;
}

export function validateDeliveryHeaders(headers: DeliveryHeaders): void {
  const entries = Object.entries(headers);
  if (entries.length > 16) fail();
  let totalValueBytes = 0;
  for (const [name, value] of entries) {
    const lowerName = name.toLowerCase();
    if (
      !HEADER_TOKEN.test(name) ||
      name.includes('\r') ||
      name.includes('\n') ||
      value.includes('\r') ||
      value.includes('\n') ||
      RESERVED.has(lowerName) ||
      utf8Bytes(name) > 128 ||
      utf8Bytes(value) > 8_192
    ) {
      fail();
    }
    totalValueBytes += utf8Bytes(value);
  }
  if (totalValueBytes > 32_768) fail();
}

export function normalizeDeliveryHeaders(value: unknown): DeliveryHeaders {
  const parsed = deliveryHeadersSchema.safeParse(value);
  if (!parsed.success) fail();
  validateDeliveryHeaders(parsed.data);
  return parsed.data;
}

export function mergeDeliveryHeaders(
  archonHeaders: Record<string, string>,
  receiverHeaders: DeliveryHeaders
): Record<string, string> {
  validateDeliveryHeaders(receiverHeaders);
  return { ...archonHeaders, ...receiverHeaders };
}

export function buildDeliveryHeaderEvidence(
  archonHeaders: Record<string, string>,
  receiverHeaders: DeliveryHeaders
): Record<string, string> {
  validateDeliveryHeaders(receiverHeaders);
  return {
    ...archonHeaders,
    ...Object.fromEntries(Object.keys(receiverHeaders).map(name => [name, '[REDACTED]'])),
  };
}
```

Append a separate `&& bun test src/events/delivery-headers.test.ts` segment after the transform test segment in `packages/core/package.json`.

- [ ] **Step 4: Run header tests and type check**

Run from `packages/core`:

```bash
bun test src/events/delivery-headers.test.ts
bun x tsc --noEmit
```

Expected: both commands exit `0`.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/events/delivery-headers.ts packages/core/src/events/delivery-headers.test.ts packages/core/package.json
git commit -m "feat(core): validate private delivery headers"
```

---

### Task 6: Additive Binding Columns In Both Dialects

**Files:**

- Modify: `migrations/000_combined.sql`
- Modify: `packages/core/src/db/adapters/sqlite.ts`
- Modify: `packages/core/src/db/adapters/sqlite.test.ts`
- Modify: `packages/core/src/db/adapters/postgres.test.ts`
- Modify: `packages/core/src/db/provider-bindings-bundled-schema.test.ts`
- Generate: `packages/core/src/db/bundled-schema.generated.ts`

**Interfaces:**

- Produces: nullable `transform TEXT` and non-null `delivery_headers TEXT NOT NULL DEFAULT '{}'` on `remote_agent_workflow_provider_bindings`.

- [ ] **Step 1: Add failing fresh, upgrade, PostgreSQL, bundled, and parity tests**

Inside `describe('remote_agent_workflow_provider_bindings (Story 3.1)')` in `packages/core/src/db/adapters/sqlite.test.ts`, add:

```ts
test('fresh schema has transform and delivery_headers with matching nullability and default', async () => {
  db = createTestDb();
  const result = await db.query<{
    name: string;
    notnull: number;
    dflt_value: string | null;
  }>("PRAGMA table_info('remote_agent_workflow_provider_bindings')");
  const columns = new Map(result.rows.map(column => [column.name, column]));
  expect(columns.get('transform')).toMatchObject({ notnull: 0, dflt_value: null });
  expect(columns.get('delivery_headers')).toMatchObject({
    notnull: 1,
    dflt_value: "'{}'",
  });
});

test('upgrade adds transform and delivery_headers without changing an existing row', async () => {
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
    VALUES ('wpb-legacy', 'archon', 'legacy', 'cb-legacy', 'https://example.invalid/events');
  `);
  raw.close();

  db = new SqliteAdapter(dbPath);
  const rows = await db.query<{
    name: string;
    transform: string | null;
    delivery_headers: string;
  }>(
    'SELECT name, transform, delivery_headers FROM remote_agent_workflow_provider_bindings WHERE id = $1',
    ['wpb-legacy']
  );
  expect(rows.rows[0]).toEqual({
    name: 'legacy',
    transform: null,
    delivery_headers: '{}',
  });
});
```

Raise `MIN_NON_AUTH_COLUMNS` from `136` to `138` in the same file.

Add these assertions to the existing real-SQL provider-binding convergence test in `packages/core/src/db/adapters/postgres.test.ts`:

```ts
expect(realCombinedSql).toContain('transform        TEXT');
expect(realCombinedSql).toContain("delivery_headers TEXT NOT NULL DEFAULT '{}'");
expect(realCombinedSql).toContain(
  'ALTER TABLE remote_agent_workflow_provider_bindings\n  ADD COLUMN IF NOT EXISTS transform TEXT;'
);
expect(realCombinedSql).toContain(
  "ALTER TABLE remote_agent_workflow_provider_bindings\n  ADD COLUMN IF NOT EXISTS delivery_headers TEXT NOT NULL DEFAULT '{}';"
);
```

Add the same four assertions for both `getSchemaSQL()` and `BUNDLED_SCHEMA_SQL` in `packages/core/src/db/provider-bindings-bundled-schema.test.ts`.

- [ ] **Step 2: Run each mock-sensitive test file separately and verify red**

Run from `packages/core`:

```bash
bun test src/db/adapters/sqlite.test.ts
bun test src/db/adapters/postgres.test.ts
bun test src/db/provider-bindings-bundled-schema.test.ts
```

Expected: each relevant new assertion fails because the columns are absent.

- [ ] **Step 3: Add fresh and upgrade schema definitions**

In `migrations/000_combined.sql`, add these columns after `signing_secret` in the provider-binding `CREATE TABLE` body:

```sql
  transform        TEXT,
  delivery_headers TEXT NOT NULL DEFAULT '{}',
```

After the existing `event_types` provider-binding `ALTER TABLE`, add:

```sql
ALTER TABLE remote_agent_workflow_provider_bindings
  ADD COLUMN IF NOT EXISTS transform TEXT;

ALTER TABLE remote_agent_workflow_provider_bindings
  ADD COLUMN IF NOT EXISTS delivery_headers TEXT NOT NULL DEFAULT '{}';
```

In the provider-binding `CREATE TABLE` inside `SqliteAdapter.createSchema()` in `packages/core/src/db/adapters/sqlite.ts`, add:

```sql
        transform TEXT,
        delivery_headers TEXT NOT NULL DEFAULT '{}',
```

In the existing provider-binding block of `SqliteAdapter.migrateColumns()`, after the `event_types` check, add:

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

Regenerate from the repository root:

```bash
bun run generate:bundled-schema
```

- [ ] **Step 4: Run schema tests and the generator check**

Run from `packages/core`:

```bash
bun test src/db/adapters/sqlite.test.ts
bun test src/db/adapters/postgres.test.ts
bun test src/db/provider-bindings-bundled-schema.test.ts
```

Run from the repository root:

```bash
bun run check:bundled-schema
```

Expected: every command exits `0`.

- [ ] **Step 5: Commit**

```bash
git add migrations/000_combined.sql packages/core/src/db/adapters/sqlite.ts packages/core/src/db/adapters/sqlite.test.ts packages/core/src/db/adapters/postgres.test.ts packages/core/src/db/provider-bindings-bundled-schema.test.ts packages/core/src/db/bundled-schema.generated.ts
git commit -m "feat(core): add provider-binding delivery config columns"
```

---

### Task 7: Binding Persistence, Patch Semantics, And Privacy

**Files:**

- Modify: `packages/core/src/schemas/workflow-provider-binding.ts`
- Modify: `packages/core/src/schemas/workflow-provider-binding.test.ts`
- Modify: `packages/core/src/db/provider-bindings.ts`
- Modify: `packages/core/src/db/provider-bindings.test.ts`

**Interfaces:**

- Consumes: transform schema and functions from Tasks 1 through 3 plus delivery-header schema and functions from Task 5.
- Produces: a public binding with optional normalized `transform` and a private Zod-derived `WorkflowProviderBindingWithSecret` with `signing_secret` and `delivery_headers`.
- Preserves: the current required create/update fields and current rotate/disable behavior.

- [ ] **Step 1: Add failing public, private, write, patch, lifecycle, and corruption tests**

Update the full-row fixture and expected key list in `packages/core/src/schemas/workflow-provider-binding.test.ts` to include `transform: null`.
Add this privacy test:

```ts
test('public projection parses transform and strips both private columns', () => {
  const parsed = workflowProviderBindingSchema.parse({
    id: 'wpb-1',
    provider: 'archon',
    name: 'workflow-engine-primary',
    codebase_id: 'cb-1',
    event_route: 'https://example.invalid/events',
    event_types: [],
    transform: {
      engine: 'jsonata',
      expression: '{ "ok": true }',
      timeoutMs: 50,
      stackDepth: 128,
      maxSequenceSize: 10_000,
      maxOutputBytes: 65_536,
    },
    delivery_headers: { Authorization: 'Bearer secret' },
    signing_secret: 'signing-value',
    state: 'active',
    binding_version: 1,
    created_at: '2026-07-11T11:48:27.000Z',
    updated_at: '2026-07-11T11:48:27.000Z',
  });
  expect(parsed.transform?.engine).toBe('jsonata');
  expect('delivery_headers' in parsed).toBe(false);
  expect('signing_secret' in parsed).toBe(false);
});
```

Extend `bindingRow()` in `packages/core/src/db/provider-bindings.test.ts` with `transform: null` and `delivery_headers: '{}'`.
Add tests with these exact assertions:

```ts
test('create normalizes and stores transform JSON plus private header JSON before returning a public row', async () => {
  mockQuery.mockResolvedValueOnce(createQueryResult([bindingRow()], 1));
  mockQuery.mockResolvedValueOnce(
    createQueryResult([
      bindingRow({
        transform: JSON.stringify({
          engine: 'jsonata',
          expression: '{ "ok": true }',
          timeoutMs: 50,
          stackDepth: 128,
          maxSequenceSize: 10_000,
          maxOutputBytes: 65_536,
        }),
        delivery_headers: JSON.stringify({ Authorization: 'Bearer secret' }),
      }),
    ])
  );
  const result = await createBinding({
    provider: 'archon',
    name: 'workflow-engine-primary',
    codebaseId: 'cb-1',
    eventRoute: 'https://example.invalid/events',
    transform: { engine: 'jsonata', expression: '{ "ok": true }' } as never,
    deliveryHeaders: { Authorization: 'Bearer secret' },
  });
  const [, params] = mockQuery.mock.calls[0] as [string, unknown[]];
  expect(params[7]).toBe(
    JSON.stringify({
      engine: 'jsonata',
      expression: '{ "ok": true }',
      timeoutMs: 50,
      stackDepth: 128,
      maxSequenceSize: 10_000,
      maxOutputBytes: 65_536,
    })
  );
  expect(params[8]).toBe(JSON.stringify({ Authorization: 'Bearer secret' }));
  expect(result.transform?.engine).toBe('jsonata');
  expect('delivery_headers' in result).toBe(false);
});

test('public get strips private fields and private reads return delivery headers', async () => {
  const stored = bindingRow({
    delivery_headers: JSON.stringify({ Authorization: 'Bearer secret' }),
    signing_secret: 'signing-value',
  });
  mockQuery.mockResolvedValueOnce(createQueryResult([stored], 1));
  const publicResult = await getBinding('archon', 'workflow-engine-primary');
  expect('delivery_headers' in (publicResult ?? {})).toBe(false);
  expect('signing_secret' in (publicResult ?? {})).toBe(false);

  mockQuery.mockResolvedValueOnce(createQueryResult([stored], 1));
  const privateResult = await getBindingByIdWithSecret('wpb-1');
  expect(privateResult?.delivery_headers).toEqual({ Authorization: 'Bearer secret' });
  expect(privateResult?.signing_secret).toBe('signing-value');
});

test('update omission preserves both columns and null clears both columns', async () => {
  mockQuery.mockResolvedValueOnce(createQueryResult([bindingRow()], 1));
  mockQuery.mockResolvedValueOnce(createQueryResult([], 1));
  mockQuery.mockResolvedValueOnce(createQueryResult([bindingRow()], 1));
  await updateBinding({
    provider: 'archon',
    name: 'workflow-engine-primary',
    codebaseId: 'cb-1',
    eventRoute: 'https://example.invalid/events/v2',
  });
  const [, omitted] = mockQuery.mock.calls[1] as [string, unknown[]];
  expect(omitted.slice(4, 8)).toEqual([0, null, 0, null]);

  mockQuery.mockReset();
  mockQuery.mockResolvedValueOnce(createQueryResult([bindingRow()], 1));
  mockQuery.mockResolvedValueOnce(createQueryResult([], 1));
  mockQuery.mockResolvedValueOnce(createQueryResult([bindingRow()], 1));
  await updateBinding({
    provider: 'archon',
    name: 'workflow-engine-primary',
    codebaseId: 'cb-1',
    eventRoute: 'https://example.invalid/events/v2',
    transform: null,
    deliveryHeaders: null,
  });
  const [sql, cleared] = mockQuery.mock.calls[1] as [string, unknown[]];
  expect(sql).toContain('transform = CASE WHEN $5 = 1');
  expect(sql).toContain('delivery_headers = CASE WHEN $7 = 1');
  expect(cleared.slice(4, 8)).toEqual([1, null, 1, '{}']);
});

test('invalid supplied config fails before a transaction or query starts', async () => {
  await expect(
    createBinding({
      provider: 'archon',
      name: 'workflow-engine-primary',
      codebaseId: 'cb-1',
      eventRoute: 'https://example.invalid/events',
      transform: { engine: 'jsonata', expression: '$now()' } as never,
    })
  ).rejects.toThrow(/TRANSFORM_FUNCTION_DISALLOWED/);
  await expect(
    createBinding({
      provider: 'archon',
      name: 'workflow-engine-primary',
      codebaseId: 'cb-1',
      eventRoute: 'https://example.invalid/events',
      deliveryHeaders: { 'Content-Type': 'text/plain' },
    })
  ).rejects.toThrow(/unsafe-delivery-headers/);
  expect(mockWithTransaction).not.toHaveBeenCalled();
  expect(mockQuery).not.toHaveBeenCalled();
});

test('rotate and disable preserve transform and delivery headers without assigning them', async () => {
  mockQuery.mockResolvedValueOnce(createQueryResult([bindingRow()], 1));
  mockQuery.mockResolvedValueOnce(createQueryResult([], 1));
  mockQuery.mockResolvedValueOnce(createQueryResult([bindingRow({ state: 'rotated' })], 1));
  await rotateBinding('archon', 'workflow-engine-primary', 'rotated-secret');
  expect((mockQuery.mock.calls[1]?.[0] as string)).not.toMatch(/transform|delivery_headers/);

  mockQuery.mockReset();
  mockQuery.mockResolvedValueOnce(createQueryResult([bindingRow()], 1));
  mockQuery.mockResolvedValueOnce(createQueryResult([], 1));
  mockQuery.mockResolvedValueOnce(createQueryResult([bindingRow({ state: 'disabled' })], 1));
  await disableBinding('archon', 'workflow-engine-primary');
  expect((mockQuery.mock.calls[1]?.[0] as string)).not.toMatch(/transform|delivery_headers/);
});

test('corrupt transform or delivery-header JSON reports only the corrupt field', async () => {
  for (const override of [
    { transform: '{not-json' },
    { delivery_headers: '{not-json' },
  ]) {
    mockQuery.mockResolvedValueOnce(createQueryResult([bindingRow(override)], 1));
    try {
      await getBinding('archon', 'workflow-engine-primary');
      throw new Error('expected corrupt-row failure');
    } catch (error) {
      expect((error as Error).message).toMatch(/^BINDING_CORRUPT_ROW: (transform|delivery_headers)$/);
      expect((error as Error).message).not.toContain('not-json');
    }
  }
});
```

- [ ] **Step 2: Run schema and DB tests separately and verify red**

Run from `packages/core`:

```bash
bun test src/schemas/workflow-provider-binding.test.ts
bun test src/db/provider-bindings.test.ts
```

Expected: FAIL because transform is absent from the public schema and the DB layer does not parse or persist the new columns.

- [ ] **Step 3: Implement public projection and private row parsing**

Add this property to `workflowProviderBindingSchema` in `packages/core/src/schemas/workflow-provider-binding.ts`:

```ts
transform: providerBindingTransformSchema.nullable().optional(),
```

Import `providerBindingTransformSchema` from `./provider-binding-transform`.

In `packages/core/src/db/provider-bindings.ts`, import `z`, the transform type/functions, and delivery-header schema/type/functions.
Derive the private type from its schema:

```ts
const workflowProviderBindingWithSecretSchema = workflowProviderBindingSchema.extend({
  signing_secret: workflowProviderBindingSchema.shape.event_route.nullable().optional(),
  delivery_headers: deliveryHeadersSchema.default({}),
});

export type WorkflowProviderBindingWithSecret = z.infer<
  typeof workflowProviderBindingWithSecretSchema
>;
```

Replace `normalizeBindingRow()` with independent parsing for all JSON columns:

```ts
function normalizeBindingRow(row: unknown): unknown {
  if (typeof row !== 'object' || row === null || Array.isArray(row)) return row;
  const normalized: Record<string, unknown> = { ...row };
  if (typeof normalized.event_types === 'string') {
    try {
      normalized.event_types = JSON.parse(normalized.event_types) as unknown;
    } catch {
      // Leave the invalid value for the public schema to classify by field path.
    }
  }
  for (const column of ['transform', 'delivery_headers'] as const) {
    if (typeof normalized[column] !== 'string') continue;
    try {
      normalized[column] = JSON.parse(normalized[column]) as unknown;
    } catch {
      throw new Error(`BINDING_CORRUPT_ROW: ${column}`);
    }
  }
  return normalized;
}
```

Make `parseBindingRowWithSecret()` fail closed with safe issue paths instead of falling back to a public parse and casting:

```ts
function parseBindingRowWithSecret(row: unknown): WorkflowProviderBindingWithSecret {
  const parsed = workflowProviderBindingWithSecretSchema.safeParse(normalizeBindingRow(row));
  if (parsed.success) return parsed.data;
  const fields = parsed.error.issues.map(issue => issue.path.join('.') || '<root>').join(',');
  throw new Error(`BINDING_CORRUPT_ROW: ${fields}`);
}
```

- [ ] **Step 4: Normalize before transactions and implement explicit patch flags**

Extend `createBinding()` and `updateBinding()` inputs with:

```ts
transform?: ProviderBindingTransform | null;
deliveryHeaders?: DeliveryHeaders | null;
```

At the start of each function, before `getDialect()`, `getDatabase()`, or `withTransaction()`, prepare supplied values:

```ts
const normalizedTransform =
  input.transform === undefined || input.transform === null
    ? input.transform
    : normalizeProviderBindingTransform(input.transform);
if (normalizedTransform) validateProviderBindingTransform(normalizedTransform);

const normalizedHeaders =
  input.deliveryHeaders === undefined || input.deliveryHeaders === null
    ? input.deliveryHeaders
    : normalizeDeliveryHeaders(input.deliveryHeaders);
```

Add `transform` and `delivery_headers` to the create insert after `signing_secret`.
Use `normalizedTransform ? JSON.stringify(normalizedTransform) : null` and `JSON.stringify(normalizedHeaders ?? {})` as parameters `$8` and `$9`.

Use this exact update assignment and parameter order:

```sql
transform = CASE WHEN $5 = 1 THEN $6 ELSE transform END,
delivery_headers = CASE WHEN $7 = 1 THEN $8 ELSE delivery_headers END,
```

```ts
const transformSupplied = input.transform !== undefined;
const deliveryHeadersSupplied = input.deliveryHeaders !== undefined;
const updateParams = [
  input.codebaseId,
  input.eventRoute,
  input.eventTypes === undefined ? null : JSON.stringify(input.eventTypes),
  input.signingSecret ?? null,
  transformSupplied ? 1 : 0,
  transformSupplied && normalizedTransform !== null
    ? JSON.stringify(normalizedTransform)
    : null,
  deliveryHeadersSupplied ? 1 : 0,
  deliveryHeadersSupplied ? JSON.stringify(normalizedHeaders ?? {}) : null,
  input.provider,
  input.name,
  existing.binding_version,
  existing.state,
];
```

Update the `WHERE` placeholders to `$9`, `$10`, `$11`, and `$12`.
Leave the existing `COALESCE` assignments for `event_types` and `signing_secret` unchanged.
Leave rotate and disable SQL unchanged.

- [ ] **Step 5: Run binding tests and type check**

Run from `packages/core`:

```bash
bun test src/schemas/workflow-provider-binding.test.ts
bun test src/db/provider-bindings.test.ts
bun x tsc --noEmit
```

Expected: every command exits `0`.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/schemas/workflow-provider-binding.ts packages/core/src/schemas/workflow-provider-binding.test.ts packages/core/src/db/provider-bindings.ts packages/core/src/db/provider-bindings.test.ts
git commit -m "feat(core): persist provider-binding delivery config"
```

---

### Task 8: Initial Outbox Error Evidence

**Files:**

- Modify: `packages/core/src/db/workflow-event-outbox.ts`
- Modify: `packages/core/src/db/workflow-event-outbox.test.ts`

**Interfaces:**

- Produces: `InsertExternalWorkflowEventInput.last_error?: string | null` and insert-time persistence of that field.

- [ ] **Step 1: Add a failing initial-error test**

Add this test to `packages/core/src/db/workflow-event-outbox.test.ts`:

```ts
test('insertExternalWorkflowEvent persists an initial safe last_error', async () => {
  mockQuery.mockResolvedValueOnce(
    createQueryResult([
      outboxRow({
        status: 'not-routable',
        not_routable_reason: 'transform-failed',
        last_error: 'TRANSFORM_RESULT_INVALID',
        next_attempt_at: null,
      }),
    ])
  );
  await insertExternalWorkflowEvent(
    (sql, params) => mockQuery(sql, params) as ReturnType<typeof mockQuery>,
    {
      event_id: 'evt-1',
      idempotency_key: 'archon:workflow-engine-primary:evt-1',
      event_type: 'workflow.run.completed',
      workflow_run_id: 'run-1',
      event_body: '{"canonical":true}',
      status: 'not-routable',
      not_routable_reason: 'transform-failed',
      last_error: 'TRANSFORM_RESULT_INVALID',
      next_attempt_at: null,
    }
  );
  const [sql, params] = mockQuery.mock.calls[0] as [string, unknown[]];
  expect(sql).toContain('not_routable_reason, last_error, next_attempt_at');
  expect(params).toContain('TRANSFORM_RESULT_INVALID');
});
```

- [ ] **Step 2: Run the test and verify the type or SQL assertion fails**

Run from `packages/core`:

```bash
bun test src/db/workflow-event-outbox.test.ts
```

Expected: FAIL because `last_error` is not an accepted insert field and is absent from the insert SQL.

- [ ] **Step 3: Add `last_error` to the insert contract and SQL**

Add this field to `InsertExternalWorkflowEventInput`:

```ts
last_error?: string | null;
```

Change the insert column tail, placeholders, and parameters to:

```sql
binding_id, event_route, event_body, status, not_routable_reason, last_error, next_attempt_at)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
```

```ts
data.not_routable_reason ?? null,
data.last_error ?? null,
toDbTimestamp(data.next_attempt_at),
```

- [ ] **Step 4: Run the isolated outbox DB test and type check**

Run from `packages/core`:

```bash
bun test src/db/workflow-event-outbox.test.ts
bun x tsc --noEmit
```

Expected: both commands exit `0`.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/db/workflow-event-outbox.ts packages/core/src/db/workflow-event-outbox.test.ts
git commit -m "feat(core): persist initial outbox error evidence"
```

---

### Task 9: Enqueue-Time Transform And Durable Failure Evidence

**Files:**

- Modify: `packages/core/src/workflows/store-adapter.ts`
- Modify: `packages/core/src/workflows/store-adapter.test.ts`

**Interfaces:**

- Consumes: `transformWorkflowEventBody()`, `isProviderBindingTransformError()`, the canonical envelope builder, and `resolution.binding.transform`.
- Produces: one pending transformed outbox row or one non-routable transform-failure row.

- [ ] **Step 1: Add a controllable transform mock before importing the store adapter**

In `packages/core/src/workflows/store-adapter.test.ts`, before the dynamic import of `./store-adapter`, add:

```ts
class TestTransformError extends Error {
  readonly code: string;

  constructor(code: string) {
    super(code);
    this.code = code;
  }
}

const mockTransformWorkflowEventBody = mock(
  async (envelope: Record<string, unknown>, transform: unknown) => ({
    body: JSON.stringify(envelope),
    outputBytes: new TextEncoder().encode(JSON.stringify(envelope)).length,
    engine: transform ? ('jsonata' as const) : ('identity' as const),
    durationMs: 1,
  })
);
mock.module('../events/provider-binding-transform', () => ({
  transformWorkflowEventBody: mockTransformWorkflowEventBody,
  isProviderBindingTransformError: (error: unknown): boolean => error instanceof TestTransformError,
}));

const mockLogDebug = mock(() => {});
const mockLogWarn = mock(() => {});
const mockLogError = mock(() => {});
mock.module('@archon/paths', () => ({
  createLogger: mock(() => ({
    info: mock(() => {}),
    warn: mockLogWarn,
    error: mockLogError,
    debug: mockLogDebug,
    trace: mock(() => {}),
    fatal: mock(() => {}),
  })),
}));
```

In the existing `beforeEach()`, reset those mocks and restore the identity implementation shown above.
Extend the local `bindingRow()` with `transform: null` and `delivery_headers: {}`.

- [ ] **Step 2: Add failing ordering, exact-body, failure, and log tests**

Add these tests to `packages/core/src/workflows/store-adapter.test.ts`:

```ts
test('routable events call the transform once and persist its exact body', async () => {
  mockGetWorkflowRun.mockResolvedValueOnce(workflowRunRow());
  const configuredTransform = {
    engine: 'jsonata',
    expression: '{ "eventType": eventType }',
    timeoutMs: 50,
    stackDepth: 128,
    maxSequenceSize: 10_000,
    maxOutputBytes: 65_536,
  };
  mockResolveEventRoute.mockResolvedValueOnce({
    routable: true,
    codebase: codebaseRow(),
    binding: bindingRow({ transform: configuredTransform }),
    route: 'https://example.invalid/events',
    secret: 'test-secret',
  });
  mockTransformWorkflowEventBody.mockResolvedValueOnce({
    body: '{"eventType":"workflow.run.completed"}',
    outputBytes: 38,
    engine: 'jsonata',
    durationMs: 2,
  });
  const store = createWorkflowStore();
  await store.enqueueExternalWorkflowEvent({
    workflow_run_id: 'run-1',
    event_type: 'workflow.run.completed',
    occurred_at: '2026-08-18T00:00:00.000Z',
    payload: { state: 'completed', result: { outcome: 'accepted' } },
  });
  expect(mockTransformWorkflowEventBody).toHaveBeenCalledTimes(1);
  expect(mockTransformWorkflowEventBody.mock.calls[0]?.[1]).toEqual(configuredTransform);
  const [insert] = mockEnqueueExternalWorkflowEvent.mock.calls[0] as [Record<string, unknown>];
  expect(insert.event_body).toBe('{"eventType":"workflow.run.completed"}');
  expect(insert.status).toBe('pending');
});

test('event filtering happens before envelope transformation', async () => {
  mockGetWorkflowRun.mockResolvedValueOnce(workflowRunRow());
  mockResolveEventRoute.mockResolvedValueOnce({
    routable: true,
    codebase: codebaseRow(),
    binding: bindingRow({
      event_types: ['workflow.approval.requested'],
      transform: { engine: 'jsonata', expression: '$now()' },
    }),
    route: 'https://example.invalid/events',
    secret: 'test-secret',
  });
  await createWorkflowStore().enqueueExternalWorkflowEvent({
    workflow_run_id: 'run-1',
    event_type: 'workflow.run.started',
    occurred_at: '2026-08-18T00:00:00.000Z',
    payload: { state: 'running', startedAt: '2026-08-18T00:00:00.000Z' },
  });
  expect(mockTransformWorkflowEventBody).not.toHaveBeenCalled();
  expect(mockEnqueueExternalWorkflowEvent).not.toHaveBeenCalled();
});

test('classified failure stores canonical evidence and does not reject the workflow', async () => {
  mockGetWorkflowRun.mockResolvedValueOnce(workflowRunRow());
  mockResolveEventRoute.mockResolvedValueOnce({
    routable: true,
    codebase: codebaseRow(),
    binding: bindingRow({ transform: { engine: 'jsonata', expression: 'eventType' } }),
    route: 'https://example.invalid/events',
    secret: 'test-secret',
  });
  mockTransformWorkflowEventBody.mockRejectedValueOnce(
    new TestTransformError('TRANSFORM_RESULT_INVALID')
  );
  await expect(
    createWorkflowStore().enqueueExternalWorkflowEvent({
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
  expect(JSON.parse(insert.event_body as string)).toMatchObject({
    schemaVersion: 'workflow-event-envelope.v1',
    eventType: 'workflow.run.started',
  });
  const [fields] = mockLogWarn.mock.calls.find(
    call => call[1] === 'workflow_event_outbox_transform_failed'
  ) as [Record<string, unknown>, string];
  expect(fields).toEqual({
    bindingId: 'binding-1',
    eventType: 'workflow.run.started',
    engine: 'jsonata',
    durationMs: expect.any(Number),
    errorCode: 'TRANSFORM_RESULT_INVALID',
  });
  expect(JSON.stringify(fields)).not.toMatch(/expression|envelope|err/);
});
```

- [ ] **Step 3: Run the store test and verify red**

Run from `packages/core`:

```bash
bun test src/workflows/store-adapter.test.ts
```

Expected: FAIL because the transform function is never called and no `transform-failed` path exists.

- [ ] **Step 4: Transform once after the existing filter and canonical builder**

Import the two transform functions in `packages/core/src/workflows/store-adapter.ts`.
Replace only the current routable insert block after `buildWorkflowEventEnvelope()` with:

```ts
const transformStartedAt = Date.now();
try {
  const transformed = await transformWorkflowEventBody(
    envelope,
    resolution.binding.transform ?? null
  );
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
} catch (error) {
  if (!isProviderBindingTransformError(error)) throw error;
  getLog().warn(
    {
      bindingId: resolution.binding.id,
      eventType: envelope.eventType,
      engine: resolution.binding.transform?.engine ?? 'identity',
      durationMs: Math.max(0, Date.now() - transformStartedAt),
      errorCode: error.code,
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
    last_error: error.code,
    next_attempt_at: null,
  });
}
```

Keep the function's existing outer best-effort `catch` unchanged so unexpected errors and swallowed outbox-write failures remain non-fatal to workflow execution.

- [ ] **Step 5: Run orchestration and real transform tests separately**

Run from `packages/core`:

```bash
bun test src/workflows/store-adapter.test.ts
bun test src/events/provider-binding-transform.test.ts
bun test src/events/workflow-event-envelope.test.ts
bun x tsc --noEmit
```

Expected: every command exits `0`.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/workflows/store-adapter.ts packages/core/src/workflows/store-adapter.test.ts
git commit -m "feat(core): transform workflow events before outbox persistence"
```

---

### Task 10: Dispatcher Header Merge, Redaction, And Stored-Body Retry HMAC

**Files:**

- Modify: `packages/server/src/workflow-events/dispatcher.ts`
- Modify: `packages/server/src/workflow-events/dispatcher.test.ts`

**Interfaces:**

- Consumes: private binding reads, delivery-header helpers, and `row.event_body`.
- Produces: validated request headers, redacted attempt evidence, byte-identical retry bodies, and terminal `unsafe-delivery-headers` outcomes.

- [ ] **Step 1: Expose logger spies and add failing dispatcher tests**

In `packages/server/src/workflow-events/dispatcher.test.ts`, replace the anonymous logger mocks with named `mockLogWarn` and reset it in `beforeEach()`.
Make the default private binding mock return `{ signing_secret: 'test-secret', delivery_headers: {} }`.
Add these tests:

```ts
test('initial delivery and retry sign and send the same stored transformed body', async () => {
  const body = '{"receiver":"shape"}';
  mockClaimDueOutboxEvents
    .mockResolvedValueOnce([outboxRow({ event_body: body, attempt_count: 0 })])
    .mockResolvedValueOnce([outboxRow({ event_body: body, attempt_count: 1 })]);
  const fetchImpl = mock(async () => new Response('retry', { status: 500 }));
  const dispatcher = new WorkflowEventDispatcher({
    now: () => fixedNow,
    fetchImpl,
    enqueueDeliveryFailed: mockStoreEnqueueExternalWorkflowEvent,
  });
  await dispatcher.drainNow();
  await dispatcher.drainNow();
  expect(fetchImpl).toHaveBeenCalledTimes(2);
  for (const [, request] of fetchImpl.mock.calls as Array<[string, RequestInit]>) {
    const headers = request.headers as Record<string, string>;
    expect(request.body).toBe(body);
    expect(headers['X-Webhook-Signature-V2']).toBe(
      createHmac('sha256', 'test-secret')
        .update(`${Math.floor(fixedNow.getTime() / 1000)}.${body}`)
        .digest('hex')
    );
  }
});

test('valid receiver headers reach HTTP and attempt evidence redacts their values', async () => {
  mockGetBindingByIdWithSecret.mockResolvedValueOnce({
    signing_secret: 'test-secret',
    delivery_headers: { Authorization: 'Bearer secret' },
  });
  mockClaimDueOutboxEvents.mockResolvedValueOnce([outboxRow()]);
  const fetchImpl = mock(async () => new Response('', { status: 204 }));
  await new WorkflowEventDispatcher({ now: () => fixedNow, fetchImpl }).drainNow();
  const [, request] = fetchImpl.mock.calls[0] as [string, RequestInit];
  expect((request.headers as Record<string, string>).Authorization).toBe('Bearer secret');
  const pendingRequest = mockInsertPendingAttempt.mock.calls[0]?.[2] as {
    headers: Record<string, string>;
  };
  expect(pendingRequest.headers.Authorization).toBe('[REDACTED]');
  expect(pendingRequest.headers['Content-Type']).toBe('application/json');
  expect(JSON.stringify(pendingRequest.headers)).not.toContain('Bearer secret');
});

test('unsafe parsed headers block HTTP and persist a safe terminal outcome', async () => {
  mockGetBindingByIdWithSecret.mockResolvedValueOnce({
    signing_secret: 'test-secret',
    delivery_headers: { 'Content-Type': 'text/plain' },
  });
  mockClaimDueOutboxEvents.mockResolvedValueOnce([outboxRow()]);
  const fetchImpl = mock(async () => new Response('', { status: 204 }));
  await new WorkflowEventDispatcher({ now: () => fixedNow, fetchImpl }).drainNow();
  expect(fetchImpl).not.toHaveBeenCalled();
  expect(mockInsertPendingAttempt).not.toHaveBeenCalled();
  expect(mockUpdateOutboxAfterAttempt.mock.calls[0]?.[1]).toMatchObject({
    status: 'terminal-failure',
    attempt_count: 0,
    next_attempt_at: null,
    last_error: 'unsafe-delivery-headers',
  });
  const [fields] = mockLogWarn.mock.calls.find(
    call => call[1] === 'workflow_events.unsafe_delivery_headers'
  ) as [Record<string, unknown>, string];
  expect(fields).toEqual({ bindingId: 'wpb-1', outboxEventId: 'outbox-1' });
  expect(JSON.stringify(fields)).not.toMatch(/Authorization|Bearer|secret|Content-Type/);
});

test('corrupt delivery_headers JSON from the private parser has the same safe terminal outcome', async () => {
  mockGetBindingByIdWithSecret.mockRejectedValueOnce(
    new Error('BINDING_CORRUPT_ROW: delivery_headers')
  );
  mockClaimDueOutboxEvents.mockResolvedValueOnce([outboxRow()]);
  const fetchImpl = mock(async () => new Response('', { status: 204 }));
  await new WorkflowEventDispatcher({ now: () => fixedNow, fetchImpl }).drainNow();
  expect(fetchImpl).not.toHaveBeenCalled();
  expect(mockUpdateOutboxAfterAttempt.mock.calls[0]?.[1]).toMatchObject({
    status: 'terminal-failure',
    last_error: 'unsafe-delivery-headers',
  });
});
```

- [ ] **Step 2: Run the dispatcher test and verify red**

Run from `packages/server`:

```bash
bun test src/workflow-events/dispatcher.test.ts
```

Expected: FAIL because private receiver headers are neither validated nor read.

- [ ] **Step 3: Validate before attempt insertion and keep request/evidence maps separate**

Import `buildDeliveryHeaderEvidence`, `mergeDeliveryHeaders`, `UNSAFE_DELIVERY_HEADERS`, and `validateDeliveryHeaders` from `@archon/core/events/delivery-headers`.

In `deliver()`, define this local helper after the missing-route branch and before the private binding lookup:

```ts
const terminalUnsafeHeaders = async (): Promise<void> => {
  log.warn(
    { bindingId: row.binding_id, outboxEventId: row.id },
    'workflow_events.unsafe_delivery_headers'
  );
  await updateOutboxAfterAttempt(row.id, {
    status: 'terminal-failure',
    attempt_count: row.attempt_count,
    last_attempt_at: this.now(),
    next_attempt_at: null,
    last_error: UNSAFE_DELIVERY_HEADERS,
  });
};
```

Replace the current private binding lookup with this exact fail-closed branch:

```ts
let binding: Awaited<ReturnType<typeof getBindingByIdWithSecret>>;
try {
  binding = await getBindingByIdWithSecret(row.binding_id);
} catch (error) {
  if (
    error instanceof Error &&
    error.message === 'BINDING_CORRUPT_ROW: delivery_headers'
  ) {
    await terminalUnsafeHeaders();
    return;
  }
  throw error;
}
```

This exact-message branch converts only corrupt private header JSON to the safe terminal outcome.
Rethrow every other private-binding lookup error so the existing drain failure behavior remains unchanged.

After the current missing-secret check and before computing `startedAt`, validate `binding.delivery_headers ?? {}` with this branch:

```ts
const receiverHeaders = binding.delivery_headers ?? {};
try {
  validateDeliveryHeaders(receiverHeaders);
} catch {
  await terminalUnsafeHeaders();
  return;
}
```

Keep signature generation over `row.event_body` unchanged.
Rename the current `headers` object to `archonHeaders`, then create separate maps:

```ts
const requestHeaders = mergeDeliveryHeaders(archonHeaders, receiverHeaders);
const evidenceHeaders = buildDeliveryHeaderEvidence(archonHeaders, receiverHeaders);
```

Pass `evidenceHeaders` to `insertPendingAttempt()`.
Pass `requestHeaders` and the unchanged `row.event_body` to `post()`.

- [ ] **Step 4: Run dispatcher tests and server type check**

Run from `packages/server`:

```bash
bun test src/workflow-events/dispatcher.test.ts
bun x tsc --noEmit
```

Expected: both commands exit `0`.

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/workflow-events/dispatcher.ts packages/server/src/workflow-events/dispatcher.test.ts
git commit -m "feat(server): deliver private receiver headers safely"
```

---

### Task 11: CLI Create And Update File Inputs

**Files:**

- Modify: `packages/cli/src/cli.ts`
- Modify: `packages/cli/src/commands/provider-binding.ts`
- Modify: `packages/cli/src/commands/provider-binding.test.ts`
- Modify: `packages/cli/src/commands/provider-binding.e2e.test.ts`

**Interfaces:**

- Consumes: `--transform-file <path>` and `--receiver-headers-file <path>`.
- Produces: `transformFile?: string`, `receiverHeadersFile?: string`, safe file errors, and correct create/update `undefined` versus `null` behavior.

- [ ] **Step 1: Add failing unit tests for file semantics and privacy**

Add `mkdtempSync`, `writeFileSync`, and `rmSync` imports to `packages/cli/src/commands/provider-binding.test.ts`.
Add this helper and tests:

```ts
function withJsonFiles(
  transform: unknown,
  headers: unknown
): { dir: string; transformFile: string; headersFile: string } {
  const dir = mkdtempSync(join(tmpdir(), 'archon-binding-files-'));
  const transformFile = join(dir, 'transform.json');
  const headersFile = join(dir, 'headers.json');
  writeFileSync(transformFile, JSON.stringify(transform));
  writeFileSync(headersFile, JSON.stringify(headers));
  return { dir, transformFile, headersFile };
}

test('create reads, normalizes, validates, and passes both files without echoing secrets', async () => {
  const files = withJsonFiles(
    { engine: 'jsonata', expression: '{ "ok": true }' },
    { Authorization: 'Bearer secret' }
  );
  try {
    mockCreateBinding.mockClear();
    const logs: string[] = [];
    await providerBindingCreateCommand(
      {
        provider: 'archon',
        name: 'workflow-engine-primary',
        projectRef: 'workflow-engine',
        route: 'https://example.invalid/events',
        transformFile: files.transformFile,
        receiverHeadersFile: files.headersFile,
      },
      { json: true, log: line => logs.push(line) }
    );
    expect(mockCreateBinding).toHaveBeenCalledWith(
      expect.objectContaining({
        transform: expect.objectContaining({
          engine: 'jsonata',
          timeoutMs: 50,
          stackDepth: 128,
          maxSequenceSize: 10_000,
          maxOutputBytes: 65_536,
        }),
        deliveryHeaders: { Authorization: 'Bearer secret' },
      })
    );
    expect(logs).toHaveLength(1);
    expect(logs[0]).not.toContain(files.transformFile);
    expect(logs[0]).not.toContain(files.headersFile);
    expect(logs[0]).not.toContain('Bearer secret');
  } finally {
    rmSync(files.dir, { recursive: true, force: true });
  }
});

test('update omission preserves fields while JSON null supplies explicit clears', async () => {
  mockUpdateBinding.mockClear();
  await providerBindingUpdateCommand(
    {
      provider: 'archon',
      name: 'workflow-engine-primary',
      projectRef: 'workflow-engine',
      route: 'https://example.invalid/events',
    },
    { json: true, log: () => {} }
  );
  expect(mockUpdateBinding.mock.calls[0]?.[0]).not.toHaveProperty('transform');
  expect(mockUpdateBinding.mock.calls[0]?.[0]).not.toHaveProperty('deliveryHeaders');

  const files = withJsonFiles(null, null);
  try {
    await providerBindingUpdateCommand(
      {
        provider: 'archon',
        name: 'workflow-engine-primary',
        projectRef: 'workflow-engine',
        route: 'https://example.invalid/events',
        transformFile: files.transformFile,
        receiverHeadersFile: files.headersFile,
      },
      { json: true, log: () => {} }
    );
    expect(mockUpdateBinding.mock.calls[1]?.[0]).toMatchObject({
      transform: null,
      deliveryHeaders: null,
    });
  } finally {
    rmSync(files.dir, { recursive: true, force: true });
  }
});

test('invalid JSON, a disallowed transform, and unsafe headers fail before any DB call', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'archon-binding-files-'));
  const invalidJson = join(dir, 'invalid.json');
  const disallowed = join(dir, 'disallowed.json');
  const unsafe = join(dir, 'unsafe.json');
  writeFileSync(invalidJson, '{');
  writeFileSync(disallowed, JSON.stringify({ engine: 'jsonata', expression: '$now()' }));
  writeFileSync(unsafe, JSON.stringify({ Authorization: 'Bearer\nsecret' }));
  try {
    for (const args of [
      { transformFile: invalidJson },
      { transformFile: disallowed },
      { receiverHeadersFile: unsafe },
    ]) {
      mockCreateBinding.mockClear();
      const logs: string[] = [];
      const exitCode = await providerBindingCreateCommand(
        {
          provider: 'archon',
          name: 'workflow-engine-primary',
          projectRef: 'workflow-engine',
          route: 'https://example.invalid/events',
          ...args,
        },
        { json: true, log: line => logs.push(line) }
      );
      expect(exitCode).not.toBe(0);
      expect(mockCreateBinding).not.toHaveBeenCalled();
      expect(logs).toHaveLength(1);
      expect(logs[0]).not.toContain(dir);
      expect(logs[0]).not.toMatch(/\$now|Bearer|secret/);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Add failing subprocess parsing cases**

In `packages/cli/src/commands/provider-binding.e2e.test.ts`, add one table-driven test that invokes malformed create commands from a non-git temp directory with each new flag before `--json`.
Assert one JSON line, a nonzero exit, and empty stderr.
Include cases where `--transform-file` or `--receiver-headers-file` has no value so the normalization shim must insert an empty string instead of consuming `--json`.

Use this exact case table:

```ts
for (const flag of ['--transform-file', '--receiver-headers-file'] as const) {
  test(`${flag} is parsed as a string option and a missing value never swallows --json`, async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'archon-provider-binding-no-git-'));
    try {
      const result = await runCli(['provider-binding', 'create', flag, '--json'], cwd);
      expect(result.stdout.trim().split('\n').filter(Boolean)).toHaveLength(1);
      expect(JSON.parse(result.stdout.trim())).toMatchObject({ success: false });
      expect(result.exitCode).not.toBe(0);
      expect(result.stderr).toBe('');
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });
}
```

- [ ] **Step 3: Run the mock-heavy unit and subprocess files separately and verify red**

Run from `packages/cli`:

```bash
bun test src/commands/provider-binding.test.ts
bun test src/commands/provider-binding.e2e.test.ts
```

Expected: the unit test fails on missing `BindingArgs` fields and the subprocess test fails because the flags are not registered.

- [ ] **Step 4: Implement safe file loading before project resolution**

In `packages/cli/src/commands/provider-binding.ts`, extend `BindingArgs` with:

```ts
transformFile?: string;
receiverHeadersFile?: string;
```

Import `readFile` from `node:fs/promises`, the transform type/functions from `@archon/core/events/provider-binding-transform`, and the delivery-header type/function from `@archon/core/events/delivery-headers`.

Add a local safe error and loader that never stores the path or contents on the error:

```ts
class BindingFileInputError extends Error {
  readonly path: '/transform' | '/deliveryHeaders';
  readonly reason: 'unreadable' | 'invalid';

  constructor(path: '/transform' | '/deliveryHeaders', reason: 'unreadable' | 'invalid') {
    super('MALFORMED_REQUEST');
    this.path = path;
    this.reason = reason;
  }
}

async function readJsonFile(path: string, field: BindingFileInputError['path']): Promise<unknown> {
  let source: string;
  try {
    source = await readFile(path, 'utf8');
  } catch {
    throw new BindingFileInputError(field, 'unreadable');
  }
  try {
    return JSON.parse(source) as unknown;
  } catch {
    throw new BindingFileInputError(field, 'invalid');
  }
}

async function loadBindingFiles(args: BindingArgs): Promise<{
  transform: ProviderBindingTransform | null | undefined;
  deliveryHeaders: DeliveryHeaders | null | undefined;
}> {
  let transform: ProviderBindingTransform | null | undefined;
  if (args.transformFile !== undefined) {
    const value = await readJsonFile(args.transformFile, '/transform');
    if (value === null) {
      transform = null;
    } else {
      transform = normalizeProviderBindingTransform(value);
      validateProviderBindingTransform(transform);
    }
  }
  let deliveryHeaders: DeliveryHeaders | null | undefined;
  if (args.receiverHeadersFile !== undefined) {
    const value = await readJsonFile(args.receiverHeadersFile, '/deliveryHeaders');
    if (value === null) {
      deliveryHeaders = null;
    } else {
      try {
        deliveryHeaders = normalizeDeliveryHeaders(value);
      } catch {
        throw new BindingFileInputError('/deliveryHeaders', 'invalid');
      }
    }
  }
  return { transform, deliveryHeaders };
}
```

Teach `classifyError()` to recognize `ProviderBindingTransformError` before the generic timeout branch.
Return the exact transform code, category `timeout` only for `TRANSFORM_TIMEOUT`, `retryable: false`, and exit `69` or `64` as defined in Global Constraints.

In create and update, call `loadBindingFiles()` after basic required-field validation but before `resolveProjectRef()`.
Catch `BindingFileInputError` and emit `MALFORMED_REQUEST` with `fieldErrors: [{ path: error.path, code: error.reason }]`.
This conversion is required for delivery-header validation because `normalizeDeliveryHeaders()` intentionally throws only the constant private error `unsafe-delivery-headers`; the CLI must expose that failure as a safe malformed file field, not as `INTERNAL_ERROR`.
Catch other errors with the existing classified envelope path.

For create, add only non-null values:

```ts
...(files.transform ? { transform: files.transform } : {}),
...(files.deliveryHeaders ? { deliveryHeaders: files.deliveryHeaders } : {}),
```

For update, preserve omitted fields and include explicit nulls:

```ts
...(files.transform !== undefined ? { transform: files.transform } : {}),
...(files.deliveryHeaders !== undefined
  ? { deliveryHeaders: files.deliveryHeaders }
  : {}),
```

In `packages/cli/src/cli.ts`, add both flags to `normalizeProviderBindingArgs()`'s `stringOptions`, add both as `type: 'string'` options in `parseArgs()`, and pass them into `bindingArgs`.

- [ ] **Step 5: Run CLI unit tests, E2E tests, and type check separately**

Run from `packages/cli`:

```bash
bun test src/commands/provider-binding.test.ts
bun test src/commands/provider-binding.e2e.test.ts
bun x tsc --noEmit
```

Expected: every command exits `0`.

- [ ] **Step 6: Commit**

```bash
git add packages/cli/src/cli.ts packages/cli/src/commands/provider-binding.ts packages/cli/src/commands/provider-binding.test.ts packages/cli/src/commands/provider-binding.e2e.test.ts
git commit -m "feat(cli): accept provider-binding delivery config files"
```

---

### Task 12: Side-Effect-Free `provider-binding test` Command

**Files:**

- Create: `packages/cli/src/commands/provider-binding-test.ts`
- Create: `packages/cli/src/commands/provider-binding-test.test.ts`
- Create: `_bmad-output/planning-artifacts/contracts/workflow-commander/examples/providers/archon/commands/binding-test-success.json`
- Modify: `packages/cli/src/commands/workflow-provider-command-envelope.ts`
- Modify: `packages/cli/src/commands/workflow-provider-command-envelope.test.ts`
- Modify: `packages/cli/src/cli.ts`
- Modify: `packages/cli/package.json`
- Modify: `_bmad-output/planning-artifacts/contracts/workflow-commander/schemas/workflow-command-envelope.schema.json`
- Modify: `_bmad-output/planning-artifacts/contracts/workflow-commander/validate_contracts.py`

**Interfaces:**

- Consumes: `--transform-file`, `--envelope-file`, the canonical envelope schema, transform normalization, and enqueue-identical evaluation.
- Produces: additive `binding.test` command contract and success result `{ operation: 'test', engine: 'jsonata', transformedBody: string, outputBytes: number }`.

- [ ] **Step 1: Write the failing side-effect-free command tests**

Create `packages/cli/src/commands/provider-binding-test.test.ts`:

```ts
import { describe, expect, spyOn, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { providerBindingTestCommand } from './provider-binding-test';

function sampleEnvelope(): Record<string, unknown> {
  return {
    schemaVersion: 'workflow-event-envelope.v1',
    provider: 'archon',
    eventId: 'evt-test',
    eventType: 'workflow.run.started',
    occurredAt: '2026-08-18T00:00:00.000Z',
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
    idempotencyKey: 'archon:workflow-engine-primary:evt-test',
    payload: { state: 'running', startedAt: '2026-08-18T00:00:00.000Z' },
  };
}

test('returns the exact transformed string, byte length, and sample bindingRef', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'archon-binding-test-'));
  const transformFile = join(dir, 'transform.json');
  const envelopeFile = join(dir, 'envelope.json');
  writeFileSync(
    transformFile,
    JSON.stringify({ engine: 'jsonata', expression: '{ "eventType": eventType }' })
  );
  writeFileSync(envelopeFile, JSON.stringify(sampleEnvelope()));
  try {
    const logs: string[] = [];
    const exitCode = await providerBindingTestCommand(
      { transformFile, envelopeFile, correlationId: 'corr-test' },
      { json: true, log: line => logs.push(line) }
    );
    expect(exitCode).toBe(0);
    expect(logs).toHaveLength(1);
    expect(JSON.parse(logs[0] as string)).toMatchObject({
      command: 'binding.test',
      success: true,
      correlationId: 'corr-test',
      bindingRef: (sampleEnvelope().bindingRef as Record<string, unknown>),
      result: {
        operation: 'test',
        engine: 'jsonata',
        transformedBody: '{"eventType":"workflow.run.started"}',
        outputBytes: 36,
      },
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('uses safe errors for null config, invalid envelope, and scalar output', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'archon-binding-test-'));
  const transformFile = join(dir, 'transform.json');
  const envelopeFile = join(dir, 'envelope.json');
  try {
    for (const testCase of [
      { transform: null, envelope: sampleEnvelope(), code: 'TRANSFORM_CONFIG_INVALID' },
      { transform: { engine: 'jsonata', expression: '{}' }, envelope: {}, code: 'MALFORMED_REQUEST' },
      { transform: { engine: 'jsonata', expression: 'eventType' }, envelope: sampleEnvelope(), code: 'TRANSFORM_RESULT_INVALID' },
    ]) {
      writeFileSync(transformFile, JSON.stringify(testCase.transform));
      writeFileSync(envelopeFile, JSON.stringify(testCase.envelope));
      const logs: string[] = [];
      const exitCode = await providerBindingTestCommand(
        { transformFile, envelopeFile },
        { json: true, log: line => logs.push(line) }
      );
      expect(exitCode).not.toBe(0);
      expect(JSON.parse(logs[0] as string)).toMatchObject({
        success: false,
        error: { code: testCase.code },
      });
      expect(logs[0]).not.toContain(dir);
      expect(logs[0]).not.toContain('workflow-event-envelope.v1');
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('maps a deterministic evaluator timeout to exit 69 without input leakage', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'archon-binding-test-'));
  const transformFile = join(dir, 'transform.json');
  const envelopeFile = join(dir, 'envelope.json');
  writeFileSync(
    transformFile,
    JSON.stringify({
      engine: 'jsonata',
      expression: '{ "n": [1..20] }',
      timeoutMs: 1,
      maxSequenceSize: 100,
    })
  );
  writeFileSync(envelopeFile, JSON.stringify(sampleEnvelope()));
  let now = 0;
  const dateNow = spyOn(Date, 'now').mockImplementation(() => {
    now += 10;
    return now;
  });
  try {
    const logs: string[] = [];
    const exitCode = await providerBindingTestCommand(
      { transformFile, envelopeFile },
      { json: true, log: line => logs.push(line) }
    );
    expect(exitCode).toBe(69);
    expect(logs).toHaveLength(1);
    expect(JSON.parse(logs[0] as string)).toMatchObject({
      success: false,
      error: {
        code: 'TRANSFORM_TIMEOUT',
        category: 'timeout',
        retryable: false,
      },
      execution: { exitCode: 69, timedOut: true },
    });
    expect(logs[0]).not.toContain(dir);
    expect(logs[0]).not.toContain('[1..20]');
  } finally {
    dateNow.mockRestore();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('source has no DB, outbox, or HTTP dependency', () => {
  const source = readFileSync(join(import.meta.dir, 'provider-binding-test.ts'), 'utf8');
  expect(source).not.toContain('@archon/core/db');
  expect(source).not.toContain('createBinding');
  expect(source).not.toContain('enqueueExternalWorkflowEvent');
  expect(source).not.toMatch(/\bfetch\s*\(/);
});
```

In `packages/cli/src/commands/workflow-provider-command-envelope.test.ts`, add this syntax entry to `PROVIDER_CLI_SYNTAX_BASELINE`:

```ts
'binding.test':
  'archon provider-binding test --transform-file <path> --envelope-file <path> --json',
```

Change all three command-family length assertions currently set to `12` to `13`.
Update the corresponding test names and comments from “12 command families” to “13 command families”.
Add `{ fixture: 'binding-test-success.json', refKind: 'bindingRef' }` to `REPRESENTATIVE_COMMAND_FAMILIES` after the `binding-disable-success.json` entry.
Delete the complete `3.3A-CONTRACT-048 — command contract package is never edited to fit runtime` test block that runs `git diff --quiet`.
That historical story guard rejects every authorized contract evolution while files are uncommitted; the source/schema equality tests, exact fixture reproduction, fixture inventory, and canonical Python validator provide deterministic semantic protection for this approved additive change.

Create `_bmad-output/planning-artifacts/contracts/workflow-commander/examples/providers/archon/commands/binding-test-success.json`:

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

Add `'binding-test-success.json'` to `REQUIRED_COMMAND_EXAMPLES` in `_bmad-output/planning-artifacts/contracts/workflow-commander/validate_contracts.py`.

- [ ] **Step 2: Run the command and contract tests and verify both red reasons**

Run from `packages/cli`:

```bash
bun test src/commands/provider-binding-test.test.ts
bun test src/commands/workflow-provider-command-envelope.test.ts
```

Run from the repository root:

```bash
python3 _bmad-output/planning-artifacts/contracts/workflow-commander/validate_contracts.py
```

Expected: the new command test fails with `Cannot find module './provider-binding-test'`, and the contract checks fail because the source and schema enums do not yet contain the required `binding.test` fixture command.

- [ ] **Step 3: Extend the typed command set and implement the complete DB-free command**

Append `'binding.test'` after `'binding.disable'` in both `WORKFLOW_PROVIDER_COMMANDS` and `BINDING_COMMANDS` in `packages/cli/src/commands/workflow-provider-command-envelope.ts`.
Do this before creating the new command module so the shared `EnvelopeMeta.command` type and binding success-envelope branch accept `binding.test` during this task's type check.

Append `"binding.test"` after `"binding.disable"` in both command enums in `_bmad-output/planning-artifacts/contracts/workflow-commander/schemas/workflow-command-envelope.schema.json`:

- `properties.command.enum`.
- The binding-success `allOf[].if.properties.command.enum`.

Do not change the result schema because its existing binding-success result shape is intentionally open and the new fixture locks the additive dry-run fields.

Create `packages/cli/src/commands/provider-binding-test.ts` with the following implementation:

```ts
import { readFile } from 'node:fs/promises';
import {
  workflowEventEnvelopeSchema,
  type WorkflowEventEnvelope,
} from '@archon/core/events/workflow-event-envelope';
import {
  ProviderBindingTransformError,
  normalizeProviderBindingTransform,
  transformWorkflowEventBody,
  type TransformErrorCode,
} from '@archon/core/events/provider-binding-transform';
import {
  buildErrorEnvelope,
  buildSuccessEnvelope,
  resolveCorrelationId,
  resolveIssuedAt,
  safeStringify,
  type EnvelopeMeta,
  type ErrorCategory,
} from './workflow-provider-command-envelope.js';

interface ProviderBindingTestArgs {
  transformFile?: string;
  envelopeFile?: string;
  correlationId?: string;
}

interface ProviderBindingTestOptions {
  json: boolean;
  log: (line: string) => void;
}

type InputPath = '/transform' | '/envelope';
type InputReason = 'required' | 'unreadable' | 'invalid';

class BindingTestInputError extends Error {
  readonly path: InputPath;
  readonly reason: InputReason;

  constructor(path: InputPath, reason: InputReason) {
    super('MALFORMED_REQUEST');
    this.path = path;
    this.reason = reason;
  }
}

function emitError(
  meta: EnvelopeMeta,
  opts: ProviderBindingTestOptions,
  startedAt: number,
  error: {
    code: string;
    category: ErrorCategory;
    exitCode: number;
    fieldErrors?: Array<{ path: InputPath; code: InputReason }>;
  }
): number {
  const details: Record<string, unknown> = { requestAccepted: false };
  if (error.fieldErrors !== undefined) details.fieldErrors = error.fieldErrors;
  opts.log(
    safeStringify(
      buildErrorEnvelope(
        meta,
        {
          code: error.code,
          category: error.category,
          retryable: false,
          details,
          exitCode: error.exitCode,
        },
        startedAt
      )
    )
  );
  return error.exitCode;
}

async function readRequiredJson(path: string, field: InputPath): Promise<unknown> {
  let source: string;
  try {
    source = await readFile(path, 'utf8');
  } catch {
    throw new BindingTestInputError(field, 'unreadable');
  }
  try {
    return JSON.parse(source) as unknown;
  } catch {
    throw new BindingTestInputError(field, 'invalid');
  }
}

function classifyTransformError(code: TransformErrorCode): {
  category: ErrorCategory;
  exitCode: number;
} {
  return code === 'TRANSFORM_TIMEOUT'
    ? { category: 'timeout', exitCode: 69 }
    : { category: 'provider_contract', exitCode: 64 };
}

export async function providerBindingTestCommand(
  args: ProviderBindingTestArgs,
  opts: ProviderBindingTestOptions
): Promise<number> {
  const startedAt = Date.now();
  const meta: EnvelopeMeta = {
    command: 'binding.test',
    provider: 'archon',
    correlationId: resolveCorrelationId(args.correlationId),
    issuedAt: resolveIssuedAt(),
  };
  const missing = [
    ...(args.transformFile === undefined || args.transformFile.trim() === ''
      ? [{ path: '/transform' as const, code: 'required' as const }]
      : []),
    ...(args.envelopeFile === undefined || args.envelopeFile.trim() === ''
      ? [{ path: '/envelope' as const, code: 'required' as const }]
      : []),
  ];
  if (missing.length > 0) {
    return emitError(meta, opts, startedAt, {
      code: 'MALFORMED_REQUEST',
      category: 'provider_contract',
      exitCode: 64,
      fieldErrors: missing,
    });
  }

  let rawTransform: unknown;
  let rawEnvelope: unknown;
  try {
    // The required-field branch above proves both optional arguments are non-blank strings.
    rawTransform = await readRequiredJson(args.transformFile as string, '/transform');
    rawEnvelope = await readRequiredJson(args.envelopeFile as string, '/envelope');
  } catch (error) {
    if (!(error instanceof BindingTestInputError)) {
      return emitError(meta, opts, startedAt, {
        code: 'INTERNAL_ERROR',
        category: 'implementation_defect',
        exitCode: 70,
      });
    }
    return emitError(meta, opts, startedAt, {
      code: 'MALFORMED_REQUEST',
      category: 'provider_contract',
      exitCode: 64,
      fieldErrors: [{ path: error.path, code: error.reason }],
    });
  }

  const envelopeResult = workflowEventEnvelopeSchema.safeParse(rawEnvelope);
  if (!envelopeResult.success) {
    return emitError(meta, opts, startedAt, {
      code: 'MALFORMED_REQUEST',
      category: 'provider_contract',
      exitCode: 64,
      fieldErrors: [{ path: '/envelope', code: 'invalid' }],
    });
  }
  const envelope: WorkflowEventEnvelope = envelopeResult.data;

  try {
    const transform = normalizeProviderBindingTransform(rawTransform);
    const transformed = await transformWorkflowEventBody(envelope, transform);
    opts.log(
      safeStringify(
        buildSuccessEnvelope(
          { ...meta, provider: envelope.provider },
          { bindingRef: envelope.bindingRef },
          {
            operation: 'test',
            engine: 'jsonata',
            transformedBody: transformed.body,
            outputBytes: transformed.outputBytes,
          }
        )
      )
    );
    return 0;
  } catch (error) {
    if (!(error instanceof ProviderBindingTransformError)) {
      return emitError(meta, opts, startedAt, {
        code: 'INTERNAL_ERROR',
        category: 'implementation_defect',
        exitCode: 70,
      });
    }
    const classified = classifyTransformError(error.code);
    return emitError(meta, opts, startedAt, {
      code: error.code,
      category: classified.category,
      exitCode: classified.exitCode,
    });
  }
}
```

This implementation maps absent or blank file flags to `required`, read failures to `unreadable`, JSON failures and canonical-envelope failures to `invalid`, and all three malformed input cases to exit `64`.
It maps null or schema-invalid transforms to `TRANSFORM_CONFIG_INVALID`, `TRANSFORM_TIMEOUT` to category `timeout` and exit `69`, and every other stable transform code to category `provider_contract` and exit `64`.
Every classified error is non-retryable and carries `details: { requestAccepted: false }` plus only safe field errors where applicable.
The implementation never logs a caught raw error and emits exactly one envelope line on every return path.

- [ ] **Step 4: Wire the CLI and prove no DB initialization in the subprocess test**

In `packages/cli/src/cli.ts`:

- Import `providerBindingTestCommand` from `./commands/provider-binding-test`.
- Add `--envelope-file` to the provider-binding string normalization set and to `parseArgs()`.
- Pass `transformFile`, `receiverHeadersFile`, and `envelopeFile` in `bindingArgs`.
- Dispatch `case 'test'` to `providerBindingTestCommand(bindingArgs, bindingOpts)`.
- Change the available subcommand text to `create, update, status, rotate, disable, test`.
- Add provider-binding create, update, and test syntax to `printUsage()`.
- Keep `provider-binding` in `noGitCommands`.

Extend the `runCli()` helper in `packages/cli/src/commands/provider-binding.e2e.test.ts` with an optional environment override.
Add a real dry-run test that sets `ARCHON_HOME` to a new temp directory and `DO_NOT_TRACK=1`, runs from a different non-git temp directory, parses the one success envelope, and asserts `join(archonHome, 'archon.db')` does not exist after exit.

Add `&& bun test src/commands/provider-binding-test.test.ts` as its own process in `packages/cli/package.json`.

- [ ] **Step 5: Run command, subprocess, and type tests separately**

Run from `packages/cli`:

```bash
bun test src/commands/provider-binding-test.test.ts
bun test src/commands/provider-binding.e2e.test.ts
bun test src/commands/workflow-provider-command-envelope.test.ts
bun x tsc --noEmit
```

Run from the repository root:

```bash
python3 _bmad-output/planning-artifacts/contracts/workflow-commander/validate_contracts.py
```

Expected: every command exits `0`.

- [ ] **Step 6: Commit**

```bash
git add packages/cli/src/commands/provider-binding-test.ts packages/cli/src/commands/provider-binding-test.test.ts packages/cli/src/commands/provider-binding.e2e.test.ts packages/cli/src/commands/workflow-provider-command-envelope.ts packages/cli/src/commands/workflow-provider-command-envelope.test.ts packages/cli/src/cli.ts packages/cli/package.json _bmad-output/planning-artifacts/contracts/workflow-commander/schemas/workflow-command-envelope.schema.json _bmad-output/planning-artifacts/contracts/workflow-commander/validate_contracts.py _bmad-output/planning-artifacts/contracts/workflow-commander/examples/providers/archon/commands/binding-test-success.json
git commit -m "feat(cli): add provider-binding transform dry run"
```

---

### Task 13: Operator Documentation And Final Contract Verification

**Files:**

- Modify: `packages/docs-web/src/content/docs/reference/cli.md`

**Interfaces:**

- Consumes: the implemented binding transform, private-header, enqueue, delivery, and dry-run behavior from Tasks 1–12.
- Produces: complete operator documentation without a receiver-specific contract.

- [ ] **Step 1: Document the full operator contract**

Add a `### provider-binding` section immediately after `### validate commands [name]` in `packages/docs-web/src/content/docs/reference/cli.md`.
Use one physical line per full Markdown sentence.
Include all of the following exact content:

- Create and update syntax with `--transform-file` and `--receiver-headers-file`.
- Dry-run syntax `archon provider-binding test --transform-file <path> --envelope-file <path> --json`.
- Omitted update flags preserve values.
- JSON `null` clears transform to SQL `NULL` and headers to `{}`.
- The transform input is only `workflow-event-envelope.v1`.
- Transform execution happens once before outbox persistence.
- Retries sign and send the stored bytes.
- Transform failures create non-routable `transform-failed` evidence and do not fail the workflow run.
- Defaults and caps: 32,768 expression bytes; 50/200 ms timeout; 128/512 stack; 10,000/100,000 sequence; 65,536/262,144 output bytes.
- The exact allowed function list from the approved design.
- Rejected aliases, dynamic calls, partials, function application, lambdas, transform expressions, regular expressions, `$eval`, `$now`, `$millis`, and `$random`.
- Top-level output must be an object or array.
- Header limits: 16 headers, 128 name bytes, 8,192 value bytes, and 32,768 aggregate value bytes.
- The exact reserved header list from the approved design.
- Receiver values are private and request-attempt evidence stores `[REDACTED]`.
- Archon's HMAC headers remain active.
- POSIX example `umask 077` or `chmod 0600 <file>`, followed by removing the secret file after a successful command.
- A provider-neutral JSONata example `{ "eventType": eventType, "runId": workflowRunRef.runId }`.

Do not document a receiver-specific body schema.

- [ ] **Step 2: Run contract, CLI, docs, and type validation**

Run from `packages/cli`:

```bash
bun test src/commands/workflow-provider-command-envelope.test.ts
bun test src/commands/provider-binding-contract.test.ts
bun test src/commands/provider-binding-test.test.ts
bun x tsc --noEmit
```

Run from the repository root:

```bash
python3 _bmad-output/planning-artifacts/contracts/workflow-commander/validate_contracts.py
bun run format:check
```

Expected: every command exits `0`.

- [ ] **Step 3: Commit**

```bash
git add packages/docs-web/src/content/docs/reference/cli.md
git commit -m "docs(cli): explain provider-binding transforms"
```

---

## Acceptance Criteria

- [ ] A binding with no transform persists the exact current `JSON.stringify(canonicalEnvelope)` bytes.
- [ ] A supplied transform is normalized, compiled, and AST-checked before create or update starts a transaction.
- [ ] The database stores every resolved transform default.
- [ ] Enqueue calls the transform once with only the canonical envelope and persists the returned string without reconstruction.
- [ ] Event-type filtering happens before envelope construction and transformation and creates no outbox row for a filtered event.
- [ ] A classified transform failure persists one non-routable row with reason `transform-failed`, the safe code in `last_error`, the canonical envelope body, and no next attempt.
- [ ] Transform or outbox failures never reject workflow execution.
- [ ] The canonical envelope schema rejects unrelated top-level and ref fields and selects the payload schema from `eventType`.
- [ ] The canonical builder's shape, key order, and identity serialization remain unchanged.
- [ ] Transform results reject scalar top-level values, non-JSON values, sparse arrays, cycles, non-plain objects, and oversized UTF-8 output.
- [ ] Shared non-cyclic object references are accepted.
- [ ] Timeout, stack, and sequence evaluator guardrails map to the approved stable codes.
- [ ] Invalid or reserved receiver headers fail before binding writes.
- [ ] Syntactically corrupt, structurally corrupt, or unsafe stored delivery headers prevent HTTP and terminally set `unsafe-delivery-headers`.
- [ ] Receiver headers cannot replace Archon-owned HMAC, request ID, content, host, length, or hop-by-hop headers.
- [ ] Initial delivery and retries HMAC-sign and send the exact stored `row.event_body` bytes.
- [ ] Delivery-attempt request evidence keeps Archon values and stores `[REDACTED]` for every receiver header value.
- [ ] Public create, update, get, and CLI status results contain no signing secret or receiver header map.
- [ ] Private binding reads return the receiver headers needed by the dispatcher.
- [ ] Omitted update files preserve transform and headers.
- [ ] JSON `null` update files clear transform to SQL `NULL` and headers to `{}`.
- [ ] Rotate and disable SQL do not assign or rewrite transform or delivery-header columns.
- [ ] `provider-binding test` works outside a Git repository, creates no Archon database, performs no outbox write or HTTP request, and emits one command envelope.
- [ ] The dry run returns the exact enqueue-identical transformed string and UTF-8 byte length.
- [ ] CLI failures contain no input file path, transform source, envelope dump, or receiver secret.
- [ ] `binding.test` is additive in the source command tuple, both JSON Schema enums, syntax baseline, required fixture list, and validator.
- [ ] Fresh SQLite, upgraded SQLite, PostgreSQL source SQL, dialect parity, and bundled schema checks all pass.
- [ ] Existing provider-binding command identifiers, success fixtures, and result shapes remain compatible.
- [ ] Operator docs cover syntax, defaults, caps, allowed functions, rejected constructs, clearing, failure evidence, reserved headers, redaction, HMAC coexistence, and restricted secret files without prescribing a receiver schema.

## Final Validation Commands

Run focused tests from their package directories so mock-heavy files remain isolated.

From `packages/core`:

```bash
bun test src/schemas/provider-binding-transform.test.ts
bun test src/schemas/workflow-provider-binding.test.ts
bun test src/events/provider-binding-transform.test.ts
bun test src/events/delivery-headers.test.ts
bun test src/events/workflow-event-envelope.test.ts
bun test src/db/provider-bindings.test.ts
bun test src/db/workflow-event-outbox.test.ts
bun test src/db/adapters/sqlite.test.ts
bun test src/db/adapters/postgres.test.ts
bun test src/db/provider-bindings-bundled-schema.test.ts
bun test src/workflows/store-adapter.test.ts
bun x tsc --noEmit
```

From `packages/server`:

```bash
bun test src/workflow-events/dispatcher.test.ts
bun x tsc --noEmit
```

From `packages/cli`:

```bash
bun test src/commands/provider-binding.test.ts
bun test src/commands/provider-binding-test.test.ts
bun test src/commands/provider-binding.e2e.test.ts
bun test src/commands/provider-binding-contract.test.ts src/commands/workflow-provider-command-envelope.test.ts
bun x tsc --noEmit
```

From the repository root:

```bash
bun run check:bundled-schema
python3 _bmad-output/planning-artifacts/contracts/workflow-commander/validate_contracts.py
bun run validate
```

Expected: every command exits `0` with no lint warnings, type errors, test failures, schema drift, bundled-schema drift, or formatting drift.

## Open Questions

There are no open questions.
The approved design and repository behavior determine every implementation choice in this plan.
