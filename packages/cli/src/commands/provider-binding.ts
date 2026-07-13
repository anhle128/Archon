import {
  createBinding,
  updateBinding,
  rotateBinding,
  disableBinding,
  getBinding,
  deriveBindingId,
} from '@archon/core/db/provider-bindings';
import { getCodebaseById } from '@archon/core/db/codebases';
import { createLogger } from '@archon/paths';

let cachedLog: ReturnType<typeof createLogger> | undefined;
function getLog(): ReturnType<typeof createLogger> {
  if (!cachedLog) cachedLog = createLogger('cli.provider-binding');
  return cachedLog;
}

export const BINDING_STATUS_STATES = [
  'missing',
  'active',
  'disabled',
  'rotated',
  'stale',
  'conflicting',
] as const;

export type BindingStatusState = (typeof BINDING_STATUS_STATES)[number];

interface CommandOptions {
  json: boolean;
  log: (line: string) => void;
}

interface BindingArgs {
  provider?: string;
  name?: string;
  projectRef?: string;
  route?: string;
  correlationId?: string;
}

interface EnvelopeDeps {
  command: string;
  provider: string;
  correlationId: string;
  issuedAt: string;
}

interface ValidatedArgs {
  provider: string;
  name: string;
  projectRef: string;
  route: string;
}

