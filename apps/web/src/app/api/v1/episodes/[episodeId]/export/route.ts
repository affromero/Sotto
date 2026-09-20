import { randomUUID } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { isAccessError } from 'thesidedoor-core/access';
import { authenticateRequest } from '@/lib/api-keys';
import { prismaUnfiltered as prisma } from '@/lib/prisma';
import { pdfGenerationQueue } from '@/lib/queue';
import { errorResponse } from '@/lib/api-response';
import { sottoTransaction } from '@/lib/sidedoor/access/state/transaction';
import { requireOriginalSottoAdmission } from '@/lib/sidedoor/access/core/request-identity';
import {
  admitTranscriptExport,
  TranscriptExportNotFoundError,
} from '@/lib/sidedoor/storage/publication/transcript-export';
import { deliverSottoJob } from '@/lib/sidedoor/jobs/core/job-delivery';

type RouteParams = { params: Promise<{ episodeId: string }> };
const privateResponse = { headers: { 'Cache-Control': 'private, no-store' } };
function exportError(error: unknown) {
  if (error instanceof TranscriptExportNotFoundError) return errorResponse(error.message, 404);
  if (isAccessError(error))
    return errorResponse(
      error.message,
      error.code === 'unauthorized'
        ? 401
        : error.code === 'forbidden'
          ? 403
          : error.code === 'invalid'
            ? 400
            : 409
    );
  throw error;
}

/** Admit the original export request before dispatching background work. */
export async function POST(request: NextRequest, { params }: RouteParams) {
  const admission = await authenticateRequest(request);
  if (!admission) return errorResponse('Unauthorized', 401);
  const { episodeId } = await params;
  const operationId = randomUUID();
  try {
    const result = await sottoTransaction(
      prisma,
      (tx) =>
        admitTranscriptExport(tx, {
          request,
          admission,
          episodeId,
          operationId,
        }),
      { signal: request.signal }
    );
    if (result.kind === 'ready')
      return NextResponse.json({ status: 'ready', pdfUrl: result.pdfUrl }, privateResponse);
    await deliverSottoJob({
      database: prisma,
      queue: pdfGenerationQueue,
      operationId: result.record.job.id,
      fingerprint: result.record.fingerprint,
      version: 2,
    });
    return NextResponse.json({ status: 'generating' }, privateResponse);
  } catch (error) {
    return exportError(error);
  }
}

/** Preserve polling for accessible episodes, including unfinished episodes. */
export async function GET(request: NextRequest, { params }: RouteParams) {
  const admission = await authenticateRequest(request);
  if (!admission) return errorResponse('Unauthorized', 401);
  const { episodeId } = await params;
  try {
    const episode = await sottoTransaction(
      prisma,
      async (tx) => {
        await requireOriginalSottoAdmission(tx, request, admission);
        const current = await tx.episode.findUnique({
          where: { id: episodeId },
          select: { pdfUrl: true, userId: true, visibility: true, deletedAt: true },
        });
        if (
          !current ||
          current.deletedAt ||
          (current.visibility === 'PRIVATE' && current.userId !== admission.userId)
        )
          throw new TranscriptExportNotFoundError();
        await requireOriginalSottoAdmission(tx, request, admission);
        request.signal.throwIfAborted();
        return current;
      },
      { signal: request.signal }
    );
    return NextResponse.json(
      episode.pdfUrl
        ? { status: 'ready', pdfUrl: episode.pdfUrl }
        : { status: 'idle', pdfUrl: null },
      privateResponse
    );
  } catch (error) {
    return exportError(error);
  }
}
