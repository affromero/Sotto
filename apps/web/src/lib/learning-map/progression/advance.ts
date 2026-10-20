import { createHash } from 'node:crypto';
import { z } from 'zod';
import {
  evaluateLevelReadiness,
  learningLevelSchema,
  nextLearningLevel,
  skillRequirementsSchema,
} from '@sotto/shared';
import type { Prisma } from '@/generated/prisma/client';
import { prismaUnfiltered } from '../../prisma';
import { sottoTransaction } from '../../sidedoor/access/state/transaction';
import type { SottoProviderExecution } from '../../sidedoor/credentials/runtime/provider-execution';
import { resolveSkillRequirementsInTransaction } from '../../learning/skill-requirements';
import { ensureLearningLevelBinding, readBoundCatalog } from '../binding';
import {
  LearningMapError,
  ownedLearningCourse,
  readObjectiveStates,
  learningTransitionBlockers,
} from '../read';

export const advanceLearningLevelSchema = z
  .object({
    requestId: z.uuid(),
    expectedLevel: learningLevelSchema,
    catalogHash: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();
export const learningLevelCompletionSchema = z
  .object({
    completed: z.literal(true),
    courseId: z.string(),
    level: learningLevelSchema,
    currentLevel: learningLevelSchema,
    nextLevel: learningLevelSchema.nullable(),
    requirementId: z.string(),
    completedAt: z.iso.datetime(),
    exemptSkills: z.array(z.enum(['LISTENING', 'SPEAKING'])),
  })
  .strict();
type AdvanceRequest = z.infer<typeof advanceLearningLevelSchema>;
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

export async function advanceLearningLevelInTransaction(
  database: Prisma.TransactionClient,
  courseId: string,
  userId: string,
  input: AdvanceRequest,
  execution: SottoProviderExecution
) {
  const intentHash = digest({ courseId, ...input });
  await database.$queryRaw`SELECT id FROM "Course" WHERE id = ${courseId} FOR UPDATE`;
  const course = await ownedLearningCourse(database, courseId, userId);
  const replay = await database.learningLevelCompletion.findUnique({
    where: { requestId: input.requestId },
  });
  if (replay) {
    if (replay.courseId !== courseId || replay.intentHash !== intentHash)
      throw new LearningMapError('This advancement request belongs to different work.', 409);
    return learningLevelCompletionSchema.parse(replay.receipt);
  }
  if (course.currentLevel !== input.expectedLevel)
    throw new LearningMapError('The course level changed. Reload the learning map.', 409);
  const previous = await database.learningLevelBinding.findUnique({
    where: { courseId_level: { courseId, level: course.currentLevel } },
    include: { revision: true },
  });
  const coverage = previous
    ? skillRequirementsSchema.parse(previous.coverage)
    : await resolveSkillRequirementsInTransaction(database, execution, {
        scope: 'CLASS',
        nativeLang: course.nativeLang,
        targetLang: course.targetLang,
        level: course.currentLevel,
      });
  const binding =
    previous ?? (await ensureLearningLevelBinding(database, course, course.currentLevel, coverage));
  if (binding.revision.catalogHash !== input.catalogHash)
    throw new LearningMapError('The level requirements changed. Reload the learning map.', 409);
  const completedBand = await database.learningLevelCompletion.findUnique({
    where: { courseId_level: { courseId, level: course.currentLevel } },
  });
  if (completedBand) return learningLevelCompletionSchema.parse(completedBand.receipt);
  const { catalog, exemptSkills } = readBoundCatalog(binding);
  const states = await readObjectiveStates(database, courseId, course.currentLevel);
  const readiness = evaluateLevelReadiness(
    catalog,
    course.currentLevel,
    states,
    exemptSkills,
    new Date()
  );
  if (!readiness.ready)
    throw new LearningMapError('Master the remaining required objectives before advancing.', 409);
  const blockers = await learningTransitionBlockers(database, courseId);
  if (blockers.length) throw new LearningMapError(blockers.join(' '), 409);
  const nextLevel = nextLearningLevel(course.currentLevel);
  const receipt = learningLevelCompletionSchema.parse({
    completed: true,
    courseId,
    level: course.currentLevel,
    currentLevel: nextLevel ?? course.currentLevel,
    nextLevel,
    requirementId: binding.id,
    completedAt: new Date().toISOString(),
    exemptSkills,
  });
  await database.learningLevelCompletion.create({
    data: {
      requestId: input.requestId,
      courseId,
      level: course.currentLevel,
      nextLevel,
      bindingId: binding.id,
      intentHash,
      evidenceHash: digest(
        states.sort(
          (left, right) =>
            left.objectiveId.localeCompare(right.objectiveId) ||
            left.skill.localeCompare(right.skill)
        )
      ),
      receipt: receipt as Prisma.InputJsonObject,
    },
  });
  if (nextLevel) {
    await database.course.update({ where: { id: courseId }, data: { currentLevel: nextLevel } });
    const nextCoverage = await resolveSkillRequirementsInTransaction(database, execution, {
      scope: 'CLASS',
      nativeLang: course.nativeLang,
      targetLang: course.targetLang,
      level: nextLevel,
    });
    await ensureLearningLevelBinding(database, course, nextLevel, nextCoverage);
  }
  return receipt;
}

export function advanceLearningLevel(
  courseId: string,
  input: AdvanceRequest,
  execution: SottoProviderExecution
) {
  const request = advanceLearningLevelSchema.parse(input);
  return sottoTransaction(
    prismaUnfiltered,
    async (database) => {
      const actor = await execution.authorize(database);
      if (actor.userId !== execution.userId)
        throw new LearningMapError('The advancement recipient changed.', 409);
      return advanceLearningLevelInTransaction(
        database,
        courseId,
        actor.userId,
        request,
        execution
      );
    },
    { signal: execution.signal }
  );
}
