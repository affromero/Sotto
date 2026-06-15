/** Display names for the language codes Sotto courses use. */
export const LANG_LABELS: Record<string, string> = {
  en: 'English',
  de: 'German',
  es: 'Spanish',
  fr: 'French',
  pt: 'Portuguese',
  it: 'Italian',
  ja: 'Japanese',
  zh: 'Chinese',
  ko: 'Korean',
};

/** A human language name for a code, falling back to the upper-cased code. */
export function langLabel(code: string): string {
  return LANG_LABELS[code.toLowerCase()] ?? code.toUpperCase();
}
