import type { AIProvider, AIOptions, AIResponse, ChatMessage, TextContentPart } from './ai';
import { executeCodex, streamCodex } from '../codex-client';
import { serializeMessages } from '../claude-code-client';

/** Extract plain text from ChatMessage content (string or ContentPart[]). */
function textOf(content: ChatMessage['content']): string {
  if (typeof content === 'string') return content;
  return content.filter((p) => p.type === 'text').map((p) => (p as TextContentPart).text).join('\n');
}

function reportedModelFor(model?: string): string {
  const selected = (model || process.env.CODEX_MODEL || '').trim();
  const bare = selected.startsWith('codex:') ? selected.slice('codex:'.length) : selected;
  return bare ? `codex:${bare}` : 'codex';
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
    const textMessages = messages.map((m) => ({ role: m.role, content: textOf(m.content) }));
    const result = await executeCodex(system, serializeMessages(textMessages), { model: opts?.model });
    return { ...result, model: reportedModelFor(opts?.model) };
  }

  async *streamResponse(
    system: string,
    messages: ChatMessage[],
    opts?: AIOptions
  ): AsyncGenerator<string> {
    const textMessages = messages.map((m) => ({ role: m.role, content: textOf(m.content) }));
    yield* streamCodex(system, serializeMessages(textMessages), { model: opts?.model });
  }
}
