import { prismaUnfiltered } from '../../../prisma';
import { isDeepStrictEqual } from 'node:util';
import { randomUUID } from 'node:crypto';
import type { LearningDatabase } from '../../database';
import { Prisma } from '@/generated/prisma/client';
import type { SkillRequirements } from '@sotto/shared';
import type { SottoProviderExecution } from '../../../sidedoor/credentials/runtime/provider-execution';
import { sottoTransaction } from '../../../sidedoor/access/state/transaction';
import { assertStoredClassMaterial } from './class-material';
import { seedPublishedClassMemory } from './class-memory';
import { assessmentFenceBackend, assessmentFenceStore } from '../lifecycle/assessment-fence';
import { PreparationConflictError } from '../../../classes/preparation-state';
import { materializeInitialA1TeachingSeed } from '../../../classes/lesson/teaching';
import { materializeInitialA1SectionReviews } from '../../../class-generation';
import { materializeInitialA1WritingReview } from '../../../class-writing-generator';
import { materializeInitialA1SpeakingReview } from '../../../class-speaking-generator';
import { materializeInitialA1ListeningReview } from '../../../class-listening-generator';
import {
  initialA1MaterialHash,
  initialA1ProvenanceSchema,
} from '../../../classes/lesson/initial-a1-provenance';
import {
  requireStoredInitialA1Sections,
  requireStoredInitialA1Writing,
  requireStoredInitialA1Speaking,
  requireStoredInitialA1Listening,
} from '../../../classes/quality/section-review/stored-section-review';

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
  await database.$queryRaw`
    SELECT cls.id FROM "CourseClass" cls
    JOIN "Course" course ON course.id = cls."courseId"
    WHERE cls.id = ${classId} AND course."userId" = ${actor.userId}
    FOR UPDATE OF cls
  `;
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
  const assessment = await database.classAssessment.findFirst({
    where: { classId },
    select: { id: true },
  });
  const fence = await assessmentFenceStore(assessmentFenceBackend(database, classId)).read();
  if (assessment || fence.current)
    throw new PreparationConflictError(
      'This class has assessment work that must be preserved before regeneration.'
    );
  const attempt = Math.max(cls.attempt, ...cls.sections.map((section) => section.attempt)) + 1;
  await database.courseClass.update({
    where: { id: classId },
    data: {
      status: 'GENERATING',
      prerequisiteGate: Prisma.DbNull,
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
  userId: string
): Promise<void> {
  await database.$queryRaw`
    SELECT cls.id FROM "CourseClass" cls
    JOIN "Course" course ON course.id = cls."courseId"
    WHERE cls.id = ${classId} AND course."userId" = ${userId}
    FOR UPDATE OF cls
  `;
  const cls = await database.courseClass.findUnique({
    where: { id: classId },
    select: { status: true, attempt: true, course: { select: { userId: true } } },
  });
  if (
    !cls ||
    cls.status !== 'GENERATING' ||
    cls.attempt !== attempt ||
    cls.course.userId !== userId
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
    requireInitialA1TeachingProof?: boolean;
    requireInitialA1SectionProof?: boolean;
    requireInitialA1WritingProof?: boolean;
    requireInitialA1SpeakingProof?: boolean;
    requireInitialA1ListeningProof?: boolean;
    retainedQuizSectionIds?: readonly string[];
  }
) {
  const materialized = input.requireInitialA1TeachingProof
    ? materializeInitialA1TeachingSeed(input.data.adaptiveSeed, input)
    : undefined;
  const sectionProof = input.requireInitialA1SectionProof
    ? materializeInitialA1SectionReviews(input.data.adaptiveSeed as object, input)
    : undefined;
  const writingProof = input.requireInitialA1WritingProof
    ? materializeInitialA1WritingReview(input.data.adaptiveSeed as object, input)
    : undefined;
  if (input.requireInitialA1SpeakingProof && !materialized)
    throw new ClassGenerationCancelledError(input.classId);
  const speakingProof =
    input.requireInitialA1SpeakingProof &&
    materialized?.scope.requirements.skills.SPEAKING.state === 'REQUIRED'
      ? materializeInitialA1SpeakingReview(input.data.adaptiveSeed as object, input)
      : undefined;
  if (input.requireInitialA1ListeningProof && !materialized)
    throw new ClassGenerationCancelledError(input.classId);
  const listeningProof =
    input.requireInitialA1ListeningProof &&
    materialized?.scope.requirements.skills.LISTENING.state === 'REQUIRED'
      ? materializeInitialA1ListeningReview(input.data.adaptiveSeed as object, input)
      : undefined;
  const data = materialized ? { ...input.data, adaptiveSeed: materialized.seed } : input.data;
  await assertClassGeneration(database, input.classId, input.attempt, input.userId);
  const cls = await database.courseClass.findUniqueOrThrow({
    where: { id: input.classId },
    select: {
      courseId: true,
      lessonId: true,
      sourceTitle: true,
      sourceUrl: true,
      skillRequirements: true,
      course: { select: { nativeLang: true, targetLang: true } },
      lesson: { select: { title: true, objective: true } },
    },
  });
  if (materialized) {
    const scope = materialized.scope;
    const title = data.sourceTitle === undefined ? cls.sourceTitle : data.sourceTitle;
    const url = data.sourceUrl === undefined ? cls.sourceUrl : data.sourceUrl;
    if (
      scope.courseId !== cls.courseId ||
      scope.lesson.id !== cls.lessonId ||
      !isDeepStrictEqual(scope.requirements, cls.skillRequirements) ||
      !isDeepStrictEqual(scope.course, cls.course) ||
      !isDeepStrictEqual(
        { title: scope.lesson.title, objective: scope.lesson.objective },
        cls.lesson
      ) ||
      !isDeepStrictEqual(scope.sourceBefore, { title: cls.sourceTitle, url: cls.sourceUrl }) ||
      !isDeepStrictEqual(scope.sourceAfter, { title, url })
    )
      throw new ClassGenerationCancelledError(input.classId);
  }
  if (sectionProof) {
    if (!materialized) throw new ClassGenerationCancelledError(input.classId);
    const skills = (['GRAMMAR', 'READING'] as const).filter(
      (skill) => materialized.scope.requirements.skills[skill].state === 'REQUIRED'
    );
    if (
      sectionProof.length !== skills.length ||
      sectionProof.some((item) => item.courseId !== cls.courseId || !skills.includes(item.skill))
    )
      throw new ClassGenerationCancelledError(input.classId);
    await requireStoredInitialA1Sections(database, input.classId, sectionProof);
  }
  if (writingProof) {
    if (
      !materialized ||
      writingProof.courseId !== cls.courseId ||
      materialized.scope.requirements.skills.WRITING.state !== 'REQUIRED' ||
      writingProof.prompts.length !== materialized.scope.requirements.skills.WRITING.expectedCount
    )
      throw new ClassGenerationCancelledError(input.classId);
    await requireStoredInitialA1Writing(database, input.classId, writingProof);
  }
  if (speakingProof) {
    if (
      !materialized ||
      speakingProof.courseId !== cls.courseId ||
      materialized.scope.requirements.skills.SPEAKING.state !== 'REQUIRED' ||
      speakingProof.prompts.length !== materialized.scope.requirements.skills.SPEAKING.expectedCount
    )
      throw new ClassGenerationCancelledError(input.classId);
    await requireStoredInitialA1Speaking(database, input.classId, speakingProof);
  }
  if (listeningProof) {
    if (
      !materialized ||
      listeningProof.courseId !== cls.courseId ||
      materialized.scope.requirements.skills.LISTENING.state !== 'REQUIRED' ||
      listeningProof.questions.length !==
        materialized.scope.requirements.skills.LISTENING.expectedCount
    )
      throw new ClassGenerationCancelledError(input.classId);
    await requireStoredInitialA1Listening(database, input.classId, listeningProof);
  }
  const published = await database.course.updateMany({
    where: {
      id: cls.courseId,
      userId: input.userId,
      OR: [{ activeClassId: null }, { activeClassId: input.classId }],
    },
    data: { activeClassId: input.classId },
  });
  if (published.count !== 1) throw new Error('The active course class changed during generation.');
  await seedPublishedClassMemory(database, input.classId, input.userId, data.adaptiveSeed);
  await assertStoredClassMaterial(
    database,
    input.classId,
    input.retainedQuizSectionIds
      ? { retainedSections: input.retainedQuizSectionIds }
      : 'publication'
  );
  await database.courseClass.update({
    where: { id: input.classId },
    data: { ...data, status: input.status ?? 'AVAILABLE', prerequisiteGate: Prisma.DbNull },
  });
  const fullyReviewed =
    input.requireInitialA1TeachingProof === true &&
    input.requireInitialA1SectionProof === true &&
    input.requireInitialA1WritingProof === true &&
    input.requireInitialA1SpeakingProof === true &&
    input.requireInitialA1ListeningProof === true;
  if (fullyReviewed) {
    if (
      !materialized ||
      !sectionProof ||
      !writingProof ||
      materialized.scope.requirements.level !== 'A1' ||
      (materialized.scope.requirements.skills.SPEAKING.state === 'REQUIRED' && !speakingProof) ||
      (materialized.scope.requirements.skills.LISTENING.state === 'REQUIRED' && !listeningProof)
    )
      throw new ClassGenerationCancelledError(input.classId);
    const receipt = initialA1ProvenanceSchema.parse({
      version: 1,
      receiptId: randomUUID(),
      classId: input.classId,
      courseId: cls.courseId,
      userId: input.userId,
      attempt: input.attempt,
      materialHash: await initialA1MaterialHash(database, input.classId, input.userId),
    });
    await database.courseClass.update({
      where: { id: input.classId },
      data: { prerequisiteGate: receipt },
    });
  }
}

/** Internal cleanup changes only the failed claim, with no new provider authority. */
export async function settleClassGenerationFailure(
  classId: string,
  attempt: number,
  userId: string
): Promise<boolean> {
  return sottoTransaction(prismaUnfiltered, async (database) => {
    await database.$queryRaw`
      SELECT cls.id FROM "CourseClass" cls
      JOIN "Course" course ON course.id = cls."courseId"
      WHERE cls.id = ${classId} AND course."userId" = ${userId}
      FOR UPDATE OF cls
    `;
    const failed = await database.courseClass.updateMany({
      where: { id: classId, attempt, status: 'GENERATING', course: { userId } },
      data: { status: 'FAILED', failedAt: new Date() },
    });
    return failed.count === 1;
  });
}
