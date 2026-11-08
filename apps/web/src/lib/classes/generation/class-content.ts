import { Prisma } from '@/generated/prisma/client';
import {
  bindInitialA1SectionReview,
  generateSectionQuestions,
  requireInitialA1SectionReview,
  sealInitialA1SectionReviews,
} from '@/lib/class-generation';
import {
  failUnqueuedClassListening,
  prepareClassListening,
  queueListeningAudio,
  sealInitialA1ListeningReview,
} from '@/lib/class-listening-generator';
import { type PreparedClassSource } from '@/lib/class-source';
import { generateClassSpeaking, sealInitialA1SpeakingReview } from '@/lib/class-speaking-generator';
import { generateClassWriting, sealInitialA1WritingReview } from '@/lib/class-writing-generator';
import { generateClassIntro } from '@/lib/classes/class-intro';
import { runClassGenerationStages } from '@/lib/classes/generation/stages';
import { classTargetsFromSeed } from '@/lib/classes/lesson/class-targets';
import {
  generateClassTeaching,
  requireInitialA1TeachingReview,
  sealInitialA1TeachingSeed,
  teachingFromSeed,
} from '@/lib/classes/lesson/teaching';
import type { InitialA1SectionReceipt } from '@/lib/classes/quality/section-review/section-review-proof';
import type { InitialA1SpeakingReceipt } from '@/lib/classes/quality/section-review/speaking-review-proof';
import type { InitialA1WritingReceipt } from '@/lib/classes/quality/section-review/writing-review-proof';
import { grammarRepairSourceHash } from '@/lib/classes/repair/grammar-repair-source';
import { SectionQualityError } from '@/lib/classes/section-quality';
import { captureMaterialDocuments } from '@/lib/course-materials/documents';
import { getCourseVocabularyTargets } from '@/lib/course-materials/vocabulary-context';
import { getCourseNote } from '@/lib/course-notes';
import { getDueItems } from '@/lib/knowledge-graph';
import { objectiveReviewContext } from '@/lib/learning-map/adaptation/review';
import {
  captureClassAssessmentScope,
  reviewMultipleChoiceAssessments,
} from '@/lib/learning-map/evidence/producers';
import {
  ClassGenerationCancelledError,
  withClassGeneration,
} from '@/lib/learning/classes/formative/class-generation-state';
import {
  assertRepairQuizPreserved,
  readReadingRepairSnapshot,
} from '@/lib/learning/classes/formative/class-repair';
import { extractReadingVocabulary } from '@/lib/learning/reading-vocabulary';
import { getVocabularySupportContext } from '@/lib/learning/vocabulary/support';
import { getVocabularyTargets } from '@/lib/learning/vocabulary/targets';
import { logger } from '@/lib/logger';
import { buildLearnerContext } from '@/lib/pedagogy';
import { prisma } from '@/lib/prisma';
import type { ClassTeaching, SkillRequirements, SkillType } from '@sotto/shared';
import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';

const MC_SKILLS = ['GRAMMAR', 'READING'] as const;

interface LessonLike {
  id: string;
  level: string;
  order: number;
  slug: string;
  title: string;
  objective: string;
  grammarPoints: unknown;
  targetVocab: unknown;
}

function lessonInputs(lesson: LessonLike) {
  return {
    grammarPoints: (Array.isArray(lesson.grammarPoints) ? lesson.grammarPoints : []) as string[],
    targetVocab: (Array.isArray(lesson.targetVocab) ? lesson.targetVocab : []) as Array<{
      lemma: string;
      gloss: string;
    }>,
  };
}

async function assertClassStillGenerating(classId: string, attempt: number) {
  const cls = await prisma.courseClass.findUnique({
    where: { id: classId },
    select: { status: true, attempt: true },
  });

  if (!cls || cls.status !== 'GENERATING' || cls.attempt !== attempt) {
    throw new ClassGenerationCancelledError(classId);
  }
}

