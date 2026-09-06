import { describe, test, expect, afterEach, spyOn } from 'bun:test';
import {
  updateConversation,
  deleteConversation,
  getConversation,
  type ConversationResponse,
} from './api';

// Regression tests for URL-encoding of platform conversation IDs in the web API
// client. Forge platform IDs (GitHub/Gitea) contain `/` and `#` characters
// (e.g. "owner/repo#42"); updateConversation and deleteConversation must encode
// them so the request hits /api/conversations/:id instead of splitting the path
// and 404ing. These exercise the CLIENT (the fetch URL), complementing the
// server-side decoding tests in packages/server/src/routes/api.conversations.test.ts.
// Ref: https://github.com/coleam00/Archon/issues/476

const FORGE_ID = 'Solvation-BV/Archon#42';
const ENCODED_URL = '/api/conversations/Solvation-BV%2FArchon%2342';

function mockFetchSuccess() {
  return spyOn(globalThis, 'fetch').mockResolvedValue(
    new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  );
}

let fetchSpy: ReturnType<typeof mockFetchSuccess> | undefined;

afterEach(() => {
  fetchSpy?.mockRestore();
  fetchSpy = undefined;
});

describe('getConversation — forge platform IDs with slashes and hashes', () => {
  test('GETs the URL-encoded conversation ID', async () => {
    const conversation: ConversationResponse = {
      id: 'conversation-1',
      platform_type: 'web',
      platform_conversation_id: FORGE_ID,
      codebase_id: null,
      cwd: null,
      isolation_env_id: null,
      ai_assistant_type: 'claude',
      title: null,
      hidden: false,
      deleted_at: null,
      last_activity_at: null,
      user_id: null,
      created_at: '2026-09-06T00:00:00.000Z',
      updated_at: '2026-09-06T00:00:00.000Z',
    };
    fetchSpy = spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify(conversation), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    );

    expect(await getConversation(FORGE_ID)).toEqual(conversation);
    expect(fetchSpy).toHaveBeenCalledWith(ENCODED_URL);
  });
});

describe('updateConversation — forge platform IDs with slashes and hashes', () => {
  test('PATCHes the URL-encoded conversation ID with the title body', async () => {
    fetchSpy = mockFetchSuccess();

    const result = await updateConversation(FORGE_ID, { title: 'New Title' });

    expect(result).toEqual({ success: true });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy).toHaveBeenCalledWith(
      ENCODED_URL,
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({ title: 'New Title' }),
      })
    );
  });
});

describe('deleteConversation — forge platform IDs with slashes and hashes', () => {
  test('DELETEs the URL-encoded conversation ID', async () => {
    fetchSpy = mockFetchSuccess();

    const result = await deleteConversation(FORGE_ID);

    expect(result).toEqual({ success: true });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy).toHaveBeenCalledWith(
      ENCODED_URL,
      expect.objectContaining({ method: 'DELETE' })
    );
  });
});
