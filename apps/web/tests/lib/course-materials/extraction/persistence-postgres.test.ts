// @vitest-environment node
import { createHash, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Prisma } from '@/generated/prisma/client';
import type {
  MaterialPageTextManifest,
  MaterialTextChunk,
  MaterialTextSource,
} from '@sotto/shared';
import { prepareMaterialPageText } from '@/lib/course-materials/extraction/chunks';
import {
  finishMaterialExtraction,
  initializeMaterialPages,
  publishMaterialPageText,
  type MaterialRunIdentity,
} from '@/lib/course-materials/extraction/persistence';
import { materialPdfPageSchema } from '@/lib/course-materials/extraction/pdf-protocol';
import { sottoTransaction } from '@/lib/sidedoor/access/state/transaction';
import {
  createSharedTestInstance,
  type SharedTestInstance,
  type SharedTestIdentity,
} from '../../../helpers/setup/shared-instance';

const suite = process.env.SIDEDOOR_TEST_DATABASE_URL ? describe : describe.skip;
const originalSha256 = 'a'.repeat(64);
const extractorVersion = 'fixture-extractor-1';
const rendererVersion = 'fixture-renderer-1';
const embeddedSource: MaterialTextSource = {
  origin: 'EMBEDDED_TEXT',
  method: 'PDFJS_TEXT_CONTENT',
  version: extractorVersion,
};
const recognitionSource: MaterialTextSource = {
  origin: 'VISUAL_RECOGNITION',
  method: 'FIXTURE_FULL_PAGE_RECOGNITION',
  version: 'fixture-recognizer-1',
};
const digest = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

