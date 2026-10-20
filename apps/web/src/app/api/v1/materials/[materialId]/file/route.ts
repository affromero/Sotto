import { createReadStream } from 'node:fs';
import { mkdtemp, stat, rm } from 'node:fs/promises';
import { finished } from 'node:stream/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';
import { StorageReadCleanupError } from 'thesidedoor-core/storage';
import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequest } from '@/lib/api-keys';
import { errorResponse } from '@/lib/api-response';
import { prismaUnfiltered } from '@/lib/prisma';
import { sottoTransaction } from '@/lib/sidedoor/access/state/transaction';
import { requireOriginalSottoAdmission } from '@/lib/sidedoor/access/core/request-identity';
import {
  resolveStorageInput,
  validateStorageInputs,
} from '@/lib/sidedoor/storage/core/storage-inputs';
import { restoreStorageBackend } from '@/lib/r2';
import { logger } from '@/lib/logger';
import { materialOptimizationReceiptSchema } from '@/lib/course-materials/optimization/admission';

export const runtime = 'nodejs';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ materialId: string }> }
) {
  const admission = await authenticateRequest(request);
  if (!admission) return errorResponse('Unauthorized', 401);
  const { materialId } = await params;
  if (!z.uuid().safeParse(materialId).success) return errorResponse('Material not found', 404);
  const variant = z
    .enum(['original', 'optimized'])
    .safeParse(request.nextUrl.searchParams.get('variant') ?? 'original');
  if (!variant.success) return errorResponse('Unknown material file variant.', 400);
  const captured = await sottoTransaction(
    prismaUnfiltered,
    async (database) => {
      await requireOriginalSottoAdmission(database, request, admission);
      const material = await database.courseMaterial.findFirst({
        where: { id: materialId, userId: admission.userId },
      });
      if (!material?.originalUrl) return null;
      if (
        variant.data === 'optimized' &&
        (!material.optimizedUrl ||
          materialOptimizationReceiptSchema.parse(material.optimizationReceipt).status !==
            'OPTIMIZED')
      )
        return null;
      const reference =
        variant.data === 'optimized' ? material.optimizedUrl! : material.originalUrl;
      const storage = await resolveStorageInput(database, {
        consumer: `material:${materialId}:${variant.data}`,
        reference,
      });
      return { material, reference, storage };
    },
    { signal: request.signal }
  );
  if (!captured) return errorResponse('Material not found', 404);
  const directory = await mkdtemp(join(tmpdir(), 'sotto-material-'));
  let cleanupUnconfirmed = false;
  let responseOwnsDirectory = false;
  try {
    const backend = await restoreStorageBackend(captured.storage.backend.descriptor);
    const path = join(directory, 'original');
    await backend.downloadToFile(captured.storage.input.key, path, request.signal);
    const metadata = await stat(path);
    await sottoTransaction(
      prismaUnfiltered,
      async (database) => {
        await requireOriginalSottoAdmission(database, request, admission);
        if (
          !(await database.courseMaterial.findFirst({
            where: { id: materialId, userId: admission.userId },
            select: { id: true },
          }))
        )
          throw new Error('Material was removed');
        await validateStorageInputs(database, [captured.storage.input]);
      },
      { signal: request.signal }
    );
    const headers = new Headers({
      'Content-Type': variant.data === 'optimized' ? 'application/pdf' : captured.material.mimeType,
      'Content-Length': String(metadata.size),
      'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent((variant.data === 'optimized' ? 'optimized-' : '') + captured.material.name)}`,
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    });
    const reader = createReadStream(path, { signal: request.signal, highWaterMark: 65536 });
    const settled = finished(reader);
    // Observe early aborts even before the HTTP consumer requests another chunk.
    void settled.catch(() => undefined);
    const iterator = reader[Symbol.asyncIterator]();
    let cleanup: Promise<void> | undefined;
    const close = () =>
      (cleanup ??= (async () => {
        reader.destroy();
        await settled.catch(() => undefined);
        await rm(directory, { recursive: true, force: true });
      })());
    void settled.then(close, close).catch(() => {
      logger.error('Material response cleanup is unconfirmed', { materialId, directory });
    });
    const body = new ReadableStream<Uint8Array>({
      async pull(controller) {
        try {
          const next = await iterator.next();
          if (next.done) {
            await close();
            controller.close();
            return;
          }
          controller.enqueue(new Uint8Array(next.value));
        } catch (error) {
          await close();
          controller.error(error);
        }
      },
      async cancel() {
        await close();
      },
    });
    const response = new NextResponse(body, { headers });
    responseOwnsDirectory = true;
    return response;
  } catch (error) {
    if (error instanceof StorageReadCleanupError) {
      cleanupUnconfirmed = true;
      logger.error('Material download cleanup is unconfirmed', { materialId, directory });
    }
    return errorResponse('Could not open the original material.', 502);
  } finally {
    if (!cleanupUnconfirmed && !responseOwnsDirectory)
      await rm(directory, { recursive: true, force: true });
  }
}
