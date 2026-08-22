/**
 * Grading a submitted practice session: multiple-choice scoring and the
 * per-kind submit paths that turn a finished session into SRS updates.
 *
 * Split out of practice-service.ts, which owns building and starting sessions
 * and had reached its length ceiling. The dependency runs one way: the service
 * imports from here.
 */
import { prisma } from '../prisma';
import { applyReviewOutcome } from '../knowledge-graph';
import { markFocusTargetsPracticed } from '../learning-targets';
import type { PracticeMcItem, PracticeAnswer, SubmitPracticeResult } from './types';

interface MultipleChoiceScore {
  correct: number;
  total: number;
  score: number;
  correctLemmas: string[];
  incorrectLemmas: string[];
  sections: Record<string, { correct: number; total: number }>;
}

export function mcSection(itemId: string): string {
  const prefix = itemId.charAt(0);
  return prefix === 'v' || prefix === 'g' || prefix === 'r' || prefix === 'l' ? prefix : 'q';
}

export function scoreMultipleChoice(
  items: PracticeMcItem[],
  answers: PracticeAnswer[]
): MultipleChoiceScore {
  const sections: Record<string, { correct: number; total: number }> = {};
  const answered = new Map(answers.map((answer) => [answer.itemId, answer.selectedIndex]));
  let correct = 0;
  const correctLemmas: string[] = [];
  const incorrectLemmas: string[] = [];

  for (const item of items) {
    const selectedIndex = answered.get(item.id);
    const section = mcSection(item.id);
    sections[section] ??= { correct: 0, total: 0 };
    sections[section].total += 1;
    const ok = selectedIndex === item.correctIndex;
    if (ok) {
      correct += 1;
      sections[section].correct += 1;
    }
    if (item.vocabLemma) (ok ? correctLemmas : incorrectLemmas).push(item.vocabLemma);
  }

  const total = items.length;
  return {
    correct,
    total,
    score: total > 0 ? correct / total : 0,
    correctLemmas,
    incorrectLemmas,
    sections,
  };
}

export async function submitFull(
  sessionId: string,
  courseId: string,
  vocabLemmas: string[],
  grammarKeys: string[],
  focusTargetIds: string[],
  items: PracticeMcItem[],
  answers: PracticeAnswer[],
  now: Date
): Promise<SubmitPracticeResult> {
  const mc = scoreMultipleChoice(items, answers);
  const [speakingScores, responses, speakingTotal, writingTotal] = await Promise.all([
    latestSpeakingScores(sessionId),
    prisma.writingResponse.findMany({
      where: { practiceSessionId: sessionId, overallScore: { not: null } },
      select: { overallScore: true },
    }),
    prisma.speakingPrompt.count({ where: { practiceSessionId: sessionId } }),
    prisma.writingPrompt.count({ where: { practiceSessionId: sessionId } }),
  ]);

  const speakingAvg =
    speakingScores.length > 0
      ? speakingScores.reduce((sum, score) => sum + score, 0) / speakingScores.length
      : null;
  const writingAvg =
    responses.length > 0
      ? responses.reduce((sum, r) => sum + (r.overallScore ?? 0), 0) / responses.length
      : null;
  const scoredParts = [mc.total > 0 ? mc.score : null, speakingAvg, writingAvg].filter(
    (score): score is number => score !== null
  );
  const score =
    scoredParts.length > 0
      ? scoredParts.reduce((sum, part) => sum + part, 0) / scoredParts.length
      : 0;

  if (mc.correctLemmas.length) await applyReviewOutcome(courseId, mc.correctLemmas, [], 1, 0, now);
  if (mc.incorrectLemmas.length)
    await applyReviewOutcome(courseId, mc.incorrectLemmas, [], 0, 0, now);

  const taggedLemmas = new Set([...mc.correctLemmas, ...mc.incorrectLemmas]);
  const aggregateVocab = vocabLemmas.filter((lemma) => !taggedLemmas.has(lemma));
  const grammarSection = mc.sections.g;
  const grammarScore =
    grammarSection && grammarSection.total > 0
      ? grammarSection.correct / grammarSection.total
      : score;
  if (aggregateVocab.length > 0 || grammarKeys.length > 0) {
    await applyReviewOutcome(courseId, aggregateVocab, grammarKeys, score, grammarScore, now);
  }
  await markFocusTargetsPracticed(courseId, focusTargetIds, score, now);

  await prisma.practiceSession.update({
    where: { id: sessionId },
    data: { status: 'COMPLETED', score, completedAt: now },
  });

  return {
    score,
    correct: mc.correct + speakingScores.length + responses.length,
    total: mc.total + speakingTotal + writingTotal,
  };
}

/**
 * Graded speaking scores, one per prompt: the learner's latest attempt.
 *
 * A re-record creates a second SpeakingRecording rather than replacing the
 * first (the audio is kept), so averaging every row would let one prompt
 * outvote the others and skew the session score.
 */
export async function latestSpeakingScores(sessionId: string): Promise<number[]> {
  const recordings = await prisma.speakingRecording.findMany({
    where: { practiceSessionId: sessionId, overallScore: { not: null } },
    orderBy: { createdAt: 'desc' },
    select: { promptId: true, overallScore: true },
  });
  const latest = new Map<string, number>();
  for (const r of recordings) {
    if (!latest.has(r.promptId)) latest.set(r.promptId, r.overallScore ?? 0);
  }
  return [...latest.values()];
}

export async function submitSpeaking(
  sessionId: string,
  courseId: string,
  vocabLemmas: string[],
  focusTargetIds: string[],
  now: Date
): Promise<SubmitPracticeResult> {
  const scores = await latestSpeakingScores(sessionId);
  const graded = scores.length;
  const avg = graded > 0 ? scores.reduce((sum, score) => sum + score, 0) / graded : 0;
  if (vocabLemmas.length > 0) await applyReviewOutcome(courseId, vocabLemmas, [], avg, 0, now);
  await markFocusTargetsPracticed(courseId, focusTargetIds, avg, now);
  await prisma.practiceSession.update({
    where: { id: sessionId },
    data: { status: 'COMPLETED', score: avg, completedAt: now },
  });
  const total = await prisma.speakingPrompt.count({ where: { practiceSessionId: sessionId } });
  return { score: avg, correct: graded, total };
}

export async function submitWriting(
  sessionId: string,
  courseId: string,
  vocabLemmas: string[],
  focusTargetIds: string[],
  now: Date
): Promise<SubmitPracticeResult> {
  const responses = await prisma.writingResponse.findMany({
    where: { practiceSessionId: sessionId, overallScore: { not: null } },
    select: { overallScore: true },
  });
  const graded = responses.length;
  const avg = graded > 0 ? responses.reduce((s, r) => s + (r.overallScore ?? 0), 0) / graded : 0;
  if (vocabLemmas.length > 0) await applyReviewOutcome(courseId, vocabLemmas, [], avg, 0, now);
  await markFocusTargetsPracticed(courseId, focusTargetIds, avg, now);
  await prisma.practiceSession.update({
    where: { id: sessionId },
    data: { status: 'COMPLETED', score: avg, completedAt: now },
  });
  const total = await prisma.writingPrompt.count({ where: { practiceSessionId: sessionId } });
  return { score: avg, correct: graded, total };
}
