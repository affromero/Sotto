import { prisma } from '@/lib/prisma';
import { getLandingShowcaseConfig } from '@/lib/landing-showcase';
import type { LandingShowcaseConfig } from '@/lib/landing-showcase';
import { logger } from '@/lib/logger';
import type { ReferenceData } from '@/types/reference';
import type { VocabularyEntryData } from '@/types/vocabulary';

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
  voiceCount: number;
  sourceCount: number;

  // Feature toggles — whether landing page shows interactive toggles
  showAvatar: boolean;
  showVideo: boolean;
  hasAvatars: boolean;

  // ShowcaseChapter — Video pipeline
  videoSegments: { order: number; label: string; type: string }[];
  videoClip: { url: string; start: number; end: number } | null;

  // Clip-range segments + visuals for client-side Remotion Player
  clipSegments: { id: string; order: number; speaker: string; text: string; startTime: number; duration: number; wordTimings?: Array<{ word: string; start: number; end: number }> | null }[];
  clipVisuals: { id: string; segmentId: string; order: number; subOrder: number; startOffset: number; subDuration: number | null; visualType: string; visualMode: string | null; prompt: string | null; metadata: Record<string, unknown> | null; assetUrl: string | null; assetType: string | null; firstFrameUrl: string | null; status: string }[];

  // Vocabulary entries for clip transcript demo
  clipVocabulary?: VocabularyEntryData[];

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
  DATA_TABLE: 'Data Table',
};

function extractVisualLabel(v: { order: number; prompt: string | null; metadata: unknown; visualType: string }): string {
  // Prefer prompt (first sentence) when available
  if (v.prompt) return v.prompt.split('.')[0];

  // Fall back to type-specific metadata fields
  const meta = v.metadata as Record<string, unknown> | null;
  if (meta) {
    if (typeof meta.headline === 'string' && meta.headline) return meta.headline;
    if (typeof meta.title === 'string' && meta.title) return meta.title;
    if (typeof meta.quoteText === 'string' && meta.quoteText) return meta.quoteText.slice(0, 80);
    if (Array.isArray(meta.events) && meta.events.length > 0) {
      const first = meta.events[0] as Record<string, unknown>;
      if (typeof first.label === 'string') return first.label;
    }
    if (typeof meta.leftLabel === 'string' && typeof meta.rightLabel === 'string') {
      return `${meta.leftLabel} vs ${meta.rightLabel}`;
    }
    if (Array.isArray(meta.places) && meta.places.length > 0) {
      const first = meta.places[0] as Record<string, unknown>;
      if (typeof first.name === 'string') return first.name;
    }
  }

  // No label found — this is a data bug, log it so we can fix the visual
  logger.warn(`Visual #${v.order} (${v.visualType}) has no label: missing prompt and metadata`);
  return v.visualType;
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
 * Build showcase data from a config object (shared by saved config + live preview).
 * Returns null if the podcast is missing or incomplete.
 */
export async function buildShowcaseData(config: LandingShowcaseConfig): Promise<LandingShowcaseData | null> {
  try {
    const podcast = await prisma.podcast.findUnique({
      where: { id: config.podcastId },
      select: {
        id: true,
        title: true,
        topic: true,
        audioUrl: true,
        duration: true,
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
          orderBy: { order: 'asc' },
          select: { id: true, order: true, speaker: true, text: true, startTime: true, duration: true, wordTimings: true, ttsVoiceId: true },
        },
        vocabularyEntries: {
          orderBy: { number: 'asc' },
          select: {
            id: true,
            number: true,
            word: true,
            translation: true,
            partOfSpeech: true,
            pronunciation: true,
            exampleSentence: true,
            difficulty: true,
          },
        },
        videoGenerations: {
          take: 1,
          select: {
            videoUrl: true,
            visuals: {
              orderBy: [{ order: 'asc' }, { subOrder: 'asc' }],
              select: {
                id: true,
                segmentId: true,
                order: true,
                subOrder: true,
                startOffset: true,
                subDuration: true,
                prompt: true,
                visualType: true,
                visualMode: true,
                videoModel: true,
                metadata: true,
                assetUrl: true,
                assetType: true,
                firstFrameUrl: true,
                status: true,
              },
            },
            avatarOverlays: {
              where: { status: 'ready', videoUrl: { not: null } },
              select: { id: true },
              take: 1,
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

    // Voice count — distinct speakers
    const speakers = [...new Set(podcast.segments.map((s) => s.speaker))];
    const voiceCount = speakers.length || 2;
    const sourceCount = podcast.references.length;

    // Video segments — slice by config range
    const allVisuals = podcast.videoGenerations[0]?.visuals ?? [];
    const videoSegments = allVisuals
      .slice(config.videoSegmentStart, config.videoSegmentStart + config.videoSegmentCount)
      .map((v) => ({
        order: v.order,
        label: extractVisualLabel(v),
        type: VISUAL_TYPE_LABELS[v.visualType] ?? v.visualType,
      }));

    // Video clip — uses same clip range as audio so they sync on one timeline
    const videoUrl = podcast.videoGenerations[0]?.videoUrl;
    const videoClip = videoUrl
      ? { url: videoUrl, start: config.audioClipStart, end: audioClipEnd }
      : null;

    // Clip-range segments + visuals for client-side Remotion Player
    const clipStart = config.audioClipStart;
    const clipEnd = audioClipEnd;
    const clipSegments = podcast.segments
      .filter((s) => s.startTime !== null && s.duration !== null && s.startTime! + s.duration! > clipStart && s.startTime! < clipEnd)
      .map((s) => ({
        id: s.id,
        order: s.order,
        speaker: s.speaker,
        text: s.text,
        startTime: Math.max(0, (s.startTime ?? 0) - clipStart),
        duration: s.duration ?? 0,
        wordTimings: s.wordTimings as Array<{ word: string; start: number; end: number }> | null,
      }));
    const clipSegmentIds = new Set(clipSegments.map((s) => s.id));
    const clipVisuals = allVisuals
      .filter((v) => v.segmentId && clipSegmentIds.has(v.segmentId))
      .map((v) => ({
        id: v.id,
        segmentId: v.segmentId!,
        order: v.order,
        subOrder: v.subOrder ?? 0,
        startOffset: v.startOffset ?? 0,
        subDuration: v.subDuration ?? null,
        visualType: v.visualType,
        visualMode: v.visualMode ?? null,
        prompt: v.prompt ?? null,
        metadata: (v.metadata as Record<string, unknown>) ?? null,
        assetUrl: v.assetUrl ?? null,
        assetType: v.assetType ?? null,
        firstFrameUrl: v.firstFrameUrl ?? null,
        status: v.status,
      }));

    return {
      podcast: showcasePodcast,
      chatMessages,
      scriptTurns,
      references,
      audioClip,
      voiceCount,
      sourceCount,
      showAvatar: config.showAvatar,
      showVideo: config.showVideo,
      hasAvatars: (podcast.videoGenerations[0]?.avatarOverlays?.length ?? 0) > 0,
      videoSegments,
      videoClip,
      clipSegments,
      clipVisuals,
      clipVocabulary: podcast.vocabularyEntries.length > 0
        ? (podcast.vocabularyEntries as VocabularyEntryData[])
        : undefined,
    };
  } catch (err) {
    logger.warn('Failed to build landing showcase data', {
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
  const config = await getLandingShowcaseConfig();
  if (!config) return null;
  return buildShowcaseData(config);
}
