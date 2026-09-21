import { abortable, interruptibleStream } from 'thesidedoor-core/runtime/stream';
import { providerCompatibleConnection } from 'thesidedoor-core/providers/catalog';
import { captureApiEndpoint, selectedApi } from '@/lib/providers/shared/api-selection';
import { moderateOrThrow, type ModerationPort } from '../moderation';
import type { TokenUsage } from 'thesidedoor-core/ai';
import { ProviderCleanupError } from 'thesidedoor-core/ai';
import { GenerationUsageError } from 'thesidedoor-core/ai/usage';
import {
  generateSharedApi,
  streamSharedApiWithRetry,
  type SharedApiSelection,
} from '@/lib/providers/shared/shared-api';
import { isReasoningModel, getAiProviderMeta } from './ai-registry';
import { logger } from '../logger';
import { withRetry } from '../retry';
import { getServerInfra, infra } from '../server-config';
import type { ProviderRequestRule } from 'thesidedoor-core/providers/transport';

/**
 * Minimum max_completion_tokens for reasoning models.
 * Reasoning models consume tokens internally for "thinking" before producing
 * visible output. A low budget (e.g. 2048) can be entirely consumed by
 * reasoning, leaving 0 visible bytes. 16384 gives ample room for reasoning
 * while keeping costs reasonable (you only pay for tokens actually generated).
 */
const REASONING_MODEL_MIN_TOKENS = 16384;

export interface TextContentPart {
  type: 'text';
  text: string;
}
export interface ImageContentPart {
  type: 'image_url';
  url: string;
}
export type ContentPart = TextContentPart | ImageContentPart;

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string | ContentPart[];
}

/** Extract plain text from message content for moderation. */
function textOf(content: string | ContentPart[]): string {
  if (typeof content === 'string') return content;
  return content
    .filter((p) => p.type === 'text')
    .map((p) => (p as TextContentPart).text)
    .join('\n');
}

export interface AIOptions {
  /** Captured request boundary for authorization and terminal-effect observation. */
  fetch?: typeof fetch;
  signal?: AbortSignal;
  onUsage?: (usage: TokenUsage) => void;
  maxTokens?: number;
  temperature?: number;
  model?: string;
  skipModeration?: boolean;
  moderation?: ModerationPort;
  apiKeyOverride?: string;
  /** Exact endpoint captured with the selected credential or keyless configuration. */
  endpoint?: string;
  /** Enable web search for this call. Each provider handles it natively. */
  useWebSearch?: boolean;
  /** Request structured JSON output conforming to a JSON Schema. Provider-mapped:
   *  Anthropic → output_config, OpenAI → response_format. */
  jsonSchema?: { name: string; schema: Record<string, unknown> };
}

export interface AIResponse extends TokenUsage {
  content: string;
  model: string;
}

export interface AIProvider {
  generateResponse(system: string, messages: ChatMessage[], opts?: AIOptions): Promise<AIResponse>;
  streamResponse(system: string, messages: ChatMessage[], opts?: AIOptions): AsyncGenerator<string>;
}

/** Bound every SDK request to the selected provider endpoint captured for this execution. */
export function aiProviderRules(
  provider: string,
  capturedEndpoint?: string
): readonly ProviderRequestRule[] {
  if (provider === 'claude-code' || provider === 'codex') return [];
  const endpoint = capturedEndpoint ?? captureApiEndpoint(provider);
  const base = new URL(endpoint);
  base.search = '';
  base.hash = '';
  if (!base.pathname.endsWith('/')) base.pathname += '/';
  return [{ method: 'POST', url: base.href, descendants: true, allowQuery: true }];
}

/**
 * Anthropic Claude provider — wraps the existing llm.ts client.
 */
class AnthropicProvider implements AIProvider {
  private getClient() {
    return import('../llm');
  }

  async generateResponse(
    system: string,
    messages: ChatMessage[],
    opts?: AIOptions
  ): Promise<AIResponse> {
    const claude = await this.getClient();
    const tools = opts?.useWebSearch ? [claude.WEB_SEARCH_TOOL] : undefined;
    return claude.generateResponse(system, messages, {
      fetch: opts?.fetch,
      signal: opts?.signal,
      onUsage: opts?.onUsage,
      temperature: opts?.temperature,
      maxTokens: opts?.maxTokens,
      model: opts?.model,
      apiKeyOverride: opts?.apiKeyOverride,
      endpoint: opts?.endpoint,
      skipModeration: opts?.skipModeration,
      moderation: opts?.moderation,
      ...(tools ? { tools } : {}),
      ...(opts?.jsonSchema ? { jsonSchema: opts.jsonSchema } : {}),
    });
  }