export async function rethrowIfGenerationWasCancelled(
  classId: string,
  attempt: number,
  error: unknown
) {
  if (error instanceof ClassGenerationCancelledError) throw error;

  const cls = await prisma.courseClass
    .findUnique({
      where: { id: classId },
      select: { status: true, attempt: true },
    })
    .catch(() => null);

  if (!cls || cls.status !== 'GENERATING' || cls.attempt !== attempt) {
    throw new ClassGenerationCancelledError(classId);
  }
}

/** Optional overrides for a sourced class: level/objective adapt to the learner +
 *  source, and the READING section is built from the leveled passage. */
export interface SectionOverride {
  level?: string;
  objective?: string;
  sourceContent?: string;
}

async function buildSection(
  classId: string,
  courseId: string,
  userId: string,
  execution: import('@/lib/sidedoor/credentials/runtime/provider-execution').SottoProviderExecution,
  skill: SkillType,
  lesson: LessonLike,
  nativeLang: string,
  targetLang: string,
  note: string,
  attempt = 1,
  over?: SectionOverride,
  retry?: import('@/lib/classes/quiz/retry').QuizRetryContext,
  teaching?: ClassTeaching,
  requireReviewProof = false,
  repairQuiz?: { retry?: { sectionId: string; skill: SkillType }; expectedPassage?: string | null }
): Promise<InitialA1SectionReceipt | undefined> {
  await assertClassStillGenerating(classId, attempt);
  const { grammarPoints, targetVocab } = lessonInputs(lesson);
  const seed = `${classId}-${skill}-${attempt}`;
  const deferSection = Boolean(repairQuiz) && !requireReviewProof;
  const initial = await withClassGeneration(execution, classId, attempt, async (database) => {
    if (repairQuiz)
      await assertRepairQuizPreserved(database, classId, attempt, [skill], repairQuiz.retry);
    if (deferSection)
      return {
        section: null,
        reading:
          skill === 'READING' ? await readReadingRepairSnapshot(database, classId, attempt) : null,
        grammarHash:
          skill === 'GRAMMAR' ? await grammarRepairSourceHash(database, classId, attempt) : null,
      };
    const section = await database.classSection.create({
      data: {
        classId,
        skill,
        attempt,
        seed,
        spec: { lessonSlug: lesson.slug },
        status: 'GENERATING',
      },
    });
    return { section, reading: null, grammarHash: null };
  });
  const section = initial.section;
  if (
    initial.reading &&
    repairQuiz &&
    'expectedPassage' in repairQuiz &&
    initial.reading.passage !== repairQuiz.expectedPassage
  )
    throw new Error('The saved reading passage changed before repair.');
  if (deferSection && skill === 'READING' && !execution.stageClassReading)
    throw new Error('Reading repair requires a durable staging operation.');
  if (
    deferSection &&
    skill === 'GRAMMAR' &&
    (!execution.stageClassGrammar ||
      !execution.grammarRepairSourceHash ||
      initial.grammarHash !== execution.grammarRepairSourceHash)
  )
    throw new Error('The saved grammar material changed before repair.');
  await assertClassStillGenerating(classId, attempt);
  const sectionParams = {
    userId,
    execution,
    skill,
    level: over?.level ?? lesson.level,
    nativeLang,
    targetLang,
    objective: over?.objective ?? lesson.objective,
    grammarPoints,
    targetVocab,
    seed,
    note,
    teaching,
    sourceContent: over?.sourceContent,
    retry,
    ...(requireReviewProof
      ? { reviewScope: { classId, courseId, sectionId: section!.id, attempt } }
      : {}),
  };
  const generatedQuestions = await generateSectionQuestions(sectionParams);
  if (requireReviewProof) requireInitialA1SectionReview(generatedQuestions, sectionParams);
  const scope = await captureClassAssessmentScope({ classId, userId, execution });
  const questions = await reviewMultipleChoiceAssessments({
    userId,
    execution,
    scope,
    skill: skill as 'GRAMMAR' | 'READING',
    questions: requireReviewProof ? structuredClone(generatedQuestions) : generatedQuestions,
  });
  if (requireReviewProof)
    requireInitialA1SectionReview(generatedQuestions, sectionParams, questions);
  const persistedQuestions =
    requireReviewProof || deferSection ? structuredClone(questions) : questions;
  const stagedReadingQuestions =
    deferSection && skill === 'READING'
      ? persistedQuestions.map((question) => ({ ...question, id: randomUUID() }))
      : null;
  const stagedReadingVocabulary = stagedReadingQuestions
    ? await extractReadingVocabulary({
        userId,
        execution,
        nativeLang,
        targetLang,
        level: over?.level ?? lesson.level,
        questions: stagedReadingQuestions,
      })
    : null;
  await assertClassStillGenerating(classId, attempt);
  const storedSection = await withClassGeneration(execution, classId, attempt, async (database) => {
    if (!section && repairQuiz)
      await assertRepairQuizPreserved(database, classId, attempt, [skill], repairQuiz.retry);
    if (
      initial.reading &&
      !isDeepStrictEqual(
        await readReadingRepairSnapshot(database, classId, attempt),
        initial.reading
      )
    )
      throw new Error('The saved reading material changed during repair.');
    const currentSection =
      section ??
      (await database.classSection.create({
        data: {
          classId,
          skill,
          attempt,
          seed,
          spec: { lessonSlug: lesson.slug },
          status: 'GENERATING',
          withdrawn: deferSection,
        },
      }));
    const inserted: string[] = [];
    for (const [i, q] of persistedQuestions.entries()) {
      const created = await database.lessonQuestion.create({
        data: {
          ...(stagedReadingQuestions ? { id: stagedReadingQuestions[i]!.id } : {}),
          sectionId: currentSection.id,
          order: i + 1,
          skill,
          question: q.question,
          options: q.options,
          correctIndex: q.correctIndex,
          explanation: q.explanation,
          passageRef: q.passageRef ?? null,
          passageText: q.passageText ?? null,
          ...(q.learningAssessment
            ? { learningAssessment: q.learningAssessment as unknown as Prisma.InputJsonValue }
            : {}),
        },
      });
      if (requireReviewProof) inserted.push(created.id);
    }
    await database.classSection.update({
      where: { id: currentSection.id },
      data: { status: 'READY', generatedAt: new Date() },
    });
    if (stagedReadingVocabulary && initial.reading && execution.stageClassReading)
      await execution.stageClassReading(database, {
        classId,
        attempt,
        sectionId: currentSection.id,
        source: initial.reading,
        vocabulary: stagedReadingVocabulary,
      });
    if (initial.grammarHash && execution.stageClassGrammar)
      await execution.stageClassGrammar(database, {
        classId,
        attempt,
        sectionId: currentSection.id,
        sourceHash: initial.grammarHash,
      });
    return { ids: inserted, id: currentSection.id };
  });
  const receipt = requireReviewProof
    ? bindInitialA1SectionReview(
        generatedQuestions,
        sectionParams,
        persistedQuestions,
        storedSection.ids
      )
    : undefined;
  await assertClassStillGenerating(classId, attempt);
  if (skill === 'READING' && !deferSection) {
    const stored = await prisma.lessonQuestion.findMany({
      where: { sectionId: storedSection.id },
      orderBy: { order: 'asc' },
      select: { id: true, question: true, options: true, correctIndex: true, passageText: true },
    });
    const readingVocabulary = await extractReadingVocabulary({
      userId,
      execution,
      nativeLang,
      targetLang,
      level: over?.level ?? lesson.level,
      questions: stored.map((question) => ({ ...question, options: question.options as string[] })),
    });
    await assertClassStillGenerating(classId, attempt);
    await withClassGeneration(execution, classId, attempt, async (database) => {
      await database.courseClass.update({ where: { id: classId }, data: { readingVocabulary } });
    });
  }
  return receipt;
}

