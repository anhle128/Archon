import { execFileAsync } from '@archon/git';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { closeSync, openSync } from 'node:fs';
import { readdir, readFile, mkdir, stat, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { buildCatalog, type Catalog, type Snapshot } from './contract';

export const repoRoot = resolve(import.meta.dir, '../../../..');
export const skillRoot = resolve(import.meta.dir, '..');
export const suiteRoot = join(repoRoot, 'e2e');

export async function readJson(file: string): Promise<unknown> {
  return JSON.parse(await readFile(file, 'utf8')) as unknown;
}

export async function writeJson(file: string, value: unknown): Promise<void> {
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`);
}

export async function loadCatalog(): Promise<Catalog> {
  const dir = join(skillRoot, 'features');
  const files = (await readdir(dir)).filter(file => file.endsWith('.json')).sort();
  if (files.length === 0) throw new Error('Verification catalog is empty');
  return buildCatalog(await Promise.all(files.map(file => readJson(join(dir, file)))));
}

export async function git(repo: string, args: string[]): Promise<string> {
  const result = await execFileAsync('git', ['-C', repo, ...args], { maxBuffer: 64 * 1024 * 1024 });
  return result.stdout;
}

export async function snapshot(repo: string, base = 'HEAD'): Promise<Snapshot> {
  const [baseSha, headSha, status] = await Promise.all([
    git(repo, ['rev-parse', '--verify', '--end-of-options', `${base}^{commit}`]),
    git(repo, ['rev-parse', 'HEAD']),
    git(repo, ['status', '--porcelain=v1', '-z', '--untracked-files=all']),
  ]);
  const resolvedBaseSha = baseSha.trim();
  const resolvedHeadSha = headSha.trim();
  await git(repo, ['merge-base', '--is-ancestor', resolvedBaseSha, resolvedHeadSha]);
  const changed = await git(repo, [
    'diff',
    '--name-only',
    '--no-renames',
    '-z',
    resolvedBaseSha,
    resolvedHeadSha,
    '--',
  ]);
  return {
    base_sha: resolvedBaseSha,
    head_sha: resolvedHeadSha,
    changed_paths: changed.split('\0').filter(Boolean).sort(),
    dirty: status.length > 0,
  };
}

export async function resolveSelectionBase(repo: string, explicitBase?: string): Promise<string> {
  if (explicitBase) {
    return (
      await git(repo, ['rev-parse', '--verify', '--end-of-options', `${explicitBase}^{commit}`])
    ).trim();
  }
  const candidates = new Map<string, string[]>();
  for (const ref of ['refs/remotes/origin/develop', 'refs/remotes/origin/dev']) {
    try {
      const sha = (
        await git(repo, ['rev-parse', '--verify', '--end-of-options', `${ref}^{commit}`])
      ).trim();
      candidates.set(sha, [...(candidates.get(sha) ?? []), ref]);
    } catch {
      // Missing candidate refs are expected; absence and ambiguity fail below.
    }
  }
  if (candidates.size === 0)
    throw new Error(
      'Cannot resolve a development base; pass --base REF or fetch origin/develop or origin/dev.'
    );
  if (candidates.size > 1)
    throw new Error('Both origin/develop and origin/dev differ; pass an explicit --base REF.');
  const developmentSha = candidates.keys().next().value;
  if (typeof developmentSha !== 'string') throw new Error('Development base disappeared');
  return (await git(repo, ['merge-base', developmentSha, 'HEAD'])).trim();
}

export interface ToolingDigestEntry {
  path: string;
  label: string;
}

export async function digestToolingEntries(entries: ToolingDigestEntry[]): Promise<string> {
  const hash = createHash('sha256');
  const visit = async (path: string, label: string): Promise<void> => {
    const info = await stat(path);
    if (info.isFile()) {
      hash.update(label).update('\0').update(await readFile(path)).update('\0');
      return;
    }
    if (!info.isDirectory()) throw new Error(`Unsupported tooling digest entry: ${path}`);
    for (const entry of (await readdir(path, { withFileTypes: true })).sort((a, b) =>
      a.name.localeCompare(b.name)
    )) {
      if (
        [
          'node_modules',
          'reports',
          'evidence',
          'test-results',
          'playwright-report',
          '.git',
        ].includes(entry.name)
      )
        continue;
      const childPath = join(path, entry.name);
      const name = `${label}/${entry.name}`;
      if (entry.isDirectory()) await visit(childPath, name);
      else if (entry.isFile())
        hash
          .update(name)
          .update('\0')
          .update(await readFile(childPath))
          .update('\0');
    }
  };
  for (const entry of entries) await visit(entry.path, entry.label);
  return hash.digest('hex');
}

export async function toolingDigest(): Promise<string> {
  return digestToolingEntries([
    { path: skillRoot, label: 'verify-archon' },
    {
      path: join(repoRoot, '.agents/skills/select-verify-archon-targets'),
      label: 'select-verify-archon-targets',
    },
    { path: suiteRoot, label: 'e2e' },
    {
      path: join(repoRoot, '.archon/scripts/verify-feature-gate.ts'),
      label: '.archon/scripts/verify-feature-gate.ts',
    },
    { path: join(repoRoot, 'package.json'), label: 'package.json' },
    { path: join(repoRoot, 'bun.lock'), label: 'bun.lock' },
    { path: join(repoRoot, 'packages/git/package.json'), label: 'packages/git/package.json' },
    { path: join(repoRoot, 'packages/git/src'), label: 'packages/git/src' },
    { path: join(repoRoot, 'packages/paths/package.json'), label: 'packages/paths/package.json' },
    { path: join(repoRoot, 'packages/paths/src'), label: 'packages/paths/src' },
    {
      path: join(repoRoot, 'scripts/feature-verify-workflow.test.ts'),
      label: 'scripts/feature-verify-workflow.test.ts',
    },
    {
      path: join(repoRoot, 'scripts/test-verification-skills.ts'),
      label: 'scripts/test-verification-skills.ts',
    },
    {
      path: join(repoRoot, 'scripts/verify-feature-gate.test.ts'),
      label: 'scripts/verify-feature-gate.test.ts',
    },
  ]);
}

export interface CommandResult {
  command: string[];
  cwd: string;
  exit_code: number;
  stdout: string;
  stderr: string;
  timed_out: boolean;
}

export async function runCommand(
  command: string[],
  cwd: string,
  dir: string,
  label: string,
  env: NodeJS.ProcessEnv = {},
  timeoutMs = 300_000
): Promise<CommandResult> {
  await mkdir(dir, { recursive: true });
  const stdout = join(dir, `${label}.stdout.log`);
  const stderr = join(dir, `${label}.stderr.log`);
  if (process.platform === 'win32')
    throw new Error('The local verification runtime requires POSIX process groups (use WSL).');
  const [executable, ...args] = command;
  if (!executable) throw new Error('Command is empty');
  const outFd = openSync(stdout, 'w');
  const errFd = openSync(stderr, 'w');
  const child = ((): ReturnType<typeof spawn> => {
    try {
      return spawn(executable, args, {
        cwd,
        env: { ...process.env, ...env },
        detached: true,
        stdio: ['ignore', outFd, errFd],
      });
    } finally {
      closeSync(outFd);
      closeSync(errFd);
    }
  })();
  const exited = new Promise<number>((resolve, reject) => {
    child.once('error', reject);
    child.once('close', code => {
      resolve(code ?? 128);
    });
  });
  let timedOut = false;
  let killTimer: ReturnType<typeof setTimeout> | undefined;
  let forcedStop: Promise<void> | undefined;
  let signalFailure: unknown;
  const signalGroup = (signal: NodeJS.Signals): void => {
    if (child.pid === undefined) return;
    try {
      process.kill(-child.pid, signal);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ESRCH') {
        signalFailure = error;
        child.kill(signal);
      }
    }
  };
  const timer = setTimeout((): void => {
    timedOut = true;
    signalGroup('SIGTERM');
    // The wrapper can exit before its children. Keep the group cleanup alive.
    forcedStop = new Promise<void>(resolve => {
      killTimer = setTimeout((): void => {
        signalGroup('SIGKILL');
        resolve();
      }, 5000);
    });
  }, timeoutMs);
  let exitCode: number;
  try {
    exitCode = await exited;
    await forcedStop;
  } finally {
    clearTimeout(timer);
    clearTimeout(killTimer);
  }
  if (timedOut) exitCode = 124;
  if (signalFailure)
    throw new Error('Could not terminate the owned process group', { cause: signalFailure });
  const result = { command, cwd, exit_code: exitCode, stdout, stderr, timed_out: timedOut };
  await writeJson(join(dir, `${label}.command.json`), result);
  return result;
}
