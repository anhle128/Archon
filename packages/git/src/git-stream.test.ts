import { afterEach, expect, spyOn, test } from 'bun:test';
import * as childProcess from 'child_process';
import { EventEmitter } from 'events';
import { Readable } from 'stream';

import { readGitStdoutWindow, streamGitStdout } from './git-stream';
import { toWorktreePath } from './types';

class FakeChildProcess extends EventEmitter {
  readonly stdout = new Readable({ read(): void {} });
  readonly stderr = new Readable({ read(): void {} });
  killed = false;

  kill(): boolean {
    this.killed = true;
    this.stdout.push(null);
    this.emit('close', null);
    return true;
  }
}

let spawnSpy: ReturnType<typeof spyOn> | undefined;

afterEach(() => {
  spawnSpy?.mockRestore();
  spawnSpy = undefined;
});

test('streamGitStdout keeps stdout paused for slow readers and kills on cancel', async () => {
  const child = new FakeChildProcess();
  spawnSpy = spyOn(childProcess, 'spawn').mockReturnValue(
    child as unknown as childProcess.ChildProcess
  );

  const stream = streamGitStdout({ workingPath: toWorktreePath('/repo'), args: ['status'] });
  const reader = stream.getReader();

  expect(child.stdout.listenerCount('data')).toBe(0);
  child.stdout.push(Buffer.from([1]));
  const first = await reader.read();
  expect(first).toEqual({ done: false, value: Uint8Array.from([1]) });
  expect(child.stdout.listenerCount('data')).toBe(0);

  await reader.cancel();
  expect(child.killed).toBe(true);
});

test('readGitStdoutWindow handles an early child error without an unhandled process error', async () => {
  const child = new FakeChildProcess();
  spawnSpy = spyOn(childProcess, 'spawn').mockReturnValue(
    child as unknown as childProcess.ChildProcess
  );

  const read = readGitStdoutWindow(
    { workingPath: toWorktreePath('/repo'), args: ['cat-file', 'blob', 'abc'] },
    0,
    1
  );
  queueMicrotask(() => {
    child.emit('error', new Error('spawn failed'));
  });

  await expect(read).rejects.toThrow('Git stream failed');
});
