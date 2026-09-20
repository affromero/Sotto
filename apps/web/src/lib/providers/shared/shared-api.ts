import {
  ProviderCleanupError,
  type CredentialValues,
  type GenerationEvent,
  type GenerationRequest,
  type ProviderDescriptor,
  type TokenUsage,
  type ToolDefinition,
  type WebSearchOptions,
} from 'thesidedoor-core/ai';
import { createSelectedApiRegistry, type SelectedApi } from 'thesidedoor-core/ai/providers';
import { interruptibleStream } from 'thesidedoor-core/runtime/stream';
import type { ChatMessage } from '@/lib/providers/ai';
import { withRetry } from '@/lib/retry';

export interface SharedApiSelection {
  descriptor: ProviderDescriptor;
  transport: 'compatible' | 'responses' | 'anthropic';
  credentials: CredentialValues;
  model: string;
  baseUrl?: string;
  requiresKey?: boolean;
  webSearchType?: 'web_search' | 'web_search_preview';
  textSeparator?: string;
}

export interface SharedApiOptions {
  fetch?: typeof fetch;
  webSearch?: WebSearchOptions;
  tools?: readonly ToolDefinition[];
  signal?: AbortSignal;
  maxTokens: number;
  temperature?: number;
  useWebSearch?: boolean;
  jsonSchema?: { name: string; schema: Record<string, unknown> };
  onUsage?: (usage: TokenUsage) => void;
  onFinish?: (finish: Extract<GenerationEvent, { type: 'finish' }>) => void;
}

/** One attempt against one captured selection. Callers own product policy and retries. */
export function sharedApiEvents(
  selection: SharedApiSelection,
  system: string,
  messages: ChatMessage[],
  options: SharedApiOptions,
  streaming: boolean
): AsyncGenerator<GenerationEvent> {
  const descriptor = selection.descriptor;
  const captured: SelectedApi =
    selection.transport === 'anthropic'
      ? { transport: 'anthropic', descriptor, credentials: selection.credentials }
      : selection.transport === 'responses'
        ? {
            transport: 'responses',
            descriptor,
            credentials: selection.credentials,
            webSearchType: selection.webSearchType,
            baseUrl: selection.baseUrl,
          }
        : {
            transport: 'compatible',
            descriptor,
            credentials: selection.credentials,
            baseUrl: selection.baseUrl ?? 'https://api.openai.com/v1',
            requiresKey: selection.requiresKey ?? true,
          };
  const registry = createSelectedApiRegistry(captured, {
    fetch: options.fetch,
    streaming,
    maxRetries: selection.transport === 'anthropic' ? 2 : 0,
    timeoutMode: selection.transport === 'anthropic' ? 'provider' : 'request',
    anthropic: { webSearchMaxUses: null },
    compatible: {
      normalizeV1: false,
      maxTokensParameter: 'max_completion_tokens',
      assistantImages: true,
    },
  });
  const request: GenerationRequest = {
    provider: descriptor.id,
    model: selection.model,
    messages: [
      { role: 'system', content: [{ type: 'text', text: system }] },
      ...messages.map((message) => ({
        role: message.role,
        content:
          typeof message.content === 'string'
            ? [{ type: 'text' as const, text: message.content }]
            : message.content.map((part) => ({ ...part })),
      })),
    ],
    maxOutputTokens: options.maxTokens,
    temperature: options.temperature,
    schema: options.jsonSchema?.schema,
    schemaName: options.jsonSchema?.name,
    tools: options.tools,
    allowWeb: options.useWebSearch,
    webSearch: options.webSearch,
    signal: options.signal,
    ...(selection.transport === 'anthropic' ? {} : { timeoutMs: 600_000 }),
    maxOutputBytes: Number.MAX_SAFE_INTEGER,
  };
  return registry.generate(request);
}

export async function generateSharedApi(
  selection: SharedApiSelection,
  system: string,
  messages: ChatMessage[],
  options: SharedApiOptions
): Promise<
  TokenUsage & {
    content: string;
    model: string;
    finishReason: 'complete' | 'length' | 'tool_calls';
  }
> {
  const textBlocks: string[] = [];
  let usage: TokenUsage = { inputTokens: null, outputTokens: null };
  let finishReason: 'complete' | 'length' | 'tool_calls' = 'complete';
  for await (const event of sharedApiEvents(selection, system, messages, options, false)) {
    if (event.type === 'text') textBlocks.push(event.text);
    if (event.type === 'finish') {
      finishReason = event.reason;
      usage = { ...(event.usage ?? usage) };
      options.onUsage?.({ ...usage });
      options.onFinish?.({ ...event, usage: { ...usage } });
    }
  }
  return {
    content: textBlocks.join(selection.textSeparator ?? ''),
    model: selection.model,
    finishReason,
    ...usage,
  };
}

export function streamSharedApi(
  selection: SharedApiSelection,
  system: string,
  messages: ChatMessage[],
  options: SharedApiOptions
): AsyncGenerator<string> {
  return interruptibleStream(
    async function* (signal) {
      for await (const event of sharedApiEvents(
        selection,
        system,
        messages,
        { ...options, signal },
        true
      )) {
        if (event.type === 'text') yield event.text;
        if (event.type === 'finish') {
          const usage = { ...(event.usage ?? { inputTokens: null, outputTokens: null }) };
          options.onUsage?.({ ...usage });
          options.onFinish?.({ ...event, usage });
        }
      }
    },
    { signal: options.signal, isCleanupError: (error) => error instanceof ProviderCleanupError }
  );
}

/** Retry opening a stream, then retain the same attempt once text has escaped. */
export function streamSharedApiWithRetry(
  label: string,
  selection: SharedApiSelection,
  system: string,
  messages: ChatMessage[],
  options: SharedApiOptions
): AsyncGenerator<string> {
  return interruptibleStream(
    async function* (signal) {
      let opening = true;
      const callbacks: Array<() => void> = [];
      const notify = (callback: () => void) => {
        if (opening) callbacks.push(callback);
        else callback();
      };
      const opened = await withRetry(
        label,
        async () => {
          const source = streamSharedApi(selection, system, messages, {
            ...options,
            signal,
            onUsage: (usage) => notify(() => options.onUsage?.(usage)),
            onFinish: (finish) => notify(() => options.onFinish?.(finish)),
          });
          try {
            return { source, first: await source.next() };
          } catch (error) {
            callbacks.length = 0;
            await closeApiStream(source, error);
            throw error;
          }
        },
        { signal }
      );
      opening = false;
      let primary: unknown;
      try {
        signal.throwIfAborted();
        for (const callback of callbacks) callback();
        if (opened.first.done) return;
        yield opened.first.value;
        yield* opened.source;
      } catch (error) {
        primary = error;
        throw error;
      } finally {
        await closeApiStream(opened.source, primary);
      }
    },
    { signal: options.signal, isCleanupError: (error) => error instanceof ProviderCleanupError }
  );
}

async function closeApiStream(source: AsyncGenerator<string>, primary?: unknown): Promise<void> {
  try {
    await source.return(undefined);
  } catch (cleanup) {
    if (primary !== undefined && primary !== cleanup) {
      throw new AggregateError([primary, cleanup], 'API generation and cleanup failed', {
        cause: primary,
      });
    }
    throw cleanup;
  }
}
