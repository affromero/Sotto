/**
 * Maps the welcome wizard's display provider IDs to the real backend registry /
 * infra IDs, and routes each captured key to the correct store. The wizard's
 * labels are NOT the registry IDs (e.g. "whisper" -> local STT, "assembly" ->
 * assemblyai, "claude"/"codex" -> anthropic/openai or the keyless claude-code
 * CLI), so this is the single source of truth for the translation.
 *
 * Pure functions, no I/O — unit-tested. The wizard calls these to decide which
 * keys to POST (to /api/v1/settings/ai-keys or /api/v1/settings/byok), which per-user
 * preferences to save, and — for the owner — which server-infra fields to set.
 *
 * No availability-based fallback: each result reflects exactly what the learner
 * selected. No secrets are embedded here.
 */

export type AiMethod = 'cli' | 'key' | 'url' | null;

/** A BYOK key to POST. `endpoint` selects the validated settings route. */
export interface KeyPost {
  endpoint: 'ai-keys' | 'byok';
  provider: string;
  apiKey: string;
}

export interface AiResolution {
  keyPost: KeyPost | null;
  preferredAiProvider: string | null;
  preferredAiModel: string | null;
  /** Owner server-infra (persisted only for the owner). */
  infra: { aiProvider?: string; aiBaseUrl?: string; aiModel?: string };
}

export interface TtsResolution {
  keyPost: KeyPost | null;
  preferredTtsProvider: string | null;
  infra: { ttsProvider?: string; ttsBaseUrl?: string };
}

export interface SttResolution {
  keyPost: KeyPost | null;
  infra: { sttProvider?: string; sttBaseUrl?: string };
}

export const DEFAULT_LOCAL_TTS_BASE_URL = 'http://localhost:8000';
export const DEFAULT_LOCAL_STT_BASE_URL = 'http://localhost:8001/v1';

function clean(v: string | undefined | null): string {
  return (v ?? '').trim();
}

/**
 * AI agent → backend.
 *   claude+key → BYOK anthropic;  codex+key → BYOK openai;  google+key → BYOK google
 *   *+cli      → keyless infra aiProvider=claude-code (the local-agent generation backend)
 *   local/custom+url → infra aiProvider=local (+ base URL, + model)
 */
export function resolveAi(
  provider: string,
  method: AiMethod,
  value: string,
  model: string
): AiResolution {
  const v = clean(value);
  const m = clean(model);

  if (method === 'key' && v) {
    const byokProvider =
      provider === 'claude' ? 'anthropic' : provider === 'google' ? 'google' : 'openai';
    return {
      keyPost: { endpoint: 'ai-keys', provider: byokProvider, apiKey: v },
      preferredAiProvider: byokProvider,
      preferredAiModel: null,
      infra: {},
    };
  }

  if (method === 'cli') {
    return {
      keyPost: null,
      preferredAiProvider: 'claude-code',
      preferredAiModel: null,
      infra: { aiProvider: 'claude-code' },
    };
  }

  if (method === 'url' && v) {
    return {
      keyPost: null,
      preferredAiProvider: 'local',
      preferredAiModel: m ? `local:${m}` : null,
      infra: { aiProvider: 'local', aiBaseUrl: v, ...(m && { aiModel: m }) },
    };
  }

  return { keyPost: null, preferredAiProvider: null, preferredAiModel: null, infra: {} };
}

/** Optional Google key used only to unlock Gemini Live translation. */
export function resolveLiveTranslateKey(apiKey: string): KeyPost | null {
  const key = clean(apiKey);
  return key ? { endpoint: 'ai-keys', provider: 'google', apiKey: key } : null;
}

/**
 * TTS → backend. The welcome TTS IDs already match TtsProviderId. Kokoro and
 * local are keyless local providers (infra + base URL); the rest take a BYOK key.
 */
export function resolveTts(ttsId: string, apiKey: string, baseUrl: string): TtsResolution {
  if (ttsId === 'kokoro' || ttsId === 'local') {
    const u = clean(baseUrl) || DEFAULT_LOCAL_TTS_BASE_URL;
    return {
      keyPost: null,
      preferredTtsProvider: ttsId,
      infra: { ttsProvider: ttsId, ...(u && { ttsBaseUrl: u }) },
    };
  }

  const key = clean(apiKey);
  return {
    keyPost: key ? { endpoint: 'byok', provider: ttsId, apiKey: key } : null,
    preferredTtsProvider: ttsId,
    infra: { ttsProvider: ttsId },
  };
}

/**
 * STT → backend. "whisper" and "local" are keyless local servers (infra + base URL);
 * "assembly" → assemblyai. ElevenLabs keys live in the TTS/BYOK store; every
 * other cloud STT key lives in the AI-key store (matching resolveSttProvider).
 */
export function resolveStt(sttId: string, apiKey: string, baseUrl: string): SttResolution {
  const resolvedId = sttId === 'whisper' ? 'local' : sttId === 'assembly' ? 'assemblyai' : sttId;

  if (resolvedId === 'local') {
    const u = clean(baseUrl) || DEFAULT_LOCAL_STT_BASE_URL;
    return { keyPost: null, infra: { sttProvider: 'local', ...(u && { sttBaseUrl: u }) } };
  }

  const key = clean(apiKey);
  const endpoint = resolvedId === 'elevenlabs' ? 'byok' : 'ai-keys';
  return {
    keyPost: key ? { endpoint, provider: resolvedId, apiKey: key } : null,
    infra: { sttProvider: resolvedId },
  };
}
