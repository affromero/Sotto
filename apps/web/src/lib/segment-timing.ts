import { prismaUnfiltered as prisma } from './prisma';
import { estimateDurationFromText } from './duration';

export interface SegmentTiming {
  segmentId: string;
  order: number;
  speaker: string;
  text: string;
  duration: number;
  startTime: number;
}

/**
 * Resolve segment timing for video generation.
 */
export async function resolveSegmentTiming(episodeId: string): Promise<SegmentTiming[]> {
  const segments = await prisma.segment.findMany({
    where: { episodeId },
    orderBy: { order: 'asc' },
    select: { id: true, order: true, speaker: true, text: true, duration: true, startTime: true },
  });
  return segments.map((s) => ({
    segmentId: s.id,
    order: s.order,
    speaker: s.speaker,
    text: s.text,
    duration: s.duration ?? estimateDurationFromText(s.text),
    startTime: s.startTime ?? 0,
  }));
}
