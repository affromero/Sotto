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
 * When voiceTrackId is null/undefined: reads from Segment (original audio).
 * When voiceTrackId is set: reads from VoiceTrackSegment joined with Segment for text/speaker.
 */
export async function resolveSegmentTiming(
  podcastId: string,
  voiceTrackId?: string | null,
): Promise<SegmentTiming[]> {
  if (!voiceTrackId) {
    const segments = await prisma.segment.findMany({
      where: { podcastId },
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

  // Voice track: join VoiceTrackSegment with Segment for text/speaker
  const voiceTrackSegments = await prisma.voiceTrackSegment.findMany({
    where: { voiceTrackId },
    orderBy: { order: 'asc' },
    select: {
      segmentId: true,
      order: true,
      duration: true,
      startTime: true,
      segment: {
        select: { speaker: true, text: true },
      },
    },
  });

  return voiceTrackSegments.map((vts) => ({
    segmentId: vts.segmentId,
    order: vts.order,
    speaker: vts.segment.speaker,
    text: vts.segment.text,
    duration: vts.duration ?? estimateDurationFromText(vts.segment.text),
    startTime: vts.startTime ?? 0,
  }));
}
