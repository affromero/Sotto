import type Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import type { TokenUsage } from 'thesidedoor-core/ai';
import { ProviderCleanupError } from 'thesidedoor-core/ai';
import { interruptibleStream } from 'thesidedoor-core/runtime/stream';
import { moderateOrThrow, moderateContent, type ModerationPort } from './moderation';
import { logger } from './logger';
import { withRetry } from './retry';
import {
  generateSharedApi,
  streamSharedApiWithRetry,
  type SharedApiSelection,
} from '@/lib/providers/shared/shared-api';
import type { ContentPart } from './providers/ai';
import { captureApiEndpoint, selectedApi } from '@/lib/providers/shared/api-selection';

type LlmContent = string | ContentPart[];

/** Extract plain text from content (string or ContentPart[]). */
function extractText(content: LlmContent): string {
  if (typeof content === 'string') return content;
  return content
    .filter((p) => p.type === 'text')
    .map((p) => (p as { text: string }).text)
    .join('\n');
}

function anthropicSelection(
  model: string,
  override?: string,
  endpoint?: string
): SharedApiSelection {
  const apiKey = override;
  if (!apiKey) throw new Error('A captured Anthropic credential is required');
  const baseUrl = endpoint ?? captureApiEndpoint('anthropic');
  return {
    ...selectedApi({
      provider: 'anthropic',
      label: 'Anthropic',
      transport: 'anthropic',
      apiKey,
      endpoint: baseUrl,
    }),
    model,
    textSeparator: '\n\n',
  };
}

const anthropicToolSchema = z.union([
  z
    .object({
      type: z.literal('web_search_20250305'),
      name: z.literal('web_search'),
      allowed_domains: z.array(z.string()).nullable().optional(),
      blocked_domains: z.array(z.string()).nullable().optional(),
      max_uses: z.number().nullable().optional(),
      user_location: z
        .object({
          type: z.literal('approximate'),
          city: z.string().nullable().optional(),
          country: z.string().nullable().optional(),
          region: z.string().nullable().optional(),
          timezone: z.string().nullable().optional(),
        })
        .strict()
        .nullable()
        .optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal('custom').optional(),
      name: z.string().min(1),
      description: z.string().optional(),
      input_schema: z.record(z.string(), z.unknown()),
    })
    .strict(),
]);
function sharedTools(tools?: Anthropic.MessageCreateParams['tools']) {
  const parsed = z.array(anthropicToolSchema).parse(tools ?? []);
  const search = parsed.find((tool) => tool.type === 'web_search_20250305');
  if (parsed.filter((tool) => tool.type === 'web_search_20250305').length > 1)
    throw new Error('Only one web search tool may be configured');
  return {
    useWebSearch: search !== undefined,
    webSearch: search
      ? {
          allowedDomains: search.allowed_domains,
          blockedDomains: search.blocked_domains,
          maxUses: search.max_uses,
          userLocation: search.user_location,
        }
      : undefined,
    tools: parsed.flatMap((tool) =>
      'input_schema' in tool
        ? [{ name: tool.name, description: tool.description ?? '', schema: tool.input_schema }]
        : []
    ),
  };
}

export const WEB_SEARCH_TOOL = {
  type: 'web_search_20250305' as const,
  name: 'web_search' as const,
};

function assertRoutedTools(tools?: Anthropic.MessageCreateParams['tools']) {
  const mapped = sharedTools(tools);
  if (
    mapped.tools.length ||
    Object.values(mapped.webSearch ?? {}).some((value) => value !== undefined)
  )
    throw new Error('The selected provider cannot preserve these Anthropic tool settings');
}

/**
 * Generate a non-streaming response from Claude.
 * When apiKeyOverride is provided, creates a fresh client with that key
 * instead of using the module-level client (for BYOK users).
 */
