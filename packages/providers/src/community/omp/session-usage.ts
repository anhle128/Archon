/**
 * OMP hidden-session usage enrichment.
 *
 * Primary assistant usage comes from the live JSON stream. Advisors and
 * task-subagents write separate JSONL transcripts under the main session's
 * artifact directory (transcript path without `.jsonl`). This module reads
 * only those hidden transcripts after process exit, with fail-soft bounds and
 * resume/fork byte-delta safety so copied history is never double-counted.
 *
 * Session layouts (mirrored from OMP):
 * - main transcript: `<sessionDir>/<timestamp>_<sessionId>.jsonl`
 * - artifact dir: same path without `.jsonl`
 * - top-level advisor: `<artifactDir>/__advisor.jsonl` or `__advisor.<slug>.jsonl`
 * - task-agent: only stems proven by the immediate parent transcript's task
 *   spawn/lifecycle records (assistant `toolCall` name=task arguments.tasks[].name,
 *   or task toolResult details.progress/results[].id) plus exact filename constructors;
 *   ownership chains main → task → nested task (global stem membership never authorizes
 *   another subtree)
 * - nested advisor: advisor files under a proven parent task stem directory
 * Resolution order for sessionDir:
 * 1. exact `PI_CODING_AGENT_SESSION_DIR` from the spawned env
 * 2. `$PI_CODING_AGENT_DIR/sessions/<encoded-cwd>` or `~/.omp/agent/sessions/<encoded-cwd>`
 * 3. unproven layout → warn once and omit hidden usage
 */

import { createHash } from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

import { createLogger } from '@archon/paths';

import type { ModelUsageEntry, TokenUsage } from '../../types';
import { normalizeModelUsageEntry } from '../../usage-breakdown';
import { messageUsageToEntry } from './event-parser';

export const MAX_CANDIDATE_FILES = 1_000;
export const MAX_TOTAL_BYTES = 256 * 1024 * 1024;
export const MAX_FILE_BYTES = 64 * 1024 * 1024;
export const MAX_LINE_BYTES = 8 * 1024 * 1024;
/** Chunk size for bounded JSONL streaming (keeps multi-byte UTF-8 in the carry buffer). */
export const JSONL_READ_CHUNK_BYTES = 64 * 1024;

const ADVISOR_BASENAME = '__advisor.jsonl';
const ADVISOR_PREFIX = '__advisor.';
const JSONL_SUFFIX = '.jsonl';

/** Optional per-test bound overrides so exact/one-over cases need no multi-MiB fixtures. */
export interface SessionUsageBounds {
  maxCandidateFiles: number;
  maxTotalBytes: number;
  maxFileBytes: number;
  maxLineBytes: number;
}

let boundsOverride: Partial<SessionUsageBounds> | undefined;

/** Test-only: largest buffer allocated on the chunked prefix digest path. */
let observedMaxChunkAlloc = 0;

export function setSessionUsageBoundsForTest(bounds?: Partial<SessionUsageBounds>): void {
  boundsOverride = bounds;
}

export function resetObservedMaxChunkAllocForTest(): void {
  observedMaxChunkAlloc = 0;
}

export function getObservedMaxChunkAllocForTest(): number {
  return observedMaxChunkAlloc;
}

function noteChunkAlloc(bytes: number): void {
  if (bytes > observedMaxChunkAlloc) observedMaxChunkAlloc = bytes;
}

function bounds(): SessionUsageBounds {
  return {
    maxCandidateFiles: boundsOverride?.maxCandidateFiles ?? MAX_CANDIDATE_FILES,
    maxTotalBytes: boundsOverride?.maxTotalBytes ?? MAX_TOTAL_BYTES,
    maxFileBytes: boundsOverride?.maxFileBytes ?? MAX_FILE_BYTES,
    maxLineBytes: boundsOverride?.maxLineBytes ?? MAX_LINE_BYTES,
  };
}

let cachedLog: ReturnType<typeof createLogger> | undefined;
function getLog(): ReturnType<typeof createLogger> {
  if (!cachedLog) cachedLog = createLogger('provider.omp.session-usage');
  return cachedLog;
}

type JsonObject = Record<string, unknown>;

export interface FileSnapshot {
  relativePath: string;
  byteLength: number;
  prefixDigest: string;
  endsAtRecordBoundary: boolean;
  /** Classified during full-file snapshot validation. */
  kind: 'advisor' | 'subagent';
}
export interface SessionUsageSnapshot {
  /** Real path of the session directory used for the pre-spawn scan. */
  sessionDir: string;
  /** Real path of the source artifact directory when known. */
  artifactRoot?: string;
  files: readonly FileSnapshot[];
}

export interface HiddenSessionUsage {
  entries: ModelUsageEntry[];
  tokens: TokenUsage;
}

export interface ResolveSessionDirInput {
  env: Record<string, string | undefined>;
  cwd: string;
  homeDir?: string;
  tmpDir?: string;
}

export type ResolveSessionDirResult =
  | { ok: true; sessionDir: string; source: 'session_dir_env' | 'derived' }
  | { ok: false; reason: string };

function asObject(value: unknown): JsonObject | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as JsonObject)
    : undefined;
}

