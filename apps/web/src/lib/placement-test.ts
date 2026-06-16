// Adaptive CEFR placement test. The LLM flow: resolve the
// user's AI provider (BYOK or local Claude/Codex), render a prompt, call the
// model, parse JSON. A single batch of questions spans A1..C2; the learner's
// level is the highest band they clear on a staircase.
import { resolveLearningAi } from './learning-ai';
import { createAIProvider } from './providers/ai';
import { loadAndRender } from './prompt-loader';
import { formatNotesForPrompt } from './course-notes';
import { logUsage } from './usage-logger';
import { logger } from './logger';
import { CEFR_ORDER } from './cefr-levels';
import type { CefrLevel } from '@sotto/shared';

export const PLACEMENT_LEVELS: CefrLevel[] = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];
export const PLACEMENT_SKILLS = ['grammar', 'vocab', 'reading'] as const;
const PASS_THRESHOLD = 0.7;
const PER_BAND = 4;

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

export type PlacementSkill = (typeof PLACEMENT_SKILLS)[number];

export interface PlacementQuestion {
  id: string;
  cefr: CefrLevel;
  skill: PlacementSkill;
  prompt: string;
  options: string[];
  correctIndex: number; // server-only
  explanation: string; // server-only
}

export type PlacementQuestionPublic = Pick<PlacementQuestion, 'id' | 'cefr' | 'skill' | 'prompt' | 'options'>;

export function toPublic(q: PlacementQuestion): PlacementQuestionPublic {
  return { id: q.id, cefr: q.cefr, skill: q.skill, prompt: q.prompt, options: q.options };
}


export async function generatePlacement(
  userId: string,
  nativeLang: string,
  targetLang: string,
  note = '',
  // Questions per CEFR band. Defaults to the full test; the "verify with a few
  // questions" path passes a smaller value for a shorter run. Clamped 1..PER_BAND.
  perBand: number = PER_BAND,
): Promise<{ questions: PlacementQuestion[]; provider: string; model: string }> {
  const ai = await resolveLearningAi(userId);
  const bandCount = Math.max(1, Math.min(PER_BAND, Math.round(perBand)));
  const count = PLACEMENT_LEVELS.length * bandCount;

  const systemPrompt = loadAndRender('placement/placement-probe.md', {
    NATIVE: nativeLang,
    TARGET: targetLang,
    LEVELS: PLACEMENT_LEVELS.join(', '),
    SKILLS: PLACEMENT_SKILLS.join(', '),
    PER_BAND: String(bandCount),
    COUNT: String(count),
    NOTES: formatNotesForPrompt(note),
  });

  const provider = createAIProvider(ai.provider);
  const response = await provider.generateResponse(
    systemPrompt,
    [{ role: 'user', content: `Generate exactly ${count} placement questions (${bandCount} per CEFR level).` }],
    { model: ai.model, apiKeyOverride: ai.apiKey, maxTokens: 6000, temperature: 0.7 },
  );

  logUsage({
    service: ai.provider,
    model: response.model,
    category: 'placement',
    inputTokens: response.inputTokens,
    outputTokens: response.outputTokens,
    userId,
  });

  const cleaned = response.content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
  let raw: Array<{ cefr?: string; skill?: string; prompt?: string; options?: string[]; correctIndex?: number; explanation?: string }>;
  try {
    raw = JSON.parse(cleaned);
  } catch (err) {
    logger.error('Failed to parse placement LLM response', { error: err instanceof Error ? err.message : String(err) });
    throw new Error('Placement generation returned malformed output.');
  }

  const questions = raw
    .filter(
      (q) =>
        typeof q.prompt === 'string' &&
        PLACEMENT_LEVELS.includes(q.cefr as CefrLevel) &&
        Array.isArray(q.options) &&
        q.options.length === 4 &&
        typeof q.correctIndex === 'number',
    )
    .map((q, i): PlacementQuestion => ({
      id: `pq_${i}`,
      cefr: q.cefr as CefrLevel,
      skill: (PLACEMENT_SKILLS.includes(q.skill as PlacementSkill) ? q.skill : 'grammar') as PlacementSkill,
      prompt: q.prompt as string,
      // The LLM returns 4 content options; append a native-language "I don't
      // know" as the 5th (index 4). correctIndex stays 0..3, so picking it is
      // always scored as not-mastered.
      options: [...(q.options as string[]).slice(0, 4), idkLabel(nativeLang)],
      correctIndex: Math.max(0, Math.min(3, q.correctIndex as number)),
      explanation: q.explanation ?? '',
    }));

  if (questions.length === 0) {
    throw new Error('Placement generation produced no usable questions.');
  }

  return { questions, provider: ai.provider, model: response.model };
}

export interface PlacementOutcome {
  level: CefrLevel;
  scoreByBand: Record<string, number>;
  scoreBySkill: Record<string, number>;
  responses: Array<{ id: string; cefr: CefrLevel; skill: PlacementSkill; selectedIndex: number; correct: boolean }>;
}

export function scorePlacement(
  questions: PlacementQuestion[],
  answers: Array<{ id: string; selectedIndex: number }>,
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

export interface NotesDeduction {
  level: CefrLevel;
  rationale: string;
  /** 0..1 — how strongly the materials support the level. */
  confidence: number;
}

/**
 * Deduce a learner's CEFR level from materials they uploaded (notes, a textbook
 * excerpt, their own writing). Pure inference — no DB writes; the caller decides
 * whether to confirm directly or verify with a short quiz, then creates the
 * course. Reuses the learner's resolved AI provider, same as generatePlacement.
 */
export async function deduceLevelFromNotes(
  userId: string,
  nativeLang: string,
  targetLang: string,
  content: string,
): Promise<{ deduction: NotesDeduction; provider: string; model: string }> {
  const ai = await resolveLearningAi(userId);

  const systemPrompt = loadAndRender('placement/deduce-from-notes.md', {
    NATIVE: nativeLang,
    TARGET: targetLang,
    CONTENT: content,
  });

  const provider = createAIProvider(ai.provider);
  const response = await provider.generateResponse(
    systemPrompt,
    [{ role: 'user', content: 'Assess the CEFR level shown by these materials.' }],
    { model: ai.model, apiKeyOverride: ai.apiKey, maxTokens: 800, temperature: 0.2 },
  );

  logUsage({
    service: ai.provider,
    model: response.model,
    category: 'placement',
    inputTokens: response.inputTokens,
    outputTokens: response.outputTokens,
    userId,
  });

  const cleaned = response.content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
  let raw: { level?: string; rationale?: string; confidence?: number };
  try {
    raw = JSON.parse(cleaned);
  } catch (err) {
    logger.error('Failed to parse notes-deduction LLM response', {
      error: err instanceof Error ? err.message : String(err),
    });
    throw new Error('Level deduction returned malformed output.');
  }

  const level = (CEFR_ORDER as readonly string[]).includes(raw.level ?? '')
    ? (raw.level as CefrLevel)
    : 'A1';
  const confidence = typeof raw.confidence === 'number' ? Math.max(0, Math.min(1, raw.confidence)) : 0;
  const rationale = typeof raw.rationale === 'string' ? raw.rationale.trim() : '';

  return { deduction: { level, rationale, confidence }, provider: ai.provider, model: response.model };
}
