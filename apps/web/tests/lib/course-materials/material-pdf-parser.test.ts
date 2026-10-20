// @vitest-environment node
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ProcessRunner } from 'thesidedoor-core/runtime/process';
import { syntheticMaterialPdf } from '../../helpers/materials/pdf';
import { extractMaterialPdf } from '@/lib/course-materials/extraction/pdf';
import { materialPdfPageSchema } from '@/lib/course-materials/extraction/pdf-protocol';
import { compareMaterialPdfSemantics } from '@/lib/course-materials/optimization/verification';

const directories: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const directory of directories.splice(0))
    await rm(directory, { recursive: true, force: true });
});

const pdf = syntheticMaterialPdf;

async function fixture(bytes: Buffer) {
  const executionDirectory = await mkdtemp(join(tmpdir(), 'sotto-pdf-parser-'));
  directories.push(executionDirectory);
  const pdfPath = join(executionDirectory, 'original.pdf');
  await writeFile(pdfPath, bytes);
  return {
    executionDirectory,
    pdfPath,
    expectedSha256: createHash('sha256').update(bytes).digest('hex'),
  };
}

function densePage(page: number, lines = 220, fontSize = 0.1, leading = 0.5) {
  const rows = Array.from(
    { length: lines },
    (_, row) => `(${`Page ${page} row ${row} complete source text `.padEnd(85, 'x')}) Tj T*`
  ).join('\n');
  return `BT /F1 ${fontSize} Tf ${leading} TL 1 119 Td\n${rows}\n(${page === 65 ? 'FINAL_PAGE_OBWOHL_TROTZDEM_REFLEXIVE_MARKER' : 'END_OF_PAGE'}) Tj ET`;
}

async function loadPage(directory: string, file: string) {
  return materialPdfPageSchema.parse(JSON.parse(await readFile(join(directory, file), 'utf8')));
}

