// Ungated, single-skill practice within a course. Distinct from the gated
// CourseClass: short, repeatable, and only consolidates the memory graph via
// spaced-repetition (SM-2). Grounded in retrieval practice + spacing +
// interleaving — practice selects due-or-weak items and updates their SRS state.
import { Prisma } from '@prisma/client';
import { prisma } from './prisma';
import { getDueItems, applyReviewOutcome } from './knowledge-graph';
import { generateSectionQuestions } from './class-generation';
import { composeListeningContent } from './class-listening-generator';
import { composeSpeakingPrompts } from './class-speaking-generator';
import { logger } from './logger';
import type { CefrLevel, PracticeKind, SkillType } from '@sotto/shared';

const MC_COUNT = 6;
const VOCAB_COUNT = 12;
const MIN_VOCAB = 2;
const VOCAB_CHOICES = 4;

export class PracticeCourseNotFoundError extends Error {}
export class PracticeSessionNotFoundError extends Error {}

// Stored item shape (full — includes the answer). The public projection drops it.
interface PracticeMcItem {
  id: string;
  prompt: string;
  options: string[];
  correctIndex: number;
  explanation: string;
  vocabLemma: string | null;
}

export interface PracticeMcItemPublic {
  id: string;
  prompt: string;
  options: string[];
}

export interface PracticeSpeakingItem {
  id: string;
  targetPhrase: string;
  translation: string;
  referenceTtsUrl: string | null;
}

export type StartPracticeResult =
  | { status: 'unavailable'; reason: 'not_enough_vocab' | 'nothing_due' | 'no_content' }
  | { status: 'ready'; sessionId: string; kind: PracticeKind; items: PracticeMcItemPublic[]; podcastId?: string }
  | { status: 'ready_speaking'; sessionId: string; prompts: PracticeSpeakingItem[] };

export interface PracticeAnswer {
  itemId: string;
  selectedIndex: number;
}

export interface SubmitPracticeResult {
  score: number;
  correct: number;
  total: number;
}

function toPublic(it: PracticeMcItem): PracticeMcItemPublic {
  return { id: it.id, prompt: it.prompt, options: it.options };
}

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function sample<T>(arr: T[], n: number): T[] {
  return shuffle(arr).slice(0, n);
}

interface CourseCtx {
  id: string;
  userId: string;
  nativeLang: string;
  targetLang: string;
  currentLevel: CefrLevel;
  curriculumId: string;
}

async function loadCourse(courseId: string, userId: string): Promise<CourseCtx> {
  const course = await prisma.course.findFirst({
    where: { id: courseId, userId },
    select: { id: true, userId: true, nativeLang: true, targetLang: true, currentLevel: true, curriculumId: true },
  });
  if (!course) throw new PracticeCourseNotFoundError('Course not found');
  return course;
}

interface PracticeSeed {
  objective: string;
  grammarPoints: string[];
  targetVocab: Array<{ lemma: string; gloss: string }>;
}

// Build the content seed: prefer due/weak items; fall back to a current-level
// curriculum lesson so the learner can still practice their level's material.
async function resolveSeed(
  course: CourseCtx,
  due: Awaited<ReturnType<typeof getDueItems>>,
): Promise<PracticeSeed | null> {
  const grammarPoints = due.grammar.map((g) => g.topicKey);
  const targetVocab = due.vocab.map((v) => ({ lemma: v.lemma, gloss: v.translation }));
  if (grammarPoints.length > 0 || targetVocab.length > 0) {
    return { objective: 'Review what is due for spaced repetition.', grammarPoints, targetVocab };
  }

  const lesson = await prisma.lesson.findFirst({
    where: { curriculumId: course.curriculumId, level: course.currentLevel },
    orderBy: { order: 'asc' },
    select: { objective: true, grammarPoints: true, targetVocab: true },
  });
  if (!lesson) return null;
  const lessonVocab = (Array.isArray(lesson.targetVocab) ? lesson.targetVocab : []) as Array<{
    lemma: string;
    gloss: string;
  }>;
  const lessonGrammar = (Array.isArray(lesson.grammarPoints) ? lesson.grammarPoints : []) as string[];
  if (lessonGrammar.length === 0 && lessonVocab.length === 0) return null;
  return { objective: lesson.objective, grammarPoints: lessonGrammar, targetVocab: lessonVocab };
}

export async function startPractice(
  courseId: string,
  userId: string,
  kind: PracticeKind,
): Promise<StartPracticeResult> {
  const course = await loadCourse(courseId, userId);
  const seedToken = `${courseId}-${kind}-${Date.now()}`;

  if (kind === 'VOCAB') return startVocab(course, seedToken);

  const due = await getDueItems(courseId, MC_COUNT);
  const seed = await resolveSeed(course, due);
  if (!seed) return { status: 'unavailable', reason: 'no_content' };

  if (kind === 'GRAMMAR' || kind === 'READING') {
    return startMc(course, kind, seed, seedToken);
  }
  if (kind === 'LISTENING') return startListening(course, seed, seedToken);
  return startSpeaking(course, seed, seedToken);
}

