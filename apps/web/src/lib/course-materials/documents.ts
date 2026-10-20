import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { StorageReadCleanupError } from 'thesidedoor-core/storage';
import { isJobExecutionCleanupFailure } from 'thesidedoor-core/runtime/outbox';
import { prismaUnfiltered } from '../prisma';
import { restoreStorageBackend } from '../r2';
import { sottoTransaction } from '../sidedoor/access/state/transaction';
import {
  resolveStorageInput,
  validateStorageInputs,
} from '../sidedoor/storage/core/storage-inputs';
import type { SottoProviderExecution } from '../sidedoor/credentials/runtime/provider-execution';
import type { SourceDocuments, DocumentContentPart } from '../providers/ai';
import { validatePdfDocument } from '../providers/documents/pdf-input';
import { readPdfFile } from '../providers/documents/files';
import { logger } from '../logger';

/** Capture and read immutable originals through their owned storage references. */
export async function captureMaterialDocuments(
  execution: SottoProviderExecution,
  selection: { courseId: string } | { materialIds: readonly string[] }
): Promise<SourceDocuments> {
  const captured = await sottoTransaction(
    prismaUnfiltered,
    async (database) => {
      const actor = await execution.authorize(database);
      if (actor.userId !== execution.userId) throw new Error('The material learner changed.');
      const rows = await database.courseMaterial.findMany({
        where: {
          userId: actor.userId,
          ...('courseId' in selection
            ? { courseId: selection.courseId }
            : { id: { in: [...selection.materialIds] } }),
        },
        select: {
          id: true,
          courseId: true,
          name: true,
          mimeType: true,
          originalUrl: true,
          byteSize: true,
          createdAt: true,
        },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      });
      if ('materialIds' in selection && rows.length !== new Set(selection.materialIds).size)
        throw new Error('An uploaded material is unavailable for this learner.');
      if (
        'courseId' in selection &&
        !(await database.course.findFirst({
          where: { id: selection.courseId, userId: actor.userId },
          select: { id: true },
        }))
      )
        throw new Error('The material course is unavailable for this learner.');
      const materials = [];
      for (const row of rows) {
        if (row.mimeType !== 'application/pdf' && !row.name.toLowerCase().endsWith('.pdf'))
          continue;
        if (!row.originalUrl) throw new Error('An original course PDF is unavailable.');
        materials.push({
          row,
          storage: await resolveStorageInput(database, {
            consumer: `material:${row.id}:original`,
            reference: row.originalUrl,
          }),
        });
      }
      return materials;
    },
    { signal: execution.signal }
  );

  const validate = async () => {
    await sottoTransaction(
      prismaUnfiltered,
      async (database) => {
        const actor = await execution.authorize(database);
        if (actor.userId !== execution.userId) throw new Error('The material learner changed.');
        for (const { row } of captured) {
          const current = await database.courseMaterial.findFirst({
            where: { id: row.id, userId: actor.userId },
            select: {
              id: true,
              courseId: true,
              name: true,
              mimeType: true,
              originalUrl: true,
              byteSize: true,
              createdAt: true,
            },
          });
          if (!isDeepStrictEqual(current, row)) throw new Error('An original course PDF changed.');
        }
        await validateStorageInputs(
          database,
          captured.map(({ storage }) => storage.input)
        );
      },
      { signal: execution.signal }
    );
  };
  const parts: DocumentContentPart[] = [];
  if (!captured.length) return { parts, validate };
  const directory = await mkdtemp(join(tmpdir(), 'sotto-source-pdf-'));
  let cleanupUnconfirmed = false;
  let primary: unknown;
  try {
    let total = 0;
    for (const { row, storage } of captured) {
      execution.signal?.throwIfAborted();
      total += row.byteSize;
      if (row.byteSize < 1 || total > 50 * 1024 * 1024)
        throw new Error('Original course PDFs must total 50 MB or less.');
      const backend = await restoreStorageBackend(storage.backend.descriptor);
      const path = join(directory, row.id);
      await backend.downloadToFile(storage.input.reference, path, execution.signal);
      const part: DocumentContentPart = {
        type: 'document',
        name: row.name,
        mediaType: 'application/pdf',
        data: await readPdfFile(path, { maximum: row.byteSize, expectedBytes: row.byteSize }),
      };
      validatePdfDocument(part);
      parts.push(part);
    }
    await validate();
    return { parts, validate };
  } catch (error) {
    primary = error;
    if (isJobExecutionCleanupFailure(error)) {
      cleanupUnconfirmed = true;
      logger.error('Original PDF read cleanup is unconfirmed', { directory });
      execution.onCleanupError?.(error);
    }
    throw error;
  } finally {
    if (!cleanupUnconfirmed)
      try {
        await rm(directory, { recursive: true, force: true });
      } catch (cause) {
        logger.error('Original PDF workspace cleanup is unconfirmed', { directory });
        const error = new StorageReadCleanupError({
          cause: primary
            ? new AggregateError([primary, cause], 'PDF read and cleanup failed')
            : cause,
        });
        execution.onCleanupError?.(error);
        throw error;
      }
  }
}
