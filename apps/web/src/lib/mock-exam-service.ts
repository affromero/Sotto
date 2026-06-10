// Mock-exam orchestration. createMockExam generates a full-length practice exam
// synchronously (like createNextClass), reusing the class generator cores for
// each blueprint section and persisting into the exam models. Per-section
// generation is best-effort: a TTS/AI hiccup marks that section FAILED but never
// sinks the whole exam. The exam is a self-assessment and NEVER touches level.
import { prisma } from './prisma';
import type { CefrLevel, PedagogyStyle } from '@sotto/shared';
import {
  getBlueprint,
  resolveExamInstitution,
  EXAM_INSTITUTION_LABELS,
  type BlueprintSection,
} from './exam-blueprint';
import { resolveExamSpec, type ExamSpec } from './exam-spec';
import { generateSectionQuestions } from './class-generation';
import { composeListeningContent } from './class-listening-generator';
import { composeSpeakingPrompts } from './class-speaking-generator';
import { composeWritingPrompts } from './class-writing-generator';
import { getCourseNote } from './course-notes';
import { buildLearnerContext } from './pedagogy';
import { logger } from './logger';

export class ExamCourseNotFoundError extends Error {}

interface ExamCourseCtx {
  id: string;
  userId: string;
  nativeLang: string;
  targetLang: string;
  curriculumId: string;
  currentLevel: CefrLevel;
  pedagogy: PedagogyStyle;
}

/**
 * Create + generate a mock exam for a course. Returns the exam id once the
 * sections are built (the listening audio finishes asynchronously, like classes).
 */
export async function createMockExam(
  courseId: string,
  userId: string,
  levelOverride?: CefrLevel,
): Promise<string> {
  const course = await prisma.course.findFirst({
    where: { id: courseId, userId },
    select: {
      id: true,
      userId: true,
      nativeLang: true,
      targetLang: true,
      curriculumId: true,
      currentLevel: true,
      pedagogy: true,
    },
  });
  if (!course) throw new ExamCourseNotFoundError('Course not found');

  const level = levelOverride ?? course.currentLevel;
  const institution = resolveExamInstitution(course.targetLang);
  const blueprint = getBlueprint(institution, level);

  const exam = await prisma.mockExam.create({
    data: { userId, courseId, institution, level, status: 'GENERATING', blueprintId: blueprint.id },
  });

  const note = buildLearnerContext(await getCourseNote(courseId), course.pedagogy);
  const spec = await resolveExamSpec(course.curriculumId, level);

  let anyReady = false;
  for (let i = 0; i < blueprint.sections.length; i++) {
    const ok = await buildExamSection(exam.id, course, blueprint.sections[i], i + 1, level, spec, note);
    anyReady = anyReady || ok;
  }

  await prisma.mockExam.update({
    where: { id: exam.id },
    data: { status: anyReady ? 'READY' : 'FAILED' },
  });
  return exam.id;
}

