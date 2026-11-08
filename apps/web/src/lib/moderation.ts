import { createHash } from 'node:crypto';
import { z } from 'zod';
import { abortable } from 'thesidedoor-core/runtime/stream';
import { cache } from './redis';
import { logUsage } from './usage-logger';

export const MODERATION_API_URL = 'https://api.openai.com/v1/moderations';
export const MODERATION_MODEL = 'omni-moderation-latest';
const CACHE_TTL_SECONDS = 600;
const MAX_INPUT_LENGTH = 32_000;

export function moderationRequestBody(text: string, model = MODERATION_MODEL) {
  return JSON.stringify({ model, input: text.slice(0, MAX_INPUT_LENGTH) });
}

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
  /** Durable provider replay must consume the same moderation exchange after restart. */
  bypassCache?: boolean;
}

export class ContentModerationError extends Error {
  readonly categories: string[];

  constructor(categories: string[]) {
    super(`Content flagged for: ${categories.join(', ')}`);
    this.name = 'ContentModerationError';
    this.categories = categories;
  }
}

/** Interpret a provider response identically for live calls and retained receipts. */
export function interpretModerationResponse(data: unknown): ModerationResult {
  const parsed = z
    .object({
      results: z
        .array(
          z.object({
            categories: z.record(z.string(), z.boolean()),
            category_scores: z.record(z.string(), z.number().finite().min(0).max(1)),
          })
        )
        .min(1),
    })
    .safeParse(data);
  if (!parsed.success) throw new Error('Moderation provider returned no result');
  const result = parsed.data.results[0]!;
  const blockedCategories = Object.entries(result.category_scores)
    .filter(([category, score]) => score >= (CATEGORY_THRESHOLDS[category] ?? 0.5))
    .map(([category]) => category);
  return {
    flagged: blockedCategories.length > 0,
    categories: result.categories,
    scores: result.category_scores,
    blockedCategories,
  };
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
  if (!port.bypassCache) {
    const lookup = cache.get<ModerationResult>(key).catch(() => null);
    const cached = await (signal ? abortable(lookup, signal) : lookup);
    if (cached) return cached;
  }

  const response = await port.fetch(MODERATION_API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: moderationRequestBody(truncated, model),
    signal,
  });
  if (!response.ok) {
    const status = response.status;
    await response.body?.cancel();
    throw new Error(`Moderation provider returned HTTP ${status}`);
  }
  const data: unknown = await response.json();
  const moderation = interpretModerationResponse(data);
  await logUsage({
    service: 'openai',
    model,
    category: 'moderation',
    totalCost: 0,
    metadata: { inputChars: truncated.length },
  });
  signal?.throwIfAborted();
  if (!port.bypassCache) await cache.set(key, moderation, CACHE_TTL_SECONDS);
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
