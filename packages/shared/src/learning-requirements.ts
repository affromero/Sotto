import { z } from 'zod';
import type { SkillType } from './types/enums';

export const learningSkills = ['GRAMMAR', 'READING', 'LISTENING', 'SPEAKING', 'WRITING'] as const;

const requirementSchema = z.discriminatedUnion('state', [
  z.object({ state: z.literal('REQUIRED'), expectedCount: z.number().int().positive() }).strict(),
  z
    .object({
      state: z.literal('EXEMPT_NO_PROVIDER'),
      reason: z.enum(['NO_TTS_PROVIDER', 'NO_STT_PROVIDER']),
    })
    .strict(),
  z.object({ state: z.literal('NOT_REQUESTED') }).strict(),
]);

export const skillRequirementsSchema = z
  .object({
    version: z.literal(1),
    scope: z.enum([
      'CLASS',
      'FULL',
      'GRAMMAR',
      'READING',
      'LISTENING',
      'SPEAKING',
      'WRITING',
      'VOCAB',
    ]),
    nativeLang: z.string().trim().min(1),
    targetLang: z.string().trim().min(1),
    level: z.enum(['A1', 'A2', 'B1', 'B2', 'C1', 'C2']),
    ttsProvider: z.string().trim().min(1).nullable(),
    sttProvider: z.string().trim().min(1).nullable(),
    referenceAudioRequired: z.boolean(),
    skills: z
      .object({
        GRAMMAR: requirementSchema,
        READING: requirementSchema,
        LISTENING: requirementSchema,
        SPEAKING: requirementSchema,
        WRITING: requirementSchema,
      })
      .strict(),
  })
  .strict()
  .superRefine((requirements, context) => {
    for (const skill of learningSkills) {
      const requirement = requirements.skills[skill];
      const requested =
        requirements.scope === 'CLASS' ||
        requirements.scope === 'FULL' ||
        requirements.scope === skill;
      const missingProvider =
        skill === 'LISTENING'
          ? requirements.ttsProvider === null
          : skill === 'SPEAKING' && requirements.sttProvider === null;
      const expectedState = !requested
        ? 'NOT_REQUESTED'
        : missingProvider
          ? 'EXEMPT_NO_PROVIDER'
          : 'REQUIRED';
      const expectedReason = skill === 'LISTENING' ? 'NO_TTS_PROVIDER' : 'NO_STT_PROVIDER';
      if (
        requirement.state !== expectedState ||
        (requirement.state === 'REQUIRED' && requirement.expectedCount !== expectedCounts[skill]) ||
        (requirement.state === 'EXEMPT_NO_PROVIDER' && requirement.reason !== expectedReason)
      ) {
        context.addIssue({
          code: 'custom',
          path: ['skills', skill],
          message: 'Skill requirement does not match provider access and requested scope.',
        });
      }
    }
    const referencesRequired =
      requirements.skills.SPEAKING.state === 'REQUIRED' && requirements.ttsProvider !== null;
    if (requirements.referenceAudioRequired !== referencesRequired)
      context.addIssue({
        code: 'custom',
        path: ['referenceAudioRequired'],
        message: 'Speaking reference audio must match TTS access.',
      });
  });

export type SkillRequirements = z.infer<typeof skillRequirementsSchema>;
export type SkillRequirement = z.infer<typeof requirementSchema>;

const expectedCounts: Record<SkillType, number> = {
  GRAMMAR: 5,
  READING: 5,
  LISTENING: 4,
  SPEAKING: 4,
  WRITING: 3,
};

export function createSkillRequirements(
  input: Omit<SkillRequirements, 'version' | 'skills' | 'referenceAudioRequired'>
): SkillRequirements {
  const skills = Object.fromEntries(
    learningSkills.map((skill) => {
      const requested = input.scope === 'CLASS' || input.scope === 'FULL' || input.scope === skill;
      if (!requested) return [skill, { state: 'NOT_REQUESTED' }];
      if (skill === 'LISTENING' && input.ttsProvider === null)
        return [skill, { state: 'EXEMPT_NO_PROVIDER', reason: 'NO_TTS_PROVIDER' }];
      if (skill === 'SPEAKING' && input.sttProvider === null)
        return [skill, { state: 'EXEMPT_NO_PROVIDER', reason: 'NO_STT_PROVIDER' }];
      return [skill, { state: 'REQUIRED', expectedCount: expectedCounts[skill] }];
    })
  );
  return skillRequirementsSchema.parse({
    ...input,
    version: 1,
    referenceAudioRequired:
      (input.scope === 'CLASS' || input.scope === 'FULL' || input.scope === 'SPEAKING') &&
      input.sttProvider !== null &&
      input.ttsProvider !== null,
    skills,
  });
}

export function requiredLearningSkills(requirements: SkillRequirements): SkillType[] {
  return learningSkills.filter((skill) => requirements.skills[skill].state === 'REQUIRED');
}
