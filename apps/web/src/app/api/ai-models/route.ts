import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { listAiProviders } from '@/lib/byok';
import { getAiProviderMeta, type AiProviderId } from '@/lib/providers/ai-registry';
import { getFreeTierConfig } from '@/lib/free-tier-config';

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const aiKeys = await listAiProviders(session.user.id);
  const validKeys = aiKeys.filter((k) => k.isValid);

  // No BYOK AI key → return free tier model as read-only
  if (validKeys.length === 0) {
    const config = await getFreeTierConfig();
    const provider = getAiProviderMeta(config.aiProvider);
    const freeTierModel = provider.models.find((m) => m.id === config.aiModel);

    return NextResponse.json({
      provider: provider.id,
      readOnly: true,
      models: freeTierModel
        ? [
            {
              id: freeTierModel.id,
              displayName: freeTierModel.displayName,
              tier: freeTierModel.tier,
              isDefault: true,
            },
          ]
        : [],
    });
  }

  // Return models for the user's BYOK AI provider
  const primaryKey = validKeys[0];
  const provider = getAiProviderMeta(primaryKey.provider as AiProviderId);

  return NextResponse.json({
    provider: provider.id,
    readOnly: false,
    models: provider.models.map((m) => ({
      id: m.id,
      displayName: m.displayName,
      tier: m.tier,
      isDefault: m.id === provider.defaultModel,
    })),
  });
}
