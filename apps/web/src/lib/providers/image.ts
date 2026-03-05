/**
 * Image provider interface + resolution logic.
 * Follows the same pattern as providers/tts.ts.
 */
import { logger } from '../logger';
import { getByokKey } from '../byok';
import { getAutoModelConfig } from '../auto-model-config';
import type { ImageProviderId } from './image-registry';

export interface ImageProvider {
  generateImage(params: { prompt: string; width?: number; height?: number }): Promise<Buffer>;
  getModelId(): string;
  readonly providerId: ImageProviderId;
}

export interface ResolvedImageProvider {
  provider: ImageProvider;
  source: 'byok' | 'platform';
  providerId: ImageProviderId;
}

/**
 * Resolve the best image provider for video generation.
 *
 * Resolution order:
 * 1. BYOK key via getByokKey(userId, 'fal') — fal keys are shared between TTS and image use
 * 2. Platform key (FAL_KEY from env)
 * 3. Auto-model config defaults
 */
export async function resolveImageProvider(context: {
  userId: string;
  requestedModel?: string | null;
}): Promise<ResolvedImageProvider> {
  const { userId, requestedModel } = context;

  const config = await getAutoModelConfig();
  const model = requestedModel ?? config.proImageModel ?? 'flux-schnell';

  // Try BYOK fal key first (shared with TTS — fal keys stored in UserTtsKey)
  const byokKey = await getByokKey(userId, 'fal');
  if (byokKey) {
    const { FalImageProvider } = await import('./image/fal.provider');
    return {
      provider: new FalImageProvider(byokKey, model),
      source: 'byok',
      providerId: 'fal',
    };
  }

  // Platform key
  if (process.env.FAL_KEY) {
    const { FalImageProvider } = await import('./image/fal.provider');
    return {
      provider: new FalImageProvider(process.env.FAL_KEY, model),
      source: 'platform',
      providerId: 'fal',
    };
  }

  logger.error('No fal API key available for image generation', { userId });
  throw new Error('No image provider available. Add a fal API key in Settings or contact support.');
}
