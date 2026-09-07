import { execFileAsync } from '@archon/git';

export type DockerRunner = (
  command: string,
  args: string[],
  options: { timeout: number }
) => Promise<{ stdout: string; stderr: string }>;

const runDocker: DockerRunner = (command, args, options) => execFileAsync(command, args, options);

export function buildDockerExecArgs(
  cwd: string,
  handle: string,
  shell: '/bin/bash' | '/bin/sh'
): string[] {
  return [
    'exec',
    '-i',
    '-t',
    '-e',
    'TERM=xterm-256color',
    '-e',
    'COLORTERM=truecolor',
    '-w',
    cwd,
    handle,
    shell,
  ];
}

function dockerErrorText(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

export async function inspectContainer(
  handle: string,
  runner: DockerRunner = runDocker
): Promise<'running' | 'stopped' | 'missing'> {
  try {
    const result = await runner('docker', ['inspect', '-f', '{{.State.Running}}', handle], {
      timeout: 5_000,
    });
    const state = result.stdout.trim();
    if (state === 'true') return 'running';
    if (state === 'false') return 'stopped';
    throw new Error(`Unexpected Docker running state: ${state}`);
  } catch (error) {
    if (/no such (object|container)/i.test(dockerErrorText(error))) return 'missing';
    throw error;
  }
}

export async function resolveContainerShell(
  handle: string,
  runner: DockerRunner = runDocker
): Promise<'/bin/bash' | '/bin/sh'> {
  try {
    await runner('docker', ['exec', handle, 'test', '-x', '/bin/bash'], { timeout: 5_000 });
    return '/bin/bash';
  } catch (error) {
    if ((await inspectContainer(handle, runner)) !== 'running') throw error;
    return '/bin/sh';
  }
}
