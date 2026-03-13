/**
 * Avatar provider interface + resolution logic.
 * Supports HeyGen, Runway, and Fal providers.
 */
import { logger } from '../logger';
import { getByokKey } from '../byok';
import { getAutoModelConfig } from '../auto-model-config';
import { getAvatarProviderMeta } from './avatar-registry';
import type { AvatarProviderId } from './avatar-registry';
import type { HeyGenAvatar } from '../heygen';
import type { UnifiedAvatarData } from '@/types/avatar';

export interface AvatarProvider {
  listAvatars(): Promise<HeyGenAvatar[]>;
  generateAvatar(params: { avatarId: string; audioUrl: string }): Promise<Buffer>;
  getModelId(): string;
  readonly providerId: AvatarProviderId;
}

export interface ResolvedAvatarProvider {
  provider: AvatarProvider;
  source: 'byok' | 'platform';
  providerId: AvatarProviderId;
  apiKey: string;
}

/**
 * Resolve the best avatar provider.
 *
 * Resolution order (per resolved provider from AutoModelConfig):
 * 1. BYOK key for the resolved provider
 * 2. Platform key from env
 * Falls back across providers if the resolved one is unavailable.
 */
export async function resolveAvatarProvider(context: {
  userId: string;
  plan?: 'FREE' | 'PRO';
}): Promise<ResolvedAvatarProvider> {
  const { userId } = context;

  const config = await getAutoModelConfig();
  const tier = context.plan ?? 'PRO';
  const resolvedProvider = (tier === 'FREE' ? config.freeAvatarProvider : config.proAvatarProvider) as AvatarProviderId;
  const model = tier === 'FREE' ? config.freeAvatarModel : config.proAvatarModel;

  // Skip disabled providers
  const providerMeta = getAvatarProviderMeta(resolvedProvider);
  const effectiveProvider = providerMeta.disabled ? 'heygen' : resolvedProvider;

  // Try resolved provider first
  if (effectiveProvider === 'fal') {
    const byokKey = await getByokKey(userId, 'fal');
    if (byokKey) return buildFalProvider(byokKey, model, 'byok');
    if (process.env.FAL_KEY) return buildFalProvider(process.env.FAL_KEY, model, 'platform');
  }

  if (effectiveProvider === 'runway') {
    const byokKey = await getByokKey(userId, 'runway');
    if (byokKey) return buildRunwayProvider(byokKey, model, 'byok');
    if (process.env.RUNWAY_API_KEY) return buildRunwayProvider(process.env.RUNWAY_API_KEY, model, 'platform');
  }

  // HeyGen (default or fallback)
  const byokKey = await getByokKey(userId, 'heygen');
  if (byokKey) return buildHeyGenProvider(byokKey, model, 'byok');
  if (process.env.HEYGEN_API_KEY) return buildHeyGenProvider(process.env.HEYGEN_API_KEY, model, 'platform');

  logger.error('No avatar API key available', { userId, resolvedProvider });
  throw new Error('No avatar API key available. Add a key in Settings or contact support.');
}

/**
 * List avatars from all available providers as unified data.
 */
export async function listUnifiedAvatars(apiKey: string, provider: AvatarProviderId, userId?: string): Promise<UnifiedAvatarData[]> {
  if (provider === 'fal') {
    if (!userId) return [];
    const { prisma } = await import('../prisma');
    const images = await prisma.avatarImage.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });
    return images.map((img) => ({
      id: img.id,
      name: img.name,
      previewImageUrl: img.imageUrl,
      imageUrl: img.imageUrl,
      provider: 'fal' as const,
      isPreset: false,
      premium: false,
    }));
  }

  if (provider === 'runway') {
    const { listRunwayPresets, listRunwayAvatars } = await import('../runway');
    const presets: UnifiedAvatarData[] = listRunwayPresets().map((p) => ({
      id: p.id,
      name: p.name,
      previewImageUrl: p.previewImageUrl,
      provider: 'runway',
      isPreset: true,
      premium: false,
    }));
    try {
      const custom = await listRunwayAvatars(apiKey);
      const customUnified: UnifiedAvatarData[] = custom.map((a) => ({
        id: a.id,
        name: a.name,
        previewImageUrl: a.processedImageUri,
        provider: 'runway',
        isPreset: false,
        premium: false,
      }));
      return [...presets, ...customUnified];
    } catch {
      return presets;
    }
  }

  // HeyGen
  const { listAvatars } = await import('../heygen');
  const avatars = await listAvatars(apiKey);
  return avatars.filter((a) => !a.premium).map((a) => ({
    id: a.avatar_id,
    name: a.avatar_name,
    previewImageUrl: a.preview_image_url,
    provider: 'heygen',
    isPreset: false,
    premium: a.premium,
  }));
}

function buildHeyGenProvider(
  apiKey: string,
  model: string,
  source: 'byok' | 'platform',
): ResolvedAvatarProvider {
  const provider: AvatarProvider = {
    providerId: 'heygen',

    getModelId() {
      return model;
    },

    async listAvatars() {
      const { listAvatars } = await import('../heygen');
      return listAvatars(apiKey);
    },

    async generateAvatar(params) {
      const { generateAvatarVideo } = await import('../heygen');
      return generateAvatarVideo({
        apiKey,
        avatarId: params.avatarId,
        audioUrl: params.audioUrl,
      });
    },
  };

  return { provider, source, providerId: 'heygen', apiKey };
}

function buildRunwayProvider(
  apiKey: string,
  model: string,
  source: 'byok' | 'platform',
): ResolvedAvatarProvider {
  const provider: AvatarProvider = {
    providerId: 'runway',

    getModelId() {
      return model;
    },

    async listAvatars() {
      // Return empty — Runway avatars are listed via listUnifiedAvatars
      return [];
    },

    async generateAvatar() {
      // Runway generation is handled by the worker directly (realtime sessions)
      throw new Error('Runway avatar generation is handled via the worker pipeline');
    },
  };

  return { provider, source, providerId: 'runway', apiKey };
}

function buildFalProvider(
  apiKey: string,
  model: string,
  source: 'byok' | 'platform',
): ResolvedAvatarProvider {
  const provider: AvatarProvider = {
    providerId: 'fal',

    getModelId() {
      return model;
    },

    async listAvatars() {
      // Fal lip-sync uses user-uploaded images, not a catalog
      return [];
    },

    async generateAvatar() {
      // Fal generation is handled by the worker pipeline
      throw new Error('Fal lip-sync avatar generation is handled via the worker pipeline');
    },
  };

  return { provider, source, providerId: 'fal', apiKey };
}
