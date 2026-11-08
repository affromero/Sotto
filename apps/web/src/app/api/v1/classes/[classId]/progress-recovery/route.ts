import { NextRequest, NextResponse } from 'next/server';
import { classProgressRecoverySchema } from '@sotto/shared';
import { authenticateRequest } from '@/lib/api-keys';
import { errorResponse } from '@/lib/api-response';
import { accessOperation } from '@/lib/sidedoor/access/core/http';
import { prismaUnfiltered } from '@/lib/prisma';
import { sottoTransaction } from '@/lib/sidedoor/access/state/transaction';
import { sottoRequestExecution } from '@/lib/sidedoor/credentials/runtime/provider-execution';
import { classProgressRevision } from '@/lib/learning/classes/progress/progress-revision';

type Params = { params: Promise<{ classId: string }> };

/** Reconcile a saved revision without disclosing the lesson or answer keys. */
export function GET(request: NextRequest, params: Params) {
  return accessOperation(request, false, async () => {
    const identity = await authenticateRequest(request);
    if (!identity) return errorResponse('Unauthorized', 401);
    const { classId } = await params.params;
    const execution = sottoRequestExecution(request, identity);
    const value = await sottoTransaction(
      prismaUnfiltered,
      async (database) => {
        const actor = await execution.authorize(database);
        if (actor.userId !== identity.userId) return null;
        await database.$queryRaw`SELECT id FROM "CourseClass" WHERE id = ${classId} FOR UPDATE`;
        const cls = await database.courseClass.findFirst({
          where: { id: classId, course: { userId: identity.userId } },
          select: { id: true, status: true, attempt: true, progressRevision: true },
        });
        if (!cls) return null;
        const progress = await classProgressRevision(database, classId, identity.userId);
        return classProgressRecoverySchema.parse({
          classId: cls.id,
          status: cls.status,
          attempt: cls.attempt,
          progressRevision: cls.progressRevision,
          taskMaterialRevision: progress.revision,
        });
      },
      { signal: request.signal }
    );
    return value ? NextResponse.json(value) : errorResponse('Class not found', 404);
  });
}
