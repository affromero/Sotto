import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth-guards';
import { getAllAiProviderMeta } from '@/lib/providers/ai-registry';
import { getAllProviderMeta } from '@/lib/providers/tts-registry';
import { errorResponse } from '@/lib/api-response';

export async function GET() {
  const adminId = await requireAdmin();
  if (!adminId) {
    return errorResponse('Forbidden', 403);
  }

  const aiProviders = getAllAiProviderMeta()
    .filter((p) => p.models.length > 0 && p.id !== 'claude-code')
    .map((p) => ({
      id: p.id,
      displayName: p.displayName,
      models: p.models.map((m) => ({
        id: m.id,
        displayName: m.displayName,
        tier: m.tier,
      })),
    }));

  const ttsProviders = getAllProviderMeta().map((p) => ({
    id: p.id,
    displayName: p.displayName,
    models: p.models.map((m) => ({
      id: m.id,
      displayName: m.displayName,
      tier: m.tier,
    })),
  }));

  return NextResponse.json({ aiProviders, ttsProviders });
}
