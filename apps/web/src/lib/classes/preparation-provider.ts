import { createHash, randomUUID } from 'node:crypto';
import { readResponseBytes } from 'thesidedoor-core/runtime/stream';
import { prismaUnfiltered as prisma } from '@/lib/prisma';
import { sottoTransaction } from '@/lib/sidedoor/access/state/transaction';
import type { SottoProviderExecution } from '@/lib/sidedoor/credentials/runtime/provider-execution';
import { classPreparationGrant } from './preparation-grant';
import { validateClassPreparation } from './preparation';
import { PreparationConflictError, type ClassPreparation } from './preparation-state';

class PreparationProviderOutcomeUnknown extends Error {
  constructor(options: ErrorOptions) {
    super('A preparation provider request has an unresolved outcome.', options);
    this.name = 'PreparationProviderOutcomeUnknown';
  }
}

/** Parent text-model HTTP attempts only. Descendant audio is a separate, explicit operation. */
export function preparationProviderRequest(
  operation: ClassPreparation,
  signal: AbortSignal,
  unresolved: () => void
): NonNullable<SottoProviderExecution['providerRequest']> {
  return async (request, dispatch) => {
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
        const current = await validateClassPreparation(database, operation.courseId, operation.id);
        return classPreparationGrant(database, current).admit(current.grant, attempt);
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
        const current = await validateClassPreparation(
          database,
          operation.courseId,
          operation.id,
          true
        );
        await classPreparationGrant(database, current).settle(
          current.grant,
          attempt,
          response.ok ? 'succeeded' : 'failed'
        );
      });
      return new Response(body.length ? Buffer.from(body) : null, {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
      });
    } catch (error) {
      if (dispatched) unresolved();
      try {
        await sottoTransaction(prisma, async (database) => {
          const current = await validateClassPreparation(
            database,
            operation.courseId,
            operation.id,
            true
          );
          await classPreparationGrant(database, current).settle(
            current.grant,
            attempt,
            dispatched ? 'unknown' : 'failed'
          );
        });
      } catch (settlement) {
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
