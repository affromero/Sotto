import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { StorageCleanupJournal, StorageWriteJournal } from 'thesidedoor-core/storage';
import { prepareJob } from 'thesidedoor-core/runtime/outbox';
import { deleteClassForUser } from '@/lib/class-service';
import { admitPrerequisiteWork } from '@/lib/classes/help/lifecycle/prerequisite-admission';
import { inspectPrerequisiteDeletion } from '@/lib/classes/help/prerequisite-deletion';
import {
  failPrerequisiteWork,
  startPrerequisiteWork,
} from '@/lib/classes/help/prerequisite-outcome';
import { captureStorageBackend } from '@/lib/r2';
import { setSiteConfig } from '@/lib/site-config';
import { admitLearningStorageDeletion } from '@/lib/sidedoor/access/deletion/learning-deletion';
import { SIDEDOOR_STATE_ID } from '@/lib/sidedoor/access/state/store';
import { sottoTransaction } from '@/lib/sidedoor/access/state/transaction';
import { sottoJobOutbox } from '@/lib/sidedoor/jobs/core/job-delivery';
import { openSottoStorageConnection } from '@/lib/sidedoor/storage/core/storage-connection';
import { runSottoStorageCleanup } from '@/lib/sidedoor/storage/migration/storage-cleanup-runtime';
import type {
  SharedTestIdentity,
  SharedTestInstance,
} from '../../../helpers/setup/shared-instance';

