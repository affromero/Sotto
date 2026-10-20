// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { documentProvider } from '@/lib/providers/documents/provider';
import { prepareDocumentMessages } from '@/lib/providers/documents/pdf-input';
import { decodeCodexImages } from '@/lib/providers/agents/codex-images';
import type {
  AIProvider,
  ChatMessage,
  DocumentContentPart,
  ImageContentPart,
} from '@/lib/providers/ai';
import { originalPdf } from '../../helpers/learning/pdf';
import { createCanvas } from '@napi-rs/canvas';
import { ownedPdfCanvases } from '../../../scripts/pdf-render/canvas.mjs';
import { withPdfRender } from '@/lib/providers/documents/admission';
import sharp from 'sharp';
import { ProviderCleanupError } from 'thesidedoor-core/ai';

function document(pages = 2): DocumentContentPart {
  return {
    type: 'document',
    mediaType: 'application/pdf',
    name: 'Original lesson.pdf',
    data: originalPdf(pages),
  };
}
describe('original course PDF model input', () => {
  it.each(['codex', 'claude-code'])(
    'surfaces PDF workspace cleanup failures when returning a %s stream',
    async (provider) => {
      const failure = new ProviderCleanupError(true, {
        cause: new Error('Workspace removal unconfirmed'),
      });
      const delegate: AIProvider = {
        async generateResponse() {
          throw new Error('Unexpected generation');
        },
        async *streamResponse() {
          try {
            yield 'A2';
          } finally {
            throw failure;
          }
        },
      };
      const stream = documentProvider(provider, delegate).streamResponse('Assess.', []);
      expect(await stream.next()).toMatchObject({ value: 'A2', done: false });
      await expect(stream.return(undefined)).rejects.toBe(failure);
    }
  );
  it('bounds waiting conversions and keeps cancellation from admitting overlapping renders', async () => {
    let finish!: () => void;
    const held = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const output: string[] = [];
    const first = withPdfRender(async () => {
      output.push('first');
      await held;
      output.push('finished');
    });
    const controller = new AbortController();
    const canceled = withPdfRender(async () => {
      output.push('canceled');
    }, controller.signal);
    await expect(withPdfRender(async () => {})).rejects.toThrow('PDF rendering is busy');
    controller.abort(new Error('Stopped waiting'));
    await expect(canceled).rejects.toThrow('Stopped waiting');
    const last = withPdfRender(async () => {
      output.push('last');
    });
    expect(output).toEqual(['first']);
    finish();
    await Promise.all([first, last]);
    expect(output).toEqual(['first', 'finished', 'last']);
  });
  it('includes handwritten ink annotations in original page images', async () => {
    const pdf = { ...document(), data: originalPdf(1, { text: false, ink: true }) };
    const output = await prepareDocumentMessages('codex', [{ role: 'user', content: [pdf] }]);
    const parts = output[0]!.content;
    if (typeof parts === 'string') throw new Error('Expected visual content');
    const image = parts.find((part) => part.type === 'image_url')!;
    const { data } = await sharp(Buffer.from(image.url.split(',')[1]!, 'base64'))
      .extract({ left: 799, top: 639, width: 1, height: 1 })
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    expect(data[0]).toBeGreaterThan(180);
    expect(data[1]).toBeLessThan(80);
    expect(data[2]).toBeLessThan(80);
  });
  it('cancels document processing and permits a later original to complete', async () => {
    const controller = new AbortController();
    const work = prepareDocumentMessages(
      'codex',
      [{ role: 'user', content: [document(20)] }],
      controller.signal
    );
    const timer = setTimeout(() => controller.abort(new Error('Stopped PDF')), 5);
    try {
      await expect(work).rejects.toThrow();
    } finally {
      clearTimeout(timer);
    }
    const next = await prepareDocumentMessages('codex', [{ role: 'user', content: [document(1)] }]);
    const parts = next[0]!.content;
    if (typeof parts === 'string') throw new Error('Expected visual content');
    expect(parts.filter((part) => part.type === 'image_url')).toHaveLength(1);
  });
  it('releases page canvas memory without affecting a different parser', () => {
    const first = ownedPdfCanvases(createCanvas);
    const second = ownedPdfCanvases(createCanvas);
    const page = new first.CanvasFactory().create(1600, 1200);
    const other = new second.CanvasFactory().create(160, 120);
    const native = page.canvas!;
    page.context!.fillRect(0, 0, 80, 80);
    first.release();
    expect(page).toEqual({ canvas: null, context: null });
    expect(native.width * native.height).toBeLessThan((1600 * 1200) / 10);
    expect(other.canvas?.width).toBe(160);
    expect(other.canvas?.height).toBe(120);
    first.release();
    second.release();
    expect(other).toEqual({ canvas: null, context: null });
  });
  it.each(['anthropic', 'openai'])('keeps original bytes in native %s input', async (provider) => {
    const pdf = document();
    const output = await prepareDocumentMessages(provider, [{ role: 'user', content: [pdf] }]);
    expect(output).toEqual([{ role: 'user', content: [pdf] }]);
  });
  it('delivers every original page to Codex beyond the ordinary five-image limit', async () => {
    const output = await prepareDocumentMessages('codex', [
      { role: 'user', content: [document(6)] },
    ]);
    const parts = output[0]!.content;
    expect(typeof parts).not.toBe('string');
    if (typeof parts === 'string') throw new Error('Expected visual content');
    const images = parts.filter((part): part is ImageContentPart => part.type === 'image_url');
    expect(images.map((image) => image.documentPage)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(decodeCodexImages(images)).toHaveLength(6);
    for (const image of images) {
      const stats = await sharp(Buffer.from(image.url.split(',')[1]!, 'base64')).stats();
      expect(stats.channels.some((channel) => channel.min < 100 && channel.max > 240)).toBe(true);
    }
    const labels = parts.filter((part) => part.type === 'text').map((part) => part.text);
    expect(labels.some((label) => /Original lesson\.pdf.*page\s+6\s+of\s+6/i.test(label))).toBe(
      true
    );
  });
  it('rejects incomplete visual coverage instead of silently dropping pages', async () => {
    await expect(
      prepareDocumentMessages('codex', [{ role: 'user', content: [document(101)] }])
    ).rejects.toThrow('1 to 100 pages');
  });
  it('rejects extreme page proportions before allocating a rendering canvas', async () => {
    const pdf = { ...document(), data: originalPdf(1, { width: 1, height: 10000000 }) };
    await expect(
      prepareDocumentMessages('codex', [{ role: 'user', content: [pdf] }])
    ).rejects.toThrow('unsupported proportions');
  });
  it('keeps the existing five-image limit for ordinary attachments', () => {
    expect(() =>
      decodeCodexImages(
        Array.from({ length: 6 }, () => ({ type: 'image_url', url: 'data:image/png;base64,AQI=' }))
      )
    ).toThrow('at most 5');
  });
  it('does not publish a result after its original material is revoked during generation', async () => {
    let revoked = false;
    const sourceDocuments = {
      parts: [document()],
      validate: async () => {
        if (revoked) throw new Error('Original revoked');
      },
    };
    const delegate: AIProvider = {
      async generateResponse(_system, messages) {
        const parts = messages.at(-1)!.content;
        expect(parts).toContainEqual(sourceDocuments.parts[0]);
        revoked = true;
        return { content: 'A2', model: 'selected', inputTokens: 1, outputTokens: 1 };
      },
      async *streamResponse() {
        yield 'A2';
      },
    };
    await expect(
      documentProvider('openai', delegate).generateResponse('Assess.', [], { sourceDocuments })
    ).rejects.toThrow('Original revoked');
  });
  it('keeps complete originals on the selected stream transport', async () => {
    const pdf = document();
    let input: ChatMessage[] = [];
    const delegate: AIProvider = {
      async generateResponse() {
        throw new Error('Unexpected generation');
      },
      async *streamResponse(_system, messages) {
        input = messages;
        yield 'A2';
      },
    };
    const output = [];
    for await (const text of documentProvider('openai', delegate).streamResponse('Assess.', [], {
      sourceDocuments: { parts: [pdf], validate: async () => {} },
    }))
      output.push(text);
    expect(input.at(-1)!.content).toContainEqual(pdf);
    expect(output).toEqual(['A2']);
  });
});
