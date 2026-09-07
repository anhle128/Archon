import { describe, expect, test } from 'bun:test';
import { projectTextTranscript } from './project-text-transcript';

function text(
  id: string,
  body: string,
  metadata?: {
    text_mode?: 'complete' | 'delta' | 'snapshot';
    stream_id?: string;
    message_id?: string;
    block_id?: string;
  }
): {
  id: string;
  seq: number;
  kind: 'text';
  payload: { text: string };
  metadata?: typeof metadata;
} {
  return {
    id,
    seq: Number(id.replace('t', '')),
    kind: 'text',
    payload: { text: body },
    ...(metadata !== undefined ? { metadata } : {}),
  };
}

describe('projectTextTranscript', () => {
  test('keeps complete messages independent', () => {
    const projected = projectTextTranscript([
      text('t1', '# One'),
      text('t2', '# Two', { text_mode: 'complete' }),
    ]);
    expect(projected.map(row => (row.kind === 'text' ? row.payload.text : ''))).toEqual([
      '# One',
      '# Two',
    ]);
  });

  test('concatenates deltas inside one stream and block', () => {
    const projected = projectTextTranscript([
      text('t1', 'Hel', { text_mode: 'delta', message_id: 'm1', block_id: 'b1' }),
      text('t2', 'lo', { text_mode: 'delta', message_id: 'm1', block_id: 'b1' }),
    ]);
    expect(projected).toHaveLength(1);
    expect(projected[0]?.kind === 'text' ? projected[0].payload.text : '').toBe('Hello');
  });

  test('does not concatenate independent streams', () => {
    const projected = projectTextTranscript([
      text('t1', 'A', { text_mode: 'delta', message_id: 'm1' }),
      text('t2', 'B', { text_mode: 'delta', message_id: 'm2' }),
    ]);
    expect(projected).toHaveLength(2);
  });

  test('replaces snapshots only inside the matching stream', () => {
    const projected = projectTextTranscript([
      text('t1', 'old', { text_mode: 'snapshot', message_id: 'm1', block_id: 'b1' }),
      text('t2', 'keep', { text_mode: 'complete' }),
      text('t3', 'new', { text_mode: 'snapshot', message_id: 'm1', block_id: 'b1' }),
    ]);
    expect(projected.map(row => (row.kind === 'text' ? row.payload.text : ''))).toEqual([
      'new',
      'keep',
    ]);
  });
});
