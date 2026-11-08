import { z } from 'zod';
import { Prisma, type PrismaClient } from '@/generated/prisma/client';
import type { SottoProviderExecution } from '@/lib/sidedoor/credentials/runtime/provider-execution';
import { sottoTransaction } from '@/lib/sidedoor/access/state/transaction';
import type { LearningDatabase } from '../../learning/database';
import { currentClassSections } from '../../learning/classes/progress/current-sections';
import { objectiveEvidenceHash } from '../../learning-map/evidence/protocol';
import { teachingFromSeed } from './teaching';
import { classPreludeResponseSchema } from '@sotto/shared';
import { classRequirementsOrLegacy } from '../../learning/skill-requirements';
import { readPrerequisiteStatus } from '../help/prerequisite-status';
import { acknowledgePrerequisite } from '../help/lifecycle/prerequisite-acknowledgment';
import { PrerequisiteSourceConflict } from '../help/content/prerequisite-source';
import { PrerequisiteFenceConflict } from '../help/lifecycle/prerequisite-fence';
import { createPrerequisiteTokenizer } from '../help/content/prerequisite-token';

const digest = z.string().regex(/^[a-f0-9]{64}$/);

/** Private receipt for one fully reviewed, published first-A1 class. */
export const initialA1ProvenanceSchema = z
  .object({
    version: z.literal(1),
    receiptId: z.uuid(),
    classId: z.string().min(1),
    courseId: z.string().min(1),
    userId: z.string().min(1),
    attempt: z.number().int().positive(),
    materialHash: digest,
    acknowledgment: z
      .object({ userId: z.string().min(1), receiptId: z.uuid(), materialHash: digest })
      .strict()
      .optional(),
  })
  .strict();

export class InitialA1ProvenanceConflict extends Error {
  constructor() {
    super('The class or its prerequisite teaching changed. Reopen the class.');
    this.name = 'InitialA1ProvenanceConflict';
  }
}

/** Hash task and teaching material without learner work, receipts or audio status. */
export async function classTaskMaterialHash(
  database: LearningDatabase,
  classId: string,
  userId: string,
  requireTeaching = false
) {
  const cls = await database.courseClass.findFirst({
    where: { id: classId, course: { userId } },
    select: {
      id: true,
      courseId: true,
      lessonId: true,
      attempt: true,
      passThreshold: true,
      learningSelection: true,
      readingVocabulary: true,
      sourceTitle: true,
      sourceUrl: true,
      skillRequirements: true,
      adaptiveSeed: true,
      course: { select: { userId: true, nativeLang: true, targetLang: true } },
      lesson: {
        select: {
          id: true,
          level: true,
          title: true,
          objective: true,
          grammarPoints: true,
          targetVocab: true,
        },
      },
      sections: {
        orderBy: [{ skill: 'asc' }, { attempt: 'asc' }, { id: 'asc' }],
        select: {
          id: true,
          skill: true,
          attempt: true,
          withdrawn: true,
          passThreshold: true,
          seed: true,
          spec: true,
          episodeId: true,
          questions: {
            orderBy: { order: 'asc' },
            select: {
              id: true,
              order: true,
              skill: true,
              question: true,
              options: true,
              correctIndex: true,
              explanation: true,
              passageRef: true,
              passageText: true,
              learningAssessment: true,
              vocabIds: true,
              grammarKeys: true,
            },
          },
          writingPrompts: {
            orderBy: { order: 'asc' },
            select: {
              id: true,
              order: true,
              task: true,
              guidance: true,
              ideas: true,
              learningObjectives: true,
            },
          },
          prompts: {
            orderBy: { order: 'asc' },
            select: {
              id: true,
              order: true,
              targetPhrase: true,
              translation: true,
              ipa: true,
              learningObjectives: true,
            },
          },
          episode: {
            select: {
              id: true,
              userId: true,
              source: true,
              deletedAt: true,
              script: {
                select: { id: true, version: true, turns: true, soundCues: true, markdown: true },
              },
            },
          },
        },
      },
    },
  });
  if (!cls) throw new Error('The reviewed class is unavailable.');
  const teaching = teachingFromSeed(cls.adaptiveSeed);
  if (!teaching && requireTeaching) throw new Error('The reviewed class has no teaching.');
  const sections = currentClassSections(cls.sections).map((section) => {
    const { withdrawn, ...material } = section;
    if (withdrawn) throw new Error('Withdrawn material cannot be reviewed.');
    return {
      ...material,
      episode: material.episode
        ? {
            ...material.episode,
            deleted: material.episode.deletedAt !== null,
            deletedAt: undefined,
          }
        : null,
    };
  });
  return objectiveEvidenceHash({
    version: 1,
    id: cls.id,
    courseId: cls.courseId,
    lessonId: cls.lessonId,
    attempt: cls.attempt,
    passThreshold: cls.passThreshold,
    learningSelection: cls.learningSelection,
    readingVocabulary: cls.readingVocabulary,
    sourceTitle: cls.sourceTitle,
    sourceUrl: cls.sourceUrl,
    skillRequirements: cls.skillRequirements,
    course: cls.course,
    lesson: cls.lesson,
    teaching,
    classTargets:
      cls.adaptiveSeed && typeof cls.adaptiveSeed === 'object' && !Array.isArray(cls.adaptiveSeed)
        ? (cls.adaptiveSeed.classTargets ?? null)
        : null,
    sections,
  });
}

