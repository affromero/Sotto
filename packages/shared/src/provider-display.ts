export const AI_PROVIDER_DISPLAY: Record<string, { label: string; shortLabel: string }> = {
  anthropic: { label: 'Anthropic (Claude)', shortLabel: 'Claude' },
  openai: { label: 'OpenAI', shortLabel: 'GPT' },
  google: { label: 'Google (Gemini)', shortLabel: 'Gemini' },
  'claude-code': { label: 'Claude Code (Local)', shortLabel: 'Claude' },
  together: { label: 'Together AI', shortLabel: 'Together' },
  deepgram: { label: 'Deepgram', shortLabel: 'Deepgram' },
  assemblyai: { label: 'AssemblyAI', shortLabel: 'AssemblyAI' },
};

export const TTS_PROVIDER_DISPLAY: Record<string, { label: string; shortLabel: string }> = {
  elevenlabs: { label: 'ElevenLabs', shortLabel: 'ElevenLabs' },
  openai: { label: 'OpenAI TTS', shortLabel: 'OpenAI' },
  cartesia: { label: 'Cartesia', shortLabel: 'Cartesia' },
  hume: { label: 'Hume AI', shortLabel: 'Hume' },
  fal: { label: 'Fal', shortLabel: 'Fal' },
  replicate: { label: 'Replicate', shortLabel: 'Replicate' },
  minimax: { label: 'MiniMax', shortLabel: 'MiniMax' },
  mistral: { label: 'Mistral (Voxtral)', shortLabel: 'Mistral' },
};

export const STT_PROVIDER_DISPLAY: Record<string, { label: string; shortLabel: string }> = {
  openai: { label: 'OpenAI Whisper', shortLabel: 'Whisper' },
  elevenlabs: { label: 'ElevenLabs Scribe', shortLabel: 'Scribe' },
  together: { label: 'Together AI Whisper', shortLabel: 'Together' },
  deepgram: { label: 'Deepgram', shortLabel: 'Deepgram' },
  assemblyai: { label: 'AssemblyAI', shortLabel: 'AssemblyAI' },
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
  da: 'Danish',
  fi: 'Finnish',
  no: 'Norwegian',
  cs: 'Czech',
  ro: 'Romanian',
  hu: 'Hungarian',
  el: 'Greek',
  he: 'Hebrew',
  th: 'Thai',
  vi: 'Vietnamese',
  id: 'Indonesian',
  ms: 'Malay',
  uk: 'Ukrainian',
  ca: 'Catalan',
};

import { STATIC_PRICING } from 'pricetoken';

// Derive OpenAI model display names from pricetoken (auto-updates with new models)
const openaiModels = STATIC_PRICING.filter(m => m.provider === 'openai');
const openaiDisplay: Record<string, string> = {};
const openaiShortDisplay: Record<string, string> = {};
for (const m of openaiModels) {
  openaiDisplay[m.modelId] = m.displayName;
  // Strip "GPT-" prefix for short name (e.g. "GPT-5.4 Nano" → "5.4 Nano")
  openaiShortDisplay[m.modelId] = m.displayName.replace(/^GPT-/, '');
}

export const AI_MODEL_DISPLAY: Record<string, string> = {
  'claude-haiku-4-5-20251001': 'Claude Haiku 4.5',
  'claude-sonnet-4-6': 'Claude Sonnet 4.6',
  'claude-opus-4-6': 'Claude Opus 4.6',
  ...openaiDisplay,
  'gpt-5-nano': 'GPT-5 Nano',
  'gpt-5-mini': 'GPT-5 Mini',
  'gpt-5': 'GPT-5',
  'gpt-5.2': 'GPT-5.2',
  'gpt-5.4-nano': 'GPT-5.4 Nano',
  'gpt-5.4-mini': 'GPT-5.4 Mini',
  'gpt-5.4': 'GPT-5.4',
  'gpt-5.4-pro': 'GPT-5.4 Pro',
  'gemini-3.1-flash-lite-preview': 'Gemini 3.1 Flash Lite',
  'gemini-3.1-pro-preview': 'Gemini 3.1 Pro',
  'llama-3.1-8b-instant': 'Llama 3.1 8B (Fast)',
  'llama-3.3-70b-versatile': 'Llama 3.3 70B (Best)',
  'claude-code:haiku': 'Claude Haiku 4.5 (Local)',
  'claude-code:sonnet': 'Claude Sonnet 4.6 (Local)',
  'claude-code:opus': 'Claude Opus 4.6 (Local)',
};

/** Short model names without the provider prefix (for "Provider · Model" badges) */
export const AI_MODEL_SHORT_DISPLAY: Record<string, string> = {
  'claude-haiku-4-5-20251001': 'Haiku 4.5',
  'claude-sonnet-4-6': 'Sonnet 4.6',
  'claude-opus-4-6': 'Opus 4.6',
  ...openaiShortDisplay,
  'gpt-5-nano': '5 Nano',
  'gpt-5-mini': '5 Mini',
  'gpt-5': '5',
  'gpt-5.2': '5.2',
  'gpt-5.4-nano': '5.4 Nano',
  'gpt-5.4-mini': '5.4 Mini',
  'gpt-5.4': '5.4',
  'gpt-5.4-pro': '5.4 Pro',
  'gemini-3.1-flash-lite-preview': 'Flash Lite 3.1',
  'gemini-3.1-pro-preview': 'Pro 3.1',
  'llama-3.1-8b-instant': '3.1 8B',
  'llama-3.3-70b-versatile': '3.3 70B',
  'claude-code:haiku': 'Haiku 4.5',
  'claude-code:sonnet': 'Sonnet 4.6',
  'claude-code:opus': 'Opus 4.6',
};

export const TTS_MODEL_DISPLAY: Record<string, string> = {
  eleven_v3: 'v3',
  eleven_multilingual_v2: 'v2',
  'tts-1-hd': 'HD',
  'sonic-3': 'Sonic 3',
  'sonic-turbo': 'Sonic Turbo',
  'sonic-2': 'Sonic 2',
  premium: 'Premium',
  'octave-v1': 'Octave V1',
  'qwen3-tts-1.7b': 'Qwen3 1.7B',
  'qwen3-tts-0.6b': 'Qwen3 0.6B',
  'qwen3-tts': 'Qwen3',
  'voxtral-mini-tts-2603': 'Voxtral Mini',
  'speech-02-hd': 'Speech-02 HD',
  'speech-02-turbo': 'Speech-02 Turbo',
  'octave-v2': 'Octave V2',
  'eleven_flash_v2_5': 'Flash v2.5',
  'eleven_turbo_v2': 'Turbo v2',
  'tts-1': 'TTS-1',
  'gpt-4o-mini-tts': 'GPT-4o Mini TTS',
  'inworld-tts-1.5-max': 'Inworld 1.5 Max',
  'inworld-tts-1.5-mini': 'Inworld 1.5 Mini',
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
