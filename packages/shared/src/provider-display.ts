export const AI_PROVIDER_DISPLAY: Record<string, { label: string; shortLabel: string }> = {
  anthropic: { label: 'Anthropic (Claude)', shortLabel: 'Claude' },
  openai: { label: 'OpenAI', shortLabel: 'GPT' },
  groq: { label: 'Groq', shortLabel: 'Groq' },
};

export const TTS_PROVIDER_DISPLAY: Record<string, { label: string; shortLabel: string }> = {
  elevenlabs: { label: 'ElevenLabs', shortLabel: 'ElevenLabs' },
  openai: { label: 'OpenAI TTS', shortLabel: 'OpenAI' },
  playht: { label: 'PlayHT', shortLabel: 'PlayHT' },
  cartesia: { label: 'Cartesia', shortLabel: 'Cartesia' },
  hume: { label: 'Hume AI', shortLabel: 'Hume' },
};

export const LANGUAGE_DISPLAY: Record<string, string> = {
  en: 'English',
  es: 'Spanish',
  fr: 'French',
  de: 'German',
  pt: 'Portuguese',
  it: 'Italian',
  ja: 'Japanese',
  ko: 'Korean',
  zh: 'Chinese',
  ar: 'Arabic',
  hi: 'Hindi',
  ru: 'Russian',
  nl: 'Dutch',
  sv: 'Swedish',
  pl: 'Polish',
  tr: 'Turkish',
};

export function getAiProviderLabel(id: string | null | undefined): string | null {
  if (!id) return null;
  return AI_PROVIDER_DISPLAY[id]?.shortLabel ?? id;
}

export function getTtsProviderLabel(id: string | null | undefined): string | null {
  if (!id) return null;
  return TTS_PROVIDER_DISPLAY[id]?.shortLabel ?? id;
}

export function getLanguageLabel(code: string | null | undefined): string | null {
  if (!code) return null;
  return LANGUAGE_DISPLAY[code] ?? code.toUpperCase();
}
