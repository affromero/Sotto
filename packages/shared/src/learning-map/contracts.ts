import { z } from 'zod';
import { skillRequirementsSchema } from '../learning-requirements';
import {
  learningLevelSchema,
  learningNodeSchema,
  learningObjectiveSchema,
  learningGroupSchema,
  learningSkillSchema,
  nextLearningLevel,
} from './catalog';
import { objectiveEvidenceStateSchema } from './progress';
import { learningSelectionSnapshotSchema } from './selection';

export const objectiveStatusSchema = z.enum([
  'NOT_ASSESSED',
  'PRACTISING',
  'CONFIDENT',
  'NEEDS_WORK',
]);
export const objectiveProgressSchema = z
  .object({
    objectiveId: z.string().min(1),
    status: objectiveStatusSchema,
    reviewDue: z.boolean(),
    skills: z
      .array(
        z
          .object({
            skill: learningSkillSchema,
            status: objectiveStatusSchema,
            exempt: z.boolean(),
            evidence: objectiveEvidenceStateSchema.nullable(),
          })
          .strict()
      )
      .min(1)
      .max(5),
  })
  .strict();

export const learningObjectiveMemorySchema = z
  .object({
    objective: learningObjectiveSchema,
    catalogVersion: z.number().int().positive(),
    catalogHash: z.string().regex(/^[a-f0-9]{64}$/),
    requirementId: z.string().min(1),
    progress: objectiveProgressSchema,
  })
  .strict()
  .superRefine((entry, context) => {
    if (entry.progress.objectiveId !== entry.objective.id)
      context.addIssue({
        code: 'custom',
        message: 'Memory progress must describe its pinned objective.',
      });
  });
export type LearningObjectiveMemory = z.infer<typeof learningObjectiveMemorySchema>;

export const learningLevelReadinessSchema = z
  .object({
    level: learningLevelSchema,
    nextLevel: learningLevelSchema.nullable(),
    ready: z.boolean(),
    requiredCount: z.number().int().nonnegative(),
    confidentCount: z.number().int().nonnegative(),
    unassessedCount: z.number().int().nonnegative(),
    practisingCount: z.number().int().nonnegative(),
    needsWorkCount: z.number().int().nonnegative(),
    missingObjectiveIds: z.array(z.string().min(1)),
    exemptSkills: z.array(z.enum(['LISTENING', 'SPEAKING'])),
  })
  .strict();

export const learningMapNodeViewSchema = z
  .object({
    node: learningNodeSchema,
    progress: objectiveProgressSchema.nullable(),
    summary: z
      .object({
        total: z.number().int().positive(),
        confident: z.number().int().nonnegative(),
        notAssessed: z.number().int().nonnegative(),
        reviewDue: z.number().int().nonnegative(),
      })
      .strict(),
  })
  .strict()
  .superRefine((entry, context) => {
    if (
      (entry.node.kind === 'GROUP' && entry.progress !== null) ||
      (entry.node.kind === 'OBJECTIVE' && entry.progress?.objectiveId !== entry.node.id)
    )
      context.addIssue({ code: 'custom', message: 'Progress must describe its exact objective.' });
    if (
      entry.summary.confident + entry.summary.notAssessed > entry.summary.total ||
      entry.summary.reviewDue > entry.summary.total
    )
      context.addIssue({
        code: 'custom',
        message: 'Learning summary counts exceed the objective count.',
      });
  });

export const learningMapResponseSchema = z
  .object({
    courseId: z.string().min(1),
    targetLang: z.string().regex(/^[a-z]{2}$/),
    currentLevel: learningLevelSchema,
    viewedLevel: learningLevelSchema,
    catalogVersion: z.number().int().positive(),
    catalogHash: z.string().regex(/^[a-f0-9]{64}$/),
    requirementId: z.string().nullable(),
    coverage: skillRequirementsSchema.nullable(),
    readiness: learningLevelReadinessSchema,
    blockers: z.array(z.string().min(1)),
    completedAt: z.iso.datetime().nullable(),
    references: z.array(z.object({ title: z.string().min(1), url: z.url() }).strict()).min(1),
    nodes: z.array(learningMapNodeViewSchema),
  })
  .strict()
  .superRefine((map, context) => {
    if (
      map.readiness.level !== map.viewedLevel ||
      map.nodes.some(
        (entry) =>
          !entry.node.id.startsWith(`${map.targetLang}.`) ||
          (entry.node.kind === 'OBJECTIVE' && entry.node.level !== map.viewedLevel)
      )
    )
      context.addIssue({
        code: 'custom',
        message: 'The learning map language or viewed difficulty is inconsistent.',
      });
  });
export type LearningMapResponse = z.infer<typeof learningMapResponseSchema>;

export const advanceLearningLevelSchema = z
  .object({
    requestId: z.uuid(),
    expectedLevel: learningLevelSchema,
    catalogHash: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();
export type AdvanceLearningLevelRequest = z.infer<typeof advanceLearningLevelSchema>;

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
  .strict()
  .superRefine((receipt, context) => {
    if (
      receipt.nextLevel !== nextLearningLevel(receipt.level) ||
      receipt.currentLevel !== (receipt.nextLevel ?? receipt.level)
    )
      context.addIssue({
        code: 'custom',
        message: 'A completion receipt must advance exactly one band or remain at C2.',
      });
  });
export type LearningLevelCompletionReceipt = z.infer<typeof learningLevelCompletionSchema>;

export const learningObjectiveDetailSchema = z
  .object({
    courseId: z.string().min(1),
    catalogVersion: z.number().int().positive(),
    catalogHash: z.string().regex(/^[a-f0-9]{64}$/),
    requirementId: z.string().nullable(),
    objective: learningObjectiveSchema,
    ancestors: z.array(learningGroupSchema),
    progress: objectiveProgressSchema,
  })
  .strict();

export const learningObjectiveHistorySchema = z
  .object({
    courseId: z.string().min(1),
    objectiveId: z.string().min(1),
    criterionVersion: z.number().int().positive(),
    policyVersion: z.number().int().positive(),
    items: z
      .array(
        z
          .object({
            id: z.string(),
            skill: learningSkillSchema,
            quality: z.number().min(0).max(1),
            sourceType: z.string(),
            sessionId: z.string(),
            taskId: z.string(),
            observedAt: z.iso.datetime(),
            rationale: z.string(),
            assessment: z.string(),
          })
          .strict()
      )
      .max(100),
    nextCursor: z.string().nullable(),
  })
  .strict();

export const learningSelectionPreviewSchema = z
  .object({
    selection: learningSelectionSnapshotSchema,
    requirementId: z.string().nullable(),
    availableKinds: z
      .array(z.enum(['FULL', 'GRAMMAR', 'READING', 'LISTENING', 'SPEAKING', 'WRITING']))
      .min(1),
  })
  .strict();