async function buildExamSection(
  examId: string,
  course: ExamCourseCtx,
  section: BlueprintSection,
  order: number,
  level: CefrLevel,
  spec: ExamSpec,
  note: string,
): Promise<boolean> {
  const examSection = await prisma.examSection.create({
    data: {
      examId,
      skill: section.skill,
      part: section.part,
      order,
      format: section.format,
      weight: section.weight,
      status: 'GENERATING',
    },
  });

  try {
    if (section.format === 'mc') {
      const questions = await generateSectionQuestions({
        userId: course.userId,
        skill: section.skill,
        level,
        nativeLang: course.nativeLang,
        targetLang: course.targetLang,
        objective: spec.objective,
        grammarPoints: spec.grammarPoints,
        targetVocab: spec.targetVocab,
        seed: `exam-${examId}-${order}`,
        note,
      });
      await prisma.examQuestion.createMany({
        data: questions.slice(0, section.itemCount).map((q, i) => ({
          sectionId: examSection.id,
          order: i + 1,
          skill: section.skill,
          question: q.question,
          options: q.options,
          correctIndex: q.correctIndex,
          explanation: q.explanation,
          passageRef: q.passageRef ?? null,
          passageText: q.passageText ?? null,
        })),
      });
    } else if (section.format === 'listening') {
      const { podcastId, comprehensionQuestions } = await composeListeningContent({
        userId: course.userId,
        courseId: course.id,
        level,
        nativeLang: course.nativeLang,
        targetLang: course.targetLang,
        objective: spec.objective,
        mustIncludeVocab: spec.targetVocab.map((v) => ({ word: v.lemma, translation: v.gloss })),
        note,
      });
      await prisma.examSection.update({ where: { id: examSection.id }, data: { podcastId } });
      await prisma.examQuestion.createMany({
        data: comprehensionQuestions.slice(0, section.itemCount).map((q, i) => ({
          sectionId: examSection.id,
          order: i + 1,
          skill: 'LISTENING' as const,
          question: q.question,
          options: q.options,
          correctIndex: q.correctIndex,
          explanation: q.explanation,
        })),
      });
    } else if (section.format === 'speaking') {
      const composed = await composeSpeakingPrompts({
        userId: course.userId,
        level,
        nativeLang: course.nativeLang,
        targetLang: course.targetLang,
        objective: spec.objective,
        targetVocab: spec.targetVocab,
        refId: examSection.id,
        note,
      });
      await prisma.speakingPrompt.createMany({
        data: composed.slice(0, section.itemCount).map((c, i) => ({
          examSectionId: examSection.id,
          order: i + 1,
          targetPhrase: c.targetPhrase,
          translation: c.translation,
          ipa: c.ipa,
          referenceTtsUrl: c.referenceTtsUrl,
        })),
      });
    } else {
      const composed = await composeWritingPrompts({
        userId: course.userId,
        level,
        nativeLang: course.nativeLang,
        targetLang: course.targetLang,
        objective: spec.objective,
        targetVocab: spec.targetVocab,
        note,
      });
      await prisma.writingPrompt.createMany({
        data: composed.slice(0, section.itemCount).map((c, i) => ({
          examSectionId: examSection.id,
          order: i + 1,
          task: c.task,
          guidance: c.guidance,
        })),
      });
    }

    await prisma.examSection.update({ where: { id: examSection.id }, data: { status: 'READY' } });
    return true;
  } catch (err: unknown) {
    logger.warn('Exam section generation failed; marking the section failed', {
      examId,
      part: section.part,
      error: err instanceof Error ? err.message : String(err),
    });
    await prisma.examSection
      .update({ where: { id: examSection.id }, data: { status: 'FAILED' } })
      .catch(() => undefined);
    return false;
  }
}

// ---- Read side ----

export interface ExamQuestionPublic {
  id: string;
  order: number;
  question: string;
  options: string[];
  passageRef: string | null;
  passageText: string | null;
  // Answer key (correctIndex/explanation) is included only once the exam is SCORED.
  correctIndex?: number;
  explanation?: string;
}

export interface ExamSectionPublic {
  id: string;
  skill: string;
  part: string;
  order: number;
  format: string;
  weight: number;
  status: string;
  score: number | null;
  podcast: { id: string; audioUrl: string | null; status: string } | null;
  questions: ExamQuestionPublic[];
  speakingPrompts: Array<{ id: string; order: number; targetPhrase: string; translation: string; referenceTtsUrl: string | null }>;
  writingPrompts: Array<{ id: string; order: number; task: string; guidance: string | null }>;
}

export interface ExamPublic {
  id: string;
  institution: string;
  institutionLabel: string;
  level: string;
  status: string;
  examName: string;
  sections: ExamSectionPublic[];
  result: {
    overallScore: number | null;
    band: string | null;
    feedback: string | null;
    sectionResults: Array<{ sectionId: string; skill: string; score: number; feedback: string | null }>;
  } | null;
}

