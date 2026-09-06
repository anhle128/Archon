import { afterEach, describe, expect, spyOn, test } from 'bun:test';

import { getWorkflowRunGitChanges } from './api';

const REVISION = 'a'.repeat(64);

function mockFetchSuccess() {
  return spyOn(globalThis, 'fetch').mockResolvedValue(
    new Response(
      JSON.stringify({
        files: [{ path: 'a.ts', status: 'M' }],
        revision: REVISION,
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    )
  );
}

let fetchSpy: ReturnType<typeof mockFetchSuccess> | undefined;

afterEach(() => {
  fetchSpy?.mockRestore();
  fetchSpy = undefined;
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
});
