import { describe, expect, test } from 'bun:test';

import { answerDeepseekPermissionRequest } from './permission';

describe('answerDeepseekPermissionRequest', () => {
  test('returns cancelled without selecting an option id', () => {
    expect(answerDeepseekPermissionRequest()).toEqual({
      outcome: { outcome: 'cancelled' },
    });
    expect(answerDeepseekPermissionRequest()).not.toHaveProperty('outcome.optionId');
    expect(JSON.stringify(answerDeepseekPermissionRequest())).not.toMatch(/optionId/);
  });
});
