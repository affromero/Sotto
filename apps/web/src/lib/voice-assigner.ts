/**
 * Deterministic multi-voice assignment for podcasts.
 */

import { prisma } from './prisma';
import {
  selectVoiceSet,
  resolveVoiceId,
  type VoiceMatchMetadata,
} from './voice-pool';
import {
  selectVoiceSetFromPool,
  CARTESIA_VOICE_POOL,
  HUME_VOICE_POOL,
  FAL_VOICE_POOL,
  MINIMAX_VOICE_POOL,
  MISTRAL_VOICE_POOL,
} from './providers/tts-voices';
import type { TtsProviderId } from './providers/tts-registry';
import { logger } from './logger';

interface SpeakerInput {
  name: string;
  description?: string;
}

/**
 * Assign distinct voices for each speaker in a podcast.
 *
 * For 2 or fewer speakers, or when all speakers already have PodcastVoice
 * entries, this is a no-op. Remaining speakers are assigned using stable
 * provider voice pools so self-hosted deployments do not need AI credentials
 * for voice casting.
 */
export async function assignVoicesForPodcast(
  podcastId: string,
  speakers: SpeakerInput[],
  providerId: TtsProviderId,
  metadata?: VoiceMatchMetadata,
): Promise<void> {
  if (speakers.length <= 1) return;

  // Check which speakers already have voice assignments
  const existing = await prisma.podcastVoice.findMany({
    where: { podcastId },
    select: { speaker: true },
  });
  const assignedSpeakers = new Set(existing.map((e) => e.speaker));

  const unassigned = speakers.filter((s) => !assignedSpeakers.has(s.name));
  if (unassigned.length === 0) return;

  await assignDeterministicVoices(podcastId, unassigned, providerId, metadata);
}

// ---------------------------------------------------------------------------
// Deterministic assignment
// ---------------------------------------------------------------------------

async function assignDeterministicVoices(
  podcastId: string,
  speakers: SpeakerInput[],
  providerId: TtsProviderId,
  metadata?: VoiceMatchMetadata,
): Promise<void> {
  const voiceIds = selectDeterministicVoiceIds(podcastId, speakers.length, providerId, metadata);
  if (voiceIds.length < speakers.length) {
    throw new Error(
      `Unable to assign ${speakers.length} voices for provider "${providerId}"; only ${voiceIds.length} voices are available.`
    );
  }

  const entries: Array<{ podcastId: string; speaker: string; voiceId: string; provider: string }> = [];
  for (let i = 0; i < speakers.length && i < voiceIds.length; i++) {
    entries.push({
      podcastId,
      speaker: speakers[i].name,
      voiceId: voiceIds[i],
      provider: providerId,
    });
  }

  if (entries.length > 0) {
    await prisma.podcastVoice.createMany({
      data: entries,
      skipDuplicates: true,
    });
  }

  logger.info('Deterministic voice assignment complete', {
    podcastId,
    provider: providerId,
    assigned: String(entries.length),
  });
}

function selectDeterministicVoiceIds(
  podcastId: string,
  speakerCount: number,
  providerId: TtsProviderId,
  metadata?: VoiceMatchMetadata,
): string[] {
  switch (providerId) {
    case 'elevenlabs': {
      const entries = selectVoiceSet(podcastId, speakerCount, metadata);
      return entries.map((e) => resolveVoiceId(e, 'elevenlabs'));
    }

    case 'openai': {
      const entries = selectVoiceSet(podcastId, speakerCount, metadata);
      return entries.map((e) => resolveVoiceId(e, 'openai'));
    }

    case 'cartesia': {
      const voices = selectVoiceSetFromPool(CARTESIA_VOICE_POOL, podcastId, speakerCount, metadata);
      return voices.map((v) => v.id);
    }

    case 'hume': {
      const voices = selectVoiceSetFromPool(HUME_VOICE_POOL, podcastId, speakerCount, metadata);
      return voices.map((v) => v.id);
    }

    case 'fal':
    case 'replicate': {
      const voices = selectVoiceSetFromPool(FAL_VOICE_POOL, podcastId, speakerCount, metadata);
      return voices.map((v) => v.id);
    }

    case 'minimax': {
      const voices = selectVoiceSetFromPool(MINIMAX_VOICE_POOL, podcastId, speakerCount, metadata);
      return voices.map((v) => v.id);
    }

    case 'mistral': {
      const voices = selectVoiceSetFromPool(MISTRAL_VOICE_POOL, podcastId, speakerCount, metadata);
      return voices.map((v) => v.id);
    }

    default:
      return unsupportedProvider(providerId);
  }
}

function unsupportedProvider(providerId: never): never {
  throw new Error(`Unsupported TTS provider for voice assignment: ${String(providerId)}`);
}
