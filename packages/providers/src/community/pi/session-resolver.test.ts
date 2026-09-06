import { beforeEach, describe, expect, mock, test } from 'bun:test';

const mockCreate = mock((_cwd: string) => ({ __kind: 'created' }));
const mockOpen = mock((_path: string) => ({ __kind: 'opened' }));
const mockList = mock(async (_cwd: string) => [] as { id: string; path: string; cwd: string }[]);

const sessionManagerApi = {
  create: mockCreate,
  open: mockOpen,
  list: mockList,
};

import { PiSessionResumeRequiredError, resolvePiSession } from './session-resolver';

describe('resolvePiSession', () => {
  beforeEach(() => {
    mockCreate.mockClear();
    mockOpen.mockClear();
    mockList.mockClear();
    mockList.mockImplementation(async () => []);
  });

  test('no resumeSessionId → create fresh session', async () => {
    const result = await resolvePiSession('/tmp/proj', undefined, sessionManagerApi);
    expect(result.resumeFailed).toBe(false);
    expect(mockCreate).toHaveBeenCalledWith('/tmp/proj');
    expect(mockOpen).not.toHaveBeenCalled();
    expect(mockList).not.toHaveBeenCalled();
  });

  test('resume id matches existing session → open by path', async () => {
    mockList.mockImplementationOnce(async () => [
      { id: 'abc-123', path: '/sessions/abc-123.jsonl', cwd: '/tmp/proj' },
      { id: 'def-456', path: '/sessions/def-456.jsonl', cwd: '/tmp/proj' },
    ]);

    const result = await resolvePiSession('/tmp/proj', 'def-456', sessionManagerApi);
    expect(result.resumeFailed).toBe(false);
    expect(mockOpen).toHaveBeenCalledWith('/sessions/def-456.jsonl');
    expect(mockCreate).not.toHaveBeenCalled();
  });

  test('resume id not found → fresh session with resumeFailed=true', async () => {
    mockList.mockImplementationOnce(async () => [
      { id: 'abc-123', path: '/sessions/abc-123.jsonl', cwd: '/tmp/proj' },
    ]);

    const result = await resolvePiSession('/tmp/proj', 'missing-id', sessionManagerApi);
    expect(result.resumeFailed).toBe(true);
    expect(mockCreate).toHaveBeenCalledWith('/tmp/proj');
    expect(mockOpen).not.toHaveBeenCalled();
  });

  test('list() throws ENOENT → treated as not-found, fresh session', async () => {
    mockList.mockImplementationOnce(async () => {
      const err = Object.assign(new Error('no such directory'), { code: 'ENOENT' });
      throw err;
    });

    const result = await resolvePiSession('/tmp/proj', 'some-id', sessionManagerApi);
    expect(result.resumeFailed).toBe(true);
    expect(mockCreate).toHaveBeenCalledWith('/tmp/proj');
  });

  test('list() throws ENOTDIR → treated as not-found, fresh session', async () => {
    mockList.mockImplementationOnce(async () => {
      const err = Object.assign(new Error('not a directory'), { code: 'ENOTDIR' });
      throw err;
    });

    const result = await resolvePiSession('/tmp/proj', 'some-id', sessionManagerApi);
    expect(result.resumeFailed).toBe(true);
    expect(mockCreate).toHaveBeenCalledWith('/tmp/proj');
  });

  test('list() throws unexpected error → propagates (no silent fallback)', async () => {
    // Permission errors, parse failures, etc. must NOT be swallowed as
    // "no resume" — that would paper over real config/filesystem problems.
    mockList.mockImplementationOnce(async () => {
      const err = Object.assign(new Error('permission denied'), { code: 'EACCES' });
      throw err;
    });

    await expect(resolvePiSession('/tmp/proj', 'some-id', sessionManagerApi)).rejects.toThrow(
      /permission denied/
    );
    expect(mockCreate).not.toHaveBeenCalled();
  });

  test('list() throws plain Error → propagates (no code = not ENOENT)', async () => {
    mockList.mockImplementationOnce(async () => {
      throw new Error('some other failure');
    });

    await expect(resolvePiSession('/tmp/proj', 'some-id', sessionManagerApi)).rejects.toThrow(
      /some other failure/
    );
  });

  test('empty resumeSessionId string → fresh session (no resume attempted)', async () => {
    // Treated as "no resume requested" by the truthy check in the resolver.
    const result = await resolvePiSession('/tmp/proj', '', sessionManagerApi);
    expect(result.resumeFailed).toBe(false);
    expect(mockList).not.toHaveBeenCalled();
    expect(mockCreate).toHaveBeenCalled();
  });
});

