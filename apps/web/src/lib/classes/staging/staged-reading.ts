import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { readingVocabularySchema } from '@sotto/shared';
import { z } from 'zod';
import type { Prisma } from '@/generated/prisma/client';
import {
  quizRetrySourceDigest,
  readReadingRepairSnapshot,
} from '../../learning/classes/formative/class-repair';
import { classPreparationStore, validateClassPreparation } from '../preparation';
import { PreparationConflictError, type ClassPreparation } from '../preparation-state';
import type { SottoProviderExecution } from '../../sidedoor/credentials/runtime/provider-execution';

const sourceSchema = z
  .object({
    digest: z.string().regex(/^[a-f0-9]{64}$/),
    progressRevision: z.number().int().nonnegative(),
    readingVocabulary: z.json().nullable(),
    passage: z.string().nullable(),
  })
  .strict()
  .refine((value) => Buffer.byteLength(JSON.stringify(value), 'utf8') <= 262144);
const vocabularySchema = readingVocabularySchema.refine(
  (value) => Buffer.byteLength(JSON.stringify(value), 'utf8') <= 262144
);

type StageInput = Parameters<NonNullable<SottoProviderExecution['stageClassReading']>>[1];

async function requireStagedOperation(
  database: Prisma.TransactionClient,
  operation: ClassPreparation
) {
  const current = await validateClassPreparation(database, operation.courseId, operation.id);
  if (
    !isDeepStrictEqual(current.intent, operation.intent) ||
    !isDeepStrictEqual(current.grant, operation.grant) ||
    current.userId !== operation.userId ||
    current.instanceId !== operation.instanceId ||
    current.userCreatedAt !== operation.userCreatedAt ||
    current.courseCreatedAt !== operation.courseCreatedAt ||
    current.intent?.kind !== 'REPAIR' ||
    !current.intent.skills.includes('READING')
  )
    throw new PreparationConflictError('The reading repair authority changed.');
  return current.intent;
}

export async function stageClassReading(
  database: Prisma.TransactionClient,
  operation: ClassPreparation,
  input: StageInput
) {
  const intent = await requireStagedOperation(database, operation);
  if (input.classId !== intent.classId || input.attempt !== intent.attempt)
    throw new PreparationConflictError('The staged reading target changed.');
  const section = await database.classSection.findUniqueOrThrow({
    where: { id: input.sectionId },
    include: { questions: true },
  });
  if (
    section.classId !== input.classId ||
    section.attempt !== input.attempt ||
    section.skill !== 'READING' ||
    !section.withdrawn ||
    section.status !== 'READY'
  )
    throw new PreparationConflictError('The staged reading section changed.');
  const source = sourceSchema.parse(input.source);
  const vocabulary = vocabularySchema.parse(input.vocabulary);
  if (
    !isDeepStrictEqual(
      await readReadingRepairSnapshot(database, input.classId, input.attempt),
      source
    )
  )
    throw new PreparationConflictError('The saved reading material changed during repair.');
  const digest = quizRetrySourceDigest(
    { id: input.classId, courseId: operation.courseId, learnerAnswers: null, sections: [section] },
    'READING',
    input.attempt + 1
  );
  await database.classReadingStage.create({
    data: {
      sectionId: section.id,
      operationId: operation.id,
      incarnationId: section.incarnationId,
      version: 1,
      source,
      vocabulary,
      materialHash: digest,
    },
  });
}

export async function activateStagedReading(
  database: Prisma.TransactionClient,
  operation: ClassPreparation
) {
  const intent = await requireStagedOperation(database, operation);
  const current = await classPreparationStore(database, operation.courseId).read();
  if (!current || current.id !== operation.id) throw new PreparationConflictError();
  const sections = await database.classSection.findMany({
    where: { classId: intent.classId, skill: 'READING', attempt: intent.attempt },
    include: { questions: true, readingStage: true },
  });
  if (sections.length !== 1)
    throw new PreparationConflictError('The staged reading section is unavailable.');
  const section = sections[0]!;
  await database.$queryRaw`SELECT "sectionId" FROM "ClassReadingStage" WHERE "sectionId" = ${section.id} FOR UPDATE`;
  const stage = await database.classReadingStage.findUnique({ where: { sectionId: section.id } });
  if (
    !stage ||
    stage.version !== 1 ||
    stage.operationId !== operation.id ||
    stage.incarnationId !== section.incarnationId ||
    !section.withdrawn ||
    section.status !== 'READY'
  )
    throw new PreparationConflictError('The staged reading section changed.');
  const source = sourceSchema.parse(stage.source);
  if (
    !isDeepStrictEqual(
      await readReadingRepairSnapshot(database, intent.classId, intent.attempt),
      source
    )
  )
    throw new PreparationConflictError('The saved reading material changed during repair.');
  const digest = quizRetrySourceDigest(
    { id: intent.classId, courseId: operation.courseId, learnerAnswers: null, sections: [section] },
    'READING',
    intent.attempt + 1
  );
  const vocabulary = vocabularySchema.parse(stage.vocabulary);
  const ids = new Set(section.questions.map((question) => question.id));
  if (
    digest !== stage.materialHash ||
    vocabulary.sourceHash !== createHash('sha256').update(vocabulary.passageText).digest('hex') ||
    section.questions.some((question) => question.passageText !== vocabulary.passageText) ||
    vocabulary.words.some(
      (word) =>
        !vocabulary.passageText.includes(word.sourceForm) ||
        word.questionIds.some((id) => !ids.has(id))
    )
  )
    throw new PreparationConflictError('The staged reading material changed.');
  await database.classReadingStage.delete({ where: { sectionId: section.id } });
  await database.classSection.update({ where: { id: section.id }, data: { withdrawn: false } });
  await database.courseClass.update({
    where: { id: intent.classId },
    data: { readingVocabulary: vocabulary },
  });
}
