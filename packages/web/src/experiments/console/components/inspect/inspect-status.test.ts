import { describe, expect, test } from 'bun:test';
import { inspectStatus, inspectStatusLabel, isInspectRunLive } from './inspect-status';

describe('inspectStatus', () => {
  const passThrough = ['pending', 'running', 'completed', 'failed', 'skipped'] as const;

  for (const status of passThrough) {
    test(`passes ${status} through`, () => {
      expect(inspectStatus(status)).toBe(status);
    });
  }

  test('maps typed awaiting to running', () => {
    expect(inspectStatus('awaiting')).toBe('running');
  });

  test('maps other strings to pending', () => {
    expect(inspectStatus('paused')).toBe('pending');
    expect(inspectStatus('tool')).toBe('pending');
    expect(inspectStatus('')).toBe('pending');
  });
});

describe('inspectStatusLabel', () => {
  const passThrough = ['pending', 'running', 'completed', 'failed', 'skipped'] as const;

  for (const status of passThrough) {
    test(`passes ${status} through`, () => {
      expect(inspectStatusLabel(status)).toBe(status);
    });
  }

  test('maps typed awaiting to running', () => {
    expect(inspectStatusLabel('awaiting')).toBe('running');
  });

  test('passes arbitrary transcript status strings through except awaiting', () => {
    expect(inspectStatusLabel('tool')).toBe('tool');
    expect(inspectStatusLabel('text')).toBe('text');
    expect(inspectStatusLabel('iteration_started')).toBe('iteration_started');
  });
});

describe('isInspectRunLive', () => {
  test('returns true only for running and paused runs', () => {
    expect(isInspectRunLive('running')).toBe(true);
    expect(isInspectRunLive('paused')).toBe(true);
    expect(isInspectRunLive('awaiting')).toBe(false);
    expect(isInspectRunLive('pending')).toBe(false);
    expect(isInspectRunLive('completed')).toBe(false);
    expect(isInspectRunLive('failed')).toBe(false);
    expect(isInspectRunLive('skipped')).toBe(false);
  });
});
