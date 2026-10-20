import { createHash } from 'node:crypto';
import { z } from 'zod';
import { learningLevelSchema, learningSkillSchema } from '@sotto/shared';
import { learningAudioIdentitySchema } from '../media-protocol';

const sha = z.string().regex(/^[a-f0-9]{64}$/);
const text = z.string().min(1).max(100_000);
const objectiveCriterionSchema = z
  .object({
    objectiveId: z.string().min(1),
    criterionVersion: z.number().int().positive(),
    policyVersion: z.number().int().positive(),
    level: learningLevelSchema,
    skill: learningSkillSchema,
    assessment: z.string().min(1).max(4000),
  })
  .strict();
export type ObjectiveCriterion = z.infer<typeof objectiveCriterionSchema>;
export const objectiveAssessmentScopeSchema = z
  .object({
    schemaVersion: z.literal(1),
    courseId: z.string().min(1),
    userId: z.string().min(1),
    bindingId: z.string().min(1),
    catalogHash: sha,
    targetLang: z.string().regex(/^[a-z]{2}$/),
    level: learningLevelSchema,
    criteria: z.array(objectiveCriterionSchema).min(1).max(64),
  })
  .strict()
  .superRefine((scope, context) => {
    if (
      scope.criteria.some((criterion) => criterion.level !== scope.level) ||
      new Set(scope.criteria.map((criterion) => `${criterion.objectiveId}:${criterion.skill}`))
        .size !== scope.criteria.length
    )
      context.addIssue({
        code: 'custom',
        message: 'Assessment scope has conflicting criteria or difficulty.',
      });
  });
export type ObjectiveAssessmentScope = z.infer<typeof objectiveAssessmentScopeSchema>;

const mcTask = z
  .object({
    kind: z.literal('KEYED_MULTIPLE_CHOICE'),
    question: text,
    options: z.array(text).length(4),
    correctIndex: z.number().int().min(0).max(3),
    passageText: z.string().max(1_000_000).nullable(),
    audio: z.object({ scriptSha256: sha, contentSha256: sha }).strict().nullable(),
  })
  .strict()
  .superRefine((task, context) => {
    if (new Set(task.options).size !== task.options.length)
      context.addIssue({
        code: 'custom',
        message: 'Assessment options must have distinct content.',
      });
  });
const productiveTask = z
  .object({
    kind: z.enum(['ORIGINAL_WRITING', 'COMMUNICATIVE_SPEAKING']),
    task: text,
    guidance: z.string().max(20_000).nullable(),
    suppliedSupport: z.array(z.string().max(100_000)).max(20),
  })
  .strict();
export const objectiveTaskSchema = z.union([mcTask, productiveTask]);
export type ObjectiveTask = z.infer<typeof objectiveTaskSchema>;

/** Stable tuples bind exact task content. Only answer presentation order is normalized. */
export function objectiveEvidenceHash(value: unknown): string {
  function canonical(input: unknown): unknown {
    if (Array.isArray(input)) return input.map(canonical);
    if (input && typeof input === 'object')
      return Object.fromEntries(
        Object.entries(input)
          .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
          .map(([key, child]) => [key, canonical(child)])
      );
    return input;
  }
  return createHash('sha256')
    .update(JSON.stringify(canonical(value)))
    .digest('hex');
}
export function objectiveTaskContent(taskInput: ObjectiveTask) {
  const task = objectiveTaskSchema.parse(taskInput);
  return task.kind === 'KEYED_MULTIPLE_CHOICE'
    ? {
        kind: task.kind,
        question: task.question,
        options: [...task.options].sort(),
        correctAnswer: task.options[task.correctIndex],
        passageText: task.passageText,
        audio: task.audio,
      }
    : task;
}
export function objectiveTaskFingerprint(
  targetLang: string,
  criterion: ObjectiveCriterion,
  task: ObjectiveTask
) {
  return objectiveEvidenceHash({
    schemaVersion: 1,
    normalization: 'EXACT_UTF8_OPTION_ORDER_ONLY',
    targetLang,
    criterion: objectiveCriterionSchema.parse(criterion),
    task: objectiveTaskContent(task),
  });
}

