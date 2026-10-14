// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { NextRequest } from 'next/server';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@/generated/prisma/client';
import { POST as upload } from '@/app/api/v1/materials/route';
import { GET as download } from '@/app/api/v1/materials/[materialId]/file/route';
import { GET as notes, PUT as saveNotes } from '@/app/api/v1/courses/[courseId]/notes/route';
import { getCourseNote } from '@/lib/course-notes';
import { attachCourseMaterials, persistPlacementMaterials } from '@/lib/course-materials';
import { factoryReset } from '@/lib/admin/factory-reset';
import { resolveSottoRequest } from '@/lib/sidedoor/access/core/request-identity';
import { deleteCourseCompletely } from '@/lib/course-deletion';
import { sottoTransaction } from '@/lib/sidedoor/access/state/transaction';
import { resolveStorageInput } from '@/lib/sidedoor/storage/core/storage-inputs';
import { inspectStorageMigrationConsumer } from '@/lib/sidedoor/storage/migration/storage-migration-plan';
import { StorageReferenceRegistry, StorageCleanupJournal } from 'thesidedoor-core/storage';
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
}));
vi.mock('@/lib/r2', async (original) => {
  const actual = await original<typeof import('@/lib/r2')>();
  return {
    ...actual,
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

const suite = process.env.SIDEDOOR_TEST_DATABASE_URL ? describe : describe.skip;
suite('owned original course materials', () => {
  let instance: SharedTestInstance;
  let identity: SharedTestIdentity;
  let courseId: string;
  beforeAll(async () => {
    instance = await createSharedTestInstance('course_materials');
    boundary.database = instance.database;
  });
  beforeEach(async () => {
    boundary.beforeWrite = null;
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
  it('retains uppercase file extensions and preserves the original displayed filename', async () => {
    const material = await retained('Vocab Deutsch.TXT');
    expect(material.name).toBe('Vocab Deutsch.TXT');
    const response = await download(request(`materials/${material.id}/file`), {
      params: Promise.resolve({ materialId: material.id }),
    });
    expect(response.status).toBe(200);
    expect(await response.text()).toBe('Original German notes\nBahnhof means station.');
    expect(response.headers.get('content-disposition')).toContain('Vocab%20Deutsch.TXT');
  });
  it('rejects oversized originals before retaining files or extracting content', async () => {
    const form = new FormData();
    form.append(
      'files',
      new File([new Uint8Array(10 * 1024 * 1024 + 1)], 'too-large.txt', { type: 'text/plain' })
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
    expect(result.materials[0].extractedText).toContain('good.txt');
    expect(result.materials[0].extractedText).toContain('Hallo');
    const original = await download(request(`materials/${result.materials[0].id}/file`), {
      params: Promise.resolve({ materialId: result.materials[0].id }),
    });
    expect(await original.text()).toBe('Hallo');
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
    expect(result.filesDeleted).toBe(1);
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
