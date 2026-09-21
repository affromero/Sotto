import { z } from 'zod';
import { AccessError } from 'thesidedoor-core/access';
import type { CredentialValidation, CredentialValues } from 'thesidedoor-core/ai';
import { OwnedCredentialConflictError } from 'thesidedoor-core/configuration/owned-credentials';
import type { Prisma, PrismaClient } from '@/generated/prisma/client';
import type { AuthenticatedRequest } from '@/lib/api-keys';
import {
  captureSottoCredentialProbe,
  validateSottoCredentialProbe,
} from '@/lib/providers/shared/credential-validation';
import {
  captureSottoCredentialOwner,
  sottoCredentialStorage,
  sottoCredentialDescriptor,
  sottoCredentialRows,
} from '@/lib/sidedoor/credentials/runtime/provider-credentials';
import { requireOriginalSottoAdmission } from '@/lib/sidedoor/access/core/request-identity';
import type { CredentialScope } from '@/lib/sidedoor/access/state/state';
import { sottoTransaction } from '@/lib/sidedoor/access/state/transaction';

export class SottoCredentialRejectedError extends Error {
  constructor(readonly validation: CredentialValidation) {
    super(
      validation.status === 'missing'
        ? 'Required provider credentials are missing'
        : 'The provider rejected these credentials'
    );
  }
}

interface CredentialRequest {
  request: Request;
  identity: AuthenticatedRequest;
  scope: CredentialScope;
  provider: string;
  context?: { instanceId: string; owner: { subjectId: string; generation: number } };
}

type CredentialEdit =
  | { values: CredentialValues; patch?: never }
  | { values?: never; patch: Record<string, string | number | boolean | null> };

function captureRequest<T extends CredentialRequest>(input: T): T {
  return {
    ...input,
    identity: { ...input.identity },
    context: input.context ? structuredClone(input.context) : undefined,
    request: new Request(input.request.url, {
      headers: input.request.headers,
      signal: input.request.signal,
    }),
  };
}

async function admittedOwner(
  database: Prisma.TransactionClient,
  input: Omit<CredentialRequest, 'provider'>
) {
  input.request.signal.throwIfAborted();
  await requireOriginalSottoAdmission(database, input.request, input.identity);
  return captureSottoCredentialOwner(database, input.identity.userId);
}

function requireDisplayedOwner(
  input: Omit<CredentialRequest, 'provider'>,
  instanceId: string,
  owner: { subjectId: string; generation: number }
) {
  if (
    input.context &&
    (input.context.instanceId !== instanceId ||
      input.context.owner.subjectId !== owner.subjectId ||
      input.context.owner.generation !== owner.generation)
  )
    throw new AccessError(
      'conflict',
      'The credential settings owner changed. Reload the settings.'
    );
}

async function admittedStorage(database: Prisma.TransactionClient, input: CredentialRequest) {
  const owner = await admittedOwner(database, input);
  const storage = await sottoCredentialStorage(database, input.scope, input.provider);
  requireDisplayedOwner(input, storage.instance.instanceId, owner);
  return { ...storage, owner, target: { ...storage.slot, owner } };
}

