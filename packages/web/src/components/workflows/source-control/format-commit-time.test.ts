import { describe, expect, test } from 'bun:test';

import { formatCommitTime } from './format-commit-time';

const NOW = Date.parse('2026-09-06T12:00:00Z');

describe('formatCommitTime', () => {
  test('formats recent past and future commits with stable English relative units', () => {
    expect(formatCommitTime('2026-09-06T12:00:00Z', NOW)).toBe('now');
    expect(formatCommitTime('2026-09-06T11:58:30Z', NOW)).toBe('2 minutes ago');
    expect(formatCommitTime('2026-09-06T15:00:00Z', NOW)).toBe('in 3 hours');
    expect(formatCommitTime('2026-08-08T12:00:00Z', NOW)).toBe('29 days ago');
  });

  test('formats older offset timestamps as a deterministic UTC date', () => {
    expect(formatCommitTime('2026-07-01T23:30:00-07:00', NOW)).toBe('Jul 2, 2026');
  });

  test('returns quiet fallback copy for invalid input', () => {
    expect(formatCommitTime('not-a-date', NOW)).toBe('Unknown time');
  });
});
