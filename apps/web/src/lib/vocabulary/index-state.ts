import { createHash } from 'node:crypto';
import { z } from 'zod';
import { preparationSchema } from '../classes/preparation-state';
import { captureCourseStorage } from '../sidedoor/storage/core/course-storage';
import { storageInputSchema, validateStorageInputs } from '../sidedoor/storage/core/storage-inputs';
import { learningPreparationGrant } from '../learning/preparation/preparation-grant';
import type { LearningDatabase } from '../learning/database';
import { VocabularyStudyNotFound, VocabularyStudyUnavailable } from './study-state';

export const vocabularyIndexPayloadSchema = z.discriminatedUnion('phase', [
  z
    .object({
      phase: z.literal('PREPARE'),
      userId: z.string(),
      indexId: z.uuid(),
      generation: z.number().int().positive(),
      retry: z.boolean(),
    })
    .strict(),
  z
    .object({
      phase: z.literal('CHUNK'),
      userId: z.string(),
      chunkId: z.uuid(),
      generation: z.number().int().positive(),
    })
    .strict(),
]);
export const vocabularyIndexOperationSchema = preparationSchema.pick({
  id: true,
  courseId: true,
  userId: true,
  instanceId: true,
  courseCreatedAt: true,
  userCreatedAt: true,
  expiresAt: true,
  maxProviderRequests: true,
  selection: true,
  grant: true,
});
export type VocabularyIndexOperation = z.infer<typeof vocabularyIndexOperationSchema>;
export const vocabularyIndexGrant = (
  database: LearningDatabase,
  operation: VocabularyIndexOperation
) => learningPreparationGrant(database, operation, 'vocabulary');
export const sourceTextHash = (text: string) => createHash('sha256').update(text).digest('hex');
export const materialVocabularyFingerprint = (input: {
  text: string;
  reference: string;
  nativeLang: string;
  targetLang: string;
}) =>
  sourceTextHash(
    JSON.stringify([
      'source-inventory-v1',
      input.nativeLang,
      input.targetLang,
      input.reference,
      sourceTextHash(input.text),
    ])
  );

export async function validateVocabularyIndex(
  database: LearningDatabase,
  indexId: string,
  userId: string
) {
  const index = await database.materialVocabularyIndex.findUnique({
    where: { id: indexId },
    include: { material: true, course: true },
  });
  if (
    !index ||
    index.course.userId !== userId ||
    index.material.userId !== userId ||
    index.material.courseId !== index.courseId ||
    index.material.createdAt.getTime() !== index.materialCreatedAt.getTime()
  )
    throw new VocabularyStudyNotFound('Vocabulary source is no longer attached to this course.');
  const reference = z.object({ reference: z.string().min(1) }).parse(index.originalInput).reference;
  if (
    index.protocol !== 1 ||
    index.material.originalUrl !== reference ||
    index.material.extractedText.length !== index.textLength ||
    sourceTextHash(index.material.extractedText) !== index.textHash ||
    index.course.nativeLang !== index.nativeLang ||
    index.course.targetLang !== index.targetLang
  )
    throw new VocabularyStudyUnavailable(
      'Vocabulary source changed. Start indexing its current version.'
    );
  const ownership = await captureCourseStorage(database, index.courseId);
  const input = storageInputSchema.safeParse(index.originalInput);
  if (input.success) await validateStorageInputs(database, [input.data]);
  return { index, ownership, originalInput: input.success ? input.data : null };
}

export async function validateVocabularyChunk(
  database: LearningDatabase,
  chunkId: string,
  generation: number,
  userId: string
) {
  const chunk = await database.vocabularyIndexChunk.findUnique({ where: { id: chunkId } });
  if (!chunk || chunk.generation !== generation || !chunk.operation)
    throw new VocabularyStudyUnavailable('Vocabulary indexing attempt changed.');
  const operation = vocabularyIndexOperationSchema.parse(chunk.operation);
  const source = await validateVocabularyIndex(database, chunk.indexId, userId);
  if (
    !source.originalInput ||
    operation.courseId !== source.index.courseId ||
    operation.userId !== userId ||
    operation.instanceId !== source.ownership.instanceId ||
    !source.ownership.scopes.some(
      (scope) =>
        scope.subjectId === `course:${operation.courseId}` &&
        scope.generation === operation.courseCreatedAt
    ) ||
    !source.ownership.scopes.some(
      (scope) =>
        scope.subjectId === `profile:${userId}` && scope.generation === operation.userCreatedAt
    )
  )
    throw new VocabularyStudyUnavailable('Vocabulary indexing authority changed.');
  return { ...source, chunk, operation };
}
