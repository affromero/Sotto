import { createHash } from 'node:crypto';
import { open, realpath } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join, resolve, sep } from 'node:path';
import { z } from 'zod';
import { readBoundedRegularFile } from '../../../providers/documents/files';
import { prepareMaterialPageText } from '../chunks';
import { MaterialPdfWarnings } from './warnings';
import {
  materialPdfPageSchema,
  materialPdfRequestSchema,
  materialPdfResultSchema,
  type MaterialPdfPage,
  type MaterialPdfRequest,
  type MaterialPdfResult,
} from '../pdf-protocol';

interface CanvasTarget {
  canvas: HTMLCanvasElement & { toBuffer(type: 'image/png'): Buffer };
  context: CanvasRenderingContext2D;
}
interface PdfCanvasFactory {
  create(width: number, height: number): CanvasTarget;
  destroy(target: CanvasTarget): void;
}
type JsonValue = null | string | number | boolean | JsonValue[] | { [key: string]: JsonValue };
class ArtifactLimitError extends Error {}
const warnings = new MaterialPdfWarnings();
// PDF diagnostics may contain learner text. Keep counts rather than redirecting it to stdout.
for (const method of ['log', 'warn', 'error'])
  Object.defineProperty(console, method, {
    value: (...values: unknown[]) => warnings.observe(method, values),
  });

async function readRequest(): Promise<MaterialPdfRequest> {
  const path = process.argv[2];
  if (!path || process.argv.length !== 3) throw new Error('Invalid PDF child invocation.');
  const request = materialPdfRequestSchema.parse(
    JSON.parse((await readBoundedRegularFile(path, { maximum: 32768 })).toString('utf8'))
  );
  const directory = await realpath(request.directory);
  if (dirname(await realpath(path)) !== directory || directory !== request.directory)
    throw new Error('Invalid PDF child execution directory.');
  const pdfPath = await realpath(request.pdfPath);
  if (
    !pdfPath.startsWith(`${dirname(directory)}${sep}`) ||
    pdfPath.startsWith(`${directory}${sep}`)
  )
    throw new Error('Invalid PDF child input.');
  return request;
}

