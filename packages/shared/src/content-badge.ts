import type { PodcastSummary } from './types/podcast';
import {
  AI_PROVIDER_DISPLAY,
  AI_MODEL_SHORT_DISPLAY,
  getTtsProviderLabel,
  getTtsModelLabel,
  getLanguageLabel,
} from './provider-display';

const SOURCE_PLATFORM_LABELS: Record<string, string> = {
  notebooklm: 'NotebookLM',
  spotify: 'Spotify',
  apple_podcasts: 'Apple Podcasts',
  youtube: 'YouTube',
  other: 'Other',
};

export function getContentBadgeLabel(
  podcast: Pick<PodcastSummary, 'source' | 'sourcePlatform'>
): string {
  if (podcast.source === 'IMPORT') {
    return podcast.sourcePlatform
      ? SOURCE_PLATFORM_LABELS[podcast.sourcePlatform] ?? 'Imported'
      : 'Imported';
  }
  return 'AI-Generated';
}

export interface PodcastBadge {
  category: 'content' | 'ai' | 'tts' | 'language';
  label: string;
  icon?: string;
  variant: 'default' | 'info' | 'success' | 'accent';
}

export function getPodcastBadges(
  podcast: Pick<
    PodcastSummary,
    'source' | 'sourcePlatform' | 'aiProvider' | 'aiModel' | 'ttsProvider' | 'ttsModel' | 'language'
  >
): PodcastBadge[] {
  const badges: PodcastBadge[] = [];

  // 1. Content type badge
  const contentLabel = getContentBadgeLabel(podcast);
  const isImport = podcast.source === 'IMPORT';
  badges.push({
    category: 'content',
    label: contentLabel,
    variant: isImport ? 'default' : 'info',
  });

  // 2. AI badge — "Provider · Model" format
  if (!isImport) {
    const providerShort = podcast.aiProvider
      ? AI_PROVIDER_DISPLAY[podcast.aiProvider]?.shortLabel
      : null;
    const modelShort = podcast.aiModel
      ? AI_MODEL_SHORT_DISPLAY[podcast.aiModel]
      : null;

    let aiLabel: string | null = null;
    if (providerShort && modelShort) {
      aiLabel = `${providerShort} · ${modelShort}`;
    } else if (modelShort) {
      aiLabel = modelShort;
    } else if (providerShort) {
      aiLabel = providerShort;
    }

    if (aiLabel) {
      badges.push({
        category: 'ai',
        label: aiLabel,
        icon: podcast.aiProvider ?? undefined,
        variant: 'accent',
      });
    }
  }

  // 3. TTS badge — "Provider · Model" format
  if (!isImport) {
    const ttsProviderShort = getTtsProviderLabel(podcast.ttsProvider);
    const ttsModelShort = getTtsModelLabel(podcast.ttsModel);

    let ttsLabel: string | null = null;
    if (ttsProviderShort && ttsModelShort) {
      ttsLabel = `${ttsProviderShort} · ${ttsModelShort}`;
    } else if (ttsProviderShort) {
      ttsLabel = ttsProviderShort;
    }

    if (ttsLabel) {
      badges.push({
        category: 'tts',
        label: ttsLabel,
        icon: podcast.ttsProvider ?? undefined,
        variant: 'default',
      });
    }
  }

  // 4. Language badge — always, when set
  const langLabel = getLanguageLabel(podcast.language);
  if (langLabel) {
    badges.push({
      category: 'language',
      label: langLabel,
      variant: 'default',
    });
  }

  return badges;
}