export interface CourseExamsView {
  available: {
    institution: string;
    institutionLabel: string;
    examName: string;
    level: string;
    sectionCount: number;
  };
  history: Array<{
    id: string;
    examName: string;
    level: string;
    status: string;
    band: string | null;
    overallScore: number | null;
    createdAt: string;
  }>;
}

/** The flagship exam available for a course + the learner's past exams. */
export async function listCourseExams(courseId: string, userId: string): Promise<CourseExamsView | null> {
  const course = await prisma.course.findFirst({
    where: { id: courseId, userId },
    select: { targetLang: true, currentLevel: true },
  });
  if (!course) return null;

  const institution = resolveExamInstitution(course.targetLang);
  const blueprint = getBlueprint(institution, course.currentLevel);

  const exams = await prisma.mockExam.findMany({
    where: { courseId, userId },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      institution: true,
      level: true,
      status: true,
      createdAt: true,
      submission: { select: { band: true, overallScore: true } },
    },
  });

  return {
    available: {
      institution,
      institutionLabel: EXAM_INSTITUTION_LABELS[institution],
      examName: blueprint.examName,
      level: course.currentLevel,
      sectionCount: blueprint.sections.length,
    },
    history: exams.map((e) => ({
      id: e.id,
      examName: getBlueprint(e.institution, e.level).examName,
      level: e.level,
      status: e.status,
      band: e.submission?.band ?? null,
      overallScore: e.submission?.overallScore ?? null,
      createdAt: e.createdAt.toISOString(),
    })),
  };
}

/** Fetch an exam for its owner. Answer keys are stripped until the exam is SCORED. */
export async function getExamForUser(examId: string, userId: string): Promise<ExamPublic | null> {
  const exam = await prisma.mockExam.findFirst({
    where: { id: examId, userId },
    include: {
      sections: {
        orderBy: { order: 'asc' },
        include: {
          questions: { orderBy: { order: 'asc' } },
          speakingPrompts: { orderBy: { order: 'asc' } },
          writingPrompts: { orderBy: { order: 'asc' } },
          podcast: { select: { id: true, audioUrl: true, status: true } },
        },
      },
      submission: { include: { sectionResults: true } },
    },
  });
  if (!exam) return null;

  const scored = exam.status === 'SCORED';
  const blueprint = getBlueprint(exam.institution, exam.level);

  return {
    id: exam.id,
    institution: exam.institution,
    institutionLabel: EXAM_INSTITUTION_LABELS[exam.institution],
    level: exam.level,
    status: exam.status,
    examName: blueprint.examName,
    sections: exam.sections.map((s) => ({
      id: s.id,
      skill: s.skill,
      part: s.part,
      order: s.order,
      format: s.format,
      weight: s.weight,
      status: s.status,
      score: s.score,
      podcast: s.podcast
        ? { id: s.podcast.id, audioUrl: s.podcast.audioUrl, status: s.podcast.status }
        : null,
      questions: s.questions.map((q) => ({
        id: q.id,
        order: q.order,
        question: q.question,
        options: q.options as string[],
        passageRef: q.passageRef,
        passageText: q.passageText,
        ...(scored ? { correctIndex: q.correctIndex, explanation: q.explanation } : {}),
      })),
      speakingPrompts: s.speakingPrompts.map((p) => ({
        id: p.id,
        order: p.order,
        targetPhrase: p.targetPhrase,
        translation: p.translation,
        referenceTtsUrl: p.referenceTtsUrl,
      })),
      writingPrompts: s.writingPrompts.map((p) => ({
        id: p.id,
        order: p.order,
        task: p.task,
        guidance: p.guidance,
      })),
    })),
    result: exam.submission
      ? {
          overallScore: exam.submission.overallScore,
          band: exam.submission.band,
          feedback: exam.submission.feedback,
          sectionResults: exam.submission.sectionResults.map((r) => ({
            sectionId: r.sectionId,
            skill: r.skill,
            score: r.score,
            feedback: r.feedback,
          })),
        }
      : null,
  };
}
