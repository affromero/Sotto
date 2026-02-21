/**
 * Declarative AI (LLM) provider registry — capabilities, auth config, and
 * validation functions for every supported BYOK AI provider.
 * Parallel to tts-registry.ts for TTS providers.
 */
import { logger } from '../logger';

export type AiProviderId = 'anthropic' | 'openai' | 'groq' | 'claude-code';

export interface AiProviderAuthField {
  key: string;
  label: string;
  placeholder: string;
}

export interface AiModelOption {
  id: string;
  displayName: string;
  tier: 'fast' | 'balanced' | 'best';
}

export interface AiProviderMeta {
  id: AiProviderId;
  displayName: string;
  defaultModel: string;
  getApiKeyUrl: string;
  models: AiModelOption[];
  auth: {
    fields: AiProviderAuthField[];
    validate: (credentials: Record<string, string>) => Promise<boolean>;
  };
}

const AI_PROVIDERS: Record<AiProviderId, AiProviderMeta> = {
  anthropic: {
    id: 'anthropic',
    displayName: 'Anthropic (Claude)',
    defaultModel: 'claude-haiku-4-5-20251001',
    getApiKeyUrl: 'https://console.anthropic.com/settings/keys',
    models: [
      { id: 'claude-haiku-4-5-20251001', displayName: 'Claude Haiku 4.5', tier: 'fast' },
      { id: 'claude-sonnet-4-6', displayName: 'Claude Sonnet 4.6', tier: 'balanced' },
      { id: 'claude-opus-4-6', displayName: 'Claude Opus 4.6', tier: 'best' },
    ],
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
    defaultModel: 'gpt-5',
    getApiKeyUrl: 'https://platform.openai.com/api-keys',
    models: [
      { id: 'gpt-5-mini', displayName: 'GPT-5 Mini', tier: 'fast' },
      { id: 'gpt-5', displayName: 'GPT-5', tier: 'balanced' },
      { id: 'gpt-5.2', displayName: 'GPT-5.2', tier: 'best' },
    ],
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

  groq: {
    id: 'groq',
    displayName: 'Groq',
    defaultModel: 'llama-3.3-70b-versatile',
    getApiKeyUrl: 'https://console.groq.com/keys',
    models: [
      { id: 'llama-3.1-8b-instant', displayName: 'Llama 3.1 8B (Fast)', tier: 'fast' },
      { id: 'llama-3.3-70b-versatile', displayName: 'Llama 3.3 70B (Best)', tier: 'best' },
    ],
    auth: {
      fields: [{ key: 'apiKey', label: 'API Key', placeholder: 'gsk_...' }],
      validate: async (creds) => {
        try {
          const res = await fetch('https://api.groq.com/openai/v1/models', {
            headers: { Authorization: `Bearer ${creds.apiKey}` },
          });
          return res.ok;
        } catch {
          return false;
        }
      },
    },
  },

  'claude-code': {
    id: 'claude-code',
    displayName: 'Claude Code (CLI)',
    defaultModel: 'opus',
    getApiKeyUrl: '',
    models: [
      { id: 'haiku', displayName: 'Haiku', tier: 'fast' },
      { id: 'sonnet', displayName: 'Sonnet', tier: 'balanced' },
      { id: 'opus', displayName: 'Opus', tier: 'best' },
    ],
    auth: {
      fields: [],
      validate: async () => true,
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

/**
 * Get the display name for a model ID (e.g. 'claude-sonnet-4-6' → 'Claude Sonnet 4.6').
 * Returns the raw ID if no match is found.
 */
export function getAiModelDisplayName(modelId: string): string {
  for (const provider of Object.values(AI_PROVIDERS)) {
    const model = provider.models.find((m) => m.id === modelId);
    if (model) return model.displayName;
  }
  return modelId;
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
