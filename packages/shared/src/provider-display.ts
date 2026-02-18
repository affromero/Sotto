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
  fal: { label: 'Fal (Qwen3-TTS)', shortLabel: 'Fal' },
  replicate: { label: 'Replicate (Qwen3-TTS)', shortLabel: 'Replicate' },
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

export const AI_MODEL_DISPLAY: Record<string, string> = {
  'claude-haiku-4-5-20251001': 'Claude Haiku 4.5',
  'claude-sonnet-4-5-20250929': 'Claude Sonnet 4.5',
  'claude-opus-4-6': 'Claude Opus 4.6',
  'gpt-4o-mini': 'GPT-4o Mini',
  'gpt-4o': 'GPT-4o',
};

/** Short model names without the provider prefix (for "Provider · Model" badges) */
export const AI_MODEL_SHORT_DISPLAY: Record<string, string> = {
  'claude-haiku-4-5-20251001': 'Haiku 4.5',
  'claude-sonnet-4-5-20250929': 'Sonnet 4.5',
  'claude-opus-4-6': 'Opus 4.6',
  'gpt-4o-mini': '4o Mini',
  'gpt-4o': '4o',
};

export const TTS_MODEL_DISPLAY: Record<string, string> = {
  eleven_v3: 'v3',
  eleven_multilingual_v2: 'v2',
  'tts-1-hd': 'HD',
  'sonic-2': 'Sonic 2',
  premium: 'Premium',
  octave: 'Octave',
  'qwen3-tts-1.7b': 'Qwen3 1.7B',
  'qwen3-tts-0.6b': 'Qwen3 0.6B',
  'qwen3-tts': 'Qwen3',
};

export function getAiProviderLabel(id: string | null | undefined): string | null {
  if (!id) return null;
  return AI_PROVIDER_DISPLAY[id]?.shortLabel ?? id;
}

export function getAiModelLabel(modelId: string | null | undefined): string | null {
  if (!modelId) return null;
  return AI_MODEL_DISPLAY[modelId] ?? modelId;
}

export function getTtsProviderLabel(id: string | null | undefined): string | null {
  if (!id) return null;
  return TTS_PROVIDER_DISPLAY[id]?.shortLabel ?? id;
}

export function getTtsModelLabel(modelId: string | null | undefined): string | null {
  if (!modelId) return null;
  return TTS_MODEL_DISPLAY[modelId] ?? modelId;
}

export function getLanguageLabel(code: string | null | undefined): string | null {
  if (!code) return null;
  return LANGUAGE_DISPLAY[code] ?? code.toUpperCase();
}
