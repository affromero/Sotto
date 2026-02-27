import Anthropic from '@anthropic-ai/sdk';
import { moderateOrThrow, moderateContent } from './moderation';
import { logger } from './logger';
import type { ContentPart } from './providers/ai';

type LlmContent = string | ContentPart[];

/** Extract plain text from content (string or ContentPart[]). */
function extractText(content: LlmContent): string {
  if (typeof content === 'string') return content;
  return content.filter((p) => p.type === 'text').map((p) => (p as { text: string }).text).join('\n');
}

/** Convert ContentPart[] to Anthropic's ContentBlockParam[]. */
function toAnthropicContent(content: LlmContent): string | Anthropic.Messages.ContentBlockParam[] {
  if (typeof content === 'string') return content;
  return content.map((part) => {
    if (part.type === 'text') return { type: 'text' as const, text: part.text };
    return { type: 'image' as const, source: { type: 'url' as const, url: part.url } };
  });
}

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

if (!ANTHROPIC_API_KEY) {
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
  messages: Array<{ role: 'user' | 'assistant'; content: LlmContent }>,
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
      await moderateOrThrow(extractText(lastUserMsg.content));
    }
  }

  // Per-request claude-code routing (model selected via dropdown, e.g. "claude-code:opus")
  if (options?.model?.startsWith('claude-code:')) {
    const { executeClaudeCode, serializeMessages } = await import('./claude-code-client');
    const ccModel = options.model.split(':')[1] || 'opus';
    const hasWebSearch = options?.tools?.some((t) => (t as { type: string }).type === 'web_search_20250305');
    const textMessages = messages.map((m) => ({ role: m.role, content: extractText(m.content) }));
    const result = await executeClaudeCode(systemPrompt, serializeMessages(textMessages), {
      model: ccModel,
      useWebSearch: hasWebSearch,
    });
    return { ...result, model: options.model };
  }

  // Guardrail: auto-route non-Anthropic models to the correct provider.
  // Prevents e.g. 'gpt-5-mini' being sent to the Anthropic API.
  if (options?.model) {
    const { getProviderForModel } = await import('./providers/ai-registry');
    const ownerProvider = getProviderForModel(options.model);
    if (ownerProvider && ownerProvider !== 'anthropic') {
      const { createAIProvider } = await import('./providers/ai');
      const ai = createAIProvider(ownerProvider);
      return ai.generateResponse(systemPrompt, messages, {
        maxTokens: options.maxTokens,
        model: options.model,
        apiKeyOverride: options.apiKeyOverride,
        skipModeration: options.skipModeration,
      });
    }
  }

  const activeClient = options?.apiKeyOverride
    ? new Anthropic({ apiKey: options.apiKeyOverride })
    : client;

  if (!activeClient) {
    throw new Error('LLM client not initialized — set ANTHROPIC_API_KEY or provide apiKeyOverride');
  }

  const { resolveAutoModel } = await import('./auto-model-config');
  const autoConfig = await resolveAutoModel('PLATFORM');
  const resolvedModel = options?.model || autoConfig.aiModel;

  const anthropicMessages = messages.map((m) => ({
    role: m.role,
    content: toAnthropicContent(m.content),
  }));

  const response = await withRetry('generateResponse', () =>
    activeClient.messages.create({
      model: resolvedModel,
      max_tokens: options?.maxTokens || 4096,
      system: systemPrompt,
      messages: anthropicMessages,
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
    }).catch((err) => {
      logger.warn('Output moderation check failed', { error: err instanceof Error ? err.message : String(err) });
    });
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
  messages: Array<{ role: 'user' | 'assistant'; content: LlmContent }>,
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
      await moderateOrThrow(extractText(lastUserMsg.content));
    }
  }

  // Per-request claude-code routing (model selected via dropdown, e.g. "claude-code:opus")
  if (options?.model?.startsWith('claude-code:')) {
    const { streamClaudeCode, serializeMessages } = await import('./claude-code-client');
    const ccModel = options.model.split(':')[1] || 'opus';
    const hasWebSearch = options?.tools?.some((t) => (t as { type: string }).type === 'web_search_20250305');
    const textMessages = messages.map((m) => ({ role: m.role, content: extractText(m.content) }));
    yield* streamClaudeCode(systemPrompt, serializeMessages(textMessages), {
      model: ccModel,
      useWebSearch: hasWebSearch,
    });
    options?.onComplete?.({ inputTokens: 0, outputTokens: 0, model: options.model });
    return;
  }

  // Guardrail: auto-route non-Anthropic models to the correct provider.
  if (options?.model) {
    const { getProviderForModel } = await import('./providers/ai-registry');
    const ownerProvider = getProviderForModel(options.model);
    if (ownerProvider && ownerProvider !== 'anthropic') {
      const { createAIProvider } = await import('./providers/ai');
      const ai = createAIProvider(ownerProvider);
      yield* ai.streamResponse(systemPrompt, messages, {
        maxTokens: options.maxTokens,
        model: options.model,
        apiKeyOverride: options.apiKeyOverride,
        skipModeration: options.skipModeration,
      });
      return;
    }
  }

  const activeClient = options?.apiKeyOverride
    ? new Anthropic({ apiKey: options.apiKeyOverride })
    : client;

  if (!activeClient) {
    throw new Error('LLM client not initialized — set ANTHROPIC_API_KEY or provide apiKeyOverride');
  }

  const { resolveAutoModel } = await import('./auto-model-config');
  const autoConfig = await resolveAutoModel('PLATFORM');
  const streamModel = options?.model || autoConfig.aiModel;

  const anthropicMessages = messages.map((m) => ({
    role: m.role,
    content: toAnthropicContent(m.content),
  }));

  let yieldedAny = false;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const stream = activeClient.messages.stream({
        model: streamModel,
        max_tokens: options?.maxTokens || 4096,
        system: systemPrompt,
        messages: anthropicMessages,
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

