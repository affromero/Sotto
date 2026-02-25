import { NextRequest, NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { authenticateRequest } from '@/lib/api-keys';
import { createPodcastSchema } from '@/lib/validations';
import { checkRateLimit } from '@/lib/redis';
import { contentExtractionQueue, addJob, JobType } from '@/lib/queue';
import { checkGenerationGate, tryIncrementFreeGeneration } from '@/lib/generation-gate';
import { selectFreeTierProviders } from '@/lib/free-tier-provider-selector';
import { getTierFeatures, getJobPriority } from '@/lib/tier-features';
import { computeVoiceCharges } from '@/lib/voice-pricing';
import { checkSuspension, requireAdmin } from '@/lib/auth-guards';
import type { ExtractContentPayload } from '@/lib/queue';

import { errorResponse } from '@/lib/api-response';
export async function GET(request: NextRequest) {
  const authResult = await authenticateRequest(request);
  if (!authResult) {
    return errorResponse('Unauthorized', 401);
  }

  const podcasts = await prisma.podcast.findMany({
    where: { userId: authResult.userId },
    orderBy: { createdAt: 'desc' },
    include: {
      tags: { include: { tag: true } },
    },
  });

  return NextResponse.json(podcasts);
}

export async function POST(request: NextRequest) {
  const authResult = await authenticateRequest(request);
  if (!authResult) {
    return errorResponse('Unauthorized', 401);
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
    const rateLimit = await checkRateLimit(`api:create:${authResult.userId}`, 60, 60);
    if (!rateLimit.allowed) {
      return errorResponse('Rate limit exceeded', 429, { resetAt: rateLimit.resetAt });
    }
  }

  const body = await request.json();
  const draftId = typeof body.draftId === 'string' ? body.draftId : undefined;
  const parsed = createPodcastSchema.safeParse(body);
  if (!parsed.success) {
    return errorResponse(parsed.error.flatten(), 400);
  }

  // Validate draft ownership if resuming from a draft
  if (draftId) {
    const draft = await prisma.podcast.findUnique({
      where: { id: draftId },
      select: { userId: true, status: true },
    });
    if (!draft || draft.userId !== authResult.userId || draft.status !== 'DRAFT') {
      return errorResponse('Invalid draft', 400);
    }
  }

  // Block non-admins from using claude-code models
  if (parsed.data.aiModel?.startsWith('claude-code:')) {
    const { auth } = await import('@/lib/auth');
    const sess = await auth();
    if (sess?.user?.role !== 'ADMIN') {
      return errorResponse('Forbidden', 403);
    }
  }

  // Admin bypass: skip rate limits
  const adminId = await requireAdmin();
  const isAdmin = adminId !== null;

  // Rate limit: 20/hour, 100/day (skip for admins)
  if (!isAdmin) {
    const hourly = await checkRateLimit(`generate:hour:${authResult.userId}`, 20, 3600);
    if (!hourly.allowed) {
      return errorResponse('Rate limit exceeded: max 20 generations per hour.', 429);
    }
    const daily = await checkRateLimit(`generate:day:${authResult.userId}`, 100, 86400);
    if (!daily.allowed) {
      return errorResponse('Rate limit exceeded: max 100 generations per day.', 429);
    }
  }

  // Generation gate: BYOK, PRO, or free tier daily limit
  const gate = await checkGenerationGate(authResult.userId);
  if (!gate.allowed) {
    if (gate.reason === 'daily_limit_reached') {
      const resetH = gate.resetInSeconds ? Math.ceil(gate.resetInSeconds / 3600) : 24;
      return errorResponse(`Daily podcast limit reached. Next podcast available in ~${resetH}h. Upgrade to Pro for unlimited generation.`, 403, { code: gate.reason,
          resetInSeconds: gate.resetInSeconds, });
    }
    const msg =
      gate.reason === 'free_tier_exhausted'
        ? 'Generation limit reached. Add your own API keys or upgrade to Pro.'
        : 'No voice provider available. Add a TTS key or upgrade to Pro.';
    return errorResponse(msg, 403, { code: gate.reason });
  }

  // Get tier features for this user
  const tierFeatures = getTierFeatures(
    gate.isProUser ? 'PRO' : 'FREE',
    gate.isByokUser
  );

  // Gate private and unlisted podcast creation
  if ((parsed.data.visibility === 'PRIVATE' || parsed.data.visibility === 'UNLISTED') && !tierFeatures.privateAllowed) {
    return errorResponse('Private and unlisted podcasts require a Pro subscription.', 403);
  }

  // Speaker count validation — enforce tier cap
  const requestedSpeakers = parsed.data.metadata?.speakers;
  if (requestedSpeakers && requestedSpeakers.length > tierFeatures.maxSpeakers) {
    return errorResponse(`Speaker count (${requestedSpeakers.length}) exceeds your plan limit of ${tierFeatures.maxSpeakers}.`, 403);
  }

  // Duration validation — enforce tier cap (before incrementing counter)
  const effectiveMaxDuration = isFinite(tierFeatures.maxDurationMinutes)
    ? tierFeatures.maxDurationMinutes
    : 9999;
  const durationTarget = parsed.data.metadata?.durationTarget;
  if (durationTarget && durationTarget > effectiveMaxDuration) {
    return errorResponse(`Requested duration (${durationTarget} min) exceeds your plan limit of ${effectiveMaxDuration} min.`, 400, {  });
  }

  // Atomically increment daily free-tier counter BEFORE creating anything (avoids TOCTOU race)
  let freeTierTtsProvider: string | undefined;
  let freeTierTtsModel: string | undefined;
  let freeTierAiModel: string | undefined;
  if (!gate.isByokUser && !gate.isProUser) {
    const selected = await selectFreeTierProviders(authResult.userId);
    const ok = await tryIncrementFreeGeneration(authResult.userId, gate.dailyLimit, {
      ai: { provider: selected.aiProvider, quota: selected.aiQuota },
      tts: { provider: selected.ttsProvider, quota: selected.ttsQuota },
    });
    if (!ok) {
      return errorResponse('Daily podcast limit reached.', 403, { code: 'daily_limit_reached' });
    }
    freeTierTtsProvider = selected.ttsProvider;
    freeTierTtsModel = selected.ttsModel;
    freeTierAiModel = selected.aiModel;
  }

  // Check if selected voices require payment (skip if paymentIntentIds provided)
  const paymentIntentIds: string[] | undefined = body.paymentIntentIds;
  const voiceEntries = parsed.data.voices ?? [];
  const voicesWithIds = voiceEntries.filter(
    (v): v is { speaker: string; voiceId: string } => !!v.voiceId
  );
  if (!paymentIntentIds) {
    const voiceCharges = await computeVoiceCharges(
      authResult.userId,
      voicesWithIds
    );

    if (voiceCharges.length > 0) {
      return NextResponse.json(
        {
          requiresPayment: true,
          voiceCharges,
        },
        { status: 402 }
      );
    }
  } else {
    // Verify all provided PaymentIntents are authorized
    for (const piId of paymentIntentIds) {
      const purchase = await prisma.voicePurchase.findUnique({
        where: { stripePaymentIntent: piId },
      });
      if (!purchase || purchase.status !== 'authorized' || purchase.buyerId !== authResult.userId) {
        return errorResponse('Invalid or unauthorized payment', 400);
      }
    }
  }

  const podcastData = {
    title: parsed.data.title,
    topic: parsed.data.topic,
    status: 'EXTRACTING' as const,
    ttsProvider: parsed.data.ttsProvider ?? freeTierTtsProvider ?? null,
    ttsModel: parsed.data.ttsModel ?? freeTierTtsModel ?? null,
    aiModel: parsed.data.aiModel ?? freeTierAiModel ?? null,
    ...(isApiKeyAuth && { source: 'API' as const }),
  };

  const podcast = draftId
    ? await prisma.podcast.update({
        where: { id: draftId },
        data: { ...podcastData, draftData: Prisma.DbNull },
      })
    : await prisma.podcast.create({
        data: { ...podcastData, userId: authResult.userId },
      });

  // Create PodcastVoice records from the voices array
  if (voiceEntries.length > 0) {
    await prisma.podcastVoice.createMany({
      data: voiceEntries.map(v => ({
        podcastId: podcast.id,
        speaker: v.speaker,
        voiceId: v.voiceId ?? null,
      })),
    });
  }

  // Link existing VoicePurchase records to this podcast
  if (paymentIntentIds) {
    await prisma.voicePurchase.updateMany({
      where: { stripePaymentIntent: { in: paymentIntentIds } },
      data: { podcastId: podcast.id },
    });
  }

  // Create or update Discovery record from metadata
  if (parsed.data.metadata) {
    const meta = parsed.data.metadata;
    const discoveryData = {
      topic: meta.topic,
      depth: meta.depth,
      audienceLevel: meta.audienceLevel,
      audience: meta.audience,
      focusAreas: meta.focusAreas ?? [],
      tone: meta.tone,
      durationTarget: meta.durationTarget
        ? Math.min(meta.durationTarget, effectiveMaxDuration)
        : undefined,
      sourceUrl: meta.sourceUrl,
      sourceContent: meta.sourceContent,
      speakers: meta.speakers ?? undefined,
    };

    if (draftId) {
      // Draft already has a Discovery record — update it
      await prisma.discovery.updateMany({
        where: { podcastId: podcast.id },
        data: discoveryData,
      });
    } else {
      await prisma.discovery.create({
        data: {
          ...discoveryData,
          podcastId: podcast.id,
          userId: authResult.userId,
        },
      });
    }
  } else if (!draftId) {
    // Create a minimal Discovery record so the pipeline can find it
    await prisma.discovery.create({
      data: {
        podcastId: podcast.id,
        userId: authResult.userId,
        topic: parsed.data.topic,
      },
    });
  }

  // Queue content extraction job to kick off the pipeline
  const sourceUrl = parsed.data.metadata?.sourceUrl;
  const sourceText = parsed.data.metadata?.sourceContent;
  const payload: ExtractContentPayload = {
    podcastId: podcast.id,
    userId: authResult.userId,
    sourceUrl: sourceUrl ?? undefined,
    sourceText: sourceText ?? undefined,
  };
  const jobPriority = getJobPriority(gate.isProUser ? 'PRO' : 'FREE', gate.isByokUser);
  await addJob(contentExtractionQueue, JobType.EXTRACT_CONTENT, payload, { priority: jobPriority });

  // Fire-and-forget activity record
  prisma.activity.create({
    data: {
      userId: authResult.userId,
      type: 'PODCAST_CREATED',
      targetId: podcast.id,
      targetType: 'podcast',
    },
  }).catch(() => {});

  return NextResponse.json({ id: podcast.id, status: podcast.status }, { status: 201 });
}
