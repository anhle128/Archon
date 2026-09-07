import { buildDockerExecArgs } from './docker';
import { buildDockerClientEnv, buildHostTerminalEnv } from './env';
import type { TerminalTarget } from './target';

export interface SpawnedTerminal {
  write(data: string): void;
  resize(cols: number, rows: number): void;
  kill(): void;
  exited: Promise<{ code: number | null; signal: string | null }>;
}

export interface TerminalSpawnSpec {
  command: string[];
  cwd?: string;
  env: Record<string, string>;
}

type SpawnableTarget = Extract<TerminalTarget, { kind: 'host' | 'container' }>;

export function buildTerminalSpawnSpec(
  target: SpawnableTarget,
  sourceEnv: NodeJS.ProcessEnv
): TerminalSpawnSpec {
  if (target.kind === 'host') {
    return {
      command: [target.shell, '-l'],
      cwd: target.cwd,
      env: buildHostTerminalEnv(sourceEnv),
    };
  }
  return {
    command: ['docker', ...buildDockerExecArgs(target.cwd, target.handle, target.shell)],
    env: buildDockerClientEnv(sourceEnv),
  };
}

export function spawnTerminalPty(input: {
  target: SpawnableTarget;
  cols: number;
  rows: number;
  onData(chunk: Uint8Array): void;
  sourceEnv?: NodeJS.ProcessEnv;
  spawn?: typeof Bun.spawn;
}): SpawnedTerminal {
  const spec = buildTerminalSpawnSpec(input.target, input.sourceEnv ?? process.env);
  const spawn = input.spawn ?? Bun.spawn;
  const subprocess = spawn(spec.command, {
    ...(spec.cwd ? { cwd: spec.cwd } : {}),
    env: spec.env,
    terminal: {
      cols: input.cols,
      rows: input.rows,
      name: 'xterm-256color',
      data(_terminal, chunk) {
        input.onData(chunk);
      },
    },
  });
  const terminal = subprocess.terminal;
  if (!terminal) {
    subprocess.kill('SIGTERM');
    throw new Error('Bun did not create the requested terminal');
  }
  let killed = false;
  return {
    write(data: string): void {
      terminal.write(data);
    },
    resize(cols: number, rows: number): void {
      terminal.resize(cols, rows);
    },
    kill(): void {
      if (killed) return;
      killed = true;
      subprocess.kill('SIGTERM');
      terminal.close();
    },
    exited: subprocess.exited.then(
      (code: number): { code: number | null; signal: string | null } => ({
        code,
        signal: subprocess.signalCode ?? null,
      })
    ),
  };
}
