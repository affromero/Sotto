import { materialPageTextManifestSchema, materialVisualCoverageSchema } from '@sotto/shared';
import { createHash } from 'node:crypto';
import type { Prisma } from '@/generated/prisma/client';

export function decodeMaterialTextChunk(chunk: {
  textBytes: Uint8Array;
  sha256: string;
  codePointStart: number;
  codePointEnd: number;
}) {
  const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(chunk.textBytes);
  if (
    createHash('sha256').update(chunk.textBytes).digest('hex') !== chunk.sha256 ||
    [...text].length !== chunk.codePointEnd - chunk.codePointStart
  )
    throw new Error('Material source chunk checksum or offsets changed.');
  return text;
}

/** A recognized page supersedes its embedded text for context, while both originals remain retained. */
export async function materialTextInventory(
  database: Prisma.TransactionClient,
  input: {
    userId: string;
    materialId: string;
    processingRevision: number;
  }
) {
  const run = await database.materialExtractionRun.findFirst({
    where: {
      materialId: input.materialId,
      processingRevision: input.processingRevision,
      status: { in: ['COMPLETE', 'PARTIAL'] },
      material: {
        userId: input.userId,
        processingRevision: input.processingRevision,
        originalUrl: { not: null },
      },
    },
    include: { pages: { orderBy: { pageNumber: 'asc' }, include: { textStreams: true } } },
  });
  if (!run) throw new Error('Complete the material extraction before selecting source text.');
  let length = 0;
  const streams = run.pages.flatMap((page) => {
    const visual = materialVisualCoverageSchema.parse(page.visualCoverage);
    const stream =
      (visual.state === 'RECOGNIZED'
        ? page.textStreams.find((item) => item.origin === 'VISUAL_RECOGNITION')
        : undefined) ?? page.textStreams.find((item) => item.origin === 'EMBEDDED_TEXT');
    if (!stream) return [];
    const manifest = materialPageTextManifestSchema.parse(stream.manifest);
    if (manifest.pageNumber !== page.pageNumber || manifest.source.origin !== stream.origin)
      throw new Error('Material text provenance changed.');
    const start = length;
    length += manifest.codePointLength + 1;
    return [{ id: stream.id, pageNumber: page.pageNumber, manifest, start, end: length }];
  });
  return {
    runId: run.id,
    originalSha256: run.originalSha256,
    coverage: run.coverage,
    length,
    streams,
  };
}

/** Read only chunks intersecting the planned code-point range, preserving exact UTF-8 bytes. */
export async function readMaterialTextRange(
  database: Prisma.TransactionClient,
  inventory: Awaited<ReturnType<typeof materialTextInventory>>,
  start: number,
  end: number
) {
  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(end) ||
    start < 0 ||
    end <= start ||
    end > inventory.length ||
    end - start > 12000
  )
    throw new Error('Invalid material text source range.');
  const pieces: string[] = [];
  for (const stream of inventory.streams) {
    if (stream.start >= end || stream.end <= start) continue;
    const localStart = Math.max(0, start - stream.start);
    const localEnd = Math.min(stream.manifest.codePointLength, end - stream.start);
    if (localEnd > localStart) {
      const chunks = await database.materialTextChunk.findMany({
        where: {
          streamId: stream.id,
          codePointStart: { lt: localEnd },
          codePointEnd: { gt: localStart },
        },
        orderBy: { index: 'asc' },
      });
      let cursor = localStart;
      for (const chunk of chunks) {
        if (chunk.codePointStart > cursor)
          throw new Error('A material source range has missing chunks.');
        const text = decodeMaterialTextChunk(chunk);
        const points = [...text];
        if (points.length !== chunk.codePointEnd - chunk.codePointStart)
          throw new Error('Material source offsets no longer match its text.');
        const stop = Math.min(localEnd, chunk.codePointEnd);
        pieces.push(
          points.slice(cursor - chunk.codePointStart, stop - chunk.codePointStart).join('')
        );
        cursor = stop;
      }
      if (cursor !== localEnd) throw new Error('A material source range is incomplete.');
    }
    if (start <= stream.end - 1 && end >= stream.end) pieces.push('\n');
  }
  const text = pieces.join('');
  if ([...text].length !== end - start)
    throw new Error('A material source range lost text coverage.');
  return text;
}
