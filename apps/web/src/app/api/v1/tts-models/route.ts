import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequest } from '@/lib/api-keys';
import { listByokProviders } from '@/lib/byok';
import {
  getProviderMeta,
  isValidProviderId,
  type TtsProviderId,
} from '@/lib/providers/tts-registry';

import { errorResponse } from '@/lib/api-response';
import { getSiteConfig } from '@/lib/site-config';

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
  const authed = await authenticateRequest(request);
  if (!authed) {
    return errorResponse('Unauthorized', 401);
  }
  const userId = authed.userId;

  const providerId = new URL(request.url).searchParams.get('provider');
  if (!providerId || !isValidProviderId(providerId)) {
    return NextResponse.json({ models: [], provider: null });
  }

  const byokProviders = await listByokProviders(userId);
  const hasKey = byokProviders.some((p) => p.provider === providerId && p.isValid);
  if (hasKey) {
    return modelsResponse(providerId as TtsProviderId);
  }

  const configuration = await getSiteConfig();
  if (
    (providerId === 'local' || providerId === 'kokoro') &&
    configuration.ttsProvider === providerId &&
    Boolean(configuration.ttsBaseUrl?.trim())
  )
    return modelsResponse(providerId);

  return NextResponse.json({ models: [], provider: null });
}
