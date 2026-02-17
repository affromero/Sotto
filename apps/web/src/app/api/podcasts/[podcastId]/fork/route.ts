import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { forkBodySchema } from '@/lib/validations';
import { contentExtractionQueue, notificationQueue, addJob, JobType } from '@/lib/queue';
import { checkGenerationGate, tryIncrementFreeGeneration } from '@/lib/generation-gate';
import { getFreeTierConfig } from '@/lib/free-tier-config';
import { computeVoiceCharges } from '@/lib/voice-pricing';
import { checkAutoTweetThreshold } from '@/lib/twitter-auto-tweet';
import { LIMITS, FREE_TIER_MAX_DURATION_MINUTES } from '@/lib/stripe';
import { checkSuspension } from '@/lib/auth-guards';
import type { ExtractContentPayload, SendNotificationPayload } from '@/lib/queue';

type RouteParams = { params: Promise<{ podcastId: string }> };

export async function POST(request: NextRequest, { params }: RouteParams) {
  const { podcastId } = await params;
  const session = await auth();

  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const suspended = checkSuspension(session);
  if (suspended) return suspended;

  const userId = session.user.id;

  // Generation gate: BYOK or free tier
  const gate = await checkGenerationGate(userId);
  if (!gate.allowed) {
    const msg =
      gate.reason === 'free_tier_exhausted'
        ? 'Free generations used. Add your own API keys to continue.'
        : 'No voice provider available. Add a TTS key in Settings for unlimited generation.';
    return NextResponse.json({ error: msg, code: gate.reason }, { status: 403 });
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
  let forkHostVoiceId = sourcePodcast.hostVoiceId;
  let forkExpertVoiceId = sourcePodcast.expertVoiceId;

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
    forkHostVoiceId = null;
    forkExpertVoiceId = null;
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
        hostVoiceId: forkHostVoiceId,
        expertVoiceId: forkExpertVoiceId,
      },
    });

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

  // Increment free tier counter for non-BYOK users
  if (!gate.isByokUser) {
    const config = await getFreeTierConfig();
    await tryIncrementFreeGeneration(userId, config.generationLimit);
  }

  // Notify source podcast owner about the fork
  if (sourcePodcast.userId !== userId) {
    const forkerName = session.user.name || 'Someone';
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
