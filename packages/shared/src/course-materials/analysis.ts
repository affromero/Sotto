import { z } from 'zod';
import { learningLevelSchema } from '../learning-map/catalog';
import {
  materialPageTextManifestSchema,
  materialExtractionLedgerSchema,
  materialEmbeddedTextStateSchema,
  materialVisualCoverageSchema,
} from './extraction';

export const MATERIAL_FOCUS_ANALYSIS_LIMITS = Object.freeze({
  sources: 12,
  materials: 10,
  pages: 10_000,
  chunks: 100_000,
  windowChunks: 3,
  sourceCodePoints: 48_000,
  sourceUtf8Bytes: 192_000,
  requestBytes: 512 * 1024,
  responseBytes: 512 * 1024,
  focusesPerChunk: 32,
  headingsPerChunk: 32,
  citationsPerFocus: 16,
  aggregateBytes: 32 * 1024 * 1024,
  aggregateFocuses: 20_000,
  focusBytes: 1024 * 1024,
});
const sha = z.string().regex(/^[a-f0-9]{64}$/);
const count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const identifier = z
  .string()
  .min(1)
  .max(200)
  .regex(/^[^\u0000-\u001f\u007f]+$/)
  .refine((text) => text.isWellFormed(), 'Source identities require well-formed Unicode.');
const localKey = z.string().regex(/^[a-z0-9][a-z0-9.-]{0,79}$/);
const language = z.string().regex(/^[a-z]{2}$/);
export const materialFocusAnalysisStatusIdentitySchema = z
  .object({
    analysisId: z.uuid(),
    analysisRevision: count.positive(),
    status: z.enum([
      'WAITING_SOURCE',
      'RUNNING',
      'COMPLETE',
      'PARTIAL',
      'INSUFFICIENT_SOURCE',
      'RECOVERY_REQUIRED',
      'FAILED',
      'CANCELLED',
    ]),
    identityDigest: sha.nullable(),
    resultDigest: sha.nullable(),
    statusUrl: z.string().min(1),
  })
  .strict();
export const materialFocusAnalysisRetryRequestSchema = z
  .object({
    schemaVersion: z.literal(1),
    requestId: z.uuid(),
    analysisRevision: count.positive(),
    identityDigest: sha.nullable(),
    resultDigest: sha.nullable(),
  })
  .strict();
export const materialFocusAnalysisRetryResponseSchema = materialFocusAnalysisStatusIdentitySchema
  .extend({
    retryOfAnalysisId: z.uuid(),
    counts: z
      .object({
        inherited: count,
        analyzed: count,
        offlineReplay: count,
        failed: count,
        unstarted: count,
      })
      .strict(),
  })
  .strict();
export type MaterialFocusAnalysisStatusIdentity = z.infer<
  typeof materialFocusAnalysisStatusIdentitySchema
>;
export type MaterialFocusAnalysisRetryRequest = z.infer<
  typeof materialFocusAnalysisRetryRequestSchema
>;
export type MaterialFocusAnalysisRetryResponse = z.infer<
  typeof materialFocusAnalysisRetryResponseSchema
>;
export const materialFocusChunkDescriptorSchema = z
  .object({
    chunkIndex: count,
    chunkSha256: sha,
    codePointStart: count,
    codePointEnd: count,
    utf8ByteStart: count,
    utf8ByteEnd: count,
  })
  .strict()
  .superRefine((chunk, context) => {
    if (
      chunk.codePointEnd <= chunk.codePointStart ||
      chunk.utf8ByteEnd <= chunk.utf8ByteStart ||
      chunk.codePointEnd - chunk.codePointStart > 16_000 ||
      chunk.utf8ByteEnd - chunk.utf8ByteStart > 64_000
    )
      context.addIssue({
        code: 'custom',
        message: 'Analysis chunks retain exact bounded source extents.',
      });
  });
