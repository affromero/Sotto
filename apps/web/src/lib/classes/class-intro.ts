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

export interface ClassIntroVisuals {
  timeline: {
    title: string;
    steps: string[];
  } | null;
  contrast: {
    title: string;
    leftLabel: string;
    leftItems: string[];
    rightLabel: string;
    rightItems: string[];
  } | null;
  callouts: Array<{
    label: string;
    text: string;
    tone: 'blue' | 'teal' | 'rose' | 'amber';
  }>;
  links: Array<{
    label: string;
    url: string;
  }>;
}

export interface ClassIntro {
  purpose: string;
  about: string;
  focus: string[];
  examples: ClassIntroExample[];
  tips: string[];
  visuals?: ClassIntroVisuals;
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
  visuals: z
    .object({
      timeline: z
        .object({
          title: z.string().min(1),
          steps: z.array(z.string().min(1)).min(2).max(6),
        })
        .nullable()
        .optional(),
      contrast: z
        .object({
          title: z.string().min(1),
          leftLabel: z.string().min(1),
          leftItems: z.array(z.string().min(1)).min(1).max(5),
          rightLabel: z.string().min(1),
          rightItems: z.array(z.string().min(1)).min(1).max(5),
        })
        .nullable()
        .optional(),
      callouts: z
        .array(
          z.object({
            label: z.string().min(1),
            text: z.string().min(1),
            tone: z.enum(['blue', 'teal', 'rose', 'amber']).optional(),
          })
        )
        .max(4)
        .optional(),
      links: z
        .array(
          z.object({
            label: z.string().min(1),
            url: z.string().url(),
          })
        )
        .max(3)
        .optional(),
    })
    .optional(),
});

type ParsedIntro = z.infer<typeof introSchema>;
type ParsedIntroVisuals = ParsedIntro['visuals'];

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
  return completeIntro(parsed.data);
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
    return completeIntro({
      purpose: `${p.level} ${p.targetLang}${sourceLead}: ${targetItems || p.title}.`,
      about: targetItems || p.title,
      focus: focus.length > 0 ? focus : [p.targetLang],
      examples,
      tips: grammar.length > 0 ? grammar : [p.targetLang],
    });
  }

  return completeIntro({
    purpose: `Build ${p.level} control of ${p.title.toLowerCase()}${sourceLead}.`,
    about: `${p.objective} Start by identifying the message, then check the grammar signal that makes the sentence work.`,
    focus: focus.length > 0 ? focus : ['Understand the main idea before choosing an answer.'],
    examples,
    tips: [
      'Answer for meaning first; then verify the grammar form.',
      'Watch endings, word order, and small connector words.',
      'Say each example aloud once before moving to the questions.',
    ],
  });
}

function completeIntro(
  intro: Omit<ClassIntro, 'visuals'> & { visuals?: ParsedIntroVisuals }
): ClassIntro {
  const cleanIntro = { ...intro, examples: intro.examples.filter(isUsefulExample) };
  const derived = deriveIntroVisuals(cleanIntro);
  const normalized = normalizeVisuals(cleanIntro.visuals);
  return {
    ...cleanIntro,
    visuals: normalized ? { ...derived, ...normalized } : derived,
  };
}

function normalizeVisuals(visuals: ParsedIntroVisuals): ClassIntroVisuals | undefined {
  if (!visuals) return undefined;

  return {
    timeline: visuals.timeline
      ? { title: visuals.timeline.title, steps: visuals.timeline.steps.slice(0, 6) }
      : null,
    contrast: normalizeContrast(visuals.contrast ?? null),
    callouts: (visuals.callouts ?? []).slice(0, 4).map((callout) => ({
      label: callout.label,
      text: callout.text,
      tone: callout.tone ?? 'blue',
    })),
    links: (visuals.links ?? []).slice(0, 3),
  };
}

function textKey(value: string): string {
  return value
    .toLocaleLowerCase()
    .normalize('NFKD')
    .replace(/[^\p{Letter}\p{Number}]+/gu, ' ')
    .trim();
}

function wordCount(value: string): number {
  return textKey(value).split(/\s+/).filter(Boolean).length;
}

function isUsefulExample(example: ClassIntroExample): boolean {
  const target = textKey(example.target);
  const meaning = textKey(example.meaning);
  const note = textKey(example.note);
  if (!target || !meaning || !note) return false;
  const allSame = new Set([target, meaning, note]).size === 1;
  if (allSame) return false;
  const hasPhrase = wordCount(example.target) >= 3;
  const hasTeachingNote = note !== target && note !== meaning && wordCount(example.note) >= 4;
  return hasPhrase || hasTeachingNote;
}

