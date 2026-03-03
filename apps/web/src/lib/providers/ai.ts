import { moderateOrThrow } from '../moderation';
import type { AiProviderId } from './ai-registry';

export interface TextContentPart { type: 'text'; text: string }
export interface ImageContentPart { type: 'image_url'; url: string }
export type ContentPart = TextContentPart | ImageContentPart;

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string | ContentPart[];
}

/** Extract plain text from message content for moderation. */
function textOf(content: string | ContentPart[]): string {
  if (typeof content === 'string') return content;
  return content.filter((p) => p.type === 'text').map((p) => (p as TextContentPart).text).join('\n');
}

/** Convert ChatMessage[] to OpenAI Chat Completions format (images → image_url). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toOpenAiMessages(system: string, messages: ChatMessage[]): any[] {
  return [
    { role: 'system', content: system },
    ...messages.map((m) => {
      if (typeof m.content === 'string') return { role: m.role, content: m.content };
      return {
        role: m.role,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        content: m.content.map((p): any =>
          p.type === 'text'
            ? { type: 'text', text: p.text }
            : { type: 'image_url', image_url: { url: p.url } }
        ),
      };
    }),
  ];
}

/** Convert ChatMessage[] to OpenAI Responses API format (input_text / input_image). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toResponsesInput(messages: ChatMessage[]): any[] {
  return messages.map((m) => {
    if (typeof m.content === 'string') return { role: m.role, content: m.content };
    return {
      role: m.role,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      content: m.content.map((p): any =>
        p.type === 'text'
          ? { type: 'input_text', text: p.text }
          : { type: 'input_image', image_url: p.url }
      ),
    };
  });
}

export interface AIOptions {
  maxTokens?: number;
  temperature?: number;
  model?: string;
  skipModeration?: boolean;
  apiKeyOverride?: string;
  /** Enable web search for this call. Each provider handles it natively. */
  useWebSearch?: boolean;
  /** Request structured JSON output conforming to a JSON Schema. Provider-mapped:
   *  Anthropic → output_config, OpenAI → response_format. */
  jsonSchema?: { name: string; schema: Record<string, unknown> };
}

export interface AIResponse {
  content: string;
  inputTokens: number;
  outputTokens: number;
  model: string;
}

export interface AIProvider {
  generateResponse(system: string, messages: ChatMessage[], opts?: AIOptions): Promise<AIResponse>;
  streamResponse(system: string, messages: ChatMessage[], opts?: AIOptions): AsyncGenerator<string>;
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
      maxTokens: opts?.maxTokens,
      model: opts?.model,
      apiKeyOverride: opts?.apiKeyOverride,
      skipModeration: opts?.skipModeration,
      ...(tools ? { tools } : {}),
      ...(opts?.jsonSchema ? { jsonSchema: opts.jsonSchema } : {}),
    });
  }

  async *streamResponse(
    system: string,
    messages: ChatMessage[],
    opts?: AIOptions
  ): AsyncGenerator<string> {
    const claude = await this.getClient();
    const tools = opts?.useWebSearch ? [claude.WEB_SEARCH_TOOL] : undefined;
    yield* claude.streamResponse(system, messages, {
      maxTokens: opts?.maxTokens,
      model: opts?.model,
      ...(tools ? { tools } : {}),
    });
  }
}

/**
 * OpenAI provider — uses OpenAI SDK if configured.
 * Supports web search via the web_search_preview hosted tool.
 */
class OpenAIProvider implements AIProvider {
  private async getClient(apiKeyOverride?: string) {
    const apiKey = apiKeyOverride || process.env.OPENAI_API_KEY;
    if (!apiKey) throw new Error('OPENAI_API_KEY is not set');
    const { default: OpenAI } = await import('openai');
    return new OpenAI({ apiKey });
  }

  async generateResponse(
    system: string,
    messages: ChatMessage[],
    opts?: AIOptions
  ): Promise<AIResponse> {
    if (!opts?.skipModeration) {
      const lastUserMsg = [...messages].reverse().find((m) => m.role === 'user');
      if (lastUserMsg) await moderateOrThrow(textOf(lastUserMsg.content));
    }

    const client = await this.getClient(opts?.apiKeyOverride);
    const model = opts?.model || process.env.OPENAI_MODEL;
    if (!model) throw new Error('No OpenAI model configured. Set OPENAI_MODEL or pass opts.model.');

    // web_search_preview requires the Responses API (not Chat Completions)
    if (opts?.useWebSearch) {
      // OpenAI SDK v6 exposes client.responses but types may lag — cast to access it
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const response = await (client as any).responses.create({
        model,
        instructions: system,
        input: toResponsesInput(messages),
        tools: [{ type: 'web_search_preview' }],
        max_output_tokens: opts?.maxTokens || 4096,
        temperature: opts?.temperature,
      });
      return {
        content: response.output_text || '',
        inputTokens: response.usage?.input_tokens || 0,
        outputTokens: response.usage?.output_tokens || 0,
        model,
      };
    }

    const response = await client.chat.completions.create({
      model,
      max_completion_tokens: opts?.maxTokens || 4096,
      temperature: opts?.temperature,
      messages: toOpenAiMessages(system, messages),
      ...(opts?.jsonSchema ? {
        response_format: {
          type: 'json_schema' as const,
          json_schema: { name: opts.jsonSchema.name, schema: opts.jsonSchema.schema, strict: true },
        },
      } : {}),
    });

    const content = response.choices[0]?.message?.content || '';
    return {
      content,
      inputTokens: response.usage?.prompt_tokens || 0,
      outputTokens: response.usage?.completion_tokens || 0,
      model,
    };
  }

