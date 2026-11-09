import { expect } from 'vitest';
import { isSerializationConflict } from 'thesidedoor-core/storage/sql';
import { sottoTransaction } from '@/lib/sidedoor/access/state/transaction';
import { sottoJobOutbox } from '@/lib/sidedoor/jobs/core/job-delivery';
import { withSottoJobExecution } from '@/lib/sidedoor/jobs/core/job-execution-lifetime';
import {
  recoverAssessmentOutcome,
  sealAssessmentOutcome,
} from '@/lib/learning/classes/lifecycle/assessment-outcome';
import {
  generateAssessmentSection,
  prepareAssessmentAuthorProof,
} from '@/lib/learning/classes/generation/assessment-generation';
import {
  prepareOrGenerateAssessmentReviewProof,
  prepareAssessmentReviewProof,
} from '@/lib/learning/classes/review/assessment-review-generation';
import {
  requireAssessmentExecutionAdmission,
  validateAssessmentExecutionState,
  startAssessmentWork,
} from '@/lib/learning/classes/generation/assessment-work';
import type {
  SharedTestIdentity,
  SharedTestInstance,
} from '../../../../../helpers/setup/shared-instance';
import type { SottoProviderExecution } from '@/lib/sidedoor/credentials/runtime/provider-execution';
import type { assessmentWorkSchema } from '@/lib/learning/classes/lifecycle/assessment-fence';

interface ManualOutcomeContext {
  instance: SharedTestInstance;
  identity: SharedTestIdentity;
  classId: string;
  fence: ReturnType<typeof assessmentWorkSchema.parse>['fence'];
  operation: { id: string; fingerprint: string };
  execution: SottoProviderExecution;
  scope: ReturnType<typeof assessmentWorkSchema.parse>['fence']['ownership']['scopes'][number];
  getDispatches: () => number;
}

