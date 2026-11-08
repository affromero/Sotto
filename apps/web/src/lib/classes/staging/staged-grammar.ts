import { isDeepStrictEqual } from 'node:util';
import type { Prisma } from '@/generated/prisma/client';
import { quizRetrySourceDigest } from '../../learning/classes/formative/class-repair';
import { validateClassPreparation } from '../preparation';
import { PreparationConflictError, type ClassPreparation } from '../preparation-state';
import { grammarRepairSourceHash } from '../repair/grammar-repair-source';

async function requireGrammarOperation(
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
    !current.intent.skills.includes('GRAMMAR') ||
    !current.intent.grammarSourceHash
  )
    throw new PreparationConflictError('The grammar repair authority changed.');
  return current.intent;
}

async function stagedGrammarMaterial(
  database: Prisma.TransactionClient,
  classId: string,
  sectionId: string,
  courseId: string,
  attempt: number
) {
  const section = await database.classSection.findUniqueOrThrow({
    where: { id: sectionId },
    include: { questions: true },
  });
  return {
    section,
    digest: quizRetrySourceDigest(
      { id: classId, courseId, learnerAnswers: null, sections: [section] },
      'GRAMMAR',
      attempt + 1
    ),
  };
}

export async function stageClassGrammar(
  database: Prisma.TransactionClient,
  operation: ClassPreparation,
  input: { classId: string; attempt: number; sectionId: string; sourceHash: string }
) {
  const intent = await requireGrammarOperation(database, operation);
  if (
    input.classId !== intent.classId ||
    input.attempt !== intent.attempt ||
    input.sourceHash !== intent.grammarSourceHash ||
    input.sourceHash !== (await grammarRepairSourceHash(database, input.classId, input.attempt))
  )
    throw new PreparationConflictError('The saved grammar material changed during repair.');
  const material = await stagedGrammarMaterial(
    database,
    input.classId,
    input.sectionId,
    operation.courseId,
    input.attempt
  );
  if (
    material.section.classId !== input.classId ||
    material.section.attempt !== input.attempt ||
    material.section.skill !== 'GRAMMAR' ||
    !material.section.withdrawn ||
    material.section.status !== 'READY'
  )
    throw new PreparationConflictError('The staged grammar section changed.');
  await database.classGrammarStage.create({
    data: {
      sectionId: input.sectionId,
      operationId: operation.id,
      incarnationId: material.section.incarnationId,
      version: 1,
      sourceHash: input.sourceHash,
      materialHash: material.digest,
    },
  });
}

export async function activateStagedGrammar(
  database: Prisma.TransactionClient,
  operation: ClassPreparation
) {
  const intent = await requireGrammarOperation(database, operation);
  const sections = await database.classSection.findMany({
    where: { classId: intent.classId, skill: 'GRAMMAR', attempt: intent.attempt },
    select: { id: true },
  });
  if (sections.length !== 1)
    throw new PreparationConflictError('The staged grammar section is unavailable.');
  const sectionId = sections[0]!.id;
  await database.$queryRaw`SELECT "sectionId" FROM "ClassGrammarStage" WHERE "sectionId" = ${sectionId} FOR UPDATE`;
  const stage = await database.classGrammarStage.findUnique({ where: { sectionId } });
  const material = await stagedGrammarMaterial(
    database,
    intent.classId,
    sectionId,
    operation.courseId,
    intent.attempt
  );
  const stagedAnswer = await database.sectionAnswer.findFirst({
    where: {
      OR: [
        { sectionId },
        { questionId: { in: material.section.questions.map((question) => question.id) } },
      ],
    },
    select: { id: true },
  });
  if (
    !stage ||
    stage.version !== 1 ||
    stage.operationId !== operation.id ||
    stage.incarnationId !== material.section.incarnationId ||
    !material.section.withdrawn ||
    material.section.status !== 'READY' ||
    stagedAnswer !== null ||
    stage.materialHash !== material.digest ||
    stage.sourceHash !== intent.grammarSourceHash ||
    stage.sourceHash !== (await grammarRepairSourceHash(database, intent.classId, intent.attempt))
  )
    throw new PreparationConflictError('The staged grammar material changed.');
  await database.classGrammarStage.delete({ where: { sectionId } });
  await database.classSection.update({ where: { id: sectionId }, data: { withdrawn: false } });
}
