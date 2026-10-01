import { z } from 'zod';
import { assertStoredReadingVocabulary } from '../reading-vocabulary';
import { learningScriptHash } from '../script-hash';
import { resolveStorageInput } from '../../sidedoor/storage/core/storage-inputs';
import type { LearningDatabase } from '../database';
import { currentClassSections } from './current-sections';
import { readSkillRequirements } from '../skill-requirements';
import { assertLearningMaterial, LearningIncompleteError } from '../session-evaluation';

export const classQuestionMaterialSchema = z.object({
  question: z.string().trim().min(1),
  options: z
    .array(z.string().trim().min(1))
    .length(4)
    .refine((options) => new Set(options.map((option) => option.toLowerCase())).size === 4),
  correctIndex: z.number().int().min(0).max(3),
  explanation: z.string().trim().min(1),
});
const scriptTurnsSchema = z.array(z.object({ text: z.string().trim().min(1) })).min(1);

/** Publication checks the rows that learners will receive, including independent reading extraction. */
export async function assertStoredClassMaterial(database: LearningDatabase, classId: string) {
  const cls = await database.courseClass.findUniqueOrThrow({
    where: { id: classId },
    include: {
      course: { select: { userId: true } },
      sections: {
        include: {
          questions: true,
          prompts: true,
          writingPrompts: true,
          episode: { include: { script: true } },
        },
      },
    },
  });
  const requirements = readSkillRequirements(cls.skillRequirements);
  if (!requirements || requirements.scope !== 'CLASS')
    throw new LearningIncompleteError(
      'Class requirements are unavailable. Repair this class before publication.'
    );
  const sections = currentClassSections(cls.sections);
  for (const section of sections) {
    if (requirements.skills[section.skill].state !== 'REQUIRED') continue;
    if (!['READY', 'PASSED'].includes(section.status))
      throw new LearningIncompleteError(
        'A required class section is still preparing or needs repair.',
        [section.skill]
      );
    for (const question of section.questions) {
      if (
        question.skill !== section.skill ||
        !classQuestionMaterialSchema.safeParse(question).success
      )
        throw new LearningIncompleteError(
          'A class question is incomplete or belongs to a different skill.',
          [section.skill]
        );
    }
    if (
      section.skill === 'SPEAKING' &&
      section.prompts.some((prompt) => !prompt.targetPhrase.trim() || !prompt.translation.trim())
    )
      throw new LearningIncompleteError('Speaking prompts are incomplete.', ['SPEAKING']);
    if (section.skill === 'WRITING' && section.writingPrompts.some((prompt) => !prompt.task.trim()))
      throw new LearningIncompleteError('Writing tasks are incomplete.', ['WRITING']);
    if (
      section.skill === 'LISTENING' &&
      (section.episode?.deletedAt ||
        !section.episode?.script ||
        !scriptTurnsSchema.safeParse(section.episode.script.turns).success)
    )
      throw new LearningIncompleteError('Listening needs its preserved script and owned episode.', [
        'LISTENING',
      ]);
    if (section.skill === 'LISTENING' && section.episode) {
      const spec = z.object({ scriptHash: z.string().length(64) }).safeParse(section.spec);
      if (
        section.episode.userId !== cls.course.userId ||
        !spec.success ||
        spec.data.scriptHash !== learningScriptHash(section.episode.script!.turns)
      )
        throw new LearningIncompleteError('Listening questions do not match the owned script.', [
          'LISTENING',
        ]);
    }
  }
  if (requirements.referenceAudioRequired)
    for (const prompt of sections.flatMap((section) => section.prompts)) {
      if (!prompt.referenceTtsUrl)
        throw new LearningIncompleteError('Speaking reference audio is missing.', ['SPEAKING']);
      await resolveStorageInput(database, {
        consumer: `speaking-prompt:${prompt.id}:reference`,
        reference: prompt.referenceTtsUrl,
      });
    }
  assertLearningMaterial(
    requirements,
    sections.map((section) => ({
      skill: section.skill,
      itemIds:
        section.skill === 'SPEAKING'
          ? section.prompts.map((prompt) => prompt.id)
          : section.skill === 'WRITING'
            ? section.writingPrompts.map((prompt) => prompt.id)
            : section.questions.map((question) => question.id),
      passageText: section.questions.find((question) => question.passageText)?.passageText,
      audio: section.episode?.deletedAt ? null : section.episode,
      referenceAudioUrls: section.prompts.map((prompt) => prompt.referenceTtsUrl),
    }))
  );
  if (requirements.skills.READING.state === 'REQUIRED')
    await assertStoredReadingVocabulary(
      database,
      cls.courseId,
      cls.readingVocabulary,
      sections.find((section) => section.skill === 'READING')!.questions
    );
  return cls;
}