async function startVocab(course: CourseCtx, seedToken: string): Promise<StartPracticeResult> {
  const totalVocab = await prisma.learnerVocab.count({ where: { courseId: course.id } });
  if (totalVocab < MIN_VOCAB) return { status: 'unavailable', reason: 'not_enough_vocab' };

  const due = await getDueItems(course.id, VOCAB_COUNT);
  let review = due.vocab;
  if (review.length === 0) {
    // Everything mastered + not yet due: refresh the weakest items.
    review = await prisma.learnerVocab.findMany({
      where: { courseId: course.id },
      orderBy: { mastery: 'asc' },
      take: VOCAB_COUNT,
      select: { id: true, lemma: true, translation: true, mastery: true },
    });
  }
  if (review.length === 0) return { status: 'unavailable', reason: 'nothing_due' };

  // Distractor pool: other course lemmas, padded from curriculum vocab on cold start.
  const pool = new Set(
    (await prisma.learnerVocab.findMany({ where: { courseId: course.id }, select: { lemma: true }, take: 300 })).map(
      (v) => v.lemma,
    ),
  );
  if (pool.size < VOCAB_CHOICES) {
    const lessons = await prisma.lesson.findMany({
      where: { curriculumId: course.curriculumId },
      select: { targetVocab: true },
    });
    for (const l of lessons) {
      for (const tv of (Array.isArray(l.targetVocab) ? l.targetVocab : []) as Array<{ lemma: string }>) {
        if (tv?.lemma) pool.add(tv.lemma);
      }
    }
  }

  const items: PracticeMcItem[] = shuffle(review).map((v, i) => {
    const distractors = sample(
      [...pool].filter((l) => l !== v.lemma),
      VOCAB_CHOICES - 1,
    );
    const options = shuffle([v.lemma, ...distractors]);
    return {
      id: `v${i}`,
      prompt: v.translation,
      options,
      correctIndex: options.indexOf(v.lemma),
      explanation: `"${v.lemma}" means "${v.translation}".`,
      vocabLemma: v.lemma,
    };
  });

  const session = await prisma.practiceSession.create({
    data: {
      courseId: course.id,
      kind: 'VOCAB',
      items: items as unknown as Prisma.InputJsonValue,
      seed: seedToken,
      vocabLemmas: review.map((v) => v.lemma),
      grammarKeys: [],
    },
  });
  return { status: 'ready', sessionId: session.id, kind: 'VOCAB', items: items.map(toPublic) };
}

async function startMc(
  course: CourseCtx,
  kind: 'GRAMMAR' | 'READING',
  seed: PracticeSeed,
  seedToken: string,
): Promise<StartPracticeResult> {
  const questions = await generateSectionQuestions({
    userId: course.userId,
    skill: kind as SkillType,
    level: course.currentLevel,
    nativeLang: course.nativeLang,
    targetLang: course.targetLang,
    objective: seed.objective,
    grammarPoints: seed.grammarPoints,
    targetVocab: seed.targetVocab,
    seed: seedToken,
  });
  const items: PracticeMcItem[] = questions.map((q, i) => ({
    id: `q${i}`,
    prompt: q.question,
    options: q.options,
    correctIndex: q.correctIndex,
    explanation: q.explanation,
    vocabLemma: null,
  }));
  const session = await prisma.practiceSession.create({
    data: {
      courseId: course.id,
      kind,
      items: items as unknown as Prisma.InputJsonValue,
      seed: seedToken,
      vocabLemmas: seed.targetVocab.map((v) => v.lemma),
      grammarKeys: seed.grammarPoints,
    },
  });
  return { status: 'ready', sessionId: session.id, kind, items: items.map(toPublic) };
}

async function startListening(
  course: CourseCtx,
  seed: PracticeSeed,
  seedToken: string,
): Promise<StartPracticeResult> {
  const { podcastId, comprehensionQuestions } = await composeListeningContent({
    userId: course.userId,
    courseId: course.id,
    level: course.currentLevel,
    nativeLang: course.nativeLang,
    targetLang: course.targetLang,
    objective: seed.objective,
    mustIncludeVocab: seed.targetVocab.map((v) => ({ word: v.lemma, translation: v.gloss })),
  });
  const items: PracticeMcItem[] = comprehensionQuestions.map((q, i) => ({
    id: `l${i}`,
    prompt: q.question,
    options: q.options,
    correctIndex: q.correctIndex,
    explanation: q.explanation,
    vocabLemma: null,
  }));
  const session = await prisma.practiceSession.create({
    data: {
      courseId: course.id,
      kind: 'LISTENING',
      items: items as unknown as Prisma.InputJsonValue,
      seed: seedToken,
      vocabLemmas: seed.targetVocab.map((v) => v.lemma),
      grammarKeys: [],
      podcastId,
    },
  });
  return { status: 'ready', sessionId: session.id, kind: 'LISTENING', items: items.map(toPublic), podcastId };
}