export const materialFocusStreamSnapshotSchema = z
  .object({
    streamId: identifier,
    manifest: materialPageTextManifestSchema,
    chunks: z.array(materialFocusChunkDescriptorSchema).max(8192),
  })
  .strict()
  .superRefine((stream, context) => {
    let points = 0,
      bytes = 0;
    if (stream.chunks.length !== stream.manifest.chunkCount)
      context.addIssue({
        code: 'custom',
        message: 'Inventory every declared source chunk.',
      });
    for (const [index, chunk] of stream.chunks.entries()) {
      if (
        chunk.chunkIndex !== index ||
        chunk.codePointStart !== points ||
        chunk.utf8ByteStart !== bytes
      )
        context.addIssue({
          code: 'custom',
          message: 'Chunk inventory must be contiguous and ordered from zero.',
        });
      points = chunk.codePointEnd;
      bytes = chunk.utf8ByteEnd;
    }
    if (points !== stream.manifest.codePointLength || bytes !== stream.manifest.utf8ByteLength)
      context.addIssue({
        code: 'custom',
        message: 'Chunk inventory must cover the complete stream.',
      });
  });
export const materialFocusMaterialSnapshotSchema = z
  .object({
    sourceKind: z.literal('MATERIAL'),
    materialId: identifier,
    userId: identifier,
    runId: identifier,
    processingRevision: count.positive(),
    materialGeneration: count.positive(),
    originalSha256: sha,
    name: z
      .string()
      .min(1)
      .max(240)
      .regex(/^[^\u0000-\u001f\u007f]+$/),
    extractorVersion: identifier,
    rendererVersion: identifier,
    pageCount: count.positive().max(MATERIAL_FOCUS_ANALYSIS_LIMITS.pages),
    pages: z
      .array(
        z
          .object({
            pageNumber: count.positive(),
            embeddedText: materialEmbeddedTextStateSchema,
            visual: materialVisualCoverageSchema,
            streams: z.array(materialFocusStreamSnapshotSchema).max(2),
          })
          .strict()
      )
      .max(MATERIAL_FOCUS_ANALYSIS_LIMITS.pages),
  })
  .strict()
  .superRefine((material, context) => {
    const ledger = materialExtractionLedgerSchema.safeParse({
      schemaVersion: 1,
      materialSha256: material.originalSha256,
      extractor: {
        method: 'SAVED_PAGE_STREAMS',
        version: material.extractorVersion,
      },
      pageCount: material.pageCount,
      pages: material.pages.map((page) => ({
        pageNumber: page.pageNumber,
        embeddedText: page.embeddedText,
        visual: page.visual,
        textStreams: page.streams.map((stream) => stream.manifest),
      })),
    });
    if (!ledger.success)
      context.addIssue({
        code: 'custom',
        message: 'Inventory every original page and retained text origin.',
      });
    const streams = material.pages.flatMap((page) => page.streams);
    if (new Set(streams.map((stream) => stream.streamId)).size !== streams.length)
      context.addIssue({
        code: 'custom',
        message: 'Stream identities are unique within the original material.',
      });
  });
export const materialFocusTextSnapshotSchema = z
  .object({
    sourceKind: z.enum(['PASTE', 'COURSE_NOTE']),
    sourceId: identifier,
    userId: identifier,
    revision: count.positive(),
    snapshotSha256: sha,
    name: identifier,
    note: z.object({ id: identifier, revision: identifier }).strict().nullable(),
    stream: materialFocusStreamSnapshotSchema,
  })
  .strict()
  .superRefine((snapshot, context) => {
    if (
      (snapshot.sourceKind === 'COURSE_NOTE') !== (snapshot.note !== null) ||
      snapshot.stream.manifest.pageNumber !== 1 ||
      snapshot.stream.manifest.source.origin !== 'EMBEDDED_TEXT' ||
      snapshot.stream.manifest.source.method !== 'OWNED_UTF8_SNAPSHOT' ||
      snapshot.stream.manifest.textSha256 !== snapshot.snapshotSha256
    )
      context.addIssue({
        code: 'custom',
        message: 'Owned text snapshots retain their complete exact UTF-8 identity.',
      });
  });
