import { createHash } from 'crypto';
import type { BigIntStats } from 'fs';
import type { FileHandle } from 'fs/promises';
import { lstat, open, readlink } from 'fs/promises';
import { join } from 'path';

import * as exec from './exec';
import { containLiveGitFilePath, GitPathError, parseGitFilePath } from './git-path';
import { readGitStdoutWindow, streamGitStdout } from './git-stream';
import type { RepoPath, WorktreePath } from './types';
import {
  chooseGitFilePresentation,
  decodeViewerCursor,
  encodeViewerCursor,
  sliceTextPage,
  ViewerCursorError,
  VIEWER_BINARY_PROBE_BYTES,
  VIEWER_DIFF_CONTEXT_LINES,
  VIEWER_DOWNLOAD_ONLY_BYTES,
  VIEWER_FIRST_PAINT_BYTES,
  VIEWER_HEX_PEEK_BYTES,
  VIEWER_STREAM_BYTES,
  type GitFilePresentation,
  type ViewerCursorAxis,
} from './viewer-limits';
import {
  HunkPageAccumulator,
  visitUnifiedDiffChunks,
  type DiffHunk,
  type HunkPageDecision,
} from './diff-page';

export type { DiffChange, DiffHunk } from './diff-page';

export type FileAtIntent = 'full' | 'view' | 'download';

export type FileAtRequest =
  | { intent?: 'full'; cursor?: never; signal?: AbortSignal }
  | { intent: 'view'; cursor?: string; signal?: AbortSignal }
  | { intent: 'download'; cursor?: never; signal?: AbortSignal };

interface FileAtMetadata {
  path: string;
  binary: boolean;
  contentHash: string;
  byteLength: number;
  truncated: boolean;
  cursor: string;
  presentation: GitFilePresentation;
  mediaType: string;
}

export interface FileAtBytesResult extends FileAtMetadata {
  delivery: 'bytes';
  bytes: Uint8Array;
}

export interface FileAtStreamResult extends FileAtMetadata {
  delivery: 'stream';
  stream: ReadableStream<Uint8Array>;
}

export type FileAtResult = FileAtBytesResult | FileAtStreamResult;

export interface FileDiffRequest {
  cursor?: string;
  signal?: AbortSignal;
}

export interface FileDiffResult {
  path: string;
  status: 'M';
  scope: 'now';
  ref: 'live';
  hunks: DiffHunk[];
  cursor: string;
  truncated: boolean;
  binary: boolean;
  fileFallback: boolean;
}

export type FileAtSource = { kind: 'worktree' } | { kind: 'tree'; treeIsh: string };
type GitFileErrorCode = 'not_found' | 'invalid_ref' | 'invalid_cursor' | 'stale_cursor';

export class GitFileError extends Error {
  readonly code: GitFileErrorCode;

  constructor(code: GitFileErrorCode) {
    super('Git file read failed');
    this.name = 'GitFileError';
    this.code = code;
  }
}

interface InspectedFile {
  path: string;
  byteLength: number;
  contentHash: string;
  readWindow(offset: number, length: number, signal?: AbortSignal): Promise<Uint8Array>;
  stream(signal?: AbortSignal): ReadableStream<Uint8Array>;
}

const HUNK_RE = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

function isMissing(error: unknown): boolean {
  if (!(error instanceof Error) || !('code' in error)) return false;
  const code = (error as NodeJS.ErrnoException).code;
  return code === 'ENOENT' || code === 'ENOTDIR';
}

function hashIdentity(parts: (string | number | bigint)[]): string {
  const hash = createHash('sha256');
  for (const part of parts) {
    hash.update(typeof part === 'string' ? part : part.toString());
    hash.update('\0');
  }
  return hash.digest('hex');
}

function sameIdentity(expected: BigIntStats, opened: BigIntStats): boolean {
  return (
    opened.dev === expected.dev &&
    opened.ino === expected.ino &&
    opened.mode === expected.mode &&
    opened.size === expected.size &&
    opened.mtimeNs === expected.mtimeNs &&
    opened.ctimeNs === expected.ctimeNs
  );
}

function throwIfAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) return;
  if (signal.reason instanceof Error) throw signal.reason;
  throw new Error('Aborted');
}

