import { getRedisClient } from './redis';
import { loadPrompt } from './prompt-loader';
import { resolveAutoModel } from './auto-model-config';
import { createAIProvider } from './providers/ai';
import { logUsage } from './usage-logger';
import { logger } from './logger';
import { isRetweet } from './twitter-utils';
import type { TwitterTweet, TwitterAuthorData } from '@/types/twitter';

const SOTTO_HANDLE_RE = /@sottofm/gi;
const REDIS_RATE_PREFIX = 'twitter:mention_rate:';
const RATE_LIMIT_MAX = 5;
const RATE_LIMIT_WINDOW_S = 3600; // 1 hour

export type FilterVerdict = 'pass' | 'skip_retweet' | 'skip_empty' | 'skip_rate_limit' | 'skip_suspicious_account' | 'skip_spam' | 'skip_garbage' | 'skip_abuse';

export interface MentionFilterResult {
  verdict: FilterVerdict;
  reason: string;
}

/**
 * Three-layer spam gate for Twitter mentions.
 *
 * Layer 1 — Structural (free, no API calls):
 *   - Skip retweets
 *   - Skip empty mentions (just "@sottofm" with no content, no parent tweet, no images)
 *
 * Layer 2 — Rate limit (Redis):
 *   - Max 5 mentions per author per hour (prevents bot floods)
 *
 * Layer 3 — Account quality (Twitter API data):
 *   - Flag brand-new accounts (<7 days) with no followers and no tweets
 *
 * Layer 4 — LLM intent classification (platform model):
 *   - Quick classify: genuine / spam / garbage / abuse
 *   - Only runs if layers 1-3 pass
 */
export async function filterMention(
  tweet: TwitterTweet,
  author: TwitterAuthorData | undefined,
  hasParentTweet: boolean,
  hasImages: boolean,
): Promise<MentionFilterResult> {
  // Layer 1: Structural filters
  if (isRetweet(tweet)) {
    return { verdict: 'skip_retweet', reason: 'Retweet — not a direct mention' };
  }

  const stripped = tweet.text.replace(SOTTO_HANDLE_RE, '').trim();
  if (stripped.length === 0 && !hasParentTweet && !hasImages) {
    return { verdict: 'skip_empty', reason: 'Empty mention — no topic, no parent tweet, no images' };
  }

  // Layer 2: Per-author rate limit
  const rateLimitResult = await checkAuthorRateLimit(tweet.author_id);
  if (!rateLimitResult.allowed) {
    return { verdict: 'skip_rate_limit', reason: `Rate limited — ${rateLimitResult.count} mentions in the last hour (max ${RATE_LIMIT_MAX})` };
  }

  // Layer 3: Account quality (only for unlinked or suspicious accounts)
  if (author) {
    const suspiciousResult = checkAccountQuality(author);
    if (suspiciousResult) {
      return suspiciousResult;
    }
  }

  // Layer 4: LLM intent classification
  const llmResult = await classifyMentionIntent(tweet, hasParentTweet);
  if (llmResult.verdict !== 'pass') {
    return llmResult;
  }

  // Passed all layers — increment rate counter
  await incrementAuthorRate(tweet.author_id);

  return { verdict: 'pass', reason: 'Passed all filters' };
}

async function checkAuthorRateLimit(authorId: string): Promise<{ allowed: boolean; count: number }> {
  const redis = getRedisClient();
  const key = `${REDIS_RATE_PREFIX}${authorId}`;
  const count = await redis.get(key);
  const current = count ? parseInt(count, 10) : 0;
  return { allowed: current < RATE_LIMIT_MAX, count: current };
}

async function incrementAuthorRate(authorId: string): Promise<void> {
  const redis = getRedisClient();
  const key = `${REDIS_RATE_PREFIX}${authorId}`;
  const pipeline = redis.multi();
  pipeline.incr(key);
  pipeline.expire(key, RATE_LIMIT_WINDOW_S);
  await pipeline.exec();
}

const ACCOUNT_MIN_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const ACCOUNT_MIN_FOLLOWERS = 1;
const ACCOUNT_MIN_TWEETS = 3;

function checkAccountQuality(author: TwitterAuthorData): MentionFilterResult | null {
  if (!author.createdAt || !author.publicMetrics) return null;

  const accountAge = Date.now() - new Date(author.createdAt).getTime();
  const { followers_count, tweet_count } = author.publicMetrics;

  // Brand-new account with no social proof — likely a bot
  if (
    accountAge < ACCOUNT_MIN_AGE_MS &&
    followers_count < ACCOUNT_MIN_FOLLOWERS &&
    tweet_count < ACCOUNT_MIN_TWEETS
  ) {
    return {
      verdict: 'skip_suspicious_account',
      reason: `Suspicious account — created ${Math.floor(accountAge / (24 * 60 * 60 * 1000))}d ago, ${followers_count} followers, ${tweet_count} tweets`,
    };
  }

  return null;
}

const FILTER_SYSTEM_PROMPT = loadPrompt('social/mention-filter.md');

async function classifyMentionIntent(
  tweet: TwitterTweet,
  hasParentTweet: boolean,
): Promise<MentionFilterResult> {
  try {
    const { aiProvider, aiModel } = await resolveAutoModel('PLATFORM');
    const provider = createAIProvider(aiProvider);

    let userMessage = `Tweet: "${tweet.text}"`;
    if (hasParentTweet) {
      userMessage += '\n\n(This tweet is a reply to another tweet — the user likely wants a podcast about that content.)';
    }

    const response = await provider.generateResponse(
      FILTER_SYSTEM_PROMPT,
      [{ role: 'user', content: userMessage }],
      { maxTokens: 128, model: aiModel }
    );

    logUsage({
      service: aiProvider,
      model: response.model,
      category: 'mention_filter',
      inputTokens: response.inputTokens,
      outputTokens: response.outputTokens,
    });

    const cleaned = response.content
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```$/i, '')
      .trim();
    const parsed = JSON.parse(cleaned) as {
      classification: 'genuine' | 'spam' | 'garbage' | 'abuse';
      confidence: number;
      reason: string;
    };

    logger.info('Mention intent classified', {
      tweetId: tweet.id,
      classification: parsed.classification,
      confidence: String(parsed.confidence),
      reason: parsed.reason,
    });

    if (parsed.classification === 'genuine') {
      return { verdict: 'pass', reason: parsed.reason };
    }

    // Low confidence non-genuine → let it through (false positive > false negative)
    if (parsed.confidence < 0.7) {
      logger.info('Low-confidence non-genuine classification — letting through', {
        tweetId: tweet.id,
        classification: parsed.classification,
        confidence: String(parsed.confidence),
      });
      return { verdict: 'pass', reason: `Low-confidence ${parsed.classification} — allowing` };
    }

    const verdictMap: Record<string, FilterVerdict> = {
      spam: 'skip_spam',
      garbage: 'skip_garbage',
      abuse: 'skip_abuse',
    };

    return {
      verdict: verdictMap[parsed.classification] ?? 'skip_spam',
      reason: parsed.reason,
    };
  } catch (err) {
    // LLM failure should not block processing — let the mention through
    logger.warn('Mention filter LLM call failed — allowing mention', {
      tweetId: tweet.id,
      error: err instanceof Error ? err.message : String(err),
    });
    return { verdict: 'pass', reason: 'Filter error — allowing by default' };
  }
}
