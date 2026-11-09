import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { it, expect, vi } from 'vitest';
import {
  LocalStorageCleanup,
  StorageBackendRegistry,
  StorageReferenceRegistry,
  prepareStorageBackend,
  prepareStorageReference,
} from 'thesidedoor-core/storage';
import { prepareJob } from 'thesidedoor-core/runtime/outbox';
import { isSerializationConflict } from 'thesidedoor-core/storage/sql';
import { sottoTransaction } from '@/lib/sidedoor/access/state/transaction';
import { sottoJobOutbox } from '@/lib/sidedoor/jobs/core/job-delivery';
import { sottoJobExecutions } from '@/lib/sidedoor/jobs/core/job-execution-lifetime';
import { captureCourseStorage } from '@/lib/sidedoor/storage/core/course-storage';
import { capturedLocalBackend } from '@/lib/storage/sidedoor/captured-local';
import { LOCAL_STORAGE_URL_PREFIX } from '@/lib/r2';
import { SIDEDOOR_STATE_ID } from '@/lib/sidedoor/access/state/store';
import { authorizedLearnerExecution } from '../../../../helpers/runtime/provider-execution';
import type {
  SharedTestInstance,
  SharedTestIdentity,
} from '../../../../helpers/setup/shared-instance';

export function registerWorksheetDeletionCases(
  getContext: () => {
    instance: SharedTestInstance;
    identity: SharedTestIdentity;
    classId: string;
  }
) {
  it.each(['disabled', 'missing', 'incomplete', 'conditional'] as const)(
    'rejects delegated cleanup when its database fence is %s',
    async (mode) => {
      const { instance } = getContext();
      const { requireStorageTargetFence } =
        await import('@/lib/sidedoor/access/deletion/learning-deletion');
      await expect(
        sottoTransaction(instance.database, async (tx) => {
          if (mode === 'disabled')
            await tx.$executeRawUnsafe(
              'ALTER TABLE "SidedoorState" DISABLE TRIGGER "SidedoorState_storage_target_fence"'
            );
          else {
            await tx.$executeRawUnsafe(
              'DROP TRIGGER "SidedoorState_storage_target_fence" ON "SidedoorState"'
            );
            if (mode === 'incomplete')
              await tx.$executeRawUnsafe(
                'CREATE TRIGGER "SidedoorState_storage_target_fence" BEFORE INSERT ON "SidedoorState" FOR EACH ROW EXECUTE FUNCTION "guardStorageTargetFence"()'
              );
            if (mode === 'conditional')
              await tx.$executeRawUnsafe(
                'CREATE TRIGGER "SidedoorState_storage_target_fence" BEFORE INSERT OR UPDATE OR DELETE ON "SidedoorState" FOR EACH ROW WHEN (pg_trigger_depth() = 0) EXECUTE FUNCTION "guardStorageTargetFence"()'
              );
          }
          await requireStorageTargetFence(tx);
        })
      ).rejects.toThrow('Storage target fence is unavailable');
    }
  );

  it('rejects legacy worksheet inspection under a stale course generation', async () => {
    const { instance, classId } = getContext();
    const cls = await instance.database.courseClass.findUniqueOrThrow({ where: { id: classId } });
    const { inspectLegacyWorksheetDeletion } =
      await import('@/lib/classes/help/listening-deletion');
    await expect(
      sottoTransaction(instance.database, async (tx) => {
        const ownership = await captureCourseStorage(tx, cls.courseId);
        const course = ownership.scopes.find(
          (scope) => scope.subjectId === `course:${cls.courseId}`
        );
        if (!course) throw new Error('Missing course scope');
        await inspectLegacyWorksheetDeletion(
          tx,
          { ...course, generation: course.generation + 1 },
          classId,
          cls.courseId
        );
      })
    ).rejects.toThrow('active or requires recovery');
  });

  it.each([
    'ordinary',
    'legacy-completed',
    'legacy-unindexed',
    'legacy-many',
    'legacy-executing',
    'legacy-unfenced',
    'legacy-empty',
    'legacy-interrupted',
    'legacy-shared',
    'legacy-other-namespace',
    'legacy-shared-concurrent',
    'legacy-stale',
    'shared',
    'interrupted',
    'active',
    'unindexed-active',
    'unindexed-completed',
  ] as const)('deletes a class-owned worksheet while preserving its course (%s)', async (mode) => {
    const { instance, identity, classId } = getContext();
    const root = await mkdtemp(join(tmpdir(), 'sotto-worksheet-class-delete-'));
    const backend = await capturedLocalBackend(
      await LocalStorageCleanup.capture(root),
      root,
      LOCAL_STORAGE_URL_PREFIX,
      () => {}
    );
    const storage = await import('@/lib/r2');
    const capture = vi.spyOn(storage, 'captureStorageBackend').mockResolvedValue(backend);
    try {
      const cls = await instance.database.courseClass.findUniqueOrThrow({
        where: { id: classId },
      });
      const key = `worksheets/${classId}/fixture.pdf`;
      const reference =
        mode === 'legacy-empty'
          ? ''
          : await backend.writeBuffer(key, Buffer.from('worksheet'), 'application/pdf');
      const consumer = `class:${classId}:worksheet`;
      const otherClass =
        mode === 'shared' || mode === 'legacy-shared' || mode === 'legacy-shared-concurrent'
          ? await instance.database.courseClass.create({
              data: {
                courseId: cls.courseId,
                lessonId: cls.lessonId,
                order: 2,
                status: 'IN_PROGRESS',
                worksheetPdfUrl: reference,
              },
            })
          : null;
      const worksheetOperationId = randomUUID();
      const earlierWorksheetOperationId = mode === 'legacy-many' ? randomUUID() : null;
      const otherOperationId = mode === 'legacy-shared-concurrent' ? randomUUID() : null;
      await sottoTransaction(instance.database, async (tx) => {
        const { capturePrerequisiteOwnership } =
          await import('@/lib/classes/help/lifecycle/prerequisite-ownership');
        const ownership = await capturePrerequisiteOwnership(
          tx,
          classId,
          cls.courseId,
          identity.ownerId
        );
        const scopes = mode.startsWith('legacy-')
          ? (await captureCourseStorage(tx, cls.courseId)).scopes
          : ownership.scopes;
        const executor = {
          query: (sql: string, values: readonly unknown[]) =>
            tx.$queryRawUnsafe<Record<string, unknown>[]>(sql, ...values),
        };
        const registered = prepareStorageBackend(SIDEDOOR_STATE_ID, backend.descriptor);
        await new StorageBackendRegistry(executor, 'postgres', SIDEDOOR_STATE_ID).register(
          registered
        );
        if (reference)
          await new StorageReferenceRegistry(executor, 'postgres', SIDEDOOR_STATE_ID).replaceMany({
            consumers: [
              { consumer, previousReference: null },
              ...(otherClass
                ? [{ consumer: `class:${otherClass.id}:worksheet`, previousReference: null }]
                : []),
            ],
            next: prepareStorageReference({
              namespace: SIDEDOOR_STATE_ID,
              operationId: randomUUID(),
              reference,
              localRoutePrefix: LOCAL_STORAGE_URL_PREFIX,
              target: { backendId: registered.id, binding: registered.binding, key },
              scopes,
            }),
          });
        if (mode === 'legacy-other-namespace') {
          const otherBackend = prepareStorageBackend('other-namespace', backend.descriptor);
          await new StorageBackendRegistry(executor, 'postgres', 'other-namespace').register(
            otherBackend
          );
          await new StorageReferenceRegistry(executor, 'postgres', 'other-namespace').replace({
            consumer: 'other:survivor',
            previousReference: null,
            next: prepareStorageReference({
              namespace: 'other-namespace',
              operationId: randomUUID(),
              reference,
              localRoutePrefix: LOCAL_STORAGE_URL_PREFIX,
              target: { backendId: otherBackend.id, binding: otherBackend.binding, key },
              scopes,
            }),
          });
        }
        const outbox = sottoJobOutbox(tx);
        const record = await outbox.enqueue(
          prepareJob({
            id: worksheetOperationId,
            namespace: SIDEDOOR_STATE_ID,
            handler: 'worksheet-pdf',
            version: mode.startsWith('legacy-') ? 1 : 2,
            payload: {
              classId,
              classUpdatedAt:
                mode === 'legacy-stale' ? cls.createdAt.getTime() - 1 : cls.updatedAt.getTime(),
              appBaseUrl: 'https://example.com',
            },
            scopes,
            delivery: { attempts: 2, priority: 0, availableAt: 0 },
          })
        );
        if (mode === 'legacy-executing')
          await sottoJobExecutions(tx).begin({
            id: randomUUID(),
            parentId: record.job.id,
            fingerprint: record.fingerprint,
            executorId: randomUUID(),
          });
        if (mode !== 'active' && mode !== 'unindexed-active')
          await outbox.complete(record.job.id, record.fingerprint);
        if (earlierWorksheetOperationId) {
          const earlier = await outbox.enqueue(
            prepareJob({
              id: earlierWorksheetOperationId,
              namespace: SIDEDOOR_STATE_ID,
              handler: 'worksheet-pdf',
              version: 1,
              payload: {
                classId,
                classUpdatedAt: cls.updatedAt.getTime(),
                appBaseUrl: 'https://example.com',
              },
              scopes,
              delivery: { attempts: 2, priority: 0, availableAt: 0 },
            })
          );
          await outbox.complete(earlier.job.id, earlier.fingerprint);
        }
        if (otherOperationId && otherClass) {
          const other = await outbox.enqueue(
            prepareJob({
              id: otherOperationId,
              namespace: SIDEDOOR_STATE_ID,
              handler: 'worksheet-pdf',
              version: 1,
              payload: {
                classId: otherClass.id,
                classUpdatedAt: otherClass.updatedAt.getTime(),
                appBaseUrl: 'https://example.com',
              },
              scopes,
              delivery: { attempts: 2, priority: 0, availableAt: 0 },
            })
          );
          await outbox.complete(other.job.id, other.fingerprint);
        }
        if (reference)
          await tx.courseClass.update({
            where: { id: classId },
            data: { worksheetPdfUrl: reference },
          });
      });
      if (
        mode === 'unindexed-active' ||
        mode === 'unindexed-completed' ||
        mode === 'legacy-unindexed'
      ) {
        const removed = await instance.database.sidedoorState.deleteMany({
          where: { id: { startsWith: 'sd-jsc:', endsWith: worksheetOperationId } },
        });
        expect(removed.count).toBeGreaterThan(0);
      }
      const { deleteClassForUser } = await import('@/lib/class-service');
      if (mode === 'legacy-other-namespace') {
        await expect(
          deleteClassForUser(
            classId,
            identity.ownerId,
            authorizedLearnerExecution(identity.ownerId)
          )
        ).rejects.toThrow('Storage target has live consumers');
        expect(
          await instance.database.courseClass.findUnique({ where: { id: classId } })
        ).not.toBeNull();
        expect(await backend.has(key)).toBe(true);
        expect(await sottoJobOutbox(instance.database).receipt(worksheetOperationId)).toMatchObject(
          { status: 'complete' }
        );
        const survivor = await sottoTransaction(instance.database, (tx) =>
          new StorageReferenceRegistry(
            {
              query: (sql, values) => tx.$queryRawUnsafe<Record<string, unknown>[]>(sql, ...values),
            },
            'postgres',
            'other-namespace'
          ).resolve({ consumer: 'other:survivor', reference })
        );
        expect(survivor?.prepared.target.key).toBe(key);
        return;
      }
      if (mode === 'legacy-unfenced') {
        await instance.database.$executeRawUnsafe(
          'ALTER TABLE "SidedoorState" DISABLE TRIGGER "SidedoorState_storage_target_fence"'
        );
        try {
          await expect(
            deleteClassForUser(
              classId,
              identity.ownerId,
              authorizedLearnerExecution(identity.ownerId)
            )
          ).rejects.toThrow('Storage target fence is unavailable');
          expect(
            await instance.database.courseClass.findUnique({ where: { id: classId } })
          ).not.toBeNull();
          expect(await backend.has(key)).toBe(true);
          expect(
            await sottoJobOutbox(instance.database).receipt(worksheetOperationId)
          ).toMatchObject({ status: 'complete' });
        } finally {
          await instance.database.$executeRawUnsafe(
            'ALTER TABLE "SidedoorState" ENABLE TRIGGER "SidedoorState_storage_target_fence"'
          );
        }
        return;
      }
      if (mode === 'legacy-shared-concurrent' && otherClass && otherOperationId) {
        await expect(
          Promise.all([
            deleteClassForUser(
              classId,
              identity.ownerId,
              authorizedLearnerExecution(identity.ownerId)
            ),
            deleteClassForUser(
              otherClass.id,
              identity.ownerId,
              authorizedLearnerExecution(identity.ownerId)
            ),
          ])
        ).resolves.toEqual([true, true]);
        expect(await backend.has(key)).toBe(false);
        expect(
          await instance.database.courseClass.count({
            where: { id: { in: [classId, otherClass.id] } },
          })
        ).toBe(0);
        for (const id of [worksheetOperationId, otherOperationId])
          expect(await sottoJobOutbox(instance.database).receipt(id)).toMatchObject({
            status: 'erased',
          });
        return;
      }
      if (mode === 'legacy-executing') {
        await expect(
          deleteClassForUser(
            classId,
            identity.ownerId,
            authorizedLearnerExecution(identity.ownerId)
          )
        ).rejects.toThrow('Execution cleanup is unresolved');
        expect(
          await instance.database.courseClass.findUnique({ where: { id: classId } })
        ).not.toBeNull();
        expect(await backend.has(key)).toBe(true);
        expect(await sottoJobOutbox(instance.database).receipt(worksheetOperationId)).toMatchObject(
          {
            status: 'complete',
          }
        );
        return;
      }
      if (mode === 'legacy-stale') {
        await expect(
          deleteClassForUser(
            classId,
            identity.ownerId,
            authorizedLearnerExecution(identity.ownerId)
          )
        ).rejects.toThrow('older worksheet work');
        expect(
          await instance.database.courseClass.findUnique({ where: { id: classId } })
        ).not.toBeNull();
        expect(await backend.has(key)).toBe(true);
        expect(await sottoJobOutbox(instance.database).receipt(worksheetOperationId)).toMatchObject(
          {
            status: 'complete',
          }
        );
        return;
      }
      if (mode === 'active' || mode === 'unindexed-active') {
        await expect(
          deleteClassForUser(
            classId,
            identity.ownerId,
            authorizedLearnerExecution(identity.ownerId)
          )
        ).rejects.toThrow('active or requires recovery');
        expect(
          await instance.database.courseClass.findUnique({ where: { id: classId } })
        ).not.toBeNull();
        expect(await backend.has(key)).toBe(true);
        return;
      }
      const runtime = await import('@/lib/sidedoor/storage/migration/storage-cleanup-runtime');
      const cleanup =
        mode === 'interrupted' || mode === 'legacy-interrupted'
          ? vi
              .spyOn(runtime, 'runSottoStorageCleanup')
              .mockRejectedValueOnce(new Error('Cleanup interrupted'))
          : null;
      await expect(
        deleteClassForUser(classId, identity.ownerId, authorizedLearnerExecution(identity.ownerId))
      ).resolves.toBe(true);
      if (cleanup) {
        expect(await backend.has(key)).toBe(true);
        await expect(
          deleteClassForUser(
            classId,
            identity.ownerId,
            authorizedLearnerExecution(identity.ownerId)
          )
        ).resolves.toBe(true);
        cleanup.mockRestore();
      }
      expect(
        await instance.database.course.findUnique({ where: { id: cls.courseId } })
      ).not.toBeNull();
      expect(await backend.has(key)).toBe(mode === 'shared' || mode === 'legacy-shared');
      if (mode.startsWith('legacy-')) {
        for (const id of [worksheetOperationId, earlierWorksheetOperationId]) {
          if (id)
            expect(await sottoJobOutbox(instance.database).receipt(id)).toMatchObject({
              status: 'erased',
            });
        }
      }
      if (otherClass) {
        expect(
          (await instance.database.courseClass.findUnique({ where: { id: otherClass.id } }))
            ?.worksheetPdfUrl
        ).toBe(reference);
        const surviving = await sottoTransaction(instance.database, (tx) =>
          new StorageReferenceRegistry(
            {
              query: (sql, values) => tx.$queryRawUnsafe<Record<string, unknown>[]>(sql, ...values),
            },
            'postgres',
            SIDEDOOR_STATE_ID
          ).resolve({ consumer: `class:${otherClass.id}:worksheet`, reference })
        );
        expect(surviving).not.toBeNull();
      }
    } finally {
      capture.mockRestore();
      await rm(root, { recursive: true, force: true });
    }
  });

  it.each(['same', 'unindexed', 'other', 'malformed'] as const)(
    'protects a class from unpublished legacy worksheet work (%s)',
    async (target) => {
      const { instance, identity, classId } = getContext();
      const cls = await instance.database.courseClass.findUniqueOrThrow({ where: { id: classId } });
      const other = await instance.database.courseClass.create({
        data: { courseId: cls.courseId, lessonId: cls.lessonId, order: 2, status: 'IN_PROGRESS' },
      });
      const operationId =
        target === 'unindexed' ? 'ffffffff-ffff-4fff-8fff-ffffffffffff' : randomUUID();
      await sottoTransaction(instance.database, async (tx) => {
        const ownership = await captureCourseStorage(tx, cls.courseId);
        await sottoJobOutbox(tx).enqueue(
          prepareJob({
            id: operationId,
            namespace: SIDEDOOR_STATE_ID,
            handler: 'worksheet-pdf',
            version: 1,
            payload:
              target === 'malformed'
                ? {}
                : {
                    classId: target === 'same' || target === 'unindexed' ? classId : other.id,
                    classUpdatedAt: cls.updatedAt.getTime(),
                    appBaseUrl: 'https://example.com',
                  },
            scopes: ownership.scopes,
            delivery: { attempts: 2, priority: 0, availableAt: 0 },
          })
        );
        if (target === 'unindexed') {
          for (let index = 0; index < 12; index += 1) {
            await sottoJobOutbox(tx).enqueue(
              prepareJob({
                id: randomUUID(),
                namespace: SIDEDOOR_STATE_ID,
                handler: 'worksheet-pdf',
                version: 1,
                payload: {
                  classId: other.id,
                  classUpdatedAt: cls.updatedAt.getTime(),
                  appBaseUrl: 'https://example.com',
                },
                scopes: ownership.scopes,
                delivery: { attempts: 2, priority: 0, availableAt: 0 },
              })
            );
          }
        }
      });
      if (target === 'unindexed') {
        const removed = await instance.database.sidedoorState.deleteMany({
          where: { id: { startsWith: 'sd-jsc:', endsWith: operationId } },
        });
        expect(removed.count).toBeGreaterThan(0);
      }
      const { deleteClassForUser } = await import('@/lib/class-service');
      const deletion = deleteClassForUser(
        classId,
        identity.ownerId,
        authorizedLearnerExecution(identity.ownerId)
      );
      if (target !== 'other') {
        await expect(deletion).rejects.toThrow(
          target === 'same' || target === 'unindexed'
            ? 'older worksheet work'
            : 'active or requires recovery'
        );
        expect(
          await instance.database.courseClass.findUnique({ where: { id: classId } })
        ).not.toBeNull();
      } else {
        await expect(deletion).resolves.toBe(true);
        expect(
          await instance.database.courseClass.findUnique({ where: { id: other.id } })
        ).not.toBeNull();
      }
    }
  );

  it('requires serializable isolation before inspecting retained class work', async () => {
    const { instance, identity, classId } = getContext();
    const cls = await instance.database.courseClass.findUniqueOrThrow({ where: { id: classId } });
    const { inspectPrerequisiteDeletion } =
      await import('@/lib/classes/help/prerequisite-deletion');
    await expect(
      instance.database.$transaction((tx) =>
        inspectPrerequisiteDeletion(tx, classId, cls.courseId, identity.ownerId)
      )
    ).rejects.toThrow('active or requires recovery');
  });

  it('does not delete a class while a legacy worksheet is admitted concurrently', async () => {
    const { instance, identity, classId } = getContext();
    const cls = await instance.database.courseClass.findUniqueOrThrow({ where: { id: classId } });
    const operationId = randomUUID();
    const admissionRead = Promise.withResolvers<void>();
    const deletionInspected = Promise.withResolvers<void>();
    const admissionFinished = Promise.withResolvers<void>();
    const { inspectPrerequisiteDeletion } =
      await import('@/lib/classes/help/prerequisite-deletion');
    const admission = instance.database.$transaction(
      async (tx) => {
        try {
          await tx.courseClass.findUniqueOrThrow({ where: { id: classId } });
          const ownership = await captureCourseStorage(tx, cls.courseId);
          admissionRead.resolve();
          await deletionInspected.promise;
          await sottoJobOutbox(tx).enqueue(
            prepareJob({
              id: operationId,
              namespace: SIDEDOOR_STATE_ID,
              handler: 'worksheet-pdf',
              version: 1,
              payload: {
                classId,
                classUpdatedAt: cls.updatedAt.getTime(),
                appBaseUrl: 'https://example.com',
              },
              scopes: ownership.scopes,
              delivery: { attempts: 2, priority: 0, availableAt: 0 },
            })
          );
        } finally {
          admissionRead.resolve();
        }
      },
      { isolationLevel: 'Serializable', timeout: 30_000 }
    );
    const completedAdmission = admission.finally(() => admissionFinished.resolve());
    await admissionRead.promise;
    const deletion = instance.database.$transaction(
      async (tx) => {
        try {
          await inspectPrerequisiteDeletion(tx, classId, cls.courseId, identity.ownerId);
        } finally {
          deletionInspected.resolve();
        }
        await admissionFinished.promise;
        await tx.courseClass.delete({ where: { id: classId } });
      },
      { isolationLevel: 'Serializable', timeout: 30_000 }
    );
    const [admitted, deleted] = await Promise.allSettled([completedAdmission, deletion]);
    expect(admitted.status).toBe('fulfilled');
    expect(deleted.status).toBe('rejected');
    if (deleted.status === 'rejected') expect(isSerializationConflict(deleted.reason)).toBe(true);
    expect(
      await instance.database.courseClass.findUnique({ where: { id: classId } })
    ).not.toBeNull();
    expect(
      await sottoTransaction(instance.database, (tx) => sottoJobOutbox(tx).read(operationId))
    ).not.toBeNull();
    const { deleteClassForUser } = await import('@/lib/class-service');
    await expect(
      deleteClassForUser(classId, identity.ownerId, authorizedLearnerExecution(identity.ownerId))
    ).rejects.toThrow('older worksheet work');
    expect(
      await instance.database.courseClass.findUnique({ where: { id: classId } })
    ).not.toBeNull();
  });

  it('rejects a legacy worksheet admission after concurrent class deletion commits', async () => {
    const { instance, identity, classId } = getContext();
    const cls = await instance.database.courseClass.findUniqueOrThrow({ where: { id: classId } });
    const operationId = randomUUID();
    const admissionRead = Promise.withResolvers<void>();
    const deletionFinished = Promise.withResolvers<void>();
    const { inspectPrerequisiteDeletion } =
      await import('@/lib/classes/help/prerequisite-deletion');
    const admission = instance.database.$transaction(
      async (tx) => {
        try {
          await tx.courseClass.findUniqueOrThrow({ where: { id: classId } });
          const ownership = await captureCourseStorage(tx, cls.courseId);
          admissionRead.resolve();
          await deletionFinished.promise;
          await sottoJobOutbox(tx).enqueue(
            prepareJob({
              id: operationId,
              namespace: SIDEDOOR_STATE_ID,
              handler: 'worksheet-pdf',
              version: 1,
              payload: {
                classId,
                classUpdatedAt: cls.updatedAt.getTime(),
                appBaseUrl: 'https://example.com',
              },
              scopes: ownership.scopes,
              delivery: { attempts: 2, priority: 0, availableAt: 0 },
            })
          );
        } finally {
          admissionRead.resolve();
        }
      },
      { isolationLevel: 'Serializable', timeout: 30_000 }
    );
    await admissionRead.promise;
    const deletion = instance.database.$transaction(
      async (tx) => {
        await inspectPrerequisiteDeletion(tx, classId, cls.courseId, identity.ownerId);
        await tx.courseClass.delete({ where: { id: classId } });
      },
      { isolationLevel: 'Serializable', timeout: 30_000 }
    );
    const completedDeletion = deletion.finally(() => deletionFinished.resolve());
    const [admitted, deleted] = await Promise.allSettled([admission, completedDeletion]);
    expect(deleted.status).toBe('fulfilled');
    expect(admitted.status).toBe('rejected');
    if (admitted.status === 'rejected') expect(isSerializationConflict(admitted.reason)).toBe(true);
    expect(await instance.database.courseClass.findUnique({ where: { id: classId } })).toBeNull();
    expect(
      await sottoTransaction(instance.database, (tx) => sottoJobOutbox(tx).read(operationId))
    ).toBeNull();
  });

  it('indexes older jobs before inspecting material deletion', async () => {
    const { instance, classId } = getContext();
    const cls = await instance.database.courseClass.findUniqueOrThrow({ where: { id: classId } });
    const operationId = randomUUID();
    const courseScope = await sottoTransaction(instance.database, async (tx) => {
      const ownership = await captureCourseStorage(tx, cls.courseId);
      await sottoJobOutbox(tx).enqueue(
        prepareJob({
          id: operationId,
          namespace: SIDEDOOR_STATE_ID,
          handler: 'worksheet-pdf',
          version: 1,
          payload: {
            classId,
            classUpdatedAt: cls.updatedAt.getTime(),
            appBaseUrl: 'https://example.com',
          },
          scopes: ownership.scopes,
          delivery: { attempts: 2, priority: 0, availableAt: 0 },
        })
      );
      return ownership.scopes.find((scope) => scope.subjectId === `course:${cls.courseId}`)!;
    });
    const removed = await instance.database.sidedoorState.deleteMany({
      where: { id: { startsWith: 'sd-jsc:', endsWith: operationId } },
    });
    expect(removed.count).toBeGreaterThan(0);
    const { inspectPrerequisiteDeletions } =
      await import('@/lib/classes/help/prerequisite-deletion');
    const jobs = await sottoTransaction(instance.database, async (tx) => {
      await inspectPrerequisiteDeletions(tx, { kind: 'material', id: 'other-material' });
      return sottoJobOutbox(tx).listForScope(courseScope.subjectId, courseScope.generation);
    });
    expect(jobs.jobs.map((job) => job.id)).toContain(operationId);
  });
}