function noteForAttempt(note: string, classId: string, attempt: number): string {
  const variation = `Class attempt ${attempt} for ${classId}: generate a fresh variation. Do not reuse the same examples, questions, prompts, or distractors from earlier attempts.`;
  return [note, variation].filter(Boolean).join('\n\n');
}

interface ClassBuildCourse {
  nativeLang: string;
  targetLang: string;
  currentLevel: string;
  pedagogy: string;
}

interface ClassContentBuildParams {
  requirements: SkillRequirements;
  skills?: ReadonlySet<SkillType>;
  retry?: import('@/lib/classes/quiz/retry').QuizRetryContext;
  retrySection?: { sectionId: string; skill: SkillType };
  existingSeed?: Prisma.InputJsonObject;
  preserveTeaching?: boolean;
  deferAudio?: boolean;
  execution: import('@/lib/sidedoor/credentials/runtime/provider-execution').SottoProviderExecution;
  classId: string;
  courseId: string;
  userId: string;
  course: ClassBuildCourse;
  lesson: LessonLike;
  attempt: number;
  sourceTitle: string | null;
  sourceUrl: string | null;
  sourceBefore: { title: string | null; url: string | null };
  override?: SectionOverride;
  listeningSource?: {
    sourceContent?: string;
    sourceMetadata?: PreparedClassSource['sourceMetadata'];
    sourceUrl?: string;
  };
}