function toUint8Array(chunk: Buffer | string): Uint8Array {
  return typeof chunk === 'string' ? Buffer.from(chunk) : new Uint8Array(chunk);
}

function createWorktreeFileStream(
  canonicalPath: string,
  expected: BigIntStats,
  signal?: AbortSignal
): ReadableStream<Uint8Array> {
  let nodeStream: ReturnType<FileHandle['createReadStream']> | undefined;
  let handle: FileHandle | undefined;
  let closed = false;

  return new ReadableStream<Uint8Array>({
    async start(controller): Promise<void> {
      const fail = (error: unknown): void => {
        if (closed) return;
        closed = true;
        controller.error(error instanceof Error ? error : new Error('Git stream failed'));
      };
      const finish = (): void => {
        if (closed) return;
        closed = true;
        controller.close();
      };
      try {
        throwIfAborted(signal);
        handle = await open(canonicalPath, 'r');
        const opened = await handle.stat({ bigint: true });
        if (!opened.isFile() || !sameIdentity(expected, opened)) {
          throw new GitPathError('escape');
        }
        nodeStream = handle.createReadStream();
        nodeStream.on('data', (chunk: Buffer | string) => {
          if (closed) return;
          controller.enqueue(toUint8Array(chunk));
        });
        nodeStream.on('end', () => {
          finish();
        });
        nodeStream.on('error', (error: Error) => {
          fail(error);
        });
        const abort = (): void => {
          nodeStream?.destroy();
          finish();
        };
        if (signal) {
          if (signal.aborted) abort();
          else signal.addEventListener('abort', abort, { once: true });
        }
      } catch (error) {
        if (handle !== undefined) await handle.close().catch(() => undefined);
        fail(error);
      }
    },
    cancel(): void {
      closed = true;
      nodeStream?.destroy();
      void handle?.close();
    },
  });
}

async function inspectWorktree(workingPath: string, relativePath: string): Promise<InspectedFile> {
  const candidate = join(workingPath, relativePath);
  let entry: BigIntStats;
  try {
    entry = await lstat(candidate, { bigint: true });
  } catch (error) {
    if (isMissing(error)) throw new GitFileError('not_found');
    throw error;
  }

  let canonical: string;
  try {
    canonical = await containLiveGitFilePath(workingPath, relativePath);
  } catch (error) {
    if (isMissing(error)) throw new GitFileError('not_found');
    throw error;
  }

  const contentHash = hashIdentity([
    'worktree',
    entry.dev,
    entry.ino,
    entry.mode,
    entry.size,
    entry.mtimeNs,
    entry.ctimeNs,
  ]);

  if (entry.isSymbolicLink()) {
    const targetBytes = Buffer.from(await readlink(candidate));
    return {
      path: relativePath,
      byteLength: targetBytes.byteLength,
      contentHash,
      async readWindow(offset: number, length: number, signal?: AbortSignal): Promise<Uint8Array> {
        throwIfAborted(signal);
        const latest = Buffer.from(await readlink(candidate));
        return new Uint8Array(latest.subarray(offset, offset + length));
      },
      stream(signal?: AbortSignal): ReadableStream<Uint8Array> {
        throwIfAborted(signal);
        const bytes = new Uint8Array(targetBytes);
        return new ReadableStream({
          start(controller): void {
            controller.enqueue(bytes);
            controller.close();
          },
        });
      },
    };
  }

  const handle = await open(canonical, 'r');
  try {
    const opened = await handle.stat({ bigint: true });
    if (!opened.isFile() || !sameIdentity(entry, opened)) {
      throw new GitPathError('escape');
    }
  } finally {
    await handle.close();
  }

  const byteLength = Number(entry.size);
  return {
    path: relativePath,
    byteLength,
    contentHash,
    async readWindow(offset: number, length: number, signal?: AbortSignal): Promise<Uint8Array> {
      throwIfAborted(signal);
      if (length <= 0 || offset >= byteLength) return new Uint8Array(0);
      const reader = await open(canonical, 'r');
      try {
        const opened = await reader.stat({ bigint: true });
        if (!opened.isFile() || !sameIdentity(entry, opened)) {
          throw new GitPathError('escape');
        }
        const size = Math.min(length, Math.max(0, byteLength - offset));
        const buffer = Buffer.alloc(size);
        const { bytesRead } = await reader.read(buffer, 0, size, offset);
        return new Uint8Array(buffer.subarray(0, bytesRead));
      } finally {
        await reader.close();
      }
    },
    stream(signal?: AbortSignal): ReadableStream<Uint8Array> {
      return createWorktreeFileStream(canonical, entry, signal);
    },
  };
}

