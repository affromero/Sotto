import { generateResponse } from './claude';
import { INPUT_SANITIZATION_INSTRUCTIONS } from './safety-prompts';
import { logUsage } from './usage-logger';
import { logger } from './logger';
import type { TweetParseResult, ThreadData, ThreadTweet } from '@/types/twitter';

const SYSTEM_PROMPT = `You are an intent parser for Sotto, an AI podcast generation platform.
Users tag @sottofm on Twitter to request podcast generation. Extract structured metadata from their tweet.

Rules:
- Extract the core topic they want a podcast about
- Generate a concise, engaging title (max 80 chars)
- Infer depth from cues: "eli5" or "explain like I'm 5" → eli5, short tweets → quick_overview, detailed requests → deep_dive, default → standard
- Infer audience from language complexity: jargon-heavy → expert, plain language → beginner, default → intermediate
- Infer tone from tweet style: emoji-heavy/casual → casual, formal → professional, question-heavy → socratic
- Extract focus areas if the user mentions specific subtopics
- If the tweet contains a URL, extract it as sourceUrl
- Infer audience content rating: kids/educational → kids, explicit/NSFW → mature, default → general
- Infer durationTarget in minutes: short tweet or quick_overview → 5, detailed or deep_dive → 15, default → 10
- Strip @sottofm mention and any Twitter handles from the topic
${INPUT_SANITIZATION_INSTRUCTIONS}

Respond with ONLY valid JSON matching this shape:
{
  "topic": "string — the core topic",
  "title": "string — engaging podcast title (max 80 chars)",
  "depth": "eli5" | "quick_overview" | "standard" | "deep_dive",
  "audienceLevel": "beginner" | "intermediate" | "expert",
  "tone": "casual" | "professional" | "socratic",
  "focusAreas": ["string array of specific subtopics"],
  "audience": "general" | "kids" | "mature",
  "durationTarget": 5 | 10 | 15,
  "sourceUrl": "string | null — URL if found in tweet"
}`;

/**
 * Parse a tweet mentioning @sottofm into structured podcast generation metadata.
 * Uses a lightweight Claude call (512 max tokens) for fast extraction.
 */
