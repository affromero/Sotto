import { z } from 'zod';
import { skillRequirementsSchema } from '@sotto/shared';
import { preparationSchema } from '../classes/preparation-state';

export const practicePreparationSchema = preparationSchema
  .omit({ classId: true, result: true, timeZone: true, deferAudio: true })
  .extend({
    sessionId: z.uuid(),
    unavailableReason: z.enum(['not_enough_vocab', 'nothing_due', 'no_content']).nullable(),
    speechFingerprint: z.string().length(64),
    focusTargetId: z.string().min(1).nullable(),
  });
export type PracticePreparation = z.infer<typeof practicePreparationSchema>;

export const practiceGenerationSchema = z
  .object({
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
  .strict();
