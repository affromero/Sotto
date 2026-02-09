import { logger } from './logger';
import type { TwitterTweet } from '@/types/twitter';

const TWITTER_BEARER_TOKEN = process.env.TWITTER_BEARER_TOKEN;
const TWITTER_API_KEY = process.env.TWITTER_API_KEY;
const TWITTER_API_SECRET = process.env.TWITTER_API_SECRET;
const TWITTER_ACCESS_TOKEN = process.env.TWITTER_ACCESS_TOKEN;
const TWITTER_ACCESS_SECRET = process.env.TWITTER_ACCESS_SECRET;
const TWITTER_SOTTO_USER_ID = process.env.TWITTER_SOTTO_USER_ID;

const TWITTER_API_BASE = 'https://api.twitter.com/2';

if (!TWITTER_BEARER_TOKEN) {
  logger.warn('TWITTER_BEARER_TOKEN is not set — Twitter integration will not work');
}

interface RateLimitInfo {
  remaining: number;
  resetAt: number;
}

let mentionsRateLimit: RateLimitInfo = { remaining: 100, resetAt: 0 };
let tweetsRateLimit: RateLimitInfo = { remaining: 100, resetAt: 0 };

function updateRateLimit(headers: Headers, target: 'mentions' | 'tweets'): void {
  const remaining = headers.get('x-rate-limit-remaining');
  const reset = headers.get('x-rate-limit-reset');

  if (remaining !== null && reset !== null) {
    const info: RateLimitInfo = {
      remaining: parseInt(remaining, 10),
      resetAt: parseInt(reset, 10) * 1000,
    };

    if (target === 'mentions') {
      mentionsRateLimit = info;
    } else {
      tweetsRateLimit = info;
    }

    if (info.remaining < 5) {
      logger.warn(`Twitter ${target} rate limit low`, {
        remaining: String(info.remaining),
        resetAt: new Date(info.resetAt).toISOString(),
      });
    }
  }
}

function canMakeRequest(target: 'mentions' | 'tweets'): boolean {
  const info = target === 'mentions' ? mentionsRateLimit : tweetsRateLimit;
  if (info.remaining <= 0 && Date.now() < info.resetAt) {
    logger.warn(`Twitter ${target} rate limited, waiting until reset`, {
      resetAt: new Date(info.resetAt).toISOString(),
    });
    return false;
  }
  return true;
}

/**
 * Generate OAuth 1.0a signature for user-context API calls (posting tweets).
 * Uses HMAC-SHA1 per the Twitter OAuth 1.0a spec.
 */
async function generateOAuthHeader(
  method: string,
  url: string,
  params: Record<string, string> = {}
): Promise<string> {
  if (!TWITTER_API_KEY || !TWITTER_API_SECRET || !TWITTER_ACCESS_TOKEN || !TWITTER_ACCESS_SECRET) {
    throw new Error('Twitter OAuth 1.0a credentials not configured');
  }

  const crypto = await import('crypto');
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const nonce = crypto.randomBytes(16).toString('hex');

  const oauthParams: Record<string, string> = {
    oauth_consumer_key: TWITTER_API_KEY,
    oauth_nonce: nonce,
    oauth_signature_method: 'HMAC-SHA1',
    oauth_timestamp: timestamp,
    oauth_token: TWITTER_ACCESS_TOKEN,
    oauth_version: '1.0',
  };

  const allParams = { ...oauthParams, ...params };
  const sortedKeys = Object.keys(allParams).sort();
  const paramString = sortedKeys
    .map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(allParams[k])}`)
    .join('&');

  const baseString = [
    method.toUpperCase(),
    encodeURIComponent(url),
    encodeURIComponent(paramString),
  ].join('&');

  const signingKey = `${encodeURIComponent(TWITTER_API_SECRET)}&${encodeURIComponent(TWITTER_ACCESS_SECRET)}`;
  const signature = crypto
    .createHmac('sha1', signingKey)
    .update(baseString)
    .digest('base64');

  oauthParams['oauth_signature'] = signature;

  const headerParts = Object.keys(oauthParams)
    .sort()
    .map((k) => `${encodeURIComponent(k)}="${encodeURIComponent(oauthParams[k])}"`)
    .join(', ');

  return `OAuth ${headerParts}`;
}

/**
 * Fetch recent mentions of the @sottofm bot account.
 * Uses Twitter API v2 GET /2/users/:id/mentions
 */
export async function getMentions(sinceId?: string): Promise<TwitterTweet[]> {
  if (!TWITTER_BEARER_TOKEN || !TWITTER_SOTTO_USER_ID) {
    throw new Error('Twitter credentials not configured — set TWITTER_BEARER_TOKEN and TWITTER_SOTTO_USER_ID');
  }

  if (!canMakeRequest('mentions')) {
    return [];
  }

  const params = new URLSearchParams({
    'tweet.fields': 'author_id,created_at,in_reply_to_user_id,referenced_tweets',
    max_results: '100',
  });

  if (sinceId) {
    params.set('since_id', sinceId);
  }

  const url = `${TWITTER_API_BASE}/users/${TWITTER_SOTTO_USER_ID}/mentions?${params}`;
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${TWITTER_BEARER_TOKEN}` },
  });

  updateRateLimit(response.headers, 'mentions');

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Twitter API error (${response.status}): ${errorText}`);
  }

  const data = await response.json();

  if (!data.data) {
    return [];
  }

  logger.info('Fetched Twitter mentions', { count: String(data.data.length) });
  return data.data as TwitterTweet[];
}

/**
 * Fetch a single tweet by ID (e.g. parent tweet for reply context).
 */
export async function getTweet(tweetId: string): Promise<TwitterTweet | null> {
  if (!TWITTER_BEARER_TOKEN) {
    throw new Error('Twitter credentials not configured — set TWITTER_BEARER_TOKEN');
  }

  if (!canMakeRequest('tweets')) {
    return null;
  }

  const params = new URLSearchParams({
    'tweet.fields': 'author_id,created_at,in_reply_to_user_id,referenced_tweets',
  });

  const url = `${TWITTER_API_BASE}/tweets/${tweetId}?${params}`;
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${TWITTER_BEARER_TOKEN}` },
  });

  updateRateLimit(response.headers, 'tweets');

  if (!response.ok) {
    if (response.status === 404) {
      return null;
    }
    const errorText = await response.text();
    throw new Error(`Twitter API error (${response.status}): ${errorText}`);
  }

  const data = await response.json();
  return (data.data as TwitterTweet) ?? null;
}

/**
 * Reply to a tweet using the @sottofm bot account.
 * Uses OAuth 1.0a for user-context write operations.
 */
export async function replyToTweet(tweetId: string, text: string): Promise<string> {
  const url = `${TWITTER_API_BASE}/tweets`;
  const body = JSON.stringify({
    text,
    reply: { in_reply_to_tweet_id: tweetId },
  });

  const authHeader = await generateOAuthHeader('POST', url);

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: authHeader,
      'Content-Type': 'application/json',
    },
    body,
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Twitter reply API error (${response.status}): ${errorText}`);
  }

  const data = await response.json();
  const replyId = data.data?.id as string;
  logger.info('Replied to tweet', { originalTweetId: tweetId, replyTweetId: replyId });
  return replyId;
}

export function isTwitterConfigured(): boolean {
  return !!(TWITTER_BEARER_TOKEN && TWITTER_SOTTO_USER_ID);
}
