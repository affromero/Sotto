import { randomUUID, timingSafeEqual } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { classAssessmentPrepareSchema, classAssessmentStatusSchema } from '@sotto/shared';
import { isAccessError } from 'thesidedoor-core/access';
import { readRequestBytes, RequestBodyTooLargeError } from 'thesidedoor-core/runtime/request';
import { z } from 'zod';
import { authenticateRequest } from '@/lib/api-keys';
import { errorResponse } from '@/lib/api-response';
import { InitialA1PracticeBlocked } from '@/lib/classes/lesson/initial-a1-provenance';
import { PrerequisiteSourceConflict } from '@/lib/classes/help/content/prerequisite-source';
import {
  AssessmentFenceConflict,
  assessmentFenceBackend,
  assessmentFenceStore,
} from '@/lib/learning/classes/lifecycle/assessment-fence';
import { AssessmentSourceConflict } from '@/lib/learning/classes/material/assessment-source';
import { readAssessmentStatus } from '@/lib/learning/classes/lifecycle/assessment-status';
import {
  admitLearnerAssessmentWork,
  AssessmentSpeakingPolicyUnavailable,
} from '@/lib/learning/classes/generation/assessment-admission';
import { captureAssessmentProviderPolicy } from '@/lib/learning/classes/provider/assessment-provider-policy';
import { reconcileFailedAssessmentDelivery } from '@/lib/learning/classes/lifecycle/assessment-unresolved';
import { prismaUnfiltered as prisma } from '@/lib/prisma';
import { accessOperation } from '@/lib/sidedoor/access/core/http';
import { sottoTransaction } from '@/lib/sidedoor/access/state/transaction';
import { sottoRequestExecution } from '@/lib/sidedoor/credentials/runtime/provider-execution';
import { sottoJobExecutions } from '@/lib/sidedoor/jobs/core/job-execution-lifetime';
import {
  deliverSottoJob,
  sottoJobOutbox,
  SottoTerminalDeliveryError,
} from '@/lib/sidedoor/jobs/core/job-delivery';
import { interactionQueue } from '@/lib/queue';

type Params = { params: Promise<{ classId: string }> };

function failure(error: unknown) {
  if (isAccessError(error)) throw error;
  if (error instanceof AssessmentSpeakingPolicyUnavailable)
    return errorResponse(error.message, 409);
  const conflict =
    error instanceof InitialA1PracticeBlocked ||
    error instanceof PrerequisiteSourceConflict ||
    error instanceof AssessmentFenceConflict ||
    error instanceof AssessmentSourceConflict ||
    error instanceof SottoTerminalDeliveryError;
  const invalid = error instanceof z.ZodError || error instanceof SyntaxError;
  const status = conflict
    ? 409
    : error instanceof RequestBodyTooLargeError
      ? 413
      : invalid
        ? 400
        : 500;
  return errorResponse(
    conflict
      ? 'Assessment is unavailable for this class.'
      : status === 413
        ? 'Assessment request is too large.'
        : invalid
          ? 'Invalid assessment request.'
          : 'Assessment status is unavailable.',
    status
  );
}

/** Read owned status and recover a settled delivery within the same transaction. */
export function GET(request: NextRequest, params: Params) {
  return accessOperation(request, false, async () => {
    try {
      const identity = await authenticateRequest(request);
      if (!identity) return errorResponse('Unauthorized', 401);
      const { classId } = await params.params;
      const execution = sottoRequestExecution(request, identity);
      const status = await sottoTransaction(
        prisma,
        (database) => readAssessmentStatus(database, classId, execution),
        { signal: request.signal }
      );
      return NextResponse.json(classAssessmentStatusSchema.parse(status));
    } catch (error) {
      return failure(error);
    }
  });
}

