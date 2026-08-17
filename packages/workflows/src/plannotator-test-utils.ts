import { chmodSync, mkdtempSync, writeFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

type ShellFixtureScope = 'executor' | 'supervisor';

const windowsShellWrappers = new Map<
  ShellFixtureScope,
  { directory: string; executable: string; scriptPointer: string }
>();

export function writePortableBunExecutable(
  directory: string,
  name: string,
  source: string
): string {
  if (process.platform !== 'win32') {
    const executable = join(directory, name);
    writeFileSync(executable, `#!/usr/bin/env bun\n${source}`);
    chmodSync(executable, 0o700);
    return executable;
  }

  const sourcePath = join(directory, `${name}.ts`);
  const executable = join(directory, `${name}.cmd`);
  writeFileSync(sourcePath, source);
  writeFileSync(
    executable,
    `@echo off\r\n"${process.execPath}" "${sourcePath}" %*\r\nexit /b %errorlevel%\r\n`
  );
  return executable;
}

export function writePortableShellExecutable(
  directory: string,
  name: string,
  body: string,
  scope: ShellFixtureScope
): string {
  const scriptPath = join(directory, `${name}.sh`);
  writeFileSync(scriptPath, `#!/bin/sh\n${body}\n`);
  chmodSync(scriptPath, 0o700);
  if (process.platform !== 'win32') return scriptPath;

  let wrapper = windowsShellWrappers.get(scope);
  if (!wrapper) {
    const wrapperDirectory = mkdtempSync(join(tmpdir(), 'archon-shell-fixture-'));
    const scriptPointer = join(wrapperDirectory, 'script-path.txt');
    const executable = writePortableBunExecutable(
      wrapperDirectory,
      'shell-fixture',
      `import { readFileSync } from 'node:fs';

function toShellPath(value: string): string {
  const match = /^([A-Za-z]):[\\\\/](.*)$/.exec(value);
  return match ? \`/\${match[1]?.toLowerCase()}/\${match[2]?.replaceAll('\\\\', '/')}\` : value;
}
const bashPath = process.env.ARCHON_BASH_PATH;
if (!bashPath) throw new Error('ARCHON_BASH_PATH is required for Windows shell fixtures.');
const scriptPath = readFileSync(${JSON.stringify(scriptPointer)}, 'utf8');
const env = { ...process.env };
if (env.PLANNOTATOR_READY_FILE) {
  env.PLANNOTATOR_READY_FILE = toShellPath(env.PLANNOTATOR_READY_FILE);
}
const child = Bun.spawn([
  bashPath,
  toShellPath(scriptPath),
  ...Bun.argv.slice(2).map(toShellPath),
], {
  env,
  stdin: 'inherit',
  stdout: 'inherit',
  stderr: 'inherit',
});
process.on('SIGTERM', () => child.kill());
process.exit(await child.exited);
`
    );
    wrapper = { directory: wrapperDirectory, executable, scriptPointer };
    windowsShellWrappers.set(scope, wrapper);
  }

  writeFileSync(wrapper.scriptPointer, scriptPath);
  return wrapper.executable;
}

export async function cleanupPortableTestExecutables(scope: ShellFixtureScope): Promise<void> {
  const wrapper = windowsShellWrappers.get(scope);
  if (!wrapper) return;
  for (let attempt = 0; attempt < 50; attempt++) {
    try {
      await rm(wrapper.directory, { recursive: true, force: true });
      windowsShellWrappers.delete(scope);
      return;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (
        attempt === 49 ||
        (code !== 'EBUSY' && code !== 'EPERM' && code !== 'EACCES' && code !== 'ENOTEMPTY')
      ) {
        throw error;
      }
      await Bun.sleep(100);
    }
  }
}
