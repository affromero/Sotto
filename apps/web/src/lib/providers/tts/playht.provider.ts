/**
 * PlayHT TTS provider — Play3.0-mini multilingual synthesis.
 *
 * Dual-credential auth: `X-USER-ID` + `AUTHORIZATION` (no Bearer prefix). Voices
 * are S3 URI strings (from GET /api/v2/voices). The `language` field takes a full
 * language NAME (e.g. "english"), not an ISO code — see PLAYHT_LANGUAGE_NAMES.
 *
 * The user id comes from PLAYHT_USER_ID; the API key is BYOK or PLAYHT_API_KEY.
 *
 * API docs: https://docs.play.ht/reference/api-getting-started
 * @tts-research-date 2026-06-15 — POST /api/v2/tts/stream, dual-header auth, Play3.0-mini
 */
import { logger } from '../../logger';
import type { TtsProvider, SpeechParams } from '../tts';
import type { TtsProviderId } from '../tts-registry';
import { PLAYHT_VOICE_POOL, selectVoicePairFromPool } from '../tts-voices';
import { applyPronunciationAliases } from '../../pronunciation-dictionary';
import type { VoiceMatchMetadata } from '../../voice-pool';

const SPEAKER_VOICE_HOST_SET = new Set(['HOST', 'GUEST']);

// PlayHT expects full language names. Map the Sotto ISO 639-1 codes it supports;
// unmapped codes omit the field (PlayHT defaults to the voice's native language).
const PLAYHT_LANGUAGE_NAMES: Record<string, string> = {
  en: 'english',
  es: 'spanish',
  fr: 'french',
  de: 'german',
  pt: 'portuguese',
  it: 'italian',
  ja: 'japanese',
  ko: 'korean',
  zh: 'mandarin',
  ar: 'arabic',
  hi: 'hindi',
  ru: 'russian',
  nl: 'dutch',
  sv: 'swedish',
  pl: 'polish',
  tr: 'turkish',
  da: 'danish',
  cs: 'czech',
  hu: 'hungarian',
  el: 'greek',
  he: 'hebrew',
  th: 'thai',
  id: 'indonesian',
  ms: 'malay',
  uk: 'ukrainian',
  ca: 'catalan',
};

export class PlayHtProvider implements TtsProvider {
  readonly providerId: TtsProviderId = 'playht';
  private apiKey: string;
  private userId: string;
  private model: string;

  constructor(apiKey?: string, model?: string) {
    const key = apiKey || process.env.PLAYHT_API_KEY;
    const userId = process.env.PLAYHT_USER_ID;
    if (!key) throw new Error('PlayHT requires an API key (BYOK or PLAYHT_API_KEY env var)');
    if (!userId) throw new Error('PlayHT requires PLAYHT_USER_ID (set it in your environment)');
    this.apiKey = key;
    this.userId = userId;
    this.model = model ?? 'Play3.0-mini';
  }

  async generateSpeech(params: SpeechParams): Promise<Buffer> {
    const language = params.language ? PLAYHT_LANGUAGE_NAMES[params.language] : undefined;

    const response = await fetch('https://api.play.ht/api/v2/tts/stream', {
      method: 'POST',
      headers: {
        'X-USER-ID': this.userId,
        AUTHORIZATION: this.apiKey,
        'Content-Type': 'application/json',
        Accept: 'audio/mpeg',
      },
      body: JSON.stringify({
        text: applyPronunciationAliases(params.text),
        voice: params.voiceId,
        voice_engine: this.model,
        output_format: 'mp3',
        ...(language && { language }),
      }),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => 'Unknown error');
      throw new Error(`PlayHT TTS error (${response.status}): ${errorText}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    logger.info('PlayHT speech generated', {
      model: this.model,
      voiceId: params.voiceId,
      chars: params.text.length,
    });
    return Buffer.from(arrayBuffer);
  }

  getVoiceId(
    speaker: string,
    episodeId?: string,
    metadata?: VoiceMatchMetadata,
    _language?: string
  ): string {
    const isHostVoice = SPEAKER_VOICE_HOST_SET.has(speaker.toUpperCase());
    if (!episodeId) {
      return isHostVoice ? PLAYHT_VOICE_POOL[0].id : PLAYHT_VOICE_POOL[1].id;
    }
    const pair = selectVoicePairFromPool(PLAYHT_VOICE_POOL, episodeId, metadata);
    return isHostVoice ? pair.host.id : pair.expert.id;
  }

  getModelId(): string {
    return this.model;
  }
}
