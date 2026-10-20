// Adaptive CEFR placement test. The LLM flow: resolve the
// user's AI provider (BYOK or local Claude/Codex), render a prompt, call the
// model, parse JSON. A single batch of questions spans A1..C2; the learner's
// level is the highest band they clear on a staircase.
import { loadAndRender } from './prompt-loader';
import { formatNotesForPrompt } from './course-notes';
import { z } from 'zod';
import type { CefrLevel } from '@sotto/shared';

const PLACEMENT_LEVELS: CefrLevel[] = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];
const PLACEMENT_SKILLS = ['grammar', 'vocab', 'reading'] as const;
const PASS_THRESHOLD = 0.7;
const PER_BAND = 4;
export const PLACEMENT_SCORING_VERSION = 1;
export const placementPrivateQuestionSchema = z
  .object({
    id: z.string().regex(/^pq_\d+$/),
    cefr: z.enum(PLACEMENT_LEVELS as ['A1', 'A2', 'B1', 'B2', 'C1', 'C2']),
    skill: z.enum(PLACEMENT_SKILLS),
    prompt: z
      .string()
      .trim()
      .min(1)
      .max(4000)
      .refine((text) => text.isWellFormed()),
    options: z
      .array(
        z
          .string()
          .trim()
          .min(1)
          .max(2000)
          .refine((text) => text.isWellFormed())
      )
      .length(5),
    correctIndex: z.number().int().min(0).max(3),
    explanation: z
      .string()
      .max(4000)
      .refine((text) => text.isWellFormed()),
  })
  .strict();
const generatedQuestionSchema = placementPrivateQuestionSchema
  .omit({ id: true })
  .extend({
    options: z
      .array(
        z
          .string()
          .trim()
          .min(1)
          .max(2000)
          .refine((text) => text.isWellFormed())
      )
      .length(4),
  })
  .strict()
  .refine((question) => new Set(question.options).size === 4, 'Question options must be distinct.');
const PLACEMENT_RESPONSE_SCHEMA = z.toJSONSchema(
  z.object({ questions: z.array(generatedQuestionSchema).min(6).max(24) }).strict()
);

export function preparePlacementQuestionBatch(
  nativeLang: string,
  targetLang: string,
  note = '',
  perBand = PER_BAND
) {
  if (!Number.isSafeInteger(perBand) || perBand < 1 || perBand > PER_BAND)
    throw new Error('Invalid questions per placement band.');
  const count = PLACEMENT_LEVELS.length * perBand;
  return {
    system:
      loadAndRender('placement/placement-probe.md', {
        NATIVE: nativeLang,
        TARGET: targetLang,
        LEVELS: PLACEMENT_LEVELS.join(', '),
        SKILLS: PLACEMENT_SKILLS.join(', '),
        PER_BAND: String(perBand),
        COUNT: String(count),
        NOTES: formatNotesForPrompt(note),
      }) +
      '\nReturn one JSON object with a questions array matching the supplied strict schema. Source material difficulty is not learner mastery.',
    messages: [
      {
        role: 'user' as const,
        content: `Generate exactly ${count} placement questions (${perBand} per CEFR level).`,
      },
    ],
    jsonSchema: { name: 'placement_questions', schema: PLACEMENT_RESPONSE_SCHEMA },
    maxOutputTokens: 8192,
    perBand,
  };
}

/** A retained complete response must contain the complete requested band ladder. */
export function parsePlacementQuestionBatch(
  content: string,
  nativeLang: string,
  perBand: number
): PlacementQuestion[] {
  if (Buffer.byteLength(content, 'utf8') > 512 * 1024)
    throw new Error('Placement output exceeds its receipt budget.');
  const output = z
    .object({ questions: z.array(generatedQuestionSchema).min(6).max(24) })
    .strict()
    .parse(JSON.parse(content));
  if (
    output.questions.length !== PLACEMENT_LEVELS.length * perBand ||
    PLACEMENT_LEVELS.some(
      (level) => output.questions.filter((question) => question.cefr === level).length !== perBand
    ) ||
    output.questions.some((question) => question.options.includes(idkLabel(nativeLang)))
  )
    throw new Error('Placement must include every requested question in every CEFR band.');
  return output.questions.map((question, index) => ({
    ...question,
    id: `pq_${index}`,
    options: [...question.options, idkLabel(nativeLang)],
  }));
}

