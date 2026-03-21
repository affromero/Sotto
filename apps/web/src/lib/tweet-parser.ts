import { logUsage } from './usage-logger';
import { loadPrompt } from './prompt-loader';
import { logger } from './logger';
import { getAiProviderMeta, getAllAiProviderMeta, type AiProviderId } from './providers/ai-registry';
import { createAIProvider, type AIProvider, type ContentPart } from './providers/ai';
import { getAiKey } from './byok';
import { resolveAutoModel } from './auto-model-config';
import { getAllProviderMeta } from './providers/tts-registry';
import { FAL_IMAGE_MODEL_IDS, FAL_VIDEO_MODEL_IDS } from './providers/fal-endpoints';
import { getAllAvatarModelIds } from './providers/avatar-registry';
import type { TweetParseResult, ThreadData, ThreadTweet } from '@/types/twitter';

export interface ParseOptions {
  userId?: string;
  apiKeyOverride?: string;
  imageUrls?: string[];
}

async function getProviderForParsing(opts?: ParseOptions): Promise<{ provider: AIProvider; providerName: string; model: string }> {
  if (opts?.userId) {
    try {
      const userKey = await getAiKey(opts.userId);
      if (userKey) {
        const meta = getAiProviderMeta(userKey.provider as AiProviderId);
        return {
          provider: createAIProvider(userKey.provider),
          providerName: userKey.provider,
          model: meta.defaultModel,
        };
      }
    } catch {
      // Fall through to defaults
    }
  }

  const { aiProvider, aiModel } = await resolveAutoModel('PLATFORM');
  return {
    provider: createAIProvider(aiProvider),
    providerName: aiProvider,
    model: aiModel,
  };
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

  const { provider, providerName, model } = await getProviderForParsing(opts);

  const response = await provider.generateResponse(
    SYSTEM_PROMPT,
    [{ role: 'user', content }],
    { maxTokens: 512, model, apiKeyOverride: opts?.apiKeyOverride }
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

  const { provider, providerName, model } = await getProviderForParsing(opts);
  const response = await provider.generateResponse(
    THREAD_SYSTEM_PROMPT,
    [{ role: 'user', content: userMessage }],
    { maxTokens: 1024, model, apiKeyOverride: opts?.apiKeyOverride }
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

export interface ResolvedTweetModels {
  aiModel: string | null;
  ttsProvider: string | null;
  ttsModel: string | null;
  imageModel: string | null;
  videoModel: string | null;
  avatarModel: string | null;
  wantsVideo: boolean;
  wantsAvatar: boolean;
  costPreference: 'cheapest' | null;
}

/**
 * Map fuzzy model/provider names from tweets to actual registry IDs.
 * Returns resolved model IDs with null for unrecognized names.
 * "auto" values signal video generation with default models.
 *
 * This only affects the podcast generation pipeline (script + audio + video),
 * NOT the tweet parser itself (which uses the user's configured AI provider).
 */
export function resolveModelFromTweet(parsed: TweetParseResult): ResolvedTweetModels {
  let aiModel: string | null = null;
  let ttsProvider: string | null = null;
  let ttsModel: string | null = null;
  let imageModel: string | null = null;
  let videoModel: string | null = null;
  let avatarModel: string | null = null;
  const wantsAvatar = !!parsed.requestedAvatarModel;
  // Avatar requires video — force wantsVideo when avatar requested
  const wantsVideo = !!(parsed.requestedImageModel || parsed.requestedVideoModel || wantsAvatar);

  if (parsed.requestedAiModel) {
    aiModel = resolveAiModel(parsed.requestedAiModel);
  }
  if (parsed.requestedTtsProvider) {
    ttsProvider = resolveTtsProvider(parsed.requestedTtsProvider);
  }
  if (parsed.requestedTtsModel) {
    ttsModel = resolveTtsModel(parsed.requestedTtsModel);
  }
  if (parsed.requestedImageModel && parsed.requestedImageModel !== 'auto') {
    imageModel = resolveImageModel(parsed.requestedImageModel);
  }
  if (parsed.requestedVideoModel && parsed.requestedVideoModel !== 'auto') {
    videoModel = resolveVideoModel(parsed.requestedVideoModel);
  }
  if (parsed.requestedAvatarModel) {
    avatarModel = resolveAvatarModel(parsed.requestedAvatarModel);
  }

  return { aiModel, ttsProvider, ttsModel, imageModel, videoModel, avatarModel, wantsVideo, wantsAvatar, costPreference: parsed.costPreference ?? null };
}

/**
 * Resolve "cheapest" cost preference to concrete model IDs.
 * Async because image/video pricing requires fetching from PriceToken.
 * Called by the worker when costPreference === 'cheapest'.
 */
export async function resolveCheapestModels(current: ResolvedTweetModels): Promise<ResolvedTweetModels> {
  const { getCheapestModel } = await import('./pricing');
  const { fetchFalImageModels, fetchFalVideoModels, cheapestModel } = await import('./video-cost-estimator');

  const result = { ...current };

  if (!result.aiModel) {
    result.aiModel = getCheapestModel();
  }

  // Pick cheapest TTS provider+model by platformCostPerKChar
  if (!result.ttsProvider) {
    let cheapestCost = Infinity;
    for (const provider of getAllProviderMeta()) {
      if (provider.id === 'kittentts') continue;
      if (provider.platformCostPerKChar < cheapestCost) {
        cheapestCost = provider.platformCostPerKChar;
        result.ttsProvider = provider.id;
        result.ttsModel = provider.defaultModel;
      }
    }
  }

  if (result.wantsVideo) {
    if (!result.imageModel) {
      const imageModels = await fetchFalImageModels();
      result.imageModel = cheapestModel(imageModels, (m) => m.pricePerImage, 'fal-flux-1-pro');
    }
    if (!result.videoModel) {
      const videoModels = await fetchFalVideoModels();
      result.videoModel = cheapestModel(videoModels, (m) => m.costPerMinute, 'fal-wan2.5-480p');
    }
  }

  return result;
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
  'gpt-5.4': getAiProviderMeta('openai').defaultModel,
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

const IMAGE_MODEL_ALIASES: Record<string, string> = {
  flux: 'fal-flux-2-pro',
  'flux pro': 'fal-flux-2-pro',
  'flux 2': 'fal-flux-2-pro',
  'flux 1': 'fal-flux-1-pro',
  recraft: 'fal-recraft-v3',
  'recraft v3': 'fal-recraft-v3',
  ideogram: 'fal-ideogram-v2',
  'ideogram v2': 'fal-ideogram-v2',
  sd3: 'fal-sd3',
  'stable diffusion': 'fal-sd3',
  'stable diffusion 3': 'fal-sd3',
};

function resolveImageModel(raw: string): string | null {
  const normalized = raw.toLowerCase().trim();

  if (IMAGE_MODEL_ALIASES[normalized]) return IMAGE_MODEL_ALIASES[normalized];

  // Direct model ID match
  if (FAL_IMAGE_MODEL_IDS.has(normalized)) return normalized;

  // Fuzzy: check if the raw string contains a known alias
  for (const [alias, modelId] of Object.entries(IMAGE_MODEL_ALIASES)) {
    if (normalized.includes(alias)) return modelId;
  }

  logger.info('Unrecognized image model from tweet', { raw });
  return null;
}

const VIDEO_MODEL_ALIASES: Record<string, string> = {
  veo: 'fal-veo3-1080p',
  veo3: 'fal-veo3-1080p',
  'veo fast': 'fal-veo3-fast-1080p',
  'veo 3': 'fal-veo3-1080p',
  kling: 'fal-kling3-1080p',
  kling3: 'fal-kling3-1080p',
  'kling 3': 'fal-kling3-1080p',
  wan: 'fal-wan2.5-480p',
  'wan 2.5': 'fal-wan2.5-480p',
};

function resolveVideoModel(raw: string): string | null {
  const normalized = raw.toLowerCase().trim();

  if (VIDEO_MODEL_ALIASES[normalized]) return VIDEO_MODEL_ALIASES[normalized];

  // Direct model ID match
  if (FAL_VIDEO_MODEL_IDS.has(normalized)) return normalized;

  // Fuzzy: check if the raw string contains a known alias
  for (const [alias, modelId] of Object.entries(VIDEO_MODEL_ALIASES)) {
    if (normalized.includes(alias)) return modelId;
  }

  logger.info('Unrecognized video model from tweet', { raw });
  return null;
}

const TTS_MODEL_ALIASES: Record<string, string> = {
  // ElevenLabs
  v3: 'eleven_v3',
  'eleven v3': 'eleven_v3',
  'elevenlabs v3': 'eleven_v3',
  flash: 'eleven_flash_v2_5',
  'eleven flash': 'eleven_flash_v2_5',
  'flash v2.5': 'eleven_flash_v2_5',
  'eleven turbo': 'eleven_turbo_v2',
  'turbo v2': 'eleven_turbo_v2',
  multilingual: 'eleven_multilingual_v2',
  'eleven multilingual': 'eleven_multilingual_v2',
  // Cartesia
  'sonic 3': 'sonic-3',
  'cartesia sonic': 'sonic-3',
  sonic: 'sonic-3',
  'sonic turbo': 'sonic-turbo',
  // OpenAI
  'tts-1-hd': 'tts-1-hd',
  'openai hd': 'tts-1-hd',
  'tts-1': 'tts-1',
  'gpt-4o-mini-tts': 'gpt-4o-mini-tts',
  'gpt tts': 'gpt-4o-mini-tts',
  // Hume
  octave: 'octave-v2',
  'hume octave': 'octave-v2',
  'octave v1': 'octave-v1',
  'octave v2': 'octave-v2',
  // MiniMax
  'speech-02-hd': 'speech-02-hd',
  'minimax hd': 'speech-02-hd',
  'speech-02-turbo': 'speech-02-turbo',
  'minimax turbo': 'speech-02-turbo',
};

function resolveTtsModel(raw: string): string | null {
  const normalized = raw.toLowerCase().trim();

  if (TTS_MODEL_ALIASES[normalized]) return TTS_MODEL_ALIASES[normalized];

  // Check against actual registry model IDs
  for (const provider of getAllProviderMeta()) {
    for (const model of provider.models) {
      if (model.id === normalized || model.displayName.toLowerCase() === normalized) {
        return model.id;
      }
    }
  }

  // Fuzzy: check if the raw string contains a known alias
  for (const [alias, modelId] of Object.entries(TTS_MODEL_ALIASES)) {
    if (normalized.includes(alias)) return modelId;
  }

  logger.info('Unrecognized TTS model from tweet', { raw });
  return null;
}

const AVATAR_MODEL_ALIASES: Record<string, string> = {
  // HeyGen — standard
  heygen: 'heygen-avatar-standard',
  'heygen avatar': 'heygen-avatar-standard',
  avatar: 'heygen-avatar-standard',
  avatars: 'heygen-avatar-standard',
  'heygen standard': 'heygen-avatar-standard',
  // HeyGen — photo avatar
  'photo avatar': 'heygen-photo-avatar-iii',
  'heygen photo': 'heygen-photo-avatar-iii',
  // HeyGen — digital twin
  'digital twin': 'heygen-digital-twin-iii',
  'heygen twin': 'heygen-digital-twin-iii',
  // HeyGen — premium (IV)
  'heygen iv': 'heygen-avatar-iv',
  'avatar iv': 'heygen-avatar-iv',
  'avatar 4': 'heygen-avatar-iv',
  'interactive avatar': 'heygen-avatar-iv',
  'digital twin iv': 'heygen-digital-twin-iv',
  'twin iv': 'heygen-digital-twin-iv',
  'photo avatar iv': 'heygen-photo-avatar-iv',
  'photo iv': 'heygen-photo-avatar-iv',
  // Fal
  'fal avatar': 'fal-heygen-avatar4-i2v',
  'fal heygen': 'fal-heygen-avatar4-i2v',
  'fal twin': 'fal-heygen-avatar4-twin',
  'fal digital twin': 'fal-heygen-avatar4-twin',
};

function resolveAvatarModel(raw: string): string | null {
  const normalized = raw.toLowerCase().trim();

  if (AVATAR_MODEL_ALIASES[normalized]) return AVATAR_MODEL_ALIASES[normalized];

  // Direct model ID match from registry
  if (getAllAvatarModelIds().has(normalized)) return normalized;

  // Fuzzy: check if the raw string contains a known alias
  for (const [alias, modelId] of Object.entries(AVATAR_MODEL_ALIASES)) {
    if (normalized.includes(alias)) return modelId;
  }

  logger.info('Unrecognized avatar model from tweet', { raw });
  return null;
}
