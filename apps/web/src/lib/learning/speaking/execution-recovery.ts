import { lstat } from 'node:fs/promises';
import { isDeepStrictEqual } from 'node:util';
import { randomUUID } from 'node:crypto';
import type { Prisma } from '@/generated/prisma/client';
import type { JobExecutionBinding } from 'thesidedoor-core/runtime/outbox';
import {
  LocalStorageCleanup,
  openExecutionLocation,
  recoverExecutionWorkspace,
  removeExecutionWorkspace,
} from 'thesidedoor-core/storage';
import { prismaUnfiltered } from '@/lib/prisma';
import { sottoTransaction } from '@/lib/sidedoor/access/state/transaction';
import { sottoJobOutbox } from '@/lib/sidedoor/jobs/core/job-delivery';
import {
  resolveSottoExecutionDirectory,
  sottoJobExecutions,
} from '@/lib/sidedoor/jobs/core/job-execution-lifetime';
import {
  classSpeakingGradingPayloadSchema,
  speakingGradingPayloadSchema,
} from '@/lib/sidedoor/jobs/stitch/speaking-grading-work';
import { captureSpeakingRecordingStorage } from '@/lib/sidedoor/storage/core/speaking-storage';
import { capturePrerequisiteOwnership } from '@/lib/classes/help/lifecycle/prerequisite-ownership';
import { learningPreparationGrant } from '@/lib/learning/preparation/preparation-grant';
import { reconcileIsolatedAgentWorkspace } from '@/lib/agents/isolated/isolated-agent-journal';
import { SIDEDOOR_STATE_ID } from '@/lib/sidedoor/access/state/store';

export function speakingCleanupReceiptId(executionId: string) {
  return `${SIDEDOOR_STATE_ID}:speaking-cleanup:${executionId}`;
}