function safeStringify(value: unknown): string {
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

function buildSuccessEnvelope(
  deps: EnvelopeDeps,
  bindingRef: Record<string, unknown>,
  result: Record<string, unknown>
): Record<string, unknown> {
  return {
    schemaVersion: 'workflow-command-envelope.v1',
    intendedProducer: 'Archon',
    intendedConsumer: 'Hermes',
    owningSubproject: 'archon',
    provider: deps.provider,
    command: deps.command,
    correlationId: deps.correlationId,
    issuedAt: deps.issuedAt,
    success: true,
    bindingRef,
    result,
  };
}

function buildErrorEnvelope(
  deps: EnvelopeDeps,
  error: {
    code: string;
    category: string;
    retryable: boolean;
    details: Record<string, unknown>;
    exitCode: number;
  },
  startTime: number
): Record<string, unknown> {
  return {
    schemaVersion: 'workflow-command-envelope.v1',
    intendedProducer: 'Archon',
    intendedConsumer: 'Hermes',
    owningSubproject: 'archon',
    provider: deps.provider,
    command: deps.command,
    correlationId: deps.correlationId,
    issuedAt: deps.issuedAt,
    success: false,
    error: {
      code: error.code,
      category: error.category,
      retryable: error.retryable,
      details: error.details,
    },
    execution: {
      exitCode: error.exitCode,
      timedOut: false,
      durationMs: Date.now() - startTime,
      stdoutRedacted: true,
      stderrRedacted: true,
    },
  };
}

function resolveCorrelationId(supplied: string | undefined): string {
  if (supplied === undefined || supplied.trim().length === 0) return crypto.randomUUID();
  return supplied.trim();
}

function resolveIssuedAt(): string {
  return new Date().toISOString();
}

function isBlank(v: string | undefined): boolean {
  return v === undefined || v.trim().length === 0;
}

function nonBlank(v: string | undefined, fallback: string): string {
  if (v === undefined || v.trim().length === 0) return fallback;
  return v.trim();
}

function classifyError(err: unknown): {
  code: string;
  category: string;
  retryable: boolean;
  exitCode: number;
} {
  const msg = err instanceof Error ? err.message : String(err);
  const errCode = (err as { code?: string })?.code;

  if (msg.includes('BINDING_ALREADY_EXISTS')) {
    return {
      code: 'BINDING_ALREADY_EXISTS',
      category: 'unexpected_state',
      retryable: false,
      exitCode: 78,
    };
  }
  if (msg.includes('BINDING_NOT_FOUND')) {
    return {
      code: 'BINDING_NOT_FOUND',
      category: 'unexpected_state',
      retryable: false,
      exitCode: 78,
    };
  }
  if (msg.includes('BINDING_DISABLED')) {
    return {
      code: 'BINDING_DISABLED',
      category: 'unexpected_state',
      retryable: false,
      exitCode: 78,
    };
  }
  if (errCode === 'ETIMEDOUT' || msg.includes('statement timeout') || msg.includes('timeout')) {
    return { code: 'COMMAND_TIMEOUT', category: 'timeout', retryable: true, exitCode: 69 };
  }
  return {
    code: 'INTERNAL_ERROR',
    category: 'implementation_defect',
    retryable: false,
    exitCode: 70,
  };
}

function buildBindingRef(
  provider: string,
  name: string,
  projectRef: string
): Record<string, unknown> {
  return {
    provider,
    name,
    bindingId: deriveBindingId(provider, name),
    projectRef: `project:${projectRef}`,
  };
}

function emitEnvelope(envelope: Record<string, unknown>, opts: CommandOptions): void {
  opts.log(safeStringify(envelope));
}

async function withFailClosed(
  command: string,
  args: BindingArgs,
  opts: CommandOptions,
  startTime: number,
  fn: () => Promise<void>
): Promise<void> {
  try {
    await fn();
  } catch (_error) {
    const provider = nonBlank(args.provider, 'archon');
    const correlationId = nonBlank(args.correlationId, crypto.randomUUID());
    emitEnvelope(
      buildErrorEnvelope(
        { command, provider, correlationId, issuedAt: new Date().toISOString() },
        {
          code: 'INTERNAL_ERROR',
          category: 'implementation_defect',
          retryable: false,
          details: { requestAccepted: false },
          exitCode: 70,
        },
        startTime
      ),
      opts
    );
  }
}

function validateAndExtract(
  args: BindingArgs,
  required: ('provider' | 'name' | 'projectRef' | 'route')[],
  deps: EnvelopeDeps,
  opts: CommandOptions,
  startTime: number
): ValidatedArgs | null {
  const fieldDefs: { path: string; value: string | undefined }[] = [];
  for (const key of required) {
    fieldDefs.push({ path: `/${key === 'projectRef' ? 'projectRef' : key}`, value: args[key] });
  }

  const fieldErrors: { path: string; code: string }[] = [];
  for (const f of fieldDefs) {
    if (isBlank(f.value)) {
      fieldErrors.push({ path: f.path, code: 'required' });
    }
  }
  if (fieldErrors.length > 0) {
    emitEnvelope(
      buildErrorEnvelope(
        deps,
        {
          code: 'MALFORMED_REQUEST',
          category: 'provider_contract',
          retryable: false,
          details: { fieldErrors, requestAccepted: false },
          exitCode: 64,
        },
        startTime
      ),
      opts
    );
    return null;
  }

  return {
    provider: args.provider ?? '',
    name: args.name ?? '',
    projectRef: args.projectRef ?? '',
    route: args.route ?? '',
  };
}

async function resolveProjectRef(
  projectRef: string,
  deps: EnvelopeDeps,
  opts: CommandOptions,
  startTime: number
): Promise<{ codebaseId: string } | null> {
  try {
    const codebase = await getCodebaseById(projectRef);
    if (!codebase) {
      emitEnvelope(
        buildErrorEnvelope(
          deps,
          {
            code: 'MALFORMED_REQUEST',
            category: 'provider_contract',
            retryable: false,
            details: {
              fieldErrors: [{ path: '/projectRef', code: 'unresolvable' }],
              requestAccepted: false,
            },
            exitCode: 64,
          },
          startTime
        ),
        opts
      );
      return null;
    }
    return { codebaseId: codebase.id };
  } catch (error) {
    const err = error as Error;
    getLog().error({ err, projectRef }, 'cli.provider_binding_codebase_lookup_failed');
    const classified = classifyError(err);
    emitEnvelope(
      buildErrorEnvelope(
        deps,
        {
          ...classified,
          details: { requestAccepted: false },
        },
        startTime
      ),
      opts
    );
    return null;
  }
}

export async function providerBindingCreateCommand(
  args: BindingArgs,
  opts: CommandOptions
): Promise<void> {
  const startTime = Date.now();
  await withFailClosed('binding.create', args, opts, startTime, async () => {
    const correlationId = resolveCorrelationId(args.correlationId);
    const issuedAt = resolveIssuedAt();
    const provider = nonBlank(args.provider, 'archon');
    const deps: EnvelopeDeps = { command: 'binding.create', provider, correlationId, issuedAt };

    const validated = validateAndExtract(
      args,
      ['provider', 'name', 'projectRef', 'route'],
      deps,
      opts,
      startTime
    );
    if (!validated) return;

    const resolved = await resolveProjectRef(validated.projectRef, deps, opts, startTime);
    if (!resolved) return;

    try {
      const row = await createBinding({
        provider: validated.provider,
        name: validated.name,
        codebaseId: resolved.codebaseId,
        eventRoute: validated.route,
      });

      emitEnvelope(
        buildSuccessEnvelope(
          deps,
          buildBindingRef(validated.provider, validated.name, resolved.codebaseId),
          {
            operation: 'create',
            state: row.state,
            created: true,
            bindingVersion: row.binding_version,
          }
        ),
        opts
      );
    } catch (error) {
      const classified = classifyError(error);
      const details: Record<string, unknown> = { requestAccepted: false };
      if (error instanceof Error && error.message.includes('BINDING_ALREADY_EXISTS')) {
        details.currentState = 'active';
        details.expectedStates = ['missing'];
        details.mutationApplied = false;
      }
      emitEnvelope(buildErrorEnvelope(deps, { ...classified, details }, startTime), opts);
    }
  });
}

export async function providerBindingUpdateCommand(
  args: BindingArgs,
  opts: CommandOptions
): Promise<void> {
  const startTime = Date.now();
  await withFailClosed('binding.update', args, opts, startTime, async () => {
    const correlationId = resolveCorrelationId(args.correlationId);
    const issuedAt = resolveIssuedAt();
    const provider = nonBlank(args.provider, 'archon');
    const deps: EnvelopeDeps = { command: 'binding.update', provider, correlationId, issuedAt };

    const validated = validateAndExtract(
      args,
      ['provider', 'name', 'projectRef', 'route'],
      deps,
      opts,
      startTime
    );
    if (!validated) return;

    const resolved = await resolveProjectRef(validated.projectRef, deps, opts, startTime);
    if (!resolved) return;

    try {
      const row = await updateBinding({
        provider: validated.provider,
        name: validated.name,
        codebaseId: resolved.codebaseId,
        eventRoute: validated.route,
      });

      emitEnvelope(
        buildSuccessEnvelope(
          deps,
          buildBindingRef(validated.provider, validated.name, resolved.codebaseId),
          {
            operation: 'update',
            state: row.state,
            updated: true,
            bindingVersion: row.binding_version,
          }
        ),
        opts
      );
    } catch (error) {
      const classified = classifyError(error);
      emitEnvelope(
        buildErrorEnvelope(deps, { ...classified, details: { requestAccepted: false } }, startTime),
        opts
      );
    }
  });
}

export async function providerBindingStatusCommand(
  args: BindingArgs,
  opts: CommandOptions
): Promise<void> {
  const startTime = Date.now();
  await withFailClosed('binding.status', args, opts, startTime, async () => {
    const correlationId = resolveCorrelationId(args.correlationId);
    const issuedAt = resolveIssuedAt();
    const provider = nonBlank(args.provider, 'archon');
    const deps: EnvelopeDeps = { command: 'binding.status', provider, correlationId, issuedAt };

    const validated = validateAndExtract(args, ['provider', 'name'], deps, opts, startTime);
    if (!validated) return;

    try {
      const row = await getBinding(validated.provider, validated.name);

      if (!row) {
        emitEnvelope(
          buildSuccessEnvelope(
            deps,
            buildBindingRef(validated.provider, validated.name, args.projectRef ?? ''),
            {
              operation: 'status',
              state: 'missing' as BindingStatusState,
              health: 'missing',
              checkedAt: new Date().toISOString(),
            }
          ),
          opts
        );
        return;
      }

      const knownStates = new Set<string>(BINDING_STATUS_STATES as unknown as string[]);
      if (!knownStates.has(row.state)) {
        emitEnvelope(
          buildErrorEnvelope(
            deps,
            {
              code: 'BINDING_CORRUPT_STATE',
              category: 'unexpected_state',
              retryable: false,
              details: { requestAccepted: false, observedState: row.state },
              exitCode: 78,
            },
            startTime
          ),
          opts
        );
        return;
      }

      const bindingProjectRef = row.codebase_id;
      const suppliedProjectRef = args.projectRef;

      if (suppliedProjectRef && suppliedProjectRef !== bindingProjectRef) {
        emitEnvelope(
          buildSuccessEnvelope(
            deps,
            buildBindingRef(validated.provider, validated.name, bindingProjectRef),
            {
              operation: 'status',
              state: 'conflicting' as BindingStatusState,
              health: 'conflicting',
              checkedAt: new Date().toISOString(),
              conflicts: [{ path: '/repositoryPath', code: 'path-mismatch' }],
            }
          ),
          opts
        );
        return;
      }

      const health = row.state === 'active' ? 'valid' : row.state;
      emitEnvelope(
        buildSuccessEnvelope(
          deps,
          buildBindingRef(validated.provider, validated.name, bindingProjectRef),
          {
            operation: 'status',
            state: row.state,
            health,
            checkedAt: new Date().toISOString(),
          }
        ),
        opts
      );
    } catch (error) {
      const classified = classifyError(error);
      emitEnvelope(
        buildErrorEnvelope(deps, { ...classified, details: { requestAccepted: false } }, startTime),
        opts
      );
    }
  });
}

export async function providerBindingRotateCommand(
  args: BindingArgs,
  opts: CommandOptions
): Promise<void> {
  const startTime = Date.now();
  await withFailClosed('binding.rotate', args, opts, startTime, async () => {
    const correlationId = resolveCorrelationId(args.correlationId);
    const issuedAt = resolveIssuedAt();
    const provider = nonBlank(args.provider, 'archon');
    const deps: EnvelopeDeps = { command: 'binding.rotate', provider, correlationId, issuedAt };

    const validated = validateAndExtract(args, ['provider', 'name'], deps, opts, startTime);
    if (!validated) return;

    try {
      const result = await rotateBinding(validated.provider, validated.name);
      const projectRef = result.codebase_id;

      emitEnvelope(
        buildSuccessEnvelope(
          deps,
          buildBindingRef(validated.provider, validated.name, projectRef),
          {
            operation: 'rotate',
            state: result.state,
            previousVersion: result.previousVersion,
            activeVersion: result.activeVersion,
          }
        ),
        opts
      );
    } catch (error) {
      const classified = classifyError(error);
      const details: Record<string, unknown> = { requestAccepted: false };
      if (error instanceof Error && error.message.includes('BINDING_DISABLED')) {
        details.currentState = 'disabled';
        details.expectedStates = ['active', 'rotated'];
        details.mutationApplied = false;
      }
      emitEnvelope(buildErrorEnvelope(deps, { ...classified, details }, startTime), opts);
    }
  });
}

export async function providerBindingDisableCommand(
  args: BindingArgs,
  opts: CommandOptions
): Promise<void> {
  const startTime = Date.now();
  await withFailClosed('binding.disable', args, opts, startTime, async () => {
    const correlationId = resolveCorrelationId(args.correlationId);
    const issuedAt = resolveIssuedAt();
    const provider = nonBlank(args.provider, 'archon');
    const deps: EnvelopeDeps = { command: 'binding.disable', provider, correlationId, issuedAt };

    const validated = validateAndExtract(args, ['provider', 'name'], deps, opts, startTime);
    if (!validated) return;

    try {
      const result = await disableBinding(validated.provider, validated.name);
      const projectRef = result.codebase_id;

      emitEnvelope(
        buildSuccessEnvelope(
          deps,
          buildBindingRef(validated.provider, validated.name, projectRef),
          {
            operation: 'disable',
            previousState: result.previousState,
            state: result.state,
          }
        ),
        opts
      );
    } catch (error) {
      const classified = classifyError(error);
      emitEnvelope(
        buildErrorEnvelope(deps, { ...classified, details: { requestAccepted: false } }, startTime),
        opts
      );
    }
  });
}
