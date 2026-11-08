import { NextRequest, NextResponse } from 'next/server';
import { isAccessError } from 'thesidedoor-core/access';
import { readRequestBytes, RequestBodyTooLargeError } from 'thesidedoor-core/runtime/request';
import { z } from 'zod';
import { classAssessmentSpeakingStatusSchema } from '@sotto/shared';
import { authenticateRequest } from '@/lib/api-keys';
import { errorResponse } from '@/lib/api-response';
import { detectAudioFormat, isRecognizedAudio } from '@/lib/audio-format';
import { InitialA1PracticeBlocked } from '@/lib/classes/lesson/initial-a1-provenance';
import { PrerequisiteSourceConflict } from '@/lib/classes/help/content/prerequisite-source';
import { AssessmentFenceConflict } from '@/lib/learning/classes/lifecycle/assessment-fence';
import { AssessmentSourceConflict } from '@/lib/learning/classes/material/assessment-source';
import { readAssessmentSpeakingStatus } from '@/lib/learning/classes/speaking/lifecycle/assessment-speaking-recovery';
import { admitAssessmentSpeaking } from '@/lib/learning/classes/speaking/assessment-speaking-admission';
import { LearningIncompleteError } from '@/lib/learning/session-evaluation';
import { prismaUnfiltered } from '@/lib/prisma';
import { accessOperation } from '@/lib/sidedoor/access/core/http';
import { sottoTransaction } from '@/lib/sidedoor/access/state/transaction';
import { sottoRequestExecution } from '@/lib/sidedoor/credentials/runtime/provider-execution';
import { deliverSottoJob } from '@/lib/sidedoor/jobs/core/job-delivery';
import { speakingGradingQueue } from '@/lib/queue';

type Params = { params: Promise<{ classId: string; assessmentId: string; promptId: string }> };
const MAX_AUDIO_BYTES = 64 * 1024 * 1024;

/** Save one recording and queue its private assessment without revealing its grade. */
export function POST(request: NextRequest, params: Params) {
  return accessOperation(request, !request.headers.has('authorization'), async () => {
    let admitted = false;
    try {
      const admission = await authenticateRequest(request);
      if (!admission) return errorResponse('Unauthorized', 401);
      const bytes = await readRequestBytes(request, MAX_AUDIO_BYTES + 64 * 1024);
      const headers = new Headers(request.headers);
      headers.delete('content-length');
      let form: FormData;
      try {
        form = await new Request(request.url, {
          method: 'POST',
          headers,
          body: Uint8Array.from(bytes).buffer,
          signal: request.signal,
        }).formData();
      } catch {
        return errorResponse('Invalid multipart upload.', 400);
      }
      const audio = form.getAll('audio');
      const ids = form.getAll('requestId');
      const id = ids.length === 1 ? z.uuid().safeParse(ids[0]) : null;
      if (audio.length !== 1 || typeof audio[0] === 'string' || !audio[0] || !id?.success)
        return errorResponse('A recording and request ID are required.', 400);
      if (audio[0].size > MAX_AUDIO_BYTES) return errorResponse('Audio upload is too large.', 413);
      const buffer = Buffer.from(await audio[0].arrayBuffer());
      if (!isRecognizedAudio(buffer)) return errorResponse('Unrecognized or empty audio.', 400);
      const format = detectAudioFormat(buffer);
      const idsForTask = await params.params;
      const saved = await admitAssessmentSpeaking({
        request,
        admission,
        ...idsForTask,
        requestId: id.data,
        audio: buffer,
        extension: format.ext,
        contentType: format.mime,
      });
      admitted = true;
      if (saved.status === 'PENDING' || saved.status === 'GRADING') {
        try {
          request.signal.throwIfAborted();
          const delivered = await deliverSottoJob({
            database: prismaUnfiltered,
            queue: speakingGradingQueue,
            operationId: saved.operationId,
            fingerprint: saved.fingerprint,
            version: 3,
          });
          if (delivered === 'erased')
            return errorResponse('Speaking assessment is unavailable.', 409);
        } catch {
          return errorResponse(
            'Could not confirm whether your recording was saved. Check its status before trying again.',
            503
          );
        }
      }
      const status = await sottoTransaction(
        prismaUnfiltered,
        (database) =>
          readAssessmentSpeakingStatus(database, {
            ...idsForTask,
            execution: sottoRequestExecution(request, admission),
          }),
        { signal: request.signal }
      );
      return NextResponse.json(classAssessmentSpeakingStatusSchema.parse(status), {
        status: status.status === 'RUNNING' ? 202 : 200,
      });
    } catch (error) {
      if (admitted)
        return errorResponse(
          'Could not confirm whether your recording was saved. Check its status before trying again.',
          503
        );
      if (isAccessError(error)) throw error;
      if (error instanceof RequestBodyTooLargeError)
        return errorResponse('Audio upload is too large.', 413);
      if (
        error instanceof InitialA1PracticeBlocked ||
        error instanceof PrerequisiteSourceConflict ||
        error instanceof AssessmentFenceConflict ||
        error instanceof AssessmentSourceConflict ||
        error instanceof LearningIncompleteError
      )
        return errorResponse('Speaking assessment is unavailable for this class.', 409);
      return errorResponse(
        'Could not confirm whether your recording was saved. Check its status before trying again.',
        503
      );
    }
  });
}

/** Read the retained response status without returning assessment feedback. */
export function GET(request: NextRequest, params: Params) {
  return accessOperation(request, false, async () => {
    try {
      const identity = await authenticateRequest(request);
      if (!identity) return errorResponse('Unauthorized', 401);
      const ids = await params.params;
      const status = await sottoTransaction(
        prismaUnfiltered,
        (database) =>
          readAssessmentSpeakingStatus(database, {
            ...ids,
            execution: sottoRequestExecution(request, identity),
          }),
        { signal: request.signal }
      );
      return NextResponse.json(classAssessmentSpeakingStatusSchema.parse(status));
    } catch (error) {
      if (isAccessError(error)) throw error;
      const conflict =
        error instanceof InitialA1PracticeBlocked ||
        error instanceof PrerequisiteSourceConflict ||
        error instanceof AssessmentFenceConflict ||
        error instanceof AssessmentSourceConflict ||
        error instanceof LearningIncompleteError;
      return errorResponse('Speaking status is unavailable.', conflict ? 409 : 500);
    }
  });
}