function stringField(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

/**
 * OMP advisor constructor (`__advisor.jsonl` or `__advisor.<slug>.jsonl`).
 * Mirrors OMP `YPe` / `c5n` filename helpers.
 */
export function isAdvisorFileName(name: string): boolean {
  return (
    name === ADVISOR_BASENAME ||
    (name.startsWith(ADVISOR_PREFIX) &&
      name.endsWith(JSONL_SUFFIX) &&
      name.length > ADVISOR_PREFIX.length + JSONL_SUFFIX.length)
  );
}

/**
 * OMP main transcript timestamp after `toISOString().replace(/[:.]/g, '-')`:
 * `YYYY-MM-DDTHH-mm-ss-sssZ` (colons and the millis dot become dashes).
 * Shape alone is insufficient — the prefix must round-trip to that canonical
 * UTC form so calendar-impossible decoys (month 13, Feb 30, hour 24, …) fail.
 */
const MAIN_TRANSCRIPT_TIMESTAMP_RE = /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z$/;

/**
 * True when `prefix` is exactly `new Date(iso).toISOString().replace(/[:.]/g, '-')`
 * for a real UTC instant. Reconstructs ISO 8601 from the dash form and requires
 * an identity round-trip; rolled-over or Invalid Date values are rejected.
 */
function isCanonicalMainTranscriptTimestamp(prefix: string): boolean {
  if (!MAIN_TRANSCRIPT_TIMESTAMP_RE.test(prefix)) return false;
  // YYYY-MM-DDTHH-mm-ss-sssZ → YYYY-MM-DDTHH:mm:ss.sssZ
  const iso = `${prefix.slice(0, 10)}T${prefix.slice(11, 13)}:${prefix.slice(14, 16)}:${prefix.slice(17, 19)}.${prefix.slice(20, 23)}Z`;
  const instant = new Date(iso);
  if (Number.isNaN(instant.getTime())) return false;
  return instant.toISOString().replace(/[:.]/g, '-') === prefix;
}

/**
 * OMP main transcript constructor under the session dir:
 * `${isoTimestampWithColonsDotsAsDashes}_<sessionId>.jsonl`.
 * Files matching this shape under an artifact dir are not task-agent constructors.
 * Suffix-only matches (`notes_<id>.jsonl`, bare `_<id>.jsonl`, malformed timestamps)
 * and calendar-impossible exact-width decoys are never main transcripts.
 */
export function isMainTranscriptFileName(name: string, sessionId: string): boolean {
  if (sessionId.length === 0) return false;
  const suffix = `_${sessionId}${JSONL_SUFFIX}`;
  if (!name.endsWith(suffix)) return false;
  if (isAdvisorFileName(name)) return false;
  // Exact constructor: one calendar-valid ISO-dash timestamp, nothing else before `_sessionId`.
  const prefix = name.slice(0, -suffix.length);
  return isCanonicalMainTranscriptTimestamp(prefix);
}

/**
 * Task-agent constructor under an artifact dir: any non-advisor `.jsonl` that is
 * not shaped like a main transcript for the owning session id.
 */
export function isTaskAgentFileName(name: string, sessionId: string): boolean {
  if (!name.endsWith(JSONL_SUFFIX) || isAdvisorFileName(name)) return false;
  if (isMainTranscriptFileName(name, sessionId)) return false;
  // OMP AgentOutputManager reserves only the advisor stem (bumped to __advisor-2 on
  // collision). Parent-transcript ownership still gates billing — bare __*.jsonl
  // without a proven task id is never listed.
  return name.length > JSONL_SUFFIX.length;
}

/**
 * Encode a cwd the way OMP's SessionManager does for per-project session folders.
 * Home-relative → `-<rel>`; tmp-relative → `-tmp-<rel>`; else `--<abs>--`.
 */
export function encodeOmpSessionCwdDirName(
  cwd: string,
  homeDir: string = os.homedir(),
  tmpDir: string = os.tmpdir()
): string {
  const resolvedCwd = path.resolve(cwd);
  const resolvedHome = path.resolve(homeDir);
  const resolvedTmp = path.resolve(tmpDir);
  const relHome = path.relative(resolvedHome, resolvedCwd);
  const relTmp = path.relative(resolvedTmp, resolvedCwd);
  if (relHome === '' || (!relHome.startsWith('..') && !path.isAbsolute(relHome))) {
    const encoded = relHome.replace(/[/\\:]/g, '-');
    return encoded.length > 0 ? `-${encoded}` : '-';
  }
  if (relTmp === '' || (!relTmp.startsWith('..') && !path.isAbsolute(relTmp))) {
    const encoded = relTmp.replace(/[/\\:]/g, '-');
    return encoded.length > 0 ? `-tmp-${encoded}` : '-tmp';
  }
  return `--${resolvedCwd.replace(/^[/\\]/, '').replace(/[/\\:]/g, '-')}--`;
}

/**
 * Resolve the per-cwd OMP session directory without moving or creating it.
 */
export function resolveOmpSessionDir(input: ResolveSessionDirInput): ResolveSessionDirResult {
  const sessionDirEnv = input.env.PI_CODING_AGENT_SESSION_DIR?.trim();
  if (sessionDirEnv && sessionDirEnv.length > 0) {
    return { ok: true, sessionDir: path.resolve(sessionDirEnv), source: 'session_dir_env' };
  }

  const agentDirRaw = input.env.PI_CODING_AGENT_DIR?.trim();
  const agentDir =
    agentDirRaw && agentDirRaw.length > 0
      ? path.resolve(agentDirRaw)
      : path.join(input.homeDir ?? os.homedir(), '.omp', 'agent');
  const encoded = encodeOmpSessionCwdDirName(
    input.cwd,
    input.homeDir ?? os.homedir(),
    input.tmpDir ?? os.tmpdir()
  );
  return {
    ok: true,
    sessionDir: path.join(agentDir, 'sessions', encoded),
    source: 'derived',
  };
}

function emptySha256Hex(): string {
  return createHash('sha256').update(Buffer.alloc(0)).digest('hex');
}

function isPathInsideRoot(rootReal: string, candidateReal: string): boolean {
  const rel = path.relative(rootReal, candidateReal);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

async function safeRealPath(target: string): Promise<string | undefined> {
  try {
    return await fs.realpath(target);
  } catch {
    return undefined;
  }
}

/**
 * Find the exact OMP main transcript under sessionDir.
 * Uses {@link isMainTranscriptFileName} only — suffix decoys never match.
 */
export async function findMainTranscriptPath(
  sessionDir: string,
  sessionId: string
): Promise<string | undefined> {
  let entries: { name: string; isFile(): boolean }[];
  try {
    entries = await fs.readdir(sessionDir, { withFileTypes: true });
  } catch {
    return undefined;
  }
  const matches = entries
    .filter(entry => entry.isFile() && isMainTranscriptFileName(entry.name, sessionId))
    .map(entry => path.join(sessionDir, entry.name));
  if (matches.length === 1) return matches[0];
  if (matches.length > 1) {
    // Fail closed: never resolve ambiguity by newest filename.
    getLog().warn(
      { issue: 'ambiguous_main_transcript', count: matches.length },
      'omp.session_usage_main_ambiguous'
    );
    return undefined;
  }
  return undefined;
}

interface OpenedFile {
  handle: fs.FileHandle;
  size: number;
  realPath: string;
  dev: number;
  ino: number;
}

async function openVerifiedFile(
  filePath: string,
  rootReal: string,
  expected?: { realPath: string; dev: number; ino: number }
): Promise<OpenedFile | undefined> {
  let lstat;
  try {
    lstat = await fs.lstat(filePath);
  } catch {
    return undefined;
  }
  if (lstat.isSymbolicLink() || !lstat.isFile()) {
    getLog().warn(
      { pathKind: lstat.isSymbolicLink() ? 'symlink' : 'non_file' },
      'omp.session_usage_path_rejected'
    );
    return undefined;
  }
  const realPath = await safeRealPath(filePath);
  if (!realPath || !isPathInsideRoot(rootReal, realPath)) {
    getLog().warn({ issue: 'path_escape' }, 'omp.session_usage_path_rejected');
    return undefined;
  }
  if (
    expected &&
    (realPath !== expected.realPath || lstat.dev !== expected.dev || lstat.ino !== expected.ino)
  ) {
    getLog().warn({ issue: 'discovery_identity_mismatch' }, 'omp.session_usage_path_rejected');
    return undefined;
  }
  let handle: fs.FileHandle;
  try {
    handle = await fs.open(realPath, 'r');
  } catch {
    return undefined;
  }
  try {
    const st = await handle.stat();
    if (!st.isFile() || st.size !== lstat.size || st.dev !== lstat.dev || st.ino !== lstat.ino) {
      await handle.close();
      getLog().warn({ issue: 'identity_mismatch' }, 'omp.session_usage_path_rejected');
      return undefined;
    }
    if (
      expected &&
      (st.dev !== expected.dev || st.ino !== expected.ino || realPath !== expected.realPath)
    ) {
      await handle.close();
      getLog().warn({ issue: 'discovery_identity_mismatch' }, 'omp.session_usage_path_rejected');
      return undefined;
    }
    return {
      handle,
      size: st.size,
      realPath,
      dev: st.dev,
      ino: st.ino,
    };
  } catch {
    await handle.close().catch(() => undefined);
    return undefined;
  }
}

/**
 * SHA-256 a prefix through fixed-size chunks. Never allocates `byteLength`.
 * Optionally scans JSONL lines in the same pass for a session header.
 */
async function digestPrefixFromHandle(
  handle: fs.FileHandle,
  byteLength: number,
  options?: { scanSessionHeader?: boolean }
): Promise<
  | {
      digest: string;
      endsAtRecordBoundary: boolean;
      hasSessionHeader: boolean;
      bytesHashed: number;
    }
  | { error: 'read_short' | 'line_too_large' }
> {
  if (byteLength <= 0) {
    return {
      digest: emptySha256Hex(),
      endsAtRecordBoundary: true,
      hasSessionHeader: false,
      bytesHashed: 0,
    };
  }

  const hash = createHash('sha256');
  const chunk = Buffer.alloc(JSONL_READ_CHUNK_BYTES);
  noteChunkAlloc(JSONL_READ_CHUNK_BYTES);
  let pos = 0;
  let lastByte = 0;
  let carry = Buffer.alloc(0);
  noteChunkAlloc(0);
  let hasSessionHeader = false;
  // When true: track every JSONL line size through the full prefix and look for a
  // session header. Finding the header must NOT stop size tracking — a later
  // oversize historical line still fails closed.
  const trackLines = options?.scanSessionHeader === true;

  while (pos < byteLength) {
    const toRead = Math.min(JSONL_READ_CHUNK_BYTES, byteLength - pos);
    const { bytesRead } = await handle.read(chunk, 0, toRead, pos);
    if (bytesRead === 0) return { error: 'read_short' };
    const slice = chunk.subarray(0, bytesRead);
    hash.update(slice);
    lastByte = slice[bytesRead - 1] ?? 0;
    pos += bytesRead;

    if (!trackLines) continue;

    const data = carry.length === 0 ? Buffer.from(slice) : Buffer.concat([carry, slice]);
    noteChunkAlloc(data.length);
    let lineStart = 0;
    for (let i = 0; i < data.length; i++) {
      if (data[i] !== 0x0a) continue;
      let lineBuf = data.subarray(lineStart, i);
      if (lineBuf.length > 0 && lineBuf[lineBuf.length - 1] === 0x0d) {
        lineBuf = lineBuf.subarray(0, lineBuf.length - 1);
      }
      lineStart = i + 1;
      if (lineBuf.length > bounds().maxLineBytes) return { error: 'line_too_large' };
      // Only JSON-parse until the session header is proven; size checks continue.
      if (hasSessionHeader || lineBuf.length === 0) continue;
      try {
        const parsed: unknown = JSON.parse(lineBuf.toString('utf8'));
        const obj = asObject(parsed);
        if (obj?.type === 'session' && stringField(obj.id)) {
          hasSessionHeader = true;
        }
      } catch {
        // Malformed lines are ignored for header proof; digest still covers them.
      }
    }
    carry = lineStart >= data.length ? Buffer.alloc(0) : Buffer.from(data.subarray(lineStart));
    noteChunkAlloc(carry.length);
    if (carry.length > bounds().maxLineBytes) return { error: 'line_too_large' };
  }

  if (trackLines && !hasSessionHeader && carry.length > 0) {
    let lineBuf = carry;
    if (lineBuf[lineBuf.length - 1] === 0x0d) {
      lineBuf = lineBuf.subarray(0, lineBuf.length - 1);
    }
    if (lineBuf.length > bounds().maxLineBytes) return { error: 'line_too_large' };
    try {
      const parsed: unknown = JSON.parse(lineBuf.toString('utf8'));
      const obj = asObject(parsed);
      if (obj?.type === 'session' && stringField(obj.id)) hasSessionHeader = true;
    } catch {
      // ignore
    }
  }

  return {
    digest: hash.digest('hex'),
    endsAtRecordBoundary: lastByte === 0x0a,
    hasSessionHeader,
    bytesHashed: pos,
  };
}

async function* iterateJsonlLinesFromHandle(
  handle: fs.FileHandle,
  start: number,
  end: number
): AsyncGenerator<{ line: string; lineBytes: number } | { omitAll: true; issue: string }> {
  if (start < 0 || start > end) return;
  let pos = start;
  let carry = Buffer.alloc(0);
  const chunk = Buffer.alloc(JSONL_READ_CHUNK_BYTES);
  noteChunkAlloc(JSONL_READ_CHUNK_BYTES);

  while (pos < end) {
    const toRead = Math.min(JSONL_READ_CHUNK_BYTES, end - pos);
    const { bytesRead } = await handle.read(chunk, 0, toRead, pos);
    if (bytesRead === 0) break;
    pos += bytesRead;

    const data =
      carry.length === 0
        ? Buffer.from(chunk.subarray(0, bytesRead))
        : Buffer.concat([carry, chunk.subarray(0, bytesRead)]);
    noteChunkAlloc(data.length);
    let lineStart = 0;
    for (let i = 0; i < data.length; i++) {
      if (data[i] !== 0x0a) continue;
      let lineBuf = data.subarray(lineStart, i);
      if (lineBuf.length > 0 && lineBuf[lineBuf.length - 1] === 0x0d) {
        lineBuf = lineBuf.subarray(0, lineBuf.length - 1);
      }
      if (lineBuf.length > bounds().maxLineBytes) {
        yield { omitAll: true, issue: 'line_too_large' };
        return;
      }
      yield { line: lineBuf.toString('utf8'), lineBytes: lineBuf.length };
      lineStart = i + 1;
    }
    // Copy residual bytes — must not alias the reused read chunk.
    carry = lineStart >= data.length ? Buffer.alloc(0) : Buffer.from(data.subarray(lineStart));
    noteChunkAlloc(carry.length);
    if (carry.length > bounds().maxLineBytes) {
      yield { omitAll: true, issue: 'line_too_large' };
      return;
    }
  }

  if (carry.length > 0) {
    let lineBuf = carry;
    if (lineBuf[lineBuf.length - 1] === 0x0d) {
      lineBuf = lineBuf.subarray(0, lineBuf.length - 1);
    }
    if (lineBuf.length > bounds().maxLineBytes) {
      yield { omitAll: true, issue: 'line_too_large' };
      return;
    }
    yield { line: lineBuf.toString('utf8'), lineBytes: lineBuf.length };
  }
}

/**
 * Collect task-agent stems proven by a parent transcript on one verified handle.
 * Ownership sources (supported OMP parent-session format):
 * - assistant toolCall name=task → arguments.tasks[].name / .id
 * - toolResult toolName=task → details.progress[].id / details.results[].id
 * - custom tool_execution_start toolName=task → taskId/name/tasks[]
 * A bare session-shaped child JSONL is never enough.
 *
 * Main transcripts pass `expectedSessionId` (header id must match or enrichment omits).
 * Nested task parents omit `expectedSessionId`. Soft header/open failures return
 * `{ unverified: true }` so callers do not descend into the artifact subtree; a
 * verified parent with zero child stems still returns `{ stems }` (empty) and may
 * host nested advisors.
 */

function collectTaskStemFromUnknown(value: unknown, into: Set<string>): void {
  if (
    typeof value === 'string' &&
    value.length > 0 &&
    !value.includes('/') &&
    !value.includes('\\')
  ) {
    into.add(value);
  }
}

function extractTaskStemsFromRecord(obj: JsonObject, into: Set<string>): void {
  if (obj.type === 'message') {
    const message = asObject(obj.message);
    if (!message) return;
    const role = stringField(message.role);
    if (role === 'assistant') {
      const content = message.content;
      if (!Array.isArray(content)) return;
      for (const item of content) {
        const call = asObject(item);
        if (!call) continue;
        if (stringField(call.type) !== 'toolCall') continue;
        if (stringField(call.name) !== 'task') continue;
        let args: unknown = call.arguments ?? call.args ?? call.input;
        if (typeof args === 'string') {
          try {
            args = JSON.parse(args);
          } catch {
            continue;
          }
        }
        const argsObj = asObject(args);
        const tasks = argsObj?.tasks;
        if (!Array.isArray(tasks)) continue;
        for (const task of tasks) {
          const taskObj = asObject(task);
          if (!taskObj) continue;
          collectTaskStemFromUnknown(taskObj.name, into);
          collectTaskStemFromUnknown(taskObj.id, into);
        }
      }
      return;
    }
    if (role === 'toolResult' && stringField(message.toolName) === 'task') {
      const details = asObject(message.details);
      if (!details) return;
      for (const key of ['progress', 'results'] as const) {
        const rows = details[key];
        if (!Array.isArray(rows)) continue;
        for (const row of rows) {
          const rowObj = asObject(row);
          if (!rowObj) continue;
          collectTaskStemFromUnknown(rowObj.id, into);
          collectTaskStemFromUnknown(rowObj.name, into);
        }
      }
    }
    return;
  }

  if (obj.type === 'custom' && stringField(obj.customType) === 'tool_execution_start') {
    const data = asObject(obj.data);
    if (!data || stringField(data.toolName) !== 'task') return;
    // Start events often omit task ids; still accept explicit ids/names when present.
    collectTaskStemFromUnknown(data.taskId, into);
    collectTaskStemFromUnknown(data.name, into);
    const tasks = data.tasks;
    if (Array.isArray(tasks)) {
      for (const task of tasks) {
        const taskObj = asObject(task);
        if (!taskObj) continue;
        collectTaskStemFromUnknown(taskObj.name, into);
        collectTaskStemFromUnknown(taskObj.id, into);
      }
    }
  }
}

export async function extractOwnedTaskStemsFromParent(
  transcriptPath: string,
  rootReal: string,
  options?: {
    expectedSessionId?: string;
    expectedCwd?: string;
    expectedIdentity?: { realPath: string; dev: number; ino: number };
  }
): Promise<
  { stems: Set<string> } | { unverified: true; reason: string } | { omit: true; reason: string }
> {
  const expectedSessionId = options?.expectedSessionId;
  const expectedCwd = options?.expectedCwd;
  const strictHeader = expectedSessionId !== undefined;

  const opened = await openVerifiedFile(transcriptPath, rootReal, options?.expectedIdentity);
  if (!opened) {
    return strictHeader
      ? { omit: true, reason: 'main_open_failed' }
      : { unverified: true, reason: 'parent_open_failed' };
  }
  if (opened.size > bounds().maxFileBytes) {
    await opened.handle.close().catch(() => undefined);
    getLog().warn(
      { issue: 'file_too_large', bound: bounds().maxFileBytes },
      'omp.session_usage_bound_exceeded'
    );
    return { omit: true, reason: 'file_too_large' };
  }

  const stems = new Set<string>();
  let headerOk = false;
  try {
    for await (const item of iterateJsonlLinesFromHandle(opened.handle, 0, opened.size)) {
      if ('omitAll' in item) {
        getLog().warn({ issue: item.issue }, 'omp.session_usage_bound_exceeded');
        return { omit: true, reason: item.issue };
      }
      const { line } = item;
      if (line.trim().length === 0) continue;
      let parsed: unknown;
      try {
        parsed = JSON.parse(line);
      } catch {
        continue;
      }
      const obj = asObject(parsed);
      if (!obj) continue;

      if (obj.type === 'session') {
        const id = stringField(obj.id);
        if (!id) continue;
        if (expectedSessionId !== undefined && id !== expectedSessionId) {
          return { omit: true, reason: 'header_mismatch' };
        }
        if (expectedCwd !== undefined) {
          const headerCwd = stringField(obj.cwd);
          if (!headerCwd || path.resolve(headerCwd) !== path.resolve(expectedCwd)) {
            return strictHeader
              ? { omit: true, reason: 'header_mismatch' }
              : { unverified: true, reason: 'header_mismatch' };
          }
        }
        headerOk = true;
        continue;
      }

      // Ownership records are only trusted after the matching session header on this handle.
      if (!headerOk) continue;
      extractTaskStemsFromRecord(obj, stems);
    }
    if (!headerOk) {
      return strictHeader
        ? { omit: true, reason: 'header_mismatch' }
        : { unverified: true, reason: 'header_mismatch' };
    }
    return { stems };
  } catch {
    return strictHeader
      ? { omit: true, reason: 'main_read_failed' }
      : { unverified: true, reason: 'parent_read_failed' };
  } finally {
    await opened.handle.close().catch(() => undefined);
  }
}

/** Main-transcript ownership extract — session id is required and fail-closed. */
export async function extractOwnedTaskStemsFromMain(
  transcriptPath: string,
  sessionDirReal: string,
  sessionId: string,
  expectedCwd?: string
): Promise<{ stems: Set<string> } | { omit: true; reason: string }> {
  const result = await extractOwnedTaskStemsFromParent(transcriptPath, sessionDirReal, {
    expectedSessionId: sessionId,
    expectedCwd,
  });
  // Main path never returns unverified; collapse the discriminant for callers.
  if ('unverified' in result) {
    return { omit: true, reason: result.reason };
  }
  return result;
}

/**
 * Validate main transcript session header id (+ optional cwd) by streaming.
 * Returns true when a matching session record is found before any other session id conflict.
 */
export async function validateMainSessionHeader(
  transcriptPath: string,
  sessionDirReal: string,
  sessionId: string,
  expectedCwd?: string
): Promise<boolean> {
  const opened = await openVerifiedFile(transcriptPath, sessionDirReal);
  if (!opened) return false;
  if (opened.size > bounds().maxFileBytes) {
    await opened.handle.close().catch(() => undefined);
    getLog().warn(
      { issue: 'file_too_large', bound: bounds().maxFileBytes },
      'omp.session_usage_bound_exceeded'
    );
    return false;
  }

  try {
    for await (const item of iterateJsonlLinesFromHandle(opened.handle, 0, opened.size)) {
      if ('omitAll' in item) {
        getLog().warn({ issue: item.issue }, 'omp.session_usage_bound_exceeded');
        return false;
      }
      const { line } = item;
      if (line.trim().length === 0) continue;
      let parsed: unknown;
      try {
        parsed = JSON.parse(line);
      } catch {
        continue;
      }
      const obj = asObject(parsed);
      if (obj?.type !== 'session') continue;
      const id = stringField(obj.id);
      if (!id) continue;
      if (id !== sessionId) return false;
      if (expectedCwd !== undefined) {
        const headerCwd = stringField(obj.cwd);
        if (!headerCwd || path.resolve(headerCwd) !== path.resolve(expectedCwd)) return false;
      }
      return true;
    }
    return false;
  } catch {
    return false;
  } finally {
    await opened.handle.close().catch(() => undefined);
  }
}

interface CandidateFile {
  absolutePath: string;
  relativePath: string;
  kind: 'advisor' | 'subagent';
  size: number;
  /** Discovery-time identity; verified open must match or the candidate is rejected. */
  dev: number;
  ino: number;
}

/**
 * Recursively list JSONL candidates under the artifact root using OMP constructors
 * plus immediate-parent-proven task stems:
 * - advisors: `__advisor.jsonl` / `__advisor.<slug>.jsonl` (constructor is ownership
 *   inside a proven artifact subtree — root or `<ownedTask>/`)
 * - task agents: filename constructor AND stem ∈ stems authorized by the immediate
 *   parent of this directory (main at root; the parent task transcript one level up)
 * - nested dirs: only `<taskStem>/` beside an accepted owned task-agent file; child
 *   stems are derived from that parent file on a verified handle (not a global set)
 * Discovery sizes are advisory early exits; authoritative totals use verified open sizes.
 */
async function listHiddenCandidates(
  artifactRootReal: string,
  sessionId: string,
  rootOwnedStems: ReadonlySet<string>,
  expectedCwd?: string
): Promise<{ candidates: CandidateFile[] } | { omit: true; reason: string }> {
  const candidates: CandidateFile[] = [];
  let discoveryTotalBytes = 0;
  // Only descend into `<taskStem>/` dirs that sit beside an accepted task-agent file.
  // Each stack entry carries stems proven by that directory's immediate parent only.
  const stack: { dir: string; ownedStems: ReadonlySet<string> }[] = [
    { dir: artifactRootReal, ownedStems: rootOwnedStems },
  ];

  while (stack.length > 0) {
    const frame = stack.pop();
    if (!frame) break;
    const { dir, ownedStems: levelOwnedStems } = frame;
    let entries: {
      name: string;
      isDirectory(): boolean;
      isFile(): boolean;
      isSymbolicLink(): boolean;
    }[];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }

    // Child stems authorized under each accepted task file at this level (parent-local).
    const childStemsByTask = new Map<string, ReadonlySet<string>>();
    const nestedDirs: string[] = [];

    for (const entry of entries) {
      const abs = path.join(dir, entry.name);
      if (entry.isSymbolicLink()) {
        getLog().warn({ issue: 'symlink' }, 'omp.session_usage_path_rejected');
        continue;
      }
      if (entry.isDirectory()) {
        nestedDirs.push(abs);
        continue;
      }
      if (!entry.isFile() || !entry.name.endsWith(JSONL_SUFFIX)) continue;

      const isAdvisor = isAdvisorFileName(entry.name);
      const isTaskConstructor = isTaskAgentFileName(entry.name, sessionId);
      const taskStem = isTaskConstructor ? entry.name.slice(0, -JSONL_SUFFIX.length) : undefined;
      const isOwnedTask = taskStem !== undefined && levelOwnedStems.has(taskStem);
      if (!isAdvisor && !isOwnedTask) {
        // Unrelated constructor, unowned Orphan.jsonl, reserved __*, etc. — never bill.
        continue;
      }

      if (candidates.length >= bounds().maxCandidateFiles) {
        getLog().warn(
          { issue: 'too_many_files', bound: bounds().maxCandidateFiles },
          'omp.session_usage_bound_exceeded'
        );
        return { omit: true, reason: 'too_many_files' };
      }
      let st;
      try {
        st = await fs.lstat(abs);
      } catch {
        continue;
      }
      if (st.isSymbolicLink() || !st.isFile()) continue;
      if (st.size > bounds().maxFileBytes) {
        getLog().warn(
          { issue: 'file_too_large', bound: bounds().maxFileBytes },
          'omp.session_usage_bound_exceeded'
        );
        return { omit: true, reason: 'file_too_large' };
      }
      discoveryTotalBytes += st.size;
      if (discoveryTotalBytes > bounds().maxTotalBytes) {
        getLog().warn(
          { issue: 'total_bytes', bound: bounds().maxTotalBytes },
          'omp.session_usage_bound_exceeded'
        );
        return { omit: true, reason: 'total_bytes' };
      }
      const realFile = await safeRealPath(abs);
      if (!realFile || !isPathInsideRoot(artifactRootReal, realFile)) {
        getLog().warn({ issue: 'path_escape' }, 'omp.session_usage_path_rejected');
        continue;
      }
      const relativePath = path.relative(artifactRootReal, realFile);
      if (isOwnedTask && taskStem) {
        // Derive child stems only from a verified parent handle — never a global set.
        // Unverified parents stay billable as candidates but do not authorize a subtree.
        const childOwned = await extractOwnedTaskStemsFromParent(realFile, artifactRootReal, {
          expectedCwd,
          expectedIdentity: { realPath: realFile, dev: st.dev, ino: st.ino },
        });
        if ('omit' in childOwned) return { omit: true, reason: childOwned.reason };
        if (!('unverified' in childOwned)) {
          childStemsByTask.set(taskStem, childOwned.stems);
        }
      }
      candidates.push({
        absolutePath: realFile,
        relativePath,
        kind: isAdvisor ? 'advisor' : 'subagent',
        size: st.size,
        dev: st.dev,
        ino: st.ino,
      });
    }

    for (const abs of nestedDirs) {
      const name = path.basename(abs);
      // Nested artifact dirs exist only beside an owned task-agent transcript of the same stem
      // (OMP: artifactsDir = sessionFile without `.jsonl`). Orphan dirs are ignored.
      // Child stems come solely from that parent transcript — not from main or siblings.
      if (!childStemsByTask.has(name)) continue;
      const realDir = await safeRealPath(abs);
      if (!realDir || !isPathInsideRoot(artifactRootReal, realDir)) {
        getLog().warn({ issue: 'path_escape' }, 'omp.session_usage_path_rejected');
        continue;
      }
      stack.push({
        dir: realDir,
        ownedStems: childStemsByTask.get(name) ?? new Set<string>(),
      });
    }
  }

  // Parents before descendants so resume/fork subtree-omit sees the parent first.
  candidates.sort((a, b) => {
    const depth = (rel: string): number => rel.split(/[/\\]/).filter(Boolean).length;
    const da = depth(a.relativePath);
    const db = depth(b.relativePath);
    if (da !== db) return da - db;
    return a.relativePath.localeCompare(b.relativePath);
  });
  return { candidates };
}

type SnapshotFileResult =
  | { status: 'ok'; snap: FileSnapshot; openedSize: number }
  | { status: 'skip' }
  | { status: 'omit_all'; reason: string };

async function snapshotFile(
  absolutePath: string,
  relativePath: string,
  rootReal: string,
  kind: 'advisor' | 'subagent',
  expected?: { realPath: string; dev: number; ino: number }
): Promise<SnapshotFileResult> {
  const opened = await openVerifiedFile(absolutePath, rootReal, expected);
  if (!opened) return { status: 'skip' };
  try {
    if (opened.size > bounds().maxFileBytes) {
      getLog().warn(
        { issue: 'file_too_large', bound: bounds().maxFileBytes },
        'omp.session_usage_bound_exceeded'
      );
      return { status: 'omit_all', reason: 'file_too_large' };
    }
    const scanned = await digestPrefixFromHandle(opened.handle, opened.size, {
      scanSessionHeader: true,
    });
    if ('error' in scanned) {
      if (scanned.error === 'line_too_large') {
        getLog().warn({ issue: 'line_too_large' }, 'omp.session_usage_bound_exceeded');
        return { status: 'omit_all', reason: 'line_too_large' };
      }
      return { status: 'skip' };
    }
    // Empty new files are allowed; non-empty candidates must prove a session header.
    if (scanned.bytesHashed > 0 && !scanned.hasSessionHeader) return { status: 'skip' };
    return {
      status: 'ok',
      openedSize: opened.size,
      snap: {
        relativePath,
        byteLength: scanned.bytesHashed,
        prefixDigest: scanned.digest,
        endsAtRecordBoundary: scanned.endsAtRecordBoundary,
        kind,
      },
    };
  } finally {
    await opened.handle.close().catch(() => undefined);
  }
}

/**
 * Snapshot hidden JSONL files under the source session artifact dir before resume/fork spawn.
 * Returns null when the layout cannot be established (caller must skip enrichment).
 */
export async function snapshotHiddenSessionFiles(input: {
  env: Record<string, string | undefined>;
  cwd: string;
  resumeSessionId: string;
  homeDir?: string;
  tmpDir?: string;
}): Promise<SessionUsageSnapshot | null> {
  const resolved = resolveOmpSessionDir(input);
  if (!resolved.ok) return null;

  const sessionDirReal = await safeRealPath(resolved.sessionDir);
  if (!sessionDirReal) {
    getLog().warn({ reason: 'session_dir_missing' }, 'omp.session_usage_snapshot_skipped');
    return null;
  }

  const mainTranscript = await findMainTranscriptPath(sessionDirReal, input.resumeSessionId);
  if (!mainTranscript) {
    getLog().warn({ reason: 'main_transcript_missing' }, 'omp.session_usage_snapshot_skipped');
    return null;
  }

  const owned = await extractOwnedTaskStemsFromMain(
    mainTranscript,
    sessionDirReal,
    input.resumeSessionId,
    input.cwd
  );
  if ('omit' in owned) {
    getLog().warn({ reason: owned.reason }, 'omp.session_usage_snapshot_skipped');
    return null;
  }

  const artifactRoot = mainTranscript.endsWith(JSONL_SUFFIX)
    ? mainTranscript.slice(0, -JSONL_SUFFIX.length)
    : undefined;
  if (!artifactRoot) return null;

  const artifactRootReal = await safeRealPath(artifactRoot);
  if (!artifactRootReal) {
    // No artifact dir yet — empty snapshot is valid for a session without prior hidden files.
    return { sessionDir: sessionDirReal, files: [] };
  }
  if (!isPathInsideRoot(sessionDirReal, artifactRootReal)) {
    getLog().warn({ reason: 'artifact_escape' }, 'omp.session_usage_snapshot_skipped');
    return null;
  }

  const listed = await listHiddenCandidates(
    artifactRootReal,
    input.resumeSessionId,
    owned.stems,
    input.cwd
  );
  if ('omit' in listed) return null;

  const files: FileSnapshot[] = [];
  let actualTotalBytes = 0;
  for (const candidate of listed.candidates) {
    const snap = await snapshotFile(
      candidate.absolutePath,
      candidate.relativePath,
      artifactRootReal,
      candidate.kind,
      {
        realPath: candidate.absolutePath,
        dev: candidate.dev,
        ino: candidate.ino,
      }
    );
    if (snap.status === 'omit_all') {
      getLog().warn({ reason: snap.reason }, 'omp.session_usage_snapshot_skipped');
      return null;
    }
    if (snap.status === 'skip') {
      getLog().warn({ reason: 'candidate_snapshot_failed' }, 'omp.session_usage_snapshot_skipped');
      return null;
    }
    actualTotalBytes += snap.openedSize;
    if (actualTotalBytes > bounds().maxTotalBytes) {
      getLog().warn(
        { issue: 'total_bytes', bound: bounds().maxTotalBytes },
        'omp.session_usage_bound_exceeded'
      );
      return null;
    }
    files.push(snap.snap);
  }
  return { sessionDir: sessionDirReal, artifactRoot: artifactRootReal, files };
}

function emptyTokens(): TokenUsage {
  return { input: 0, output: 0, total: 0, cost: 0 };
}

/**
 * Hidden legacy totals mirror Pi `totalTokens` categories: input + output +
 * cache-read + cache-write. Reasoning stays an output subset and is not added again.
 */
function addTokens(acc: TokenUsage, entry: ModelUsageEntry): TokenUsage {
  const input = entry.inputTokens ?? 0;
  const output = entry.outputTokens ?? 0;
  const cacheRead = entry.cacheReadTokens ?? 0;
  const cacheWrite = entry.cacheWriteTokens ?? 0;
  return {
    input: acc.input + input,
    output: acc.output + output,
    total: (acc.total ?? 0) + input + output + cacheRead + cacheWrite,
    cost: (acc.cost ?? 0) + (entry.costUsd ?? 0),
  };
}

export type ParseTranscriptResult =
  | { status: 'ok'; entries: ModelUsageEntry[]; openedSize: number }
  | { status: 'skip' }
  | { status: 'omit_all' };

export interface ParseTranscriptOptions {
  requireSessionHeader?: boolean;
  /**
   * When set, prefix digest verification and delta parsing share one verified open
   * handle so a pathname swap after verification cannot redirect the reader.
   */
  expectedPrefix?: { byteLength: number; digest: string };
  /**
   * Discovery-time file identity; open must resolve to the same real path/dev/ino.
   */
  expectedIdentity?: { realPath: string; dev: number; ino: number };
  /**
   * Test seam: runs after prefix verification (when expectedPrefix is set) and
   * before delta parsing, still holding the original open handle.
   */
  afterPrefixVerified?: () => Promise<void>;
}

/**
 * Stream-parse assistant usage rows from a JSONL transcript starting at byteOffset.
 * Never returns prompt/response content — only normalized usage entries.
 * Reads are chunked; the remaining file is never allocated as one buffer.
 */
export async function parseTranscriptUsageEntries(
  filePath: string,
  rootReal: string,
  kind: 'advisor' | 'subagent',
  byteOffset: number,
  options?: ParseTranscriptOptions
): Promise<ParseTranscriptResult> {
  const requireSessionHeader = options?.requireSessionHeader ?? byteOffset === 0;
  const opened = await openVerifiedFile(filePath, rootReal, options?.expectedIdentity);
  if (!opened) return { status: 'skip' };
  if (opened.size > bounds().maxFileBytes) {
    await opened.handle.close().catch(() => undefined);
    getLog().warn({ issue: 'file_too_large' }, 'omp.session_usage_bound_exceeded');
    return { status: 'omit_all' };
  }

  const entries: ModelUsageEntry[] = [];
  // Trusted resume/fork deltas were validated at snapshot time; appended slices
  // intentionally omit the historical session header.
  let sawSessionHeader = !requireSessionHeader;
  try {
    let readStart = byteOffset;

    if (options?.expectedPrefix) {
      const { byteLength, digest } = options.expectedPrefix;
      if (byteLength < 0 || opened.size < byteLength) {
        getLog().warn({ issue: 'prefix_mismatch' }, 'omp.session_usage_file_omitted');
        return { status: 'skip' };
      }
      const scanned = await digestPrefixFromHandle(opened.handle, byteLength);
      if ('error' in scanned || scanned.bytesHashed !== byteLength || scanned.digest !== digest) {
        getLog().warn({ issue: 'prefix_mismatch' }, 'omp.session_usage_file_omitted');
        return { status: 'skip' };
      }
      readStart = byteLength;
      if (options.afterPrefixVerified) {
        await options.afterPrefixVerified();
      }
      if (opened.size === readStart) {
        return { status: 'ok', entries: [], openedSize: opened.size };
      }
    } else if (byteOffset > opened.size) {
      return { status: 'skip' };
    }

    for await (const item of iterateJsonlLinesFromHandle(opened.handle, readStart, opened.size)) {
      if ('omitAll' in item) {
        getLog().warn({ issue: item.issue }, 'omp.session_usage_bound_exceeded');
        return { status: 'omit_all' };
      }
      const { line } = item;
      if (line.trim().length === 0) continue;
      let parsed: unknown;
      try {
        parsed = JSON.parse(line);
      } catch {
        getLog().warn({ issue: 'malformed_jsonl' }, 'omp.session_usage_line_omitted');
        continue;
      }
      const obj = asObject(parsed);
      if (!obj) continue;
      if (obj.type === 'session') {
        if (!stringField(obj.id)) continue;
        sawSessionHeader = true;
        continue;
      }
      if (!sawSessionHeader) continue;
      if (obj.type !== 'message') continue;
      const message = asObject(obj.message);
      if (!message || stringField(message.role) !== 'assistant') continue;
      const usage = asObject(message.usage);
      if (!usage) continue;
      const rawEntry = messageUsageToEntry(message, usage, kind);
      if (!rawEntry) continue;
      const normalized = normalizeModelUsageEntry(rawEntry);
      if (!normalized.ok) {
        getLog().warn({ issue: normalized.issue }, 'omp.session_usage_entry_rejected');
        continue;
      }
      entries.push(normalized.entry);
    }
  } catch {
    getLog().warn({ issue: 'read_failed' }, 'omp.session_usage_file_omitted');
    return { status: 'skip' };
  } finally {
    await opened.handle.close().catch(() => undefined);
  }
  if (requireSessionHeader && !sawSessionHeader) {
    getLog().warn({ issue: 'unsupported_jsonl_layout' }, 'omp.session_usage_file_omitted');
    return { status: 'skip' };
  }
  return { status: 'ok', entries, openedSize: opened.size };
}

/**
 * Collect advisor/subagent usage for the destination session after OMP exits.
 * Fail-soft: returns undefined (omit) on layout/bounds failures; never throws into the provider status path.
 */
export async function collectHiddenSessionUsage(input: {
  env: Record<string, string | undefined>;
  cwd: string;
  sessionId: string;
  noSession?: boolean;
  /** Pre-spawn snapshot for resume/fork. null = snapshot failed → skip. undefined = fresh. */
  snapshot?: SessionUsageSnapshot | null;
  homeDir?: string;
  tmpDir?: string;
  /**
   * Test seam: after candidate discovery, before verified opens/parsing.
   * Used to prove growth/replacement races are fail-closed on actual opened sizes.
   */
  afterCandidatesListed?: (
    candidates: readonly { relativePath: string; absolutePath: string }[]
  ) => Promise<void>;
}): Promise<HiddenSessionUsage | undefined> {
  if (input.noSession) return undefined;
  if (input.snapshot === null) {
    getLog().warn({ reason: 'snapshot_unavailable' }, 'omp.session_usage_omitted');
    return undefined;
  }

  const resolved = resolveOmpSessionDir(input);
  if (!resolved.ok) {
    getLog().warn({ reason: resolved.reason }, 'omp.session_usage_omitted');
    return undefined;
  }

  const sessionDirReal = await safeRealPath(resolved.sessionDir);
  if (!sessionDirReal) {
    getLog().warn({ reason: 'session_dir_missing' }, 'omp.session_usage_omitted');
    return undefined;
  }

  const mainTranscript = await findMainTranscriptPath(sessionDirReal, input.sessionId);
  if (!mainTranscript) {
    getLog().warn({ reason: 'main_transcript_missing' }, 'omp.session_usage_omitted');
    return undefined;
  }

  if (!mainTranscript.endsWith(JSONL_SUFFIX)) {
    getLog().warn({ reason: 'unsupported_layout' }, 'omp.session_usage_omitted');
    return undefined;
  }

  const owned = await extractOwnedTaskStemsFromMain(
    mainTranscript,
    sessionDirReal,
    input.sessionId,
    input.cwd
  );
  if ('omit' in owned) {
    getLog().warn({ reason: owned.reason }, 'omp.session_usage_omitted');
    return undefined;
  }

  const artifactRoot = mainTranscript.slice(0, -JSONL_SUFFIX.length);
  const artifactRootReal = await safeRealPath(artifactRoot);
  if (!artifactRootReal) {
    return { entries: [], tokens: emptyTokens() };
  }
  if (!isPathInsideRoot(sessionDirReal, artifactRootReal)) {
    getLog().warn({ reason: 'artifact_escape' }, 'omp.session_usage_omitted');
    return undefined;
  }

  const listed = await listHiddenCandidates(
    artifactRootReal,
    input.sessionId,
    owned.stems,
    input.cwd
  );
  if ('omit' in listed) return undefined;

  if (input.afterCandidatesListed) {
    await input.afterCandidatesListed(
      listed.candidates.map(c => ({
        relativePath: c.relativePath,
        absolutePath: c.absolutePath,
      }))
    );
  }

  const snapshotByRel = new Map<string, FileSnapshot>();
  if (input.snapshot) {
    for (const file of input.snapshot.files) snapshotByRel.set(file.relativePath, file);
  }

  const entries: ModelUsageEntry[] = [];
  let tokens = emptyTokens();
  let actualTotalBytes = 0;
  // When a subagent parent is unverifiable on resume/fork, omit its entire artifact subtree.
  const omittedSubtreePrefixes: string[] = [];

  const isUnderOmittedSubtree = (relativePath: string): boolean => {
    for (const prefix of omittedSubtreePrefixes) {
      if (
        relativePath === prefix ||
        relativePath.startsWith(prefix + path.sep) ||
        relativePath.startsWith(`${prefix}/`)
      ) {
        return true;
      }
    }
    return false;
  };

  for (const candidate of listed.candidates) {
    if (isUnderOmittedSubtree(candidate.relativePath)) continue;

    const prior = snapshotByRel.get(candidate.relativePath);
    let byteOffset = 0;
    let expectedPrefix: { byteLength: number; digest: string } | undefined;

    if (prior) {
      if (!prior.endsAtRecordBoundary) {
        getLog().warn({ issue: 'mid_record_snapshot' }, 'omp.session_usage_file_omitted');
        if (candidate.kind === 'subagent') {
          omittedSubtreePrefixes.push(candidate.relativePath.slice(0, -JSONL_SUFFIX.length));
        }
        continue;
      }
      expectedPrefix = { byteLength: prior.byteLength, digest: prior.prefixDigest };
      byteOffset = prior.byteLength;
    }

    const parsed = await parseTranscriptUsageEntries(
      candidate.absolutePath,
      artifactRootReal,
      prior?.kind ?? candidate.kind,
      byteOffset,
      {
        requireSessionHeader: byteOffset === 0 && !expectedPrefix,
        expectedIdentity: {
          realPath: candidate.absolutePath,
          dev: candidate.dev,
          ino: candidate.ino,
        },
        ...(expectedPrefix ? { expectedPrefix } : {}),
      }
    );
    if (parsed.status === 'omit_all') return undefined;
    if (parsed.status === 'skip') {
      if (candidate.kind === 'subagent') {
        omittedSubtreePrefixes.push(candidate.relativePath.slice(0, -JSONL_SUFFIX.length));
      }
      continue;
    }

    actualTotalBytes += parsed.openedSize;
    if (actualTotalBytes > bounds().maxTotalBytes) {
      getLog().warn(
        { issue: 'total_bytes', bound: bounds().maxTotalBytes },
        'omp.session_usage_bound_exceeded'
      );
      return undefined;
    }

    for (const entry of parsed.entries) {
      entries.push(entry);
      tokens = addTokens(tokens, entry);
    }
  }

  return { entries, tokens };
}

/**
 * Merge hidden advisor/subagent usage into a provider result without changing success/error status.
 * numTurns stays primary-stream-only.
 */
export function enrichResultWithHiddenUsage<
  T extends {
    tokens?: TokenUsage;
    cost?: number;
    usageBreakdown?: readonly ModelUsageEntry[];
    numTurns?: number;
  },
>(result: T, hidden: HiddenSessionUsage): T {
  if (hidden.entries.length === 0) return result;

  const primaryBreakdown = result.usageBreakdown ? [...result.usageBreakdown] : [];
  const usageBreakdown = [...primaryBreakdown, ...hidden.entries];

  const base = result.tokens ?? emptyTokens();
  const tokens: TokenUsage = {
    input: base.input + hidden.tokens.input,
    output: base.output + hidden.tokens.output,
    total: (base.total ?? 0) + (hidden.tokens.total ?? 0),
    cost: (base.cost ?? 0) + (hidden.tokens.cost ?? 0),
  };

  return {
    ...result,
    tokens,
    cost: tokens.cost,
    usageBreakdown,
    ...(result.numTurns !== undefined ? { numTurns: result.numTurns } : {}),
  };
}
