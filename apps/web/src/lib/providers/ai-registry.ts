/**
 * Declarative AI (LLM) provider registry — capabilities, auth config, and
 * validation functions for every supported BYOK AI provider.
 * Parallel to tts-registry.ts for TTS providers.
 *
 * Model pricing is sourced from the `pricetoken` package (static offline data)
 * rather than hardcoded — see hydratePricingFromPricetoken() below.
 */
import { STATIC_PRICING, type ModelPricing as PricetokenModelPricing } from 'pricetoken';
import { logger } from '../logger';
import { getAgentModelDisplayName, getAgentProviderForModelId } from '../agent-models/id';

// ---------------------------------------------------------------------------
// Pricetoken lookup — static offline pricing for 36+ models
// ---------------------------------------------------------------------------

const pricetokenByModelId = new Map<string, PricetokenModelPricing>();
for (const entry of STATIC_PRICING) {
  pricetokenByModelId.set(entry.modelId, entry);
}

/**
 * Look up pricing metadata from pricetoken's static catalog.
 * Use this for pricing/admin display — NOT for model selection or routing.
 * Returns null if the model is not in pricetoken's catalog.
 */
export function getPricetokenModelInfo(modelId: string): {
  displayName: string;
  provider: string;
  inputPerMTok: number;
  outputPerMTok: number;
  contextWindow: number | null;
  maxOutputTokens: number | null;
} | null {
  const entry = pricetokenByModelId.get(modelId);
  if (!entry) return null;
  return {
    displayName: entry.displayName,
    provider: entry.provider,
    inputPerMTok: entry.inputPerMTok,
    outputPerMTok: entry.outputPerMTok,
    contextWindow: entry.contextWindow,
    maxOutputTokens: entry.maxOutputTokens,
  };
}

