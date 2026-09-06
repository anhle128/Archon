import { afterEach, describe, expect, mock, spyOn, test } from 'bun:test';

import {
  getWorkflowRunGitChanges,
  getWorkflowRunGitDiff,
  getWorkflowRunGitFile,
  getWorkflowRunGitLog,
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
  fileFallback: false,
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

  test('gitFileUrl emits only non-empty cursor and requested download', () => {
    expect(gitFileUrl('run/one', 'src/a.ts', 'worktree')).toBe(
      '/api/workflows/runs/run%2Fone/git/file/src/a.ts?source=worktree'
    );
    expect(gitFileUrl('run/one', 'src/a.ts', 'worktree', { cursor: 'ab+c' })).toBe(
      '/api/workflows/runs/run%2Fone/git/file/src/a.ts?source=worktree&cursor=ab%2Bc'
    );
    expect(gitFileUrl('run/one', 'src/a.ts', 'worktree', { download: true })).toBe(
      '/api/workflows/runs/run%2Fone/git/file/src/a.ts?source=worktree&download=1'
    );
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
      truncated: false,
      cursor: '',
      byteLength: 6,
    });
    expect(fetchSpy).toHaveBeenCalledWith(
      '/api/workflows/runs/run%2Fone/git/file/src/a.ts?source=worktree'
    );
  });

  test('returns download metadata for octet-stream when presentation headers are missing', async () => {
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
      kind: 'download',
      contentHash: CONTENT_HASH,
      byteLength: 0,
    });
    expect(textSpy).not.toHaveBeenCalled();
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  test('parses text paging metadata', async () => {
    fetchSpy = mockFetchResponse(
      new Response('hello\n', {
        headers: {
          'Content-Type': 'text/plain; charset=utf-8',
          ETag: '"' + CONTENT_HASH + '"',
          'X-Archon-Git-Presentation': 'text',
          'X-Archon-Git-Media-Type': '',
          'X-Archon-Git-Truncated': 'true',
          'X-Archon-Git-Cursor': 'next',
          'X-Archon-Git-Byte-Length': '99',
        },
      })
    );
    await expect(getWorkflowRunGitFile('run/one', 'src/a.ts', 'worktree')).resolves.toEqual({
      kind: 'text',
      text: 'hello\n',
      contentHash: CONTENT_HASH,
      truncated: true,
      cursor: 'next',
      byteLength: 99,
    });
  });

  test('parses an image as bytes without calling response.text', async () => {
    const imageResponse = new Response(Uint8Array.from([0x89, 0x50]), {
      headers: {
        'Content-Type': 'image/png',
        ETag: '"' + CONTENT_HASH + '"',
        'X-Archon-Git-Presentation': 'image',
        'X-Archon-Git-Media-Type': 'image/png',
        'X-Archon-Git-Byte-Length': '2',
        'X-Archon-Git-Truncated': 'false',
        'X-Archon-Git-Cursor': '',
      },
    });
    textSpy = spyOn(imageResponse, 'text');
    fetchSpy = mockFetchResponse(imageResponse);
    await expect(getWorkflowRunGitFile('run/one', 'tiny.png', 'worktree')).resolves.toEqual({
      kind: 'image',
      bytes: Uint8Array.from([0x89, 0x50]),
      contentHash: CONTENT_HASH,
      mediaType: 'image/png',
      byteLength: 2,
    });
    expect(textSpy).not.toHaveBeenCalled();
  });

  test('parses a hex presentation as bytes rather than text', async () => {
    const response = new Response(Uint8Array.from([0, 0x41, 0xff]), {
      headers: {
        'Content-Type': 'application/octet-stream',
        ETag: '"' + CONTENT_HASH + '"',
        'X-Archon-Git-Presentation': 'hex',
        'X-Archon-Git-Media-Type': '',
        'X-Archon-Git-Byte-Length': '3',
        'X-Archon-Git-Truncated': 'false',
        'X-Archon-Git-Cursor': '',
      },
    });
    textSpy = spyOn(response, 'text');
    fetchSpy = mockFetchResponse(response);
    await expect(getWorkflowRunGitFile('run/one', 'blob.bin', 'worktree')).resolves.toEqual({
      kind: 'hex',
      bytes: Uint8Array.from([0, 0x41, 0xff]),
      contentHash: CONTENT_HASH,
      byteLength: 3,
    });
    expect(textSpy).not.toHaveBeenCalled();
  });

  test('download-only cancels its empty body and returns metadata', async () => {
    const cancel = mock(() => Promise.resolve());
    const response = new Response(null, {
      headers: {
        'Content-Type': 'application/octet-stream',
        ETag: '"' + CONTENT_HASH + '"',
        'X-Archon-Git-Presentation': 'download',
        'X-Archon-Git-Media-Type': '',
        'X-Archon-Git-Byte-Length': '52428801',
        'X-Archon-Git-Truncated': 'false',
        'X-Archon-Git-Cursor': '',
      },
    });
    Object.defineProperty(response, 'body', { value: { cancel } });
    fetchSpy = mockFetchResponse(response);
    await expect(getWorkflowRunGitFile('run/one', 'huge.bin', 'worktree')).resolves.toEqual({
      kind: 'download',
      contentHash: CONTENT_HASH,
      byteLength: 52_428_801,
    });
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  test('rejects inconsistent presented headers', async () => {
    fetchSpy = mockFetchResponse(
      new Response('hello', {
        headers: {
          'Content-Type': 'text/plain',
          ETag: '"' + CONTENT_HASH + '"',
          'X-Archon-Git-Presentation': 'text',
          'X-Archon-Git-Media-Type': '',
          'X-Archon-Git-Truncated': 'true',
          'X-Archon-Git-Cursor': '',
          'X-Archon-Git-Byte-Length': '5',
        },
      })
    );
    await expect(getWorkflowRunGitFile('run/one', 'x.ts', 'worktree')).rejects.toThrow(
      'Invalid git file response'
    );
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

describe('getWorkflowRunGitLog', () => {
  test('GETs the encoded run-scoped log URL without a checkout path', async () => {
    fetchSpy = spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          commits: [
            {
              oid: 'a'.repeat(40),
              parents: [],
              authorName: 'Ada',
              authorDate: '2026-09-06T18:09:18Z',
              subject: 'init',
            },
          ],
          revision: 'a'.repeat(64),
          truncated: false,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    );

    const response = await getWorkflowRunGitLog('run/one');

    expect(response).toEqual({
      commits: [
        {
          oid: 'a'.repeat(40),
          parents: [],
          authorName: 'Ada',
          authorDate: '2026-09-06T18:09:18Z',
          subject: 'init',
        },
      ],
      revision: 'a'.repeat(64),
      truncated: false,
    });
    expect(fetchSpy).toHaveBeenCalledWith('/api/workflows/runs/run%2Fone/git/log');
    expect(String(fetchSpy.mock.calls[0]?.[0])).not.toContain('working_path');
  });

  test('forwards the exact AbortSignal in RequestInit', async () => {
    fetchSpy = spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ commits: [], revision: 'a'.repeat(64), truncated: false }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    );
    const signal = new AbortController().signal;

    await getWorkflowRunGitLog('run/one', { signal });

    expect(fetchSpy).toHaveBeenCalledWith('/api/workflows/runs/run%2Fone/git/log', { signal });
  });
});