  streamResponse(
    system: string,
    messages: ChatMessage[],
    opts?: AIOptions
  ): AsyncGenerator<string> {
    const getClient = this.getClient.bind(this);
    return interruptibleStream(
      async function* (signal) {
        const claude = await getClient();
        const tools = opts?.useWebSearch ? [claude.WEB_SEARCH_TOOL] : undefined;
        yield* claude.streamResponse(system, messages, {
          signal,
          temperature: opts?.temperature,
          jsonSchema: opts?.jsonSchema,
          skipModeration: opts?.skipModeration,
          moderation: opts?.moderation,
          onComplete: (usage) => opts?.onUsage?.(usage),
          maxTokens: opts?.maxTokens,
          model: opts?.model,
          apiKeyOverride: opts?.apiKeyOverride,
          ...(tools ? { tools } : {}),
        });
      },
      { signal: opts?.signal, isCleanupError: (error) => error instanceof ProviderCleanupError }
    );
  }
}

/**
 * OpenAI provider — uses OpenAI SDK if configured.
 * Supports web search via the web_search_preview hosted tool.
 */
class OpenAIProvider implements AIProvider {
  private capture(opts?: AIOptions): { selection: SharedApiSelection; maxTokens: number } {
    const apiKey = opts?.apiKeyOverride;
    if (!apiKey) throw new Error('A captured OpenAI credential is required');
    const model = opts?.model;
    if (!model) throw new Error('A captured OpenAI model is required');
    const transport = opts?.useWebSearch ? 'responses' : 'compatible';
    const requested = opts?.maxTokens || 4096;
    return {
      selection: {
        ...selectedApi({
          provider: 'openai',
          label: 'OpenAI',
          transport,
          apiKey,
          endpoint: opts?.endpoint ?? captureApiEndpoint('openai'),
        }),
        model,
      },
      maxTokens:
        transport === 'compatible' && isReasoningModel(model)
          ? Math.max(requested, REASONING_MODEL_MIN_TOKENS)
          : requested,
    };
  }

  async generateResponse(
    system: string,
    messages: ChatMessage[],
    opts?: AIOptions
  ): Promise<AIResponse> {
    opts?.signal?.throwIfAborted();
    if (!opts?.skipModeration) {
      const lastUser = [...messages].reverse().find((message) => message.role === 'user');
      if (lastUser) await moderateOrThrow(textOf(lastUser.content), opts?.moderation, opts?.signal);
    }
    const { selection, maxTokens } = this.capture(opts);
    const result = await withRetry(
      '[OpenAI]',
      () =>
        generateSharedApi(selection, system, messages, {
          ...opts,
          maxTokens,
          onUsage: undefined,
        }),
      { signal: opts?.signal }
    );
    opts?.signal?.throwIfAborted();
    if (selection.transport === 'compatible' && !result.content && result.finishReason === 'length')
      throw emptyOpenAiResponse(selection.model, maxTokens, result);
    notifyApiUsage(result, opts);
    return result;
  }

  streamResponse(
    system: string,
    messages: ChatMessage[],
    opts?: AIOptions
  ): AsyncGenerator<string> {
    const capture = () => this.capture(opts);
    return interruptibleStream(
      async function* (signal) {
        if (!opts?.skipModeration) {
          const lastUser = [...messages].reverse().find((message) => message.role === 'user');
          if (lastUser) await moderateOrThrow(textOf(lastUser.content), opts?.moderation, signal);
        }
        const { selection, maxTokens } = capture();
        let yieldedAny = false;
        let finish: { reason: string; usage?: TokenUsage } | undefined;
        for await (const chunk of streamSharedApiWithRetry(
          '[OpenAI:stream]',
          selection,
          system,
          messages,
          {
            ...opts,
            signal,
            maxTokens,
            onFinish: (event) => {
              finish = event;
            },
          }
        )) {
          if (chunk) yieldedAny = true;
          yield chunk;
        }
        signal.throwIfAborted();
        if (selection.transport !== 'compatible' || yieldedAny) return;
        if (finish?.reason === 'length')
          throw emptyOpenAiResponse(
            selection.model,
            maxTokens,
            finish.usage ?? { inputTokens: null, outputTokens: null }
          );
        logger.warn('[OpenAI] Stream produced 0 visible bytes', {
          model: selection.model,
          finish_reason: finish?.reason ?? 'unknown',
          max_completion_tokens: String(maxTokens),
        });
      },
      { signal: opts?.signal, isCleanupError: (error) => error instanceof ProviderCleanupError }
    );
  }
}

function notifyApiUsage(usage: TokenUsage, opts?: AIOptions): void {
  opts?.onUsage?.({
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    cachedInputTokens: usage.cachedInputTokens,
    cacheWriteTokens: usage.cacheWriteTokens,
    reasoningTokens: usage.reasoningTokens,
  });
}

