import { describe, expect, test } from 'bun:test';
import { fitGraphScale, graphBounds } from './graph-viewport';

describe('graphBounds', () => {
  test('no positions returns empty bounds', () => {
    expect(graphBounds({})).toEqual({ width: 0, height: 0 });
  });

  test('one node includes the 208x58 footprint plus 64px canvas padding on every side', () => {
    expect(graphBounds({ a: { x: 0, y: 0 } })).toEqual({ width: 336, height: 186 });
    expect(graphBounds({ a: { x: 40, y: 20 } })).toEqual({ width: 336, height: 186 });
  });

  test('multiple nodes span node rectangles plus 64px padding on every side', () => {
    expect(
      graphBounds({
        a: { x: 0, y: 0 },
        b: { x: 220, y: 160 },
      })
    ).toEqual({ width: 556, height: 346 });
  });
});

describe('fitGraphScale', () => {
  const oneNode = graphBounds({ a: { x: 0, y: 0 } });

  test('returns 1 for empty or non-positive dimensions', () => {
    expect(fitGraphScale(800, 600, { width: 0, height: 0 })).toBe(1);
    expect(fitGraphScale(800, 600, { width: -1, height: 100 })).toBe(1);
    expect(fitGraphScale(0, 600, oneNode)).toBe(1);
    expect(fitGraphScale(800, 0, oneNode)).toBe(1);
    expect(fitGraphScale(-10, 600, oneNode)).toBe(1);
    expect(fitGraphScale(20, 20, oneNode)).toBe(1);
  });

  test('clamps a diagram smaller than its viewport to 1.0', () => {
    expect(fitGraphScale(2000, 2000, oneNode)).toBe(1);
  });

  test('scales a diagram larger than its viewport and clamps to 0.25', () => {
    expect(fitGraphScale(200, 200, { width: 10000, height: 10000 })).toBe(0.25);
    expect(fitGraphScale(400, 400, { width: 616, height: 416 })).toBe(352 / 616);
  });

  test('defaults padding to 24 pixels on every side', () => {
    expect(fitGraphScale(400, 400, oneNode)).toBe(fitGraphScale(400, 400, oneNode, 24));
  });
});
