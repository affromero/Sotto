import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth-guards';
import { prismaUnfiltered as prisma } from '@/lib/prisma';
import { errorResponse } from '@/lib/api-response';
import { addJob, JobType, audioGenerationQueue } from '@/lib/queue';

/** POST — Trigger audio generation for a showcase podcast with per-segment TTS overrides */
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ podcastId: string }> },
) {
  const adminId = await requireAdmin();
  if (!adminId) return errorResponse('Forbidden', 403);

  const { podcastId } = await params;

  const segments = await prisma.segment.findMany({
    where: { podcastId },
    orderBy: { order: 'asc' },
    select: {
      id: true,
      speaker: true,
      text: true,
      order: true,
      ttsProvider: true,
    },
  });

  if (segments.length === 0) {
    return errorResponse('Podcast has no segments', 404);
  }

  // Validate all segments have ttsProvider set
  const missing = segments.filter((s) => !s.ttsProvider);
  if (missing.length > 0) {
    return errorResponse(
      `${missing.length} segment(s) missing ttsProvider assignment (orders: ${missing.map((s) => s.order).join(', ')})`,
      400,
    );
  }

  // Clear existing audio so the worker regenerates
  await prisma.segment.updateMany({
    where: { podcastId },
    data: { audioUrl: null, duration: null, startTime: null },
  });

  // Queue audio generation for each segment
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    const previousText = i > 0 ? segments[i - 1].text.slice(-500) : undefined;
    const nextText = i < segments.length - 1 ? segments[i + 1].text.slice(0, 500) : undefined;

    await addJob(audioGenerationQueue, JobType.GENERATE_AUDIO, {
      podcastId,
      segmentId: seg.id,
      speaker: seg.speaker,
      text: seg.text,
      previousText,
      nextText,
    });
  }

  await prisma.podcast.update({
    where: { id: podcastId },
    data: { status: 'GENERATING_AUDIO' },
  });

  return NextResponse.json({ queued: segments.length });
}
