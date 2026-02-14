import { generateResponse } from './claude';
import { logger } from './logger';
import type { TweetParseResult } from '@/types/twitter';

const SYSTEM_PROMPT = `You are an intent parser for Sotto, an AI podcast generation platform.
Users tag @sottofm on Twitter to request podcast generation. Extract structured metadata from their tweet.

Rules:
- Extract the core topic they want a podcast about
- Generate a concise, engaging title (max 80 chars)
- Infer depth from cues: short tweets → quick_overview, detailed requests → deep_dive, default → standard
- Infer audience from language complexity: jargon-heavy → expert, plain language → beginner, default → intermediate
- Infer tone from tweet style: emoji-heavy/casual → casual, formal → professional, question-heavy → socratic
- Extract focus areas if the user mentions specific subtopics
- If the tweet contains a URL, extract it as sourceUrl
- Strip @sottofm mention and any Twitter handles from the topic

Respond with ONLY valid JSON matching this shape:
{
  "topic": "string — the core topic",
  "title": "string — engaging podcast title (max 80 chars)",
  "depth": "quick_overview" | "standard" | "deep_dive",
  "audienceLevel": "beginner" | "intermediate" | "expert",
  "tone": "casual" | "professional" | "socratic",
  "focusAreas": ["string array of specific subtopics"],
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
