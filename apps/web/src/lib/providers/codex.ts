import { interruptibleStream } from 'thesidedoor-core/runtime/stream';
import type {
  AIProvider,
  AIOptions,
  AIResponse,
  ChatMessage,
  TextContentPart,
  ImageContentPart,
} from './ai';
import { serializeMessages } from '../agent-messages';

/** Extract plain text from ChatMessage content (string or ContentPart[]). */
function textOf(content: ChatMessage['content']): string {
  if (typeof content === 'string') return content;
  return content
    .filter((p) => p.type === 'text')
    .map((p) => (p as TextContentPart).text)
    .join('\n');
}

function imagesOf(messages: ChatMessage[]): ImageContentPart[] {
  return messages.flatMap((message) =>
    typeof message.content === 'string'
      ? []
      : message.content.filter((part): part is ImageContentPart => part.type === 'image_url')
  );
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
    const images = imagesOf(messages);
    const { executeCodex } = await import('../codex-client');
    const result = await executeCodex(system, serializeMessages(textMessages), {
      signal: opts?.signal,
      onUsage: opts?.onUsage,
      model: opts?.model,
      useWebSearch: opts?.useWebSearch,
      jsonSchema: opts?.jsonSchema,
      ...(images.length ? { images } : {}),
      ...(opts?.isolated ? { isolated: opts.isolated } : {}),
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
        const textMessages = messages.map((m) => ({ role: m.role, content: textOf(m.content) }));
        const images = imagesOf(messages);
        const { streamCodex, isCodexCleanupError } = await import('../codex-client');
        cleanupError = isCodexCleanupError;
        yield* streamCodex(system, serializeMessages(textMessages), {
          signal,
          onUsage: opts?.onUsage,
          model: opts?.model,
          useWebSearch: opts?.useWebSearch,
          jsonSchema: opts?.jsonSchema,
          ...(images.length ? { images } : {}),
          ...(opts?.isolated ? { isolated: opts.isolated } : {}),
        });
      },
      { signal: opts?.signal, isCleanupError: (error) => cleanupError(error) }
    );
  }
}
