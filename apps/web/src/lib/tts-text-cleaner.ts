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
 * Map parenthetical directions → bracket audio tag equivalents.
 * Gerund/adverb forms map to the tag that TTS providers recognize.
 * Entries already in bracket form (pause, short pause) pass through as-is.
 */
const PAREN_TO_TAG: Record<string, string> = {
  // Gerund → vocal tag
  laughing: 'laughs', chuckling: 'chuckles', whispering: 'whispers',
  sighing: 'sighs', pausing: 'pause',
  // Adverb → emotion/tone tag
  excitedly: 'excited', thoughtfully: 'calm', sarcastically: 'sarcastic',
  softly: 'whispers', loudly: 'excited', dramatically: 'dramatic',
  gently: 'calm', warmly: 'cheerfully', seriously: 'calm',
  jokingly: 'playfully', hesitantly: 'hesitantly', confidently: 'excited',
  curiously: 'curious', enthusiastically: 'excited', nervously: 'nervously',
  calmly: 'calm', urgently: 'rushed', playfully: 'playfully',
  'matter-of-factly': 'calm', slowly: 'slow', quickly: 'rushed',
  // Pause forms — pass through
  pause: 'pause', 'short pause': 'short pause', 'long pause': 'long pause',
  'brief pause': 'short pause', 'dramatic pause': 'dramatic pause', beat: 'pause',
};

/**
 * Clean non-speech markers and convert delivery directions to audio tags
 * before sending text to TTS providers.
 *
 * Removes: [SFX: ...] markers, [N] citation markers.
 * Converts: (direction) → [audio tag] so provider-specific handling applies.
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
    // Convert parenthetical directions to bracket audio tags
    // e.g. "(laughing)" → "[laughs]", "(short pause)" → "[short pause]"
    .replace(/\(([^)]{1,30})\)/g, (_, inner) => {
      const tag = PAREN_TO_TAG[inner.trim().toLowerCase()];
      return tag ? `[${tag}]` : `(${inner})`;
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
