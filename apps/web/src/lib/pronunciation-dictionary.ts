/**
 * Shared pronunciation rules for TTS providers.
 *
 * ElevenLabs: uses Pronunciation Dictionary API (upload PLS XML, reference by ID)
 * Cartesia:   injects inline SSML <phoneme> tags into transcript text
 *
 * Brand terms and acronyms that need consistent pronunciation across all providers.
 */

export interface PronunciationRule {
  /** Written form as it appears in scripts */
  grapheme: string;
  /** Plain text alias that sounds correct when read aloud */
  alias: string;
}

/**
 * Brand terms and technical acronyms that TTS models commonly mispronounce.
 * Alias-based rules work across all providers (ElevenLabs PLS + Cartesia SSML).
 */
export const BRAND_PRONUNCIATIONS: PronunciationRule[] = [
  { grapheme: 'Sotto', alias: 'Sot-toe' },
  { grapheme: 'BYOK', alias: 'bee-yok' },
  { grapheme: 'BullMQ', alias: 'bull M Q' },
];

/**
 * Replace brand terms in text with their pronunciation-friendly aliases.
 * Used by providers that don't support pronunciation dictionaries (Hume, OpenAI).
 */
export function applyPronunciationAliases(text: string): string {
  let result = text;
  for (const rule of BRAND_PRONUNCIATIONS) {
    const regex = new RegExp(`\\b${escapeRegExp(rule.grapheme)}\\b`, 'gi');
    result = result.replace(regex, rule.alias);
  }
  return result;
}

/**
 * Generate PLS (Pronunciation Lexicon Specification) XML for ElevenLabs.
 * ElevenLabs accepts alias-based rules via their dictionary API.
 */
export function generatePlsXml(): string {
  const entries = BRAND_PRONUNCIATIONS.map(
    (rule) =>
      `    <lexeme>\n      <grapheme>${escapeXml(rule.grapheme)}</grapheme>\n      <alias>${escapeXml(rule.alias)}</alias>\n    </lexeme>`
  ).join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<lexicon version="1.0" xmlns="http://www.w3.org/2005/01/pronunciation-lexicon" alphabet="ipa" xml:lang="en-US">
${entries}
</lexicon>`;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
