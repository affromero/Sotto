import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth-guards';
import { prismaUnfiltered as prisma } from '@/lib/prisma';
import { errorResponse } from '@/lib/api-response';
import { addJob, JobType, visualClassificationQueue } from '@/lib/queue';

/**
 * POST — Create SegmentTransition records at provider boundaries and trigger
 * the video pipeline for a showcase podcast.
 */
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ podcastId: string }> },
) {
  const adminId = await requireAdmin();
  if (!adminId) return errorResponse('Forbidden', 403);

  const { podcastId } = await params;

  const podcast = await prisma.podcast.findUnique({
    where: { id: podcastId },
    select: { id: true, status: true },
  });

  if (!podcast) return errorResponse('Podcast not found', 404);
  if (podcast.status !== 'READY') {
    return errorResponse('Podcast must be in READY status to generate video', 400);
  }

  const segments = await prisma.segment.findMany({
    where: { podcastId },
    orderBy: { order: 'asc' },
    select: { id: true, order: true, ttsProvider: true },
  });

  // Compute provider boundaries
  const providerBoundaries: Array<{
    fromSegmentId: string;
    toSegmentId: string;
    fromOrder: number;
    toOrder: number;
  }> = [];
  for (let i = 0; i < segments.length - 1; i++) {
    if (segments[i].ttsProvider !== segments[i + 1].ttsProvider) {
      providerBoundaries.push({
        fromSegmentId: segments[i].id,
        toSegmentId: segments[i + 1].id,
        fromOrder: segments[i].order,
        toOrder: segments[i + 1].order,
      });
    }
  }

  // Create or reuse VideoGeneration record
  let videoGen = await prisma.videoGeneration.findFirst({
    where: { podcastId },
    select: { id: true },
  });

  if (!videoGen) {
    videoGen = await prisma.videoGeneration.create({
      data: { podcastId, status: 'PENDING' },
      select: { id: true },
    });
  } else {
    await prisma.videoGeneration.update({
      where: { id: videoGen.id },
      data: { status: 'PENDING' },
    });
  }

  // Create SegmentTransition records at provider boundaries
  for (const boundary of providerBoundaries) {
    await prisma.segmentTransition.upsert({
      where: {
        videoGenerationId_fromSegmentId_toSegmentId: {
          videoGenerationId: videoGen.id,
          fromSegmentId: boundary.fromSegmentId,
          toSegmentId: boundary.toSegmentId,
        },
      },
      update: { recommended: true, enabled: true, status: 'pending' },
      create: {
        videoGenerationId: videoGen.id,
        fromSegmentId: boundary.fromSegmentId,
        toSegmentId: boundary.toSegmentId,
        fromSegmentOrder: boundary.fromOrder,
        toSegmentOrder: boundary.toOrder,
        recommended: true,
        enabled: true,
      },
    });
  }

  // Kick off the video pipeline
  await addJob(visualClassificationQueue, JobType.CLASSIFY_VISUALS, { podcastId });

  return NextResponse.json({
    videoGenerationId: videoGen.id,
    transitionsCreated: providerBoundaries.length,
  });
}