export function initialA1MaterialHash(database: LearningDatabase, classId: string, userId: string) {
  return classTaskMaterialHash(database, classId, userId, true);
}

/** A receipt is usable only while the owned material still matches its reviewed digest. */
async function readInitialA1ProvenanceInTransaction(
  database: Prisma.TransactionClient,
  classId: string,
  userId: string
) {
  const cls = await database.courseClass.findFirst({
    where: { id: classId, course: { userId } },
    select: { id: true, courseId: true, attempt: true, status: true, prerequisiteGate: true },
  });
  if (!cls) throw new InitialA1ProvenanceConflict();
  if (!['AVAILABLE', 'IN_PROGRESS', 'FAILED'].includes(cls.status))
    return { status: 'UNAVAILABLE' as const };
  if (cls.prerequisiteGate === null) return { status: 'UNREVIEWED' as const };
  const parsed = initialA1ProvenanceSchema.safeParse(cls.prerequisiteGate);
  if (
    !parsed.success ||
    parsed.data.classId !== classId ||
    parsed.data.courseId !== cls.courseId ||
    parsed.data.userId !== userId ||
    parsed.data.attempt !== cls.attempt
  )
    return { status: 'STALE' as const };
  const receipt = parsed.data;
  const currentHash = await initialA1MaterialHash(database, classId, userId);
  if (receipt.materialHash !== currentHash) return { status: 'STALE' as const };
  return {
    status: 'REVIEWED' as const,
    receiptId: receipt.receiptId,
    acknowledged:
      receipt.acknowledgment?.userId === userId &&
      receipt.acknowledgment.receiptId === receipt.receiptId &&
      receipt.acknowledgment.materialHash === receipt.materialHash,
  };
}

/** Save an explicit action only for the exact reviewed class currently displayed. */
async function acknowledgeInitialA1ProvenanceInTransaction(
  database: Prisma.TransactionClient,
  input: {
    classId: string;
    userId: string;
    receiptId: string;
  }
) {
  await database.$queryRaw`SELECT id FROM "CourseClass" WHERE id = ${input.classId} FOR UPDATE`;
  const current = await readInitialA1ProvenanceInTransaction(database, input.classId, input.userId);
  if (current.status !== 'REVIEWED' || current.receiptId !== input.receiptId)
    throw new InitialA1ProvenanceConflict();
  if (current.acknowledged) return current;
  const cls = await database.courseClass.findFirstOrThrow({
    where: { id: input.classId, course: { userId: input.userId } },
    select: { prerequisiteGate: true },
  });
  const receipt = initialA1ProvenanceSchema.parse(cls.prerequisiteGate);
  const updated = initialA1ProvenanceSchema.parse({
    ...receipt,
    acknowledgment: {
      userId: input.userId,
      receiptId: input.receiptId,
      materialHash: receipt.materialHash,
    },
  });
  await database.courseClass.update({
    where: { id: input.classId },
    data: { prerequisiteGate: updated as Prisma.InputJsonValue },
  });
  return { ...current, acknowledged: true };
}

/** Read receipt and material in one authorized serializable snapshot. */
export function readInitialA1Provenance(
  database: PrismaClient,
  classId: string,
  execution: SottoProviderExecution
) {
  return sottoTransaction(
    database,
    async (transaction) => {
      execution.signal?.throwIfAborted();
      const actor = await execution.authorize(transaction);
      if (actor.userId !== execution.userId) throw new InitialA1ProvenanceConflict();
      const result = await readInitialA1ProvenanceInTransaction(
        transaction,
        classId,
        execution.userId
      );
      execution.signal?.throwIfAborted();
      return result;
    },
    { signal: execution.signal }
  );
}

/** Serialize the receipt check, acknowledgment and its authorization. */
export function acknowledgeInitialA1Provenance(
  database: PrismaClient,
  input: { classId: string; receiptId: string },
  execution: SottoProviderExecution
) {
  return sottoTransaction(
    database,
    async (transaction) => {
      execution.signal?.throwIfAborted();
      const actor = await execution.authorize(transaction);
      if (actor.userId !== execution.userId) throw new InitialA1ProvenanceConflict();
      const result = await acknowledgeInitialA1ProvenanceInTransaction(transaction, {
        ...input,
        userId: execution.userId,
      });
      execution.signal?.throwIfAborted();
      return result;
    },
    { signal: execution.signal }
  );
}

