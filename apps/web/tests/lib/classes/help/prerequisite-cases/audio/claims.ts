import { expect, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { Prisma } from '@/generated/prisma/client';
import { SIDEDOOR_STATE_ID } from '@/lib/sidedoor/access/state/store';
import { AssessmentFenceConflict } from '@/lib/learning/classes/lifecycle/assessment-fence';
import { listAssessmentAudioAttempts } from '@/lib/learning/classes/audio/assessment-audio-attempt';
import { sottoJobOutbox } from '@/lib/sidedoor/jobs/core/job-delivery';
import {
  withSottoJobExecution,
  runSottoExecutionOperation,
  runSottoExecutionTransaction,
} from '@/lib/sidedoor/jobs/core/job-execution-lifetime';
import { validateAssessmentAudioLineage } from '@/lib/learning/classes/audio/assessment-audio-lineage';
import { beginAssessmentAudioAttempt } from '@/lib/learning/classes/audio/assessment-audio-attempt';
import { trackAssessmentAudioObservationOperation } from '@/lib/learning/classes/audio/assessment-audio-claim';
import { sottoTransaction } from '@/lib/sidedoor/access/state/transaction';
import { sottoJobExecutions } from '@/lib/sidedoor/jobs/core/job-execution-lifetime';
import { randomUUID } from 'node:crypto';
import type { SharedTestInstance } from '../../../../../helpers/setup/shared-instance';
import type {
  runAssessmentAudioObservationTransaction,
  claimAssessmentAudioObservation,
  releaseAssessmentAudioObservation,
} from '@/lib/learning/classes/audio/assessment-audio-claim';
import type { captureFailedAssessmentAudioEvidence } from '@/lib/learning/classes/audio/assessment-audio-failure';
import type {
  SottoJobExecutionCapability,
  SottoJobExecutionOperation,
} from '@/lib/sidedoor/jobs/core/job-execution-lifetime';

type ObservationContext = {
  capability: SottoJobExecutionCapability;
  operation: SottoJobExecutionOperation;
};
type ObservationIdentity = Parameters<
  typeof runAssessmentAudioObservationTransaction
>[0]['identity'];
interface AudioClaimsContext {
  instance: SharedTestInstance;
  audioQueue: typeof import('@/lib/queue');
  assessment: string;
  speechAttempt: {
    episodeId: string;
    segmentId: string;
    generationKey: string;
    operationId: string;
  };
  bound: import('bullmq').Job<import('@/lib/queue').GenerateAudioPayload>;
  processAudioGeneration: typeof import('@/workers/audio-generation.worker').processAudioGeneration;
  claimInput: ObservationIdentity;
  claimAssessmentAudioObservation: typeof claimAssessmentAudioObservation;
  releaseAssessmentAudioObservation: typeof releaseAssessmentAudioObservation;
  startAudioExecution: () => Promise<ObservationContext & { finish: () => Promise<void> }>;
  observationTransaction: <Result>(
    context: ObservationContext,
    identity: ObservationIdentity,
    run: (tx: import('@/generated/prisma/client').Prisma.TransactionClient) => Promise<Result>
  ) => Promise<Result>;
  captureFailedAudio: (
    context: ObservationContext,
    identity: ObservationIdentity & { nonce: string }
  ) => ReturnType<typeof captureFailedAssessmentAudioEvidence>;
  attemptStatus: (fingerprint?: string) => Promise<unknown>;
}

export async function checkAssessmentAudioClaims({
  instance,
  audioQueue,
  assessment,
  speechAttempt,
  bound,
  processAudioGeneration,
  claimInput,
  claimAssessmentAudioObservation,
  releaseAssessmentAudioObservation,
  startAudioExecution,
  observationTransaction,
  captureFailedAudio,
  attemptStatus,
}: AudioClaimsContext) {
  const observer = await startAudioExecution();
  let claim: Awaited<ReturnType<typeof claimAssessmentAudioObservation>>;
  try {
    await expect(
      observationTransaction(observer, claimInput, (tx) =>
        claimAssessmentAudioObservation(
          tx,
          { ...claimInput, assessmentId: randomUUID() },
          observer.operation
        )
      )
    ).rejects.toThrow();
    const claimRows = () =>
      instance.database.sidedoorState.count({
        where: {
          id: { contains: ':assessment-audio-claim:', endsWith: claimInput.operationId },
        },
      });
    expect(await claimRows()).toBe(0);
    await expect(
      observationTransaction(observer, claimInput, async (tx) => {
        await new Promise<void>((resolve, reject) => {
          void claimAssessmentAudioObservation(tx, claimInput, observer.operation).then(
            () => resolve(),
            reject
          );
        });
      })
    ).rejects.toThrow();
    expect(await claimRows()).toBe(0);
    claim = await observationTransaction(observer, claimInput, (tx) =>
      claimAssessmentAudioObservation(tx, claimInput, observer.operation)
    );
    const observedExecution = await sottoTransaction(instance.database, (tx) =>
      sottoJobExecutions(tx).read(claim.execution)
    );
    expect(observedExecution.workspace).toMatchObject({ directory: expect.any(Object) });
    const directResult = Object.freeze({ state: 'tracked' });
    expect(
      await observationTransaction(observer, claimInput, (tx) =>
        trackAssessmentAudioObservationOperation(
          tx,
          observer.operation,
          { parentId: claimInput.operationId, fingerprint: claimInput.fingerprint },
          async () => directResult
        )
      )
    ).toBe(directResult);
    const { captureFailedAssessmentAudioEvidence, recordObservedFailedAssessmentAudio } =
      await import('@/lib/learning/classes/audio/assessment-audio-failure');
    const evidence = await captureFailedAudio(observer, {
      ...claimInput,
      nonce: claim.nonce,
    });
    await expect(
      captureFailedAssessmentAudioEvidence({
        database: instance.database,
        queue: audioQueue.audioGenerationQueue,
        identity: { ...claimInput, nonce: randomUUID() },
        capability: observer.capability,
        operation: observer.operation,
      })
    ).rejects.toThrow();
    await expect(
      observationTransaction(observer, claimInput, (tx) =>
        recordObservedFailedAssessmentAudio(tx, {}, observer.operation)
      )
    ).rejects.toThrow();
    await expect(
      observationTransaction(observer, claimInput, async (tx) => {
        expect(await recordObservedFailedAssessmentAudio(tx, evidence, observer.operation)).toEqual(
          { status: 'UNRESOLVED' }
        );
        throw new Error('roll back observed failure');
      })
    ).rejects.toThrow('roll back observed failure');
    await expect(
      sottoTransaction(instance.database, (tx) =>
        recordObservedFailedAssessmentAudio(tx, evidence, observer.operation)
      )
    ).rejects.toThrow();
    expect(
      await observationTransaction(observer, claimInput, (tx) =>
        claimAssessmentAudioObservation(tx, claimInput, observer.operation)
      )
    ).toEqual(claim);
    await expect(beginAssessmentAudioAttempt(instance.database, speechAttempt)).rejects.toThrow();
    await expect(processAudioGeneration(bound)).rejects.toThrow();
    await expect(
      observationTransaction(observer, claimInput, (tx) =>
        releaseAssessmentAudioObservation(
          tx,
          { ...claimInput, nonce: randomUUID() },
          observer.operation
        )
      )
    ).rejects.toThrow();
    await expect(
      observationTransaction(observer, claimInput, async (tx) => {
        await tx.$executeRawUnsafe(
          `CREATE FUNCTION test_reject_assessment_failure_receipt() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.id LIKE '%:assessment-audio-failure:%' THEN RAISE EXCEPTION 'test receipt failure'; END IF; RETURN NEW; END $$`
        );
        await tx.$executeRawUnsafe(
          `CREATE TRIGGER test_reject_assessment_failure_receipt BEFORE INSERT ON "SidedoorState" FOR EACH ROW EXECUTE FUNCTION test_reject_assessment_failure_receipt()`
        );
        await expect(
          recordObservedFailedAssessmentAudio(tx, evidence, observer.operation)
        ).rejects.toThrow();
      })
    ).rejects.toThrow();
    expect(
      await instance.database.classAssessment.findUniqueOrThrow({ where: { id: assessment } })
    ).toMatchObject({ status: 'GENERATING', sealedAt: null });
    await expect(
      observationTransaction(observer, claimInput, async (tx) => {
        await expect(
          trackAssessmentAudioObservationOperation(
            tx,
            observer.operation,
            { parentId: claimInput.operationId, fingerprint: claimInput.fingerprint },
            async () => {
              await tx.classAssessment.update({
                where: { id: assessment },
                data: { status: 'UNRESOLVED' },
              });
              throw new Error('application failure after write');
            }
          )
        ).rejects.toThrow('application failure after write');
      })
    ).rejects.toThrow();
    expect(
      await instance.database.classAssessment.findUniqueOrThrow({ where: { id: assessment } })
    ).toMatchObject({ status: 'GENERATING', sealedAt: null });
    await expect(
      observationTransaction(observer, claimInput, async (tx) => {
        await releaseAssessmentAudioObservation(tx, claim, observer.operation);
      })
    ).rejects.toThrow();
    await observationTransaction(observer, claimInput, (tx) =>
      releaseAssessmentAudioObservation(tx, claim, observer.operation)
    );
    await expect(
      observationTransaction(observer, claimInput, (tx) =>
        recordObservedFailedAssessmentAudio(tx, evidence, observer.operation)
      )
    ).rejects.toThrow();
    await observationTransaction(observer, claimInput, (tx) =>
      releaseAssessmentAudioObservation(tx, claim, observer.operation)
    );
  } finally {
    await expect(observer.finish()).rejects.toThrow();
  }
  const abandonedExecution = await startAudioExecution();
  const abandoned = await observationTransaction(abandonedExecution, claimInput, (tx) =>
    claimAssessmentAudioObservation(tx, claimInput, abandonedExecution.operation)
  );
  await abandonedExecution.finish();
  const recoveredExecution = await startAudioExecution();
  try {
    const recovered = await observationTransaction(recoveredExecution, claimInput, (tx) =>
      claimAssessmentAudioObservation(tx, claimInput, recoveredExecution.operation)
    );
    await expect(
      observationTransaction(recoveredExecution, claimInput, (tx) =>
        releaseAssessmentAudioObservation(tx, abandoned, recoveredExecution.operation)
      )
    ).rejects.toThrow();
    await observationTransaction(recoveredExecution, claimInput, (tx) =>
      releaseAssessmentAudioObservation(tx, recovered, recoveredExecution.operation)
    );
  } finally {
    await expect(recoveredExecution.finish()).rejects.toThrow();
  }
  const detachedExecution = await startAudioExecution();
  try {
    await expect(
      observationTransaction(detachedExecution, claimInput, async (tx) => {
        void claimAssessmentAudioObservation(tx, claimInput, detachedExecution.operation).catch(
          () => {}
        );
      })
    ).rejects.toThrow();
  } finally {
    await expect(detachedExecution.finish()).rejects.toThrow();
  }
  expect(await attemptStatus()).toBe('ABSENT');
}

interface AudioContentionContext extends AudioClaimsContext {
  classId: string;
  audioRecord: {
    fingerprint: string;
    job: { scopes: Array<{ subjectId: string; generation: number }> };
  };
}

export async function checkAssessmentAudioContention({
  instance,
  classId,
  audioRecord,
  speechAttempt,
  claimInput,
  claimAssessmentAudioObservation,
  releaseAssessmentAudioObservation,
  observationTransaction,
  attemptStatus,
}: AudioContentionContext) {
  const episodeScope = audioRecord.job.scopes.find(
    (scope) => scope.subjectId === `episode:${speechAttempt!.episodeId}`
  );
  if (!episodeScope) throw new Error('Assessment audio episode scope missing');
  const child = { ...speechAttempt, fingerprint: audioRecord.fingerprint };
  let locked!: (pid: number) => void;
  let releaseClaim!: () => void;
  let preparing!: (pid: number) => void;
  const claimLocked = new Promise<number>((resolve) => {
    locked = resolve;
  });
  const claimGate = new Promise<void>((resolve) => {
    releaseClaim = resolve;
  });
  const preparationStarted = new Promise<number>((resolve) => {
    preparing = resolve;
  });
  await withSottoJobExecution({
    database: instance.database,
    parentId: child.operationId,
    fingerprint: child.fingerprint,
    signal: new AbortController().signal,
    capabilityScope: episodeScope,
    isCleanupFailure: () => false,
    validate: async (tx) => {
      const current = await sottoJobOutbox(tx).read(child.operationId);
      return Boolean(current && !current.complete && current.fingerprint === child.fingerprint);
    },
    run: async ({ capability }) => {
      if (!capability) throw new Error('Assessment audio execution capability missing');
      const claimRace = runSottoExecutionOperation(
        capability,
        { parentId: child.operationId, fingerprint: child.fingerprint },
        async (observationOperation) => {
          const observed = await observationTransaction(
            { capability, operation: observationOperation },
            claimInput,
            async (tx) => {
              await tx.$queryRaw`SELECT id FROM "CourseClass" WHERE id = ${classId} FOR UPDATE`;
              const [backend] = await tx.$queryRaw<
                Array<{ pid: number }>
              >`SELECT pg_backend_pid() AS pid`;
              if (!backend) throw new Error('Assessment claim backend missing');
              locked(backend.pid);
              expect(
                await sottoJobExecutions(tx).blockingStatus(child.operationId, child.fingerprint)
              ).toBe('active');
              await claimGate;
              return claimAssessmentAudioObservation(tx, claimInput, observationOperation);
            }
          );
          await observationTransaction(
            { capability, operation: observationOperation },
            claimInput,
            (tx) => releaseAssessmentAudioObservation(tx, observed, observationOperation)
          );
        }
      ).then(
        () => null,
        (error: unknown) => error
      );
      const claimPid = await Promise.race([
        claimLocked,
        claimRace.then((error) => {
          throw error ?? new Error('Claim completed before locking');
        }),
      ]);
      let admitted = false;
      const transaction = runSottoExecutionTransaction(
        capability,
        { parentId: child.operationId, fingerprint: child.fingerprint },
        instance.database,
        async (tx) => {
          await validateAssessmentAudioLineage(tx, child.episodeId, child.generationKey);
          admitted = true;
        },
        {
          prepare: async (tx) => {
            const [backend] = await tx.$queryRaw<
              Array<{ pid: number }>
            >`SELECT pg_backend_pid() AS pid`;
            if (!backend) throw new Error('Assessment publication backend missing');
            preparing(backend.pid);
            await validateAssessmentAudioLineage(tx, child.episodeId, child.generationKey);
          },
        }
      );
      let blocked = false;
      try {
        const pid = await Promise.race([
          preparationStarted,
          transaction.then(() => {
            throw new Error('Publication completed before locking');
          }),
        ]);
        for (let attempt = 0; attempt < 200; attempt += 1) {
          const [backend] = await instance.database.$queryRaw<Array<{ blocked: boolean }>>`
                SELECT ${claimPid} = ANY(pg_blocking_pids(${pid})) AS blocked`;
          if (backend?.blocked) {
            blocked = true;
            break;
          }
          await new Promise((resolve) => setTimeout(resolve, 25));
        }
      } finally {
        releaseClaim();
      }
      expect(blocked).toBe(true);
      expect(await claimRace).toBeNull();
      await transaction;
      expect(admitted).toBe(true);
    },
  });
  expect(await attemptStatus()).toBe('ABSENT');
}

interface AudioAdmissionContext extends AudioClaimsContext {
  classId: string;
  cls: { courseId: string; lessonId: string; order: number };
  identity: { ownerId: string };
  heldOut: { episodeId: string | null };
  audioSegment: { id: string };
  audioRecord: { fingerprint: string };
}

export async function checkAssessmentAudioAdmission({
  instance,
  audioQueue,
  speechAttempt,
  bound,
  processAudioGeneration,
  startAudioExecution,
  attemptStatus,
  classId,
  cls,
  identity,
  heldOut,
  audioSegment,
  audioRecord,
}: AudioAdmissionContext) {
  const firstExecution = await startAudioExecution();
  try {
    const admittedAttempt = { ...speechAttempt, fingerprint: audioRecord.fingerprint };
    for (const override of [
      { ttsProvider: 'unexpected-override' },
      { ttsModel: 'unexpected-override' },
      { ttsVoiceId: 'unexpected-override' },
    ]) {
      await instance.database.segment.update({
        where: { id: audioSegment.id },
        data: override,
      });
      await expect(
        beginAssessmentAudioAttempt(instance.database, admittedAttempt, firstExecution.operation)
      ).rejects.toThrow();
      await instance.database.segment.update({
        where: { id: audioSegment.id },
        data: { ttsProvider: null, ttsModel: null, ttsVoiceId: null },
      });
    }
    const { recordObservedFailedAssessmentAudio } =
      await import('@/lib/learning/classes/audio/assessment-audio-failure');
    let releaseOldSnapshot!: () => void;
    let oldSnapshotReady!: () => void;
    const oldSnapshotGate = new Promise<void>((resolve) => {
      releaseOldSnapshot = resolve;
    });
    const oldSnapshotStarted = new Promise<void>((resolve) => {
      oldSnapshotReady = resolve;
    });
    const oldSnapshot = instance.database
      .$transaction(
        async (tx) => {
          await sottoJobOutbox(tx).read(speechAttempt!.operationId);
          oldSnapshotReady();
          await oldSnapshotGate;
          return recordObservedFailedAssessmentAudio(tx, {}, firstExecution.operation);
        },
        { isolationLevel: 'Serializable', timeout: 30000 }
      )
      .then(
        () => null,
        (error: unknown) => error
      );
    await oldSnapshotStarted;
    const contenders = await Promise.allSettled([
      beginAssessmentAudioAttempt(instance.database, admittedAttempt, firstExecution.operation),
      beginAssessmentAudioAttempt(instance.database, admittedAttempt, firstExecution.operation),
    ]).finally(releaseOldSnapshot);
    expect(await oldSnapshot).toBeInstanceOf(AssessmentFenceConflict);
    expect(contenders.map((item) => item.status).sort()).toEqual(['fulfilled', 'rejected']);
    const winner = contenders.find((item) => item.status === 'fulfilled');
    if (!winner || winner.status !== 'fulfilled')
      throw new Error('Speech attempt was not admitted');
    const speechObservation = winner.value;
    expect(await attemptStatus()).toBe('ACTIVE');
    const fetcher = vi.spyOn(globalThis, 'fetch');
    try {
      await expect(processAudioGeneration(bound)).rejects.toThrow();
      expect(fetcher).not.toHaveBeenCalled();
    } finally {
      fetcher.mockRestore();
    }
    expect(await attemptStatus()).toBe('ACTIVE');
    const { inspectPrerequisiteDeletion } =
      await import('@/lib/classes/help/prerequisite-deletion');
    await expect(
      sottoTransaction(instance.database, (tx) =>
        inspectPrerequisiteDeletion(tx, classId, cls.courseId, identity.ownerId)
      )
    ).rejects.toThrow('requires recovery before deletion');
    const queued = await audioQueue.audioGenerationQueue.getJob(speechAttempt.operationId);
    if (!queued) throw new Error('Assessment audio delivery missing');
    const { reconcileDurableQueueFailure } = await import('@/lib/sidedoor/jobs/core/durable-queue');
    expect(
      await reconcileDurableQueueFailure({
        database: instance.database,
        job: queued,
        handler: 'audio-generation',
        version: 1,
        failedReason: 'Uncertain provider outcome',
      })
    ).toBeNull();
    expect(
      (
        await sottoTransaction(instance.database, (tx) =>
          sottoJobOutbox(tx).read(speechAttempt!.operationId)
        )
      )?.complete
    ).toBe(false);
    expect(
      (
        await instance.database.episode.findUniqueOrThrow({
          where: { id: heldOut.episodeId! },
        })
      ).status
    ).toBe('GENERATING_AUDIO');
    await expect(
      beginAssessmentAudioAttempt(instance.database, admittedAttempt, firstExecution.operation)
    ).rejects.toThrow();
    expect(
      await sottoTransaction(instance.database, (tx) =>
        listAssessmentAudioAttempts(tx, {
          classId,
          courseId: cls.courseId,
          userId: identity.ownerId,
        })
      )
    ).toEqual([
      expect.objectContaining({ operationId: speechAttempt.operationId, status: 'ACTIVE' }),
    ]);
    await expect(
      sottoTransaction(instance.database, (tx) =>
        listAssessmentAudioAttempts(tx, {
          classId,
          courseId: cls.courseId,
          userId: 'another-user',
        })
      )
    ).rejects.toThrow();
    const otherClass = await instance.database.courseClass.create({
      data: { courseId: cls.courseId, lessonId: cls.lessonId, order: cls.order + 1 },
    });
    expect(
      await sottoTransaction(instance.database, (tx) =>
        listAssessmentAudioAttempts(tx, {
          classId: otherClass.id,
          courseId: cls.courseId,
          userId: identity.ownerId,
        })
      )
    ).toEqual([]);
    const { capturePrerequisiteOwnership } =
      await import('@/lib/classes/help/lifecycle/prerequisite-ownership');
    const otherOwnership = await sottoTransaction(instance.database, (tx) =>
      capturePrerequisiteOwnership(tx, otherClass.id, cls.courseId, identity.ownerId)
    );
    const otherScope = otherOwnership.scopes.find(
      (scope) => scope.subjectId === `class:${otherClass.id}`
    );
    if (!otherScope) throw new Error('Other class scope missing');
    const originalAttempt = await instance.database.sidedoorState.findFirstOrThrow({
      where: {
        id: { contains: ':assessment-audio-attempt:', endsWith: speechAttempt.operationId },
      },
    });
    if (
      !originalAttempt.state ||
      typeof originalAttempt.state !== 'object' ||
      Array.isArray(originalAttempt.state)
    )
      throw new Error('Assessment audio state missing');
    const scopeHash = createHash('sha256')
      .update(JSON.stringify([otherClass.id, otherScope.generation]))
      .digest('hex');
    const orphanId = `${SIDEDOOR_STATE_ID}:assessment-audio-attempt:${scopeHash}:${speechAttempt.operationId}`;
    await instance.database.sidedoorState.create({
      data: {
        id: orphanId,
        revision: randomUUID(),
        state: {
          ...originalAttempt.state,
          classId: otherClass.id,
          classGeneration: otherScope.generation,
          scopes: otherOwnership.scopes,
        } as Prisma.InputJsonValue,
      },
    });
    try {
      await expect(
        sottoTransaction(instance.database, (tx) =>
          inspectPrerequisiteDeletion(tx, otherClass.id, cls.courseId, identity.ownerId)
        )
      ).rejects.toThrow('requires recovery before deletion');
    } finally {
      await instance.database.sidedoorState.delete({ where: { id: orphanId } });
    }
    const orphanFailure = `${SIDEDOOR_STATE_ID}:assessment-audio-failure:${scopeHash}:${speechAttempt.operationId}`;
    await instance.database.sidedoorState.create({
      data: { id: orphanFailure, revision: randomUUID(), state: {} },
    });
    try {
      await expect(
        sottoTransaction(instance.database, (tx) =>
          inspectPrerequisiteDeletion(tx, otherClass.id, cls.courseId, identity.ownerId)
        )
      ).rejects.toThrow('requires recovery before deletion');
    } finally {
      await instance.database.sidedoorState.delete({ where: { id: orphanFailure } });
    }
    const orphanClaim = `${SIDEDOOR_STATE_ID}:assessment-audio-claim:${scopeHash}:${speechAttempt.operationId}`;
    await instance.database.sidedoorState.create({
      data: { id: orphanClaim, revision: randomUUID(), state: {} },
    });
    try {
      await expect(
        sottoTransaction(instance.database, (tx) =>
          inspectPrerequisiteDeletion(tx, otherClass.id, cls.courseId, identity.ownerId)
        )
      ).rejects.toThrow('requires recovery before deletion');
    } finally {
      await instance.database.sidedoorState.delete({ where: { id: orphanClaim } });
    }
    speechObservation.onDispatch();
    speechObservation.onSettled();
    return speechObservation;
  } finally {
    await firstExecution.finish();
  }
}
