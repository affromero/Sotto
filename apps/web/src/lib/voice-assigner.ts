/**
 * LLM-based multi-voice assignment for podcasts with 3+ speakers.
 *
 * Uses an LLM (via platform config) to intelligently match speakers to voices
 * from the provider's voice catalog. Falls back to deterministic hash-based
 * selection on failure.
 */

import { prisma } from './prisma';
import { getVoiceCatalog, type CatalogVoice } from './voice-catalog';
import { generateResponse } from './llm';
import { loadAndRender } from './prompt-loader';
import { logUsage } from './usage-logger';
import { resolveAutoModel } from './auto-model-config';
import {
  selectVoiceSet,
  resolveVoiceId,
  selectKittenVoiceSet,
  type VoiceMatchMetadata,
} from './voice-pool';
import {
  selectVoiceSetFromPool,
  CARTESIA_VOICE_POOL,
  HUME_VOICE_POOL,
  FAL_VOICE_POOL,
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
 * entries, this is a no-op. For 3+ speakers, uses an LLM to cast voices
 * from the provider's catalog. Falls back to hash-based selection on failure.
 */
export async function assignVoicesForPodcast(
  podcastId: string,
  speakers: SpeakerInput[],
  providerId: TtsProviderId,
  apiKey?: string,
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

  // For KittenTTS, skip LLM — use deterministic hash selection directly
  if (providerId === 'kittentts') {
    await fallbackAssign(podcastId, unassigned, providerId, metadata);
    return;
  }

  // For 2 speakers, the existing pair selection is sufficient — skip LLM
  if (speakers.length <= 2) {
    await fallbackAssign(podcastId, unassigned, providerId, metadata);
    return;
  }

  try {
    const catalog = await getVoiceCatalog(providerId, apiKey);
    if (catalog.length === 0) {
      await fallbackAssign(podcastId, unassigned, providerId, metadata);
      return;
    }

    const mapping = await llmAssignVoices(podcastId, unassigned, catalog);
    if (!mapping) {
      await fallbackAssign(podcastId, unassigned, providerId, metadata);
      return;
    }

    // Validate all mapped voice IDs exist in catalog
    const catalogIds = new Set(catalog.map((v) => v.id));
    const validEntries: Array<{ speaker: string; voiceId: string }> = [];

    for (const [speaker, voiceId] of Object.entries(mapping)) {
      if (catalogIds.has(voiceId) && unassigned.some((s) => s.name === speaker)) {
        validEntries.push({ speaker, voiceId });
      }
    }

    // Ensure no duplicate voice IDs
    const usedVoices = new Set<string>();
    const deduped: Array<{ speaker: string; voiceId: string }> = [];
    for (const entry of validEntries) {
      if (!usedVoices.has(entry.voiceId)) {
        deduped.push(entry);
        usedVoices.add(entry.voiceId);
      }
    }

    if (deduped.length === 0) {
      await fallbackAssign(podcastId, unassigned, providerId, metadata);
      return;
    }

    // Store in PodcastVoice
    await prisma.podcastVoice.createMany({
      data: deduped.map((e) => ({
        podcastId,
        speaker: e.speaker,
        voiceId: e.voiceId,
        provider: providerId,
      })),
      skipDuplicates: true,
    });

    // If some speakers weren't mapped by LLM, fall back for those
    const mappedSpeakers = new Set(deduped.map((e) => e.speaker));
    const stillUnassigned = unassigned.filter((s) => !mappedSpeakers.has(s.name));
    if (stillUnassigned.length > 0) {
      await fallbackAssign(podcastId, stillUnassigned, providerId, metadata);
    }

    logger.info('LLM voice assignment complete', {
      podcastId,
      provider: providerId,
      assigned: String(deduped.length),
      fallback: String(stillUnassigned.length),
    });
  } catch (err) {
    logger.warn('LLM voice assignment failed, using fallback', {
      podcastId,
      error: err instanceof Error ? err.message : String(err),
    });
    await fallbackAssign(podcastId, unassigned, providerId, metadata);
  }
}

// ---------------------------------------------------------------------------
// LLM casting
// ---------------------------------------------------------------------------

async function llmAssignVoices(
  podcastId: string,
  speakers: SpeakerInput[],
  catalog: CatalogVoice[],
): Promise<Record<string, string> | null> {
  const voiceCatalogText = catalog
    .map((v) => {
      const parts = [`- ID: ${v.id}, Name: ${v.name}`];
      if (v.gender) parts.push(`Gender: ${v.gender}`);
      if (v.age) parts.push(`Age: ${v.age}`);
      if (v.accent) parts.push(`Accent: ${v.accent}`);
      if (v.description) parts.push(`Style: ${v.description}`);
      return parts.join(', ');
    })
    .join('\n');

  const speakersText = speakers
    .map((s) => {
      if (s.description) return `- ${s.name}: ${s.description}`;
      return `- ${s.name}`;
    })
    .join('\n');

  const prompt = loadAndRender('audio/voice-assigner.md', {
    VOICE_CATALOG: voiceCatalogText,
    SPEAKER_COUNT: String(speakers.length),
    SPEAKERS: speakersText,
  });

  const autoConfig = await resolveAutoModel('PLATFORM');

  const response = await generateResponse(
    prompt,
    [{ role: 'user', content: 'Assign voices now.' }],
    {
      maxTokens: 512,
      model: autoConfig.aiModel,
      skipModeration: true,
    },
  );

  await logUsage({
    service: 'anthropic',
    model: response.model,
    category: 'voice_assignment',
    inputTokens: response.inputTokens,
    outputTokens: response.outputTokens,
    podcastId,
  });

  // Parse JSON from response — strip markdown fences if present
  let content = response.content.trim();
  const fenceMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) {
    content = fenceMatch[1].trim();
  }

  try {
    const parsed = JSON.parse(content);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return null;
    }
    return parsed as Record<string, string>;
  } catch {
    logger.warn('Failed to parse LLM voice assignment response', {
      podcastId,
      content: content.substring(0, 200),
    });
    return null;
  }
}

// ---------------------------------------------------------------------------
// Fallback — deterministic hash-based assignment
// ---------------------------------------------------------------------------

async function fallbackAssign(
  podcastId: string,
  speakers: SpeakerInput[],
  providerId: TtsProviderId,
  metadata?: VoiceMatchMetadata,
): Promise<void> {
  const voiceIds = getFallbackVoiceIds(podcastId, speakers.length, providerId, metadata);

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

  logger.info('Fallback voice assignment complete', {
    podcastId,
    provider: providerId,
    assigned: String(entries.length),
  });
}

function getFallbackVoiceIds(
  podcastId: string,
  speakerCount: number,
  providerId: TtsProviderId,
  metadata?: VoiceMatchMetadata,
): string[] {
  switch (providerId) {
    case 'kittentts':
      return selectKittenVoiceSet(podcastId, speakerCount);

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

    default: {
      const entries = selectVoiceSet(podcastId, speakerCount, metadata);
      return entries.map((e) => resolveVoiceId(e, 'elevenlabs'));
    }
  }
}
