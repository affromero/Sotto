import { logUsage } from './usage-logger';
import { loadPrompt } from './prompt-loader';
import { logger } from './logger';
import { getAiProviderMeta, type AiProviderId } from './providers/ai-registry';
import { createAIProvider, type AIProvider } from './providers/ai';
import { getAiKey } from './byok';
import { resolveAutoModel } from './auto-model-config';
import type { TelegramParseResult } from '@/types/telegram';

export interface TelegramParseOptions {
  userId?: string;
  apiKeyOverride?: string;
}

async function getProviderForParsing(opts?: TelegramParseOptions): Promise<{ provider: AIProvider; providerName: string; model: string }> {
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
  const { provider, providerName, model } = await getProviderForParsing(opts);
  const response = await provider.generateResponse(
    SYSTEM_PROMPT,
    [{ role: 'user', content: `Message: "${messageText}"` }],
    { maxTokens: 512, model, apiKeyOverride: opts?.apiKeyOverride }
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
