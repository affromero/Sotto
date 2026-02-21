import { moderateOrThrow } from '../moderation';
import { logger } from '../logger';
import { getAiKey, hasAiKey } from '../byok';
import type { AiProviderId } from './ai-registry';

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface AIOptions {
  maxTokens?: number;
  temperature?: number;
  model?: string;
  skipModeration?: boolean;
  apiKeyOverride?: string;
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
 * Anthropic Claude provider — wraps the existing claude.ts client.
 */
class AnthropicProvider implements AIProvider {
  private getClient() {
    // Dynamic import to avoid loading SDK when not selected
    return import('../claude');
  }

  async generateResponse(
    system: string,
    messages: ChatMessage[],
    opts?: AIOptions
  ): Promise<AIResponse> {
    const claude = await this.getClient();
    return claude.generateResponse(system, messages, {
      maxTokens: opts?.maxTokens,
      model: opts?.model,
      apiKeyOverride: opts?.apiKeyOverride,
      skipModeration: opts?.skipModeration,
    });
  }

  async *streamResponse(
    system: string,
    messages: ChatMessage[],
    opts?: AIOptions
  ): AsyncGenerator<string> {
    const claude = await this.getClient();
    yield* claude.streamResponse(system, messages, {
      maxTokens: opts?.maxTokens,
      model: opts?.model,
    });
  }
}

/**
 * OpenAI provider — uses OpenAI SDK if configured.
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
      if (lastUserMsg) await moderateOrThrow(lastUserMsg.content);
    }

    const client = await this.getClient(opts?.apiKeyOverride);
    const model = opts?.model || process.env.OPENAI_MODEL || 'gpt-4o';

    const response = await client.chat.completions.create({
      model,
      max_completion_tokens: opts?.maxTokens || 4096,
      temperature: opts?.temperature,
      messages: [{ role: 'system', content: system }, ...messages],
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
      if (lastUserMsg) await moderateOrThrow(lastUserMsg.content);
    }

    const client = await this.getClient(opts?.apiKeyOverride);
    const model = opts?.model || process.env.OPENAI_MODEL || 'gpt-4o';

    const stream = await client.chat.completions.create({
      model,
      max_completion_tokens: opts?.maxTokens || 4096,
      temperature: opts?.temperature,
      messages: [{ role: 'system', content: system }, ...messages],
      stream: true,
    });

    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta?.content;
      if (delta) yield delta;
    }
  }
}

/**
 * Groq provider — fast hosted inference for open-source LLMs.
 * Uses OpenAI-compatible API at api.groq.com.
 */
class GroqProvider implements AIProvider {
  private async getClient(apiKeyOverride?: string) {
    const apiKey = apiKeyOverride || process.env.GROQ_API_KEY;
    if (!apiKey) throw new Error('GROQ_API_KEY is not set');
    const { default: OpenAI } = await import('openai');
    return new OpenAI({ baseURL: 'https://api.groq.com/openai/v1', apiKey } as ConstructorParameters<typeof OpenAI>[0]);
  }

  async generateResponse(
    system: string,
    messages: ChatMessage[],
    opts?: AIOptions
  ): Promise<AIResponse> {
    if (!opts?.skipModeration) {
      const lastUserMsg = [...messages].reverse().find((m) => m.role === 'user');
      if (lastUserMsg) await moderateOrThrow(lastUserMsg.content);
    }

    const client = await this.getClient(opts?.apiKeyOverride);
    const model = opts?.model || process.env.GROQ_MODEL || 'llama-3.1-8b-instant';

    const response = await client.chat.completions.create({
      model,
      max_tokens: opts?.maxTokens || 4096,
      temperature: opts?.temperature,
      messages: [{ role: 'system', content: system }, ...messages],
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
      if (lastUserMsg) await moderateOrThrow(lastUserMsg.content);
    }

    const client = await this.getClient(opts?.apiKeyOverride);
    const model = opts?.model || process.env.GROQ_MODEL || 'llama-3.1-8b-instant';

    const stream = await client.chat.completions.create({
      model,
      max_tokens: opts?.maxTokens || 4096,
      temperature: opts?.temperature,
      messages: [{ role: 'system', content: system }, ...messages],
      stream: true,
    });

    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta?.content;
      if (delta) yield delta;
    }
  }
}

/**
 * Claude Code CLI provider — uses `claude -p` for free local testing.
 */
class ClaudeCodeLazyProvider implements AIProvider {
  private getClient() {
    return import('../claude-code-client');
  }

  async generateResponse(
    system: string,
    messages: ChatMessage[],
    opts?: AIOptions
  ): Promise<AIResponse> {
    const { executeClaudeCode, serializeMessages } = await this.getClient();
    const ccModel = opts?.model || process.env.CLAUDE_CODE_MODEL || 'opus';
    const result = await executeClaudeCode(system, serializeMessages(messages), {
      model: ccModel,
    });
    return { ...result, model: ccModel };
  }

  async *streamResponse(
    system: string,
    messages: ChatMessage[],
    opts?: AIOptions
  ): AsyncGenerator<string> {
    const { streamClaudeCode, serializeMessages } = await this.getClient();
    yield* streamClaudeCode(system, serializeMessages(messages), {
      model: opts?.model || process.env.CLAUDE_CODE_MODEL || 'opus',
    });
  }
}

export function createAIProvider(type?: string): AIProvider {
  const providerType = type || process.env.AI_PROVIDER || 'anthropic';
  switch (providerType) {
    case 'anthropic':
      return new AnthropicProvider();
    case 'openai':
      return new OpenAIProvider();
    case 'groq':
      return new GroqProvider();
    case 'claude-code':
      return new ClaudeCodeLazyProvider();
    default:
      logger.warn(`Unknown AI_PROVIDER "${providerType}", falling back to anthropic`);
      return new AnthropicProvider();
  }
}

export interface ResolvedAiProvider {
  provider: AiProviderId;
  source: 'byok' | 'platform' | 'claude-code';
  apiKey?: string;
  model?: string;
}

/**
 * Resolve which AI provider + key to use for a given user.
 *
 * Priority:
 * 1. User BYOK key → their chosen provider
 * 2. Platform Groq key + user plan:
 *    - PRO → llama-3.3-70b-versatile
 *    - FREE → llama-3.1-8b-instant
 * 3. Platform Anthropic / OpenAI keys (legacy fallback)
 * 4. Dev mode: claude-code
 */
export async function resolveAiProvider(
  userId: string,
  plan?: 'FREE' | 'PRO'
): Promise<ResolvedAiProvider> {
  // 1. Check user BYOK key
  const userKey = await getAiKey(userId);
  if (userKey) {
    return { provider: userKey.provider, source: 'byok', apiKey: userKey.apiKey };
  }

  // 2. Groq platform key (primary platform LLM)
  if (process.env.GROQ_API_KEY) {
    const model =
      plan === 'PRO' ? 'llama-3.3-70b-versatile' : 'llama-3.1-8b-instant';
    return { provider: 'groq', source: 'platform', model };
  }

  // 3. Legacy platform keys
  if (process.env.ANTHROPIC_API_KEY) {
    return { provider: 'anthropic', source: 'platform' };
  }
  if (process.env.OPENAI_API_KEY) {
    return { provider: 'openai', source: 'platform' };
  }

  // 4. Dev mode: claude-code
  if (process.env.AI_PROVIDER === 'claude-code') {
    return { provider: 'anthropic', source: 'claude-code' };
  }

  throw new Error('No AI provider available. Configure an API key in settings.');
}

/**
 * Check if AI can be resolved for a user without throwing.
 */
export async function canResolveAi(userId: string): Promise<boolean> {
  if (await hasAiKey(userId)) return true;
  if (process.env.GROQ_API_KEY) return true;
  if (process.env.ANTHROPIC_API_KEY) return true;
  if (process.env.OPENAI_API_KEY) return true;
  if (process.env.AI_PROVIDER === 'claude-code') return true;
  return false;
}
