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
