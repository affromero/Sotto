import type { AIProvider, AIOptions, AIResponse, ChatMessage, TextContentPart } from './ai';
import { executeClaudeCode, streamClaudeCode, serializeMessages } from '../claude-code-client';
import { getAiProviderMeta } from './ai-registry';

/** Extract plain text from ChatMessage content (string or ContentPart[]). */
function textOf(content: ChatMessage['content']): string {
  if (typeof content === 'string') return content;
  return content.filter((p) => p.type === 'text').map((p) => (p as TextContentPart).text).join('\n');
}

/**
 * Claude Code CLI provider — routes AI calls through `claude -p`.
 * Selected by prefixing the model name with "claude-code:", e.g. "claude-code:opus".
 */
export class ClaudeCodeProvider implements AIProvider {
  async generateResponse(
    system: string,
    messages: ChatMessage[],
    opts?: AIOptions
  ): Promise<AIResponse> {
    const ccModel = opts?.model || process.env.CLAUDE_CODE_MODEL || getAiProviderMeta('claude-code').defaultModel;
    const textMessages = messages.map((m) => ({ role: m.role, content: textOf(m.content) }));
    const result = await executeClaudeCode(system, serializeMessages(textMessages), {
      model: ccModel,
      useWebSearch: opts?.useWebSearch,
    });
    return { ...result, model: ccModel };
  }

  async *streamResponse(
    system: string,
    messages: ChatMessage[],
    opts?: AIOptions
  ): AsyncGenerator<string> {
    const textMessages = messages.map((m) => ({ role: m.role, content: textOf(m.content) }));
    yield* streamClaudeCode(system, serializeMessages(textMessages), {
      model: opts?.model || process.env.CLAUDE_CODE_MODEL || getAiProviderMeta('claude-code').defaultModel,
      useWebSearch: opts?.useWebSearch,
    });
  }
}
