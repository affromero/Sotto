// Ungated, single-skill practice within a course. Distinct from the gated
// CourseClass: short, repeatable, and only consolidates the memory graph via
// spaced-repetition (SM-2). Grounded in retrieval practice + spacing +
// interleaving — practice selects due-or-weak items and updates their SRS state.
import { Prisma } from '@/generated/prisma/client';
import { prisma } from './prisma';
import { getDueItems, applyReviewOutcome } from './knowledge-graph';
import { generateSectionQuestions } from './class-generation';
import { composeListeningContent } from './class-listening-generator';
import { composeSpeakingPrompts } from './class-speaking-generator';
import { composeWritingPrompts } from './class-writing-generator';
import { getCourseNote } from './course-notes';
import { buildLearnerContext } from './pedagogy';
import {
  getPracticeFocusTargets,
  markFocusTargetsPracticed,
  type FocusPracticeTarget,
} from './learning-targets';
import { logger } from './logger';
import type { CefrLevel, PracticeKind, SkillType, PedagogyStyle } from '@sotto/shared';

const MC_COUNT = 6;
const VOCAB_COUNT = 12;
const FULL_VOCAB_COUNT = 5;
const FULL_DUE_COUNT = 12;
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
  focusTargetId: string | null;
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

export interface PracticeWritingItem {
  id: string;
  task: string;
  guidance: string | null;
}

export type StartPracticeResult =
  | { status: 'unavailable'; reason: 'not_enough_vocab' | 'nothing_due' | 'no_content' }
  | {
      status: 'ready';
      sessionId: string;
      kind: PracticeKind;
      items: PracticeMcItemPublic[];
      episodeId?: string;
    }
  | { status: 'ready_speaking'; sessionId: string; prompts: PracticeSpeakingItem[] }
  | { status: 'ready_writing'; sessionId: string; prompts: PracticeWritingItem[] }
  | {
      status: 'ready_full';
      sessionId: string;
      kind: 'FULL';
      items: PracticeMcItemPublic[];
      episodeId?: string;
      speakingPrompts: PracticeSpeakingItem[];
      writingPrompts: PracticeWritingItem[];
    };

export interface PracticeAnswer {
  itemId: string;
  selectedIndex: number;
}

export interface SubmitPracticeResult {
  score: number;
  correct: number;
  total: number;
}

export interface StartPracticeOptions {
  focusTargetId?: string | null;
}

interface MultipleChoiceScore {
  correct: number;
  total: number;
  score: number;
  correctLemmas: string[];
  incorrectLemmas: string[];
  sections: Record<string, { correct: number; total: number }>;
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

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.filter((value) => value.trim() !== ''))];
}

function uniqueVocab(
  values: Array<{ lemma: string; gloss: string }>
): Array<{ lemma: string; gloss: string }> {
  const seen = new Set<string>();
  const out: Array<{ lemma: string; gloss: string }> = [];
  for (const value of values) {
    const key = value.lemma.trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(value);
  }
  return out;
}

function blankTargetInContext(context: string | null, text: string): string | null {
  if (!context) return null;
  const haystack = context.toLowerCase();
  const needle = text.toLowerCase();
  const idx = haystack.indexOf(needle);
  if (idx < 0) return null;
  return `${context.slice(0, idx)}_____ ${context.slice(idx + text.length)}`
    .replace(/\s+/g, ' ')
    .trim();
}

function buildFocusItems(
  focusTargets: FocusPracticeTarget[],
  idPrefix: string,
  distractorPool: string[]
): PracticeMcItem[] {
  const allDistractors = uniqueStrings([
    ...focusTargets.map((target) => target.text),
    ...distractorPool,
  ]);

  return focusTargets.flatMap((target, index) => {
    const distractors = sample(
      allDistractors.filter((value) => value.toLowerCase() !== target.text.toLowerCase()),
      VOCAB_CHOICES - 1
    );
    const options = shuffle(uniqueStrings([target.text, ...distractors])).slice(0, VOCAB_CHOICES);
    if (options.length < 2) return [];

    const cloze = blankTargetInContext(target.contextText, target.text);
    const prompt =
      cloze && target.kind !== 'SENTENCE'
        ? `Complete the sentence: ${cloze}`
        : target.contextText
          ? `Choose the marked expression from this context: ${target.contextText}`
          : 'Choose the learner-marked expression to practice.';

    return [
      {
        id: `${idPrefix}${index}`,
        prompt,
        options,
        correctIndex: options.indexOf(target.text),
        explanation:
          target.kind === 'SENTENCE'
            ? 'This sentence was marked as difficult and is kept in the practice rotation.'
            : `Keep using "${target.text}" in context until it stops needing support.`,
        vocabLemma: target.kind === 'SENTENCE' ? null : target.text,
        focusTargetId: target.id,
      },
    ];
  });
}

