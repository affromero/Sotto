/**
 * TTS language support — lookup helpers over the registry's per-model language data.
 *
 * Single source of truth: language sets live in tts-registry.ts on each TtsModelOption.
 * This module provides query functions so callers never inspect raw sets directly.
 */
import {
  getProviderMeta,
  getProviderIds,
  type TtsProviderId,
} from './providers/tts-registry';

// ---------------------------------------------------------------------------
// Canonical language code set — used by language-detect.ts and all lookups
// ---------------------------------------------------------------------------

/**
 * All ISO 639-1 codes Sotto supports across any TTS provider.
 * language-detect.ts validates LLM output against this set.
 */
export const SOTTO_LANGUAGE_CODES: ReadonlySet<string> = new Set([
  'en', 'es', 'fr', 'de', 'pt', 'it', 'ja', 'ko', 'zh', 'ar',
  'hi', 'ru', 'nl', 'sv', 'pl', 'tr', 'da', 'fi', 'no', 'cs',
  'ro', 'hu', 'el', 'he', 'th', 'vi', 'id', 'ms', 'uk', 'ca',
]);

// ---------------------------------------------------------------------------
// Lookup functions
// ---------------------------------------------------------------------------

/**
 * Check whether a specific (provider, model) pair supports a given language.
 * Returns true if the model's supportedLanguages set includes the code.
 * Returns true if lang is null/undefined (no language = no filtering).
 */
export function supportsLanguage(
  providerId: TtsProviderId,
  modelId: string,
  lang: string | null | undefined,
): boolean {
  if (!lang) return true;

  try {
    const meta = getProviderMeta(providerId);
    const model = meta.models.find((m) => m.id === modelId);
    if (!model) return false;
    return model.supportedLanguages.has(lang);
  } catch {
    return false;
  }
}

/**
 * Return all (provider, model) pairs that support a given language.
 * Useful for auto-selection when a specific language is required.
 */
export function getProvidersForLanguage(
  lang: string,
): Array<{ providerId: TtsProviderId; modelId: string; tier: string }> {
  const results: Array<{ providerId: TtsProviderId; modelId: string; tier: string }> = [];

  for (const pid of getProviderIds()) {
    const meta = getProviderMeta(pid);
    for (const model of meta.models) {
      if (model.supportedLanguages.has(lang)) {
        results.push({ providerId: pid, modelId: model.id, tier: model.tier });
      }
    }
  }

  return results;
}

/**
 * Find a compatible model for a provider + language combination.
 * If `preferred` model already supports the language, returns it.
 * Otherwise scans the provider's models for one that does.
 * Returns null if no model on this provider supports the language.
 */
export function getDefaultModelForLanguage(
  providerId: TtsProviderId,
  lang: string,
  preferred?: string | null,
): string | null {
  try {
    const meta = getProviderMeta(providerId);

    // Check preferred model first
    if (preferred) {
      const prefModel = meta.models.find((m) => m.id === preferred);
      if (prefModel?.supportedLanguages.has(lang)) return preferred;
    }

    // Scan all models — prefer higher tier
    const tierOrder: Record<string, number> = { ultra: 3, premium: 2, standard: 1 };
    const compatible = meta.models
      .filter((m) => m.supportedLanguages.has(lang))
      .sort((a, b) => (tierOrder[b.tier] ?? 0) - (tierOrder[a.tier] ?? 0));

    return compatible.length > 0 ? compatible[0].id : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Voice–language affinities (Fal/Qwen3 voices have native languages)
// ---------------------------------------------------------------------------

export interface VoiceLanguageAffinity {
  nativeLanguages: readonly string[];
}

/**
 * Maps Qwen3-TTS voice IDs to their native languages.
 * Used by Fal and Replicate qwen3-tts providers to prefer native-language
 * voices when a episode language is known.
 */
export const VOICE_LANGUAGE_AFFINITIES: Readonly<Record<string, VoiceLanguageAffinity>> = {
  Vivian:   { nativeLanguages: ['zh'] },
  Serena:   { nativeLanguages: ['zh'] },
  Uncle_Fu: { nativeLanguages: ['zh'] },
  Dylan:    { nativeLanguages: ['zh'] },
  Eric:     { nativeLanguages: ['zh'] },
  Ryan:     { nativeLanguages: ['en'] },
  Aiden:    { nativeLanguages: ['en'] },
  Ono_Anna: { nativeLanguages: ['ja'] },
  Sohee:    { nativeLanguages: ['ko'] },
};
