import { prismaUnfiltered as prisma } from '@/lib/prisma';
import type { Prisma } from '@/generated/prisma/client';
import { MODERATION_API_URL } from '@/lib/moderation';
import { sottoTransaction } from '@/lib/sidedoor/access/state/transaction';
import type { SottoProviderExecution } from '@/lib/sidedoor/credentials/runtime/provider-execution';
import {
  learningPreparationProviderRequest,
  learningPreparationRequestFingerprint,
  restoreLearningPreparationResponse,
} from '@/lib/learning/preparation/preparation-provider';
import {
  admitAssessmentProviderCall,
  prepareAssessmentProviderCall,
  readAssessmentProviderCall,
  settleAssessmentProviderCall,
  assessmentCallInventoryDigest,
} from './assessment-provider-journal';
import { AssessmentFenceConflict } from '../lifecycle/assessment-fence';
import { requirePendingAssessmentWork } from '../generation/assessment-work';

/** Replay an exact ordered HTTP exchange; a missing result never implies permission to retry. */
export function assessmentProviderRequest(input: {
  identity: { id: string; fingerprint: string };
  execution: SottoProviderExecution;
  stage: Parameters<typeof prepareAssessmentProviderCall>[1]['stage'];
  inputDigest: string;
  selection: unknown;
  signal: AbortSignal;
  unresolved: () => void;
  startOrdinal?: number;
  replayOnly?: boolean;
}): NonNullable<SottoProviderExecution['providerRequest']> & {
  consumedCalls: () => number;
  verifyConsumed: (database: Prisma.TransactionClient) => Promise<void>;
} {
  const selection = structuredClone({
    selection: input.selection,
    operationId: input.identity.id,
    stage: input.stage,
    inputDigest: input.inputDigest,
  });
  const startOrdinal = input.startOrdinal ?? 0;
  if (!Number.isSafeInteger(startOrdinal) || startOrdinal < 0 || startOrdinal > 15)
    throw new AssessmentFenceConflict();
  let ordinal = startOrdinal;
  let active = false;
  const consumed: string[] = [];
  const requestBoundary: NonNullable<SottoProviderExecution['providerRequest']> = async (
    request,
    dispatch
  ) => {
    if (active) throw new AssessmentFenceConflict();
    active = true;
    try {
      input.signal.throwIfAborted();
      const context = {
        identity: input.identity,
        execution: input.execution,
        stage: input.stage,
        inputDigest: input.inputDigest,
        ordinal: ordinal++,
        role: request.url === MODERATION_API_URL ? ('MODERATION' as const) : ('MODEL' as const),
      };
      const fingerprint = await learningPreparationRequestFingerprint(
        request,
        selection,
        input.signal
      );
      const captured = await sottoTransaction(
        prisma,
        async (database) => {
          if (!input.replayOnly) await prepareAssessmentProviderCall(database, context);
          const saved = await readAssessmentProviderCall(database, context);
          let row = null;
          if (input.replayOnly && saved) {
            const { current } = await requirePendingAssessmentWork(
              database,
              input.identity,
              input.execution,
              'RUNNING'
            );
            row = await database.classAssessmentProviderCall.findUniqueOrThrow({
              where: {
                assessmentId_stage_ordinal: {
                  assessmentId: current.assessmentId,
                  stage: context.stage,
                  ordinal: context.ordinal,
                },
              },
            });
          }
          return { saved, digest: row ? assessmentCallInventoryDigest([row]) : null };
        },
        { signal: input.signal }
      );
      const { saved } = captured;
      if (!saved) throw new AssessmentFenceConflict();
      if (saved.status === 'READY') {
        if (input.replayOnly) throw new AssessmentFenceConflict();
        const perform = learningPreparationProviderRequest(
          {
            selection,
            responseReceipt: { maxBytes: 512 * 1024 },
            admit: (database, attempt) => admitAssessmentProviderCall(database, context, attempt),
            settle: (database, attempt, outcome, receipt) =>
              settleAssessmentProviderCall(database, context, attempt, outcome, receipt),
          },
          input.signal,
          input.unresolved
        );
        return await perform(request, dispatch);
      }
      if (
        saved.receipt &&
        ['SUCCEEDED', 'FAILED'].includes(saved.status) &&
        saved.attemptFingerprint === fingerprint
      ) {
        if (input.replayOnly) {
          if (!captured.digest) throw new AssessmentFenceConflict();
          consumed.push(captured.digest);
        }
        return restoreLearningPreparationResponse(saved.receipt);
      }
      if (!input.replayOnly) input.unresolved();
      throw new AssessmentFenceConflict();
    } finally {
      active = false;
    }
  };
  return Object.assign(requestBoundary, {
    consumedCalls: () => ordinal,
    verifyConsumed: async (database: Prisma.TransactionClient) => {
      if (!input.replayOnly) throw new AssessmentFenceConflict();
      const { current } = await requirePendingAssessmentWork(
        database,
        input.identity,
        input.execution,
        'RUNNING'
      );
      const rows = await database.classAssessmentProviderCall.findMany({
        where: {
          assessmentId: current.assessmentId,
          stage: input.stage,
          ordinal: { gte: startOrdinal },
        },
        orderBy: { ordinal: 'asc' },
      });
      if (
        rows.length !== consumed.length ||
        rows.some(
          (row, index) =>
            row.ordinal !== startOrdinal + index ||
            assessmentCallInventoryDigest([row]) !== consumed[index]
        )
      )
        throw new AssessmentFenceConflict();
    },
  });
}
