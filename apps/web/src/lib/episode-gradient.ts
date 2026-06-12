/**
 * Deterministic gradient generation from episode ID.
 * Every episode gets a unique, stable gradient based on its ID string.
 */

const PALETTES = [
  { from: '#3F4FB0', to: '#34419A' },   // aula indigo → deep indigo
  { from: '#2A3550', to: '#1E2A47' },   // aula slate → deep slate
  { from: '#3F4FB0', to: '#2A3550' },   // indigo → slate (brand pair)
  { from: '#2A3580', to: '#3F4FB0' },   // ink indigo → indigo
  { from: '#2A3550', to: '#1F4A5C' },   // slate → deep teal
  { from: '#3F4FB0', to: '#1F4A5C' },   // indigo → deep teal
  { from: '#1E2A47', to: '#2A3550' },   // deep slate → slate
  { from: '#34419A', to: '#262E6E' },   // deep indigo → midnight indigo
  { from: '#1F4A5C', to: '#1E2A47' },   // deep teal → deep slate
  { from: '#2A3550', to: '#2A3580' },   // slate → ink indigo
  { from: '#262E6E', to: '#3F4FB0' },   // midnight indigo → indigo
  { from: '#1E2A47', to: '#3F4FB0' },   // deep slate → indigo
] as const;

function hashString(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

export interface EpisodeGradient {
  from: string;
  to: string;
  angle: string;
}

export function getEpisodeGradient(episodeId: string): EpisodeGradient {
  const hash = hashString(episodeId);
  const palette = PALETTES[hash % PALETTES.length];
  const secondaryHash = hashString(episodeId + '_angle');
  const angle = 135 + (secondaryHash % 4) * 10;

  return {
    from: palette.from,
    to: palette.to,
    angle: `${angle}deg`,
  };
}
