import type { TtsProviderId } from './providers/tts-registry';

/**
 * Known inline audio tags that ElevenLabs v3 can render as vocal reactions.
 * Cartesia Sonic 3 supports [laughter] natively; other providers strip these.
 */
const AUDIO_TAG_PATTERN = /\[(laughs?|chuckles?|sighs?|whispers?|gasps?|clears throat|excited)\]/gi;

/** Providers that handle audio tags natively (ElevenLabs keeps as-is, Cartesia converts) */
const AUDIO_TAG_PROVIDERS = new Set<string>(['elevenlabs', 'cartesia']);

/**
 * Strip non-speech markers from text before sending to TTS.
 * Removes: [SFX: ...] markers, (delivery directions), [N] citation markers.
 * ElevenLabs: keeps audio tags as-is (native support).
 * Cartesia Sonic 3: converts [laughs]/[chuckles] → [laughter] (native marker).
 * Others: strips all audio tags.
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

  const providerId = options?.providerId;

  if (providerId === 'cartesia') {
    // Cartesia Sonic 3: convert laugh/chuckle tags to native [laughter], strip the rest
    cleaned = cleaned.replace(AUDIO_TAG_PATTERN, (match) => {
      const tag = match.slice(1, -1).toLowerCase();
      if (tag.startsWith('laugh') || tag.startsWith('chuckle')) return '[laughter]';
      return '';
    });
  } else if (!providerId || !AUDIO_TAG_PROVIDERS.has(providerId)) {
    // Non-supported providers: strip all audio tags
    cleaned = cleaned.replace(AUDIO_TAG_PATTERN, '');
  }

  // Collapse multiple spaces and trim
  return cleaned.replace(/\s{2,}/g, ' ').trim();
}
