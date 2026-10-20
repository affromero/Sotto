import { prepareJob } from 'thesidedoor-core/runtime/outbox';
import { prismaUnfiltered as prisma } from '../prisma';
import { sottoTransaction } from '../sidedoor/access/state/transaction';
import { captureCourseStorage } from '../sidedoor/storage/core/course-storage';
import { SIDEDOOR_STATE_ID } from '../sidedoor/access/state/store';
import { sottoJobOutbox, deliverSottoJob } from '../sidedoor/jobs/core/job-delivery';
import { durableQueueOperationId } from '../sidedoor/jobs/core/durable-queue';
import { createQueue } from '../queue';
import type { LearningDatabase } from '../learning/database';
import type { SottoProviderExecution } from '../sidedoor/credentials/runtime/provider-execution';
import { materialVocabularyFingerprint, sourceTextHash } from './index-state';
import { planVocabularyChunks } from './index-chunks';
import { VocabularyStudyNotFound, VocabularyStudyUnavailable } from './study-state';
import { captureCanonicalVocabularySource, canonicalVocabularySourceHash } from './source/snapshot';
import { planCanonicalVocabularyChunks } from './source/ranges';

/** Called inside material attachment so the indexing intent cannot be lost after upload. */
export async function enqueueMaterialVocabularyIndex(
  database: LearningDatabase,
  materialId: string,
  userId: string,
  retry = false
) {
  const material = await database.courseMaterial.findFirst({
    where: { id: materialId, userId },
    include: { course: true },
  });
  if (!material?.course || !material.originalUrl)
    throw new VocabularyStudyNotFound('Attached material not found.');
  const { course } = material;
  if (course.userId !== userId) throw new VocabularyStudyNotFound('Course not found.');
  if (material.originalSha256 && !['READY', 'PARTIAL'].includes(material.processingStatus))
    throw new VocabularyStudyUnavailable(
      'Complete the retained material extraction before indexing its current source.'
    );
  const sourceSnapshot = material.originalSha256
    ? await captureCanonicalVocabularySource(database, material)
    : null;
  const textHash = sourceSnapshot
    ? canonicalVocabularySourceHash(sourceSnapshot)
    : sourceTextHash(material.extractedText);
  const sourceFingerprint = sourceSnapshot
    ? sourceTextHash(
        JSON.stringify([
          'source-inventory-v2',
          course.nativeLang,
          course.targetLang,
          material.originalUrl,
          textHash,
        ])
      )
    : materialVocabularyFingerprint({
        text: material.extractedText,
        reference: material.originalUrl,
        nativeLang: course.nativeLang,
        targetLang: course.targetLang,
      });
  await database.materialVocabularyIndex.createMany({
    data: {
      materialId,
      courseId: course.id,
      sourceFingerprint,
      textHash,
      textLength: sourceSnapshot?.inventory.length ?? material.extractedText.length,
      ...(sourceSnapshot ? { protocol: 2, sourceSnapshot } : {}),
      originalInput: { reference: material.originalUrl },
      materialCreatedAt: material.createdAt,
      nativeLang: course.nativeLang,
      targetLang: course.targetLang,
    },
    skipDuplicates: true,
  });
  let index = await database.materialVocabularyIndex.findUniqueOrThrow({
    where: { materialId_sourceFingerprint: { materialId, sourceFingerprint } },
  });
  if (index.status === 'COMPLETE' || index.status === 'NEEDS_TEXT')
    return { index, delivery: null };
  let ranges: ReturnType<typeof planVocabularyChunks>;
  try {
    ranges = sourceSnapshot
      ? await planCanonicalVocabularyChunks(database, sourceSnapshot, course.targetLang)
      : planVocabularyChunks(material.extractedText, course.targetLang);
  } catch (error) {
    index = await database.materialVocabularyIndex.update({
      where: { id: index.id },
      data: {
        status: 'NEEDS_TEXT',
        error: error instanceof Error ? error.message : 'Add a reviewed text transcription.',
      },
    });
    return { index, delivery: null };
  }
  await database.vocabularyIndexChunk.createMany({
    data: ranges.map((range) => ({ indexId: index.id, ...range })),
    skipDuplicates: true,
  });
  if (sourceSnapshot && ranges.length === 0) {
    index = await database.materialVocabularyIndex.update({
      where: { id: index.id },
      data: {
        status: sourceSnapshot.inventory.coverage.coverageComplete ? 'COMPLETE' : 'NEEDS_TEXT',
        error: sourceSnapshot.inventory.coverage.coverageComplete
          ? null
          : 'No readable text is available and original page coverage remains unresolved.',
      },
    });
    return { index, delivery: null };
  }
  if (retry && ['FAILED', 'UNRESOLVED'].includes(index.status))
    index = await database.materialVocabularyIndex.update({
      where: { id: index.id },
      data: { generation: { increment: 1 }, status: 'PENDING', error: null },
    });
  const ownership = await captureCourseStorage(database, course.id);
  const id = durableQueueOperationId('vocabulary-index', `prepare-${index.id}-${index.generation}`);
  const existing = await sottoJobOutbox(database).read(id);
  const record = await sottoJobOutbox(database).enqueue(
    prepareJob({
      id,
      namespace: SIDEDOOR_STATE_ID,
      handler: 'vocabulary-index',
      version: 1,
      payload: {
        type: 'vocabulary-index',
        payload: {
          phase: 'PREPARE',
          userId,
          indexId: index.id,
          generation: index.generation,
          retry: index.generation > 1,
        },
        authority: {
          kind: 'profile',
          userId,
          createdAt: ownership.scopes.find((scope) => scope.subjectId === `profile:${userId}`)!
            .generation,
          instanceId: ownership.instanceId,
        },
      },
      scopes: [
        ...ownership.scopes,
        { subjectId: `material:${material.id}`, generation: material.createdAt.getTime() },
      ],
      delivery: {
        attempts: 1,
        priority: 0,
        availableAt: existing?.job.delivery.availableAt ?? Date.now(),
      },
    })
  );
  return { index, delivery: { operationId: id, fingerprint: record.fingerprint, version: 1 } };
}

export async function requestMaterialVocabularyIndex(
  materialId: string,
  execution: SottoProviderExecution,
  retry = false
) {
  const admitted = await sottoTransaction(prisma, async (database) => {
    const actor = await execution.authorize(database);
    if (actor.userId !== execution.userId) throw new VocabularyStudyNotFound('Material not found.');
    return enqueueMaterialVocabularyIndex(database, materialId, actor.userId, retry);
  });
  if (admitted.delivery)
    await deliverSottoJob({
      database: prisma,
      queue: createQueue('vocabulary-index'),
      ...admitted.delivery,
    });
  return { id: admitted.index.id, status: admitted.index.status, error: admitted.index.error };
}
