import { expect } from 'vitest';
import { createHash } from 'node:crypto';
import {
  beginAssessmentAudioAttempt,
  readAssessmentAudioAttemptStatus,
  listAssessmentAudioAttempts,
  readCompletedAssessmentAudioAttempt,
} from '@/lib/learning/classes/audio/assessment-audio-attempt';
import { sottoTransaction } from '@/lib/sidedoor/access/state/transaction';
import { sottoJobOutbox } from '@/lib/sidedoor/jobs/core/job-delivery';
import { captureEpisodeStorage } from '@/lib/sidedoor/storage/core/episode-storage';
import { readRetainedAssessmentAudioAttempt } from '@/lib/learning/classes/audio/assessment-audio-attempt';
import type { Prisma } from '@/generated/prisma/client';
import type { SharedTestInstance } from '../../../../../helpers/setup/shared-instance';
import type { runAssessmentAudioObservationTransaction } from '@/lib/learning/classes/audio/assessment-audio-claim';
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
interface RetainedAudioContext {
  speechAttempt: {
    episodeId: string;
    segmentId: string;
    generationKey: string;
    operationId: string;
  };
  instance: SharedTestInstance;
  audioInput: { episodeId: string };
  classId: string;
  cls: { courseId: string };
  identity: { ownerId: string };
  assessment: string;
  operation: { id: string };
  startAudioExecution:
    (() => Promise<ObservationContext & { finish: () => Promise<void> }>) | undefined;
  observationTransaction: <Result>(
    context: ObservationContext,
    identity: ObservationIdentity,
    run: (tx: Prisma.TransactionClient) => Promise<Result>
  ) => Promise<Result>;
  captureFailedAudio: (
    context: ObservationContext,
    identity: ObservationIdentity & { nonce: string }
  ) => ReturnType<typeof captureFailedAssessmentAudioEvidence>;
}

export async function checkRetainedAssessmentAudio({
  speechAttempt,
  instance,
  audioInput,
  classId,
  cls,
  identity,
  assessment,
  operation,
  startAudioExecution,
  observationTransaction,
  captureFailedAudio,
}: RetainedAudioContext) {
  const attempt = speechAttempt;
  const retained = await sottoTransaction(instance.database, async (tx) => {
    const storage = await captureEpisodeStorage(tx, audioInput.episodeId);
    const child = await sottoJobOutbox(tx).read(attempt.operationId);
    const scope = storage.scopes.find((item) => item.subjectId === `class:${classId}`);
    if (!child || !scope) throw new Error('Retained assessment attempt missing');
    return {
      ...attempt,
      classId,
      courseId: cls.courseId,
      userId: identity.ownerId,
      classGeneration: scope.generation,
      scopes: storage.scopes,
      assessmentId: assessment,
      parentOperationId: operation.id,
      fingerprint: child.fingerprint,
    };
  });
  expect(
    await sottoTransaction(instance.database, (tx) =>
      readRetainedAssessmentAudioAttempt(tx, retained)
    )
  ).toBe('ACTIVE');
  await expect(
    sottoTransaction(instance.database, (tx) =>
      readRetainedAssessmentAudioAttempt(tx, { ...retained, fingerprint: '0'.repeat(64) })
    )
  ).rejects.toThrow();
  const { hasRecordedAssessmentAudioFailure, recordObservedFailedAssessmentAudio } =
    await import('@/lib/learning/classes/audio/assessment-audio-failure');
  if (!startAudioExecution) throw new Error('Assessment audio execution missing');
  const observationExecution = await startAudioExecution();
  const observationIdentity = {
    classId,
    classGeneration: retained.classGeneration,
    assessmentId: assessment,
    operationId: attempt.operationId,
    fingerprint: retained.fingerprint,
  };
  try {
    await expect(
      observationTransaction(observationExecution, observationIdentity, (tx) =>
        recordObservedFailedAssessmentAudio(tx, {}, observationExecution.operation)
      )
    ).rejects.toThrow();
    const { claimAssessmentAudioObservation, releaseAssessmentAudioObservation } =
      await import('@/lib/learning/classes/audio/assessment-audio-claim');
    const claim = await observationTransaction(observationExecution, observationIdentity, (tx) =>
      claimAssessmentAudioObservation(tx, observationIdentity, observationExecution.operation)
    );
    const evidence = await captureFailedAudio(observationExecution, {
      ...observationIdentity,
      nonce: claim.nonce,
    });
    await expect(
      observationTransaction(observationExecution, observationIdentity, (tx) =>
        recordObservedFailedAssessmentAudio(tx, { ...evidence }, observationExecution.operation)
      )
    ).rejects.toThrow();
    await expect(
      observationTransaction(observationExecution, observationIdentity, async (tx) => {
        expect(
          await recordObservedFailedAssessmentAudio(tx, evidence, observationExecution.operation)
        ).toEqual({
          status: 'UNRESOLVED',
        });
        expect(
          (await tx.classAssessment.findUniqueOrThrow({ where: { id: assessment } })).status
        ).toBe('UNRESOLVED');
        expect((await sottoJobOutbox(tx).read(attempt.operationId))?.complete).toBe(false);
        expect(await readRetainedAssessmentAudioAttempt(tx, retained)).toBe('ACTIVE');
        expect(await hasRecordedAssessmentAudioFailure(tx, observationIdentity)).toBe(true);
        await expect(
          hasRecordedAssessmentAudioFailure(tx, {
            ...observationIdentity,
            fingerprint: '0'.repeat(64),
          })
        ).rejects.toThrow();
        throw new Error('rollback-settlement-fixture');
      })
    ).rejects.toThrow('rollback-settlement-fixture');
    await observationTransaction(observationExecution, observationIdentity, (tx) =>
      releaseAssessmentAudioObservation(tx, claim, observationExecution.operation)
    );
  } finally {
    await expect(observationExecution.finish()).rejects.toThrow();
  }
}

