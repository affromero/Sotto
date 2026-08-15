import { WelcomeFlow, type ModelMeta } from './WelcomeFlow';
import { isSelfHosted } from '@/lib/self-hosted';
import { getAiProviderMeta } from '@/lib/providers/ai-registry';
import { getProviderMeta } from '@/lib/providers/tts-registry';
import { getSttProviderMeta } from '@/lib/providers/stt-registry';
import { getAutoModelConfig } from '@/lib/auto-model-config';
import { getAgentModelOffering } from '@/lib/agent-models';
import { ensureLocalUser } from '@/lib/local-user';

export const metadata = {
  title: 'Welcome to Sotto',
  robots: { index: false, follow: false },
};

// The self-hosted installation key comes from the live database and must not be
// resolved while the production image is being built.
export const dynamic = 'force-dynamic';

/**
 * Registry-sourced model lists for the wizard's model pickers. Keyed by the
 * backend provider ids the wizard maps to (AI key → anthropic/openai; cloud TTS;
 * cloud STT). Built server-side from the provider registries — never hardcoded.
 */
async function buildModelMeta(): Promise<ModelMeta> {
  const autoConfig = await getAutoModelConfig().catch(() => undefined);
  const [claudeOffering, codexOffering] = await Promise.all([
    getAgentModelOffering('claude-code', { autoConfig }),
    getAgentModelOffering('codex', { autoConfig }),
  ]);
  const opt = <T extends { id: string; displayName: string }>(models: T[]) =>
    models.map((m) => ({ id: m.id, label: m.displayName }));
  return {
    ai: {
      anthropic: opt(getAiProviderMeta('anthropic').models),
      openai: opt(getAiProviderMeta('openai').models),
      // Backs the CLI (claude-code) model picker: haiku/sonnet/opus.
      'claude-code': opt(claudeOffering.models),
      codex: opt(codexOffering.models),
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

export default async function WelcomePage() {
  const selfHosted = isSelfHosted();
  // Browser wizard progress is scoped to the owner row that created it. A
  // factory reset recreates that row, so stale progress from the previous
  // installation cannot skip the fresh welcome flow.
  const onboardingResumeKey = selfHosted
    ? (await ensureLocalUser()).createdAt.toISOString()
    : undefined;

  return (
    <WelcomeFlow
      initialConfig={{ selfHosted, isOwner: false, onboardingResumeKey }}
      modelMeta={await buildModelMeta()}
    />
  );
}