async function readPreludeInTransaction(
  database: Prisma.TransactionClient,
  classId: string,
  userId: string
) {
  const cls = await database.courseClass.findFirst({
    where: { id: classId, course: { userId } },
    select: {
      id: true,
      courseId: true,
      attempt: true,
      status: true,
      createdAt: true,
      sourceTitle: true,
      sourceUrl: true,
      skillRequirements: true,
      adaptiveSeed: true,
      course: { select: { nativeLang: true, targetLang: true } },
      lesson: { select: { level: true } },
      submission: { select: { attempt: true, userId: true } },
    },
  });
  if (!cls) throw new InitialA1ProvenanceConflict();
  if (
    cls.status === 'PASSED' ||
    cls.status === 'SUBMITTED' ||
    (cls.status === 'FAILED' &&
      cls.submission?.attempt === cls.attempt &&
      cls.submission.userId === userId)
  )
    return { kind: 'REPLAY' as const };
  if (cls.status === 'GENERATING') return { kind: 'GENERATING' as const };
  if (!['AVAILABLE', 'IN_PROGRESS', 'FAILED'].includes(cls.status))
    return { kind: 'UNAVAILABLE' as const };
  if (cls.skillRequirements === null && (cls.sourceTitle || cls.sourceUrl))
    return { kind: 'UNAVAILABLE' as const };
  let requirements;
  try {
    requirements = classRequirementsOrLegacy(cls.skillRequirements, {
      nativeLang: cls.course.nativeLang,
      targetLang: cls.course.targetLang,
      level: cls.lesson.level,
    });
  } catch {
    return { kind: 'UNAVAILABLE' as const };
  }
  if (
    requirements.scope !== 'CLASS' ||
    requirements.nativeLang !== cls.course.nativeLang ||
    requirements.targetLang !== cls.course.targetLang
  )
    return { kind: 'UNAVAILABLE' as const };
  if (requirements.level !== 'A1') return { kind: 'NOT_REQUIRED' as const };
  const prior = await database.courseClass.findFirst({
    where: {
      courseId: cls.courseId,
      status: 'PASSED',
      createdAt: { lt: cls.createdAt },
      OR: [
        { skillRequirements: { path: ['level'], equals: 'A1' } },
        {
          skillRequirements: { equals: Prisma.AnyNull },
          lesson: { level: 'A1' },
          sourceTitle: null,
          sourceUrl: null,
        },
      ],
    },
    select: { id: true },
  });
  if (prior) return { kind: 'NOT_REQUIRED' as const };
  const provenance = await readInitialA1ProvenanceInTransaction(database, classId, userId);
  if (provenance.status === 'REVIEWED') {
    const teaching = teachingFromSeed(cls.adaptiveSeed);
    if (!teaching) return { kind: 'UNAVAILABLE' as const };
    return classPreludeResponseSchema.parse({
      kind: 'BASE',
      nativeLang: requirements.nativeLang,
      targetLang: requirements.targetLang,
      receiptId: provenance.receiptId,
      acknowledged: provenance.acknowledged,
      teaching: {
        version: teaching.version,
        title: teaching.title,
        explanation: teaching.explanation,
        workedExamples: teaching.workedExamples,
        commonMistake: teaching.commonMistake,
      },
    });
  }
  try {
    const legacy = await readPrerequisiteStatus(database, classId, userId);
    return classPreludeResponseSchema.parse({
      kind: 'ADDENDUM',
      nativeLang: legacy.nativeLang,
      targetLang: legacy.targetLang,
      request: legacy.request,
      status: legacy.status,
      ...('content' in legacy
        ? {
            content: {
              title: legacy.content.title,
              explanation: legacy.content.explanation,
              examples: legacy.content.examples,
            },
          }
        : {}),
      ...('receiptId' in legacy
        ? { receiptId: legacy.receiptId, acknowledged: legacy.acknowledged }
        : {}),
      ...('canRetry' in legacy ? { canRetry: legacy.canRetry } : {}),
      ...('recoverable' in legacy ? { recoverable: legacy.recoverable } : {}),
      ...('failure' in legacy ? { failure: legacy.failure } : {}),
    });
  } catch (error) {
    if (error instanceof PrerequisiteSourceConflict || error instanceof PrerequisiteFenceConflict)
      return { kind: 'UNAVAILABLE' as const };
    throw error;
  }
}

