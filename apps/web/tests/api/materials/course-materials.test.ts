// @vitest-environment private-redis
import { createHash, randomUUID } from 'node:crypto';
import { registerAssessmentDeletionCase } from './course-material-cases/assessment-deletion';
import { dirname } from 'node:path';
import { rm, stat } from 'node:fs/promises';
import { NextRequest } from 'next/server';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@/generated/prisma/client';
import { POST as upload } from '@/app/api/v1/materials/route';
import { POST as placementUpload } from '@/app/api/v1/placement/from-notes/upload/route';
import { closeRedis } from '@/lib/redis';
import { GET as download } from '@/app/api/v1/materials/[materialId]/file/route';
import {
  GET as notes,
  PUT as saveNotes,
  POST as uploadNotes,
} from '@/app/api/v1/courses/[courseId]/notes/route';
import { getCourseNote } from '@/lib/course-notes';
import { captureMaterialDocuments } from '@/lib/course-materials/documents';
import { originalPdf } from '../../helpers/learning/pdf';
import type { SottoProviderExecution } from '@/lib/sidedoor/credentials/runtime/provider-execution';
import { attachCourseMaterials, persistPlacementMaterials } from '@/lib/course-materials';
import { factoryReset } from '@/lib/admin/factory-reset';
import { resolveSottoRequest } from '@/lib/sidedoor/access/core/request-identity';
import { deleteCourseCompletely } from '@/lib/course-deletion';
import { sottoJobOutbox } from '@/lib/sidedoor/jobs/core/job-delivery';
import { prepareJob } from 'thesidedoor-core/runtime/outbox';
import { sottoTransaction } from '@/lib/sidedoor/access/state/transaction';
import { resolveStorageInput } from '@/lib/sidedoor/storage/core/storage-inputs';
import { inspectStorageMigrationConsumer } from '@/lib/sidedoor/storage/migration/storage-migration-plan';
import {
  StorageReferenceRegistry,
  StorageCleanupJournal,
  prepareStorageCleanup,
  copyOwnedBytesToFile,
} from 'thesidedoor-core/storage';
import { captureStorageBackend } from '@/lib/r2';
import { runSottoStorageCleanup } from '@/lib/sidedoor/storage/migration/storage-cleanup-runtime';
import { SIDEDOOR_STATE_ID } from '@/lib/sidedoor/access/state/store';
import { visitStorageDeletionReferences } from '@/lib/storage/sidedoor/deletion-targets';
import {
  createSharedTestInstance,
  type SharedTestInstance,
  type SharedTestIdentity,
} from '../../helpers/setup/shared-instance';

