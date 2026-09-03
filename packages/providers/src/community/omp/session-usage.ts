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
 * - task-agent: recursive `*.jsonl` under the artifact dir
 * - nested advisor: advisor files beside nested task transcripts
 *
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

const ADVISOR_BASENAME = '__advisor.jsonl';
const ADVISOR_PREFIX = '__advisor.';
const JSONL_SUFFIX = '.jsonl';

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

function isAdvisorFileName(name: string): boolean {
  return (
    name === ADVISOR_BASENAME || (name.startsWith(ADVISOR_PREFIX) && name.endsWith(JSONL_SUFFIX))
  );
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

function digestBytes(buf: Buffer): string {
  return createHash('sha256').update(buf).digest('hex');
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
 * Find the main transcript `*_<sessionId>.jsonl` directly under sessionDir.
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
  const suffix = `_${sessionId}${JSONL_SUFFIX}`;
  const matches = entries
    .filter(
      entry => entry.isFile() && entry.name.endsWith(suffix) && !isAdvisorFileName(entry.name)
    )
    .map(entry => path.join(sessionDir, entry.name));
  if (matches.length === 1) return matches[0];
  if (matches.length > 1) {
    // Prefer the newest by name (timestamp prefix sorts lexicographically for ISO-like stamps).
    matches.sort();
    return matches[matches.length - 1];
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
  rootReal: string
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

async function readPrefix(handle: fs.FileHandle, byteLength: number): Promise<Buffer> {
  if (byteLength <= 0) return Buffer.alloc(0);
  const buf = Buffer.alloc(byteLength);
  let offset = 0;
  while (offset < byteLength) {
    const { bytesRead } = await handle.read(buf, offset, byteLength - offset, offset);
    if (bytesRead === 0) break;
    offset += bytesRead;
  }
  return offset === byteLength ? buf : buf.subarray(0, offset);
}
/** Read a verified open file into UTF-8 text from start offset. Caller owns handle lifetime. */
async function readHandleText(
  handle: fs.FileHandle,
  size: number,
  start = 0
): Promise<string | undefined> {
  if (start < 0 || start > size) return undefined;
  const length = size - start;
  if (length > MAX_FILE_BYTES) return undefined;
  if (length === 0) return '';
  const buf = Buffer.alloc(length);
  let offset = 0;
  while (offset < length) {
    const { bytesRead } = await handle.read(buf, offset, length - offset, start + offset);
    if (bytesRead === 0) break;
    offset += bytesRead;
  }
  return buf.subarray(0, offset).toString('utf8');
}

function* iterateLines(text: string): Generator<string> {
  let start = 0;
  while (start <= text.length) {
    const newline = text.indexOf('\n', start);
    if (newline < 0) {
      const tail = text.slice(start).replace(/\r$/, '');
      if (tail.length > 0 || start < text.length) yield tail;
      return;
    }
    yield text.slice(start, newline).replace(/\r$/, '');
    start = newline + 1;
  }
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
  if (opened.size > MAX_FILE_BYTES) {
    await opened.handle.close().catch(() => undefined);
    getLog().warn(
      { issue: 'file_too_large', bound: MAX_FILE_BYTES },
      'omp.session_usage_bound_exceeded'
    );
    return false;
  }

  try {
    const text = await readHandleText(opened.handle, opened.size);
    if (text === undefined) return false;
    for (const line of iterateLines(text)) {
      if (Buffer.byteLength(line, 'utf8') > MAX_LINE_BYTES) {
        getLog().warn({ issue: 'line_too_large' }, 'omp.session_usage_bound_exceeded');
        return false;
      }
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
}

/**
 * Recursively list JSONL candidates under the artifact root.
 * Main transcript is outside the artifact root and is never returned here.
 */
async function listHiddenCandidates(
  artifactRootReal: string
): Promise<{ candidates: CandidateFile[] } | { omit: true; reason: string }> {
  const candidates: CandidateFile[] = [];
  let totalBytes = 0;
  const stack: string[] = [artifactRootReal];

  while (stack.length > 0) {
    const dir = stack.pop();
    if (!dir) break;
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
    for (const entry of entries) {
      const abs = path.join(dir, entry.name);
      if (entry.isSymbolicLink()) {
        getLog().warn({ issue: 'symlink' }, 'omp.session_usage_path_rejected');
        continue;
      }
      if (entry.isDirectory()) {
        const realDir = await safeRealPath(abs);
        if (!realDir || !isPathInsideRoot(artifactRootReal, realDir)) {
          getLog().warn({ issue: 'path_escape' }, 'omp.session_usage_path_rejected');
          continue;
        }
        stack.push(realDir);
        continue;
      }
      if (!entry.isFile() || !entry.name.endsWith(JSONL_SUFFIX)) continue;
      if (candidates.length >= MAX_CANDIDATE_FILES) {
        getLog().warn(
          { issue: 'too_many_files', bound: MAX_CANDIDATE_FILES },
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
      if (st.size > MAX_FILE_BYTES) {
        getLog().warn(
          { issue: 'file_too_large', bound: MAX_FILE_BYTES },
          'omp.session_usage_bound_exceeded'
        );
        return { omit: true, reason: 'file_too_large' };
      }
      totalBytes += st.size;
      if (totalBytes > MAX_TOTAL_BYTES) {
        getLog().warn(
          { issue: 'total_bytes', bound: MAX_TOTAL_BYTES },
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
      candidates.push({
        absolutePath: realFile,
        relativePath,
        kind: isAdvisorFileName(entry.name) ? 'advisor' : 'subagent',
        size: st.size,
      });
    }
  }

  candidates.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
  return { candidates };
}

function prefixContainsSessionHeader(prefix: Buffer): boolean {
  if (prefix.length === 0) return false;
  const text = prefix.toString('utf8');
  for (const line of text.split('\n')) {
    if (line.trim().length === 0) continue;
    try {
      const parsed: unknown = JSON.parse(line);
      const obj = asObject(parsed);
      if (obj?.type === 'session' && stringField(obj.id)) return true;
    } catch {
      continue;
    }
  }
  return false;
}

async function snapshotFile(
  absolutePath: string,
  relativePath: string,
  rootReal: string,
  kind: 'advisor' | 'subagent'
): Promise<FileSnapshot | undefined> {
  const opened = await openVerifiedFile(absolutePath, rootReal);
  if (!opened) return undefined;
  try {
    if (opened.size > MAX_FILE_BYTES) return undefined;
    const prefix = await readPrefix(opened.handle, opened.size);
    const endsAtRecordBoundary = prefix.length === 0 || prefix[prefix.length - 1] === 0x0a;
    // Empty new files are allowed; non-empty candidates must prove a session header.
    if (prefix.length > 0 && !prefixContainsSessionHeader(prefix)) return undefined;
    return {
      relativePath,
      byteLength: prefix.length,
      prefixDigest: digestBytes(prefix),
      endsAtRecordBoundary,
      kind,
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

  const headerOk = await validateMainSessionHeader(
    mainTranscript,
    sessionDirReal,
    input.resumeSessionId,
    input.cwd
  );
  if (!headerOk) {
    getLog().warn({ reason: 'header_mismatch' }, 'omp.session_usage_snapshot_skipped');
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

  const listed = await listHiddenCandidates(artifactRootReal);
  if ('omit' in listed) return null;

  const files: FileSnapshot[] = [];
  for (const candidate of listed.candidates) {
    const snap = await snapshotFile(
      candidate.absolutePath,
      candidate.relativePath,
      artifactRootReal,
      candidate.kind
    );
    if (!snap) {
      getLog().warn({ reason: 'candidate_snapshot_failed' }, 'omp.session_usage_snapshot_skipped');
      return null;
    }
    files.push(snap);
  }
  return { sessionDir: sessionDirReal, artifactRoot: artifactRootReal, files };
}

function emptyTokens(): TokenUsage {
  return { input: 0, output: 0, total: 0, cost: 0 };
}

function addTokens(acc: TokenUsage, entry: ModelUsageEntry): TokenUsage {
  return {
    input: acc.input + (entry.inputTokens ?? 0),
    output: acc.output + (entry.outputTokens ?? 0),
    total: (acc.total ?? 0) + (entry.inputTokens ?? 0) + (entry.outputTokens ?? 0),
    cost: (acc.cost ?? 0) + (entry.costUsd ?? 0),
  };
}

export type ParseTranscriptResult =
  | { status: 'ok'; entries: ModelUsageEntry[] }
  | { status: 'skip' }
  | { status: 'omit_all' };

/**
 * Stream-parse assistant usage rows from a JSONL transcript starting at byteOffset.
 * Never returns prompt/response content — only normalized usage entries.
 */
export async function parseTranscriptUsageEntries(
  filePath: string,
  rootReal: string,
  kind: 'advisor' | 'subagent',
  byteOffset: number,
  options?: { requireSessionHeader?: boolean }
): Promise<ParseTranscriptResult> {
  const requireSessionHeader = options?.requireSessionHeader ?? byteOffset === 0;
  const opened = await openVerifiedFile(filePath, rootReal);
  if (!opened) return { status: 'skip' };
  if (opened.size > MAX_FILE_BYTES) {
    await opened.handle.close().catch(() => undefined);
    getLog().warn({ issue: 'file_too_large' }, 'omp.session_usage_bound_exceeded');
    return { status: 'omit_all' };
  }
  if (byteOffset > opened.size) {
    await opened.handle.close().catch(() => undefined);
    return { status: 'skip' };
  }

  const entries: ModelUsageEntry[] = [];
  // Trusted resume/fork deltas were validated at snapshot time; appended slices
  // intentionally omit the historical session header.
  let sawSessionHeader = !requireSessionHeader;
  try {
    const text = await readHandleText(opened.handle, opened.size, byteOffset);
    if (text === undefined) return { status: 'skip' };
    for (const line of iterateLines(text)) {
      const lineBytes = Buffer.byteLength(line, 'utf8');
      if (lineBytes > MAX_LINE_BYTES) {
        getLog().warn({ issue: 'line_too_large' }, 'omp.session_usage_bound_exceeded');
        return { status: 'omit_all' };
      }
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
  return { status: 'ok', entries };
}

async function readAndDigestPrefix(
  filePath: string,
  rootReal: string,
  byteLength: number
): Promise<{ digest: string; size: number } | undefined> {
  const opened = await openVerifiedFile(filePath, rootReal);
  if (!opened) return undefined;
  try {
    if (opened.size < byteLength) return undefined;
    const prefix = await readPrefix(opened.handle, byteLength);
    if (prefix.length !== byteLength) return undefined;
    return { digest: digestBytes(prefix), size: opened.size };
  } finally {
    await opened.handle.close().catch(() => undefined);
  }
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

  const headerOk = await validateMainSessionHeader(
    mainTranscript,
    sessionDirReal,
    input.sessionId,
    input.cwd
  );
  if (!headerOk) {
    getLog().warn({ reason: 'header_mismatch' }, 'omp.session_usage_omitted');
    return undefined;
  }

  if (!mainTranscript.endsWith(JSONL_SUFFIX)) {
    getLog().warn({ reason: 'unsupported_layout' }, 'omp.session_usage_omitted');
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

  const listed = await listHiddenCandidates(artifactRootReal);
  if ('omit' in listed) return undefined;

  const snapshotByRel = new Map<string, FileSnapshot>();
  if (input.snapshot) {
    for (const file of input.snapshot.files) snapshotByRel.set(file.relativePath, file);
  }

  const entries: ModelUsageEntry[] = [];
  let tokens = emptyTokens();

  for (const candidate of listed.candidates) {
    const prior = snapshotByRel.get(candidate.relativePath);
    let byteOffset = 0;

    if (prior) {
      if (!prior.endsAtRecordBoundary) {
        getLog().warn({ issue: 'mid_record_snapshot' }, 'omp.session_usage_file_omitted');
        continue;
      }
      const checked = await readAndDigestPrefix(
        candidate.absolutePath,
        artifactRootReal,
        prior.byteLength
      );
      if (checked?.digest !== prior.prefixDigest) {
        getLog().warn({ issue: 'prefix_mismatch' }, 'omp.session_usage_file_omitted');
        continue;
      }
      byteOffset = prior.byteLength;
      if (checked.size === byteOffset) continue;
    }

    const parsed = await parseTranscriptUsageEntries(
      candidate.absolutePath,
      artifactRootReal,
      prior?.kind ?? candidate.kind,
      byteOffset,
      { requireSessionHeader: byteOffset === 0 }
    );
    if (parsed.status === 'omit_all') return undefined;
    if (parsed.status === 'skip') continue;
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
