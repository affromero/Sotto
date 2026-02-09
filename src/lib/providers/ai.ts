import { logger } from '../logger';

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface AIOptions {
  maxTokens?: number;
  temperature?: number;
  model?: string;
}

export interface AIResponse {
  content: string;
  inputTokens: number;
  outputTokens: number;
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
  private async getClient() {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) throw new Error('OPENAI_API_KEY is not set');
    const { default: OpenAI } = await import('openai');
    return new OpenAI({ apiKey });
  }

  async generateResponse(
    system: string,
    messages: ChatMessage[],
    opts?: AIOptions
  ): Promise<AIResponse> {
    const client = await this.getClient();
    const model = opts?.model || process.env.OPENAI_MODEL || 'gpt-4o';

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
    };
  }

  async *streamResponse(
    system: string,
    messages: ChatMessage[],
    opts?: AIOptions
  ): AsyncGenerator<string> {
    const client = await this.getClient();
    const model = opts?.model || process.env.OPENAI_MODEL || 'gpt-4o';

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
    return executeClaudeCode(system, serializeMessages(messages), {
      model: opts?.model || process.env.CLAUDE_CODE_MODEL || 'haiku',
      maxTokens: opts?.maxTokens,
    });
  }

  async *streamResponse(
    system: string,
    messages: ChatMessage[],
    opts?: AIOptions
  ): AsyncGenerator<string> {
    const { streamClaudeCode, serializeMessages } = await this.getClient();
    yield* streamClaudeCode(system, serializeMessages(messages), {
      model: opts?.model || process.env.CLAUDE_CODE_MODEL || 'haiku',
      maxTokens: opts?.maxTokens,
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
    case 'claude-code':
      return new ClaudeCodeLazyProvider();
    default:
      logger.warn(`Unknown AI_PROVIDER "${providerType}", falling back to anthropic`);
      return new AnthropicProvider();
  }
}