// "I don't know" in the learner's native language, so even an absolute beginner
// can opt out of guessing. Appended as the last option of every placement
// question; choosing it scores as not-mastered (it is never the correct index).
const IDK_LABELS: Record<string, string> = {
  en: "I don't know",
  es: 'No lo sé',
  fr: 'Je ne sais pas',
  de: 'Ich weiß nicht',
  pt: 'Não sei',
  it: 'Non lo so',
  ja: 'わかりません',
  ko: '모르겠어요',
  zh: '我不知道',
  ar: 'لا أعرف',
  hi: 'मुझे नहीं पता',
  ru: 'Я не знаю',
  nl: 'Ik weet het niet',
  sv: 'Jag vet inte',
  pl: 'Nie wiem',
  tr: 'Bilmiyorum',
  da: 'Det ved jeg ikke',
  fi: 'En tiedä',
  no: 'Jeg vet ikke',
  cs: 'Nevím',
  ro: 'Nu știu',
  hu: 'Nem tudom',
  el: 'Δεν ξέρω',
  he: 'אני לא יודע',
  th: 'ฉันไม่รู้',
  vi: 'Tôi không biết',
  id: 'Saya tidak tahu',
  ms: 'Saya tidak tahu',
  uk: 'Я не знаю',
  ca: 'No ho sé',
};

/** The native-language "I don't know" label, falling back to English. */
export function idkLabel(nativeLang: string): string {
  return IDK_LABELS[nativeLang.trim().toLowerCase()] ?? IDK_LABELS.en;
}

type PlacementSkill = (typeof PLACEMENT_SKILLS)[number];

export interface PlacementQuestion {
  id: string;
  cefr: CefrLevel;
  skill: PlacementSkill;
  prompt: string;
  options: string[];
  correctIndex: number; // server-only
  explanation: string; // server-only
}

export type PlacementQuestionPublic = Pick<
  PlacementQuestion,
  'id' | 'cefr' | 'skill' | 'prompt' | 'options'
>;

export function toPublic(q: PlacementQuestion): PlacementQuestionPublic {
  return { id: q.id, cefr: q.cefr, skill: q.skill, prompt: q.prompt, options: q.options };
}

export interface PlacementOutcome {
  level: CefrLevel;
  scoreByBand: Record<string, number>;
  scoreBySkill: Record<string, number>;
  responses: Array<{
    id: string;
    cefr: CefrLevel;
    skill: PlacementSkill;
    selectedIndex: number;
    correct: boolean;
  }>;
}

export function scorePlacement(
  questions: PlacementQuestion[],
  answers: Array<{ id: string; selectedIndex: number }>
): PlacementOutcome {
  const selected = new Map(answers.map((a) => [a.id, a.selectedIndex]));
  const band: Record<string, { correct: number; total: number }> = {};
  const skill: Record<string, { correct: number; total: number }> = {};
  const responses: PlacementOutcome['responses'] = [];

  for (const q of questions) {
    const sel = selected.get(q.id) ?? -1;
    const correct = sel === q.correctIndex;
    (band[q.cefr] ??= { correct: 0, total: 0 }).total += 1;
    if (correct) band[q.cefr].correct += 1;
    (skill[q.skill] ??= { correct: 0, total: 0 }).total += 1;
    if (correct) skill[q.skill].correct += 1;
    responses.push({ id: q.id, cefr: q.cefr, skill: q.skill, selectedIndex: sel, correct });
  }

  const ratio = (s: { correct: number; total: number }) => (s.total > 0 ? s.correct / s.total : 0);
  const scoreByBand = Object.fromEntries(Object.entries(band).map(([k, v]) => [k, ratio(v)]));
  const scoreBySkill = Object.fromEntries(Object.entries(skill).map(([k, v]) => [k, ratio(v)]));

  // Staircase: walk up the bands; stop at the first band below threshold.
  let level: CefrLevel = 'A1';
  for (const b of PLACEMENT_LEVELS) {
    if ((scoreByBand[b] ?? 0) >= PASS_THRESHOLD) {
      level = b;
    } else {
      break;
    }
  }

  return { level, scoreByBand, scoreBySkill, responses };
}