export const materialFocusSourceSnapshotSchema = z.discriminatedUnion('sourceKind', [
  materialFocusMaterialSnapshotSchema,
  materialFocusTextSnapshotSchema,
]);
export const materialFocusSelectionSchema = z
  .object({
    provider: identifier,
    model: identifier,
    endpoint: z
      .url()
      .optional()
      .refine((value) => {
        if (value === undefined) return true;
        const url = new URL(value);
        return (
          ['https:', 'http:'].includes(url.protocol) &&
          !url.username &&
          !url.password &&
          !url.search &&
          !url.hash
        );
      }, 'A saved endpoint cannot contain credentials or query parameters.'),
    isolatedImage: identifier.optional(),
    credentialFingerprint: sha.nullable(),
    moderationCredentialFingerprint: sha.nullable().optional(),
  })
  .strict();
export const materialFocusAnalysisIdentitySchema = z
  .object({
    schemaVersion: z.literal(1),
    owner: z.object({ userId: identifier, generation: count.positive() }).strict(),
    course: z.object({ id: identifier, generation: count.positive() }).strict().nullable(),
    nativeLang: language,
    targetLang: language,
    catalog: z.object({ version: count.positive(), sha256: sha }).strict().nullable(),
    analyzer: z
      .object({
        version: identifier,
        runtimeRevision: identifier,
        promptSha256: sha,
        schemaSha256: sha,
        maxOutputTokens: count.min(256).max(32_768),
        selection: materialFocusSelectionSchema,
        cliBinding: z
          .object({
            kind: z.literal('LOCAL_ACCOUNT'),
            fingerprint: sha,
            revision: identifier,
          })
          .strict()
          .nullable(),
      })
      .strict(),
    sources: z
      .array(materialFocusSourceSnapshotSchema)
      .min(1)
      .max(MATERIAL_FOCUS_ANALYSIS_LIMITS.sources),
  })
  .strict()
  .superRefine((identity, context) => {
    if (
      identity.sources.filter((source) => source.sourceKind === 'MATERIAL').length >
      MATERIAL_FOCUS_ANALYSIS_LIMITS.materials
    )
      context.addIssue({
        code: 'custom',
        message: 'An analysis admits at most ten original material sources.',
      });
    const ids = identity.sources.map((source) =>
      source.sourceKind === 'MATERIAL' ? source.materialId : source.sourceId
    );
    if (
      new Set(ids).size !== ids.length ||
      identity.sources.some((source) => source.userId !== identity.owner.userId)
    )
      context.addIssue({
        code: 'custom',
        message: 'Analysis sources belong to one private owner and distinct retained runs.',
      });
    if (
      identity.sources
        .flatMap((source) =>
          source.sourceKind === 'MATERIAL'
            ? source.pages.flatMap((page) => page.streams)
            : [source.stream]
        )
        .reduce((total, stream) => total + stream.chunks.length, 0) >
      MATERIAL_FOCUS_ANALYSIS_LIMITS.chunks
    )
      context.addIssue({
        code: 'custom',
        message: 'The complete chunk inventory exceeds the explicit analysis budget.',
      });
  });
export const materialFocusSourceSchema = materialFocusChunkDescriptorSchema
  .safeExtend({
    sourceKind: z.enum(['MATERIAL', 'PASTE', 'COURSE_NOTE']),
    sourceId: identifier,
    sourceRevision: count.positive(),
    sourceSha256: sha,
    materialId: identifier.nullable(),
    runId: identifier.nullable(),
    processingRevision: count.positive().nullable(),
    streamId: identifier,
    pageNumber: count.positive(),
    origin: z.enum(['EMBEDDED_TEXT', 'VISUAL_RECOGNITION', 'SOURCE_TEXT']),
    pageTextSha256: sha,
  })
  .strict();
