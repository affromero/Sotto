import { z } from 'zod';

export const MATERIAL_EXTRACTION_SCHEMA_VERSION = 1 as const;
export const MATERIAL_TEXT_CHUNK_LIMITS = Object.freeze({
  codePoints: 16_000,
  utf8Bytes: 64_000,
});

const sha256 = z.string().regex(/^[a-f0-9]{64}$/);
const count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const pageNumber = count.positive();
export const materialTextOriginSchema = z.enum(['EMBEDDED_TEXT', 'VISUAL_RECOGNITION']);
export const materialExtractionMethodSchema = z
  .object({
    method: z.string().trim().min(1).max(200),
    version: z.string().trim().min(1).max(200),
  })
  .strict();
export const materialTextSourceSchema = materialExtractionMethodSchema
  .extend({ origin: materialTextOriginSchema })
  .strict();

export const materialPageTextManifestSchema = z
  .object({
    schemaVersion: z.literal(MATERIAL_EXTRACTION_SCHEMA_VERSION),
    pageNumber,
    source: materialTextSourceSchema,
    textSha256: sha256,
    codePointLength: count,
    utf8ByteLength: count,
    chunkCount: count,
    hasNonWhitespace: z.boolean(),
  })
  .strict()
  .superRefine((value, context) => {
    if ((value.codePointLength === 0) !== (value.chunkCount === 0))
      context.addIssue({
        code: 'custom',
        message: 'Empty text has exactly zero chunks.',
      });
    if (value.codePointLength === 0 && value.hasNonWhitespace)
      context.addIssue({
        code: 'custom',
        message: 'Empty text has no non-whitespace content.',
      });
    if (
      value.utf8ByteLength < value.codePointLength ||
      value.utf8ByteLength > value.codePointLength * 4 ||
      value.chunkCount > value.codePointLength
    )
      context.addIssue({
        code: 'custom',
        message: 'Text lengths and chunk count are inconsistent.',
      });
  });

export const materialTextChunkSchema = z
  .object({
    schemaVersion: z.literal(MATERIAL_EXTRACTION_SCHEMA_VERSION),
    pageNumber,
    origin: materialTextOriginSchema,
    pageTextSha256: sha256,
    index: count,
    codePointStart: count,
    codePointEnd: count,
    utf8ByteStart: count,
    utf8ByteEnd: count,
    sha256,
    text: z
      .string()
      .min(1)
      .max(MATERIAL_TEXT_CHUNK_LIMITS.codePoints * 2),
  })
  .strict()
  .superRefine((value, context) => {
    const points = value.codePointEnd - value.codePointStart;
    const bytes = value.utf8ByteEnd - value.utf8ByteStart;
    if (
      points < 1 ||
      points > MATERIAL_TEXT_CHUNK_LIMITS.codePoints ||
      bytes < points ||
      bytes > MATERIAL_TEXT_CHUNK_LIMITS.utf8Bytes ||
      bytes > points * 4
    )
      context.addIssue({
        code: 'custom',
        message: 'Chunk offsets exceed the supported bounds.',
      });
    if (value.text.length > MATERIAL_TEXT_CHUNK_LIMITS.codePoints * 2) return;
    if (
      !value.text.isWellFormed() ||
      [...value.text].length !== points ||
      new TextEncoder().encode(value.text).byteLength !== bytes
    )
      context.addIssue({
        code: 'custom',
        message: 'Chunk text must match exact Unicode and UTF-8 offsets.',
      });
  });

const diagnostic = z.string().trim().min(1).max(2000);
export const materialEmbeddedTextStateSchema = z.discriminatedUnion('state', [
  z.object({ state: z.literal('PENDING') }).strict(),
  z.object({ state: z.literal('EXTRACTED') }).strict(),
  z.object({ state: z.literal('FAILED'), diagnostic }).strict(),
]);
const visualEvidence = z
  .object({
    assessor: materialExtractionMethodSchema,
    pageImageSha256: sha256,
    extent: z.literal('FULL_PAGE'),
    diagnostic,
  })
  .strict();
