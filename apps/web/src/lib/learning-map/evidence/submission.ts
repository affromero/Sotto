import type { Prisma } from '@/generated/prisma/client';
import { readBoundCatalog } from '../binding';
import { recordObjectiveObservation, type QualifiedObjectiveObservation } from './record';
import {
  isPrivateSpeakingAssessment,
  privateSpeakingAssessmentSchema,
} from './private-speaking/protocol';
import {
  objectiveEvidenceHash,
  objectiveTaskContent,
  reviewedObjectiveAssessmentSchema,
  validateProductiveFinding,
  type ObjectiveTask,
} from './protocol';

interface LearnerWork {
  courseId: string;
  userId: string;
  sessionId: string;
}
export function multipleChoiceObservation(
  input: LearnerWork & {
    sourceType: 'CLASS_QUESTION' | 'PRACTICE_QUESTION';
    skill: 'GRAMMAR' | 'READING' | 'LISTENING';
    assessment: unknown;
    task: ObjectiveTask;
    selectedIndex: number;
  }
): QualifiedObjectiveObservation | null {
  if (input.assessment === null || input.assessment === undefined) return null;
  const assessment = reviewedObjectiveAssessmentSchema.parse(input.assessment);
  if (
    assessment.task.kind !== 'KEYED_MULTIPLE_CHOICE' ||
    input.task.kind !== 'KEYED_MULTIPLE_CHOICE' ||
    assessment.criterion.skill !== input.skill ||
    assessment.scope.courseId !== input.courseId ||
    assessment.scope.userId !== input.userId ||
    objectiveEvidenceHash(objectiveTaskContent(assessment.task)) !==
      objectiveEvidenceHash(objectiveTaskContent(input.task))
  )
    throw new Error('The graded task changed its reviewed criterion or source content.');
  if (
    !Number.isInteger(input.selectedIndex) ||
    input.selectedIndex < 0 ||
    input.selectedIndex >= input.task.options.length
  )
    throw new Error('Objective evidence requires a committed valid learner answer.');
  const correct = input.selectedIndex === input.task.correctIndex;
  return {
    courseId: input.courseId,
    userId: input.userId,
    sessionId: input.sessionId,
    sourceType: input.sourceType,
    bindingId: assessment.scope.bindingId,
    objectiveId: assessment.criterion.objectiveId,
    criterionVersion: assessment.criterion.criterionVersion,
    skill: assessment.criterion.skill,
    taskId: assessment.taskFingerprint,
    responseIdentity: objectiveEvidenceHash({
      task: assessment.taskFingerprint,
      selectedAnswer: input.task.options[input.selectedIndex],
    }),
    quality: correct ? 1 : 0,
    evidence: {
      assessment: assessment.criterion.assessment,
      rationale: `Reviewed ${input.skill} criterion; the exact keyed answer is ${correct ? 'correct' : 'incorrect'}. Task ${assessment.taskFingerprint}.`,
    },
  };
}
export function productiveObservation(
  input: LearnerWork & {
    sourceType: 'WRITING_CRITERION' | 'SPEAKING_CRITERION';
    assessment: unknown;
    task: ObjectiveTask;
    text: string;
    finding: unknown;
  }
): QualifiedObjectiveObservation | null {
  if (isPrivateSpeakingAssessment(input.assessment)) {
    privateSpeakingAssessmentSchema.parse(input.assessment);
    return null;
  }
  if (
    input.assessment === null ||
    input.assessment === undefined ||
    input.finding === null ||
    input.finding === undefined
  )
    return null;
  const assessment = reviewedObjectiveAssessmentSchema.parse(input.assessment);
  const kind =
    input.sourceType === 'WRITING_CRITERION' ? 'ORIGINAL_WRITING' : 'COMMUNICATIVE_SPEAKING';
  if (
    assessment.task.kind !== kind ||
    input.task.kind !== kind ||
    assessment.scope.courseId !== input.courseId ||
    assessment.scope.userId !== input.userId ||
    objectiveEvidenceHash(objectiveTaskContent(assessment.task)) !==
      objectiveEvidenceHash(objectiveTaskContent(input.task))
  )
    throw new Error('Productive evidence requires the exact independently elicited task.');
  const finding = validateProductiveFinding(assessment, input.text, input.finding);
  if (!finding.assessed) return null;
  return {
    courseId: input.courseId,
    userId: input.userId,
    sessionId: input.sessionId,
    sourceType: input.sourceType,
    bindingId: assessment.scope.bindingId,
    objectiveId: assessment.criterion.objectiveId,
    criterionVersion: assessment.criterion.criterionVersion,
    skill: assessment.criterion.skill,
    taskId: assessment.taskFingerprint,
    responseIdentity: finding.responseSha256,
    quality: finding.quality!,
    evidence: {
      assessment: assessment.criterion.assessment,
      rationale: `Criterion-specific finding for response ${finding.responseSha256}; quality ${finding.quality}. Task ${assessment.taskFingerprint}.`,
    },
  };
}

/** Call after source answer/grade publication in the same course-locked submission transaction. */
export async function publishObjectiveObservations(
  database: Prisma.TransactionClient,
  observations: readonly (QualifiedObjectiveObservation | null)[]
) {
  const grammarKeys = new Set<string>();
  for (const observation of observations) {
    if (!observation) continue;
    // The internal record boundary validates the live owned binding and exact rubric again.
    const {
      courseId,
      userId,
      bindingId,
      objectiveId,
      criterionVersion,
      skill,
      sourceType,
      sessionId,
      taskId,
      responseIdentity,
      quality,
      evidence,
    } = observation;
    await recordObjectiveObservation(database, {
      courseId,
      userId,
      bindingId,
      objectiveId,
      criterionVersion,
      skill,
      sourceType,
      sessionId,
      taskId,
      responseIdentity,
      quality,
      evidence,
    });
    const binding = await database.learningLevelBinding.findUniqueOrThrow({
      where: { id: bindingId },
      include: { revision: true },
    });
    const objective = readBoundCatalog(binding).catalog.nodes.find(
      (node) => node.id === objectiveId
    );
    if (objective?.kind === 'OBJECTIVE')
      for (const key of objective.grammarKeys) grammarKeys.add(key);
  }
  return grammarKeys;
}
