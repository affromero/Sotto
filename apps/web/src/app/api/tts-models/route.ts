import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { listByokProviders } from '@/lib/byok';
import { getProviderMeta, isValidProviderId, type TtsProviderId } from '@/lib/providers/tts-registry';

import { errorResponse } from '@/lib/api-response';
// Env var names for each platform-level TTS provider key
const PLATFORM_TTS_ENV: Partial<Record<TtsProviderId, string>> = {
  elevenlabs: 'ELEVENLABS_API_KEY',
  openai: 'OPENAI_API_KEY',
};

function modelsResponse(providerId: TtsProviderId) {
  const meta = getProviderMeta(providerId);
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

export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return errorResponse('Unauthorized', 401);
  }

  const providerId = new URL(request.url).searchParams.get('provider');
  if (!providerId || !isValidProviderId(providerId)) {
    return NextResponse.json({ models: [], provider: null });
  }

  const byokProviders = await listByokProviders(session.user.id);
  const hasKey = byokProviders.some((p) => p.provider === providerId && p.isValid);
  if (hasKey) {
    return modelsResponse(providerId as TtsProviderId);
  }

  // No BYOK key — admins fall back to platform env vars
  const isAdmin = session.user.role === 'ADMIN';
  if (isAdmin) {
    const envVar = PLATFORM_TTS_ENV[providerId as TtsProviderId];
    if (envVar && process.env[envVar]) {
      return modelsResponse(providerId as TtsProviderId);
    }
  }

  return NextResponse.json({ models: [], provider: null });
}
