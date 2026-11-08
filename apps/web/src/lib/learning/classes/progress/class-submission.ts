import { classReceiptSchema, type SkillType } from '@sotto/shared';
import { Prisma } from '@/generated/prisma/client';
import { prismaUnfiltered as prisma } from '../../../prisma';
import { classRequirementsOrLegacy } from '../../skill-requirements';
import { assertStoredClassMaterial } from '../formative/class-material';
import { currentClassSections } from './current-sections';
import { readInitialA1PracticeAuthorization } from '../../../classes/lesson/initial-a1-provenance';
import { sottoTransaction } from '../../../sidedoor/access/state/transaction';
import type { SottoProviderExecution } from '../../../sidedoor/credentials/runtime/provider-execution';
import { applyClassPracticeReview } from '../formative/class-practice-review';
import { speakingTaskMode } from '../../../learning-map/evidence/communicative-speaking';
import {
  evaluateLearningWork,
  LearningIncompleteError,
  type LearningSectionWork,
} from '../../session-evaluation';

export interface SubmitResult {
  passed: boolean;
  overallScore: number;
  passedSections: number;
  totalSections: number;
  sections: Array<{ id: string; skill: SkillType; score: number; passed: boolean }>;
}

export class ClassIncompleteError extends Error {}

/** Serialize submissions with the class row so retries cannot review vocabulary twice. */
export async function submitClass(
  classId: string,
  userId: string,
  answers: Array<{ questionId: string; selectedIndex: number }>,
  execution: SottoProviderExecution
): Promise<SubmitResult | null> {
  return sottoTransaction(
    prisma,
    async (tx) => {
      execution.signal?.throwIfAborted();
      const actor = await execution.authorize(tx);
      if (actor.userId !== userId || execution.userId !== userId) return null;
      await tx.$queryRaw`SELECT id FROM "CourseClass" WHERE id = ${classId} FOR UPDATE`;
      const cls = await tx.courseClass.findFirst({
        where: { id: classId, course: { userId } },
        include: {
          course: { select: { nativeLang: true, targetLang: true } },
          lesson: true,
          submission: { include: { answers: true } },
          sections: {
            include: {
              questions: true,
              episode: { select: { status: true, audioUrl: true, deletedAt: true } },
              prompts: {
                include: {
                  recordings: {
                    where: { userId },
                    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
                  },
                },
              },
              writingPrompts: {
                include: {
                  responses: {
                    where: { userId },
                    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
                  },
                },
              },
            },
          },
        },
      });
      if (!cls) return null;
      cls.sections = currentClassSections(cls.sections);
      await tx.$queryRaw`SELECT id FROM "Course" WHERE id = ${cls.courseId} FOR UPDATE`;
      const prior = (): SubmitResult => ({
        passed: cls.submission!.passed ?? false,
        overallScore: cls.submission!.overallScore ?? 0,
        passedSections: cls.sections.filter((section) => section.passed).length,
        totalSections: cls.sections.length,
        sections: cls.sections.map((section) => ({
          id: section.id,
          skill: section.skill,
          score: section.score ?? 0,
          passed: section.passed ?? false,
        })),
      });
      if (
        cls.submission &&
        (cls.status === 'PASSED' ||
          (cls.status === 'FAILED' && cls.submission.attempt === cls.attempt))
      ) {
        const receipt = classReceiptSchema.safeParse(cls.submission.receipt);
        execution.signal?.throwIfAborted();
        return receipt.success ? receipt.data : prior();
      }
      if (!['AVAILABLE', 'IN_PROGRESS'].includes(cls.status))
        throw new ClassIncompleteError('This class is not ready for submission.');
      const initialTeaching = await readInitialA1PracticeAuthorization(tx, classId, userId);
      if (initialTeaching)
        throw new ClassIncompleteError('Complete the independent assessment to finish this class.');
      // Older sessions retain their original five-skill obligations. Current settings cannot exempt them.
      const requirements = classRequirementsOrLegacy(cls.skillRequirements, {
        nativeLang: cls.course.nativeLang,
        targetLang: cls.course.targetLang,
        level: cls.lesson.level,
      });
      if (cls.skillRequirements) {
        try {
          await assertStoredClassMaterial(tx, classId, 'saved');
        } catch (error) {
          if (error instanceof LearningIncompleteError)
            throw new ClassIncompleteError(error.message);
          throw error;
        }
      }
      if (new Set(answers.map((answer) => answer.questionId)).size !== answers.length)
        throw new ClassIncompleteError('Submit each answer once.');
      const questions = cls.sections.flatMap((section) => section.questions);
      const answerMap = new Map(answers.map((answer) => [answer.questionId, answer.selectedIndex]));
      if (
        answers.some((answer) => !questions.some((question) => question.id === answer.questionId))
      )
        throw new ClassIncompleteError('An answer belongs to a different class attempt.');
      const graded: Array<{
        sectionId: string;
        questionId: string;
        selectedIndex: number;
        isCorrect: boolean;
      }> = [];
      const work: LearningSectionWork[] = cls.sections.map((section) => {
        const speaking = section.skill === 'SPEAKING';
        const writing = section.skill === 'WRITING';
        const ids = speaking
          ? section.prompts.map((prompt) => prompt.id)
          : writing
            ? section.writingPrompts.map((prompt) => prompt.id)
            : section.questions.map((question) => question.id);
        const grades: Array<{ id: string; score: number }> = [];
        if (speaking) {
          for (const prompt of section.prompts) {
            const latest = prompt.recordings.find(
              (recording) => recording.attempt === section.attempt
            );
            if (latest?.status === 'SCORED' && latest.overallScore !== null)
              grades.push({ id: prompt.id, score: latest.overallScore });
          }
        } else if (writing) {
          for (const prompt of section.writingPrompts) {
            const latest = prompt.responses.find(
              (response) => response.attempt === section.attempt
            );
            if (latest?.overallScore != null)
              grades.push({ id: prompt.id, score: latest.overallScore });
          }
        } else {
          for (const question of section.questions) {
            const selectedIndex = answerMap.get(question.id);
            if (
              selectedIndex === undefined ||
              !Number.isInteger(selectedIndex) ||
              selectedIndex < 0 ||
              !Array.isArray(question.options) ||
              selectedIndex >= question.options.length
            )
              continue;
            const isCorrect = selectedIndex === question.correctIndex;
            grades.push({ id: question.id, score: isCorrect ? 1 : 0 });
            graded.push({
              sectionId: section.id,
              questionId: question.id,
              selectedIndex,
              isCorrect,
            });
          }
        }
        return {
          skill: section.skill,
          itemIds: ids,
          gradedItemIds: grades.map((grade) => grade.id),
          score: grades.length
            ? grades.reduce((sum, grade) => sum + grade.score, 0) / grades.length
            : null,
          passThreshold: section.passThreshold,
          passageText: section.questions.find((question) => question.passageText)?.passageText,
          audio: section.episode?.deletedAt ? null : section.episode,
          referenceAudioUrls: section.prompts.map((prompt) => prompt.referenceTtsUrl),
          speakingTaskModes: section.prompts.map((prompt) =>
            speakingTaskMode(prompt.learningObjectives)
          ),
        };
      });
      let evaluation: ReturnType<typeof evaluateLearningWork>;
      try {
        evaluation = evaluateLearningWork(requirements, work);
      } catch (error) {
        if (error instanceof LearningIncompleteError) throw new ClassIncompleteError(error.message);
        throw error;
      }
      if (!evaluation.complete) {
        const incomplete = evaluation.sections
          .filter((section) => section.required && !section.complete)
          .map((section) => section.skill.toLowerCase());
        throw new ClassIncompleteError(
          `Finish every exercise and wait for feedback in: ${incomplete.join(', ')}.`
        );
      }
      const sectionResults = evaluation.sections
        .filter((section) => section.required)
        .map((result) => ({
          id: cls.sections.find((section) => section.skill === result.skill)!.id,
          skill: result.skill,
          score: result.score!,
          passed: result.passed!,
        }));
      const passedSections = sectionResults.filter((section) => section.passed).length;
      const totalSections = sectionResults.length;
      const overallScore =
        sectionResults.reduce((sum, section) => sum + section.score, 0) / totalSections;
      const passed = evaluation.mastered;
      const receipt = {
        passed,
        overallScore,
        passedSections,
        totalSections,
        sections: sectionResults,
      };
      const history = Array.isArray(cls.submission?.history) ? cls.submission.history : [];
      if (cls.submission)
        history.push({
          attempt: cls.submission.attempt,
          receipt: cls.submission.receipt ?? {
            passed: cls.submission.passed,
            overallScore: cls.submission.overallScore,
          },
          submittedAt: cls.submission.submittedAt.toISOString(),
          answers: cls.submission.answers.map(
            ({ sectionId, questionId, selectedIndex, isCorrect }) => ({
              sectionId,
              questionId,
              selectedIndex,
              isCorrect,
            })
          ),
        });
      const now = new Date();
      for (const section of sectionResults)
        await tx.classSection.update({
          where: { id: section.id },
          data: {
            score: section.score,
            passed: section.passed,
            status: section.passed ? 'PASSED' : 'FAILED',
          },
        });
      await tx.classSubmission.upsert({
        where: { classId },
        create: {
          classId,
          userId,
          attempt: cls.attempt,
          overallScore,
          passed,
          receipt,
          history: [],
          answers: { create: graded },
        },
        update: {
          attempt: cls.attempt,
          overallScore,
          passed,
          submittedAt: now,
          receipt,
          history: history as Prisma.InputJsonValue,
          answers: { deleteMany: {}, create: graded },
        },
      });
      await tx.courseClass.update({
        where: { id: classId },
        data: {
          status: passed ? 'PASSED' : 'FAILED',
          submittedAt: now,
          ...(passed ? { passedAt: now } : { failedAt: now }),
        },
      });
      if (passed)
        await tx.course.updateMany({
          where: { id: cls.courseId, activeClassId: classId },
          data: { activeClassId: null },
        });
      await applyClassPracticeReview(tx, {
        classId,
        courseId: cls.courseId,
        userId,
        attempt: cls.attempt,
        adaptiveSeed: cls.adaptiveSeed,
        readingVocabulary: cls.readingVocabulary,
        lesson: cls.lesson,
        sections: cls.sections,
        answers,
        graded,
        previousAnswers: cls.submission?.answers ?? [],
        history,
        sectionResults,
        now,
      });
      execution.signal?.throwIfAborted();
      return receipt;
    },
    { signal: execution.signal }
  );
}
