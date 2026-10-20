import { z } from 'zod';
import { materialPageTextManifestSchema } from '@sotto/shared';
import type { LearningDatabase } from '../../learning/database';
import { learningProviderInputHash } from '../../learning/preparation/identity';
import {
  materialTextInventory,
  decodeMaterialTextChunk,
} from '../../course-materials/extraction/readers';
import { createMaterialTextChunkValidator } from '../../course-materials/extraction/chunks';
import { VocabularyStudyUnavailable } from '../study-state';

const integer = z.number().int().nonnegative();
const sha = z.string().regex(/^[a-f0-9]{64}$/);
export const canonicalVocabularySourceSchema = z
  .object({
    schemaVersion: z.literal(2),
    coordinateSystem: z.literal('MATERIAL_CODEPOINTS'),
    materialId: z.string(),
    materialGeneration: z.number().int().positive(),
    processingRevision: z.number().int().positive(),
    inventory: z
      .object({
        runId: z.string(),
        originalSha256: sha,
        length: integer,
        coverage: z
          .object({
            coverageComplete: z.boolean(),
            unresolvedPageNumbers: z.array(z.number().int().positive()),
          })
          .catchall(z.json()),
        streams: z.array(
          z
            .object({
              id: z.string(),
              pageNumber: z.number().int().positive(),
              manifest: materialPageTextManifestSchema,
              start: integer,
              end: integer,
              chunks: z.array(
                z
                  .object({
                    index: integer,
                    sha256: sha,
                    codePointStart: integer,
                    codePointEnd: integer,
                    utf8ByteStart: integer,
                    utf8ByteEnd: integer,
                  })
                  .strict()
              ),
            })
            .strict()
        ),
      })
      .strict(),
  })
  .strict();
export type CanonicalVocabularySource = z.infer<typeof canonicalVocabularySourceSchema>;
export const canonicalVocabularySourceHash = (source: CanonicalVocabularySource) =>
  learningProviderInputHash(source);

async function requirePageAccounting(
  database: LearningDatabase,
  runId: string,
  materialId: string
) {
  const run = await database.materialExtractionRun.findFirst({
    where: { id: runId, materialId },
    select: {
      pageCount: true,
      pages: { select: { pageNumber: true }, orderBy: { pageNumber: 'asc' } },
    },
  });
  if (
    !run?.pageCount ||
    run.pages.length !== run.pageCount ||
    run.pages.some((page, index) => page.pageNumber !== index + 1)
  )
    throw new VocabularyStudyUnavailable('The original source page accounting is incomplete.');
}

/** Seal byte-verified manifests and bounded chunk identities, never document text. */
export async function captureCanonicalVocabularySource(
  database: LearningDatabase,
  material: {
    id: string;
    userId: string;
    createdAt: Date;
    processingRevision: number;
    originalSha256: string | null;
  }
): Promise<CanonicalVocabularySource> {
  const inventory = await materialTextInventory(database, {
    userId: material.userId,
    materialId: material.id,
    processingRevision: material.processingRevision,
  });
  await requirePageAccounting(database, inventory.runId, material.id);
  if (inventory.originalSha256 !== material.originalSha256)
    throw new VocabularyStudyUnavailable('Material original identity changed.');
  const streams = [];
  for (const stream of inventory.streams) {
    const validator = createMaterialTextChunkValidator(stream.manifest);
    const chunks = [];
    let after = -1;
    while (true) {
      const rows = await database.materialTextChunk.findMany({
        where: { streamId: stream.id, index: { gt: after } },
        orderBy: { index: 'asc' },
        take: 100,
      });
      for (const row of rows) {
        const identity = {
          index: row.index,
          sha256: row.sha256,
          codePointStart: row.codePointStart,
          codePointEnd: row.codePointEnd,
          utf8ByteStart: row.utf8ByteStart,
          utf8ByteEnd: row.utf8ByteEnd,
        };
        validator.accept({
          schemaVersion: 1,
          pageNumber: stream.pageNumber,
          origin: stream.manifest.source.origin,
          pageTextSha256: stream.manifest.textSha256,
          ...identity,
          text: decodeMaterialTextChunk(row),
        });
        chunks.push(identity);
      }
      if (rows.length < 100) break;
      after = rows.at(-1)!.index;
    }
    validator.finish();
    streams.push({ ...stream, chunks });
  }
  return canonicalVocabularySourceSchema.parse({
    schemaVersion: 2,
    coordinateSystem: 'MATERIAL_CODEPOINTS',
    materialId: material.id,
    materialGeneration: material.createdAt.getTime(),
    processingRevision: material.processingRevision,
    inventory: { ...inventory, streams },
  });
}

/** Recheck live authority and immutable metadata; range reads check pinned byte identities. */
export async function validateCanonicalVocabularySource(
  database: LearningDatabase,
  material: {
    id: string;
    userId: string;
    createdAt: Date;
    processingRevision: number;
    originalSha256: string | null;
  },
  input: unknown
) {
  const source = canonicalVocabularySourceSchema.parse(input);
  if (
    source.materialId !== material.id ||
    source.materialGeneration !== material.createdAt.getTime() ||
    source.processingRevision !== material.processingRevision ||
    source.inventory.originalSha256 !== material.originalSha256
  )
    throw new VocabularyStudyUnavailable('The indexed material revision changed.');
  const current = await materialTextInventory(database, {
    userId: material.userId,
    materialId: material.id,
    processingRevision: material.processingRevision,
  });
  await requirePageAccounting(database, current.runId, material.id);
  const { streams, ...identity } = source.inventory;
  const expected = {
    ...identity,
    streams: streams.map((stream) => ({
      id: stream.id,
      pageNumber: stream.pageNumber,
      manifest: stream.manifest,
      start: stream.start,
      end: stream.end,
    })),
  };
  if (learningProviderInputHash(current) !== learningProviderInputHash(expected))
    throw new VocabularyStudyUnavailable('The indexed extraction run or page manifests changed.');
  return source;
}
