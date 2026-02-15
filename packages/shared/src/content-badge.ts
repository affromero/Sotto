import type { PodcastSummary } from './types/podcast';
import { SOURCE_PLATFORMS } from './types/import';

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
