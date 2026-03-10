import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth-guards';
import { prismaUnfiltered as prisma } from '@/lib/prisma';
import { errorResponse } from '@/lib/api-response';
import {
  addJob,
  JobType,
  audioGenerationQueue,
  visualClassificationQueue,
} from '@/lib/queue';

/**
 * POST /api/admin/showcase/[podcastId]/generate-all
 *
 * State-machine orchestrator: inspects podcast status and performs the next
 * applicable action. Each call is non-blocking — the frontend polls and
 * re-calls when a status transition completes.
 *
 * Flow:
 *   SCRIPT_READY → approve script (create segments, queue audio) → { nextStep: 'audio' }
 *   READY (audio done) → trigger video pipeline → { nextStep: 'video' }
 *   other → { currentStatus, message: 'poll for progress' }
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ podcastId: string }> },
) {
  const adminId = await requireAdmin();
  if (!adminId) return errorResponse('Forbidden', 403);

  const { podcastId } = await params;

  const podcast = await prisma.podcast.findUnique({
    where: { id: podcastId },
    select: {
      id: true,
      status: true,
      ttsProvider: true,
      script: { select: { id: true, turns: true } },
      segments: {
        select: { id: true, order: true, speaker: true, text: true, ttsProvider: true },
        orderBy: { order: 'asc' },
      },
    },
  });

  if (!podcast) return errorResponse('Podcast not found', 404);

  const body = await request.json().catch(() => ({}));
  const { pipeline } = body as { pipeline?: Record<string, unknown> };

  // ── SCRIPT_READY → Approve script + queue audio ──────────────────────
  if (podcast.status === 'SCRIPT_READY') {
    // If segments already exist (previously approved then reverted), re-use them.
    // Otherwise create segments from script turns.
    if (podcast.segments.length === 0) {
      const turns = (podcast.script?.turns as Array<{ speaker: string; text: string }>) ?? [];
      if (turns.length === 0) {
        return errorResponse('No script turns found', 400);
      }

      // Create segments from script turns
      for (let i = 0; i < turns.length; i++) {
        await prisma.segment.create({
          data: {
            podcastId,
            order: i + 1,
            speaker: turns[i].speaker,
            text: turns[i].text,
          },
        });
      }
    }

    // Refresh segments after potential creation
    const segments = await prisma.segment.findMany({
      where: { podcastId },
      orderBy: { order: 'asc' },
      select: { id: true, order: true, speaker: true, text: true, ttsProvider: true },
    });

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

    return NextResponse.json({
      podcastId,
      currentStatus: 'GENERATING_AUDIO',
      nextStep: 'audio',
      message: `Queued ${segments.length} segments for audio generation`,
    });
  }

  // ── READY → Trigger video pipeline ───────────────────────────────────
  if (podcast.status === 'READY') {
    // Create or reuse VideoGeneration record
    let videoGen = await prisma.videoGeneration.findFirst({
      where: { podcastId },
      select: { id: true, status: true, avatarsVisible: true },
    });

    if (!videoGen) {
      videoGen = await prisma.videoGeneration.create({
        data: {
          podcastId,
          status: 'PENDING',
          pipelineJson: pipeline ?? undefined,
        },
        select: { id: true, status: true, avatarsVisible: true },
      });
    } else if (videoGen.status === 'FAILED' || videoGen.status === 'READY') {
      // Reset to PENDING for re-generation
      await prisma.videoGeneration.update({
        where: { id: videoGen.id },
        data: {
          status: 'PENDING',
          pipelineJson: pipeline ?? undefined,
          failureReason: null,
          technicalError: null,
        },
      });
    } else {
      // Generation already in progress
      return NextResponse.json({
        podcastId,
        currentStatus: podcast.status,
        videoStatus: videoGen.status,
        nextStep: 'poll',
        message: `Video generation in progress (${videoGen.status})`,
      });
    }

    // Compute provider boundaries for transitions
    const segments = podcast.segments;
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
      podcastId,
      currentStatus: podcast.status,
      videoStatus: 'PENDING',
      nextStep: 'video',
      message: `Video pipeline started with ${providerBoundaries.length} transition(s)`,
    });
  }

  // ── Any other status → poll ──────────────────────────────────────────
  const videoGen = await prisma.videoGeneration.findFirst({
    where: { podcastId },
    select: { status: true },
  });

  return NextResponse.json({
    podcastId,
    currentStatus: podcast.status,
    videoStatus: videoGen?.status ?? null,
    nextStep: 'poll',
    message: `Podcast is ${podcast.status.replace(/_/g, ' ').toLowerCase()} — poll for progress`,
  });
}
