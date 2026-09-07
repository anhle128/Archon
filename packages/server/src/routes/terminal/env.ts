const HOST_ENV_KEYS = [
  'HOME',
  'USER',
  'LOGNAME',
  'SHELL',
  'PATH',
  'LANG',
  'LC_ALL',
  'LC_CTYPE',
  'LC_MESSAGES',
  'TZ',
  'TMPDIR',
  'USERPROFILE',
  'HOMEDRIVE',
  'HOMEPATH',
  'PATHEXT',
  'SYSTEMROOT',
  'COMSPEC',
] as const;

const DOCKER_ENV_KEYS = [
  ...HOST_ENV_KEYS,
  'DOCKER_HOST',
  'DOCKER_CONTEXT',
  'DOCKER_CONFIG',
  'DOCKER_TLS_VERIFY',
  'DOCKER_CERT_PATH',
] as const;

function copyAllowed(source: NodeJS.ProcessEnv, keys: readonly string[]): Record<string, string> {
  const result: Record<string, string> = {};
  for (const key of keys) {
    const value = source[key];
    if (typeof value === 'string' && value.length > 0) result[key] = value;
  }
  result.TERM = 'xterm-256color';
  result.COLORTERM = 'truecolor';
  return result;
}

export function buildHostTerminalEnv(source: NodeJS.ProcessEnv): Record<string, string> {
  return copyAllowed(source, HOST_ENV_KEYS);
}

export function buildDockerClientEnv(source: NodeJS.ProcessEnv): Record<string, string> {
  return copyAllowed(source, DOCKER_ENV_KEYS);
}
