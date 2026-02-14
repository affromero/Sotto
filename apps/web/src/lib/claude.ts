import Anthropic from '@anthropic-ai/sdk';
import { logger } from './logger';

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const USE_CLAUDE_CODE = process.env.AI_PROVIDER === 'claude-code';

if (!ANTHROPIC_API_KEY && !USE_CLAUDE_CODE) {
  logger.warn('ANTHROPIC_API_KEY is not set — Claude features will not work');
}

const client = ANTHROPIC_API_KEY ? new Anthropic({ apiKey: ANTHROPIC_API_KEY }) : null;

/**
 * Generate a non-streaming response from Claude.
 * When apiKeyOverride is provided, creates a fresh client with that key
 * instead of using the module-level client (for BYOK users).
 */
export async function generateResponse(
  systemPrompt: string,
  messages: Array<{ role: 'user' | 'assistant'; content: string }>,
  options?: { maxTokens?: number; model?: string; apiKeyOverride?: string }
): Promise<{ content: string; inputTokens: number; outputTokens: number }> {
  if (USE_CLAUDE_CODE && !options?.apiKeyOverride) {
    const { executeClaudeCode, serializeMessages } = await import('./claude-code-client');
    return executeClaudeCode(systemPrompt, serializeMessages(messages), {
      model: options?.model || process.env.CLAUDE_CODE_MODEL || 'haiku',
      maxTokens: options?.maxTokens,
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
  });

  const textBlock = response.content.find((block) => block.type === 'text');
  const content = textBlock?.type === 'text' ? textBlock.text : '';

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
  options?: { maxTokens?: number; model?: string; apiKeyOverride?: string }
): AsyncGenerator<string> {
  if (USE_CLAUDE_CODE && !options?.apiKeyOverride) {
    const { streamClaudeCode, serializeMessages } = await import('./claude-code-client');
    yield* streamClaudeCode(systemPrompt, serializeMessages(messages), {
      model: options?.model || process.env.CLAUDE_CODE_MODEL || 'haiku',
      maxTokens: options?.maxTokens,
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
  });

  for await (const event of stream) {
    if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
      yield event.delta.text;
    }
  }
}

/**
 * Log AI API usage for cost tracking
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

  logger.info('AI API usage', {
    category: params.category,
    inputTokens: String(params.inputTokens),
    outputTokens: String(params.outputTokens),
    totalCost: String(inputCost + outputCost),
  });
}
