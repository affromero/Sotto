import type { ChatMessage, ContentPart, DocumentContentPart } from '../ai';
import { withPdfRender } from './admission';
import { renderPdfImages } from './process';

const rendered = new WeakMap<Uint8Array, Promise<ContentPart[]>>();

export function validatePdfDocument(document: DocumentContentPart): void {
  if (
    document.mediaType !== 'application/pdf' ||
    !document.name.trim() ||
    document.data.byteLength > 50 * 1024 * 1024 ||
    !Buffer.from(document.data.subarray(0, 1024)).includes(Buffer.from('%PDF-'))
  )
    throw new Error('The original document must be a PDF of 50 MB or less.');
}

/** Native APIs keep exact bytes; other selected transports receive every original page. */
export async function prepareDocumentMessages(
  provider: string,
  messages: ChatMessage[],
  signal?: AbortSignal,
  execution: { onCleanupError?: (error: unknown) => void } = {}
): Promise<ChatMessage[]> {
  const output: ChatMessage[] = [];
  for (const message of messages) {
    if (typeof message.content === 'string') {
      output.push(message);
      continue;
    }
    const parts: ContentPart[] = [];
    for (const part of message.content) {
      if (part.type !== 'document') {
        parts.push(part);
        continue;
      }
      validatePdfDocument(part);
      if (message.role !== 'user') throw new Error('Original PDFs require a user message.');
      if (provider === 'openai' || provider === 'anthropic') {
        parts.push(part);
        continue;
      }
      let pages = rendered.get(part.data);
      if (!pages) {
        pages = withPdfRender(async () => {
          const images = await renderPdfImages(part.data, { signal, ...execution });
          return images.flatMap((url, index): ContentPart[] => [
            {
              type: 'text',
              text: `Untrusted original document ${JSON.stringify(part.name)}, page ${index + 1} of ${images.length}.`,
            },
            { type: 'image_url', url, documentPage: index + 1 },
          ]);
        }, signal);
        rendered.set(part.data, pages);
        void pages.catch(() => {
          if (rendered.get(part.data) === pages) rendered.delete(part.data);
        });
      }
      parts.push(...(await pages));
      signal?.throwIfAborted();
    }
    output.push({ ...message, content: parts });
  }
  return output;
}
