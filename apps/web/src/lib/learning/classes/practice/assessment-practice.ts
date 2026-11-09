import { learningSkills, writingFeedbackSchema } from '@sotto/shared';
import { z } from 'zod';
import type { Prisma } from '@/generated/prisma/client';
import { readInitialA1PracticeAuthorization } from '@/lib/classes/lesson/initial-a1-provenance';
import { speakingTaskMode } from '@/lib/learning-map/evidence/communicative-speaking';
import { classRequirementsOrLegacy } from '../../skill-requirements';
import { assertLearningMaterial, LearningIncompleteError } from '../../session-evaluation';
import { currentClassSections } from '../progress/current-sections';
import { hasFormativeWritingReceipt } from './assessment-practice-writing';
import { hasFormativeSpeakingReceipt } from './assessment-practice-speaking';
import { savedClassQuestionMaterialSchema } from '../formative/class-material';

/** Check saved formative work under the same class lock as assessment access. */
export async function requireAssessmentPracticeComplete(
  database: Prisma.TransactionClient,
  input: { classId: string; classAttempt: number; userId: string }
) {
  await database.$queryRaw`SELECT id FROM "CourseClass" WHERE id = ${input.classId} FOR UPDATE`;
  const cls = await database.courseClass.findFirst({
    where: { id: input.classId, course: { userId: input.userId } },
    include: {
      course: { select: { nativeLang: true, targetLang: true } },
      lesson: { select: { level: true } },
      sections: {
        include: {
          questions: true,
          episode: { select: { status: true, audioUrl: true, deletedAt: true } },
          prompts: {
            include: {
              recordings: {
                where: { userId: input.userId },
                orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
              },
            },
          },
          writingPrompts: {
            include: {
              responses: {
                where: { userId: input.userId },
                orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
              },
            },
          },
        },
      },
    },
  });
  if (
    !cls ||
    cls.attempt !== input.classAttempt ||
    !['AVAILABLE', 'IN_PROGRESS'].includes(cls.status)
  )
    throw new LearningIncompleteError('This class attempt is no longer available.');
  const requirements = classRequirementsOrLegacy(cls.skillRequirements, {
    nativeLang: cls.course.nativeLang,
    targetLang: cls.course.targetLang,
    level: cls.lesson.level,
  });
  const answers = z
    .record(z.string(), z.number().int().nonnegative())
    .safeParse(cls.learnerAnswers);
  const saved = answers.success ? answers.data : {};
  const sections = currentClassSections(cls.sections);
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
      speakingTaskModes: section.prompts.map((prompt) =>
        speakingTaskMode(prompt.learningObjectives)
      ),
    })),
    true
  );
  for (const skill of learningSkills) {
    if (requirements.skills[skill].state !== 'REQUIRED') continue;
    const section = sections.find((item) => item.skill === skill);
    if (!section) throw new LearningIncompleteError('Practice material is unavailable.');
    if (!['READY', 'PASSED'].includes(section.status))
      throw new LearningIncompleteError(`${skill.toLowerCase()} practice is not ready.`, [skill]);
    if (
      ['GRAMMAR', 'READING', 'LISTENING'].includes(skill) &&
      section.questions.some(
        (question) =>
          question.skill !== skill || !savedClassQuestionMaterialSchema.safeParse(question).success
      )
    )
      throw new LearningIncompleteError(`${skill.toLowerCase()} practice needs repair.`, [skill]);
    const complete =
      skill === 'SPEAKING'
        ? section.prompts.every((prompt) => {
            const latest = prompt.recordings.find(
              (recording) => recording.attempt === section.attempt
            );
            return (
              latest?.sectionId === section.id &&
              latest.status === 'SCORED' &&
              latest.overallScore !== null &&
              Number.isFinite(latest.overallScore) &&
              latest.overallScore >= 0 &&
              latest.overallScore <= 1
            );
          })
        : skill === 'WRITING'
          ? section.writingPrompts.every((prompt) => {
              const latest = prompt.responses.find(
                (response) => response.attempt === section.attempt
              );
              return (
                latest?.sectionId === section.id && writingFeedbackSchema.safeParse(latest).success
              );
            })
          : section.questions.every((question) => {
              const selected = saved[question.id];
              return (
                selected !== undefined &&
                Array.isArray(question.options) &&
                selected < question.options.length
              );
            });
    if (!complete)
      throw new LearningIncompleteError(
        `Finish your ${skill.toLowerCase()} practice before the assessment.`,
        [skill]
      );
    if (skill === 'SPEAKING') {
      const authorization = await readInitialA1PracticeAuthorization(
        database,
        cls.id,
        input.userId
      );
      for (const prompt of section.prompts) {
        const latest = prompt.recordings.find((recording) => recording.attempt === section.attempt);
        if (
          !latest ||
          !(await hasFormativeSpeakingReceipt(database, {
            recording: latest,
            prompt,
            classId: cls.id,
            courseId: cls.courseId,
            userId: input.userId,
            authorization,
          }))
        )
          throw new LearningIncompleteError(
            'Finish your speaking practice before the assessment.',
            [skill]
          );
      }
    }
    if (skill === 'WRITING') {
      const authorization = await readInitialA1PracticeAuthorization(
        database,
        cls.id,
        input.userId
      );
      for (const prompt of section.writingPrompts) {
        const latest = prompt.responses.find((response) => response.attempt === section.attempt);
        if (
          !latest ||
          !(await hasFormativeWritingReceipt(database, {
            response: latest,
            courseId: cls.courseId,
            userId: input.userId,
            authorization,
          }))
        )
          throw new LearningIncompleteError('Finish your writing practice before the assessment.', [
            skill,
          ]);
      }
    }
  }
}
