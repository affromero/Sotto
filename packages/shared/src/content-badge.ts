import type { PodcastSummary } from './types/podcast';
import { SOURCE_PLATFORMS } from './types/import';
import { getAiProviderLabel, getAiModelLabel, getTtsProviderLabel, getLanguageLabel } from './provider-display';

export function getContentBadgeLabel(
  podcast: Pick<PodcastSummary, 'source' | 'isHumanContent' | 'sourcePlatform'>
): string {
  if (podcast.source === 'IMPORT' && podcast.isHumanContent) return 'Human';
  if (podcast.source === 'IMPORT') {
    const platform = SOURCE_PLATFORMS.find((p) => p.value === podcast.sourcePlatform);
    return platform?.label ?? 'Imported';
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
    'source' | 'isHumanContent' | 'sourcePlatform' | 'aiProvider' | 'aiModel' | 'ttsProvider' | 'language'
  >
): PodcastBadge[] {
  const badges: PodcastBadge[] = [];

  // 1. Content type badge
  const contentLabel = getContentBadgeLabel(podcast);
  const isHuman = podcast.source === 'IMPORT' && podcast.isHumanContent;
  const isImport = podcast.source === 'IMPORT';
  badges.push({
    category: 'content',
    label: contentLabel,
    variant: isHuman ? 'success' : isImport ? 'default' : 'info',
  });

  // 2. AI model/provider badge — prefer model name (e.g. "Claude Sonnet 4.5") over provider
  if (!isImport) {
    const aiLabel = getAiModelLabel(podcast.aiModel) ?? getAiProviderLabel(podcast.aiProvider);
    if (aiLabel) {
      badges.push({
        category: 'ai',
        label: aiLabel,
        icon: podcast.aiProvider ?? undefined,
        variant: 'accent',
      });
    }
  }

  // 3. TTS provider badge — only for non-import podcasts
  if (!isImport) {
    const ttsLabel = getTtsProviderLabel(podcast.ttsProvider);
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
