import { describe, expect, test } from 'bun:test';
import {
  buildUsageSearchParams,
  inclusiveUtcRangeToApi,
  usageCacheKey,
  utcDateOnly,
  utcMonthStart,
} from './usage';

describe('usageCacheKey', () => {
  test('includes every filter and group value so keys do not collide', () => {
    const a = usageCacheKey({
      from: '2026-09-01T00:00:00.000Z',
      to: '2026-10-01T00:00:00.000Z',
      groupBy: 'provider',
    });
    const b = usageCacheKey({
      from: '2026-09-01T00:00:00.000Z',
      to: '2026-10-01T00:00:00.000Z',
      groupBy: 'agent',
    });
    const c = usageCacheKey({
      from: '2026-09-01T00:00:00.000Z',
      to: '2026-10-01T00:00:00.000Z',
      groupBy: 'provider',
      codebaseId: 'proj-1',
    });
    expect(a).not.toBe(b);
    expect(a).not.toBe(c);
    expect(a).toContain('provider');
    expect(c).toContain(encodeURIComponent('proj-1'));
  });

  test('empty filters collapse to stable sentinels', () => {
    expect(usageCacheKey({})).toBe(usageCacheKey({ groupBy: 'provider' }));
  });
});

describe('inclusiveUtcRangeToApi', () => {
  test('maps inclusive Through to exclusive to = midnight after Through', () => {
    const r = inclusiveUtcRangeToApi('2026-09-01', '2026-09-30');
    expect(r).toEqual({
      from: '2026-09-01T00:00:00.000Z',
      to: '2026-10-01T00:00:00.000Z',
    });
  });

  test('rejects ranges over 366 inclusive days', () => {
    const r = inclusiveUtcRangeToApi('2025-01-01', '2026-01-02');
    expect(r).toEqual({ error: 'Range cannot exceed 366 days.' });
  });

  test('allows exactly 366 inclusive days', () => {
    // 2024 is leap year: Jan 1 through Dec 31 = 366 days
    const r = inclusiveUtcRangeToApi('2024-01-01', '2024-12-31');
    expect('error' in r).toBe(false);
    if ('error' in r) throw new Error('unreachable');
    expect(r.from).toBe('2024-01-01T00:00:00.000Z');
    expect(r.to).toBe('2025-01-01T00:00:00.000Z');
  });

  test('rejects inverted ranges', () => {
    expect(inclusiveUtcRangeToApi('2026-09-10', '2026-09-01')).toEqual({
      error: 'Through must be on or after From.',
    });
  });
});

describe('utc month helpers', () => {
  test('utcMonthStart is the first day of the UTC month', () => {
    expect(utcMonthStart(new Date('2026-09-15T12:00:00.000Z'))).toBe('2026-09-01');
  });

  test('utcDateOnly is YYYY-MM-DD in UTC', () => {
    expect(utcDateOnly(new Date('2026-09-04T23:30:00.000Z'))).toBe('2026-09-04');
  });
});

describe('buildUsageSearchParams', () => {
  test('emits only defined camelCase query keys', () => {
    const qs = buildUsageSearchParams({
      from: 'a',
      to: 'b',
      groupBy: 'run',
      kind: 'advisor',
      codebaseId: 'c1',
    });
    expect(qs.get('from')).toBe('a');
    expect(qs.get('to')).toBe('b');
    expect(qs.get('groupBy')).toBe('run');
    expect(qs.get('kind')).toBe('advisor');
    expect(qs.get('codebaseId')).toBe('c1');
    expect(qs.has('runId')).toBe(false);
  });
});
