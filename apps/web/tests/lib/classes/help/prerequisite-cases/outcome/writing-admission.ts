import { randomUUID } from 'node:crypto';
import { expect } from 'vitest';
import { sottoTransaction } from '@/lib/sidedoor/access/state/transaction';
import { sottoJobOutbox } from '@/lib/sidedoor/jobs/core/job-delivery';
import { SIDEDOOR_STATE_ID } from '@/lib/sidedoor/access/state/store';
import { learningPreparationGrant } from '@/lib/learning/preparation/preparation-grant';
import type {
  SharedTestIdentity,
  SharedTestInstance,
} from '../../../../../helpers/setup/shared-instance';
import type { SottoProviderExecution } from '@/lib/sidedoor/credentials/runtime/provider-execution';
import type { assessmentWorkSchema } from '@/lib/learning/classes/lifecycle/assessment-fence';
import type { admitAssessmentWriting } from '@/lib/learning/classes/writing/assessment-writing-admission';
import type { captureAssessmentWritingTask } from '@/lib/learning/classes/writing/assessment-writing-read';

interface WritingAdmissionContext {
  instance: SharedTestInstance;
  admitAssessmentWriting: typeof admitAssessmentWriting;
  fence: ReturnType<typeof assessmentWorkSchema.parse>['fence'];
  heldOutWriting: { id: string };
  writingCapture: Awaited<ReturnType<typeof captureAssessmentWritingTask>>;
  execution: SottoProviderExecution;
  identity: SharedTestIdentity;
  classId: string;
  cls: { courseId: string };
  selection: Parameters<typeof admitAssessmentWriting>[1]['selection'];
}

