import { describe, expect, test } from 'bun:test';
import { REVIEW_FEEDBACK_MAX_UTF8_BYTES, reviewFeedbackTextSchema } from './workflow-run';

describe('reviewFeedbackTextSchema', () => {
  test('rejects feedback that exceeds 16 KiB in UTF-8 bytes', () => {
    const emoji = '\u{1F600}';
    const overLimit = emoji.repeat(5000);
    expect(Buffer.byteLength(overLimit, 'utf8')).toBeGreaterThan(REVIEW_FEEDBACK_MAX_UTF8_BYTES);
    expect(overLimit.length).toBeLessThan(REVIEW_FEEDBACK_MAX_UTF8_BYTES);
    expect(reviewFeedbackTextSchema.safeParse(overLimit).success).toBe(false);
  });

  test('accepts feedback at the UTF-8 byte limit', () => {
    const allowed = 'a'.repeat(REVIEW_FEEDBACK_MAX_UTF8_BYTES);
    expect(reviewFeedbackTextSchema.safeParse(allowed).success).toBe(true);
  });
});
