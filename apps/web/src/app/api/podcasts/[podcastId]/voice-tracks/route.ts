import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { createVoiceTrackSchema } from '@/lib/validations';
import { voiceTrackAudioQueue, addJob, JobType } from '@/lib/queue';
import { resolveTtsProvider } from '@/lib/providers';
import { checkSuspension } from '@/lib/auth-guards';
import { getAutoModelConfig } from '@/lib/auto-model-config';
import { getProviderMeta, type TtsProviderId } from '@/lib/providers/tts-registry';
import { findVoiceName, formatModelName, type VoiceMatchMetadata } from '@/lib/voice-pool';
import type { GenerateVoiceTrackAudioPayload } from '@/lib/queue';

import { errorResponse } from '@/lib/api-response';
type RouteParams = { params: Promise<{ podcastId: string }> };

/**
 * Build a display name from resolved voice assignments.
 * Format: "Aria + River [ElevenLabs - Eleven v3]"
 * Groups voices by provider+model pair.
 */
function buildTrackName(
  voices: Array<{ speaker: string; voiceId: string; providerId: TtsProviderId; ttsModel?: string }>
): string {
  // Group by provider+model, preserving speaker order
  const byKey = new Map<string, string[]>();
  for (const v of voices) {
    const providerLabel = getProviderMeta(v.providerId).displayName;
    const key = v.ttsModel ? `${providerLabel} - ${formatModelName(v.ttsModel)}` : providerLabel;
    const voiceName = v.voiceId ? (findVoiceName(v.voiceId) ?? v.voiceId) : 'Auto';
    const existing = byKey.get(key) ?? [];
    existing.push(voiceName);
    byKey.set(key, existing);
  }

  return Array.from(byKey.entries())
    .map(([key, names]) => `${names.join(' + ')} [${key}]`)
    .join(' · ');
}

/**
 * Build a stable fingerprint from voice assignments for dedup.
 * Sorted by speaker to be order-independent.
 */
