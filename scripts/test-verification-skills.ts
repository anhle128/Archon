import { resolve } from 'node:path';

const files = ['./.agents/skills/verify-archon/lib/contract.test.ts'];
if (process.platform === 'win32') {
  console.log('Skipping POSIX process-isolation verification tests on Windows.');
} else {
  files.push('./.agents/skills/verify-archon/lib/isolation.test.ts');
}

const child = Bun.spawn(['bun', 'test', ...files], {
  cwd: resolve(import.meta.dir, '..'),
  stdin: 'inherit',
  stdout: 'inherit',
  stderr: 'inherit',
});
process.exitCode = await child.exited;
