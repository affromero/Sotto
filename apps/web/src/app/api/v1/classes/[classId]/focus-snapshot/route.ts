import { NextRequest, NextResponse } from 'next/server';
import { classFocusSnapshotSchema } from '@sotto/shared';
import { isAccessError } from 'thesidedoor-core/access';
import { authenticateRequest } from '@/lib/api-keys';
import { errorResponse } from '@/lib/api-response';
import { prismaUnfiltered } from '@/lib/prisma';
import { readClassTeachingPreludeInTransaction } from '@/lib/classes/lesson/initial-a1-provenance';
import { classProgressRevision } from '@/lib/learning/classes/progress/progress-revision';
import { accessOperation } from '@/lib/sidedoor/access/core/http';
import { sottoTransaction } from '@/lib/sidedoor/access/state/transaction';
import { sottoRequestExecution } from '@/lib/sidedoor/credentials/runtime/provider-execution';

type Params = { params: Promise<{ classId: string }> };

export function GET(request: NextRequest, params: Params) {
  return accessOperation(request, false, async () => {
    const privateError = (message: string, status: number) => {
      const response = errorResponse(message, status);
      response.headers.set('Cache-Control', 'private, no-store');
      return response;
    };
    try {
      const identity = await authenticateRequest(request);
      if (!identity) return privateError('Unauthorized', 401);
      const { classId } = await params.params;
      const execution = sottoRequestExecution(request, identity);
      const snapshot = await sottoTransaction(
        prismaUnfiltered,
        async (database) => {
          request.signal.throwIfAborted();
          const actor = await execution.authorize(database);
          if (actor.userId !== identity.userId) return null;
          await database.$queryRaw`SELECT id FROM "CourseClass" WHERE id = ${classId} FOR UPDATE`;
          const cls = await database.courseClass.findFirst({
            where: { id: classId, course: { userId: identity.userId } },
            select: { id: true, status: true, attempt: true, progressRevision: true },
          });
          if (!cls) return null;
          const prelude = await readClassTeachingPreludeInTransaction(
            database,
            classId,
            identity.userId
          );
          const revision = await classProgressRevision(database, classId, identity.userId);
          request.signal.throwIfAborted();
          return classFocusSnapshotSchema.parse({
            prelude,
            progress: {
              classId: cls.id,
              status: cls.status,
              attempt: cls.attempt,
              progressRevision: cls.progressRevision,
              taskMaterialRevision: revision.revision,
            },
          });
        },
        { signal: request.signal }
      );
      if (!snapshot) return privateError('Class not found.', 404);
      return NextResponse.json(snapshot, { headers: { 'Cache-Control': 'private, no-store' } });
    } catch (error) {
      if (isAccessError(error)) throw error;
      return privateError('Class status is unavailable.', 500);
    }
  });
}
