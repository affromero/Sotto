import { NextRequest, NextResponse } from 'next/server';
import {
  classPrerequisiteAcknowledgmentSchema,
  classPrerequisiteResponseSchema,
} from '@sotto/shared';
import { isAccessError } from 'thesidedoor-core/access';
import { readRequestBytes, RequestBodyTooLargeError } from 'thesidedoor-core/runtime/request';
import { z } from 'zod';
import { authenticateRequest } from '@/lib/api-keys';
import { errorResponse } from '@/lib/api-response';
import { prismaUnfiltered as prisma } from '@/lib/prisma';
import { accessOperation } from '@/lib/sidedoor/access/core/http';
import { sottoTransaction } from '@/lib/sidedoor/access/state/transaction';
import { sottoRequestExecution } from '@/lib/sidedoor/credentials/runtime/provider-execution';
import { acknowledgePrerequisite } from '@/lib/classes/help/lifecycle/prerequisite-acknowledgment';
import { PrerequisiteSourceConflict } from '@/lib/classes/help/content/prerequisite-source';
import { PrerequisiteFenceConflict } from '@/lib/classes/help/lifecycle/prerequisite-fence';
import { readPrerequisiteStatus } from '@/lib/classes/help/prerequisite-status';
import { createPrerequisiteTokenizer } from '@/lib/classes/help/content/prerequisite-token';

type Params = { params: Promise<{ classId: string }> };

export function POST(request: NextRequest, params: Params) {
  return accessOperation(request, !request.headers.has('authorization'), async () => {
    try {
      const identity = await authenticateRequest(request);
      if (!identity) return errorResponse('Unauthorized', 401);
      const input = classPrerequisiteAcknowledgmentSchema.parse(
        JSON.parse(Buffer.from(await readRequestBytes(request, 4096)).toString('utf8'))
      );
      const { classId } = await params.params;
      const execution = sottoRequestExecution(request, identity);
      const tokenizer = createPrerequisiteTokenizer(classId, identity.userId);
      try {
        const result = await sottoTransaction(
          prisma,
          async (database) => {
            await execution.authorize(database);
            await database.$queryRaw`SELECT id FROM "CourseClass" WHERE id = ${classId} FOR UPDATE`;
            const current = await readPrerequisiteStatus(database, classId, identity.userId);
            if (!tokenizer.matchesSource(input.sourceHash, current.request.sourceHash))
              throw new PrerequisiteSourceConflict();
            return acknowledgePrerequisite(database, {
              classId,
              userId: identity.userId,
              receiptId: input.receiptId,
              sourceHash: current.request.sourceHash,
            });
          },
          { signal: request.signal }
        );
        return NextResponse.json(classPrerequisiteResponseSchema.parse(tokenizer.status(result)), {
          headers: { 'Cache-Control': 'private, no-store' },
        });
      } finally {
        tokenizer.dispose();
      }
    } catch (error) {
      if (isAccessError(error)) throw error;
      const status =
        error instanceof PrerequisiteSourceConflict || error instanceof PrerequisiteFenceConflict
          ? 409
          : error instanceof RequestBodyTooLargeError
            ? 413
            : error instanceof SyntaxError || error instanceof z.ZodError
              ? 400
              : 500;
      const response = errorResponse(
        status === 409
          ? 'The class or explanation changed. Reopen the class.'
          : status === 413
            ? 'Prerequisite request is too large.'
            : status === 400
              ? 'Invalid prerequisite request.'
              : 'Prerequisite teaching is unavailable.',
        status
      );
      response.headers.set('Cache-Control', 'private, no-store');
      return response;
    }
  });
}
