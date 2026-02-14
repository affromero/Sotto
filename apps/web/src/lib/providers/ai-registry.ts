/**
 * Declarative AI (LLM) provider registry — capabilities, auth config, and
 * validation functions for every supported BYOK AI provider.
 * Parallel to tts-registry.ts for TTS providers.
 */
import { logger } from '../logger';

export type AiProviderId = 'anthropic' | 'openai';

export interface AiProviderAuthField {
  key: string;
  label: string;
  placeholder: string;
}

export interface AiProviderMeta {
  id: AiProviderId;
  displayName: string;
  defaultModel: string;
  getApiKeyUrl: string;
  auth: {
    fields: AiProviderAuthField[];
    validate: (credentials: Record<string, string>) => Promise<boolean>;
  };
}

const AI_PROVIDERS: Record<AiProviderId, AiProviderMeta> = {
  anthropic: {
    id: 'anthropic',
    displayName: 'Anthropic (Claude)',
    defaultModel: 'claude-sonnet-4-5-20250929',
    getApiKeyUrl: 'https://console.anthropic.com/settings/keys',
    auth: {
      fields: [{ key: 'apiKey', label: 'API Key', placeholder: 'sk-ant-...' }],
      validate: async (creds) => {
        try {
          const res = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: {
              'x-api-key': creds.apiKey,
              'anthropic-version': '2023-06-01',
              'content-type': 'application/json',
            },
            body: JSON.stringify({
              model: 'claude-haiku-4-5-20251001',
              max_tokens: 1,
              messages: [{ role: 'user', content: 'hi' }],
            }),
          });
          return res.ok;
        } catch {
          return false;
        }
      },
    },
  },

  openai: {
    id: 'openai',
    displayName: 'OpenAI',
    defaultModel: 'gpt-4o',
    getApiKeyUrl: 'https://platform.openai.com/api-keys',
    auth: {
      fields: [{ key: 'apiKey', label: 'API Key', placeholder: 'sk-...' }],
      validate: async (creds) => {
        try {
          const res = await fetch('https://api.openai.com/v1/models', {
            headers: { Authorization: `Bearer ${creds.apiKey}` },
          });
          return res.ok;
        } catch {
          return false;
        }
      },
    },
  },
};

export function getAiProviderMeta(id: AiProviderId): AiProviderMeta {
  const meta = AI_PROVIDERS[id];
  if (!meta) throw new Error(`Unknown AI provider: ${id}`);
  return meta;
}

export function getAllAiProviderMeta(): AiProviderMeta[] {
  return Object.values(AI_PROVIDERS);
}

export function getAiProviderIds(): AiProviderId[] {
  return Object.keys(AI_PROVIDERS) as AiProviderId[];
}

export function isValidAiProviderId(id: string): id is AiProviderId {
  return id in AI_PROVIDERS;
}

export async function validateAiProviderCredentials(
  providerId: AiProviderId,
  credentials: Record<string, string>
): Promise<boolean> {
  const meta = getAiProviderMeta(providerId);
  try {
    return await meta.auth.validate(credentials);
  } catch (error) {
    logger.warn('AI provider credential validation failed', {
      provider: providerId,
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}
