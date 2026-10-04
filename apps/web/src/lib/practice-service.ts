import { learningScriptHash } from './learning/script-hash';
// Ungated focused and FULL practice use due or weak targets for spaced review.
import { Prisma } from '@/generated/prisma/client';
import { prisma } from './prisma';
import { getDueItems, upsertLiveVocab } from './knowledge-graph';
import type {
  PracticeMcItem,
  PracticeMcItemPublic,
  PracticeBuildLifecycle,
  PracticeSpeakingItem,
  PracticeWritingItem,
} from './practice/types';
export type { PracticeMcItemPublic } from './practice/types';
import { generateSectionQuestions } from './class-generation';
import { composeListeningContent, queueListeningAudio } from './class-listening-generator';
import {
  composeSpeakingPrompts,
  publishSpeakingPromptReferences,
} from './class-speaking-generator';
import { composeWritingPrompts } from './class-writing-generator';
import { getCourseNote } from './course-notes';
import { buildLearnerContext } from './pedagogy';
import { getPracticeFocusTargets, type FocusPracticeTarget } from './learning-targets';
import { recordFullPracticeFailures } from './learning/practice-generation-failures';
import { logger } from './logger';
import { PracticeIncompleteError } from './practice/types';
import { resolveSkillRequirements } from './learning/skill-requirements';
import { extractReadingVocabulary } from './learning/reading-vocabulary';
import type {
  CefrLevel,
  PracticeKind,
  SkillType,
  PedagogyStyle,
  SkillRequirements,
} from '@sotto/shared';

const MC_COUNT = 6;
const VOCAB_COUNT = 12;
const FULL_VOCAB_COUNT = 5;
const FULL_DUE_COUNT = 12;
const MIN_VOCAB = 2;

export class PracticeCourseNotFoundError extends Error {}

type StartPracticeContent =
  | import('@sotto/shared').PracticePreparing
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

export type StartPracticeResult = StartPracticeContent & {
  progressRevision?: number;
  skillRequirements?: SkillRequirements;
  learnerAnswers?: Record<string, number>;
  writingDrafts?: Record<string, string>;
  submissionResult?: import('./practice/types').SubmitPracticeResult | null;
};

export interface StartPracticeOptions {
  focusTargetId?: string | null;
  generation?: PracticeGenerationContext;
  lifecycle?: PracticeBuildLifecycle;
}

export interface PracticeGenerationContext {
  course: CourseCtx;
  requirements: SkillRequirements;
  seedToken: string;
  focusTargets: FocusPracticeTarget[];
  note: string;
  seed: PracticeSeed | null;
}

function persistPracticeSession(
  input: { data: Prisma.PracticeSessionUncheckedCreateInput },
  lifecycle?: PracticeBuildLifecycle
) {
  return lifecycle ? lifecycle.populate(input.data) : prisma.practiceSession.create(input);
}

