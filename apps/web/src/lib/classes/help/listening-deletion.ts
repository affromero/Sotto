import type { Prisma } from '@/generated/prisma/client';
import { isDeepStrictEqual } from 'node:util';
import { StorageReferenceRegistry } from 'thesidedoor-core/storage';
import { SIDEDOOR_STATE_ID } from '@/lib/sidedoor/access/state/store';
import { captureEpisodeStorage } from '@/lib/sidedoor/storage/core/episode-storage';
import { sottoJobOutbox } from '@/lib/sidedoor/jobs/core/job-delivery';
import { sottoJobExecutions } from '@/lib/sidedoor/jobs/core/job-execution-lifetime';
import { worksheetPdfPayloadSchema } from '@/lib/sidedoor/jobs/stitch/worksheet-pdf-work';
import { transcriptExportPayloadSchema } from '@/lib/sidedoor/storage/publication/transcript-export';
import { PrerequisiteDeletionConflict } from './prerequisite-deletion';

/** Legacy worksheet jobs do not have a class scope, so inspect their course index. */
export async function requireLegacyWorksheetDeletionSafe(
  database: Prisma.TransactionClient,
  courseScope: { subjectId: string; generation: number },
  classId: string
) {
  const outbox = sottoJobOutbox(database);
  let cursor: string | null = null;
  do {
    const page = await outbox.listForScope(courseScope.subjectId, courseScope.generation, cursor);
    for (const item of page.jobs) {
      const receipt = await outbox.receipt(item.id);
      if (!receipt || receipt.fingerprint !== item.fingerprint)
        throw new PrerequisiteDeletionConflict();
      if (
        receipt.handler !== 'worksheet-pdf' ||
        receipt.version !== 1 ||
        receipt.status === 'erased'
      )
        continue;
      const record = await outbox.read(item.id);
      const payload = worksheetPdfPayloadSchema.safeParse(record?.job.payload);
      if (!record || record.fingerprint !== item.fingerprint || !payload.success)
        throw new PrerequisiteDeletionConflict();
      if (payload.data.classId === classId)
        throw new PrerequisiteDeletionConflict(
          'This class has older worksheet work that requires complete cleanup before deletion.'
        );
    }
    if (page.cursor !== null && cursor !== null && page.cursor <= cursor)
      throw new PrerequisiteDeletionConflict();
    cursor = page.cursor;
  } while (cursor !== null);
}

/** Require the saved worksheet to belong to this exact class generation. */
export async function requireClassWorksheetOwnership(
  database: Prisma.TransactionClient,
  classId: string,
  reference: string,
  scopes: readonly { subjectId: string; generation: number }[],
  operations: readonly { id: string; fingerprint: string }[]
) {
  if (!operations.length)
    throw new PrerequisiteDeletionConflict(
      'This class has a worksheet that requires complete media cleanup before deletion.'
    );
  const registry = new StorageReferenceRegistry(
    { query: (sql, values) => database.$queryRawUnsafe<Record<string, unknown>[]>(sql, ...values) },
    'postgres',
    SIDEDOOR_STATE_ID
  );
  const asset = await registry.resolve({ consumer: `class:${classId}:worksheet`, reference });
  if (!asset || !isDeepStrictEqual(asset.prepared.scopes, scopes))
    throw new PrerequisiteDeletionConflict(
      'This class has a worksheet that requires complete media cleanup before deletion.'
    );
}

/** Inventory listening episodes while their class and owner are still present. */
export async function inspectClassListeningDeletion(
  database: Prisma.TransactionClient,
  classId: string,
  courseId: string,
  userId: string
) {
  const sections = await database.classSection.findMany({
    where: { classId, episodeId: { not: null } },
    select: { id: true, episodeId: true },
  });
  const subjects: { subjectId: string; generation: number }[] = [];
  const outbox = sottoJobOutbox(database);
  const executions = sottoJobExecutions(database);
  for (const section of sections) {
    if (!section.episodeId) throw new PrerequisiteDeletionConflict();
    const episode = await database.episode.findUnique({
      where: { id: section.episodeId },
      select: {
        source: true,
        visibility: true,
        assessmentAudioAssessmentId: true,
        assessmentAudioSectionId: true,
        assessmentAudioOperationId: true,
      },
    });
    if (
      !episode ||
      episode.source !== 'CLASS' ||
      episode.visibility !== 'PRIVATE' ||
      episode.assessmentAudioAssessmentId ||
      episode.assessmentAudioSectionId ||
      episode.assessmentAudioOperationId
    )
      throw new PrerequisiteDeletionConflict();
    const ownership = await captureEpisodeStorage(database, section.episodeId);
    if (
      ownership.userId !== userId ||
      ownership.associations.classSection?.id !== section.id ||
      ownership.associations.classSection.classId !== classId ||
      ownership.associations.examSection ||
      ownership.associations.practiceSession ||
      ownership.associations.assessmentSection ||
      !ownership.scopes.some((scope) => scope.subjectId === `course:${courseId}`)
    )
      throw new PrerequisiteDeletionConflict();
    const subject = ownership.scopes.find(
      (scope) => scope.subjectId === `episode:${section.episodeId}`
    );
    if (!subject) throw new PrerequisiteDeletionConflict();
    let cursor: string | null = null;
    do {
      const page = await outbox.listForScope(subject.subjectId, subject.generation, cursor);
      for (const item of page.jobs) {
        const receipt = await outbox.receipt(item.id);
        if (
          !receipt ||
          receipt.fingerprint !== item.fingerprint ||
          !['complete', 'erased'].includes(receipt.status) ||
          !(
            (receipt.handler === 'audio-generation' && receipt.version === 1) ||
            (receipt.handler === 'audio-stitching' && receipt.version === 2) ||
            (receipt.handler === 'pdf-generation' && receipt.version === 2) ||
            (receipt.handler === 'storage-migration-copy' && receipt.version === 1) ||
            (['pdf-generation', 'waveform-generation', 'notifications', 'episode-status'].includes(
              receipt.handler
            ) &&
              receipt.version === 1)
          )
        )
          throw new PrerequisiteDeletionConflict();
        if (receipt.status !== 'erased') {
          const record = await outbox.read(item.id);
          if (
            !record ||
            record.fingerprint !== item.fingerprint ||
            !ownership.scopes.every((scope) =>
              record.job.scopes.some(
                (actual) =>
                  actual.subjectId === scope.subjectId && actual.generation === scope.generation
              )
            )
          )
            throw new PrerequisiteDeletionConflict();
          if (receipt.handler === 'pdf-generation' && receipt.version === 2) {
            const payload = transcriptExportPayloadSchema.safeParse(record.job.payload);
            if (
              !payload.success ||
              payload.data.episodeId !== section.episodeId ||
              !isDeepStrictEqual(payload.data.storage, ownership) ||
              !isDeepStrictEqual(payload.data.delegation.scopes, record.job.scopes)
            )
              throw new PrerequisiteDeletionConflict();
          }
        }
        await executions.requireParentDrained(item.id, item.fingerprint);
      }
      if (page.cursor !== null && cursor !== null && page.cursor <= cursor)
        throw new PrerequisiteDeletionConflict();
      cursor = page.cursor;
    } while (cursor !== null);
    subjects.push(subject);
  }
  return subjects;
}
