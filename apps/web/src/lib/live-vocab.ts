// Pulls notable new target-language vocabulary out of a live-conversation
// transcript and adds it to the learner's course memory graph, closing the loop
// between live practice and spaced-repetition review. Best-effort: any failure
// (no AI key, malformed model output) returns 0 and logs, never throws.
import { resolveLearningAi } from './learning-ai';
import { createAIProvider } from './providers/ai';
import { loadAndRender } from './prompt-loader';
import { logUsage } from './usage-logger';
import { logger } from './logger';
import { upsertLiveVocab, type VocabItem } from './knowledge-graph';
import type { CefrLevel } from '@sotto/shared';

const MAX_ITEMS = 12;
const MAX_TRANSCRIPT_CHARS = 6000;

interface RawVocab {
  lemma: string;
  gloss?: string;
  pos?: string;
}

function isRawVocab(x: unknown): x is RawVocab {
  if (typeof x !== 'object' || x === null) return false;
  const o = x as Record<string, unknown>;
  return typeof o.lemma === 'string' && o.lemma.trim() !== '';
}

/** Parse the model's JSON array of vocab items, tolerant of code fences. */
export function parseLiveVocab(content: string): VocabItem[] {
  const cleaned = content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
  let raw: unknown[];
  try {
    const parsed = JSON.parse(cleaned);
    raw = Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
  return raw
    .filter(isRawVocab)
    .slice(0, MAX_ITEMS)
    .map((r) => ({
      lemma: r.lemma.trim(),
      gloss: typeof r.gloss === 'string' ? r.gloss.trim() : '',
      pos: typeof r.pos === 'string' ? r.pos.trim() : undefined,
    }));
}

export interface ExtractLiveVocabParams {
  userId: string;
  courseId: string;
  targetLang: string;
  nativeLang: string;
  level: string;
  /** The conversation transcript (both sides; the prompt keeps only target words). */
  transcript: string;
}

/**
 * Extract new target-language vocab from a transcript and store it on the course
 * graph. Returns the number of newly added lemmas (0 on empty input or failure).
 */
export async function extractAndStoreLiveVocab(p: ExtractLiveVocabParams): Promise<number> {
  const text = p.transcript.trim();
  if (!text) return 0;

  try {
    const ai = await resolveLearningAi(p.userId);
    const systemPrompt = loadAndRender('live/extract-vocab.md', {
      TARGET: p.targetLang,
      NATIVE: p.nativeLang,
      LEVEL: p.level,
      MAX: String(MAX_ITEMS),
    });
    const client = createAIProvider(ai.provider);
    const res = await client.generateResponse(
      systemPrompt,
      [{ role: 'user', content: text.slice(0, MAX_TRANSCRIPT_CHARS) }],
      { model: ai.model, apiKeyOverride: ai.apiKey, maxTokens: 1024, temperature: 0.2 },
    );

    logUsage({
      service: ai.provider,
      model: res.model,
      category: 'live-vocab-extraction',
      inputTokens: res.inputTokens,
      outputTokens: res.outputTokens,
      userId: p.userId,
    });

    const items = parseLiveVocab(res.content);
    if (items.length === 0) return 0;
    return await upsertLiveVocab(p.courseId, items, p.level as CefrLevel);
  } catch (error: unknown) {
    logger.error('Live vocab extraction failed', {
      error: error instanceof Error ? error.message : String(error),
    });
    return 0;
  }
}
