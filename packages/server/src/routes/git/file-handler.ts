import type { Context } from 'hono';

import { fileAt, toWorktreePath, type FileAtSource } from '@archon/git';
import { createLogger } from '@archon/paths';

import { isValidGitFilePath } from './path-input';
import { loadRunCheckout } from './run-checkout';

let cachedLog: ReturnType<typeof createLogger> | undefined;

function getLog(): ReturnType<typeof createLogger> {
  if (!cachedLog) cachedLog = createLogger('api');
  return cachedLog;
}

type ClassifiedGitReadError = 'invalid_path' | 'file_not_found' | 'git_read_failed';

function classifyGitReadError(error: unknown): ClassifiedGitReadError {
  if (typeof error !== 'object' || error === null) return 'git_read_failed';
  const candidate = error as { name?: unknown; code?: unknown };
  if (candidate.name === 'GitPathError') return 'invalid_path';
  if (candidate.name === 'GitFileError' && candidate.code === 'not_found') {
    return 'file_not_found';
  }
  return 'git_read_failed';
}

function extractEncodedGitFilePath(requestPath: string): string {
  const marker = '/git/file/';
  const index = requestPath.indexOf(marker);
  if (index === -1) return '';
  return requestPath.slice(index + marker.length);
}

export async function handleGitFile(
  c: Context,
  apiError: (c: Context, status: 400 | 404 | 500, message: string) => Response
): Promise<Response> {
  const runId = c.req.param('runId') ?? '';
  getLog().info({ runId }, 'git.file_started');

  let path: string;
  try {
    path = decodeURIComponent(extractEncodedGitFilePath(c.req.path));
  } catch {
    getLog().info({ runId, errorType: 'invalid_path' }, 'git.file_failed');
    return apiError(c, 400, 'Invalid file path');
  }

  if (!isValidGitFilePath(path)) {
    getLog().info({ runId, errorType: 'invalid_path' }, 'git.file_failed');
    return apiError(c, 400, 'Invalid file path');
  }

  const sourceQuery = c.req.query('source') ?? '';
  if (sourceQuery !== 'worktree' && sourceQuery !== 'head') {
    getLog().info({ runId, errorType: 'invalid_source' }, 'git.file_failed');
    return apiError(c, 400, 'Invalid file source');
  }
  const source: FileAtSource =
    sourceQuery === 'worktree' ? { kind: 'worktree' } : { kind: 'tree', treeIsh: 'HEAD' };

  try {
    const gate = await loadRunCheckout(runId);

    if (gate.kind === 'run_not_found') {
      getLog().info({ runId, errorType: 'run_not_found' }, 'git.file_failed');
      return apiError(c, 404, 'Workflow run not found');
    }

    if (gate.kind === 'empty') {
      getLog().info({ runId, emptyReason: gate.emptyReason }, 'git.file_completed');
      return c.json({ emptyReason: gate.emptyReason });
    }

    try {
      const result = await fileAt(toWorktreePath(gate.workingPath), path, source);
      getLog().info({ runId, binary: result.binary }, 'git.file_completed');
      const headers = {
        ETag: '"' + result.contentHash + '"',
        'Content-Type': result.binary ? 'application/octet-stream' : 'text/plain; charset=utf-8',
        ...(result.binary ? { 'Content-Disposition': 'attachment; filename="download"' } : {}),
      };
      return new Response(Buffer.from(result.bytes), { status: 200, headers });
    } catch (error) {
      const recheck = await loadRunCheckout(runId);
      if (recheck.kind === 'empty') {
        getLog().info({ runId, emptyReason: recheck.emptyReason }, 'git.file_completed');
        return c.json({ emptyReason: recheck.emptyReason });
      }
      const classified = classifyGitReadError(error);
      if (classified === 'invalid_path') {
        getLog().info({ runId, errorType: 'invalid_path' }, 'git.file_failed');
        return apiError(c, 400, 'Invalid file path');
      }
      if (classified === 'file_not_found') {
        getLog().info({ runId, errorType: 'file_not_found' }, 'git.file_failed');
        return apiError(c, 404, 'File not found');
      }
      getLog().error({ runId, errorType: 'git_read_failed' }, 'git.file_failed');
      return apiError(c, 500, 'Could not read git file');
    }
  } catch {
    getLog().error({ runId, errorType: 'git_read_failed' }, 'git.file_failed');
    return apiError(c, 500, 'Could not read git file');
  }
}
