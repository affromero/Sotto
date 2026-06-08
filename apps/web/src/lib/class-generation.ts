// Generates multiple-choice questions for a class's MC sections (GRAMMAR /
// READING) via the user's AI provider. Mirrors the canonical worker LLM flow.
import { resolveLearningAi } from './learning-ai';
import { createAIProvider } from './providers/ai';
import { loadAndRender } from './prompt-loader';
import { logUsage } from './usage-logger';
import { logger } from './logger';
import type { SkillType } from '@sotto/shared';

const QUESTIONS_PER_SECTION = 5;

export interface GeneratedQuestion {
  question: string;
  options: string[];
  correctIndex: number;
  explanation: string;
  passageRef?: string;
}

export interface SectionGenParams {
  userId: string;
  skill: SkillType; // GRAMMAR | READING
  level: string;
  nativeLang: string;
  targetLang: string;
  objective: string;
  grammarPoints: string[];
  targetVocab: Array<{ lemma: string; gloss: string }>;
  seed: string;
}

export async function generateSectionQuestions(p: SectionGenParams): Promise<GeneratedQuestion[]> {
  const ai = await resolveLearningAi(p.userId);

  const systemPrompt = loadAndRender('class/generate-section-quiz.md', {
    COUNT: String(QUESTIONS_PER_SECTION),
    SKILL: p.skill.toLowerCase(),
    LEVEL: p.level,
    NATIVE: p.nativeLang,
    TARGET: p.targetLang,
    OBJECTIVE: p.objective,
    GRAMMAR_POINTS: p.grammarPoints.join(', '),
    VOCAB: p.targetVocab.map((v) => `${v.lemma} (${v.gloss})`).join('; '),
    SEED: p.seed,
  });

  const provider = createAIProvider(ai.provider);
  const response = await provider.generateResponse(
    systemPrompt,
    [{ role: 'user', content: `Generate ${QUESTIONS_PER_SECTION} ${p.skill.toLowerCase()} questions.` }],
    { model: ai.model, apiKeyOverride: ai.apiKey, maxTokens: 4096, temperature: 0.8 },
  );

  logUsage({
    service: ai.provider,
    model: response.model,
    category: 'class-section',
    inputTokens: response.inputTokens,
    outputTokens: response.outputTokens,
    userId: p.userId,
  });

  const cleaned = response.content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
  let raw: GeneratedQuestion[];
  try {
    raw = JSON.parse(cleaned);
  } catch (err) {
    logger.error('Failed to parse class-section LLM response', {
      error: err instanceof Error ? err.message : String(err),
    });
    throw new Error('Class generation returned malformed output.');
  }

  const questions = raw
    .filter(
      (q) =>
        typeof q.question === 'string' &&
        Array.isArray(q.options) &&
        q.options.length === 4 &&
        typeof q.correctIndex === 'number',
    )
    .map((q) => ({
      question: q.question,
      options: q.options.slice(0, 4),
      correctIndex: Math.max(0, Math.min(3, q.correctIndex)),
      explanation: q.explanation ?? '',
      passageRef: q.passageRef,
    }));

  if (questions.length === 0) {
    throw new Error('Class generation produced no usable questions.');
  }
  return questions;
}
