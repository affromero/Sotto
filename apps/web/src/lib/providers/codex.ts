import type { AIProvider, AIOptions, AIResponse, ChatMessage, TextContentPart } from './ai';
import { serializeMessages } from '../agent-messages';
import { formatAgentModelId, parseAgentModelId } from '../agent-models/id';

/** Extract plain text from ChatMessage content (string or ContentPart[]). */
function textOf(content: ChatMessage['content']): string {
  if (typeof content === 'string') return content;
  return content
    .filter((p) => p.type === 'text')
    .map((p) => (p as TextContentPart).text)
    .join('\n');
}

function rejectImages(messages: ChatMessage[]): void {
  if (
    messages.some(
      (message) =>
        Array.isArray(message.content) && message.content.some((part) => part.type !== 'text')
    )
  ) {
    throw new Error("Codex CLI image input is not supported by Sotto's current transport.");
  }
}

function reportedModelFor(model?: string): string {
  const selected = model && model !== 'codex' ? model : process.env.CODEX_MODEL;
  const parsed = parseAgentModelId(selected, 'codex');
  return formatAgentModelId('codex', parsed?.model ?? null, parsed?.effort);
}

/**
 * Codex CLI provider — routes AI calls through `codex exec` (read-only sandbox).
 * Selected by prefixing the model name with "codex:", e.g. "codex:gpt-5-codex";
 * with no model it uses the model configured in the user's Codex setup.
 */
export class CodexProvider implements AIProvider {
  async generateResponse(
    system: string,
    messages: ChatMessage[],
    opts?: AIOptions
  ): Promise<AIResponse> {
    rejectImages(messages);
    const textMessages = messages.map((m) => ({ role: m.role, content: textOf(m.content) }));
    const { executeCodex } = await import('../codex-client');
    const result = await executeCodex(system, serializeMessages(textMessages), {
      model: opts?.model,
      useWebSearch: opts?.useWebSearch,
    });
    return { ...result, model: reportedModelFor(opts?.model) };
  }

  async *streamResponse(
    system: string,
    messages: ChatMessage[],
    opts?: AIOptions
  ): AsyncGenerator<string> {
    rejectImages(messages);
    const textMessages = messages.map((m) => ({ role: m.role, content: textOf(m.content) }));
    const { streamCodex } = await import('../codex-client');
    yield* streamCodex(system, serializeMessages(textMessages), {
      model: opts?.model,
      useWebSearch: opts?.useWebSearch,
    });
  }
}
