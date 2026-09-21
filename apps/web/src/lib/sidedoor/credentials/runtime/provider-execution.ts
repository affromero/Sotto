import { isDeepStrictEqual } from 'node:util';
import { AccessError } from 'thesidedoor-core/access';
import {
  createProviderTransport,
  createMediaTransport,
  type ProviderRequestRule,
} from 'thesidedoor-core/providers/transport';
import { prismaUnfiltered } from '@/lib/prisma';
import { logger } from '@/lib/logger';
import {
  captureSottoCredentialOwner,
  sottoCredentialRows,
} from '@/lib/sidedoor/credentials/runtime/provider-credentials';
import {
  admitSottoExecutionCredential,
  validateSottoExecutionCredential,
  type CredentialExecutionAuthority,
  type SottoExecutionCredential,
} from '@/lib/sidedoor/credentials/runtime/credential-execution';
import { sottoTransaction } from '@/lib/sidedoor/access/state/transaction';
import type { AuthenticatedRequest } from '@/lib/api-keys';
import { requireOriginalSottoAdmission } from '@/lib/sidedoor/access/core/request-identity';

export interface SottoProviderExecution {
  userId: string;
  authorize: CredentialExecutionAuthority;
  credential?: SottoExecutionCredential | null;
  signal?: AbortSignal;
  onCleanupError?: (error: unknown) => void;
}

export function sottoRequestExecution(
  request: Request,
  identity: AuthenticatedRequest
): SottoProviderExecution {
  const original = Object.freeze(structuredClone(identity));
  return {
    userId: original.userId,
    signal: request.signal,
    authorize: async (database) => {
      await requireOriginalSottoAdmission(database, request, original);
      return { userId: original.userId };
    },
  };
}

/** Capture platform and personal recipients before constructing a provider. */
export async function captureSottoProviderAdmission(execution: SottoProviderExecution) {
  const { userId, authorize, signal } = execution;
  const credential = execution.credential ? structuredClone(execution.credential) : null;
  const owner = await sottoTransaction(
    prismaUnfiltered,
    async (database) => {
      signal?.throwIfAborted();
      const current = await authorize(database);
      if (current.userId !== userId)
        throw new AccessError('conflict', 'The execution recipient changed');
      const captured = await captureSottoCredentialOwner(database, userId);
      if (
        credential &&
        (credential.recipient.userId !== userId ||
          !isDeepStrictEqual(credential.recipient.owner, captured))
      )
        throw new AccessError('conflict', 'The credential recipient changed');
      const instance = (await sottoCredentialRows(database)).instance;
      signal?.throwIfAborted();
      return { recipient: captured, instance };
    },
    { signal }
  );
  const admit = async (suppliedSignal: AbortSignal, recordUse: boolean) => {
    const requestSignal = signal ? AbortSignal.any([signal, suppliedSignal]) : suppliedSignal;
    await sottoTransaction(
      prismaUnfiltered,
      async (database) => {
        requestSignal.throwIfAborted();
        if (!isDeepStrictEqual((await sottoCredentialRows(database)).instance, owner.instance))
          throw new AccessError('conflict', 'The execution instance changed');
        if (credential) {
          if (recordUse)
            await admitSottoExecutionCredential(database, authorize, credential, requestSignal);
          else
            await validateSottoExecutionCredential(database, authorize, credential, requestSignal);
        } else {
          const current = await authorize(database);
          if (
            current.userId !== userId ||
            !isDeepStrictEqual(await captureSottoCredentialOwner(database, userId), owner.recipient)
          )
            throw new AccessError('conflict', 'The execution recipient changed');
        }
        requestSignal.throwIfAborted();
      },
      { signal: requestSignal }
    );
  };
  return Object.freeze({
    get identity() {
      return structuredClone(owner);
    },
    validate: (requestSignal: AbortSignal) => admit(requestSignal, false),
    createTransport: (rules: readonly ProviderRequestRule[]) =>
      createProviderTransport({
        rules: structuredClone(rules),
        signal,
        admit: async (request, requestSignal) => {
          if (
            credential &&
            new URL(request.url).origin !== new URL(credential.binding.endpoint).origin
          )
            throw new AccessError('conflict', 'The provider destination changed');
          await admit(requestSignal, true);
        },
        onCleanupError: (error) => {
          execution.onCleanupError?.(error);
          logger.error('Provider response cleanup failed', {
            error: error instanceof Error ? error.message : String(error),
          });
        },
      }),
    createMediaTransport: ({ maxBytes, timeoutMs, admitDestination }: SottoMediaOptions) =>
      createMediaTransport({
        maxBytes,
        timeoutMs,
        signal,
        admit: async (request, requestSignal) => {
          await admitDestination(request.url, requestSignal);
          await admit(requestSignal, false);
        },
        onCleanupError: (error) => {
          execution.onCleanupError?.(error);
          logger.error('Media response cleanup failed');
        },
      }),
  });
}

export async function createSottoProviderTransport(
  execution: SottoProviderExecution,
  rules: readonly ProviderRequestRule[]
) {
  const capturedRules = structuredClone(rules);
  const admission = await captureSottoProviderAdmission(execution);
  return admission.createTransport(capturedRules);
}

interface SottoMediaOptions {
  maxBytes: number;
  timeoutMs: number;
  admitDestination: (url: string, signal: AbortSignal) => Promise<void>;
}

/** Media checks the same captured authority without recording a provider request. */
export async function createSottoMediaTransport(
  execution: SottoProviderExecution,
  options: SottoMediaOptions
) {
  const capturedOptions = { ...options };
  const admission = await captureSottoProviderAdmission(execution);
  return admission.createMediaTransport(capturedOptions);
}
