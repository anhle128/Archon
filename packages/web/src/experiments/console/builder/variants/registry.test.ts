import { describe, test, expect } from 'bun:test';
import { CREATABLE_VARIANTS, VARIANTS, isVariantId } from './registry';

describe('isVariantId', () => {
  test('accepts every canonical variant id', () => {
    for (const variant of VARIANTS) {
      expect(isVariantId(variant)).toBe(true);
    }
  });

  test('rejects unknown strings (e.g. a foreign drag payload)', () => {
    for (const bad of ['', 'Prompt', 'workflow', 'node', 'application/json', 'loop ']) {
      expect(isVariantId(bad)).toBe(false);
    }
  });

  test('loads plannotator gates without offering them in creation menus', () => {
    expect(VARIANTS).toContain('plannotator_gate');
    expect(CREATABLE_VARIANTS).not.toContain('plannotator_gate');
  });
});