function mcSection(itemId: string): string {
  const prefix = itemId.charAt(0);
  return prefix === 'v' || prefix === 'g' || prefix === 'r' || prefix === 'l' ? prefix : 'q';
}

function scoreMultipleChoice(
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

interface CourseCtx {
  id: string;
  userId: string;
  nativeLang: string;
  targetLang: string;
  currentLevel: CefrLevel;
  curriculumId: string;
  pedagogy: PedagogyStyle;
}

async function loadCourse(courseId: string, userId: string): Promise<CourseCtx> {
  const course = await prisma.course.findFirst({
    where: { id: courseId, userId },
    select: {
      id: true,
      userId: true,
      nativeLang: true,
      targetLang: true,
      currentLevel: true,
      curriculumId: true,
      pedagogy: true,
    },
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
  due: Awaited<ReturnType<typeof getDueItems>>
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
  const lessonGrammar = (
    Array.isArray(lesson.grammarPoints) ? lesson.grammarPoints : []
  ) as string[];
  if (lessonGrammar.length === 0 && lessonVocab.length === 0) return null;
  return { objective: lesson.objective, grammarPoints: lessonGrammar, targetVocab: lessonVocab };
}

function focusSeedFallback(focusTargets: FocusPracticeTarget[]): PracticeSeed | null {
  if (focusTargets.length === 0) return null;
  return {
    objective: 'Practice learner-marked difficult material from previous classes.',
    grammarPoints: [],
    targetVocab: [],
  };
}

function applyFocusToSeed(seed: PracticeSeed, focusTargets: FocusPracticeTarget[]): PracticeSeed {
  if (focusTargets.length === 0) return seed;
  const focusVocab = focusTargets.map((target) => ({
    lemma: target.text,
    gloss: target.contextText ?? '',
  }));
  const focusText = focusTargets.map((target) => target.text).join('; ');
  return {
    objective: `${seed.objective} Prioritize learner-marked difficult material: ${focusText}.`,
    grammarPoints: seed.grammarPoints,
    targetVocab: uniqueVocab([...focusVocab, ...seed.targetVocab]),
  };
}

export async function startPractice(
  courseId: string,
  userId: string,
  kind: PracticeKind,
  options: StartPracticeOptions = {}
): Promise<StartPracticeResult> {
  const course = await loadCourse(courseId, userId);
  const seedToken = `${courseId}-${kind}-${Date.now()}`;
  const focusTargets = await getPracticeFocusTargets(
    courseId,
    kind === 'FULL' ? 4 : 2,
    options.focusTargetId ?? null
  );

  if (kind === 'VOCAB') return startVocab(course, seedToken, focusTargets);

  const note = buildLearnerContext(await getCourseNote(courseId), course.pedagogy);
  const due = await getDueItems(courseId, kind === 'FULL' ? FULL_DUE_COUNT : MC_COUNT);
  const baseSeed = (await resolveSeed(course, due)) ?? focusSeedFallback(focusTargets);
  if (!baseSeed) return { status: 'unavailable', reason: 'no_content' };
  const seed = applyFocusToSeed(baseSeed, focusTargets);

  if (kind === 'FULL') return startFull(course, seed, seedToken, note, focusTargets);
  if (kind === 'GRAMMAR' || kind === 'READING') {
    return startMc(course, kind, seed, seedToken, note, focusTargets);
  }
  if (kind === 'LISTENING') return startListening(course, seed, seedToken, note, focusTargets);
  if (kind === 'SPEAKING') return startSpeaking(course, seed, seedToken, note, focusTargets);
  return startWriting(course, seed, seedToken, note, focusTargets);
}

type VocabPracticeBuild =
  | { status: 'ready'; items: PracticeMcItem[]; lemmas: string[] }
  | { status: 'unavailable'; reason: 'not_enough_vocab' | 'nothing_due' };

async function buildVocabItems(
  course: CourseCtx,
  count: number,
  idPrefix: string
): Promise<VocabPracticeBuild> {
  const totalVocab = await prisma.learnerVocab.count({ where: { courseId: course.id } });
  if (totalVocab < MIN_VOCAB) return { status: 'unavailable', reason: 'not_enough_vocab' };

  const due = await getDueItems(course.id, count);
  let review = due.vocab;
  if (review.length === 0) {
    // Everything mastered + not yet due: refresh the weakest items.
    review = await prisma.learnerVocab.findMany({
      where: { courseId: course.id },
      orderBy: { mastery: 'asc' },
      take: count,
      select: { id: true, lemma: true, translation: true, mastery: true },
    });
  }
  if (review.length === 0) return { status: 'unavailable', reason: 'nothing_due' };

  // Distractor pool: other course lemmas, padded from curriculum vocab on cold start.
  const pool = new Set(
    (
      await prisma.learnerVocab.findMany({
        where: { courseId: course.id },
        select: { lemma: true },
        take: 300,
      })
    ).map((v) => v.lemma)
  );
  if (pool.size < VOCAB_CHOICES) {
    const lessons = await prisma.lesson.findMany({
      where: { curriculumId: course.curriculumId },
      select: { targetVocab: true },
    });
    for (const l of lessons) {
      for (const tv of (Array.isArray(l.targetVocab) ? l.targetVocab : []) as Array<{
        lemma: string;
      }>) {
        if (tv?.lemma) pool.add(tv.lemma);
      }
    }
  }

  const items: PracticeMcItem[] = shuffle(review).map((v, i) => {
    const distractors = sample(
      [...pool].filter((l) => l !== v.lemma),
      VOCAB_CHOICES - 1
    );
    const options = shuffle([v.lemma, ...distractors]);
    return {
      id: `${idPrefix}${i}`,
      prompt: v.translation,
      options,
      correctIndex: options.indexOf(v.lemma),
      explanation: `"${v.lemma}" means "${v.translation}".`,
      vocabLemma: v.lemma,
      focusTargetId: null,
    };
  });

  return { status: 'ready', items, lemmas: review.map((v) => v.lemma) };
}

async function startVocab(
  course: CourseCtx,
  seedToken: string,
  focusTargets: FocusPracticeTarget[]
): Promise<StartPracticeResult> {
  const built = await buildVocabItems(course, VOCAB_COUNT, 'v');
  const focusItems = buildFocusItems(
    focusTargets.filter((target) => target.kind !== 'SENTENCE'),
    'f',
    built.status === 'ready' ? built.lemmas : []
  );
  if (built.status === 'unavailable' && focusItems.length === 0) return built;
  const items = built.status === 'ready' ? [...focusItems, ...built.items] : focusItems;
  const lemmas = uniqueStrings([
    ...(built.status === 'ready' ? built.lemmas : []),
    ...focusTargets.filter((target) => target.kind !== 'SENTENCE').map((target) => target.text),
  ]);

  const session = await prisma.practiceSession.create({
    data: {
      courseId: course.id,
      kind: 'VOCAB',
      items: items as unknown as Prisma.InputJsonValue,
      seed: seedToken,
      vocabLemmas: lemmas,
      grammarKeys: [],
      focusTargetIds: focusTargets.map((target) => target.id),
    },
  });
  return {
    status: 'ready',
    sessionId: session.id,
    kind: 'VOCAB',
    items: items.map(toPublic),
  };
}

async function startMc(
  course: CourseCtx,
  kind: 'GRAMMAR' | 'READING',
  seed: PracticeSeed,
  seedToken: string,
  note: string,
  focusTargets: FocusPracticeTarget[]
): Promise<StartPracticeResult> {
  const generatedItems = await buildSectionMcItems(course, kind, seed, seedToken, note, 'q');
  const focusItems = buildFocusItems(
    focusTargets,
    'f',
    seed.targetVocab.map((v) => v.lemma)
  );
  const items = [...focusItems, ...generatedItems];
  const session = await prisma.practiceSession.create({
    data: {
      courseId: course.id,
      kind,
      items: items as unknown as Prisma.InputJsonValue,
      seed: seedToken,
      vocabLemmas: seed.targetVocab.map((v) => v.lemma),
      grammarKeys: seed.grammarPoints,
      focusTargetIds: focusTargets.map((target) => target.id),
    },
  });
  return { status: 'ready', sessionId: session.id, kind, items: items.map(toPublic) };
}

async function buildSectionMcItems(
  course: CourseCtx,
  kind: 'GRAMMAR' | 'READING',
  seed: PracticeSeed,
  seedToken: string,
  note: string,
  idPrefix: string
): Promise<PracticeMcItem[]> {
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
    note,
  });
  return questions.map((q, i) => ({
    id: `${idPrefix}${i}`,
    prompt: q.question,
    options: q.options,
    correctIndex: q.correctIndex,
    explanation: q.explanation,
    vocabLemma: null,
    focusTargetId: null,
  }));
}

async function startFull(
  course: CourseCtx,
  seed: PracticeSeed,
  seedToken: string,
  note: string,
  focusTargets: FocusPracticeTarget[]
): Promise<StartPracticeResult> {
  const vocab = await buildVocabItems(course, FULL_VOCAB_COUNT, 'v');
  const vocabItems = vocab.status === 'ready' ? vocab.items : [];
  const vocabLemmas = vocab.status === 'ready' ? vocab.lemmas : [];
  const focusItems = buildFocusItems(
    focusTargets,
    'f',
    uniqueStrings([...vocabLemmas, ...seed.targetVocab.map((v) => v.lemma)])
  );

  // Listening (which includes reference verification and can fail the whole
  // build) runs BEFORE the speaking prompts: speaking is the only section that
  // spends TTS credits up front, so it must not start until verification has
  // passed. The LLM-only sections stay parallel with listening.
  const [grammarItems, readingItems, listening, writingComposed] = await Promise.all([
    buildSectionMcItems(course, 'GRAMMAR', seed, `${seedToken}-grammar`, note, 'g'),
    buildSectionMcItems(course, 'READING', seed, `${seedToken}-reading`, note, 'r'),
    composeListeningContent({
      userId: course.userId,
      courseId: course.id,
      level: course.currentLevel,
      nativeLang: course.nativeLang,
      targetLang: course.targetLang,
      objective: seed.objective,
      mustIncludeVocab: seed.targetVocab.map((v) => ({ word: v.lemma, translation: v.gloss })),
      note,
    }),
    composeWritingPrompts({
      userId: course.userId,
      level: course.currentLevel,
      nativeLang: course.nativeLang,
      targetLang: course.targetLang,
      objective: seed.objective,
      targetVocab: seed.targetVocab,
      note,
    }),
  ]);

  const speakingComposed = await composeSpeakingPrompts({
    userId: course.userId,
    level: course.currentLevel,
    nativeLang: course.nativeLang,
    targetLang: course.targetLang,
    objective: seed.objective,
    targetVocab: seed.targetVocab,
    refId: seedToken,
    note,
  });

  const listeningItems: PracticeMcItem[] = listening.comprehensionQuestions.map((q, i) => ({
    id: `l${i}`,
    prompt: q.question,
    options: q.options,
    correctIndex: q.correctIndex,
    explanation: q.explanation,
    vocabLemma: null,
    focusTargetId: null,
  }));
  const items = [...focusItems, ...vocabItems, ...grammarItems, ...readingItems, ...listeningItems];
  if (items.length === 0 && speakingComposed.length === 0 && writingComposed.length === 0) {
    return { status: 'unavailable', reason: 'no_content' };
  }

  const session = await prisma.practiceSession.create({
    data: {
      courseId: course.id,
      kind: 'FULL',
      items: items as unknown as Prisma.InputJsonValue,
      seed: seedToken,
      vocabLemmas: uniqueStrings([...vocabLemmas, ...seed.targetVocab.map((v) => v.lemma)]),
      grammarKeys: seed.grammarPoints,
      episodeId: listening.episodeId,
      focusTargetIds: focusTargets.map((target) => target.id),
    },
  });

  await Promise.all([
    prisma.speakingPrompt.createMany({
      data: speakingComposed.map((c, i) => ({
        practiceSessionId: session.id,
        order: i + 1,
        targetPhrase: c.targetPhrase,
        translation: c.translation,
        ipa: c.ipa,
        referenceTtsUrl: c.referenceTtsUrl,
      })),
    }),
    prisma.writingPrompt.createMany({
      data: writingComposed.map((c, i) => ({
        practiceSessionId: session.id,
        order: i + 1,
        task: c.task,
        guidance: c.guidance,
      })),
    }),
  ]);

  const [speakingPrompts, writingPrompts] = await Promise.all([
    prisma.speakingPrompt.findMany({
      where: { practiceSessionId: session.id },
      orderBy: { order: 'asc' },
      select: { id: true, targetPhrase: true, translation: true, referenceTtsUrl: true },
    }),
    prisma.writingPrompt.findMany({
      where: { practiceSessionId: session.id },
      orderBy: { order: 'asc' },
      select: { id: true, task: true, guidance: true },
    }),
  ]);

  logger.info('Full practice generated', {
    sessionId: session.id,
    itemCount: String(items.length),
    speakingCount: String(speakingPrompts.length),
    writingCount: String(writingPrompts.length),
  });
  return {
    status: 'ready_full',
    sessionId: session.id,
    kind: 'FULL',
    items: items.map(toPublic),
    episodeId: listening.episodeId,
    speakingPrompts,
    writingPrompts,
  };
}

async function startListening(
  course: CourseCtx,
  seed: PracticeSeed,
  seedToken: string,
  note: string,
  focusTargets: FocusPracticeTarget[]
): Promise<StartPracticeResult> {
  const { episodeId, comprehensionQuestions } = await composeListeningContent({
    userId: course.userId,
    courseId: course.id,
    level: course.currentLevel,
    nativeLang: course.nativeLang,
    targetLang: course.targetLang,
    objective: seed.objective,
    mustIncludeVocab: seed.targetVocab.map((v) => ({ word: v.lemma, translation: v.gloss })),
    note,
  });
  const items: PracticeMcItem[] = comprehensionQuestions.map((q, i) => ({
    id: `l${i}`,
    prompt: q.question,
    options: q.options,
    correctIndex: q.correctIndex,
    explanation: q.explanation,
    vocabLemma: null,
    focusTargetId: null,
  }));
  const focusItems = buildFocusItems(
    focusTargets,
    'f',
    seed.targetVocab.map((v) => v.lemma)
  );
  const allItems = [...focusItems, ...items];
  const session = await prisma.practiceSession.create({
    data: {
      courseId: course.id,
      kind: 'LISTENING',
      items: allItems as unknown as Prisma.InputJsonValue,
      seed: seedToken,
      vocabLemmas: seed.targetVocab.map((v) => v.lemma),
      grammarKeys: [],
      episodeId,
      focusTargetIds: focusTargets.map((target) => target.id),
    },
  });
  return {
    status: 'ready',
    sessionId: session.id,
    kind: 'LISTENING',
    items: allItems.map(toPublic),
    episodeId,
  };
}

async function startSpeaking(
  course: CourseCtx,
  seed: PracticeSeed,
  seedToken: string,
  note: string,
  focusTargets: FocusPracticeTarget[]
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
      focusTargetIds: focusTargets.map((target) => target.id),
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
    note,
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

  logger.info('Speaking practice generated', {
    sessionId: session.id,
    promptCount: String(prompts.length),
  });
  return { status: 'ready_speaking', sessionId: session.id, prompts };
}

async function startWriting(
  course: CourseCtx,
  seed: PracticeSeed,
  seedToken: string,
  note: string,
  focusTargets: FocusPracticeTarget[]
): Promise<StartPracticeResult> {
  // Writing prompts hang off the session, so create it first.
  const session = await prisma.practiceSession.create({
    data: {
      courseId: course.id,
      kind: 'WRITING',
      items: [] as unknown as Prisma.InputJsonValue,
      seed: seedToken,
      vocabLemmas: seed.targetVocab.map((v) => v.lemma),
      grammarKeys: [],
      focusTargetIds: focusTargets.map((target) => target.id),
    },
  });

  const composed = await composeWritingPrompts({
    userId: course.userId,
    level: course.currentLevel,
    nativeLang: course.nativeLang,
    targetLang: course.targetLang,
    objective: seed.objective,
    targetVocab: seed.targetVocab,
    note,
  });

  await prisma.writingPrompt.createMany({
    data: composed.map((c, i) => ({
      practiceSessionId: session.id,
      order: i + 1,
      task: c.task,
      guidance: c.guidance,
    })),
  });

  const prompts = await prisma.writingPrompt.findMany({
    where: { practiceSessionId: session.id },
    orderBy: { order: 'asc' },
    select: { id: true, task: true, guidance: true },
  });

  logger.info('Writing practice generated', {
    sessionId: session.id,
    promptCount: String(prompts.length),
  });
  return { status: 'ready_writing', sessionId: session.id, prompts };
}

export async function submitPractice(
  sessionId: string,
  userId: string,
  answers: PracticeAnswer[]
): Promise<SubmitPracticeResult> {
  const session = await prisma.practiceSession.findFirst({
    where: { id: sessionId, course: { userId } },
  });
  if (!session) throw new PracticeSessionNotFoundError('Practice session not found');

  const now = new Date();
  if (session.kind === 'SPEAKING') {
    return submitSpeaking(
      session.id,
      session.courseId,
      session.vocabLemmas,
      session.focusTargetIds ?? [],
      now
    );
  }
  if (session.kind === 'WRITING') {
    return submitWriting(
      session.id,
      session.courseId,
      session.vocabLemmas,
      session.focusTargetIds ?? [],
      now
    );
  }

  const items = (session.items as unknown as PracticeMcItem[]) ?? [];
  if (session.kind === 'FULL') {
    return submitFull(
      session.id,
      session.courseId,
      session.vocabLemmas,
      session.grammarKeys,
      session.focusTargetIds ?? [],
      items,
      answers,
      now
    );
  }

  const mc = scoreMultipleChoice(items, answers);

  if (session.kind === 'VOCAB') {
    // Per-item SRS: each lemma gets a quality from its own answer.
    if (mc.correctLemmas.length)
      await applyReviewOutcome(session.courseId, mc.correctLemmas, [], 1, 0, now);
    if (mc.incorrectLemmas.length)
      await applyReviewOutcome(session.courseId, mc.incorrectLemmas, [], 0, 0, now);
  } else {
    // Aggregate score across the session's due items (questions aren't per-item tagged).
    await applyReviewOutcome(
      session.courseId,
      session.vocabLemmas,
      session.grammarKeys,
      mc.score,
      mc.score,
      now
    );
  }
  await markFocusTargetsPracticed(session.courseId, session.focusTargetIds ?? [], mc.score, now);

  await prisma.practiceSession.update({
    where: { id: sessionId },
    data: { status: 'COMPLETED', score: mc.score, completedAt: now },
  });
  return { score: mc.score, correct: mc.correct, total: mc.total };
}

async function submitFull(
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
  const [recordings, responses, speakingTotal, writingTotal] = await Promise.all([
    prisma.speakingRecording.findMany({
      where: { practiceSessionId: sessionId, overallScore: { not: null } },
      select: { overallScore: true },
    }),
    prisma.writingResponse.findMany({
      where: { practiceSessionId: sessionId, overallScore: { not: null } },
      select: { overallScore: true },
    }),
    prisma.speakingPrompt.count({ where: { practiceSessionId: sessionId } }),
    prisma.writingPrompt.count({ where: { practiceSessionId: sessionId } }),
  ]);

  const speakingAvg =
    recordings.length > 0
      ? recordings.reduce((sum, r) => sum + (r.overallScore ?? 0), 0) / recordings.length
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
    correct: mc.correct + recordings.length + responses.length,
    total: mc.total + speakingTotal + writingTotal,
  };
}

async function submitSpeaking(
  sessionId: string,
  courseId: string,
  vocabLemmas: string[],
  focusTargetIds: string[],
  now: Date
): Promise<SubmitPracticeResult> {
  const recordings = await prisma.speakingRecording.findMany({
    where: { practiceSessionId: sessionId, overallScore: { not: null } },
    select: { overallScore: true },
  });
  const graded = recordings.length;
  const avg = graded > 0 ? recordings.reduce((s, r) => s + (r.overallScore ?? 0), 0) / graded : 0;
  if (vocabLemmas.length > 0) await applyReviewOutcome(courseId, vocabLemmas, [], avg, 0, now);
  await markFocusTargetsPracticed(courseId, focusTargetIds, avg, now);
  await prisma.practiceSession.update({
    where: { id: sessionId },
    data: { status: 'COMPLETED', score: avg, completedAt: now },
  });
  const total = await prisma.speakingPrompt.count({ where: { practiceSessionId: sessionId } });
  return { score: avg, correct: graded, total };
}

async function submitWriting(
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
