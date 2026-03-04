/**
 * Declarative AI (LLM) provider registry — capabilities, auth config, and
 * validation functions for every supported BYOK AI provider.
 * Parallel to tts-registry.ts for TTS providers.
 */
import { logger } from '../logger';

export type AiProviderId = 'anthropic' | 'openai' | 'google' | 'claude-code' | 'together' | 'deepgram' | 'assemblyai';

export interface AiProviderAuthField {
  key: string;
  label: string;
  placeholder: string;
}

export interface AiModelOption {
  id: string;
  displayName: string;
  /** Short name without provider prefix, e.g. 'Haiku 4.5', '5 Mini'. */
  shortDisplayName: string;
  tier: 'fast' | 'balanced' | 'best' | 'max';
  /** Minimum plan required to use this model on platform credits (BYOK bypasses). */
  requiredPlan: 'FREE' | 'PRO';
  /** Maximum input context window in tokens. */
  contextWindow: number;
  /** Maximum output tokens the model can generate. */
  maxOutputTokens: number;
  /** Per-million-token pricing. Omit for zero-cost or non-metered models. */
  pricing?: { inputPerMTok: number; outputPerMTok: number };
  /**
   * Whether this model uses internal reasoning/thinking tokens that consume
   * part of max_completion_tokens before producing visible output.
   * When true, providers auto-boost the token budget so reasoning doesn't
   * starve the visible output.
   */
  isReasoning?: boolean;
}

