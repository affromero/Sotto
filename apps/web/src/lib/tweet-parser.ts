import { logUsage } from './usage-logger';
import { loadPrompt } from './prompt-loader';
import { logger } from './logger';
import { getAiProviderMeta, getAllAiProviderMeta } from './providers/ai-registry';
import { createAIProvider, type AIProvider, type ContentPart } from './providers/ai';
import { getAiKey } from './byok';
import { getAllProviderMeta } from './providers/tts-registry';
import type { TweetParseResult, ThreadData, ThreadTweet } from '@/types/twitter';

export interface ParseOptions {
  userId?: string;
  apiKeyOverride?: string;
  imageUrls?: string[];
}

async function getProviderForParsing(opts?: ParseOptions): Promise<{ provider: AIProvider; providerName: string }> {
  if (opts?.userId) {
    try {
      const userKey = await getAiKey(opts.userId);
      if (userKey) {
        return {
          provider: createAIProvider(userKey.provider),
          providerName: userKey.provider,
        };
      }
    } catch {
      // Fall through to defaults
    }
  }
  if (opts?.apiKeyOverride) {
    return { provider: createAIProvider('anthropic'), providerName: 'anthropic' };
  }
  const defaultProvider = process.env.AI_PROVIDER || 'anthropic';
  return { provider: createAIProvider(defaultProvider), providerName: defaultProvider };
}

const SYSTEM_PROMPT = loadPrompt('social/tweet-parser.md');

/**
 * Parse a tweet mentioning @sottofm into structured podcast generation metadata.
 * Uses the user's configured AI provider (or platform default) for fast extraction.
 */
