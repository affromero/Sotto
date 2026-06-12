interface Point {
  x: number;
  y: number;
}

interface EpisodeGradient {
  colors: [string, string];
  start: Point;
  end: Point;
}

const WARM_PAIRS: ReadonlyArray<[string, string]> = [
  ['#D97706', '#92400E'],   // amber → deep amber
  ['#B45309', '#78350F'],   // dark amber → brown
  ['#1E3A5F', '#0F172A'],   // navy → midnight
  ['#065F46', '#064E3B'],   // emerald → deep green
  ['#991B1B', '#7F1D1D'],   // crimson → deep red
  ['#7C3AED', '#4C1D95'],   // violet → deep purple
  ['#0369A1', '#0C4A6E'],   // sky → deep blue
  ['#A16207', '#713F12'],   // yellow → olive
];

const ANGLES: ReadonlyArray<{ start: Point; end: Point }> = [
  { start: { x: 0, y: 0 }, end: { x: 1, y: 1 } },     // top-left → bottom-right
  { start: { x: 1, y: 0 }, end: { x: 0, y: 1 } },     // top-right → bottom-left
  { start: { x: 0, y: 0.3 }, end: { x: 1, y: 0.7 } }, // slight diagonal
  { start: { x: 0.5, y: 0 }, end: { x: 0.5, y: 1 } }, // top → bottom
  { start: { x: 0, y: 0.5 }, end: { x: 1, y: 0.5 } }, // left → right
];

function hashString(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash |= 0; // Convert to 32-bit int
  }
  return Math.abs(hash);
}

export function getEpisodeGradient(id: string): EpisodeGradient {
  const hash = hashString(id);
  const pair = WARM_PAIRS[hash % WARM_PAIRS.length];
  const angle = ANGLES[(hash >> 3) % ANGLES.length];

  return {
    colors: [pair[0], pair[1]],
    start: angle.start,
    end: angle.end,
  };
}
