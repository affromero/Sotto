import Anthropic from '@anthropic-ai/sdk';
import { moderateOrThrow, moderateContent } from './moderation';
import { prisma } from './prisma';
import { logger } from './logger';

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

function useClaudeCode(): boolean {
  return process.env.AI_PROVIDER === 'claude-code';
}

if (!ANTHROPIC_API_KEY && !useClaudeCode()) {
  logger.warn('ANTHROPIC_API_KEY is not set — Claude features will not work');
}

const client = ANTHROPIC_API_KEY ? new Anthropic({ apiKey: ANTHROPIC_API_KEY }) : null;

export const WEB_SEARCH_TOOL = {
  type: 'web_search_20250305' as const,
  name: 'web_search' as const,
};

/**
 * Generate a non-streaming response from Claude.
 * When apiKeyOverride is provided, creates a fresh client with that key
 * instead of using the module-level client (for BYOK users).
 */
export async function generateResponse(
  systemPrompt: string,
  messages: Array<{ role: 'user' | 'assistant'; content: string }>,
  options?: {
    maxTokens?: number;
    model?: string;
    apiKeyOverride?: string;
    tools?: Anthropic.MessageCreateParams['tools'];
    skipModeration?: boolean;
  }
): Promise<{ content: string; inputTokens: number; outputTokens: number }> {
  // Screen user input before sending to LLM
  if (!options?.skipModeration) {
    const lastUserMsg = [...messages].reverse().find((m) => m.role === 'user');
    if (lastUserMsg) {
      await moderateOrThrow(lastUserMsg.content);
    }
  }

  if (useClaudeCode() && !options?.apiKeyOverride) {
    const { executeClaudeCode, serializeMessages } = await import('./claude-code-client');
    return executeClaudeCode(systemPrompt, serializeMessages(messages), {
      model: options?.model || process.env.CLAUDE_CODE_MODEL || 'opus',
    });
  }

  const activeClient = options?.apiKeyOverride
    ? new Anthropic({ apiKey: options.apiKeyOverride })
    : client;

  if (!activeClient) {
    throw new Error('Claude client not initialized — set ANTHROPIC_API_KEY or provide apiKeyOverride');
  }

  const response = await activeClient.messages.create({
    model: options?.model || 'claude-sonnet-4-5-20250929',
    max_tokens: options?.maxTokens || 4096,
    system: systemPrompt,
    messages,
    ...(options?.tools?.length ? { tools: options.tools } : {}),
  });

  const textBlocks = response.content.filter(
    (block): block is Anthropic.Messages.TextBlock => block.type === 'text'
  );
  const content = textBlocks.map((block) => block.text).join('\n\n');

  // Soft-block: log flagged output but don't throw (educational content may discuss sensitive topics)
  if (!options?.skipModeration && content) {
    moderateContent(content).then((result) => {
      if (result.flagged) {
        logger.warn('LLM output flagged by moderation', {
          categories: result.blockedCategories.join(','),
        });
      }
    }).catch(() => {});
  }

  return {
    content,
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
  };
}

/**
 * Stream a response from Claude (for discovery chat).
 * When apiKeyOverride is provided, creates a fresh client with that key.
 */
export async function* streamResponse(
  systemPrompt: string,
  messages: Array<{ role: 'user' | 'assistant'; content: string }>,
  options?: {
    maxTokens?: number;
    model?: string;
    apiKeyOverride?: string;
    tools?: Anthropic.MessageCreateParams['tools'];
    skipModeration?: boolean;
    onComplete?: (usage: { inputTokens: number; outputTokens: number }) => void;
  }
): AsyncGenerator<string> {
  // Screen user input before starting stream
  if (!options?.skipModeration) {
    const lastUserMsg = [...messages].reverse().find((m) => m.role === 'user');
    if (lastUserMsg) {
      await moderateOrThrow(lastUserMsg.content);
    }
  }

  if (useClaudeCode() && !options?.apiKeyOverride) {
    const { streamClaudeCode, serializeMessages } = await import('./claude-code-client');
    yield* streamClaudeCode(systemPrompt, serializeMessages(messages), {
      model: options?.model || process.env.CLAUDE_CODE_MODEL || 'opus',
    });
    return;
  }

  const activeClient = options?.apiKeyOverride
    ? new Anthropic({ apiKey: options.apiKeyOverride })
    : client;

  if (!activeClient) {
    throw new Error('Claude client not initialized — set ANTHROPIC_API_KEY or provide apiKeyOverride');
  }

  const stream = activeClient.messages.stream({
    model: options?.model || 'claude-sonnet-4-5-20250929',
    max_tokens: options?.maxTokens || 4096,
    system: systemPrompt,
    messages,
    ...(options?.tools?.length ? { tools: options.tools } : {}),
  });

  for await (const event of stream) {
    if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
      yield event.delta.text;
    }
  }

  if (options?.onComplete) {
    const finalMessage = await stream.finalMessage();
    options.onComplete({
      inputTokens: finalMessage.usage.input_tokens,
      outputTokens: finalMessage.usage.output_tokens,
    });
  }
}

/**
 * Log AI API usage for cost tracking — persists to ApiUsageLog table.
 */
export async function logApiUsage(params: {
  podcastId?: string;
  userId?: string;
  category: string;
  inputTokens: number;
  outputTokens: number;
  durationMs?: number;
}): Promise<void> {
  // Cost calculation (Claude Sonnet 4.5 pricing)
  const inputCost = (params.inputTokens / 1_000_000) * 3.0;
  const outputCost = (params.outputTokens / 1_000_000) * 15.0;
  const totalCost = inputCost + outputCost;

  prisma.apiUsageLog.create({
    data: {
      service: 'anthropic',
      category: params.category,
      inputTokens: params.inputTokens,
      outputTokens: params.outputTokens,
      totalCost,
      durationMs: params.durationMs ?? null,
      podcastId: params.podcastId ?? null,
      userId: params.userId ?? null,
    },
  }).catch(() => {});
}