function meaningfulItems(label: string, items: string[]): string[] {
  const labelKey = textKey(label);
  const seen = new Set<string>();
  return items
    .map((item) => item.trim())
    .filter((item) => {
      const key = textKey(item);
      if (!key || key === labelKey || seen.has(key)) return false;
      seen.add(key);
      return wordCount(item) >= 2;
    })
    .slice(0, 5);
}

function normalizeContrast(
  contrast: NonNullable<ParsedIntroVisuals>['contrast'] | null
): ClassIntroVisuals['contrast'] {
  if (!contrast) return null;

  const leftItems = meaningfulItems(contrast.leftLabel, contrast.leftItems);
  const rightItems = meaningfulItems(contrast.rightLabel, contrast.rightItems);
  if (leftItems.length === 0 || rightItems.length === 0) return null;
  if (textKey(contrast.leftLabel) === textKey(contrast.rightLabel)) return null;

  return {
    title: contrast.title,
    leftLabel: contrast.leftLabel,
    leftItems,
    rightLabel: contrast.rightLabel,
    rightItems,
  };
}

function deriveIntroVisuals(intro: Omit<ClassIntro, 'visuals'>): ClassIntroVisuals {
  const timelineSteps = deriveTimelineSteps(intro);
  const contrast = deriveContrast(intro);
  const tones: Array<'blue' | 'teal' | 'rose' | 'amber'> = ['blue', 'teal', 'rose', 'amber'];

  return {
    timeline:
      timelineSteps.length >= 2
        ? {
            title: timelineSteps.some((step) => /zuerst|dann|then|first|finally|schlie/i.test(step))
              ? 'Story order'
              : 'Learning path',
            steps: timelineSteps,
          }
        : null,
    contrast,
    callouts: intro.tips.slice(0, 4).map((tip, index) => ({
      label: `Tip ${index + 1}`,
      text: tip,
      tone: tones[index % tones.length],
    })),
    links: [],
  };
}

function deriveTimelineSteps(intro: Omit<ClassIntro, 'visuals'>): string[] {
  const explicitSequence = intro.focus
    .flatMap((item) => item.split(/→|->|⇒|, then | then |, dann | dann /i))
    .map((item) => item.trim().replace(/^[.:;\-\s]+|[.:;\-\s]+$/g, ''))
    .filter((item) => item.length > 1 && item.length <= 48);

  if (explicitSequence.length >= 2) {
    return explicitSequence.slice(0, 5);
  }

  return intro.examples
    .slice(0, 4)
    .map((example) => example.target.trim())
    .filter((item) => item.length > 0)
    .map((item) => (item.length > 64 ? `${item.slice(0, 61).trim()}...` : item));
}

function deriveContrast(intro: Omit<ClassIntro, 'visuals'>): ClassIntroVisuals['contrast'] {
  const leftItems: string[] = [];
  const rightItems: string[] = [];

  for (const item of [...intro.focus, ...intro.tips]) {
    if (/perfekt/i.test(item)) leftItems.push(item);
    else if (/präteritum|praeteritum|war|hatte|musste|wollte/i.test(item)) rightItems.push(item);
    else if (/\bals\b/i.test(item)) leftItems.push(item);
    else if (/\bwenn\b/i.test(item)) rightItems.push(item);
  }

  if (leftItems.length > 0 && rightItems.length > 0) {
    const isPastTense = [...leftItems, ...rightItems].some((item) =>
      /perfekt|präteritum|praeteritum/i.test(item)
    );
    return {
      title: isPastTense ? 'Tense choice map' : 'Decision map',
      leftLabel: isPastTense ? 'Perfekt / one-time cue' : 'Use when...',
      leftItems: leftItems.slice(0, 3),
      rightLabel: isPastTense ? 'Präteritum / repeated cue' : 'Avoid when...',
      rightItems: rightItems.slice(0, 3),
    };
  }

  const examples = intro.examples.slice(0, 2);
  if (examples.length >= 2) {
    return normalizeContrast({
      title: 'Compare the examples',
      leftLabel: examples[0].target,
      leftItems: [examples[0].meaning, examples[0].note],
      rightLabel: examples[1].target,
      rightItems: [examples[1].meaning, examples[1].note],
    });
  }

  return null;
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