export interface AiProviderMeta {
  id: AiProviderId;
  displayName: string;
  /** Short label for badges, e.g. 'Claude', 'GPT'. */
  shortLabel: string;
  /** Env var name for the platform API key, e.g. 'ANTHROPIC_API_KEY'. Omit for STT-only or local-CLI providers. */
  platformEnvKey?: string;
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
    shortLabel: 'Claude',
    platformEnvKey: 'ANTHROPIC_API_KEY',
    defaultModel: 'claude-haiku-4-5-20251001',
    getApiKeyUrl: 'https://console.anthropic.com/settings/keys',
    models: [
      { id: 'claude-haiku-4-5-20251001', displayName: 'Claude Haiku 4.5', shortDisplayName: 'Haiku 4.5', tier: 'fast', requiredPlan: 'FREE', contextWindow: 200_000, maxOutputTokens: 64_000, pricing: { inputPerMTok: 1.0, outputPerMTok: 5.0 } },
      { id: 'claude-sonnet-4-6', displayName: 'Claude Sonnet 4.6', shortDisplayName: 'Sonnet 4.6', tier: 'balanced', requiredPlan: 'PRO', contextWindow: 200_000, maxOutputTokens: 64_000, pricing: { inputPerMTok: 3.0, outputPerMTok: 15.0 } },
      { id: 'claude-opus-4-6', displayName: 'Claude Opus 4.6', shortDisplayName: 'Opus 4.6', tier: 'best', requiredPlan: 'PRO', contextWindow: 200_000, maxOutputTokens: 128_000, pricing: { inputPerMTok: 5.0, outputPerMTok: 25.0 } },
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
    shortLabel: 'GPT',
    platformEnvKey: 'OPENAI_API_KEY',
    defaultModel: 'gpt-5',
    getApiKeyUrl: 'https://platform.openai.com/api-keys',
    models: [
      { id: 'gpt-5-nano', displayName: 'GPT-5 Nano', shortDisplayName: '5 Nano', tier: 'fast', requiredPlan: 'FREE', contextWindow: 400_000, maxOutputTokens: 128_000, isReasoning: true, pricing: { inputPerMTok: 0.05, outputPerMTok: 0.40 } },
      { id: 'gpt-5-mini', displayName: 'GPT-5 Mini', shortDisplayName: '5 Mini', tier: 'fast', requiredPlan: 'FREE', contextWindow: 400_000, maxOutputTokens: 128_000, isReasoning: true, pricing: { inputPerMTok: 0.25, outputPerMTok: 2.0 } },
      { id: 'gpt-5', displayName: 'GPT-5', shortDisplayName: '5', tier: 'balanced', requiredPlan: 'PRO', contextWindow: 400_000, maxOutputTokens: 128_000, isReasoning: true, pricing: { inputPerMTok: 1.25, outputPerMTok: 10.0 } },
      { id: 'gpt-5.2', displayName: 'GPT-5.2', shortDisplayName: '5.2', tier: 'best', requiredPlan: 'PRO', contextWindow: 400_000, maxOutputTokens: 128_000, isReasoning: true, pricing: { inputPerMTok: 1.75, outputPerMTok: 14.0 } },
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

  'claude-code': {
    id: 'claude-code',
    displayName: 'Claude Code (CLI)',
    shortLabel: 'Claude',
    defaultModel: 'opus',
    getApiKeyUrl: '',
    models: [
      { id: 'haiku', displayName: 'Haiku', shortDisplayName: 'Haiku 4.5', tier: 'fast', requiredPlan: 'FREE', contextWindow: 200_000, maxOutputTokens: 64_000 },
      { id: 'sonnet', displayName: 'Sonnet', shortDisplayName: 'Sonnet 4.6', tier: 'balanced', requiredPlan: 'PRO', contextWindow: 200_000, maxOutputTokens: 64_000 },
      { id: 'opus', displayName: 'Opus', shortDisplayName: 'Opus 4.6', tier: 'best', requiredPlan: 'PRO', contextWindow: 200_000, maxOutputTokens: 128_000 },
    ],
    auth: {
      fields: [],
      validate: async () => true,
    },
  },

  together: {
    id: 'together',
    displayName: 'Together AI',
    shortLabel: 'Together',
    defaultModel: '',
    getApiKeyUrl: 'https://api.together.xyz/settings/api-keys',
    models: [],
    auth: {
      fields: [{ key: 'apiKey', label: 'API Key', placeholder: '' }],
      validate: async (creds) => {
        try {
          const res = await fetch('https://api.together.xyz/v1/models', {
            headers: { Authorization: `Bearer ${creds.apiKey}` },
          });
          return res.ok;
        } catch {
          return false;
        }
      },
    },
  },

  deepgram: {
    id: 'deepgram',
    displayName: 'Deepgram (STT)',
    shortLabel: 'Deepgram',
    defaultModel: '',
    getApiKeyUrl: 'https://console.deepgram.com/',
    models: [],
    auth: {
      fields: [{ key: 'apiKey', label: 'API Key', placeholder: '' }],
      validate: async (creds) => {
        try {
          const res = await fetch('https://api.deepgram.com/v1/projects', {
            headers: { Authorization: `Token ${creds.apiKey}` },
          });
          return res.ok;
        } catch {
          return false;
        }
      },
    },
  },

  assemblyai: {
    id: 'assemblyai',
    displayName: 'AssemblyAI (STT)',
    shortLabel: 'AssemblyAI',
    defaultModel: '',
    getApiKeyUrl: 'https://www.assemblyai.com/app',
    models: [],
    auth: {
      fields: [{ key: 'apiKey', label: 'API Key', placeholder: '' }],
      validate: async (creds) => {
        try {
          const res = await fetch('https://api.assemblyai.com/v2/transcript?limit=1', {
            headers: { authorization: creds.apiKey },
          });
          return res.ok;
        } catch {
          return false;
        }
      },
    },
  },

  google: {
    id: 'google',
    displayName: 'Google (Gemini)',
    shortLabel: 'Gemini',
    platformEnvKey: 'GOOGLE_AI_API_KEY',
    defaultModel: 'gemini-3.1-flash-lite-preview',
    getApiKeyUrl: 'https://aistudio.google.com/apikey',
    models: [
      { id: 'gemini-3.1-flash-lite-preview', displayName: 'Gemini 3.1 Flash Lite', shortDisplayName: 'Flash Lite 3.1', tier: 'fast', requiredPlan: 'FREE', contextWindow: 1_000_000, maxOutputTokens: 64_000, pricing: { inputPerMTok: 0.25, outputPerMTok: 1.50 } },
      { id: 'gemini-3.1-pro-preview', displayName: 'Gemini 3.1 Pro', shortDisplayName: 'Pro 3.1', tier: 'balanced', requiredPlan: 'PRO', contextWindow: 1_000_000, maxOutputTokens: 64_000, pricing: { inputPerMTok: 2.0, outputPerMTok: 12.0 } },
    ],
    auth: {
      fields: [{ key: 'apiKey', label: 'API Key', placeholder: 'AIza...' }],
      validate: async (creds) => {
        try {
          const res = await fetch('https://generativelanguage.googleapis.com/v1beta/openai/models', {
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

/**
 * Return the cheapest (fast-tier) model ID for a provider.
 * Falls back to the first model if no fast tier exists, or null if the provider
 * has no models at all (e.g. STT-only providers like deepgram/assemblyai).
 */
export function getCheapestModelForProvider(providerId: AiProviderId): string | null {
  const meta = AI_PROVIDERS[providerId];
  if (!meta || meta.models.length === 0) return null;
  const fast = meta.models.find((m) => m.tier === 'fast');
  return fast?.id ?? meta.models[0].id;
}

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

export function getAiProviderIdsWithPricing(): AiProviderId[] {
  return getAiProviderIds().filter(id =>
    AI_PROVIDERS[id].models.some(m => m.pricing)
  );
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

// ---------------------------------------------------------------------------
// Client-safe DTO — serializable subset of AiProviderMeta (no validate())
// ---------------------------------------------------------------------------

export interface AiProviderClientMeta {
  id: Exclude<AiProviderId, 'claude-code'>;
  displayName: string;
  getApiKeyUrl: string;
  models: AiModelOption[];
  authFields: AiProviderAuthField[];
  description: string;
  badge: 'optional' | 'free' | null;
}

const AI_CLIENT_DESCRIPTIONS: Record<Exclude<AiProviderId, 'claude-code'>, { description: string; badge: 'optional' | 'free' | null }> = {
  anthropic: { description: 'Better script generation and creative writing', badge: 'optional' },
  openai: { description: 'Covers both LLM and TTS with one key', badge: 'optional' },
  google: { description: 'Gemini models with 1M context window', badge: 'optional' },
  together: { description: 'Cheap Whisper STT at $0.0015/min', badge: 'optional' },
  deepgram: { description: 'Nova-3 STT — high accuracy with $200 free credits', badge: 'optional' },
  assemblyai: { description: 'Universal-2 STT — 99 languages with $50 free credits', badge: 'optional' },
};

/**
 * Returns serializable provider metadata for client components.
 * Strips `validate()`, filters out `claude-code` (not user-facing).
 * Called server-side only — client components receive this as props.
 */
export function getAllAiProviderClientMeta(): AiProviderClientMeta[] {
  return Object.values(AI_PROVIDERS)
    .filter((p): p is AiProviderMeta & { id: Exclude<AiProviderId, 'claude-code'> } => p.id !== 'claude-code')
    .map((p) => ({
      id: p.id,
      displayName: p.displayName,
      getApiKeyUrl: p.getApiKeyUrl,
      models: p.models,
      authFields: p.auth.fields,
      description: AI_CLIENT_DESCRIPTIONS[p.id].description,
      badge: AI_CLIENT_DESCRIPTIONS[p.id].badge,
    }));
}

/**
 * Check whether a model uses internal reasoning tokens that consume
 * part of max_completion_tokens before producing visible output.
 * Returns false for unknown models (safe default — no boost applied).
 */
export function isReasoningModel(modelId: string): boolean {
  for (const provider of Object.values(AI_PROVIDERS)) {
    const model = provider.models.find((m) => m.id === modelId);
    if (model) return !!model.isReasoning;
  }
  return false;
}

/**
 * Look up which provider owns a model ID.
 * e.g. 'gpt-5-mini' → 'openai', 'claude-sonnet-4-6' → 'anthropic'
 * Returns null if the model is not found in any provider.
 */
export function getProviderForModel(modelId: string): AiProviderId | null {
  for (const provider of Object.values(AI_PROVIDERS)) {
    if (provider.models.some((m) => m.id === modelId)) {
      return provider.id;
    }
  }
  return null;
}

/**
 * Check whether a model ID is registered with any known AI provider.
 */
export function isValidModelId(modelId: string): boolean {
  return getProviderForModel(modelId) !== null;
}

/**
 * Resolve the AI model and its owning provider, keeping them in sync.
 *
 * Priority:
 * 1. podcast.aiModel (user's explicit choice) → look up provider from registry
 * 2. BYOK key → provider default model
 * 3. Free tier admin config → aiAllocations[0] or aiModel
 *
 * Returns both `model` and `provider` so callers never mismatch them.
 */
export async function resolveAiModelAndProvider(opts: {
  podcastAiModel?: string | null;
  aiKey?: { provider: string; apiKey: string } | null;
  plan?: 'FREE' | 'PRO';
}): Promise<{ model: string; provider: string }> {
  const { resolveAutoModel } = await import('../auto-model-config');

  // 1. Podcast-level model override — only use if the model is in the registry
  if (opts.podcastAiModel) {
    const owner = getProviderForModel(opts.podcastAiModel);
    if (owner) {
      return { model: opts.podcastAiModel, provider: owner };
    }
    logger.warn('resolveAiModelAndProvider: unknown model, falling through', {
      model: opts.podcastAiModel,
    });
  }

  // 2. BYOK key → provider's default model
  if (opts.aiKey) {
    const providerId = opts.aiKey.provider as AiProviderId;
    if (isValidAiProviderId(providerId)) {
      return {
        model: getAiProviderMeta(providerId).defaultModel,
        provider: providerId,
      };
    }
  }

  // 3. Auto model config (plan-aware)
  const autoConfig = await resolveAutoModel(opts.plan ?? 'FREE');
  return {
    model: autoConfig.aiModel,
    provider: autoConfig.aiProvider,
  };
}

/**
 * Look up the minimum plan required for a model ID.
 * Returns null if the model is not found in any provider.
 */
export function getModelRequiredPlan(modelId: string): 'FREE' | 'PRO' | null {
  for (const provider of Object.values(AI_PROVIDERS)) {
    const model = provider.models.find((m) => m.id === modelId);
    if (model) return model.requiredPlan;
  }
  return null;
}

/**
 * Get the context window size for a model ID.
 * Returns null if the model is not found in any provider.
 */
export function getModelContextWindow(modelId: string): number | null {
  for (const provider of Object.values(AI_PROVIDERS)) {
    const model = provider.models.find((m) => m.id === modelId);
    if (model) return model.contextWindow;
  }
  return null;
}

/**
 * Get the max output tokens for a model ID.
 * Returns null if the model is not found in any provider.
 */
export function getModelMaxOutputTokens(modelId: string): number | null {
  for (const provider of Object.values(AI_PROVIDERS)) {
    const model = provider.models.find((m) => m.id === modelId);
    if (model) return model.maxOutputTokens;
  }
  return null;
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
