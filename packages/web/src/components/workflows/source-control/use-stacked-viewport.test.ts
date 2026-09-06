import { describe, expect, mock, test } from 'bun:test';

import { initialStackedViewport } from './use-stacked-viewport';

describe('initialStackedViewport', () => {
  test('is false without a browser matchMedia implementation', () => {
    expect(initialStackedViewport(undefined)).toBe(false);
  });

  test('uses the current media-query match on the first client render', () => {
    const matchMedia = mock((query: string) => ({
      matches: query === '(max-width: 899px)',
    }));

    expect(initialStackedViewport(matchMedia)).toBe(true);
    expect(matchMedia).toHaveBeenCalledWith('(max-width: 899px)');
  });
});
