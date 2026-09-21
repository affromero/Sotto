import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequest } from '@/lib/api-keys';
import { getVoiceCatalog } from '@/lib/voice-catalog';
import { isValidProviderId, type TtsProviderId } from '@/lib/providers/tts-registry';
import { errorResponse } from '@/lib/api-response';
import { requireOriginalSottoAdmission } from '@/lib/sidedoor/access/core/request-identity';
import {
  captureSottoExecutionCredential,
  sottoExecutionCredentialFields,
} from '@/lib/sidedoor/credentials/runtime/credential-execution';
import { createSottoProviderTransport } from '@/lib/sidedoor/credentials/runtime/provider-execution';
import { sottoTransaction } from '@/lib/sidedoor/access/state/transaction';
import { prismaUnfiltered } from '@/lib/prisma';

export async function GET(request: NextRequest) {
  const authResult = await authenticateRequest(request);
  if (!authResult) {
    return errorResponse('Unauthorized', 401);
  }

  const providerParam = request.nextUrl.searchParams.get('provider');
  let provider: TtsProviderId = 'elevenlabs';
  if (providerParam) {
    if (!isValidProviderId(providerParam)) {
      return errorResponse('Invalid provider', 400);
    }
    provider = providerParam;
  }

  const dynamic = provider === 'elevenlabs' || provider === 'cartesia' || provider === 'hume';
  const authorize = async (database: Parameters<typeof requireOriginalSottoAdmission>[0]) => {
    await requireOriginalSottoAdmission(database, request, authResult);
    return { userId: authResult.userId };
  };
  const credential = dynamic
    ? await sottoTransaction(prismaUnfiltered, (database) =>
        captureSottoExecutionCredential(database, authorize, 'tts', provider, true, request.signal)
      )
    : null;
  const key = credential ? sottoExecutionCredentialFields(credential).apiKey : undefined;
  const transport = credential
    ? await createSottoProviderTransport(
        { userId: authResult.userId, authorize, credential, signal: request.signal },
        provider === 'elevenlabs'
          ? [{ method: 'GET', url: 'https://api.elevenlabs.io/v1/voices' }]
          : provider === 'cartesia'
            ? [
                {
                  method: 'GET',
                  url: 'https://api.cartesia.ai/voices',
                  allowQuery: true,
                },
              ]
            : [
                {
                  method: 'GET',
                  url: 'https://api.hume.ai/v0/tts/voices',
                  allowQuery: true,
                },
              ]
      )
    : null;
  const catalogVoices = await getVoiceCatalog(provider, key, transport?.authenticatedFetch);

  return NextResponse.json({
    poolVoices: catalogVoices.map((v) => ({
      id: v.id,
      name: v.name,
      gender: v.gender ?? '',
      accent: v.accent ?? '',
      ageRange: v.age ?? '',
      character: v.description ?? '',
    })),
  });
}