/** Operator-only. Stop the exact original supervisor and its local I/O before calling. */
export async function recoverSpeakingExecution(input: {
  binding: JobExecutionBinding;
  supervisorStopped: true;
}) {
  if (input.supervisorStopped !== true)
    throw new Error('Stop the original supervisor before recovery');
  const binding = structuredClone(input.binding);
  const execution = await sottoTransaction(prismaUnfiltered, async (database) => {
    const journal = sottoJobExecutions(database);
    const current = await journal.read(binding);
    const outbox = sottoJobOutbox(database);
    const work = await outbox.read(binding.parentId);
    if (
      !work ||
      work.fingerprint !== binding.fingerprint ||
      work.job.handler !== 'speaking-grading' ||
      ![1, 2].includes(work.job.version)
    )
      throw new Error('Speaking execution parent changed');
    const payload =
      work.job.version === 2
        ? classSpeakingGradingPayloadSchema.parse(work.job.payload)
        : speakingGradingPayloadSchema.parse(work.job.payload);
    const parent = payload.ownership.associations.parents.find(
      (candidate) => candidate.kind === 'class'
    );
    if (!parent) throw new Error('Speaking recovery requires an owned class recording');
    await database.$queryRaw`SELECT id FROM "CourseClass" WHERE id = ${parent.parentId} FOR UPDATE`;
    const recording = await database.speakingRecording.findUnique({
      where: { id: payload.recordingId },
    });
    if (
      !recording ||
      recording.createdAt.getTime() !== payload.recordingCreatedAt ||
      recording.userId !== payload.ownership.associations.userId ||
      recording.sectionId !== parent.id ||
      !isDeepStrictEqual(
        await captureSpeakingRecordingStorage(database, recording.id),
        payload.ownership
      )
    )
      throw new Error('Speaking recovery recording changed');
    const ownership = await capturePrerequisiteOwnership(
      database,
      parent.parentId,
      parent.courseId,
      recording.userId
    );
    const requiredScopes = ownership.scopes.filter(
      (scope) => work.job.version === 2 || scope.subjectId !== `class:${parent.parentId}`
    );
    if (
      !requiredScopes.every((scope) =>
        work.job.scopes.some((candidate) => isDeepStrictEqual(scope, candidate))
      )
    )
      throw new Error('Speaking recovery scope changed');
    if (work.job.version === 2) {
      const classPayload = classSpeakingGradingPayloadSchema.parse(work.job.payload);
      if (
        !work.complete ||
        recording.status !== 'UNRESOLVED' ||
        recording.gradingOperationId !== binding.parentId ||
        classPayload.classAuthorization.classId !== parent.parentId ||
        classPayload.grant.id !== binding.parentId
      )
        throw new Error('Speaking grading is not ready for operator recovery');
      const grant = await learningPreparationGrant(
        database,
        {
          id: binding.parentId,
          userId: recording.userId,
          courseId: parent.courseId,
        },
        'speaking'
      ).read(classPayload.grant);
      if (grant.status !== 'revoked') throw new Error('Speaking grading authority is not revoked');
    } else {
      if (
        !['PENDING', 'GRADING', 'UNRESOLVED'].includes(recording.status) ||
        (recording.gradingOperationId !== null && recording.gradingOperationId !== binding.parentId)
      )
        throw new Error('Legacy speaking recording changed');
      await database.speakingRecording.update({
        where: { id: recording.id },
        data: {
          status: 'UNRESOLVED',
          gradingOperationId: binding.parentId,
          feedback: 'The grading outcome is unknown. Your recording is saved.',
        },
      });
      if (!work.complete && !(await outbox.complete(binding.parentId, binding.fingerprint)))
        throw new Error('Legacy speaking work changed');
    }
    return current;
  });
  if (execution.status === 'settled') return { executionId: execution.id, containers: 0 };
  let containers = 0;
  if (execution.workspace) {
    const location = await openExecutionLocation(resolveSottoExecutionDirectory());
    if (execution.workspace.locationId !== location.locationId)
      throw new Error('Execution belongs to another workspace location');
    const workspace =
      'directory' in execution.workspace
        ? execution.workspace
        : await recoverExecutionWorkspace(execution.workspace, location.locationId);
    if (workspace) {
      const receiptId = speakingCleanupReceiptId(binding.id);
      const expected = { binding, workspace: execution.workspace, directory: workspace.directory };
      const receipt = await sottoTransaction(prismaUnfiltered, (database) =>
        database.sidedoorState.findUnique({ where: { id: receiptId } })
      );
      if (receipt && !isDeepStrictEqual(receipt.state, expected))
        throw new Error('Speaking cleanup receipt changed');
      let missing = false;
      try {
        await lstat(workspace.directory.root);
      } catch (error) {
        if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
        missing = true;
      }
      if (missing && !receipt) throw new Error('The attached speaking workspace is missing');
      if (!missing) {
        await LocalStorageCleanup.restore(workspace.directory);
        containers = await reconcileIsolatedAgentWorkspace(workspace.directory.root);
        await sottoTransaction(prismaUnfiltered, async (database) => {
          const latest = await sottoJobExecutions(database).read(binding);
          if (!isDeepStrictEqual(latest.workspace, execution.workspace))
            throw new Error('Speaking workspace identity changed');
          const existing = await database.sidedoorState.findUnique({ where: { id: receiptId } });
          if (existing && !isDeepStrictEqual(existing.state, expected))
            throw new Error('Speaking cleanup receipt changed');
          if (!existing)
            await database.sidedoorState.create({
              data: {
                id: receiptId,
                revision: randomUUID(),
                state: expected as Prisma.InputJsonValue,
              },
            });
        });
      }
      await removeExecutionWorkspace(workspace, location.locationId);
    }
    await sottoTransaction(prismaUnfiltered, async (database) => {
      const journal = sottoJobExecutions(database);
      const latest = await journal.read(binding);
      if (latest.workspace) {
        if (!isDeepStrictEqual(latest.workspace, execution.workspace))
          throw new Error('Speaking workspace identity changed');
        await journal.releaseWorkspace(binding, latest.workspace);
        await database.sidedoorState.deleteMany({
          where: { id: speakingCleanupReceiptId(binding.id) },
        });
      }
    });
  }
  await sottoTransaction(prismaUnfiltered, (database) =>
    sottoJobExecutions(database).settle(binding)
  );
  return { executionId: execution.id, containers };
}
