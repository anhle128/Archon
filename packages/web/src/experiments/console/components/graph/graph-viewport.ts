import type { Point } from '@/lib/run-graph';

const NODE_WIDTH = 180;
const NODE_HEIGHT = 80;
const CANVAS_PADDING = 64;
const DEFAULT_FIT_PADDING = 24;
const MIN_FIT_SCALE = 0.25;
const MAX_FIT_SCALE = 1;

export interface GraphBounds {
  width: number;
  height: number;
}

export function graphBounds(positions: Readonly<Record<string, Point>>): GraphBounds {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let found = false;
  for (const position of Object.values(positions)) {
    found = true;
    minX = Math.min(minX, position.x);
    minY = Math.min(minY, position.y);
    maxX = Math.max(maxX, position.x);
    maxY = Math.max(maxY, position.y);
  }
  if (!found) {
    return { width: 0, height: 0 };
  }
  return {
    width: maxX - minX + NODE_WIDTH + CANVAS_PADDING * 2,
    height: maxY - minY + NODE_HEIGHT + CANVAS_PADDING * 2,
  };
}

export function fitGraphScale(
  viewportWidth: number,
  viewportHeight: number,
  bounds: GraphBounds,
  padding: number = DEFAULT_FIT_PADDING
): number {
  if (viewportWidth <= 0 || viewportHeight <= 0 || bounds.width <= 0 || bounds.height <= 0) {
    return 1;
  }
  const availableWidth = viewportWidth - padding * 2;
  const availableHeight = viewportHeight - padding * 2;
  if (availableWidth <= 0 || availableHeight <= 0) {
    return 1;
  }
  const scale = Math.min(availableWidth / bounds.width, availableHeight / bounds.height);
  return Math.min(MAX_FIT_SCALE, Math.max(MIN_FIT_SCALE, scale));
}
