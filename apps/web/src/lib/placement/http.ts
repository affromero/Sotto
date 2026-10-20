import { z } from 'zod';
import { checkRateLimit } from '@/lib/redis';
import { errorResponse } from '@/lib/api-response';
import { prismaUnfiltered } from '@/lib/prisma';
import { sottoTransaction } from '@/lib/sidedoor/access/state/transaction';
import type { SottoProviderExecution } from '@/lib/sidedoor/credentials/runtime/provider-execution';
import { MaterialAnalysisConflict } from '@/lib/course-materials/analysis/inventory';

/** Preserve the existing admission budget. Reading a retained request receipt never consumes another admission. */
export async function placementAdmissionRateLimit(
  execution: SottoProviderExecution,
  kind: 'QUIZ' | 'SOURCE',
  requestId: string
) {
  z.uuid().parse(requestId);
  const retained = await sottoTransaction(
    prismaUnfiltered,
    async (database) => {
      const actor = await execution.authorize(database);
      if (actor.userId !== execution.userId)
        throw new MaterialAnalysisConflict('The placement recipient changed.');
      if (kind === 'QUIZ')
        return !!(await database.placementSession.findUnique({
          where: { userId_requestId: { userId: execution.userId, requestId } },
          select: { id: true },
        }));
      return !!(await database.materialAnalysisRequest.findUnique({
        where: { userId_requestId: { userId: execution.userId, requestId } },
        select: { requestId: true },
      }));
    },
    { signal: execution.signal }
  );
  if (retained) return null;
  const rate = await checkRateLimit(`placement:${execution.userId}`, 10, 3600);
  return rate.allowed
    ? null
    : errorResponse('Rate limit exceeded. Try again later.', 429, { resetAt: rate.resetAt });
}