export async function buildClassContent(
  p: ClassContentBuildParams
): Promise<Prisma.InputJsonObject> {
  const initialA1Policy = p.execution.initialA1Class;
  await assertClassStillGenerating(p.classId, p.attempt);
  p = {
    ...p,
    execution: {
      ...p.execution,
      sourceDocuments: await captureMaterialDocuments(p.execution, { courseId: p.courseId }),
    },
  };
  if (p.execution.initialA1Class !== initialA1Policy)
    throw new SectionQualityError('The initial A1 teaching policy changed during generation.');
  const reviewScope = {
    level: p.requirements.level,
    targetLang: p.requirements.targetLang,
    kind: 'FULL' as const,
  };
  const due = await getDueItems(p.courseId, 8, reviewScope);
  const objectiveReview = objectiveReviewContext(due.objectives, reviewScope, new Date());
  const corpus = p.preserveTeaching
    ? undefined
    : await getCourseVocabularyTargets({
        courseId: p.courseId,
        userId: p.userId,
        execution: p.execution,
        nativeLang: p.requirements.nativeLang,
        targetLang: p.requirements.targetLang,
        level: p.requirements.level,
        seed: `${p.classId}:${p.attempt}`,
      });
  const capturedContext =
    corpus === undefined
      ? await getCourseNote(p.courseId, `${p.classId}:${p.attempt}`)
      : corpus.context;
  const note = noteForAttempt(
    [
      buildLearnerContext(
        [await getVocabularySupportContext(p.courseId, p.userId), capturedContext]
          .filter(Boolean)
          .join('\n\n'),
        p.course.pedagogy as Parameters<typeof buildLearnerContext>[1]
      ),
      objectiveReview.text,
    ]
      .filter(Boolean)
      .join('\n\n'),
    p.classId,
    p.attempt
  );
  await assertClassStillGenerating(p.classId, p.attempt);
  let targets = (p.preserveTeaching && classTargetsFromSeed(p.existingSeed)) || {
    vocab: lessonInputs(p.lesson).targetVocab,
    grammarPoints: lessonInputs(p.lesson).grammarPoints,
  };
  if (corpus) {
    const candidates = corpus.imported ? corpus.vocab : targets.vocab;
    targets = {
      ...targets,
      vocab: await getVocabularyTargets(p.courseId, due.vocab, candidates, 8),
    };
    if (corpus.imported && !targets.vocab.length)
      throw new Error('No new or due vocabulary was available in the imported material.');
  }
  const { grammarPoints } = targets;
  const targetVocab = targets.vocab;
  const lessonLevel = p.requirements.level;
  const lessonObjective = p.override?.objective ?? p.lesson.objective;
  await assertClassStillGenerating(p.classId, p.attempt);

  const intro =
    p.existingSeed?.intro ??
    (await generateClassIntro({
      userId: p.userId,
      execution: p.execution,
      level: lessonLevel,
      nativeLang: p.requirements.nativeLang,
      targetLang: p.requirements.targetLang,
      title: p.lesson.title,
      objective: lessonObjective,
      grammarPoints,
      targetVocab,
      note,
      sourceTitle: p.sourceTitle,
    }));
  await assertClassStillGenerating(p.classId, p.attempt);

  const retainedTeaching = p.preserveTeaching ? teachingFromSeed(p.existingSeed) : undefined;
  const teachingParams = {
    userId: p.userId,
    execution: p.execution,
    level: lessonLevel,
    nativeLang: p.requirements.nativeLang,
    targetLang: p.requirements.targetLang,
    title: p.lesson.title,
    objective: lessonObjective,
    grammarPoints,
    targetVocab,
    note,
    sourceContent: p.override?.sourceContent,
    reviewScope: {
      classId: p.classId,
      courseId: p.courseId,
      attempt: p.attempt,
      requirements: p.requirements,
      course: { nativeLang: p.course.nativeLang, targetLang: p.course.targetLang },
      lesson: { id: p.lesson.id, title: p.lesson.title, objective: p.lesson.objective },
      sourceBefore: p.sourceBefore,
      sourceAfter: { title: p.sourceTitle, url: p.sourceUrl },
    },
  };
  const teaching = retainedTeaching ?? (await generateClassTeaching(teachingParams));
  await assertClassStillGenerating(p.classId, p.attempt);

  const stages: Array<Parameters<typeof runClassGenerationStages>[0][number]> = [];
  const sectionReceipts = new Map<(typeof MC_SKILLS)[number], InitialA1SectionReceipt>();
  let writingReceipt: InitialA1WritingReceipt | undefined;
  let speakingReceipt: InitialA1SpeakingReceipt | undefined;
  for (const skill of MC_SKILLS) {
    if (p.skills && !p.skills.has(skill)) continue;
    stages.push({
      stage: skill === 'GRAMMAR' ? 'grammar' : 'reading',
      run: async () => {
        const receipt = await buildSection(
          p.classId,
          p.courseId,
          p.userId,
          p.execution,
          skill,
          { ...p.lesson, grammarPoints, targetVocab, level: p.requirements.level },
          p.requirements.nativeLang,
          p.requirements.targetLang,
          note,
          p.attempt,
          { ...p.override, level: p.requirements.level },
          p.retry,
          teaching,
          !p.preserveTeaching && lessonLevel === 'A1' && initialA1Policy === true,
          p.preserveTeaching
            ? {
                retry: p.retrySection,
                ...(p.sourceUrl ? { expectedPassage: p.override?.sourceContent ?? null } : {}),
              }
            : undefined
        );
        if (receipt) sectionReceipts.set(skill, receipt);
      },
    });
  }
  let listening: Awaited<ReturnType<typeof prepareClassListening>> | undefined;
  if (
    p.requirements.skills.LISTENING.state === 'REQUIRED' &&
    (!p.skills || p.skills.has('LISTENING'))
  )
    stages.push({
      stage: 'listening',
      run: async () => {
        await assertClassStillGenerating(p.classId, p.attempt);
        listening = await prepareClassListening({
          ttsProvider: p.requirements.ttsProvider as Parameters<
            typeof prepareClassListening
          >[0]['ttsProvider'],
          deferAudio: p.deferAudio,
          userId: p.userId,
          execution: p.execution,
          classId: p.classId,
          courseId: p.courseId,
          attempt: p.attempt,
          level: lessonLevel,
          nativeLang: p.requirements.nativeLang,
          targetLang: p.requirements.targetLang,
          objective: lessonObjective,
          mustIncludeVocab: targetVocab.map((v) => ({ word: v.lemma, translation: v.gloss })),
          note,
          teaching,
          sourceContent: p.listeningSource?.sourceContent,
          sourceMetadata: p.listeningSource?.sourceMetadata,
          sourceUrl: p.listeningSource?.sourceUrl,
          retry: p.retry,
          ...(p.preserveTeaching ? { repairQuiz: { retry: p.retrySection } } : {}),
          requireInitialA1Proof:
            !p.preserveTeaching && lessonLevel === 'A1' && initialA1Policy === true,
        });
        await assertClassStillGenerating(p.classId, p.attempt);
      },
    });

  if (!p.skills || p.skills.has('WRITING'))
    stages.push({
      stage: 'writing',
      run: async () => {
        await assertClassStillGenerating(p.classId, p.attempt);
        const generated = await generateClassWriting({
          userId: p.userId,
          execution: p.execution,
          classId: p.classId,
          attempt: p.attempt,
          stagedRepair: p.preserveTeaching === true,
          level: lessonLevel,
          nativeLang: p.requirements.nativeLang,
          targetLang: p.requirements.targetLang,
          objective: lessonObjective,
          targetVocab,
          note,
          teaching,
          ...(!p.preserveTeaching && lessonLevel === 'A1' && initialA1Policy === true
            ? { reviewScope: { courseId: p.courseId } }
            : {}),
        });
        writingReceipt = generated.reviewReceipt;
        await assertClassStillGenerating(p.classId, p.attempt);
      },
    });

  try {
    await runClassGenerationStages(stages, {
      classId: p.classId,
      attempt: p.attempt,
      signal: p.execution.signal,
      onCleanupError: p.execution.onCleanupError,
    });
    await assertClassStillGenerating(p.classId, p.attempt);

    if (
      p.requirements.skills.SPEAKING.state === 'REQUIRED' &&
      (!p.skills || p.skills.has('SPEAKING'))
    )
      try {
        await assertClassStillGenerating(p.classId, p.attempt);
        const generated = await generateClassSpeaking({
          ttsProvider: p.requirements.ttsProvider as Parameters<
            typeof generateClassSpeaking
          >[0]['ttsProvider'],
          referenceAudioRequired: p.requirements.referenceAudioRequired,
          execution: p.execution,
          userId: p.userId,
          classId: p.classId,
          attempt: p.attempt,
          repair: p.preserveTeaching === true,
          level: lessonLevel,
          nativeLang: p.requirements.nativeLang,
          targetLang: p.requirements.targetLang,
          objective: lessonObjective,
          targetVocab,
          note,
          teaching,
          ...(!p.preserveTeaching && lessonLevel === 'A1' && initialA1Policy === true
            ? { reviewCourseId: p.courseId }
            : {}),
        });
        speakingReceipt = generated.reviewReceipt;
        await assertClassStillGenerating(p.classId, p.attempt);
      } catch (err) {
        await rethrowIfGenerationWasCancelled(p.classId, p.attempt, err);
        logger.error('Required speaking section generation failed', {
          classId: p.classId,
          error: err instanceof Error ? err.message : String(err),
        });
        throw err;
      }
    if (p.execution.initialA1Class !== initialA1Policy)
      throw new SectionQualityError('The initial A1 teaching policy changed during generation.');
    if (!retainedTeaching && lessonLevel === 'A1' && initialA1Policy === true)
      requireInitialA1TeachingReview(teaching, teachingParams);
  } catch (error) {
    if (listening) await failUnqueuedClassListening(listening.episodeId, p.userId);
    throw error;
  }

  let seed: Prisma.InputJsonObject;
  try {
    await assertClassStillGenerating(p.classId, p.attempt);
    await p.execution.sourceDocuments?.validate();
    seed = {
      ...p.existingSeed,
      vocabIds: due.vocab.map((v) => v.id),
      grammarKeys: due.grammar.map((g) => g.topicKey),
      dueCount: due.vocab.length + due.grammar.length + objectiveReview.entries.length,
      objectiveReviewContext: objectiveReview.text,
      intro: intro as unknown as Prisma.InputJsonObject,
      ...(!p.preserveTeaching || p.existingSeed?.classTargets
        ? { classTargets: targets as unknown as Prisma.InputJsonObject }
        : {}),
      ...(teaching ? { teaching: teaching as unknown as Prisma.InputJsonObject } : {}),
    };
    if (!retainedTeaching && lessonLevel === 'A1' && initialA1Policy === true)
      sealInitialA1TeachingSeed(seed, teaching, teachingParams);
    if (!p.preserveTeaching && lessonLevel === 'A1' && initialA1Policy === true)
      sealInitialA1SectionReviews(seed, teaching, [...sectionReceipts.values()], {
        classId: p.classId,
        courseId: p.courseId,
        userId: p.userId,
        attempt: p.attempt,
        skills: MC_SKILLS.filter((skill) => p.requirements.skills[skill].state === 'REQUIRED'),
        level: teachingParams.level,
        nativeLang: teachingParams.nativeLang,
        targetLang: teachingParams.targetLang,
        objective: teachingParams.objective,
        grammarPoints: teachingParams.grammarPoints,
        targetVocab: teachingParams.targetVocab,
        note: teachingParams.note,
        sourceContent: teachingParams.sourceContent,
      });
    if (
      !p.preserveTeaching &&
      lessonLevel === 'A1' &&
      initialA1Policy === true &&
      p.requirements.skills.WRITING.state === 'REQUIRED'
    ) {
      if (!writingReceipt) throw new SectionQualityError('The writing review is missing.');
      sealInitialA1WritingReview(seed, teaching, writingReceipt, {
        classId: p.classId,
        courseId: p.courseId,
        userId: p.userId,
        attempt: p.attempt,
        level: teachingParams.level,
        nativeLang: teachingParams.nativeLang,
        targetLang: teachingParams.targetLang,
        objective: teachingParams.objective,
        targetVocab: teachingParams.targetVocab,
        note: teachingParams.note,
      });
    }
    if (
      !p.preserveTeaching &&
      lessonLevel === 'A1' &&
      initialA1Policy === true &&
      p.requirements.skills.LISTENING.state === 'REQUIRED'
    ) {
      if (!listening?.reviewReceipt)
        throw new SectionQualityError('The listening review is missing.');
      if (p.listeningSource?.sourceContent !== teachingParams.sourceContent)
        throw new SectionQualityError('The listening teaching source changed.');
      sealInitialA1ListeningReview(seed, teaching, listening.reviewReceipt, {
        classId: p.classId,
        courseId: p.courseId,
        userId: p.userId,
        attempt: p.attempt,
        level: teachingParams.level,
        nativeLang: teachingParams.nativeLang,
        targetLang: teachingParams.targetLang,
        objective: teachingParams.objective,
        mustIncludeVocab: targetVocab.map((v) => ({ word: v.lemma, translation: v.gloss })),
        note: teachingParams.note,
        sourceContent: p.listeningSource?.sourceContent,
        sourceMetadata: p.listeningSource?.sourceMetadata,
        sourceUrl: p.listeningSource?.sourceUrl,
        ttsProvider: p.requirements.ttsProvider as Parameters<
          typeof prepareClassListening
        >[0]['ttsProvider'],
        deferAudio: p.deferAudio,
      });
    }
    if (
      !p.preserveTeaching &&
      lessonLevel === 'A1' &&
      initialA1Policy === true &&
      p.requirements.skills.SPEAKING.state === 'REQUIRED'
    ) {
      if (!speakingReceipt) throw new SectionQualityError('The speaking review is missing.');
      sealInitialA1SpeakingReview(seed, teaching, speakingReceipt, {
        classId: p.classId,
        courseId: p.courseId,
        userId: p.userId,
        attempt: p.attempt,
        level: teachingParams.level,
        nativeLang: teachingParams.nativeLang,
        targetLang: teachingParams.targetLang,
        objective: teachingParams.objective,
        targetVocab: teachingParams.targetVocab,
        note: teachingParams.note,
        ttsProvider: p.requirements.ttsProvider as Parameters<
          typeof generateClassSpeaking
        >[0]['ttsProvider'],
        referenceAudioRequired: p.requirements.referenceAudioRequired,
      });
    }
  } catch (error) {
    if (listening) await failUnqueuedClassListening(listening.episodeId, p.userId);
    throw error;
  }
  if (listening && !p.deferAudio)
    try {
      await queueListeningAudio(listening.content, p.execution, {
        classId: p.classId,
        attempt: p.attempt,
        requireInitialA1Proof:
          !p.preserveTeaching && lessonLevel === 'A1' && initialA1Policy === true,
      });
    } catch (error) {
      await failUnqueuedClassListening(listening.episodeId, p.userId);
      throw error;
    }
  return seed;
}
