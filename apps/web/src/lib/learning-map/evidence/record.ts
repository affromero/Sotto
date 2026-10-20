import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { z } from 'zod';
import { learningSkills } from '@sotto/shared';
import type { Prisma } from '@/generated/prisma/client';
import { readBoundCatalog } from '../binding';
import { projectObjectiveEvidence } from './projection';

const observationSchema = z
  .object({
    courseId: z.string().min(1),
    userId: z.string().min(1),
    bindingId: z.string().min(1),
    objectiveId: z.string().min(1),
    criterionVersion: z.number().int().positive(),
    skill: z.enum(learningSkills),
    sourceType: z.enum([
      'CLASS_QUESTION',
      'PRACTICE_QUESTION',
      'WRITING_CRITERION',
      'SPEAKING_CRITERION',
    ]),
    sessionId: z.string().min(1),
    taskId: z.string().min(1),
    responseIdentity: z.string().min(1),
    quality: z.number().min(0).max(1),
    evidence: z.object({ assessment: z.string().min(1), rationale: z.string().min(1) }).strict(),
  })
  .strict();

export type QualifiedObjectiveObservation = z.infer<typeof observationSchema>;

/** Internal publication boundary. Call only after the source assessment has committed in this transaction. */
export async function recordObjectiveObservation(
  database: Prisma.TransactionClient,
  input: QualifiedObjectiveObservation
) {
  const observation = observationSchema.parse(input);
  await database.$queryRaw`SELECT id FROM "Course" WHERE id = ${observation.courseId} FOR UPDATE`;
  const binding = await database.learningLevelBinding.findFirst({
    where: {
      id: observation.bindingId,
      courseId: observation.courseId,
      course: { userId: observation.userId },
    },
    include: { revision: true },
  });
  if (!binding) throw new Error('Objective evidence requires an owned, pinned level.');
  const { catalog, exemptSkills } = readBoundCatalog(binding);
  const objective = catalog.nodes.find((node) => node.id === observation.objectiveId);
  if (
    objective?.kind !== 'OBJECTIVE' ||
    objective.level !== binding.level ||
    objective.criterionVersion !== observation.criterionVersion ||
    !objective.skills.includes(observation.skill) ||
    exemptSkills.includes(observation.skill) ||
    objective.skillCriteria[observation.skill] !== observation.evidence.assessment
  )
    throw new Error('The assessment does not match this pinned objective criterion.');
  const criterion = {
    courseId: observation.courseId,
    objectiveId: objective.id,
    criterionVersion: objective.criterionVersion,
    policyVersion: objective.policyVersion,
    level: objective.level,
    skill: observation.skill,
  };
  const deduplicationKey = createHash('sha256')
    .update(
      JSON.stringify({
        ...criterion,
        sourceType: observation.sourceType,
        sessionId: observation.sessionId,
        taskId: observation.taskId,
        responseIdentity: observation.responseIdentity,
      })
    )
    .digest('hex');
  const previous = await database.learningObservation.findUnique({ where: { deduplicationKey } });
  if (
    previous &&
    (previous.quality !== observation.quality ||
      !isDeepStrictEqual(previous.evidence, observation.evidence))
  )
    throw new Error('An immutable assessment response cannot be rewritten.');
  if (!previous)
    await database.learningObservation.create({
      data: {
        ...criterion,
        deduplicationKey,
        revisionId: binding.revisionId,
        sourceType: observation.sourceType,
        sessionId: observation.sessionId,
        taskId: observation.taskId,
        responseIdentity: observation.responseIdentity,
        quality: observation.quality,
        evidence: observation.evidence,
      },
    });
  const observations = await database.learningObservation.findMany({ where: criterion });
  const projection = projectObjectiveEvidence(observations);
  return database.learnerObjectiveState.upsert({
    where: { courseId_objectiveId_criterionVersion_policyVersion_level_skill: criterion },
    create: { ...criterion, ...projection },
    update: projection,
  });
}
