import { NextResponse } from 'next/server';
import { z } from 'zod';
import { readAccessJson } from 'thesidedoor-core/access/http';
import { isAccessError } from 'thesidedoor-core/access';
import {
  abortable,
  readResponseText,
  ResponseBodyTooLargeError,
} from 'thesidedoor-core/runtime/stream';
import { authenticateRequest } from '@/lib/api-keys';
import { errorResponse } from '@/lib/api-response';
import { detectAudioFormat, isRecognizedAudio } from '@/lib/audio-format';
import { prismaUnfiltered } from '@/lib/prisma';
import { checkRateLimit } from '@/lib/redis';
import { accessOperation } from '@/lib/sidedoor/access/core/http';
import { sottoTransaction } from '@/lib/sidedoor/access/state/transaction';
import {
  createSottoProviderTransport,
  sottoRequestExecution,
  type SottoProviderExecution,
} from '@/lib/sidedoor/credentials/runtime/provider-execution';
import { createTtsProviderAsync } from '@/lib/providers/tts';
import { getProviderMeta } from '@/lib/providers/tts-registry';
import { LocalTtsHttpError } from '@/lib/providers/tts/local.provider';
import {
  localSpeechDiscoverSchema,
  localSpeechPreviewSchema,
  localVoiceCatalogSchema,
} from './schemas';

const CATALOG_BYTES = 256 * 1024;
const PREVIEW_BYTES = 2 * 1024 * 1024;

class LocalSpeechResponseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LocalSpeechResponseError';
  }
}

async function validate(execution: SottoProviderExecution) {
  await sottoTransaction(
    prismaUnfiltered,
    async (database) => {
      execution.signal?.throwIfAborted();
      await execution.authorize(database);
    },
    { signal: execution.signal }
  );
}

async function discover(endpoint: string, execution: SottoProviderExecution) {
  const base = endpoint.replace(/\/+$/, '');
  const healthUrl = `${base}/health`;
  const voicesUrl = `${base}/voices`;
  const transport = await createSottoProviderTransport(execution, [
    { method: 'GET', url: healthUrl },
    { method: 'GET', url: voicesUrl },
  ]);
  const read = async (url: string) => {
    const response = await transport.authenticatedFetch(url, { signal: execution.signal });
    const text = await readResponseText(response, {
      signal: execution.signal!,
      maxBytes: CATALOG_BYTES,
    });
    await validate(execution);
    if (!response.ok)
      throw new LocalSpeechResponseError(
        `The local speech server returned HTTP ${response.status}. Check its endpoint and service status.`
      );
    try {
      return JSON.parse(text) as unknown;
    } catch {
      throw new LocalSpeechResponseError('The local speech server returned invalid catalog JSON.');
    }
  };
  const health = z
    .object({ status: z.literal('ok'), engine: z.string().trim().min(1).max(64).optional() })
    .safeParse(await read(healthUrl));
  if (!health.success)
    throw new LocalSpeechResponseError('The local speech server did not report ready status.');
  const catalog = localVoiceCatalogSchema.safeParse(await read(voicesUrl));
  if (!catalog.success)
    throw new LocalSpeechResponseError('The local speech server returned no valid voice catalog.');
  await validate(execution);
  const engine = health.data.engine ?? null;
  const model = getProviderMeta('local').defaultModel;
  return NextResponse.json({
    engine,
    model: {
      id: model,
      label:
        engine === 'piper'
          ? 'Piper (selected by voice)'
          : engine === 'kokoro'
            ? 'Kokoro'
            : 'Local speech model',
    },
    voices: catalog.data.voices.map((voice) => ({
      id: voice.id,
      name: voice.name ?? voice.label ?? voice.id,
      ...(voice.language && { language: voice.language }),
    })),
  });
}

async function preview(
  selection: z.infer<typeof localSpeechPreviewSchema>,
  execution: SottoProviderExecution
) {
  const provider = await createTtsProviderAsync(
    'local',
    execution,
    undefined,
    undefined,
    selection.model,
    {
      endpoint: `${selection.endpoint.replace(/\/+$/, '')}/tts`,
      model: selection.model,
      voices: [],
      responseLimits: { maxAudioBytes: PREVIEW_BYTES, maxErrorBytes: 4096 },
    }
  );
  const audio = await provider.generateSpeech({
    text: selection.text,
    voiceId: selection.voiceId,
    language: selection.language,
    signal: execution.signal,
  });
  await validate(execution);
  if (!isRecognizedAudio(audio))
    throw new LocalSpeechResponseError(
      'The local speech server returned empty or unrecognized audio.'
    );
  return new NextResponse(new Uint8Array(audio), {
    headers: {
      'Content-Type': detectAudioFormat(audio).mime,
      'Content-Length': audio.length.toString(),
    },
  });
}

/** Test an explicit keyless draft through the same authority and capacity as saved speech. */
export async function localSpeechRequest(request: Request, action: 'discover' | 'preview') {
  return accessOperation(request, true, async () => {
    const identity = await authenticateRequest(request);
    if (!identity) return errorResponse('Unauthorized', 401);
    if (!identity.isOwner) return errorResponse('Forbidden', 403);
    const parsed = (
      action === 'discover' ? localSpeechDiscoverSchema : localSpeechPreviewSchema
    ).safeParse(await readAccessJson(request));
    if (!parsed.success) return errorResponse(parsed.error.issues[0].message, 400);
    const deadline = AbortSignal.timeout(action === 'discover' ? 15_000 : 30_000);
    const signal = AbortSignal.any([request.signal, deadline]);
    const execution = { ...sottoRequestExecution(request, identity), signal };
    try {
      await validate(execution);
      const rate = await abortable(
        checkRateLimit(
          `local-speech-${action}:${identity.userId}`,
          action === 'discover' ? 20 : 10,
          60
        ),
        signal
      );
      if (!rate.allowed)
        return errorResponse('Too many speech checks. Try again in a minute.', 429);
      if (action === 'discover') return await discover(parsed.data.endpoint, execution);
      return await preview(localSpeechPreviewSchema.parse(parsed.data), execution);
    } catch (failure) {
      if (request.signal.aborted) return errorResponse('Local speech check cancelled.', 499);
      if (deadline.aborted)
        return errorResponse('The local speech server did not respond in time.', 504);
      if (failure instanceof LocalTtsHttpError)
        return errorResponse(
          `The local speech server rejected the test (HTTP ${failure.status}). Check the selected model, voice and language.`,
          502
        );
      if (failure instanceof LocalSpeechResponseError) return errorResponse(failure.message, 502);
      if (failure instanceof ResponseBodyTooLargeError)
        return errorResponse(
          'The local speech server returned too much data for this short test.',
          502
        );
      // Access errors retain their canonical status rather than becoming sidecar failures.
      if (isAccessError(failure)) throw failure;
      return errorResponse(
        'Could not read local speech. Check the endpoint, service and selected voice.',
        502
      );
    }
  });
}
