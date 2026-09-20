/**
 * Replicate TTS provider — supports Inworld TTS 1.5 (Max/Mini) and Qwen3-TTS.
 *
 * Inworld models support emotion markup ([happy], [sad], etc.) and use `voice_id`.
 * Qwen3-TTS uses `voice` with no expression support.
 *
 * @tts-research-date 2026-03-11 — Inworld TTS 1.5 Max/Mini added
 */
import { logger } from '../../logger';
import { setTimeout as delay } from 'node:timers/promises';
import type { TtsProvider, SpeechParams } from '../tts';
import { getProviderMeta, type TtsProviderId } from '../tts-registry';
import { FAL_VOICE_POOL, INWORLD_VOICE_POOL, selectVoicePairFromPool } from '../tts-voices';
import { mapDirectionToExpression } from '../../tts-expression-mapper';
import type { VoiceMatchMetadata } from '../../voice-pool';
import { VOICE_LANGUAGE_AFFINITIES } from '../../tts-language-support';
import type { MediaTransport, ProviderTransport } from 'thesidedoor-core/providers/transport';

// HOST/GUEST → host voice slot; EXPERT/SKEPTIC → expert slot.
const SPEAKER_VOICE_HOST_SET = new Set(['HOST', 'GUEST']);
const MAX_RATE_LIMIT_RETRIES = 4;
const DEFAULT_RETRY_DELAY_MS = 8000;

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

/** ISO 639-1 → Qwen3 language name mapping (same as Fal provider). */
const QWEN3_LANGUAGE_MAP: Record<string, string> = {
  zh: 'Chinese',
  en: 'English',
  ja: 'Japanese',
  ko: 'Korean',
  fr: 'French',
  de: 'German',
  es: 'Spanish',
  it: 'Italian',
  pt: 'Portuguese',
  ru: 'Russian',
};

interface ReplicatePrediction {
  id: string;
  status: 'starting' | 'processing' | 'succeeded' | 'failed' | 'canceled';
  output: string | null;
  error: string | null;
}

function retryDelay(bodyText: string): number {
  try {
    const parsed = JSON.parse(bodyText) as { retry_after?: unknown; detail?: unknown };
    if (typeof parsed.retry_after === 'number' && parsed.retry_after > 0)
      return Math.ceil(parsed.retry_after * 1000);
    if (typeof parsed.detail === 'string') {
      const seconds = parsed.detail.match(/resets in ~(\d+)s/)?.[1];
      if (seconds) return Number.parseInt(seconds, 10) * 1000;
    }
  } catch {}
  return DEFAULT_RETRY_DELAY_MS;
}

export class ReplicateProvider implements TtsProvider {
  static readonly predictionRoot = 'https://api.replicate.com/v1/predictions/';
  static readonly speechEndpoints = Object.freeze(
    Object.values(MODEL_PATHS).map(
      (path) => `https://api.replicate.com/v1/models/${path}/predictions`
    )
  );
  readonly providerId: TtsProviderId = 'replicate';
  private apiKey: string;
  private model: string;

