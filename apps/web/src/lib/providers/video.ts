/**
 * Video provider interface + resolution logic.
 * Follows the same pattern as providers/image.ts.
 */
import { logger } from '../logger';
import { getByokKey } from '../byok';
import { getAutoModelConfig } from '../auto-model-config';
import { getVideoModelProvider, type VideoProviderId } from './video-registry';

export interface VideoProvider {
  generateVideo(params: { prompt: string; duration?: number; firstFrameImage?: string; lastFrameImage?: string }): Promise<Buffer>;
  getModelId(): string;
  readonly providerId: VideoProviderId;
}

export interface ResolvedVideoProvider {
  provider: VideoProvider;
  source: 'byok' | 'platform';
  providerId: VideoProviderId;
}

/**
 * Resolve the best video provider for a given model.
 *
 * Resolution order per provider:
 * 1. BYOK key (fal keys stored in UserTtsKey as 'fal', minimax as 'minimax')
 * 2. Platform key from env (FAL_KEY or MINIMAX_API_KEY)
 */
export async function resolveVideoProvider(context: {
  userId: string;
  requestedModel?: string | null;
}): Promise<ResolvedVideoProvider> {
  const { userId, requestedModel } = context;

  const config = await getAutoModelConfig();
  const model = requestedModel ?? config.videoModel ?? 'fal-wan2.5-480p';

  const providerId = getVideoModelProvider(model);
  if (!providerId) {
    throw new Error(`Unknown video model: ${model}. No provider found.`);
  }

  if (providerId === 'fal') {
    return resolveFalVideo(userId, model);
  }

  if (providerId === 'minimax') {
    return resolveMiniMaxVideo(userId, model);
  }

  if (providerId === 'hera') {
    return resolveHeraVideo(model);
  }

  if (providerId === 'replicate') {
    return resolveReplicateVideo(userId, model);
  }

  throw new Error(`Unsupported video provider: ${providerId}`);
}

async function resolveFalVideo(userId: string, model: string): Promise<ResolvedVideoProvider> {
  const byokKey = await getByokKey(userId, 'fal');
  if (byokKey) {
    const { FalVideoProvider } = await import('./video/fal.provider');
    return { provider: new FalVideoProvider(byokKey, model), source: 'byok', providerId: 'fal' };
  }

  if (process.env.FAL_KEY) {
    const { FalVideoProvider } = await import('./video/fal.provider');
    return { provider: new FalVideoProvider(process.env.FAL_KEY, model), source: 'platform', providerId: 'fal' };
  }

  logger.error('No fal API key available for video generation', { userId });
  throw new Error('No Fal API key available. Add a Fal key in Settings or contact support.');
}

async function resolveMiniMaxVideo(userId: string, model: string): Promise<ResolvedVideoProvider> {
  const byokKey = await getByokKey(userId, 'minimax');
  if (byokKey) {
    const { MiniMaxVideoProvider } = await import('./video/minimax.provider');
    return { provider: new MiniMaxVideoProvider(byokKey, model), source: 'byok', providerId: 'minimax' };
  }

  if (process.env.MINIMAX_API_KEY) {
    const { MiniMaxVideoProvider } = await import('./video/minimax.provider');
    return { provider: new MiniMaxVideoProvider(process.env.MINIMAX_API_KEY, model), source: 'platform', providerId: 'minimax' };
  }

  logger.error('No MiniMax API key available for video generation', { userId });
  throw new Error('No MiniMax API key available. Add a MiniMax key in Settings or contact support.');
}

async function resolveHeraVideo(model: string): Promise<ResolvedVideoProvider> {
  if (process.env.HERA_API_KEY) {
    const { HeraVideoProvider } = await import('./video/hera.provider');
    return { provider: new HeraVideoProvider(model), source: 'platform', providerId: 'hera' };
  }

  logger.error('No Hera API key available for video generation');
  throw new Error('No Hera API key available. Set HERA_API_KEY in your deployment environment.');
}

async function resolveReplicateVideo(userId: string, model: string): Promise<ResolvedVideoProvider> {
  const byokKey = await getByokKey(userId, 'replicate');
  if (byokKey) {
    const { ReplicateVideoProvider } = await import('./video/replicate.provider');
    return { provider: new ReplicateVideoProvider(byokKey, model), source: 'byok', providerId: 'replicate' };
  }

  if (process.env.REPLICATE_API_TOKEN) {
    const { ReplicateVideoProvider } = await import('./video/replicate.provider');
    return { provider: new ReplicateVideoProvider(process.env.REPLICATE_API_TOKEN, model), source: 'platform', providerId: 'replicate' };
  }

  logger.error('No Replicate API key available for video generation', { userId });
  throw new Error('No Replicate API key available. Add a Replicate key in Settings or contact support.');
}
