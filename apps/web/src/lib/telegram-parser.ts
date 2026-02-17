import { generateResponse } from './claude';
import { INPUT_SANITIZATION_INSTRUCTIONS } from './safety-prompts';
import { logger } from './logger';
import type { TelegramParseResult } from '@/types/telegram';

const SYSTEM_PROMPT = `You are an intent parser for Sotto, an AI podcast generation platform.
Users send messages to the @SottoFMBot on Telegram to request podcast generation. Extract structured metadata from their message.

Rules:
- Extract the core topic they want a podcast about
- Generate a concise, engaging title (max 80 chars)
- Infer depth from cues: short messages → quick_overview, detailed requests → deep_dive, default → standard
- Infer audience from language complexity: jargon-heavy → expert, plain language → beginner, default → intermediate
- Infer tone from message style: emoji-heavy/casual → casual, formal → professional, question-heavy → socratic
- Extract focus areas if the user mentions specific subtopics
- If the message contains a URL, extract it as sourceUrl
- Set isComplete to true ONLY if the message provides enough detail to generate a podcast directly (clear topic + at least some specificity). Set to false if the topic is too vague (e.g., just "AI" or "science") and would benefit from a discovery conversation.
${INPUT_SANITIZATION_INSTRUCTIONS}

Respond with ONLY valid JSON matching this shape:
{
  "topic": "string — the core topic",
  "title": "string — engaging podcast title (max 80 chars)",
  "depth": "quick_overview" | "standard" | "deep_dive",
  "audienceLevel": "beginner" | "intermediate" | "expert",
  "tone": "casual" | "professional" | "socratic",
  "focusAreas": ["string array of specific subtopics"],
  "sourceUrl": "string | null — URL if found in message",
  "isComplete": true | false
}`;

/**
 * Parse a Telegram message into structured podcast generation metadata.
 * Returns isComplete=true when the message has enough detail for direct generation,
 * or isComplete=false when a discovery conversation would be beneficial.
 */
export async function parseTelegramIntent(
  messageText: string,
  apiKeyOverride?: string
): Promise<TelegramParseResult> {
  const response = await generateResponse(
    SYSTEM_PROMPT,
    [{ role: 'user', content: `Message: "${messageText}"` }],
    { maxTokens: 512, apiKeyOverride }
  );

  logger.info('Telegram intent parsed', {
    inputTokens: String(response.inputTokens),
    outputTokens: String(response.outputTokens),
  });

  let parsed: TelegramParseResult;
  try {
    const cleaned = response.content
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```$/i, '')
      .trim();
    parsed = JSON.parse(cleaned) as TelegramParseResult;
  } catch {
    logger.error('Failed to parse Claude JSON response', { raw: response.content });
    throw new Error('Failed to parse Telegram intent — Claude returned invalid JSON');
  }

  if (!parsed.topic || !parsed.title) {
    throw new Error('Failed to extract topic and title from Telegram message');
  }

  return parsed;
}
