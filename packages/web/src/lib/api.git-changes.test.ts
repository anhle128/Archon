import { afterEach, describe, expect, mock, spyOn, test } from 'bun:test';

import {
  getWorkflowRunGitChanges,
  getWorkflowRunGitDiff,
  getWorkflowRunGitFile,
  gitFileUrl,
  type GitDiffHunk,
} from './api';

Object.assign(globalThis, {
  window: { location: { origin: 'http://localhost' } },
});

const REVISION = 'a'.repeat(64);
const CONTENT_HASH = 'b'.repeat(64);

const READY_DIFF = {
  path: 'src/a.ts',
  status: 'M' as const,
  scope: 'now' as const,
  ref: 'live',
  hunks: [] as GitDiffHunk[],
  cursor: '',
  truncated: false,
  binary: false,
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function mockFetchSuccess() {
  return spyOn(globalThis, 'fetch').mockResolvedValue(
    jsonResponse({
      files: [{ path: 'a.ts', status: 'M' }],
      revision: REVISION,
    })
  );
}

function mockFetchResponse(response: Response) {
  return spyOn(globalThis, 'fetch').mockResolvedValue(response);
}

let fetchSpy: ReturnType<typeof mockFetchSuccess> | undefined;
let textSpy: ReturnType<typeof spyOn> | undefined;

afterEach(() => {
  fetchSpy?.mockRestore();
  fetchSpy = undefined;
  textSpy?.mockRestore();
  textSpy = undefined;
});

describe('getWorkflowRunGitChanges', () => {
  test('GETs the encoded run-scoped URL without a checkout path', async () => {
    fetchSpy = mockFetchSuccess();

    const response = await getWorkflowRunGitChanges('run/one');

    expect(response).toEqual({
      files: [{ path: 'a.ts', status: 'M' }],
      revision: REVISION,
    });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy).toHaveBeenCalledWith('/api/workflows/runs/run%2Fone/git/changes');
    expect(String(fetchSpy.mock.calls[0]?.[0])).not.toContain('working_path');
  });

  test('forwards the exact AbortSignal in RequestInit', async () => {
    fetchSpy = mockFetchSuccess();
    const signal = new AbortController().signal;

    await getWorkflowRunGitChanges('run/one', { signal });

    expect(fetchSpy).toHaveBeenCalledWith('/api/workflows/runs/run%2Fone/git/changes', {
      signal,
    });
  });
});

describe('getWorkflowRunGitDiff', () => {
  test('encodes the run ID and query path and omits an empty cursor', async () => {
    fetchSpy = mockFetchResponse(jsonResponse(READY_DIFF));

    const response = await getWorkflowRunGitDiff('run/one', 'src/a.ts', { cursor: '' });

    expect(response).toEqual(READY_DIFF);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy).toHaveBeenCalledWith('/api/workflows/runs/run%2Fone/git/diff?path=src%2Fa.ts');
    expect(String(fetchSpy.mock.calls[0]?.[0])).not.toContain('cursor=');
  });

  test('echoes a non-empty opaque cursor without parsing it', async () => {
    fetchSpy = mockFetchResponse(jsonResponse(READY_DIFF));

    await getWorkflowRunGitDiff('run/one', 'src/a.ts', { cursor: 'opaque+token' });

    expect(fetchSpy).toHaveBeenCalledWith(
      '/api/workflows/runs/run%2Fone/git/diff?path=src%2Fa.ts&cursor=opaque%2Btoken'
    );
  });

  test('forwards the exact AbortSignal in RequestInit', async () => {
    fetchSpy = mockFetchResponse(jsonResponse(READY_DIFF));
    const signal = new AbortController().signal;

    await getWorkflowRunGitDiff('run/one', 'src/a.ts', { signal });

    expect(fetchSpy).toHaveBeenCalledWith(
      '/api/workflows/runs/run%2Fone/git/diff?path=src%2Fa.ts',
      { signal }
    );
  });
});

