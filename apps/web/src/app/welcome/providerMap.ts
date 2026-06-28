/**
 * Maps the welcome wizard's display provider IDs to the real backend registry /
 * infra IDs, and routes each captured key to the correct store. The wizard's
 * labels are NOT the registry IDs (e.g. "whisper" -> local STT, "assembly" ->
 * assemblyai, "claude"/"codex" -> anthropic/openai or the keyless claude-code
 * CLI), so this is the single source of truth for the translation.
 *
 * Pure functions, no I/O — unit-tested. The wizard calls these to decide which
 * keys to POST (to /api/v1/settings/ai-keys, /api/v1/settings/byok, or
 * /api/v1/settings/visual-cues), which per-user preferences to save, and — for
 * the owner — which server-infra fields to set.
 *
 * No availability-based fallback: each result reflects exactly what the learner
 * selected. No secrets are embedded here.
 */

export type AiMethod = 'cli' | 'key' | 'url' | null;

/** A provider key to POST. `endpoint` selects the validated settings route. */
export interface KeyPost {
  endpoint: 'ai-keys' | 'byok' | 'visual-cues';
  provider: string;
  apiKey: string;
  extra?: Record<string, string>;
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
  preferredTtsModel: string | null;
  infra: { ttsProvider?: string; ttsBaseUrl?: string };
}

export interface SttResolution {
  keyPost: KeyPost | null;
  preferredSttProvider: string | null;
  preferredSttModel: string | null;
  infra: { sttProvider?: string; sttBaseUrl?: string };
}

export interface VisualCueResolution {
  keyPost: KeyPost | null;
  provider: 'pexels' | 'off';
}

export const DEFAULT_LOCAL_TTS_BASE_URL = 'http://localhost:8000';
export const DEFAULT_LOCAL_STT_BASE_URL = 'http://localhost:8001/v1';

function clean(v: string | undefined | null): string {
  return (v ?? '').trim();
}

export function resolveWelcomeTtsProviderId(ttsId: string): string | null {
  if (ttsId === 'elevenlabs' || ttsId === 'hume' || ttsId === 'openai' || ttsId === 'cartesia') {
    return ttsId;
  }
  if (ttsId === 'kokoro' || ttsId === 'local') return ttsId;
  return null;
}

export function resolveWelcomeSttProviderId(sttId: string): string | null {
  if (sttId === 'whisper') return 'local';
  if (sttId === 'assembly') return 'assemblyai';
  if (
    sttId === 'local' ||
    sttId === 'deepgram' ||
    sttId === 'elevenlabs' ||
    sttId === 'openai' ||
    sttId === 'together' ||
    sttId === 'cartesia' ||
    sttId === 'groq' ||
    sttId === 'gladia' ||
    sttId === 'speechmatics'
  ) {
    return sttId;
  }
  return null;
}

/**
 * The AI registry provider whose models back a key-method selection for a wizard
 * provider id (claude → anthropic, codex → openai). null for CLI/local/custom,
 * which don't pick from the registry model list. Mirrors the mapping in resolveAi.
 */
export function aiModelProviderId(wizardId: string): string | null {
  if (wizardId === 'claude') return 'anthropic';
  if (wizardId === 'codex') return 'openai';
  // Cloud LLM cards use their registry id directly (google + the OpenAI-compatible
  // providers). local/custom return null (free-text model, not a registry picker).
  if (['google', 'xai', 'deepseek', 'mistral', 'groq', 'nvidia'].includes(wizardId)) {
    return wizardId;
  }
  return null;
}

/** The STT registry provider id for a wizard STT id (whisper → local, assembly → assemblyai). */
export function sttModelProviderId(wizardId: string): string {
  return wizardId === 'whisper' ? 'local' : wizardId === 'assembly' ? 'assemblyai' : wizardId;
}

