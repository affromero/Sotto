import { NextRequest, NextResponse } from 'next/server';
import {
  classAssessmentWritingRequestSchema,
  classAssessmentWritingStatusSchema,
} from '@sotto/shared';
import { isAccessError } from 'thesidedoor-core/access';
import { readRequestBytes, RequestBodyTooLargeError } from 'thesidedoor-core/runtime/request';
import { z } from 'zod';
import { authenticateRequest } from '@/lib/api-keys';
import { errorResponse } from '@/lib/api-response';
import { InitialA1PracticeBlocked } from '@/lib/classes/lesson/initial-a1-provenance';
import { PrerequisiteSourceConflict } from '@/lib/classes/help/content/prerequisite-source';
import { AssessmentFenceConflict } from '@/lib/learning/classes/lifecycle/assessment-fence';
import { AssessmentSourceConflict } from '@/lib/learning/classes/material/assessment-source';
import { captureAssessmentWritingTask } from '@/lib/learning/classes/writing/assessment-writing-read';
import { admitAssessmentWriting } from '@/lib/learning/classes/writing/assessment-writing-admission';
import { readAssessmentWritingRecovery } from '@/lib/learning/classes/writing/assessment-writing-recovery';
import { captureLearningModerationCredential, resolveCapturedLearningAi } from '@/lib/learning-ai';
import { learningCredentialFingerprint } from '@/lib/classes/preparation-selection';
import { LearningIncompleteError } from '@/lib/learning/session-evaluation';
import { prismaUnfiltered } from '@/lib/prisma';
import { accessOperation } from '@/lib/sidedoor/access/core/http';
import { sottoTransaction } from '@/lib/sidedoor/access/state/transaction';
import { sottoRequestExecution } from '@/lib/sidedoor/credentials/runtime/provider-execution';
import { validateSottoExecutionCredential } from '@/lib/sidedoor/credentials/runtime/credential-execution';
import { deliverSottoJob, sottoJobOutbox } from '@/lib/sidedoor/jobs/core/job-delivery';
import { learningWritingQueue } from '@/lib/queue';

type Params = { params: Promise<{ classId: string; assessmentId: string; promptId: string }> };

