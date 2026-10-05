import { randomUUID } from 'node:crypto';
import { beforeEach, expect, it } from 'vitest';
import {
  StorageWriteJournal,
  prepareStorageTombstone,
  StorageCleanupJournal,
  StorageBackendRegistry,
  prepareStorageBackend,
  prepareStorageCleanup,
  storageBackendBinding,
} from 'thesidedoor-core/storage';
import { JobRetentionCleanup, prepareJob } from 'thesidedoor-core/runtime/outbox';
import { sottoTransaction } from '@/lib/sidedoor/access/state/transaction';
import { SIDEDOOR_STATE_ID } from '@/lib/sidedoor/access/state/store';
import { sottoJobOutbox, sottoJobSnapshot } from '@/lib/sidedoor/jobs/core/job-delivery';
import {
  classPreparationStore,
  requestClassPreparation,
  readPreparationActivity,
  recordClassPreparationFailure,
  recoverClassPreparation,
  settleCancelledPreparation,
} from '@/lib/classes/preparation';
import { registerPreparationAudio } from '@/lib/classes/preparation-audio';
import { readPristineRegenerationSnapshot } from '@/lib/classes/regeneration/pristine';
import { captureEpisodeStorage } from '@/lib/sidedoor/storage/core/episode-storage';
import { sottoJobExecutions } from '@/lib/sidedoor/jobs/core/job-execution-lifetime';
import { preparationSchema, type ClassPreparation } from '@/lib/classes/preparation-state';
import {
  readLearningFailure,
  writeLearningFailure,
  learningFailureReason,
  type LearningFailure,
} from '@/lib/classes/quality/teaching-failure-store';
import type { SottoProviderExecution } from '@/lib/sidedoor/credentials/runtime/provider-execution';
import type { SharedTestInstance } from '../../../helpers/setup/shared-instance';

interface PreparationFailureContext {
  instance: SharedTestInstance;
  courseId: string;
  execution: SottoProviderExecution;
  running: () => Promise<ClassPreparation>;
  lesson: () => Promise<{ id: string }>;
}

