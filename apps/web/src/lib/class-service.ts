// Class lifecycle: instantiate the next gated class from the curriculum,
// generate its MC sections, grade submissions, and regenerate failed sections
// in a different form (retrieval practice / anti-copy).
import { prisma, prismaUnfiltered } from './prisma';
import { generateSectionQuestions } from './class-generation';
import {
  claimPristineRegeneration,
  validatePristineRegeneration,
} from './classes/regeneration/pristine';
import { seedLessonItems, getDueItems } from './knowledge-graph';
import { generateClassListening } from './class-listening-generator';
import { prepareClassSource, type PreparedClassSource } from './class-source';
import { generateClassSpeaking } from './class-speaking-generator';
import { generateClassWriting } from './class-writing-generator';
import { getCourseNote } from './course-notes';
import { buildLearnerContext } from './pedagogy';
import { Prisma } from '@/generated/prisma/client';
import { ensureCurriculumHasLevelLessons } from './curriculum-generator';
import { cefrRank } from './cefr-levels';
import { generateClassIntro } from './classes/class-intro';
import { logger } from './logger';
import { resolveSkillRequirements, readSkillRequirements } from './learning/skill-requirements';
import { extractReadingVocabulary } from './learning/reading-vocabulary';
import { selectClassRepairSkills, repairClassReadingMemory } from './learning/classes/class-repair';
import { currentClassSections } from './learning/classes/current-sections';
import {
  ClassGenerationCancelledError,
  claimClassRegeneration,
  withClassGeneration,
  settleClassGenerationFailure,
  publishClassGeneration,
} from './learning/classes/class-generation-state';
import type { SkillType, CefrLevel, SkillRequirements } from '@sotto/shared';

const MC_SKILLS: SkillType[] = ['GRAMMAR', 'READING'];

export class CourseNotFoundError extends Error {}
export { ClassGenerationCancelledError };

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

function selectNextLesson(
  lessons: LessonLike[],
  currentLevel: CefrLevel,
  passedSet: Set<string>
): LessonLike | undefined {
  const currentRank = cefrRank(currentLevel);
  return lessons.find(
    (lesson) => !passedSet.has(lesson.id) && cefrRank(lesson.level as CefrLevel) >= currentRank
  );
}

function isBelowCourseLevel(lessonLevel: string, currentLevel: string): boolean {
  return cefrRank(lessonLevel as CefrLevel) < cefrRank(currentLevel as CefrLevel);
}

