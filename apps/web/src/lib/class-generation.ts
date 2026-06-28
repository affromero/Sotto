// Generates multiple-choice questions for a class's MC sections (GRAMMAR /
// READING) via the user's AI provider. Mirrors the canonical worker LLM flow.
import { resolveLearningAi } from './learning-ai';
import { createAIProvider } from './providers/ai';
import { loadAndRender } from './prompt-loader';
import { formatNotesForPrompt } from './course-notes';
import { logUsage } from './usage-logger';
import { logger } from './logger';
import { classLanguagePolicy } from './classes/class-language-policy';
import type { SkillType } from '@sotto/shared';

const QUESTIONS_PER_SECTION = 5;

export interface GeneratedQuestion {
  question: string;
  options: string[];
  correctIndex: number;
  explanation: string;
  passageRef?: string;
  /** Full leveled reading passage (sourced classes). Persisted to LessonQuestion.passageText. */
  passageText?: string;
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
  note?: string;
  /**
   * Optional sourced-class reading passage (CEFR-leveled, target language). When
   * present for a READING section, MCQs are based on it and each returned READING
   * question carries it as `passageText`. Absent = today's curriculum behavior.
   */
  sourceContent?: string;
}

interface RawGeneratedQuestion {
  question?: unknown;
  options?: unknown;
  correctIndex?: unknown;
  explanation?: unknown;
  passageRef?: unknown;
}

interface WrappedGeneratedQuestions {
  questions?: unknown;
}

function sanitizeLlmJson(text: string): string {
  return text
    .trim()
    .replace(/^```(?:json)?\s*\n?/i, '')
    .replace(/\n?```\s*$/i, '')
    .trim();
}

function extractFirstJsonArray(text: string): string {
  const start = text.indexOf('[');
  if (start === -1) throw new Error('No JSON array found in response');

  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < text.length; i += 1) {
    const ch = text[i];
    if (escape) {
      escape = false;
      continue;
    }
    if (ch === '\\' && inString) {
      escape = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (ch === '[') depth += 1;
    if (ch === ']' && --depth === 0) return text.slice(start, i + 1);
  }

  throw new Error('Unbalanced JSON array in response');
}

function parseRawQuestions(content: string): RawGeneratedQuestion[] {
  const cleaned = sanitizeLlmJson(content);
  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    parsed = JSON.parse(extractFirstJsonArray(cleaned));
  }

  if (Array.isArray(parsed)) return parsed as RawGeneratedQuestion[];
  if (parsed && typeof parsed === 'object') {
    const wrapped = parsed as WrappedGeneratedQuestions;
    if (Array.isArray(wrapped.questions)) return wrapped.questions as RawGeneratedQuestion[];
  }

  throw new Error('Class generation returned no question array.');
}

export async function generateSectionQuestions(p: SectionGenParams): Promise<GeneratedQuestion[]> {
  const ai = await resolveLearningAi(p.userId);

  // Sourced READING classes: base the MCQs on the leveled passage. The
  // {{SOURCE}} block is rendered only for a READING section that has source
  // text; otherwise it is empty and the prompt behaves exactly as before.
  const useSourcePassage = p.skill === 'READING' && !!p.sourceContent;
  const sourceBlock = useSourcePassage
    ? `Source passage (base READING questions on it): ${p.sourceContent}`
    : '';

  const systemPrompt = loadAndRender('class/generate-section-quiz.md', {
    COUNT: String(QUESTIONS_PER_SECTION),
    SKILL: p.skill.toLowerCase(),
    LEVEL: p.level,
    NATIVE: p.nativeLang,
    TARGET: p.targetLang,
    LANGUAGE_POLICY: classLanguagePolicy({
      level: p.level,
      nativeLang: p.nativeLang,
      targetLang: p.targetLang,
    }),
    OBJECTIVE: p.objective,
    GRAMMAR_POINTS: p.grammarPoints.join(', '),
    VOCAB: p.targetVocab.map((v) => `${v.lemma} (${v.gloss})`).join('; '),
    SEED: p.seed,
    NOTES: formatNotesForPrompt(p.note ?? ''),
    SOURCE: sourceBlock,
  });

  const provider = createAIProvider(ai.provider);
  const response = await provider.generateResponse(
    systemPrompt,
    [
      {
        role: 'user',
        content: `Generate ${QUESTIONS_PER_SECTION} ${p.skill.toLowerCase()} questions.`,
      },
    ],
    { model: ai.model, apiKeyOverride: ai.apiKey, maxTokens: 4096, temperature: 0.8 }
  );

  logUsage({
    service: ai.provider,
    model: response.model,
    category: 'class-section',
    inputTokens: response.inputTokens,
    outputTokens: response.outputTokens,
    userId: p.userId,
  });

  let raw: RawGeneratedQuestion[];
  try {
    raw = parseRawQuestions(response.content);
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
        q.options.every((option) => typeof option === 'string') &&
        Number.isFinite(
          typeof q.correctIndex === 'number' ? q.correctIndex : Number(q.correctIndex)
        )
    )
    .map((q) => ({
      question: q.question as string,
      options: (q.options as string[]).slice(0, 4),
      correctIndex: Math.max(0, Math.min(3, Number(q.correctIndex))),
      explanation: typeof q.explanation === 'string' ? q.explanation : '',
      passageRef: typeof q.passageRef === 'string' ? q.passageRef : undefined,
      // Sourced READING: attach the leveled passage so the learner reads the
      // real excerpt the questions are about.
      passageText: useSourcePassage ? p.sourceContent : undefined,
    }));

  if (questions.length === 0) {
    throw new Error('Class generation produced no usable questions.');
  }
  return questions;
}