function buildVoiceFingerprint(
  voices: Array<{ speaker: string; voiceId: string; providerId: string }>
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
      segments: {
        orderBy: { order: 'asc' as const },
        select: { id: true, speaker: true, text: true, order: true },
      },
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

  // Parse body
  const body = await request.json().catch(() => ({}));
  const parsed = createVoiceTrackSchema.safeParse(body);
  if (!parsed.success) {
    return errorResponse(parsed.error.flatten(), 400);
  }

  const { ttsProvider, ttsModel, voices } = parsed.data;

  const resolvedVoices = voices;

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

  // Resolve TTS provider per speaker. Providerless voices use the request-level provider
  // or the platform-selected default provider.
  const autoConfig = await getAutoModelConfig();
  const selectedProviderId = autoConfig.model.ttsProvider as TtsProviderId | undefined;
  const defaultProviderId = (ttsProvider as TtsProviderId | undefined) ?? selectedProviderId;
  const defaultModel = ttsModel ?? (selectedProviderId === defaultProviderId ? autoConfig.model.ttsModel : undefined);
  const hasProviderlessVoice = resolvedVoices.some((v) => !v.provider);
  let defaultResolved: Awaited<ReturnType<typeof resolveTtsProvider>> | null = null;
  if (hasProviderlessVoice) {
    if (!defaultProviderId) {
      return errorResponse('Choose a TTS provider before creating a voice track.', 400, {
        code: 'tts_provider_required',
      });
    }
    defaultResolved = await resolveTtsProvider({
      userId,
      podcastId,
      requestedProvider: defaultProviderId,
      requestedModel: defaultModel,
    });
  }

  // Resolve per-voice provider: parse "elevenlabs:eleven_v3" → provider "elevenlabs", model "eleven_v3"
  // When no explicit model suffix, use the allocation/config model for that provider.
  const resolvedVoiceProviders = await Promise.all(
    resolvedVoices.map(async (v) => {
      if (v.provider) {
        const [providerKey, ...modelParts] = v.provider.split(':');
        const explicitModel = modelParts.join(':') || undefined;
        // Use explicit model, or the model from the same priority system as from-scratch
        const modelForProvider =
          explicitModel ??
          (selectedProviderId === providerKey ? autoConfig.model.ttsModel : undefined) ??
          (defaultProviderId === providerKey ? defaultModel : undefined);
        const resolved = await resolveTtsProvider({
          userId,
          podcastId,
          requestedProvider: providerKey as TtsProviderId,
          requestedModel: modelForProvider,
        });
        const voiceId =
          v.voiceId || resolved.provider.getVoiceId(v.speaker, podcastId, voiceMetadata);
        return {
          speaker: v.speaker,
          voiceId,
          providerId: resolved.providerId,
          ttsModel: resolved.provider.getModelId(),
        };
      }
      if (!defaultResolved) {
        throw new Error('Default TTS provider was not resolved for providerless voice');
      }
      const voiceId =
        v.voiceId || defaultResolved.provider.getVoiceId(v.speaker, podcastId, voiceMetadata);
      return {
        speaker: v.speaker,
        voiceId,
        providerId: defaultResolved.providerId,
        ttsModel: defaultResolved.provider.getModelId(),
      };
    })
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
        { status: 200 }
      );
    }
  }

  // Auto-generate track name from resolved voices
  const name = buildTrackName(resolvedVoiceProviders);

  // Determine track-level provider for display — use first voice's provider or "mixed" if they differ
  const uniqueProviders = [...new Set(resolvedVoiceProviders.map((v) => v.providerId))];
  const trackProvider = uniqueProviders.length === 1 ? uniqueProviders[0] : 'mixed';

  const uniqueModels = [...new Set(resolvedVoiceProviders.map((v) => v.ttsModel).filter(Boolean))];
  const trackModel = uniqueModels.length === 1 ? uniqueModels[0] : null;

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
      data: resolvedVoiceProviders.map((v) => ({
        voiceTrackId: track.id,
        speaker: v.speaker,
        voiceId: v.voiceId,
        provider: v.providerId,
        ttsModel: v.ttsModel || null,
      })),
    });

    // Create voice track segments for each podcast segment
    await tx.voiceTrackSegment.createMany({
      data: podcast.segments.map((seg) => ({
        voiceTrackId: track.id,
        segmentId: seg.id,
        order: seg.order,
      })),
    });

    return track;
  });

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
  const scriptTurns = (script?.turns ?? []) as Array<{
    speaker: string;
    text: string;
    direction?: string;
  }>;
  const orderedSegments = podcast.segments;

  for (const vtSeg of vtSegments) {
    const segIndex = orderedSegments.findIndex((s) => s.id === vtSeg.segmentId);
    if (segIndex === -1) continue;
    const podcastSeg = orderedSegments[segIndex];

    const previousText = segIndex > 0 ? orderedSegments[segIndex - 1].text.slice(-500) : undefined;
    const nextText =
      segIndex < orderedSegments.length - 1
        ? orderedSegments[segIndex + 1].text.slice(0, 500)
        : undefined;
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

  const session = await auth();
  const userId = session?.user?.id;

  if (!userId) {
    return errorResponse('Unauthorized', 401);
  }

  const podcast = await prisma.podcast.findUnique({
    where: { id: podcastId },
    select: { userId: true },
  });

  if (!podcast) {
    return errorResponse('Podcast not found', 404);
  }

  if (podcast.userId !== userId) {
    return errorResponse('Forbidden', 403);
  }

  const tracks = await prisma.voiceTrack.findMany({
    where: {
      podcastId,
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
      failureReason: true,
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

  // Enrich voices with resolved names so the UI doesn't show raw UUIDs
  const enriched = tracks.map((t) => ({
    ...t,
    voices: t.voices.map((v) => ({
      ...v,
      voiceName: findVoiceName(v.voiceId) ?? null,
    })),
  }));

  return NextResponse.json(enriched);
}