  async *streamResponse(
    system: string,
    messages: ChatMessage[],
    opts?: AIOptions
  ): AsyncGenerator<string> {
    if (!opts?.skipModeration) {
      const lastUserMsg = [...messages].reverse().find((m) => m.role === 'user');
      if (lastUserMsg) await moderateOrThrow(textOf(lastUserMsg.content));
    }

    const client = await this.getClient(opts?.apiKeyOverride);
    const model = opts?.model || process.env.OPENAI_MODEL;
    if (!model) throw new Error('No OpenAI model configured. Set OPENAI_MODEL or pass opts.model.');

    // web_search_preview requires the Responses API (not Chat Completions)
    if (opts?.useWebSearch) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const stream = await (client as any).responses.create({
        model,
        instructions: system,
        input: toResponsesInput(messages),
        tools: [{ type: 'web_search_preview' }],
        max_output_tokens: opts?.maxTokens || 4096,
        temperature: opts?.temperature,
        stream: true,
      });
      for await (const event of stream) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        if ((event as any).type === 'response.output_text.delta') {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          yield (event as any).delta;
        }
      }
      return;
    }

    const stream = await client.chat.completions.create({
      model,
      max_completion_tokens: opts?.maxTokens || 4096,
      temperature: opts?.temperature,
      messages: toOpenAiMessages(system, messages),
      stream: true,
    });

    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta?.content;
      if (delta) yield delta;
    }
  }
}

/**
 * Google Gemini provider — uses OpenAI SDK with Google's OpenAI-compatible endpoint.
 * No new dependency required.
 */
class GoogleProvider implements AIProvider {
  private async getClient(apiKeyOverride?: string) {
    const apiKey = apiKeyOverride || process.env.GOOGLE_AI_API_KEY;
    if (!apiKey) throw new Error('GOOGLE_AI_API_KEY is not set');
    const { default: OpenAI } = await import('openai');
    return new OpenAI({
      apiKey,
      baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai/',
    });
  }

  async generateResponse(
    system: string,
    messages: ChatMessage[],
    opts?: AIOptions
  ): Promise<AIResponse> {
    if (!opts?.skipModeration) {
      const lastUserMsg = [...messages].reverse().find((m) => m.role === 'user');
      if (lastUserMsg) await moderateOrThrow(textOf(lastUserMsg.content));
    }

    const client = await this.getClient(opts?.apiKeyOverride);
    const model = opts?.model || process.env.GOOGLE_AI_MODEL || 'gemini-3.1-flash-lite-preview';

    const response = await client.chat.completions.create({
      model,
      max_completion_tokens: opts?.maxTokens || 4096,
      temperature: opts?.temperature,
      messages: toOpenAiMessages(system, messages),
      ...(opts?.jsonSchema ? {
        response_format: {
          type: 'json_schema' as const,
          json_schema: { name: opts.jsonSchema.name, schema: opts.jsonSchema.schema, strict: true },
        },
      } : {}),
    });

    const content = response.choices[0]?.message?.content || '';
    return {
      content,
      inputTokens: response.usage?.prompt_tokens || 0,
      outputTokens: response.usage?.completion_tokens || 0,
      model,
    };
  }

  async *streamResponse(
    system: string,
    messages: ChatMessage[],
    opts?: AIOptions
  ): AsyncGenerator<string> {
    if (!opts?.skipModeration) {
      const lastUserMsg = [...messages].reverse().find((m) => m.role === 'user');
      if (lastUserMsg) await moderateOrThrow(textOf(lastUserMsg.content));
    }

    const client = await this.getClient(opts?.apiKeyOverride);
    const model = opts?.model || process.env.GOOGLE_AI_MODEL || 'gemini-3.1-flash-lite-preview';

    const stream = await client.chat.completions.create({
      model,
      max_completion_tokens: opts?.maxTokens || 4096,
      temperature: opts?.temperature,
      messages: toOpenAiMessages(system, messages),
      stream: true,
    });

    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta?.content;
      if (delta) yield delta;
    }
  }
}

export function createAIProvider(type?: string): AIProvider {
  switch (type) {
    case 'anthropic':
    case undefined:          // getProviders() singleton — default to Anthropic
      return new AnthropicProvider();
    case 'openai':
      return new OpenAIProvider();
    case 'google':
      return new GoogleProvider();
    default:
      throw new Error(`Unknown AI provider type: "${type}". Registered providers: anthropic, openai, google`);
  }
}

export interface ResolvedAiProvider {
  provider: AiProviderId;
  source: 'byok' | 'platform';
  apiKey?: string;
  model?: string;
}