/** A save carries the revision shown in the form, independently of concurrent verification attempts. */
export async function saveSottoCredential(
  database: PrismaClient,
  input: CredentialRequest &
    CredentialEdit & {
      expectedRevision: string | null;
      operationId: string;
      allowUnverified: boolean;
    }
) {
  input = captureRequest(input);
  const expectedRevision = z.uuid().nullable().parse(input.expectedRevision);
  const operationId = z.uuid().parse(input.operationId);
  const edit = structuredClone({ values: input.values, patch: input.patch });
  const captured = await sottoTransaction(
    database,
    async (tx) => {
      const storage = await admittedStorage(tx, input);
      const head = await storage.owned.head(storage.target);
      if (head.revision !== expectedRevision) throw new OwnedCredentialConflictError();
      let values: CredentialValues;
      if (edit.patch !== undefined) {
        if (!head.credential || !head.revision)
          throw new AccessError('invalid', 'Add a provider key before editing its settings');
        const existing = await storage.owned.readForEdit(storage.target, head.revision);
        values = { ...existing.values };
        for (const [field, value] of Object.entries(edit.patch)) {
          if (value === null) delete values[field];
          else values[field] = value;
        }
      } else {
        if (edit.values === undefined)
          throw new AccessError('invalid', 'Provider credentials are required');
        values = edit.values;
      }
      const probe = captureSottoCredentialProbe(input.scope, input.provider, values);
      if (probe.kind === 'unsupported')
        throw new AccessError('invalid', 'This provider does not use saved API credentials');
      const now = Date.now();
      const prepared = storage.owned.prepareReplacement(storage.target, {
        expectedHeadRevision: expectedRevision,
        credentialRevision: operationId,
        values,
        binding: probe.binding,
        availability: 'enabled',
        label:
          head.credential?.label ?? sottoCredentialDescriptor(input.scope, input.provider).label,
        metadata: {
          createdAt: head.credential?.metadata.createdAt ?? now,
          updatedAt: now,
          lastUsedAt: head.credential?.metadata.lastUsedAt ?? null,
        },
      });
      return {
        probe,
        prepared,
        values,
        instanceId: storage.instance.instanceId,
        owner: storage.owner,
      };
    },
    { signal: input.request.signal }
  );
  const validation = await validateSottoCredentialProbe(captured.probe, input.request.signal);
  input.request.signal.throwIfAborted();
  if (validation.status === 'rejected' || validation.status === 'missing')
    throw new SottoCredentialRejectedError(validation);
  if (validation.status === 'inconclusive' && !input.allowUnverified)
    return { status: 'needs_confirmation' as const, validation, operationId };

  const saved = { status: 'saved' as const, revision: operationId, validation };
  try {
    return await sottoTransaction(
      database,
      async (tx) => {
        const storage = await admittedStorage(tx, input);
        if (
          storage.instance.instanceId !== captured.instanceId ||
          storage.owner.generation !== captured.owner.generation
        )
          throw new OwnedCredentialConflictError();
        const current = captureSottoCredentialProbe(input.scope, input.provider, captured.values);
        if (
          current.kind === 'unsupported' ||
          current.binding.protocol !== captured.probe.binding.protocol ||
          current.binding.endpoint !== captured.probe.binding.endpoint
        )
          throw new AccessError('conflict', 'Provider configuration changed during validation');
        const prepared = storage.owned.withValidation(captured.prepared, validation);
        input.request.signal.throwIfAborted();
        await storage.owned.replace(prepared);
        input.request.signal.throwIfAborted();
        return saved;
      },
      { signal: input.request.signal }
    );
  } catch (error) {
    input.request.signal.throwIfAborted();
    if (error instanceof AccessError || error instanceof OwnedCredentialConflictError) throw error;
    // A database connection can fail after COMMIT. Reconcile the exact ciphertext receipt
    // through fresh authority checks, without a second probe or a new write operation.
    return sottoTransaction(
      database,
      async (tx) => {
        const storage = await admittedStorage(tx, input);
        if (
          storage.instance.instanceId !== captured.instanceId ||
          storage.owner.generation !== captured.owner.generation
        )
          throw new OwnedCredentialConflictError();
        const head = await storage.owned.head(storage.target);
        if (head.revision !== operationId) throw error;
        const prepared = storage.owned.withValidation(captured.prepared, validation);
        if ((await storage.owned.replace(prepared)) !== 'replayed')
          throw new OwnedCredentialConflictError();
        input.request.signal.throwIfAborted();
        return saved;
      },
      { signal: input.request.signal }
    );
  }
}

/** Removes the selected owner revision and only that owner's sharing policy in one commit. */
export async function removeSottoCredential(
  database: PrismaClient,
  input: CredentialRequest & { expectedRevision: string | null; operationId: string }
) {
  input = captureRequest(input);
  const expectedRevision = z.uuid().nullable().parse(input.expectedRevision);
  const operationId = z.uuid().parse(input.operationId);
  return sottoTransaction(
    database,
    async (tx) => {
      const storage = await admittedStorage(tx, input);
      input.request.signal.throwIfAborted();
      await storage.owned.remove(storage.target, expectedRevision, operationId);
      const grant = await storage.sharing.head(storage.slot);
      if (
        grant.policy?.owner.subjectId === storage.owner.subjectId &&
        grant.policy.owner.generation === storage.owner.generation
      )
        await storage.sharing.remove(storage.slot, grant.revision);
      input.request.signal.throwIfAborted();
      return { revision: operationId };
    },
    { signal: input.request.signal }
  );
}

/** Includes removed heads so a later create can satisfy the same optimistic-concurrency contract. */
export async function listSottoCredentialSettings(
  database: PrismaClient,
  input: Omit<CredentialRequest, 'provider'> & { providers: readonly string[] }
) {
  input = { ...captureRequest({ ...input, provider: '' }), providers: [...input.providers] };
  return sottoTransaction(
    database,
    async (tx) => {
      const owner = await admittedOwner(tx, input);
      const rows = await sottoCredentialRows(tx);
      requireDisplayedOwner(input, rows.instance.instanceId, owner);
      const heads: Record<string, string | null> = {};
      const keys = [];
      for (const provider of input.providers) {
        const storage = await sottoCredentialStorage(tx, input.scope, provider);
        const head = await storage.owned.head({ ...storage.slot, owner });
        heads[provider] = head.revision;
        if (head.credential)
          keys.push({
            provider,
            revision: head.revision,
            isValid: head.credential.availability === 'enabled',
            verification: head.credential.verification,
            label: head.credential.label,
            lastUsedAt:
              head.credential.metadata.lastUsedAt === null
                ? null
                : new Date(head.credential.metadata.lastUsedAt).toISOString(),
          });
      }
      input.request.signal.throwIfAborted();
      return { keys, heads, context: { instanceId: rows.instance.instanceId, owner } };
    },
    { signal: input.request.signal }
  );
}
