import { createHash } from 'crypto';
import { cache } from './redis';
import { logUsage } from './usage-logger';
import { logger } from './logger';

const OPENAI_MODERATION_KEY = process.env.OPENAI_MODERATION_KEY;
const MODERATION_API_URL = 'https://api.openai.com/v1/moderations';
const MODERATION_MODEL = process.env.OPENAI_MODERATION_MODEL || 'omni-moderation-latest';
const MODERATION_TIMEOUT_MS = 3000;
const CACHE_TTL_SECONDS = 600; // 10 minutes
const MAX_INPUT_LENGTH = 32000; // API limit ~32K chars

/**
 * Per-category score thresholds. Lower = stricter.
 * sexual/minors is extremely strict (0.1); violence is permissive (0.7)
 * since documentary/educational content legitimately discusses it.
 */
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

export class ContentModerationError extends Error {
  readonly categories: string[];

  constructor(categories: string[]) {
    super(`Content flagged for: ${categories.join(', ')}`);
    this.name = 'ContentModerationError';
    this.categories = categories;
  }
}

function cacheKey(text: string): string {
  return `mod:${createHash('sha256').update(text).digest('hex').slice(0, 16)}`;
}

/**
 * Run content through the OpenAI Moderation API.
 * Returns detailed results with per-category flags and scores.
 *
 * Fail-open: if the API is unavailable or times out, logs a warning and
 * returns an unflagged result so the platform doesn't go down.
 */
export async function moderateContent(text: string): Promise<ModerationResult> {
  if (!OPENAI_MODERATION_KEY) {
    logger.warn('OPENAI_MODERATION_KEY not set — skipping moderation');
    return { flagged: false, categories: {}, scores: {}, blockedCategories: [] };
  }

  const truncated = text.slice(0, MAX_INPUT_LENGTH);
  const key = cacheKey(truncated);

  // Check cache
  const cached = await cache.get<ModerationResult>(key).catch(() => null);
  if (cached) return cached;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), MODERATION_TIMEOUT_MS);

    const response = await fetch(MODERATION_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${OPENAI_MODERATION_KEY}`,
      },
      body: JSON.stringify({ model: MODERATION_MODEL, input: truncated }),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!response.ok) {
      logger.warn('Moderation API returned non-OK', { status: String(response.status) });
      return { flagged: false, categories: {}, scores: {}, blockedCategories: [] };
    }

    const data = (await response.json()) as {
      results: Array<{
        flagged: boolean;
        categories: Record<string, boolean>;
        category_scores: Record<string, number>;
      }>;
    };

    const result = data.results[0];
    if (!result) {
      return { flagged: false, categories: {}, scores: {}, blockedCategories: [] };
    }

    // Apply custom thresholds instead of trusting the API's binary flags
    const blockedCategories: string[] = [];
    for (const [category, score] of Object.entries(result.category_scores)) {
      const threshold = CATEGORY_THRESHOLDS[category] ?? 0.5;
      if (score >= threshold) {
        blockedCategories.push(category);
      }
    }

    const moderationResult: ModerationResult = {
      flagged: blockedCategories.length > 0,
      categories: result.categories,
      scores: result.category_scores,
      blockedCategories,
    };

    logUsage({
      service: 'openai',
      model: MODERATION_MODEL,
      category: 'moderation',
      totalCost: 0,
      metadata: { inputChars: truncated.length },
    });

    // Cache result
    await cache.set(key, moderationResult, CACHE_TTL_SECONDS).catch(() => {});

    return moderationResult;
  } catch (err) {
    // Fail-open: log and allow through
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('abort')) {
      logger.warn('Moderation API timed out — allowing through');
    } else {
      logger.warn('Moderation API error — allowing through', { error: msg });
    }
    return { flagged: false, categories: {}, scores: {}, blockedCategories: [] };
  }
}

/**
 * Screen content and throw ContentModerationError if flagged.
 * Use this as a hard gate on user input before LLM calls.
 */
export async function moderateOrThrow(text: string): Promise<void> {
  const result = await moderateContent(text);
  if (result.flagged) {
    throw new ContentModerationError(result.blockedCategories);
  }
}
