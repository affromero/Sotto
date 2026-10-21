import { learningScriptHash } from './learning/script-hash';
import { Prisma } from '@/generated/prisma/client';
import { prisma } from './prisma';
import { upsertLiveVocab } from './knowledge-graph';
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
import { publishSpeakingPromptReferences } from './class-speaking-generator';
import { composeWritingPrompts } from './class-writing-generator';
import {
  reviewPracticeMultipleChoice,
  reviewPracticeListeningQuestions,
  reviewPracticeWritingPrompts,
} from './learning-map/evidence/producers';
import {
  speakingTaskMode,
  speakingAssessmentScope,
} from './learning-map/evidence/communicative-speaking';
import { composePracticeSpeaking } from './practice/speaking';
import type { FocusPracticeTarget } from './learning-targets';
import { recordFullPracticeFailures } from './learning/practice-generation-failures';
import { logger } from './logger';
import { PracticeIncompleteError } from './practice/types';
import {
  capturePracticeContext,
  captureVocabularyPracticeSeed,
  type CourseCtx,
  type PracticeSeed,
  type PracticeGenerationContext,
  type PracticeContextOptions,
} from './practice/context';
export { capturePracticeContext, PracticeCourseNotFoundError } from './practice/context';
import { extractReadingVocabulary } from './learning/reading-vocabulary';
import { buildVocabItems } from './practice/vocabulary';
import type {
  PracticeKind,
  SkillType,
  SkillRequirements,
  LearningSelectionSnapshot,
  CefrLevel,
} from '@sotto/shared';

const VOCAB_COUNT = 12;
const FULL_VOCAB_COUNT = 5;

type StartPracticeContent =
  | import('@sotto/shared').VocabularyStudySession
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
  practiceLevel?: CefrLevel | null;
  learningSelection?: LearningSelectionSnapshot | null;
  progressRevision?: number;
  skillRequirements?: SkillRequirements;
  learnerAnswers?: Record<string, number>;
  writingDrafts?: Record<string, string>;
  submissionResult?: import('./practice/types').SubmitPracticeResult | null;
};

