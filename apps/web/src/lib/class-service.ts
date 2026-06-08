// Class lifecycle: instantiate the next gated class from the curriculum,
// generate its MC sections, grade submissions, and regenerate failed sections
// in a different form (retrieval practice / anti-copy).
import { prisma } from './prisma';
import { generateSectionQuestions } from './class-generation';
import type { SkillType } from '@sotto/shared';

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

async function buildSection(
  classId: string,
  userId: string,
  skill: SkillType,
  lesson: LessonLike,
  nativeLang: string,
  targetLang: string,
): Promise<void> {
  const { grammarPoints, targetVocab } = lessonInputs(lesson);
  const section = await prisma.classSection.create({
    data: { classId, skill, attempt: 1, seed: `${classId}-${skill}-1`, spec: { lessonSlug: lesson.slug }, status: 'GENERATING' },
  });
  const questions = await generateSectionQuestions({
    userId,
    skill,
    level: lesson.level,
    nativeLang,
    targetLang,
    objective: lesson.objective,
    grammarPoints,
    targetVocab,
    seed: section.seed,
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

export async function createNextClass(courseId: string, userId: string): Promise<NextClassResult> {
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

  const cls = await prisma.courseClass.create({
    data: { courseId, lessonId: lesson.id, order: lesson.order, status: 'GENERATING' },
  });

  try {
    for (const skill of MC_SKILLS) {
      await buildSection(cls.id, userId, skill, lesson, course.nativeLang, course.targetLang);
    }
  } catch (err) {
    // Roll back the half-built class so the learner can retry cleanly.
    await prisma.courseClass.delete({ where: { id: cls.id } }).catch(() => {});
    throw err;
  }

  await prisma.courseClass.update({ where: { id: cls.id }, data: { status: 'AVAILABLE' } });
  await prisma.course.update({ where: { id: courseId }, data: { activeClassId: cls.id } });
  return { kind: 'created', classId: cls.id };
}

export async function getClassForUser(classId: string, userId: string) {
  return prisma.courseClass.findFirst({
    where: { id: classId, course: { userId } },
    include: {
      sections: { orderBy: { skill: 'asc' }, include: { questions: { orderBy: { order: 'asc' } } } },
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
    include: { sections: { include: { questions: true } } },
  });
  if (!cls) return null;

  const answerMap = new Map(answers.map((a) => [a.questionId, a.selectedIndex]));
  const graded: Array<{ sectionId: string; questionId: string; selectedIndex: number; isCorrect: boolean }> = [];
  const sectionResults: SubmitResult['sections'] = [];
  let passedSections = 0;

  for (const s of cls.sections) {
    let correct = 0;
    for (const q of s.questions) {
      const sel = answerMap.get(q.id) ?? -1;
      const isCorrect = sel === q.correctIndex;
      if (isCorrect) correct += 1;
      graded.push({ sectionId: s.id, questionId: q.id, selectedIndex: sel, isCorrect });
    }
    const score = s.questions.length > 0 ? correct / s.questions.length : 0;
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
          },
        }),
      ),
      prisma.classSection.update({ where: { id: s.id }, data: { status: 'READY', generatedAt: new Date() } }),
    ]);
  }

  await prisma.courseClass.update({ where: { id: classId }, data: { status: 'IN_PROGRESS', failedAt: null } });
  return true;
}
