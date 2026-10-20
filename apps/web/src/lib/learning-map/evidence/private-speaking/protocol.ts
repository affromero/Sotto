import { z } from 'zod';
import { learningLevelSchema, learningSelectionSnapshotSchema } from '@sotto/shared';
import { objectiveEvidenceHash, objectiveTaskSchema } from '../protocol';
import { readFrozenLearningSourceFocus } from '../../selection';

const sha = z.string().regex(/^[a-f0-9]{64}$/);
const scopeSchema = z
  .object({
    userId: z.string().min(1),
    courseId: z.string().min(1),
    targetLang: z.string().regex(/^[a-z]{2}$/),
    level: learningLevelSchema,
  })
  .strict();
const sourceSchema = z
  .object({
    focusId: z.string().min(1),
    analysisId: z.uuid(),
    analysisRevision: z.number().int().positive(),
    resultDigest: sha,
    focusDigest: sha,
  })
  .strict();
const taskSchema = objectiveTaskSchema.refine(
  (task) => task.kind === 'COMMUNICATIVE_SPEAKING' && task.suppliedSupport.length === 0
);
const rubricSchema = z
  .string()
  .trim()
  .min(12)
  .max(4000)
  .refine((text) => text.isWellFormed() && !text.includes('\u0000'));

export function privateSpeakingFingerprint(input: {
  scope: z.infer<typeof scopeSchema>;
  source: z.infer<typeof sourceSchema>;
  task: z.infer<typeof objectiveTaskSchema>;
  rubric: string;
}) {
  return objectiveEvidenceHash({
    kind: 'PRIVATE_SOURCE_SPEAKING',
    schemaVersion: 1,
    scope: scopeSchema.parse(input.scope),
    source: sourceSchema.parse(input.source),
    task: taskSchema.parse(input.task),
    rubric: rubricSchema.parse(input.rubric),
  });
}
export const privateSpeakingAssessmentSchema = z
  .object({
    schemaVersion: z.literal(1),
    kind: z.literal('PRIVATE_SOURCE_SPEAKING'),
    scope: scopeSchema,
    source: sourceSchema,
    task: taskSchema,
    rubric: rubricSchema,
    taskFingerprint: sha,
    review: z
      .object({
        protocol: z.literal('PRIVATE_SOURCE_ELICITATION_V1'),
        provider: z.string().min(1),
        model: z.string().min(1),
        inputSha256: sha,
        responseSha256: sha,
        elicitationQuote: z.string().min(1).max(2000),
        rationale: z.string().min(12).max(4000),
      })
      .strict(),
  })
  .strict()
  .superRefine((assessment, context) => {
    if (
      assessment.task.kind !== 'COMMUNICATIVE_SPEAKING' ||
      !assessment.task.task.includes(assessment.review.elicitationQuote) ||
      assessment.taskFingerprint !== privateSpeakingFingerprint(assessment)
    )
      context.addIssue({
        code: 'custom',
        message: 'The reviewed private speaking task, source receipt or rubric changed.',
      });
  });
export type PrivateSpeakingAssessment = z.infer<typeof privateSpeakingAssessmentSchema>;
export function isPrivateSpeakingAssessment(value: unknown): value is PrivateSpeakingAssessment {
  return (
    value !== null &&
    typeof value === 'object' &&
    'kind' in value &&
    value.kind === 'PRIVATE_SOURCE_SPEAKING'
  );
}
export function assertPrivateSpeakingSession(input: {
  assessment: unknown;
  userId: string;
  courseId: string;
  targetLang: string;
  level: string | undefined;
  selection: unknown;
  task: string;
  guidance: string | null;
}) {
  const assessment = privateSpeakingAssessmentSchema.parse(input.assessment);
  const selection = learningSelectionSnapshotSchema.parse(input.selection);
  const source = selection.sourceFocus;
  if (source) readFrozenLearningSourceFocus(source);
  if (
    !source ||
    selection.objectives.length ||
    assessment.scope.userId !== input.userId ||
    assessment.scope.courseId !== input.courseId ||
    assessment.scope.targetLang !== input.targetLang ||
    assessment.scope.level !== input.level ||
    selection.targetLang !== input.targetLang ||
    selection.level !== input.level ||
    objectiveEvidenceHash(assessment.source) !==
      objectiveEvidenceHash({
        focusId: source.id,
        analysisId: source.analysisId,
        analysisRevision: source.analysisRevision,
        resultDigest: source.resultDigest,
        focusDigest: source.focusDigest,
      }) ||
    objectiveEvidenceHash(assessment.task) !==
      objectiveEvidenceHash({
        kind: 'COMMUNICATIVE_SPEAKING',
        task: input.task,
        guidance: input.guidance,
        suppliedSupport: [],
      })
  )
    throw new Error(
      'Private speaking feedback changed its owned frozen source, difficulty or actual elicitation.'
    );
  return assessment;
}
