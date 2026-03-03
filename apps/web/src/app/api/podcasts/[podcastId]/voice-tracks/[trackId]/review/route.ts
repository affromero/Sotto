import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { notificationQueue, addJob, JobType } from '@/lib/queue';
import { errorResponse } from '@/lib/api-response';
import type { SendNotificationPayload } from '@/lib/queue';
import { z } from 'zod';

const reviewBodySchema = z.object({
  action: z.enum(['accept', 'reject']),
  rejectionReason: z.string().max(500).optional(),
});

type RouteParams = { params: Promise<{ podcastId: string; trackId: string }> };

export async function PATCH(request: NextRequest, { params }: RouteParams) {
  const { podcastId, trackId } = await params;
  const session = await auth();
  if (!session?.user?.id) {
    return errorResponse('Unauthorized', 401);
  }

  const userId = session.user.id;

  // Verify podcast ownership
  const podcast = await prisma.podcast.findUnique({
    where: { id: podcastId },
    select: { userId: true, title: true },
  });

  if (!podcast) {
    return errorResponse('Podcast not found', 404);
  }
  if (podcast.userId !== userId) {
    return errorResponse('Forbidden', 403);
  }

  // Fetch the voice track
  const track = await prisma.voiceTrack.findUnique({
    where: { id: trackId },
    select: {
      podcastId: true,
      proposalStatus: true,
      contributorId: true,
      name: true,
    },
  });

  if (!track || track.podcastId !== podcastId) {
    return errorResponse('Voice track not found', 404);
  }
  if (track.proposalStatus !== 'PENDING') {
    return errorResponse('Only pending proposals can be reviewed', 400);
  }

  const body = await request.json().catch(() => ({}));
  const parsed = reviewBodySchema.safeParse(body);
  if (!parsed.success) {
    return errorResponse(parsed.error.flatten(), 400);
  }

  const { action, rejectionReason } = parsed.data;

  if (action === 'accept') {
    await prisma.voiceTrack.update({
      where: { id: trackId },
      data: {
        proposalStatus: 'ACCEPTED',
        reviewedAt: new Date(),
      },
    });
  } else {
    await prisma.voiceTrack.update({
      where: { id: trackId },
      data: {
        proposalStatus: 'REJECTED',
        rejectionReason: rejectionReason || null,
        reviewedAt: new Date(),
      },
    });
  }

  // Notify the contributor
  if (track.contributorId) {
    const notifType = action === 'accept' ? 'RENDITION_ACCEPTED' : 'RENDITION_REJECTED';
    const title = action === 'accept'
      ? 'Your voice rendition was accepted!'
      : 'Your voice rendition was not accepted';
    const message = action === 'accept'
      ? `Your rendition "${track.name}" for "${podcast.title}" has been accepted`
      : `Your rendition "${track.name}" for "${podcast.title}" was not accepted${rejectionReason ? `: ${rejectionReason}` : ''}`;

    const notifPayload: SendNotificationPayload = {
      userId: track.contributorId,
      type: notifType,
      title,
      message,
      data: {
        podcastId,
        voiceTrackId: trackId,
      },
    };
    await addJob(notificationQueue, JobType.SEND_NOTIFICATION, notifPayload);
  }

  return NextResponse.json({ success: true, action });
}