suite('owned material page text persistence', () => {
  let instance: SharedTestInstance;
  let identity: SharedTestIdentity;
  beforeAll(async () => {
    instance = await createSharedTestInstance('material_extraction');
  });
  beforeEach(async () => {
    identity = await instance.reset();
  });
  afterAll(async () => {
    await instance?.close();
  });

  // These services run inside an existing owned job transaction. Provider and
  // durable-job authority are covered by their boundary suites, not mocked here.
  const transaction = <Result>(
    operation: (database: Prisma.TransactionClient) => Promise<Result>
  ) => sottoTransaction(instance.database, operation, { timeoutMs: 60_000 });

  async function fixture(pageCount = 1): Promise<MaterialRunIdentity> {
    const material = await instance.database.courseMaterial.create({
      data: {
        userId: identity.ownerId,
        name: 'Private original.pdf',
        mimeType: 'application/pdf',
        byteSize: 42,
        originalUrl: `materials/${randomUUID()}/original.pdf`,
        originalSha256,
        extractedText: '',
        processingStatus: 'EXTRACTING',
      },
    });
    const run = await instance.database.materialExtractionRun.create({
      data: {
        materialId: material.id,
        processingRevision: material.processingRevision,
        runKey: digest(Buffer.from(randomUUID())),
        originalSha256,
        extractorVersion,
        rendererVersion,
        recognitionPolicy: { method: 'EXPLICIT_FULL_PAGE', version: 1 },
      },
    });
    const input = {
      userId: identity.ownerId,
      materialId: material.id,
      runId: run.id,
      processingRevision: material.processingRevision,
      originalSha256,
    };
    await transaction((database) => initializeMaterialPages(database, input, pageCount));
    return input;
  }

  function prepare(text: string, pageNumber = 1, source = embeddedSource) {
    return prepareMaterialPageText({ text, pageNumber, source });
  }

  async function publish(
    input: MaterialRunIdentity,
    text: string,
    pageNumber = 1,
    source = embeddedSource
  ) {
    const prepared = prepare(text, pageNumber, source);
    return transaction((database) =>
      publishMaterialPageText(database, input, prepared.manifest, prepared.chunks)
    );
  }

  async function savedChunks(streamId: string) {
    return instance.database.materialTextChunk.findMany({
      where: { streamId },
      orderBy: { index: 'asc' },
    });
  }

  async function expectUnpublished(input: MaterialRunIdentity) {
    expect(
      await instance.database.materialPageText.count({
        where: { page: { runId: input.runId } },
      })
    ).toBe(0);
    expect(
      await instance.database.materialTextChunk.count({
        where: { stream: { page: { runId: input.runId } } },
      })
    ).toBe(0);
    const page = await instance.database.materialPage.findUniqueOrThrow({
      where: { runId_pageNumber: { runId: input.runId, pageNumber: 1 } },
    });
    expect(page.embeddedText).toEqual({ state: 'PENDING' });
  }

  // An owned render is the boundary fixture. It follows the actual parser DTO,
  // including full-page image metadata. No renderer, storage or OCR is simulated.
  async function coverPage(input: MaterialRunIdentity, manifest: MaterialPageTextManifest) {
    const imageSha256 = 'c'.repeat(64);
    const page = materialPdfPageSchema.parse({
      schemaVersion: 1,
      pageNumber: manifest.pageNumber,
      width: 595,
      height: 842,
      rotation: 0,
      text: {
        state: 'EXTRACTED',
        manifest,
        artifact: {
          file: 'page-text.utf8',
          sha256: manifest.textSha256,
          byteSize: manifest.utf8ByteLength,
        },
        chunksArtifact: null,
        positionsArtifact: null,
      },
      image: {
        file: 'page.png',
        sha256: imageSha256,
        byteSize: 42,
        width: 595,
        height: 842,
        scale: 1,
        mimeType: 'image/png',
        rgbaSha256: 'd'.repeat(64),
      },
      annotationsArtifact: null,
      annotationMeaningSha256: null,
      annotationCount: 0,
      visualState: 'RECOGNITION_NEEDED',
      diagnostics: [],
    });
    return instance.database.materialPage.update({
      where: {
        runId_pageNumber: {
          runId: input.runId,
          pageNumber: manifest.pageNumber,
        },
      },
      data: {
        width: page.width,
        height: page.height,
        rotation: page.rotation,
        pageImageSha256: imageSha256,
        renderIdentity: { originalSha256, rendererVersion, page },
        visualCoverage: {
          state: 'TEXT_COVERED',
          assessor: { method: 'FIXTURE_FULL_PAGE_ASSESSMENT', version: '1' },
          pageImageSha256: imageSha256,
          extent: 'FULL_PAGE',
          diagnostic: 'Owned fixture assessment covers all visible page content.',
        },
      },
    });
  }

  it('retains NUL, combining sequences, supplementary characters and exact UTF-8 offsets', async () => {
    const input = await fixture();
    const text = '\uFEFFNUL:\u0000 e\u0301 é 😀 𠮷 👩\u200D💻\r\nfinal\u0000';
    const prepared = prepareMaterialPageText(
      { text, pageNumber: 1, source: embeddedSource },
      { codePoints: 3, utf8Bytes: 12 }
    );
    const stream = await transaction((database) =>
      publishMaterialPageText(database, input, prepared.manifest, prepared.chunks)
    );
    const rows = await savedChunks(stream.id);
    const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
    expect(rows.map((row) => decoder.decode(row.textBytes)).join('')).toBe(text);
    expect(Buffer.concat(rows.map((row) => Buffer.from(row.textBytes)))).toEqual(
      Buffer.from(text, 'utf8')
    );
    let points = 0;
    let bytes = 0;
    for (const row of rows) {
      const decoded = decoder.decode(row.textBytes);
      expect(row.codePointStart).toBe(points);
      expect(row.utf8ByteStart).toBe(bytes);
      expect(row.sha256).toBe(digest(row.textBytes));
      points += [...decoded].length;
      bytes += row.textBytes.byteLength;
      expect(row.codePointEnd).toBe(points);
      expect(row.utf8ByteEnd).toBe(bytes);
    }
    expect(points).toBe(prepared.manifest.codePointLength);
    expect(bytes).toBe(prepared.manifest.utf8ByteLength);
    expect(digest(Buffer.concat(rows.map((row) => Buffer.from(row.textBytes))))).toBe(
      prepared.manifest.textSha256
    );
  });

  it('retains more than one million code points through the final chunk without truncation', async () => {
    const input = await fixture();
    const ending = '\nFINAL PAGE FOCUS: Konjunktiv II 😀\u0000';
    const text = 'é😀e\u0301'.repeat(260_000) + ending;
    const prepared = prepare(text);
    expect(prepared.manifest.codePointLength).toBeGreaterThan(1_000_000);
    const stream = await transaction((database) =>
      publishMaterialPageText(database, input, prepared.manifest, prepared.chunks)
    );
    const rows = await savedChunks(stream.id);
    expect(rows.length).toBe(prepared.manifest.chunkCount);
    expect(
      rows
        .map((row) =>
          new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(row.textBytes)
        )
        .join('')
    ).toBe(text);
    expect(Buffer.from(rows.at(-1)!.textBytes).toString('utf8')).toContain(ending);
    expect(rows.at(-1)!.codePointEnd).toBe(prepared.manifest.codePointLength);
    expect(rows.at(-1)!.utf8ByteEnd).toBe(prepared.manifest.utf8ByteLength);
  }, 60_000);

  it.each(['missing', 'changed', 'throws'] as const)(
    'rolls back every inserted batch when the chunk iterator %s at the end',
    async (failure) => {
      const input = await fixture();
      const prepared = prepare('x'.repeat(16_000 * 52 + 7));
      function* chunks(): Generator<MaterialTextChunk> {
        for (const chunk of prepared.chunks) {
          if (chunk.index === prepared.manifest.chunkCount - 1) {
            if (failure === 'missing') return;
            if (failure === 'throws')
              throw new Error('Fixture iterator failed after the first insertion batch.');
            const text = 'y'.repeat(chunk.text.length);
            yield { ...chunk, text, sha256: digest(Buffer.from(text)) };
            return;
          }
          yield chunk;
        }
      }
      await expect(
        transaction((database) =>
          publishMaterialPageText(database, input, prepared.manifest, chunks())
        )
      ).rejects.toThrow();
      await expectUnpublished(input);
      const original = await instance.database.courseMaterial.findUniqueOrThrow({
        where: { id: input.materialId },
      });
      expect(original.originalSha256).toBe(originalSha256);
      expect(original.originalUrl).not.toBeNull();
    }
  );

  it('replays the same publication with stable immutable stream and chunk identities', async () => {
    const input = await fixture();
    const text = 'Exact notes e\u0301 😀\u0000';
    const stream = await publish(input, text);
    const before = await savedChunks(stream.id);
    expect((await publish(input, text)).id).toBe(stream.id);
    expect(await savedChunks(stream.id)).toEqual(before);
    await expect(publish(input, `${text} changed`)).rejects.toThrow();
    expect(await savedChunks(stream.id)).toEqual(before);
    expect(await instance.database.materialPageText.count()).toBe(1);
  });

  it('keeps embedded text and visual recognition as independent immutable origins', async () => {
    const input = await fixture();
    const embedded = await publish(input, 'Printed heading');
    const recognized = await publish(
      input,
      'Printed heading\nHandwritten: e\u0301 😀',
      1,
      recognitionSource
    );
    expect(embedded.id).not.toBe(recognized.id);
    expect(
      await instance.database.materialPageText.findMany({
        orderBy: { origin: 'asc' },
        select: { id: true, origin: true },
      })
    ).toEqual([
      { id: embedded.id, origin: 'EMBEDDED_TEXT' },
      { id: recognized.id, origin: 'VISUAL_RECOGNITION' },
    ]);
    expect(
      Buffer.concat(
        (await savedChunks(embedded.id)).map((row) => Buffer.from(row.textBytes))
      ).toString('utf8')
    ).toBe('Printed heading');
    expect(
      Buffer.concat(
        (await savedChunks(recognized.id)).map((row) => Buffer.from(row.textBytes))
      ).toString('utf8')
    ).toBe('Printed heading\nHandwritten: e\u0301 😀');
  });

  it.each(['owner', 'run', 'digest', 'revision', 'material'] as const)(
    'rejects publication when the captured %s identity differs',
    async (field) => {
      const input = await fixture();
      const changed = { ...input };
      if (field === 'owner') changed.userId = randomUUID();
      if (field === 'run') changed.runId = randomUUID();
      if (field === 'digest') changed.originalSha256 = 'b'.repeat(64);
      if (field === 'revision') changed.processingRevision += 1;
      if (field === 'material') changed.materialId = randomUUID();
      await expect(publish(changed, 'Private source')).rejects.toThrow();
      await expectUnpublished(input);
    }
  );

  it('rejects a stale worker after the material processing revision or original digest changes', async () => {
    const input = await fixture();
    await instance.database.courseMaterial.update({
      where: { id: input.materialId },
      data: { processingRevision: input.processingRevision + 1 },
    });
    await expect(publish(input, 'Old worker')).rejects.toThrow();
    await instance.database.courseMaterial.update({
      where: { id: input.materialId },
      data: {
        processingRevision: input.processingRevision,
        originalSha256: 'b'.repeat(64),
      },
    });
    await expect(publish(input, 'Old original')).rejects.toThrow();
    await expectUnpublished(input);
  });

  it('replays completed receipts without reopening or adding a new source origin', async () => {
    const input = await fixture();
    const text = 'Completely covered printed page';
    await publish(input, text);
    await coverPage(input, prepare(text).manifest);
    const coverage = await transaction((database) => finishMaterialExtraction(database, input));
    expect(coverage.coverageComplete).toBe(true);
    const before = await instance.database.materialExtractionRun.findUniqueOrThrow({
      where: { id: input.runId },
    });
    await transaction((database) => initializeMaterialPages(database, input, 1));
    expect(await transaction((database) => finishMaterialExtraction(database, input))).toEqual(
      coverage
    );
    expect(
      await instance.database.materialVocabularyIndex.findMany({
        where: { materialId: input.materialId },
      })
    ).toEqual([]);
    expect(
      await instance.database.materialExtractionRun.findUniqueOrThrow({
        where: { id: input.runId },
      })
    ).toEqual(before);
    await expect(
      transaction((database) => initializeMaterialPages(database, input, 2))
    ).rejects.toThrow();
    await expect(publish(input, 'Replacement text')).rejects.toThrow();
    await expect(publish(input, 'New recognition origin', 1, recognitionSource)).rejects.toThrow();
    expect(await instance.database.materialPageText.count()).toBe(1);
    expect(
      await instance.database.materialExtractionRun.findUniqueOrThrow({
        where: { id: input.runId },
      })
    ).toEqual(before);
    expect(
      (
        await instance.database.courseMaterial.findUniqueOrThrow({
          where: { id: input.materialId },
        })
      ).processingStatus
    ).toBe('READY');
  });

  it.each([
    'visual-image',
    'render-image',
    'page-number',
    'original-digest',
    'renderer-version',
  ] as const)(
    'rejects coverage when %s does not match the owned original render',
    async (field) => {
      const input = await fixture();
      const text = 'Visible source';
      await publish(input, text);
      const row = await coverPage(input, prepare(text).manifest);
      const render = {
        originalSha256,
        rendererVersion,
        page: materialPdfPageSchema.parse((row.renderIdentity as Prisma.JsonObject).page),
      };
      const visual = {
        state: 'TEXT_COVERED',
        assessor: { method: 'FIXTURE_FULL_PAGE_ASSESSMENT', version: '1' },
        pageImageSha256: 'c'.repeat(64),
        extent: 'FULL_PAGE',
        diagnostic: 'Fixture coverage evidence.',
      };
      if (field === 'visual-image') visual.pageImageSha256 = 'e'.repeat(64);
      if (field === 'render-image' && render.page.image) render.page.image.sha256 = 'e'.repeat(64);
      if (field === 'page-number') render.page.pageNumber = 2;
      if (field === 'original-digest') render.originalSha256 = 'e'.repeat(64);
      if (field === 'renderer-version') render.rendererVersion = 'different-renderer';
      await instance.database.materialPage.update({
        where: { id: row.id },
        data: { renderIdentity: render, visualCoverage: visual },
      });
      await expect(
        transaction((database) => finishMaterialExtraction(database, input))
      ).rejects.toThrow();
      const run = await instance.database.materialExtractionRun.findUniqueOrThrow({
        where: { id: input.runId },
      });
      expect(run.status).toBe('EXTRACTING');
      expect(run.completedAt).toBeNull();
      expect(run.coverage).toBeNull();
      expect(
        (
          await instance.database.courseMaterial.findUniqueOrThrow({
            where: { id: input.materialId },
          })
        ).processingStatus
      ).toBe('EXTRACTING');
    }
  );

  it('keeps unread and missing pages visible rather than declaring full document coverage', async () => {
    const input = await fixture(2);
    const text = 'First page only';
    await publish(input, text);
    await coverPage(input, prepare(text).manifest);
    const coverage = await transaction((database) => finishMaterialExtraction(database, input));
    expect(coverage).toMatchObject({
      pageCount: 2,
      readablePageCount: 1,
      coverageComplete: false,
      processingComplete: false,
      pendingPageNumbers: [2],
      unresolvedPageNumbers: [2],
    });
    expect(
      (
        await instance.database.materialExtractionRun.findUniqueOrThrow({
          where: { id: input.runId },
        })
      ).status
    ).toBe('PARTIAL');
    const missing = await fixture(2);
    await instance.database.materialPage.delete({
      where: { runId_pageNumber: { runId: missing.runId, pageNumber: 2 } },
    });
    await expect(
      transaction((database) => finishMaterialExtraction(database, missing))
    ).rejects.toThrow();
    expect(
      (
        await instance.database.materialExtractionRun.findUniqueOrThrow({
          where: { id: missing.runId },
        })
      ).status
    ).toBe('EXTRACTING');
  });
});
