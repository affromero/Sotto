import { z } from 'zod';
import {
  skillRequirementsSchema,
  learningLevelSchema,
  learningSelectionRequestSchema,
  learningSelectionSnapshotSchema,
} from '@sotto/shared';
import { preparationSchema } from '../classes/preparation-state';

export const practicePreparationSchema = preparationSchema
  .omit({ classId: true, result: true, timeZone: true, deferAudio: true })
  .extend({
    sessionId: z.uuid(),
    unavailableReason: z.enum(['not_enough_vocab', 'nothing_due', 'no_content']).nullable(),
    speechFingerprint: z.string().length(64),
    focusTargetId: z.string().min(1).nullable(),
    generationVersion: z.literal(2).optional(),
    sourceRetired: z.literal(true).optional(),
    practiceLevel: learningLevelSchema.optional(),
    learningRequest: learningSelectionRequestSchema.nullable().optional(),
  });
export type PracticePreparation = z.infer<typeof practicePreparationSchema>;

export const practiceGenerationSchema = z
  .object({
    schemaVersion: z.literal(2).optional(),
    practiceLevel: learningLevelSchema.optional(),
    learningRequest: learningSelectionRequestSchema.nullable().optional(),
    learningSelection: learningSelectionSnapshotSchema.nullable().optional(),
    levelCoverage: skillRequirementsSchema.nullable().optional(),
    course: z
      .object({
        id: z.string().min(1),
        userId: z.string().min(1),
        nativeLang: z.string().min(1),
        targetLang: z.string().min(1),
        currentLevel: z.enum(['A1', 'A2', 'B1', 'B2', 'C1', 'C2']),
        curriculumId: z.string().min(1),
        pedagogy: z.enum(['BALANCED', 'IMMERSION', 'GRAMMAR', 'COMMUNICATION', 'INTENSIVE']),
      })
      .strict(),
    requirements: skillRequirementsSchema,
    seedToken: z.string().min(1),
    note: z.string(),
    focusTargets: z
      .array(
        z
          .object({
            id: z.string(),
            kind: z.enum(['WORD', 'PHRASE', 'SENTENCE']),
            text: z.string(),
            normalizedText: z.string(),
            contextText: z.string().nullable(),
            priorityBoost: z.number().finite(),
          })
          .strict()
      )
      .max(4),
    seed: z
      .object({
        objective: z.string(),
        grammarPoints: z.array(z.string()),
        targetVocab: z.array(z.object({ lemma: z.string(), gloss: z.string() })),
      })
      .strict()
      .nullable(),
  })
  .strict()
  .superRefine((generation, context) => {
    if (generation.schemaVersion !== 2) {
      if (
        [
          generation.practiceLevel,
          generation.learningRequest,
          generation.learningSelection,
          generation.levelCoverage,
        ].some((value) => value !== undefined)
      )
        context.addIssue({
          code: 'custom',
          message: 'Focused practice requires its explicit versioned context.',
        });
      return;
    }
    if (
      !generation.practiceLevel ||
      generation.learningRequest === undefined ||
      generation.learningSelection === undefined ||
      generation.levelCoverage === undefined ||
      generation.requirements.level !== generation.practiceLevel ||
      (generation.learningRequest === null) !== (generation.learningSelection === null) ||
      (generation.learningSelection === null) !== (generation.levelCoverage === null) ||
      (generation.learningSelection &&
        generation.learningSelection.level !== generation.practiceLevel) ||
      (generation.levelCoverage &&
        (generation.levelCoverage.scope !== 'CLASS' ||
          generation.levelCoverage.level !== generation.practiceLevel))
    )
      context.addIssue({
        code: 'custom',
        message:
          'Frozen practice difficulty, selection and coverage must describe the same admitted task.',
      });
  });
