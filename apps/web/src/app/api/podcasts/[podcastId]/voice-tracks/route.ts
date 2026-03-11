import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { createVoiceTrackSchema } from '@/lib/validations';
import { voiceTrackAudioQueue, addJob, JobType } from '@/lib/queue';
import { getTierFeatures } from '@/lib/tier-features';
import { getPlanFeatureConfig } from '@/lib/plan-feature-config';
import { checkGenerationGate } from '@/lib/generation-gate';
import { computeVoiceCharges } from '@/lib/voice-pricing';
import { resolveTtsProvider } from '@/lib/providers';
import { selectFreeTierProviders } from '@/lib/free-tier-provider-selector';
import { resolveAutoModel } from '@/lib/auto-model-config';
import { checkRateLimit } from '@/lib/redis';
import { checkSuspension } from '@/lib/auth-guards';
import { getProviderMeta, type TtsProviderId } from '@/lib/providers/tts-registry';
import { findByVoiceId, type VoiceMatchMetadata } from '@/lib/voice-pool';
import type { GenerateVoiceTrackAudioPayload } from '@/lib/queue';

import { errorResponse } from '@/lib/api-response';
type RouteParams = { params: Promise<{ podcastId: string }> };

/**
 * Build a display name from resolved voice assignments.
 * Format: "Aria [ElevenLabs] · Nova [OpenAI]"
 * Groups voices by provider: "Aria + River [ElevenLabs] · Nova [OpenAI]"
 */
function buildTrackName(
  voices: Array<{ speaker: string; voiceId: string; providerId: TtsProviderId }>,
): string {
  // Group by provider, preserving speaker order
  const byProvider = new Map<string, string[]>();
  for (const v of voices) {
    const providerLabel = getProviderMeta(v.providerId).displayName;
    const voiceName = v.voiceId
      ? (findByVoiceId(v.voiceId)?.name ?? v.voiceId)
      : 'Auto';
    const existing = byProvider.get(providerLabel) ?? [];
    existing.push(voiceName);
    byProvider.set(providerLabel, existing);
  }

  return Array.from(byProvider.entries())
    .map(([provider, names]) => `${names.join(' + ')} [${provider}]`)
    .join(' · ');
}

/**
 * Build a stable fingerprint from voice assignments for dedup.
 * Sorted by speaker to be order-independent.
 */
