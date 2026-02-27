/**
 * TTS text preprocessor — strips non-speech markers and handles provider-specific
 * audio tag conversion before text is sent to TTS providers.
 *
 * @tts-research-date 2026-02-27 — ElevenLabs v3 1450+ audio tags, Cartesia Sonic 3
 *   SSML + [laughter], Hume [pause]/[long pause], OpenAI gpt-4o-mini-tts instructions
 */
import type { TtsProviderId } from './providers/tts-registry';

/**
 * Expanded inline audio tag pattern — matches the reliable core set that
 * ElevenLabs v3 handles natively. Other providers convert or strip these.
 *
 * Categories:
 *   Vocal: laughs, chuckles, sighs, whispers, gasps, clears throat, snorts,
 *          crying, yawning, trembling, gulps, exhales
 *   Emotion/tone: excited, sarcastic, sarcastically, curious, nervously,
 *          hesitantly, cheerfully, playfully, frustrated, calm, dramatic
 *   Pacing: pause, short pause, long pause, dramatic pause, stammers, rushed, slow
 */
const AUDIO_TAG_PATTERN =
  /\[(laughs?|laughs harder|chuckles?|sighs?|whispers?|gasps?|clears throat|snorts?|crying|yawning|trembling|gulps?|exhales?|excited|sarcastic|sarcastically|curious|nervously|hesitantly|cheerfully|playfully|frustrated|calm|dramatic|pause|short pause|long pause|dramatic pause|stammers?|rushed|slow)\]/gi;

/** Providers that handle audio tags natively (ElevenLabs keeps as-is, Cartesia converts) */
const AUDIO_TAG_PROVIDERS = new Set<string>(['elevenlabs', 'cartesia']);

/** Map audio tags to Cartesia SSML equivalents */
const CARTESIA_TAG_MAP: Record<string, string> = {
  // Laughter → native [laughter] marker
  laugh: '[laughter]',
  laughs: '[laughter]',
  'laughs harder': '[laughter]',
  chuckle: '[laughter]',
  chuckles: '[laughter]',
  // Pauses → SSML <break>
  pause: '<break time="1s"/>',
  'short pause': '<break time="500ms"/>',
  'long pause': '<break time="2s"/>',
  'dramatic pause': '<break time="2s"/>',
};

/** Tags that Hume supports natively in text */
const HUME_NATIVE_TAGS = new Set(['pause', 'long pause']);

/**
 * Strip non-speech markers from text before sending to TTS.
 * Removes: [SFX: ...] markers, (delivery directions), [N] citation markers.
 *
 * Provider-specific audio tag handling:
 *   ElevenLabs v3: keeps ALL audio tags as-is (1,450+ supported natively)
 *   Cartesia Sonic 3: converts laughs→[laughter], pauses→<break>, strips rest
 *   Hume Octave: keeps [pause]/[long pause] (native), strips rest
 *   OpenAI / others: strips all audio tags
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
    // Remove citation markers like [1], [2, 3], [1, 2, 3] — also consume leading space
    .replace(/\s*\[\d+(?:,\s*\d+)*\]/g, '');

  const providerId = options?.providerId;

  if (providerId === 'cartesia') {
    // Cartesia Sonic 3: convert known tags to SSML or [laughter], strip the rest
    cleaned = cleaned.replace(AUDIO_TAG_PATTERN, (match) => {
      const tag = match.slice(1, -1).toLowerCase();
      return CARTESIA_TAG_MAP[tag] ?? '';
    });
  } else if (providerId === 'hume') {
    // Hume Octave: keep [pause]/[long pause] (native support), strip everything else
    cleaned = cleaned.replace(AUDIO_TAG_PATTERN, (match) => {
      const tag = match.slice(1, -1).toLowerCase();
      return HUME_NATIVE_TAGS.has(tag) ? match : '';
    });
  } else if (!providerId || !AUDIO_TAG_PROVIDERS.has(providerId)) {
    // Non-supported providers (OpenAI, Fal, Replicate, KittenTTS): strip all audio tags
    cleaned = cleaned.replace(AUDIO_TAG_PATTERN, '');
  }
  // ElevenLabs: no replacement needed — all audio tags pass through as-is

  // Collapse multiple spaces and trim
  return cleaned.replace(/\s{2,}/g, ' ').trim();
}