export async function parseTweetIntent(
  tweetText: string,
  parentTweetText?: string,
  opts?: ParseOptions
): Promise<TweetParseResult> {
  let textMessage = `Tweet: "${tweetText}"`;
  if (parentTweetText) {
    textMessage += `\n\nThis tweet is a reply to: "${parentTweetText}"`;
  }

  // Build multimodal content when images are attached
  const content: string | ContentPart[] = opts?.imageUrls?.length
    ? [
        { type: 'text' as const, text: textMessage },
        ...opts.imageUrls.map((url) => ({ type: 'image_url' as const, url })),
      ]
    : textMessage;

  const { provider, providerName } = await getProviderForParsing(opts);

  const response = await provider.generateResponse(
    SYSTEM_PROMPT,
    [{ role: 'user', content }],
    { maxTokens: 512, apiKeyOverride: opts?.apiKeyOverride }
  );

  logUsage({
    service: providerName,
    model: response.model,
    category: 'tweet_parse',
    inputTokens: response.inputTokens,
    outputTokens: response.outputTokens,
  });

  logger.info('Tweet intent parsed', {
    provider: providerName,
    inputTokens: String(response.inputTokens),
    outputTokens: String(response.outputTokens),
  });

  let parsed: TweetParseResult;
  try {
    const cleaned = response.content
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```$/i, '')
      .trim();
    parsed = JSON.parse(cleaned) as TweetParseResult;
  } catch {
    logger.error('Failed to parse LLM JSON response', { raw: response.content });
    throw new Error('Failed to parse tweet intent — LLM returned invalid JSON');
  }

  if (!parsed.topic || !parsed.title) {
    throw new Error('Failed to extract topic and title from tweet');
  }

  return parsed;
}

const THREAD_SYSTEM_PROMPT = loadPrompt('social/thread-analyzer.md');

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
  opts?: ParseOptions
): Promise<TweetParseResult> {
  const threadText = formatThreadForParsing(thread);
  const threadType = thread.isSelfAuthored ? 'self-authored' : 'discussion';
  const userMessage = `The following ${threadType} thread was tagged by @${mentionTweet.authorUsername} who said: "${mentionTweet.text}"

Thread (${thread.tweetCount} tweets, ${thread.participantCount} participants, type: ${threadType}):

${threadText}`;

  const { provider, providerName } = await getProviderForParsing(opts);
  const response = await provider.generateResponse(
    THREAD_SYSTEM_PROMPT,
    [{ role: 'user', content: userMessage }],
    { maxTokens: 1024, apiKeyOverride: opts?.apiKeyOverride }
  );

  logUsage({
    service: providerName,
    model: response.model,
    category: 'tweet_parse',
    inputTokens: response.inputTokens,
    outputTokens: response.outputTokens,
    metadata: { tweetCount: thread.tweetCount },
  });

  logger.info('Thread intent parsed', {
    provider: providerName,
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
    logger.error('Failed to parse LLM thread JSON response', { raw: response.content });
    throw new Error('Failed to parse thread intent — LLM returned invalid JSON');
  }

  if (!parsed.topic || !parsed.title) {
    throw new Error('Failed to extract topic and title from thread');
  }

  return parsed;
}

/**
 * Map fuzzy model/provider names from tweets to actual registry IDs.
 * Returns { aiModel, ttsProvider } with null for unrecognized names.
 *
 * This only affects the podcast generation pipeline (script + audio),
 * NOT the tweet parser itself (which uses the user's configured AI provider).
 */
export function resolveModelFromTweet(parsed: TweetParseResult): {
  aiModel: string | null;
  ttsProvider: string | null;
} {
  let aiModel: string | null = null;
  let ttsProvider: string | null = null;

  if (parsed.requestedAiModel) {
    aiModel = resolveAiModel(parsed.requestedAiModel);
  }
  if (parsed.requestedTtsProvider) {
    ttsProvider = resolveTtsProvider(parsed.requestedTtsProvider);
  }

  return { aiModel, ttsProvider };
}

const AI_MODEL_ALIASES: Record<string, string> = {
  // Anthropic — resolve from registry tiers
  opus: getAiProviderMeta('anthropic').models.find(m => m.tier === 'best')!.id,
  'claude opus': getAiProviderMeta('anthropic').models.find(m => m.tier === 'best')!.id,
  sonnet: getAiProviderMeta('anthropic').models.find(m => m.tier === 'balanced')!.id,
  'claude sonnet': getAiProviderMeta('anthropic').models.find(m => m.tier === 'balanced')!.id,
  haiku: getAiProviderMeta('anthropic').models.find(m => m.tier === 'fast')!.id,
  'claude haiku': getAiProviderMeta('anthropic').models.find(m => m.tier === 'fast')!.id,
  claude: getAiProviderMeta('anthropic').models.find(m => m.tier === 'balanced')!.id,
  // OpenAI
  'gpt-5': getAiProviderMeta('openai').defaultModel,
  'gpt5': getAiProviderMeta('openai').defaultModel,
  chatgpt: getAiProviderMeta('openai').defaultModel,
  openai: getAiProviderMeta('openai').defaultModel,
};

function resolveAiModel(raw: string): string | null {
  const normalized = raw.toLowerCase().trim();

  // Direct alias match
  if (AI_MODEL_ALIASES[normalized]) return AI_MODEL_ALIASES[normalized];

  // Check against actual registry model IDs
  for (const provider of getAllAiProviderMeta()) {
    for (const model of provider.models) {
      if (model.id === normalized || model.displayName.toLowerCase() === normalized) {
        return model.id;
      }
    }
  }

  // Fuzzy: check if the raw string contains a known alias
  for (const [alias, modelId] of Object.entries(AI_MODEL_ALIASES)) {
    if (normalized.includes(alias)) return modelId;
  }

  logger.info('Unrecognized AI model from tweet', { raw });
  return null;
}

const TTS_PROVIDER_ALIASES: Record<string, string> = {
  elevenlabs: 'elevenlabs',
  'eleven labs': 'elevenlabs',
  '11labs': 'elevenlabs',
  openai: 'openai',
  'openai tts': 'openai',
  'openai voice': 'openai',
  cartesia: 'cartesia',
  hume: 'hume',
  'hume ai': 'hume',
  fal: 'fal',
  replicate: 'replicate',
};

function resolveTtsProvider(raw: string): string | null {
  const normalized = raw.toLowerCase().trim();

  // Direct alias match
  if (TTS_PROVIDER_ALIASES[normalized]) return TTS_PROVIDER_ALIASES[normalized];

  // Check against actual registry provider IDs
  for (const provider of getAllProviderMeta()) {
    if (provider.id === normalized || provider.displayName.toLowerCase() === normalized) {
      return provider.id;
    }
  }

  // Fuzzy: check if the raw string contains a known alias
  for (const [alias, providerId] of Object.entries(TTS_PROVIDER_ALIASES)) {
    if (normalized.includes(alias)) return providerId;
  }

  logger.info('Unrecognized TTS provider from tweet', { raw });
  return null;
}
