import Anthropic from '@anthropic-ai/sdk';
import { moderateOrThrow, moderateContent } from './moderation';
import { logger } from './logger';
import { withRetry, isRetryableError, MAX_RETRIES } from './retry';
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
    jsonSchema?: { name: string; schema: Record<string, unknown> };
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
    const { executeClaudeCode } = await import('./claude-code-client');
    const { serializeMessages } = await import('./agent-messages');
    const ccModel = options.model.split(':')[1] || 'opus';
    const hasWebSearch = options?.tools?.some((t) => (t as { type: string }).type === 'web_search_20250305');
    const textMessages = messages.map((m) => ({ role: m.role, content: extractText(m.content) }));
    const result = await executeClaudeCode(systemPrompt, serializeMessages(textMessages), {
      model: ccModel,
      useWebSearch: hasWebSearch,
    });
    return { ...result, model: options.model };
  }

  // Per-request codex routing (model "codex" or "codex:<model>")
  if (options?.model === 'codex' || options?.model?.startsWith('codex:')) {
    const { executeCodex } = await import('./codex-client');
    const { serializeMessages } = await import('./agent-messages');
    const textMessages = messages.map((m) => ({ role: m.role, content: extractText(m.content) }));
    const result = await executeCodex(systemPrompt, serializeMessages(textMessages), {
      model: options.model,
    });
    return { ...result, model: options.model };
  }

  // Per-request local routing (OpenAI-compatible local server, e.g. "local:qwen3").
  // Routed by prefix here so the registry guardrail below never sees the
  // host-defined model name.
  if (options?.model?.startsWith('local:')) {
    const { createAIProvider } = await import('./providers/ai');
    const ai = createAIProvider('local');
    const localModel = options.model.slice('local:'.length) || process.env.AI_MODEL || '';
    const result = await ai.generateResponse(systemPrompt, messages, {
      maxTokens: options?.maxTokens,
      model: localModel,
      skipModeration: options?.skipModeration,
      ...(options?.jsonSchema ? { jsonSchema: options.jsonSchema } : {}),
    });
    return { ...result, model: options.model };
  }

  const resolvedModel = options?.model;
  if (!resolvedModel) {
    throw new Error('AI model is required for generateResponse.');
  }

  // Guardrail: route explicitly selected non-Anthropic models to the correct provider.
  {
    const { getProviderForModel } = await import('./providers/ai-registry');
    const ownerProvider = getProviderForModel(resolvedModel);
    if (ownerProvider === null) {
      throw new Error(`Unknown AI model ID: "${resolvedModel}" — not registered with any provider`);
    }
    if (ownerProvider !== 'anthropic') {
      const { createAIProvider } = await import('./providers/ai');
      const ai = createAIProvider(ownerProvider);
      const hasWebSearch = options?.tools?.some(
        (t) => (t as { type: string }).type === 'web_search_20250305',
      );
      return ai.generateResponse(systemPrompt, messages, {
        maxTokens: options?.maxTokens,
        model: resolvedModel,
        apiKeyOverride: options?.apiKeyOverride,
        skipModeration: options?.skipModeration,
        ...(hasWebSearch ? { useWebSearch: true } : {}),
        ...(options?.jsonSchema ? { jsonSchema: options.jsonSchema } : {}),
      });
    }
  }

  const activeClient = options?.apiKeyOverride
    ? new Anthropic({ apiKey: options.apiKeyOverride })
    : client;

  if (!activeClient) {
    throw new Error('LLM client not initialized — set ANTHROPIC_API_KEY or provide apiKeyOverride');
  }

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
      ...(options?.jsonSchema ? {
        output_config: {
          format: { type: 'json_schema' as const, schema: options.jsonSchema.schema },
        },
      } : {}),
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
 * Stream a response from Claude.
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
    const { streamClaudeCode } = await import('./claude-code-client');
    const { serializeMessages } = await import('./agent-messages');
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

  // Per-request codex routing (model "codex" or "codex:<model>")
  if (options?.model === 'codex' || options?.model?.startsWith('codex:')) {
    const { streamCodex } = await import('./codex-client');
    const { serializeMessages } = await import('./agent-messages');
    const textMessages = messages.map((m) => ({ role: m.role, content: extractText(m.content) }));
    yield* streamCodex(systemPrompt, serializeMessages(textMessages), { model: options.model });
    options?.onComplete?.({ inputTokens: 0, outputTokens: 0, model: options.model });
    return;
  }

  // Per-request local routing (OpenAI-compatible local server, e.g. "local:qwen3").
  if (options?.model?.startsWith('local:')) {
    const { createAIProvider } = await import('./providers/ai');
    const ai = createAIProvider('local');
    const localModel = options.model.slice('local:'.length) || process.env.AI_MODEL || '';
    yield* ai.streamResponse(systemPrompt, messages, {
      maxTokens: options?.maxTokens,
      model: localModel,
      skipModeration: options?.skipModeration,
    });
    options?.onComplete?.({ inputTokens: 0, outputTokens: 0, model: options.model });
    return;
  }

  const streamModel = options?.model;
  if (!streamModel) {
    throw new Error('AI model is required for streamResponse.');
  }

  // Guardrail: route explicitly selected non-Anthropic models to the correct provider.
  {
    const { getProviderForModel } = await import('./providers/ai-registry');
    const ownerProvider = getProviderForModel(streamModel);
    if (ownerProvider === null) {
      throw new Error(`Unknown AI model ID: "${streamModel}" — not registered with any provider`);
    }
    if (ownerProvider !== 'anthropic') {
      const { createAIProvider } = await import('./providers/ai');
      const ai = createAIProvider(ownerProvider);
      const hasWebSearch = options?.tools?.some(
        (t) => (t as { type: string }).type === 'web_search_20250305',
      );
      yield* ai.streamResponse(systemPrompt, messages, {
        maxTokens: options?.maxTokens,
        model: streamModel,
        apiKeyOverride: options?.apiKeyOverride,
        skipModeration: options?.skipModeration,
        ...(hasWebSearch ? { useWebSearch: true } : {}),
      });
      // Non-Anthropic providers don't report token usage in their stream,
      // but fire onComplete so callers at least get the model name logged.
      options?.onComplete?.({ inputTokens: 0, outputTokens: 0, model: streamModel });
      return;
    }
  }

  const activeClient = options?.apiKeyOverride
    ? new Anthropic({ apiKey: options.apiKeyOverride })
    : client;

  if (!activeClient) {
    throw new Error('LLM client not initialized — set ANTHROPIC_API_KEY or provide apiKeyOverride');
  }

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