function buildVoiceFingerprint(
  voices: Array<{ speaker: string; voiceId: string; providerId: string }>,
): string {
  return voices
    .map((v) => `${v.speaker}:${v.providerId}:${v.voiceId || 'auto'}`)
    .sort()
    .join('|');
}

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
  const [gate, voiceConfig] = await Promise.all([
    checkGenerationGate(userId),
    getPlanFeatureConfig(),
  ]);
  const features = getTierFeatures(gate.isProUser ? 'PRO' : 'FREE', gate.isByokUser, session.user.role, voiceConfig);

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
    const msg = gate.reason === 'generation_in_progress'
      ? 'A podcast is already generating. Wait for it to finish before starting another.'
      : 'No voice provider available. Add a TTS key in Settings for unlimited generation.';
    return errorResponse(msg, 403, { code: gate.reason });
  }

  // Parse body
  const body = await request.json().catch(() => ({}));
  const parsed = createVoiceTrackSchema.safeParse(body);
  if (!parsed.success) {
    return errorResponse(parsed.error.flatten(), 400);
  }

  const { ttsProvider, ttsModel, voices, paymentIntentIds, skipPaidVoices } = parsed.data;

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

  // Fetch discovery metadata for topic-aware voice selection (same as worker + audio-generation)
  const discovery = await prisma.discovery.findUnique({
    where: { podcastId },
    select: { tone: true, audienceLevel: true, audience: true },
  });
  const voiceMetadata: VoiceMatchMetadata | undefined = discovery
    ? {
        tone: discovery.tone as VoiceMatchMetadata['tone'],
        audienceLevel: discovery.audienceLevel as VoiceMatchMetadata['audienceLevel'],
        audience: discovery.audience as VoiceMatchMetadata['audience'],
      }
    : undefined;

  // Resolve TTS provider per speaker — same priority system as from-scratch generation.
  // Use selectFreeTierProviders() for free users (allocation-based) or resolveAutoModel() for PRO
  // to get the correct provider+model pair, avoiding default model fallbacks that BYOK keys may lack.
  const plan = gate.isProUser ? 'PRO' : 'FREE';
  const selected = gate.isByokUser
    ? null
    : await selectFreeTierProviders(userId);
  const autoModel = selected
    ? null
    : await resolveAutoModel(plan);

  const fallback = await resolveTtsProvider({
    userId,
    podcastId,
    requestedProvider: (ttsProvider as TtsProviderId | null) ?? undefined,
    requestedModel: ttsModel ?? selected?.ttsModel ?? autoModel?.ttsModel,
    plan,
  });

  // Resolve per-voice provider: parse "elevenlabs:eleven_v3" → provider "elevenlabs", model "eleven_v3"
  // When no explicit model suffix, use the allocation/config model for that provider.
  const resolvedVoiceProviders = await Promise.all(
    resolvedVoices.map(async (v) => {
      if (v.provider) {
        const [providerKey, ...modelParts] = v.provider.split(':');
        const explicitModel = modelParts.join(':') || undefined;
        // Use explicit model, or the model from the same priority system as from-scratch
        const modelForProvider = explicitModel
          ?? (selected?.ttsProvider === providerKey ? selected.ttsModel : undefined)
          ?? (autoModel?.ttsProvider === providerKey ? autoModel.ttsModel : undefined);
        const resolved = await resolveTtsProvider({
          userId,
          podcastId,
          requestedProvider: providerKey as TtsProviderId,
          requestedModel: modelForProvider,
          plan,
        });
        const voiceId = v.voiceId || resolved.provider.getVoiceId(v.speaker, podcastId, voiceMetadata);
        return { speaker: v.speaker, voiceId, providerId: resolved.providerId, ttsModel: resolved.provider.getModelId() };
      }
      const voiceId = v.voiceId || fallback.provider.getVoiceId(v.speaker, podcastId, voiceMetadata);
      return { speaker: v.speaker, voiceId, providerId: fallback.providerId, ttsModel: fallback.provider.getModelId() };
    }),
  );

  // Dedup: check if a voice track with the exact same voice combination already exists
  const fingerprint = buildVoiceFingerprint(resolvedVoiceProviders);
  const existingTracks = await prisma.voiceTrack.findMany({
    where: { podcastId },
    select: {
      id: true,
      status: true,
      audioUrl: true,
      voices: { select: { speaker: true, voiceId: true, provider: true } },
    },
  });

  for (const existing of existingTracks) {
    const existingFingerprint = existing.voices
      .map((v) => `${v.speaker}:${v.provider || 'auto'}:${v.voiceId || 'auto'}`)
      .sort()
      .join('|');
    if (existingFingerprint === fingerprint) {
      return NextResponse.json(
        { id: existing.id, status: existing.status, duplicate: true },
        { status: 200 },
      );
    }
  }

  // Auto-generate track name from resolved voices
  const name = buildTrackName(resolvedVoiceProviders);

  // Determine track-level provider for display — use first voice's provider or "mixed" if they differ
  const uniqueProviders = [...new Set(resolvedVoiceProviders.map(v => v.providerId))];
  const trackProvider = uniqueProviders.length === 1 ? uniqueProviders[0] : 'mixed';

  // Derive track-level model — match from-scratch pattern:
  // BYOK users: null (worker resolves dynamically with BYOK→platform fallback)
  // Free/Pro: use configured auto-model (same as selectFreeTierProviders)
  const trackModel = gate.isByokUser
    ? (ttsModel || null)
    : (ttsModel || selected?.ttsModel || autoModel?.ttsModel || null);

  // Create voice track, voice assignments, and segments in a transaction
  const voiceTrack = await prisma.$transaction(async (tx) => {
    const track = await tx.voiceTrack.create({
      data: {
        podcastId,
        name,
        status: 'GENERATING_AUDIO',
        ttsProvider: trackProvider,
        ttsModel: trackModel,
      },
    });

    // Create voice assignments with per-speaker provider + model
    await tx.voiceTrackVoice.createMany({
      data: resolvedVoiceProviders.map(v => ({
        voiceTrackId: track.id,
        speaker: v.speaker,
        voiceId: v.voiceId,
        provider: v.providerId,
        ttsModel: v.ttsModel || null,
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

  // Fetch script turns for delivery directions (same pattern as segment-creator.ts)
  const script = await prisma.script.findUnique({
    where: { podcastId },
    select: { turns: true },
  });
  const scriptTurns = (script?.turns ?? []) as Array<{ speaker: string; text: string; direction?: string }>;
  const orderedSegments = podcast.segments;

  for (const vtSeg of vtSegments) {
    const segIndex = orderedSegments.findIndex(s => s.id === vtSeg.segmentId);
    if (segIndex === -1) continue;
    const podcastSeg = orderedSegments[segIndex];

    const previousText = segIndex > 0 ? orderedSegments[segIndex - 1].text.slice(-500) : undefined;
    const nextText = segIndex < orderedSegments.length - 1 ? orderedSegments[segIndex + 1].text.slice(0, 500) : undefined;
    const direction = scriptTurns[podcastSeg.order]?.direction;

    const payload: GenerateVoiceTrackAudioPayload = {
      podcastId,
      voiceTrackId: voiceTrack.id,
      voiceTrackSegmentId: vtSeg.id,
      segmentId: vtSeg.segmentId,
      speaker: podcastSeg.speaker,
      text: podcastSeg.text,
      previousText,
      nextText,
      direction,
    };
    await addJob(voiceTrackAudioQueue, JobType.GENERATE_VOICE_TRACK_AUDIO, payload);
  }

  return NextResponse.json({ id: voiceTrack.id, status: voiceTrack.status, name }, { status: 201 });
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
      ...(isOwner
        ? {}
        : {
            status: 'READY',
            OR: [
              { proposalStatus: null },
              { proposalStatus: 'ACCEPTED' },
            ],
          }),
    },
    orderBy: { createdAt: 'asc' },
    select: {
      id: true,
      name: true,
      status: true,
      audioUrl: true,
      duration: true,
      ttsProvider: true,
      ttsModel: true,
      failureReason: isOwner ? true : false,
      voices: { select: { speaker: true, voiceId: true, provider: true } },
      proposalStatus: true,
      proposalMessage: true,
      contributor: {
        select: {
          id: true,
          name: true,
          handle: true,
          image: true,
        },
      },
    },
  });

  return NextResponse.json(tracks);
}
