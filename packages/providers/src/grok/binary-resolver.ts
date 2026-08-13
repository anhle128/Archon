import { accessSync, constants as fsConstants, existsSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { homedir } from 'node:os';
import { join } from 'node:path';

export function isExecutableFile(path: string): boolean {
  try {
    if (!statSync(path).isFile()) return false;
    if (process.platform !== 'win32') accessSync(path, fsConstants.X_OK);
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
  try {
    const output = execFileSync(process.platform === 'win32' ? 'where' : 'which', ['grok'], {
      encoding: 'utf-8',
      env: definedEnv(env),
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    return output.split(/\r?\n/)[0]?.trim() || undefined;
  } catch {
    return undefined;
  }
}

function autodetectPaths(env: Record<string, string | undefined>): string[] {
  if (process.platform === 'win32') {
    const userProfile = env.USERPROFILE ?? homedir();
    return [
      join(userProfile, '.local', 'bin', 'grok.exe'),
      ...(env.LOCALAPPDATA ? [join(env.LOCALAPPDATA, 'Programs', 'grok', 'grok.exe')] : []),
    ];
  }
  return [
    join(homedir(), '.local', 'bin', 'grok'),
    ...(process.platform === 'darwin' && process.arch === 'arm64'
      ? ['/opt/homebrew/bin/grok']
      : []),
    '/usr/local/bin/grok',
  ];
}

function assertExecutable(path: string, label: string): string {
  if (!existsSync(path) || !isExecutableFile(path)) {
    throw new Error(`${label} points to "${path}", which is not an executable file.`);
  }
  return path;
}

export async function resolveGrokBinaryPath(
  configBinaryPath?: string,
  env: Record<string, string | undefined> = process.env
): Promise<string> {
  if (env.GROK_BIN_PATH) return assertExecutable(env.GROK_BIN_PATH, 'GROK_BIN_PATH');
  if (configBinaryPath) {
    return assertExecutable(configBinaryPath, 'assistants.grok.grokBinaryPath');
  }
  for (const path of autodetectPaths(env)) if (isExecutableFile(path)) return path;
  const fromPath = resolveFromPath(env);
  if (fromPath && isExecutableFile(fromPath)) return fromPath;
  throw new Error(
    'Grok CLI binary not found. Install it with:\n' +
      '  curl -fsSL https://x.ai/cli/install.sh | bash\n\n' +
      'Then ensure `grok` is on PATH, set GROK_BIN_PATH, or configure assistants.grok.grokBinaryPath.'
  );
}
