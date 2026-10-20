const assert = require('node:assert/strict');
const { createRequire, findPackageJSON } = require('node:module');
const { dirname, join, sep } = require('node:path');
const { pathToFileURL } = require('node:url');
const { mkdtemp, writeFile, readFile, rm } = require('node:fs/promises');
const { tmpdir } = require('node:os');

async function main() {
  const applicationRequire = createRequire(join(process.cwd(), 'package.json'));
  const parserRequire = createRequire(applicationRequire.resolve('pdf-parse'));
  const assets = dirname(parserRequire.resolve('pdfjs-dist/package.json'));
  const parserPackageFile = findPackageJSON(
    pathToFileURL(applicationRequire.resolve('pdf-parse')).href
  );
  assert.ok(parserPackageFile, 'The application PDF parser package metadata is missing.');
  const parserMetadata = JSON.parse(await readFile(parserPackageFile, 'utf8'));
  const parserImport = parserMetadata.exports['.'].import.default;
  assert.equal(typeof parserImport, 'string');
  const { PDFParse } = await import(new URL(parserImport, pathToFileURL(parserPackageFile)).href);
  const sharp = applicationRequire('sharp');
  const content = 'BT /F1 18 Tf 30 100 Td (Original PDF smoke) Tj ET';
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 240 160] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let pdf = '%PDF-1.7\n';
  const offsets = [0];
  for (const [index, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  }
  const start = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${offsets.length}\n0000000000 65535 f \n`;
  pdf += offsets
    .slice(1)
    .map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`)
    .join('');
  pdf += `trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${start}\n%%EOF\n`;
  const options = {
    data: new Uint8Array(Buffer.from(pdf)),
    standardFontDataUrl: join(assets, 'standard_fonts') + sep,
    cMapUrl: join(assets, 'cmaps') + sep,
    cMapPacked: true,
    wasmUrl: join(assets, 'wasm') + sep,
  };
  const parser = new PDFParse(options);
  try {
    assert.match((await parser.getText()).text, /Original PDF smoke/);
  } finally {
    await parser.destroy();
  }
  const { ProcessRunner } = await import(
    pathToFileURL(applicationRequire.resolve('thesidedoor-core/runtime/process')).href
  );
  const { isJobExecutionCleanupFailure } = await import(
    pathToFileURL(applicationRequire.resolve('thesidedoor-core/runtime/outbox')).href
  );
  const directory = await mkdtemp(join(tmpdir(), 'sotto-pdf-smoke-'));
  let cleanupUnconfirmed = false;
  try {
    await writeFile(join(directory, 'original.pdf'), pdf, { flag: 'wx', mode: 0o600 });
    await new ProcessRunner(1).execute({
      command: '/bin/sh',
      args: [
        '-c',
        'ulimit -c 0 || exit 125\nexec "$@"',
        'sotto-pdf-smoke',
        process.execPath,
        '--max-old-space-size=64',
        join(process.cwd(), 'scripts/pdf-render/render-worker.mjs'),
        directory,
      ],
      environment: { PATH: '/usr/local/bin:/usr/bin:/bin', NODE_ENV: 'production' },
      cwd: process.cwd(),
      keepInputOpen: true,
      timeoutMs: 30000,
      maxOutputBytes: 1024 * 1024,
    });
    const manifest = JSON.parse(await readFile(join(directory, 'pages.json'), 'utf8'));
    assert.equal(manifest.pages, 1);
    assert.equal(manifest.images.length, 1);
    assert.equal(manifest.images[0].file, 'page-1.jpg');
    const image = sharp(await readFile(join(directory, 'page-1.jpg')));
    const metadata = await image.metadata();
    assert.equal(metadata.width, 1600);
    assert.equal(metadata.height, 1066);
    const stats = await image.removeAlpha().stats();
    assert.ok(stats.channels.some((channel) => channel.min < 100 && channel.max > 240));
    console.log(
      'Original PDF text extraction, supervised renderer, fonts and native page rendering passed.'
    );
  } catch (error) {
    cleanupUnconfirmed = isJobExecutionCleanupFailure(error);
    if (cleanupUnconfirmed) console.error('PDF smoke workspace retained:', directory);
    throw error;
  } finally {
    if (!cleanupUnconfirmed) await rm(directory, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