const boundary = vi.hoisted(() => ({
  database: null as PrismaClient | null,
  beforeWrite: null as (() => Promise<void>) | null,
  beforeCourseDeletion: null as (() => Promise<void>) | null,
  generate: vi.fn(),
  failDownload: false,
  downloadDirectory: '',
}));
vi.mock('@/lib/learning-ai', () => ({
  resolveCapturedLearningAi: async (_userId: string, execution: SottoProviderExecution) => ({
    provider: 'anthropic',
    model: 'captured',
    execution,
  }),
  capturedLearningAiOptions: async (ai: { execution: SottoProviderExecution }) => ({
    sourceDocuments: ai.execution.sourceDocuments,
  }),
}));
vi.mock('@/lib/providers/ai', () => ({
  createAIProvider: () => ({ generateResponse: boundary.generate }),
}));
vi.mock('@/lib/usage-logger', () => ({ logUsage: vi.fn() }));
vi.mock('@/lib/r2', async (original) => {
  const actual = await original<typeof import('@/lib/r2')>();
  return {
    ...actual,
    restoreStorageBackend: async (...args: Parameters<typeof actual.restoreStorageBackend>) => {
      const backend = await actual.restoreStorageBackend(...args);
      if (!boundary.failDownload) return backend;
      return {
        ...backend,
        downloadToFile: async (_key: string, destination: string) => {
          boundary.downloadDirectory = dirname(destination);
          return copyOwnedBytesToFile({
            destination,
            openSource: async () => ({
              read: async () => {
                throw new Error('Synthetic storage read failed');
              },
              close: async () => {
                throw new Error('Synthetic storage close failed');
              },
            }),
          });
        },
      };
    },
    captureStorageBackend: async () => {
      const backend = await actual.captureStorageBackend();
      return {
        ...backend,
        writeBuffer: async (...parameters: Parameters<typeof backend.writeBuffer>) => {
          if (parameters[0].startsWith('materials/')) await boundary.beforeWrite?.();
          return backend.writeBuffer(...parameters);
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
vi.mock('@/lib/live-vocab', () => ({ extractAndStoreNoteVocab: vi.fn().mockResolvedValue(0) }));
vi.mock('@/lib/sidedoor/access/deletion/learning-deletion', async (original) => {
  const actual =
    await original<typeof import('@/lib/sidedoor/access/deletion/learning-deletion')>();
  return {
    ...actual,
    admitLearningStorageDeletion: async (
      ...args: Parameters<typeof actual.admitLearningStorageDeletion>
    ) => {
      if (args[0].scope.kind === 'course') await boundary.beforeCourseDeletion?.();
      return actual.admitLearningStorageDeletion(...args);
    },
  };
});

const suite =
  process.env.SIDEDOOR_TEST_DATABASE_URL && process.env.SOTTO_TEST_PRIVATE_REDIS_URL
    ? describe
    : describe.skip;
suite('owned original course materials', () => {
  let instance: SharedTestInstance;
  let identity: SharedTestIdentity;
  let courseId: string;
  beforeAll(async () => {
    const privateUrl = new URL(process.env.SOTTO_TEST_PRIVATE_REDIS_URL!);
    const redis = (await import('@/lib/redis')).getSharedQueueRedisClient();
    if (
      redis.options.host !== privateUrl.hostname ||
      redis.options.port !== Number(privateUrl.port) ||
      (redis.options.db ?? 0) !== Number(privateUrl.pathname.slice(1) || '0') ||
      Boolean(redis.options.tls) !== (privateUrl.protocol === 'rediss:')
    )
      throw new Error('Material queues are not connected to private Redis');
    instance = await createSharedTestInstance('course_materials');
    boundary.database = instance.database;
  });
  beforeEach(async () => {
    boundary.beforeWrite = null;
    boundary.beforeCourseDeletion = null;
    boundary.failDownload = false;
    boundary.downloadDirectory = '';
    boundary.generate.mockReset();
    boundary.generate.mockResolvedValue({
      content: JSON.stringify({
        level: 'A2',
        rationale: 'Past-tense source examples.',
        confidence: 0.8,
      }),
      model: 'captured',
    });
    vi.stubEnv('SELF_HOSTED', 'true');
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'http://localhost:3000');
    vi.stubEnv('SIDEDOOR_PASSWORD_ORIGINS', '[]');
    vi.stubEnv('SIDEDOOR_TRUSTED_PROXY', 'false');
    identity = await instance.reset();
    const curriculum = await instance.database.curriculum.upsert({
      where: { nativeLang_targetLang: { nativeLang: 'en', targetLang: 'de' } },
      create: { nativeLang: 'en', targetLang: 'de', title: 'Materials fixture' },
      update: {},
    });
    courseId = (
      await instance.database.course.create({
        data: {
          userId: identity.ownerId,
          nativeLang: 'en',
          targetLang: 'de',
          curriculumId: curriculum.id,
        },
      })
    ).id;
  });
  afterEach(() => vi.unstubAllEnvs());
  afterAll(async () => {
    await instance?.close();
    await closeRedis();
  });
  function request(
    path: string,
    token = identity.ownerToken,
    init: NonNullable<ConstructorParameters<typeof NextRequest>[1]> = {}
  ) {
    return new NextRequest(`http://localhost:3000/api/v1/${path}`, {
      ...init,
      headers: {
        cookie: `sotto_session=${token}`,
        origin: 'http://localhost:3000',
        ...init.headers,
      },
    });
  }
  async function retained(name = 'Vocab Deutsch.txt') {
    const form = new FormData();
    form.append(
      'files',
      new File(['Original German notes\nBahnhof means station.'], name, {
        type: 'text/plain',
      })
    );
    const response = await upload(
      request('materials', identity.ownerToken, { method: 'POST', body: form })
    );
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.materials[0]).not.toHaveProperty('originalUrl');
    return body.materials[0] as { id: string; name: string; extractedText: string };
  }
  function execution(userId = identity.ownerId, token = identity.ownerToken) {
    return {
      userId,
      authorize: async (database: Parameters<typeof resolveSottoRequest>[0]) => {
        const actor = await resolveSottoRequest(database, request('materials', token));
        if (!actor || actor.kind !== 'content') throw new Error('Missing learner');
        return actor;
      },
    };
  }
  it('retains original course notes and admits their full vocabulary index atomically', async () => {
    const text = 'Bahnhof = station\nFahrkarte = ticket';
    const form = new FormData();
    form.append('files', new File([text], 'Official German.md', { type: 'text/markdown' }));
    const response = await uploadNotes(
      request(`courses/${courseId}/notes`, identity.ownerToken, { method: 'POST', body: form }),
      { params: Promise.resolve({ courseId }) }
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({ body: '', imported: 1, failed: 0, vocabularyIndexing: 'queued' });
    expect(body.materials[0]).toMatchObject({
      name: 'Official German.md',
      extractedText: '',
      textRetained: true,
    });
    expect(body.materials[0]).not.toHaveProperty('originalUrl');
    expect(
      await instance.database.materialVocabularyIndex.findFirst({
        where: { materialId: body.materials[0].id },
      })
    ).toMatchObject({ courseId, status: 'PENDING', textLength: text.length });
    expect(await instance.database.learnerVocab.count({ where: { courseId } })).toBe(0);
    const original = await download(request(`materials/${body.materials[0].id}/file`), {
      params: Promise.resolve({ materialId: body.materials[0].id }),
    });
    expect(await original.text()).toBe(text);
    expect(await getCourseNote(courseId)).toContain(text);
  });

  it('attaches a pending retained source without admitting vocabulary before extraction', async () => {
    const material = await retained('Pending original.txt');
    const original = 'Original German notes\nBahnhof means station.';
    await instance.database.courseMaterial.update({
      where: { id: material.id },
      data: {
        originalSha256: createHash('sha256').update(original).digest('hex'),
        extractedText: '',
        processingStatus: 'QUEUED',
      },
    });
    await sottoTransaction(instance.database, (database) =>
      attachCourseMaterials(database, identity.ownerId, courseId, [material.id])
    );
    expect(
      await instance.database.courseMaterial.findUnique({
        where: { id: material.id },
        select: { courseId: true, processingStatus: true },
      })
    ).toEqual({ courseId, processingStatus: 'QUEUED' });
    expect(
      await instance.database.materialVocabularyIndex.count({
        where: { materialId: material.id },
      })
    ).toBe(0);
  });

  it('retains a PDF without transcription, reads its exact original for AI, and fences removal', async () => {
    const bytes = originalPdf(2, { text: false });
    const form = new FormData();
    form.append(
      'files',
      new File([new Uint8Array(bytes)], 'Original course.PDF', { type: 'application/pdf' })
    );
    const response = await upload(
      request('materials', identity.ownerToken, { method: 'POST', body: form })
    );
    expect(response.status).toBe(201);
    const { materials } = await response.json();
    expect(materials[0].extractedText).toBe('');
    const captured = await captureMaterialDocuments(execution(), {
      materialIds: [materials[0].id],
    });
    expect(captured.parts[0]?.data).toEqual(bytes);
    await instance.database.courseMaterial.update({
      where: { id: materials[0].id },
      data: { byteSize: bytes.length + 1 },
    });
    await expect(
      captureMaterialDocuments(execution(), { materialIds: [materials[0].id] })
    ).rejects.toThrow('type or size');
    await instance.database.courseMaterial.update({
      where: { id: materials[0].id },
      data: { byteSize: bytes.length },
    });
    const other = await identity.household('Other learner');
    await expect(
      captureMaterialDocuments(execution(other.id, other.token), { materialIds: [materials[0].id] })
    ).rejects.toThrow('unavailable');
    await sottoTransaction(instance.database, (database) =>
      attachCourseMaterials(database, identity.ownerId, courseId, [materials[0].id])
    );
    const courseDocuments = await captureMaterialDocuments(execution(), { courseId });
    expect(courseDocuments.parts[0]?.data).toEqual(bytes);
    expect(await getCourseNote(courseId)).toBe('');
    const original = await download(request(`materials/${materials[0].id}/file`), {
      params: Promise.resolve({ materialId: materials[0].id }),
    });
    expect(Buffer.from(await original.arrayBuffer())).toEqual(bytes);
    await deleteCourseCompletely(courseId);
    await expect(courseDocuments.validate()).rejects.toThrow('changed');
  });
  it('retains uppercase file extensions and preserves the original displayed filename', async () => {
    const material = await retained('Vocab Deutsch.TXT');
    expect(material.name).toBe('Vocab Deutsch.TXT');
    const response = await download(request(`materials/${material.id}/file`), {
      params: Promise.resolve({ materialId: material.id }),
    });
    expect(response.status).toBe(200);
    expect(await response.text()).toBe('Original German notes\nBahnhof means station.');
    expect(response.headers.get('content-disposition')).toContain('Vocab%20Deutsch.TXT');
    expect(
      (
        await download(request(`materials/${material.id}/file?variant=unknown`), {
          params: Promise.resolve({ materialId: material.id }),
        })
      ).status
    ).toBe(400);
    expect(
      (
        await download(request(`materials/${material.id}/file?variant=optimized`), {
          params: Promise.resolve({ materialId: material.id }),
        })
      ).status
    ).toBe(404);
  });
  it.each([
    {
      name: 'Vocab Deutsch.txt',
      content: new TextEncoder().encode('Complete source ending'),
      type: 'text/plain',
    },
    {
      name: 'Original course.pdf',
      content: new Uint8Array(originalPdf()),
      type: 'application/pdf',
    },
  ])(
    'rejects obsolete $type placement before retaining files or starting analysis',
    async (file) => {
      const form = new FormData();
      form.append('native', 'en');
      form.append('target', 'de');
      form.append('content', 'Untrimmed source text');
      form.append('files', new File([file.content], file.name, { type: file.type }));
      const response = await placementUpload(
        request('placement/from-notes/upload', identity.ownerToken, { method: 'POST', body: form })
      );
      expect(response.status).toBe(415);
      expect((await response.json()).error).toContain('resumable material uploader');
      expect(await instance.database.courseMaterial.count()).toBe(0);
      expect(await instance.database.materialAnalysis.count()).toBe(0);
    }
  );
  it('rejects oversized originals before retaining files or extracting content', async () => {
    const form = new FormData();
    form.append(
      'files',
      new File([new Uint8Array(50 * 1024 * 1024 + 1)], 'too-large.txt', { type: 'text/plain' })
    );
    const response = await upload(
      request('materials', identity.ownerToken, { method: 'POST', body: form })
    );
    expect(response.status).toBe(413);
    expect(await instance.database.courseMaterial.count()).toBe(0);
  });
  it('keeps a readable file associated with its original after another file fails extraction', async () => {
    const form = new FormData();
    form.append('files', new File(['unreadable binary'], 'bad.bin'));
    form.append('files', new File(['Hallo'], 'good.txt', { type: 'text/plain' }));
    const response = await upload(
      request('materials', identity.ownerToken, { method: 'POST', body: form })
    );
    expect(response.status).toBe(201);
    const result = await response.json();
    expect(result.failed).toBe(1);
    expect(result.materials).toHaveLength(1);
    expect(result.materials[0].name).toBe('good.txt');
    expect(result.materials[0]).toMatchObject({ extractedText: '', textRetained: true });
    const original = await download(request(`materials/${result.materials[0].id}/file`), {
      params: Promise.resolve({ materialId: result.materials[0].id }),
    });
    expect(await original.text()).toBe('Hallo');
  });
  it('retains the full extracted ending without turning the filename into source evidence', async () => {
    const source =
      'Vokabeln und Beispiele. '.repeat(4000) +
      'FINAL: Explain the contrast before proposing exercises.';
    const form = new FormData();
    form.append('files', new File([source], 'Vocab Deutsch.txt', { type: 'text/plain' }));
    const response = await upload(
      request('materials', identity.ownerToken, { method: 'POST', body: form })
    );
    expect(response.status).toBe(201);
    const result = await response.json();
    expect(result.materials[0].name).toBe('Vocab Deutsch.txt');
    expect(result.materials[0]).toMatchObject({ extractedText: '', textRetained: true });
    const stored = await instance.database.courseMaterial.findUniqueOrThrow({
      where: { id: result.materials[0].id },
    });
    expect(stored.extractedText).toBe(source);
  });
  it('rejects unsupported extracted length instead of saving a prefix as the complete document', async () => {
    const form = new FormData();
    form.append(
      'files',
      new File(['a'.repeat(1000001)], 'oversize-extract.txt', { type: 'text/plain' })
    );
    const response = await upload(
      request('materials', identity.ownerToken, { method: 'POST', body: form })
    );
    expect(response.status).toBe(400);
    expect(await instance.database.courseMaterial.count()).toBe(0);
  });
  it('retains download staging when a read and its cleanup both fail', async () => {
    const material = await retained();
    boundary.failDownload = true;
    try {
      const response = await download(request(`materials/${material.id}/file`), {
        params: Promise.resolve({ materialId: material.id }),
      });
      expect(response.status).toBe(502);
      expect(boundary.downloadDirectory).not.toBe('');
      expect((await stat(boundary.downloadDirectory)).isDirectory()).toBe(true);
    } finally {
      boundary.failDownload = false;
      if (boundary.downloadDirectory)
        await rm(boundary.downloadDirectory, { recursive: true, force: true });
    }
  });

  it('returns exact original bytes through the owning profile and rejects another learner', async () => {
    const material = await retained();
    const params = { params: Promise.resolve({ materialId: material.id }) };
    const response = await download(request(`materials/${material.id}/file`), params);
    expect(response.status).toBe(200);
    expect(await response.text()).toBe('Original German notes\nBahnhof means station.');
    expect(response.headers.get('content-disposition')).toContain('Vocab%20Deutsch.txt');
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    const other = await identity.household('Other learner');
    expect(
      (await download(request(`materials/${material.id}/file`, other.token), params)).status
    ).toBe(404);
  });
  it('keeps attached documents after clearing editable notes and feeds their extracts to generation', async () => {
    const material = await retained();
    await sottoTransaction(instance.database, (database) =>
      attachCourseMaterials(database, identity.ownerId, courseId, [material.id])
    );
    await sottoTransaction(instance.database, (database) =>
      attachCourseMaterials(database, identity.ownerId, courseId, [material.id])
    );
    const params = { params: Promise.resolve({ courseId }) };
    const response = await saveNotes(
      request(`courses/${courseId}/notes`, identity.ownerToken, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ body: '' }),
      }),
      params
    );
    expect(response.status).toBe(200);
    const result = await (await notes(request(`courses/${courseId}/notes`), params)).json();
    expect(result.body).toBe('');
    expect(result.materials).toHaveLength(1);
    expect(result.materials[0].name).toBe('Vocab Deutsch.txt');
    expect(await getCourseNote(courseId)).toContain('Bahnhof means station.');
  });
  it('cannot attach another learner document or a missing document', async () => {
    const material = await retained();
    const other = await identity.household('Other learner');
    await expect(
      sottoTransaction(instance.database, (database) =>
        attachCourseMaterials(database, other.id, courseId, [material.id])
      )
    ).rejects.toThrow();
    await expect(
      sottoTransaction(instance.database, (database) =>
        attachCourseMaterials(database, identity.ownerId, courseId, [randomUUID()])
      )
    ).rejects.toThrow();
    expect(
      (await instance.database.courseMaterial.findUniqueOrThrow({ where: { id: material.id } }))
        .courseId
    ).toBeNull();
  });
  it('keeps stable storage ownership through attachment and includes staged files in erasure inventory', async () => {
    const material = await retained();
    await sottoTransaction(instance.database, async (database) => {
      const stored = await database.courseMaterial.findUniqueOrThrow({
        where: { id: material.id },
      });
      const resolved = await resolveStorageInput(database, {
        consumer: `material:${material.id}:original`,
        reference: stored.originalUrl!,
      });
      const registry = new StorageReferenceRegistry(
        {
          query: (sql, values) =>
            database.$queryRawUnsafe<Record<string, unknown>[]>(sql, ...values),
        },
        'postgres',
        SIDEDOOR_STATE_ID
      );
      const asset = await registry.resolve({
        consumer: `material:${material.id}:original`,
        reference: stored.originalUrl!,
      });
      expect(asset).not.toBeNull();
      await attachCourseMaterials(database, identity.ownerId, courseId, [material.id]);
      expect(
        (await inspectStorageMigrationConsumer(database, resolved.input.consumer, asset!.prepared))
          .reason
      ).toBeNull();
      const references: string[] = [];
      await visitStorageDeletionReferences(
        database,
        { kind: 'profile', id: identity.ownerId },
        async (page) => {
          if (page.source === 'material') references.push(...page.rows.map((row) => row.id));
        }
      );
      expect(references).toContain(material.id);
    });
  });
  it('retires attached originals when their course is deleted', async () => {
    const material = await retained();
    await sottoTransaction(instance.database, (database) =>
      attachCourseMaterials(database, identity.ownerId, courseId, [material.id])
    );
    const result = await deleteCourseCompletely(courseId);
    expect(result.filesAttempted).toBe(1);
    expect(result.filesDeleted).toBe(1);
    expect(result.filesFailed).toBe(0);
    expect(result.cleanupPendingJobs).toBe(0);
    expect(
      await instance.database.courseMaterial.findUnique({ where: { id: material.id } })
    ).toBeNull();
    expect(
      (
        await download(request(`materials/${material.id}/file`), {
          params: Promise.resolve({ materialId: material.id }),
        })
      ).status
    ).toBe(404);
  });
  it('reports pending cleanup and preserves files until an interrupted deletion is resumed', async () => {
    const material = await retained();
    await sottoTransaction(instance.database, (database) =>
      attachCourseMaterials(database, identity.ownerId, courseId, [material.id])
    );
    const stored = await instance.database.courseMaterial.findUniqueOrThrow({
      where: { id: material.id },
    });
    if (!stored.originalUrl) throw new Error('Material original missing');
    const input = await sottoTransaction(instance.database, (database) =>
      resolveStorageInput(database, {
        consumer: `material:${material.id}:original`,
        reference: stored.originalUrl!,
      })
    );
    const backend = await captureStorageBackend();
    expect(await backend.has(input.input.key)).toBe(true);
    const runtime = await import('@/lib/sidedoor/storage/migration/storage-cleanup-runtime');
    const interrupted = vi
      .spyOn(runtime, 'runSottoStorageCleanup')
      .mockRejectedValue(new Error('Synthetic cleanup interruption'));
    let result: Awaited<ReturnType<typeof deleteCourseCompletely>>;
    try {
      result = await deleteCourseCompletely(courseId);
    } finally {
      interrupted.mockRestore();
    }
    expect(result.cleanupPendingJobs).toBeGreaterThan(0);
    expect(result.filesAttempted).toBeGreaterThanOrEqual(result.filesDeleted);
    expect(result.filesFailed).toBeGreaterThanOrEqual(0);
    expect(await backend.has(input.input.key)).toBe(true);
    const journal = new StorageCleanupJournal(
      {
        query: (sql, values) =>
          instance.database.$queryRawUnsafe<Record<string, unknown>[]>(sql, ...values),
      },
      'postgres',
      SIDEDOOR_STATE_ID
    );
    const jobs = await journal.listJobs();
    const job = jobs.jobs.find((item) => item.subjectId === `material:${material.id}`);
    if (!job) throw new Error('Material cleanup job missing');
    await runSottoStorageCleanup(instance.database, job.id);
    expect((await journal.get(job.id)).phase).toBe('complete');
    expect(await backend.has(input.input.key)).toBe(false);
  });
  it('deletes a course after an already erased class storage copy', async () => {
    const course = await instance.database.course.findUniqueOrThrow({ where: { id: courseId } });
    const classScope = { subjectId: `class:${randomUUID()}`, generation: 1 };
    const courseScope = { subjectId: `course:${courseId}`, generation: course.createdAt.getTime() };
    const copy = await sottoTransaction(instance.database, async (database) => {
      const outbox = sottoJobOutbox(database);
      return outbox.enqueue(
        prepareJob({
          namespace: SIDEDOOR_STATE_ID,
          handler: 'storage-migration-copy',
          version: 1,
          payload: {},
          scopes: [classScope, courseScope],
          delivery: { attempts: 1, priority: 0, availableAt: 0 },
        })
      );
    });
    await expect(deleteCourseCompletely(courseId)).rejects.toThrow(
      'Storage copy cannot be retired'
    );
    expect(await instance.database.course.findUnique({ where: { id: courseId } })).not.toBeNull();
    await sottoTransaction(instance.database, async (database) => {
      const outbox = sottoJobOutbox(database);
      await outbox.complete(copy.job.id, copy.fingerprint);
      const cleanup = new StorageCleanupJournal(
        {
          query: (sql, values) =>
            database.$queryRawUnsafe<Record<string, unknown>[]>(sql, ...values),
        },
        'postgres',
        SIDEDOOR_STATE_ID
      );
      await cleanup.createJob(
        prepareStorageCleanup({ namespace: SIDEDOOR_STATE_ID, ...classScope })
      );
      await outbox.erase(copy.job.id, copy.fingerprint, classScope);
    });
    await deleteCourseCompletely(courseId);
    expect(await instance.database.course.findUnique({ where: { id: courseId } })).toBeNull();
  });

  registerAssessmentDeletionCase(() => ({ instance, identity, courseId, boundary }));

  it('retries course deletion when another episode is linked after inventory', async () => {
    const first = await instance.database.episode.create({
      data: { userId: identity.ownerId, title: 'First', topic: 'Test' },
    });
    const late = await instance.database.episode.create({
      data: { userId: identity.ownerId, title: 'Late', topic: 'Test' },
    });
    await instance.database.practiceSession.create({
      data: { courseId, kind: 'LISTENING', items: [], seed: 'first', episodeId: first.id },
    });
    let started!: () => void;
    let release!: () => void;
    const startedPromise = new Promise<void>((resolve) => {
      started = resolve;
    });
    const releasePromise = new Promise<void>((resolve) => {
      release = resolve;
    });
    boundary.beforeCourseDeletion = async () => {
      boundary.beforeCourseDeletion = null;
      started();
      await releasePromise;
    };
    const deletion = deleteCourseCompletely(courseId);
    await Promise.race([
      startedPromise,
      deletion.then(() => {
        throw new Error('Deletion completed before the test barrier');
      }),
    ]);
    await instance.database.practiceSession
      .create({
        data: { courseId, kind: 'LISTENING', items: [], seed: 'late', episodeId: late.id },
      })
      .finally(release);
    const result = await deletion;
    expect(result.episodesDeleted).toBe(2);
    expect(
      await instance.database.episode.count({ where: { id: { in: [first.id, late.id] } } })
    ).toBe(0);
  });
  it('placement keeps pasted notes editable and attaches the original documents', async () => {
    const material = await retained();
    await persistPlacementMaterials(
      courseId,
      {
        userId: identity.ownerId,
        authorize: async (database) => {
          const actor = await resolveSottoRequest(database, request('materials'));
          if (!actor || actor.kind !== 'content') throw new Error('Missing learner');
          return actor;
        },
      },
      { materialIds: [material.id], editableContent: 'Travel goals' }
    );
    const result = await (
      await notes(request(`courses/${courseId}/notes`), { params: Promise.resolve({ courseId }) })
    ).json();
    expect(result.body).toBe('Travel goals');
    expect(result.materials[0].id).toBe(material.id);
  });
  it('factory reset retires staged originals and leaves the learner profile intact', async () => {
    const material = await retained();
    const result = await factoryReset();
    expect(result.filesDeleted).toBe(1);
    expect(result.cleanupPendingJobs).toBe(0);
    expect(await instance.database.courseMaterial.count()).toBe(0);
    expect(
      await instance.database.user.findUnique({ where: { id: identity.ownerId } })
    ).not.toBeNull();
    expect(
      (
        await download(request(`materials/${material.id}/file`), {
          params: Promise.resolve({ materialId: material.id }),
        })
      ).status
    ).toBe(404);
  });
  it('factory reset fences an original upload that was already admitted', async () => {
    let begin!: () => void;
    let resume!: () => void;
    const started = new Promise<void>((resolve) => {
      begin = resolve;
    });
    const released = new Promise<void>((resolve) => {
      resume = resolve;
    });
    boundary.beforeWrite = async () => {
      begin();
      await released;
    };
    const form = new FormData();
    form.append('files', new File(['Late original'], 'late.txt', { type: 'text/plain' }));
    const uploading = upload(
      request('materials', identity.ownerToken, { method: 'POST', body: form })
    );
    await started;
    const pending = await instance.database.courseMaterial.findFirstOrThrow();
    expect(pending.originalUrl).toBeNull();
    const resetting = factoryReset();
    try {
      await vi.waitFor(async () => expect(await instance.database.courseMaterial.count()).toBe(0));
    } finally {
      resume();
    }
    const response = await uploading;
    expect(response.ok).toBe(false);
    await resetting;
    const journal = new StorageCleanupJournal(
      {
        query: (sql, values) =>
          instance.database.$queryRawUnsafe<Record<string, unknown>[]>(sql, ...values),
      },
      'postgres',
      SIDEDOOR_STATE_ID
    );
    const page = await journal.listJobs();
    const job = page.jobs.find((value) => value.subjectId === `material:${pending.id}`);
    expect(job).toBeDefined();
    await runSottoStorageCleanup(instance.database, job!.id);
    expect((await journal.get(job!.id)).phase).toBe('complete');
    expect(await instance.database.courseMaterial.count()).toBe(0);
  });
});
