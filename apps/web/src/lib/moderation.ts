import { createHash } from 'node:crypto';
import { abortable } from 'thesidedoor-core/runtime/stream';
import { cache } from './redis';
import { logUsage } from './usage-logger';

const MODERATION_API_URL = 'https://api.openai.com/v1/moderations';
const MODERATION_MODEL = 'omni-moderation-latest';
const CACHE_TTL_SECONDS = 600;
const MAX_INPUT_LENGTH = 32_000;

const CATEGORY_THRESHOLDS: Record<string, number> = {
  'sexual/minors': 0.1,
  sexual: 0.5,
  'harassment/threatening': 0.5,
  harassment: 0.6,
  'hate/threatening': 0.5,
  hate: 0.6,
  'self-harm/intent': 0.4,
  'self-harm/instructions': 0.3,
  'self-harm': 0.5,
  'violence/graphic': 0.6,
  violence: 0.7,
  'illicit/violent': 0.4,
  illicit: 0.5,
};

export interface ModerationResult {
  flagged: boolean;
  categories: Record<string, boolean>;
  scores: Record<string, number>;
  blockedCategories: string[];
}

export interface ModerationPort {
  fetch: typeof fetch;
  model?: string;
}

export class ContentModerationError extends Error {
  readonly categories: string[];

  constructor(categories: string[]) {
    super(`Content flagged for: ${categories.join(', ')}`);
    this.name = 'ContentModerationError';
    this.categories = categories;
  }
}

function cacheKey(model: string, text: string): string {
  return `mod:${createHash('sha256').update(`${model}\0${text}`).digest('hex')}`;
}

/** Run moderation only through a captured, authorized provider transport. */
export async function moderateContent(
  text: string,
  port?: ModerationPort,
  signal?: AbortSignal
): Promise<ModerationResult> {
  signal?.throwIfAborted();
  if (!port) return { flagged: false, categories: {}, scores: {}, blockedCategories: [] };
  const truncated = text.slice(0, MAX_INPUT_LENGTH);
  const model = port.model ?? MODERATION_MODEL;
  const key = cacheKey(model, truncated);
  const lookup = cache.get<ModerationResult>(key).catch(() => null);
  const cached = await (signal ? abortable(lookup, signal) : lookup);
  if (cached) return cached;

  const response = await port.fetch(MODERATION_API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, input: truncated }),
    signal,
  });
  if (!response.ok) {
    const status = response.status;
    await response.body?.cancel();
    throw new Error(`Moderation provider returned HTTP ${status}`);
  }
  const data = (await response.json()) as {
    results?: Array<{
      categories: Record<string, boolean>;
      category_scores: Record<string, number>;
    }>;
  };
  const result = data.results?.[0];
  if (!result) throw new Error('Moderation provider returned no result');
  const blockedCategories = Object.entries(result.category_scores)
    .filter(([category, score]) => score >= (CATEGORY_THRESHOLDS[category] ?? 0.5))
    .map(([category]) => category);
  const moderation = {
    flagged: blockedCategories.length > 0,
    categories: result.categories,
    scores: result.category_scores,
    blockedCategories,
  };
  await logUsage({
    service: 'openai',
    model,
    category: 'moderation',
    totalCost: 0,
    metadata: { inputChars: truncated.length },
  });
  signal?.throwIfAborted();
  await cache.set(key, moderation, CACHE_TTL_SECONDS);
  return moderation;
}

export async function moderateOrThrow(
  text: string,
  port?: ModerationPort,
  signal?: AbortSignal
): Promise<void> {
  const result = await moderateContent(text, port, signal);
  if (result.flagged) throw new ContentModerationError(result.blockedCategories);
}
