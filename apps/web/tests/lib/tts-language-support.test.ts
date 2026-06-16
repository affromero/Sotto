import { describe, it, expect } from 'vitest';

import {
  getWelcomeSpeechProviderLanguageCount,
  fromSttProviderLanguageCode,
  normalizeSottoLanguageCode,
  SOTTO_LANGUAGE_CODES,
  supportsWelcomeSpeechProviderLanguage,
  toElevenLabsScribeLanguageCode,
  toSttProviderLanguageCode,
} from '@/lib/speech-language-support';
import {
  supportsLanguage,
  getProvidersForLanguage,
  getDefaultModelForLanguage,
  VOICE_LANGUAGE_AFFINITIES,
} from '@/lib/tts-language-support';

describe('SOTTO_LANGUAGE_CODES', () => {
  it('contains 30 language codes', () => {
    expect(SOTTO_LANGUAGE_CODES.size).toBe(30);
  });

  it('includes common languages', () => {
    for (const code of ['en', 'es', 'fr', 'de', 'ja', 'ko', 'zh', 'ar']) {
      expect(SOTTO_LANGUAGE_CODES.has(code)).toBe(true);
    }
  });
});

describe('speech language normalization', () => {
  it('normalizes provider names and ISO-639-3 codes to Sotto language codes', () => {
    expect(normalizeSottoLanguageCode('spanish')).toBe('es');
    expect(normalizeSottoLanguageCode('spa')).toBe('es');
    expect(normalizeSottoLanguageCode('pt-BR')).toBe('pt');
  });

  it('maps Sotto language codes to ElevenLabs Scribe language codes', () => {
    expect(toElevenLabsScribeLanguageCode('es')).toBe('spa');
    expect(toElevenLabsScribeLanguageCode('en')).toBe('eng');
  });

  it('maps STT language codes to provider-specific API codes', () => {
    expect(toSttProviderLanguageCode('cartesia', 'de-DE')).toBe('de');
    expect(toSttProviderLanguageCode('elevenlabs', 'zh')).toBe('zho');
    expect(toSttProviderLanguageCode('speechmatics', 'zh')).toBe('cmn');
    expect(fromSttProviderLanguageCode('speechmatics', 'cmn')).toBe('zh');
  });
});

describe('welcome STT provider language support', () => {
  const visibleSttProviders = [
    'whisper',
    'local',
    'deepgram',
    'elevenlabs',
    'assembly',
    'openai',
    'groq',
    'cartesia',
    'gladia',
    'speechmatics',
  ];

  it('marks every visible STT provider ready for German when the provider has full support', () => {
    for (const providerId of visibleSttProviders) {
      expect(supportsWelcomeSpeechProviderLanguage('stt', providerId, 'de')).toBe(true);
      expect(getWelcomeSpeechProviderLanguageCount('stt', providerId)).toBeGreaterThan(0);
    }
  });

  it('does not mark unknown STT providers ready for a selected language', () => {
    expect(supportsWelcomeSpeechProviderLanguage('stt', 'unknown-provider', 'de')).toBe(false);
  });
});

describe('welcome TTS provider language support', () => {
  it('marks visible TTS providers ready for German only when their configured pack supports it', () => {
    for (const providerId of [
      'elevenlabs',
      'hume',
      'openai',
      'cartesia',
      'deepgram',
      'rime',
      'playht',
      'local',
    ]) {
      expect(supportsWelcomeSpeechProviderLanguage('tts', providerId, 'de')).toBe(true);
      expect(getWelcomeSpeechProviderLanguageCount('tts', providerId)).toBeGreaterThan(0);
    }

    expect(supportsWelcomeSpeechProviderLanguage('tts', 'kokoro', 'de')).toBe(false);
  });
});

