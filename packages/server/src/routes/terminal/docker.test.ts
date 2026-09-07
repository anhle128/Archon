import { describe, expect, test } from 'bun:test';

import {
  buildDockerExecArgs,
  inspectContainer,
  resolveContainerShell,
  type DockerRunner,
} from './docker';

describe('buildDockerExecArgs', () => {
  test('generates literal argv with fixed terminal values in stable order', () => {
    expect(buildDockerExecArgs('/workspace/app', 'archon-run-1', '/bin/bash')).toEqual([
      'exec',
      '-i',
      '-t',
      '-e',
      'TERM=xterm-256color',
      '-e',
      'COLORTERM=truecolor',
      '-w',
      '/workspace/app',
      'archon-run-1',
      '/bin/bash',
    ]);
  });
});

describe('inspectContainer', () => {
  test('runs docker inspect -f {{.State.Running}} with a 5000ms timeout', async () => {
    const calls: Array<{ command: string; args: string[]; options: { timeout: number } }> = [];
    const runner: DockerRunner = async (command, args, options) => {
      calls.push({ command, args, options });
      return { stdout: 'true\n', stderr: '' };
    };

    expect(await inspectContainer('archon-run-1', runner)).toBe('running');
    expect(calls).toEqual([
      {
        command: 'docker',
        args: ['inspect', '-f', '{{.State.Running}}', 'archon-run-1'],
        options: { timeout: 5_000 },
      },
    ]);
  });

  test('returns stopped when inspect stdout trims to false', async () => {
    const runner: DockerRunner = async () => ({ stdout: 'false\n', stderr: '' });
    expect(await inspectContainer('archon-run-1', runner)).toBe('stopped');
  });

  test('classifies case-insensitive missing object and container errors', async () => {
    const noSuchObject: DockerRunner = async () => {
      throw new Error('Error: No such object: abc');
    };
    const noSuchContainer: DockerRunner = async () => {
      throw new Error('error: NO SUCH CONTAINER: xyz');
    };

    expect(await inspectContainer('abc', noSuchObject)).toBe('missing');
    expect(await inspectContainer('xyz', noSuchContainer)).toBe('missing');
  });

  test('rethrows a Docker daemon error', async () => {
    const runner: DockerRunner = async () => {
      throw new Error('Cannot connect to the Docker daemon');
    };
    await expect(inspectContainer('archon-run-1', runner)).rejects.toThrow(
      'Cannot connect to the Docker daemon'
    );
  });

  test('throws on an unexpected inspect running state', async () => {
    const runner: DockerRunner = async () => ({ stdout: 'maybe\n', stderr: '' });
    await expect(inspectContainer('archon-run-1', runner)).rejects.toThrow(
      'Unexpected Docker running state: maybe'
    );
  });
});

describe('resolveContainerShell', () => {
  test('returns /bin/bash when docker exec test -x succeeds', async () => {
    const calls: string[][] = [];
    const runner: DockerRunner = async (_command, args) => {
      calls.push(args);
      return { stdout: '', stderr: '' };
    };

    expect(await resolveContainerShell('archon-run-1', runner)).toBe('/bin/bash');
    expect(calls).toEqual([['exec', 'archon-run-1', 'test', '-x', '/bin/bash']]);
  });

  test('falls back to /bin/sh only after a follow-up inspect proves running', async () => {
    const calls: string[][] = [];
    const runner: DockerRunner = async (_command, args) => {
      calls.push(args);
      if (args[0] === 'exec') throw new Error('exit 1');
      return { stdout: 'true\n', stderr: '' };
    };

    expect(await resolveContainerShell('archon-run-1', runner)).toBe('/bin/sh');
    expect(calls).toEqual([
      ['exec', 'archon-run-1', 'test', '-x', '/bin/bash'],
      ['inspect', '-f', '{{.State.Running}}', 'archon-run-1'],
    ]);
  });

  test('rethrows the executable-check error when the container is not running', async () => {
    const runner: DockerRunner = async (_command, args) => {
      if (args[0] === 'exec') throw new Error('exit 1');
      return { stdout: 'false\n', stderr: '' };
    };

    await expect(resolveContainerShell('archon-run-1', runner)).rejects.toThrow('exit 1');
  });
});
