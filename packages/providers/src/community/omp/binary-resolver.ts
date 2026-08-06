import { accessSync, constants as fsConstants, existsSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { homedir } from 'node:os';
import { join } from 'node:path';

export function isExecutableFile(path: string): boolean {
  try {
    const stat = statSync(path);
    if (!stat.isFile()) return false;
    if (process.platform === 'win32') return true;
    accessSync(path, fsConstants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function definedEnv(env: Record<string, string | undefined>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(env).filter((entry): entry is [string, string] => entry[1] !== undefined)
  );
}

export function resolveFromPath(
  env: Record<string, string | undefined> = process.env
): string | undefined {
  const lookupCmd = process.platform === 'win32' ? 'where' : 'which';
  try {
    const output = execFileSync(lookupCmd, ['omp'], {
      encoding: 'utf-8',
      env: definedEnv(env),
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    return output.split(/\r?\n/)[0]?.trim() || undefined;
  } catch {
    return undefined;
  }
}

function getAutodetectPaths(env: Record<string, string | undefined>): string[] {
  if (process.platform === 'win32') {
    const userProfile = env.USERPROFILE ?? homedir();
    const paths = [
      join(userProfile, '.local', 'bin', 'omp.exe'),
      join(userProfile, '.bun', 'bin', 'omp.exe'),
    ];
    if (env.APPDATA) paths.push(join(env.APPDATA, 'npm', 'omp.cmd'));
    return paths;
  }

  const paths = [join(homedir(), '.local', 'bin', 'omp'), join(homedir(), '.bun', 'bin', 'omp')];
  if (process.platform === 'darwin' && process.arch === 'arm64') {
    paths.push('/opt/homebrew/bin/omp');
  }
  paths.push('/usr/local/bin/omp');
  return paths;
}

function assertExecutable(path: string, sourceLabel: string): string {
  if (!existsSync(path)) {
    throw new Error(
      `${sourceLabel} is set to "${path}" but the file does not exist.\n` +
        'Please verify the path points to the omp executable.'
    );
  }
  if (!isExecutableFile(path)) {
    throw new Error(
      `${sourceLabel} is set to "${path}" but it is not an executable file.\n` +
        'Please verify the path points to omp and is executable.'
    );
  }
  return path;
}

export async function resolveOmpBinaryPath(
  configBinaryPath?: string,
  env: Record<string, string | undefined> = process.env
): Promise<string> {
  if (env.OMP_BIN_PATH) return assertExecutable(env.OMP_BIN_PATH, 'OMP_BIN_PATH');
  if (configBinaryPath) {
    return assertExecutable(configBinaryPath, 'assistants.omp.ompBinaryPath');
  }

  for (const probePath of getAutodetectPaths(env)) {
    if (isExecutableFile(probePath)) return probePath;
  }

  const fromPath = resolveFromPath(env);
  if (fromPath && isExecutableFile(fromPath)) return fromPath;

  throw new Error(
    'OMP CLI binary not found.\n\n' +
      'Install OMP with one of:\n' +
      '  curl -fsSL https://omp.sh/install | sh\n' +
      '  brew install can1357/tap/omp\n' +
      '  bun install -g @oh-my-pi/pi-coding-agent\n\n' +
      'Then ensure `omp` is on PATH, set OMP_BIN_PATH, or configure:\n' +
      '  assistants:\n' +
      '    omp:\n' +
      '      ompBinaryPath: /absolute/path/to/omp\n'
  );
}