export type AiProviderId =
  | 'anthropic'
  | 'openai'
  | 'google'
  | 'claude-code'
  | 'codex'
  | 'local'
  | 'together'
  | 'deepgram'
  | 'assemblyai'
  | 'groq'
  | 'gladia'
  | 'speechmatics'
  | 'xai'
  | 'deepseek'
  | 'mistral'
  | 'nvidia';

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
      {
        id: 'claude-haiku-4-5-20251001',
        displayName: 'Claude Haiku 4.5',
        shortDisplayName: 'Haiku 4.5',
        tier: 'fast',
        contextWindow: 200_000,
        maxOutputTokens: 64_000,
      },
      {
        id: 'claude-sonnet-4-6',
        displayName: 'Claude Sonnet 4.6',
        shortDisplayName: 'Sonnet 4.6',
        tier: 'balanced',
        contextWindow: 200_000,
        maxOutputTokens: 64_000,
      },
      {
        id: 'claude-opus-4-6',
        displayName: 'Claude Opus 4.6',
        shortDisplayName: 'Opus 4.6',
        tier: 'best',
        contextWindow: 200_000,
        maxOutputTokens: 128_000,
      },
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
    defaultModel: 'gpt-5.4',
    getApiKeyUrl: 'https://platform.openai.com/api-keys',
    models: [
      {
        id: 'gpt-5-nano',
        displayName: 'GPT-5 Nano',
        shortDisplayName: '5 Nano',
        tier: 'fast',
        contextWindow: 400_000,
        maxOutputTokens: 128_000,
        isReasoning: true,
      },
      {
        id: 'gpt-5-mini',
        displayName: 'GPT-5 Mini',
        shortDisplayName: '5 Mini',
        tier: 'fast',
        contextWindow: 400_000,
        maxOutputTokens: 128_000,
        isReasoning: true,
      },
      {
        id: 'gpt-5',
        displayName: 'GPT-5',
        shortDisplayName: '5',
        tier: 'balanced',
        contextWindow: 400_000,
        maxOutputTokens: 128_000,
        isReasoning: true,
      },
      {
        id: 'gpt-5.2',
        displayName: 'GPT-5.2',
        shortDisplayName: '5.2',
        tier: 'best',
        contextWindow: 400_000,
        maxOutputTokens: 128_000,
        isReasoning: true,
      },
      {
        id: 'gpt-5.4-nano',
        displayName: 'GPT-5.4 Nano',
        shortDisplayName: '5.4 Nano',
        tier: 'fast',
        contextWindow: 400_000,
        maxOutputTokens: 128_000,
        isReasoning: true,
      },
      {
        id: 'gpt-5.4-mini',
        displayName: 'GPT-5.4 Mini',
        shortDisplayName: '5.4 Mini',
        tier: 'fast',
        contextWindow: 400_000,
        maxOutputTokens: 128_000,
        isReasoning: true,
      },
      {
        id: 'gpt-5.4',
        displayName: 'GPT-5.4',
        shortDisplayName: '5.4',
        tier: 'balanced',
        contextWindow: 1_050_000,
        maxOutputTokens: 128_000,
        isReasoning: true,
      },
      {
        id: 'gpt-5.4-pro',
        displayName: 'GPT-5.4 Pro',
        shortDisplayName: '5.4 Pro',
        tier: 'best',
        contextWindow: 1_050_000,
        maxOutputTokens: 128_000,
        isReasoning: true,
      },
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
      {
        id: 'haiku',
        displayName: 'Haiku',
        shortDisplayName: 'Haiku 4.5',
        tier: 'fast',
        contextWindow: 200_000,
        maxOutputTokens: 64_000,
      },
      {
        id: 'sonnet',
        displayName: 'Sonnet',
        shortDisplayName: 'Sonnet 4.6',
        tier: 'balanced',
        contextWindow: 200_000,
        maxOutputTokens: 64_000,
      },
      {
        id: 'opus',
        displayName: 'Opus',
        shortDisplayName: 'Opus 4.6',
        tier: 'best',
        contextWindow: 200_000,
        maxOutputTokens: 128_000,
      },
    ],
    auth: {
      fields: [],
      validate: async () => true,
    },
  },

  // Codex CLI — like claude-code, a keyless system-linked agent. Routes through
  // `codex exec` (read-only sandbox); excluded from the BYOK client DTO and
  // surfaced separately as a system-linked provider when the `codex` CLI exists.
  codex: {
    id: 'codex',
    displayName: 'Codex (CLI)',
    shortLabel: 'Codex',
    defaultModel: 'codex',
    getApiKeyUrl: '',
    models: [],
    auth: {
      fields: [],
      validate: async () => true,
    },
  },

  // Local OpenAI-compatible inference (Ollama / vLLM / LM Studio). Keyless and
  // server-configured: the model is whatever the local server serves, supplied
  // via AI_MODEL and routed by the "local:" model prefix (see resolveLearningAi +
  // the llm.ts guardrail). Like claude-code, it carries no API-key fields and is
  // excluded from the BYOK client metadata.
  local: {
    id: 'local',
    displayName: 'Local model (Ollama / vLLM / LM Studio)',
    shortLabel: 'Local',
    defaultModel: '',
    getApiKeyUrl: '',
    models: [],
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

  // Groq — OpenAI-compatible LLM gateway (fastest TPS). Also serves Whisper STT
  // (routed via stt.ts). One key/registry entry serves both.
  groq: {
    id: 'groq',
    displayName: 'Groq',
    shortLabel: 'Groq',
    platformEnvKey: 'GROQ_API_KEY',
    defaultModel: 'llama-3.1-8b-instant',
    getApiKeyUrl: 'https://console.groq.com/keys',
    models: [
      {
        id: 'llama-3.1-8b-instant',
        displayName: 'Llama 3.1 8B Instant',
        shortDisplayName: 'Llama 8B',
        tier: 'fast',
        contextWindow: 131_072,
        maxOutputTokens: 131_072,
        pricing: { inputPerMTok: 0.05, outputPerMTok: 0.08 },
      },
      {
        id: 'llama-3.3-70b-versatile',
        displayName: 'Llama 3.3 70B Versatile',
        shortDisplayName: 'Llama 70B',
        tier: 'balanced',
        contextWindow: 131_072,
        maxOutputTokens: 32_768,
        pricing: { inputPerMTok: 0.59, outputPerMTok: 0.79 },
      },
      {
        id: 'openai/gpt-oss-120b',
        displayName: 'GPT-OSS 120B',
        shortDisplayName: 'GPT-OSS 120B',
        tier: 'best',
        contextWindow: 131_072,
        maxOutputTokens: 65_536,
        isReasoning: true,
        pricing: { inputPerMTok: 0.15, outputPerMTok: 0.6 },
      },
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

  // xAI Grok — OpenAI-compatible. Stable `grok-4` alias tracks the latest Grok 4.
  xai: {
    id: 'xai',
    displayName: 'xAI (Grok)',
    shortLabel: 'Grok',
    platformEnvKey: 'XAI_API_KEY',
    defaultModel: 'grok-4-fast',
    getApiKeyUrl: 'https://console.x.ai/',
    models: [
      {
        id: 'grok-4-fast',
        displayName: 'Grok 4 Fast',
        shortDisplayName: 'Grok 4 Fast',
        tier: 'balanced',
        contextWindow: 1_000_000,
        maxOutputTokens: 32_768,
        pricing: { inputPerMTok: 1.25, outputPerMTok: 2.5 },
      },
      {
        id: 'grok-4',
        displayName: 'Grok 4',
        shortDisplayName: 'Grok 4',
        tier: 'best',
        contextWindow: 1_000_000,
        maxOutputTokens: 32_768,
        isReasoning: true,
        pricing: { inputPerMTok: 1.25, outputPerMTok: 2.5 },
      },
    ],
    auth: {
      fields: [{ key: 'apiKey', label: 'API Key', placeholder: 'xai-...' }],
      validate: async (creds) => {
        try {
          const res = await fetch('https://api.x.ai/v1/models', {
            headers: { Authorization: `Bearer ${creds.apiKey}` },
          });
          return res.ok;
        } catch {
          return false;
        }
      },
    },
  },

  // DeepSeek — OpenAI-compatible. V4 family; ~1/10 the cost of frontier models.
  deepseek: {
    id: 'deepseek',
    displayName: 'DeepSeek',
    shortLabel: 'DeepSeek',
    platformEnvKey: 'DEEPSEEK_API_KEY',
    defaultModel: 'deepseek-v4-flash',
    getApiKeyUrl: 'https://platform.deepseek.com/api_keys',
    models: [
      {
        id: 'deepseek-v4-flash',
        displayName: 'DeepSeek V4 Flash',
        shortDisplayName: 'V4 Flash',
        tier: 'balanced',
        contextWindow: 1_000_000,
        maxOutputTokens: 65_536,
        pricing: { inputPerMTok: 0.14, outputPerMTok: 0.28 },
      },
      {
        id: 'deepseek-v4-pro',
        displayName: 'DeepSeek V4 Pro',
        shortDisplayName: 'V4 Pro',
        tier: 'best',
        contextWindow: 1_000_000,
        maxOutputTokens: 65_536,
        isReasoning: true,
        pricing: { inputPerMTok: 0.435, outputPerMTok: 0.87 },
      },
    ],
    auth: {
      fields: [{ key: 'apiKey', label: 'API Key', placeholder: 'sk-...' }],
      validate: async (creds) => {
        try {
          const res = await fetch('https://api.deepseek.com/v1/models', {
            headers: { Authorization: `Bearer ${creds.apiKey}` },
          });
          return res.ok;
        } catch {
          return false;
        }
      },
    },
  },

  // Mistral — OpenAI-compatible chat. `-latest` aliases track stable releases.
  mistral: {
    id: 'mistral',
    displayName: 'Mistral',
    shortLabel: 'Mistral',
    platformEnvKey: 'MISTRAL_API_KEY',
    defaultModel: 'mistral-small-latest',
    getApiKeyUrl: 'https://console.mistral.ai/api-keys',
    models: [
      {
        id: 'mistral-small-latest',
        displayName: 'Mistral Small',
        shortDisplayName: 'Small',
        tier: 'fast',
        contextWindow: 128_000,
        maxOutputTokens: 16_384,
        pricing: { inputPerMTok: 0.15, outputPerMTok: 0.6 },
      },
      {
        id: 'mistral-medium-latest',
        displayName: 'Mistral Medium',
        shortDisplayName: 'Medium',
        tier: 'balanced',
        contextWindow: 131_072,
        maxOutputTokens: 16_384,
        pricing: { inputPerMTok: 0.4, outputPerMTok: 2.0 },
      },
      {
        id: 'mistral-large-latest',
        displayName: 'Mistral Large',
        shortDisplayName: 'Large',
        tier: 'best',
        contextWindow: 256_000,
        maxOutputTokens: 32_768,
        pricing: { inputPerMTok: 0.5, outputPerMTok: 1.5 },
      },
    ],
    auth: {
      fields: [{ key: 'apiKey', label: 'API Key', placeholder: 'Your Mistral API key' }],
      validate: async (creds) => {
        try {
          const res = await fetch('https://api.mistral.ai/v1/models', {
            headers: { Authorization: `Bearer ${creds.apiKey}` },
          });
          return res.ok;
        } catch {
          return false;
        }
      },
    },
  },

  // NVIDIA NIM — OpenAI-compatible hosted models (Nemotron). Keys prefixed nvapi-.
  nvidia: {
    id: 'nvidia',
    displayName: 'NVIDIA NIM',
    shortLabel: 'NVIDIA',
    platformEnvKey: 'NVIDIA_API_KEY',
    defaultModel: 'nvidia/llama-3.3-nemotron-super-49b-v1',
    getApiKeyUrl: 'https://build.nvidia.com/',
    models: [
      {
        id: 'nvidia/llama-3.3-nemotron-super-49b-v1',
        displayName: 'Nemotron Super 49B',
        shortDisplayName: 'Nemotron 49B',
        tier: 'balanced',
        contextWindow: 131_072,
        maxOutputTokens: 65_536,
        isReasoning: true,
      },
      {
        id: 'nvidia/llama-3.1-nemotron-ultra-253b-v1',
        displayName: 'Nemotron Ultra 253B',
        shortDisplayName: 'Nemotron 253B',
        tier: 'best',
        contextWindow: 131_072,
        maxOutputTokens: 32_768,
        isReasoning: true,
      },
    ],
    auth: {
      fields: [{ key: 'apiKey', label: 'API Key', placeholder: 'nvapi-...' }],
      validate: async (creds) => {
        try {
          const res = await fetch('https://integrate.api.nvidia.com/v1/models', {
            headers: { Authorization: `Bearer ${creds.apiKey}` },
          });
          return res.ok;
        } catch {
          return false;
        }
      },
    },
  },

  gladia: {
    id: 'gladia',
    displayName: 'Gladia (STT)',
    shortLabel: 'Gladia',
    defaultModel: '',
    getApiKeyUrl: 'https://app.gladia.io/',
    models: [],
    auth: {
      fields: [{ key: 'apiKey', label: 'API Key', placeholder: '' }],
      validate: async (creds) => {
        try {
          const res = await fetch('https://api.gladia.io/v2/pre-recorded', {
            headers: { 'x-gladia-key': creds.apiKey },
          });
          return res.ok;
        } catch {
          return false;
        }
      },
    },
  },

  speechmatics: {
    id: 'speechmatics',
    displayName: 'Speechmatics (STT)',
    shortLabel: 'Speechmatics',
    defaultModel: '',
    getApiKeyUrl: 'https://portal.speechmatics.com/',
    models: [],
    auth: {
      fields: [{ key: 'apiKey', label: 'API Key', placeholder: '' }],
      validate: async (creds) => {
        try {
          const res = await fetch('https://eu1.asr.api.speechmatics.com/v2/jobs', {
            headers: { Authorization: `Bearer ${creds.apiKey}` },
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
      {
        id: 'gemini-3.1-flash-lite-preview',
        displayName: 'Gemini 3.1 Flash Lite',
        shortDisplayName: 'Flash Lite 3.1',
        tier: 'fast',
        contextWindow: 1_000_000,
        maxOutputTokens: 64_000,
      },
      {
        id: 'gemini-3.1-pro-preview',
        displayName: 'Gemini 3.1 Pro',
        shortDisplayName: 'Pro 3.1',
        tier: 'balanced',
        contextWindow: 1_000_000,
        maxOutputTokens: 64_000,
      },
    ],
    auth: {
      fields: [{ key: 'apiKey', label: 'API Key', placeholder: 'AIza...' }],
      validate: async (creds) => {
        try {
          const res = await fetch(
            'https://generativelanguage.googleapis.com/v1beta/openai/models',
            {
              headers: { Authorization: `Bearer ${creds.apiKey}` },
            }
          );
          return res.ok;
        } catch {
          return false;
        }
      },
    },
  },
};

// ---------------------------------------------------------------------------
// Hydrate pricing from pricetoken — runs once at module load
// ---------------------------------------------------------------------------

for (const provider of Object.values(AI_PROVIDERS)) {
  for (const model of provider.models) {
    const pt = pricetokenByModelId.get(model.id);
    if (pt) {
      model.pricing = { inputPerMTok: pt.inputPerMTok, outputPerMTok: pt.outputPerMTok };
    }
  }
}
// gemini-3.1-flash-lite-preview is not in pricetoken's catalog (preview model)
const flashLite = AI_PROVIDERS.google.models.find((m) => m.id === 'gemini-3.1-flash-lite-preview');
if (flashLite && !flashLite.pricing) {
  flashLite.pricing = { inputPerMTok: 0.25, outputPerMTok: 1.5 };
}

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
  return getAiProviderIds().filter((id) => AI_PROVIDERS[id].models.some((m) => m.pricing));
}

export function isValidAiProviderId(id: string): id is AiProviderId {
  return id in AI_PROVIDERS;
}

/**
 * Get the display name for a model ID (e.g. 'claude-sonnet-4-6' → 'Claude Sonnet 4.6').
 * Returns the raw ID if no match is found.
 */
export function getAiModelDisplayName(modelId: string): string {
  const agentLabel = getAgentModelDisplayName(modelId);
  if (agentLabel) return agentLabel;
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
  id: Exclude<AiProviderId, 'claude-code' | 'codex' | 'local'>;
  displayName: string;
  getApiKeyUrl: string;
  models: AiModelOption[];
  authFields: AiProviderAuthField[];
  description: string;
  badge: 'optional' | 'free' | null;
}

const AI_CLIENT_DESCRIPTIONS: Record<
  Exclude<AiProviderId, 'claude-code' | 'codex' | 'local'>,
  { description: string; badge: 'optional' | 'free' | null }
> = {
  anthropic: { description: 'Better script generation and creative writing', badge: 'optional' },
  openai: { description: 'Covers both LLM and TTS with one key', badge: 'optional' },
  google: { description: 'Gemini models with 1M context window', badge: 'optional' },
  together: { description: 'Cheap Whisper STT at $0.0015/min', badge: 'optional' },
  deepgram: { description: 'Nova-3 STT — high accuracy with $200 free credits', badge: 'optional' },
  assemblyai: {
    description: 'Universal-2 STT — 99 languages with $50 free credits',
    badge: 'optional',
  },
  groq: {
    description: 'Fastest inference — Llama & GPT-OSS LLMs, plus Whisper STT',
    badge: 'optional',
  },
  gladia: {
    description: 'Solaria STT — 140 languages with accurate word timings',
    badge: 'optional',
  },
  speechmatics: {
    description: 'Enhanced STT — enterprise accuracy across 80+ languages',
    badge: 'optional',
  },
  xai: { description: 'Grok 4 with a 1M-token context window', badge: 'optional' },
  deepseek: { description: 'DeepSeek V4 — frontier quality at ~1/10 the cost', badge: 'optional' },
  mistral: { description: 'Mistral Small/Medium/Large open-weight LLMs', badge: 'optional' },
  nvidia: { description: 'NVIDIA NIM — hosted Nemotron reasoning models', badge: 'optional' },
};

/**
 * Returns serializable provider metadata for client components.
 * Strips `validate()`, filters out `claude-code` (not user-facing).
 * Called server-side only — client components receive this as props.
 */
export function getAllAiProviderClientMeta(): AiProviderClientMeta[] {
  return Object.values(AI_PROVIDERS)
    .filter(
      (p): p is AiProviderMeta & { id: Exclude<AiProviderId, 'claude-code' | 'codex' | 'local'> } =>
        p.id !== 'claude-code' && p.id !== 'codex' && p.id !== 'local'
    )
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
  const agentProvider = getAgentProviderForModelId(modelId);
  if (agentProvider) return agentProvider;
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
 * Providers that execute through local/server infrastructure rather than a
 * user-provided hosted API key.
 */
export function providerRequiresAiKey(providerId: string | null | undefined): boolean {
  return providerId !== 'claude-code' && providerId !== 'codex' && providerId !== 'local';
}

/**
 * Resolve the AI model and its owning provider, keeping them in sync.
 *
 * Priority:
 * 1. episode.aiModel (user's explicit choice) → look up provider from registry. Throws if unknown.
 * 2. BYOK key → provider default model
 *
 * Returns both `model` and `provider` so callers never mismatch them.
 */
export async function resolveAiModelAndProvider(opts: {
  episodeAiModel?: string | null;
  aiKey?: { provider: string; apiKey: string } | null;
}): Promise<{ model: string; provider: string }> {
  // 1. Episode-level model override — only use if the model is in the registry
  if (opts.episodeAiModel) {
    // Local OpenAI-compatible model (e.g. "local:qwen3") — routed by prefix, not
    // the registry, since the served model name is host-defined.
    if (opts.episodeAiModel.startsWith('local:')) {
      return { model: opts.episodeAiModel, provider: 'local' };
    }

    const owner = getProviderForModel(opts.episodeAiModel);
    if (owner) {
      return { model: opts.episodeAiModel, provider: owner };
    }
    throw new Error(
      `Unknown AI model "${opts.episodeAiModel}". Choose a registered model before generation.`
    );
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

  throw new Error('AI model is required when no AI key is configured.');
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