export const materialFocusCitationSchema = z
  .object({
    unitId: sha,
    sourceKind: z.enum(['MATERIAL', 'PASTE', 'COURSE_NOTE']),
    sourceId: identifier,
    sourceSha256: sha,
    materialId: identifier.nullable(),
    runId: identifier.nullable(),
    streamId: identifier,
    pageNumber: count.positive(),
    origin: z.enum(['EMBEDDED_TEXT', 'VISUAL_RECOGNITION', 'SOURCE_TEXT']),
    chunkIndex: count,
    chunkSha256: sha,
    pageTextSha256: sha,
    codePointStart: count,
    codePointEnd: count,
    utf8ByteStart: count,
    utf8ByteEnd: count,
    quote: z
      .string()
      .min(1)
      .max(4000)
      .refine((text) => text.isWellFormed() && [...text].length <= 2000),
  })
  .strict()
  .refine(
    (citation) =>
      citation.codePointEnd > citation.codePointStart &&
      citation.utf8ByteEnd > citation.utf8ByteStart,
    'Citations have nonempty half-open source bounds.'
  );
export const materialFocusHeadingSchema = z
  .object({
    title: z
      .string()
      .min(1)
      .max(4000)
      .refine((text) => text.isWellFormed()),
    citations: z.array(materialFocusCitationSchema).min(1).max(3),
  })
  .strict();
export const materialSourceFocusCandidateSchema = z
  .object({
    localId: localKey,
    kind: z.enum(['GRAMMAR', 'SITUATION', 'COMBINED', 'VOCABULARY', 'OTHER']),
    title: z
      .string()
      .min(1)
      .max(240)
      .regex(/^[^\u0000-\u001f\u007f]+$/)
      .refine((text) => text.isWellFormed()),
    description: z
      .string()
      .min(1)
      .max(2000)
      .refine((text) => text.isWellFormed()),
    communicativeIntent: z
      .string()
      .min(1)
      .max(1000)
      .refine((text) => text.isWellFormed())
      .nullable(),
    heading: materialFocusHeadingSchema.nullable(),
    grammarKeys: z
      .array(
        z
          .string()
          .trim()
          .min(1)
          .max(120)
          .refine((text) => text.isWellFormed())
      )
      .max(20),
    objectiveIds: z
      .array(
        z
          .string()
          .min(1)
          .max(120)
          .refine((text) => text.isWellFormed())
      )
      .max(20),
    groupIds: z
      .array(
        z
          .string()
          .min(1)
          .max(120)
          .refine((text) => text.isWellFormed())
      )
      .max(20),
    citations: z
      .array(materialFocusCitationSchema)
      .min(1)
      .max(MATERIAL_FOCUS_ANALYSIS_LIMITS.citationsPerFocus),
    continuation: materialFocusCitationSchema.nullable(),
  })
  .strict();
export const materialFocusChunkResultSchema = z
  .object({
    schemaVersion: z.literal(1),
    analysisIdentityDigest: sha,
    unitId: sha,
    inputDigest: sha,
    coverage: z.object({ chunkSha256: sha, codePointStart: count, codePointEnd: count }).strict(),
    headings: z
      .array(materialFocusHeadingSchema)
      .max(MATERIAL_FOCUS_ANALYSIS_LIMITS.headingsPerChunk),
    focuses: z
      .array(materialSourceFocusCandidateSchema)
      .max(MATERIAL_FOCUS_ANALYSIS_LIMITS.focusesPerChunk),
  })
  .strict()
  .superRefine((result, context) => {
    if (new Set(result.focuses.map((focus) => focus.localId)).size !== result.focuses.length)
      context.addIssue({
        code: 'custom',
        message: 'A chunk response has unique focus identities.',
      });
  });
export const materialFocusChunkReceiptSchema = z
  .object({
    unitId: sha,
    inputDigest: sha,
    status: z.enum(['PENDING', 'ANALYZED', 'FAILED', 'UNKNOWN', 'UNAVAILABLE']),
    resultSha256: sha.nullable(),
    diagnostic: z.string().min(1).max(2000).nullable(),
  })
  .strict()
  .refine(
    (receipt) => (receipt.status === 'ANALYZED') === (receipt.resultSha256 !== null),
    'Only validated complete chunk analysis has a result receipt.'
  );

