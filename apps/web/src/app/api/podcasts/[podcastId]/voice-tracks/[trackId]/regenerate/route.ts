import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { voiceTrackAudioQueue, addJob, JobType } from '@/lib/queue';
import { checkGenerationGate } from '@/lib/generation-gate';
import { checkRateLimit } from '@/lib/redis';
import { checkSuspension } from '@/lib/auth-guards';
import type { GenerateVoiceTrackAudioPayload } from '@/lib/queue';

import { errorResponse } from '@/lib/api-response';
type RouteParams = { params: Promise<{ podcastId: string; trackId: string }> };

export async function POST(_request: NextRequest, { params }: RouteParams) {
  const { podcastId, trackId } = await params;
  const session = await auth();
  if (!session?.user?.id) {
    return errorResponse('Unauthorized', 401);
  }

  const suspended = checkSuspension(session);
  if (suspended) return suspended;

  const userId = session.user.id;

  // Verify ownership
  const podcast = await prisma.podcast.findUnique({
    where: { id: podcastId },
    select: {
      userId: true,
      segments: { orderBy: { order: 'asc' as const }, select: { id: true, speaker: true, text: true, order: true } },
    },
  });

  if (!podcast || podcast.userId !== userId) {
    return errorResponse('Forbidden', 403);
  }

  const voiceTrack = await prisma.voiceTrack.findUnique({
    where: { id: trackId },
    select: { podcastId: true, status: true },
  });

  if (!voiceTrack || voiceTrack.podcastId !== podcastId) {
    return errorResponse('Voice track not found', 404);
  }

  if (voiceTrack.status !== 'STALE' && voiceTrack.status !== 'FAILED') {
    return errorResponse('Only STALE or FAILED voice tracks can be regenerated', 400);
  }

  // Rate limits
  const hourly = await checkRateLimit(`generate:hour:${userId}`, 20, 3600);
  if (!hourly.allowed) {
    return errorResponse('Rate limit exceeded: max 20 generations per hour.', 429);
  }
  const daily = await checkRateLimit(`generate:day:${userId}`, 100, 86400);
  if (!daily.allowed) {
    return errorResponse('Rate limit exceeded: max 100 generations per day.', 429);
  }

  const gate = await checkGenerationGate(userId);
  if (!gate.allowed) {
    const msg = gate.reason === 'generation_in_progress'
      ? 'A podcast is already generating. Wait for it to finish before starting another.'
      : 'No voice provider available. Add a TTS key in Settings for unlimited generation.';
    return errorResponse(msg, 403, { code: gate.reason });
  }

  // Sync voice track segments with current podcast segments
  const existingVtSegments = await prisma.voiceTrackSegment.findMany({
    where: { voiceTrackId: trackId },
    select: { id: true, segmentId: true, audioUrl: true },
  });

  const existingSegmentIds = new Set(existingVtSegments.map(s => s.segmentId));

  // Create VoiceTrackSegment records for any new podcast segments
  const newSegments = podcast.segments.filter(s => !existingSegmentIds.has(s.id));
  if (newSegments.length > 0) {
    await prisma.voiceTrackSegment.createMany({
      data: newSegments.map(seg => ({
        voiceTrackId: trackId,
        segmentId: seg.id,
        order: seg.order,
      })),
    });
  }

  // Queue audio generation only for segments without audio
  const segmentsToGenerate = await prisma.voiceTrackSegment.findMany({
    where: { voiceTrackId: trackId, audioUrl: null },
    select: { id: true, segmentId: true },
  });

  // Update status
  await prisma.voiceTrack.update({
    where: { id: trackId },
    data: { status: 'GENERATING_AUDIO', failureReason: null },
  });

  for (const vtSeg of segmentsToGenerate) {
    const podcastSeg = podcast.segments.find(s => s.id === vtSeg.segmentId);
    if (!podcastSeg) continue;

    const payload: GenerateVoiceTrackAudioPayload = {
      podcastId,
      voiceTrackId: trackId,
      voiceTrackSegmentId: vtSeg.id,
      segmentId: vtSeg.segmentId,
      speaker: podcastSeg.speaker,
      text: podcastSeg.text,
    };
    await addJob(voiceTrackAudioQueue, JobType.GENERATE_VOICE_TRACK_AUDIO, payload);
  }

  return NextResponse.json({
    id: trackId,
    status: 'GENERATING_AUDIO',
    segmentsToGenerate: segmentsToGenerate.length,
  });
}
