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
import {
  safeStringify,
  resolveCorrelationId,
  resolveIssuedAt,
  buildSuccessEnvelope,
  buildErrorEnvelope,
} from './workflow-provider-command-envelope.js';
import type { EnvelopeMeta } from './workflow-provider-command-envelope.js';

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

interface ValidatedArgs {
  provider: string;
  name: string;
  projectRef: string;
  route: string;
}

const EXIT_SUCCESS = 0;
const EXIT_USAGE = 64;
const EXIT_SOFTWARE = 70;

function isBlank(v: string | undefined): boolean {
  return v === undefined || v.trim().length === 0;
}

function nonBlank(v: string | undefined, fallback: string): string {
  if (v === undefined || v.trim().length === 0) return fallback;
  return v.trim();
}

function normalizeProjectRef(projectRef: string): string {
  const trimmed = projectRef.trim();
  return trimmed.startsWith('project:') ? trimmed.slice('project:'.length) : trimmed;
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
  if (msg.includes('BINDING_CORRUPT_STATE')) {
    return {
      code: 'BINDING_CORRUPT_STATE',
      category: 'unexpected_state',
      retryable: false,
      exitCode: 78,
    };
  }
  if (msg.includes('BINDING_CORRUPT_ROW')) {
    return {
      code: 'BINDING_CORRUPT_ROW',
      category: 'unexpected_state',
      retryable: false,
      exitCode: 78,
    };
  }
  if (msg.includes('BINDING_CONCURRENT_MODIFICATION')) {
    return {
      code: 'BINDING_CONCURRENT_MODIFICATION',
      category: 'unexpected_state',
      retryable: true,
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
  projectRef?: string
): Record<string, unknown> {
  const bindingRef: Record<string, unknown> = {
    provider,
    name,
    bindingId: deriveBindingId(provider, name),
  };
  const normalizedProjectRef =
    projectRef === undefined || projectRef.trim().length === 0
      ? undefined
      : normalizeProjectRef(projectRef);
  if (normalizedProjectRef !== undefined && normalizedProjectRef.length > 0) {
    bindingRef.projectRef = `project:${normalizedProjectRef}`;
  }
  return bindingRef;
}

function emitEnvelope(envelope: Record<string, unknown>, opts: CommandOptions): void {
  opts.log(safeStringify(envelope));
}

async function withFailClosed(
  command: string,
  args: BindingArgs,
  opts: CommandOptions,
  startTime: number,
  fn: () => Promise<number>
): Promise<number> {
  try {
    return await fn();
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
    return EXIT_SOFTWARE;
  }
}

function validateAndExtract(
  args: BindingArgs,
  required: ('provider' | 'name' | 'projectRef' | 'route')[],
  deps: EnvelopeMeta,
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
    provider: args.provider?.trim() ?? '',
    name: args.name?.trim() ?? '',
    projectRef: args.projectRef === undefined ? '' : normalizeProjectRef(args.projectRef),
    route: args.route?.trim() ?? '',
  };
}

async function resolveProjectRef(
  projectRef: string,
  deps: EnvelopeMeta,
  opts: CommandOptions,
  startTime: number
): Promise<{ codebaseId: string } | number> {
  try {
    const normalizedProjectRef = normalizeProjectRef(projectRef);
    const codebase = await getCodebaseById(normalizedProjectRef);
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
      return EXIT_USAGE;
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
    return classified.exitCode;
  }
}

export async function providerBindingCreateCommand(
  args: BindingArgs,
  opts: CommandOptions
): Promise<number> {
  const startTime = Date.now();
  return await withFailClosed('binding.create', args, opts, startTime, async () => {
    const correlationId = resolveCorrelationId(args.correlationId);
    const issuedAt = resolveIssuedAt();
    const provider = nonBlank(args.provider, 'archon');
    const deps: EnvelopeMeta = { command: 'binding.create', provider, correlationId, issuedAt };

    const validated = validateAndExtract(
      args,
      ['provider', 'name', 'projectRef', 'route'],
      deps,
      opts,
      startTime
    );
    if (!validated) return EXIT_USAGE;

    const resolved = await resolveProjectRef(validated.projectRef, deps, opts, startTime);
    if (typeof resolved === 'number') return resolved;

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
          { bindingRef: buildBindingRef(validated.provider, validated.name, resolved.codebaseId) },
          {
            operation: 'create',
            state: row.state,
            created: true,
            bindingVersion: row.binding_version,
          }
        ),
        opts
      );
      return EXIT_SUCCESS;
    } catch (error) {
      const classified = classifyError(error);
      const details: Record<string, unknown> = { requestAccepted: false };
      if (error instanceof Error && error.message.includes('BINDING_ALREADY_EXISTS')) {
        const existing = await getBinding(validated.provider, validated.name).catch(() => null);
        details.currentState = existing?.state ?? 'unknown';
        details.expectedStates = ['missing'];
        details.mutationApplied = false;
      }
      emitEnvelope(buildErrorEnvelope(deps, { ...classified, details }, startTime), opts);
      return classified.exitCode;
    }
  });
}

