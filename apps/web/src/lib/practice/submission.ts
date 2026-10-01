import {
  createSkillRequirements,
  practiceReceiptSchema,
  type CefrLevel,
  type SkillType,
} from '@sotto/shared';
import { prismaUnfiltered as prisma } from '../prisma';
import { applyReviewOutcome } from '../knowledge-graph';
import { markFocusTargetsPracticed } from '../learning-targets';
import { readSkillRequirements } from '../learning/skill-requirements';
import { reviewReadingVocabulary } from '../learning/reading-vocabulary';
import {
  evaluateLearningWork,
  LearningIncompleteError,
  type LearningSectionWork,
} from '../learning/session-evaluation';
import { assertStoredPracticeMaterial } from './material';
import { scoreMultipleChoice } from './grading';
import {
  PracticeIncompleteError,
  type PracticeMcItem,
  type PracticeAnswer,
  type SubmitPracticeResult,
} from './types';

export class PracticeSessionNotFoundError extends Error {}

export async function submitPractice(
  sessionId: string,
  userId: string,
  answers: PracticeAnswer[]
): Promise<SubmitPracticeResult> {
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "PracticeSession" WHERE id = ${sessionId} FOR UPDATE`;
    const session = await tx.practiceSession.findFirst({
      where: { id: sessionId, course: { userId } },
      include: {
        course: { select: { nativeLang: true, targetLang: true, currentLevel: true } },
        episode: { select: { status: true, audioUrl: true, deletedAt: true } },
        prompts: {
          include: {
            recordings: { where: { userId }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] },
          },
        },
        writingPrompts: {
          include: {
            responses: { where: { userId }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] },
          },
        },
      },
    });
    if (!session) throw new PracticeSessionNotFoundError('Practice session not found');
    await tx.$queryRaw`SELECT id FROM "Course" WHERE id = ${session.courseId} FOR UPDATE`;
    if (session.status === 'COMPLETED') {
      const receipt = practiceReceiptSchema.safeParse(session.submissionResult);
      if (receipt.success) return receipt.data;
      throw new PracticeSessionNotFoundError('This older session is already complete.');
    }
    if (session.status !== 'ACTIVE')
      throw new PracticeIncompleteError('Practice is not ready for submission.');
    if (session.skillRequirements) {
      try {
        await assertStoredPracticeMaterial(tx, sessionId);
      } catch (error) {
        if (error instanceof LearningIncompleteError)
          throw new PracticeIncompleteError(error.message);
        throw error;
      }
    }
    const requirements =
      readSkillRequirements(session.skillRequirements) ??
      createSkillRequirements({
        scope: session.kind,
        nativeLang: session.course.nativeLang,
        targetLang: session.course.targetLang,
        level: session.course.currentLevel as CefrLevel,
        ttsProvider: 'legacy',
        sttProvider: 'legacy',
      });
    const items = (session.items as unknown as PracticeMcItem[]) ?? [];
    const submitted = new Map(answers.map((answer) => [answer.itemId, answer.selectedIndex]));
    if (
      submitted.size !== answers.length ||
      answers.some((answer) => !items.some((item) => item.id === answer.itemId))
    )
      throw new PracticeIncompleteError(
        'Submit each answer once for the current practice session.'
      );
    if (
      items.some((item) => {
        const index = submitted.get(item.id);
        return (
          index === undefined ||
          !Number.isInteger(index) ||
          index < 0 ||
          index >= item.options.length
        );
      })
    )
      throw new PracticeIncompleteError('Answer every practice question before finishing.');
    const mc = scoreMultipleChoice(items, answers);
    const work: LearningSectionWork[] = [];
    const mcSkill = (item: PracticeMcItem): SkillType | null => {
      if (item.id.startsWith('f') || item.id.startsWith('v')) return null;
      if (session.kind !== 'FULL')
        return ['GRAMMAR', 'READING', 'LISTENING'].includes(session.kind)
          ? (session.kind as SkillType)
          : null;
      return item.id.startsWith('g')
        ? 'GRAMMAR'
        : item.id.startsWith('r')
          ? 'READING'
          : item.id.startsWith('l')
            ? 'LISTENING'
            : null;
    };
    for (const skill of ['GRAMMAR', 'READING', 'LISTENING'] as const) {
      const sectionItems = items.filter((item) => mcSkill(item) === skill);
      if (!sectionItems.length) continue;
      const sectionScore = scoreMultipleChoice(sectionItems, answers).score;
      work.push({
        skill,
        itemIds: sectionItems.map((item) => item.id),
        gradedItemIds: sectionItems.map((item) => item.id),
        score: sectionScore,
        passThreshold: 0.7,
        passageText: sectionItems.find((item) => item.passageText)?.passageText,
        audio: skill === 'LISTENING' && !session.episode?.deletedAt ? session.episode : null,
      });
    }
    const oralGrades = session.prompts.flatMap((prompt) => {
      const latest = prompt.recordings[0];
      return latest?.status === 'SCORED' && latest.overallScore !== null
        ? [{ id: prompt.id, score: latest.overallScore }]
        : [];
    });
    const writingGrades = session.writingPrompts.flatMap((prompt) => {
      const latest = prompt.responses[0];
      return latest?.overallScore != null ? [{ id: prompt.id, score: latest.overallScore }] : [];
    });
    const average = (grades: Array<{ score: number }>) =>
      grades.length ? grades.reduce((sum, grade) => sum + grade.score, 0) / grades.length : null;
    if (session.prompts.length)
      work.push({
        skill: 'SPEAKING',
        itemIds: session.prompts.map((prompt) => prompt.id),
        gradedItemIds: oralGrades.map((grade) => grade.id),
        score: average(oralGrades),
        passThreshold: 0.7,
        referenceAudioUrls: session.prompts.map((prompt) => prompt.referenceTtsUrl),
      });
    if (session.writingPrompts.length)
      work.push({
        skill: 'WRITING',
        itemIds: session.writingPrompts.map((prompt) => prompt.id),
        gradedItemIds: writingGrades.map((grade) => grade.id),
        score: average(writingGrades),
        passThreshold: 0.7,
      });
    if (session.kind !== 'VOCAB') {
      try {
        const evaluation = evaluateLearningWork(requirements, work);
        if (!evaluation.complete)
          throw new PracticeIncompleteError(
            'Complete every required exercise and wait for speaking and writing feedback.'
          );
      } catch (error) {
        if (error instanceof LearningIncompleteError)
          throw new PracticeIncompleteError(error.message);
        throw error;
      }
    } else if (!items.length)
      throw new PracticeIncompleteError('This practice has no vocabulary exercises.');
    const scores = work
      .filter((section) => requirements.skills[section.skill].state === 'REQUIRED')
      .map((section) => section.score!);
    const score =
      session.kind === 'VOCAB'
        ? mc.score
        : scores.reduce((sum, part) => sum + part, 0) / scores.length;
    const now = new Date();
    if (mc.correctLemmas.length)
      await applyReviewOutcome(session.courseId, mc.correctLemmas, [], 1, 0, now, tx);
    if (mc.incorrectLemmas.length)
      await applyReviewOutcome(session.courseId, mc.incorrectLemmas, [], 0, 0, now, tx);
    const assessed = new Set([...mc.correctLemmas, ...mc.incorrectLemmas]);
    const readingReviewed = await reviewReadingVocabulary(
      tx,
      session.courseId,
      session.readingVocabulary,
      new Map(items.map((item) => [item.id, submitted.get(item.id) === item.correctIndex])),
      now
    );
    for (const lemma of readingReviewed) assessed.add(lemma);
    const aggregateVocab = session.readingVocabulary
      ? []
      : session.vocabLemmas.filter((lemma) => !assessed.has(lemma));
    if (aggregateVocab.length || session.grammarKeys.length)
      await applyReviewOutcome(
        session.courseId,
        aggregateVocab,
        session.grammarKeys,
        work.find((section) => section.skill === 'READING')?.score ?? score,
        work.find((section) => section.skill === 'GRAMMAR')?.score ?? score,
        now,
        tx
      );
    await markFocusTargetsPracticed(session.courseId, session.focusTargetIds, score, now, tx);
    const result: SubmitPracticeResult = {
      score,
      correct: mc.correct,
      total: mc.total + session.prompts.length + session.writingPrompts.length,
      answered: mc.total,
      graded: oralGrades.length + writingGrades.length,
      writingFeedback: session.writingPrompts.map((prompt) => {
        const latest = prompt.responses[0]!;
        return {
          promptId: prompt.id,
          task: prompt.task,
          grade: {
            text: latest.text,
            overallScore: latest.overallScore!,
            corrections: latest.corrections as Array<{ old: string; new: string; why: string }>,
            feedback: latest.feedback ?? '',
          },
        };
      }),
      speakingFeedback: session.prompts.map((prompt) => {
        const latest = prompt.recordings[0]!;
        return {
          promptId: prompt.id,
          targetPhrase: prompt.targetPhrase,
          evidence: {
            recordingId: latest.id,
            status: latest.status,
            transcript: latest.transcript,
            overallScore: latest.overallScore,
            feedback: latest.feedback,
            rubricScores: latest.rubricScores as {
              accuracy?: number;
              completeness?: number;
              fluency?: number;
            } | null,
          },
        };
      }),
      itemFeedback: items.map((item) => {
        const selectedIndex = submitted.get(item.id)!;
        return {
          itemId: item.id,
          prompt: item.prompt,
          selectedIndex,
          correctIndex: item.correctIndex,
          selectedAnswer: item.options[selectedIndex]!,
          correctAnswer: item.options[item.correctIndex]!,
          correct: selectedIndex === item.correctIndex,
          explanation: item.explanation,
        };
      }),
    };
    await tx.practiceSession.update({
      where: { id: sessionId },
      data: {
        status: 'COMPLETED',
        score,
        completedAt: now,
        learnerAnswers: Object.fromEntries(
          answers.map((answer) => [answer.itemId, answer.selectedIndex])
        ),
        submissionResult:
          result as unknown as import('@/generated/prisma/client').Prisma.InputJsonValue,
      },
    });
    return result;
  });
}
