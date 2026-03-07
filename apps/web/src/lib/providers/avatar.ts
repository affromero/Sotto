/**
 * Avatar provider interface + resolution logic.
 * Wraps the existing lib/heygen.ts client.
 */
import { logger } from '../logger';
import { getByokKey } from '../byok';
import { getAutoModelConfig } from '../auto-model-config';
import type { AvatarProviderId } from './avatar-registry';
import type { HeyGenAvatar } from '../heygen';

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
 * Resolution order:
 * 1. BYOK key (heygen keys stored in UserTtsKey as 'heygen')
 * 2. Platform key from env (HEYGEN_API_KEY)
 */
export async function resolveAvatarProvider(context: {
  userId: string;
  plan?: 'FREE' | 'PRO';
}): Promise<ResolvedAvatarProvider> {
  const { userId } = context;

  const config = await getAutoModelConfig();
  const tier = context.plan ?? 'PRO';
  const model = tier === 'FREE' ? config.freeAvatarModel : config.proAvatarModel;

  const byokKey = await getByokKey(userId, 'heygen');
  if (byokKey) {
    return buildHeyGenProvider(byokKey, model, 'byok');
  }

  if (process.env.HEYGEN_API_KEY) {
    return buildHeyGenProvider(process.env.HEYGEN_API_KEY, model, 'platform');
  }

  logger.error('No HeyGen API key available for avatar generation', { userId });
  throw new Error('No HeyGen API key available. Add a HeyGen key in Settings or contact support.');
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
