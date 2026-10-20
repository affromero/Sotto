import { constants } from 'node:fs';
import { open, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { z } from 'zod';
import { ProcessRunner, ProcessExecutionError } from 'thesidedoor-core/runtime/process';
import { withPdfWorkspace } from './workspace';
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

async function readRegular(path: string, maximum: number): Promise<Buffer> {
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const stat = await file.stat();
    if (!stat.isFile() || stat.size < 1 || stat.size > maximum)
      throw new Error('Invalid PDF rendering output.');
    const data = Buffer.alloc(stat.size);
    let offset = 0;
    while (offset < data.length) {
      const read = await file.read(data, offset, data.length - offset);
      if (!read.bytesRead) throw new Error('PDF rendering output was truncated.');
      offset += read.bytesRead;
    }
    if ((await file.read(Buffer.alloc(1))).bytesRead)
      throw new Error('PDF rendering output changed.');
    return data;
  } finally {
    await file.close();
  }
}

/** Reap the canonical process before reading output or releasing its workspace. */
export async function renderPdfImages(
  data: Uint8Array,
  options: {
    signal?: AbortSignal;
    onCleanupError?: (error: unknown) => void;
  } = {}
): Promise<string[]> {
  return withPdfWorkspace(async (directory) => {
    await writeFile(join(directory, 'original.pdf'), data, { flag: 'wx', mode: 0o600 });
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
          (await readRegular(join(directory, 'failure.json'), 4096)).toString()
        );
        message = z
          .object({ message: z.string().min(1).max(256) })
          .strict()
          .parse(failure).message;
      } catch {
        /* Confirmed child failure remains visible without an optional diagnostic. */
      }
      throw new Error(message, { cause: error });
    }
    options.signal?.throwIfAborted();
    const manifest = manifestSchema.parse(
      JSON.parse((await readRegular(join(directory, 'pages.json'), 65536)).toString())
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
      const jpeg = await readRegular(join(directory, image.file), image.bytes);
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
