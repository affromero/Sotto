// Grades writing feedback and, when available, a separately supported objective
// criterion under the canonical writing execution.
import { capturedLearningAiOptions, resolveCapturedLearningAi } from './learning-ai';
import type { SottoProviderExecution } from '@/lib/sidedoor/credentials/runtime/provider-execution';
import { createAIProvider } from './providers/ai';
import { loadAndRender } from './prompt-loader';
import { logUsage } from './usage-logger';
import { z } from 'zod';
import { gradeProductiveObjective } from './learning-map/evidence/productive';
import {
  objectiveEvidenceHash,
  reviewedObjectiveAssessmentSchema,
  type ProductiveCriterionFinding,
} from './learning-map/evidence/protocol';

interface WritingCorrection {
  old: string;
  new: string;
  why: string;
}

export interface WritingGrade {
  overallScore: number; // 0..1
  corrections: WritingCorrection[];
  feedback: string;
  objectiveEvidence?: ProductiveCriterionFinding;
}

export interface GradeWritingParams {
  userId: string;
  execution: SottoProviderExecution;
  nativeLang: string;
  targetLang: string;
  level: string;
  task: string;
  guidance?: string | null;
  ideas?: string[];
  text: string;
  learningObjectives?: unknown;
}

const writingGradeSchema = z
  .object({
    overallScore: z.number().finite().min(0).max(1),
    corrections: z.array(
      z.object({ old: z.string().min(1), new: z.string(), why: z.string().trim().min(1) }).strict()
    ),
    feedback: z.string().trim().min(1),
  })
  .strict();

export async function gradeWriting(p: GradeWritingParams): Promise<WritingGrade> {
  const assessment =
    p.learningObjectives === null || p.learningObjectives === undefined
      ? null
      : reviewedObjectiveAssessmentSchema.parse(p.learningObjectives);
  if (
    assessment &&
    (assessment.scope.userId !== p.userId ||
      assessment.scope.targetLang !== p.targetLang ||
      assessment.scope.level !== p.level ||
      objectiveEvidenceHash(assessment.task) !==
        objectiveEvidenceHash({
          kind: 'ORIGINAL_WRITING',
          task: p.task,
          guidance: p.guidance ?? null,
          suppliedSupport: p.ideas ?? [],
        }))
  )
    throw new Error('Writing criterion does not belong to the actual task, learner or difficulty.');
  const ai = await resolveCapturedLearningAi(p.userId, p.execution);

  const systemPrompt = loadAndRender('writing/grade-writing.md', {
    LEVEL: p.level,
    NATIVE: p.nativeLang,
    TARGET: p.targetLang,
    TASK: p.task,
    RESPONSE: p.text,
  });

  const client = createAIProvider(ai.provider);
  const res = await client.generateResponse(
    systemPrompt,
    [{ role: 'user', content: 'Grade the response.' }],
    { ...(await capturedLearningAiOptions(ai)), maxTokens: 2048, temperature: 0.3 }
  );

  logUsage({
    service: ai.provider,
    model: res.model,
    category: 'class-writing-grade',
    inputTokens: res.inputTokens,
    outputTokens: res.outputTokens,
    userId: p.userId,
  });

  const cleaned = res.content
    .replace(/```json\n?/g, '')
    .replace(/```\n?/g, '')
    .trim();
  let parsed: { overallScore?: unknown; corrections?: unknown; feedback?: unknown };
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    throw new Error('Writing grading returned malformed output.');
  }

  const result = writingGradeSchema.safeParse(parsed);
  if (!result.success) throw new Error('Writing grading returned invalid scores or feedback.');
  const used: Array<{ start: number; end: number }> = [];
  for (const correction of result.data.corrections) {
    let start = p.text.indexOf(correction.old);
    while (
      start >= 0 &&
      used.some((range) => start < range.end && start + correction.old.length > range.start)
    )
      start = p.text.indexOf(correction.old, start + 1);
    if (start < 0 || correction.old === correction.new)
      throw new Error(
        'Writing grading returned a correction that does not match the learner response.'
      );
    used.push({ start, end: start + correction.old.length });
  }
  if (assessment) {
    const qualified = await gradeProductiveObjective({
      userId: p.userId,
      execution: p.execution,
      assessment,
      text: p.text,
      ai,
    });
    return { ...result.data, objectiveEvidence: qualified.finding };
  }
  return result.data;
}
