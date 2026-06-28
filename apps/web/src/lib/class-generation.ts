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
const MAX_GENERATION_ATTEMPTS = 2;
const LOGGED_OUTPUT_SNIPPET_CHARS = 500;

const CLASS_SECTION_QUIZ_JSON_SCHEMA = {
  name: 'class_section_questions',
  schema: {
    type: 'object',
    properties: {
      questions: {
        type: 'array',
        minItems: 1,
        maxItems: QUESTIONS_PER_SECTION,
        items: {
          type: 'object',
          properties: {
            question: { type: 'string' },
            options: {
              type: 'array',
              minItems: 4,
              maxItems: 4,
              items: { type: 'string' },
            },
            correctIndex: { type: 'integer', minimum: 0, maximum: 3 },
            explanation: { type: 'string' },
            passageRef: { type: 'string' },
          },
          required: ['question', 'options', 'correctIndex', 'explanation', 'passageRef'],
          additionalProperties: false,
        },
      },
    },
    required: ['questions'],
    additionalProperties: false,
  },
} as const;

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

function buildUserPrompt(skill: SkillType, attempt: number, previousError?: string): string {
  const base = `Generate ${QUESTIONS_PER_SECTION} ${skill.toLowerCase()} questions.`;
  if (attempt === 1) return base;
  return [
    base,
    '',
    `The previous response could not be used: ${previousError ?? 'invalid JSON'}.`,
    'Return ONLY a valid JSON array. Do not include markdown fences, prose, comments, trailing commas, or unescaped quotation marks inside string values.',
  ].join('\n');
}

function loggedOutputSnippet(content: string): string {
  return sanitizeLlmJson(content).replace(/\s+/g, ' ').slice(0, LOGGED_OUTPUT_SNIPPET_CHARS);
}

function buildRepairPrompt(content: string, previousError: string): string {
  return [
    'Repair the malformed response below into ONLY valid JSON matching the class_section_questions schema.',
    `Parser error: ${previousError}`,
    '',
    'Rules:',
    '- Preserve the educational meaning where possible.',
    `- Return at most ${QUESTIONS_PER_SECTION} questions.`,
    '- Each question must have exactly 4 options and a 0-based correctIndex.',
    '- Include passageRef as an empty string when there is no passage.',
    '- No markdown fences, prose, comments, or trailing commas.',
    '',
    'Malformed response:',
    content,
  ].join('\n');
}

function normalizeQuestions(
  raw: RawGeneratedQuestion[],
  useSourcePassage: boolean,
  sourceContent?: string
): GeneratedQuestion[] {
  return raw
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
      passageText: useSourcePassage ? sourceContent : undefined,
    }));
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
  let lastError = 'invalid class-section output';
  let lastMalformedContent = '';

  for (let attempt = 1; attempt <= MAX_GENERATION_ATTEMPTS; attempt += 1) {
    const response = await provider.generateResponse(
      systemPrompt,
      [
        {
          role: 'user',
          content: buildUserPrompt(p.skill, attempt, lastError),
        },
      ],
      {
        model: ai.model,
        apiKeyOverride: ai.apiKey,
        maxTokens: 4096,
        temperature: 0.8,
        jsonSchema: CLASS_SECTION_QUIZ_JSON_SCHEMA,
      }
    );

    logUsage({
      service: ai.provider,
      model: response.model,
      category: 'class-section',
      inputTokens: response.inputTokens,
      outputTokens: response.outputTokens,
      userId: p.userId,
    });

    try {
      const raw = parseRawQuestions(response.content);
      const questions = normalizeQuestions(raw, useSourcePassage, p.sourceContent);
      if (questions.length > 0) return questions;
      lastError = 'response contained no usable questions';
      lastMalformedContent = '';
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
      lastMalformedContent = response.content;
    }

    if (attempt < MAX_GENERATION_ATTEMPTS) {
      logger.warn('Retrying class-section generation after unusable LLM response', {
        skill: p.skill,
        error: lastError,
        outputSnippet: loggedOutputSnippet(response.content),
      });
    }
  }

  if (lastMalformedContent) {
    logger.warn('Repairing malformed class-section LLM response', {
      skill: p.skill,
      error: lastError,
      outputSnippet: loggedOutputSnippet(lastMalformedContent),
    });

    try {
      const repairResponse = await provider.generateResponse(
        [
          systemPrompt,
          '',
          'You are repairing malformed JSON. Return ONLY valid JSON matching the provided schema.',
        ].join('\n'),
        [{ role: 'user', content: buildRepairPrompt(lastMalformedContent, lastError) }],
        {
          model: ai.model,
          apiKeyOverride: ai.apiKey,
          maxTokens: 4096,
          temperature: 0,
          jsonSchema: CLASS_SECTION_QUIZ_JSON_SCHEMA,
        }
      );

      logUsage({
        service: ai.provider,
        model: repairResponse.model,
        category: 'class-section-repair',
        inputTokens: repairResponse.inputTokens,
        outputTokens: repairResponse.outputTokens,
        userId: p.userId,
      });

      const raw = parseRawQuestions(repairResponse.content);
      const questions = normalizeQuestions(raw, useSourcePassage, p.sourceContent);
      if (questions.length > 0) return questions;
      lastError = 'repaired response contained no usable questions';
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
    }
  }

  logger.error('Failed to parse class-section LLM response', {
    error: lastError,
    outputSnippet: lastMalformedContent ? loggedOutputSnippet(lastMalformedContent) : undefined,
  });
  throw new Error(
    lastError === 'response contained no usable questions' ||
      lastError === 'repaired response contained no usable questions'
      ? 'Class generation produced no usable questions.'
      : 'Class generation returned malformed output.'
  );
}
