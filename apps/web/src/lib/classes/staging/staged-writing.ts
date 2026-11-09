import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import type { Prisma } from '@/generated/prisma/client';
import { validateClassPreparation } from '../preparation';
import { PreparationConflictError, type ClassPreparation } from '../preparation-state';
import { writingRepairSourceHash } from '../repair/writing-repair-source';

async function requireWritingOperation(
  database: Prisma.TransactionClient,
  operation: ClassPreparation
) {
  const current = await validateClassPreparation(database, operation.courseId, operation.id);
  if (
    !isDeepStrictEqual(current.intent, operation.intent) ||
    !isDeepStrictEqual(current.grant, operation.grant) ||
    current.userId !== operation.userId ||
    current.instanceId !== operation.instanceId ||
    current.courseCreatedAt !== operation.courseCreatedAt ||
    current.userCreatedAt !== operation.userCreatedAt ||
    current.intent?.kind !== 'REPAIR' ||
    !current.intent.skills.includes('WRITING')
  )
    throw new PreparationConflictError('The writing repair authority changed.');
  if (!current.intent.writingSourceHash)
    throw new PreparationConflictError('The admitted writing repair source is unavailable.');
  return current.intent;
}

async function stagedWritingMaterialHash(database: Prisma.TransactionClient, sectionId: string) {
  const section = await database.classSection.findUniqueOrThrow({
    where: { id: sectionId },
    include: { writingPrompts: { orderBy: { id: 'asc' } } },
  });
  return {
    section,
    digest: createHash('sha256')
      .update(
        JSON.stringify({
          id: section.id,
          incarnationId: section.incarnationId,
          classId: section.classId,
          skill: section.skill,
          attempt: section.attempt,
          status: section.status,
          withdrawn: section.withdrawn,
          seed: section.seed,
          spec: section.spec,
          prompts: section.writingPrompts,
        })
      )
      .digest('hex'),
  };
}

export async function stageClassWriting(
  database: Prisma.TransactionClient,
  operation: ClassPreparation,
  input: { classId: string; attempt: number; sectionId: string; sourceHash: string }
) {
  const intent = await requireWritingOperation(database, operation);
  if (
    input.classId !== intent.classId ||
    input.attempt !== intent.attempt ||
    input.sourceHash !== intent.writingSourceHash ||
    (await writingRepairSourceHash(database, input.classId, input.attempt)) !== input.sourceHash
  )
    throw new PreparationConflictError('The saved writing material changed during repair.');
  const material = await stagedWritingMaterialHash(database, input.sectionId);
  if (
    material.section.classId !== input.classId ||
    material.section.attempt !== input.attempt ||
    material.section.skill !== 'WRITING' ||
    !material.section.withdrawn ||
    material.section.status !== 'READY'
  )
    throw new PreparationConflictError('The staged writing section changed.');
  await database.classWritingStage.create({
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

export async function activateStagedWriting(
  database: Prisma.TransactionClient,
  operation: ClassPreparation
) {
  const intent = await requireWritingOperation(database, operation);
  const sections = await database.classSection.findMany({
    where: { classId: intent.classId, skill: 'WRITING', attempt: intent.attempt },
    select: { id: true },
  });
  if (sections.length !== 1)
    throw new PreparationConflictError('The staged writing section is unavailable.');
  const sectionId = sections[0]!.id;
  await database.$queryRaw`SELECT "sectionId" FROM "ClassWritingStage" WHERE "sectionId" = ${sectionId} FOR UPDATE`;
  const stage = await database.classWritingStage.findUnique({ where: { sectionId } });
  const material = await stagedWritingMaterialHash(database, sectionId);
  const response = await database.writingResponse.findFirst({
    where: {
      OR: [
        { sectionId },
        { promptId: { in: material.section.writingPrompts.map((prompt) => prompt.id) } },
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
    response !== null ||
    stage.materialHash !== material.digest ||
    stage.sourceHash !== intent.writingSourceHash ||
    stage.sourceHash !== (await writingRepairSourceHash(database, intent.classId, intent.attempt))
  )
    throw new PreparationConflictError('The staged writing material changed.');
  await database.classWritingStage.delete({ where: { sectionId } });
  await database.classSection.update({ where: { id: sectionId }, data: { withdrawn: false } });
}
