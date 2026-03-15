import { prisma } from '@/lib/prisma';
import { getLandingShowcaseConfig } from '@/lib/landing-showcase';
import { logger } from '@/lib/logger';
import { findByVoiceId } from '@/lib/voice-pool';
import type { ReferenceData } from '@/types/reference';

export interface ShowcasePodcast {
  podcastId: string;
  title: string;
  creatorName: string;
  audioUrl: string;
  duration: number | null;
}

export interface LandingShowcaseData {
  podcast: ShowcasePodcast;

  // JourneyChapter Step 1 — Discovery chat
  chatMessages: { role: 'user' | 'assistant'; content: string; chips?: string[] }[];

  // JourneyChapter Step 2 — Script excerpt with citations
  scriptTurns: { speaker: string; text: string }[];
  references: ReferenceData[];

  // JourneyChapter Step 3 — Audio clip
  audioClip: { url: string; start: number; end: number; totalDuration: number };
  originalTrackName: string;
  voiceTracks: { name: string; provider: string; model: string; audioUrl: string }[];
  voiceCount: number;
  sourceCount: number;

  // ShowcaseChapter — Video pipeline
  videoSegments: { order: number; label: string; type: string }[];
  videoClip: { url: string; start: number; end: number } | null;

  // BotChapter — Real links + overrides
  bot: {
    twitterHandle: string;
    twitterName: string;
    podcastTitle: string;
    podcastDuration: string;
    telegramTopic: string;
    podcastUrl: string;
  };
}

const VISUAL_TYPE_LABELS: Record<string, string> = {
  AI_ILLUSTRATION: 'AI Illustration',
  STOCK_FOOTAGE: 'Stock Footage',
  DATA_CHART: 'Data Chart',
  QUOTE: 'Quote',
  COMPARISON: 'Comparison',
  TIMELINE: 'Timeline',
  DIAGRAM: 'Diagram',
  TEXT_CARD: 'Text Card',
  MAP_OVERLAY: 'Map Overlay',
};

function formatDurationMinutes(seconds: number | null): string {
  if (!seconds) return '10 min';
  const minutes = Math.round(seconds / 60);
  return `${minutes} min`;
}

/**
 * Fetch a showcase podcast for the landing page EmbedPlayer.
 * Returns the most recently created public, ready podcast with verificationMode 'showcase'.
 */
