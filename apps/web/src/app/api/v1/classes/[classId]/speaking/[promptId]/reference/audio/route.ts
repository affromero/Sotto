import { isDeepStrictEqual } from 'node:util';
import { NextRequest, NextResponse } from 'next/server';
import { isAccessError } from 'thesidedoor-core/access';
import { accessErrorStatus } from 'thesidedoor-core/access/http';
import { authenticateRequest } from '@/lib/api-keys';
import { errorResponse } from '@/lib/api-response';
import { captureSpeakingReferenceAudio } from '@/lib/classes/speaking/speaking-reference-audio';
import { InitialA1PracticeBlocked } from '@/lib/classes/lesson/initial-a1-provenance';
import {
  decryptSpeakingReferenceChunk,
  speakingReferenceKeyForEnvelope,
  verifySpeakingReferenceEnvelope,
  SPEAKING_REFERENCE_CHUNK_BYTES,
} from '@/lib/classes/speaking/speaking-reference-crypto';
import { logger } from '@/lib/logger';
import { prismaUnfiltered } from '@/lib/prisma';
import { readAttributedStorageRange, type StorageRangeIdentity } from '@/lib/r2';
import { requireOriginalSottoAdmission } from '@/lib/sidedoor/access/core/request-identity';
import { sottoTransaction } from '@/lib/sidedoor/access/state/transaction';
import { parseStorageByteRange } from '@/lib/storage/sidedoor/local-object-read';

export const runtime = 'nodejs';
const cacheHeaders = { 'Cache-Control': 'private, no-store' };
type Params = { params: Promise<{ classId: string; promptId: string }> };

export async function GET(request: NextRequest, { params }: Params) {
  const admission = await authenticateRequest(request);
  if (!admission) return errorResponse('Unauthorized', 401, undefined, cacheHeaders);
  const ids = await params;
  if (Object.values(ids).some((id) => !id || id.length > 200))
    return errorResponse('Reference not found', 404, undefined, cacheHeaders);
  const range = request.headers.get('range');
  if (range && !parseStorageByteRange(range, Number.MAX_SAFE_INTEGER))
    return errorResponse('Range not satisfiable', 416, undefined, cacheHeaders);
  const input = { ...ids, userId: admission.userId };
  const controller = new AbortController();
  const signal = AbortSignal.any([request.signal, controller.signal]);
  const execution = {
    userId: admission.userId,
    signal,
    authorize: async (database: Parameters<typeof requireOriginalSottoAdmission>[0]) => {
      await requireOriginalSottoAdmission(database, request, admission);
      return { userId: admission.userId };
    },
  };
  let key: Buffer | undefined;
  try {
    const capture = () =>
      sottoTransaction(
        prismaUnfiltered,
        async (database) => {
          await execution.authorize(database);
          return captureSpeakingReferenceAudio(database, input);
        },
        { signal }
      );
    const captured = await capture();
    if (!captured) return errorResponse('Reference not found', 404, undefined, cacheHeaders);
    const revalidate = async () => {
      const current = await capture();
      if (
        !current ||
        !isDeepStrictEqual(current.prompt, captured.prompt) ||
        !isDeepStrictEqual(current.binding, captured.binding) ||
        !isDeepStrictEqual(current.practiceAuthorization, captured.practiceAuthorization) ||
        !isDeepStrictEqual(current.ownership, captured.ownership) ||
        !isDeepStrictEqual(current.storage.input, captured.storage.input) ||
        !isDeepStrictEqual(current.storage.backend.descriptor, captured.storage.backend.descriptor)
      )
        throw new Error('Reference authorization changed');
    };
    const read = (start: number, end: number, expectedIdentity?: StorageRangeIdentity) =>
      readAttributedStorageRange({
        input: captured.storage.input,
        descriptor: captured.storage.backend.descriptor,
        execution,
        start,
        end,
        expectedIdentity,
      });
    const probe = await read(0, 0);
    if (
      !probe ||
      probe.size !== captured.objectBytes ||
      probe.body.length !== 1 ||
      probe.start !== 0 ||
      probe.end !== 0
    )
      throw new Error('Reference data is unavailable');
    await revalidate();
    const size = captured.envelope.byteLength;
    const selection = parseStorageByteRange(range, size);
    if (!selection)
      return errorResponse('Range not satisfiable', 416, undefined, {
        ...cacheHeaders,
        'Content-Range': `bytes */${size}`,
      });
    key = speakingReferenceKeyForEnvelope(captured.envelope);
    verifySpeakingReferenceEnvelope(captured.envelope, captured.binding, key);
    const streamKey = key;
    const headers = new Headers({
      ...cacheHeaders,
      'Content-Type': 'audio/mpeg',
      'Content-Length': String(selection.end - selection.start + 1),
      'Content-Disposition': 'inline',
      'Accept-Ranges': 'bytes',
      'X-Content-Type-Options': 'nosniff',
    });
    if (range) headers.set('Content-Range', `bytes ${selection.start}-${selection.end}/${size}`);
    let index = Math.floor(selection.start / SPEAKING_REFERENCE_CHUNK_BYTES);
    let pending: Promise<void> | undefined;
    const abortKey = () => {
      if (pending) void pending.finally(() => streamKey.fill(0)).catch(() => undefined);
      else streamKey.fill(0);
    };
    signal.addEventListener('abort', abortKey, { once: true });
    if (signal.aborted) abortKey();
    const clearKey = () => {
      signal.removeEventListener('abort', abortKey);
      streamKey.fill(0);
    };
    const body = new ReadableStream<Uint8Array>({
      async pull(stream) {
        pending = (async () => {
          const plainStart = index * SPEAKING_REFERENCE_CHUNK_BYTES;
          if (plainStart > selection.end) {
            clearKey();
            stream.close();
            return;
          }
          const plainLength = Math.min(SPEAKING_REFERENCE_CHUNK_BYTES, size - plainStart);
          const start = index * (SPEAKING_REFERENCE_CHUNK_BYTES + 16);
          const end = start + plainLength + 16 - 1;
          const chunk = await read(start, end, probe.identity);
          if (
            !chunk ||
            chunk.size !== captured.objectBytes ||
            chunk.start !== start ||
            chunk.end !== end ||
            chunk.body.length !== end - start + 1
          )
            throw new Error('Reference data changed');
          const plain = decryptSpeakingReferenceChunk(
            chunk.body,
            captured.envelope,
            captured.binding,
            streamKey,
            index
          );
          try {
            await revalidate();
            signal.throwIfAborted();
            const first = Math.max(selection.start - plainStart, 0);
            const last = Math.min(selection.end - plainStart + 1, plainLength);
            stream.enqueue(Uint8Array.from(plain.subarray(first, last)));
            index++;
          } finally {
            plain.fill(0);
          }
        })();
        try {
          await pending;
        } catch (error) {
          clearKey();
          controller.abort();
          stream.error(error);
        }
      },
      async cancel() {
        controller.abort();
        await pending?.catch(() => undefined);
        clearKey();
      },
    });
    key = undefined;
    return new NextResponse(body, { status: range ? 206 : 200, headers });
  } catch (error) {
    key?.fill(0);
    controller.abort();
    if (error instanceof InitialA1PracticeBlocked)
      return errorResponse(error.message, 409, undefined, cacheHeaders);
    if (isAccessError(error))
      return errorResponse(
        'Reference unavailable',
        accessErrorStatus(error),
        undefined,
        cacheHeaders
      );
    logger.error('Could not read speaking reference', {
      error: error instanceof Error ? error.message : String(error),
    });
    return errorResponse('Reference unavailable', 502, undefined, cacheHeaders);
  }
}
