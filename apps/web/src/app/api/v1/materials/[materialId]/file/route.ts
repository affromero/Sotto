import { mkdtemp, readFile, rm } from 'node:fs/promises';
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

export const runtime = 'nodejs';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ materialId: string }> }
) {
  const admission = await authenticateRequest(request);
  if (!admission) return errorResponse('Unauthorized', 401);
  const { materialId } = await params;
  if (!z.uuid().safeParse(materialId).success) return errorResponse('Material not found', 404);
  const captured = await sottoTransaction(
    prismaUnfiltered,
    async (database) => {
      await requireOriginalSottoAdmission(database, request, admission);
      const material = await database.courseMaterial.findFirst({
        where: { id: materialId, userId: admission.userId },
      });
      if (!material?.originalUrl) return null;
      const reference = material.originalUrl;
      const storage = await resolveStorageInput(database, {
        consumer: `material:${materialId}:original`,
        reference,
      });
      return { material, reference, storage };
    },
    { signal: request.signal }
  );
  if (!captured) return errorResponse('Material not found', 404);
  const directory = await mkdtemp(join(tmpdir(), 'sotto-material-'));
  let cleanupUnconfirmed = false;
  try {
    const backend = await restoreStorageBackend(captured.storage.backend.descriptor);
    const path = join(directory, 'original');
    await backend.downloadToFile(captured.reference, path, request.signal);
    const bytes = await readFile(path);
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
    return new NextResponse(bytes, {
      headers: {
        'Content-Type': captured.material.mimeType,
        'Content-Length': String(bytes.length),
        'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(captured.material.name)}`,
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch (error) {
    if (error instanceof StorageReadCleanupError) {
      cleanupUnconfirmed = true;
      logger.error('Material download cleanup is unconfirmed', { materialId, directory });
    }
    return errorResponse('Could not open the original material.', 502);
  } finally {
    if (!cleanupUnconfirmed) await rm(directory, { recursive: true, force: true });
  }
}