export async function checkManualAssessmentOutcome({
  instance,
  identity,
  classId,
  fence,
  operation,
  execution,
  scope,
  getDispatches,
}: ManualOutcomeContext) {
  const skills = ['GRAMMAR', 'READING', 'WRITING'] as const;
  const unresolved = () => {
    throw new Error('Unexpected unresolved provider');
  };
  expect(() =>
    prepareOrGenerateAssessmentReviewProof({
      identity: operation,
      execution,
      capability: {},
      unresolved,
    })
  ).toThrow();
  expect(getDispatches()).toBe(0);
  let releaseOldSnapshot!: () => void;
  let oldSnapshotStarted!: () => void;
  const oldSnapshotGate = new Promise<void>((resolve) => {
    releaseOldSnapshot = resolve;
  });
  const oldSnapshotReady = new Promise<void>((resolve) => {
    oldSnapshotStarted = resolve;
  });
  const staleSettlement = instance.database
    .$transaction(
      async (tx) => {
        await tx.user.findUniqueOrThrow({
          where: { id: identity.ownerId },
          select: { id: true },
        });
        oldSnapshotStarted();
        await oldSnapshotGate;
        await tx.$queryRaw`SELECT id FROM "CourseClass" WHERE id = ${classId} FOR UPDATE`;
        await tx.$queryRaw`SELECT id FROM "ClassAssessment" WHERE id = ${fence.assessmentId} FOR UPDATE`;
      },
      { isolationLevel: 'Serializable', timeout: 15000 }
    )
    .then(
      () => null,
      (error: unknown) => error
    );
  await oldSnapshotReady;
  let admissionAcknowledgmentLost = false;
  let admissionValidations = 0;
  const recoveryDatabase = new Proxy(instance.database, {
    get(target, property, receiver) {
      if (property !== '$transaction') return Reflect.get(target, property, receiver);
      return async (...args: Parameters<typeof target.$transaction>) => {
        const result: unknown = await Reflect.apply(target.$transaction, target, args);
        if (!admissionAcknowledgmentLost) {
          admissionAcknowledgmentLost = true;
          throw new Error('Lost execution admission acknowledgment');
        }
        return result;
      };
    },
  });
  await expect(
    withSottoJobExecution({
      database: recoveryDatabase,
      parentId: operation.id,
      fingerprint: operation.fingerprint,
      signal: new AbortController().signal,
      capabilityScope: scope,
      validate: async (tx) => {
        admissionValidations += 1;
        await validateAssessmentExecutionState(tx, operation, execution);
        return true;
      },
      isCleanupFailure: () => false,
      run: async ({ capability }) => {
        if (!capability) throw new Error('Execution capability missing');
        releaseOldSnapshot();
        expect(isSerializationConflict(await staleSettlement)).toBe(true);
        await sottoTransaction(instance.database, (tx) =>
          startAssessmentWork(tx, operation, execution)
        );
        await expect(
          sottoTransaction(instance.database, (tx) =>
            requireAssessmentExecutionAdmission(tx, operation, execution)
          )
        ).rejects.toThrow();
        expect(
          (
            await sottoTransaction(instance.database, (tx) =>
              validateAssessmentExecutionState(tx, operation, execution)
            )
          ).current.status
        ).toBe('RUNNING');
        for (const skill of skills)
          await generateAssessmentSection({
            identity: operation,
            execution,
            skill,
            unresolved,
          });
        const firstReview = await prepareOrGenerateAssessmentReviewProof({
          identity: operation,
          execution,
          capability,
          unresolved,
        });
        if (firstReview.status !== 'REVIEWED') throw new Error('Review was not ready');
        const afterFirstReview = getDispatches();
        const resumedReview = await prepareOrGenerateAssessmentReviewProof({
          identity: operation,
          execution,
          capability,
          unresolved,
        });
        expect(resumedReview).toMatchObject({ status: 'REVIEWED' });
        expect(getDispatches()).toBe(afterFirstReview);
        const reviewCalls = await instance.database.classAssessmentProviderCall.findMany({
          where: { assessmentId: fence.assessmentId, stage: 'REVIEW' },
          orderBy: { ordinal: 'asc' },
        });
        if (!reviewCalls[0]) throw new Error('Assessment review call missing');
        const extraReviewCall = await instance.database.classAssessmentProviderCall.create({
          data: {
            assessmentId: fence.assessmentId,
            stage: 'REVIEW',
            ordinal: reviewCalls.length,
            role: 'MODEL',
            inputDigest: reviewCalls[0].inputDigest,
          },
        });
        try {
          await expect(
            prepareOrGenerateAssessmentReviewProof({
              identity: operation,
              execution,
              capability,
              unresolved,
            })
          ).rejects.toThrow();
          expect(getDispatches()).toBe(afterFirstReview);
        } finally {
          await instance.database.classAssessmentProviderCall.delete({
            where: { id: extraReviewCall.id },
          });
        }
        const author = await prepareAssessmentAuthorProof({
          identity: operation,
          execution,
          skill: 'GRAMMAR',
        });
        const review = firstReview.proof;
        await sealAssessmentOutcome({
          database: instance.database,
          identity: operation,
          execution,
          capability,
          authors: [author, author, author],
          review,
        });
      },
    })
  ).rejects.toThrow();
  releaseOldSnapshot();
  expect(admissionAcknowledgmentLost).toBe(true);
  expect(admissionValidations).toBeGreaterThanOrEqual(2);
  expect(
    await instance.database.classAssessment.findUniqueOrThrow({
      where: { id: fence.assessmentId },
    })
  ).toMatchObject({ status: 'GENERATING', sealedAt: null });
  expect(
    (await sottoTransaction(instance.database, (tx) => sottoJobOutbox(tx).read(operation.id)))
      ?.complete
  ).toBe(false);
  let releaseFirst!: () => void;
  let firstStarted!: () => void;
  let secondStarted!: () => void;
  const firstGate = new Promise<void>((resolve) => {
    releaseFirst = resolve;
  });
  const firstReady = new Promise<void>((resolve) => {
    firstStarted = resolve;
  });
  const secondReady = new Promise<void>((resolve) => {
    secondStarted = resolve;
  });
  const runCompeting = (first: boolean) =>
    withSottoJobExecution({
      database: instance.database,
      parentId: operation.id,
      fingerprint: operation.fingerprint,
      signal: new AbortController().signal,
      capabilityScope: scope,
      validate: async (tx) => {
        await validateAssessmentExecutionState(tx, operation, execution);
        return true;
      },
      isCleanupFailure: () => false,
      run: async () => {
        if (first) {
          firstStarted();
          await firstGate;
        } else secondStarted();
      },
    });
  const firstRun = runCompeting(true);
  await Promise.race([
    firstReady,
    firstRun.then(() => {
      throw new Error('First execution ended early');
    }),
  ]);
  const secondRun = runCompeting(false);
  try {
    expect(
      await Promise.race([
        secondReady.then(() => 'started'),
        new Promise((resolve) => setTimeout(() => resolve('waiting'), 100)),
      ])
    ).toBe('waiting');
  } finally {
    releaseFirst();
  }
  await Promise.all([firstRun, secondRun]);
  await secondReady;
  await withSottoJobExecution({
    database: instance.database,
    parentId: operation.id,
    fingerprint: operation.fingerprint,
    signal: new AbortController().signal,
    capabilityScope: scope,
    validate: async () => true,
    isCleanupFailure: () => false,
    run: async ({ capability }) => {
      if (!capability) throw new Error('Execution capability missing');
      const authors = [];
      for (const skill of skills)
        authors.push(await prepareAssessmentAuthorProof({ identity: operation, execution, skill }));
      const review = await prepareAssessmentReviewProof({ identity: operation, execution });
      expect(getDispatches()).toBe(4);
      expect(
        await sealAssessmentOutcome({
          database: instance.database,
          identity: operation,
          execution,
          capability,
          authors,
          review,
        })
      ).toEqual({ status: 'READY' });
      expect(
        await instance.database.classAssessment.findUniqueOrThrow({
          where: { id: fence.assessmentId },
        })
      ).toMatchObject({ status: 'READY', reviewedMaterialDigest: review.materialDigest });
      await expect(
        sottoTransaction(instance.database, (tx) => recoverAssessmentOutcome(tx, operation))
      ).rejects.toThrow();
      expect(
        (await sottoTransaction(instance.database, (tx) => sottoJobOutbox(tx).read(operation.id)))
          ?.complete
      ).toBe(false);
    },
  });
  await expect(
    instance.database.$transaction((tx) => recoverAssessmentOutcome(tx, operation))
  ).rejects.toThrow('Assessment recovery requires a Serializable transaction');
  expect(
    await sottoTransaction(instance.database, (tx) => recoverAssessmentOutcome(tx, operation))
  ).toBe(true);
  expect(
    await sottoTransaction(instance.database, (tx) => recoverAssessmentOutcome(tx, operation))
  ).toBe(true);
  expect(
    (await sottoTransaction(instance.database, (tx) => sottoJobOutbox(tx).read(operation.id)))
      ?.complete
  ).toBe(true);
  expect(getDispatches()).toBe(4);
}
