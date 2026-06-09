// Grades a learner's writing response synchronously via the LLM: returns an
// overall score, inline corrections (old/new/why), and encouraging feedback.
// Unlike speaking (STT + async worker), writing grading is a single LLM call.
import { resolveLearningAi } from './learning-ai';
import { createAIProvider } from './providers/ai';
import { loadAndRender } from './prompt-loader';
import { logUsage } from './usage-logger';

export interface WritingCorrection {
  old: string;
  new: string;
  why: string;
}

export interface WritingGrade {
  overallScore: number; // 0..1
  corrections: WritingCorrection[];
  feedback: string;
}

export interface GradeWritingParams {
  userId: string;
  nativeLang: string;
  targetLang: string;
  level: string;
  task: string;
  text: string;
}

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

function isCorrection(item: unknown): item is WritingCorrection {
  if (typeof item !== 'object' || item === null) return false;
  const o = item as Record<string, unknown>;
  return typeof o.old === 'string' && typeof o.new === 'string' && typeof o.why === 'string';
}

export async function gradeWriting(p: GradeWritingParams): Promise<WritingGrade> {
  const ai = await resolveLearningAi(p.userId);

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
    { model: ai.model, apiKeyOverride: ai.apiKey, maxTokens: 2048, temperature: 0.3 },
  );

  logUsage({
    service: ai.provider,
    model: res.model,
    category: 'class-writing-grade',
    inputTokens: res.inputTokens,
    outputTokens: res.outputTokens,
    userId: p.userId,
  });

  const cleaned = res.content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
  let parsed: { overallScore?: unknown; corrections?: unknown; feedback?: unknown };
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    throw new Error('Writing grading returned malformed output.');
  }

  const overallScore = clamp01(typeof parsed.overallScore === 'number' ? parsed.overallScore : 0);
  const corrections = Array.isArray(parsed.corrections) ? parsed.corrections.filter(isCorrection) : [];
  const feedback = typeof parsed.feedback === 'string' ? parsed.feedback : '';

  return { overallScore, corrections, feedback };
}