async function clearActiveClassGate(classId: string, courseId: string): Promise<void> {
  await prisma.$transaction([
    prisma.courseClass.delete({ where: { id: classId } }),
    prisma.course.update({ where: { id: courseId }, data: { activeClassId: null } }),
  ]);
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

async function rethrowIfGenerationWasCancelled(classId: string, attempt: number, error: unknown) {
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
interface SectionOverride {
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
  over?: SectionOverride
): Promise<void> {
  await assertClassStillGenerating(classId, attempt);
  const { grammarPoints, targetVocab } = lessonInputs(lesson);
  const section = await withClassGeneration(execution, classId, attempt, (database) =>
    database.classSection.create({
      data: {
        classId,
        skill,
        attempt,
        seed: `${classId}-${skill}-${attempt}`,
        spec: { lessonSlug: lesson.slug },
        status: 'GENERATING',
      },
    })
  );
  await assertClassStillGenerating(classId, attempt);
  const questions = await generateSectionQuestions({
    userId,
    execution,
    skill,
    level: over?.level ?? lesson.level,
    nativeLang,
    targetLang,
    objective: over?.objective ?? lesson.objective,
    grammarPoints,
    targetVocab,
    seed: section.seed,
    note,
    sourceContent: over?.sourceContent,
  });
  await assertClassStillGenerating(classId, attempt);
  await withClassGeneration(execution, classId, attempt, async (database) => {
    for (const [i, q] of questions.entries())
      await database.lessonQuestion.create({
        data: {
          sectionId: section.id,
          order: i + 1,
          skill,
          question: q.question,
          options: q.options,
          correctIndex: q.correctIndex,
          explanation: q.explanation,
          passageRef: q.passageRef ?? null,
          passageText: q.passageText ?? null,
        },
      });
    await database.classSection.update({
      where: { id: section.id },
      data: { status: 'READY', generatedAt: new Date() },
    });
  });
  await assertClassStillGenerating(classId, attempt);
  if (skill === 'READING') {
    const stored = await prisma.lessonQuestion.findMany({
      where: { sectionId: section.id },
      orderBy: { order: 'asc' },
      select: { id: true, question: true, options: true, passageText: true },
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
      await seedLessonItems(
        courseId,
        classId,
        (over?.level ?? lesson.level) as CefrLevel,
        readingVocabulary.words,
        [],
        database
      );
      await database.courseClass.update({ where: { id: classId }, data: { readingVocabulary } });
    });
  }
}

function noteForAttempt(note: string, classId: string, attempt: number): string {
  const variation = `Class attempt ${attempt} for ${classId}: generate a fresh variation. Do not reuse the same examples, questions, prompts, or distractors from earlier attempts.`;
  return [note, variation].filter(Boolean).join('\n\n');
}

export type NextClassResult =
  | { kind: 'gated'; activeClassId: string; status: string }
  | { kind: 'done' }
  | { kind: 'created'; classId: string };

/** Sourced class: build the next class around a real link/paper or an interest topic. */
export interface SourcedClassOpts {
  /** A link / news / paper / YouTube URL to extract, CEFR-level, and build the class from. */
  sourceUrl?: string;
  /** A topic (e.g. from the learner's interests) — web-search-seeded when no URL. */
  topic?: string;
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
  existingSeed?: Prisma.InputJsonObject;
  deferAudio?: boolean;
  execution: import('@/lib/sidedoor/credentials/runtime/provider-execution').SottoProviderExecution;
  classId: string;
  courseId: string;
  userId: string;
  course: ClassBuildCourse;
  lesson: LessonLike;
  attempt: number;
  sourceTitle: string | null;
  override?: SectionOverride;
  listeningSource?: {
    sourceContent?: string;
    sourceMetadata?: PreparedClassSource['sourceMetadata'];
    sourceUrl?: string;
  };
}

async function buildClassContent(p: ClassContentBuildParams): Promise<Prisma.InputJsonObject> {
  const note = noteForAttempt(
    buildLearnerContext(
      await getCourseNote(p.courseId),
      p.course.pedagogy as Parameters<typeof buildLearnerContext>[1]
    ),
    p.classId,
    p.attempt
  );
  await assertClassStillGenerating(p.classId, p.attempt);
  const { grammarPoints, targetVocab } = lessonInputs(p.lesson);
  const lessonLevel = p.requirements.level;
  const lessonObjective = p.override?.objective ?? p.lesson.objective;

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

  for (const skill of MC_SKILLS) {
    if (p.skills && !p.skills.has(skill)) continue;
    await buildSection(
      p.classId,
      p.courseId,
      p.userId,
      p.execution,
      skill,
      { ...p.lesson, level: p.requirements.level },
      p.requirements.nativeLang,
      p.requirements.targetLang,
      note,
      p.attempt,
      { ...p.override, level: p.requirements.level }
    );
  }
  await assertClassStillGenerating(p.classId, p.attempt);

  await withClassGeneration(p.execution, p.classId, p.attempt, (database) =>
    seedLessonItems(p.courseId, p.classId, lessonLevel, targetVocab, grammarPoints, database)
  );
  await assertClassStillGenerating(p.classId, p.attempt);
  const due = await getDueItems(p.courseId);
  await assertClassStillGenerating(p.classId, p.attempt);

  // These generated skills are required class surfaces. If one fails, the class
  // is not published; createNextClass rolls back, regenerateCurrentClass marks
  // the attempt FAILED, and the learner can regenerate a real class.
  if (
    p.requirements.skills.LISTENING.state === 'REQUIRED' &&
    (!p.skills || p.skills.has('LISTENING'))
  )
    try {
      await assertClassStillGenerating(p.classId, p.attempt);
      await generateClassListening({
        ttsProvider: p.requirements.ttsProvider as Parameters<
          typeof generateClassListening
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
        mustIncludeVocab: due.vocab.map((v) => ({ word: v.lemma, translation: v.translation })),
        note,
        sourceContent: p.listeningSource?.sourceContent,
        sourceMetadata: p.listeningSource?.sourceMetadata,
        sourceUrl: p.listeningSource?.sourceUrl,
      });
      await assertClassStillGenerating(p.classId, p.attempt);
    } catch (err) {
      await rethrowIfGenerationWasCancelled(p.classId, p.attempt, err);
      logger.error('Required listening section generation failed', {
        classId: p.classId,
        error: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }

  if (
    p.requirements.skills.SPEAKING.state === 'REQUIRED' &&
    (!p.skills || p.skills.has('SPEAKING'))
  )
    try {
      await assertClassStillGenerating(p.classId, p.attempt);
      await generateClassSpeaking({
        ttsProvider: p.requirements.ttsProvider as Parameters<
          typeof generateClassSpeaking
        >[0]['ttsProvider'],
        referenceAudioRequired: p.requirements.referenceAudioRequired,
        execution: p.execution,
        userId: p.userId,
        classId: p.classId,
        attempt: p.attempt,
        level: lessonLevel,
        nativeLang: p.requirements.nativeLang,
        targetLang: p.requirements.targetLang,
        objective: lessonObjective,
        targetVocab,
        note,
      });
      await assertClassStillGenerating(p.classId, p.attempt);
    } catch (err) {
      await rethrowIfGenerationWasCancelled(p.classId, p.attempt, err);
      logger.error('Required speaking section generation failed', {
        classId: p.classId,
        error: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }

  if (!p.skills || p.skills.has('WRITING'))
    try {
      await assertClassStillGenerating(p.classId, p.attempt);
      await generateClassWriting({
        userId: p.userId,
        execution: p.execution,
        classId: p.classId,
        attempt: p.attempt,
        level: lessonLevel,
        nativeLang: p.requirements.nativeLang,
        targetLang: p.requirements.targetLang,
        objective: lessonObjective,
        targetVocab,
        note,
      });
      await assertClassStillGenerating(p.classId, p.attempt);
    } catch (err) {
      await rethrowIfGenerationWasCancelled(p.classId, p.attempt, err);
      logger.error('Required writing section generation failed', {
        classId: p.classId,
        error: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }

  await assertClassStillGenerating(p.classId, p.attempt);
  return {
    ...p.existingSeed,
    vocabIds: due.vocab.map((v) => v.id),
    grammarKeys: due.grammar.map((g) => g.topicKey),
    dueCount: due.vocab.length + due.grammar.length,
    intro: intro as unknown as Prisma.InputJsonObject,
  };
}

export async function createNextClass(
  courseId: string,
  userId: string,
  execution: import('@/lib/sidedoor/credentials/runtime/provider-execution').SottoProviderExecution,
  opts?: SourcedClassOpts,
  lifecycle?: {
    deferAudio?: boolean;
    requirements?: SkillRequirements;
    create: (data: Prisma.CourseClassUncheckedCreateInput) => Promise<{ id: string }>;
    publish: (classId: string, adaptiveSeed: Prisma.InputJsonObject) => Promise<void>;
  }
): Promise<NextClassResult> {
  const initialCourse = await prisma.course.findFirst({
    where: { id: courseId, userId },
    include: { curriculum: { include: { lessons: { orderBy: { order: 'asc' } } } } },
  });
  if (!initialCourse) throw new CourseNotFoundError('Course not found');
  let course = initialCourse;

  // Gating: only one non-passed class at a time.
  const active = await prisma.courseClass.findFirst({
    where: { courseId, status: { not: 'PASSED' } },
    include: { lesson: { select: { level: true } } },
    orderBy: { order: 'asc' },
  });
  if (active) {
    if (isBelowCourseLevel(active.lesson.level, course.currentLevel)) {
      await clearActiveClassGate(active.id, courseId);
    } else {
      return { kind: 'gated', activeClassId: active.id, status: active.status };
    }
  }

  const passed = await prisma.courseClass.findMany({
    where: { courseId, status: 'PASSED' },
    select: { lessonId: true },
  });
  const passedSet = new Set(passed.map((p) => p.lessonId));
  if (!course.curriculum.lessons.some((lesson) => lesson.level === course.currentLevel)) {
    await ensureCurriculumHasLevelLessons({
      userId,
      execution,
      curriculumId: course.curriculumId,
      nativeLang: course.nativeLang,
      targetLang: course.targetLang,
      level: course.currentLevel,
    });
    const refreshedCourse = await prisma.course.findFirst({
      where: { id: courseId, userId },
      include: { curriculum: { include: { lessons: { orderBy: { order: 'asc' } } } } },
    });
    if (!refreshedCourse) throw new CourseNotFoundError('Course not found');
    course = refreshedCourse;
  }

  const lesson = selectNextLesson(course.curriculum.lessons, course.currentLevel, passedSet);
  if (!lesson) return { kind: 'done' };

  // Sourced mode: prepare the source BEFORE creating the class so a failed
  // extraction never leaves a half-built class. Authentic content levels to the
  // learner's current CEFR, not the lesson's fixed level. A ClassSourceError here
  // propagates (the route surfaces it); curriculum classes skip this entirely.
  let prepared: PreparedClassSource | null = null;
  let sourceTitle: string | null = null;
  let sourceUrl: string | null = null;
  let override: SectionOverride | undefined;
  let listeningSource: {
    sourceContent?: string;
    sourceMetadata?: PreparedClassSource['sourceMetadata'];
    sourceUrl?: string;
  } = {};

  if (opts?.sourceUrl) {
    prepared = await prepareClassSource({
      url: opts.sourceUrl,
      level: course.currentLevel,
      targetLang: course.targetLang,
      nativeLang: course.nativeLang,
      userId,
      execution,
    });
    sourceTitle = prepared.title;
    sourceUrl = prepared.sourceUrl;
    override = {
      level: course.currentLevel,
      objective: prepared.title ?? lesson.objective,
      sourceContent: prepared.leveledContent,
    };
    listeningSource = {
      sourceContent: prepared.leveledContent,
      sourceMetadata: prepared.sourceMetadata,
      sourceUrl: prepared.sourceUrl,
    };
  } else if (opts?.topic) {
    // Topic mode: no extracted text; the listening script web-searches the topic
    // for citations, and sections are built about the topic at the learner's level.
    sourceTitle = opts.topic;
    override = { level: course.currentLevel, objective: opts.topic };
  }

  const requirements =
    lifecycle?.requirements ??
    (await resolveSkillRequirements(execution, {
      scope: 'CLASS',
      nativeLang: course.nativeLang,
      targetLang: course.targetLang,
      level: (override?.level ?? lesson.level) as CefrLevel,
    }));
  const classData: Prisma.CourseClassUncheckedCreateInput = {
    courseId,
    lessonId: lesson.id,
    order: lesson.order,
    status: 'GENERATING',
    sourceUrl,
    sourceTitle,
    skillRequirements: requirements as unknown as Prisma.InputJsonValue,
  };
  const cls = lifecycle
    ? await lifecycle.create(classData)
    : await prisma.courseClass.create({ data: classData });

  let adaptiveSeed: Prisma.InputJsonObject;
  try {
    adaptiveSeed = await buildClassContent({
      requirements,
      deferAudio: lifecycle?.deferAudio,
      execution,
      classId: cls.id,
      courseId,
      userId,
      course,
      lesson,
      attempt: 1,
      sourceTitle,
      override,
      listeningSource,
    });
  } catch (err) {
    await rethrowIfGenerationWasCancelled(cls.id, 1, err);
    // Roll back the half-built class so the learner can retry cleanly.
    if (!lifecycle) await prisma.courseClass.delete({ where: { id: cls.id } }).catch(() => {});
    throw err;
  }
  if (lifecycle) {
    await lifecycle.publish(cls.id, adaptiveSeed);
    return { kind: 'created', classId: cls.id };
  }
  try {
    await withClassGeneration(execution, cls.id, 1, (database) =>
      publishClassGeneration(database, {
        classId: cls.id,
        attempt: 1,
        userId,
        data: { adaptiveSeed },
      })
    );
  } catch (error) {
    await settleClassGenerationFailure(cls.id, 1, userId);
    throw error;
  }
  return { kind: 'created', classId: cls.id };
}

export async function regenerateCurrentClass(
  classId: string,
  userId: string,
  execution: import('@/lib/sidedoor/credentials/runtime/provider-execution').SottoProviderExecution,
  pristineSnapshot?: string,
  lifecycle?: {
    repair?: boolean;
    skills?: readonly SkillType[];
    requirements?: SkillRequirements;
    attempt?: number;
    deferAudio?: boolean;
    publish?: (
      adaptiveSeed: Prisma.InputJsonObject,
      source: { sourceTitle: string | null; sourceUrl: string | null }
    ) => Promise<void>;
  }
): Promise<boolean> {
  if (execution.userId !== userId) throw new Error('Class regeneration owner changed.');
  const cls = pristineSnapshot
    ? await validatePristineRegeneration(classId, execution, pristineSnapshot)
    : await prisma.courseClass.findFirst({
        where: { id: classId, course: { userId } },
        include: {
          lesson: true,
          course: true,
          sections: {
            include: {
              questions: true,
              prompts: true,
              writingPrompts: true,
              episode: { include: { script: true } },
            },
          },
        },
      });
  if (!cls || cls.status === 'PASSED') return false;
  if (cls.status === 'GENERATING' && !lifecycle?.attempt)
    throw new Error('Class is already regenerating.');

  const requirements =
    lifecycle?.requirements ??
    readSkillRequirements(cls.skillRequirements) ??
    (await resolveSkillRequirements(execution, {
      scope: 'CLASS',
      nativeLang: cls.course.nativeLang,
      targetLang: cls.course.targetLang,
      level: (cls.sourceUrl || cls.sourceTitle
        ? cls.course.currentLevel
        : cls.lesson.level) as CefrLevel,
    }));
  const attempt =
    lifecycle?.attempt ??
    (pristineSnapshot
      ? (await claimPristineRegeneration(classId, execution, pristineSnapshot, requirements))
          .attempt
      : await claimClassRegeneration(execution, classId, cls, requirements));
  const repair = lifecycle?.repair === true;
  const skills = repair
    ? new Set(
        lifecycle?.skills ??
          (await prismaUnfiltered.$transaction((database) =>
            selectClassRepairSkills(database, cls, requirements)
          ))
      )
    : undefined;

  let sourceTitle = cls.sourceTitle;
  let sourceUrl = cls.sourceUrl;
  let override: SectionOverride | undefined;
  let listeningSource:
    | {
        sourceContent?: string;
        sourceMetadata?: PreparedClassSource['sourceMetadata'];
        sourceUrl?: string;
      }
    | undefined;

  try {
    // Earlier material stays intact while the claimed generation prepares its source.
    if (repair) {
      const passage = currentClassSections(cls.sections)
        .find((section) => section.skill === 'READING')
        ?.questions.find((question) => question.passageText)?.passageText;
      override = {
        level: requirements.level,
        objective: cls.sourceTitle ?? cls.lesson.objective,
        ...(cls.sourceUrl && passage ? { sourceContent: passage } : {}),
      };
      listeningSource = {
        sourceContent: passage ?? undefined,
        sourceUrl: cls.sourceUrl ?? undefined,
      };
    } else if (cls.sourceUrl) {
      const prepared = await prepareClassSource({
        url: cls.sourceUrl,
        level: requirements.level,
        targetLang: requirements.targetLang,
        nativeLang: requirements.nativeLang,
        userId,
        execution,
      });
      sourceTitle = prepared.title;
      sourceUrl = prepared.sourceUrl;
      override = {
        level: requirements.level,
        objective: prepared.title ?? cls.lesson.objective,
        sourceContent: prepared.leveledContent,
      };
      listeningSource = {
        sourceContent: prepared.leveledContent,
        sourceMetadata: prepared.sourceMetadata,
        sourceUrl: prepared.sourceUrl,
      };
    } else if (cls.sourceTitle) {
      override = { level: requirements.level, objective: cls.sourceTitle };
    }
    if (repair && !skills?.has('READING'))
      await repairClassReadingMemory(cls, requirements, execution, attempt);
    const adaptiveSeed = await buildClassContent({
      requirements,
      skills,
      deferAudio: lifecycle?.deferAudio,
      existingSeed:
        repair &&
        cls.adaptiveSeed &&
        typeof cls.adaptiveSeed === 'object' &&
        !Array.isArray(cls.adaptiveSeed)
          ? (cls.adaptiveSeed as Prisma.InputJsonObject)
          : undefined,
      execution,
      classId,
      courseId: cls.courseId,
      userId,
      course: cls.course,
      lesson: cls.lesson,
      attempt,
      sourceTitle,
      override,
      listeningSource,
    });
    if (lifecycle?.publish) await lifecycle.publish(adaptiveSeed, { sourceTitle, sourceUrl });
    else
      await withClassGeneration(execution, classId, attempt, (database) =>
        publishClassGeneration(database, {
          classId,
          attempt,
          userId,
          status: repair ? 'IN_PROGRESS' : 'AVAILABLE',
          data: { adaptiveSeed, sourceTitle, sourceUrl },
        })
      );
    return true;
  } catch (err) {
    await rethrowIfGenerationWasCancelled(classId, attempt, err);
    if (!lifecycle?.attempt) await settleClassGenerationFailure(classId, attempt, userId);
    throw err;
  }
}

export async function deleteClassForUser(classId: string, userId: string): Promise<boolean> {
  const cls = await prisma.courseClass.findFirst({
    where: { id: classId, course: { userId } },
    select: {
      id: true,
      courseId: true,
      course: { select: { activeClassId: true } },
    },
  });
  if (!cls) return false;

  await prisma.$transaction([
    prisma.courseClass.delete({ where: { id: classId } }),
    ...(cls.course.activeClassId === classId
      ? [prisma.course.update({ where: { id: cls.courseId }, data: { activeClassId: null } })]
      : []),
  ]);
  return true;
}

export async function getClassForUser(classId: string, userId: string) {
  const cls = await prisma.courseClass.findFirst({
    where: { id: classId, course: { userId } },
    include: {
      sections: {
        orderBy: { skill: 'asc' },
        include: {
          questions: { orderBy: { order: 'asc' } },
          prompts: {
            orderBy: { order: 'asc' },
            include: {
              recordings: {
                where: { userId },
                orderBy: { createdAt: 'desc' },
                take: 1,
                select: {
                  id: true,
                  attempt: true,
                  status: true,
                  transcript: true,
                  overallScore: true,
                  rubricScores: true,
                  phonemeScores: true,
                  feedback: true,
                  createdAt: true,
                },
              },
            },
          },
          writingPrompts: {
            orderBy: { order: 'asc' },
            include: { responses: { where: { userId }, orderBy: { createdAt: 'desc' }, take: 1 } },
          },
          episode: {
            select: {
              id: true,
              audioUrl: true,
              status: true,
              title: true,
              failureReason: true,
              technicalError: true,
              // Sourced-class sources: render via ReferenceList with verification badges.
              references: {
                orderBy: { number: 'asc' },
                select: {
                  number: true,
                  title: true,
                  authors: true,
                  year: true,
                  url: true,
                  type: true,
                  verificationStatus: true,
                  contentDomain: true,
                },
              },
            },
          },
        },
      },
      lesson: {
        select: {
          title: true,
          level: true,
          objective: true,
          grammarPoints: true,
          targetVocab: true,
        },
      },
      course: { select: { nativeLang: true, targetLang: true } },
      submission: { select: { passed: true, overallScore: true, submittedAt: true } },
    },
  });
  if (!cls) return null;
  cls.sections = currentClassSections(cls.sections);
  for (const section of cls.sections) {
    for (const prompt of section.prompts)
      prompt.recordings = prompt.recordings.filter(
        (recording) => recording.attempt === section.attempt
      );
    for (const prompt of section.writingPrompts)
      prompt.responses = prompt.responses.filter(
        (response) => response.attempt === section.attempt
      );
  }
  const questionIds = new Set(
    cls.sections.flatMap((section) => section.questions.map((question) => question.id))
  );
  if (
    cls.learnerAnswers &&
    typeof cls.learnerAnswers === 'object' &&
    !Array.isArray(cls.learnerAnswers)
  )
    cls.learnerAnswers = Object.fromEntries(
      Object.entries(cls.learnerAnswers).filter(([id]) => questionIds.has(id))
    );
  return cls;
}

export {
  submitClass,
  ClassIncompleteError,
  type SubmitResult,
} from './learning/classes/class-submission';

/** Repair only failed or incomplete skills, keeping complete current material and its evidence. */
export async function regenerateFailedSections(
  classId: string,
  userId: string,
  execution: import('@/lib/sidedoor/credentials/runtime/provider-execution').SottoProviderExecution
): Promise<boolean> {
  return regenerateCurrentClass(classId, userId, execution, undefined, { repair: true });
}
