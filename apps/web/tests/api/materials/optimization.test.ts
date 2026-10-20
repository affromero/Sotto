// @vitest-environment node
import { createHash } from 'node:crypto';
import type { ReadStream } from 'node:fs';
import { lstat, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { NextRequest } from 'next/server';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { StorageWriteJournal } from 'thesidedoor-core/storage';
import type { PrismaClient } from '@/generated/prisma/client';
import { POST as optimize } from '@/app/api/v1/materials/[materialId]/optimize/route';
import { GET as download } from '@/app/api/v1/materials/[materialId]/file/route';
import { materialStorageScopes } from '@/lib/course-materials';
import { materialOptimizationReceiptSchema } from '@/lib/course-materials/optimization/admission';
import { processMaterialOptimization } from '@/lib/course-materials/optimization/processing';
import { settleFailedMaterialJob } from '@/lib/course-materials/jobs/failure';
import { writeStorageReference } from '@/lib/sidedoor/storage/core/storage-write';
import { sottoTransaction } from '@/lib/sidedoor/access/state/transaction';
import { SIDEDOOR_STATE_ID } from '@/lib/sidedoor/access/state/store';
import { deliverSottoJob, sottoJobOutbox } from '@/lib/sidedoor/jobs/core/job-delivery';
import { materialOptimizationQueue } from '@/lib/queue';
import { closeRedis } from '@/lib/redis';
import { syntheticMaterialPdf } from '../../helpers/materials/pdf';
import {
  createSharedTestInstance,
  type SharedTestInstance,
  type SharedTestIdentity,
} from '../../helpers/setup/shared-instance';

const boundary = vi.hoisted(() => ({
  database: null as PrismaClient | null,
  uncertainOptimizedWrite: false,
  downloadReader: null as ReadStream | null,
}));
// Observe the real filesystem reader only to arrange an already queued response
// chunk. Its bytes, cancellation, close and staging cleanup remain real.
vi.mock('node:fs', async (original) => {
  const actual = await original<typeof import('node:fs')>();
  return {
    ...actual,
    createReadStream: (...parameters: Parameters<typeof actual.createReadStream>) => {
      const reader = actual.createReadStream(...parameters);
      if (String(reader.path).includes('sotto-material-')) boundary.downloadReader = reader;
      return reader;
    },
  };
});
vi.mock('@/lib/prisma', async () => {
  const { prismaTestBoundary } = await import('../../helpers/setup/shared-instance');
  const database = prismaTestBoundary(boundary);
  return { prisma: database, prismaUnfiltered: database };
});
// Only the uncertain write is injected at the storage boundary. Successful
// originals, derivatives, reads, journals, qpdf and PDF verification are real.
vi.mock('@/lib/r2', async (original) => {
  const actual = await original<typeof import('@/lib/r2')>();
  return {
    ...actual,
    captureStorageBackend: async () => {
      const backend = await actual.captureStorageBackend();
      return {
        ...backend,
        writeStream: async (...parameters: Parameters<typeof backend.writeStream>) => {
          if (boundary.uncertainOptimizedWrite && parameters[0].includes('/optimized/'))
            throw new Error('Synthetic uncertain derivative storage outcome.');
          return backend.writeStream(...parameters);
        },
      };
    },
  };
});

const suite = process.env.SIDEDOOR_TEST_DATABASE_URL ? describe : describe.skip;
const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
suite('optional owned PDF optimization publication', () => {
  let instance: SharedTestInstance;
  let identity: SharedTestIdentity;
  let directory: string;
  const jobs = new Set<string>();
  beforeAll(async () => {
    instance = await createSharedTestInstance('material_optimize_http');
    boundary.database = instance.database;
    directory = await mkdtemp(join(tmpdir(), 'sotto-optimization-http-'));
  });
  beforeEach(async () => {
    vi.stubEnv('SELF_HOSTED', 'true');
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'http://localhost:3000');
    vi.stubEnv('SIDEDOOR_PASSWORD_ORIGINS', '[]');
    vi.stubEnv('SIDEDOOR_TRUSTED_PROXY', 'false');
    vi.stubEnv('SIDEDOOR_EXECUTION_DIR', join(directory, 'executions'));
    boundary.uncertainOptimizedWrite = false;
    boundary.downloadReader = null;
    identity = await instance.reset();
  });
  afterEach(async () => {
    boundary.uncertainOptimizedWrite = false;
    for (const id of jobs) await (await materialOptimizationQueue.getJob(id))?.remove();
    jobs.clear();
    vi.unstubAllEnvs();
  });
  afterAll(async () => {
    await materialOptimizationQueue.close();
    await closeRedis();
    boundary.database = null;
    await instance?.close();
    // All paths belong to synthetic isolated fixtures, including the explicitly
    // unconfirmed execution used to exercise a failed storage boundary.
    await rm(directory, { recursive: true, force: true });
  });

  async function fixture() {
    const bytes = syntheticMaterialPdf(
      [
        'BT /F1 8 Tf 10 80 Td (Byte-exact original and visible ink) Tj ET\n' +
          '10 10 m 20 25 30 25 40 40 c S\n' +
          ' '.repeat(131072),
      ],
      { width: 120, height: 120 }
    );
    const originalSha256 = sha256(bytes);
    const material = await instance.database.courseMaterial.create({
      data: {
        userId: identity.ownerId,
        name: 'Owned course original.pdf',
        mimeType: 'application/pdf',
        byteSize: bytes.byteLength,
        extractedText: '',
      },
    });
    const originalUrl = await writeStorageReference({
      database: instance.database,
      signal: new AbortController().signal,
      prefix: `materials/${identity.ownerId}/${material.id}/original`,
      extension: 'pdf',
      body: bytes,
      contentType: 'application/pdf',
      previousReference: () => null,
      captureAdmission: async (database) => ({
        ...(await materialStorageScopes(database, material)),
        consumer: `material:${material.id}:original`,
        snapshot: null,
      }),
      validateAdmission: async (database, captured, published) => {
        const current = await database.courseMaterial.findFirst({
          where: {
            id: material.id,
            userId: identity.ownerId,
            originalUrl: published ?? null,
          },
        });
        if (!current) throw new Error('Owned original fixture changed.');
        const ownership = await materialStorageScopes(database, current);
        if (
          ownership.instanceId !== captured.instanceId ||
          JSON.stringify(ownership.scopes) !== JSON.stringify(captured.scopes)
        )
          throw new Error('Original fixture ownership changed.');
      },
      commit: async (database, url) => {
        await database.courseMaterial.update({
          where: { id: material.id },
          data: { originalUrl: url, originalSha256 },
        });
      },
    });
    return { material, bytes, originalUrl, originalSha256 };
  }
  function request(
    materialId: string,
    path: string,
    token = identity.ownerToken,
    method = 'GET',
    origin = 'http://localhost:3000'
  ) {
    return new NextRequest(`http://localhost:3000/api/v1/materials/${materialId}/${path}`, {
      method,
      headers: { cookie: `sotto_session=${token}`, origin },
    });
  }
  function admit(
    materialId: string,
    token = identity.ownerToken,
    origin = 'http://localhost:3000'
  ) {
    return optimize(request(materialId, 'optimize', token, 'POST', origin), {
      params: Promise.resolve({ materialId }),
    });
  }
  async function receipt(materialId: string) {
    const response = await admit(materialId);
    expect(response.status).toBe(202);
    const result = materialOptimizationReceiptSchema.parse(await response.json());
    jobs.add(result.operationId);
    return result;
  }
  async function delivered(operationId: string) {
    const record = await sottoTransaction(instance.database, (database) =>
      sottoJobOutbox(database).read(operationId)
    );
    if (!record) throw new Error('Missing canonical optimization admission.');
    await deliverSottoJob({
      database: instance.database,
      queue: materialOptimizationQueue,
      operationId,
      fingerprint: record.fingerprint,
      version: 1,
    });
    const job = await materialOptimizationQueue.getJob(operationId);
    if (!job) throw new Error('Missing delivered optimization job.');
    return job;
  }
  async function file(materialId: string, variant?: string, token = identity.ownerToken) {
    return download(request(materialId, 'file' + (variant ? `?variant=${variant}` : ''), token), {
      params: Promise.resolve({ materialId }),
    });
  }

  it('publishes a real qpdf derivative while keeping the original reference and bytes unchanged', async () => {
    const value = await fixture();
    expect((await file(value.material.id, 'optimized')).status).toBe(404);
    const admitted = await receipt(value.material.id);
    const job = await delivered(admitted.operationId);
    await processMaterialOptimization(job);
    const row = await instance.database.courseMaterial.findUniqueOrThrow({
      where: { id: value.material.id },
    });
    const result = materialOptimizationReceiptSchema.parse(row.optimizationReceipt);
    expect(result).toMatchObject({
      operationId: admitted.operationId,
      originalSha256: value.originalSha256,
      status: 'OPTIMIZED',
      originalBytes: value.bytes.length,
      verification: {
        method: 'PDFJS_COMPLETE_PAGE_COMPARISON',
        originalSha256: value.originalSha256,
        pageCount: 1,
      },
    });
    expect(row.originalUrl).toBe(value.originalUrl);
    expect(row.originalSha256).toBe(value.originalSha256);
    expect(row.optimizedUrl).not.toBeNull();
    expect(row.optimizedUrl).not.toBe(row.originalUrl);
    const original = await file(value.material.id);
    const explicitOriginal = await file(value.material.id, 'original');
    const optimized = await file(value.material.id, 'optimized');
    expect([original.status, explicitOriginal.status, optimized.status]).toEqual([200, 200, 200]);
    expect(Buffer.from(await original.arrayBuffer())).toEqual(value.bytes);
    expect(Buffer.from(await explicitOriginal.arrayBuffer())).toEqual(value.bytes);
    const optimizedBytes = Buffer.from(await optimized.arrayBuffer());
    expect(optimizedBytes.length).toBeLessThan(value.bytes.length);
    expect(result.optimizedBytes).toBe(optimizedBytes.length);
    expect(result.savedBytes).toBe(value.bytes.length - optimizedBytes.length);
    expect(result.verification).toMatchObject({
      candidateSha256: sha256(optimizedBytes),
    });
    expect(optimized.headers.get('content-type')).toBe('application/pdf');
    expect(optimized.headers.get('cache-control')).toBe('private, no-store');
    expect(optimized.headers.get('content-length')).toBe(String(optimizedBytes.length));
    const complete = await sottoTransaction(instance.database, (database) =>
      sottoJobOutbox(database).read(admitted.operationId)
    );
    expect(complete?.complete).toBe(true);
    boundary.uncertainOptimizedWrite = true;
    await processMaterialOptimization(job);
    const replay = await admit(value.material.id);
    expect(replay.status).toBe(200);
    expect(materialOptimizationReceiptSchema.parse(await replay.json())).toEqual(result);
    await instance.database.courseMaterial.update({
      where: { id: value.material.id },
      data: { processingRevision: { increment: 1 } },
    });
    const afterRecognitionRevision = await admit(value.material.id);
    expect(afterRecognitionRevision.status).toBe(200);
    expect(materialOptimizationReceiptSchema.parse(await afterRecognitionRevision.json())).toEqual(
      result
    );
    expect(
      (
        await instance.database.courseMaterial.findUniqueOrThrow({
          where: { id: value.material.id },
        })
      ).optimizedUrl
    ).toBe(row.optimizedUrl);
  }, 60_000);

  it('admits simultaneous duplicate requests as one stable operation before Redis delivery', async () => {
    const value = await fixture();
    const responses = await Promise.all([admit(value.material.id), admit(value.material.id)]);
    expect(responses.map((response) => response.status)).toEqual([202, 202]);
    const records = await Promise.all(
      responses.map(async (response) =>
        materialOptimizationReceiptSchema.parse(await response.json())
      )
    );
    expect(records[0]).toEqual(records[1]);
    jobs.add(records[0]!.operationId);
    const work = await sottoTransaction(instance.database, (database) =>
      sottoJobOutbox(database).read(records[0]!.operationId)
    );
    expect(work?.complete).toBe(false);
    const row = await instance.database.courseMaterial.findUniqueOrThrow({
      where: { id: value.material.id },
    });
    expect(row.optimizationReceipt).toEqual(records[0]);
    expect(row.originalUrl).toBe(value.originalUrl);
    expect(row.optimizedUrl).toBeNull();
  });

  it('denies another profile and an untrusted browser origin without admitting optimization', async () => {
    const value = await fixture();
    const other = await identity.household('Other learner');
    expect((await admit(value.material.id, other.token)).status).toBe(404);
    expect((await file(value.material.id, 'optimized', other.token)).status).toBe(404);
    expect(
      (await admit(value.material.id, identity.ownerToken, 'https://untrusted.invalid')).status
    ).toBe(403);
    const row = await instance.database.courseMaterial.findUniqueOrThrow({
      where: { id: value.material.id },
    });
    expect(row.optimizationReceipt).toBeNull();
    expect(row.optimizedUrl).toBeNull();
    expect(Buffer.from(await (await file(value.material.id)).arrayBuffer())).toEqual(value.bytes);
  });

  it('records unavailable qpdf explicitly and never substitutes the original as an optimized variant', async () => {
    const value = await fixture();
    const admitted = await receipt(value.material.id);
    const job = await delivered(admitted.operationId);
    vi.stubEnv('PATH', directory);
    await processMaterialOptimization(job);
    const row = await instance.database.courseMaterial.findUniqueOrThrow({
      where: { id: value.material.id },
    });
    const result = materialOptimizationReceiptSchema.parse(row.optimizationReceipt);
    expect(result).toMatchObject({
      operationId: admitted.operationId,
      status: 'UNAVAILABLE',
      originalSha256: value.originalSha256,
    });
    expect(result.diagnostic).toContain('executable');
    expect(row.originalUrl).toBe(value.originalUrl);
    expect(row.optimizedUrl).toBeNull();
    expect(Buffer.from(await (await file(value.material.id)).arrayBuffer())).toEqual(value.bytes);
    expect((await file(value.material.id, 'optimized')).status).toBe(404);
    expect((await file(value.material.id, 'unknown')).status).toBe(400);
    expect((await admit(value.material.id)).status).toBe(200);
    expect(
      (
        await sottoTransaction(instance.database, (database) =>
          sottoJobOutbox(database).read(admitted.operationId)
        )
      )?.complete
    ).toBe(true);
  });

  it('retains an uncertain derivative write and prevents another attempt from publishing a replacement', async () => {
    const value = await fixture();
    const admitted = await receipt(value.material.id);
    const job = await delivered(admitted.operationId);
    boundary.uncertainOptimizedWrite = true;
    await expect(processMaterialOptimization(job)).rejects.toBeInstanceOf(Error);
    async function derivativeWrites() {
      return sottoTransaction(instance.database, async (database) => {
        const writes = new StorageWriteJournal(
          {
            query: (sql, values) =>
              database.$queryRawUnsafe<Record<string, unknown>[]>(sql, ...values),
          },
          'postgres',
          SIDEDOOR_STATE_ID
        );
        const page = await writes.list(`material:${value.material.id}`);
        return page.intents.filter((intent) => intent.target.key.includes('/optimized/'));
      });
    }
    const uncertain = await derivativeWrites();
    expect(uncertain).toHaveLength(1);
    expect(uncertain[0]?.status).toBe('uncertain');
    boundary.uncertainOptimizedWrite = false;
    await expect(processMaterialOptimization(job)).rejects.toBeInstanceOf(Error);
    expect(await derivativeWrites()).toEqual(uncertain);
    await sottoTransaction(instance.database, (database) =>
      settleFailedMaterialJob(database, job, 'material-optimization')
    );
    const response = await admit(value.material.id);
    expect(response.status).toBe(200);
    expect(materialOptimizationReceiptSchema.parse(await response.json()).status).toBe(
      'RECOVERY_REQUIRED'
    );
    const row = await instance.database.courseMaterial.findUniqueOrThrow({
      where: { id: value.material.id },
    });
    expect(row.optimizedUrl).toBeNull();
    expect(row.originalUrl).toBe(value.originalUrl);
    expect(row.originalSha256).toBe(value.originalSha256);
    expect(Buffer.from(await (await file(value.material.id)).arrayBuffer())).toEqual(value.bytes);
    expect((await file(value.material.id, 'optimized')).status).toBe(404);
    expect(await derivativeWrites()).toEqual(uncertain);
  }, 60_000);

  it('cleans download staging after abort with a queued chunk and no consumer pull or cancel', async () => {
    const value = await fixture();
    const controller = new AbortController();
    const response = await download(
      new NextRequest(`http://localhost:3000/api/v1/materials/${value.material.id}/file`, {
        headers: { cookie: `sotto_session=${identity.ownerToken}` },
        signal: controller.signal,
      }),
      { params: Promise.resolve({ materialId: value.material.id }) }
    );
    expect(response.status).toBe(200);
    expect(response.body?.locked).toBe(false);
    await vi.waitFor(() => {
      // One chunk occupies the HTTP queue and another is prefetched by the
      // native reader. The HTTP consumer has never acquired a reader.
      expect(boundary.downloadReader?.bytesRead).toBeGreaterThanOrEqual(131072);
    });
    const reader = boundary.downloadReader;
    if (!reader) throw new Error('Missing real download file reader.');
    const stagingDirectory = dirname(String(reader.path));
    expect((await lstat(stagingDirectory)).isDirectory()).toBe(true);
    controller.abort(new Error('Synthetic client disconnected after response queuing.'));
    await vi.waitFor(async () => {
      await expect(lstat(stagingDirectory)).rejects.toMatchObject({
        code: 'ENOENT',
      });
    });
    expect(reader.destroyed).toBe(true);
    expect(response.body?.locked).toBe(false);
  });
});
