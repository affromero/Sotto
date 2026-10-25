import { findByVoiceId, VOICE_POOL } from '@/lib/voice-pool';
import { getProviderMeta } from '@/lib/providers/tts-registry';

// https://developers.openai.com/api/docs/guides/text-to-speech#voice-options
const LEGACY_VOICES = [
  'alloy',
  'ash',
  'coral',
  'echo',
  'fable',
  'onyx',
  'nova',
  'sage',
  'shimmer',
] as const;
const ALL_VOICES = [...LEGACY_VOICES, 'ballad', 'verse', 'marin', 'cedar'] as const;
type OpenAIVoice = (typeof ALL_VOICES)[number];

function getOpenAIVoiceIds(model: string | null = null): readonly OpenAIVoice[] {
  const selected = model ?? getProviderMeta('openai').defaultModel;
  return selected === 'tts-1' || selected === 'tts-1-hd' ? LEGACY_VOICES : ALL_VOICES;
}

export function getOpenAIVoicePool(model: string | null = null) {
  const voices = getOpenAIVoiceIds(model);
  return VOICE_POOL.filter((entry) => voices.some((voice) => voice === entry.ids.openai));
}

export function resolveOpenAIVoice(voiceId: string, model: string): OpenAIVoice {
  const resolved = findByVoiceId(voiceId)?.ids.openai ?? voiceId;
  const voice = getOpenAIVoiceIds(model).find((candidate) => candidate === resolved);
  if (!voice) {
    throw new Error(
      `Voice "${voiceId}" is not supported by OpenAI model "${model}". Choose a compatible voice.`
    );
  }
  return voice;
}