export async function providerBindingUpdateCommand(
  args: BindingArgs,
  opts: CommandOptions
): Promise<number> {
  const startTime = Date.now();
  return await withFailClosed('binding.update', args, opts, startTime, async () => {
    const correlationId = resolveCorrelationId(args.correlationId);
    const issuedAt = resolveIssuedAt();
    const provider = nonBlank(args.provider, 'archon');
    const deps: EnvelopeMeta = { command: 'binding.update', provider, correlationId, issuedAt };

    const validated = validateAndExtract(
      args,
      ['provider', 'name', 'projectRef', 'route'],
      deps,
      opts,
      startTime
    );
    if (!validated) return EXIT_USAGE;

    const resolved = await resolveProjectRef(validated.projectRef, deps, opts, startTime);
    if (typeof resolved === 'number') return resolved;

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
          { bindingRef: buildBindingRef(validated.provider, validated.name, resolved.codebaseId) },
          {
            operation: 'update',
            state: row.state,
            updated: true,
            bindingVersion: row.binding_version,
          }
        ),
        opts
      );
      return EXIT_SUCCESS;
    } catch (error) {
      const classified = classifyError(error);
      const details: Record<string, unknown> = { requestAccepted: false };
      if (error instanceof Error && error.message.includes('BINDING_DISABLED')) {
        details.currentState = 'disabled';
        details.expectedStates = ['active', 'rotated'];
        details.mutationApplied = false;
      }
      emitEnvelope(buildErrorEnvelope(deps, { ...classified, details }, startTime), opts);
      return classified.exitCode;
    }
  });
}

