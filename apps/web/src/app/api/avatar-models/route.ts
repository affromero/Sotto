import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { errorResponse } from '@/lib/api-response';
import { getAllAvatarProviderMeta } from '@/lib/providers/avatar-registry';
import { fetchAvatarModels } from '@/lib/avatar-cost-estimator';
import { getAutoModelConfig } from '@/lib/auto-model-config';

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return errorResponse('Unauthorized', 401);
  }

  const [allPricing, config] = await Promise.all([
    fetchAvatarModels(),
    getAutoModelConfig(),
  ]);

  const pricingMap = new Map(allPricing.map((m) => [m.modelId, m.costPerMinute]));

  // Admin/pro users see proIncludedAvatarModels; fall back to all non-disabled models
  const includedIds = config.proIncludedAvatarModels;
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
}
