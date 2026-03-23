/**
 * Replicate video provider — submit prediction → poll → download.
 * Follows the same async pattern as the Replicate TTS provider.
 */
import { logger } from '../../logger';
import { replicateFetch } from '../../replicate-fetch';
import type { VideoProvider } from '../video';
import type { VideoProviderId } from '../video-registry';

/** Map pricetoken model IDs to Replicate model paths (owner/model). */
const MODEL_PATHS: Record<string, string> = {
  'replicate-ltx-video-768p': 'lightricks/ltx-video',
  'replicate-pixverse-v4-360p': 'pixverse/pixverse-v4',
  'replicate-seedance1-lite-480p': 'bytedance/seedance-1-lite',
  'replicate-seedance1-pro-fast-720p': 'bytedance/seedance-1-pro-fast',
  'replicate-wan2.1-i2v-480p': 'wavespeedai/wan-2.1-i2v-480p',
  'replicate-wan2.1-i2v-720p': 'wavespeedai/wan-2.1-i2v-720p',
  'replicate-wan2.2-t2v-fast-480p': 'wan-video/wan-2.2-t2v-fast',
};

/** Models that use num_frames instead of duration. */
const FRAME_BASED_MODELS = new Set([
  'replicate-ltx-video-768p',
  'replicate-wan2.2-t2v-fast-480p',
]);

interface ReplicatePrediction {
  id: string;
  status: 'starting' | 'processing' | 'succeeded' | 'failed' | 'canceled';
  output: string | string[] | null;
  error: string | null;
}

/** Build model-specific input object from common video params. */
function buildInput(
  modelId: string,
  params: { prompt: string; duration?: number; firstFrameImage?: string; lastFrameImage?: string },
): Record<string, unknown> {
  const input: Record<string, unknown> = {
    prompt: params.prompt,
    aspect_ratio: '16:9',
  };

  if (params.firstFrameImage) {
    input.image = params.firstFrameImage;
  }

  if (params.lastFrameImage) {
    input.last_frame_image = params.lastFrameImage;
  }

  if (FRAME_BASED_MODELS.has(modelId)) {
    // Convert duration to frames at 24fps, default ~3s (81 frames)
    input.num_frames = params.duration ? Math.round(params.duration * 24) : 81;
  } else if (params.duration) {
    input.duration = Math.round(params.duration);
  }

  // Seedance models accept resolution
  if (modelId.includes('seedance')) {
    input.resolution = modelId.includes('720p') ? '720p' : '480p';
  }

  return input;
}

export class ReplicateVideoProvider implements VideoProvider {
  readonly providerId: VideoProviderId = 'replicate';
  private apiKey: string;
  private model: string;

  constructor(apiKey: string, model: string) {
    this.apiKey = apiKey;
    this.model = model;
  }

  getModelId(): string {
    return this.model;
  }

  async generateVideo(params: {
    prompt: string;
    duration?: number;
    firstFrameImage?: string;
    lastFrameImage?: string;
  }): Promise<Buffer> {
    const modelPath = MODEL_PATHS[this.model];
    if (!modelPath) throw new Error(`Unknown Replicate video model: ${this.model}`);

    const input = buildInput(this.model, params);

    logger.info('Submitting Replicate video prediction', {
      model: this.model,
      modelPath,
      hasImage: !!params.firstFrameImage,
    });

    let response: Response;
    try {
      response = await replicateFetch(
        `https://api.replicate.com/v1/models/${modelPath}/predictions`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json',
            Prefer: 'wait',
          },
          body: JSON.stringify({ input }),
        },
      );
    } catch (error) {
      if (
        error instanceof Error &&
        error.name === 'ReplicateFetchError' &&
        'status' in error &&
        'bodyText' in error
      ) {
        throw new Error(
          `Replicate video API error (${String(error.status)}): ${String(error.bodyText)}`,
        );
      }
      throw error;
    }

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Replicate video API error (${response.status}): ${errorText}`);
    }

    let prediction: ReplicatePrediction = await response.json();

    if (prediction.status !== 'succeeded') {
      prediction = await this.pollPrediction(prediction.id);
    }

    if (prediction.status === 'failed') {
      throw new Error(`Replicate video prediction failed: ${prediction.error}`);
    }

    const videoUrl = this.extractVideoUrl(prediction.output);
    if (!videoUrl) throw new Error('Replicate returned no video output');

    const videoRes = await fetch(videoUrl);
    if (!videoRes.ok) {
      throw new Error(`Failed to download Replicate video: ${videoRes.status}`);
    }

    logger.info('Replicate video generated', { model: this.model, modelPath });
    return Buffer.from(await videoRes.arrayBuffer());
  }

  private extractVideoUrl(output: string | string[] | null): string | null {
    if (!output) return null;
    if (typeof output === 'string') return output;
    if (Array.isArray(output)) return output[0] ?? null;
    return null;
  }

  private async pollPrediction(id: string): Promise<ReplicatePrediction> {
    let delay = 2000;
    for (let attempt = 0; attempt < 120; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, delay));
      delay = Math.min(delay * 1.2, 5000);

      const response = await fetch(`https://api.replicate.com/v1/predictions/${id}`, {
        headers: { Authorization: `Bearer ${this.apiKey}` },
      });

      if (!response.ok) continue;

      const prediction: ReplicatePrediction = await response.json();
      if (
        prediction.status === 'succeeded' ||
        prediction.status === 'failed' ||
        prediction.status === 'canceled'
      ) {
        return prediction;
      }
    }
    throw new Error('Replicate video prediction timed out after 120 poll attempts');
  }
}

/** Set of known Replicate video model IDs. */
export const REPLICATE_VIDEO_MODEL_IDS = new Set(Object.keys(MODEL_PATHS));