async function startSpeaking(
  course: CourseCtx,
  seed: PracticeSeed,
  seedToken: string,
): Promise<StartPracticeResult> {
  // Speaking prompts hang off the session, so create it first to namespace them.
  const session = await prisma.practiceSession.create({
    data: {
      courseId: course.id,
      kind: 'SPEAKING',
      items: [] as unknown as Prisma.InputJsonValue,
      seed: seedToken,
      vocabLemmas: seed.targetVocab.map((v) => v.lemma),
      grammarKeys: [],
    },
  });

  const composed = await composeSpeakingPrompts({
    userId: course.userId,
    level: course.currentLevel,
    nativeLang: course.nativeLang,
    targetLang: course.targetLang,
    objective: seed.objective,
    targetVocab: seed.targetVocab,
    refId: session.id,
  });

  await prisma.speakingPrompt.createMany({
    data: composed.map((c, i) => ({
      practiceSessionId: session.id,
      order: i + 1,
      targetPhrase: c.targetPhrase,
      translation: c.translation,
      ipa: c.ipa,
      referenceTtsUrl: c.referenceTtsUrl,
    })),
  });

  const prompts = await prisma.speakingPrompt.findMany({
    where: { practiceSessionId: session.id },
    orderBy: { order: 'asc' },
    select: { id: true, targetPhrase: true, translation: true, referenceTtsUrl: true },
  });

  logger.info('Speaking practice generated', { sessionId: session.id, promptCount: String(prompts.length) });
  return { status: 'ready_speaking', sessionId: session.id, prompts };
}

export async function submitPractice(
  sessionId: string,
  userId: string,
  answers: PracticeAnswer[],
): Promise<SubmitPracticeResult> {
  const session = await prisma.practiceSession.findFirst({
    where: { id: sessionId, course: { userId } },
  });
  if (!session) throw new PracticeSessionNotFoundError('Practice session not found');

  const now = new Date();
  if (session.kind === 'SPEAKING') {
    return submitSpeaking(session.id, session.courseId, session.vocabLemmas, now);
  }

  const items = (session.items as unknown as PracticeMcItem[]) ?? [];
  const byId = new Map(items.map((it) => [it.id, it]));
  let correct = 0;
  const correctLemmas: string[] = [];
  const incorrectLemmas: string[] = [];
  for (const a of answers) {
    const it = byId.get(a.itemId);
    if (!it) continue;
    const ok = a.selectedIndex === it.correctIndex;
    if (ok) correct++;
    if (it.vocabLemma) (ok ? correctLemmas : incorrectLemmas).push(it.vocabLemma);
  }
  const total = items.length;
  const score = total > 0 ? correct / total : 0;

  if (session.kind === 'VOCAB') {
    // Per-item SRS: each lemma gets a quality from its own answer.
    if (correctLemmas.length) await applyReviewOutcome(session.courseId, correctLemmas, [], 1, 0, now);
    if (incorrectLemmas.length) await applyReviewOutcome(session.courseId, incorrectLemmas, [], 0, 0, now);
  } else {
    // Aggregate score across the session's due items (questions aren't per-item tagged).
    await applyReviewOutcome(session.courseId, session.vocabLemmas, session.grammarKeys, score, score, now);
  }

  await prisma.practiceSession.update({
    where: { id: sessionId },
    data: { status: 'COMPLETED', score, completedAt: now },
  });
  return { score, correct, total };
}

async function submitSpeaking(
  sessionId: string,
  courseId: string,
  vocabLemmas: string[],
  now: Date,
): Promise<SubmitPracticeResult> {
  const recordings = await prisma.speakingRecording.findMany({
    where: { practiceSessionId: sessionId, overallScore: { not: null } },
    select: { overallScore: true },
  });
  const graded = recordings.length;
  const avg = graded > 0 ? recordings.reduce((s, r) => s + (r.overallScore ?? 0), 0) / graded : 0;
  if (vocabLemmas.length > 0) await applyReviewOutcome(courseId, vocabLemmas, [], avg, 0, now);
  await prisma.practiceSession.update({
    where: { id: sessionId },
    data: { status: 'COMPLETED', score: avg, completedAt: now },
  });
  const total = await prisma.speakingPrompt.count({ where: { practiceSessionId: sessionId } });
  return { score: avg, correct: graded, total };
}