export class InitialA1PracticeBlocked extends Error {
  constructor() {
    super('Review the prerequisite teaching before starting this exercise.');
    this.name = 'InitialA1PracticeBlocked';
  }
}

/** Recheck eligibility at new paid-work admission, after recovery is resolved. */
export async function requireInitialA1AddendumPreparation(
  database: Prisma.TransactionClient,
  classId: string,
  userId: string
) {
  const prelude = await readPreludeInTransaction(database, classId, userId);
  if (
    prelude.kind === 'ADDENDUM' &&
    (prelude.status === 'AVAILABLE' ||
      (['FAILED', 'STALE'].includes(prelude.status) && prelude.canRetry === true))
  )
    return;
  throw new PrerequisiteFenceConflict();
}

/**
 * Check new practice in the same authorized serializable transaction as its
 * admission. Callers must resolve exact existing operations and saved results
 * before this check, so recovery never admits additional work.
 */
export async function requireInitialA1PracticeAccess(
  database: Prisma.TransactionClient,
  classId: string,
  userId: string
) {
  await readInitialA1PracticeAuthorization(database, classId, userId);
}

/** Capture the exact reviewed receipt and material for a new durable operation. */
export async function readInitialA1PracticeAuthorization(
  database: Prisma.TransactionClient,
  classId: string,
  userId: string
) {
  const prelude = await readPreludeInTransaction(database, classId, userId);
  if (prelude.kind === 'NOT_REQUIRED') return null;
  if (
    (prelude.kind === 'BASE' || prelude.kind === 'ADDENDUM') &&
    prelude.acknowledged === true &&
    prelude.receiptId
  )
    return {
      kind: prelude.kind,
      receiptId: prelude.receiptId,
      materialHash: await classTaskMaterialHash(database, classId, userId),
    };
  throw new InitialA1PracticeBlocked();
}

/** Project only content available before guided and independent work. */
export async function readClassTeachingPreludeInTransaction(
  transaction: Prisma.TransactionClient,
  classId: string,
  userId: string
) {
  const result = await readPreludeInTransaction(transaction, classId, userId);
  if (result.kind !== 'ADDENDUM') return classPreludeResponseSchema.parse(result);
  const tokenizer = createPrerequisiteTokenizer(classId, userId);
  try {
    return classPreludeResponseSchema.parse({
      ...result,
      request: tokenizer.request(result.request),
    });
  } finally {
    tokenizer.dispose();
  }
}

export function readClassTeachingPrelude(
  database: PrismaClient,
  classId: string,
  execution: SottoProviderExecution
) {
  return sottoTransaction(
    database,
    async (transaction) => {
      execution.signal?.throwIfAborted();
      const actor = await execution.authorize(transaction);
      if (actor.userId !== execution.userId) throw new InitialA1ProvenanceConflict();
      const result = await readClassTeachingPreludeInTransaction(
        transaction,
        classId,
        execution.userId
      );
      execution.signal?.throwIfAborted();
      return result;
    },
    { signal: execution.signal }
  );
}

/** Acknowledge either receipt without returning private source fingerprints. */
export function acknowledgeClassTeachingPrelude(
  database: PrismaClient,
  input: {
    classId: string;
    kind: 'BASE' | 'ADDENDUM';
    receiptId: string;
  },
  execution: SottoProviderExecution
) {
  return sottoTransaction(
    database,
    async (transaction) => {
      execution.signal?.throwIfAborted();
      const actor = await execution.authorize(transaction);
      if (actor.userId !== execution.userId) throw new InitialA1ProvenanceConflict();
      await transaction.$queryRaw`SELECT id FROM "CourseClass" WHERE id = ${input.classId} FOR UPDATE`;
      const prelude = await readPreludeInTransaction(transaction, input.classId, execution.userId);
      if (
        prelude.kind !== input.kind ||
        !('receiptId' in prelude) ||
        prelude.receiptId !== input.receiptId
      )
        throw new InitialA1ProvenanceConflict();
      if (prelude.kind === 'BASE') {
        await acknowledgeInitialA1ProvenanceInTransaction(transaction, {
          ...input,
          userId: execution.userId,
        });
      } else if (prelude.kind === 'ADDENDUM') {
        const status = await readPrerequisiteStatus(transaction, input.classId, execution.userId);
        if (status.status !== 'READY' || status.receiptId !== input.receiptId)
          throw new InitialA1ProvenanceConflict();
        await acknowledgePrerequisite(transaction, {
          classId: input.classId,
          userId: execution.userId,
          receiptId: input.receiptId,
          sourceHash: status.request.sourceHash,
        });
      } else throw new InitialA1ProvenanceConflict();
      execution.signal?.throwIfAborted();
      return { kind: input.kind, receiptId: input.receiptId, acknowledged: true as const };
    },
    { signal: execution.signal }
  );
}