  constructor(
    apiKey: string,
    private readonly transport: ProviderTransport,
    private readonly media: MediaTransport,
    model?: string
  ) {
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

    // Inworld uses `voice_id`, Qwen3 uses `speaker` + `mode`
    const input: Record<string, unknown> = inworld
      ? { text, voice_id: params.voiceId, audio_format: 'mp3' }
      : { text, speaker: params.voiceId, mode: 'custom_voice' };

    // Pass language hint for Qwen3-TTS (accepts language names or 'auto')
    if (!inworld) {
      const langName = params.language ? QWEN3_LANGUAGE_MAP[params.language] : undefined;
      input.language = langName ?? 'auto';
    }

    const response = await this.fetchWithRateLimitRetry(
      `https://api.replicate.com/v1/models/${modelPath}/predictions`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
          Prefer: 'wait',
        },
        body: JSON.stringify({ input }),
        signal: params.signal,
      },
      params,
      true
    );

    if (!response.ok) {
      const errorText = await response.text();
      if (response.status >= 400 && response.status < 500) params.onSettled?.();
      throw new Error(`Replicate API error (${response.status}): ${errorText}`);
    }

    let prediction: ReplicatePrediction = await response.json();

    if (prediction.status !== 'succeeded') {
      prediction = await this.pollPrediction(prediction.id, params);
    }
    params.onSettled?.();

    if (prediction.status === 'failed') {
      throw new Error(`Replicate prediction failed: ${prediction.error}`);
    }
    if (prediction.status === 'canceled') throw new Error('Replicate prediction was canceled');

    if (!prediction.output) {
      throw new Error('Replicate returned no audio output');
    }

    const audio = await this.media.downloadMedia(prediction.output, { signal: params.signal });

    logger.info('Replicate speech generated', {
      model: this.model,
      voiceId: params.voiceId,
      chars: params.text.length,
    });
    return Buffer.from(audio);
  }

  private async pollPrediction(id: string, params: SpeechParams): Promise<ReplicatePrediction> {
    let delayMs = 1000;
    for (let attempt = 0; attempt < 60; attempt++) {
      await delay(delayMs, undefined, { signal: params.signal });
      delayMs = Math.round(Math.min(delayMs * 1.3, 5000));

      const response = await this.fetchWithRateLimitRetry(
        `${ReplicateProvider.predictionRoot}${encodeURIComponent(id)}`,
        { headers: { Authorization: `Bearer ${this.apiKey}` }, signal: params.signal },
        params,
        false
      );

      if (!response.ok) {
        const body = await response.text();
        throw new Error(`Replicate API error (${response.status}): ${body}`);
      }

      const prediction: ReplicatePrediction = await response.json();
      if (
        prediction.status === 'succeeded' ||
        prediction.status === 'failed' ||
        prediction.status === 'canceled'
      ) {
        return prediction;
      }
    }
    throw new Error('Replicate prediction timed out after 60 poll attempts');
  }

  private async fetchWithRateLimitRetry(
    url: string,
    init: RequestInit,
    params: Pick<SpeechParams, 'onDispatch' | 'onSettled' | 'signal'>,
    effectful: boolean
  ): Promise<Response> {
    for (let attempt = 0; attempt <= MAX_RATE_LIMIT_RETRIES; attempt++) {
      const response = await this.transport.authenticatedFetch(url, init, {
        onDispatch: effectful ? (params.onDispatch ?? (() => {})) : () => {},
      });
      if (response.status !== 429) return response;
      const body = await response.text();
      if (effectful) params.onSettled?.();
      if (attempt === MAX_RATE_LIMIT_RETRIES)
        throw new Error(`Replicate API error (${response.status}): ${body}`);
      const delayMs = retryDelay(body);
      logger.warn('Replicate API rate limited, retrying', {
        attempt: attempt + 1,
        delayMs,
        status: response.status,
        url,
      });
      await delay(delayMs, undefined, { signal: params.signal });
    }
    throw new Error('Replicate rate-limit retry exhausted');
  }

  getVoiceId(
    speaker: string,
    episodeId?: string,
    metadata?: VoiceMatchMetadata,
    language?: string
  ): string {
    const pool = isInworldModel(this.model) ? INWORLD_VOICE_POOL : FAL_VOICE_POOL;
    const isHostVoice = SPEAKER_VOICE_HOST_SET.has(speaker.toUpperCase());

    // For Qwen3-TTS on Replicate, use voice affinities (same as Fal provider)
    if (!isInworldModel(this.model) && language && episodeId) {
      const nativeVoices = pool.filter((v) => {
        const affinity = VOICE_LANGUAGE_AFFINITIES[v.id];
        return affinity?.nativeLanguages.includes(language);
      });
      if (nativeVoices.length >= 2) {
        const pair = selectVoicePairFromPool(nativeVoices, episodeId, metadata);
        return isHostVoice ? pair.host.id : pair.expert.id;
      }
      if (nativeVoices.length === 1) {
        return isHostVoice ? nativeVoices[0].id : nativeVoices[0].id;
      }
    }

    if (!episodeId) {
      return isHostVoice ? pool[0].id : pool[1].id;
    }
    const pair = selectVoicePairFromPool(pool, episodeId, metadata);
    return isHostVoice ? pair.host.id : pair.expert.id;
  }

  getModelId(): string {
    return this.model;
  }
}
