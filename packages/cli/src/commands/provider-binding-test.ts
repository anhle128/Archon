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
  log: (line: string) => void | Promise<void>;
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

async function emitError(
  meta: EnvelopeMeta,
  opts: ProviderBindingTestOptions,
  startedAt: number,
  error: {
    code: string;
    category: ErrorCategory;
    exitCode: number;
    fieldErrors?: { path: InputPath; code: InputReason }[];
  }
): Promise<number> {
  const details: Record<string, unknown> = { requestAccepted: false };
  if (error.fieldErrors !== undefined) details.fieldErrors = error.fieldErrors;
  await opts.log(
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
  const transformFile =
    args.transformFile !== undefined && args.transformFile.trim() !== ''
      ? args.transformFile
      : undefined;
  const envelopeFile =
    args.envelopeFile !== undefined && args.envelopeFile.trim() !== ''
      ? args.envelopeFile
      : undefined;
  if (transformFile === undefined || envelopeFile === undefined) {
    return await emitError(meta, opts, startedAt, {
      code: 'MALFORMED_REQUEST',
      category: 'provider_contract',
      exitCode: 64,
      fieldErrors: [
        ...(transformFile === undefined
          ? [{ path: '/transform' as const, code: 'required' as const }]
          : []),
        ...(envelopeFile === undefined
          ? [{ path: '/envelope' as const, code: 'required' as const }]
          : []),
      ],
    });
  }

  let rawTransform: unknown;
  let rawEnvelope: unknown;
  try {
    rawTransform = await readRequiredJson(transformFile, '/transform');
    rawEnvelope = await readRequiredJson(envelopeFile, '/envelope');
  } catch (error) {
    if (!(error instanceof BindingTestInputError)) {
      return await emitError(meta, opts, startedAt, {
        code: 'INTERNAL_ERROR',
        category: 'implementation_defect',
        exitCode: 70,
      });
    }
    return await emitError(meta, opts, startedAt, {
      code: 'MALFORMED_REQUEST',
      category: 'provider_contract',
      exitCode: 64,
      fieldErrors: [{ path: error.path, code: error.reason }],
    });
  }

  const envelopeResult = workflowEventEnvelopeSchema.safeParse(rawEnvelope);
  if (!envelopeResult.success) {
    return await emitError(meta, opts, startedAt, {
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
    await opts.log(
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
      return await emitError(meta, opts, startedAt, {
        code: 'INTERNAL_ERROR',
        category: 'implementation_defect',
        exitCode: 70,
      });
    }
    const classified = classifyTransformError(error.code);
    return await emitError(meta, opts, startedAt, {
      code: error.code,
      category: classified.category,
      exitCode: classified.exitCode,
    });
  }
}
