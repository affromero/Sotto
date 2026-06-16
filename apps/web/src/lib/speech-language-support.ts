/**
 * Shared speech language support helpers.
 *
 * Sotto stores course languages as ISO 639-1 codes. Some provider APIs accept
 * or return different code families, so conversions live here rather than in
 * individual workers or UI components.
 */

export const SOTTO_LANGUAGE_CODES = new Set([
  'en',
  'es',
  'fr',
  'de',
  'pt',
  'it',
  'ja',
  'ko',
  'zh',
  'ar',
  'hi',
  'ru',
  'nl',
  'sv',
  'pl',
  'tr',
  'da',
  'fi',
  'no',
  'cs',
  'ro',
  'hu',
  'el',
  'he',
  'th',
  'vi',
  'id',
  'ms',
  'uk',
  'ca',
]);

export const TTS_LANGUAGE_SUPPORT_SETS = {
  all: SOTTO_LANGUAGE_CODES,
  en: new Set(['en']),
  elevenLabsMultilingualV2: new Set([
    'en',
    'es',
    'fr',
    'de',
    'pt',
    'it',
    'ja',
    'ko',
    'zh',
    'ar',
    'hi',
    'ru',
    'nl',
    'sv',
    'pl',
    'tr',
    'da',
    'fi',
    'cs',
    'ro',
    'hu',
    'el',
    'id',
    'ms',
  ]),
  elevenLabsFlash: new Set([
    'en',
    'es',
    'fr',
    'de',
    'pt',
    'it',
    'ja',
    'ko',
    'zh',
    'ar',
    'hi',
    'ru',
    'nl',
    'sv',
    'pl',
    'tr',
    'da',
    'fi',
    'no',
    'cs',
    'ro',
    'hu',
    'el',
    'he',
    'vi',
    'id',
    'ms',
  ]),
  cartesiaSonic3: new Set([
    'en',
    'es',
    'fr',
    'de',
    'pt',
    'it',
    'ja',
    'ko',
    'zh',
    'ar',
    'hi',
    'ru',
    'nl',
    'sv',
    'pl',
    'tr',
    'da',
    'fi',
    'no',
    'cs',
    'ro',
    'hu',
    'el',
    'he',
    'th',
    'vi',
    'id',
    'ms',
  ]),
  cartesiaTurbo: new Set([
    'en',
    'es',
    'fr',
    'de',
    'pt',
    'it',
    'ja',
    'ko',
    'zh',
    'ar',
    'hi',
    'ru',
    'nl',
    'sv',
    'pl',
  ]),
  humeV2: new Set(['en', 'es', 'fr', 'de', 'pt', 'it', 'ja', 'ko', 'zh', 'hi', 'ru']),
  humeV1: new Set(['en', 'es']),
  qwen3: new Set(['en', 'es', 'fr', 'de', 'ja', 'ko', 'zh', 'it', 'pt', 'ru']),
  mistral: new Set(['en', 'es', 'fr', 'de', 'pt', 'it', 'ja', 'ko', 'zh']),
  inworld: new Set(['en', 'es', 'fr', 'de', 'pt', 'it', 'ja', 'ko', 'zh', 'ar', 'hi', 'ru', 'nl', 'sv', 'pl']),
  kokoro: new Set(['en', 'es', 'fr', 'hi', 'it', 'pt', 'ja', 'zh']),
} satisfies Record<string, ReadonlySet<string>>;

export const STT_LANGUAGE_SUPPORT_SETS = {
  all: SOTTO_LANGUAGE_CODES,
  deepgramNova2: new Set([
    'en',
    'es',
    'fr',
    'de',
    'pt',
    'it',
    'ja',
    'ko',
    'zh',
    'hi',
    'ru',
    'nl',
    'sv',
    'pl',
    'tr',
    'da',
    'fi',
    'no',
    'cs',
    'hu',
    'el',
    'th',
    'vi',
    'id',
    'ms',
    'uk',
    'ca',
  ]),
} satisfies Record<string, ReadonlySet<string>>;

export const WELCOME_TTS_PROVIDER_LANGUAGE_SUPPORT: Record<string, ReadonlySet<string>> = {
  elevenlabs: TTS_LANGUAGE_SUPPORT_SETS.all,
  hume: TTS_LANGUAGE_SUPPORT_SETS.humeV2,
  openai: TTS_LANGUAGE_SUPPORT_SETS.all,
  cartesia: TTS_LANGUAGE_SUPPORT_SETS.cartesiaSonic3,
  kokoro: TTS_LANGUAGE_SUPPORT_SETS.kokoro,
  local: TTS_LANGUAGE_SUPPORT_SETS.all,
};

