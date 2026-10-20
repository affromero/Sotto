// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  StorageBackendRegistry,
  StorageReferenceRegistry,
  StorageWriteJournal,
  prepareStorageBackend,
  prepareStorageReference,
  prepareStorageTombstone,
  storageBackendBinding,
} from 'thesidedoor-core/storage';
import type { Prisma } from '@/generated/prisma/client';
import { materialStorageScopes } from '@/lib/course-materials';
import { materialUploadStorageScopes } from '@/lib/course-materials/uploads/scopes';
import {
  consumerForStorageField,
  readStorageConsumerReference,
  replaceStorageConsumerReference,
} from '@/lib/sidedoor/storage/core/storage-consumers';
import {
  visitStorageDeletionReferences,
  type StorageDeletionReferencePage,
  type StorageDeletionScope,
} from '@/lib/storage/sidedoor/deletion-targets';
import { inspectStorageMigrationConsumer } from '@/lib/sidedoor/storage/migration/storage-migration-plan';
import { readStorageMigrationReferencePage } from '@/lib/sidedoor/storage/migration/storage-migration-references';
import { resolveSottoRequest } from '@/lib/sidedoor/access/core/request-identity';
import { SHARED_SESSION_COOKIE } from '@/lib/sidedoor/access/core/session-identity';
import { SIDEDOOR_STATE_ID } from '@/lib/sidedoor/access/state/store';
import { sottoTransaction } from '@/lib/sidedoor/access/state/transaction';
import {
  createSharedTestInstance,
  type SharedTestInstance,
  type SharedTestIdentity,
} from '../../../../helpers/setup/shared-instance';

