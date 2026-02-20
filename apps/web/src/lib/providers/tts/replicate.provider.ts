/**
 * Replicate TTS provider — Qwen3-TTS via Replicate's hosted API.
 */
import { logger } from '../../logger';
import type { TtsProvider, SpeechParams } from '../tts';
import type { TtsProviderId } from '../tts-registry';
import { FAL_VOICE_POOL, selectVoicePairFromPool } from '../tts-voices';
import type { VoiceMatchMetadata } from '../../voice-pool';

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
    this.model = model ?? 'qwen3-tts';
  }

  async generateSpeech(params: SpeechParams): Promise<Buffer> {
    const response = await fetch('https://api.replicate.com/v1/models/qwen/qwen3-tts/predictions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
        Prefer: 'wait',
      },
      body: JSON.stringify({
        input: { text: params.text, voice: params.voiceId },
      }),
    });

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

    logger.info('Replicate speech generated', { voiceId: params.voiceId, chars: params.text.length });
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

  getVoiceId(speaker: string, podcastId?: string, metadata?: VoiceMatchMetadata): string {
    if (!podcastId) {
      return speaker === 'HOST' ? FAL_VOICE_POOL[0].id : FAL_VOICE_POOL[1].id;
    }
    const pair = selectVoicePairFromPool(FAL_VOICE_POOL, podcastId, metadata);
    return speaker === 'HOST' ? pair.host.id : pair.expert.id;
  }

  getModelId(): string {
    return this.model;
  }
}
