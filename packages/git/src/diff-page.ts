import { VIEWER_FIRST_PAINT_BYTES, VIEWER_FIRST_PAINT_LINES } from './viewer-limits';

export type DiffChange =
  | { type: 'normal'; content: string; oldLine: number; newLine: number }
  | { type: 'insert'; content: string; newLine: number }
  | { type: 'delete'; content: string; oldLine: number };

export interface DiffHunk {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  header: string;
  changes: DiffChange[];
}

export type HunkPageDecision = 'continue' | 'page_full';

export interface HunkPageResult {
  hunks: DiffHunk[];
  nextIndex: number;
  truncated: boolean;
}

const HUNK_RE = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

function hunkByteLength(hunk: DiffHunk): number {
  return Buffer.byteLength(JSON.stringify(hunk), 'utf8');
}

export class HunkPageAccumulator {
  private readonly startIndex: number;
  private seen = 0;
  private readonly hunks: DiffHunk[] = [];
  private byteCount = 0;
  private changeCount = 0;
  private truncated = false;

  constructor(startIndex: number) {
    this.startIndex = startIndex;
  }

  push(hunk: DiffHunk): HunkPageDecision {
    if (this.seen < this.startIndex) {
      this.seen += 1;
      return 'continue';
    }
    const nextBytes = this.byteCount + hunkByteLength(hunk);
    const nextChanges = this.changeCount + hunk.changes.length;
    if (
      this.hunks.length > 0 &&
      (nextBytes > VIEWER_FIRST_PAINT_BYTES || nextChanges > VIEWER_FIRST_PAINT_LINES)
    ) {
      this.truncated = true;
      return 'page_full';
    }
    this.hunks.push(hunk);
    this.byteCount = nextBytes;
    this.changeCount = nextChanges;
    this.seen += 1;
    return 'continue';
  }

  finish(): void {
    return;
  }

  result(): HunkPageResult {
    return {
      hunks: this.hunks,
      nextIndex: this.startIndex + this.hunks.length,
      truncated: this.truncated,
    };
  }
}

interface ParseState {
  current: DiffHunk | null;
  oldLine: number;
  newLine: number;
}

function applyDiffLine(
  state: ParseState,
  line: string,
  visit: (hunk: DiffHunk) => HunkPageDecision
): HunkPageDecision {
  const match = HUNK_RE.exec(line);
  if (match) {
    if (state.current !== null) {
      const decision = visit(state.current);
      state.current = null;
      if (decision === 'page_full') return 'page_full';
    }
    const hunk: DiffHunk = {
      oldStart: Number(match[1]),
      oldLines: Number(match[2] ?? '1'),
      newStart: Number(match[3]),
      newLines: Number(match[4] ?? '1'),
      header: line,
      changes: [],
    };
    state.current = hunk;
    state.oldLine = hunk.oldStart;
    state.newLine = hunk.newStart;
    return 'continue';
  }
  const current = state.current;
  if (current === null || line.startsWith('\\')) return 'continue';
  if (line.startsWith('+')) {
    current.changes.push({ type: 'insert', content: line.slice(1), newLine: state.newLine });
    state.newLine += 1;
  } else if (line.startsWith('-')) {
    current.changes.push({ type: 'delete', content: line.slice(1), oldLine: state.oldLine });
    state.oldLine += 1;
  } else if (line.startsWith(' ')) {
    current.changes.push({
      type: 'normal',
      content: line.slice(1),
      oldLine: state.oldLine,
      newLine: state.newLine,
    });
    state.oldLine += 1;
    state.newLine += 1;
  }
  return 'continue';
}

async function* iterateChunks(
  chunks: Iterable<Uint8Array> | AsyncIterable<Uint8Array>
): AsyncIterable<Uint8Array> {
  const asyncIterable = chunks as AsyncIterable<Uint8Array>;
  if (typeof asyncIterable[Symbol.asyncIterator] === 'function') {
    yield* asyncIterable;
    return;
  }
  yield* chunks as Iterable<Uint8Array>;
}

export async function visitUnifiedDiffChunks(
  chunks: Iterable<Uint8Array> | AsyncIterable<Uint8Array>,
  visit: (hunk: DiffHunk) => HunkPageDecision
): Promise<void> {
  const decoder = new TextDecoder();
  let pending = '';
  const state: ParseState = { current: null, oldLine: 0, newLine: 0 };

  const consumeLine = (line: string): boolean => applyDiffLine(state, line, visit) === 'page_full';

  for await (const chunk of iterateChunks(chunks)) {
    const text = pending + decoder.decode(chunk, { stream: true });
    const parts = text.split('\n');
    pending = parts.pop() ?? '';
    for (const line of parts) {
      if (consumeLine(line)) return;
    }
  }
  pending += decoder.decode();
  if (pending.length > 0 && consumeLine(pending)) return;
  if (state.current !== null) visit(state.current);
}

export async function parseUnifiedDiffChunks(
  chunks: Iterable<Uint8Array> | AsyncIterable<Uint8Array>
): Promise<DiffHunk[]> {
  const hunks: DiffHunk[] = [];
  await visitUnifiedDiffChunks(chunks, (hunk: DiffHunk): HunkPageDecision => {
    hunks.push(hunk);
    return 'continue';
  });
  return hunks;
}
