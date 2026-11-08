import { isDeepStrictEqual } from 'node:util';
import { randomUUID } from 'node:crypto';
import { JobOutbox } from 'thesidedoor-core/runtime/outbox';
import type { Queue } from 'bullmq';
import type { PrismaClient } from '@/generated/prisma/client';
import { capturePrerequisiteOwnership } from '@/lib/classes/help/lifecycle/prerequisite-ownership';
import { learningPreparationGrant } from '@/lib/learning/preparation/preparation-grant';
import { SIDEDOOR_STATE_ID } from '@/lib/sidedoor/access/state/store';
import { sottoTransaction } from '@/lib/sidedoor/access/state/transaction';
import { snapshotFailedSottoDelivery, sottoJobOutbox } from '@/lib/sidedoor/jobs/core/job-delivery';
import { sottoJobExecutions } from '@/lib/sidedoor/jobs/core/job-execution-lifetime';
import { assessmentSpeakingGradingPayloadSchema } from '@/lib/sidedoor/jobs/stitch/speaking-grading-work';
import { captureSpeakingRecordingStorage } from '@/lib/sidedoor/storage/core/speaking-storage';
import { AssessmentFenceConflict } from '../../lifecycle/assessment-fence';
import { fenceAssessmentStorageInputs } from '../../lifecycle/assessment-storage-fence';
import { observeExecutionGate } from '../../lifecycle/assessment-unresolved';
import {
  assessmentSpeakingPrelaunchReceiptId,
  assessmentSpeakingPrelaunchReceiptSchema,
} from './assessment-speaking-prelaunch-receipt';

/** Reconcile a verified terminal queue failure that never launched provider work. */
export async function reconcileFailedAssessmentSpeakingPrelaunch(input: {
  database: PrismaClient;
  queue: Queue;
  identity: { id: string; fingerprint: string };
  signal: AbortSignal;
}) {
  if (input.queue.name !== 'speaking-grading') throw new AssessmentFenceConflict();
  const observed = await sottoTransaction(
    input.database,
    async (database) => ({
      record: await sottoJobOutbox(database).read(input.identity.id),
      gate: await observeExecutionGate(database, input.identity),
    }),
    { signal: input.signal }
  );
  const record = observed.record;
  if (
    !record ||
    record.complete ||
    record.fingerprint !== input.identity.fingerprint ||
    record.job.id !== input.identity.id ||
    record.job.namespace !== SIDEDOOR_STATE_ID ||
    record.job.handler !== 'speaking-grading' ||
    record.job.version !== 3
  )
    throw new AssessmentFenceConflict();
  if (observed.gate.blocking) return false;
  const observation = await snapshotFailedSottoDelivery(input.queue, record);
  return sottoTransaction(
    input.database,
    async (database) => {
      const payload = assessmentSpeakingGradingPayloadSchema.parse(record.job.payload);
      const assessment = payload.assessment;
      if (assessment.operationId !== input.identity.id) throw new AssessmentFenceConflict();
      await database.$queryRaw`SELECT id FROM "CourseClass" WHERE id = ${assessment.classId} FOR UPDATE`;
      const touched =
        await database.$executeRaw`UPDATE "ClassAssessment" SET "updatedAt" = "updatedAt" WHERE id = ${assessment.assessmentId}`;
      if (touched !== 1) throw new AssessmentFenceConflict();
      const gate = await observeExecutionGate(database, input.identity);
      if (gate.blocking || gate.revision !== observed.gate.revision || gate.revision !== null)
        return false;
      await sottoJobExecutions(database).requireParentDrained(
        input.identity.id,
        input.identity.fingerprint
      );
      const claimId = `${SIDEDOOR_STATE_ID}:assessment-speaking-launch:${input.identity.id}`;
      if (await database.sidedoorState.findUnique({ where: { id: claimId } })) return false;
      const lockedOutbox = new JobOutbox(
        {
          query: (sql, values) => {
            if (!sql.startsWith('SELECT ')) throw new Error('Expected an outbox read');
            return database.$queryRawUnsafe<Record<string, unknown>[]>(
              `${sql} FOR UPDATE`,
              ...values
            );
          },
        },
        'postgres',
        SIDEDOOR_STATE_ID
      );
      if (!isDeepStrictEqual(await lockedOutbox.read(input.identity.id), record))
        throw new AssessmentFenceConflict();
      const recording = await database.speakingRecording.findUnique({
        where: { id: payload.recordingId },
      });
      if (
        !recording ||
        recording.status !== 'PENDING' ||
        recording.gradingOperationId !== input.identity.id ||
        recording.userId !== assessment.userId ||
        recording.promptId !== assessment.promptId ||
        recording.assessmentSectionId !== assessment.sectionId ||
        recording.attempt !== assessment.assessmentAttempt ||
        recording.createdAt.getTime() !== payload.recordingCreatedAt ||
        recording.sectionId !== null ||
        recording.practiceSessionId !== null ||
        recording.examSectionId !== null ||
        !isDeepStrictEqual(recording.sttSelection, assessment.selection)
      )
        throw new AssessmentFenceConflict();
      const ownership = await capturePrerequisiteOwnership(
        database,
        assessment.classId,
        assessment.courseId,
        assessment.userId
      );
      if (
        !isDeepStrictEqual(ownership.scopes, record.job.scopes) ||
        !isDeepStrictEqual(
          await captureSpeakingRecordingStorage(database, recording.id),
          payload.ownership
        )
      )
        throw new AssessmentFenceConflict();
      await fenceAssessmentStorageInputs(database, [payload.storage]);
      const authority = learningPreparationGrant(
        database,
        { id: input.identity.id, userId: assessment.userId, courseId: assessment.courseId },
        'speaking'
      );
      const grant = await authority.read(payload.grant);
      if (grant.status !== 'active' || grant.attempts.length !== 0)
        throw new AssessmentFenceConflict();
      const receiptId = assessmentSpeakingPrelaunchReceiptId(input.identity.id);
      if (await database.sidedoorState.findUnique({ where: { id: receiptId } }))
        throw new AssessmentFenceConflict();
      const receipt = assessmentSpeakingPrelaunchReceiptSchema.parse({
        version: 1,
        ...observation,
        recordingId: recording.id,
        assessmentId: assessment.assessmentId,
        classId: assessment.classId,
        courseId: assessment.courseId,
        userId: assessment.userId,
      });
      await database.sidedoorState.create({
        data: { id: receiptId, revision: randomUUID(), state: receipt },
      });
      await authority.revoke(payload.grant);
      await database.speakingRecording.update({
        where: { id: recording.id },
        data: { status: 'FAILED', feedback: 'Grading could not start. Your recording is saved.' },
      });
      if (!(await sottoJobOutbox(database).complete(input.identity.id, input.identity.fingerprint)))
        throw new AssessmentFenceConflict();
      return true;
    },
    { signal: input.signal }
  );
}
