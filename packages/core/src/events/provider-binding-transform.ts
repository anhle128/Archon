import jsonata from 'jsonata';
import {
  JSONATA_EXPRESSION_MAX_BYTES,
  providerBindingTransformSchema,
  type ProviderBindingTransform,
} from '../schemas/provider-binding-transform';
import type { WorkflowEventEnvelope } from './workflow-event-envelope';

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
  if (!parsed.success || utf8Bytes(parsed.data.expression) > JSONATA_EXPRESSION_MAX_BYTES) {
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
  visitAst(compiled.ast(), new WeakSet());
  return compiled;
}

export function validateProviderBindingTransform(transform: ProviderBindingTransform): void {
  compileProviderBindingTransform(transform);
}

export interface TransformBodyResult {
  body: string;
  outputBytes: number;
  engine: 'identity' | 'jsonata';
  durationMs: number;
}

export function assertJsonTransformResult(value: unknown, activePath = new WeakSet()): void {
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