/**
 * AI agent → backend.
 *   claude+key → BYOK anthropic;  codex+key → BYOK openai;  google+key → BYOK google
 *   claude+cli → keyless infra aiProvider=claude-code
 *   codex+cli  → keyless infra aiProvider=codex
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
    // claude → anthropic, codex → openai, cloud LLM cards → their registry id.
    const byokProvider = aiModelProviderId(provider) ?? 'openai';
    return {
      keyPost: { endpoint: 'ai-keys', provider: byokProvider, apiKey: v },
      preferredAiProvider: byokProvider,
      // Bare registry model id picked in the wizard (no "local:" prefix). Drives
      // generation via AutoModelConfig once persisted; null falls back to default.
      preferredAiModel: m || null,
      infra: {},
    };
  }

  if (method === 'cli') {
    // The CLI backend is the keyless local agent. The picked model is already a
    // routable agent model id (for example claude-code:sonnet or codex:gpt-5.5).
    const cliProvider = provider === 'codex' ? 'codex' : 'claude-code';
    return {
      keyPost: null,
      preferredAiProvider: cliProvider,
      preferredAiModel: m || (cliProvider === 'codex' ? 'codex' : null),
      infra: { aiProvider: cliProvider, ...(m && { aiModel: m }) },
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
export function resolveTts(
  ttsId: string,
  apiKey: string,
  baseUrl: string,
  model?: string,
  extra?: Record<string, string>
): TtsResolution {
  const resolvedId = resolveWelcomeTtsProviderId(ttsId) ?? ttsId;

  if (resolvedId === 'kokoro' || resolvedId === 'local') {
    const u = clean(baseUrl) || DEFAULT_LOCAL_TTS_BASE_URL;
    return {
      keyPost: null,
      preferredTtsProvider: resolvedId,
      preferredTtsModel: null,
      infra: { ttsProvider: resolvedId, ...(u && { ttsBaseUrl: u }) },
    };
  }

  const key = clean(apiKey);
  const cleanedExtra =
    extra &&
    Object.fromEntries(
      Object.entries(extra)
        .map(([field, value]) => [field, clean(value)])
        .filter(([, value]) => value)
    );
  const usableExtra =
    cleanedExtra && Object.keys(cleanedExtra).length > 0 ? { extra: cleanedExtra } : {};

  return {
    keyPost: key ? { endpoint: 'byok', provider: resolvedId, apiKey: key, ...usableExtra } : null,
    preferredTtsProvider: resolvedId,
    preferredTtsModel: clean(model) || null,
    infra: { ttsProvider: resolvedId },
  };
}

/**
 * STT → backend. "whisper" and "local" are keyless local servers (infra + base URL);
 * "assembly" → assemblyai. ElevenLabs and Cartesia keys live in the TTS/BYOK store;
 * every other cloud STT key lives in the AI-key store (matching resolveSttProvider).
 */
export function resolveStt(
  sttId: string,
  apiKey: string,
  baseUrl: string,
  model?: string
): SttResolution {
  const resolvedId = resolveWelcomeSttProviderId(sttId) ?? sttModelProviderId(sttId);

  if (resolvedId === 'local') {
    const u = clean(baseUrl) || DEFAULT_LOCAL_STT_BASE_URL;
    return {
      keyPost: null,
      preferredSttProvider: 'local',
      preferredSttModel: null,
      infra: { sttProvider: 'local', ...(u && { sttBaseUrl: u }) },
    };
  }

  const key = clean(apiKey);
  const endpoint = resolvedId === 'elevenlabs' || resolvedId === 'cartesia' ? 'byok' : 'ai-keys';
  return {
    keyPost: key ? { endpoint, provider: resolvedId, apiKey: key } : null,
    preferredSttProvider: resolvedId,
    preferredSttModel: clean(model) || null,
    infra: { sttProvider: resolvedId },
  };
}

/** Visual cue provider → encrypted visual-cue key store. */
export function resolveVisualCue(provider: string, apiKey: string): VisualCueResolution {
  const selected = provider === 'off' ? 'off' : 'pexels';
  const key = clean(apiKey);
  return {
    provider: selected,
    keyPost:
      selected === 'pexels' && key
        ? { endpoint: 'visual-cues', provider: 'pexels', apiKey: key }
        : null,
  };
}