export async function checkWritingAdmission({
  instance,
  admitAssessmentWriting,
  fence,
  heldOutWriting,
  writingCapture,
  execution,
  identity,
  classId,
  cls,
  selection,
}: WritingAdmissionContext) {
  const input = {
    classId,
    assessmentId: fence.assessmentId,
    promptId: heldOutWriting.id,
    text: 'Пожалуйста, вода.',
    execution,
    selection,
    expected: writingCapture,
  };
  const attempts = await Promise.all([
    sottoTransaction(instance.database, (tx) => admitAssessmentWriting(tx, input)),
    sottoTransaction(instance.database, (tx) => admitAssessmentWriting(tx, input)),
  ]);
  expect(attempts.map((attempt) => attempt.replayed).sort()).toEqual([false, true]);
  expect(attempts[0]!.responseId).toBe(attempts[1]!.responseId);
  expect(attempts[0]!.operation.id).toBe(attempts[1]!.operation.id);
  const committedWriting = {
    responseId: attempts[0]!.responseId,
    operationId: attempts[0]!.operation.id,
  };
  const writingAdmission = attempts.find((attempt) => !attempt.replayed);
  if (!writingAdmission) throw new Error('New writing admission missing');
  const { inspectPrerequisiteDeletion } = await import('@/lib/classes/help/prerequisite-deletion');
  await expect(
    sottoTransaction(instance.database, (tx) =>
      inspectPrerequisiteDeletion(tx, classId, cls.courseId, identity.ownerId)
    )
  ).rejects.toThrow('requires recovery before deletion');
  const { readAssessmentWritingRecovery } =
    await import('@/lib/learning/classes/writing/assessment-writing-recovery');
  await expect(
    sottoTransaction(instance.database, async (tx) => {
      await tx.writingResponse.update({
        where: { id: attempts[0]!.responseId },
        data: { gradingState: { ...attempts[0]!.operation, status: 'COMPLETED' } },
      });
      expect(
        await readAssessmentWritingRecovery(tx, {
          classId,
          assessmentId: fence.assessmentId,
          promptId: heldOutWriting.id,
          execution,
        })
      ).toMatchObject({ status: 'UNRESOLVED' });
      throw new Error('Roll back unproven writing completion');
    })
  ).rejects.toThrow('Roll back unproven writing completion');
  await expect(
    sottoTransaction(instance.database, async (tx) => {
      await tx.sidedoorState.delete({
        where: { id: `${SIDEDOOR_STATE_ID}:writing-grant:${attempts[0]!.operation.id}` },
      });
      await expect(
        readAssessmentWritingRecovery(tx, {
          classId,
          assessmentId: fence.assessmentId,
          promptId: heldOutWriting.id,
          execution,
        })
      ).rejects.toThrow();
      throw new Error('Roll back missing writing grant');
    })
  ).rejects.toThrow('Roll back missing writing grant');
  await expect(
    sottoTransaction(instance.database, async (tx) => {
      const operation = attempts[0]!.operation;
      const grant = learningPreparationGrant(tx, operation, 'writing');
      await grant.admit(operation.grant, {
        id: randomUUID(),
        fingerprint: 'a'.repeat(64),
      });
      await grant.revoke(operation.grant);
      await tx.writingResponse.update({
        where: { id: attempts[0]!.responseId },
        data: { gradingState: { ...operation, status: 'FAILED' } },
      });
      await sottoJobOutbox(tx).complete(operation.id, operation.fingerprint);
      expect(
        await readAssessmentWritingRecovery(tx, {
          classId,
          assessmentId: fence.assessmentId,
          promptId: heldOutWriting.id,
          execution,
        })
      ).toMatchObject({ status: 'UNRESOLVED' });
      throw new Error('Roll back unknown writing attempt');
    })
  ).rejects.toThrow('Roll back unknown writing attempt');
  await expect(
    sottoTransaction(instance.database, async (tx) => {
      const operation = attempts[0]!.operation;
      await learningPreparationGrant(tx, operation, 'writing').revoke(operation.grant);
      await tx.writingResponse.update({
        where: { id: attempts[0]!.responseId },
        data: { gradingState: { ...operation, status: 'FAILED' } },
      });
      await sottoJobOutbox(tx).complete(operation.id, operation.fingerprint);
      expect(
        await readAssessmentWritingRecovery(tx, {
          classId,
          assessmentId: fence.assessmentId,
          promptId: heldOutWriting.id,
          execution,
        })
      ).toMatchObject({ status: 'FAILED' });
      throw new Error('Roll back undispatched writing failure');
    })
  ).rejects.toThrow('Roll back undispatched writing failure');
  await expect(
    sottoTransaction(instance.database, async (tx) => {
      const operation = attempts[0]!.operation;
      await tx.writingResponse.update({
        where: { id: attempts[0]!.responseId },
        data: { gradingState: { ...operation, expiresAt: 0 } },
      });
      const { reconcileWritingResponse } = await import('@/lib/learning/writing/writing-execution');
      await reconcileWritingResponse(tx, attempts[0]!.responseId, operation);
      expect(
        await readAssessmentWritingRecovery(tx, {
          classId,
          assessmentId: fence.assessmentId,
          promptId: heldOutWriting.id,
          execution,
        })
      ).toMatchObject({ status: 'FAILED' });
      throw new Error('Roll back expired writing recovery');
    })
  ).rejects.toThrow('Roll back expired writing recovery');
  expect(
    await sottoTransaction(instance.database, (tx) => admitAssessmentWriting(tx, input))
  ).toMatchObject({
    responseId: attempts[0]!.responseId,
    operation: { id: attempts[0]!.operation.id },
    replayed: true,
  });
  await expect(
    sottoTransaction(instance.database, (tx) =>
      admitAssessmentWriting(tx, { ...input, text: 'Другой ответ.' })
    )
  ).rejects.toThrow();

  return { committedWriting, writingAdmission };
}

interface WritingAdmissionRollbackContext extends WritingAdmissionContext {
  writingSection: { id: string };
  captured: Awaited<
    ReturnType<
      typeof import('@/lib/learning/classes/material/assessment-read').captureAssessmentForEvaluation
    >
  >;
}