async function inspectTree(
  workingPath: RepoPath | WorktreePath,
  relativePath: string,
  treeIsh: string
): Promise<InspectedFile> {
  if (
    treeIsh.length === 0 ||
    treeIsh.includes('\0') ||
    treeIsh.includes(':') ||
    treeIsh.startsWith('-')
  ) {
    throw new GitFileError('invalid_ref');
  }
  let listing: { stdout: string };
  try {
    listing = await exec.execFileAsync('git', [
      '-C',
      workingPath,
      '--literal-pathspecs',
      'ls-tree',
      '-z',
      treeIsh,
      '--',
      relativePath,
    ]);
  } catch {
    throw new GitFileError('invalid_ref');
  }
  const record = listing.stdout.split('\0').find((value: string): boolean => value.length > 0);
  const tab = record?.indexOf('\t') ?? -1;
  const meta = tab >= 0 ? record?.slice(0, tab).split(' ') : undefined;
  const listedPath = tab >= 0 ? record?.slice(tab + 1) : undefined;
  const blobOid = meta?.[2];
  if (meta?.[1] !== 'blob' || blobOid === undefined || listedPath !== relativePath) {
    throw new GitFileError('not_found');
  }
  let sizeOut: { stdout: string };
  try {
    sizeOut = await exec.execFileAsync('git', ['-C', workingPath, 'cat-file', '-s', blobOid]);
  } catch {
    throw new GitFileError('not_found');
  }
  const byteLength = Number.parseInt(sizeOut.stdout.trim(), 10);
  if (!Number.isSafeInteger(byteLength) || byteLength < 0) {
    throw new GitFileError('not_found');
  }
  return {
    path: relativePath,
    byteLength,
    contentHash: hashIdentity(['tree', blobOid, byteLength]),
    readWindow(offset: number, length: number, signal?: AbortSignal): Promise<Uint8Array> {
      return readGitStdoutWindow(
        { workingPath, args: ['cat-file', 'blob', blobOid], signal },
        offset,
        length
      );
    },
    stream(signal?: AbortSignal): ReadableStream<Uint8Array> {
      return streamGitStdout({ workingPath, args: ['cat-file', 'blob', blobOid], signal });
    },
  };
}

async function inspectFile(
  workingPath: RepoPath | WorktreePath,
  relativePath: string,
  source: FileAtSource
): Promise<InspectedFile> {
  if (source.kind === 'worktree') return inspectWorktree(workingPath, relativePath);
  return inspectTree(workingPath, relativePath, source.treeIsh);
}

async function classifyInspected(
  inspected: InspectedFile,
  signal?: AbortSignal
): Promise<ReturnType<typeof chooseGitFilePresentation>> {
  if (inspected.byteLength > VIEWER_DOWNLOAD_ONLY_BYTES) {
    return chooseGitFilePresentation(inspected.byteLength, new Uint8Array(0));
  }
  const probe = await inspected.readWindow(
    0,
    Math.min(VIEWER_BINARY_PROBE_BYTES, inspected.byteLength),
    signal
  );
  return chooseGitFilePresentation(inspected.byteLength, probe);
}

function bytesResult(
  inspected: InspectedFile,
  classification: ReturnType<typeof chooseGitFilePresentation>,
  bytes: Uint8Array,
  truncated: boolean,
  cursor: string
): FileAtBytesResult {
  return {
    path: inspected.path,
    binary: classification.binary,
    contentHash: inspected.contentHash,
    byteLength: inspected.byteLength,
    truncated,
    cursor,
    presentation: classification.presentation,
    mediaType: classification.mediaType,
    delivery: 'bytes',
    bytes,
  };
}

function streamResult(
  inspected: InspectedFile,
  classification: ReturnType<typeof chooseGitFilePresentation>,
  stream: ReadableStream<Uint8Array>
): FileAtStreamResult {
  return {
    path: inspected.path,
    binary: classification.binary,
    contentHash: inspected.contentHash,
    byteLength: inspected.byteLength,
    truncated: false,
    cursor: '',
    presentation: classification.presentation,
    mediaType: classification.mediaType,
    delivery: 'stream',
    stream,
  };
}