const suite = process.env.SIDEDOOR_TEST_DATABASE_URL ? describe : describe.skip;
suite('resumable upload storage ownership', () => {
  let instance: SharedTestInstance;
  let identity: SharedTestIdentity;
  beforeAll(async () => {
    instance = await createSharedTestInstance('material_upload_storage');
  });
  beforeEach(async () => {
    identity = await instance.reset();
  });
  afterAll(async () => {
    await instance?.close();
  });

  function executor(database: Prisma.TransactionClient) {
    return {
      query: (sql: string, values: readonly unknown[]) =>
        database.$queryRawUnsafe<Record<string, unknown>[]>(sql, ...values),
    };
  }

  async function fixture(userId = identity.ownerId, partCount = 1) {
    const material = await instance.database.courseMaterial.create({
      data: {
        userId,
        name: 'Course notes.pdf',
        mimeType: 'application/pdf',
        byteSize: partCount,
        extractedText: '',
      },
    });
    const batch = await instance.database.materialUploadBatch.create({
      data: {
        userId,
        requestId: randomUUID(),
        fingerprint: 'a'.repeat(64),
        expiresAt: new Date('2030-01-01T00:00:00Z'),
      },
    });
    const upload = await instance.database.materialUpload.create({
      data: {
        batchId: batch.id,
        materialId: material.id,
        clientId: randomUUID(),
        expiresAt: batch.expiresAt,
      },
      include: { material: true },
    });
    await instance.database.materialUploadPart.createMany({
      data: Array.from({ length: partCount }, (_, index) => ({
        id: randomUUID(),
        uploadId: upload.id,
        index,
        offset: index,
        byteSize: 1,
        sha256: 'b'.repeat(64),
        writeToken: randomUUID(),
        originalUrl: `parts/${upload.id}/${index}`,
        committedAt: new Date(),
      })),
    });
    const parts = await instance.database.materialUploadPart.findMany({
      where: { uploadId: upload.id },
      orderBy: { index: 'asc' },
    });
    return { material, batch, upload, parts };
  }

  async function course(userId = identity.ownerId) {
    const curriculum = await instance.database.curriculum.upsert({
      where: { nativeLang_targetLang: { nativeLang: 'en', targetLang: 'de' } },
      create: { nativeLang: 'en', targetLang: 'de', title: 'German' },
      update: {},
    });
    return instance.database.course.create({
      data: { userId, curriculumId: curriculum.id, nativeLang: 'en', targetLang: 'de' },
    });
  }

  async function references(scope: StorageDeletionScope) {
    const pages: StorageDeletionReferencePage[] = [];
    await sottoTransaction(instance.database, (database) =>
      visitStorageDeletionReferences(database, scope, async (page) => {
        pages.push(page);
      })
    );
    return pages;
  }

  async function registered(value: Awaited<ReturnType<typeof fixture>>) {
    return sottoTransaction(instance.database, async (database) => {
      const location = {
        kind: 'object' as const,
        endpoint: 'https://historical.example',
        bucket: 'documents',
      };
      const backend = prepareStorageBackend(SIDEDOOR_STATE_ID, {
        kind: 'object',
        location,
        binding: storageBackendBinding(location),
        publicUrl: 'https://documents.example',
      });
      await new StorageBackendRegistry(executor(database), 'postgres', SIDEDOOR_STATE_ID).register(
        backend
      );
      const materialOwnership = await materialStorageScopes(database, value.material);
      const uploadOwnership = await materialUploadStorageScopes(database, value.upload);
      const consumers = {
        original: `material:${value.material.id}:original`,
        optimized: `material:${value.material.id}:optimized`,
        part: `upload-part:${value.parts[0]!.id}:original`,
      };
      function prepare(key: string, scopes: typeof materialOwnership.scopes) {
        return prepareStorageReference({
          namespace: SIDEDOOR_STATE_ID,
          operationId: randomUUID(),
          reference: `https://documents.example/${key}`,
          target: { backendId: backend.id, binding: backend.binding, key },
          scopes,
        });
      }
      const prepared = {
        original: prepare(`${value.material.id}/original.pdf`, materialOwnership.scopes),
        optimized: prepare(`${value.material.id}/optimized.pdf`, materialOwnership.scopes),
        part: prepare(`${value.upload.id}/part.bin`, uploadOwnership.scopes),
      };
      const registry = new StorageReferenceRegistry(
        executor(database),
        'postgres',
        SIDEDOOR_STATE_ID
      );
      for (const slot of ['original', 'optimized', 'part'] as const)
        await registry.replaceMany({
          consumers: [{ consumer: consumers[slot], previousReference: null }],
          next: prepared[slot],
        });
      await database.courseMaterial.update({
        where: { id: value.material.id },
        data: {
          originalUrl: prepared.original.reference,
          optimizedUrl: prepared.optimized.reference,
        },
      });
      await database.materialUploadPart.update({
        where: { id: value.parts[0]!.id },
        data: { originalUrl: prepared.part.reference },
      });
      return { consumers, prepared, materialOwnership, uploadOwnership };
    });
  }

  it('keeps material and transfer fences stable when a staged document is attached to a course', async () => {
    const value = await fixture();
    const before = await sottoTransaction(instance.database, (database) =>
      materialUploadStorageScopes(database, value.upload)
    );
    const attachedCourse = await course();
    const material = await instance.database.courseMaterial.update({
      where: { id: value.material.id },
      data: { courseId: attachedCourse.id },
    });
    const after = await sottoTransaction(instance.database, (database) =>
      materialUploadStorageScopes(database, { ...value.upload, material })
    );
    expect(after).toEqual(before);
    expect(after.scopes).toContainEqual({
      subjectId: `material:${material.id}`,
      generation: material.createdAt.getTime(),
    });
    expect(after.scopes).toContainEqual({
      subjectId: `material-upload:${value.upload.id}`,
      generation: value.upload.createdAt.getTime(),
    });
    expect(after.scopes.some((scope) => scope.subjectId === `course:${attachedCourse.id}`)).toBe(
      false
    );
  });

  it('pages all transfer references while upload-only cleanup excludes retained documents and unrelated entities', async () => {
    const own = await fixture(identity.ownerId, 205);
    const other = await identity.household('Other learner');
    const foreign = await fixture(other.id);
    await instance.database.courseMaterial.update({
      where: { id: own.material.id },
      data: { originalUrl: 'retained/original.pdf', optimizedUrl: 'retained/optimized.pdf' },
    });
    const pages = await references({ kind: 'material-upload', id: own.upload.id });
    expect(pages.map((page) => page.rows.length)).toEqual([100, 100, 5]);
    expect(pages.every((page) => page.source === 'upload-part')).toBe(true);
    expect(new Set(pages.flatMap((page) => page.rows.map((row) => row.id)))).toEqual(
      new Set(own.parts.map((part) => part.id))
    );
    expect(pages.flatMap((page) => page.rows).some((row) => row.id === foreign.parts[0]!.id)).toBe(
      false
    );
    expect(
      pages.flatMap((page) => page.rows.flatMap((row) => Object.values(row.references)))
    ).not.toContain('retained/original.pdf');
  });

  it('collects one material and its transfer parts without collecting sibling or foreign materials', async () => {
    const own = await fixture();
    const sibling = await fixture();
    const other = await identity.household('Other learner');
    const foreign = await fixture(other.id);
    await instance.database.courseMaterial.update({
      where: { id: own.material.id },
      data: { originalUrl: 'material/original.pdf', optimizedUrl: 'material/optimized.pdf' },
    });
    const pages = await references({ kind: 'material', id: own.material.id });
    expect(pages.map((page) => page.source)).toEqual(['material', 'upload-part']);
    expect(pages[0]!.rows).toEqual([
      {
        id: own.material.id,
        references: {
          originalUrl: 'material/original.pdf',
          optimizedUrl: 'material/optimized.pdf',
        },
      },
    ]);
    expect(pages[1]!.rows.map((row) => row.id)).toEqual([own.parts[0]!.id]);
    const selected = pages.flatMap((page) => page.rows.map((row) => row.id));
    expect(selected).not.toContain(sibling.parts[0]!.id);
    expect(selected).not.toContain(foreign.parts[0]!.id);
  });

  it('collects profile-staged parts and restricts course deletion to attached materials', async () => {
    const attached = await fixture();
    const staged = await fixture();
    const other = await identity.household('Other learner');
    const foreign = await fixture(other.id);
    const ownedCourse = await course();
    await instance.database.courseMaterial.update({
      where: { id: attached.material.id },
      data: { courseId: ownedCourse.id },
    });
    const coursePages = await references({ kind: 'course', id: ownedCourse.id, episodeIds: [] });
    expect(
      coursePages
        .filter((page) => page.source === 'upload-part')
        .flatMap((page) => page.rows.map((row) => row.id))
    ).toEqual([attached.parts[0]!.id]);
    const profilePages = await references({ kind: 'profile', id: identity.ownerId });
    expect(
      new Set(
        profilePages
          .filter((page) => page.source === 'upload-part')
          .flatMap((page) => page.rows.map((row) => row.id))
      )
    ).toEqual(new Set([attached.parts[0]!.id, staged.parts[0]!.id]));
    expect(profilePages.flatMap((page) => page.rows.map((row) => row.id))).not.toContain(
      foreign.parts[0]!.id
    );
  });

  it('uses guarded canonical replacement for both optimized documents and parts', async () => {
    const value = await fixture();
    const saved = await registered(value);
    expect(consumerForStorageField('material', value.material.id, 'optimizedUrl')).toBe(
      saved.consumers.optimized
    );
    expect(consumerForStorageField('upload-part', value.parts[0]!.id, 'originalUrl')).toBe(
      saved.consumers.part
    );
    await sottoTransaction(instance.database, async (database) => {
      await replaceStorageConsumerReference(
        database,
        saved.consumers.optimized,
        saved.prepared.optimized.reference,
        'relocated/optimized.pdf'
      );
      await replaceStorageConsumerReference(
        database,
        saved.consumers.part,
        saved.prepared.part.reference,
        'relocated/part.bin'
      );
    });
    const current = await sottoTransaction(instance.database, async (database) => ({
      original: await readStorageConsumerReference(database, saved.consumers.original),
      optimized: await readStorageConsumerReference(database, saved.consumers.optimized),
      part: await readStorageConsumerReference(database, saved.consumers.part),
    }));
    expect(current).toEqual({
      original: saved.prepared.original.reference,
      optimized: 'relocated/optimized.pdf',
      part: 'relocated/part.bin',
    });
    await expect(
      sottoTransaction(instance.database, (database) =>
        replaceStorageConsumerReference(
          database,
          saved.consumers.part,
          saved.prepared.part.reference,
          'unexpected/part.bin'
        )
      )
    ).rejects.toThrow('Storage consumer changed');
  });

  it('discovers both new fields through the fixed application reference inventory', async () => {
    const value = await fixture();
    const saved = await registered(value);
    const request = new Request('http://localhost/api/v1/admin/storage/migrate', {
      headers: { cookie: `${SHARED_SESSION_COOKIE}=${identity.ownerToken}` },
    });
    const admission = await sottoTransaction(instance.database, (database) =>
      resolveSottoRequest(database, request)
    );
    if (!admission || admission.kind !== 'content') throw new Error('Missing owner admission');
    const page = await sottoTransaction(instance.database, (database) =>
      readStorageMigrationReferencePage({ database, request, admission })
    );
    for (const consumer of [saved.consumers.optimized, saved.consumers.part])
      expect(page.references).toContainEqual(
        expect.objectContaining({ consumer, attribution: 'registered', issue: null })
      );
  });

  it('rejects upload generation changes without invalidating the retained original', async () => {
    const value = await fixture();
    const saved = await registered(value);
    await instance.database.materialUpload.update({
      where: { id: value.upload.id },
      data: { createdAt: new Date(value.upload.createdAt.getTime() + 1000) },
    });
    const results = await sottoTransaction(instance.database, async (database) => ({
      part: await inspectStorageMigrationConsumer(
        database,
        saved.consumers.part,
        saved.prepared.part
      ),
      original: await inspectStorageMigrationConsumer(
        database,
        saved.consumers.original,
        saved.prepared.original
      ),
    }));
    expect(results.part.reason).toBe('ownership-changed');
    expect(results.original.reason).toBeNull();
  });

  it('rejects material generation changes for optimized documents and transfer parts', async () => {
    const value = await fixture();
    const saved = await registered(value);
    await instance.database.courseMaterial.update({
      where: { id: value.material.id },
      data: { createdAt: new Date(value.material.createdAt.getTime() + 1000) },
    });
    for (const slot of ['original', 'optimized', 'part'] as const) {
      const result = await sottoTransaction(instance.database, (database) =>
        inspectStorageMigrationConsumer(database, saved.consumers[slot], saved.prepared[slot])
      );
      expect(result.reason).toBe('ownership-changed');
    }
  });

  it('fences completed-upload parts while the original and optimized material remain migratable', async () => {
    const value = await fixture();
    const saved = await registered(value);
    await sottoTransaction(instance.database, (database) =>
      new StorageWriteJournal(executor(database), 'postgres', SIDEDOOR_STATE_ID).forbidWrites(
        prepareStorageTombstone({
          namespace: SIDEDOOR_STATE_ID,
          subjectId: `material-upload:${value.upload.id}`,
          generation: value.upload.createdAt.getTime(),
          jobId: randomUUID(),
        })
      )
    );
    for (const slot of ['original', 'optimized', 'part'] as const) {
      const result = await sottoTransaction(instance.database, (database) =>
        inspectStorageMigrationConsumer(database, saved.consumers[slot], saved.prepared[slot])
      );
      expect(result.reason).toBe(slot === 'part' ? 'ownership-changed' : null);
    }
  });
});