function toPublic(it: PracticeMcItem): PracticeMcItemPublic {
  return {
    id: it.id,
    prompt: it.prompt,
    options: it.options,
    ...(it.passageText ? { passageText: it.passageText } : {}),
  };
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

async function buildFocusItems(
  focusTargets: FocusPracticeTarget[],
  idPrefix: string,
  course: CourseCtx,
  execution: import('@/lib/sidedoor/credentials/runtime/provider-execution').SottoProviderExecution
): Promise<PracticeMcItem[]> {
  const items: PracticeMcItem[] = [];
  for (const target of focusTargets) {
    const questions = await generateSectionQuestions({
      userId: course.userId,
      execution,
      skill: 'GRAMMAR',
      vocabularyReview: true,
      level: course.currentLevel,
      nativeLang: course.nativeLang,
      targetLang: course.targetLang,
      objective: `Use the selected expression in a new sentence or exchange. The supplied context is background, not an answer to copy: ${target.contextText ?? target.text}`,
      grammarPoints: [],
      targetVocab: [{ lemma: target.text, gloss: '' }],
      seed: `${course.id}-focus-${target.id}-${Date.now()}`,
    });
    const question = questions.find(
      (q) =>
        q.options[q.correctIndex] === target.text &&
        q.question.includes('_____') &&
        q.question.replace(/_+/g, '').trim().length >= 8
    );
    if (!question) throw new Error('Focused practice generation produced no contextual exercise.');
    items.push({
      id: `${idPrefix}${items.length}`,
      prompt: question.question,
      options: question.options,
      correctIndex: question.correctIndex,
      explanation: question.explanation,
      vocabLemma: target.kind === 'SENTENCE' ? null : target.text,
      focusTargetId: target.id,
    });
  }
  return items;
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
  const lesson = await prisma.lesson.findFirst({
    where: { curriculumId: course.curriculumId, level: course.currentLevel },
    orderBy: { order: 'asc' },
    select: { objective: true, grammarPoints: true, targetVocab: true },
  });
  const objective = lesson?.objective.trim() || 'Everyday conversations and situations.';
  if (grammarPoints.length > 0 || targetVocab.length > 0) {
    return { objective, grammarPoints, targetVocab };
  }
  if (!lesson) return null;
  const lessonVocab = (Array.isArray(lesson.targetVocab) ? lesson.targetVocab : []) as Array<{
    lemma: string;
    gloss: string;
  }>;
  const lessonGrammar = (
    Array.isArray(lesson.grammarPoints) ? lesson.grammarPoints : []
  ) as string[];
  if (lessonGrammar.length === 0 && lessonVocab.length === 0) return null;
  return { objective, grammarPoints: lessonGrammar, targetVocab: lessonVocab };
}

function focusSeedFallback(focusTargets: FocusPracticeTarget[]): PracticeSeed | null {
  if (focusTargets.length === 0) return null;
  return {
    objective: 'Everyday conversations and situations.',
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
  return {
    objective: seed.objective,
    grammarPoints: seed.grammarPoints,
    targetVocab: uniqueVocab([...focusVocab, ...seed.targetVocab]),
  };
}

export async function startPractice(
  courseId: string,
  userId: string,
  kind: PracticeKind,
  execution: import('@/lib/sidedoor/credentials/runtime/provider-execution').SottoProviderExecution,
  options: StartPracticeOptions = {}
): Promise<StartPracticeResult> {
  const context =
    options.generation ??
    (await capturePracticeContext(courseId, userId, kind, execution, options));
  const { course, requirements, seedToken, focusTargets, note, seed } = context;
  if (course.id !== courseId || course.userId !== userId || requirements.scope !== kind)
    throw new PracticeIncompleteError('Practice generation context changed.');
  if (kind === 'VOCAB')
    return attachPracticeRequirements(
      await startVocab(course, seedToken, focusTargets, execution, options.lifecycle),
      requirements
    );
  if (!seed) return { status: 'unavailable', reason: 'no_content' };
  if (kind === 'FULL')
    return startFull(
      course,
      seed,
      seedToken,
      note,
      focusTargets,
      execution,
      requirements,
      options.lifecycle
    );
  if (kind === 'GRAMMAR' || kind === 'READING')
    return attachPracticeRequirements(
      await startMc(
        course,
        kind,
        seed,
        seedToken,
        note,
        focusTargets,
        execution,
        options.lifecycle
      ),
      requirements
    );
  if (kind === 'LISTENING')
    return attachPracticeRequirements(
      await startListening(
        course,
        seed,
        seedToken,
        note,
        focusTargets,
        execution,
        requirements,
        options.lifecycle
      ),
      requirements
    );
  if (kind === 'SPEAKING')
    return attachPracticeRequirements(
      await startSpeaking(
        course,
        seed,
        seedToken,
        note,
        focusTargets,
        execution,
        requirements,
        options.lifecycle
      ),
      requirements
    );
  return attachPracticeRequirements(
    await startWriting(course, seed, seedToken, note, focusTargets, execution, options.lifecycle),
    requirements
  );
}

/** Capture generation inputs before durable admission. No paid provider work occurs here. */
export async function capturePracticeContext(
  courseId: string,
  userId: string,
  kind: PracticeKind,
  execution: import('@/lib/sidedoor/credentials/runtime/provider-execution').SottoProviderExecution,
  options: Pick<StartPracticeOptions, 'focusTargetId'> = {}
): Promise<PracticeGenerationContext> {
  const course = await loadCourse(courseId, userId);
  const requirements = await resolveSkillRequirements(execution, {
    scope: kind,
    nativeLang: course.nativeLang,
    targetLang: course.targetLang,
    level: course.currentLevel,
  });
  if (
    (kind === 'LISTENING' && requirements.skills.LISTENING.state !== 'REQUIRED') ||
    (kind === 'SPEAKING' && requirements.skills.SPEAKING.state !== 'REQUIRED')
  ) {
    throw new PracticeIncompleteError(
      `Configure a ${kind === 'LISTENING' ? 'TTS' : 'STT'} provider before starting ${kind.toLowerCase()} practice.`
    );
  }
  const seedToken = `${courseId}-${kind}-${Date.now()}`;
  const focusTargets = await getPracticeFocusTargets(
    courseId,
    kind === 'FULL' ? 4 : 2,
    options.focusTargetId ?? null
  );

  if (kind === 'VOCAB')
    return { course, requirements, seedToken, focusTargets, note: '', seed: null };

  const note = buildLearnerContext(await getCourseNote(courseId), course.pedagogy);
  const due = await getDueItems(courseId, kind === 'FULL' ? FULL_DUE_COUNT : MC_COUNT);
  const baseSeed = (await resolveSeed(course, due)) ?? focusSeedFallback(focusTargets);
  return {
    course,
    requirements,
    seedToken,
    focusTargets,
    note,
    seed: baseSeed ? applyFocusToSeed(baseSeed, focusTargets) : null,
  };
}

async function attachPracticeRequirements(
  result: StartPracticeResult,
  requirements: SkillRequirements
): Promise<StartPracticeResult> {
  if (result.status === 'unavailable') return result;
  await prisma.practiceSession.update({
    where: { id: result.sessionId },
    data: { skillRequirements: requirements as unknown as Prisma.InputJsonValue },
  });
  return { ...result, skillRequirements: requirements };
}

type VocabPracticeBuild =
  | { status: 'ready'; items: PracticeMcItem[]; lemmas: string[] }
  | { status: 'unavailable'; reason: 'not_enough_vocab' | 'nothing_due' };

async function buildVocabItems(
  course: CourseCtx,
  count: number,
  idPrefix: string,
  execution: import('@/lib/sidedoor/credentials/runtime/provider-execution').SottoProviderExecution
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

  const items: PracticeMcItem[] = [];
  for (let offset = 0; offset < review.length; offset += 5) {
    const batch = review.slice(offset, offset + 5);
    const questions = await generateSectionQuestions({
      userId: course.userId,
      execution,
      skill: 'GRAMMAR',
      vocabularyReview: true,
      level: course.currentLevel,
      nativeLang: course.nativeLang,
      targetLang: course.targetLang,
      objective: 'Choose words that complete meaningful sentences in context.',
      grammarPoints: [],
      targetVocab: batch.map((v) => ({ lemma: v.lemma, gloss: v.translation })),
      seed: `${course.id}-vocab-${Date.now()}-${offset}`,
    });
    for (const word of batch) {
      const question = questions.find(
        (q) =>
          q.options[q.correctIndex] === word.lemma &&
          q.question.includes('_____') &&
          q.question.replace(/_+/g, '').trim().length >= 8
      );
      if (!question) {
        throw new Error(
          `Vocabulary generation produced no contextual exercise for "${word.lemma}".`
        );
      }
      items.push({
        id: `${idPrefix}${items.length}`,
        prompt: question.question,
        options: question.options,
        correctIndex: question.correctIndex,
        explanation: question.explanation,
        vocabLemma: word.lemma,
        focusTargetId: null,
      });
    }
  }

  return { status: 'ready', items, lemmas: review.map((v) => v.lemma) };
}

async function startVocab(
  course: CourseCtx,
  seedToken: string,
  focusTargets: FocusPracticeTarget[],
  execution: import('@/lib/sidedoor/credentials/runtime/provider-execution').SottoProviderExecution,
  lifecycle?: PracticeBuildLifecycle
): Promise<StartPracticeResult> {
  const built = await buildVocabItems(course, VOCAB_COUNT, 'v', execution);
  const focusItems = await buildFocusItems(
    focusTargets.filter((target) => target.kind !== 'SENTENCE'),
    'f',
    course,
    execution
  );
  if (built.status === 'unavailable' && focusItems.length === 0) return built;
  const items = built.status === 'ready' ? [...focusItems, ...built.items] : focusItems;
  const lemmas = uniqueStrings([
    ...(built.status === 'ready' ? built.lemmas : []),
    ...focusTargets.filter((target) => target.kind !== 'SENTENCE').map((target) => target.text),
  ]);

  const session = await persistPracticeSession(
    {
      data: {
        courseId: course.id,
        kind: 'VOCAB',
        items: items as unknown as Prisma.InputJsonValue,
        seed: seedToken,
        vocabLemmas: lemmas,
        grammarKeys: [],
        focusTargetIds: focusTargets.map((target) => target.id),
      },
    },
    lifecycle
  );
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
  focusTargets: FocusPracticeTarget[],
  execution: import('@/lib/sidedoor/credentials/runtime/provider-execution').SottoProviderExecution,
  lifecycle?: PracticeBuildLifecycle
): Promise<StartPracticeResult> {
  const generatedItems = await buildSectionMcItems(
    course,
    kind,
    seed,
    seedToken,
    note,
    'q',
    execution
  );
  const focusItems = await buildFocusItems(focusTargets, 'f', course, execution);
  const items = [...focusItems, ...generatedItems];
  const readingVocabulary =
    kind === 'READING'
      ? await extractReadingVocabulary({
          ...course,
          execution,
          level: course.currentLevel,
          questions: generatedItems.map((item) => ({ ...item, question: item.prompt })),
        })
      : undefined;
  const session = await persistPracticeSession(
    {
      data: {
        courseId: course.id,
        kind,
        items: items as unknown as Prisma.InputJsonValue,
        seed: seedToken,
        vocabLemmas: seed.targetVocab.map((v) => v.lemma),
        grammarKeys: seed.grammarPoints,
        focusTargetIds: focusTargets.map((target) => target.id),
        readingVocabulary,
      },
    },
    lifecycle
  );
  if (readingVocabulary)
    await upsertLiveVocab(course.id, readingVocabulary.words, course.currentLevel);
  return { status: 'ready', sessionId: session.id, kind, items: items.map(toPublic) };
}

async function buildSectionMcItems(
  course: CourseCtx,
  kind: 'GRAMMAR' | 'READING',
  seed: PracticeSeed,
  seedToken: string,
  note: string,
  idPrefix: string,
  execution: import('@/lib/sidedoor/credentials/runtime/provider-execution').SottoProviderExecution
): Promise<PracticeMcItem[]> {
  const questions = await generateSectionQuestions({
    userId: course.userId,
    execution,
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
    ...(q.passageText ? { passageText: q.passageText } : {}),
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
  focusTargets: FocusPracticeTarget[],
  execution: import('@/lib/sidedoor/credentials/runtime/provider-execution').SottoProviderExecution,
  requirements: SkillRequirements,
  lifecycle?: PracticeBuildLifecycle
): Promise<StartPracticeResult> {
  // Listening (which includes reference verification and can fail the whole
  // build) runs BEFORE the speaking prompts: speaking is the only section that
  // spends TTS credits up front, so it must not start until verification has
  // passed. The LLM-only sections stay parallel with listening.
  const generated = await Promise.allSettled([
    buildSectionMcItems(course, 'GRAMMAR', seed, `${seedToken}-grammar`, note, 'g', execution),
    buildSectionMcItems(course, 'READING', seed, `${seedToken}-reading`, note, 'r', execution),
    requirements.skills.LISTENING.state === 'REQUIRED'
      ? composeListeningContent({
          ttsProvider: requirements.ttsProvider as Parameters<
            typeof composeListeningContent
          >[0]['ttsProvider'],
          userId: course.userId,
          execution,
          courseId: course.id,
          level: course.currentLevel,
          nativeLang: course.nativeLang,
          targetLang: course.targetLang,
          objective: seed.objective,
          mustIncludeVocab: seed.targetVocab.map((v) => ({ word: v.lemma, translation: v.gloss })),
          note,
        })
      : Promise.resolve(null),
    composeWritingPrompts({
      userId: course.userId,
      execution,
      level: course.currentLevel,
      nativeLang: course.nativeLang,
      targetLang: course.targetLang,
      objective: seed.objective,
      targetVocab: seed.targetVocab,
      note,
    }),
  ]);
  // Keep the parent execution alive until every admitted provider request settles.
  const failure = recordFullPracticeFailures(generated, execution.onCleanupError);
  if (failure) lifecycle?.onGenerationFailure?.(failure);
  if (generated[0].status === 'rejected') throw generated[0].reason;
  if (generated[1].status === 'rejected') throw generated[1].reason;
  if (generated[2].status === 'rejected') throw generated[2].reason;
  if (generated[3].status === 'rejected') throw generated[3].reason;
  const grammarItems = generated[0].value;
  const readingItems = generated[1].value;
  const listening = generated[2].value;
  const writingComposed = generated[3].value;

  const speakingComposed =
    requirements.skills.SPEAKING.state === 'REQUIRED'
      ? await composeSpeakingPrompts({
          ttsProvider: requirements.ttsProvider as Parameters<
            typeof composeSpeakingPrompts
          >[0]['ttsProvider'],
          referenceAudioRequired: requirements.referenceAudioRequired,
          execution,
          userId: course.userId,
          level: course.currentLevel,
          nativeLang: course.nativeLang,
          targetLang: course.targetLang,
          objective: seed.objective,
          targetVocab: seed.targetVocab,
          refId: seedToken,
          note,
        })
      : [];

  if (
    (requirements.skills.LISTENING.state === 'REQUIRED' &&
      (!listening?.episodeId || listening.comprehensionQuestions.length !== 4)) ||
    (requirements.skills.SPEAKING.state === 'REQUIRED' && speakingComposed.length !== 4) ||
    grammarItems.length !== 5 ||
    readingItems.length !== 5 ||
    writingComposed.length !== 3
  ) {
    throw new Error('Full practice generation did not produce every required exercise.');
  }

  // Vocabulary is built LAST, not first. Generating the sections above is what
  // seeds LearnerVocab on a course that has none yet, so asking beforehand saw
  // an empty graph, fell under MIN_VOCAB, and silently produced a full
  // catch-up with no vocabulary in it.
  const vocab = await buildVocabItems(course, FULL_VOCAB_COUNT, 'v', execution);
  const vocabItems = vocab.status === 'ready' ? vocab.items : [];
  const vocabLemmas = vocab.status === 'ready' ? vocab.lemmas : [];
  const focusItems = await buildFocusItems(focusTargets, 'f', course, execution);

  if (vocab.status !== 'ready')
    logger.info('No separate vocabulary review is due for full practice', {
      courseId: course.id,
      reason: vocab.reason,
    });

  const listeningItems: PracticeMcItem[] = (listening?.comprehensionQuestions ?? []).map(
    (q, i) => ({
      id: `l${i}`,
      prompt: q.question,
      options: q.options,
      correctIndex: q.correctIndex,
      explanation: q.explanation,
      vocabLemma: null,
      focusTargetId: null,
    })
  );
  const items = [...focusItems, ...vocabItems, ...grammarItems, ...readingItems, ...listeningItems];
  const readingVocabulary = await extractReadingVocabulary({
    ...course,
    execution,
    level: course.currentLevel,
    questions: readingItems.map((item) => ({ ...item, question: item.prompt })),
  });

  const session = await persistPracticeSession(
    {
      data: {
        courseId: course.id,
        kind: 'FULL',
        items: items as unknown as Prisma.InputJsonValue,
        seed: seedToken,
        vocabLemmas: uniqueStrings([...vocabLemmas, ...seed.targetVocab.map((v) => v.lemma)]),
        grammarKeys: seed.grammarPoints,
        episodeId: listening?.episodeId,
        listeningScriptHash: listening ? learningScriptHash(listening.turns) : null,
        skillRequirements: requirements as unknown as Prisma.InputJsonValue,
        focusTargetIds: focusTargets.map((target) => target.id),
        readingVocabulary,
      },
    },
    lifecycle
  );
  await upsertLiveVocab(course.id, readingVocabulary.words, course.currentLevel);

  await Promise.all([
    prisma.speakingPrompt.createMany({
      data: speakingComposed.map((c, i) => ({
        practiceSessionId: session.id,
        order: i + 1,
        targetPhrase: c.targetPhrase,
        translation: c.translation,
        ipa: c.ipa,
        referenceTtsUrl: null,
      })),
    }),
    prisma.writingPrompt.createMany({
      data: writingComposed.map((c, i) => ({
        practiceSessionId: session.id,
        order: i + 1,
        task: c.task,
        guidance: c.guidance,
        ideas: c.ideas,
      })),
    }),
  ]);
  const [storedSpeakingPrompts, writingPrompts] = await Promise.all([
    prisma.speakingPrompt.findMany({
      where: { practiceSessionId: session.id },
      orderBy: { order: 'asc' },
      select: { id: true, targetPhrase: true, translation: true, referenceTtsUrl: true },
    }),
    prisma.writingPrompt.findMany({
      where: { practiceSessionId: session.id },
      orderBy: { order: 'asc' },
      select: { id: true, task: true, guidance: true, ideas: true },
    }),
  ]);
  const references = await publishSpeakingPromptReferences({
    required: requirements.referenceAudioRequired,
    prompts: storedSpeakingPrompts.map((prompt, index) => ({
      id: prompt.id,
      composed: speakingComposed[index]!,
    })),
    userId: course.userId,
    execution,
  });
  const speakingPrompts = storedSpeakingPrompts.map((prompt) => ({
    ...prompt,
    referenceTtsUrl: references.get(prompt.id) ?? prompt.referenceTtsUrl,
  }));

  if (listening) await queueListeningAudio(listening, execution);

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
    episodeId: listening?.episodeId,
    skillRequirements: requirements,
    speakingPrompts,
    writingPrompts,
  };
}

async function startListening(
  course: CourseCtx,
  seed: PracticeSeed,
  seedToken: string,
  note: string,
  focusTargets: FocusPracticeTarget[],
  execution: import('@/lib/sidedoor/credentials/runtime/provider-execution').SottoProviderExecution,
  requirements: SkillRequirements,
  lifecycle?: PracticeBuildLifecycle
): Promise<StartPracticeResult> {
  const listening = await composeListeningContent({
    ttsProvider: requirements.ttsProvider as Parameters<
      typeof composeListeningContent
    >[0]['ttsProvider'],
    userId: course.userId,
    execution,
    courseId: course.id,
    level: course.currentLevel,
    nativeLang: course.nativeLang,
    targetLang: course.targetLang,
    objective: seed.objective,
    mustIncludeVocab: seed.targetVocab.map((v) => ({ word: v.lemma, translation: v.gloss })),
    note,
  });
  const { episodeId, comprehensionQuestions } = listening;
  const items: PracticeMcItem[] = comprehensionQuestions.map((q, i) => ({
    id: `l${i}`,
    prompt: q.question,
    options: q.options,
    correctIndex: q.correctIndex,
    explanation: q.explanation,
    vocabLemma: null,
    focusTargetId: null,
  }));
  const focusItems = await buildFocusItems(focusTargets, 'f', course, execution);
  const allItems = [...focusItems, ...items];
  const session = await persistPracticeSession(
    {
      data: {
        courseId: course.id,
        kind: 'LISTENING',
        items: allItems as unknown as Prisma.InputJsonValue,
        seed: seedToken,
        vocabLemmas: seed.targetVocab.map((v) => v.lemma),
        grammarKeys: [],
        episodeId,
        listeningScriptHash: learningScriptHash(listening.turns),
        focusTargetIds: focusTargets.map((target) => target.id),
      },
    },
    lifecycle
  );
  await queueListeningAudio(listening, execution);
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
  focusTargets: FocusPracticeTarget[],
  execution: import('@/lib/sidedoor/credentials/runtime/provider-execution').SottoProviderExecution,
  requirements: SkillRequirements,
  lifecycle?: PracticeBuildLifecycle
): Promise<StartPracticeResult> {
  // Speaking prompts hang off the session, so create it first to namespace them.
  const session = await persistPracticeSession(
    {
      data: {
        courseId: course.id,
        kind: 'SPEAKING',
        items: [] as unknown as Prisma.InputJsonValue,
        seed: seedToken,
        vocabLemmas: seed.targetVocab.map((v) => v.lemma),
        grammarKeys: [],
        focusTargetIds: focusTargets.map((target) => target.id),
      },
    },
    lifecycle
  );

  const composed = await composeSpeakingPrompts({
    ttsProvider: requirements.ttsProvider as Parameters<
      typeof composeSpeakingPrompts
    >[0]['ttsProvider'],
    referenceAudioRequired: requirements.referenceAudioRequired,
    execution,
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
      referenceTtsUrl: null,
    })),
  });

  const storedPrompts = await prisma.speakingPrompt.findMany({
    where: { practiceSessionId: session.id },
    orderBy: { order: 'asc' },
    select: { id: true, targetPhrase: true, translation: true, referenceTtsUrl: true },
  });
  const references = await publishSpeakingPromptReferences({
    prompts: storedPrompts.map((prompt, index) => ({ id: prompt.id, composed: composed[index]! })),
    required: requirements.referenceAudioRequired,
    userId: course.userId,
    execution,
  });
  const prompts = storedPrompts.map((prompt) => ({
    ...prompt,
    referenceTtsUrl: references.get(prompt.id) ?? prompt.referenceTtsUrl,
  }));

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
  focusTargets: FocusPracticeTarget[],
  execution: import('@/lib/sidedoor/credentials/runtime/provider-execution').SottoProviderExecution,
  lifecycle?: PracticeBuildLifecycle
): Promise<StartPracticeResult> {
  // Writing prompts hang off the session, so create it first.
  const session = await persistPracticeSession(
    {
      data: {
        courseId: course.id,
        kind: 'WRITING',
        items: [] as unknown as Prisma.InputJsonValue,
        seed: seedToken,
        vocabLemmas: seed.targetVocab.map((v) => v.lemma),
        grammarKeys: [],
        focusTargetIds: focusTargets.map((target) => target.id),
      },
    },
    lifecycle
  );

  const composed = await composeWritingPrompts({
    userId: course.userId,
    execution,
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
      ideas: c.ideas,
    })),
  });

  const prompts = await prisma.writingPrompt.findMany({
    where: { practiceSessionId: session.id },
    orderBy: { order: 'asc' },
    select: { id: true, task: true, guidance: true, ideas: true },
  });

  logger.info('Writing practice generated', {
    sessionId: session.id,
    promptCount: String(prompts.length),
  });
  return { status: 'ready_writing', sessionId: session.id, prompts };
}

export { submitPractice, PracticeSessionNotFoundError } from './practice/submission';
