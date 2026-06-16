import type { AIProvider, AIOptions, AIResponse, ChatMessage, TextContentPart } from './ai';
import { serializeMessages } from '../agent-messages';
import { getAiProviderMeta } from './ai-registry';

/** Extract plain text from ChatMessage content (string or ContentPart[]). */
function textOf(content: ChatMessage['content']): string {
  if (typeof content === 'string') return content;
  return content.filter((p) => p.type === 'text').map((p) => (p as TextContentPart).text).join('\n');
}

function resolveClaudeCodeModel(model?: string): { cliModel: string; reportedModel: string } {
  const defaultModel = getAiProviderMeta('claude-code').defaultModel;
  const selected = model || process.env.CLAUDE_CODE_MODEL || defaultModel;
  const cliModel = selected.startsWith('claude-code:')
    ? selected.slice('claude-code:'.length) || defaultModel
    : selected;
  return { cliModel, reportedModel: `claude-code:${cliModel}` };
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
    const { cliModel, reportedModel } = resolveClaudeCodeModel(opts?.model);
    const textMessages = messages.map((m) => ({ role: m.role, content: textOf(m.content) }));
    const { executeClaudeCode } = await import('../claude-code-client');
    const result = await executeClaudeCode(system, serializeMessages(textMessages), {
      model: cliModel,
      useWebSearch: opts?.useWebSearch,
    });
    return { ...result, model: reportedModel };
  }

  async *streamResponse(
    system: string,
    messages: ChatMessage[],
    opts?: AIOptions
  ): AsyncGenerator<string> {
    const { cliModel } = resolveClaudeCodeModel(opts?.model);
    const textMessages = messages.map((m) => ({ role: m.role, content: textOf(m.content) }));
    const { streamClaudeCode } = await import('../claude-code-client');
    yield* streamClaudeCode(system, serializeMessages(textMessages), {
      model: cliModel,
      useWebSearch: opts?.useWebSearch,
    });
  }
}
