import { createHash, randomUUID } from 'node:crypto';
import { readResponseBytes } from 'thesidedoor-core/runtime/stream';
import { prismaUnfiltered as prisma } from '@/lib/prisma';
import { sottoTransaction } from '@/lib/sidedoor/access/state/transaction';
import type { SottoProviderExecution } from '@/lib/sidedoor/credentials/runtime/provider-execution';
import { PreparationConflictError } from '../../classes/preparation-state';
import type { Prisma } from '@/generated/prisma/client';

class PreparationProviderOutcomeUnknown extends Error {
  constructor(options: ErrorOptions) {
    super('A preparation provider request has an unresolved outcome.', options);
    this.name = 'PreparationProviderOutcomeUnknown';
  }
}

/** Parent text-model HTTP attempts only. Descendant audio is a separate, explicit operation. */
export function learningPreparationProviderRequest(
  operation: {
    selection: unknown;
    admit: (
      database: Prisma.TransactionClient,
      attempt: { id: string; fingerprint: string }
    ) => Promise<{ dispatch: boolean }>;
    settle: (
      database: Prisma.TransactionClient,
      attempt: { id: string; fingerprint: string },
      outcome: 'succeeded' | 'failed' | 'unknown'
    ) => Promise<unknown>;
  },
  signal: AbortSignal,
  unresolved: () => void
): NonNullable<SottoProviderExecution['providerRequest']> {
  let outcomeUnknown = false;
  return async (request, dispatch) => {
    if (outcomeUnknown)
      throw new PreparationConflictError('An earlier provider outcome is unresolved.');
    signal.throwIfAborted();
    const bytes = await readResponseBytes(request.clone(), { signal, maxBytes: 4 * 1024 * 1024 });
    const attempt = {
      id: randomUUID(),
      fingerprint: createHash('sha256')
        .update(
          JSON.stringify({
            url: request.url,
            method: request.method,
            selection: operation.selection,
          })
        )
        .update(bytes)
        .digest('hex'),
    };
    const admission = await sottoTransaction(
      prisma,
      async (database) => {
        return operation.admit(database, attempt);
      },
      { signal }
    );
    if (!admission.dispatch)
      throw new PreparationConflictError('The provider attempt already exists.');
    let dispatched = false;
    try {
      signal.throwIfAborted();
      dispatched = true;
      const response = await dispatch();
      const body = await readResponseBytes(response, { signal, maxBytes: 16 * 1024 * 1024 });
      await sottoTransaction(prisma, async (database) => {
        await operation.settle(database, attempt, response.ok ? 'succeeded' : 'failed');
      });
      return new Response(body.length ? Buffer.from(body) : null, {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
      });
    } catch (error) {
      if (dispatched) {
        outcomeUnknown = true;
        unresolved();
      }
      try {
        await sottoTransaction(prisma, async (database) => {
          await operation.settle(database, attempt, dispatched ? 'unknown' : 'failed');
        });
      } catch (settlement) {
        outcomeUnknown = true;
        unresolved();
        throw new PreparationProviderOutcomeUnknown({
          cause: new AggregateError([error, settlement]),
        });
      }
      if (dispatched) throw new PreparationProviderOutcomeUnknown({ cause: error });
      throw error;
    }
  };
}
