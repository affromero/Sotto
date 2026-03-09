import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth-guards';
import { errorResponse } from '@/lib/api-response';
import { getVoiceCatalog } from '@/lib/voice-catalog';
import type { TtsProviderId } from '@/lib/providers/tts-registry';

const TTS_PROVIDER_IDS = new Set([
  'elevenlabs', 'openai', 'cartesia', 'hume', 'fal', 'replicate', 'minimax', 'kittentts',
]);

/** GET /api/admin/showcase/voices?provider=X — Voice catalog for a provider */
export async function GET(request: NextRequest) {
  const adminId = await requireAdmin();
  if (!adminId) return errorResponse('Forbidden', 403);

  const provider = request.nextUrl.searchParams.get('provider');
  if (!provider || !TTS_PROVIDER_IDS.has(provider)) {
    return errorResponse('Invalid or missing provider parameter', 400);
  }

  const voices = await getVoiceCatalog(provider as TtsProviderId);
  return NextResponse.json({ voices });
}
