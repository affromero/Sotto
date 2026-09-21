import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequest } from '@/lib/api-keys';
import { voicePreviewSchema } from '@/lib/validations';
import { checkRateLimit } from '@/lib/redis';
import { getProviderMeta, type TtsProviderId } from '@/lib/providers/tts-registry';
import { logUsage } from '@/lib/usage-logger';
import {
  captureSottoExecutionCredential,
  admitSottoExecutionCredential,
  sottoExecutionCredentialFields,
} from '@/lib/sidedoor/credentials/runtime/credential-execution';
import { requireOriginalSottoAdmission } from '@/lib/sidedoor/access/core/request-identity';
import { sottoTransaction } from '@/lib/sidedoor/access/state/transaction';
import { prismaUnfiltered } from '@/lib/prisma';
import type { Prisma } from '@/generated/prisma/client';
import { isAccessError } from 'thesidedoor-core/access';
import { accessErrorStatus } from 'thesidedoor-core/access/http';
import { createTtsProviderAsync } from '@/lib/providers/tts';
import { errorResponse } from '@/lib/api-response';

export async function POST(request: NextRequest) {
  const authed = await authenticateRequest(request);
  if (!authed) {
    return errorResponse('Unauthorized', 401);
  }
  const userId = authed.userId;

  const rateLimit = await checkRateLimit(`voice-preview:${userId}`, 10, 60);
  if (!rateLimit.allowed) {
    return errorResponse('Rate limit exceeded. Try again in a minute.', 429);
  }

  const body = await request.json();
  const parsed = voicePreviewSchema.safeParse(body);

  if (!parsed.success) {
    return errorResponse(parsed.error.flatten(), 400);
  }

  const { voiceId, text, provider } = parsed.data;

  let audioBuffer: Buffer;
  const providerName: TtsProviderId = provider;

  try {
    const authorize = async (database: Prisma.TransactionClient) => {
      await requireOriginalSottoAdmission(database, request, authed);
      return { userId };
    };
    const saved = await sottoTransaction(prismaUnfiltered, (database) =>
      captureSottoExecutionCredential(
        database,
        authorize,
        'tts',
        providerName,
        true,
        request.signal
      )
    );
    const credentials = saved ? sottoExecutionCredentialFields(saved) : null;
    if (!credentials && providerName !== 'local' && providerName !== 'kokoro') {
      return errorResponse(`No ${providerName} API key available`, 400);
    }

    const ttsProvider = await createTtsProviderAsync(
      providerName,
      { userId, authorize, credential: saved, signal: request.signal },
      credentials?.apiKey,
      credentials?.extraData
    );
    if (
      ![
        'playht',
        'openai',
        'deepgram',
        'rime',
        'hume',
        'cartesia',
        'elevenlabs',
        'local',
        'kokoro',
      ].includes(providerName)
    )
      await sottoTransaction(prismaUnfiltered, async (database) => {
        if (saved) await admitSottoExecutionCredential(database, authorize, saved, request.signal);
        else await authorize(database);
        request.signal.throwIfAborted();
      });
    audioBuffer = await ttsProvider.generateSpeech({ text, voiceId, signal: request.signal });
  } catch (err) {
    if (isAccessError(err)) return errorResponse(err.code, accessErrorStatus(err));
    if (request.signal.aborted) return errorResponse('Preview cancelled.', 499);
    const msg = err instanceof Error ? err.message : '';
    const isInvalidId =
      msg.includes('422') ||
      msg.toLowerCase().includes('pattern') ||
      msg.toLowerCase().includes('invalid_uid');
    return errorResponse(
      isInvalidId ? 'Invalid voice ID format.' : 'Failed to generate preview.',
      400
    );
  }

  const meta = getProviderMeta(providerName);
  await logUsage({
    service: providerName,
    category: 'voice_preview',
    inputTokens: text.length,
    totalCost: (text.length / 1000) * meta.platformCostPerKChar,
    userId,
  });

  const uint8 = new Uint8Array(audioBuffer);

  return new NextResponse(uint8, {
    headers: {
      'Content-Type': 'audio/mpeg',
      'Content-Length': audioBuffer.length.toString(),
    },
  });
}