export const materialVisualCoverageSchema = z.discriminatedUnion('state', [
  z.object({ state: z.literal('UNASSESSED') }).strict(),
  z.object({ state: z.literal('UNAVAILABLE'), diagnostic }).strict(),
  z.object({ state: z.literal('TEXT_SOURCE'), originalSha256: sha256, diagnostic }).strict(),
  visualEvidence.extend({ state: z.literal('RECOGNITION_NEEDED') }).strict(),
  visualEvidence.extend({ state: z.literal('TEXT_COVERED') }).strict(),
  visualEvidence.extend({ state: z.literal('RECOGNIZED') }).strict(),
  visualEvidence.extend({ state: z.literal('BLANK') }).strict(),
  visualEvidence.extend({ state: z.literal('UNCERTAIN') }).strict(),
  visualEvidence
    .extend({ state: z.literal('FAILED'), pageImageSha256: sha256.nullable() })
    .strict(),
]);

export const materialPageLedgerSchema = z
  .object({
    pageNumber,
    embeddedText: materialEmbeddedTextStateSchema,
    visual: materialVisualCoverageSchema,
    textStreams: z.array(materialPageTextManifestSchema).max(2),
  })
  .strict()
  .superRefine((page, context) => {
    const origins = page.textStreams.map((stream) => stream.source.origin);
    if (new Set(origins).size !== origins.length)
      context.addIssue({
        code: 'custom',
        message: 'Each text origin has one immutable stream.',
      });
    if (page.textStreams.some((stream) => stream.pageNumber !== page.pageNumber))
      context.addIssue({
        code: 'custom',
        message: 'Text streams belong to their exact page.',
      });
    const embedded = page.textStreams.find((stream) => stream.source.origin === 'EMBEDDED_TEXT');
    const recognized = page.textStreams.find(
      (stream) => stream.source.origin === 'VISUAL_RECOGNITION'
    );
    if (page.embeddedText.state === 'EXTRACTED' && !embedded)
      context.addIssue({
        code: 'custom',
        message: 'Extracted embedded text requires its manifest, even when empty.',
      });
    if (
      page.visual.state === 'TEXT_COVERED' &&
      (page.embeddedText.state !== 'EXTRACTED' || !embedded?.hasNonWhitespace)
    )
      context.addIssue({
        code: 'custom',
        message: 'Visual text coverage requires nonempty extracted embedded text.',
      });
    if (page.visual.state === 'RECOGNIZED' && !recognized?.hasNonWhitespace)
      context.addIssue({
        code: 'custom',
        message: 'Recognition coverage requires nonempty recognized text.',
      });
    if (page.visual.state === 'BLANK' && page.textStreams.some((stream) => stream.hasNonWhitespace))
      context.addIssue({
        code: 'custom',
        message: 'A blank classification conflicts with retained nonempty text.',
      });
  });

export const materialExtractionLedgerSchema = z
  .object({
    schemaVersion: z.literal(MATERIAL_EXTRACTION_SCHEMA_VERSION),
    materialSha256: sha256,
    extractor: materialExtractionMethodSchema,
    pageCount: pageNumber,
    pages: z.array(materialPageLedgerSchema),
  })
  .strict()
  .superRefine((ledger, context) => {
    for (const page of ledger.pages) {
      if (page.visual.state !== 'TEXT_SOURCE') continue;
      const embedded = page.textStreams.find((stream) => stream.source.origin === 'EMBEDDED_TEXT');
      if (
        ledger.pageCount !== 1 ||
        page.pageNumber !== 1 ||
        page.embeddedText.state !== 'EXTRACTED' ||
        page.visual.originalSha256 !== ledger.materialSha256 ||
        embedded?.textSha256 !== ledger.materialSha256
      )
        context.addIssue({
          code: 'custom',
          message: 'A text-only source must preserve the complete original UTF-8 bytes.',
        });
    }
    const pages = new Set(ledger.pages.map((page) => page.pageNumber));
    if (
      pages.size !== ledger.pageCount ||
      ledger.pages.length !== ledger.pageCount ||
      ledger.pages.some((page) => page.pageNumber > ledger.pageCount)
    )
      context.addIssue({
        code: 'custom',
        message: 'The ledger must contain each expected page exactly once.',
      });
  });

export type MaterialTextSource = z.infer<typeof materialTextSourceSchema>;
export type MaterialPageTextManifest = z.infer<typeof materialPageTextManifestSchema>;
export type MaterialTextChunk = z.infer<typeof materialTextChunkSchema>;
export type MaterialPageLedger = z.infer<typeof materialPageLedgerSchema>;
export type MaterialExtractionLedger = z.infer<typeof materialExtractionLedgerSchema>;
