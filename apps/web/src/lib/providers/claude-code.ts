import type { AIProvider, AIOptions, AIResponse, ChatMessage } from './ai';
import { executeClaudeCode, streamClaudeCode, serializeMessages } from '../claude-code-client';

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
    const ccModel = opts?.model || process.env.CLAUDE_CODE_MODEL || 'opus';
    const result = await executeClaudeCode(system, serializeMessages(messages), {
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
    yield* streamClaudeCode(system, serializeMessages(messages), {
      model: opts?.model || process.env.CLAUDE_CODE_MODEL || 'opus',
      useWebSearch: opts?.useWebSearch,
    });
  }
}
