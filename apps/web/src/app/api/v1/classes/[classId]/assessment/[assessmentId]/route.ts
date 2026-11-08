import { NextRequest, NextResponse } from 'next/server';
import {
  classAssessmentMaterialSchema,
  classAssessmentSubmitSchema,
  classReceiptSchema,
} from '@sotto/shared';
import { isAccessError } from 'thesidedoor-core/access';
import { readRequestBytes, RequestBodyTooLargeError } from 'thesidedoor-core/runtime/request';
import { authenticateRequest } from '@/lib/api-keys';
import { errorResponse } from '@/lib/api-response';
import { InitialA1PracticeBlocked } from '@/lib/classes/lesson/initial-a1-provenance';
import { PrerequisiteSourceConflict } from '@/lib/classes/help/content/prerequisite-source';
import { AssessmentFenceConflict } from '@/lib/learning/classes/lifecycle/assessment-fence';
import { AssessmentSourceConflict } from '@/lib/learning/classes/material/assessment-source';
import { readAssessmentStatus } from '@/lib/learning/classes/lifecycle/assessment-status';
import { readPublicAssessment } from '@/lib/learning/classes/material/assessment-read';
import {
  AssessmentSpeakingUnavailable,
  submitAssessment,
} from '@/lib/learning/classes/lifecycle/assessment-submission';
import { LearningIncompleteError } from '@/lib/learning/session-evaluation';
import { prismaUnfiltered as prisma } from '@/lib/prisma';
import { accessOperation } from '@/lib/sidedoor/access/core/http';
import { sottoTransaction } from '@/lib/sidedoor/access/state/transaction';
import { sottoRequestExecution } from '@/lib/sidedoor/credentials/runtime/provider-execution';

type Params = { params: Promise<{ classId: string; assessmentId: string }> };

/** Read the reviewed learner projection only after practice and delivery settle. */
export function GET(request: NextRequest, params: Params) {
  return accessOperation(request, false, async () => {
    try {
      const identity = await authenticateRequest(request);
      if (!identity) return errorResponse('Unauthorized', 401);
      const { classId, assessmentId } = await params.params;
      const execution = sottoRequestExecution(request, identity);
      const material = await sottoTransaction(
        prisma,
        async (database) => {
          const status = await readAssessmentStatus(database, classId, execution);
          if (status.status !== 'READY' || status.assessmentId !== assessmentId)
            throw new AssessmentFenceConflict();
          return classAssessmentMaterialSchema.parse(
            await readPublicAssessment(database, { classId, assessmentId, execution })
          );
        },
        { signal: request.signal }
      );
      return NextResponse.json(material);
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
          ? 'Assessment is unavailable for this class.'
          : 'Assessment material is unavailable.',
        conflict ? 409 : 500
      );
    }
  });
}

/** Commit owned assessment work, or replay the same previously committed request. */
export function POST(request: NextRequest, params: Params) {
  return accessOperation(request, !request.headers.has('authorization'), async () => {
    try {
      const identity = await authenticateRequest(request);
      if (!identity) return errorResponse('Unauthorized', 401);
      const parsed = classAssessmentSubmitSchema.safeParse(
        JSON.parse(Buffer.from(await readRequestBytes(request, 200_000)).toString('utf8'))
      );
      if (!parsed.success) return errorResponse('Invalid assessment request.', 400);
      const { classId, assessmentId } = await params.params;
      const receipt = await submitAssessment({
        classId,
        assessmentId,
        choices: parsed.data.choices,
        execution: sottoRequestExecution(request, identity),
      });
      return NextResponse.json(classReceiptSchema.parse(receipt), {
        headers: { 'Cache-Control': 'private, no-store' },
      });
    } catch (error) {
      if (isAccessError(error)) throw error;
      const conflict =
        error instanceof InitialA1PracticeBlocked ||
        error instanceof PrerequisiteSourceConflict ||
        error instanceof AssessmentFenceConflict ||
        error instanceof AssessmentSourceConflict ||
        error instanceof AssessmentSpeakingUnavailable ||
        error instanceof LearningIncompleteError;
      const invalid = error instanceof SyntaxError;
      const status = conflict
        ? 409
        : error instanceof RequestBodyTooLargeError
          ? 413
          : invalid
            ? 400
            : 500;
      return errorResponse(
        conflict
          ? 'Assessment submission is unavailable for this class.'
          : status === 413
            ? 'Assessment request is too large.'
            : invalid
              ? 'Invalid assessment request.'
              : 'Assessment submission is unavailable.',
        status
      );
    }
  });
}