export function prerequisiteDeletionCases(
  fixture: () => {
    instance: SharedTestInstance;
    identity: SharedTestIdentity;
    classId: string;
    interruptCleanup: () => void;
  }
) {
  it('preserves assessment audio when individual class cleanup cannot account for it', async () => {
    const { instance, identity, classId } = fixture();
    const cls = await instance.database.courseClass.findUniqueOrThrow({ where: { id: classId } });
    const assessment = await instance.database.classAssessment.create({
      data: {
        classId,
        courseId: cls.courseId,
        userId: identity.ownerId,
        classAttempt: cls.attempt,
        assessmentAttempt: 1,
        requirements: {},
        formativeRevision: 'saved-revision',
        generationOperationId: randomUUID(),
      },
    });
    const section = await instance.database.classAssessmentSection.create({
      data: {
        assessmentId: assessment.id,
        skill: 'LISTENING',
        passThreshold: 0.7,
      },
    });
    const episode = await sottoTransaction(instance.database, async (tx) => {
      const created = await tx.episode.create({
        data: {
          userId: identity.ownerId,
          title: 'Assessment',
          topic: 'Assessment',
          assessmentAudioAssessmentId: assessment.id,
          assessmentAudioSectionId: section.id,
          assessmentAudioOperationId: assessment.generationOperationId,
        },
      });
      await tx.classAssessmentSection.update({
        where: { id: section.id },
        data: {
          episodeId: created.id,
          audioReservationEpisodeId: created.id,
          audioReservationOperationId: assessment.generationOperationId,
        },
      });
      return created;
    });
    await expect(
      deleteClassForUser(classId, identity.ownerId, {
        userId: identity.ownerId,
        authorize: async () => ({ userId: identity.ownerId }),
      })
    ).rejects.toThrow('requires recovery before deletion');
    expect(
      await instance.database.courseClass.findUnique({ where: { id: classId } })
    ).not.toBeNull();
    expect(
      await instance.database.episode.findUnique({ where: { id: episode.id } })
    ).not.toBeNull();
  });

  it('keeps deletion from discarding a queued request and its recovery evidence', async () => {
    const { instance, identity, classId } = fixture();
    const cls = await instance.database.courseClass.findUniqueOrThrow({ where: { id: classId } });
    const inspect = () =>
      sottoTransaction(instance.database, (database) =>
        inspectPrerequisiteDeletion(database, classId, cls.courseId, identity.ownerId)
      );
    expect((await inspect()).operations).toEqual([]);
    const record = await sottoTransaction(instance.database, (database) =>
      admitPrerequisiteWork(database, {
        id: randomUUID(),
        revision: randomUUID(),
        classId,
        userId: identity.ownerId,
        expiresAt: Date.now() + 60_000,
        selection: {
          provider: 'fixture',
          model: 'fixture',
          credentialFingerprint: null,
          moderationCredentialFingerprint: null,
        },
        authorize: async () => ({ userId: identity.ownerId }),
      })
    );
    await expect(inspect()).rejects.toThrow('active or requires recovery');
    expect(
      await sottoTransaction(instance.database, (database) =>
        sottoJobOutbox(database).read(record.job.id)
      )
    ).toMatchObject({ complete: false });
    expect(
      await instance.database.courseClass.findUnique({ where: { id: classId } })
    ).not.toBeNull();
  });

  it('serializes class deletion with prerequisite admission', async () => {
    const { instance, identity, classId } = fixture();
    const execution = {
      userId: identity.ownerId,
      authorize: async () => ({ userId: identity.ownerId }),
    };
    const [admission, deletion] = await Promise.allSettled([
      sottoTransaction(instance.database, (database) =>
        admitPrerequisiteWork(database, {
          id: randomUUID(),
          revision: randomUUID(),
          classId,
          userId: identity.ownerId,
          expiresAt: Date.now() + 60_000,
          selection: {
            provider: 'fixture',
            model: 'fixture',
            credentialFingerprint: null,
            moderationCredentialFingerprint: null,
          },
          authorize: execution.authorize,
        })
      ),
      deleteClassForUser(classId, identity.ownerId, execution),
    ]);
    const cls = await instance.database.courseClass.findUnique({ where: { id: classId } });
    if (admission.status === 'fulfilled') {
      expect(cls).not.toBeNull();
      expect(deletion.status).toBe('rejected');
      expect(
        await sottoTransaction(instance.database, (database) =>
          sottoJobOutbox(database).receipt(admission.value.job.id)
        )
      ).toMatchObject({ status: 'pending' });
    } else {
      expect(deletion).toMatchObject({ status: 'fulfilled', value: true });
      expect(cls).toBeNull();
    }
  });

  it('deletes one class only after its prerequisite work has drained', async () => {
    const { instance, identity, classId, interruptCleanup } = fixture();
    const cls = await instance.database.courseClass.findUniqueOrThrow({ where: { id: classId } });
    await instance.database.course.update({
      where: { id: cls.courseId },
      data: { activeClassId: classId },
    });
    const execution = {
      userId: identity.ownerId,
      authorize: async () => ({ userId: identity.ownerId }),
    };
    const other = await identity.household('Another learner');
    const otherExecution = { userId: other.id, authorize: async () => ({ userId: other.id }) };
    expect(await deleteClassForUser(classId, other.id, otherExecution)).toBe(false);
    await expect(
      deleteClassForUser(classId, identity.ownerId, {
        ...execution,
        authorize: async () => {
          throw new Error('authorization revoked');
        },
      })
    ).rejects.toThrow('authorization revoked');
    const record = await sottoTransaction(instance.database, (database) =>
      admitPrerequisiteWork(database, {
        id: randomUUID(),
        revision: randomUUID(),
        classId,
        userId: identity.ownerId,
        expiresAt: Date.now() + 60_000,
        selection: {
          provider: 'fixture',
          model: 'fixture',
          credentialFingerprint: null,
          moderationCredentialFingerprint: null,
        },
        authorize: execution.authorize,
      })
    );
    await expect(deleteClassForUser(classId, identity.ownerId, execution)).rejects.toThrow(
      'active or requires recovery'
    );
    expect(
      await instance.database.courseClass.findUnique({ where: { id: classId } })
    ).not.toBeNull();
    const operation = { id: record.job.id, fingerprint: record.fingerprint };
    await sottoTransaction(instance.database, (database) =>
      startPrerequisiteWork(database, operation)
    );
    await sottoTransaction(instance.database, (database) =>
      failPrerequisiteWork(database, operation, false)
    );
    interruptCleanup();
    expect(await deleteClassForUser(classId, identity.ownerId, execution)).toBe(true);
    expect(await instance.database.courseClass.findUnique({ where: { id: classId } })).toBeNull();
    expect(
      await instance.database.course.findUnique({ where: { id: cls.courseId } })
    ).toMatchObject({ activeClassId: null });
    expect(
      await sottoTransaction(instance.database, (database) =>
        sottoJobOutbox(database).receipt(operation.id)
      )
    ).toMatchObject({ status: 'erased' });
    const cleanup = async () =>
      sottoTransaction(instance.database, async (database) => {
        const executor = {
          query: (sql: string, values: readonly unknown[]) =>
            database.$queryRawUnsafe<Record<string, unknown>[]>(sql, ...values),
        };
        const tombstone = await new StorageWriteJournal(
          executor,
          'postgres',
          SIDEDOOR_STATE_ID
        ).tombstone(`class:${classId}`);
        return (
          tombstone &&
          new StorageCleanupJournal(executor, 'postgres', SIDEDOOR_STATE_ID).get(tombstone.jobId)
        );
      });
    expect((await cleanup())?.phase).not.toBe('complete');
    expect(await deleteClassForUser(classId, other.id, otherExecution)).toBe(false);
    expect(await deleteClassForUser(classId, identity.ownerId, execution)).toBe(true);
    expect(await cleanup()).toMatchObject({ phase: 'complete' });
    expect(await deleteClassForUser(classId, identity.ownerId, execution)).toBe(true);
  });

  it('resumes cleanup after paging over unrelated UUID versions in the profile index', async () => {
    const { instance, identity, classId, interruptCleanup } = fixture();
    const execution = {
      userId: identity.ownerId,
      authorize: async () => ({ userId: identity.ownerId }),
    };
    const user = await instance.database.user.findUniqueOrThrow({
      where: { id: identity.ownerId },
    });
    const record = await sottoTransaction(instance.database, async (database) => {
      const admitted = await admitPrerequisiteWork(database, {
        id: '00000001-0000-4000-8000-000000000000',
        revision: randomUUID(),
        classId,
        userId: identity.ownerId,
        expiresAt: Date.now() + 60_000,
        selection: {
          provider: 'fixture',
          model: 'fixture',
          credentialFingerprint: null,
          moderationCredentialFingerprint: null,
        },
        authorize: execution.authorize,
      });
      const outbox = sottoJobOutbox(database);
      for (let index = 0; index < 15; index++) {
        await outbox.enqueue(
          prepareJob({
            id: `00000000-ffff-5000-8000-${index.toString(16).padStart(12, '0')}`,
            namespace: SIDEDOOR_STATE_ID,
            handler: 'fixture',
            version: 1,
            payload: {},
            scopes: [{ subjectId: `profile:${user.id}`, generation: user.createdAt.getTime() }],
            delivery: { attempts: 1, priority: 0, availableAt: 0 },
          })
        );
      }
      return admitted;
    });
    const operation = { id: record.job.id, fingerprint: record.fingerprint };
    await sottoTransaction(instance.database, (database) =>
      startPrerequisiteWork(database, operation)
    );
    await sottoTransaction(instance.database, (database) =>
      failPrerequisiteWork(database, operation, false)
    );
    interruptCleanup();
    expect(await deleteClassForUser(classId, identity.ownerId, execution)).toBe(true);
    expect(await deleteClassForUser(classId, identity.ownerId, execution)).toBe(true);
    const tombstone = await sottoTransaction(instance.database, async (database) => {
      const executor = {
        query: (sql: string, values: readonly unknown[]) =>
          database.$queryRawUnsafe<Record<string, unknown>[]>(sql, ...values),
      };
      const deleted = await new StorageWriteJournal(
        executor,
        'postgres',
        SIDEDOOR_STATE_ID
      ).tombstone(`class:${classId}`);
      return (
        deleted &&
        new StorageCleanupJournal(executor, 'postgres', SIDEDOOR_STATE_ID).get(deleted.jobId)
      );
    });
    expect(tombstone).toMatchObject({ phase: 'complete' });
  });

  it.each(['course', 'profile', 'instance'] as const)(
    'erases completed prerequisite work atomically during %s deletion admission',
    async (kind) => {
      const { instance, identity, classId } = fixture();
      const root = await mkdtemp(join(tmpdir(), 'sotto-prerequisite-deletion-'));
      try {
        await setSiteConfig({ storageProvider: 'local', localStorageRoot: root }, identity.ownerId);
        const backend = await captureStorageBackend();
        const cls = await instance.database.courseClass.findUniqueOrThrow({
          where: { id: classId },
        });
        const course = await instance.database.course.findUniqueOrThrow({
          where: { id: cls.courseId },
        });
        const user = await instance.database.user.findUniqueOrThrow({
          where: { id: identity.ownerId },
        });
        const record = await sottoTransaction(instance.database, (database) =>
          admitPrerequisiteWork(database, {
            id: randomUUID(),
            revision: randomUUID(),
            classId,
            userId: identity.ownerId,
            expiresAt: Date.now() + 60_000,
            selection: {
              provider: 'fixture',
              model: 'fixture',
              credentialFingerprint: null,
              moderationCredentialFingerprint: null,
            },
            authorize: async () => ({ userId: identity.ownerId }),
          })
        );
        const operation = { id: record.job.id, fingerprint: record.fingerprint };
        const scope =
          kind === 'profile'
            ? ({ kind, id: identity.ownerId } as const)
            : kind === 'course'
              ? ({ kind, id: course.id, episodeIds: [] } as const)
              : ({ kind } as const);
        const subject =
          kind === 'profile'
            ? { subjectId: `profile:${user.id}`, generation: user.createdAt.getTime() }
            : { subjectId: `course:${course.id}`, generation: course.createdAt.getTime() };
        await expect(
          sottoTransaction(instance.database, (database) =>
            admitLearningStorageDeletion({
              database,
              scope,
              subjects: [subject],
              currentBackend: backend,
            })
          )
        ).rejects.toThrow('active or requires recovery');
        expect(
          await instance.database.course.findUnique({ where: { id: course.id } })
        ).not.toBeNull();
        await sottoTransaction(instance.database, (database) =>
          startPrerequisiteWork(database, operation)
        );
        await sottoTransaction(instance.database, (database) =>
          failPrerequisiteWork(database, operation, false)
        );
        const retry = await sottoTransaction(instance.database, (database) =>
          admitPrerequisiteWork(database, {
            id: randomUUID(),
            revision: randomUUID(),
            classId,
            userId: identity.ownerId,
            expiresAt: Date.now() + 60_000,
            selection: {
              provider: 'fixture',
              model: 'fixture',
              credentialFingerprint: null,
              moderationCredentialFingerprint: null,
            },
            authorize: async () => ({ userId: identity.ownerId }),
          })
        );
        const retriedOperation = { id: retry.job.id, fingerprint: retry.fingerprint };
        await sottoTransaction(instance.database, (database) =>
          startPrerequisiteWork(database, retriedOperation)
        );
        await sottoTransaction(instance.database, (database) =>
          failPrerequisiteWork(database, retriedOperation, false)
        );
        const jobs = await sottoTransaction(instance.database, async (database) => {
          const admitted = await admitLearningStorageDeletion({
            database,
            scope,
            subjects: [subject],
            currentBackend: backend,
          });
          await database.course.delete({ where: { id: course.id } });
          return admitted;
        });
        expect(jobs).toHaveLength(1);
        expect(await instance.database.course.findUnique({ where: { id: course.id } })).toBeNull();
        for (const erased of [operation, retriedOperation]) {
          expect(
            await sottoTransaction(instance.database, (database) =>
              sottoJobOutbox(database).receipt(erased.id)
            )
          ).toMatchObject({ status: 'erased', fingerprint: erased.fingerprint });
          expect(
            await instance.database.sidedoorState.findUnique({
              where: { id: `${SIDEDOOR_STATE_ID}:prerequisite-grant:${erased.id}` },
            })
          ).toBeNull();
        }
        await runSottoStorageCleanup(instance.database, jobs[0]!.id, {
          openConnection: () =>
            openSottoStorageConnection(process.env.SIDEDOOR_TEST_DATABASE_URL, instance.schema),
        });
        expect(
          await sottoTransaction(instance.database, (database) =>
            new StorageCleanupJournal(
              {
                query: (sql, values) =>
                  database.$queryRawUnsafe<Record<string, unknown>[]>(sql, ...values),
              },
              'postgres',
              SIDEDOOR_STATE_ID
            ).get(jobs[0]!.id)
          )
        ).toMatchObject({ phase: 'complete' });
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    }
  );
}
