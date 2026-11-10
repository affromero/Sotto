import { createHash } from 'node:crypto';
import { z } from 'zod';
import { sqlStateBackend } from 'thesidedoor-core/storage/sql';
import type { Prisma } from '@/generated/prisma/client';
import { SIDEDOOR_STATE_ID } from '@/lib/sidedoor/access/state/store';
import { captureCourseStorage } from '@/lib/sidedoor/storage/core/course-storage';
import { readSkillRequirements } from '@/lib/learning/skill-requirements';
import { matchesLearningSpeechFingerprint } from '@/lib/learning/speech-configuration';
import {
  requireRepairQuizFence,
  quizRetrySourceDigest,
} from '@/lib/learning/classes/formative/class-repair';
import { targetFingerprint } from '../regeneration/target-fingerprint';
import { classPreparationGrant } from '../preparation-grant';
import { preparationStore, PreparationConflictError } from '../preparation-state';

export const CLASS_PREPARATION_QUEUE = 'class-preparation';
export const classPreparationPayload = z
  .object({
    courseId: z.string().min(1),
    operationId: z.uuid(),
    sourceUrl: z.string().url().max(4000).optional(),
    topic: z.string().max(2000).optional(),
  })
  .strict();

export function validatePreparationSchedule(
  input: {
    availableAt?: number;
    maxProviderRequests?: number;
    deferAudio?: boolean;
    timeZone?: string;
  },
  now: number
) {
  const availableAt = input.availableAt ?? now;
  const budgeted =
    input.maxProviderRequests !== undefined || input.deferAudio === true || availableAt > now;
  const maxProviderRequests = budgeted
    ? z
        .number()
        .int()
        .min(1)
        .max(256)
        .parse(input.maxProviderRequests ?? 128)
    : null;
  const timeZone = input.timeZone ?? 'UTC';
  try {
    new Intl.DateTimeFormat('en', { timeZone }).format(now);
  } catch {
    throw new PreparationConflictError('Choose a valid time zone.');
  }
  if (availableAt > now && input.deferAudio !== true)
    throw new PreparationConflictError(
      'Scheduled preparation requires audio review before generation.'
    );
  if (
    !Number.isSafeInteger(availableAt) ||
    availableAt < now - 60_000 ||
    availableAt > now + 7 * 86_400_000
  )
    throw new PreparationConflictError('Choose a preparation time within the next seven days.');
  return { availableAt, budgeted, maxProviderRequests, timeZone };
}

export function classPreparationBackend(database: Prisma.TransactionClient, courseId: string) {
  return sqlStateBackend(
    {
      query: (sql, values) => database.$queryRawUnsafe<Record<string, unknown>[]>(sql, ...values),
    },
    'postgres',
    `${SIDEDOOR_STATE_ID}:class-preparation:${createHash('sha256').update(courseId).digest('hex')}`
  );
}

export const classPreparationStore = (database: Prisma.TransactionClient, courseId: string) =>
  preparationStore(classPreparationBackend(database, courseId));

export async function validateClassPreparation(
  database: Prisma.TransactionClient,
  courseId: string,
  operationId: string,
  allowTerminal = false
) {
  const operation = await classPreparationStore(database, courseId).read();
  if (!operation || operation.id !== operationId)
    throw new PreparationConflictError('The preparation task was replaced.');
  const ownership = await captureCourseStorage(database, courseId);
  if (
    ownership.userId !== operation.userId ||
    ownership.instanceId !== operation.instanceId ||
    !ownership.scopes.some(
      (scope) =>
        scope.subjectId === `course:${courseId}` && scope.generation === operation.courseCreatedAt
    ) ||
    !ownership.scopes.some(
      (scope) =>
        scope.subjectId === `profile:${operation.userId}` &&
        scope.generation === operation.userCreatedAt
    )
  )
    throw new PreparationConflictError('The preparation owner changed.');
  if (!allowTerminal && (operation.status !== 'RUNNING' || Date.now() >= operation.expiresAt))
    throw new PreparationConflictError('The preparation task is no longer authorized.');
  if (!allowTerminal) {
    await classPreparationGrant(database, operation).validate(operation.grant);
    if (operation.intent) {
      const target = await database.courseClass.findFirst({
        where: {
          id: operation.intent.classId,
          courseId,
          attempt: operation.intent.attempt,
          status: 'GENERATING',
        },
      });
      if (
        !target ||
        targetFingerprint(target) !== operation.intent.classFingerprint ||
        JSON.stringify(readSkillRequirements(target.skillRequirements)) !==
          JSON.stringify(operation.requirements)
      )
        throw new PreparationConflictError('The admitted class repair attempt changed.');
      if (operation.intent.retry) {
        const retry = operation.intent.retry;
        const [skill] = operation.intent.skills;
        if (!retry.sourceReceipt || operation.intent.skills.length !== 1 || !skill)
          throw new PreparationConflictError('The admitted quiz retry source is unavailable.');
        await database.$queryRaw`SELECT id FROM "CourseClass" WHERE id = ${target.id} FOR UPDATE`;
        await requireRepairQuizFence(database);
        await database.$queryRaw`
          SELECT id FROM "ClassSection"
          WHERE "classId" = ${target.id} AND skill::text = ${skill}
            AND attempt < ${operation.intent.attempt}
          ORDER BY id FOR UPDATE
        `;
        const source = await database.courseClass.findUniqueOrThrow({
          where: { id: target.id },
          include: {
            sections: {
              where: { skill, attempt: { lt: operation.intent.attempt } },
              include: { questions: true },
            },
          },
        });
        if (
          source.progressRevision !== retry.expectedRevision + 1 ||
          quizRetrySourceDigest(source, skill, operation.intent.attempt) !==
            retry.sourceReceipt.digest
        )
          throw new PreparationConflictError('The saved quiz retry source changed.');
      }
    }
    if (operation.requirements) {
      const course = await database.course.findUniqueOrThrow({
        where: { id: courseId },
        select: {
          nativeLang: true,
          targetLang: true,
          currentLevel: true,
        },
      });
      if (
        !operation.intent &&
        (course.nativeLang !== operation.requirements.nativeLang ||
          course.targetLang !== operation.requirements.targetLang ||
          course.currentLevel !== (operation.courseLevel ?? operation.requirements.level))
      )
        throw new PreparationConflictError('The admitted class language or level changed.');
      if (
        !(await matchesLearningSpeechFingerprint(
          database,
          async () => ({ userId: operation.userId }),
          operation.requirements,
          operation.speechFingerprint
        ))
      )
        throw new PreparationConflictError(
          'The selected speech model, endpoint or credential changed.'
        );
    }
  }
  return operation;
}
