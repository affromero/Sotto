import type { SegmentData } from '@/types/episode';
import type { WordTiming } from '@sotto/shared';

/**
 * Binary search for the word whose timing window contains `timeInSegment`.
 * Returns the index into `wordTimings`, or -1 if no word matches.
 */
export function findActiveWordIndex(wordTimings: WordTiming[], timeInSegment: number): number {
  let lo = 0;
  let hi = wordTimings.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >>> 1;
    const w = wordTimings[mid];
    if (timeInSegment < w.start) {
      hi = mid - 1;
    } else if (timeInSegment >= w.end) {
      lo = mid + 1;
    } else {
      return mid;
    }
  }
  return -1;
}

export function findActiveIndex(segments: SegmentData[], currentTime: number): number {
  for (let i = segments.length - 1; i >= 0; i--) {
    const seg = segments[i];
    if (seg.startTime !== null && currentTime >= seg.startTime) {
      return i;
    }
  }
  return 0;
}
