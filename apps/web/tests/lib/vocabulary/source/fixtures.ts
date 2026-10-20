import { randomUUID } from 'node:crypto';
import { prepareMaterialPageText } from '@/lib/course-materials/extraction/chunks';
import type { LearningDatabase } from '@/lib/learning/database';

export function canonicalSourceFixture(texts: readonly string[], complete = true) {
  const material = {
    id: randomUUID(),
    userId: 'owner',
    createdAt: new Date('2026-10-20T00:00:00Z'),
    processingRevision: 1,
    originalSha256: 'a'.repeat(64),
  };
  const rows: Array<{
    id: string;
    streamId: string;
    index: number;
    sha256: string;
    codePointStart: number;
    codePointEnd: number;
    utf8ByteStart: number;
    utf8ByteEnd: number;
    textBytes: Uint8Array<ArrayBuffer>;
  }> = [];
  const pages = texts.map((text, index) => {
    const prepared = prepareMaterialPageText({
      pageNumber: index + 1,
      source: { origin: 'EMBEDDED_TEXT', method: 'synthetic-complete-text', version: '1' },
      text,
    });
    const id = randomUUID();
    for (const chunk of prepared.chunks)
      rows.push({
        id: randomUUID(),
        streamId: id,
        index: chunk.index,
        sha256: chunk.sha256,
        codePointStart: chunk.codePointStart,
        codePointEnd: chunk.codePointEnd,
        utf8ByteStart: chunk.utf8ByteStart,
        utf8ByteEnd: chunk.utf8ByteEnd,
        textBytes: Buffer.from(chunk.text, 'utf8'),
      });
    return {
      pageNumber: index + 1,
      visualCoverage: complete
        ? {
            state: 'TEXT_SOURCE',
            originalSha256: material.originalSha256,
            diagnostic: 'Owned synthetic source',
          }
        : { state: 'UNAVAILABLE', diagnostic: 'Handwriting is unresolved.' },
      textStreams: [{ id, origin: 'EMBEDDED_TEXT', manifest: prepared.manifest }],
    };
  });
  const run = {
    pageCount: pages.length,
    id: randomUUID(),
    originalSha256: material.originalSha256,
    coverage: { coverageComplete: complete, unresolvedPageNumbers: complete ? [] : [1] },
    pages,
  };
  const reads: Array<{ streamId: string; start?: number; end?: number; take?: number }> = [];
  const database = {
    materialExtractionRun: { findFirst: async () => run },
    materialTextChunk: {
      findMany: async ({
        where,
        take,
      }: {
        where: {
          streamId: string;
          index?: { gt: number };
          codePointStart?: { lt: number };
          codePointEnd?: { gt: number };
        };
        take?: number;
      }) => {
        reads.push({
          streamId: where.streamId,
          start: where.codePointEnd?.gt,
          end: where.codePointStart?.lt,
          take,
        });
        return rows
          .filter(
            (row) =>
              row.streamId === where.streamId &&
              (!where.index || row.index > where.index.gt) &&
              (!where.codePointStart || row.codePointStart < where.codePointStart.lt) &&
              (!where.codePointEnd || row.codePointEnd > where.codePointEnd.gt)
          )
          .slice(0, take);
      },
    },
  } as unknown as LearningDatabase;
  return { material, rows, run, database, reads, text: texts.map((text) => `${text}\n`).join('') };
}
