// @vitest-environment node
import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { StorageWriteJournal } from 'thesidedoor-core/storage';
import { NextRequest } from 'next/server';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  materialUploadBatchReceiptSchema,
  materialUploadResumeSchema,
  materialUploadLimits,
  materialUploadPartHeaders,
  type MaterialUploadResume,
} from '@sotto/shared';
import type { PrismaClient } from '@/generated/prisma/client';
import { POST as reserve } from '@/app/api/v1/materials/uploads/route';
import { GET as resume, DELETE as cancel } from '@/app/api/v1/materials/uploads/[uploadId]/route';
import { PUT as uploadPart } from '@/app/api/v1/materials/uploads/[uploadId]/parts/[index]/route';
import { POST as complete } from '@/app/api/v1/materials/uploads/[uploadId]/complete/route';
import { GET as download } from '@/app/api/v1/materials/[materialId]/file/route';
import { processMaterialFinalization } from '@/lib/course-materials/uploads/finalization';
import { maintainMaterialUploads } from '@/lib/course-materials/uploads/cleanup';
import { materialFinalizationQueue, materialExtractionQueue } from '@/lib/queue';
import { processMaterialExtraction } from '@/lib/course-materials/extraction/processing';
import { deliverSottoJob } from '@/lib/sidedoor/jobs/core/job-delivery';
import { syntheticMaterialPdf } from '../../helpers/materials/pdf';
import { closeRedis } from '@/lib/redis';
import { planMaterialUploadParts } from '@/lib/course-materials/uploads/protocol';
import { settleFailedMaterialJob } from '@/lib/course-materials/jobs/failure';
import { sottoJobOutbox } from '@/lib/sidedoor/jobs/core/job-delivery';
import { durableQueueOperationId } from '@/lib/sidedoor/jobs/core/durable-queue';
import { SIDEDOOR_STATE_ID } from '@/lib/sidedoor/access/state/store';
import {
  createSharedTestInstance,
  type SharedTestInstance,
  type SharedTestIdentity,
} from '../../helpers/setup/shared-instance';