export const materialFocusAnalysisCoverageSchema = z
  .object({
    expectedChunks: count,
    analyzedChunks: count,
    expectedCodePoints: count,
    analyzedCodePoints: count,
    pendingUnitIds: z.array(sha).max(MATERIAL_FOCUS_ANALYSIS_LIMITS.chunks),
    failedUnitIds: z.array(sha).max(MATERIAL_FOCUS_ANALYSIS_LIMITS.chunks),
    emptyStreams: z.array(
      z
        .object({
          sourceId: identifier,
          pageNumber: count.positive(),
          streamId: identifier,
          textSha256: sha,
        })
        .strict()
    ),
    unresolvedPages: z.array(
      z
        .object({
          sourceId: identifier,
          pageNumber: count.positive(),
          state: z.enum(['UNASSESSED', 'UNAVAILABLE', 'RECOGNITION_NEEDED', 'UNCERTAIN', 'FAILED']),
        })
        .strict()
    ),
    readableTextComplete: z.boolean(),
    originalContentComplete: z.boolean(),
    sufficientSource: z.boolean(),
    status: z.enum(['INSUFFICIENT_SOURCE', 'PARTIAL', 'COMPLETE', 'INCOMPLETE']),
  })
  .strict()
  .superRefine((coverage, context) => {
    const complete = coverage.analyzedChunks === coverage.expectedChunks;
    const status = !coverage.sufficientSource
      ? 'INSUFFICIENT_SOURCE'
      : complete
        ? coverage.unresolvedPages.length
          ? 'PARTIAL'
          : 'COMPLETE'
        : 'INCOMPLETE';
    if (
      coverage.analyzedChunks > coverage.expectedChunks ||
      coverage.analyzedCodePoints > coverage.expectedCodePoints ||
      coverage.readableTextComplete !== complete ||
      coverage.originalContentComplete !== (complete && coverage.unresolvedPages.length === 0) ||
      coverage.status !== status ||
      (complete &&
        (coverage.analyzedCodePoints !== coverage.expectedCodePoints ||
          coverage.pendingUnitIds.length > 0 ||
          coverage.failedUnitIds.length > 0)) ||
      coverage.expectedChunks - coverage.analyzedChunks !==
        coverage.pendingUnitIds.length + coverage.failedUnitIds.length ||
      new Set([...coverage.pendingUnitIds, ...coverage.failedUnitIds]).size !==
        coverage.pendingUnitIds.length + coverage.failedUnitIds.length
    )
      context.addIssue({
        code: 'custom',
        message: 'Coverage must account for every complete, pending, and unresolved source chunk.',
      });
  });
export const materialFocusObjectiveCandidateSchema = z
  .object({
    objectiveId: identifier,
    criterionVersion: count.positive(),
    level: learningLevelSchema,
    relation: z.literal('SOURCE_EXPOSURE_CANDIDATE'),
    bases: z.array(identifier).min(1).max(21),
  })
  .strict();
export const materialFocusCatalogCandidatesSchema = z
  .object({
    status: z.enum(['CATALOG_UNAVAILABLE', 'PARTIAL_CANDIDATES', 'CANDIDATES', 'UNRESOLVED']),
    candidates: z.array(materialFocusObjectiveCandidateSchema),
    groupIds: z.array(identifier),
    unresolvedGrammarKeys: z.array(z.string().min(1).max(120)),
    privateExtension: z.boolean(),
  })
  .strict();
export const materialFocusFragmentSchema = z
  .object({
    id: sha,
    unitId: sha,
    source: materialFocusSourceSchema,
    uncertain: z.boolean(),
    candidate: materialSourceFocusCandidateSchema,
    mapping: materialFocusCatalogCandidatesSchema,
  })
  .strict();
