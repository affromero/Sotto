import { logger } from './logger';
import type { TwitterTweet, TwitterMedia, TwitterMentionsResult, ThreadTweet, ThreadData } from '@/types/twitter';

function getEnv(key: string): string | undefined {
  return process.env[key];
}

const TWITTER_API_BASE = 'https://api.twitter.com/2';

if (!getEnv('TWITTER_BEARER_TOKEN')) {
  logger.warn('TWITTER_BEARER_TOKEN is not set — Twitter integration will not work');
}

interface RateLimitInfo {
  remaining: number;
  resetAt: number;
}

let mentionsRateLimit: RateLimitInfo = { remaining: 100, resetAt: 0 };
let tweetsRateLimit: RateLimitInfo = { remaining: 100, resetAt: 0 };
let searchRateLimit: RateLimitInfo = { remaining: 100, resetAt: 0 };

const THREAD_TWEET_LIMIT = 50;
const QUOTED_TWEET_FETCH_LIMIT = 5;

function updateRateLimit(headers: Headers, target: 'mentions' | 'tweets' | 'search'): void {
  const remaining = headers.get('x-rate-limit-remaining');
  const reset = headers.get('x-rate-limit-reset');

  if (remaining !== null && reset !== null) {
    const info: RateLimitInfo = {
      remaining: parseInt(remaining, 10),
      resetAt: parseInt(reset, 10) * 1000,
    };

    if (target === 'mentions') {
      mentionsRateLimit = info;
    } else if (target === 'tweets') {
      tweetsRateLimit = info;
    } else {
      searchRateLimit = info;
    }

    if (info.remaining < 5) {
      logger.warn(`Twitter ${target} rate limit low`, {
        remaining: String(info.remaining),
        resetAt: new Date(info.resetAt).toISOString(),
      });
    }
  }
}

function canMakeRequest(target: 'mentions' | 'tweets' | 'search'): boolean {
  const rateLimits = { mentions: mentionsRateLimit, tweets: tweetsRateLimit, search: searchRateLimit };
  const info = rateLimits[target];
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
  const apiKey = getEnv('TWITTER_API_KEY');
  const apiSecret = getEnv('TWITTER_API_SECRET');
  const accessToken = getEnv('TWITTER_ACCESS_TOKEN');
  const accessSecret = getEnv('TWITTER_ACCESS_SECRET');

  if (!apiKey || !apiSecret || !accessToken || !accessSecret) {
    throw new Error('Twitter OAuth 1.0a credentials not configured');
  }

  const crypto = await import('crypto');
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const nonce = crypto.randomBytes(16).toString('hex');

  const oauthParams: Record<string, string> = {
    oauth_consumer_key: apiKey,
    oauth_nonce: nonce,
    oauth_signature_method: 'HMAC-SHA1',
    oauth_timestamp: timestamp,
    oauth_token: accessToken,
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

  const signingKey = `${encodeURIComponent(apiSecret)}&${encodeURIComponent(accessSecret)}`;
  const signature = crypto.createHmac('sha1', signingKey).update(baseString).digest('base64');

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
export async function getMentions(sinceId?: string): Promise<TwitterMentionsResult> {
  const bearerToken = getEnv('TWITTER_BEARER_TOKEN');
  const userId = getEnv('TWITTER_SOTTO_USER_ID');

  if (!bearerToken || !userId) {
    throw new Error(
      'Twitter credentials not configured — set TWITTER_BEARER_TOKEN and TWITTER_SOTTO_USER_ID'
    );
  }

  if (!canMakeRequest('mentions')) {
    return { tweets: [], mediaByKey: new Map() };
  }

  const params = new URLSearchParams({
    'tweet.fields': 'author_id,created_at,in_reply_to_user_id,referenced_tweets,conversation_id,entities,public_metrics,attachments',
    expansions: 'attachments.media_keys',
    'media.fields': 'type,variants,duration_ms,preview_image_url,alt_text',
    max_results: '100',
  });

  if (sinceId) {
    params.set('since_id', sinceId);
  }

  const url = `${TWITTER_API_BASE}/users/${userId}/mentions?${params}`;
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${bearerToken}` },
  });

  updateRateLimit(response.headers, 'mentions');

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Twitter API error (${response.status}): ${errorText}`);
  }

  const data = await response.json();

  if (!data.data) {
    return { tweets: [], mediaByKey: new Map() };
  }

  const mediaByKey = parseMediaIncludes(data.includes);

  logger.info('Fetched Twitter mentions', {
    count: String(data.data.length),
    mediaKeys: String(mediaByKey.size),
  });
  return { tweets: data.data as TwitterTweet[], mediaByKey };
}

/**
 * Fetch a single tweet by ID (e.g. parent tweet for reply context).
 */