function emptyOpenAiResponse(
  model: string,
  maxTokens: number,
  usage: TokenUsage
): GenerationUsageError {
  logger.warn('[OpenAI] No visible output within the token budget', {
    model,
    max_completion_tokens: String(maxTokens),
    completion_tokens: String(usage.outputTokens ?? 'unknown'),
    reasoning_tokens: String(usage.reasoningTokens ?? 'unknown'),
  });
  return new GenerationUsageError(
    `OpenAI model "${model}" produced no visible output (finish_reason=length). Increase max_completion_tokens above ${maxTokens} or use a non-reasoning model.`,
    usage
  );
}

/** Product defaults and moderation for compatible API providers. */
class SharedCompatibleProvider implements AIProvider {
  constructor(
    private readonly label: string,
    private readonly capture: (opts?: AIOptions) => SharedApiSelection | Promise<SharedApiSelection>
  ) {}

  async generateResponse(
    system: string,
    messages: ChatMessage[],
    opts?: AIOptions
  ): Promise<AIResponse> {
    opts?.signal?.throwIfAborted();
    if (!opts?.skipModeration) {
      const lastUserMsg = [...messages].reverse().find((m) => m.role === 'user');
      if (lastUserMsg)
        await moderateOrThrow(textOf(lastUserMsg.content), opts?.moderation, opts?.signal);
    }
    const selection = await abortable(
      Promise.resolve(this.capture(opts)),
      opts?.signal ?? new AbortController().signal
    );
    reportCompatibleSearch(selection, opts);
    const result = await withRetry(
      `[${this.label}:ChatCompletions]`,
      () =>
        generateSharedApi(selection, system, messages, {
          ...opts,
          onUsage: undefined,
          useWebSearch: false,
          maxTokens: opts?.maxTokens || 4096,
        }),
      { signal: opts?.signal }
    );
    opts?.signal?.throwIfAborted();
    notifyApiUsage(result, opts);
    return result;
  }

  streamResponse(
    system: string,
    messages: ChatMessage[],
    opts?: AIOptions
  ): AsyncGenerator<string> {
    const capture = this.capture;
    const label = this.label;
    return interruptibleStream(
      async function* (signal) {
        if (!opts?.skipModeration) {
          const lastUserMsg = [...messages].reverse().find((m) => m.role === 'user');
          if (lastUserMsg)
            await moderateOrThrow(textOf(lastUserMsg.content), opts?.moderation, signal);
        }
        const selection = await abortable(Promise.resolve(capture(opts)), signal);
        signal.throwIfAborted();
        reportCompatibleSearch(selection, opts);
        yield* streamSharedApiWithRetry(
          `[${label}:ChatCompletions:stream]`,
          selection,
          system,
          messages,
          {
            ...opts,
            signal,
            useWebSearch: false,
            maxTokens: opts?.maxTokens || 4096,
          }
        );
      },
      { signal: opts?.signal, isCleanupError: (error) => error instanceof ProviderCleanupError }
    );
  }
}

function reportCompatibleSearch(selection: SharedApiSelection, opts?: AIOptions): void {
  if (opts?.useWebSearch)
    logger.warn('Hosted web search is unavailable for the selected compatible provider', {
      provider: selection.descriptor.id,
      model: selection.model,
    });
}

function compatibleSelection(
  id: string,
  label: string,
  apiKey: string,
  model: string,
  baseUrl: string
): SharedApiSelection {
  return {
    ...selectedApi({ provider: id, label, transport: 'compatible', apiKey, endpoint: baseUrl }),
    model,
  };
}

class GoogleProvider extends SharedCompatibleProvider {
  constructor() {
    super('Google', (opts) => {
      const apiKey = opts?.apiKeyOverride;
      if (!apiKey) throw new Error('A captured Google credential is required');
      return compatibleSelection(
        'google',
        'Google',
        apiKey,
        opts?.model || getAiProviderMeta('google').defaultModel,
        opts?.endpoint ?? captureApiEndpoint('google')
      );
    });
  }
}

class OpenAiCompatibleProvider extends SharedCompatibleProvider {
  constructor(cfg: { id: string; label: string; baseURL: string; defaultModel: string }) {
    super(cfg.label, (opts) => {
      const apiKey = opts?.apiKeyOverride;
      if (!apiKey) throw new Error(`A captured ${cfg.label} credential is required`);
      return compatibleSelection(
        cfg.id,
        cfg.label,
        apiKey,
        opts?.model || cfg.defaultModel,
        opts?.endpoint ?? cfg.baseURL
      );
    });
  }
}

// Endpoint and label per OpenAI-compatible LLM provider.
const OPENAI_COMPATIBLE_LABELS = {
  xai: 'xAI',
  deepseek: 'DeepSeek',
  mistral: 'Mistral',
  groq: 'Groq',
  nvidia: 'NVIDIA',
};