export const materialMergedSourceFocusSchema = z
  .object({
    id: sha,
    order: count,
    title: z
      .string()
      .min(1)
      .max(240)
      .regex(/^[^\u0000-\u001f\u007f]+$/)
      .refine((text) => text.isWellFormed()),
    sourceHeadings: z.array(materialFocusHeadingSchema),
    kind: z.enum(['GRAMMAR', 'SITUATION', 'COMBINED', 'VOCABULARY', 'OTHER']),
    fragments: z.array(materialFocusFragmentSchema).min(1),
    citations: z.array(materialFocusCitationSchema).min(1),
    objectiveCandidates: z.array(materialFocusObjectiveCandidateSchema),
    groupIds: z.array(identifier),
    unresolvedGrammarKeys: z.array(z.string().min(1).max(120)),
    privateExtension: z.boolean(),
    uncertainSource: z.boolean(),
    exposureOnly: z.literal(true),
  })
  .strict();
export const materialFocusMergedResultSchema = z
  .object({
    schemaVersion: z.literal(1),
    analysisIdentityDigest: sha,
    focuses: z
      .array(materialMergedSourceFocusSchema)
      .max(MATERIAL_FOCUS_ANALYSIS_LIMITS.aggregateFocuses),
    headings: z.array(z.object({ heading: materialFocusHeadingSchema, firstUnitId: sha }).strict()),
    concepts: z.array(
      z
        .object({
          objectiveId: identifier,
          criterionVersion: count.positive(),
          focusIds: z.array(sha).min(1),
          relation: z.literal('SOURCE_EXPOSURE_CANDIDATE'),
        })
        .strict()
    ),
    unresolvedBoundaries: z.array(
      z
        .object({
          fragmentId: sha,
          reason: z.enum([
            'MISSING_SOURCE_ANCHOR',
            'AMBIGUOUS_SOURCE_ANCHOR',
            'CONFLICTING_SOURCE_HEADING',
          ]),
        })
        .strict()
    ),
    coverage: materialFocusAnalysisCoverageSchema,
    exposureOnly: z.literal(true),
    resultDigest: sha,
  })
  .strict();

export type MaterialFocusChunkDescriptor = z.infer<typeof materialFocusChunkDescriptorSchema>;
export type MaterialFocusMaterialSnapshot = z.infer<typeof materialFocusMaterialSnapshotSchema>;
export type MaterialFocusSourceSnapshot = z.infer<typeof materialFocusSourceSnapshotSchema>;
export type MaterialFocusTextSnapshot = z.infer<typeof materialFocusTextSnapshotSchema>;
export type MaterialFocusSelection = z.infer<typeof materialFocusSelectionSchema>;
export type MaterialFocusAnalysisIdentity = z.infer<typeof materialFocusAnalysisIdentitySchema>;
export type MaterialFocusSource = z.infer<typeof materialFocusSourceSchema>;
export type MaterialFocusCitation = z.infer<typeof materialFocusCitationSchema>;
export type MaterialFocusHeading = z.infer<typeof materialFocusHeadingSchema>;
export type MaterialSourceFocusCandidate = z.infer<typeof materialSourceFocusCandidateSchema>;
export type MaterialFocusChunkResult = z.infer<typeof materialFocusChunkResultSchema>;
export type MaterialFocusChunkReceipt = z.infer<typeof materialFocusChunkReceiptSchema>;
export type MaterialFocusAnalysisCoverage = z.infer<typeof materialFocusAnalysisCoverageSchema>;
export type MaterialFocusObjectiveCandidate = z.infer<typeof materialFocusObjectiveCandidateSchema>;
export type MaterialFocusCatalogCandidates = z.infer<typeof materialFocusCatalogCandidatesSchema>;
export type MaterialFocusFragment = z.infer<typeof materialFocusFragmentSchema>;
export type MaterialMergedSourceFocus = z.infer<typeof materialMergedSourceFocusSchema>;
export type MaterialFocusMergedResult = z.infer<typeof materialFocusMergedResultSchema>;
