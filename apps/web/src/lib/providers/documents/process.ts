import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { z } from 'zod';
import { ProcessRunner, ProcessExecutionError } from 'thesidedoor-core/runtime/process';
import { isJobExecutionCleanupFailure } from 'thesidedoor-core/runtime/outbox';
import { copyOwnedBytesToFile } from 'thesidedoor-core/storage';
import { withPdfWorkspace } from './workspace';
import { readBoundedRegularFile } from './files';
import type { renderPdfFile } from '../../../../scripts/pdf-render/render-worker.mjs';

const runner = new ProcessRunner(1);
const manifestSchema: z.ZodType<Awaited<ReturnType<typeof renderPdfFile>>> = z
  .object({
    pages: z.number().int().min(1).max(100),
    images: z
      .array(
        z
          .object({
            file: z.string(),
            bytes: z
              .number()
              .int()
              .positive()
              .max(20 * 1024 * 1024),
            sha256: z.string().regex(/^[a-f0-9]{64}$/),
          })
          .strict()
      )
      .min(1)
      .max(100),
  })
  .strict();

/** Reap the canonical process before reading output or releasing its workspace. */
export async function renderPdfImages(
  data: Uint8Array,
  options: {
    signal?: AbortSignal;
    onCleanupError?: (error: unknown) => void;
  } = {}
): Promise<string[]> {
  return withPdfWorkspace(async (directory) => {
    await copyOwnedBytesToFile({
      destination: join(directory, 'original.pdf'),
      signal: options.signal,
      openSource: async () => {
        let offset = 0;
        return {
          read: async () => {
            if (offset === data.length) return null;
            const start = offset;
            offset = Math.min(data.length, offset + 65536);
            return data.subarray(start, offset);
          },
          close: async () => {
            offset = data.length;
          },
        };
      },
    });
    try {
      await runner.execute({
        command: '/bin/sh',
        args: [
          '-c',
          'ulimit -c 0 || exit 125\nexec "$@"',
          'sotto-pdf-render',
          process.execPath,
          '--max-old-space-size=64',
          join(process.cwd(), 'scripts/pdf-render/render-worker.mjs'),
          directory,
        ],
        environment: { PATH: '/usr/local/bin:/usr/bin:/bin', NODE_ENV: 'production' },
        cwd: process.cwd(),
        keepInputOpen: true,
        signal: options.signal,
        timeoutMs: 180000,
        maxOutputBytes: 1024 * 1024,
      });
    } catch (error) {
      if (!(error instanceof ProcessExecutionError) || error.code === 'cleanup_failed') throw error;
      let message =
        'The original PDF could not be rendered. Split the document or check its format.';
      try {
        const failure: unknown = JSON.parse(
          (
            await readBoundedRegularFile(join(directory, 'failure.json'), { maximum: 4096 })
          ).toString()
        );
        message = z
          .object({ message: z.string().min(1).max(256) })
          .strict()
          .parse(failure).message;
      } catch (diagnosticError) {
        if (isJobExecutionCleanupFailure(diagnosticError)) throw diagnosticError;
        /* Confirmed child failure remains visible without an optional diagnostic. */
      }
      throw new Error(message, { cause: error });
    }
    options.signal?.throwIfAborted();
    const manifest = manifestSchema.parse(
      JSON.parse(
        (await readBoundedRegularFile(join(directory, 'pages.json'), { maximum: 65536 })).toString()
      )
    );
    if (manifest.images.length !== manifest.pages)
      throw new Error('Original PDF page coverage is incomplete.');
    const images: string[] = [];
    let bytes = 0;
    for (const [index, image] of manifest.images.entries()) {
      if (image.file !== `page-${index + 1}.jpg`)
        throw new Error('Original PDF page order changed.');
      bytes += image.bytes;
      if (bytes > 20 * 1024 * 1024) throw new Error('Original PDF page images exceed 20 MB.');
      const jpeg = await readBoundedRegularFile(join(directory, image.file), {
        maximum: image.bytes,
        expectedBytes: image.bytes,
      });
      if (
        jpeg.length !== image.bytes ||
        createHash('sha256').update(jpeg).digest('hex') !== image.sha256
      )
        throw new Error('An original PDF page image changed.');
      images.push(`data:image/jpeg;base64,${jpeg.toString('base64')}`);
    }
    return images;
  }, options);
}