export const WELCOME_STT_PROVIDER_LANGUAGE_SUPPORT: Record<string, ReadonlySet<string>> = {
  whisper: STT_LANGUAGE_SUPPORT_SETS.all,
  local: STT_LANGUAGE_SUPPORT_SETS.all,
  deepgram: STT_LANGUAGE_SUPPORT_SETS.all,
  elevenlabs: STT_LANGUAGE_SUPPORT_SETS.all,
  assembly: STT_LANGUAGE_SUPPORT_SETS.all,
  assemblyai: STT_LANGUAGE_SUPPORT_SETS.all,
  openai: STT_LANGUAGE_SUPPORT_SETS.all,
  together: STT_LANGUAGE_SUPPORT_SETS.all,
};

const ISO_639_1_TO_639_3: Record<string, string> = {
  ar: 'ara',
  ca: 'cat',
  cs: 'ces',
  da: 'dan',
  de: 'deu',
  el: 'ell',
  en: 'eng',
  es: 'spa',
  fi: 'fin',
  fr: 'fra',
  he: 'heb',
  hi: 'hin',
  hu: 'hun',
  id: 'ind',
  it: 'ita',
  ja: 'jpn',
  ko: 'kor',
  ms: 'msa',
  nl: 'nld',
  no: 'nor',
  pl: 'pol',
  pt: 'por',
  ro: 'ron',
  ru: 'rus',
  sv: 'swe',
  th: 'tha',
  tr: 'tur',
  uk: 'ukr',
  vi: 'vie',
  zh: 'zho',
};

const ISO_639_3_TO_639_1 = Object.fromEntries(
  Object.entries(ISO_639_1_TO_639_3).map(([alpha2, alpha3]) => [alpha3, alpha2])
);

const LANGUAGE_NAME_TO_639_1: Record<string, string> = {
  arabic: 'ar',
  catalan: 'ca',
  chinese: 'zh',
  czech: 'cs',
  danish: 'da',
  dutch: 'nl',
  english: 'en',
  finnish: 'fi',
  french: 'fr',
  german: 'de',
  greek: 'el',
  hebrew: 'he',
  hindi: 'hi',
  hungarian: 'hu',
  indonesian: 'id',
  italian: 'it',
  japanese: 'ja',
  korean: 'ko',
  malay: 'ms',
  norwegian: 'no',
  polish: 'pl',
  portuguese: 'pt',
  romanian: 'ro',
  russian: 'ru',
  spanish: 'es',
  swedish: 'sv',
  thai: 'th',
  turkish: 'tr',
  ukrainian: 'uk',
  vietnamese: 'vi',
};

export function normalizeSottoLanguageCode(language: string | null | undefined): string | null {
  if (!language) return null;
  const raw = language.trim().toLowerCase();
  const code = raw.replace('_', '-').split('-')[0];
  if (!code) return null;
  return ISO_639_3_TO_639_1[code] ?? LANGUAGE_NAME_TO_639_1[raw] ?? code;
}

export function toElevenLabsScribeLanguageCode(
  language: string | null | undefined
): string | undefined {
  const normalized = normalizeSottoLanguageCode(language);
  if (!normalized) return undefined;
  return ISO_639_1_TO_639_3[normalized] ?? normalized;
}

export function toSttProviderLanguageCode(
  providerId: string,
  language: string | null | undefined
): string | undefined {
  const normalized = normalizeSottoLanguageCode(language);
  if (!normalized) return undefined;
  return providerId === 'elevenlabs'
    ? toElevenLabsScribeLanguageCode(normalized)
    : normalized;
}

export function fromSttProviderLanguageCode(
  providerId: string,
  language: string | null | undefined
): string | undefined {
  if (!language) return undefined;
  if (providerId === 'elevenlabs') {
    return normalizeSottoLanguageCode(language) ?? undefined;
  }
  return normalizeSottoLanguageCode(language) ?? language;
}

export function supportsWelcomeSpeechProviderLanguage(
  kind: 'tts' | 'stt',
  providerId: string,
  language: string | null | undefined
): boolean {
  const normalized = normalizeSottoLanguageCode(language);
  if (!normalized) return true;
  const set =
    kind === 'tts'
      ? WELCOME_TTS_PROVIDER_LANGUAGE_SUPPORT[providerId]
      : WELCOME_STT_PROVIDER_LANGUAGE_SUPPORT[providerId];
  return set?.has(normalized) ?? false;
}

export function getWelcomeSpeechProviderLanguageCount(
  kind: 'tts' | 'stt',
  providerId: string
): number {
  const set =
    kind === 'tts'
      ? WELCOME_TTS_PROVIDER_LANGUAGE_SUPPORT[providerId]
      : WELCOME_STT_PROVIDER_LANGUAGE_SUPPORT[providerId];
  return set?.size ?? 0;
}
