export const AI_PROVIDER_DISPLAY: Record<string, { label: string; shortLabel: string }> = {
  anthropic: { label: 'Anthropic (Claude)', shortLabel: 'Claude' },
  openai: { label: 'OpenAI', shortLabel: 'GPT' },
  google: { label: 'Google (Gemini)', shortLabel: 'Gemini' },
  'claude-code': { label: 'Claude Code (Local)', shortLabel: 'Claude' },
  codex: { label: 'Codex (Local)', shortLabel: 'Codex' },
  local: { label: 'Local model (Ollama / vLLM)', shortLabel: 'Local' },
  together: { label: 'Together AI', shortLabel: 'Together' },
  deepgram: { label: 'Deepgram', shortLabel: 'Deepgram' },
  assemblyai: { label: 'AssemblyAI', shortLabel: 'AssemblyAI' },
  groq: { label: 'Groq', shortLabel: 'Groq' },
  gladia: { label: 'Gladia', shortLabel: 'Gladia' },
  speechmatics: { label: 'Speechmatics', shortLabel: 'Speechmatics' },
  xai: { label: 'xAI (Grok)', shortLabel: 'Grok' },
  deepseek: { label: 'DeepSeek', shortLabel: 'DeepSeek' },
  mistral: { label: 'Mistral', shortLabel: 'Mistral' },
  nvidia: { label: 'NVIDIA NIM', shortLabel: 'NVIDIA' },
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
  kokoro: { label: 'Kokoro (Local)', shortLabel: 'Kokoro' },
  deepgram: { label: 'Deepgram Aura', shortLabel: 'Aura' },
  rime: { label: 'Rime', shortLabel: 'Rime' },
  playht: { label: 'PlayHT', shortLabel: 'PlayHT' },
  local: { label: 'Local TTS sidecar', shortLabel: 'Local' },
};

export const STT_PROVIDER_DISPLAY: Record<string, { label: string; shortLabel: string }> = {
  openai: { label: 'OpenAI Whisper', shortLabel: 'Whisper' },
  elevenlabs: { label: 'ElevenLabs Scribe', shortLabel: 'Scribe' },
  together: { label: 'Together AI Whisper', shortLabel: 'Together' },
  deepgram: { label: 'Deepgram', shortLabel: 'Deepgram' },
  assemblyai: { label: 'AssemblyAI', shortLabel: 'AssemblyAI' },
  cartesia: { label: 'Cartesia Ink', shortLabel: 'Ink' },
  groq: { label: 'Groq Whisper', shortLabel: 'Groq' },
  gladia: { label: 'Gladia', shortLabel: 'Gladia' },
  speechmatics: { label: 'Speechmatics', shortLabel: 'Speechmatics' },
  local: { label: 'Local Whisper', shortLabel: 'Local' },
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
const openaiModels = STATIC_PRICING.filter((m) => m.provider === 'openai');
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
  'openai/gpt-oss-120b': 'GPT-OSS 120B',
  'grok-4-fast': 'Grok 4 Fast',
  'grok-4': 'Grok 4',
  'deepseek-v4-flash': 'DeepSeek V4 Flash',
  'deepseek-v4-pro': 'DeepSeek V4 Pro',
  'mistral-small-latest': 'Mistral Small',
  'mistral-medium-latest': 'Mistral Medium',
  'mistral-large-latest': 'Mistral Large',
  'nvidia/llama-3.3-nemotron-super-49b-v1': 'Nemotron Super 49B',
  'nvidia/llama-3.1-nemotron-ultra-253b-v1': 'Nemotron Ultra 253B',
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
  'openai/gpt-oss-120b': 'GPT-OSS 120B',
  'grok-4-fast': 'Grok 4 Fast',
  'grok-4': 'Grok 4',
  'deepseek-v4-flash': 'V4 Flash',
  'deepseek-v4-pro': 'V4 Pro',
  'mistral-small-latest': 'Small',
  'mistral-medium-latest': 'Medium',
  'mistral-large-latest': 'Large',
  'nvidia/llama-3.3-nemotron-super-49b-v1': 'Nemotron 49B',
  'nvidia/llama-3.1-nemotron-ultra-253b-v1': 'Nemotron 253B',
  'claude-code:haiku': 'Haiku 4.5',
  'claude-code:sonnet': 'Sonnet 4.6',
  'claude-code:opus': 'Opus 4.6',
};

export const TTS_MODEL_DISPLAY: Record<string, string> = {
  eleven_v3: 'v3',
  eleven_multilingual_v2: 'v2',
  'tts-1-hd': 'HD',
  'sonic-3.5': 'Sonic 3.5',
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
  eleven_flash_v2_5: 'Flash v2.5',
  eleven_turbo_v2: 'Turbo v2',
  'tts-1': 'TTS-1',
  'gpt-4o-mini-tts': 'GPT-4o Mini TTS',
  'inworld-tts-1.5-max': 'Inworld 1.5 Max',
  'inworld-tts-1.5-mini': 'Inworld 1.5 Mini',
  'aura-2': 'Aura 2',
  arcana: 'Arcana',
  mistv2: 'Mist v2',
  'Play3.0-mini': 'Play 3.0 Mini',
  PlayDialog: 'PlayDialog',
  kokoro: 'Kokoro 82M',
  local: 'Local TTS',
};

function titleAgentModel(raw: string): string {
  return raw
    .replace(
      /(^|[-_/\s])([a-z0-9])/g,
      (_match: string, prefix: string, letter: string) => `${prefix}${letter.toUpperCase()}`
    )
    .replace(/-/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function getAgentModelDisplay(modelId: string, short: boolean): string | null {
  const [base, fragment] = modelId.split('#', 2);
  const effort = fragment ? new URLSearchParams(fragment).get('effort') : null;
  const effortSuffix = effort ? ` (${effort} effort)` : '';
  if (base === 'codex') return `Codex configured default${effortSuffix}`;
  if (base.startsWith('codex:')) {
    const model = titleAgentModel(base.slice('codex:'.length));
    return short ? `${model}${effortSuffix}` : `Codex ${model}${effortSuffix}`;
  }
  if (base.startsWith('claude-code:')) {
    const model = titleAgentModel(base.slice('claude-code:'.length));
    return short ? `${model}${effortSuffix}` : `Claude Code ${model}${effortSuffix}`;
  }
  return null;
}

export function getAiProviderLabel(id: string | null | undefined): string | null {
  if (!id) return null;
  return AI_PROVIDER_DISPLAY[id]?.shortLabel ?? id;
}

export function getAiModelLabel(modelId: string | null | undefined): string | null {
  if (!modelId) return null;
  return AI_MODEL_DISPLAY[modelId] ?? getAgentModelDisplay(modelId, false) ?? modelId;
}

export function getAiModelShortLabel(modelId: string | null | undefined): string | null {
  if (!modelId) return null;
  return AI_MODEL_SHORT_DISPLAY[modelId] ?? getAgentModelDisplay(modelId, true) ?? modelId;
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
