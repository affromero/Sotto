import { prisma } from '@/lib/prisma';
import { getLandingShowcaseConfig } from '@/lib/landing-showcase';
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
  } catch {
    // DB unavailable at build time — gracefully skip
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
          select: { speaker: true },
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
        videoGeneration: {
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

    const showcasePodcast: ShowcasePodcast = {
      podcastId: podcast.id,
      title: podcast.title,
      creatorName: podcast.user.handle || podcast.user.name || 'Sotto',
      audioUrl: podcast.audioUrl,
      duration: podcast.duration,
    };

    // Chat messages — first 4 user/assistant messages
    const chatMessages = (podcast.discovery?.messages ?? []).map((m) => {
      const chips = m.chips as Array<{ label: string; value: string }> | null;
      return {
        role: m.role as 'user' | 'assistant',
        content: m.content,
        ...(chips && { chips: chips.map((c) => c.label) }),
      };
    });

    // Script turns — slice by config range
    const allTurns = (podcast.script?.turns ?? []) as Array<{ speaker: string; text: string }>;
    const scriptTurns = allTurns.slice(
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
    const voiceCount = new Set(podcast.segments.map((s) => s.speaker)).size || 2;
    const sourceCount = podcast.references.length;

    // Video segments
    const videoSegments = (podcast.videoGeneration?.visuals ?? []).map((v) => ({
      order: v.order,
      label: v.prompt ? v.prompt.split('.')[0] : `Segment ${v.order}`,
      type: VISUAL_TYPE_LABELS[v.visualType] ?? v.visualType,
    }));

    // Video clip
    const videoUrl = podcast.videoGeneration?.videoUrl;
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
      voiceTracks,
      voiceCount,
      sourceCount,
      videoSegments,
      videoClip,
      bot,
    };
  } catch {
    return null;
  }
}
