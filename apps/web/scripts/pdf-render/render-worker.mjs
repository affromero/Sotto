// @ts-check
import { createHash } from 'node:crypto';
import { open, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { pdfRuntime } from './runtime.mjs';

/** Render complete originals through PDF.js in a separately bounded process.
 * @param {string} directory @param {AbortSignal} signal */
export async function renderPdfFile(directory, signal) {
  const original = await readFile(join(directory, 'original.pdf'));
  const images = [];
  let total;
  let bytes = 0;
  for (let page = 1; total === undefined || page <= total; page++) {
    signal.throwIfAborted();
    const { assets, options, canvases } = pdfRuntime(original);
    const pdfjs = /** @type {typeof import('pdfjs-dist/legacy/build/pdf.mjs')} */ (
      await import(pathToFileURL(join(assets, 'legacy/build/pdf.mjs')).href)
    );
    const loading = pdfjs.getDocument(options);
    /** @type {Promise<void> | undefined} */
    let destruction;
    const abort = () => {
      destruction ??= loading.destroy();
      void destruction.catch(() => {});
    };
    signal.addEventListener('abort', abort, { once: true });
    try {
      signal.throwIfAborted();
      const pdf = await loading.promise;
      total = pdf.numPages;
      if (total < 1 || total > 100)
        throw new Error('Visual PDF input supports 1 to 100 pages. Split larger documents.');
      const source = await pdf.getPage(page);
      const geometry = source.getViewport({ scale: 1 });
      if (
        !Number.isFinite(geometry.width) ||
        !Number.isFinite(geometry.height) ||
        geometry.width <= 0 ||
        geometry.height <= 0
      )
        throw new Error('An original PDF page has invalid dimensions.');
      const scale = Math.min(1600 / geometry.width, 2400 / geometry.height);
      if (geometry.width * scale < 100 || geometry.height * scale < 100)
        throw new Error('An original PDF page has unsupported proportions.');
      const viewport = source.getViewport({ scale });
      const target = new canvases.CanvasFactory().create(viewport.width, viewport.height);
      const task = source.render({
        canvas: null,
        canvasContext: /** @type {CanvasRenderingContext2D} */ (
          /** @type {unknown} */ (target.context)
        ),
        viewport,
      });
      const cancel = () => task.cancel();
      signal.addEventListener('abort', cancel, { once: true });
      try {
        if (signal.aborted) task.cancel();
        await task.promise;
        const jpeg = await canvases.encodeJpeg();
        signal.throwIfAborted();
        bytes += jpeg.length;
        if (bytes > 20 * 1024 * 1024)
          throw new Error('Original PDF page images exceed 20 MB. Split the document.');
        const file = `page-${page}.jpg`;
        await writeFile(join(directory, file), jpeg, { flag: 'wx', mode: 0o600 });
        images.push({
          file,
          bytes: jpeg.length,
          sha256: createHash('sha256').update(jpeg).digest('hex'),
        });
      } finally {
        signal.removeEventListener('abort', cancel);
      }
    } finally {
      signal.removeEventListener('abort', abort);
      try {
        await (destruction ?? loading.destroy());
      } finally {
        canvases.release();
      }
    }
  }
  if (!total) throw new Error('Original PDF page coverage is incomplete.');
  return { pages: total, images };
}

async function main() {
  const controller = new AbortController();
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let hardExit;
  const stop = () => {
    controller.abort(new Error('PDF rendering interrupted'));
    hardExit ??= setTimeout(() => process.exit(3), 3000);
  };
  process.stdin.on('end', stop);
  process.stdin.resume();
  const deadline = setTimeout(stop, 175000);
  const directory = process.argv[2];
  try {
    if (!directory) throw new Error('Missing owned PDF workspace.');
    const receipt = await open(join(directory, 'renderer.json'), 'wx', 0o600);
    try {
      await receipt.writeFile(
        JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() })
      );
      await receipt.sync();
    } finally {
      await receipt.close();
    }
    const manifest = await renderPdfFile(directory, controller.signal);
    await writeFile(join(directory, 'pages.json'), JSON.stringify(manifest), {
      flag: 'wx',
      mode: 0o600,
    });
  } catch (error) {
    const safe = new Set([
      'Visual PDF input supports 1 to 100 pages. Split larger documents.',
      'An original PDF page has invalid dimensions.',
      'An original PDF page has unsupported proportions.',
      'Original PDF page images exceed 20 MB. Split the document.',
    ]);
    if (directory)
      await writeFile(
        join(directory, 'failure.json'),
        JSON.stringify({
          message:
            error instanceof Error && safe.has(error.message)
              ? error.message
              : 'The original PDF could not be rendered.',
        }),
        { flag: 'wx', mode: 0o600 }
      );
    throw error;
  } finally {
    clearTimeout(deadline);
    if (hardExit) clearTimeout(hardExit);
    process.stdin.removeListener('end', stop);
    process.stdin.destroy();
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
