import { WelcomeFlow, type ModelMeta } from './WelcomeFlow';
import { isSelfHosted } from '@/lib/self-hosted';
import { getAiProviderMeta } from '@/lib/providers/ai-registry';
import { getProviderMeta } from '@/lib/providers/tts-registry';
import { getSttProviderMeta } from '@/lib/providers/stt-registry';

export const metadata = {
  title: 'Welcome to Sotto',
  robots: { index: false, follow: false },
};

/**
 * Registry-sourced model lists for the wizard's model pickers. Keyed by the
 * backend provider ids the wizard maps to (AI key → anthropic/openai; cloud TTS;
 * cloud STT). Built server-side from the provider registries — never hardcoded.
 */
function buildModelMeta(): ModelMeta {
  const opt = <T extends { id: string; displayName: string }>(models: T[]) =>
    models.map((m) => ({ id: m.id, label: m.displayName }));
  return {
    ai: {
      anthropic: opt(getAiProviderMeta('anthropic').models),
      openai: opt(getAiProviderMeta('openai').models),
      // Backs the CLI (claude-code) model picker: haiku/sonnet/opus.
      'claude-code': opt(getAiProviderMeta('claude-code').models),
      // Cloud LLM cards.
      xai: opt(getAiProviderMeta('xai').models),
      deepseek: opt(getAiProviderMeta('deepseek').models),
      mistral: opt(getAiProviderMeta('mistral').models),
      groq: opt(getAiProviderMeta('groq').models),
      nvidia: opt(getAiProviderMeta('nvidia').models),
    },
    tts: {
      elevenlabs: opt(getProviderMeta('elevenlabs').models),
      openai: opt(getProviderMeta('openai').models),
      cartesia: opt(getProviderMeta('cartesia').models),
      hume: opt(getProviderMeta('hume').models),
      deepgram: opt(getProviderMeta('deepgram').models),
      rime: opt(getProviderMeta('rime').models),
      playht: opt(getProviderMeta('playht').models),
    },
    stt: {
      openai: opt(getSttProviderMeta('openai').models),
      deepgram: opt(getSttProviderMeta('deepgram').models),
      assemblyai: opt(getSttProviderMeta('assemblyai').models),
      elevenlabs: opt(getSttProviderMeta('elevenlabs').models),
      cartesia: opt(getSttProviderMeta('cartesia').models),
      groq: opt(getSttProviderMeta('groq').models),
      gladia: opt(getSttProviderMeta('gladia').models),
      speechmatics: opt(getSttProviderMeta('speechmatics').models),
    },
  };
}

export default function WelcomePage() {
  return (
    <WelcomeFlow
      initialConfig={{ selfHosted: isSelfHosted(), isOwner: false }}
      modelMeta={buildModelMeta()}
    />
  );
}
