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
  plan?: 'FREE' | 'PRO';
}): Promise<ResolvedVideoProvider> {
  const { userId, requestedModel, plan } = context;

  const config = await getAutoModelConfig();
  const tier = plan ?? 'PRO';
  const defaultModel = tier === 'FREE' ? config.freeVideoModel : config.proVideoModel;
  const model = requestedModel ?? defaultModel ?? 'fal-wan2.5-480p';

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
