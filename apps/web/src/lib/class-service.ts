// Class lifecycle: instantiate the next gated class from the curriculum,
// generate its MC sections, grade submissions, and regenerate failed sections
// in a different form (retrieval practice / anti-copy).
import { Prisma } from '@/generated/prisma/client';
import type { CefrLevel, SkillRequirements, SkillType } from '@sotto/shared';
import { prepareClassSource, type PreparedClassSource } from './class-source';
import { classTargetsFromSeed } from './classes/lesson/class-targets';
import { teachingFromSeed } from './classes/lesson/teaching';
import {
  claimPristineRegeneration,
  validatePristineRegeneration,
} from './classes/regeneration/pristine';
import { SectionQualityError } from './classes/section-quality';
import { ensureCurriculumHasLevelLessons } from './curriculum-generator';
import {
  claimClassRegeneration,
  ClassGenerationCancelledError,
  publishClassGeneration,
  settleClassGenerationFailure,
  withClassGeneration,
} from './learning/classes/formative/class-generation-state';
import {
  assertRepairQuizPreserved,
  repairClassReadingMemory,
  selectClassRepairSkills,
} from './learning/classes/formative/class-repair';
import { currentClassSections } from './learning/classes/progress/current-sections';
import { classQuizHistory } from './learning/classes/progress/quiz-history';
import { readSkillRequirements, resolveSkillRequirements } from './learning/skill-requirements';
import { prisma, prismaUnfiltered } from './prisma';

import {
  buildClassContent,
  rethrowIfGenerationWasCancelled,
  type SectionOverride,
} from './classes/generation/class-content';
export { deleteClassForUser } from './classes/deletion/class-deletion';
export { ClassGenerationCancelledError };

export class CourseNotFoundError extends Error {}

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

function selectNextLesson(
  lessons: LessonLike[],
  currentLevel: CefrLevel,
  passedSet: Set<string>
): LessonLike | undefined {
  return lessons.find((lesson) => !passedSet.has(lesson.id) && lesson.level === currentLevel);
}

export type NextClassResult =
  | { kind: 'gated'; activeClassId: string; status: string }
  | { kind: 'done' }
  | { kind: 'requirements' }
  | { kind: 'created'; classId: string };

