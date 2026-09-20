import { PROVIDERS, TTS_PROVIDERS, STT_PROVIDERS } from '@/app/welcome/data';
import {
  aiModelProviderId,
  resolveWelcomeTtsProviderId,
  resolveWelcomeSttProviderId,
  sttModelProviderId,
} from '@/app/welcome/providerMap';
import type { AgentState, VoiceState } from '@/app/welcome/WelcomeFlow';
import type { WelcomeCredentialSession } from '@/app/welcome/session/credential-session';
import type { CredentialEndpoint } from '@/lib/sidedoor/credentials/config/credential-browser';

type Selection = { endpoint: CredentialEndpoint; provider: string };
function speechSelection(id: string, kind: 'tts' | 'stt'): Selection | null {
  const provider =
    kind === 'tts'
      ? resolveWelcomeTtsProviderId(id)
      : (resolveWelcomeSttProviderId(id) ?? sttModelProviderId(id));
  if (!provider || provider === 'local' || provider === 'kokoro') return null;
  return {
    endpoint:
      kind === 'tts' || provider === 'elevenlabs' || provider === 'cartesia' ? 'byok' : 'ai-keys',
    provider,
  };
}

export function welcomeCredentialSelections(agent: AgentState, voice: VoiceState): Selection[] {
  const selections: Selection[] = [];
  const ai = agent.method === 'key' ? aiModelProviderId(agent.provider) : null;
  if (ai) selections.push({ endpoint: 'ai-keys', provider: ai });
  if (agent.liveTranslationKey?.trim())
    selections.push({ endpoint: 'ai-keys', provider: 'google' });
  for (const selection of [speechSelection(voice.tts, 'tts'), speechSelection(voice.stt, 'stt')])
    if (selection) selections.push(selection);
  if (voice.visualCueProvider === 'pexels')
    selections.push({ endpoint: 'visual-cues', provider: 'pexels' });
  return selections;
}

/** Project canonical metadata into wizard card IDs without presenting saved keys as server keys. */
export function welcomeCredentialDiscovery(
  session: WelcomeCredentialSession,
  kind: 'saved' | 'stored'
) {
  const includes = (selection: Selection | null) =>
    selection !== null &&
    (kind === 'saved'
      ? session.savedProviders(selection.endpoint)
      : session.storedProviders(selection.endpoint)
    ).includes(selection.provider);
  return {
    ai: PROVIDERS.filter((provider) => {
      const id = aiModelProviderId(provider.id);
      return id !== null && includes({ endpoint: 'ai-keys', provider: id });
    }).map((provider) => provider.id),
    tts: TTS_PROVIDERS.filter((provider) => includes(speechSelection(provider.id, 'tts'))).map(
      (provider) => provider.id
    ),
    stt: STT_PROVIDERS.filter((provider) => includes(speechSelection(provider.id, 'stt'))).map(
      (provider) => provider.id
    ),
    visual: includes({ endpoint: 'visual-cues', provider: 'pexels' }) ? ['pexels'] : [],
  };
}