/** Save one held-out response and queue grading without returning its private feedback. */
export function POST(request: NextRequest, params: Params) {
  return accessOperation(request, !request.headers.has('authorization'), async () => {
    try {
      const identity = await authenticateRequest(request);
      if (!identity) return errorResponse('Unauthorized', 401);
      const { text } = classAssessmentWritingRequestSchema.parse(
        JSON.parse(Buffer.from(await readRequestBytes(request, 32_768)).toString('utf8'))
      );
      const { classId, assessmentId, promptId } = await params.params;
      const execution = sottoRequestExecution(request, identity);
      const input = { classId, assessmentId, promptId, execution };
      const inspect = async (database: Parameters<typeof readAssessmentWritingRecovery>[0]) => {
        const saved = await readAssessmentWritingRecovery(database, input);
        if (!saved) return null;
        if (saved.text !== text) throw new AssessmentFenceConflict();
        const record = await sottoJobOutbox(database).read(saved.operationId);
        if (!record) throw new AssessmentFenceConflict();
        return {
          status: { status: saved.status, text: saved.text },
          delivery:
            saved.status === 'RUNNING' && !record.complete && record.job.version === 3
              ? { id: saved.operationId, fingerprint: record.fingerprint }
              : null,
        };
      };
      const initial = await sottoTransaction(
        prismaUnfiltered,
        async (database) => {
          const saved = await inspect(database);
          if (saved) return { saved, captured: null };
          return { saved: null, captured: await captureAssessmentWritingTask(database, input) };
        },
        { signal: request.signal }
      );
      let result = initial.saved;
      if (!result) {
        if (!initial.captured) throw new AssessmentFenceConflict();
        const ai = await resolveCapturedLearningAi(identity.userId, execution);
        if (['codex', 'claude-code'].includes(ai.provider))
          return errorResponse('The selected AI provider cannot grade this assessment.', 422);
        const moderation = await captureLearningModerationCredential(execution);
        const selection = {
          provider: ai.provider,
          model: ai.model,
          ...(ai.endpoint ? { endpoint: ai.endpoint } : {}),
          ...(ai.isolatedImage ? { isolatedImage: ai.isolatedImage } : {}),
          credentialFingerprint: learningCredentialFingerprint(ai.execution.credential),
          moderationCredentialFingerprint: learningCredentialFingerprint(moderation),
        };
        result = await sottoTransaction(
          prismaUnfiltered,
          async (database) => {
            const saved = await inspect(database);
            if (saved) return saved;
            if (ai.execution.credential)
              await validateSottoExecutionCredential(
                database,
                execution.authorize,
                ai.execution.credential,
                request.signal
              );
            if (moderation)
              await validateSottoExecutionCredential(
                database,
                execution.authorize,
                moderation,
                request.signal
              );
            const admitted = await admitAssessmentWriting(database, {
              ...input,
              text,
              selection,
              expected: initial.captured!,
              queued: true,
            });
            return {
              status: { status: 'RUNNING' as const, text },
              delivery: { id: admitted.operation.id, fingerprint: admitted.operation.fingerprint },
            };
          },
          { signal: request.signal }
        );
      }
      if (result.delivery) {
        try {
          request.signal.throwIfAborted();
          const delivered = await deliverSottoJob({
            database: prismaUnfiltered,
            queue: learningWritingQueue,
            operationId: result.delivery.id,
            fingerprint: result.delivery.fingerprint,
            version: 3,
          });
          if (delivered === 'erased')
            return errorResponse('Assessment writing is unavailable for this class.', 409);
        } catch {
          return errorResponse(
            'Could not confirm whether your response was saved. Check its status before trying again.',
            503
          );
        }
      }
      return NextResponse.json(classAssessmentWritingStatusSchema.parse(result.status), {
        status: result.status.status === 'RUNNING' ? 202 : 200,
      });
    } catch (error) {
      if (isAccessError(error)) throw error;
      if (error instanceof RequestBodyTooLargeError)
        return errorResponse('Writing response is too large.', 413);
      if (error instanceof SyntaxError || error instanceof z.ZodError)
        return errorResponse('Invalid writing response.', 400);
      const conflict =
        error instanceof InitialA1PracticeBlocked ||
        error instanceof PrerequisiteSourceConflict ||
        error instanceof AssessmentFenceConflict ||
        error instanceof AssessmentSourceConflict ||
        error instanceof LearningIncompleteError;
      return errorResponse(
        conflict
          ? 'Assessment writing is unavailable for this class.'
          : 'Could not save writing response.',
        conflict ? 409 : 500
      );
    }
  });
}

/** Read the learner's retained response without disclosing its private grade. */
export function GET(request: NextRequest, params: Params) {
  return accessOperation(request, false, async () => {
    try {
      const identity = await authenticateRequest(request);
      if (!identity) return errorResponse('Unauthorized', 401);
      const { classId, assessmentId, promptId } = await params.params;
      const execution = sottoRequestExecution(request, identity);
      const status = await sottoTransaction(
        prismaUnfiltered,
        async (database) => {
          const input = { classId, assessmentId, promptId, execution };
          const recovery = await readAssessmentWritingRecovery(database, input);
          if (recovery) return { status: recovery.status, text: recovery.text };
          await captureAssessmentWritingTask(database, input);
          return { status: 'NOT_STARTED' as const };
        },
        { signal: request.signal }
      );
      return NextResponse.json(classAssessmentWritingStatusSchema.parse(status));
    } catch (error) {
      if (isAccessError(error)) throw error;
      const conflict =
        error instanceof InitialA1PracticeBlocked ||
        error instanceof PrerequisiteSourceConflict ||
        error instanceof AssessmentFenceConflict ||
        error instanceof AssessmentSourceConflict ||
        error instanceof LearningIncompleteError;
      return errorResponse(
        conflict
          ? 'Assessment writing is unavailable for this class.'
          : 'Writing status is unavailable.',
        conflict ? 409 : 500
      );
    }
  });
}