const boundary = vi.hoisted(() => ({
  database: null as PrismaClient | null,
  unknownOriginal: false,
  beforePart: null as (() => Promise<void>) | null,
}));
vi.mock('@/lib/r2', async (original) => {
  const actual = await original<typeof import('@/lib/r2')>();
  return {
    ...actual,
    captureStorageBackend: async () => {
      const backend = await actual.captureStorageBackend();
      return {
        ...backend,
        writeStream: async (...parameters: Parameters<typeof backend.writeStream>) => {
          if (parameters[0].includes('/parts/')) await boundary.beforePart?.();
          if (boundary.unknownOriginal && parameters[0].includes('/original/'))
            throw new Error('Synthetic unobserved storage outcome.');
          return backend.writeStream(...parameters);
        },
      };
    },
  };
});
vi.mock('@/lib/prisma', async () => {
  const { prismaTestBoundary } = await import('../../helpers/setup/shared-instance');
  const database = prismaTestBoundary(boundary);
  return { prisma: database, prismaUnfiltered: database };
});
const suite = process.env.SIDEDOOR_TEST_DATABASE_URL ? describe : describe.skip;
const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
suite('resumable owned material originals', () => {
  let instance: SharedTestInstance;
  let identity: SharedTestIdentity;
  let executionDirectory: string;
  const jobs = new Set<string>();
  beforeAll(async () => {
    instance = await createSharedTestInstance('material_upload');
    boundary.database = instance.database;
    executionDirectory = await mkdtemp(join(tmpdir(), 'sotto-upload-executions-'));
  });
  beforeEach(async () => {
    vi.stubEnv('SELF_HOSTED', 'true');
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'http://localhost:3000');
    vi.stubEnv('SIDEDOOR_PASSWORD_ORIGINS', '[]');
    vi.stubEnv('SIDEDOOR_TRUSTED_PROXY', 'false');
    vi.stubEnv('SIDEDOOR_EXECUTION_DIR', join(executionDirectory, 'work'));
    boundary.unknownOriginal = false;
    boundary.beforePart = null;
    identity = await instance.reset();
  });
  afterEach(async () => {
    for (const id of jobs) {
      await (await materialFinalizationQueue.getJob(id))?.remove();
      await (await materialExtractionQueue.getJob(id))?.remove();
    }
    jobs.clear();
    vi.unstubAllEnvs();
  });
  afterAll(async () => {
    await materialFinalizationQueue.close();
    await materialExtractionQueue.close();
    await closeRedis();
    await instance?.close();
    await rm(executionDirectory, { recursive: true, force: true });
    boundary.database = null;
  });
  function request(
    path: string,
    init: NonNullable<ConstructorParameters<typeof NextRequest>[1]> = {},
    token = identity.ownerToken
  ) {
    return new NextRequest(`http://localhost:3000/api/v1/materials/uploads${path}`, {
      ...init,
      headers: {
        cookie: `sotto_session=${token}`,
        origin: 'http://localhost:3000',
        ...init.headers,
      },
    });
  }
  function declaration(bytes: Uint8Array) {
    return {
      schemaVersion: 1,
      requestId: randomUUID(),
      files: [
        {
          clientId: randomUUID(),
          name: 'practice.pdf',
          mimeType: 'application/pdf',
          byteSize: bytes.byteLength,
          sha256: sha256(bytes),
        },
      ],
    };
  }
  async function create(bytes: Uint8Array) {
    const response = await reserve(
      request('', { method: 'POST', body: JSON.stringify(declaration(bytes)) })
    );
    expect(response.status).toBe(201);
    return materialUploadBatchReceiptSchema.parse(await response.json()).uploads[0]!;
  }
  async function part(
    upload: MaterialUploadResume,
    bytes: Uint8Array,
    index: number,
    digest = sha256(bytes)
  ) {
    return uploadPart(
      request(`/${upload.uploadId}/parts/${index}`, {
        method: 'PUT',
        body: new Uint8Array(bytes),
        headers: {
          [materialUploadPartHeaders.offset]: String(index * materialUploadLimits.partBytes),
          [materialUploadPartHeaders.byteSize]: String(bytes.byteLength),
          [materialUploadPartHeaders.sha256]: digest,
        },
      }),
      { params: Promise.resolve({ uploadId: upload.uploadId, index: String(index) }) }
    );
  }
  async function state(upload: MaterialUploadResume, token = identity.ownerToken) {
    return resume(request(`/${upload.uploadId}`, {}, token), {
      params: Promise.resolve({ uploadId: upload.uploadId }),
    });
  }
  async function finalize(upload: MaterialUploadResume) {
    const response = await complete(
      request(`/${upload.uploadId}/complete`, {
        method: 'POST',
        body: JSON.stringify({
          schemaVersion: 1,
          requestId: randomUUID(),
          expectedRevision: upload.revision,
        }),
      }),
      { params: Promise.resolve({ uploadId: upload.uploadId }) }
    );
    if (response.status === 202) {
      const row = await instance.database.materialUpload.findUniqueOrThrow({
        where: { id: upload.uploadId },
      });
      if (row.finalizationOperationId) jobs.add(row.finalizationOperationId);
    }
    return response;
  }
  it('retains every page through upload, outbox delivery and exact chunk publication without claiming handwriting coverage', async () => {
    const bytes = syntheticMaterialPdf(
      Array.from(
        { length: 65 },
        (_, index) =>
          `BT /F1 2 Tf 10 50 Td (Page ${index + 1} ${index === 64 ? 'FINAL_OBWOHL_TROTZDEM' : 'complete source'}) Tj ET`
      ),
      { ink: true }
    );
    let upload = await create(bytes);
    for (const item of planMaterialUploadParts(bytes.length))
      upload = materialUploadResumeSchema.parse(
        await (
          await part(upload, bytes.subarray(item.offset, item.offset + item.byteSize), item.index)
        ).json()
      );
    expect((await finalize(upload)).status).toBe(202);
    const row = await instance.database.materialUpload.findUniqueOrThrow({
      where: { id: upload.uploadId },
    });
    const finalizer = await materialFinalizationQueue.getJob(row.finalizationOperationId!);
    if (!finalizer) throw new Error('Missing admitted original finalizer.');
    await processMaterialFinalization(finalizer);
    const operationId = durableQueueOperationId(
      'material-extraction',
      `material-extraction-${upload.materialId}-1`
    );
    jobs.add(operationId);
    const receipt = await instance.database.$transaction((database) =>
      sottoJobOutbox(database).read(operationId)
    );
    if (!receipt) throw new Error('Missing admitted extraction receipt.');
    await deliverSottoJob({
      database: instance.database,
      queue: materialExtractionQueue,
      operationId,
      fingerprint: receipt.fingerprint,
      version: 1,
    });
    const job = await materialExtractionQueue.getJob(operationId);
    if (!job) throw new Error('Missing delivered extraction.');
    await processMaterialExtraction(job);
    await processMaterialExtraction(job);
    const run = await instance.database.materialExtractionRun.findFirstOrThrow({
      where: { materialId: upload.materialId },
    });
    expect(run).toMatchObject({
      status: 'PARTIAL',
      pageCount: 65,
      originalSha256: sha256(bytes),
      coverage: {
        visitedPageCount: 65,
        readablePageCount: 65,
        processingComplete: true,
        coverageComplete: false,
      },
    });
    expect(await instance.database.materialPage.count({ where: { runId: run.id } })).toBe(65);
    const last = await instance.database.materialPage.findUniqueOrThrow({
      where: { runId_pageNumber: { runId: run.id, pageNumber: 65 } },
      include: { textStreams: { include: { chunks: true } } },
    });
    expect(last.visualCoverage).toMatchObject({ state: 'UNAVAILABLE' });
    expect(
      Buffer.concat(
        last.textStreams.flatMap((stream) =>
          stream.chunks.map((chunk) => Buffer.from(chunk.textBytes))
        )
      ).toString('utf8')
    ).toContain('FINAL_OBWOHL_TROTZDEM');
    expect(
      await instance.database.$transaction((database) => sottoJobOutbox(database).read(operationId))
    ).toMatchObject({ complete: true });
  }, 120000);

  it('publishes complete text-only originals beyond a million characters without inventing a visual page assessment', async () => {
    const text = '\uFEFF' + 'é 😀\u0000 '.repeat(180000) + 'FINAL_COMPLETE_TEXT';
    const bytes = Buffer.from(text);
    const input = declaration(bytes);
    input.files[0]!.name = 'complete.TXT';
    input.files[0]!.mimeType = 'text/plain';
    const reserved = await reserve(request('', { method: 'POST', body: JSON.stringify(input) }));
    expect(reserved.status).toBe(201);
    let upload = materialUploadBatchReceiptSchema.parse(await reserved.json()).uploads[0]!;
    upload = materialUploadResumeSchema.parse(await (await part(upload, bytes, 0)).json());
    expect((await finalize(upload)).status).toBe(202);
    const row = await instance.database.materialUpload.findUniqueOrThrow({
      where: { id: upload.uploadId },
    });
    const finalizer = await materialFinalizationQueue.getJob(row.finalizationOperationId!);
    if (!finalizer) throw new Error('Missing admitted original finalizer.');
    await processMaterialFinalization(finalizer);
    const operationId = durableQueueOperationId(
      'material-extraction',
      `material-extraction-${upload.materialId}-1`
    );
    jobs.add(operationId);
    const receipt = await instance.database.$transaction((database) =>
      sottoJobOutbox(database).read(operationId)
    );
    if (!receipt) throw new Error('Missing admitted extraction.');
    await deliverSottoJob({
      database: instance.database,
      queue: materialExtractionQueue,
      operationId,
      fingerprint: receipt.fingerprint,
      version: 1,
    });
    const job = await materialExtractionQueue.getJob(operationId);
    if (!job) throw new Error('Missing delivered extraction.');
    await processMaterialExtraction(job);
    const run = await instance.database.materialExtractionRun.findFirstOrThrow({
      where: { materialId: upload.materialId },
    });
    expect(run).toMatchObject({
      status: 'COMPLETE',
      pageCount: 1,
      coverage: { processingComplete: true, coverageComplete: true },
    });
    const chunks = await instance.database.materialTextChunk.findMany({
      where: { stream: { page: { runId: run.id } } },
      orderBy: { index: 'asc' },
    });
    expect(
      Buffer.concat(chunks.map((chunk) => Buffer.from(chunk.textBytes))).toString('utf8')
    ).toBe(text);
  }, 120000);

  it('replays a reservation and rejects another file set under the same request key', async () => {
    const input = declaration(Buffer.from('original'));
    const send = () => reserve(request('', { method: 'POST', body: JSON.stringify(input) }));
    const first = materialUploadBatchReceiptSchema.parse(await (await send()).json());
    expect(materialUploadBatchReceiptSchema.parse(await (await send()).json())).toEqual(first);
    input.files[0]!.name = 'changed.pdf';
    expect((await send()).status).toBe(409);
    expect(await instance.database.materialUpload.count()).toBe(1);
  });
  it('does not publish corrupt bytes and accepts a corrected retry without extra receipt credit', async () => {
    const bytes = Buffer.from('complete original');
    const upload = await create(bytes);
    expect((await part(upload, Buffer.from('corrupt! original'), 0, sha256(bytes))).status).toBe(
      422
    );
    expect(materialUploadResumeSchema.parse(await (await state(upload)).json()).parts).toEqual([]);
    const stored = materialUploadResumeSchema.parse(await (await part(upload, bytes, 0)).json());
    expect(stored.parts).toHaveLength(1);
    const repeated = materialUploadResumeSchema.parse(await (await part(upload, bytes, 0)).json());
    expect(repeated).toEqual(stored);
    expect((await part(upload, Buffer.from('different content'), 0)).status).toBe(409);
  });
  it('retains a 46.9 MB original through twelve resumed parts and preserves it after part cleanup', async () => {
    const bytes = Buffer.alloc(46880440, 65);
    bytes.write('%PDF-1.7\n');
    bytes.write('\n%%EOF', bytes.byteLength - 6);
    let upload = await create(bytes);
    const plan = planMaterialUploadParts(bytes.byteLength);
    expect(plan).toHaveLength(12);
    for (const item of plan) {
      const response = await part(
        upload,
        bytes.subarray(item.offset, item.offset + item.byteSize),
        item.index
      );
      expect(response.status).toBe(200);
      upload = materialUploadResumeSchema.parse(await response.json());
      if (item.index === 3) {
        expect((await finalize(upload)).status).toBe(409);
        upload = materialUploadResumeSchema.parse(await (await state(upload)).json());
        expect(upload.parts).toHaveLength(4);
      }
    }
    expect((await finalize(upload)).status).toBe(202);
    const row = await instance.database.materialUpload.findUniqueOrThrow({
      where: { id: upload.uploadId },
    });
    const job = await materialFinalizationQueue.getJob(row.finalizationOperationId!);
    if (!job) throw new Error('Missing admitted finalization.');
    await processMaterialFinalization(job);
    await processMaterialFinalization(job);
    const completed = materialUploadResumeSchema.parse(await (await state(upload)).json());
    expect(completed.original?.sha256).toBe(sha256(bytes));
    expect(completed.status).toBe('COMPLETE');
    const extraction = await instance.database.materialExtractionRun.findFirstOrThrow({
      where: { materialId: upload.materialId, processingRevision: 1 },
    });
    expect(extraction.originalSha256).toBe(sha256(bytes));
    expect(
      await instance.database.materialExtractionRun.count({
        where: { materialId: upload.materialId },
      })
    ).toBe(1);
    const extractionReceipt = await instance.database.$transaction((database) =>
      sottoJobOutbox(database).read(
        durableQueueOperationId('material-extraction', `material-extraction-${upload.materialId}-1`)
      )
    );
    expect(extractionReceipt).toMatchObject({
      complete: false,
      job: { handler: 'material-extraction' },
    });
    await maintainMaterialUploads(new AbortController().signal);
    expect(
      await instance.database.materialUploadPart.count({ where: { uploadId: upload.uploadId } })
    ).toBe(0);
    const original = await download(
      new NextRequest(`http://localhost:3000/api/v1/materials/${upload.materialId}/file`, {
        headers: { cookie: `sotto_session=${identity.ownerToken}` },
      }),
      {
        params: Promise.resolve({ materialId: upload.materialId }),
      }
    );
    expect(original.status).toBe(200);
    expect(sha256(new Uint8Array(await original.arrayBuffer()))).toBe(sha256(bytes));
    expect((await finalize(completed)).status).toBe(200);
  }, 120000);
  it('denies another profile and fences cancelled or expired sessions', async () => {
    const bytes = Buffer.from('owned material');
    const upload = await create(bytes);
    const other = await identity.household('Other');
    expect((await state(upload, other.token)).status).toBe(403);
    expect((await part(upload, bytes, 0)).status).toBe(200);
    const cancelRequest = () =>
      cancel(request(`/${upload.uploadId}`, { method: 'DELETE' }), {
        params: Promise.resolve({ uploadId: upload.uploadId }),
      });
    expect((await cancelRequest()).status).toBe(200);
    expect((await cancelRequest()).status).toBe(200);
    expect((await part(upload, bytes, 0)).status).toBe(409);
    expect(await instance.database.materialUploadPart.count()).toBe(0);
    const expired = await create(bytes);
    await instance.database.materialUpload.update({
      where: { id: expired.uploadId },
      data: { expiresAt: new Date(0) },
    });
    expect((await part(expired, bytes, 0)).status).toBe(409);
    await maintainMaterialUploads(new AbortController().signal);
    expect(materialUploadResumeSchema.parse(await (await state(expired)).json()).status).toBe(
      'EXPIRED'
    );
  });
  it('reserves concurrent retries once and bounds pending file reservations', async () => {
    const input = declaration(Buffer.from('x'));
    input.files = Array.from({ length: 10 }, () => ({
      ...input.files[0]!,
      clientId: randomUUID(),
    }));
    const send = () => reserve(request('', { method: 'POST', body: JSON.stringify(input) }));
    const responses = await Promise.all([send(), send()]);
    expect(responses.map((response) => response.status)).toEqual([201, 201]);
    const receipts = await Promise.all(
      responses.map(async (response) =>
        materialUploadBatchReceiptSchema.parse(await response.json())
      )
    );
    expect(receipts[0]).toEqual(receipts[1]);
    expect(await instance.database.materialUpload.count()).toBe(10);
    input.requestId = randomUUID();
    expect((await send()).status).toBe(201);
    input.requestId = randomUUID();
    expect((await send()).status).toBe(409);
    expect(await instance.database.materialUpload.count()).toBe(20);
  });
  it('records terminal finalizer failure once and preserves parts for explicit recovery', async () => {
    const bytes = Buffer.from('recoverable original');
    let upload = await create(bytes);
    upload = materialUploadResumeSchema.parse(await (await part(upload, bytes, 0)).json());
    expect((await finalize(upload)).status).toBe(202);
    const row = await instance.database.materialUpload.findUniqueOrThrow({
      where: { id: upload.uploadId },
    });
    const job = await materialFinalizationQueue.getJob(row.finalizationOperationId!);
    if (!job) throw new Error('Missing finalizer.');
    await instance.database.$transaction((database) => settleFailedMaterialJob(database, job));
    await instance.database.$transaction((database) => settleFailedMaterialJob(database, job));
    const failed = materialUploadResumeSchema.parse(await (await state(upload)).json());
    expect(failed.status).toBe('FAILED');
    expect(failed.failureReason).toContain('parts are retained');
    expect(failed.parts).toHaveLength(1);
    await maintainMaterialUploads(new AbortController().signal);
    expect(await instance.database.materialUploadPart.count()).toBe(1);
    expect(
      (
        await instance.database.$transaction((database) =>
          sottoJobOutbox(database).read(row.finalizationOperationId!)
        )
      )?.complete
    ).toBe(true);
  });
  it('settles an admitted finalizer after cancellation without publishing a removed original', async () => {
    const bytes = Buffer.from('cancelled finalizer');
    let upload = await create(bytes);
    upload = materialUploadResumeSchema.parse(await (await part(upload, bytes, 0)).json());
    expect((await finalize(upload)).status).toBe(202);
    const row = await instance.database.materialUpload.findUniqueOrThrow({
      where: { id: upload.uploadId },
    });
    const job = await materialFinalizationQueue.getJob(row.finalizationOperationId!);
    if (!job) throw new Error('Missing finalizer.');
    expect(
      (
        await cancel(request(`/${upload.uploadId}`, { method: 'DELETE' }), {
          params: Promise.resolve({ uploadId: upload.uploadId }),
        })
      ).status
    ).toBe(200);
    await processMaterialFinalization(job);
    expect(
      (
        await instance.database.courseMaterial.findUniqueOrThrow({
          where: { id: upload.materialId },
        })
      ).originalUrl
    ).toBeNull();
    expect(await instance.database.materialUploadPart.count()).toBe(0);
  });
  it('retains uncertain original writes and prevents another storage attempt on retry', async () => {
    const bytes = Buffer.from('uncertain original');
    let upload = await create(bytes);
    upload = materialUploadResumeSchema.parse(await (await part(upload, bytes, 0)).json());
    expect((await finalize(upload)).status).toBe(202);
    const row = await instance.database.materialUpload.findUniqueOrThrow({
      where: { id: upload.uploadId },
    });
    const job = await materialFinalizationQueue.getJob(row.finalizationOperationId!);
    if (!job) throw new Error('Missing finalizer.');
    boundary.unknownOriginal = true;
    await expect(processMaterialFinalization(job)).rejects.toThrow('outcome is unresolved');
    const originalIntents = () =>
      instance.database.$transaction(async (database) => {
        const journal = new StorageWriteJournal(
          {
            query: (sql, values) =>
              database.$queryRawUnsafe<Record<string, unknown>[]>(sql, ...values),
          },
          'postgres',
          SIDEDOOR_STATE_ID
        );
        return (await journal.list(`material:${upload.materialId}`)).intents.filter((intent) =>
          intent.target.key.includes('/original/')
        );
      });
    const uncertain = await originalIntents();
    expect(uncertain).toHaveLength(1);
    expect(uncertain[0]?.status).toBe('uncertain');
    await expect(processMaterialFinalization(job)).rejects.toBeInstanceOf(Error);
    expect(await originalIntents()).toEqual(uncertain);
    await instance.database.$transaction((database) => settleFailedMaterialJob(database, job));
    await maintainMaterialUploads(new AbortController().signal);
    const failed = materialUploadResumeSchema.parse(await (await state(upload)).json());
    expect(failed.status).toBe('FAILED');
    expect(failed.parts).toHaveLength(1);
    expect(failed.original).toBeNull();
  });
  it('fences an older unfinished part writer when the same position is retried', async () => {
    const bytes = Buffer.from('same immutable part');
    const upload = await create(bytes);
    let release!: () => void;
    let entered!: () => void;
    const waiting = new Promise<void>((resolve) => {
      release = resolve;
    });
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    boundary.beforePart = async () => {
      entered();
      await waiting;
    };
    const older = part(upload, bytes, 0);
    await started;
    boundary.beforePart = null;
    try {
      const current = await part(upload, bytes, 0);
      expect(current.status).toBe(200);
    } finally {
      release();
    }
    expect((await older).status).toBe(409);
    const saved = materialUploadResumeSchema.parse(await (await state(upload)).json());
    expect(saved.parts).toHaveLength(1);
    expect(saved.parts[0]?.sha256).toBe(sha256(bytes));
  });
});
