import { isDeepStrictEqual } from 'node:util';
import { NextRequest, NextResponse } from 'next/server';
import { isAccessError } from 'thesidedoor-core/access';
import { accessErrorStatus } from 'thesidedoor-core/access/http';
import { authenticateRequest } from '@/lib/api-keys';
import { errorResponse } from '@/lib/api-response';
import { captureSpeakingHistoryAudio } from '@/lib/classes/speaking/speaking-history-audio';
import { logger } from '@/lib/logger';
import { prismaUnfiltered } from '@/lib/prisma';
import {
  readAttributedStorageRange,
  STORAGE_RANGE_MAX_BYTES,
  type StorageRangeIdentity,
} from '@/lib/r2';
import { requireOriginalSottoAdmission } from '@/lib/sidedoor/access/core/request-identity';
import { sottoTransaction } from '@/lib/sidedoor/access/state/transaction';
import {
  contentTypeForStorageKey,
  parseStorageByteRange,
} from '@/lib/storage/sidedoor/local-object-read';

export const runtime = 'nodejs';
const cacheHeaders = { 'Cache-Control': 'private, no-store' };
type Params = { params: Promise<{ classId: string; promptId: string; recordingId: string }> };

export async function GET(request: NextRequest, { params }: Params) {
  const admission = await authenticateRequest(request);
  if (!admission) return errorResponse('Unauthorized', 401, undefined, cacheHeaders);
  const ids = await params;
  if (Object.values(ids).some((id) => !id || id.length > 200))
    return errorResponse('Recording not found', 404, undefined, cacheHeaders);
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
  try {
    const captured = await sottoTransaction(
      prismaUnfiltered,
      async (database) => {
        await execution.authorize(database);
        return captureSpeakingHistoryAudio(database, input);
      },
      { signal }
    );
    if (!captured) return errorResponse('Recording not found', 404, undefined, cacheHeaders);
    const revalidate = async () =>
      sottoTransaction(
        prismaUnfiltered,
        async (database) => {
          await execution.authorize(database);
          const current = await captureSpeakingHistoryAudio(database, input);
          if (
            !current ||
            !isDeepStrictEqual(current.recording, captured.recording) ||
            !isDeepStrictEqual(current.ownership, captured.ownership) ||
            !isDeepStrictEqual(current.storage.input, captured.storage.input) ||
            !isDeepStrictEqual(
              current.storage.backend.descriptor,
              captured.storage.backend.descriptor
            )
          )
            throw new Error('Recording authorization changed');
        },
        { signal }
      );
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
    if (!probe || probe.body.length !== 1 || probe.start !== 0 || probe.end !== 0)
      throw new Error('Recording data is unavailable');
    await revalidate();
    const selection = parseStorageByteRange(range, probe.size);
    if (!selection)
      return errorResponse('Range not satisfiable', 416, undefined, {
        ...cacheHeaders,
        'Content-Range': `bytes */${probe.size}`,
      });
    const contentType = contentTypeForStorageKey(captured.storage.input.key);
    const headers = new Headers({
      ...cacheHeaders,
      'Content-Type': contentType,
      'Content-Length': String(selection.end - selection.start + 1),
      'Content-Disposition': contentType.startsWith('audio/') ? 'inline' : 'attachment',
      'Accept-Ranges': 'bytes',
      'X-Content-Type-Options': 'nosniff',
    });
    if (range)
      headers.set('Content-Range', `bytes ${selection.start}-${selection.end}/${probe.size}`);
    let next = selection.start;
    let pending: Promise<void> | undefined;
    const body = new ReadableStream<Uint8Array>({
      async pull(stream) {
        pending = (async () => {
          if (next > selection.end) {
            stream.close();
            return;
          }
          const end = Math.min(selection.end, next + STORAGE_RANGE_MAX_BYTES - 1);
          const chunk = await read(next, end, probe.identity);
          if (
            !chunk ||
            chunk.size !== probe.size ||
            chunk.start !== next ||
            chunk.end !== end ||
            chunk.body.length !== end - next + 1
          )
            throw new Error('Recording data changed');
          await revalidate();
          signal.throwIfAborted();
          next = end + 1;
          stream.enqueue(new Uint8Array(chunk.body));
        })();
        try {
          await pending;
        } catch (error) {
          controller.abort();
          stream.error(error);
        }
      },
      async cancel() {
        controller.abort();
        await pending?.catch(() => undefined);
      },
    });
    return new NextResponse(body, { status: range ? 206 : 200, headers });
  } catch (error) {
    controller.abort();
    if (isAccessError(error))
      return errorResponse(
        'Recording unavailable',
        accessErrorStatus(error),
        undefined,
        cacheHeaders
      );
    logger.error('Could not read saved speaking recording', {
      error: error instanceof Error ? error.message : String(error),
    });
    return errorResponse('Recording unavailable', 502, undefined, cacheHeaders);
  }
}
