import { Prisma, type PracticeSession } from '@/generated/prisma/client';
import { practicePreparationSchema } from './preparation-state';

/** Caller owns canonical source deletion and its writer fences in this same transaction. */
export async function retirePracticeSourceSnapshots(
  database: Prisma.TransactionClient,
  analysisIds: readonly string[]
) {
  if (!analysisIds.length) return;
  if (analysisIds.length > 100)
    throw new Error('Retire private practice sources in bounded analysis pages.');
  const source: Prisma.PracticeSessionWhereInput = {
    OR: analysisIds.flatMap((analysisId) => [
      { learningSelection: { path: ['sourceFocus', 'analysisId'], equals: analysisId } },
      {
        generationSpec: {
          path: ['learningSelection', 'sourceFocus', 'analysisId'],
          equals: analysisId,
        },
      },
    ]),
  };
  let after: string | null = null;
  while (true) {
    const rows: Array<Pick<PracticeSession, 'id' | 'status' | 'generationState'>> =
      await database.practiceSession.findMany({
        where: { ...source, ...(after ? { id: { gt: after } } : {}) },
        orderBy: { id: 'asc' },
        take: 100,
        select: { id: true, status: true, generationState: true },
      });
    for (const row of rows) {
      const parsed = practicePreparationSchema.safeParse(row.generationState);
      if (row.generationState !== null && !parsed.success)
        throw new Error(
          'The saved practice preparation receipt is invalid. Resolve its recovery proof before deleting the source.'
        );
      let generationState: Prisma.InputJsonValue | typeof Prisma.JsonNull = Prisma.JsonNull;
      if (parsed.success) {
        const operation = parsed.data;
        const { practicePreparationGrant } = await import('./preparation');
        await practicePreparationGrant(database, operation).revoke(operation.grant);
        generationState = {
          ...operation,
          sourceRetired: true,
          status: 'FAILED',
          failure: 'source_unreadable',
          updatedAt: Date.now(),
        };
      }
      await database.practiceSession.update({
        where: { id: row.id },
        data: {
          learningSelection: Prisma.JsonNull,
          generationSpec: Prisma.JsonNull,
          generationState,
          ...(row.status === 'GENERATING' ? { status: 'FAILED' } : {}),
        },
      });
    }
    if (rows.length < 100) return;
    after = rows[rows.length - 1]!.id;
  }
}
