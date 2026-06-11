import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { errorResponse } from '@/lib/api-response';
import { getAllAvatarProviderMeta } from '@/lib/providers/avatar-registry';
import { fetchAvatarModels } from '@/lib/avatar-cost-estimator';
import { getAutoModelConfig } from '@/lib/auto-model-config';
import { logger } from '@/lib/logger';

export async function GET() {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return errorResponse('Unauthorized', 401);
    }

    const [pricing, config] = await Promise.all([
      fetchAvatarModels().catch((err) => {
        logger.warn('Failed to fetch avatar pricing', { error: err instanceof Error ? err.message : String(err) });
        return [];
      }),
      getAutoModelConfig().catch((err) => {
        logger.warn('Failed to fetch auto-model config', { error: err instanceof Error ? err.message : String(err) });
        return null;
      }),
    ]);

    const pricingMap = new Map(pricing.map((m) => [m.modelId, m.costPerMinute]));
    const includedIds = config?.includedAvatarModels ?? null;
    const providers = getAllAvatarProviderMeta().filter((p) => !p.disabled);

    const models = providers.flatMap((provider) =>
      provider.models
        .filter((m) => !includedIds || includedIds.includes(m.id))
        .map((m) => ({
          id: m.id,
          name: m.displayName,
          tier: m.tier,
          provider: provider.id,
          costPerMinute: pricingMap.get(m.id) ?? null,
        }))
    );

    return NextResponse.json({ models });
  } catch (err) {
    logger.error('avatar-models endpoint failed', { error: err instanceof Error ? err.message : String(err) });
    return errorResponse('Failed to load avatar models', 500);
  }
}
