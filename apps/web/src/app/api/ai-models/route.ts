import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { listAiProviders } from '@/lib/byok';
import { getAiProviderMeta, type AiProviderId } from '@/lib/providers/ai-registry';

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const aiKeys = await listAiProviders(session.user.id);
  const validKeys = aiKeys.filter((k) => k.isValid);

  // No BYOK AI key → free tier users get admin-configured model, no selection
  if (validKeys.length === 0) {
    return NextResponse.json({ models: [], provider: null });
  }

  // Return models for the user's BYOK AI provider
  const primaryKey = validKeys[0];
  const provider = getAiProviderMeta(primaryKey.provider as AiProviderId);

  return NextResponse.json({
    provider: provider.id,
    models: provider.models.map((m) => ({
      id: m.id,
      displayName: m.displayName,
      tier: m.tier,
      isDefault: m.id === provider.defaultModel,
    })),
  });
}
