import type { SelectedApi } from 'thesidedoor-core/ai/providers';
import { providerCompatibleConnection } from 'thesidedoor-core/providers/catalog';

/** Capture endpoint configuration without resolving or borrowing any credentials. */
export function captureApiEndpoint(provider: string): string {
  if (provider === 'anthropic') return 'https://api.anthropic.com';
  if (provider === 'openai') return 'https://api.openai.com/v1';
  if (provider === 'google') return 'https://generativelanguage.googleapis.com/v1beta/openai/';
  const connection = providerCompatibleConnection(provider);
  if (!connection) throw new Error(`No API endpoint configured for ${provider}`);
  return connection.baseURL;
}

/** The caller has already selected this key for this endpoint and owner. No environment key lookup. */
export function selectedApi(input: {
  provider: string;
  label: string;
  transport: SelectedApi['transport'];
  apiKey: string;
  endpoint: string;
}): SelectedApi {
  const { provider, label, transport, apiKey, endpoint } = input;
  const descriptor = {
    id: provider,
    label,
    transport: 'api' as const,
    fields: [],
    models: [],
    capabilities:
      provider === 'anthropic'
        ? (['text', 'vision', 'structured', 'tools', 'web'] as const)
        : provider === 'openai'
          ? (['text', 'vision', 'structured', 'web'] as const)
          : (['text', 'vision', 'structured'] as const),
  };
  if (transport === 'anthropic')
    return {
      descriptor,
      transport,
      credentials: { apiKey, compatibleApiKey: apiKey, baseUrl: endpoint },
    };
  if (transport === 'responses')
    return {
      descriptor,
      transport,
      credentials: { apiKey },
      baseUrl: endpoint,
      webSearchType: 'web_search_preview',
    };
  return { descriptor, transport, credentials: { apiKey }, baseUrl: endpoint, requiresKey: true };
}
