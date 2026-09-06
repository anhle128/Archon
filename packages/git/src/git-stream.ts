import * as childProcess from 'child_process';

import type { RepoPath, WorktreePath } from './types';

export interface GitStreamRequest {
  workingPath: RepoPath | WorktreePath;
  args: string[];
  signal?: AbortSignal;
}

function opaqueStreamError(): Error {
  return new Error('Git stream failed');
}

function spawnGit(request: GitStreamRequest): childProcess.ChildProcess {
  return childProcess.spawn('git', ['-C', request.workingPath, ...request.args], {
    stdio: ['ignore', 'pipe', 'pipe'],
    signal: request.signal,
  });
}

function concatBytes(chunks: Uint8Array[], total: number): Uint8Array {
  if (chunks.length === 1) {
    const only = chunks[0];
    if (only !== undefined) return only;
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

function waitClose(child: childProcess.ChildProcess): Promise<number | null> {
  return new Promise((resolve, reject) => {
    child.once('error', () => {
      reject(opaqueStreamError());
    });
    child.once('close', (code: number | null) => {
      resolve(code);
    });
  });
}

function toUint8Array(chunk: Buffer | string): Uint8Array {
  return typeof chunk === 'string' ? Buffer.from(chunk) : new Uint8Array(chunk);
}

export function streamGitStdout(request: GitStreamRequest): ReadableStream<Uint8Array> {
  const child = spawnGit(request);
  child.stderr?.resume();
  let intentionalStop = false;
  let closed = false;

  if (request.signal) {
    request.signal.addEventListener(
      'abort',
      () => {
        intentionalStop = true;
      },
      { once: true }
    );
  }

  return new ReadableStream<Uint8Array>({
    start(controller): void {
      const fail = (): void => {
        if (closed) return;
        closed = true;
        controller.error(opaqueStreamError());
      };
      const finish = (): void => {
        if (closed) return;
        closed = true;
        controller.close();
      };

      const stdout = child.stdout;
      if (!stdout) {
        fail();
        return;
      }

      stdout.on('data', (chunk: Buffer | string) => {
        if (closed) return;
        controller.enqueue(toUint8Array(chunk));
      });
      stdout.on('error', () => {
        if (intentionalStop) {
          finish();
          return;
        }
        fail();
      });
      child.on('error', () => {
        fail();
      });
      child.on('close', (code: number | null) => {
        if (intentionalStop || code === 0) {
          finish();
          return;
        }
        fail();
      });
    },
    cancel(): void {
      intentionalStop = true;
      closed = true;
      if (!child.killed) child.kill();
    },
  });
}

export async function readGitStdoutWindow(
  request: GitStreamRequest,
  skipBytes: number,
  takeBytes: number
): Promise<Uint8Array> {
  if (takeBytes <= 0) return new Uint8Array(0);

  const child = spawnGit(request);
  child.stderr?.resume();
  const stdout = child.stdout;
  if (!stdout) {
    child.kill();
    throw opaqueStreamError();
  }

  const chunks: Uint8Array[] = [];
  let skipped = 0;
  let taken = 0;
  let intentionalCutoff = false;

  try {
    for await (const chunk of stdout) {
      const bytes = toUint8Array(chunk);
      let start = 0;
      if (skipped < skipBytes) {
        const need = skipBytes - skipped;
        if (bytes.byteLength <= need) {
          skipped += bytes.byteLength;
          continue;
        }
        start = need;
        skipped = skipBytes;
      }
      const remaining = takeBytes - taken;
      const available = bytes.byteLength - start;
      if (available >= remaining) {
        chunks.push(bytes.subarray(start, start + remaining));
        taken = takeBytes;
        intentionalCutoff = true;
        child.kill();
        break;
      }
      chunks.push(bytes.subarray(start));
      taken += available;
    }
  } catch {
    if (!intentionalCutoff) throw opaqueStreamError();
  }

  const exitCode = await waitClose(child);
  if (!intentionalCutoff && exitCode !== 0) {
    throw opaqueStreamError();
  }

  return concatBytes(chunks, taken);
}
