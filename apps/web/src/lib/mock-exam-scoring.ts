// Scores a submitted mock exam and writes the result. MC sections are scored
// inline; writing was already graded synchronously at upload; speaking is read
// from the latest SCORED recording per prompt (ungraded counts as 0), since
// speaking grading is async (BullMQ). The overall score is the blueprint-weighted
// sum, mapped to a mock band. A mock exam is a self-assessment: it NEVER advances
// Course.currentLevel. Pure helpers (weighting, band) are unit-tested separately.
import { prisma } from './prisma';
import { resolveLearningAi } from './learning-ai';
import { createAIProvider } from './providers/ai';
import { loadAndRender } from './prompt-loader';
import { logUsage } from './usage-logger';
import { logger } from './logger';
import { getBlueprint } from './exam-blueprint';

export interface ExamSectionScore {
  sectionId: string;
  skill: string;
  weight: number;
  score: number; // 0..1
}

export interface ExamScoreResult {
  overallScore: number;
  band: string;
  sections: ExamSectionScore[];
  feedback: string;
}

/** Weighted overall (0..1). Falls back to a simple mean if weights are absent. */
export function weightedOverall(sections: Array<{ score: number; weight: number }>): number {
  if (sections.length === 0) return 0;
  const totalWeight = sections.reduce((acc, s) => acc + s.weight, 0);
  if (totalWeight <= 0) {
    return sections.reduce((acc, s) => acc + s.score, 0) / sections.length;
  }
  return sections.reduce((acc, s) => acc + s.score * s.weight, 0) / totalWeight;
}

/** Map an overall 0..1 to a mock band. 0.6 is the typical institutional pass mark. */
export function computeBand(overall: number, level: string): string {
  if (overall >= 0.6) return `${level} pass (mock)`;
  if (overall >= 0.45) return `${level} borderline (mock)`;
  return `below ${level} (mock)`;
}

interface RawFeedback {
  overall?: string;
  sections?: Array<{ skill?: string; feedback?: string }>;
}

function parseFeedback(content: string): RawFeedback | null {
  const cleaned = content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
  try {
    const parsed = JSON.parse(cleaned);
    return typeof parsed === 'object' && parsed !== null ? (parsed as RawFeedback) : null;
  } catch {
    return null;
  }
}

interface FeedbackResult {
  overall: string;
  bySkill: Map<string, string>;
}

// Best-effort LLM feedback. On any failure, returns a deterministic default so a
// scored exam always has feedback.
async function generateFeedback(
  userId: string,
  examName: string,
  level: string,
  sections: ExamSectionScore[],
  overall: number,
): Promise<FeedbackResult> {
  const pct = (n: number) => `${Math.round(n * 100)}%`;
  const fallback: FeedbackResult = {
    overall: `You scored ${pct(overall)} overall on this practice exam. Review your weakest sections and try again.`,
    bySkill: new Map(),
  };

  try {
    const ai = await resolveLearningAi(userId);
    const systemPrompt = loadAndRender('exams/exam-feedback.md', {
      EXAM_NAME: examName,
      LEVEL: level,
      OVERALL: pct(overall),
      SECTIONS: sections.map((s) => `${s.skill}: ${pct(s.score)}`).join('\n'),
    });
    const client = createAIProvider(ai.provider);
    const res = await client.generateResponse(
      systemPrompt,
      [{ role: 'user', content: 'Give the feedback.' }],
      { model: ai.model, apiKeyOverride: ai.apiKey, maxTokens: 1024, temperature: 0.4 },
    );
    logUsage({
      service: ai.provider,
      model: res.model,
      category: 'exam-feedback',
      inputTokens: res.inputTokens,
      outputTokens: res.outputTokens,
      userId,
    });
    const parsed = parseFeedback(res.content);
    if (!parsed) return fallback;
    const bySkill = new Map<string, string>();
    for (const s of parsed.sections ?? []) {
      if (s.skill && s.feedback) bySkill.set(s.skill.toUpperCase(), s.feedback);
    }
    return { overall: parsed.overall?.trim() || fallback.overall, bySkill };
  } catch (error: unknown) {
    logger.warn('Exam feedback generation failed; using a default', {
      error: error instanceof Error ? error.message : String(error),
    });
    return fallback;
  }
}

export class ExamNotFoundError extends Error {}

/**
 * Score a submitted exam, persist the result, and mark it SCORED. answers maps
 * MC question ids to the selected option index.
 */
export async function scoreExam(
  examId: string,
  userId: string,
  answers: Array<{ questionId: string; selectedIndex: number }>,
): Promise<ExamScoreResult> {
  const exam = await prisma.mockExam.findFirst({
    where: { id: examId, userId },
    include: {
      sections: {
        orderBy: { order: 'asc' },
        include: {
          questions: true,
          speakingPrompts: { include: { recordings: { orderBy: { createdAt: 'desc' } } } },
          writingPrompts: { include: { responses: { orderBy: { createdAt: 'desc' } } } },
        },
      },
    },
  });
  if (!exam) throw new ExamNotFoundError('Exam not found');

  const answerMap = new Map(answers.map((a) => [a.questionId, a.selectedIndex]));
  const sectionScores: ExamSectionScore[] = exam.sections.map((s) => {
    let score: number;
    if (s.skill === 'SPEAKING') {
      const promptScores = s.speakingPrompts.map((p) => {
        const scored = p.recordings.find((r) => r.status === 'SCORED' && r.overallScore != null);
        return scored?.overallScore ?? 0;
      });
      score = promptScores.length > 0 ? promptScores.reduce((a, b) => a + b, 0) / promptScores.length : 0;
    } else if (s.skill === 'WRITING') {
      const promptScores = s.writingPrompts.map((p) => p.responses[0]?.overallScore ?? 0);
      score = promptScores.length > 0 ? promptScores.reduce((a, b) => a + b, 0) / promptScores.length : 0;
    } else {
      let correct = 0;
      for (const q of s.questions) {
        if ((answerMap.get(q.id) ?? -1) === q.correctIndex) correct += 1;
      }
      score = s.questions.length > 0 ? correct / s.questions.length : 0;
    }
    return { sectionId: s.id, skill: s.skill, weight: s.weight, score };
  });

  const overall = weightedOverall(sectionScores);
  const band = computeBand(overall, exam.level);
  const blueprint = getBlueprint(exam.institution, exam.level);
  const feedback = await generateFeedback(userId, blueprint.examName, exam.level, sectionScores, overall);

  await prisma.$transaction([
    ...sectionScores.map((s) =>
      prisma.examSection.update({ where: { id: s.sectionId }, data: { score: s.score } }),
    ),
    prisma.examSubmission.upsert({
      where: { examId },
      create: {
        examId,
        overallScore: overall,
        band,
        feedback: feedback.overall,
        sectionResults: {
          create: sectionScores.map((s) => ({
            sectionId: s.sectionId,
            skill: s.skill as never,
            score: s.score,
            feedback: feedback.bySkill.get(s.skill) ?? null,
          })),
        },
      },
      update: {
        overallScore: overall,
        band,
        feedback: feedback.overall,
        sectionResults: {
          deleteMany: {},
          create: sectionScores.map((s) => ({
            sectionId: s.sectionId,
            skill: s.skill as never,
            score: s.score,
            feedback: feedback.bySkill.get(s.skill) ?? null,
          })),
        },
      },
    }),
    prisma.mockExam.update({ where: { id: examId }, data: { status: 'SCORED' } }),
  ]);

  return { overallScore: overall, band, sections: sectionScores, feedback: feedback.overall };
}
