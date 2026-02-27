import type { ThreadData, TweetParseResult, TwitterTweet } from '@/types/twitter';
import type { ParticipantCredential, ParticipantInput } from './credential-lookup';

const POPULAR_LIKE_THRESHOLD = 10;

/**
 * Engagement score: likes + (retweets × 2) + replies.
 * Shared between trends API route and trend poll worker.
 */
export function engagementScore(tweet: TwitterTweet): number {
  const m = tweet.public_metrics;
  if (!m) return 0;
  return m.like_count + m.retweet_count * 2 + m.reply_count;
}

/**
 * Check if a tweet is a retweet — structurally via referenced_tweets
 * or by text prefix "RT @" as fallback.
 */
export function isRetweet(tweet: TwitterTweet): boolean {
  if (tweet.referenced_tweets?.some((r) => r.type === 'retweeted')) return true;
  if (tweet.text.startsWith('RT @')) return true;
  return false;
}

/**
 * Check if the search query keywords actually appear in the tweet text,
 * not just in the author's name/bio. Twitter's search API matches against
 * author metadata too, which causes irrelevant results.
 */
export function tweetMatchesQuery(tweet: TwitterTweet, query: string): boolean {
  const textLower = tweet.text.toLowerCase();
  // Strip Twitter search operators (e.g. "-is:retweet") — only check content words
  const keywords = query
    .split(/\s+/)
    .filter((w) => !w.startsWith('-') && !w.includes(':'))
    .map((w) => w.toLowerCase().replace(/^"|"$/g, ''));
  return keywords.some((kw) => textLower.includes(kw));
}

/**
 * Filter tweets to quality standards for trend display/generation.
 * - Excludes retweets (structural + text fallback)
 * - Requires at least 1 like (pure RT engagement = spam)
 * - Requires search keyword in tweet text (not just author name)
 * - Optionally enforces minimum engagement score
 */
export function filterQualityTweets(
  tweets: TwitterTweet[],
  query: string,
  minEngagement = 0
): TwitterTweet[] {
  return tweets.filter((tweet) => {
    if (isRetweet(tweet)) return false;
    if (!tweet.public_metrics || tweet.public_metrics.like_count < 1) return false;
    if (!tweetMatchesQuery(tweet, query)) return false;
    if (minEngagement > 0 && engagementScore(tweet) < minEngagement) return false;
    return true;
  });
}
const TOP_REPLIES_COUNT = 5;

/**
 * Extract verified participants from a thread for credential lookup.
 */
export function getVerifiedParticipants(thread: ThreadData): ParticipantInput[] {
  const seen = new Set<string>();
  const participants: ParticipantInput[] = [];

  const allTweets = [thread.rootTweet, ...thread.replies];
  for (const tweet of allTweets) {
    if (seen.has(tweet.authorUsername)) continue;
    if (!tweet.authorVerified) continue;
    seen.add(tweet.authorUsername);
    participants.push({
      authorUsername: tweet.authorUsername,
      authorName: tweet.authorName,
      authorBio: tweet.authorBio,
      authorVerifiedType: tweet.authorVerifiedType,
    });
  }

  return participants;
}

/**
 * Format a thread as source text for the podcast generation pipeline.
 * Handles self-authored threads (narrative) vs multi-participant (discussion).
 * Includes engagement metrics and verified participant credentials.
 */
export function formatThreadAsSourceText(
  thread: ThreadData,
  parsed: TweetParseResult,
  credentials?: ParticipantCredential[]
): string {
  const sections: string[] = [];
  const credentialMap = new Map(
    (credentials ?? []).map((c) => [c.username.toLowerCase(), c])
  );

  sections.push('## Twitter/X Thread Discussion');
  sections.push('');

  // Credentials section
  if (credentialMap.size > 0) {
    sections.push('### Participant Credentials:');
    for (const cred of credentialMap.values()) {
      sections.push(`- [VERIFIED] **@${cred.username}** — ${cred.credentials} (source: ${cred.source})`);
    }
    sections.push('');
  }

  if (parsed.viewpoints && parsed.viewpoints.length > 0) {
    sections.push('### Viewpoints Identified:');
    for (const viewpoint of parsed.viewpoints) {
      sections.push(`- ${viewpoint}`);
    }
    sections.push('');
  }

  if (thread.isSelfAuthored) {
    sections.push(...formatSelfAuthored(thread, credentialMap));
  } else {
    sections.push(...formatMultiParticipant(thread, credentialMap));
  }

  return sections.join('\n');
}

function formatSelfAuthored(
  thread: ThreadData,
  credentialMap: Map<string, ParticipantCredential>
): string[] {
  const sections: string[] = [];
  const rootAuthor = thread.rootTweet.authorUsername;
  const rootCred = credentialMap.get(rootAuthor.toLowerCase());

  sections.push('### Thread Conversation:');

  if (rootCred) {
    sections.push(`**Thread by @${rootAuthor} — ${rootCred.credentials} (${rootCred.source})**`);
  } else {
    sections.push(`**Thread by @${rootAuthor}:**`);
  }

  sections.push(thread.rootTweet.text);

  for (const reply of thread.replies) {
    if (reply.authorId === thread.rootTweet.authorId) {
      // Continuation tweet — no redundant author label
      sections.push(reply.text);
    } else {
      // External reply
      const cred = credentialMap.get(reply.authorUsername.toLowerCase());
      if (cred) {
        sections.push(`**@${reply.authorUsername} (${cred.credentials}):** ${reply.text}`);
      } else {
        sections.push(`**@${reply.authorUsername}:** ${reply.text}`);
      }
    }
  }

  return sections;
}

function formatMultiParticipant(
  thread: ThreadData,
  credentialMap: Map<string, ParticipantCredential>
): string[] {
  const sections: string[] = [];

  sections.push('### Thread Conversation:');

  const formatTweet = (username: string, text: string, likes?: number): string => {
    const cred = credentialMap.get(username.toLowerCase());
    const likeAnnotation = likes && likes >= POPULAR_LIKE_THRESHOLD ? ` [${likes} likes]` : '';
    if (cred) {
      return `**@${username} (${cred.credentials}):** ${text}${likeAnnotation}`;
    }
    return `**@${username}:** ${text}${likeAnnotation}`;
  };

  sections.push(formatTweet(
    thread.rootTweet.authorUsername,
    thread.rootTweet.text,
    thread.rootTweet.publicMetrics?.likeCount
  ));

  for (const reply of thread.replies) {
    sections.push(formatTweet(
      reply.authorUsername,
      reply.text,
      reply.publicMetrics?.likeCount
    ));
  }

  // Most Popular Replies section
  const popularReplies = thread.replies
    .filter((r) => r.publicMetrics && r.publicMetrics.likeCount >= POPULAR_LIKE_THRESHOLD)
    .sort((a, b) => (b.publicMetrics?.likeCount ?? 0) - (a.publicMetrics?.likeCount ?? 0))
    .slice(0, TOP_REPLIES_COUNT);

  if (popularReplies.length > 0) {
    sections.push('');
    sections.push('### Most Popular Replies:');
    for (const reply of popularReplies) {
      sections.push(formatTweet(
        reply.authorUsername,
        reply.text,
        reply.publicMetrics?.likeCount
      ));
    }
  }

  return sections;
}
