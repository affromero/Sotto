import { logUsage } from './usage-logger';
import { loadPrompt } from './prompt-loader';
import { logger } from './logger';
import {
  getAiProviderMeta,
  getProviderForModel,
  isValidAiProviderId,
  type AiProviderId,
} from './providers/ai-registry';
import { createAIProvider, type AIProvider } from './providers/ai';
import { getAiKey } from './byok';
import type { TelegramParseResult } from '@/types/telegram';

export interface TelegramParseOptions {
  userId?: string;
  aiProvider?: string;
  aiModel?: string;
  apiKeyOverride?: string;
}

const LOCAL_AI_PROVIDER: AiProviderId = 'claude-code';
const LOCAL_MODEL_PREFIX = 'claude-code:';

function providerForParseModel(model: string): AiProviderId | null {
  if (model.startsWith(LOCAL_MODEL_PREFIX) && model.length > LOCAL_MODEL_PREFIX.length) {
    return LOCAL_AI_PROVIDER;
  }
  return getProviderForModel(model);
}

async function getProviderForParsing(
  opts?: TelegramParseOptions,
): Promise<{ provider: AIProvider; providerName: AiProviderId; model: string; apiKeyOverride?: string }> {
  let providerName: AiProviderId | null = null;
  let model: string | null = null;
  let apiKeyOverride = opts?.apiKeyOverride;

  if (opts?.aiModel) {
    const modelProvider = providerForParseModel(opts.aiModel);
    if (!modelProvider) {
      throw new Error(`Unknown AI model: ${opts.aiModel}`);
    }
    if (opts.aiProvider && opts.aiProvider !== modelProvider) {
      throw new Error(`AI model "${opts.aiModel}" does not belong to provider "${opts.aiProvider}".`);
    }
    providerName = modelProvider;
    model = opts.aiModel;
  } else if (opts?.aiProvider) {
    if (!isValidAiProviderId(opts.aiProvider)) {
      throw new Error(`Unknown AI provider: ${opts.aiProvider}`);
    }
    providerName = opts.aiProvider;
    model = getAiProviderMeta(providerName).defaultModel;
    if (!model) {
      throw new Error(`No default AI model configured for provider "${providerName}".`);
    }
  } else if (opts?.userId) {
    const userKey = await getAiKey(opts.userId);
    if (!userKey) {
      throw new Error('AI key or explicit local AI model is required to parse Telegram messages.');
    }
    providerName = userKey.provider;
    model = getAiProviderMeta(userKey.provider).defaultModel;
    apiKeyOverride ??= userKey.apiKey;
  } else {
    throw new Error('AI key or explicit local AI model is required to parse Telegram messages.');
  }

  if (!providerName || !model) {
    throw new Error('Unable to resolve AI provider for Telegram parsing.');
  }

  if (providerName !== LOCAL_AI_PROVIDER && !apiKeyOverride) {
    if (!opts?.userId) {
      throw new Error(`AI key for provider "${providerName}" is required to parse Telegram messages.`);
    }
    const providerKey = await getAiKey(opts.userId, providerName);
    if (!providerKey) {
      throw new Error(`AI key for provider "${providerName}" is required to parse Telegram messages.`);
    }
    apiKeyOverride = providerKey.apiKey;
  }

  return {
    provider: createAIProvider(providerName),
    providerName,
    model,
    apiKeyOverride,
  };
}

const SYSTEM_PROMPT = loadPrompt('social/telegram-parser.md');

/**
 * Parse a Telegram message into structured podcast generation metadata.
 * Returns isComplete=true when the message has enough detail for direct generation,
 * or isComplete=false when a discovery conversation would be beneficial.
 */
export async function parseTelegramIntent(
  messageText: string,
  opts?: TelegramParseOptions
): Promise<TelegramParseResult> {
  const { provider, providerName, model, apiKeyOverride } = await getProviderForParsing(opts);
  const response = await provider.generateResponse(
    SYSTEM_PROMPT,
    [{ role: 'user', content: `Message: "${messageText}"` }],
    { maxTokens: 512, model, apiKeyOverride }
  );

  logUsage({
    service: providerName,
    model: response.model,
    category: 'telegram_parse',
    inputTokens: response.inputTokens,
    outputTokens: response.outputTokens,
  });

  logger.info('Telegram intent parsed', {
    provider: providerName,
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
    logger.error('Failed to parse LLM JSON response', { raw: response.content });
    throw new Error('Failed to parse Telegram intent — LLM returned invalid JSON');
  }

  if (!parsed.topic || !parsed.title) {
    throw new Error('Failed to extract topic and title from Telegram message');
  }

  return parsed;
}