/** Admit once, then deliver the immutable job after its database transaction commits. */
export function POST(request: NextRequest, params: Params) {
  return accessOperation(request, !request.headers.has('authorization'), async () => {
    try {
      const identity = await authenticateRequest(request);
      if (!identity) return errorResponse('Unauthorized', 401);
      const input = classAssessmentPrepareSchema.parse(
        JSON.parse(Buffer.from(await readRequestBytes(request, 4096)).toString('utf8'))
      );
      const { classId } = await params.params;
      const execution = sottoRequestExecution(request, identity);
      const inspect = (database: Parameters<typeof readAssessmentStatus>[0]) =>
        readAssessmentStatus(database, classId, execution);
      const initial = await sottoTransaction(prisma, inspect, { signal: request.signal });
      if (
        initial.classAttempt !== input.classAttempt ||
        initial.status === 'PRACTICE_REQUIRED' ||
        initial.status === 'UNRESOLVED'
      )
        throw new AssessmentFenceConflict();
      if (
        !timingSafeEqual(Buffer.from(input.revision, 'hex'), Buffer.from(initial.revision, 'hex'))
      )
        throw new AssessmentFenceConflict();
      const policy =
        initial.status === 'AVAILABLE' ? await captureAssessmentProviderPolicy(execution) : null;
      const prepared = {
        id: randomUUID(),
        revision: randomUUID(),
        assessmentId: randomUUID(),
        expiresAt: Date.now() + 45 * 60_000,
      };
      const admitted = await sottoTransaction(
        prisma,
        async (database) => {
          const current = await inspect(database);
          if (
            current.classAttempt !== input.classAttempt ||
            current.status === 'PRACTICE_REQUIRED' ||
            current.status === 'UNRESOLVED'
          )
            throw new AssessmentFenceConflict();
          if (current.status === 'AVAILABLE') {
            if (
              !policy ||
              !timingSafeEqual(
                Buffer.from(input.revision, 'hex'),
                Buffer.from(current.revision, 'hex')
              )
            )
              throw new AssessmentFenceConflict();
            const record = await admitLearnerAssessmentWork(database, {
              ...prepared,
              classId,
              classAttempt: current.classAttempt,
              assessmentAttempt:
                (await database.classAssessment.count({
                  where: { classId, classAttempt: current.classAttempt },
                })) + 1,
              selection: policy.selection,
              cliBinding: policy.cliBinding,
              execution,
            });
            return {
              status: {
                status: 'PENDING' as const,
                classAttempt: current.classAttempt,
                revision: current.revision,
              },
              deliver: { id: record.job.id, fingerprint: record.fingerprint },
            };
          }
          const fence = (
            await assessmentFenceStore(assessmentFenceBackend(database, classId)).read()
          ).current;
          if (
            !fence ||
            !timingSafeEqual(
              Buffer.from(input.revision, 'hex'),
              Buffer.from(current.revision, 'hex')
            )
          )
            throw new AssessmentFenceConflict();
          if (current.status === 'READY') return { status: current, deliver: null };
          if (fence.status === 'COMPLETED') return { status: current, deliver: null };
          const record = await sottoJobOutbox(database).read(fence.id);
          if (!record || record.complete) throw new AssessmentFenceConflict();
          const blocking = await sottoJobExecutions(database).blockingStatus(
            fence.id,
            record.fingerprint
          );
          return {
            status: current,
            deliver: blocking ? null : { id: fence.id, fingerprint: record.fingerprint },
          };
        },
        { signal: request.signal }
      );
      let status: Awaited<ReturnType<typeof readAssessmentStatus>> = admitted.status;
      if (admitted.deliver) {
        request.signal.throwIfAborted();
        let delivered: Awaited<ReturnType<typeof deliverSottoJob>>;
        try {
          delivered = await deliverSottoJob({
            database: prisma,
            queue: interactionQueue,
            operationId: admitted.deliver.id,
            fingerprint: admitted.deliver.fingerprint,
            version: 6,
          });
        } catch (error) {
          if (error instanceof SottoTerminalDeliveryError && error.observation.state === 'failed')
            await reconcileFailedAssessmentDelivery({
              database: prisma,
              queue: interactionQueue,
              identity: { id: admitted.deliver.id, fingerprint: admitted.deliver.fingerprint },
              signal: request.signal,
            });
          throw error;
        }
        if (delivered === 'erased') throw new AssessmentFenceConflict();
        if (delivered === 'complete')
          status = await sottoTransaction(prisma, inspect, { signal: request.signal });
      }
      return NextResponse.json(classAssessmentStatusSchema.parse(status), {
        status: status.status === 'PENDING' ? 202 : 200,
      });
    } catch (error) {
      return failure(error);
    }
  });
}
