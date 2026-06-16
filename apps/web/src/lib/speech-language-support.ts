/**
 * Shared speech language support helpers.
 *
 * Sotto stores course languages as ISO 639-1 codes. Some provider APIs accept
 * or return different code families, so conversions live here rather than in
 * individual workers or UI components.
 */

import speechLanguageSupportConfig from './speech-language-support.config.json';

type LanguageSupportSection = Record<string, readonly string[]>;
type WelcomeProviderSupportSection = Record<string, string>;

function validateLanguageList(
  path: string,
  languages: readonly string[],
  knownLanguages?: ReadonlySet<string>
): string[] {
  const seen = new Set<string>();
  for (const language of languages) {
    if (seen.has(language)) {
      throw new Error(`Duplicate language "${language}" in ${path}.`);
    }
    if (knownLanguages && !knownLanguages.has(language)) {
      throw new Error(
        `Unknown language "${language}" in ${path}. Add it to sottoLanguageCodes first.`
      );
    }
    seen.add(language);
  }
  return [...seen];
}

function buildLanguageSupportSets(
  path: string,
  configuredSets: LanguageSupportSection,
  seedSets: Record<string, ReadonlySet<string>> = {}
): Record<string, ReadonlySet<string>> {
  const sets: Record<string, ReadonlySet<string>> = {
    all: SOTTO_LANGUAGE_CODES,
    ...seedSets,
  };

  for (const [name, languages] of Object.entries(configuredSets)) {
    if (sets[name]) {
      throw new Error(`Language support set "${name}" in ${path} conflicts with a built-in set.`);
    }
    sets[name] = new Set(validateLanguageList(`${path}.${name}`, languages, SOTTO_LANGUAGE_CODES));
  }

  return sets;
}

function buildWelcomeProviderLanguageSupport(
  path: string,
  configuredProviders: WelcomeProviderSupportSection,
  supportSets: Record<string, ReadonlySet<string>>
): Record<string, ReadonlySet<string>> {
  const result: Record<string, ReadonlySet<string>> = {};

  for (const [providerId, setName] of Object.entries(configuredProviders)) {
    const set = supportSets[setName];
    if (!set) {
      throw new Error(`Unknown language support set "${setName}" for ${path}.${providerId}.`);
    }
    result[providerId] = set;
  }

  return result;
}

function validateAliasMap(path: string, aliases: Record<string, string>): Record<string, string> {
  for (const [alias, sottoCode] of Object.entries(aliases)) {
    if (!SOTTO_LANGUAGE_CODES.has(sottoCode)) {
      throw new Error(`Unknown Sotto language "${sottoCode}" for ${path}.${alias}.`);
    }
  }
  return aliases;
}

function validateProviderLanguageCodeOverrides(
  path: string,
  overrides: Record<string, Record<string, string>>
): Record<string, Record<string, string>> {
  for (const [providerId, providerOverrides] of Object.entries(overrides)) {
    for (const [sottoCode, providerCode] of Object.entries(providerOverrides)) {
      if (!SOTTO_LANGUAGE_CODES.has(sottoCode)) {
        throw new Error(`Unknown Sotto language "${sottoCode}" for ${path}.${providerId}.`);
      }
      if (!providerCode.trim()) {
        throw new Error(`Empty provider language code for ${path}.${providerId}.${sottoCode}.`);
      }
    }
  }
  return overrides;
}

export const SOTTO_LANGUAGE_CODES = new Set(
  validateLanguageList('sottoLanguageCodes', speechLanguageSupportConfig.sottoLanguageCodes)
);

export const TTS_LANGUAGE_SUPPORT_SETS = buildLanguageSupportSets(
  'ttsLanguageSupport',
  speechLanguageSupportConfig.ttsLanguageSupport,
  { en: new Set(['en']) }
);

export const STT_LANGUAGE_SUPPORT_SETS = buildLanguageSupportSets(
  'sttLanguageSupport',
  speechLanguageSupportConfig.sttLanguageSupport
);

export const WELCOME_TTS_PROVIDER_LANGUAGE_SUPPORT = buildWelcomeProviderLanguageSupport(
  'welcomeProviderLanguageSupport.tts',
  speechLanguageSupportConfig.welcomeProviderLanguageSupport.tts,
  TTS_LANGUAGE_SUPPORT_SETS
);

export const WELCOME_STT_PROVIDER_LANGUAGE_SUPPORT = buildWelcomeProviderLanguageSupport(
  'welcomeProviderLanguageSupport.stt',
  speechLanguageSupportConfig.welcomeProviderLanguageSupport.stt,
  STT_LANGUAGE_SUPPORT_SETS
);

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

const ISO_639_3_TO_639_1: Record<string, string> = {
  ...Object.fromEntries(
    Object.entries(ISO_639_1_TO_639_3).map(([alpha2, alpha3]) => [alpha3, alpha2])
  ),
  ...validateAliasMap('languageAliasesToSotto', speechLanguageSupportConfig.languageAliasesToSotto),
};

const STT_PROVIDER_LANGUAGE_CODE_OVERRIDES = validateProviderLanguageCodeOverrides(
  'sttProviderLanguageCodeOverrides',
  speechLanguageSupportConfig.sttProviderLanguageCodeOverrides
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
  if (providerId === 'elevenlabs') {
    return toElevenLabsScribeLanguageCode(normalized);
  }
  return STT_PROVIDER_LANGUAGE_CODE_OVERRIDES[providerId]?.[normalized] ?? normalized;
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