export async function checkWritingAdmissionRollback({
  instance,
  admitAssessmentWriting,
  fence,
  heldOutWriting,
  writingCapture,
  execution,
  identity,
  classId,
  selection,
  writingSection,
  captured,
}: WritingAdmissionRollbackContext) {
  await expect(
    sottoTransaction(instance.database, async (tx) => {
      const input = {
        classId,
        assessmentId: fence.assessmentId,
        promptId: heldOutWriting.id,
        text: 'Мой ответ.',
        execution,
        selection,
        expected: writingCapture,
      };
      for (const unsupported of ['codex', 'claude-code']) {
        await expect(
          admitAssessmentWriting(tx, {
            ...input,
            selection: { ...selection, provider: unsupported },
          })
        ).rejects.toThrow('does not support durable execution');
      }
      expect(await tx.writingResponse.count({ where: { promptId: heldOutWriting.id } })).toBe(0);
      const admitted = await admitAssessmentWriting(tx, input);
      expect(admitted.operation.assessment).toMatchObject({
        assessmentId: fence.assessmentId,
        sectionId: writingSection.id,
        materialDigest: captured.scope.reviewedMaterialDigest,
        inputDigest: expect.stringMatching(/^[a-f0-9]{64}$/),
      });
      expect(await sottoJobOutbox(tx).read(admitted.operation.id)).toMatchObject({
        fingerprint: admitted.operation.fingerprint,
        job: {
          handler: 'learning-writing',
          version: 2,
          payload: {
            responseId: admitted.responseId,
            text: input.text,
            assessment: admitted.operation.assessment,
          },
        },
      });
      expect(
        await tx.writingResponse.findUnique({ where: { id: admitted.responseId } })
      ).toMatchObject({
        promptId: heldOutWriting.id,
        assessmentSectionId: writingSection.id,
        userId: identity.ownerId,
        text: input.text,
        overallScore: null,
      });
      expect(await admitAssessmentWriting(tx, input)).toMatchObject({
        responseId: admitted.responseId,
        operation: {
          id: admitted.operation.id,
          fingerprint: admitted.operation.fingerprint,
        },
        replayed: true,
      });
      await expect(
        admitAssessmentWriting(tx, { ...input, text: 'Другой ответ.' })
      ).rejects.toThrow();
      throw new Error('Roll back held-out writing admission');
    })
  ).rejects.toThrow('Roll back held-out writing admission');
}

export async function checkQueuedWritingRollback({
  instance,
  admitAssessmentWriting,
  fence,
  heldOutWriting,
  writingCapture,
  execution,
  identity,
  classId,
  cls,
  selection,
}: WritingAdmissionContext) {
  await expect(
    sottoTransaction(instance.database, async (tx) => {
      const admitted = await admitAssessmentWriting(tx, {
        classId,
        assessmentId: fence.assessmentId,
        promptId: heldOutWriting.id,
        text: 'Мой ответ.',
        execution,
        selection,
        expected: writingCapture,
        queued: true,
      });
      expect(await sottoJobOutbox(tx).read(admitted.operation.id)).toMatchObject({
        job: { handler: 'learning-writing', version: 3 },
      });
      const { readAssessmentWritingRecovery } =
        await import('@/lib/learning/classes/writing/assessment-writing-recovery');
      expect(
        await readAssessmentWritingRecovery(tx, {
          classId,
          assessmentId: fence.assessmentId,
          promptId: heldOutWriting.id,
          execution,
        })
      ).toMatchObject({ status: 'RUNNING', text: 'Мой ответ.' });
      const { inspectPrerequisiteDeletion } =
        await import('@/lib/classes/help/prerequisite-deletion');
      await expect(
        inspectPrerequisiteDeletion(tx, classId, cls.courseId, identity.ownerId)
      ).rejects.toThrow();
      throw new Error('Roll back queued writing admission');
    })
  ).rejects.toThrow('Roll back queued writing admission');
}
