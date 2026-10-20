// @vitest-environment node
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { optimizeMaterialPdf } from '@/lib/course-materials/optimization/pdf';
import { ProcessRunner } from 'thesidedoor-core/runtime/process';

const directories: string[] = [];
async function workspace() {
  const directory = await mkdtemp(join(tmpdir(), 'sotto-pdf-optimization-'));
  directories.push(directory);
  return directory;
}

afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true })));
});

function syntheticPdf(
  pages: number,
  options: {
    marker?: string;
    ink?: boolean;
    annotationText?: string;
    outline?: boolean;
    rotation?: number;
  } = {}
): Buffer {
  const annotationId = 4 + pages * 2;
  const outlineId = annotationId + (options.ink ? 2 : 0);
  const objects = [
    `<< /Type /Catalog /Pages 2 0 R ${options.outline ? `/Outlines ${outlineId} 0 R` : ''} >>`,
    '<< /Type /Pages /Count ' +
      pages +
      ' /Kids [' +
      Array.from({ length: pages }, (_, index) => 4 + index * 2 + ' 0 R').join(' ') +
      '] >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  for (let index = 0; index < pages; index++) {
    const stream =
      'BT /F1 12 Tf 50 750 Td (Page ' +
      (index + 1) +
      (options.marker ?? '') +
      ') Tj ET\n50 70 m 55 81 68 79 73 92 c S\n' +
      ' '.repeat(16384) +
      '\n';
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Rotate ${options.rotation ?? 0} ` +
        (options.ink && index === 0 ? `/Annots [${annotationId} 0 R] ` : '') +
        '/Resources << /Font << /F1 3 0 R >> >> /Contents ' +
        (5 + index * 2) +
        ' 0 R >>',
      '<< /Length ' + Buffer.byteLength(stream) + ' >>\nstream\n' + stream + 'endstream'
    );
  }
  if (options.ink) {
    const appearance = '1 0 0 RG 8 w 0 0 m 100 100 l S';
    objects.push(
      `<< /Type /Annot /Subtype /Ink /Rect [10 10 110 110] /InkList [[10 10 110 110]] /Contents (${options.annotationText ?? 'Preserved handwriting'}) /C [1 0 0] /F 4 /AP << /N ${annotationId + 1} 0 R >> >>`,
      `<< /Type /XObject /Subtype /Form /BBox [0 0 100 100] /Resources << >> /Length ${appearance.length} >>\nstream\n${appearance}\nendstream`
    );
  }
  if (options.outline)
    objects.push(
      `<< /Type /Outlines /First ${outlineId + 1} 0 R /Last ${outlineId + 1} 0 R /Count 1 >>`,
      `<< /Title (Private outline) /Parent ${outlineId} 0 R /Dest [4 0 R /Fit] >>`
    );
  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  for (const [index, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(pdf));
    pdf += index + 1 + ' 0 obj\n' + object + '\nendobj\n';
  }
  const xref = Buffer.byteLength(pdf);
  pdf += 'xref\n0 ' + offsets.length + '\n0000000000 65535 f \n';
  pdf += offsets
    .slice(1)
    .map((offset) => String(offset).padStart(10, '0') + ' 00000 n \n')
    .join('');
  pdf +=
    'trailer\n<< /Size ' + offsets.length + ' /Root 1 0 R >>\nstartxref\n' + xref + '\n%%EOF\n';
  return Buffer.from(pdf);
}

function qpdfAvailable(): boolean {
  try {
    execFileSync('qpdf', ['--version'], { timeout: 2000, maxBuffer: 65536 });
    return true;
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')
      return false;
    throw error;
  }
}
const hasQpdf = qpdfAvailable();

describe('optional PDF optimization', () => {
  it('reports an unavailable executable and preserves the byte-exact original', async () => {
    const directory = await workspace();
    const originalPath = join(directory, 'original.pdf');
    const outputPath = join(directory, 'candidate.pdf');
    const original = syntheticPdf(2);
    await writeFile(originalPath, original);
    const result = await optimizeMaterialPdf({
      originalPath,
      outputPath,
      executable: join(directory, 'missing-qpdf'),
      signal: new AbortController().signal,
    });
    expect(result).toMatchObject({ status: 'unavailable', originalPath });
    expect(result.diagnostic).toContain('executable');
    expect(await readFile(originalPath)).toEqual(original);
    expect(existsSync(outputPath)).toBe(false);
  });

  it('rejects cancellation before starting any process', async () => {
    const directory = await workspace();
    const originalPath = join(directory, 'original.pdf');
    const original = syntheticPdf(1);
    await writeFile(originalPath, original);
    const reason = new Error('Learner cancelled');
    await expect(
      optimizeMaterialPdf({
        originalPath,
        outputPath: join(directory, 'candidate.pdf'),
        signal: AbortSignal.abort(reason),
      })
    ).rejects.toBe(reason);
    expect(await readFile(originalPath)).toEqual(original);
  });

  it('settles a running process before propagating caller cancellation', async () => {
    const directory = await workspace();
    const originalPath = join(directory, 'original.pdf');
    const started = join(directory, 'started');
    const executable = join(directory, 'slow qpdf');
    const original = syntheticPdf(1);
    await writeFile(originalPath, original);
    await writeFile(
      executable,
      '#!' +
        process.execPath +
        '\nrequire("node:fs").writeFileSync(' +
        JSON.stringify(started) +
        ', "started");\nsetInterval(() => {}, 1000);\n'
    );
    await chmod(executable, 0o700);
    const controller = new AbortController();
    const operation = optimizeMaterialPdf({
      originalPath,
      outputPath: join(directory, 'candidate.pdf'),
      executable,
      signal: controller.signal,
    });
    const reason = new Error('Worker stopped');
    const rejection = expect(operation).rejects.toBe(reason);
    try {
      await vi.waitFor(() => expect(existsSync(started)).toBe(true), { timeout: 3000 });
    } finally {
      controller.abort(reason);
    }
    await rejection;
    expect(await readFile(originalPath)).toEqual(original);
  });

  it('refuses an existing output or the original itself without changing either file', async () => {
    const directory = await workspace();
    const originalPath = join(directory, 'original.pdf');
    const outputPath = join(directory, 'existing.pdf');
    const original = syntheticPdf(1);
    const existing = Buffer.from('Existing unrelated content');
    await writeFile(originalPath, original);
    await writeFile(outputPath, existing);
    for (const candidate of [originalPath, outputPath]) {
      const result = await optimizeMaterialPdf({
        originalPath,
        outputPath: candidate,
        signal: new AbortController().signal,
      });
      expect(result.status).toBe('failed');
    }
    expect(await readFile(originalPath)).toEqual(original);
    expect(await readFile(outputPath)).toEqual(existing);
  });

  it('reports a bounded deadline failure after stopping its process', async () => {
    const directory = await workspace();
    const originalPath = join(directory, 'original.pdf');
    const executable = join(directory, 'slow-qpdf');
    const original = syntheticPdf(1);
    await writeFile(originalPath, original);
    await writeFile(executable, '#!' + process.execPath + '\nsetInterval(() => {}, 1000);\n');
    await chmod(executable, 0o700);
    const result = await optimizeMaterialPdf({
      originalPath,
      outputPath: join(directory, 'candidate.pdf'),
      executable,
      signal: new AbortController().signal,
      timeoutMs: 1000,
    });
    expect(result.status).toBe('failed');
    expect(result.diagnostic).toContain('deadline');
    expect(await readFile(originalPath)).toEqual(original);
  });

  it('bounds diagnostic output from an executable without changing the original', async () => {
    const directory = await workspace();
    const originalPath = join(directory, 'original.pdf');
    const executable = join(directory, 'noisy-qpdf');
    const original = syntheticPdf(1);
    await writeFile(originalPath, original);
    await writeFile(
      executable,
      '#!' + process.execPath + '\nprocess.stdout.write("x".repeat(131072));\n'
    );
    await chmod(executable, 0o700);
    const result = await optimizeMaterialPdf({
      originalPath,
      outputPath: join(directory, 'candidate.pdf'),
      executable,
      signal: new AbortController().signal,
      maxOutputBytes: 1024,
    });
    expect(result.status).toBe('failed');
    expect(result.diagnostic).toContain('output_limit');
    expect(await readFile(originalPath)).toEqual(original);
  });

  it.skipIf(!hasQpdf)(
    'does not pass provider secrets or process options to qpdf or parser children',
    async () => {
      const directory = await workspace();
      const originalPath = join(directory, 'original.pdf');
      await writeFile(originalPath, syntheticPdf(1));
      vi.stubEnv('MATERIAL_OPTIMIZER_SECRET', 'never-forward-this');
      const actual = ProcessRunner.prototype.execute;
      const requests: Parameters<ProcessRunner['execute']>[0][] = [];
      vi.spyOn(ProcessRunner.prototype, 'execute').mockImplementation(function (
        this: ProcessRunner,
        request
      ) {
        requests.push(request);
        return actual.call(this, request);
      });
      const result = await optimizeMaterialPdf({
        originalPath,
        outputPath: join(directory, 'candidate.pdf'),
        signal: new AbortController().signal,
      });
      expect(result.status).toBe('optimized');
      expect(requests.some((request) => request.args.includes('--object-streams=generate'))).toBe(
        true
      );
      for (const request of requests) {
        expect(request.environment).not.toHaveProperty('MATERIAL_OPTIMIZER_SECRET');
        expect(request.environment).not.toHaveProperty('NODE_OPTIONS');
        expect(request.environment).not.toHaveProperty('HOME');
        expect(request.args).not.toContain('--optimize-images');
      }
    }
  );
});

describe.skipIf(!hasQpdf)('real qpdf lossless compression', () => {
  it('keeps all 65 pages and their text and vector marks in a smaller derivative', async () => {
    const directory = await workspace();
    const originalPath = join(directory, 'original.pdf');
    const outputPath = join(directory, 'candidate.pdf');
    const original = syntheticPdf(65, { ink: true });
    await writeFile(originalPath, original);
    const result = await optimizeMaterialPdf({
      originalPath,
      outputPath,
      signal: new AbortController().signal,
    });
    expect(result.status).toBe('optimized');
    if (result.status !== 'optimized') throw new Error(result.diagnostic);
    expect(result.pageCount).toBe(65);
    expect(result.optimizedBytes).toBeLessThan(result.originalBytes);
    expect(result.savedBytes).toBe(original.length - (await readFile(outputPath)).length);
    expect(result.verification).toMatchObject({
      method: 'PDFJS_COMPLETE_PAGE_COMPARISON',
      pageCount: 65,
    });
    expect(await readFile(originalPath)).toEqual(original);
    const repeated = await optimizeMaterialPdf({
      originalPath,
      outputPath,
      signal: new AbortController().signal,
    });
    expect(repeated.status).toBe('failed');
    expect(await readFile(outputPath)).toHaveLength(result.optimizedBytes);

    const expanded = join(directory, 'expanded.pdf');
    execFileSync(
      'qpdf',
      ['--qdf', '--object-streams=disable', '--stream-data=uncompress', outputPath, expanded],
      { timeout: 5000, maxBuffer: 65536 }
    );
    const content = await readFile(expanded, 'utf8');
    expect(content.match(/\(Page [0-9]+\)/g)).toHaveLength(65);
    expect(content).toContain('(Page 65)');
    expect(content.match(/50 70 m 55 81 68 79 73 92 c S/g)).toHaveLength(65);
  }, 120000);

  it.each([
    { fixture: { marker: ' changed', ink: true }, diagnostic: 'extracted text' },
    { fixture: {}, diagnostic: 'rendered pixels' },
    {
      fixture: { ink: true, annotationText: 'Changed annotation meaning' },
      diagnostic: 'annotation meaning',
    },
    { fixture: { ink: true, rotation: 90 }, diagnostic: 'geometry or rotation' },
  ])(
    'refuses a structurally valid smaller qpdf candidate with changed $diagnostic',
    async ({ fixture, diagnostic }) => {
      const directory = await workspace();
      const originalPath = join(directory, 'original.pdf');
      const tamperedPath = join(directory, 'different-source.pdf');
      const outputPath = join(directory, 'candidate.pdf');
      const executable = join(directory, 'qpdf-boundary');
      const original = syntheticPdf(2, { ink: true });
      await writeFile(originalPath, original);
      await writeFile(tamperedPath, syntheticPdf(2, fixture));
      const actualQpdf = execFileSync('which', ['qpdf'], { encoding: 'utf8' }).trim();
      await writeFile(
        executable,
        '#!' +
          process.execPath +
          '\n' +
          'const args = process.argv.slice(2);\n' +
          'if (args.includes("--object-streams=generate")) args[args.length - 2] = ' +
          JSON.stringify(tamperedPath) +
          ';\n' +
          'require("node:child_process").execFileSync(' +
          JSON.stringify(actualQpdf) +
          ', args, {stdio:"inherit"});\n'
      );
      await chmod(executable, 0o700);
      const result = await optimizeMaterialPdf({
        originalPath,
        outputPath,
        executable,
        signal: new AbortController().signal,
      });
      expect(result.status).toBe('failed');
      expect(result.diagnostic).toContain(diagnostic);
      expect(existsSync(outputPath)).toBe(false);
      expect(await readFile(originalPath)).toEqual(original);
    }
  );

  it.each([
    { pdfOptions: { outline: true }, parserLimits: {} },
    { pdfOptions: {}, parserLimits: { maxPages: 1 } },
    { pdfOptions: {}, parserLimits: { maxPixels: 1 } },
  ])(
    'keeps the original when complete supported semantics cannot be established: %j',
    async ({ pdfOptions, parserLimits }) => {
      const directory = await workspace();
      const originalPath = join(directory, 'original.pdf');
      const outputPath = join(directory, 'candidate.pdf');
      const original = syntheticPdf(2, pdfOptions);
      await writeFile(originalPath, original);
      const result = await optimizeMaterialPdf({
        originalPath,
        outputPath,
        parserLimits,
        signal: new AbortController().signal,
      });
      expect(result.status).toBe('failed');
      expect(result.diagnostic).toMatch(/unsupported|lacks complete/);
      expect(existsSync(outputPath)).toBe(false);
      expect(await readFile(originalPath)).toEqual(original);
    }
  );

  it('returns unchanged when recompressing a validated candidate produces no savings', async () => {
    const directory = await workspace();
    const originalPath = join(directory, 'original.pdf');
    const optimized = join(directory, 'optimized.pdf');
    await writeFile(originalPath, syntheticPdf(3));
    const first = await optimizeMaterialPdf({
      originalPath,
      outputPath: optimized,
      signal: new AbortController().signal,
    });
    expect(first.status).toBe('optimized');
    if (first.status !== 'optimized') throw new Error(first.diagnostic);
    const original = await readFile(optimized);
    const result = await optimizeMaterialPdf({
      originalPath: optimized,
      outputPath: join(directory, 'second.pdf'),
      signal: new AbortController().signal,
    });
    expect(result.status).toBe('unchanged');
    expect(await readFile(optimized)).toEqual(original);
    expect(result).not.toHaveProperty('outputPath');
  });

  it('reports invalid input explicitly while retaining its original bytes', async () => {
    const directory = await workspace();
    const originalPath = join(directory, 'invalid.pdf');
    const original = Buffer.from('This is not a PDF document.');
    await writeFile(originalPath, original);
    const result = await optimizeMaterialPdf({
      originalPath,
      outputPath: join(directory, 'candidate.pdf'),
      signal: new AbortController().signal,
    });
    expect(result.status).toBe('failed');
    expect(result.diagnostic).toContain('input validation');
    expect(await readFile(originalPath)).toEqual(original);
  });
});
