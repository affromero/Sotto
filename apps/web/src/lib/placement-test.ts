// Adaptive CEFR placement test. Mirrors the taste-quiz LLM flow: resolve the
// user's AI provider (BYOK or local Claude/Codex), render a prompt, call the
// model, parse JSON. A single batch of questions spans A1..B2; the learner's
// level is the highest band they clear on a staircase.
import { getAiKey } from './byok';
import { getAiProviderMeta, type AiProviderId } from './providers/ai-registry';
import { createAIProvider } from './providers/ai';
import { loadAndRender } from './prompt-loader';
import { logUsage } from './usage-logger';
import { logger } from './logger';
import type { CefrLevel, LanguagePair } from '@sotto/shared';

export const PLACEMENT_LEVELS: CefrLevel[] = ['A1', 'A2', 'B1', 'B2'];
export const PLACEMENT_SKILLS = ['grammar', 'vocab', 'reading'] as const;
const PASS_THRESHOLD = 0.7;
const PER_BAND = 4;

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

const PAIR_LANGS: Record<LanguagePair, { native: string; target: string }> = {
  DE_FROM_EN: { native: 'en', target: 'de' },
  EN_FROM_ES: { native: 'es', target: 'en' },
  ES_FROM_EN: { native: 'en', target: 'es' },
};

export function pairToLangs(pair: LanguagePair): { native: string; target: string } {
  return PAIR_LANGS[pair];
}

interface ResolvedAi {
  provider: AiProviderId;
  model: string;
  apiKey?: string;
}

async function resolvePlacementAi(userId: string): Promise<ResolvedAi> {
  const aiKey = await getAiKey(userId);
  if (!aiKey) {
    throw new Error('An AI provider key (or a configured local Claude/Codex) is required to run the placement test.');
  }
  const model = getAiProviderMeta(aiKey.provider).defaultModel;
  if (!model) {
    throw new Error(`No default AI model configured for provider "${aiKey.provider}".`);
  }
  return { provider: aiKey.provider, model, apiKey: aiKey.apiKey };
}

export async function generatePlacement(
  userId: string,
  nativeLang: string,
  targetLang: string,
): Promise<{ questions: PlacementQuestion[]; provider: string; model: string }> {
  const ai = await resolvePlacementAi(userId);
  const count = PLACEMENT_LEVELS.length * PER_BAND;

  const systemPrompt = loadAndRender('placement/placement-probe.md', {
    NATIVE: nativeLang,
    TARGET: targetLang,
    LEVELS: PLACEMENT_LEVELS.join(', '),
    SKILLS: PLACEMENT_SKILLS.join(', '),
    PER_BAND: String(PER_BAND),
    COUNT: String(count),
  });

  const provider = createAIProvider(ai.provider);
  const response = await provider.generateResponse(
    systemPrompt,
    [{ role: 'user', content: `Generate exactly ${count} placement questions (${PER_BAND} per CEFR level).` }],
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
      options: (q.options as string[]).slice(0, 4),
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