describe('gitFileUrl', () => {
  test('encodes each git path segment while preserving slash separators', () => {
    expect(gitFileUrl('run/one', 'src/:colon.ts', 'worktree')).toBe(
      '/api/workflows/runs/run%2Fone/git/file/src/%3Acolon.ts?source=worktree'
    );
    expect(gitFileUrl('run/one', 'path with space.ts', 'head')).toBe(
      '/api/workflows/runs/run%2Fone/git/file/path%20with%20space.ts?source=head'
    );
    expect(gitFileUrl('run/one', 'line\nbreak.ts', 'worktree')).toBe(
      '/api/workflows/runs/run%2Fone/git/file/line%0Abreak.ts?source=worktree'
    );
  });

  test('serializes added and deleted sources only as worktree and head', () => {
    expect(gitFileUrl('run-1', 'a.ts', 'worktree')).toContain('?source=worktree');
    expect(gitFileUrl('run-1', 'a.ts', 'head')).toContain('?source=head');
    expect(gitFileUrl('run-1', 'a.ts', 'worktree')).not.toContain('source=added');
    expect(gitFileUrl('run-1', 'a.ts', 'head')).not.toContain('source=deleted');
  });
});

describe('getWorkflowRunGitFile', () => {
  test('returns text and content hash from a quoted ETag', async () => {
    fetchSpy = mockFetchResponse(
      new Response('hello\n', {
        status: 200,
        headers: {
          'Content-Type': 'text/plain; charset=utf-8',
          ETag: `"${CONTENT_HASH}"`,
        },
      })
    );

    await expect(getWorkflowRunGitFile('run/one', 'src/a.ts', 'worktree')).resolves.toEqual({
      kind: 'text',
      text: 'hello\n',
      contentHash: CONTENT_HASH,
    });
    expect(fetchSpy).toHaveBeenCalledWith(
      '/api/workflows/runs/run%2Fone/git/file/src/a.ts?source=worktree'
    );
  });

  test('returns binary plus hash without calling response.text and cancels the body', async () => {
    const bytes = new Uint8Array([0, 1, 2]);
    const cancel = mock(() => Promise.resolve());
    const response = new Response(bytes, {
      status: 200,
      headers: {
        'Content-Type': 'application/octet-stream',
        ETag: `"${CONTENT_HASH}"`,
      },
    });
    Object.defineProperty(response, 'body', {
      value: { cancel },
    });
    textSpy = spyOn(response, 'text');
    fetchSpy = mockFetchResponse(response);

    await expect(getWorkflowRunGitFile('run/one', 'bin.dat', 'head')).resolves.toEqual({
      kind: 'binary',
      contentHash: CONTENT_HASH,
    });
    expect(textSpy).not.toHaveBeenCalled();
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  test('maps CAP-6 JSON to empty without requiring an ETag', async () => {
    fetchSpy = mockFetchResponse(jsonResponse({ emptyReason: 'container' }));

    await expect(getWorkflowRunGitFile('run/one', 'src/a.ts', 'worktree')).resolves.toEqual({
      kind: 'empty',
      emptyReason: 'container',
    });
  });

  test('fails fast when a successful non-CAP-6 response lacks a valid 64-hex ETag', async () => {
    fetchSpy = mockFetchResponse(
      new Response('hello\n', {
        status: 200,
        headers: { 'Content-Type': 'text/plain; charset=utf-8' },
      })
    );

    await expect(getWorkflowRunGitFile('run/one', 'src/a.ts', 'worktree')).rejects.toThrow(
      'Invalid git file response'
    );
  });

  test('retains bounded path-only API errors for non-2xx responses', async () => {
    const longBody = 'x'.repeat(201);
    fetchSpy = mockFetchResponse(
      new Response(longBody, {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      })
    );

    try {
      await getWorkflowRunGitFile('run/one', 'src/a.ts', 'worktree');
      expect.unreachable('expected API error');
    } catch (error) {
      expect(error).toMatchObject({
        status: 404,
        message: `API error 404 (/api/workflows/runs/run%2Fone/git/file/src/a.ts): ${'x'.repeat(200)}...`,
      });
    }
  });
});
