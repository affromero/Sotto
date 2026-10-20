import { createHash } from 'node:crypto';
import { realpath } from 'node:fs/promises';
import { join } from 'node:path';
import { readBoundedRegularFile } from '../../providers/documents/files';
import {
  materialPdfPageSchema,
  materialPdfResultSchema,
  type MaterialPdfResult,
} from '../extraction/pdf-protocol';

export interface ParsedMaterialPdf {
  directory: string;
  result: MaterialPdfResult;
}
export type PdfSemanticVerification =
  | { verified: false; code: 'UNSUPPORTED' | 'MISMATCH'; diagnostic: string }
  | {
      verified: true;
      proof: {
        method: 'PDFJS_COMPLETE_PAGE_COMPARISON';
        parserVersion: string;
        originalSha256: string;
        candidateSha256: string;
        pageCount: number;
        pageEvidenceSha256: string;
      };
    };

/** Verify owned parser receipts before using their evidence in derivative admission. */
async function readPage(parsed: ParsedMaterialPdf, index: number, signal: AbortSignal) {
  const receipt = parsed.result.pages[index];
  if (!receipt) throw new Error('PDF verification page receipt is missing.');
  const directory = await realpath(parsed.directory);
  const path = join(directory, receipt.file);
  const bytes = await readBoundedRegularFile(path, {
    maximum: 2 * 1024 * 1024,
    expectedBytes: receipt.byteSize,
    signal,
  });
  if (createHash('sha256').update(bytes).digest('hex') !== receipt.sha256)
    throw new Error('PDF verification page artifact checksum changed.');
  return materialPdfPageSchema.parse(JSON.parse(bytes.toString('utf8')));
}

/** Equal pages are proof only for the parser's explicitly supported complete comparison scope. */
export async function compareMaterialPdfSemantics(
  original: ParsedMaterialPdf,
  candidate: ParsedMaterialPdf,
  signal: AbortSignal
): Promise<PdfSemanticVerification> {
  signal.throwIfAborted();
  original = {
    ...original,
    result: materialPdfResultSchema.parse(original.result),
  };
  candidate = {
    ...candidate,
    result: materialPdfResultSchema.parse(candidate.result),
  };
  const unsupported = (diagnostic: string): PdfSemanticVerification => ({
    verified: false,
    code: 'UNSUPPORTED',
    diagnostic,
  });
  const mismatch = (diagnostic: string): PdfSemanticVerification => ({
    verified: false,
    code: 'MISMATCH',
    diagnostic,
  });
  for (const parsed of [original, candidate]) {
    if (
      parsed.result.unprocessed ||
      parsed.result.provenance.documentFeatures.verificationUnsupported.length
    )
      return unsupported('PDF semantics include unsupported features or unprocessed pages.');
  }
  if (
    original.result.provenance.version !== candidate.result.provenance.version ||
    original.result.provenance.warningPolicyVersion !==
      candidate.result.provenance.warningPolicyVersion ||
    original.result.provenance.limits.renderScale !== candidate.result.provenance.limits.renderScale
  )
    return unsupported('PDF verification requires the same parser version and rendering scale.');
  if (original.result.pageCount !== candidate.result.pageCount)
    return mismatch('The candidate has a different page count.');
  const evidence = createHash('sha256');
  for (let index = 0; index < original.result.pageCount; index += 1) {
    signal.throwIfAborted();
    const before = await readPage(original, index, signal);
    const after = await readPage(candidate, index, signal);
    if (
      [before, after].some(
        (page) =>
          page.diagnostics.length ||
          page.width === null ||
          page.height === null ||
          page.rotation === null ||
          page.text.state !== 'EXTRACTED' ||
          !page.text.manifest ||
          !page.image ||
          !page.annotationsArtifact ||
          !page.annotationMeaningSha256
      )
    )
      return unsupported(
        `Page ${index + 1} lacks complete text, rendering or annotation evidence.`
      );
    if (before.pageNumber !== index + 1 || after.pageNumber !== index + 1)
      throw new Error('PDF verification page order changed.');
    if (
      before.width !== after.width ||
      before.height !== after.height ||
      before.rotation !== after.rotation ||
      before.image!.width !== after.image!.width ||
      before.image!.height !== after.image!.height ||
      before.image!.scale !== after.image!.scale
    )
      return mismatch(`Page ${index + 1} geometry or rotation changed.`);
    if (
      before.text.manifest!.textSha256 !== after.text.manifest!.textSha256 ||
      before.text.manifest!.codePointLength !== after.text.manifest!.codePointLength ||
      before.text.manifest!.utf8ByteLength !== after.text.manifest!.utf8ByteLength
    )
      return mismatch(`Page ${index + 1} extracted text changed.`);
    if (before.image!.rgbaSha256 !== after.image!.rgbaSha256)
      return mismatch(`Page ${index + 1} rendered pixels changed.`);
    if (
      before.annotationMeaningSha256 !== after.annotationMeaningSha256 ||
      before.annotationCount !== after.annotationCount
    )
      return mismatch(`Page ${index + 1} annotation meaning changed.`);
    evidence.update(
      JSON.stringify({
        pageNumber: index + 1,
        width: before.width,
        height: before.height,
        rotation: before.rotation,
        imageWidth: before.image!.width,
        imageHeight: before.image!.height,
        scale: before.image!.scale,
        textSha256: before.text.manifest!.textSha256,
        rgbaSha256: before.image!.rgbaSha256,
        annotationMeaningSha256: before.annotationMeaningSha256,
      })
    );
  }
  return {
    verified: true,
    proof: {
      method: 'PDFJS_COMPLETE_PAGE_COMPARISON',
      parserVersion: original.result.provenance.version,
      originalSha256: original.result.originalSha256,
      candidateSha256: candidate.result.originalSha256,
      pageCount: original.result.pageCount,
      pageEvidenceSha256: evidence.digest('hex'),
    },
  };
}
