import type { SegmentData } from '@/types/podcast';
import type { VideoSegment } from '@sotto/video';

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
  segmentId: string;
  visualType: string;
  prompt?: string | null;
  metadata?: Record<string, unknown> | null;
  assetUrl?: string | null;
  assetType?: string | null;
  order: number;
}

export function buildVideoSegments(
  segments: SegmentData[],
  visuals: SegmentVisualData[],
): VideoSegment[] {
  const visualBySegment = new Map<string, SegmentVisualData>();
  for (const v of visuals) {
    visualBySegment.set(v.segmentId, v);
  }

  return segments
    .filter((s) => s.startTime !== null && s.duration !== null)
    .map((s) => {
      const visual = visualBySegment.get(s.id);
      return {
        segmentId: s.id,
        order: s.order,
        speaker: s.speaker,
        text: s.text,
        startTime: s.startTime!,
        duration: s.duration!,
        visualType: visual?.visualType ?? 'TEXT_CARD',
        prompt: visual?.prompt ?? undefined,
        metadata: (visual?.metadata as Record<string, unknown>) ?? undefined,
        assetUrl: visual?.assetUrl ?? undefined,
        assetType: visual?.assetType ?? undefined,
      };
    });
}

export function computeTotalFrames(segments: VideoSegment[], fps: number): number {
  if (segments.length === 0) return 1;
  const last = segments[segments.length - 1];
  return Math.ceil((last.startTime + last.duration) * fps);
}
