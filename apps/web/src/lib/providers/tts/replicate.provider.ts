/**
 * Replicate TTS provider — supports Inworld TTS 1.5 (Max/Mini) and Qwen3-TTS.
 *
 * Inworld models support emotion markup ([happy], [sad], etc.) and use `voice_id`.
 * Qwen3-TTS uses `voice` with no expression support.
 *
 * @tts-research-date 2026-03-11 — Inworld TTS 1.5 Max/Mini added
 */
import { logger } from '../../logger';
import { replicateFetch } from '../../replicate-fetch';
import type { TtsProvider, SpeechParams } from '../tts';
import { getProviderMeta, type TtsProviderId } from '../tts-registry';
import { FAL_VOICE_POOL, INWORLD_VOICE_POOL, selectVoicePairFromPool } from '../tts-voices';
import { mapDirectionToExpression } from '../../tts-expression-mapper';
import type { VoiceMatchMetadata } from '../../voice-pool';

// HOST/GUEST → host voice slot; EXPERT/SKEPTIC → expert slot.
const SPEAKER_VOICE_HOST_SET = new Set(['HOST', 'GUEST']);

/** Replicate model path lookup — model ID → owner/model-name on Replicate */
const MODEL_PATHS: Record<string, string> = {
  'inworld-tts-1.5-max': 'inworld/tts-1.5-max',
  'inworld-tts-1.5-mini': 'inworld/tts-1.5-mini',
  'qwen3-tts': 'qwen/qwen3-tts',
};

/** Inworld models have a 2000-char limit and different input schema */
function isInworldModel(model: string): boolean {
  return model.startsWith('inworld-');
}

interface ReplicatePrediction {
  id: string;
  status: 'starting' | 'processing' | 'succeeded' | 'failed' | 'canceled';
  output: string | null;
  error: string | null;
}

export class ReplicateProvider implements TtsProvider {
  readonly providerId: TtsProviderId = 'replicate';
  private apiKey: string;
  private model: string;

  constructor(apiKey: string, model?: string) {
    this.apiKey = apiKey;
    this.model = model ?? getProviderMeta('replicate').defaultModel;
  }

  async generateSpeech(params: SpeechParams): Promise<Buffer> {
    const resolvedModel = MODEL_PATHS[this.model] ? this.model : 'inworld-tts-1.5-max';
    const modelPath = MODEL_PATHS[resolvedModel];
    const inworld = isInworldModel(resolvedModel);

    let text = params.text;

    // Inworld: enforce 2000-char limit + prepend emotion tag from expression mapper
    if (inworld) {
      const expression = mapDirectionToExpression(params.direction, params.speaker, 'replicate');
      if (expression.replicate?.emotionTag) {
        text = `${expression.replicate.emotionTag}${text}`;
      }
      if (text.length > 2000) {
        text = text.slice(0, 2000);
      }
    }

    // Inworld uses `voice_id`, Qwen3 uses `voice`
    const input: Record<string, unknown> = inworld
      ? { text, voice_id: params.voiceId, audio_format: 'mp3' }
      : { text, voice: params.voiceId };

    let response: Response;
    try {
      response = await replicateFetch(`https://api.replicate.com/v1/models/${modelPath}/predictions`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
          Prefer: 'wait',
        },
        body: JSON.stringify({ input }),
      });
    } catch (error) {
      if (
        error instanceof Error &&
        error.name === 'ReplicateFetchError' &&
        'status' in error &&
        'bodyText' in error
      ) {
        throw new Error(
          `Replicate API error (${String(error.status)}): ${String(error.bodyText)}`,
        );
      }
      throw error;
    }

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Replicate API error (${response.status}): ${errorText}`);
    }

    let prediction: ReplicatePrediction = await response.json();

    if (prediction.status !== 'succeeded') {
      prediction = await this.pollPrediction(prediction.id);
    }

    if (prediction.status === 'failed') {
      throw new Error(`Replicate prediction failed: ${prediction.error}`);
    }

    if (!prediction.output) {
      throw new Error('Replicate returned no audio output');
    }

    const audioResponse = await fetch(prediction.output);
    if (!audioResponse.ok) {
      throw new Error(`Failed to download Replicate audio: ${audioResponse.status}`);
    }

    logger.info('Replicate speech generated', {
      model: this.model, voiceId: params.voiceId, chars: params.text.length,
    });
    const arrayBuffer = await audioResponse.arrayBuffer();
    return Buffer.from(arrayBuffer);
  }

  private async pollPrediction(id: string): Promise<ReplicatePrediction> {
    let delay = 1000;
    for (let attempt = 0; attempt < 60; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, delay));
      delay = Math.min(delay * 1.3, 5000);

      const response = await fetch(`https://api.replicate.com/v1/predictions/${id}`, {
        headers: { Authorization: `Bearer ${this.apiKey}` },
      });

      if (!response.ok) continue;

      const prediction: ReplicatePrediction = await response.json();
      if (prediction.status === 'succeeded' || prediction.status === 'failed' || prediction.status === 'canceled') {
        return prediction;
      }
    }
    throw new Error('Replicate prediction timed out after 60 poll attempts');
  }

  getVoiceId(speaker: string, podcastId?: string, metadata?: VoiceMatchMetadata, _language?: string): string {
    const pool = isInworldModel(this.model) ? INWORLD_VOICE_POOL : FAL_VOICE_POOL;
    const isHostVoice = SPEAKER_VOICE_HOST_SET.has(speaker.toUpperCase());
    if (!podcastId) {
      return isHostVoice ? pool[0].id : pool[1].id;
    }
    const pair = selectVoicePairFromPool(pool, podcastId, metadata);
    return isHostVoice ? pair.host.id : pair.expert.id;
  }

  getModelId(): string {
    return this.model;
  }
}
