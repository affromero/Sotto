/**
 * Fal.ai image provider — FLUX image generation for video visuals.
 * Supports FLUX Schnell, FLUX 1.1 Pro, and FLUX 2 Pro.
 */
import { logger } from '../../logger';
import type { ImageProvider } from '../image';
import type { ImageProviderId } from '../image-registry';
import { getFalImageEndpoint } from '../fal-endpoints';

interface FalImageResponse {
  images: Array<{ url: string; content_type: string }>;
}

export class FalImageProvider implements ImageProvider {
  readonly providerId: ImageProviderId = 'fal';
  private apiKey: string;
  private model: string;

  constructor(apiKey: string, model?: string) {
    this.apiKey = apiKey;
    this.model = model ?? 'fal-flux-1-schnell';
  }

  getModelId(): string {
    return this.model;
  }

  async generateImage(params: { prompt: string; width?: number; height?: number }): Promise<Buffer> {
    const endpoint = getFalImageEndpoint(this.model);
    if (!endpoint) {
      throw new Error(`No Fal endpoint for image model: ${this.model}`);
    }

    const width = params.width ?? 1280;
    const height = params.height ?? 720;

    const url = `https://fal.run/${endpoint}`;

    logger.info('Generating image via fal', { model: this.model, width, height });

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Key ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        prompt: params.prompt,
        image_size: { width, height },
        num_images: 1,
        enable_safety_checker: true,
      }),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => 'unknown');
      throw new Error(`Fal image generation failed (${response.status}): ${text}`);
    }

    const data = (await response.json()) as FalImageResponse;
    if (!data.images?.[0]?.url) {
      throw new Error('Fal returned no images');
    }

    const imageUrl = data.images[0].url;
    const imageResponse = await fetch(imageUrl);
    if (!imageResponse.ok) {
      throw new Error(`Failed to download generated image: ${imageResponse.status}`);
    }

    const arrayBuffer = await imageResponse.arrayBuffer();
    return Buffer.from(arrayBuffer);
  }
}
