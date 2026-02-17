/**
 * Deterministic gradient generation from podcast ID.
 * Every podcast gets a unique, stable gradient based on its ID string.
 */

const PALETTES = [
  { from: '#D97706', to: '#B45309' },   // golden amber → deep amber
  { from: '#1E3A5F', to: '#0F4C75' },   // deep navy → ocean blue
  { from: '#D97706', to: '#1E3A5F' },   // amber → navy (brand pair)
  { from: '#92400E', to: '#D97706' },   // brown → amber
  { from: '#1E3A5F', to: '#065F46' },   // navy → dark emerald
  { from: '#D97706', to: '#065F46' },   // amber → dark emerald
  { from: '#0F4C75', to: '#1E3A5F' },   // ocean blue → navy
  { from: '#B45309', to: '#78350F' },   // deep amber → espresso
  { from: '#065F46', to: '#0F4C75' },   // dark emerald → ocean
  { from: '#1E3A5F', to: '#92400E' },   // navy → brown
  { from: '#78350F', to: '#D97706' },   // espresso → amber
  { from: '#0F4C75', to: '#D97706' },   // ocean blue → amber
] as const;

function hashString(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

export interface PodcastGradient {
  from: string;
  to: string;
  angle: string;
}

export function getPodcastGradient(podcastId: string): PodcastGradient {
  const hash = hashString(podcastId);
  const palette = PALETTES[hash % PALETTES.length];
  const secondaryHash = hashString(podcastId + '_angle');
  const angle = 135 + (secondaryHash % 4) * 10;

  return {
    from: palette.from,
    to: palette.to,
    angle: `${angle}deg`,
  };
}
