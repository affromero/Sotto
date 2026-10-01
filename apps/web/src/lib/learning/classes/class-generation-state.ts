import { prismaUnfiltered } from '../../prisma';
import type { LearningDatabase } from '../database';
import type { Prisma } from '@/generated/prisma/client';
import type { SkillRequirements } from '@sotto/shared';
import type { SottoProviderExecution } from '../../sidedoor/credentials/runtime/provider-execution';
import { sottoTransaction } from '../../sidedoor/access/state/transaction';
import { assertStoredClassMaterial } from './class-material';

/** Allocate from the full history and claim before any regeneration provider request. */
export async function claimClassRegeneration(
  execution: SottoProviderExecution,
  classId: string,
  expected: { status: string; attempt: number; updatedAt: Date },
  requirements: SkillRequirements
): Promise<number> {
  return sottoTransaction(
    prismaUnfiltered,
    async (database) => {
      return claimClassRegenerationInTransaction(
        database,
        execution,
        classId,
        expected,
        requirements
      );
    },
    { signal: execution.signal }
  );
}

export async function claimClassRegenerationInTransaction(
  database: LearningDatabase,
  execution: SottoProviderExecution,
  classId: string,
  expected: { status: string; attempt: number; updatedAt: Date },
  requirements: SkillRequirements
): Promise<number> {
  const actor = await execution.authorize(database);
  if (actor.userId !== execution.userId) throw new ClassGenerationCancelledError(classId);
  await database.$queryRaw`SELECT id FROM "CourseClass" WHERE id = ${classId} FOR UPDATE`;
  const cls = await database.courseClass.findFirst({
    where: { id: classId, course: { userId: actor.userId } },
    include: { sections: { select: { attempt: true } } },
  });
  if (
    !cls ||
    cls.status === 'PASSED' ||
    cls.status === 'GENERATING' ||
    cls.status !== expected.status ||
    cls.attempt !== expected.attempt ||
    cls.updatedAt.getTime() !== expected.updatedAt.getTime()
  )
    throw new ClassGenerationCancelledError(classId);
  const attempt = Math.max(cls.attempt, ...cls.sections.map((section) => section.attempt)) + 1;
  await database.courseClass.update({
    where: { id: classId },
    data: {
      status: 'GENERATING',
      attempt,
      progressRevision: { increment: 1 },
      skillRequirements: requirements as unknown as Prisma.InputJsonValue,
      worksheetPdfUrl: null,
      submittedAt: null,
      passedAt: null,
      failedAt: null,
    },
  });
  execution.signal?.throwIfAborted();
  return attempt;
}

export class ClassGenerationCancelledError extends Error {
  constructor(classId: string) {
    super(`Class generation was cancelled for ${classId}`);
    this.name = 'ClassGenerationCancelledError';
  }
}

export async function assertClassGeneration(
  database: LearningDatabase,
  classId: string,
  attempt: number,
  userId?: string
): Promise<void> {
  await database.$queryRaw`SELECT id FROM "CourseClass" WHERE id = ${classId} FOR UPDATE`;
  const cls = await database.courseClass.findUnique({
    where: { id: classId },
    select: { status: true, attempt: true, course: { select: { userId: true } } },
  });
  if (
    !cls ||
    cls.status !== 'GENERATING' ||
    cls.attempt !== attempt ||
    (userId !== undefined && cls.course.userId !== userId)
  )
    throw new ClassGenerationCancelledError(classId);
}

/** Material writes share the attempt lock with regeneration and learner progress. */
export async function withClassGeneration<T>(
  execution: SottoProviderExecution,
  classId: string,
  attempt: number,
  write: (database: LearningDatabase) => Promise<T>
): Promise<T> {
  return sottoTransaction(
    prismaUnfiltered,
    async (database) => {
      const actor = await execution.authorize(database);
      if (actor.userId !== execution.userId) throw new ClassGenerationCancelledError(classId);
      await assertClassGeneration(database, classId, attempt, actor.userId);
      execution.signal?.throwIfAborted();
      const result = await write(database);
      execution.signal?.throwIfAborted();
      return result;
    },
    { signal: execution.signal }
  );
}

/** The caller also commits any grant, operation and outbox receipts in this transaction. */
export async function publishClassGeneration(
  database: LearningDatabase,
  input: {
    classId: string;
    attempt: number;
    userId: string;
    data: Pick<Prisma.CourseClassUpdateInput, 'adaptiveSeed' | 'sourceTitle' | 'sourceUrl'>;
    status?: 'AVAILABLE' | 'IN_PROGRESS';
  }
) {
  await assertClassGeneration(database, input.classId, input.attempt, input.userId);
  const cls = await assertStoredClassMaterial(database, input.classId);
  const published = await database.course.updateMany({
    where: {
      id: cls.courseId,
      userId: input.userId,
      OR: [{ activeClassId: null }, { activeClassId: input.classId }],
    },
    data: { activeClassId: input.classId },
  });
  if (published.count !== 1) throw new Error('The active course class changed during generation.');
  await database.courseClass.update({
    where: { id: input.classId },
    data: { ...input.data, status: input.status ?? 'AVAILABLE' },
  });
}

/** Internal cleanup changes only the failed claim, with no new provider authority. */
export async function settleClassGenerationFailure(
  classId: string,
  attempt: number,
  userId: string
): Promise<boolean> {
  return sottoTransaction(prismaUnfiltered, async (database) => {
    await database.$queryRaw`SELECT id FROM "CourseClass" WHERE id = ${classId} FOR UPDATE`;
    const failed = await database.courseClass.updateMany({
      where: { id: classId, attempt, status: 'GENERATING', course: { userId } },
      data: { status: 'FAILED', failedAt: new Date() },
    });
    return failed.count === 1;
  });
}
