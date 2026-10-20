// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@/generated/prisma/client';
import {
  createSharedTestInstance,
  type SharedTestInstance,
  type SharedTestIdentity,
} from '../../../helpers/setup/shared-instance';
import { sottoTransaction } from '@/lib/sidedoor/access/state/transaction';
import { sottoJobOutbox } from '@/lib/sidedoor/jobs/core/job-delivery';
import {
  captureCanonicalVocabularySource,
  canonicalVocabularySourceHash,
  validateCanonicalVocabularySource,
} from '@/lib/vocabulary/source/snapshot';
import { readMaterialTextRange } from '@/lib/course-materials/extraction/readers';
import { decodeVocabularySourceQuote } from '@/lib/vocabulary/source/publication';
import { updateVocabularyIndexProgress } from '@/lib/vocabulary/index-progress';
import { enqueueMaterialVocabularyIndex } from '@/lib/vocabulary/index-admission';
import { readDictionary } from '@/lib/vocabulary/dictionary';
import { canonicalSourceFixture } from './fixtures';

const boundary = vi.hoisted(() => ({ database: null as PrismaClient | null }));
vi.mock('@/lib/prisma', async () => {
  const { prismaTestBoundary } = await import('../../../helpers/setup/shared-instance');
  const database = prismaTestBoundary(boundary);
  return { prisma: database, prismaUnfiltered: database };
});
const suite = process.env.SIDEDOOR_TEST_DATABASE_URL ? describe : describe.skip;
suite('canonical vocabulary source persistence', () => {
  let instance: SharedTestInstance, identity: SharedTestIdentity;
  beforeAll(async () => {
    instance = await createSharedTestInstance('canonical_vocabulary');
    boundary.database = instance.database;
  });
  beforeEach(async () => {
    identity = await instance.reset();
  });
  afterAll(async () => {
    await instance?.close();
    boundary.database = null;
  });
  async function fixture(complete = true) {
    const data = canonicalSourceFixture(['\uFEFF𠮷 Bahnhof\u0000 Fahrkarte\nEnde'], complete);
    const curriculum = await instance.database.curriculum.upsert({
      where: { nativeLang_targetLang: { nativeLang: 'en', targetLang: 'de' } },
      create: { nativeLang: 'en', targetLang: 'de', title: 'Owned source fixture' },
      update: {},
    });
    const course = await instance.database.course.create({
      data: {
        userId: identity.ownerId,
        curriculumId: curriculum.id,
        nativeLang: 'en',
        targetLang: 'de',
        currentLevel: 'A1',
      },
    });
    const material = await instance.database.courseMaterial.create({
      data: {
        id: data.material.id,
        userId: identity.ownerId,
        courseId: course.id,
        name: 'Owned synthetic.txt',
        mimeType: 'text/plain',
        byteSize: Buffer.byteLength(data.text),
        originalUrl: `materials/${data.material.id}/original.txt`,
        originalSha256: data.material.originalSha256,
        extractedText: '',
        processingStatus: complete ? 'READY' : 'PARTIAL',
      },
    });
    const run = await instance.database.materialExtractionRun.create({
      data: {
        materialId: material.id,
        processingRevision: 1,
        runKey: randomUUID(),
        originalSha256: material.originalSha256!,
        extractorVersion: 'fixture-1',
        rendererVersion: 'NO_VISUAL_LAYER:1',
        recognitionPolicy: { explicit: true },
        status: complete ? 'COMPLETE' : 'PARTIAL',
        pageCount: 1,
        coverage: data.run.coverage,
      },
    });
    const page = await instance.database.materialPage.create({
      data: {
        runId: run.id,
        pageNumber: 1,
        embeddedText: { state: 'EXTRACTED' },
        visualCoverage: data.run.pages[0]!.visualCoverage,
      },
    });
    const stream = await instance.database.materialPageText.create({
      data: {
        pageId: page.id,
        origin: 'EMBEDDED_TEXT',
        manifest: data.run.pages[0]!.textStreams[0]!.manifest,
      },
    });
    await instance.database.materialTextChunk.createMany({
      data: data.rows.map((row) => ({ ...row, streamId: stream.id })),
    });
    const source = await instance.database.$transaction((database) =>
      captureCanonicalVocabularySource(database, material)
    );
    return { material, course, source, text: data.text };
  }
  it('seals source and vocabulary outbox atomically without using the empty legacy field or dispatching a model', async () => {
    const { material, source } = await fixture();
    let rolledBackId: string | null = null;
    await expect(
      sottoTransaction(instance.database, async (database) => {
        const attempted = await enqueueMaterialVocabularyIndex(
          database,
          material.id,
          identity.ownerId
        );
        rolledBackId = attempted.index.id;
        throw new Error('rollback owned publication');
      })
    ).rejects.toThrow('rollback owned publication');
    expect(
      await instance.database.materialVocabularyIndex.count({ where: { materialId: material.id } })
    ).toBe(0);
    expect(
      await instance.database.vocabularyIndexChunk.count({ where: { indexId: rolledBackId! } })
    ).toBe(0);
    const admitted = await sottoTransaction(instance.database, (database) =>
      enqueueMaterialVocabularyIndex(database, material.id, identity.ownerId)
    );
    expect(admitted.index.protocol).toBe(2);
    expect(admitted.index.textLength).toBe(source.inventory.length);
    expect(admitted.index.textHash).toBe(canonicalVocabularySourceHash(source));
    const receipt = await sottoTransaction(instance.database, (database) =>
      sottoJobOutbox(database).read(admitted.delivery!.operationId)
    );
    expect(receipt?.job.handler).toBe('vocabulary-index');
    expect(
      (await instance.database.courseMaterial.findUniqueOrThrow({ where: { id: material.id } }))
        .extractedText
    ).toBe('');
    await expect(
      sottoTransaction(instance.database, async (database) => {
        await enqueueMaterialVocabularyIndex(database, material.id, identity.ownerId);
        throw new Error('rollback owned publication');
      })
    ).rejects.toThrow('rollback owned publication');
    expect(
      await instance.database.materialVocabularyIndex.count({ where: { materialId: material.id } })
    ).toBe(1);
    const again = await sottoTransaction(instance.database, (database) =>
      enqueueMaterialVocabularyIndex(database, material.id, identity.ownerId)
    );
    expect(again.index.id).toBe(admitted.index.id);
    expect(again.delivery?.operationId).toBe(admitted.delivery?.operationId);
  });
  it('roundtrips exact NUL quotations/results through bytea and JSONB-reordered source identities', async () => {
    const { material, course, source } = await fixture();
    const index = await instance.database.materialVocabularyIndex.create({
      data: {
        materialId: material.id,
        courseId: course.id,
        sourceFingerprint: canonicalVocabularySourceHash(source),
        textHash: canonicalVocabularySourceHash(source),
        textLength: source.inventory.length,
        sourceSnapshot: source,
        protocol: 2,
        originalInput: { reference: material.originalUrl },
        materialCreatedAt: material.createdAt,
        nativeLang: 'en',
        targetLang: 'de',
      },
    });
    const saved = await instance.database.materialVocabularyIndex.findUniqueOrThrow({
      where: { id: index.id },
    });
    const reloaded = await instance.database.$transaction((database) =>
      validateCanonicalVocabularySource(database, material, saved.sourceSnapshot)
    );
    expect(canonicalVocabularySourceHash(reloaded)).toBe(index.textHash);
    expect(
      await instance.database.$transaction((database) =>
        readMaterialTextRange(database, reloaded.inventory, 0, reloaded.inventory.length)
      )
    ).toBe('\uFEFF𠮷 Bahnhof\u0000 Fahrkarte\nEnde\n');
    const exact = 'Bahnhof\u0000 Fahrkarte';
    const chunk = await instance.database.vocabularyIndexChunk.create({
      data: {
        indexId: index.id,
        startOffset: 0,
        endOffset: index.textLength,
        status: 'COMPLETE',
        resultBytes: Buffer.from(JSON.stringify([{ sourceForm: exact }]), 'utf8'),
      },
    });
    const word = await instance.database.learnerVocab.create({
      data: { courseId: course.id, lemma: 'Fahrkarte', translation: 'ticket' },
    });
    const occurrence = await instance.database.vocabularySourceOccurrence.create({
      data: {
        wordId: word.id,
        courseId: course.id,
        materialId: material.id,
        chunkId: chunk.id,
        startOffset: 3,
        endOffset: 3 + [...exact].length,
        quoteBytes: Buffer.from(exact, 'utf8'),
        meaning: 'station ticket',
      },
    });
    expect(decodeVocabularySourceQuote(occurrence)).toBe(exact);
    expect(JSON.parse(Buffer.from(chunk.resultBytes!).toString('utf8'))[0].sourceForm).toBe(exact);
    await instance.database.$transaction((database) =>
      updateVocabularyIndexProgress(database, index.id)
    );
    const dictionary = await readDictionary(course.id, identity.ownerId, {});
    expect(dictionary.words[0]!.sources[0]).toMatchObject({
      quote: exact,
      coordinateSystem: 'MATERIAL_CODEPOINTS',
    });
    expect(dictionary.materials[0]!.status).toBe('COMPLETE');
    await expect(
      instance.database.$transaction((database) =>
        captureCanonicalVocabularySource(database, { ...material, userId: 'foreign-profile' })
      )
    ).rejects.toThrow(/Complete the material extraction/);
  });
  it('keeps fully indexed readable text unresolved until original visual coverage is complete', async () => {
    const { material, course, source } = await fixture(false);
    const index = await instance.database.materialVocabularyIndex.create({
      data: {
        materialId: material.id,
        courseId: course.id,
        sourceFingerprint: canonicalVocabularySourceHash(source),
        textHash: canonicalVocabularySourceHash(source),
        textLength: source.inventory.length,
        sourceSnapshot: source,
        protocol: 2,
        originalInput: { reference: material.originalUrl },
        materialCreatedAt: material.createdAt,
        nativeLang: 'en',
        targetLang: 'de',
      },
    });
    await instance.database.vocabularyIndexChunk.create({
      data: { indexId: index.id, startOffset: 0, endOffset: index.textLength, status: 'COMPLETE' },
    });
    const final = await instance.database.$transaction((database) =>
      updateVocabularyIndexProgress(database, index.id)
    );
    expect(final.status).toBe('NEEDS_TEXT');
    expect(final.error).toMatch(/stored readable text is indexed.*coverage remains unresolved/);
    expect((await readDictionary(course.id, identity.ownerId, {})).materials[0]!.status).toBe(
      'NEEDS_TEXT'
    );
    expect(await instance.database.learningObservation.count()).toBe(0);
  });
  it('preserves protocol1 UTF16 offsets and historical text quotations without adopting canonical source fields', async () => {
    const { course } = await fixture();
    const text = '𠮷 Bahnhof Fahrkarte';
    const material = await instance.database.courseMaterial.create({
      data: {
        userId: identity.ownerId,
        courseId: course.id,
        name: 'Historical.txt',
        mimeType: 'text/plain',
        byteSize: Buffer.byteLength(text),
        originalUrl: `materials/${randomUUID()}/historical.txt`,
        extractedText: text,
      },
    });
    const admitted = await sottoTransaction(instance.database, (database) =>
      enqueueMaterialVocabularyIndex(database, material.id, identity.ownerId)
    );
    expect(admitted.index.protocol).toBe(1);
    expect(admitted.index.textLength).toBe(text.length);
    expect(admitted.index.sourceSnapshot).toBeNull();
    const chunks = await instance.database.vocabularyIndexChunk.findMany({
      where: { indexId: admitted.index.id },
      orderBy: { startOffset: 'asc' },
    });
    expect(chunks[0]!.startOffset).toBe(0);
    expect(chunks.at(-1)!.endOffset).toBe(text.length);
    expect(admitted.index.textLength).not.toBe([...text].length);
  });
});
