import { getAiProviderIds } from '@/lib/providers/ai-registry';
import { getProviderIds } from '@/lib/providers/tts-registry';
import type { CredentialScope } from '@/lib/sidedoor/access/state/state';
import type { SottoCredentialEndpoint } from '@/lib/sidedoor/credentials/config/credential-selection-contract';

export function sottoCredentialEndpoint(endpoint: SottoCredentialEndpoint) {
  const providers: readonly string[] =
    endpoint === 'ai-keys'
      ? getAiProviderIds()
      : endpoint === 'byok'
        ? [...getProviderIds(), 'suno']
        : ['pexels'];
  return {
    providers,
    scope(provider: string): CredentialScope {
      if (!providers.includes(provider))
        throw new Error('Unsupported credential endpoint or provider');
      if (endpoint === 'ai-keys') return 'ai';
      if (endpoint === 'visual-cues') return 'visual';
      return provider === 'suno' ? 'music' : 'tts';
    },
  };
}