function decodeAxisCursor(
  cursor: string | undefined,
  axis: ViewerCursorAxis,
  version: string
): number {
  try {
    return decodeViewerCursor(cursor ?? '', axis, version);
  } catch (error) {
    if (error instanceof ViewerCursorError) {
      throw new GitFileError(error.code === 'stale' ? 'stale_cursor' : 'invalid_cursor');
    }
    throw error;
  }
}

function decodeOffsetCursor(cursor: string | undefined, contentHash: string): number {
  return decodeAxisCursor(cursor, 'o', contentHash);
}

export function hasNulInFirst8k(bytes: Uint8Array): boolean {
  return bytes.subarray(0, Math.min(8192, bytes.byteLength)).includes(0);
}

export function parseUnifiedDiff(stdout: string): DiffHunk[] {
  const hunks: DiffHunk[] = [];
  let current: DiffHunk | null = null;
  let oldLine = 0;
  let newLine = 0;
  for (const line of stdout.split('\n')) {
    const match = HUNK_RE.exec(line);
    if (match) {
      current = {
        oldStart: Number(match[1]),
        oldLines: Number(match[2] ?? '1'),
        newStart: Number(match[3]),
        newLines: Number(match[4] ?? '1'),
        header: line,
        changes: [],
      };
      oldLine = current.oldStart;
      newLine = current.newStart;
      hunks.push(current);
      continue;
    }
    if (!current || line.startsWith('\\')) continue;
    if (line.startsWith('+')) {
      current.changes.push({ type: 'insert', content: line.slice(1), newLine });
      newLine += 1;
    } else if (line.startsWith('-')) {
      current.changes.push({ type: 'delete', content: line.slice(1), oldLine });
      oldLine += 1;
    } else if (line.startsWith(' ')) {
      current.changes.push({ type: 'normal', content: line.slice(1), oldLine, newLine });
      oldLine += 1;
      newLine += 1;
    }
  }
  return hunks;
}

export function fileAt(
  workingPath: RepoPath | WorktreePath,
  relativePath: string,
  source: FileAtSource,
  request?: { intent?: 'full'; cursor?: never; signal?: AbortSignal }
): Promise<FileAtBytesResult>;
export function fileAt(
  workingPath: RepoPath | WorktreePath,
  relativePath: string,
  source: FileAtSource,
  request: { intent: 'download'; cursor?: never; signal?: AbortSignal }
): Promise<FileAtStreamResult>;
export function fileAt(
  workingPath: RepoPath | WorktreePath,
  relativePath: string,
  source: FileAtSource,
  request: { intent: 'view'; cursor?: string; signal?: AbortSignal }
): Promise<FileAtResult>;
export async function fileAt(
  workingPath: RepoPath | WorktreePath,
  relativePath: string,
  source: FileAtSource,
  request?: FileAtRequest
): Promise<FileAtResult> {
  const path = parseGitFilePath(relativePath);
  const signal = request?.signal;
  const inspected = await inspectFile(workingPath, path, source);
  const intent = request?.intent ?? 'full';

  if (intent === 'full') {
    const bytes = await inspected.readWindow(0, inspected.byteLength, signal);
    const classification = chooseGitFilePresentation(
      inspected.byteLength,
      bytes.subarray(0, Math.min(VIEWER_BINARY_PROBE_BYTES, bytes.byteLength))
    );
    return bytesResult(inspected, classification, bytes, false, '');
  }

  if (intent === 'download') {
    const classification = await classifyInspected(inspected, signal);
    return streamResult(inspected, classification, inspected.stream(signal));
  }

  if (inspected.byteLength > VIEWER_DOWNLOAD_ONLY_BYTES) {
    return bytesResult(
      inspected,
      chooseGitFilePresentation(inspected.byteLength, new Uint8Array(0)),
      new Uint8Array(0),
      false,
      ''
    );
  }

  const classification = await classifyInspected(inspected, signal);
  if (classification.presentation === 'hex') {
    const bytes = await inspected.readWindow(
      0,
      Math.min(VIEWER_HEX_PEEK_BYTES, inspected.byteLength),
      signal
    );
    return bytesResult(inspected, classification, bytes, false, '');
  }
  if (classification.presentation === 'image') {
    if (inspected.byteLength <= VIEWER_STREAM_BYTES) {
      const bytes = await inspected.readWindow(0, inspected.byteLength, signal);
      return bytesResult(inspected, classification, bytes, false, '');
    }
    return streamResult(inspected, classification, inspected.stream(signal));
  }
  if (classification.presentation === 'download') {
    return bytesResult(inspected, classification, new Uint8Array(0), false, '');
  }

  const offset = decodeOffsetCursor(request?.cursor, inspected.contentHash);
  const window = await inspected.readWindow(offset, VIEWER_FIRST_PAINT_BYTES + 3, signal);
  const hasBytesAfterWindow = offset + window.byteLength < inspected.byteLength;
  const page = sliceTextPage(window, hasBytesAfterWindow);
  const cursor = page.truncated
    ? encodeViewerCursor('o', offset + page.consumedBytes, inspected.contentHash)
    : '';
  return bytesResult(inspected, classification, page.bytes, page.truncated, cursor);
}