/**
 * Local provider — talks to any OpenAI-compatible local inference server
 * (Ollama, vLLM, LM Studio, llama.cpp server) via the OpenAI SDK with a
 * configurable baseURL. Keyless by design: local servers usually ignore the
 * API key, but the SDK requires a non-empty string, so we send the selected
 * credential or a non-secret local placeholder.
 *
 * The model is configured in Sotto and may arrive prefixed as "local:<model>"
 * from the llm.ts router or resolveAiModelAndProvider — strip it before sending.
 */
class LocalProvider extends SharedCompatibleProvider {
  constructor() {
    super('Local', async (opts) => {
      await getServerInfra();
      const baseUrl = infra('aiBaseUrl');
      if (!baseUrl)
        throw new Error(
          'No local AI base URL is saved. Point it at your OpenAI-compatible server, such as http://localhost:11434/v1 for Ollama.'
        );
      const raw = (opts?.model || infra('aiModel') || '').trim();
      const model = raw.startsWith('local:') ? raw.slice('local:'.length) : raw;
      if (!model)
        throw new Error(
          'No local AI model is saved. Choose a model served by your local server, such as "qwen3", "gemma3", or "llama3.3".'
        );
      const selection = compatibleSelection(
        'local',
        'Local',
        opts?.apiKeyOverride?.trim() || 'local',
        model,
        baseUrl
      );
      return { ...selection, descriptor: { ...selection.descriptor, transport: 'local' } };
    });
  }
}

class ClaudeCodeLazyProvider implements AIProvider {
  private async createProvider(): Promise<AIProvider> {
    const { ClaudeCodeProvider } = await import('./claude-code');
    return new ClaudeCodeProvider();
  }

  async generateResponse(
    system: string,
    messages: ChatMessage[],
    opts?: AIOptions
  ): Promise<AIResponse> {
    const provider = await this.createProvider();
    return provider.generateResponse(system, messages, opts);
  }

  streamResponse(
    system: string,
    messages: ChatMessage[],
    opts?: AIOptions
  ): AsyncGenerator<string> {
    const createProvider = this.createProvider.bind(this);
    let cleanupError: (error: unknown) => boolean = () => false;
    return interruptibleStream(
      async function* (signal) {
        const provider = await createProvider();
        cleanupError = (await import('../claude-code-client')).isClaudeCleanupError;
        yield* provider.streamResponse(system, messages, { ...opts, signal });
      },
      { signal: opts?.signal, isCleanupError: (error) => cleanupError(error) }
    );
  }
}

class CodexLazyProvider implements AIProvider {
  private async createProvider(): Promise<AIProvider> {
    const { CodexProvider } = await import('./codex');
    return new CodexProvider();
  }

  async generateResponse(
    system: string,
    messages: ChatMessage[],
    opts?: AIOptions
  ): Promise<AIResponse> {
    const provider = await this.createProvider();
    return provider.generateResponse(system, messages, opts);
  }

  streamResponse(
    system: string,
    messages: ChatMessage[],
    opts?: AIOptions
  ): AsyncGenerator<string> {
    const createProvider = this.createProvider.bind(this);
    let cleanupError: (error: unknown) => boolean = () => false;
    return interruptibleStream(
      async function* (signal) {
        const provider = await createProvider();
        cleanupError = (await import('../codex-client')).isCodexCleanupError;
        yield* provider.streamResponse(system, messages, { ...opts, signal });
      },
      { signal: opts?.signal, isCleanupError: (error) => cleanupError(error) }
    );
  }
}

export function createAIProvider(type: string): AIProvider {
  if (!type) {
    throw new Error(
      'AI provider type is required. Pass an explicit provider from the AI registry.'
    );
  }

  switch (type) {
    case 'anthropic':
      return new AnthropicProvider();
    case 'openai':
      return new OpenAIProvider();
    case 'google':
      return new GoogleProvider();
    case 'claude-code':
      return new ClaudeCodeLazyProvider();
    case 'codex':
      return new CodexLazyProvider();
    case 'local':
      return new LocalProvider();
    case 'xai':
    case 'deepseek':
    case 'mistral':
    case 'groq':
    case 'nvidia': {
      const cfg = providerCompatibleConnection(type);
      if (!cfg) throw new Error(`Missing compatible connection metadata for ${type}`);
      return new OpenAiCompatibleProvider({
        id: type,
        label: OPENAI_COMPATIBLE_LABELS[type],
        baseURL: cfg.baseURL,
        defaultModel: getAiProviderMeta(type).defaultModel,
      });
    }
    default:
      throw new Error(
        `Unknown AI provider type: "${type}". Registered providers: anthropic, openai, google, claude-code, codex, local, xai, deepseek, mistral, groq, nvidia`
      );
  }
}
