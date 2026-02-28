/**
 * TTS text safety net — strips non-speech markers before sending to TTS.
 * Provider-specific tag conversion is handled upstream by tts-tag-converter.ts.
 */
export function cleanTextForTts(text: string): string {
  return text
    .replace(/\[SFX:.*?\]/gi, '')
    .replace(/\s*\[\d+(?:,\s*\d+)*\]/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}