function needsRawFallback(classification: ReturnType<typeof chooseGitFilePresentation>): boolean {
  return classification.presentation !== 'text';
}

async function inspectHead(
  workingPath: RepoPath | WorktreePath,
  path: string
): Promise<InspectedFile | undefined> {
  try {
    return await inspectTree(workingPath, path, 'HEAD');
  } catch (error) {
    if (error instanceof GitFileError && error.code === 'not_found') return undefined;
    throw error;
  }
}

function rawFallbackResult(path: string, binary: boolean): FileDiffResult {
  return {
    path,
    status: 'M',
    scope: 'now',
    ref: 'live',
    hunks: [],
    cursor: '',
    truncated: false,
    binary,
    fileFallback: true,
  };
}

async function* readStreamChunks(reader: {
  read: () => Promise<{ done: boolean; value?: Uint8Array }>;
}): AsyncIterable<Uint8Array> {
  while (true) {
    const { done, value } = await reader.read();
    if (done || value === undefined) return;
    yield value;
  }
}

export async function fileDiff(
  workingPath: RepoPath | WorktreePath,
  relativePath: string,
  request?: FileDiffRequest
): Promise<FileDiffResult> {
  const path = parseGitFilePath(relativePath);
  const signal = request?.signal;
  throwIfAborted(signal);

  const worktree = await inspectWorktree(workingPath, path);
  const worktreeClass = await classifyInspected(worktree, signal);
  const head = await inspectHead(workingPath, path);
  const headClass = head === undefined ? undefined : await classifyInspected(head, signal);
  if (needsRawFallback(worktreeClass) || (headClass !== undefined && needsRawFallback(headClass))) {
    return rawFallbackResult(path, worktreeClass.binary || (headClass?.binary ?? false));
  }

  const version = hashIdentity([worktree.contentHash, head?.contentHash ?? '']);
  const startIndex = decodeAxisCursor(request?.cursor, 'h', version);
  const pager = new HunkPageAccumulator(startIndex);
  const stream = streamGitStdout({
    workingPath,
    args: [
      '--no-optional-locks',
      '--literal-pathspecs',
      'diff',
      '--no-color',
      '--no-ext-diff',
      '--no-textconv',
      '--text',
      `-U${String(VIEWER_DIFF_CONTEXT_LINES)}`,
      'HEAD',
      '--',
      path,
    ],
    signal,
    acceptExitCodes: [0, 1],
  });
  const reader = stream.getReader();
  try {
    await visitUnifiedDiffChunks(readStreamChunks(reader), (hunk: DiffHunk): HunkPageDecision => {
      return pager.push(hunk);
    });
  } finally {
    if (pager.result().truncated) await reader.cancel();
    else reader.releaseLock();
  }
  pager.finish();
  const page = pager.result();
  return {
    path,
    status: 'M',
    scope: 'now',
    ref: 'live',
    hunks: page.hunks,
    cursor: page.truncated ? encodeViewerCursor('h', page.nextIndex, version) : '',
    truncated: page.truncated,
    binary: false,
    fileFallback: false,
  };
}
