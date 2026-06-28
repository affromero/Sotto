import type { EpisodeSummary } from './types/episode';
import {
  AI_PROVIDER_DISPLAY,
  getAiModelShortLabel,
  getTtsProviderLabel,
  getTtsModelLabel,
  getLanguageLabel,
} from './provider-display';

const SOURCE_PLATFORM_LABELS: Record<string, string> = {
  notebooklm: 'NotebookLM',
  youtube: 'YouTube',
  other: 'Other',
};

export function getContentBadgeLabel(
  episode: Pick<EpisodeSummary, 'source' | 'sourcePlatform'>
): string {
  if (episode.source === 'IMPORT') {
    return episode.sourcePlatform
      ? (SOURCE_PLATFORM_LABELS[episode.sourcePlatform] ?? 'Imported')
      : 'Imported';
  }
  return 'AI-Generated';
}

export interface EpisodeBadge {
  category: 'content' | 'ai' | 'tts' | 'language';
  label: string;
  icon?: string;
  variant: 'default' | 'info' | 'success' | 'accent';
}

export function getEpisodeBadges(
  episode: Pick<
    EpisodeSummary,
    'source' | 'sourcePlatform' | 'aiProvider' | 'aiModel' | 'ttsProvider' | 'ttsModel' | 'language'
  >
): EpisodeBadge[] {
  const badges: EpisodeBadge[] = [];

  // 1. Content type badge
  const contentLabel = getContentBadgeLabel(episode);
  const isImport = episode.source === 'IMPORT';
  badges.push({
    category: 'content',
    label: contentLabel,
    variant: isImport ? 'default' : 'info',
  });

  // 2. AI badge — "Provider · Model" format
  if (!isImport) {
    const providerShort = episode.aiProvider
      ? AI_PROVIDER_DISPLAY[episode.aiProvider]?.shortLabel
      : null;
    const modelShort = getAiModelShortLabel(episode.aiModel);

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
        icon: episode.aiProvider ?? undefined,
        variant: 'accent',
      });
    }
  }

  // 3. TTS badge — "Provider · Model" format
  if (!isImport) {
    const ttsProviderShort = getTtsProviderLabel(episode.ttsProvider);
    const ttsModelShort = getTtsModelLabel(episode.ttsModel);

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
        icon: episode.ttsProvider ?? undefined,
        variant: 'default',
      });
    }
  }

  // 4. Language badge — always, when set
  const langLabel = getLanguageLabel(episode.language);
  if (langLabel) {
    badges.push({
      category: 'language',
      label: langLabel,
      variant: 'default',
    });
  }

  return badges;
}