export async function parseTweetIntent(
  tweetText: string,
  parentTweetText?: string,
  apiKeyOverride?: string
): Promise<TweetParseResult> {
  let userMessage = `Tweet: "${tweetText}"`;
  if (parentTweetText) {
    userMessage += `\n\nThis tweet is a reply to: "${parentTweetText}"`;
  }

  const response = await generateResponse(
    SYSTEM_PROMPT,
    [{ role: 'user', content: userMessage }],
    { maxTokens: 512, apiKeyOverride }
  );

  logUsage({
    service: 'anthropic',
    model: response.model,
    category: 'tweet_parse',
    inputTokens: response.inputTokens,
    outputTokens: response.outputTokens,
  });

  logger.info('Tweet intent parsed', {
    inputTokens: String(response.inputTokens),
    outputTokens: String(response.outputTokens),
  });

  let parsed: TweetParseResult;
  try {
    // Claude may wrap JSON in markdown code fences — strip them
    const cleaned = response.content
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```$/i, '')
      .trim();
    parsed = JSON.parse(cleaned) as TweetParseResult;
  } catch {
    logger.error('Failed to parse Claude JSON response', { raw: response.content });
    throw new Error('Failed to parse tweet intent — Claude returned invalid JSON');
  }

  if (!parsed.topic || !parsed.title) {
    throw new Error('Failed to extract topic and title from tweet');
  }

  return parsed;
}

const THREAD_SYSTEM_PROMPT = `You are an intent parser for Sotto, an AI podcast generation platform.
You are analyzing a full Twitter/X thread conversation where someone tagged @sottofm.

Your job:
1. Read the entire thread carefully
2. Identify the core topic of discussion
3. Determine if this is a debate (multiple contrasting viewpoints) or informational (one perspective, explanations)
4. For SELF-AUTHORED threads (one person posting a multi-tweet thread): treat as long-form content, extract the thesis and key points, prefer "deep_dive" depth
5. Extract ALL URLs shared by any participant
6. Summarize each distinct viewpoint with attribution (@username)
7. Generate structured metadata for podcast generation
8. Set isSelfAuthored: true if the thread is from a single author posting a multi-tweet essay/explainer

Rules:
- Generate a concise, engaging title (max 80 chars) that captures the thread's essence
- If there are opposing viewpoints, set isDebate: true and list each viewpoint
- Extract ALL URLs from the thread into sourceUrls array
- Pick the single most relevant URL as sourceUrl (or null if none)
- Infer depth from thread complexity: "eli5" or "explain like I'm 5" → eli5, short threads → standard, long detailed threads → deep_dive, self-authored threads → deep_dive
- Infer audience from language: jargon → expert, plain → beginner, default → intermediate
- If debate: tone should be "socratic"; if informational: infer from style
- Focus areas should include key subtopics discussed across the thread
- Infer audience content rating: kids/educational → kids, explicit/NSFW → mature, default → general
- Infer durationTarget in minutes: short threads → 10, long detailed threads → 15, default → 15
- Strip @sottofm and other handles from the topic
${INPUT_SANITIZATION_INSTRUCTIONS}

Respond with ONLY valid JSON matching this shape:
{
  "topic": "string — the core topic",
  "title": "string — engaging podcast title (max 80 chars)",
  "depth": "eli5" | "quick_overview" | "standard" | "deep_dive",
  "audienceLevel": "beginner" | "intermediate" | "expert",
  "tone": "casual" | "professional" | "socratic",
  "focusAreas": ["string array of specific subtopics"],
  "audience": "general" | "kids" | "mature",
  "durationTarget": 10 | 15,
  "sourceUrl": "string | null — most relevant URL",
  "sourceUrls": ["all URLs found in thread"],
  "isDebate": true | false,
  "isSelfAuthored": true | false,
  "viewpoints": ["@alice argues X because Y", "@bob counters with Z"]
}`;

function formatThreadForParsing(thread: ThreadData): string {
  const lines: string[] = [];

  if (thread.isSelfAuthored) {
    lines.push('[SELF-AUTHORED THREAD]');
    lines.push('');
  }

  const likeSuffix = (likes?: number) => likes && likes > 0 ? ` (${likes} likes)` : '';

  lines.push(`[ROOT by @${thread.rootTweet.authorUsername}]: "${thread.rootTweet.text}"${likeSuffix(thread.rootTweet.publicMetrics?.likeCount)}`);

  for (const reply of thread.replies) {
    lines.push(`[@${reply.authorUsername}]: "${reply.text}"${likeSuffix(reply.publicMetrics?.likeCount)}`);
  }

  return lines.join('\n\n');
}

/**
 * Parse a full thread mentioning @sottofm into structured podcast metadata.
 * Analyzes the entire conversation for viewpoints, URLs, and debate detection.
 */
export async function parseThreadIntent(
  mentionTweet: ThreadTweet,
  thread: ThreadData,
  apiKeyOverride?: string
): Promise<TweetParseResult> {
  const threadText = formatThreadForParsing(thread);
  const threadType = thread.isSelfAuthored ? 'self-authored' : 'discussion';
  const userMessage = `The following ${threadType} thread was tagged by @${mentionTweet.authorUsername} who said: "${mentionTweet.text}"

Thread (${thread.tweetCount} tweets, ${thread.participantCount} participants, type: ${threadType}):

${threadText}`;

  const response = await generateResponse(
    THREAD_SYSTEM_PROMPT,
    [{ role: 'user', content: userMessage }],
    { maxTokens: 1024, apiKeyOverride }
  );

  logUsage({
    service: 'anthropic',
    model: response.model,
    category: 'tweet_parse',
    inputTokens: response.inputTokens,
    outputTokens: response.outputTokens,
    metadata: { tweetCount: thread.tweetCount },
  });

  logger.info('Thread intent parsed', {
    inputTokens: String(response.inputTokens),
    outputTokens: String(response.outputTokens),
    tweetCount: String(thread.tweetCount),
  });

  let parsed: TweetParseResult;
  try {
    const cleaned = response.content
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```$/i, '')
      .trim();
    parsed = JSON.parse(cleaned) as TweetParseResult;
  } catch {
    logger.error('Failed to parse Claude thread JSON response', { raw: response.content });
    throw new Error('Failed to parse thread intent — Claude returned invalid JSON');
  }

  if (!parsed.topic || !parsed.title) {
    throw new Error('Failed to extract topic and title from thread');
  }

  return parsed;
}