export const reviewedObjectiveAssessmentSchema = z
  .object({
    schemaVersion: z.literal(1),
    scope: objectiveAssessmentScopeSchema,
    criterion: objectiveCriterionSchema,
    task: objectiveTaskSchema,
    taskFingerprint: sha,
    media: learningAudioIdentitySchema.optional(),
    review: z
      .object({
        protocol: z.literal('DIRECT_CRITERION_ELICITATION_V1'),
        provider: z.string().min(1),
        model: z.string().min(1),
        inputSha256: sha,
        responseSha256: sha,
        elicitationQuote: z.string().min(1).max(4000),
        rationale: z.string().min(12).max(4000),
      })
      .strict(),
  })
  .strict()
  .superRefine((assessment, context) => {
    if (
      !assessment.scope.criteria.some(
        (criterion) =>
          objectiveEvidenceHash(criterion) === objectiveEvidenceHash(assessment.criterion)
      ) ||
      assessment.taskFingerprint !==
        objectiveTaskFingerprint(assessment.scope.targetLang, assessment.criterion, assessment.task)
    )
      context.addIssue({
        code: 'custom',
        message: 'The reviewed task or pinned criterion changed.',
      });
    const task = assessment.task;
    const quoteSource = task.kind === 'KEYED_MULTIPLE_CHOICE' ? task.question : task.task;
    if (!quoteSource.includes(assessment.review.elicitationQuote))
      context.addIssue({
        code: 'custom',
        message: 'Criterion review must cite the actual elicitation.',
      });
    if (
      (task.kind === 'ORIGINAL_WRITING' && assessment.criterion.skill !== 'WRITING') ||
      (task.kind === 'COMMUNICATIVE_SPEAKING' && assessment.criterion.skill !== 'SPEAKING') ||
      (task.kind === 'KEYED_MULTIPLE_CHOICE' &&
        !['GRAMMAR', 'READING', 'LISTENING'].includes(assessment.criterion.skill))
    )
      context.addIssue({ code: 'custom', message: 'The task format cannot assess this skill.' });
    if (
      task.kind === 'KEYED_MULTIPLE_CHOICE' &&
      ((assessment.criterion.skill === 'READING' && !task.passageText?.trim()) ||
        (assessment.criterion.skill === 'LISTENING' && (!task.audio || !task.passageText?.trim())))
    )
      context.addIssue({
        code: 'custom',
        message: 'Comprehension evidence requires exact source content.',
      });
    if (
      assessment.criterion.skill === 'LISTENING' &&
      (task.kind !== 'KEYED_MULTIPLE_CHOICE' ||
        !assessment.media ||
        assessment.media.userId !== assessment.scope.userId ||
        assessment.media.scriptSha256 !== task.audio?.scriptSha256 ||
        assessment.media.contentSha256 !== task.audio?.contentSha256)
    )
      context.addIssue({
        code: 'custom',
        message: 'Listening evidence requires its exact selected canonical audio publication.',
      });
  });
export type ReviewedObjectiveAssessment = z.infer<typeof reviewedObjectiveAssessmentSchema>;

export const pendingListeningAssessmentSchema = z
  .object({
    schemaVersion: z.literal(1),
    status: z.literal('AWAITING_MEDIA'),
    scope: objectiveAssessmentScopeSchema,
    criterion: objectiveCriterionSchema,
    task: mcTask,
    scriptSha256: sha,
    review: reviewedObjectiveAssessmentSchema.shape.review,
  })
  .strict()
  .superRefine((assessment, context) => {
    if (
      assessment.criterion.skill !== 'LISTENING' ||
      assessment.task.audio !== null ||
      !assessment.task.passageText?.trim() ||
      !assessment.scope.criteria.some(
        (criterion) =>
          objectiveEvidenceHash(criterion) === objectiveEvidenceHash(assessment.criterion)
      ) ||
      !assessment.task.question.includes(assessment.review.elicitationQuote)
    )
      context.addIssue({
        code: 'custom',
        message: 'Pending listening attribution changed its reviewed source or criterion.',
      });
  });
export type StoredObjectiveAssessment =
  ReviewedObjectiveAssessment | z.infer<typeof pendingListeningAssessmentSchema>;

export const productiveCriterionFindingSchema = z
  .object({
    schemaVersion: z.literal(1),
    taskFingerprint: sha,
    responseSha256: sha,
    assessed: z.boolean(),
    quality: z.number().finite().min(0).max(1).nullable(),
    quotes: z.array(z.string().min(1).max(4000)).max(8),
    rationale: z.string().min(12).max(4000),
  })
  .strict()
  .superRefine((finding, context) => {
    if (
      finding.assessed
        ? finding.quality === null || finding.quotes.length === 0
        : finding.quality !== null || finding.quotes.length > 0
    )
      context.addIssue({
        code: 'custom',
        message: 'Criterion quality requires actual supported assessment.',
      });
  });
export type ProductiveCriterionFinding = z.infer<typeof productiveCriterionFindingSchema>;

export function validateProductiveFinding(
  assessmentInput: ReviewedObjectiveAssessment,
  response: string,
  input: unknown
) {
  const assessment = reviewedObjectiveAssessmentSchema.parse(assessmentInput);
  if (assessment.task.kind === 'KEYED_MULTIPLE_CHOICE')
    throw new Error('A keyed task cannot receive productive evidence.');
  return validateProductiveTaskFinding(
    {
      taskFingerprint: assessment.taskFingerprint,
      suppliedSupport: assessment.task.suppliedSupport,
    },
    response,
    input
  );
}

export function validateProductiveTaskFinding(
  task: { taskFingerprint: string; suppliedSupport: readonly string[] },
  response: string,
  input: unknown
) {
  const finding = productiveCriterionFindingSchema.parse(input);
  if (
    finding.taskFingerprint !== task.taskFingerprint ||
    finding.responseSha256 !== objectiveEvidenceHash({ text: response }) ||
    finding.quotes.some(
      (quote) =>
        !response.includes(quote) || task.suppliedSupport.some((support) => support.includes(quote))
    )
  )
    throw new Error('Productive criterion evidence does not match independent learner work.');
  return finding;
}