export async function providerBindingStatusCommand(
  args: BindingArgs,
  opts: CommandOptions
): Promise<number> {
  const startTime = Date.now();
  return await withFailClosed('binding.status', args, opts, startTime, async () => {
    const correlationId = resolveCorrelationId(args.correlationId);
    const issuedAt = resolveIssuedAt();
    const provider = nonBlank(args.provider, 'archon');
    const deps: EnvelopeMeta = { command: 'binding.status', provider, correlationId, issuedAt };

    const validated = validateAndExtract(args, ['provider', 'name'], deps, opts, startTime);
    if (!validated) return EXIT_USAGE;

    let suppliedCodebaseId: string | undefined;
    if (!isBlank(args.projectRef)) {
      const resolved = await resolveProjectRef(args.projectRef ?? '', deps, opts, startTime);
      if (typeof resolved === 'number') return resolved;
      suppliedCodebaseId = resolved.codebaseId;
    }

    try {
      const row = await getBinding(validated.provider, validated.name);

      if (!row) {
        emitEnvelope(
          buildSuccessEnvelope(
            deps,
            { bindingRef: buildBindingRef(validated.provider, validated.name, suppliedCodebaseId) },
            {
              operation: 'status',
              state: 'missing' as BindingStatusState,
              health: 'missing',
              checkedAt: new Date().toISOString(),
            }
          ),
          opts
        );
        return EXIT_SUCCESS;
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
        return 78;
      }

      const bindingProjectRef = row.codebase_id;

      if (suppliedCodebaseId && suppliedCodebaseId !== bindingProjectRef) {
        emitEnvelope(
          buildSuccessEnvelope(
            deps,
            { bindingRef: buildBindingRef(validated.provider, validated.name, bindingProjectRef) },
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
        return EXIT_SUCCESS;
      }

      const health = row.state === 'active' ? 'valid' : row.state;
      emitEnvelope(
        buildSuccessEnvelope(
          deps,
          { bindingRef: buildBindingRef(validated.provider, validated.name, bindingProjectRef) },
          {
            operation: 'status',
            state: row.state,
            health,
            checkedAt: new Date().toISOString(),
          }
        ),
        opts
      );
      return EXIT_SUCCESS;
    } catch (error) {
      const classified = classifyError(error);
      const details: Record<string, unknown> = { requestAccepted: false };
      if (error instanceof Error && error.message.includes('BINDING_CORRUPT_STATE')) {
        details.observedState = error.message.split(':').slice(1).join(':').trim() || 'unknown';
      }
      emitEnvelope(buildErrorEnvelope(deps, { ...classified, details }, startTime), opts);
      return classified.exitCode;
    }
  });
}

export async function providerBindingRotateCommand(
  args: BindingArgs,
  opts: CommandOptions
): Promise<number> {
  const startTime = Date.now();
  return await withFailClosed('binding.rotate', args, opts, startTime, async () => {
    const correlationId = resolveCorrelationId(args.correlationId);
    const issuedAt = resolveIssuedAt();
    const provider = nonBlank(args.provider, 'archon');
    const deps: EnvelopeMeta = { command: 'binding.rotate', provider, correlationId, issuedAt };

    const validated = validateAndExtract(args, ['provider', 'name'], deps, opts, startTime);
    if (!validated) return EXIT_USAGE;

    try {
      const result = await rotateBinding(validated.provider, validated.name);
      const projectRef = result.codebase_id;

      emitEnvelope(
        buildSuccessEnvelope(
          deps,
          { bindingRef: buildBindingRef(validated.provider, validated.name, projectRef) },
          {
            operation: 'rotate',
            state: result.state,
            previousVersion: result.previousVersion,
            activeVersion: result.activeVersion,
          }
        ),
        opts
      );
      return EXIT_SUCCESS;
    } catch (error) {
      const classified = classifyError(error);
      const details: Record<string, unknown> = { requestAccepted: false };
      if (error instanceof Error && error.message.includes('BINDING_DISABLED')) {
        details.currentState = 'disabled';
        details.expectedStates = ['active', 'rotated'];
        details.mutationApplied = false;
      }
      emitEnvelope(buildErrorEnvelope(deps, { ...classified, details }, startTime), opts);
      return classified.exitCode;
    }
  });
}

export async function providerBindingDisableCommand(
  args: BindingArgs,
  opts: CommandOptions
): Promise<number> {
  const startTime = Date.now();
  return await withFailClosed('binding.disable', args, opts, startTime, async () => {
    const correlationId = resolveCorrelationId(args.correlationId);
    const issuedAt = resolveIssuedAt();
    const provider = nonBlank(args.provider, 'archon');
    const deps: EnvelopeMeta = { command: 'binding.disable', provider, correlationId, issuedAt };

    const validated = validateAndExtract(args, ['provider', 'name'], deps, opts, startTime);
    if (!validated) return EXIT_USAGE;

    try {
      const result = await disableBinding(validated.provider, validated.name);
      const projectRef = result.codebase_id;

      emitEnvelope(
        buildSuccessEnvelope(
          deps,
          { bindingRef: buildBindingRef(validated.provider, validated.name, projectRef) },
          {
            operation: 'disable',
            previousState: result.previousState,
            state: result.state,
          }
        ),
        opts
      );
      return EXIT_SUCCESS;
    } catch (error) {
      const classified = classifyError(error);
      emitEnvelope(
        buildErrorEnvelope(deps, { ...classified, details: { requestAccepted: false } }, startTime),
        opts
      );
      return classified.exitCode;
    }
  });
}

export async function providerBindingUnsupportedCommand(
  subcommand: string | undefined,
  args: BindingArgs,
  opts: CommandOptions
): Promise<number> {
  const startTime = Date.now();
  const provider = nonBlank(args.provider, 'archon');
  const deps: EnvelopeMeta = {
    command: 'binding.status',
    provider,
    correlationId: resolveCorrelationId(args.correlationId),
    issuedAt: resolveIssuedAt(),
  };
  emitEnvelope(
    buildErrorEnvelope(
      deps,
      {
        code: 'MALFORMED_REQUEST',
        category: 'provider_contract',
        retryable: false,
        details: {
          fieldErrors: [
            { path: '/command', code: subcommand === undefined ? 'required' : 'unsupported' },
          ],
          requestedCommand: subcommand ?? null,
          requestAccepted: false,
        },
        exitCode: EXIT_USAGE,
      },
      startTime
    ),
    opts
  );
  return EXIT_USAGE;
}
