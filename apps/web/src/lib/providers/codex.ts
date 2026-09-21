import { interruptibleStream } from 'thesidedoor-core/runtime/stream';
import type { AIProvider, AIOptions, AIResponse, ChatMessage, TextContentPart } from './ai';
import { serializeMessages } from '../agent-messages';

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
      signal: opts?.signal,
      onUsage: opts?.onUsage,
      model: opts?.model,
      useWebSearch: opts?.useWebSearch,
    });
    return result;
  }

  streamResponse(
    system: string,
    messages: ChatMessage[],
    opts?: AIOptions
  ): AsyncGenerator<string> {
    let cleanupError: (error: unknown) => boolean = () => false;
    return interruptibleStream(
      async function* (signal) {
        rejectImages(messages);
        const textMessages = messages.map((m) => ({ role: m.role, content: textOf(m.content) }));
        const { streamCodex, isCodexCleanupError } = await import('../codex-client');
        cleanupError = isCodexCleanupError;
        yield* streamCodex(system, serializeMessages(textMessages), {
          signal,
          onUsage: opts?.onUsage,
          model: opts?.model,
          useWebSearch: opts?.useWebSearch,
        });
      },
      { signal: opts?.signal, isCleanupError: (error) => cleanupError(error) }
    );
  }
}