export async function generateResponse(
  systemPrompt: string,
  messages: Array<{ role: 'user' | 'assistant'; content: LlmContent }>,
  options?: {
    fetch?: typeof fetch;
    signal?: AbortSignal;
    onUsage?: (usage: TokenUsage) => void;
    temperature?: number;
    maxTokens?: number;
    model?: string;
    apiKeyOverride?: string;
    endpoint?: string;
    tools?: Anthropic.MessageCreateParams['tools'];
    skipModeration?: boolean;
    moderation?: ModerationPort;
    jsonSchema?: { name: string; schema: Record<string, unknown> };
  }
): Promise<TokenUsage & { content: string; model: string }> {
  options?.signal?.throwIfAborted();
  // Screen user input before sending to LLM
  if (!options?.skipModeration) {
    const lastUserMsg = [...messages].reverse().find((m) => m.role === 'user');
    if (lastUserMsg) {
      await moderateOrThrow(extractText(lastUserMsg.content), options?.moderation, options?.signal);
    }
  }

  // Per-request claude-code routing (model selected via dropdown, e.g. "claude-code:opus")
  if (options?.model?.startsWith('claude-code:')) {
    assertRoutedTools(options.tools);
    const { executeClaudeCode } = await import('./claude-code-client');
    const { serializeMessages } = await import('./agent-messages');
    const hasWebSearch = options?.tools?.some(
      (t) => (t as { type: string }).type === 'web_search_20250305'
    );
    const textMessages = messages.map((m) => ({ role: m.role, content: extractText(m.content) }));
    const result = await executeClaudeCode(systemPrompt, serializeMessages(textMessages), {
      signal: options.signal,
      onUsage: options.onUsage,
      model: options.model,
      useWebSearch: hasWebSearch,
    });
    return { ...result, model: options.model };
  }

  // Per-request codex routing (model "codex" or "codex:<model>")
  if (options?.model === 'codex' || options?.model?.startsWith('codex:')) {
    assertRoutedTools(options.tools);
    const { executeCodex } = await import('./codex-client');
    const { serializeMessages } = await import('./agent-messages');
    const textMessages = messages.map((m) => ({ role: m.role, content: extractText(m.content) }));
    const result = await executeCodex(systemPrompt, serializeMessages(textMessages), {
      signal: options.signal,
      onUsage: options.onUsage,
      model: options.model,
    });
    return result;
  }

  // Per-request local routing (OpenAI-compatible local server, e.g. "local:qwen3").
  // Routed by prefix here so the registry guardrail below never sees the
  // host-defined model name.
  if (options?.model?.startsWith('local:')) {
    assertRoutedTools(options.tools);
    const { createAIProvider } = await import('./providers/ai');
    const ai = createAIProvider('local');
    const localModel = options.model.slice('local:'.length);
    if (!localModel) throw new Error('Local AI model is required');
    const result = await ai.generateResponse(systemPrompt, messages, {
      fetch: options.fetch,
      signal: options.signal,
      onUsage: options.onUsage,
      temperature: options.temperature,
      maxTokens: options?.maxTokens,
      model: localModel,
      skipModeration: options?.skipModeration,
      moderation: options?.moderation,
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
      assertRoutedTools(options?.tools);
      const { createAIProvider } = await import('./providers/ai');
      const ai = createAIProvider(ownerProvider);
      const hasWebSearch = options?.tools?.some(
        (t) => (t as { type: string }).type === 'web_search_20250305'
      );
      return ai.generateResponse(systemPrompt, messages, {
        fetch: options?.fetch,
        signal: options?.signal,
        onUsage: options?.onUsage,
        temperature: options?.temperature,
        maxTokens: options?.maxTokens,
        model: resolvedModel,
        apiKeyOverride: options?.apiKeyOverride,
        skipModeration: options?.skipModeration,
        moderation: options?.moderation,
        ...(hasWebSearch ? { useWebSearch: true } : {}),
        ...(options?.jsonSchema ? { jsonSchema: options.jsonSchema } : {}),
      });
    }
  }

  const selection = anthropicSelection(resolvedModel, options?.apiKeyOverride, options?.endpoint);
  const toolOptions = sharedTools(options?.tools);
  const response = await withRetry(
    'generateResponse',
    () =>
      generateSharedApi(selection, systemPrompt, messages, {
        fetch: options?.fetch,
        signal: options?.signal,
        maxTokens: options?.maxTokens || 4096,
        temperature: options?.temperature,
        jsonSchema: options?.jsonSchema,
        ...toolOptions,
      }),
    { signal: options?.signal }
  );
  options?.signal?.throwIfAborted();
  const content = response.content;
  const usage: TokenUsage = {
    inputTokens: response.inputTokens,
    outputTokens: response.outputTokens,
    cachedInputTokens: response.cachedInputTokens,
    cacheWriteTokens: response.cacheWriteTokens,
    reasoningTokens: response.reasoningTokens,
  };
  options?.onUsage?.({ ...usage });

  // Record flagged output without hiding provider failures. Educational content may
  // discuss sensitive topics, so the input policy remains the blocking boundary.
  if (!options?.skipModeration && content) {
    const result = await moderateContent(content, options.moderation, options.signal);
    if (result.flagged) {
      logger.warn('LLM output flagged by moderation', {
        categories: result.blockedCategories.join(','),
      });
    }
  }

  return {
    content,
    ...usage,
    model: resolvedModel,
  };
}

/**
 * Stream a response from Claude.
 * When apiKeyOverride is provided, creates a fresh client with that key.
 */
export function streamResponse(
  systemPrompt: string,
  messages: Array<{ role: 'user' | 'assistant'; content: LlmContent }>,
  options?: Parameters<typeof streamResponseRaw>[2]
): AsyncGenerator<string> {
  let cleanupError: (error: unknown) => boolean = (error) => error instanceof ProviderCleanupError;
  return interruptibleStream(
    async function* (signal) {
      if (options?.model === 'codex' || options?.model?.startsWith('codex:'))
        cleanupError = (await import('./codex-client')).isCodexCleanupError;
      if (options?.model?.startsWith('claude-code:'))
        cleanupError = (await import('./claude-code-client')).isClaudeCleanupError;
      yield* streamResponseRaw(systemPrompt, messages, { ...options, signal });
    },
    { signal: options?.signal, isCleanupError: (error) => cleanupError(error) }
  );
}

async function* streamResponseRaw(
  systemPrompt: string,
  messages: Array<{ role: 'user' | 'assistant'; content: LlmContent }>,
  options?: {
    signal?: AbortSignal;
    maxTokens?: number;
    model?: string;
    apiKeyOverride?: string;
    endpoint?: string;
    tools?: Anthropic.MessageCreateParams['tools'];
    skipModeration?: boolean;
    moderation?: ModerationPort;
    onComplete?: (usage: TokenUsage & { model: string }) => void;
    temperature?: number;
    jsonSchema?: { name: string; schema: Record<string, unknown> };
  }
): AsyncGenerator<string> {
  options?.signal?.throwIfAborted();
  // Screen user input before starting stream
  if (!options?.skipModeration) {
    const lastUserMsg = [...messages].reverse().find((m) => m.role === 'user');
    if (lastUserMsg) {
      await moderateOrThrow(extractText(lastUserMsg.content), options?.moderation, options?.signal);
    }
  }

  // Per-request claude-code routing (model selected via dropdown, e.g. "claude-code:opus")
  if (options?.model?.startsWith('claude-code:')) {
    assertRoutedTools(options.tools);
    const { streamClaudeCode } = await import('./claude-code-client');
    const { serializeMessages } = await import('./agent-messages');
    const hasWebSearch = options?.tools?.some(
      (t) => (t as { type: string }).type === 'web_search_20250305'
    );
    const textMessages = messages.map((m) => ({ role: m.role, content: extractText(m.content) }));
    let usage: TokenUsage = { inputTokens: null, outputTokens: null };
    yield* streamClaudeCode(systemPrompt, serializeMessages(textMessages), {
      signal: options.signal,
      model: options.model,
      useWebSearch: hasWebSearch,
      onUsage: (value) => {
        usage = value;
      },
    });
    options?.onComplete?.({ ...usage, model: options.model });
    return;
  }

  // Per-request codex routing (model "codex" or "codex:<model>")
  if (options?.model === 'codex' || options?.model?.startsWith('codex:')) {
    assertRoutedTools(options.tools);
    const { streamCodex } = await import('./codex-client');
    const { serializeMessages } = await import('./agent-messages');
    const textMessages = messages.map((m) => ({ role: m.role, content: extractText(m.content) }));
    let usage: TokenUsage & { model: string } = {
      inputTokens: null,
      outputTokens: null,
      model: options.model,
    };
    yield* streamCodex(systemPrompt, serializeMessages(textMessages), {
      signal: options.signal,
      model: options.model,
      onUsage: (value) => {
        usage = { ...value };
      },
    });
    options?.onComplete?.({ ...usage });
    return;
  }

  // Per-request local routing (OpenAI-compatible local server, e.g. "local:qwen3").
  if (options?.model?.startsWith('local:')) {
    assertRoutedTools(options.tools);
    const { createAIProvider } = await import('./providers/ai');
    const ai = createAIProvider('local');
    const localModel = options.model.slice('local:'.length);
    if (!localModel) throw new Error('Local AI model is required');
    yield* ai.streamResponse(systemPrompt, messages, {
      signal: options.signal,
      temperature: options.temperature,
      jsonSchema: options.jsonSchema,
      onUsage: (usage) => options.onComplete?.({ ...usage, model: options.model! }),
      maxTokens: options?.maxTokens,
      model: localModel,
      skipModeration: options?.skipModeration,
      moderation: options?.moderation,
    });
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
      assertRoutedTools(options?.tools);
      const { createAIProvider } = await import('./providers/ai');
      const ai = createAIProvider(ownerProvider);
      const hasWebSearch = options?.tools?.some(
        (t) => (t as { type: string }).type === 'web_search_20250305'
      );
      yield* ai.streamResponse(systemPrompt, messages, {
        signal: options?.signal,
        temperature: options?.temperature,
        jsonSchema: options?.jsonSchema,
        onUsage: (usage) => options?.onComplete?.({ ...usage, model: streamModel }),
        maxTokens: options?.maxTokens,
        model: streamModel,
        apiKeyOverride: options?.apiKeyOverride,
        skipModeration: options?.skipModeration,
        moderation: options?.moderation,
        ...(hasWebSearch ? { useWebSearch: true } : {}),
      });
      return;
    }
  }

  const selection = anthropicSelection(streamModel, options?.apiKeyOverride, options?.endpoint);
  yield* streamSharedApiWithRetry('streamResponse', selection, systemPrompt, messages, {
    temperature: options?.temperature,
    jsonSchema: options?.jsonSchema,
    signal: options?.signal,
    maxTokens: options?.maxTokens || 4096,
    ...sharedTools(options?.tools),
    onUsage: (usage) => options?.onComplete?.({ ...usage, model: streamModel }),
  });
}
