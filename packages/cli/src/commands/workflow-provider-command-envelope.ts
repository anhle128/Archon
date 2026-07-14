export const WORKFLOW_PROVIDER_COMMANDS = [
  'workflow.start',
  'workflow.status',
  'workflow.approve',
  'workflow.reject',
  'workflow.resume',
  'workflow.retry',
  'workflow.cancel',
  'binding.create',
  'binding.update',
  'binding.status',
  'binding.rotate',
  'binding.disable',
] as const;

export type WorkflowProviderCommand = (typeof WORKFLOW_PROVIDER_COMMANDS)[number];

export const ERROR_CATEGORIES = [
  'configuration',
  'external_delay',
  'implementation_defect',
  'provider_contract',
  'security_rejection',
  'timeout',
  'unexpected_state',
] as const;

export type ErrorCategory = (typeof ERROR_CATEGORIES)[number];

const WORKFLOW_COMMANDS = new Set<string>([
  'workflow.start',
  'workflow.status',
  'workflow.approve',
  'workflow.reject',
  'workflow.resume',
  'workflow.retry',
  'workflow.cancel',
]);

const BINDING_COMMANDS = new Set<string>([
  'binding.create',
  'binding.update',
  'binding.status',
  'binding.rotate',
  'binding.disable',
]);

const VALID_COMMANDS = new Set<string>(WORKFLOW_PROVIDER_COMMANDS);
const VALID_CATEGORIES = new Set<string>(ERROR_CATEGORIES);

export interface EnvelopeMeta {
  provider: string;
  command: string;
  correlationId: string;
  issuedAt: string;
}

export function safeStringify(value: unknown): string {
  const seen = new WeakSet();
  return JSON.stringify(value, (_key: string, v: unknown): unknown => {
    if (typeof v === 'bigint') return v.toString();
    if (typeof v === 'function') return undefined;
    if (typeof v === 'object' && v !== null) {
      if (seen.has(v)) return '[Circular]';
      seen.add(v);
    }
    return v;
  });
}

export function resolveCorrelationId(supplied: string | undefined): string {
  if (supplied === undefined || supplied.trim().length === 0) return crypto.randomUUID();
  return supplied.trim();
}

export function resolveIssuedAt(): string {
  return new Date().toISOString();
}

export function buildSuccessEnvelope(
  meta: EnvelopeMeta,
  refs: Record<string, unknown>,
  result: Record<string, unknown>
): Record<string, unknown> {
  if (!VALID_COMMANDS.has(meta.command)) {
    throw new Error(`Invalid workflow provider command: ${meta.command}`);
  }

  const envelope: Record<string, unknown> = {
    schemaVersion: 'workflow-command-envelope.v1',
    intendedProducer: 'Archon',
    intendedConsumer: 'Hermes',
    owningSubproject: 'archon',
    provider: meta.provider,
    command: meta.command,
    correlationId: meta.correlationId,
    issuedAt: meta.issuedAt,
    success: true,
  };

  if (WORKFLOW_COMMANDS.has(meta.command)) {
    const workflowRunRef = refs.workflowRunRef;
    if (!workflowRunRef || typeof workflowRunRef !== 'object') {
      throw new Error(`Success envelope for ${meta.command} requires workflowRunRef`);
    }
    envelope.workflowRunRef = workflowRunRef;
  } else if (BINDING_COMMANDS.has(meta.command)) {
    const bindingRef = refs.bindingRef;
    if (!bindingRef || typeof bindingRef !== 'object') {
      throw new Error(`Success envelope for ${meta.command} requires bindingRef`);
    }
    envelope.bindingRef = bindingRef;
  }

  envelope.result = result;
  return envelope;
}

export function buildErrorEnvelope(
  meta: EnvelopeMeta,
  error: {
    code: string;
    category: string;
    retryable: boolean;
    details: Record<string, unknown>;
    exitCode: number | null;
  },
  startTime: number
): Record<string, unknown> {
  if (!VALID_COMMANDS.has(meta.command)) {
    throw new Error(`Invalid workflow provider command: ${meta.command}`);
  }
  if (!VALID_CATEGORIES.has(error.category)) {
    throw new Error(`Invalid error category: ${error.category}`);
  }

  return {
    schemaVersion: 'workflow-command-envelope.v1',
    intendedProducer: 'Archon',
    intendedConsumer: 'Hermes',
    owningSubproject: 'archon',
    provider: meta.provider,
    command: meta.command,
    correlationId: meta.correlationId,
    issuedAt: meta.issuedAt,
    success: false,
    error: {
      code: error.code,
      category: error.category,
      retryable: error.retryable,
      details: error.details,
    },
    execution: {
      exitCode: error.exitCode,
      timedOut: error.category === 'timeout',
      durationMs: Date.now() - startTime,
      stdoutRedacted: true,
      stderrRedacted: true,
    },
  };
}
