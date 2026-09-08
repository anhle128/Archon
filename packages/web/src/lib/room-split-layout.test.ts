import { describe, expect, test } from 'bun:test';

import { readRoomRatio, roomPanelSizes, writeRoomRatio } from './room-split-layout';

const storage = new Map<string, string>();
const memoryStorage = {
  getItem(key: string): string | null {
    return storage.get(key) ?? null;
  },
  setItem(key: string, value: string): void {
    storage.set(key, value);
  },
};

describe('room-split-layout', () => {
  test('uses percentage strings for every panel boundary', () => {
    expect(roomPanelSizes(40)).toEqual({
      view: { defaultSize: '60%', minSize: '30%' },
      room: { defaultSize: '40%', minSize: '24%', maxSize: '60%' },
    });
  });

  test('clamps persisted ratios and isolates surfaces', () => {
    writeRoomRatio('legacy', 90, memoryStorage);
    expect(readRoomRatio('legacy', memoryStorage)).toBe(60);
    expect(readRoomRatio('console', memoryStorage)).toBe(40);
    storage.set('archon.run-room.ratio.console', 'broken');
    expect(readRoomRatio('console', memoryStorage)).toBe(40);
  });
});