async function extract(request: MaterialPdfRequest) {
  const original = await readBoundedRegularFile(request.pdfPath, {
    maximum: request.limits.maxFileBytes,
  });
  if (
    original.byteLength > request.limits.maxFileBytes ||
    createHash('sha256').update(original).digest('hex') !== request.expectedSha256
  )
    throw new Error('PDF input identity changed.');
  const requireRuntime = createRequire(join(process.cwd(), 'package.json'));
  const libraryRoot = dirname(requireRuntime.resolve('pdfjs-dist/package.json'));
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  warnings.setLibraryVersion(pdfjs.version);
  const loading = pdfjs.getDocument({
    data: new Uint8Array(original),
    stopAtErrors: true,
    disableAutoFetch: true,
    disableRange: true,
    disableStream: true,
    useWorkerFetch: false,
    useSystemFonts: false,
    standardFontDataUrl: `${join(libraryRoot, 'standard_fonts')}${sep}`,
    cMapUrl: `${join(libraryRoot, 'cmaps')}${sep}`,
    cMapPacked: true,
    wasmUrl: `${join(libraryRoot, 'wasm')}${sep}`,
    maxImageSize: request.limits.maxPixels,
    canvasMaxAreaInBytes: request.limits.maxPixels * 4,
    verbosity: pdfjs.VerbosityLevel.WARNINGS,
  });
  let artifactBytes = 0;
  async function writeArtifact(file: string, chunks: Iterable<string | Uint8Array>) {
    const handle = await open(join(request.directory, file), 'wx', 0o600);
    const hash = createHash('sha256');
    let byteSize = 0;
    try {
      for (const chunk of chunks) {
        const bytes = typeof chunk === 'string' ? Buffer.from(chunk, 'utf8') : chunk;
        artifactBytes += bytes.byteLength;
        if (artifactBytes > request.limits.maxArtifactBytes) throw new ArtifactLimitError();
        hash.update(bytes);
        await handle.writeFile(bytes);
        byteSize += bytes.byteLength;
      }
    } finally {
      await handle.close();
    }
    return { file, sha256: hash.digest('hex'), byteSize };
  }
  async function writeJson(file: string, value: unknown) {
    return writeArtifact(file, [JSON.stringify(value)]);
  }
  try {
    const document = await loading.promise;
    const documentInfo = z
      .object({
        EncryptFilterName: z.string().nullable().optional(),
        IsAcroFormPresent: z.boolean().optional(),
        IsXFAPresent: z.boolean().optional(),
        IsSignaturesPresent: z.boolean().optional(),
      })
      .parse((await document.getMetadata()).info);
    const unsupported = new Set<
      MaterialPdfResult['provenance']['documentFeatures']['verificationUnsupported'][number]
    >();
    const features = {
      encrypted: Boolean(documentInfo.EncryptFilterName),
      formsPresent: Boolean(documentInfo.IsAcroFormPresent),
      xfaPresent: Boolean(documentInfo.IsXFAPresent),
      signaturesPresent: Boolean(documentInfo.IsSignaturesPresent),
      outlinePresent: Boolean((await document.getOutline())?.length),
    };
    if (features.encrypted) unsupported.add('ENCRYPTION');
    if (features.formsPresent) unsupported.add('FORMS');
    if (features.xfaPresent) unsupported.add('XFA');
    if (features.signaturesPresent) unsupported.add('SIGNATURES');
    if (features.outlinePresent) unsupported.add('OUTLINE');
    if (document.isPureXfa)
      throw new Error('XFA material needs an explicitly supported extractor.');
    function annotationMeaning(value: unknown, depth = 0): JsonValue {
      if (depth > 40) throw new Error('Annotation nesting exceeds its bound.');
      if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
      if (typeof value === 'number' && Number.isFinite(value)) return value;
      if (ArrayBuffer.isView(value))
        return Array.from(new Uint8Array(value.buffer, value.byteOffset, value.byteLength));
      if (Array.isArray(value))
        return value.map((item: unknown) => annotationMeaning(item, depth + 1));
      if (typeof value === 'object') {
        const record = value as Record<string, unknown>;
        if ('num' in record && 'gen' in record) {
          unsupported.add('ANNOTATION_REFERENCES');
          return 'UNRESOLVED_PDF_REFERENCE';
        }
        return Object.fromEntries(
          Object.keys(record)
            .sort()
            .flatMap((key) => {
              if (key === 'id' || record[key] === undefined) return [];
              if (['parentId', 'popupRef', 'popupId'].includes(key)) {
                if (record[key] !== null) unsupported.add('ANNOTATION_RELATIONSHIPS');
                return [];
              }
              return [[key, annotationMeaning(record[key], depth + 1)]];
            })
        );
      }
      throw new Error('Unsupported annotation data.');
    }
    const results = [];
    const admitted = Math.min(document.numPages, request.limits.maxPages);
    for (let pageNumber = 1; pageNumber <= admitted; pageNumber += 1) {
      warnings.enterPage(pageNumber);
      let annotationEvidence: unknown = null;
      const name = `page-${String(pageNumber).padStart(6, '0')}`;
      const result: MaterialPdfPage = {
        schemaVersion: 1,
        pageNumber,
        width: null,
        height: null,
        rotation: null,
        text: {
          state: 'FAILED',
          manifest: null,
          artifact: null,
          chunksArtifact: null,
          positionsArtifact: null,
        },
        image: null,
        annotationCount: 0,
        annotationsArtifact: null,
        annotationMeaningSha256: null,
        visualState: 'UNRESOLVED',
        diagnostics: [],
      };
      try {
        const page = await document.getPage(pageNumber);
        try {
          const viewport = page.getViewport({
            scale: request.limits.renderScale,
          });
          result.width = page.getViewport({ scale: 1 }).width;
          result.height = page.getViewport({ scale: 1 }).height;
          result.rotation = page.rotate;
          const beforeText = warnings.unknownCount;
          try {
            const content = await page.getTextContent({
              disableNormalization: true,
            });
            let text = '';
            let codePointOffset = 0;
            let textBytes = 0;
            const positions = [];
            for (const item of content.items) {
              if (!('str' in item)) continue;
              const value = item.str + (item.hasEOL ? '\n' : '');
              textBytes += Buffer.byteLength(value, 'utf8');
              if (textBytes > request.limits.maxPageTextBytes) throw new ArtifactLimitError();
              const length = [...value].length;
              positions.push({
                codePointStart: codePointOffset,
                codePointEnd: codePointOffset + length,
                transform: item.transform,
                width: item.width,
                height: item.height,
                direction: item.dir,
              });
              codePointOffset += length;
              text += value;
            }
            const prepared = prepareMaterialPageText({
              pageNumber,
              text,
              source: {
                origin: 'EMBEDDED_TEXT',
                method: 'PDFJS_TEXT_CONTENT',
                version: pdfjs.version,
              },
            });
            result.text = {
              state: 'EXTRACTED',
              manifest: prepared.manifest,
              artifact: await writeArtifact(`${name}.txt`, [text]),
              chunksArtifact: await writeArtifact(
                `${name}.chunks.jsonl`,
                (function* () {
                  for (const chunk of prepared.chunks) yield `${JSON.stringify(chunk)}\n`;
                })()
              ),
              positionsArtifact: await writeJson(`${name}.positions.json`, positions),
            };
            if (warnings.unknownCount > beforeText)
              result.diagnostics.push('TEXT_EXTRACTION_WARNING');
          } catch (error) {
            if (error instanceof ArtifactLimitError) throw error;
            result.diagnostics.push('TEXT_EXTRACTION_FAILED');
          }
          try {
            const annotationInput: unknown[] = await page.getAnnotations({
              intent: 'display',
            });
            if (annotationInput.length > 10_000)
              throw new Error('Annotation inventory exceeds its bound.');
            const annotations = annotationInput.map((item) => annotationMeaning(item));
            annotationEvidence = annotations;
            result.annotationCount = annotations.length;
            result.annotationsArtifact = await writeJson(`${name}.annotations.json`, annotations);
            result.annotationMeaningSha256 = result.annotationsArtifact.sha256;
          } catch (error) {
            if (error instanceof ArtifactLimitError) throw error;
            result.diagnostics.push('ANNOTATIONS_UNSUPPORTED');
          }
          const width = Math.ceil(viewport.width);
          const height = Math.ceil(viewport.height);
          if (
            !Number.isSafeInteger(width) ||
            !Number.isSafeInteger(height) ||
            width < 1 ||
            height < 1 ||
            width > request.limits.maxDimension ||
            height > request.limits.maxDimension ||
            width * height > request.limits.maxPixels
          ) {
            result.diagnostics.push('RENDER_BOUNDS');
          } else {
            const beforeRender = warnings.unknownCount;
            const factory = document.canvasFactory as PdfCanvasFactory;
            let target: CanvasTarget | undefined;
            try {
              target = factory.create(width, height);
              await page.render({
                canvas: target.canvas,
                canvasContext: target.context,
                viewport,
                annotationMode: pdfjs.AnnotationMode.ENABLE,
                intent: 'display',
              }).promise;
              const png = target.canvas.toBuffer('image/png');
              const rgbaSha256 = createHash('sha256')
                .update(target.context.getImageData(0, 0, width, height).data)
                .digest('hex');
              result.image = {
                ...(await writeArtifact(`${name}.png`, [png])),
                width,
                height,
                scale: request.limits.renderScale,
                mimeType: 'image/png',
                rgbaSha256,
              };
              if (warnings.unknownCount > beforeRender) result.diagnostics.push('RENDER_WARNING');
              else if (!result.diagnostics.includes('ANNOTATIONS_UNSUPPORTED'))
                result.visualState = 'RECOGNITION_NEEDED';
            } catch (error) {
              if (error instanceof ArtifactLimitError) throw error;
              result.diagnostics.push('RENDER_FAILED');
            } finally {
              if (target) factory.destroy(target);
            }
          }
        } finally {
          page.cleanup();
        }
      } catch (error) {
        if (error instanceof ArtifactLimitError) throw error;
        result.diagnostics.push('PAGE_FAILED');
      }
      warnings.finalizePage(
        pageNumber,
        annotationEvidence,
        Boolean(
          result.image &&
          result.annotationMeaningSha256 &&
          result.annotationsArtifact &&
          result.diagnostics.length === 0
        )
      );
      if (warnings.pageBlocks(pageNumber)) {
        result.diagnostics.push('PARSER_WARNING');
        result.visualState = 'UNRESOLVED';
      }
      warnings.leavePage();
      const saved = await writeJson(`${name}.json`, materialPdfPageSchema.parse(result));
      results.push({ ...saved, pageNumber });
    }
    // Include shutdown diagnostics before deciding whether the comparison scope is complete.
    await loading.destroy();
    if (warnings.hasBlockingWarnings) unsupported.add('PARSER_WARNINGS');
    await writeJson(
      'result.json',
      materialPdfResultSchema.parse({
        schemaVersion: 1,
        originalSha256: request.expectedSha256,
        originalBytes: original.byteLength,
        pageCount: document.numPages,
        pages: results,
        unprocessed:
          admitted < document.numPages
            ? {
                firstPage: admitted + 1,
                lastPage: document.numPages,
                reason: 'UNSUPPORTED_PAGE_LIMIT',
              }
            : null,
        provenance: {
          method: 'PDFJS_PAGE_TEXT_AND_DISPLAY_RENDER',
          version: pdfjs.version,
          renderIntent: 'display',
          annotationMode: 'ENABLE',
          textNormalization: 'DISABLED',
          recognition: 'NOT_PERFORMED',
          limits: request.limits,
          warningPolicyVersion: 1,
          warningReceipts: warnings.snapshot(),
          documentFeatures: {
            ...features,
            verificationUnsupported: [...unsupported].sort(),
          },
        },
      })
    );
  } finally {
    await loading.destroy();
  }
}

async function main(): Promise<void> {
  try {
    const request = await readRequest();
    if (resolve(request.directory) !== request.directory)
      throw new Error('Invalid PDF artifact path.');
    await extract(request);
    process.stdout.write('MATERIAL_PDF_READY\n');
  } catch (error) {
    process.stderr.write(
      error instanceof ArtifactLimitError
        ? 'MATERIAL_PDF_RESOURCE_LIMIT\n'
        : 'MATERIAL_PDF_FAILED\n'
    );
    process.exitCode = 1;
  }
}
void main();
