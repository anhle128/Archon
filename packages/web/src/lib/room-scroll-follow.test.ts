import { describe, expect, test } from 'bun:test';

import { createScrollFollow, jumpToLatest, onRoomScroll } from './room-scroll-follow';

const AT_THRESHOLD = { scrollTop: 176, scrollHeight: 400, clientHeight: 200 };
const PAST_THRESHOLD = { scrollTop: 175, scrollHeight: 400, clientHeight: 200 };

describe('createScrollFollow', () => {
  test('completed and failed rows initialize at top unless a saved scroll exists', () => {
    expect(createScrollFollow('completed')).toEqual({
      follow: false,
      scrollTop: 0,
      pinToBottom: false,
    });
    expect(createScrollFollow('failed')).toEqual({
      follow: false,
      scrollTop: 0,
      pinToBottom: false,
    });
  });

  test('running and awaiting rows initialize at bottom and follow', () => {
    expect(createScrollFollow('running')).toEqual({
      follow: true,
      scrollTop: null,
      pinToBottom: true,
    });
    expect(createScrollFollow('awaiting')).toEqual({
      follow: true,
      scrollTop: null,
      pinToBottom: true,
    });
  });

  test('saved scrollTop wins when reopening the same execution', () => {
    expect(createScrollFollow('running', 88)).toEqual({
      follow: false,
      scrollTop: 88,
      pinToBottom: false,
    });
    expect(createScrollFollow('completed', 12)).toEqual({
      follow: false,
      scrollTop: 12,
      pinToBottom: false,
    });
  });
});

describe('onRoomScroll', () => {
  const following = createScrollFollow('running');

  test('a scroll more than 24 pixels away from bottom disables follow', () => {
    expect(onRoomScroll(following, PAST_THRESHOLD)).toEqual({
      follow: false,
      scrollTop: 175,
      pinToBottom: false,
    });
  });

  test('a scroll within 24 pixels of bottom preserves follow', () => {
    expect(onRoomScroll(following, AT_THRESHOLD)).toEqual({
      follow: true,
      scrollTop: 176,
      pinToBottom: true,
    });
  });
});

describe('jumpToLatest', () => {
  test('reenables follow and requests bottom alignment', () => {
    const scrolled = onRoomScroll(createScrollFollow('running'), PAST_THRESHOLD);
    expect(scrolled.follow).toBe(false);
    expect(jumpToLatest(scrolled)).toEqual({
      follow: true,
      scrollTop: 175,
      pinToBottom: true,
    });
  });
});
