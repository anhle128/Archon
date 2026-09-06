import { describe, expect, test } from 'bun:test';
import { isEdgeTaken, isOnPath } from './taken-path';
import type { NodeState } from './types';

const ALL_STATES: readonly NodeState[] = [
  'pending',
  'running',
  'completed',
  'failed',
  'skipped',
  'awaiting',
];

const ON_PATH: ReadonlySet<NodeState> = new Set(['running', 'completed', 'failed', 'awaiting']);

describe('isOnPath', () => {
  test('returns true only for running, completed, failed, and awaiting', () => {
    for (const state of ALL_STATES) {
      expect(isOnPath(state)).toBe(ON_PATH.has(state));
    }
  });

  test('returns false for pending, skipped, and undefined', () => {
    expect(isOnPath('pending')).toBe(false);
    expect(isOnPath('skipped')).toBe(false);
    expect(isOnPath(undefined)).toBe(false);
  });
});

describe('isEdgeTaken', () => {
  test('follows the target-started rule', () => {
    expect(isEdgeTaken('awaiting')).toBe(true);
    expect(isEdgeTaken('skipped')).toBe(false);
  });

  test('delegates to isOnPath for every NodeState and undefined', () => {
    for (const state of ALL_STATES) {
      expect(isEdgeTaken(state)).toBe(isOnPath(state));
    }
    expect(isEdgeTaken(undefined)).toBe(isOnPath(undefined));
  });
});
