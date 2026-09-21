import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { AccessError } from 'thesidedoor-core/access';
import { StorageCleanupJournal } from 'thesidedoor-core/storage';
import { errorResponse } from '@/lib/api-response';
import { prismaUnfiltered } from '@/lib/prisma';
import { accessOperation } from '@/lib/sidedoor/access/core/http';
import { resolveSottoRequest } from '@/lib/sidedoor/access/core/request-identity';
import { SIDEDOOR_STATE_ID } from '@/lib/sidedoor/access/state/store';
import { sottoTransaction } from '@/lib/sidedoor/access/state/transaction';

export const dynamic = 'force-dynamic';

/** One owner-authorized page. Status never exposes stored URLs, manifests or backend configuration. */
export function GET(request: NextRequest) {
  return accessOperation(request, false, () =>
    sottoTransaction(
      prismaUnfiltered,
      async (database) => {
        const identity = await resolveSottoRequest(database, request);
        if (!identity) throw new AccessError('unauthorized');
        if (!identity.isOwner) throw new AccessError('forbidden');
        const parsed = z.uuid().nullable().safeParse(request.nextUrl.searchParams.get('after'));
        if (!parsed.success) return errorResponse('Invalid cleanup cursor', 400);
        const journal = new StorageCleanupJournal(
          {
            query: (sql, values) =>
              database.$queryRawUnsafe<Record<string, unknown>[]>(sql, ...values),
          },
          'postgres',
          SIDEDOOR_STATE_ID
        );
        const page = await journal.listJobs(parsed.data);
        const jobs = [];
        for (const job of page.jobs) {
          const guard = await journal.manifestStatus(job.id, 'write-protocol');
          jobs.push({
            id: job.id,
            subjectId: job.subjectId,
            createdAt: job.createdAt,
            phase: job.phase,
            complete: job.phase === 'complete',
            blocked:
              job.phase !== 'complete' &&
              (job.unresolvedManifests > 0 || guard?.resolved === false),
            writerProtocol: guard === null ? 'unknown' : guard.resolved ? 'verified' : 'pending',
            knownPendingFiles: job.pending,
            deletedFiles: job.deleted,
            unresolvedManifests: job.unresolvedManifests,
          });
        }
        return NextResponse.json({ jobs, cursor: page.cursor });
      },
      { signal: request.signal }
    )
  );
}
