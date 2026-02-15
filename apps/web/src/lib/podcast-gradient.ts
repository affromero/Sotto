/**
 * Deterministic gradient generation from podcast ID.
 * Every podcast gets a unique, stable gradient based on its ID string.
 */

const PALETTES = [
  { from: '#D97706', to: '#DC2626' },   // amber → red
  { from: '#7C3AED', to: '#2563EB' },   // purple → blue
  { from: '#059669', to: '#06B6D4' },   // emerald → cyan
  { from: '#F43F5E', to: '#D97706' },   // rose → amber
  { from: '#1E3A5F', to: '#7C3AED' },   // navy → purple
  { from: '#D97706', to: '#059669' },   // amber → emerald
  { from: '#DC2626', to: '#7C3AED' },   // red → purple
  { from: '#06B6D4', to: '#059669' },   // cyan → emerald
  { from: '#92400E', to: '#D97706' },   // brown → amber
  { from: '#1E3A5F', to: '#06B6D4' },   // navy → cyan
  { from: '#F43F5E', to: '#7C3AED' },   // rose → purple
  { from: '#7C3AED', to: '#D97706' },   // purple → amber
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