export interface StartPracticeOptions extends PracticeContextOptions {
  generation?: PracticeGenerationContext;
  lifecycle?: PracticeBuildLifecycle;
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

async function buildFocusItems(
  focusTargets: FocusPracticeTarget[],
  idPrefix: string,
  course: CourseCtx,
  execution: import('@/lib/sidedoor/credentials/runtime/provider-execution').SottoProviderExecution,
  note: string
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
      note,
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

export async function startPractice(
  courseId: string,
  userId: string,
  kind: PracticeKind,
  execution: import('@/lib/sidedoor/credentials/runtime/provider-execution').SottoProviderExecution,
  options: StartPracticeOptions = {}
): Promise<StartPracticeResult> {
  const generation =
    options.generation ??
    (await capturePracticeContext(courseId, userId, kind, execution, options));
  const result = await buildPractice(courseId, userId, kind, execution, { ...options, generation });
  return generation.schemaVersion === 2 && result.status !== 'unavailable'
    ? {
        ...result,
        practiceLevel: generation.practiceLevel,
        learningSelection: generation.learningSelection ?? null,
      }
    : result;
}

async function buildPractice(
  courseId: string,
  userId: string,
  kind: PracticeKind,
  execution: import('@/lib/sidedoor/credentials/runtime/provider-execution').SottoProviderExecution,
  options: StartPracticeOptions = {}
): Promise<StartPracticeResult> {
  const context =
    options.generation ??
    (await capturePracticeContext(courseId, userId, kind, execution, options));
  const { requirements, seedToken, focusTargets, note, seed: capturedSeed } = context;
  const learningSelection = context.learningSelection ?? null;
  const practiceLevel = context.practiceLevel ?? context.course.currentLevel;
  const course = { ...context.course, currentLevel: practiceLevel };
  if (course.id !== courseId || course.userId !== userId || requirements.scope !== kind)
    throw new PracticeIncompleteError('Practice generation context changed.');
  if (requirements.level !== practiceLevel)
    throw new PracticeIncompleteError('Practice difficulty changed after admission.');
  const seed =
    kind === 'VOCAB' && capturedSeed === null
      ? await captureVocabularyPracticeSeed(course, practiceLevel)
      : capturedSeed;
  const finish = async (result: StartPracticeResult) => {
    if (result.status === 'unavailable') return result;
    const published = await attachPracticeRequirements(result, requirements);
    const sentences = new Set(
      focusTargets.filter((target) => target.kind === 'SENTENCE').map((target) => target.text)
    );
    await upsertLiveVocab(
      course.id,
      (seed?.targetVocab ?? []).filter((word) => !sentences.has(word.lemma)),
      practiceLevel
    );
    return published;
  };
  const lifecycle: PracticeBuildLifecycle = {
    ...options.lifecycle,
    populate: (data) => {
      const scoped =
        context.schemaVersion === 2
          ? {
              ...data,
              practiceLevel,
              learningSelection: context.learningSelection ?? Prisma.JsonNull,
            }
          : data;
      return options.lifecycle
        ? options.lifecycle.populate(scoped)
        : prisma.practiceSession.create({ data: scoped });
    },
  };
  if (kind === 'VOCAB')
    return finish(
      await startVocab(
        course,
        seed?.targetVocab ?? [],
        note,
        seedToken,
        focusTargets,
        execution,
        lifecycle
      )
    );
  if (!seed) return { status: 'unavailable', reason: 'no_content' };
  if (kind === 'FULL')
    return finish(
      await startFull(
        course,
        seed,
        seedToken,
        note,
        focusTargets,
        execution,
        requirements,
        learningSelection,
        lifecycle
      )
    );
  if (kind === 'GRAMMAR' || kind === 'READING')
    return finish(
      await startMc(
        course,
        kind,
        seed,
        seedToken,
        note,
        focusTargets,
        execution,
        requirements,
        learningSelection,
        lifecycle
      )
    );
  if (kind === 'LISTENING')
    return finish(
      await startListening(
        course,
        seed,
        seedToken,
        note,
        focusTargets,
        execution,
        requirements,
        learningSelection,
        lifecycle
      )
    );
  if (kind === 'SPEAKING')
    return finish(
      await startSpeaking(
        course,
        seed,
        seedToken,
        note,
        focusTargets,
        execution,
        requirements,
        learningSelection,
        lifecycle
      )
    );
  return finish(
    await startWriting(
      course,
      seed,
      seedToken,
      note,
      focusTargets,
      execution,
      requirements,
      learningSelection,
      lifecycle
    )
  );
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

async function startVocab(
  course: CourseCtx,
  words: PracticeSeed['targetVocab'],
  note: string,
  seedToken: string,
  focusTargets: FocusPracticeTarget[],
  execution: import('@/lib/sidedoor/credentials/runtime/provider-execution').SottoProviderExecution,
  lifecycle?: PracticeBuildLifecycle
): Promise<StartPracticeResult> {
  const built = await buildVocabItems(course, words, VOCAB_COUNT, 'v', execution, note);
  const focusItems = await buildFocusItems(
    focusTargets.filter((target) => target.kind !== 'SENTENCE'),
    'f',
    course,
    execution,
    note
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
  requirements: SkillRequirements,
  learningSelection: LearningSelectionSnapshot | null,
  lifecycle?: PracticeBuildLifecycle
): Promise<StartPracticeResult> {
  const generatedItems = await buildSectionMcItems(
    course,
    kind,
    seed,
    seedToken,
    note,
    'q',
    execution,
    requirements,
    learningSelection
  );
  const focusItems = await buildFocusItems(focusTargets, 'f', course, execution, note);
  const items = [...focusItems, ...generatedItems];
  const readingVocabulary =
    kind === 'READING'
      ? await extractReadingVocabulary({
          ...course,
          execution,
          level: course.currentLevel,
          questions: generatedItems.map((item) => ({
            id: item.id,
            question: item.prompt,
            options: item.options,
            correctIndex: item.correctIndex,
            passageText: item.passageText,
          })),
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
  execution: import('@/lib/sidedoor/credentials/runtime/provider-execution').SottoProviderExecution,
  requirements: SkillRequirements,
  learningSelection: LearningSelectionSnapshot | null
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
  const reviewed = await reviewPracticeMultipleChoice({
    courseId: course.id,
    userId: course.userId,
    execution,
    requirements,
    learningSelection,
    grammarKeys: seed.grammarPoints,
    skill: kind,
    questions,
  });
  return reviewed.map((q, i) => ({
    id: `${idPrefix}${i}`,
    prompt: q.question,
    ...(q.passageText ? { passageText: q.passageText } : {}),
    options: q.options,
    correctIndex: q.correctIndex,
    explanation: q.explanation,
    ...(q.learningAssessment ? { learningAssessment: q.learningAssessment } : {}),
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
  learningSelection: LearningSelectionSnapshot | null,
  lifecycle?: PracticeBuildLifecycle
): Promise<StartPracticeResult> {
  const generated = await Promise.allSettled([
    buildSectionMcItems(
      course,
      'GRAMMAR',
      seed,
      `${seedToken}-grammar`,
      note,
      'g',
      execution,
      requirements,
      learningSelection
    ),
    buildSectionMcItems(
      course,
      'READING',
      seed,
      `${seedToken}-reading`,
      note,
      'r',
      execution,
      requirements,
      learningSelection
    ),
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
  const writingComposed = await reviewPracticeWritingPrompts({
    courseId: course.id,
    userId: course.userId,
    execution,
    requirements,
    learningSelection,
    grammarKeys: seed.grammarPoints,
    prompts: generated[3].value,
  });

  const speakingComposed =
    requirements.skills.SPEAKING.state === 'REQUIRED'
      ? await composePracticeSpeaking({
          course,
          seed,
          seedToken,
          note,
          execution,
          requirements,
          learningSelection,
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

  const vocab = await buildVocabItems(
    course,
    seed.targetVocab,
    FULL_VOCAB_COUNT,
    'v',
    execution,
    note
  );
  const vocabItems = vocab.status === 'ready' ? vocab.items : [];
  const vocabLemmas = vocab.status === 'ready' ? vocab.lemmas : [];
  const focusItems = await buildFocusItems(focusTargets, 'f', course, execution, note);

  if (vocab.status !== 'ready')
    logger.info('No separate vocabulary review is due for full practice', {
      courseId: course.id,
      reason: vocab.reason,
    });

  const reviewedListening = listening
    ? await reviewPracticeListeningQuestions({
        courseId: course.id,
        userId: course.userId,
        execution,
        requirements,
        learningSelection,
        grammarKeys: seed.grammarPoints,
        questions: listening.comprehensionQuestions,
        turns: listening.turns,
      })
    : [];
  const listeningItems: PracticeMcItem[] = reviewedListening.map((q, i) => ({
    id: `l${i}`,
    prompt: q.question,
    options: q.options,
    correctIndex: q.correctIndex,
    explanation: q.explanation,
    ...(q.learningAssessment ? { learningAssessment: q.learningAssessment } : {}),
    vocabLemma: null,
    focusTargetId: null,
  }));
  const items = [...focusItems, ...vocabItems, ...grammarItems, ...readingItems, ...listeningItems];
  const readingVocabulary = await extractReadingVocabulary({
    ...course,
    execution,
    level: course.currentLevel,
    questions: readingItems.map((item) => ({
      id: item.id,
      question: item.prompt,
      options: item.options,
      correctIndex: item.correctIndex,
      passageText: item.passageText,
    })),
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
        ...(c.learningObjectives ? { learningObjectives: c.learningObjectives } : {}),
      })),
    }),
    prisma.writingPrompt.createMany({
      data: writingComposed.map((c, i) => ({
        practiceSessionId: session.id,
        order: i + 1,
        task: c.task,
        guidance: c.guidance,
        ideas: c.ideas,
        ...(c.learningObjectives ? { learningObjectives: c.learningObjectives } : {}),
      })),
    }),
  ]);
  const [storedSpeakingPrompts, writingPrompts] = await Promise.all([
    prisma.speakingPrompt.findMany({
      where: { practiceSessionId: session.id },
      orderBy: { order: 'asc' },
      select: {
        id: true,
        targetPhrase: true,
        translation: true,
        referenceTtsUrl: true,
        learningObjectives: true,
      },
    }),
    prisma.writingPrompt.findMany({
      where: { practiceSessionId: session.id },
      orderBy: { order: 'asc' },
      select: { id: true, task: true, guidance: true, ideas: true },
    }),
  ]);
  const references = await publishSpeakingPromptReferences({
    required: requirements.referenceAudioRequired,
    prompts: storedSpeakingPrompts
      .map((prompt, index) => ({
        id: prompt.id,
        composed: speakingComposed[index]!,
      }))
      .filter(
        (item) =>
          speakingTaskMode(
            'learningObjectives' in item.composed ? item.composed.learningObjectives : null
          ) === 'READ_ALOUD'
      ),
    userId: course.userId,
    execution,
  });
  const speakingPrompts = storedSpeakingPrompts.map(({ learningObjectives, ...prompt }) => ({
    ...prompt,
    taskMode: speakingTaskMode(learningObjectives),
    assessmentScope: speakingAssessmentScope(learningObjectives),
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
  learningSelection: LearningSelectionSnapshot | null,
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
  const reviewedListening = await reviewPracticeListeningQuestions({
    courseId: course.id,
    userId: course.userId,
    execution,
    requirements,
    learningSelection,
    grammarKeys: seed.grammarPoints,
    questions: comprehensionQuestions,
    turns: listening.turns,
  });
  const items: PracticeMcItem[] = reviewedListening.map((q, i) => ({
    id: `l${i}`,
    prompt: q.question,
    options: q.options,
    correctIndex: q.correctIndex,
    explanation: q.explanation,
    ...(q.learningAssessment ? { learningAssessment: q.learningAssessment } : {}),
    vocabLemma: null,
    focusTargetId: null,
  }));
  const focusItems = await buildFocusItems(focusTargets, 'f', course, execution, note);
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
  learningSelection: LearningSelectionSnapshot | null,
  lifecycle?: PracticeBuildLifecycle
): Promise<StartPracticeResult> {
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

  const composed = await composePracticeSpeaking({
    course,
    seed,
    seedToken: session.id,
    note,
    execution,
    requirements,
    learningSelection,
  });

  await prisma.speakingPrompt.createMany({
    data: composed.map((c, i) => ({
      practiceSessionId: session.id,
      order: i + 1,
      targetPhrase: c.targetPhrase,
      translation: c.translation,
      ipa: c.ipa,
      referenceTtsUrl: null,
      ...(c.learningObjectives ? { learningObjectives: c.learningObjectives } : {}),
    })),
  });

  const storedPrompts = await prisma.speakingPrompt.findMany({
    where: { practiceSessionId: session.id },
    orderBy: { order: 'asc' },
    select: {
      id: true,
      targetPhrase: true,
      translation: true,
      referenceTtsUrl: true,
      learningObjectives: true,
    },
  });
  const references = await publishSpeakingPromptReferences({
    prompts: storedPrompts
      .map((prompt, index) => ({ id: prompt.id, composed: composed[index]! }))
      .filter((item) => speakingTaskMode(item.composed.learningObjectives) === 'READ_ALOUD'),
    required: requirements.referenceAudioRequired,
    userId: course.userId,
    execution,
  });
  const prompts = storedPrompts.map(({ learningObjectives, ...prompt }) => ({
    ...prompt,
    taskMode: speakingTaskMode(learningObjectives),
    assessmentScope: speakingAssessmentScope(learningObjectives),
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
  requirements: SkillRequirements,
  learningSelection: LearningSelectionSnapshot | null,
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

  const raw = await composeWritingPrompts({
    userId: course.userId,
    execution,
    level: course.currentLevel,
    nativeLang: course.nativeLang,
    targetLang: course.targetLang,
    objective: seed.objective,
    targetVocab: seed.targetVocab,
    note,
  });
  const composed = await reviewPracticeWritingPrompts({
    courseId: course.id,
    userId: course.userId,
    execution,
    requirements,
    learningSelection,
    grammarKeys: seed.grammarPoints,
    prompts: raw,
  });

  await prisma.writingPrompt.createMany({
    data: composed.map((c, i) => ({
      practiceSessionId: session.id,
      order: i + 1,
      task: c.task,
      guidance: c.guidance,
      ideas: c.ideas,
      ...(c.learningObjectives ? { learningObjectives: c.learningObjectives } : {}),
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