describe('isolated complete material PDF parsing', () => {
  it.each(['web', 'root'])(
    'runs through the actual CommonJS tsx worker entry from the %s cwd',
    async (context) => {
      const input = await fixture(pdf(['']));
      const webDirectory = process.cwd().endsWith(join('apps', 'web'))
        ? process.cwd()
        : join(process.cwd(), 'apps/web');
      const requireRuntime = createRequire(join(webDirectory, 'package.json'));
      const script = [
        'const [modulePath,pdfPath,executionDirectory,expectedSha256]=process.argv.slice(1);',
        'const {extractMaterialPdf}=require(modulePath);',
        'extractMaterialPdf({pdfPath,executionDirectory,expectedSha256}).then(({result})=>process.stdout.write(JSON.stringify({pages:result.pageCount})),()=>{process.exitCode=1;});',
      ].join('\n');
      const result = await new ProcessRunner(1).execute({
        command: process.execPath,
        args: [
          '--import',
          requireRuntime.resolve('tsx'),
          '-e',
          script,
          join(webDirectory, 'src/lib/course-materials/extraction/pdf.ts'),
          input.pdfPath,
          input.executionDirectory,
          input.expectedSha256,
        ],
        cwd: context === 'web' ? webDirectory : resolve(webDirectory, '../..'),
        environment: { PATH: dirname(process.execPath) },
        timeoutMs: 20000,
        maxOutputBytes: 65536,
      });
      expect(JSON.parse(result.stdout)).toEqual({ pages: 1 });
    }
  );

  it('extracts and renders all 65 actual PDF pages beyond one million characters, including late content', async () => {
    const bytes = pdf(Array.from({ length: 65 }, (_, index) => densePage(index + 1)));
    const input = await fixture(bytes);
    const output = await extractMaterialPdf(input);
    expect(output.result.pageCount).toBe(65);
    expect(output.result.unprocessed).toBeNull();
    let points = 0;
    for (const pageReceipt of output.result.pages) {
      const encoded = await readFile(join(output.directory, pageReceipt.file));
      expect(createHash('sha256').update(encoded).digest('hex')).toBe(pageReceipt.sha256);
      const page = await loadPage(output.directory, pageReceipt.file);
      expect(page.text.state).toBe('EXTRACTED');
      expect(page.image?.mimeType).toBe('image/png');
      expect(page.visualState).toBe('RECOGNITION_NEEDED');
      points += page.text.manifest!.codePointLength;
      const text = await readFile(join(output.directory, page.text.artifact!.file), 'utf8');
      const chunks = (
        await readFile(join(output.directory, page.text.chunksArtifact!.file), 'utf8')
      )
        .trimEnd()
        .split('\n')
        .map((line) => JSON.parse(line) as { text: string });
      expect(chunks.map((chunk) => chunk.text).join('')).toBe(text);
      if (page.pageNumber === 65)
        expect(text).toContain('FINAL_PAGE_OBWOHL_TROTZDEM_REFLEXIVE_MARKER');
    }
    expect(points).toBeGreaterThan(1_000_000);
    expect(await readFile(input.pdfPath)).toEqual(bytes);
    expect(output.result.provenance.recognition).toBe('NOT_PERFORMED');
  }, 120_000);

  it('retains a single page text stream exceeding one million code points in page files', async () => {
    const input = await fixture(pdf([densePage(65, 12_000, 0.005, 0.009)]));
    const output = await extractMaterialPdf(input);
    const page = await loadPage(output.directory, output.result.pages[0]!.file);
    expect(page.text.manifest!.codePointLength).toBeGreaterThan(1_000_000);
    const text = await readFile(join(output.directory, page.text.artifact!.file), 'utf8');
    expect(text).toContain('FINAL_PAGE_OBWOHL_TROTZDEM_REFLEXIVE_MARKER');
    expect(Buffer.byteLength(text)).toBe(page.text.manifest!.utf8ByteLength);
  }, 120_000);

  it('renders annotation appearance streams and keeps empty text explicitly unresolved for recognition', async () => {
    const empty = await fixture(pdf(['']));
    const ink = await fixture(pdf([''], { ink: true }));
    const baseline = await extractMaterialPdf(empty);
    const marked = await extractMaterialPdf(ink);
    const plain = await loadPage(baseline.directory, baseline.result.pages[0]!.file);
    const annotated = await loadPage(marked.directory, marked.result.pages[0]!.file);
    expect(annotated.annotationCount).toBe(1);
    expect(annotated.image!.sha256).not.toBe(plain.image!.sha256);
    expect(annotated.image!.rgbaSha256).not.toBe(plain.image!.rgbaSha256);
    expect(annotated.annotationMeaningSha256).not.toBe(plain.annotationMeaningSha256);
    expect(
      await readFile(join(marked.directory, annotated.annotationsArtifact!.file), 'utf8')
    ).not.toMatch(/"id":/);
    expect(annotated.text.manifest!.codePointLength).toBe(0);
    expect(annotated.visualState).toBe('RECOGNITION_NEEDED');
    expect(plain.visualState).toBe('RECOGNITION_NEEDED');
  });

  it('records every admitted page and explicitly identifies pages beyond the configured cap', async () => {
    const input = await fixture(pdf(['', '', '']));
    const output = await extractMaterialPdf({
      ...input,
      limits: { maxPages: 2 },
    });
    expect(output.result.pageCount).toBe(3);
    expect(output.result.pages.map((page) => page.pageNumber)).toEqual([1, 2]);
    expect(output.result.unprocessed).toEqual({
      firstPage: 3,
      lastPage: 3,
      reason: 'UNSUPPORTED_PAGE_LIMIT',
    });
  });

  it('records the reviewed width recovery only after preserving the complete annotation inventory and rendered appearance', async () => {
    const input = await fixture(pdf([''], { ink: true, borderWidth: 100 }));
    const output = await extractMaterialPdf(input);
    const page = await loadPage(output.directory, output.result.pages[0]!.file);
    expect(output.result.provenance.version).toBe('6.4.299');
    expect(output.result.provenance.warningPolicyVersion).toBe(1);
    expect(output.result.provenance.warningReceipts).toEqual([
      {
        pageNumber: 1,
        code: 'ANNOTATION_BORDER_WIDTH_NORMALIZED',
        count: expect.any(Number),
        disposition: 'APPEARANCE_AND_RAW_WIDTH_PRESERVED',
      },
    ]);
    expect(output.result.provenance.documentFeatures.verificationUnsupported).toEqual([]);
    expect(page.diagnostics).toEqual([]);
    expect(page.image?.rgbaSha256).toMatch(/^[a-f0-9]{64}$/);
    const annotations: unknown = JSON.parse(
      await readFile(join(output.directory, page.annotationsArtifact!.file), 'utf8')
    );
    expect(annotations).toEqual([
      expect.objectContaining({
        hasAppearance: true,
        borderStyle: expect.objectContaining({ rawWidth: 100, width: 1 }),
      }),
    ]);
  });

  it('blocks the same width recovery when PDF.js synthesizes the annotation appearance', async () => {
    const input = await fixture(pdf([''], { ink: true, borderWidth: 100, savedAppearance: false }));
    const output = await extractMaterialPdf(input);
    const page = await loadPage(output.directory, output.result.pages[0]!.file);
    expect(output.result.provenance.documentFeatures.verificationUnsupported).toContain(
      'PARSER_WARNINGS'
    );
    expect(output.result.provenance.warningReceipts).toEqual([
      {
        pageNumber: 1,
        code: 'ANNOTATION_BORDER_WIDTH_NORMALIZED',
        count: expect.any(Number),
        disposition: 'BLOCKING',
      },
    ]);
    expect(page.diagnostics).toContain('PARSER_WARNING');
    expect(page.visualState).toBe('UNRESOLVED');
    expect(
      await compareMaterialPdfSemantics(output, output, new AbortController().signal)
    ).toMatchObject({ verified: false, code: 'UNSUPPORTED' });
  });

  it('requires the same warning policy when comparing parser evidence', async () => {
    const input = await fixture(pdf(['']));
    const parsed = await extractMaterialPdf(input);
    expect(
      await compareMaterialPdfSemantics(parsed, parsed, new AbortController().signal)
    ).toMatchObject({ verified: true });
    const previous = structuredClone(parsed);
    delete previous.result.provenance.warningPolicyVersion;
    expect(
      await compareMaterialPdfSemantics(parsed, previous, new AbortController().signal)
    ).toMatchObject({ verified: false, code: 'UNSUPPORTED' });
  });

  it.each([{ maxPixels: 100 }, { maxDimension: 100 }])(
    'preserves text and reports an unsupported render rather than resizing silently: %j',
    async (limits) => {
      const input = await fixture(pdf(['BT /F1 12 Tf 5 80 Td (Complete source) Tj ET']));
      const output = await extractMaterialPdf({ ...input, limits });
      const page = await loadPage(output.directory, output.result.pages[0]!.file);
      expect(page.text.manifest!.hasNonWhitespace).toBe(true);
      expect(page.image).toBeNull();
      expect(page.diagnostics).toContain('RENDER_BOUNDS');
      expect(page.visualState).toBe('UNRESOLVED');
    }
  );

  it('rejects artifact and page-text resource overflow explicitly with the original intact', async () => {
    const bytes = pdf([densePage(1)]);
    const input = await fixture(bytes);
    for (const limits of [{ maxArtifactBytes: 100 }, { maxPageTextBytes: 100 }]) {
      await expect(extractMaterialPdf({ ...input, limits })).rejects.toThrow();
      expect(await readFile(input.pdfPath)).toEqual(bytes);
    }
  });

  it('rejects oversized or changed originals before launching a parser', async () => {
    const input = await fixture(pdf(['']));
    await expect(extractMaterialPdf({ ...input, limits: { maxFileBytes: 1 } })).rejects.toThrow(
      'byte admission'
    );
    await expect(extractMaterialPdf({ ...input, expectedSha256: '0'.repeat(64) })).rejects.toThrow(
      'checksum changed'
    );
    expect(await readdir(input.executionDirectory)).toEqual(['original.pdf']);
  });

  it('terminates a real parser process when its deadline expires', async () => {
    const input = await fixture(
      pdf(Array.from({ length: 65 }, (_, index) => densePage(index + 1)))
    );
    await expect(extractMaterialPdf({ ...input, limits: { timeoutMs: 1 } })).rejects.toThrow();
    expect(
      createHash('sha256')
        .update(await readFile(input.pdfPath))
        .digest('hex')
    ).toBe(input.expectedSha256);
  });

  it('rejects process output beyond the configured IPC bound', async () => {
    const input = await fixture(pdf(['']));
    await expect(
      extractMaterialPdf({ ...input, limits: { maxProcessOutputBytes: 1 } })
    ).rejects.toMatchObject({ code: 'output_limit' });
  });

  it('cancels a real admitted child without changing the retained original', async () => {
    const input = await fixture(
      pdf(Array.from({ length: 65 }, (_, index) => densePage(index + 1)))
    );
    const controller = new AbortController();
    let dispatched!: () => void;
    const admitted = new Promise<void>((resolve) => {
      dispatched = resolve;
    });
    const actual = ProcessRunner.prototype.execute;
    vi.spyOn(ProcessRunner.prototype, 'execute').mockImplementation(function (
      this: ProcessRunner,
      request
    ) {
      const operation = actual.call(this, request);
      dispatched();
      return operation;
    });
    const pending = extractMaterialPdf({ ...input, signal: controller.signal });
    await admitted;
    controller.abort();
    await expect(pending).rejects.toThrow();
    expect(
      createHash('sha256')
        .update(await readFile(input.pdfPath))
        .digest('hex')
    ).toBe(input.expectedSha256);
  });

  it('passes only an explicit environment allowlist and bounded process options', async () => {
    const input = await fixture(pdf(['']));
    vi.stubEnv('MATERIAL_PDF_SENTINEL_SECRET', 'must-not-reach-child');
    const actual = ProcessRunner.prototype.execute;
    const observed: Parameters<ProcessRunner['execute']>[0][] = [];
    const output: string[] = [];
    vi.spyOn(ProcessRunner.prototype, 'execute').mockImplementation(function (
      this: ProcessRunner,
      request
    ) {
      observed.push(request);
      return actual.call(this, request).then((result) => {
        output.push(result.stdout);
        return result;
      });
    });
    try {
      await extractMaterialPdf(input);
      expect(observed[0]!.environment).not.toHaveProperty('MATERIAL_PDF_SENTINEL_SECRET');
      expect(observed[0]!.environment).not.toHaveProperty('HOME');
      expect(observed[0]!.args).toContain('--max-old-space-size=512');
      expect(observed[0]!.maxOutputBytes).toBeLessThanOrEqual(65_536);
      expect(observed[0]!.timeoutMs).toBeGreaterThan(0);
      expect(output).toEqual(['MATERIAL_PDF_READY\n']);
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
