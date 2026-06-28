import { z } from 'zod';
import { resolveLearningAi } from '../learning-ai';
import { createAIProvider } from '../providers/ai';
import { loadAndRender } from '../prompt-loader';
import { formatNotesForPrompt } from '../course-notes';
import { logUsage } from '../usage-logger';
import { logger } from '../logger';
import { classLanguagePolicy, isImmersionLevel } from './class-language-policy';

export interface ClassIntroExample {
  target: string;
  meaning: string;
  note: string;
}

export interface ClassIntro {
  purpose: string;
  about: string;
  focus: string[];
  examples: ClassIntroExample[];
  tips: string[];
}

export interface ClassIntroParams {
  userId: string;
  level: string;
  nativeLang: string;
  targetLang: string;
  title: string;
  objective: string;
  grammarPoints: string[];
  targetVocab: Array<{ lemma: string; gloss: string; pos?: string }>;
  note?: string;
  sourceTitle?: string | null;
}

const introSchema = z.object({
  purpose: z.string().min(1),
  about: z.string().min(1),
  focus: z.array(z.string().min(1)).min(1).max(6),
  examples: z
    .array(
      z.object({
        target: z.string().min(1),
        meaning: z.string().min(1),
        note: z.string().min(1),
      })
    )
    .min(1)
    .max(5),
  tips: z.array(z.string().min(1)).min(1).max(5),
});

function cleanJson(text: string): string {
  return text
    .trim()
    .replace(/^```(?:json)?\s*\n?/i, '')
    .replace(/\n?```\s*$/i, '')
    .trim();
}

function labelFromKey(key: string): string {
  return key
    .split('-')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function normalizeIntro(value: unknown): ClassIntro | null {
  const parsed = introSchema.safeParse(value);
  if (!parsed.success) return null;
  return parsed.data;
}

export function classIntroFromSeed(
  seed: unknown,
  fallback: Omit<ClassIntroParams, 'userId'>
): ClassIntro {
  if (seed && typeof seed === 'object' && 'intro' in seed) {
    const intro = normalizeIntro((seed as { intro?: unknown }).intro);
    if (intro) return intro;
  }
  return buildFallbackClassIntro(fallback);
}

export function buildFallbackClassIntro(p: Omit<ClassIntroParams, 'userId'>): ClassIntro {
  const immersion = isImmersionLevel(p.level);
  const grammar = p.grammarPoints.map(labelFromKey).slice(0, 4);
  const vocab = p.targetVocab.slice(0, 5);
  const focus = [
    ...grammar.map((item) => (immersion ? item : `Recognize and use ${item.toLowerCase()}.`)),
    ...vocab.slice(0, Math.max(0, 4 - grammar.length)).map((item) => item.lemma),
  ].slice(0, 5);

  const examples =
    vocab.length > 0
      ? vocab.slice(0, 3).map((item) => ({
          target: item.lemma,
          meaning: immersion ? item.lemma : item.gloss,
          note: immersion
            ? item.lemma
            : `Listen for how this ${item.pos ?? 'item'} changes the meaning of the sentence.`,
        }))
      : [
          {
            target: p.title,
            meaning: immersion ? p.title : p.objective,
            note: immersion ? p.title : 'Read the prompt for meaning first, then check the form.',
          },
        ];

  const sourceLead = p.sourceTitle ? ` using ${p.sourceTitle}` : '';
  if (immersion) {
    const targetItems = vocab.map((item) => item.lemma).join(', ');
    return {
      purpose: `${p.level} ${p.targetLang}${sourceLead}: ${targetItems || p.title}.`,
      about: targetItems || p.title,
      focus: focus.length > 0 ? focus : [p.targetLang],
      examples,
      tips: grammar.length > 0 ? grammar : [p.targetLang],
    };
  }

  return {
    purpose: `Build ${p.level} control of ${p.title.toLowerCase()}${sourceLead}.`,
    about: `${p.objective} Start by identifying the message, then check the grammar signal that makes the sentence work.`,
    focus: focus.length > 0 ? focus : ['Understand the main idea before choosing an answer.'],
    examples,
    tips: [
      'Answer for meaning first; then verify the grammar form.',
      'Watch endings, word order, and small connector words.',
      'Say each example aloud once before moving to the questions.',
    ],
  };
}

export async function generateClassIntro(p: ClassIntroParams): Promise<ClassIntro> {
  const fallback = buildFallbackClassIntro(p);

  try {
    const ai = await resolveLearningAi(p.userId);
    const systemPrompt = loadAndRender('class/generate-class-intro.md', {
      NATIVE: p.nativeLang,
      TARGET: p.targetLang,
      LEVEL: p.level,
      LANGUAGE_POLICY: classLanguagePolicy({
        level: p.level,
        nativeLang: p.nativeLang,
        targetLang: p.targetLang,
      }),
      TITLE: p.title,
      OBJECTIVE: p.objective,
      GRAMMAR_POINTS: p.grammarPoints.join(', '),
      VOCAB: p.targetVocab
        .slice(0, 12)
        .map((item) => `${item.lemma} (${item.gloss})`)
        .join('; '),
      SOURCE: p.sourceTitle ?? '',
      NOTES: formatNotesForPrompt(p.note ?? ''),
    });

    const provider = createAIProvider(ai.provider);
    const response = await provider.generateResponse(
      systemPrompt,
      [{ role: 'user', content: 'Write the opening class teaching brief.' }],
      { model: ai.model, apiKeyOverride: ai.apiKey, maxTokens: 1800, temperature: 0.5 }
    );

    logUsage({
      service: ai.provider,
      model: response.model,
      category: 'class-intro',
      inputTokens: response.inputTokens,
      outputTokens: response.outputTokens,
      userId: p.userId,
    });

    const parsed = normalizeIntro(JSON.parse(cleanJson(response.content)));
    return parsed ?? fallback;
  } catch (err) {
    logger.warn('generateClassIntro failed; using deterministic fallback', {
      error: err instanceof Error ? err.message : String(err),
    });
    return fallback;
  }
}