describe('supportsLanguage', () => {
  it('returns true when model supports the language', () => {
    expect(supportsLanguage('elevenlabs', 'eleven_v3', 'es')).toBe(true);
    expect(supportsLanguage('elevenlabs', 'eleven_v3', 'ja')).toBe(true);
    expect(supportsLanguage('openai', 'tts-1-hd', 'fr')).toBe(true);
  });

  it('returns false when model does not support the language', () => {
    // eleven_turbo_v2 only supports English
    expect(supportsLanguage('elevenlabs', 'eleven_turbo_v2', 'es')).toBe(false);
    expect(supportsLanguage('elevenlabs', 'eleven_turbo_v2', 'ja')).toBe(false);
  });

  it('returns true when language is null or undefined', () => {
    expect(supportsLanguage('elevenlabs', 'eleven_turbo_v2', null)).toBe(true);
    expect(supportsLanguage('elevenlabs', 'eleven_turbo_v2', undefined)).toBe(true);
  });

  it('returns false for unknown provider', () => {
    expect(supportsLanguage('nonexistent' as never, 'model', 'en')).toBe(false);
  });

  it('returns false for unknown model', () => {
    expect(supportsLanguage('elevenlabs', 'nonexistent-model', 'en')).toBe(false);
  });

  it('correctly identifies Hume Octave v1 as en/es only', () => {
    expect(supportsLanguage('hume', 'octave-v1', 'en')).toBe(true);
    expect(supportsLanguage('hume', 'octave-v1', 'es')).toBe(true);
    expect(supportsLanguage('hume', 'octave-v1', 'fr')).toBe(false);
  });

  it('correctly identifies Mistral as limited languages', () => {
    expect(supportsLanguage('mistral', 'voxtral-mini-tts-2603', 'en')).toBe(true);
    expect(supportsLanguage('mistral', 'voxtral-mini-tts-2603', 'zh')).toBe(true);
    // Mistral doesn't support Ukrainian
    expect(supportsLanguage('mistral', 'voxtral-mini-tts-2603', 'uk')).toBe(false);
  });
});

describe('getProvidersForLanguage', () => {
  it('returns providers that support a common language', () => {
    const providers = getProvidersForLanguage('en');
    expect(providers.length).toBeGreaterThan(0);
    // Every provider should support English
    const providerIds = new Set(providers.map((p) => p.providerId));
    expect(providerIds.has('elevenlabs')).toBe(true);
    expect(providerIds.has('openai')).toBe(true);
    expect(providerIds.has('hume')).toBe(true);
  });

  it('returns fewer providers for a niche language', () => {
    // Catalan (ca) is only supported by providers with full 30-language support
    const providers = getProvidersForLanguage('ca');
    const providerIds = new Set(providers.map((p) => p.providerId));
    // Only ElevenLabs v3, OpenAI (all), and MiniMax support Catalan
    expect(providerIds.has('elevenlabs')).toBe(true);
    expect(providerIds.has('openai')).toBe(true);
    expect(providerIds.has('minimax')).toBe(true);
    // Fal/Qwen3 doesn't support Catalan
    expect(providerIds.has('fal')).toBe(false);
  });

  it('returns empty for an unsupported language', () => {
    expect(getProvidersForLanguage('xx')).toEqual([]);
  });
});

describe('getDefaultModelForLanguage', () => {
  it('returns preferred model if it supports the language', () => {
    expect(getDefaultModelForLanguage('elevenlabs', 'es', 'eleven_v3')).toBe('eleven_v3');
  });

  it('swaps to compatible model when preferred is English-only', () => {
    // eleven_turbo_v2 is English-only, should fall back to eleven_v3 for Spanish
    const result = getDefaultModelForLanguage('elevenlabs', 'es', 'eleven_turbo_v2');
    expect(result).not.toBe('eleven_turbo_v2');
    expect(result).toBeTruthy();
    // Should pick the best tier model that supports Spanish
    expect(result).toBe('eleven_v3');
  });

  it('returns null when no model supports the language', () => {
    // Hume only supports 11 languages, not Ukrainian
    expect(getDefaultModelForLanguage('hume', 'uk')).toBeNull();
  });

  it('returns null for unknown provider', () => {
    expect(getDefaultModelForLanguage('nonexistent' as never, 'en')).toBeNull();
  });

  it('returns highest-tier model when no preference given', () => {
    const result = getDefaultModelForLanguage('elevenlabs', 'es');
    // Should pick eleven_v3 (premium) or eleven_multilingual_v2 (premium) over eleven_turbo_v2 (standard)
    expect(result).not.toBe('eleven_turbo_v2');
  });
});

describe('VOICE_LANGUAGE_AFFINITIES', () => {
  it('maps Chinese voices correctly', () => {
    expect(VOICE_LANGUAGE_AFFINITIES.Vivian.nativeLanguages).toContain('zh');
    expect(VOICE_LANGUAGE_AFFINITIES.Uncle_Fu.nativeLanguages).toContain('zh');
  });

  it('maps English voices correctly', () => {
    expect(VOICE_LANGUAGE_AFFINITIES.Ryan.nativeLanguages).toContain('en');
    expect(VOICE_LANGUAGE_AFFINITIES.Aiden.nativeLanguages).toContain('en');
  });

  it('maps Japanese voice correctly', () => {
    expect(VOICE_LANGUAGE_AFFINITIES.Ono_Anna.nativeLanguages).toContain('ja');
  });

  it('maps Korean voice correctly', () => {
    expect(VOICE_LANGUAGE_AFFINITIES.Sohee.nativeLanguages).toContain('ko');
  });
});
