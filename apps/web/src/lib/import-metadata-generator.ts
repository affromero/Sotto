import { generateResponse } from './claude';
import { logUsage } from './usage-logger';
import { logger } from './logger';

const SYSTEM_PROMPT = `You are a metadata generator for podcasts. Given a transcript excerpt, generate:
1. A concise, descriptive title (max 80 characters)
2. A brief description/topic summary (1-3 sentences, max 500 characters)

Return ONLY valid JSON in this exact format:
{"title": "...", "topic": "..."}

Do not include any explanation, markdown, or additional text.`;

const MAX_TRANSCRIPT_LENGTH = 8000;

/**
 * Generate a title and topic description from a transcript using Claude.
 * Used when users import audio without providing metadata.
 */
export async function generateImportMetadata(
  transcriptText: string,
  apiKeyOverride?: string
): Promise<{ title: string; topic: string }> {
  const truncated = transcriptText.slice(0, MAX_TRANSCRIPT_LENGTH);

  const response = await generateResponse(
    SYSTEM_PROMPT,
    [{ role: 'user', content: `Transcript:\n${truncated}` }],
    { maxTokens: 256, apiKeyOverride }
  );

  logUsage({
    service: 'anthropic',
    model: response.model,
    category: 'import_metadata',
    inputTokens: response.inputTokens,
    outputTokens: response.outputTokens,
  });

  const jsonMatch = response.content.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    logger.error('Failed to parse metadata JSON from Claude', {
      response: response.content.slice(0, 200),
    });
    throw new Error('Failed to parse metadata from transcript');
  }

  const parsed = JSON.parse(jsonMatch[0]) as { title?: string; topic?: string };

  const title = (parsed.title || 'Untitled Import').slice(0, 200);
  const topic = (parsed.topic || '').slice(0, 5000);

  logger.info('Generated import metadata', { title, topicLength: String(topic.length) });

  return { title, topic };
}

/**
 * Compare user-provided metadata with AI-generated metadata.
 * Returns true only when the AI suggestion is meaningfully different.
 */
export function isMetadataDifferent(userValue: string, aiValue: string): boolean {
  const normalize = (s: string) =>
    s.toLowerCase().replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, ' ').trim();

  const u = normalize(userValue);
  const a = normalize(aiValue);

  if (u === a) return false;
  if (u.includes(a) || a.includes(u)) return false;
  if (a.length < 10) return false;
  if (u === 'untitled import' || u === '') return false;

  return true;
}
