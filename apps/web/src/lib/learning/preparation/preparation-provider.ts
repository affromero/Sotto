import { createHash, randomUUID } from 'node:crypto';
import { readResponseBytes } from 'thesidedoor-core/runtime/stream';
import { prismaUnfiltered as prisma } from '@/lib/prisma';
import { sottoTransaction } from '@/lib/sidedoor/access/state/transaction';
import type { SottoProviderExecution } from '@/lib/sidedoor/credentials/runtime/provider-execution';
import { PreparationConflictError } from '../../classes/preparation-state';
import type { Prisma } from '@/generated/prisma/client';

export interface LearningPreparationResponseReceipt {
  status: number;
  statusText: string;
  headers: [string, string][];
  bodyBase64: string;
  bodySha256: string;
}

export async function learningPreparationRequestFingerprint(
  request: Request,
  selection: unknown,
  signal: AbortSignal
): Promise<string> {
  // A 50 MiB original expands to 67 MiB of base64, plus bounded prompt text.
  const bytes = await readResponseBytes(request.clone(), { signal, maxBytes: 72 * 1024 * 1024 });
  return createHash('sha256')
    .update(JSON.stringify({ url: request.url, method: request.method, selection }))
    .update(bytes)
    .digest('hex');
}

/** Private bounded HTTP receipts must be authorized before replay. No network dispatch. */
export function restoreLearningPreparationResponse(receipt: LearningPreparationResponseReceipt) {
  if (
    !Number.isInteger(receipt.status) ||
    receipt.status < 200 ||
    receipt.status > 599 ||
    receipt.statusText.length > 2000 ||
    receipt.headers.length > 100 ||
    Buffer.byteLength(JSON.stringify(receipt.headers), 'utf8') > 16 * 1024 ||
    receipt.bodyBase64.length > Math.ceil((16 * 1024 * 1024) / 3) * 4 ||
    !/^[A-Za-z0-9+/]*={0,2}$/.test(receipt.bodyBase64) ||
    !/^[a-f0-9]{64}$/.test(receipt.bodySha256)
  )
    throw new Error('Invalid preparation response receipt.');
  const body = Buffer.from(receipt.bodyBase64, 'base64');
  if (
    body.length > 16 * 1024 * 1024 ||
    body.toString('base64') !== receipt.bodyBase64 ||
    createHash('sha256').update(body).digest('hex') !== receipt.bodySha256
  )
    throw new Error('The preparation response receipt content changed.');
  return new Response(body.length ? body : null, {
    status: receipt.status,
    statusText: receipt.statusText,
    headers: receipt.headers,
  });
}

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
    /** Opt-in private response persistence, atomically with settlement in the caller transaction. */
    responseReceipt?: { maxBytes: number };
    admit: (
      database: Prisma.TransactionClient,
      attempt: { id: string; fingerprint: string }
    ) => Promise<{ dispatch: boolean }>;
    settle: (
      database: Prisma.TransactionClient,
      attempt: { id: string; fingerprint: string },
      outcome: 'succeeded' | 'failed' | 'unknown',
      response?: LearningPreparationResponseReceipt
    ) => Promise<unknown>;
  },
  signal: AbortSignal,
  unresolved: () => void
): NonNullable<SottoProviderExecution['providerRequest']> {
  const maxResponseBytes = operation.responseReceipt?.maxBytes ?? 16 * 1024 * 1024;
  if (
    !Number.isSafeInteger(maxResponseBytes) ||
    maxResponseBytes < 1 ||
    maxResponseBytes > 16 * 1024 * 1024
  )
    throw new Error('Invalid preparation response receipt byte limit.');
  let outcomeUnknown = false;
  return async (request, dispatch) => {
    if (outcomeUnknown)
      throw new PreparationConflictError('An earlier provider outcome is unresolved.');
    signal.throwIfAborted();
    const attempt = {
      id: randomUUID(),
      fingerprint: await learningPreparationRequestFingerprint(
        request,
        operation.selection,
        signal
      ),
    };
    const admission = await sottoTransaction(
      prisma,
      async (database) => operation.admit(database, attempt),
      { signal }
    );
    if (!admission.dispatch)
      throw new PreparationConflictError('The provider attempt already exists.');
    let dispatched = false;
    try {
      signal.throwIfAborted();
      dispatched = true;
      const response = await dispatch();
      const body = await readResponseBytes(response, { signal, maxBytes: maxResponseBytes });
      let receipt: LearningPreparationResponseReceipt | undefined;
      if (operation.responseReceipt) {
        receipt = {
          status: response.status,
          statusText: response.statusText,
          headers: [...response.headers.entries()],
          bodyBase64: Buffer.from(body).toString('base64'),
          bodySha256: createHash('sha256').update(body).digest('hex'),
        };
        // Validate bounded replay metadata before claiming a reconstructable success.
        restoreLearningPreparationResponse(receipt);
      }
      await sottoTransaction(prisma, async (database) => {
        if (receipt)
          await operation.settle(database, attempt, response.ok ? 'succeeded' : 'failed', receipt);
        else await operation.settle(database, attempt, response.ok ? 'succeeded' : 'failed');
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
