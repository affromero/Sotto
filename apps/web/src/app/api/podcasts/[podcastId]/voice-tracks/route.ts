import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { createVoiceTrackSchema } from '@/lib/validations';
import { voiceTrackAudioQueue, addJob, JobType } from '@/lib/queue';
import { getTierFeatures } from '@/lib/tier-features';
import { checkGenerationGate } from '@/lib/generation-gate';
import { computeVoiceCharges } from '@/lib/voice-pricing';
import { resolveTtsProvider } from '@/lib/providers';
import { checkRateLimit } from '@/lib/redis';
import { checkSuspension } from '@/lib/auth-guards';
import type { TtsProviderId } from '@/lib/providers/tts-registry';
import type { GenerateVoiceTrackAudioPayload } from '@/lib/queue';

import { errorResponse } from '@/lib/api-response';
type RouteParams = { params: Promise<{ podcastId: string }> };

export async function POST(request: NextRequest, { params }: RouteParams) {
  const { podcastId } = await params;
  const session = await auth();
  if (!session?.user?.id) {
    return errorResponse('Unauthorized', 401);
  }

  const suspended = checkSuspension(session);
  if (suspended) return suspended;

  const userId = session.user.id;

  // Verify podcast ownership
  const podcast = await prisma.podcast.findUnique({
    where: { id: podcastId },
    select: {
      userId: true,
      status: true,
      segments: { orderBy: { order: 'asc' as const }, select: { id: true, speaker: true, text: true, order: true } },
    },
  });

  if (!podcast) {
    return errorResponse('Podcast not found', 404);
  }
  if (podcast.userId !== userId) {
    return errorResponse('Forbidden', 403);
  }
  if (podcast.status !== 'READY') {
    return errorResponse('Podcast must be in READY status', 400);
  }

  // Check tier features
  const gate = await checkGenerationGate(userId);
  const features = getTierFeatures(gate.isProUser ? 'PRO' : 'FREE', gate.isByokUser, session.user.role);

  if (!features.voiceTracksEnabled) {
    return errorResponse('Voice tracks are not available on your plan. Upgrade to Pro or add your own API keys.', 403);
  }

  // Check track limit
  const existingTrackCount = await prisma.voiceTrack.count({
    where: { podcastId },
  });
  if (existingTrackCount >= features.maxVoiceTracks) {
    return errorResponse(`Maximum ${features.maxVoiceTracks} voice tracks per podcast.`, 403);
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

  if (!gate.allowed) {
    const msg = gate.reason === 'free_tier_exhausted'
      ? 'Free generations used. Add your own API keys to continue.'
      : 'No voice provider available. Add a TTS key in Settings.';
    return errorResponse(msg, 403, { code: gate.reason });
  }

  // Parse body
  const body = await request.json().catch(() => ({}));
  const parsed = createVoiceTrackSchema.safeParse(body);
  if (!parsed.success) {
    return errorResponse(parsed.error.flatten(), 400);
  }

  const { name, ttsProvider, ttsModel, voices, paymentIntentIds, skipPaidVoices } = parsed.data;

  // Check paid voices
  const voicesWithIds = voices.filter(v => !!v.voiceId);
  if (!skipPaidVoices && !paymentIntentIds && voicesWithIds.length > 0) {
    const voiceCharges = await computeVoiceCharges(userId, voicesWithIds);
    if (voiceCharges.length > 0) {
      return NextResponse.json({ requiresPayment: true, voiceCharges }, { status: 402 });
    }
  }

  const resolvedVoices = skipPaidVoices
    ? voices.map(v => ({ ...v, voiceId: '' }))
    : voices;

  // Verify payment intents
  if (paymentIntentIds) {
    for (const piId of paymentIntentIds) {
      const purchase = await prisma.voicePurchase.findUnique({
        where: { stripePaymentIntent: piId },
      });
      if (!purchase || purchase.status !== 'authorized' || purchase.buyerId !== userId) {
        return errorResponse('Invalid or unauthorized payment', 400);
      }
    }
  }

  // Resolve TTS provider
  const { providerId } = await resolveTtsProvider({
    userId,
    podcastId,
    requestedProvider: (ttsProvider as TtsProviderId | null) ?? undefined,
    requestedModel: ttsModel,
  });

  // Create voice track, voice assignments, and segments in a transaction
  const voiceTrack = await prisma.$transaction(async (tx) => {
    const track = await tx.voiceTrack.create({
      data: {
        podcastId,
        name,
        status: 'GENERATING_AUDIO',
        ttsProvider: providerId,
        ttsModel: ttsModel || null,
      },
    });

    // Create voice assignments
    await tx.voiceTrackVoice.createMany({
      data: resolvedVoices.map(v => ({
        voiceTrackId: track.id,
        speaker: v.speaker,
        voiceId: v.voiceId,
      })),
    });

    // Create voice track segments for each podcast segment
    await tx.voiceTrackSegment.createMany({
      data: podcast.segments.map(seg => ({
        voiceTrackId: track.id,
        segmentId: seg.id,
        order: seg.order,
      })),
    });

    return track;
  });

  // Link VoicePurchase records
  if (paymentIntentIds) {
    await prisma.voicePurchase.updateMany({
      where: { stripePaymentIntent: { in: paymentIntentIds } },
      data: { podcastId },
    });
  }

  // Queue audio generation for each segment
  const vtSegments = await prisma.voiceTrackSegment.findMany({
    where: { voiceTrackId: voiceTrack.id },
    orderBy: { order: 'asc' },
    select: { id: true, segmentId: true },
  });

  for (const vtSeg of vtSegments) {
    const podcastSeg = podcast.segments.find(s => s.id === vtSeg.segmentId);
    if (!podcastSeg) continue;

    const payload: GenerateVoiceTrackAudioPayload = {
      podcastId,
      voiceTrackId: voiceTrack.id,
      voiceTrackSegmentId: vtSeg.id,
      segmentId: vtSeg.segmentId,
      speaker: podcastSeg.speaker,
      text: podcastSeg.text,
    };
    await addJob(voiceTrackAudioQueue, JobType.GENERATE_VOICE_TRACK_AUDIO, payload);
  }

  return NextResponse.json({ id: voiceTrack.id, status: voiceTrack.status }, { status: 201 });
}

export async function GET(_request: NextRequest, { params }: RouteParams) {
  const { podcastId } = await params;

  // Auth is optional — public podcasts visible to all
  const session = await auth();
  const userId = session?.user?.id;

  const podcast = await prisma.podcast.findUnique({
    where: { id: podcastId },
    select: { userId: true, visibility: true },
  });

  if (!podcast) {
    return errorResponse('Podcast not found', 404);
  }

  if (podcast.visibility === 'PRIVATE' && podcast.userId !== userId) {
    return errorResponse('Forbidden', 403);
  }

  const isOwner = podcast.userId === userId;

  const tracks = await prisma.voiceTrack.findMany({
    where: {
      podcastId,
      ...(isOwner ? {} : { status: 'READY' }),
    },
    orderBy: { createdAt: 'asc' },
    select: {
      id: true,
      name: true,
      status: true,
      audioUrl: true,
      duration: true,
      ttsProvider: true,
      failureReason: isOwner ? true : false,
      voices: { select: { speaker: true, voiceId: true } },
    },
  });

  return NextResponse.json(tracks);
}
