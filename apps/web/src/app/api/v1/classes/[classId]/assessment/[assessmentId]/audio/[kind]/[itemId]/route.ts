import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { NextRequest, NextResponse } from 'next/server';
import { isAccessError } from 'thesidedoor-core/access';
import { accessErrorStatus } from 'thesidedoor-core/access/http';
import { authenticateRequest } from '@/lib/api-keys';
import { errorResponse } from '@/lib/api-response';
import {
  captureAssessmentAudio,
  type AudioSelection,
} from '@/lib/learning/classes/audio/assessment-audio-read';
import { prismaUnfiltered } from '@/lib/prisma';
import {
  readAssessmentAudioRange,
  STORAGE_RANGE_MAX_BYTES,
  type StorageRangeIdentity,
} from '@/lib/r2';
import { sottoTransaction } from '@/lib/sidedoor/access/state/transaction';
import { sottoRequestExecution } from '@/lib/sidedoor/credentials/runtime/provider-execution';
import {
  contentTypeForStorageKey,
  parseStorageByteRange,
} from '@/lib/storage/sidedoor/local-object-read';

export const runtime = 'nodejs';
const MAX_AUDIO_BYTES = 64 * 1024 * 1024;
const MAX_IN_FLIGHT_BYTES = 128 * 1024 * 1024;
let inFlightBytes = 0;
const headers = { 'Cache-Control': 'private, no-store' };
type Params = {
  params: Promise<{ classId: string; assessmentId: string; kind: string; itemId: string }>;
};

/** Serve only verified audio from the current owned assessment. */
export async function GET(request: NextRequest, { params }: Params) {
  const identity = await authenticateRequest(request);
  if (!identity) return errorResponse('Unauthorized', 401, undefined, headers);
  const { classId, assessmentId, kind, itemId } = await params;
  if ([classId, assessmentId, itemId].some((id) => !id || id.length > 200))
    return errorResponse('Audio unavailable', 404, undefined, headers);
  const selection: AudioSelection =
    kind === 'listening'
      ? { kind: 'LISTENING', sectionId: itemId }
      : { kind: 'SPEAKING', promptId: itemId };
  if (kind !== 'listening' && kind !== 'speaking')
    return errorResponse('Audio unavailable', 404, undefined, headers);
  const controller = new AbortController();
  const signal = AbortSignal.any([request.signal, controller.signal, AbortSignal.timeout(120_000)]);
  const execution = { ...sottoRequestExecution(request, identity), signal };
  const input = { classId, assessmentId, selection, execution };
  let release: (() => void) | undefined;
  let retained: Buffer | undefined;
  try {
    const capture = () =>
      sottoTransaction(prismaUnfiltered, (database) => captureAssessmentAudio(database, input), {
        signal,
      });
    const captured = await capture();
    const size = captured.source.contentBytes;
    if (!Number.isSafeInteger(size) || size <= 0 || size > MAX_AUDIO_BYTES)
      throw new Error('Assessment audio size is unavailable');
    const contentType = contentTypeForStorageKey(captured.storage.input.key);
    if (!contentType.startsWith('audio/'))
      throw new Error('Assessment audio format is unavailable');
    const range = request.headers.get('range');
    const selected = parseStorageByteRange(range, size);
    if (!selected)
      return errorResponse('Range not satisfiable', 416, undefined, {
        ...headers,
        'Content-Range': `bytes */${size}`,
      });
    if (inFlightBytes + size > MAX_IN_FLIGHT_BYTES)
      return errorResponse('Audio is busy. Please try again.', 503, undefined, headers);
    inFlightBytes += size;
    let released = false;
    release = () => {
      if (released) return;
      released = true;
      inFlightBytes -= size;
    };
    const authorize = async (database: Parameters<typeof captureAssessmentAudio>[0]) => {
      const current = await captureAssessmentAudio(database, input);
      if (!isDeepStrictEqual(current, captured)) throw new Error('Assessment audio changed');
    };
    const revalidate = () => sottoTransaction(prismaUnfiltered, authorize, { signal });
    retained = Buffer.alloc(size);
    let objectIdentity: StorageRangeIdentity | undefined;
    for (let start = 0; start < size; start += STORAGE_RANGE_MAX_BYTES) {
      const end = Math.min(size - 1, start + STORAGE_RANGE_MAX_BYTES - 1);
      const chunk = await readAssessmentAudioRange(
        {
          input: captured.storage.input,
          descriptor: captured.storage.backend.descriptor,
          execution,
          start,
          end,
          expectedIdentity: objectIdentity,
        },
        authorize
      );
      if (
        !chunk ||
        chunk.size !== size ||
        chunk.start !== start ||
        chunk.end !== end ||
        chunk.body.length !== end - start + 1
      )
        throw new Error('Assessment audio changed');
      objectIdentity = chunk.identity;
      await revalidate();
      chunk.body.copy(retained, start);
    }
    if (createHash('sha256').update(retained).digest('hex') !== captured.source.contentSha256)
      throw new Error('Assessment audio integrity failed');
    await revalidate();
    const responseHeaders = new Headers({
      ...headers,
      'Content-Type': contentType,
      'Content-Length': String(selected.end - selected.start + 1),
      'Content-Disposition': 'inline',
      'Accept-Ranges': 'bytes',
      'X-Content-Type-Options': 'nosniff',
    });
    if (range)
      responseHeaders.set('Content-Range', `bytes ${selected.start}-${selected.end}/${size}`);
    let offset = selected.start;
    let pending: Promise<void> | undefined;
    const finish = () => {
      retained?.fill(0);
      retained = undefined;
      release!();
    };
    const onAbort = () => {
      if (pending) void pending.finally(finish).catch(() => undefined);
      else finish();
    };
    signal.addEventListener('abort', onAbort, { once: true });
    if (signal.aborted) onAbort();
    const body = new ReadableStream<Uint8Array>({
      async pull(stream) {
        pending = (async () => {
          await revalidate();
          signal.throwIfAborted();
          if (offset > selected.end) {
            signal.removeEventListener('abort', onAbort);
            finish();
            stream.close();
            return;
          }
          const data = retained;
          if (!data) throw new Error('Assessment audio was closed');
          const end = Math.min(selected.end + 1, offset + 64 * 1024);
          stream.enqueue(Uint8Array.from(data.subarray(offset, end)));
          offset = end;
        })();
        try {
          await pending;
        } catch (error) {
          controller.abort();
          finish();
          stream.error(error);
        } finally {
          pending = undefined;
        }
      },
      async cancel() {
        controller.abort();
        await pending?.catch(() => undefined);
        finish();
      },
    });
    return new NextResponse(body, { status: range ? 206 : 200, headers: responseHeaders });
  } catch (error) {
    controller.abort();
    retained?.fill(0);
    release?.();
    if (isAccessError(error))
      return errorResponse('Audio unavailable', accessErrorStatus(error), undefined, headers);
    return errorResponse('Audio unavailable', 409, undefined, headers);
  }
}
