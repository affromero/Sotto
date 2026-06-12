/**
 * Deterministic chart colors for providers/categories in the admin console.
 * Known services get a fixed brand-ish hue; everything else cycles a fallback
 * palette by index so the same key always renders the same swatch within a view.
 */
const KNOWN: Record<string, string> = {
  anthropic: '#3f4fb0',
  openai: '#1c7a6b',
  google: '#b5772a',
  elevenlabs: '#80487f',
  cartesia: '#3f6fb0',
  hume: '#b5462a',
  fal: '#557a1c',
  replicate: '#2a6f7a',
  deepgram: '#7a2a6f',
  assemblyai: '#6a9bff',
  together: '#a85a2a',
  minimax: '#5a7a2a',
  mistral: '#b04a4a',
  kokoro: '#1c7a6b',
  local: '#8a8f9c',
};

const FALLBACK = [
  '#3f4fb0',
  '#1c7a6b',
  '#b5772a',
  '#80487f',
  '#b5462a',
  '#3f6fb0',
  '#557a1c',
  '#7a2a6f',
];

export function colorForService(name: string, index = 0): string {
  return KNOWN[name?.toLowerCase()] ?? FALLBACK[index % FALLBACK.length];
}