interface PublicationAudioContext extends RetainedAudioContext {
  cls: { courseId: string; createdAt: Date };
  bytes: Buffer;
  generationKey: string;
}

export async function checkCompletedAssessmentAudio({
  speechAttempt,
  instance,
  classId,
  cls,
  identity,
  assessment,
  startAudioExecution,
  observationTransaction,
  captureFailedAudio,
  bytes,
  generationKey,
}: PublicationAudioContext) {
  if (!startAudioExecution) throw new Error('Assessment audio execution missing');
  const attempt = speechAttempt;
  const child = await sottoTransaction(instance.database, (tx) =>
    sottoJobOutbox(tx).read(attempt.operationId)
  );
  if (!child) throw new Error('Assessment audio child missing');
  const { completeObservedAssessmentAudioPublication, recordObservedFailedAssessmentAudio } =
    await import('@/lib/learning/classes/audio/assessment-audio-failure');
  const { claimAssessmentAudioObservation, releaseAssessmentAudioObservation } =
    await import('@/lib/learning/classes/audio/assessment-audio-claim');
  const completionExecution = await startAudioExecution();
  const completionIdentity = {
    classId,
    classGeneration: cls.createdAt.getTime(),
    assessmentId: assessment,
    operationId: attempt.operationId,
    fingerprint: child.fingerprint,
  };
  const completionClaim = await observationTransaction(
    completionExecution,
    completionIdentity,
    (tx) =>
      claimAssessmentAudioObservation(
        tx,
        {
          classId,
          classGeneration: cls.createdAt.getTime(),
          assessmentId: assessment,
          operationId: attempt.operationId,
          fingerprint: child.fingerprint,
        },
        completionExecution.operation
      )
  );
  const completionEvidence = await captureFailedAudio(completionExecution, {
    ...completionIdentity,
    nonce: completionClaim.nonce,
  });
  const savedSegment = await instance.database.segment.findUniqueOrThrow({
    where: { id: attempt.segmentId },
    select: { audioUrl: true },
  });
  try {
    expect(
      await observationTransaction(completionExecution, completionIdentity, (tx) =>
        recordObservedFailedAssessmentAudio(tx, completionEvidence, completionExecution.operation)
      )
    ).toEqual({ status: 'PUBLISHED' });
    for (const audioUrl of [null, '/unexpected-audio']) {
      await instance.database.segment.update({
        where: { id: attempt.segmentId },
        data: { audioUrl },
      });
      await expect(
        observationTransaction(completionExecution, completionIdentity, (tx) =>
          recordObservedFailedAssessmentAudio(tx, completionEvidence, completionExecution.operation)
        )
      ).rejects.toThrow();
    }
    await instance.database.segment.update({
      where: { id: attempt.segmentId },
      data: { audioUrl: savedSegment.audioUrl },
    });
    await expect(
      observationTransaction(completionExecution, completionIdentity, async (tx) => {
        expect(
          await completeObservedAssessmentAudioPublication(
            tx,
            { ...completionIdentity, nonce: completionClaim.nonce },
            completionEvidence,
            completionExecution.operation
          )
        ).toEqual({ status: 'PUBLISHED' });
        expect((await sottoJobOutbox(tx).read(attempt.operationId))?.complete).toBe(true);
        throw new Error('roll back completed publication');
      })
    ).rejects.toThrow('roll back completed publication');
    expect(
      (
        await sottoTransaction(instance.database, (tx) =>
          sottoJobOutbox(tx).read(attempt.operationId)
        )
      )?.complete
    ).toBe(false);
  } finally {
    await instance.database.segment.update({
      where: { id: attempt.segmentId },
      data: { audioUrl: savedSegment.audioUrl },
    });
    await observationTransaction(completionExecution, completionIdentity, (tx) =>
      releaseAssessmentAudioObservation(tx, completionClaim, completionExecution.operation)
    );
    await expect(completionExecution.finish()).rejects.toThrow();
  }
  expect(
    await sottoTransaction(instance.database, (tx) =>
      readAssessmentAudioAttemptStatus(tx, { ...attempt, fingerprint: child.fingerprint })
    )
  ).toBe('COMPLETE');
  expect(
    await sottoTransaction(instance.database, (tx) =>
      listAssessmentAudioAttempts(tx, {
        classId,
        courseId: cls.courseId,
        userId: identity.ownerId,
      })
    )
  ).toEqual([
    expect.objectContaining({
      operationId: speechAttempt!.operationId,
      generationKey,
      assessmentId: assessment,
      status: 'COMPLETE',
    }),
  ]);
  expect(
    await sottoTransaction(instance.database, (tx) =>
      readCompletedAssessmentAudioAttempt(tx, speechAttempt!)
    )
  ).toEqual({
    contentSha256: createHash('sha256').update(bytes).digest('hex'),
    contentBytes: bytes.length,
  });
  await expect(beginAssessmentAudioAttempt(instance.database, speechAttempt)).rejects.toThrow();
}
