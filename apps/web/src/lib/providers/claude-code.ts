import type { AIProvider, AIOptions, AIResponse, ChatMessage, TextContentPart } from './ai';
import { serializeMessages } from '../agent-messages';
import { formatAgentModelId, parseAgentModelId } from '../agent-models/id';
import { getAiProviderMeta } from './ai-registry';

/** Extract plain text from ChatMessage content (string or ContentPart[]). */
function textOf(content: ChatMessage['content']): string {
  if (typeof content === 'string') return content;
  return content
    .filter((p) => p.type === 'text')
    .map((p) => (p as TextContentPart).text)
    .join('\n');
}

function resolveClaudeCodeModel(model?: string): {
  invocationModel: string;
  reportedModel: string;
} {
  const defaultModel = getAiProviderMeta('claude-code').defaultModel;
  const selected = model || process.env.CLAUDE_CODE_MODEL || defaultModel;
  const parsed = parseAgentModelId(selected, 'claude-code');
  const cliModel = parsed?.model || defaultModel;
  const invocationModel = formatAgentModelId('claude-code', cliModel, parsed?.effort);
  return {
    invocationModel,
    reportedModel: invocationModel,
  };
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
    const { invocationModel, reportedModel } = resolveClaudeCodeModel(opts?.model);
    const textMessages = messages.map((m) => ({ role: m.role, content: textOf(m.content) }));
    const { executeClaudeCode } = await import('../claude-code-client');
    const result = await executeClaudeCode(system, serializeMessages(textMessages), {
      model: invocationModel,
      useWebSearch: opts?.useWebSearch,
    });
    return { ...result, model: reportedModel };
  }

  async *streamResponse(
    system: string,
    messages: ChatMessage[],
    opts?: AIOptions
  ): AsyncGenerator<string> {
    const { invocationModel } = resolveClaudeCodeModel(opts?.model);
    const textMessages = messages.map((m) => ({ role: m.role, content: textOf(m.content) }));
    const { streamClaudeCode } = await import('../claude-code-client');
    yield* streamClaudeCode(system, serializeMessages(textMessages), {
      model: invocationModel,
      useWebSearch: opts?.useWebSearch,
    });
  }
}
