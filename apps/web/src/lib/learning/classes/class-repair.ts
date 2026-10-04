import { createHash } from 'node:crypto';
import { readingVocabularySchema, type SkillRequirements, type SkillType } from '@sotto/shared';
import { resolveStorageInput } from '../../sidedoor/storage/core/storage-inputs';
import type { LearningDatabase } from '../database';
import type { Prisma } from '@/generated/prisma/client';
import { currentClassSections } from './current-sections';
import { classQuestionMaterialSchema } from './class-material';
import { learningScriptHash } from '../script-hash';
import { extractReadingVocabulary } from '../reading-vocabulary';
import { seedLessonItems } from '../../knowledge-graph';
import { withClassGeneration } from './class-generation-state';
import type { SottoProviderExecution } from '../../sidedoor/credentials/runtime/provider-execution';

export type RepairClass = Prisma.CourseClassGetPayload<{
  include: {
    course: true;
    lesson: true;
    sections: {
      include: {
        questions: true;
        prompts: true;
        writingPrompts: true;
        episode: { include: { script: true } };
      };
    };
  };
}>;

export function classRepairSkills(cls: RepairClass, requirements: SkillRequirements): SkillType[] {
  const sections = currentClassSections(cls.sections);
  return (Object.keys(requirements.skills) as SkillType[]).filter((skill) => {
    const requirement = requirements.skills[skill];
    if (requirement.state !== 'REQUIRED') return false;
    const section = sections.find((candidate) => candidate.skill === skill);
    if (!section || section.passed === false || !['READY', 'PASSED'].includes(section.status))
      return true;
    const items =
      skill === 'SPEAKING'
        ? section.prompts
        : skill === 'WRITING'
          ? section.writingPrompts
          : section.questions;
    if (
      items.length !== requirement.expectedCount ||
      new Set(items.map((item) => item.id)).size !== items.length
    )
      return true;
    if (skill === 'SPEAKING')
      return section.prompts.some(
        (prompt) =>
          !prompt.targetPhrase.trim() ||
          !prompt.translation.trim() ||
          (requirements.referenceAudioRequired && !prompt.referenceTtsUrl?.trim())
      );
    if (skill === 'WRITING') return section.writingPrompts.some((prompt) => !prompt.task.trim());
    if (
      section.questions.some(
        (question) =>
          question.skill !== skill || !classQuestionMaterialSchema.safeParse(question).success
      )
    )
      return true;
    if (skill === 'READING') {
      const passage = section.questions[0]?.passageText;
      return (
        !passage?.trim() || section.questions.some((question) => question.passageText !== passage)
      );
    }
    if (skill === 'LISTENING') {
      const episode = section.episode;
      if (
        !episode ||
        episode.deletedAt ||
        episode.userId !== cls.course.userId ||
        !episode.script ||
        !['READY', 'SCRIPT_READY', 'PENDING', 'GENERATING_AUDIO', 'STITCHING'].includes(
          episode.status
        ) ||
        (episode.status === 'READY' && !episode.audioUrl?.trim())
      )
        return true;
      try {
        return (
          !section.spec ||
          typeof section.spec !== 'object' ||
          Array.isArray(section.spec) ||
          section.spec.scriptHash !== learningScriptHash(episode.script.turns)
        );
      } catch {
        return true;
      }
    }
    return false;
  });
}

/** Extraction-only repair keeps questions, answers and existing productive evidence. */
export async function repairClassReadingMemory(
  cls: RepairClass,
  requirements: SkillRequirements,
  execution: SottoProviderExecution,
  attempt: number
) {
  const reading = currentClassSections(cls.sections).find((section) => section.skill === 'READING');
  if (!reading || requirements.skills.READING.state !== 'REQUIRED') return;
  const questions = reading.questions.map((question) => ({
    id: question.id,
    question: question.question,
    options: question.options as string[],
    correctIndex: question.correctIndex,
    passageText: question.passageText,
  }));
  const saved = readingVocabularySchema.safeParse(cls.readingVocabulary);
  const ids = new Set(questions.map((question) => question.id));
  const valid =
    saved.success &&
    questions.every((question) => question.passageText === saved.data.passageText) &&
    saved.data.sourceHash === createHash('sha256').update(saved.data.passageText).digest('hex') &&
    new Set(saved.data.words.map((word) => word.lemma)).size === saved.data.words.length &&
    saved.data.words.every(
      (word) =>
        saved.data.passageText.includes(word.sourceForm) &&
        new Set(word.questionIds).size === word.questionIds.length &&
        word.questionIds.every((id) => ids.has(id))
    );
  const vocabulary = valid
    ? saved.data
    : await extractReadingVocabulary({
        userId: execution.userId,
        execution,
        nativeLang: requirements.nativeLang,
        targetLang: requirements.targetLang,
        level: requirements.level,
        questions,
      });
  await withClassGeneration(execution, cls.id, attempt, async (database) => {
    await seedLessonItems(cls.courseId, cls.id, requirements.level, vocabulary.words, [], database);
    await database.courseClass.update({
      where: { id: cls.id },
      data: { readingVocabulary: vocabulary },
    });
  });
}

/** Storage attribution must survive a repair even when a URL remains populated. */
export async function selectClassRepairSkills(
  database: LearningDatabase,
  cls: RepairClass,
  requirements: SkillRequirements
) {
  const skills = classRepairSkills(cls, requirements);
  if (!requirements.referenceAudioRequired || skills.includes('SPEAKING')) return skills;
  const prompts =
    currentClassSections(cls.sections).find((section) => section.skill === 'SPEAKING')?.prompts ??
    [];
  for (const prompt of prompts) {
    try {
      if (!prompt.referenceTtsUrl) throw new Error('Missing speaking reference');
      await resolveStorageInput(database, {
        consumer: `speaking-prompt:${prompt.id}:reference`,
        reference: prompt.referenceTtsUrl,
      });
    } catch {
      return [...skills, 'SPEAKING' as const];
    }
  }
  return skills;
}
