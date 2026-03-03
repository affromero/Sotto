import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { voiceForkBodySchema } from '@/lib/validations';
import { voiceTrackAudioQueue, addJob, JobType } from '@/lib/queue';
import { checkGenerationGate } from '@/lib/generation-gate';
import { computeVoiceCharges } from '@/lib/voice-pricing';
import { resolveTtsProvider } from '@/lib/providers';
import { checkRateLimit } from '@/lib/redis';
import { checkSuspension } from '@/lib/auth-guards';
import { generatePodcastSlug } from '@/lib/slugify';
import { errorResponse } from '@/lib/api-response';
import type { TtsProviderId } from '@/lib/providers/tts-registry';
import type { GenerateVoiceTrackAudioPayload } from '@/lib/queue';

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

  // Rate limits
  const hourly = await checkRateLimit(`generate:hour:${userId}`, 20, 3600);
  if (!hourly.allowed) {
    return errorResponse('Rate limit exceeded: max 20 generations per hour.', 429);
  }
  const daily = await checkRateLimit(`generate:day:${userId}`, 100, 86400);
  if (!daily.allowed) {
    return errorResponse('Rate limit exceeded: max 100 generations per day.', 429);
  }

  // Generation gate
  const gate = await checkGenerationGate(userId);
  if (!gate.allowed) {
    const msg = gate.reason === 'generation_in_progress'
      ? 'A podcast is already generating. Wait for it to finish before starting another.'
      : 'No voice provider available. Add a TTS key in Settings for unlimited generation.';
    return errorResponse(msg, 403, { code: gate.reason });
  }

  // Parse body
  const body = await request.json().catch(() => ({}));
  const parsed = voiceForkBodySchema.safeParse(body);
  if (!parsed.success) {
    return errorResponse(parsed.error.flatten(), 400);
  }

  const { name, ttsProvider, ttsModel, voices, paymentIntentIds, skipPaidVoices } = parsed.data;

  // Fetch source podcast
  const sourcePodcast = await prisma.podcast.findUnique({
    where: { id: podcastId },
    select: {
      id: true,
      userId: true,
      title: true,
      topic: true,
      status: true,
      visibility: true,
      segments: {
        orderBy: { order: 'asc' as const },
        select: { id: true, speaker: true, text: true, order: true },
      },
    },
  });

  if (!sourcePodcast) {
    return errorResponse('Podcast not found', 404);
  }
  if (sourcePodcast.visibility !== 'PUBLIC') {
    return errorResponse('Only public podcasts can be re-voiced', 403);
  }
  if (sourcePodcast.status !== 'READY') {
    return errorResponse('Only podcasts with READY status can be re-voiced', 400);
  }

  // Check paid voices
  const voicesWithIds = voices.filter(v => !!v.voiceId);
  if (!skipPaidVoices && !paymentIntentIds && voicesWithIds.length > 0) {
    const voiceCharges = await computeVoiceCharges(userId, voicesWithIds);
    if (voiceCharges.length > 0) {
      return NextResponse.json(
        { requiresPayment: true, voiceCharges, sourceTitle: sourcePodcast.title },
        { status: 402 },
      );
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
    plan: gate.isProUser ? 'PRO' : 'FREE',
  });

  // Create voice-only fork podcast + voice track in a transaction
  const { forkPodcast, voiceTrack } = await prisma.$transaction(async (tx) => {
    const slug = await generatePodcastSlug(`${name} — ${sourcePodcast.title}`, userId, tx);
    const newPodcast = await tx.podcast.create({
      data: {
        userId,
        title: `${name} — ${sourcePodcast.title}`,
        topic: sourcePodcast.topic,
        slug,
        status: 'GENERATING_AUDIO',
        visibility: 'PRIVATE',
        forkedFromId: podcastId,
        isVoiceOnlyFork: true,
        ttsProvider: providerId,
        ttsModel: ttsModel || null,
      },
    });

    // Copy speaker list from parent as PodcastVoice records
    await tx.podcastVoice.createMany({
      data: resolvedVoices.map(v => ({
        podcastId: newPodcast.id,
        speaker: v.speaker,
        voiceId: v.voiceId,
        provider: providerId,
      })),
    });

    // Create VoiceTrack
    const track = await tx.voiceTrack.create({
      data: {
        podcastId: newPodcast.id,
        name,
        status: 'GENERATING_AUDIO',
        ttsProvider: providerId,
        ttsModel: ttsModel || null,
      },
    });

    // Create VoiceTrackVoice assignments
    await tx.voiceTrackVoice.createMany({
      data: resolvedVoices.map(v => ({
        voiceTrackId: track.id,
        speaker: v.speaker,
        voiceId: v.voiceId,
        provider: providerId,
      })),
    });

    // Create VoiceTrackSegment rows referencing parent's Segment IDs
    await tx.voiceTrackSegment.createMany({
      data: sourcePodcast.segments.map(seg => ({
        voiceTrackId: track.id,
        segmentId: seg.id,
        order: seg.order,
      })),
    });

    // Increment parent's forkCount
    await tx.podcast.update({
      where: { id: podcastId },
      data: { forkCount: { increment: 1 } },
    });

    return { forkPodcast: newPodcast, voiceTrack: track };
  });

  // Link VoicePurchase records
  if (paymentIntentIds) {
    await prisma.voicePurchase.updateMany({
      where: { stripePaymentIntent: { in: paymentIntentIds } },
      data: { podcastId: forkPodcast.id },
    });
  }

  // Queue audio generation for each segment
  const vtSegments = await prisma.voiceTrackSegment.findMany({
    where: { voiceTrackId: voiceTrack.id },
    orderBy: { order: 'asc' },
    select: { id: true, segmentId: true },
  });

  for (const vtSeg of vtSegments) {
    const podcastSeg = sourcePodcast.segments.find(s => s.id === vtSeg.segmentId);
    if (!podcastSeg) continue;

    const payload: GenerateVoiceTrackAudioPayload = {
      podcastId: forkPodcast.id,
      voiceTrackId: voiceTrack.id,
      voiceTrackSegmentId: vtSeg.id,
      segmentId: vtSeg.segmentId,
      speaker: podcastSeg.speaker,
      text: podcastSeg.text,
    };
    await addJob(voiceTrackAudioQueue, JobType.GENERATE_VOICE_TRACK_AUDIO, payload);
  }

  return NextResponse.json(
    { id: forkPodcast.id, voiceTrackId: voiceTrack.id },
    { status: 201 },
  );
}