export async function getShowcasePodcast(): Promise<ShowcasePodcast | null> {
  try {
    const podcast = await prisma.podcast.findFirst({
      where: {
        verificationMode: 'showcase',
        status: 'READY',
        visibility: 'PUBLIC',
      },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        title: true,
        audioUrl: true,
        duration: true,
        user: {
          select: {
            name: true,
            handle: true,
          },
        },
      },
    });

    if (!podcast?.audioUrl) return null;

    return {
      podcastId: podcast.id,
      title: podcast.title,
      creatorName: podcast.user.handle || podcast.user.name || 'Sotto',
      audioUrl: podcast.audioUrl,
      duration: podcast.duration,
    };
  } catch (err) {
    logger.warn('Failed to fetch showcase podcast', {
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

/**
 * Fetch full landing showcase data for all chapters.
 * Returns null if no LandingShowcase config exists — chapters fall back to hardcoded.
 */
export async function getLandingShowcaseData(): Promise<LandingShowcaseData | null> {
  try {
    const config = await getLandingShowcaseConfig();
    if (!config) return null;

    const podcast = await prisma.podcast.findUnique({
      where: { id: config.podcastId },
      select: {
        id: true,
        title: true,
        topic: true,
        audioUrl: true,
        duration: true,
        ttsProvider: true,
        user: { select: { name: true, handle: true } },
        discovery: {
          select: {
            messages: {
              where: { role: { in: ['user', 'assistant'] } },
              orderBy: { createdAt: 'asc' },
              take: 4,
              select: { role: true, content: true, chips: true },
            },
          },
        },
        script: {
          select: { turns: true },
        },
        references: {
          select: {
            id: true,
            number: true,
            title: true,
            authors: true,
            year: true,
            url: true,
            type: true,
            publisher: true,
            doi: true,
            verificationStatus: true,
            verificationDetails: true,
            contentDomain: true,
          },
        },
        segments: {
          select: { speaker: true, ttsVoiceId: true },
        },
        voices: {
          select: { speaker: true, voiceId: true },
        },
        voiceTracks: {
          where: { status: 'READY', audioUrl: { not: null } },
          orderBy: { createdAt: 'asc' },
          select: {
            name: true,
            ttsProvider: true,
            ttsModel: true,
            audioUrl: true,
          },
        },
        videoGenerations: {
          where: { voiceTrackId: null },
          take: 1,
          select: {
            videoUrl: true,
            visuals: {
              orderBy: { order: 'asc' },
              select: {
                order: true,
                prompt: true,
                visualType: true,
              },
            },
          },
        },
      },
    });

    if (!podcast?.audioUrl) return null;

    // Completeness guard: fall back to hardcoded if critical data is missing
    const discoveryMessages = podcast.discovery?.messages ?? [];
    const scriptTurnsRaw = (podcast.script?.turns ?? []) as Array<{ speaker: string; text: string }>;
    if (discoveryMessages.length === 0 || scriptTurnsRaw.length === 0) {
      logger.warn('Landing showcase podcast missing critical data', {
        podcastId: config.podcastId,
        hasDiscovery: discoveryMessages.length > 0,
        hasScript: scriptTurnsRaw.length > 0,
      });
      return null;
    }

    const showcasePodcast: ShowcasePodcast = {
      podcastId: podcast.id,
      title: podcast.title,
      creatorName: podcast.user.handle || podcast.user.name || 'Sotto',
      audioUrl: podcast.audioUrl,
      duration: podcast.duration,
    };

    // Chat messages — first 4 user/assistant messages
    const chatMessages = discoveryMessages.map((m) => {
      const chips = m.chips as Array<{ label: string; value: string }> | null;
      return {
        role: m.role as 'user' | 'assistant',
        content: m.content,
        ...(chips && { chips: chips.map((c) => c.label) }),
      };
    });

    // Script turns — slice by config range
    const scriptTurns = scriptTurnsRaw.slice(
      config.scriptTurnStart,
      config.scriptTurnStart + config.scriptTurnCount
    );

    // Collect referenced citation numbers from the selected turns
    const citedNumbers = new Set<number>();
    const citationRegex = /\[(\d+(?:\s*,\s*\d+)*)\]/g;
    for (const turn of scriptTurns) {
      let match;
      citationRegex.lastIndex = 0;
      while ((match = citationRegex.exec(turn.text)) !== null) {
        match[1].split(',').forEach((s) => citedNumbers.add(parseInt(s.trim(), 10)));
      }
    }
    const references = (podcast.references as ReferenceData[]).filter((r) =>
      citedNumbers.has(r.number)
    );

    // Audio clip
    const audioClipEnd = config.audioClipEnd ?? config.audioClipStart + 30;
    const audioClip = {
      url: podcast.audioUrl,
      start: config.audioClipStart,
      end: audioClipEnd,
      totalDuration: podcast.duration ?? 0,
    };

    // Voice tracks — alternative renditions of the same podcast
    const voiceTracks = podcast.voiceTracks
      .filter((vt): vt is typeof vt & { audioUrl: string } => !!vt.audioUrl)
      .map((vt) => ({
        name: vt.name,
        provider: vt.ttsProvider ?? 'Unknown',
        model: vt.ttsModel ?? 'default',
        audioUrl: vt.audioUrl,
      }));

    // Voice count — distinct speakers
    const speakers = [...new Set(podcast.segments.map((s) => s.speaker))];
    const voiceCount = speakers.length || 2;
    const sourceCount = podcast.references.length;

    // Original track label — "Original · VoiceName1 + VoiceName2 [Provider]"
    const providerLabel = podcast.ttsProvider
      ? podcast.ttsProvider.charAt(0).toUpperCase() + podcast.ttsProvider.slice(1)
      : 'Sotto';
    // Resolve voice names from PodcastVoice records (authoritative), then segment ttsVoiceId, then speakers
    const voiceNames: string[] = [];
    const seenVoiceIds = new Set<string>();
    for (const pv of podcast.voices) {
      if (pv.voiceId && !seenVoiceIds.has(pv.voiceId)) {
        seenVoiceIds.add(pv.voiceId);
        const entry = findByVoiceId(pv.voiceId);
        voiceNames.push(entry?.name ?? pv.voiceId);
      }
    }
    // Fallback to segment ttsVoiceId if no PodcastVoice records
    if (voiceNames.length === 0) {
      for (const seg of podcast.segments) {
        if (seg.ttsVoiceId && !seenVoiceIds.has(seg.ttsVoiceId)) {
          seenVoiceIds.add(seg.ttsVoiceId);
          const entry = findByVoiceId(seg.ttsVoiceId);
          if (entry) voiceNames.push(entry.name);
        }
      }
    }
    const displayNames = voiceNames.length > 0 ? voiceNames : speakers;
    const voiceSuffix = displayNames.length > 0
      ? `${displayNames.join(' + ')} [${providerLabel}]`
      : providerLabel;
    const originalTrackName = voiceSuffix;

    // Video segments — slice by config range
    const allVisuals = podcast.videoGenerations[0]?.visuals ?? [];
    const videoSegments = allVisuals
      .slice(config.videoSegmentStart, config.videoSegmentStart + config.videoSegmentCount)
      .map((v) => ({
        order: v.order,
        label: v.prompt ? v.prompt.split('.')[0] : `Segment ${v.order}`,
        type: VISUAL_TYPE_LABELS[v.visualType] ?? v.visualType,
      }));

    // Video clip
    const videoUrl = podcast.videoGenerations[0]?.videoUrl;
    const videoClipEnd = config.videoClipEnd ?? config.videoClipStart + 30;
    const videoClip = videoUrl
      ? { url: videoUrl, start: config.videoClipStart, end: videoClipEnd }
      : null;

    // Bot overrides
    const bot = {
      twitterHandle: config.twitterHandle,
      twitterName: config.twitterName,
      podcastTitle: podcast.title,
      podcastDuration: formatDurationMinutes(podcast.duration),
      telegramTopic: config.telegramTopic ?? podcast.topic ?? podcast.title,
      podcastUrl: `/podcast/${podcast.id}`,
    };

    return {
      podcast: showcasePodcast,
      chatMessages,
      scriptTurns,
      references,
      audioClip,
      originalTrackName,
      voiceTracks,
      voiceCount,
      sourceCount,
      videoSegments,
      videoClip,
      bot,
    };
  } catch (err) {
    logger.warn('Failed to fetch landing showcase data', {
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}
