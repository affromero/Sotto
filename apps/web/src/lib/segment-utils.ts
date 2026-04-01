import type { SegmentData } from '@/types/podcast';
import type { WordTiming } from '@sotto/shared';
import type { VideoSegment } from '@sotto/video';

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

export interface SegmentVisualData {
  id: string;
  segmentId: string;
  visualType: string;
  visualMode?: string | null;
  videoModel?: string | null;
  prompt?: string | null;
  metadata?: Record<string, unknown> | null;
  assetUrl?: string | null;
  assetType?: string | null;
  firstFrameUrl?: string | null;
  status: string;
  failureReason?: string | null;
  order: number;
  subOrder?: number;
  startOffset?: number;
  subDuration?: number | null;
}

export function buildVideoSegments(
  segments: SegmentData[],
  visuals: SegmentVisualData[],
): VideoSegment[] {
  // Group visuals by segmentId, sorted by subOrder
  const visualsBySegment = new Map<string, SegmentVisualData[]>();
  for (const v of visuals) {
    const list = visualsBySegment.get(v.segmentId) ?? [];
    list.push(v);
    visualsBySegment.set(v.segmentId, list);
  }
  for (const list of visualsBySegment.values()) {
    list.sort((a, b) => (a.subOrder ?? 0) - (b.subOrder ?? 0));
  }

  return segments
    .filter((s) => s.startTime !== null && s.duration !== null)
    .map((s) => {
      const segVisuals = visualsBySegment.get(s.id) ?? [];
      const first = segVisuals[0];

      const base: VideoSegment = {
        segmentId: s.id,
        order: s.order,
        speaker: s.speaker,
        text: s.text,
        startTime: s.startTime!,
        duration: s.duration!,
        visualType: first?.visualType ?? 'TEXT_CARD',
        prompt: first?.prompt ?? undefined,
        metadata: (first?.metadata as Record<string, unknown>) ?? undefined,
        assetUrl: first?.assetUrl ?? undefined,
        assetType: first?.assetType ?? undefined,
      };

      if (segVisuals.length > 1) {
        base.subVisuals = segVisuals.map((v) => ({
          subOrder: v.subOrder ?? 0,
          startOffset: v.startOffset ?? 0,
          duration: v.subDuration ?? s.duration!,
          visualType: v.visualType,
          prompt: v.prompt ?? undefined,
          metadata: (v.metadata as Record<string, unknown>) ?? undefined,
          assetUrl: v.assetUrl ?? undefined,
          assetType: v.assetType ?? undefined,
        }));
      }

      return base;
    });
}

export function computeTotalFrames(segments: VideoSegment[], fps: number): number {
  if (segments.length === 0) return 1;
  const last = segments[segments.length - 1];
  return Math.ceil((last.startTime + last.duration) * fps);
}
