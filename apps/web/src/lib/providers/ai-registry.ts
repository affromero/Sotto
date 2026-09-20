import { aiCredentialForm } from '@/lib/providers/shared/credential-fields';
import { modelPresets, type ModelPreset } from 'thesidedoor-core/ai/catalog';
/**
 * Declarative AI (LLM) provider registry: capabilities, auth config, and
 * credential fields for every supported BYOK AI provider.
 * Parallel to tts-registry.ts for TTS providers.
 *
 * Model pricing is sourced from the `pricetoken` package (static offline data)
 * rather than hardcoded — see hydratePricingFromPricetoken() below.
 */
import { STATIC_PRICING, type ModelPricing as PricetokenModelPricing } from 'pricetoken';
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

export type AiModelOption = ModelPreset;

export interface AiProviderMeta {
  id: AiProviderId;
  displayName: string;
  /** Short label for badges, e.g. 'Claude', 'GPT'. */
  shortLabel: string;
  defaultModel: string;
  getApiKeyUrl: string;
  models: AiModelOption[];
  /** Provider features that Sotto's current transport can actually deliver. */
  capabilities?: { web: boolean; vision: boolean };
  auth: {
    fields: AiProviderAuthField[];
  };
}

const AI_PROVIDERS: Record<AiProviderId, AiProviderMeta> = {
  anthropic: {
    id: 'anthropic',
    displayName: 'Anthropic (Claude)',
    shortLabel: 'Claude',
    defaultModel: 'claude-haiku-4-5-20251001',
    getApiKeyUrl: aiCredentialForm('anthropic').getApiKeyUrl,
    models: modelPresets('anthropic'),
    auth: {
      fields: aiCredentialForm('anthropic').fields,
    },
  },

  openai: {
    id: 'openai',
    displayName: 'OpenAI',
    shortLabel: 'GPT',
    defaultModel: 'gpt-5.4',
    getApiKeyUrl: aiCredentialForm('openai').getApiKeyUrl,
    models: modelPresets('openai'),
    auth: {
      fields: aiCredentialForm('openai').fields,
    },
  },

  'claude-code': {
    id: 'claude-code',
    displayName: 'Claude Code (CLI)',
    shortLabel: 'Claude',
    defaultModel: 'opus',
    getApiKeyUrl: aiCredentialForm('claude-code').getApiKeyUrl,
    models: modelPresets('claude-code'),
    capabilities: { web: true, vision: true },
    auth: {
      fields: aiCredentialForm('claude-code').fields,
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
    getApiKeyUrl: aiCredentialForm('codex').getApiKeyUrl,
    models: modelPresets('codex'),
    capabilities: { web: true, vision: false },
    auth: {
      fields: aiCredentialForm('codex').fields,
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
    getApiKeyUrl: aiCredentialForm('local').getApiKeyUrl,
    models: modelPresets('local'),
    auth: {
      fields: aiCredentialForm('local').fields,
    },
  },

  together: {
    id: 'together',
    displayName: 'Together AI',
    shortLabel: 'Together',
    defaultModel: '',
    getApiKeyUrl: aiCredentialForm('together').getApiKeyUrl,
    models: modelPresets('together'),
    auth: {
      fields: aiCredentialForm('together').fields,
    },
  },

  deepgram: {
    id: 'deepgram',
    displayName: 'Deepgram (STT)',
    shortLabel: 'Deepgram',
    defaultModel: '',
    getApiKeyUrl: aiCredentialForm('deepgram').getApiKeyUrl,
    models: modelPresets('deepgram'),
    auth: {
      fields: aiCredentialForm('deepgram').fields,
    },
  },

  assemblyai: {
    id: 'assemblyai',
    displayName: 'AssemblyAI (STT)',
    shortLabel: 'AssemblyAI',
    defaultModel: '',
    getApiKeyUrl: aiCredentialForm('assemblyai').getApiKeyUrl,
    models: modelPresets('assemblyai'),
    auth: {
      fields: aiCredentialForm('assemblyai').fields,
    },
  },

  // Groq — OpenAI-compatible LLM gateway (fastest TPS). Also serves Whisper STT
  // (routed via stt.ts). One key/registry entry serves both.
  groq: {
    id: 'groq',
    displayName: 'Groq',
    shortLabel: 'Groq',
    defaultModel: 'llama-3.1-8b-instant',
    getApiKeyUrl: aiCredentialForm('groq').getApiKeyUrl,
    models: modelPresets('groq'),
    auth: {
      fields: aiCredentialForm('groq').fields,
    },
  },

  // xAI Grok — OpenAI-compatible. Stable `grok-4` alias tracks the latest Grok 4.
  xai: {
    id: 'xai',
    displayName: 'xAI (Grok)',
    shortLabel: 'Grok',
    defaultModel: 'grok-4-fast',
    getApiKeyUrl: aiCredentialForm('xai').getApiKeyUrl,
    models: modelPresets('xai'),
    auth: {
      fields: aiCredentialForm('xai').fields,
    },
  },

  // DeepSeek — OpenAI-compatible. V4 family; ~1/10 the cost of frontier models.
  deepseek: {
    id: 'deepseek',
    displayName: 'DeepSeek',
    shortLabel: 'DeepSeek',
    defaultModel: 'deepseek-v4-flash',
    getApiKeyUrl: aiCredentialForm('deepseek').getApiKeyUrl,
    models: modelPresets('deepseek'),
    auth: {
      fields: aiCredentialForm('deepseek').fields,
    },
  },

  // Mistral — OpenAI-compatible chat. `-latest` aliases track stable releases.
  mistral: {
    id: 'mistral',
    displayName: 'Mistral',
    shortLabel: 'Mistral',
    defaultModel: 'mistral-small-latest',
    getApiKeyUrl: aiCredentialForm('mistral').getApiKeyUrl,
    models: modelPresets('mistral'),
    auth: {
      fields: aiCredentialForm('mistral').fields,
    },
  },

  // NVIDIA NIM — OpenAI-compatible hosted models (Nemotron). Keys prefixed nvapi-.
  nvidia: {
    id: 'nvidia',
    displayName: 'NVIDIA NIM',
    shortLabel: 'NVIDIA',
    defaultModel: 'nvidia/llama-3.3-nemotron-super-49b-v1',
    getApiKeyUrl: aiCredentialForm('nvidia').getApiKeyUrl,
    models: modelPresets('nvidia'),
    auth: {
      fields: aiCredentialForm('nvidia').fields,
    },
  },

  gladia: {
    id: 'gladia',
    displayName: 'Gladia (STT)',
    shortLabel: 'Gladia',
    defaultModel: '',
    getApiKeyUrl: aiCredentialForm('gladia').getApiKeyUrl,
    models: modelPresets('gladia'),
    auth: {
      fields: aiCredentialForm('gladia').fields,
    },
  },

  speechmatics: {
    id: 'speechmatics',
    displayName: 'Speechmatics (STT)',
    shortLabel: 'Speechmatics',
    defaultModel: '',
    getApiKeyUrl: aiCredentialForm('speechmatics').getApiKeyUrl,
    models: modelPresets('speechmatics'),
    auth: {
      fields: aiCredentialForm('speechmatics').fields,
    },
  },

  google: {
    id: 'google',
    displayName: 'Google (Gemini)',
    shortLabel: 'Gemini',
    defaultModel: 'gemini-3.1-flash-lite-preview',
    getApiKeyUrl: aiCredentialForm('google').getApiKeyUrl,
    models: modelPresets('google'),
    auth: {
      fields: aiCredentialForm('google').fields,
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
  if (!isValidAiProviderId(id)) throw new Error(`Unknown AI provider: ${id}`);
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
  return Object.hasOwn(AI_PROVIDERS, id);
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
// Client-safe DTO — serializable subset of AiProviderMeta
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
 * Filters out `claude-code` (not user-facing).
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