export async function getTweet(tweetId: string): Promise<{ tweet: TwitterTweet; mediaByKey: Map<string, TwitterMedia> } | null> {
  const bearerToken = getEnv('TWITTER_BEARER_TOKEN');

  if (!bearerToken) {
    throw new Error('Twitter credentials not configured — set TWITTER_BEARER_TOKEN');
  }

  if (!canMakeRequest('tweets')) {
    return null;
  }

  const params = new URLSearchParams({
    'tweet.fields': 'author_id,created_at,in_reply_to_user_id,referenced_tweets,conversation_id,entities,public_metrics,attachments',
    expansions: 'attachments.media_keys',
    'media.fields': 'type,variants,duration_ms,preview_image_url,alt_text',
  });

  const url = `${TWITTER_API_BASE}/tweets/${tweetId}?${params}`;
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${bearerToken}` },
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
  const tweet = (data.data as TwitterTweet) ?? null;
  if (!tweet) return null;

  const mediaByKey = parseMediaIncludes(data.includes);
  return { tweet, mediaByKey };
}

/**
 * Parse media includes from a Twitter API v2 response into a lookup map.
 */
function parseMediaIncludes(includes?: { media?: TwitterMedia[] }): Map<string, TwitterMedia> {
  const map = new Map<string, TwitterMedia>();
  if (includes?.media) {
    for (const media of includes.media) {
      map.set(media.media_key, media);
    }
  }
  return map;
}

/**
 * Fetch the full conversation thread for a given conversation_id.
 * Uses Twitter API v2 GET /2/tweets/search/recent (requires Basic tier).
 * Returns null if rate-limited or no results found.
 */
export async function getThread(conversationId: string): Promise<ThreadData | null> {
  const bearerToken = getEnv('TWITTER_BEARER_TOKEN');

  if (!bearerToken) {
    throw new Error('Twitter credentials not configured — set TWITTER_BEARER_TOKEN');
  }

  if (!canMakeRequest('search')) {
    return null;
  }

  // Fetch root tweet separately (search results exclude it)
  const rootParams = new URLSearchParams({
    'tweet.fields': 'author_id,conversation_id,created_at,in_reply_to_user_id,referenced_tweets,entities,public_metrics',
    expansions: 'author_id',
    'user.fields': 'username,name,verified,verified_type,description',
  });

  const rootUrl = `${TWITTER_API_BASE}/tweets/${conversationId}?${rootParams}`;
  const rootResponse = await fetch(rootUrl, {
    headers: { Authorization: `Bearer ${bearerToken}` },
  });

  updateRateLimit(rootResponse.headers, 'tweets');

  if (!rootResponse.ok) {
    if (rootResponse.status === 404) return null;
    const errorText = await rootResponse.text();
    throw new Error(`Twitter API error (${rootResponse.status}): ${errorText}`);
  }

  const rootData = await rootResponse.json();
  if (!rootData.data) return null;

  const rawRootTweet = rootData.data as TwitterTweet;
  const userMap = new Map<string, { username: string; name: string; verified?: boolean; verifiedType?: string; description?: string }>();

  // Collect user info from root tweet includes
  if (rootData.includes?.users) {
    for (const user of rootData.includes.users) {
      userMap.set(user.id, { username: user.username, name: user.name, verified: user.verified, verifiedType: user.verified_type, description: user.description });
    }
  }

  // Search for all replies in the conversation (paginated)
  const allReplies: TwitterTweet[] = [];
  let nextToken: string | undefined;

  do {
    if (!canMakeRequest('search')) break;

    const searchParams = new URLSearchParams({
      query: `conversation_id:${conversationId}`,
      'tweet.fields': 'author_id,conversation_id,created_at,in_reply_to_user_id,referenced_tweets,entities,public_metrics',
      expansions: 'author_id',
      'user.fields': 'username,name,verified,verified_type,description',
      max_results: '100',
    });

    if (nextToken) {
      searchParams.set('next_token', nextToken);
    }

    const searchUrl = `${TWITTER_API_BASE}/tweets/search/recent?${searchParams}`;
    const searchResponse = await fetch(searchUrl, {
      headers: { Authorization: `Bearer ${bearerToken}` },
    });

    updateRateLimit(searchResponse.headers, 'search');

    if (!searchResponse.ok) {
      // If rate-limited mid-fetch, return what we have so far
      if (searchResponse.status === 429) break;
      const errorText = await searchResponse.text();
      throw new Error(`Twitter search API error (${searchResponse.status}): ${errorText}`);
    }

    const searchData = await searchResponse.json();

    // Accumulate user info across pages
    if (searchData.includes?.users) {
      for (const user of searchData.includes.users) {
        userMap.set(user.id, { username: user.username, name: user.name, verified: user.verified, verifiedType: user.verified_type, description: user.description });
      }
    }

    if (searchData.data) {
      allReplies.push(...(searchData.data as TwitterTweet[]));
    }

    nextToken = searchData.meta?.next_token;
  } while (nextToken && allReplies.length < THREAD_TWEET_LIMIT);

  // Cap at THREAD_TWEET_LIMIT
  const cappedReplies = allReplies.slice(0, THREAD_TWEET_LIMIT);

  // Fetch quoted tweets referenced in the thread
  const quotedTweetIds = new Set<string>();
  const allTweets = [rawRootTweet, ...cappedReplies];
  for (const tweet of allTweets) {
    if (tweet.referenced_tweets) {
      for (const ref of tweet.referenced_tweets) {
        if (ref.type === 'quoted' && !allTweets.some((t) => t.id === ref.id)) {
          quotedTweetIds.add(ref.id);
        }
      }
    }
  }

  const quotedTweets: TwitterTweet[] = [];
  let quotedFetchCount = 0;
  for (const quotedId of quotedTweetIds) {
    if (quotedFetchCount >= QUOTED_TWEET_FETCH_LIMIT) break;
    const quotedResult = await getTweet(quotedId);
    if (quotedResult) {
      quotedTweets.push(quotedResult.tweet);
    }
    quotedFetchCount++;
  }

  // Convert to ThreadTweet objects
  const toThreadTweet = (tweet: TwitterTweet): ThreadTweet => {
    const author = userMap.get(tweet.author_id);
    const repliedTo = tweet.referenced_tweets?.find((r) => r.type === 'replied_to');
    const pm = tweet.public_metrics;
    return {
      id: tweet.id,
      text: tweet.text,
      authorId: tweet.author_id,
      authorUsername: author?.username ?? 'unknown',
      authorName: author?.name ?? 'Unknown',
      urls: tweet.entities?.urls?.map((u) => u.expanded_url) ?? [],
      createdAt: tweet.created_at,
      inReplyToTweetId: repliedTo?.id,
      ...(pm && {
        publicMetrics: {
          likeCount: pm.like_count,
          retweetCount: pm.retweet_count,
          replyCount: pm.reply_count,
          quoteCount: pm.quote_count,
        },
      }),
      ...(author?.verified !== undefined && { authorVerified: author.verified }),
      ...(author?.verifiedType && { authorVerifiedType: author.verifiedType }),
      ...(author?.description && { authorBio: author.description }),
    };
  };

  const rootThreadTweet = toThreadTweet(rawRootTweet);

  // Build replies: thread replies + quoted tweets, sorted chronologically
  const replyThreadTweets = [...cappedReplies, ...quotedTweets]
    .map(toThreadTweet)
    .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

  // Count unique participants
  const participantIds = new Set([rootThreadTweet.authorId, ...replyThreadTweets.map((r) => r.authorId)]);

  // Determine if thread is self-authored (all replies, or all but 1, are from root author)
  const rootAuthorId = rootThreadTweet.authorId;
  const otherAuthorReplies = replyThreadTweets.filter((r) => r.authorId !== rootAuthorId);
  const isSelfAuthored = otherAuthorReplies.length <= 1;

  logger.info('Fetched thread', {
    conversationId,
    tweetCount: String(1 + replyThreadTweets.length),
    participantCount: String(participantIds.size),
    isSelfAuthored: String(isSelfAuthored),
  });

  return {
    rootTweet: rootThreadTweet,
    replies: replyThreadTweets,
    participantCount: participantIds.size,
    tweetCount: 1 + replyThreadTweets.length,
    isSelfAuthored,
  };
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

/**
 * Post a new tweet from the @sottofm bot account.
 * Uses OAuth 1.0a for user-context write operations.
 */
export async function postTweet(text: string): Promise<string> {
  const url = `${TWITTER_API_BASE}/tweets`;
  const body = JSON.stringify({ text });

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
    throw new Error(`Twitter post API error (${response.status}): ${errorText}`);
  }

  const data = await response.json();
  const tweetId = data.data?.id as string;
  logger.info('Posted tweet', { tweetId });
  return tweetId;
}

/**
 * Search for popular recent tweets matching a query.
 * Uses Twitter API v2 GET /2/tweets/search/recent with relevancy sorting.
 */
export async function searchPopularTweets(
  query: string,
  maxResults: number = 10
): Promise<TwitterTweet[]> {
  const bearerToken = getEnv('TWITTER_BEARER_TOKEN');

  if (!bearerToken) {
    throw new Error('Twitter credentials not configured — set TWITTER_BEARER_TOKEN');
  }

  if (!canMakeRequest('search')) {
    return [];
  }

  const params = new URLSearchParams({
    query,
    sort_order: 'relevancy',
    'tweet.fields': 'public_metrics,created_at,author_id,conversation_id',
    max_results: String(Math.min(Math.max(maxResults, 10), 100)),
  });

  const url = `${TWITTER_API_BASE}/tweets/search/recent?${params}`;
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${bearerToken}` },
  });

  updateRateLimit(response.headers, 'search');

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Twitter search API error (${response.status}): ${errorText}`);
  }

  const data = await response.json();

  if (!data.data) {
    return [];
  }

  logger.info('Searched popular tweets', { query, count: String(data.data.length) });
  return data.data as TwitterTweet[];
}

export function isTwitterConfigured(): boolean {
  return !!(getEnv('TWITTER_BEARER_TOKEN') && getEnv('TWITTER_SOTTO_USER_ID'));
}

/** @internal Reset rate limit state — for testing only */
export function _resetRateLimits(): void {
  mentionsRateLimit = { remaining: 100, resetAt: 0 };
  tweetsRateLimit = { remaining: 100, resetAt: 0 };
  searchRateLimit = { remaining: 100, resetAt: 0 };
}