/** Sourced class: build the next class around a real link/paper or an interest topic. */
export interface SourcedClassOpts {
  /** A link / news / paper / YouTube URL to extract, CEFR-level, and build the class from. */
  sourceUrl?: string;
  /** A topic (e.g. from the learner's interests) — web-search-seeded when no URL. */
  topic?: string;
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
    publish: (
      classId: string,
      adaptiveSeed: Prisma.InputJsonObject,
      requireTeachingProof: boolean
    ) => Promise<void>;
  }
): Promise<NextClassResult> {
  const initialA1Policy = execution.initialA1Class;
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
    return { kind: 'gated', activeClassId: active.id, status: active.status };
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
  if (!lesson) return { kind: 'requirements' };

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
    if (execution.initialA1Class !== initialA1Policy)
      throw new SectionQualityError('The initial A1 teaching policy changed during generation.');
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
      sourceUrl,
      sourceBefore: { title: sourceTitle, url: sourceUrl },
      override,
      listeningSource,
    });
    if (execution.initialA1Class !== initialA1Policy)
      throw new SectionQualityError('The initial A1 teaching policy changed during generation.');
  } catch (err) {
    await rethrowIfGenerationWasCancelled(cls.id, 1, err);
    // Roll back the half-built class so the learner can retry cleanly.
    if (!lifecycle) await prisma.courseClass.delete({ where: { id: cls.id } }).catch(() => {});
    throw err;
  }
  const requireTeachingProof = requirements.level === 'A1' && initialA1Policy === true;
  if (lifecycle) {
    await lifecycle.publish(cls.id, adaptiveSeed, requireTeachingProof);
    return { kind: 'created', classId: cls.id };
  }
  try {
    await withClassGeneration(execution, cls.id, 1, (database) =>
      publishClassGeneration(database, {
        classId: cls.id,
        attempt: 1,
        userId,
        requireInitialA1TeachingProof: requireTeachingProof,
        requireInitialA1SectionProof: requireTeachingProof,
        requireInitialA1WritingProof: requireTeachingProof,
        requireInitialA1SpeakingProof: requireTeachingProof,
        requireInitialA1ListeningProof: requireTeachingProof,
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
    retry?: import('./classes/quiz/retry').QuizRetryContext;
    retrySection?: { sectionId: string; skill: SkillType };
    skills?: readonly SkillType[];
    requirements?: SkillRequirements;
    attempt?: number;
    deferAudio?: boolean;
    publish?: (
      adaptiveSeed: Prisma.InputJsonObject,
      source: { sourceTitle: string | null; sourceUrl: string | null },
      requireTeachingProof: boolean
    ) => Promise<void>;
  }
): Promise<boolean> {
  const initialA1Policy = execution.initialA1Class;
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
  const repair = lifecycle?.repair === true;
  const skills = repair
    ? new Set(
        lifecycle?.skills ??
          (await prismaUnfiltered.$transaction((database) =>
            selectClassRepairSkills(database, cls, requirements)
          ))
      )
    : undefined;
  if (repair && skills?.has('READING') && !execution.stageClassReading)
    throw new Error('Reading repair requires a durable staging operation.');
  if (repair && skills?.has('WRITING') && !execution.stageClassWriting)
    throw new Error('Writing repair requires a durable staging operation.');
  if (
    repair &&
    skills?.has('SPEAKING') &&
    (!execution.speakingRepairSourceHash ||
      !execution.stageClassSpeaking ||
      !execution.verifySpeakingReferenceStage ||
      !execution.sealClassSpeaking)
  )
    throw new Error('Speaking repair requires a durable staging operation.');
  if (
    repair &&
    skills?.has('GRAMMAR') &&
    (!execution.stageClassGrammar || !execution.grammarRepairSourceHash)
  )
    throw new Error('Grammar repair requires a durable staging operation.');
  const attempt =
    lifecycle?.attempt ??
    (pristineSnapshot
      ? (await claimPristineRegeneration(classId, execution, pristineSnapshot, requirements))
          .attempt
      : await claimClassRegeneration(execution, classId, cls, requirements));

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
    if (execution.initialA1Class !== initialA1Policy)
      throw new SectionQualityError('The initial A1 teaching policy changed during generation.');
    if (repair && skills)
      await withClassGeneration(execution, classId, attempt, (database) =>
        assertRepairQuizPreserved(database, classId, attempt, [...skills], lifecycle?.retrySection)
      );
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
    if (repair && !lifecycle?.retry && !skills?.has('READING'))
      await repairClassReadingMemory(cls, requirements, execution, attempt);
    const adaptiveSeed = await buildClassContent({
      requirements,
      skills,
      preserveTeaching: repair,
      retry: lifecycle?.retry,
      retrySection: lifecycle?.retrySection,
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
      sourceUrl,
      sourceBefore: { title: cls.sourceTitle, url: cls.sourceUrl },
      override,
      listeningSource,
    });
    const requireTeachingProof = !repair && requirements.level === 'A1' && initialA1Policy === true;
    if (execution.initialA1Class !== initialA1Policy)
      throw new SectionQualityError('The initial A1 teaching policy changed during generation.');
    if (lifecycle?.publish)
      await lifecycle.publish(adaptiveSeed, { sourceTitle, sourceUrl }, requireTeachingProof);
    else
      await withClassGeneration(execution, classId, attempt, (database) =>
        publishClassGeneration(database, {
          classId,
          attempt,
          userId,
          requireInitialA1TeachingProof: requireTeachingProof,
          requireInitialA1SectionProof: requireTeachingProof,
          requireInitialA1WritingProof: requireTeachingProof,
          requireInitialA1SpeakingProof: requireTeachingProof,
          requireInitialA1ListeningProof: requireTeachingProof,
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

export async function getClassForUser(
  classId: string,
  userId: string,
  database: Pick<Prisma.TransactionClient, 'courseClass' | 'speakingRecording'> = prismaUnfiltered
) {
  const cls = await database.courseClass.findFirst({
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
                orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
                select: {
                  id: true,
                  sectionId: true,
                  practiceSessionId: true,
                  examSectionId: true,
                  assessmentSectionId: true,
                  attempt: true,
                  status: true,
                  gradingAcknowledgedAt: true,
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
            include: {
              responses: {
                where: { userId },
                orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
                select: {
                  id: true,
                  sectionId: true,
                  attempt: true,
                  text: true,
                  overallScore: true,
                  corrections: true,
                  feedback: true,
                  createdAt: true,
                },
              },
            },
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
      submission: {
        select: {
          userId: true,
          attempt: true,
          passed: true,
          overallScore: true,
          submittedAt: true,
          receipt: true,
          history: true,
          answers: {
            select: { sectionId: true, questionId: true, selectedIndex: true, isCorrect: true },
            orderBy: { id: 'asc' },
          },
        },
      },
    },
  });
  if (!cls) return null;
  const activeSections = currentClassSections(cls.sections);
  const activeIds = new Set(activeSections.map((section) => section.id));
  const quizHistory = classQuizHistory({
    userId,
    sections: cls.sections,
    activeSectionIds: activeIds,
    learnerAnswers: cls.learnerAnswers,
    submission: cls.submission,
  });
  if (cls.submission && cls.submission.userId !== userId) cls.submission = null;
  const drafts =
    cls.writingDrafts && typeof cls.writingDrafts === 'object' && !Array.isArray(cls.writingDrafts)
      ? cls.writingDrafts
      : {};
  const knownPromptIds = new Set(
    cls.sections
      .filter((section) => !section.withdrawn)
      .flatMap((section) => section.writingPrompts.map((prompt) => prompt.id))
  );
  const orphanWritingDrafts = Object.entries(drafts)
    .filter(([id, text]) => !knownPromptIds.has(id) && typeof text === 'string')
    .map(([id, text]) => ({ id, text: text as string }));
  const writingHistory = cls.sections
    .filter(
      (section) => section.skill === 'WRITING' && !section.withdrawn && !activeIds.has(section.id)
    )
    .sort((a, b) => b.attempt - a.attempt || a.id.localeCompare(b.id))
    .map((section) => ({
      sectionId: section.id,
      attempt: section.attempt,
      prompts: section.writingPrompts.map((prompt) => ({
        id: prompt.id,
        order: prompt.order,
        task: prompt.task,
        savedDraft: typeof drafts[prompt.id] === 'string' ? drafts[prompt.id] : null,
        responses: prompt.responses
          .filter((response) => response.sectionId === null || response.sectionId === section.id)
          .map((response) => ({
            id: response.id,
            attempt: response.attempt,
            attemptMatches: response.attempt === section.attempt,
            text: response.text,
            overallScore: response.overallScore,
            corrections: response.corrections,
            feedback: response.feedback,
            createdAt: response.createdAt,
          })),
      })),
    }));
  const speakingLinkMatches = (
    sectionId: string,
    prompt: {
      sectionId: string | null;
      practiceSessionId: string | null;
      examSectionId: string | null;
      assessmentSectionId: string | null;
    },
    recording: {
      sectionId: string | null;
      practiceSessionId: string | null;
      examSectionId: string | null;
      assessmentSectionId: string | null;
    }
  ) =>
    prompt.sectionId === sectionId &&
    !prompt.practiceSessionId &&
    !prompt.examSectionId &&
    !prompt.assessmentSectionId &&
    (recording.sectionId === null || recording.sectionId === sectionId) &&
    !recording.practiceSessionId &&
    !recording.examSectionId &&
    !recording.assessmentSectionId;
  const visibleSpeakingSections = cls.sections.filter(
    (section) => section.skill === 'SPEAKING' && !section.withdrawn
  );
  const nestedSpeakingRecordingIds = new Set(
    visibleSpeakingSections.flatMap((section) =>
      section.prompts.flatMap((prompt) => prompt.recordings.map((recording) => recording.id))
    )
  );
  const detachedSpeakingRecordings = visibleSpeakingSections.length
    ? await database.speakingRecording.findMany({
        where: {
          userId,
          sectionId: { in: visibleSpeakingSections.map((section) => section.id) },
          id: { notIn: [...nestedSpeakingRecordingIds] },
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
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
      })
    : [];
  const speakingHistoryUnlinked = cls.sections
    .filter((section) => section.skill === 'SPEAKING' && !section.withdrawn)
    .flatMap((section) =>
      section.prompts.flatMap((prompt) =>
        prompt.recordings
          .filter((recording) => !speakingLinkMatches(section.id, prompt, recording))
          .map((recording) => ({
            id: recording.id,
            attempt: recording.attempt,
            status: recording.status,
            transcript: recording.transcript,
            overallScore: recording.overallScore,
            rubricScores: recording.rubricScores,
            phonemeScores: recording.phonemeScores,
            feedback: recording.feedback,
            createdAt: recording.createdAt,
          }))
      )
    )
    .concat(detachedSpeakingRecordings);
  const speakingHistory = cls.sections
    .filter((section) => section.skill === 'SPEAKING' && !section.withdrawn)
    .sort((a, b) => b.attempt - a.attempt || a.id.localeCompare(b.id))
    .map((section) => ({
      sectionId: section.id,
      attempt: section.attempt,
      prompts: section.prompts
        .map((prompt) => {
          const owned = prompt.recordings.filter((recording) =>
            speakingLinkMatches(section.id, prompt, recording)
          );
          const current = activeIds.has(section.id)
            ? owned.find((recording) => recording.attempt === section.attempt)
            : undefined;
          return {
            id: prompt.id,
            order: prompt.order,
            targetPhrase: prompt.targetPhrase,
            translation: prompt.translation,
            recordings: owned
              .filter((recording) => recording.id !== current?.id)
              .map((recording) => ({
                id: recording.id,
                attempt: recording.attempt,
                attemptMatches: recording.attempt === section.attempt,
                status: recording.status,
                transcript: recording.transcript,
                overallScore: recording.overallScore,
                rubricScores: recording.rubricScores,
                phonemeScores: recording.phonemeScores,
                feedback: recording.feedback,
                createdAt: recording.createdAt,
              })),
          };
        })
        .filter((prompt) => prompt.recordings.length > 0),
    }))
    .filter((section) => section.prompts.length > 0);
  cls.sections = activeSections;
  for (const section of cls.sections) {
    for (const prompt of section.prompts)
      prompt.recordings = prompt.recordings
        .filter(
          (recording) =>
            recording.attempt === section.attempt &&
            speakingLinkMatches(section.id, prompt, recording)
        )
        .slice(0, 1);
    for (const prompt of section.writingPrompts)
      prompt.responses = prompt.responses
        .filter((response) => response.attempt === section.attempt)
        .slice(0, 1);
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
  const teaching = teachingFromSeed(cls.adaptiveSeed);
  const targets = classTargetsFromSeed(cls.adaptiveSeed);
  return {
    ...cls,
    ...quizHistory,
    writingHistory,
    speakingHistory,
    speakingHistoryUnlinked,
    orphanWritingDrafts,
    ...(targets
      ? {
          lesson: {
            ...cls.lesson,
            targetVocab: targets.vocab,
            grammarPoints: targets.grammarPoints,
          },
        }
      : {}),
    ...(teaching ? { teaching } : {}),
  };
}

export { ClassIncompleteError, submitClass } from './learning/classes/progress/class-submission';
