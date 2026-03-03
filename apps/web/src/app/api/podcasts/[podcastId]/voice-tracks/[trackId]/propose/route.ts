import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { notificationQueue, addJob, JobType } from '@/lib/queue';
import { checkSuspension } from '@/lib/auth-guards';
import { errorResponse } from '@/lib/api-response';
import type { SendNotificationPayload } from '@/lib/queue';
import { z } from 'zod';

const proposeBodySchema = z.object({
  message: z.string().max(500).optional(),
});

type RouteParams = { params: Promise<{ podcastId: string; trackId: string }> };

export async function POST(request: NextRequest, { params }: RouteParams) {
  const { podcastId, trackId } = await params;
  const session = await auth();
  if (!session?.user?.id) {
    return errorResponse('Unauthorized', 401);
  }

  const suspended = checkSuspension(session);
  if (suspended) return suspended;

  const userId = session.user.id;

  // Fetch the fork podcast and verify ownership
  const forkPodcast = await prisma.podcast.findUnique({
    where: { id: podcastId },
    select: {
      userId: true,
      isVoiceOnlyFork: true,
      forkedFromId: true,
      title: true,
    },
  });

  if (!forkPodcast) {
    return errorResponse('Podcast not found', 404);
  }
  if (forkPodcast.userId !== userId) {
    return errorResponse('Forbidden', 403);
  }
  if (!forkPodcast.isVoiceOnlyFork || !forkPodcast.forkedFromId) {
    return errorResponse('Only voice-only forks can propose renditions', 400);
  }

  // Fetch the voice track and verify it belongs to this fork and is READY
  const sourceTrack = await prisma.voiceTrack.findUnique({
    where: { id: trackId },
    include: {
      voices: { select: { speaker: true, voiceId: true, provider: true } },
      segments: {
        orderBy: { order: 'asc' },
        select: { segmentId: true, audioUrl: true, duration: true, startTime: true, order: true },
      },
    },
  });

  if (!sourceTrack || sourceTrack.podcastId !== podcastId) {
    return errorResponse('Voice track not found', 404);
  }
  if (sourceTrack.status !== 'READY') {
    return errorResponse('Voice track must be READY before proposing', 400);
  }

  // Verify the original podcast exists
  const originalPodcast = await prisma.podcast.findUnique({
    where: { id: forkPodcast.forkedFromId },
    select: { id: true, userId: true, title: true },
  });

  if (!originalPodcast) {
    return errorResponse('Original podcast no longer exists', 404);
  }

  // Check for duplicate proposal
  const existingProposal = await prisma.voiceTrack.findFirst({
    where: {
      podcastId: originalPodcast.id,
      proposedFromPodcastId: podcastId,
      contributorId: userId,
      proposalStatus: 'PENDING',
    },
  });

  if (existingProposal) {
    return errorResponse('You already have a pending proposal for this podcast', 409);
  }

  const body = await request.json().catch(() => ({}));
  const parsed = proposeBodySchema.safeParse(body);
  if (!parsed.success) {
    return errorResponse(parsed.error.flatten(), 400);
  }

  // Create a new VoiceTrack on the original podcast with proposal fields
  const proposedTrack = await prisma.$transaction(async (tx) => {
    const track = await tx.voiceTrack.create({
      data: {
        podcastId: originalPodcast.id,
        name: sourceTrack.name,
        status: 'READY',
        audioUrl: sourceTrack.audioUrl,
        duration: sourceTrack.duration,
        fileSize: sourceTrack.fileSize,
        ttsProvider: sourceTrack.ttsProvider,
        ttsModel: sourceTrack.ttsModel,
        contributorId: userId,
        proposalStatus: 'PENDING',
        proposalMessage: parsed.data.message || null,
        proposedFromPodcastId: podcastId,
      },
    });

    // Copy VoiceTrackVoice records
    if (sourceTrack.voices.length > 0) {
      await tx.voiceTrackVoice.createMany({
        data: sourceTrack.voices.map(v => ({
          voiceTrackId: track.id,
          speaker: v.speaker,
          voiceId: v.voiceId,
          provider: v.provider,
        })),
      });
    }

    // Copy VoiceTrackSegment records
    if (sourceTrack.segments.length > 0) {
      await tx.voiceTrackSegment.createMany({
        data: sourceTrack.segments.map(seg => ({
          voiceTrackId: track.id,
          segmentId: seg.segmentId,
          audioUrl: seg.audioUrl,
          duration: seg.duration,
          startTime: seg.startTime,
          order: seg.order,
        })),
      });
    }

    return track;
  });

  // Notify original podcast owner
  if (originalPodcast.userId !== userId) {
    const proposer = await prisma.user.findUnique({
      where: { id: userId },
      select: { name: true },
    });
    const proposerName = proposer?.name || 'Someone';
    const notifPayload: SendNotificationPayload = {
      userId: originalPodcast.userId,
      type: 'RENDITION_PROPOSED',
      title: 'New voice rendition proposed',
      message: `${proposerName} proposed a voice rendition for "${originalPodcast.title}"`,
      data: {
        podcastId: originalPodcast.id,
        voiceTrackId: proposedTrack.id,
        proposerName,
      },
    };
    await addJob(notificationQueue, JobType.SEND_NOTIFICATION, notifPayload);
  }

  return NextResponse.json(
    { id: proposedTrack.id, podcastId: originalPodcast.id },
    { status: 201 },
  );
}
