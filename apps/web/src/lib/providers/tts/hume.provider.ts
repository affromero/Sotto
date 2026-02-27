/**
 * Hume AI TTS provider — ultra-quality expressive voice generation via Octave.
 *
 * Expression support:
 *   - description: natural-language acting instructions per utterance (≤100 chars)
 *     e.g. "warm, inviting", "urgent, panicked", "sarcastic, dry"
 *   - speed: 0.5–2.0 (stable range 0.75–1.5)
 *   - trailing_silence: seconds of silence after utterance
 *   - Native text markers: [pause], [long pause]
 *   - Octave infers emotion from text content — description refines/overrides
 *   - Use Octave v1 for acting instructions (v2 doesn't support them yet)
 *
 * @tts-research-date 2026-02-27 — Octave description field, speed, continuation, v1 vs v2
 */
import { logger } from '../../logger';
import type { TtsProvider, SpeechParams } from '../tts';
import type { TtsProviderId } from '../tts-registry';
import { HUME_VOICE_POOL, selectVoicePairFromPool } from '../tts-voices';
import { mapDirectionToExpression } from '../../tts-expression-mapper';

// HOST/GUEST → host voice slot; EXPERT/SKEPTIC → expert slot.
const SPEAKER_VOICE_HOST_SET = new Set(['HOST', 'GUEST']);
import type { VoiceMatchMetadata } from '../../voice-pool';

interface HumeTtsResponse {
  generations: Array<{
    audio: string; // base64
    duration: number;
  }>;
}

export class HumeProvider implements TtsProvider {
  readonly providerId: TtsProviderId = 'hume';
  private apiKey: string;
  private model: string;

  constructor(apiKey: string, model?: string) {
    this.apiKey = apiKey;
    this.model = model ?? 'octave';
  }

  async generateSpeech(params: SpeechParams): Promise<Buffer> {
    // Map direction to Hume description (always provides a value — falls back to speaker baseline)
    const expression = mapDirectionToExpression(params.direction, params.speaker, 'hume');
    const description = expression.hume?.description;

    const utterance: Record<string, unknown> = {
      text: params.text,
      voice: { id: params.voiceId },
      speed: 1,
      trailing_silence: 0.3,
    };

    // Add description for acting instructions (Octave's core differentiator)
    if (description) {
      utterance.description = description;
    }

    const response = await fetch('https://api.hume.ai/v0/tts', {
      method: 'POST',
      headers: {
        'X-Hume-Api-Key': this.apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        utterances: [utterance],
        format: { type: 'mp3' },
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Hume AI API error (${response.status}): ${errorText}`);
    }

    const data: HumeTtsResponse = await response.json();
    if (!data.generations?.length || !data.generations[0].audio) {
      throw new Error('Hume AI returned no audio data');
    }

    logger.info('Hume AI speech generated', {
      voiceId: params.voiceId,
      chars: params.text.length,
      description: description ?? 'none',
    });
    return Buffer.from(data.generations[0].audio, 'base64');
  }

  getVoiceId(speaker: string, podcastId?: string, metadata?: VoiceMatchMetadata): string {
    const isHostVoice = SPEAKER_VOICE_HOST_SET.has(speaker.toUpperCase());
    if (!podcastId) {
      return isHostVoice ? HUME_VOICE_POOL[0].id : HUME_VOICE_POOL[1].id;
    }
    const pair = selectVoicePairFromPool(HUME_VOICE_POOL, podcastId, metadata);
    return isHostVoice ? pair.host.id : pair.expert.id;
  }

  getModelId(): string {
    return this.model;
  }
}
