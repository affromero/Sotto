// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { detectSegmentBoundaries, resolveSegmentStarts } from '@/lib/audio/segment-boundaries';

describe('segment playback start times', () => {
  it('retains reliable correlation matches without applying overlap twice', () => {
    expect(resolveSegmentStarts([0, 9.8, 19.6], [10, 10, 10])).toEqual([0, 9.8, 19.6]);
  });
  it('replaces backward or implausibly close matches with cumulative timing', () => {
    for (const detected of [[0, 11, 3], [0, 1, 2], []]) {
      const starts = resolveSegmentStarts(detected, [10, 10, 10]);
      expect(starts[0]).toBe(0);
      expect(starts[1]).toBeCloseTo(9.7);
      expect(starts[2]).toBeCloseTo(19.4);
    }
  });
  it("uses the caller's actual crossfade when matches are incomplete", () => {
    expect(resolveSegmentStarts([0], [5, 8], 0.1)).toEqual([0, 4.9]);
  });
  it('handles empty and single short segments without requiring FFmpeg', async () => {
    expect(resolveSegmentStarts([], [])).toEqual([]);
    expect(resolveSegmentStarts([], [0.1])).toEqual([0]);
    expect(await detectSegmentBoundaries('/unused', [], '/unused')).toEqual([]);
    expect(await detectSegmentBoundaries('/unused', ['/one-segment'], '/unused')).toEqual([0]);
  });
  it('honors cancellation before even short segment analysis', async () => {
    const reason = new Error('Generation stopped');
    for (const segments of [[], ['/one-segment']])
      await expect(
        detectSegmentBoundaries('/unused', segments, '/unused', AbortSignal.abort(reason))
      ).rejects.toBe(reason);
  });
});
