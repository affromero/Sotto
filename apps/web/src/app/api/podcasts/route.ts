import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { authenticateRequest } from '@/lib/api-keys';
import { createPodcastSchema } from '@/lib/validations';
import { checkRateLimit } from '@/lib/redis';
import { contentExtractionQueue, addJob, JobType } from '@/lib/queue';
import { checkGenerationGate, tryIncrementFreeGeneration } from '@/lib/generation-gate';
import { getFreeTierConfig } from '@/lib/free-tier-config';
import { selectFreeTierProviders } from '@/lib/free-tier-provider-selector';
import { getTierFeatures, getJobPriority } from '@/lib/tier-features';
import { computeVoiceCharges } from '@/lib/voice-pricing';
import { checkSuspension } from '@/lib/auth-guards';
import type { ExtractContentPayload } from '@/lib/queue';

export async function GET(request: NextRequest) {
  const authResult = await authenticateRequest(request);
  if (!authResult) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
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
    const rateLimit = await checkRateLimit(`api:create:${authResult.userId}`, 60, 60);
    if (!rateLimit.allowed) {
      return NextResponse.json(
        { error: 'Rate limit exceeded', resetAt: rateLimit.resetAt },
        { status: 429 }
      );
    }
  }

  const body = await request.json();
  const parsed = createPodcastSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  // Rate limit: 20/hour, 100/day
  const hourly = await checkRateLimit(`generate:hour:${authResult.userId}`, 20, 3600);
  if (!hourly.allowed) {
    return NextResponse.json(
      { error: 'Rate limit exceeded: max 20 generations per hour.' },
      { status: 429 }
    );
  }
  const daily = await checkRateLimit(`generate:day:${authResult.userId}`, 100, 86400);
  if (!daily.allowed) {
    return NextResponse.json(
      { error: 'Rate limit exceeded: max 100 generations per day.' },
      { status: 429 }
    );
  }

  // Generation gate: BYOK, PRO, or free tier daily limit
  const gate = await checkGenerationGate(authResult.userId);
  if (!gate.allowed) {
    if (gate.reason === 'daily_limit_reached') {
      const resetH = gate.resetInSeconds ? Math.ceil(gate.resetInSeconds / 3600) : 24;
      return NextResponse.json(
        {
          error: `Daily podcast limit reached. Next podcast available in ~${resetH}h. Upgrade to Pro for unlimited generation.`,
          code: gate.reason,
          resetInSeconds: gate.resetInSeconds,
        },
        { status: 403 }
      );
    }
    const msg =
      gate.reason === 'free_tier_exhausted'
        ? 'Generation limit reached. Add your own API keys or upgrade to Pro.'
        : 'No voice provider available. Add a TTS key or upgrade to Pro.';
    return NextResponse.json({ error: msg, code: gate.reason }, { status: 403 });
  }

  // Get tier features for this user
  const tierFeatures = getTierFeatures(
    gate.isProUser ? 'PRO' : 'FREE',
    gate.isByokUser
  );

  // Gate private podcast creation
  if (parsed.data.isPrivate && !tierFeatures.privateAllowed) {
    return NextResponse.json(
      { error: 'Private podcasts require Pro or BYOK. Upgrade to Pro to create private content.' },
      { status: 403 }
    );
  }

  // Atomically increment daily free-tier counter BEFORE creating anything (avoids TOCTOU race)
  let freeTierTtsProvider: string | undefined;
  let freeTierTtsModel: string | undefined;
  let freeTierAiModel: string | undefined;
  if (!gate.isByokUser && !gate.isProUser) {
    const config = await getFreeTierConfig();
    const selected = await selectFreeTierProviders(authResult.userId);
    const ok = await tryIncrementFreeGeneration(authResult.userId, config.dailyGenerationLimit, {
      ai: { provider: selected.aiProvider, quota: selected.aiQuota },
      tts: { provider: selected.ttsProvider, quota: selected.ttsQuota },
    });
    if (!ok) {
      return NextResponse.json(
        { error: 'Daily podcast limit reached.', code: 'daily_limit_reached' },
        { status: 403 }
      );
    }
    freeTierTtsProvider = selected.ttsProvider;
    freeTierTtsModel = selected.ttsModel;
    freeTierAiModel = selected.aiModel;
  }

  // Duration validation — enforce tier cap
  const effectiveMaxDuration = isFinite(tierFeatures.maxDurationMinutes)
    ? tierFeatures.maxDurationMinutes
    : 9999;
  const durationTarget = parsed.data.metadata?.durationTarget;
  if (durationTarget && durationTarget > effectiveMaxDuration) {
    return NextResponse.json(
      {
        error: `Requested duration (${durationTarget} min) exceeds your plan limit of ${effectiveMaxDuration} min.`,
      },
      { status: 400 }
    );
  }

  // Check if selected voices require payment (skip if paymentIntentIds provided)
  const paymentIntentIds: string[] | undefined = body.paymentIntentIds;
  if (!paymentIntentIds) {
    const voiceCharges = await computeVoiceCharges(
      authResult.userId,
      parsed.data.hostVoiceId,
      parsed.data.expertVoiceId
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
        return NextResponse.json(
          { error: 'Invalid or unauthorized payment' },
          { status: 400 }
        );
      }
    }
  }

  const podcast = await prisma.podcast.create({
    data: {
      userId: authResult.userId,
      title: parsed.data.title,
      topic: parsed.data.topic,
      status: 'EXTRACTING',
      hostVoiceId: parsed.data.hostVoiceId,
      expertVoiceId: parsed.data.expertVoiceId,
      ttsProvider: parsed.data.ttsProvider ?? freeTierTtsProvider ?? null,
      ttsModel: parsed.data.ttsModel ?? freeTierTtsModel ?? null,
      aiModel: parsed.data.aiModel ?? freeTierAiModel ?? null,
      ...(isApiKeyAuth && { source: 'API' }),
    },
  });

  // Link existing VoicePurchase records to this podcast
  if (paymentIntentIds) {
    await prisma.voicePurchase.updateMany({
      where: { stripePaymentIntent: { in: paymentIntentIds } },
      data: { podcastId: podcast.id },
    });
  }

  // Create Discovery record from metadata
  if (parsed.data.metadata) {
    const meta = parsed.data.metadata;
    await prisma.discovery.create({
      data: {
        podcastId: podcast.id,
        userId: authResult.userId,
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
      },
    });
  } else {
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
