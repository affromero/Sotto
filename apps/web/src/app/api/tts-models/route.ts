import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { listByokProviders } from '@/lib/byok';
import { getProviderMeta, isValidProviderId, type TtsProviderId } from '@/lib/providers/tts-registry';

export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const providerId = new URL(request.url).searchParams.get('provider');
  if (!providerId || !isValidProviderId(providerId)) {
    return NextResponse.json({ models: [], provider: null });
  }

  const byokProviders = await listByokProviders(session.user.id);
  const hasKey = byokProviders.some((p) => p.provider === providerId && p.isValid);
  if (!hasKey) {
    return NextResponse.json({ models: [], provider: null });
  }

  const meta = getProviderMeta(providerId as TtsProviderId);
  return NextResponse.json({
    provider: meta.id,
    models: meta.models.map((m) => ({
      id: m.id,
      displayName: m.displayName,
      tier: m.tier,
      isDefault: m.id === meta.defaultModel,
    })),
  });
}
