/**
 * Tests for CLIAdapter
 */
import { describe, it, expect, beforeEach, afterEach, spyOn, mock } from 'bun:test';

// Mock dependencies BEFORE importing CLIAdapter
const mockAddMessage = mock(() =>
  Promise.resolve({
    id: 'msg-1',
    conversation_id: 'conv-1',
    role: 'assistant' as const,
    content: '',
    metadata: '{}',
    created_at: '',
  })
);
mock.module('@archon/core/db/messages', () => ({
  addMessage: mockAddMessage,
}));

const mockLogger = {
  fatal: mock(() => undefined),
  error: mock(() => undefined),
  warn: mock(() => undefined),
  info: mock(() => undefined),
  debug: mock(() => undefined),
  trace: mock(() => undefined),
  child: mock(function (this: unknown) {
    return this;
  }),
};
mock.module('@archon/paths', () => ({
  createLogger: mock(() => mockLogger),
}));

import { CLIAdapter } from './cli-adapter';

describe('CLIAdapter', () => {
  let adapter: CLIAdapter;
  let consoleSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    adapter = new CLIAdapter();
    consoleSpy = spyOn(console, 'log').mockImplementation(() => {});
    mockAddMessage.mockClear();
    mockLogger.warn.mockClear();
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  describe('constructor', () => {
    it('should default to batch mode', () => {
      const defaultAdapter = new CLIAdapter();
      expect(defaultAdapter.getStreamingMode()).toBe('batch');
    });

    it('should accept stream mode option', () => {
      const streamAdapter = new CLIAdapter({ streamingMode: 'stream' });
      expect(streamAdapter.getStreamingMode()).toBe('stream');
    });

    it('should accept batch mode option', () => {
      const batchAdapter = new CLIAdapter({ streamingMode: 'batch' });
      expect(batchAdapter.getStreamingMode()).toBe('batch');
    });
  });

  describe('sendMessage', () => {
    it('should output message to console.log', async () => {
      await adapter.sendMessage('test-123', 'Hello, world!');
      expect(consoleSpy).toHaveBeenCalledWith('Hello, world!');
    });

    it('should handle empty messages', async () => {
      await adapter.sendMessage('test-123', '');
      expect(consoleSpy).toHaveBeenCalledWith('');
    });

    it('should handle multi-line messages', async () => {
      const multiLine = 'Line 1\nLine 2\nLine 3';
      await adapter.sendMessage('test-123', multiLine);
      expect(consoleSpy).toHaveBeenCalledWith(multiLine);
    });

    it('does not persist when conversationId has no registered db mapping', async () => {
      await adapter.sendMessage('unregistered-id', 'test');
      await adapter.sendMessage('another-unregistered-id', 'test');
      expect(consoleSpy).toHaveBeenCalledTimes(2);
      expect(mockAddMessage).not.toHaveBeenCalled();
    });
  });

  describe('message persistence', () => {
    it('persists assistant message when conversationDbId is set', async () => {
      adapter.setConversationDbId('conv-id', 'conv-db-123');
      await adapter.sendMessage('conv-id', 'Hello from AI');
      expect(consoleSpy).toHaveBeenCalledWith('Hello from AI');
      expect(mockAddMessage).toHaveBeenCalledWith(
        'conv-db-123',
        'assistant',
        'Hello from AI',
        undefined
      );
    });

    it('does NOT persist when conversationDbId is not set', async () => {
      await adapter.sendMessage('conv-id', 'Hello');
      expect(consoleSpy).toHaveBeenCalledWith('Hello');
      expect(mockAddMessage).not.toHaveBeenCalled();
    });

    it('handles addMessage errors gracefully (warn, no throw)', async () => {
      mockAddMessage.mockRejectedValueOnce(new Error('DB connection failed'));
      adapter.setConversationDbId('conv-id', 'conv-db-123');
      await expect(adapter.sendMessage('conv-id', 'Hello')).resolves.toBeUndefined();
      expect(consoleSpy).toHaveBeenCalledWith('Hello');
      expect(mockLogger.warn).toHaveBeenCalled();
    });

    it('persists category and workflowResult metadata when provided', async () => {
      adapter.setConversationDbId('conv-id', 'conv-123');
      await adapter.sendMessage('conv-id', 'Hello', {
        category: 'workflow_status',
        workflowResult: { workflowName: 'test', runId: 'run-1' },
      });
      expect(mockAddMessage).toHaveBeenCalledWith('conv-123', 'assistant', 'Hello', {
        category: 'workflow_status',
        workflowResult: { workflowName: 'test', runId: 'run-1' },
      });
    });

    it('persists workflowDispatch metadata', async () => {
      adapter.setConversationDbId('conv-id', 'conv-123');
      await adapter.sendMessage('conv-id', 'Dispatching...', {
        workflowDispatch: { workerConversationId: 'worker-1', workflowName: 'assist' },
      });
      expect(mockAddMessage).toHaveBeenCalledWith('conv-123', 'assistant', 'Dispatching...', {
        workflowDispatch: { workerConversationId: 'worker-1', workflowName: 'assist' },
      });
    });

    it('omits metadata parameter when only non-persistent fields present', async () => {
      adapter.setConversationDbId('conv-id', 'conv-123');
      await adapter.sendMessage('conv-id', 'Hello', { segment: 'new' });
      expect(mockAddMessage).toHaveBeenCalledWith('conv-123', 'assistant', 'Hello', undefined);
    });

    it('omits metadata parameter when metadata is undefined', async () => {
      adapter.setConversationDbId('conv-id', 'conv-123');
      await adapter.sendMessage('conv-id', 'Hello');
      expect(mockAddMessage).toHaveBeenCalledWith('conv-123', 'assistant', 'Hello', undefined);
    });
  });

  describe('ensureThread', () => {
    it('should return the same conversation ID (passthrough)', async () => {
      const result = await adapter.ensureThread('original-123');
      expect(result).toBe('original-123');
    });

    it('should ignore message context', async () => {
      const result = await adapter.ensureThread('id', { some: 'context' });
      expect(result).toBe('id');
    });
  });

  describe('getStreamingMode', () => {
    it('should return the configured streaming mode', () => {
      expect(adapter.getStreamingMode()).toBe('batch');
    });
  });

  describe('getPlatformType', () => {
    it('should return "cli"', () => {
      expect(adapter.getPlatformType()).toBe('cli');
    });
  });

  describe('start', () => {
    it('should be a no-op (returns void)', async () => {
      const result = await adapter.start();
      expect(result).toBeUndefined();
    });
  });

  describe('stop', () => {
    it('should be a no-op (returns void)', () => {
      const result = adapter.stop();
      expect(result).toBeUndefined();
    });
  });

  // ---------------------------------------------------------------------
  // RED-PHASE SCAFFOLD (EXECUTABLE) — Story 3.3b "Provide Archon Start And
  // Status CLI JSON", Task 1: `CLIAdapterOptions.silent?: boolean` so
  // foreground `workflow run --json` can suppress `CLIAdapter.sendMessage`'s
  // stdout side effect while keeping DB persistence (RC-06 — `quiet` is not
  // enough; it only controls progress-event rendering in workflow.ts, not
  // adapter stdout).
  //
  // `CLIAdapter` already exists and `CLIAdapterOptions` is a plain object
  // type, so passing `{ silent: true }` today does not throw — the extra
  // property is simply ignored by the current constructor. That makes this
  // a genuine executable red test (not `test.skip()`): the adapter runs for
  // real and still calls `console.log`, so the assertion below fails
  // against the CURRENT implementation, not vacuously.
  // ---------------------------------------------------------------------
  describe('silent mode (Story 3.3b — not yet implemented)', () => {
    it('3.3B-UNIT-014: a silent adapter does not write to stdout but still persists the message', async () => {
      const silentAdapter = new CLIAdapter({ silent: true } as ConstructorParameters<
        typeof CLIAdapter
      >[0]);
      silentAdapter.setConversationDbId('conv-id', 'conv-db-silent');

      await silentAdapter.sendMessage('conv-id', 'Dispatching workflow: **assist**');

      expect(consoleSpy).not.toHaveBeenCalled();
      expect(mockAddMessage).toHaveBeenCalledWith(
        'conv-db-silent',
        'assistant',
        'Dispatching workflow: **assist**',
        undefined
      );
    });

    it('3.3B-UNIT-027: a silent adapter still logs (does not swallow) a persistence failure', async () => {
      mockAddMessage.mockRejectedValueOnce(new Error('DB connection failed'));
      const silentAdapter = new CLIAdapter({ silent: true } as ConstructorParameters<
        typeof CLIAdapter
      >[0]);
      silentAdapter.setConversationDbId('conv-id', 'conv-db-silent-fail');

      await expect(
        silentAdapter.sendMessage('conv-id', 'Dispatching workflow: **assist**')
      ).resolves.toBeUndefined();

      expect(consoleSpy).not.toHaveBeenCalled();
      expect(mockLogger.warn).toHaveBeenCalled();
    });

    it('a non-silent adapter (default) is unaffected — still writes to stdout', async () => {
      const defaultAdapter = new CLIAdapter();
      await defaultAdapter.sendMessage('conv-id', 'hello');
      expect(consoleSpy).toHaveBeenCalledWith('hello');
    });
  });
});
