import { realpath, stat } from 'fs/promises';

export type TerminalUnavailableReason =
  | 'no_checkout'
  | 'container_missing'
  | 'container_stopped'
  | 'unsupported_provider';

export type TerminalTarget =
  | { kind: 'host'; cwd: string; shell: string }
  | { kind: 'container'; cwd: string; handle: string; shell: '/bin/bash' | '/bin/sh' }
  | { kind: 'unavailable'; reason: TerminalUnavailableReason };

export interface TerminalRunRow {
  working_path: string | null;
  metadata: Record<string, unknown>;
}

export interface TerminalIsolationRow {
  provider: string;
  status: string;
  metadata: Record<string, unknown>;
}

export interface ResolveTerminalTargetDeps {
  getIsolationEnvById(id: string): Promise<TerminalIsolationRow | null>;
  canonicalDirectory(path: string): Promise<string | null>;
  inspectContainer(handle: string): Promise<'running' | 'stopped' | 'missing'>;
  resolveContainerShell(handle: string): Promise<'/bin/bash' | '/bin/sh'>;
  resolveHostShell(): string;
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

export async function canonicalDirectory(path: string): Promise<string | null> {
  try {
    const canonicalPath = await realpath(path);
    return (await stat(canonicalPath)).isDirectory() ? canonicalPath : null;
  } catch {
    return null;
  }
}

export async function resolveTerminalTarget(
  run: TerminalRunRow,
  deps: ResolveTerminalTargetDeps
): Promise<TerminalTarget> {
  const cwd = nonEmptyString(run.working_path);
  if (!cwd) return { kind: 'unavailable', reason: 'no_checkout' };
  const envId = nonEmptyString(run.metadata.isolation_env_id);
  if (envId) {
    const environment = await deps.getIsolationEnvById(envId);
    if (!environment && run.metadata.isolation === 'container') {
      return { kind: 'unavailable', reason: 'container_missing' };
    }
    if (
      environment &&
      environment.provider !== 'container' &&
      environment.provider !== 'worktree'
    ) {
      return { kind: 'unavailable', reason: 'unsupported_provider' };
    }
    if (environment?.provider === 'container') {
      if (environment.status !== 'active') {
        return { kind: 'unavailable', reason: 'container_missing' };
      }
      const handle =
        nonEmptyString(environment.metadata.containerName) ??
        nonEmptyString(environment.metadata.containerId);
      if (!handle) return { kind: 'unavailable', reason: 'container_missing' };
      const presence = await deps.inspectContainer(handle);
      if (presence !== 'running') {
        return {
          kind: 'unavailable',
          reason: presence === 'stopped' ? 'container_stopped' : 'container_missing',
        };
      }
      return {
        kind: 'container',
        cwd,
        handle,
        shell: await deps.resolveContainerShell(handle),
      };
    }
  }
  if (run.metadata.isolation === 'container') {
    return { kind: 'unavailable', reason: 'container_missing' };
  }
  const canonicalPath = await deps.canonicalDirectory(cwd);
  return canonicalPath
    ? { kind: 'host', cwd: canonicalPath, shell: deps.resolveHostShell() }
    : { kind: 'unavailable', reason: 'no_checkout' };
}
