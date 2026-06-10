// Class lifecycle: instantiate the next gated class from the curriculum,
// generate its MC sections, grade submissions, and regenerate failed sections
// in a different form (retrieval practice / anti-copy).
import { prisma } from './prisma';
import { generateSectionQuestions } from './class-generation';
import { seedLessonItems, getDueItems, applyReviewOutcome } from './knowledge-graph';
import { generateClassListening } from './class-listening-generator';
import { prepareClassSource, type PreparedClassSource } from './class-source';
import { generateClassSpeaking } from './class-speaking-generator';
import { generateClassWriting } from './class-writing-generator';
import { getCourseNote } from './course-notes';
import { buildLearnerContext } from './pedagogy';
import { logger } from './logger';
import type { SkillType, CefrLevel } from '@sotto/shared';

const MC_SKILLS: SkillType[] = ['GRAMMAR', 'READING'];

export class CourseNotFoundError extends Error {}

interface LessonLike {
  id: string;
  level: string;
  order: number;
  slug: string;
  objective: string;
  grammarPoints: unknown;
  targetVocab: unknown;
}

function lessonInputs(lesson: LessonLike) {
  return {
    grammarPoints: (Array.isArray(lesson.grammarPoints) ? lesson.grammarPoints : []) as string[],
    targetVocab: (Array.isArray(lesson.targetVocab) ? lesson.targetVocab : []) as Array<{ lemma: string; gloss: string }>,
  };
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
  userId: string,
  skill: SkillType,
  lesson: LessonLike,
  nativeLang: string,
  targetLang: string,
  note: string,
  over?: SectionOverride,
): Promise<void> {
  const { grammarPoints, targetVocab } = lessonInputs(lesson);
  const section = await prisma.classSection.create({
    data: { classId, skill, attempt: 1, seed: `${classId}-${skill}-1`, spec: { lessonSlug: lesson.slug }, status: 'GENERATING' },
  });
  const questions = await generateSectionQuestions({
    userId,
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
  await prisma.$transaction([
    ...questions.map((q, i) =>
      prisma.lessonQuestion.create({
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
      }),
    ),
    prisma.classSection.update({ where: { id: section.id }, data: { status: 'READY', generatedAt: new Date() } }),
  ]);
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

export async function createNextClass(
  courseId: string,
  userId: string,
  opts?: SourcedClassOpts,
): Promise<NextClassResult> {
  const course = await prisma.course.findFirst({
    where: { id: courseId, userId },
    include: { curriculum: { include: { lessons: { orderBy: { order: 'asc' } } } } },
  });
  if (!course) throw new CourseNotFoundError('Course not found');

  // Gating: only one non-passed class at a time.
  const active = await prisma.courseClass.findFirst({
    where: { courseId, status: { not: 'PASSED' } },
    orderBy: { order: 'asc' },
  });
  if (active) return { kind: 'gated', activeClassId: active.id, status: active.status };

  const passed = await prisma.courseClass.findMany({ where: { courseId, status: 'PASSED' }, select: { lessonId: true } });
  const passedSet = new Set(passed.map((p) => p.lessonId));
  const lesson = course.curriculum.lessons.find((l) => !passedSet.has(l.id));
  if (!lesson) return { kind: 'done' };

  // Sourced mode: prepare the source BEFORE creating the class so a failed
  // extraction never leaves a half-built class. Authentic content levels to the
  // learner's current CEFR, not the lesson's fixed level. A ClassSourceError here
  // propagates (the route surfaces it); curriculum classes skip this entirely.
  let prepared: PreparedClassSource | null = null;
  let sourceTitle: string | null = null;
  let sourceUrl: string | null = null;
  let override: SectionOverride | undefined;
  let listeningSource: { sourceContent?: string; sourceMetadata?: PreparedClassSource['sourceMetadata']; sourceUrl?: string } = {};

  if (opts?.sourceUrl) {
    prepared = await prepareClassSource({
      url: opts.sourceUrl,
      level: course.currentLevel,
      targetLang: course.targetLang,
      nativeLang: course.nativeLang,
      userId,
    });
    sourceTitle = prepared.title;
    sourceUrl = prepared.sourceUrl;
    override = { level: course.currentLevel, objective: prepared.title ?? lesson.objective, sourceContent: prepared.leveledContent };
    listeningSource = { sourceContent: prepared.leveledContent, sourceMetadata: prepared.sourceMetadata, sourceUrl: prepared.sourceUrl };
  } else if (opts?.topic) {
    // Topic mode: no extracted text; the listening script web-searches the topic
    // for citations, and sections are built about the topic at the learner's level.
    sourceTitle = opts.topic;
    override = { level: course.currentLevel, objective: opts.topic };
  }

  const cls = await prisma.courseClass.create({
    data: { courseId, lessonId: lesson.id, order: lesson.order, status: 'GENERATING', sourceUrl, sourceTitle },
  });

  const note = buildLearnerContext(await getCourseNote(courseId), course.pedagogy);

  try {
    for (const skill of MC_SKILLS) {
      await buildSection(cls.id, userId, skill, lesson, course.nativeLang, course.targetLang, note, override);
    }
  } catch (err) {
    // Roll back the half-built class so the learner can retry cleanly.
    await prisma.courseClass.delete({ where: { id: cls.id } }).catch(() => {});
    throw err;
  }

  const { grammarPoints, targetVocab } = lessonInputs(lesson);
  await seedLessonItems(courseId, cls.id, lesson.level as CefrLevel, targetVocab, grammarPoints);
  const due = await getDueItems(courseId);

  // Adaptive listening section — non-blocking: a TTS/AI hiccup must not
  // prevent the learner from accessing their MC sections.
  try {
    await generateClassListening({
      userId,
      classId: cls.id,
      courseId,
      level: override?.level ?? lesson.level,
      nativeLang: course.nativeLang,
      targetLang: course.targetLang,
      objective: override?.objective ?? lesson.objective,
      mustIncludeVocab: due.vocab.map((v) => ({ word: v.lemma, translation: v.translation })),
      note,
      sourceContent: listeningSource.sourceContent,
      sourceMetadata: listeningSource.sourceMetadata,
      sourceUrl: listeningSource.sourceUrl,
    });
  } catch (err) {
    logger.warn('generateClassListening failed; continuing without listening section', {
      classId: cls.id,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  // Speaking section — non-blocking, same rationale as the listening section.
  try {
    await generateClassSpeaking({
      userId,
      classId: cls.id,
      level: lesson.level,
      nativeLang: course.nativeLang,
      targetLang: course.targetLang,
      objective: lesson.objective,
      targetVocab,
      note,
    });
  } catch (err) {
    logger.warn('generateClassSpeaking failed; continuing without speaking section', {
      classId: cls.id,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  // Writing section — non-blocking, same rationale as listening/speaking.
  try {
    await generateClassWriting({
      userId,
      classId: cls.id,
      level: lesson.level,
      nativeLang: course.nativeLang,
      targetLang: course.targetLang,
      objective: lesson.objective,
      targetVocab,
      note,
    });
  } catch (err) {
    logger.warn('generateClassWriting failed; continuing without writing section', {
      classId: cls.id,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  await prisma.courseClass.update({
    where: { id: cls.id },
    data: {
      status: 'AVAILABLE',
      adaptiveSeed: {
        vocabIds: due.vocab.map((v) => v.id),
        grammarKeys: due.grammar.map((g) => g.topicKey),
        dueCount: due.vocab.length + due.grammar.length,
      },
    },
  });
  await prisma.course.update({ where: { id: courseId }, data: { activeClassId: cls.id } });
  return { kind: 'created', classId: cls.id };
}

export async function getClassForUser(classId: string, userId: string) {
  return prisma.courseClass.findFirst({
    where: { id: classId, course: { userId } },
    include: {
      sections: {
        orderBy: { skill: 'asc' },
        include: {
          questions: { orderBy: { order: 'asc' } },
          prompts: { orderBy: { order: 'asc' } },
          writingPrompts: {
            orderBy: { order: 'asc' },
            include: { responses: { where: { userId }, orderBy: { createdAt: 'desc' }, take: 1 } },
          },
          podcast: {
            select: {
              id: true,
              audioUrl: true,
              title: true,
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
      lesson: { select: { title: true, level: true, objective: true } },
      submission: { select: { passed: true, overallScore: true, submittedAt: true } },
    },
  });
}

export interface SubmitResult {
  passed: boolean;
  overallScore: number;
  passedSections: number;
  totalSections: number;
  sections: Array<{ id: string; skill: SkillType; score: number; passed: boolean }>;
}

export async function submitClass(
  classId: string,
  userId: string,
  answers: Array<{ questionId: string; selectedIndex: number }>,
): Promise<SubmitResult | null> {
  const cls = await prisma.courseClass.findFirst({
    where: { id: classId, course: { userId } },
    include: {
      sections: {
        include: {
          questions: true,
          prompts: { include: { recordings: { orderBy: { createdAt: 'desc' } } } },
          writingPrompts: { include: { responses: { orderBy: { createdAt: 'desc' } } } },
        },
      },
      lesson: true,
    },
  });
  if (!cls) return null;

  const answerMap = new Map(answers.map((a) => [a.questionId, a.selectedIndex]));
  const graded: Array<{ sectionId: string; questionId: string; selectedIndex: number; isCorrect: boolean }> = [];
  const sectionResults: SubmitResult['sections'] = [];
  let passedSections = 0;

  for (const s of cls.sections) {
    let score: number;
    if (s.skill === 'SPEAKING') {
      // Average the latest scored recording per prompt; unscored prompts count as 0.
      const promptScores = s.prompts.map((p) => {
        const scored = p.recordings.find((r) => r.status === 'SCORED' && r.overallScore != null);
        return scored?.overallScore ?? 0;
      });
      score = promptScores.length > 0 ? promptScores.reduce((a, b) => a + b, 0) / promptScores.length : 0;
    } else if (s.skill === 'WRITING') {
      // Average the latest response score per writing prompt; ungraded prompts count as 0.
      const promptScores = s.writingPrompts.map((p) => p.responses[0]?.overallScore ?? 0);
      score = promptScores.length > 0 ? promptScores.reduce((a, b) => a + b, 0) / promptScores.length : 0;
    } else {
      let correct = 0;
      for (const q of s.questions) {
        const sel = answerMap.get(q.id) ?? -1;
        const isCorrect = sel === q.correctIndex;
        if (isCorrect) correct += 1;
        graded.push({ sectionId: s.id, questionId: q.id, selectedIndex: sel, isCorrect });
      }
      score = s.questions.length > 0 ? correct / s.questions.length : 0;
    }
    const passed = score >= s.passThreshold;
    if (passed) passedSections += 1;
    sectionResults.push({ id: s.id, skill: s.skill, score, passed });
  }

  const totalSections = cls.sections.length;
  const overallScore = totalSections > 0 ? passedSections / totalSections : 0;
  const classPassed = overallScore >= cls.passThreshold;
  const now = new Date();

  await prisma.$transaction([
    ...sectionResults.map((r) =>
      prisma.classSection.update({
        where: { id: r.id },
        data: { score: r.score, passed: r.passed, status: r.passed ? 'PASSED' : 'FAILED' },
      }),
    ),
    prisma.classSubmission.upsert({
      where: { classId },
      create: {
        classId,
        userId,
        overallScore,
        passed: classPassed,
        answers: {
          create: graded.map((g) => ({ sectionId: g.sectionId, questionId: g.questionId, selectedIndex: g.selectedIndex, isCorrect: g.isCorrect })),
        },
      },
      update: {
        overallScore,
        passed: classPassed,
        submittedAt: now,
        answers: {
          deleteMany: {},
          create: graded.map((g) => ({ sectionId: g.sectionId, questionId: g.questionId, selectedIndex: g.selectedIndex, isCorrect: g.isCorrect })),
        },
      },
    }),
    prisma.courseClass.update({
      where: { id: classId },
      data: { status: classPassed ? 'PASSED' : 'FAILED', submittedAt: now, ...(classPassed ? { passedAt: now } : { failedAt: now }) },
    }),
  ]);

  if (classPassed) {
    await prisma.course.update({ where: { id: cls.courseId }, data: { activeClassId: null } });
  }

  // Closed loop: update the learner's SRS for this lesson's items.
  const grammarScore = sectionResults.find((r) => r.skill === 'GRAMMAR')?.score ?? 0;
  const readingScore = sectionResults.find((r) => r.skill === 'READING')?.score ?? 0;
  const { grammarPoints, targetVocab } = lessonInputs(cls.lesson);
  await applyReviewOutcome(
    cls.courseId,
    targetVocab.map((v) => v.lemma),
    grammarPoints,
    readingScore,
    grammarScore,
    now,
  );

  return { passed: classPassed, overallScore, passedSections, totalSections, sections: sectionResults };
}

// Regenerate the FAILED sections of a class in a different form. In-place:
// bumps attempt + seed and replaces the questions, so a learner can't pass by
// memorizing answers.
export async function regenerateFailedSections(classId: string, userId: string): Promise<boolean> {
  const cls = await prisma.courseClass.findFirst({
    where: { id: classId, course: { userId } },
    include: { sections: { where: { passed: false } }, lesson: true, course: true },
  });
  if (!cls || cls.sections.length === 0) return false;

  const { grammarPoints, targetVocab } = lessonInputs(cls.lesson);

  for (const s of cls.sections) {
    const attempt = s.attempt + 1;
    const seed = `${classId}-${s.skill}-${attempt}`;

    // Non-MC sections (listening, speaking) have no MC answers to memorize, so
    // there is nothing to regenerate for anti-copy — reset them in place for
    // another attempt. Speaking also clears prior recordings so the learner
    // re-records from scratch.
    if (!MC_SKILLS.includes(s.skill)) {
      if (s.skill === 'SPEAKING') {
        await prisma.speakingRecording.deleteMany({ where: { sectionId: s.id } });
      }
      await prisma.classSection.update({
        where: { id: s.id },
        data: { attempt, seed, status: 'READY', score: null, passed: null },
      });
      continue;
    }

    await prisma.classSection.update({
      where: { id: s.id },
      data: { attempt, seed, status: 'GENERATING', score: null, passed: null },
    });
    await prisma.lessonQuestion.deleteMany({ where: { sectionId: s.id } });
    const questions = await generateSectionQuestions({
      userId,
      skill: s.skill,
      level: cls.lesson.level,
      nativeLang: cls.course.nativeLang,
      targetLang: cls.course.targetLang,
      objective: cls.lesson.objective,
      grammarPoints,
      targetVocab,
      seed,
    });
    await prisma.$transaction([
      ...questions.map((q, i) =>
        prisma.lessonQuestion.create({
          data: {
            sectionId: s.id,
            order: i + 1,
            skill: s.skill,
            question: q.question,
            options: q.options,
            correctIndex: q.correctIndex,
            explanation: q.explanation,
            passageRef: q.passageRef ?? null,
            passageText: q.passageText ?? null,
          },
        }),
      ),
      prisma.classSection.update({ where: { id: s.id }, data: { status: 'READY', generatedAt: new Date() } }),
    ]);
  }

  await prisma.courseClass.update({ where: { id: classId }, data: { status: 'IN_PROGRESS', failedAt: null } });
  return true;
}