/** Register evidence cases using the owning suite's real database and admission fixture. */
export function registerPreparationFailureTests(context: () => PreparationFailureContext) {
  let instance: SharedTestInstance;
  let courseId: string;
  let execution: SottoProviderExecution;
  const running = () => context().running();
  const lesson = () => context().lesson();
  beforeEach(() => {
    ({ instance, courseId, execution } = context());
  });
  const privateFailure: LearningFailure = {
    category: 'teaching_rejected',
    teachingFailure: {
      kind: 'intro',
      reviews: [
        {
          candidate: '[{"purpose":"private-candidate-sentinel"}]',
          verdict: {
            items: [
              {
                index: 0,
                acceptable: false,
                issues: ['incorrect'],
                feedback: ['private-feedback-sentinel'],
              },
            ],
          },
        },
      ],
    },
  };

  async function failureFixture() {
    const operation = await running();
    const lessonRecord = await lesson();
    const cls = await instance.database.courseClass.create({
      data: {
        courseId,
        lessonId: lessonRecord.id,
        status: 'GENERATING',
        order: (await instance.database.courseClass.count({ where: { courseId } })) + 1,
      },
    });
    const current = await sottoTransaction(instance.database, (database) =>
      classPreparationStore(database, courseId).transact((state) => {
        if (!state) throw new Error('Missing preparation fixture');
        state.classId = cls.id;
        return state;
      })
    );
    const parent = await sottoTransaction(instance.database, (database) =>
      sottoJobOutbox(database).read(operation.id)
    );
    if (!parent) throw new Error('Missing fixture outbox');
    return { operation: current, parent };
  }

  it.each(['generation_failed', 'source_unreadable'] as const)(
    'preserves known %s after audio cleanup and permits a fresh pristine attempt',
    async (failure) => {
      const lessonRecord = await lesson();
      const cls = await instance.database.courseClass.create({
        data: { courseId, lessonId: lessonRecord.id, order: 1, status: 'AVAILABLE' },
      });
      const originalProfile = await instance.database.user.findUniqueOrThrow({
        where: { id: execution.userId },
      });
      const snapshot = await readPristineRegenerationSnapshot(cls.id, execution);
      const operation = await requestClassPreparation(courseId, execution, {
        maxProviderRequests: 2,
        intent: {
          kind: 'REGENERATE',
          classId: cls.id,
          expectedAttempt: 1,
          pristineSnapshot: snapshot,
        },
      });
      await sottoTransaction(instance.database, (database) =>
        classPreparationStore(database, courseId).transact((state) => {
          if (!state) throw new Error('Missing admitted fixture');
          state.status = 'RUNNING';
        })
      );
      const episode = await instance.database.episode.create({
        data: {
          userId: execution.userId,
          title: 'Pending lesson audio',
          topic: 'Travel',
          source: 'CLASS',
          status: 'GENERATING_AUDIO',
          audioGenerationKey: randomUUID(),
        },
      });
      await instance.database.classSection.create({
        data: {
          classId: cls.id,
          skill: 'LISTENING',
          status: 'READY',
          seed: randomUUID(),
          spec: {},
          attempt: operation.intent!.attempt,
          episodeId: episode.id,
        },
      });
      const child = await sottoTransaction(instance.database, async (database) => {
        await registerPreparationAudio(
          database,
          operation,
          episode.id,
          episode.audioGenerationKey!
        );
        const storage = await captureEpisodeStorage(database, episode.id);
        return sottoJobOutbox(database).enqueue(
          prepareJob({
            id: randomUUID(),
            namespace: SIDEDOOR_STATE_ID,
            handler: 'audio-generation',
            version: 1,
            payload: {
              type: 'generate-audio',
              payload: { episodeId: episode.id },
              authority: {
                kind: 'episode',
                episodeId: episode.id,
                ownerUserId: execution.userId,
                userId: execution.userId,
                pipelineGeneration: null,
                preparationAudioGenerationKey: episode.audioGenerationKey!,
                snapshot: storage,
              },
            },
            scopes: storage.scopes,
            delivery: { attempts: 1, priority: 0, availableAt: Date.now() },
          })
        );
      });
      const binding = {
        id: randomUUID(),
        parentId: child.job.id,
        fingerprint: child.fingerprint,
        executorId: randomUUID(),
      };
      await sottoTransaction(instance.database, async (database) => {
        await sottoJobExecutions(database).begin(binding);
        const parent = await sottoJobOutbox(database).read(operation.id);
        if (!parent) throw new Error('Missing parent fixture');
        await recordClassPreparationFailure(
          database,
          operation,
          parent.fingerprint,
          false,
          failure,
          failure === 'generation_failed' ? privateFailure : undefined
        );
      });
      const unresolved = await classPreparationStore(instance.database, courseId).read();
      expect(unresolved).toMatchObject({ id: operation.id, status: 'UNRESOLVED', failure });
      if (failure === 'generation_failed')
        expect(
          await sottoTransaction(instance.database, (database) =>
            readLearningFailure(database, unresolved!)
          )
        ).toEqual(privateFailure);
      await sottoTransaction(instance.database, (database) =>
        settleCancelledPreparation(database, unresolved!)
      );
      expect((await classPreparationStore(instance.database, courseId).read())?.status).toBe(
        'UNRESOLVED'
      );
      await expect(requestClassPreparation(courseId, execution)).rejects.toThrow();
      await expect(
        recoverClassPreparation(courseId, execution, { acknowledgeUnknownOutcome: true })
      ).rejects.toThrow(/cleanup/);
      expect(
        (await instance.database.courseClass.findUniqueOrThrow({ where: { id: cls.id } })).status
      ).toBe('GENERATING');
      await sottoTransaction(instance.database, (database) =>
        sottoJobExecutions(database).settle(binding)
      );
      const recovered = await recoverClassPreparation(courseId, execution, {
        acknowledgeUnknownOutcome: true,
      });
      expect(recovered).toMatchObject({ id: operation.id, status: 'FAILED', failure });
      expect(
        (await instance.database.courseClass.findUniqueOrThrow({ where: { id: cls.id } })).status
      ).toBe('FAILED');
      expect(
        await sottoTransaction(instance.database, (database) =>
          sottoJobOutbox(database).read(child.job.id)
        )
      ).toMatchObject({ complete: true });
      const freshSnapshot = await readPristineRegenerationSnapshot(cls.id, execution);
      const next = await requestClassPreparation(courseId, execution, {
        maxProviderRequests: 2,
        intent: {
          kind: 'REGENERATE',
          classId: cls.id,
          expectedAttempt: operation.intent!.attempt,
          pristineSnapshot: freshSnapshot,
        },
      });
      expect(next.id).not.toBe(operation.id);
      expect(next.intent?.attempt).toBe(operation.intent!.attempt + 1);
      expect(
        await instance.database.user.findUniqueOrThrow({ where: { id: execution.userId } })
      ).toEqual(originalProfile);
      if (failure === 'generation_failed')
        expect(
          await sottoTransaction(instance.database, (database) =>
            readLearningFailure(database, recovered)
          )
        ).toEqual(privateFailure);
    }
  );

  it('commits private review evidence with failure while keeping rollback readers and learner activity compatible', async () => {
    const { operation, parent } = await failureFixture();
    await sottoTransaction(instance.database, (database) =>
      recordClassPreparationFailure(
        database,
        operation,
        parent.fingerprint,
        false,
        'generation_failed',
        privateFailure
      )
    );
    const failed = await classPreparationStore(instance.database, courseId).read();
    expect(preparationSchema.parse(failed)).toMatchObject({
      status: 'FAILED',
      failure: 'generation_failed',
    });
    expect(
      await sottoTransaction(instance.database, (database) =>
        readLearningFailure(database, failed!)
      )
    ).toEqual(privateFailure);
    const activity = await readPreparationActivity(courseId, execution);
    expect(activity).toMatchObject({
      status: 'FAILED',
      failureReason: learningFailureReason(privateFailure),
      maxProviderRequests: 2,
      providerRequestsAdmitted: 0,
    });
    expect(JSON.stringify(activity)).not.toMatch(
      /private-candidate-sentinel|private-feedback-sentinel|teachingFailure/
    );
    await instance.database.courseClass.update({
      where: { id: operation.classId! },
      data: { attempt: 2 },
    });
    expect(
      await sottoTransaction(instance.database, (database) =>
        readLearningFailure(database, failed!)
      )
    ).toEqual(privateFailure);
    const next = await requestClassPreparation(courseId, execution);
    expect(next.id).not.toBe(operation.id);
    expect(
      await sottoTransaction(instance.database, (database) =>
        readLearningFailure(database, failed!)
      )
    ).toEqual(privateFailure);
  });

  it('rolls back evidence and failure together when their owning transaction fails', async () => {
    const { operation, parent } = await failureFixture();
    await expect(
      sottoTransaction(instance.database, async (database) => {
        await recordClassPreparationFailure(
          database,
          operation,
          parent.fingerprint,
          false,
          'generation_failed',
          privateFailure
        );
        throw new Error('fixture publication rollback');
      })
    ).rejects.toThrow(/rollback/);
    expect(await classPreparationStore(instance.database, courseId).read()).toMatchObject({
      status: 'RUNNING',
      failure: null,
    });
    expect(
      await sottoTransaction(instance.database, (database) =>
        readLearningFailure(database, operation)
      )
    ).toBeNull();
    expect(
      (
        await sottoTransaction(instance.database, (database) =>
          sottoJobOutbox(database).read(operation.id)
        )
      )?.complete
    ).toBe(false);
  });

  it.each(['profile', 'course'] as const)(
    'denies private evidence reads and writes once the captured %s scope is tombstoned',
    async (kind) => {
      const { operation, parent } = await failureFixture();
      await sottoTransaction(instance.database, (database) =>
        new StorageWriteJournal(
          {
            query: (sql, values) =>
              database.$queryRawUnsafe<Record<string, unknown>[]>(sql, ...values),
          },
          'postgres',
          SIDEDOOR_STATE_ID
        ).forbidWrites(
          prepareStorageTombstone({
            namespace: SIDEDOOR_STATE_ID,
            subjectId: `${kind}:${kind === 'profile' ? operation.userId : operation.courseId}`,
            generation: kind === 'profile' ? operation.userCreatedAt : operation.courseCreatedAt,
            jobId: randomUUID(),
          })
        )
      );
      await expect(
        sottoTransaction(instance.database, (database) => readLearningFailure(database, operation))
      ).rejects.toThrow(/being erased/);
      await expect(
        sottoTransaction(instance.database, (database) =>
          writeLearningFailure(
            database,
            { ...operation, status: 'FAILED' },
            parent.fingerprint,
            privateFailure
          )
        )
      ).rejects.toThrow(/being erased/);
      await expect(
        sottoTransaction(instance.database, (database) =>
          sottoJobSnapshot(database).read(operation.id, parent.fingerprint, 0)
        )
      ).rejects.toThrow('Snapshot is missing');
    }
  );

  it('erases private review evidence through the owning course cleanup policy', async () => {
    const { operation, parent } = await failureFixture();
    await sottoTransaction(instance.database, (database) =>
      recordClassPreparationFailure(
        database,
        operation,
        parent.fingerprint,
        false,
        'generation_failed',
        privateFailure
      )
    );
    const deletion = prepareStorageCleanup({
      namespace: SIDEDOOR_STATE_ID,
      subjectId: `course:${courseId}`,
      generation: operation.courseCreatedAt,
      retentionPolicy: 'job-id-snapshots-v1',
    });
    const executor = (database: import('@/generated/prisma/client').Prisma.TransactionClient) => ({
      query: (sql: string, values: readonly unknown[]) =>
        database.$queryRawUnsafe<Record<string, unknown>[]>(sql, ...values),
    });
    await sottoTransaction(instance.database, async (database) => {
      const location = {
        kind: 'object' as const,
        endpoint: 'https://storage.example',
        bucket: 'failure-retention',
      };
      const backend = prepareStorageBackend(SIDEDOOR_STATE_ID, {
        kind: 'object',
        location,
        binding: storageBackendBinding(location),
      });
      await new StorageBackendRegistry(executor(database), 'postgres', SIDEDOOR_STATE_ID).register(
        backend
      );
      const journal = new StorageCleanupJournal(executor(database), 'postgres', SIDEDOOR_STATE_ID);
      await journal.createJob(deletion);
      await journal.registerCollectors(deletion.id, 0, [
        { id: 'inventory', kind: 'inventory', backendIds: [backend.id], scope: 'retention/' },
      ]);
      const waiting = await journal.transition(deletion.id, 0);
      await journal.recordDrainedIntents(deletion.id, waiting.epoch, null);
    });
    await expect(
      sottoTransaction(instance.database, (database) => readLearningFailure(database, operation))
    ).rejects.toThrow(/being erased/);
    let complete = false;
    for (let step = 0; step < 10 && !complete; step++)
      complete = (
        await sottoTransaction(instance.database, (database) =>
          new JobRetentionCleanup(executor(database), 'postgres', SIDEDOOR_STATE_ID).step(
            deletion.id
          )
        )
      ).complete;
    expect(complete).toBe(true);
    expect(
      await sottoTransaction(instance.database, (database) =>
        sottoJobOutbox(database).receipt(operation.id)
      )
    ).toMatchObject({ status: 'erased' });
    const rows = await instance.database.$queryRawUnsafe<Array<{ count: number }>>(
      'SELECT COUNT(*)::int AS count FROM "SidedoorState" WHERE state::text LIKE \'%private-candidate-sentinel%\''
    );
    expect(rows[0]?.count).toBe(0);
    await expect(
      sottoTransaction(instance.database, (database) => readLearningFailure(database, operation))
    ).rejects.toThrow();
  });

  it('rejects forged owner, operation, fingerprint and class attempt bindings without retaining private material', async () => {
    const { operation, parent } = await failureFixture();
    const failed = { ...operation, status: 'FAILED' as const };
    for (const forged of [
      { ...failed, userId: 'another-learner' },
      { ...failed, courseId: 'another-course' },
      { ...failed, id: randomUUID() },
    ])
      await expect(
        sottoTransaction(instance.database, (database) =>
          writeLearningFailure(database, forged, parent.fingerprint, privateFailure)
        )
      ).rejects.toThrow();
    await expect(
      sottoTransaction(instance.database, (database) =>
        writeLearningFailure(database, failed, 'a'.repeat(64), privateFailure)
      )
    ).rejects.toThrow();
    await instance.database.courseClass.update({
      where: { id: failed.classId! },
      data: { attempt: 2 },
    });
    await expect(
      sottoTransaction(instance.database, (database) =>
        writeLearningFailure(database, failed, parent.fingerprint, privateFailure)
      )
    ).rejects.toThrow(/attempt/);
    expect(
      await sottoTransaction(instance.database, (database) =>
        readLearningFailure(database, operation)
      )
    ).toBeNull();
  });

  it('does not replace completed publication or overwrite a sealed diagnostic', async () => {
    const { operation, parent } = await failureFixture();
    await sottoTransaction(instance.database, async (database) => {
      await classPreparationStore(database, courseId).transact((state) => {
        if (!state) throw new Error('Missing fixture');
        state.status = 'COMPLETED';
      });
      await sottoJobOutbox(database).complete(operation.id, parent.fingerprint);
      await recordClassPreparationFailure(
        database,
        operation,
        parent.fingerprint,
        false,
        'generation_failed',
        privateFailure
      );
    });
    expect(
      await sottoTransaction(instance.database, (database) =>
        readLearningFailure(database, operation)
      )
    ).toBeNull();
    await expect(
      sottoTransaction(instance.database, (database) =>
        writeLearningFailure(
          database,
          { ...operation, status: 'FAILED' },
          parent.fingerprint,
          privateFailure
        )
      )
    ).rejects.toThrow(/completed/);
    const second = await failureFixture();
    await sottoTransaction(instance.database, (database) =>
      recordClassPreparationFailure(
        database,
        second.operation,
        second.parent.fingerprint,
        false,
        'generation_failed',
        privateFailure
      )
    );
    await sottoTransaction(instance.database, (database) =>
      writeLearningFailure(
        database,
        { ...second.operation, status: 'FAILED' },
        second.parent.fingerprint,
        privateFailure
      )
    );
    await expect(
      sottoTransaction(instance.database, (database) =>
        writeLearningFailure(
          database,
          { ...second.operation, status: 'FAILED' },
          second.parent.fingerprint,
          { category: 'database_conflict' }
        )
      )
    ).rejects.toThrow(/sealed/);
    expect(
      await sottoTransaction(instance.database, (database) =>
        readLearningFailure(database, second.operation)
      )
    ).toEqual(privateFailure);
    expect(
      (
        await sottoTransaction(instance.database, (database) =>
          sottoJobSnapshot(database).read(second.operation.id, second.parent.fingerprint, 0)
        )
      ).pages
    ).toBe(1);
  });
}
