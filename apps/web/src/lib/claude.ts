import Anthropic from '@anthropic-ai/sdk';
import { moderateOrThrow, moderateContent } from './moderation';
import { logger } from './logger';

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

function isClaudeCodeMode(): boolean {
  return process.env.AI_PROVIDER === 'claude-code';
}

if (!ANTHROPIC_API_KEY && !isClaudeCodeMode()) {
  logger.warn('ANTHROPIC_API_KEY is not set — Claude features will not work');
}

const client = ANTHROPIC_API_KEY ? new Anthropic({ apiKey: ANTHROPIC_API_KEY }) : null;

/** Status codes that indicate a transient server-side problem worth retrying. */
const RETRYABLE_STATUS = new Set([429, 500, 503, 529]);
const MAX_RETRIES = 3;

function isRetryableError(err: unknown): boolean {
  return (
    err instanceof Error &&
    'status' in err &&
    typeof (err as { status: unknown }).status === 'number' &&
    RETRYABLE_STATUS.has((err as { status: number }).status)
  );
}

async function withRetry<T>(label: string, fn: () => Promise<T>): Promise<T> {
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (!isRetryableError(err) || attempt === MAX_RETRIES) throw err;
      const delayMs = 1000 * Math.pow(2, attempt) + Math.random() * 500;
      logger.warn(`${label} — Claude API transient error, retrying`, {
        attempt: String(attempt + 1),
        status: String((err as { status?: number }).status),
        delayMs: String(Math.round(delayMs)),
      });
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
  throw new Error('unreachable');
}

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
): Promise<{ content: string; inputTokens: number; outputTokens: number; model: string }> {
  // Screen user input before sending to LLM
  if (!options?.skipModeration) {
    const lastUserMsg = [...messages].reverse().find((m) => m.role === 'user');
    if (lastUserMsg) {
      await moderateOrThrow(lastUserMsg.content);
    }
  }

  // Per-request claude-code routing (admin-selected model via dropdown)
  if (options?.model?.startsWith('claude-code:')) {
    const { executeClaudeCode, serializeMessages } = await import('./claude-code-client');
    const ccModel = options.model.split(':')[1] || 'opus';
    const result = await executeClaudeCode(systemPrompt, serializeMessages(messages), { model: ccModel });
    return { ...result, model: options.model };
  }

  if (isClaudeCodeMode() && !options?.apiKeyOverride) {
    const { executeClaudeCode, serializeMessages } = await import('./claude-code-client');
    const ccModel = options?.model || process.env.CLAUDE_CODE_MODEL || 'opus';
    const result = await executeClaudeCode(systemPrompt, serializeMessages(messages), {
      model: ccModel,
    });
    return { ...result, model: ccModel };
  }

  const activeClient = options?.apiKeyOverride
    ? new Anthropic({ apiKey: options.apiKeyOverride })
    : client;

  if (!activeClient) {
    throw new Error('Claude client not initialized — set ANTHROPIC_API_KEY or provide apiKeyOverride');
  }

  const resolvedModel = options?.model || 'claude-sonnet-4-6';

  const response = await withRetry('generateResponse', () =>
    activeClient.messages.create({
      model: resolvedModel,
      max_tokens: options?.maxTokens || 4096,
      system: systemPrompt,
      messages,
      ...(options?.tools?.length ? { tools: options.tools } : {}),
    })
  );

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
    model: resolvedModel,
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
    onComplete?: (usage: { inputTokens: number; outputTokens: number; model: string }) => void;
  }
): AsyncGenerator<string> {
  // Screen user input before starting stream
  if (!options?.skipModeration) {
    const lastUserMsg = [...messages].reverse().find((m) => m.role === 'user');
    if (lastUserMsg) {
      await moderateOrThrow(lastUserMsg.content);
    }
  }

  // Per-request claude-code routing (admin-selected model via dropdown)
  if (options?.model?.startsWith('claude-code:')) {
    const { streamClaudeCode, serializeMessages } = await import('./claude-code-client');
    yield* streamClaudeCode(systemPrompt, serializeMessages(messages), {
      model: options.model.split(':')[1] || 'opus',
    });
    options?.onComplete?.({ inputTokens: 0, outputTokens: 0, model: options.model });
    return;
  }

  if (isClaudeCodeMode() && !options?.apiKeyOverride) {
    const { streamClaudeCode, serializeMessages } = await import('./claude-code-client');
    const ccModel = options?.model || process.env.CLAUDE_CODE_MODEL || 'opus';
    yield* streamClaudeCode(systemPrompt, serializeMessages(messages), {
      model: ccModel,
    });
    options?.onComplete?.({ inputTokens: 0, outputTokens: 0, model: ccModel });
    return;
  }

  const activeClient = options?.apiKeyOverride
    ? new Anthropic({ apiKey: options.apiKeyOverride })
    : client;

  if (!activeClient) {
    throw new Error('Claude client not initialized — set ANTHROPIC_API_KEY or provide apiKeyOverride');
  }

  const streamModel = options?.model || 'claude-sonnet-4-6';

  let yieldedAny = false;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const stream = activeClient.messages.stream({
        model: streamModel,
        max_tokens: options?.maxTokens || 4096,
        system: systemPrompt,
        messages,
        ...(options?.tools?.length ? { tools: options.tools } : {}),
      });

      for await (const event of stream) {
        if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
          yieldedAny = true;
          yield event.delta.text;
        }
      }

      if (options?.onComplete) {
        const finalMessage = await stream.finalMessage();
        options.onComplete({
          inputTokens: finalMessage.usage.input_tokens,
          outputTokens: finalMessage.usage.output_tokens,
          model: streamModel,
        });
      }
      return;
    } catch (err) {
      // Only retry if no content was yielded yet (safe to restart the stream)
      const isRetryable = !yieldedAny && isRetryableError(err);
      if (!isRetryable || attempt === MAX_RETRIES) throw err;
      const delayMs = 1000 * Math.pow(2, attempt) + Math.random() * 500;
      const status = (err as { status?: number }).status;
      logger.warn('streamResponse — Claude API transient error, retrying', {
        attempt: String(attempt + 1),
        status: String(status),
        delayMs: String(Math.round(delayMs)),
      });
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
}

