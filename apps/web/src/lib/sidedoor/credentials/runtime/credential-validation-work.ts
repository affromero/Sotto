import { isDeepStrictEqual } from 'node:util';
import { z } from 'zod';
import type { CredentialValidation } from 'thesidedoor-core/ai';
import { prepareJob } from 'thesidedoor-core/runtime/outbox';
import type { Prisma, PrismaClient } from '@/generated/prisma/client';
import {
  captureSottoCredentialProbe,
  validateSottoCredentialProbe,
} from '@/lib/providers/shared/credential-validation';
import {
  captureSottoCredentialOwner,
  sottoCredentialRows,
  sottoCredentialStorage,
} from '@/lib/sidedoor/credentials/runtime/provider-credentials';
import { SIDEDOOR_STATE_ID } from '@/lib/sidedoor/access/state/store';
import { readSottoWorkerJob, sottoJobOutbox } from '@/lib/sidedoor/jobs/core/job-delivery';
import { completeErasedJob } from '@/lib/sidedoor/access/deletion/job-erasure';
import { sottoTransaction } from '@/lib/sidedoor/access/state/transaction';

const scope = z
  .object({ subjectId: z.string().min(1), generation: z.number().int().nonnegative().safe() })
  .strict();
export const credentialValidationPayloadSchema = z
  .object({
    userId: z.string().min(1),
    provider: z.string().min(1),
    modality: z.enum(['ai', 'tts', 'music', 'visual']),
    revision: z.uuid(),
    storage: z
      .object({
        instanceId: z.uuid(),
        userId: z.string().min(1),
        owner: scope,
        scopes: z.array(scope).length(2),
      })
      .strict(),
  })
  .strict();
export type CredentialValidationPayload = z.infer<typeof credentialValidationPayloadSchema>;
type QueueReference = { id?: string; name: string; data: unknown };

/** Owner generation and instance identity are rechecked independently of the original requester. */
export async function validateCredentialWorkStorage(
  tx: Prisma.TransactionClient,
  payload: CredentialValidationPayload
) {
  const storage = await sottoCredentialStorage(tx, payload.modality, payload.provider);
  const owner = await captureSottoCredentialOwner(tx, payload.userId);
  const scopes = [
    owner,
    { subjectId: storage.instance.subjectId, generation: storage.instance.generation },
  ].sort((left, right) => left.subjectId.localeCompare(right.subjectId));
  if (
    payload.userId !== payload.storage.userId ||
    storage.instance.instanceId !== payload.storage.instanceId ||
    !isDeepStrictEqual(owner, payload.storage.owner) ||
    !isDeepStrictEqual(scopes, payload.storage.scopes)
  )
    throw new Error('Credential validation owner or instance changed');
  return { ...storage, target: { ...storage.slot, owner } };
}

/** Enqueue one captured slot. Callers supply provenance or a canonical bounded scan entry. */
export async function enqueueCredentialValidation(
  tx: Prisma.TransactionClient,
  payload: CredentialValidationPayload
) {
  payload = credentialValidationPayloadSchema.parse(payload);
  const storage = await validateCredentialWorkStorage(tx, payload);
  const head = await storage.owned.head(storage.target);
  if (
    head.revision !== payload.revision ||
    !head.credential ||
    head.credential.availability !== 'enabled'
  )
    return null;
  return sottoJobOutbox(tx).enqueue(
    prepareJob({
      namespace: SIDEDOOR_STATE_ID,
      handler: 'key-validation',
      version: 1,
      payload,
      scopes: payload.storage.scopes,
      delivery: { attempts: 3, priority: 0, availableAt: 0 },
    })
  );
}

/** Each page is independent and bounded. No provider credentials are decrypted by the scheduler. */
export async function scheduleCredentialValidationPage(
  database: PrismaClient,
  after: string | null,
  signal?: AbortSignal
) {
  return sottoTransaction(
    database,
    async (tx) => {
      signal?.throwIfAborted();
      const storage = await sottoCredentialRows(tx);
      const page = await storage.owned.list(after, 100);
      let scheduled = 0;
      for (const credential of page.items) {
        if (credential.availability !== 'enabled') continue;
        if (!credential.owner.subjectId.startsWith('profile:'))
          throw new Error('Invalid credential owner');
        const userId = credential.owner.subjectId.slice('profile:'.length);
        const scopes = [
          credential.owner,
          { subjectId: storage.instance.subjectId, generation: storage.instance.generation },
        ].sort((left, right) => left.subjectId.localeCompare(right.subjectId));
        const payload = credentialValidationPayloadSchema.parse({
          userId,
          provider: credential.provider,
          modality: credential.modality,
          revision: credential.credentialRevision,
          storage: {
            instanceId: storage.instance.instanceId,
            userId,
            owner: credential.owner,
            scopes,
          },
        });
        if (await enqueueCredentialValidation(tx, payload)) scheduled++;
      }
      signal?.throwIfAborted();
      return { scheduled, cursor: page.cursor };
    },
    { signal }
  );
}

