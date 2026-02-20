import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequest } from '@/lib/api-keys';
import { prisma } from '@/lib/prisma';
import { forkBodySchema } from '@/lib/validations';
import { contentExtractionQueue, notificationQueue, addJob, JobType } from '@/lib/queue';
import { checkGenerationGate, tryIncrementFreeGeneration } from '@/lib/generation-gate';
import { selectFreeTierProviders } from '@/lib/free-tier-provider-selector';
import { computeVoiceCharges } from '@/lib/voice-pricing';
import { checkAutoTweetThreshold } from '@/lib/twitter-auto-tweet';
import { checkRateLimit } from '@/lib/redis';
import { LIMITS, FREE_TIER_MAX_DURATION_MINUTES } from '@/lib/stripe';
import { checkSuspension } from '@/lib/auth-guards';
import type { ExtractContentPayload, SendNotificationPayload } from '@/lib/queue';

type RouteParams = { params: Promise<{ podcastId: string }> };

export async function POST(request: NextRequest, { params }: RouteParams) {
  const { podcastId } = await params;
  const authResult = await authenticateRequest(request);

  if (!authResult) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Detect API key auth (Bearer token) vs browser session
  const authHeader = request.headers.get('authorization');
  const isApiKeyAuth = authHeader?.startsWith('Bearer ');

  // Session-based suspension check (skip for API key auth — those have separate controls)
  if (!isApiKeyAuth) {
    const { auth } = await import('@/lib/auth');
    const session = await auth();
    if (session) {
      const suspended = checkSuspension(session);
      if (suspended) return suspended;
    }
  }

  // Rate limit API key requests (60 requests per minute)
  if (isApiKeyAuth) {
    const rateLimit = await checkRateLimit(`api:fork:${authResult.userId}`, 60, 60);
    if (!rateLimit.allowed) {
      return NextResponse.json(
        { error: 'Rate limit exceeded', resetAt: rateLimit.resetAt },
        { status: 429 }
      );
    }
  }

  const userId = authResult.userId;

  // Rate limit: 20/hour, 100/day
  const hourly = await checkRateLimit(`generate:hour:${userId}`, 20, 3600);
  if (!hourly.allowed) {
    return NextResponse.json(
      { error: 'Rate limit exceeded: max 20 generations per hour.' },
      { status: 429 }
    );
  }
  const daily = await checkRateLimit(`generate:day:${userId}`, 100, 86400);
  if (!daily.allowed) {
    return NextResponse.json(
      { error: 'Rate limit exceeded: max 100 generations per day.' },
      { status: 429 }
    );
  }

  // Generation gate: BYOK or free tier
  const gate = await checkGenerationGate(userId);
  if (!gate.allowed) {
    const msg =
      gate.reason === 'free_tier_exhausted'
        ? 'Free generations used. Add your own API keys to continue.'
        : 'No voice provider available. Add a TTS key in Settings for unlimited generation.';
    return NextResponse.json({ error: msg, code: gate.reason }, { status: 403 });
  }

  // Atomically increment free tier counter BEFORE creating anything (avoids TOCTOU race)
  let freeTierTtsProvider: string | undefined;
  let freeTierTtsModel: string | undefined;
  let freeTierAiModel: string | undefined;
  if (!gate.isByokUser) {
    const selected = await selectFreeTierProviders(userId);
    const ok = await tryIncrementFreeGeneration(userId, gate.dailyLimit, {
      ai: { provider: selected.aiProvider, quota: selected.aiQuota },
      tts: { provider: selected.ttsProvider, quota: selected.ttsQuota },
    });
    if (!ok) {
      return NextResponse.json(
        { error: 'Free generations used.', code: 'free_tier_exhausted' },
        { status: 403 }
      );
    }
    freeTierTtsProvider = selected.ttsProvider;
    freeTierTtsModel = selected.ttsModel;
    freeTierAiModel = selected.aiModel;
  }

  const body = await request.json().catch(() => ({}));
  const parsed = forkBodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const { topic, remixNote, focusAreas, depth, tone } = parsed.data;

  const sourcePodcast = await prisma.podcast.findUnique({
    where: { id: podcastId },
    include: {
      tags: { select: { tagId: true } },
      voices: { select: { speaker: true, voiceId: true } },
      discovery: {
        select: {
          durationTarget: true,
          audienceLevel: true,
          audience: true,
          depth: true,
          tone: true,
          focusAreas: true,
        },
      },
      script: { select: { markdown: true } },
      user: { select: { name: true } },
    },
  });

  if (!sourcePodcast) {
    return NextResponse.json({ error: 'Podcast not found' }, { status: 404 });
  }

  if (sourcePodcast.visibility !== 'PUBLIC') {
    return NextResponse.json({ error: 'Only public podcasts can be forked' }, { status: 403 });
  }

  if (sourcePodcast.status !== 'READY') {
    return NextResponse.json(
      { error: 'Only podcasts with READY status can be forked' },
      { status: 400 }
    );
  }

  // Check if the source podcast's voices are paid and forker needs to pay
  const paymentIntentIds: string[] | undefined = body.paymentIntentIds;
  const skipPaidVoices = body.skipPaidVoices === true;
  let forkVoices = sourcePodcast.voices.map(v => ({ speaker: v.speaker, voiceId: v.voiceId }));
  const forkHostVoiceId = forkVoices.find(v => v.speaker === 'HOST')?.voiceId;
  const forkExpertVoiceId = forkVoices.find(v => v.speaker === 'EXPERT')?.voiceId;

  if (!skipPaidVoices && !paymentIntentIds && (forkHostVoiceId || forkExpertVoiceId)) {
    const voiceCharges = await computeVoiceCharges(
      userId,
      forkHostVoiceId ?? undefined,
      forkExpertVoiceId ?? undefined
    );

    if (voiceCharges.length > 0) {
      return NextResponse.json(
        {
          requiresPayment: true,
          voiceCharges,
          sourceTitle: sourcePodcast.title,
        },
        { status: 402 }
      );
    }
  }

  // If skipping paid voices, clear the voice IDs so the pool will be used instead
  if (skipPaidVoices) {
    forkVoices = forkVoices.map(v => ({ ...v, voiceId: null }));
  }

  // Verify provided payment intents
  if (paymentIntentIds) {
    for (const piId of paymentIntentIds) {
      const purchase = await prisma.voicePurchase.findUnique({
        where: { stripePaymentIntent: piId },
      });
      if (!purchase || purchase.status !== 'authorized' || purchase.buyerId !== userId) {
        return NextResponse.json({ error: 'Invalid or unauthorized payment' }, { status: 400 });
      }
    }
  }

  // Create fork podcast + discovery in a transaction
  const forkedPodcast = await prisma.$transaction(async (tx) => {
    const newPodcast = await tx.podcast.create({
      data: {
        userId,
        title: topic ? `${topic}` : `Fork of ${sourcePodcast.title}`,
        topic: topic || sourcePodcast.topic,
        remixNote: remixNote || null,
        status: 'PENDING',
        forkedFromId: podcastId,
        ttsProvider: freeTierTtsProvider ?? undefined,
        ttsModel: freeTierTtsModel ?? undefined,
        aiModel: freeTierAiModel ?? undefined,
      },
    });

    // Copy voice records to the forked podcast
    if (forkVoices.length > 0) {
      await tx.podcastVoice.createMany({
        data: forkVoices.map(v => ({
          podcastId: newPodcast.id,
          speaker: v.speaker,
          voiceId: v.voiceId,
        })),
      });
    }

    // Create synthetic Discovery so the pipeline works
    await tx.discovery.create({
      data: {
        podcastId: newPodcast.id,
        userId,
        topic: topic || sourcePodcast.topic,
        depth: depth || sourcePodcast.discovery?.depth || 'standard',
        audienceLevel: sourcePodcast.discovery?.audienceLevel || 'intermediate',
        audience: sourcePodcast.discovery?.audience || 'general',
        focusAreas: focusAreas || sourcePodcast.discovery?.focusAreas || [],
        tone: tone || sourcePodcast.discovery?.tone || 'casual',
        durationTarget: Math.min(
          sourcePodcast.discovery?.durationTarget || 10,
          gate.isByokUser ? LIMITS.maxDurationMinutes : FREE_TIER_MAX_DURATION_MINUTES
        ),
        sourceContent: sourcePodcast.script?.markdown || null,
      },
    });

    // Copy tags to the forked podcast
    if (sourcePodcast.tags.length > 0) {
      await tx.podcastTag.createMany({
        data: sourcePodcast.tags.map((pt) => ({
          podcastId: newPodcast.id,
          tagId: pt.tagId,
        })),
      });
    }

    // Increment source podcast fork count
    await tx.podcast.update({
      where: { id: podcastId },
      data: { forkCount: { increment: 1 } },
    });

    return newPodcast;
  });

  // Link VoicePurchase records to the forked podcast
  if (paymentIntentIds) {
    await prisma.voicePurchase.updateMany({
      where: { stripePaymentIntent: { in: paymentIntentIds } },
      data: { podcastId: forkedPodcast.id },
    });
  }

  // Set status to EXTRACTING and enqueue generation
  await prisma.podcast.update({
    where: { id: forkedPodcast.id },
    data: { status: 'EXTRACTING' },
  });

  const extractPayload: ExtractContentPayload = {
    podcastId: forkedPodcast.id,
    userId,
    sourceText: sourcePodcast.script?.markdown || undefined,
  };
  await addJob(contentExtractionQueue, JobType.EXTRACT_CONTENT, extractPayload);

  // Notify source podcast owner about the fork
  if (sourcePodcast.userId !== userId) {
    const forker = await prisma.user.findUnique({
      where: { id: userId },
      select: { name: true },
    });
    const forkerName = forker?.name || 'Someone';
    const notifPayload: SendNotificationPayload = {
      userId: sourcePodcast.userId,
      type: 'PODCAST_FORKED',
      title: 'Your podcast was forked!',
      message: `${forkerName} forked "${sourcePodcast.title}"`,
      data: {
        podcastId,
        forkId: forkedPodcast.id,
        forkerName,
      },
    };
    await addJob(notificationQueue, JobType.SEND_NOTIFICATION, notifPayload);
  }

  // Fire-and-forget activity record
  prisma.activity.create({
    data: {
      userId,
      type: 'PODCAST_FORKED',
      targetId: forkedPodcast.id,
      targetType: 'podcast',
      metadata: { parentTitle: sourcePodcast.title },
    },
  }).catch(() => {});

  // Fire-and-forget auto-tweet threshold check on the SOURCE podcast (after transaction committed)
  checkAutoTweetThreshold(podcastId).catch(() => {});

  return NextResponse.json({ id: forkedPodcast.id }, { status: 201 });
}
