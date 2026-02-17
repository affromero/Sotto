import type { TtsProviderId } from './providers/tts-registry';

/**
 * Known inline audio tags that ElevenLabs v3 can render as vocal reactions.
 * Other providers don't support these, so they get stripped.
 */
const AUDIO_TAG_PATTERN = /\[(laughs?|chuckles?|sighs?|whispers?|gasps?|clears throat|excited)\]/gi;

/**
 * Strip non-speech markers from text before sending to TTS.
 * Removes: [SFX: ...] markers, (delivery directions), [N] citation markers.
 * Conditionally strips audio tags for non-ElevenLabs providers.
 */
export function cleanTextForTts(
  text: string,
  options?: { providerId?: TtsProviderId }
): string {
  let cleaned = text
    // Remove [SFX: ...] markers (e.g. "[SFX: upbeat music, 3s]")
    .replace(/\[SFX:.*?\]/gi, '')
    // Remove parenthetical delivery directions (e.g. "(laughing)", "(whispering)")
    .replace(/\(([^)]{1,30})\)/g, (_, inner) => {
      const directions =
        /^(laughing|chuckling|whispering|sighing|pausing|excitedly|thoughtfully|sarcastically|softly|loudly|slowly|quickly|dramatically|gently|warmly|seriously|jokingly|hesitantly|confidently|curiously|enthusiastically|nervously|calmly|urgently|playfully|matter-of-factly)$/i;
      return directions.test(inner.trim()) ? '' : `(${inner})`;
    })
    // Remove citation markers like [1], [2, 3], [1, 2, 3]
    .replace(/\[\d+(?:,\s*\d+)*\]/g, '');

  // Strip audio tags for non-ElevenLabs providers (they can't render them)
  if (options?.providerId !== 'elevenlabs') {
    cleaned = cleaned.replace(AUDIO_TAG_PATTERN, '');
  }

  // Collapse multiple spaces and trim
  return cleaned.replace(/\s{2,}/g, ' ').trim();
}