async function admit(tx: Prisma.TransactionClient, queued: QueueReference) {
  const work = await readSottoWorkerJob(tx, queued, {
    handler: 'key-validation',
    version: 1,
    payload: credentialValidationPayloadSchema,
  });
  if (work.complete) return work;
  if (!isDeepStrictEqual(work.scopes, work.payload.storage.scopes))
    throw new Error('Credential validation scopes changed');
  if (await completeErasedJob(tx, work)) return { complete: true as const };
  const storage = await validateCredentialWorkStorage(tx, work.payload);
  const head = await storage.owned.head(storage.target);
  if (!head.credential || head.revision !== work.payload.revision) {
    await sottoJobOutbox(tx).complete(work.operationId, work.fingerprint);
    return { complete: true as const };
  }
  return { ...work, storage, credential: head.credential };
}

/** Verification sequence starts immediately before its actual probe, never from a delayed error string. */
export async function processCredentialValidation(
  database: PrismaClient,
  queued: QueueReference,
  signal?: AbortSignal
) {
  const captured = await sottoTransaction(
    database,
    async (tx) => {
      signal?.throwIfAborted();
      try {
        const work = await admit(tx, queued);
        if (work.complete) return work;
        const selected = await work.storage.owned.readForEdit(
          work.storage.target,
          work.payload.revision
        );
        const ticket = await work.storage.owned.beginVerification(
          work.storage.target,
          work.payload.revision
        );
        if (!ticket) throw new Error('Credential changed before verification began');
        return {
          complete: false as const,
          payload: work.payload,
          operationId: work.operationId,
          fingerprint: work.fingerprint,
          scopes: work.scopes,
          ticket,
          probe: captureSottoCredentialProbe(
            work.payload.modality,
            work.payload.provider,
            selected.values
          ),
        };
      } finally {
        signal?.throwIfAborted();
      }
    },
    { signal }
  );
  if (captured.complete) return;
  const bindingMatches =
    captured.probe.kind !== 'unsupported' &&
    isDeepStrictEqual(captured.probe.binding, captured.ticket.binding);
  const outcome: CredentialValidation = bindingMatches
    ? await validateSottoCredentialProbe(captured.probe, signal)
    : {
        status: 'inconclusive',
        readiness: { code: 'not_configured', checkedAt: Date.now(), action: 'configure' },
      };
  signal?.throwIfAborted();
  await sottoTransaction(
    database,
    async (tx) => {
      signal?.throwIfAborted();
      try {
        const current = await admit(tx, queued);
        if (current.complete) return;
        if (!isDeepStrictEqual(current.payload, captured.payload))
          throw new Error('Credential validation payload changed');
        const endpoint = captureSottoCredentialProbe(
          current.payload.modality,
          current.payload.provider,
          {}
        );
        const settled: CredentialValidation =
          endpoint.kind !== 'unsupported' &&
          isDeepStrictEqual(endpoint.binding, captured.ticket.binding)
            ? outcome
            : {
                status: 'inconclusive',
                readiness: { code: 'not_configured', checkedAt: Date.now(), action: 'configure' },
              };
        const applied = await current.storage.owned.finishVerification(captured.ticket, settled);
        const outbox = sottoJobOutbox(tx);
        if (!(await outbox.complete(current.operationId, current.fingerprint))) return;
        if (
          applied !== 'applied' ||
          current.credential.availability !== 'enabled' ||
          settled.status !== 'rejected'
        )
          return;
        await outbox.enqueue(
          prepareJob({
            namespace: SIDEDOOR_STATE_ID,
            handler: 'notifications',
            version: 1,
            payload: {
              userId: current.payload.userId,
              type: 'KEY_INVALID',
              title: 'Provider key needs attention',
              message: `The provider rejected your ${current.payload.provider} credentials. Update them in Settings.`,
              data: {
                provider: current.payload.provider,
                modality: current.payload.modality,
                revision: current.payload.revision,
              },
              parentOperationId: current.operationId,
              parentFingerprint: current.fingerprint,
              storage: current.payload.storage,
            },
            scopes: current.scopes,
            delivery: { attempts: 5, priority: 0, availableAt: 0 },
          })
        );
      } finally {
        signal?.throwIfAborted();
      }
    },
    { signal }
  );
}