describe('resolvePiSession requireExisting', () => {
  beforeEach(() => {
    mockCreate.mockClear();
    mockOpen.mockClear();
    mockList.mockClear();
    mockList.mockImplementation(async () => []);
  });

  test('missing id throws without create', async () => {
    await expect(
      resolvePiSession('/tmp/proj', undefined, sessionManagerApi, { requireExisting: true })
    ).rejects.toBeInstanceOf(PiSessionResumeRequiredError);
    expect(mockCreate).not.toHaveBeenCalled();
    expect(mockList).not.toHaveBeenCalled();
  });

  test('empty id throws without create', async () => {
    await expect(
      resolvePiSession('/tmp/proj', '', sessionManagerApi, { requireExisting: true })
    ).rejects.toBeInstanceOf(PiSessionResumeRequiredError);
    expect(mockCreate).not.toHaveBeenCalled();
    expect(mockList).not.toHaveBeenCalled();
  });

  test('ENOENT throws without create', async () => {
    mockList.mockImplementationOnce(async () => {
      throw Object.assign(new Error('no such directory'), { code: 'ENOENT' });
    });

    await expect(
      resolvePiSession('/tmp/proj', 'sess-1', sessionManagerApi, { requireExisting: true })
    ).rejects.toBeInstanceOf(PiSessionResumeRequiredError);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  test('ENOTDIR throws without create', async () => {
    mockList.mockImplementationOnce(async () => {
      throw Object.assign(new Error('not a directory'), { code: 'ENOTDIR' });
    });

    await expect(
      resolvePiSession('/tmp/proj', 'sess-1', sessionManagerApi, { requireExisting: true })
    ).rejects.toBeInstanceOf(PiSessionResumeRequiredError);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  test('id not found throws without create', async () => {
    mockList.mockImplementationOnce(async () => [
      { id: 'other', path: '/sessions/other.jsonl', cwd: '/tmp/proj' },
    ]);

    await expect(
      resolvePiSession('/tmp/proj', 'missing-id', sessionManagerApi, { requireExisting: true })
    ).rejects.toBeInstanceOf(PiSessionResumeRequiredError);
    expect(mockCreate).not.toHaveBeenCalled();
    expect(mockOpen).not.toHaveBeenCalled();
  });

  test('matching id still opens and does not create', async () => {
    mockList.mockImplementationOnce(async () => [
      { id: 'sess-1', path: '/sessions/sess-1.jsonl', cwd: '/tmp/proj' },
    ]);

    const result = await resolvePiSession('/tmp/proj', 'sess-1', sessionManagerApi, {
      requireExisting: true,
    });
    expect(result.resumeFailed).toBe(false);
    expect(mockOpen).toHaveBeenCalledWith('/sessions/sess-1.jsonl');
    expect(mockCreate).not.toHaveBeenCalled();
  });

  test('unexpected list error still propagates', async () => {
    mockList.mockImplementationOnce(async () => {
      throw Object.assign(new Error('permission denied'), { code: 'EACCES' });
    });

    await expect(
      resolvePiSession('/tmp/proj', 'sess-1', sessionManagerApi, { requireExisting: true })
    ).rejects.toThrow(/permission denied/);
    expect(mockCreate).not.toHaveBeenCalled();
  });
});
